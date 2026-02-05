import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { Button } from "@shadcn/ui/components/button.js";
import { getTeams, getSchedule } from "@lib/data";
import { useEvent } from "@lib/context/EventContext";
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

// const CURRENT_EVENT = "2025cada";

import { getNexusEventStatus, type NexusMatch } from "@lib/nexus/event";

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

interface Team {
  name: string;
  num: number;
  key: string;
}

interface ScheduleEntry {
  match: string;
  team: string;
  alliance: string;
}

export function Match() {
  const navigate = useNavigate();
  const { currentEvent } = useEvent();
  const [teams, setTeams] = useState<Team[]>([]);
  const [nexusMatches, setNexusMatches] = useState<NexusMatch[]>([]);
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMatch, setSelectedMatch] = useState<string | null>(null);
  const [showMatchDropdown, setShowMatchDropdown] = useState(false);
  const [matchQuery, setMatchQuery] = useState("");
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const matchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!currentEvent) return;

    setLoading(true);

    // Fetch generic data
    Promise.all([getTeams(currentEvent), getSchedule(currentEvent)])
      .then(([teamsData, scheduleData]) => {
        // Transform teams
        const transformedTeams: Team[] = (teamsData ?? []).map((t) => ({
          key: t.team,
          num: parseInt(t.team.replace("frc", ""), 10),
          name: t.team_name ?? `Team ${t.team.replace("frc", "")}`,
        }));
        transformedTeams.sort((a, b) => a.num - b.num);
        setTeams(transformedTeams);

        // Store schedule
        setSchedule(scheduleData ?? []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));

    // Fetch live nexus status for sorting
    getNexusEventStatus(currentEvent)
      .then((nexusData) => {
        if (nexusData && nexusData.matches) {
          setNexusMatches(nexusData.matches);
        }
      })
      .catch(console.error);
  }, [currentEvent]);

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
    }
  );

  // Get teams for selected match
  const teamsInMatch = selectedMatch
    ? schedule.filter((s) => s.match === selectedMatch)
    : [];
  const redTeamsInMatch = teamsInMatch.filter((t) => t.alliance === "red");
  const blueTeamsInMatch = teamsInMatch.filter((t) => t.alliance === "blue");

  const handleBackClick = () => {
    navigate({ to: "/home" });
  };



  return (
    <div className="flex min-h-dvh w-full flex-col bg-background px-6 py-4">
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
              <div className="absolute left-0 right-0 top-full mt-2 z-50 max-h-60 overflow-y-auto rounded-2xl bg-background shadow-lg">
                {uniqueMatches
                  .filter((match) =>
                    formatMatchKey(match)
                      .toLowerCase()
                      .includes(matchQuery.toLowerCase())
                  )
                  .map((match) => (
                    <div
                      key={match}
                      className={`px-3 py-2 pt-4 cursor-pointer ${
                        selectedMatch === match
                          ? "bg-primary/20"
                          : "hover:bg-muted"
                      }`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setSelectedMatch(match);
                        setMatchQuery(formatMatchKey(match));
                        setShowMatchDropdown(false);
                      }}
                    >
                    <div className="flex flex-col rounded-lg bg-muted p-5">
                      <p className="text-base">
                        <span className="font-bold text-primary">
                          {formatMatchKey(match)}
                        </span>
                      </p>
                    </div>
                    </div>
                  ))}
                {uniqueMatches.filter((match) =>
                  formatMatchKey(match)
                    .toLowerCase()
                    .includes(matchQuery.toLowerCase())
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
                onValueChange={(value) => {
                  setSelectedTeam(value || null);
                }}
                disabled={!selectedMatch}
              >
                <SelectTrigger className="w-full h-14 hover:text-primary justify-between px-3 font-normal text-base bg-background border border-input">
                  {selectedTeam
                    ? (() => {
                        const entry = teamsInMatch.find(
                          (e) => e.team === selectedTeam
                        );
                        const team = teams.find((t) => t.key === selectedTeam);
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
                        <SelectLabel className="px-2 py-2 text-red-500/75 text-md">
                          Red Alliance
                        </SelectLabel>
                        {redTeamsInMatch.map((entry) => {
                          const team = teams.find((t) => t.key === entry.team);
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
                              </div>
                            </SelectItem>
                          );
                        })}
                      </SelectGroup>

                      <SelectGroup>
                        <SelectLabel className="px-2 py-2 text-blue-500/75 text-md">
                          Blue Alliance
                        </SelectLabel>
                        {blueTeamsInMatch.map((entry) => {
                          const team = teams.find((t) => t.key === entry.team);
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
              onClick = {() => {
                navigate({ 
                  to: "/match_start",
                  search: { teamNum: selectedTeam, matchNum: selectedMatch },
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

        {/* Recommended Matches - show first 3 matches with one team each */}
        <p className="text-base text-primary mt-2">Recommended Matches</p>

        {loading ? (
          <p className="text-muted-foreground">Loading matches...</p>
        ) : nexusMatches.length === 0 ? (
          <p className="text-muted-foreground">No upcoming matches available</p>
        ) : (
          <div className="flex flex-col">
            {nexusMatches.slice(0, 3).map((nexusMatch) => {
              // Find the corresponding match in schedule
              const matchKey = uniqueMatches.find((m) =>
                formatMatchKey(m) === nexusMatch.label
              );
              const matchTeams = matchKey
                ? schedule.filter((s) => s.match === matchKey)
                : [];
              // Pick the first team from the match
              const firstTeamEntry = matchTeams[0];
              const firstTeam = teams.find(
                (t) => t.key === firstTeamEntry?.team
              );

              return (
                <div
                  key={nexusMatch.label}
                  className="rounded-2xl bg-muted px-5 py-5 mb-3 last:mb-0 cursor-pointer"
                  onClick={() => {
                    if (matchKey) {
                      setSelectedMatch(matchKey);
                      if (firstTeamEntry) setSelectedTeam(firstTeamEntry.team);
                    }
                  }}
                >
                  <div className="flex w-full items-center justify-between">
                    <div>
                      <p className="text-base">
                        <span className="font-bold text-primary">
                          {nexusMatch.label}
                        </span>
                        {firstTeam && (
                          <span className="text-foreground">
                            {" "}
                            | Team {firstTeam.num}
                          </span>
                        )}
                      </p>
                      <p className="mt-1 text-sm text-border">
                        {formatMatchTime(nexusMatch.times.estimatedStartTime)}
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
                        stroke="#FBBF24"
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
        )}

        <p className="text-sm text-muted-foreground text-center mt-4">
          The match does NOT start after clicking the arrow button. Please lock
          orientation or turn off auto-rotate before scouting.
        </p>
      </div>
    </div>
  );
}
