/**
 * IndexedDB queue for storing images locally before upload
 * Separate from SQLite to efficiently store binary blobs
 */

const DB_NAME = "strata_image_queue";
const DB_VERSION = 1;
const STORE_NAME = "images";

export interface LocalImageQueue {
  id: string; // UUID
  eventKey: string;
  teamNumber: string;
  blob: Blob;
  filename: string;
  timestamp: number;
}

/**
 * Initialize IndexedDB
 */
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error("Failed to open IndexedDB"));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Create object store if it doesn't exist
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const objectStore = db.createObjectStore(STORE_NAME, { keyPath: "id" });

        // Create indexes for querying
        objectStore.createIndex("eventKey", "eventKey", { unique: false });
        objectStore.createIndex("teamNumber", "teamNumber", { unique: false });
        objectStore.createIndex("timestamp", "timestamp", { unique: false });
      }
    };
  });
}

/**
 * Add image to queue
 */
export async function addToImageQueue(
  item: LocalImageQueue,
): Promise<void> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    const request = store.add(item);

    request.onsuccess = () => {
      console.log(`[ImageQueue] Added image: ${item.id}`);
      resolve();
    };

    request.onerror = () => {
      reject(new Error(`Failed to add image to queue: ${item.id}`));
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Get image from queue by ID
 */
export async function getFromImageQueue(
  id: string,
): Promise<LocalImageQueue> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);

    const request = store.get(id);

    request.onsuccess = () => {
      if (!request.result) {
        reject(new Error(`Image not found in queue: ${id}`));
        return;
      }
      resolve(request.result as LocalImageQueue);
    };

    request.onerror = () => {
      reject(new Error(`Failed to get image from queue: ${id}`));
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Remove image from queue
 */
export async function removeFromImageQueue(id: string): Promise<void> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    const request = store.delete(id);

    request.onsuccess = () => {
      console.log(`[ImageQueue] Removed image: ${id}`);
      resolve();
    };

    request.onerror = () => {
      reject(new Error(`Failed to remove image from queue: ${id}`));
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Get all pending images
 */
export async function getAllPendingImages(): Promise<LocalImageQueue[]> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);

    const request = store.getAll();

    request.onsuccess = () => {
      resolve(request.result as LocalImageQueue[]);
    };

    request.onerror = () => {
      reject(new Error("Failed to get all images from queue"));
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Get images for a specific team
 */
export async function getTeamImages(
  eventKey: string,
  teamNumber: string,
): Promise<LocalImageQueue[]> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);

    const results: LocalImageQueue[] = [];
    const cursorRequest = store.openCursor();

    cursorRequest.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;

      if (cursor) {
        const item = cursor.value as LocalImageQueue;
        if (item.eventKey === eventKey && item.teamNumber === teamNumber) {
          results.push(item);
        }
        cursor.continue();
      } else {
        resolve(results);
      }
    };

    cursorRequest.onerror = () => {
      reject(new Error("Failed to query team images"));
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Clear all images from queue (for cleanup)
 */
export async function clearImageQueue(): Promise<void> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    const request = store.clear();

    request.onsuccess = () => {
      console.log("[ImageQueue] Cleared all images");
      resolve();
    };

    request.onerror = () => {
      reject(new Error("Failed to clear image queue"));
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Get queue statistics
 */
export async function getQueueStats(): Promise<{
  count: number;
  totalSize: number;
}> {
  const images = await getAllPendingImages();

  return {
    count: images.length,
    totalSize: images.reduce((sum, img) => sum + img.blob.size, 0),
  };
}
