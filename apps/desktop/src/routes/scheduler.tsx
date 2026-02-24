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
import { invoke } from "@tauri-apps/api/core";

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

interface PitAssignment {
  teamKey: string;
  teamNumber: number;
  teamName: string | null;
  uid: string;
  name: string;
}

function SchedulerPage() {
  const { currentEvent } = useDesktopEvent();
  const [w, setW] = useState(3);
  const [r, setR] = useState(1);
  const [assignments, setAssignments] = useState<CycleAssignment[]>([]);
  const [generating, setGenerating] = useState(false);
  const [applying, setApplying] = useState(false);

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
      // Only initialize selection if there's no saved state (first visit)
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
      toast.success(`Generated ${result.length} assignments`);
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
      toast.success(`Applied ${assignments.length} shift assignments`);
    } catch (e: any) {
      toast.error(`Failed to apply: ${e.message ?? String(e)}`);
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
      // Round-robin assignment
      const result: PitAssignment[] = teams.map((t, i) => {
        const scouter = selected[i % selected.length];
        const teamNum = parseInt(t.team.replace("frc", ""), 10);
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
      toast.success(`Applied ${pitAssignments.length} team assignments`);
    } catch (e: any) {
      toast.error(`Failed to apply team assignments: ${e.message ?? String(e)}`);
    } finally {
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
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Scheduler</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Assign scouters to qual matches using the work/rest cycle algorithm.
          </p>
        </div>

        {/* Config row */}
        <div className="flex items-end gap-4 p-4 rounded-lg bg-card border border-border">
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
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              onClick={handleScheduleTeams}
              disabled={schedulingTeams || !currentEvent || selectedUids.size === 0}
            >
              {schedulingTeams ? "Scheduling..." : "Schedule Teams"}
            </Button>
            <Button
              onClick={handleGenerate}
              disabled={generating || !currentEvent || selectedUids.size === 0}
            >
              {generating ? "Generating..." : "Generate Shifts"}
            </Button>
          </div>
        </div>

        {/* Scouter selection */}
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Scouters</span>
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
          <div className="max-h-48 overflow-y-auto">
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

        {/* No event selected */}
        {!currentEvent && (
          <p className="text-sm text-muted-foreground">Select an event to use the scheduler.</p>
        )}

        {/* Pit team assignments */}
        {pitAssignments.length > 0 && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {pitAssignments.length} teams across {Object.keys(pitByUid).length} scouters
              </p>
              <Button onClick={handleApplyTeams} disabled={applyingTeams}>
                {applyingTeams ? "Applying..." : "Apply Team Assignments"}
              </Button>
            </div>

            <div className="space-y-3">
              {Object.entries(pitByUid).map(([uid, rows]) => (
                <div
                  key={uid}
                  className="rounded-lg border border-border bg-card overflow-hidden"
                >
                  <div className="px-4 py-2 bg-secondary/50 border-b border-border flex items-center gap-2">
                    <span className="text-sm font-medium">{rows[0]?.name || uid}</span>
                    <span className="text-xs text-muted-foreground">
                      ({rows.length} team{rows.length !== 1 ? "s" : ""})
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 p-3">
                    {rows
                      .sort((a, b) => a.teamNumber - b.teamNumber)
                      .map((a) => (
                        <div
                          key={a.teamKey}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-secondary text-xs"
                          title={a.teamName ?? a.teamKey}
                        >
                          <span className="font-medium text-foreground">{a.teamNumber}</span>
                          {a.teamName && (
                            <span className="text-muted-foreground max-w-[120px] truncate">
                              {a.teamName}
                            </span>
                          )}
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Shift assignment results */}
        {assignments.length > 0 && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {assignments.length} assignments across {Object.keys(byUid).length} scouters
              </p>
              <Button onClick={handleApply} disabled={applying}>
                {applying ? "Applying..." : "Apply Shift Assignments"}
              </Button>
            </div>

            <div className="space-y-3">
              {Object.entries(byUid).map(([uid, rows]) => (
                <div
                  key={uid}
                  className="rounded-lg border border-border bg-card overflow-hidden"
                >
                  <div className="px-4 py-2 bg-secondary/50 border-b border-border flex items-center gap-2">
                    <span className="text-sm font-medium">{rows[0]?.name || uid}</span>
                    <span className="text-xs text-muted-foreground">
                      ({rows.length} match{rows.length !== 1 ? "es" : ""})
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 p-3">
                    {rows
                      .sort((a, b) => a.matchKey.localeCompare(b.matchKey))
                      .map((a) => (
                        <div
                          key={`${a.matchKey}|${a.teamKey}`}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-secondary text-xs"
                        >
                          <span className="font-medium text-muted-foreground">
                            {getMatchLabel(a.matchKey)}
                          </span>
                          <span className="text-foreground">
                            {a.teamKey?.replace("frc", "")}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
