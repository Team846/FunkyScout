import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Info, Trophy, Zap, BarChart3 } from "lucide-react";
import { useTabContext } from "../../../contexts/TabContext";
import { Progress } from "@shadcn/ui/components/progress.tsx";
import type { ScheduleEntry } from "../../../contexts/DesktopCompetitionDataContext";
import type { MatchScoutingData } from "../../../lib/db";
import { useDesktopTeamData } from "../../../contexts/DesktopTeamDataContext";
import { useDesktopEvent } from "../../../contexts/DesktopEventContext";
import { getMatchLabel } from "@lib/utils/match";

interface UserProfile {
  uid: string;
  name: string;
  settings: Record<string, unknown>;
}

interface LeftPanelProps {
  schedule: ScheduleEntry[];
  matchData: MatchScoutingData[];
  profiles: UserProfile[];
}

export function LeftPanel({ schedule, matchData, profiles }: LeftPanelProps) {
  const { tabs, setActiveTab, addTab } = useTabContext();
  const navigate = useNavigate();
  const { homeTeam } = useDesktopEvent();
  const { tbaTeams } = useDesktopTeamData();

  const homeTeamData = tbaTeams.find((t) => t.team === homeTeam);
  const strategyTarget = homeTeamData?.nextMatch ?? homeTeamData?.lastMatch ?? null;

  // Match Progress: unique qual matches with actual scores / total unique qual matches
  const matchProgress = useMemo(() => {
    const qualMatches = schedule.filter((s) => s.match.includes("_qm"));
    const uniqueMatches = [...new Set(qualMatches.map((s) => s.match))];
    const playedMatches = uniqueMatches.filter((matchKey) => {
      const entry = qualMatches.find((s) => s.match === matchKey);
      return entry?.red_score != null || entry?.blue_score != null;
    });
    return { played: playedMatches.length, total: uniqueMatches.length };
  }, [schedule]);

  // Scouted Shifts: entries with a name (assigned) vs actual match data submitted
  const scoutedShifts = useMemo(() => {
    const assigned = schedule.filter((s) => s.name && s.name.trim() !== "").length;
    const scouted = matchData.filter((m) => m.name && m.name.trim() !== "").length;
    return { scouted, assigned };
  }, [schedule, matchData]);

  // Top Scouters: sort by rating * matchesScouted
  const topScouters = useMemo(() => {
    if (profiles.length === 0) return [];

    const scouterMap = profiles.map((profile) => {
      const rating = (profile.settings?.scouterRating as number) ?? 0;
      const scouted = matchData.filter(
        (m) => m.uid === profile.uid && m.name && m.name.trim() !== ""
      ).length;
      const score = rating * scouted;
      return { uid: profile.uid, name: profile.name, rating, scouted, score };
    });

    return scouterMap
      .filter((s) => s.scouted > 0 || s.rating > 0)
      .sort((a, b) => b.score - a.score || b.scouted - a.scouted);
  }, [profiles, matchData]);

  const matchProgressPct =
    matchProgress.total > 0
      ? Math.round((matchProgress.played / matchProgress.total) * 100)
      : 0;
  const shiftsPct =
    scoutedShifts.assigned > 0
      ? Math.round((scoutedShifts.scouted / scoutedShifts.assigned) * 100)
      : 0;

  return (
    <div className="w-[250px] flex-shrink-0 flex flex-col gap-3 overflow-y-auto p-3">
      {/* Event Information */}
      <div className="bg-card rounded-lg border border-border p-3">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-foreground">Event Information</span>
          <Info className="w-3.5 h-3.5 text-muted-foreground" />
        </div>

        <div className="space-y-3">
          {/* Match Progress */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">Match Progress</span>
              <span className="text-xs font-medium text-foreground">
                {matchProgress.played}/{matchProgress.total}
              </span>
            </div>
            <Progress value={matchProgressPct} className="h-1.5" />
          </div>

          {/* Scouted Shifts */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">Scouted Shifts</span>
              <span className="text-xs font-medium text-foreground">
                {scoutedShifts.scouted}/{scoutedShifts.assigned}
              </span>
            </div>
            <Progress value={shiftsPct} className="h-1.5" />
          </div>
        </div>
      </div>

      {/* Top Scouters */}
      <div className="bg-card rounded-lg border border-border p-3 flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-between mb-3 flex-shrink-0">
          <span className="text-sm font-semibold text-foreground">Top Scouters</span>
          <Trophy className="w-3.5 h-3.5 text-muted-foreground" />
        </div>

        {topScouters.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No scouting data yet</p>
        ) : (
          <div className="space-y-2 overflow-y-auto flex-1 min-h-0">
            {topScouters.map((scouter, idx) => (
              <div key={scouter.uid} className="flex items-center gap-2">
                {/* Rank badge */}
                <span className="text-xs font-bold text-primary w-5 flex-shrink-0">
                  #{idx + 1}
                </span>

                {/* Name */}
                <span className="text-xs text-foreground flex-1 truncate min-w-0">
                  {scouter.name}
                </span>

                {/* Matches chip */}
                <span className="text-[10px] bg-secondary text-muted-foreground rounded px-1.5 py-0.5 flex-shrink-0 flex items-center gap-0.5">
                  <BarChart3 className="w-2.5 h-2.5" />
                  {scouter.scouted}
                </span>

                {/* Rating */}
                <span className="text-[10px] text-muted-foreground flex-shrink-0">
                  {scouter.rating > 0 ? `${scouter.rating}/5` : "—"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="bg-card rounded-lg border border-border p-3">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-foreground">Quick Actions</span>
          <Zap className="w-3.5 h-3.5 text-muted-foreground" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            disabled={!strategyTarget}
            onClick={() => {
              if (!strategyTarget) return;
              addTab("/matches", getMatchLabel(strategyTarget), { match: strategyTarget }, `match-${strategyTarget}`);
              navigate({ to: "/matches", search: { match: strategyTarget } });
            }}
            className={[
              "text-xs rounded-lg p-3 text-center border flex flex-col items-center gap-1.5",
              strategyTarget
                ? "bg-secondary text-foreground hover:bg-secondary/80 transition-colors border-border cursor-pointer"
                : "bg-secondary/50 text-muted-foreground/50 cursor-not-allowed border-border/50",
            ].join(" ")}
          >
            <BarChart3 className="w-4 h-4" />
            Strategy
          </button>
          <button
            onClick={() => {
              const picklistTabs = tabs.filter((t) => t.id.startsWith("picklist-"));
              if (picklistTabs.length > 0) {
                setActiveTab(picklistTabs[picklistTabs.length - 1].id);
              } else {
                navigate({ to: "/picklists" });
              }
            }}
            className="text-xs bg-secondary text-foreground rounded-lg p-3 text-center hover:bg-secondary/80 transition-colors border border-border flex flex-col items-center gap-1.5"
          >
            <Trophy className="w-4 h-4" />
            Picklists
          </button>
        </div>
      </div>
    </div>
  );
}
