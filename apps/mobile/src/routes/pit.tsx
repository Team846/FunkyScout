import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { Button } from "@shadcn/ui/components/button.js";
import { Badge } from "@shadcn/ui/components/badge.js";
import { useTeamData } from "@lib/context/TeamDataContext";
import { getSession } from "@lib/supabase/auth";

export const Route = createFileRoute("/pit")({
  component: Pit,
});

export function Pit() {
  const navigate = useNavigate();
  const { teams, loading, scoutedTeams, teamAssignments } = useTeamData();

  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [query, setQuery] = useState("");
  const [currentUserUid, setCurrentUserUid] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Get current user's uid
  useEffect(() => {
    getSession().then((session) => {
      if (session?.user?.id) {
        setCurrentUserUid(session.user.id);
      }
    });
  }, []);

  const handleBackClick = () => {
    navigate({ to: "/home" });
  };

  // Helper to get assignment badge
  const getTeamBadge = (teamKey: string) => {
    // Priority: SCOUTED > ASSIGNED > COVERED
    if (scoutedTeams.has(teamKey)) {
      return { type: "SCOUTED", style: "bg-primary/20 text-primary border-primary" };
    }

    const assignedUid = teamAssignments.get(teamKey);
    if (assignedUid) {
      if (assignedUid === currentUserUid) {
        return { type: "ASSIGNED", style: "bg-[#CDA745]/20 text-[#CDA745] border-[#CDA745]" };
      } else {
        return { type: "COVERED", style: "bg-muted-foreground/20 text-muted-foreground border-muted-foreground" };
      }
    }

    return null;
  };

  const filteredTeams = teams.filter((team: any) =>
    `${team.num} ${team.name}`.toLowerCase().includes(query.toLowerCase())
  );

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

      <p className="text-base text-primary mb-4">Pit Scouting</p>

      <div className="relative">
        <div className="flex items-center gap-3 rounded-2xl bg-muted px-5 py-3">
          <div className="flex-1">
            <input
              ref={inputRef}
              type="text"
              value={query}
              placeholder="Search or select a team"
              onChange={(e) => {
                setQuery(e.target.value);
                setShowDropdown(true);
              }}
              onFocus={() => setShowDropdown(true)}
              onBlur={() => {
                // Delay to allow click on dropdown items
                setTimeout(() => setShowDropdown(false), 150);
              }}
              className="h-14 w-full rounded-xl border border-border px-4 text-base text-foreground placeholder:text-muted-foreground outline-none"
            />
          </div>

          <Button
            className="h-10 w-10 rounded-full bg-primary p-0"
            size="icon"
            onClick={() => {
              const team = teams.find((t: any) => t.key === selectedTeam);
              if (!team) return;

              navigate({
                to: "/pitscout",
                search: { teamNum: team.num, teamName: team.name },
              });
            }}
          >
            <svg
              viewBox="0 0 24 24"
              style={{ width: 20, height: 20 }}
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M9 18L15 12L9 6"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-background"
              />
            </svg>
          </Button>
        </div>

        {showDropdown && filteredTeams.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-3 z-50 max-h-60 overflow-y-auto rounded-2xl bg-background  shadow-lg">
            {filteredTeams.map((team: any) => {
              const badge = getTeamBadge(team.key);
              return (
                <div
                  key={team.key}
                  className={`px-2.5 py-1.5  cursor-pointer ${
                    selectedTeam === team.key
                      ? "bg-primary/20"
                      : "hover:bg-background/50"
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setSelectedTeam(team.key);
                    setQuery(`${team.num} | ${team.name}`);
                    setShowDropdown(false);
                  }}
                >
                  <div className="flex items-center justify-between bg-muted px-3 py-3 rounded-xl">
                    <p className="text-base">
                      <span className="font-bold text-primary">{team.num}</span>
                      <span className="text-foreground"> | {team.name}</span>
                    </p>
                    {badge && (
                      <Badge
                        variant="default"
                        className={`ml-2 ${badge.style}`}
                      >
                        {badge.type === "SCOUTED" && (
                          <svg
                            viewBox="0 0 24 24"
                            className="size-3 mr-1"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path
                              d="M20 6L9 17L4 12"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                        {badge.type}
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {showDropdown && query && filteredTeams.length === 0 && (
          <div className="absolute left-0 right-0 top-full mt-2 z-50 rounded-2xl bg-background shadow-lg px-6 py-4">
            <p className="text-muted-foreground">No team found.</p>
          </div>
        )}
      </div>

      <p className="text-base text-primary mt-6">Recommended Teams</p>

      {loading ? (
        <p className="text-muted-foreground">Loading teams...</p>
      ) : (
        <div className="flex flex-col">
          {teams.slice(0, 3).map((team: any) => {
            const badge = getTeamBadge(team.key);
            return (
              <div
                key={team.key}
                className="mt-3 rounded-2xl bg-muted px-6 py-6 cursor-pointer"
                onClick={() =>
                  navigate({
                    to: "/pitscout",
                    search: { teamNum: team.num, teamName: team.name },
                  })
                }
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <p className="text-base">
                      <span className="font-bold text-primary">{team.num}</span>
                      <span> | {team.name}</span>
                    </p>
                    {team.rank > 0 && (
                      <p className="mt-1 text-sm text-border">Rank {team.rank}</p>
                    )}
                  </div>
                  {badge && (
                    <Badge
                      variant="outline"
                      className={`ml-2 ${badge.style}`}
                    >
                      {badge.type === "SCOUTED" && (
                        <svg
                          viewBox="0 0 24 24"
                          className="size-3 mr-1"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            d="M20 6L9 17L4 12"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                      {badge.type}
                    </Badge>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
