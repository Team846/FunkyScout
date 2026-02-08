/**
 * Supabase Storage utilities for team image uploads
 */

import supabase from "@lib/supabase/supabase";

/**
 * Upload a single team image to Supabase Storage
 *
 * @param eventKey - Event code (e.g., "2025cada")
 * @param teamNumber - Team number as string (e.g., "frc846" or "846")
 * @param imageBlob - Compressed image blob to upload
 * @param filename - Original filename for reference
 * @returns Storage path (e.g., "2025cada/team-frc846/abc123.png")
 */
export async function uploadTeamImage(
  eventKey: string,
  teamNumber: string,
  imageBlob: Blob,
  filename: string,
): Promise<string> {
  // Ensure team number has "frc" prefix
  const teamKey = teamNumber.startsWith("frc")
    ? teamNumber
    : `frc${teamNumber}`;

  // Generate unique ID for this image
  const uuid = crypto.randomUUID();

  // Extract file extension (default to png)
  const ext = filename.split(".").pop() || "png";

  // Construct storage path: {event}/team-{teamKey}/{uuid}.{ext}
  const storagePath = `${eventKey}/team-${teamKey}/${uuid}.${ext}`;

  console.log(`[Storage] Uploading image to: ${storagePath}`);

  // Upload to Supabase Storage
  const { data, error } = await supabase.storage
    .from("team-images")
    .upload(storagePath, imageBlob, {
      contentType: "image/png",
      upsert: false, // Don't overwrite existing files
    });

  if (error) {
    console.error(`[Storage] Upload failed:`, error);
    throw error;
  }

  console.log(`[Storage] Upload successful:`, data.path);
  return storagePath;
}

/**
 * Get public URL for a stored image
 *
 * @param path - Storage path (e.g., "2025cada/team-frc846/abc123.png")
 * @returns Public URL to access the image
 */
export function getImageUrl(path: string): string {
  const { data } = supabase.storage.from("team-images").getPublicUrl(path);

  return data.publicUrl;
}

/**
 * Delete a team image from storage
 *
 * @param path - Storage path to delete
 */
export async function deleteTeamImage(path: string): Promise<void> {
  const { error } = await supabase.storage.from("team-images").remove([path]);

  if (error) {
    console.error(`[Storage] Delete failed:`, error);
    throw error;
  }

  console.log(`[Storage] Deleted: ${path}`);
}

/**
 * List all images for a team
 *
 * @param eventKey - Event code
 * @param teamNumber - Team number (with or without "frc" prefix)
 * @returns Array of storage paths
 */
export async function listTeamImages(
  eventKey: string,
  teamNumber: string,
): Promise<string[]> {
  const teamKey = teamNumber.startsWith("frc")
    ? teamNumber
    : `frc${teamNumber}`;

  const prefix = `${eventKey}/team-${teamKey}/`;

  const { data, error } = await supabase.storage
    .from("team-images")
    .list(prefix);

  if (error) {
    console.error(`[Storage] List failed:`, error);
    throw error;
  }

  return (data || []).map((file) => `${prefix}${file.name}`);
}
