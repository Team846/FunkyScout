/**
 * TauriWebSocketWrapper
 *
 * In Tauri production builds (tauri build), the WebView is served from
 * tauri://localhost. WKWebView blocks outgoing wss:// WebSocket connections
 * from this custom scheme origin — the same issue documented in TauriYouTubeEmbed.tsx.
 *
 * Fix: route WebSocket connections through the Rust layer via tauri-plugin-websocket.
 * Rust's network stack has no origin restriction, so wss:// to Supabase works fine.
 * This wrapper implements the native WebSocket interface so it can be passed as
 * `realtime.transport` to the Supabase createClient options.
 */
import TauriWS from "@tauri-apps/plugin-websocket";

type MessageHandler = (event: MessageEvent) => void;
type EventHandler = (event: Event) => void;
type CloseHandler = (event: CloseEvent) => void;

export class TauriWebSocketWrapper {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  readyState = 0; // CONNECTING

  // Standard WebSocket interface properties Supabase's RealtimeClient may inspect
  url: string;
  protocol: string = "";
  extensions: string = "";
  bufferedAmount: number = 0;
  binaryType: BinaryType = "blob";

  onopen: EventHandler | null = null;
  onmessage: MessageHandler | null = null;
  onclose: CloseHandler | null = null;
  onerror: EventHandler | null = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private ws: any = null;
  private sendQueue: string[] = [];
  private listeners = new Map<string, Set<Function>>();

  constructor(url: string, _protocols?: string | string[]) {
    this.url = url;

    TauriWS.connect(url)
      .then((ws) => {
        this.ws = ws;
        this.readyState = 1; // OPEN

        // Drain sends that arrived before the connection was ready
        for (const msg of this.sendQueue) {
          ws.send({ type: "Text", data: msg }).catch(console.error);
        }
        this.sendQueue = [];

        ws.addListener((msg: any) => {
          if (msg.type === "Text") {
            const evt = new MessageEvent("message", { data: msg.data });
            this.onmessage?.(evt);
            this.listeners.get("message")?.forEach((fn) => fn(evt));
          } else if (msg.type === "Close") {
            // Guard: if close() was already called client-side, don't double-fire onclose
            if (this.readyState === 3) return;
            this.readyState = 3; // CLOSED
            const evt = new CloseEvent("close", {
              code: msg.data?.code ?? 1000,
              reason: msg.data?.reason ?? "",
              wasClean: true,
            });
            this.onclose?.(evt);
            this.listeners.get("close")?.forEach((fn) => fn(evt));
          }
        });

        const openEvt = new Event("open");
        this.onopen?.(openEvt);
        this.listeners.get("open")?.forEach((fn) => fn(openEvt));
      })
      .catch((err) => {
        console.error("[TauriWS] Connection failed:", err);
        this.readyState = 3;
        const errEvt = new Event("error");
        this.onerror?.(errEvt);
        this.listeners.get("error")?.forEach((fn) => fn(errEvt));
      });
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    const text = typeof data === "string" ? data : String(data);
    if (this.readyState === 1 && this.ws) {
      this.ws.send({ type: "Text", data: text }).catch(console.error);
    } else if (this.readyState === 0) {
      // Queue until connection opens
      this.sendQueue.push(text);
    }
    // readyState 2 (CLOSING) or 3 (CLOSED): silently drop (matches native WS behavior)
  }

  close(_code?: number, _reason?: string): void {
    if (this.readyState === 3) return;
    this.readyState = 2; // CLOSING

    // Always fire onclose after disconnect, whether the server acknowledges or not.
    // Supabase's Phoenix client waits for onclose to finalize cleanup before reconnecting.
    // Without this, the socket hangs in CLOSING state if the server doesn't send a close frame.
    const fireClose = () => {
      if (this.readyState === 3) return; // Already fired by server-side Close message
      this.readyState = 3;
      const evt = new CloseEvent("close", { code: 1000, reason: "", wasClean: true });
      this.onclose?.(evt);
      this.listeners.get("close")?.forEach((fn) => fn(evt));
    };

    if (this.ws) {
      this.ws.disconnect().catch(console.error).finally(fireClose);
    } else {
      fireClose();
    }
  }

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject
  ): void {
    const fn =
      typeof listener === "function"
        ? listener
        : listener.handleEvent.bind(listener);
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject
  ): void {
    const fn =
      typeof listener === "function"
        ? listener
        : listener.handleEvent.bind(listener);
    this.listeners.get(type)?.delete(fn);
  }

  dispatchEvent(_event: Event): boolean {
    return true;
  }
}
