/*
  Liner Design's canvas: the design files of a folder (.liner/designs/<slug>/: design.json, one
  HTML document per frame in frames/, pictures in assets/), their frames, a copy kept per turn to
  scrub back to, and a watcher that says when a frame's file changed (canvas.changed).

  Also the plumbing the four Liner Design modules share (canvas.ts, lean.ts, buildlinks.ts,
  pictures.ts): DesignCtx, what the engine hands each of them, and the shape each exports, rpc(x)
  for api.ts, TOOLS for liner-tools.ts and call(name, args, at) for agent-tools.ts.

  Every element of a frame the editor or an agent may address carries data-l (canvas-html.ts
  stamps the missing ones, touching nothing else in the file). An agent draws by writing a frame's
  file with its own tools or through design_frame and design_node; the engine tells its own writes
  from the agent's by what it wrote last, and the runtime's tool rows say which frame an agent is
  writing now (canvas.presence), the lead's and the sidekick's alike.

  Versions: when a turn ends having changed a design file, the whole design folder is copied to
  ~/.liner-code/designs/<thread>/canvas/<file>/t<turn>/ (with t<turn>.json beside it), under the
  session's own designs folder, so a fork copies them and deleting the session takes them away.
*/
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { cpSync, createReadStream, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { cp, lstat, readdir } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { DesignSize, EngineEvent, Item, RpcMethod, RpcParams, RpcResult } from "../../contracts/src/index.ts";
import { DESIGN_UNREADABLE, FRAME_CHANGED, FRAME_SIZES, type CanvasVersion, type FrameOp, type FramePlaced, type DesignFile, type DesignFileInfo, type DesignFrame, type DesignPatch, type DesignPresence, type DesignSelection, type DesignSkill, type FrameBuild, type NewFrame } from "../../contracts/src/design.ts";
import type { AddonHost, McpResult } from "./agent-tools.ts";
import { applyOps, attr, byId, elements, outer, outline, parse, replaceNode, stamp, type Outline } from "./canvas-html.ts";
import { keepOutOfGit, slugOf, type Designs } from "./designs.ts";
import { AS_SIDEKICK } from "./sidekick.ts";
import { picturesPref, setPicturesPref } from "./design-prefs.ts";
import type { Store } from "./store.ts";

export { TOOLS } from "./canvas-tools.ts";
export { stamp, outline, replaceNode } from "./canvas-html.ts";

/** The frame agent's script on disk, for the proxy to put in a live frame (the app imports it with ?raw). */
export const FRAME_AGENT = fileURLToPath(new URL("../../contracts/src/frame-agent.js", import.meta.url));

/** A picture of a page the app drew out of sight (AgentTools' `shot`): a PNG in base64, its console errors and full height. */
export type Shot = { png: string; errors?: string[]; height?: number };

/**
  What the engine hands the Liner Design modules, made once in main.ts (designCtx) and passed to
  each module's rpc (as a getter: tests that build the api without one get an error only when they
  call a design RPC) and, with the calling session, to each call. A plain object: it's spread.
*/
export type DesignCtx = {
  store: Store;
  env: NodeJS.ProcessEnv;
  /** store.emit: canvas.changed, canvas.presence, pictures.progress. */
  emit: (e: EngineEvent) => void;
  /** A folder the app named (an RPC's cwd), checked: a project's folder or a session's worktree, else it throws. */
  folder: (cwd: string) => string;
  /** The folder a session works in (its worktree, else its project's). */
  cwdOf: (threadId: string) => string;
  /** The turn a session is on, for versions. */
  turnOf: (threadId: string) => number;
  /** Where a folder's files are served (Proxies.files): a design folder's base is this plus its path. */
  filesUrl: (root: string) => Promise<string>;
  /** A proxy onto a local port (Proxies.url), for a live frame. */
  proxyUrl: (port: number) => Promise<string>;
  /** The app draws a page out of sight at this size and answers with its picture (the agent Browser's `shot` op). Throws when no window answers. */
  shot: (threadId: string, page: { url: string; width: number; height: number }, wait?: number) => Promise<Shot>;
  /** Today's single-HTML designs, to adopt one as a frame. */
  designs?: Designs;
  /** The keys the shell handed over (runtime.keys), for the picture model's endpoint. */
  keys: Map<string, string>;
  /** Who works a session's turn, by name ("Opus 5.5"); its sidekick's, with sidekick. */
  whoIs: (threadId: string, sidekick?: boolean) => string;
  /** A session that may only read (Read only, a side chat): it doesn't write frames. */
  readOnly: (threadId: string) => boolean;
  /** A card on the session's timeline that waits for the person's yes (the runtime's askLiner), for design_picture. */
  ask?: AddonHost["askLiner"];
  /** A module's own state for this engine, made the first time it's asked for: ctx.keep("canvas", () => new Watchers()). */
  keep: <T>(key: string, make: () => T) => T;
  /** Something to stop when the engine quits (a watcher). */
  onClose: (fn: () => void) => void;
  /** Runs what onClose was given; main.ts calls it on quit. */
  close: () => void;
};

/** A Liner Design tool's call: the engine's ctx, the session that called, whether it's that session's sidekick, and a signal for a caller that let go. */
export type DesignCall = DesignCtx & { threadId: string; sidekick: boolean; gone?: AbortSignal };

/** The handlers a module answers, typed from the RPC map: each module's rpc returns its own methods' share. */
export type DesignRpc<M extends RpcMethod> = { [K in M]: (p: RpcParams<K>) => Promise<RpcResult<K>> | RpcResult<K> };

/** A DesignCtx from the engine's parts; what's left out answers as a test would want (no window, no keys, nothing read only). */
export function designCtx(store: Store, o: Partial<Omit<DesignCtx, "store" | "keep" | "onClose" | "close">> = {}): DesignCtx {
  const kept = new Map<string, unknown>();
  const closers: (() => void)[] = [];
  const cwdOf = (threadId: string) => {
    const t = store.thread(threadId);
    return t.worktree?.path ?? store.project(t.projectId).path;
  };
  const folder = (cwd: string) => {
    const want = resolve(String(cwd ?? ""));
    const known = [...store.projects.map((p) => p.path), ...store.threads.flatMap((t) => (t.worktree?.path ? [t.worktree.path] : []))];
    if (!cwd || !known.some((k) => resolve(k) === want)) throw new Error("That folder isn't one of your projects.");
    return want;
  };
  return {
    store,
    env: process.env,
    emit: (e) => store.emit(e),
    folder,
    cwdOf,
    turnOf: (threadId) => store.thread(threadId).turns,
    filesUrl: async () => "",
    proxyUrl: async () => "",
    shot: async () => {
      throw new Error("Liner Code's window didn't answer. Is it open?");
    },
    keys: new Map(),
    whoIs: () => "The agent",
    readOnly: () => false,
    ...o,
    keep: <T>(key: string, make: () => T) => {
      if (!kept.has(key)) kept.set(key, make());
      return kept.get(key) as T;
    },
    onClose: (fn) => void closers.push(fn),
    close: () => {
      for (const fn of closers.splice(0)) {
        try {
          fn();
        } catch (e) {
          console.error("[engine]", e);
        }
      }
    },
  };
}

// The files.

/** Where a folder's design files are. */
export const CANVAS_DIR = ".liner/designs";
/** A frame is one page: a few hundred KB at most, with its pictures as files in assets/ (as designs.ts). */
export const MAX_FRAME = 2_000_000;
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const FRAME_FILE = /^frames\/([a-z0-9][a-z0-9-]{0,63})\.html$/;
const MIN_SIDE = 40;
const MAX_SIDE = 8000;
/** Between frames side by side, and between rows: a new frame never lands on another. */
const GAP = 160;
const ROW_GAP = 240;

/**
  What lean.ts and buildlinks.ts may fill in, so design_files says what they know without canvas.ts
  importing them: the skills loaded for a design file (with their SKILL.md paths), and each frame's
  build state.
*/
export const canvasHooks: { skills?: (cwd: string, file: string) => DesignSkill[]; builds?: (cwd: string, file: string) => FrameBuild[] } = {};

const hash = (s: string | Buffer) => createHash("sha1").update(s).digest("hex");

/** A design file's slug as asked: anything else could lead out of .liner/designs/. */
function slugOk(file: unknown) {
  const s = String(file ?? "").trim();
  if (!SLUG.test(s)) throw new Error(`“${s.slice(0, 60)}” isn't a design file's name: it's the folder's slug in ${CANVAS_DIR}/, like “foreshore”.`);
  return s;
}

/**
  A path under a folder (posix, from it), refused in a plain sentence when any part of it on the
  way down, the file itself included, is a link: nothing under .liner/designs/ is reached through
  one, so a link an agent or a cloned repository planted can't lead a read, a write or a removal
  out of the folder. Parts not made yet are fine. Returns the path. Lean and pictures use it too.
*/
export function linkFree(base: string, rel: string) {
  const parts = String(rel).split(/[\\/]+/).filter(Boolean);
  if (parts.some((p) => p === "..")) throw new Error(`${rel} leads out of the folder.`);
  let at = base;
  for (const p of parts) {
    at = join(at, p);
    const s = lstatSync(at, { throwIfNoEntry: false });
    if (!s) break;
    if (s.isSymbolicLink()) throw new Error(`${relative(base, at).split(sep).join("/")} is a link, so Liner Design doesn't read or write through it.`);
  }
  return join(base, ...parts);
}

/** A design file's folder, refused when .liner, designs or the folder itself is a link. */
export const designDir = (cwd: string, file: string) => linkFree(cwd, `${CANVAS_DIR}/${slugOk(file)}`);
/** A drawn frame's file, from its design's folder. */
export const framePath = (f: Pick<DesignFrame, "id" | "path">) => f.path ?? `frames/${f.id}.html`;

/**
  A file of a design's folder, by its path from that folder: refused when it leads out of it, by
  its path, a link on the way, or a link in its own place.
*/
export function inDesign(dir: string, rel: string) {
  const r = String(rel).split("\\").join("/");
  if (!r || isAbsolute(r) || r.split("/").some((p) => p === ".." || p === "")) throw new Error(`${rel} leads out of the design's folder.`);
  const abs = linkFree(dir, r);
  let up = dirname(abs);
  while (!existsSync(up) && up.length > dir.length) up = dirname(up);
  if (existsSync(up) && existsSync(dir)) {
    const inside = relative(realpathSync(dir), realpathSync(up));
    if (inside.startsWith("..") || isAbsolute(inside)) throw new Error(`${rel} leads out of the design's folder.`);
  }
  if (lstatSync(abs, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`${rel} is a link, so it isn't written or read.`);
  return abs;
}

/** A path inside the folder, from the folder (posix), for the lean's file. Outside it throws. */
function inFolder(cwd: string, asked: string) {
  const rel = relative(cwd, resolve(cwd, String(asked).trim()));
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("The lean's file must be inside this folder.");
  return rel.split(sep).join("/");
}

type Watcher = { n: number; fw?: FSWatcher; timers: Map<string, NodeJS.Timeout>; cwd: string; file: string; /** Whether its folder and design.json were there when last looked. */ present?: boolean; /** Looks for the design file going and coming back, once a second. */ poll?: NodeJS.Timeout };
type State = {
  /** What the engine wrote last to each file, by path: the watcher leaves those changes be. */
  own: Map<string, string>;
  watchers: Map<string, Watcher>;
  /** What the app said is selected, by session. */
  selection: Map<string, DesignSelection | null>;
  /** The design file opened last in each folder: the one a tool means when it names none. */
  opened: Map<string, string>;
  /** Presences on now, by what put them on. */
  presence: Map<string, DesignPresence>;
  /** Turns seen start, by "<thread>#<turn>". */
  turns: Map<string, "running" | "ended">;
  /** The revision of each frame file the app was last told of or read, by path: a write over another tells the app first (N2). */
  heard: Map<string, string>;
  /** Whether each watched frame file was there when last seen, by path: its coming and going is always told, whatever its bytes. */
  there: Map<string, boolean>;
  off?: () => void;
};

const state = (ctx: DesignCtx) =>
  ctx.keep<State>("canvas", () => ({ own: new Map(), watchers: new Map(), selection: new Map(), opened: new Map(), presence: new Map(), turns: new Map(), heard: new Map(), there: new Map() }));

/** A frame file's revision: a short hash of its bytes, which canvas.frame.write and apply check `base` against. */
export const revOf = (bytes: string | Buffer) => createHash("sha1").update(bytes).digest("hex").slice(0, 12);

/** The error a write gives when the frame changed since the revision it was based on. */
const changedSince = (name: string) => new Error(`${FRAME_CHANGED} “${name}” changed since you read it (the agent, or another window, wrote it). Nothing was written; read it again first.`);

/** A tool call of a session that only reads (Read only, a side chat) writes nothing, not even ids or a found frame. */
const mayWrite = (ctx: DesignCtx) => !quiet.getStore() && !("threadId" in ctx && typeof (ctx as DesignCall).threadId === "string" && ctx.readOnly((ctx as DesignCall).threadId));
/**
  Everything a read-only session's tool call does, whichever ctx it reaches the files with (the
  lean's and build links' hooks hold the engine's own, not the call's), runs in this: nothing in it
  writes, not an index, not an id.
*/
const quiet = new AsyncLocalStorage<boolean>();

/** Writes a file of the engine's own, and remembers it so the watcher doesn't take it for an agent's. */
function writeOwn(st: State, abs: string, content: string) {
  mkdirSync(dirname(abs), { recursive: true });
  if (lstatSync(abs, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`${basename(abs)} is a link, so it isn't written.`);
  writeFileSync(abs, content);
  st.own.set(abs, hash(content));
  st.there.set(abs, true);
}

const num = (v: unknown, what: string) => {
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) > 1e6) throw new Error(`${what} must be a number.`);
  return Math.round(n);
};
/** A frame's width or height: whole px, 40 to 8000. */
export const side = (v: unknown, what = "A frame's width and height") => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < MIN_SIDE || n > MAX_SIDE) throw new Error(`${what} must be ${MIN_SIDE} to ${MAX_SIDE} px.`);
  return n;
};
const words = (v: unknown, max = 120) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const SIZE_NAME: Record<DesignSize, string> = { desktop: "Desktop", tablet: "Tablet", phone: "Phone" };

