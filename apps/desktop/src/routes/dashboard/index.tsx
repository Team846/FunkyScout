import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@shadcn/ui/components/dialog.tsx";
import { Input } from "@shadcn/ui/components/input.tsx";
import { Label } from "@shadcn/ui/components/label.tsx";
import { bootstrapEvent } from "@lib/data";
import { createPicklist } from "@lib/data/writes";
import { getLocalUserData } from "@lib/supabase/user";
import { Activity, Users, Calendar, RefreshCw, Plus, FlaskConical } from "lucide-react";
import { useDesktopEvent } from "../../contexts/DesktopEventContext";
import { useDesktopRealtime } from "../../contexts/DesktopRealtimeContext";
import { useDesktopTeamData } from "../../contexts/DesktopTeamDataContext";
import { useDesktopCompetitionData } from "../../contexts/DesktopCompetitionDataContext";
import { getUserProfiles } from "@lib/data/scouterRatings";
import { getPitScoutingData, getMatchScoutingData } from "../../lib/db";

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
  const navigate = useNavigate();
  const { currentEvent, setCurrentEvent } = useDesktopEvent();
  const { isConnected } = useDesktopRealtime();
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
  const [showBootstrapDialog, setShowBootstrapDialog] = useState(false);
  const [bootstrapEventCode, setBootstrapEventCode] = useState("");
  const [showPicklistDialog, setShowPicklistDialog] = useState(false);
  const [picklistTitle, setPicklistTitle] = useState("");
  const [picklistType, setPicklistType] = useState<"public" | "private" | "default">("public");
  const [creatingPicklist, setCreatingPicklist] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, string>>({});
  const [testingCache, setTestingCache] = useState(false);

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
  const handleBootstrapEvent = () => {
    setShowBootstrapDialog(true);
  };

  const handleBootstrapConfirm = async () => {
    if (!bootstrapEventCode.trim()) return;

    setShowBootstrapDialog(false);
    const eventCode = bootstrapEventCode.trim();

    try {
      await bootstrapEvent(eventCode);

      alert(
        `✅ Event ${eventCode} bootstrapped successfully!\n\n` +
        `Teams, schedule, and match data have been created. ` +
        `The event should now appear in your event list.`
      );

      setBootstrapEventCode("");
      fetchEvents(); // Refresh event list
    } catch (error) {
      console.error("[Dashboard] Bootstrap failed:", error);

      // Show detailed error to user
      const errorMessage = error instanceof Error ? error.message : String(error);
      alert(
        `❌ Bootstrap Failed\n\n${errorMessage}\n\n` +
        `See the browser console for detailed logs.`
      );
    }
  };

  const handleEventChange = async (newEvent: string) => {
    try {
      // Save to Tauri store via context
      await setCurrentEvent(newEvent);

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

  const handleCreatePicklist = async () => {
    if (!currentEvent) {
      alert("Please select an event first");
      return;
    }

    if (!picklistTitle.trim()) {
      alert("Please enter a picklist title");
      return;
    }

    if (teams.length === 0) {
      alert("No teams available for this event");
      return;
    }

    // Debug: Check if running in Tauri (v2 uses __TAURI_INTERNALS__)
    const hasTauriInternals = "__TAURI_INTERNALS__" in window;
    const hasTauriLegacy = "__TAURI__" in window;
    const hasTauri = hasTauriInternals || hasTauriLegacy;
    console.log(`[Dashboard] Tauri v2 check - window.__TAURI_INTERNALS__: ${hasTauriInternals}`);
    console.log(`[Dashboard] Tauri v1 check - window.__TAURI__: ${hasTauriLegacy}`);
    console.log(`[Dashboard] Final isTauri: ${hasTauri}`);

    if (!hasTauri) {
      alert(
        "⚠️ NOT RUNNING IN TAURI!\n\n" +
        "You're accessing this through your browser.\n\n" +
        "Please use the TAURI WINDOW that opens automatically,\n" +
        "not localhost:1420 in your browser.\n\n" +
        "Close your browser tab and use the native app window."
      );
      return;
    }

    setCreatingPicklist(true);
    try {
      const userData = getLocalUserData();

      // Sort teams by rank and create entries
      const sortedTeams = [...teams].sort((a, b) => {
        const rankA = a.rank ?? 999;
        const rankB = b.rank ?? 999;
        return rankA - rankB;
      });

      const entries = sortedTeams.map((team, idx) => ({
        team: team.key,
        rank: idx + 1,
        flags: {},
      }));

      await createPicklist(
        currentEvent,
        picklistTitle,
        entries,
        userData.uid,
        userData.name || "Unknown",
        picklistType
      );

      alert(`✅ Picklist "${picklistTitle}" created!\n\nThe picklist has been queued for sync to Supabase.`);

      setShowPicklistDialog(false);
      setPicklistTitle("");
      setPicklistType("public");
    } catch (error) {
      console.error("Failed to create picklist:", error);
      alert(`❌ Failed to create picklist:\n\n${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setCreatingPicklist(false);
    }
  };

  const handleTestCacheFunctions = async () => {
    if (!currentEvent) {
      alert("Please select an event first");
      return;
    }

    setTestingCache(true);
    const results: Record<string, string> = {};

    try {
      console.log("[Dashboard Test] Testing all cache functions...");

      // Test user profiles
      try {
        const profiles = await getUserProfiles();
        results["User Profiles"] = `✅ ${profiles.length} profiles`;
        console.log("[Dashboard Test] User Profiles:", profiles.length);
      } catch (error) {
        results["User Profiles"] = `❌ ${error instanceof Error ? error.message : String(error)}`;
        console.error("[Dashboard Test] User Profiles error:", error);
      }

      // Test pit scouting data
      try {
        const pitData = await getPitScoutingData(currentEvent);
        results["Pit Scouting"] = `✅ ${pitData.length} submissions`;
        console.log("[Dashboard Test] Pit Scouting:", pitData.length);
      } catch (error) {
        results["Pit Scouting"] = `❌ ${error instanceof Error ? error.message : String(error)}`;
        console.error("[Dashboard Test] Pit Scouting error:", error);
      }

      // Test match scouting data
      try {
        const matchData = await getMatchScoutingData(currentEvent);
        results["Match Scouting"] = `✅ ${matchData.length} submissions`;
        console.log("[Dashboard Test] Match Scouting:", matchData.length);
      } catch (error) {
        results["Match Scouting"] = `❌ ${error instanceof Error ? error.message : String(error)}`;
        console.error("[Dashboard Test] Match Scouting error:", error);
      }

      // Test teams (from context)
      results["Teams"] = `✅ ${teams.length} teams`;

      // Test schedule (from context)
      results["Schedule"] = `✅ ${schedule.length} entries`;

      // Test picklists (from context)
      results["Picklists"] = `✅ ${picklists.length} picklists`;

      // Test picklist entries (from context)
      results["Picklist Entries"] = `✅ ${picklistEntries.length} entries`;

      setTestResults(results);
      console.log("[Dashboard Test] All tests complete:", results);
    } catch (error) {
      console.error("[Dashboard Test] Test suite failed:", error);
      alert(`❌ Test failed:\n\n${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setTestingCache(false);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* Bootstrap Event Dialog */}
      <Dialog open={showBootstrapDialog} onOpenChange={setShowBootstrapDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bootstrap Event</DialogTitle>
            <DialogDescription>
              Enter the event code to fetch teams from TBA and set up the event.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="eventCode">Event Code</Label>
              <Input
                id="eventCode"
                placeholder="e.g., 2026caav"
                value={bootstrapEventCode}
                onChange={(e) => setBootstrapEventCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleBootstrapConfirm();
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBootstrapDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleBootstrapConfirm}>Bootstrap</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Picklist Dialog */}
      <Dialog open={showPicklistDialog} onOpenChange={setShowPicklistDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Picklist</DialogTitle>
            <DialogDescription>
              Creates a picklist with all {teams.length} teams sorted by current rank.
              Offline support: queued for sync when online.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="picklist-title">Picklist Title</Label>
              <Input
                id="picklist-title"
                placeholder="Enter picklist title"
                value={picklistTitle}
                onChange={(e) => setPicklistTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleCreatePicklist();
                  }
                }}
              />
            </div>
            <div className="grid gap-2">
              <Label>Picklist Type</Label>
              <div className="flex gap-2">
                {(["public", "default", "private"] as const).map((type) => (
                  <Button
                    key={type}
                    type="button"
                    variant={picklistType === type ? "default" : "outline"}
                    className="flex-1 capitalize"
                    onClick={() => setPicklistType(type)}
                  >
                    {type}
                  </Button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowPicklistDialog(false);
                setPicklistTitle("");
                setPicklistType("public");
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreatePicklist}
              disabled={creatingPicklist || !picklistTitle.trim()}
            >
              {creatingPicklist ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Header */}
      <header className="border-b flex-shrink-0">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">FunkyScout Desktop</h1>
              {"__TAURI_INTERNALS__" in window || "__TAURI__" in window ? (
                <span className="text-xs px-2 py-1 rounded-full bg-green-500/10 text-green-600 border border-green-500/20">
                  Tauri Mode ✓
                </span>
              ) : (
                <span className="text-xs px-2 py-1 rounded-full bg-red-500/10 text-red-600 border border-red-500/20">
                  Browser Mode (Use Tauri Window!)
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Logged in as {user?.email}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="border-purple-600 text-purple-600 hover:bg-purple-600/10"
              onClick={() => navigate({ to: "/match-edit-test" })}
            >
              <Activity className="h-4 w-4 mr-2" />
              Edit Match Test
            </Button>
            <Button
              variant="outline"
              className="border-green-600 text-green-600 hover:bg-green-600/10"
              onClick={() => setShowPicklistDialog(true)}
              disabled={!currentEvent || teams.length === 0}
            >
              <Plus className="h-4 w-4 mr-2" />
              New Picklist
            </Button>
            <Button
              variant="outline"
              className="border-chart-1 text-chart-1 hover:bg-chart-1/10"
              onClick={handleBootstrapEvent}
            >
              Bootstrap Event
            </Button>
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
      <main className="flex-1 overflow-y-auto">
        <div className="container mx-auto px-6 py-8">
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

        {/* Cache Testing Section */}
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-2xl font-bold">Cache Function Tests</h3>
            <Button
              variant="outline"
              className="border-blue-600 text-blue-600 hover:bg-blue-600/10"
              onClick={handleTestCacheFunctions}
              disabled={!currentEvent || testingCache}
            >
              <FlaskConical className="h-4 w-4 mr-2" />
              {testingCache ? "Testing..." : "Run Cache Tests"}
            </Button>
          </div>

          {Object.keys(testResults).length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {Object.entries(testResults).map(([key, value]) => (
                <Card key={key}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">{key}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className={`text-sm font-mono ${value.startsWith("✅") ? "text-green-600" : "text-red-600"}`}>
                      {value}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {Object.keys(testResults).length === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No tests run yet. Click "Run Cache Tests" to verify all data functions work correctly.
              </CardContent>
            </Card>
          )}

          <p className="text-sm text-muted-foreground mt-4">
            💡 This tests all cache functions: user profiles, pit scouting, match scouting, teams, schedule, and picklists.
          </p>
        </div>
        </div>
      </main>
    </div>
  );
}
