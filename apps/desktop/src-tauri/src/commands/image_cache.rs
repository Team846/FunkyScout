use base64::{engine::general_purpose::STANDARD, Engine};
use tauri::{AppHandle, Manager};

fn cache_dir(app_handle: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e: tauri::Error| e.to_string())?
        .join("image-cache");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create image cache dir: {e}"))?;
    Ok(dir)
}

/// Sanitize a Supabase storage path into a flat filename.
/// e.g. "2025cada/team-frc846/abc123.webp" → "2025cada_team-frc846_abc123.webp"
fn safe_filename(path: &str) -> String {
    path.replace('/', "_")
}

/// Store an image in the persistent disk cache.
/// `data` is base64-encoded image bytes from the frontend.
#[tauri::command]
pub async fn cache_image(
    app_handle: AppHandle,
    path: String,
    data: String,
) -> Result<(), String> {
    let dir = cache_dir(&app_handle)?;
    let filename = safe_filename(&path);
    let file_path = dir.join(&filename);

    let bytes = STANDARD
        .decode(&data)
        .map_err(|e| format!("Failed to decode base64: {e}"))?;

    std::fs::write(&file_path, &bytes)
        .map_err(|e| format!("Failed to write image cache file: {e}"))?;

    Ok(())
}

/// Retrieve a cached image from disk.
/// Returns `Some(base64)` if cached, `None` if not found.
#[tauri::command]
pub async fn get_cached_image(
    app_handle: AppHandle,
    path: String,
) -> Result<Option<String>, String> {
    let dir = cache_dir(&app_handle)?;
    let filename = safe_filename(&path);
    let file_path = dir.join(&filename);

    if !file_path.exists() {
        return Ok(None);
    }

    let bytes = std::fs::read(&file_path)
        .map_err(|e| format!("Failed to read image cache file: {e}"))?;

    Ok(Some(STANDARD.encode(&bytes)))
}
