import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  type DragEvent,
  type ReactNode,
} from "react";
import { GripVertical, Maximize2 } from "lucide-react";
import { Card } from "@shadcn/ui/components/card.tsx";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@shadcn/ui/components/tabs.tsx";
import { Input } from "@shadcn/ui/components/input.tsx";
import { Button } from "@shadcn/ui/components/button.tsx";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@shadcn/ui/components/alert-dialog.tsx";
import { useDesktopEvent } from "../contexts/DesktopEventContext";
import { useDesktopCompetitionData } from "../contexts/DesktopCompetitionDataContext";
import { useDesktopTeamData } from "../contexts/DesktopTeamDataContext";
import {
  buildScouterViewData,
  buildTeamViewData,
  teamsMatch,
  type ScouterViewRow,
  type TeamViewRow,
  type MatchCard,
} from "@lib/data/shiftViews";
import { setScouterRating } from "@lib/data/scouterRatings";
import { useUserProfiles } from "../contexts/UserProfilesContext";
import { assignShiftsDiff, setTeamPriority } from "@lib/data/writes";
import { permanentlyExcludeScouter } from "@lib/data/scouterExclusions";
import { toast } from "sonner";
import { useTabContext } from "../contexts/TabContext";
import { getMatchLabel } from "@lib/utils/match";

export const Route = createFileRoute("/shifts")({
  component: ShiftViewerPage,
});

// ─── Module-level UI state persistence (survives tab navigation) ─────────────
interface ShiftsUIState {
  scouterSearch: string;
  teamSearch: string;
  activeTab: "by-scouter" | "by-team";
  scrollY: number;
}
let _shiftsUIState: ShiftsUIState | null = null;

// ─── Sub-components ───────────────────────────────────────────────────────────

