import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Button } from "@shadcn/ui/components/button.tsx";
import { Input } from "@shadcn/ui/components/input.tsx";
import { Label } from "@shadcn/ui/components/label.tsx";
import { Checkbox } from "@shadcn/ui/components/checkbox.tsx";
import { useDesktopEvent } from "../contexts/DesktopEventContext";
import { useDesktopCompetitionData } from "../contexts/DesktopCompetitionDataContext";
import { useUserProfiles } from "../contexts/UserProfilesContext";
import { runCycleForEvent } from "@lib/schedule/runCycleForEvent";
import { assignShiftsFromCycle, assignShiftsDiff, assignPitTeams } from "@lib/data/writes";
import type { CycleAssignment, Scouter } from "@lib/schedule/cycle";
import { getMatchLabel, getMatchSortOrder } from "@lib/utils/match";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@shadcn/ui/components/tooltip.tsx";
import { Pencil, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useTabContext } from "../contexts/TabContext";

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
  const navigate = useNavigate();
  const { addTab } = useTabContext();
  const { currentEvent } = useDesktopEvent();
  // Use context data — updates automatically on event change, passive polling, and realtime
  const { schedule: contextSchedule } = useDesktopCompetitionData();
  const { userProfiles } = useUserProfiles();

  const handleMatchClick = useCallback(
    (matchKey: string) => {
      addTab("/matches", getMatchLabel(matchKey), { match: matchKey }, `match-${matchKey}`);
      navigate({ to: "/matches", search: { match: matchKey } });
    },
    [addTab, navigate]
  );
  const [schedule, setSchedule] = useState<TeamSchedule[] | null>(null);

  const [w, setW] = useState(3);
  const [r, setR] = useState(1);
  const [assignments, setAssignments] = useState<CycleAssignment[]>([]);
  const [assignedMatchTeams, setAssignedMatchTeams] = useState<Set<string>>(new Set());
  const [matchScouterMap, setMatchScouterMap] = useState<Record<string, string>>({});
  const [matchUidMap, setMatchUidMap] = useState<Record<string, string>>({});
  // Saved state — used for dirty detection against manual edits
  const [savedMatchUidMap, setSavedMatchUidMap] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [savingAssignments, setSavingAssignments] = useState(false);
  const [isEditingAssignments, setIsEditingAssignments] = useState(false);

  const [allScouters, setAllScouters] = useState<ScouterProfile[]>([]);
  const [selectedUids, setSelectedUids] = useState<Set<string>>(
    () => _persistedSelectedUids ?? new Set(),
  );
  const [loadingScouters, setLoadingScouters] = useState(true);
  const [search, setSearch] = useState("");

  const [pitAssignments, setPitAssignments] = useState<PitAssignment[]>([]);
  const [schedulingTeams, setSchedulingTeams] = useState(false);
  const [applyingTeams, setApplyingTeams] = useState(false);
  const [showScouterPopup, setShowScouterPopup] = useState(false);
  const [selectedMatchKey, setSelectedMatchKey] = useState<string | null>(null);
  const [selectedTeamKey, setSelectedTeamKey] = useState<string | null>(null);

  // Prevents loading spinner during background sync refreshes
  const hasLoadedRef = useRef(false);
  // Mirrors dirtyAssignmentCount so the init effect can read it without adding it as a dep.
  const hasDirtyAssignmentsRef = useRef(false);

  // Count of individual assignment changes vs last saved/loaded state
  const dirtyAssignmentCount = useMemo(() => {
    const allKeys = new Set([...Object.keys(matchUidMap), ...Object.keys(savedMatchUidMap)]);
    let count = 0;
    for (const key of allKeys) {
      if ((matchUidMap[key] ?? null) !== (savedMatchUidMap[key] ?? null)) count++;
    }
    return count;
  }, [matchUidMap, savedMatchUidMap]);

  // Keep hasDirtyAssignmentsRef in sync so the init effect can read it without
  // adding dirtyAssignmentCount as a dependency (which would cause infinite loops).
  useEffect(() => {
    hasDirtyAssignmentsRef.current = dirtyAssignmentCount > 0;
  }, [dirtyAssignmentCount]);

  // Combined init effect — derives schedule + scouters from context data (no direct SQLite calls).
  // Runs on event change, passive polling (120s), and realtime events automatically.
  useEffect(() => {
    if (!currentEvent) {
      setSchedule(null);
      setAllScouters([]);
      setLoadingScouters(false);
      return;
    }

    // On event switch: immediately clear selection so the persist effect below
    // doesn't overwrite _persistedSelectedUids before data for the new event arrives.
    if (currentEvent !== _persistedEventKey) {
      _persistedSelectedUids = null;
      _persistedEventKey = currentEvent;
      setSelectedUids(new Set());
      hasLoadedRef.current = false;
      setIsEditingAssignments(false);
    }

    // Only show the loading spinner on first load; background refreshes update silently.
    if (!hasLoadedRef.current) setLoadingScouters(true);

    // ── Build schedule (QM-only) from context ──
    const scheduleMap = new Map<string, TeamSchedule>();
    contextSchedule.forEach((entry) => {
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

    // ── Pre-populate assignments from context schedule (skip if user has unsaved edits) ──
    const newAssignedMatchTeams = new Set<string>();
    const newMatchScouterMap: Record<string, string> = {};
    const newMatchUidMap: Record<string, string> = {};
    const assignedUids = new Set<string>();
    contextSchedule.forEach((entry) => {
      if (entry.uid && entry.name) {
        const key = `${entry.match}|${entry.team}`;
        newAssignedMatchTeams.add(key);
        newMatchScouterMap[key] = entry.name;
        newMatchUidMap[key] = entry.uid;
        assignedUids.add(entry.uid);
      }
    });

    if (!hasDirtyAssignmentsRef.current) {
      setAssignedMatchTeams(newAssignedMatchTeams);
      setMatchScouterMap(newMatchScouterMap);
      setMatchUidMap(newMatchUidMap);
      setSavedMatchUidMap(newMatchUidMap);
    }

    // ── Build eligible scouters from context profiles ──
    const eligible = userProfiles
      .filter((p) => p.role === "scouter" || p.role === "admin")
      .map((p) => ({ uid: p.uid, name: p.name ?? p.uid, role: (p.role as string) ?? "scouter" }));
    setAllScouters(eligible);

    // ── Initialize selectedUids: in-memory > schedule UIDs > localStorage > all ──
    if (_persistedSelectedUids === null) {
      let initialUids: Set<string>;
      if (assignedUids.size > 0) {
        initialUids = assignedUids;
      } else {
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

    hasLoadedRef.current = true;
    setLoadingScouters(false);
  }, [currentEvent, contextSchedule, userProfiles]);

  // Persist selected scouters across tab switches and app restarts.
  // currentEvent is intentionally excluded from deps: including it would cause this effect
  // to fire on event switch with stale selectedUids (state updates are async), overwriting
  // _persistedSelectedUids=null before the async init resolves and preventing re-initialization.
  // Only write when non-empty — an empty set means we just cleared for an immediate UX reset.
  useEffect(() => {
    if (selectedUids.size > 0) {
      _persistedSelectedUids = selectedUids;
      if (currentEvent) {
        localStorage.setItem(
          `sched_scouters_${currentEvent}`,
          JSON.stringify([...selectedUids]),
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUids]);

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
      const newMatchUidMap: Record<string, string> = {};
      result.forEach((assignment) => {
        const key = `${assignment.matchKey}|${assignment.teamKey}`;
        newAssignedMatchTeams.add(key);
        newMatchScouterMap[key] = assignment.name!;
        newMatchUidMap[key] = assignment.uid!;
      });
      setAssignedMatchTeams(newAssignedMatchTeams);
      setMatchScouterMap(newMatchScouterMap);
      setMatchUidMap(newMatchUidMap);
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
      // Sync saved state so dirty count resets
      setSavedMatchUidMap({ ...matchUidMap });
      toast.success(`Pushed ${assignments.length} shift assignments to Supabase`);
    } catch (e: any) {
      toast.error(`Failed to push shifts: ${e.message ?? String(e)}`);
    } finally {
      setApplying(false);
    }
  };

  const handleSaveAssignments = async () => {
    if (!currentEvent) return;
    // Compute only the changed entries (added, reassigned, or removed).
    const allKeys = new Set([...Object.keys(matchUidMap), ...Object.keys(savedMatchUidMap)]);
    const changes: Array<{ matchKey: string; teamKey: string; uid: string | null; name: string | null }> = [];
    for (const key of allKeys) {
      const currentUid = matchUidMap[key] ?? null;
      const savedUid = savedMatchUidMap[key] ?? null;
      if (currentUid !== savedUid) {
        const sepIdx = key.indexOf("|");
        changes.push({
          matchKey: key.slice(0, sepIdx),
          teamKey: key.slice(sepIdx + 1),
          uid: currentUid,
          name: currentUid ? (matchScouterMap[key] ?? null) : null,
        });
      }
    }
    if (changes.length === 0) return;
    setSavingAssignments(true);
    try {
      await assignShiftsDiff(currentEvent, changes);
      setSavedMatchUidMap({ ...matchUidMap });
      toast.success(`Saved ${changes.length} change${changes.length !== 1 ? "s" : ""}`);
    } catch (e: any) {
      toast.error(`Failed to save: ${e.message ?? String(e)}`);
    } finally {
      setSavingAssignments(false);
    }
  };

  const handleResetAssignments = () => {
    // Revert to last saved/loaded state
    const revertedScouterMap: Record<string, string> = {};
    Object.entries(savedMatchUidMap).forEach(([key, uid]) => {
      const scouter = allScouters.find((s) => s.uid === uid);
      if (scouter) revertedScouterMap[key] = scouter.name;
    });
    setMatchScouterMap(revertedScouterMap);
    setMatchUidMap({ ...savedMatchUidMap });
    setAssignedMatchTeams(new Set(Object.keys(savedMatchUidMap)));
    toast.success("Changes discarded");
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

  const openTeamPopup = (matchKey: string, teamKey: string) => {
    setSelectedMatchKey(matchKey);
    setSelectedTeamKey(teamKey);
    setShowScouterPopup(true);
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

      {/* Right Panel - Match Schedule */}
      <div className="flex-2 flex flex-col">
        <div className="flex items-center justify-between pb-4">
          <h2 className="text-xl font-semibold">Match Schedule</h2>
          <div className="flex items-center gap-2">
            {/* Save/Reset for individual assignment edits */}
            {dirtyAssignmentCount > 0 && (
              <>
                <Button
                  size="sm"
                  className="h-8"
                  disabled={savingAssignments}
                  onClick={handleSaveAssignments}
                >
                  {savingAssignments ? "Saving…" : `Save (${dirtyAssignmentCount})`}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  disabled={savingAssignments}
                  onClick={handleResetAssignments}
                >
                  Reset ({dirtyAssignmentCount})
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant={isEditingAssignments ? "default" : "outline"}
              className="h-8 gap-1.5"
              onClick={() => setIsEditingAssignments((v) => !v)}
            >
              <Pencil className="w-3.5 h-3.5" />
              {isEditingAssignments ? "Done" : "Edit"}
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden rounded-lg border border-border">
          <div className="flex flex-col h-full overflow-hidden relative">
            <div className="grid grid-cols-[100px_repeat(6,_1fr)_80px] gap-0 px-3 py-3 bg-card/50 flex-shrink-0 relative z-10 border-b border-border/50">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Match</span>
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide text-center col-span-3">Red Alliance</span>
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide text-center col-span-3">Blue Alliance</span>
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide text-center">Time</span>
            </div>
            <div className="h-full overflow-y-auto">
              {schedule?.map((match: TeamSchedule) => (
                <div key={match.matchKey} className="grid grid-cols-[100px_repeat(6,_1fr)_80px] gap-0 items-center px-3 py-2.5 border-b border-border/50">
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={() => handleMatchClick(match.matchKey)}
                    onKeyDown={(e) => e.key === "Enter" && handleMatchClick(match.matchKey)}
                    className="text-xs font-semibold text-foreground/80 cursor-pointer hover:bg-secondary/40 hover:text-primary rounded px-1 py-0.5 -mx-1 -my-0.5 transition-colors"
                    title={`View ${getMatchLabel(match.matchKey)}`}
                  >
                    {getMatchLabel(match.matchKey)}
                  </span>
                  {[...match.redTeams, ...match.blueTeams].slice(0, 3).map((team) => {
                    const assignmentKey = `${match.matchKey}|${team.teamKey}`;
                    const isAssigned = assignedMatchTeams.has(assignmentKey);
                    const scouterName = matchScouterMap[assignmentKey];
                    const isDirty = (matchUidMap[assignmentKey] ?? null) !== (savedMatchUidMap[assignmentKey] ?? null);

                    return (
                      <TooltipProvider key={team.teamKey}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              className={`text-xs text-center rounded px-0.5 transition-colors ${
                                isEditingAssignments
                                  ? "cursor-pointer hover:bg-secondary/60 hover:text-foreground"
                                  : isAssigned ? "cursor-help" : ""
                              } ${
                                isDirty
                                  ? "text-blue-400"
                                  : isAssigned
                                  ? "text-yellow-500"
                                  : "text-gray-500"
                              }`}
                              onClick={() => isEditingAssignments && openTeamPopup(match.matchKey, team.teamKey)}
                            >
                              {team.teamNumber}
                            </span>
                          </TooltipTrigger>
                          {(isAssigned || isEditingAssignments) && (
                            <TooltipContent className="bg-black border border-gray-500">
                              {scouterName ? (
                                <p className="text-yellow-400">{scouterName}</p>
                              ) : isEditingAssignments ? (
                                <p className="text-muted-foreground">Click to assign</p>
                              ) : null}
                            </TooltipContent>
                          )}
                        </Tooltip>
                      </TooltipProvider>
                    );
                  })}
                  {[...match.redTeams, ...match.blueTeams].slice(3, 6).map((team) => {
                    const assignmentKey = `${match.matchKey}|${team.teamKey}`;
                    const isAssigned = assignedMatchTeams.has(assignmentKey);
                    const scouterName = matchScouterMap[assignmentKey];
                    const isDirty = (matchUidMap[assignmentKey] ?? null) !== (savedMatchUidMap[assignmentKey] ?? null);

                    return (
                      <TooltipProvider key={team.teamKey}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              className={`text-xs text-center rounded px-0.5 transition-colors ${
                                isEditingAssignments
                                  ? "cursor-pointer hover:bg-secondary/60 hover:text-foreground"
                                  : isAssigned ? "cursor-help" : ""
                              } ${
                                isDirty
                                  ? "text-blue-400"
                                  : isAssigned
                                  ? "text-yellow-500"
                                  : "text-gray-500"
                              }`}
                              onClick={() => isEditingAssignments && openTeamPopup(match.matchKey, team.teamKey)}
                            >
                              {team.teamNumber}
                            </span>
                          </TooltipTrigger>
                          {(isAssigned || isEditingAssignments) && (
                            <TooltipContent className="bg-black border border-gray-500">
                              {scouterName ? (
                                <p className="text-yellow-400">{scouterName}</p>
                              ) : isEditingAssignments ? (
                                <p className="text-muted-foreground">Click to assign</p>
                              ) : null}
                            </TooltipContent>
                          )}
                        </Tooltip>
                      </TooltipProvider>
                    );
                  })}
                  <span className="text-xs text-muted-foreground text-center">
                    {match.predictedTime
                      ? new Date(match.predictedTime * 1000).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Assign Scouter Popup */}
      {showScouterPopup && selectedMatchKey && selectedTeamKey && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card rounded-lg p-6 w-96 max-h-[80vh] flex flex-col">
            <div className="flex justify-between items-center border-b pb-3 mb-4">
              <h3 className="text-lg font-semibold">Assign Scouter</h3>
              <Button onClick={() => setShowScouterPopup(false)} variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto pr-2">
              {matchScouterMap[`${selectedMatchKey}|${selectedTeamKey}`] && (
                <div className="mb-4 p-2 border rounded-md bg-secondary/30">
                  <p className="text-sm text-muted-foreground">Current Scouter:</p>
                  <div className="flex justify-between items-center mt-1">
                    <span className="font-medium">{matchScouterMap[`${selectedMatchKey}|${selectedTeamKey}`]}</span>
                    <Button variant="destructive" size="sm" onClick={() => {
                      const key = `${selectedMatchKey}|${selectedTeamKey}`;
                      setMatchScouterMap(prev => {
                        const next = { ...prev };
                        delete next[key];
                        return next;
                      });
                      setMatchUidMap(prev => {
                        const next = { ...prev };
                        delete next[key];
                        return next;
                      });
                      setAssignedMatchTeams(prev => {
                        const next = new Set(prev);
                        next.delete(key);
                        return next;
                      });
                      setShowScouterPopup(false);
                    }}>Remove</Button>
                  </div>
                </div>
              )}
              <p className="text-sm text-muted-foreground mb-2">
                {selectedScouters.length === 0 ? "No scouters selected — select scouters in column 2" : "Selected Scouters:"}
              </p>
              <div className="divide-y divide-border">
                {selectedScouters.map((s) => (
                  <button
                    key={s.uid}
                    className="flex items-center gap-3 px-2 py-2 w-full text-left hover:bg-secondary/40"
                    onClick={() => {
                      if (selectedMatchKey && selectedTeamKey) {
                        const key = `${selectedMatchKey}|${selectedTeamKey}`;
                        setMatchScouterMap(prev => ({ ...prev, [key]: s.name }));
                        setMatchUidMap(prev => ({ ...prev, [key]: s.uid }));
                        setAssignedMatchTeams(prev => {
                          const next = new Set(prev);
                          next.add(key);
                          return next;
                        });
                      }
                      setShowScouterPopup(false);
                    }}
                  >
                    <span className="text-sm flex-1">{s.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