/** A design.json as read, made whole: what's missing gets its default, a frame that can't be right is left out. */
function normal(raw: unknown, slug: string): DesignFile {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pages = (Array.isArray(r.pages) ? r.pages : []).flatMap((p: { id?: unknown; name?: unknown }) => (p && SLUG.test(String(p.id)) ? [{ id: String(p.id), name: words(p.name) || "Page" }] : []));
  if (!pages.length) pages.push({ id: "p1", name: "Page 1" });
  const frames: DesignFrame[] = [];
  for (const f of Array.isArray(r.frames) ? (r.frames as Record<string, unknown>[]) : []) {
    try {
      if (!f || !SLUG.test(String(f.id)) || frames.some((x) => x.id === f.id)) continue;
      const kind = f.kind === "live" ? "live" : "drawn";
      const path = kind === "drawn" ? String(f.path ?? `frames/${f.id}.html`) : undefined;
      if (path !== undefined && !FRAME_FILE.test(path)) continue;
      frames.push({
        id: String(f.id),
        page: pages.some((p) => p.id === f.page) ? String(f.page) : pages[0].id,
        name: words(f.name) || String(f.id),
        kind,
        ...(path ? { path } : {}),
        ...(kind === "live" ? { url: localUrl(f.url) } : {}),
        x: num(f.x ?? 0, "x"),
        y: num(f.y ?? 0, "y"),
        w: side(f.w ?? 1280),
        h: side(f.h ?? 800),
        ...(byOf(f.by) ? { by: byOf(f.by)! } : {}),
        ...(f.built && typeof f.built === "object" ? { built: f.built as DesignFrame["built"] } : {}),
        ...(f.screen === false ? { screen: false as const } : {}),
      });
    } catch {
      // A frame with sizes that can't be: left out of what the canvas shows; its file stays.
    }
  }
  const l = (r.lean && typeof r.lean === "object" ? r.lean : {}) as Record<string, unknown>;
  const lean: DesignFile["lean"] = { skills: Array.isArray(l.skills) ? l.skills.map((s) => words(s, 80)).filter(Boolean) : [] };
  if (typeof l.path === "string" && l.path.trim()) lean.path = l.path.trim();
  if (typeof l.builtin === "string" && l.builtin.trim()) lean.builtin = l.builtin.trim();
  // `pictures` on disk is ignored: the agent writes design.json, so the consent and the model live in the engine (design-prefs.ts).
  return { v: 1, id: slug, title: words(r.title) || slug, pages, frames, lean };
}

/** A design file with the engine's own picture setting on it, as the RPCs and tools hand it out. */
function withPrefs(ctx: DesignCtx, cwd: string, file: DesignFile): DesignFile {
  const pictures = picturesPref(ctx.store.home, cwd, file.id);
  return pictures ? { ...file, pictures } : file;
}

/** Who drew a frame, as read from design.json: only its own fields, of their own kinds. */
function byOf(v: unknown): DesignFrame["by"] | undefined {
  if (!v || typeof v !== "object") return undefined;
  const b = v as Record<string, unknown>;
  const str = (x: unknown, max = 120) => (typeof x === "string" && x.trim() ? x.trim().slice(0, max) : undefined);
  const nr = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : undefined);
  const agent = str(b.agent, 40);
  const name = str(b.name);
  if (!agent || !name) return undefined;
  const cost = nr(b.cost);
  const ms = nr(b.ms);
  const way = str(b.way, 80);
  const thread = str(b.thread, 80);
  return { agent, name, ...(cost !== undefined ? { cost } : {}), ...(ms !== undefined ? { ms } : {}), ...(way ? { way } : {}), ...(thread ? { thread } : {}) };
}

/**
  Where a frame of this size goes on a page. Asked for a place that doesn't overlap another frame:
  there. Else the nearest free place to the right in the same row, keeping 160 between frames and
  240 between rows; asked for none, the right of the page's top row. Says whether it moved.
*/
export function placeFree(file: DesignFile, page: string, w: number, h: number, want: { x?: number; y?: number } = {}, skip?: string) {
  const on = file.frames.filter((f) => f.page === page && f.id !== skip);
  const overlaps = (x: number, y: number, gx: number, gy: number) => on.find((f) => x < f.x + f.w + gx && x + w + gx > f.x && y < f.y + f.h + gy && y + h + gy > f.y);
  const top = on.length ? Math.min(...on.map((f) => f.y)) : 0;
  const row = on.filter((f) => f.y < top + ROW_GAP);
  const asked = want.x !== undefined || want.y !== undefined;
  let x = want.x ?? (row.length ? Math.max(...row.map((f) => f.x + f.w)) + GAP : 0);
  const y = want.y ?? top;
  if (asked && !overlaps(x, y, 0, 0)) return { x, y, moved: false };
  for (let hit = overlaps(x, y, GAP, ROW_GAP); hit; hit = overlaps(x, y, GAP, ROW_GAP)) x = hit.x + hit.w + GAP;
  return { x, y, moved: asked };
}

/** Where a new frame goes, with nothing asked: to the right of the page's top row. */
function placeNext(file: DesignFile, page: string, w = 1280, h = 800) {
  const { x, y } = placeFree(file, page, w, h);
  return { x, y };
}

/** A frame's size from a page an agent wrote by itself: its viewport's width, else a desktop's. */
function sizeFrom(html: string) {
  const meta = elements(parse(html)).find((e) => e.tag === "meta" && attr(e, "name")?.value.toLowerCase() === "viewport");
  const w = Number(/width\s*=\s*(\d+)/i.exec(meta ? (attr(meta, "content")?.value ?? "") : "")?.[1]);
  if (!w || w < MIN_SIDE || w > MAX_SIDE) return FRAME_SIZES.desktop;
  return { w, h: w <= 500 ? FRAME_SIZES.phone.h : w <= 1000 ? FRAME_SIZES.tablet.h : FRAME_SIZES.desktop.h };
}

const nameFrom = (id: string) => id.replace(/-+/g, " ").replace(/^./, (c) => c.toUpperCase());

/**
  Puts frames/ files an agent wrote by itself, that design.json doesn't list, on the canvas, and
  marks drawn frames whose file isn't there now `missing` (in memory only). A frame whose file is
  gone keeps its entry, with everything it holds: an agent's mv, an editor's save by rename or a git
  checkout bring the file back to the same frame. Only a remove takes an entry out. Says whether
  it added anything.
*/
function sync(dir: string, file: DesignFile, _drop?: boolean, was?: (path: string) => DesignFrame | undefined) {
  let changed = false;
  for (const f of file.frames) {
    if (f.kind !== "drawn") continue;
    if (lstatSync(join(dir, framePath(f)), { throwIfNoEntry: false })?.isFile()) delete f.missing;
    else f.missing = true;
  }
  const fdir = join(dir, "frames");
  // A frames/ that is a link is read from nowhere.
  const loose = existsSync(fdir) && !lstatSync(fdir).isSymbolicLink() ? readdirSync(fdir).filter((n) => FRAME_FILE.test(`frames/${n}`)).sort() : [];
  for (const n of loose) {
    const path = `frames/${n}`;
    if (file.frames.some((f) => f.path === path)) continue;
    const id = n.replace(/\.html$/, "");
    if (file.frames.some((f) => f.id === id)) continue;
    let html = "";
    try {
      if (lstatSync(join(fdir, n)).isSymbolicLink()) continue;
      html = readFileSync(join(fdir, n), "utf8");
    } catch {
      continue;
    }
    // A file a removed frame had (in the trash): it comes back with that frame's name, size, screen mark and author, at a free place, with no build link.
    const old = was?.(path);
    if (old) {
      const page = file.pages.some((p) => p.id === old.page) ? old.page : file.pages[0].id;
      const { x, y } = placeFree(file, page, old.w, old.h, { x: old.x, y: old.y });
      file.frames.push({ id, page, name: old.name, kind: "drawn", path, x, y, w: old.w, h: old.h, ...(old.by ? { by: old.by } : {}), ...(old.screen === false ? { screen: false as const } : {}) });
      changed = true;
      continue;
    }
    const size = sizeFrom(html);
    const page = file.pages[0].id;
    file.frames.push({ id, page, name: nameFrom(id), kind: "drawn", path, ...placeNext(file, page, size.w, size.h), w: size.w, h: size.h });
    changed = true;
  }
  return changed;
}

/** A design file's index, read (and, the first time, made from the frames there). */
export function readFile(ctx: DesignCtx, cwd: string, slug: string, o: { drop?: boolean } = {}): DesignFile {
  const st = state(ctx);
  const dir = designDir(cwd, slug);
  const index = inDesign(dir, "design.json");
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`There's no design file “${slug}” in this folder.`);
  let raw: unknown = {};
  const had = existsSync(index);
  if (had) {
    const text = readFileSync(index);
    try {
      raw = JSON.parse(text.toString("utf8"));
    } catch {
      throw new Error(unreadable(ctx, cwd, slug, text));
    }
  }
  const file = normal(raw, slug);
  // A session that only reads sees the frames it found, and writes nothing.
  const fromTrash = (path: string) => {
    try {
      const t = trashed(ctx, cwd, slug).find((x) => (x.frame.path ?? `frames/${x.frame.id}.html`) === path && x.frame.kind === "drawn");
      return t ? normal({ pages: file.pages, frames: [t.frame] }, slug).frames[0] : undefined;
    } catch {
      return undefined;
    }
  };
  if ((sync(dir, file, Boolean(o.drop), fromTrash) || !had) && mayWrite(ctx)) writeIndex(st, cwd, file);
  return withPrefs(ctx, cwd, file);
}

/**
  A design file's index as it is, read the same way and never written: for what only looks (the
  "## Design" note of a turn, design_files' hooks), which has no engine state to hand. null when
  there's no such design file or its JSON is broken.
*/
export function peekFile(cwd: string, slug: string): DesignFile | null {
  let dir: string;
  try {
    dir = designDir(cwd, slug);
  } catch {
    return null;
  }
  if (!existsSync(dir)) return null;
  try {
    const index = join(dir, "design.json");
    const file = normal(existsSync(index) ? JSON.parse(readFileSync(index, "utf8")) : {}, slug);
    sync(dir, file, false);
    return file;
  } catch {
    return null;
  }
}

