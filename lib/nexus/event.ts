import { fetchNexusData } from "./fetch";

export interface NexusEvent {
  eventKey: string;
  dataAsOfTime: number;
  nowQueuing: string;
  matches: NexusMatch[];
  announcements: NexusAnnouncement[];
  partsRequests: NexusPartRequest[];
}

export interface NexusMatch {
  label: string;
  status: "On field" | "On deck" | "Now queuing" | "Queuing soon";
  redTeams: string[];
  blueTeams: string[];
  times: {
    estimatedQueueTime: number;
    estimatedOnDeckTime: number;
    estimatedOnFieldTime: number;
    estimatedStartTime: number;
    actualQueueTime: number;
    actualOnDeckTime: number;
    actualOnFieldTime: number;
  };
}

export interface NexusAnnouncement {
  id: string;
  announcement: string;
  postedTime: number;
}

export interface NexusPartRequest {
  id: string;
  parts: string;
  postedTime: number;
  requestedByTeam: string;
}

/**
 * Get live event status from FRC Nexus
 * Includes matches, announcements, and parts requests
 */
export async function getNexusEventStatus(
  event: string
): Promise<NexusEvent | false> {
  const eventData = await fetchNexusData(`/event/${event}`, "GET");
  return eventData || false;
}

/**
 * Convert a Nexus match label to a TBA-style match key suffix.
 * "Qualification 24" → "qm24"
 * "Playoff 3"        → "sf1m3"
 * "Final 2"          → "f1m2"
 *
 * Only for identifying/timing a match — never for team composition.
 */
export function nexusLabelToMatchKey(label: string): string {
  const lower = label.toLowerCase();
  const qualMatch = lower.match(/qualification\s*(\d+)/);
  if (qualMatch) return `qm${qualMatch[1]}`;
  const playoffMatch = lower.match(/playoff\s*(\d+)/);
  if (playoffMatch) return `sf1m${playoffMatch[1]}`;
  const finalMatch = lower.match(/final\s*(\d+)/);
  if (finalMatch) return `f1m${finalMatch[1]}`;
  return lower.replace(/\s+/g, "");
}

/**
 * Build a map of match key → est_time (seconds) from Nexus match data.
 * Only timing — never use this to determine teams.
 */
export function buildNexusTimeMap(
  nexusMatches: NexusMatch[],
  event: string
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const m of nexusMatches) {
    if (m.times.estimatedStartTime > 0) {
      const suffix = nexusLabelToMatchKey(m.label);
      if (suffix) {
        map[`${event}_${suffix}`] = Math.floor(m.times.estimatedStartTime / 1000);
      }
    }
  }
  return map;
}
