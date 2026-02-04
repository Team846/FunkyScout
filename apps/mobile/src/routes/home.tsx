import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Button } from "@shadcn/ui/components/button.tsx";
import { Input } from "@shadcn/ui/components/input.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@shadcn/ui/components/dialog.tsx";
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandEmpty,
} from "@shadcn/ui/components/command.js";
import { toast } from "sonner";
import { logout } from "@lib/supabase/auth";
import { getLocalUserData, changeName, useInviteCode, fetchUserProfile } from "@lib/supabase/user";
import { fetchTeamEventStatus } from "@lib/tba";
import { getTeams } from "@lib/data";
import { useEvent } from "@lib/context/EventContext";

export const Route = createFileRoute("/home")({
  component: HomePage,
});

// TODO: Replace with event context when ready
// const CURRENT_EVENT = "2025cada";

interface Team {
  num: number;
  name: string;
  key: string;
  rank: number;
}

function HomePage() {
  const navigate = useNavigate();
  const { currentEvent } = useEvent();
  const [userData, setUserData] = useState(getLocalUserData());
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(true);
  
  // Settings dialog state
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [renamingUser, setRenamingUser] = useState(false);
  const [applyingCode, setApplyingCode] = useState(false);

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

  const handleLogout = async () => {
    await logout();
    toast.success("Logged out successfully");
    navigate({ to: "/auth" });
  };

  const handleRename = async () => {
    if (!newName.trim()) {
      toast.error("Please enter a name");
      return;
    }
    
    setRenamingUser(true);
    try {
      const success = await changeName(newName.trim());
      if (success) {
        toast.success("Name updated successfully!");
        setNewName("");
        // Refresh user data
        const profile = await fetchUserProfile();
        if (profile) {
          setUserData(profile);
        }
      } else {
        toast.error("Failed to update name");
      }
    } finally {
      setRenamingUser(false);
    }
  };

  const handleInviteCode = async () => {
    if (!inviteCode.trim()) {
      toast.error("Please enter an invite code");
      return;
    }
    
    setApplyingCode(true);
    try {
      const success = await useInviteCode(inviteCode.trim());
      if (success) {
        toast.success("Invite code applied successfully!");
        setInviteCode("");
        // Refresh user data
        const profile = await fetchUserProfile();
        if (profile) {
          setUserData(profile);
        }
      } else {
        toast.error("Failed to apply invite code");
      }
    } finally {
      setApplyingCode(false);
    }
  };

  return (
    <div className="flex min-h-dvh w-full flex-col bg-background">
      {/* Header */}
      <header className="shrink-0 px-7 py-4">
        <div className="flex items-center gap-3">
          <p className="text-primary text-md font-light
          ">Dashboard</p>
          <div className="ml-auto flex items-center gap-3">
            <p className="text-sm text-foreground">{userData.name || "User"}</p>
            {currentEvent && (
              <p className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-md">{currentEvent}</p>
            )}

            <Button className=" h-9 w-9 bg-background p-0" variant="ghost" onClick={() => setSettingsOpen(true)}>
              <svg
                viewBox="0 0 25 25"
                style={{ width: 24, height: 24 }}
                xmlns="http://www.w3.org/2000/svg"
              >
                <g clipPath="url(#clip0_415_321)">
                  <path
                    d="M23.7988 15.415L21.7188 14.2139C21.9287 13.081 21.9287 11.9189 21.7188 10.7861L23.7988 9.58495C24.0381 9.44823 24.1455 9.16502 24.0674 8.90135C23.5254 7.16307 22.6025 5.59081 21.3965 4.28221C21.2109 4.08202 20.9082 4.03319 20.6738 4.16991L18.5938 5.37108C17.7197 4.61913 16.7139 4.03807 15.625 3.65721V1.25975C15.625 0.986313 15.4346 0.747055 15.166 0.688461C13.374 0.288071 11.5381 0.307602 9.83399 0.688461C9.56543 0.747055 9.375 0.986313 9.375 1.25975V3.66209C8.29102 4.04784 7.28516 4.62889 6.40625 5.37596L4.33106 4.17479C4.0918 4.03807 3.79395 4.08202 3.6084 4.28709C2.40234 5.59081 1.47949 7.16307 0.937501 8.90623C0.854493 9.16991 0.966798 9.45311 1.20606 9.58983L3.28613 10.791C3.07617 11.9238 3.07617 13.0859 3.28613 14.2187L1.20606 15.4199C0.966798 15.5566 0.859376 15.8398 0.937501 16.1035C1.47949 17.8418 2.40234 19.414 3.6084 20.7226C3.79395 20.9228 4.09668 20.9717 4.33106 20.8349L6.41113 19.6338C7.28516 20.3857 8.29102 20.9668 9.37988 21.3476V23.75C9.37988 24.0234 9.57031 24.2627 9.83887 24.3213C11.6309 24.7217 13.4668 24.7021 15.1709 24.3213C15.4395 24.2627 15.6299 24.0234 15.6299 23.75V21.3476C16.7139 20.9619 17.7197 20.3808 18.5986 19.6338L20.6787 20.8349C20.918 20.9717 21.2158 20.9277 21.4014 20.7226C22.6074 19.4189 23.5303 17.8467 24.0723 16.1035C24.1455 15.8349 24.0381 15.5517 23.7988 15.415ZM12.5 16.4062C10.3467 16.4062 8.59375 14.6533 8.59375 12.5C8.59375 10.3467 10.3467 8.59373 12.5 8.59373C14.6533 8.59373 16.4063 10.3467 16.4063 12.5C16.4063 14.6533 14.6533 16.4062 12.5 16.4062Z"
                    fill="#404040"
                  />
                </g>
                <defs>
                  <clipPath id="clip0_415_321">
                    <rect width="25" height="25" fill="white" />
                  </clipPath>
                </defs>
              </svg>
            </Button>
          </div>
        </div>
      </header>

      {/* Content (scrollable) */}
      <main className="flex-1 overflow-y-auto px-4 pb-28">
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

          {/* Big middle card (matches your original “loading/details” style) */}
          <div className="flex min-h-[12rem] items-center justify-center rounded-2xl bg-muted p-6 text-center">
            <p className="text-sm text-border">Loading match details...</p>
          </div>

          {/* Scouting section (SQUARE cards, same layout/count/icons) */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <p className="text-base text-primary">Scouting</p>
            </div>

            <div className="flex gap-4">
              <div className="flex-1 aspect-square rounded-2xl bg-muted p-6" onClick={() => navigate({ to: "/match" })}>
                <div className="flex h-full flex-col justify-between">
                  <p className="text-primary text-base">Match Scouting</p>

                  <div className="mt-6 flex items-end justify-between">
                    <p className="text-[15px]">Start</p>
                    <Button className="h-6 w-6 bg-muted p-0" >
                      {/* SAME ICON AS ORIGINAL */}
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

              <div className="flex-1 rounded-2xl bg-muted p-6"onClick={() => navigate({ to: "/pit" })}>
                <div className="flex h-full flex-col justify-between">
                  <p className="text-primary text-base">Pit Scouting</p>

                  <div className="mt-6 flex items-end justify-between">
                    <p className="text-[15px]">Start</p>
                    <Button className="h-6 w-6 bg-muted p-0" >
                      {/* SAME ICON AS ORIGINAL */}
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
              <p className="text-base text-primary">Picklist</p>
            </div>

            <div className="flex gap-4">
              <div className="flex-1 rounded-2xl bg-muted p-6 aspect-square">
                <div className="flex h-full flex-col justify-between">
                  <p className="text-primary text-base">Open Picklist</p>

                  <div className="mt-6 flex items-end justify-between">
                    <p className="text-[15px]">Start</p>
                    <Button className="h-6 w-6 bg-muted p-0">
                      {/* SAME ICON AS ORIGINAL */}
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
                  <p className="text-primary text-base">New Picklist</p>

                  <div className="mt-6 flex items-end justify-between">
                    <p className="text-[15px]">Start</p>
                    <Button className="h-6 w-6 bg-muted p-0">
                      {/* SAME ICON AS ORIGINAL */}
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
                  viewBox="0 0 24 24"
                  style={{ width: 20, height: 20 }}
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M3 6H21M3 12H21M3 18H21"
                    stroke="#404040"
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
                <CommandEmpty>{teamsLoading ? "Loading teams..." : "No teams found."}</CommandEmpty>
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
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </div>
        </div>
      </main>

      {/* Bottom Nav (same icons/count, consistent bottom spacing) */}
      <nav className="fixed inset-x-0 bottom-0 z-50">
        <div className="mx-auto w-full max-w-md px-4 pb-[calc(env(safe-area-inset-bottom,0px)+12px)]">
          <div className="flex items-center justify-between rounded-2xl bg-muted px-6 py-4 shadow-lg">
            <Button className="h-10 w-10 bg-muted p-0">
              {/* SAME ICON AS ORIGINAL */}
              <svg
                viewBox="0 0 25 20"
                fill="none"
                style={{ width: 28, height: 28 }}
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M12.1688 5.04384L4.16666 11.6345V18.7478C4.16666 18.932 4.23983 19.1086 4.37006 19.2389C4.50029 19.3691 4.67693 19.4423 4.8611 19.4423L9.72482 19.4297C9.9084 19.4288 10.0841 19.3552 10.2136 19.2251C10.3431 19.0949 10.4158 18.9188 10.4158 18.7352V14.5812C10.4158 14.397 10.489 14.2204 10.6192 14.0901C10.7494 13.9599 10.9261 13.8867 11.1102 13.8867H13.888C14.0722 13.8867 14.2488 13.9599 14.3791 14.0901C14.5093 14.2204 14.5825 14.397 14.5825 14.5812V18.7322C14.5822 18.8236 14.5999 18.9141 14.6347 18.9986C14.6695 19.0831 14.7206 19.1599 14.7851 19.2247C14.8496 19.2894 14.9263 19.3407 15.0106 19.3758C15.095 19.4108 15.1855 19.4288 15.2769 19.4288L20.1389 19.4423C20.3231 19.4423 20.4997 19.3691 20.6299 19.2389C20.7602 19.1086 20.8333 18.932 20.8333 18.7478V11.6298L12.8329 5.04384C12.7388 4.96802 12.6217 4.92668 12.5009 4.92668C12.3801 4.92668 12.2629 4.96802 12.1688 5.04384ZM24.809 9.52344L21.1805 6.53255V0.520833C21.1805 0.3827 21.1257 0.250224 21.028 0.152549C20.9303 0.0548735 20.7978 0 20.6597 0H18.2292C18.091 0 17.9585 0.0548735 17.8609 0.152549C17.7632 0.250224 17.7083 0.3827 17.7083 0.520833V3.67231L13.8225 0.47526C13.4496 0.168394 12.9816 0.000613431 12.4987 0.000613431C12.0158 0.000613431 11.5478 0.168394 11.1749 0.47526L0.188362 9.52344C0.135623 9.56703 0.0919888 9.62058 0.0599541 9.68104C0.0279193 9.7415 0.00811156 9.80768 0.00166252 9.8758C-0.00478653 9.94392 0.00224954 10.0126 0.0223687 10.078C0.0424879 10.1434 0.0752958 10.2042 0.118918 10.2569L1.22569 11.6024C1.26919 11.6553 1.3227 11.6991 1.38315 11.7313C1.44361 11.7635 1.50981 11.7835 1.57799 11.79C1.64616 11.7966 1.71496 11.7897 1.78045 11.7696C1.84593 11.7496 1.90682 11.7168 1.95963 11.6732L12.1688 3.26432C12.2629 3.18851 12.3801 3.14717 12.5009 3.14717C12.6217 3.14717 12.7388 3.18851 12.8329 3.26432L23.0425 11.6732C23.0952 11.7168 23.156 11.7496 23.2214 11.7697C23.2868 11.7898 23.3556 11.7969 23.4237 11.7904C23.4918 11.784 23.558 11.7642 23.6184 11.7321C23.6789 11.7001 23.7324 11.6565 23.776 11.6037L24.8828 10.2582C24.9264 10.2052 24.9591 10.1441 24.9789 10.0784C24.9988 10.0128 25.0055 9.94379 24.9987 9.8755C24.9918 9.80722 24.9715 9.74096 24.939 9.68054C24.9064 9.62012 24.8623 9.56673 24.809 9.52344Z"
                  fill="#FBBF24"
                />
              </svg>
            </Button>

            <Button className="h-10 w-10 bg-muted p-0">
              {/* SAME ICON AS ORIGINAL */}
              <svg
                viewBox="0 0 25 25"
                style={{ width: 28, height: 28 }}
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M2.34375 6.44531H22.6562C23.0877 6.44531 23.4375 6.09556 23.4375 5.66406V3.71094C23.4375 3.27944 23.0877 2.92969 22.6562 2.92969H2.34375C1.91226 2.92969 1.5625 3.27944 1.5625 3.71094V5.66406C1.5625 6.09556 1.91226 6.44531 2.34375 6.44531ZM2.34375 14.2578H22.6562C23.0877 14.2578 23.4375 13.9081 23.4375 13.4766V11.5234C23.4375 11.0919 23.0877 10.7422 22.6562 10.7422H2.34375C1.91226 10.7422 1.5625 11.0919 1.5625 11.5234V13.4766C1.5625 13.9081 1.91226 14.2578 2.34375 14.2578ZM2.34375 22.0703H22.6562C23.0877 22.0703 23.4375 21.7206 23.4375 21.2891V19.3359C23.4375 18.9044 23.0877 18.5547 22.6562 18.5547H2.34375C1.91226 18.5547 1.5625 18.9044 1.5625 19.3359V21.2891C1.5625 21.7206 1.91226 22.0703 2.34375 22.0703Z"
                  fill="#404040"
                />
              </svg>
            </Button>

            <Button className="h-10 w-10 bg-muted p-0">
              {/* SAME ICON AS ORIGINAL */}
              <svg
                viewBox="0 0 25 25"
                style={{ width: 28, height: 28 }}
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <g clipPath="url(#clip0_415_340)">
                  <path
                    d="M5.07812 14.0566C5.07812 16.5781 6.15918 17.6616 7.8125 18.1875V20.3125H17.1875V18.1875C18.8408 17.6616 19.9219 16.5762 19.9219 14.0566C19.9219 12.562 19.3979 10.7803 18.6187 9.04883L13.7207 13.9478C13.6475 14.021 13.5481 14.0621 13.4446 14.0621C13.341 14.0621 13.2417 14.021 13.1685 13.9478L12.6162 13.3955C12.543 13.3223 12.5019 13.2229 12.5019 13.1194C12.5019 13.0158 12.543 12.9165 12.6162 12.8433L17.8843 7.57324C16.8687 5.72217 15.6152 4.05273 14.4238 3.05225C15.1074 2.88525 15.625 2.29736 15.625 1.5625C15.625 1.1481 15.4604 0.750671 15.1674 0.457646C14.8743 0.16462 14.4769 0 14.0625 0L10.9375 0C10.5231 0 10.1257 0.16462 9.83265 0.457646C9.53962 0.750671 9.375 1.1481 9.375 1.5625C9.375 2.29492 9.89258 2.88525 10.5762 3.05225C7.99854 5.21484 5.07812 10.4736 5.07812 14.0566ZM19.5312 21.875H5.46875C5.26155 21.875 5.06284 21.9573 4.91632 22.1038C4.76981 22.2503 4.6875 22.449 4.6875 22.6562V24.2188C4.6875 24.426 4.76981 24.6247 4.91632 24.7712C5.06284 24.9177 5.26155 25 5.46875 25H19.5312C19.7385 25 19.9372 24.9177 20.0837 24.7712C20.2302 24.6247 20.3125 24.426 20.3125 24.2188V22.6562C20.3125 22.449 20.2302 22.2503 20.0837 22.1038C19.9372 21.9573 19.7385 21.875 19.5312 21.875Z"
                    fill="#404040"
                  />
                </g>
                <defs>
                  <clipPath id="clip0_415_340">
                    <rect width="25" height="25" fill="white" />
                  </clipPath>
                </defs>
              </svg>
            </Button>

            <Button className="h-10 w-10 bg-muted p-0">
              {/* SAME ICON AS ORIGINAL */}
              <svg
                viewBox="0 0 25 25"
                style={{ width: 28, height: 28 }}
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M20.3125 2.34375C20.3125 1.91211 19.9629 1.5625 19.5312 1.5625H16.4062C15.9746 1.5625 15.625 1.91211 15.625 2.34375V4.6875H20.3125V2.34375ZM3.12061 7.81201C2.99805 12.3945 0.168945 13.3896 0 19.7266V21.875C0 22.7378 0.699707 23.4375 1.5625 23.4375H6.25C7.11279 23.4375 7.8125 22.7378 7.8125 21.875V14.0625H9.375V6.25H4.67969C3.81885 6.25 3.14404 6.95166 3.12061 7.81201ZM21.8794 7.81201C21.856 6.95166 21.1812 6.25 20.3203 6.25H15.625V14.0625H17.1875V21.875C17.1875 22.7378 17.8872 23.4375 18.75 23.4375H23.4375C24.3003 23.4375 25 22.7378 25 21.875V19.7266C24.8311 13.3896 22.002 12.3945 21.8794 7.81201ZM8.59375 1.5625H5.46875C5.03711 1.5625 4.6875 1.91211 4.6875 2.34375V4.6875H9.375V2.34375C9.375 1.91211 9.02539 1.5625 8.59375 1.5625ZM10.9375 14.0625H14.0625V6.25H10.9375V14.0625Z"
                  fill="#404040"
                />
              </svg>
            </Button>
          </div>
        </div>
      </nav>

      {/* Settings Dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="w-[95vw] h-[90vh] max-w-none bg-background border border-border p-0">
          <DialogHeader className="px-6 pt-6 pb-2">
            <div className="flex flex-col gap-1">
                <DialogTitle className="text-xl text-primary text-left">User Settings</DialogTitle>
                <p className="text-sm text-muted-foreground mt-1 text-left">{userData.email}</p>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-2">
            <div className="flex flex-col gap-4">
              {/* Rename Section */}
              <div className="flex flex-col gap-2">
                <h3 className="text-base text-foreground font-medium text-left">Change Display Name</h3>
                <div className="flex gap-3">
                  <Input
                    placeholder="Enter new name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="flex-1"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRename();
                    }}
                  />
                  <Button
                    onClick={handleRename}
                    disabled={renamingUser || !newName.trim()}
                    className="px-6"
                  >
                    {renamingUser ? "Updating..." : "Update"}
                  </Button>
                </div>
              </div>

              {/* Invite Code Section */}
              <div className="flex flex-col gap-2">
                <h3 className="text-base text-foreground font-medium text-left">Enter Invite Code</h3>
                <div className="flex gap-3">
                  <Input
                    placeholder="Enter invite code"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                    className="flex-1"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleInviteCode();
                    }}
                  />
                  <Button
                    onClick={handleInviteCode}
                    disabled={applyingCode || !inviteCode.trim()}
                    className="px-6"
                  >
                    {applyingCode ? "Applying..." : "Apply"}
                  </Button>
                </div>
              </div>

              {/* Change Event Section */}
              <div className="flex flex-col gap-2">
                  <Button 
                    variant="outline" 
                    className="w-full justify-between"
                    onClick={() => {
                      setSettingsOpen(false);
                      navigate({ to: "/events" });
                    }}
                  >
                    Change Event
                    <span className="text-xs text-muted-foreground">{currentEvent || "None selected"}</span>
                  </Button>
                  <Button 
                    variant="outline" 
                    className="w-full justify-start text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => {
                      setSettingsOpen(false);
                      handleLogout();
                    }}
                  >
                    Log Out
                  </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
