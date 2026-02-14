import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { Button } from "@shadcn/ui/components/button.tsx";
import { Input } from "@shadcn/ui/components/input.tsx";
import { Textarea } from "@shadcn/ui/components/textarea.tsx";
import { getMatchLabel } from "@lib/utils/match";
import { useOrientation } from "@lib/hooks/useOrientation";
import { RotateDevicePrompt } from "../components/RotateDevicePrompt";
import type {
  MatchScoutingData,
  PresetAction,
  LocationAction,
  ToggleAction,
  PresetActionType,
  LocationActionType,
  ToggleActionType,
} from "@lib/types/matchScouting";
import { getActiveToggles } from "@lib/types/matchScouting";
import { putMatchData } from "@lib/data/writes";
import { transformMatchData } from "@lib/data/matchDataTransform";
import { reverseTransformMatchData } from "@lib/data/matchDataTransform";
import { getSession } from "@lib/supabase/auth";
import { getLocalUserData } from "@lib/supabase/user";
import { useEvent } from "@lib/context/EventContext";
import { getMatchData } from "@lib/data/match-data";
import { toast } from "sonner";

type MatchEditStatsType = {
  teamNum?: string | null;
  matchNum?: string | null;
  alliance?: string | null;
  practice?: boolean | null;
};

export const Route = createFileRoute("/match_edit_stats")({
  component: MatchEditStats,
  validateSearch: (search: Record<string, unknown>): MatchEditStatsType => {
    return {
      teamNum: search.teamNum as string | undefined | null,
      matchNum: search.matchNum as string | undefined | null,
      alliance: search.alliance as string | undefined | null,
      practice: search.practice as boolean | undefined | null,
    };
  },
});

