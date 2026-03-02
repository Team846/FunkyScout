import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useTabContext } from "../contexts/TabContext";
import { useDesktopCompetitionData } from "../contexts/DesktopCompetitionDataContext";
import { getMatchLabel, getMatchSortOrder } from "@lib/utils/match";
import { Input } from "@shadcn/ui/components/input.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@shadcn/ui/components/dialog.tsx";

interface MatchPickerDialogProps {
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

export function MatchPickerDialog({ open, onOpenChange }: MatchPickerDialogProps) {
  const navigate = useNavigate();
  const { addTab } = useTabContext();
  const { schedule } = useDesktopCompetitionData();
  const [search, setSearch] = useState("");

  const matches = useMemo(() => {
    const byMatch = new Map<string, { match: string; red: string[]; blue: string[] }>();
    for (const entry of schedule) {
      const existing = byMatch.get(entry.match);
      if (!existing) {
        byMatch.set(entry.match, {
          match: entry.match,
          red: [],
          blue: [],
        });
      }
      const m = byMatch.get(entry.match)!;
      if (entry.alliance === "red") m.red.push(entry.team);
      else m.blue.push(entry.team);
    }
    return Array.from(byMatch.values())
      .filter((m) => m.red.length > 0 || m.blue.length > 0)
      .sort((a, b) => {
        const oa = getMatchSortOrder(a.match);
        const ob = getMatchSortOrder(b.match);
        for (let i = 0; i < Math.max(oa.length, ob.length); i++) {
          const va = oa[i] ?? 0;
          const vb = ob[i] ?? 0;
          if (va !== vb) return va - vb;
        }
        return 0;
      });
  }, [schedule]);

  const filtered = useMemo(() => {
    if (!search.trim()) return matches;
    const q = search.trim().toLowerCase();

    // When search is only digits: show qualification matches that either
    // (1) have that team (frc{digits}) on red or blue, or
    // (2) have a QM number containing that digit string (e.g. "1" -> QM 1, 10, 11, ...)
    if (/^\d+$/.test(q)) {
      const teamKey = `frc${q}`;
      return matches.filter(
        (m) =>
          isQualificationMatch(m.match) &&
          (m.red.includes(teamKey) ||
            m.blue.includes(teamKey) ||
            getQualMatchNumber(m.match).includes(q))
      );
    }

    // General search: match label or any team contains query
    return matches.filter(
      (m) =>
        getMatchLabel(m.match).toLowerCase().includes(q) ||
        m.red.some((t) => t.toLowerCase().includes(q)) ||
        m.blue.some((t) => t.toLowerCase().includes(q))
    );
  }, [matches, search]);

  const handleSelectMatch = (matchKey: string) => {
    const label = getMatchLabel(matchKey);
    addTab("/matches", label, { match: matchKey }, `match-${matchKey}`);
    navigate({ to: "/matches", search: { match: matchKey } });
    onOpenChange(false);
    setSearch("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] flex flex-col gap-0 p-0 bg-background border-border">
        <DialogHeader className="px-4 pt-4 pb-2 flex-shrink-0 border-b border-border">
          <DialogTitle className="text-base">Go to match</DialogTitle>
          <div className="relative mt-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search by match, team number, or QM number..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 text-sm"
              autoFocus
            />
          </div>
        </DialogHeader>
        <div className="flex-1 overflow-auto min-h-0 p-2 max-h-[60vh]">
          <div className="grid gap-1.5">
            {filtered.map((m) => (
              <button
                key={m.match}
                type="button"
                onClick={() => handleSelectMatch(m.match)}
                className="text-left p-3 rounded-lg border border-border bg-background hover:bg-muted/50 hover:border-primary/50 transition-colors"
              >
                <div className="font-semibold text-primary text-sm">
                  {getMatchLabel(m.match)}
                </div>
                <div className="text-xs mt-1 flex gap-3 text-muted-foreground">
                  <span>
                    <span className="text-red-500 font-medium">Red</span>:{" "}
                    {m.red.map((t) => t.replace("frc", "")).join(", ")}
                  </span>
                  <span>
                    <span className="text-blue-500 font-medium">Blue</span>:{" "}
                    {m.blue.map((t) => t.replace("frc", "")).join(", ")}
                  </span>
                </div>
              </button>
            ))}
          </div>
          {filtered.length === 0 && (
            <p className="text-muted-foreground text-sm py-4 text-center">
              {search
                ? "No matches match your search."
                : "No matches found. Select an event with schedule data."}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
