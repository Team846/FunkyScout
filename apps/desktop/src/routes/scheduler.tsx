import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Button } from "@shadcn/ui/components/button.tsx";
import { Input } from "@shadcn/ui/components/input.tsx";
import { Label } from "@shadcn/ui/components/label.tsx";
import { Checkbox } from "@shadcn/ui/components/checkbox.tsx";
import { useDesktopEvent } from "../contexts/DesktopEventContext";
import { useDesktopCompetitionData } from "../contexts/DesktopCompetitionDataContext";
import { runCycleForEvent } from "@lib/schedule/runCycleForEvent";
import { assignShiftsFromCycle, assignPitTeams } from "@lib/data/writes";
import type { CycleAssignment, Scouter } from "@lib/schedule/cycle";
import { getMatchLabel, getMatchSortOrder } from "@lib/utils/match";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@shadcn/ui/components/tooltip.tsx";
import { invoke } from "@tauri-apps/api/core";
import { getEventSchedule } from "@lib/db";

export const Route = createFileRoute("/scheduler")({
  component: SchedulerPage,
});

// Module-level persistence — survives tab navigation within a session
let _persistedSelectedUids: Set<string> | null = null;
let _persistedEventKey: string | null = null;

interface ScouterProfile {
  uid: string;
  name: string;
  role: string;
}

interface TeamSchedule {
  matchKey: string;
  redTeams: { teamKey: string; teamNumber: number }[];
  blueTeams: { teamKey: string; teamNumber: number }[];
  predictedTime: number;
}

interface PitAssignment {
  teamKey: string;
  teamNumber: number;
  teamName: string | null;
  uid: string;
  name: string;
}

