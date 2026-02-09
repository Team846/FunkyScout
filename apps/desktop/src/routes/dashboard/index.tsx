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
import { Activity, Users, Calendar, RefreshCw } from "lucide-react";

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

function DashboardPage() {
  const [syncStatus, setSyncStatus] = useState<{
    isRunning: boolean;
    lastSync: Date | null;
    teamCount: number;
    matchCount: number;
    currentEvent: string;
  }>({
    isRunning: true, // Background sync is always running
    lastSync: null,
    teamCount: 0,
    matchCount: 0,
    currentEvent: "2025casf", // TODO: Get from config
  });

  const [user, setUser] = useState<{ email: string } | null>(null);

  useEffect(() => {
    // Get current user
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setUser({ email: data.user.email || "" });
      }
    });

    // Fetch initial counts from Supabase
    fetchCounts();

    // Refresh counts every 30 seconds
    const interval = setInterval(fetchCounts, 30000);

    return () => clearInterval(interval);
  }, []);

  const fetchCounts = async () => {
    try {
      // Get team count
      const { count: teamCount } = await supabase
        .from("event_team_data")
        .select("*", { count: "exact", head: true })
        .eq("event", syncStatus.currentEvent)
        .is("deleted_at", null);

      // Get match count
      const { count: matchCount } = await supabase
        .from("event_schedule")
        .select("*", { count: "exact", head: true })
        .eq("event", syncStatus.currentEvent)
        .is("deleted_at", null);

      setSyncStatus((prev) => ({
        ...prev,
        teamCount: teamCount || 0,
        matchCount: matchCount || 0,
        lastSync: new Date(),
      }));
    } catch (error) {
      console.error("Failed to fetch counts:", error);
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
          <Button variant="outline" onClick={handleLogout}>
            Sign Out
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-6 py-8">
        <div className="mb-8">
          <h2 className="text-3xl font-bold">Dashboard</h2>
          <p className="text-muted-foreground mt-1">
            Event: {syncStatus.currentEvent}
          </p>
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
                <div className={`h-2 w-2 rounded-full ${ syncStatus.isRunning ? "bg-green-500 animate-pulse" : "bg-gray-400"}`} />
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
              <div className="text-2xl font-bold">{syncStatus.teamCount}</div>
              <p className="text-xs text-muted-foreground">
                From TBA + Supabase
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Matches</CardTitle>
              <Calendar className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{syncStatus.matchCount}</div>
              <p className="text-xs text-muted-foreground">
                Schedule entries
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Sync Interval</CardTitle>
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
            <CardTitle>Background Sync Active</CardTitle>
            <CardDescription>
              Desktop is polling TBA every 30 seconds and pushing updates to Supabase.
              Mobile apps receive changes via realtime subscriptions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <p>
                <strong>Data Flow:</strong> TBA → Desktop → Supabase → Mobile
              </p>
              <p className="text-muted-foreground">
                Backend sync is running automatically in the background. Check the terminal for detailed sync logs.
              </p>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
