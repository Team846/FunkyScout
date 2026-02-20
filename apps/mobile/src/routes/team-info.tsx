import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@shadcn/ui/components/button.tsx";
import { Input } from "@shadcn/ui/components/input.tsx";
import { Textarea } from "@shadcn/ui/components/textarea.tsx";
import { Toggle } from "@shadcn/ui/components/toggle.tsx";
import { toast } from "sonner";
import { useEvent } from "@lib/context/EventContext";
import { getEventMatchData, getEventTeamData, getEventSchedule, cacheEventTeamData, type EventMatchData } from "@lib/db";
import { getImageUrl } from "@lib/storage/uploads";
import { putTeamData } from "@lib/data/writes";
import { getSession } from "@lib/supabase/auth";
import { AutoPathDisplay } from "../components/AutoPathDisplay";
import { AutoPathDrawer } from "../components/auto-path-drawer/AutoPathDrawer";
import { MatchScoutingTab } from "../components/MatchScoutingTab";
import type { DrawingData } from "../components/auto-path-drawer/types";
import { Dialog, DialogContent } from "@shadcn/ui/components/dialog.js";
import { calculateSingleMatchStats } from "@lib/data/matchStats"


type TeamInfoSearch = {
  teamKey?: string;
};

export const Route = createFileRoute("/team-info")({
  component: TeamInfoPage,
  validateSearch: (search: Record<string, unknown>): TeamInfoSearch => ({
    teamKey: search.teamKey as string | undefined,
  }),
});

interface PitData {
  teamNum: number;
  teamName: string;
  movement: {
    bump: boolean;
    trough: boolean;
  };
  intake: {
    ground: boolean;
    station: boolean;
    stocking: boolean;
  };
  fuel: {
    shootMoving: boolean;
    passing: boolean;
    bps?: string;
    capacity?: string;
  };
  autoClimb: {
    level: string | null;
    orientation?: string | null;
    declimbTime?: string;
  };
  teleopClimb: {
    level: string | null;
    orientation?: string | null;
  };
  autos: Array<{
    name?: string;
    description?: string;
    climbDuringAuto: boolean;
    drawing: any;
  }>;
  images?: {
    rating: number;
    description: string;
    files: Array<{
      path: string;
      filename: string;
      uploaded: boolean;
    }>;
  };
}

interface VerificationItem {
  pitClaimed: boolean | string | null;
  matchObserved: boolean | string | null;
  verified: boolean; // true = matches
}

