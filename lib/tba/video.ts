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

export async function fetchEventVideo(
  event_key: string
): Promise<EventVideoData | false> {
  const matchData = await fetchTBAData(`/event/${event_key}/matches`, "GET");

  if (!matchData) return false;

  return { data: matchData };
}