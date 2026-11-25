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

/**
  The icon a command's row carries in the "/" list, as Antigravity's list has one on each row: Liner Code's own by what
  they do, the tools' common ones by their names, and the slash for any other (a command a tool or you added).
  Names of icons in icons.tsx `I`.
*/
const COMMAND_ICONS: Record<string, string> = {
  goal: "target", teamwork: "agents", swarm: "fanout", reviewer: "eye", pr: "pr",
  compact: "shrink", init: "notes", review: "verified", "security-review": "shield", plan: "list", model: "cube", clear: "undo",
  help: "info", status: "info", cost: "usage", usage: "usage", memory: "notes", config: "settings", settings: "settings",
  mcp: "plug", agents: "agents", resume: "carry", login: "lock", logout: "lock", permissions: "lock", approvals: "lock",
  doctor: "flask", bug: "alert", feedback: "comment", hooks: "flow", "add-dir": "folderPlus", export: "download",
  keybindings: "keyboard", vim: "keyboard", "terminal-setup": "terminal", ide: "code", "pr-comments": "comment",
  browser: "globe", schedule: "calendar", loop: "rotate", fork: "fork", rename: "edit", diff: "changes", mention: "file",
  new: "compose", quit: "close", exit: "close", skills: "notes", context: "layers", rewind: "back", undo: "undo",
};
export const commandIconOf = (name: string) => COMMAND_ICONS[name.toLowerCase()] ?? "slash";
