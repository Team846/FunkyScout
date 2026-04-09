import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Button } from "@shadcn/ui/components/button.tsx";
import { Input } from "@shadcn/ui/components/input.tsx";
import { Textarea } from "@shadcn/ui/components/textarea.tsx";
import { Toggle } from "@shadcn/ui/components/toggle.tsx";
import { toast } from "sonner";
import { useEvent } from "@lib/context/EventContext";
import { useSync } from "@lib/context/SyncContext";
import { getEventMatchData, getEventTeamData, cacheEventTeamData, type EventMatchData } from "@lib/db";
import { getImageUrl } from "@lib/storage/uploads";
import { getFromImageQueue } from "@lib/storage/imageQueue";
import { putTeamData, putTeamDataWithImages } from "@lib/data/writes";
import { getLocalUserData } from "@lib/supabase/user";
import { AutoPathDisplay } from "../components/AutoPathDisplay";
import { AutoPathDrawer } from "../components/auto-path-drawer/AutoPathDrawer";
import { MatchScoutingTab } from "../components/MatchScoutingTab";
import type { DrawingData } from "../components/auto-path-drawer/types";
import { Dialog, DialogContent } from "@shadcn/ui/components/dialog.js";
import { calculateSingleMatchStats, calculateTeamStats } from "@lib/data/matchStats"


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
    outpost: boolean;
  };
  fuel: {
    passing: boolean;
    capacity?: string;
  };
  autoClimb: {
    level: string | null;
    orientation?: string[];
  };
  teleopClimb: {
    level: string[];
    orientation?: string[];
  };
  weight?: string;
  driveType?: string;
  autos: Array<{
    name?: string;
    description?: string;
    /** @deprecated Use climbDuringAuto - pit scouting historically used "climb" */
    climb?: boolean;
    climbDuringAuto?: boolean;
    drawing: { paths?: unknown[]; canvasWidth?: number; canvasHeight?: number } | null;
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
    outpost: VerificationItem;
  };
  fuel: {
    passing: VerificationItem;
  };
  autoClimb: {
    observed: boolean;
    orientations: Set<string>; // lowercase
  };
  teleopClimb: {
    levels: Set<string>;
    orientations: Set<string>; // lowercase
  };
}
function VerificationBadge({ item }: { item: VerificationItem }) {
  // Only show a checkmark when the match confirmed it happened — no negative indicators
  if (item.verified && item.matchObserved !== null && item.matchObserved !== false) {
    return (
      <span className="text-xs text-chart-2 bg-chart-2/10 px-2 py-0.5 rounded-full">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="9" fill="#64BA58" strokeWidth="1.2"/>
        <path d="M8 12L11 15L16 9" stroke="#222" strokeWidth="1.2"/>
        </svg>
      </span>
    );
  }

  return null;
}

// Session-scoped cache: storage path → blob URL.
// Images are immutable once uploaded (UUID paths), so this is safe to keep
// for the whole session. Prevents re-downloading when navigating between teams.
const imageCache = new Map<string, string>();

/**
 * Fetches image via fetch() and displays via blob URL.
 * Works around COEP (require-corp) which blocks cross-origin img src from Supabase Storage.
 * Uses Intersection Observer for lazy loading and a session cache to limit Supabase egress.
 */
