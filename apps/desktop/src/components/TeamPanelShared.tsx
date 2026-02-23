import {
  ArrowUp,
  ArrowDown,
  Maximize2,
  Grid2X2,
  X,
} from "lucide-react";
import {
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { TBATeam } from "../contexts/DesktopTeamDataContext";
import type { TbaClimbEntry } from "../contexts/DesktopCompetitionDataContext";
import type { MatchScoutingData } from "../lib/db";
import { calculateSingleMatchStats } from "@lib/data/matchStats";
import type { PicklistEntry } from "@lib/data/schema";

// ─── Helpers ────────────────────────────────────────────────────────────────

export function getTeamNum(teamKey: string): string {
  return teamKey.replace("frc", "");
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
      active ? "bg-primary/15" : "bg-muted/50",
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

export interface FullTeamPanelProps {
  teamKey: string;
  entry: PicklistEntry | undefined;
  tbaTeam: TBATeam | undefined;
  matchData: MatchScoutingData[];
  tbaClimbData: Record<string, Record<string, TbaClimbEntry>>;
  useTbaClimb: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  dragListeners?: Record<string, unknown>;
  dragAttributes?: Record<string, unknown>;
}

export function FullTeamPanel({
  teamKey,
  entry,
  tbaTeam,
  matchData,
  tbaClimbData,
  useTbaClimb,
  onMoveUp,
  onMoveDown,
  onRemove,
  dragListeners,
  dragAttributes,
}: FullTeamPanelProps) {
  const teamNum = getTeamNum(teamKey);
  const teamName = tbaTeam?.name ?? teamKey;
  const climb = getClimbCounts(teamKey, matchData, tbaClimbData, useTbaClimb);

  return (
    <div className="w-full h-full border border-border rounded-lg bg-card flex flex-col overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border flex-shrink-0">
        <span className="w-7 h-7 rounded-full border border-muted-foreground/50 text-muted-foreground text-xs font-semibold flex items-center justify-center flex-shrink-0">
          {entry?.rank ?? "—"}
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
          <button
            onClick={onMoveUp}
            className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
            title="Move up in picklist rank"
          >
            <ArrowUp className="w-5 h-5" />
          </button>
          <button
            onClick={onMoveDown}
            className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
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
          <button
            className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
            title="Expand team details"
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

      {/* Team info + climb stats */}
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-4">
        <div className="flex flex-col items-center gap-1">
          <span className="text-xs text-muted-foreground">#{entry?.rank ?? "—"}</span>
          <span className="text-5xl font-bold text-primary">{teamNum}</span>
          <span className="text-sm text-muted-foreground text-center leading-tight">{teamName}</span>
        </div>

        {/* Climb stats */}
        <div className="w-full space-y-2 pt-1 border-t border-border/50">
          {/* Auto */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide w-8 flex-shrink-0">
              Auto
            </span>
            {useTbaClimb ? (
              <div className="flex gap-1.5">
                <ClimbLevelChip label="L1" count={climb.auto.L1} n={climb.n} />
                <ClimbLevelChip label="L2" count={climb.auto.L2} n={climb.n} />
                <ClimbLevelChip label="L3" count={climb.auto.L3} n={climb.n} />
              </div>
            ) : (
              <div className="flex gap-1.5 items-center">
                <div className={[
                  "flex flex-col items-center rounded-md px-2.5 py-1 min-w-[40px]",
                  climb.auto.any > 0 ? "bg-primary/15" : "bg-muted/50",
                ].join(" ")}>
                  <span className={["text-[10px] font-semibold", climb.auto.any > 0 ? "text-primary" : "text-muted-foreground/50"].join(" ")}>
                    Any
                  </span>
                  <span className={["text-sm font-bold tabular-nums", climb.auto.any > 0 ? "text-primary" : "text-muted-foreground/30"].join(" ")}>
                    {climb.auto.any}
                  </span>
                  {climb.n > 0 && (
                    <span className="text-[9px] text-muted-foreground/50">
                      {Math.round((climb.auto.any / climb.n) * 100)}%
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground/50">no level from scouted</span>
              </div>
            )}
          </div>

          {/* Teleop */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide w-8 flex-shrink-0">
              Tele
            </span>
            <div className="flex gap-1.5">
              <ClimbLevelChip label="L1" count={climb.teleop.L1} n={climb.n} />
              <ClimbLevelChip label="L2" count={climb.teleop.L2} n={climb.n} />
              <ClimbLevelChip label="L3" count={climb.teleop.L3} n={climb.n} />
            </div>
          </div>

          {/* Match count */}
          <p className="text-[10px] text-muted-foreground/50 text-center">
            {climb.n === 0
              ? useTbaClimb ? "no TBA data" : "not scouted"
              : `${climb.n} match${climb.n !== 1 ? "es" : ""} ${useTbaClimb ? "played" : "scouted"}`}
          </p>
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
