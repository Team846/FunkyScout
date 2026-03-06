import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTeamData, type Team } from "@lib/context/TeamDataContext";
import { Button } from "@shadcn/ui/components/button.tsx";
import { useEvent } from "@lib/context/EventContext";
import { getLocalUserData } from "@lib/supabase/user";
import { getUserEventScheduleAssignments, getEventMatchData } from "@lib/db";
import { useCompetition } from "@lib/context/CompetitionDataContext";
import { getMatchLabel } from "@lib/utils/match";
import { Command, CommandInput, CommandList, CommandItem, CommandEmpty } from "@shadcn/ui/components/command.js";
import { Badge } from "@shadcn/ui/components/badge.tsx";
export function ScoutingPage() {

  const navigate = useNavigate();
  const { currentEvent } = useEvent();
  const [userData] = useState(getLocalUserData());
  const { teams } = useTeamData();
  const { tbaSchedule } = useCompetition();

  interface NextShiftData {
    matchLabel: string;
    matchKey: string;
    teamNumber: string;
    teamKey: string;
    alliance: "red" | "blue";
    timeLabel: string;
    isPastShift: boolean;
  }
  const [nextShift, setNextShift] = useState<NextShiftData | null>(null);
  const [, setShiftLoading] = useState(false);
  const [initialShiftLoading, setInitialShiftLoading] = useState(true);
  const [shiftStats, setShiftStats] = useState({
    done: 0,
    left: 0,
    untilBreak: 0,
  });

  // Past matches state
  const [pastMatches, setPastMatches] = useState<Array<{
    match: string;
    matchLabel: string;
    team: string;
    teamNumber: string;
    alliance: "red" | "blue" | null;
    scoutedBy: string;
    timestamp: number | string | null;
  }>>([]);
  const [pastMatchesLoading, setPastMatchesLoading] = useState(true);
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

          // Count ACTUAL completed match scouting submissions FIRST (doesn't depend on assignments)
          const currentUid = getLocalUserData().uid;

          let shiftsActuallyDone = 0;
          try {
            const allMatchData = await getEventMatchData(currentEvent);
            console.log("[ScoutingPage] Counting shifts done:", {
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
            console.log("[ScoutingPage] Shifts actually done:", shiftsActuallyDone, scoutedMatches);
          } catch (error) {
            console.error("Failed to count completed shifts:", error);
          }

          // Now fetch scheduled assignments (prefer uid - name can change, entries keep old name)
          const assignments = currentUid
            ? await getUserEventScheduleAssignments(currentEvent, currentUid, true)
            : await getUserEventScheduleAssignments(currentEvent, userData.name || "", false);

          if (assignments.length === 0) {
            // User has no scheduled assignments, but may have completed shifts
            setNextShift(null);
            setShiftStats({ done: shiftsActuallyDone, left: 0, untilBreak: 0 });
            return;
          }
  
          if (assignments.length === 0) {
            setNextShift(null);
            setShiftStats({ done: 0, left: 0, untilBreak: 0 });
            return;
          }
  
          const now = Date.now();
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

  // Fetch past matches that user has actually scouted (or all if admin)
  useEffect(() => {
    if (!currentEvent) {
      setPastMatchesLoading(false);
      return;
    }

    const fetchPastMatches = async () => {
      try {
        const currentUid = getLocalUserData().uid;
        const userRole = userData.role || "user";
        const isAdmin = userRole === "admin";

        // Get all match data (actual scouting submissions)
        const allMatchData = await getEventMatchData(currentEvent);
        const now = Date.now();

        // Filter to past matches that have been scouted
        const pastScoutedMatches = allMatchData.filter((m) => {
          // Must have actual scouting data and not be deleted
          if (!m.name || m.deleted_at) return false;

          // If we have timing data, only show matches that have already happened.
          // If est_time is unavailable (offline, not yet synced), show the match
          // anyway — we can't determine if it's past, so err on the side of showing it.
          const matchData = tbaSchedule[m.match];
          const matchTime = matchData?.est_time ? matchData.est_time * 1000 : null;
          if (matchTime !== null && matchTime > now) return false;

          // Permission check
          if (isAdmin) return true; // Admins see all scouted matches
          return m.uid === currentUid; // Users only see their own scouted matches
        });

        // Map to display format
        const formattedMatches = pastScoutedMatches.map((m) => ({
          match: m.match,
          matchLabel: getMatchLabel(m.match),
          team: m.team,
          teamNumber: m.team.replace("frc", ""),
          alliance: m.alliance || null,
          scoutedBy: m.name || "Unknown",
          timestamp: m.timestamp || null,
        }));

        // Sort by most recent first
        const sortedMatches = formattedMatches.sort((a, b) => {
          const timeA = tbaSchedule[a.match]?.est_time || 0;
          const timeB = tbaSchedule[b.match]?.est_time || 0;
          return timeB - timeA;
        });

        setPastMatches(sortedMatches);
      } catch (error) {
        console.error("Failed to load past matches:", error);
        setPastMatches([]);
      } finally {
        setPastMatchesLoading(false);
      }
    };

    fetchPastMatches();
  }, [currentEvent, tbaSchedule, userData.role]);
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
                  if (qmMatch) return `Qual ${qmMatch[1]}`;
                  return nextShift.matchLabel;
                })();
                const teamInfo = teams.find(
                  (t: Team) => t.key === nextShift.teamKey
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
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-muted" aria-hidden>
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
                      </span>
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
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-muted" aria-hidden>
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
                      </span>
                    </button>
                  </>
                );
                
              })()}
            </div>
          )}
        </div>
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

      {/* Past Matches Section */}
      {pastMatches.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <p className="text-base text-primary">Past Matches</p>
            <p className="text-sm text-primary">
              {userData.role === "admin" ? "All Scouted Matches" : "Your Scouted Matches"}
            </p>
          </div>

          <Command className="flex flex-col w-full bg-background rounded-2xl [&_[data-slot=command-input-wrapper]]:border-0 [&_[data-slot=command-input-wrapper]]:h-14 [&_[data-slot=command-input-wrapper]]:rounded-2xl [&_[data-slot=command-input-wrapper]]:bg-muted [&_[data-slot=command-input-wrapper]]:px-1">
            <CommandInput
              className="text-foreground text-md placeholder-border"
              placeholder="Search past matches..."
            />
            <CommandList className="mt-5 flex flex-col gap-4 max-h-[400px] overflow-y-auto">
              <CommandEmpty>
                {pastMatchesLoading ? "Loading past matches..." : "No past matches found."}
              </CommandEmpty>
              {pastMatches.map((match, idx) => (
                <CommandItem
                  key={`${match.match}-${match.team}-${idx}`}
                  className="rounded-2xl bg-muted px-6 py-6 mb-3 last:mb-0 data-[selected]:bg-muted min-h-[80px] cursor-pointer"
                  onSelect={() =>
                    navigate({
                      to: "/match_edit_stats",
                      search: {
                        teamNum: match.team,
                        matchNum: match.match,
                        alliance: match.alliance,
                        practice: false,
                      },
                    })
                  }
                >
                  <div className="flex w-full items-center justify-between gap-3">
                    <div className="flex-1">
                      <p className="text-base">
                        <span className="font-bold text-primary">
                          {match.matchLabel}
                        </span>
                        <span className="text-foreground"> | Team {match.teamNumber}</span>
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        {match.alliance && (
                          <Badge
                            variant="outline"
                            className={
                              match.alliance === "red"
                                ? "border-chart-5 text-chart-5 bg-chart-5/10"
                                : "border-chart-1 text-chart-1 bg-chart-1/10"
                            }
                          >
                            {match.alliance.toUpperCase()}
                          </Badge>
                        )}
                        <p className="text-sm text-muted-foreground">
                          Scouted by: {match.scoutedBy}
                        </p>
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
      )}
      </div>
  );
}
