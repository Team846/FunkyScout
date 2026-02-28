import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { useDesktopEvent } from "../contexts/DesktopEventContext";
import { useDesktopCompetitionData } from "../contexts/DesktopCompetitionDataContext";
import { useDesktopTeamData } from "../contexts/DesktopTeamDataContext";
import { getPitScoutingData, type PitScoutingData } from "../lib/db";
import { useTabContext } from "../contexts/TabContext";

export const Route = createFileRoute("/team")({
  component: TeamPage,
  validateSearch: (search: Record<string, unknown>) => ({
    team: (search.team as string) || "",
  }),
});

// ─── Drawing types (mirrored from matches.tsx) ────────────────────────────────
type PathPoint = { x: number; y: number };
type PathSegment = { points: PathPoint[]; color?: string; lineWidth?: number };
type DrawingData = {
  paths: PathSegment[];
  canvasWidth: number;
  canvasHeight: number;
};

type TeamAutoDisplay = {
  name?: string;
  description?: string;
  drawing?: DrawingData | null;
  climbDuringAuto?: boolean;
};

const FIELD_IMG_WIDTH = 326;
const FIELD_IMG_HEIGHT = 318;

function AutoPathPreview({
  drawing,
  className,
}: {
  drawing: DrawingData;
  className?: string;
}) {
  const { paths, canvasWidth, canvasHeight } = drawing;
  const cropH = FIELD_IMG_WIDTH * (2 / 3);
  const cropY = (FIELD_IMG_HEIGHT - cropH) / 2;
  const scaleX = FIELD_IMG_WIDTH / canvasWidth;
  const scaleY = cropH / canvasHeight;
  return (
    <div className={`relative w-full overflow-hidden rounded-lg ${className || ""}`}>
      <img src="/red_field.svg" alt="Field" className="block w-full h-auto max-w-full max-h-full" />
      <svg
        viewBox={`0 0 ${FIELD_IMG_WIDTH} ${FIELD_IMG_HEIGHT}`}
        className="absolute inset-0 w-full h-full"
        preserveAspectRatio="xMidYMid meet"
        style={{ pointerEvents: "none" }}
      >
        <g transform={`translate(0, ${cropY}) scale(${scaleX}, ${scaleY})`}>
          {paths.map((path, pathIndex) => {
            if (!path.points || path.points.length < 2) return null;
            const actualPoints = path.points.map((p) => ({
              x: p.x * canvasWidth,
              y: p.y * canvasHeight,
            }));
            const pathData = actualPoints
              .map((point, i) => (i === 0 ? `M ${point.x} ${point.y}` : `L ${point.x} ${point.y}`))
              .join(" ");
            return (
              <path
                key={pathIndex}
                d={pathData}
                stroke={path.color || "#ef4444"}
                strokeWidth={(path.lineWidth ?? 3) * Math.max(scaleX, scaleY)}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })}
        </g>
      </svg>
    </div>
  );
}

function getTeamAutos(pitData: PitScoutingData | undefined): TeamAutoDisplay[] {
  const raw = (pitData?.data as { autos?: unknown[] })?.autos ?? [];
  if (!Array.isArray(raw)) return [];
  return raw.map((a) => {
    const item = a as Record<string, unknown>;
    const drawing = item.drawing as DrawingData | null | undefined;
    return {
      name: (item.name as string | undefined) ?? undefined,
      description: (item.description as string | undefined) ?? undefined,
      drawing: drawing && Array.isArray(drawing.paths) ? drawing : undefined,
      climbDuringAuto: (item.climbDuringAuto ?? item.climb ?? false) as boolean,
    };
  });
}

function TeamPage() {
  const { closeTab } = useTabContext();
  const { team: teamKey } = Route.useSearch();
  const { currentEvent } = useDesktopEvent();
  const { lastDataRefreshAt } = useDesktopCompetitionData();
  const { tbaTeams } = useDesktopTeamData();

  const [pitData, setPitData] = useState<PitScoutingData[]>([]);

  useEffect(() => {
    if (!currentEvent) return;
    getPitScoutingData(currentEvent).then(setPitData).catch(console.error);
  }, [currentEvent, lastDataRefreshAt]);

  const teamPitData = useMemo(() => pitData.find((p) => p.team === teamKey), [pitData, teamKey]);
  const tbaTeam = useMemo(() => tbaTeams.find((t) => t.key === teamKey), [tbaTeams, teamKey]);
  const teamNum = teamKey.replace("frc", "");
  const autos = useMemo(() => getTeamAutos(teamPitData), [teamPitData]);

  const handleBack = useCallback(() => {
    closeTab(`team-${teamKey}`);
  }, [closeTab, teamKey]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border flex-shrink-0">
        <button
          onClick={handleBack}
          className="p-1.5 rounded hover:bg-secondary text-muted-foreground transition-colors flex-shrink-0"
          title="Close team view"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <span className="text-2xl font-bold text-primary flex-shrink-0">{teamNum}</span>
        {tbaTeam?.name && (
          <span className="text-sm text-muted-foreground truncate">{tbaTeam.name}</span>
        )}

        <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
          {tbaTeam?.rank != null && tbaTeam.rank > 0 && (
            <span className="text-xs text-muted-foreground bg-secondary/60 px-2 py-0.5 rounded">
              Rank #{tbaTeam.rank}
            </span>
          )}
          {tbaTeam?.epa?.total_points?.mean != null && (
            <span className="text-xs text-muted-foreground bg-secondary/60 px-2 py-0.5 rounded">
              {tbaTeam.epa.total_points.mean.toFixed(1)} EPA
            </span>
          )}
          {teamPitData?.name && (
            <span className="text-xs bg-primary/15 text-primary px-2 py-0.5 rounded">
              Scouted by {teamPitData.name}
            </span>
          )}
          {!teamPitData && (
            <span className="text-xs bg-muted/50 text-muted-foreground/50 px-2 py-0.5 rounded">
              Not pit scouted
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 min-h-0">
        {!teamPitData ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground">
            <span className="text-sm">No pit scouting data for Team {teamNum}</span>
          </div>
        ) : (
          <div className="space-y-6 max-w-4xl">
            {/* Autonomous routines */}
            <div>
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Autonomous Routines {autos.length > 0 && `(${autos.length})`}
              </h2>
              {autos.length === 0 ? (
                <p className="text-sm text-muted-foreground">No autonomous routines recorded</p>
              ) : (
                <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
                  {autos.map((auto, i) => (
                    <div
                      key={i}
                      className="border border-border rounded-lg bg-card overflow-hidden"
                    >
                      {auto.drawing ? (
                        <AutoPathPreview drawing={auto.drawing} className="w-full" />
                      ) : (
                        <div className="h-28 bg-muted/30 flex items-center justify-center text-muted-foreground text-xs">
                          No drawing
                        </div>
                      )}
                      <div className="p-2.5 space-y-1">
                        <p className="text-sm font-semibold text-foreground">
                          {auto.name || `Auto ${i + 1}`}
                        </p>
                        {auto.description && (
                          <p className="text-xs text-muted-foreground leading-snug">{auto.description}</p>
                        )}
                        {auto.climbDuringAuto && (
                          <p className="text-xs text-primary font-medium">Climbs during auto</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
