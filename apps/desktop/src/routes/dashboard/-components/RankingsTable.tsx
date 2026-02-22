import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { TBATeam } from "../../../contexts/DesktopTeamDataContext";
import type { MatchScoutingData } from "../../../lib/db";
import { calculateAllTeamStats } from "@lib/data/matchStats";
import type { EventMatchData } from "@lib/db";
import type { TbaClimbEntry } from "../../../contexts/DesktopCompetitionDataContext";
import { computeClimbWithTba } from "../../../utils/climbOverride";

type SortColumn = "rank" | "epa" | "rating" | "climb";

interface RankingsTableProps {
  tbaTeams: TBATeam[];
  matchData: MatchScoutingData[];
  searchQuery: string;
  tbaClimbData?: Record<string, Record<string, TbaClimbEntry>>;
  useTbaClimb?: boolean;
  homeTeamKey?: string;
}

interface TeamRow {
  key: string;
  team: number;
  name: string;
  rank: number;
  epa: number | null;
  opr: number | null;
  rating: number | null;
  climbPct: number | null;
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

export function RankingsTable({ tbaTeams, matchData, searchQuery, tbaClimbData, useTbaClimb, homeTeamKey }: RankingsTableProps) {
  const [sortCol, setSortCol] = useState<SortColumn>("rank");

  const { q25, q75 } = useEpaColors(tbaTeams);

  // Precompute all team stats from match scouting data
  const allTeamStats = useMemo(() => {
    if (matchData.length === 0) return {};
    // Cast MatchScoutingData to EventMatchData for calculateAllTeamStats
    return calculateAllTeamStats(matchData as unknown as EventMatchData[]);
  }, [matchData]);

  // Build table rows
  const rows: TeamRow[] = useMemo(() => {
    const castMatchData = matchData as unknown as EventMatchData[];
    return tbaTeams.map((t) => {
      const stats = allTeamStats[t.key];

      // Determine climb percentage: use TBA override if enabled and data available
      let climbPct: number | null = null;
      if (stats) {
        if (useTbaClimb && tbaClimbData && Object.keys(tbaClimbData).length > 0) {
          const tbaClimb = computeClimbWithTba(t.key, castMatchData, tbaClimbData);
          climbPct = Math.round(tbaClimb.L2Percentage + tbaClimb.L3Percentage);
        } else {
          // Bug fix: values are already 0-100, do NOT multiply by 100
          climbPct = Math.round(stats.climb.L2Percentage + stats.climb.L3Percentage);
        }
      }

      return {
        key: t.key,
        team: t.team,
        name: t.name,
        rank: t.rank,
        epa: t.epa?.total_points?.mean ?? null,
        opr: t.opr ?? null,
        rating: stats?.ratings?.overall ?? null,
        climbPct,
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
          valA = a.climbPct ?? -1;
          valB = b.climbPct ?? -1;
          return valB - valA; // Descending - higher climb % is better
        default:
          return 0;
      }
    });
    return sorted;
  }, [filteredRows, sortCol]);

  const handleSort = (col: SortColumn) => {
    setSortCol(col);
  };

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
    { key: "climb", label: "Climb %" },
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
      <div className="flex-1 overflow-y-auto">
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
                className="grid grid-cols-[100px_1fr_80px_80px_100px_90px] gap-0 items-center px-8 py-3 border-b border-border/50 hover:bg-secondary/20 transition-colors"
              >
                {/* Team chip */}
                <div className="flex justify-center">
                  <span className="inline-flex items-center justify-center min-w-[48px] px-2.5 py-1 rounded text-sm font-bold bg-background text-primary tabular-nums">
                    {row.team}
                  </span>
                </div>

                {/* Name */}
                <span className={`text-sm truncate pl-6 pr-4 ${isHomeTeam ? "text-primary font-semibold" : "text-foreground"}`}>
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

                {/* Climb % */}
                <span className="text-sm text-center text-muted-foreground">
                  {row.climbPct != null ? `${row.climbPct}%` : "—"}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
