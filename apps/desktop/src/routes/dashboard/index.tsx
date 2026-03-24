import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import supabase from "@lib/supabase/supabase";
import { getLocalUserData } from "@lib/supabase/user";
import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { Search, ArrowDown } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@shadcn/ui/components/tabs.tsx";
import { Input } from "@shadcn/ui/components/input.tsx";
import { useDesktopTeamData } from "../../contexts/DesktopTeamDataContext";
import { useDesktopCompetitionData } from "../../contexts/DesktopCompetitionDataContext";
import { useDesktopEvent } from "../../contexts/DesktopEventContext";
import { useUserProfiles } from "../../contexts/UserProfilesContext";
import { useTabContext } from "../../contexts/TabContext";
import { useDesktopRealtime } from "../../contexts/DesktopRealtimeContext";
import { getMatchLabel } from "@lib/utils/match";
import { LeftPanel } from "./-components/LeftPanel";
import { ScheduleTable, type ScheduleTableHandle } from "./-components/ScheduleTable";
import { RankingsTable, type RankingsTableHandle } from "./-components/RankingsTable";
import { RightPanel } from "./-components/RightPanel";

// ─── Module-level UI state persistence (survives tab navigation) ─────────────
interface DashboardUIState {
  activeTab: string;
  scheduleSearch: string;
  rankingsSearch: string;
}
let _dashboardUIState: DashboardUIState | null = null;

export const Route = createFileRoute("/dashboard/")({
  beforeLoad: async () => {
    // Fast offline-first check — see apps/desktop/src/routes/index.tsx for explanation.
    if (getLocalUserData().uid) return;

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
  const navigate = useNavigate();
  const { addTab } = useTabContext();
  const { tbaTeams } = useDesktopTeamData();
  const { schedule, tbaSchedule, tbaClimbData, matchScoutingData } = useDesktopCompetitionData();
  const { userProfiles } = useUserProfiles();
  const { homeTeam, useTbaClimb } = useDesktopEvent();
  const { activeScouts } = useDesktopRealtime();

  const handleMatchClick = useCallback(
    (matchKey: string) => {
      addTab("/matches", getMatchLabel(matchKey), { match: matchKey }, `match-${matchKey}`);
      navigate({ to: "/matches", search: { match: matchKey } });
    },
    [addTab, navigate]
  );

  const handleTeamClick = useCallback(
    (teamKey: string) => {
      const teamNum = teamKey.replace("frc", "");
      addTab("/team", `Team ${teamNum}`, { team: teamKey }, `team-${teamKey}`);
      navigate({ to: "/team", search: { team: teamKey } });
    },
    [addTab, navigate]
  );

  const scheduleTableRef = useRef<ScheduleTableHandle>(null);
  const rankingsTableRef = useRef<RankingsTableHandle>(null);
  const [scheduleSearch, setScheduleSearch] = useState(() => _dashboardUIState?.scheduleSearch ?? "");
  const [rankingsSearch, setRankingsSearch] = useState(() => _dashboardUIState?.rankingsSearch ?? "");
  const [activeTab, setActiveTab] = useState(() => _dashboardUIState?.activeTab ?? "schedule");
  // Persist UI state synchronously on every render
  _dashboardUIState = { activeTab, scheduleSearch, rankingsSearch };

  // Auto-scroll schedule table to the current match whenever the schedule tab is active
  // and data is loaded — fires on mount, on tab switch, and when schedule first loads.
  useEffect(() => {
    if (activeTab === "schedule" && schedule.length > 0) {
      setTimeout(() => scheduleTableRef.current?.scrollToCurrentMatch(), 50);
    }
  }, [activeTab, schedule.length]);

  const homeTeamKey = `frc${homeTeam}`;

  const searchQuery = activeTab === "schedule" ? scheduleSearch : rankingsSearch;
  const setSearchQuery = activeTab === "schedule" ? setScheduleSearch : setRankingsSearch;

  const searchPlaceholder = useMemo(
    () =>
      activeTab === "schedule"
        ? "Search by match number..."
        : "Search by team...",
    [activeTab]
  );

  return (
    <div className="h-full flex overflow-hidden pb-3">
      {/* Left Panel */}
      <LeftPanel schedule={schedule} tbaSchedule={tbaSchedule} matchData={matchScoutingData} profiles={userProfiles} />

      {/* Middle Panel */}
      <div className="flex-1 flex flex-col overflow-hidden pr-2">
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v)}
          className="flex flex-col h-full gap-0"
        >
          {/* Tab header */}
          <div className="flex items-center gap-3 px-3 py-2 flex-shrink-0 bg-background">
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
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            {/* Jump to last completed match (schedule) or selected team (rankings) */}
            {activeTab === "schedule" && (
              <button
                onClick={() => scheduleTableRef.current?.scrollToLastCompleted()}
                className="p-1.5 rounded hover:bg-secondary text-muted-foreground transition-colors"
                title="Jump to last completed match"
              >
                <ArrowDown className="w-4 h-4" />
              </button>
            )}
            {activeTab === "rankings" && homeTeamKey && (
              <button
                onClick={() => rankingsTableRef.current?.scrollToTeam(homeTeamKey)}
                className="p-1.5 rounded hover:bg-secondary text-muted-foreground transition-colors"
                title="Jump to selected team"
              >
                <ArrowDown className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Schedule tab */}
          <TabsContent value="schedule" className="flex-1 m-0 px-2 data-[state=active]:flex data-[state=active]:flex-col overflow-hidden">
            <div className="flex-1 overflow-hidden rounded-lg border border-border">
              <ScheduleTable
                ref={scheduleTableRef}
                schedule={schedule}
                tbaSchedule={tbaSchedule}
                tbaTeams={tbaTeams}
                searchQuery={scheduleSearch}
                homeTeamKey={homeTeamKey}
                activeScouts={activeScouts}
                onMatchClick={handleMatchClick}
                onTeamClick={handleTeamClick}
              />
            </div>
          </TabsContent>

          {/* Rankings tab */}
          <TabsContent value="rankings" className="flex-1 m-0 px-2 data-[state=active]:flex data-[state=active]:flex-col overflow-hidden">
            <div className="flex-1 overflow-hidden rounded-lg border border-border">
              <RankingsTable
                ref={rankingsTableRef}
                tbaTeams={tbaTeams}
                matchData={matchScoutingData}
                searchQuery={rankingsSearch}
                tbaClimbData={tbaClimbData}
                useTbaClimb={useTbaClimb}
                homeTeamKey={homeTeamKey}
                onTeamClick={handleTeamClick}
              />
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Right Panel */}
      <RightPanel
        tbaTeams={tbaTeams}
        tbaSchedule={tbaSchedule}
      />
    </div>
  );
}
