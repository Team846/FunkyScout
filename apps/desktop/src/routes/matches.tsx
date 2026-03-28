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
import { Activity, Maximize2, Search, ChevronLeft, ChevronRight } from "lucide-react";
import React from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { Input } from "@shadcn/ui/components/input.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@shadcn/ui/components/tooltip.tsx";
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




interface Waypoint {
  x: number;
  y: number;
  timestamp: number;
  actionId?: string;
}

function toCamelCase(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
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
  const def = getActionById(schema, a.actionId) ?? getActionById(schema, toCamelCase(a.actionId));
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
        const fieldAlliance = (a as { onOpponentField?: boolean }).onOpponentField ? opponentAlliance : alliance;
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
  videoCache,
  pitScoutingByTeam,
  tbaSchedule,
}: {
  matchKey: string;
  currentEvent: string | null;
  schedule: { match: string; team: string; alliance: "red" | "blue" }[];
  matchData: MatchScoutingData[];
  teamDataByTeam: Map<string, (typeof matchData)[number]>;
  schema: ReturnType<typeof getMatchActionSchema>;
  videoCache: { data: { key: string; videos: { type: string; key: string }[] }[] } | null;
  pitScoutingByTeam: Map<string, PitScoutingData>;
  tbaSchedule: Record<string, { redScore: number | null; blueScore: number | null }>;
}) {
  const navigate = useNavigate();
  const { addTab } = useTabContext();
  const teamsInMatch = useMemo(() => schedule.filter((s) => s.match === matchKey), [schedule, matchKey]);
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [teamCardPage, setTeamCardPage] = useState<Record<string, "auto" | "teleop">>({});
  const [phase] = useState<"auto" | "teleop" | "full">("full");

  // Reset progress to 0 when switching phase, entering match, or selecting a different team
  useEffect(() => {
    setProgress(0);
    setPlaying(false);
  }, [phase, matchKey, selectedTeam]);

  useEffect(() => {
    // Reset per-team paging when switching matches.
    setTeamCardPage({});
  }, [matchKey]);

  // Auto/Teleop metrics list should reflect what the event actually collected.
  // We scan the event's `matchData` for actionIds that exist in stored submissions.
  const availableAutoActionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of matchData) {
      const raw = (m as any)?.data_raw as MatchDataRaw | undefined | null;
      if (!raw?.autoActions) continue;
      for (const a of raw.autoActions) {
        if (a?.actionId) ids.add(a.actionId);
      }
    }
    return ids;
  }, [matchData]);

  const availableTeleopActionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of matchData) {
      const raw = (m as any)?.data_raw as MatchDataRaw | undefined | null;
      if (!raw?.teleopActions) continue;
      for (const a of raw.teleopActions) {
        if (a?.actionId) ids.add(a.actionId);
      }
    }
    return ids;
  }, [matchData]);

  const showAutoIntakes = availableAutoActionIds.has("groundIntake");
  const showAutoPasses = availableAutoActionIds.has("passing");
  const showAutoShootPasses = availableAutoActionIds.has("shootPassing");
  const showAutoShoots = availableAutoActionIds.has("shoot");
  const showAutoStocking = availableAutoActionIds.has("stationStocked");
  const showAutoCamps = availableAutoActionIds.has("camp");
  const showAutoDisrupts = availableAutoActionIds.has("disrupt");

  const showTeleopIntakes = availableTeleopActionIds.has("groundIntake");
  const showTeleopPasses = availableTeleopActionIds.has("passing");
  const showTeleopShootPasses = availableTeleopActionIds.has("shootPassing");
  const showTeleopShoots = availableTeleopActionIds.has("shoot");
  const showTeleopStocking = availableTeleopActionIds.has("stationStocked");
  const showTeleopCamps = availableTeleopActionIds.has("camp");
  const showTeleopDisrupts = availableTeleopActionIds.has("disrupt");

  function MetricCell({
    show,
    label,
    value,
  }: {
    show: boolean;
    label: string;
    value: number | null | undefined;
  }) {
    if (!show) return null;
    return (
      <div className="flex justify-between gap-3">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-foreground tabular-nums">{value ?? "—"}</span>
      </div>
    );
  }

  const tbaMatchKey = matchKey.includes("_") ? matchKey : currentEvent ? `${currentEvent}_${matchKey}` : matchKey;
  const matchVideoEntry = videoCache?.data?.find((m) => m.key === tbaMatchKey);
  const youtubeId = matchVideoEntry?.videos?.[0]?.key ?? null;
  const [playing, setPlaying] = useState(false);
  const [speed, _setSpeed] = useState(1);
  const [progress, setProgress] = useState(0);
  const rafRef = useRef<number | undefined>(undefined);
  const startTimeRef = useRef<number>(0);
  const lastProgressRef = useRef(0);
  const selectedRaw = selectedTeam ? (teamDataByTeam.get(selectedTeam)?.data_raw as MatchDataRaw | undefined) : null;
  const selAlliance = selectedTeam ? (teamsInMatch.find((t) => t.team === selectedTeam)?.alliance ?? "red") : "red";
  const waypoints = useMemo(
    () => buildWaypoints(selectedRaw, schema, phase, selAlliance),
    [selectedRaw, schema, phase, selAlliance]
  );

  const totalTime = waypoints.length >= 2 ? waypoints[waypoints.length - 1]!.timestamp : 0;


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


  // Scores from tbaSchedule (already fetched by desktop sync)
  const scheduleEntry = tbaSchedule[tbaMatchKey] ?? tbaSchedule[matchKey];
  const redScore = scheduleEntry?.redScore ?? null;
  const blueScore = scheduleEntry?.blueScore ?? null;

  // RP fetched on-demand from TBA (not stored in tbaSchedule)
  const [matchRP, setMatchRP] = useState<{ red: number | null; blue: number | null }>({ red: null, blue: null });
  useEffect(() => {
    setMatchRP({ red: null, blue: null });
    invoke<{ red: number | null; blue: number | null }>("fetch_match_rp", { matchKey: tbaMatchKey }).then((data) => {
      if (data.red !== null || data.blue !== null) setMatchRP({ red: data.red, blue: data.blue });
    }).catch(() => {});
  }, [tbaMatchKey]);

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full overflow-x-hidden">
      {(redScore !== null || blueScore !== null) && (
        <div className="flex items-center justify-between px-[max(240px,30vw)] py-2 bg-background shrink-0">
          <div className="flex flex-col items-center min-w-[60px]">
            <span className="text-3xl font-bold text-red-400 tabular-nums">{redScore ?? "—"}</span>
            {matchRP.red !== null && <span className="text-xs text-muted-foreground">{matchRP.red} RP</span>}
          </div>
          <span className="text-muted-foreground text-sm font-medium">vs</span>
          <div className="flex flex-col items-center min-w-[60px]">
            <span className="text-3xl font-bold text-blue-400 tabular-nums">{blueScore ?? "—"}</span>
            {matchRP.blue !== null && <span className="text-xs text-muted-foreground">{matchRP.blue} RP</span>}
          </div>
        </div>
      )}
      <div className="flex-1 overflow-auto overflow-x-hidden px-4 pt-2 pb-4 min-h-0 flex">
        {/* Circular layout container */}
        <div className="relative flex-1 w-full max-w-[min(100%,1200px)] h-[min(860px,calc(100vh-170px))] mx-auto min-h-[680px]">
          {/* Blue alliance cards */}
          <div className="contents">
            {teamsInMatch
              .filter((s) => s.alliance === "blue")
              .map((s, idx) => {
                const md = teamDataByTeam.get(s.team);
                const hasScoutedData = !!md?.data_raw;
                const teamAutos = getTeamAutos(pitScoutingByTeam.get(s.team));
                const { label: autoLabel, drawing, name } = getMatchedAutoForTeam(hasScoutedData ? md : undefined, teamAutos, true);
                const matchStats = md ? calculateSingleMatchStats(md as unknown as EventMatchData) : null;
                const isSelected = selectedTeam === s.team;
                const page = teamCardPage[s.team] ?? "auto";
                const bluePos =
                  [
                    { right: "2%", top: "8%" },
                    { right: "2%", bottom: "8%" },
                    { left: "50%", bottom: "1%", transform: "translateX(-50%)" },
                  ][idx] ?? { right: "2%", top: "8%" };
                return (
                  <div
                    key={s.team}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      // Clicking the card selects the team; Auto/Teleop is switched only via buttons.
                      setSelectedTeam(s.team);
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      setSelectedTeam(s.team);
                    }}
                    className={`absolute rounded-xl border-4 bg-blue-500/10 p-3 w-[min(260px,24vw)] h-[min(260px,24vw)] min-w-[220px] min-h-[220px] flex flex-col flex-shrink-0 overflow-hidden cursor-pointer ${isSelected ? "" : "border-blue-500"}`}
                    style={isSelected ? { ...bluePos, borderColor: "hsl(var(--primary))" } : bluePos}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-base font-semibold text-foreground shrink-0 truncate">
                        Team {s.team.replace(/frc/i, "")}
                      </p>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          title="Open action timeline"
                          onClick={(e) => {
                            e.stopPropagation();
                            addTab(
                              "/timeline",
                              `Timeline · ${getMatchLabel(matchKey)}`,
                              { match: matchKey, team: s.team, event: currentEvent ?? "" },
                              `timeline-${matchKey}-${s.team}`
                            );
                            navigate({
                              to: "/timeline",
                              search: { match: matchKey, team: s.team, event: currentEvent ?? "" },
                            });
                          }}
                          className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors shrink-0"
                        >
                          <Activity className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          title="Open team page"
                          onClick={(e) => {
                            e.stopPropagation();
                            addTab(
                              "/team",
                              `Team ${s.team.replace(/frc/i, "")}`,
                              { team: s.team },
                              `team-${s.team}`
                            );
                            navigate({ to: "/team", search: { team: s.team } });
                          }}
                          className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors shrink-0"
                        >
                          <Maximize2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-1 bg-muted/20 rounded-lg p-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setTeamCardPage((prev) => ({ ...prev, [s.team]: "auto" }));
                        }}
                        className={`h-7 rounded-md text-xs font-medium transition-colors ${
                          page === "auto" ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Auto
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setTeamCardPage((prev) => ({ ...prev, [s.team]: "teleop" }));
                        }}
                        className={`h-7 rounded-md text-xs font-medium transition-colors ${
                          page === "teleop" ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Teleop
                      </button>
                    </div>

                    <div className="mt-2 flex-1 min-h-0 overflow-y-auto overflow-x-hidden rounded-lg border border-border/40 bg-muted/10 p-2">
                      {page === "auto" ? (
                        <div className="flex flex-col gap-2 min-h-0">
                          <div className="h-[95px] overflow-hidden rounded-md bg-background/30 border border-border/40">
                            {hasScoutedData ? (
                              drawing ? (
                                <AutoPathPreview drawing={drawing} alliance="blue" className="w-full h-full max-w-full max-h-full" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center px-2 text-xs text-muted-foreground text-center">
                                  {name ?? autoLabel}
                                </div>
                              )
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
                                No match data
                              </div>
                            )}
                          </div>
                          <div className="min-h-0">
                            {/* Match-style pills (mirrors Teleop section layout) */}
                            <div className="flex items-center gap-2">
                              <span
                                className={`px-2 py-1 rounded text-[11px] font-medium flex-1 text-center ${
                                  matchStats?.didDefend
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-muted text-muted-foreground"
                                }`}
                              >
                                Defend
                              </span>
                              <span
                                className={`px-2 py-1 rounded text-[11px] font-medium flex-1 text-center ${
                                  matchStats?.wasDisabled
                                    ? "bg-red-500 text-white"
                                    : "bg-muted text-muted-foreground"
                                }`}
                              >
                                Disable
                              </span>
                            </div>

                            <div className="flex items-center gap-2">
                              <span
                                className={`px-2 py-1 rounded text-[11px] font-medium flex-1 text-center ${
                                  matchStats?.climb.hasAutoClimb
                                    ? "bg-green-500/20 text-green-400 border border-green-500/30"
                                    : "bg-muted text-muted-foreground"
                                }`}
                              >
                                {matchStats?.climb.hasAutoClimb
                                  ? `Climb (A): Yes${
                                      matchStats?.climb.autoClimbTime != null
                                        ? ` (${Math.round(matchStats.climb.autoClimbTime)}s)`
                                        : ""
                                    }${
                                      matchStats?.climb.autoClimbOrientation
                                        ? ` · ${matchStats.climb.autoClimbOrientation}`
                                        : ""
                                    }`
                                  : "Climb (A): None"}
                              </span>
                            </div>

                            <div className="text-[11px] font-semibold text-primary uppercase tracking-wide mb-1 mt-2">Auto actions</div>
                            <div className="text-[11px] space-y-1">
                              <MetricCell show={showAutoIntakes} label="Intakes" value={matchStats?.auto.intakes} />
                              <MetricCell show={showAutoPasses} label="Passes" value={matchStats?.auto.passes} />
                              <MetricCell
                                show={showAutoShootPasses}
                                label="Shoot passes"
                                value={matchStats?.auto.shootPasses}
                              />
                              <MetricCell show={showAutoShoots} label="Shoots" value={matchStats?.auto.shoots} />
                              <MetricCell show={showAutoStocking} label="Stocking" value={matchStats?.auto.stocking} />
                              <MetricCell show={showAutoCamps} label="Camps" value={matchStats?.auto.camps} />
                              <MetricCell show={showAutoDisrupts} label="Disrupts" value={matchStats?.auto.disrupts} />
                            </div>

                            <div className="mt-2 pt-2 border-t border-border/40 text-[11px]">
                              <div className="flex justify-between gap-3">
                                <span className="text-muted-foreground">Total auto actions</span>
                                <span className="text-foreground tabular-nums">{matchStats?.timeline.totalAutoActions ?? "—"}</span>
                              </div>
                              <div className="mt-1 flex justify-between gap-3">
                                <span className="text-muted-foreground">Auto density</span>
                                <span className="text-foreground tabular-nums">
                                  {matchStats?.timeline.autoActionDensity != null ? matchStats.timeline.autoActionDensity.toFixed(2) : "—"}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2 min-h-0">
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-2 py-1 rounded text-[11px] font-medium flex-1 text-center ${
                                matchStats?.didDefend ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                              }`}
                            >
                              Defend
                            </span>
                            <span
                              className={`px-2 py-1 rounded text-[11px] font-medium flex-1 text-center ${
                                matchStats?.wasDisabled ? "bg-red-500 text-white" : "bg-muted text-muted-foreground"
                              }`}
                            >
                              Disable
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-2 py-1 rounded text-[11px] font-medium flex-1 text-center ${
                                matchStats?.climb.level ? "bg-green-500/20 text-green-400 border border-green-500/30" : "bg-muted text-muted-foreground"
                              }`}
                            >
                              Climb (T): {matchStats?.climb.level ?? "None"}
                            </span>
                          </div>
                          <div className="min-h-0">
                            <div className="text-[11px] font-semibold text-primary uppercase tracking-wide mb-1">Teleop stats</div>
                            <div className="grid grid-cols-2 gap-2 text-[11px]">
                              <MetricCell show={showTeleopIntakes} label="Intakes" value={matchStats?.teleop.intakes} />
                              <MetricCell show={showTeleopPasses} label="Passes" value={matchStats?.teleop.passes} />
                              <MetricCell
                                show={showTeleopShootPasses}
                                label="Shoot passes"
                                value={matchStats?.teleop.shootPasses}
                              />
                              <MetricCell show={showTeleopShoots} label="Shoots" value={matchStats?.teleop.shoots} />
                              <MetricCell
                                show={showTeleopStocking}
                                label="Stocking"
                                value={matchStats?.teleop.stocking}
                              />
                              <MetricCell show={showTeleopCamps} label="Camps" value={matchStats?.teleop.camps} />
                              <MetricCell show={showTeleopDisrupts} label="Disrupts" value={matchStats?.teleop.disrupts} />
                            </div>
                            <div className="mt-2 pt-2 border-t border-border/40 text-[11px]">
                              {(() => {
                                const r = matchStats?.ratings;
                                const fmt = (v: number | null | undefined) => (v != null ? v.toFixed(1) : "—");
                                if (!r) {
                                  return (
                                    <div className="flex justify-between gap-3">
                                      <span className="text-muted-foreground font-medium">Ratings</span>
                                      <span className="text-foreground tabular-nums">—</span>
                                    </div>
                                  );
                                }
                                const vals = [r.ground, r.shooting, r.passing, r.driver].filter((v): v is number => v != null);
                                const overall = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
                                const overallText = overall != null ? overall.toFixed(1) : "—";
                                return (
                                  <div className="space-y-1">
                                    <div className="flex items-center justify-between gap-3">
                                      <span className="text-muted-foreground font-medium">Ratings</span>
                                      <span className="text-primary bg-primary/10 border border-primary/15 px-2 py-0.5 rounded tabular-nums">
                                        Overall: {overallText}
                                      </span>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                      <span className="text-muted-foreground">Ground:</span>
                                      <span className="text-foreground tabular-nums">{fmt(r.ground)}</span>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                      <span className="text-muted-foreground">Shooting:</span>
                                      <span className="text-foreground tabular-nums">{fmt(r.shooting)}</span>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                      <span className="text-muted-foreground">Passing:</span>
                                      <span className="text-foreground tabular-nums">{fmt(r.passing)}</span>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                      <span className="text-muted-foreground">Driver:</span>
                                      <span className="text-foreground tabular-nums">{fmt(r.driver)}</span>
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                            {(md as any)?.data_raw?.notes && (
                              <div className="mt-2 pt-2 border-t border-border/40">
                                <div className="text-[11px] font-semibold text-primary uppercase tracking-wide mb-1">Notes</div>
                                <p className="text-[11px] text-muted-foreground leading-relaxed break-words">{(md as any).data_raw.notes}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>

          {/* Center light gray triangle — opens TBA match video */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <button
              type="button"
              title={youtubeId ? "Open match video (TBA)" : "No TBA video available"}
              onClick={() => {
                if (!youtubeId) return;
                openUrl(`https://www.youtube.com/watch?v=${youtubeId}`);
              }}
              disabled={!youtubeId}
              className={`flex items-center justify-center w-[100px] h-[100px] transition-colors ${
                youtubeId
                  ? "cursor-pointer opacity-90 hover:opacity-100"
                  : "cursor-not-allowed opacity-40"
              }`}
              aria-label="Open match video"
            >
              <svg width="72" height="72" viewBox="0 0 24 24" fill="currentColor" className="text-muted-foreground">
                <path d="M9 18L19 12L9 6V18Z" />
              </svg>
            </button>
          </div>

          {/* Red alliance cards */}
          <div className="contents">
            {teamsInMatch
              .filter((s) => s.alliance === "red")
              .map((s, idx) => {
                const md = teamDataByTeam.get(s.team);
                const hasScoutedData = !!md?.data_raw;
                const teamAutos = getTeamAutos(pitScoutingByTeam.get(s.team));
                const { label: autoLabel, drawing, name } = getMatchedAutoForTeam(hasScoutedData ? md : undefined, teamAutos, true);
                const matchStats = md ? calculateSingleMatchStats(md as unknown as EventMatchData) : null;
                const isSelected = selectedTeam === s.team;
                const page = teamCardPage[s.team] ?? "auto";
                const redPos =
                  [
                    { left: "2%", top: "8%" },
                    { left: "2%", bottom: "8%" },
                    { left: "50%", top: "1%", transform: "translateX(-50%)" },
                  ][idx] ?? { left: "2%", top: "8%" };
                return (
                  <div
                    key={s.team}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      // Clicking the card selects the team; Auto/Teleop is switched only via buttons.
                      setSelectedTeam(s.team);
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      setSelectedTeam(s.team);
                    }}
                    className={`absolute rounded-xl border-4 bg-red-500/10 p-3 w-[min(260px,24vw)] h-[min(260px,24vw)] min-w-[220px] min-h-[220px] flex flex-col flex-shrink-0 overflow-hidden cursor-pointer ${isSelected ? "" : "border-red-500"}`}
                    style={isSelected ? { ...redPos, borderColor: "hsl(var(--primary))" } : redPos}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-base font-semibold text-foreground shrink-0 truncate">
                        Team {s.team.replace(/frc/i, "")}
                      </p>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          title="Open action timeline"
                          onClick={(e) => {
                            e.stopPropagation();
                            addTab(
                              "/timeline",
                              `Timeline · ${getMatchLabel(matchKey)}`,
                              { match: matchKey, team: s.team, event: currentEvent ?? "" },
                              `timeline-${matchKey}-${s.team}`
                            );
                            navigate({
                              to: "/timeline",
                              search: { match: matchKey, team: s.team, event: currentEvent ?? "" },
                            });
                          }}
                          className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors shrink-0"
                        >
                          <Activity className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          title="Open team page"
                          onClick={(e) => {
                            e.stopPropagation();
                            addTab(
                              "/team",
                              `Team ${s.team.replace(/frc/i, "")}`,
                              { team: s.team },
                              `team-${s.team}`
                            );
                            navigate({ to: "/team", search: { team: s.team } });
                          }}
                          className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors shrink-0"
                        >
                          <Maximize2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-1 bg-muted/20 rounded-lg p-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setTeamCardPage((prev) => ({ ...prev, [s.team]: "auto" }));
                        }}
                        className={`h-7 rounded-md text-xs font-medium transition-colors ${
                          page === "auto" ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Auto
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setTeamCardPage((prev) => ({ ...prev, [s.team]: "teleop" }));
                        }}
                        className={`h-7 rounded-md text-xs font-medium transition-colors ${
                          page === "teleop" ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Teleop
                      </button>
                    </div>

                    <div className="mt-2 flex-1 min-h-0 overflow-y-auto overflow-x-hidden rounded-lg border border-border/40 bg-muted/10 p-2">
                      {page === "auto" ? (
                        <div className="flex flex-col gap-2 min-h-0">
                          <div className="h-[95px] overflow-hidden rounded-md bg-background/30 border border-border/40">
                            {hasScoutedData ? (
                              drawing ? (
                                <AutoPathPreview drawing={drawing} alliance="red" className="w-full h-full max-w-full max-h-full" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center px-2 text-xs text-muted-foreground text-center">
                                  {name ?? autoLabel}
                                </div>
                              )
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
                                No match data
                              </div>
                            )}
                          </div>
                          <div className="min-h-0">
                            {/* Match-style pills (mirrors Teleop section layout) */}
                            <div className="flex items-center gap-2">
                              <span
                                className={`px-2 py-1 rounded text-[11px] font-medium flex-1 text-center ${
                                  matchStats?.didDefend
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-muted text-muted-foreground"
                                }`}
                              >
                                Defend
                              </span>
                              <span
                                className={`px-2 py-1 rounded text-[11px] font-medium flex-1 text-center ${
                                  matchStats?.wasDisabled
                                    ? "bg-red-500 text-white"
                                    : "bg-muted text-muted-foreground"
                                }`}
                              >
                                Disable
                              </span>
                            </div>

                            <div className="flex items-center gap-2">
                              <span
                                className={`px-2 py-1 rounded text-[11px] font-medium flex-1 text-center ${
                                  matchStats?.climb.hasAutoClimb
                                    ? "bg-green-500/20 text-green-400 border border-green-500/30"
                                    : "bg-muted text-muted-foreground"
                                }`}
                              >
                                {matchStats?.climb.hasAutoClimb
                                  ? `Climb (A): Yes${
                                      matchStats?.climb.autoClimbTime != null
                                        ? ` (${Math.round(matchStats.climb.autoClimbTime)}s)`
                                        : ""
                                    }${
                                      matchStats?.climb.autoClimbOrientation
                                        ? ` · ${matchStats.climb.autoClimbOrientation}`
                                        : ""
                                    }`
                                  : "Climb (A): None"}
                              </span>
                            </div>

                            <div className="text-[11px] font-semibold text-primary uppercase tracking-wide mb-1 mt-2">Auto actions</div>
                            <div className="text-[11px] space-y-1">
                              <MetricCell show={showAutoIntakes} label="Intakes" value={matchStats?.auto.intakes} />
                              <MetricCell show={showAutoPasses} label="Passes" value={matchStats?.auto.passes} />
                              <MetricCell
                                show={showAutoShootPasses}
                                label="Shoot passes"
                                value={matchStats?.auto.shootPasses}
                              />
                              <MetricCell show={showAutoShoots} label="Shoots" value={matchStats?.auto.shoots} />
                              <MetricCell show={showAutoStocking} label="Stocking" value={matchStats?.auto.stocking} />
                              <MetricCell show={showAutoCamps} label="Camps" value={matchStats?.auto.camps} />
                              <MetricCell show={showAutoDisrupts} label="Disrupts" value={matchStats?.auto.disrupts} />
                            </div>

                            <div className="mt-2 pt-2 border-t border-border/40 text-[11px]">
                              <div className="flex justify-between gap-3">
                                <span className="text-muted-foreground">Total auto actions</span>
                                <span className="text-foreground tabular-nums">{matchStats?.timeline.totalAutoActions ?? "—"}</span>
                              </div>
                              <div className="mt-1 flex justify-between gap-3">
                                <span className="text-muted-foreground">Auto density</span>
                                <span className="text-foreground tabular-nums">
                                  {matchStats?.timeline.autoActionDensity != null ? matchStats.timeline.autoActionDensity.toFixed(2) : "—"}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2 min-h-0">
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-2 py-1 rounded text-[11px] font-medium flex-1 text-center ${
                                matchStats?.didDefend ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                              }`}
                            >
                              Defend
                            </span>
                            <span
                              className={`px-2 py-1 rounded text-[11px] font-medium flex-1 text-center ${
                                matchStats?.wasDisabled ? "bg-red-500 text-white" : "bg-muted text-muted-foreground"
                              }`}
                            >
                              Disable
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-2 py-1 rounded text-[11px] font-medium flex-1 text-center ${
                                matchStats?.climb.level ? "bg-green-500/20 text-green-400 border border-green-500/30" : "bg-muted text-muted-foreground"
                              }`}
                            >
                              Climb (T): {matchStats?.climb.level ?? "None"}
                            </span>
                          </div>
                          <div className="min-h-0">
                            <div className="text-[11px] font-semibold text-primary uppercase tracking-wide mb-1">Teleop stats</div>
                            <div className="grid grid-cols-2 gap-2 text-[11px]">
                              <MetricCell show={showTeleopIntakes} label="Intakes" value={matchStats?.teleop.intakes} />
                              <MetricCell show={showTeleopPasses} label="Passes" value={matchStats?.teleop.passes} />
                              <MetricCell
                                show={showTeleopShootPasses}
                                label="Shoot passes"
                                value={matchStats?.teleop.shootPasses}
                              />
                              <MetricCell show={showTeleopShoots} label="Shoots" value={matchStats?.teleop.shoots} />
                              <MetricCell
                                show={showTeleopStocking}
                                label="Stocking"
                                value={matchStats?.teleop.stocking}
                              />
                              <MetricCell show={showTeleopCamps} label="Camps" value={matchStats?.teleop.camps} />
                              <MetricCell show={showTeleopDisrupts} label="Disrupts" value={matchStats?.teleop.disrupts} />
                            </div>
                            <div className="mt-2 pt-2 border-t border-border/40 text-[11px]">
                              {(() => {
                                const r = matchStats?.ratings;
                                const fmt = (v: number | null | undefined) => (v != null ? v.toFixed(1) : "—");
                                if (!r) {
                                  return (
                                    <div className="flex justify-between gap-3">
                                      <span className="text-muted-foreground font-medium">Ratings</span>
                                      <span className="text-foreground tabular-nums">—</span>
                                    </div>
                                  );
                                }
                                const vals = [r.ground, r.shooting, r.passing, r.driver].filter((v): v is number => v != null);
                                const overall = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
                                const overallText = overall != null ? overall.toFixed(1) : "—";
                                return (
                                  <div className="space-y-1">
                                    <div className="flex items-center justify-between gap-3">
                                      <span className="text-muted-foreground font-medium">Ratings</span>
                                      <span className="text-primary bg-primary/10 border border-primary/15 px-2 py-0.5 rounded tabular-nums">
                                        Overall: {overallText}
                                      </span>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                      <span className="text-muted-foreground">Ground:</span>
                                      <span className="text-foreground tabular-nums">{fmt(r.ground)}</span>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                      <span className="text-muted-foreground">Shooting:</span>
                                      <span className="text-foreground tabular-nums">{fmt(r.shooting)}</span>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                      <span className="text-muted-foreground">Passing:</span>
                                      <span className="text-foreground tabular-nums">{fmt(r.passing)}</span>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                      <span className="text-muted-foreground">Driver:</span>
                                      <span className="text-foreground tabular-nums">{fmt(r.driver)}</span>
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                            {(md as any)?.data_raw?.notes && (
                              <div className="mt-2 pt-2 border-t border-border/40">
                                <div className="text-[11px] font-semibold text-primary uppercase tracking-wide mb-1">Notes</div>
                                <p className="text-[11px] text-muted-foreground leading-relaxed break-words">{(md as any).data_raw.notes}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
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
  tbaSchedule,
  onBack: _onBack,
  matchHasHappened: _matchHasHappened,
  onSwitchToPlayback: _onSwitchToPlayback,
}: {
  matchKey: string;
  schedule: { match: string; team: string; alliance: "red" | "blue" }[];
  matchData: EventMatchData[];
  tbaClimbData: Record<string, Record<string, TbaClimbEntry>>;
  pitScoutingByTeam: Map<string, PitScoutingData>;
  tbaTeams: TBATeam[];
  tbaSchedule: Record<string, { predicted_red_score?: number | null; predicted_blue_score?: number | null; red_win_prob?: number | null }>;
  onBack?: () => void;
  matchHasHappened?: boolean;
  onSwitchToPlayback?: () => void;
}) {
  const navigate = useNavigate();
  const { addTab } = useTabContext();
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

  const tbaEntry = tbaSchedule[matchKey];

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full overflow-x-hidden">
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
                />
              );})}
          </div>

          {/* Center: static fullfield with overlay */}
          <div className="flex flex-col shrink-0 self-start gap-3" style={{ width: fieldContainerWidth }}>
            {/* Score bar */}
            <div className="flex items-center justify-between px-20 py-2 rounded-lg bg-muted/30 border border-border font-bold">
              <div className="flex items-center gap-12">
                <span className="text-xl text-blue-400 font-regular">{tbaEntry?.red_win_prob != null ? `${Math.round((1 - tbaEntry.red_win_prob) * 100)}%` : "—"}</span>
                <span className="text-3xl font-regular text-blue-400">{tbaEntry?.predicted_blue_score != null ? Math.round(tbaEntry.predicted_blue_score) : "—"}</span>
              </div>
              <div className="text-center">
                <span className="text-sm text-muted-foreground">{getMatchLabel(matchKey)}</span>
              </div>
              <div className="flex items-center gap-12">
                <span className="text-3xl font-regular text-red-400">{tbaEntry?.predicted_red_score != null ? Math.round(tbaEntry.predicted_red_score) : "—"}</span>
                <span className="text-xl font-regular text-red-400">{tbaEntry?.red_win_prob != null ? `${Math.round(tbaEntry.red_win_prob * 100)}%` : "—"}</span>
              </div>
            </div>
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
                        const x = (alliance === "red" ? nx : 1 - nx) * FIELD_WIDTH;
                        const y = ny * FIELD_HEIGHT;
                        return <circle key={`${sel.team}-${sel.autoIndex}-climb`} cx={x} cy={y} r={8} fill={color} opacity={0.9} />;
                      })()}
                    </g>
                  );
                })}
              </svg>
            </div>
            {/* Team Stats Grid */}
            <div className="rounded-xl border-2 border-border bg-muted/20 p-4">
              <div className="grid grid-cols-6 gap-3">
                <div className="col-span-3 text-center">
                  <h3 className="text-sm font-semibold text-blue-500 mb-2">Blue Alliance</h3>
                </div>
                <div className="col-span-3 text-center">
                  <h3 className="text-sm font-semibold text-red-500 mb-2">Red Alliance</h3>
                </div>
                {[0, 1, 2].map((rowIdx) => (
                  <React.Fragment key={rowIdx}>
                    {teamsInMatch
                      .filter((s) => s.alliance === "blue")
                      .slice(rowIdx, rowIdx + 1)
                      .map((s) => {
                        const teamNum = s.team.replace(/frc/i, "");
                        const teamMatches = matchData.filter((m) => m.team === s.team && (m as unknown as EventMatchData).data_raw);
                        const failPct = teamMatches.length > 0
                          ? Math.round(
                              (teamMatches.reduce((sum, m) => {
                                const st = calculateSingleMatchStats(m as unknown as EventMatchData);
                                return sum + ((st?.climb.failedClimbCount ?? 0) > 0 ? 1 : 0);
                              }, 0) / teamMatches.length) * 100
                            )
                          : null;
                        const pitData = pitScoutingByTeam.get(s.team);
                        const isPitScouted = !!(pitData?.name || pitData?.uid);
                        const pitMovement = pitData?.data?.movement as { bump?: boolean; trough?: boolean } | undefined;
                        const pitBump = isPitScouted ? !!(pitMovement?.bump) : null;
                        const pitTrough = isPitScouted ? !!(pitMovement?.trough) : null;
                        return (
                          <div key={s.team} className="col-span-3 flex items-center gap-2 rounded-lg bg-background-500/10 border border-blue-500/30 p-3">
                            <div className="flex items-center gap-2 flex-1">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="text-md font-semibold text-muted-foreground hover:text-primary cursor-pointer" onClick={() => { addTab("/team", `Team ${s.team.replace(/frc/i, "")}`, { team: s.team }, `team-${s.team}`); navigate({ to: "/team", search: { team: s.team } }); }}>{teamNum}</span>
                                </TooltipTrigger>
                                <TooltipContent>Team {teamNum} stats</TooltipContent>
                              </Tooltip>
                            </div>
                            <div className="flex gap-2">
                              <span className="px-2 py-1 rounded text-xs min-w-[3.5rem] text-center bg-muted text-muted-foreground">
                                {failPct != null ? `Fail: ${failPct}%` : "Fail: —"}
                              </span>
                              <span className={`px-2 py-1 rounded text-xs min-w-[3.5rem] text-center ${pitBump === null ? "bg-muted text-muted-foreground" : pitBump ? "bg-green-500/20 text-green-400 border border-green-500/30" : "bg-red-500/20 text-red-400 border border-red-500/30"}`}>Bump</span>
                              <span className={`px-2 py-1 rounded text-xs min-w-[3.5rem] text-center ${pitTrough === null ? "bg-muted text-muted-foreground" : pitTrough ? "bg-green-500/20 text-green-400 border border-green-500/30" : "bg-red-500/20 text-red-400 border border-red-500/30"}`}>Trench</span>
                            </div>
                          </div>
                        );
                      })}
                    {teamsInMatch
                      .filter((s) => s.alliance === "red")
                      .slice(rowIdx, rowIdx + 1)
                      .map((s) => {
                        const teamNum = s.team.replace(/frc/i, "");
                        const teamMatches = matchData.filter((m) => m.team === s.team && (m as unknown as EventMatchData).data_raw);
                        const failPct = teamMatches.length > 0
                          ? Math.round(
                              (teamMatches.reduce((sum, m) => {
                                const st = calculateSingleMatchStats(m as unknown as EventMatchData);
                                return sum + ((st?.climb.failedClimbCount ?? 0) > 0 ? 1 : 0);
                              }, 0) / teamMatches.length) * 100
                            )
                          : null;
                        const pitData = pitScoutingByTeam.get(s.team);
                        const isPitScouted = !!(pitData?.name || pitData?.uid);
                        const pitMovement = pitData?.data?.movement as { bump?: boolean; trough?: boolean } | undefined;
                        const pitBump = isPitScouted ? !!(pitMovement?.bump) : null;
                        const pitTrough = isPitScouted ? !!(pitMovement?.trough) : null;
                        return (
                          <div key={s.team} className="col-span-3 flex items-center gap-2 rounded-lg bg-background-500/10 border border-red-500/30 p-3">
                            <div className="flex items-center gap-2 flex-1">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="text-md font-semibold text-muted-foreground hover:text-primary cursor-pointer" onClick={() => { addTab("/team", `Team ${s.team.replace(/frc/i, "")}`, { team: s.team }, `team-${s.team}`); navigate({ to: "/team", search: { team: s.team } }); }}>{teamNum}</span>
                                </TooltipTrigger>
                                <TooltipContent>Team {teamNum} stats</TooltipContent>
                              </Tooltip>
                            </div>
                            <div className="flex gap-2">
                              <span className="px-2 py-1 rounded text-xs min-w-[3.5rem] text-center bg-muted text-muted-foreground">
                                {failPct != null ? `Fail: ${failPct}%` : "Fail: —"}
                              </span>
                              <span className={`px-2 py-1 rounded text-xs min-w-[3.5rem] text-center ${pitBump === null ? "bg-muted text-muted-foreground" : pitBump ? "bg-green-500/20 text-green-400 border border-green-500/30" : "bg-red-500/20 text-red-400 border border-red-500/30"}`}>Bump</span>
                              <span className={`px-2 py-1 rounded text-xs min-w-[3.5rem] text-center ${pitTrough === null ? "bg-muted text-muted-foreground" : pitTrough ? "bg-green-500/20 text-green-400 border border-green-500/30" : "bg-red-500/20 text-red-400 border border-red-500/30"}`}>Trench</span>
                            </div>
                          </div>
                        );
                      })}
                  </React.Fragment>
                ))}
              </div>
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
      <p className="text-base font-semibold text-foreground shrink-0 mb-1 truncate text-center">
        Team {team.replace(/frc/i, "")}
        {epa != null && <span className="text-muted-foreground font-normal"> · {epa.toFixed(1)} EPA</span>}
      </p>
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
            <span className="text-primary">Auto:</span> {autoClimbPct != null ? `${autoClimbPct}%` : "—"}
          </p>
        </>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          <p className="text-sm text-muted-foreground text-center">No pit autos</p>
          <p className="text-sm font-medium text-foreground text-center">
            <span className="text-primary">Tele Climb:</span> {climbPct != null ? `${climbPct}%` : "—"}
            <span className="text-muted-foreground mx-1">|</span>
            <span className="text-primary">Auto:</span> {autoClimbPct != null ? `${autoClimbPct}%` : "—"}
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
    invoke("fetch_event_videos", { event: currentEvent }).then((data) => {
      setVideoCache(data && typeof data === "object" ? data as any : null);
    }).catch(() => {});
  }, [currentEvent]);

  const handleSelectMatch = (key: string) => {
    const label = getMatchLabel(key);
    addTab("/matches", label, { match: key }, `match-${key}`);
    navigate({ to: "/matches", search: { match: key } });
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
          tbaSchedule={tbaSchedule}
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
        videoCache={videoCache}
        pitScoutingByTeam={pitScoutingByTeam}
        tbaSchedule={tbaSchedule}
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
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
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
