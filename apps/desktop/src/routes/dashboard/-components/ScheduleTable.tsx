import { useMemo } from "react";
import type { ScheduleEntry, TBAMatchData } from "../../../contexts/DesktopCompetitionDataContext";
import type { TBATeam } from "../../../contexts/DesktopTeamDataContext";

interface ScheduleTableProps {
  schedule: ScheduleEntry[];
  tbaSchedule: Record<string, TBAMatchData>;
  tbaTeams: TBATeam[];
  searchQuery: string;
  homeTeamKey: string; // e.g. "frc846"
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
}: {
  teamKey: string;
  tbaTeams: TBATeam[];
  q25: number;
  q75: number;
  isHome: boolean;
}) {
  const team = tbaTeams.find((t) => t.key === teamKey);
  const epa = team?.epa?.total_points?.mean;
  const teamNum = teamKey.replace("frc", "");

  let chipClass = "bg-secondary/60 text-foreground";
  if (epa != null) {
    if (epa >= q75) chipClass = "bg-chart-2/20 text-chart-2 border border-chart-2/30";
    else if (epa <= q25) chipClass = "bg-chart-5/20 text-chart-5 border border-chart-5/30";
  }

  return (
    <span
      className={[
        "inline-flex items-center px-2 py-0.5 rounded text-xs font-bold transition-colors",
        chipClass,
        isHome ? "ring-1 ring-primary ring-offset-1 ring-offset-background" : "",
      ].join(" ")}
      title={team?.name}
    >
      {teamNum}
    </span>
  );
}

function formatTime(estTime: number | undefined): string {
  if (!estTime) return "";
  const d = new Date(estTime * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ScheduleTable({
  schedule,
  tbaSchedule,
  tbaTeams,
  searchQuery,
  homeTeamKey,
}: ScheduleTableProps) {
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
      const hasActualScore = redScore != null && blueScore != null;
      const predictedRed = tba?.predicted_red_score ?? null;
      const predictedBlue = tba?.predicted_blue_score ?? null;
      const hasPrediction = predictedRed != null && predictedBlue != null;

      const estTime = tba?.est_time ?? entries[0]?.est_time;

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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Sticky header */}
      <div className="grid grid-cols-[100px_1fr_8px_1fr_160px] gap-0 px-3 py-2 border-b border-border bg-card/50 flex-shrink-0">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Match</span>
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide text-center">Red Alliance</span>
        <span />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide text-center">Blue Alliance</span>
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right">Results</span>
      </div>

      {/* Scrollable rows */}
      <div className="flex-1 overflow-y-auto">
        {filteredRows.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
            {searchQuery ? "No matches found" : "No schedule data"}
          </div>
        ) : (
          filteredRows.map((row) => (
            <div
              key={row.matchKey}
              className="grid grid-cols-[100px_1fr_8px_1fr_160px] gap-0 items-center px-3 py-2 border-b border-border/50 hover:bg-secondary/20 transition-colors"
            >
              {/* Match label + time */}
              <div className="flex flex-col">
                <span className="text-xs font-semibold text-foreground">{row.label}</span>
                {row.estTime ? (
                  <span className="text-[10px] text-muted-foreground">{formatTime(row.estTime)}</span>
                ) : null}
              </div>

              {/* Red Alliance */}
              <div className="flex items-center justify-center gap-1.5 pr-2">
                {row.redTeams.map((team) => (
                  <TeamChip
                    key={team}
                    teamKey={team}
                    tbaTeams={tbaTeams}
                    q25={q25}
                    q75={q75}
                    isHome={team === homeTeamKey}
                  />
                ))}
              </div>

              {/* Alliance divider */}
              <div className="h-full flex items-stretch">
                <div className="w-0.5 bg-border mx-auto h-full" />
              </div>

              {/* Blue Alliance */}
              <div className="flex items-center justify-center gap-1.5 pl-2">
                {row.blueTeams.map((team) => (
                  <TeamChip
                    key={team}
                    teamKey={team}
                    tbaTeams={tbaTeams}
                    q25={q25}
                    q75={q75}
                    isHome={team === homeTeamKey}
                  />
                ))}
              </div>

              {/* Results */}
              <div className="flex items-center justify-end gap-1.5">
                {row.hasActualScore ? (
                  <>
                    <span className="px-2 py-0.5 rounded text-xs font-bold bg-destructive/70 text-destructive-foreground">
                      {row.redScore}
                    </span>
                    <span className="px-2 py-0.5 rounded text-xs font-bold bg-chart-1/70 text-foreground">
                      {row.blueScore}
                    </span>
                  </>
                ) : row.hasPrediction ? (
                  <>
                    <span className="px-2 py-0.5 rounded text-xs font-medium border border-destructive/60 text-destructive/80">
                      ~{Math.round(row.predictedRed!)}
                    </span>
                    <span className="px-2 py-0.5 rounded text-xs font-medium border border-chart-1/60 text-chart-1/80">
                      ~{Math.round(row.predictedBlue!)}
                    </span>
                  </>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
