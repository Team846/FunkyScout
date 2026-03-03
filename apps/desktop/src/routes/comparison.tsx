import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTabContext } from "../contexts/TabContext";
import { useState, useMemo } from "react";
import {
  X,
  Search,
  Plus,
  Eye,
  EyeOff,
  Maximize2,
  BarChart2,
  RefreshCw,
  ArrowRight,
  Check,
} from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@shadcn/ui/components/command.tsx";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@shadcn/ui/components/popover.tsx";
import { Input } from "@shadcn/ui/components/input.tsx";
import { useDesktopEvent } from "../contexts/DesktopEventContext";
import { useDesktopCompetitionData } from "../contexts/DesktopCompetitionDataContext";
import type { TbaClimbEntry, MatchScoutingData } from "../contexts/DesktopCompetitionDataContext";
import { useDesktopTeamData } from "../contexts/DesktopTeamDataContext";
import type { TBATeam } from "../contexts/DesktopTeamDataContext";
import {
  GRAPHABLE_STATS,
  getStatDataPoints,
  getTbaStatDataPoints,
} from "@lib/data/matchStats";
import { MetricPicker, ALL_GRAPH_METRICS } from "../components/MetricPicker";
import {
  getTeamNum,
  FullTeamPanel,
} from "../components/TeamPanelShared";

export const Route = createFileRoute("/comparison")({
  component: ComparisonPage,
  validateSearch: (search: Record<string, unknown>) => ({
    teams: (search.teams as string) || "",
  }),
});

// ─── Module-level UI state persistence (survives tab navigation) ─────────────

interface ComparisonUIState {
  displayTeams: string[];
  graphTeams: string[];
  comparisonMetrics: string[];
  graphMetrics: string[];
}
let _compUIState: ComparisonUIState | null = null;

// ─── Constants ───────────────────────────────────────────────────────────────

const TBA_SORT_OPTIONS = [
  { key: "rank", label: "Event Rank", group: "TBA" },
  { key: "epa", label: "EPA", group: "TBA" },
  { key: "opr", label: "OPR", group: "TBA" },
];

const ALL_SORT_OPTIONS = [
  ...TBA_SORT_OPTIONS,
  ...GRAPHABLE_STATS.map((s) => ({ key: s.key, label: s.label, group: s.group })),
];