function MatchEditStats() {
  const { isWrongOrientation } = useOrientation('portrait');
  const navigate = useNavigate();
  const { teamNum, matchNum, alliance, practice } = Route.useSearch();
  const { currentEvent } = useEvent();
  const [matchData, setMatchData] = useState<MatchScoutingData | null>(null);
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Load match data - check both sessionStorage (from match_play) and Supabase (for editing)
  useEffect(() => {
    async function loadMatchData() {
      // First try sessionStorage (for new match flow from match_play)
      const saved = sessionStorage.getItem("currentMatchData");
      if (saved) {
        try {
          const data = JSON.parse(saved);
          setMatchData(data);
          setNotes(data.notes || "");
          return;
        } catch (error) {
          console.error("Failed to load match data from sessionStorage:", error);
        }
      }

      // If no sessionStorage and we have route params, try to load from Supabase
      if (currentEvent && teamNum && matchNum) {
        try {
          const allMatchData = await getMatchData(currentEvent);
          const existingData = allMatchData.find(
            (m) => m.team === teamNum && m.match === matchNum
          );

          // Check if data_raw exists and is not empty (ignore EPA/OPR - that's in team_data)
          if (existingData?.data_raw && Object.keys(existingData.data_raw).length > 0) {
            // Has actual scouting data - pre-populate form for editing
            const uiData = reverseTransformMatchData(existingData.data_raw);
            setMatchData(uiData);
            setNotes(uiData.notes || "");
          } else {
            // No existing data - initialize empty form for new entry
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
        } catch (error) {
          console.error("Failed to load match data from Supabase:", error);
          toast.error("Failed to load match data");
        }
      }
    }

    loadMatchData();
  }, [currentEvent, teamNum, matchNum]);

  const handleBack = () => {
    navigate({
      to: "/match_end",
      search: { teamNum, matchNum, alliance, practice },
    });
  };

  const handleSubmit = async () => {
    if (!matchData || !currentEvent || !teamNum || !matchNum) {
      toast.error("Missing match data");
      return;
    }

    // Validate alliance is not null
    if (!alliance || (alliance !== "red" && alliance !== "blue")) {
      toast.error("Alliance information is missing. Please restart from the match selection screen.");
      console.error("[MatchEditStats] Alliance is invalid:", alliance);
      return;
    }

    setIsSubmitting(true);

    try {
      // Get user session and local user data
      const session = await getSession();
      const localUser = getLocalUserData();
      const scoutName = localUser.name || session?.user?.email || "Unknown";
      const scoutUid = session?.user?.id || "unknown";

      // Complete match data with notes
      const completeMatchData: MatchScoutingData = {
        ...matchData,
        notes,
        scoutName,
        scoutUid,
      };

      // Transform to database format
      const transformedData = transformMatchData(completeMatchData, 2025);

      // Upload via offline-first pattern (alliance is validated above)
      await putMatchData(
        currentEvent,
        matchNum,
        teamNum,
        transformedData,
        scoutUid,
        alliance as "red" | "blue",
        { name: scoutName }
      );

      // Clear sessionStorage
      sessionStorage.removeItem("currentMatchData");

      toast.success("Match data uploaded!");

      // Navigate back to home page
      navigate({ to: "/home" });
    } catch (error) {
      console.error("Failed to upload:", error);
      toast.error("Failed to upload match data");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Check if form is complete (all ratings filled and notes not empty)
  const isFormComplete =
    matchData?.postMatch?.ratings?.ground !== undefined &&
    matchData?.postMatch?.ratings?.station !== undefined &&
    matchData?.postMatch?.ratings?.passing !== undefined &&
    matchData?.postMatch?.ratings?.driver !== undefined &&
    notes.trim() !== "";

  // Helper functions to add/remove actions
  const addFuelAction = (
    fuelType: PresetActionType,
    phase: "auto" | "teleop"
  ) => {
    if (!matchData) return;
    const newAction: PresetAction = {
      type: fuelType,
      timestamp: Date.now(),
      phase,
    };
    setMatchData({
      ...matchData,
      presetActions: [...matchData.presetActions, newAction],
    });
  };

  const removeFuelAction = (
    fuelType: PresetActionType,
    phase: "auto" | "teleop"
  ) => {
    if (!matchData) return;
    const index = matchData.presetActions.findLastIndex(
      (a) => a.type === fuelType && a.phase === phase
    );
    if (index !== -1) {
      const newActions = [...matchData.presetActions];
      newActions.splice(index, 1);
      setMatchData({
        ...matchData,
        presetActions: newActions,
      });
    }
  };

  const addLocationAction = (
    actionType: LocationActionType,
    phase: "auto" | "teleop"
  ) => {
    if (!matchData) return;
    const newAction: LocationAction = {
      type: actionType,
      timestamp: Date.now(),
      coords: [0.5, 0.5], // Default center position for manually added actions
      phase,
    };
    setMatchData({
      ...matchData,
      locationActions: [...matchData.locationActions, newAction],
    });
  };

  const removeLocationAction = (
    actionType: LocationActionType,
    phase: "auto" | "teleop"
  ) => {
    if (!matchData) return;
    const index = matchData.locationActions.findLastIndex(
      (a) => a.type === actionType && a.phase === phase
    );
    if (index !== -1) {
      const newActions = [...matchData.locationActions];
      newActions.splice(index, 1);
      setMatchData({
        ...matchData,
        locationActions: newActions,
      });
    }
  };

  // Get active toggle states using the same helper as match_play
  const activeToggles = useMemo(
    () => getActiveToggles(matchData?.toggleActions || []),
    [matchData?.toggleActions]
  );

  const toggleAction = (
    actionType: ToggleActionType,
    phase: "auto" | "teleop" | "endgame" = "teleop"
  ) => {
    if (!matchData) return;

    // Use activeToggles to get current state across all phases
    const currentlyActive = activeToggles[actionType];

    // Handle climb exclusivity - only one climb level can be active at a time
    const newActions: ToggleAction[] = [];
    if (actionType.startsWith("climb_") && !currentlyActive) {
      // Deactivate any other active climb levels
      const climbTypes: ToggleActionType[] = [
        "climb_L1",
        "climb_L2",
        "climb_L3",
      ];
      climbTypes.forEach((climbType) => {
        if (climbType !== actionType && activeToggles[climbType]) {
          newActions.push({
            type: climbType,
            timestamp: Date.now(),
            active: false,
            phase,
          });
        }
      });
    }

    const newAction: ToggleAction = {
      type: actionType,
      timestamp: Date.now(),
      active: !currentlyActive,
      phase,
    };

    setMatchData({
      ...matchData,
      toggleActions: [...matchData.toggleActions, ...newActions, newAction],
    });
  };

  // Calculate stats
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
  const autoIntakes =
    matchData?.locationActions.filter(
      (a) => a.type === "ground_intake" && a.phase === "auto"
    ).length || 0;
  const teleopIntakes =
    matchData?.locationActions.filter(
      (a) => a.type === "ground_intake" && a.phase === "teleop"
    ).length || 0;
  const autoPasses =
    matchData?.locationActions.filter(
      (a) => a.type === "passing" && a.phase === "auto"
    ).length || 0;
  const teleopPasses =
    matchData?.locationActions.filter(
      (a) => a.type === "passing" && a.phase === "teleop"
    ).length || 0;
  const autoShoots =
    matchData?.locationActions.filter(
      (a) => a.type === "shoot" && a.phase === "auto"
    ).length || 0;
  const teleopShoots =
    matchData?.locationActions.filter(
      (a) => a.type === "shoot" && a.phase === "teleop"
    ).length || 0;

  // Use activeToggles for state (checks across all phases)
  const hasAutoClimb =
    matchData?.toggleActions.some(
      (a) => a.type === "climb_L1" && a.active && a.phase === "auto"
    ) || false;
  const wasDisabled = activeToggles.disable;
  const didDefend = activeToggles.defend;

  // For climb level, check which climb is active (L1, L2, or L3)
  const climbLevel = activeToggles.climb_L3
    ? "3"
    : activeToggles.climb_L2
      ? "2"
      : activeToggles.climb_L1
        ? "1"
        : null;

  // Direct value setters for preset actions
  const setAutoStation = (value: number) => {
    if (!matchData) return;
    const filtered = matchData.presetActions.filter(
      (a) => !(a.type === "station_intake" && a.phase === "auto")
    );
    const newActions: PresetAction[] = [];
    for (let i = 0; i < Math.max(0, value); i++) {
      newActions.push({
        type: "station_intake",
        timestamp: Date.now(),
        phase: "auto",
      });
    }
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
    const newActions: PresetAction[] = [];
    for (let i = 0; i < Math.max(0, value); i++) {
      newActions.push({
        type: "station_intake",
        timestamp: Date.now(),
        phase: "teleop",
      });
    }
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
    const newActions: PresetAction[] = [];
    for (let i = 0; i < Math.max(0, value); i++) {
      newActions.push({
        type: "stocking",
        timestamp: Date.now(),
        phase: "auto",
      });
    }
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
    const newActions: PresetAction[] = [];
    for (let i = 0; i < Math.max(0, value); i++) {
      newActions.push({
        type: "stocking",
        timestamp: Date.now(),
        phase: "teleop",
      });
    }
    setMatchData({
      ...matchData,
      presetActions: [...filtered, ...newActions],
    });
  };

  const setAutoIntakes = (value: number) => {
    if (!matchData) return;
    const filtered = matchData.locationActions.filter(
      (a) => !(a.type === "ground_intake" && a.phase === "auto")
    );
    const newActions: LocationAction[] = [];
    for (let i = 0; i < Math.max(0, value); i++) {
      newActions.push({
        type: "ground_intake",
        timestamp: Date.now(),
        coords: [0.5, 0.5],
        phase: "auto",
      });
    }
    setMatchData({
      ...matchData,
      locationActions: [...filtered, ...newActions],
    });
  };

  const setTeleopIntakes = (value: number) => {
    if (!matchData) return;
    const filtered = matchData.locationActions.filter(
      (a) => !(a.type === "ground_intake" && a.phase === "teleop")
    );
    const newActions: LocationAction[] = [];
    for (let i = 0; i < Math.max(0, value); i++) {
      newActions.push({
        type: "ground_intake",
        timestamp: Date.now(),
        coords: [0.5, 0.5],
        phase: "teleop",
      });
    }
    setMatchData({
      ...matchData,
      locationActions: [...filtered, ...newActions],
    });
  };

  const setAutoPasses = (value: number) => {
    if (!matchData) return;
    const filtered = matchData.locationActions.filter(
      (a) => !(a.type === "passing" && a.phase === "auto")
    );
    const newActions: LocationAction[] = [];
    for (let i = 0; i < Math.max(0, value); i++) {
      newActions.push({
        type: "passing",
        timestamp: Date.now(),
        coords: [0.5, 0.5],
        phase: "auto",
      });
    }
    setMatchData({
      ...matchData,
      locationActions: [...filtered, ...newActions],
    });
  };

  const setTeleopPasses = (value: number) => {
    if (!matchData) return;
    const filtered = matchData.locationActions.filter(
      (a) => !(a.type === "passing" && a.phase === "teleop")
    );
    const newActions: LocationAction[] = [];
    for (let i = 0; i < Math.max(0, value); i++) {
      newActions.push({
        type: "passing",
        timestamp: Date.now(),
        coords: [0.5, 0.5],
        phase: "teleop",
      });
    }
    setMatchData({
      ...matchData,
      locationActions: [...filtered, ...newActions],
    });
  };

  const setAutoShoots = (value: number) => {
    if (!matchData) return;
    const filtered = matchData.locationActions.filter(
      (a) => !(a.type === "shoot" && a.phase === "auto")
    );
    const newActions: LocationAction[] = [];
    for (let i = 0; i < Math.max(0, value); i++) {
      newActions.push({
        type: "shoot",
        timestamp: Date.now(),
        coords: [0.5, 0.5],
        phase: "auto",
      });
    }
    setMatchData({
      ...matchData,
      locationActions: [...filtered, ...newActions],
    });
  };

  const setTeleopShoots = (value: number) => {
    if (!matchData) return;
    const filtered = matchData.locationActions.filter(
      (a) => !(a.type === "shoot" && a.phase === "teleop")
    );
    const newActions: LocationAction[] = [];
    for (let i = 0; i < Math.max(0, value); i++) {
      newActions.push({
        type: "shoot",
        timestamp: Date.now(),
        coords: [0.5, 0.5],
        phase: "teleop",
      });
    }
    setMatchData({
      ...matchData,
      locationActions: [...filtered, ...newActions],
    });
  };

  return (
    <>
      {isWrongOrientation && <RotateDevicePrompt message="Please rotate to portrait mode to edit match data" />}
      <div className="flex flex-col w-screen h-screen gap-5 p-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <svg
            viewBox="0 0 25 20"
            onClick={handleBack}
            fill="currentColor"
            className="w-6 h-6 cursor-pointer"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              fill="#CDA745"
              d="M12.1688 5.04384L4.16666 11.6345V18.7478C4.16666 18.932 4.23983 19.1086 4.37006 19.2389C4.50029 19.3691 4.67693 19.4423 4.8611 19.4423L9.72482 19.4297C9.9084 19.4288 10.0841 19.3552 10.2136 19.2251C10.3431 19.0949 10.4158 18.9188 10.4158 18.7352V14.5812C10.4158 14.397 10.489 14.2204 10.6192 14.0901C10.7494 13.9599 10.9261 13.8867 11.1102 13.8867H13.888C14.0722 13.8867 14.2488 13.9599 14.3791 14.0901C14.5093 14.2204 14.5825 14.397 14.5825 14.5812V18.7322C14.5822 18.8236 14.5999 18.9141 14.6347 18.9986C14.6695 19.0831 14.7206 19.1599 14.7851 19.2247C14.8496 19.2894 14.9263 19.3407 15.0106 19.3758C15.095 19.4108 15.1855 19.4288 15.2769 19.4288L20.1389 19.4423C20.3231 19.4423 20.4997 19.3691 20.6299 19.2389C20.7602 19.1086 20.8333 18.932 20.8333 18.7478V11.6298L12.8329 5.04384C12.7388 4.96802 12.6217 4.92668 12.5009 4.92668C12.3801 4.92668 12.2629 4.96802 12.1688 5.04384ZM24.809 9.52344L21.1805 6.53255V0.520833C21.1805 0.3827 21.1257 0.250224 21.028 0.152549C20.9303 0.0548735 20.7978 0 20.6597 0H18.2292C18.091 0 17.9585 0.0548735 17.8609 0.152549C17.7632 0.250224 17.7083 0.3827 17.7083 0.520833V3.67231L13.8225 0.47526C13.4496 0.168394 12.9816 0.000613431 12.4987 0.000613431C12.0158 0.000613431 11.5478 0.168394 11.1749 0.47526L0.188362 9.52344C0.135623 9.56703 0.0919888 9.62058 0.0599541 9.68104C0.0279193 9.7415 0.00811156 9.80768 0.00166252 9.8758C-0.00478653 9.94392 0.00224954 10.0126 0.0223687 10.078C0.0424879 10.1434 0.0752958 10.2042 0.118918 10.2569L1.22569 11.6024C1.26919 11.6553 1.3227 11.6991 1.38315 11.7313C1.44361 11.7635 1.50981 11.7835 1.57799 11.79C1.64616 11.7966 1.71496 11.7897 1.78045 11.7696C1.84593 11.7496 1.90682 11.7168 1.95963 11.6732L12.1688 3.26432C12.2629 3.18851 12.3801 3.14717 12.5009 3.14717C12.6217 3.14717 12.7388 3.18851 12.8329 3.26432L23.0425 11.6732C23.0952 11.7168 23.156 11.7496 23.2214 11.7697C23.2868 11.7898 23.3556 11.7969 23.4237 11.7904C23.4918 11.784 23.558 11.7642 23.6184 11.7321C23.6789 11.7001 23.7324 11.6565 23.776 11.6037L24.8828 10.2582C24.9264 10.2052 24.9591 10.1441 24.9789 10.0784C24.9988 10.0128 25.0055 9.94379 24.9987 9.8755C24.9918 9.80722 24.9715 9.74096 24.939 9.68054C24.9064 9.62012 24.8623 9.56673 24.809 9.52344Z"
            />
          </svg>
          <div className="text-outfit">
            <p className="text-[#CDA745] text-sm">
              {matchNum ? getMatchLabel(matchNum) : ""}
            </p>
            <p className="text-foreground text-xs">
              {teamNum?.substring(teamNum.indexOf("frc") + 3)}
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto pb-20">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Data Table */}
          <div className="rounded-2xl bg-muted p-6 space-y-4">
            <h2 className="text-lg font-semibold text-primary">Match Data</h2>

            {/* Table */}
            <div className="space-y-3">
              {/* Header Row */}
              <div className="grid grid-cols-3 gap-4 pb-2 border-b border-border">
                <div className="text-sm font-semibold text-muted-foreground">
                  Metric
                </div>
                <div className="text-sm font-semibold text-[#CDA745] text-center">
                  Autonomous
                </div>
                <div className="text-sm font-semibold text-[#CDA745] text-center">
                  Teleop
                </div>
              </div>

              {/* Station Intake Row */}
              <div className="grid grid-cols-3 gap-4 items-center">
                <div className="text-sm text-foreground">Station Intake</div>
                <div className="flex items-center justify-center gap-2">
                  <Input
                    type="number"
                    value={autoStation}
                    onChange={(e) => setAutoStation(parseInt(e.target.value) || 0)}
                    className="h-8 w-16 text-center bg-background border-border"
                  />
                  <div className="flex flex-col gap-0.5">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setAutoStation(autoStation + 1)}
                      className="h-4.5 w-7 p-0 flex items-center justify-center"
                    >
                      <svg width="14" height="14" viewBox="0 0 12 12" fill="currentColor">
                        <path d="M6 3L9 7H3L6 3Z" />
                      </svg>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setAutoStation(autoStation - 1)}
                      className="h-4.5 w-7 p-0 flex items-center justify-center"
                    >
                      <svg width="14" height="14" viewBox="0 0 12 12" fill="currentColor">
                        <path d="M6 9L3 5H9L6 9Z" />
                      </svg>
                    </Button>
                  </div>
                </div>
                <div className="flex items-center justify-center gap-2">
                  <Input
                    type="number"
                    value={teleopStation}
                    onChange={(e) =>
                      setTeleopStation(parseInt(e.target.value) || 0)
                    }
                    className="h-8 w-16 text-center bg-background border-border"
                  />
                  <div className="flex flex-col gap-0.5">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setTeleopStation(teleopStation + 1)}
                      className="h-4.5 w-7 p-0 flex items-center justify-center"
                    >
                      <svg width="14" height="14" viewBox="0 0 12 12" fill="currentColor">
                        <path d="M6 3L9 7H3L6 3Z" />
                      </svg>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setTeleopStation(teleopStation - 1)}
                      className="h-4.5 w-7 p-0 flex items-center justify-center"
                    >
                      <svg width="14" height="14" viewBox="0 0 12 12" fill="currentColor">
                        <path d="M6 9L3 5H9L6 9Z" />
                      </svg>
                    </Button>
                  </div>
                </div>
              </div>

              {/* Stocking Row */}
              <div className="grid grid-cols-3 gap-4 items-center">
                <div className="text-sm text-foreground">Stocking</div>
                <div className="flex items-center justify-center gap-2">
                  <Input
                    type="number"
                    value={autoStocking}
                    onChange={(e) => setAutoStocking(parseInt(e.target.value) || 0)}
                    className="h-8 w-16 text-center bg-background border-border"
                  />
                  <div className="flex flex-col gap-0.5">
                    <Button size="sm" variant="outline" onClick={() => setAutoStocking(autoStocking + 1)} className="h-4.5 w-7 p-0 flex items-center justify-center">
                      <svg width="14" height="14" viewBox="0 0 12 12" fill="currentColor"><path d="M6 3L9 7H3L6 3Z" /></svg>
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setAutoStocking(autoStocking - 1)} className="h-4.5 w-7 p-0 flex items-center justify-center">
                      <svg width="14" height="14" viewBox="0 0 12 12" fill="currentColor"><path d="M6 9L3 5H9L6 9Z" /></svg>
                    </Button>
                  </div>
                </div>
                <div className="flex items-center justify-center gap-2">
                  <Input
                    type="number"
                    value={teleopStocking}
                    onChange={(e) => setTeleopStocking(parseInt(e.target.value) || 0)}
                    className="h-8 w-16 text-center bg-background border-border"
                  />
                  <div className="flex flex-col gap-0.5">
                    <Button size="sm" variant="outline" onClick={() => setTeleopStocking(teleopStocking + 1)} className="h-4.5 w-7 p-0 flex items-center justify-center">
                      <svg width="14" height="14" viewBox="0 0 12 12" fill="currentColor"><path d="M6 3L9 7H3L6 3Z" /></svg>
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setTeleopStocking(teleopStocking - 1)} className="h-4.5 w-7 p-0 flex items-center justify-center">
                      <svg width="14" height="14" viewBox="0 0 12 12" fill="currentColor"><path d="M6 9L3 5H9L6 9Z" /></svg>
                    </Button>
                  </div>
                </div>
              </div>

              {/* Ground Intakes Row */}
              <div className="grid grid-cols-3 gap-4 items-center">
                <div className="text-sm text-foreground">Ground Intake</div>
                <div className="flex items-center justify-center gap-2">
                  <Input
                    type="number"
                    value={autoIntakes}
                    onChange={(e) => setAutoIntakes(parseInt(e.target.value) || 0)}
                    className="h-8 w-16 text-center bg-background border-border"
                  />
                  <div className="flex flex-col gap-0.5">
                    <Button size="sm" variant="outline" onClick={() => setAutoIntakes(autoIntakes + 1)} className="h-4.5 w-7 p-0 flex items-center justify-center">
                      <svg width="14" height="14" viewBox="0 0 12 12" fill="currentColor"><path d="M6 3L9 7H3L6 3Z" /></svg>
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setAutoIntakes(autoIntakes - 1)} className="h-4.5 w-7 p-0 flex items-center justify-center">
                      <svg width="14" height="14" viewBox="0 0 12 12" fill="currentColor"><path d="M6 9L3 5H9L6 9Z" /></svg>
                    </Button>
                  </div>
                </div>
                <div className="flex items-center justify-center gap-2">
                  <Input
                    type="number"
                    value={teleopIntakes}
                    onChange={(e) => setTeleopIntakes(parseInt(e.target.value) || 0)}
                    className="h-8 w-16 text-center bg-background border-border"
                  />
                  <div className="flex flex-col gap-0.5">
                    <Button size="sm" variant="outline" onClick={() => setTeleopIntakes(teleopIntakes + 1)} className="h-4.5 w-7 p-0 flex items-center justify-center">
                      <svg width="14" height="14" viewBox="0 0 12 12" fill="currentColor"><path d="M6 3L9 7H3L6 3Z" /></svg>
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setTeleopIntakes(teleopIntakes - 1)} className="h-4.5 w-7 p-0 flex items-center justify-center">
                      <svg width="14" height="14" viewBox="0 0 12 12" fill="currentColor"><path d="M6 9L3 5H9L6 9Z" /></svg>
                    </Button>
                  </div>
                </div>
              </div>

              {/* Passes Row */}
              <div className="grid grid-cols-3 gap-4 items-center">
                <div className="text-sm text-foreground">Passing</div>
                <div className="flex items-center justify-center gap-2">
                  <Input
                    type="number"
                    value={autoPasses}
                    onChange={(e) => setAutoPasses(parseInt(e.target.value) || 0)}
                    className="h-8 w-16 text-center bg-background border-border"
                  />
                  <div className="flex flex-col gap-0.5">
                    <Button size="sm" variant="outline" onClick={() => setAutoPasses(autoPasses + 1)} className="h-4.5 w-7 p-0 flex items-center justify-center">
                      <svg width="14" height="14" viewBox="0 0 12 12" fill="currentColor"><path d="M6 3L9 7H3L6 3Z" /></svg>
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setAutoPasses(autoPasses - 1)} className="h-4.5 w-7 p-0 flex items-center justify-center">
                      <svg width="14" height="14" viewBox="0 0 12 12" fill="currentColor"><path d="M6 9L3 5H9L6 9Z" /></svg>
                    </Button>
                  </div>
                </div>
                <div className="flex items-center justify-center gap-2">
                  <Input
                    type="number"
                    value={teleopPasses}
                    onChange={(e) => setTeleopPasses(parseInt(e.target.value) || 0)}
                    className="h-8 w-16 text-center bg-background border-border"
                  />
                  <div className="flex flex-col gap-0.5">
                    <Button size="sm" variant="outline" onClick={() => setTeleopPasses(teleopPasses + 1)} className="h-4.5 w-7 p-0 flex items-center justify-center">
                      <svg width="14" height="14" viewBox="0 0 12 12" fill="currentColor"><path d="M6 3L9 7H3L6 3Z" /></svg>
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setTeleopPasses(teleopPasses - 1)} className="h-4.5 w-7 p-0 flex items-center justify-center">
                      <svg width="14" height="14" viewBox="0 0 12 12" fill="currentColor"><path d="M6 9L3 5H9L6 9Z" /></svg>
                    </Button>
                  </div>
                </div>
              </div>

              {/* Shoots Row */}
              <div className="grid grid-cols-3 gap-4 items-center">
                <div className="text-sm text-foreground">Shooting</div>
                <div className="flex items-center justify-center gap-2">
                  <Input
                    type="number"
                    value={autoShoots}
                    onChange={(e) => setAutoShoots(parseInt(e.target.value) || 0)}
                    className="h-8 w-16 text-center bg-background border-border"
                  />
                  <div className="flex flex-col gap-0.5">
                    <Button size="sm" variant="outline" onClick={() => setAutoShoots(autoShoots + 1)} className="h-4.5 w-7 p-0 flex items-center justify-center">
                      <svg width="14" height="14" viewBox="0 0 12 12" fill="currentColor"><path d="M6 3L9 7H3L6 3Z" /></svg>
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setAutoShoots(autoShoots - 1)} className="h-4.5 w-7 p-0 flex items-center justify-center">
                      <svg width="14" height="14" viewBox="0 0 12 12" fill="currentColor"><path d="M6 9L3 5H9L6 9Z" /></svg>
                    </Button>
                  </div>
                </div>
                <div className="flex items-center justify-center gap-2">
                  <Input
                    type="number"
                    value={teleopShoots}
                    onChange={(e) => setTeleopShoots(parseInt(e.target.value) || 0)}
                    className="h-8 w-16 text-center bg-background border-border"
                  />
                  <div className="flex flex-col gap-0.5">
                    <Button size="sm" variant="outline" onClick={() => setTeleopShoots(teleopShoots + 1)} className="h-4.5 w-7 p-0 flex items-center justify-center">
                      <svg width="14" height="14" viewBox="0 0 12 12" fill="currentColor"><path d="M6 3L9 7H3L6 3Z" /></svg>
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setTeleopShoots(teleopShoots - 1)} className="h-4.5 w-7 p-0 flex items-center justify-center">
                      <svg width="14" height="14" viewBox="0 0 12 12" fill="currentColor"><path d="M6 9L3 5H9L6 9Z" /></svg>
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Toggle Actions */}
          <div className="rounded-2xl bg-muted p-6 space-y-4">
            <h2 className="text-lg font-semibold text-primary">
              Endgame & Status
            </h2>

            <div className="space-y-3">
              <div>
                <p className="text-xs text-muted-foreground mb-2">Autonomous</p>
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    variant={hasAutoClimb ? "default" : "outline"}
                    onClick={() => toggleAction("climb_L1", "auto")}
                    className={hasAutoClimb ? "bg-[#4ADE80] text-black hover:bg-[#4ADE80]/90" : ""}
                  >
                    {hasAutoClimb ? "Auto Climb ✓" : "Auto Climb"}
                  </Button>
                  <Button
                    variant={activeToggles.climb_dismount ? "default" : "outline"}
                    onClick={() => toggleAction("climb_dismount", "auto")}
                    className={activeToggles.climb_dismount ? "bg-[#4ADE80] text-black hover:bg-[#4ADE80]/90" : ""}
                  >
                    {activeToggles.climb_dismount ? "Climb Dismount ✓" : "Climb Dismount"}
                  </Button>
                </div>
              </div>

              <div>
                <p className="text-xs text-muted-foreground mb-2">
                  Teleop & Endgame
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    variant={didDefend ? "default" : "outline"}
                    onClick={() => toggleAction("defend", "teleop")}
                    className={didDefend ? "bg-[#CDA745] text-black hover:bg-[#CDA745]/90" : ""}
                  >
                    {didDefend ? "Defense ✓" : "Defense"}
                  </Button>

                  <Button
                    variant={wasDisabled ? "destructive" : "outline"}
                    onClick={() => toggleAction("disable", "teleop")}
                  >
                    {wasDisabled ? "Disabled ✓" : "Disabled"}
                  </Button>

                  <Button
                    variant={climbLevel === "1" ? "default" : "outline"}
                    onClick={() => toggleAction("climb_L1", "endgame")}
                    className={climbLevel === "1" ? "bg-[#4ADE80] text-black hover:bg-[#4ADE80]/90" : ""}
                  >
                    {climbLevel === "1" ? "Climb L1 ✓" : "Climb L1"}
                  </Button>

                  <Button
                    variant={climbLevel === "2" ? "default" : "outline"}
                    onClick={() => toggleAction("climb_L2", "endgame")}
                    className={climbLevel === "2" ? "bg-[#4ADE80] text-black hover:bg-[#4ADE80]/90" : ""}
                  >
                    {climbLevel === "2" ? "Climb L2 ✓" : "Climb L2"}
                  </Button>

                  <Button
                    variant={climbLevel === "3" ? "default" : "outline"}
                    onClick={() => toggleAction("climb_L3", "endgame")}
                    className={climbLevel === "3" ? "bg-[#4ADE80] text-black hover:bg-[#4ADE80]/90" : ""}
                  >
                    {climbLevel === "3" ? "Climb L3 ✓" : "Climb L3"}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Ratings */}
          <div className="rounded-2xl bg-muted p-6 space-y-4">
            <h2 className="text-lg font-semibold text-primary">Ratings (1-5)</h2>
            <div className="space-y-4">
              {/* Ground Rating */}
              <div className="space-y-2">
                <p className="text-sm text-foreground">Ground Intake</p>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((rating) => (
                    <Button
                      key={rating}
                      size="sm"
                      variant={matchData?.postMatch?.ratings?.ground === rating ? "default" : "outline"}
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
                      className={`flex-1 ${matchData?.postMatch?.ratings?.ground === rating ? "bg-[#CDA745] text-black hover:bg-[#CDA745]/90" : ""}`}
                    >
                      {rating}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Station Rating */}
              <div className="space-y-2">
                <p className="text-sm text-foreground">Station Intake</p>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((rating) => (
                    <Button
                      key={rating}
                      size="sm"
                      variant={matchData?.postMatch?.ratings?.station === rating ? "default" : "outline"}
                      onClick={() => {
                        setMatchData({
                          ...matchData!,
                          postMatch: {
                            ...matchData!.postMatch,
                            ratings: {
                              ...matchData!.postMatch?.ratings,
                              station: rating as 1 | 2 | 3 | 4 | 5,
                            },
                          },
                        });
                      }}
                      className={`flex-1 ${matchData?.postMatch?.ratings?.station === rating ? "bg-[#CDA745] text-black hover:bg-[#CDA745]/90" : ""}`}
                    >
                      {rating}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Passing Rating */}
              <div className="space-y-2">
                <p className="text-sm text-foreground">Passing</p>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((rating) => (
                    <Button
                      key={rating}
                      size="sm"
                      variant={matchData?.postMatch?.ratings?.passing === rating ? "default" : "outline"}
                      onClick={() => {
                        setMatchData({
                          ...matchData!,
                          postMatch: {
                            ...matchData!.postMatch,
                            ratings: {
                              ...matchData!.postMatch?.ratings,
                              passing: rating as 1 | 2 | 3 | 4 | 5,
                            },
                          },
                        });
                      }}
                      className={`flex-1 ${matchData?.postMatch?.ratings?.passing === rating ? "bg-[#CDA745] text-black hover:bg-[#CDA745]/90" : ""}`}
                    >
                      {rating}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Driver Rating */}
              <div className="space-y-2">
                <p className="text-sm text-foreground">Driver</p>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((rating) => (
                    <Button
                      key={rating}
                      size="sm"
                      variant={matchData?.postMatch?.ratings?.driver === rating ? "default" : "outline"}
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
                      className={`flex-1 ${matchData?.postMatch?.ratings?.driver === rating ? "bg-[#CDA745] text-black hover:bg-[#CDA745]/90" : ""}`}
                    >
                      {rating}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Capabilities */}
          <div className="rounded-2xl bg-muted py-6 px-5 space-y-4">
            <h2 className="text-lg font-semibold text-primary">Capabilities</h2>
            <div className="flex gap-2 overflow-x-auto pb-2">
              <Button
                size="sm"
                variant={matchData?.postMatch?.depot ? "default" : "outline"}
                onClick={() => {
                  setMatchData({
                    ...matchData!,
                    postMatch: {
                      ...matchData!.postMatch,
                      depot: !matchData?.postMatch?.depot,
                    },
                  });
                }}
                className={`flex-1 ${matchData?.postMatch?.depot ? "bg-[#4ADE80] text-black hover:bg-[#4ADE80]/90" : ""}`}
              >
                Depot
              </Button>
              <Button
                size="sm"
                variant={matchData?.postMatch?.through ? "default" : "outline"}
                onClick={() => {
                  setMatchData({
                    ...matchData!,
                    postMatch: {
                      ...matchData!.postMatch,
                      through: !matchData?.postMatch?.through,
                    },
                  });
                }}
                className={`flex-1 ${matchData?.postMatch?.through ? "bg-[#4ADE80] text-black hover:bg-[#4ADE80]/90" : ""}`}
              >
                Trough
              </Button>
              <Button
                size="sm"
                variant={matchData?.postMatch?.climb_orientation === 'left' ? "default" : "outline"}
                onClick={() => {
                  setMatchData({
                    ...matchData!,
                    postMatch: {
                      ...matchData!.postMatch,
                      climb_orientation: matchData?.postMatch?.climb_orientation === 'left' ? undefined : 'left',
                    },
                  });
                }}
                className={`flex-1 ${matchData?.postMatch?.climb_orientation === 'left' ? "bg-[#4ADE80] text-black hover:bg-[#4ADE80]/90" : ""}`}
              >
                Climb Left
              </Button>
              <Button
                size="sm"
                variant={matchData?.postMatch?.climb_orientation === 'right' ? "default" : "outline"}
                onClick={() => {
                  setMatchData({
                    ...matchData!,
                    postMatch: {
                      ...matchData!.postMatch,
                      climb_orientation: matchData?.postMatch?.climb_orientation === 'right' ? undefined : 'right',
                    },
                  });
                }}
                className={`flex-1 ${matchData?.postMatch?.climb_orientation === 'right' ? "bg-[#4ADE80] text-black hover:bg-[#4ADE80]/90" : ""}`}
              >
                Climb Right
              </Button>
              <Button
                size="sm"
                variant={matchData?.postMatch?.climb_orientation === 'center' ? "default" : "outline"}
                onClick={() => {
                  setMatchData({
                    ...matchData!,
                    postMatch: {
                      ...matchData!.postMatch,
                      climb_orientation: matchData?.postMatch?.climb_orientation === 'center' ? undefined : 'center',
                    },
                  });
                }}
                className={`flex-1 ${matchData?.postMatch?.climb_orientation === 'center' ? "bg-[#4ADE80] text-black hover:bg-[#4ADE80]/90" : ""}`}
              >
                Climb Center
              </Button>
            </div>
          </div>

          {/* Notes */}
          <div className="rounded-2xl bg-muted p-6 space-y-4">
            <h2 className="text-lg font-semibold text-primary">Notes</h2>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any additional observations..."
              className="min-h-[120px] bg-background border-border"
            />
          </div>
        </div>
      </div>

      {/* Submit Button - Fixed at bottom */}
      <div className="fixed bottom-4 left-4 right-4 z-40">
        <Button
          onClick={handleSubmit}
          disabled={!isFormComplete || isSubmitting}
          className="w-full h-12 bg-[#CDA745] hover:bg-[#CDA745]/90 text-black disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? "Uploading..." : "Submit"}
        </Button>
      </div>
    </div>
    </>
  );
}
