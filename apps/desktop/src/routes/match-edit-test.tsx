import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@shadcn/ui/components/card.tsx";
import { Button } from "@shadcn/ui/components/button.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@shadcn/ui/components/select.tsx";
import { Input } from "@shadcn/ui/components/input.tsx";
import { Textarea } from "@shadcn/ui/components/textarea.tsx";
import { Label } from "@shadcn/ui/components/label.tsx";
import { Loader2, Save, RefreshCw } from "lucide-react";
import { useDesktopEvent } from "../contexts/DesktopEventContext";
import { useDesktopCompetitionData } from "../contexts/DesktopCompetitionDataContext";
import { getMatchScoutingData } from "../lib/db";
import { reverseTransformMatchData } from "@lib/data/matchDataTransform";
import { transformMatchData } from "@lib/data/matchDataTransform";
import { putMatchData } from "@lib/data/writes";
import { getLocalUserData } from "@lib/supabase/user";
import type { MatchScoutingData } from "@lib/types/matchScouting";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

export const Route = createFileRoute("/match-edit-test")({
  component: MatchEditTestPage,
});

function MatchEditTestPage() {
  const { currentEvent } = useDesktopEvent();
  const { lastDataRefreshAt } = useDesktopCompetitionData();
  const [allMatchData, setAllMatchData] = useState<any[]>([]);
  const [selectedMatch, setSelectedMatch] = useState<string | null>(null);
  const [matchData, setMatchData] = useState<MatchScoutingData | null>(null);
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [queueStatus, setQueueStatus] = useState<{ pending: number; processing: number; failed: number } | null>(null);

  const refreshQueueStatus = async () => {
    try {
      const status = await invoke<{ pending: number; processing: number; failed: number }>("get_sync_queue_status");
      setQueueStatus(status);
    } catch (e) {
      console.error("[MatchEditTest] Failed to get queue status:", e);
    }
  };

  // Poll queue status every 3 seconds
  useEffect(() => {
    refreshQueueStatus();
    const interval = setInterval(refreshQueueStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  // Load all match data when event changes or after a sync cycle
  useEffect(() => {
    if (!currentEvent) return;

    async function loadMatchData() {
      setIsLoading(true);
      try {
        console.log("[MatchEditTest] Loading match data for event:", currentEvent);
        const data = await getMatchScoutingData(currentEvent);
        console.log("[MatchEditTest] Loaded match data:", data.length, "submissions");
        setAllMatchData(data);
      } catch (error) {
        console.error("[MatchEditTest] Failed to load match data:", error);
        toast.error("Failed to load match data");
      } finally {
        setIsLoading(false);
      }
    }

    loadMatchData();
  }, [currentEvent, lastDataRefreshAt]);

  // Load selected match data
  useEffect(() => {
    if (!selectedMatch) {
      setMatchData(null);
      setNotes("");
      return;
    }

    const selected = allMatchData.find((m) =>
      `${m.match}:${m.team}` === selectedMatch
    );

    if (!selected) {
      setMatchData(null);
      setNotes("");
      return;
    }

    console.log("[MatchEditTest] Selected match data:", {
      match: selected.match,
      team: selected.team,
      hasDataRaw: !!selected.data_raw,
      dataRawKeys: selected.data_raw ? Object.keys(selected.data_raw) : [],
    });

    // Reverse transform from database format to UI format
    if (selected.data_raw && Object.keys(selected.data_raw).length > 0) {
      const uiData = reverseTransformMatchData(selected.data_raw);
      console.log("[MatchEditTest] Reverse transformed data:", {
        hasPresetActions: Array.isArray(uiData.presetActions),
        presetActionsCount: uiData.presetActions?.length ?? 0,
        hasRatings: !!uiData.postMatch?.ratings,
      });
      setMatchData(uiData);
      setNotes(uiData.notes || "");
    } else {
      // Initialize empty form
      setMatchData({
        presetActions: [],
        locationActions: [],
        toggleActions: [],
        postMatch: {
          ratings: {},
        },
        notes: "",
      });
      setNotes("");
    }
  }, [selectedMatch, allMatchData]);

  const handleSave = async () => {
    if (!matchData || !currentEvent || !selectedMatch) {
      toast.error("Missing match data");
      return;
    }

    const selected = allMatchData.find((m) =>
      `${m.match}:${m.team}` === selectedMatch
    );

    if (!selected) {
      toast.error("Selected match not found");
      return;
    }

    setIsSaving(true);

    try {
      const localUser = getLocalUserData();
      const scoutName = selected.name || localUser.name || "Unknown";
      const scoutUid = selected.uid || localUser.uid || "unknown";

      // Complete match data with notes
      const completeMatchData: MatchScoutingData = {
        ...matchData,
        notes,
        scoutName,
        scoutUid,
      };

      // Transform to database format
      const transformedData = transformMatchData(completeMatchData, 2025);

      console.log("[MatchEditTest] Saving data:", {
        event: currentEvent,
        match: selected.match,
        team: selected.team,
        alliance: selected.alliance,
        scoutName,
        scoutUid,
        transformedDataKeys: Object.keys(transformedData),
      });

      // Upload via offline-first pattern
      await putMatchData(
        currentEvent,
        selected.match,
        selected.team,
        transformedData,
        scoutUid,
        selected.alliance,
        { name: scoutName }
      );

      toast.success("Match data saved!");

      // Reload match data to see updates
      const refreshedData = await getMatchScoutingData(currentEvent);
      setAllMatchData(refreshedData);
    } catch (error) {
      console.error("[MatchEditTest] Failed to save:", error);
      toast.error(`Failed to save: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Calculate some basic stats for display
  const autoStation =
    matchData?.presetActions.filter(
      (a) => a.type === "station_intake" && a.phase === "auto"
    ).length || 0;
  const teleopStation =
    matchData?.presetActions.filter(
      (a) => a.type === "station_intake" && a.phase === "teleop"
    ).length || 0;
  const autoStocking =
    matchData?.presetActions.filter(
      (a) => a.type === "stocking" && a.phase === "auto"
    ).length || 0;
  const teleopStocking =
    matchData?.presetActions.filter(
      (a) => a.type === "stocking" && a.phase === "teleop"
    ).length || 0;

  // Helper to set counter values
  const setAutoStation = (value: number) => {
    if (!matchData) return;
    const filtered = matchData.presetActions.filter(
      (a) => !(a.type === "station_intake" && a.phase === "auto")
    );
    const newActions = Array.from({ length: Math.max(0, value) }, () => ({
      type: "station_intake" as const,
      timestamp: Date.now(),
      phase: "auto" as const,
    }));
    setMatchData({
      ...matchData,
      presetActions: [...filtered, ...newActions],
    });
  };

  const setTeleopStation = (value: number) => {
    if (!matchData) return;
    const filtered = matchData.presetActions.filter(
      (a) => !(a.type === "station_intake" && a.phase === "teleop")
    );
    const newActions = Array.from({ length: Math.max(0, value) }, () => ({
      type: "station_intake" as const,
      timestamp: Date.now(),
      phase: "teleop" as const,
    }));
    setMatchData({
      ...matchData,
      presetActions: [...filtered, ...newActions],
    });
  };

  const setAutoStocking = (value: number) => {
    if (!matchData) return;
    const filtered = matchData.presetActions.filter(
      (a) => !(a.type === "stocking" && a.phase === "auto")
    );
    const newActions = Array.from({ length: Math.max(0, value) }, () => ({
      type: "stocking" as const,
      timestamp: Date.now(),
      phase: "auto" as const,
    }));
    setMatchData({
      ...matchData,
      presetActions: [...filtered, ...newActions],
    });
  };

  const setTeleopStocking = (value: number) => {
    if (!matchData) return;
    const filtered = matchData.presetActions.filter(
      (a) => !(a.type === "stocking" && a.phase === "teleop")
    );
    const newActions = Array.from({ length: Math.max(0, value) }, () => ({
      type: "stocking" as const,
      timestamp: Date.now(),
      phase: "teleop" as const,
    }));
    setMatchData({
      ...matchData,
      presetActions: [...filtered, ...newActions],
    });
  };

  if (!currentEvent) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardHeader>
            <CardTitle>Match Edit Test</CardTitle>
            <CardDescription>Please select an event to edit match data</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Match Edit Test - {currentEvent}</CardTitle>
          <CardDescription>
            Test match editing logic (same as mobile, using Tauri instead of WASM)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Match Selector */}
          <div className="space-y-2">
            <Label>Select Match to Edit:</Label>
            <Select
              value={selectedMatch || "none"}
              onValueChange={(value) => setSelectedMatch(value === "none" ? null : value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a match..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Choose a match...</SelectItem>
                {allMatchData.map((m) => (
                  <SelectItem key={`${m.match}:${m.team}`} value={`${m.match}:${m.team}`}>
                    {m.match} - Team {m.team.replace("frc", "")} ({m.alliance}) - by {m.name || "Unknown"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isLoading && (
            <div className="text-center py-8">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground mt-2">Loading match data...</p>
            </div>
          )}

          {!isLoading && allMatchData.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              No match data found for this event
            </div>
          )}

          {/* Editor - Only show when match is selected */}
          {selectedMatch && matchData && (
            <>
              {/* Basic Stats Table */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Match Data (Sample Fields)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {/* Auto Station */}
                    <div className="flex items-center gap-4">
                      <Label className="w-32">Auto Station:</Label>
                      <Input
                        type="number"
                        value={autoStation}
                        onChange={(e) => setAutoStation(parseInt(e.target.value) || 0)}
                        className="w-24"
                      />
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setAutoStation(autoStation + 1)}
                        >
                          +
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setAutoStation(Math.max(0, autoStation - 1))}
                        >
                          -
                        </Button>
                      </div>
                    </div>

                    {/* Teleop Station */}
                    <div className="flex items-center gap-4">
                      <Label className="w-32">Teleop Station:</Label>
                      <Input
                        type="number"
                        value={teleopStation}
                        onChange={(e) => setTeleopStation(parseInt(e.target.value) || 0)}
                        className="w-24"
                      />
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setTeleopStation(teleopStation + 1)}
                        >
                          +
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setTeleopStation(Math.max(0, teleopStation - 1))}
                        >
                          -
                        </Button>
                      </div>
                    </div>

                    {/* Auto Stocking */}
                    <div className="flex items-center gap-4">
                      <Label className="w-32">Auto Stocking:</Label>
                      <Input
                        type="number"
                        value={autoStocking}
                        onChange={(e) => setAutoStocking(parseInt(e.target.value) || 0)}
                        className="w-24"
                      />
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setAutoStocking(autoStocking + 1)}
                        >
                          +
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setAutoStocking(Math.max(0, autoStocking - 1))}
                        >
                          -
                        </Button>
                      </div>
                    </div>

                    {/* Teleop Stocking */}
                    <div className="flex items-center gap-4">
                      <Label className="w-32">Teleop Stocking:</Label>
                      <Input
                        type="number"
                        value={teleopStocking}
                        onChange={(e) => setTeleopStocking(parseInt(e.target.value) || 0)}
                        className="w-24"
                      />
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setTeleopStocking(teleopStocking + 1)}
                        >
                          +
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setTeleopStocking(Math.max(0, teleopStocking - 1))}
                        >
                          -
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Ratings */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Ratings (1-5)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {/* Ground Rating */}
                    <div className="space-y-2">
                      <Label>Ground Intake:</Label>
                      <div className="flex gap-2">
                        {[1, 2, 3, 4, 5].map((rating) => (
                          <Button
                            key={rating}
                            size="sm"
                            variant={
                              matchData?.postMatch?.ratings?.ground === rating
                                ? "default"
                                : "outline"
                            }
                            onClick={() => {
                              setMatchData({
                                ...matchData!,
                                postMatch: {
                                  ...matchData!.postMatch,
                                  ratings: {
                                    ...matchData!.postMatch?.ratings,
                                    ground: rating as 1 | 2 | 3 | 4 | 5,
                                  },
                                },
                              });
                            }}
                            className="flex-1"
                          >
                            {rating}
                          </Button>
                        ))}
                      </div>
                    </div>

                    {/* Driver Rating */}
                    <div className="space-y-2">
                      <Label>Driver:</Label>
                      <div className="flex gap-2">
                        {[1, 2, 3, 4, 5].map((rating) => (
                          <Button
                            key={rating}
                            size="sm"
                            variant={
                              matchData?.postMatch?.ratings?.driver === rating
                                ? "default"
                                : "outline"
                            }
                            onClick={() => {
                              setMatchData({
                                ...matchData!,
                                postMatch: {
                                  ...matchData!.postMatch,
                                  ratings: {
                                    ...matchData!.postMatch?.ratings,
                                    driver: rating as 1 | 2 | 3 | 4 | 5,
                                  },
                                },
                              });
                            }}
                            className="flex-1"
                          >
                            {rating}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Notes */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Notes</CardTitle>
                </CardHeader>
                <CardContent>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Add any additional observations..."
                    className="min-h-[120px]"
                  />
                </CardContent>
              </Card>

              {/* Save Button */}
              <div className="flex justify-end gap-2">
                <Button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="min-w-32"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-2" />
                      Save Changes
                    </>
                  )}
                </Button>
              </div>
            </>
          )}

          {!selectedMatch && !isLoading && allMatchData.length > 0 && (
            <div className="text-center py-12 text-muted-foreground">
              Select a match to start editing
            </div>
          )}
        </CardContent>
      </Card>

      {/* Debug Info */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Debug Info</CardTitle>
            <Button size="sm" variant="outline" onClick={refreshQueueStatus}>
              <RefreshCw className="h-3 w-3 mr-1" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm font-mono">
            <p>Event: {currentEvent}</p>
            <p>Total Matches: {allMatchData.length}</p>
            <p>Selected: {selectedMatch || "None"}</p>
            <p>Has Match Data: {matchData ? "Yes" : "No"}</p>
            {matchData && (
              <>
                <p>Preset Actions: {matchData.presetActions.length}</p>
                <p>Location Actions: {matchData.locationActions.length}</p>
                <p>Toggle Actions: {matchData.toggleActions.length}</p>
                <p>Notes Length: {notes.length}</p>
              </>
            )}

            {/* Sync Queue Status */}
            <div className="pt-2 border-t space-y-1">
              <p className="font-semibold text-xs text-muted-foreground uppercase tracking-wide">Sync Queue</p>
              {queueStatus ? (
                <>
                  <p className={queueStatus.pending > 0 ? "text-yellow-500" : ""}>
                    Pending: {queueStatus.pending}
                  </p>
                  <p className={queueStatus.processing > 0 ? "text-blue-500" : ""}>
                    Processing: {queueStatus.processing}
                  </p>
                  <p className={queueStatus.failed > 0 ? "text-red-500 font-bold" : ""}>
                    Failed: {queueStatus.failed}
                  </p>
                  {queueStatus.failed > 0 && (
                    <Button
                      size="sm"
                      variant="destructive"
                      className="mt-2"
                      onClick={async () => {
                        await invoke("retry_failed_sync_queue");
                        await invoke("trigger_sync_now").catch(() => {});
                        toast.info("Retrying failed queue items...");
                        setTimeout(refreshQueueStatus, 1000);
                      }}
                    >
                      Retry {queueStatus.failed} Failed Item(s)
                    </Button>
                  )}
                </>
              ) : (
                <p className="text-muted-foreground">Loading...</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
