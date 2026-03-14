import { useMemo, useRef, useImperativeHandle, forwardRef } from "react";
import type { ScheduleEntry, TBAMatchData } from "../../../contexts/DesktopCompetitionDataContext";
import type { TBATeam } from "../../../contexts/DesktopTeamDataContext";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@shadcn/ui/components/tooltip.tsx";

export interface ScheduleTableHandle {
  scrollToLastCompleted: () => void;
  scrollToCurrentMatch: () => void;
}

interface ScheduleTableProps {
  schedule: ScheduleEntry[];
  tbaSchedule: Record<string, TBAMatchData>;
  tbaTeams: TBATeam[];
  searchQuery: string;
  homeTeamKey: string; // e.g. "frc846"
  onMatchClick?: (matchKey: string) => void;
  onTeamClick?: (teamKey: string) => void;
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

function sortMatchKeys(a: string, b: string): number {
  // Sort by type first: qm < sf < f
  const typeOrder = (key: string) =>
    key.includes("_qm") ? 0 : key.includes("_sf") ? 1 : key.includes("_f") ? 2 : 3;
  const diff = typeOrder(a) - typeOrder(b);
  if (diff !== 0) return diff;
  const numA = parseInt(a.match(/(\d+)$|_qm(\d+)/)?.[1] ?? a.match(/_qm(\d+)/)?.[1] ?? "0");
  const numB = parseInt(b.match(/(\d+)$|_qm(\d+)/)?.[1] ?? b.match(/_qm(\d+)/)?.[1] ?? "0");
  return numA - numB;
}

function useEpaColors(tbaTeams: TBATeam[]) {
  return useMemo(() => {
    const epas = tbaTeams
      .map((t) => t.epa?.total_points?.mean)
      .filter((e): e is number => e != null && e > 0)
      .sort((a, b) => a - b);

    if (epas.length < 4) return { q25: -Infinity, q75: Infinity };

    const q25 = epas[Math.floor(epas.length * 0.25)];
    const q75 = epas[Math.floor(epas.length * 0.75)];
    return { q25, q75 };
  }, [tbaTeams]);
}

function TeamChip({
  teamKey,
  tbaTeams,
  q25,
  q75,
  isHome,
  scouterName,
  onClick,
}: {
  teamKey: string;
  tbaTeams: TBATeam[];
  q25: number;
  q75: number;
  isHome: boolean;
  scouterName?: string;
  onClick?: () => void;
}) {
  const team = tbaTeams.find((t) => t.key === teamKey);
  const epa = team?.epa?.total_points?.mean;
  const teamNum = teamKey?.replace("frc", "");

  let chipClass = "bg-secondary/60 text-foreground/80";
  if (isHome) {
    chipClass = "bg-primary/75 text-foreground/80";
  } else if (epa != null) {
    if (epa >= q75) chipClass = "bg-chart-2/40 text-chart-2";
    else if (epa <= q25) chipClass = "bg-chart-5/40 text-chart-5";
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          onClick={onClick ? (e) => { e.stopPropagation(); onClick(); } : undefined}
          className={[
            "inline-flex items-center justify-center min-w-[56px] px-2.5 py-2 rounded text-xs font-bold transition-colors tabular-nums",
            chipClass,
            onClick ? "cursor-pointer hover:ring-1 hover:ring-primary/60 hover:brightness-110" : "",
          ].join(" ")}
        >
          {teamNum}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="bg-muted text-foreground/80 border border-border flex flex-col gap-0.5 [&>svg]:fill-muted [&>svg]:bg-muted">
        <span className="font-semibold">{team?.name || `Team ${teamNum}`}</span>
        {scouterName && (
          <span className="text-muted-foreground">Scouter: {scouterName}</span>
        )}
        {!scouterName && (
          <span className="text-muted-foreground italic">No scouter assigned</span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

function formatTime(estTime: number | undefined): string {
  if (!estTime) return "";
  const d = new Date(estTime * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export const ScheduleTable = forwardRef<ScheduleTableHandle, ScheduleTableProps>(
  function ScheduleTable(
    { schedule, tbaSchedule, tbaTeams, searchQuery, homeTeamKey, onMatchClick, onTeamClick },
    ref
  ) {
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const { q25, q75 } = useEpaColors(tbaTeams);

    const matchRows = useMemo(() => {
    // Get unique match keys
    const allKeys = [...new Set(schedule.map((s) => s.match))];
    allKeys.sort(sortMatchKeys);

    return allKeys.map((matchKey) => {
      const entries = schedule.filter((s) => s.match === matchKey);
      const redTeams = entries.filter((e) => e.alliance === "red").map((e) => e.team);
      const blueTeams = entries.filter((e) => e.alliance === "blue").map((e) => e.team);
      const tba = tbaSchedule[matchKey];

      const redScore = tba?.redScore ?? null;
      const blueScore = tba?.blueScore ?? null;
      const hasActualScore = (redScore ?? -1) >= 0 && (blueScore ?? -1) >= 0;
      const predictedRed = tba?.predicted_red_score ?? null;
      const predictedBlue = tba?.predicted_blue_score ?? null;
      const hasPrediction = predictedRed != null && predictedBlue != null;

      const estTime = tba?.est_time ?? entries[0]?.est_time;
      // Match is considered completed if it has actual scores, OR if its estimated
      // time was more than 2 minutes ago (mirrors RightPanel's time-based logic so
      // the yellow line stays in sync with the "current match" indicator).
      const isLikelyCompleted =
        hasActualScore || (estTime != null && estTime > 0 && estTime < Date.now() / 1000 - 120);

      return {
        matchKey,
        label: formatMatchKey(matchKey),
        fullLabel: formatMatchLabel(matchKey),
        redTeams,
        blueTeams,
        estTime,
        redScore,
        blueScore,
        hasActualScore,
        isLikelyCompleted,
        predictedRed,
        predictedBlue,
        hasPrediction,
      };
    });
  }, [schedule, tbaSchedule]);

  const filteredRows = useMemo(() => {
    if (!searchQuery.trim()) return matchRows;
    const q = searchQuery.toLowerCase().replace(/[^0-9a-z]/g, "");
    return matchRows.filter((row) => {
      const label = row.label.toLowerCase().replace(/[^0-9a-z]/g, "");
      return label.includes(q);
    });
  }, [matchRows, searchQuery]);

  // Find the last completed match index for scrolling and yellow line placement.
  // Uses isLikelyCompleted (time-based) so it stays in sync with the RightPanel
  // "current match" indicator even before TBA posts actual scores.
  const lastCompletedIndex = useMemo(() => {
    for (let i = filteredRows.length - 1; i >= 0; i--) {
      if (filteredRows[i].isLikelyCompleted) return i;
    }
    return -1;
  }, [filteredRows]);

  useImperativeHandle(ref, () => ({
    scrollToLastCompleted: () => {
      if (lastCompletedIndex < 0 || !scrollContainerRef.current) return;
      const container = scrollContainerRef.current;
      const rows = container.querySelectorAll("[data-match-row]");
      const targetRow = rows[lastCompletedIndex] as HTMLElement;
      if (targetRow) {
        targetRow.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    },
    scrollToCurrentMatch: () => {
      if (!scrollContainerRef.current || filteredRows.length === 0) return;
      const container = scrollContainerRef.current;
      const rows = container.querySelectorAll("[data-match-row]");
      // Target: first upcoming (after last completed); if none completed, first row
      const targetIdx = lastCompletedIndex === -1
        ? 0
        : Math.min(lastCompletedIndex + 1, filteredRows.length - 1);
      const targetRow = rows[targetIdx] as HTMLElement;
      if (targetRow) {
        targetRow.scrollIntoView({ behavior: "instant", block: "center" });
      }
    },
  }), [lastCompletedIndex, filteredRows.length]);

  return (
    <div className="flex flex-col h-full overflow-hidden relative">
      {/* Sticky header */}
      <div className="grid grid-cols-[100px_1fr_8px_1fr_180px] gap-0 px-3 py-3 bg-card/50 flex-shrink-0 relative z-10 border-b border-border/50">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Match</span>
        <span className="text-xs font-semibold text-destructive uppercase tracking-wide text-center">Red Alliance</span>
        <span />
        <span className="text-xs font-semibold text-chart-1 uppercase tracking-wide text-center">Blue Alliance</span>
        <span className="text-xs font-semibold text-primary uppercase tracking-wide text-center">Results</span>
      </div>

      {/* Scrollable area */}
      <div className="flex-1 overflow-hidden relative">
        {/* Scrollable rows */}
        <div ref={scrollContainerRef} className="h-full overflow-y-auto">
          {filteredRows.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
              {searchQuery ? "No matches found" : "No schedule data"}
            </div>
          ) : (
            filteredRows.map((row, index) => {
              const isLastCompleted = index === lastCompletedIndex;
              return (
              <div
                key={row.matchKey}
                data-match-row
                className={[
                  "grid grid-cols-[100px_1fr_8px_1fr_180px] gap-0 items-center px-3 py-2.5 hover:bg-secondary/20 transition-colors",
                  isLastCompleted ? "border-b-2 border-primary" : "border-b border-border/50",
                ].join(" ")}
              >
                {/* Match label + time */}
                <div
                  className={`flex flex-col px-3 py-1 rounded-md bg-primary/5 border-l-2 border-muted-foreground/40 ${onMatchClick ? "cursor-pointer hover:bg-primary/15 hover:border-primary/60 transition-colors" : ""}`}
                  onClick={onMatchClick ? () => onMatchClick(row.matchKey) : undefined}
                  onKeyDown={onMatchClick ? (e) => e.key === "Enter" && onMatchClick(row.matchKey) : undefined}
                  role={onMatchClick ? "button" : undefined}
                  tabIndex={onMatchClick ? 0 : undefined}
                  title={onMatchClick ? `View ${row.fullLabel}` : undefined}
                >
                  <span className="text-xs font-semibold text-foreground/80">{row.label}</span>
                  {row.estTime ? (
                    <span className="text-[10px] text-muted-foreground">{formatTime(row.estTime)}</span>
                  ) : null}
                </div>

                {/* Red Alliance */}
                <div className="flex items-center justify-center gap-3 px-3 py-1 rounded-md bg-destructive/5 border-l-2 border-destructive/40">
                  {row.redTeams.map((team) => {
                    const entry = schedule.find((s) => s.match === row.matchKey && s.team === team);
                    return (
                      <TeamChip
                        key={team}
                        teamKey={team}
                        tbaTeams={tbaTeams}
                        q25={q25}
                        q75={q75}
                        isHome={team === homeTeamKey}
                        scouterName={entry?.name}
                        onClick={onTeamClick ? () => onTeamClick(team) : undefined}
                      />
                    );
                  })}
                </div>

                {/* Alliance divider */}
                <div />

                {/* Blue Alliance */}
                <div className="flex items-center justify-center gap-3 px-3 py-1 rounded-md bg-chart-1/5 border-l-2 border-chart-1/40">
                  {row.blueTeams.map((team) => {
                    const entry = schedule.find((s) => s.match === row.matchKey && s.team === team);
                    return (
                      <TeamChip
                        key={team}
                        teamKey={team}
                        tbaTeams={tbaTeams}
                        q25={q25}
                        q75={q75}
                        isHome={team === homeTeamKey}
                        scouterName={entry?.name}
                        onClick={onTeamClick ? () => onTeamClick(team) : undefined}
                      />
                    );
                  })}
                </div>

                {/* Results */}
                <div className="flex items-center justify-center gap-3 px-3 py-1 rounded-md bg-primary/5 border-l-2 border-primary/40">
                  {row.hasActualScore ? (() => {
                    const redWon = row.redScore! > row.blueScore!;
                    const blueWon = row.blueScore! > row.redScore!;
                    return (
                      <>
                        <span className={`min-w-[44px] text-center px-2 py-2 rounded text-xs font-bold tabular-nums ${
                          redWon ? "bg-destructive/70 text-destructive-foreground/70" : "bg-destructive/40 text-destructive/70"
                        }`}>
                          {row.redScore}
                        </span>
                        <span className={`min-w-[44px] text-center px-2 py-2 rounded text-xs font-bold tabular-nums ${
                          blueWon ? "bg-chart-1/70 text-foreground/60" : "bg-chart-1/40 text-chart-1/70"
                        }`}>
                          {row.blueScore}
                        </span>
                      </>
                    );
                  })() : row.hasPrediction ? (
                    <>
                      <span className="min-w-[44px] text-center px-2 py-2 rounded text-xs font-medium border border-destructive/60 text-destructive/80 tabular-nums">
                        {Math.round(row.predictedRed!)}
                      </span>
                      <span className="min-w-[44px] text-center px-2 py-2 rounded text-xs font-medium border border-chart-1/60 text-chart-1/80 tabular-nums">
                        {Math.round(row.predictedBlue!)}
                      </span>
                    </>
                  ) : null}
                </div>
              </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
});
