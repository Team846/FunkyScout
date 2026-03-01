/// <reference types="./vite-env.d.ts" />
import { createClient } from "@supabase/supabase-js";
// import { Database } from "./database.types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient
// <Database>
(
   supabaseUrl,
   supabaseKey,
   {
     // Mobile-optimized realtime configuration
     realtime: {
       params: {
         eventsPerSecond: 10, // Throttle to 10 events/sec to avoid overwhelming mobile
       },
     },
     global: {
       headers: {
         // Add app identifier for debugging
         'X-Client-Info': 'funkyscout-mobile',
       },
     },
     auth: {
       // Persist session across app restarts
       persistSession: true,
       autoRefreshToken: true,
       detectSessionInUrl: true, // Required for password reset / email confirmation links (token in URL hash)
       flowType: "implicit", // Avoid PKCE: the code verifier lives in Safari's localStorage,
                             // which is isolated from SafariViewController (the in-app browser
                             // that opens when tapping a confirmation link from Mail).
                             // Implicit flow delivers the session token in the URL hash,
                             // so it works from any browser context.
     },
   }
);

// Development-only: Prevent zombie channels from hot reloads
if (import.meta.env.DEV) {
  // Track active channel count for debugging
  let channelCount = 0;

  // Wrap channel creation to log and track
  const originalChannel = supabase.channel.bind(supabase);
  (supabase as any).channel = function(name: string, opts?: any) {
    channelCount++;
    console.log(`[Supabase] 📡 Creating channel "${name}" (total active: ${channelCount})`);
    return originalChannel(name, opts);
  };

  // Wrap channel removal to log and track
  const originalRemoveChannel = supabase.removeChannel.bind(supabase);
  (supabase as any).removeChannel = function(channel: any) {
    channelCount = Math.max(0, channelCount - 1);
    console.log(`[Supabase] 🗑️ Removing channel (remaining: ${channelCount})`);
    return originalRemoveChannel(channel);
  };

  // CRITICAL: Cleanup all channels on page unload to prevent zombies
  // This handles browser close, page refresh, and hot reloads
  window.addEventListener('beforeunload', () => {
    if (channelCount > 0) {
      console.log(`[Supabase] 🧹 beforeunload: Cleaning up ${channelCount} channels`);
      supabase.removeAllChannels();
      channelCount = 0;
    }
  });

  // Periodic zombie detection (every 30s)
  setInterval(() => {
    if (channelCount > 5) {
      console.warn(`[Supabase] ⚠️ High channel count detected: ${channelCount} active channels`);
      console.warn('[Supabase] This may indicate zombie channels from hot reloads');
    } else if (channelCount > 0) {
      console.log(`[Supabase] 📊 Active channels: ${channelCount}`);
    }
  }, 30000);
}

export default supabase;
