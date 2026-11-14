import { Adjustments } from './adjustments';

/**
 * Edit history is persisted in IndexedDB, one record per image path.
 *
 * The history lives with the application profile instead of inside the
 * .rrdata sidecar: sidecars stay small and portable, while the history
 * survives application restarts, image switches, undo/redo and crashes.
 */

export interface HistoryTimeline {
  history: Adjustments[];
  labels: string[];
  times: number[];
  index: number;
}

export interface ImageSnapshot {
  id: string;
  name: string;
  time: number;
  adjustments: Adjustments;
  historyIndex?: number;
}

interface StoredStep {
  adjustments: Adjustments;
  label: string;
  time: number;
}

interface StoredHistory {
  path: string;
  updatedAt: number;
  index: number;
  steps: StoredStep[];
  version: number;
}

interface StoredSnapshots {
  path: string;
  updatedAt: number;
  snapshots: ImageSnapshot[];
}

const DB_NAME = 'rapidraw-edit-history';
const DB_VERSION = 2;
const STORE = 'timelines';
const SNAPSHOTS_STORE = 'snapshots';
const UPDATED_AT_INDEX = 'updatedAt';
const RECORD_VERSION = 1;

/** Keep at most this many images on disk; oldest are pruned first. */
const MAX_RECORDS = 500;
/** Drop timelines that have not been touched for a year. */
const MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
/** Prune at most once per this many writes. */
const PRUNE_INTERVAL = 25;

let dbPromise: Promise<IDBDatabase | null> | null = null;
let writeQueue: Promise<void> = Promise.resolve();
let writesSincePrune = 0;
let pruneScheduled = false;

const canUseIndexedDb = () => typeof indexedDB !== 'undefined';

function openDatabase(): Promise<IDBDatabase | null> {
  if (!canUseIndexedDb()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      console.warn('Edit history storage is unavailable:', err);
      resolve(null);
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'path' });
        store.createIndex(UPDATED_AT_INDEX, 'updatedAt');
      }
      if (!db.objectStoreNames.contains(SNAPSHOTS_STORE)) {
        const store = db.createObjectStore(SNAPSHOTS_STORE, { keyPath: 'path' });
        store.createIndex(UPDATED_AT_INDEX, 'updatedAt');
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => {
      console.warn('Could not open edit history storage:', request.error);
      resolve(null);
    };
  });

  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const enqueue = (task: () => Promise<void>) => {
  writeQueue = writeQueue.then(task).catch((err) => {
    console.warn('Failed to persist edit history:', err);
  });
  return writeQueue;
};

const toStoredRecord = (path: string, timeline: HistoryTimeline): StoredHistory => ({
  path,
  updatedAt: Date.now(),
  index: Math.max(0, Math.min(timeline.index, timeline.history.length - 1)),
  steps: timeline.history.map((adjustments, i) => ({
    adjustments,
    label: timeline.labels[i] ?? '',
    time: timeline.times[i] ?? Date.now(),
  })),
  version: RECORD_VERSION,
});

const putRecord = async (db: IDBDatabase, record: StoredHistory) => {
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put(record);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
};

/**
 * Saves (or replaces) the timeline for one image. Writes are serialized so
 * a slow write can never overwrite a newer one. If the browser quota is
 * exceeded the oldest steps are dropped and the write is retried.
 */
export function saveImageHistory(path: string, timeline: HistoryTimeline): Promise<void> {
  if (!path || timeline.history.length === 0) return Promise.resolve();

  return enqueue(async () => {
    const db = await openDatabase();
    if (!db) return;

    let record = toStoredRecord(path, timeline);
    try {
      await putRecord(db, record);
    } catch (err) {
      const name = (err as DOMException | undefined)?.name;
      if (name !== 'QuotaExceededError') throw err;

      // Keep the newest steps only and try again.
      for (const keep of [10, 1]) {
        if (record.steps.length <= keep) continue;
        const dropped = record.steps.length - keep;
        record = {
          ...record,
          steps: record.steps.slice(dropped),
          index: Math.max(0, record.index - dropped),
        };
        try {
          await putRecord(db, record);
          break;
        } catch (retryErr) {
          if ((retryErr as DOMException | undefined)?.name !== 'QuotaExceededError') throw retryErr;
        }
      }
    }

    writesSincePrune += 1;
    if (writesSincePrune >= PRUNE_INTERVAL && !pruneScheduled) {
      pruneScheduled = true;
      writesSincePrune = 0;
      void pruneImageHistory().finally(() => {
        pruneScheduled = false;
      });
    }
  });
}

