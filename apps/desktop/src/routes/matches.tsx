import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTabContext } from "../contexts/TabContext";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDesktopEvent } from "../contexts/DesktopEventContext";
import { useDesktopCompetitionData } from "../contexts/DesktopCompetitionDataContext";
import type { EventMatchData } from "@lib/db";
import type { TBATeam, PitScoutingData } from "../contexts/DesktopTeamDataContext";
import type { MatchScoutingData } from "../contexts/DesktopCompetitionDataContext";
import { getMatchLabel } from "@lib/utils/match";
import { getMatchActionSchema, getActionById } from "@lib/config/match-action-schemas";
import type { MatchDataRaw, MatchAction } from "@lib/config/match-action-schemas/actions.types";
import { Search, ChevronLeft, ChevronRight, CornerDownLeft, Maximize2, ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Input } from "@shadcn/ui/components/input.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@shadcn/ui/components/tooltip.tsx";
import { fetchEventVideo } from "@lib/tba/video";
import { calculateSingleMatchStats, calculateTeamStats } from "@lib/data/matchStats";
import type { TbaClimbEntry } from "../contexts/DesktopCompetitionDataContext";
import { useDesktopTeamData } from "../contexts/DesktopTeamDataContext";
import { PRESET_ACTION_LOCATIONS } from "@lib/config/fieldLocations";

export const Route = createFileRoute("/matches")({
  component: MatchesPage,
  validateSearch: (search: Record<string, unknown>) => ({
    match: (search.match as string) || "",
  }),
});

const FIELD_WIDTH = 652;
const FIELD_HEIGHT = 318;
const AUTO_END_MS = 20_000;

