/**
 * Image compression utilities using Canvas API
 */

/**
 * Compress an image file to reduce file size
 *
 * @param file - Original image file
 * @param options - Compression options
 * @returns Compressed image blob
 */
export async function compressImage(
  file: File,
  options?: {
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;
  },
): Promise<Blob> {
  const {
    maxWidth = 1920,
    maxHeight = 1920,
    quality = 0.8,
  } = options || {};

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      const img = new Image();

      img.onload = () => {
        try {
          // Calculate new dimensions while maintaining aspect ratio
          let { width, height } = img;

          if (width > maxWidth || height > maxHeight) {
            const aspectRatio = width / height;

            if (width > height) {
              width = maxWidth;
              height = Math.round(width / aspectRatio);
            } else {
              height = maxHeight;
              width = Math.round(height * aspectRatio);
            }
          }

          // Create canvas and draw resized image
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("Failed to get canvas context"));
            return;
          }

          // Use high-quality image smoothing
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";

          ctx.drawImage(img, 0, 0, width, height);

          // Convert to blob with specified quality
          canvas.toBlob(
            (blob) => {
              if (!blob) {
                reject(new Error("Failed to create blob"));
                return;
              }

              console.log(
                `[ImageCompression] Original: ${(file.size / 1024).toFixed(1)}KB, Compressed: ${(blob.size / 1024).toFixed(1)}KB`,
              );

              resolve(blob);
            },
            "image/png",
            quality,
          );
        } catch (error) {
          reject(error);
        }
      };

      img.onerror = () => {
        reject(new Error("Failed to load image"));
      };

      img.src = e.target?.result as string;
    };

    reader.onerror = () => {
      reject(new Error("Failed to read file"));
    };

    reader.readAsDataURL(file);
  });
}

/**
 * Batch compress multiple images
 *
 * @param files - Array of image files
 * @param options - Compression options
 * @returns Array of compressed blobs
 */
export async function compressImages(
  files: File[],
  options?: {
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;
  },
): Promise<Blob[]> {
  console.log(`[ImageCompression] Compressing ${files.length} images...`);

  const compressed = await Promise.all(
    files.map((file) => compressImage(file, options)),
  );

  const totalOriginal = files.reduce((sum, f) => sum + f.size, 0);
  const totalCompressed = compressed.reduce((sum, b) => sum + b.size, 0);

  console.log(
    `[ImageCompression] Total: ${(totalOriginal / 1024).toFixed(1)}KB → ${(totalCompressed / 1024).toFixed(1)}KB (${((1 - totalCompressed / totalOriginal) * 100).toFixed(1)}% reduction)`,
  );

  return compressed;
}

/**
 * Check if file size exceeds a threshold
 *
 * @param file - File to check
 * @param maxSizeMB - Maximum size in megabytes
 * @returns True if file is too large
 */
export function isFileTooLarge(file: File, maxSizeMB: number = 10): boolean {
  return file.size > maxSizeMB * 1024 * 1024;
}

/**
 * Get human-readable file size
 *
 * @param bytes - File size in bytes
 * @returns Formatted string (e.g., "1.5 MB")
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
