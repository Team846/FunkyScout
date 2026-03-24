/**
 * Supabase Realtime Presence for active scouting status.
 *
 * Mobile joins a presence channel when entering match_start or match_play.
 * Desktop subscribes to the same channel to see who is actively scouting.
 *
 * This is ephemeral — zero DB writes, zero polling. Supabase automatically
 * removes presence when the connection drops (e.g. app closed/backgrounded).
 */

import supabase from "@lib/supabase/supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";

export interface ScoutPresencePayload {
  uid: string;
  name: string;
  match: string;
  team: string;
  phase: "match_start" | "match_play";
}

// Module-level singleton — persists across component mounts so the channel
// stays alive during the match_start → match_play navigation transition.
let activeChannel: RealtimeChannel | null = null;
let activeEvent: string | null = null;

/**
 * Join the scouting presence channel for this event.
 * Safe to call if already joined — will update the existing presence payload.
 */
export async function joinScoutPresence(
  event: string,
  payload: ScoutPresencePayload
): Promise<void> {
  if (import.meta.env.DEV) {
    console.log("[ScoutPresence] Disabled in dev mode");
    return;
  }

  // If we're already on this event's channel, just update presence
  if (activeChannel && activeEvent === event) {
    await activeChannel.track(payload);
    console.log(`[ScoutPresence] Updated presence: ${payload.phase} for ${payload.match}`);
    return;
  }

  // Clean up any stale channel from a different event
  if (activeChannel) {
    await leaveScoutPresence();
  }

  const channel = supabase.channel(`scouting-presence-${event}`, {
    config: { presence: { key: payload.uid } },
  });

  channel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      await channel.track(payload);
      console.log(`[ScoutPresence] Joined presence: ${payload.phase} for ${payload.match}`);
    }
  });

  activeChannel = channel;
  activeEvent = event;
}

/**
 * Update the current presence payload (e.g. phase transition match_start → match_play).
 * No-op if not currently tracking.
 */
export async function updateScoutPresence(
  payload: Partial<ScoutPresencePayload>
): Promise<void> {
  if (!activeChannel) return;
  // track() replaces the entire presence payload, so merge with a new call
  await activeChannel.track(payload as ScoutPresencePayload);
  console.log(`[ScoutPresence] Updated presence phase: ${payload.phase}`);
}

/**
 * Leave the presence channel. Call when exiting the scouting flow
 * (back navigation from match_start or when match_play unmounts).
 */
export async function leaveScoutPresence(): Promise<void> {
  if (!activeChannel) return;
  try {
    await activeChannel.untrack();
    await supabase.removeChannel(activeChannel);
  } catch {
    // Non-fatal — connection may already be gone
  }
  activeChannel = null;
  activeEvent = null;
  console.log("[ScoutPresence] Left presence channel");
}