const ACTION_STYLE: Record<string, { fill: string; shape: "circle" | "square" | "diamond" | "triangle" | "star" }> = {
  groundIntake:   { fill: "#22c55e", shape: "circle" },
  passing:        { fill: "#3b82f6", shape: "square" },
  shoot:          { fill: "#ef4444", shape: "diamond" },
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
const DEFAULT_ACTION_STYLE = { fill: "#94a3b8", shape: "circle" as const };

/** Render action blob shape at (x, y) with r=14 */
function ActionBlobShape({
  x,
  y,
  style,
}: {
  x: number;
  y: number;
  style: { fill: string; shape: string };
}) {
  const r = 14;
  const fill = style.fill;
  const opacity = 0.9;
  if (style.shape === "triangle") {
    const h = r * 1.2;
    const points = `${x},${y - h} ${x - r},${y + h * 0.6} ${x + r},${y + h * 0.6}`;
    return <polygon points={points} fill={fill} opacity={opacity} />;
  }
  if (style.shape === "star") {
    const outer = r;
    const inner = r * 0.4;
    const points: string[] = [];
    for (let i = 0; i < 5; i++) {
      const a1 = (i * 2 * Math.PI) / 5 - Math.PI / 2;
      points.push(`${x + outer * Math.cos(a1)},${y + outer * Math.sin(a1)}`);
      const a2 = ((i + 0.5) * 2 * Math.PI) / 5 - Math.PI / 2;
      points.push(`${x + inner * Math.cos(a2)},${y + inner * Math.sin(a2)}`);
    }
    return <polygon points={points.join(" ")} fill={fill} opacity={opacity} />;
  }
  if (style.shape === "square") {
    return <rect x={x - r} y={y - r} width={r * 2} height={r * 2} fill={fill} opacity={opacity} />;
  }
  if (style.shape === "diamond") {
    const d = r * 1.2;
    const points = `${x},${y - d} ${x + d},${y} ${x},${y + d} ${x - d},${y}`;
    return <polygon points={points} fill={fill} opacity={opacity} />;
  }
  return <circle cx={x} cy={y} r={r} fill={fill} opacity={opacity} />;
}

function getStyle(actionId: string) {
  return ACTION_STYLE[actionId] ?? DEFAULT_ACTION_STYLE;
}

function getActionLabel(
  actionId: string,
  schema: ReturnType<typeof getMatchActionSchema>
): string {
  const def = getActionById(schema, actionId);
  return def?.label ?? actionId;
}

function normToSvg(x: number, y: number) {
  const ax = Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0.5;
  const ay = Number.isFinite(y) ? Math.max(0, Math.min(1, y)) : 0.5;
  return { x: ax * FIELD_WIDTH, y: ay * FIELD_HEIGHT };
}

interface Waypoint {
  x: number;
  y: number;
  timestamp: number;
  actionId?: string;
  onOpponentField?: boolean;
}


function parseStartPosition(raw: MatchDataRaw | null | undefined): { x: number; y: number } {
  let x = 0.5;
  let y = 0.9;
  if (raw?.startPosition) {
    const sp = raw.startPosition;
    if (Array.isArray(sp)) {
      x = Number(sp[0]);
      y = Number(sp[1]);
    } else {
      x = Number(sp.x);
      y = Number(sp.y);
    }
  }
  if (!Number.isFinite(x)) x = 0.5;
  if (!Number.isFinite(y)) y = 0.9;
  return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
}

/**
 * Map canonical half-field coords [0,1]×[0,1] to full-field normalized coords [0,1]×[0,1].
 * fullfield.svg: red on LEFT (x=[0,0.5]), blue on RIGHT (x=[0.5,1]).
 * Canonical space is red-alliance orientation; blue actions are mirrored to appear on their half.
 */
function toDisplayCoords(x: number, y: number, alliance: "red" | "blue") {
  if (alliance === "red") {
    return { x: x * 0.5, y };
  } else {
    // Blue canonical coords are stored in red orientation (mobile flips them);
    // mirror x to place them on the right half.
    return { x: 0.5 + (1 - x) * 0.5, y };
  }
}

/** Detect if timestamps are epoch ms (e.g. 1772006353418) vs match-relative ms (0-163000) */
function useEpochTimestamps(actions: MatchAction[]): boolean {
  return actions.some((a) => a.timestamp > 1e12);
}

function getActionLocation(
  a: MatchAction,
  schema: ReturnType<typeof getMatchActionSchema>
): { x: number; y: number } | null {
  if (a.location) return a.location;
  const def = getActionById(schema, a.actionId);
  return def?.location ?? null;
}

function buildWaypoints(
  dataRaw: MatchDataRaw | null | undefined,
  schema: ReturnType<typeof getMatchActionSchema>,
  phase: "auto" | "teleop" | "full",
  alliance: "red" | "blue"
): Waypoint[] {
  if (!dataRaw) return [];
  const start = parseStartPosition(dataRaw);
  // All waypoints are stored in full-field display coords [0,1]×[0,1] so that
  // interpolation is seamless across own/opponent halves (no coordinate system switch mid-path).
  const startDisp = toDisplayCoords(start.x, start.y, alliance);
  const autoActions = (dataRaw.autoActions || []).sort((a, b) => a.timestamp - b.timestamp);
  const teleopActions = (dataRaw.teleopActions || []).sort((a, b) => a.timestamp - b.timestamp);
  const opponentAlliance: "red" | "blue" = alliance === "red" ? "blue" : "red";

  const isEpoch = useEpochTimestamps([...autoActions, ...teleopActions]);

  // Toggle actions that anchor the robot position but do not render a blob on the field
  const NO_BLOB_TOGGLES = new Set(["defend", "teleopDefend", "autoDefend", "disable", "teleopDisable", "autoDisable"]);

  /** Orientation-based Y for climb: button order is R=top(0.25), C=mid(0.5), L=bottom(0.75) */
  function climbDispY(isAutoAction: boolean): number {
    const pm = (dataRaw as MatchDataRaw).postMatch;
    const orientation = isAutoAction ? pm?.autoClimbOrientation : pm?.teleopClimbOrientation;
    return orientation === "right" ? 0.25 : orientation === "left" ? 0.75 : 0.5;
  }

  /** Push the right waypoint(s) for a single action — coords are full-field display space */
  function pushWaypoint(pts: Waypoint[], a: MatchAction, ts: number) {
    if (a.actionId === "block") {
      // Block: robot pins to center of opponent's half. Both start and end anchor there
      // so interpolation out of block starts from opponent center (no teleport).
      const blockDisp = toDisplayCoords(0.5, 0.5, opponentAlliance);
      pts.push({ x: blockDisp.x, y: blockDisp.y, timestamp: ts, actionId: a.enabled !== false ? "block" : undefined });
    } else if (a.actionId === "autoClimbL1") {
      const disp = toDisplayCoords(0.05, climbDispY(true), alliance);
      pts.push({ x: disp.x, y: disp.y, timestamp: ts, actionId: a.enabled !== false ? a.actionId : undefined });
    } else if (a.actionId.startsWith("teleopClimb")) {
      const disp = toDisplayCoords(0.05, climbDispY(false), alliance);
      pts.push({ x: disp.x, y: disp.y, timestamp: ts, actionId: a.enabled !== false ? a.actionId : undefined });
    } else if (NO_BLOB_TOGGLES.has(a.actionId)) {
      // Defend/disable: anchor robot at last known position, no blob
      const last = pts[pts.length - 1]!;
      pts.push({ x: last.x, y: last.y, timestamp: ts });
    } else {
      const loc = getActionLocation(a, schema);
      if (loc) {
        const fieldAlliance = a.onOpponentField ? opponentAlliance : alliance;
        const disp = toDisplayCoords(loc.x, loc.y, fieldAlliance);
        pts.push({ x: disp.x, y: disp.y, timestamp: ts, actionId: a.actionId });
      } else {
        const last = pts[pts.length - 1]!;
        pts.push({ x: last.x, y: last.y, timestamp: ts });
      }
    }
  }

  if (phase === "auto") {
    const pts: Waypoint[] = [{ x: startDisp.x, y: startDisp.y, timestamp: 0 }];
    // Subtract 1 from t0 so the start position occupies ts=0 and the first action is at ts≥1,
    // ensuring the robot visibly begins at the start marker rather than snapping to the first action.
    const t0 = isEpoch && autoActions.length > 0 ? Math.min(...autoActions.map((a) => a.timestamp)) - 1 : 0;
    for (const a of autoActions) {
      pushWaypoint(pts, a, isEpoch ? a.timestamp - t0 : a.timestamp);
    }
    return pts.sort((a, b) => a.timestamp - b.timestamp);
  }

  if (phase === "teleop") {
    // Derive teleop start from the last accumulated position in auto, so it correctly
    // handles toggle-only endings (defend, disable, climb) rather than only schema locations.
    const autoWps: Waypoint[] = [{ x: startDisp.x, y: startDisp.y, timestamp: 0 }];
    const t0Auto = isEpoch && autoActions.length > 0 ? Math.min(...autoActions.map((a) => a.timestamp)) - 1 : 0;
    for (const a of autoActions) {
      pushWaypoint(autoWps, a, isEpoch ? a.timestamp - t0Auto : a.timestamp);
    }
    const lastAuto = autoWps[autoWps.length - 1]!;
    const pts: Waypoint[] = [{ x: lastAuto.x, y: lastAuto.y, timestamp: 0 }];
    const t0 = isEpoch && teleopActions.length > 0 ? Math.min(...teleopActions.map((a) => a.timestamp)) - 1 : 0;
    for (const a of teleopActions) {
      pushWaypoint(pts, a, isEpoch ? a.timestamp - t0 : a.timestamp - AUTO_END_MS);
    }
    return pts.sort((a, b) => a.timestamp - b.timestamp);
  }

  const pts: Waypoint[] = [{ x: startDisp.x, y: startDisp.y, timestamp: 0 }];
  const allActions = [...autoActions, ...teleopActions].sort((a, b) => a.timestamp - b.timestamp);
  const t0 = isEpoch && allActions.length > 0 ? Math.min(...allActions.map((a) => a.timestamp)) - 1 : 0;
  for (const a of allActions) {
    pushWaypoint(pts, a, isEpoch ? a.timestamp - t0 : a.timestamp);
  }
  return pts.sort((a, b) => a.timestamp - b.timestamp);
}

type PathPoint = { x: number; y: number };
type PathSegment = { points: PathPoint[]; color?: string; lineWidth?: number };
type DrawingData = {
  paths: PathSegment[];
  canvasWidth: number;
  canvasHeight: number;
};

type TeamAutoDisplay = {
  name?: string;
  description?: string;
  drawing?: DrawingData | null;
  climbDuringAuto?: boolean;
};

function getTeamAutos(pitData: PitScoutingData | undefined): TeamAutoDisplay[] {
  const raw = (pitData?.data as { autos?: unknown[] })?.autos ?? [];
  if (!Array.isArray(raw)) return [];
  return raw.map((a) => {
    const item = a as Record<string, unknown>;
    const drawing = item.drawing as DrawingData | null | undefined;
    return {
      name: (item.name as string | undefined) ?? undefined,
      description: (item.description as string | undefined) ?? undefined,
      drawing: drawing && Array.isArray(drawing.paths) ? drawing : undefined,
      climbDuringAuto: (item.climbDuringAuto ?? item.climb ?? false) as boolean,
    };
  });
}

/** Get index of most-selected auto from match scouting, matched to pit autos by name. Fallback: 0 */
function getMostSelectedAutoIndex(
  teamKey: string,
  teamAutos: TeamAutoDisplay[],
  matchData: EventMatchData[]
): number {
  if (teamAutos.length === 0) return 0;
  const teamStats = calculateTeamStats(teamKey, matchData);
  if (!teamStats?.autoRunCounts || Object.keys(teamStats.autoRunCounts).length === 0) return 0;
  const counts = teamStats.autoRunCounts;
  const topKey = Object.entries(counts).reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  const idx = teamAutos.findIndex((a) => (a.name || "").toLowerCase() === (topKey || "").toLowerCase());
  return idx >= 0 ? idx : 0;
}

/** Teleop climb % from TBA: (matches with L1/L2/L3) / matches_played */
function getTeleopClimbPct(
  teamKey: string,
  tbaClimbData: Record<string, Record<string, TbaClimbEntry>>
): number | null {
  let total = 0;
  let climbed = 0;
  for (const matchEntries of Object.values(tbaClimbData)) {
    const entry = matchEntries[teamKey];
    if (!entry) continue;
    total++;
    if (entry.teleop_climb === "L1" || entry.teleop_climb === "L2" || entry.teleop_climb === "L3") climbed++;
  }
  if (total === 0) return null;
  return Math.round((climbed / total) * 100);
}

/** Auto climb % from TBA: (matches with auto L1/L2/L3) / matches_played */
function getAutoClimbPct(
  teamKey: string,
  tbaClimbData: Record<string, Record<string, TbaClimbEntry>>
): number | null {
  let total = 0;
  let climbed = 0;
  for (const matchEntries of Object.values(tbaClimbData)) {
    const entry = matchEntries[teamKey];
    if (!entry) continue;
    total++;
    if (entry.auto_climb === "L1" || entry.auto_climb === "L2" || entry.auto_climb === "L3") climbed++;
  }
  if (total === 0) return null;
  return Math.round((climbed / total) * 100);
}

function getMatchedAutoForTeam(
  md: { data_raw?: Record<string, unknown> | null } | undefined,
  teamAutos: TeamAutoDisplay[],
  playbackMode?: boolean
): { label: string; drawing: DrawingData | null; name?: string; description?: string } {
  const raw = md?.data_raw as MatchDataRaw | undefined;
  if (raw?.selectedAuto && teamAutos.length > 0) {
    const matched = teamAutos.find(
      (a) => (a.name || "").toLowerCase() === (raw.selectedAuto || "").toLowerCase()
    );
    if (matched) {
      const label = matched.description?.trim()
        ? `${matched.name || raw.selectedAuto}: ${matched.description}`
        : (matched.name || (raw.selectedAuto as string) || "No auto data");
      return {
        label,
        drawing: matched.drawing ?? null,
        name: matched.name || (raw.selectedAuto as string),
        description: matched.description?.trim() || undefined,
      };
    }
    // Selected auto exists but no pit match (e.g. auto was deleted from event_team_data) — show label only, no drawing
    return { label: raw.selectedAuto as string, drawing: null, name: raw.selectedAuto as string };
  }
  if (raw?.autoDescription?.trim()) {
    return { label: raw.autoDescription, drawing: null };
  }
  // Playback: only use match data; never fall back to pit autos
  if (playbackMode && md) {
    return { label: "No auto data", drawing: null };
  }
  const firstAuto = teamAutos[0];
  if (firstAuto?.description?.trim()) {
    return {
      label: `${firstAuto.name || "Auto"}: ${firstAuto.description}`,
      drawing: firstAuto.drawing ?? null,
      name: firstAuto.name || "Auto",
      description: firstAuto.description,
    };
  }
  if (firstAuto?.name) {
    return { label: firstAuto.name, drawing: firstAuto.drawing ?? null, name: firstAuto.name };
  }
  return { label: "No auto data", drawing: null };
}

/** Field image dimensions (from red_field.svg / blue_field.svg) — path was drawn on 3:2 crop of this */
const FIELD_IMG_WIDTH = 326;
const FIELD_IMG_HEIGHT = 318;

/** Renders the drawn auto path on top of the field — matches mobile AutoPathDisplay layout */
function AutoPathPreview({ drawing, alliance, className }: { drawing: DrawingData; alliance: "red" | "blue"; className?: string }) {
  const { paths, canvasWidth, canvasHeight } = drawing;
  const fieldSrc = alliance === "red" ? "/red_field.svg" : "/blue_field.svg";
  // Drawing canvas is 3:2; DrawingCanvas uses object-cover so path maps to center 3:2 crop of field
  const cropH = FIELD_IMG_WIDTH * (2 / 3); // height of 3:2 crop with full width
  const cropY = (FIELD_IMG_HEIGHT - cropH) / 2;
  const scaleX = FIELD_IMG_WIDTH / canvasWidth;
  const scaleY = cropH / canvasHeight;
  return (
    <div className={`relative w-full overflow-hidden rounded-lg ${className || ""}`}>
      {/* Field: fills container; aspect matches field img so path overlay aligns */}
      <img src={fieldSrc} alt="Field" className="block w-full h-auto max-w-full max-h-full" />
      {/* Path SVG: overlay with viewBox matching field; transform path from 3:2 canvas to center crop */}
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
                stroke={path.color || (alliance === "red" ? "#ef4444" : "#3b82f6")}
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

function MatchPlaybackView({
  matchKey,
  currentEvent,
  schedule,
  matchData,
  teamDataByTeam,
  schema,
  onBack,
  videoCache,
  tbaClimbData,
  pitScoutingByTeam,
  onTeamClick,
}: {
  matchKey: string;
  currentEvent: string | null;
  schedule: { match: string; team: string; alliance: "red" | "blue" }[];
  matchData: MatchScoutingData[];
  teamDataByTeam: Map<string, (typeof matchData)[number]>;
  schema: ReturnType<typeof getMatchActionSchema>;
  onBack?: () => void;
  videoCache: { data: { key: string; videos: { type: string; key: string }[] }[] } | null;
  tbaClimbData: Record<string, Record<string, TbaClimbEntry>>;
  pitScoutingByTeam: Map<string, PitScoutingData>;
  onTeamClick?: (teamKey: string) => void;
}) {
  const teamsInMatch = useMemo(() => schedule.filter((s) => s.match === matchKey), [schedule, matchKey]);
  const teamsWithData = useMemo(
    () => teamsInMatch.filter((s) => teamDataByTeam.get(s.team)?.data_raw),
    [teamsInMatch, teamDataByTeam]
  );

  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [phase, setPhase] = useState<"auto" | "teleop" | "full">("full");

  // Reset progress to 0 when switching phase, entering match, or selecting a different team
  useEffect(() => {
    setProgress(0);
    setPlaying(false);
  }, [phase, matchKey, selectedTeam]);
  const [viewMode, setViewMode] = useState<"field" | "video">("field");

  const tbaMatchKey = matchKey.includes("_") ? matchKey : currentEvent ? `${currentEvent}_${matchKey}` : matchKey;
  const matchVideoEntry = videoCache?.data?.find((m) => m.key === tbaMatchKey);
  const youtubeId = matchVideoEntry?.videos?.[0]?.key ?? null;
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [progress, setProgress] = useState(0);
  const rafRef = useRef<number | undefined>(undefined);
  const startTimeRef = useRef<number>(0);
  const lastProgressRef = useRef(0);
  const videoContainerRef = useRef<HTMLDivElement>(null);

  const selectedRaw = selectedTeam ? (teamDataByTeam.get(selectedTeam)?.data_raw as MatchDataRaw | undefined) : null;
  const selAlliance = selectedTeam ? (teamsInMatch.find((t) => t.team === selectedTeam)?.alliance ?? "red") : "red";
  const waypoints = useMemo(
    () => buildWaypoints(selectedRaw, schema, phase, selAlliance),
    [selectedRaw, schema, phase, selAlliance]
  );

  const totalTime = waypoints.length >= 2 ? waypoints[waypoints.length - 1]!.timestamp : 0;

  const currentPosition = useMemo(() => {
    if (waypoints.length === 0) return null;
    if (waypoints.length === 1 || progress >= 1) return waypoints[waypoints.length - 1]!;
    const targetProgress = progress * totalTime;
    for (let i = 0; i < waypoints.length - 1; i++) {
      const a = waypoints[i]!;
      const b = waypoints[i + 1]!;
      if (targetProgress >= a.timestamp && targetProgress <= b.timestamp) {
        const dt = b.timestamp - a.timestamp;
        const t = dt <= 0 ? 1 : (targetProgress - a.timestamp) / dt;
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        return { x: Number.isFinite(x) ? x : a.x, y: Number.isFinite(y) ? y : a.y, timestamp: targetProgress };
      }
    }
    return waypoints[0]!;
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
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, totalTime, tick]);

  const canPlay = selectedTeam && waypoints.length >= 2;

  // Detect if selected team is currently defending or blocking at the current playback time
  const currentTimeMs = progress * totalTime;

  // Compute the same t0 that buildWaypoints used for the active phase, so timing aligns exactly.
  // "full" uses min(all), "auto" uses min(auto), "teleop" uses min(teleop).
  // Non-epoch data has t0=0 and teleop actions are offset by -AUTO_END_MS in buildWaypoints,
  // so we match that by adjusting non-epoch teleop timestamps the same way.
  const { phaseT0, phaseIsEpoch } = useMemo(() => {
    if (!selectedRaw) return { phaseT0: 0, phaseIsEpoch: false };
    const autoActions = selectedRaw.autoActions ?? [];
    const teleopActions = selectedRaw.teleopActions ?? [];
    const allActions = [...autoActions, ...teleopActions];
    const isEpoch = allActions.some((a) => a.timestamp > 1e12);
    if (phase === "auto") {
      const t0 = isEpoch && autoActions.length > 0 ? Math.min(...autoActions.map((a) => a.timestamp)) - 1 : 0;
      return { phaseT0: t0, phaseIsEpoch: isEpoch };
    }
    if (phase === "teleop") {
      const t0 = isEpoch && teleopActions.length > 0 ? Math.min(...teleopActions.map((a) => a.timestamp)) - 1 : 0;
      return { phaseT0: t0, phaseIsEpoch: isEpoch };
    }
    // "full"
    const t0 = isEpoch && allActions.length > 0 ? Math.min(...allActions.map((a) => a.timestamp)) - 1 : 0;
    return { phaseT0: t0, phaseIsEpoch: isEpoch };
  }, [selectedRaw, phase]);

  const isDefendingNow = useMemo(() => {
    if (!selectedRaw) return false;
    const allActions = [...(selectedRaw.autoActions ?? []), ...(selectedRaw.teleopActions ?? [])];
    const defendActions = allActions
      .filter((a) => a.actionId === "teleopDefend" || a.actionId === "defend")
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((a) => {
        // Normalize timestamp the same way buildWaypoints does for this phase
        let ts = phaseIsEpoch ? a.timestamp - phaseT0 : a.timestamp;
        if (!phaseIsEpoch && phase === "teleop") ts -= AUTO_END_MS;
        return { ...a, ts };
      });
    const before = defendActions.filter((a) => a.ts <= currentTimeMs);
    if (before.length === 0) return false;
    return before[before.length - 1]!.enabled === true;
  }, [selectedRaw, currentTimeMs, phaseT0, phaseIsEpoch, phase]);

  const isBlockingNow = useMemo(() => {
    if (!selectedRaw) return false;
    const allActions = [...(selectedRaw.autoActions ?? []), ...(selectedRaw.teleopActions ?? [])];
    const blockActions = allActions
      .filter((a) => a.actionId === "block")
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((a) => {
        let ts = phaseIsEpoch ? a.timestamp - phaseT0 : a.timestamp;
        if (!phaseIsEpoch && phase === "teleop") ts -= AUTO_END_MS;
        return { ...a, ts };
      });
    const before = blockActions.filter((a) => a.ts <= currentTimeMs);
    if (before.length === 0) return false;
    return before[before.length - 1]!.enabled === true;
  }, [selectedRaw, currentTimeMs, phaseT0, phaseIsEpoch, phase]);

  const fieldContainerWidth = Math.min(FIELD_WIDTH, 560);
  const tbaMatchKeyForClimb = matchKey.includes("_") ? matchKey : currentEvent ? `${currentEvent}_${matchKey}` : matchKey;
  const climbForMatch = tbaClimbData[tbaMatchKeyForClimb] ?? {};

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full overflow-x-hidden">
      {/* Centered header: QM number + curved arrow back — compact for more space */}
      <div className="pt-2 pb-1 px-4 flex flex-col items-center gap-1">
        <h1 className="text-xl font-semibold text-primary">{getMatchLabel(matchKey)}</h1>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground text-xs"
            aria-label="Back to all matches"
          >
            <CornerDownLeft className="size-3.5" />
            <span>All matches</span>
          </button>
        )}
      </div>
      <div className="flex-1 overflow-auto overflow-x-hidden px-4 pt-2 pb-4 min-h-0 flex">
        {/* Three-column: left/right = full height; center = playback + field; all centered horizontally */}
        <div className="flex flex-1 items-stretch justify-center gap-16 w-full max-w-[min(100%,1600px)] mx-auto min-h-0">
          {/* Left column — full page height, team boxes centered */}
          <div className="flex flex-col justify-center items-center gap-8 w-[220px] shrink-0 py-4">
            {teamsInMatch
              .filter((s) => s.alliance === "blue")
              .map((s) => {
                const md = teamDataByTeam.get(s.team);
                const hasScoutedData = !!md?.data_raw;
                const teamAutos = getTeamAutos(pitScoutingByTeam.get(s.team));
                const { label: autoLabel, drawing, name, description } = getMatchedAutoForTeam(hasScoutedData ? md : undefined, teamAutos, true);
                const tbaClimb = climbForMatch[s.team]?.auto_climb ?? null;
                const climbLabel = tbaClimb ?? "None";
                const matchStats = md ? calculateSingleMatchStats(md as unknown as EventMatchData) : null;
                const autoShoots = matchStats?.auto?.shoots ?? null;
                const isSelected = selectedTeam === s.team;
                return (
                  <div
                    key={s.team}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedTeam(s.team)}
                    onKeyDown={(e) => e.key === "Enter" && setSelectedTeam(s.team)}
                    className={`rounded-xl border-4 bg-blue-500/10 p-3 w-[220px] h-[220px] flex flex-col flex-shrink-0 overflow-hidden cursor-pointer ${isSelected ? "" : "border-blue-500"}`}
                    style={isSelected ? { borderColor: "hsl(var(--primary))" } : undefined}
                  >
                    <div className="flex items-center justify-between shrink-0 mb-1 gap-1">
                      <p className="text-base font-semibold text-foreground truncate flex-1 text-center">Team {s.team.replace(/frc/i, "")}</p>
                      {onTeamClick && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onTeamClick(s.team); }}
                          className="p-0.5 rounded text-foreground/40 hover:text-foreground transition-colors flex-shrink-0"
                          title="Open team page"
                        >
                          <Maximize2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                    {hasScoutedData ? (
                      <>
                        <div className="w-full flex-1 min-h-0 overflow-hidden rounded flex items-center justify-center bg-muted/20">
                          {drawing ? (
                            <AutoPathPreview drawing={drawing} alliance="blue" className="w-full h-full max-w-full max-h-full" />
                          ) : (description || (autoLabel && autoLabel !== "No auto data")) ? (
                            <div className="px-2 py-1.5 rounded-lg bg-muted/60 border border-border text-sm text-center text-muted-foreground line-clamp-4 w-full">
                              <span className="font-medium text-foreground">Notes:</span> {description || autoLabel}
                            </div>
                          ) : (
                            <p className="text-sm text-center px-1 line-clamp-3">
                              {name != null ? (
                                <span className="text-primary">{name}</span>
                              ) : (
                                <span className="text-muted-foreground">{autoLabel}</span>
                              )}
                            </p>
                          )}
                        </div>
                        {drawing && (
                          <p className="text-xs truncate shrink-0 mt-1 text-center">
                            {name != null ? (
                              <>
                                <span className="text-primary">{name}</span>
                                {description != null && <span className="text-muted-foreground">: {description}</span>}
                              </>
                            ) : (
                              <span className="text-muted-foreground">{autoLabel}</span>
                            )}
                          </p>
                        )}
                      </>
                    ) : (
                      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">No match data</div>
                    )}
                    <p className="text-sm font-medium text-foreground truncate shrink-0 mt-auto text-center">
                      <span className="text-primary">Auto Climb:</span> {climbLabel}
                      {hasScoutedData && autoShoots != null && (
                        <>
                          <span className="text-muted-foreground mx-1">|</span>
                          <><span className="text-foreground">{autoShoots}</span> <span className="text-primary">shoots</span></>
                        </>
                      )}
                    </p>
                  </div>
                );
              })}
          </div>

        {/* Center column — playback + field/video only, at top */}
        <div className="flex flex-col shrink-0 self-start gap-3" style={{ width: fieldContainerWidth }}>
          {/* Phase filter + playback — hidden when viewing video */}
          {viewMode === "field" && (
          <div className="flex flex-col gap-2">
            <div className="flex gap-2 justify-center">
              {(["auto", "teleop", "full"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPhase(p)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                    phase === p ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {p === "full" ? "Full Match" : p === "auto" ? "Auto" : "Teleop"}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3 rounded-lg p-3 bg-muted/50">
              <button
                type="button"
                onClick={() => {
                  if (progress >= 1) {
                    setProgress(0);
                    lastProgressRef.current = 0;
                    setPlaying(true);
                  } else {
                    setPlaying((p) => !p);
                  }
                }}
                disabled={!canPlay}
                className="flex items-center justify-center size-9 rounded-full bg-primary text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              >
                {playing ? (
                  <svg className="size-4" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
                ) : (
                  <svg className="size-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                )}
              </button>
              <div className="flex-1 relative h-2 rounded-full bg-muted overflow-visible flex items-center">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-primary"
                  style={{ width: `${Math.min(progress * 100, 98)}%` }}
                />
                <div
                  className="absolute top-1/2 -translate-y-1/2 size-3 rounded-full bg-primary border-2 border-background shadow-sm z-20 pointer-events-none"
                  style={{ left: `calc(${Math.min(progress * 100, 98)}% - 6px)` }}
                />
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.001}
                  value={progress}
                  onChange={(e) => {
                    setProgress(parseFloat(e.target.value));
                    setPlaying(false);
                  }}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
              </div>
              <select
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                className="bg-background border border-border rounded px-2 py-1 text-sm shrink-0"
              >
                {[0.25, 0.5, 1, 2, 4].map((s) => (
                  <option key={s} value={s}>{s}x</option>
                ))}
              </select>
            </div>
          </div>
          )}
          {/* Field / Video */}
          <div className="flex items-center justify-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => setViewMode("field")}
            className={`p-2 rounded-lg transition-colors ${viewMode === "field" ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground"}`}
            aria-label="Show field"
          >
            <ChevronLeft className="size-6" />
          </button>
          <div
            className="relative flex-1 flex justify-center"
            style={{ width: fieldContainerWidth, maxWidth: "100%", minHeight: (FIELD_HEIGHT / FIELD_WIDTH) * fieldContainerWidth }}
          >
            {viewMode === "field" ? (
              <div className="relative inline-block w-full" style={{ width: fieldContainerWidth, maxWidth: "100%" }}>
            <img src="/fullfield.svg" alt="Field" className="w-full h-auto block" />
            <svg
              className="absolute inset-0 w-full h-full"
              viewBox={`0 0 ${FIELD_WIDTH} ${FIELD_HEIGHT}`}
              preserveAspectRatio="xMidYMid meet"
            >
              <defs>
                <style>{`@keyframes robotBlockPulse { 0% { transform: scale(1); opacity: 0.7; } 100% { transform: scale(1.7); opacity: 0; } }`}</style>
              </defs>
              {/* X at selected team's start position */}
              {selectedTeam && (() => {
                const s = teamsWithData.find((t) => t.team === selectedTeam);
                if (!s) return null;
                const raw = teamDataByTeam.get(s.team)?.data_raw as MatchDataRaw | undefined;
                const start = raw ? parseStartPosition(raw) : { x: 0.5, y: 0.9 };
                const disp = toDisplayCoords(start.x, start.y, s.alliance);
                const { x, y } = normToSvg(disp.x, disp.y);
                const size = 12;
                if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
                return (
                  <g stroke="#94a3b8" strokeWidth={3} strokeLinecap="round">
                    <line x1={x - size} y1={y - size} x2={x + size} y2={y + size} />
                    <line x1={x + size} y1={y - size} x2={x - size} y2={y + size} />
                  </g>
                );
              })()}
              {/* Action blobs for selected team — render before team markers so numbers stay on top */}
              {selectedTeam &&
                (() => {
                  return waypoints.map((wp, i) => {
                    if (i === 0 || !wp.actionId) return null;
                    // Waypoints carry full-field display coords — use directly
                    const { x, y } = normToSvg(wp.x, wp.y);
                    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
                    const style = getStyle(wp.actionId);
                    const label = getActionLabel(wp.actionId, schema);
                    return (
                      <Tooltip key={i}>
                        <TooltipTrigger asChild>
                          <g style={{ cursor: "help" }}>
                            <ActionBlobShape x={x} y={y} style={style} />
                          </g>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="bg-muted text-foreground border border-border [&>svg]:fill-muted [&>svg]:bg-muted">
                          {label}
                        </TooltipContent>
                      </Tooltip>
                    );
                  });
                })()}
              {/* Team markers: rendered last so numbers stay on top of action blobs */}
              {teamsWithData.map((s) => {
                const raw = teamDataByTeam.get(s.team)?.data_raw as MatchDataRaw | undefined;
                const start = raw ? parseStartPosition(raw) : { x: 0.5, y: 0.9 };
                const isSelected = selectedTeam === s.team;
                const showAtCurrent = isSelected && currentPosition;
                // Waypoints carry full-field display coords; fall back to converted start position
                const pos = showAtCurrent ? currentPosition! : toDisplayCoords(start.x, start.y, s.alliance);
                const defending = isSelected && isDefendingNow;
                const blocking = isSelected && isBlockingNow;
                const { x, y } = normToSvg(pos.x, pos.y);
                const num = s.team.replace(/frc/i, "");
                const allianceFill = s.alliance === "red" ? "#ef4444" : "#3b82f6";
                const fill = allianceFill;
                const stroke = defending ? "#000000" : isSelected ? "#fff" : "transparent";
                const strokeWidth = defending ? 3 : isSelected ? 4 : 0;
                const size = isSelected ? 44 : 38;
                if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
                return (
                  <g
                    key={s.team}
                    className="cursor-pointer"
                    onClick={() => setSelectedTeam(s.team)}
                  >
                    {/* Pulsing ring on robot when actively blocking */}
                    {blocking && (
                      <rect
                        x={x - size / 2}
                        y={y - size / 2}
                        width={size}
                        height={size}
                        fill="none"
                        stroke="#f59e0b"
                        strokeWidth={3}
                        rx={4}
                        style={{
                          animation: "robotBlockPulse 0.9s ease-out infinite",
                          transformBox: "fill-box",
                          transformOrigin: "center",
                        }}
                      />
                    )}
                    <rect
                      x={x - size / 2}
                      y={y - size / 2}
                      width={size}
                      height={size}
                      fill={fill}
                      stroke={stroke}
                      strokeWidth={strokeWidth}
                      rx={4}
                    />
                    <text
                      x={x}
                      y={y}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="#fff"
                      stroke="#000"
                      strokeWidth={2}
                      paintOrder="stroke"
                      fontSize={11}
                      fontWeight="bold"
                    >
                      {num}
                    </text>
                  </g>
                );
              })}
            </svg>
              </div>
            ) : youtubeId ? (
              <div className="flex flex-col gap-1.5" style={{ width: fieldContainerWidth, maxWidth: "100%" }}>
                <div ref={videoContainerRef} className="relative bg-black rounded-lg overflow-hidden w-full" style={{ aspectRatio: `${FIELD_WIDTH} / ${FIELD_HEIGHT}` }}>
                  <iframe
                    title={`Match video ${matchKey}`}
                    src={`https://www.youtube.com/embed/${youtubeId}`}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="absolute inset-0 w-full h-full"
                  />
                </div>
                <div className="flex justify-end gap-1.5">
                  <button
                    type="button"
                    title="Open in browser"
                    onClick={() => openUrl(`https://www.youtube.com/watch?v=${youtubeId}`)}
                    className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded bg-muted text-muted-foreground hover:text-foreground text-xs transition-colors"
                  >
                    <ExternalLink className="size-3.5" />
                    Open
                  </button>
                  <button
                    type="button"
                    title="Pop out video"
                    onClick={() => {
                      const label = `match-video-${Date.now()}`;
                      const url = `https://www.youtube.com/watch?v=${youtubeId}`;
                      console.log("[Video] Creating popup window", { label, url });
                      try {
                        const win = new WebviewWindow(label, {
                          url,
                          title: "Match Video",
                          width: 1280,
                          height: 720,
                          resizable: true,
                          center: true,
                        });
                        win.once("tauri://created", () => console.log("[Video] Popup created successfully"));
                        win.once("tauri://error", (e) => console.error("[Video] Popup creation error", e));
                      } catch (err) {
                        console.error("[Video] WebviewWindow constructor threw", err);
                      }
                    }}
                    className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded bg-muted text-muted-foreground hover:text-foreground text-xs transition-colors"
                  >
                    <Maximize2 className="size-3.5" />
                    Pop Out
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center rounded-lg border border-border bg-muted/30 text-muted-foreground text-sm" style={{ width: fieldContainerWidth, maxWidth: "100%", aspectRatio: `${FIELD_WIDTH} / ${FIELD_HEIGHT}` }}>
                No video available for this match
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setViewMode("video")}
            className={`p-2 rounded-lg transition-colors ${viewMode === "video" ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground"}`}
            aria-label="Show video"
          >
            <ChevronRight className="size-6" />
          </button>
          </div>
        </div>

          {/* Right column — full page height, team boxes centered */}
          <div className="flex flex-col justify-center items-center gap-8 w-[220px] shrink-0 py-4">
            {teamsInMatch
              .filter((s) => s.alliance === "red")
              .map((s) => {
                const md = teamDataByTeam.get(s.team);
                const hasScoutedData = !!md?.data_raw;
                const teamAutos = getTeamAutos(pitScoutingByTeam.get(s.team));
                const { label: autoLabel, drawing, name, description } = getMatchedAutoForTeam(hasScoutedData ? md : undefined, teamAutos, true);
                const tbaClimb = climbForMatch[s.team]?.auto_climb ?? null;
                const climbLabel = tbaClimb ?? "None";
                const matchStats = md ? calculateSingleMatchStats(md as unknown as EventMatchData) : null;
                const autoShoots = matchStats?.auto?.shoots ?? null;
                const isSelected = selectedTeam === s.team;
                return (
                  <div
                    key={s.team}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedTeam(s.team)}
                    onKeyDown={(e) => e.key === "Enter" && setSelectedTeam(s.team)}
                    className={`rounded-xl border-4 bg-red-500/10 p-3 w-[220px] h-[220px] flex flex-col flex-shrink-0 overflow-hidden cursor-pointer ${isSelected ? "" : "border-red-500"}`}
                    style={isSelected ? { borderColor: "hsl(var(--primary))" } : undefined}
                  >
                    <div className="flex items-center justify-between shrink-0 mb-1 gap-1">
                      <p className="text-base font-semibold text-foreground truncate flex-1 text-center">Team {s.team.replace(/frc/i, "")}</p>
                      {onTeamClick && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onTeamClick(s.team); }}
                          className="p-0.5 rounded text-foreground/40 hover:text-foreground transition-colors flex-shrink-0"
                          title="Open team page"
                        >
                          <Maximize2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                    {hasScoutedData ? (
                      <>
                        <div className="w-full flex-1 min-h-0 overflow-hidden rounded flex items-center justify-center bg-muted/20">
                          {drawing ? (
                            <AutoPathPreview drawing={drawing} alliance="red" className="w-full h-full max-w-full max-h-full" />
                          ) : (description || (autoLabel && autoLabel !== "No auto data")) ? (
                            <div className="px-2 py-1.5 rounded-lg bg-muted/60 border border-border text-sm text-center text-muted-foreground line-clamp-4 w-full">
                              <span className="font-medium text-foreground">Notes:</span> {description || autoLabel}
                            </div>
                          ) : (
                            <p className="text-sm text-center px-1 line-clamp-3">
                              {name != null ? (
                                <span className="text-primary">{name}</span>
                              ) : (
                                <span className="text-muted-foreground">{autoLabel}</span>
                              )}
                            </p>
                          )}
                        </div>
                        {drawing && (
                          <p className="text-xs truncate shrink-0 mt-1 text-center">
                            {name != null ? (
                              <>
                                <span className="text-primary">{name}</span>
                                {description != null && <span className="text-muted-foreground">: {description}</span>}
                              </>
                            ) : (
                              <span className="text-muted-foreground">{autoLabel}</span>
                            )}
                          </p>
                        )}
                      </>
                    ) : (
                      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">No match data</div>
                    )}
                    <p className="text-sm font-medium text-foreground truncate shrink-0 mt-auto text-center">
                      <span className="text-primary">Auto Climb:</span> {climbLabel}
                      {hasScoutedData && autoShoots != null && (
                        <>
                          <span className="text-muted-foreground mx-1">|</span>
                          <><span className="text-foreground">{autoShoots}</span> <span className="text-primary">shoots</span></>
                        </>
                      )}
                    </p>
                  </div>
                );
              })}
          </div>
        </div>
      </div>
    </div>
  );
}

const fieldContainerWidth = 560;

/** Colors for multi-team auto path display (darker, muted — no red/blue/yellow to avoid overlap) */
const TEAM_AUTO_COLORS = ["#0d9488", "#7c3aed", "#059669", "#6366f1", "#64748b", "#0891b2"];

/** Fullfield path overlay: path in 326x318 space, positioned for alliance. Red=left half, blue=right half */
function FullfieldPathOverlay({
  drawing,
  alliance,
  strokeColor: strokeColorOverride,
}: {
  drawing: DrawingData;
  alliance: "red" | "blue";
  strokeColor?: string;
}) {
  const { paths, canvasWidth, canvasHeight } = drawing;
  const cropH = FIELD_IMG_WIDTH * (2 / 3);
  const cropY = (FIELD_IMG_HEIGHT - cropH) / 2;
  const scaleX = FIELD_IMG_WIDTH / canvasWidth;
  const scaleY = cropH / canvasHeight;
  const xOffset = alliance === "red" ? 0 : FIELD_IMG_WIDTH;
  const strokeColor = strokeColorOverride ?? (alliance === "red" ? "#ef4444" : "#3b82f6");
  return (
    <g transform={`translate(${xOffset}, ${cropY}) scale(${scaleX}, ${scaleY})`}>
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
            stroke={strokeColorOverride != null ? strokeColor : (path.color || strokeColor)}
            strokeWidth={path.lineWidth ?? 3}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}
    </g>
  );
}

