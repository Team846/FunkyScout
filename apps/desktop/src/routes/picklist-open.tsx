import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import {
  X,
  ArrowUp,
  ArrowDown,
  Settings,
  AlignJustify,
  Search,
  Trash2,
  Shuffle,
  Eye,
  EyeOff,
  Plus,
  Save,
  RotateCcw,
  Ban,
  Maximize2,
  Grid2X2,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Input } from "@shadcn/ui/components/input.tsx";
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
import { toast } from "sonner";
import { useDesktopEvent } from "../contexts/DesktopEventContext";
import { useDesktopCompetitionData } from "../contexts/DesktopCompetitionDataContext";
import type { TbaClimbEntry } from "../contexts/DesktopCompetitionDataContext";
import { useDesktopTeamData } from "../contexts/DesktopTeamDataContext";
import type { TBATeam } from "../contexts/DesktopTeamDataContext";
import { usePicklistEditor } from "@lib/hooks/usePicklistEditor";
import { getMatchScoutingData } from "../lib/db";
import type { MatchScoutingData } from "../lib/db";
import { deletePicklist } from "@lib/data/writes";
import { GRAPHABLE_STATS, getStatDataPoints, calculateSingleMatchStats } from "@lib/data/matchStats";
import type { PicklistEntry } from "@lib/data/schema";

export const Route = createFileRoute("/picklist-open")({
  component: PicklistEditorPage,
  validateSearch: (search: Record<string, unknown>) => ({
    id: (search.id as string) || "",
  }),
});

// ─── Constants ──────────────────────────────────────────────────────────────

const TYPE_CYCLE = ["private", "public", "default"] as const;
type PicklistType = (typeof TYPE_CYCLE)[number];

const TBA_SORT_OPTIONS = [
  { key: "rank", label: "Event Rank", group: "TBA" },
  { key: "epa", label: "EPA", group: "TBA" },
  { key: "opr", label: "OPR", group: "TBA" },
];

const ALL_SORT_OPTIONS = [
  ...TBA_SORT_OPTIONS,
  ...GRAPHABLE_STATS.map((s) => ({
    key: s.key,
    label: s.label,
    group: s.group,
  })),
];

const EXTRA_GRAPH_METRICS = [
  { key: "epa", label: "EPA", group: "TBA" },
  { key: "opr", label: "OPR", group: "TBA" },
];