/**
  Sets a frame's build link (buildlinks.ts), or takes it off with undefined, through the same
  read and write as every other change of the index. Not a DesignPatch field, so the app's
  canvas.save can't write one.
*/
export function setBuilt(ctx: DesignCtx, cwd: string, slug: string, asked: string, built: DesignFrame["built"] | undefined): DesignFile {
  const st = state(ctx);
  const file = readFile(ctx, cwd, slug);
  const f = frameOf(file, asked);
  if (built) f.built = built;
  else delete f.built;
  writeIndex(st, cwd, file);
  return file;
}

/**
  The sentence for a design.json that is there but can't be read (DESIGN_UNREADABLE first). The
  first time these bytes are found broken, a copy is kept under Liner Code's home
  (designs/canvas-broken/<folder>/<file>/<hash>.json), so the person can get them back; and when a
  session in this folder has a kept copy of the file, the sentence says Bring this back has one.
*/
function unreadable(ctx: DesignCtx, cwd: string, slug: string, bytes: Buffer) {
  const sha = (b: string | Buffer) => createHash("sha1").update(b).digest("hex").slice(0, 16);
  const keep = join(ctx.store.home, "designs", "canvas-broken", sha(resolve(cwd)), slug, `${sha(bytes)}.json`);
  try {
    if (!existsSync(keep)) {
      mkdirSync(dirname(keep), { recursive: true });
      writeFileSync(keep, bytes);
    }
  } catch {
    // no copy, still no write over it
  }
  const earlier = ctx.store.threads.find((t) => {
    try {
      return resolve(ctx.cwdOf(t.id)) === resolve(cwd) && kept(ctx, t.id, slug).length > 0;
    } catch {
      return false;
    }
  });
  const back = earlier ? ` Bring this back (Versions, in the session “${earlier.title}”) has an earlier copy: put it back, or fix the file.` : " Liner Code has no earlier copy of it, and has left the broken file as it is: fix it by hand.";
  return `${DESIGN_UNREADABLE} ${CANVAS_DIR}/${slug}/design.json can't be read (it isn't whole JSON), so nothing is written to it; a copy of it as it is now is kept at ${keep}.${back}`;
}

function writeIndex(st: State, cwd: string, file: DesignFile) {
  // The picture setting is the engine's (design-prefs.ts), never written where the agent could change it; `missing` is only what a read saw.
  const { pictures: _engines, ...rest } = file;
  const onDisk = { ...rest, frames: rest.frames.map(({ missing: _gone, ...f }) => f) };
  writeOwn(st, inDesign(designDir(cwd, file.id), "design.json"), `${JSON.stringify(onDisk, null, 2)}\n`);
}

/** The design files of a folder, newest first. */
export function listFiles(ctx: DesignCtx, cwd: string): DesignFileInfo[] {
  const root = linkFree(cwd, CANVAS_DIR);
  if (!existsSync(root)) return [];
  const out: DesignFileInfo[] = [];
  for (const slug of readdirSync(root)) {
    const dir = join(root, slug);
    if (!SLUG.test(slug) || !lstatSync(dir).isDirectory() || !(existsSync(join(dir, "design.json")) || existsSync(join(dir, "frames")))) continue;
    try {
      const file = readFile(ctx, cwd, slug);
      const times = [join(dir, "design.json"), ...file.frames.filter((f) => f.kind === "drawn").map((f) => join(dir, framePath(f)))].map((p) => statSync(p, { throwIfNoEntry: false })?.mtimeMs ?? 0);
      out.push({ id: slug, title: file.title, frames: file.frames.length, updated: Math.round(Math.max(...times)), ...(file.frames[0] ? { thumb: file.frames[0].id } : {}) });
    } catch (e) {
      // A design file whose index can't be read is listed as such, never as absent; one that leads through a link is left out.
      const said = e instanceof Error ? e.message : String(e);
      if (said.startsWith(DESIGN_UNREADABLE)) out.push({ id: slug, title: slug, frames: 0, updated: Math.round(statSync(join(dir, "design.json"), { throwIfNoEntry: false })?.mtimeMs ?? 0), unreadable: said.slice(DESIGN_UNREADABLE.length).trim() });
    }
  }
  return out.sort((a, b) => b.updated - a.updated);
}

/** A free slug for a new design file or frame. */
export function freeSlug(title: string, taken: (s: string) => boolean) {
  const base = slugOf(title).slice(0, 56).replace(/-+$/, "") || "design";
  for (let n = 1; ; n++) {
    const s = n > 1 ? `${base}-${n}` : base;
    if (!taken(s)) return s;
  }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The page a new frame starts as. */
export function blankPage(name: string, w: number) {
  return stamp(`<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=${w}">\n<title>${esc(name)}</title>\n<style>body { margin: 0; }</style>\n</head>\n<body>\n</body>\n</html>\n`).html;
}

/** Makes a design file: an empty page, and with a size, one blank frame of it. */
export function createFile(ctx: DesignCtx, cwd: string, title: string, size?: DesignSize, slug?: string): DesignFile {
  const st = state(ctx);
  const t = words(title) || "Design";
  const id = slug ? slugOk(slug) : freeSlug(t, (s) => existsSync(join(cwd, CANVAS_DIR, s)));
  if (lstatSync(join(cwd, CANVAS_DIR, id), { throwIfNoEntry: false })) throw new Error(`There's a design file “${id}” here already.`);
  const dir = designDir(cwd, id);
  mkdirSync(join(dir, "frames"), { recursive: true });
  mkdirSync(join(dir, "assets"), { recursive: true });
  const file: DesignFile = { v: 1, id, title: t, pages: [{ id: "p1", name: "Page 1" }], frames: [], lean: { skills: [] } };
  if (size && FRAME_SIZES[size]) {
    const { w, h } = FRAME_SIZES[size];
    const fid = slugOf(SIZE_NAME[size]);
    writeOwn(st, inDesign(dir, `frames/${fid}.html`), blankPage(SIZE_NAME[size], w));
    file.frames.push({ id: fid, page: "p1", name: SIZE_NAME[size], kind: "drawn", path: `frames/${fid}.html`, x: 0, y: 0, w, h });
  }
  writeIndex(st, cwd, file);
  void keepOutOfGit(cwd);
  return file;
}

/** Changes a design file's index: its title, pages, lean, pictures, and frames' place, size, name and page. */
export function saveFile(ctx: DesignCtx, cwd: string, slug: string, patch: DesignPatch): DesignFile {
  const st = state(ctx);
  const file = readFile(ctx, cwd, slug);
  const p = (patch ?? {}) as DesignPatch;
  if (p.title !== undefined) {
    if (!words(p.title)) throw new Error("A design file needs a title.");
    file.title = words(p.title);
  }
  if (p.pages !== undefined) {
    if (!Array.isArray(p.pages) || !p.pages.length) throw new Error("A design file keeps at least one page.");
    const pages = p.pages.map((x) => {
      if (!x || !SLUG.test(String(x.id))) throw new Error(`“${String(x?.id).slice(0, 40)}” isn't a page's id: lower case letters, numbers and dashes.`);
      return { id: String(x.id), name: words(x.name) || "Page" };
    });
    if (new Set(pages.map((x) => x.id)).size !== pages.length) throw new Error("Two pages have the same id.");
    file.pages = pages;
    // A frame on a page that went moves to the first one.
    for (const f of file.frames) if (!pages.some((x) => x.id === f.page)) f.page = pages[0].id;
  }
  if (p.lean !== undefined) {
    const l = p.lean ?? { skills: [] };
    if (!Array.isArray(l.skills)) throw new Error("The lean's skills are a list of names.");
    file.lean = { skills: [...new Set(l.skills.map((s) => words(s, 80)).filter(Boolean))], ...(l.path ? { path: inFolder(cwd, l.path) } : {}), ...(l.builtin ? { builtin: words(l.builtin, 40) } : {}) };
  }
  if (p.pictures !== undefined) {
    const ask = p.pictures?.ask;
    if (ask !== "first" && ask !== "always" && ask !== "never") throw new Error("pictures.ask is first, always or never.");
    const model = p.pictures && "model" in p.pictures ? (p.pictures.model === null ? null : words(p.pictures.model, 80) || undefined) : file.pictures?.model;
    // Kept by the engine (design-prefs.ts) once the rest of the patch holds, not in design.json.
    file.pictures = { ask, ...(model !== undefined ? { model } : {}) };
  }
  for (const c of p.frames ?? []) {
    const f = file.frames.find((x) => x.id === c?.id);
    if (!f) throw new Error(`There's no frame “${String(c?.id).slice(0, 40)}” in this design file.`);
    if (c.x !== undefined) f.x = num(c.x, "x");
    if (c.y !== undefined) f.y = num(c.y, "y");
    if (c.w !== undefined) f.w = side(c.w);
    if (c.h !== undefined) f.h = side(c.h);
    if (c.name !== undefined) f.name = words(c.name) || f.name;
    if (c.screen === false) f.screen = false;
    else if (c.screen === true) delete f.screen;
    if (c.page !== undefined) {
      if (!file.pages.some((x) => x.id === c.page)) throw new Error(`There's no page “${String(c.page).slice(0, 40)}”.`);
      f.page = c.page;
    }
  }
  if (p.pictures !== undefined && file.pictures) setPicturesPref(ctx.store.home, cwd, slug, file.pictures);
  writeIndex(st, cwd, file);
  return file;
}

/** The design file a tool means when it names none, in this folder: the one the person opened or made last (canvas.open, canvas.create, design.new). */
export function setOpened(ctx: DesignCtx, cwd: string, slug: string) {
  state(ctx).opened.set(resolve(cwd), slugOk(slug));
}

/** The session an agent draws in this design file with now (canvas.presence), if one does. */
export function drawingIn(ctx: DesignCtx, cwd: string, slug: string): string | undefined {
  const at = resolve(cwd);
  return [...state(ctx).presence.values()].find((p) => resolve(p.cwd) === at && p.file === slug)?.threadId;
}

/** A frame by its id, else its name (any case). */
export function frameOf(file: DesignFile, asked: unknown) {
  const a = String(asked ?? "").trim();
  const f = file.frames.find((x) => x.id === a) ?? file.frames.find((x) => x.name.toLowerCase() === a.toLowerCase());
  if (!f) throw new Error(`There's no frame “${a.slice(0, 60)}” in “${file.title}”.${file.frames.length ? ` Its frames: ${file.frames.map((x) => `${x.id} (“${x.name}”)`).join(", ")}.` : " It has no frames yet."}`);
  return f;
}

const isLocal = (url: string) => {
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `http://${url}`);
    return (u.protocol === "http:" || u.protocol === "https:") && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) && Boolean(u.port) && !u.username && !u.password;
  } catch {
    return false;
  }
};

/** A live frame's address as read from design.json: a page on this Mac, else it throws (normal() then leaves the frame out). */
function localUrl(v: unknown) {
  const url = String(v ?? "").trim();
  if (!isLocal(url)) throw new Error("A live frame is a page of the app running on this Mac: localhost:5173/today.");
  return url;
}

const sizedHtml = (html: string) => {
  if (!html.trim()) throw new Error("The frame's page is empty.");
  if (html.length > MAX_FRAME) throw new Error("That frame is too large; keep it under 2 MB, with big pictures as files in the design's assets/.");
  return html;
};

