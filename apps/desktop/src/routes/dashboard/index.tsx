import { createFileRoute, redirect } from "@tanstack/react-router";
import supabase from "@lib/supabase/supabase";
import { useEffect, useState } from "react";
import { Button } from "@shadcn/ui/components/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@shadcn/ui/components/card.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@shadcn/ui/components/select.tsx";
import { Activity, Users, Calendar, RefreshCw } from "lucide-react";
import { useDesktopEvent } from "../../contexts/DesktopEventContext";
import { useDesktopRealtime } from "../../contexts/DesktopRealtimeContext";
import { useDesktopTeamData } from "../../contexts/DesktopTeamDataContext";
import { useDesktopCompetitionData } from "../../contexts/DesktopCompetitionDataContext";

export const Route = createFileRoute("/dashboard/")({
  beforeLoad: async () => {
    // Protect route - require auth
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      throw redirect({ to: "/auth" });
    }
  },
  component: DashboardPage,
});

interface EventListEntry {
  event: string;
  alias: string;
  date: string;
}

function DashboardPage() {
  const { currentEvent, setCurrentEvent } = useDesktopEvent();
  const { registerRefreshCallback, isConnected } = useDesktopRealtime();
  const { teams } = useDesktopTeamData();
  const { schedule, picklists, picklistEntries } = useDesktopCompetitionData();

  const [syncStatus, setSyncStatus] = useState<{
    isRunning: boolean;
    lastSync: Date | null;
  }>({
    isRunning: true, // Background sync is always running
    lastSync: null,
  });

  const [user, setUser] = useState<{ email: string } | null>(null);
  const [events, setEvents] = useState<EventListEntry[]>([]);
  const [needsRestart, setNeedsRestart] = useState(false);

  // Update last sync time when data changes
  useEffect(() => {
    if (teams.length > 0 || schedule.length > 0) {
      setSyncStatus((prev) => ({
        ...prev,
        lastSync: new Date(),
      }));
    }
  }, [teams, schedule]);

  // Load events and user on mount
  useEffect(() => {
    // Get current user
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setUser({ email: data.user.email || "" });
      }
    });

    fetchEvents();
  }, []);

  const fetchEvents = async () => {
    try {
      const { data, error } = await supabase
        .from("event_list")
        .select("event, alias, date")
        .order("date", { ascending: false });

      if (error) throw error;
      if (data) {
        setEvents(data);
      }
    } catch (error) {
      console.error("Failed to fetch events:", error);
    }
  };

  const handleEventChange = async (newEvent: string) => {
    try {
      // Save to Tauri store via context
      await setCurrentEvent(newEvent);

      // Show restart button (backend needs restart to switch event)
      setNeedsRestart(true);

      // Context will trigger DesktopRealtimeProvider to unsubscribe/resubscribe
      // fetchCounts will be called automatically via realtime callback
    } catch (error) {
      console.error("Failed to save event:", error);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = "/auth";
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">FunkyScout Desktop</h1>
            <p className="text-sm text-muted-foreground">
              Logged in as {user?.email}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isConnected && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                <span>Live</span>
              </div>
            )}
            <Button variant="outline" onClick={handleLogout}>
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-6 py-8">
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-3xl font-bold">Dashboard</h2>
            </div>
            <div className="flex items-center gap-4">
              <Select
                value={currentEvent || undefined}
                onValueChange={handleEventChange}
              >
                <SelectTrigger className="w-[240px]">
                  <SelectValue placeholder="Select event" />
                </SelectTrigger>
                <SelectContent>
                  {events.map((event) => (
                    <SelectItem key={event.event} value={event.event}>
                      {event.alias || event.event}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {needsRestart && (
                <Button
                  variant="outline"
                  onClick={() => window.location.reload()}
                >
                  Restart to Apply
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Sync Status</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <div
                  className={`h-2 w-2 rounded-full ${syncStatus.isRunning ? "bg-green-500 animate-pulse" : "bg-gray-400"}`}
                />
                <p className="text-2xl font-bold">
                  {syncStatus.isRunning ? "Active" : "Stopped"}
                </p>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {syncStatus.lastSync
                  ? `Last sync: ${syncStatus.lastSync.toLocaleTimeString()}`
                  : "Syncing..."}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Teams</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{teams.length}</div>
              <p className="text-xs text-muted-foreground">
                From SQLite cache
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Matches</CardTitle>
              <Calendar className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{schedule.length}</div>
              <p className="text-xs text-muted-foreground">Schedule entries</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Sync Interval
              </CardTitle>
              <RefreshCw className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">30s</div>
              <p className="text-xs text-muted-foreground">
                TBA poll frequency
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Info Card */}
        <Card>
          <CardHeader>
            <CardTitle>Realtime Sync Active</CardTitle>
            <CardDescription>
              Desktop polls TBA every 30s and pushes to Supabase. All apps
              receive updates via realtime subscriptions (&lt; 1 second
              latency).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <p>
                <strong>Bidirectional Flow:</strong> Desktop ↔ Supabase ↔
                Mobile
              </p>
              <p className="text-muted-foreground">
                Desktop receives instant updates when mobile users submit pit
                scouting, create picklists, or assign shifts. Backend sync logs
                available in terminal.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Picklists Section - Realtime Test */}
        <div className="mt-8">
          <h3 className="text-2xl font-bold mb-4">Picklists (Realtime Test)</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {picklists.length === 0 ? (
              <Card className="col-span-full">
                <CardContent className="py-8 text-center text-muted-foreground">
                  No picklists found. Create one on mobile to test realtime
                  updates!
                </CardContent>
              </Card>
            ) : (
              picklists.map((picklist) => {
                const entries = picklistEntries.filter(
                  (e) => e.id === picklist.id
                );
                return (
                  <Card key={picklist.id}>
                    <CardHeader>
                      <CardTitle className="text-lg">
                        {picklist.title}
                      </CardTitle>
                      <CardDescription>
                        By {picklist.uname} • {entries.length} teams
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2 max-h-64 overflow-y-auto">
                        {entries.length === 0 ? (
                          <p className="text-sm text-muted-foreground italic">
                            No teams yet
                          </p>
                        ) : (
                          <ol className="space-y-1">
                            {entries.map((entry) => (
                              <li
                                key={entry.team}
                                className="flex items-center justify-between text-sm py-1 px-2 rounded hover:bg-muted transition-colors"
                              >
                                <span>
                                  <span className="font-mono text-muted-foreground mr-2">
                                    {entry.rank}.
                                  </span>
                                  <span className="font-medium">
                                    {entry.team.replace("frc", "")}
                                  </span>
                                </span>
                              </li>
                            ))}
                          </ol>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-4">
            💡 Test realtime: Edit picklists on mobile or desktop and watch them
            sync instantly!
          </p>
        </div>
      </main>
    </div>
  );
}
