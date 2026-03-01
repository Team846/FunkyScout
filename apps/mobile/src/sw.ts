/// <reference lib="webworker" />
import {
  precacheAndRoute,
  cleanupOutdatedCaches,
  matchPrecache,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

declare const self: ServiceWorkerGlobalScope;

cleanupOutdatedCaches();

// Inject the precache manifest (JS, CSS, SVG, HTML bundles from vite.config.ts).
// index.html is included so offline launches work on the very first install,
// without requiring a prior online visit.
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
      // Always update the runtime cache with the latest HTML from the network
      cache.put(rootKey, fresh.clone());
      return withCrossOriginHeaders(fresh);
    } catch {
      // Offline fallback — try in order:
      // 1. Runtime cache (populated on previous online visits)
      const runtimeCached = await cache.match(rootKey);
      if (runtimeCached) return withCrossOriginHeaders(runtimeCached);

      // 2. Workbox precache (index.html pre-cached on SW install — works on
      //    very first offline launch before any online visit has occurred)
      const precached = await matchPrecache("/index.html");
      if (precached) return withCrossOriginHeaders(precached);

      // No HTML available at all — surface a clear error
      throw new Error("offline: no cached HTML available");
    }
  })
);
