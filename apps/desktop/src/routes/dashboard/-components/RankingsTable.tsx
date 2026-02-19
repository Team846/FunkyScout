import { useMemo, useState } from "react";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import type { TBATeam } from "../../../contexts/DesktopTeamDataContext";
import type { MatchScoutingData } from "../../../lib/db";
import { calculateAllTeamStats } from "@lib/data/matchStats";
import type { EventMatchData } from "@lib/db";

type SortColumn = "team" | "name" | "rank" | "epa" | "rating" | "climb";
type SortDir = "asc" | "desc";

interface RankingsTableProps {
  tbaTeams: TBATeam[];
  matchData: MatchScoutingData[];
  searchQuery: string;
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

function SortIcon({ column, sortCol, sortDir }: { column: SortColumn; sortCol: SortColumn; sortDir: SortDir }) {
  if (column !== sortCol) return <ArrowUpDown className="w-3 h-3 ml-1 text-muted-foreground/50" />;
  return sortDir === "asc"
    ? <ArrowUp className="w-3 h-3 ml-1 text-primary" />
    : <ArrowDown className="w-3 h-3 ml-1 text-primary" />;
}

export function RankingsTable({ tbaTeams, matchData, searchQuery }: RankingsTableProps) {
  const [sortCol, setSortCol] = useState<SortColumn>("rank");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

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
      return {
        key: t.key,
        team: t.team,
        name: t.name,
        rank: t.rank,
        epa: t.epa?.total_points?.mean ?? null,
        opr: t.opr ?? null,
        rating: stats?.ratings?.overall ?? null,
        climbPct: stats
          ? Math.round((stats.climb.L2Percentage + stats.climb.L3Percentage) * 100)
          : null,
      };
    });
  }, [tbaTeams, allTeamStats]);

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

  // Sort
  const sortedRows = useMemo(() => {
    const sorted = [...filteredRows].sort((a, b) => {
      let valA: number;
      let valB: number;

      switch (sortCol) {
        case "team":
          valA = a.team;
          valB = b.team;
          break;
        case "name":
          return sortDir === "asc"
            ? a.name.localeCompare(b.name)
            : b.name.localeCompare(a.name);
        case "rank":
          valA = a.rank === 0 ? 9999 : a.rank;
          valB = b.rank === 0 ? 9999 : b.rank;
          break;
        case "epa":
          valA = a.epa ?? -1;
          valB = b.epa ?? -1;
          break;
        case "rating":
          valA = a.rating ?? -1;
          valB = b.rating ?? -1;
          break;
        case "climb":
          valA = a.climbPct ?? -1;
          valB = b.climbPct ?? -1;
          break;
        default:
          valA = 0;
          valB = 0;
      }

      return sortDir === "asc" ? valA - valB : valB - valA;
    });
    return sorted;
  }, [filteredRows, sortCol, sortDir]);

  const handleSort = (col: SortColumn) => {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir(col === "rank" ? "asc" : "desc");
    }
  };

  const getEpaClass = (epa: number | null) => {
    if (epa == null) return "";
    if (epa >= q75) return "text-chart-2 font-semibold";
    if (epa <= q25) return "text-chart-5 font-semibold";
    return "text-foreground";
  };

  const COLS: { key: SortColumn; label: string; className?: string }[] = [
    { key: "team", label: "Team" },
    { key: "name", label: "Name", className: "flex-1" },
    { key: "rank", label: "Rank" },
    { key: "epa", label: "EPA" },
    { key: "rating", label: "Avg Rating" },
    { key: "climb", label: "Climb %" },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="grid grid-cols-[80px_1fr_60px_80px_90px_80px] gap-0 px-3 py-2 border-b border-border bg-card/50 flex-shrink-0">
        {COLS.map((col) => (
          <button
            key={col.key}
            onClick={() => handleSort(col.key)}
            className={[
              "flex items-center text-xs font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors",
              col.key === "name" ? "" : "justify-end",
              sortCol === col.key ? "text-primary" : "",
            ].join(" ")}
          >
            {col.key === "name" ? (
              <>
                {col.label}
                <SortIcon column={col.key} sortCol={sortCol} sortDir={sortDir} />
              </>
            ) : (
              <>
                <SortIcon column={col.key} sortCol={sortCol} sortDir={sortDir} />
                {col.label}
              </>
            )}
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
          sortedRows.map((row) => (
            <div
              key={row.key}
              className="grid grid-cols-[80px_1fr_60px_80px_90px_80px] gap-0 items-center px-3 py-2 border-b border-border/50 hover:bg-secondary/20 transition-colors"
            >
              {/* Team chip */}
              <div>
                <span
                  className={[
                    "inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-secondary/60 text-foreground",
                  ].join(" ")}
                >
                  {row.team}
                </span>
              </div>

              {/* Name */}
              <span className="text-xs text-foreground truncate pr-4">{row.name}</span>

              {/* Rank */}
              <span className="text-xs text-right text-muted-foreground">
                {row.rank > 0 ? `#${row.rank}` : "—"}
              </span>

              {/* EPA */}
              <span className={`text-xs text-right ${getEpaClass(row.epa)}`}>
                {row.epa != null ? row.epa.toFixed(1) : "—"}
              </span>

              {/* Avg Rating */}
              <span className="text-xs text-right text-muted-foreground">
                {row.rating != null ? row.rating.toFixed(1) : "—"}
              </span>

              {/* Climb % */}
              <span className="text-xs text-right text-muted-foreground">
                {row.climbPct != null ? `${row.climbPct}%` : "—"}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
