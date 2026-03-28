import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useCallback, useRef, useState } from "react";
import React from "react";
import { ChevronLeft } from "lucide-react";
import { useDesktopCompetitionData } from "../contexts/DesktopCompetitionDataContext";
import { useTabContext } from "../contexts/TabContext";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@lib/utils/platform";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getMatchLabel } from "@lib/utils/match";
import { getMatchActionSchema, getActionById } from "@lib/config/match-action-schemas";
import type { MatchAction, MatchDataRaw } from "@lib/config/match-action-schemas/actions.types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@shadcn/ui/components/tooltip.tsx";
const DEFENSE_ACTION_IDS = new Set(["autoDefend", "teleopDefend", "block"]);
const DISABLE_ACTION_IDS = new Set(["autoDisable", "teleopDisable"]);

// ---------------------------------------------------------------------------
// Field replay constants & helpers (mirrors matches.tsx)
// ---------------------------------------------------------------------------

const FIELD_W = 652;
const FIELD_H = 318;
const AUTO_END_MS = 20_000;

const FIELD_ACTION_STYLE: Record<string, { fill: string; shape: "circle" | "square" | "diamond" | "triangle" | "star" }> = {
  ground_intake:  { fill: "#22c55e", shape: "circle" },
  groundIntake:   { fill: "#22c55e", shape: "circle" },
  passing:        { fill: "#3b82f6", shape: "square" },
  shootPassing:   { fill: "#f97316", shape: "square" },
  shoot:          { fill: "#ef4444", shape: "diamond" },
  station_intake: { fill: "#a855f7", shape: "square" },
  stocking:       { fill: "#f59e0b", shape: "diamond" },
  stationStocked: { fill: "#f59e0b", shape: "diamond" },
  autoClimbL1:    { fill: "#06b6d4", shape: "triangle" },
  teleopClimbL1:  { fill: "#06b6d4", shape: "triangle" },
  teleopClimbL2:  { fill: "#06b6d4", shape: "triangle" },
  teleopClimbL3:  { fill: "#06b6d4", shape: "triangle" },
  climbFail:      { fill: "#ef4444", shape: "circle" },
  disable:        { fill: "#78716c", shape: "star" },
  defend:         { fill: "#f59e0b", shape: "star" },
  dropped:        { fill: "#78716c", shape: "circle" },
};
const FIELD_DEFAULT_STYLE = { fill: "#94a3b8", shape: "circle" as const };

function FieldActionBlob({ x, y, style }: { x: number; y: number; style: { fill: string; shape: string } }) {
  const r = 14;
  const { fill } = style;
  const opacity = 0.9;
  if (style.shape === "triangle") {
    const h = r * 1.2;
    return <polygon points={`${x},${y - h} ${x - r},${y + h * 0.6} ${x + r},${y + h * 0.6}`} fill={fill} opacity={opacity} />;
  }
  if (style.shape === "star") {
    const outer = r, inner = r * 0.4;
    const pts: string[] = [];
    for (let i = 0; i < 5; i++) {
      const a1 = (i * 2 * Math.PI) / 5 - Math.PI / 2;
      pts.push(`${x + outer * Math.cos(a1)},${y + outer * Math.sin(a1)}`);
      const a2 = ((i + 0.5) * 2 * Math.PI) / 5 - Math.PI / 2;
      pts.push(`${x + inner * Math.cos(a2)},${y + inner * Math.sin(a2)}`);
    }
    return <polygon points={pts.join(" ")} fill={fill} opacity={opacity} />;
  }
  if (style.shape === "square") return <rect x={x - r} y={y - r} width={r * 2} height={r * 2} fill={fill} opacity={opacity} />;
  if (style.shape === "diamond") {
    const d = r * 1.2;
    return <polygon points={`${x},${y - d} ${x + d},${y} ${x},${y + d} ${x - d},${y}`} fill={fill} opacity={opacity} />;
  }
  return <circle cx={x} cy={y} r={r} fill={fill} opacity={opacity} />;
}

function getFieldStyle(actionId: string) { return FIELD_ACTION_STYLE[actionId] ?? FIELD_DEFAULT_STYLE; }

function fieldNormToSvg(x: number, y: number) {
  const ax = Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0.5;
  const ay = Number.isFinite(y) ? Math.max(0, Math.min(1, y)) : 0.5;
  return { x: ax * FIELD_W, y: ay * FIELD_H };
}

interface FieldWaypoint { x: number; y: number; timestamp: number; actionId?: string; }

function fieldToCamelCase(s: string): string { return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()); }

function fieldParseStart(raw: MatchDataRaw | null | undefined): { x: number; y: number } {
  let x = 0.5, y = 0.9;
  if (raw?.startPosition) {
    const sp = raw.startPosition;
    if (Array.isArray(sp)) { x = Number(sp[0]); y = Number(sp[1]); }
    else { x = Number((sp as { x: number }).x); y = Number((sp as { y: number }).y); }
  }
  if (!Number.isFinite(x)) x = 0.5;
  if (!Number.isFinite(y)) y = 0.9;
  return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
}

function fieldToDisplay(x: number, y: number, alliance: "red" | "blue") {
  return alliance === "red" ? { x: x * 0.5, y } : { x: 0.5 + (1 - x) * 0.5, y };
}

function fieldGetLoc(a: MatchAction, schema: ReturnType<typeof getMatchActionSchema>): { x: number; y: number } | null {
  if (a.location) return a.location;
  const def = getActionById(schema, a.actionId) ?? getActionById(schema, fieldToCamelCase(a.actionId));
  return (def as { location?: { x: number; y: number } } | undefined)?.location ?? null;
}

