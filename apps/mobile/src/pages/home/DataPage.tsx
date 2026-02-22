import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { Button } from "@shadcn/ui/components/button.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@shadcn/ui/components/select.tsx";
import { useEvent } from "@lib/context/EventContext";
import { useTeamData } from "@lib/context/TeamDataContext";
import { useCompetition } from "@lib/context/CompetitionDataContext";
import { useAnalytics } from "@lib/context/AnalyticsDataContext";
import { PicklistSelector } from "../../components/PicklistSelector";
import { canCreatePicklist } from "@lib/utils/permissions";
import { getLocalUserData } from "@lib/supabase/user";
import { getMatchData } from "@lib/data/match-data";
import { getTeams } from "@lib/data/teams";
import { calculateAllTeamStats } from "@lib/data/matchStats";
import type { NexusMatch } from "@lib/nexus";

interface NextMatchData {
  matchLabel: string;
  matchTime: string;
  redTeams: number[];
  blueTeams: number[];
  ourAlliance: "red" | "blue";
  winProbability: number | null;
  isPastMatch: boolean;
  redScore: number | null;
  blueScore: number | null;
  predictedRedScore: number | null;
  predictedBlueScore: number | null;
  teamRanks: Record<number, number>;
}

interface TeamStats {
  teamKey: string;
  teamNumber: number;
  teamName: string;
  rank: number;
  epa: number | null;
  averageRating: number | null; // Average of all ratings across all matches
  climbPercentage: number | null; // Percentage of matches with successful climb
  matchCount: number; // Total matches scouted
}

type SortField = "rank" | "epa" | "averageRating" | "climbPercentage";

const SORT_FIELD_LABELS: Record<SortField, string> = {
  rank: "Rank",
  epa: "EPA",
  averageRating: "Avg Rating",
  climbPercentage: "Climb %",
};

const formatMatchTime = (timestamp: number) => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

const formatTimeAgo = (timestamp: number) => {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
};

const nexusLabelToMatchKey = (label: string): string => {
  const lower = label.toLowerCase();
  const qualMatch = lower.match(/qualification\s*(\d+)/);
  if (qualMatch) return `qm${qualMatch[1]}`;
  const playoffMatch = lower.match(/playoff\s*(\d+)/);
  if (playoffMatch) return `sf1m${playoffMatch[1]}`;
  const finalMatch = lower.match(/final\s*(\d+)/);
  if (finalMatch) return `f1m${finalMatch[1]}`;
  return lower.replace(/\s+/g, "");
};

