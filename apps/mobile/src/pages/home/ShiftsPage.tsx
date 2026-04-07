import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandEmpty,
} from "@shadcn/ui/components/command.js";
import { Badge } from "@shadcn/ui/components/badge.tsx";
import { useEvent } from "@lib/context/EventContext";
import { useCompetition } from "@lib/context/CompetitionDataContext";
import { getLocalUserData } from "@lib/supabase/user";
import { getMatchLabel } from "@lib/utils/match";
import {
  getUserEventScheduleAssignments,
} from "@lib/db";
import {
  requestNotificationPermission,
  scheduleShiftNotifications,
  clearShiftNotifications,
  rescheduleOnResume,
} from "../../lib/shiftNotifications";

interface ShiftDisplay {
  match: string;
  matchLabel: string;
  team: string;
  teamNumber: string;
  alliance: "red" | "blue";
  time: number | null;
  timeLabel: string;
}

// Helper function to format relative time
const formatRelativeTime = (timestamp: number): string => {
  const now = Date.now();
  const diff = timestamp - now;
  const absDiff = Math.abs(diff);

  const minutes = Math.floor(absDiff / (1000 * 60));
  const hours = Math.floor(absDiff / (1000 * 60 * 60));
  const days = Math.floor(absDiff / (1000 * 60 * 60 * 24));

  if (diff > 0) {
    // Future
    if (minutes < 60) return `in ${minutes}m`;
    if (hours < 24) {
      const remainingMins = minutes % 60;
      return remainingMins > 0
        ? `in ${hours}h ${remainingMins}m`
        : `in ${hours}h`;
    }
    return `in ${days}d`;
  } else {
    // Past — within the 2-minute buffer the match is still happening, show "Now"
    if (minutes < 2) return "Now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  }
};

// Raw shift entry before time-based splitting
interface RawShift {
  match: string;
  matchLabel: string;
  team: string;
  teamNumber: string;
  alliance: "red" | "blue";
  time: number | null;
}

function splitShifts(rawShifts: RawShift[]): { combined: ShiftDisplay[]; nextIdx: number } {
  const UPCOMING_BUFFER_MS = 2 * 60 * 1000;
  const effectiveNow = Date.now() - UPCOMING_BUFFER_MS;
  const withLabels = rawShifts.map((s) => ({
    ...s,
    timeLabel: s.time ? formatRelativeTime(s.time) : "Unknown",
  }));
  const past = withLabels.filter((s) => s.time && s.time <= effectiveNow).sort((a, b) => (a.time || 0) - (b.time || 0));
  const upcoming = withLabels.filter((s) => !s.time || s.time > effectiveNow).sort((a, b) => (a.time || 0) - (b.time || 0));
  const combined = [...past, ...upcoming];
  return { combined, nextIdx: past.length < combined.length ? past.length : -1 };
}

export function ShiftsPage() {
  const navigate = useNavigate();
  const { currentEvent } = useEvent();
  const { tbaSchedule } = useCompetition();
  const userData = getLocalUserData();
  const [rawShifts, setRawShifts] = useState<RawShift[]>([]);
  const [shifts, setShifts] = useState<ShiftDisplay[]>([]);
  const [nextShiftIdx, setNextShiftIdx] = useState<number>(-1);
  const [initialLoading, setInitialLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const hasScrolled = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const prevEventRef = useRef<string | null>(null);

  useEffect(() => {
    requestNotificationPermission();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") rescheduleOnResume();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearShiftNotifications();
    };
  }, []);

  // DB fetch — only re-run when event/user/schedule changes
  useEffect(() => {
    if (!currentEvent) {
      setRawShifts([]);
      setInitialLoading(false);
      prevEventRef.current = null;
      return;
    }

    // Clear stale data immediately when the event changes so the old event's
    // shifts don't stay visible while the async fetch is in flight.
    if (prevEventRef.current !== currentEvent) {
      setRawShifts([]);
      setInitialLoading(true);
      hasScrolled.current = false;
      prevEventRef.current = currentEvent;
    }

    const byUid = !!userData.uid;
    getUserEventScheduleAssignments(
      currentEvent,
      byUid ? userData.uid : (userData.name || ""),
      byUid
    )
      .then((assignments) => {
        console.log(
          `[ShiftsPage] Found ${assignments.length} shift assignments for user: ${userData.name}`
        );
        if (assignments.length > 0) {
          console.log("[ShiftsPage] First assignment:", assignments[0]);
        }
        const raw: RawShift[] = assignments.map((assignment) => {
          const matchData = tbaSchedule[assignment.match];
          const matchTime = matchData?.est_time ? matchData.est_time * 1000 : null;
          return {
            match: assignment.match,
            matchLabel: getMatchLabel(assignment.match),
            team: assignment.team,
            teamNumber: assignment.team.replace("frc", ""),
            alliance: assignment.alliance,
            time: matchTime,
          };
        });
        setRawShifts(raw);
      })
      .catch((error) => {
        console.error("Failed to load shifts:", error);
        setRawShifts([]);
      })
      .finally(() => setInitialLoading(false));
  }, [currentEvent, userData.name, tbaSchedule]);

  // Re-split past/upcoming every 30s so the highlight advances without a poll.
  // Also reschedule notifications so timeouts stay accurate after recompute.
  const scheduleNotifications = useCallback((upcoming: RawShift[]) => {
    scheduleShiftNotifications(
      upcoming.map((s) => ({
        match: s.match,
        matchLabel: s.matchLabel,
        teamNumber: s.teamNumber,
        alliance: s.alliance,
        time: s.time,
      }))
    );
  }, []);

  useEffect(() => {
    function recompute() {
      const { combined, nextIdx } = splitShifts(rawShifts);
      setNextShiftIdx((prev) => {
        if (prev !== nextIdx) hasScrolled.current = false;
        return nextIdx;
      });
      setShifts(combined);

      // Schedule notifications for upcoming shifts only
      const UPCOMING_BUFFER_MS = 2 * 60 * 1000;
      const effectiveNow = Date.now() - UPCOMING_BUFFER_MS;
      const upcoming = rawShifts.filter((s) => !s.time || s.time > effectiveNow);
      scheduleNotifications(upcoming);
    }
    recompute();
    const interval = setInterval(recompute, 30_000);
    return () => clearInterval(interval);
  }, [rawShifts, scheduleNotifications]);

  // Auto-scroll to the next shift once when data loads.
  // home.tsx uses min-h-dvh so the window is the scroll container (not CommandList).
  useEffect(() => {
    if (nextShiftIdx >= 0 && !hasScrolled.current && shifts.length > 0) {
      hasScrolled.current = true;
      setTimeout(() => {
        const container = listRef.current;
        if (!container) return;
        const items = container.querySelectorAll('[role="option"]');
        const targetItem = items[nextShiftIdx] as HTMLElement;
        if (!targetItem) return;
        const itemRect = targetItem.getBoundingClientRect();
        const absoluteTop = itemRect.top + window.scrollY;
        const targetScrollY = absoluteTop - window.innerHeight / 2 + targetItem.offsetHeight / 2;
        window.scrollTo({ top: targetScrollY, behavior: "smooth" });
      }, 250);
    }
  }, [nextShiftIdx, shifts.length]);

  // Filter shifts by search query while preserving time-based sort order
  const filteredShifts = searchQuery
    ? shifts.filter((shift) => {
        const q = searchQuery.toLowerCase();
        return (
          shift.matchLabel.toLowerCase().includes(q) ||
          shift.teamNumber.includes(q) ||
          shift.alliance.includes(q)
        );
      })
    : shifts;

  if (!currentEvent) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">No event selected</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-1 flex-col gap-4 min-h-0 overflow-hidden">
      <Command shouldFilter={false} className="flex h-full flex-1 min-h-0 flex-col w-full bg-background [&_[data-slot=command-input-wrapper]]:border-0 [&_[data-slot=command-input-wrapper]]:h-14 [&_[data-slot=command-input-wrapper]]:rounded-2xl [&_[data-slot=command-input-wrapper]]:bg-muted [&_[data-slot=command-input-wrapper]]:px-1 [&_[data-slot=command-input-wrapper]]:sticky [&_[data-slot=command-input-wrapper]]:top-0 [&_[data-slot=command-input-wrapper]]:z-10">
        <CommandInput
          className="text-foreground text-md placeholder-border"
          placeholder="Search shifts..."
          onValueChange={setSearchQuery}
        />
        <CommandList ref={listRef} className="mt-5 flex h-full flex-1 min-h-0 max-h-none flex-col gap-4 overflow-y-auto">
          <CommandEmpty>
            {initialLoading ? "Loading shifts..." : "No shifts assigned."}
          </CommandEmpty>
          {filteredShifts.map((shift, idx) => {
            const isNext = !searchQuery && idx === nextShiftIdx;
            return (
            <CommandItem
              key={`${shift.match}-${shift.team}-${idx}`}
              className={`rounded-2xl bg-muted px-6 py-6 mb-3 last:mb-0 data-[selected]:bg-muted min-h-[80px] cursor-pointer border-2 ${isNext ? "border-primary/67" : "border-transparent"}`}
              onSelect={() =>
                navigate({
                  to: "/match_start",
                  search: {
                    teamNum: shift.team,
                    matchNum: shift.match,
                    alliance: shift.alliance,
                    practice: false,
                  },
                })
              }
            >
              <div className="flex w-full items-center justify-between gap-3">
                <div className="flex-1">
                  <p className="text-base">
                    <span className="font-bold text-primary">
                      {shift.matchLabel}
                    </span>
                    <span className="text-foreground">
                      {" "}
                      | Team {shift.teamNumber}
                    </span>
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge
                      variant="outline"
                      className={
                        shift.alliance === "red"
                          ? "border-chart-5 text-chart-5 bg-chart-5/10"
                          : "border-chart-1 text-chart-1 bg-chart-1/10"
                      }
                    >
                      {shift.alliance.toUpperCase()}
                    </Badge>
                    <p className="text-sm text-border">{shift.timeLabel}</p>
                  </div>
                </div>
                <svg
                  viewBox="0 0 24 24"
                  style={{ width: 20, height: 20 }}
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M9 18L15 12L9 6"
                    stroke="currentColor"
                    className="text-primary"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            </CommandItem>
            );
          })}
        </CommandList>
      </Command>
    </div>
  );
}
