/**
 * Scouter Exclusion System
 *
 * Provides two types of exclusions:
 * 1. Temporary (UI-only): Filter data in calculations without database changes
 * 2. Permanent (Supabase-pushed): Soft-delete via deleted_at timestamp
 *
 * Use cases:
 * - Temporary: Experiment with data quality by excluding suspect submissions
 * - Permanent: Definitively remove bad data after verification
 *
 * DATABASE SCHEMA NOTE:
 * - deleted_at uses PostgreSQL timestamptz in Supabase
 * - Local SQLite uses numeric epoch milliseconds for deleted_at
 * - Existing putMatchData handles conversion correctly
 * - See DATABASE_ARCHITECTURE.md for timestamp handling patterns
 */

import type { EventMatchData } from "@lib/db";
import { deleteMatchData, putMatchData } from "@lib/data/writes";

/**
 * Exclusion filter for temporary (UI-only) filtering
 *
 * Does not modify database - only filters data in calculations
 */
export interface ExclusionFilter {
  excludedUids: Set<string>; // Users to exclude completely
  excludedSubmissions: Set<string>; // Specific submissions by ID (event:match:team:timestamp)
}

/**
 * Create temporary exclusion filter (UI-only, no database changes)
 *
 * @param excludedUids - Array of user UIDs to exclude
 * @param excludedSubmissionIds - Array of submission IDs (format: "event:match:team:timestamp")
 * @returns Filter object to pass to applyExclusionFilter
 *
 * @example
 * ```typescript
 * const filter = createExclusionFilter(
 *   ["bad-scouter-uid"],
 *   ["2026caav:qm1:frc846:1234567890"]
 * );
 * const filtered = applyExclusionFilter(allMatchData, filter);
 * const stats = calculateTeamStats("frc846", filtered);
 * ```
 */
export function createExclusionFilter(
  excludedUids: string[] = [],
  excludedSubmissionIds: string[] = []
): ExclusionFilter {
  return {
    excludedUids: new Set(excludedUids),
    excludedSubmissions: new Set(excludedSubmissionIds),
  };
}

/**
 * Apply temporary exclusion filter to match data
 *
 * Returns filtered array without modifying database
 *
 * @param matchData - Array of event match data
 * @param filter - Exclusion filter created by createExclusionFilter
 * @returns Filtered array (already deleted items + excluded items removed)
 */
export function applyExclusionFilter(
  matchData: EventMatchData[],
  filter: ExclusionFilter
): EventMatchData[] {
  return matchData.filter((m) => {
    // Skip if already deleted in database
    if (m.deleted_at) return false;

    // Skip if user is excluded
    if (m.uid && filter.excludedUids.has(m.uid)) return false;

    // Skip if specific submission is excluded
    // Generate submission ID from event:match:team:timestamp
    const submissionId = `${m.event}:${m.match}:${m.team}:${m.timestamp}`;
    if (filter.excludedSubmissions.has(submissionId)) return false;

    return true;
  });
}

/**
 * Permanently exclude all submissions from a scouter
 *
 * Sets deleted_at on all their submissions for this event
 * This WRITES to database and syncs to Supabase
 *
 * @param uid - User ID to exclude
 * @param eventKey - Event key (e.g., "2026caav")
 * @param matchData - Array of all event match data
 *
 * @example
 * ```typescript
 * await permanentlyExcludeScouter("bad-scouter-uid", "2026caav", allMatchData);
 * ```
 */
export async function permanentlyExcludeScouter(
  uid: string,
  eventKey: string,
  matchData: EventMatchData[]
): Promise<void> {
  // Find all submissions from this scouter that aren't already deleted
  const scouterSubmissions = matchData.filter(
    (m) => m.uid === uid && !m.deleted_at && m.event === eventKey
  );

  if (scouterSubmissions.length === 0) {
    console.log(
      `[ScouterExclusions] No active submissions found for uid ${uid} at event ${eventKey}`
    );
    return;
  }

  console.log(
    `[ScouterExclusions] Permanently excluding ${scouterSubmissions.length} submissions from uid ${uid}`
  );

  // Soft-delete each submission using deleteMatchData
  const deletePromises = scouterSubmissions.map((submission) =>
    deleteMatchData(
      submission.event,
      submission.match,
      submission.team,
      submission.uid!
    )
  );

  await Promise.all(deletePromises);

  console.log(
    `[ScouterExclusions] Successfully excluded ${scouterSubmissions.length} submissions from uid ${uid}`
  );
}

