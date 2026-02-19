import { createFileRoute, redirect } from "@tanstack/react-router";
import supabase from "@lib/supabase/supabase";
import { useEffect, useState, useMemo } from "react";
import { Search, SlidersHorizontal, ArrowUpDown } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@shadcn/ui/components/tabs.tsx";
import { Input } from "@shadcn/ui/components/input.tsx";
import { useDesktopTeamData } from "../../contexts/DesktopTeamDataContext";
import { useDesktopCompetitionData } from "../../contexts/DesktopCompetitionDataContext";
import { useDesktopEvent } from "../../contexts/DesktopEventContext";
import { getUserProfiles } from "@lib/data/scouterRatings";
import { getMatchScoutingData } from "../../lib/db";
import type { MatchScoutingData } from "../../lib/db";
import { LeftPanel } from "./-components/LeftPanel";
import { ScheduleTable } from "./-components/ScheduleTable";
import { RankingsTable } from "./-components/RankingsTable";
import { RightPanel } from "./-components/RightPanel";

export const Route = createFileRoute("/dashboard/")({
  beforeLoad: async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      throw redirect({ to: "/auth" });
    }
  },
  component: DashboardPage,
});

interface UserProfile {
  uid: string;
  name: string;
  settings: Record<string, unknown>;
}

function DashboardPage() {
  const { tbaTeams } = useDesktopTeamData();
  const { schedule, tbaSchedule } = useDesktopCompetitionData();
  const { currentEvent, homeTeam } = useDesktopEvent();

  const [matchData, setMatchData] = useState<MatchScoutingData[]>([]);
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("schedule");

  // Fetch scouter data on event change
  useEffect(() => {
    if (!currentEvent) return;

    getMatchScoutingData(currentEvent)
      .then(setMatchData)
      .catch((e) => console.error("[Dashboard] Failed to load match data:", e));

    getUserProfiles()
      .then((p) =>
        setProfiles(
          p.map((prof) => ({
            uid: prof.uid,
            name: prof.name,
            settings: (prof.settings as Record<string, unknown>) ?? {},
          }))
        )
      )
      .catch((e) => console.error("[Dashboard] Failed to load profiles:", e));
  }, [currentEvent]);

  const homeTeamKey = `frc${homeTeam}`;

  const searchPlaceholder = useMemo(
    () =>
      activeTab === "schedule"
        ? "Search by match number..."
        : "Search by team...",
    [activeTab]
  );

  return (
    <div className="h-full flex overflow-hidden">
      {/* Left Panel */}
      <LeftPanel schedule={schedule} matchData={matchData} profiles={profiles} />

      {/* Middle Panel */}
      <div className="flex-1 flex flex-col overflow-hidden border-l border-border">
        <Tabs
          value={activeTab}
          onValueChange={(v) => { setActiveTab(v); setSearchQuery(""); }}
          className="flex flex-col h-full gap-0"
        >
          {/* Tab header */}
          <div className="flex items-center gap-3 px-3 py-2 border-b border-border flex-shrink-0 bg-background">
            <TabsList className="h-8 bg-secondary/50">
              <TabsTrigger value="schedule" className="text-xs h-6 px-3">
                Event Schedule
              </TabsTrigger>
              <TabsTrigger value="rankings" className="text-xs h-6 px-3">
                Rankings
              </TabsTrigger>
            </TabsList>

            {/* Search */}
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="h-8 pl-8 text-xs bg-secondary/50 border-secondary"
              />
            </div>

            {/* Sort & Filter (placeholder icons, non-functional) */}
            <button className="p-1.5 rounded hover:bg-secondary text-muted-foreground transition-colors">
              <ArrowUpDown className="w-4 h-4" />
            </button>
            <button className="p-1.5 rounded hover:bg-secondary text-muted-foreground transition-colors">
              <SlidersHorizontal className="w-4 h-4" />
            </button>
          </div>

          {/* Schedule tab */}
          <TabsContent value="schedule" className="flex-1 m-0 data-[state=active]:flex data-[state=active]:flex-col overflow-hidden">
            <ScheduleTable
              schedule={schedule}
              tbaSchedule={tbaSchedule}
              tbaTeams={tbaTeams}
              searchQuery={searchQuery}
              homeTeamKey={homeTeamKey}
            />
          </TabsContent>

          {/* Rankings tab */}
          <TabsContent value="rankings" className="flex-1 m-0 data-[state=active]:flex data-[state=active]:flex-col overflow-hidden">
            <RankingsTable
              tbaTeams={tbaTeams}
              matchData={matchData}
              searchQuery={searchQuery}
            />
          </TabsContent>
        </Tabs>
      </div>

      {/* Right Panel */}
      <RightPanel
        tbaTeams={tbaTeams}
        schedule={schedule}
        tbaSchedule={tbaSchedule}
      />
    </div>
  );
}
