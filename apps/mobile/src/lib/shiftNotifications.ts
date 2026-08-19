/**
 * Shift notification scheduler.
 *
 * Schedules browser Notification API alerts when the preceding match ends
 * (using live Nexus status), with a time-based 1-minute warning fallback.
 * Fires reliably while the app is open or recently backgrounded on Android.
 * On iOS, notifications may not fire if the app has been backgrounded > ~30s
 * (iOS suspends JS execution). True "app closed" notifications require a
 * server-side Web Push setup (VAPID) which is not implemented here.
 */

import { nexusLabelToMatchKey } from "@lib/nexus";
import { getMatchLabel } from "@lib/utils/match";

// Module-level map so timeouts survive re-renders
const pendingTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

// Tracks which shift keys have already fired a notification. Once a shift
// notification fires (via timeout, match end, or catchup), it will never fire again.
const shownNotifications = new Set<string>();

// Keep track of active matches in the previous poll to detect completions
let prevActiveMatchKeys = new Set<string>();

/** Call once on app load to request notification permission from the user. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

/** Clear all pending shift notification timeouts. Call on unmount or before rescheduling. */
export function clearShiftNotifications() {
  pendingTimeouts.forEach((t) => clearTimeout(t));
  pendingTimeouts.clear();
}

export interface ShiftForNotification {
  match: string;
  matchLabel: string;
  teamNumber: string;
  alliance: string;
  time: number | null; // epoch ms
}

// Last known shifts — used to reschedule when app resumes from background.
let _lastShifts: ShiftForNotification[] = [];

/**
 * Schedule 1-minute-warning notifications for all upcoming shifts (fallback method).
 * Clears any previously scheduled timeouts before rescheduling so this is
 * safe to call on every re-computation of the shift list.
 */
export function scheduleShiftNotifications(shifts: ShiftForNotification[]) {
  _lastShifts = shifts;
  clearShiftNotifications();

  if (!("Notification" in window) || Notification.permission !== "granted") {
    return;
  }

  const now = Date.now();
  for (const shift of shifts) {
    if (!shift.time) continue;
    const delay = shift.time - now - 60_000; // fire 1 min before
    const key = `${shift.match}-${shift.teamNumber}`;

    // Catchup: app was backgrounded and missed the 1-min window but match hasn't
    // started yet (within 3-min grace period). Fire immediately on resume.
    const missedWindow = delay <= 0 && shift.time > now - 60_000;
    if (missedWindow) {
      if (!shownNotifications.has(key)) {
        shownNotifications.add(key);
        showShiftNotification(shift.matchLabel, shift.teamNumber, shift.alliance);
      }
      continue;
    }
    if (delay <= 0) continue;

    // Only schedule if not already shown
    if (shownNotifications.has(key)) continue;

    const t = setTimeout(() => {
      pendingTimeouts.delete(key);
      shownNotifications.add(key);
      showShiftNotification(shift.matchLabel, shift.teamNumber, shift.alliance);
    }, delay);
    pendingTimeouts.set(key, t);
  }
}

/**
 * Check if any active matches have completed and fire notifications for the
 * subsequent shift matches.
 */
export function checkNexusMatchCompletions(
  nexusMatches: { label: string }[],
  eventKey: string,
  allMatchesInSchedule: string[]
) {
  if (!nexusMatches || nexusMatches.length === 0 || _lastShifts.length === 0) {
    if (nexusMatches && nexusMatches.length === 0) {
      prevActiveMatchKeys.clear();
    }
    return;
  }

  if (!("Notification" in window) || Notification.permission !== "granted") {
    return;
  }

  // 1. Convert current Nexus matches to full match keys
  const currentActiveMatchKeys = new Set(
    nexusMatches.map((m) => {
      const suffix = nexusLabelToMatchKey(m.label);
      return `${eventKey}_${suffix}`;
    })
  );

  // 2. Identify matches that were active but are now completed (disappeared)
  if (prevActiveMatchKeys.size > 0 && currentActiveMatchKeys.size > 0) {
    const completedMatchKeys = [...prevActiveMatchKeys].filter(
      (key) => !currentActiveMatchKeys.has(key)
    );

    if (completedMatchKeys.length > 0) {
      console.log("[Notifications] Detected completed matches:", completedMatchKeys);

      // Sort all schedule matches to find sequential order
      const sortedMatches = [...new Set(allMatchesInSchedule)].sort((a, b) => {
        const aLower = a.toLowerCase();
        const bLower = b.toLowerCase();
        const aIsQual = aLower.includes("qm");
        const bIsQual = bLower.includes("qm");

        if (aIsQual && !bIsQual) return -1;
        if (!aIsQual && bIsQual) return 1;

        const aNum = parseInt(a.replace(/\D/g, ""), 10) || 0;
        const bNum = parseInt(b.replace(/\D/g, ""), 10) || 0;

        return aNum - bNum;
      });

      for (const completedKey of completedMatchKeys) {
        const idx = sortedMatches.indexOf(completedKey);
        if (idx !== -1 && idx + 1 < sortedMatches.length) {
          const nextMatchKey = sortedMatches[idx + 1];

          // Check if user has an assigned shift for this next match
          const shiftForNextMatch = _lastShifts.find((s) => s.match === nextMatchKey);
          if (shiftForNextMatch) {
            const key = `${shiftForNextMatch.match}-${shiftForNextMatch.teamNumber}`;
            if (!shownNotifications.has(key)) {
              shownNotifications.add(key);

              // Cancel any pending time-based timeout for this shift
              const pendingTimeout = pendingTimeouts.get(key);
              if (pendingTimeout) {
                clearTimeout(pendingTimeout);
                pendingTimeouts.delete(key);
              }

              // Fire the notification!
              const completedMatchLabel = getMatchLabel(completedKey);
              showShiftNotification(
                shiftForNextMatch.matchLabel,
                shiftForNextMatch.teamNumber,
                shiftForNextMatch.alliance,
                completedMatchLabel
              );
            }
          }
        }
      }
    }
  }

  prevActiveMatchKeys = currentActiveMatchKeys;
}

/**
 * Call this when the app becomes visible again (visibilitychange → visible).
 * iOS suspends JS timers in the background — rescheduling on resume ensures
 * notifications fire correctly even if the scouter briefly switched apps.
 */
export function rescheduleOnResume() {
  if (_lastShifts.length > 0) {
    scheduleShiftNotifications(_lastShifts);
  }
}

async function showShiftNotification(
  matchLabel: string,
  teamNumber: string,
  alliance: string,
  completedMatchLabel?: string
) {
  const title = completedMatchLabel
    ? `${completedMatchLabel} has ended!`
    : `${matchLabel} starting soon`;

  const body = completedMatchLabel
    ? `You are up next to scout Team ${teamNumber} in ${matchLabel} (${alliance.charAt(0).toUpperCase() + alliance.slice(1)} Alliance)`
    : `Scout Team ${teamNumber} — ${alliance.charAt(0).toUpperCase() + alliance.slice(1)} Alliance`;

  const options: NotificationOptions = {
    body,
    icon: "/icon-180.png",
    badge: "/icon-180.png",
    tag: `shift-${matchLabel}-${teamNumber}`, // deduplicates per match+team
  };

  // ServiceWorker.showNotification works even when the tab is backgrounded
  if ("serviceWorker" in navigator) {
    try {
      const sw = await navigator.serviceWorker.ready;
      await sw.showNotification(title, options);
      return;
    } catch {
      // Fall through to direct Notification
    }
  }
  new Notification(title, options);
}