/**
 * Permanently exclude a specific submission
 *
 * Sets deleted_at on one submission
 * This WRITES to database and syncs to Supabase
 *
 * @param eventKey - Event key
 * @param submission - The specific submission to exclude
 *
 * @example
 * ```typescript
 * await permanentlyExcludeSubmission("2026caav", badSubmission);
 * ```
 */
export async function permanentlyExcludeSubmission(
  eventKey: string,
  submission: EventMatchData
): Promise<void> {
  if (submission.deleted_at) {
    console.log(
      `[ScouterExclusions] Submission already deleted: ${submission.match} ${submission.team}`
    );
    return;
  }

  console.log(
    `[ScouterExclusions] Permanently excluding submission: ${submission.match} ${submission.team} by ${submission.name}`
  );

  await deleteMatchData(
    eventKey,
    submission.match,
    submission.team,
    submission.uid!
  );

  console.log(
    `[ScouterExclusions] Successfully excluded submission: ${submission.match} ${submission.team}`
  );
}

/**
 * Restore excluded scouter (clear deleted_at)
 *
 * Undeletes all submissions from a scouter for this event
 *
 * @param uid - User ID to restore
 * @param eventKey - Event key
 * @param matchData - Array of all event match data (including deleted)
 *
 * @example
 * ```typescript
 * await restoreScouter("scouter-uid", "2026caav", allMatchData);
 * ```
 */
export async function restoreScouter(
  uid: string,
  eventKey: string,
  matchData: EventMatchData[]
): Promise<void> {
  // Find all deleted submissions from this scouter
  const scouterSubmissions = matchData.filter(
    (m) => m.uid === uid && m.deleted_at && m.event === eventKey
  );

  if (scouterSubmissions.length === 0) {
    console.log(
      `[ScouterExclusions] No deleted submissions found for uid ${uid} at event ${eventKey}`
    );
    return;
  }

  console.log(
    `[ScouterExclusions] Restoring ${scouterSubmissions.length} submissions for uid ${uid}`
  );

  // Restore each submission using putMatchData (queues PUT_MATCH_DATA for sync)
  const restorePromises = scouterSubmissions.map((submission) => {
    if (!submission.alliance) {
      console.warn(
        `[ScouterExclusions] Skipping submission without alliance: ${submission.match} ${submission.team}`
      );
      return Promise.resolve();
    }

    return putMatchData(
      submission.event,
      submission.match,
      submission.team,
      submission.data_raw,
      submission.uid!,
      submission.alliance,
      { name: submission.name || undefined }
    );
  });

  await Promise.all(restorePromises);

  console.log(
    `[ScouterExclusions] Successfully restored ${scouterSubmissions.length} submissions for uid ${uid}`
  );
}

/**
 * Restore a specific excluded submission
 *
 * Clears deleted_at on one submission
 *
 * @param eventKey - Event key
 * @param submission - The specific submission to restore
 */
export async function restoreSubmission(
  eventKey: string,
  submission: EventMatchData
): Promise<void> {
  if (!submission.deleted_at) {
    console.log(
      `[ScouterExclusions] Submission not deleted: ${submission.match} ${submission.team}`
    );
    return;
  }

  console.log(
    `[ScouterExclusions] Restoring submission: ${submission.match} ${submission.team} by ${submission.name}`
  );

  // Restore using putMatchData (queues PUT_MATCH_DATA for sync)
  if (!submission.alliance) {
    throw new Error(
      `Cannot restore submission without alliance: ${submission.match} ${submission.team}`
    );
  }

  await putMatchData(
    eventKey,
    submission.match,
    submission.team,
    submission.data_raw,
    submission.uid!,
    submission.alliance,
    { name: submission.name || undefined }
  );

  console.log(
    `[ScouterExclusions] Successfully restored submission: ${submission.match} ${submission.team}`
  );
}
