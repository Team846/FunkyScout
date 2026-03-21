import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useTabContext } from "../contexts/TabContext";
import { useDesktopTeamData } from "../contexts/DesktopTeamDataContext";
import { useDesktopCompetitionData } from "../contexts/DesktopCompetitionDataContext";
import { Input } from "@shadcn/ui/components/input.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@shadcn/ui/components/dialog.tsx";

interface TeamPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Returns true if matchKey is a qualification match (e.g. qm1, qm2). */
function isQualificationMatch(matchKey: string): boolean {
  return /_qm\d+/i.test(matchKey);
}

/** Extract the qualification match number from matchKey (e.g. "2026cada_qm10" -> "10"). Returns "" if not a qual match. */
function getQualMatchNumber(matchKey: string): string {
  const m = matchKey.match(/_qm(\d+)/i);
  return m ? m[1]! : "";
}

export function TeamPickerDialog({ open, onOpenChange }: TeamPickerDialogProps) {
  const navigate = useNavigate();
  const { addTab } = useTabContext();
  const { teams } = useDesktopTeamData();
  const { schedule } = useDesktopCompetitionData();
  const [search, setSearch] = useState("");

  const sortedTeams = useMemo(
    () => [...teams].sort((a, b) => a.num - b.num),
    [teams]
  );

  const teamByKey = useMemo(() => {
    const map = new Map<string, (typeof teams)[number]>();
    for (const t of teams) {
      map.set(t.key, t);
    }
    return map;
  }, [teams]);

  const filtered = useMemo(() => {
    if (!search.trim()) return sortedTeams;

    const raw = search.trim();
    const q = raw.toLowerCase();

    // Qualification match search: "qm 1", "qm1", "QM 15", etc.
    const qmMatch = q.match(/^qm\s*(\d+)$/i);
    if (qmMatch) {
      const targetNum = qmMatch[1]!;
      const teamKeys = new Set<string>();
      for (const entry of schedule) {
        if (isQualificationMatch(entry.match) && getQualMatchNumber(entry.match) === targetNum) {
          teamKeys.add(entry.team);
        }
      }
      const result: (typeof teams)[number][] = [];
      for (const key of teamKeys) {
        const t = teamByKey.get(key);
        if (t) result.push(t);
      }
      return result.sort((a, b) => a.num - b.num);
    }

    // Numeric search: show all teams whose team number contains that digit substring
    if (/^\d+$/.test(raw)) {
      return sortedTeams.filter((t) => String(t.num).includes(raw));
    }

    // General search: team name, team key, or team number
    return sortedTeams.filter((t) => {
      const numStr = String(t.num);
      return (
        t.name.toLowerCase().includes(q) ||
        t.key.toLowerCase().includes(q) ||
        numStr.includes(q)
      );
    });
  }, [sortedTeams, schedule, teamByKey, search]);

  const handleSelectTeam = (teamKey: string, teamNum: number) => {
    addTab("/team", `Team ${teamNum}`, { team: teamKey }, `team-${teamKey}`);
    navigate({ to: "/team", search: { team: teamKey } });
    onOpenChange(false);
    setSearch("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] flex flex-col gap-0 p-0 bg-background border-border">
        <DialogHeader className="px-4 pt-4 pb-2 flex-shrink-0 border-b border-border">
          <DialogTitle className="text-base">Go to team</DialogTitle>
          <div className="relative mt-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search by team or QM..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 text-sm"
              autoFocus
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </DialogHeader>
        <div className="flex-1 overflow-auto min-h-0 p-2 max-h-[60vh]">
          <div className="grid gap-1.5">
            {filtered.map((team) => (
              <button
                key={team.key}
                type="button"
                onClick={() => handleSelectTeam(team.key, team.num)}
                className="text-left p-3 rounded-lg border border-border bg-background hover:bg-muted/50 hover:border-primary/50 transition-colors"
              >
                <div className="font-semibold text-primary text-sm">
                  Team {team.num}
                </div>
                {team.name && (
                  <div className="text-xs mt-0.5 text-muted-foreground truncate">
                    {team.name}
                  </div>
                )}
              </button>
            ))}
          </div>
          {filtered.length === 0 && (
            <p className="text-muted-foreground text-sm py-4 text-center">
              {search
                ? "No teams match your search."
                : "No teams found. Select an event with team data."}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