const DEFAULT_COMP_METRICS = [
  "epa",
  "avg_fuel_points",
  "avg_climb_points",
  "rating_overall",
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getTeamStatAvg(
  statKey: string,
  teamKey: string,
  matchScoutingData: MatchScoutingData[]
): number {
  const pts = getStatDataPoints(
    statKey,
    matchScoutingData.filter((m) => m.team === teamKey) as any
  );
  if (!pts.length) return 0;
  return pts.reduce((s, p) => s + p.raw, 0) / pts.length;
}

function computeGraphData(
  metricKey: string,
  teams: string[],
  matchScoutingData: MatchScoutingData[],
  tbaTeams: TBATeam[],
  tbaClimbData: Record<string, Record<string, TbaClimbEntry>>
): { raws: (number | null)[]; normalized: number[]; winnerIdx: number } {
  const stat = GRAPHABLE_STATS.find((s) => s.key === metricKey);

  const getRaw = (teamKey: string): number | null => {
    if (metricKey === "epa")
      return tbaTeams.find((t) => t.key === teamKey)?.epa?.total_points?.mean ?? null;
    if (metricKey === "opr")
      return tbaTeams.find((t) => t.key === teamKey)?.opr ?? null;
    if (stat?.source === "tba") {
      const epa = tbaTeams.find((t) => t.key === teamKey)?.epa?.total_points?.mean ?? null;
      const pts = getTbaStatDataPoints(metricKey, teamKey, tbaClimbData, epa);
      if (!pts.length) return null;
      return pts.reduce((s, p) => s + p.raw, 0) / pts.length;
    }
    const pts = getStatDataPoints(metricKey, matchScoutingData.filter((m) => m.team === teamKey) as any);
    if (!pts.length) return null;
    return pts.reduce((s, p) => s + p.raw, 0) / pts.length;
  };

  const raws = teams.map(getRaw);
  const nonNullRaws = raws.filter((r): r is number => r !== null);
  const max = Math.max(...nonNullRaws, 0.001);
  const normalized = raws.map((r) => {
    if (r === null) return 0;
    return stat && metricKey !== "epa" && metricKey !== "opr"
      ? stat.normalize(r, nonNullRaws)
      : r / max;
  });
  const winnerIdx = nonNullRaws.length > 0 ? raws.indexOf(Math.max(...nonNullRaws)) : -1;
  return { raws, normalized, winnerIdx };
}

// ─── ComparisonSidebarCard ───────────────────────────────────────────────────

interface ComparisonSidebarCardProps {
  tbaTeam: TBATeam;
  isDisplayed: boolean;
  isGraphed: boolean;
  onCardClick: () => void;
  onGraphToggle: (e: React.MouseEvent) => void;
  onTeamExpand?: () => void;
}

function ComparisonSidebarCard({
  tbaTeam,
  isDisplayed,
  isGraphed,
  onCardClick,
  onGraphToggle,
  onTeamExpand,
}: ComparisonSidebarCardProps) {
  const teamNum = getTeamNum(tbaTeam.key);
  const teamName = tbaTeam.name ?? tbaTeam.key;
  const epa = tbaTeam.epa?.total_points?.mean;

  return (
    <div
      onClick={onCardClick}
      className={[
        "flex items-stretch rounded-lg border overflow-hidden select-none cursor-pointer transition-all",
        isDisplayed
          ? "border-primary"
          : "border-border/60 hover:border-muted-foreground",
      ].join(" ")}
    >
      <div className="flex-1 px-3 py-3 bg-card min-w-0">
        {/* Row 1: TBA rank | name | team number */}
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold text-primary w-5 text-center flex-shrink-0">
            #{tbaTeam.rank ?? "—"}
          </span>
          <div className="w-px h-4 bg-muted-foreground/50 flex-shrink-0" />
          <span className="text-sm font-medium text-foreground/80 flex-1 truncate">
            {teamName}
          </span>
          <span className="text-sm text-primary flex-shrink-0">{teamNum}</span>
        </div>
        {/* Row 2: graph button (wider) | expand | EPA: [bubble] */}
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={onGraphToggle}
            className={[
              "px-2.5 h-8 flex items-center justify-center rounded transition-colors flex-shrink-0",
              isGraphed
                ? "text-primary drop-shadow-[0_0_4px_hsl(var(--primary))]"
                : "text-muted-foreground/50 hover:text-muted-foreground",
            ].join(" ")}
            title={isGraphed ? "Remove from graph" : "Add to graph"}
          >
            <BarChart2 className="w-5 h-5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onTeamExpand?.(); }}
            className="rounded text-muted-foreground/50 hover:text-muted-foreground transition-colors flex-shrink-0 p-0.5"
            title="Open team page"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-1.5 ml-auto flex-shrink-0">
            <span className="text-xs text-muted-foreground/60">EPA:</span>
            <span className="px-1.5 h-5 rounded-full bg-primary text-background text-xs font-base tabular-nums flex items-center justify-center">
              {epa != null ? epa.toFixed(1) : "—"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ComparisonBox ───────────────────────────────────────────────────────────

interface ComparisonBoxProps {
  metricKey: string;
  teamA: string | undefined;
  teamB: string | undefined;
  matchData: MatchScoutingData[];
  tbaTeams: TBATeam[];
  tbaClimbData: Record<string, Record<string, TbaClimbEntry>>;
  onSwitch: () => void;
}

function ComparisonBox({
  metricKey,
  teamA,
  teamB,
  matchData,
  tbaTeams,
  tbaClimbData,
  onSwitch,
}: ComparisonBoxProps) {
  const label = ALL_GRAPH_METRICS.find((m) => m.key === metricKey)?.label ?? metricKey;
  const teams = [teamA, teamB].filter((t): t is string => !!t);

  const { raws } = useMemo(
    () => computeGraphData(metricKey, teams, matchData, tbaTeams, tbaClimbData),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [metricKey, teams.join(","), matchData.length, tbaTeams.length, tbaClimbData]
  );

  const a = raws[0] ?? null;
  const b = raws[1] ?? null;

  let winner: "a" | "b" | null = null;
  let pctDiff: number | null = null;
  if (a != null && b != null) {
    if (a > b) {
      winner = "a";
      pctDiff = a > 0 ? ((a - b) / a) * 100 : 0;
    } else if (b > a) {
      winner = "b";
      pctDiff = b > 0 ? ((b - a) / b) * 100 : 0;
    } else {
      pctDiff = 0;
    }
  }

  return (
    <div
      className={[
        "w-[120px] h-[120px] flex-shrink-0 rounded-xl border bg-card pt-5 pb-5 px-2 relative flex flex-col justify-between items-center",
        "border-border/70",
      ].join(" ")}
    >
      {/* Switch icon - absolutely positioned so it doesn't affect label centering */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onSwitch();
        }}
        className="absolute bottom-2.5 right-2.5 text-muted-foreground/70 hover:text-muted-foreground transition-colors z-10"
        title="Switch metric"
      >
        <RefreshCw className="w-3 h-3" />
      </button>
      {/* Stat label - centered, foreground text */}
      <div className="text-xs font-semibold text-foreground text-center w-full leading-tight">
        {label}
      </div>
      {/* Values: A — B */}
      <div className="flex items-center justify-center gap-1">
        <span
          className={[
            "text-xs font-medium tabular-nums transition-all",
            winner === "a"
              ? "text-primary ring-1 ring-primary/80 ring-offset-1 ring-offset-card rounded-sm px-1"
              : "text-foreground/80",
          ].join(" ")}
        >
          {a?.toFixed(1) ?? "—"}
        </span>
        <span className="text-muted-foreground/60 text-[10px]">-</span>
        <span
          className={[
            "text-xs font-medium tabular-nums transition-all",
            winner === "b"
              ? "text-primary ring-1 ring-primary/80 ring-offset-1 ring-offset-card rounded-sm px-1"
              : "text-foreground/60",
          ].join(" ")}
        >
          {b?.toFixed(1) ?? "—"}
        </span>
      </div>
      {/* Percent centered; arrows positioned independently (absolute) so they don't shift it */}
      <div className="relative flex items-center justify-center w-full min-h-[14px]">
        {winner === "a" && (
          <span className="absolute left-5 text-primary text-xl">←</span>
        )}
        <span
          className={[
            "text-xs tabular-nums",
            pctDiff != null && winner !== null ? "text-primary" : "text-muted-foreground/70",
          ].join(" ")}
        >
          {pctDiff != null ? `${pctDiff.toFixed(0)}%` : "—"}
        </span>
        {winner === "b" && (
          <span className="absolute right-5 text-primary text-xl">→</span>
        )}
      </div>
    </div>
  );
}

// ─── GraphCard ───────────────────────────────────────────────────────────────

const BAR_HEIGHT_PX = 80;

interface GraphCardProps {
  metricKey: string;
  teams: string[];
  matchData: MatchScoutingData[];
  tbaTeams: TBATeam[];
  tbaClimbData: Record<string, Record<string, TbaClimbEntry>>;
  showPercentiles: boolean;
  onTogglePercentiles: () => void;
  onRemove: () => void;
}

function GraphCard({
  metricKey,
  teams,
  matchData,
  tbaTeams,
  tbaClimbData,
  showPercentiles,
  onTogglePercentiles,
  onRemove,
}: GraphCardProps) {
  const label = ALL_GRAPH_METRICS.find((m) => m.key === metricKey)?.label ?? metricKey;

  const { raws, normalized, winnerIdx } = useMemo(
    () => computeGraphData(metricKey, teams, matchData, tbaTeams, tbaClimbData),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [metricKey, teams.join(","), matchData.length, tbaTeams.length, tbaClimbData]
  );

  const maxBarHeight = BAR_HEIGHT_PX * 0.8;
  const barWidth = teams.length <= 2 ? 70 : teams.length === 3 ? 55 : 45;

  return (
    <div className="w-[280px] flex-shrink-0 border border-border rounded-lg bg-card flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0">
        <span className="text-sm font-medium text-foreground flex-1 truncate">{label}</span>
        <button
          onClick={onRemove}
          className="p-0.5 rounded-sm border border-destructive/50 text-destructive hover:bg-destructive/10 transition-colors flex-shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
        <button
          onClick={onTogglePercentiles}
          className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
        >
          {showPercentiles ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
        </button>
      </div>

      <div
        className="flex items-end justify-around px-3 pb-2 pt-1 flex-1 min-h-0 overflow-hidden"
        style={{ gap: teams.length <= 2 ? "8px" : teams.length === 3 ? "6px" : "4px" }}
      >
        {teams.length === 0 ? (
          <span className="text-xs text-muted-foreground self-center">
            Toggle graph on team cards to compare
          </span>
        ) : (
          teams.map((teamKey, i) => {
            const rawVal = raws[i];
            const isWinner = i === winnerIdx && rawVal != null && rawVal > 0;
            const normalizedVal = normalized[i] ?? 0;
            const barH = Math.max(4, Math.round(normalizedVal * maxBarHeight));
            const teamNum = getTeamNum(teamKey);
            const percentile = Math.round(normalizedVal * 100);
            const showPercentileInside = normalizedVal >= 0.25;

            return (
              <div
                key={teamKey}
                className="flex flex-col items-center min-w-0"
                style={{ width: `${barWidth}px`, flexShrink: 0 }}
              >
                <div className="flex flex-col items-center justify-end flex-1 min-h-0">
                  {showPercentiles && !showPercentileInside && (
                    <div className="flex flex-col items-center leading-none">
                      <span className="text-[9px] text-muted-foreground/70 font-medium">
                        {percentile}%
                      </span>
                      <span className="text-[8px] text-muted-foreground/70">↓</span>
                    </div>
                  )}
                  <div
                    style={{ height: `${barH}px`, width: `${barWidth}px` }}
                    className={[
                      "rounded-sm transition-all relative flex items-center justify-center flex-shrink-0",
                      isWinner ? "bg-primary" : "bg-primary/80",
                    ].join(" ")}
                  >
                    {showPercentiles && showPercentileInside && (
                      <span className="text-[9px] font-medium text-background/70">
                        {percentile}%
                      </span>
                    )}
                  </div>
                </div>
                <span
                  className={[
                    "text-[11px] font-medium mt-1 flex-shrink-0",
                    isWinner ? "text-primary" : "text-muted-foreground",
                  ].join(" ")}
                >
                  {rawVal == null ? "—" : rawVal === 0 ? "0" : rawVal.toFixed(1)}
                </span>
                <span className="text-[11px] font-semibold text-foreground truncate w-full text-center flex-shrink-0">
                  {teamNum}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── ComparisonPage ───────────────────────────────────────────────────────────

function ComparisonPage() {
  const navigate = useNavigate();
  const { teams: teamsParam } = Route.useSearch();
  const { tabs, setActiveTab, addTab } = useTabContext();
  const { useTbaClimb } = useDesktopEvent();
  const { tbaClimbData, matchScoutingData } = useDesktopCompetitionData();
  const { tbaTeams, pitScoutingData } = useDesktopTeamData();

  // ── State ──
  // If navigated here with ?teams=frcXXX,frcYYY, use those as initial display teams
  const [displayTeams, setDisplayTeams] = useState<string[]>(() => {
    if (teamsParam) {
      const fromParam = teamsParam.split(",").filter(Boolean).slice(0, 2);
      if (fromParam.length > 0) return fromParam;
    }
    return _compUIState?.displayTeams ?? [];
  });
  const [graphTeams, setGraphTeams] = useState<string[]>(
    () => _compUIState?.graphTeams ?? []
  );
  const [compMetrics, setCompMetrics] = useState<string[]>(
    () => _compUIState?.comparisonMetrics ?? DEFAULT_COMP_METRICS
  );
  const [graphMetrics, setGraphMetrics] = useState<string[]>(
    () => _compUIState?.graphMetrics ?? []
  );
  const [showCompPickerFor, setShowCompPickerFor] = useState<number | null>(null);
  const [showGraphPicker, setShowGraphPicker] = useState(false);
  const [statOverviewMetric, setStatOverviewMetric] = useState("overview");
  const [showPercentiles, setShowPercentiles] = useState<Record<string, boolean>>({});
  const [searchTeam, setSearchTeam] = useState("");
  const [sortKey, setSortKey] = useState("rank");
  const [sortOpen, setSortOpen] = useState(false);
  // Persist UI state synchronously on every render so a tab switch mid-flight
  // never reads stale data (useEffect fires after paint, too late if unmounting).
  _compUIState = { displayTeams, graphTeams, comparisonMetrics: compMetrics, graphMetrics };

  // ── Sorted + filtered team list ──
  const sortedTeams = useMemo(() => {
    const getVal = (teamKey: string): number | null => {
      if (sortKey === "rank") {
        const r = tbaTeams.find((t) => t.key === teamKey)?.rank;
        return r != null ? r : null;
      }
      if (sortKey === "epa")
        return tbaTeams.find((t) => t.key === teamKey)?.epa?.total_points?.mean ?? null;
      if (sortKey === "opr") {
        const opr = tbaTeams.find((t) => t.key === teamKey)?.opr;
        return opr != null ? opr : null;
      }
      const stat = GRAPHABLE_STATS.find((s) => s.key === sortKey);
      if (stat?.source === "tba") {
        const epa = tbaTeams.find((t) => t.key === teamKey)?.epa?.total_points?.mean ?? null;
        const pts = getTbaStatDataPoints(sortKey, teamKey, tbaClimbData, epa);
        if (!pts.length) return null;
        return pts.reduce((s, p) => s + p.raw, 0) / pts.length;
      }
      const pts = getStatDataPoints(sortKey, matchScoutingData.filter((m) => m.team === teamKey) as any);
      if (!pts.length) return null;
      return pts.reduce((s, p) => s + p.raw, 0) / pts.length;
    };

    return [...tbaTeams].sort((a, b) => {
      const aV = getVal(a.key);
      const bV = getVal(b.key);
      if (aV == null && bV == null) return 0;
      if (aV == null) return 1;
      if (bV == null) return -1;
      return sortKey === "rank" ? aV - bV : bV - aV;
    });
  }, [tbaTeams, sortKey, matchScoutingData, tbaClimbData]);

  const filteredTeams = useMemo(() => {
    if (!searchTeam.trim()) return sortedTeams;
    const q = searchTeam.toLowerCase();
    return sortedTeams.filter(
      (t) =>
        t.key.toLowerCase().includes(q) ||
        getTeamNum(t.key).includes(q) ||
        (t.name ?? "").toLowerCase().includes(q)
    );
  }, [sortedTeams, searchTeam]);

  // ── Display team selection (FIFO, max 2) ──
  const addDisplayTeam = (teamKey: string) => {
    setDisplayTeams((prev) => {
      if (prev.includes(teamKey)) return prev.filter((t) => t !== teamKey);
      return [...prev, teamKey].slice(-2);
    });
  };

  const navigateToTeam = (teamKey: string) => {
    const teamNum = teamKey.replace("frc", "");
    addTab("/team", `Team ${teamNum}`, { team: teamKey }, `team-${teamKey}`);
    navigate({ to: "/team", search: { team: teamKey } });
  };

  // ── Graph team toggle (max 4) ──
  const toggleGraphTeam = (teamKey: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setGraphTeams((prev) => {
      if (prev.includes(teamKey)) return prev.filter((t) => t !== teamKey);
      if (prev.length >= 4) return prev;
      return [...prev, teamKey];
    });
  };

  const currentSortLabel =
    ALL_SORT_OPTIONS.find((o) => o.key === sortKey)?.label ?? sortKey;

  // How many comparison metrics each display team wins (only when 2 teams)
  const metricsBetterCount = useMemo(() => {
    const out: Record<string, number> = {};
    for (const t of displayTeams) out[t] = 0;
    if (displayTeams.length < 2) return out;
    const [a, b] = displayTeams;
    for (const metricKey of compMetrics) {
      const { winnerIdx } = computeGraphData(
        metricKey,
        [a, b],
        matchScoutingData,
        tbaTeams,
        tbaClimbData
      );
      if (winnerIdx === 0) out[a] = (out[a] ?? 0) + 1;
      else if (winnerIdx === 1) out[b] = (out[b] ?? 0) + 1;
    }
    return out;
  }, [displayTeams, compMetrics, matchScoutingData, tbaTeams, tbaClimbData]);

  // "higher" | "lower" | "tie" for metricsBetterAt coloring
  const metricsBetterStatus = useMemo(() => {
    const out: Record<string, "higher" | "lower" | "tie"> = {};
    if (displayTeams.length < 2) return out;
    const [a, b] = displayTeams;
    const va = metricsBetterCount[a] ?? 0;
    const vb = metricsBetterCount[b] ?? 0;
    out[a] = va > vb ? "higher" : va < vb ? "lower" : "tie";
    out[b] = vb > va ? "higher" : vb < va ? "lower" : "tie";
    return out;
  }, [displayTeams, metricsBetterCount]);

  return (
    <div className="flex h-full overflow-hidden p-3 gap-3">
      {/* ══════════════════════════════════════════
          LEFT SIDEBAR
      ══════════════════════════════════════════ */}
      <div className="w-[260px] flex-shrink-0 flex flex-col bg-card rounded-lg overflow-hidden">
        {/* Sort by — inline at top */}
        <div className="px-3 pt-2 pb-1">
          <Popover open={sortOpen} onOpenChange={setSortOpen}>
            <PopoverTrigger asChild>
              <div className="flex items-center gap-2 px-3 py-2.5 border border-primary/50 rounded-lg cursor-pointer hover:border-primary transition-colors">
                <span className="text-sm font-semibold text-foreground flex-1">Sort by...</span>
                <span className="text-xs px-1.5 py-0.5 rounded  text-muted-foreground font-medium truncate max-w-[90px]">
                  {currentSortLabel}
                </span>
                <Check className="w-4 h-4 text-primary flex-shrink-0" />
              </div>
            </PopoverTrigger>
            <PopoverContent
              className="w-[220px] p-0 bg-muted border border-border shadow-xl"
              align="start"
              side="bottom"
            >
              <Command className="bg-muted flex">
                <CommandInput
                  placeholder="Search metrics..."
                  className="h-8 text-xs text-foreground [&>svg]:text-muted-foreground"
                />
                <CommandList className="max-h-[220px]">
                  <CommandEmpty className="text-xs text-muted-foreground py-3 text-center">
                    No results
                  </CommandEmpty>
                  {[...new Set(ALL_SORT_OPTIONS.map((s) => s.group))].map((group) => (
                    <CommandGroup
                      key={group}
                      heading={group}
                      className="text-muted-foreground/70"
                    >
                      {ALL_SORT_OPTIONS.filter((s) => s.group === group).map((opt) => (
                        <CommandItem
                          key={opt.key}
                          value={`${opt.group} ${opt.label}`}
                          onSelect={() => {
                            setSortKey(opt.key);
                            setSortOpen(false);
                          }}
                          className="text-xs cursor-pointer text-muted-foreground hover:text-primary"
                        >
                          {opt.label}
                          {sortKey === opt.key && " ✓"}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ))}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        {/* Search */}
        <div className="px-3 py-2">
          <div className="relative border border-border rounded-lg">
            <Input
              value={searchTeam}
              onChange={(e) => setSearchTeam(e.target.value)}
              placeholder="Search teams..."
              className="pr-8 h-9 text-sm bg-transparent border-0 focus-visible:ring-0 placeholder:text-muted-foreground"
            />
            <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          </div>
        </div>

        {/* Team list */}
        <div className="flex-1 overflow-y-auto py-2 px-3 space-y-2.5">
          {filteredTeams.map((team) => (
            <ComparisonSidebarCard
              key={team.key}
              tbaTeam={team}
              isDisplayed={displayTeams.includes(team.key)}
              isGraphed={graphTeams.includes(team.key)}
              onCardClick={() => addDisplayTeam(team.key)}
              onGraphToggle={(e) => toggleGraphTeam(team.key, e)}
              onTeamExpand={() => navigateToTeam(team.key)}
            />
          ))}
          {filteredTeams.length === 0 && (
            <div className="flex items-center justify-center h-16 text-xs text-muted-foreground">
              No teams found
            </div>
          )}
        </div>

        {/* Bottom: Open Picklist / Last Picklist */}
        <div className="p-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate({ to: "/picklists" })}
              className="flex-1 h-10 flex items-center justify-center gap-1.5 px-3 rounded-lg border border-border text-sm font-medium text-foreground/80 hover:border-muted-foreground transition-colors"
            >
              <Search className="w-4 h-4" />
              Open Picklist
            </button>
            <button
              onClick={() => {
                const picklistTabs = tabs.filter((t) => t.id.startsWith("picklist-"));
                const lastPicklist = picklistTabs[picklistTabs.length - 1];
                if (lastPicklist) {
                  setActiveTab(lastPicklist.id);
                } else {
                  navigate({ to: "/picklists" });
                }
              }}
              className="h-10 w-10 flex items-center justify-center rounded-lg border border-border text-primary hover:border-muted-foreground transition-colors flex-shrink-0"
              title="Last Picklist"
            >
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════
          RIGHT AREA
      ══════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0 gap-4 rounded-lg">
        {/* ── Top: big team panels + comparison center (flex-[3]) ── */}
        <div className="flex-[3] flex items-stretch justify-center gap-8 min-h-0 overflow-hidden">
          {displayTeams.length === 0 ? (
            <div className="w-full h-full flex items-center justify-center border border-border rounded-lg">
              <p className="text-sm text-primary">
                Click a team in the sidebar to compare
              </p>
            </div>
          ) : (
            <>
              {/* Team A */}
              {displayTeams[0] && (
                <div style={{ width: 420, flexShrink: 0 }} className="h-full">
                  <FullTeamPanel
                    teamKey={displayTeams[0]}
                    entry={undefined}
                    tbaTeam={tbaTeams.find((t) => t.key === displayTeams[0])}
                    matchData={matchScoutingData}
                    allMatchData={matchScoutingData}
                    allTbaTeams={tbaTeams}
                    pitScouting={pitScoutingData.find((p) => p.team === displayTeams[0])}
                    tbaClimbData={tbaClimbData}
                    useTbaClimb={useTbaClimb}
                    onMoveUp={() => {}}
                    onMoveDown={() => {}}
                    onRemove={() =>
                      setDisplayTeams((prev) =>
                        prev.filter((t) => t !== displayTeams[0])
                      )
                    }
                    variant="comparison"
                    metricsBetterAt={metricsBetterCount[displayTeams[0]] ?? 0}
                    metricsBetterStatus={metricsBetterStatus[displayTeams[0]]}
                    isGraphed={graphTeams.includes(displayTeams[0])}
                    onGraphToggle={(e) => toggleGraphTeam(displayTeams[0], e)}
                    onTeamExpand={() => navigateToTeam(displayTeams[0])}
                    statOverviewMetric={statOverviewMetric}
                    onStatOverviewMetricChange={setStatOverviewMetric}
                  />
                </div>
              )}

              {/* Center comparison column (only when 2 teams selected) */}
              {displayTeams.length >= 2 && (
                <div className="w-[140px] flex-shrink-0 flex flex-col gap-5 justify-center items-center py-2">
                  {compMetrics.map((metricKey, idx) => (
                    <ComparisonBox
                      key={`${metricKey}-${idx}`}
                      metricKey={metricKey}
                      teamA={displayTeams[0]}
                      teamB={displayTeams[1]}
                      matchData={matchScoutingData}
                      tbaTeams={tbaTeams}
                      tbaClimbData={tbaClimbData}
                      onSwitch={() => setShowCompPickerFor(idx)}
                    />
                  ))}
                  {showCompPickerFor !== null && (
                    <MetricPicker
                      activeMetrics={compMetrics}
                      onSelect={(key) => {
                        setCompMetrics((prev) => {
                          const next = [...prev];
                          next[showCompPickerFor!] = key;
                          return next;
                        });
                        setShowCompPickerFor(null);
                      }}
                      onClose={() => setShowCompPickerFor(null)}
                    />
                  )}
                </div>
              )}

              {/* Team B */}
              {displayTeams[1] && (
                <div style={{ width: 420, flexShrink: 0 }} className="h-full">
                  <FullTeamPanel
                    teamKey={displayTeams[1]}
                    entry={undefined}
                    tbaTeam={tbaTeams.find((t) => t.key === displayTeams[1])}
                    matchData={matchScoutingData}
                    allMatchData={matchScoutingData}
                    allTbaTeams={tbaTeams}
                    pitScouting={pitScoutingData.find((p) => p.team === displayTeams[1])}
                    tbaClimbData={tbaClimbData}
                    useTbaClimb={useTbaClimb}
                    onMoveUp={() => {}}
                    onMoveDown={() => {}}
                    onRemove={() =>
                      setDisplayTeams((prev) =>
                        prev.filter((t) => t !== displayTeams[1])
                      )
                    }
                    variant="comparison"
                    metricsBetterAt={metricsBetterCount[displayTeams[1]] ?? 0}
                    metricsBetterStatus={metricsBetterStatus[displayTeams[1]]}
                    isGraphed={graphTeams.includes(displayTeams[1])}
                    onGraphToggle={(e) => toggleGraphTeam(displayTeams[1], e)}
                    onTeamExpand={() => navigateToTeam(displayTeams[1])}
                    statOverviewMetric={statOverviewMetric}
                    onStatOverviewMetricChange={setStatOverviewMetric}
                  />
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Graph Section (flex-[1]) — teams = graphTeams ── */}
        <div className="flex-[1] flex items-stretch justify-center gap-4 min-h-0">
          {graphMetrics.map((metricKey) => (
            <GraphCard
              key={metricKey}
              metricKey={metricKey}
              teams={graphTeams}
              matchData={matchScoutingData}
              tbaTeams={tbaTeams}
              tbaClimbData={tbaClimbData}
              showPercentiles={!!showPercentiles[metricKey]}
              onTogglePercentiles={() =>
                setShowPercentiles((prev) => ({
                  ...prev,
                  [metricKey]: !prev[metricKey],
                }))
              }
              onRemove={() =>
                setGraphMetrics((prev) => prev.filter((k) => k !== metricKey))
              }
            />
          ))}

          {graphMetrics.length === 0 && (
            <div className="flex items-center justify-center flex-1 border border-border rounded-lg">
              <p className="text-sm text-primary">
                Toggle graph on team cards, then click + to add stat graphs
              </p>
            </div>
          )}

          {/* Add metric button */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => setShowGraphPicker((v) => !v)}
            onKeyDown={(e) => e.key === "Enter" && setShowGraphPicker((v) => !v)}
            className="w-14 flex-shrink-0 border border-border rounded-lg bg-card flex items-center justify-center text-primary hover:bg-secondary transition-colors cursor-pointer relative"
            title="Add metric graph"
          >
            <Plus className="w-5 h-5" />
            {showGraphPicker && (
              <MetricPicker
                activeMetrics={graphMetrics}
                onSelect={(key) => {
                  setGraphMetrics((prev) =>
                    prev.length >= 3 ? [...prev.slice(1), key] : [...prev, key]
                  );
                  setShowGraphPicker(false);
                }}
                onClose={() => setShowGraphPicker(false)}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
