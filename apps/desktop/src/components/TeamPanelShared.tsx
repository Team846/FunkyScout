import {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
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
  ExternalLink,
  ArrowUpRight,
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
import { useDesktopCompetitionData } from "../contexts/DesktopCompetitionDataContext";
import { permanentlyExcludeSubmission } from "@lib/data/scouterExclusions";
import type { MatchScoutingData } from "../lib/db";
import {
  calculateSingleMatchStats,
  getTbaStatDataPoints,
  GRAPHABLE_STATS,
  getStatDataPoints,
} from "@lib/data/matchStats";
import type { MatchDataRaw } from "@lib/config/match-action-schemas/actions.types";
import { getMatchSortOrder, getMatchLabel } from "@lib/utils/match";
import { fetchEventVideo } from "@lib/tba/video";
import { openUrl } from "@tauri-apps/plugin-opener";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getMatchActionSchema, getActionById } from "@lib/config/match-action-schemas";
import { useNavigate } from "@tanstack/react-router";
import { useTabContext } from "../contexts/TabContext";
import { useDesktopEvent } from "../contexts/DesktopEventContext";
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
    <div className={`relative w-full rounded-lg ${className || ""}`}>
      <img src="/red_field.svg" alt="Field" className="block w-full h-auto max-w-full max-h-full rounded-lg overflow-hidden" />
      <svg
        viewBox={`0 0 ${FIELD_IMG_WIDTH} ${FIELD_IMG_HEIGHT}`}
        className="absolute inset-0 w-full h-full"
        preserveAspectRatio="xMidYMid meet"
        style={{ pointerEvents: "none", overflow: "visible" }}
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
      <div className="w-full aspect-square rounded-lg border border-border bg-muted/30 flex items-center justify-center">
        <span className="text-xs text-muted-foreground">No images</span>
      </div>
    );
  }

  return (
    <div className={`relative w-full aspect-square rounded-lg overflow-hidden bg-muted/30 select-none ${!blobUrl ? "border border-border" : ""}`}>
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

// ─── Match Replay helpers (mirrors matches.tsx, panel-scaled) ────────────────

const PANEL_FIELD_W = 652;
const PANEL_FIELD_H = 318;

const PANEL_ACTION_STYLE: Record<string, { fill: string; shape: string }> = {
  groundIntake:   { fill: "#22c55e", shape: "circle" },
  passing:        { fill: "#3b82f6", shape: "square" },
  stationIntake:  { fill: "#a855f7", shape: "square" },
  stationStocked: { fill: "#f59e0b", shape: "diamond" },
  fuelScore1:     { fill: "#eab308", shape: "circle" },
  fuelScore2:     { fill: "#eab308", shape: "circle" },
  fuelScore5:     { fill: "#eab308", shape: "square" },
  fuelScore8:     { fill: "#eab308", shape: "diamond" },
  autoClimbL1:    { fill: "#06b6d4", shape: "triangle" },
  teleopClimbL1:  { fill: "#06b6d4", shape: "triangle" },
  teleopClimbL2:  { fill: "#06b6d4", shape: "triangle" },
  teleopClimbL3:  { fill: "#06b6d4", shape: "triangle" },
  autoDisable:    { fill: "#78716c", shape: "star" },
  teleopDisable:  { fill: "#78716c", shape: "star" },
  autoDefend:     { fill: "#f59e0b", shape: "star" },
  teleopDefend:   { fill: "#f59e0b", shape: "star" },
  block:          { fill: "#f59e0b", shape: "star" },
  camp:           { fill: "#a855f7", shape: "circle" },
  disrupt:        { fill: "#f97316", shape: "diamond" },
  dropped:        { fill: "#78716c", shape: "circle" },
};
const PANEL_DEFAULT_STYLE = { fill: "#94a3b8", shape: "circle" };

function panelGetStyle(actionId: string) {
  return PANEL_ACTION_STYLE[actionId] ?? PANEL_DEFAULT_STYLE;
}

function PanelActionBlob({ x, y, style }: { x: number; y: number; style: { fill: string; shape: string } }) {
  const r = 18;
  const { fill } = style;
  const op = 0.9;
  if (style.shape === "triangle") {
    const h = r * 1.2;
    return <polygon points={`${x},${y - h} ${x - r},${y + h * 0.6} ${x + r},${y + h * 0.6}`} fill={fill} opacity={op} />;
  }
  if (style.shape === "star") {
    const outer = r; const inner = r * 0.4;
    const pts: string[] = [];
    for (let i = 0; i < 5; i++) {
      const a1 = (i * 2 * Math.PI) / 5 - Math.PI / 2;
      pts.push(`${x + outer * Math.cos(a1)},${y + outer * Math.sin(a1)}`);
      const a2 = ((i + 0.5) * 2 * Math.PI) / 5 - Math.PI / 2;
      pts.push(`${x + inner * Math.cos(a2)},${y + inner * Math.sin(a2)}`);
    }
    return <polygon points={pts.join(" ")} fill={fill} opacity={op} />;
  }
  if (style.shape === "square") return <rect x={x - r} y={y - r} width={r * 2} height={r * 2} fill={fill} opacity={op} />;
  if (style.shape === "diamond") {
    const d = r * 1.2;
    return <polygon points={`${x},${y - d} ${x + d},${y} ${x},${y + d} ${x - d},${y}`} fill={fill} opacity={op} />;
  }
  return <circle cx={x} cy={y} r={r} fill={fill} opacity={op} />;
}

function panelNormToSvg(x: number, y: number) {
  const ax = Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0.5;
  const ay = Number.isFinite(y) ? Math.max(0, Math.min(1, y)) : 0.5;
  return { x: ax * PANEL_FIELD_W, y: ay * PANEL_FIELD_H };
}

function panelParseStartPos(raw: import("@lib/config/match-action-schemas/actions.types").MatchDataRaw | null | undefined) {
  let x = 0.5; let y = 0.9;
  if (raw?.startPosition) {
    const sp = raw.startPosition;
    if (Array.isArray(sp)) { x = Number(sp[0]); y = Number(sp[1]); }
    else { x = Number((sp as { x: number; y: number }).x); y = Number((sp as { x: number; y: number }).y); }
  }
  if (!Number.isFinite(x)) x = 0.5;
  if (!Number.isFinite(y)) y = 0.9;
  return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
}

function panelToDisplayCoords(x: number, y: number, alliance: "red" | "blue") {
  return alliance === "red" ? { x: x * 0.5, y } : { x: 0.5 + (1 - x) * 0.5, y };
}

interface PanelWaypoint { x: number; y: number; timestamp: number; actionId?: string; }

function panelBuildWaypoints(
  dataRaw: import("@lib/config/match-action-schemas/actions.types").MatchDataRaw | null | undefined,
  schema: ReturnType<typeof getMatchActionSchema>,
  phase: "auto" | "teleop" | "full",
  alliance: "red" | "blue",
): PanelWaypoint[] {
  if (!dataRaw) return [];
  const start = panelParseStartPos(dataRaw);
  const startDisp = panelToDisplayCoords(start.x, start.y, alliance);
  const opponentAlliance: "red" | "blue" = alliance === "red" ? "blue" : "red";
  const autoActions = ([...(dataRaw.autoActions ?? [])]).sort((a, b) => a.timestamp - b.timestamp);
  const teleopActions = ([...(dataRaw.teleopActions ?? [])]).sort((a, b) => a.timestamp - b.timestamp);
  const isEpoch = [...autoActions, ...teleopActions].some((a) => a.timestamp > 1e12);
  const NO_BLOB = new Set(["defend", "teleopDefend", "autoDefend", "disable", "teleopDisable", "autoDisable"]);

  function getActionLocation(a: import("@lib/config/match-action-schemas/actions.types").MatchAction) {
    if (a.location) return a.location;
    const def = getActionById(schema, a.actionId);
    return def?.location ?? null;
  }

  function climbDispY(isAuto: boolean): number {
    const pm = dataRaw!.postMatch;
    const ori = isAuto ? pm?.autoClimbOrientation : pm?.teleopClimbOrientation;
    return ori === "right" ? 0.25 : ori === "left" ? 0.75 : 0.5;
  }

  function push(pts: PanelWaypoint[], a: import("@lib/config/match-action-schemas/actions.types").MatchAction, ts: number) {
    if (a.actionId === "block") {
      const d = panelToDisplayCoords(0.5, 0.5, opponentAlliance);
      pts.push({ x: d.x, y: d.y, timestamp: ts, actionId: a.enabled !== false ? "block" : undefined });
    } else if (a.actionId === "autoClimbL1") {
      const d = panelToDisplayCoords(0.05, climbDispY(true), alliance);
      pts.push({ x: d.x, y: d.y, timestamp: ts, actionId: a.enabled !== false ? a.actionId : undefined });
    } else if (a.actionId.startsWith("teleopClimb")) {
      const d = panelToDisplayCoords(0.05, climbDispY(false), alliance);
      pts.push({ x: d.x, y: d.y, timestamp: ts, actionId: a.enabled !== false ? a.actionId : undefined });
    } else if (NO_BLOB.has(a.actionId)) {
      const last = pts[pts.length - 1]!;
      pts.push({ x: last.x, y: last.y, timestamp: ts });
    } else {
      const loc = getActionLocation(a);
      if (loc) {
        const fa = (a as { onOpponentField?: boolean }).onOpponentField ? opponentAlliance : alliance;
        const d = panelToDisplayCoords(loc.x, loc.y, fa);
        pts.push({ x: d.x, y: d.y, timestamp: ts, actionId: a.actionId });
      } else {
        const last = pts[pts.length - 1]!;
        pts.push({ x: last.x, y: last.y, timestamp: ts });
      }
    }
  }

  if (phase === "auto") {
    const pts: PanelWaypoint[] = [{ x: startDisp.x, y: startDisp.y, timestamp: 0 }];
    const t0 = isEpoch && autoActions.length > 0 ? Math.min(...autoActions.map((a) => a.timestamp)) - 1 : 0;
    for (const a of autoActions) push(pts, a, isEpoch ? a.timestamp - t0 : a.timestamp);
    return pts.sort((a, b) => a.timestamp - b.timestamp);
  }
  if (phase === "teleop") {
    const autoWps: PanelWaypoint[] = [{ x: startDisp.x, y: startDisp.y, timestamp: 0 }];
    const t0Auto = isEpoch && autoActions.length > 0 ? Math.min(...autoActions.map((a) => a.timestamp)) - 1 : 0;
    for (const a of autoActions) push(autoWps, a, isEpoch ? a.timestamp - t0Auto : a.timestamp);
    const teleopStart = autoWps[autoWps.length - 1] ?? { x: startDisp.x, y: startDisp.y };
    const pts: PanelWaypoint[] = [{ x: teleopStart.x, y: teleopStart.y, timestamp: 0 }];
    const t0Tel = isEpoch && teleopActions.length > 0 ? Math.min(...teleopActions.map((a) => a.timestamp)) - 1 : 0;
    for (const a of teleopActions) push(pts, a, isEpoch ? a.timestamp - t0Tel : a.timestamp - 20_000);
    return pts.sort((a, b) => a.timestamp - b.timestamp);
  }
  // full
  const pts: PanelWaypoint[] = [{ x: startDisp.x, y: startDisp.y, timestamp: 0 }];
  const allActions = [...autoActions, ...teleopActions];
  const t0 = isEpoch && allActions.length > 0 ? Math.min(...allActions.map((a) => a.timestamp)) - 1 : 0;
  for (const a of autoActions) push(pts, a, isEpoch ? a.timestamp - t0 : a.timestamp);
  for (const a of teleopActions) push(pts, a, isEpoch ? a.timestamp - t0 : a.timestamp);
  return pts.sort((a, b) => a.timestamp - b.timestamp);
}

// ─── StatMatchGraph ─────────────────────────────────────────────────────────

function StatMatchGraph({
  pts,
  allValues,
  metric,
}: {
  pts: { matchKey: string; raw: number }[];
  allValues: number[];
  metric: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      setContainerWidth(entries[0]?.contentRect.width ?? 0);
    });
    obs.observe(el);
    setContainerWidth(el.offsetWidth);
    return () => obs.disconnect();
  }, []);

  const sorted = useMemo(() => {
    return [...pts]
      .filter((p) => p.matchKey !== "event")
      .sort((a, b) => {
        const oa = getMatchSortOrder(a.matchKey);
        const ob = getMatchSortOrder(b.matchKey);
        for (let i = 0; i < Math.max(oa.length, ob.length); i++) {
          const va = oa[i] ?? 0;
          const vb = ob[i] ?? 0;
          if (va !== vb) return va - vb;
        }
        return 0;
      });
  }, [pts]);

  const lowerIsBetter = ["disabled_time", "dismount_time", "auto_climb_time", "teleop_climb_time"].includes(metric);

  const sortedByValue = useMemo(() => {
    return [...sorted].sort((a, b) =>
      lowerIsBetter ? a.raw - b.raw : b.raw - a.raw
    );
  }, [sorted, lowerIsBetter]);

  const yMax = useMemo(() => {
    return Math.max(0.001, ...allValues, ...sorted.map((p) => p.raw));
  }, [sorted, allValues]);

  const H = 160;
  const pad = { top: 12, right: 20, bottom: 14, left: 30 };

  const formatYLabel = (v: number) => {
    if (["disabled_time", "block_time", "defend_time"].includes(metric)) {
      return (v < 10 ? v.toFixed(1) : Math.round(v)) + "s";
    }
    if (v >= 10 || Number.isInteger(v)) return Math.round(v).toString();
    return v.toFixed(1);
  };

  const formatVal = (v: number) => {
    if (["disabled_time", "block_time", "defend_time"].includes(metric)) {
      return (Number.isInteger(v) ? v : v.toFixed(1)) + "s";
    }
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
  };

  if (sorted.length === 0) {
    return (
      <div ref={containerRef} className="w-full flex items-center justify-center" style={{ height: H }}>
        <p className="text-xs text-muted-foreground">No data</p>
      </div>
    );
  }

  const graphW = Math.max(0, containerWidth - pad.left - pad.right);
  const graphH = H - pad.top - pad.bottom;

  const xOf = (i: number) =>
    sorted.length === 1
      ? pad.left + graphW / 2
      : pad.left + (i / (sorted.length - 1)) * graphW;

  const yOf = (v: number) =>
    pad.top + graphH * (1 - Math.min(1, Math.max(0, v / yMax)));

  const coords = sorted.map((p, i) => ({ x: xOf(i), y: yOf(p.raw) }));

  const buildPath = (pts2: { x: number; y: number }[]) => {
    if (pts2.length === 0) return "";
    if (pts2.length === 1) return `M ${pts2[0].x} ${pts2[0].y}`;
    let d = `M ${pts2[0].x} ${pts2[0].y}`;
    for (let i = 0; i < pts2.length - 1; i++) {
      const cp = (pts2[i].x + pts2[i + 1].x) / 2;
      d += ` C ${cp} ${pts2[i].y} ${cp} ${pts2[i + 1].y} ${pts2[i + 1].x} ${pts2[i + 1].y}`;
    }
    return d;
  };

  const curvePath = buildPath(coords);
  const maxLabels = Math.max(1, Math.floor(graphW / 26));
  const labelStep = Math.ceil(sorted.length / maxLabels);

  return (
    <div ref={containerRef} className="w-full relative select-none" style={{ height: H }}>
      {containerWidth > 0 && (
        <svg width={containerWidth} height={H} className="overflow-visible">
          {/* Gridlines + Y axis labels */}
          {[0.25, 0.5, 0.75, 1].map((f) => {
            const lineY = pad.top + graphH * (1 - f);
            return (
              <g key={f}>
                <line
                  x1={pad.left}
                  y1={lineY}
                  x2={pad.left + graphW}
                  y2={lineY}
                  stroke="var(--color-border)"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  opacity={0.6}
                />
                <text
                  x={pad.left - 10}
                  y={lineY + 4}
                  textAnchor="end"
                  fontSize={10}
                  fill="var(--color-muted-foreground)"
                >
                  {formatYLabel(yMax * f)}
                </text>
              </g>
            );
          })}
          {/* Curve */}
          {sorted.length > 1 && (
            <path
              d={curvePath}
              fill="none"
              stroke="#eab308"
              strokeWidth={2}
              strokeLinecap="round"
            />
          )}
          {/* Points + invisible hit areas */}
          {sorted.map((p, i) => {
            const { x, y } = coords[i];
            const isHover = hoverIdx === i;
            return (
              <g key={p.matchKey}>
                <circle
                  cx={x}
                  cy={y}
                  r={14}
                  fill="transparent"
                  onMouseEnter={() => setHoverIdx(i)}
                  onMouseLeave={() => setHoverIdx(null)}
                  style={{ cursor: "crosshair" }}
                />
                <circle
                  cx={x}
                  cy={y}
                  r={isHover ? 5 : 3.5}
                  fill={isHover ? "#fde047" : "#eab308"}
                  stroke="#ca8a04"
                  strokeWidth={1}
                  style={{ pointerEvents: "none" }}
                />
              </g>
            );
          })}
          {/* X axis labels */}
          {sorted.map((p, i) => {
            const show = i % labelStep === 0 || i === sorted.length - 1;
            if (!show) return null;
            const label = getMatchLabel(p.matchKey)
              .replace("Qual ", "Q")
              .replace(/^(SF\d+)M\d+$/, "$1")
              .replace("QM", "");
            return (
              <text
                key={`lbl-${p.matchKey}`}
                x={coords[i].x}
                y={H - 9}
                textAnchor="middle"
                fontSize={14}
                fill="var(--color-foreground)"
              >
                {label}
              </text>
            );
          })}
        </svg>
      )}
      {/* Hover tooltip */}
      {hoverIdx !== null && containerWidth > 0 && (() => {
        const { x, y } = coords[hoverIdx];
        const p = sorted[hoverIdx];
        const rank = sortedByValue.findIndex((s) => s.matchKey === p.matchKey) + 1;
        const flipX = x > containerWidth * 0.65;
        return (
          <div
            className="absolute pointer-events-none bg-secondary border border-border rounded-md px-2 py-1 text-xs shadow-md z-50"
            style={{
              left: flipX ? x - 8 : x + 8,
              top: Math.max(0, y - 24),
              transform: flipX ? "translateX(-100%)" : undefined,
            }}
          >
            <p className="text-muted-foreground whitespace-nowrap">
              {formatVal(p.raw)}  (#{rank})
            </p>
          </div>
        );
      })()}
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
      .filter(f => f.uploaded && !f.path.startsWith("pending-") && f.path.includes("/"))
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
  const [matchOverviewOpen, setMatchOverviewOpen] = useState(false);
  const [showMatchPicker, setShowMatchPicker] = useState(false);
  const [selectedMatchKey, setSelectedMatchKey] = useState<string | null>(null);
  const [matchOverviewMetric, setMatchOverviewMetric] = useState("epa");
  const [showMatchOverviewMetricPicker, setShowMatchOverviewMetricPicker] = useState(false);
  // ── Match Overview video/replay ─────────────────────────────────────────────
  const [excludingMatch, setExcludingMatch] = useState(false);
  const [matchViewMode, setMatchViewMode] = useState<"video" | "field">("video");
  const [matchVideoCache, setMatchVideoCache] = useState<{ data: Array<{ key: string; videos: Array<{ key: string; type: string }> }> } | null>(null);
  const [matchReplayPlaying, setMatchReplayPlaying] = useState(false);
  const [matchReplayProgress, setMatchReplayProgress] = useState(0);
  const [matchReplaySpeed, setMatchReplaySpeed] = useState(1);
  const [matchReplayPhase, setMatchReplayPhase] = useState<"auto" | "teleop" | "full">("full");
  const matchRafRef = useRef<number | undefined>(undefined);
  const matchStartTimeRef = useRef<number>(0);
  const matchLastProgressRef = useRef(0);

  // ── Contexts for match navigation + video ───────────────────────────────────
  const { currentEvent } = useDesktopEvent();
  const { refresh: refreshCompetition } = useDesktopCompetitionData();
  const { addTab } = useTabContext();
  const navigate = useNavigate();
  const matchSchema = useMemo(() => getMatchActionSchema(currentEvent || "2026"), [currentEvent]);

  // ── Match video cache (lazy: only fetch when section is open) ───────────────
  useEffect(() => {
    if (!currentEvent || !matchOverviewOpen) return;
    fetchEventVideo(currentEvent).then((data: unknown) => {
      setMatchVideoCache(data && typeof data === "object" ? data as typeof matchVideoCache : null);
    }).catch(() => {});
  }, [currentEvent, matchOverviewOpen]);

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
      { key: "rank", label: "Rank" },
      { key: "epa", label: "EPA" },
      { key: "climbPts", label: "Climb Pts" },
      { key: "fuelPts", label: "Fuel Pts" },
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
    // Delta = last match stat - first match stat (by match order), can be negative
    const sortedPts = [...pts].sort((a, b) => {
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
    });
    const delta = sortedPts.length >= 2
      ? sortedPts[sortedPts.length - 1]!.raw - sortedPts[0]!.raw
      : null;
    const all = statOverviewData.allValuesForPercentile;
    const avgP = all.length ? computePercentile(avg, all) : null;
    const maxP = all.length ? computePercentile(max, all) : null;
    const minP = all.length ? computePercentile(min, all) : null;
    return { avg, max, min, stdev: sd, delta, avgP, maxP, minP };
  }, [statOverviewData]);

  const statOverviewLabel = ALL_GRAPH_METRICS.find(m => m.key === statOverviewMetric)?.label ?? statOverviewMetric;

  // ── Notes ──────────────────────────────────────────────────────────────────
  const teamNotes = pit?.images?.description?.trim() || null;

  // ── Match Overview ─────────────────────────────────────────────────────────
  const sortedTeamMatchData = useMemo(() => {
    return teamMatchData
      .filter(m => m.data_raw && Object.keys(m.data_raw).length > 0)
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
  }, [teamMatchData]);
  const effectiveMatchKey = selectedMatchKey ?? sortedTeamMatchData[sortedTeamMatchData.length - 1]?.match ?? null;
  const selectedMatch = sortedTeamMatchData.find(m => m.match === effectiveMatchKey) ?? null;

  // ── Match video/replay derived values ────────────────────────────────────────
  const tbaMatchKeyFull = useMemo(() => {
    if (!effectiveMatchKey) return null;
    return effectiveMatchKey.includes("_") ? effectiveMatchKey : currentEvent ? `${currentEvent}_${effectiveMatchKey}` : effectiveMatchKey;
  }, [effectiveMatchKey, currentEvent]);

  const matchYoutubeId = useMemo(() => {
    if (!tbaMatchKeyFull || !matchVideoCache) return null;
    const entry = matchVideoCache.data?.find((m) => m.key === tbaMatchKeyFull);
    return entry?.videos?.find((v) => v.type === "youtube")?.key ?? null;
  }, [tbaMatchKeyFull, matchVideoCache]);

  const matchAlliance = (selectedMatch?.alliance as "red" | "blue" | null) ?? null;
  const matchRaw = (selectedMatch?.data_raw as unknown as MatchDataRaw | null) ?? null;

  const matchWaypoints = useMemo(() => {
    if (!matchRaw || !matchAlliance) return [];
    return panelBuildWaypoints(matchRaw, matchSchema, matchReplayPhase, matchAlliance);
  }, [matchRaw, matchSchema, matchReplayPhase, matchAlliance]);

  const matchTotalTime = useMemo(() => {
    if (matchWaypoints.length === 0) return 1;
    return Math.max(1, matchWaypoints[matchWaypoints.length - 1]!.timestamp);
  }, [matchWaypoints]);

  const matchCurrentPos = useMemo(() => {
    if (matchWaypoints.length === 0) return null;
    const t = matchReplayProgress * matchTotalTime;
    for (let i = 1; i < matchWaypoints.length; i++) {
      const prev = matchWaypoints[i - 1]!;
      const next = matchWaypoints[i]!;
      if (next.timestamp >= t) {
        const span = next.timestamp - prev.timestamp;
        const frac = span > 0 ? (t - prev.timestamp) / span : 0;
        return { x: prev.x + (next.x - prev.x) * frac, y: prev.y + (next.y - prev.y) * frac };
      }
    }
    const last = matchWaypoints[matchWaypoints.length - 1]!;
    return { x: last.x, y: last.y };
  }, [matchWaypoints, matchReplayProgress, matchTotalTime]);

  const handleExcludeMatch = useCallback(async () => {
    if (!selectedMatch || !currentEvent || !selectedMatch.uid) return;
    setExcludingMatch(true);
    try {
      await permanentlyExcludeSubmission(currentEvent, selectedMatch as any);
      await refreshCompetition();
      setSelectedMatchKey(null);
    } catch (e) {
      console.error("[TeamPanel] Failed to exclude match:", e);
    } finally {
      setExcludingMatch(false);
    }
  }, [selectedMatch, currentEvent, refreshCompetition]);

  const openInMatches = useCallback(() => {
    if (!effectiveMatchKey) return;
    const label = getMatchLabel(effectiveMatchKey);
    addTab("/matches", label, { match: effectiveMatchKey }, `match-${effectiveMatchKey}`);
    navigate({ to: "/matches", search: { match: effectiveMatchKey } });
  }, [effectiveMatchKey, addTab, navigate]);

  const matchCanPlay = matchWaypoints.length >= 2;

  const matchTick = useCallback(() => {
    const elapsed = (performance.now() - matchStartTimeRef.current) / 1000;
    const realDuration = matchTotalTime / 1000;
    if (realDuration <= 0) return;
    const advance = (elapsed * matchReplaySpeed) / realDuration;
    const next = Math.min(1, matchLastProgressRef.current + advance);
    matchLastProgressRef.current = next;
    setMatchReplayProgress(next);
    if (next >= 1) setMatchReplayPlaying(false);
    else matchRafRef.current = requestAnimationFrame(matchTick);
  }, [matchTotalTime, matchReplaySpeed]);

  useEffect(() => {
    if (!matchReplayPlaying || matchTotalTime <= 0) return;
    matchStartTimeRef.current = performance.now();
    matchLastProgressRef.current = matchReplayProgress;
    matchRafRef.current = requestAnimationFrame(matchTick);
    return () => { if (matchRafRef.current) cancelAnimationFrame(matchRafRef.current); };
  }, [matchReplayPlaying, matchTotalTime, matchTick]);

  useEffect(() => {
    setMatchReplayProgress(0);
    setMatchReplayPlaying(false);
    matchLastProgressRef.current = 0;
  }, [effectiveMatchKey, matchReplayPhase]);

  const matchOverviewStats = useMemo(
    () => selectedMatch ? calculateSingleMatchStats(selectedMatch as any) : null,
    [selectedMatch],
  );
  const matchOverviewRaw = selectedMatch?.data_raw as unknown as MatchDataRaw | undefined;
  const matchOverviewTbaClimb = selectedMatch ? tbaClimbData[selectedMatch.match]?.[teamKey] ?? null : null;
  const matchOverviewOrientShort = (o: "left" | "right" | "center" | null) =>
    o === "left" ? "(L)" : o === "right" ? "(R)" : o === "center" ? "(C)" : "";
  const matchOverviewClimbA = useTbaClimb && matchOverviewTbaClimb?.auto_climb
    ? `${matchOverviewTbaClimb.auto_climb} ${matchOverviewOrientShort(matchOverviewStats?.climb?.autoClimbOrientation ?? null)}`.trim()
    : matchOverviewStats?.climb?.hasAutoClimb
      ? `Yes ${matchOverviewOrientShort(matchOverviewStats.climb.autoClimbOrientation)}`.trim()
      : "None";
  const matchOverviewClimbT = useTbaClimb && matchOverviewTbaClimb?.teleop_climb
    ? `${matchOverviewTbaClimb.teleop_climb} ${matchOverviewOrientShort(matchOverviewStats?.climb?.teleopClimbOrientation ?? null)}`.trim()
    : matchOverviewStats?.climb?.level
      ? `${matchOverviewStats.climb.level} ${matchOverviewOrientShort(matchOverviewStats.climb.teleopClimbOrientation)}`.trim()
      : "None";
  const matchOverviewAvgRating = (() => {
    const r = matchOverviewStats?.ratings;
    if (!r) return null;
    const vals = [r.ground, r.shooting, r.passing, r.driver].filter((v): v is number => v != null);
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  })();
  const matchOverviewMatchedAuto = matchOverviewRaw?.selectedAuto && autos.length > 0
    ? autos.find(a => (a.name || "").toLowerCase() === (matchOverviewRaw!.selectedAuto || "").toLowerCase()) ?? null
    : null;
  const matchOverviewAutoName = matchOverviewRaw?.selectedAuto || matchOverviewMatchedAuto?.name || "—";

  // ── Match Overview metric value (for selected match) ─────────────────────────
  const matchOverviewMetricValue = useMemo(() => {
    const key = matchOverviewMetric;
    if (key === "overview") return null;
    const epa = tbaTeam?.epa?.total_points?.mean ?? null;
    if (key === "epa") return epa;
    if (key === "opr") return tbaTeam?.opr ?? null;
    const stat = GRAPHABLE_STATS.find(s => s.key === key);
    if (!stat) return null;
    if (stat.source === "tba") {
      const pts = getTbaStatDataPoints(key, teamKey, tbaClimbData, epa);
      const pt = effectiveMatchKey ? pts.find(p => p.matchKey === effectiveMatchKey) : null;
      return pt?.raw ?? null;
    }
    const teamMatches = allMatchData.filter(m => m.team === teamKey);
    const pts = getStatDataPoints(key, teamMatches as any, { epa, tbaClimbData });
    const pt = effectiveMatchKey ? pts.find(p => p.matchKey === effectiveMatchKey) : null;
    return pt?.raw ?? null;
  }, [matchOverviewMetric, teamKey, effectiveMatchKey, allMatchData, tbaClimbData, tbaTeam]);

  const matchOverviewMetricLabel = ALL_GRAPH_METRICS.find(m => m.key === matchOverviewMetric)?.label ?? matchOverviewMetric;

  const matchOverviewMetricValueFormatted = matchOverviewMetricValue == null ? "—" : (() => {
    const v = matchOverviewMetricValue;
    if (["disabled_time", "block_time", "defend_time"].includes(matchOverviewMetric)) {
      return (Number.isInteger(v) ? v : v.toFixed(1)) + "s";
    }
    return typeof v === "number" && Number.isInteger(v) ? String(v) : v.toFixed(2);
  })();

  const matchOverviewMetricRankInfo = useMemo(() => {
    const key = matchOverviewMetric;
    if (!effectiveMatchKey) return null;
    if (key === "overview" || key === "epa" || key === "opr") return null; // not per-match

    const epa = tbaTeam?.epa?.total_points?.mean ?? null;
    const stat = GRAPHABLE_STATS.find((s) => s.key === key);
    if (!stat) return null;

    const pts = stat.source === "tba"
      ? getTbaStatDataPoints(key, teamKey, tbaClimbData, epa)
      : getStatDataPoints(
        key,
        allMatchData.filter((m) => m.team === teamKey) as any,
        { epa, tbaClimbData }
      );
    if (!pts.length) return null;

    // Lower is better for penalty/time-to-do metrics.
    // Note: block_time is "hold time" (higher is better), so it is NOT included here.
    const lowerIsBetter = ["disabled_time", "dismount_time", "auto_climb_time", "teleop_climb_time"].includes(key);

    const sorted = [...pts].sort((a, b) => {
      if (a.raw === b.raw) {
        const oa = getMatchSortOrder(a.matchKey);
        const ob = getMatchSortOrder(b.matchKey);
        for (let i = 0; i < Math.max(oa.length, ob.length); i++) {
          const va = oa[i] ?? 0;
          const vb = ob[i] ?? 0;
          if (va !== vb) return va - vb;
        }
        return 0;
      }
      return lowerIsBetter ? a.raw - b.raw : b.raw - a.raw;
    });

    const idx = sorted.findIndex((p) => p.matchKey === effectiveMatchKey);
    if (idx < 0) return null;
    return { rank: idx + 1, total: sorted.length };
  }, [matchOverviewMetric, effectiveMatchKey, teamKey, allMatchData, tbaClimbData, tbaTeam]);

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
        <div className="p-3 pb-8 space-y-3">

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
          {(pit && pitScouting?.name) ? (
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

                {/* Bottom: 3 columns — Autos | Name/Climb/Desc | Notes (fixed height, scroll inside) */}
                <div className="flex gap-2 h-[200px] min-h-[120px] overflow-hidden p-2">
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
                    <p className="text-xs text-muted-foreground leading-snug pr-1 pb-2">
                      {currentAuto?.description || "—"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Right: Notes (card style) — fixed height, scrolls when content overflows */}
              <div className="w-[110px] flex-shrink-0 rounded-lg border border-border bg-card overflow-hidden flex flex-col min-h-0">
                <p className="text-sm text-primary uppercase font-semibold px-3 pt-3 pb-1 bg-card shrink-0">
                  Notes
                </p>
                <div className="relative flex-1 min-h-0">
                  <div className="h-full overflow-y-auto overflow-x-hidden py-1 px-2.5 pb-6">
                    <p className="text-xs text-muted-foreground leading-snug whitespace-pre-wrap pr-1">
                      {teamNotes || "Describe any capabilities or extra information which you were not able to input into the pit..."}
                    </p>
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 h-8 pointer-events-none rounded-b-lg bg-gradient-to-t from-card to-transparent" />
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
                        <div className="flex items-center justify-between px-3 py-2">
                          
                          <p className="text-base font-medium text-primary">
                            {matchLabel} — {scouterName}
                          </p>
                          <button
                            type="button"
                            title="Open in matches view"
                            onClick={(e) => {
                              e.stopPropagation();
                              addTab("/matches", getMatchLabel(m.match), { match: m.match }, `match-${m.match}`);
                              navigate({ to: "/matches", search: { match: m.match } });
                            }}
                            className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors shrink-0"
                          >
                            <ArrowUpRight className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="flex gap-1.5 px-2 pb-2 h-[185px] shrink-0 overflow-hidden">
                          <div className="flex-1 min-w-0 rounded border border-muted-foreground/60 px-1.5 py-2 flex flex-col overflow-hidden">
                            <p className="text-[10px] font-medium text-foreground uppercase text-center shrink-0">Match Stats</p>
                            <div className="flex-1 flex flex-col justify-center gap-2 text-xs">
                              <div className="flex gap-1.5 items-baseline min-w-0 shrink-0">
                                <span className="w-14 shrink-0 text-right text-primary whitespace-nowrap">Auto:</span>
                                <span className="text-foreground tabular-nums truncate min-w-0">{stats?.auto?.shoots ?? "—"} shots</span>
                              </div>
                              <div className="flex gap-1.5 items-baseline min-w-0 shrink-0">
                                <span className="w-14 shrink-0 text-right text-primary whitespace-nowrap">Climb (A):</span>
                                <span className="text-foreground truncate min-w-0">{climbA}</span>
                              </div>
                              <div className="flex gap-1.5 items-baseline min-w-0 shrink-0">
                                <span className="w-14 shrink-0 text-right text-primary whitespace-nowrap">Climb (T):</span>
                                <span className="text-foreground truncate min-w-0">{climbT}</span>
                              </div>
                              <div className="flex gap-1.5 items-baseline min-w-0 shrink-0">
                                <span className="w-14 shrink-0 text-right text-primary whitespace-nowrap">Disable:</span>
                                <span className="text-foreground tabular-nums truncate min-w-0">
                                  {stats?.durations?.disabledTime != null
                                    ? `${Math.round(stats.durations.disabledTime)}s`
                                    : "—"}
                                </span>
                              </div>
                              <div className="flex gap-1.5 items-baseline min-w-0 shrink-0">
                                <span className="w-14 shrink-0 text-right text-primary whitespace-nowrap">Ratings:</span>
                                <span className="text-foreground tabular-nums truncate min-w-0">
                                  {avgRating != null ? avgRating.toFixed(1) : "—"}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="flex-1 min-w-0 rounded border border-muted-foreground/60 px-1.5 py-2 flex flex-col gap-1 overflow-hidden min-h-0">
                            <p className="text-[10px] font-medium text-foreground uppercase text-center shrink-0">Match Notes</p>
                            <div className="relative flex-1 min-h-0">
                              <div className="h-full overflow-y-auto overflow-x-hidden px-2 pb-2">
                                <p className="text-xs text-muted-foreground leading-snug whitespace-pre-wrap break-all text-center">
                                  {stats?.notes?.trim() || "—"}
                                </p>
                              </div>
                              <div className="absolute bottom-0 left-0 right-0 h-6 pointer-events-none bg-gradient-to-t from-card to-transparent rounded-b" />
                            </div>
                            <div className="shrink-0 space-y-0.5 text-center min-h-0 min-w-0 overflow-hidden flex flex-col">
                              <p className="text-[10px] font-medium text-foreground uppercase text-center shrink-0">Selected Auto</p>
                              <div className="relative h-[42px] min-w-0 w-full">
                                <div className="h-full overflow-y-auto overflow-x-hidden px-2 pb-2">
                                  <p className="text-xs text-muted-foreground leading-snug whitespace-pre-wrap break-all">{selectedAutoInfo}</p>
                                </div>
                                <div className="absolute bottom-0 left-0 right-0 h-5 pointer-events-none bg-gradient-to-t from-card to-transparent rounded-b" />
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
                  <div className="rounded-lg border border-border bg-card px-3 py-3 min-w-0 overflow-hidden flex flex-col justify-center h-[192px]">
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
                    ) : statOverviewData.isTeamLevel ? (
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
                    ) : (
                    <StatMatchGraph
                      pts={statOverviewData.pts}
                      allValues={statOverviewData.allValuesForPercentile}
                      metric={statOverviewMetric}
                    />
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Match Overview */}
          {sortedTeamMatchData.length > 0 && (
            <div className="rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setMatchOverviewOpen((o) => !o)}
                className="w-full flex items-center justify-between px-3 py-2 bg-muted/10 hover:bg-muted/20 transition-colors text-left"
              >
                <p className="text-base font-semibold text-primary">Match Overview</p>
                <ChevronDown
                  className={`w-4 h-4 text-muted-foreground transition-transform shrink-0 ${matchOverviewOpen ? "" : "-rotate-90"}`}
                />
              </button>
              {matchOverviewOpen && (
                <div className="p-2 space-y-2">
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-muted-foreground shrink-0">Match:</p>
                    <div className="relative flex-1 min-w-0">
                      <button
                        type="button"
                        onClick={() => setShowMatchPicker((o) => !o)}
                        className="w-full flex items-center justify-between px-3 py-1.5 text-sm rounded-md border border-border bg-card hover:bg-muted/30 text-left text-muted-foreground"
                      >
                        <span className="truncate">{effectiveMatchKey ? getMatchLabel(effectiveMatchKey) : "—"}</span>
                        <ChevronDown className="w-3.5 h-3.5 shrink-0 ml-1" />
                      </button>
                      {showMatchPicker && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setShowMatchPicker(false)} />
                          <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-md border border-border bg-secondary shadow-lg overflow-hidden">
                            <div className="max-h-[180px] overflow-y-auto">
                              {[...sortedTeamMatchData].reverse().map((m) => (
                                <button
                                  key={m.match}
                                  type="button"
                                  onClick={() => { setSelectedMatchKey(m.match); setShowMatchPicker(false); }}
                                  className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/40 transition-colors ${m.match === effectiveMatchKey ? "text-primary font-medium" : "text-muted-foreground"}`}
                                >
                                  {getMatchLabel(m.match)}
                                </button>
                              ))}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                    <button
                      type="button"
                      title="Open in matches view"
                      onClick={openInMatches}
                      disabled={!effectiveMatchKey}
                      className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors shrink-0 disabled:opacity-30"
                    >
                      <ArrowUpRight className="w-4 h-4" />
                    </button>
                  </div>
                  {selectedMatch && (
                    <div className="flex gap-2 h-[190px] overflow-hidden">
                      {/* Match Stats */}
                      <div className="flex-[1.2] min-w-0 rounded border border-muted-foreground/60 px-1.5 py-3 flex flex-col overflow-hidden">
                        <p className="text-[10px] font-medium text-foreground uppercase text-center shrink-0 mb-1">Match Stats</p>
                        <div className="flex-1 flex flex-col justify-center gap-1.5 overflow-hidden px-2 mt-0">
                          {[
                            { label: "Auto", value: matchOverviewStats?.auto?.shoots != null ? `${matchOverviewStats.auto.shoots} shots` : "—" },
                            { label: "Climb (A)", value: matchOverviewClimbA },
                            { label: "Climb (T)", value: matchOverviewClimbT },
                            { label: "Disable", value: matchOverviewStats?.durations?.disabledTime != null ? `${Math.round(matchOverviewStats.durations.disabledTime)}s` : "—" },
                            { label: "Ratings", value: matchOverviewAvgRating != null ? matchOverviewAvgRating.toFixed(1) : "—" },
                            { label: "Defense", value: matchOverviewStats?.durations?.defendTime ? `${Math.round(matchOverviewStats.durations.defendTime)}s` : "—" },
                          ].map(({ label, value }) => (
                            <div key={label} className="flex gap-1 items-baseline min-w-0 shrink-0">
                              <span className="w-[50px] shrink-0 text-right text-primary text-xs whitespace-nowrap">{label}:</span>
                              <span className="text-foreground tabular-nums truncate text-xs min-w-0">{value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      {/* Match Notes */}
                      <div className="flex-[0.8] min-w-0 rounded border border-muted-foreground/60 px-1.5 py-3 flex flex-col overflow-hidden">
                        <p className="text-[10px] font-medium text-foreground uppercase text-center shrink-0 mb-2">Match Notes</p>
                        <div className="relative flex-1 min-h-0">
                          <div className="h-full overflow-y-auto overflow-x-hidden px-1 pb-6">
                            <p className="text-xs text-muted-foreground leading-snug whitespace-pre-wrap break-words">
                              {matchOverviewStats?.notes?.trim() || "—"}
                            </p>
                          </div>
                          <div className="absolute bottom-0 left-0 right-0 h-6 pointer-events-none bg-gradient-to-t from-card to-transparent rounded-b" />
                        </div>
                      </div>
                      {/* Auto — only the elected auto for this match */}
                      <div className="flex-[1.2] min-w-0 rounded border border-muted-foreground/60 px-2 py-2 flex flex-col overflow-hidden bg-card">
                        <p className="text-[10px] font-medium text-foreground uppercase text-center shrink-0">AUTO</p>
                        <p className="text-xs text-muted-foreground text-center shrink-0 truncate mt-0.5">
                          {matchOverviewAutoName && matchOverviewAutoName !== "—" ? matchOverviewAutoName : "Not selected"}
                        </p>
                        <div className="flex-1 min-h-0 flex items-center justify-center overflow-hidden mt-1">
                          {matchOverviewMatchedAuto?.drawing ? (
                            <AutoPathPreview drawing={matchOverviewMatchedAuto.drawing} className="w-full max-h-full" />
                          ) : (
                            <div className="relative w-full flex-1 min-h-0 flex flex-col overflow-hidden">
                              <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-1 pb-4">
                                <p className="text-xs text-muted-foreground leading-snug whitespace-pre-wrap break-words">
                                  {matchOverviewMatchedAuto?.description || matchOverviewRaw?.autoDescription?.trim() || "—"}
                                </p>
                              </div>
                              <div className="absolute bottom-0 left-0 right-0 h-6 pointer-events-none bg-gradient-to-t from-card to-transparent rounded-b" />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                  {/* Match video / field replay */}
                  <div className="rounded-lg border border-border/60 overflow-hidden">
                    {/* View toggle header */}
                    <div className="flex items-center gap-1 px-1 py-1 border-b border-border/40">
                      <button
                        type="button"
                        title="Field replay"
                        onClick={() => setMatchViewMode("field")}
                        className={`p-1 rounded transition-colors ${matchViewMode === "video" ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <span className="flex-1 text-center text-xs text-muted-foreground">
                        {matchViewMode === "video" ? "Video" : "Field Replay"}
                      </span>
                      <button
                        type="button"
                        title="Video"
                        onClick={() => setMatchViewMode("video")}
                        className={`p-1 rounded transition-colors ${matchViewMode === "field" ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>

                    {matchViewMode === "video" ? (
                      matchYoutubeId ? (
                        <div className="px-2 pb-2 pt-1.5 flex flex-col gap-1.5">
                          <div
                            className="relative bg-black rounded-lg overflow-hidden w-full"
                            style={{ aspectRatio: `${PANEL_FIELD_W}/${PANEL_FIELD_H}` }}
                          >
                            <iframe
                              title={`Match video ${effectiveMatchKey}`}
                              src={`https://www.youtube.com/embed/${matchYoutubeId}`}
                              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                              allowFullScreen
                              className="absolute inset-0 w-full h-full"
                            />
                          </div>
                          <div className="flex justify-end gap-1.5">
                            <button
                              type="button"
                              title="Open in browser"
                              onClick={() => openUrl(`https://www.youtube.com/watch?v=${matchYoutubeId}`)}
                              className="flex items-center gap-1 px-2 py-1 rounded bg-muted text-muted-foreground hover:text-foreground text-xs transition-colors"
                            >
                              <ExternalLink className="size-3" />
                              Open
                            </button>
                            <button
                              type="button"
                              title="Pop out video"
                              onClick={() => {
                                const winLabel = `match-video-${Date.now()}`;
                                const url = `https://www.youtube.com/watch?v=${matchYoutubeId}`;
                                try {
                                  const win = new WebviewWindow(winLabel, {
                                    url,
                                    title: "Match Video",
                                    width: 1280,
                                    height: 720,
                                    resizable: true,
                                    center: true,
                                  });
                                  win.once("tauri://created", () => {});
                                  win.once("tauri://error", () => {});
                                } catch {}
                              }}
                              className="flex items-center gap-1 px-2 py-1 rounded bg-muted text-muted-foreground hover:text-foreground text-xs transition-colors"
                            >
                              <Maximize2 className="size-3" />
                              Pop Out
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div
                          className="flex items-center justify-center text-sm text-muted-foreground"
                          style={{ aspectRatio: `${PANEL_FIELD_W}/${PANEL_FIELD_H}` }}
                        >
                          No video available
                        </div>
                      )
                    ) : (
                      selectedMatch ? (
                        <div className="px-2 pb-2 pt-1.5 space-y-2">
                          {/* Phase filter pills */}
                          <div className="flex gap-1.5 justify-center">
                            {(["auto", "teleop", "full"] as const).map((p) => (
                              <button
                                key={p}
                                type="button"
                                onClick={() => setMatchReplayPhase(p)}
                                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${matchReplayPhase === p ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                              >
                                {p === "full" ? "Full" : p === "auto" ? "Auto" : "Teleop"}
                              </button>
                            ))}
                          </div>
                          {/* Playback controls */}
                          <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 bg-muted/50">
                            <button
                              type="button"
                              onClick={() => {
                                if (matchReplayProgress >= 1) {
                                  setMatchReplayProgress(0);
                                  matchLastProgressRef.current = 0;
                                  setMatchReplayPlaying(true);
                                } else {
                                  setMatchReplayPlaying((p) => !p);
                                }
                              }}
                              disabled={!matchCanPlay}
                              className="flex items-center justify-center size-7 rounded-full bg-primary text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                            >
                              {matchReplayPlaying ? (
                                <svg className="size-3" fill="currentColor" viewBox="0 0 24 24">
                                  <rect x="6" y="4" width="4" height="16" />
                                  <rect x="14" y="4" width="4" height="16" />
                                </svg>
                              ) : (
                                <svg className="size-3 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M8 5v14l11-7z" />
                                </svg>
                              )}
                            </button>
                            <div className="flex-1 relative h-1.5 rounded-full bg-muted overflow-visible flex items-center">
                              <div
                                className="absolute inset-y-0 left-0 rounded-full bg-primary"
                                style={{ width: `${Math.min(matchReplayProgress * 100, 98)}%` }}
                              />
                              <div
                                className="absolute top-1/2 -translate-y-1/2 size-2.5 rounded-full bg-primary border-2 border-background shadow-sm z-20 pointer-events-none"
                                style={{ left: `calc(${Math.min(matchReplayProgress * 100, 98)}% - 5px)` }}
                              />
                              <input
                                type="range"
                                min={0}
                                max={1}
                                step={0.001}
                                value={matchReplayProgress}
                                onChange={(e) => {
                                  setMatchReplayProgress(parseFloat(e.target.value));
                                  setMatchReplayPlaying(false);
                                }}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                              />
                            </div>
                            <select
                              value={matchReplaySpeed}
                              onChange={(e) => setMatchReplaySpeed(Number(e.target.value))}
                              className="bg-background border border-border rounded px-1.5 py-0.5 text-xs shrink-0"
                            >
                              {[0.25, 0.5, 1, 2, 4].map((s) => (
                                <option key={s} value={s}>{s}x</option>
                              ))}
                            </select>
                          </div>
                          {/* Field SVG */}
                          <div className="relative w-full">
                            <img src="/fullfield.svg" alt="Field" className="w-full h-auto block rounded-lg" />
                            <svg
                              className="absolute inset-0 w-full h-full"
                              viewBox={`0 0 ${PANEL_FIELD_W} ${PANEL_FIELD_H}`}
                              preserveAspectRatio="xMidYMid meet"
                            >
                              {/* Start position X marker */}
                              {matchRaw && matchAlliance && (() => {
                                const start = panelParseStartPos(matchRaw);
                                const disp = panelToDisplayCoords(start.x, start.y, matchAlliance);
                                const { x, y } = panelNormToSvg(disp.x, disp.y);
                                const sz = 8;
                                if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
                                return (
                                  <g stroke="#94a3b8" strokeWidth={2} strokeLinecap="round">
                                    <line x1={x - sz} y1={y - sz} x2={x + sz} y2={y + sz} />
                                    <line x1={x + sz} y1={y - sz} x2={x - sz} y2={y + sz} />
                                  </g>
                                );
                              })()}
                              {/* Action blobs */}
                              {matchWaypoints.map((wp, i) => {
                                if (i === 0 || !wp.actionId) return null;
                                const { x, y } = panelNormToSvg(wp.x, wp.y);
                                if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
                                const actionLabel = getActionById(matchSchema, wp.actionId)?.label ?? wp.actionId;
                                return (
                                  <TooltipProvider key={i}>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <g style={{ cursor: "help" }}>
                                          <PanelActionBlob x={x} y={y} style={panelGetStyle(wp.actionId)} />
                                        </g>
                                      </TooltipTrigger>
                                      <TooltipContent side="top" className="bg-muted text-foreground border border-border [&>svg]:fill-muted [&>svg]:bg-muted">
                                        {actionLabel}
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                );
                              })}
                              {/* Animated robot marker */}
                              {matchCurrentPos && matchAlliance && (() => {
                                const { x, y } = panelNormToSvg(matchCurrentPos.x, matchCurrentPos.y);
                                if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
                                const sz = 38;
                                const fill = matchAlliance === "red" ? "#ef4444" : "#3b82f6";
                                return (
                                  <g>
                                    <rect
                                      x={x - sz / 2} y={y - sz / 2}
                                      width={sz} height={sz}
                                      fill={fill} stroke="#fff" strokeWidth={3} rx={3}
                                    />
                                    <text
                                      x={x} y={y}
                                      textAnchor="middle" dominantBaseline="central"
                                      fill="#fff" stroke="#000" strokeWidth={1.5}
                                      paintOrder="stroke" fontSize={9} fontWeight="bold"
                                    >
                                      {teamNum}
                                    </text>
                                  </g>
                                );
                              })()}
                            </svg>
                          </div>
                        </div>
                      ) : (
                        <div
                          className="flex items-center justify-center text-sm text-muted-foreground"
                          style={{ aspectRatio: `${PANEL_FIELD_W}/${PANEL_FIELD_H}` }}
                        >
                          No match data
                        </div>
                      )
                    )}
                  </div>

                  {/* Exclude match */}
                  {selectedMatch?.uid && (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={handleExcludeMatch}
                        disabled={excludingMatch}
                        className="px-2 py-1 rounded text-xs border border-destructive/50 text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40"
                      >
                        {excludingMatch ? "Excluding…" : "Exclude match"}
                      </button>
                    </div>
                  )}

                  {/* Match Overview metric selector + value */}
                  <div className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5">
                    <p className="text-xs text-muted-foreground shrink-0">Metric:</p>
                    <div className="relative shrink-0">
                      <button
                        type="button"
                        onClick={() => setShowMatchOverviewMetricPicker(true)}
                        className="flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-border bg-card hover:bg-muted/30 text-left truncate text-muted-foreground max-w-[140px]"
                      >
                        <span className="truncate">{matchOverviewMetricLabel}</span>
                        <ChevronDown className="w-3 h-3 shrink-0" />
                      </button>
                      {showMatchOverviewMetricPicker && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setShowMatchOverviewMetricPicker(false)} />
                          <MetricPicker
                            activeMetrics={[matchOverviewMetric]}
                            onSelect={(k) => {
                              setMatchOverviewMetric(k);
                              setShowMatchOverviewMetricPicker(false);
                            }}
                            onClose={() => setShowMatchOverviewMetricPicker(false)}
                          />
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-xs text-muted-foreground/50">—</span>
                      <span className="tabular-nums text-sm text-primary">
                        {matchOverviewMetricValueFormatted}
                      </span>
                      {matchOverviewMetricRankInfo && (
                        <span className="inline-flex items-center rounded-full bg-secondary text-secondary-foreground px-2 py-0.5 text-[10px] font-medium shrink-0">
                          #{matchOverviewMetricRankInfo.rank}/{matchOverviewMetricRankInfo.total}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

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
