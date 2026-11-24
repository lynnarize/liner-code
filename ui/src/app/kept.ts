/*
  A preference kept in window storage, for a window where storage throws (blocked or full): the read falls back to the
  default and validates what it finds, the write fails quietly. The pattern design/Tabs.tsx and Commit.tsx already
  use, as one helper the bare sites can take. `ok` guards the cast: a corrupted value falls back too.
*/
export type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void };
export const keptRead = <T>(s: Store, key: string, fallback: T, ok: (v: unknown) => v is T): T => {
  try {
    const v: unknown = JSON.parse(s.getItem(key) ?? "null");
    return ok(v) ? v : fallback;
  } catch {
    return fallback;
  }
};
export const keptWrite = (s: Store, key: string, v: unknown) => {
  try {
    s.setItem(key, JSON.stringify(v));
  } catch {
    // Full or blocked: the choice lasts until the window closes.
  }
};
/** For the plain-string preferences (lc:sidebar, lc:enter, lc:view): no JSON, just the known words. */
export const wordRead = (s: Store, key: string, words: readonly string[], fallback: string): string => {
  try {
    const v = s.getItem(key);
    return v !== null && words.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
};
export const wordWrite = (s: Store, key: string, v: string) => {
  try {
    s.setItem(key, v);
  } catch {
    // As keptWrite.
  }
};
/** For the plain-string keeps that are not known words (lc:project, lc:device): the string as it was written, no JSON, so a value kept raw stays readable. */
export const textRead = (s: Store, key: string, fallback: string | null): string | null => {
  try {
    return s.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};

/** The drafts whose kept attachments go (draftFiles.ts): all but the `keep` newest, by when each was last saved (one saved before that was kept counts as oldest). */
export function draftsToDrop(entries: readonly { key: string; at?: number }[], keep: number): string[] {
  return [...entries].sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(Math.max(0, keep)).map((e) => e.key);
}
