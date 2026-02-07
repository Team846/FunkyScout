import supabase from "./supabase";

interface UploadPitImagesParams {
  eventKey: string;
  teamKey: string;
  files: File[];
}

interface UploadResult {
  urls: string[];
  errors: string[];
}

export async function uploadPitImages({
  eventKey,
  teamKey,
  files,
}: UploadPitImagesParams): Promise<UploadResult> {
  const urls: string[] = [];
  const errors: string[] = [];

  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    
    const ext = file.name.split(".").pop() || "png";
    const timestamp = Date.now();
    const path = `${eventKey}/team-${teamKey}/${timestamp}-${index}.${ext}`;

    try {
      const { error } = await supabase.storage
        .from("team-images")
        .upload(path, file, {
          contentType: file.type,
          upsert: false,
        });

      if (error) {
        console.error(`Upload failed for ${file.name}:`, error);
        errors.push(`${file.name}: ${error.message}`);
        continue;
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from("team-images").getPublicUrl(path);

      urls.push(publicUrl);
    } catch (err) {
      console.error(`Unexpected error uploading ${file.name}:`, err);
      errors.push(`${file.name}: Unexpected error`);
    }
  }

  return { urls, errors };
}