interface Verifications {
  movement: {
    bump: VerificationItem;
    trough: VerificationItem;
  };
  intake: {
    ground: VerificationItem;
    station: VerificationItem;
    stocking: VerificationItem;
  };
  fuel: {
    shootMoving: VerificationItem;
    passing: VerificationItem;
  };
  autoClimb: {
    level: VerificationItem;
    orientation: VerificationItem;
  };
  teleopClimb: {
    level: VerificationItem;
    orientation: VerificationItem;
  };
}
function VerificationBadge({ item }: { item: VerificationItem }) {
  if (item.matchObserved === null && item.pitClaimed === false) return null;
  
  if (item.matchObserved === null || item.matchObserved === false) {
    // Not yet observed in matches — neutral
    return (
      <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 3C16.9706 3 21 7.02944 21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3ZM6.34277 11C5.79066 11.0002 5.34277 11.4478 5.34277 12C5.34277 12.5522 5.79066 12.9998 6.34277 13H17.6562C18.2085 13 18.6562 12.5523 18.6562 12C18.6562 11.4477 18.2085 11 17.6562 11H6.34277Z" fill="#F5864A"/>
        </svg>


      </span>
    );
  }
  
  if (item.verified) {
    return (
      <span className="text-xs text-chart-2 bg-chart-2/10 px-2 py-0.5 rounded-full">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="9" fill="#64BA58" strokeWidth="1.2"/>
        <path d="M8 12L11 15L16 9" stroke="#222" strokeWidth="1.2"/>
        </svg>

      </span>
    );
  }
  
  return (
    <span className="text-xs text-destructive bg-destructive/10 px-2 py-0.5 rounded-full">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 3C16.9706 3 21 7.02944 21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3ZM16.707 7.29297C16.3166 6.9025 15.6835 6.90261 15.293 7.29297L12 10.5859L8.70703 7.29297C8.31649 6.90261 7.68344 6.9025 7.29297 7.29297C6.9025 7.68344 6.90261 8.31649 7.29297 8.70703L10.5859 12L7.29297 15.293C6.90244 15.6835 6.90244 16.3165 7.29297 16.707C7.68349 17.0976 8.31651 17.0976 8.70703 16.707L12 13.4141L15.293 16.707C15.6835 17.0976 16.3165 17.0976 16.707 16.707C17.0976 16.3165 17.0976 15.6835 16.707 15.293L13.4141 12L16.707 8.70703C17.0974 8.31649 17.0975 7.68344 16.707 7.29297Z" fill="#EF4444"/>
      </svg>

    </span>
  );
}
function TeamInfoPage() {
  const navigate = useNavigate();
  const { teamKey } = Route.useSearch();
  const { currentEvent } = useEvent();
  const [pitData, setPitData] = useState<PitData | null>(null);
  const [teamName, setTeamName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingAutoIndex, setEditingAutoIndex] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"pit" | "match">("pit");
  const [editingAutoIndex2, setEditingAutoIndex2] = useState<number | null>(
    null
  );
  const [autoNameValue, setAutoNameValue] = useState("");
  const [autoDescriptionValue, setAutoDescriptionValue] = useState("");
  const [autoClimbValue, setAutoClimbValue] = useState(false);
  const [zoomImagePath, setZoomImagePath] = useState<string | null>(null);
  const [mouseX, setMouseX] = useState<number>(50);
  const [mouseY, setMouseY] = useState<number>(50);
  const [isZoomed, setIsZoomed] = useState(false);
  

  const [matchData, setMatchData] = useState<EventMatchData[]>([]);
  
  useEffect(() => {
    if (!currentEvent || !teamKey) {
      setLoading(false);
      return;
    }

    getEventTeamData(currentEvent).then((data) => {
      const teamData = data.find((t) => t.team === teamKey);
      if (teamData) {
        // Always store team name (exists even without pit data)
        setTeamName(teamData.team_name || `Team ${teamKey.replace("frc", "")}`);

        // Team is scouted if it has a scouter name (not just TBA/Statbotics data)
        if (teamData.data && teamData.name != null && teamData.name !== "") {
          setPitData(teamData.data as PitData);
        } else {
          setPitData(null); // Treat as not scouted
        }
      }
      setLoading(false);
    });
  }, [currentEvent, teamKey]);


  useEffect(() => {
    if (!currentEvent || !teamKey) return;

    Promise.all([
      getEventMatchData(currentEvent, undefined, teamKey),
      getEventTeamData(currentEvent),
      getEventSchedule(currentEvent),
    ]).then(([matchDataResult, teamDataResult, scheduleResult]) => {
      console.log("Raw match data count:", matchDataResult.length);
      console.log("Sample record:", matchDataResult[0]);
      console.log("teamKey filter:", teamKey);
      
      const validData = matchDataResult.filter((d) => !d.deleted_at && d.name);
      console.log("After filter:", validData.length);
      console.log(validData)

      console.log(pitData)
      
      setMatchData(validData);
      console.log(matchData)
    });
  }, [currentEvent, teamKey]);

  const computeVerifications = (
  pit: PitData,
  matches: EventMatchData[]
): Verifications => {
  // Aggregate match observations across all scouted matches
  const observed = {
    bump:         matches.some(m => m.data_raw?.postMatch?.bump),
    trough:       matches.some(m => m.data_raw?.postMatch?.trough),
    ground:       matches.some(m => m.data_raw?.postMatch?.canGround),
    station:      matches.some(m => m.data_raw?.postMatch?.canStation),
    stocking:     matches.some(m => m.data_raw?.postMatch?.canStocking),
    shootMoving:  matches.some(m => m.data_raw?.postMatch?.shootMoving),
    passing:      matches.some(m => m.data_raw?.postMatch?.canPass),
    autoClimbLevel:       matches.some(m => !!m.data_raw?.auto?.climbLevel),
    autoClimbOrientation: matches
      .map(m => m.data_raw?.postMatch?.autoClimbOrientation)
      .find(v => v != null) ?? null,
    teleopClimbLevel: matches
      .map(m => calculateSingleMatchStats(m)?.climb?.level)
      .find(v => v != null) ?? null,
    teleopClimbOrientation: matches
      .map(m => m.data_raw?.postMatch?.teleopClimbOrientation)
      .find(v => v != null) ?? null,
  };

  const boolItem = (pitVal: boolean, obsVal: boolean): VerificationItem => ({
    pitClaimed: pitVal,
    matchObserved: obsVal,
    // Only flag discrepancy if pit said YES but match never showed it
    // (pit said NO but match showed YES is also notable)
    verified: pitVal === obsVal || (!pitVal && obsVal), // lenient: gives benefit of doubt if not observed
  });

  const strItem = (
    pitVal: string | null,
    obsVal: string | null
  ): VerificationItem => ({
    pitClaimed: pitVal,
    matchObserved: obsVal,
    verified: obsVal == null || pitVal === obsVal,
  });

  return {
    movement: {
      bump:   boolItem(pit.movement?.bump ?? false, observed.bump),
      trough: boolItem(pit.movement?.trough ?? false, observed.trough),
    },
    intake: {
      ground:   boolItem(pit.intake?.ground ?? false, observed.ground),
      station:  boolItem(pit.intake?.station ?? false, observed.station),
      stocking: boolItem(pit.intake?.stocking ?? false, observed.stocking),
    },
    fuel: {
      shootMoving: boolItem(pit.fuel?.shootMoving ?? false, observed.shootMoving),
      passing:     boolItem(pit.fuel?.passing ?? false, observed.passing),
    },
    autoClimb: {
      level:       boolItem(pit.autoClimb?.level != null, observed.autoClimbLevel),
      orientation: strItem(pit.autoClimb?.orientation ?? null, observed.autoClimbOrientation),
    },
    teleopClimb: {
      level:       strItem(pit.teleopClimb?.level ?? null, observed.teleopClimbLevel),
      orientation: strItem(pit.teleopClimb?.orientation ?? null, observed.teleopClimbOrientation),
    },
  };
  };
  const [verifications, setVerifications] = useState<Verifications | null>(null);

  
  useEffect(() => {
  if (pitData && matchData.length > 0) {
    setVerifications(computeVerifications(pitData, matchData));
  } else {
    setVerifications(null);
  }
  }, [pitData, matchData]);

  
 
    
  const handleEditAuto = (index: number) => {
    setEditingAutoIndex(index);
    setDrawerOpen(true);
  };

  const handleEditAuto2 = (
    index: number,
    currentName: string,
    currentDescription: string,
    currentClimb: boolean
  ) => {
    setEditingAutoIndex2(index);
    setAutoNameValue(currentName || "");
    setAutoDescriptionValue(currentDescription || "");
    setAutoClimbValue(currentClimb);
  };

  const handleSaveAuto = async () => {
    if (!pitData || editingAutoIndex2 === null || !currentEvent || !teamKey) {
      return;
    }

    try {
      const session = await getSession();
      const userName = session?.user?.email || "Unknown";
      const userId = session?.user?.id || "unknown";

      const updatedAutos = [...pitData.autos];
      updatedAutos[editingAutoIndex2] = {
        ...updatedAutos[editingAutoIndex2],
        name: autoNameValue,
        description: autoDescriptionValue,
        climbDuringAuto: autoClimbValue,
      };

      const updatedData = {
        ...pitData,
        autos: updatedAutos,
      };

      // Save to local DB
      await cacheEventTeamData(currentEvent, [
        {
          event: currentEvent,
          team: teamKey,
          data: updatedData,
          last_modified: Date.now(),
        },
      ]);

      // Sync to Supabase using offline-first write pattern
      await putTeamData(currentEvent, teamKey, updatedData, {
        teamName: teamName,
        name: userName,
        uid: userId,
      });

      // Update local state
      setPitData(updatedData);
      setEditingAutoIndex2(null);
      setAutoNameValue("");
      setAutoDescriptionValue("");
      setAutoClimbValue(false);

      toast.success("Auto updated and synced!");

      // Reload data to ensure consistency
      const refreshedData = await getEventTeamData(currentEvent);
      const teamData = refreshedData.find((t) => t.team === teamKey);
      if (teamData && teamData.data) {
        setPitData(teamData.data as PitData);
      }
    } catch (error) {
      console.error("Failed to save auto:", error);
      toast.error("Failed to save auto");
    }
  };

  const handleCancelAuto = () => {
    setEditingAutoIndex2(null);
    setAutoNameValue("");
    setAutoDescriptionValue("");
    setAutoClimbValue(false);
  };

  const handleSaveAutoDrawing = async (drawing: DrawingData | null) => {
    if (!pitData || editingAutoIndex === null || !currentEvent || !teamKey) {
      return;
    }

    try {
      const session = await getSession();
      const userName = session?.user?.email || "Unknown";
      const userId = session?.user?.id || "unknown";

      // Check if we're adding a new auto or updating existing
      const isNewAuto = editingAutoIndex >= pitData.autos.length;

      let updatedAutos;
      if (isNewAuto) {
        // Add new auto entry
        updatedAutos = [
          ...pitData.autos,
          {
            name: `Auto ${pitData.autos.length + 1}`,
            description: "",
            climbDuringAuto: false,
            drawing,
          },
        ];
      } else {
        // Update existing auto
        updatedAutos = [...pitData.autos];
        updatedAutos[editingAutoIndex] = {
          ...updatedAutos[editingAutoIndex],
          drawing,
        };
      }

      const updatedData = {
        ...pitData,
        autos: updatedAutos,
      };

      // Save to local DB
      await cacheEventTeamData(currentEvent, [
        {
          event: currentEvent,
          team: teamKey,
          data: updatedData,
          last_modified: Date.now(),
        },
      ]);

      // Sync to Supabase using offline-first write pattern
      await putTeamData(currentEvent, teamKey, updatedData, {
        teamName: teamName,
        name: userName,
        uid: userId,
      });

      // Update local state
      setPitData(updatedData);

      toast.success(
        isNewAuto
          ? "New auto added and synced!"
          : "Auto path updated and synced!"
      );
      setDrawerOpen(false);
      setEditingAutoIndex(null);

      // Reload data to ensure consistency
      const refreshedData = await getEventTeamData(currentEvent);
      const teamData = refreshedData.find((t) => t.team === teamKey);
      if (teamData && teamData.data) {
        setPitData(teamData.data as PitData);
      }
    } catch (error) {
      console.error("Failed to save auto drawing:", error);
      toast.error("Failed to save auto path");
    }
  };

  if (!teamKey) {
    return (
      <div className="flex min-h-dvh w-full flex-col items-center justify-center bg-background px-6 py-4">
        <p className="text-muted-foreground">No team selected</p>
      </div>
    );
  }

  const teamNum = teamKey.replace("frc", "");

  return (
    <div className="flex min-h-dvh w-full flex-col bg-background px-6 py-4">
      {/* Back Button */}
      {/* Header: Back + Tabs */}
      <div className="mb-4 flex items-center gap-3">
        {/* Back Button */}
        <button
          onClick={() => window.history.back()}
          className="text-primary"
          aria-label="Back"
        >
          <svg
            viewBox="0 0 24 24"
            style={{ width: 30, height: 30 }}
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

        {/* Tabs */}
        <div className="flex w-full items-center justify-center rounded-xl p-1">
          <button
            type="button"
            onClick={() => setActiveTab("pit")}
            className={`rounded-lg w-full px-3 py-1.5 text-sm font-semibold transition ${
              activeTab === "pit"
                ? "bg-primary text-muted shadow-sm"
                : "bg-muted text-muted-foreground "
            }`}
          >
            Pit
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("match")}
            className={`rounded-lg w-full px-3 py-1.5 text-sm font-semibold transition ${
              activeTab === "match"
                ? "bg-primary text-muted shadow-sm"
                : "bg-muted text-muted-foreground "
            }`}
          >
            Match
          </button>
        </div>
      </div>

      {/* Divider */}
      <div className="h-px w-full bg-border mb-3" />

      {activeTab === "match" ? (
        <MatchScoutingTab eventKey={currentEvent} teamKey={teamKey || ""} />
      ) : (
        <>
          {loading ? (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-muted-foreground">Loading team data...</p>
            </div>
          ) : !pitData ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
              {/* Icon */}
              <div className="rounded-full bg-muted p-6">
                <svg
                  width="64"
                  height="64"
                  viewBox="0 0 24 24"
                  fill="none"
                  className="text-muted-foreground"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M9 11H15M9 15H15M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx="12" cy="8" r="1" fill="currentColor" />
                </svg>
              </div>

              {/* Text */}
              <div className="text-center space-y-2">
                <h3 className="text-xl font-bold text-primary">
                  Not Scouted Yet
                </h3>
                <p className="text-sm text-muted-foreground max-w-xs">
                  This team hasn't been pit scouted. Visit their pit to gather
                  information.
                </p>
              </div>

              {/* Button */}
              <Button
                onClick={() => {
                  navigate({
                    to: "/pitscout",
                    search: {
                      teamNum: Number(teamNum),
                      teamName: teamName,
                    },
                  });
                }}
                className="w-full max-w-sm h-12 bg-primary text-background font-semibold"
              >
                Scout Team {teamNum}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {/* Team Header */}
              <div className="text-center">
                <p className="text-2xl font-bold text-primary">
                  Team {teamNum}
                </p>
                <p className="text-lg text-foreground mt-1">
                  {pitData.teamName}
                </p>
              </div>
              {/* Image zoom */}
              <Dialog open={zoomImagePath != null}
              onOpenChange={() => (setZoomImagePath(null))}
              >
                <DialogContent
                className="fixed w-full h-[40vh]"
                
                >
                  <div className="flex w-full h-full p-2.5 overflow-hidden">
                  {zoomImagePath &&
                    <img
                    src={zoomImagePath}
                    className="w-full h-full object-cover transition-transform duration-300 ease-out hover:scale-150"
                    crossOrigin="anonymous"
                    style={{ transformOrigin: `${mouseX ?? 50}% ${mouseY ?? 50}%`, transform: `scale(${isZoomed ? 1.5 : 1})` }}
                    onPointerMove={
                      (event) => {
                        const { left, top, width, height } = event.currentTarget.getBoundingClientRect();
                        setMouseX(((event.clientX - left) / width) * 150);
                        setMouseY(((event.clientY - top) / height) * 150)
                      }
                    }
                    onPointerEnter={() => setIsZoomed(true)}
                    onPointerLeave={() => setIsZoomed(false)}
                    >
                    </img>
                  }
                  </div>
                </DialogContent>
              </Dialog>

              {/* Images Section */}
              {pitData.images &&
                pitData.images.files &&
                pitData.images.files.length > 0 && (
                  <div>
                    <p className="text-base text-primary font-semibold mb-3">
                      IMAGES
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      {pitData.images.files
                        .filter((img) => img.uploaded)
                        .map((img, idx) => (
                          <div
                            key={idx}
                            className="aspect-square rounded-xl overflow-hidden bg-muted"
                          >
                            <img
                              src={getImageUrl(img.path)}
                              onClick={() => {setZoomImagePath(getImageUrl(img.path))}}
                              alt={`Team ${teamNum} - ${idx + 1}`}
                              className="w-full h-full object-cover"
                              crossOrigin="anonymous"
                            />
                          </div>
                        ))}
                    </div>
                  </div>
                )}

              {/* GENERATED:DISPLAY:START */}

                            {/* Movement Section */}
              <div>
                <p className="text-base text-primary font-semibold mb-3">MOVEMENT</p>
                <div className="rounded-2xl bg-muted px-6 py-4">
                  <div className="flex items-center justify-between py-2">
                    <p className="text-foreground">Bump</p>
                    <div className="flex items-center gap-2">
                      <p className={`font-semibold ${pitData.movement?.bump ? "text-chart-2" : "text-destructive"}`}>
                        {pitData.movement?.bump ? "Yes" : "No"}
                      </p>
                      {verifications && <VerificationBadge item={verifications.movement.bump} />}
                    </div>
                  </div>
                  <div className="h-px bg-border my-2" />
                  <div className="flex items-center justify-between py-2">
                    <p className="text-foreground">Trough</p>
                    <div className="flex items-center gap-2">
                      <p className={`font-semibold ${pitData.movement?.trough ? "text-chart-2" : "text-destructive"}`}>
                        {pitData.movement?.trough ? "Yes" : "No"}
                      </p>
                      {verifications && <VerificationBadge item={verifications.movement.trough} />}
                    </div>
                  </div>
                </div>
              </div>

              {/* Intake Section */}
              <div>
                <p className="text-base text-primary font-semibold mb-3">INTAKE</p>
                <div className="rounded-2xl bg-muted px-6 py-4">
                  <div className="flex items-center justify-between py-2">
                    <p className="text-foreground">Ground</p>
                    <div className="flex items-center gap-2">
                      <p className={`font-semibold ${pitData.intake?.ground ? "text-chart-2" : "text-destructive"}`}>
                        {pitData.intake?.ground ? "Yes" : "No"}
                      </p>
                      {verifications && <VerificationBadge item={verifications.intake.ground} />}
                    </div>
                  </div>
                  <div className="h-px bg-border my-2" />
                  <div className="flex items-center justify-between py-2">
                    <p className="text-foreground">Station</p>
                    <div className="flex items-center gap-2">
                      <p className={`font-semibold ${pitData.intake?.station ? "text-chart-2" : "text-destructive"}`}>
                        {pitData.intake?.station ? "Yes" : "No"}
                      </p>
                      {verifications && <VerificationBadge item={verifications.intake.station} />}
                    </div>
                  </div>
                  <div className="h-px bg-border my-2" />
                  <div className="flex items-center justify-between py-2">
                    <p className="text-foreground">Stocking</p>
                    <div className="flex items-center gap-2">
                      <p className={`font-semibold ${pitData.intake?.stocking ? "text-chart-2" : "text-destructive"}`}>
                        {pitData.intake?.stocking ? "Yes" : "No"}
                      </p>
                      {verifications && <VerificationBadge item={verifications.intake.stocking} />}
                    </div>
                  </div>
                </div>
              </div>

              {/* Fuel Section */}
              <div>
                <p className="text-base text-primary font-semibold mb-3">FUEL</p>
                <div className="rounded-2xl bg-muted px-6 py-4">
                  <div className="flex items-center justify-between py-2">
                    <p className="text-foreground">Shoot Moving</p>
                    <div className="flex items-center gap-2">
                      <p className={`font-semibold ${pitData.fuel?.shootMoving ? "text-chart-2" : "text-destructive"}`}>
                        {pitData.fuel?.shootMoving ? "Yes" : "No"}
                      </p>
                      {verifications && <VerificationBadge item={verifications.fuel.shootMoving} />}
                    </div>
                  </div>
                  <div className="h-px bg-border my-2" />
                  <div className="flex items-center justify-between py-2">
                    <p className="text-foreground">Passing</p>
                    <div className="flex items-center gap-2">
                      <p className={`font-semibold ${pitData.fuel?.passing ? "text-chart-2" : "text-destructive"}`}>
                        {pitData.fuel?.passing ? "Yes" : "No"}
                        
                      </p>
                      {verifications && <VerificationBadge item={verifications.fuel.passing} />}
                    </div>
                  </div>
                  {(pitData.fuel?.bps || pitData.fuel?.capacity) && (
                    <>
                      <div className="h-px bg-border my-2" />
                      <div className="grid grid-cols-2 gap-4 py-2">
                        {pitData.fuel?.bps && (
                          <div>
                            <p className="text-foreground text-sm mb-1">Balls Per Sec</p>
                            <p className="font-semibold text-foreground">{pitData.fuel.bps}</p>
                          </div>
                        )}
                        {pitData.fuel?.capacity && (
                          <div>
                            <p className="text-foreground text-sm mb-1">Ball Capacity</p>
                            <p className="font-semibold text-foreground">{pitData.fuel.capacity}</p>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Auto Climb Section */}
              <div>
                <p className="text-base text-primary font-semibold mb-3">AUTO CLIMB</p>
                <div className="rounded-2xl bg-muted px-6 py-4">
                  {pitData.autoClimb?.declimbTime && (
                    <>
                      <div className="h-px bg-border my-2" />
                      <div className="grid grid-cols-2 gap-4 py-2">
                        <div>
                          <p className="text-foreground text-sm mb-1">Declimb Time (s)</p>
                          <p className="font-semibold text-foreground">{pitData.autoClimb.declimbTime}</p>
                        </div>
                      </div>
                    </>
                  )}
                  <div className="flex items-center justify-between py-2">
                    <p className="text-foreground">Auto Climb</p>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-foreground">{pitData.autoClimb?.level || "None"}</p>
                      {verifications && <VerificationBadge item={verifications.autoClimb.level} />}
                    </div>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <p className="text-foreground">Orientation</p>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-foreground">{pitData.autoClimb?.orientation || "None"}</p>
                      {verifications && <VerificationBadge item={verifications.autoClimb.orientation} />}
                    </div>
                  </div>
                </div>
              </div>

              {/* Teleop Climb Section */}
              <div>
                <p className="text-base text-primary font-semibold mb-3">TELEOP CLIMB</p>
                <div className="rounded-2xl bg-muted px-6 py-4">
                  <div className="flex items-center justify-between py-2">
                    <p className="text-foreground">Climb Level</p>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-foreground">{pitData.teleopClimb?.level || "None"}</p>
                      {verifications && <VerificationBadge item={verifications.teleopClimb.level} />}
                    </div>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <p className="text-foreground">Orientation</p>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-foreground">{pitData.teleopClimb?.orientation || "None"}</p>
                      {verifications && <VerificationBadge item={verifications.teleopClimb.orientation} />}
                    </div>
                  </div>
                </div>
              </div>

        {/* GENERATED:END */}

              {/* Autos Section */}
              {pitData.autos && pitData.autos.length > 0 && (
                <div>
                  <p className="text-base text-primary font-semibold mb-3">
                    AUTOS
                  </p>
                  {pitData.autos.map((auto, idx) => (
                    <div key={idx} className="mb-4">
                      <div className="rounded-2xl bg-muted px-6 py-4">
                        <p className="font-bold text-foreground mb-2">
                          Auto #{idx + 1}
                        </p>
                        {editingAutoIndex2 === idx ? (
                          <div className="flex flex-col gap-4 py-2">
                            <div>
                              <p className="text-primary text-sm mb-2">Name</p>
                              <Input
                                value={autoNameValue}
                                onChange={(e) =>
                                  setAutoNameValue(e.target.value)
                                }
                                placeholder="Auto name"
                                className="h-10"
                              />
                            </div>
                            <div>
                              <p className="text-primary text-sm mb-2">
                                Description
                              </p>
                              <Textarea
                                value={autoDescriptionValue}
                                onChange={(e) =>
                                  setAutoDescriptionValue(e.target.value)
                                }
                                placeholder="Description (optional)"
                                className="min-h-24"
                              />
                            </div>
                            <div>
                              <p className="text-primary text-sm mb-2">Climb During Auto</p>
                              <Toggle
                                pressed={autoClimbValue}
                                onPressedChange={setAutoClimbValue}
                                className="h-10 px-4 rounded-lg border border-border bg-background text-foreground font-light data-[state=on]:border-primary data-[state=on]:border-2 data-[state=on]:text-primary hover:bg-background"
                              >
                                {autoClimbValue ? "Yes" : "No"}
                              </Toggle>
                            </div>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                onClick={handleSaveAuto}
                                className="h-9 flex-1"
                              >
                                Save
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={handleCancelAuto}
                                className="h-9 flex-1"
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-3 py-2">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1">
                                <p className="text-primary text-sm mb-1">
                                  Name
                                </p>
                                <p className=" text-foreground text-base">
                                  {auto.name || `Auto ${idx + 1}`}
                                </p>
                              </div>

                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  handleEditAuto2(
                                    idx,
                                    auto.name || "",
                                    auto.description || "",
                                    auto.climbDuringAuto || false
                                  )
                                }
                                className="h-7 text-xs"
                              >
                                Edit Auto
                              </Button>

                            </div>
                            {auto.description && (
                              <div>
                                <p className="text-primary text-sm mb-1">
                                  Description
                                </p>
                                <p className="text-muted-foreground text-base leading-relaxed">
                                  {auto.description}
                                </p>
                              </div>
                            )}
                          </div>
                        )}
                        <div className="h-px bg-border my-2" />
                        <div className="flex items-center justify-between py-2">
                          <p className="text-foreground">Climb during auto</p>
                          <p
                            className={`font-semibold ${auto.climbDuringAuto ? "text-chart-2" : "text-destructive"}`}
                          >
                            {auto.climbDuringAuto ? "Yes" : "No"}
                          </p>
                        </div>
                        {auto.drawing && (
                          <div className="mt-4">
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-sm text-muted-foreground">
                                Path Visualization
                              </p>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleEditAuto(idx)}
                                className="h-7 text-xs"
                              >
                                Edit Path
                              </Button>
                            </div>
                            <div className="w-full bg-background rounded-xl border border-border p-4 flex items-center justify-center">
                              <AutoPathDisplay
                                drawing={auto.drawing}
                                alliance="red"
                                className="max-w-full"
                              />
                            </div>
                          </div>
                        )}
                        {!auto.drawing && (
                          <div className="mt-4">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleEditAuto(idx)}
                              className="w-full"
                            >
                              Add Auto Path
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {/* Add New Auto Button */}
                  <Button
                    variant="outline"
                    onClick={() => handleEditAuto(pitData.autos.length)}
                    className="w-full mt-2"
                  >
                    + Add New Auto
                  </Button>
                </div>
              )}

              {/* If no autos yet, show add button */}
              {(!pitData.autos || pitData.autos.length === 0) && (
                <div>
                  <p className="text-base text-primary font-semibold mb-3">
                    AUTOS
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => handleEditAuto(0)}
                    className="w-full"
                  >
                    + Add First Auto
                  </Button>
                </div>
              )}

              {/* Rating Section */}
              {pitData.images && (
                <div>
                  <p className="text-base text-primary font-semibold mb-3">
                    SCOUTER RATING
                  </p>
                  <div className="rounded-2xl bg-muted px-6 py-4">
                    <div className="flex items-center justify-between">
                      <p className="text-foreground">Overall Assessment</p>
                      <div className="flex items-center gap-2">
                        <p className="text-2xl font-bold text-primary">
                          {pitData.images.rating}
                        </p>
                        <p className="text-muted-foreground">/5</p>
                      </div>
                    </div>
                    <div className="flex justify-center gap-1 mt-3">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <svg
                          key={star}
                          viewBox="0 0 24 24"
                          className={`size-6 ${star <= pitData.images!.rating ? "text-primary" : "text-border"}`}
                          fill="currentColor"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
                        </svg>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Scouter Notes */}
              {pitData.images && pitData.images.description && (
                <div>
                  <p className="text-base text-primary font-semibold mb-3">
                    SCOUTER NOTES
                  </p>
                  <div className="rounded-2xl bg-muted px-6 py-4">
                    <p className="text-foreground">
                      {pitData.images.description}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Auto Path Drawer */}
      <AutoPathDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        autoIndex={editingAutoIndex ?? 0}
        initialDrawing={
          editingAutoIndex !== null && pitData?.autos[editingAutoIndex]
            ? pitData.autos[editingAutoIndex].drawing
            : null
        }
        onSave={handleSaveAutoDrawing}
      />
    </div>
  );
}
