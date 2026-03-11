/**
 * ws-debug.ts — Dev-only WebSocket interceptor for diagnosing Supabase realtime.
 *
 * Uses a Proxy on the WebSocket constructor to intercept every new connection.
 * When Supabase creates its realtime socket, we wrap the resulting instance
 * to log every Phoenix protocol message sent and received.
 *
 * Logs to look for in browser DevTools console:
 *   🔌  = connection open/close events
 *   ▶ SEND = Supabase client → server  (heartbeats, subscribe requests)
 *   ◀ RECV = server → Supabase client  (replies, data events)
 *   💥  = connection error
 *
 * Key Phoenix events to watch:
 *   phx_join          = Supabase subscribing to a table change channel
 *   phx_reply ok      = Server confirmed the subscription
 *   phx_reply error   = Server rejected — check auth/RLS/table name
 *   postgres_changes  = Actual INSERT/UPDATE/DELETE arriving from DB
 *   heartbeat         = Sent every 30s; if no pong within 60s server drops connection
 */

const PREFIX = "[WS-DBG]";

function parseMsg(raw: string): Record<string, unknown> | null {
  try { return JSON.parse(raw); } catch { return null; }
}

function fmtMsg(msg: Record<string, unknown>): string {
  const topic   = msg.topic   ?? "?";
  const event   = msg.event   ?? "?";
  const ref     = msg.ref     ?? "-";
  let payload = JSON.stringify(msg.payload ?? {});
  if (payload.length > 300) payload = payload.slice(0, 300) + "…";
  return `topic=${topic} event=${event} ref=${ref} payload=${payload}`;
}

// Passive-only instrumentation — we only ADD event listeners, never touch send() or
// any other native method. Wrapping send() on a native WebSocket instance can
// corrupt Supabase's internal state, causing the same inconsistency we're debugging.
function instrumentSocket(ws: WebSocket, shortUrl: string): void {
  let openAt: number | null = null;
  let recv = 0;

  ws.addEventListener("open", () => {
    openAt = Date.now();
    console.log(`${PREFIX} 🔌 CONNECTED ${shortUrl}`);
  });

  ws.addEventListener("close", (e: CloseEvent) => {
    const dur   = openAt ? `${((Date.now() - openAt) / 1000).toFixed(1)}s` : "never-opened";
    const clean = e.wasClean ? "clean" : "ABNORMAL";
    console.log(
      `${PREFIX} 🔌 CLOSED code=${e.code} [${clean}] reason="${e.reason || ""}" ` +
      `uptime=${dur} recv=${recv}`
    );
  });

  ws.addEventListener("error", () => {
    console.error(`${PREFIX} 💥 ERROR on ${shortUrl}`);
  });

  ws.addEventListener("message", (e: MessageEvent) => {
    recv++;
    const msg = parseMsg(e.data);
    if (!msg) {
      console.log(`${PREFIX} ◀ [raw] ${String(e.data).slice(0, 200)}`);
      return;
    }
    const event = String(msg.event ?? "");
    // Heartbeat pongs fire every 30s — only log every 5th to keep console readable
    if (event === "phx_reply" && String(msg.topic ?? "").startsWith("phoenix")) {
      if (recv % 5 === 0) console.log(`${PREFIX} ◀ heartbeat-pong #${recv}`);
      return;
    }
    console.log(`${PREFIX} ◀ RECV ${fmtMsg(msg)}`);
  });
}

export function installWsDebugger(): void {
  if (typeof window === "undefined" || !window.WebSocket) return;
  if ((window.WebSocket as any).__ws_debug_installed) return;

  const OrigWS = window.WebSocket;

  // Use a Proxy on the constructor so we intercept the *actual* native WS instance,
  // avoiding the pitfalls of class-extension (static property copying, super() quirks).
  window.WebSocket = new Proxy(OrigWS, {
    construct(Target, args) {
      const ws = new Target(...(args as [string, (string | string[])?]));

      let shortUrl = String(args[0] ?? "");
      try {
        const u = new URL(shortUrl);
        shortUrl = `${u.host}${u.pathname}`;
      } catch {}

      console.log(`${PREFIX} 🔌 OPENING ${shortUrl}`);
      instrumentSocket(ws, shortUrl);
      return ws;
    },
  }) as unknown as typeof WebSocket;

  (window.WebSocket as any).__ws_debug_installed = true;
  console.log(`${PREFIX} Interceptor installed — watching all WebSocket connections`);
}
