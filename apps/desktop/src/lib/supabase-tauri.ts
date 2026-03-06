/**
 * Desktop Supabase client — identical to the shared client except realtime
 * uses tauri-plugin-websocket (Rust-backed) instead of the browser's native
 * WebSocket. This is required because WKWebView blocks wss:// connections
 * from the tauri://localhost origin in production Tauri builds.
 *
 * In dev (http://localhost:1420), native WebSocket works fine so we skip the
 * Rust wrapper — it adds unnecessary connection overhead and causes TIMED_OUT
 * more frequently during development.
 *
 * This file is wired in via a Vite alias in apps/desktop/vite.config.ts so
 * that all imports of "@lib/supabase/supabase" within the desktop app get
 * this Tauri-specific client instead of the shared one.
 */
import { createClient } from "@supabase/supabase-js";
import { TauriWebSocketWrapper } from "./tauri-websocket";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Only use Rust-backed WebSocket in production Tauri builds (tauri:// protocol).
// In dev (http://localhost:1420), native WebSocket works fine and is more reliable.
const isTauriProd = window.location.protocol === "tauri:";

const supabase = createClient(supabaseUrl, supabaseKey, {
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
    // Route WebSocket through Rust only in prod — WKWebView blocks wss:// from tauri://
    ...(isTauriProd
      ? { transport: TauriWebSocketWrapper as unknown as typeof WebSocket }
      : {}),
  },
  global: {
    headers: {
      "X-Client-Info": "funkyscout-desktop",
    },
  },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "implicit",
  },
});

export default supabase;