function SchedulerPage() {
  const { currentEvent } = useDesktopEvent();
  const { lastDataRefreshAt } = useDesktopCompetitionData();
  const [schedule, setSchedule] = useState<TeamSchedule[] | null>(null);

  const [w, setW] = useState(3);
  const [r, setR] = useState(1);
  const [assignments, setAssignments] = useState<CycleAssignment[]>([]);
  const [assignedMatchTeams, setAssignedMatchTeams] = useState<Set<string>>(new Set());
  const [matchScouterMap, setMatchScouterMap] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState(false);
  const [applying, setApplying] = useState(false);

  const [allScouters, setAllScouters] = useState<ScouterProfile[]>([]);
  const [selectedUids, setSelectedUids] = useState<Set<string>>(
    () => _persistedSelectedUids ?? new Set(),
  );
  const [loadingScouters, setLoadingScouters] = useState(true);
  const [search, setSearch] = useState("");

  const [pitAssignments, setPitAssignments] = useState<PitAssignment[]>([]);
  const [schedulingTeams, setSchedulingTeams] = useState(false);
  const [applyingTeams, setApplyingTeams] = useState(false);

  // Combined init effect — reads local SQLite only (no Supabase JS calls).
  // Runs on mount and whenever currentEvent changes.
  // Pre-populates existing assignments so the schedule reflects Supabase data immediately.
  useEffect(() => {
    if (!currentEvent) {
      setSchedule(null);
      setAllScouters([]);
      setLoadingScouters(false);
      return;
    }

    // Reset persisted selection when the user switches events
    if (currentEvent !== _persistedEventKey) {
      _persistedSelectedUids = null;
      _persistedEventKey = currentEvent;
    }

    setLoadingScouters(true);

    Promise.all([
      getEventSchedule(currentEvent),
      invoke<{ uid: string; name: string; role: string }[]>("get_user_profiles", { uids: [] }),
    ])
      .then(([data, profiles]) => {
        // ── Build schedule (QM-only) ──
        const scheduleMap = new Map<string, TeamSchedule>();
        data.forEach((entry) => {
          if (!scheduleMap.has(entry.match)) {
            scheduleMap.set(entry.match, {
              matchKey: entry.match,
              redTeams: [],
              blueTeams: [],
              predictedTime: entry.est_time || 0,
            });
          }
          const matchEntry = scheduleMap.get(entry.match)!;
          const teamInfo = {
            teamKey: entry.team,
            teamNumber: parseInt(entry.team.replace("frc", ""), 10),
          };
          if (entry.alliance === "red") {
            matchEntry.redTeams.push(teamInfo);
          } else {
            matchEntry.blueTeams.push(teamInfo);
          }
        });
        const qualOnly = Array.from(scheduleMap.values()).filter(
          (m) => getMatchSortOrder(m.matchKey)[0] === 0,
        );
        const sorted = qualOnly.sort((a, b) => {
          const oa = getMatchSortOrder(a.matchKey);
          const ob = getMatchSortOrder(b.matchKey);
          return (oa[1] ?? 0) - (ob[1] ?? 0);
        });
        setSchedule(sorted);

        // ── Pre-populate assignments from existing SQLite data ──
        const newAssignedMatchTeams = new Set<string>();
        const newMatchScouterMap: Record<string, string> = {};
        const assignedUids = new Set<string>();
        data.forEach((entry) => {
          if (entry.uid && entry.name) {
            const key = `${entry.match}|${entry.team}`;
            newAssignedMatchTeams.add(key);
            newMatchScouterMap[key] = entry.name;
            assignedUids.add(entry.uid);
          }
        });
        setAssignedMatchTeams(newAssignedMatchTeams);
        setMatchScouterMap(newMatchScouterMap);

        // ── Build eligible scouters ──
        const eligible = profiles
          .filter((p) => p.role === "scouter" || p.role === "admin")
          .map((p) => ({ uid: p.uid, name: p.name ?? p.uid, role: p.role ?? "scouter" }));
        setAllScouters(eligible);

        // ── Initialize selectedUids: in-memory > schedule UIDs > localStorage > all ──
        // Schedule assignments are the ground truth: always use them when available.
        // localStorage is only consulted when the schedule has no assignments yet.
        if (_persistedSelectedUids === null) {
          let initialUids: Set<string>;
          if (assignedUids.size > 0) {
            // Schedule has live assignments — use those as the starting point
            initialUids = assignedUids;
          } else {
            // No assignments yet: restore last saved selection or default to all
            const storageKey = `sched_scouters_${currentEvent}`;
            const saved = localStorage.getItem(storageKey);
            if (saved) {
              try {
                initialUids = new Set(JSON.parse(saved) as string[]);
              } catch {
                initialUids = new Set(eligible.map((s) => s.uid));
              }
            } else {
              initialUids = new Set(eligible.map((s) => s.uid));
            }
          }
          _persistedSelectedUids = initialUids;
          setSelectedUids(initialUids);
        }

        setLoadingScouters(false);
      })
      .catch((e) => {
        console.error("[Scheduler] Failed to initialize:", e);
        setLoadingScouters(false);
      });
  }, [currentEvent, lastDataRefreshAt]);

  // Persist selected scouters across tab switches and app restarts.
  // Only write to the module-level variable when the selection is non-empty.
  // On mount, selectedUids is the initial empty Set; if we wrote _persistedSelectedUids
  // then, it would be non-null before the init effect runs — causing the init's
  // `=== null` guard to skip selection initialization entirely.
  useEffect(() => {
    if (selectedUids.size > 0) {
      _persistedSelectedUids = selectedUids;
    }
    if (currentEvent) {
      localStorage.setItem(
        `sched_scouters_${currentEvent}`,
        JSON.stringify([...selectedUids]),
      );
    }
  }, [selectedUids, currentEvent]);

  const filtered = allScouters.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()),
  );

  const selectedScouters = allScouters.filter((s) => selectedUids.has(s.uid));

  const toggleUid = (uid: string) => {
    setSelectedUids((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  const selectAll = () => setSelectedUids(new Set(allScouters.map((s) => s.uid)));
  const selectNone = () => setSelectedUids(new Set());

  const handleGenerate = async () => {
    if (!currentEvent) return;
    if (selectedUids.size === 0) {
      toast.error("Select at least one scouter");
      return;
    }
    setGenerating(true);
    setAssignments([]);
    try {
      const scouters: Scouter[] = allScouters
        .filter((s) => selectedUids.has(s.uid))
        .map((s) => ({ uid: s.uid, name: s.name }));
      const result = await runCycleForEvent(currentEvent, [w, r], scouters);
      setAssignments(result);
      const newAssignedMatchTeams = new Set<string>();
      const newMatchScouterMap: Record<string, string> = {};
      result.forEach((assignment) => {
        newAssignedMatchTeams.add(`${assignment.matchKey}|${assignment.teamKey}`);
        newMatchScouterMap[`${assignment.matchKey}|${assignment.teamKey}`] = assignment.name!;
      });
      setAssignedMatchTeams(newAssignedMatchTeams);
      setMatchScouterMap(newMatchScouterMap);
      toast.success(`Generated ${result.length} shift assignments`);
    } catch (e: any) {
      toast.error(`Failed to generate: ${e.message ?? String(e)}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleApply = async () => {
    if (!currentEvent || assignments.length === 0) return;
    setApplying(true);
    try {
      await assignShiftsFromCycle(currentEvent, assignments);
      toast.success(`Pushed ${assignments.length} shift assignments to Supabase`);
    } catch (e: any) {
      toast.error(`Failed to push shifts: ${e.message ?? String(e)}`);
    } finally {
      setApplying(false);
    }
  };

  const handleScheduleTeams = async () => {
    if (!currentEvent) return;
    const selected = allScouters.filter((s) => selectedUids.has(s.uid));
    if (selected.length === 0) {
      toast.error("Select at least one scouter");
      return;
    }
    setSchedulingTeams(true);
    setPitAssignments([]);
    try {
      const teams = await invoke<{ team: string; team_name?: string | null }[]>(
        "get_teams",
        { event: currentEvent },
      );
      if (teams.length === 0) {
        toast.error("No teams found for this event. Bootstrap the event first.");
        return;
      }
      const result: PitAssignment[] = teams.map((t, i) => {
        const scouter = selected[i % selected.length];
        const teamNum = parseInt(t.team?.replace("frc", "") ?? "0", 10);
        return {
          teamKey: t.team,
          teamNumber: isNaN(teamNum) ? 0 : teamNum,
          teamName: t.team_name ?? null,
          uid: scouter.uid,
          name: scouter.name,
        };
      });
      setPitAssignments(result);
      toast.success(`Scheduled ${result.length} teams across ${selected.length} scouters`);
    } catch (e: any) {
      toast.error(`Failed to schedule teams: ${e.message ?? String(e)}`);
    } finally {
      setSchedulingTeams(false);
    }
  };

  const handleApplyTeams = async () => {
    if (!currentEvent || pitAssignments.length === 0) return;
    setApplyingTeams(true);
    try {
      await assignPitTeams(
        currentEvent,
        pitAssignments.map((a) => ({ teamKey: a.teamKey, uid: a.uid, name: a.name })),
      );
      toast.success(`Pushed ${pitAssignments.length} team assignments to Supabase`);
    } catch (e: any) {
      toast.error(`Failed to push team assignments: ${e.message ?? String(e)}`);
    } finally {
      setApplyingTeams(false);
    }
  };

  return (
    <div className="h-full flex gap-3 p-4 overflow-hidden">
      {/* Column 1: All Scouters */}
      <div className="w-64 flex flex-col min-h-0">
        <div className="flex-1 flex flex-col rounded-lg border border-border bg-card overflow-hidden min-h-0">
          <div className="px-3 py-2.5 border-b border-border flex items-center justify-between gap-2 flex-shrink-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium">All Scouters</span>
              <span className="text-xs text-muted-foreground">
                {selectedUids.size}/{allScouters.length}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={selectAll} className="text-xs text-primary hover:underline">All</button>
              <span className="text-xs text-muted-foreground">·</span>
              <button onClick={selectNone} className="text-xs text-primary hover:underline">None</button>
            </div>
          </div>
          <div className="px-2 py-2 border-b border-border flex-shrink-0">
            <Input
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 text-xs"
            />
          </div>
          <div className="flex-1 overflow-y-auto">
            {loadingScouters ? (
              <p className="text-xs text-muted-foreground p-3">Loading...</p>
            ) : filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground p-3">No scouters found.</p>
            ) : (
              <div className="divide-y divide-border">
                {filtered.map((s) => (
                  <label
                    key={s.uid}
                    className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-secondary/40 select-none"
                  >
                    <Checkbox
                      checked={selectedUids.has(s.uid)}
                      onCheckedChange={() => toggleUid(s.uid)}
                    />
                    <span className="text-xs flex-1 truncate">{s.name}</span>
                    {s.role === "admin" && (
                      <span className="text-[10px] text-muted-foreground">admin</span>
                    )}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Column 2: Selected Scouters + Action Buttons */}
      <div className="w-64 flex flex-col gap-3 min-h-0">
        {/* Selected scouters mini-list */}
        <div className="flex-1 flex flex-col rounded-lg border border-border bg-card overflow-hidden min-h-0">
          <div className="px-3 py-2.5 border-b border-border flex-shrink-0">
            <span className="text-xs font-medium">
              Selected Scouters
              <span className="ml-1.5 text-muted-foreground">({selectedUids.size})</span>
            </span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {selectedScouters.length === 0 ? (
              <p className="text-xs text-muted-foreground p-3">None selected</p>
            ) : (
              <div className="divide-y divide-border">
                {selectedScouters.map((s) => (
                  <div key={s.uid} className="flex items-center gap-2 px-3 py-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                    <span className="text-xs truncate">{s.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Action buttons panel */}
        <div className="flex-shrink-0 rounded-lg border border-border bg-card p-3 space-y-3">
          {/* W/R inputs */}
          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Work</Label>
              <Input
                type="number"
                min={1}
                value={w}
                onChange={(e) => setW(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-16 h-7 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Rest</Label>
              <Input
                type="number"
                min={0}
                value={r}
                onChange={(e) => setR(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-16 h-7 text-xs"
              />
            </div>
            <p className="text-[10px] text-muted-foreground pb-1.5 leading-tight">
              W{w} / R{r}
            </p>
          </div>

          {/* Match shifts */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Match Shifts</p>
            <Button
              size="sm"
              className="w-full h-7 text-xs"
              onClick={handleGenerate}
              disabled={generating || !currentEvent || selectedUids.size === 0}
            >
              {generating ? "Generating..." : "Generate Assignments"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="w-full h-7 text-xs"
              onClick={handleApply}
              disabled={applying || assignments.length === 0}
            >
              {applying ? "Pushing..." : `Push to Supabase (${assignments.length})`}
            </Button>
          </div>

          {/* Pit teams */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Pit Teams</p>
            <Button
              size="sm"
              className="w-full h-7 text-xs"
              onClick={handleScheduleTeams}
              disabled={schedulingTeams || !currentEvent || selectedUids.size === 0}
            >
              {schedulingTeams ? "Scheduling..." : "Schedule Teams"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="w-full h-7 text-xs"
              onClick={handleApplyTeams}
              disabled={applyingTeams || pitAssignments.length === 0}
            >
              {applyingTeams ? "Pushing..." : `Push to Supabase (${pitAssignments.length})`}
            </Button>
          </div>
        </div>
      </div>

      {/* Column 3: Match Schedule */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        <div className="flex items-center justify-between pb-3 flex-shrink-0">
          <h2 className="text-sm font-semibold">Match Schedule</h2>
        </div>
        <div className="flex-1 overflow-hidden rounded-lg border border-border min-h-0">
          <div className="flex flex-col h-full overflow-hidden">
            {/* Sticky header */}
            <div className="grid grid-cols-[80px_1fr_1fr_56px] gap-0 px-3 py-2.5 bg-card/50 flex-shrink-0 border-b border-border/50">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Match</span>
              <span className="text-xs font-semibold text-destructive uppercase tracking-wide text-center">Red Alliance</span>
              <span className="text-xs font-semibold text-chart-1 uppercase tracking-wide text-center">Blue Alliance</span>
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide text-center">Time</span>
            </div>

            {/* Scrollable rows */}
            <div className="flex-1 overflow-y-auto">
              {!schedule || schedule.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                  No schedule data
                </div>
              ) : (
                schedule.map((match) => (
                  <div
                    key={match.matchKey}
                    className="grid grid-cols-[80px_1fr_1fr_56px] gap-0 items-center px-3 py-2 border-b border-border/50 hover:bg-secondary/10 transition-colors"
                  >
                    {/* Match label */}
                    <span className="text-xs font-semibold text-foreground/80">
                      {getMatchLabel(match.matchKey)}
                    </span>

                    {/* Red Alliance */}
                    <div className="flex items-center justify-center gap-1.5 px-2 py-1 mx-1 rounded bg-destructive/5 border-l-2 border-destructive/40">
                      {match.redTeams.map((team) => {
                        const key = `${match.matchKey}|${team.teamKey}`;
                        const isAssigned = assignedMatchTeams.has(key);
                        const scouterName = matchScouterMap[key];
                        return (
                          <TooltipProvider key={team.teamKey}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span
                                  className={`text-xs font-bold tabular-nums px-1.5 py-0.5 rounded transition-colors ${
                                    isAssigned
                                      ? " text-primary cursor-help"
                                      : "text-foreground/70"
                                  }`}
                                >
                                  {team.teamNumber}
                                </span>
                              </TooltipTrigger>
                              {isAssigned && scouterName && (
                                <TooltipContent className="bg-black border border-border text-yellow-400">
                                  <p>{scouterName}</p>
                                </TooltipContent>
                              )}
                            </Tooltip>
                          </TooltipProvider>
                        );
                      })}
                    </div>

                    {/* Blue Alliance */}
                    <div className="flex items-center justify-center gap-1.5 px-2 py-1 mx-1 rounded bg-chart-1/5 border-l-2 border-chart-1/40">
                      {match.blueTeams.map((team) => {
                        const key = `${match.matchKey}|${team.teamKey}`;
                        const isAssigned = assignedMatchTeams.has(key);
                        const scouterName = matchScouterMap[key];
                        return (
                          <TooltipProvider key={team.teamKey}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span
                                  className={`text-xs font-bold tabular-nums px-1.5 py-0.5 rounded transition-colors ${
                                    isAssigned
                                      ? "text-primary cursor-help"
                                      : "text-foreground/70"
                                  }`}
                                >
                                  {team.teamNumber}
                                </span>
                              </TooltipTrigger>
                              {isAssigned && scouterName && (
                                <TooltipContent className="bg-black border border-border text-yellow-400">
                                  <p>{scouterName}</p>
                                </TooltipContent>
                              )}
                            </Tooltip>
                          </TooltipProvider>
                        );
                      })}
                    </div>

                    {/* Time */}
                    <span className="text-xs text-muted-foreground text-center">
                      {match.predictedTime
                        ? new Date(match.predictedTime * 1000).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—"}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