/** An address another page's relative one can't be: a scheme, //, /, #, a template's {{ }}. */
const absolute = (u: string) => !u.trim() || /^(?:[a-z][a-z0-9+.-]*:|\/|#|\{\{|\$\{)/i.test(u.trim());

/**
  A page moved from one folder to another (both from the session's folder, posix): each relative
  address in it (src, href, poster, srcset, url()) is rewritten to lead to the same file from the
  new place. One that would lead out of the session's folder, or is absolute, stays as it was.
  Script bodies are left alone; their tags aren't.
*/
export function rebase(html: string, from: string, to: string) {
  const fix = (u: string) => {
    if (absolute(u)) return u;
    const m = /^([^?#]*)(.*)$/.exec(u)!;
    const target = join(from === "." ? "" : from, m[1]);
    if (!m[1] || target.startsWith("..") || isAbsolute(target)) return u;
    return relative(to, target).split(sep).join("/") + m[2];
  };
  const inTag = (t: string) =>
    t
      .replace(/(\s(?:src|href|poster|data-src)\s*=\s*)(["'])(.*?)\2/gi, (_m, a: string, q: string, u: string) => `${a}${q}${fix(u)}${q}`)
      .replace(/(\ssrcset\s*=\s*)(["'])(.*?)\2/gi, (_m, a: string, q: string, v: string) => `${a}${q}${v.split(",").map((part) => part.replace(/^(\s*)(\S+)/, (_x, sp: string, u: string) => sp + fix(u))).join(",")}${q}`);
  const urls = (css: string) => css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (_m, q: string, u: string) => `url(${q}${fix(u)}${q})`);
  return html
    .split(/(<script\b[^>]*>[\s\S]*?<\/script\s*>)/i)
    .map((part, i) => (i % 2 ? part.replace(/^<script\b[^>]*>/i, inTag) : urls(part.replace(/<[a-zA-Z][^>]*>/g, inTag))))
    .join("");
}

/** Adds a frame: drawn (from html, an old design, or a blank page) or live (a local url). */
export function addFrame(ctx: DesignCtx, cwd: string, slug: string, nf: NewFrame, html?: string): { file: DesignFile; frame: DesignFrame; placed: FramePlaced } {
  const st = state(ctx);
  const file = readFile(ctx, cwd, slug);
  const dir = designDir(cwd, slug);
  const a = (nf ?? {}) as NewFrame;
  let w = Number(a.w);
  let h = Number(a.h);
  let name = words(a.name);
  if (a.adopt) {
    // An old design of the Design surface, as a frame: its page, at the size it was drawn for.
    if (!ctx.designs) throw new Error("Designs aren't available here.");
    ctx.store.thread(a.adopt.threadId);
    const info = ctx.designs.list(a.adopt.threadId).find((d) => d.design === a.adopt!.design);
    if (!info) throw new Error("That design isn't in this session.");
    // Its pictures and styles were beside the old file: their relative addresses now lead from frames/ back to them.
    html = rebase(ctx.designs.read(a.adopt.threadId, a.adopt.design, a.adopt.version).html, dirname(info.path), `${CANVAS_DIR}/${slug}/frames`);
    if (!(w > 0 && h > 0)) ({ w, h } = FRAME_SIZES[info.size] ?? FRAME_SIZES.desktop);
    name ||= info.title;
  }
  if (!name) throw new Error("A frame needs a name: “Phone / Today”.");
  w = side(w);
  h = side(h);
  const page = a.page === undefined ? file.pages[0].id : String(a.page);
  if (!file.pages.some((x) => x.id === page)) throw new Error(`There's no page “${page.slice(0, 40)}”.`);
  const id = freeSlug(name, (s) => file.frames.some((f) => f.id === s) || existsSync(join(dir, "frames", `${s}.html`)));
  const spot = placeFree(file, page, w, h, { ...(a.x !== undefined ? { x: num(a.x, "x") } : {}), ...(a.y !== undefined ? { y: num(a.y, "y") } : {}) });
  const at = { x: spot.x, y: spot.y };
  const by = byOf(a.by);
  let frame: DesignFrame;
  if (a.kind === "live") {
    const url = String(a.url ?? "").trim();
    if (!isLocal(url)) throw new Error("A live frame is a page of the app running on this Mac: localhost:5173/today.");
    frame = { id, page, name, kind: "live", url, ...at, w, h, ...(by ? { by } : {}), ...(a.screen === false ? { screen: false as const } : {}) };
  } else {
    const path = `frames/${id}.html`;
    writeOwn(st, inDesign(dir, path), stamp(html === undefined ? blankPage(name, w) : sizedHtml(html)).html);
    frame = { id, page, name, kind: "drawn", path, ...at, w, h, ...(by ? { by } : {}), ...(a.screen === false ? { screen: false as const } : {}) };
  }
  file.frames.push(frame);
  writeIndex(st, cwd, file);
  void keepOutOfGit(cwd);
  return { file, frame, placed: { frame: id, x: at.x, y: at.y, moved: spot.moved } };
}

/** How many removed frames a design file's trash keeps, and for how long. */
const TRASH_KEEP = 20;
const TRASH_DAYS = 7;

/** Where a design file's removed frames wait, under Liner Code's home (never the project): per folder and file. */
const trashDir = (ctx: DesignCtx, cwd: string, slug: string) => join(ctx.store.home, "canvas-trash", createHash("sha1").update(resolve(cwd)).digest("hex").slice(0, 16), slugOk(slug));

type Trashed = { dir: string; frame: DesignFrame; at: number };

function trashed(ctx: DesignCtx, cwd: string, slug: string): Trashed[] {
  const dir = trashDir(ctx, cwd, slug);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .flatMap((n) => {
      try {
        const e = JSON.parse(readFileSync(join(dir, n, "entry.json"), "utf8")) as { frame: DesignFrame; at: number };
        return SLUG.test(String(e.frame?.id)) ? [{ dir: join(dir, n), frame: e.frame, at: Number(e.at) || 0 }] : [];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.at - a.at);
}

/**
  Takes a frame off the canvas: its entry (place, size, build link) and its HTML go to the trash
  under Liner Code's home, from which unremoveFrame puts it back. The trash keeps the newest 20 of
  a design file, for 7 days.
*/
export function removeFrame(ctx: DesignCtx, cwd: string, slug: string, asked: string) {
  const st = state(ctx);
  const file = readFile(ctx, cwd, slug);
  const f = frameOf(file, asked);
  const at = Date.now();
  const into = join(trashDir(ctx, cwd, slug), `${f.id}.${at}`);
  mkdirSync(into, { recursive: true });
  let abs: string | undefined;
  if (f.kind === "drawn") {
    abs = inDesign(designDir(cwd, slug), framePath(f));
    if (existsSync(abs)) writeFileSync(join(into, "frame.html"), readFileSync(abs));
  }
  writeFileSync(join(into, "entry.json"), JSON.stringify({ frame: f, at }));
  file.frames = file.frames.filter((x) => x !== f);
  writeIndex(st, cwd, file);
  if (abs) {
    rmSync(abs, { force: true });
    st.own.delete(abs);
    st.there.delete(abs);
  }
  const old = at - TRASH_DAYS * 86_400_000;
  for (const [i, t] of trashed(ctx, cwd, slug).entries()) if (i >= TRASH_KEEP || t.at < old) rmSync(t.dir, { recursive: true, force: true });
  return file;
}

/** Puts the frame removed last with this id back as it was: the same id, place, size, link and HTML. */
export function unremoveFrame(ctx: DesignCtx, cwd: string, slug: string, asked: string) {
  const st = state(ctx);
  const file = readFile(ctx, cwd, slug);
  const id = String(asked ?? "").trim();
  const t = trashed(ctx, cwd, slug).find((x) => x.frame.id === id);
  if (!t) throw new Error(`There's no removed frame “${id.slice(0, 60)}” of this design file to put back.`);
  if (file.frames.some((x) => x.id === id)) throw new Error(`There's a frame “${id}” on the canvas again, so the removed one can't come back with its id.`);
  // The entry is read as design.json is: a drawn frame's path must be a plain frames/<name>.html, a live one's address this Mac's.
  const checked = normal({ pages: file.pages, frames: [t.frame] }, slug).frames[0];
  if (!checked || checked.id !== id) throw new Error(`The removed frame “${id}” can't be put back: its record isn't one the canvas reads.`);
  const f: DesignFrame = checked;
  let rev: string | undefined;
  if (f.kind === "drawn") {
    const abs = inDesign(designDir(cwd, slug), framePath(f));
    if (file.frames.some((x) => x.path === framePath(f))) throw new Error(`Another frame has ${framePath(f)} now, so the removed one can't come back to it.`);
    if (existsSync(abs)) throw new Error(`${framePath(f)} is there again, so the removed frame can't come back over it.`);
    const kept = join(t.dir, "frame.html");
    if (existsSync(kept)) {
      const html = readFileSync(kept, "utf8");
      writeOwn(st, abs, html);
      rev = revOf(html);
    } else {
      // It was removed while its file was gone: it comes back as it was, missing, and whole again when the file does.
      f.missing = true;
    }
  }
  file.frames.push(f);
  writeIndex(st, cwd, file);
  rmSync(t.dir, { recursive: true, force: true });
  ctx.emit({ type: "canvas.changed", cwd, file: slug, frame: f.id, by: "you", at: Date.now(), ...(rev ? { rev } : {}) });
  return file;
}

/** A frame again, beside it (or where asked), with " copy" after its name. */
export function copyFrame(ctx: DesignCtx, cwd: string, slug: string, asked: string, x?: number, y?: number) {
  const file = readFile(ctx, cwd, slug);
  const f = frameOf(file, asked);
  const html = f.kind === "drawn" ? readFrame(ctx, cwd, slug, f.id) : undefined;
  return addFrame(ctx, cwd, slug, { name: `${f.name} copy`, w: f.w, h: f.h, kind: f.kind, url: f.url, page: f.page, x: x ?? f.x + f.w + GAP, y: y ?? f.y }, html).file;
}

/** A drawn frame's file: its path, refused for a live frame, a missing file or one over 2 MB. */
function frameFile(cwd: string, slug: string, f: DesignFrame) {
  if (f.kind !== "drawn") throw new Error(`“${f.name}” is a live frame, a page of the running app (${f.url}): it has no HTML file here.`);
  const abs = inDesign(designDir(cwd, slug), framePath(f));
  if (!existsSync(abs)) throw new Error(`“${f.name}”'s file, ${framePath(f)}, isn't there any more.`);
  if (statSync(abs).size > MAX_FRAME) throw new Error(`“${f.name}” is over 2 MB; keep a frame to one page, with big pictures as files in assets/.`);
  return abs;
}

/**
  A drawn frame's HTML, stamped, and the revision of its file. Ids come from the page itself, so a
  page read twice unchanged gets the same ones whether they're written or not. With keep (the app's
  canvas.frame.read, an agent's design_tree and design_node), the stamped page is written so ids
  hold from now on: never for a session that only reads, and never when the stamps couldn't be
  taken back out to the very same page (`ok` false: then the page is handed back as it is, with no
  ids, rather than ids that aren't the file's).
*/
export function readFrameRev(ctx: DesignCtx, cwd: string, slug: string, asked: string, o: { keep?: boolean } = {}) {
  const st = state(ctx);
  const f = frameOf(readFile(ctx, cwd, slug), asked);
  const abs = frameFile(cwd, slug, f);
  const raw = readFileSync(abs, "utf8");
  const s = stamp(raw);
  if (!s.ok) return { html: raw, rev: heardRev(st, abs, raw), frame: f, ok: false };
  if (s.added && o.keep && mayWrite(ctx)) {
    writeOwn(st, abs, s.html);
    return { html: s.html, rev: heardRev(st, abs, s.html), frame: f, ok: true };
  }
  return { html: s.html, rev: heardRev(st, abs, raw), frame: f, ok: true };
}

/** A revision someone was handed: the engine knows the app has seen it. */
const heardRev = (st: State, abs: string, bytes: string | Buffer) => {
  const rev = revOf(bytes);
  st.heard.set(abs, rev);
  return rev;
};

/**
  Before a write over a frame's file: when what's there isn't what the engine wrote or the app was
  last told of (an agent wrote it with its own tools, inside the watcher's wait), canvas.changed
  goes out for it first, by "agent", so every window hears of it. Returns its revision (`from`).
*/
function heardBefore(ctx: DesignCtx, cwd: string, slug: string, frame: string, abs: string, raw: string | Buffer | undefined) {
  const st = state(ctx);
  if (raw === undefined) return "";
  const rev = revOf(raw);
  if (st.own.get(abs) !== hash(raw) && st.heard.get(abs) !== rev) {
    st.heard.set(abs, rev);
    ctx.emit({ type: "canvas.changed", cwd, file: slug, frame, by: "agent", ...withThread(runningIn(ctx, cwd, slug, frame)), at: Date.now(), rev });
  }
  return rev;
}

/** A drawn frame's HTML, stamped (readFrameRev without the revision); writes nothing. */
export function readFrame(ctx: DesignCtx, cwd: string, slug: string, asked: string) {
  return readFrameRev(ctx, cwd, slug, asked).html;
}

/**
  Writes a drawn frame's HTML whole, stamped, and says so: by you (the editor) or by an agent (a
  tool). With `base`, refused (FRAME_CHANGED) when the file isn't at that revision any more.
*/
export function writeFrame(ctx: DesignCtx, cwd: string, slug: string, asked: string, html: string, by: { by: "you" | "agent"; threadId?: string; base?: string }) {
  const st = state(ctx);
  const file = readFile(ctx, cwd, slug);
  const f = frameOf(file, asked);
  if (f.kind !== "drawn") throw new Error(`“${f.name}” is a live frame: change the app's own files instead.`);
  const abs = inDesign(designDir(cwd, slug), framePath(f));
  const was = existsSync(abs) ? readFileSync(abs) : undefined;
  if (by.base !== undefined && (!was || revOf(was) !== by.base)) throw changedSince(f.name);
  const given = sizedHtml(String(html ?? ""));
  const from = heardBefore(ctx, cwd, slug, f.id, abs, was);
  const s = stamp(given);
  // Stamps that can't be taken back out to the same page aren't written: the page goes as given.
  const out = s.ok ? s.html : given;
  writeOwn(st, abs, out);
  const at = Date.now();
  const rev = revOf(out);
  st.heard.set(abs, rev);
  ctx.emit({ type: "canvas.changed", cwd, file: slug, frame: f.id, by: by.by, ...(by.threadId ? { threadId: by.threadId } : {}), at, rev });
  return { at, html: s.html, frame: f, rev, from };
}

/**
  Changes a drawn frame's source with FrameOps (canvas-html's applyOps), all or nothing, touching
  only the changed elements' bytes; refused (FRAME_CHANGED) when `base` isn't its revision. Returns
  the ops that put it back and the ids of the elements it added.
*/
export function applyFrame(ctx: DesignCtx, cwd: string, slug: string, asked: string, ops: FrameOp[], by: { by: "you" | "agent"; threadId?: string; base?: string }) {
  const st = state(ctx);
  const f = frameOf(readFile(ctx, cwd, slug), asked);
  if (f.kind !== "drawn") throw new Error(`“${f.name}” is a live frame: change the app's own files instead.`);
  const abs = frameFile(cwd, slug, f);
  const raw = readFileSync(abs, "utf8");
  if (by.base !== undefined && revOf(raw) !== by.base) throw changedSince(f.name);
  const r = applyOps(raw, ops);
  const out = sizedHtml(r.html);
  const from = heardBefore(ctx, cwd, slug, f.id, abs, raw);
  writeOwn(st, abs, out);
  const at = Date.now();
  const rev = revOf(out);
  st.heard.set(abs, rev);
  ctx.emit({ type: "canvas.changed", cwd, file: slug, frame: f.id, by: by.by, ...(by.threadId ? { threadId: by.threadId } : {}), at, rev });
  return { at, rev, from, undo: r.undo as FrameOp[], ids: r.ids };
}

// The watcher.

/** The session working in this folder now, when there's one (or one drawing this frame). */
function runningIn(ctx: DesignCtx, cwd: string, slug: string, frame?: string) {
  const st = state(ctx);
  const here = ctx.store.threads.filter((t) => {
    if (t.status !== "running" && t.status !== "waiting") return false;
    try {
      return resolve(ctx.cwdOf(t.id)) === cwd;
    } catch {
      return false;
    }
  });
  if (here.length === 1) return here[0].id;
  const drawing = [...st.presence.values()].find((p) => p.cwd === cwd && p.file === slug && (!frame || p.frame === frame) && here.some((t) => t.id === p.threadId));
  return drawing?.threadId;
}

/** A change on disk in a watched design folder, once it settled: the engine's own writes are left be. */
function changedOnDisk(ctx: DesignCtx, cwd: string, slug: string, rel: string) {
  const st = state(ctx);
  const dir = designDir(cwd, slug);
  const abs = join(dir, rel);
  const at = Date.now();
  let content: Buffer | undefined;
  try {
    content = lstatSync(abs, { throwIfNoEntry: false })?.isFile() ? readFileSync(abs) : undefined;
  } catch {
    content = undefined;
  }
  if (!existsSync(dir)) return;
  // A frame's file gone, or back: told always, even when the bytes back are the engine's own last write.
  const frameFile = FRAME_FILE.test(rel);
  const was = st.there.get(abs);
  if (frameFile) st.there.set(abs, Boolean(content));
  const moved = frameFile && was !== undefined && was !== Boolean(content);
  if (!moved && content && st.own.get(abs) === hash(content)) return;
  if (rel === "design.json") {
    // design.json removed: the watch's own look says the design file went (canvas.changed with gone), not this.
    if (!content) return;
    ctx.emit({ type: "canvas.changed", cwd, file: slug, by: "agent", ...withThread(runningIn(ctx, cwd, slug)), at });
    return;
  }
  const m = FRAME_FILE.exec(rel);
  if (!m) {
    // A picture in assets/, or anything else of the design's: the whole file is drawn again.
    if (rel.startsWith("assets/")) ctx.emit({ type: "canvas.changed", cwd, file: slug, by: "agent", ...withThread(runningIn(ctx, cwd, slug)), at });
    return;
  }
  let frame: string | undefined;
  try {
    // A new file in frames/ goes on the canvas (readFile adopts it).
    frame = readFile(ctx, cwd, slug).frames.find((f) => f.path === rel)?.id ?? m[1];
  } catch {
    frame = m[1];
  }
  if (content) st.heard.set(abs, revOf(content));
  ctx.emit({ type: "canvas.changed", cwd, file: slug, frame, by: "agent", ...withThread(runningIn(ctx, cwd, slug, frame)), at, ...(content ? { rev: revOf(content) } : {}) });
}

const withThread = (threadId?: string) => (threadId ? { threadId } : {});

/** canvas.watch: while the canvas shows a design file, its folder is watched (counted, so two windows can). */
export function watchFile(ctx: DesignCtx, cwd: string, slug: string, on: boolean) {
  const st = state(ctx);
  attach(ctx);
  const dir = designDir(cwd, slug);
  const w: Watcher = st.watchers.get(dir) ?? { n: 0, timers: new Map(), cwd, file: slug };
  w.n = Math.max(0, w.n + (on ? 1 : -1));
  if (!w.n) {
    w.fw?.close();
    clearInterval(w.poll);
    for (const t of w.timers.values()) clearTimeout(t);
    st.watchers.delete(dir);
    return;
  }
  st.watchers.set(dir, w);
  // The design file itself going (its folder or design.json removed on disk) and coming back: told once per change, as
  // canvas.changed with `gone`, so the app can close its tab. Looked for once a second: a watch on a folder that's gone ends.
  const here = () => Boolean(lstatSync(dir, { throwIfNoEntry: false })?.isDirectory()) && existsSync(join(dir, "design.json"));
  if (w.present === undefined) w.present = here();
  w.poll ??= setInterval(() => {
    const now = here();
    if (now === w.present) return;
    w.present = now;
    ctx.emit({ type: "canvas.changed", cwd, file: slug, by: "agent", at: Date.now(), gone: !now });
    if (!now) {
      w.fw?.close();
      w.fw = undefined;
    } else if (!w.fw) listen(ctx, cwd, slug, dir, w);
  }, 1000);
  w.poll.unref?.();
  if (w.fw || !existsSync(dir)) return;
  listen(ctx, cwd, slug, dir, w);
}

/** The folder's own watch: each changed file, once it settled (changedOnDisk). */
function listen(ctx: DesignCtx, cwd: string, slug: string, dir: string, w: Watcher) {
  const st = state(ctx);
  // What's there now, so a file's going and coming back is told.
  try {
    for (const f of readFile(ctx, cwd, slug).frames) if (f.kind === "drawn") st.there.set(join(dir, framePath(f)), !f.missing);
  } catch {
    // an index that can't be read: its frames are told as they change
  }
  try {
    const fw = watch(dir, { recursive: true }, (_e, name) => {
      if (!name) return;
      const rel = name.toString().split(sep).join("/");
      clearTimeout(w.timers.get(rel));
      w.timers.set(
        rel,
        setTimeout(() => {
          w.timers.delete(rel);
          try {
            changedOnDisk(ctx, cwd, slug, rel);
          } catch (e) {
            console.error("[canvas]", e);
          }
        }, 250),
      );
    });
    fw.on("error", () => (fw.close(), (w.fw = undefined)));
    w.fw = fw;
  } catch {
    // Can't watch it: the canvas still draws what the editor and the tools write.
  }
}

// Presence: who's drawing which frame now, from the runtime's tool rows.

/** The design file and frame a path names, when it's a frame's file in this folder. */
function frameAt(ctx: DesignCtx, cwd: string, path: string): { file: string; frame: string } | undefined {
  if (!path || !path.includes(".liner")) return undefined;
  const abs = isAbsolute(path) ? path : resolve(cwd, path);
  const rel = relative(join(cwd, CANVAS_DIR), abs).split(sep).join("/");
  const m = /^([a-z0-9][a-z0-9-]{0,63})\/(frames\/[a-z0-9][a-z0-9-]{0,63}\.html)$/.exec(rel);
  if (!m) return undefined;
  try {
    const file = readFile(ctx, cwd, m[1]);
    return { file: m[1], frame: file.frames.find((f) => f.path === m[2])?.id ?? m[2].slice(7, -5) };
  } catch {
    return undefined;
  }
}

function presenceOn(ctx: DesignCtx, key: string, p: Omit<DesignPresence, "on">) {
  const st = state(ctx);
  const had = st.presence.get(key);
  if (had && had.frame === p.frame && had.file === p.file && had.label === p.label) return;
  if (had) presenceOff(ctx, key);
  const on = { ...p, on: true };
  st.presence.set(key, on);
  ctx.emit({ type: "canvas.presence", ...on });
}

function presenceOff(ctx: DesignCtx, key: string) {
  const st = state(ctx);
  const had = st.presence.get(key);
  if (!had) return;
  st.presence.delete(key);
  ctx.emit({ type: "canvas.presence", ...had, on: false });
}

const offAll = (ctx: DesignCtx, prefix: string) => {
  for (const k of [...state(ctx).presence.keys()]) if (k.startsWith(prefix)) presenceOff(ctx, k);
};

const writes = (kind: string) => kind === "edit" || kind === "write";

/** A tool row went by: a running edit of a frame's file puts its agent on that frame; its end takes it off. The sidekick's steps ride on its row. */
function onTool(ctx: DesignCtx, threadId: string, it: Extract<Item, { kind: "tool" }>) {
  const key = `${threadId}|${it.id}`;
  let cwd: string;
  try {
    cwd = resolve(ctx.cwdOf(threadId));
  } catch {
    return;
  }
  if (it.agent?.name === "Sidekick") {
    const live = it.status === "running" && (it.agent.state ?? "running") === "running";
    const want = new Map<string, { file: string; frame: string; label: string }>();
    if (live)
      for (const s of it.agent.steps ?? []) {
        if (s.status !== "running" || !s.path || !writes(s.toolKind)) continue;
        const at = frameAt(ctx, cwd, s.path);
        if (at) want.set(`${key}|${at.file}/${at.frame}`, { ...at, label: s.toolKind === "write" ? "Drawing" : "Editing" });
      }
    for (const k of [...state(ctx).presence.keys()]) if (k.startsWith(`${key}|`) && !want.has(k)) presenceOff(ctx, k);
    for (const [k, at] of want) presenceOn(ctx, k, { cwd, file: at.file, frame: at.frame, threadId, agent: "sidekick", name: ctx.whoIs(threadId, true), label: at.label });
    return;
  }
  if (it.status !== "running") return presenceOff(ctx, key);
  if (!it.path || !writes(it.toolKind)) return;
  const at = frameAt(ctx, cwd, it.path);
  if (at) presenceOn(ctx, key, { cwd, ...at, threadId, agent: "lead", name: ctx.whoIs(threadId), label: it.toolKind === "write" ? "Drawing" : "Editing" });
}

// Versions.

const versionsDir = (ctx: DesignCtx, threadId: string, slug: string) => {
  ctx.store.thread(threadId);
  return join(ctx.store.home, "designs", threadId, "canvas", slugOk(slug));
};

/** A kept copy's own record, beside it as <key>.json: "turn" copies are t<turn>, "before" copies (taken by a restore) b<time>. */
type VersionMeta = { turn: number; at: number; frames: number; digest: string; key: string; kind: "turn" | "before"; back?: number; backKind?: "turn" | "before" };
/** How many "before" copies a design file keeps in a session: the newest. */
const BEFORE_KEEP = 10;

type Sum = { size: number; mtime: number; sum: string };
/** What each file's hash was at its size and time, so a digest hashes only what changed. */
const sums = (ctx: DesignCtx) => ctx.keep("canvas.sums", () => new Map<string, Sum>());

/** A fingerprint of a design folder's files (links left out), hashing only files whose size or time changed since the last one. */
function digest(ctx: DesignCtx, dir: string) {
  const cache = sums(ctx);
  const h = createHash("sha1");
  const walk = (d: string, rel: string) => {
    for (const n of readdirSync(d).sort()) {
      const abs = join(d, n);
      const s = lstatSync(abs);
      if (s.isSymbolicLink()) continue;
      if (s.isDirectory()) walk(abs, `${rel}${n}/`);
      else if (s.isFile()) {
        let c = cache.get(abs);
        if (!c || c.size !== s.size || c.mtime !== s.mtimeMs) cache.set(abs, (c = { size: s.size, mtime: s.mtimeMs, sum: hash(readFileSync(abs)) }));
        h.update(`${rel}${n}\0${c.sum}\0`);
      }
    }
  };
  if (existsSync(dir)) walk(dir, "");
  return h.digest("hex");
}

/** The same fingerprint, off the engine's loop: each step awaits the disk, and a file is read and hashed in pieces. */
async function digestAsync(ctx: DesignCtx, dir: string) {
  const cache = sums(ctx);
  const h = createHash("sha1");
  const walk = async (d: string, rel: string) => {
    for (const n of (await readdir(d)).sort()) {
      const abs = join(d, n);
      const s = await lstat(abs);
      if (s.isSymbolicLink()) continue;
      if (s.isDirectory()) await walk(abs, `${rel}${n}/`);
      else if (s.isFile()) {
        let c = cache.get(abs);
        if (!c || c.size !== s.size || c.mtime !== s.mtimeMs) {
          const fh = createHash("sha1");
          for await (const chunk of createReadStream(abs, { highWaterMark: 1 << 20 })) fh.update(chunk as Buffer);
          cache.set(abs, (c = { size: s.size, mtime: s.mtimeMs, sum: fh.digest("hex") }));
        }
        h.update(`${rel}${n}\0${c.sum}\0`);
      }
    }
  };
  if (existsSync(dir)) await walk(dir, "");
  return h.digest("hex");
}

function kept(ctx: DesignCtx, threadId: string, slug: string): VersionMeta[] {
  const dir = versionsDir(ctx, threadId, slug);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .flatMap((n) => {
      const m = /^([tb][0-9-]+)\.json$/.exec(n);
      if (!m) return [];
      try {
        const raw = JSON.parse(readFileSync(join(dir, n), "utf8")) as Partial<VersionMeta>;
        const kind = m[1][0] === "b" ? "before" : "turn";
        const meta: VersionMeta = { turn: Number(raw.turn) || 0, at: Number(raw.at) || 0, frames: Number(raw.frames) || 0, digest: String(raw.digest ?? ""), key: m[1], kind, ...(kind === "before" && raw.back !== undefined ? { back: Number(raw.back) } : {}), ...(kind === "before" && (raw.backKind === "turn" || raw.backKind === "before") ? { backKind: raw.backKind } : {}) };
        return existsSync(join(dir, meta.key)) ? [meta] : [];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.at - b.at || a.turn - b.turn || (a.kind === b.kind ? 0 : a.kind === "turn" ? -1 : 1));
}

/** The newest "turn" copy: what a turn's end compares against. */
const lastTurn = (all: VersionMeta[]) => all.filter((v) => v.kind === "turn").sort((a, b) => a.turn - b.turn).at(-1);

/** A copy's record; `frames` counts what scrubbing back to it shows (versionRead): live frames, and drawn ones whose file the copy holds. */
const metaOf = (to: string, slug: string, m: Omit<VersionMeta, "frames">): VersionMeta => {
  let frames = 0;
  try {
    frames = normal(JSON.parse(readFileSync(join(to, "design.json"), "utf8")), slug).frames.filter((f) => f.kind === "live" || lstatSync(join(to, framePath(f)), { throwIfNoEntry: false })?.isFile()).length;
  } catch {
    // No index in it: none counted.
  }
  return { ...m, frames };
};

/** Copies a design folder as it is now as turn `turn`'s version of it, for this session (links left out). */
export function keepVersion(ctx: DesignCtx, threadId: string, cwd: string, slug: string, turn: number, sum?: string) {
  const dir = versionsDir(ctx, threadId, slug);
  const src = designDir(cwd, slug);
  const key = `t${turn}`;
  const to = join(dir, key);
  rmSync(to, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(src, to, { recursive: true, filter: (p) => !lstatSync(p).isSymbolicLink() });
  const meta = metaOf(to, slug, { turn, at: Date.now(), digest: sum ?? digest(ctx, src), key, kind: "turn" });
  writeFileSync(join(dir, `${key}.json`), JSON.stringify(meta));
  return meta;
}

/** The same, off the engine's loop (a turn's start and end). */
async function keepVersionAsync(ctx: DesignCtx, threadId: string, cwd: string, slug: string, turn: number, sum: string) {
  const dir = versionsDir(ctx, threadId, slug);
  const key = `t${turn}`;
  const to = join(dir, key);
  rmSync(to, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  await cp(designDir(cwd, slug), to, { recursive: true, filter: async (p) => !(await lstat(p)).isSymbolicLink() });
  const meta = metaOf(to, slug, { turn, at: Date.now(), digest: sum, key, kind: "turn" });
  writeFileSync(join(dir, `${key}.json`), JSON.stringify(meta));
  return meta;
}

/**
  Keeps what's there now as a copy of its own, before a restore puts turn `back` (or another copy)
  back: never in a turn's place, so no kept turn is lost. The newest 10 of these are kept.
*/
function keepBefore(ctx: DesignCtx, threadId: string, cwd: string, slug: string, back: number, backKind: "turn" | "before") {
  const dir = versionsDir(ctx, threadId, slug);
  const src = designDir(cwd, slug);
  let at = Date.now();
  while (existsSync(join(dir, `b${at}`)) || existsSync(join(dir, `b${at}.json`))) at++;
  const key = `b${at}`;
  const to = join(dir, key);
  mkdirSync(dir, { recursive: true });
  cpSync(src, to, { recursive: true, filter: (p) => !lstatSync(p).isSymbolicLink() });
  const meta = metaOf(to, slug, { turn: ctx.turnOf(threadId), at, digest: digest(ctx, src), key, kind: "before", back, backKind });
  writeFileSync(join(dir, `${key}.json`), JSON.stringify(meta));
  const befores = kept(ctx, threadId, slug).filter((v) => v.kind === "before");
  for (const v of befores.slice(0, Math.max(0, befores.length - BEFORE_KEEP))) {
    rmSync(join(dir, v.key), { recursive: true, force: true });
    rmSync(join(dir, `${v.key}.json`), { force: true });
  }
  return meta;
}

/** The design files of a folder that have an index, skipping any that is a link; none when .liner or .liner/designs is a link. */
const slugsIn = (cwd: string) => {
  let root: string;
  try {
    root = linkFree(cwd, CANVAS_DIR);
  } catch {
    return [];
  }
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((s) => SLUG.test(s) && lstatSync(join(root, s)).isDirectory() && existsSync(join(root, s, "design.json")));
};

/**
  A turn began: a design file this session has no copy of yet gets one as it was before (turn - 1),
  to scrub back to. Off the engine's loop; a folder with no .liner/designs costs one check.
*/
export async function turnStarted(ctx: DesignCtx, threadId: string, turn: number) {
  const cwd = resolve(ctx.cwdOf(threadId));
  for (const slug of slugsIn(cwd)) if (!kept(ctx, threadId, slug).length) await keepVersionAsync(ctx, threadId, cwd, slug, Math.max(0, turn - 1), await digestAsync(ctx, designDir(cwd, slug)));
}

/** A turn ended: each design file it changed (from the last turn's copy, by size and time first, then hashes) is kept as this turn's. */
export async function turnEnded(ctx: DesignCtx, threadId: string, turn: number) {
  const cwd = resolve(ctx.cwdOf(threadId));
  for (const slug of slugsIn(cwd)) {
    const sum = await digestAsync(ctx, designDir(cwd, slug));
    if (lastTurn(kept(ctx, threadId, slug))?.digest !== sum) await keepVersionAsync(ctx, threadId, cwd, slug, turn, sum);
  }
}

/** Waits for the turns' copies being taken now (tests, and before a restore reads the list). */
export function canvasIdle(ctx: DesignCtx) {
  return Promise.all([...queues(ctx).values()]).then(() => undefined);
}
const queues = (ctx: DesignCtx) => ctx.keep("canvas.queues", () => new Map<string, Promise<void>>());
/** Runs a session's turn work one after another, off the event that started it. */
function queue(ctx: DesignCtx, threadId: string, fn: () => Promise<void>) {
  const q = queues(ctx);
  const next = (q.get(threadId) ?? Promise.resolve()).then(fn).catch((e) => console.error("[canvas]", e));
  q.set(threadId, next);
  void next.then(() => {
    if (q.get(threadId) === next) q.delete(threadId);
  });
}

export function versions(ctx: DesignCtx, threadId: string, slug: string): CanvasVersion[] {
  return kept(ctx, threadId, slug).map(({ turn, at, frames, key, kind, back, backKind }) => ({ turn, at, frames, key, kind, ...(back !== undefined ? { back } : {}), ...(backKind ? { backKind } : {}) }));
}

/** A kept copy by its key ("t5", "b1731400000000"), else by its turn. */
function copyOf(ctx: DesignCtx, threadId: string, slug: string, which: { turn?: number; key?: string }) {
  const all = kept(ctx, threadId, slug);
  if (which.key !== undefined) {
    const v = all.find((x) => x.key === which.key);
    if (!v) throw new Error(`That copy of “${slug}” isn't kept.`);
    return v;
  }
  const turn = Number(which.turn);
  if (!Number.isInteger(turn) || turn < 0) throw new Error("That turn isn't kept.");
  const v = all.find((x) => x.kind === "turn" && x.turn === turn);
  if (!v) throw new Error(`Turn ${turn}'s copy of “${slug}” isn't kept.`);
  return v;
}

const which = (w: number | string | { turn?: number; key?: string }) => (typeof w === "number" ? { turn: w } : typeof w === "string" ? { key: w } : w);

/**
  A kept copy as it was, to be looked at (Versions.tsx scrubs the canvas back through them): its
  index and its drawn frames' HTML by id, read from the session's copy only, written nowhere.
*/
export function versionRead(ctx: DesignCtx, threadId: string, slug: string, w: number | string | { turn?: number; key?: string }): { file: DesignFile; html: Record<string, string> } {
  const s = slugOk(slug);
  const v = copyOf(ctx, threadId, s, which(w));
  const from = join(versionsDir(ctx, threadId, s), v.key);
  const name = v.kind === "turn" ? `Turn ${v.turn}'s copy` : "That copy";
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(inDesign(from, "design.json"), "utf8"));
  } catch {
    throw new Error(`${name} of “${s}” has no index to read.`);
  }
  const file = normal(raw, s);
  const html: Record<string, string> = {};
  for (const f of file.frames) {
    if (f.kind !== "drawn") continue;
    try {
      const abs = inDesign(from, framePath(f));
      if (!existsSync(abs) || statSync(abs).size > MAX_FRAME) continue;
      html[f.id] = stamp(readFileSync(abs, "utf8")).html;
    } catch {
      // a frame the copy doesn't hold, or one that leads out of it, is left out
    }
  }
  return { file: { ...file, frames: file.frames.filter((f) => f.kind === "live" || html[f.id] !== undefined) }, html };
}

/**
  Puts a kept copy (a turn's, by turn or key, or a "before" one, by key) back as the design file's
  files, as a change (canvas.changed, by you). What's there now is always kept first, as a "before"
  copy of its own, so it can come back too. design.json, frames/ and assets/ become the copy's:
  only regular files listed inside the real frames/ and assets/ are removed, one by one, and
  nothing is reached through a link.
*/
export function restore(ctx: DesignCtx, threadId: string, slug: string, w: number | string | { turn?: number; key?: string }): DesignFile {
  const st = state(ctx);
  const s = slugOk(slug);
  const v = copyOf(ctx, threadId, s, which(w));
  const cwd = resolve(ctx.cwdOf(threadId));
  const from = join(versionsDir(ctx, threadId, s), v.key);
  const dir = designDir(cwd, s);
  if (existsSync(dir)) keepBefore(ctx, threadId, cwd, s, v.turn, v.kind);
  for (const sub of ["frames", "assets"]) {
    const here = linkFree(dir, sub);
    if (!existsSync(here) || !lstatSync(here).isDirectory()) continue;
    for (const n of readdirSync(here)) {
      const abs = join(here, n);
      if (!lstatSync(abs).isFile()) continue;
      if (lstatSync(join(from, sub, n), { throwIfNoEntry: false })?.isFile()) continue;
      rmSync(abs);
      st.own.delete(abs);
    }
  }
  const put = (rel: string) => {
    const src = join(from, rel);
    const l = lstatSync(src, { throwIfNoEntry: false });
    if (!l || l.isSymbolicLink()) return;
    if (l.isDirectory()) {
      for (const n of readdirSync(src)) put(`${rel}/${n}`);
      return;
    }
    if (!l.isFile()) return;
    const to = inDesign(dir, rel);
    mkdirSync(dirname(to), { recursive: true });
    const buf = readFileSync(src);
    writeFileSync(to, buf);
    st.own.set(to, hash(buf));
  };
  for (const n of readdirSync(from)) put(n);
  const file = readFile(ctx, cwd, s);
  ctx.emit({ type: "canvas.changed", cwd, file: s, by: "you", threadId, at: Date.now() });
  return file;
}

// The engine's events: turns for versions, tool rows for presence.

/**
  Listens to the engine's events, once per ctx: a turn's start and end (versions), and tool rows
  that write a frame (presence). rpc() attaches it on its own; main.ts may call it too.
*/
export function attach(ctx: DesignCtx) {
  const st = state(ctx);
  if (st.off) return;
  st.off = ctx.store.on((e) => {
    try {
      if (e.type === "item" && e.item.kind === "turn") {
        const key = `${e.threadId}#${e.item.turn}`;
        const was = st.turns.get(key);
        if (e.item.status === "running" && !was) {
          st.turns.set(key, "running");
          const { threadId } = e;
          const turn = e.item.turn;
          queue(ctx, threadId, () => turnStarted(ctx, threadId, turn));
        } else if (e.item.status !== "running" && was !== "ended") {
          st.turns.set(key, "ended");
          offAll(ctx, `${e.threadId}|`);
          const { threadId } = e;
          const turn = e.item.turn;
          queue(ctx, threadId, () => turnEnded(ctx, threadId, turn));
        }
      } else if (e.type === "item" && e.item.kind === "tool") onTool(ctx, e.threadId, e.item);
      else if (e.type === "thread.removed") {
        offAll(ctx, `${e.id}|`);
        st.selection.delete(e.id);
      }
    } catch (err) {
      console.error("[canvas]", err);
    }
  });
  ctx.onClose(() => {
    st.off?.();
    st.off = undefined;
    for (const w of st.watchers.values()) {
      w.fw?.close();
      clearInterval(w.poll);
      for (const t of w.timers.values()) clearTimeout(t);
    }
    st.watchers.clear();
  });
}

export type CanvasMethod = "canvas.list" | "canvas.open" | "canvas.create" | "canvas.save" | "canvas.frame.add" | "canvas.frame.remove" | "canvas.frame.unremove" | "canvas.frame.apply" | "canvas.frame.copy" | "canvas.frame.read" | "canvas.frame.write" | "canvas.watch" | "canvas.versions" | "canvas.version.read" | "canvas.restore" | "canvas.selection";

/** Each drawn frame's revision, by id (a frame whose file can't be read has none). */
function revsOf(ctx: DesignCtx, cwd: string, file: DesignFile) {
  const st = state(ctx);
  const out: Record<string, string> = {};
  const dir = designDir(cwd, file.id);
  for (const f of file.frames) {
    if (f.kind !== "drawn") continue;
    try {
      const abs = inDesign(dir, framePath(f));
      if (existsSync(abs)) out[f.id] = heardRev(st, abs, readFileSync(abs));
    } catch {
      // a link or a file gone: no revision
    }
  }
  return out;
}

/** Where a design folder is served, for the frames' <base>. Empty when nothing serves files (tests). */
async function baseOf(ctx: DesignCtx, cwd: string, slug: string) {
  const root = await ctx.filesUrl(cwd);
  return root ? `${root}/${CANVAS_DIR}/${slug}` : "";
}

/** The canvas's RPC handlers, for api.ts. */
export function rpc(x: () => DesignCtx): DesignRpc<CanvasMethod> {
  // Versions and presence listen from the start, where the engine has a ctx (tests without one don't).
  queueMicrotask(() => {
    try {
      attach(x());
    } catch {
      // No Liner Design here.
    }
  });
  const c = () => {
    const ctx = x();
    attach(ctx);
    return ctx;
  };
  return {
    "canvas.list": ({ cwd }) => {
      const ctx = c();
      return listFiles(ctx, ctx.folder(cwd));
    },
    "canvas.open": async ({ cwd, file }) => {
      const ctx = c();
      const dir = ctx.folder(cwd);
      // Gone on disk: never made again from what's left of it, behind the person's back.
      const d = designDir(dir, slugOk(file));
      if (!lstatSync(d, { throwIfNoEntry: false })?.isDirectory() || (state(ctx).watchers.has(d) && !existsSync(join(d, "design.json")))) throw new Error(`“${slugOk(file)}” isn't there any more: its folder or its design.json was removed on disk.`);
      const f = readFile(ctx, dir, slugOk(file), { drop: true });
      state(ctx).opened.set(dir, f.id);
      return { file: f, base: await baseOf(ctx, dir, f.id), revs: revsOf(ctx, dir, f) };
    },
    "canvas.create": ({ cwd, title, size }) => {
      const ctx = c();
      const dir = ctx.folder(cwd);
      const f = createFile(ctx, dir, title, size);
      state(ctx).opened.set(dir, f.id);
      return f;
    },
    "canvas.save": ({ cwd, file, patch }) => {
      const ctx = c();
      return saveFile(ctx, ctx.folder(cwd), file, patch);
    },
    "canvas.frame.add": ({ cwd, file, frame, html }) => {
      const ctx = c();
      const r = addFrame(ctx, ctx.folder(cwd), file, frame, html);
      return { ...r.file, placed: r.placed };
    },
    "canvas.frame.remove": ({ cwd, file, frame }) => {
      const ctx = c();
      return removeFrame(ctx, ctx.folder(cwd), file, frame);
    },
    "canvas.frame.unremove": ({ cwd, file, frame }) => {
      const ctx = c();
      return unremoveFrame(ctx, ctx.folder(cwd), file, frame);
    },
    "canvas.frame.copy": ({ cwd, file, frame, x: at, y }) => {
      const ctx = c();
      return copyFrame(ctx, ctx.folder(cwd), file, frame, at, y);
    },
    "canvas.frame.read": ({ cwd, file, frame }) => {
      const ctx = c();
      const r = readFrameRev(ctx, ctx.folder(cwd), file, frame, { keep: true });
      return { html: r.html, rev: r.rev };
    },
    "canvas.frame.write": ({ cwd, file, frame, html, threadId, base }) => {
      const ctx = c();
      if (threadId) ctx.store.thread(threadId);
      const r = writeFrame(ctx, ctx.folder(cwd), file, frame, html, { by: "you", threadId, ...(base !== undefined ? { base: String(base) } : {}) });
      return { at: r.at, rev: r.rev, from: r.from };
    },
    "canvas.frame.apply": ({ cwd, file, frame, ops, base, threadId }) => {
      const ctx = c();
      if (threadId) ctx.store.thread(threadId);
      return applyFrame(ctx, ctx.folder(cwd), file, frame, ops, { by: "you", threadId, ...(base !== undefined ? { base: String(base) } : {}) });
    },
    "canvas.watch": ({ cwd, file, on }) => {
      const ctx = c();
      watchFile(ctx, ctx.folder(cwd), slugOk(file), Boolean(on));
      return null;
    },
    "canvas.versions": ({ threadId, file }) => versions(c(), threadId, file),
    "canvas.version.read": ({ threadId, file, turn, key }) => versionRead(c(), threadId, file, { turn, key }),
    "canvas.restore": async ({ threadId, file, turn, key }) => {
      const ctx = c();
      // A turn's copy still being taken lands first.
      await canvasIdle(ctx);
      return restore(ctx, threadId, file, { turn, key });
    },
    "canvas.selection": ({ threadId, sel }) => {
      const ctx = c();
      ctx.store.thread(threadId);
      state(ctx).selection.set(threadId, sel ?? null);
      return null;
    },
  };
}

// The tools.

const text = (t: string): McpResult => ({ content: [{ type: "text", text: t }] });

/** The design file a tool means: the one named, else the one the person has open, else the folder's only or newest; with make, a new one when there's none. */
export function designFor(ctx: DesignCtx, cwd: string, asked: unknown, make: boolean): string {
  const a = String(asked ?? "").trim();
  const files = listFiles(ctx, cwd);
  if (a) {
    const s = slugOf(a) === a ? a : (files.find((f) => f.title.toLowerCase() === a.toLowerCase())?.id ?? slugOf(a));
    if (files.some((f) => f.id === s)) return s;
    if (make) return createFile(ctx, cwd, a, undefined, s).id;
    throw new Error(`There's no design file “${a.slice(0, 60)}” here.${files.length ? ` The folder's: ${files.map((f) => f.id).join(", ")}.` : ""}`);
  }
  const open = state(ctx).opened.get(cwd);
  if (open && files.some((f) => f.id === open)) return open;
  const fine = files.filter((f) => !f.unreadable);
  if (fine.length) return fine[0].id;
  // Only broken ones: said, never a second file made beside them as if there were none.
  if (files.length) throw new Error(`${DESIGN_UNREADABLE} ${files[0].unreadable}`);
  if (make) return createFile(ctx, cwd, "Design").id;
  throw new Error("There's no design file in this folder yet. design_frame draws the first frame and makes one.");
}

const rel = (slug: string, f: DesignFrame) => `${CANVAS_DIR}/${slug}/${framePath(f)}`;

/** Where the lean is, as design_files says it: the design file's own, else the folder's DESIGN.md, else .liner/DESIGN.md, else a built-in one. */
function leanSaid(cwd: string, file: DesignFile) {
  if (file.lean.path) return file.lean.path;
  if (existsSync(join(cwd, "DESIGN.md"))) return "DESIGN.md";
  if (existsSync(join(cwd, ".liner", "DESIGN.md"))) return ".liner/DESIGN.md";
  return file.lean.builtin ? `the built-in “${file.lean.builtin}” (no file here)` : "none (it's optional: go by the loaded skills and your own judgement)";
}

function filesSaid(ctx: DesignCtx, cwd: string, only?: string) {
  const all = listFiles(ctx, cwd).filter((f) => !only || f.id === only);
  const broken = all.filter((f) => f.unreadable).map((f) => `“${f.id}” can't be read: ${f.unreadable}`);
  const files = all.filter((f) => !f.unreadable);
  if (broken.length && !files.length) return broken.join("\n\n");
  if (!files.length) return only ? `There's no design file “${only}” here.` : `There are no design files in this folder yet (${CANVAS_DIR}/). design_frame draws a frame and makes the first one.`;
  const open = state(ctx).opened.get(cwd);
  return files
    .map((info) => {
      const file = readFile(ctx, cwd, info.id);
      let skills: DesignSkill[] = [];
      let builds: FrameBuild[] = [];
      try {
        skills = canvasHooks.skills?.(cwd, info.id).filter((s) => s.loaded) ?? [];
        builds = canvasHooks.builds?.(cwd, info.id) ?? [];
      } catch {
        // What the lean or the links can't say now, design_files goes without.
      }
      const skillsSaid = skills.length ? skills.map((s) => `${s.name} (${s.path})`).join(", ") : file.lean.skills.join(", ") || "none";
      const frames = file.frames.map((f) => {
        const b = builds.find((x) => x.frame === f.id);
        const built = b && b.state !== "none" ? ` · built as ${b.file} (${b.state === "step" ? "in step" : b.state === "design-ahead" ? "the frame changed since" : "the code changed since"})` : f.built ? ` · built as ${f.built.file}` : "";
        const page = file.pages.length > 1 ? ` · page “${file.pages.find((p) => p.id === f.page)?.name}”` : "";
        return f.kind === "live" ? `- ${f.id} · “${f.name}” · ${f.w} × ${f.h} · live: ${f.url}${page}${built}` : `- ${f.id} · “${f.name}” · ${f.w} × ${f.h} · ${rel(file.id, f)}${f.missing ? " · its file is gone (moved or being saved): the frame stays, and is itself again when the file is back" : ""}${page}${built}`;
      });
      return [
        `“${file.title}” (design ${file.id}, ${CANVAS_DIR}/${file.id}/)${open === file.id ? " · the person has this one open" : ""}`,
        `Lean: ${leanSaid(cwd, file)} · skills: ${skillsSaid}`,
        frames.length ? `Frames:\n${frames.join("\n")}` : "No frames yet.",
      ].join("\n");
    })
    .concat(broken)
    .join("\n\n");
}

const treeSaid = (o: Outline, depth = 0): string[] => {
  const pad = "  ".repeat(depth);
  const name = o.name !== o.tag ? ` “${o.name}”` : "";
  const t = o.text ? ` · “${o.text.slice(0, 80)}”` : "";
  const kids = o.children.length ? ` · ${o.children.length} ${o.children.length === 1 ? "child" : "children"}` : "";
  return [`${pad}<${o.tag}>${o.id ? ` ${o.id}` : ""}${name} · ${o.kind}${t}${kids}`, ...o.children.flatMap((c) => treeSaid(c, depth + 1))];
};

/** A picture of a drawn frame at its size, from where its folder is served. */
async function look(at: DesignCall, cwd: string, slug: string, f: DesignFrame): Promise<McpResult> {
  // A live frame draws only a page on this Mac, whatever design.json says: never a file: address or another host.
  if (f.kind === "live" && !isLocal(f.url ?? "")) throw new Error(`“${f.name}” names ${String(f.url).slice(0, 80)}, which isn't a page on this Mac, so it isn't drawn.`);
  const root = f.kind === "live" ? "" : await at.filesUrl(cwd);
  const url = f.kind === "live" ? (/^https?:\/\//i.test(f.url ?? "") ? f.url! : `http://${f.url}`) : root ? `${root}/${rel(slug, f).split("/").map(encodeURIComponent).join("/")}` : "";
  if (!url) throw new Error("its folder isn't served");
  const shot = await at.shot(at.threadId, { url, width: f.w, height: f.h });
  const errors = shot.errors?.length ? `Console errors while it loaded:\n${shot.errors.slice(-10).join("\n")}` : "No console errors.";
  const tall = shot.height ? ` It is ${shot.height} px tall at ${f.w} px wide${shot.height > f.h ? ` (the frame is ${f.h} px: the rest scrolls)` : ""}.` : "";
  // A model that takes only text (an endpoint OpenCode runs as text-only) gets no picture: the outline says what's there in words. Read only, never written.
  let words = "";
  if (f.kind === "drawn") {
    try {
      const o = outline(readFileSync(inDesign(designDir(cwd, slug), framePath(f)), "utf8"));
      const lines = o ? treeSaid(o) : [];
      if (lines.length) words = `\n\nIf the picture doesn't reach you, this is what the frame holds, each element as <tag> data-l id “name” · kind · text · children${lines.length > 40 ? " (the first 40; design_tree has all of it)" : ""}:\n${lines.slice(0, 40).join("\n")}`;
    } catch {
      // no outline: the picture and the words above are all there is
    }
  }
  return { content: [{ type: "text", text: `The picture is how “${f.name}” draws.${tall} ${errors}${words}` }, { type: "image", data: shot.png, mimeType: "image/png" }] };
}

/** Says a write is the agent's, on its frame, while it runs (presence), and that it changed (canvas.changed). */
async function drawing<T>(at: DesignCall, cwd: string, slug: string, frame: string, label: string, fn: () => T) {
  const key = `${at.threadId}|mcp:${slug}/${frame}${at.sidekick ? AS_SIDEKICK : ""}`;
  presenceOn(at, key, { cwd, file: slug, frame, threadId: at.threadId, agent: at.sidekick ? "sidekick" : "lead", name: at.whoIs(at.threadId, at.sidekick), label });
  try {
    return fn();
  } finally {
    presenceOff(at, key);
  }
}

const noWrite = (at: DesignCall) => {
  if (at.readOnly(at.threadId)) throw new Error("This session is at Read only now (or it's a side chat), so it doesn't change frames. Say what to change instead.");
};

/** One of the canvas's tools (TOOLS), for agent-tools.ts. A thrown error comes back to the agent as its message. */
export async function call(name: string, args: Record<string, unknown>, at: DesignCall): Promise<McpResult> {
  attach(at);
  // A session that only reads: nothing in the call writes, whatever reaches the files (see quiet).
  return at.readOnly(at.threadId) ? quiet.run(true, () => act(name, args, at)) : act(name, args, at);
}

async function act(name: string, args: Record<string, unknown>, at: DesignCall): Promise<McpResult> {
  const cwd = resolve(at.cwdOf(at.threadId));
  const opt = (v: unknown) => (v === undefined || v === null || String(v).trim() === "" ? undefined : String(v).trim());
  switch (name) {
    case "design_files":
      return text(filesSaid(at, cwd, opt(args.design) ? designFor(at, cwd, args.design, false) : undefined));
    case "design_frame": {
      noWrite(at);
      const fname = words(args.name);
      if (!fname) throw new Error("Give the frame a name: “Phone / Today”.");
      const w = side(args.width, "width and height");
      const h = side(args.height, "width and height");
      let html = opt(args.html) === undefined ? undefined : String(args.html);
      const path = opt(args.path);
      if (html === undefined && !path) throw new Error("Pass the whole page as html, or the path of an HTML file in this folder.");
      if (html === undefined && path) {
        const r = relative(cwd, resolve(cwd, path.replace(/^file:\/\//i, "")));
        if (!r || r.startsWith("..") || isAbsolute(r)) throw new Error("path must be an HTML file inside this session's folder.");
        if (!/\.html?$/i.test(r)) throw new Error("path must be an HTML file: one that ends in .html.");
        const abs = join(cwd, r);
        const real = existsSync(abs) ? relative(realpathSync(cwd), realpathSync(abs)) : "";
        if (!existsSync(abs) || real.startsWith("..") || isAbsolute(real)) throw new Error(`There's no ${r} in this folder.`);
        if (statSync(abs).size > MAX_FRAME) throw new Error(`${r} is over 2 MB; keep a frame to one page.`);
        html = readFileSync(abs, "utf8");
      }
      const slug = designFor(at, cwd, args.design, true);
      const file = readFile(at, cwd, slug);
      const had = file.frames.find((f) => f.name.toLowerCase() === fname.toLowerCase() || f.id === fname);
      const by = { agent: at.sidekick ? "sidekick" : "lead", name: at.whoIs(at.threadId, at.sidekick) };
      let frame: DesignFrame;
      if (had && had.kind === "drawn") {
        frame = await drawing(at, cwd, slug, had.id, "Drawing", () => {
          writeFrame(at, cwd, slug, had.id, html!, { by: "agent", threadId: at.threadId });
          const screen = args.screen === false ? false : args.screen === true ? true : undefined;
          if (had.w !== w || had.h !== h || screen !== undefined) saveFile(at, cwd, slug, { frames: [{ id: had.id, w, h, ...(screen !== undefined ? { screen } : {}) }] });
          return { ...had, w, h };
        });
      } else {
        frame = addFrame(at, cwd, slug, { name: fname, w, h, by: { ...by, thread: at.threadId }, ...(args.screen === false ? { screen: false as const } : {}) }, sizedHtml(html!)).frame;
        at.emit({ type: "canvas.changed", cwd, file: slug, frame: frame.id, by: "agent", threadId: at.threadId, at: Date.now() });
      }
      const said = `${had ? "Replaced" : "Drew"} the frame “${frame.name}” (id ${frame.id}, ${frame.w} × ${frame.h}) in the design file ${slug}${had ? "" : `, placed at ${frame.x}, ${frame.y}${file.frames.some((f) => f.page === frame.page) ? " beside the others" : ""}`}. Its file is ${rel(slug, frame)}: to change a part, edit that file with your own tools or use design_node, keeping the data-l ids.`;
      try {
        const pic = await look(at, cwd, slug, frame);
        return { content: [{ type: "text", text: `${said}\n\n${(pic.content[0] as { text: string }).text} Look at it and fix what's off before you say it's done.` }, ...pic.content.slice(1)] };
      } catch (e) {
        return text(`${said}\n\n(No picture of it: ${e instanceof Error ? e.message : String(e)})`);
      }
    }
    case "design_tree": {
      const slug = designFor(at, cwd, args.design, false);
      const file = readFile(at, cwd, slug);
      const f = frameOf(file, args.frame);
      const o = outline(readFrameRev(at, cwd, slug, f.id, { keep: true }).html);
      if (!o) return text(`“${f.name}” has nothing in it yet.`);
      return text(`“${f.name}” (${rel(slug, f)}, ${f.w} × ${f.h}), each element as <tag> data-l id “name” · kind · text · children:\n\n${treeSaid(o).join("\n")}`);
    }
    case "design_node": {
      const slug = designFor(at, cwd, args.design, false);
      const file = readFile(at, cwd, slug);
      const f = frameOf(file, args.frame);
      const id = String(args.id ?? "").trim();
      if (!id) throw new Error("Say which element, as id: its data-l, from design_tree or design_selection.");
      const read = readFrameRev(at, cwd, slug, f.id, { keep: true });
      const html = read.html;
      if (args.html === undefined || args.html === null) {
        const doc = parse(html);
        const el = byId(doc, id);
        if (!el) throw new Error(`There's no element with data-l="${id}" in “${f.name}”. design_tree lists them.`);
        return text(outer(doc, el));
      }
      noWrite(at);
      if (!read.ok) throw new Error(`“${f.name}” can't take data-l ids without something else in it changing, so design_node can't change it; edit ${rel(slug, f)} with your own tools instead.`);
      const next = String(args.html);
      if (!next.trim()) throw new Error("The new html is empty. To take the element out, replace its parent without it.");
      const out = replaceNode(html, id, next);
      await drawing(at, cwd, slug, f.id, "Editing", () => writeFrame(at, cwd, slug, f.id, out, { by: "agent", threadId: at.threadId }));
      const doc = parse(out);
      const el = byId(doc, id);
      return text(`Changed ${id} in “${f.name}” (${rel(slug, f)}). It is now:\n\n${el ? outer(doc, el) : next}`);
    }
    case "design_selection": {
      const sel = state(at).selection.get(at.threadId);
      if (!sel || (!sel.frames.length && !sel.nodes.length)) return text("Nothing is selected on the canvas now.");
      const parts = [`In the design file ${sel.file}:`];
      if (sel.frames.length) parts.push(`Frames selected: ${sel.frames.join(", ")}`);
      for (const n of sel.nodes) parts.push(`Element ${n.id} in the frame ${n.frame}:\n${n.html.slice(0, 20000)}`);
      for (const p of sel.pending ?? []) parts.push(`Changes in the inspector not written to ${p.frame} yet:\n${JSON.stringify(p.ops)}`);
      return text(parts.join("\n\n"));
    }
    case "design_shot": {
      const slug = designFor(at, cwd, args.design, false);
      const f = frameOf(readFile(at, cwd, slug), args.frame);
      return await look(at, cwd, slug, f);
    }
    default:
      throw new Error(`Liner Code has no tool called ${name}.`);
  }
}

/** What a call to one of the canvas's tools does, in words, for its row on the timeline; undefined for a tool that isn't its own. */
export function titleOf(tool: string, input: Record<string, unknown>): string | undefined {
  const s = (v: unknown) => String(v ?? "").slice(0, 60);
  switch (tool) {
    case "design_files":
      return "Read the design files";
    case "design_frame":
      return `Draw the frame ${s(input.name) ? `“${s(input.name)}”` : ""}`.trim();
    case "design_tree":
      return `Read the outline of ${s(input.frame) || "a frame"}`;
    case "design_node":
      return input.html === undefined ? `Read ${s(input.id)} in ${s(input.frame)}` : `Change ${s(input.id)} in ${s(input.frame)}`;
    case "design_selection":
      return "Look at what's selected";
    case "design_shot":
      return `Look at ${s(input.frame) || "a frame"}`;
    default:
      return undefined;
  }
}

/** Adopts an old single-HTML design of a session's Design surface into a design file, as a frame at its size. */
export function adopt(ctx: DesignCtx, cwd: string, slug: string, threadId: string, design: string, version?: number) {
  return addFrame(ctx, cwd, slug, { name: "", w: 0, h: 0, adopt: { threadId, design, ...(version !== undefined ? { version } : {}) } }).file;
}

