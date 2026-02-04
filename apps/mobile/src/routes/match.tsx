import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from "@shadcn/ui/components/select.tsx";
import { Button } from "@shadcn/ui/components/button.js";
import { getTeams, getSchedule } from "@lib/data";
import { useEvent } from "@lib/context/EventContext";

export const Route = createFileRoute("/match")({
  component: Match,
});

// const CURRENT_EVENT = "2025cada";

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
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMatch, setSelectedMatch] = useState<string | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);

  useEffect(() => {
    if (!currentEvent) return;

    setLoading(true);
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
  }, []);

  // Get unique matches from schedule
  const uniqueMatches = [...new Set(schedule.map((s) => s.match))].sort((a, b) => {
    // Sort by match type then number (qm1, qm2, ... sf1m1, f1m1)
    const aNum = parseInt(a.replace(/\D/g, ""), 10) || 0;
    const bNum = parseInt(b.replace(/\D/g, ""), 10) || 0;
    return aNum - bNum;
  });

  // Get teams for selected match
  const teamsInMatch = selectedMatch
    ? schedule.filter((s) => s.match === selectedMatch)
    : [];

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
          <Select value={selectedMatch ?? undefined} onValueChange={setSelectedMatch}>
            <SelectTrigger className="w-full h-14 hover:text-primary">
              <SelectValue placeholder={loading ? "Loading..." : "Select a Match"} />
            </SelectTrigger>
            <SelectContent className="bg-accent">
              <SelectGroup>
                {uniqueMatches.map((match) => (
                  <SelectItem
                    key={match}
                    value={match}
                    className="focus:text-foreground text-muted-foreground focus:bg-ring"
                  >
                    {match.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>

          <div className="flex items-center gap-3">
            <div className="flex-1">
              <Select value={selectedTeam ?? undefined} onValueChange={setSelectedTeam}>
                <SelectTrigger className="w-full h-14 hover:text-primary">
                  <SelectValue placeholder="Select a Team" />
                </SelectTrigger>
                <SelectContent className="bg-accent">
                  <SelectGroup>
                    {(selectedMatch ? teamsInMatch : []).map((entry) => {
                      const team = teams.find((t) => t.key === entry.team);
                      return (
                        <SelectItem
                          key={`${entry.match}-${entry.team}`}
                          value={entry.team}
                          className="focus:text-foreground text-muted-foreground focus:bg-ring"
                        >
                          {entry.alliance.toUpperCase()} | Team {team?.num ?? entry.team} | {team?.name ?? ""}
                        </SelectItem>
                      );
                    })}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <Button
              className="h-8 w-8 shrink-0 rounded-full bg-primary hover:bg-primary/90 p-0"
              variant="default"
              size="icon"
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
        ) : uniqueMatches.length === 0 ? (
          <p className="text-muted-foreground">No schedule available yet</p>
        ) : (
        <div className="flex flex-col">
          {uniqueMatches.slice(0, 3).map((match) => {
            const matchTeams = schedule.filter((s) => s.match === match);
            // Pick the first team from the match
            const firstTeamEntry = matchTeams[0];
            const firstTeam = teams.find((t) => t.key === firstTeamEntry?.team);
            
            return (
              <div
                key={match}
                className="rounded-2xl bg-muted px-5 py-5 mb-3 last:mb-0 cursor-pointer"
                onClick={() => {
                  setSelectedMatch(match);
                  if (firstTeamEntry) setSelectedTeam(firstTeamEntry.team);
                }}
              >
                <div className="flex w-full items-center justify-between">
                  <div>
                    <p className="text-base">
                      <span className="font-bold text-primary">{match.toUpperCase()}</span>
                      {firstTeam && (
                        <span className="text-foreground"> | Team {firstTeam.num}</span>
                      )}
                    </p>
                    <p className="mt-1 text-sm text-border">
                      {firstTeamEntry?.alliance.toUpperCase()} Alliance
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

