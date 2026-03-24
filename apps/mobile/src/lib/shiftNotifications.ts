/**
 * Shift notification scheduler.
 *
 * Schedules browser Notification API alerts 1 minute before each upcoming shift.
 * Fires reliably while the app is open or recently backgrounded on Android.
 * On iOS, notifications may not fire if the app has been backgrounded > ~30s
 * (iOS suspends JS execution). True "app closed" notifications require a
 * server-side Web Push setup (VAPID) which is not implemented here.
 */

// Module-level map so timeouts survive re-renders
const pendingTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

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

/**
 * Schedule 1-minute-warning notifications for all upcoming shifts.
 * Clears any previously scheduled timeouts before rescheduling so this is
 * safe to call on every re-computation of the shift list.
 */
// Last known shifts — used to reschedule when app resumes from background.
let _lastShifts: ShiftForNotification[] = [];

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

    // Catchup: app was backgrounded and missed the 1-min window but match hasn't
    // started yet (within 3-min grace period). Fire immediately on resume.
    const missedWindow = delay <= 0 && shift.time > now - 3 * 60_000;
    if (missedWindow) {
      showShiftNotification(shift.matchLabel, shift.teamNumber, shift.alliance, true);
      continue;
    }
    if (delay <= 0) continue;

    const key = `${shift.match}-${shift.teamNumber}`;
    const t = setTimeout(() => {
      pendingTimeouts.delete(key);
      showShiftNotification(shift.matchLabel, shift.teamNumber, shift.alliance, false);
    }, delay);
    pendingTimeouts.set(key, t);
  }
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
  alliance: string
) {
  const title = `${matchLabel} in 1 minute`;
  const body = `Scout Team ${teamNumber} — ${alliance.charAt(0).toUpperCase() + alliance.slice(1)} Alliance`;
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