const ALL_GRAPH_METRICS = [
  ...EXTRA_GRAPH_METRICS,
  ...GRAPHABLE_STATS.map((s) => ({
    key: s.key,
    label: s.label,
    group: s.group,
  })),
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function getTeamNum(teamKey: string): string {
  return teamKey.replace("frc", "");
}

function getTeamStatAvg(
  statKey: string,
  teamKey: string,
  matchData: MatchScoutingData[]
): number {
  const pts = getStatDataPoints(
    statKey,
    matchData.filter((m) => m.team === teamKey) as any
  );
  if (!pts.length) return 0;
  return pts.reduce((s, p) => s + p.raw, 0) / pts.length;
}

interface ClimbCounts {
  auto: { L1: number; L2: number; L3: number; any: number };
  teleop: { L1: number; L2: number; L3: number };
  n: number;
}

function getClimbCounts(
  teamKey: string,
  matchData: MatchScoutingData[],
  tbaClimbData: Record<string, Record<string, TbaClimbEntry>>,
  useTba: boolean,
): ClimbCounts {
  const teamMatches = matchData.filter((m) => m.team === teamKey);
  const auto = { L1: 0, L2: 0, L3: 0, any: 0 };
  const teleop = { L1: 0, L2: 0, L3: 0 };

  for (const m of teamMatches) {
    const tba = useTba ? tbaClimbData[m.match]?.[teamKey] : undefined;
    if (tba !== undefined) {
      if (tba.auto_climb === "L1") { auto.L1++; auto.any++; }
      else if (tba.auto_climb === "L2") { auto.L2++; auto.any++; }
      else if (tba.auto_climb === "L3") { auto.L3++; auto.any++; }
      if (tba.teleop_climb === "L1") teleop.L1++;
      else if (tba.teleop_climb === "L2") teleop.L2++;
      else if (tba.teleop_climb === "L3") teleop.L3++;
    } else {
      const stats = calculateSingleMatchStats(m as any);
      if (stats?.climb.hasAutoClimb) auto.any++;
      if (stats?.climb.level === "L1") teleop.L1++;
      else if (stats?.climb.level === "L2") teleop.L2++;
      else if (stats?.climb.level === "L3") teleop.L3++;
    }
  }

  return { auto, teleop, n: teamMatches.length };
}

function computeGraphData(
  metricKey: string,
  teams: string[],
  matchData: MatchScoutingData[],
  tbaTeams: TBATeam[]
): { raws: number[]; normalized: number[]; winnerIdx: number } {
  const getRaw = (teamKey: string): number => {
    if (metricKey === "epa")
      return (
        tbaTeams.find((t) => t.key === teamKey)?.epa?.total_points?.mean ?? 0
      );
    if (metricKey === "opr")
      return tbaTeams.find((t) => t.key === teamKey)?.opr ?? 0;
    return getTeamStatAvg(metricKey, teamKey, matchData);
  };

  const raws = teams.map(getRaw);
  const max = Math.max(...raws, 0.001);
  const stat = GRAPHABLE_STATS.find((s) => s.key === metricKey);
  const normalized = raws.map((r) =>
    stat && metricKey !== "epa" && metricKey !== "opr"
      ? stat.normalize(r, raws)
      : r / max
  );
  const winnerIdx = raws.indexOf(Math.max(...raws));
  return { raws, normalized, winnerIdx };
}

// ─── SidebarTeamCard ────────────────────────────────────────────────────────

interface SidebarTeamCardProps {
  entry: PicklistEntry;
  tbaTeam: TBATeam | undefined;
  isSelected: boolean;
  onSelect: () => void;
  onToggleExclude: () => void;
}

function SidebarTeamCard({
  entry,
  tbaTeam,
  isSelected,
  onSelect,
  onToggleExclude,
}: SidebarTeamCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: entry.team });

  const isExcluded = !!entry.flags?.excluded;
  const teamNum = getTeamNum(entry.team);
  const teamName = tbaTeam?.name ?? entry.team;
  const tbaRank = tbaTeam?.rank;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      className={[
        "flex items-stretch rounded-lg border overflow-hidden select-none transition-all",
        isExcluded ? "opacity-40 grayscale" : "",
        isSelected
          ? "border-primary"
          : "border-border/60 hover:border-muted-foreground",
      ].join(" ")}
    >
      {/* ── Drag handle strip (left edge) ── */}
      <div
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        className="group/drag w-6 flex-shrink-0 flex flex-col items-center justify-center gap-[5px] cursor-grab active:cursor-grabbing bg-muted/40 hover:bg-muted/70 transition-colors pl-3.5 pr-1"
      >
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex gap-[3px]">
            <div className="w-[5px] h-[5px] rounded-full bg-muted-foreground/60 group-hover/drag:bg-foreground transition-colors" />
            <div className="w-[5px] h-[5px] rounded-full bg-muted-foreground/60 group-hover/drag:bg-foreground transition-colors" />
          </div>
        ))}
      </div>

      {/* ── Card content ── */}
      <div
        onClick={onSelect}
        className={[
          "flex-1 px-3 py-3 cursor-pointer min-w-0",
          isExcluded ? "bg-muted" : "bg-card",
        ].join(" ")}
      >
        {/* Row 1: rank + divider + name + number */}
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold text-primary w-5 text-center flex-shrink-0">
            {entry.rank}
          </span>
          {/* Vertical divider */}
          <div className="w-px h-4 bg-muted-foreground/50 flex-shrink-0" />
          <span className="text-sm font-medium text-foreground/80 flex-1 truncate">
            {teamName}
          </span>
          <span className="text-sm text-primary flex-shrink-0">{teamNum}</span>
        </div>

        {/* Row 2: icons + TBA rank badge (aligned with rank number) */}
        <div className="flex items-center gap-2 mt-2">
          {/* Exclude icon in w-5 container to align with rank number */}
          <div className="w-5 flex items-center justify-center flex-shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleExclude();
              }}
              className={[
                "rounded transition-colors",
                isExcluded
                  ? "text-destructive drop-shadow-[0_0_4px_hsl(var(--destructive))]"
                  : "text-muted-foreground/50 hover:text-muted-foreground",
              ].join(" ")}
              title={isExcluded ? "Include team" : "Exclude team"}
            >
              <Ban className="w-4 h-4" />
            </button>
          </div>

          <button
            disabled
            onClick={(e) => e.stopPropagation()}
            className="rounded text-muted-foreground/30 cursor-not-allowed"
          >
            <Maximize2 className="w-4 h-4" />
          </button>

          {tbaRank !== undefined && (
            <div className="flex items-center gap-1.5 ml-auto">
              <span className="text-xs text-muted-foreground/60">Rank</span>
              <span className="w-8 h-5 rounded-full bg-primary text-background text-xs flex items-center justify-center">
                #{tbaRank}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── FullTeamPanel ──────────────────────────────────────────────────────────

interface FullTeamPanelProps {
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

function ClimbLevelChip({ label, count, n }: { label: string; count: number; n: number }) {
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

function FullTeamPanel({
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
        {/* Rank in circle border */}
        <span className="w-7 h-7 rounded-full border border-muted-foreground/50 text-muted-foreground text-xs font-semibold flex items-center justify-center flex-shrink-0">
          {entry?.rank ?? "—"}
        </span>
        {/* Team name */}
        <span className="text-sm font-medium text-primary truncate">
          {teamName}
        </span>
        {/* Vertical separator */}
        <div className="w-px h-4 bg-muted-foreground flex-shrink-0" />
        {/* Team number */}
        <span className="text-sm font-medium text-primary flex-shrink-0">
          {teamNum}
        </span>
        <div className="flex-1" />
        {/* Icons */}
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
            {climb.n} match{climb.n !== 1 ? "es" : ""} scouted
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── TeamBar ────────────────────────────────────────────────────────────────

interface TeamBarProps {
  teamKey: string;
  entry: PicklistEntry | undefined;
  tbaTeam: TBATeam | undefined;
  onRemove: () => void;
  dragListeners?: Record<string, unknown>;
  dragAttributes?: Record<string, unknown>;
}

function TeamBar({
  teamKey,
  entry,
  tbaTeam,
  onRemove,
  dragListeners,
  dragAttributes,
}: TeamBarProps) {
  const teamNum = getTeamNum(teamKey);
  const teamName = tbaTeam?.name ?? teamKey;

  return (
    <div className="w-14 h-full flex-shrink-0 border border-border rounded-lg bg-card flex flex-col items-center overflow-hidden py-2 gap-1">
      {/* Rank in circle border */}
      <span className="w-7 h-7 rounded-full border border-muted-foreground/50 text-muted-foreground text-xs font-semibold flex items-center justify-center flex-shrink-0">
        {entry?.rank ?? "—"}
      </span>

      {/* Vertical team name + separator + number */}
      <div className="flex-1 flex flex-col items-center justify-center overflow-hidden min-h-0 gap-1">
        <div
          style={{
            writingMode: "vertical-rl",
            textOrientation: "mixed",
          }}
          className="mb-1 text-sm font-medium text-primary truncate"
        >
          {teamName}
        </div>
        {/* Horizontal separator */}
        <div className="w-4 h-px bg-muted-foreground flex-shrink-0" />
        <div
          style={{
            writingMode: "vertical-rl",
            textOrientation: "mixed",
          }}
          className="mt-1 text-sm font-medium text-primary"
        >
          {teamNum}
        </div>
      </div>

      {/* Bottom icons - matching header exactly */}
      <div className="flex flex-col items-center gap-2 flex-shrink-0">
        <button className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors">
          <ArrowUp className="w-5 h-5" />
        </button>
        <button className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors">
          <ArrowDown className="w-5 h-5" />
        </button>
        <div
          {...dragAttributes}
          {...dragListeners}
          className="p-0.5 rounded cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors"
        >
          <Grid2X2 className="w-5 h-5" />
        </div>
        <button className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors">
          <Maximize2 className="w-5 h-5" />
        </button>
        <button
          onClick={onRemove}
          className="p-0.5 rounded-sm border border-destructive/50 text-destructive hover:bg-destructive/10 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

// ─── Sortable wrappers for main view ────────────────────────────────────────

function SortableFullPanel(
  props: Omit<FullTeamPanelProps, "dragListeners" | "dragAttributes">
) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: props.teamKey,
  });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        display: "flex",
        width: '420px',
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

function SortableTeamBar(
  props: Omit<TeamBarProps, "dragListeners" | "dragAttributes">
) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: props.teamKey,
  });
  return (
    <div
      ref={setNodeRef}
      className="h-full"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
    >
      <TeamBar
        {...props}
        dragListeners={listeners as any}
        dragAttributes={attributes as any}
      />
    </div>
  );
}

// ─── GraphCard ──────────────────────────────────────────────────────────────

const BAR_HEIGHT_PX = 120;

interface GraphCardProps {
  metricKey: string;
  teams: string[];
  matchData: MatchScoutingData[];
  tbaTeams: TBATeam[];
  showPercentiles: boolean;
  onTogglePercentiles: () => void;
  onRemove: () => void;
}

function GraphCard({
  metricKey,
  teams,
  matchData,
  tbaTeams,
  showPercentiles,
  onTogglePercentiles,
  onRemove,
}: GraphCardProps) {
  const allMetrics = [
    ...EXTRA_GRAPH_METRICS,
    ...GRAPHABLE_STATS.map((s) => ({ key: s.key, label: s.label })),
  ];
  const label = allMetrics.find((m) => m.key === metricKey)?.label ?? metricKey;

  const { raws, normalized, winnerIdx } = useMemo(
    () => computeGraphData(metricKey, teams, matchData, tbaTeams),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [metricKey, teams.join(","), matchData.length, tbaTeams.length]
  );

  const maxBarHeight = BAR_HEIGHT_PX * 0.8;

  // Calculate bar width based on number of teams (expand when fewer teams)
  const barWidth = teams.length <= 2 ? 70 : teams.length === 3 ? 55 : 45;
  
  return (
    <div className="w-[280px] flex-shrink-0 border border-border rounded-lg bg-card flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0">
        <span className="text-sm font-medium text-foreground flex-1 truncate">
          {label}
        </span>
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
          {showPercentiles ? (
            <Eye className="w-4 h-4" />
          ) : (
            <EyeOff className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* Bar chart */}
      <div className="flex items-end justify-around gap-2 px-4 pb-3 pt-2 flex-1">
        {teams.length === 0 ? (
          <span className="text-xs text-muted-foreground self-center">
            Select teams to compare
          </span>
        ) : (
          teams.map((teamKey, i) => {
            const isWinner = i === winnerIdx && raws[i] > 0;
            const barH = Math.max(
              4,
              Math.round((normalized[i] ?? 0) * maxBarHeight)
            );
            const rawVal = raws[i] ?? 0;
            const teamNum = getTeamNum(teamKey);
            const percentile = Math.round((normalized[i] ?? 0) * 100);

            return (
              <div
                key={teamKey}
                className="flex flex-col items-center gap-1"
                style={{ width: `${barWidth}px`, flexShrink: 0 }}
              >
                {/* Percentile indicator */}
                {showPercentiles && (
                  <div className="flex flex-col items-center -mb-1">
                    <span className="text-[10px] text-muted-foreground font-medium">
                      {percentile}%
                    </span>
                    <span className="text-[10px] text-muted-foreground">↓</span>
                  </div>
                )}
                {/* Raw value above bar */}
                <span
                  className={[
                    "text-xs font-bold",
                    isWinner ? "text-primary" : "text-muted-foreground",
                  ].join(" ")}
                >
                  {rawVal > 0 ? rawVal.toFixed(1) : "—"}
                </span>
                {/* Bar */}
                <div
                  style={{ height: `${barH}px`, width: `${barWidth}px` }}
                  className={[
                    "rounded-sm transition-all",
                    isWinner ? "bg-primary" : "bg-primary/80",
                  ].join(" ")}
                />
                {/* Team number below bar */}
                <span className="text-xs font-medium text-muted-foreground truncate w-full text-center">
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

// ─── MetricPicker ───────────────────────────────────────────────────────────

interface MetricPickerProps {
  activeMetrics: string[];
  onSelect: (key: string) => void;
  onClose: () => void;
}

function MetricPicker({ activeMetrics, onSelect, onClose }: MetricPickerProps) {
  const groups = [...new Set(ALL_GRAPH_METRICS.map((m) => m.group))];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      />
      {/* Modal */}
      <div 
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 bg-muted border border-border rounded-lg shadow-xl z-50 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-semibold text-foreground">
            Add Metric
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="max-h-80 overflow-y-auto py-2">
          {groups.map((group) => (
            <div key={group}>
              <div className="px-4 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                {group}
              </div>
              {ALL_GRAPH_METRICS.filter((m) => m.group === group).map(
                (metric) => {
                  const isActive = activeMetrics.includes(metric.key);
                  return (
                    <button
                      key={metric.key}
                      onClick={() => !isActive && onSelect(metric.key)}
                      className={[
                        "w-full text-left px-5 py-2 text-sm transition-colors",
                        isActive
                          ? "text-primary font-medium"
                          : "text-muted-foreground hover:text-foreground hover:bg-card cursor-pointer",
                      ].join(" ")}
                    >
                      {metric.label}
                      {isActive && " ✓"}
                    </button>
                  );
                }
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ─── Route component wrapper ─────────────────────────────────────────────────

function PicklistEditorPage() {
  const { id } = Route.useSearch();
  // Force remount when picklist ID changes (different tab activated)
  return <PicklistEditor key={id} picklistId={id} />;
}

// ─── Inner editor (remounts per picklist ID) ─────────────────────────────────

function PicklistEditor({ picklistId }: { picklistId: string }) {
  const navigate = useNavigate();
  const { currentEvent, useTbaClimb } = useDesktopEvent();
  const { picklists, tbaClimbData, lastDataRefreshAt } = useDesktopCompetitionData();
  const { tbaTeams } = useDesktopTeamData();

  // ── State ──
  const [matchData, setMatchData] = useState<MatchScoutingData[]>([]);
  const [selectedTeams, setSelectedTeams] = useState<string[]>([]); // index 0 = newest slot
  const [activeMetrics, setActiveMetrics] = useState<string[]>([]);
  const [showPercentiles, setShowPercentiles] = useState<
    Record<string, boolean>
  >({});
  const [showMetricPicker, setShowMetricPicker] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [searchTeam, setSearchTeam] = useState("");
  const [excludedToBottom, setExcludedToBottom] = useState(false);
  const [picklistType, setPicklistType] = useState<PicklistType>("private");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  // ── Selected picklist ──
  const selectedPicklist = picklists.find((p) => p.id === picklistId);

  // Sync type from picklist
  useEffect(() => {
    if (selectedPicklist?.type) {
      setPicklistType((selectedPicklist.type as PicklistType) ?? "private");
    }
  }, [selectedPicklist?.type]);

  // Load match data
  useEffect(() => {
    if (!currentEvent) return;
    getMatchScoutingData(currentEvent).then(setMatchData).catch(console.error);
  }, [currentEvent]);

  // Re-fetch match data whenever DesktopCompetitionData refreshes SQLite (120s sync cycle)
  useEffect(() => {
    if (!currentEvent || lastDataRefreshAt === 0) return;
    getMatchScoutingData(currentEvent).then(setMatchData).catch(console.error);
  }, [currentEvent, lastDataRefreshAt]);

  // ── Merge picklist entries with all event teams ──
  const mergedInitialEntries = useMemo<PicklistEntry[]>(() => {
    if (!selectedPicklist) return [];
    const entriesByTeam = new Map(
      selectedPicklist.picklist.map((e) => [e.team, e])
    );
    const maxRank = selectedPicklist.picklist.reduce(
      (m, e) => Math.max(m, e.rank || 0),
      0
    );
    const inPicklist = [...selectedPicklist.picklist].sort(
      (a, b) => (a.rank || 0) - (b.rank || 0)
    );
    const extra = tbaTeams
      .filter((t) => !entriesByTeam.has(t.key))
      .map((t, i) => ({ team: t.key, rank: maxRank + i + 1, flags: null }));
    return [...inPicklist, ...extra];
  }, [selectedPicklist?.id, selectedPicklist?.last_modified, tbaTeams.length]);

  // ── Picklist editor hook ──
  const {
    entries,
    displayEntries,
    hasChanges,
    isSaving,
    handleDragEnd: hookHandleDragEnd,
    toggleExclude,
    saveChanges,
    resetChanges,
    setEntries,
  } = usePicklistEditor({
    initialEntries: mergedInitialEntries,
    picklistId: picklistId || "",
    eventKey: currentEvent || "",
    title: selectedPicklist?.title || "",
    type: picklistType,
    excludedToBottom,
    onSaveSuccess: async () => {
      toast.success("Picklist saved");
    },
    onSaveError: (error) => {
      toast.error(`Failed to save: ${error.message}`);
    },
  });

  // ── Sidebar DnD sensors ──
  const sidebarSensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // ── Main view DnD sensors ──
  const mainViewSensors = useSensors(useSensor(PointerSensor));

  // ── Filtered sidebar entries ──
  const filteredEntries = useMemo(() => {
    if (!searchTeam.trim()) return displayEntries;
    const q = searchTeam.toLowerCase();
    return displayEntries.filter(
      (e) =>
        e.team.toLowerCase().includes(q) ||
        getTeamNum(e.team).includes(q) ||
        (tbaTeams.find((t) => t.key === e.team)?.name ?? "")
          .toLowerCase()
          .includes(q)
    );
  }, [displayEntries, searchTeam, tbaTeams]);

  // ── Sidebar drag end ──
  const handleSidebarDragEnd = (event: DragEndEvent) => {
    hookHandleDragEnd(event);
  };

  // ── Main view drag end ──
  const handleMainDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = selectedTeams.indexOf(active.id as string);
    const newIdx = selectedTeams.indexOf(over.id as string);
    if (oldIdx === -1 || newIdx === -1) return;
    setSelectedTeams((prev) => arrayMove(prev, oldIdx, newIdx));
  };

  // ── Team selection ──
  const toggleSelectedTeam = (teamKey: string) => {
    setSelectedTeams((prev) => {
      if (prev.includes(teamKey)) return prev.filter((t) => t !== teamKey);
      const next = [teamKey, ...prev];
      return next.slice(0, 4);
    });
  };

  // ── Rank up/down in main view ──
  const moveRank = (teamKey: string, direction: "up" | "down") => {
    const idx = entries.findIndex((e) => e.team === teamKey);
    if (idx === -1) return;
    const newIdx = direction === "up" ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= entries.length) return;
    const updated = [...entries];
    [updated[idx], updated[newIdx]] = [updated[newIdx], updated[idx]];
    setEntries(updated.map((e, i) => ({ ...e, rank: i + 1 })));
  };

  // ── Sort ──
  const handleSort = (sortKey: string) => {
    const sorted = [...entries].sort((a, b) => {
      if (sortKey === "rank") {
        const aR = tbaTeams.find((t) => t.key === a.team)?.rank ?? 9999;
        const bR = tbaTeams.find((t) => t.key === b.team)?.rank ?? 9999;
        return aR - bR;
      }
      if (sortKey === "epa") {
        const aV =
          tbaTeams.find((t) => t.key === a.team)?.epa?.total_points?.mean ?? 0;
        const bV =
          tbaTeams.find((t) => t.key === b.team)?.epa?.total_points?.mean ?? 0;
        return bV - aV;
      }
      if (sortKey === "opr") {
        const aV = tbaTeams.find((t) => t.key === a.team)?.opr ?? 0;
        const bV = tbaTeams.find((t) => t.key === b.team)?.opr ?? 0;
        return bV - aV;
      }
      // GRAPHABLE_STAT: descending by average
      return (
        getTeamStatAvg(sortKey, b.team, matchData) -
        getTeamStatAvg(sortKey, a.team, matchData)
      );
    });
    setEntries(sorted.map((e, i) => ({ ...e, rank: i + 1 })));
  };

  // ── Delete ──
  const handleDelete = async () => {
    if (!currentEvent) return;
    try {
      await deletePicklist(picklistId, currentEvent);
      toast.success("Picklist deleted");
      navigate({ to: "/picklists" });
    } catch {
      toast.error("Failed to delete picklist");
    }
  };

  // ── No picklist found ──
  if (!selectedPicklist) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-sm text-muted-foreground">
            {picklistId ? "Picklist not found." : "No picklist selected."}
          </p>
          <button
            onClick={() => navigate({ to: "/picklists" })}
            className="text-xs text-primary hover:underline"
          >
            Go to Picklist Selector
          </button>
        </div>
      </div>
    );
  }

  // ── Slot model: index 0 = newest (full panel), 1 = full panel, 2-3 = bars ──
  const fullPanelTeams = selectedTeams.slice(0, 2);
  const barTeams = selectedTeams.slice(2, 4);

  return (
    <div className="flex h-full overflow-hidden p-3 gap-3">
      {/* ══════════════════════════════════════════
          LEFT SIDEBAR
      ══════════════════════════════════════════ */}
      <div className="w-[260px] flex-shrink-0 flex flex-col bg-card  rounded-lg overflow-hidden">
        {/* Header */}
        <div className="px-3 pt-2 pb-1">
          <div className="flex items-center gap-2 px-3 py-2.5 border border-primary/50 rounded-lg">
            <AlignJustify className="w-4 h-4 text-primary flex-shrink-0" />
            {editingTitle ? (
              <input
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={() => setEditingTitle(false)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setEditingTitle(false);
                  if (e.key === "Escape") {
                    setTitleDraft(selectedPicklist.title);
                    setEditingTitle(false);
                  }
                }}
                className="text-sm font-semibold text-foreground bg-transparent border-0 outline-none flex-1 min-w-0"
              />
            ) : (
              <span
                onClick={() => {
                  setTitleDraft(selectedPicklist.title);
                  setEditingTitle(true);
                }}
                className="text-sm font-semibold text-foreground truncate flex-1 cursor-text hover:text-primary/80 transition-colors"
              >
                {selectedPicklist.title}
              </span>
            )}
            <button
              onClick={() => {
                setSettingsOpen((v) => !v);
                setSortOpen(false);
              }}
              className={[
                "rounded-md border transition-colors flex-shrink-0",
                settingsOpen
                  ? "border-muted bg-primary/10 text-primary"
                  : "border-muted text-muted-foreground hover:text-primary hover:bg-primary/5",
              ].join(" ")}
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Settings dropdown */}
        {settingsOpen && (
          <div className="mx-3 mb-2 px-4 py-3 space-y-2.5 bg-card border border-border rounded-lg">
            {/* Move excluded */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                Move excluded teams
              </span>
              <button
                onClick={() => setExcludedToBottom((v) => !v)}
                className={[
                  "text-xs px-3 py-1 rounded-md font-medium transition-colors border",
                  excludedToBottom
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted text-muted-foreground border-border hover:border-primary/40",
                ].join(" ")}
              >
                {excludedToBottom ? "Disable" : "Enable"}
              </button>
            </div>

            {/* Visibility */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                Picklist visibility
              </span>
              <button
                onClick={() =>
                  setPicklistType(
                    (v) =>
                      TYPE_CYCLE[
                        (TYPE_CYCLE.indexOf(v) + 1) % TYPE_CYCLE.length
                      ]
                  )
                }
                className="text-xs px-3 py-1 rounded-md bg-muted text-muted-foreground border border-border hover:border-primary/40 font-medium transition-colors capitalize"
              >
                {picklistType}
              </button>
            </div>

            {/* Sort by — searchable combobox (full width) */}
            <Popover open={sortOpen} onOpenChange={setSortOpen}>
              <PopoverTrigger asChild>
                <button className="w-full text-xs px-3 py-1 rounded-md font-medium border border-border bg-muted text-muted-foreground hover:border-primary/40 transition-colors text-left">
                  Sort by...
                </button>
              </PopoverTrigger>
              <PopoverContent
                className="w-[220px] p-0 bg-muted border border-border shadow-xl"
                align="end"
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
                    {[...new Set(ALL_SORT_OPTIONS.map((s) => s.group))].map(
                      (group) => (
                        <CommandGroup
                          key={group}
                          heading={group}
                          className="text-muted-foreground/70"
                        >
                          {ALL_SORT_OPTIONS.filter(
                            (s) => s.group === group
                          ).map((opt) => (
                            <CommandItem
                              key={opt.key}
                              value={`${opt.group} ${opt.label}`}
                              onSelect={() => {
                                handleSort(opt.key);
                                setSortOpen(false);
                              }}
                              className="text-xs cursor-pointer text-muted-foreground hover:text-primary"
                            >
                              {opt.label}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      )
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        )}

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

        {/* Main content area - flex column to match right side */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Team list - aligned with team view section */}
          <div className="flex-[3] overflow-y-auto py-2 px-3 space-y-2.5 ">
            <DndContext
              sensors={sidebarSensors}
              collisionDetection={closestCenter}
              onDragEnd={handleSidebarDragEnd}
            >
              <SortableContext
                items={displayEntries.map((e) => e.team)}
                strategy={verticalListSortingStrategy}
              >
                {filteredEntries.map((entry) => (
                  <SidebarTeamCard
                    key={entry.team}
                    entry={entry}
                    tbaTeam={tbaTeams.find((t) => t.key === entry.team)}
                    isSelected={selectedTeams.includes(entry.team)}
                    onSelect={() => toggleSelectedTeam(entry.team)}
                    onToggleExclude={() => toggleExclude(entry.team)}
                  />
                ))}
                {filteredEntries.length === 0 && (
                  <div className="flex items-center justify-center h-16 text-xs text-muted-foreground">
                    No teams found
                  </div>
                )}
              </SortableContext>
            </DndContext>
          </div>

          {/* Bottom actions - aligned with graph section */}
          <div className="w-full h-auto p-3 flex items-end">
          <div className="w-full">
            {deleteConfirmOpen ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDelete}
                  className="flex-1 h-10 flex items-center justify-center gap-1.5 px-3 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
                <button
                  onClick={() => setDeleteConfirmOpen(false)}
                  className="flex-1 h-10 flex items-center justify-center gap-1.5 px-3 rounded-lg border border-border text-sm font-medium text-foreground/80 hover:border-muted-foreground transition-colors"
                >
                  <X className="w-4 h-4" />
                  Cancel
                </button>
              </div>
            ) : hasChanges ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={saveChanges}
                  disabled={isSaving}
                  className="flex-1 h-10 flex items-center justify-center gap-1.5 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  <Save className="w-4 h-4" />
                  {isSaving ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={resetChanges}
                  disabled={isSaving}
                  className="flex-1 h-10 flex items-center justify-center gap-1.5 px-3 rounded-lg border border-border text-sm font-medium text-foreground/80 hover:border-muted-foreground disabled:opacity-50 transition-colors"
                >
                  <RotateCcw className="w-4 h-4" />
                  Reset
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  className="h-10 w-10 flex items-center justify-center rounded-lg border border-border text-primary hover:border-muted-foreground transition-colors flex-shrink-0"
                  title="Switch picklist"
                >
                  <Shuffle className="w-5 h-5" />
                </button>
                <button
                  onClick={() => navigate({ to: "/picklists" })}
                  className="flex-1 h-10 flex items-center justify-center px-3 rounded-lg border border-border text-sm font-medium text-foreground/80 hover:border-muted-foreground transition-colors"
                >
                  Switch Picklist
                </button>
                <button
                  onClick={() => setDeleteConfirmOpen(true)}
                  className="h-10 w-10 flex items-center justify-center rounded-lg border border-border text-primary hover:border-destructive hover:text-destructive transition-colors flex-shrink-0"
                  title="Delete picklist"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            )}
          </div>
        </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════
          RIGHT AREA
      ══════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0  gap-4 rounded-lg">
        {/* ── Main Team View (top ~70%) ── */}
        <div className="flex-[3] flex items-center justify-center overflow-hidden min-h-0 ">
          {selectedTeams.length === 0 ? (
            <div className="w-full h-full flex items-center justify-center border border-border rounded-lg">
              <p className="text-sm text-primary">
                Click a team in the sidebar to add it here
              </p>
            </div>
          ) : (
            <>
              {/* All panels and bars in one centered flex container with consistent gap */}
              <DndContext
                sensors={mainViewSensors}
                collisionDetection={closestCenter}
                onDragEnd={handleMainDragEnd}
              >
                <SortableContext items={selectedTeams}>
                  <div className="flex h-full items-stretch justify-center gap-3">
                    {/* Full panels (slots 0 & 1) - fixed width */}
                    {fullPanelTeams.map((teamKey) => (
                      <SortableFullPanel
                        key={teamKey}
                        teamKey={teamKey}
                        entry={entries.find((e) => e.team === teamKey)}
                        tbaTeam={tbaTeams.find((t) => t.key === teamKey)}
                        matchData={matchData}
                        tbaClimbData={tbaClimbData}
                        useTbaClimb={useTbaClimb}
                        onMoveUp={() => moveRank(teamKey, "up")}
                        onMoveDown={() => moveRank(teamKey, "down")}
                        onRemove={() =>
                          setSelectedTeams((prev) =>
                            prev.filter((t) => t !== teamKey)
                          )
                        }
                      />
                    ))}
                    {/* Bars (slots 2 & 3) - same gap as full panels */}
                    {barTeams.map((teamKey) => (
                      <SortableTeamBar
                        key={teamKey}
                        teamKey={teamKey}
                        entry={entries.find((e) => e.team === teamKey)}
                        tbaTeam={tbaTeams.find((t) => t.key === teamKey)}
                        onRemove={() =>
                          setSelectedTeams((prev) =>
                            prev.filter((t) => t !== teamKey)
                          )
                        }
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </>
          )}
        </div>

        {/* ── Graph Section (bottom ~30%) ── */}
        <div className="flex-[1] flex items-stretch justify-center gap-4   min-h-0">
          {activeMetrics.map((metricKey) => (
            <GraphCard
              key={metricKey}
              metricKey={metricKey}
              teams={selectedTeams}
              matchData={matchData}
              tbaTeams={tbaTeams}
              showPercentiles={!!showPercentiles[metricKey]}
              onTogglePercentiles={() =>
                setShowPercentiles((prev) => ({
                  ...prev,
                  [metricKey]: !prev[metricKey],
                }))
              }
              onRemove={() =>
                setActiveMetrics((prev) => prev.filter((k) => k !== metricKey))
              }
            />
          ))}

          {activeMetrics.length === 0 && (
            <div className="flex items-center justify-center flex-1 border border-border rounded-lg">
              <p className="text-sm text-primary">
                Click + to add a stat comparison graph
              </p>
            </div>
          )}

          {/* Add metric button - same height as graph bubbles, entire bar is clickable */}
          <button
            onClick={() => setShowMetricPicker((v) => !v)}
            className="w-14 flex-shrink-0 border border-border rounded-lg bg-card flex items-center justify-center text-primary hover:bg-secondary transition-colors cursor-pointer relative"
            title="Add metric"
          >
            <Plus className="w-5 h-5" />
            {showMetricPicker && (
              <MetricPicker
                activeMetrics={activeMetrics}
                onSelect={(key) => {
                  setActiveMetrics((prev) => {
                    if (prev.length >= 3) {
                      return [...prev.slice(1), key];
                    }
                    return [...prev, key];
                  });
                  setShowMetricPicker(false);
                }}
                onClose={() => setShowMetricPicker(false)}
              />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
