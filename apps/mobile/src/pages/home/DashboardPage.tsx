import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@shadcn/ui/components/button.tsx";
import { Badge } from "@shadcn/ui/components/badge.js";
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandEmpty,
} from "@shadcn/ui/components/command.js";
import { useEvent } from "@lib/context/EventContext";
import {
  getLocalUserData,
  changeName,
  useInviteCode,
  fetchUserProfile,
} from "@lib/supabase/user";
import { useTeamData } from "@lib/context/TeamDataContext";
import { useCompetition } from "@lib/context/CompetitionDataContext";
import { useAnalytics } from "@lib/context/AnalyticsDataContext";
import type { NexusMatch } from "@lib/nexus";
import { PicklistSelector } from "../../components/PicklistSelector";
import { canCreatePicklist } from "@lib/utils/permissions";
import { getMatchLabel } from "@lib/utils/match";
import {
  getUserEventScheduleAssignments,
  type EventScheduleEntry,
} from "@lib/db";

interface NextMatchData {
  matchLabel: string;
  matchTime: string;
  redTeams: number[];
  blueTeams: number[];
  ourAlliance: "red" | "blue";
  winProbability: number | null;
  isPastMatch: boolean;
  // For past matches: actual scores
  redScore: number | null;
  blueScore: number | null;
  // For future matches: predicted scores
  predictedRedScore: number | null;
  predictedBlueScore: number | null;
  // Team ranks
  teamRanks: Record<number, number>;
}

interface NextShiftData {
  matchLabel: string;
  matchKey: string;
  teamNumber: string;
  teamKey: string;
  alliance: "red" | "blue";
  timeLabel: string;
  isPastShift: boolean;
}

const formatMatchTime = (timestamp: number) => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

const formatTimeAgo = (timestamp: number) => {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
};

// Convert Nexus label (e.g., "Qualification 24") to Statbotics key suffix (e.g., "qm24")
const nexusLabelToMatchKey = (label: string): string => {
  const lower = label.toLowerCase();

  // Qualification matches: "Qualification 24" -> "qm24"
  const qualMatch = lower.match(/qualification\s*(\d+)/);
  if (qualMatch) return `qm${qualMatch[1]}`;

  // Playoff/Semifinal matches: "Playoff 1" -> "sf1m1" (simplified)
  const playoffMatch = lower.match(/playoff\s*(\d+)/);
  if (playoffMatch) return `sf1m${playoffMatch[1]}`;

  // Finals: "Final 1" -> "f1m1"
  const finalMatch = lower.match(/final\s*(\d+)/);
  if (finalMatch) return `f1m${finalMatch[1]}`;

  // Fallback: just remove spaces and lowercase
  return lower.replace(/\s+/g, "");
};