function MatchPredictionView({
  matchKey,
  schedule,
  matchData,
  tbaClimbData,
  pitScoutingByTeam,
  tbaTeams,
  onBack,
  onTeamClick,
}: {
  matchKey: string;
  schedule: { match: string; team: string; alliance: "red" | "blue" }[];
  matchData: EventMatchData[];
  tbaClimbData: Record<string, Record<string, TbaClimbEntry>>;
  pitScoutingByTeam: Map<string, PitScoutingData>;
  tbaTeams: TBATeam[];
  onBack?: () => void;
  onTeamClick?: (teamKey: string) => void;
}) {
  const teamsInMatch = useMemo(() => schedule.filter((s) => s.match === matchKey), [schedule, matchKey]);
  const [selectedAutosForDisplay, setSelectedAutosForDisplay] = useState<Array<{ team: string; autoIndex: number }>>([]);

  // Per-team auto index (for cycling with arrows)
  const [autoIndexByTeam, setAutoIndexByTeam] = useState<Record<string, number>>({});

  const getEpa = useCallback((teamKey: string) => {
    const t = tbaTeams.find((x) => x.key === teamKey);
    return t?.epa?.total_points?.mean ?? null;
  }, [tbaTeams]);

  const toggleAutoSelection = useCallback((team: string, autoIndex: number) => {
    setSelectedAutosForDisplay((prev) => {
      const existingIdx = prev.findIndex((s) => s.team === team);
      if (existingIdx >= 0 && prev[existingIdx]!.autoIndex === autoIndex) {
        // Same auto clicked — deselect
        return prev.filter((_, i) => i !== existingIdx);
      }
      if (existingIdx >= 0) {
        // Different auto for same team — replace (only one auto per team at a time)
        return prev.map((s, i) => (i === existingIdx ? { team, autoIndex } : s));
      }
      // New team — add
      return [...prev, { team, autoIndex }];
    });
  }, []);

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full overflow-x-hidden">
      <div className="pt-2 pb-1 px-4 flex flex-col items-center gap-1 relative">
        <h1 className="text-xl font-semibold text-primary">{getMatchLabel(matchKey)}</h1>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground text-xs"
            aria-label="Back to all matches"
          >
            <CornerDownLeft className="size-3.5" />
            <span>All matches</span>
          </button>
        )}
      </div>
      <div className="flex-1 overflow-auto overflow-x-hidden px-4 pt-2 pb-4 min-h-0 flex">
        <div className="flex flex-1 items-stretch justify-center gap-16 w-full max-w-[min(100%,1600px)] mx-auto min-h-0">
          {/* Blue teams */}
          <div className="flex flex-col justify-center items-center gap-8 w-[220px] shrink-0 py-4">
            {teamsInMatch
              .filter((s) => s.alliance === "blue")
              .map((s) => {
                const selIdx = selectedAutosForDisplay.findIndex((sel) => sel.team === s.team && sel.autoIndex === (autoIndexByTeam[s.team] ?? getMostSelectedAutoIndex(s.team, getTeamAutos(pitScoutingByTeam.get(s.team)), matchData)));
                const selectedColor = selIdx >= 0 ? TEAM_AUTO_COLORS[selIdx % TEAM_AUTO_COLORS.length] : undefined;
                return (
                <PredictionTeamBox
                  key={s.team}
                  team={s.team}
                  alliance="blue"
                  pitScoutingByTeam={pitScoutingByTeam}
                  matchData={matchData}
                  tbaClimbData={tbaClimbData}
                  epa={getEpa(s.team)}
                  autoIndexByTeam={autoIndexByTeam}
                  setAutoIndexByTeam={setAutoIndexByTeam}
                  selectedAutosForDisplay={selectedAutosForDisplay}
                  onSelectAuto={toggleAutoSelection}
                  selectedBorderColor={selectedColor}
                  onTeamClick={onTeamClick}
                />
              );})}
          </div>

          {/* Center: static fullfield with overlay */}
          <div className="flex flex-col shrink-0 self-start gap-3" style={{ width: fieldContainerWidth }}>
            <div className="relative inline-block w-full" style={{ maxWidth: "100%" }}>
              <img src="/fullfield.svg" alt="Field" className="w-full h-auto block" />
              <svg
                className="absolute inset-0 w-full h-full"
                viewBox={`0 0 ${FIELD_WIDTH} ${FIELD_HEIGHT}`}
                preserveAspectRatio="xMidYMid meet"
                style={{ pointerEvents: "none" }}
              >
                {selectedAutosForDisplay.map((sel, i) => {
                  const pit = pitScoutingByTeam.get(sel.team);
                  const autos = getTeamAutos(pit);
                  const auto = autos[sel.autoIndex];
                  const alliance = teamsInMatch.find((t) => t.team === sel.team)?.alliance ?? "red";
                  if (!auto?.drawing) return null;
                  const color = TEAM_AUTO_COLORS[i % TEAM_AUTO_COLORS.length];
                  return (
                    <g key={`${sel.team}-${sel.autoIndex}`}>
                      <FullfieldPathOverlay drawing={auto.drawing} alliance={alliance} strokeColor={color} />
                      {auto.climbDuringAuto && (() => {
                        const [nx, ny] = PRESET_ACTION_LOCATIONS.climb;
                        const climbDisp = toDisplayCoords(nx, ny, alliance);
                        const { x, y } = normToSvg(climbDisp.x, climbDisp.y);
                        return <circle key={`${sel.team}-${sel.autoIndex}-climb`} cx={x} cy={y} r={8} fill={color} opacity={0.9} />;
                      })()}
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>

          {/* Red teams */}
          <div className="flex flex-col justify-center items-center gap-8 w-[220px] shrink-0 py-4">
            {teamsInMatch
              .filter((s) => s.alliance === "red")
              .map((s) => {
                const selIdx = selectedAutosForDisplay.findIndex((sel) => sel.team === s.team && sel.autoIndex === (autoIndexByTeam[s.team] ?? getMostSelectedAutoIndex(s.team, getTeamAutos(pitScoutingByTeam.get(s.team)), matchData)));
                const selectedColor = selIdx >= 0 ? TEAM_AUTO_COLORS[selIdx % TEAM_AUTO_COLORS.length] : undefined;
                return (
                <PredictionTeamBox
                  key={s.team}
                  team={s.team}
                  alliance="red"
                  pitScoutingByTeam={pitScoutingByTeam}
                  matchData={matchData}
                  tbaClimbData={tbaClimbData}
                  epa={getEpa(s.team)}
                  autoIndexByTeam={autoIndexByTeam}
                  setAutoIndexByTeam={setAutoIndexByTeam}
                  selectedAutosForDisplay={selectedAutosForDisplay}
                  onSelectAuto={toggleAutoSelection}
                  selectedBorderColor={selectedColor}
                  onTeamClick={onTeamClick}
                />
              );})}
          </div>
        </div>
      </div>
    </div>
  );
}

function PredictionTeamBox({
  team,
  alliance,
  pitScoutingByTeam,
  matchData,
  tbaClimbData,
  epa,
  autoIndexByTeam,
  setAutoIndexByTeam,
  selectedAutosForDisplay,
  onSelectAuto,
  selectedBorderColor,
  onTeamClick,
}: {
  team: string;
  alliance: "red" | "blue";
  pitScoutingByTeam: Map<string, PitScoutingData>;
  matchData: EventMatchData[];
  tbaClimbData: Record<string, Record<string, TbaClimbEntry>>;
  epa: number | null;
  autoIndexByTeam: Record<string, number>;
  setAutoIndexByTeam: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  selectedAutosForDisplay: Array<{ team: string; autoIndex: number }>;
  onSelectAuto: (team: string, autoIndex: number) => void;
  selectedBorderColor?: string;
  onTeamClick?: (teamKey: string) => void;
}) {
  const teamAutos = getTeamAutos(pitScoutingByTeam.get(team));
  const defaultIdx = getMostSelectedAutoIndex(team, teamAutos, matchData);
  const idx = autoIndexByTeam[team] ?? defaultIdx;
  const setIdx = (i: number) => setAutoIndexByTeam((prev) => ({ ...prev, [team]: i }));
  const currentAuto = teamAutos[idx];
  const climbPct = getTeleopClimbPct(team, tbaClimbData);
  const autoClimbPct = getAutoClimbPct(team, tbaClimbData);
  const teamStats = calculateTeamStats(team, matchData);
  const autoLabelForLookup = currentAuto?.name || `Auto ${idx + 1}`;
  const autoRunCount = teamStats?.autoRunCounts
    ? Object.entries(teamStats.autoRunCounts).find(
        ([k]) => (k || "").toLowerCase() === (autoLabelForLookup || "").toLowerCase()
      )?.[1] ?? 0
    : 0;
  const isSelected = selectedAutosForDisplay.some((s) => s.team === team && s.autoIndex === idx);
  const borderColor = alliance === "red" ? "border-red-500" : "border-blue-500";
  const bgColor = alliance === "red" ? "bg-red-500/10" : "bg-blue-500/10";

  return (
    <div
      className={`rounded-xl border-4 p-3 w-[220px] h-[220px] flex flex-col flex-shrink-0 overflow-hidden transition-all ${teamAutos.length > 0 ? "cursor-pointer" : ""} ${!isSelected ? borderColor : ""} ${bgColor}`}
      style={isSelected ? { borderColor: selectedBorderColor ?? "hsl(var(--primary))" } : undefined}
      onClick={() => teamAutos.length > 0 && onSelectAuto(team, idx)}
    >
      <div className="flex items-center justify-between shrink-0 mb-1 gap-1">
        <p className="text-base font-semibold text-foreground truncate flex-1 text-center">
          Team {team.replace(/frc/i, "")}
          {epa != null && <span className="text-muted-foreground font-normal"> · {epa.toFixed(1)} EPA</span>}
        </p>
        {onTeamClick && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onTeamClick(team); }}
            className="p-0.5 rounded text-foreground/40 hover:text-foreground transition-colors flex-shrink-0"
            title="Open team page"
          >
            <Maximize2 className="size-3.5" />
          </button>
        )}
      </div>
      {teamAutos.length > 0 ? (
        <>
          <div className="flex items-center justify-center gap-1 flex-1 min-h-0">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setIdx(idx <= 0 ? teamAutos.length - 1 : idx - 1); }}
              className={`p-1.5 shrink-0 transition-colors ${teamAutos.length > 1 ? "text-white hover:text-yellow-400" : "text-muted-foreground hover:text-foreground"}`}
              aria-label="Previous auto"
            >
              <ChevronLeft className="size-5" />
            </button>
            <div className="flex-1 min-h-0 overflow-hidden rounded flex items-center justify-center bg-muted/20 p-1">
              {currentAuto?.drawing ? (
                <AutoPathPreview drawing={currentAuto.drawing} alliance={alliance} className="w-full h-full max-w-full max-h-full" />
              ) : (
                <p className="text-sm text-center px-1 line-clamp-3">
                  {currentAuto?.name ? (
                    <>
                      <span className="text-primary">{currentAuto.name}</span>
                      {currentAuto.description && <span className="text-muted-foreground">: {currentAuto.description}</span>}
                    </>
                  ) : (
                    <span className="text-muted-foreground">No auto data</span>
                  )}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setIdx(idx >= teamAutos.length - 1 ? 0 : idx + 1); }}
              className={`p-1.5 shrink-0 transition-colors ${teamAutos.length > 1 ? "text-white hover:text-yellow-400" : "text-muted-foreground hover:text-foreground"}`}
              aria-label="Next auto"
            >
              <ChevronRight className="size-5" />
            </button>
          </div>
          <p className="text-xs truncate shrink-0 mt-1 text-center">
            <span className="text-foreground">{currentAuto?.name || `Auto ${idx + 1}`}</span>
            <span className="text-primary"> · {autoRunCount}×</span>
            {currentAuto?.climbDuringAuto && (
              <span className="inline-flex items-center ml-1.5" title="Climbs during auto">
                <span className="inline-block size-2.5 rounded-full bg-[#22c55e]" aria-hidden />
              </span>
            )}
          </p>
          <p className="text-sm font-medium text-foreground truncate shrink-0 mt-auto text-center">
            <span className="text-primary">Tele Climb:</span> {climbPct != null ? `${climbPct}%` : "—"}
            <span className="text-muted-foreground mx-1">|</span>
            <span className="text-foreground">Auto: {autoClimbPct != null ? `${autoClimbPct}%` : "—"}</span>
          </p>
        </>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          <p className="text-sm text-muted-foreground text-center">No pit autos</p>
          <p className="text-sm font-medium text-foreground text-center">
            <span className="text-primary">Tele Climb:</span> {climbPct != null ? `${climbPct}%` : "—"}
            <span className="text-muted-foreground mx-1">|</span>
            <span className="text-foreground">Auto: {autoClimbPct != null ? `${autoClimbPct}%` : "—"}</span>
          </p>
        </div>
      )}
    </div>
  );
}

