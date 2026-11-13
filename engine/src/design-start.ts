/*
  Starting a design (design.new, design.all, design.attach, design.rename). A design begun with no
  project lives in a folder of its own, <designs home>/<slug>/, which is a project of kind "design":
  never Scratch, never one of the Code face's projects, no Git made for it. Its design file is where
  every design file is, .liner/designs/<slug>/, so the canvas, the lean, build links and pictures
  work on it unchanged with that folder as the cwd. No session is made here: the app creates one
  (thread.create with `design`) on the first ask, or when it first shows the design in Code.

  The designs home is ~/Liner Designs, or LINER_DESIGNS_HOME, or "Liner Designs" under the engine's
  home when that isn't the default one: a test or an isolated run never writes in the real home.

  design.attach ("Build in a project") moves a design on its own into a project the way a failure
  half way can't hurt it: its design folders are copied into the target (to a hidden staging folder
  first, checked file by file, then renamed into place), what the engine keeps by folder is copied
  to the new keys, then the records switch, and only then is the source taken away. Until the
  switch, an error undoes what was done and leaves the original as it was.
*/
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync as realpath, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import type { DesignSize, Project } from "../../contracts/src/index.ts";
import { DESIGNS_FOLDER, FRAME_SIZES, UNTITLED_DESIGN, type DesignFile, type DesignFileInfo } from "../../contracts/src/design.ts";
import { builtCopy } from "./buildlinks.ts";
import { addFrame, CANVAS_DIR, createFile, designDir, drawingIn, freeSlug, linkFree, listFiles, peekFile, readFile, saveFile, setOpened, type DesignCtx } from "./canvas.ts";
import { picturesPref, setPicturesPref } from "./design-prefs.ts";
import { keepOutOfGit } from "./designs.ts";
import { readLean, safePath } from "./lean.ts";
import { factsOf, fileOf as memoryFile, remember } from "./memory.ts";
import { uid, writeAtomic, type Store } from "./store.ts";

/**
  Where designs on their own go. LINER_DESIGNS_HOME first; else, when the engine's home isn't the
  default (~/.liner-code: a test, an isolated run, a second install), "Liner Designs" inside it;
  else ~/Liner Designs, where the person can open it in Finder.
*/
export function designsHome(storeHome: string, env: NodeJS.ProcessEnv = process.env): string {
  const own = env.LINER_DESIGNS_HOME?.trim();
  if (own) return resolve(own.replace(/^~(?=\/|$)/, homedir()));
  const home = resolve(storeHome);
  if (home !== resolve(join(homedir(), ".liner-code"))) return join(home, DESIGNS_FOLDER);
  return join(homedir(), DESIGNS_FOLDER);
}

/** What the four RPCs need from the engine besides the store and the canvas. */
export type StartHost = {
  store: Store;
  ctx: () => DesignCtx;
  env: NodeJS.ProcessEnv;
  /** A turn (or work held like one, or agents in the background) runs in this session now. */
  busy: (threadId: string) => boolean;
  /** Ends a session's open tool sessions, so its next turn opens them in its new folder. */
  closeThread: (threadId: string) => void;
  /** What a session started that lives in a folder (its terminals, its servers): stopped when that folder goes. */
  release: (threadId: string) => void;
  /** Takes a project away as project.remove does: its sessions and records; its folder stays. */
  removeProject?: (id: string) => Promise<unknown>;
  /** A folder made a project, as project.add does. */
  addProject: (abs: string) => Promise<Project>;
  /** Your add-ons, for ones kept to the design project. */
  addons?: { list(): { id: string; project?: string }[]; update(id: string, p: { project?: string | null }): unknown };
  /** Routines kept to the design project. */
  routines?: { routines: { id: string; projectId: string }[]; put(r: { id: string; projectId: string }): unknown };
};

const words = (v: unknown, max = 120) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const SIZES = new Set<string>([...Object.keys(FRAME_SIZES), "desktop+phone"]);

/** A design file with the frames asked for: one empty frame of the size, both for "desktop+phone". */
function makeFile(ctx: DesignCtx, cwd: string, title: string, size: DesignSize | "desktop+phone" | undefined, slug?: string): DesignFile {
  if (size !== undefined && !SIZES.has(size)) throw new Error("The size is desktop, tablet, phone or desktop+phone.");
  if (size !== "desktop+phone") return createFile(ctx, cwd, title, size, slug);
  const file = createFile(ctx, cwd, title, "desktop", slug);
  return addFrame(ctx, cwd, file.id, { name: "Phone", ...FRAME_SIZES.phone }).file;
}

