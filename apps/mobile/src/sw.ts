/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

declare const self: ServiceWorkerGlobalScope;

cleanupOutdatedCaches();

// Inject the precache manifest (JS, CSS, SVG bundles from vite.config.ts globPatterns).
// @ts-expect-error __WB_MANIFEST is injected by vite-plugin-pwa at build time
precacheAndRoute(self.__WB_MANIFEST);

/**
 * Add COOP/COEP headers to a response.
 *
 * These headers are normally set by Vercel, but when HTML is served from the
 * service worker cache (offline or PWA home-screen launch) the Vercel headers
 * are absent. Re-injecting them here satisfies the browser's crossOriginIsolated
 * requirement so SharedArrayBuffer — and therefore SQLite WASM / OPFS — works
 * when the app launches offline.
 */
function withCrossOriginHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const NAV_CACHE = "nav-html-v1";

// Navigation handler: network-first, offline-capable.
// All SPA routes share the same index.html, so we cache it once at the origin
// root and reuse it for every navigation request.
registerRoute(
  new NavigationRoute(async ({ request }) => {
    const cache = await caches.open(NAV_CACHE);
    const rootKey = self.location.origin + "/";

    try {
      const fresh = await fetch(request);
      // Always update the cached copy with the latest HTML from the network
      cache.put(rootKey, fresh.clone());
      return withCrossOriginHeaders(fresh);
    } catch {
      // Offline: return the last successfully cached HTML with COOP/COEP headers
      const cached = await cache.match(rootKey);
      if (cached) return withCrossOriginHeaders(cached);
      throw new Error("offline: no cached HTML available");
    }
  })
);
