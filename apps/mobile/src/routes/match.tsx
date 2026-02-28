import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { Button } from "@shadcn/ui/components/button.js";
import { useTeamData } from "@lib/context/TeamDataContext";
import { useCompetition } from "@lib/context/CompetitionDataContext";
import { getSession } from "@lib/supabase/auth";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from "@shadcn/ui/components/select.tsx";

export const Route = createFileRoute("/match")({
  component: Match,
});

// Helper to format match key (e.g. "2025cada_qm1" -> "QM1")
const formatMatchKey = (key: string) => {
  const parts = key.split("_");
  return (parts.length > 1 ? parts[1] : key).toUpperCase();
};

// Helper to format timestamp to readable time (e.g. "2:30 PM")
const formatMatchTime = (timestamp: number) => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

export function Match() {
  const navigate = useNavigate();
  const { teams, loading: teamsLoading } = useTeamData();
  const { schedule, nexusMatches, loading: scheduleLoading } = useCompetition();

  const loading = teamsLoading || scheduleLoading;
  const [selectedMatch, setSelectedMatch] = useState<string | null>(null);
  const [showMatchDropdown, setShowMatchDropdown] = useState(false);
  const [matchQuery, setMatchQuery] = useState("");
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [currentUserUid, setCurrentUserUid] = useState<string>("");
  const matchInputRef = useRef<HTMLInputElement>(null);

  // Get current user's uid
  useEffect(() => {
    getSession().then((session) => {
      if (session?.user?.id) {
        setCurrentUserUid(session.user.id);
      }
    });
  }, []);

  // Get unique matches from schedule
  const uniqueMatches = [...new Set(schedule.map((s) => s.match))].sort(
    (a, b) => {
      // Check if matches are qualification matches (case-insensitive)
      const aLower = a.toLowerCase();
      const bLower = b.toLowerCase();
      const aIsQual = aLower.includes("qm");
      const bIsQual = bLower.includes("qm");

      // If one is qual and other isn't, quals come first
      if (aIsQual && !bIsQual) return -1;
      if (!aIsQual && bIsQual) return 1;

      // Extract numbers for numerical sorting
      const aNum = parseInt(a.replace(/\D/g, ""), 10) || 0;
      const bNum = parseInt(b.replace(/\D/g, ""), 10) || 0;

      return aNum - bNum;
    },
  );

  // Get teams for selected match
  const teamsInMatch = selectedMatch
    ? schedule.filter((s) => s.match === selectedMatch)
    : [];
  const redTeamsInMatch = teamsInMatch.filter((t) => t.alliance === "red");
  const blueTeamsInMatch = teamsInMatch.filter((t) => t.alliance === "blue");

  // Helper to get assignment badge
  const getAssignmentBadge = (teamKey: string, matchKey: string) => {
    const assignment = schedule.find(
      (s) => s.team === teamKey && s.match === matchKey
    );

    if (!assignment || !assignment.name) return null;

    const isAssignedToUser = assignment.uid === currentUserUid;

    return isAssignedToUser ? "ASSIGNED" : "COVERED";
  };

  const handleBackClick = () => {
    navigate({ to: "/home" });
  };

  return (
    <div className="flex min-h-dvh w-full flex-col bg-background px-6 pb-4 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)]">
      {/* Back Button */}
      <button onClick={handleBackClick} className="text-primary mb-4">
        <svg
          viewBox="0 0 24 24"
          className="size-6"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M15 18L9 12L15 6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {/* Divider */}
      <div className="h-px w-full bg-border mb-6" />

      <div className="flex flex-col gap-4">
        <p className="text-base text-primary">Match Scouting</p>

        {/* Selection Card */}
        <div className="flex flex-col gap-4 rounded-2xl bg-muted px-5 py-3">
          <div className="relative">
            <input
              ref={matchInputRef}
              type="text"
              value={matchQuery}
              placeholder={loading ? "Loading..." : "Search or select a match"}
              onChange={(e) => {
                setMatchQuery(e.target.value);
                setShowMatchDropdown(true);
              }}
              onFocus={() => setShowMatchDropdown(true)}
              onBlur={() => {
                setTimeout(() => setShowMatchDropdown(false), 150);
              }}
              className="h-14 w-full rounded-xl border border-border px-4 text-base text-foreground placeholder:text-muted-foreground outline-none"
            />

            {showMatchDropdown && (
              <div className="absolute left-0 right-0 top-full mt-3 z-50 max-h-60 overflow-y-auto rounded-2xl bg-background  shadow-lg">
                {uniqueMatches
                  .filter((match) =>
                    formatMatchKey(match)
                      .toLowerCase()
                      .includes(matchQuery.toLowerCase()),
                  )
                  .map((match) => {
                    // Try to find nexus match for time data
                    const matchLabel = formatMatchKey(match);
                    const nexusMatch = nexusMatches.find(
                      (nm) => nm.label === matchLabel,
                    );
                    const matchTime = nexusMatch?.times.estimatedStartTime;
                    return (
                      <div
                        key={match}
                        className={`px-2.5 py-1.5 cursor-pointer ${
                          selectedMatch === match
                            ? "bg-primary/20"
                            : "hover:bg-background/50"
                        }`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setSelectedMatch(match);
                          setMatchQuery(matchLabel);
                          setShowMatchDropdown(false);
                        }}
                      >
                        <div className="text-base bg-muted px-3 py-3 rounded-xl">
                          <p className="text-base">
                            <span className="font-bold text-primary">
                              {matchLabel}
                            </span>
                            <span className="text-muted-foreground">
                              {" "}
                              |{" "}
                              {matchTime
                                ? formatMatchTime(matchTime)
                                : "Time not found"}
                            </span>
                          </p>
                        </div>
                      </div>
                    );
                  })}
                {uniqueMatches.filter((match) =>
                  formatMatchKey(match)
                    .toLowerCase()
                    .includes(matchQuery.toLowerCase()),
                ).length === 0 && (
                  <div className="px-6 py-4">
                    <p className="text-muted-foreground">No match found.</p>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1 truncate">
              <Select
                value={selectedTeam ?? ""}
                onValueChange={(value: string) => {
                  setSelectedTeam(value || null);
                }}
                disabled={!selectedMatch}
              >
                <SelectTrigger className="w-full h-14 hover:text-primary justify-between px-3 font-normal text-base bg-background border border-input">
                  {selectedTeam
                    ? (() => {
                        const entry = teamsInMatch.find(
                          (e) => e.team === selectedTeam,
                        );
                        const team = teams.find(
                          (t: { key: string; num?: number; name?: string }) => t.key === selectedTeam,
                        );
                        return entry ? (
                          <span className="flex w-full min-w-0 items-center gap-1">
                            <span className="shrink-0 text-foreground">
                              Team {team?.num ?? entry.team} |
                            </span>
                            <span className="min-w-0 truncate text-muted-foreground">
                              {team?.name ?? ""}
                            </span>
                          </span>
                        ) : (
                          "Select a Team"
                        );
                      })()
                    : "Select a Team"}
                </SelectTrigger>

                <SelectContent
                  className="p-0 bg-background text-foreground shadow-md overflow-hidden"
                  style={{
                    width: "var(--radix-select-trigger-width)",
                    minWidth: "var(--radix-select-trigger-width)",
                  }}
                  align="start"
                >
                  {!selectedMatch ? (
                    <div className="py-6 text-center text-sm text-muted-foreground">
                      Select a match first.
                    </div>
                  ) : (
                    <>
                      <SelectGroup>
                        <SelectLabel className="px-2 py-2 text-chart-5/75 text-md">
                          Red Alliance
                        </SelectLabel>
                        {redTeamsInMatch.map((entry) => {
                          const team = teams.find(
                            (t: { key: string; num?: number; name?: string }) => t.key === entry.team,
                          );
                          const badge = getAssignmentBadge(entry.team, entry.match);
                          return (
                            <SelectItem
                              key={`${entry.match}-${entry.team}`}
                              value={entry.team}
                              className="group px-2 data-[highlighted]:bg-muted data-[highlighted]:text-foreground"
                            >
                              <div className="flex w-full min-w-0 items-center gap-2">
                                <div className="flex w-full min-w-0 items-center gap-1">
                                  <span className="shrink-0 text-foreground p-3 px-1 group-data-[highlighted]:text-primary transition-colors">
                                    Team {team?.num ?? entry.team} |
                                  </span>
                                  <span className="min-w-0 truncate text-muted-foreground">
                                    {team?.name ?? ""}
                                  </span>
                                </div>
                                {badge && (
                                  <span
                                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                      badge === "ASSIGNED"
                                        ? "bg-[#CDA745]/20 text-[#CDA745]"
                                        : "bg-muted-foreground/20 text-muted-foreground"
                                    }`}
                                  >
                                    {badge}
                                  </span>
                                )}
                              </div>
                            </SelectItem>
                          );
                        })}
                      </SelectGroup>

                      <SelectGroup>
                        <SelectLabel className="px-2 py-2 text-chart-1/75 text-md">
                          Blue Alliance
                        </SelectLabel>
                        {blueTeamsInMatch.map((entry) => {
                          const team = teams.find(
                            (t: { key: string; num?: number; name?: string }) => t.key === entry.team,
                          );
                          const badge = getAssignmentBadge(entry.team, entry.match);
                          return (
                            <SelectItem
                              key={`${entry.match}-${entry.team}`}
                              value={entry.team}
                              className="group px-2 data-[highlighted]:bg-muted data-[highlighted]:text-foreground"
                            >
                              <div className="flex w-full min-w-0 items-center gap-2">
                                <div className="flex w-full min-w-0 items-center gap-1">
                                  <span className="shrink-0 text-foreground p-3 px-1 group-data-[highlighted]:text-primary transition-colors">
                                    Team {team?.num ?? entry.team} |
                                  </span>
                                  <span className="min-w-0 truncate text-muted-foreground">
                                    {team?.name ?? ""}
                                  </span>
                                </div>
                                {badge && (
                                  <span
                                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                      badge === "ASSIGNED"
                                        ? "bg-[#CDA745]/20 text-[#CDA745]"
                                        : "bg-muted-foreground/20 text-muted-foreground"
                                    }`}
                                  >
                                    {badge}
                                  </span>
                                )}
                              </div>
                            </SelectItem>
                          );
                        })}
                      </SelectGroup>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>

            <Button
              className="h-8 w-8 shrink-0 rounded-full bg-primary hover:bg-primary/90 p-0"
              variant="default"
              size="icon"
              disabled={!(selectedMatch && selectedTeam)}
              onClick={() => {
                // Find the alliance for the selected team (check both red and blue)
                const teamEntry = teamsInMatch.find((item) => item.team === selectedTeam);
                const selectedAlliance = teamEntry?.alliance || null;

                navigate({
                  to: "/match_start",
                  search: {
                    teamNum: selectedTeam,
                    matchNum: selectedMatch,
                    alliance: selectedAlliance,
                    practice: false,
                  },
                });
              }}
            >
              <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
                <path
                  d="M11.0546 1.74147L12.3428 0.419739C12.8883 -0.139913 13.7703 -0.139913 14.31 0.419739L25.5909 11.9879C26.1364 12.5475 26.1364 13.4525 25.5909 14.0062L14.31 25.5803C13.7645 26.1399 12.8825 26.1399 12.3428 25.5803L11.0546 24.2585C10.5033 23.6929 10.5149 22.7701 11.0778 22.2164L18.0703 15.3815H1.3927C0.620913 15.3815 0 14.7444 0 13.9526V12.0474C0 11.2556 0.620913 10.6185 1.3927 10.6185H18.0703L11.0778 3.7836C10.5091 3.22991 10.4975 2.30708 11.0546 1.74147Z"
                  fill="#0D0D0D"
                />
              </svg>
            </Button>
          </div>
        </div>

        {/* Recommended Matches - next 3 matches assigned to current user */}
        <p className="text-base text-primary mt-2">Recommended Matches</p>

        {loading ? (
          <p className="text-muted-foreground">Loading matches...</p>
        ) : (() => {
          // Deduplicate by match key, keeping only the user's assigned entry per match
          const seen = new Set<string>();
          const assignedShifts = schedule
            .filter((s) => s.uid === currentUserUid)
            .filter((s) => !s.est_time || s.est_time * 1000 >= Date.now() - 30 * 60 * 1000)
            .sort((a, b) => (a.est_time ?? 0) - (b.est_time ?? 0))
            .filter((s) => {
              if (seen.has(s.match)) return false;
              seen.add(s.match);
              return true;
            })
            .slice(0, 3);

          if (assignedShifts.length === 0) {
            return <p className="text-muted-foreground">No assigned upcoming matches</p>;
          }

          return (
            <div className="flex flex-col">
              {assignedShifts.map((shift) => {
                const matchLabel = formatMatchKey(shift.match);
                const nexusMatch = nexusMatches.find((nm) => nm.label === matchLabel);
                const matchTime = nexusMatch?.times.estimatedStartTime
                  ?? (shift.est_time ? shift.est_time * 1000 : null);
                const team = teams.find((t: { key: string; num?: number }) => t.key === shift.team);

                return (
                  <div
                    key={shift.match}
                    className="rounded-2xl bg-muted px-5 py-5 mb-3 last:mb-0 cursor-pointer"
                    onClick={() => {
                      setSelectedMatch(shift.match);
                      setMatchQuery(matchLabel);
                      setSelectedTeam(shift.team);
                    }}
                  >
                    <div className="flex w-full items-center justify-between">
                      <div>
                        <p className="text-base">
                          <span className="font-bold text-primary">{matchLabel}</span>
                          {team && (
                            <span className="text-foreground"> | Team {team.num}</span>
                          )}
                        </p>
                        <p className="mt-1 text-sm text-border">
                          {matchTime ? formatMatchTime(matchTime) : "Time not available"}
                        </p>
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
                  </div>
                );
              })}
            </div>
          );
        })()}

        <p className="text-sm text-muted-foreground text-center mt-4">
          The match does NOT start after clicking the arrow button. Please lock
          orientation or turn off auto-rotate before scouting.
        </p>
      </div>
    </div>
  );
}
