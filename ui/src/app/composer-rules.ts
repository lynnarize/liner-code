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
  How a box asks the engine for its "/" and "$" lists, and the key the answer is kept under. The engine answers per thread
  (a side chat or a scan has no /teamwork or /swarm), and a session's box and its side chat are up at once on one tool, so
  the key holds the thread and the side; a side chat says it takes no team, since before its first turn it has no thread.
*/
export const commandsAsk = (projectId: string, agent: string, threadId: string | undefined, aside: boolean) => ({
  key: `${projectId}|${agent}|${threadId ?? ""}|${aside ? "side" : ""}`,
  ask: aside ? { projectId, agent, threadId, team: false } : { projectId, agent, threadId },
});

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

/**
  Whether a session's tool takes /compact. Every tool does now: the engine runs the tool's own compact where it has one and
  compacts in Liner Code where it has none (runtime.ts COMPACT). Only the Demo is left out, which is handed the words as
  they are and would answer them as a message.
*/
export const compactsOn = (provider: string) => provider.split(".")[0] !== "demo";

/**
  The Compact button beside "N% of context" under a session's box: there once the context holds something on a tool that
  compacts, and not pressable while a turn runs or a press of it is still on its way (DetailsParts.tsx useCompact), since a
  second /compact would sum up what was just summed up.
*/
export const compactButton = (o: { provider: string; contextTokens?: number; running: boolean; compacting: boolean }) => ({
  shown: compactsOn(o.provider) && (o.contextTokens ?? 0) > 0,
  disabled: o.running || o.compacting,
});

/** A long thread past its cache: the next message is read again at full price, so the box offers to compact. */
export const COLD_TOKENS = 200_000;
/**
  Whether the box offers "Compact now" because the cache has run out on a long thread: past the cache's end, a thread over
  COLD_TOKENS, on any tool that compacts, and not once you dismissed it for this cache.
*/
export const coldCompact = (o: { provider: string; cacheUntil?: number; seen?: number; now: number; contextTokens?: number }) =>
  compactsOn(o.provider) && o.cacheUntil !== undefined && o.seen !== o.cacheUntil && o.now > o.cacheUntil && (o.contextTokens ?? 0) > COLD_TOKENS;
