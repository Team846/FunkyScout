import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import React from "react";
import red_field from "/red_field.svg";
import blue_field from "/blue_field.svg";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { getMatchLabel } from "@lib/utils/match";
import { vibrateShake, vibrateBuzz, vibrateTap } from "@lib/utils/haptics";
import { useOrientation } from "@lib/hooks/useOrientation";
import { RotateDevicePrompt } from "../components/RotateDevicePrompt";
import type {
  MatchScoutingData,
  LocationAction,
  PresetAction,
  ToggleAction,
  PresetActionType,
  ToggleActionType,
  LocationActionType,
} from "@lib/types/matchScouting";
import {
  createEmptyMatchData,
  pixelToNormalized,
  getActiveToggles,
} from "@lib/types/matchScouting";



type MatchType = {
  teamNum?: string | null;
  matchNum?: string | null;
  alliance?: string | null;
  practice?: boolean | null;
  startX?: number | null;
  startY?: number | null;
};

export const Route = createFileRoute("/match_play")({
  component: MatchPlay,
  validateSearch: (search: Record<string, unknown>): MatchType => {
    return {
      teamNum: search.teamNum as string | undefined | null,
      matchNum: search.matchNum as string | undefined | null,
      alliance: search.alliance as string | undefined | null,
      practice: search.practice as boolean | undefined | null,
      startX: search.startX as number | undefined | null,
      startY: search.startY as number | undefined | null,
    };
  },
});

