import { fetchTBAData } from "./fetch";

export interface MatchVideo {
  type: string;
  key: string;
}

export interface MatchWithVideos {
  key: string;
  videos: MatchVideo[];
}

export interface EventVideoData {
  data: MatchWithVideos[];
}

/** YouTube video IDs are 11 chars: alphanumeric, hyphen, underscore */
const YOUTUBE_ID_REGEX = /^[a-zA-Z0-9_-]{10,12}$/;

function sanitizeYoutubeKey(key: unknown): string | null {
  if (typeof key !== "string") return null;
  const trimmed = key.trim();
  return YOUTUBE_ID_REGEX.test(trimmed) ? trimmed : null;
}

/**
 * Fetch event matches with videos from TBA.
 * Returns only YouTube videos (embeddable, in-app) with sanitized keys.
 * Filters out non-youtube types and invalid keys to prevent XSS/external links.
 */
export async function fetchEventVideo(
  event_key: string
): Promise<EventVideoData | false> {
  if (!event_key || typeof event_key !== "string") return false;

  const raw = await fetchTBAData(`/event/${event_key}/matches`, "GET");
  if (!raw) return false;

  if (!Array.isArray(raw)) return false;

  const data: MatchWithVideos[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const key = typeof m.key === "string" ? m.key.trim() : null;
    if (!key) continue;

    const rawVideos = Array.isArray(m.videos) ? m.videos : [];
    const videos: MatchVideo[] = [];
    for (const v of rawVideos) {
      if (!v || typeof v !== "object") continue;
      if (typeof v.type !== "string" || v.type.toLowerCase() !== "youtube") continue;
      const sanitized = sanitizeYoutubeKey(v.key);
      if (sanitized) videos.push({ type: "youtube", key: sanitized });
    }
    data.push({ key, videos });
  }

  return { data };
}