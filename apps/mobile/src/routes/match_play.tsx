import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import React from "react";
import red_field from "/red_field.svg";
import blue_field from "/blue_field.svg";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { getMatchLabel } from "@lib/utils/match";
import { vibrateShake, vibrateBuzz, vibrateTap } from "@lib/utils/haptics";
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
};

export const Route = createFileRoute("/match_play")({
  component: MatchPlay,
  validateSearch: (search: Record<string, unknown>): MatchType => {
    return {
      teamNum: search.teamNum as string | undefined | null,
      matchNum: search.matchNum as string | undefined | null,
      alliance: search.alliance as string | undefined | null,
      practice: search.practice as boolean | undefined | null,
    };
  },
});

function MatchPlay() {
  const navigate = useNavigate();
  const handleBackClick = () => {
    // Clear in-progress data when leaving
    sessionStorage.removeItem("inProgressMatchData");
    if (practice) {
      navigate({ to: "/auth" });
    } else {
      navigate({ to: "/home" });
    }
  };
  const { teamNum, matchNum, alliance, practice } = Route.useSearch();
  const [seconds, setSeconds] = useState(0);

  const [isAuto, setIsAuto] = useState(true);

  const [isRotated, setIsRotated] = useState(false);

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

  // Match scouting data - load from localStorage if exists
  const [matchData, setMatchData] = useState<MatchScoutingData>(() => {
    const saved = sessionStorage.getItem("inProgressMatchData");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return createEmptyMatchData();
      }
    }
    return createEmptyMatchData();
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
  const [pendingLocationAction, setPendingLocationAction] = useState<LocationActionType | null>(null);

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

  // Reset auto climb when transitioning from auto to teleop
  const prevIsAutoRef = useRef(isAuto);
  useEffect(() => {
    // Check if we just transitioned from auto to teleop
    if (prevIsAutoRef.current === true && isAuto === false) {
      // Check if climb_L1 is active from auto phase
      const hasAutoClimb = matchData.toggleActions.some(
        a => a.type === 'climb_L1' && a.active && a.phase === 'auto'
      );

      if (hasAutoClimb) {
        // Deactivate the auto climb
        const deactivateAction: ToggleAction = {
          type: 'climb_L1',
          timestamp: Date.now(),
          active: false,
          phase: 'teleop',
        };

        setMatchData((prev) => ({
          ...prev,
          toggleActions: [...prev.toggleActions, deactivateAction],
        }));
      }
    }

    prevIsAutoRef.current = isAuto;
  }, [isAuto, matchData.toggleActions]);

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

  // Add preset action (fuel, station)
  const addPresetAction = (actionType: PresetActionType) => {
    // Auto-cancel disabled if it's active
    const updates: Partial<MatchScoutingData> = {};

    if (activeToggles.disable) {
      const phase = isAuto ? "auto" : seconds > 140 - 10 ? "endgame" : "teleop";
      updates.toggleActions = [
        ...(matchDataRef.current.toggleActions || []),
        {
          type: 'disable',
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
    if (activeToggles.disable && actionType !== 'disable') {
      newActions.push({
        type: 'disable',
        timestamp: Date.now(),
        active: false,
        phase,
      });
    }

    // Handle climb exclusivity - only one climb level can be active at a time
    if (actionType.startsWith('climb_') && !currentlyActive) {
      // Deactivate any other active climb levels
      const climbTypes: ToggleActionType[] = ['climb_L1', 'climb_L2', 'climb_L3'];
      climbTypes.forEach(climbType => {
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
  const startLocationAction = useCallback((actionType: LocationActionType) => {
    // Auto-cancel disabled if it's active (batched with state update)
    if (activeToggles.disable) {
      const phase = isAuto ? "auto" : seconds > 140 - 10 ? "endgame" : "teleop";
      setMatchData((prev) => ({
        ...prev,
        toggleActions: [
          ...prev.toggleActions,
          {
            type: 'disable',
            timestamp: Date.now(),
            active: false,
            phase,
          },
        ],
      }));
    }

    setPendingLocationAction((prev) => (prev === actionType ? null : actionType));
    vibrateTap();
  }, [activeToggles.disable, isAuto, seconds]);

  // Handle field click for location actions
  const handleFieldClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!pendingLocationAction || !fieldContainerRef.current) return;

    const rect = fieldContainerRef.current.getBoundingClientRect();
    const pixelX = e.clientX - rect.left;
    const pixelY = e.clientY - rect.top;
    const [normalizedX, normalizedY] = pixelToNormalized(
      pixelX,
      pixelY,
      rect.width,
      rect.height
    );

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

    const allActions = [...locationActions, ...presetActions, ...toggleActions].sort(
      (a, b) => b.timestamp - a.timestamp
    );

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

    setTimeout(() => setCountdown(2), 1000);
    setTimeout(() => setCountdown(1), 2000);
    setTimeout(async () => {
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
      timer2Ref.current = setTimeout(() => {
        // Store matchData in sessionStorage to pass to match_end
        sessionStorage.setItem("currentMatchData", JSON.stringify(matchDataRef.current));
        sessionStorage.removeItem("inProgressMatchData"); // Clear in-progress data
        navigate({
          to: "/match_end",
          search: { teamNum, matchNum, alliance, practice },
        });
      }, 140 * 1000);

      // Set up teleop countdown
      countdownTeleopRef.current = setTimeout(() => {
        console.log(
          "🔔 Triggering TELEOP countdown at 137 seconds (after fast-forward)"
        );
        triggerCountdown();
      }, 137 * 1000);
    } else {
      // Skip to end
      sessionStorage.setItem("currentMatchData", JSON.stringify(matchDataRef.current));
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

    // Auto mode countdown: trigger at 17s (3 seconds before 20s switch)
    countdownAutoRef.current = window.setTimeout(() => {
      triggerCountdown();
    }, 17 * 1000);

    // Auto->Teleop switch at 20s
    timer1Ref.current = window.setTimeout(() => {
      setIsAuto(false);
      reset();

      // Set up teleop countdown: trigger at 137s after teleop starts (3 seconds before 140s end)
      countdownTeleopRef.current = window.setTimeout(() => {
        triggerCountdown();
      }, 137 * 1000);
    }, 20 * 1000);

    // Match end at 160s total
    timer2Ref.current = window.setTimeout(() => {
      // Store matchData in sessionStorage to pass to match_end
      sessionStorage.setItem("currentMatchData", JSON.stringify(matchDataRef.current));
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
    }, 160 * 1000);

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

        <div className="w-[45vw] h-full flex items-center justify-center">
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
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M7 10L12 15L17 10" stroke="#CDA745" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>

            {/* Right arrow - pointing LEFT (inward) */}
            <div
              className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none transition-opacity duration-75"
              style={{ opacity: pendingLocationAction ? 1 : 0 }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M14 7L9 12L14 17" stroke="#CDA745" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>

            {/* Bottom arrow - pointing UP (inward) */}
            <div
              className="absolute bottom-2 left-1/2 -translate-x-1/2 pointer-events-none transition-opacity duration-75"
              style={{ opacity: pendingLocationAction ? 1 : 0 }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M17 14L12 9L7 14" stroke="#CDA745" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>

            {/* Left arrow - pointing RIGHT (inward) */}
            <div
              className="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none transition-opacity duration-75"
              style={{ opacity: pendingLocationAction ? 1 : 0 }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M10 17L15 12L10 7" stroke="#CDA745" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </div>
        </div>

        <div className="flex flex-col justify-center items-center w-[35vw] h-full gap-2.5 p-2.5 rounded-[15px] bg-black-950 ">
          {/* Fuel buttons - 2x2 grid */}
          <div className="flex justify-center items-center w-full h-full gap-5 p-2.5 rounded-[15px] border-2 border-[#1E1E1E]">
            <svg
              width="48"
              height="48"
              viewBox="0 0 48 48"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              onClick={() => addPresetAction("fuel_1")}
              className="cursor-pointer active:scale-[0.85] transition-transform duration-75"
            >
              <rect
                x="0.5"
                y="0.5"
                width="47"
                height="47"
                rx="23.5"
                fill="none"
                stroke="#8A8A8A"
              />
              <path
                d="M19.9922 27.7898V21.0682H21.3295V27.7898H19.9922ZM17.3026 25.0952V23.7628H24.0241V25.0952H17.3026ZM30.1665 19.3182V29.5H28.6254V20.8594H28.5657L26.1296 22.4503V20.9787L28.6701 19.3182H30.1665Z"
                fill="white"
                fillOpacity="0.4"
              />
            </svg>

            <svg
              width="48"
              height="48"
              viewBox="0 0 48 48"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              onClick={() => addPresetAction("fuel_2")}
              className="cursor-pointer active:scale-[0.85] transition-transform duration-75"
            >
              <rect
                x="0.5"
                y="0.5"
                width="47"
                height="47"
                rx="23.5"
                fill="none"
                stroke="#8A8A8A"
              />
              <path
                d="M18.9922 27.7898V21.0682H20.3295V27.7898H18.9922ZM16.3026 25.0952V23.7628H23.0241V25.0952H16.3026ZM24.8935 29.5V28.3864L28.3388 24.8168C28.7067 24.429 29.0099 24.0893 29.2486 23.7976C29.4905 23.5026 29.6712 23.2225 29.7905 22.9574C29.9098 22.6922 29.9695 22.4105 29.9695 22.1122C29.9695 21.7741 29.8899 21.4825 29.7308 21.2372C29.5717 20.9886 29.3546 20.7981 29.0795 20.6655C28.8045 20.5296 28.4946 20.4616 28.1499 20.4616C27.7853 20.4616 27.4671 20.5362 27.1953 20.6854C26.9235 20.8345 26.7147 21.045 26.5689 21.3168C26.4231 21.5885 26.3501 21.9067 26.3501 22.2713H24.8835C24.8835 21.6515 25.026 21.1096 25.3111 20.6456C25.5961 20.1816 25.9872 19.822 26.4844 19.5668C26.9815 19.3082 27.5466 19.179 28.1797 19.179C28.8194 19.179 29.3828 19.3066 29.87 19.5618C30.3606 19.8137 30.7434 20.1584 31.0185 20.5959C31.2936 21.0301 31.4311 21.5206 31.4311 22.0675C31.4311 22.4453 31.3598 22.8149 31.2173 23.1761C31.0781 23.5374 30.8345 23.9401 30.4865 24.3842C30.1385 24.825 29.6546 25.3603 29.0348 25.9901L27.0114 28.108V28.1825H31.5952V29.5H24.8935Z"
                fill="white"
                fillOpacity="0.4"
              />
            </svg>
          </div>

          <div className="flex justify-center items-center w-full h-full gap-5 p-2.5 rounded-[15px] border-2 border-[#1E1E1E]">
            <svg
              width="48"
              height="48"
              viewBox="0 0 48 48"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              onClick={() => addPresetAction("fuel_5")}
              className="cursor-pointer active:scale-[0.85] transition-transform duration-75"
            >
              <rect
                x="0.5"
                y="0.5"
                width="47"
                height="47"
                rx="23.5"
                fill="none"
                stroke="#8A8A8A"
              />
              <path
                d="M19.9922 27.7898V21.0682H21.3295V27.7898H19.9922ZM17.3026 25.0952V23.7628H24.0241V25.0952H17.3026ZM30.1665 29.5V28.1825H26.4744V27.0085L30.2034 19.3182H31.4311V27.0085H32.5379V28.1825H31.4311V29.5H30.1665ZM27.7404 27.0085H30.1665V21.6719H30.1068L27.7404 27.0085Z"
                fill="white"
                fillOpacity="0.4"
              />
            </svg>

            <svg
              width="48"
              height="48"
              viewBox="0 0 48 48"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              onClick={() => addPresetAction("fuel_8")}
              className="cursor-pointer active:scale-[0.85] transition-transform duration-75"
            >
              <rect
                x="0.5"
                y="0.5"
                width="47"
                height="47"
                rx="23.5"
                fill="none"
                stroke="#8A8A8A"
              />
              <path
                d="M19.9922 27.7898V21.0682H21.3295V27.7898H19.9922ZM17.3026 25.0952V23.7628H24.0241V25.0952H17.3026ZM30.1665 29.6392C29.5865 29.6392 29.0595 29.5199 28.5854 29.2812C28.1113 29.0393 27.7169 28.7079 27.4219 28.2869C27.1269 27.866 26.9695 27.3854 26.9496 26.8452H28.4311C28.4675 27.2827 28.6614 27.6423 29.0128 27.924C29.3641 28.2057 29.785 28.3466 30.2755 28.3466C30.6666 28.3466 31.013 28.2571 31.3146 28.0781C31.6195 27.8958 31.8581 27.6456 32.0305 27.3274C32.2062 27.0092 32.294 26.6463 32.294 26.2386C32.294 25.8243 32.2045 25.4548 32.0255 25.13C31.8465 24.8052 31.5996 24.55 31.2848 24.3643C30.9732 24.1787 30.6152 24.0843 30.2109 24.081C29.9026 24.081 29.5928 24.134 29.2812 24.2401C28.9696 24.3461 28.7178 24.4853 28.5255 24.6577L27.1186 24.4489L27.6903 19.3182H33.2883V20.6357H28.968L28.6448 23.4844H28.7045C28.9034 23.2921 29.1669 23.1314 29.495 23.0021C29.8264 22.8729 30.1811 22.8082 30.5589 22.8082C31.1787 22.8082 31.7305 22.9557 32.2144 23.2507C32.7017 23.5457 33.0845 23.9484 33.3629 24.4588C33.6446 24.9659 33.7838 25.5492 33.7805 26.2088C33.7838 26.8684 33.6347 27.4567 33.333 27.9737C33.0348 28.4908 32.6205 28.8984 32.0901 29.1967C31.5632 29.4917 30.9583 29.6392 30.2755 29.6392H30.1665Z"
                fill="white"
                fillOpacity="0.4"
              />
            </svg>
          </div>

          {/* Location action buttons */}
          <div className="flex gap-2.5 w-full h-full">
            <div
              onClick={() => startLocationAction("ground_intake")}
              className={`flex justify-center items-center w-full h-full gap-5 p-2.5 rounded-[15px] transition-all duration-75 cursor-pointer active:scale-[0.92] ${
                pendingLocationAction === "ground_intake"
                  ? "border-2 border-[#CDA745]"
                  : "border-2 border-[#1E1E1E]"
              }`}
            >
              <p
                className={`text-xs text-outfit ${pendingLocationAction === "ground_intake" ? "text-[#CDA745]" : "text-muted-foreground"}`}
              >
                Intake
              </p>
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

          {/* Disable and Defend toggles - defend only in teleop */}
          <div className="flex gap-2.5  w-full h-full">
            <div
              onClick={() => toggleAction("disable")}
              className={`flex justify-center items-center w-full h-full gap-5 p-2.5 rounded-[15px] cursor-pointer transition-all duration-75 active:scale-[0.92] ${
                activeToggles.disable
                  ? "border-2 border-[#BF4141]"
                  : "border-2 border-[#1E1E1E]"
              }`}
            >
              <p
                className={`text-xs text-outfit ${activeToggles.disable ? "text-[#BF4141]" : "text-muted-foreground"}`}
              >
                disabled
              </p>
            </div>

            {!isAuto && (
              <div
                onClick={() => toggleAction("defend")}
                className={`flex justify-center items-center w-full h-full gap-5 p-2.5 rounded-[15px] transition-all duration-75 cursor-pointer active:scale-[0.92] ${
                  activeToggles.defend
                    ? "border-2 border-[#CDA745]"
                    : "border-2 border-[#1E1E1E]"
                }`}
              >
                <p
                  className={`text-xs text-outfit ${activeToggles.defend ? "text-[#CDA745]" : "text-muted-foreground"}`}
                >
                  defend
                </p>
              </div>
            )}
          </div>

          {/* Climb toggles - L1 always available, L2/L3 teleop only */}
          <div className="flex gap-2.5 w-full h-full">
            <div
              onClick={() => toggleAction("climb_L1")}
              className={`flex justify-center items-center w-full h-full gap-5 p-2.5 rounded-[15px] transition-all duration-75 cursor-pointer active:scale-[0.92] ${
                activeToggles.climb_L1
                  ? "border-2 border-[#4ADE80]"
                  : "border-2 border-[#1E1E1E]"
              }`}
            >
              <p
                className={`text-xs text-outfit ${activeToggles.climb_L1 ? "text-[#4ADE80]" : "text-muted-foreground"}`}
              >
                L1
              </p>
            </div>

            {!isAuto && (
              <>
                <div
                  onClick={() => toggleAction("climb_L2")}
                  className={`flex justify-center items-center w-full h-full gap-5 p-2.5 rounded-[15px] transition-all duration-75 cursor-pointer active:scale-[0.92] ${
                    activeToggles.climb_L2
                      ? "border-2 border-[#4ADE80]"
                      : "border-2 border-[#1E1E1E]"
                  }`}
                >
                  <p
                    className={`text-xs text-outfit ${activeToggles.climb_L2 ? "text-[#4ADE80]" : "text-muted-foreground"}`}
                  >
                    L2
                  </p>
                </div>

                <div
                  onClick={() => toggleAction("climb_L3")}
                  className={`flex justify-center items-center w-full h-full gap-5 p-2.5 rounded-[15px] transition-all duration-75 cursor-pointer active:scale-[0.92] ${
                    activeToggles.climb_L3
                      ? "border-2 border-[#4ADE80]"
                      : "border-2 border-[#1E1E1E]"
                  }`}
                >
                  <p
                    className={`text-xs text-outfit ${activeToggles.climb_L3 ? "text-[#4ADE80]" : "text-muted-foreground"}`}
                  >
                    L3
                  </p>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-col justify-start items-center w-[10vw] h-full px-6 py-2.5 rounded-[10px] gap-2.5 bg-black-950 border-2 border-[#1E1E1E]">
          {countdown !== null ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-6xl font-bold text-[#4ADE80] animate-pulse">
                {countdown}
              </p>
            </div>
          ) : (
            <>
              <p className="text-xs text-[#CDA745]">
                {Math.round(seconds) + "/"}
                {isAuto ? "20" : "140"}
              </p>
              <div className="relative flex flex-col gap-0 flex-1 w-1.25">
                {tickMarks && (
                  <div className="absolute inset-0 z-0">{tickMarks}</div>
                )}
                <div
                  style={{
                    height: `${(seconds / (isAuto ? 20 : 140)) * 100}%`,
                  }}
                  className="flex flex-col w-full bg-[#CDA745] "
                ></div>
                <div
                  style={{
                    height: `${(((isAuto ? 20 : 140) - seconds) / (isAuto ? 20 : 140)) * 100}%`,
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
  );
}
