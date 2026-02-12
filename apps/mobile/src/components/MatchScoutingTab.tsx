import { useEffect, useState } from "react";
import { getEventMatchData, type EventMatchData } from "@lib/db";
import { getMatchLabel } from "@lib/utils/match";
import type { MatchDataRaw } from "@lib/config/match-action-schemas/actions.types";

interface MatchScoutingTabProps {
  eventKey: string;
  teamKey: string;
}

export function MatchScoutingTab({ eventKey, teamKey }: MatchScoutingTabProps) {
  const [matchData, setMatchData] = useState<EventMatchData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!eventKey || !teamKey) return;

    getEventMatchData(eventKey, undefined, teamKey).then((data) => {
      const validData = data.filter((d) => !d.deleted_at);
      setMatchData(validData);
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
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
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
        </div>
      </div>
    );
  }

  // Group by match
  const matchGroups = matchData.reduce(
    (acc, data) => {
      if (!acc[data.match]) acc[data.match] = [];
      acc[data.match].push(data);
      return acc;
    },
    {} as Record<string, EventMatchData[]>
  );

  return (
    <div className="flex flex-col gap-6">
      {Object.entries(matchGroups).map(([matchKey, entries]) => (
        <div key={matchKey} className="rounded-2xl bg-muted p-6">
          <p className="font-bold text-foreground mb-4">
            {getMatchLabel(matchKey)}
          </p>
          {entries.map((entry) => (
            <MatchDataCard key={entry.timestamp} data={entry} />
          ))}
        </div>
      ))}
    </div>
  );
}

function MatchDataCard({ data }: { data: EventMatchData }) {
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
        <div className="space-y-2">
          <p className="text-sm font-semibold text-foreground">Ratings</p>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {matchDataRaw.postMatch.ratings.groundIntake && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Ground:</span>
                <span>{matchDataRaw.postMatch.ratings.groundIntake}/5</span>
              </div>
            )}
            {matchDataRaw.postMatch.ratings.stationIntake && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Station:</span>
                <span>{matchDataRaw.postMatch.ratings.stationIntake}/5</span>
              </div>
            )}
            {matchDataRaw.postMatch.ratings.passing && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Passing:</span>
                <span>{matchDataRaw.postMatch.ratings.passing}/5</span>
              </div>
            )}
          </div>
        </div>
      )}

      {matchDataRaw.driverRating && (
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">Driver Rating</p>
          <p className="text-sm text-muted-foreground">
            {matchDataRaw.driverRating}/5
          </p>
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
