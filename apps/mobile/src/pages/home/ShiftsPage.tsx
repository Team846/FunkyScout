import { useEffect, useState } from "react";
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
    // Past
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  }
};

export function ShiftsPage() {
  const navigate = useNavigate();
  const { currentEvent } = useEvent();
  const { tbaSchedule } = useCompetition();
  const userData = getLocalUserData();
  const [shifts, setShifts] = useState<ShiftDisplay[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);

  useEffect(() => {
    if (!currentEvent) {
      setInitialLoading(false);
      return;
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
        const now = Date.now();

        // Map assignments to display format with match times
        const shiftsWithTimes = assignments.map((assignment) => {
          const matchData = tbaSchedule[assignment.match];
          const matchTime = matchData?.est_time
            ? matchData.est_time * 1000
            : null;

          return {
            match: assignment.match,
            matchLabel: getMatchLabel(assignment.match),
            team: assignment.team,
            teamNumber: assignment.team.replace("frc", ""),
            alliance: assignment.alliance,
            time: matchTime,
            timeLabel: matchTime ? formatRelativeTime(matchTime) : "Unknown",
          };
        });

        // Separate upcoming and past shifts
        const upcomingShifts = shiftsWithTimes
          .filter((s) => s.time && s.time > now)
          .sort((a, b) => (a.time || 0) - (b.time || 0));

        // If there are upcoming shifts, show only those
        // Otherwise, show all shifts sorted by time
        if (upcomingShifts.length > 0) {
          setShifts(upcomingShifts);
        } else {
          // Show all shifts sorted by time (most recent first for past matches)
          const allShiftsSorted = shiftsWithTimes.sort(
            (a, b) => (b.time || 0) - (a.time || 0)
          );
          setShifts(allShiftsSorted);
        }
      })
      .catch((error) => {
        console.error("Failed to load shifts:", error);
        setShifts([]);
      })
      .finally(() => setInitialLoading(false));
  }, [currentEvent, userData.name, tbaSchedule]);

  if (!currentEvent) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">No event selected</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-1 flex-col gap-4 min-h-0 overflow-hidden">
      <Command className="flex h-full flex-1 min-h-0 flex-col w-full bg-background [&_[data-slot=command-input-wrapper]]:border-0 [&_[data-slot=command-input-wrapper]]:h-14 [&_[data-slot=command-input-wrapper]]:rounded-2xl [&_[data-slot=command-input-wrapper]]:bg-muted [&_[data-slot=command-input-wrapper]]:px-1 [&_[data-slot=command-input-wrapper]]:sticky [&_[data-slot=command-input-wrapper]]:top-0 [&_[data-slot=command-input-wrapper]]:z-10">
        <CommandInput
          className="text-foreground text-md placeholder-border"
          placeholder="Search shifts..."
        />
        <CommandList className="mt-5 flex h-full flex-1 min-h-0 max-h-none flex-col gap-4 overflow-y-auto">
          <CommandEmpty>
            {initialLoading ? "Loading shifts..." : "No shifts assigned."}
          </CommandEmpty>
          {shifts.map((shift, idx) => (
            <CommandItem
              key={`${shift.match}-${shift.team}-${idx}`}
              className="rounded-2xl bg-muted px-6 py-6 mb-3 last:mb-0 data-[selected]:bg-muted min-h-[80px] cursor-pointer"
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
          ))}
        </CommandList>
      </Command>
    </div>
  );
}
