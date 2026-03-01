import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ExternalLink, Edit2, Calendar } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@shadcn/ui/components/dialog.tsx";
import { Button } from "@shadcn/ui/components/button.tsx";
import { Input } from "@shadcn/ui/components/input.tsx";
import { Label } from "@shadcn/ui/components/label.tsx";
import type { TBATeam } from "../../../contexts/DesktopTeamDataContext";
import type { ScheduleEntry, TBAMatchData } from "../../../contexts/DesktopCompetitionDataContext";
import { useDesktopEvent } from "../../../contexts/DesktopEventContext";
import { useTabContext } from "../../../contexts/TabContext";
import { getMatchLabel } from "@lib/utils/match";

interface RightPanelProps {
  tbaTeams: TBATeam[];
  schedule: ScheduleEntry[];
  tbaSchedule: Record<string, TBAMatchData>;
}

function formatMatchKey(matchKey: string): string {
  const qm = matchKey.match(/_qm(\d+)$/);
  if (qm) return `Q${qm[1]}`;
  const sf = matchKey.match(/_sf(\d+)m(\d+)$/);
  if (sf) return `SF${sf[1]}-${sf[2]}`;
  const f = matchKey.match(/_f\d+m(\d+)$/);
  if (f) return `F${f[1]}`;
  return matchKey;
}

function formatMatchLabel(matchKey: string): string {
  const qm = matchKey.match(/_qm(\d+)$/);
  if (qm) return `Qualification ${qm[1]}`;
  const sf = matchKey.match(/_sf(\d+)m(\d+)$/);
  if (sf) return `Semifinal ${sf[1]} Match ${sf[2]}`;
  const f = matchKey.match(/_f\d+m(\d+)$/);
  if (f) return `Final Match ${f[1]}`;
  return matchKey;
}

