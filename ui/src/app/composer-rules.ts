/*
  Rules of the message box (Composer.tsx) that decide between two boxes on one screen: a session's own and its side
  chat's (SideChat.tsx). No React here, so plain Node can test them (engine/test/reviewed-faults.test.ts).
*/

/** Where the focus is as a box sees it: in its own box, in another message box, or in neither. */
export type BoxFocus = "mine" | "other" | "none";

/**
  Whether this box answers ⌘⇧Enter (send the first queued message now). Every box on the screen hears the key, so only
  one may: the box that holds the focus, else, with the focus in no box, the session's own one, never a side chat's.
*/
export const steersHere = (focus: BoxFocus, aside: boolean) => focus === "mine" || (focus === "none" && !aside);

/** Where ⌘S keeps a box's drafts: the project's own list for its sessions, and one apart for its side chats, so neither brings back the other's. */
export const stashKeyOf = (projectId: string, aside: boolean) => (aside ? `lc:stash-side:${projectId}` : `lc:stash:${projectId}`);
