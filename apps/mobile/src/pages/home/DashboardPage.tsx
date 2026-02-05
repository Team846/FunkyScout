import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@shadcn/ui/components/button.tsx";
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandEmpty,
} from "@shadcn/ui/components/command.js";
import { getTeams } from "@lib/data";
import { useEvent } from "@lib/context/EventContext";

interface Team {
  num: number;
  name: string;
  key: string;
  rank: number;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { currentEvent } = useEvent();
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(true);

  useEffect(() => {
    if (!currentEvent) return;

    getTeams(currentEvent)
      .then((data) => {
        const transformed: Team[] = (data ?? []).map((t) => ({
          key: t.team,
          num: parseInt(t.team.replace("frc", ""), 10),
          name: t.team_name ?? `Team ${t.team.replace("frc", "")}`,
          rank: (t as any).rank ?? 0,
        }));
        transformed.sort((a, b) => a.num - b.num);
        setTeams(transformed);
      })
      .catch(console.error)
      .finally(() => setTeamsLoading(false));
  }, [currentEvent]);

  return (
    <div className="flex flex-col gap-6">
      {/* Top: stat squares + right filler card */}
      <div className="flex gap-4">
        <div className="flex w-28 shrink-0 flex-col gap-4">
          <div className="aspect-square w-full rounded-2xl bg-muted px-4 py-6">
            <p className="text-4xl leading-none">846</p>
            <p className="mt-3 text-xs text-primary">shifts done</p>
          </div>
          <div className="aspect-square w-full rounded-2xl bg-muted px-4 py-6">
            <p className="text-4xl leading-none">254</p>
            <p className="mt-3 text-xs text-primary">shifts left</p>
          </div>
          <div className="aspect-square w-full rounded-2xl bg-muted px-4 py-6">
            <p className="text-4xl leading-none">10</p>
            <p className="mt-3 text-xs text-primary">till break</p>
          </div>
        </div>

        <div className="flex min-h-[22rem] flex-1 items-center justify-center rounded-2xl bg-muted p-6 text-center">
          <p className="text-sm text-border">No matches assigned...</p>
        </div>
      </div>

      {/* Big middle card (matches your original "loading/details" style) */}
      <div className="flex min-h-[12rem] items-center justify-center rounded-2xl bg-muted p-6 text-center">
        <p className="text-sm text-border">Loading match details...</p>
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
                        fill="#FBBF24"
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
                        fill="#FBBF24"
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
          <div className="flex-1 rounded-2xl bg-muted p-6 aspect-square">
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
                        fill="#FBBF24"
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

          <div className="flex-1 rounded-2xl bg-muted p-6">
            <div className="flex h-full flex-col justify-between">
              <p className="text-primary text-base">View Shifts</p>

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
                        fill="#FBBF24"
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
            {teams.map((team) => (
              <CommandItem
                key={team.key}
                className="rounded-2xl bg-muted px-6 py-6 mb-3 last:mb-0 data-[selected]:bg-muted min-h-[80px]"
              >
                <div className="flex w-full items-center justify-between">
                  <div className="flex-1">
                    <p className="text-base">
                      <span className="font-bold text-primary">{team.num}</span>
                      <span className="text-foreground"> | {team.name}</span>
                    </p>
                    {team.rank > 0 && (
                      <p className="mt-1 text-sm text-border">
                        Rank {team.rank}
                      </p>
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
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </div>
    </div>
  );
}