function buildFieldWaypoints(
  dataRaw: MatchDataRaw | null | undefined,
  schema: ReturnType<typeof getMatchActionSchema>,
  phase: "auto" | "teleop" | "full",
  alliance: "red" | "blue"
): FieldWaypoint[] {
  if (!dataRaw) return [];
  const startDisp = fieldToDisplay(fieldParseStart(dataRaw).x, fieldParseStart(dataRaw).y, alliance);
  const autoActs = (dataRaw.autoActions ?? []).sort((a, b) => a.timestamp - b.timestamp);
  const teleopActs = (dataRaw.teleopActions ?? []).sort((a, b) => a.timestamp - b.timestamp);
  const opp: "red" | "blue" = alliance === "red" ? "blue" : "red";
  const isEpoch = [...autoActs, ...teleopActs].some((a) => a.timestamp > 1e12);
  const NO_BLOB = new Set(["defend", "teleopDefend", "autoDefend", "disable", "teleopDisable", "autoDisable"]);

  function getFailedClimbTs(acts: MatchAction[]): Set<number> {
    const failed = new Set<number>();
    acts.forEach((a, i) => {
      if (a.enabled === true && (a.actionId.startsWith("teleopClimb") || a.actionId === "autoClimbL1")) {
        for (let j = i + 1; j < acts.length; j++) {
          if (acts[j].actionId === a.actionId && acts[j].enabled === false) {
            failed.add(a.timestamp);
            break;
          }
        }
      }
    });
    return failed;
  }
  const failedAutoClimbTs = getFailedClimbTs(autoActs);
  const failedTeleopClimbTs = getFailedClimbTs(teleopActs);

  function climbY(isAuto: boolean): number {
    const pm = dataRaw!.postMatch;
    const o = isAuto ? pm?.autoClimbOrientation : pm?.teleopClimbOrientation;
    return o === "right" ? 0.25 : o === "left" ? 0.75 : 0.5;
  }

  function push(pts: FieldWaypoint[], a: MatchAction, ts: number) {
    if (a.actionId === "block") {
      const d = fieldToDisplay(0.5, 0.5, opp);
      pts.push({ x: d.x, y: d.y, timestamp: ts, actionId: a.enabled !== false ? "block" : undefined });
    } else if (a.actionId === "autoClimbL1") {
      const d = fieldToDisplay(0.05, climbY(true), alliance);
      const climbId = failedAutoClimbTs.has(a.timestamp) ? "climbFail" : (a.enabled !== false ? a.actionId : undefined);
      pts.push({ x: d.x, y: d.y, timestamp: ts, actionId: climbId });
    } else if (a.actionId.startsWith("teleopClimb")) {
      const d = fieldToDisplay(0.05, climbY(false), alliance);
      const climbId = failedTeleopClimbTs.has(a.timestamp) ? "climbFail" : (a.enabled !== false ? a.actionId : undefined);
      pts.push({ x: d.x, y: d.y, timestamp: ts, actionId: climbId });
    } else if (NO_BLOB.has(a.actionId)) {
      const last = pts[pts.length - 1]!;
      pts.push({ x: last.x, y: last.y, timestamp: ts });
    } else {
      const loc = fieldGetLoc(a, schema);
      if (loc) {
        const fa = (a as { onOpponentField?: boolean }).onOpponentField ? opp : alliance;
        const d = fieldToDisplay(loc.x, loc.y, fa);
        pts.push({ x: d.x, y: d.y, timestamp: ts, actionId: a.actionId });
      } else {
        const last = pts[pts.length - 1]!;
        pts.push({ x: last.x, y: last.y, timestamp: ts });
      }
    }
  }

  if (phase === "auto") {
    const pts: FieldWaypoint[] = [{ x: startDisp.x, y: startDisp.y, timestamp: 0 }];
    const t0 = isEpoch && autoActs.length > 0 ? Math.min(...autoActs.map((a) => a.timestamp)) - 1 : 0;
    for (const a of autoActs) push(pts, a, isEpoch ? a.timestamp - t0 : a.timestamp);
    return pts.sort((a, b) => a.timestamp - b.timestamp);
  }
  if (phase === "teleop") {
    const autoWps: FieldWaypoint[] = [{ x: startDisp.x, y: startDisp.y, timestamp: 0 }];
    const t0a = isEpoch && autoActs.length > 0 ? Math.min(...autoActs.map((a) => a.timestamp)) - 1 : 0;
    for (const a of autoActs) push(autoWps, a, isEpoch ? a.timestamp - t0a : a.timestamp);
    const last = autoWps[autoWps.length - 1]!;
    const pts: FieldWaypoint[] = [{ x: last.x, y: last.y, timestamp: 0 }];
    const t0 = isEpoch && teleopActs.length > 0 ? Math.min(...teleopActs.map((a) => a.timestamp)) - 1 : 0;
    for (const a of teleopActs) push(pts, a, isEpoch ? a.timestamp - t0 : a.timestamp - AUTO_END_MS);
    return pts.sort((a, b) => a.timestamp - b.timestamp);
  }
  const pts: FieldWaypoint[] = [{ x: startDisp.x, y: startDisp.y, timestamp: 0 }];
  const all = [...autoActs, ...teleopActs].sort((a, b) => a.timestamp - b.timestamp);
  const t0 = isEpoch && all.length > 0 ? Math.min(...all.map((a) => a.timestamp)) - 1 : 0;
  for (const a of all) push(pts, a, isEpoch ? a.timestamp - t0 : a.timestamp);
  return pts.sort((a, b) => a.timestamp - b.timestamp);
}

export const Route = createFileRoute("/timeline")({
  component: TimelinePage,
  validateSearch: (search: Record<string, unknown>) => ({
    match: (search.match as string) || "",
    team: (search.team as string) || "",
    event: (search.event as string) || "",
  }),
});

// ---------------------------------------------------------------------------
// Fixed scale constants
// ---------------------------------------------------------------------------

const PADDING = 60;
const SCALE = 7.5;       // px/s
const MAX_S = 163;
const TOTAL_W = PADDING + MAX_S * SCALE + PADDING; // ~1342px

