import { fetchStatboticsTeamEPA } from "./team";
import type { StatboticsTeamEPAs } from "./team";
import { handleError } from "../../utils/errorHandler";

export type ProgressCallback = (
  fetched: number,
  total: number,
  errors: number
) => void;

/**
 * Fetch EPA data for all teams at an event.
 * No caching - just fetches fresh data.
 */
export async function fetchEventTeamEPAs(
  event: string,
  teamKeys: string[],
  onProgress?: ProgressCallback
): Promise<Record<string, StatboticsTeamEPAs>> {
  console.log("Fetch team EPAs: Started");

  if (!teamKeys || teamKeys.length === 0) {
    console.warn("Fetch team EPAs: No teams provided");
    throw new Error("No teams provided");
  }

  const teamEPAs: Record<string, StatboticsTeamEPAs> = {};
  let fetchedCount = 0;
  let errorCount = 0;

  const fetchPromises = teamKeys.map(async (teamKey) => {
    try {
      // Extract team number from key (e.g., "frc254" -> "254")
      const teamNumber = teamKey.startsWith("frc")
        ? teamKey.substring(3)
        : teamKey;

      const teamData = await fetchStatboticsTeamEPA(teamNumber, event);

      if (teamData) {
        teamEPAs[teamKey] = teamData;
      } else {
        errorCount++;
      }
    } catch (error) {
      console.error(`Failed to fetch data for team ${teamKey}:`, error);
      errorCount++;
    } finally {
      fetchedCount++;
      if (onProgress) {
        onProgress(fetchedCount, teamKeys.length, errorCount);
      }
    }
  });

  try {
    await Promise.all(fetchPromises);
  } catch (error) {
    handleError(error);
  }

  console.log(`Fetch team EPAs: Done (${Object.keys(teamEPAs).length} teams)`);
  return teamEPAs;
}
