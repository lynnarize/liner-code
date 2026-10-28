/*
  Every shortcut in one place: what it does, its keys, and where it works. Your own come from
  Settings → Keyboard, written the way VS Code writes keybindings.json: an entry gives a command
  its keys in place of the defaults ({ "key": "mod+shift+n", "command": "new" }), "-new" takes
  its keys away, and `when` narrows where it works ("session", "composer", "!textInput",
  joined with &&). "mod" is ⌘ on a Mac and Ctrl elsewhere.

  Each part of the app asks `pressed(e)` (or `is(e, id)`) instead of reading keys itself, and
  the Mac app's menu takes the same keys, so a menu item and its shortcut never disagree.
*/
import type { KeyBinding } from "@contracts";

export type Command = { id: string; label: string; group: string; keys: string[]; when?: string };

const SURFACE_KEYS: [string, string, string][] = [
  ["browser", "Browser", "b"],
  ["terminal", "Terminal", "t"],
  ["files", "Files", "f"],
  ["changes", "Diff", "d"],
  ["pr", "Pull request", "p"],
  ["linked", "Linked pull requests", "l"],
  ["device", "Device", "m"],
  ["routines", "Routines", "r"],
  ["agents", "Agents", "a"],
];

export const COMMANDS: Command[] = [
  { id: "new", label: "New session", group: "Anywhere", keys: ["mod+n"] },
  { id: "commands", label: "Command menu: sessions, projects, everything", group: "Anywhere", keys: ["mod+k"] },
  { id: "settings", label: "Settings", group: "Anywhere", keys: ["mod+,"] },
  { id: "sidebar", label: "Show or hide the sidebar", group: "Anywhere", keys: ["mod+\\"] },
  { id: "usage", label: "Usage and cost", group: "Anywhere", keys: ["mod+shift+u"] },
  { id: "open-project", label: "Add a project", group: "Anywhere", keys: ["mod+o"] },
  { id: "find", label: "Find in the session, or in the diff", group: "In a session", keys: ["mod+f"], when: "session || review" },
  ...SURFACE_KEYS.map(([id, label, k]) => ({ id: `surface.${id}`, label: `Open ${label}`, group: "In a session", keys: [`mod+shift+${k}`], when: "session" })),
  { id: "stash", label: "Put the draft aside, or bring it back", group: "Writing a message", keys: ["mod+s"], when: "composer" },
];

/** Keys that are the app's behaviour rather than commands: shown, not changed. */
export const FIXED: { group: string; label: string; keys: string[] }[] = [
  { group: "Writing a message", label: "Send, or queue it while the agent works", keys: ["Enter"] },
  { group: "Writing a message", label: "Steer the running turn", keys: ["⌘", "Enter"] },
  { group: "Writing a message", label: "A new line", keys: ["⇧", "Enter"] },
  { group: "Writing a message", label: "Your last messages", keys: ["↑", "↓"] },
  { group: "Writing a message", label: "Point at a file, a command, a skill", keys: ["@", "/", "$"] },
  { group: "In the sessions list", label: "Move between sessions", keys: ["↑", "↓"] },
  { group: "In the sessions list", label: "Pin, snooze, mark done", keys: ["P", "S", "D"] },
  { group: "In the sessions list", label: "Rename", keys: ["F2"] },
  { group: "In Settings", label: "Back to sessions", keys: ["Esc"] },
];

const mac = typeof navigator === "undefined" || /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
let mine: KeyBinding[] = [];
const listeners = new Set<() => void>();

/** Your bindings, from the engine's settings. */
export function setBindings(list: KeyBinding[] | undefined) {
  mine = Array.isArray(list) ? list : [];
  for (const f of listeners) f();
}
export const onBindings = (f: () => void) => (listeners.add(f), () => void listeners.delete(f));

/** The keys a command answers to now, with where. */
export function bindingsOf(id: string): { key: string; when?: string }[] {
  const cmd = COMMANDS.find((c) => c.id === id);
  if (mine.some((b) => b.command === `-${id}`)) return mine.filter((b) => b.command === id).map((b) => ({ key: b.key, when: b.when ?? cmd?.when }));
  const own = mine.filter((b) => b.command === id);
  if (own.length) return own.map((b) => ({ key: b.key, when: b.when ?? cmd?.when }));
  return (cmd?.keys ?? []).map((key) => ({ key, when: cmd?.when }));
}

type Chord = { mod: boolean; ctrl: boolean; alt: boolean; shift: boolean; key: string };
const NAMES: Record<string, string> = { comma: ",", backslash: "\\", slash: "/", period: ".", space: " ", esc: "escape", return: "enter", plus: "+" };

export function parse(spec: string): Chord | null {
  const parts = spec.toLowerCase().replace(/\s+/g, "").split("+");
  // "mod++" is mod and the plus key.
  if (spec.endsWith("++")) parts.splice(parts.length - 2, 2, "+");
  const c: Chord = { mod: false, ctrl: false, alt: false, shift: false, key: "" };
  for (const p of parts) {
    if (p === "mod") c.mod = true;
    else if (p === "cmd" || p === "meta" || p === "⌘") mac ? (c.mod = true) : (c.ctrl = true);
    else if (p === "ctrl" || p === "control") mac ? (c.ctrl = true) : (c.mod = true);
    else if (p === "alt" || p === "option" || p === "opt") c.alt = true;
    else if (p === "shift") c.shift = true;
    else if (p) c.key = NAMES[p] ?? p;
  }
  return c.key ? c : null;
}