function formatTime(estTime: number): string {
  const now = Date.now() / 1000;
  const diff = estTime - now;
  if (Math.abs(diff) < 60) return "Now";
  if (diff > 0) {
    const mins = Math.round(diff / 60);
    return mins < 60 ? `In ${mins}m` : `In ${Math.round(mins / 60)}h`;
  }
  const mins = Math.round(-diff / 60);
  return mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`;
}

interface UpcomingMatchCardProps {
  matchKey: string;
  tba: TBAMatchData;
  tbaTeams: TBATeam[];
  homeTeamKey: string;
  onMatchClick: (matchKey: string) => void;
}

function UpcomingMatchCard({ matchKey, tba, tbaTeams, homeTeamKey, onMatchClick }: UpcomingMatchCardProps) {
  const homeAlliance =
    tba.redTeams.includes(homeTeamKey)
      ? "red"
      : tba.blueTeams.includes(homeTeamKey)
      ? "blue"
      : null;

  const winProb = tba.red_win_prob;

  const getRank = (teamKey: string) => {
    const t = tbaTeams.find((t) => t.key === teamKey);
    return t?.rank ?? 0;
  };

  return (
    <div
      className="bg-secondary/30 rounded-lg border border-border overflow-hidden cursor-pointer hover:bg-secondary/50 transition-colors"
      onClick={() => onMatchClick(matchKey)}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
        <span className="text-xs font-semibold text-foreground">{formatMatchKey(matchKey)}</span>
        <span className="text-[10px] text-muted-foreground">{formatTime(tba.est_time)}</span>
      </div>

      <div className="p-3 space-y-2">
        {/* Red Alliance */}
        <div className="flex items-center gap-1.5">
          <div
            className="w-1 h-full rounded-full self-stretch flex-shrink-0"
            style={{ background: "oklch(var(--destructive) / 0.7)", minHeight: "16px" }}
          />
          <div className="flex gap-1 flex-1 flex-wrap">
            {tba.redTeams.map((team) => (
              <span
                key={team}
                className={[
                  "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-destructive/20 text-destructive",
                  team === homeTeamKey && homeAlliance === "red" ? "ring-1 ring-primary" : "",
                ].join(" ")}
              >
                {team.replace("frc", "")}
                {getRank(team) > 0 && (
                  <span className="text-destructive/60">#{getRank(team)}</span>
                )}
              </span>
            ))}
          </div>
        </div>

        {/* Blue Alliance */}
        <div className="flex items-center gap-1.5">
          <div
            className="w-1 h-full rounded-full self-stretch flex-shrink-0"
            style={{ background: "oklch(var(--chart-1) / 0.7)", minHeight: "16px" }}
          />
          <div className="flex gap-1 flex-1 flex-wrap">
            {tba.blueTeams.map((team) => (
              <span
                key={team}
                className={[
                  "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-chart-1/20 text-chart-1",
                  team === homeTeamKey && homeAlliance === "blue" ? "ring-1 ring-primary" : "",
                ].join(" ")}
              >
                {team.replace("frc", "")}
                {getRank(team) > 0 && (
                  <span className="text-chart-1/60">#{getRank(team)}</span>
                )}
              </span>
            ))}
          </div>
        </div>

        {/* Win probability bar */}
        {winProb != null && (
          <div className="space-y-0.5">
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>Red {Math.round(winProb * 100)}%</span>
              <span>Blue {Math.round((1 - winProb) * 100)}%</span>
            </div>
            <div className="h-1 rounded-full bg-chart-1/30 overflow-hidden">
              <div
                className="h-full bg-destructive/70 rounded-full transition-all"
                style={{ width: `${Math.round(winProb * 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function RightPanel({ tbaTeams, schedule, tbaSchedule }: RightPanelProps) {
  const { homeTeam, setHomeTeam } = useDesktopEvent();
  const { addTab } = useTabContext();
  const navigate = useNavigate();
  const [showEditTeam, setShowEditTeam] = useState(false);
  const [editTeamInput, setEditTeamInput] = useState("");
  const [savingTeam, setSavingTeam] = useState(false);

  const handleMatchClick = (matchKey: string) => {
    addTab("/matches", getMatchLabel(matchKey), { match: matchKey }, `match-${matchKey}`);
    navigate({ to: "/matches", search: { match: matchKey } });
  };

  const homeTeamKey = `frc${homeTeam}`;
  const homeTeamData = tbaTeams.find((t) => t.team === homeTeam);

  const handleSaveTeam = async () => {
    const num = parseInt(editTeamInput.trim(), 10);
    if (isNaN(num) || num <= 0) return;
    setSavingTeam(true);
    try {
      await setHomeTeam(num);
      setShowEditTeam(false);
      setEditTeamInput("");
    } finally {
      setSavingTeam(false);
    }
  };

  // Upcoming matches for home team (future, sorted by est_time)
  const upcomingMatches = useMemo(() => {
    const now = Date.now() / 1000;
    const homeEntries = schedule.filter((s) => s.team === homeTeamKey);
    const futureMatchKeys = [...new Set(homeEntries.map((s) => s.match))].filter(
      (key) => {
        const tba = tbaSchedule[key];
        return tba?.est_time != null && tba.est_time > now;
      }
    );
    futureMatchKeys.sort((a, b) => {
      const tA = tbaSchedule[a]?.est_time ?? 0;
      const tB = tbaSchedule[b]?.est_time ?? 0;
      return tA - tB;
    });
    return futureMatchKeys.slice(0, 2);
  }, [schedule, tbaSchedule, homeTeamKey]);

  return (
    <>
      <Dialog open={showEditTeam} onOpenChange={setShowEditTeam}>
        <DialogContent className="bg-muted border-border">
          <DialogHeader>
            <DialogTitle>Set Home Team</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2 py-4">
            <Label htmlFor="home-team">Team Number</Label>
            <Input
              id="home-team"
              type="number"
              value={editTeamInput}
              onChange={(e) => setEditTeamInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSaveTeam()}
              placeholder={String(homeTeam)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditTeam(false)}>Cancel</Button>
            <Button onClick={handleSaveTeam} disabled={savingTeam || !editTeamInput.trim()}>
              {savingTeam ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="w-[280px] flex-shrink-0 flex flex-col gap-3 overflow-y-auto p-3 pr-3">
        {/* Team Status */}
        <div className="bg-card rounded-lg border border-border p-3">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-foreground">Team Status</span>
            <button
              onClick={() => { setEditTeamInput(String(homeTeam)); setShowEditTeam(true); }}
              className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            >
              <Edit2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {!homeTeamData ? (
            <p className="text-xs text-muted-foreground">Team {homeTeam} not in event</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground mb-2 truncate">{homeTeamData.name}</p>
              <div className="grid grid-cols-3 gap-2">
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">Rank</p>
                  <p className="text-lg font-bold text-primary">
                    {homeTeamData.rank > 0 ? `#${homeTeamData.rank}` : "—"}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">EPA</p>
                  <p className="text-lg font-bold text-foreground">
                    {homeTeamData.epa?.total_points?.mean != null
                      ? homeTeamData.epa.total_points.mean.toFixed(1)
                      : "—"}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">OPR</p>
                  <p className="text-lg font-bold text-foreground">
                    {homeTeamData.opr != null ? homeTeamData.opr.toFixed(1) : "—"}
                  </p>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Last Match */}
        {homeTeamData?.lastMatch && (
          <div
            className="bg-card rounded-lg border border-border p-3 cursor-pointer hover:bg-secondary/30 transition-colors"
            onClick={() => handleMatchClick(homeTeamData.lastMatch!)}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">Last Match</span>
              <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <p className="text-xl font-bold text-foreground mt-1">
              {formatMatchKey(homeTeamData.lastMatch)}
            </p>
            <p className="text-xs text-muted-foreground">{formatMatchLabel(homeTeamData.lastMatch)}</p>
          </div>
        )}

        {/* Next Match */}
        {homeTeamData?.nextMatch && (
          <div
            className="bg-card rounded-lg border border-border p-3 cursor-pointer hover:bg-secondary/30 transition-colors"
            onClick={() => handleMatchClick(homeTeamData.nextMatch!)}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">Next Match</span>
              <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <p className="text-xl font-bold text-primary mt-1">
              {formatMatchKey(homeTeamData.nextMatch)}
            </p>
            <p className="text-xs text-muted-foreground">{formatMatchLabel(homeTeamData.nextMatch)}</p>
          </div>
        )}

        {/* Upcoming Matches */}
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-sm font-semibold text-foreground">Upcoming Matches</span>
          </div>

          {upcomingMatches.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No upcoming matches</p>
          ) : (
            <div className="space-y-2">
              {upcomingMatches.map((matchKey) => {
                const tba = tbaSchedule[matchKey];
                if (!tba) return null;
                return (
                  <UpcomingMatchCard
                    key={matchKey}
                    matchKey={matchKey}
                    tba={tba}
                    tbaTeams={tbaTeams}
                    homeTeamKey={homeTeamKey}
                    onMatchClick={handleMatchClick}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
