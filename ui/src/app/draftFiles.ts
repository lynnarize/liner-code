/*
  A draft's attachments kept across a reload, in IndexedDB (a File can't go in localStorage). One connection for the
  window, and only the newest drafts' files are kept, as the drafts themselves are (Composer, MAX_DRAFTS): a draft's
  files go when it's sent, and a draft left with files long ago lets them go once newer ones push it out.
*/
import { draftsToDrop } from "./kept";

type Saved = { name: string; type: string; lastModified: number; blob: Blob };
type Kept = { at: number; files: Saved[] };

const DB = "lc-draft-files-v1";
const STORE = "files";

let opened: Promise<IDBDatabase | null> | null = null;
/** The window's one connection, opened at the first use; a closed or blocked one is opened again at the next. */
function db(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  opened ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => {
        const d = req.result;
        d.onclose = () => (opened = null);
        d.onversionchange = () => (d.close(), (opened = null));
        resolve(d);
      };
      req.onerror = () => ((opened = null), resolve(null));
    } catch {
      opened = null;
      resolve(null);
    }
  });
  return opened;
}

/** Keeps `files` as the draft `key`'s (none: its entry goes), then lets go of all but the `keep` newest drafts' files. */
export async function saveDraftFiles(key: string, files: File[], keep: number) {
  const d = await db();
  if (!d) return;
  try {
    const store = d.transaction(STORE, "readwrite").objectStore(STORE);
    if (files.length) store.put({ at: Date.now(), files: files.map((f) => ({ name: f.name, type: f.type, lastModified: f.lastModified, blob: f })) } satisfies Kept, key);
    else store.delete(key);
    // Read in the same transaction, so the draft just saved counts as the newest.
    const seen: { key: string; at?: number }[] = [];
    const walk = store.openCursor();
    walk.onsuccess = () => {
      const c = walk.result;
      if (c) {
        seen.push({ key: String(c.key), at: (c.value as Partial<Kept> | undefined)?.at });
        c.continue();
      } else for (const k of draftsToDrop(seen, keep)) store.delete(k);
    };
  } catch {
    // IndexedDB unavailable or full: the files last while the window is open
  }
}

/** The draft `key`'s kept files, or none. */
export async function loadDraftFiles(key: string): Promise<File[]> {
  const d = await db();
  if (!d) return [];
  return new Promise((resolve) => {
    try {
      const req = d.transaction(STORE, "readonly").objectStore(STORE).get(key);
      req.onsuccess = () => {
        // Kept before drafts had a time: a bare list of files.
        const raw = req.result as Kept | Saved[] | undefined;
        const list = Array.isArray(raw) ? raw : raw?.files;
        resolve(Array.isArray(list) ? list.map((r) => new File([r.blob], r.name, { type: r.type, lastModified: r.lastModified })) : []);
      };
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}
