import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { invoke } from "@tauri-apps/api/core";
import {
  LayoutDashboard,
  Calendar,
  ListOrdered,
  Play,
  GitCompare,
  CalendarClock,
  Cloud,
  CloudOff,
  Moon,
  ChevronDown,
  X,
  LogOut,
  User,
  Ticket,
  Settings,
  RefreshCw,
  Sun,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@shadcn/ui/components/dropdown-menu.tsx";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@shadcn/ui/components/dialog.tsx";
import { Button } from "@shadcn/ui/components/button.tsx";
import { Input } from "@shadcn/ui/components/input.tsx";
import { Label } from "@shadcn/ui/components/label.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@shadcn/ui/components/tooltip.tsx";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@shadcn/ui/components/popover.tsx";
import { Switch } from "@shadcn/ui/components/switch.tsx";
import { useTabContext } from "../contexts/TabContext";
import { useDesktopEvent } from "../contexts/DesktopEventContext";
import { useDesktopTeamData } from "../contexts/DesktopTeamDataContext";
import { useDesktopCompetitionData } from "../contexts/DesktopCompetitionDataContext";
import { useDesktopSync } from "../contexts/DesktopSyncContext";
import supabase from "@lib/supabase/supabase";
import {
  getLocalUserData,
  changeName,
  applyInviteCode,
} from "@lib/supabase/user";

interface EventListEntry {
  event: string;
  alias: string;
  date: string;
}

const NAV_ITEMS = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard", activePaths: ["/dashboard"] },
  { icon: Calendar, label: "Shifts", path: "/shifts", activePaths: ["/shifts"] },
  { icon: ListOrdered, label: "Picklists", path: "/picklists", activePaths: ["/picklists", "/picklist-open"] },
  { icon: Play, label: "Matches", path: "/matches", activePaths: ["/matches"] },
  { icon: CalendarClock, label: "Scheduler", path: "/scheduler", activePaths: ["/scheduler"] },
  { icon: GitCompare, label: "Comparisons", path: "/comparison", activePaths: ["/comparison"] },
];

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;

  const { tabs, activeTabId, closeTab, setActiveTab } = useTabContext();
  const { currentEvent, setCurrentEvent, useTbaClimb, setUseTbaClimb } =
    useDesktopEvent();
  const { teams, refresh: refreshTeams } = useDesktopTeamData();
  const { refresh: refreshCompetitionData } = useDesktopCompetitionData();
  const { forceSyncNow } = useDesktopSync();

  const [events, setEvents] = useState<EventListEntry[]>([]);
  const [userName, setUserName] = useState("");
  const [userRole, setUserRole] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // Name change dialog
  const [showNameDialog, setShowNameDialog] = useState(false);
  const [newName, setNewName] = useState("");
  const [savingName, setSavingName] = useState(false);

  // Invite code dialog
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [applyingInvite, setApplyingInvite] = useState(false);

  // Bootstrap
  const [showBootstrapDialog, setShowBootstrapDialog] = useState(false);
  const [bootstrapEventKey, setBootstrapEventKey] = useState("");
  const [bootstrapping, setBootstrapping] = useState(false);
  const [bootstrapMsg, setBootstrapMsg] = useState<string | null>(null);

  const [isDark, setIsDark] = useState(() => {
    return localStorage.getItem("theme") !== "light";
  });

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    localStorage.setItem("theme", isDark ? "dark" : "light");
  }, [isDark]);

  useEffect(() => {
    const userData = getLocalUserData();
    setUserName(userData.name || userData.email || "User");

    // Read user_role from JWT claims (what Supabase RLS actually uses)
    supabase.auth.getSession().then(({ data: { session } }) => {
      const claims = session?.access_token
        ? JSON.parse(atob(session.access_token.split(".")[1]))
        : null;
      setUserRole(claims?.user_role ?? claims?.role ?? "no JWT");
    });

    fetchEvents();
  }, []);

  // Track network status and trigger sync immediately when coming back online.
  // The Rust sync queue accumulates writes while offline; this drains it right
  // away instead of waiting up to 120s for the next periodic cycle.
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      console.log("[AppShell] Network reconnected — flushing sync queue");
      invoke("trigger_sync_now")
        .then(() => {
          refreshTeams();
          refreshCompetitionData();
        })
        .catch((e) => console.warn("[AppShell] trigger_sync_now on reconnect failed:", e));
    };
    const handleOffline = () => {
      setIsOnline(false);
      console.log("[AppShell] Network lost — writes will queue locally");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [refreshTeams, refreshCompetitionData]);

  // Cmd+Shift+W (Mac) / Ctrl+Shift+W (Windows) to close current tab
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "w") {
        e.preventDefault();
        if (tabs.length > 1) closeTab(activeTabId);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [tabs.length, activeTabId, closeTab]);

  const fetchEvents = async () => {
    try {
      const { data, error } = await supabase
        .from("event_list")
        .select("event, alias, date")
        .order("date", { ascending: false });
      if (!error && data) setEvents(data);
    } catch (e) {
      console.error("[AppShell] Failed to fetch events:", e);
    }
  };

  const handleSync = async () => {
    if (isSyncing || !isOnline) return;
    setIsSyncing(true);
    try {
      // 1. Kick the Rust sync to pull fresh data from Supabase into SQLite
      await invoke("trigger_sync_now");
      // 2. Re-read SQLite at 5s (fast path: picklists, schedule usually done)
      setTimeout(() => {
        forceSyncNow();
        refreshTeams();
        refreshCompetitionData();
      }, 5000);
      // 3. Re-read again at 15s (slow path: TBA + Statbotics + match data can take 10-15s)
      setTimeout(() => {
        refreshTeams();
        refreshCompetitionData();
        setIsSyncing(false);
      }, 15000);
    } catch (e) {
      console.warn("[AppShell] trigger_sync_now failed:", e);
      refreshTeams();
      refreshCompetitionData();
      setIsSyncing(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  const handleChangeName = async () => {
    if (!newName.trim()) return;
    setSavingName(true);
    try {
      await changeName(newName.trim());
      setUserName(newName.trim());
      setShowNameDialog(false);
      setNewName("");
    } catch (e) {
      console.error("[AppShell] Failed to change name:", e);
    } finally {
      setSavingName(false);
    }
  };

  const handleApplyInvite = async () => {
    if (!inviteCode.trim()) return;
    setApplyingInvite(true);
    try {
      await applyInviteCode(inviteCode.trim());
      setShowInviteDialog(false);
      setInviteCode("");
    } catch (e) {
      console.error("[AppShell] Failed to apply invite code:", e);
    } finally {
      setApplyingInvite(false);
    }
  };

  const handleBootstrap = async () => {
    if (!bootstrapEventKey.trim()) return;
    setBootstrapping(true);
    setBootstrapMsg(null);
    try {
      const count = await invoke<number>("bootstrap_event_schedule", {
        event: bootstrapEventKey.trim(),
      });
      setBootstrapMsg(
        `Bootstrapped ${count} rows for ${bootstrapEventKey.trim()}`
      );
      setBootstrapEventKey("");
      setShowBootstrapDialog(false);
      fetchEvents();
    } catch (e) {
      setBootstrapMsg(`Error: ${e}`);
    } finally {
      setBootstrapping(false);
    }
  };

  const currentEventAlias =
    events.find((e) => e.event === currentEvent)?.alias ||
    currentEvent ||
    "No Event";

  const syncColor = !isOnline
    ? "text-destructive"
    : isSyncing
      ? "text-yellow-400"
      : teams.length > 0
        ? "text-chart-2"
        : "text-muted-foreground";

  return (
    <TooltipProvider delayDuration={300}>
      {/* Change Name Dialog */}
      <Dialog open={showNameDialog} onOpenChange={setShowNameDialog}>
        <DialogContent className="bg-muted border-border">
          <DialogHeader>
            <DialogTitle>Change Name</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2 py-4">
            <Label htmlFor="new-name">New Name</Label>
            <Input
              id="new-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleChangeName()}
              placeholder="Enter your name"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNameDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleChangeName}
              disabled={savingName || !newName.trim()}
            >
              {savingName ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bootstrap Event Dialog */}
      <Dialog
        open={showBootstrapDialog}
        onOpenChange={(open) => {
          setShowBootstrapDialog(open);
          if (!open) setBootstrapMsg(null);
        }}
      >
        <DialogContent className="bg-muted border-border">
          <DialogHeader>
            <DialogTitle>Bootstrap Event</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-4">
            <p className="text-sm text-muted-foreground">
              Seeds event teams and match schedule from TBA into Supabase. Run
              once when setting up a new event.
            </p>
            <Label htmlFor="bootstrap-event-key">Event Key</Label>
            <Input
              id="bootstrap-event-key"
              value={bootstrapEventKey}
              onChange={(e) => setBootstrapEventKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleBootstrap()}
              placeholder="e.g. 2026cada"
            />
            {bootstrapMsg && (
              <p
                className={`text-sm ${bootstrapMsg.startsWith("Error") ? "text-destructive" : "text-chart-2"}`}
              >
                {bootstrapMsg}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowBootstrapDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleBootstrap}
              disabled={bootstrapping || !bootstrapEventKey.trim()}
            >
              {bootstrapping ? "Bootstrapping..." : "Bootstrap"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invite Code Dialog */}
      <Dialog open={showInviteDialog} onOpenChange={setShowInviteDialog}>
        <DialogContent className="bg-muted border-border ">
          <DialogHeader>
            <DialogTitle>Apply Invite Code</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2 py-4">
            <Label htmlFor="invite-code">Invite Code</Label>
            <Input
              id="invite-code"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleApplyInvite()}
              placeholder="Enter invite code"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowInviteDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleApplyInvite}
              disabled={applyingInvite || !inviteCode.trim()}
            >
              {applyingInvite ? "Applying..." : "Apply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="h-screen flex overflow-hidden bg-background">
        {/* Left Icon Sidebar */}
        <aside className="w-[60px] flex-shrink-0 bg-sidebar border-r border-border flex flex-col items-center py-3 gap-1">
          {/* Logo */}
          <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center mb-4 flex-shrink-0">
            <span className="text-primary-foreground font-black text-sm">
              FS
            </span>
          </div>

          {/* Nav items */}
          <div className="flex flex-col items-center gap-1 flex-1">
            {NAV_ITEMS.map(({ icon: Icon, label, path, activePaths }) => {
              const isActive = activePaths.length > 0
                ? activePaths.some((p) => currentPath.startsWith(p))
                : false;
              const isDisabled = path === null;

              return (
                <Tooltip key={label}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => {
                        if (isDisabled || !path) return;
                        if (label === "Picklists") {
                          const picklistTabs = tabs.filter((t) => t.id.startsWith("picklist-"));
                          if (picklistTabs.length > 0) {
                            setActiveTab(picklistTabs[picklistTabs.length - 1].id);
                          } else {
                            navigate({ to: "/picklists" });
                          }
                        } else {
                          navigate({ to: path });
                        }
                      }}
                      disabled={isDisabled}
                      className={[
                        "w-10 h-10 rounded-lg flex items-center justify-center transition-colors",
                        isActive
                          ? "bg-primary/15 text-primary"
                          : isDisabled
                            ? "text-muted-foreground/30 cursor-not-allowed"
                            : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                      ].join(" ")}
                    >
                      <Icon className="w-5 h-5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="right"
                    className="bg-muted text-foreground border border-border [&>svg]:fill-muted [&>svg]:bg-muted"
                  >
                    {isDisabled ? `${label} (coming soon)` : label}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </aside>

        {/* Main content area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Top Tab Bar */}
          <header className="h-10 flex-shrink-0 border-b border-border flex items-stretch bg-background">
            {/* Tabs */}
            <div className="flex items-stretch overflow-x-auto flex-1 min-w-0">
              {tabs.map((tab) => {
                const isActive = tab.id === activeTabId;
                return (
                  <div
                    key={tab.id}
                    className={[
                      "group flex items-center justify-center gap-1.5 px-4 text-xs border-r border-border cursor-pointer select-none w-[160px] flex-shrink-0 transition-colors",
                      isActive
                        ? "bg-card text-foreground border-b-2 border-b-primary -mb-px"
                        : "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
                    ].join(" ")}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    <span className="truncate">{tab.title}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(tab.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 hover:text-foreground text-muted-foreground rounded transition-opacity"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Right controls */}
            <div className="flex items-center gap-1 px-3 flex-shrink-0 border-l border-border">
              {/* Cloud sync icon */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleSync}
                    disabled={!isOnline}
                    className={`p-1.5 rounded hover:bg-secondary transition-colors ${syncColor}`}
                  >
                    {isOnline ? (
                      <Cloud className="w-4 h-4" />
                    ) : (
                      <CloudOff className="w-4 h-4" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent className="bg-muted text-foreground border border-border [&>svg]:fill-muted [&>svg]:bg-muted">
                  {!isOnline
                    ? "Offline — writes queued locally"
                    : isSyncing
                      ? "Syncing..."
                      : teams.length > 0
                        ? "Synced — click to sync now"
                        : "Not synced"}
                </TooltipContent>
              </Tooltip>

              {/* Moon (placeholder) */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setIsDark(!isDark)}
                    className="p-1.5 rounded hover:bg-secondary text-muted-foreground transition-colors"
                  >
                    {isDark ? (
                      <Moon className="w-4 h-4" />
                    ) : (
                      <Sun className="w-4 h-4" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent className="bg-muted text-foreground border border-border [&>svg]:fill-muted [&>svg]:bg-muted">
                  Toggle {isDark ? "Light" : "Dark"}
                </TooltipContent>
              </Tooltip>

              {/* Settings popover */}
              <Popover>
                <PopoverTrigger asChild>
                  <button className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors">
                    <Settings className="w-4 h-4" />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="w-72 bg-muted border-border"
                >
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold text-foreground">
                      Data Settings
                    </h4>
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-foreground">
                          Use TBA Climb Data
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Override scouted climb levels with TBA's official
                          results
                        </p>
                      </div>
                      <Switch
                        checked={useTbaClimb}
                        onCheckedChange={setUseTbaClimb}
                      />
                    </div>

                    <div className="border-t border-border pt-3 space-y-2">
                      <h4 className="text-sm font-semibold text-foreground">
                        Event Management
                      </h4>

                      {/* Bootstrap */}
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground">
                            Bootstrap Event
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            Seed teams + schedule from TBA for a new event
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setShowBootstrapDialog(true)}
                          className="flex-shrink-0"
                        >
                          <RefreshCw className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>

              {/* Name dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-1 px-2 py-1 rounded hover:bg-secondary text-sm text-foreground transition-colors">
                    <span className="max-w-[100px] truncate">{userName}</span>
                    {userRole && (
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                          userRole === "admin"
                            ? "bg-primary/20 text-primary"
                            : userRole === "scouter"
                              ? "bg-chart-2/20 text-chart-2"
                              : userRole === "no JWT"
                                ? "bg-destructive/20 text-destructive"
                                : "bg-secondary text-muted-foreground"
                        }`}
                      >
                        {userRole}
                      </span>
                    )}
                    <ChevronDown className="w-3 h-3 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-44 bg-muted border-border"
                >
                  <DropdownMenuItem
                    onClick={() => {
                      setNewName(userName);
                      setShowNameDialog(true);
                    }}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <User className="w-4 h-4 mr-2" />
                    Change Name
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setShowInviteDialog(true)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Ticket className="w-4 h-4 mr-2" />
                    Apply Invite Code
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={handleLogout}
                    className="text-destructive hover:text-destructive"
                  >
                    <LogOut className="w-4 h-4 mr-2" />
                    Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Event dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-1 px-2 py-1 rounded hover:bg-secondary text-sm text-foreground transition-colors border border-border">
                    <span className="max-w-[160px] truncate">
                      {currentEventAlias}
                    </span>
                    <ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-64 max-h-72 overflow-y-auto bg-muted border-border"
                >
                  {events.map((event) => (
                    <DropdownMenuItem
                      key={event.event}
                      onClick={() => {setCurrentEvent(event.event)}}
                      className={
                        currentEvent === event.event
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:text-foreground"
                      }
                    >
                      <span className="truncate">
                        {event.alias || event.event}
                      </span>
                    </DropdownMenuItem>
                  ))}
                  {events.length === 0 && (
                    <DropdownMenuItem
                      disabled
                      className="text-muted-foreground"
                    >
                      No events found
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          {/* Page content */}
          <main className="flex-1 overflow-hidden">{children}</main>
        </div>
      </div>
    </TooltipProvider>
  );
}
