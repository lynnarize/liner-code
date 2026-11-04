/*
  A panel's bridge, the engine's half. A panel runs in a sealed frame in the window and asks for
  everything through window.liner (contracts/src/panel.ts); the window passes each request here
  with which panel asked, from which session, and the engine answers only what that panel's
  access allows. The window checks too, but this is where it holds: whatever the frame claims,
  its access is read from the manifest kept here (or the draft its install card is showing).

  `refusal` is the whole rule, apart from the calls, so the tests can hold it to its word.
*/
import { existsSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { Item, PanelAccess, PanelPlace, Thread } from "../../contracts/src/index.ts";
import { PANEL_API } from "../../contracts/src/index.ts";
import { listFiles } from "./files.ts";
import { readFile } from "./surfaces.ts";

/** The colours a panel is checked in: the app's light theme, as the frame's variables. */
export const CHECK_THEME = { "--bg": "#f9f9fb", "--surface": "#ffffff", "--well": "#f4f4f5", "--plate": "#ececee", "--ink": "#1f2024", "--ink-2": "#46484f", "--ink-3": "#6b6e76", "--ink-4": "#8b8e95", "--hair": "rgba(31, 32, 36, 0.08)", "--line": "rgba(30, 33, 45, 0.11)", "--accent": "#3a6df0", "--act": "oklch(0.6 0.215 27)", "--act-ink": "#ffffff", "--ok": "oklch(0.6 0.15 152)", "--warn": "oklch(0.7 0.15 65)", "--danger": "oklch(0.6 0.21 25)", "--font": "'Instrument Sans Variable', 'Instrument Sans', system-ui, sans-serif", "--font-display": "'Instrument Sans Variable', 'Instrument Sans', system-ui, sans-serif", "--font-mono": "'Geist Mono', ui-monospace, monospace" };

/** Every call a frame can make (apiVersion 1), and the access each needs. */
export const PANEL_METHODS = ["context", "files.list", "files.read", "files.search", "session.info", "session.commands", "sessions.list", "composer.put", "storage.get", "storage.set", "storage.remove", "storage.keys", "ai.ask", "ai.model", "ai.pick"] as const;
export type PanelMethod = (typeof PANEL_METHODS)[number];

/** Where a call comes from: the panel's access, its place, and the session it's beside (none on a page). */
export type PanelWhere = { access: PanelAccess; place: PanelPlace; threadId?: string };

/**
  Why a panel may not make this call, in words it can show, or null when it may. Unknown calls and
  another bridge version are refused like anything not in its access.
*/
export function refusal(w: PanelWhere, method: string, apiVersion: number = PANEL_API): string | null {
  if (apiVersion !== PANEL_API) return `This is Liner Code's panel bridge, version ${PANEL_API}; the panel spoke version ${apiVersion}.`;
  if (!(PANEL_METHODS as readonly string[]).includes(method)) return `There's no ${method} in the panel bridge.`;
  const a = w.access;
  const needSession = () => (w.threadId ? null : "There's no session here: it's a page of its own.");
  switch (method as PanelMethod) {
    case "context":
      return null;
    case "files.list":
    case "files.read":
    case "files.search":
      return a.files === "project" ? needSession() : "It didn't ask to read the project's files (access.files).";
    case "session.info":
    case "session.commands":
      return a.sessions === "this" || a.sessions === "all" ? needSession() : "It didn't ask to read the session (access.sessions).";
    case "sessions.list":
      return a.sessions === "all" ? null : 'It didn\'t ask to read every session (access.sessions "all").';
    case "composer.put":
      return a.composer ? needSession() : "It didn't ask to put text in the composer (access.composer).";
    case "storage.get":
    case "storage.set":
    case "storage.remove":
    case "storage.keys":
      return a.storage ? null : "It didn't ask for storage of its own (access.storage).";
    case "ai.ask":
    case "ai.model":
    case "ai.pick":
      return a.ai ? null : "It didn't ask to use a model (access.ai).";
  }
}

/** The most an app may send a model at once, in characters: its prompt, and its own instructions. */
export const AI_PROMPT_MAX = 100_000;
export const AI_SYSTEM_MAX = 20_000;

/** A path a panel may read: inside the folder, nothing hidden (.env, .git, .liner), no link out of it. */
export function readable(root: string, path: unknown): string {
  if (typeof path !== "string" || !path.trim() || path.length > 1000) throw new Error("Say which file, by its path in the project.");
  const abs = resolve(root, path);
  const rel = relative(root, abs);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("That file is outside the project.");
  if (rel.split(sep).some((p) => p.startsWith("."))) throw new Error("Hidden files and folders (.env, .git) aren't a panel's to read.");
  if (existsSync(abs)) {
    const real = relative(realpathSync(root), realpathSync(abs));
    if (real.startsWith("..") || isAbsolute(real)) throw new Error("That file is a link to outside the project.");
    // Where it really is counts too: notes.txt -> .env is .env. Counted from the project, so a folder above it (~/.work) doesn't.
    if (real.split(sep).some((p) => p.startsWith("."))) throw new Error("That file is a link to a hidden one (.env, .git), which isn't a panel's to read.");
  }
  return rel.split(sep).join("/");
}

/** What the engine lends the bridge: the session's folder and timeline, every session, and the panel's storage. */
export type PanelEnv = {
  cwdOf(threadId: string): string;
  thread(threadId: string): Thread;
  threads(): Thread[];
  timeline(threadId: string): Item[];
  projectName(projectId: string): string;
  branchOf(threadId: string): string | undefined;
  storage: { all(): Record<string, unknown>; put(key: string, value: unknown): void };
  /**
    The model an app asked for (access.ai), as just a model: the one picked for it (its name, or
    null before one is), and its answer. `call` names the answer's pieces as they come (onText).
  */
  ai?: {
    model(): { name: string } | null;
    pick(): { name: string } | null;
    ask(o: { prompt: string; system?: string; call?: string }): Promise<{ text: string; model: string }>;
  };
};

const hidden = (p: string) => p.split("/").some((x) => x.startsWith("."));
const words = (v: unknown) => (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 200).slice(0, 12);

/** A session's open changes: files changed in turns not yet committed or undone, with their lines. */
function changesOf(items: Item[]) {
  const open = items.filter((x): x is Extract<Item, { kind: "checkpoint" }> => x.kind === "checkpoint" && !x.reverted && !x.committed);
  const by = new Map<string, { path: string; added: number; removed: number }>();
  for (const c of open)
    for (const f of c.files) {
      const was = by.get(f.path) ?? { path: f.path, added: 0, removed: 0 };
      by.set(f.path, { path: f.path, added: was.added + f.added, removed: was.removed + f.removed });
    }
  return [...by.values()];
}

/** Runs a call the panel may make (check `refusal` first). Its answer goes back to the frame as it is. */
export async function panelCall(env: PanelEnv, w: PanelWhere, method: PanelMethod, args: Record<string, unknown>): Promise<unknown> {
  const root = () => env.cwdOf(w.threadId!);
  switch (method) {
    case "context":
      return { apiVersion: PANEL_API, place: w.place, access: w.access };
    case "files.list": {
      const dir = typeof args.dir === "string" && args.dir.trim() ? readable(root(), args.dir).replace(/\/$/, "") : "";
      const all = (await listFiles(root(), 20000)).filter((p) => !hidden(p));
      return (dir ? all.filter((p) => p.startsWith(`${dir}/`)) : all).slice(0, 5000);
    }
    case "files.read": {
      const path = readable(root(), args.path);
      const f = readFile(root(), path);
      if (f.binary) return { path, size: f.size, text: "", binary: true };
      return { path, size: f.size, text: f.text.length > 1_000_000 ? f.text.slice(0, 1_000_000) : f.text };
    }
    case "files.search": {
      // Plain words, never patterns: nothing a panel writes runs here, a regular expression included.
      const find = words(args.pattern ?? args.words ?? args.text);
      if (!find.length) throw new Error("Say what to look for: a word, or a list of them.");
      const fold = Boolean(args.ignoreCase);
      const needles = fold ? find.map((x) => x.toLowerCase()) : find;
      const limit = Math.max(1, Math.min(500, Number(args.limit) || 200));
      const out: { path: string; line: number; text: string }[] = [];
      let read = 0;
      for (const p of await listFiles(root(), 20000)) {
        if (out.length >= limit || read > 20_000_000) break;
        // What files.read would refuse (hidden, or a link to one or out), search skips.
        try {
          readable(root(), p);
        } catch {
          continue;
        }
        let size = 0;
        try {
          size = statSync(resolve(root(), p)).size;
        } catch {
          continue;
        }
        if (size > 512_000) continue;
        read += size;
        let f;
        try {
          f = readFile(root(), p);
        } catch {
          continue;
        }
        if (f.binary) continue;
        const lines = f.text.split("\n");
        for (let i = 0; i < lines.length && out.length < limit; i++) {
          const l = fold ? lines[i].toLowerCase() : lines[i];
          if (needles.some((x) => l.includes(x))) out.push({ path: p, line: i + 1, text: lines[i].trim().slice(0, 300) });
        }
      }
      return out;
    }
    case "session.info": {
      const t = env.thread(w.threadId!);
      return { id: t.id, title: t.title, status: t.status, turns: t.turns, project: env.projectName(t.projectId), branch: env.branchOf(t.id) ?? null, updatedAt: t.updatedAt, changes: changesOf(env.timeline(t.id)) };
    }
    case "session.commands":
      return env
        .timeline(w.threadId!)
        .filter((x): x is Extract<Item, { kind: "tool" }> => x.kind === "tool" && x.toolKind === "exec")
        .slice(-50)
        .map((x) => ({ title: x.title, command: x.input?.slice(0, 2000) ?? "", status: x.status, output: (x.output ?? "").slice(-4000), seconds: x.seconds ?? null, at: x.at, turn: x.turn }));
    case "sessions.list":
      return env
        .threads()
        .filter((t) => !t.archived)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 200)
        .map((t) => {
          const ch = changesOf(env.timeline(t.id));
          return { id: t.id, title: t.title, project: env.projectName(t.projectId), status: t.status, updatedAt: t.updatedAt, files: ch.length, added: ch.reduce((n, f) => n + f.added, 0), removed: ch.reduce((n, f) => n + f.removed, 0) };
        });
    case "composer.put": {
      const text = typeof args.text === "string" ? args.text : "";
      if (!text.trim()) throw new Error("Say what to put in the composer.");
      if (text.length > 20000) throw new Error("That's more than the composer takes from a panel (20,000 characters).");
      // The window puts it there, for the person to send or not.
      return { text };
    }
    case "storage.keys":
      return Object.keys(env.storage.all());
    case "storage.get": {
      const key = keyOf(args.key);
      return env.storage.all()[key] ?? null;
    }
    case "storage.set": {
      const key = keyOf(args.key);
      if (args.value === undefined) throw new Error("Say what to keep, as value (null to clear it).");
      env.storage.put(key, args.value);
      return true;
    }
    case "storage.remove":
      env.storage.put(keyOf(args.key), undefined);
      return true;
    case "ai.model":
      return need(env).model();
    case "ai.pick":
      return need(env).pick();
    case "ai.ask": {
      const prompt = typeof args.prompt === "string" ? args.prompt : "";
      if (!prompt.trim()) throw new Error("Say what to ask the model: liner.ai.ask(prompt).");
      if (prompt.length > AI_PROMPT_MAX) throw new Error(`That's more than an app may send a model at once (${AI_PROMPT_MAX.toLocaleString("en")} characters).`);
      if (args.system !== undefined && args.system !== null && typeof args.system !== "string") throw new Error("system is the model's instructions, as a string.");
      const system = typeof args.system === "string" && args.system.trim() ? args.system : undefined;
      if (system && system.length > AI_SYSTEM_MAX) throw new Error(`Its instructions are longer than an app may give (${AI_SYSTEM_MAX.toLocaleString("en")} characters).`);
      return need(env).ask({ prompt, system, call: args.stream && typeof args.call === "string" ? args.call : undefined });
    }
  }
}

const need = (env: PanelEnv) => {
  if (!env.ai) throw new Error("There's no model to ask here.");
  return env.ai;
};

const keyOf = (k: unknown) => {
  if (typeof k !== "string" || !k || k.length > 200) throw new Error("A storage key is a string of up to 200 characters.");
  return k;
};
