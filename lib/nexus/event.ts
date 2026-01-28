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
