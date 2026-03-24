import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { ArrowLeftRight, Maximize2, RotateCcw, Search, Trash2 } from "lucide-react";
import { Card } from "@shadcn/ui/components/card.tsx";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@shadcn/ui/components/hover-card.tsx";
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
import { useDesktopRealtime, type ActiveScout } from "../contexts/DesktopRealtimeContext";

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


function MatchCardSmall({
  card,
  type,
  onMatchClick,
  onReassignClick,
  onVisualSwapDrop,
  dragPositionKey,
}: {
  card: MatchCard;
  type: "scouter-past" | "scouter-next" | "team-past" | "team-next";
  onMatchClick?: (matchKey: string) => void;
  /** Called when the reassign icon is clicked — opens scouter picker */
  onReassignClick?: (matchKey: string, team: string) => void;
  /** Visual-only swap callback on mouse release over another card */
  onVisualSwapDrop?: (sourceKey: string, targetKey: string | null) => void;
  /** Stable slot key (row + index) for deterministic visual swapping */
  dragPositionKey?: string;
}) {
  const allianceBorder =
    card.alliance === "red"
      ? "border-red-500/40 bg-red-500/10"
      : "border-blue-500/40 bg-blue-500/10";
  const isTeam = type === "team-past" || type === "team-next";
  const matchTime = formatMatchTime(card.estTime);
  const allowReassign = type === "scouter-next";
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 });
  const [dragSize, setDragSize] = useState({ w: 180, h: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragPointerOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const sourceRectRef = useRef<DOMRect | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const hoverTargetElRef = useRef<HTMLElement | null>(null);
  const hoverTargetKeyRef = useRef<string | null>(null);
  const draggedRef = useRef(false);

  const beginVisualDrag = useCallback((clientX: number, clientY: number) => {
    if (!allowReassign) return;
    const rect = cardRef.current?.getBoundingClientRect();
    const offsetX = rect ? clientX - rect.left : 16;
    const offsetY = rect ? clientY - rect.top : 16;
    dragPointerOffsetRef.current = { x: offsetX, y: offsetY };
    if (rect) {
      setDragSize({ w: rect.width, h: rect.height });
      setDragPos({ x: rect.left, y: rect.top });
      sourceRectRef.current = rect;
    } else {
      setDragPos({ x: clientX - offsetX, y: clientY - offsetY });
      sourceRectRef.current = null;
    }
    draggedRef.current = false;
    setIsDragging(true);
  }, [allowReassign]);

  useEffect(() => {
    if (!isDragging || !dragPointerOffsetRef.current) return;
    const pointerOffset = dragPointerOffsetRef.current;
    const prevUserSelect = document.body.style.userSelect;
    const prevWebkitUserSelect = (document.body.style as any).webkitUserSelect;
    document.body.style.userSelect = "none";
    (document.body.style as any).webkitUserSelect = "none";

    const onMove = (e: MouseEvent) => {
      e.preventDefault();
      const dx = e.clientX - (dragPos.x + pointerOffset.x);
      const dy = e.clientY - (dragPos.y + pointerOffset.y);
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) draggedRef.current = true;
      const hoveredEl = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest?.(
        "[data-shift-card-pos]"
      ) as HTMLElement | null;
      const ownKey = dragPositionKey ?? `${card.matchKey}|${card.team}`;
      const hoveredKey = hoveredEl?.getAttribute("data-shift-card-pos");
      const canSwapHover =
        hoveredEl &&
        hoveredKey &&
        hoveredKey !== ownKey &&
        hoveredEl.getAttribute("data-shift-card-type") === "scouter-next";

      // Hover marks potential drop target and visually "lifts" that target.
      if (canSwapHover) {
        if (hoverTargetElRef.current && hoverTargetElRef.current !== hoveredEl) {
          hoverTargetElRef.current.style.transform = "";
          hoverTargetElRef.current.style.transition = "";
          hoverTargetElRef.current.style.zIndex = "";
          hoverTargetElRef.current.style.boxShadow = "";
        }
        hoverTargetElRef.current = hoveredEl!;
        hoverTargetElRef.current.style.transition = "transform 120ms ease, box-shadow 120ms ease";
        hoverTargetElRef.current.style.transform = "translateY(-4px) scale(1.02)";
        hoverTargetElRef.current.style.zIndex = "40";
        hoverTargetElRef.current.style.boxShadow = "0 8px 20px rgba(0,0,0,0.18)";
        hoverTargetKeyRef.current = hoveredKey ?? null;
      } else {
        if (hoverTargetElRef.current) {
          hoverTargetElRef.current.style.transform = "";
          hoverTargetElRef.current.style.transition = "";
          hoverTargetElRef.current.style.zIndex = "";
          hoverTargetElRef.current.style.boxShadow = "";
          hoverTargetElRef.current = null;
        }
        hoverTargetKeyRef.current = null;
      }

      setDragPos({
        x: e.clientX - pointerOffset.x,
        y: e.clientY - pointerOffset.y,
      });
    };
    const endDrag = () => {
      const ownKey = dragPositionKey ?? `${card.matchKey}|${card.team}`;
      onVisualSwapDrop?.(ownKey, hoverTargetKeyRef.current);
      if (hoverTargetElRef.current) {
        hoverTargetElRef.current.style.transform = "";
        hoverTargetElRef.current.style.transition = "";
        hoverTargetElRef.current.style.zIndex = "";
        hoverTargetElRef.current.style.boxShadow = "";
        hoverTargetElRef.current = null;
      }
      setIsDragging(false);
      setDragPos({ x: 0, y: 0 });
      dragPointerOffsetRef.current = null;
      sourceRectRef.current = null;
      hoverTargetKeyRef.current = null;
      // reset flag after click cycle to avoid immediate click-open.
      setTimeout(() => {
        draggedRef.current = false;
      }, 0);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", endDrag);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", endDrag);
      if (hoverTargetElRef.current) {
        hoverTargetElRef.current.style.transform = "";
        hoverTargetElRef.current.style.transition = "";
        hoverTargetElRef.current.style.zIndex = "";
        hoverTargetElRef.current.style.boxShadow = "";
        hoverTargetElRef.current = null;
      }
      document.body.style.userSelect = prevUserSelect;
      (document.body.style as any).webkitUserSelect = prevWebkitUserSelect;
    };
  }, [isDragging, dragPos.x, dragPos.y, card.matchKey, card.team, onVisualSwapDrop]);

  const cardContent = (
    <>
      {allowReassign && (
        <div
          data-reassign-shift="true"
          className="flex-shrink-0 flex items-center justify-center w-6 text-muted-foreground hover:text-primary rounded transition-colors cursor-pointer"
          title="Reassign this shift to another scouter"
          aria-label="Reassign shift"
          onClick={(e) => {
            e.stopPropagation();
            onReassignClick?.(card.matchKey, card.team);
          }}
        >
          <ArrowLeftRight className="w-3.5 h-3.5" />
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
    </>
  );

  return (
    <>
    <div
      ref={cardRef}
      role={onMatchClick ? "button" : undefined}
      tabIndex={onMatchClick ? 0 : undefined}
      onClick={onMatchClick ? () => {
        if (draggedRef.current) return;
        onMatchClick(card.matchKey);
      } : undefined}
      onKeyDown={onMatchClick ? (e) => e.key === "Enter" && onMatchClick(card.matchKey) : undefined}
      className={`w-[180px] flex-shrink-0 border rounded-lg py-3 flex items-stretch gap-0 ${allianceBorder} ${
        onMatchClick ? "cursor-pointer hover:opacity-90 hover:ring-2 hover:ring-primary/50 transition-all" : ""
      } ${allowReassign ? "pl-1 pr-3" : "px-3"}`}
      data-shift-card-pos={dragPositionKey ?? `${card.matchKey}|${card.team}`}
      data-shift-card-type={type}
      style={{
        visibility: isDragging ? "hidden" : undefined,
      }}
      onMouseDown={(e) => {
        // Visual drag prototype: hold and drag card, then snap back.
        if (!allowReassign) return;
        // Ignore right/middle click.
        if (e.button !== 0) return;
        // Don't start card drag when clicking reassign icon.
        const target = e.target as HTMLElement;
        if (target.closest("[data-reassign-shift='true']")) return;
        beginVisualDrag(e.clientX, e.clientY);
      }}
      title={onMatchClick ? `View ${card.matchDisplay}` : undefined}
    >
      {cardContent}
    </div>
    {isDragging && (
      <div
        className={`fixed border rounded-lg py-3 flex items-stretch gap-0 ${allianceBorder} ${allowReassign ? "pl-1 pr-3" : "px-3"}`}
        style={{
          left: dragPos.x,
          top: dragPos.y,
          width: dragSize.w,
          height: dragSize.h > 0 ? dragSize.h : undefined,
          zIndex: 9999,
          boxShadow: "0 14px 34px rgba(0,0,0,0.28)",
          transform: "scale(1.03)",
          opacity: 0.96,
          pointerEvents: "none",
        }}
      >
        {cardContent}
      </div>
    )}
    </>
  );
}

function MatchCardScroll({
  cards,
  type,
  alignRight,
  ownerId,
  onMatchClick,
  onReassignClick,
  onVisualSwapDrop,
}: {
  cards: MatchCard[];
  type: "scouter-past" | "scouter-next" | "team-past" | "team-next";
  alignRight?: boolean;
  ownerId?: string;
  onMatchClick?: (matchKey: string) => void;
  onReassignClick?: (matchKey: string, team: string) => void;
  onVisualSwapDrop?: (sourceKey: string, targetKey: string | null) => void;
}) {
  return (
    <div className={`flex-1 flex items-center min-w-0 ${alignRight ? "justify-end" : ""}`}>
      <div
        className={`flex gap-3.5 overflow-x-auto items-center py-1 ${alignRight ? "flex-row-reverse" : ""}`}
      >
        {cards.length === 0 ? (
          <div className="text-sm text-muted-foreground/30 px-2">—</div>
        ) : (
          cards.map((m, idx) => (
            <MatchCardSmall
              key={type === "scouter-next" && ownerId ? `${ownerId}|${idx}` : `${m.matchKey}-${m.team}`}
              card={m}
              type={type}
              onMatchClick={onMatchClick}
              onReassignClick={onReassignClick}
              onVisualSwapDrop={onVisualSwapDrop}
              dragPositionKey={type === "scouter-next" && ownerId ? `${ownerId}|${idx}` : undefined}
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
  activeScout,
  onRatingChange,
  onExclude,
}: {
  row: ScouterViewRow;
  rating: number | null;
  activeScout?: ActiveScout;
  onRatingChange: (n: number) => void;
  onExclude: () => void;
}) {
  const isActive = !!activeScout;
  const isInMatch = activeScout?.phase === "match_play";

  return (
    <Card className={`w-[220px] flex-shrink-0 px-4 py-3 flex flex-col gap-1.5 ${isActive ? "ring-1 ring-green-500/40" : ""}`}>
      {/* Row 1: name + presence dot + stars */}
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {isActive ? (
            <HoverCard openDelay={200} closeDelay={100}>
              <HoverCardTrigger asChild>
                <span
                  className={`flex-shrink-0 w-2 h-2 rounded-full cursor-pointer ${isInMatch ? "bg-green-500 animate-pulse" : "bg-yellow-400 animate-pulse"}`}
                  title={isInMatch ? "In match" : "At start position"}
                />
              </HoverCardTrigger>
              <HoverCardContent className="w-56 p-3" side="top">
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-semibold text-foreground">
                    {isInMatch ? "🟢 Actively Scouting" : "🟡 At Start Position"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {getMatchLabel(activeScout.match)} · Team {activeScout.team.replace("frc", "")}
                  </p>
                </div>
              </HoverCardContent>
            </HoverCard>
          ) : null}
          <span className="font-semibold text-base truncate flex-1">{row.name}</span>
        </div>
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
  activeScout,
  onRatingChange,
  onExclude,
  onMatchClick,
  onReassignClick,
  onVisualSwapDrop,
}: {
  row: ScouterViewRow;
  rating: number | null;
  activeScout?: ActiveScout;
  onRatingChange: (uid: string, n: number) => void;
  onExclude: (uid: string) => void;
  onMatchClick?: (matchKey: string) => void;
  onReassignClick?: (matchKey: string, team: string) => void;
  onVisualSwapDrop?: (sourceKey: string, targetKey: string | null) => void;
}) {
  return (
    <div className="flex items-center gap-6">
      <MatchCardScroll cards={row.pastMatches} type="scouter-past" alignRight onMatchClick={onMatchClick} />
      <ScouterCard
        row={row}
        rating={rating}
        activeScout={activeScout}
        onRatingChange={(n) => onRatingChange(row.uid, n)}
        onExclude={() => onExclude(row.uid)}
      />
      <MatchCardScroll
        cards={row.nextMatches}
        type="scouter-next"
        ownerId={row.uid}
        onMatchClick={onMatchClick}
        onReassignClick={onReassignClick}
        onVisualSwapDrop={onVisualSwapDrop}
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
  const { addTab, activeTabId } = useTabContext();
  const { currentEvent } = useDesktopEvent();
  const { activeScouts } = useDesktopRealtime();
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
  const [savingSwaps, setSavingSwaps] = useState(false);
  // Visual-only swap map: positionKey (uid|idx) -> cardKey (matchKey|team)
  const [visualSwapMap, setVisualSwapMap] = useState<Record<string, string>>({});
  // Undo stack for pending (unsaved) visual swaps.
  const [pendingSwapHistory, setPendingSwapHistory] = useState<Record<string, string>[]>([]);

  /** Reassign popup — open when switch icon is clicked on a shift card. */
  const [reassignTarget, setReassignTarget] = useState<{ matchKey: string; team: string } | null>(null);
  const [reassignSearch, setReassignSearch] = useState("");
  const [reassignBusy, setReassignBusy] = useState(false);
  /** Pending conflict confirmation: set when target scouter is already on another team in the same match. */
  const [reassignConflict, setReassignConflict] = useState<{ uid: string; name: string; conflictingTeam: string } | null>(null);

  const openReassignPopup = useCallback((matchKey: string, team: string) => {
    setReassignTarget({ matchKey, team });
    setReassignSearch("");
    setReassignConflict(null);
  }, []);

  const closeReassignPopup = useCallback(() => {
    setReassignTarget(null);
    setReassignSearch("");
    setReassignConflict(null);
  }, []);

  const doReassign = useCallback(
    async (targetUid: string, targetName: string) => {
      if (!reassignTarget || !currentEvent) return;
      closeReassignPopup();
      setReassignBusy(true);
      try {
        await assignShiftsDiff(currentEvent, [
          { matchKey: reassignTarget.matchKey, teamKey: reassignTarget.team, uid: targetUid, name: targetName },
        ]);
        await refreshCompetition();
        toast.success(`Assigned to ${targetName}`);
      } catch (err) {
        console.error("[Shifts] Reassign failed:", err);
        toast.error("Failed to reassign shift");
      } finally {
        setReassignBusy(false);
      }
    },
    [reassignTarget, currentEvent, refreshCompetition, closeReassignPopup],
  );

  const handleReassign = useCallback(
    (targetUid: string, targetName: string) => {
      if (!reassignTarget) return;
      // Check if this scouter is already assigned to a different team in the same match
      const conflict = schedule.find(
        (s) => s.match === reassignTarget.matchKey && s.uid === targetUid && s.team !== reassignTarget.team
      );
      if (conflict) {
        setReassignConflict({ uid: targetUid, name: targetName, conflictingTeam: conflict.team.replace(/frc/i, "") });
        return;
      }
      doReassign(targetUid, targetName);
    },
    [reassignTarget, schedule, doReassign],
  );

  // Clear dirty state when event changes
  useEffect(() => {
    setDirtyRatings({});
    setDirtyPriorities({});
    setReassignTarget(null);
    setVisualSwapMap({});
    setPendingSwapHistory([]);
  }, [currentEvent]);

  // Ensure this route always starts from real schedule data.
  useEffect(() => {
    setVisualSwapMap({});
    setPendingSwapHistory([]);
  }, []);

  // Swaps are intentionally ephemeral; leaving the Shifts page clears them.
  useEffect(() => {
    return () => {
      setVisualSwapMap({});
      setPendingSwapHistory([]);
    };
  }, []);

  // In this app tabs can remain mounted; clear temporary swaps when Shifts is not active.
  useEffect(() => {
    if (activeTabId !== "shifts") {
      setVisualSwapMap({});
      setPendingSwapHistory([]);
    }
  }, [activeTabId]);

  const scouterRows = useMemo(
    () => buildScouterViewData({ schedule, matchData: matchScoutingData, profiles: userProfiles, tbaClimbData, tbaScheduleMap: tbaSchedule }),
    [schedule, matchScoutingData, userProfiles, tbaClimbData, tbaSchedule]
  );

  const baseScouterPositionMap = useMemo(() => {
    const base: Record<string, string> = {};
    for (const row of scouterRows) {
      row.nextMatches.forEach((c, idx) => {
        base[`${row.uid}|${idx}`] = `${c.matchKey}|${c.team}`;
      });
    }
    return base;
  }, [scouterRows]);

  const applyVisualSwapMapToRows = useCallback((map: Record<string, string>) => {
    if (Object.keys(map).length === 0) return scouterRows;
    const byCardKey = new Map<string, MatchCard>();
    for (const row of scouterRows) {
      for (const c of row.nextMatches) byCardKey.set(`${c.matchKey}|${c.team}`, c);
    }
    return scouterRows.map((row) => ({
      ...row,
      nextMatches: row.nextMatches.map((c, idx) => {
        const posKey = `${row.uid}|${idx}`;
        const mappedCardKey = map[posKey];
        if (!mappedCardKey) return c;
        return byCardKey.get(mappedCardKey) ?? c;
      }),
    }));
  }, [scouterRows]);

  const mergedVisualPositionMap = useMemo(
    () => ({ ...baseScouterPositionMap, ...visualSwapMap }),
    [baseScouterPositionMap, visualSwapMap]
  );

  const visualScouterRows = useMemo(
    () => applyVisualSwapMapToRows(mergedVisualPositionMap),
    [applyVisualSwapMapToRows, mergedVisualPositionMap]
  );

  const pendingSwapPositionKeys = useMemo(
    () =>
      Object.keys(baseScouterPositionMap).filter(
        (k) =>
          mergedVisualPositionMap[k] &&
          mergedVisualPositionMap[k] !== baseScouterPositionMap[k]
      ),
    [baseScouterPositionMap, mergedVisualPositionMap]
  );

  const teamRows = useMemo(
    () => buildTeamViewData({ schedule, matchData: matchScoutingData, tbaTeams, pitData: pitScoutingData, tbaClimbData, profiles: userProfiles, tbaScheduleMap: tbaSchedule }),
    [schedule, matchScoutingData, tbaTeams, pitScoutingData, tbaClimbData, userProfiles, tbaSchedule]
  );

  const filteredScouters = useMemo(
    () =>
      visualScouterRows.filter((s) => {
        if (scouterSearch) {
          return s.name
            .toLowerCase()
            .includes(scouterSearch.toLowerCase());
        }
        return true;
      }),
    [visualScouterRows, scouterSearch]
  );

  const handleVisualSwapDrop = useCallback((sourceKey: string, targetKey: string | null) => {
    if (!targetKey || targetKey === sourceKey) return;
    setVisualSwapMap((prev) => {
      const parsePosKey = (k: string) => {
        const sep = k.lastIndexOf("|");
        if (sep <= 0) return null;
        return { uid: k.slice(0, sep), idx: Number(k.slice(sep + 1)) };
      };

      const next: Record<string, string> = { ...baseScouterPositionMap, ...prev };
      const sourceCard = next[sourceKey];
      const targetCard = next[targetKey];
      if (!sourceCard || !targetCard) return prev;

      const sourcePos = parsePosKey(sourceKey);
      const targetPos = parsePosKey(targetKey);
      if (!sourcePos || !targetPos) return prev;

      // Only block same-scouter swaps; allow all cross-scouter swaps.
      if (sourcePos.uid === targetPos.uid) {
        return prev;
      }

      setPendingSwapHistory((history) => [...history, prev]);
      next[sourceKey] = targetCard;
      next[targetKey] = sourceCard;
      return next;
    });
  }, [baseScouterPositionMap]);

  const handleSaveSwaps = useCallback(async () => {
    if (!currentEvent) return;
    if (pendingSwapPositionKeys.length === 0) return;

    const currentMap = { ...baseScouterPositionMap, ...visualSwapMap };
    const getMatchKeyFromCardKey = (cardKey: string) => {
      const sep = cardKey.lastIndexOf("|");
      return sep > 0 ? cardKey.slice(0, sep) : cardKey;
    };
    const parseCardKey = (cardKey: string) => {
      const sep = cardKey.lastIndexOf("|");
      if (sep <= 0) return null;
      return { matchKey: cardKey.slice(0, sep), teamKey: cardKey.slice(sep + 1) };
    };
    const duplicateCountForScouter = (uid: string, map: Record<string, string>) => {
      const row = scouterRows.find((r) => r.uid === uid);
      if (!row) return 0;
      const seen = new Set<string>();
      let duplicateCount = 0;
      for (let idx = 0; idx < row.nextMatches.length; idx++) {
        const posKey = `${uid}|${idx}`;
        const cardKey = map[posKey];
        if (!cardKey) continue;
        const matchKey = getMatchKeyFromCardKey(cardKey);
        if (seen.has(matchKey)) {
          duplicateCount += 1;
          continue;
        }
        seen.add(matchKey);
      }
      return duplicateCount;
    };

    // Block only if pending swaps introduce/worsen duplicate-match assignments.
    // Existing baseline duplicates should not prevent saving unrelated swaps.
    const touchedScouters = new Set(
      pendingSwapPositionKeys
        .map((k) => k.slice(0, k.lastIndexOf("|")))
        .filter((uid) => uid.length > 0)
    );
    for (const uid of touchedScouters) {
      const beforeCount = duplicateCountForScouter(uid, baseScouterPositionMap);
      const afterCount = duplicateCountForScouter(uid, currentMap);
      if (afterCount > beforeCount) {
        toast.error("Cannot save: a scouter has two shifts from the same match.");
        return;
      }
    }

    // Incremental patch only for cards whose assigned scouter changed.
    const changesByCard = new Map<string, { matchKey: string; teamKey: string; uid: string; name: string | null }>();
    for (const posKey of pendingSwapPositionKeys) {
      const currentCardKey = currentMap[posKey];
      const baseCardKey = baseScouterPositionMap[posKey];
      if (!currentCardKey || currentCardKey === baseCardKey) continue;
      const parsed = parseCardKey(currentCardKey);
      if (!parsed) continue;
      const sep = posKey.lastIndexOf("|");
      if (sep <= 0) continue;
      const uid = posKey.slice(0, sep);
      const name = scouterRows.find((r) => r.uid === uid)?.name ?? null;
      changesByCard.set(`${parsed.matchKey}|${parsed.teamKey}`, {
        matchKey: parsed.matchKey,
        teamKey: parsed.teamKey,
        uid,
        name,
      });
    }
    const changes = Array.from(changesByCard.values());
    if (changes.length === 0) return;

    setSavingSwaps(true);
    try {
      await assignShiftsDiff(currentEvent, changes);
      await refreshCompetition();
      setVisualSwapMap({});
      setPendingSwapHistory([]);
      toast.success(`Saved ${changes.length} swapped shift${changes.length === 1 ? "" : "s"}`);
    } catch (e) {
      console.error("[Shifts] Failed to save swaps:", e);
      toast.error("Failed to save swapped shifts");
    } finally {
      setSavingSwaps(false);
    }
  }, [currentEvent, pendingSwapPositionKeys, baseScouterPositionMap, visualSwapMap, scouterRows, refreshCompetition]);

  const handleRevertLastPendingSwap = useCallback(() => {
    setPendingSwapHistory((history) => {
      if (history.length === 0) return history;
      const nextHistory = history.slice(0, -1);
      const previousMap = history[history.length - 1] ?? {};
      setVisualSwapMap(previousMap);
      return nextHistory;
    });
  }, []);

  const handleClearPendingSwaps = useCallback(() => {
    setVisualSwapMap({});
    setPendingSwapHistory([]);
  }, []);

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
  const hasPendingSwaps = pendingSwapPositionKeys.length > 0;

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
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground basis-full sm:basis-auto sm:ml-1">
              Click <ArrowLeftRight className="inline size-3 align-text-bottom opacity-70" /> on an upcoming shift to reassign it to another scouter.
            </p>
            {hasPendingSwaps && (
              <>
                <Button
                  size="sm"
                  className="h-8 ml-auto"
                  disabled={savingSwaps || saving}
                  onClick={handleSaveSwaps}
                >
                  {savingSwaps ? "Saving swaps…" : `Save Swaps (${pendingSwapPositionKeys.length})`}
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8"
                  disabled={savingSwaps || saving || pendingSwapHistory.length === 0}
                  onClick={handleRevertLastPendingSwap}
                  title="Revert last pending swap"
                  aria-label="Revert last pending swap"
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8"
                  disabled={savingSwaps || saving || pendingSwapPositionKeys.length === 0}
                  onClick={handleClearPendingSwaps}
                  title="Clear all pending swaps"
                  aria-label="Clear all pending swaps"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
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
                  activeScout={activeScouts.find((a) => a.uid === s.uid)}
                  onRatingChange={handleRatingChange}
                  onExclude={handleExcludeScouter}
                  onMatchClick={handleMatchClick}
                  onReassignClick={openReassignPopup}
                  onVisualSwapDrop={handleVisualSwapDrop}
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
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
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

      {/* ── Reassign popup ── */}
      {reassignTarget && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={closeReassignPopup}
          />
          <div
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-64 bg-muted border border-border rounded-lg shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="text-sm font-semibold text-foreground">
                {reassignConflict ? "Conflict detected" : "Assign to scouter"}
              </span>
              <button onClick={closeReassignPopup} className="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none">×</button>
            </div>
            {reassignConflict ? (
              <div className="px-4 py-4 flex flex-col gap-3">
                <p className="text-sm text-foreground">
                  <span className="font-medium">{reassignConflict.name}</span> is already assigned to Team{" "}
                  <span className="font-medium">{reassignConflict.conflictingTeam}</span> in this match. Assign to this match as well?
                </p>
                <div className="flex gap-2">
                  <button
                    disabled={reassignBusy}
                    onClick={() => {
                      doReassign(reassignConflict.uid, reassignConflict.name);
                      setReassignConflict(null);
                    }}
                    className="flex-1 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    Assign anyway
                  </button>
                  <button
                    onClick={() => setReassignConflict(null)}
                    className="flex-1 py-1.5 text-sm font-medium bg-card border border-border rounded-md text-foreground hover:bg-muted transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="px-3 py-2 border-b border-border">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <input
                      type="text"
                      value={reassignSearch}
                      onChange={(e) => setReassignSearch(e.target.value)}
                      placeholder="Search scouters…"
                      className="w-full pl-8 pr-3 py-1.5 text-sm bg-card border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
                      autoFocus
                      autoCorrect="off"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                </div>
                <div className="max-h-60 overflow-y-auto py-1">
                  {filteredScouters
                    .filter((s) =>
                      !reassignSearch.trim() ||
                      s.name.toLowerCase().includes(reassignSearch.toLowerCase())
                    )
                    .map((s) => (
                      <button
                        key={s.uid}
                        disabled={reassignBusy}
                        onClick={() => handleReassign(s.uid, s.name)}
                        className="w-full text-left px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-card transition-colors disabled:opacity-50"
                      >
                        {s.name}
                      </button>
                    ))}
                  {filteredScouters.filter((s) =>
                    !reassignSearch.trim() ||
                    s.name.toLowerCase().includes(reassignSearch.toLowerCase())
                  ).length === 0 && (
                    <div className="px-4 py-4 text-sm text-muted-foreground text-center">No scouters found</div>
                  )}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