function StarRating({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex gap-0">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          onClick={() => onChange(n)}
          className={`text-sm px-0.5 transition-colors leading-none ${
            value != null && n <= value
              ? "text-yellow-400"
              : "text-muted-foreground/25"
          } hover:text-yellow-300`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

function ClimbBadge({
  wasScouted,
  scouted,
  tba,
  climbMatch,
}: {
  wasScouted: boolean | undefined;
  scouted: "L1" | "L2" | "L3" | null | undefined;
  tba: "L1" | "L2" | "L3" | null | undefined;
  climbMatch: boolean | null | undefined;
}) {
  if (!wasScouted) {
    return <span className="text-[10px] text-muted-foreground/40">—</span>;
  }
  if (climbMatch === null || climbMatch === undefined) {
    return <span className="text-[10px] text-muted-foreground/40">no TBA</span>;
  }
  return (
    <span
      className={`text-[10px] font-medium leading-none ${
        climbMatch ? "text-green-500" : "text-red-400"
      }`}
    >
      {climbMatch
        ? scouted != null ? `${scouted} ✓` : "no climb ✓"
        : `${scouted ?? "none"} ≠ ${tba ?? "none"}`}
    </span>
  );
}

function formatMatchTime(estTime: number | null): string | null {
  if (!estTime) return null;
  const date = new Date(estTime * 1000);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

const SHIFT_DRAG_MIME = "application/x-funkyscout-shift";

function MatchCardSmall({
  card,
  type,
  onMatchClick,
  shiftSwapDragKey,
  shiftSwapHoverKey,
  shiftSwapDisabled,
  onShiftSwapDragOver,
  onShiftSwapDragLeave,
  onShiftSwapDragStart,
  onShiftSwapDragEnd,
  onShiftSwapDrop,
}: {
  card: MatchCard;
  type: "scouter-past" | "scouter-next" | "team-past" | "team-next";
  onMatchClick?: (matchKey: string) => void;
  /** When set (e.g. `match|team`), this card is the active drag source — dim others */
  shiftSwapDragKey?: string | null;
  /** Drop-target highlight */
  shiftSwapHoverKey?: string | null;
  onShiftSwapDragOver?: (matchKey: string, team: string) => void;
  onShiftSwapDragLeave?: () => void;
  onShiftSwapDragStart?: (matchKey: string, team: string) => void;
  onShiftSwapDragEnd?: () => void;
  shiftSwapDisabled?: boolean;
  onShiftSwapDrop?: (targetMatchKey: string, targetTeam: string, e: DragEvent) => void;
}) {
  const allianceBorder =
    card.alliance === "red"
      ? "border-red-500/40 bg-red-500/10"
      : "border-blue-500/40 bg-blue-500/10";
  const isTeam = type === "team-past" || type === "team-next";
  const matchTime = formatMatchTime(card.estTime);
  const shiftSwapKey = `${card.matchKey}|${card.team}`;
  const allowShiftSwap = type === "scouter-next";
  const isShiftSwapSource = allowShiftSwap && shiftSwapDragKey === shiftSwapKey;
  const isShiftSwapTargetHover =
    allowShiftSwap &&
    shiftSwapDragKey &&
    shiftSwapDragKey !== shiftSwapKey &&
    shiftSwapHoverKey === shiftSwapKey;

  return (
    <div
      role={onMatchClick ? "button" : undefined}
      tabIndex={onMatchClick ? 0 : undefined}
      onClick={onMatchClick ? () => onMatchClick(card.matchKey) : undefined}
      onKeyDown={onMatchClick ? (e) => e.key === "Enter" && onMatchClick(card.matchKey) : undefined}
      onDragOver={
        allowShiftSwap &&
        !shiftSwapDisabled &&
        shiftSwapDragKey &&
        shiftSwapDragKey !== shiftSwapKey
          ? (e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              onShiftSwapDragOver?.(card.matchKey, card.team);
            }
          : undefined
      }
      onDragLeave={
        allowShiftSwap
          ? (e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                onShiftSwapDragLeave?.();
              }
            }
          : undefined
      }
      onDrop={
        allowShiftSwap && !shiftSwapDisabled
          ? (e) => {
              e.preventDefault();
              onShiftSwapDrop?.(card.matchKey, card.team, e);
            }
          : undefined
      }
      className={`w-[180px] flex-shrink-0 border rounded-lg py-3 flex items-stretch gap-0 ${allianceBorder} ${
        onMatchClick ? "cursor-pointer hover:opacity-90 hover:ring-2 hover:ring-primary/50 transition-all" : ""
      } ${isShiftSwapTargetHover ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""} ${
        shiftSwapDragKey && allowShiftSwap && !isShiftSwapSource ? "opacity-60" : ""
      } ${allowShiftSwap ? "pl-1 pr-3" : "px-3"}`}
      title={
        allowShiftSwap
          ? `${onMatchClick ? `View ${card.matchDisplay} · ` : ""}Drag ⋮⋮ to swap this shift with another scouter`
          : onMatchClick
            ? `View ${card.matchDisplay}`
            : undefined
      }
    >
      {allowShiftSwap && (
        <div
          draggable={!shiftSwapDisabled}
          onDragStart={(e) => {
            if (shiftSwapDisabled) {
              e.preventDefault();
              return;
            }
            e.stopPropagation();
            const payload = JSON.stringify({ matchKey: card.matchKey, team: card.team });
            e.dataTransfer.setData(SHIFT_DRAG_MIME, payload);
            e.dataTransfer.setData("text/plain", payload);
            e.dataTransfer.effectAllowed = "move";
            onShiftSwapDragStart?.(card.matchKey, card.team);
          }}
          onDragEnd={(e) => {
            e.stopPropagation();
            onShiftSwapDragEnd?.();
          }}
          className="flex-shrink-0 flex items-center justify-center w-6 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground rounded touch-none"
          title="Drag to swap with another upcoming shift"
          aria-label="Drag to swap shift"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="w-4 h-4" />
        </div>
      )}
      {/* Left side: centered vertically */}
      <div className="flex flex-1 flex-col items-center justify-center gap-1 pr-2 min-w-0">
        <span className="font-semibold text-base">{card.matchDisplay}</span>

        {!isTeam && (
          <span className="text-sm text-primary leading-none">
            {card.teamNumber}
          </span>
        )}

        {type === "team-past" && (
          <>
            {(card.redScore ?? -1) >= 0 && (
              <div className="text-sm leading-none font-medium">
                <span className="text-red-400">{card.redScore}</span>
                <span className="text-muted-foreground/50"> - </span>
                <span className="text-blue-400">{card.blueScore}</span>
              </div>
            )}
            <div
              className={`text-xs leading-snug truncate ${
                card.wasScouted ? "text-primary" : "text-muted-foreground/70"
              }`}
            >
              {card.wasScouted
                ? card.scoutedByName ?? "Scouted"
                : "Not scouted"}
            </div>
          </>
        )}

        {type === "team-next" && card.predictedRedScore != null && (
          <div className="text-sm leading-none font-medium">
            <span className="text-red-400/70">{Math.round(card.predictedRedScore)}</span>
            <span className="text-muted-foreground/50"> - </span>
            <span className="text-blue-400/70">{Math.round(card.predictedBlueScore ?? 0)}</span>
          </div>
        )}
      </div>

      {/* Vertical divider */}
      <div className="w-px bg-border shrink-0" />

      {/* Right side: left-aligned, close to divider */}
      <div className="flex flex-1 flex-col items-start justify-center gap-1 pl-2 min-w-0">
        {matchTime ? (
          <span className="text-xs text-muted-foreground/60">{matchTime}</span>
        ) : (
          <span className="text-xs text-muted-foreground/40">—</span>
        )}

        {type === "scouter-past" && (
          <ClimbBadge
            wasScouted={card.wasScouted}
            scouted={card.scoutedClimbLevel}
            tba={card.tbaClimbLevel}
            climbMatch={card.climbMatch}
          />
        )}

        {type === "team-past" && (
          <ClimbBadge
            wasScouted={card.wasScouted}
            scouted={card.scoutedClimbLevel}
            tba={card.tbaClimbLevel}
            climbMatch={card.climbMatch}
          />
        )}

        {type === "team-next" && (
          <div
            className={`text-xs leading-snug truncate text-right ${
              card.assignedScouterName ? "text-primary" : "text-muted-foreground/70"
            }`}
          >
            {card.assignedScouterName ?? "No one assigned"}
          </div>
        )}
      </div>
    </div>
  );
}

function MatchCardScroll({
  cards,
  type,
  alignRight,
  onMatchClick,
  shiftSwapDragKey,
  shiftSwapHoverKey,
  shiftSwapDisabled,
  onShiftSwapDragStart,
  onShiftSwapDragEnd,
  onShiftSwapDragOver,
  onShiftSwapDragLeave,
  onShiftSwapDrop,
}: {
  cards: MatchCard[];
  type: "scouter-past" | "scouter-next" | "team-past" | "team-next";
  alignRight?: boolean;
  onMatchClick?: (matchKey: string) => void;
  shiftSwapDragKey?: string | null;
  shiftSwapHoverKey?: string | null;
  shiftSwapDisabled?: boolean;
  onShiftSwapDragStart?: (matchKey: string, team: string) => void;
  onShiftSwapDragEnd?: () => void;
  onShiftSwapDragOver?: (matchKey: string, team: string) => void;
  onShiftSwapDragLeave?: () => void;
  onShiftSwapDrop?: (targetMatchKey: string, targetTeam: string, e: DragEvent) => void;
}) {
  return (
    <div className={`flex-1 flex items-center min-w-0 ${alignRight ? "justify-end" : ""}`}>
      <div
        className={`flex gap-3.5 overflow-x-auto items-center py-1 ${alignRight ? "flex-row-reverse" : ""}`}
      >
        {cards.length === 0 ? (
          <div className="text-sm text-muted-foreground/30 px-2">—</div>
        ) : (
          cards.map((m) => (
            <MatchCardSmall
              key={`${m.matchKey}-${m.team}`}
              card={m}
              type={type}
              onMatchClick={onMatchClick}
              shiftSwapDragKey={shiftSwapDragKey}
              shiftSwapHoverKey={shiftSwapHoverKey}
              shiftSwapDisabled={shiftSwapDisabled}
              onShiftSwapDragStart={onShiftSwapDragStart}
              onShiftSwapDragEnd={onShiftSwapDragEnd}
              onShiftSwapDragOver={onShiftSwapDragOver}
              onShiftSwapDragLeave={onShiftSwapDragLeave}
              onShiftSwapDrop={onShiftSwapDrop}
            />
          ))
        )}
      </div>
    </div>
  );
}

// Center card — scouter
function ScouterCard({
  row,
  rating,
  onRatingChange,
  onExclude,
}: {
  row: ScouterViewRow;
  rating: number | null;
  onRatingChange: (n: number) => void;
  onExclude: () => void;
}) {
  return (
    <Card className="w-[220px] flex-shrink-0 px-4 py-3 flex flex-col gap-1.5">
      {/* Row 1: name + stars */}
      <div className="flex items-center justify-between gap-2 min-w-0">
        <span className="font-semibold text-base truncate flex-1">{row.name}</span>
        <StarRating value={rating} onChange={onRatingChange} />
      </div>
      {/* Row 2: stats */}
      <div className="text-xs text-muted-foreground leading-snug">
        {row.matchesScouted}/{row.matchesAssigned} scouted
        {row.climbAccuracy != null && ` · ${row.climbAccuracy.toFixed(0)}% accuracy`}
      </div>
      {/* Row 3: exclude button */}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            size="sm"
            variant="destructive"
            className="h-6 text-xs w-full mt-0.5"
          >
            Exclude Data
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Exclude all data from {row.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently soft-delete all {row.matchesScouted} match submission{row.matchesScouted !== 1 ? "s" : ""} from {row.name} for this event. The data will be removed from all calculations and synced to Supabase. This can be undone from the exclusion manager.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={onExclude}
            >
              Exclude Data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// Center card — team
function TeamCard({
  row,
  priority,
  onPriorityChange,
  onExpand,
}: {
  row: TeamViewRow;
  priority: number | null;
  onPriorityChange: (n: number) => void;
  onExpand?: () => void;
}) {
  return (
    <Card className="w-[220px] flex-shrink-0 px-4 py-3 flex flex-col gap-1.5">
      {/* Row 1: team number + name + expand */}
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="font-bold text-base flex-shrink-0">{row.teamNumber}</span>
        <span className="text-xs text-muted-foreground truncate flex-1">{row.teamName}</span>
        {onExpand && (
          <button
            onClick={onExpand}
            className="p-0.5 rounded text-muted-foreground/50 hover:text-foreground transition-colors flex-shrink-0"
            title="Open team page"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {/* Row 2: EPA + scouted */}
      <div className="text-xs text-muted-foreground leading-snug">
        {row.matchesScouted}/{row.matchesAssigned} scouted
        {row.epa != null && ` · EPA ${row.epa.toFixed(1)}`}
      </div>
      {/* Row 3: priority stars */}
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground">Priority</span>
        <StarRating value={priority} onChange={onPriorityChange} />
      </div>
      {/* Row 4: pit scouting badge */}
      {row.pitScoutedByName ? (
        <div className="text-[10px] leading-none px-1.5 py-0.5 rounded bg-primary/15 text-primary w-fit">
          Scouted by {row.pitScoutedByName}
        </div>
      ) : row.pitAssignedName ? (
        <div className="text-[10px] leading-none px-1.5 py-0.5 rounded bg-ring/15 text-ring w-fit">
          Assigned to {row.pitAssignedName}
        </div>
      ) : (
        <div className="text-[10px] leading-none px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground/50 w-fit">
          Not assigned
        </div>
      )}
    </Card>
  );
}

function ScouterRow({
  row,
  rating,
  onRatingChange,
  onExclude,
  onMatchClick,
  shiftSwapDragKey,
  shiftSwapHoverKey,
  shiftSwapDisabled,
  onShiftSwapDragStart,
  onShiftSwapDragEnd,
  onShiftSwapDragOver,
  onShiftSwapDragLeave,
  onShiftSwapDrop,
}: {
  row: ScouterViewRow;
  rating: number | null;
  onRatingChange: (uid: string, n: number) => void;
  onExclude: (uid: string) => void;
  onMatchClick?: (matchKey: string) => void;
  shiftSwapDragKey?: string | null;
  shiftSwapHoverKey?: string | null;
  shiftSwapDisabled?: boolean;
  onShiftSwapDragStart?: (matchKey: string, team: string) => void;
  onShiftSwapDragEnd?: () => void;
  onShiftSwapDragOver?: (matchKey: string, team: string) => void;
  onShiftSwapDragLeave?: () => void;
  onShiftSwapDrop?: (targetMatchKey: string, targetTeam: string, e: DragEvent) => void;
}) {
  return (
    <div className="flex items-center gap-6">
      <MatchCardScroll cards={row.pastMatches} type="scouter-past" alignRight onMatchClick={onMatchClick} />
      <ScouterCard
        row={row}
        rating={rating}
        onRatingChange={(n) => onRatingChange(row.uid, n)}
        onExclude={() => onExclude(row.uid)}
      />
      <MatchCardScroll
        cards={row.nextMatches}
        type="scouter-next"
        onMatchClick={onMatchClick}
        shiftSwapDragKey={shiftSwapDragKey}
        shiftSwapHoverKey={shiftSwapHoverKey}
        shiftSwapDisabled={shiftSwapDisabled}
        onShiftSwapDragStart={onShiftSwapDragStart}
        onShiftSwapDragEnd={onShiftSwapDragEnd}
        onShiftSwapDragOver={onShiftSwapDragOver}
        onShiftSwapDragLeave={onShiftSwapDragLeave}
        onShiftSwapDrop={onShiftSwapDrop}
      />
    </div>
  );
}

function TeamRow({
  row,
  priority,
  onPriorityChange,
  onMatchClick,
  onTeamClick,
}: {
  row: TeamViewRow;
  priority: number | null;
  onPriorityChange: (teamKey: string, n: number) => void;
  onMatchClick?: (matchKey: string) => void;
  onTeamClick?: (teamKey: string) => void;
}) {
  return (
    <div className="flex items-center gap-6">
      <MatchCardScroll cards={row.pastMatches} type="team-past" alignRight onMatchClick={onMatchClick} />
      <TeamCard
        row={row}
        priority={priority}
        onPriorityChange={(n) => onPriorityChange(row.teamKey, n)}
        onExpand={onTeamClick ? () => onTeamClick(row.teamKey) : undefined}
      />
      <MatchCardScroll cards={row.nextMatches} type="team-next" onMatchClick={onMatchClick} />
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="text-center py-10 text-muted-foreground text-sm">
      {children}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function ShiftViewerPage() {
  const navigate = useNavigate();
  const { addTab } = useTabContext();
  const { currentEvent } = useDesktopEvent();
  const { schedule, tbaClimbData, matchScoutingData, tbaSchedule, refresh: refreshCompetition } =
    useDesktopCompetitionData();
  const { tbaTeams, pitScoutingData, refresh: refreshTeams } = useDesktopTeamData();
  const { userProfiles, refresh: refreshUserProfiles } = useUserProfiles();

  const handleMatchClick = useCallback(
    (matchKey: string) => {
      addTab("/matches", getMatchLabel(matchKey), { match: matchKey }, `match-${matchKey}`);
      navigate({ to: "/matches", search: { match: matchKey } });
    },
    [addTab, navigate]
  );

  const handleTeamClick = useCallback(
    (teamKey: string) => {
      const teamNum = teamKey.replace("frc", "");
      addTab("/team", `Team ${teamNum}`, { team: teamKey }, `team-${teamKey}`);
      navigate({ to: "/team", search: { team: teamKey } });
    },
    [addTab, navigate]
  );

  const [scouterSearch, setScouterSearch] = useState(() => _shiftsUIState?.scouterSearch ?? "");
  const [teamSearch, setTeamSearch] = useState(() => _shiftsUIState?.teamSearch ?? "");
  const [activeTab, setActiveTab] = useState<"by-scouter" | "by-team">(() => _shiftsUIState?.activeTab ?? "by-scouter");
  const scrollRef = useRef<HTMLDivElement>(null);
  // Persist UI state synchronously on every render (scrollY preserved from last known value)
  _shiftsUIState = { scouterSearch, teamSearch, activeTab, scrollY: _shiftsUIState?.scrollY ?? 0 };

  // Restore scroll position on mount
  useEffect(() => {
    if (scrollRef.current && _shiftsUIState?.scrollY) {
      scrollRef.current.scrollTop = _shiftsUIState.scrollY;
    }
  }, []);

  // Pending changes — lifted from individual rows so one Save covers everything
  const [dirtyRatings, setDirtyRatings] = useState<Record<string, number>>({});
  const [dirtyPriorities, setDirtyPriorities] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  /** Drag ⋮⋮ on upcoming shift cards to swap assignments (incremental Supabase patch). */
  const [shiftSwapDragKey, setShiftSwapDragKey] = useState<string | null>(null);
  const [shiftSwapHoverKey, setShiftSwapHoverKey] = useState<string | null>(null);
  const [shiftSwapBusy, setShiftSwapBusy] = useState(false);

  const parseShiftDragPayload = useCallback((e: DragEvent): { matchKey: string; team: string } | null => {
    const raw = e.dataTransfer.getData(SHIFT_DRAG_MIME) || e.dataTransfer.getData("text/plain");
    try {
      const o = JSON.parse(raw) as { matchKey?: string; team?: string };
      if (o.matchKey && o.team) return { matchKey: o.matchKey, team: o.team };
    } catch {
      /* ignore */
    }
    return null;
  }, []);

  const handleShiftSwapDrop = useCallback(
    async (targetMatchKey: string, targetTeam: string, e: DragEvent) => {
      const from = parseShiftDragPayload(e);
      setShiftSwapDragKey(null);
      setShiftSwapHoverKey(null);
      if (!from || !currentEvent) return;
      if (from.matchKey === targetMatchKey && from.team === targetTeam) return;

      const entry1 = schedule.find((s) => s.match === from.matchKey && s.team === from.team);
      const entry2 = schedule.find((s) => s.match === targetMatchKey && s.team === targetTeam);
      if (!entry1 || !entry2) {
        toast.error("Could not find schedule rows for swap.");
        return;
      }

      const uid1 = entry1.uid ?? null;
      const name1 = entry1.name ?? null;
      const uid2 = entry2.uid ?? null;
      const name2 = entry2.name ?? null;

      if (uid1 === uid2 && (name1 ?? "") === (name2 ?? "")) {
        toast.info("Nothing to swap — same scouter on both shifts.");
        return;
      }

      setShiftSwapBusy(true);
      try {
        await assignShiftsDiff(currentEvent, [
          { matchKey: from.matchKey, teamKey: from.team, uid: uid2, name: name2 },
          { matchKey: targetMatchKey, teamKey: targetTeam, uid: uid1, name: name1 },
        ]);
        await refreshCompetition();
        toast.success("Swapped shifts");
      } catch (err) {
        console.error("[Shifts] Swap failed:", err);
        toast.error("Failed to swap shifts");
      } finally {
        setShiftSwapBusy(false);
      }
    },
    [currentEvent, schedule, refreshCompetition, parseShiftDragPayload],
  );

  // Clear dirty state when event changes
  useEffect(() => {
    setDirtyRatings({});
    setDirtyPriorities({});
    setShiftSwapDragKey(null);
    setShiftSwapHoverKey(null);
  }, [currentEvent]);

  const scouterRows = useMemo(
    () => buildScouterViewData({ schedule, matchData: matchScoutingData, profiles: userProfiles, tbaClimbData, tbaScheduleMap: tbaSchedule }),
    [schedule, matchScoutingData, userProfiles, tbaClimbData, tbaSchedule]
  );

  const teamRows = useMemo(
    () => buildTeamViewData({ schedule, matchData: matchScoutingData, tbaTeams, pitData: pitScoutingData, tbaClimbData, profiles: userProfiles, tbaScheduleMap: tbaSchedule }),
    [schedule, matchScoutingData, tbaTeams, pitScoutingData, tbaClimbData, userProfiles, tbaSchedule]
  );

  const filteredScouters = useMemo(
    () =>
      scouterRows.filter((s) => {
        if (scouterSearch) {
          return s.name
            .toLowerCase()
            .includes(scouterSearch.toLowerCase());
        }
        return true;
      }),
    [scouterRows, scouterSearch]
  );


  const filteredTeams = useMemo(
    () =>
      teamSearch
        ? teamRows.filter(
            (t) =>
              t.teamNumber.toString().includes(teamSearch) ||
              t.teamName.toLowerCase().includes(teamSearch.toLowerCase())
          )
        : teamRows,
    [teamRows, teamSearch]
  );

  const handleRatingChange = useCallback((uid: string, n: number) => {
    // Only mark dirty if the value actually differs from the saved rating.
    // Prevents the save/reset buttons from appearing when the user clicks
    // the same star that's already persisted.
    const savedProfile = userProfiles.find((p) => p.uid === uid);
    const savedRating = (savedProfile?.settings as any)?.scouterRating ?? null;
    setDirtyRatings((prev) => {
      if (n === savedRating) {
        const { [uid]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [uid]: n };
    });
  }, [userProfiles]);

  const handlePriorityChange = useCallback((teamKey: string, n: number) => {
    // Only mark dirty if the value actually differs from the saved priority.
    // Use Number() to handle JSON number/string type mismatches from SQLite.
    const savedPit = pitScoutingData.find((p) => teamsMatch(p.team, teamKey));
    const raw = savedPit?.data?.priority;
    const savedNum =
      raw === undefined || raw === null ? null : Number(raw);
    setDirtyPriorities((prev) => {
      const same = savedNum !== null && Number(n) === savedNum;
      if (same) {
        const { [teamKey]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [teamKey]: n };
    });
  }, [pitScoutingData]);

  const handleSaveAll = useCallback(async () => {
    if (!currentEvent) return;
    const toSaveRatings = { ...dirtyRatings };
    const toSavePriorities = { ...dirtyPriorities };
    if (
      Object.keys(toSaveRatings).length === 0 &&
      Object.keys(toSavePriorities).length === 0
    )
      return;
    // Clear dirty state immediately so Save/Reset buttons disappear
    setDirtyRatings({});
    setDirtyPriorities({});
    setSaving(true);
    try {
      await Promise.all([
        ...Object.entries(toSaveRatings).map(([uid, r]) =>
          setScouterRating(uid, r)
        ),
        ...Object.entries(toSavePriorities).map(([teamKey, p]) =>
          setTeamPriority(currentEvent, teamKey, p)
        ),
      ]);
      // Re-read from local SQLite so the UI reflects saved values immediately
      // (without waiting for the next 120s Rust sync cycle)
      await Promise.all([refreshTeams(), refreshUserProfiles()]);
      toast.success("Saved");
    } catch (e) {
      console.error("[Shifts] Save failed:", e);
      // Restore dirty state so user can retry
      setDirtyRatings(toSaveRatings);
      setDirtyPriorities(toSavePriorities);
    } finally {
      setSaving(false);
    }
  }, [currentEvent, dirtyRatings, dirtyPriorities]);

  const handleReset = useCallback(() => {
    setDirtyRatings({});
    setDirtyPriorities({});
    toast.success("Changes discarded");
  }, []);

  const handleExcludeScouter = useCallback(async (uid: string) => {
    if (!currentEvent) return;
    try {
      // Cast needed: MatchScoutingData (desktop) vs EventMatchData (lib) differ only in `name` nullability
      await permanentlyExcludeScouter(uid, currentEvent, matchScoutingData as any);
      // Re-read from SQLite so excluded submissions disappear immediately
      await refreshCompetition();
      toast.success("Scouter data excluded");
    } catch (e) {
      console.error("[Shifts] Failed to exclude scouter:", e);
      toast.error("Failed to exclude scouter data");
    }
  }, [currentEvent, matchScoutingData, refreshCompetition]);

  const hasScouterChanges = Object.keys(dirtyRatings).length > 0;
  const hasTeamChanges = Object.keys(dirtyPriorities).length > 0;

  if (!currentEvent) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">
          Please select an event to view shifts.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="p-4 h-full overflow-y-auto"
      onScroll={(e) => {
        if (_shiftsUIState) _shiftsUIState.scrollY = (e.currentTarget as HTMLDivElement).scrollTop;
      }}
    >
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "by-scouter" | "by-team")} className="w-full">
        <TabsList>
          <TabsTrigger value="by-scouter">By Scouter</TabsTrigger>
          <TabsTrigger value="by-team">By Team</TabsTrigger>
        </TabsList>

        {/* ── By Scouter ── */}
        <TabsContent value="by-scouter" className="mt-3 space-y-3">
          {/* Toolbar: search + save/reset */}
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              placeholder="Search scouters…"
              value={scouterSearch}
              onChange={(e) => setScouterSearch(e.target.value)}
              className="w-52 h-8 text-sm"
            />
            <p className="text-xs text-muted-foreground basis-full sm:basis-auto sm:ml-1">
              Drag <GripVertical className="inline size-3 align-text-bottom opacity-70" /> on an upcoming shift to swap it with another scouter (saves via incremental schedule patch).
            </p>
            {hasScouterChanges && (
              <>
                <Button
                  size="sm"
                  className="h-8"
                  disabled={saving}
                  onClick={handleSaveAll}
                >
                  {saving ? "Saving…" : `Save (${Object.keys(dirtyRatings).length})`}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  disabled={saving}
                  onClick={handleReset}
                >
                  Reset ({Object.keys(dirtyRatings).length})
                </Button>
              </>
            )}
          </div>

          {filteredScouters.length === 0 ? (
            <EmptyState>
              {scouterSearch
                ? "No scouters match the search"
                : "No scouters assigned or scouting data found"}
            </EmptyState>
          ) : (
            <div className="space-y-6">
              {filteredScouters.map((s) => (
                <ScouterRow
                  key={s.uid}
                  row={s}
                  rating={dirtyRatings[s.uid] ?? s.rating}
                  onRatingChange={handleRatingChange}
                  onExclude={handleExcludeScouter}
                  onMatchClick={handleMatchClick}
                  shiftSwapDragKey={shiftSwapDragKey}
                  shiftSwapHoverKey={shiftSwapHoverKey}
                  shiftSwapDisabled={shiftSwapBusy}
                  onShiftSwapDragStart={(matchKey, team) => setShiftSwapDragKey(`${matchKey}|${team}`)}
                  onShiftSwapDragEnd={() => {
                    setShiftSwapDragKey(null);
                    setShiftSwapHoverKey(null);
                  }}
                  onShiftSwapDragOver={(matchKey, team) => setShiftSwapHoverKey(`${matchKey}|${team}`)}
                  onShiftSwapDragLeave={() => setShiftSwapHoverKey(null)}
                  onShiftSwapDrop={handleShiftSwapDrop}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── By Team ── */}
        <TabsContent value="by-team" className="mt-3 space-y-3">
          {/* Toolbar: search + save/reset */}
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              placeholder="Search teams…"
              value={teamSearch}
              onChange={(e) => setTeamSearch(e.target.value)}
              className="w-52 h-8 text-sm"
            />
            {hasTeamChanges && (
              <>
                <Button
                  size="sm"
                  className="h-8"
                  disabled={saving}
                  onClick={handleSaveAll}
                >
                  {saving ? "Saving…" : `Save (${Object.keys(dirtyPriorities).length})`}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  disabled={saving}
                  onClick={handleReset}
                >
                  Reset ({Object.keys(dirtyPriorities).length})
                </Button>
              </>
            )}
          </div>

          {filteredTeams.length === 0 ? (
            <EmptyState>
              {teamSearch
                ? "No teams match the search"
                : "No teams in the schedule"}
            </EmptyState>
          ) : (
            <div className="space-y-6">
              {filteredTeams.map((t) => (
                <TeamRow
                  key={t.teamKey}
                  row={t}
                  priority={dirtyPriorities[t.teamKey] ?? t.priority}
                  onPriorityChange={handlePriorityChange}
                  onMatchClick={handleMatchClick}
                  onTeamClick={handleTeamClick}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
