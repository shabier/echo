import type { Story, StoryListItem } from "./types";

const DB_NAME = "fable";
const DB_VERSION = 1;
const STORE_STORIES = "stories";
const STORE_AUDIO = "audio";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_STORIES)) {
        const stories = db.createObjectStore(STORE_STORIES, { keyPath: "id" });
        stories.createIndex("updatedAt", "updatedAt");
      }
      if (!db.objectStoreNames.contains(STORE_AUDIO)) {
        db.createObjectStore(STORE_AUDIO, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(
  storeNames: string | string[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(storeNames, mode);
        let result: T;
        Promise.resolve(fn(t))
          .then((r) => {
            result = r;
          })
          .catch(reject);
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function newId(): string {
  return (
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 10)
  );
}

export async function saveStory(story: Story): Promise<void> {
  await tx(STORE_STORIES, "readwrite", (t) => {
    t.objectStore(STORE_STORIES).put(story);
  });
}

export async function getStory(id: string): Promise<Story | undefined> {
  return tx(STORE_STORIES, "readonly", (t) =>
    reqAsPromise(t.objectStore(STORE_STORIES).get(id) as IDBRequest<Story | undefined>),
  );
}

export async function listStories(): Promise<StoryListItem[]> {
  const stories = await tx(STORE_STORIES, "readonly", (t) =>
    reqAsPromise(t.objectStore(STORE_STORIES).getAll() as IDBRequest<Story[]>),
  );
  return stories
    .map((s) => {
      const last = s.beats[s.beats.length - 1];
      const preview = last?.text?.slice(0, 140) ?? "";
      return {
        id: s.id,
        seedId: s.seedId,
        beatCount: s.beats.length,
        preview,
        updatedAt: s.updatedAt,
      };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteStory(id: string): Promise<void> {
  const story = await getStory(id);
  await tx([STORE_STORIES, STORE_AUDIO], "readwrite", (t) => {
    t.objectStore(STORE_STORIES).delete(id);
    if (story) {
      const audioStore = t.objectStore(STORE_AUDIO);
      for (const beat of story.beats) {
        if (beat.audioBlobId) audioStore.delete(beat.audioBlobId);
      }
    }
  });
}

export async function putAudio(id: string, blob: Blob): Promise<void> {
  await tx(STORE_AUDIO, "readwrite", (t) => {
    t.objectStore(STORE_AUDIO).put({ id, blob });
  });
}

export async function getAudio(id: string): Promise<Blob | undefined> {
  const row = await tx(STORE_AUDIO, "readonly", (t) =>
    reqAsPromise(
      t.objectStore(STORE_AUDIO).get(id) as IDBRequest<{ id: string; blob: Blob } | undefined>,
    ),
  );
  return row?.blob;
}