function MatchesPage() {
  const navigate = useNavigate();
  const { addTab } = useTabContext();
  const { match: matchKey } = Route.useSearch();
  const { currentEvent } = useDesktopEvent();
  const { schedule, tbaClimbData, tbaSchedule, matchScoutingData } = useDesktopCompetitionData();
  const { tbaTeams, pitScoutingData } = useDesktopTeamData();
  const [search, setSearch] = useState("");
  const matchData = matchScoutingData;
  const [videoCache, setVideoCache] = useState<{ data: { key: string; videos: { type: string; key: string }[] }[] } | null>(null);

  const schema = useMemo(() => getMatchActionSchema(currentEvent || "2026"), [currentEvent]);

  const pitScoutingByTeam = useMemo(() => {
    const map = new Map<string, PitScoutingData>();
    for (const p of pitScoutingData) {
      if (p.team) map.set(p.team, p);
    }
    return map;
  }, [pitScoutingData]);

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
        const [, aNum] = (a.match.match(/qm(\d+)/i) || []);
        const [, bNum] = (b.match.match(/qm(\d+)/i) || []);
        if (aNum && bNum) return parseInt(aNum, 10) - parseInt(bNum, 10);
        return (a.match || "").localeCompare(b.match || "");
      });
  }, [schedule]);

  const filtered = useMemo(() => {
    if (!search.trim()) return matches;
    const q = search.trim().toLowerCase();
    return matches.filter(
      (m) =>
        getMatchLabel(m.match).toLowerCase().includes(q) ||
        m.red.some((t) => t.toLowerCase().includes(q)) ||
        m.blue.some((t) => t.toLowerCase().includes(q))
    );
  }, [matches, search]);

  const teamDataByTeam = useMemo(() => {
    const map = new Map<string, (typeof matchData)[number]>();
    for (const m of matchData) {
      if (m.match === matchKey) map.set(m.team, m);
    }
    return map;
  }, [matchData, matchKey]);

  useEffect(() => {
    if (!currentEvent) return;
    fetchEventVideo(currentEvent).then((data) => {
      setVideoCache(data && typeof data === "object" ? data : null);
    });
  }, [currentEvent]);

  const handleSelectMatch = (key: string) => {
    const label = getMatchLabel(key);
    addTab("/matches", label, { match: key }, `match-${key}`);
    navigate({ to: "/matches", search: { match: key } });
  };

  const handleTeamClick = (teamKey: string) => {
    const teamNum = teamKey.replace("frc", "");
    addTab("/team", `Team ${teamNum}`, { team: teamKey }, `team-${teamKey}`);
    navigate({ to: "/team", search: { team: teamKey } });
  };

  const matchHasHappened = useMemo(() => {
    if (!matchKey) return false;
    const tba = tbaSchedule[matchKey];
    if (!tba?.est_time) return false;
    return tba.est_time < Math.floor(Date.now() / 1000);
  }, [matchKey, tbaSchedule]);

  if (matchKey) {
    if (!matchHasHappened) {
      return (
        <MatchPredictionView
          key={matchKey}
          matchKey={matchKey}
          schedule={schedule}
          matchData={matchData as unknown as EventMatchData[]}
          tbaClimbData={tbaClimbData}
          pitScoutingByTeam={pitScoutingByTeam}
          tbaTeams={tbaTeams}
          onBack={() => navigate({ to: "/matches", search: { match: "" } })}
          onTeamClick={handleTeamClick}
        />
      );
    }

    return (
      <MatchPlaybackView
        matchKey={matchKey}
        currentEvent={currentEvent}
        schedule={schedule}
        matchData={matchData}
        teamDataByTeam={teamDataByTeam}
        schema={schema}
        onBack={() => navigate({ to: "/matches", search: { match: "" } })}
        videoCache={videoCache}
        tbaClimbData={tbaClimbData}
        pitScoutingByTeam={pitScoutingByTeam}
        onTeamClick={handleTeamClick}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-border">
        <h1 className="text-xl font-semibold text-foreground mb-3">Matches</h1>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search by match or team..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4 min-h-0">
        <div className="grid gap-2">
          {filtered.map((m) => (
            <button
              key={m.match}
              type="button"
              onClick={() => handleSelectMatch(m.match)}
              className="text-left p-4 rounded-lg border-2 border-border bg-background hover:bg-muted/50 hover:border-primary/50 transition-colors"
            >
              <div className="font-semibold text-primary">{getMatchLabel(m.match)}</div>
              <div className="text-sm mt-1 flex gap-4">
                <span><span className="text-red-500 font-bold">Red</span>: <span className="text-muted-foreground">{m.red.map((t) => t.replace("frc", "")).join(", ")}</span></span>
                <span><span className="text-blue-500 font-bold">Blue</span>: <span className="text-muted-foreground">{m.blue.map((t) => t.replace("frc", "")).join(", ")}</span></span>
              </div>
            </button>
          ))}
        </div>
        {filtered.length === 0 && (
          <p className="text-muted-foreground text-sm">
            {search ? "No matches match your search." : "No matches found. Select an event with schedule data."}
          </p>
        )}
      </div>
    </div>
  );
}