/** A design project's own design file: the one named like its folder, else its newest. */
function mainFile(ctx: DesignCtx, p: Project, files = listFiles(ctx, p.path)): DesignFileInfo | undefined {
  return files.find((f) => f.id === basename(p.path)) ?? files.find((f) => !f.unreadable) ?? files[0];
}

/** design.new: a design file in a project, or a design on its own in a folder and project of its own. */
export function newDesign(h: StartHost, a: { title?: string; size?: DesignSize | "desktop+phone"; projectId?: string }): { project: Project; file: DesignFile } {
  const { store } = h;
  const ctx = h.ctx();
  const title = words(a.title) || UNTITLED_DESIGN;
  if (a.projectId) {
    const project = store.project(a.projectId);
    const cwd = ctx.folder(project.path);
    const file = makeFile(ctx, cwd, title, a.size);
    setOpened(ctx, cwd, file.id);
    return { project, file };
  }
  if (a.size !== undefined && !SIZES.has(a.size)) throw new Error("The size is desktop, tablet, phone or desktop+phone.");
  const home = designsHome(store.home, h.env);
  mkdirSync(home, { recursive: true });
  const taken = (s: string) => Boolean(lstatSync(join(home, s), { throwIfNoEntry: false })) || store.projects.some((p) => resolve(p.path) === join(home, s));
  const slug = freeSlug(title, taken);
  const dir = join(home, slug);
  // Made here, not found: a folder that came meanwhile is never taken over.
  mkdirSync(dir);
  let project: Project | undefined;
  try {
    project = store.putProject({ id: uid("pr"), name: title, path: dir, git: false, kind: "design", createdAt: Date.now() });
    const file = makeFile(ctx, dir, title, a.size, slug);
    setOpened(ctx, dir, file.id);
    // What it holds as made, for design.discard to know an untouched one by.
    fresh(store.home, dir, inventory(dir));
    return { project, file };
  } catch (e) {
    if (project) store.removeProject(project.id);
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

/** design.all: designs on their own first (always), then each project that has design files; newest first inside each. */
export function allDesigns(h: StartHost): { project: Project; files: DesignFileInfo[] }[] {
  const ctx = h.ctx();
  const out: { project: Project; files: DesignFileInfo[]; at: number }[] = [];
  for (const project of h.store.projects) {
    let files: DesignFileInfo[] = [];
    try {
      if (existsSync(project.path)) files = listFiles(ctx, project.path);
    } catch {
      // .liner or .liner/designs is a link: no design files there to list.
    }
    if (project.kind === "design" || files.length) out.push({ project, files, at: Math.max(project.createdAt, ...files.map((f) => f.updated)) });
  }
  const rank = (p: Project) => (p.kind === "design" ? 0 : 1);
  return out.sort((a, b) => rank(a.project) - rank(b.project) || b.at - a.at).map(({ project, files }) => ({ project, files }));
}

/** design.rename: the design file's title; a design on its own's project takes it as its name too (its folder keeps its name). */
export function renameDesign(h: StartHost, a: { projectId: string; file: string; title: string }): { project: Project; file: DesignFile } {
  const ctx = h.ctx();
  const project = h.store.project(a.projectId);
  const title = words(a.title);
  if (!title) throw new Error("A design needs a name.");
  const cwd = ctx.folder(project.path);
  const file = saveFile(ctx, cwd, a.file, { title });
  if (project.kind !== "design" || mainFile(ctx, project)?.id !== file.id || project.name === file.title) return { project, file };
  return { project: h.store.putProject({ ...project, name: file.title }), file };
}

// Build in a project.

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);
/** Where canvas.ts keeps a design file's removed frames and broken indexes, and buildlinks.ts its built copies: by folder and slug. */
const trashOf = (home: string, cwd: string, slug: string) => join(home, "canvas-trash", sha1(resolve(cwd)), slug);
const brokenOf = (home: string, cwd: string, slug: string) => join(home, "designs", "canvas-broken", sha1(resolve(cwd)), slug);
const builtOf = (home: string, cwd: string, slug: string) => dirname(builtCopy(home, cwd, slug, "x"));
const versionsOf = (home: string, threadId: string, slug: string) => join(home, "designs", threadId, "canvas", slug);

/** Each regular file under a folder (links left out, as every copy of a design leaves them), by its path from there, with its hash. */
function filesOf(dir: string, rel = "", out = new Map<string, string>()) {
  for (const n of readdirSync(join(dir, rel)).sort()) {
    const r = rel ? `${rel}/${n}` : n;
    const s = lstatSync(join(dir, r));
    if (s.isSymbolicLink()) continue;
    if (s.isDirectory()) filesOf(dir, r, out);
    else if (s.isFile()) out.set(r, createHash("sha256").update(readFileSync(join(dir, r))).digest("hex"));
  }
  return out;
}

/** Copies a folder (links left out), then checks the copy holds the same files with the same bytes. */
function copyChecked(from: string, to: string) {
  cpSync(from, to, { recursive: true, filter: (p) => !lstatSync(p).isSymbolicLink() });
  const a = filesOf(from);
  const b = filesOf(to);
  if (a.size !== b.size || [...a].some(([k, v]) => b.get(k) !== v)) throw new Error(`The copy of ${basename(from)} didn't come out the same.`);
}

/** Nothing in the folder but folders and Finder's .DS_Store: what's left of a design on its own once its design moved. */
function emptyish(dir: string): boolean {
  for (const n of readdirSync(dir)) {
    const abs = join(dir, n);
    const s = lstatSync(abs);
    if (s.isDirectory() && !s.isSymbolicLink()) {
      if (!emptyish(abs)) return false;
    } else if (n !== ".DS_Store") return false;
  }
  return true;
}

/** Files of its own a folder holds (for the sentence that says why it stays), a few by name. */
function ownFiles(dir: string, rel = "", out: string[] = []): string[] {
  for (const n of readdirSync(join(dir, rel))) {
    if (out.length > 4) break;
    const r = rel ? `${rel}/${n}` : n;
    const s = lstatSync(join(dir, r));
    if (s.isDirectory() && !s.isSymbolicLink()) ownFiles(dir, r, out);
    else if (n !== ".DS_Store") out.push(r);
  }
  return out;
}

/**
  design.attach. Refused, nothing changed, while a turn runs in the design, when the target is a
  design project (or inside the design's own folder), or when the move can't complete.
*/
export async function attachDesign(h: StartHost, a: { projectId: string; to: { projectId: string } | { path: string } }): Promise<{ project: Project; file: DesignFile; moved: string[]; left?: string }> {
  const { store } = h;
  const ctx = h.ctx();
  const home = store.home;
  const source = store.project(a.projectId);
  if (source.kind !== "design") throw new Error("Only a design on its own can be built in a project; this one is in a project already.");
  const src = resolve(source.path);
  const sessions = () => store.threads.filter((t) => t.projectId === source.id);
  const running = () => sessions().find((t) => h.busy(t.id) || (t.agentsAtWork ?? 0) > 0);
  const busyNow = running();
  if (busyNow) throw new Error(`An agent is working in this design now (“${busyNow.title}”). Wait for it to finish, or stop it, then build it in a project.`);

  // The target: a project you have, or a folder that becomes one as Add a project does.
  let target: Project;
  let made = false;
  if ("projectId" in a.to) {
    target = store.project(a.to.projectId);
  } else {
    const abs = resolve(String(a.to.path ?? "").replace(/^~(?=\/|$)/, homedir()));
    const r = relative(src, abs);
    if (!r || !r.startsWith("..")) throw new Error("That folder is this design's own. Pick a project, or a folder outside it.");
    if (abs === resolve(designsHome(home, h.env))) throw new Error("That's the folder designs on their own are kept in. Pick a project, or another folder.");
    const had = store.projects.find((p) => resolve(p.path) === abs);
    if (had) target = had;
    else {
      target = await h.addProject(abs);
      made = true;
    }
  }
  const dropMade = () => {
    if (made && !sessions().length && store.projects.some((p) => p.id === target.id)) store.removeProject(target.id);
  };
  try {
    if (target.kind === "design") throw new Error("That's a design on its own too. Pick a project to build it in.");
    if (target.id === source.id) throw new Error("That's this design itself. Pick a project to build it in.");
    if (!existsSync(target.path) || !statSync(target.path).isDirectory()) throw new Error(`${target.path} isn't there any more, so the design can't go into it.`);
    // A turn that began while the folder was being made a project: the same refusal.
    const late = running();
    if (late) throw new Error(`An agent is working in this design now (“${late.title}”). Wait for it to finish, or stop it, then build it in a project.`);
  } catch (e) {
    dropMade();
    throw e;
  }
  const dst = resolve(target.path);

  // From here to the end, nothing awaits: no turn can start in between. Each step is on disk before the next, and a journal
  // (<home>/attach/<id>.json) says what's moving, so an engine killed at any instant is put right on its next start (recoverAttaches):
  // before the switch is saved the move is taken back, after it the source's removal is finished.
  recoverAttaches(h);
  // What was waiting to be saved is on disk first, so the journal and state.json speak of the same projects.
  store.flush();
  const id = uid("at");
  const staging = join(dst, CANVAS_DIR, `.attach-${id}`);
  const j: Journal = { id, source: { id: source.id, path: src }, target: { id: target.id, path: dst }, slugs: [], threads: sessions().map((t) => t.id), made, prefs: [], versions: [], at: Date.now() };
  let mainId = "";
  try {
    // Nothing reached through a link, on either side (canvas.ts linkFree).
    const from = linkFree(src, CANVAS_DIR);
    const into = linkFree(dst, CANVAS_DIR);
    const files = existsSync(from) ? listFiles(ctx, src) : [];
    const main = mainFile(ctx, source, files);
    if (!main) throw new Error("This design has no design file to move.");
    mainId = main.id;
    if (files.some((f) => f.unreadable)) throw new Error(`“${files.find((f) => f.unreadable)!.id}” can't be read now, so nothing was moved. Fix its design.json, or bring it back from Versions, then try again.`);
    const slugs = new Map<string, string>();
    for (const f of files) slugs.set(f.id, freeSlug(f.id, (x) => Boolean(lstatSync(join(into, x), { throwIfNoEntry: false })) || [...slugs.values()].includes(x)));
    j.slugs = [...slugs];

    // 1. The design folders, copied to a hidden folder of the target's .liner/designs/ and checked.
    mkdirSync(staging, { recursive: true });
    for (const [old, next] of slugs) copyChecked(linkFree(src, `${CANVAS_DIR}/${old}`), join(staging, next));
    // The design's own lean, when it has one in its folder, goes with it, beside its design.json.
    try {
      const lean = readLean(src, readFile(ctx, src, main.id));
      if (lean.path && (lean.off === "root" || lean.off === "liner") && !lean.path.startsWith(`${CANVAS_DIR}/`)) {
        const abs = safePath(src, join(src, lean.path));
        if (lstatSync(abs, { throwIfNoEntry: false })?.isFile()) {
          writeFileSync(join(staging, slugs.get(main.id)!, "DESIGN.md"), readFileSync(abs));
          j.lean = abs;
        }
      }
    } catch {
      // A lean that leads out of the folder isn't carried.
    }
    // Each index names its new slug, and the carried lean by its new place.
    for (const [old, next] of slugs) {
      const index = join(staging, next, "design.json");
      if (!existsSync(index)) continue;
      const raw = JSON.parse(readFileSync(index, "utf8")) as Record<string, unknown>;
      raw.id = next;
      if (old === main.id && j.lean) raw.lean = { ...((raw.lean as object) ?? {}), path: `${CANVAS_DIR}/${next}/DESIGN.md`, builtin: undefined };
      else if (raw.lean && typeof raw.lean === "object" && (raw.lean as { path?: string }).path) {
        // A lean path into its own old folder follows it; any other path is the target's file of that name now.
        const p = String((raw.lean as { path?: string }).path);
        if (p.startsWith(`${CANVAS_DIR}/${old}/`)) raw.lean = { ...(raw.lean as object), path: `${CANVAS_DIR}/${next}/${p.slice(`${CANVAS_DIR}/${old}/`.length)}` };
      }
      writeFileSync(index, `${JSON.stringify(raw, null, 2)}\n`);
    }
    crash("staged");
    // The journal, before anything lands where it's used.
    writeJournal(home, j);

    // 2. What the engine keeps by folder and slug, and each session's kept versions, copied to the new keys (the old go after the switch).
    const copyStore = (a: string, b: string) => {
      if (!existsSync(a) || existsSync(b)) return;
      mkdirSync(dirname(b), { recursive: true });
      cpSync(a, b, { recursive: true });
    };
    for (const [old, next] of slugs) {
      copyStore(builtOf(home, src, old), builtOf(home, dst, next));
      copyStore(trashOf(home, src, old), trashOf(home, dst, next));
      copyStore(brokenOf(home, src, old), brokenOf(home, dst, next));
      const pref = picturesPref(home, src, old);
      if (pref && !picturesPref(home, dst, next)) {
        j.prefs.push(next);
        writeJournal(home, j);
        setPicturesPref(home, dst, next, pref);
      }
    }
    for (const t of j.threads)
      for (const [old, next] of slugs) {
        if (old === next || !existsSync(versionsOf(home, t, old)) || existsSync(versionsOf(home, t, next))) continue;
        j.versions.push([t, next]);
        writeJournal(home, j);
        cpSync(versionsOf(home, t, old), versionsOf(home, t, next), { recursive: true });
      }

    // 3. Into place: each staged folder renamed to its slug (same disk, all or nothing each).
    for (const next of slugs.values()) {
      const to = join(into, next);
      if (lstatSync(to, { throwIfNoEntry: false })) throw new Error(`A design file “${next}” came into ${target.name} meanwhile, so nothing was moved.`);
      renameSync(join(staging, next), to);
    }
    rmSync(staging, { recursive: true, force: true });
    crash("renamed");
  } catch (e) {
    if (e === CRASH) throw e;
    rollback(h, j);
    rmSync(staging, { recursive: true, force: true });
    rmSync(journalOf(home, id), { force: true });
    dropMade();
    throw new Error(`The design couldn't move into ${target.name}, so nothing changed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 4. The switch: every session of the design is the target's now, and the design project goes, both in one save. Each
  // session's tool kept its conversation by the old folder, so its next turn starts from the conversation as text (runtime:
  // a fresh session hands it over), as a switch of tool does.
  const slugs = new Map(j.slugs);
  const mainSlug = slugs.get(mainId)!;
  for (const t of sessions()) {
    const { providerSession: _p, sessions: _s, cacheUntil: _c, ...rest } = t;
    store.putThread({ ...rest, projectId: target.id, design: { file: slugs.get(t.design?.file ?? "") ?? mainSlug }, ...(t.forkSession !== undefined ? { forkSession: "" } : {}) });
    h.closeThread(t.id);
  }
  store.removeProject(source.id);
  crash("switched");
  // On disk now, not in 120 ms: only once the switch is saved does anything of the source go.
  store.flush();
  crash("saved");

  // 5. The source goes (finish): its old keys and versions, its design folders, the lean that went along, the folder once
  // nothing of its own is left; its memory, add-ons and routines move.
  const left = finish(h, j);
  const file = readFile(ctx, dst, mainSlug);
  setOpened(ctx, dst, mainSlug);
  // The target's drafts stay out of its Git, as a design made there would.
  void keepOutOfGit(dst);
  return { project: store.project(target.id), file, moved: j.threads, ...(left ? { left } : {}) };
}

/** What a move is doing, on disk while it runs: what recoverAttaches reads after a crash. */
type Journal = {
  id: string;
  source: { id: string; path: string };
  target: { id: string; path: string };
  /** Each design file's slug in the source, and in the target. */
  slugs: [string, string][];
  /** The sessions that move. */
  threads: string[];
  /** The source's lean file carried into the design's folder. */
  lean?: string;
  /** The target was made a project by this move. */
  made: boolean;
  /** Picture settings set under the target's keys, by new slug. */
  prefs: string[];
  /** Kept versions copied to a new slug, by session. */
  versions: [string, string][];
  at: number;
};
const journals = (home: string) => join(home, "attach");
const journalOf = (home: string, id: string) => join(journals(home), `${id}.json`);
function writeJournal(home: string, j: Journal) {
  mkdirSync(journals(home), { recursive: true });
  writeAtomic(journalOf(home, j.id), JSON.stringify(j, null, 2));
}

/** A crash, for tests: thrown at the named step of design.attach, past every undo, as a killed engine would stop. */
export const CRASH = new Error("design.attach: a crash, for a test");
export const attachCrash: { at?: "staged" | "renamed" | "switched" | "saved" } = {};
const crash = (step: NonNullable<(typeof attachCrash)["at"]>) => {
  if (attachCrash.at === step) throw CRASH;
};

const quietly = (fn: () => void) => {
  try {
    fn();
  } catch (e) {
    console.error("[design.attach] clean-up", e);
  }
};

/** A move taken back before its switch was saved: what landed in the target and under its keys goes; the source was never touched. */
function rollback(h: StartHost, j: Journal) {
  const home = h.store.home;
  const dst = j.target.path;
  for (const [, next] of j.slugs) {
    quietly(() => rmSync(linkFree(dst, `${CANVAS_DIR}/${next}`), { recursive: true, force: true }));
    quietly(() => rmSync(builtOf(home, dst, next), { recursive: true, force: true }));
    quietly(() => rmSync(trashOf(home, dst, next), { recursive: true, force: true }));
    quietly(() => rmSync(brokenOf(home, dst, next), { recursive: true, force: true }));
  }
  for (const next of j.prefs) quietly(() => setPicturesPref(home, dst, next, undefined));
  for (const [t, next] of j.versions) quietly(() => rmSync(versionsOf(home, t, next), { recursive: true, force: true }));
  if (j.made && !h.store.threads.some((t) => t.projectId === j.target.id) && h.store.projects.some((p) => p.id === j.target.id)) h.store.removeProject(j.target.id);
}

/**
  A move finished once its switch is saved: the source's design folders, carried lean, old keys and
  versions go; its memory, add-ons and routines move; its folder goes once nothing of its own is
  left. Says what stays: the folder, and build links that point at files left behind in it.
*/
function finish(h: StartHost, j: Journal): string | undefined {
  const home = h.store.home;
  const src = j.source.path;
  const dst = j.target.path;
  const slugs = new Map(j.slugs);
  // Build links into the design's own folder: their files stay there (they're the person's), so say which point nowhere now.
  const stale: string[] = [];
  for (const [old, next] of slugs) {
    const f = peekFile(dst, next);
    for (const fr of f?.frames ?? []) if (fr.built?.file && !existsSync(join(dst, fr.built.file))) stale.push(`${fr.name} → ${fr.built.file}${existsSync(join(src, fr.built.file)) ? " (still in the old folder)" : ""}`);
    quietly(() => rmSync(builtOf(home, src, old), { recursive: true, force: true }));
    quietly(() => rmSync(trashOf(home, src, old), { recursive: true, force: true }));
    quietly(() => rmSync(brokenOf(home, src, old), { recursive: true, force: true }));
    quietly(() => setPicturesPref(home, src, old, undefined));
    quietly(() => rmSync(linkFree(src, `${CANVAS_DIR}/${old}`), { recursive: true, force: true }));
    if (old !== next) for (const t of j.threads) quietly(() => existsSync(versionsOf(home, t, next)) && rmSync(versionsOf(home, t, old), { recursive: true, force: true }));
  }
  if (j.lean) quietly(() => rmSync(j.lean!, { force: true }));
  quietly(() => {
    for (const fact of factsOf(home, j.source.id)) remember(home, j.target.id, fact);
    rmSync(memoryFile(home, j.source.id), { force: true });
  });
  quietly(() => {
    for (const x of h.addons?.list() ?? []) if (x.project === j.source.id) h.addons!.update(x.id, { project: j.target.id });
    for (const r of h.routines?.routines ?? []) if (r.projectId === j.source.id) h.routines!.put({ ...r, projectId: j.target.id });
  });
  const said: string[] = [];
  if (existsSync(src)) {
    if (emptyish(src)) {
      for (const id of j.threads) quietly(() => h.release(id));
      quietly(() => rmSync(src, { recursive: true, force: true }));
    } else {
      const own = ownFiles(src);
      said.push(`${src} stays, as it holds files of its own (${own.slice(0, 4).join(", ")}${own.length > 4 ? ", …" : ""}); the design itself is in ${h.store.projects.find((p) => p.id === j.target.id)?.name ?? dst} now.`);
    }
  }
  if (stale.length) said.push(`${stale.length === 1 ? "This build link points" : "These build links point"} at a file that isn't in the project: ${stale.slice(0, 6).join("; ")}${stale.length > 6 ? "; …" : ""}. Build ${stale.length === 1 ? "that frame" : "those frames"} again here, or tie ${stale.length === 1 ? "it" : "them"} to a file of the project.`);
  rmSync(journalOf(home, j.id), { force: true });
  return said.length ? said.join(" ") : undefined;
}

/** Hidden folders a move or a put-back stages in (.attach-at_…, .unremove-ur_…): only names the engine itself gives. */
const STAGED = /^\.(?:attach-at|unremove-ur)_[a-z0-9]+$/;

/**
  On the engine's start and before each move: moves a crash cut short are put right from their
  journals (before the switch was saved, taken back, so the source wins; after, finished), then
  staging folders left in projects' .liner/designs/ go. Never through a link.
*/
export function recoverAttaches(h: StartHost) {
  const home = h.store.home;
  let names: string[] = [];
  try {
    names = existsSync(journals(home)) ? readdirSync(journals(home)).filter((n) => n.endsWith(".json")) : [];
  } catch {
    names = [];
  }
  // A journal cut short as it was written: only its temp file is there, and nothing landed before the journal was whole.
  try {
    if (existsSync(journals(home))) for (const n of readdirSync(journals(home))) if (n.endsWith(".tmp")) rmSync(join(journals(home), n), { force: true });
  } catch {
    // a folder that can't be read: nothing to clear
  }
  for (const n of names) {
    let j: Journal;
    try {
      j = JSON.parse(readFileSync(join(journals(home), n), "utf8")) as Journal;
    } catch {
      quietly(() => rmSync(join(journals(home), n), { force: true }));
      continue;
    }
    // The switch and the design project's removal are saved together: the project still there means the switch never landed.
    if (h.store.projects.some((p) => p.id === j.source.id)) {
      rollback(h, j);
      rmSync(journalOf(home, j.id), { force: true });
    } else finish(h, j);
  }
  if (names.length) h.store.flush();
  for (const p of h.store.projects) {
    let root: string;
    try {
      root = linkFree(p.path, CANVAS_DIR);
      if (!existsSync(root)) continue;
      for (const n of readdirSync(root)) {
        const abs = join(root, n);
        if (STAGED.test(n) && lstatSync(abs).isDirectory()) rmSync(abs, { recursive: true, force: true });
      }
    } catch {
      // A .liner or .liner/designs that is a link, or a folder gone: nothing there is touched.
    }
  }
}

// Removing one design file, and putting it back.

/** Where a removed design file waits, under Liner Code's home beside its removed frames (canvas-trash), by folder and slug: its folder, build copies and picture setting. One per slug, the newest. */
const fileTrash = (home: string, cwd: string, slug: string) => join(home, "canvas-trash", sha1(resolve(cwd)), ".files", slug);

/** Who draws in a design file now: an agent's presence on it, or a session working there that was begun from it. */
function drawer(h: StartHost, ctx: DesignCtx, project: Project, cwd: string, slug: string) {
  const id = drawingIn(ctx, cwd, slug) ?? h.store.threads.find((t) => t.projectId === project.id && (h.busy(t.id) || (t.agentsAtWork ?? 0) > 0) && (project.kind === "design" || t.design?.file === slug))?.id;
  return id ? h.store.threads.find((t) => t.id === id) : undefined;
}

/**
  design.remove. In a project: the design file's folder (checked as it's copied), its build copies
  and its picture setting go to the trash, then from the folder and the engine's keys. A design on
  its own: its project goes as project.remove takes one, the folder left on disk. Refused while an
  agent draws in it; nothing is reached through a link.
*/
export async function removeDesignFile(h: StartHost, a: { projectId: string; file: string }): Promise<{ ok: true }> {
  const { store } = h;
  const ctx = h.ctx();
  const project = store.project(a.projectId);
  const cwd = resolve(ctx.folder(project.path));
  const dir = designDir(cwd, a.file);
  const slug = basename(dir);
  if (!lstatSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`There's no design file “${slug}” in ${project.name}.`);
  const busy = drawer(h, ctx, project, cwd, slug);
  if (busy) throw new Error(`An agent is drawing in this design now (“${busy.title}”). Wait for it to finish, or stop it, then remove it.`);
  if (project.kind === "design") {
    if (!h.removeProject) throw new Error("Removing a design on its own isn't available here.");
    await h.removeProject(project.id);
    return { ok: true };
  }
  const home = store.home;
  const into = fileTrash(home, cwd, slug);
  const next = `${into}.${uid("rm")}`;
  try {
    mkdirSync(next, { recursive: true });
    copyChecked(dir, join(next, "design"));
    const built = builtOf(home, cwd, slug);
    if (existsSync(built)) cpSync(built, join(next, "built"), { recursive: true });
    const pref = picturesPref(home, cwd, slug);
    writeFileSync(join(next, "entry.json"), JSON.stringify({ at: Date.now(), slug, ...(pref ? { pictures: pref } : {}) }));
    rmSync(into, { recursive: true, force: true });
    renameSync(next, into);
  } catch (e) {
    rmSync(next, { recursive: true, force: true });
    throw new Error(`“${slug}” couldn't be kept in the trash, so it wasn't removed: ${e instanceof Error ? e.message : String(e)}`);
  }
  // Kept: now it goes, with its build links' copies and its picture setting.
  rmSync(dir, { recursive: true, force: true });
  rmSync(builtOf(home, cwd, slug), { recursive: true, force: true });
  setPicturesPref(home, cwd, slug, undefined);
  ctx.emit({ type: "canvas.changed", cwd, file: slug, by: "you", at: Date.now() });
  return { ok: true };
}

/** design.unremove: the design file removed last with this slug, back as it was (its frames, links, build copies and picture setting). */
export function unremoveDesignFile(h: StartHost, a: { projectId: string; file: string }): { project: Project; file: DesignFile } {
  const { store } = h;
  const ctx = h.ctx();
  const project = store.project(a.projectId);
  const cwd = resolve(ctx.folder(project.path));
  const dir = designDir(cwd, a.file);
  const slug = basename(dir);
  const home = store.home;
  const from = fileTrash(home, cwd, slug);
  if (!lstatSync(join(from, "design"), { throwIfNoEntry: false })?.isDirectory()) throw new Error(`There's no removed design file “${slug}” of ${project.name} to put back.`);
  if (lstatSync(dir, { throwIfNoEntry: false })) throw new Error(`There's a design file “${slug}” in ${project.name} again, so the removed one can't come back over it.`);
  const root = linkFree(cwd, CANVAS_DIR);
  mkdirSync(root, { recursive: true });
  // Through a hidden folder of .liner/designs/, checked, then renamed into place: all or nothing.
  const staging = join(root, `.unremove-${uid("ur")}`);
  try {
    copyChecked(join(from, "design"), staging);
    renameSync(staging, dir);
  } catch (e) {
    rmSync(staging, { recursive: true, force: true });
    throw new Error(`“${slug}” couldn't be put back: ${e instanceof Error ? e.message : String(e)}`);
  }
  let entry: { pictures?: Parameters<typeof setPicturesPref>[3] } = {};
  try {
    entry = JSON.parse(readFileSync(join(from, "entry.json"), "utf8"));
  } catch {
    // no record: the files come back without their picture setting
  }
  const built = builtOf(home, cwd, slug);
  if (existsSync(join(from, "built")) && !existsSync(built)) {
    mkdirSync(dirname(built), { recursive: true });
    cpSync(join(from, "built"), built, { recursive: true });
  }
  if (entry.pictures) setPicturesPref(home, cwd, slug, entry.pictures);
  rmSync(from, { recursive: true, force: true });
  const file = readFile(ctx, cwd, slug);
  ctx.emit({ type: "canvas.changed", cwd, file: slug, by: "you", at: Date.now() });
  return { project, file };
}

// Discarding an untouched design on its own.

/** Every entry under a folder by its path from there: "d" a folder, "l" a link, else its file's sha256. */
function inventory(dir: string, rel = "", out: Record<string, string> = {}) {
  for (const n of readdirSync(join(dir, rel)).sort()) {
    const r = rel ? `${rel}/${n}` : n;
    const s = lstatSync(join(dir, r));
    if (s.isSymbolicLink()) out[r] = "l";
    else if (s.isDirectory()) {
      out[r] = "d";
      inventory(dir, r, out);
    } else out[r] = s.isFile() ? createHash("sha256").update(readFileSync(join(dir, r))).digest("hex") : "?";
  }
  return out;
}

/**
  What design.new put in each design on its own's folder, kept in the engine's home
  (design-fresh.json), never in the folder, by its path. A session made there forgets it (touched):
  from then on the design is the person's, even if it looks as it was made.
*/
const freshFile = (home: string) => join(home, "design-fresh.json");
function freshAll(home: string): Record<string, Record<string, string>> {
  try {
    const v = JSON.parse(readFileSync(freshFile(home), "utf8"));
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
function fresh(home: string, dir: string, made: Record<string, string> | undefined) {
  const all = freshAll(home);
  if (made) all[resolve(dir)] = made;
  else if (all[resolve(dir)]) delete all[resolve(dir)];
  else return;
  writeAtomic(freshFile(home), JSON.stringify(all, null, 2));
}
/** A session was made in a design on its own: it's no longer untouched. */
export const touched = (home: string, dir: string) => fresh(home, dir, undefined);

/**
  design.discard: a design on its own nobody worked on goes whole, its project and its folder. Only
  when the engine sees nothing of the person's in it: no session ever made there, the folder exactly
  as design.new made it (the same files, byte for byte, nothing added), the title still the default,
  no picture setting. Only a folder of the designs home itself, never through a link. Anything else
  is refused in a sentence and nothing changes.
*/
export function discardDesign(h: StartHost, a: { projectId: string }): { ok: true } {
  const { store } = h;
  const project = store.project(a.projectId);
  const keep = (why: string): never => {
    throw new Error(`“${project.name}” is kept: ${why}`);
  };
  if (project.kind !== "design") keep("it isn't a design on its own.");
  const dir = resolve(project.path);
  const home = resolve(designsHome(store.home, h.env));
  if (dirname(dir) !== home) keep("its folder isn't in the designs home.");
  const st = lstatSync(dir, { throwIfNoEntry: false });
  if (!st) keep("its folder isn't there.");
  if (st!.isSymbolicLink() || !st!.isDirectory()) keep("its folder is a link.");
  // The real place too: a designs home reached through a link still leads where it should.
  if (resolve(dirname(realpath(dir))) !== resolve(realpath(home))) keep("its folder leads out of the designs home.");
  if (store.threads.some((t) => t.projectId === project.id)) keep("it has a session.");
  const made = freshAll(store.home)[dir];
  if (!made) keep("it has been worked on (or Liner Code doesn't know how it was made).");
  if (project.name !== UNTITLED_DESIGN) keep("it has a name of its own.");
  const now = inventory(dir);
  const same = Object.keys(now).length === Object.keys(made).length && Object.entries(now).every(([k, v]) => made[k] === v);
  if (!same) keep("its folder has changed since it was made.");
  const slug = basename(dir);
  if (picturesPref(store.home, dir, slug)) keep("it has an AI pictures setting.");
  // Nothing of the person's: it goes, project and folder.
  store.removeProject(project.id);
  rmSync(dir, { recursive: true, force: true });
  fresh(store.home, dir, undefined);
  return { ok: true };
}
