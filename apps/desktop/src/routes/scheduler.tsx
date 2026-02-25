import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Button } from "@shadcn/ui/components/button.tsx";
import { Input } from "@shadcn/ui/components/input.tsx";
import { Label } from "@shadcn/ui/components/label.tsx";
import { Checkbox } from "@shadcn/ui/components/checkbox.tsx";
import { useDesktopEvent } from "../contexts/DesktopEventContext";
import { runCycleForEvent } from "@lib/schedule/runCycleForEvent";
import { assignShiftsFromCycle, assignPitTeams } from "@lib/data/writes";
import type { CycleAssignment, Scouter } from "@lib/schedule/cycle";
import { getMatchLabel } from "@lib/utils/match";
import { fetchAllUserDetails } from "@lib/supabase/user";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@shadcn/ui/components/tooltip.tsx";
import { X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { getSchedule } from "@lib/data/schedule";

export const Route = createFileRoute("/scheduler")({
  component: SchedulerPage,
});

// Module-level persistence — survives tab navigation within a session
let _persistedSelectedUids: Set<string> | null = null;

interface ScouterProfile {
  uid: string;
  name: string;
  role: string;
}

interface TeamSchedule {
  matchKey: string;
  teams: {
    teamKey: string;
    teamNumber: number;
  }[];
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
  const [schedule, setSchedule] = useState<TeamSchedule[] | null>(null);

  useEffect(() => {
    if (currentEvent) {
      getSchedule(currentEvent).then((data) => {
        const transformedData: TeamSchedule[] = [];
        const scheduleMap = new Map<string, {
          matchKey: string;
          teams: { teamKey: string; teamNumber: number; }[];
          predictedTime: number;
        }>();

        data.forEach((entry) => {
          if (!scheduleMap.has(entry.match)) {
            scheduleMap.set(entry.match, {
              matchKey: entry.match,
              teams: [],
              predictedTime: entry.est_time || 0,
            });
          }
          const matchEntry = scheduleMap.get(entry.match)!;
          matchEntry.teams.push({
            teamKey: entry.team,
            teamNumber: parseInt(entry.team.replace("frc", ""), 10),
          });
        });

        transformedData.push(...Array.from(scheduleMap.values()));
        setSchedule(transformedData);
      });
    } else {
      setSchedule(null);
    }
  }, [currentEvent]);

  const [w, setW] = useState(3);
  const [r, setR] = useState(1);
  const [assignments, setAssignments] = useState<CycleAssignment[]>([]);
  const [assignedMatchTeams, setAssignedMatchTeams] = useState<Set<string>>(new Set());
  const [matchScouterMap, setMatchScouterMap] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [isEditingAssignments, setIsEditingAssignments] = useState(false);

  // Scouter selection — initialized from persisted state if available
  const [allScouters, setAllScouters] = useState<ScouterProfile[]>([]);
  const [selectedUids, setSelectedUids] = useState<Set<string>>(
    () => _persistedSelectedUids ?? new Set(),
  );
  const [loadingScouters, setLoadingScouters] = useState(true);
  const [search, setSearch] = useState("");

  // Pit team assignment
  const [pitAssignments, setPitAssignments] = useState<PitAssignment[]>([]);
  const [schedulingTeams, setSchedulingTeams] = useState(false);
  const [applyingTeams, setApplyingTeams] = useState(false);
  const [showScouterPopup, setShowScouterPopup] = useState(false);
  const [selectedMatchKey, setSelectedMatchKey] = useState<string | null>(null);
  const [selectedTeamKey, setSelectedTeamKey] = useState<string | null>(null);

  // Persist selectedUids to module-level on every change
  useEffect(() => {
    _persistedSelectedUids = selectedUids;
  }, [selectedUids]);

  useEffect(() => {
    fetchAllUserDetails().then((profiles) => {
      if (!profiles || !Array.isArray(profiles)) return;
      const eligible = (profiles as { uid: string; name?: string; role?: string }[])
        .filter((p) => p.role === "scouter" || p.role === "admin")
        .map((p) => ({ uid: p.uid, name: p.name ?? p.uid, role: p.role ?? "scouter" }));
      setAllScouters(eligible);
      // Only initialize selection if there\\\`s no saved state (first visit)
      if (_persistedSelectedUids === null) {
        setSelectedUids(new Set(eligible.map((s) => s.uid)));
      }
      setLoadingScouters(false);
    });
  }, []);

  const filtered = allScouters.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()),
  );

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
      result.forEach(assignment => {
        newAssignedMatchTeams.add(`${assignment.matchKey}|${assignment.teamKey}`);
        newMatchScouterMap[`${assignment.matchKey}|${assignment.teamKey}`] = assignment.name!; // Store scouter name
      });
      setAssignedMatchTeams(newAssignedMatchTeams);
      setMatchScouterMap(newMatchScouterMap);
      toast.success(`Generated ${result.length} assignments`);
    } catch (e: any) {
      toast.error(`Failed to generate: ${e.message ?? String(e)}`);
    }
    finally {
      setGenerating(false);
    }
  };

  const handleApply = async () => {
    if (!currentEvent || assignments.length === 0) return;
    setApplying(true);
    try {
      await assignShiftsFromCycle(currentEvent, assignments);
      toast.success(`Applied ${assignments.length} shift assignments`);
    } catch (e: any) {
      toast.error(`Failed to apply: ${e.message ?? String(e)}`);
    }
    finally {
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
      // Round-robin assignment
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
    }
    finally {
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
      toast.success(`Applied ${pitAssignments.length} team assignments`);
    } catch (e: any) {
      toast.error(`Failed to apply team assignments: ${e.message ?? String(e)}`);
    }
    finally {
      setApplyingTeams(false);
    }
  };

  // Group by uid for display
  const byUid = assignments.reduce<Record<string, CycleAssignment[]>>((acc, a) => {
    (acc[a.uid] ??= []).push(a);
    return acc;
  }, {});

  const pitByUid = pitAssignments.reduce<Record<string, PitAssignment[]>>((acc, a) => {
    (acc[a.uid] ??= []).push(a);
    return acc;
  }, {});

  return (
    <div className="h-full overflow-auto p-6">
      <div className="h-full flex p-6 gap-6">
        {/* Left Panel - 1/3 width */}
        <div className="flex flex-col w-1/3 space-y-6">
          {/* Top 2/3: Scouter List */}
          <div className="flex-2 rounded-lg border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Scouters</span>
                {/* Info button placeholder */}
                <span className="text-xs text-muted-foreground">(i)</span>
                <span className="text-xs text-muted-foreground">
                  {selectedUids.size} / {allScouters.length} selected
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={selectAll} className="text-xs text-primary hover:underline">
                  All
                </button>
                <span className="text-xs text-muted-foreground">·</span>
                <button onClick={selectNone} className="text-xs text-primary hover:underline">
                  None
                </button>
                {/* Dropdown for "just scouters" could go here if needed later */}
              </div>
            </div>
            <div className="p-3 border-b border-border">
              <Input
                placeholder="Search scouters..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="max-h-80 overflow-y-auto">
              {loadingScouters ? (
                <p className="text-sm text-muted-foreground p-4">Loading scouters...</p>
              ) : filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground p-4">No scouters found.</p>
              ) : (
                <div className="divide-y divide-border">
                  {filtered.map((s) => (
                    <label
                      key={s.uid}
                      className="flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-secondary/40 select-none"
                    >
                      <Checkbox
                        checked={selectedUids.has(s.uid)}
                        onCheckedChange={() => toggleUid(s.uid)}
                      />
                      <span className="text-sm flex-1">{s.name}</span>
                      {s.role === "admin" && (
                        <span className="text-xs text-muted-foreground">admin</span>
                      )}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Bottom 1/3: Work/Rest Ratio and Generate Assignments Button */}
          <div className="flex-1 p-4 rounded-lg bg-card border border-border flex flex-col justify-between">
            <div className="flex items-end gap-4">
              <div className="space-y-1.5">
                <Label>Work (w)</Label>
                <Input
                  type="number"
                  min={1}
                  value={w}
                  onChange={(e) => setW(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-24"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Rest (r)</Label>
                <Input
                  type="number"
                  min={0}
                  value={r}
                  onChange={(e) => setR(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-24"
                />
              </div>
              <p className="text-xs text-muted-foreground pb-2">
                Work {w} match{w !== 1 ? "es" : ""}, rest {r} match{r !== 1 ? "es" : ""}, repeat.
              </p>
            </div>
            <Button
              onClick={handleGenerate}
              disabled={generating || !currentEvent || selectedUids.size === 0}
              className="mt-4"
            >
              {generating ? "Generating..." : "Generate Assignments"}
            </Button>
          </div>
        </div>

        {/* Right Panel - 2/3 width */}
        <div className="flex-2 flex flex-col">
          <div className="flex items-center justify-between pb-4">
            <h2 className="text-xl font-semibold">Match Schedule</h2>
            {isEditingAssignments ? (
              <div className="flex gap-2">
                <Button onClick={() => setIsEditingAssignments(false)} variant="outline" size="sm">
                  Cancel
                </Button>
                <Button onClick={() => setIsEditingAssignments(false)} size="sm">
                  Save
                </Button>
              </div>
            ) : (
              <Button onClick={() => setIsEditingAssignments(true)} variant="outline" size="sm">
                Edit Assignments
              </Button>
            )}
            <button className="p-1.5 rounded hover:bg-secondary text-muted-foreground transition-colors" title="Jump to last completed match">
              {/* <ArrowDown className="w-4 h-4" /> */}
              Jump to Current Match
            </button>
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
                    <span className="text-xs font-semibold text-foreground/80">{getMatchLabel(match.matchKey)}</span>
                    {match.teams.slice(0, 3).map((team: { teamKey: string; teamNumber: number }) => {
                      const assignmentKey = `${match.matchKey}|${team.teamKey}`;
                      const isAssigned = assignedMatchTeams.has(assignmentKey);
                      const scouterName = matchScouterMap[assignmentKey];

                      return (
                        <TooltipProvider key={team.teamKey}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                className={`text-xs text-center ${isAssigned ? "text-yellow-500" : "text-gray-500"} ${isEditingAssignments ? "cursor-pointer" : ""}`}
                                onClick={() => {
                                  if (isEditingAssignments) {
                                    setSelectedMatchKey(match.matchKey);
                                    setSelectedTeamKey(team.teamKey);
                                    setShowScouterPopup(true);
                                  }
                                }}>
                                {team.teamNumber} {isEditingAssignments && "x"}
                              </span>
                            </TooltipTrigger>
                            {isAssigned && scouterName && (
                              <TooltipContent className="bg-black border border-gray-500 text-yellow-400">
                                <p>{scouterName}</p>
                              </TooltipContent>
                            )}
                          </Tooltip>
                        </TooltipProvider>
                      );
                    })}
                    {match.teams.slice(3, 6).map((team: { teamKey: string; teamNumber: number }) => {
                      const assignmentKey = `${match.matchKey}|${team.teamKey}`;
                      const isAssigned = assignedMatchTeams.has(assignmentKey);
                      const scouterName = matchScouterMap[assignmentKey];

                      return (
                        <TooltipProvider key={team.teamKey}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                className={`text-xs text-center ${isAssigned ? "text-yellow-500" : "text-gray-500"} ${isEditingAssignments ? "cursor-pointer" : ""}`}
                                onClick={() => {
                                  if (isEditingAssignments) {
                                    setSelectedMatchKey(match.matchKey);
                                    setSelectedTeamKey(team.teamKey);
                                    setShowScouterPopup(true);
                                  }
                                }}>
                                {team.teamNumber} {isEditingAssignments && "x"}
                              </span>
                            </TooltipTrigger>
                            {isAssigned && scouterName && (
                              <TooltipContent className="bg-black border border-gray-500 text-yellow-400">
                                <p>{scouterName}</p>
                              </TooltipContent>
                            )}
                          </Tooltip>
                        </TooltipProvider>
                      );
                    })}
                    <span className="text-xs text-muted-foreground text-center">
                      {new Date(match.predictedTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

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
                      setMatchScouterMap(prev => {
                        const next = { ...prev };
                        if (selectedMatchKey && selectedTeamKey) {
                          delete next[`${selectedMatchKey}|${selectedTeamKey}`];
                        }
                        return next;
                      });
                      setAssignedMatchTeams(prev => {
                        const next = new Set(prev);
                        if (selectedMatchKey && selectedTeamKey) {
                          next.delete(`${selectedMatchKey}|${selectedTeamKey}`);
                        }
                        return next;
                      });
                      setShowScouterPopup(false);
                    }}>Deselect</Button>
                  </div>
                </div>
              )}
              <p className="text-sm text-muted-foreground mb-2">Available Scouters:</p>
              <div className="divide-y divide-border">
                {allScouters.map((s) => (
                  <button
                    key={s.uid}
                    className="flex items-center gap-3 px-2 py-2 w-full text-left hover:bg-secondary/40"
                    onClick={() => {
                      if (selectedMatchKey && selectedTeamKey) {
                        setMatchScouterMap(prev => ({
                          ...prev,
                          [`${selectedMatchKey}|${selectedTeamKey}`]: s.name,
                        }));
                        setAssignedMatchTeams(prev => {
                          const next = new Set(prev);
                          next.add(`${selectedMatchKey}|${selectedTeamKey}`);
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