const AUTO_END = 20;
const ENDGAME_START = 135;

// Card dimensions
const CARD_H = 58;
const CARD_W = 130;
const CARD_W_CLUSTER = 162;

// Lane layout
const DOT_R = 5;
const STEM_GAP = 20;     // min gap between card edge and dot
const CARD_LANE_GAP = 6; // vertical gap between stacked lanes
const LANE_H = CARD_H + CARD_LANE_GAP; // 64px
const CARD_MIN_GAP = 6;  // min horizontal gap between cards in same lane

// Shift band + tick
const SHIFT_H = 16;
const TICK_LABEL_OFFSET = 10; // px below dot bottom edge to tick labels
const SHIFT_OFFSET = 30;       // px below dot bottom to shift bands

// ---------------------------------------------------------------------------
// Action definitions
// ---------------------------------------------------------------------------

const ACTION_COLORS: Record<string, string> = {
  groundIntake:   "#4ade80",
  shoot:          "#60a5fa",
  passing:        "#ecc04e",
  shootPassing:   "#f97316",
  stationIntake:  "#a78bfa",
  stationStocked: "#a78bfa",
  camp:           "#f97316",
  disrupt:        "#f97316",
  dropped:        "#6b7280",
  autoDefend:     "#ef4444",
  teleopDefend:   "#ef4444",
  block:          "#ef4444",
  autoClimbL1:    "#ecc04e",
  teleopClimbL1:  "#ecc04e",
  teleopClimbL2:  "#f97316",
  teleopClimbL3:  "#22d3ee",
  autoDisable:    "#6b7280",
  teleopDisable:  "#6b7280",
  climbFail:      "#ef4444",
};

const ACTION_LABELS: Record<string, string> = {
  groundIntake:   "Ground Intake",
  shoot:          "Shoot",
  passing:        "Ground Passing",
  shootPassing:   "Shoot Passing",
  stationIntake:  "Station Intake",
  stationStocked: "Station Stocked",
  camp:           "Camp",
  disrupt:        "Disrupt",
  dropped:        "Dropped",
  autoDefend:     "Auto Defend",
  teleopDefend:   "Defend",
  block:          "Block",
  autoClimbL1:    "Auto Climb L1",
  teleopClimbL1:  "Climb L1",
  teleopClimbL2:  "Climb L2",
  teleopClimbL3:  "Climb L3",
  autoDisable:    "Auto Disable",
  teleopDisable:  "Disable",
  climbFail:      "Climb Fail",
};

const SHIFT_SEGMENTS = [
  { label: "AUTO", start: 0,   end: 20,  fill: "#202020", textFill: "#666666" },
  { label: "T1",   start: 20,  end: 33,  fill: "#242424", textFill: "#888888" },
  { label: "S1",   start: 33,  end: 58,  fill: "#1a2332", textFill: "#8aa4c0" },
  { label: "S2",   start: 58,  end: 83,  fill: "#222222", textFill: "#888888" },
  { label: "S3",   start: 83,  end: 108, fill: "#1a2332", textFill: "#8aa4c0" },
  { label: "S4",   start: 108, end: 133, fill: "#222222", textFill: "#888888" },
  { label: "E1",   start: 133, end: 163, fill: "#1a2332", textFill: "#8aa4c0" },
];

const TICK_SECONDS = [0, 20, 40, 60, 80, 100, 120, 140, 163];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ActionItem {
  actionId: string;
  seconds: number;
  phase: "auto" | "teleop";
  ordinal: number;
  holdDurationS?: number; // seconds, defined only for hold/toggle action starts
}

interface SingleItem extends ActionItem { type: "single"; }
interface ClusterItem {
  type: "cluster";
  actionId: string;
  count: number;
  seconds: number;
  phase: "auto" | "teleop";
  ordinal: number;
  holdDurationS?: number;
}
type DisplayItem = SingleItem | ClusterItem;

interface PlacedItem {
  item: DisplayItem;
  above: boolean;
  lane: number;
  cardLeft: number;
  cardWidth: number;
}

let videoPopupCounter = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clusterActions(sorted: ActionItem[]): DisplayItem[] {
  const THRESHOLD = 2;
  const out: DisplayItem[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (
      j < sorted.length &&
      sorted[j].actionId === sorted[i].actionId &&
      sorted[j].seconds - sorted[i].seconds <= THRESHOLD
    ) j++;
    const count = j - i;
    if (count > 1) {
      out.push({ type: "cluster", actionId: sorted[i].actionId, count, seconds: sorted[i].seconds, phase: sorted[i].phase, ordinal: sorted[i].ordinal, holdDurationS: sorted[i].holdDurationS });
    } else {
      out.push({ type: "single", ...sorted[i] });
    }
    i = j;
  }
  return out;
}

/**
 * Assign each display item to a lane (row) on the above or below side
 * such that no two cards in the same lane overlap horizontally.
 * Items alternate above/below by index; within each side, the greedy
 * first-fit algorithm finds the lowest (closest-to-track) available lane.
 */
function placeItems(items: DisplayItem[]): PlacedItem[] {
  const aboveLaneEndX: number[] = [];
  const belowLaneEndX: number[] = [];
  const placed: PlacedItem[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const above = i % 2 === 0;
    const cw = item.type === "cluster" ? CARD_W_CLUSTER : CARD_W;
    // For hold actions, center the card on the pill midpoint
    const holdDur = item.holdDurationS ?? 0;
    const cx = holdDur > 0 ? xOf(item.seconds + holdDur / 2) : xOf(item.seconds);
    const startX = cx - cw / 2;
    const endX   = cx + cw / 2;
    const laneEndX = above ? aboveLaneEndX : belowLaneEndX;

    let lane = 0;
    while (lane < laneEndX.length && laneEndX[lane] + CARD_MIN_GAP > startX) lane++;

    if (lane >= laneEndX.length) laneEndX.push(endX);
    else laneEndX[lane] = endX;

    placed.push({ item, above, lane, cardLeft: startX, cardWidth: cw });
  }
  return placed;
}

