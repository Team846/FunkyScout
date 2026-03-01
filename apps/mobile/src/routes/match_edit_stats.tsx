import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { Button } from "@shadcn/ui/components/button.tsx";
import { Input } from "@shadcn/ui/components/input.tsx";
import { Textarea } from "@shadcn/ui/components/textarea.tsx";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@shadcn/ui/components/collapsible.tsx";
import { ChevronDown, ChevronUp } from "lucide-react";
import { getMatchLabel } from "@lib/utils/match";
import { useOrientation } from "@lib/hooks/useOrientation";
import { RotateDevicePrompt } from "../components/RotateDevicePrompt";
import type {
  MatchScoutingData,
  PresetAction,
  LocationAction,
  ToggleAction,
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
import { getEventTeamData } from "@lib/db";
import { AutoPathDisplay } from "../components/AutoPathDisplay";
import type { DrawingData } from "../components/auto-path-drawer/types";
import { toast } from "sonner";

type TeamAuto = {
  name?: string;
  description?: string;
  climbDuringAuto: boolean;
  drawing: { paths: unknown[]; canvasWidth: number; canvasHeight: number };
};

type MatchEditStatsType = {
  teamNum?: string | null;
  matchNum?: string | null;
  alliance?: string | null;
  practice?: boolean | null;
  fromView?: string | null; // "scouting" or "teamView" - determines home button behavior
  fromMatchEnd?: boolean | null; // true when navigating directly from match end screen
};

export const Route = createFileRoute("/match_edit_stats")({
  component: MatchEditStats,
  validateSearch: (search: Record<string, unknown>): MatchEditStatsType => {
    return {
      teamNum: search.teamNum as string | undefined | null,
      matchNum: search.matchNum as string | undefined | null,
      alliance: search.alliance as string | undefined | null,
      practice: search.practice as boolean | undefined | null,
      fromView: search.fromView as string | undefined | null,
      fromMatchEnd: search.fromMatchEnd as boolean | undefined | null,
    };
  },
});

function MatchEditStats() {
  const { isWrongOrientation } = useOrientation("portrait");
  const navigate = useNavigate();
  const { teamNum, matchNum, alliance, practice, fromView, fromMatchEnd } = Route.useSearch();
  const { currentEvent } = useEvent();
  const [matchData, setMatchData] = useState<MatchScoutingData | null>(null);
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Actions and Endgame sections: start closed when from match end, open when from other routes
  const sectionsStartOpen = fromMatchEnd !== true;
  const [actionsOpen, setActionsOpen] = useState(sectionsStartOpen);
  const [endgameOpen, setEndgameOpen] = useState(sectionsStartOpen);
  const [autoSelectOpen, setAutoSelectOpen] = useState(sectionsStartOpen);

  const [teamAutos, setTeamAutos] = useState<TeamAuto[]>([]);
  const [autoIndex, setAutoIndex] = useState(0);

  useEffect(() => {
    const open = fromMatchEnd !== true;
    setActionsOpen(open);
    setEndgameOpen(open);
  }, [fromMatchEnd]);

  useEffect(() => {
    setAutoSelectOpen(true); // Always show auto section (selection or description)
  }, []);

  // Load match data - check both sessionStorage (from match_play) and Supabase (for editing)
  useEffect(() => {
    async function loadMatchData() {
      // Use match-specific sessionStorage key to prevent interference between matches
      const sessionKey = matchNum && teamNum
        ? `matchData_${matchNum}_${teamNum}`
        : "currentMatchData";

      console.log("[MatchEditStats] Loading match data:", {
        currentEvent,
        teamNum,
        matchNum,
        alliance,
        fromView,
        sessionKey,
        hasSessionStorage: !!sessionStorage.getItem(sessionKey),
      });

      // First try sessionStorage (for new match flow from match_play)
      const saved = sessionStorage.getItem(sessionKey);
      if (saved) {
        try {
          const data = JSON.parse(saved);
          console.log("[MatchEditStats] Loaded from sessionStorage:", {
            sessionKey,
            hasPresetActions: Array.isArray(data.presetActions),
            presetActionsCount: data.presetActions?.length ?? 0,
            hasRatings: !!data.postMatch?.ratings,
            notesLength: data.notes?.length ?? 0,
          });
          setMatchData(data);
          setNotes(data.notes || "");
          return;
        } catch (error) {
          console.error(
            "[MatchEditStats] Failed to load match data from sessionStorage:",
            error
          );
        }
      }

      // Practice mode: no Supabase, init empty form if no sessionStorage
      if (practice && teamNum && matchNum) {
        setMatchData({
          presetActions: [],
          locationActions: [],
          toggleActions: [],
          postMatch: { ratings: {} },
          selectedAuto: null,
          autoDescription: null,
          notes: "",
        });
        setNotes("");
        return;
      }

      // If no sessionStorage and we have route params, load from Supabase
      // (covers team view edit, past matches from ScoutingPage, etc.)
      if (currentEvent && teamNum && matchNum) {
        try {
          console.log("[MatchEditStats] Loading existing data from Supabase");

          const allMatchData = await getMatchData(currentEvent);
          const existingData = allMatchData.find(
            (m) => m.team === teamNum && m.match === matchNum
          );

          console.log("[MatchEditStats] Supabase query result:", {
            totalMatches: allMatchData.length,
            foundMatch: !!existingData,
            hasDataRaw: !!existingData?.data_raw,
            dataRawKeys: existingData?.data_raw
              ? Object.keys(existingData.data_raw)
              : [],
          });

          // Check if data_raw exists and is not empty (ignore EPA/OPR - that's in team_data)
          if (
            existingData?.data_raw &&
            Object.keys(existingData.data_raw).length > 0
          ) {
            // Has actual scouting data - pre-populate form for editing
            const uiData = reverseTransformMatchData(existingData.data_raw);
            console.log("[MatchEditStats] Pre-populating form with existing data");
            setMatchData(uiData);
            setNotes(uiData.notes || "");
          } else {
            // No existing data - initialize empty form
            console.log(
              "[MatchEditStats] No existing data found, initializing empty form"
            );
            setMatchData({
              presetActions: [],
              locationActions: [],
              toggleActions: [],
              postMatch: {
                ratings: {},
              },
              selectedAuto: null,
              autoDescription: null,
              notes: "",
            });
            setNotes("");
          }
        } catch (error) {
          console.error(
            "[MatchEditStats] Failed to load match data from Supabase:",
            error
          );
          toast.error("Failed to load match data");
        }
      }
    }

    loadMatchData();
  }, [currentEvent, teamNum, matchNum, practice]);

  // Load team autos from event_team_data (pit scouting) for auto selection
  useEffect(() => {
    if (!currentEvent || !teamNum) {
      setTeamAutos([]);
      return;
    }
    getEventTeamData(currentEvent).then((data) => {
      const teamData = data.find(
        (t) => t.team === teamNum || t.team === teamNum.replace(/^frc/i, "")
      );
      const raw = (teamData?.data as { autos?: unknown[] } | null)?.autos ?? [];
      if (!Array.isArray(raw)) {
        setTeamAutos([]);
        return;
      }
      const autos: TeamAuto[] = raw.map((a) => {
        const item = a as Record<string, unknown>;
        const drawing = item.drawing as { paths?: unknown[]; canvasWidth?: number; canvasHeight?: number } | null | undefined;
        return {
          name: (item.name as string | undefined) ?? undefined,
          description: (item.description as string | undefined) ?? undefined,
          climbDuringAuto: (item.climbDuringAuto ?? item.climb ?? false) as boolean,
          drawing: drawing && typeof drawing === "object"
            ? {
                paths: Array.isArray(drawing.paths) ? drawing.paths : [],
                canvasWidth: drawing.canvasWidth ?? 400,
                canvasHeight: drawing.canvasHeight ?? 200,
              }
            : { paths: [], canvasWidth: 400, canvasHeight: 200 },
        };
      });
      setTeamAutos(autos);
      setAutoIndex(0);
    });
  }, [currentEvent, teamNum]);

  const handleBack = () => {
    if (practice) {
      navigate({ to: "/practice" });
      return;
    }
    // Home button behavior depends on context:
    // - If from team view: go to dashboard (user is editing, not scouting)
    // - If from scouting flow: go to match end screen (user can resume scouting)
    if (fromView === "teamView") {
      navigate({ to: "/" }); // Dashboard
    } else {
      navigate({
        to: "/",
        search: { teamNum, matchNum, alliance, practice },
      });
    }
  };

  const handleFinish = () => {
    // Practice mode: clear local data and return to practice home, no Supabase writes
    if (!matchData || !teamNum || !matchNum) return;
    const sessionKey = `matchData_${matchNum}_${teamNum}`;
    sessionStorage.removeItem(sessionKey);
    toast.success("Practice complete!");
    navigate({ to: "/practice" });
  };

  const handleSubmit = async () => {
    // CRITICAL: Log submission attempt for debugging null overwrite bug
    console.log("[MatchEditStats] Submit attempt:", {
      hasMatchData: !!matchData,
      currentEvent,
      teamNum,
      matchNum,
      alliance,
      fromView,
      sessionStorageExists: !!sessionStorage.getItem("currentMatchData"),
    });

    if (!matchData || !currentEvent || !teamNum || !matchNum) {
      toast.error("Missing match data");
      console.error("[MatchEditStats] Missing required data:", {
        hasMatchData: !!matchData,
        currentEvent,
        teamNum,
        matchNum,
      });
      return;
    }

    // Validate parameters are valid strings, not empty
    if (
      typeof teamNum !== "string" ||
      typeof matchNum !== "string" ||
      teamNum.trim() === "" ||
      matchNum.trim() === ""
    ) {
      toast.error("Invalid match or team parameters");
      console.error("[MatchEditStats] Invalid parameters:", {
        teamNum,
        matchNum,
      });
      return;
    }

    // Validate alliance is not null
    if (!alliance || (alliance !== "red" && alliance !== "blue")) {
      toast.error(
        "Alliance information is missing. Please restart from the match selection screen."
      );
      console.error("[MatchEditStats] Alliance is invalid:", alliance);
      return;
    }

    setIsSubmitting(true);
    const toastId = toast.loading("Uploading match data…");

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

      // CRITICAL: Validate transformed data is not empty before submitting
      if (!transformedData || Object.keys(transformedData).length === 0) {
        toast.error(
          "Match data is empty. Please ensure all fields are filled."
        );
        console.error("[MatchEditStats] Transformed data is empty:", {
          matchData,
          transformedData,
        });
        return;
      }

      // CRITICAL: Log the exact data being submitted
      console.log("[MatchEditStats] Submitting data:", {
        event: currentEvent,
        match: matchNum,
        team: teamNum,
        alliance,
        scoutName,
        scoutUid,
        transformedDataKeys: Object.keys(transformedData),
        hasPresetActions: Array.isArray(matchData.presetActions),
        presetActionsCount: matchData.presetActions?.length ?? 0,
        hasRatings: !!matchData.postMatch?.ratings,
        ratingsKeys: matchData.postMatch?.ratings
          ? Object.keys(matchData.postMatch.ratings)
          : [],
      });

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

      console.log("[MatchEditStats] Upload successful");

      // Clear match-specific sessionStorage
      const sessionKey = matchNum && teamNum
        ? `matchData_${matchNum}_${teamNum}`
        : "currentMatchData";
      sessionStorage.removeItem(sessionKey);
      console.log("[MatchEditStats] Cleared sessionStorage key:", sessionKey);

      toast.success("Match data uploaded!", { id: toastId });

      // After successful submission, ALWAYS go to dashboard
      navigate({ to: "/" });
    } catch (error) {
      console.error("[MatchEditStats] Failed to upload:", error);
      toast.error("Failed to upload match data", { id: toastId });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Check if form is complete (all ratings filled and notes not empty)
  const isFormComplete =
    matchData?.postMatch?.ratings?.ground !== undefined &&
    matchData?.postMatch?.ratings?.shooting !== undefined &&
    matchData?.postMatch?.ratings?.passing !== undefined &&
    matchData?.postMatch?.ratings?.driver !== undefined &&
    notes.trim() !== "";

  // Get active toggle states using the same helper as match_play
  const activeToggles = useMemo(
    () => getActiveToggles(matchData?.toggleActions || []),
    [matchData?.toggleActions]
  );

  // Returns a timestamp suitable for a new action at the END of its phase.
  // Matches the existing timestamp format (epoch ms if live-scouted, match-relative if not)
  // and sorts after all existing actions so playback isn't disrupted.
  // locationOverride / presetOverride: pass filtered arrays when rebuilding a category
  // (so removed actions don't inflate the max).
  const endOfPhase = (
    ph: "auto" | "teleop" | "endgame",
    locationOverride?: LocationAction[],
    presetOverride?: PresetAction[]
  ): number => {
    if (!matchData) return 150000;
    const isAuto = ph === "auto";
    const toggleTs = matchData.toggleActions
      .filter(a => isAuto ? a.phase === "auto" : (a.phase === "teleop" || a.phase === "endgame"))
      .map(a => a.timestamp);
    const locationTs = (locationOverride ?? matchData.locationActions)
      .filter(a => a.phase === (isAuto ? "auto" : "teleop"))
      .map(a => a.timestamp);
    const presetTs = (presetOverride ?? matchData.presetActions)
      .filter(a => a.phase === (isAuto ? "auto" : "teleop"))
      .map(a => a.timestamp);
    const all = [...toggleTs, ...locationTs, ...presetTs];
    // If no actions exist yet, use a sensible match-relative fallback
    if (all.length === 0) return isAuto ? 15000 : 150000;
    return Math.max(...all) + 1000;
  };

  const toggleAction = (
    uiAction: string, // Shorthand: "climb_L1", "climb_L2", "climb_L3", "disable", "defend"
    phase: "auto" | "teleop" | "endgame" = "teleop"
  ) => {
    if (!matchData) return;

    // Map UI shorthand + phase to the canonical ToggleActionType stored in matchData.
    // Buttons use convenient shorthand; stored actions use schema IDs (autoClimbL1, teleopDisable, etc.)
    const resolveType = (action: string, ph: string): ToggleActionType => {
      switch (action) {
        case "climb_L1": return ph === "auto" ? "autoClimbL1" : "teleopClimbL1";
        case "climb_L2": return "teleopClimbL2";
        case "climb_L3": return "teleopClimbL3";
        case "disable":  return ph === "auto" ? "autoDisable" : "teleopDisable";
        case "defend":   return ph === "auto" ? "autoDefend"  : "teleopDefend";
        default:         return action as ToggleActionType;
      }
    };

    const resolvedType = resolveType(uiAction, phase);
    const isClimb = resolvedType.startsWith("autoClimb") || resolvedType.startsWith("teleopClimb");

    // Current active state: climbs use last-event-wins on the resolved ID;
    // non-climb toggles (disable/defend) use activeToggles which merges auto+teleop phases.
    const currentlyActive = isClimb
      ? (matchData.toggleActions.filter((a) => a.type === resolvedType).at(-1)?.active ?? false)
      : uiAction === "disable" ? activeToggles.disable
      : uiAction === "defend"  ? activeToggles.defend
      : uiAction === "block"   ? activeToggles.block
      : false;

    // Compute a timestamp at the end of this phase so edited actions don't disrupt playback.
    // All actions in a batch share the same timestamp — user said "fine if they blink together."
    const phaseTs = endOfPhase(phase);

    // Climb exclusivity: activating a climb level deactivates all others in the same phase
    const newActions: ToggleAction[] = [];
    if (isClimb && !currentlyActive) {
      const samePhaseClimbs: ToggleActionType[] = phase === "auto"
        ? ["autoClimbL1"]
        : ["teleopClimbL1", "teleopClimbL2", "teleopClimbL3"];

      samePhaseClimbs.forEach((climbType) => {
        if (climbType !== resolvedType) {
          const isActiveInSamePhase =
            matchData.toggleActions.filter((a) => a.type === climbType).at(-1)?.active ?? false;
          if (isActiveInSamePhase) {
            newActions.push({ type: climbType, timestamp: phaseTs, active: false, phase });
          }
        }
      });
    }

    const newAction: ToggleAction = {
      type: resolvedType,
      timestamp: phaseTs,
      active: !currentlyActive,
      phase,
    };

    setMatchData({
      ...matchData,
      toggleActions: [...matchData.toggleActions, ...newActions, newAction],
    });
  };

  // Calculate stats
  const teleopStocking =
    matchData?.presetActions.filter(
      (a) => a.type === "stationStocked" && a.phase === "teleop"
    ).length || 0;
  const autoIntakes =
    matchData?.locationActions.filter(
      (a) => a.type === "groundIntake" && a.phase === "auto"
    ).length || 0;
  const teleopIntakes =
    matchData?.locationActions.filter(
      (a) => a.type === "groundIntake" && a.phase === "teleop"
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

  // Use last-event-wins for phase-specific climb state
  const hasAutoClimb =
    matchData?.toggleActions.filter(
      (a) => a.type === "autoClimbL1"
    ).at(-1)?.active ?? false;
  const wasDisabled = activeToggles.disable;
  const didDefend = activeToggles.defend;

  // For climb level, check which teleop climb is active (L1, L2, or L3).
  // Use last-event-wins per level.
  const lastL3 = matchData?.toggleActions.filter(
    (a) => a.type === "teleopClimbL3"
  ).at(-1)?.active;
  const lastL2 = matchData?.toggleActions.filter(
    (a) => a.type === "teleopClimbL2"
  ).at(-1)?.active;
  const lastL1 = matchData?.toggleActions.filter(
    (a) => a.type === "teleopClimbL1"
  ).at(-1)?.active;
  const climbLevel = lastL3 ? "3" : lastL2 ? "2" : lastL1 ? "1" : null;

  // Direct value setters for preset actions
  const setTeleopStocking = (value: number) => {
    if (!matchData) return;
    const filtered = matchData.presetActions.filter(
      (a) => !(a.type === "stationStocked" && a.phase === "teleop")
    );
    const baseTs = endOfPhase("teleop", undefined, filtered);
    const newActions: PresetAction[] = [];
    for (let i = 0; i < Math.max(0, value); i++) {
      newActions.push({ type: "stationStocked", timestamp: baseTs + i * 100, phase: "teleop" });
    }
    setMatchData({ ...matchData, presetActions: [...filtered, ...newActions] });
  };

  const setAutoIntakes = (value: number) => {
    if (!matchData) return;
    const filtered = matchData.locationActions.filter(
      (a) => !(a.type === "groundIntake" && a.phase === "auto")
    );
    const baseTs = endOfPhase("auto", filtered);
    const newActions: LocationAction[] = [];
    for (let i = 0; i < Math.max(0, value); i++) {
      newActions.push({ type: "groundIntake", timestamp: baseTs + i * 100, coords: [0.5, 0.5], phase: "auto" });
    }
    setMatchData({ ...matchData, locationActions: [...filtered, ...newActions] });
  };

  const setTeleopIntakes = (value: number) => {
    if (!matchData) return;
    const filtered = matchData.locationActions.filter(
      (a) => !(a.type === "groundIntake" && a.phase === "teleop")
    );
    const baseTs = endOfPhase("teleop", filtered);
    const newActions: LocationAction[] = [];
    for (let i = 0; i < Math.max(0, value); i++) {
      newActions.push({ type: "groundIntake", timestamp: baseTs + i * 100, coords: [0.5, 0.5], phase: "teleop" });
    }
    setMatchData({ ...matchData, locationActions: [...filtered, ...newActions] });
  };

  const setAutoPasses = (value: number) => {
    if (!matchData) return;
    const filtered = matchData.locationActions.filter(
      (a) => !(a.type === "passing" && a.phase === "auto")
    );
    const baseTs = endOfPhase("auto", filtered);
    const newActions: LocationAction[] = [];
    for (let i = 0; i < Math.max(0, value); i++) {
      newActions.push({ type: "passing", timestamp: baseTs + i * 100, coords: [0.5, 0.5], phase: "auto" });
    }
    setMatchData({ ...matchData, locationActions: [...filtered, ...newActions] });
  };

  const setTeleopPasses = (value: number) => {
    if (!matchData) return;
    const filtered = matchData.locationActions.filter(
      (a) => !(a.type === "passing" && a.phase === "teleop")
    );
    const baseTs = endOfPhase("teleop", filtered);
    const newActions: LocationAction[] = [];
    for (let i = 0; i < Math.max(0, value); i++) {
      newActions.push({ type: "passing", timestamp: baseTs + i * 100, coords: [0.5, 0.5], phase: "teleop" });
    }
    setMatchData({ ...matchData, locationActions: [...filtered, ...newActions] });
  };

  const setAutoShoots = (value: number) => {
    if (!matchData) return;
    const filtered = matchData.locationActions.filter(
      (a) => !(a.type === "shoot" && a.phase === "auto")
    );
    const baseTs = endOfPhase("auto", filtered);
    const newActions: LocationAction[] = [];
    for (let i = 0; i < Math.max(0, value); i++) {
      newActions.push({ type: "shoot", timestamp: baseTs + i * 100, coords: [0.5, 0.5], phase: "auto" });
    }
    setMatchData({ ...matchData, locationActions: [...filtered, ...newActions] });
  };

  const setTeleopShoots = (value: number) => {
    if (!matchData) return;
    const filtered = matchData.locationActions.filter(
      (a) => !(a.type === "shoot" && a.phase === "teleop")
    );
    const baseTs = endOfPhase("teleop", filtered);
    const newActions: LocationAction[] = [];
    for (let i = 0; i < Math.max(0, value); i++) {
      newActions.push({ type: "shoot", timestamp: baseTs + i * 100, coords: [0.5, 0.5], phase: "teleop" });
    }
    setMatchData({ ...matchData, locationActions: [...filtered, ...newActions] });
  };

  const selectCurrentAuto = () => {
    if (!matchData || teamAutos.length === 0) return;
    const auto = teamAutos[autoIndex];
    const autoName = auto.name || `Auto ${autoIndex + 1}`;
    setMatchData({ ...matchData, selectedAuto: autoName, autoDescription: null });
  };

  const clearSelectedAuto = () => {
    if (!matchData) return;
    setMatchData({ ...matchData, selectedAuto: null });
  };

  const currentAuto = teamAutos[autoIndex];
  const selectedAutoName = matchData?.selectedAuto ?? null;

  return (
    <>
      {isWrongOrientation && (
        <RotateDevicePrompt message="Please rotate to portrait mode to edit match data" />
      )}
      <div className="flex flex-col w-screen h-screen gap-5 px-5 pb-5 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)]">
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
            {/* Actions / Match Data */}
            <Collapsible open={actionsOpen} onOpenChange={setActionsOpen}>
              <div className="rounded-2xl bg-muted p-6 space-y-4">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between text-left"
                  >
                    <h2 className="text-lg font-semibold text-primary">
                      Actions
                    </h2>
                    {actionsOpen ? (
                      <ChevronUp className="size-5 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="size-5 text-muted-foreground" />
                    )}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
              {/* Table */}
              <div className="space-y-3 pt-2">
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

                {/* Stocking Row (teleop only) */}
                <div className="grid grid-cols-3 gap-4 items-center">
                  <div className="text-sm text-foreground">Stocking</div>
                  <div className="flex items-center justify-center">
                    <span className="text-sm text-muted-foreground">—</span>
                  </div>
                  <div className="flex items-center justify-center gap-2">
                    <Input
                      type="number"
                      value={teleopStocking}
                      onChange={(e) =>
                        setTeleopStocking(parseInt(e.target.value) || 0)
                      }
                      className="h-8 w-16 text-center bg-background border-border"
                    />
                    <div className="flex flex-col gap-0.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setTeleopStocking(teleopStocking + 1)}
                        className="h-4.5 w-7 p-0 flex items-center justify-center"
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 12 12"
                          fill="currentColor"
                        >
                          <path d="M6 3L9 7H3L6 3Z" />
                        </svg>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setTeleopStocking(teleopStocking - 1)}
                        className="h-4.5 w-7 p-0 flex items-center justify-center"
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 12 12"
                          fill="currentColor"
                        >
                          <path d="M6 9L3 5H9L6 9Z" />
                        </svg>
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Ground Intakes Row */}
                <div className="grid grid-cols-3 gap-4 items-center">
                  <div className="text-sm text-foreground">Intake</div>
                  <div className="flex items-center justify-center gap-2">
                    <Input
                      type="number"
                      value={autoIntakes}
                      onChange={(e) =>
                        setAutoIntakes(parseInt(e.target.value) || 0)
                      }
                      className="h-8 w-16 text-center bg-background border-border"
                    />
                    <div className="flex flex-col gap-0.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setAutoIntakes(autoIntakes + 1)}
                        className="h-4.5 w-7 p-0 flex items-center justify-center"
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 12 12"
                          fill="currentColor"
                        >
                          <path d="M6 3L9 7H3L6 3Z" />
                        </svg>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setAutoIntakes(autoIntakes - 1)}
                        className="h-4.5 w-7 p-0 flex items-center justify-center"
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 12 12"
                          fill="currentColor"
                        >
                          <path d="M6 9L3 5H9L6 9Z" />
                        </svg>
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center justify-center gap-2">
                    <Input
                      type="number"
                      value={teleopIntakes}
                      onChange={(e) =>
                        setTeleopIntakes(parseInt(e.target.value) || 0)
                      }
                      className="h-8 w-16 text-center bg-background border-border"
                    />
                    <div className="flex flex-col gap-0.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setTeleopIntakes(teleopIntakes + 1)}
                        className="h-4.5 w-7 p-0 flex items-center justify-center"
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 12 12"
                          fill="currentColor"
                        >
                          <path d="M6 3L9 7H3L6 3Z" />
                        </svg>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setTeleopIntakes(teleopIntakes - 1)}
                        className="h-4.5 w-7 p-0 flex items-center justify-center"
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 12 12"
                          fill="currentColor"
                        >
                          <path d="M6 9L3 5H9L6 9Z" />
                        </svg>
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
                      onChange={(e) =>
                        setAutoPasses(parseInt(e.target.value) || 0)
                      }
                      className="h-8 w-16 text-center bg-background border-border"
                    />
                    <div className="flex flex-col gap-0.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setAutoPasses(autoPasses + 1)}
                        className="h-4.5 w-7 p-0 flex items-center justify-center"
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 12 12"
                          fill="currentColor"
                        >
                          <path d="M6 3L9 7H3L6 3Z" />
                        </svg>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setAutoPasses(autoPasses - 1)}
                        className="h-4.5 w-7 p-0 flex items-center justify-center"
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 12 12"
                          fill="currentColor"
                        >
                          <path d="M6 9L3 5H9L6 9Z" />
                        </svg>
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center justify-center gap-2">
                    <Input
                      type="number"
                      value={teleopPasses}
                      onChange={(e) =>
                        setTeleopPasses(parseInt(e.target.value) || 0)
                      }
                      className="h-8 w-16 text-center bg-background border-border"
                    />
                    <div className="flex flex-col gap-0.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setTeleopPasses(teleopPasses + 1)}
                        className="h-4.5 w-7 p-0 flex items-center justify-center"
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 12 12"
                          fill="currentColor"
                        >
                          <path d="M6 3L9 7H3L6 3Z" />
                        </svg>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setTeleopPasses(teleopPasses - 1)}
                        className="h-4.5 w-7 p-0 flex items-center justify-center"
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 12 12"
                          fill="currentColor"
                        >
                          <path d="M6 9L3 5H9L6 9Z" />
                        </svg>
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
                      onChange={(e) =>
                        setAutoShoots(parseInt(e.target.value) || 0)
                      }
                      className="h-8 w-16 text-center bg-background border-border"
                    />
                    <div className="flex flex-col gap-0.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setAutoShoots(autoShoots + 1)}
                        className="h-4.5 w-7 p-0 flex items-center justify-center"
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 12 12"
                          fill="currentColor"
                        >
                          <path d="M6 3L9 7H3L6 3Z" />
                        </svg>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setAutoShoots(autoShoots - 1)}
                        className="h-4.5 w-7 p-0 flex items-center justify-center"
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 12 12"
                          fill="currentColor"
                        >
                          <path d="M6 9L3 5H9L6 9Z" />
                        </svg>
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center justify-center gap-2">
                    <Input
                      type="number"
                      value={teleopShoots}
                      onChange={(e) =>
                        setTeleopShoots(parseInt(e.target.value) || 0)
                      }
                      className="h-8 w-16 text-center bg-background border-border"
                    />
                    <div className="flex flex-col gap-0.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setTeleopShoots(teleopShoots + 1)}
                        className="h-4.5 w-7 p-0 flex items-center justify-center"
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 12 12"
                          fill="currentColor"
                        >
                          <path d="M6 3L9 7H3L6 3Z" />
                        </svg>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setTeleopShoots(teleopShoots - 1)}
                        className="h-4.5 w-7 p-0 flex items-center justify-center"
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 12 12"
                          fill="currentColor"
                        >
                          <path d="M6 9L3 5H9L6 9Z" />
                        </svg>
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
                </CollapsibleContent>
              </div>
            </Collapsible>

            {/* Endgame & Status */}
            <Collapsible open={endgameOpen} onOpenChange={setEndgameOpen}>
              <div className="rounded-2xl bg-muted p-6 space-y-4">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between text-left"
                  >
                    <h2 className="text-lg font-semibold text-primary">
                      Endgame & Status
                    </h2>
                    {endgameOpen ? (
                      <ChevronUp className="size-5 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="size-5 text-muted-foreground" />
                    )}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
              <div className="space-y-3 pt-2">
                <div>
                  <p className="text-xs text-muted-foreground mb-2">
                    Autonomous
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <Button
                      variant={hasAutoClimb ? "default" : "outline"}
                      onClick={() => toggleAction("climb_L1", "auto")}
                      className={
                        hasAutoClimb
                          ? "bg-[#4ADE80] text-black hover:bg-[#4ADE80]/90"
                          : ""
                      }
                    >
                      {hasAutoClimb ? "Auto Climb ✓" : "Auto Climb"}
                    </Button>
                    <Button
                      variant={matchData?.postMatch?.autoClimbFailed ? "destructive" : "outline"}
                      onClick={() => setMatchData({ ...matchData!, postMatch: { ...matchData!.postMatch, autoClimbFailed: !matchData?.postMatch?.autoClimbFailed } })}
                    >
                      {matchData?.postMatch?.autoClimbFailed ? "Fail ✓" : "Fail"}
                    </Button>
                  </div>
                  {/* Auto climb orientation */}
                  <div className="mt-2 space-y-1">
                    <p className="text-xs text-muted-foreground">Auto Climb Orientation</p>
                    <div className="flex gap-2">
                      {([undefined, 'left', 'center', 'right'] as const).map((o) => (
                        <Button
                          key={o ?? 'na'}
                          size="sm"
                          variant={matchData?.postMatch?.autoClimbOrientation === o ? "default" : "outline"}
                          onClick={() => setMatchData({ ...matchData!, postMatch: { ...matchData!.postMatch, autoClimbOrientation: o } })}
                          className={`flex-1 ${matchData?.postMatch?.autoClimbOrientation === o ? "bg-[#4ADE80] text-black hover:bg-[#4ADE80]/90" : ""}`}
                        >
                          {o === undefined ? "N/A" : o.charAt(0).toUpperCase() + o.slice(1)}
                        </Button>
                      ))}
                    </div>
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
                      className={
                        didDefend
                          ? "bg-[#CDA745] text-black hover:bg-[#CDA745]/90"
                          : ""
                      }
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
                      className={
                        climbLevel === "1"
                          ? "bg-[#4ADE80] text-black hover:bg-[#4ADE80]/90"
                          : ""
                      }
                    >
                      {climbLevel === "1" ? "Climb L1 ✓" : "Climb L1"}
                    </Button>

                    <Button
                      variant={climbLevel === "2" ? "default" : "outline"}
                      onClick={() => toggleAction("climb_L2", "endgame")}
                      className={
                        climbLevel === "2"
                          ? "bg-[#4ADE80] text-black hover:bg-[#4ADE80]/90"
                          : ""
                      }
                    >
                      {climbLevel === "2" ? "Climb L2 ✓" : "Climb L2"}
                    </Button>

                    <Button
                      variant={climbLevel === "3" ? "default" : "outline"}
                      onClick={() => toggleAction("climb_L3", "endgame")}
                      className={
                        climbLevel === "3"
                          ? "bg-[#4ADE80] text-black hover:bg-[#4ADE80]/90"
                          : ""
                      }
                    >
                      {climbLevel === "3" ? "Climb L3 ✓" : "Climb L3"}
                    </Button>
                  </div>

                  {/* Failed teleop climb toggle */}
                  <div className="mt-2">
                    <Button
                      size="sm"
                      variant={(matchData?.postMatch?.teleopFailedClimbCount || 0) >= 1 ? "destructive" : "outline"}
                      onClick={() => setMatchData({ ...matchData!, postMatch: { ...matchData!.postMatch, teleopFailedClimbCount: (matchData?.postMatch?.teleopFailedClimbCount || 0) >= 1 ? 0 : 1 } })}
                      className="w-full"
                    >
                      {(matchData?.postMatch?.teleopFailedClimbCount || 0) >= 1 ? "Fail Climb ✓" : "Fail Climb"}
                    </Button>
                  </div>

                  {/* Teleop climb orientation */}
                  <div className="mt-2 space-y-1">
                    <p className="text-xs text-muted-foreground">Teleop Climb Orientation</p>
                    <div className="flex gap-2">
                      {([undefined, 'left', 'center', 'right'] as const).map((o) => (
                        <Button
                          key={o ?? 'na'}
                          size="sm"
                          variant={matchData?.postMatch?.teleopClimbOrientation === o ? "default" : "outline"}
                          onClick={() => setMatchData({ ...matchData!, postMatch: { ...matchData!.postMatch, teleopClimbOrientation: o } })}
                          className={`flex-1 ${matchData?.postMatch?.teleopClimbOrientation === o ? "bg-[#4ADE80] text-black hover:bg-[#4ADE80]/90" : ""}`}
                        >
                          {o === undefined ? "N/A" : o.charAt(0).toUpperCase() + o.slice(1)}
                        </Button>
                      ))}
                    </div>
                  </div>

                </div>
              </div>
                </CollapsibleContent>
              </div>
            </Collapsible>

            {/* Ratings */}
            <div className="rounded-2xl bg-muted p-6 space-y-4">
              <h2 className="text-lg font-semibold text-primary">
                Ratings (1-5)
              </h2>
              <div className="space-y-4">
                {/* Ground Rating */}
                <div className="space-y-2">
                  <p className="text-sm text-foreground">Intake</p>
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
                        className={`flex-1 ${matchData?.postMatch?.ratings?.ground === rating ? "bg-[#CDA745] text-black hover:bg-[#CDA745]/90" : ""}`}
                      >
                        {rating}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Shooting Rating */}
                <div className="space-y-2">
                  <p className="text-sm text-foreground">Shooting</p>
                  <div className="flex gap-2">
                    {[1, 2, 3, 4, 5].map((rating) => (
                      <Button
                        key={rating}
                        size="sm"
                        variant={
                          matchData?.postMatch?.ratings?.shooting === rating
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
                                shooting: rating as 1 | 2 | 3 | 4 | 5,
                              },
                            },
                          });
                        }}
                        className={`flex-1 ${matchData?.postMatch?.ratings?.shooting === rating ? "bg-[#CDA745] text-black hover:bg-[#CDA745]/90" : ""}`}
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
                        variant={
                          matchData?.postMatch?.ratings?.passing === rating
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
              <h2 className="text-lg font-semibold text-primary">
                Capabilities
              </h2>
              <div className="flex gap-2 flex-wrap">
                {([
                  { key: 'bump', label: 'Bump' },
                  { key: 'through', label: 'Trough' },
                  { key: 'canStation', label: 'Outpost' },
                  { key: 'canGround', label: 'Ground' },
                ] as const).map(({ key, label }) => {
                  const active = !!(matchData?.postMatch as Record<string, unknown>)?.[key];
                  return (
                    <Button
                      key={key}
                      size="sm"
                      variant={active ? "default" : "outline"}
                      onClick={() => {
                        setMatchData({
                          ...matchData!,
                          postMatch: {
                            ...matchData!.postMatch,
                            [key]: !active,
                          },
                        });
                      }}
                      className={`flex-1 ${active ? "bg-[#4ADE80] text-black hover:bg-[#4ADE80]/90" : ""}`}
                    >
                      {label}
                    </Button>
                  );
                })}
              </div>
            </div>

            {/* Auto - selection when pit autos exist, otherwise description only */}
            <Collapsible open={autoSelectOpen} onOpenChange={setAutoSelectOpen}>
                <div className="rounded-2xl bg-muted p-6 space-y-4">
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between text-left"
                    >
                      <h2 className="text-lg font-semibold text-primary">
                        Auto
                      </h2>
                      {autoSelectOpen ? (
                        <ChevronUp className="size-5 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="size-5 text-muted-foreground" />
                      )}
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="pt-2 space-y-4">
                      {teamAutos.length > 0 ? (
                      <>
                      <div className="flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setAutoIndex((i) =>
                              i <= 0 ? teamAutos.length - 1 : i - 1
                            )
                          }
                          className={`p-2 transition-colors ${teamAutos.length > 1 ? "text-primary hover:text-primary/80" : "text-muted-foreground/50 hover:text-muted-foreground"}`}
                          aria-label="Previous auto"
                        >
                          <svg
                            width="24"
                            height="24"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="M15 18l-6-6 6-6" />
                          </svg>
                        </button>
                        <div className="flex-1 flex justify-center min-h-[200px] items-center bg-background rounded-xl border border-border p-4">
                          {currentAuto?.drawing ? (
                            <AutoPathDisplay
                              drawing={currentAuto.drawing as DrawingData}
                              alliance={alliance === "blue" ? "blue" : "red"}
                              className="max-w-full max-h-[240px]"
                            />
                          ) : (
                            <div className="text-muted-foreground text-sm">
                              No path for this auto
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setAutoIndex((i) =>
                              i >= teamAutos.length - 1 ? 0 : i + 1
                            )
                          }
                          className={`p-2 transition-colors ${teamAutos.length > 1 ? "text-primary hover:text-primary/80" : "text-muted-foreground/50 hover:text-muted-foreground"}`}
                          aria-label="Next auto"
                        >
                          <svg
                            width="24"
                            height="24"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="M9 18l6-6-6-6" />
                          </svg>
                        </button>
                      </div>
                      <p className={`text-center text-sm ${selectedAutoName === (currentAuto?.name || `Auto ${(autoIndex ?? 0) + 1}`) ? "text-primary font-medium" : "text-muted-foreground"}`}>
                        {currentAuto?.name || `Auto ${(autoIndex ?? 0) + 1}`}
                        {teamAutos.length > 1
                          ? ` (${(autoIndex ?? 0) + 1} of ${teamAutos.length})`
                          : " (only auto)"}
                      </p>
                      <p className="text-center text-xs text-muted-foreground">
                        Climb during auto: <span className={currentAuto?.climbDuringAuto ? "text-chart-2 font-medium" : "text-muted-foreground"}>{currentAuto?.climbDuringAuto ? "Yes" : "No"}</span>
                      </p>
                      <div className="flex gap-2">
                        <Button
                          variant={selectedAutoName === (currentAuto?.name || `Auto ${(autoIndex ?? 0) + 1}`) ? "secondary" : "default"}
                          className={`flex-1 ${selectedAutoName !== (currentAuto?.name || `Auto ${(autoIndex ?? 0) + 1}`) ? "bg-[#CDA745] hover:bg-[#CDA745]/90 text-black" : ""}`}
                          onClick={selectCurrentAuto}
                        >
                          Select this auto
                        </Button>
                        {selectedAutoName ? (
                          <Button
                            variant="outline"
                            onClick={clearSelectedAuto}
                          >
                            None
                          </Button>
                        ) : null}
                      </div>
                      {!selectedAutoName && (
                        <div className="pt-2 space-y-2">
                          <p className="text-sm text-muted-foreground">Short auto description (if no auto matches)</p>
                          <Input
                            value={matchData?.autoDescription ?? ""}
                            onChange={(e) =>
                              setMatchData({
                                ...matchData!,
                                autoDescription: e.target.value || null,
                              })
                            }
                            placeholder="e.g. Drove to wing, scored 2"
                            className="bg-background border-border"
                          />
                        </div>
                      )}
                      </>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-sm text-muted-foreground">Describe what the team did in auto</p>
                          <Input
                            value={matchData?.autoDescription ?? ""}
                            onChange={(e) =>
                              setMatchData({
                                ...matchData!,
                                autoDescription: e.target.value || null,
                              })
                            }
                            placeholder="e.g. Drove to wing, scored 2"
                            className="bg-background border-border"
                          />
                        </div>
                      )}
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>

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

        {/* Submit / Finish Button - Fixed at bottom */}
        <div className="fixed bottom-4 left-4 right-4 z-40">
          <Button
            onClick={practice ? handleFinish : handleSubmit}
            disabled={practice ? !isFormComplete : !isFormComplete || isSubmitting}
            className="w-full h-12 bg-[#CDA745] hover:bg-[#CDA745]/90 text-black disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {practice ? "Finish" : isSubmitting ? "Uploading..." : "Submit"}
          </Button>
        </div>
      </div>
    </>
  );
}