export function DataPage() {
  const navigate = useNavigate();
  const { currentEvent } = useEvent();
  const userData = getLocalUserData();
  const { teams, tbaTeams } = useTeamData();
  const { nexusMatches, tbaSchedule } = useCompetition();
  const { matchPreds } = useAnalytics();

  const [nextMatch, setNextMatch] = useState<NextMatchData | null>(null);
  const [initialMatchLoading, setInitialMatchLoading] = useState(true);
  const [picklistSelectorOpen, setPicklistSelectorOpen] = useState(false);
  const [matchScoutingData, setMatchScoutingData] = useState<any[]>([]);
  const [teamData, setTeamData] = useState<any[]>([]);
  const [sortField, setSortField] = useState<SortField>("rank");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const OUR_TEAM = 233;

  // Fetch match scouting data and team data from Supabase (with local cache)
  useEffect(() => {
    if (!currentEvent) return;

    Promise.all([
      getMatchData(currentEvent),
      getTeams(currentEvent)
    ])
      .then(([matchData, teamDataResults]) => {
        setMatchScoutingData(matchData);
        setTeamData(teamDataResults);
      })
      .catch((error) => {
        console.error("Failed to load data:", error);
      });
  }, [currentEvent]);

  // Calculate team statistics using centralized utility
  const teamStats = useMemo<TeamStats[]>(() => {
    if (!teams.length) return [];

    // Use centralized stats calculation
    const statsMap = calculateAllTeamStats(matchScoutingData);

    // Combine with TBA data (EPA/OPR) and ranking
    return teams.map((team) => {
      const stats = statsMap[team.key];
      const teamDataEntry = teamData.find((t) => t.team === team.key);
      const epaValue = teamDataEntry?.data?.epa?.total_points?.mean ?? null;

      return {
        teamKey: team.key,
        teamNumber: team.num,
        teamName: team.name,
        rank: team.rank || 0,
        epa: epaValue, // Keep EPA from TBA data
        averageRating: stats?.ratings.overall || null,
        climbPercentage: stats
          ? stats.climb.L2Percentage + stats.climb.L3Percentage
          : null,
        matchCount: stats?.matchCount || 0,
      };
    });
  }, [teams, teamData, matchScoutingData]);

  // Sort teams
  const sortedTeams = useMemo(() => {
    const sorted = [...teamStats];
    sorted.sort((a, b) => {
      let aVal: number | null;
      let bVal: number | null;

      switch (sortField) {
        case "rank":
          aVal = a.rank === 0 ? 999 : a.rank;
          bVal = b.rank === 0 ? 999 : b.rank;
          break;
        case "epa":
          aVal = a.epa ?? -1;
          bVal = b.epa ?? -1;
          break;
        case "averageRating":
          aVal = a.averageRating ?? -1;
          bVal = b.averageRating ?? -1;
          break;
        case "climbPercentage":
          aVal = a.climbPercentage ?? -1;
          bVal = b.climbPercentage ?? -1;
          break;
        default:
          return 0;
      }

      if (aVal === null || aVal === -1) return 1;
      if (bVal === null || bVal === -1) return -1;

      if (sortDirection === "asc") {
        return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      } else {
        return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
      }
    });

    return sorted;
  }, [teamStats, sortField, sortDirection]);

  const formatSortValue = (team: TeamStats): string => {
    switch (sortField) {
      case "rank":
        return team.rank > 0 ? `Rank ${team.rank}` : "Rank —";
      case "epa":
        return team.epa != null ? `EPA: ${team.epa.toFixed(1)}` : "EPA: —";
      case "averageRating":
        return team.averageRating != null
          ? `Avg Rating: ${team.averageRating.toFixed(2)}`
          : "Avg Rating: —";
      case "climbPercentage":
        return team.climbPercentage != null
          ? `Climb: ${team.climbPercentage.toFixed(0)}%`
          : "Climb: —";
    }
  };

  // Fetch next/last match data (copied from DashboardPage)
  useEffect(() => {
    if (!currentEvent) return;

    const ourTeamStr = OUR_TEAM.toString();
    const ourTeamKey = `frc${OUR_TEAM}`;

    const fetchMatchData = async () => {
      // Try Nexus first for upcoming matches
      if (nexusMatches.length > 0) {
        const ourMatches = nexusMatches.filter(
          (match: NexusMatch) =>
            match.redTeams.includes(ourTeamStr) ||
            match.blueTeams.includes(ourTeamStr)
        );

        const now = Date.now();
        const upcomingMatches = ourMatches.filter(
          (match: NexusMatch) =>
            !match.times.actualOnFieldTime &&
            match.times.estimatedStartTime > now
        );

        if (upcomingMatches.length > 0) {
          const ourMatch = upcomingMatches.sort(
            (a: NexusMatch, b: NexusMatch) =>
              a.times.estimatedStartTime - b.times.estimatedStartTime
          )[0];

          const isOnRed = ourMatch.redTeams.includes(ourTeamStr);
          const redTeamNums = ourMatch.redTeams.map((t: string) =>
            parseInt(t, 10)
          );
          const blueTeamNums = ourMatch.blueTeams.map((t: string) =>
            parseInt(t, 10)
          );

          const matchKeySuffix = nexusLabelToMatchKey(ourMatch.label);
          const matchKey = `${currentEvent}_${matchKeySuffix}`;

          let winProb: number | null = null;
          let predictedRedScore: number | null = null;
          let predictedBlueScore: number | null = null;

          const statboticsMatch = matchPreds[matchKey];
          if (statboticsMatch && statboticsMatch.pred) {
            winProb = isOnRed
              ? statboticsMatch.pred.red_win_prob
              : 1 - statboticsMatch.pred.red_win_prob;
            predictedRedScore = Math.round(statboticsMatch.pred.red_score);
            predictedBlueScore = Math.round(statboticsMatch.pred.blue_score);
          }

          setNextMatch({
            matchLabel: ourMatch.label,
            matchTime: formatMatchTime(ourMatch.times.estimatedStartTime),
            redTeams: redTeamNums,
            blueTeams: blueTeamNums,
            ourAlliance: isOnRed ? "red" : "blue",
            winProbability: winProb,
            isPastMatch: false,
            redScore: null,
            blueScore: null,
            predictedRedScore,
            predictedBlueScore,
            teamRanks: {},
          });
          return;
        }
      }

      // No upcoming match from Nexus, use TBA data for past matches
      if (tbaTeams.length === 0 || Object.keys(tbaSchedule).length === 0) {
        setNextMatch(null);
        return;
      }

      const ourTeam = tbaTeams.find((t) => t.key === ourTeamKey);

      if (!ourTeam || !ourTeam.lastMatch) {
        setNextMatch(null);
        return;
      }

      const lastMatchKey = ourTeam.lastMatch;
      const matchData = tbaSchedule[lastMatchKey];
      if (!matchData) {
        setNextMatch(null);
        return;
      }

      const isOnRed = matchData.redTeams.includes(ourTeamKey);
      const redTeamNums = matchData.redTeams.map((t: string) =>
        parseInt(t.replace("frc", ""), 10)
      );
      const blueTeamNums = matchData.blueTeams.map((t: string) =>
        parseInt(t.replace("frc", ""), 10)
      );

      const teamRanks: Record<number, number> = {};
      for (const team of tbaTeams) {
        if (team.rank > 0) {
          teamRanks[team.team] = team.rank;
        }
      }

      const matchLabel =
        lastMatchKey.split("_")[1]?.toUpperCase() || lastMatchKey;
      const redScore = matchData.redScore;
      const blueScore = matchData.blueScore;
      const matchTime = matchData.est_time
        ? formatTimeAgo(matchData.est_time * 1000)
        : "";

      setNextMatch({
        matchLabel,
        matchTime,
        redTeams: redTeamNums,
        blueTeams: blueTeamNums,
        ourAlliance: isOnRed ? "red" : "blue",
        winProbability: null,
        isPastMatch: true,
        redScore,
        blueScore,
        predictedRedScore: null,
        predictedBlueScore: null,
        teamRanks,
      });
    };

    fetchMatchData()
      .catch(console.error)
      .finally(() => {
        setInitialMatchLoading(false);
      });
  }, [currentEvent, nexusMatches, tbaTeams, tbaSchedule, matchPreds]);

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden">
      {/* Team Statistics */}
      <div className="flex flex-col gap-3 flex-1 min-h-0">
        <div className="flex items-center justify-between">
          <p className="text-base text-primary">Team Statistics</p>

          {/* Sort dropdown + direction toggle */}
          <div className="flex items-center gap-2">
            <Select
              value={sortField}
              onValueChange={(val) => setSortField(val as SortField)}
            >
              <SelectTrigger className="h-9 w-36 bg-muted border-0 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-muted">
                {(Object.keys(SORT_FIELD_LABELS) as SortField[]).map((key) => (
                  <SelectItem className="text-muted-foreground"key={key} value={key}>
                    {SORT_FIELD_LABELS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <button
              type="button"
              onClick={() =>
                setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"))
              }
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted hover:bg-accent transition-colors"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`transition-transform ${sortDirection === "desc" ? "rotate-180" : ""}`}
              >
                <path d="M12 19V5" />
                <path d="M5 12l7-7 7 7" />
              </svg>
            </button>
          </div>
        </div>

        {/* Scrollable Team List */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {sortedTeams.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-border">No team data available</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {sortedTeams.map((teamStat) => (
                <button
                  key={teamStat.teamKey}
                  type="button"
                  onClick={() =>
                    navigate({
                      to: "/team-info",
                      search: { teamKey: teamStat.teamKey },
                    })
                  }
                  className="rounded-2xl bg-muted px-6 py-5 text-left cursor-pointer hover:bg-accent/50 transition-colors"
                >
                  <div className="flex w-full items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-base">
                        <span className="font-bold text-primary">
                          {teamStat.teamNumber}
                        </span>
                        <span className="text-foreground">
                          {" "}| {teamStat.teamName}
                        </span>
                      </p>
                      <p className="mt-1 text-sm text-border">
                        {formatSortValue(teamStat)}
                      </p>
                    </div>
                    <svg
                      viewBox="0 0 24 24"
                      style={{ width: 20, height: 20 }}
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      className="shrink-0"
                    >
                      <path
                        d="M9 18L15 12L9 6"
                        stroke="currentColor"
                        className="text-primary"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