const xOf = (s: number) => PADDING + s * SCALE;

function ordinalSuffix(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

function openVideoExpand(youtubeId: string, seconds: number) {
  const url = `https://www.youtube.com/watch?v=${youtubeId}&t=${Math.round(seconds)}s`;
  if (isTauri()) {
    const label = `timeline-video-${++videoPopupCounter}`;
    try {
      const win = new WebviewWindow(label, { url, title: "Match Video", width: 1280, height: 720, resizable: true, center: true });
      win.once("tauri://created", () => {});
      win.once("tauri://error",   () => {});
    } catch {}
  } else {
    window.open(url, "_blank");
  }
}

function openVideoInBrowser(youtubeId: string, seconds: number) {
  const url = `https://www.youtube.com/watch?v=${youtubeId}&t=${Math.round(seconds)}s`;
  if (isTauri()) {
    openUrl(url).catch(() => {});
  } else {
    window.open(url, "_blank");
  }
}

// ---------------------------------------------------------------------------
// Action card
// ---------------------------------------------------------------------------

interface ActionCardProps {
  item: DisplayItem;
  youtubeId: string | null;
  above: boolean;
}

function ActionCard({ item, youtubeId, above: _above }: ActionCardProps) {
  const color = ACTION_COLORS[item.actionId] ?? "#6b7280";
  const label = ACTION_LABELS[item.actionId] ?? item.actionId;
  const count = item.type === "cluster" ? item.count : 1;
  const videoSeconds = Math.round(item.seconds) + 5;
  const cardWidth = item.type === "cluster" ? CARD_W_CLUSTER : CARD_W;

  const holdDurationS = item.holdDurationS;
  const timeDisplay = holdDurationS != null
    ? `${holdDurationS.toFixed(1)}s hold`
    : item.type === "cluster"
      ? `~${item.seconds.toFixed(1)}s`
      : `${item.seconds.toFixed(1)}s`;
  const ordinalLabel = ordinalSuffix(item.ordinal);

  const handleClick = (e: React.MouseEvent) => {
    if (!youtubeId) return;
    if (e.metaKey || e.ctrlKey) {
      openVideoInBrowser(youtubeId, videoSeconds);
    } else {
      openVideoExpand(youtubeId, videoSeconds);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => e.key === "Enter" && handleClick(e as unknown as React.MouseEvent)}
      className={`flex items-stretch rounded border border-border bg-card overflow-hidden transition-colors select-none ${youtubeId ? "cursor-pointer hover:border-primary/50 hover:bg-card/80" : "cursor-default opacity-80"}`}
      style={{ width: cardWidth, height: CARD_H, flexShrink: 0 }}
      title={youtubeId ? `Click to expand · ⌘Click to open in browser` : label}
    >
      <div className="shrink-0" style={{ width: 3, background: color, height: "100%" }} />
      <div className="flex flex-col justify-center" style={{ paddingLeft: 8, paddingRight: 6 }}>
        <p className="text-foreground leading-tight whitespace-nowrap overflow-hidden text-ellipsis" style={{ fontSize: 11, fontWeight: 600 }}>
          {label}{count > 1 && <span className="text-muted-foreground"> ×{count}</span>}
        </p>
        <p className="text-muted-foreground tabular-nums" style={{ fontSize: 10, marginTop: 2 }}>
          {timeDisplay} <span style={{ opacity: 0.6 }}>({ordinalLabel})</span>
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single-team field replay
// ---------------------------------------------------------------------------

function SingleTeamReplay({
  dataRaw,
  alliance,
  schema,
  teamKey,
}: {
  dataRaw: MatchDataRaw | null | undefined;
  alliance: "red" | "blue";
  schema: ReturnType<typeof getMatchActionSchema>;
  teamKey: string;
}) {
  const [phase, setPhase] = useState<"auto" | "teleop" | "full">("full");
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [progress, setProgress] = useState(0);
  const rafRef = useRef<number | undefined>(undefined);
  const startTimeRef = useRef<number>(0);
  const lastProgressRef = useRef(0);

  useEffect(() => { setProgress(0); setPlaying(false); }, [phase]);

  const waypoints = useMemo(
    () => buildFieldWaypoints(dataRaw, schema, phase, alliance),
    [dataRaw, schema, phase, alliance]
  );
  const totalTime = waypoints.length >= 2 ? waypoints[waypoints.length - 1]!.timestamp : 0;

  const currentPosition = useMemo(() => {
    if (waypoints.length === 0) return null;
    if (waypoints.length === 1 || progress >= 1) return waypoints[waypoints.length - 1]!;
    const target = progress * totalTime;
    let lastBefore = waypoints[0]!;
    for (let i = 0; i < waypoints.length - 1; i++) {
      const a = waypoints[i]!;
      const b = waypoints[i + 1]!;
      if (a.timestamp <= target) lastBefore = a;
      if (target >= a.timestamp && target <= b.timestamp) {
        const dt = b.timestamp - a.timestamp;
        const t = dt <= 0 ? 1 : (target - a.timestamp) / dt;
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        return { x: Number.isFinite(x) ? x : a.x, y: Number.isFinite(y) ? y : a.y };
      }
    }
    return lastBefore;
  }, [waypoints, progress, totalTime]);

  const tick = useCallback(() => {
    const elapsed = (performance.now() - startTimeRef.current) / 1000;
    const realDuration = totalTime / 1000;
    if (realDuration <= 0) return;
    const advance = (elapsed * speed) / realDuration;
    const next = Math.min(1, lastProgressRef.current + advance);
    lastProgressRef.current = next;
    setProgress(next);
    if (next >= 1) setPlaying(false);
    else rafRef.current = requestAnimationFrame(tick);
  }, [totalTime, speed]);

  useEffect(() => {
    if (!playing || totalTime <= 0) return;
    startTimeRef.current = performance.now();
    lastProgressRef.current = progress;
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [playing, totalTime, tick]);

  const { phaseT0, phaseIsEpoch } = useMemo(() => {
    if (!dataRaw) return { phaseT0: 0, phaseIsEpoch: false };
    const auto = dataRaw.autoActions ?? [];
    const teleop = dataRaw.teleopActions ?? [];
    const all = [...auto, ...teleop];
    const isEpoch = all.some((a) => a.timestamp > 1e12);
    if (phase === "auto") {
      return { phaseT0: isEpoch && auto.length > 0 ? Math.min(...auto.map((a) => a.timestamp)) - 1 : 0, phaseIsEpoch: isEpoch };
    }
    if (phase === "teleop") {
      return { phaseT0: isEpoch && teleop.length > 0 ? Math.min(...teleop.map((a) => a.timestamp)) - 1 : 0, phaseIsEpoch: isEpoch };
    }
    return { phaseT0: isEpoch && all.length > 0 ? Math.min(...all.map((a) => a.timestamp)) - 1 : 0, phaseIsEpoch: isEpoch };
  }, [dataRaw, phase]);

  const currentTimeMs = progress * totalTime;

  const isDefendingNow = useMemo(() => {
    if (!dataRaw) return false;
    const all = [...(dataRaw.autoActions ?? []), ...(dataRaw.teleopActions ?? [])];
    const before = all
      .filter((a) => a.actionId === "teleopDefend" || a.actionId === "defend")
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((a) => {
        let ts = phaseIsEpoch ? a.timestamp - phaseT0 : a.timestamp;
        if (!phaseIsEpoch && phase === "teleop") ts -= AUTO_END_MS;
        return { ...a, ts };
      })
      .filter((a) => a.ts <= currentTimeMs);
    return before.length > 0 && before[before.length - 1]!.enabled === true;
  }, [dataRaw, currentTimeMs, phaseT0, phaseIsEpoch, phase]);

  const isBlockingNow = useMemo(() => {
    if (!dataRaw) return false;
    const all = [...(dataRaw.autoActions ?? []), ...(dataRaw.teleopActions ?? [])];
    const before = all
      .filter((a) => a.actionId === "block")
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((a) => {
        let ts = phaseIsEpoch ? a.timestamp - phaseT0 : a.timestamp;
        if (!phaseIsEpoch && phase === "teleop") ts -= AUTO_END_MS;
        return { ...a, ts };
      })
      .filter((a) => a.ts <= currentTimeMs);
    return before.length > 0 && before[before.length - 1]!.enabled === true;
  }, [dataRaw, currentTimeMs, phaseT0, phaseIsEpoch, phase]);

  const canPlay = waypoints.length >= 2;
  const num = teamKey.replace(/frc/i, "");
  const allianceFill = alliance === "red" ? "#ef4444" : "#3b82f6";
  const fieldDisplayW = 800;

  const startDisp = dataRaw ? fieldToDisplay(
    fieldParseStart(dataRaw).x,
    fieldParseStart(dataRaw).y,
    alliance
  ) : null;

  return (
    <div className="flex flex-col items-center gap-3 py-6 px-4">
      {/* Phase tabs */}
      <div className="flex gap-2">
        {(["auto", "teleop", "full"] as const).map((p) => (
          <button key={p} type="button" onClick={() => setPhase(p)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${phase === p ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
            {p === "full" ? "Full Match" : p === "auto" ? "Auto" : "Teleop"}
          </button>
        ))}
      </div>

      {/* Playback controls */}
      <div className="flex items-center gap-3 rounded-lg p-3 bg-muted/50" style={{ width: fieldDisplayW }}>
        <button
          type="button"
          onClick={() => {
            if (progress >= 1) { setProgress(0); lastProgressRef.current = 0; setPlaying(true); }
            else setPlaying((p) => !p);
          }}
          disabled={!canPlay}
          className="flex items-center justify-center size-9 rounded-full bg-primary text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          {playing
            ? <svg className="size-4" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
            : <svg className="size-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>}
        </button>
        <div className="flex-1 relative h-2 rounded-full bg-muted overflow-visible flex items-center">
          <div className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-75" style={{ width: `${Math.min(progress * 100, 98)}%` }} />
          <div className="absolute top-1/2 -translate-y-1/2 size-3 rounded-full bg-primary border-2 border-background shadow-sm z-20 pointer-events-none transition-[left] duration-75" style={{ left: `calc(${Math.min(progress * 100, 98)}% - 6px)` }} />
          <input type="range" min={0} max={1} step={0.001} value={progress}
            onChange={(e) => { setProgress(parseFloat(e.target.value)); setPlaying(false); }}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
        </div>
        <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}
          className="bg-background border border-border rounded px-2 py-1 text-sm shrink-0">
          {[0.25, 0.5, 1, 2, 4].map((s) => <option key={s} value={s}>{s}x</option>)}
        </select>
      </div>

      {/* Field */}
      <div className="relative inline-block" style={{ width: fieldDisplayW }}>
        <img src="/fullfield.svg" alt="Field" className="w-full h-auto block rounded-lg" />
        <svg className="absolute inset-0 w-full h-full" viewBox={`0 0 ${FIELD_W} ${FIELD_H}`} preserveAspectRatio="xMidYMid meet">
          <defs>
            <style>{`@keyframes replayBlockPulse { 0% { transform: scale(1); opacity: 0.7; } 100% { transform: scale(1.7); opacity: 0; } }`}</style>
          </defs>

          {/* Start position X */}
          {startDisp && (() => {
            const { x, y } = fieldNormToSvg(startDisp.x, startDisp.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
            const sz = 12;
            return (
              <g stroke="#94a3b8" strokeWidth={3} strokeLinecap="round">
                <line x1={x - sz} y1={y - sz} x2={x + sz} y2={y + sz} />
                <line x1={x + sz} y1={y - sz} x2={x - sz} y2={y + sz} />
              </g>
            );
          })()}

          {/* Action blobs */}
          {waypoints.map((wp, i) => {
            if (i === 0 || !wp.actionId) return null;
            const { x, y } = fieldNormToSvg(wp.x, wp.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
            const style = getFieldStyle(wp.actionId);
            const blobLabel = ACTION_LABELS[wp.actionId] ?? wp.actionId;
            return (
              <Tooltip key={i}>
                <TooltipTrigger asChild>
                  <g style={{ cursor: "help" }}>
                    <FieldActionBlob x={x} y={y} style={style} />
                  </g>
                </TooltipTrigger>
                <TooltipContent side="top" className="bg-muted text-foreground border border-border">
                  {blobLabel}
                </TooltipContent>
              </Tooltip>
            );
          })}

          {/* Robot marker */}
          {currentPosition && (() => {
            const { x, y } = fieldNormToSvg(currentPosition.x, currentPosition.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
            const size = 44;
            return (
              <g>
                {isBlockingNow && (
                  <rect x={x - size / 2} y={y - size / 2} width={size} height={size}
                    fill="none" stroke="#f59e0b" strokeWidth={3} rx={4}
                    style={{ animation: "replayBlockPulse 0.9s ease-out infinite", transformBox: "fill-box", transformOrigin: "center" }} />
                )}
                <rect x={x - size / 2} y={y - size / 2} width={size} height={size}
                  fill={allianceFill}
                  stroke={isDefendingNow ? "#000000" : "#ffffff"}
                  strokeWidth={isDefendingNow ? 3 : 4}
                  rx={4} />
                <text x={x} y={y} textAnchor="middle" dominantBaseline="central"
                  fill="#fff" stroke="#000" strokeWidth={2} paintOrder="stroke"
                  fontSize={11} fontWeight="bold">
                  {num}
                </text>
              </g>
            );
          })()}
        </svg>
      </div>

      {!dataRaw && (
        <p className="text-muted-foreground text-sm">No scouting data for this match.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Climb chip
// ---------------------------------------------------------------------------

function ClimbChip({ label, value }: { label: string; value: string | null }) {
  const has = value != null && value !== "";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${has ? "bg-green-500/15 border-green-500/40 text-green-400" : "bg-muted/40 border-border text-muted-foreground"}`}>
      <span className="opacity-60">{label}:</span>
      {has ? value : "—"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function TimelinePage() {
  const { match, team, event } = Route.useSearch();
  const { closeTab } = useTabContext();
  const { matchScoutingData, tbaClimbData, schedule } = useDesktopCompetitionData();
  const [youtubeId, setYoutubeId] = useState<string | null>(null);
  const [pageTab, setPageTab] = useState<"timeline" | "replay">("timeline");
  const containerRef = useRef<HTMLDivElement>(null);

  const alliance = (schedule.find((s) => s.match === match && s.team === team)?.alliance ?? "red") as "red" | "blue";
  const schema = useMemo(() => getMatchActionSchema(event || "2026"), [event]);

  // ── Data ──
  const matchEntry = matchScoutingData.find((m) => m.match === match && m.team === team);
  const dataRaw = matchEntry?.data_raw as Record<string, unknown> | null | undefined;
  const rawAuto   = (dataRaw?.autoActions   ?? []) as MatchAction[];
  const rawTeleop = (dataRaw?.teleopActions ?? []) as MatchAction[];

  const allRaw = [...rawAuto, ...rawTeleop];
  const isEpoch = allRaw.some((a) => a.timestamp > 1e12);
  const matchStartMs = isEpoch && allRaw.length > 0 ? Math.min(...allRaw.map((a) => a.timestamp)) : 0;
  const toSec = (ts: number) => isEpoch ? (ts - matchStartMs) / 1000 : ts / 1000;

  type RawItem = Omit<ActionItem, "ordinal">;

  const isClimbActionId = (id: string) => id.startsWith("teleopClimb") || id === "autoClimbL1";

  // Build raw items (no ordinals yet) — skip hold-end events, compute hold durations
  const buildRawItems = (raw: MatchAction[], phase: "auto" | "teleop"): RawItem[] =>
    raw
      .map((a, i): RawItem | null => {
        if (a.enabled === false) return null; // hold end — skip
        let holdDurationS: number | undefined;
        let isFailed = false;
        if (a.enabled === true) {
          // Find the matching hold-end for this action
          for (let j = i + 1; j < raw.length; j++) {
            if (raw[j].actionId === a.actionId && raw[j].enabled === false) {
              holdDurationS = (raw[j].timestamp - a.timestamp) / 1000;
              if (isClimbActionId(a.actionId)) isFailed = true;
              break;
            }
          }
        }
        // A climb followed by enabled:false is a failed climb — show as climbFail, not a hold card
        if (isFailed) {
          return { actionId: "climbFail", seconds: toSec(a.timestamp), phase, holdDurationS: undefined };
        }
        return { actionId: a.actionId, seconds: toSec(a.timestamp), phase, holdDurationS };
      })
      .filter((a): a is RawItem => a !== null);

  const rawItemsSorted = [...buildRawItems(rawAuto, "auto"), ...buildRawItems(rawTeleop, "teleop")]
    .sort((a, b) => a.seconds - b.seconds);

  // Assign per-actionId ordinals in time order
  const ordinalMap: Record<string, number> = {};
  const allSorted: ActionItem[] = rawItemsSorted.map((item) => {
    const n = (ordinalMap[item.actionId] ?? 0) + 1;
    ordinalMap[item.actionId] = n;
    return { ...item, ordinal: n };
  });
  const clustered  = clusterActions(allSorted);
  const placed     = placeItems(clustered);

  // Compute lane counts
  const numAboveLanes = placed.filter(p => p.above).reduce((m, p) => Math.max(m, p.lane + 1), 1);
  const numBelowLanes = placed.filter(p => !p.above).reduce((m, p) => Math.max(m, p.lane + 1), 1);

  // Track center Y — enough room for all above lanes
  // Topmost above card (lane = numAboveLanes-1) starts at y=0
  // TRACK_CY = numAboveLanes * CARD_H + (numAboveLanes-1) * CARD_LANE_GAP + STEM_GAP + DOT_R
  const TRACK_CY = numAboveLanes * CARD_H + (numAboveLanes - 1) * CARD_LANE_GAP + STEM_GAP + DOT_R;

  // Card top y for a given lane
  const cardTopY = (above: boolean, lane: number): number => {
    if (above) {
      // Lane 0 closest to track, lane (N-1) furthest
      // Lane 0 card bottom = TRACK_CY - DOT_R - STEM_GAP
      // Lane 0 card top    = TRACK_CY - DOT_R - STEM_GAP - CARD_H
      // Lane N card top    = TRACK_CY - DOT_R - STEM_GAP - (N+1)*CARD_H - N*CARD_LANE_GAP
      return TRACK_CY - DOT_R - STEM_GAP - (lane + 1) * CARD_H - lane * CARD_LANE_GAP;
    } else {
      // Lane 0 card top = TRACK_CY + DOT_R + STEM_GAP
      return TRACK_CY + DOT_R + STEM_GAP + lane * (CARD_H + CARD_LANE_GAP);
    }
  };

  // Below area bottom
  const belowBottom = TRACK_CY + DOT_R + STEM_GAP + numBelowLanes * (CARD_H + CARD_LANE_GAP) - CARD_LANE_GAP;

  // Tick label and shift band positions
  const TICK_LABEL_Y = TRACK_CY + DOT_R + TICK_LABEL_OFFSET + 10;
  const SHIFT_TOP_Y  = belowBottom + SHIFT_OFFSET - CARD_LANE_GAP;
  const TOTAL_H = SHIFT_TOP_Y + SHIFT_H + 24;

  // TBA data
  const tbaClimb = tbaClimbData[match]?.[team];

  useEffect(() => {
    if (!event) return;
    invoke<{ data: Array<{ key: string; videos: Array<{ key: string }> }> }>("fetch_event_videos", { event }).then((vd) => {
      const entry = vd.data.find((e) => e.key === match);
      setYoutubeId(entry?.videos?.[0]?.key ?? null);
    }).catch(() => {});
  }, [event, match]);

  const matchNum    = getMatchLabel(match);
  const teamNum     = team.replace(/frc/i, "");
  const autoCount   = allSorted.filter((a) => a.phase === "auto").length;
  const teleopCount = allSorted.filter((a) => a.phase === "teleop").length;

  // First defense action (for Defend button)
  const firstDefense = allSorted.find((a) => DEFENSE_ACTION_IDS.has(a.actionId));
  const defenseVideoSeconds = firstDefense ? Math.round(firstDefense.seconds) + 5 : null;

  // First disable action (for Disable button)
  const firstDisable = allSorted.find((a) => DISABLE_ACTION_IDS.has(a.actionId));
  const disableVideoSeconds = firstDisable ? Math.round(firstDisable.seconds) + 5 : null;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* ─── Header ─── */}
      <div className="flex items-center shrink-0 border-b border-border" style={{ height: 50, paddingLeft: 32, paddingRight: 32, gap: 12 }}>
        <button type="button" onClick={() => closeTab(`timeline-${match}-${team}`)} className="text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-foreground" style={{ fontSize: 15, fontWeight: 600, whiteSpace: "nowrap" }}>Action Timeline</span>
        <div className="flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5">
          {(["timeline", "replay"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setPageTab(t)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${pageTab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              {t === "timeline" ? "Timeline" : "Replay"}
            </button>
          ))}
        </div>
        <span className="text-muted-foreground" style={{ fontSize: 14 }}>·</span>
        <span className="text-muted-foreground" style={{ fontSize: 13, whiteSpace: "nowrap" }}>{matchNum} · {teamNum}</span>
        <ClimbChip label="Auto"   value={tbaClimb?.auto_climb   ?? null} />
        <ClimbChip label="Teleop" value={tbaClimb?.teleop_climb ?? null} />
        <div className="flex-1" />
        <button
          type="button"
          disabled={!youtubeId || disableVideoSeconds === null}
          onClick={() => {
            if (youtubeId && disableVideoSeconds !== null) openVideoExpand(youtubeId, disableVideoSeconds);
          }}
          className="flex items-center gap-1.5 rounded-md transition-colors shrink-0 disabled:opacity-35 disabled:cursor-not-allowed"
          style={{
            fontSize: 12,
            fontWeight: 600,
            paddingLeft: 12,
            paddingRight: 12,
            paddingTop: 6,
            paddingBottom: 6,
            background: disableVideoSeconds !== null ? "#6b7280" : "var(--muted)",
            color: disableVideoSeconds !== null ? "#ffffff" : "var(--muted-foreground)",
          }}
          title={disableVideoSeconds !== null ? `Jump to first disable at ${disableVideoSeconds}s` : "No disable actions in this match"}
        >
          Disable
        </button>
        <button
          type="button"
          disabled={!youtubeId || defenseVideoSeconds === null}
          onClick={() => {
            if (youtubeId && defenseVideoSeconds !== null) openVideoExpand(youtubeId, defenseVideoSeconds);
          }}
          className="flex items-center gap-1.5 rounded-md transition-colors shrink-0 disabled:opacity-35 disabled:cursor-not-allowed"
          style={{
            fontSize: 12,
            fontWeight: 600,
            paddingLeft: 12,
            paddingRight: 12,
            paddingTop: 6,
            paddingBottom: 6,
            background: defenseVideoSeconds !== null ? "var(--destructive)" : "var(--muted)",
            color: defenseVideoSeconds !== null ? "var(--destructive-foreground)" : "var(--muted-foreground)",
          }}
          title={defenseVideoSeconds !== null ? `Jump to first defense at ${defenseVideoSeconds}s` : "No defense actions in this match"}
        >
          Defend
        </button>
        <span className="text-muted-foreground shrink-0" style={{ fontSize: 12 }}>
          {clustered.length} actions · {autoCount} auto · {teleopCount} teleop
        </span>
      </div>

      {/* ─── Body ─── */}
      {pageTab === "replay" ? (
        <div className="flex-1 overflow-auto">
          <SingleTeamReplay
            dataRaw={dataRaw as MatchDataRaw | null}
            alliance={alliance}
            schema={schema}
            teamKey={team}
          />
        </div>
      ) : null}
      <div ref={containerRef} className={`flex-1 overflow-auto flex items-center ${pageTab !== "timeline" ? "hidden" : ""}`}>
        {allSorted.length === 0 ? (
          <div className="flex items-center justify-center w-full text-muted-foreground text-sm">
            No action data for this match.
          </div>
        ) : (
          <div
            className="relative"
            style={{ width: TOTAL_W, height: TOTAL_H, minWidth: TOTAL_W, margin: "auto" }}
          >
            {/* ── SVG: track, dots, stems, ticks, shift bands ── */}
            <svg
              width={TOTAL_W}
              height={TOTAL_H}
              className="absolute inset-0 overflow-visible pointer-events-none"
            >
              {/* Shift band strips */}
              {SHIFT_SEGMENTS.map((seg) => {
                const x1 = xOf(seg.start), x2 = xOf(seg.end);
                return (
                  <g key={seg.label}>
                    <rect x={x1} y={SHIFT_TOP_Y} width={x2 - x1} height={SHIFT_H} fill={seg.fill} />
                    <text x={(x1 + x2) / 2} y={SHIFT_TOP_Y + SHIFT_H / 2 + 3.5} textAnchor="middle" fontSize={8} fontWeight={700} fill={seg.textFill} fontFamily="Inter, sans-serif">
                      {seg.label}
                    </text>
                  </g>
                );
              })}

              {/* Tick marks + labels */}
              {TICK_SECONDS.map((s) => {
                const x = xOf(s);
                return (
                  <g key={s}>
                    <line x1={x} y1={TRACK_CY - DOT_R - 4} x2={x} y2={TRACK_CY + DOT_R + 4} stroke="var(--border)" strokeWidth={1} />
                    <text x={x} y={TICK_LABEL_Y} textAnchor="middle" fontSize={10} fill="var(--muted-foreground)" fontFamily="Plus Jakarta Sans, Inter, sans-serif">
                      {s}s
                    </text>
                  </g>
                );
              })}

              {/* Auto separator (primary) */}
              <line x1={xOf(AUTO_END)} y1={TRACK_CY - DOT_R - 4} x2={xOf(AUTO_END)} y2={TRACK_CY + DOT_R + 4} stroke="var(--primary)" strokeWidth={2} />

              {/* Endgame separator (primary) */}
              <line x1={xOf(ENDGAME_START)} y1={TRACK_CY - DOT_R - 4} x2={xOf(ENDGAME_START)} y2={TRACK_CY + DOT_R + 4} stroke="var(--primary)" strokeWidth={2} />

              {/* Track */}
              <rect x={PADDING} y={TRACK_CY - 1} width={MAX_S * SCALE} height={2} fill="var(--border)" />
              <ellipse cx={PADDING}             cy={TRACK_CY} rx={DOT_R} ry={DOT_R} fill="var(--border)" />
              <ellipse cx={PADDING + MAX_S * SCALE} cy={TRACK_CY} rx={DOT_R} ry={DOT_R} fill="var(--border)" />

              {/* Per-item: stem + colored dot (or pill for hold actions) */}
              {placed.map((p, idx) => {
                const x     = xOf(p.item.seconds);
                const color = ACTION_COLORS[p.item.actionId] ?? "#6b7280";
                const cTop  = cardTopY(p.above, p.lane);
                const holdDur = p.item.holdDurationS;

                if (holdDur != null && holdDur > 0) {
                  const pillRy = 6;
                  const xEnd = xOf(p.item.seconds + holdDur);
                  const pillW = Math.max(xEnd - x, pillRy * 2);
                  const xMid = x + pillW / 2;
                  const stemY1 = p.above ? cTop + CARD_H : cTop;
                  const stemY2 = p.above ? TRACK_CY - pillRy : TRACK_CY + pillRy;
                  return (
                    <g key={idx}>
                      <line x1={xMid} y1={stemY1} x2={xMid} y2={stemY2} stroke="var(--border)" strokeWidth={1} />
                      <rect x={x} y={TRACK_CY - pillRy} width={pillW} height={pillRy * 2} rx={pillRy} fill={color} opacity={0.85} />
                    </g>
                  );
                }

                const stemY1 = p.above ? cTop + CARD_H : cTop;
                const stemY2 = p.above ? TRACK_CY - DOT_R : TRACK_CY + DOT_R;
                return (
                  <g key={idx}>
                    <line x1={x} y1={stemY1} x2={x} y2={stemY2} stroke="var(--border)" strokeWidth={1} />
                    <ellipse cx={x} cy={TRACK_CY} rx={DOT_R} ry={DOT_R} fill={color} />
                  </g>
                );
              })}
            </svg>

            {/* ── Action cards (HTML) ── */}
            {placed.map((p, idx) => (
              <div
                key={idx}
                className="absolute"
                style={{ left: p.cardLeft, top: cardTopY(p.above, p.lane) }}
              >
                <ActionCard item={p.item} youtubeId={youtubeId} above={p.above} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
