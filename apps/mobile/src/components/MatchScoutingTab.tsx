import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { getEventMatchData, getEventTeamData, getEventSchedule, type EventMatchData } from "@lib/db";
import { getMatchLabel } from "@lib/utils/match";
import { calculateSingleMatchStats, calculateTeamStats, type TeamStats } from "@lib/data/matchStats";
import type { MatchDataRaw } from "@lib/config/match-action-schemas/actions.types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@shadcn/ui/components/select.tsx";
import { Button } from "@shadcn/ui/components/button.tsx";
import { getSession } from "@lib/supabase/auth";
import { getLocalUserData } from "@lib/supabase/user";

interface MatchScoutingTabProps {
  eventKey: string;
  teamKey: string;
}
interface Frequencies{
  L1: number,
  L2: number,
  L3: number
}
export function MatchScoutingTab({ eventKey, teamKey }: MatchScoutingTabProps) {
  const [matchData, setMatchData] = useState<EventMatchData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMatch, setSelectedMatch] = useState<string>("");
  const [teamStats, setTeamStats] = useState<{ opr?: number; epa?: any } | null>(null);
  const [nextMatch, setNextMatch] = useState<{ match: string; time?: number } | null>(null);

  useEffect(() => {
    if (!eventKey || !teamKey) return;

    Promise.all([
      getEventMatchData(eventKey, undefined, teamKey),
      getEventTeamData(eventKey),
      getEventSchedule(eventKey),
    ]).then(([matchDataResult, teamDataResult, scheduleResult]) => {
      // Only include match data that has been scouted (has name field)
      const validData = matchDataResult.filter((d) => !d.deleted_at && d.name);
      setMatchData(validData);

      // Set first match as default selection
      if (validData.length > 0) {
        setSelectedMatch(validData[0].match);
      }

      // Get team stats (OPR/EPA)
      const teamData = teamDataResult.find((t) => t.team === teamKey);
      if (teamData?.data) {
        setTeamStats({
          opr: teamData.data.opr,
          epa: teamData.data.epa,
        });
      }

      // Find next qual match for this team
      const now = Math.floor(Date.now() / 1000); // Current time in seconds

      const teamMatches = scheduleResult
        .filter((s) => s.team === teamKey && s.match.toLowerCase().includes("qm"))
        .sort((a, b) => {
          const aNum = parseInt(a.match.split("qm")[1]);
          const bNum = parseInt(b.match.split("qm")[1]);
          return aNum - bNum;
        });

      // Find first match that hasn't been scouted AND is in the future
      const unscoutedMatch = teamMatches.find(
        (tm) =>
          !validData.some((md) => md.match === tm.match) &&
          (tm.est_time == null || tm.est_time > now) // Include if no time or if future
      );

      if (unscoutedMatch) {
        setNextMatch({
          match: unscoutedMatch.match,
          time: unscoutedMatch.est_time,
        });
      }

      setLoading(false);
    });
  }, [eventKey, teamKey]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (matchData.length === 0) {
    return (
      <div className="flex flex-1 flex-col gap-6 px-6 py-4">
        {/* OPR/EPA Stats - Same as scouted view */}
        {teamStats && (teamStats.opr !== null && teamStats.opr !== undefined || teamStats.epa?.total_points?.mean !== null && teamStats.epa?.total_points?.mean !== undefined) && (
          <div className="grid grid-cols-2 gap-3">
            {teamStats.opr !== null && teamStats.opr !== undefined && (
              <div className="rounded-xl bg-muted p-4">
                <p className="text-xs text-muted-foreground mb-1">OPR</p>
                <p className="text-xl font-bold text-primary">
                  {teamStats.opr.toFixed(1)}
                </p>
              </div>
            )}
            {teamStats.epa?.total_points?.mean !== null && teamStats.epa?.total_points?.mean !== undefined && (
              <div className="rounded-xl bg-muted p-4">
                <p className="text-xs text-muted-foreground mb-1">EPA</p>
                <p className="text-xl font-bold text-primary">
                  {teamStats.epa.total_points.mean.toFixed(1)}
                </p>
              </div>
            )}
            
          </div>
        )}

        {/* No Match Data Message */}
        <div className="flex flex-1 flex-col items-center justify-center gap-6">
          <div className="rounded-full bg-muted p-6">
            <svg
              className="w-12 h-12 text-muted-foreground"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <div className="text-center space-y-2">
            <h3 className="text-xl font-bold text-primary">No Match Data</h3>
            <p className="text-sm text-muted-foreground max-w-xs">
              This team hasn't been match scouted yet.
            </p>
            {nextMatch ? (
              <div className="mt-4 p-4 rounded-xl bg-muted">
                <p className="text-sm font-semibold text-foreground mb-1">
                  Next Qual Match
                </p>
                <p className="text-lg font-bold text-primary">
                  {getMatchLabel(nextMatch.match)}
                </p>
                {nextMatch.time && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {new Date(nextMatch.time * 1000).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground mt-2">
                No upcoming qual matches
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Get unique matches sorted
  const uniqueMatches = Array.from(new Set(matchData.map((d) => d.match))).sort(
    (a, b) => {
      const aLower = a.toLowerCase();
      const bLower = b.toLowerCase();
      const aIsQual = aLower.includes("qm");
      const bIsQual = bLower.includes("qm");

      if (aIsQual && bIsQual) {
        const aNum = parseInt(a.split("qm")[1]);
        const bNum = parseInt(b.split("qm")[1]);
        return aNum - bNum;
      }
      return a.localeCompare(b);
    }
  );

  const selectedMatchData = matchData.filter((d) => d.match === selectedMatch);


  /* 
  ts is already done in matchStats... js spent like 40 mins on it

  const allStats = matchData
  .map(d => calculateSingleMatchStats(d))
  .filter((s): s is NonNullable<typeof s> => s !== null);

  const matchCount = allStats.length;

  const intakeCounts = allStats.reduce((acc,m) => {
    acc['Ground'] += m.auto.groundIntakes + m.teleop.groundIntakes;
    acc['Station'] += m.auto.stationIntakes + m.teleop.stationIntakes;
    
    return acc;
  }, { Ground: 0, Station: 0 } as Record<string, number>)
  
  const climbCounts = allStats.reduce((acc, m) => {
    
    const lvl = m.climb.level || "None";
    acc[lvl] = (acc[lvl] || 0) + 1;
    return acc; 
  }, {} as Record<string, number>);
  
  */
  
  const aggregateStats: TeamStats | null = calculateTeamStats(teamKey, matchData);
  
  return (
    <div className="flex flex-col gap-10 p-2.5">
      {/* OPR/EPA Stats */}
      {teamStats && (teamStats.opr !== null && teamStats.opr !== undefined || teamStats.epa?.total_points?.mean !== null && teamStats.epa?.total_points?.mean !== undefined) && (
        <div className="grid grid-cols-2 gap-3">
          {teamStats.opr !== null && teamStats.opr !== undefined && (
            <div className="rounded-xl bg-muted p-4">
              <p className="text-xs text-muted-foreground mb-1">OPR</p>
              <p className="text-xl font-bold text-primary">
                {teamStats.opr.toFixed(1)}
              </p>
            </div>
          )}
          {teamStats.epa?.total_points?.mean !== null && teamStats.epa?.total_points?.mean !== undefined && (
            <div className="rounded-xl bg-muted p-4">
              <p className="text-xs text-muted-foreground mb-1">EPA</p>
              <p className="text-xl font-bold text-primary">
                {teamStats.epa.total_points.mean.toFixed(1)}
              </p>
            </div>
          )}
        </div>
      )}
      
      {aggregateStats && (<div className="rounded-2xl bg-muted px-5 py-4">
        <p className="text-s font-semibold text-primary mb-3">CLIMB</p>
        <div className="flex text-sm flex-col gap-3 rounded-lg ">
          {<p >Auto Climb: <span className="font-bold text-primary">{(aggregateStats.climb.autoClimbPercentage).toFixed(0)}%</span></p>}
          <div className="flex gap-3 justify-between items-center">
            {<p>L1: <span className="font-bold text-primary">{(aggregateStats.climb.L1Percentage).toFixed(0)}%</span></p>}
            {<p>L2: <span className="font-bold text-primary">{aggregateStats.climb.L2Percentage.toFixed(0)}%</span></p>}
            {<p>L3: <span className="font-bold text-primary">{aggregateStats.climb.L3Percentage.toFixed(0)}%</span></p>}
          </div>
        </div>
        
        
      </div>)}
      <div className="grid grid-cols-2 gap-3">
        {aggregateStats?.averages.auto && (<div className="rounded-2xl bg-muted px-5 py-4">
          <p className="text-s font-semibold text-primary mb-3">AUTO</p>
          <div className="flex flex-col gap-3 gap-3">
            
            
            <p className="text-xs">Avg Shoots: <span className="font-bold text-primary">{aggregateStats?.averages.auto.shoots.toFixed(1)}</span></p>
            <p className="text-xs">Avg Intakes: <span className="font-bold text-primary">{aggregateStats && (aggregateStats.averages.auto.groundIntakes + aggregateStats.averages.auto.stationIntakes).toFixed(1)}</span></p>
              
            </div>
        </div>)}
          {aggregateStats?.averages.teleop && (<div className="rounded-2xl bg-muted px-5 py-4">
          <p className="text-s font-semibold text-primary mb-3">TELEOP</p>
          <div className="flex flex-col gap-3">
              <p className="text-xs">Avg Shoots: <span className="font-bold text-primary">{aggregateStats?.averages.teleop.shoots.toFixed(1)}</span></p>
              <p className="text-xs">Avg Intakes: <span className="font-bold text-primary">{aggregateStats && (aggregateStats.averages.teleop.groundIntakes + aggregateStats.averages.teleop.stationIntakes).toFixed(1)}</span></p>
            </div>
          </div>)}
      </div>
      
      
      

      {/* Match Selector */}
      <div className="space-y-2">
        <p className="text-sm font-semibold text-foreground">Select Match</p>
        <Select value={selectedMatch} onValueChange={setSelectedMatch}>
          <SelectTrigger className="w-full h-12 bg-muted border-0">
            <SelectValue placeholder="Select a match" />
          </SelectTrigger>
          <SelectContent className="bg-muted text-foreground p-2.5">
            {uniqueMatches.map((match) => (
              <SelectItem key={match} className="h-10 bg-accent focus:text-primary focus:bg-input"  value={match}>
                {getMatchLabel(match)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Selected Match Data */}
      {selectedMatchData.length > 0 && (
        <div className="rounded-2xl bg-muted p-6">
          <p className="font-bold text-foreground mb-4">
            {getMatchLabel(selectedMatch)}
          </p>
          {selectedMatchData.map((entry) => (
            <MatchDataCard key={entry.timestamp} data={entry} teamKey={teamKey} />
          ))}
        </div>
      )}
    </div>
  );
}

function MatchDataCard({ data, teamKey }: { data: EventMatchData; teamKey: string }) {
  const navigate = useNavigate();
  const matchDataRaw = data.data_raw as MatchDataRaw;
  const [canEdit, setCanEdit] = useState(false);

  // Check if user can edit this submission (is owner or admin)
  useEffect(() => {
    async function checkPermissions() {
      const session = await getSession();
      const localUser = getLocalUserData();
      const currentUid = session?.user?.id;
      const userRole = localUser.role || "user";

      // Can edit if: (1) you scouted it, OR (2) you're an admin
      const isOwner = data.uid === currentUid;
      const isAdmin = userRole === "admin";

      setCanEdit(isOwner || isAdmin);
    }

    checkPermissions();
  }, [data.uid]);

  // Use centralized stats calculation
  const matchStats = calculateSingleMatchStats(data);

  if (!matchStats) {
    return null;
  }

  const autoScore =
    matchStats.auto.groundIntakes +
    matchStats.auto.stationIntakes +
    matchStats.auto.passes +
    matchStats.auto.shoots +
    matchStats.auto.stocking;
  const teleopScore =
    matchStats.teleop.groundIntakes +
    matchStats.teleop.stationIntakes +
    matchStats.teleop.passes +
    matchStats.teleop.shoots +
    matchStats.teleop.stocking;
  const totalActions = autoScore + teleopScore;
  const climbLevel = matchStats.climb.level || "None";

  const handleEdit = () => {
    navigate({
      to: "/match_edit_stats",
      search: {
        teamNum: teamKey,
        matchNum: data.match,
        alliance: data.alliance,
        practice: false,
        fromView: "teamView", // Indicates we're coming from team view, not scouting flow
      },
    });
  };

  return (
    <div className="py-3 space-y-3 border-t border-border first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Scouted by: {data.name || "Unknown"}
        </p>
        <p className="text-xs text-muted-foreground">
          {data.timestamp ? new Date(data.timestamp).toLocaleString() : "No timestamp"}
        </p>
      </div>

      {/* Edit Button - Only show if user scouted this OR is admin */}
      {canEdit && (
        <Button
          size="sm"
          variant="outline"
          onClick={handleEdit}
          className="w-full"
        >
          Edit Match Data
        </Button>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col rounded-lg bg-background p-3">
          <p className="text-sm text-muted-foreground mb-1">Auto Actions: <span className="text-lg font-semibold text-primary">{autoScore}</span></p>

          
            
            <p className="text-xs text-muted-foreground mb-1">Auto Shoots: <span className="text-primary">{matchStats.auto.shoots}</span></p>
            <p className="text-xs text-muted-foreground mb-1">Auto Intakes: <span className="text-primary">{matchStats.auto.groundIntakes + matchStats.auto.stationIntakes}</span></p>
            
        </div>
          
            
            
          
        
        <div className="flex flex-col rounded-lg bg-background p-3">

          <p className="text-sm text-muted-foreground mb-1">
            Teleop Actions: <span className="text-lg font-semibold text-primary">{teleopScore}</span>
          </p>
          <p className="text-xs text-muted-foreground mb-1">Teleop Shoots: <span className="text-primary">{matchStats.teleop.shoots}</span></p>

          <p className="text-xs text-muted-foreground mb-1">Teleop Intakes: <span className="text-primary">{matchStats.teleop.groundIntakes + matchStats.teleop.stationIntakes}</span></p>
        </div>
        <div className="rounded-lg bg-background p-3">
          <p className="text-xs text-muted-foreground mb-1">Auto Climb</p>
          <p className="text-lg font-semibold text-primary">
            {matchStats.climb.hasAutoClimb ? "L1" : "None"}
          </p>
        </div>
        <div className="rounded-lg bg-background p-3">
          <p className="text-xs text-muted-foreground mb-1">Teleop Climb</p>
          <p className="text-lg font-semibold text-primary">{climbLevel}</p>
        </div>
      </div>

      {matchDataRaw.postMatch?.ratings && (
        <div className="flex flex-col space-y-2 p-5 bg-background rounded-lg">
          <p className="text-sm font-semibold text-foreground">Ratings</p>
            <div className="grid grid-cols-2 space-y-4 py-2.5 gap-4">
              {[
              { label: "Intake", value: matchDataRaw.postMatch.ratings.groundIntake },
              { label: "Shooting", value: matchDataRaw.postMatch.ratings.shooting },
              { label: "Passing", value: matchDataRaw.postMatch.ratings.passing },
              { label: "Driver", value: matchDataRaw.driverRating }
              ].map(
                (rating) =>
                  rating.value && (
                    <div key={rating.label} className="flex flex-col">
                    <span className="text-muted-foreground">{rating.label}:</span>
                  <div className="flex flex-row">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <svg
                        key={star}
                        viewBox="0 0 24 24"
                        className={`size-6 ${
                          star <= (rating.value ?? 0)
                            ? "text-primary"
                            : "text-border"
                        }`}
                        fill="currentColor"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
                      </svg>
                    ))}
                  </div>
                  </div>
                )
              )}
          </div>
        </div>
      )}

      {matchDataRaw.notes && (
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">Notes</p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {matchDataRaw.notes}
          </p>
        </div>
      )}
    </div>
  );
}