/** Loads the saved timeline for an image, or null when none exists. */
export async function loadImageHistory(path: string): Promise<HistoryTimeline | null> {
  if (!path) return null;
  const db = await openDatabase();
  if (!db) return null;

  try {
    const tx = db.transaction(STORE, 'readonly');
    const record = (await requestToPromise(tx.objectStore(STORE).get(path))) as StoredHistory | undefined;
    if (!record || !Array.isArray(record.steps) || record.steps.length === 0) return null;

    return {
      history: record.steps.map((step) => step.adjustments),
      labels: record.steps.map((step) => step.label ?? ''),
      times: record.steps.map((step) => step.time ?? record.updatedAt),
      index: Math.max(0, Math.min(record.index, record.steps.length - 1)),
    };
  } catch (err) {
    console.warn('Failed to load edit history:', err);
    return null;
  }
}

/** Deletes the saved timelines for the given image paths. */
export function deleteImageHistories(paths: string[]): Promise<void> {
  if (paths.length === 0) return Promise.resolve();
  return enqueue(async () => {
    const db = await openDatabase();
    if (!db) return;
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    paths.forEach((path) => store.delete(path));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  });
}

/** Moves a timeline when an image is renamed or moved inside the app. */
export function moveImageHistory(oldPath: string, newPath: string): Promise<void> {
  if (!oldPath || !newPath || oldPath === newPath) return Promise.resolve();
  return enqueue(async () => {
    const db = await openDatabase();
    if (!db) return;
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const record = (await requestToPromise(store.get(oldPath))) as StoredHistory | undefined;
    if (record) {
      store.put({ ...record, path: newPath, updatedAt: Date.now() });
      store.delete(oldPath);
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  });
}

/** Loads the named snapshots saved for an image. */
export async function loadImageSnapshots(path: string): Promise<ImageSnapshot[]> {
  if (!path) return [];
  const db = await openDatabase();
  if (!db) return [];

  try {
    const tx = db.transaction(SNAPSHOTS_STORE, 'readonly');
    const record = (await requestToPromise(tx.objectStore(SNAPSHOTS_STORE).get(path))) as StoredSnapshots | undefined;
    return Array.isArray(record?.snapshots) ? record.snapshots : [];
  } catch (err) {
    console.warn('Failed to load image snapshots:', err);
    return [];
  }
}

/** Replaces all named snapshots for one image. */
export function saveImageSnapshots(path: string, snapshots: ImageSnapshot[]): Promise<void> {
  if (!path) return Promise.resolve();
  return enqueue(async () => {
    const db = await openDatabase();
    if (!db) return;
    const tx = db.transaction(SNAPSHOTS_STORE, 'readwrite');
    const store = tx.objectStore(SNAPSHOTS_STORE);
    if (snapshots.length === 0) {
      store.delete(path);
    } else {
      const record: StoredSnapshots = { path, updatedAt: Date.now(), snapshots };
      store.put(record);
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  });
}

/** Deletes named snapshots for the given image paths. */
export function deleteImageSnapshots(paths: string[]): Promise<void> {
  if (paths.length === 0) return Promise.resolve();
  return enqueue(async () => {
    const db = await openDatabase();
    if (!db) return;
    const tx = db.transaction(SNAPSHOTS_STORE, 'readwrite');
    const store = tx.objectStore(SNAPSHOTS_STORE);
    paths.forEach((path) => store.delete(path));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  });
}

/** Moves named snapshots when an image is renamed or moved. */
export function moveImageSnapshots(oldPath: string, newPath: string): Promise<void> {
  if (!oldPath || !newPath || oldPath === newPath) return Promise.resolve();
  return enqueue(async () => {
    const db = await openDatabase();
    if (!db) return;
    const tx = db.transaction(SNAPSHOTS_STORE, 'readwrite');
    const store = tx.objectStore(SNAPSHOTS_STORE);
    const record = (await requestToPromise(store.get(oldPath))) as StoredSnapshots | undefined;
    if (record) {
      store.put({ ...record, path: newPath, updatedAt: Date.now() });
      store.delete(oldPath);
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  });
}

/**
 * Removes expired timelines and, when there are too many, the ones that
 * have not been used for the longest time.
 */
export async function pruneImageHistory(): Promise<void> {
  const db = await openDatabase();
  if (!db) return;

  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const index = store.index(UPDATED_AT_INDEX);
    const expiredBefore = Date.now() - MAX_AGE_MS;
    let seen = 0;

    // Walk from newest to oldest: the first MAX_RECORDS are kept, the rest
    // (and anything older than MAX_AGE_MS) are removed.
    await new Promise<void>((resolve, reject) => {
      const cursorRequest = index.openCursor(null, 'prev');
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) {
          resolve();
          return;
        }
        seen += 1;
        const record = cursor.value as StoredHistory;
        if (record.updatedAt < expiredBefore || seen > MAX_RECORDS) {
          cursor.delete();
        }
        cursor.continue();
      };
      cursorRequest.onerror = () => reject(cursorRequest.error);
    });

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('Failed to prune edit history:', err);
  }
}
