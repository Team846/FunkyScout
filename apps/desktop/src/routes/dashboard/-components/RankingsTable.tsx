import { useMemo, useState, useRef, useImperativeHandle, forwardRef } from "react";
import { ChevronDown } from "lucide-react";

export interface RankingsTableHandle {
  scrollToTeam: (teamKey: string) => void;
}
import type { TBATeam } from "../../../contexts/DesktopTeamDataContext";
import type { MatchScoutingData } from "../../../lib/db";
import { calculateAllTeamStats } from "@lib/data/matchStats";
import type { EventMatchData } from "@lib/db";
import type { TbaClimbEntry } from "../../../contexts/DesktopCompetitionDataContext";

type SortColumn = "rank" | "epa" | "rating" | "climb";

interface RankingsTableProps {
  tbaTeams: TBATeam[];
  matchData: MatchScoutingData[];
  searchQuery: string;
  tbaClimbData?: Record<string, Record<string, TbaClimbEntry>>;
  useTbaClimb?: boolean;
  homeTeamKey?: string;
  onTeamClick?: (teamKey: string) => void;
}

interface TeamRow {
  key: string;
  team: number;
  name: string;
  rank: number;
  epa: number | null;
  opr: number | null;
  rating: number | null;
  avgClimbPts: number | null;
}

function useEpaColors(tbaTeams: TBATeam[]) {
  return useMemo(() => {
    const epas = tbaTeams
      .map((t) => t.epa?.total_points?.mean)
      .filter((e): e is number => e != null && e > 0)
      .sort((a, b) => a - b);
    if (epas.length < 4) return { q25: -Infinity, q75: Infinity };
    return {
      q25: epas[Math.floor(epas.length * 0.25)],
      q75: epas[Math.floor(epas.length * 0.75)],
    };
  }, [tbaTeams]);
}

