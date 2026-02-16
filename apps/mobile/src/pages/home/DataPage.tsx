import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { Button } from "@shadcn/ui/components/button.tsx";
import { Badge } from "@shadcn/ui/components/badge.js";
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandEmpty,
} from "@shadcn/ui/components/command.js";
import { useEvent } from "@lib/context/EventContext";
import { useTeamData } from "@lib/context/TeamDataContext";
import { useCompetition } from "@lib/context/CompetitionDataContext";
import { useAnalytics } from "@lib/context/AnalyticsDataContext";
import { PicklistSelector } from "../../components/PicklistSelector";
import { canCreatePicklist } from "@lib/utils/permissions";
import { getLocalUserData } from "@lib/supabase/user";
import { getMatchLabel } from "@lib/utils/match";
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

type SortField =
  | "teamNumber"
  | "teamName"
  | "rank"
  | "epa"
  | "averageRating"
  | "climbPercentage";

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
  const [matchLoading, setMatchLoading] = useState(false);
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
      let aVal: number | string | null;
      let bVal: number | string | null;

      switch (sortField) {
        case "teamNumber":
          aVal = a.teamNumber;
          bVal = b.teamNumber;
          break;
        case "teamName":
          aVal = a.teamName.toLowerCase();
          bVal = b.teamName.toLowerCase();
          break;
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

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  // Fetch next/last match data (copied from DashboardPage)
  useEffect(() => {
    if (!currentEvent) return;

    const ourTeamStr = OUR_TEAM.toString();
    const ourTeamKey = `frc${OUR_TEAM}`;

    const isInitialLoad = initialMatchLoading;
    if (isInitialLoad) {
      setMatchLoading(true);
    }

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
        setMatchLoading(false);
        setInitialMatchLoading(false);
      });
  }, [currentEvent, nexusMatches, tbaTeams, tbaSchedule, matchPreds]);

  const SortButton = ({
    field,
    label,
  }: {
    field: SortField;
    label: string;
  }) => (
    <button
      type="button"
      onClick={() => handleSort(field)}
      className="flex items-center gap-1 text-xs text-primary hover:text-foreground transition-colors"
    >
      <span>{label}</span>
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className={`transition-transform ${
          sortField === field && sortDirection === "desc" ? "rotate-180" : ""
        }`}
      >
        <path d="M7 10l5 5 5-5" />
      </svg>
    </button>
  );

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden">
      {/* Team Statistics Table - 75% of screen height */}
      <div className="flex flex-col gap-3" style={{ height: '75vh', minHeight: '400px' }}>
        <div className="flex items-center justify-between">
          <p className="text-base text-primary">Team Statistics</p>
        </div>

        {/* Scrollable container with header and rows */}
        <div className="flex-1 rounded-2xl bg-muted overflow-hidden flex flex-col min-h-0">
          {/* Fixed Header with Sort Buttons */}
          <div className="px-6 py-4 grid grid-cols-6 gap-2 items-center border-b border-border shrink-0">
            <SortButton field="teamNumber" label="Team #" />
            <SortButton field="teamName" label="Name" />
            <SortButton field="rank" label="Rank" />
            <SortButton field="epa" label="EPA" />
            <SortButton field="averageRating" label="Avg Rating" />
            <SortButton field="climbPercentage" label="Climb %" />
          </div>

          {/* Scrollable Team List */}
          <div className="flex-1 overflow-y-auto min-h-0 px-4 py-2">
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
                    className="rounded-2xl bg-background px-6 py-5 grid grid-cols-6 gap-2 items-center hover:bg-accent/50 transition-colors text-left min-h-[4rem]"
                  >
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-primary truncate">
                        {teamStat.teamNumber}
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs text-foreground truncate">
                        {teamStat.teamName}
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs text-muted-foreground">
                        {teamStat.rank > 0 ? teamStat.rank : "—"}
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs text-muted-foreground">
                        {teamStat.epa != null ? teamStat.epa.toFixed(1) : "—"}
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs text-muted-foreground">
                        {teamStat.averageRating != null
                          ? teamStat.averageRating.toFixed(2)
                          : "—"}
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs text-muted-foreground">
                        {teamStat.climbPercentage != null
                          ? `${teamStat.climbPercentage.toFixed(0)}%`
                          : "—"}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Next Match Card */}
      <div className="rounded-2xl bg-muted px-6 py-4">
        {initialMatchLoading || (nextMatch && !nextMatch.matchTime) ? (
          <div className="flex min-h-[10rem] items-center justify-center">
            <p className="text-sm text-border">Loading match details...</p>
          </div>
        ) : !nextMatch ? (
          <div className="flex min-h-[10rem] items-center justify-center">
            <p className="text-sm text-border">
              No matches found for {OUR_TEAM}
            </p>
          </div>
        ) : (
          <div className="flex flex-col">
            {/* Centered heading */}
            <div className="flex justify-center items-center gap-2">
              <p className="text-center text-muted-foreground text-sm">
                {nextMatch.isPastMatch ? "Last Match:" : "Next Match:"}
              </p>
              <p className="text-sm font-bold text-primary">
                {nextMatch.matchLabel}
              </p>
            </div>
            <div className="items-center justify-center mt-1">
              <p className="text-xs text-border text-center">
                {nextMatch.matchTime}
              </p>
            </div>

            {/* Alliances - colored boxes */}
            <div className="flex items-stretch gap-2 mt-4">
              {/* Red Alliance Box */}
              <div
                className={`flex-1 min-w-0 rounded-xl border-2 p-4 ${
                  nextMatch.ourAlliance === "red"
                    ? "border-chart-5 bg-chart-5/10"
                    : "border-chart-5/50 bg-chart-5/5"
                }`}
              >
                <div className="flex flex-col gap-1">
                  {nextMatch.redTeams
                    .sort((a, b) => {
                      const rankA = nextMatch.teamRanks[a] ?? 999;
                      const rankB = nextMatch.teamRanks[b] ?? 999;
                      return rankA - rankB;
                    })
                    .map((teamNum) => (
                      <div
                        key={teamNum}
                        className="flex justify-between items-center gap-2"
                      >
                        <p
                          className={`text-xs truncate ${
                            teamNum === OUR_TEAM
                              ? "font-bold text-primary"
                              : "text-foreground"
                          }`}
                        >
                          {teamNum}
                        </p>
                        {nextMatch.teamRanks[teamNum] !== undefined && (
                          <span className="text-[10px] text-muted-foreground/60 bg-background/50 rounded-full px-1.5 py-0.5 shrink-0">
                            #{nextMatch.teamRanks[teamNum]}
                          </span>
                        )}
                      </div>
                    ))}
                </div>
              </div>

              {/* VS */}
              <div className="flex flex-col items-center justify-center shrink-0">
                <p className="text-sm font-bold text-muted-foreground">VS</p>
              </div>

              {/* Blue Alliance Box */}
              <div
                className={`flex-1 min-w-0 rounded-xl border-2 p-3 ${
                  nextMatch.ourAlliance === "blue"
                    ? "border-chart-1 bg-chart-1/10"
                    : "border-chart-1/50 bg-chart-1/5"
                }`}
              >
                <div className="flex flex-col gap-1">
                  {nextMatch.blueTeams
                    .sort((a, b) => {
                      const rankA = nextMatch.teamRanks[a] ?? 999;
                      const rankB = nextMatch.teamRanks[b] ?? 999;
                      return rankA - rankB;
                    })
                    .map((teamNum) => (
                      <div
                        key={teamNum}
                        className="flex justify-between items-center gap-2"
                      >
                        {nextMatch.teamRanks[teamNum] !== undefined && (
                          <span className="text-[10px] text-muted-foreground/60 bg-background/50 rounded-full px-1.5 py-0.5 shrink-0">
                            #{nextMatch.teamRanks[teamNum]}
                          </span>
                        )}
                        <p
                          className={`text-xs text-right truncate ${
                            teamNum === OUR_TEAM
                              ? "font-bold text-primary"
                              : "text-foreground"
                          }`}
                        >
                          {teamNum}
                        </p>
                      </div>
                    ))}
                </div>
              </div>
            </div>

            {/* Scores/Results section */}
            {nextMatch.isPastMatch
              ? nextMatch.redScore !== null &&
                nextMatch.blueScore !== null && (
                  <div className="mt-4">
                    <div className="flex items-center justify-center">
                      <div className="flex items-center justify-end gap-2 w-16">
                        <p className="text-lg font-bold text-chart-5">
                          {nextMatch.redScore}
                        </p>
                        <div className="w-4 h-0.5 bg-chart-5/50 rounded-full" />
                      </div>
                      <p
                        className={`text-lg font-bold px-3 py-1 rounded-lg mx-1 ${
                          (nextMatch.ourAlliance === "red" &&
                            nextMatch.redScore > nextMatch.blueScore) ||
                          (nextMatch.ourAlliance === "blue" &&
                            nextMatch.blueScore > nextMatch.redScore)
                            ? "bg-chart-2/20 text-chart-2"
                            : nextMatch.redScore === nextMatch.blueScore
                              ? "bg-muted-foreground/20 text-muted-foreground"
                              : "bg-chart-5/20 text-chart-5"
                        }`}
                      >
                        {(nextMatch.ourAlliance === "red" &&
                          nextMatch.redScore > nextMatch.blueScore) ||
                        (nextMatch.ourAlliance === "blue" &&
                          nextMatch.blueScore > nextMatch.redScore)
                          ? "WIN"
                          : nextMatch.redScore === nextMatch.blueScore
                            ? "TIE"
                            : "LOSS"}
                      </p>
                      <div className="flex items-center justify-start gap-2 w-16">
                        <div className="w-4 h-0.5 bg-chart-1/50 rounded-full" />
                        <p className="text-lg font-bold text-chart-1">
                          {nextMatch.blueScore}
                        </p>
                      </div>
                    </div>
                    <p className="text-xs text-border text-center mt-2">
                      Results
                    </p>
                  </div>
                )
              : (nextMatch.predictedRedScore !== null ||
                  nextMatch.winProbability !== null) && (
                  <div className="mt-4">
                    <div className="flex items-center justify-center">
                      <div className="flex items-center justify-end gap-1 w-20">
                        <p className="text-lg font-bold text-chart-5">
                          {nextMatch.predictedRedScore}
                        </p>
                        <div className="w-4 h-0.5 bg-chart-5/50 rounded-full" />
                        {(nextMatch.predictedRedScore ?? 0) >
                          (nextMatch.predictedBlueScore ?? 0) && (
                          <svg
                            className="w-3 h-3 text-chart-5 -ml-1"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                          >
                            <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
                          </svg>
                        )}
                      </div>

                      {nextMatch.winProbability !== null && (
                        <p
                          className={`text-lg font-bold px-3 py-1 rounded-lg mx-1 ${
                            nextMatch.winProbability >= 0.5
                              ? "bg-chart-2/20 text-chart-2"
                              : "bg-chart-5/20 text-chart-5"
                          }`}
                        >
                          {Math.round(nextMatch.winProbability * 100)}%
                        </p>
                      )}
                      <div className="flex items-center justify-start gap-1 w-20">
                        {(nextMatch.predictedBlueScore ?? 0) >
                          (nextMatch.predictedRedScore ?? 0) && (
                          <svg
                            className="w-3 h-3 text-chart-1 -mr-1 rotate-180"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                          >
                            <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
                          </svg>
                        )}
                        <div className="w-4 h-0.5 bg-chart-1/50 rounded-full" />
                        <p className="text-lg font-bold text-chart-1">
                          {nextMatch.predictedBlueScore}
                        </p>
                      </div>
                    </div>
                    <p className="text-xs text-border text-center mt-2">
                      Predictions
                    </p>
                  </div>
                )}
          </div>
        )}
      </div>

      {/* Picklist section */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <p className="text-base text-primary">Picklists</p>
        </div>

        <div className="flex gap-4">
          <div
            className="flex-1 rounded-2xl bg-muted p-6 aspect-square cursor-pointer"
            onClick={() => setPicklistSelectorOpen(true)}
          >
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
                        fill="currentColor"
                        className="text-primary"
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
            className={`flex-1 rounded-2xl bg-muted p-6 ${canCreatePicklist(userData.role || "user") ? "cursor-pointer" : "opacity-50 cursor-not-allowed"}`}
            onClick={() => {
              if (canCreatePicklist(userData.role || "user")) {
                navigate({ to: "/picklist-creator" });
              }
            }}
          >
            <div className="flex h-full flex-col justify-between">
              <p className="text-primary text-base">New Picklist</p>

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
                        fill="currentColor"
                        className="text-primary"
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

      {/* Picklist Selector Dialog */}
      <PicklistSelector
        open={picklistSelectorOpen}
        onClose={() => setPicklistSelectorOpen(false)}
        onSelect={(id) => navigate({ to: "/picklist-view", search: { id } })}
      />
    </div>
  );
}
