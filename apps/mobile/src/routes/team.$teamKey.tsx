import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Button } from "@shadcn/ui/components/button.tsx";
import { Badge } from "@shadcn/ui/components/badge.tsx";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@shadcn/ui/components/carousel.tsx";
import { getEventTeamData } from "@lib/db";
import { useEvent } from "@lib/context/EventContext";
import type { EventTeamData } from "@lib/db";

export const Route = createFileRoute("/team/$teamKey")({
  component: TeamDetailsPage,
});

function TeamDetailsPage() {
  const navigate = useNavigate();
  const { teamKey } = Route.useParams();
  const { currentEvent } = useEvent();
  const [view, setView] = useState<"pit" | "match">("pit");
  const [pitData, setPitData] = useState<EventTeamData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchTeamData() {
      if (!currentEvent) {
        setLoading(false);
        return;
      }

      try {
        const allTeamData = await getEventTeamData(currentEvent);
        const teamData = allTeamData.find((t) => t.team === teamKey);

        if (teamData) {
          setPitData(teamData);
        }
      } catch (error) {
        console.error("Error fetching team data:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchTeamData();
  }, [teamKey, currentEvent]);

  const teamNum = teamKey?.replace("frc", "");
  const data = pitData?.data;

  return (
    <div className="flex min-h-dvh w-full flex-col bg-background px-6 py-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => navigate({ to: "/pit" })}
          className="text-primary"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-6"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M15 18L9 12L15 6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <p className="text-base flex-1 text-center">
          <span className="font-bold text-primary">{teamNum}</span>
          {pitData?.team_name && (
            <span className="text-foreground"> | {pitData.team_name}</span>
          )}
        </p>
        <button className="text-primary size-6">
          <svg
            viewBox="0 0 24 24"
            className="size-6"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {/* Divider */}
      <div className="h-px w-full bg-border mb-6" />

      {/* View Switcher */}
      <div className="flex gap-2 mb-6">
        <Button
          onClick={() => setView("pit")}
          variant={view === "pit" ? "default" : "outline"}
          className="flex-1"
        >
          Pit
        </Button>
        <Button
          onClick={() => setView("match")}
          variant={view === "match" ? "default" : "outline"}
          className="flex-1"
        >
          Match
        </Button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <span className="text-muted-foreground">Loading...</span>
        </div>
      ) : view === "pit" ? (
        <div className="flex flex-col gap-6 pb-6">
          {data?.image_urls && data.image_urls.length > 0 ? (
            <div className="w-full">
              <Carousel className="w-full">
                <CarouselContent>
                  {data.image_urls.map((url: string, index: number) => (
                    <CarouselItem key={index}>
                      <div className="relative w-full aspect-video">
                        <img
                          src={url}
                          alt={`Team ${teamNum} - Photo ${index + 1}`}
                          crossOrigin="anonymous"
                          className="w-full h-full object-cover rounded-lg"
                        />
                      </div>
                    </CarouselItem>
                  ))}
                </CarouselContent>
                <CarouselPrevious />
                <CarouselNext />
              </Carousel>
            </div>
          ) : (
            <div className="w-full aspect-video bg-muted rounded-lg flex items-center justify-center">
              <span className="text-muted-foreground">No images available</span>
            </div>
          )}

          {/* Rating */}
          {data?.rating && (
            <div className="flex flex-col gap-2">
              <h3 className="text-md text-primary font-light">Rating</h3>
              <Badge variant="secondary" className="text-lg px-4 py-2">
                {data.rating}/5
              </Badge>
            </div>
          )}

          {/* Notes */}
          {data?.notes && (
            <div className="flex flex-col gap-2">
              <h3 className="text-md text-primary font-light">Notes</h3>
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="text-sm text-foreground whitespace-pre-wrap">
                  {data.notes}
                </p>
              </div>
            </div>
          )}

          {/* Movement */}
          {data?.movement && (
            <div className="flex flex-col gap-2">
              <h3 className="text-md text-primary font-light">Movement</h3>
              <div className="flex gap-2">
                {data.movement.depot && (
                  <Badge variant="outline">Depot</Badge>
                )}
                {data.movement.trough && (
                  <Badge variant="outline">Trough</Badge>
                )}
              </div>
            </div>
          )}

          {/* Intake */}
          {data?.intake && (
            <div className="flex flex-col gap-2">
              <h3 className="text-md text-primary font-light">Intake</h3>
              <div className="flex flex-wrap gap-2">
                {data.intake.ground && (
                  <Badge variant="outline">Ground</Badge>
                )}
                {data.intake.station && (
                  <Badge variant="outline">Station</Badge>
                )}
                {data.intake.depot && (
                  <Badge variant="outline">Depot</Badge>
                )}
                {data.intake.stocking && (
                  <Badge variant="outline">Stocking</Badge>
                )}
              </div>
            </div>
          )}

          {/* Fuel */}
          {data?.fuel && (
            <div className="flex flex-col gap-2">
              <h3 className="text-md text-primary font-light">Fuel</h3>
              <div className="flex gap-2">
                {data.fuel.shootMoving && (
                  <Badge variant="outline">Shoot Moving</Badge>
                )}
                {data.fuel.passing && (
                  <Badge variant="outline">Passing</Badge>
                )}
              </div>
            </div>
          )}

          {/* Climb */}
          {data?.climb && (
            <div className="flex flex-col gap-2">
              <h3 className="text-md text-primary font-light">Climb</h3>
              <div className="flex flex-wrap gap-2">
                {data.climb.level && (
                  <Badge variant="outline">Level: {data.climb.level}</Badge>
                )}
                {data.climb.left && (
                  <Badge variant="outline">Left</Badge>
                )}
                {data.climb.right && (
                  <Badge variant="outline">Right</Badge>
                )}
                {data.climb.declimb && (
                  <Badge variant="outline">Declimb</Badge>
                )}
              </div>
            </div>
          )}

          {/* Autos */}
          {data?.autos && data.autos.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-md text-primary font-light">Autos</h3>
              <div className="flex flex-col gap-2">
                {data.autos.map((auto: { id?: number; climb?: boolean }, index: number) => (
                  <div
                    key={auto.id || index}
                    className="rounded-lg border border-border bg-card p-3"
                  >
                    <span className="text-sm">
                      Auto {index + 1}
                      {auto.climb && (
                        <Badge variant="secondary" className="ml-2">
                          Climb
                        </Badge>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!data && (
            <div className="flex items-center justify-center py-12">
              <span className="text-muted-foreground">
                No pit data available for this team
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 gap-4">
          <div className="w-24 h-24 rounded-full bg-yellow-500/20 flex items-center justify-center">
            <svg
              viewBox="0 0 24 24"
              className="size-12 text-yellow-500"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M3 3v18h18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M18 9l-5 5-4-4-3 3"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <span className="text-lg text-muted-foreground">
            Match data coming soon
          </span>
        </div>
      )}
    </div>
  );
}
