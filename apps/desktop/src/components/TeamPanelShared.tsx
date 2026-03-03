import {
  useState,
  useEffect,
  useMemo,
} from "react";
import {
  ArrowUp,
  ArrowDown,
  Maximize2,
  Grid2X2,
  BarChart2,
  X,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@shadcn/ui/components/tooltip.tsx";
import {
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { TBATeam, PitScoutingData } from "../contexts/DesktopTeamDataContext";
import type { TbaClimbEntry } from "../contexts/DesktopCompetitionDataContext";
import type { MatchScoutingData } from "../lib/db";
import {
  calculateSingleMatchStats,
  getTbaStatDataPoints,
  GRAPHABLE_STATS,
  getStatDataPoints,
} from "@lib/data/matchStats";
import type { MatchDataRaw } from "@lib/config/match-action-schemas/actions.types";
import { getMatchSortOrder, getMatchLabel } from "@lib/utils/match";
import { MetricPicker, ALL_GRAPH_METRICS } from "./MetricPicker";
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from "recharts";
import type { PicklistEntry } from "@lib/data/schema";
import { getImageUrl } from "@lib/storage/uploads";

// ─── Drawing types (shared with team.tsx) ────────────────────────────────────

type PathPoint = { x: number; y: number };
type PathSegment = { points: PathPoint[]; color?: string; lineWidth?: number };
export type DrawingData = {
  paths: PathSegment[];
  canvasWidth: number;
  canvasHeight: number;
};

const FIELD_IMG_WIDTH = 326;
const FIELD_IMG_HEIGHT = 318;

// ─── PitData interface (mirrors mobile PitData) ───────────────────────────────

interface PitData {
  teamNum?: number;
  teamName?: string;
  movement?: { bump?: boolean; trough?: boolean };
  intake?: { ground?: boolean; outpost?: boolean };
  fuel?: { passing?: boolean; capacity?: string };
  autoClimb?: { level?: string | null; orientation?: string[] };
  teleopClimb?: { level?: string[]; orientation?: string[] };
  autos?: Array<{
    name?: string;
    description?: string;
    climb?: boolean;
    climbDuringAuto?: boolean;
    drawing: DrawingData | null;
  }>;
  images?: {
    rating?: number;
    description?: string;
    files?: Array<{ path: string; filename: string; uploaded: boolean }>;
  };
}

// ─── Capability state ─────────────────────────────────────────────────────────

type CapabilityState = "faded" | "capable" | "verified";

function capState(claimed: boolean, verified: boolean): CapabilityState {
  if (!claimed) return "faded";
  if (verified) return "verified";
  return "capable";
}

interface DesktopVerifications {
  bump: CapabilityState;
  trough: CapabilityState;
  ground: CapabilityState;
  outpost: CapabilityState;
  passing: CapabilityState;
  autoClimbObserved: boolean;
  autoClimbOrientations: Set<string>;
  teleopL1: boolean;
  teleopL2: boolean;
  teleopL3: boolean;
  teleopClimbOrientations: Set<string>;
}

function computeDesktopVerifications(
  pit: PitData,
  tbaEntries: TbaClimbEntry[],
  matches: MatchScoutingData[],
): DesktopVerifications {
  const pm = (m: MatchScoutingData) =>
    (m.data_raw as Record<string, Record<string, unknown>> | null)?.postMatch ?? {};
  const observed = {
    bump:    matches.some(m => pm(m).bump),
    trough:  matches.some(m => pm(m).trough),
    ground:  matches.some(m => pm(m).canGround),
    outpost: matches.some(m => pm(m).canStation),
    passing: matches.some(m => pm(m).canPass),
  };

  const autoClimbOrientations = new Set(
    matches
      .map(m => (pm(m).autoClimbOrientation as string | null | undefined))
      .filter((v): v is string => v != null)
      .map(v => v.toLowerCase())
  );
  const teleopClimbOrientations = new Set(
    matches
      .map(m => (pm(m).teleopClimbOrientation as string | null | undefined))
      .filter((v): v is string => v != null)
      .map(v => v.toLowerCase())
  );

  return {
    bump:    capState(pit.movement?.bump ?? false, observed.bump),
    trough:  capState(pit.movement?.trough ?? false, observed.trough),
    ground:  capState(pit.intake?.ground ?? false, observed.ground),
    outpost: capState(pit.intake?.outpost ?? false, observed.outpost),
    passing: capState(pit.fuel?.passing ?? false, observed.passing),
    autoClimbObserved: tbaEntries.some(e => e.auto_climb != null),
    autoClimbOrientations,
    teleopL1: tbaEntries.some(e => e.teleop_climb === "L1"),
    teleopL2: tbaEntries.some(e => e.teleop_climb === "L2"),
    teleopL3: tbaEntries.some(e => e.teleop_climb === "L3"),
    teleopClimbOrientations,
  };
}

// ─── Percentile helpers ───────────────────────────────────────────────────────

function computePercentile(value: number, allValues: number[]): number {
  if (allValues.length === 0) return 50;
  const sorted = [...allValues].sort((a, b) => a - b);
  const rank = sorted.filter(v => v < value).length;
  return Math.round((rank / sorted.length) * 100);
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const sqDiffs = values.map(v => (v - avg) ** 2);
  return Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / values.length);
}

// ─── AutoPathPreview (moved from team.tsx) ────────────────────────────────────

export function AutoPathPreview({
  drawing,
  className,
}: {
  drawing: DrawingData;
  className?: string;
}) {
  const { paths, canvasWidth, canvasHeight } = drawing;
  const cropH = FIELD_IMG_WIDTH * (2 / 3);
  const cropY = (FIELD_IMG_HEIGHT - cropH) / 2;
  const scaleX = FIELD_IMG_WIDTH / canvasWidth;
  const scaleY = cropH / canvasHeight;
  return (
    <div className={`relative w-full overflow-hidden rounded-lg ${className || ""}`}>
      <img src="/red_field.svg" alt="Field" className="block w-full h-auto max-w-full max-h-full" />
      <svg
        viewBox={`0 0 ${FIELD_IMG_WIDTH} ${FIELD_IMG_HEIGHT}`}
        className="absolute inset-0 w-full h-full"
        preserveAspectRatio="xMidYMid meet"
        style={{ pointerEvents: "none" }}
      >
        <g transform={`translate(0, ${cropY}) scale(${scaleX}, ${scaleY})`}>
          {paths.map((path, pathIndex) => {
            if (!path.points || path.points.length < 2) return null;
            const actualPoints = path.points.map((p) => ({
              x: p.x * canvasWidth,
              y: p.y * canvasHeight,
            }));
            const pathData = actualPoints
              .map((point, i) => (i === 0 ? `M ${point.x} ${point.y}` : `L ${point.x} ${point.y}`))
              .join(" ");
            return (
              <path
                key={pathIndex}
                d={pathData}
                stroke={path.color || "#ef4444"}
                strokeWidth={(path.lineWidth ?? 3) * Math.max(scaleX, scaleY)}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })}
        </g>
      </svg>
    </div>
  );
}

// ─── Image session cache (module-level, path → blob URL) ─────────────────────

const _pitImageCache = new Map<string, string>();

function PitImageCarousel({ imagePaths }: { imagePaths: string[] }) {
  const [idx, setIdx] = useState(0);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loadingImg, setLoadingImg] = useState(false);

  const currentPath = imagePaths[idx] ?? null;

  useEffect(() => {
    if (!currentPath || currentPath.startsWith("pending-")) return;
    const cached = _pitImageCache.get(currentPath);
    if (cached) { setBlobUrl(cached); return; }

    let cancelled = false;
    setLoadingImg(true);
    setBlobUrl(null);

    (async () => {
      try {
        const url = getImageUrl(currentPath);
        const r = await fetch(url, { mode: "cors" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const blob = await r.blob();
        const objectUrl = URL.createObjectURL(blob);
        _pitImageCache.set(currentPath, objectUrl);
        if (!cancelled) setBlobUrl(objectUrl);
      } catch {
        if (!cancelled) setBlobUrl(null);
      } finally {
        if (!cancelled) setLoadingImg(false);
      }
    })();
    return () => { cancelled = true; };
  }, [currentPath]);

  if (imagePaths.length === 0) {
    return (
      <div className="w-full aspect-square rounded-lg bg-muted/30 flex items-center justify-center">
        <span className="text-xs text-muted-foreground">No images</span>
      </div>
    );
  }

  return (
    <div className="relative w-full aspect-square rounded-lg overflow-hidden bg-muted/30 select-none">
      {loadingImg && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs text-muted-foreground">Loading…</span>
        </div>
      )}
      {blobUrl && (
        <img src={blobUrl} alt="Pit photo" className="w-full h-full object-cover" />
      )}
      {!loadingImg && !blobUrl && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs text-muted-foreground">No image</span>
        </div>
      )}
      {imagePaths.length > 1 && idx > 0 && (
        <button
          className="absolute left-1 top-1/2 -translate-y-1/2 p-0.5 rounded-full bg-card/70 opacity-40 hover:opacity-90 transition-opacity"
          onClick={() => setIdx(i => Math.max(0, i - 1))}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      )}
      {imagePaths.length > 1 && idx < imagePaths.length - 1 && (
        <button
          className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded-full bg-card/70 opacity-40 hover:opacity-90 transition-opacity"
          onClick={() => setIdx(i => Math.min(imagePaths.length - 1, i + 1))}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      )}
      {imagePaths.length > 1 && (
        <div className="absolute bottom-1 left-0 right-0 flex justify-center gap-1">
          {imagePaths.map((_, i) => (
            <div key={i} className={`w-1 h-1 rounded-full ${i === idx ? "bg-foreground" : "bg-foreground/30"}`} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── BigStatBox (percentile-colored: green top 25%, red bottom 25%) ─────────────

function BigStatBox({
  label,
  value,
  percentile,
}: {
  label: string;
  value: number | null;
  percentile: number | null;
}) {
  const display = value == null ? "—" : value % 1 === 0 ? String(value) : value.toFixed(1);
  const valueColor =
    percentile == null || value == null
      ? "text-foreground"
      : percentile >= 75
        ? "text-chart-2/85"
        : percentile <= 25
          ? "text-red-500"
          : "text-foreground";
  const box = (
    <div className="flex flex-col items-center justify-center bg-muted/60 rounded-lg px-3 py-2.5 w-full aspect-square border border-border/60">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wide text-center leading-tight">{label}</span>
      <span className={`text-lg font-bold tabular-nums ${valueColor}`}>{display}</span>
    </div>
  );
  if (percentile == null || value == null)
    return box;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{box}</TooltipTrigger>
      <TooltipContent side="right">
        <span className="text-xs">Percentile: Top {100 - percentile}% of all teams</span>
      </TooltipContent>
    </Tooltip>
  );
}

// ─── CapabilityRow (with optional noBullet for pit data) ────────────────────────

function CapabilityRow({
  label,
  state,
  noBullet,
}: {
  label: string;
  state: CapabilityState;
  noBullet?: boolean;
}) {
  const textCls = state === "verified"
    ? "text-chart-2/60"
    : state === "capable"
      ? "text-foreground"
      : "text-muted-foreground/70";
  if (noBullet) {
    return <span className={`text-xs ${textCls}`}>{label}</span>;
  }
  const dotCls = state === "verified"
    ? "bg-chart-2/65"
    : state === "capable"
      ? "bg-foreground"
      : "bg-muted-foreground/25";
  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotCls}`} />
      <span className={`text-xs ${textCls}`}>{label}</span>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function getTeamNum(teamKey: string): string {
  return teamKey?.replace("frc", "");
}

export interface ClimbCounts {
  auto: { L1: number; L2: number; L3: number; any: number };
  teleop: { L1: number; L2: number; L3: number };
  n: number;
}

export function getClimbCounts(
  teamKey: string,
  matchData: MatchScoutingData[],
  tbaClimbData: Record<string, Record<string, TbaClimbEntry>>,
  useTba: boolean,
): ClimbCounts {
  const auto = { L1: 0, L2: 0, L3: 0, any: 0 };
  const teleop = { L1: 0, L2: 0, L3: 0 };

  if (useTba) {
    let n = 0;
    for (const matchEntries of Object.values(tbaClimbData)) {
      const entry = matchEntries[teamKey];
      if (!entry) continue;
      n++;
      if (entry.auto_climb === "L1") { auto.L1++; auto.any++; }
      else if (entry.auto_climb === "L2") { auto.L2++; auto.any++; }
      else if (entry.auto_climb === "L3") { auto.L3++; auto.any++; }
      if (entry.teleop_climb === "L1") teleop.L1++;
      else if (entry.teleop_climb === "L2") teleop.L2++;
      else if (entry.teleop_climb === "L3") teleop.L3++;
    }
    return { auto, teleop, n };
  }

  const teamMatches = matchData.filter((m) => m.team === teamKey);
  for (const m of teamMatches) {
    const stats = calculateSingleMatchStats(m as any);
    if (stats?.climb.hasAutoClimb) auto.any++;
    if (stats?.climb.level === "L1") teleop.L1++;
    else if (stats?.climb.level === "L2") teleop.L2++;
    else if (stats?.climb.level === "L3") teleop.L3++;
  }
  return { auto, teleop, n: teamMatches.length };
}

// ─── ClimbLevelChip ─────────────────────────────────────────────────────────

export function ClimbLevelChip({ label, count, n }: { label: string; count: number; n: number }) {
  const active = count > 0;
  return (
    <div className={[
      "flex flex-col items-center rounded-md px-2.5 py-1 min-w-[40px]",
      active ? "bg-primary/15" : "bg-muted",
    ].join(" ")}>
      <span className={["text-[10px] font-semibold", active ? "text-primary" : "text-muted-foreground/50"].join(" ")}>
        {label}
      </span>
      <span className={["text-sm font-bold tabular-nums", active ? "text-primary" : "text-muted-foreground/30"].join(" ")}>
        {count}
      </span>
      {n > 0 && (
        <span className="text-[9px] text-muted-foreground/50">
          {Math.round((count / n) * 100)}%
        </span>
      )}
    </div>
  );
}

// ─── FullTeamPanel ──────────────────────────────────────────────────────────

export type FullTeamPanelVariant = "picklist" | "comparison";

export interface FullTeamPanelProps {
  teamKey: string;
  entry: PicklistEntry | undefined;
  tbaTeam: TBATeam | undefined;
  matchData: MatchScoutingData[];
  allMatchData: MatchScoutingData[];
  pitScouting: PitScoutingData | undefined;
  tbaClimbData: Record<string, Record<string, TbaClimbEntry>>;
  useTbaClimb: boolean;
  /** All TBA teams (for percentile coloring of stat boxes) */
  allTbaTeams?: TBATeam[];
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  dragListeners?: Record<string, unknown>;
  dragAttributes?: Record<string, unknown>;
  /** "picklist" = order #, up/down, drag. "comparison" = metrics-better-at, graph. */
  variant?: FullTeamPanelVariant;
  /** For comparison: how many metrics this team is better at (vs the other display team) */
  metricsBetterAt?: number;
  /** For comparison: "higher" = green, "lower" = red, "tie" = muted */
  metricsBetterStatus?: "higher" | "lower" | "tie";
  /** For comparison: is this team in the graph section */
  isGraphed?: boolean;
  /** For comparison: toggle graph */
  onGraphToggle?: (e: React.MouseEvent) => void;
  /** Navigate to team page */
  onTeamExpand?: () => void;
  /** Stat Overview: controlled metric selection (shared across panels when provided) */
  statOverviewMetric?: string;
  onStatOverviewMetricChange?: (key: string) => void;
}

// Module-level: shared stat selection when not controlled by parent
let _statOverviewMetricKey = "overview";

export function FullTeamPanel({
  teamKey,
  entry,
  tbaTeam,
  matchData,
  allMatchData,
  pitScouting,
  tbaClimbData,
  useTbaClimb = true,
  allTbaTeams = [],
  onMoveUp,
  onMoveDown,
  onRemove,
  dragListeners,
  dragAttributes,
  variant = "picklist",
  metricsBetterAt = 0,
  metricsBetterStatus,
  isGraphed = false,
  onGraphToggle,
  onTeamExpand,
  statOverviewMetric: statOverviewMetricProp,
  onStatOverviewMetricChange,
}: FullTeamPanelProps) {
  const teamNum = getTeamNum(teamKey);
  const teamName = tbaTeam?.name ?? teamKey;
  const isComparison = variant === "comparison";

  // ── Pit data parsing ──────────────────────────────────────────────────────
  const pit = (pitScouting?.data as PitData | null) ?? null;
  const teamMatchData = useMemo(
    () => matchData.filter(m => m.team === teamKey),
    [matchData, teamKey]
  );

  // ── Stats ──────────────────────────────────────────────────────────────────
  const epaValue = tbaTeam?.epa?.total_points?.mean ?? null;
  const climbPointsValue = useMemo(() => {
    const pts = getTbaStatDataPoints("avg_climb_points", teamKey, tbaClimbData, null);
    if (!pts.length) return null;
    return pts.reduce((s, p) => s + p.raw, 0) / pts.length;
  }, [teamKey, tbaClimbData]);
  const avgFuelValue = useMemo(() => {
    const epa = tbaTeam?.epa?.total_points?.mean ?? null;
    const pts = getTbaStatDataPoints("avg_fuel_points", teamKey, tbaClimbData, epa);
    if (!pts.length) return null;
    return pts.reduce((s, p) => s + p.raw, 0) / pts.length;
  }, [teamKey, tbaClimbData, tbaTeam?.epa?.total_points?.mean]);

  // ── Percentiles for stat boxes (EPA, Avg Fuel, Avg Climb) ───────────────────
  const percentiles = useMemo(() => {
    const allClimbValues: number[] = [];
    const allFuelValues: number[] = [];
    const allEpaValues: number[] = [];
    for (const t of allTbaTeams) {
      const tk = t.key;
      const epa = t.epa?.total_points?.mean;
      if (epa != null) allEpaValues.push(epa);
      const climbPts = getTbaStatDataPoints("avg_climb_points", tk, tbaClimbData, null);
      if (climbPts.length)
        allClimbValues.push(climbPts.reduce((s, p) => s + p.raw, 0) / climbPts.length);
      const fuelPts = getTbaStatDataPoints("avg_fuel_points", tk, tbaClimbData, epa ?? undefined);
      if (fuelPts.length)
        allFuelValues.push(fuelPts.reduce((s, p) => s + p.raw, 0) / fuelPts.length);
    }
    return {
      epa: epaValue != null ? computePercentile(epaValue, allEpaValues) : null,
      avgFuel: avgFuelValue != null ? computePercentile(avgFuelValue, allFuelValues) : null,
      avgClimb: climbPointsValue != null ? computePercentile(climbPointsValue, allClimbValues) : null,
    };
  }, [allTbaTeams, tbaClimbData, epaValue, avgFuelValue, climbPointsValue]);

  // ── Verifications ──────────────────────────────────────────────────────────
  const tbaEntries = useMemo(
    () => Object.values(tbaClimbData).map(m => m[teamKey]).filter(Boolean) as TbaClimbEntry[],
    [tbaClimbData, teamKey]
  );
  const verifs = useMemo(() => {
    if (!pit) return null;
    return computeDesktopVerifications(pit, tbaEntries, teamMatchData);
  }, [pit, tbaEntries, teamMatchData]);

  // ── Image paths ────────────────────────────────────────────────────────────
  const imagePaths = useMemo(() => {
    const files = pit?.images?.files ?? [];
    return files
      .filter(f => f.uploaded && !f.path.startsWith("pending-"))
      .map(f => f.path);
  }, [pit]);

  // ── Auto carousel ──────────────────────────────────────────────────────────
  const autos = useMemo(() => {
    return (pit?.autos ?? []).map(a => ({
      name: a.name,
      description: a.description,
      climbDuringAuto: a.climbDuringAuto ?? a.climb ?? false,
      drawing: a.drawing && Array.isArray(a.drawing.paths) ? a.drawing : null,
    }));
  }, [pit]);
  const [autoIdx, setAutoIdx] = useState(0);
  const clampedAutoIdx = autos.length > 0 ? Math.min(autoIdx, autos.length - 1) : 0;
  const [pitDataOpen, setPitDataOpen] = useState(false);
  const [matchRecapOpen, setMatchRecapOpen] = useState(true);
  const [statOverviewOpen, setStatOverviewOpen] = useState(true);
  const [showStatOverviewPicker, setShowStatOverviewPicker] = useState(false);
  const [statOverviewMetricUncontrolled, setStatOverviewMetricUncontrolled] = useState(() => _statOverviewMetricKey);
  const statOverviewMetric = statOverviewMetricProp ?? statOverviewMetricUncontrolled;
  const setStatOverviewMetric = (key: string) => {
    _statOverviewMetricKey = key;
    onStatOverviewMetricChange?.(key);
    setStatOverviewMetricUncontrolled(key);
  };
  const currentAuto = autos[clampedAutoIdx] ?? null;

  // ── Overview radar data (climb pts, fuel pts, rank, epa, disable time) ───────
  const overviewRadarData = useMemo(() => {
    const labels = [
      { key: "climbPts", label: "Climb Pts" },
      { key: "fuelPts", label: "Fuel Pts" },
      { key: "rank", label: "Rank" },
      { key: "epa", label: "EPA" },
      { key: "disableTime", label: "Disable" },
    ] as const;
    const allClimb: number[] = [];
    const allFuel: number[] = [];
    const allRank: number[] = [];
    const allEpa: number[] = [];
    const allDisable: number[] = [];
    for (const t of allTbaTeams) {
      const epa = t.epa?.total_points?.mean ?? null;
      const climbPts = getTbaStatDataPoints("avg_climb_points", t.key, tbaClimbData, null);
      const fuelPts = getTbaStatDataPoints("avg_fuel_points", t.key, tbaClimbData, epa);
      if (climbPts.length) allClimb.push(climbPts.reduce((s, p) => s + p.raw, 0) / climbPts.length);
      if (fuelPts.length) allFuel.push(fuelPts.reduce((s, p) => s + p.raw, 0) / fuelPts.length);
      if (t.rank != null) allRank.push(t.rank);
      if (epa != null) allEpa.push(epa);
      const teamMatches = allMatchData.filter(m => m.team === t.key);
      const pts = getStatDataPoints("disabled_time", teamMatches as any);
      if (pts.length) allDisable.push(pts.reduce((s, p) => s + p.raw, 0) / pts.length);
    }
    // Scale so outer edge (1) = event max for that metric. Center = 0 (or worst for inverted).
    const norm = (v: number, arr: number[], invert = false) => {
      if (arr.length === 0) return 0;
      const max = Math.max(...arr);
      if (max === 0) return 0;
      const n = v / max;
      return invert ? 1 - n : n;
    };
    const climbVal = (() => {
      const pts = getTbaStatDataPoints("avg_climb_points", teamKey, tbaClimbData, null);
      return pts.length ? pts.reduce((s, p) => s + p.raw, 0) / pts.length : null;
    })();
    const fuelVal = (() => {
      const epa = tbaTeam?.epa?.total_points?.mean ?? null;
      const pts = getTbaStatDataPoints("avg_fuel_points", teamKey, tbaClimbData, epa);
      return pts.length ? pts.reduce((s, p) => s + p.raw, 0) / pts.length : null;
    })();
    const rankVal = tbaTeam?.rank ?? null;
    const epaVal = tbaTeam?.epa?.total_points?.mean ?? null;
    const disableVal = (() => {
      const teamMatches = allMatchData.filter(m => m.team === teamKey);
      const pts = getStatDataPoints("disabled_time", teamMatches as any);
      return pts.length ? pts.reduce((s, p) => s + p.raw, 0) / pts.length : null;
    })();
    const metrics = labels.map(({ key, label }) => {
      let raw: number | null = null;
      let normalized = 0;
      let percentile: number | null = null;
      if (key === "climbPts" && climbVal != null) {
        raw = climbVal;
        normalized = norm(climbVal, allClimb);
        percentile = allClimb.length ? computePercentile(climbVal, allClimb) : null;
      } else if (key === "fuelPts" && fuelVal != null) {
        raw = fuelVal;
        normalized = norm(fuelVal, allFuel);
        percentile = allFuel.length ? computePercentile(fuelVal, allFuel) : null;
      } else if (key === "rank" && rankVal != null) {
        raw = rankVal;
        normalized = norm(rankVal, allRank, true);
        percentile = allRank.length ? computePercentile(rankVal, allRank) : null;
      } else if (key === "epa" && epaVal != null) {
        raw = epaVal;
        normalized = norm(epaVal, allEpa);
        percentile = allEpa.length ? computePercentile(epaVal, allEpa) : null;
      } else if (key === "disableTime" && disableVal != null) {
        raw = disableVal;
        normalized = norm(disableVal, allDisable, true);
        percentile = allDisable.length ? computePercentile(disableVal, allDisable) : null;
      }
      return { subject: label, value: normalized, fullMark: 1, raw, percentile };
    });
    return metrics;
  }, [teamKey, allTbaTeams, tbaClimbData, tbaTeam, allMatchData]);

  // ── Stat Overview data ─────────────────────────────────────────────────────
  const statOverviewData = useMemo(() => {
    const key = statOverviewMetric;
    if (key === "overview") {
      return { pts: [] as { matchKey: string; raw: number }[], allValuesForPercentile: [] as number[], isTeamLevel: false, isOverview: true };
    }
    const ctx = { epa: tbaTeam?.epa?.total_points?.mean ?? null, tbaClimbData };
    if (key === "epa") {
      const val = tbaTeam?.epa?.total_points?.mean ?? null;
      const allVals = allTbaTeams.map(t => t.epa?.total_points?.mean).filter((v): v is number => v != null);
      const pts: { matchKey: string; raw: number }[] = val != null ? [{ matchKey: "event", raw: val }] : [];
      return { pts, allValuesForPercentile: allVals, isTeamLevel: true, isOverview: false };
    }
    if (key === "opr") {
      const val = tbaTeam?.opr ?? null;
      const allVals = allTbaTeams.map(t => t.opr).filter((v): v is number => v != null);
      const pts: { matchKey: string; raw: number }[] = val != null ? [{ matchKey: "event", raw: val }] : [];
      return { pts, allValuesForPercentile: allVals, isTeamLevel: true, isOverview: false };
    }
    const stat = GRAPHABLE_STATS.find(s => s.key === key);
    if (!stat) return { pts: [] as { matchKey: string; raw: number }[], allValuesForPercentile: [] as number[], isTeamLevel: false, isOverview: false };
    if (stat.source === "tba") {
      const epa = tbaTeam?.epa?.total_points?.mean ?? null;
      const pts = getTbaStatDataPoints(key, teamKey, tbaClimbData, epa);
      const allVals: number[] = [];
      for (const t of allTbaTeams) {
        const tPts = getTbaStatDataPoints(key, t.key, tbaClimbData, t.epa?.total_points?.mean ?? null);
        if (tPts.length) allVals.push(tPts.reduce((s, p) => s + p.raw, 0) / tPts.length);
      }
      return { pts, allValuesForPercentile: allVals, isTeamLevel: false, isOverview: false };
    }
    const teamMatches = allMatchData.filter(m => m.team === teamKey);
    const pts = getStatDataPoints(key, teamMatches as any, ctx);
    const allVals: number[] = [];
    const teamKeys = [...new Set(allMatchData.map(m => m.team))];
    for (const tk of teamKeys) {
      const tm = allMatchData.filter(m => m.team === tk);
      const tkPts = getStatDataPoints(key, tm as any, ctx);
      if (tkPts.length) allVals.push(tkPts.reduce((s, p) => s + p.raw, 0) / tkPts.length);
    }
    return { pts, allValuesForPercentile: allVals, isTeamLevel: false, isOverview: false };
  }, [statOverviewMetric, teamKey, allMatchData, tbaClimbData, tbaTeam, allTbaTeams]);

  const statOverviewMetrics = useMemo(() => {
    const { pts } = statOverviewData;
    const rawValues = pts.map(p => p.raw);
    if (rawValues.length === 0)
      return { avg: null, max: null, min: null, stdev: null, delta: null, avgP: null, maxP: null, minP: null };
    const avg = rawValues.reduce((a, b) => a + b, 0) / rawValues.length;
    const max = Math.max(...rawValues);
    const min = Math.min(...rawValues);
    const sd = stdev(rawValues);
    const delta = rawValues.length >= 2 ? max - min : 0;
    const all = statOverviewData.allValuesForPercentile;
    const avgP = all.length ? computePercentile(avg, all) : null;
    const maxP = all.length ? computePercentile(max, all) : null;
    const minP = all.length ? computePercentile(min, all) : null;
    return { avg, max, min, stdev: sd, delta, avgP, maxP, minP };
  }, [statOverviewData]);

  const statOverviewLabel = ALL_GRAPH_METRICS.find(m => m.key === statOverviewMetric)?.label ?? statOverviewMetric;

  // ── Notes ──────────────────────────────────────────────────────────────────
  const teamNotes = pit?.images?.description?.trim() || null;


  return (
    <div className="w-full h-full border border-border rounded-lg bg-card flex flex-col overflow-hidden">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border flex-shrink-0">
        <span
          className={[
            "w-7 h-7 rounded-full border text-xs font-semibold flex items-center justify-center flex-shrink-0",
            isComparison && metricsBetterStatus === "higher"
              ? "border-green-500/50 text-green-600 dark:text-green-400"
              : isComparison && metricsBetterStatus === "lower"
                ? "border-red-500/50 text-red-600 dark:text-red-400"
                : "border-muted-foreground/60 text-muted-foreground",
          ].join(" ")}
        >
          {isComparison ? metricsBetterAt : (entry?.rank ?? "—")}
        </span>
        <span className="text-sm font-medium text-primary truncate">
          {teamName}
        </span>
        <div className="w-px h-4 bg-muted-foreground flex-shrink-0" />
        <span className="text-sm font-medium text-primary flex-shrink-0">
          {teamNum}
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-1.5">
          {isComparison ? (
            <button
              onClick={(e) => { e.stopPropagation(); onGraphToggle?.(e); }}
              className={[
                "p-0.5 rounded transition-colors",
                isGraphed
                  ? "text-primary drop-shadow-[0_0_4px_hsl(var(--primary))]"
                  : "text-muted-foreground/60 hover:text-muted-foreground",
              ].join(" ")}
              title={isGraphed ? "Remove from graph" : "Add to graph"}
            >
              <BarChart2 className="w-5 h-5" />
            </button>
          ) : (
            <>
              <button
                onClick={onMoveUp}
                className="p-0.5 rounded text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                title="Move up in picklist rank"
              >
                <ArrowUp className="w-5 h-5" />
              </button>
              <button
                onClick={onMoveDown}
                className="p-0.5 rounded text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                title="Move down in picklist rank"
              >
                <ArrowDown className="w-5 h-5" />
              </button>
              <div
                {...dragAttributes}
                {...dragListeners}
                className="p-0.5 rounded cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
                title="Drag to reorder display position"
              >
                <Grid2X2 className="w-5 h-5" />
              </div>
            </>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onTeamExpand?.(); }}
            className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
            title="Open team page"
          >
            <Maximize2 className="w-5 h-5" />
          </button>
          <button
            onClick={onRemove}
            className="p-0.5 rounded-sm border border-destructive/50 text-destructive hover:bg-destructive/10 transition-colors"
            title="Remove from view"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* ── Scrollable body (design layout) ───────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="p-3 space-y-3">

          {/* Top: Robot picture (left) + 3 big stat boxes (right), image vertically centered */}
          <div className="flex gap-3 items-center">
            <div className="flex-1 min-w-0 flex items-center justify-center min-h-[100px]">
              <PitImageCarousel imagePaths={imagePaths} />
            </div>
            <div className="flex flex-col gap-2 w-[100px] flex-shrink-0">
              <BigStatBox
                label="EPA"
                value={epaValue != null ? Math.round(epaValue * 10) / 10 : null}
                percentile={percentiles.epa}
              />
              <BigStatBox
                label="Avg Fuel"
                value={avgFuelValue != null ? Math.round(avgFuelValue * 10) / 10 : null}
                percentile={percentiles.avgFuel}
              />
              <BigStatBox
                label="Avg Climb"
                value={climbPointsValue != null ? Math.round(climbPointsValue * 10) / 10 : null}
                percentile={percentiles.avgClimb}
              />
            </div>
          </div>

          {/* Middle: Pit Data — boxes with primary-bordered section names, same row, no scroll */}
          {pit ? (
            <div className="rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setPitDataOpen((o) => !o)}
                className="w-full flex items-center justify-between px-3 py-2 bg-muted/10 hover:bg-muted/20 transition-colors text-left"
              >
                <p className="text-base font-semibold text-primary">Pit Data</p>
                <div className="flex items-center gap-2">
                  {pitScouting?.name && (
                    <p className="text-[10px] text-muted-foreground">scouted by {pitScouting.name}</p>
                  )}
                  <ChevronDown
                    className={`w-4 h-4 text-muted-foreground transition-transform shrink-0 ${pitDataOpen ? "" : "-rotate-90"}`}
                  />
                </div>
              </button>

              {pitDataOpen && pit && verifs && (
                <>
                <div className="flex flex-nowrap gap-2 p-2 justify-start">
                  {/* Fuel card */}
                  <div className="rounded-lg border border-border px-2 py-3 bg-card flex-1 min-w-[58px] max-w-[72px] flex flex-col items-center text-center min-h-[100px]">
                    <span className="text-sm font-semibold text-primary rounded-md px-2 py-0.5 mb-2">Fuel</span>
                    <div className="space-y-1.5 flex flex-col items-center flex-1">
                      <div>
                        <p className="text-xs text-muted-foreground">Capacity:</p>
                        <p className={`text-xs break-words ${pit.fuel?.capacity ? "text-foreground" : "text-muted-foreground/70"}`}>
                          {pit.fuel?.capacity || "—"}
                        </p>
                      </div>
                      <CapabilityRow label="Passing" state={pit.fuel?.passing ? verifs.passing : "faded"} noBullet />
                    </div>
                  </div>
                  {/* Moving card */}
                  <div className="rounded-lg border border-border px-2 py-3 bg-card flex-1 min-w-[58px] max-w-[72px] flex flex-col items-center text-center min-h-[100px]">
                    <span className="text-sm font-semibold text-primary rounded-md px-2 py-0.5 mb-2">Moving</span>
                    <div className="space-y-1.5 flex flex-col items-center flex-1">
                      <CapabilityRow label="Trench" state={pit.movement?.trough ? verifs.trough : "faded"} noBullet />
                      <CapabilityRow label="Bump" state={pit.movement?.bump ? verifs.bump : "faded"} noBullet />
                    </div>
                  </div>
                  {/* Intake card */}
                  <div className="rounded-lg border border-border px-2 py-3 bg-card flex-1 min-w-[58px] max-w-[72px] flex flex-col items-center text-center min-h-[100px]">
                    <span className="text-sm font-semibold text-primary rounded-md px-2 py-0.5 mb-2">Intake</span>
                    <div className="space-y-1.5 flex flex-col items-center flex-1">
                      <CapabilityRow label="Ground" state={pit.intake?.ground ? verifs.ground : "faded"} noBullet />
                      <CapabilityRow label="Station" state={pit.intake?.outpost ? verifs.outpost : "faded"} noBullet />
                    </div>
                  </div>
                  {/* Climb card */}
                  <div className="rounded-lg border border-border px-2 py-3 bg-card flex-1 min-w-[58px] max-w-[72px] flex flex-col items-center text-center min-h-[100px]">
                    <span className="text-sm font-semibold text-primary rounded-md px-2 py-0.5 mb-2">Climb</span>
                    <div className="space-y-1.5 flex flex-col items-center flex-1">
                      {(["L1", "L2", "L3"] as const).map(l => {
                        const inPit = Array.isArray(pit.teleopClimb?.level) && pit.teleopClimb.level.includes(l);
                        const verified = l === "L1" ? verifs.teleopL1 : l === "L2" ? verifs.teleopL2 : verifs.teleopL3;
                        const state: CapabilityState = inPit ? (verified ? "verified" : "capable") : "faded";
                        return (
                          <CapabilityRow
                            key={l}
                            label={l}
                            state={state}
                            noBullet
                          />
                        );
                      })}
                      <div className="flex flex-row gap-0.5 justify-center text-xs">
                        {(["left", "right", "center"] as const).map((k, i) => {
                          const letter = k === "left" ? "L" : k === "right" ? "R" : "C";
                          const verified = verifs.teleopClimbOrientations.has(k);
                          const ori = pit.teleopClimb?.orientation;
                          const inPit = Array.isArray(ori) ? ori.some(o =>
                            o?.toLowerCase() === k || o === (k === "left" ? "L" : k === "right" ? "R" : "C")
                          ) : false;
                          return (
                            <span key={k}>
                              {i > 0 && <span className="text-muted-foreground/50">, </span>}
                              <span className={verified ? "text-chart-2/60 font-medium" : inPit ? "text-foreground" : "text-muted-foreground/70"}>
                                {letter}
                              </span>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  {/* Auto card */}
                  <div className="rounded-lg border border-border px-2 py-3 bg-card flex-1 min-w-[58px] max-w-[72px] flex flex-col items-center text-center min-h-[100px]">
                    <span className="text-sm font-semibold text-primary rounded-md px-2 py-0.5 mb-2">Auto</span>
                    <div className="space-y-1.5 flex flex-col items-center flex-1">
                      <CapabilityRow
                        label="Climb"
                        state={pit.autoClimb?.level != null && pit.autoClimb.level !== "None"
                          ? (verifs.autoClimbObserved ? "verified" : "capable")
                          : "faded"}
                        noBullet
                      />
                      <div className="flex flex-row gap-0.5 justify-center text-xs">
                        {(["left", "right", "center"] as const).map((k, i) => {
                          const letter = k === "left" ? "L" : k === "right" ? "R" : "C";
                          const verified = verifs.autoClimbOrientations.has(k);
                          const ori = pit.autoClimb?.orientation;
                          const inPit = Array.isArray(ori) ? ori.some(o =>
                            o?.toLowerCase() === k || o === (k === "left" ? "L" : k === "right" ? "R" : "C")
                          ) : false;
                          return (
                            <span key={k}>
                              {i > 0 && <span className="text-muted-foreground/50">, </span>}
                              <span className={verified ? "text-chart-2/60 font-medium" : inPit ? "text-foreground" : "text-muted-foreground/70"}>
                                {letter}
                              </span>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Bottom: 3 columns — Autos | Name/Climb/Desc | Notes (fixed max height, scroll inside) */}
                <div className="flex gap-2 min-h-[120px] max-h-[250px] p-2">
              {/* Left: Autos field/drawing — centered */}
              <div className="flex-1 min-w-0 rounded-lg border border-border bg-card overflow-hidden flex flex-col">
                <p className="text-sm text-foreground uppercase font-semibold px-2 pt-3 pb-1 bg-card">
                  Autos
                </p>
                <div className="flex-1 min-h-0 flex items-center justify-center p-2">
                  {autos.length === 0 ? (
                    <span className="text-xs text-muted-foreground">No autos recorded</span>
                  ) : (
                    <div className="relative w-full h-full flex items-center justify-center">
                      {currentAuto?.drawing ? (
                        <AutoPathPreview drawing={currentAuto.drawing} className="max-h-full max-w-full shrink-0" />
                      ) : (
                        <div
                          className="w-full bg-muted/30 rounded flex items-center justify-center"
                          style={{ aspectRatio: `${FIELD_IMG_WIDTH}/${FIELD_IMG_HEIGHT}` }}
                        >
                          <span className="text-xs text-muted-foreground">No drawing</span>
                        </div>
                      )}
                      {autos.length > 1 && clampedAutoIdx > 0 && (
                        <button
                          className="absolute left-0.5 top-1/2 -translate-y-1/2 p-0.5 rounded-full bg-card/70 hover:opacity-90"
                          onClick={() => setAutoIdx(i => Math.max(0, i - 1))}
                        >
                          <ChevronLeft className="w-3 h-3" />
                        </button>
                      )}
                      {autos.length > 1 && clampedAutoIdx < autos.length - 1 && (
                        <button
                          className="absolute right-0.5 top-1/2 -translate-y-1/2 p-0.5 rounded-full bg-card/70 hover:opacity-90"
                          onClick={() => setAutoIdx(i => Math.min(autos.length - 1, i + 1))}
                        >
                          <ChevronRight className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {autos.length > 1 && (
                  <div className="flex justify-center gap-1 py-0.5">
                    {autos.map((_, i) => (
                      <div
                        key={i}
                        className={`w-1 h-1 rounded-full ${i === clampedAutoIdx ? "bg-foreground" : "bg-foreground/25"}`}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Middle: Name, Climb, Description (card style) */}
              <div className="w-[110px] flex-shrink-0 flex flex-col gap-2 min-h-0 overflow-hidden">
                <div className="rounded-lg border border-border bg-card px-3 py-2 flex flex-col gap-1 shrink-0">
                  <p className="text-xs font-semibold text-primary">Name</p>
                  <p className="text-xs text-foreground">
                    {currentAuto?.name || `Auto ${clampedAutoIdx + 1}` || "—"}
                  </p>
                  <p className="text-xs font-semibold text-primary">Climb</p>
                  <p className="text-xs text-foreground">
                    {currentAuto?.climbDuringAuto ? "Yes" : "No"}
                  </p>
                  {currentAuto?.climbDuringAuto && (pit?.autoClimb?.orientation?.length ?? 0) > 0 && (
                    <>
                      <p className="text-xs font-semibold text-primary mt-0.5">Orientation</p>
                      <p className="text-xs text-foreground">
                        {(pit.autoClimb?.orientation ?? []).join(", ")}
                      </p>
                    </>
                  )}
                </div>
                <div className="rounded-lg border border-border bg-card px-3 py-2 flex-1 min-h-0 flex flex-col overflow-hidden shrink">
                  <p className="text-xs font-semibold text-primary shrink-0">Description</p>
                  <div className="flex-1 min-h-0 overflow-y-auto mt-0.5 py-2">
                    <p className="text-xs text-muted-foreground leading-snug pr-1">
                      {currentAuto?.description || "—"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Right: Notes (card style) */}
              <div className="w-[110px] flex-shrink-0 rounded-lg border border-border bg-card overflow-hidden flex flex-col min-h-0">
                <p className="text-sm text-primary uppercase font-semibold px-3 pt-3 pb-1 bg-card shrink-0">
                  Notes
                </p>
                <div className="flex-1 min-h-0 overflow-y-auto py-4 px-2">
                  <p className="text-xs text-muted-foreground leading-snug whitespace-pre-wrap pr-1">
                    {teamNotes || "Describe any capabilities or extra information which you were not able to input into the pit..."}
                  </p>
                </div>
              </div>
              </div>
                </>
              )}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground/50 text-center py-2 border border-border/30 rounded-lg bg-muted/10">
              No pit scouting data
            </div>
          )}

          {/* Match Summary — horizontally scrolling cards */}
          {teamMatchData.length > 0 && (
            <div className="rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setMatchRecapOpen((o) => !o)}
                className="w-full flex items-center justify-between px-3 py-2 bg-muted/10 hover:bg-muted/20 transition-colors text-left"
              >
                <p className="text-base font-semibold text-primary">Match Recap</p>
                <ChevronDown
                  className={`w-4 h-4 text-muted-foreground transition-transform shrink-0 ${matchRecapOpen ? "" : "-rotate-90"}`}
                />
              </button>
              {matchRecapOpen && (
              <div className="flex gap-2 p-2 overflow-x-auto overflow-y-hidden scrollbar-thin">
                {teamMatchData
                  .filter((m) => m.data_raw && Object.keys(m.data_raw).length > 0)
                  .sort((a, b) => {
                    const oa = getMatchSortOrder(a.match);
                    const ob = getMatchSortOrder(b.match);
                    for (let i = 0; i < Math.max(oa.length, ob.length); i++) {
                      const va = oa[i] ?? 0;
                      const vb = ob[i] ?? 0;
                      if (va !== vb) return va - vb;
                    }
                    return 0;
                  })
                  .map((m) => {
                    const stats = calculateSingleMatchStats(m as any);
                    const tbaClimb = tbaClimbData[m.match]?.[teamKey] ?? null;
                    const raw = m.data_raw as unknown as MatchDataRaw | undefined;
                    const matchLabel = (() => {
                      const part = m.match.includes("_") ? m.match.split("_").pop()! : m.match;
                      const qm = part.match(/^qm(\d+)$/i);
                      if (qm) return `Qual ${qm[1]}`;
                      const sf = part.match(/^sf(\d+)m(\d+)$/i);
                      if (sf) return `SF${sf[1]}M${sf[2]}`;
                      const f = part.match(/^f(\d+)m(\d+)$/i);
                      if (f) return `F${f[1]}M${f[2]}`;
                      return part.toUpperCase();
                    })();
                    const scouterName = m.name?.trim() || "—";
                    const orientShort = (o: "left" | "right" | "center" | null) =>
                      o === "left" ? "(L)" : o === "right" ? "(R)" : o === "center" ? "(C)" : "";
                    const climbA = useTbaClimb && tbaClimb?.auto_climb
                      ? `${tbaClimb.auto_climb} ${orientShort(stats?.climb?.autoClimbOrientation ?? null)}`.trim()
                      : stats?.climb?.hasAutoClimb
                        ? `Yes ${orientShort(stats.climb.autoClimbOrientation)}`.trim()
                        : "None";
                    const climbT = useTbaClimb && tbaClimb?.teleop_climb
                      ? `${tbaClimb.teleop_climb} ${orientShort(stats?.climb?.teleopClimbOrientation ?? null)}`.trim()
                      : stats?.climb?.level
                        ? `${stats.climb.level} ${orientShort(stats.climb.teleopClimbOrientation)}`.trim()
                        : "None";
                    const ratings = stats?.ratings;
                    const avgRating =
                      ratings &&
                      (() => {
                        const vals = [ratings.ground, ratings.shooting, ratings.passing, ratings.driver].filter(
                          (v): v is number => v != null
                        );
                        return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
                      })();
                    const selectedAutoInfo = (() => {
                      if (raw?.selectedAuto && autos.length > 0) {
                        const matched = autos.find(
                          (a) => (a.name || "").toLowerCase() === (raw.selectedAuto || "").toLowerCase()
                        );
                        if (matched) return matched.name || raw.selectedAuto || matched.description || "—";
                        return raw.selectedAuto as string;
                      }
                      if (raw?.autoDescription?.trim()) return raw.autoDescription;
                      return "—";
                    })();
                    return (
                      <div
                        key={`${m.match}-${m.team}-${m.uid ?? "n"}`}
                        className="px-1 flex-shrink-0 w-[265px] min-h-[180px] rounded-lg border border-border bg-card overflow-hidden flex flex-col"
                      >
                        <p className="text-base font-medium text-primary px-3 py-2">
                          {matchLabel} — {scouterName}
                        </p>
                        <div className="flex gap-1.5 px-2 pb-2 h-[170px] shrink-0 overflow-hidden">
                          <div className="flex-1 min-w-0 rounded border border-muted-foreground/60 px-1.5 py-3.5 flex flex-col gap-1 overflow-hidden">
                            <p className="text-[10px] font-medium text-muted-foreground uppercase text-center">Match Stats</p>
                            <div className="space-y-2 text-xs">
                              <div className="flex gap-1.5 items-baseline">
                                <span className="w-14 shrink-0 text-right text-primary">Auto:</span>
                                <span className="text-foreground tabular-nums">
                                  {stats?.auto?.shoots ?? "—"} shots
                                </span>
                              </div>
                              <div className="flex gap-1.5 items-baseline">
                                <span className="w-14 shrink-0 text-right text-primary">Climb (A):</span>
                                <span className="text-foreground">{climbA}</span>
                              </div>
                              <div className="flex gap-1.5 items-baseline">
                                <span className="w-14 shrink-0 text-right text-primary">Climb (T):</span>
                                <span className="text-foreground">{climbT}</span>
                              </div>
                              <div className="flex gap-1.5 items-baseline">
                                <span className="w-14 shrink-0 text-right text-primary">Disable:</span>
                                <span className="text-foreground tabular-nums">
                                  {stats?.durations?.disabledTime != null
                                    ? `${Math.round(stats.durations.disabledTime)}s`
                                    : "—"}
                                </span>
                              </div>
                              <div className="flex gap-1.5 items-baseline">
                                <span className="w-14 shrink-0 text-right text-primary">Ratings:</span>
                                <span className="text-foreground tabular-nums">
                                  {avgRating != null ? avgRating.toFixed(1) : "—"}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="flex-1 min-w-0 rounded border border-muted-foreground/60 px-1.5 py-3.5 flex flex-col gap-2 overflow-hidden min-h-0">
                            <p className="text-[10px] font-medium text-muted-foreground uppercase text-center shrink-0">Match Notes</p>
                            <div className="h-[50px] min-w-0 w-full overflow-y-auto overflow-x-hidden shrink-0 px-2">
                              <p className="text-xs text-foreground leading-snug whitespace-pre-wrap break-all text-center">
                                {stats?.notes?.trim() || "—"}
                              </p>
                            </div>
                            <div className="shrink-0 space-y-1 text-center min-h-0 min-w-0 overflow-hidden flex flex-col">
                              <p className="text-[10px] text-muted-foreground">Selected Auto:</p>
                              <div className="h-[42px] min-w-0 w-full overflow-y-auto overflow-x-hidden shrink-0 px-2">
                                <p className="text-xs text-foreground leading-snug whitespace-pre-wrap break-all">{selectedAutoInfo}</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
              )}
            </div>
          )}

          {/* Stat Overview — collapsible dropdown */}
          <div className="rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setStatOverviewOpen((o) => !o)}
              className="w-full flex items-center justify-between px-3 py-2 bg-muted/10 hover:bg-muted/20 transition-colors text-left"
            >
              <p className="text-base font-semibold text-primary">Stat Overview</p>
              <ChevronDown
                className={`w-4 h-4 text-muted-foreground transition-transform shrink-0 ${statOverviewOpen ? "" : "-rotate-90"}`}
              />
            </button>
            {statOverviewOpen && (
              <div className="p-2 space-y-2">
                {/* Metric picker row */}
                <div className="flex items-center gap-2">
                  <p className="text-xs text-muted-foreground shrink-0">Metric:</p>
                  <div className="relative flex-1 min-w-0">
                    <button
                      type="button"
                      onClick={() => setShowStatOverviewPicker(true)}
                      className="w-full flex items-center justify-between px-3 py-1.5 text-sm rounded-md border border-border bg-card hover:bg-muted/30 text-left truncate text-muted-foreground"
                    >
                      <span className="truncate">{statOverviewLabel}</span>
                      <ChevronDown className="w-3.5 h-3.5 shrink-0 ml-1" />
                    </button>
                  </div>
                </div>
                {showStatOverviewPicker && (
                  <MetricPicker
                    activeMetrics={[statOverviewMetric]}
                    onSelect={(key) => {
                      setStatOverviewMetric(key);
                      setShowStatOverviewPicker(false);
                    }}
                    onClose={() => setShowStatOverviewPicker(false)}
                  />
                )}
                {/* Two columns: Metrics (left) + Graph or Match-by-match (right) */}
                <div className="grid grid-cols-[2fr_3fr] gap-2">
                  <div className="rounded-lg border border-border bg-card px-3 py-3 min-w-0">
                    {statOverviewMetric === "overview" ? (
                      <div className="space-y-2.5 text-base">
                        {overviewRadarData.map((m) => (
                          <div key={m.subject} className="flex justify-between gap-2 items-baseline">
                            <span className="text-primary">{m.subject}:</span>
                            <span className="tabular-nums text-muted-foreground">
                              {m.raw != null ? (
                                m.percentile != null ? (
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span>
                                          {m.subject === "Disable"
                                            ? (typeof m.raw === "number" && Number.isInteger(m.raw) ? m.raw : m.raw.toFixed(1)) + "s"
                                            : typeof m.raw === "number" && Number.isInteger(m.raw)
                                              ? m.raw
                                              : m.raw.toFixed(2)}
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent>{m.percentile}%</TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                ) : m.subject === "Disable" ? (
                                  (typeof m.raw === "number" && Number.isInteger(m.raw) ? m.raw : m.raw.toFixed(1)) + "s"
                                ) : (
                                  typeof m.raw === "number" && Number.isInteger(m.raw) ? m.raw : m.raw.toFixed(2)
                                )
                              ) : (
                                "—"
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-2.5 text-base">
                        {[
                          { k: "avg", v: statOverviewMetrics.avg, p: statOverviewMetrics.avgP },
                          { k: "max", v: statOverviewMetrics.max, p: statOverviewMetrics.maxP },
                          { k: "min", v: statOverviewMetrics.min, p: statOverviewMetrics.minP },
                          { k: "stdev", v: statOverviewMetrics.stdev, p: null },
                          { k: "delta", v: statOverviewMetrics.delta, p: null },
                        ].map(({ k, v, p }) => (
                          <div key={k} className="flex justify-between gap-2 items-baseline">
                            <span className="text-primary">{k === "avg" ? "Average" : k === "max" ? "Max" : k === "min" ? "Min" : k === "stdev" ? "Stdev" : "Delta"}:</span>
                            <span className="tabular-nums text-muted-foreground">
                              {v != null ? (
                                p != null ? (
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span>{typeof v === "number" && Number.isInteger(v) ? v : v.toFixed(2)}</span>
                                      </TooltipTrigger>
                                      <TooltipContent>{p}%</TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                ) : (
                                  typeof v === "number" && Number.isInteger(v) ? v : v.toFixed(2)
                                )
                              ) : (
                                "—"
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="rounded-lg border border-border bg-card px-3 py-3 min-w-0 overflow-hidden flex flex-col">
                    {statOverviewMetric === "overview" ? (
                      <div className="flex-1 min-h-[160px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <RadarChart data={overviewRadarData} margin={{ top: 20, right: 44, bottom: 20, left: 28 }}>
                            {/* Outer pentagon + radial spokes: foreground (drawn first) */}
                            <PolarGrid
                              stroke="var(--color-muted-foreground)"
                              strokeOpacity={0.9}
                              strokeWidth={2}
                              polarRadius={[1]}
                              radialLines={true}
                            />
                            {/* Inner pentagons: secondary (drawn second, on top) */}
                            <PolarGrid
                              stroke="var(--color-secondary)"
                              strokeOpacity={0.7}
                              strokeWidth={1}
                              polarRadius={[0.25, 0.5, 0.75]}
                              radialLines={false}
                            />
                            <PolarAngleAxis
                              dataKey="subject"
                              tick={{ fill: "var(--color-primary)", fontSize: 10 }}
                              tickLine={false}
                            />
                            <PolarRadiusAxis
                              angle={90}
                              domain={[0, 1]}
                              tick={false}
                              axisLine={false}
                              tickLine={false}
                            />
                            <Radar
                              name="Overview"
                              dataKey="value"
                              stroke="var(--color-primary)"
                              fill="var(--color-primary)"
                              fillOpacity={0.5}
                              strokeWidth={3}
                            />
                          </RadarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                    <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
                      {statOverviewData.pts.length === 0 ? (
                        <p className="text-base text-muted-foreground">No data</p>
                      ) : (
                        statOverviewData.pts
                          .sort((a, b) => {
                            if (a.matchKey === "event") return 1;
                            if (b.matchKey === "event") return -1;
                            const oa = getMatchSortOrder(a.matchKey);
                            const ob = getMatchSortOrder(b.matchKey);
                            for (let i = 0; i < Math.max(oa.length, ob.length); i++) {
                              const va = oa[i] ?? 0;
                              const vb = ob[i] ?? 0;
                              if (va !== vb) return va - vb;
                            }
                            return 0;
                          })
                          .map((p) => (
                            <div key={p.matchKey} className="flex justify-between gap-2 items-baseline text-base">
                              <span className="text-primary truncate">{getMatchLabel(p.matchKey)}</span>
                              <span className="tabular-nums text-muted-foreground shrink-0">
                                {typeof p.raw === "number" && Number.isInteger(p.raw) ? p.raw : p.raw.toFixed(2)}
                              </span>
                            </div>
                          ))
                      )}
                    </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

// ─── SortableFullPanel ───────────────────────────────────────────────────────

export function SortableFullPanel(
  props: Omit<FullTeamPanelProps, "dragListeners" | "dragAttributes">
) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.teamKey });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        display: "flex",
        width: "420px",
        flexShrink: 0,
      }}
    >
      <FullTeamPanel
        {...props}
        dragListeners={listeners as any}
        dragAttributes={attributes as any}
      />
    </div>
  );
}
