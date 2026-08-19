import { createRootRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { Toaster } from "@shadcn/ui/components/sonner.tsx";
import { useEffect, useState } from "react";
import { useCompetition } from "@lib/context/CompetitionDataContext";
import { useEvent } from "@lib/context/EventContext";
import { getLocalUserData } from "@lib/supabase/user";
import { getUserEventScheduleAssignments } from "@lib/db";
import { checkNexusMatchCompletions, scheduleShiftNotifications } from "../lib/shiftNotifications";
import { getMatchLabel } from "@lib/utils/match";

function GlobalShiftNotificationManager() {
  const { currentEvent } = useEvent();
  const { nexusMatches, schedule, tbaSchedule } = useCompetition();
  const [shifts, setShifts] = useState<any[]>([]);

  // 1. Fetch user's shifts whenever currentEvent or user changes
  useEffect(() => {
    if (!currentEvent) {
      setShifts([]);
      return;
    }
    const { uid, name } = getLocalUserData();
    if (!uid && !name) {
      setShifts([]);
      return;
    }

    let active = true;

    async function loadShifts() {
      try {
        const assignments = uid
          ? await getUserEventScheduleAssignments(currentEvent, uid, true)
          : await getUserEventScheduleAssignments(currentEvent, name || "", false);
        
        if (active) {
          setShifts(assignments);
        }
      } catch (err) {
        console.error("[GlobalNotifications] Failed to load assignments:", err);
      }
    }

    loadShifts();

    return () => {
      active = false;
    };
  }, [currentEvent]);

  // 2. Schedule notifications (time-based fallback) and update cache when shifts or tbaSchedule changes
  useEffect(() => {
    if (shifts.length === 0) return;

    const formattedShifts = shifts.map((s) => {
      const matchTime = tbaSchedule[s.match]?.est_time 
        ? tbaSchedule[s.match].est_time * 1000 
        : null;
      return {
        match: s.match,
        matchLabel: getMatchLabel(s.match),
        teamNumber: s.team.replace("frc", ""),
        alliance: s.alliance,
        time: matchTime,
      };
    });

    scheduleShiftNotifications(formattedShifts);
  }, [shifts, tbaSchedule]);

  // 3. Monitor nexusMatches for match completions to trigger live notifications
  useEffect(() => {
    if (!currentEvent || nexusMatches.length === 0 || schedule.length === 0) return;

    const allMatches = schedule.map((s) => s.match);
    checkNexusMatchCompletions(nexusMatches, currentEvent, allMatches);
  }, [nexusMatches, currentEvent, schedule]);

  return null;
}

const RootLayout = () => {
  const location = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  useEffect(() => {
    // Only reset scroll when navigating away from /home (not on tab switches within home)
    if (!location.startsWith("/home")) {
      window.scrollTo(0, 0);
    }
  }, [location]);

  return (
    <>
      <Outlet />
      <Toaster position="top-center" />
      <GlobalShiftNotificationManager />
    </>
  );
};

export const Route = createRootRoute({ component: RootLayout });