function MatchPlay() {
  const { isWrongOrientation } = useOrientation("landscape");
  const navigate = useNavigate();
  const { teamNum, matchNum, alliance, practice, startX, startY } = Route.useSearch();

  // Use match-specific sessionStorage key to prevent interference between matches
  const sessionKey = matchNum && teamNum
    ? `matchData_${matchNum}_${teamNum}`
    : "currentMatchData";

  const handleBackClick = () => {
    // Clear in-progress data when leaving
    sessionStorage.removeItem("inProgressMatchData");
    if (practice) {
      navigate({ to: "/practice" });
    } else {
      navigate({ to: "/home" });
    }
  };
  const [seconds, setSeconds] = useState(0);

  const [isAuto, setIsAuto] = useState(true);

  // Blue alliance starts rotated so cage bar is on same visual side as red
  const [isRotated, setIsRotated] = useState(alliance === 'blue');

  const [shake, setShake] = useState(false);
  const [countdown, setCountdown] = useState<3 | 2 | 1 | null>(null);

  // Timeout refs for proper cleanup
  const timer1Ref = useRef<number | null>(null);
  const timer2Ref = useRef<number | null>(null);
  const shakeTimerRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const countdownAutoRef = useRef<number | null>(null);
  const countdownTeleopRef = useRef<number | null>(null);
  const baseTimeRef = useRef<number>(performance.now());
  const dismountTimerRef = useRef<number | null>(null);

  // --- Auto climb state ---
  const [autoClimbActive, setAutoClimbActive] = useState(false);
  const autoClimbActiveRef = useRef(false);
  const [autoClimbOrientation, setAutoClimbOrientation] = useState<'left' | 'right' | 'center' | null>(null);

  // --- Teleop climb state ---
  const [teleopClimbActive, setTeleopClimbActive] = useState(false);
  const teleopClimbLevelRef = useRef<'L1' | 'L2' | 'L3' | null>(null);
  const [teleopClimbOrientation, setTeleopClimbOrientation] = useState<'left' | 'right' | 'center' | null>(null);

  // --- Dismount state ---
  const [dismountRecorded, setDismountRecorded] = useState(false);
  const dismountRecordedRef = useRef(false);

  // Match scouting data - load from localStorage if exists
  const [matchData, setMatchData] = useState<MatchScoutingData>(() => {
    const saved = sessionStorage.getItem("inProgressMatchData");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // fall through
      }
    }
    const empty = createEmptyMatchData();
    // Attach starting position from match_start if provided
    if (startX != null && startY != null) {
      empty.startPosition = [startX, startY];
    }
    return empty;
  });
  const matchDataRef = useRef<MatchScoutingData>(matchData);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Undo/redo history
  type UndoableAction =
    | { type: "location"; action: LocationAction }
    | { type: "preset"; action: PresetAction }
    | { type: "toggle"; action: ToggleAction };
  const [undoStack, setUndoStack] = useState<UndoableAction[]>([]);

  // Track which location action is being placed (user selects button, then clicks field)
  const [pendingLocationAction, setPendingLocationAction] =
    useState<LocationActionType | null>(null);

  // Field container ref for coordinate calculations
  const fieldContainerRef = useRef<HTMLDivElement>(null);

  // Keep matchDataRef in sync with matchData state AND save to sessionStorage (throttled)
  useEffect(() => {
    matchDataRef.current = matchData;

    // Throttle sessionStorage writes to improve performance
    const timeoutId = setTimeout(() => {
      sessionStorage.setItem("inProgressMatchData", JSON.stringify(matchData));
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [matchData]);

  // Get active toggle states
  const activeToggles = useMemo(
    () => getActiveToggles(matchData.toggleActions),
    [matchData.toggleActions]
  );

  // Handle auto→teleop transition: set up dismount timer if auto climb was active
  const prevIsAutoRef = useRef(isAuto);
  useEffect(() => {
    if (prevIsAutoRef.current === true && isAuto === false) {
      if (autoClimbActiveRef.current) {
        dismountTimerRef.current = window.setTimeout(() => {
          if (!dismountRecordedRef.current) {
            setMatchData(prev => ({
              ...prev,
              postMatch: { ...prev.postMatch, teleopDismountTime: 11 },
            }));
            setDismountRecorded(true);
            dismountRecordedRef.current = true;
          }
        }, 10 * 1000);
      }
    }
    prevIsAutoRef.current = isAuto;
  }, [isAuto]);

  // Memoize total action count for undo button
  const totalActions = useMemo(
    () =>
      matchData.locationActions.length +
      matchData.presetActions.length +
      matchData.toggleActions.length,
    [
      matchData.locationActions.length,
      matchData.presetActions.length,
      matchData.toggleActions.length,
    ]
  );

  const rotateField = useCallback(() => {
    setIsRotated((prev) => !prev);
  }, []);

  const reset = useCallback(() => {
    baseTimeRef.current = performance.now();
    setSeconds(0);
  }, []);

  // Update postMatch fields in matchData
  const updatePostMatch = useCallback((updates: Partial<NonNullable<MatchScoutingData['postMatch']>>) => {
    setMatchData(prev => ({
      ...prev,
      postMatch: { ...prev.postMatch, ...updates },
    }));
  }, []);

  // --- Auto climb handlers ---
  const handleAutoClimbStart = useCallback(() => {
    setAutoClimbActive(true);
    autoClimbActiveRef.current = true;
    const newAction: ToggleAction = {
      type: 'climb_L1',
      timestamp: Date.now(),
      active: true,
      phase: 'auto',
    };
    setMatchData(prev => ({ ...prev, toggleActions: [...prev.toggleActions, newAction] }));
    setUndoStack([]);
    vibrateTap();
  }, []);

  const handleAutoClimbFail = useCallback(() => {
    setAutoClimbActive(false);
    autoClimbActiveRef.current = false;
    setAutoClimbOrientation(null);
    const newAction: ToggleAction = {
      type: 'climb_L1',
      timestamp: Date.now(),
      active: false,
      phase: 'auto',
    };
    setMatchData(prev => ({
      ...prev,
      toggleActions: [...prev.toggleActions, newAction],
      postMatch: { ...prev.postMatch, autoClimbOrientation: undefined, autoClimbFailed: true },
    }));
    setUndoStack([]);
    vibrateTap();
  }, []);

  const handleAutoOrientationPress = useCallback((orientation: 'left' | 'right' | 'center') => {
    setAutoClimbOrientation(orientation);
    updatePostMatch({ autoClimbOrientation: orientation });
    vibrateTap();
  }, [updatePostMatch]);

  // --- Teleop climb handlers ---
  const handleTeleopClimbStart = useCallback((level: 'L1' | 'L2' | 'L3') => {
    setTeleopClimbActive(true);
    teleopClimbLevelRef.current = level;
    const newAction: ToggleAction = {
      type: `climb_${level}` as ToggleActionType,
      timestamp: Date.now(),
      active: true,
      phase: 'endgame',
    };
    setMatchData(prev => ({ ...prev, toggleActions: [...prev.toggleActions, newAction] }));
    setUndoStack([]);
    vibrateTap();
  }, []);

  const handleTeleopClimbFail = useCallback(() => {
    const level = teleopClimbLevelRef.current;
    setTeleopClimbActive(false);
    teleopClimbLevelRef.current = null;
    if (level) {
      const newAction: ToggleAction = {
        type: `climb_${level}` as ToggleActionType,
        timestamp: Date.now(),
        active: false,
        phase: 'endgame',
      };
      setMatchData(prev => ({
        ...prev,
        toggleActions: [...prev.toggleActions, newAction],
        postMatch: {
          ...prev.postMatch,
          teleopFailedClimbCount: (prev.postMatch?.teleopFailedClimbCount || 0) + 1,
        },
      }));
      setUndoStack([]);
    }
    vibrateTap();
  }, []);

  const handleTeleopOrientationPress = useCallback((orientation: 'left' | 'right' | 'center') => {
    setTeleopClimbOrientation(orientation);
    updatePostMatch({ teleopClimbOrientation: orientation });
    vibrateTap();
  }, [updatePostMatch]);

  // --- Dismount handler (field button during first 10s of teleop) ---
  const handleDismount = useCallback(() => {
    if (dismountRecorded) return;
    setDismountRecorded(true);
    dismountRecordedRef.current = true;
    if (dismountTimerRef.current) clearTimeout(dismountTimerRef.current);
    updatePostMatch({ teleopDismountTime: seconds }); // seconds is teleop-relative (0-140)
    vibrateTap();
  }, [dismountRecorded, seconds, updatePostMatch]);

  // Add preset action (fuel, station)
  const addPresetAction = (actionType: PresetActionType) => {
    // Auto-cancel disabled if it's active
    const updates: Partial<MatchScoutingData> = {};

    if (activeToggles.disable) {
      const phase = isAuto ? "auto" : seconds > 140 - 10 ? "endgame" : "teleop";
      updates.toggleActions = [
        ...(matchDataRef.current.toggleActions || []),
        {
          type: "disable",
          timestamp: Date.now(),
          active: false,
          phase,
        },
      ];
    }

    const newAction: PresetAction = {
      type: actionType,
      timestamp: Date.now(),
      phase: isAuto ? "auto" : "teleop",
    };

    setMatchData((prev) => ({
      ...prev,
      ...updates,
      presetActions: [...prev.presetActions, newAction],
    }));

    // Clear undo stack when new action is added
    setUndoStack([]);

    vibrateTap();
  };

  // Toggle action (disable, defend, climb)
  const toggleAction = (actionType: ToggleActionType) => {
    const currentlyActive = activeToggles[actionType];
    const phase = isAuto ? "auto" : seconds > 140 - 10 ? "endgame" : "teleop";

    const newActions: ToggleAction[] = [];

    // Auto-cancel disabled if it's active and we're toggling a different action
    if (activeToggles.disable && actionType !== "disable") {
      newActions.push({
        type: "disable",
        timestamp: Date.now(),
        active: false,
        phase,
      });
    }

    // Handle climb exclusivity - only one climb level can be active at a time
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

    // Add the main toggle action
    newActions.push({
      type: actionType,
      timestamp: Date.now(),
      active: !currentlyActive,
      phase,
    });

    setMatchData((prev) => ({
      ...prev,
      toggleActions: [...prev.toggleActions, ...newActions],
    }));

    // Clear undo stack when new action is added
    setUndoStack([]);

    vibrateTap();
  };

  // Start placing a location action (toggle on/off)
  const startLocationAction = useCallback(
    (actionType: LocationActionType) => {
      // Auto-cancel disabled if it's active (batched with state update)
      if (activeToggles.disable) {
        const phase = isAuto
          ? "auto"
          : seconds > 140 - 10
            ? "endgame"
            : "teleop";
        setMatchData((prev) => ({
          ...prev,
          toggleActions: [
            ...prev.toggleActions,
            {
              type: "disable",
              timestamp: Date.now(),
              active: false,
              phase,
            },
          ],
        }));
      }

      setPendingLocationAction((prev) =>
        prev === actionType ? null : actionType
      );
      vibrateTap();
    },
    [activeToggles.disable, isAuto, seconds]
  );

  // Handle field click for location actions
  const handleFieldClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!pendingLocationAction || !fieldContainerRef.current) return;

    const rect = fieldContainerRef.current.getBoundingClientRect();
    const pixelX = e.clientX - rect.left;
    const pixelY = e.clientY - rect.top;
    let [normalizedX, normalizedY] = pixelToNormalized(
      pixelX,
      pixelY,
      rect.width,
      rect.height
    );

    // If field is rotated, invert coordinates to normalize them back to standard orientation
    if (isRotated) {
      normalizedX = 1 - normalizedX;
      normalizedY = 1 - normalizedY;
    }

    const newAction: LocationAction = {
      type: pendingLocationAction,
      timestamp: Date.now(),
      coords: [normalizedX, normalizedY],
      phase: isAuto ? "auto" : "teleop",
    };

    setMatchData((prev) => ({
      ...prev,
      locationActions: [...prev.locationActions, newAction],
    }));

    // Clear undo stack when new action is added
    setUndoStack([]);

    setPendingLocationAction(null);
    vibrateTap();
  };

  const handleUndo = () => {
    // Find and remove the most recent action across all arrays
    const locationActions = matchData.locationActions.map((a) => ({
      type: "location" as const,
      action: a,
      timestamp: a.timestamp,
    }));
    const presetActions = matchData.presetActions.map((a) => ({
      type: "preset" as const,
      action: a,
      timestamp: a.timestamp,
    }));
    const toggleActions = matchData.toggleActions.map((a) => ({
      type: "toggle" as const,
      action: a,
      timestamp: a.timestamp,
    }));

    const allActions = [
      ...locationActions,
      ...presetActions,
      ...toggleActions,
    ].sort((a, b) => b.timestamp - a.timestamp);

    if (allActions.length === 0) return;

    const lastAction = allActions[0];

    // Remove from matchData and add to undo stack
    setMatchData((prev) => {
      if (lastAction.type === "location") {
        return {
          ...prev,
          locationActions: prev.locationActions.filter(
            (a) => a.timestamp !== lastAction.timestamp
          ),
        };
      } else if (lastAction.type === "preset") {
        return {
          ...prev,
          presetActions: prev.presetActions.filter(
            (a) => a.timestamp !== lastAction.timestamp
          ),
        };
      } else {
        return {
          ...prev,
          toggleActions: prev.toggleActions.filter(
            (a) => a.timestamp !== lastAction.timestamp
          ),
        };
      }
    });

    setUndoStack((prev) => [
      ...prev,
      { type: lastAction.type, action: lastAction.action } as UndoableAction,
    ]);

    setToastMessage("Action undone");
    setTimeout(() => setToastMessage(null), 2000);
    vibrateTap();
  };

  const handleRedo = () => {
    if (undoStack.length === 0) return;

    const actionToRedo = undoStack[undoStack.length - 1];

    // Add back to matchData
    setMatchData((prev) => {
      if (actionToRedo.type === "location") {
        return {
          ...prev,
          locationActions: [...prev.locationActions, actionToRedo.action],
        };
      } else if (actionToRedo.type === "preset") {
        return {
          ...prev,
          presetActions: [...prev.presetActions, actionToRedo.action],
        };
      } else {
        return {
          ...prev,
          toggleActions: [...prev.toggleActions, actionToRedo.action],
        };
      }
    });

    // Remove from undo stack
    setUndoStack((prev) => prev.slice(0, -1));

    setToastMessage("Action redone");
    setTimeout(() => setToastMessage(null), 2000);
    vibrateTap();
  };

  const triggerCountdown = async () => {
    setCountdown(3);
    setShake(true);
    await vibrateShake();

    window.setTimeout(() => setCountdown(2), 1000);
    window.setTimeout(() => setCountdown(1), 2000);
    window.setTimeout(async () => {
      setCountdown(null);
      setShake(false);
      await vibrateBuzz();
    }, 3000);
  };

  const handleFastForward = () => {
    // Clear all pending timeouts
    if (timer1Ref.current) clearTimeout(timer1Ref.current);
    if (timer2Ref.current) clearTimeout(timer2Ref.current);
    if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
    if (countdownAutoRef.current) clearTimeout(countdownAutoRef.current);
    if (countdownTeleopRef.current) clearTimeout(countdownTeleopRef.current);

    if (isAuto) {
      // Skip to teleop
      baseTimeRef.current = performance.now();
      setSeconds(0);
      setIsAuto(false);
      // Restart teleop timer
      timer2Ref.current = window.setTimeout(() => {
        // Store matchData in sessionStorage to pass to match_end
        sessionStorage.setItem(
          sessionKey,
          JSON.stringify(matchDataRef.current)
        );
        sessionStorage.removeItem("inProgressMatchData"); // Clear in-progress data
        navigate({
          to: "/match_end",
          search: { teamNum, matchNum, alliance, practice },
        });
      }, 140 * 1000);

      // Set up teleop countdown
      countdownTeleopRef.current = window.setTimeout(() => {
        console.log(
          "🔔 Triggering TELEOP countdown at 137 seconds (after fast-forward)"
        );
        triggerCountdown();
      }, 137 * 1000);
    } else {
      // Skip to end
      sessionStorage.setItem(
        sessionKey,
        JSON.stringify(matchDataRef.current)
      );
      sessionStorage.removeItem("inProgressMatchData"); // Clear in-progress data
      navigate({
        to: "/match_end",
        search: { teamNum, matchNum, alliance, practice },
      });
    }
  };

  useEffect(() => {
    // Use requestAnimationFrame with throttling for optimal performance
    let lastUpdateTime = 0;
    const updateInterval = 50; // Update state every 50ms (20 FPS) instead of every 10ms (100 FPS)

    const updateTimer = (currentTime: number) => {
      // Only update state every 50ms to reduce re-renders by 80%
      if (currentTime - lastUpdateTime >= updateInterval) {
        const elapsed = (currentTime - baseTimeRef.current) / 1000;
        setSeconds(elapsed);
        lastUpdateTime = currentTime;
      }

      animationFrameRef.current = requestAnimationFrame(updateTimer);
    };

    animationFrameRef.current = requestAnimationFrame(updateTimer);

    // Auto mode countdown: trigger at 20s (after bar fully fills, starts the 3-2-1 transition)
    countdownAutoRef.current = window.setTimeout(() => {
      triggerCountdown();
    }, 20 * 1000);

    // Auto->Teleop switch at 23s (20s auto + 3s countdown transition)
    timer1Ref.current = window.setTimeout(() => {
      setIsAuto(false);
      reset();

      // Set up teleop countdown: trigger at 137s after teleop starts (3 seconds before 140s end)
      countdownTeleopRef.current = window.setTimeout(() => {
        triggerCountdown();
      }, 137 * 1000);
    }, 23 * 1000);

    // Match end at 163s total (23s auto+transition + 140s teleop)
    timer2Ref.current = window.setTimeout(() => {
      // Store matchData in sessionStorage to pass to match_end
      sessionStorage.setItem(
        sessionKey,
        JSON.stringify(matchDataRef.current)
      );
      sessionStorage.removeItem("inProgressMatchData"); // Clear in-progress data
      navigate({
        to: "/match_end",
        search: {
          teamNum: teamNum,
          matchNum: matchNum,
          alliance: alliance,
          practice: practice,
        },
      });
    }, 163 * 1000);

    shakeTimerRef.current = window.setTimeout(() => {
      setShake(true);
      setTimeout(() => {
        setShake(false);
      }, 1000);
    }, 10 * 1000);

    return () => {
      if (animationFrameRef.current)
        cancelAnimationFrame(animationFrameRef.current);
      if (timer1Ref.current) clearTimeout(timer1Ref.current);
      if (timer2Ref.current) clearTimeout(timer2Ref.current);
      if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
      if (countdownAutoRef.current) clearTimeout(countdownAutoRef.current);
      if (countdownTeleopRef.current) clearTimeout(countdownTeleopRef.current);
      if (dismountTimerRef.current) clearTimeout(dismountTimerRef.current);
    };
  }, []);

  // Memoize tick marks to avoid recreating them on every render (was happening 100x/second)
  const tickMarks = useMemo(() => {
    if (isAuto) return null;

    return [10, 35, 60, 85, 110].map((tick) => {
      const percentage = (tick / 140) * 100;
      return (
        <div
          key={tick}
          className="absolute w-full rounded-0.5"
          style={{ top: `${percentage}%` }}
        >
          <div
            className="w-2.5 h-0.5 bg-[#D9D9D9]"
            style={{ transform: "translateX(-2.5px)" }}
          />
        </div>
      );
    });
  }, [isAuto]);

  return (
    <>
      {isWrongOrientation && <RotateDevicePrompt />}
      <div
        className={`flex flex-row w-screen h-screen gap-5 p-5 ${shake ? "animate-shake" : ""}`}
      >
        <div className="flex flex-col justify-between items-center w-[10vw] h-full bg-black-950 gap-2.5 py-3 rounded-[15px] border-2 border-[#1E1E1E]">
          <div className="flex w-[62px] flex-col text-outfit text-xs justify-start items-center gap-[5px]">
            <p className="text-[#CDA745]">
              {matchNum ? getMatchLabel(matchNum) : ""}
            </p>

            <p>{teamNum?.substring(teamNum.indexOf("frc") + 3)}</p>
          </div>
          <div className="flex flex-col items-center gap-[30px]">
            {/* Fast-forward button */}
            <svg
              width="25"
              height="25"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              onClick={handleFastForward}
              className="cursor-pointer"
            >
              <path d="M13 6L21 12L13 18V6Z" fill="#515151" />
              <path d="M3 6L11 12L3 18V6Z" fill="#515151" />
            </svg>

            <svg
              viewBox="0 0 25 20"
              onClick={handleBackClick}
              fill="currentColor"
              className="w-[25px] h-[25px]"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                fill="#515151"
                d="M12.1688 5.04384L4.16666 11.6345V18.7478C4.16666 18.932 4.23983 19.1086 4.37006 19.2389C4.50029 19.3691 4.67693 19.4423 4.8611 19.4423L9.72482 19.4297C9.9084 19.4288 10.0841 19.3552 10.2136 19.2251C10.3431 19.0949 10.4158 18.9188 10.4158 18.7352V14.5812C10.4158 14.397 10.489 14.2204 10.6192 14.0901C10.7494 13.9599 10.9261 13.8867 11.1102 13.8867H13.888C14.0722 13.8867 14.2488 13.9599 14.3791 14.0901C14.5093 14.2204 14.5825 14.397 14.5825 14.5812V18.7322C14.5822 18.8236 14.5999 18.9141 14.6347 18.9986C14.6695 19.0831 14.7206 19.1599 14.7851 19.2247C14.8496 19.2894 14.9263 19.3407 15.0106 19.3758C15.095 19.4108 15.1855 19.4288 15.2769 19.4288L20.1389 19.4423C20.3231 19.4423 20.4997 19.3691 20.6299 19.2389C20.7602 19.1086 20.8333 18.932 20.8333 18.7478V11.6298L12.8329 5.04384C12.7388 4.96802 12.6217 4.92668 12.5009 4.92668C12.3801 4.92668 12.2629 4.96802 12.1688 5.04384ZM24.809 9.52344L21.1805 6.53255V0.520833C21.1805 0.3827 21.1257 0.250224 21.028 0.152549C20.9303 0.0548735 20.7978 0 20.6597 0H18.2292C18.091 0 17.9585 0.0548735 17.8609 0.152549C17.7632 0.250224 17.7083 0.3827 17.7083 0.520833V3.67231L13.8225 0.47526C13.4496 0.168394 12.9816 0.000613431 12.4987 0.000613431C12.0158 0.000613431 11.5478 0.168394 11.1749 0.47526L0.188362 9.52344C0.135623 9.56703 0.0919888 9.62058 0.0599541 9.68104C0.0279193 9.7415 0.00811156 9.80768 0.00166252 9.8758C-0.00478653 9.94392 0.00224954 10.0126 0.0223687 10.078C0.0424879 10.1434 0.0752958 10.2042 0.118918 10.2569L1.22569 11.6024C1.26919 11.6553 1.3227 11.6991 1.38315 11.7313C1.44361 11.7635 1.50981 11.7835 1.57799 11.79C1.64616 11.7966 1.71496 11.7897 1.78045 11.7696C1.84593 11.7496 1.90682 11.7168 1.95963 11.6732L12.1688 3.26432C12.2629 3.18851 12.3801 3.14717 12.5009 3.14717C12.6217 3.14717 12.7388 3.18851 12.8329 3.26432L23.0425 11.6732C23.0952 11.7168 23.156 11.7496 23.2214 11.7697C23.2868 11.7898 23.3556 11.7969 23.4237 11.7904C23.4918 11.784 23.558 11.7642 23.6184 11.7321C23.6789 11.7001 23.7324 11.6565 23.776 11.6037L24.8828 10.2582C24.9264 10.2052 24.9591 10.1441 24.9789 10.0784C24.9988 10.0128 25.0055 9.94379 24.9987 9.8755C24.9918 9.80722 24.9715 9.74096 24.939 9.68054C24.9064 9.62012 24.8623 9.56673 24.809 9.52344Z"
              />
            </svg>

            <svg
              width="30"
              height="30"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
              onClick={rotateField}
              className="cursor-pointer"
            >
              <path
                d="M5 7H6C6.53043 7 7.03914 6.78929 7.41421 6.41421C7.78929 6.03914 8 5.53043 8 5C8 4.73478 8.10536 4.48043 8.29289 4.29289C8.48043 4.10536 8.73478 4 9 4H15C15.2652 4 15.5196 4.10536 15.7071 4.29289C15.8946 4.48043 16 4.73478 16 5C16 5.53043 16.2107 6.03914 16.5858 6.41421C16.9609 6.78929 17.4696 7 18 7H19C19.5304 7 20.0391 7.21071 20.4142 7.58579C20.7893 7.96086 21 8.46957 21 9V18C21 18.5304 20.7893 19.0391 20.4142 19.4142C20.0391 19.7893 19.5304 20 19 20H5C4.46957 20 3.96086 19.7893 3.58579 19.4142C3.21071 19.0391 3 18.5304 3 18V9C3 8.46957 3.21071 7.96086 3.58579 7.58579C3.96086 7.21071 4.46957 7 5 7Z"
                stroke="#515151"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M11.245 15.904C11.6886 16.0194 12.1527 16.0315 12.6017 15.9396C13.0507 15.8477 13.4727 15.6541 13.8353 15.3737C14.1979 15.0933 14.4914 14.7336 14.6933 14.3221C14.8952 13.9106 15.0001 13.4584 15 13M12.75 10.095C12.3067 9.98055 11.843 9.96908 11.3946 10.0615C10.9461 10.1539 10.5247 10.3477 10.1628 10.6281C9.80081 10.9085 9.50783 11.2681 9.30628 11.6792C9.10473 12.0903 8.99996 12.5421 9 13"
                stroke="#515151"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M14 13H16V15"
                stroke="#515151"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M10 13H8V11"
                stroke="#515151"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>

            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              onClick={handleRedo}
              className={`cursor-pointer ${undoStack.length === 0 ? "opacity-30" : ""}`}
            >
              <g clipPath="url(#clip0_681_274)">
                <path
                  d="M10.0178 0.312516C12.6064 0.317164 14.9567 1.33724 16.692 2.99552L18.0871 1.60041C18.6777 1.00982 19.6875 1.4281 19.6875 2.26334V7.50002C19.6875 8.01779 19.2678 8.43752 18.75 8.43752H13.5133C12.6781 8.43752 12.2598 7.42771 12.8504 6.83709L14.4813 5.20623C13.2756 4.07736 11.7156 3.45205 10.0582 3.43775C6.44891 3.40658 3.40652 6.32748 3.43773 10.0566C3.46734 13.5941 6.33531 16.5625 10 16.5625C11.6065 16.5625 13.1249 15.9892 14.3214 14.9392C14.5067 14.7767 14.7865 14.7866 14.9608 14.9608L16.5101 16.5101C16.7004 16.7004 16.691 17.0107 16.4913 17.1911C14.7735 18.7427 12.4971 19.6875 10 19.6875C4.64977 19.6875 0.312539 15.3503 0.3125 10.0001C0.312461 4.65599 4.67367 0.302945 10.0178 0.312516Z"
                  fill="#515151"
                />
              </g>
              <defs>
                <clipPath id="clip0_681_274">
                  <rect width="20" height="20" fill="white" />
                </clipPath>
              </defs>
            </svg>

            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              onClick={handleUndo}
              className={`cursor-pointer ${totalActions === 0 ? "opacity-30" : ""}`}
            >
              <g clipPath="url(#clip0_681_272)">
                <path
                  d="M9.98223 0.312516C7.39359 0.317164 5.04324 1.33724 3.30801 2.99552L1.91293 1.60045C1.3223 1.00982 0.3125 1.4281 0.3125 2.26334V7.50002C0.3125 8.01779 0.732227 8.43752 1.25 8.43752H6.48668C7.32191 8.43752 7.7402 7.42771 7.14961 6.83709L5.51875 5.20623C6.72437 4.07736 8.28441 3.45205 9.9418 3.43775C13.5511 3.40658 16.5935 6.32748 16.5623 10.0566C16.5327 13.5941 13.6647 16.5625 10 16.5625C8.39348 16.5625 6.87512 15.9892 5.67852 14.9392C5.49324 14.7767 5.21344 14.7866 5.03914 14.9608L3.48984 16.5101C3.29953 16.7004 3.30895 17.0107 3.50867 17.1911C5.22648 18.7427 7.50289 19.6875 10 19.6875C15.3502 19.6875 19.6875 15.3503 19.6875 10.0001C19.6875 4.65599 15.3263 0.302945 9.98223 0.312516Z"
                  fill="#515151"
                />
              </g>
              <defs>
                <clipPath id="clip0_681_272">
                  <rect width="20" height="20" fill="white" />
                </clipPath>
              </defs>
            </svg>
          </div>
        </div>

        <div className="w-[60vw] h-full flex items-center justify-center">
          <div
            ref={fieldContainerRef}
            onClick={handleFieldClick}
            className={`w-full aspect-square max-h-full relative rounded-2xl overflow-hidden ${pendingLocationAction ? "cursor-crosshair" : ""}`}
          >
            <img
              src={alliance == "red" ? red_field : blue_field}
              alt="Field"
              className="w-full h-full object-contain pointer-events-none"
              style={{
                transform: isRotated ? "rotate(180deg)" : "rotate(0deg)",
              }}
            />

            {/* Yellow arrows - always rendered, toggled with opacity for performance */}
            {/* Top arrow - pointing DOWN (inward) */}
            <div
              className="absolute top-2 left-1/2 -translate-x-1/2 pointer-events-none transition-opacity duration-75"
              style={{ opacity: pendingLocationAction ? 1 : 0 }}
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M7 10L12 15L17 10"
                  stroke="#CDA745"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            {/* Right arrow - pointing LEFT (inward) */}
            <div
              className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none transition-opacity duration-75"
              style={{ opacity: pendingLocationAction ? 1 : 0 }}
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M14 7L9 12L14 17"
                  stroke="#CDA745"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            {/* Bottom arrow - pointing UP (inward) */}
            <div
              className="absolute bottom-2 left-1/2 -translate-x-1/2 pointer-events-none transition-opacity duration-75"
              style={{ opacity: pendingLocationAction ? 1 : 0 }}
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M17 14L12 9L7 14"
                  stroke="#CDA745"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            {/* Left arrow - pointing RIGHT (inward) */}
            <div
              className="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none transition-opacity duration-75"
              style={{ opacity: pendingLocationAction ? 1 : 0 }}
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M10 17L15 12L10 7"
                  stroke="#CDA745"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            {/* Cage orientation buttons and dismount — normalized across alliances and rotations.
                cageOnLeft: red+unrotated OR blue+rotated (both show cage on left edge).
                Button order: when cage is on left, R=top/L=bottom (right end is higher on screen).
                When cage is on right (field rotated), order flips: L=top/R=bottom. */}
            {(() => {
              const cageOnLeft = (alliance === 'red') !== isRotated;
              const edgeStyle = cageOnLeft
                ? { left: '4px', top: '50%', transform: 'translateY(-50%)' }
                : { right: '4px', top: '50%', transform: 'translateY(-50%)' };
              const btnOrder = cageOnLeft
                ? (['right', 'center', 'left'] as const)
                : (['left', 'center', 'right'] as const);

              return (
                <>
                  {/* Auto climb orientation buttons */}
                  {isAuto && autoClimbActive && (
                    <div className="absolute flex flex-col gap-3" style={edgeStyle}>
                      {btnOrder.map((o) => (
                        <div
                          key={o}
                          onClick={(e) => { e.stopPropagation(); handleAutoOrientationPress(o); }}
                          className={`flex items-center justify-center w-10 h-10 rounded-md text-sm font-bold cursor-pointer active:scale-[0.92] transition-all duration-75 border-2 ${
                            autoClimbOrientation === o
                              ? 'border-[#4ADE80] text-[#4ADE80] bg-[#4ADE80]/20'
                              : 'border-[#4ADE80] text-[#4ADE80]'
                          }`}
                        >
                          {o === 'left' ? 'L' : o === 'center' ? 'C' : 'R'}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Teleop climb orientation buttons */}
                  {!isAuto && (teleopClimbActive || teleopClimbOrientation !== null) && (
                    <div className="absolute flex flex-col gap-3" style={edgeStyle}>
                      {btnOrder.map((o) => (
                        <div
                          key={o}
                          onClick={(e) => { e.stopPropagation(); handleTeleopOrientationPress(o); }}
                          className={`flex items-center justify-center w-10 h-10 rounded-md text-sm font-bold cursor-pointer active:scale-[0.92] transition-all duration-75 border-2 ${
                            teleopClimbOrientation === o
                              ? 'border-[#4ADE80] text-[#4ADE80] bg-[#4ADE80]/20'
                              : 'border-[#4ADE80] text-[#4ADE80]'
                          }`}
                        >
                          {o === 'left' ? 'L' : o === 'center' ? 'C' : 'R'}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Dismount button — centered on cage edge, first 10s of teleop */}
                  {!isAuto && autoClimbActiveRef.current && seconds <= 10 && !dismountRecorded && (
                    <div className="absolute" style={edgeStyle}>
                      <div
                        onClick={(e) => { e.stopPropagation(); handleDismount(); }}
                        className="flex items-center justify-center w-20 h-10 rounded-md text-sm font-bold cursor-pointer active:scale-[0.92] transition-all duration-75 border-2 border-[#CDA745] text-[#CDA745]"
                      >
                        Dismount
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
        
        {/* Preset action buttons (fixed location), 40% */}
        <div className="flex justify-center items-center w-[30vw] h-full gap-0 p-2.5 rounded-[15px] bg-black-950">
          {/*side bar, 5% */}
          <div className="flex flex-col justify-center-items-center w-[8.5vw] h-full gap-2.5 p-2.5">
            <div
              onClick={() => toggleAction("disable")}
              className={`flex justify-center items-center w-full h-full gap-5 p-2.5 rounded-[7.5px] cursor-pointer transition-all duration-75 active:scale-[0.92] ${
                activeToggles.disable
                  ? "border-2 border-[#BF4141]"
                  : "border-2 border-[#1E1E1E]"
              }`}
            >
              <p
                className={`rotate-270 text-xs text-outfit ${activeToggles.disable ? "text-[#BF4141]" : "text-muted-foreground"}`}
              >
                disabled
              </p>
            </div>

            {!isAuto && (
              <div
                onClick={() => toggleAction("defend")}
                className={`flex justify-center items-center w-full h-full gap-5 p-2.5 rounded-[7.5px] transition-all duration-75 cursor-pointer active:scale-[0.92] ${
                  activeToggles.defend
                    ? "border-2 border-[#CDA745]"
                    : "border-2 border-[#1E1E1E]"
                }`}
              >
                <p
                  className={`rotate-270 text-xs text-outfit ${activeToggles.defend ? "text-[#CDA745]" : "text-muted-foreground"}`}
                >
                  defend
                </p>
              </div>
            )}
          </div>
          <div className="flex flex-col justify-center items-center w-[21.5vw] h-full gap-2.5 p-2.5 rounded-[15px] bg-black-950 ">
          

          

          {/* Teleop only: Stocking row above intake/pass */}
          {!isAuto && (
            <div className="flex gap-2.5 w-full h-full">
              <div
                onClick={() => addPresetAction("stocking")}
                className="flex justify-center items-center w-full h-full gap-5 p-2.5 rounded-[15px] transition-all duration-75 cursor-pointer active:scale-[0.92] border-2 border-[#1E1E1E]"
              >
                <p className="text-xs text-outfit text-muted-foreground">Stocking</p>
              </div>
              <div
              onClick={() => startLocationAction("passing")}
              className={`flex justify-center items-center w-full h-full gap-5 p-2.5 rounded-[15px] transition-all duration-75 cursor-pointer active:scale-[0.92] ${
                pendingLocationAction === "passing"
                  ? "border-2 border-[#CDA745]"
                  : "border-2 border-[#1E1E1E]"
              }`}
            >
              <p
                className={`text-xs text-outfit ${pendingLocationAction === "passing" ? "text-[#CDA745]" : "text-muted-foreground"}`}
              >
                Pass
              </p>
            </div>
            </div>
            
            
          )}

          {/* Location action buttons (user selects position on field) */}
          <div className="flex gap-2.5 w-full h-full">
            <div
              onClick={() => startLocationAction("ground_intake")}
              className={`flex justify-center items-center w-full h-full gap-5 p-2.5 rounded-[15px] transition-all duration-75 cursor-pointer active:scale-[0.92] ${
                pendingLocationAction === "ground_intake"
                  ? "border-2 border-[#CDA745]"
                  : "border-2 border-[#1E1E1E]"
              }`}
            >
              <div className="flex items-center gap-1">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <g clip-path="url(#clip0_755_311)">
                <rect width="20" height="20" fill="black"/>
                <rect x="9" width="2" height="2.5" fill="#D9D9D9"/>
                <rect x="8" y="1" width="4" height="2" fill="#D9D9D9"/>
                <path d="M10 4H6.5L3 9.76L6.5 16" stroke="#D9D9D9" stroke-width="2"/>
                <path d="M10 4H13.5L17 9.76L13.5 16" stroke="#D9D9D9" stroke-width="2"/>
                <circle cx="10" cy="16" r="3.75" fill="#D9D9D9" stroke="#A3A3A3" stroke-width="0.5"/>
                </g>
                <defs>
                <clipPath id="clip0_755_311">
                <rect width="20" height="20" fill="white"/>
                </clipPath>
                </defs>
                </svg>



                <p
                  className={`text-xs text-outfit ${pendingLocationAction === "ground_intake" ? "text-[#CDA745]" : "text-muted-foreground"}`}
                >
                  Intake
                </p>
              </div>
              
            </div>

            {isAuto && (<div
              onClick={() => startLocationAction("passing")}
              className={`flex justify-center items-center w-full h-full gap-5 p-2.5 rounded-[15px] transition-all duration-75 cursor-pointer active:scale-[0.92] ${
                pendingLocationAction === "passing"
                  ? "border-2 border-[#CDA745]"
                  : "border-2 border-[#1E1E1E]"
              }`}
            >
              <p
                className={`text-xs text-outfit ${pendingLocationAction === "passing" ? "text-[#CDA745]" : "text-muted-foreground"}`}
              >
                Pass
              </p>
            </div>)}
          </div>

          <div className="flex gap-2.5 w-full h-full">
            <div
              onClick={() => startLocationAction("shoot")}
              className={`flex justify-center items-center w-full h-full gap-5 p-2.5 rounded-[15px] transition-all duration-75 cursor-pointer active:scale-[0.92] ${
                pendingLocationAction === "shoot"
                  ? "border-2 border-[#CDA745]"
                  : "border-2 border-[#1E1E1E]"
              }`}
            >
              <div className="flex items-center gap-1">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <g clip-path="url(#clip0_991_314)">
                <rect width="20" height="20" fill="black"/>
                <path d="M6.23389 13.9007C6.23389 14.5578 6.7685 15.0924 7.42567 15.0924C8.08284 15.0924 8.61739 14.5578 8.61739 13.9007C8.61739 13.2435 8.08284 12.709 7.42567 12.709C6.7685 12.709 6.23389 13.2435 6.23389 13.9007ZM7.54298 13.9007C7.54298 13.9653 7.49039 14.0179 7.42574 14.0179C7.36103 14.0179 7.30843 13.9653 7.30843 13.9007C7.30843 13.836 7.36103 13.7834 7.42574 13.7834C7.49032 13.7834 7.54298 13.836 7.54298 13.9007Z" fill="white"/>
                <path d="M19.9652 9.11853L17.4326 1.63631C17.3167 1.29396 16.9453 1.11012 16.6029 1.22621C16.2605 1.3421 16.0768 1.71355 16.1928 2.05598L16.3731 2.58857L5.52066 5.32358C5.37783 4.22763 4.58477 2.87106 2.73083 2.87106C2.36935 2.87106 2.07628 3.16419 2.07628 3.5256C2.07628 3.88702 2.36928 4.18015 2.73083 4.18015C3.36234 4.18015 3.7717 4.39833 4.01911 4.86675C4.18982 5.18991 4.22638 5.53153 4.23406 5.64783L3.43992 5.84796C3.42369 5.8522 3.40753 5.85692 3.39157 5.86217C0.791435 6.73503 -0.613885 9.56069 0.259044 12.1608C0.716283 13.5228 1.72059 14.584 2.97837 15.1351L2.76618 15.5026C2.29433 16.3198 2.23635 17.1566 2.60692 17.7985C2.9775 18.4402 3.73117 18.8084 4.6748 18.8084L10.1331 18.8083C11.0767 18.8083 11.8304 18.4402 12.2009 17.7984C12.5715 17.1566 12.5135 16.3197 12.0417 15.5026L10.6922 13.1653L18.5744 9.09187L18.7255 9.53827C18.8179 9.81113 19.0724 9.98305 19.3454 9.98305C19.4149 9.98305 19.4857 9.97187 19.5553 9.9483C19.8976 9.83241 20.0812 9.46096 19.9652 9.11853ZM11.0673 17.1439C10.9369 17.3697 10.5964 17.4992 10.1331 17.4992L4.67473 17.4993C4.21137 17.4993 3.87083 17.3697 3.74053 17.1439C3.61002 16.918 3.66814 16.5583 3.89979 16.1571L6.62894 11.4303C6.86053 11.029 7.14302 10.7989 7.40389 10.7989C7.6647 10.7989 7.94713 11.029 8.17878 11.4303L10.9079 16.1571C11.1396 16.5583 11.1976 16.918 11.0673 17.1439ZM9.31245 10.7757C8.84066 9.95853 8.14497 9.48985 7.40389 9.48985C6.66275 9.48985 5.96706 9.95853 5.49527 10.7757L3.63857 13.9916C2.64908 13.6043 1.85305 12.796 1.49999 11.7443C0.859314 9.83591 1.88389 7.76291 3.78531 7.11086L10.7089 5.36601L12.5375 10.7381L10.0369 12.0305L9.31245 10.7757ZM13.7135 10.1305L11.9825 5.04507L16.7838 3.83503L18.1308 7.84749L13.7135 10.1305Z" fill="white"/>
                </g>
                <defs>
                <clipPath id="clip0_991_314">
                <rect width="20" height="20" fill="#4ADE80"/>
                </clipPath>
                </defs>
                </svg>
                <p
                  className={`text-xs text-outfit ${pendingLocationAction === "shoot" ? "text-[#CDA745]" : "text-muted-foreground"}`}
                >
                  

                  <p>Shoot</p>
                  
                </p>
              </div>
              
            </div>
          </div>

          {/* Climb row: auto shows Start Climb / Fail; teleop shows L1/L2/L3 or Fail Climb */}
          <div className="flex gap-2.5 w-full h-full">
            {isAuto ? (
              autoClimbActive ? (
                <div
                  onClick={handleAutoClimbFail}
                  className="flex justify-center items-center w-full h-full gap-5 p-2.5 rounded-[15px] transition-all duration-75 cursor-pointer active:scale-[0.92] border-2 border-[#4ADE80]"
                >
                  <p className="text-xs text-outfit text-[#4ADE80]">Fail</p>
                </div>
              ) : (
                <div
                  onClick={handleAutoClimbStart}
                  className="flex justify-center items-center w-full h-full gap-5 p-2.5 rounded-[15px] transition-all duration-75 cursor-pointer active:scale-[0.92] border-2 border-[#1E1E1E]"
                >
                  <p className="text-xs text-outfit text-muted-foreground">Start Climb</p>
                </div>
              )
            ) : teleopClimbActive ? (
              <div
                onClick={handleTeleopClimbFail}
                className="flex justify-center items-center w-full h-full gap-5 p-2.5 rounded-[15px] transition-all duration-75 cursor-pointer active:scale-[0.92] border-2 border-[#4ADE80]"
              >
                <p className="text-xs text-outfit text-[#4ADE80]">Fail Climb</p>
              </div>
            ) : (
              <>
                {(['L1', 'L2', 'L3'] as const).map((level) => (
                  <div
                    key={level}
                    onClick={() => handleTeleopClimbStart(level)}
                    className="flex justify-center items-center w-full h-full gap-5 p-2.5 rounded-[15px] transition-all duration-75 cursor-pointer active:scale-[0.92] border-2 border-[#1E1E1E]"
                  >
                    <p className="text-xs text-outfit text-muted-foreground">{level}</p>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        
      </div>
      <div className="flex flex-col justify-start items-center w-[10vw] h-full px-6 py-2.5 rounded-[10px] gap-2.5 bg-black-950 border-2 border-[#1E1E1E]">
          {countdown !== null ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-6xl font-bold text-[#4ADE80] animate-pulse font-mono w-[60px] text-center">
        {countdown}
      </p>
            </div>
          ) : (
            <>
              <div className="w-[5vw]"></div>
              <p className="text-xs text-[#CDA745]">
                {Math.min(Math.round(seconds), isAuto ? 20 : 140) + "/"}
                {isAuto ? "20" : "140"}
              </p>
              <div className="relative flex flex-col gap-0 flex-1 w-1.25">
                {tickMarks && (
                  <div className="absolute inset-0 z-0">{tickMarks}</div>
                )}
                <div
                  style={{
                    height: `${(Math.min(seconds, isAuto ? 20 : 140) / (isAuto ? 20 : 140)) * 100}%`,
                  }}
                  className="flex flex-col w-full bg-[#CDA745] "
                ></div>
                <div
                  style={{
                    height: `${(Math.max(0, (isAuto ? 20 : 140) - seconds) / (isAuto ? 20 : 140)) * 100}%`,
                  }}
                  className="flex flex-col w-full bg-[#CDA745] opacity-70"
                ></div>
              </div>
            </>
          )}
        </div>

        {/* Toast notification */}
        {toastMessage && (
          <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 bg-[#CDA745] text-black px-6 py-3 rounded-lg shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200">
            <p className="text-sm font-medium">{toastMessage}</p>
          </div>
        )}
    </div>
        
    </>
  );
}