export function DashboardPage() {
  const navigate = useNavigate();
  const { currentEvent } = useEvent();
  const [userData, setUserData] = useState(getLocalUserData());
  const {
    teams,
    tbaTeams,
    loading: teamsLoading,
    scoutedTeams,
  } = useTeamData();
  const { nexusMatches, tbaSchedule } = useCompetition();
  const { matchPreds } = useAnalytics();

  const [nextMatch, setNextMatch] = useState<NextMatchData | null>(null);
  const [matchLoading, setMatchLoading] = useState(false);
  const [initialMatchLoading, setInitialMatchLoading] = useState(true);
  const [nextShift, setNextShift] = useState<NextShiftData | null>(null);
  const [shiftLoading, setShiftLoading] = useState(false);
  const [initialShiftLoading, setInitialShiftLoading] = useState(true);
  const [shiftStats, setShiftStats] = useState({
    done: 0,
    left: 0,
    untilBreak: 0,
  });
  const [picklistSelectorOpen, setPicklistSelectorOpen] = useState(false);

  const OUR_TEAM = 233;

  // DEV TEST: Set to true to test future match UI with mock data
  const DEV_TEST_FUTURE = false;

  useEffect(() => {
    if (!currentEvent) return;

    const ourTeamStr = OUR_TEAM.toString();
    const ourTeamKey = `frc${OUR_TEAM}`;

    // IMPORTANT: Clear match data if the event just changed!
    // We check if the match label belongs to the current event.
    // (Actually simpler: just clear it whenever currentEvent changes if we want absolute fresh air)

    // Only show loading on initial load, not on background refreshes
    const isInitialLoad = initialMatchLoading;
    if (isInitialLoad) {
      setMatchLoading(true);
    }

    const fetchMatchData = async () => {
      // DEV TEST: Mock future match data
      if (DEV_TEST_FUTURE) {
        setNextMatch({
          matchLabel: "QM42",
          matchTime: formatMatchTime(Date.now() + 1000 * 60 * 15),
          redTeams: [846, 254, 1678],
          blueTeams: [971, 88888, 2056],
          ourAlliance: "red",
          winProbability: 0.73,
          isPastMatch: false,
          redScore: null,
          blueScore: null,
          predictedRedScore: 142,
          predictedBlueScore: 118,
          teamRanks: { 846: 3, 254: 1, 1678: 5, 971: 8, 88888: 2, 2056: 12 },
        });
        return;
      }

      // Try Nexus first for upcoming matches (using context data)
      if (nexusMatches.length > 0) {
        const ourMatches = nexusMatches.filter(
          (match: NexusMatch) =>
            match.redTeams.includes(ourTeamStr) ||
            match.blueTeams.includes(ourTeamStr)
        );

        // Only look for upcoming matches from Nexus
        const now = Date.now();
        const upcomingMatches = ourMatches.filter(
          (match: NexusMatch) =>
            !match.times.actualOnFieldTime &&
            match.times.estimatedStartTime > now
        );

        if (upcomingMatches.length > 0) {
          // Get the soonest upcoming match
          const ourMatch = upcomingMatches.sort(
            (a: NexusMatch, b: NexusMatch) =>
              a.times.estimatedStartTime - b.times.estimatedStartTime
          )[0];

          const isOnRed = ourMatch.redTeams.includes(ourTeamStr);
          const redTeamNums = ourMatch.redTeams.map((t: string) =>
            parseInt(t, 10)
          );
          const blueTeamNums = ourMatch.blueTeams.map((t: string) =>
            parseInt(t, 10)
          );

          // Convert Nexus label to Statbotics key
          const matchKeySuffix = nexusLabelToMatchKey(ourMatch.label);
          const matchKey = `${currentEvent}_${matchKeySuffix}`;

          // Use predictions from context
          let winProb: number | null = null;
          let predictedRedScore: number | null = null;
          let predictedBlueScore: number | null = null;

          const statboticsMatch = matchPreds[matchKey];
          if (statboticsMatch && statboticsMatch.pred) {
            winProb = isOnRed
              ? statboticsMatch.pred.red_win_prob
              : 1 - statboticsMatch.pred.red_win_prob;
            predictedRedScore = Math.round(statboticsMatch.pred.red_score);
            predictedBlueScore = Math.round(statboticsMatch.pred.blue_score);
          }

          setNextMatch({
            matchLabel: ourMatch.label,
            matchTime: formatMatchTime(ourMatch.times.estimatedStartTime),
            redTeams: redTeamNums,
            blueTeams: blueTeamNums,
            ourAlliance: isOnRed ? "red" : "blue",
            winProbability: winProb,
            isPastMatch: false,
            redScore: null,
            blueScore: null,
            predictedRedScore,
            predictedBlueScore,
            teamRanks: {},
          });
          return;
        }
      }

      // No upcoming match from Nexus, use TBA data from context for past matches
      if (tbaTeams.length === 0 || Object.keys(tbaSchedule).length === 0) {
        setNextMatch(null);
        return;
      }

      // Find our team's last match
      const ourTeam = tbaTeams.find((t) => t.key === ourTeamKey);

      if (!ourTeam || !ourTeam.lastMatch) {
        setNextMatch(null);
        return;
      }

      const lastMatchKey = ourTeam.lastMatch;
      const matchData = tbaSchedule[lastMatchKey];
      if (!matchData) {
        setNextMatch(null);
        return;
      }

      const isOnRed = matchData.redTeams.includes(ourTeamKey);
      const redTeamNums = matchData.redTeams.map((t: string) =>
        parseInt(t.replace("frc", ""), 10)
      );
      const blueTeamNums = matchData.blueTeams.map((t: string) =>
        parseInt(t.replace("frc", ""), 10)
      );

      // Build team ranks map from TBA data
      const teamRanks: Record<number, number> = {};
      for (const team of tbaTeams) {
        if (team.rank > 0) {
          teamRanks[team.team] = team.rank;
        }
      }

      // Extract display label from match key (e.g., "2025cada_qm24" -> "QM24")
      const matchLabel =
        lastMatchKey.split("_")[1]?.toUpperCase() || lastMatchKey;

      // Get scores from TBA match data
      const redScore = matchData.redScore;
      const blueScore = matchData.blueScore;

      // Format time as relative for past matches
      const matchTime = matchData.est_time
        ? formatTimeAgo(matchData.est_time * 1000)
        : "";

      setNextMatch({
        matchLabel,
        matchTime,
        redTeams: redTeamNums,
        blueTeams: blueTeamNums,
        ourAlliance: isOnRed ? "red" : "blue",
        winProbability: null,
        isPastMatch: true,
        redScore,
        blueScore,
        predictedRedScore: null,
        predictedBlueScore: null,
        teamRanks,
      });
    };

    fetchMatchData()
      .catch(console.error)
      .finally(() => {
        setMatchLoading(false);
        setInitialMatchLoading(false);
      });
  }, [currentEvent, nexusMatches, tbaTeams, tbaSchedule, matchPreds]);

  // Fetch next shift for current user
  useEffect(() => {
    if (!currentEvent || !userData.name) {
      setShiftLoading(false);
      setInitialShiftLoading(false);
      return;
    }

    // Only show loading on initial load, not on background refreshes
    const isInitialLoad = initialShiftLoading;
    if (isInitialLoad) {
      setShiftLoading(true);
    }

    const fetchShiftData = async () => {
      try {
        const now = Date.now();

        // Count ACTUAL completed match scouting submissions FIRST (doesn't depend on assignments)
        const { getSession } = await import("@lib/supabase/auth");
        const { getEventMatchData } = await import("@lib/db");
        const session = await getSession();
        const currentUid = session?.user?.id;

        let shiftsActuallyDone = 0;
        try {
          const allMatchData = await getEventMatchData(currentEvent);
          console.log("[DashboardPage] Counting shifts done:", {
            totalMatches: allMatchData.length,
            currentUid,
            event: currentEvent,
          });

          // Count matches user actually scouted (not deleted, belongs to user)
          // Same logic as "Edit Past Matches" but without time filtering
          const scoutedMatches = allMatchData.filter((m) => {
            // Must have actual scouting data and not be deleted
            if (!m.name || m.deleted_at) return false;
            // Must be scouted by current user
            return m.uid === currentUid;
          });

          shiftsActuallyDone = scoutedMatches.length;
          console.log("[DashboardPage] Shifts actually done:", shiftsActuallyDone, scoutedMatches);
        } catch (error) {
          console.error("Failed to count completed shifts:", error);
        }

        // Now fetch scheduled assignments (prefer uid - name can change)
        const assignments = currentUid
          ? await getUserEventScheduleAssignments(currentEvent, currentUid, true)
          : await getUserEventScheduleAssignments(currentEvent, userData.name || "", false);

        if (assignments.length === 0) {
          // User has no scheduled assignments, but may have completed shifts
          setNextShift(null);
          setShiftStats({ done: shiftsActuallyDone, left: 0, untilBreak: 0 });
          return;
        }

        // Map assignments to include match times
        const shiftsWithTimes = assignments.map((assignment) => {
          const matchData = tbaSchedule[assignment.match];
          const matchTime = matchData?.est_time
            ? matchData.est_time * 1000
            : null;

          return {
            assignment,
            matchTime,
          };
        });

        const futureShiftsCount = shiftsWithTimes.filter(
          (s) => s.matchTime && s.matchTime > now
        ).length;

        const getQualNumber = (matchKey: string): number | null => {
          const parts = matchKey.split("_");
          if (parts.length < 2) return null;
          const matchPart = parts[1];
          const qmMatch = matchPart.match(/^qm(\d+)$/i);
          return qmMatch ? Number(qmMatch[1]) : null;
        };

        const upcomingQualMatches = Object.entries(tbaSchedule)
          .map(([matchKey, matchData]) => {
            const qualNum = getQualNumber(matchKey);
            const matchTime = matchData?.est_time
              ? matchData.est_time * 1000
              : null;
            return { matchKey, qualNum, matchTime };
          })
          .filter(
            (m) =>
              m.qualNum !== null &&
              m.matchTime !== null &&
              (m.matchTime as number) >= now
          )
          .sort((a, b) => (a.matchTime || 0) - (b.matchTime || 0));

        const assignedMatches = new Set(assignments.map((a) => a.match));
        let untilBreak = 0;
        for (const match of upcomingQualMatches) {
          if (assignedMatches.has(match.matchKey)) {
            untilBreak += 1;
          } else {
            break;
          }
        }

        setShiftStats({
          done: shiftsActuallyDone,
          left: futureShiftsCount,
          untilBreak,
        });

        // Find next upcoming shift
        const upcomingShifts = shiftsWithTimes
          .filter((s) => s.matchTime && s.matchTime > now)
          .sort((a, b) => (a.matchTime || 0) - (b.matchTime || 0));

        let shiftToDisplay;
        let isPast = false;

        if (upcomingShifts.length > 0) {
          // Use next upcoming shift
          shiftToDisplay = upcomingShifts[0];
        } else {
          // Use most recent past shift
          const pastShifts = shiftsWithTimes
            .filter((s) => s.matchTime && s.matchTime <= now)
            .sort((a, b) => (b.matchTime || 0) - (a.matchTime || 0));

          if (pastShifts.length > 0) {
            shiftToDisplay = pastShifts[0];
            isPast = true;
          } else {
            // Fallback to first shift if no time data
            shiftToDisplay = shiftsWithTimes[0];
          }
        }

        if (shiftToDisplay) {
          const { assignment, matchTime } = shiftToDisplay;

          // Helper to format relative time
          const formatRelativeTime = (timestamp: number | null): string => {
            if (!timestamp) return ""; // Return empty string instead of "Unknown"
            const diff = timestamp - now;
            const absDiff = Math.abs(diff);
            const minutes = Math.floor(absDiff / (1000 * 60));
            const hours = Math.floor(absDiff / (1000 * 60 * 60));

            if (diff > 0) {
              // Future
              if (minutes < 60) return `in ${minutes}m`;
              const remainingMins = minutes % 60;
              return remainingMins > 0
                ? `in ${hours}h ${remainingMins}m`
                : `in ${hours}h`;
            } else {
              // Past
              if (minutes < 60) return `${minutes}m ago`;
              return `${hours}h ago`;
            }
          };

          setNextShift({
            matchLabel: getMatchLabel(assignment.match),
            matchKey: assignment.match,
            teamNumber: assignment.team.replace("frc", ""),
            teamKey: assignment.team,
            alliance: assignment.alliance,
            timeLabel: formatRelativeTime(matchTime),
            isPastShift: isPast,
          });
        }
      } catch (error) {
        console.error("Failed to load shift data:", error);
        setNextShift(null);
        setShiftStats({ done: 0, left: 0, untilBreak: 0 });
      }
    };

    fetchShiftData().finally(() => {
      setShiftLoading(false);
      setInitialShiftLoading(false);
    });
  }, [currentEvent, userData.name, tbaSchedule]);

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden">
      {/* Top: stat squares + right filler card */}
      <div className="flex gap-4 min-h-0">
        <div className="flex w-28 shrink-0 flex-col gap-4">
          <div className="aspect-square w-full rounded-2xl bg-muted px-4 py-6">
            <p className="text-4xl leading-none">{shiftStats.done}</p>
            <p className="mt-3 text-sm text-primary">shifts done</p>
          </div>
          <div className="aspect-square w-full rounded-2xl bg-muted px-4 py-6">
            <p className="text-4xl leading-none">{shiftStats.left}</p>
            <p className="mt-3 text-sm text-primary">shifts left</p>
          </div>
          <div className="aspect-square w-full rounded-2xl bg-muted px-4 py-6">
            <p className="text-4xl leading-none">{shiftStats.untilBreak}</p>
            <p className="mt-3 text-sm text-primary">till break</p>
          </div>
        </div>

        <div className="flex min-h-[18rem] max-h-[60vh] flex-1 items-center justify-center rounded-2xl bg-muted p-6 overflow-hidden">
          {initialShiftLoading || (nextShift && !nextShift.timeLabel) ? (
            <p className="text-sm text-border">Loading shift...</p>
          ) : !nextShift ? (
            <p className="text-sm text-border">No shifts assigned...</p>
          ) : (
            <div className="flex h-full w-full flex-col justify-center gap-6">
              {(() => {
                const displayLabel = nextShift.isPastShift
                  ? "since last shift"
                  : "until next shift";
                let displayTime = nextShift.timeLabel;
                if (displayTime.startsWith("in ")) {
                  displayTime = displayTime.slice(3);
                }
                if (displayTime.endsWith(" ago")) {
                  displayTime = displayTime.slice(0, -4);
                }
                const matchLabel = (() => {
                  const qmMatch = nextShift.matchLabel.match(/^QM\s*(\d+)$/i);
                  if (qmMatch) return `Qualification ${qmMatch[1]}`;
                  return nextShift.matchLabel;
                })();
                const teamInfo = teams.find(
                  (team: any) => team.key === nextShift.teamKey
                );
                const teamName =
                  teamInfo?.name ?? `Team ${nextShift.teamNumber}`;
                const teamRank =
                  teamInfo?.rank && teamInfo.rank > 0
                    ? `Rank # ${teamInfo.rank}`
                    : "Rank —";

                return (
                  <>
                    <div className="flex w-full flex-col items-start min-w-0 overflow-hidden">
                      <p className="text-[clamp(2rem,8vw,3.25rem)] leading-none font-semibold text-foreground truncate max-w-full">
                        {displayTime}
                      </p>
                      <p className="text-md text-primary truncate max-w-full">
                        {displayLabel}
                      </p>
                    </div>

                    <button
                      type="button"
                      className={`flex w-full items-center justify-between rounded-2xl bg-background/40 px-4 py-3 text-left border-2 ${
                        nextShift.alliance === "red"
                          ? "border-chart-5/50"
                          : "border-chart-1/50"
                      }`}
                      onClick={() => {
                        navigate({
                          to: "/match_start",
                          search: {
                            teamNum: nextShift.teamKey,
                            matchNum: nextShift.matchKey,
                            alliance: nextShift.alliance,
                            practice: false,
                          },
                        });
                      }}
                    >
                      <div className="flex min-w-0 flex-col gap-1">
                        <p className="text-base text-primary truncate">
                          {matchLabel}
                        </p>
                        <p className="text-base text-foreground truncate">
                          Team {nextShift.teamNumber}
                        </p>
                      </div>
                      <Button className="h-8 w-8 bg-muted p-0">
                        <svg
                          viewBox="0 0 30 30"
                          style={{ width: 30, height: 30 }}
                          fill="none"
                          className="h-7 w-7"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <g clipPath="url(#clip0_418_367)">
                            <path
                              d="M15 0.46875C23.0273 0.46875 29.5312 6.97266 29.5312 15C29.5312 23.0273 23.0273 29.5312 15 29.5312C6.97266 29.5312 0.46875 23.0273 0.46875 15C0.46875 6.97266 6.97266 0.46875 15 0.46875ZM13.3066 8.88281L17.7305 13.125H7.03125C6.25195 13.125 5.625 13.752 5.625 14.5312V15.4688C5.625 16.248 6.25195 16.875 7.03125 16.875H17.7305L13.3066 21.1172C12.7383 21.6621 12.7266 22.5703 13.2832 23.127L13.9277 23.7656C14.4785 24.3164 15.3691 24.3164 15.9141 23.7656L23.6895 15.9961C24.2402 15.4453 24.2402 14.5547 23.6895 14.0098L15.9141 6.22852C15.3633 5.67773 14.4727 5.67773 13.9277 6.22852L13.2832 6.86719C12.7266 7.42969 12.7383 8.33789 13.3066 8.88281Z"
                              fill="currentColor"
                              className="text-primary"
                            />
                          </g>
                          <defs>
                            <clipPath id="clip0_418_367">
                              <rect width="30" height="30" fill="white" />
                            </clipPath>
                          </defs>
                        </svg>
                      </Button>
                    </button>

                    <button
                      type="button"
                      className="border-2 border-primary/50 flex w-full items-center justify-between rounded-2xl bg-background/40 px-4 py-3 text-left"
                      onClick={() =>
                        navigate({
                          to: "/team-info",
                          search: { teamKey: nextShift.teamKey },
                        })
                      }
                    >
                      <div className="flex min-w-0 flex-col gap-2">
                        <p className="text-base text-primary truncate">
                          {teamName}
                        </p>
                        <div className="flex items-center gap-3 text-sm text-foreground/80">
                          <span className="truncate">
                            Rank{" "}
                            <span className="text-primary">
                              {teamRank.replace("Rank ", "")}
                            </span>
                          </span>
                        </div>
                      </div>
                      <Button className="h-8 w-8 bg-muted p-0">
                        <svg
                          viewBox="0 0 30 30"
                          style={{ width: 30, height: 30 }}
                          fill="none"
                          className="h-7 w-7"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <g clipPath="url(#clip0_418_367)">
                            <path
                              d="M15 0.46875C23.0273 0.46875 29.5312 6.97266 29.5312 15C29.5312 23.0273 23.0273 29.5312 15 29.5312C6.97266 29.5312 0.46875 23.0273 0.46875 15C0.46875 6.97266 6.97266 0.46875 15 0.46875ZM13.3066 8.88281L17.7305 13.125H7.03125C6.25195 13.125 5.625 13.752 5.625 14.5312V15.4688C5.625 16.248 6.25195 16.875 7.03125 16.875H17.7305L13.3066 21.1172C12.7383 21.6621 12.7266 22.5703 13.2832 23.127L13.9277 23.7656C14.4785 24.3164 15.3691 24.3164 15.9141 23.7656L23.6895 15.9961C24.2402 15.4453 24.2402 14.5547 23.6895 14.0098L15.9141 6.22852C15.3633 5.67773 14.4727 5.67773 13.9277 6.22852L13.2832 6.86719C12.7266 7.42969 12.7383 8.33789 13.3066 8.88281Z"
                              fill="currentColor"
                              className="text-primary"
                            />
                          </g>
                          <defs>
                            <clipPath id="clip0_418_367">
                              <rect width="30" height="30" fill="white" />
                            </clipPath>
                          </defs>
                        </svg>
                      </Button>
                    </button>
                  </>
                );
              })()}
            </div>
          )}
        </div>
      </div>

      {/* Next Match Card */}
      <div className="rounded-2xl bg-muted px-6 py-4">
        {initialMatchLoading || (nextMatch && !nextMatch.matchTime) ? (
          <div className="flex min-h-[10rem] items-center justify-center">
            <p className="text-sm text-border">Loading match details...</p>
          </div>
        ) : !nextMatch ? (
          <div className="flex min-h-[10rem] items-center justify-center">
            <p className="text-sm text-border">
              No matches found for {OUR_TEAM}
            </p>
          </div>
        ) : (
          <div className="flex flex-col ">
            {/* Centered heading */}
            <div className="flex justify-center items-center gap-2">
              <p className="text-center text-muted-foreground text-sm">
                {nextMatch.isPastMatch ? "Last Match:" : "Next Match:"}
              </p>
              <p className="text-sm font-bold text-primary">
                {nextMatch.matchLabel}
              </p>
            </div>
            <div className="items-center justify-center mt-1">
              <p className="text-xs text-border text-center">
                {nextMatch.matchTime}
              </p>
            </div>

            {/* Alliances - colored boxes */}
            <div className="flex items-stretch gap-2 mt-4">
              {/* Red Alliance Box */}
              <div
                className={`flex-1 min-w-0 rounded-xl border-2 p-4 ${
                  nextMatch.ourAlliance === "red"
                    ? "border-chart-5 bg-chart-5/10"
                    : "border-chart-5/50 bg-chart-5/5"
                }`}
              >
                <div className="flex flex-col gap-1">
                  {nextMatch.redTeams
                    .sort((a, b) => {
                      // Sort by rank (lower rank number = better = first)
                      const rankA = nextMatch.teamRanks[a] ?? 999;
                      const rankB = nextMatch.teamRanks[b] ?? 999;
                      return rankA - rankB;
                    })
                    .map((teamNum) => (
                      <div
                        key={teamNum}
                        className="flex justify-between items-center gap-2"
                      >
                        <p
                          className={`text-xs truncate ${
                            teamNum === OUR_TEAM
                              ? "font-bold text-primary"
                              : "text-foreground"
                          }`}
                        >
                          {teamNum}
                        </p>
                        {nextMatch.teamRanks[teamNum] !== undefined && (
                          <span className="text-[10px] text-muted-foreground/60 bg-background/50 rounded-full px-1.5 py-0.5 shrink-0">
                            #{nextMatch.teamRanks[teamNum]}
                          </span>
                        )}
                      </div>
                    ))}
                </div>
              </div>

              {/* VS */}
              <div className="flex flex-col items-center justify-center shrink-0">
                <p className="text-sm font-bold text-muted-foreground">VS</p>
              </div>

              {/* Blue Alliance Box */}
              <div
                className={`flex-1 min-w-0 rounded-xl border-2 p-3 ${
                  nextMatch.ourAlliance === "blue"
                    ? "border-chart-1 bg-chart-1/10"
                    : "border-chart-1/50 bg-chart-1/5"
                }`}
              >
                <div className="flex flex-col gap-1">
                  {nextMatch.blueTeams
                    .sort((a, b) => {
                      // Sort by rank (lower rank number = better = first)
                      const rankA = nextMatch.teamRanks[a] ?? 999;
                      const rankB = nextMatch.teamRanks[b] ?? 999;
                      return rankA - rankB;
                    })
                    .map((teamNum) => (
                      <div
                        key={teamNum}
                        className="flex justify-between items-center gap-2"
                      >
                        {nextMatch.teamRanks[teamNum] !== undefined && (
                          <span className="text-[10px] text-muted-foreground/60 bg-background/50 rounded-full px-1.5 py-0.5 shrink-0">
                            #{nextMatch.teamRanks[teamNum]}
                          </span>
                        )}
                        <p
                          className={`text-xs text-right truncate ${
                            teamNum === OUR_TEAM
                              ? "font-bold text-primary"
                              : "text-foreground"
                          }`}
                        >
                          {teamNum}
                        </p>
                      </div>
                    ))}
                </div>
              </div>
            </div>

            {/* Scores/Results section */}
            {nextMatch.isPastMatch
              ? // Past match: show actual scores and result
                nextMatch.redScore !== null &&
                nextMatch.blueScore !== null && (
                  <div className="mt-4">
                    <div className="flex items-center justify-center">
                      {/* Red side - fixed width */}
                      <div className="flex items-center justify-end gap-2 w-16">
                        <p className="text-lg font-bold text-chart-5">
                          {nextMatch.redScore}
                        </p>
                        <div className="w-4 h-0.5 bg-chart-5/50 rounded-full" />
                      </div>
                      {/* Center result */}
                      <p
                        className={`text-lg font-bold px-3 py-1 rounded-lg mx-1 ${
                          (nextMatch.ourAlliance === "red" &&
                            nextMatch.redScore > nextMatch.blueScore) ||
                          (nextMatch.ourAlliance === "blue" &&
                            nextMatch.blueScore > nextMatch.redScore)
                            ? "bg-chart-2/20 text-chart-2"
                            : nextMatch.redScore === nextMatch.blueScore
                              ? "bg-muted-foreground/20 text-muted-foreground"
                              : "bg-chart-5/20 text-chart-5"
                        }`}
                      >
                        {(nextMatch.ourAlliance === "red" &&
                          nextMatch.redScore > nextMatch.blueScore) ||
                        (nextMatch.ourAlliance === "blue" &&
                          nextMatch.blueScore > nextMatch.redScore)
                          ? "WIN"
                          : nextMatch.redScore === nextMatch.blueScore
                            ? "TIE"
                            : "LOSS"}
                      </p>
                      {/* Blue side - fixed width */}
                      <div className="flex items-center justify-start gap-2 w-16">
                        <div className="w-4 h-0.5 bg-chart-1/50 rounded-full" />
                        <p className="text-lg font-bold text-chart-1">
                          {nextMatch.blueScore}
                        </p>
                      </div>
                    </div>
                    <p className="text-xs text-border text-center mt-2">
                      Results
                    </p>
                  </div>
                )
              : // Future match: show predicted scores and win probability
                (nextMatch.predictedRedScore !== null ||
                  nextMatch.winProbability !== null) && (
                  <div className="mt-4">
                    <div className="flex items-center justify-center">
                      {/* Red side - fixed width for symmetry */}
                      <div className="flex items-center justify-end gap-1 w-20">
                        <p className="text-lg font-bold text-chart-5">
                          {nextMatch.predictedRedScore}
                        </p>
                        <div className="w-4 h-0.5 bg-chart-5/50 rounded-full" />
                        {(nextMatch.predictedRedScore ?? 0) >
                          (nextMatch.predictedBlueScore ?? 0) && (
                          <svg
                            className="w-3 h-3 text-chart-5 -ml-1"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                          >
                            <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
                          </svg>
                        )}
                      </div>

                      {/* Center percentage */}
                      {nextMatch.winProbability !== null && (
                        <p
                          className={`text-lg font-bold px-3 py-1 rounded-lg mx-1 ${
                            nextMatch.winProbability >= 0.5
                              ? "bg-chart-2/20 text-chart-2"
                              : "bg-chart-5/20 text-chart-5"
                          }`}
                        >
                          {Math.round(nextMatch.winProbability * 100)}%
                        </p>
                      )}
                      {/* Blue side - fixed width for symmetry */}
                      <div className="flex items-center justify-start gap-1 w-20">
                        {(nextMatch.predictedBlueScore ?? 0) >
                          (nextMatch.predictedRedScore ?? 0) && (
                          <svg
                            className="w-3 h-3 text-chart-1 -mr-1 rotate-180"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                          >
                            <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
                          </svg>
                        )}
                        <div className="w-4 h-0.5 bg-chart-1/50 rounded-full" />
                        <p className="text-lg font-bold text-chart-1">
                          {nextMatch.predictedBlueScore}
                        </p>
                      </div>
                    </div>
                    <p className="text-xs text-border text-center mt-2">
                      Predictions
                    </p>
                  </div>
                )}
          </div>
        )}
      </div>

      {/* Scouting section (SQUARE cards, same layout/count/icons) */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <p className="text-base text-primary">Scouting</p>
          <Button className="h-8 w-8 bg-transparent p-0" variant="ghost">
            <svg
              style={{ width: 20, height: 20 }}
              className="text-muted-foreground"
              viewBox="0 0 20 20"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M17.5 2.5V6.66667L8.33333 14.1667L5 17.5L2.5 15L5.83333 11.6667L13.3333 2.5H17.5Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M4.16663 10.8333L9.16663 15.8333"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M11.9333 14.4333L15 17.5L17.5 15L14.6959 12.1958"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M8.33333 4.58333L6.66667 2.5H2.5V6.66667L5 8.75"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Button>
        </div>

        <div className="flex gap-4">
          <div
            className="flex-1 aspect-square rounded-2xl bg-muted p-6"
            onClick={() => navigate({ to: "/match" })}
          >
            <div className="flex h-full flex-col justify-between">
              <p className="text-primary text-base">Match Scouting</p>

              <div className="mt-6 flex items-end justify-between">
                <p className="text-[15px]">Start</p>
                <Button className="h-6 w-6 bg-muted p-0">
                  <svg
                    viewBox="0 0 30 30"
                    style={{ width: 30, height: 30 }}
                    fill="none"
                    className="h-7 w-7"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <g clipPath="url(#clip0_418_367)">
                      <path
                        d="M15 0.46875C23.0273 0.46875 29.5312 6.97266 29.5312 15C29.5312 23.0273 23.0273 29.5312 15 29.5312C6.97266 29.5312 0.46875 23.0273 0.46875 15C0.46875 6.97266 6.97266 0.46875 15 0.46875ZM13.3066 8.88281L17.7305 13.125H7.03125C6.25195 13.125 5.625 13.752 5.625 14.5312V15.4688C5.625 16.248 6.25195 16.875 7.03125 16.875H17.7305L13.3066 21.1172C12.7383 21.6621 12.7266 22.5703 13.2832 23.127L13.9277 23.7656C14.4785 24.3164 15.3691 24.3164 15.9141 23.7656L23.6895 15.9961C24.2402 15.4453 24.2402 14.5547 23.6895 14.0098L15.9141 6.22852C15.3633 5.67773 14.4727 5.67773 13.9277 6.22852L13.2832 6.86719C12.7266 7.42969 12.7383 8.33789 13.3066 8.88281Z"
                        fill="currentColor"
                        className="text-primary"
                      />
                    </g>
                    <defs>
                      <clipPath id="clip0_418_367">
                        <rect width="30" height="30" fill="white" />
                      </clipPath>
                    </defs>
                  </svg>
                </Button>
              </div>
            </div>
          </div>

          <div
            className="flex-1 rounded-2xl bg-muted p-6"
            onClick={() => navigate({ to: "/pit" })}
          >
            <div className="flex h-full flex-col justify-between">
              <p className="text-primary text-base">Pit Scouting</p>

              <div className="mt-6 flex items-end justify-between">
                <p className="text-[15px]">Start</p>
                <Button className="h-6 w-6 bg-muted p-0">
                  <svg
                    viewBox="0 0 30 30"
                    style={{ width: 30, height: 30 }}
                    fill="none"
                    className="h-7 w-7"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <g clipPath="url(#clip0_418_367)">
                      <path
                        d="M15 0.46875C23.0273 0.46875 29.5312 6.97266 29.5312 15C29.5312 23.0273 23.0273 29.5312 15 29.5312C6.97266 29.5312 0.46875 23.0273 0.46875 15C0.46875 6.97266 6.97266 0.46875 15 0.46875ZM13.3066 8.88281L17.7305 13.125H7.03125C6.25195 13.125 5.625 13.752 5.625 14.5312V15.4688C5.625 16.248 6.25195 16.875 7.03125 16.875H17.7305L13.3066 21.1172C12.7383 21.6621 12.7266 22.5703 13.2832 23.127L13.9277 23.7656C14.4785 24.3164 15.3691 24.3164 15.9141 23.7656L23.6895 15.9961C24.2402 15.4453 24.2402 14.5547 23.6895 14.0098L15.9141 6.22852C15.3633 5.67773 14.4727 5.67773 13.9277 6.22852L13.2832 6.86719C12.7266 7.42969 12.7383 8.33789 13.3066 8.88281Z"
                        fill="currentColor"
                        className="text-primary"
                      />
                    </g>
                    <defs>
                      <clipPath id="clip0_418_367">
                        <rect width="30" height="30" fill="white" />
                      </clipPath>
                    </defs>
                  </svg>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Picklist section (SQUARE cards, same layout/count/icons) */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between ">
          <p className="text-base text-primary">Other</p>
          <Button className="h-8 w-8 bg-transparent p-0" variant="ghost">
            <svg
              className="text-muted-foreground"
              style={{ width: 19, height: 19 }}
              viewBox="0 0 20 15"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M19 1H1M8 7H1M8 13H1M19.0001 14.0001L17.1001 12.1001M18 10C18 11.6569 16.6569 13 15 13C13.3431 13 12 11.6569 12 10C12 8.34315 13.3431 7 15 7C16.6569 7 18 8.34315 18 10Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Button>
        </div>

        <div className="flex gap-4">
          <div
            className="flex-1 rounded-2xl bg-muted p-6 aspect-square cursor-pointer"
            onClick={() => setPicklistSelectorOpen(true)}
          >
            <div className="flex h-full flex-col justify-between">
              <p className="text-primary text-base">Open Picklist</p>

              <div className="mt-6 flex items-end justify-between">
                <p className="text-[15px]">Start</p>
                <Button className="h-6 w-6 bg-muted p-0">
                  <svg
                    viewBox="0 0 30 30"
                    style={{ width: 30, height: 30 }}
                    fill="none"
                    className="h-7 w-7"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <g clipPath="url(#clip0_418_367)">
                      <path
                        d="M15 0.46875C23.0273 0.46875 29.5312 6.97266 29.5312 15C29.5312 23.0273 23.0273 29.5312 15 29.5312C6.97266 29.5312 0.46875 23.0273 0.46875 15C0.46875 6.97266 6.97266 0.46875 15 0.46875ZM13.3066 8.88281L17.7305 13.125H7.03125C6.25195 13.125 5.625 13.752 5.625 14.5312V15.4688C5.625 16.248 6.25195 16.875 7.03125 16.875H17.7305L13.3066 21.1172C12.7383 21.6621 12.7266 22.5703 13.2832 23.127L13.9277 23.7656C14.4785 24.3164 15.3691 24.3164 15.9141 23.7656L23.6895 15.9961C24.2402 15.4453 24.2402 14.5547 23.6895 14.0098L15.9141 6.22852C15.3633 5.67773 14.4727 5.67773 13.9277 6.22852L13.2832 6.86719C12.7266 7.42969 12.7383 8.33789 13.3066 8.88281Z"
                        fill="currentColor"
                        className="text-primary"
                      />
                    </g>
                    <defs>
                      <clipPath id="clip0_418_367">
                        <rect width="30" height="30" fill="white" />
                      </clipPath>
                    </defs>
                  </svg>
                </Button>
              </div>
            </div>
          </div>

          <div
            className={`flex-1 rounded-2xl bg-muted p-6 ${canCreatePicklist(userData.role || "user") ? "cursor-pointer" : "opacity-50 cursor-not-allowed"}`}
            onClick={() => {
              if (canCreatePicklist(userData.role || "user")) {
                navigate({ to: "/picklist-creator" });
              }
            }}
          >
            <div className="flex h-full flex-col justify-between">
              <p className="text-primary text-base">New Picklist</p>

              <div className="mt-6 flex items-end justify-between">
                <p className="text-[15px]">Start</p>
                <Button className="h-6 w-6 bg-muted p-0">
                  <svg
                    viewBox="0 0 30 30"
                    style={{ width: 30, height: 30 }}
                    fill="none"
                    className="h-7 w-7"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <g clipPath="url(#clip0_418_367)">
                      <path
                        d="M15 0.46875C23.0273 0.46875 29.5312 6.97266 29.5312 15C29.5312 23.0273 23.0273 29.5312 15 29.5312C6.97266 29.5312 0.46875 23.0273 0.46875 15C0.46875 6.97266 6.97266 0.46875 15 0.46875ZM13.3066 8.88281L17.7305 13.125H7.03125C6.25195 13.125 5.625 13.752 5.625 14.5312V15.4688C5.625 16.248 6.25195 16.875 7.03125 16.875H17.7305L13.3066 21.1172C12.7383 21.6621 12.7266 22.5703 13.2832 23.127L13.9277 23.7656C14.4785 24.3164 15.3691 24.3164 15.9141 23.7656L23.6895 15.9961C24.2402 15.4453 24.2402 14.5547 23.6895 14.0098L15.9141 6.22852C15.3633 5.67773 14.4727 5.67773 13.9277 6.22852L13.2832 6.86719C12.7266 7.42969 12.7383 8.33789 13.3066 8.88281Z"
                        fill="currentColor"
                        className="text-primary"
                      />
                    </g>
                    <defs>
                      <clipPath id="clip0_418_367">
                        <rect width="30" height="30" fill="white" />
                      </clipPath>
                    </defs>
                  </svg>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Team Section */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <p className="text-base text-primary">Teams</p>
          <Button className="h-8 w-8 bg-transparent p-0" variant="ghost">
            <svg
              className="text-muted-foreground"
              viewBox="0 0 24 24"
              style={{ width: 20, height: 20 }}
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M3 6H21M3 12H21M3 18H21"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </Button>
        </div>

        <Command className="w-full bg-background [&_[data-slot=command-input-wrapper]]:border-0 [&_[data-slot=command-input-wrapper]]:h-14 [&_[data-slot=command-input-wrapper]]:rounded-2xl [&_[data-slot=command-input-wrapper]]:bg-muted [&_[data-slot=command-input-wrapper]]:px-1">
          <CommandInput
            className="text-foreground text-md placeholder-border"
            placeholder="Search teams..."
          />
          <CommandList className="mt-5 flex flex-col gap-4 max-h-[400px] overflow-y-auto">
            <CommandEmpty>
              {teamsLoading ? "Loading teams..." : "No teams found."}
            </CommandEmpty>
            {teams
              .sort((a: any, b: any) => {
                // Sort by rank (ascending), then by team number
                if (a.rank === 0 && b.rank === 0) return a.num - b.num;
                if (a.rank === 0) return 1; // unranked teams go last
                if (b.rank === 0) return -1;
                return a.rank - b.rank;
              })
              .map((team: any) => (
                <CommandItem
                  key={team.key}
                  className="rounded-2xl bg-muted px-6 py-6 mb-3 last:mb-0 data-[selected]:bg-muted min-h-[80px] cursor-pointer"
                  onSelect={() =>
                    navigate({
                      to: "/team-info",
                      search: { teamKey: team.key },
                    })
                  }
                >
                  <div className="flex w-full items-center justify-between gap-3">
                    <div className="flex-1">
                      <p className="text-base">
                        <span className="font-bold text-primary">
                          {team.num}
                        </span>
                        <span className="text-foreground bg">
                          {" "}
                          | {team.name}
                        </span>
                      </p>
                      {team.rank > 0 && (
                        <p className="mt-1 text-sm text-border">
                          Rank {team.rank}
                        </p>
                      )}
                    </div>
                    {scoutedTeams.has(team.key) && (
                      <Badge
                        variant="outline"
                        className="ml-2 border-primary text-primary"
                      >
                        Scouted
                      </Badge>
                    )}
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

      {/* Picklist Selector Dialog */}
      <PicklistSelector
        open={picklistSelectorOpen}
        onClose={() => setPicklistSelectorOpen(false)}
        onSelect={(id) => navigate({ to: "/picklist-view", search: { id } })}
      />
    </div>
  );
}
