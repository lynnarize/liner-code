/*
  Opening a file at a line, from elsewhere in the app (Files.tsx says how). Here rather than in
  Files.tsx, so the session can hand a link over without bringing the Files surface into the start:
  it loads with the panel.

  Each session's own, so a link opens in the Files of the session it's in and not in every one on
  screen (Open beside shows two). T3 Code opens a link the same way, in its thread's panel:
  ChatMarkdown.tsx's onOpenFile, rightPanelStore.ts's openFile(threadRef, path).
*/
export type Reveal = { threadId: string; path: string; line?: number; at: number };
let waiting: Reveal | null = null;
export const takers = new Map<(r: Reveal) => void, string>();
/** A link's file for a session's Files (Session.tsx decides which session's): false when it names none. */
export function revealFile(threadId: string, d: { path?: unknown; line?: unknown } | undefined) {
  if (!d || typeof d.path !== "string" || !d.path.trim()) return false;
  const line = typeof d.line === "number" && d.line > 0 ? Math.floor(d.line) : typeof d.line === "string" && /^\d+$/.test(d.line) ? Number(d.line) : undefined;
  const r: Reveal = { threadId, path: d.path.trim(), line, at: Date.now() };
  // On screen, it's taken now; else it waits for the Files surface the session is bringing up.
  const here = [...takers].filter(([, id]) => id === threadId);
  if (here.length) for (const [f] of here) f(r);
  else waiting = r;
  return true;
}
export function takeWaiting(threadId: string) {
  const r = waiting;
  if (!r || r.threadId !== threadId) return null;
  waiting = null;
  return Date.now() - r.at < 10_000 ? r : null;
}