function PitImageWithRetry({
  path,
  teamNum,
  idx,
  onZoom,
}: {
  path: string;
  teamNum: string | number;
  idx: number;
  onZoom: (url: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [errored, setErrored] = useState(false);

  // When path changes (e.g. pending-* → real path after upload sync), reset so
  // the observer can trigger a fresh fetch with the new URL
  useEffect(() => {
    setErrored(false);
    setBlobUrl(null);
  }, [path]);

  // For pending paths: image is queued in IndexedDB (not yet uploaded).
  // Show it immediately from IndexedDB so the scouter can confirm the photo
  // was captured, even without network.
  useEffect(() => {
    if (!path.startsWith("pending-")) return;
    let cancelled = false;
    const id = path.slice("pending-".length);
    getFromImageQueue(id)
      .then((item) => {
        if (cancelled) return;
        const url = URL.createObjectURL(item.blob);
        setBlobUrl(url);
      })
      .catch(() => {
        // Image may have already been uploaded and removed from queue — let the
        // normal fetch effect handle it once the path is updated to a real path.
      });
    return () => { cancelled = true; };
  }, [path]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Network fetch is for real (uploaded) paths only
    if (path.startsWith("pending-")) return;

    let cancelled = false;
    let activeController: AbortController | null = null;

    const doFetch = async (attempt = 0) => {
      // 1. Session cache (Map): fastest, no async overhead
      const cached = imageCache.get(path);
      if (cached) {
        if (!cancelled) setBlobUrl(cached);
        return;
      }

      const url = getImageUrl(path);

      // 2. Cache API: persists across page refreshes and app restarts.
      //    Images use UUID paths so they're immutable — safe to cache indefinitely.
      if ("caches" in window) {
        try {
          const cache = await caches.open("team-images-v1");
          const cachedResponse = await cache.match(url);
          if (cachedResponse) {
            const blob = await cachedResponse.blob();
            const objectUrl = URL.createObjectURL(blob);
            imageCache.set(path, objectUrl);
            if (!cancelled) setBlobUrl(objectUrl);
            return;
          }
        } catch {
          // Cache API unavailable — fall through to network
        }
      }

      // 3. Network fetch
      activeController = new AbortController();
      // 15s timeout — covers slow event-day WiFi without hanging forever
      const timeout = setTimeout(() => activeController!.abort(), 15000);
      try {
        const r = await fetch(url, { mode: "cors", signal: activeController.signal });
        clearTimeout(timeout);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const blob = await r.blob();
        const objectUrl = URL.createObjectURL(blob);
        imageCache.set(path, objectUrl);

        // Store in Cache API for future sessions (fire-and-forget)
        if ("caches" in window) {
          caches.open("team-images-v1").then((cache) =>
            cache.put(url, new Response(blob, { headers: { "Content-Type": blob.type } }))
          ).catch(() => {});
        }

        if (!cancelled) setBlobUrl(objectUrl);
      } catch {
        clearTimeout(timeout);
        if (!cancelled && attempt === 0) {
          // Wait 2s then retry once before giving up
          await new Promise((res) => setTimeout(res, 2000));
          if (!cancelled) doFetch(1);
        } else if (!cancelled) {
          setErrored(true);
        }
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || blobUrl || errored) return;
        doFetch();
      },
      { rootMargin: "100px" }
    );

    observer.observe(el);
    return () => {
      cancelled = true;
      activeController?.abort();
      observer.disconnect();
    };
  }, [path, blobUrl, errored]);

  // Don't revoke cached blob URLs — they're reused when navigating back to this team.
  // Blob URLs are freed when the page unloads.

  if (errored) {
    return (
      <div
        className="aspect-square rounded-xl overflow-hidden bg-muted flex items-center justify-center"
        role="img"
        aria-label={`Team ${teamNum} image ${idx + 1} unavailable`}
      >
        <span className="text-xs text-muted-foreground text-center px-2">Image unavailable</span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="aspect-square rounded-xl overflow-hidden bg-muted flex items-center justify-center"
      onClick={blobUrl ? () => onZoom(blobUrl) : undefined}
      role={blobUrl ? "button" : undefined}
      tabIndex={blobUrl ? 0 : undefined}
      onKeyDown={blobUrl ? (e) => e.key === "Enter" && onZoom(blobUrl) : undefined}
      style={{ cursor: blobUrl ? "pointer" : "default" }}
    >
      {blobUrl ? (
        <img
          src={blobUrl}
          alt={`Team ${teamNum} - ${idx + 1}`}
          className="w-full h-full object-cover"
        />
      ) : (
        <span className="text-xs text-muted-foreground">{path.startsWith("pending-") ? "Uploading…" : "Loading…"}</span>
      )}
    </div>
  );
}

function TeamInfoPage() {
  const navigate = useNavigate();
  const { teamKey } = Route.useSearch();
  const { currentEvent } = useEvent();
  const { registerRefreshCallback } = useSync();
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

  // Image editing state
  const [editingImages, setEditingImages] = useState(false);
  const [removedImagePaths, setRemovedImagePaths] = useState<Set<string>>(new Set());
  const [newImageFiles, setNewImageFiles] = useState<File[]>([]);
  const [newImagePreviews, setNewImagePreviews] = useState<string[]>([]);
  const [savingImages, setSavingImages] = useState(false);
  const imageFileInputRef = useRef<HTMLInputElement>(null);

  const handleImageEditSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setNewImageFiles((prev) => [...prev, ...files]);
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setNewImagePreviews((prev) => [...prev, ev.target?.result as string]);
      };
      reader.readAsDataURL(file);
    });
    // Reset input so the same file can be re-selected if needed
    e.target.value = "";
  };

  const cancelImageEdit = () => {
    setEditingImages(false);
    setRemovedImagePaths(new Set());
    setNewImageFiles([]);
    setNewImagePreviews([]);
  };

  const saveImageEdit = async () => {
    if (!pitData || !currentEvent || !teamKey) return;
    setSavingImages(true);
    try {
      const localUser = getLocalUserData();
      const teamNum = teamKey.replace("frc", "");
      const keptFiles = (pitData.images?.files ?? []).filter(
        (f) => !removedImagePaths.has(f.path)
      );
      const updatedData = {
        ...pitData,
        images: {
          rating: pitData.images?.rating ?? 0,
          description: pitData.images?.description ?? "",
          files: keptFiles,
        },
      };
      if (newImageFiles.length > 0) {
        await putTeamDataWithImages(currentEvent, teamKey, updatedData, newImageFiles, {
          teamName,
          name: localUser.name || localUser.email || "Unknown",
          uid: localUser.uid || "unknown",
        });
      } else {
        await putTeamData(currentEvent, teamKey, updatedData, {
          teamName,
          name: localUser.name || localUser.email || "Unknown",
          uid: localUser.uid || "unknown",
        });
      }
      toast.success("Images updated");
      cancelImageEdit();
      // Refresh pit data from local cache
      const data = await getEventTeamData(currentEvent);
      const updated = data.find((t) => t.team === teamKey);
      if (updated?.data) setPitData(updated.data as PitData);
    } catch (err) {
      console.error("[TeamInfo] Image save failed:", err);
      toast.error("Failed to save images");
    } finally {
      setSavingImages(false);
    }
  };
  
  // Stable callback so the sync refresh registration doesn't churn on every render
  const refreshPitData = useCallback(() => {
    if (!currentEvent || !teamKey) return;
    getEventTeamData(currentEvent).then((data) => {
      const teamData = data.find((t) => t.team === teamKey);
      if (teamData) {
        setTeamName(teamData.team_name || `Team ${teamKey?.replace("frc", "")}`);
        if (teamData.data && teamData.name != null && teamData.name !== "") {
          setPitData(teamData.data as PitData);
        } else {
          setPitData(null);
        }
      }
    });
  }, [currentEvent, teamKey]);

  // Initial load (sets loading state too)
  useEffect(() => {
    if (!currentEvent || !teamKey) {
      setLoading(false);
      return;
    }
    getEventTeamData(currentEvent).then((data) => {
      const teamData = data.find((t) => t.team === teamKey);
      if (teamData) {
        setTeamName(teamData.team_name || `Team ${teamKey?.replace("frc", "")}`);
        if (teamData.data && teamData.name != null && teamData.name !== "") {
          setPitData(teamData.data as PitData);
        } else {
          setPitData(null);
        }
      }
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });
  }, [currentEvent, teamKey]);

  // Re-read pit data from SQLite whenever a sync completes, app returns to foreground,
  // or connection is restored — keeps images fresh without manual refresh
  useEffect(() => {
    return registerRefreshCallback(refreshPitData);
  }, [registerRefreshCallback, refreshPitData]);


  const refreshMatchData = useCallback(() => {
    if (!currentEvent || !teamKey) return;
    getEventMatchData(currentEvent, undefined, teamKey).then((matchDataResult) => {
      const validData = matchDataResult.filter((d) => !d.deleted_at && d.name);
      setMatchData(validData);
    });
  }, [currentEvent, teamKey]);

  useEffect(() => {
    refreshMatchData();
  }, [refreshMatchData]);

  useEffect(() => {
    return registerRefreshCallback(refreshMatchData);
  }, [registerRefreshCallback, refreshMatchData]);

  const aggregateStats = useMemo(
    () => (teamKey && matchData.length > 0 ? calculateTeamStats(teamKey, matchData) : null),
    [teamKey, matchData]
  );

  const computeVerifications = (
  pit: PitData,
  matches: EventMatchData[]
): Verifications => {
  // Aggregate match observations across all scouted matches
  const observed = {
    bump:    matches.some(m => m.data_raw?.postMatch?.bump),
    trough:  matches.some(m => m.data_raw?.postMatch?.trough),
    ground:  matches.some(m => m.data_raw?.postMatch?.canGround),
    outpost: matches.some(m => m.data_raw?.postMatch?.canStation),
    passing: matches.some(m => m.data_raw?.postMatch?.canPass),
    autoClimbObserved: matches.some(m => !!calculateSingleMatchStats(m)?.climb?.hasAutoClimb),
    autoClimbOrientations: new Set(
      matches
        .map(m => m.data_raw?.postMatch?.autoClimbOrientation)
        .filter((v): v is string => v != null)
        .map(v => v.toLowerCase())
    ),
    teleopClimbLevels: new Set<string>(
      matches
        .map(m => calculateSingleMatchStats(m)?.climb?.level)
        .filter((v): v is "L1" | "L2" | "L3" => v != null)
    ),
    teleopClimbOrientations: new Set(
      matches
        .map(m => m.data_raw?.postMatch?.teleopClimbOrientation)
        .filter((v): v is string => v != null)
        .map(v => v.toLowerCase())
    ),
  };

  const boolItem = (pitVal: boolean, obsVal: boolean): VerificationItem => ({
    pitClaimed: pitVal,
    matchObserved: obsVal,
    // Only flag discrepancy if pit said YES but match never showed it
    // (pit said NO but match showed YES is also notable)
    verified: pitVal === obsVal || (!pitVal && obsVal), 
  });

  return {
    movement: {
      bump:   boolItem(pit.movement?.bump ?? false, observed.bump),
      trough: boolItem(pit.movement?.trough ?? false, observed.trough),
    },
    intake: {
      ground:  boolItem(pit.intake?.ground ?? false, observed.ground),
      outpost: boolItem(pit.intake?.outpost ?? false, observed.outpost),
    },
    fuel: {
      passing: boolItem(pit.fuel?.passing ?? false, observed.passing),
    },
    autoClimb: {
      observed: observed.autoClimbObserved,
      orientations: observed.autoClimbOrientations,
    },
    teleopClimb: {
      levels: observed.teleopClimbLevels,
      orientations: observed.teleopClimbOrientations,
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
      const localUser = getLocalUserData();
      const userName = localUser.name || localUser.email || "Unknown";
      const userId = localUser.uid || "unknown";

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
      const localUser = getLocalUserData();
      const userName = localUser.name || localUser.email || "Unknown";
      const userId = localUser.uid || "unknown";

      // Guard against pitData.autos being undefined (older records without autos field)
      const currentAutos = pitData.autos || [];

      // Check if we're adding a new auto or updating existing
      const isNewAuto = editingAutoIndex >= currentAutos.length;

      let updatedAutos;
      if (isNewAuto) {
        // Add new auto entry
        updatedAutos = [
          ...currentAutos,
          {
            name: `Auto ${currentAutos.length + 1}`,
            description: "",
            climbDuringAuto: false,
            drawing,
          },
        ];
      } else {
        // Update existing auto
        updatedAutos = [...currentAutos];
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

  const teamNum = teamKey?.replace("frc", "");

  return (
    <div className="flex min-h-dvh w-full flex-col bg-background px-6 pb-4 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)]">
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
        <MatchScoutingTab eventKey={currentEvent ?? ""} teamKey={teamKey ?? ""} />
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
                    alt="Zoomed pit image"
                    className="w-full h-full object-cover transition-transform duration-300 ease-out hover:scale-150"
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
              {pitData.images && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-base text-primary font-semibold">IMAGES</p>
                    {!editingImages ? (
                      <button
                        type="button"
                        onClick={() => setEditingImages(true)}
                        className="text-xs text-primary border border-primary/40 rounded-full px-3 py-0.5"
                      >
                        Edit
                      </button>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={cancelImageEdit}
                          disabled={savingImages}
                          className="text-xs text-muted-foreground border border-border rounded-full px-3 py-0.5 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={saveImageEdit}
                          disabled={savingImages}
                          className="text-xs text-primary border border-primary/40 rounded-full px-3 py-0.5 disabled:opacity-50"
                        >
                          {savingImages ? "Saving…" : "Save"}
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    {/* Existing images */}
                    {pitData.images.files
                      .filter((img) => !removedImagePaths.has(img.path))
                      .map((img, idx) => (
                        <div key={img.path} className="relative">
                          <PitImageWithRetry
                            path={img.path}
                            teamNum={teamNum}
                            idx={idx}
                            onZoom={editingImages ? () => {} : (url) => setZoomImagePath(url)}
                          />
                          {editingImages && (
                            <button
                              type="button"
                              onClick={() =>
                                setRemovedImagePaths((prev) => new Set([...prev, img.path]))
                              }
                              className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center text-white text-sm leading-none"
                              aria-label="Remove image"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      ))}

                    {/* New image previews */}
                    {editingImages &&
                      newImagePreviews.map((preview, idx) => (
                        <div key={`new-${idx}`} className="relative aspect-square rounded-xl overflow-hidden bg-muted">
                          <img
                            src={preview}
                            alt={`New image ${idx + 1}`}
                            className="w-full h-full object-cover"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setNewImageFiles((prev) => prev.filter((_, i) => i !== idx));
                              setNewImagePreviews((prev) => prev.filter((_, i) => i !== idx));
                            }}
                            className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center text-white text-sm leading-none"
                            aria-label="Remove new image"
                          >
                            ×
                          </button>
                        </div>
                      ))}

                    {/* Add image button */}
                    {editingImages && (
                      <button
                        type="button"
                        onClick={() => imageFileInputRef.current?.click()}
                        className="aspect-square rounded-xl border-2 border-dashed border-border flex items-center justify-center text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                        aria-label="Add image"
                      >
                        <svg viewBox="0 0 24 24" className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                        </svg>
                      </button>
                    )}
                  </div>

                  {/* Hidden file input */}
                  <input
                    ref={imageFileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleImageEditSelect}
                  />
                </div>
              )}

              

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
                    <p className="text-foreground">Trench</p>
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
                    <p className="text-foreground">Outpost</p>
                    <div className="flex items-center gap-2">
                      <p className={`font-semibold ${pitData.intake?.outpost ? "text-chart-2" : "text-destructive"}`}>
                        {pitData.intake?.outpost ? "Yes" : "No"}
                      </p>
                      {verifications && <VerificationBadge item={verifications.intake.outpost} />}
                    </div>
                  </div>
                </div>
              </div>

              {/* Fuel Section */}
              <div>
                <p className="text-base text-primary font-semibold mb-3">FUEL</p>
                <div className="rounded-2xl bg-muted px-6 py-4">
                  <div className="flex items-center justify-between py-2">
                    <p className="text-foreground">Passing</p>
                    <div className="flex items-center gap-2">
                      <p className={`font-semibold ${pitData.fuel?.passing ? "text-chart-2" : "text-destructive"}`}>
                        {pitData.fuel?.passing ? "Yes" : "No"}
                      </p>
                      {verifications && <VerificationBadge item={verifications.fuel.passing} />}
                    </div>
                  </div>
                  {pitData.fuel?.capacity && (
                    <>
                      <div className="h-px bg-border my-2" />
                      <div className="py-2">
                        <p className="text-foreground text-sm mb-1">Ball Capacity</p>
                        <p className="font-semibold text-foreground">{pitData.fuel.capacity}</p>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Auto Climb Section */}
              <div>
                <p className="text-base text-primary font-semibold mb-3">AUTO CLIMB</p>
                <div className="rounded-2xl bg-muted px-6 py-4">
                  <div className="flex items-center justify-between py-2">
                    <p className="text-foreground">Auto Climb</p>
                    <p className={`font-semibold ${verifications?.autoClimb.observed && pitData.autoClimb?.level === "Climb" ? "text-chart-2" : "text-foreground"}`}>
                      {pitData.autoClimb?.level || "None"}
                    </p>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <p className="text-foreground">Orientation</p>
                    <div className="flex items-center gap-1.5">
                      {Array.isArray(pitData.autoClimb?.orientation) && pitData.autoClimb.orientation.length > 0
                        ? pitData.autoClimb.orientation.map((o, i) => (
                            <span key={o} className="font-semibold">
                              {i > 0 && <span className="text-foreground">, </span>}
                              <span className={verifications?.autoClimb.orientations.has(o.toLowerCase()) ? "text-chart-2" : "text-foreground"}>{o}</span>
                            </span>
                          ))
                        : <span className="font-semibold text-foreground">None</span>
                      }
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
                    <div className="flex items-center gap-1.5">
                      {Array.isArray(pitData.teleopClimb?.level) && pitData.teleopClimb.level.length > 0
                        ? pitData.teleopClimb.level.map((l, i) => (
                            <span key={l} className="font-semibold">
                              {i > 0 && <span className="text-foreground">, </span>}
                              <span className={verifications?.teleopClimb.levels.has(l) ? "text-chart-2" : "text-foreground"}>{l}</span>
                            </span>
                          ))
                        : <span className="font-semibold text-foreground">None</span>
                      }
                    </div>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <p className="text-foreground">Orientation</p>
                    <div className="flex items-center gap-1.5">
                      {Array.isArray(pitData.teleopClimb?.orientation) && pitData.teleopClimb.orientation.length > 0
                        ? pitData.teleopClimb.orientation.map((o, i) => (
                            <span key={o} className="font-semibold">
                              {i > 0 && <span className="text-foreground">, </span>}
                              <span className={verifications?.teleopClimb.orientations.has(o.toLowerCase()) ? "text-chart-2" : "text-foreground"}>{o}</span>
                            </span>
                          ))
                        : <span className="font-semibold text-foreground">None</span>
                      }
                    </div>
                  </div>
                </div>
              </div>
              {/* Misc section */}
              <div>
                <p className="text-base text-primary font-semibold mb-3">MISC</p>
                <div className="rounded-2xl bg-muted px-6 py-4">
                  <div className="flex items-center justify-between py-2">
                    <p className="text-foreground">Weight</p>
                    <div className="flex items-center gap-1.5">
                      <p className="font-semibold text-foreground">{pitData.weight}</p>
                    </div>
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <p className="text-foreground">Drive Type/Experience</p>
                      <div className="flex items-center gap-1.5">
                        <p className="font-semibold text-foreground">{pitData.driveType}</p>
                     </div>
                     
                  </div>
                </div>
              </div>
              

              {/* Autos Section */}
              {pitData.autos && pitData.autos.length > 0 && (
                <div>
                  <p className="text-base text-primary font-semibold mb-3">
                    AUTOS
                  </p>
                  {pitData.autos.map((auto, idx) => (
                    <div key={idx} className="mb-4">
                      <div className="rounded-2xl bg-muted px-6 py-4">
                        {editingAutoIndex2 === idx ? (
                          <div className="flex flex-col gap-4 py-2">
                            <div>
                              <p className="text-primary font-semibold mb-2">Name</p>
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
                              <p className="text-primary font-semibold mb-2">
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
                              <p className="text-primary font-semibold mb-2">Climb During Auto</p>
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
                              <p className="text-primary font-semibold flex-1">
                                Name: <span className="text-foreground font-normal">&quot;{auto.name || `Auto ${idx + 1}`}&quot;</span>
                              </p>
                              <Button
                                size="default"
                                variant="outline"
                                onClick={() =>
                                  handleEditAuto2(
                                    idx,
                                    auto.name || "",
                                    auto.description || "",
                                    (auto.climbDuringAuto ?? auto.climb ?? false)
                                  )
                                }
                                className="font-medium"
                              >
                                Edit Data
                              </Button>
                            </div>
                            {auto.description && (
                              <div>
                                <p className="text-primary font-semibold mb-1">
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
                        <div className="flex items-center justify-between gap-4 py-2 flex-wrap">
                          <div className="flex items-center gap-2">
                            <span className="text-primary font-medium">Climb during auto</span>
                            {(auto.climbDuringAuto ?? auto.climb ?? false) ? (
                              <svg className="size-5 text-chart-2 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                            ) : (
                              <svg className="size-5 text-destructive shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                            )}
                          </div >
                          <div className="flex items-center gap-2">
                          <span className="text-primary font-medium">
                            Run count: 
                          </span>
                          <span className="text-foreground font-medium">
                            {aggregateStats?.autoRunCounts?.[auto.name ?? `Auto ${idx + 1}`] ?? 0}
                          </span>
                          </div>
                        </div>
                        {auto.drawing && (
                          <div className="mt-4">
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-sm text-muted-foreground">
                                Path Visualization
                              </p>
                              <Button
                                size="default"
                                variant="outline"
                                onClick={() => handleEditAuto(idx)}
                                className="font-medium"
                              >
                                Edit Path
                              </Button>
                            </div>
                            <div className="w-full bg-background rounded-xl border border-border p-4 flex items-center justify-center">
                              <AutoPathDisplay
                                drawing={
                                  auto.drawing && typeof auto.drawing === "object"
                                    ? {
                                        paths: Array.isArray(auto.drawing.paths) ? auto.drawing.paths : [],
                                        canvasWidth: auto.drawing.canvasWidth ?? 400,
                                        canvasHeight: auto.drawing.canvasHeight ?? 200,
                                      } as DrawingData
                                    : { paths: [], canvasWidth: 400, canvasHeight: 200 }
                                }
                                alliance="red"
                                className="max-w-full"
                              />
                            </div>
                          </div>
                        )}
                        {!auto.drawing && (
                          <div className="mt-4">
                            <Button
                              size="default"
                              variant="outline"
                              onClick={() => handleEditAuto(idx)}
                              className="w-full font-medium"
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
          editingAutoIndex !== null && pitData?.autos?.[editingAutoIndex]?.drawing
            ? (() => {
                const d = pitData.autos[editingAutoIndex!].drawing;
                if (!d || typeof d !== "object") return null;
                return {
                  paths: Array.isArray(d.paths) ? d.paths : [],
                  canvasWidth: d.canvasWidth ?? 400,
                  canvasHeight: d.canvasHeight ?? 200,
                } as DrawingData;
              })()
            : null
        }
        onSave={handleSaveAutoDrawing}
      />
    </div>
  );
}
