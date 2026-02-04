import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@shadcn/ui/components/select.tsx";
import { Button } from "@shadcn/ui/components/button.js";
import { getTeams } from "@lib/data";
import { useEvent } from "@lib/context/EventContext";

export const Route = createFileRoute("/pit")({
  component: Pit,
});

// const CURRENT_EVENT = "2025cada";

interface Team {
  num: number;
  name: string;
  key: string;
  rank: number;
}


export function Pit() {
  const navigate = useNavigate();
  const { currentEvent } = useEvent();
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentEvent) return;

    getTeams(currentEvent)
      .then((data) => {
        // Transform Supabase data to UI format
        const transformed: Team[] = (data ?? []).map((t) => ({
          key: t.team,
          num: parseInt(t.team.replace("frc", ""), 10),
          name: t.team_name ?? `Team ${t.team.replace("frc", "")}`,
          rank: (t as any).rank ?? 0,
        }));
        // Sort by team number
        transformed.sort((a, b) => a.num - b.num);
        setTeams(transformed);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

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
        <p className="text-base text-primary">Pit Scouting</p>

        {/* Selection Card */}
        <div className="flex flex-col gap-4 rounded-2xl bg-muted px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <Select value={selectedTeam ?? undefined} onValueChange={setSelectedTeam}>
                <SelectTrigger className="w-full h-14 hover:text-primary">
                  <SelectValue placeholder="Select a Team" />
                </SelectTrigger>
                <SelectContent className="bg-accent">
                  <SelectGroup>
                    {teams.map((team, index) => (
                      <SelectItem
                        key={team.key}
                        value={`${index}-${team.num}`}
                        className="focus:text-foreground text-muted-foreground focus:bg-ring"
                      >
                        Team {team.num} | {team.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <Button
              className="h-8 w-8 shrink-0 rounded-full bg-primary hover:bg-primary/90 p-0"
              variant="default"
              size="icon"
              onClick={() => {
                if (selectedTeam) {
                  const [indexStr] = selectedTeam.split("-");
                  const team = teams[parseInt(indexStr)];
                  navigate({ to: "/pitscout", search: { teamNum: team.num, teamName: team.name } });
                }
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

        {/* Recommended Teams - show 3 random teams */}
        <p className="text-base text-primary mt-2">Recommended Teams</p>

        {loading ? (
          <p className="text-muted-foreground">Loading teams...</p>
        ) : teams.length === 0 ? (
          <p className="text-muted-foreground">No teams available</p>
        ) : (
        <div className="flex flex-col">
          {teams.slice(0, 3).map((team) => (
            <div
              key={team.key}
              className="rounded-2xl bg-muted px-6 py-6 mb-3 last:mb-0 cursor-pointer min-h-[80px]"
              onClick={() => navigate({ to: "/pitscout", search: { teamNum: team.num, teamName: team.name } })}
            >
              <div className="flex w-full items-center justify-between">
                <div className="flex-1">
                  <p className="text-base">
                    <span className="font-bold text-primary">{team.num}</span>
                    <span className="text-foreground"> | {team.name}</span>
                  </p>
                  {team.rank > 0 && (
                    <p className="mt-1 text-sm text-border">Rank {team.rank}</p>
                  )}
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
          ))}
        </div>
        )}
      </div>
    </div>
  );
}
