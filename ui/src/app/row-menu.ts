/*
  What a session's row menu in the sidebar offers that depends on the session (board RowMenu, SPEC rule 9,
  2026-11-25): Stop it while it works, Mark unread or read, and the group it is in as Group's value. Apart from
  Sidebar.tsx, with no React and no alias imports, so plain Node can test it (engine/test/row-menu.test.ts).
*/
import type { Thread } from "../../../contracts/src/index.ts";

/**
  Whether the menu (and ⌘K, App.tsx) offers Stop it: while a turn of the session runs, as the message box's own Stop
  shows (Session.tsx passes the box `busy` as status "running"), and while that turn waits on you for an approval or an
  answer (status "waiting"), when Stop still ends the turn. Not for a Reviewer that held the work back (held "review"):
  its turn has ended, so there is nothing to stop. Never for an archived one.
*/
export const stopShows = (t: Pick<Thread, "status" | "archived" | "held">) => !t.archived && (t.status === "running" || (t.status === "waiting" && t.held !== "review"));

/** Mark unread puts a session back in Needs you as a finished turn you haven't seen does; marked so, the row offers the way back. */
export const unreadRow = (t: Pick<Thread, "unread">) => (t.unread ? { title: "Mark read", unread: false } : { title: "Mark unread", unread: true });

/** Group's value at the row's end: the name of the group it is in, or nothing when it is in none (or one since deleted). */
export const groupValue = (t: Pick<Thread, "group">, groups: { id: string; name: string }[]) => (t.group ? groups.find((g) => g.id === t.group)?.name : undefined);

/**
  The sessions you marked unread by hand (the row menu, ⌘K) since they last opened. The one on screen is read while you
  look at it (unread.ts), which undid Mark unread at once: marked so, it stays unread until you leave it, and is read
  again the next time it opens.
*/
const markedUnread = new Set<string>();
/** Marks a session unread by hand, or read. */
export function markUnread(id: string, unread: boolean) {
  if (unread) markedUnread.add(id);
  else markedUnread.delete(id);
}
/** Whether a session on screen in a focused window reads as read now: unread, and not marked so by hand while it was open. */
export const clearsUnread = (id: string, unread: boolean | undefined, focused: boolean) => Boolean(unread) && focused && !markedUnread.has(id);
/** A session opened, or left: a mark made by hand before is let go, so opening it reads it. */
export function shownAfresh(id: string) {
  markedUnread.delete(id);
}