/** The key a press made, as a spec: what recording a shortcut writes down. */
export function specOf(e: KeyboardEvent): string | null {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  if (["meta", "control", "shift", "alt", "os"].includes(key)) return null;
  const parts = [mac ? e.metaKey && "mod" : e.ctrlKey && "mod", mac && e.ctrlKey && "ctrl", e.altKey && "alt", e.shiftKey && "shift"].filter(Boolean) as string[];
  const named = Object.entries(NAMES).find(([, v]) => v === key)?.[0];
  const base = e.code.startsWith("Key") ? e.code.slice(3).toLowerCase() : e.code.startsWith("Digit") ? e.code.slice(5) : named ?? key;
  return [...parts, base].join("+");
}

function same(e: KeyboardEvent, c: Chord) {
  const mod = mac ? e.metaKey : e.ctrlKey;
  if (mod !== c.mod || e.altKey !== c.alt || e.shiftKey !== c.shift || (mac && e.ctrlKey !== c.ctrl)) return false;
  // Letters by their place on the keyboard, so ⌥ and other layouts still match.
  const k = e.code.startsWith("Key") ? e.code.slice(3).toLowerCase() : e.code.startsWith("Digit") ? e.code.slice(5) : e.key.toLowerCase();
  return k === c.key || e.key.toLowerCase() === c.key;
}

/** Where the press happened, for `when`. */
function context(e: KeyboardEvent) {
  const t = e.target instanceof Element ? e.target : null;
  return {
    session: Boolean(document.querySelector(".lc-session")),
    review: Boolean(document.querySelector(".lc-rv")),
    settings: Boolean(document.querySelector(".lc-st-side")),
    composer: Boolean(t?.closest(".lc-composer")),
    textInput: Boolean(t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || (t as HTMLElement).isContentEditable)),
  } as Record<string, boolean>;
}

export function holds(when: string | undefined, e: KeyboardEvent) {
  if (!when?.trim()) return true;
  const ctx = context(e);
  return when.split("||").some((any) =>
    any.split("&&").every((part) => {
      const p = part.trim();
      const not = p.startsWith("!");
      const v = Boolean(ctx[not ? p.slice(1) : p]);
      return not ? !v : v;
    }),
  );
}

/** Is this press these keys ("mod+shift+1"), whatever command they're for? */
export function matches(e: KeyboardEvent, spec: string) {
  const c = parse(spec);
  return c ? same(e, c) : false;
}
/** The command already on these keys, if any: for saying so when you give them to something else. */
export const commandOn = (spec: string) => COMMANDS.find((c) => bindingsOf(c.id).some((b) => b.key === spec));

/** Is this press the command's shortcut, here? */
export function is(e: KeyboardEvent, id: string) {
  return bindingsOf(id).some((b) => {
    const c = parse(b.key);
    return c ? same(e, c) && holds(b.when, e) : false;
  });
}

/** Which command this press is, if any. */
export function pressed(e: KeyboardEvent, among: string[] = COMMANDS.map((c) => c.id)) {
  return among.find((id) => is(e, id));
}

/** "mod+shift+u" → ⌘ ⇧ U, for showing. */
export function glyphs(spec: string): string[] {
  const c = parse(spec);
  if (!c) return [spec];
  const key = c.key === " " ? "Space" : c.key === "enter" ? "Enter" : c.key === "escape" ? "Esc" : c.key.length === 1 ? c.key.toUpperCase() : c.key.charAt(0).toUpperCase() + c.key.slice(1);
  return [c.ctrl && (mac ? "⌃" : "Ctrl"), c.alt && (mac ? "⌥" : "Alt"), c.shift && "⇧", c.mod && (mac ? "⌘" : "Ctrl"), key].filter(Boolean) as string[];
}
export const shortcutOf = (id: string) => {
  const b = bindingsOf(id)[0];
  return b ? glyphs(b.key) : undefined;
};

/** Reads a keybindings JSON (comments and trailing commas allowed), or says what's wrong. */
export function readBindings(text: string): { list?: KeyBinding[]; error?: string } {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1").replace(/,\s*([\]}])/g, "$1").trim();
  if (!clean) return { list: [] };
  let v: unknown;
  try {
    v = JSON.parse(clean);
  } catch (e) {
    return { error: `That isn't JSON yet: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!Array.isArray(v)) return { error: "Write a list: [ { \"key\": \"mod+shift+n\", \"command\": \"new\" } ]" };
  const ids = new Set(COMMANDS.map((c) => c.id));
  for (const [i, b] of v.entries()) {
    const x = b as Partial<KeyBinding>;
    if (!x || typeof x.command !== "string") return { error: `Entry ${i + 1} needs a "command".` };
    if (!ids.has(x.command.replace(/^-/, ""))) return { error: `Entry ${i + 1}: there's no command "${x.command.replace(/^-/, "")}". Every command and its id is listed above.` };
    if (!x.command.startsWith("-") && (typeof x.key !== "string" || !parse(x.key))) return { error: `Entry ${i + 1} needs a "key", like "mod+shift+n".` };
    if (x.when !== undefined && typeof x.when !== "string") return { error: `Entry ${i + 1}: "when" is words, like "session".` };
  }
  return { list: v as KeyBinding[] };
}

/** Commands whose keys the Mac app's menu also holds, with their keys now (empty: none). */
export const MENU_COMMANDS = ["new", "commands", "settings", "sidebar", "usage", "open-project"];
export const menuKeys = () => Object.fromEntries(MENU_COMMANDS.map((id) => [id, bindingsOf(id)[0]?.key ?? ""]));
