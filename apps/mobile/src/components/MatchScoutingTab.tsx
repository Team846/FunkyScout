import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { getEventMatchData, getEventTeamData, getEventSchedule, type EventMatchData } from "@lib/db";
import { getMatchLabel } from "@lib/utils/match";
import type { MatchDataRaw } from "@lib/config/match-action-schemas/actions.types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@shadcn/ui/components/select.tsx";
import { Button } from "@shadcn/ui/components/button.tsx";

interface MatchScoutingTabProps {
  eventKey: string;
  teamKey: string;
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

  if (!matchDataRaw) {
    return null;
  }

  const autoScore = matchDataRaw.autoActions?.length || 0;
  const teleopScore = matchDataRaw.teleopActions?.length || 0;
  const totalActions = autoScore + teleopScore;

  // Find the last active climb action
  const climbAction = matchDataRaw.teleopActions?.find(
    (a) => a.actionId.startsWith("climb_L") && a.enabled
  );
  const climbLevel = climbAction
    ? climbAction.actionId.replace("climb_L", "")
    : "None";

  const handleEdit = () => {
    navigate({
      to: "/match_edit_stats",
      search: {
        teamNum: teamKey,
        matchNum: data.match,
        alliance: data.alliance,
        practice: false,
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
          {new Date(data.timestamp).toLocaleString()}
        </p>
      </div>

      {/* Edit Button */}
      <Button
        size="sm"
        variant="outline"
        onClick={handleEdit}
        className="w-full"
      >
        Edit Match Data
      </Button>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-background p-3">
          <p className="text-xs text-muted-foreground mb-1">Auto Actions</p>
          <p className="text-lg font-semibold text-primary">{autoScore}</p>
        </div>
        <div className="rounded-lg bg-background p-3">
          <p className="text-xs text-muted-foreground mb-1">Teleop Actions</p>
          <p className="text-lg font-semibold text-primary">{teleopScore}</p>
        </div>
        <div className="rounded-lg bg-background p-3">
          <p className="text-xs text-muted-foreground mb-1">Total Actions</p>
          <p className="text-lg font-semibold text-primary">{totalActions}</p>
        </div>
        <div className="rounded-lg bg-background p-3">
          <p className="text-xs text-muted-foreground mb-1">Climb Level</p>
          <p className="text-lg font-semibold text-primary">{climbLevel}</p>
        </div>
      </div>

      {matchDataRaw.postMatch?.ratings && (
        <div className="flex flex-col space-y-2 p-5 bg-background rounded-lg">
          <p className="text-sm font-semibold text-foreground">Ratings</p>
            <div className="grid grid-cols-2 space-y-4 py-2.5 gap-4">
              {[
              { label: "Ground", value: matchDataRaw.postMatch.ratings.groundIntake },
              { label: "Station", value: matchDataRaw.postMatch.ratings.stationIntake },
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