export const RankingsTable = forwardRef<RankingsTableHandle, RankingsTableProps>(
  function RankingsTable({ tbaTeams, matchData, searchQuery, tbaClimbData, useTbaClimb, homeTeamKey, onTeamClick }, ref) {
  const [sortCol, setSortCol] = useState<SortColumn>("rank");
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const { q25, q75 } = useEpaColors(tbaTeams);

  // Precompute all team stats from match scouting data
  const allTeamStats = useMemo(() => {
    if (matchData.length === 0) return {};
    // Cast MatchScoutingData to EventMatchData for calculateAllTeamStats
    return calculateAllTeamStats(matchData as unknown as EventMatchData[]);
  }, [matchData]);

  // Build table rows
  const rows: TeamRow[] = useMemo(() => {
    return tbaTeams.map((t) => {
      const stats = allTeamStats[t.key];

      // Compute avg climb points matching the graph (GRAPHABLE_STATS avg_climb_points):
      // Iterate TBA climb entries directly so denominator = all TBA matches (not just scouted)
      let avgClimbPts: number | null = null;
      if (useTbaClimb && tbaClimbData && Object.keys(tbaClimbData).length > 0) {
        let totalPts = 0;
        let count = 0;
        for (const matchEntries of Object.values(tbaClimbData)) {
          const entry = matchEntries[t.key];
          if (entry !== undefined) {
            let pts = entry.auto_climb != null ? 15 : 0;
            if (entry.teleop_climb === "L1") pts += 10;
            else if (entry.teleop_climb === "L2") pts += 20;
            else if (entry.teleop_climb === "L3") pts += 30;
            totalPts += pts;
            count++;
          }
        }
        if (count > 0) avgClimbPts = totalPts / count;
      } else if (stats) {
        // Fall back to scouted stats
        avgClimbPts =
          (stats.climb.autoClimbPercentage / 100 * 15) +
          (stats.climb.L1Percentage / 100 * 10) +
          (stats.climb.L2Percentage / 100 * 20) +
          (stats.climb.L3Percentage / 100 * 30);
      }

      return {
        key: t.key,
        team: t.team,
        name: t.name,
        rank: t.rank,
        epa: t.epa?.total_points?.mean ?? null,
        opr: t.opr ?? null,
        rating: stats?.ratings?.overall ?? null,
        avgClimbPts,
      };
    });
  }, [tbaTeams, allTeamStats, matchData, useTbaClimb, tbaClimbData]);

  // Search filter
  const filteredRows = useMemo(() => {
    if (!searchQuery.trim()) return rows;
    const q = searchQuery.toLowerCase();
    return rows.filter(
      (r) =>
        String(r.team).includes(q) ||
        r.name.toLowerCase().includes(q)
    );
  }, [rows, searchQuery]);

  // Sort - rank is ascending (1 is best), others are descending (higher is better)
  const sortedRows = useMemo(() => {
    const sorted = [...filteredRows].sort((a, b) => {
      let valA: number;
      let valB: number;

      switch (sortCol) {
        case "rank":
          valA = a.rank === 0 ? 9999 : a.rank;
          valB = b.rank === 0 ? 9999 : b.rank;
          return valA - valB; // Ascending - lower rank is better
        case "epa":
          valA = a.epa ?? -1;
          valB = b.epa ?? -1;
          return valB - valA; // Descending - higher EPA is better
        case "rating":
          valA = a.rating ?? -1;
          valB = b.rating ?? -1;
          return valB - valA; // Descending - higher rating is better
        case "climb":
          valA = a.avgClimbPts ?? -1;
          valB = b.avgClimbPts ?? -1;
          return valB - valA; // Descending - higher avg climb pts is better
        default:
          return 0;
      }
    });
    return sorted;
  }, [filteredRows, sortCol]);

  const handleSort = (col: SortColumn) => {
    setSortCol(col);
  };

  useImperativeHandle(ref, () => ({
    scrollToTeam: (teamKey: string) => {
      if (!scrollContainerRef.current || !teamKey) return;
      const container = scrollContainerRef.current;
      const targetRow = container.querySelector(`[data-team-row="${teamKey}"]`) as HTMLElement;
      if (targetRow) {
        targetRow.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    },
  }), []);

  const getEpaClass = (epa: number | null) => {
    if (epa == null) return "text-muted-foreground";
    if (epa >= q75) return "text-chart-2 font-semibold";
    if (epa <= q25) return "text-chart-5 font-semibold";
    return "text-foreground";
  };

  const SORTABLE_COLS: { key: SortColumn; label: string }[] = [
    { key: "rank", label: "Rank" },
    { key: "epa", label: "EPA" },
    { key: "rating", label: "Avg Rating" },
    { key: "climb", label: "Climb Pts" },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="grid grid-cols-[100px_1fr_80px_80px_100px_90px] gap-0 px-8 py-3 border-b border-border bg-card/50 flex-shrink-0">
        {/* Team - not sortable */}
        <span className="flex items-center justify-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Team
        </span>
        {/* Name - not sortable */}
        <span className="flex items-center text-xs font-semibold text-muted-foreground uppercase tracking-wide pl-6">
          Name
        </span>
        {/* Sortable columns */}
        {SORTABLE_COLS.map((col) => (
          <button
            key={col.key}
            onClick={() => handleSort(col.key)}
            className={[
              "flex items-center justify-center gap-1 text-xs font-semibold uppercase tracking-wide hover:text-foreground transition-colors",
              sortCol === col.key ? "text-primary" : "text-muted-foreground",
            ].join(" ")}
          >
            {col.label}
            {sortCol === col.key && <ChevronDown className="w-3 h-3" />}
          </button>
        ))}
      </div>

      {/* Scrollable rows */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        {sortedRows.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
            {searchQuery ? "No teams found" : "No team data"}
          </div>
        ) : (
          sortedRows.map((row) => {
            const isHomeTeam = row.key === homeTeamKey;
            return (
              <div
                key={row.key}
                data-team-row={row.key}
                className="grid grid-cols-[100px_1fr_80px_80px_100px_90px] gap-0 items-center px-8 py-3 border-b border-border/50 hover:bg-secondary/20 transition-colors"
              >
                {/* Team chip */}
                <div className="flex justify-center">
                  <span
                    onClick={onTeamClick ? () => onTeamClick(row.key) : undefined}
                    className={[
                      "inline-flex items-center justify-center min-w-[48px] px-2.5 py-1 rounded text-sm font-bold bg-background text-primary tabular-nums transition-colors",
                      onTeamClick ? "cursor-pointer hover:bg-primary/15 hover:ring-1 hover:ring-primary/50" : "",
                    ].join(" ")}
                  >
                    {row.team}
                  </span>
                </div>

                {/* Name */}
                <span
                  onClick={onTeamClick ? () => onTeamClick(row.key) : undefined}
                  className={[
                    `text-sm truncate pl-6 pr-4 transition-colors`,
                    isHomeTeam ? "text-primary font-semibold" : "text-foreground",
                    onTeamClick ? "cursor-pointer hover:text-primary" : "",
                  ].join(" ")}
                >
                  {row.name}
                </span>

                {/* Rank */}
                <span className="text-sm text-center text-muted-foreground">
                  {row.rank > 0 ? `#${row.rank}` : "—"}
                </span>

                {/* EPA */}
                <span className={`text-sm text-center ${getEpaClass(row.epa)}`}>
                  {row.epa != null ? row.epa.toFixed(1) : "—"}
                </span>

                {/* Avg Rating */}
                <span className="text-sm text-center text-muted-foreground">
                  {row.rating != null ? row.rating.toFixed(1) : "—"}
                </span>

                {/* Avg Climb Pts */}
                <span className="text-sm text-center text-muted-foreground">
                  {row.avgClimbPts != null ? row.avgClimbPts.toFixed(1) : "—"}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
});
