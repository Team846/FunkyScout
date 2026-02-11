/**
 * Platform detection utilities
 * Centralized to avoid inconsistencies across codebase
 */

/**
 * Check if running in Tauri desktop app
 * Tauri v2 uses window.__TAURI_INTERNALS__ (not window.__TAURI__)
 */
export function isTauri(): boolean {
  if (typeof window === "undefined") return false;
  // Tauri v2 detection - check for __TAURI_INTERNALS__ or __TAURI__
  return "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
}

/**
 * Check if mobile web (not Tauri, not desktop browser)
 */
export function isMobileWeb(): boolean {
  if (typeof window === "undefined") return false;
  if (isTauri()) return false;

  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
}

/**
 * Desktop browser (not Tauri, not mobile)
 */
export function isDesktopBrowser(): boolean {
  return typeof window !== "undefined" && !isTauri() && !isMobileWeb();
}
