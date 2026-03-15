import { useMemo, useState, useEffect } from "react";
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
import type { TBAMatchData } from "../../../contexts/DesktopCompetitionDataContext";
import { useDesktopEvent } from "../../../contexts/DesktopEventContext";
import { useTabContext } from "../../../contexts/TabContext";
import { getMatchLabel } from "@lib/utils/match";

interface RightPanelProps {
  tbaTeams: TBATeam[];

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
  if (!estTime) return "";
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

// Sort matches by match number (qm < sf < f) for offline fallback when est_time is unavailable
function matchSortKey(matchKey: string): number {
  const qm = matchKey.match(/_qm(\d+)$/);
  if (qm) return parseInt(qm[1], 10);
  const sf = matchKey.match(/_sf(\d+)m(\d+)$/);
  if (sf) return 10000 + parseInt(sf[1], 10) * 10 + parseInt(sf[2], 10);
  const f = matchKey.match(/_f\d+m(\d+)$/);
  if (f) return 20000 + parseInt(f[1], 10);
  return 99999;
}

interface UpcomingMatchCardProps {
  matchKey: string;
  tba: TBAMatchData;
  tbaTeams: TBATeam[];
  homeTeamKey: string;
  onMatchClick: (matchKey: string) => void;
}

function UpcomingMatchCard({ matchKey, tba, tbaTeams, homeTeamKey, onMatchClick }: UpcomingMatchCardProps) {
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
        <span className="text-sm font-semibold text-foreground">{formatMatchKey(matchKey)}</span>
        <span className="text-xs text-muted-foreground">{formatTime(tba.est_time)}</span>
      </div>

      {/* Alliances: red stack left, blue stack right */}
      <div className="flex gap-2 px-3 py-2.5">
        <div className="flex-1 flex flex-col gap-1.5">
          {tba.redTeams.map((team) => (
            <div
              key={team}
              className={[
                "flex items-center justify-between px-2 py-1.5 rounded bg-destructive/15 border border-destructive/30",
                team === homeTeamKey ? "ring-1 ring-primary" : "",
              ].join(" ")}
            >
              <span className="text-sm font-bold text-destructive">{team.replace("frc", "")}</span>
              {getRank(team) > 0 && (
                <span className="text-[10px] text-destructive/60">#{getRank(team)}</span>
              )}
            </div>
          ))}
        </div>
        <div className="flex-1 flex flex-col gap-1.5">
          {tba.blueTeams.map((team) => (
            <div
              key={team}
              className={[
                "flex items-center justify-between px-2 py-1.5 rounded bg-chart-1/15 border border-chart-1/30",
                team === homeTeamKey ? "ring-1 ring-primary" : "",
              ].join(" ")}
            >
              <span className="text-sm font-bold text-chart-1">{team.replace("frc", "")}</span>
              {getRank(team) > 0 && (
                <span className="text-[10px] text-chart-1/60">#{getRank(team)}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Win probability bar */}
      {winProb != null && (
        <div className="px-3 pb-2.5 space-y-0.5">
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
  );
}

export function RightPanel({ tbaTeams, tbaSchedule }: RightPanelProps) {
  const { homeTeam, setHomeTeam } = useDesktopEvent();
  const { addTab } = useTabContext();
  const navigate = useNavigate();
  const [showEditTeam, setShowEditTeam] = useState(false);
  const [editTeamInput, setEditTeamInput] = useState("");
  const [savingTeam, setSavingTeam] = useState(false);
  const [clockTick, setClockTick] = useState(0);

  useEffect(() => {
    const i = setInterval(() => setClockTick((t) => t + 1), 30_000);
    return () => clearInterval(i);
  }, []);

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

  // Upcoming matches — next few across the whole event.
  // Uses est_time when available; falls back to match-number order + score
  // presence so cards still render when offline (est_time not yet synced).
  const upcomingMatches = useMemo(() => {
    const now = Date.now() / 1000;
    const hasEstTime = Object.values(tbaSchedule).some((tba) => tba.est_time > 0);
    let keys: string[];
    if (hasEstTime) {
      keys = Object.keys(tbaSchedule).filter((key) => {
        const tba = tbaSchedule[key];
        return tba?.est_time != null && tba.est_time > now - 120;
      });
      keys.sort((a, b) => (tbaSchedule[a]?.est_time ?? 0) - (tbaSchedule[b]?.est_time ?? 0));
    } else {
      // Offline: show first unplayed matches sorted by match number
      keys = Object.keys(tbaSchedule).filter((key) => {
        const tba = tbaSchedule[key];
        return tba != null && (tba.redScore == null || tba.redScore < 0);
      });
      keys.sort((a, b) => matchSortKey(a) - matchSortKey(b));
    }
    return keys.slice(0, 5);
  }, [tbaSchedule, clockTick]);

  // Next/last match for home team — derived from tbaSchedule so it updates in
  // lockstep with the upcoming list (same data source).
  // Falls back to match-number + score-based logic when offline (no est_time).
  const homeNextLastMatch = useMemo(() => {
    if (!homeTeamKey) return { nextMatch: null, lastMatch: null };
    const teamMatches = Object.entries(tbaSchedule).filter(
      ([, tba]) => tba.redTeams.includes(homeTeamKey) || tba.blueTeams.includes(homeTeamKey)
    );
    if (teamMatches.length === 0) return { nextMatch: null, lastMatch: null };

    const now = Date.now() / 1000;
    const hasEstTime = teamMatches.some(([, tba]) => tba.est_time > 0);

    if (hasEstTime) {
      const sorted = [...teamMatches].sort(([, a], [, b]) => (a.est_time ?? 0) - (b.est_time ?? 0));
      const nextIdx = sorted.findIndex(([, tba]) => tba.est_time > now - 120);
      return {
        nextMatch: nextIdx !== -1 ? sorted[nextIdx][0] : null,
        lastMatch:
          nextIdx > 0
            ? sorted[nextIdx - 1][0]
            : nextIdx === -1 && sorted.length > 0
              ? sorted[sorted.length - 1][0]
              : null,
      };
    }

    // Offline fallback: sort by match number, detect played via scores
    const sorted = [...teamMatches].sort(([a], [b]) => matchSortKey(a) - matchSortKey(b));
    const lastPlayedIdx = sorted.reduce(
      (acc, [, tba], idx) => (tba.redScore != null && tba.redScore >= 0 ? idx : acc),
      -1
    );
    const firstUnplayedIdx = sorted.findIndex(([, tba]) => tba.redScore == null || tba.redScore < 0);
    return {
      nextMatch: firstUnplayedIdx >= 0 ? sorted[firstUnplayedIdx][0] : null,
      lastMatch: lastPlayedIdx >= 0 ? sorted[lastPlayedIdx][0] : null,
    };
  }, [homeTeamKey, tbaSchedule, clockTick]);

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
        {homeNextLastMatch.lastMatch && (
          <div
            className="bg-card rounded-lg border border-border p-3 cursor-pointer hover:bg-secondary/30 transition-colors"
            onClick={() => handleMatchClick(homeNextLastMatch.lastMatch!)}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">Last Match</span>
              <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <p className="text-xl font-bold text-foreground mt-1">
              {formatMatchKey(homeNextLastMatch.lastMatch)}
            </p>
            <p className="text-xs text-muted-foreground">{formatMatchLabel(homeNextLastMatch.lastMatch)}</p>
          </div>
        )}

        {/* Next Match */}
        {homeNextLastMatch.nextMatch && (
          <div
            className="bg-card rounded-lg border border-border p-3 cursor-pointer hover:bg-secondary/30 transition-colors"
            onClick={() => handleMatchClick(homeNextLastMatch.nextMatch!)}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">Next Match</span>
              <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <p className="text-xl font-bold text-primary mt-1">
              {formatMatchKey(homeNextLastMatch.nextMatch)}
            </p>
            <p className="text-xs text-muted-foreground">{formatMatchLabel(homeNextLastMatch.nextMatch)}</p>
          </div>
        )}

        {/* Upcoming Matches */}
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-4">
            <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-sm font-semibold text-foreground">Upcoming Matches</span>
          </div>

          {upcomingMatches.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No upcoming matches</p>
          ) : (
            <div className="space-y-4">
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
