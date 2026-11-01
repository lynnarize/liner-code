/*
  Designs: screens, pages and prototypes an agent draws as HTML, shown in the session's Design
  surface beside it. A design is one HTML file in the session's folder (under .liner/designs/
  unless the agent picks another place), which the agent writes and edits with its own tools,
  or hands over whole through design_show: so every agent tool can make one, and changing it
  costs an edit, not the whole page again. Each time it's shown, that state is kept as a version,
  in ~/.liner-code/designs/<thread>/<design>/v<n>.html, and the timeline gets a card for it.

  The folder's .liner/ stays out of git: snapshots leave it out (checkpoints.ts), and the first
  design adds it to the repository's info/exclude, so a design never shows as a change to commit.
  Ideas from Kun's Design mode (github.com/KunAgent/Kun, docs/DESIGN_MODE.md); no code from it.
*/
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { DesignInfo, DesignSize, Item } from "../../contracts/src/index.ts";
import { run } from "./exec.ts";
import { uid, type Store } from "./store.ts";

export type DesignItem = Extract<Item, { kind: "design" }>;

/** Where designs go in a session's folder, when the agent hands one over whole. */
export const DESIGN_DIR = ".liner/designs";
/** The frame each size is drawn in: the Design surface's, and the picture the agent gets back. */
export const DESIGN_FRAME: Record<DesignSize, { width: number; height: number }> = {
  desktop: { width: 1280, height: 800 },
  tablet: { width: 834, height: 1112 },
  phone: { width: 390, height: 844 },
};
/** A design is one page: a few hundred KB at most, with its pictures inline. */
const MAX = 2_000_000;

export const sizeOf = (v: unknown): DesignSize | undefined => (v === "desktop" || v === "tablet" || v === "phone" ? v : undefined);

/** A file name from a title: "Settings screen" → "settings-screen". */
export function slugOf(title: string) {
  const s = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return s || "design";
}

/** A design's file as a path in the session's folder ("a/b.html"). Outside the folder, or not HTML, throws. */
export function designPath(root: string, asked: string) {
  const file = asked.trim().replace(/^file:\/\//i, "").replace(/[?#].*$/, "");
  const rel = relative(root, isAbsolute(file) ? file : resolve(root, file));
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("A design's file must be inside this session's folder.");
  if (!/\.html?$/i.test(rel)) throw new Error("A design is an HTML file: give a path that ends in .html.");
  return rel.split(sep).join("/");
}

/** The latest version of each design among a thread's items, the one shown last first. */
export function designsOf(items: Item[]) {
  const latest = new Map<string, { item: DesignItem; at: number }>();
  const count = new Map<string, number>();
  items.forEach((it, i) => {
    if (it.kind !== "design") return;
    count.set(it.design, (count.get(it.design) ?? 0) + 1);
    const have = latest.get(it.design);
    if (!have || it.version > have.item.version) latest.set(it.design, { item: it, at: i });
  });
  return [...latest.values()].sort((a, b) => b.at - a.at).map(({ item }) => ({ item, versions: count.get(item.design) ?? 1 }));
}

type Show = { title?: string; path?: string; html?: string; design?: string; size?: DesignSize; note?: string };

export class Designs {
  private store: Store;
  /** The folder a thread works in. */
  cwdOf: (threadId: string) => string | null = () => null;
  /** The turn a thread is on. */
  turnOf: (threadId: string) => number = () => 0;
  /** Folders whose .liner/ is already out of git. */
  private excluded = new Set<string>();
  /** Threads with a Design surface open, how many, and the folders watched for each. */
  private watching = new Map<string, { n: number; dirs: Map<string, FSWatcher>; timers: Map<string, NodeJS.Timeout> }>();

  constructor(store: Store) {
    this.store = store;
  }

  private dir(threadId: string, design: string) {
    return join(this.store.home, "designs", threadId, design);
  }

  private items(threadId: string) {
    return this.store.timeline(threadId).filter((x): x is DesignItem => x.kind === "design");
  }

  private root(threadId: string) {
    const root = this.cwdOf(threadId);
    if (!root || !existsSync(root)) throw new Error("This session's folder isn't there any more.");
    return root;
  }

  /** The newest version of a design. */
  latest(threadId: string, design: string) {
    let best: DesignItem | undefined;
    for (const it of this.items(threadId)) if (it.design === design && (!best || it.version > best.version)) best = it;
    return best;
  }

  /**
    Keeps a design's file as it is now as a new version, and puts its card on the timeline. The
    design is the one with this id, else the one at this path, else the one with this title;
    else it's a new one. With html, the file is written first (in .liner/designs/ unless a path
    is given). The same page as the last version keeps that version: nothing new to see.
  */
  show(threadId: string, a: Show): { item: DesignItem; fresh: boolean } {
    const root = this.root(threadId);
    const all = this.items(threadId);
    const asked = a.path?.trim() ? designPath(root, a.path) : undefined;
    const named = a.title?.trim().toLowerCase();
    const had =
      (a.design ? all.find((x) => x.design === a.design) : undefined) ??
      (asked ? all.find((x) => x.path === asked) : undefined) ??
      (!asked && named ? all.find((x) => x.title.toLowerCase() === named) : undefined);
    if (a.design && !had) throw new Error(`There's no design ${a.design} in this session. Leave design out to start a new one.`);
    const prev = had ? this.latest(threadId, had.design) : undefined;
    const title = (a.title?.trim() || prev?.title || "A design").slice(0, 120);
    const path = asked ?? prev?.path ?? this.freePath(root, title, all);
    const abs = join(root, path);

    if (a.html !== undefined) {
      if (!a.html.trim()) throw new Error("The design is empty.");
      if (a.html.length > MAX) throw new Error("That design is too large; keep it under 2 MB, with big pictures as files beside it.");
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, a.html);
    }
    if (!existsSync(abs)) throw new Error(`There's no ${path} yet. Write the design there first, or pass the whole page as html.`);
    if (statSync(abs).size > MAX) throw new Error(`${path} is over 2 MB; keep a design to one page, with big pictures as files beside it.`);
    const html = readFileSync(abs, "utf8");
    if (!html.trim()) throw new Error(`${path} is empty.`);
    void this.keepOutOfGit(root);

    const size = a.size ?? prev?.size ?? "desktop";
    if (prev && prev.size === size && prev.title === title && this.version(threadId, prev.design, prev.version) === html) return { item: prev, fresh: false };
    const design = prev?.design ?? uid("dz");
    const version = (prev?.version ?? 0) + 1;
    mkdirSync(this.dir(threadId, design), { recursive: true });
    writeFileSync(join(this.dir(threadId, design), `v${version}.html`), html);
    const item: DesignItem = { kind: "design", id: uid("it"), turn: this.turnOf(threadId), at: Date.now(), design, title, path, version, size, ...(a.note?.trim() ? { note: a.note.trim().slice(0, 200) } : {}) };
    this.store.putItem(threadId, item);
    this.arm(threadId);
    return { item, fresh: true };
  }

  /**
    .liner/designs/<title>.html, or with a number when that file is taken: by another design of
    the session, or by one another session in the same folder made (it's that session's to change).
  */
  private freePath(root: string, title: string, all: DesignItem[]) {
    const slug = slugOf(title);
    for (let n = 1; ; n++) {
      const path = `${DESIGN_DIR}/${slug}${n > 1 ? `-${n}` : ""}.html`;
      if (!all.some((x) => x.path === path) && (n > 50 || !existsSync(join(root, path)))) return path;
    }
  }

  /** A kept version's HTML, or null when it's gone. */
  version(threadId: string, design: string, version: number) {
    const file = join(this.dir(threadId, design), `v${version}.html`);
    return existsSync(file) ? readFileSync(file, "utf8") : null;
  }

  /** A version's HTML; with no version, the file as it is now (the latest version, once the file is gone). */
  read(threadId: string, design: string, version?: number) {
    const latest = this.latest(threadId, design);
    if (!latest) throw new Error("That design isn't in this session.");
    if (version !== undefined) {
      const html = this.version(threadId, design, version);
      if (html === null) throw new Error(`Version ${version} of “${latest.title}” isn't kept any more.`);
      return { html, path: latest.path, version };
    }
    const root = this.cwdOf(threadId);
    const abs = root ? join(root, latest.path) : "";
    const html = abs && existsSync(abs) ? readFileSync(abs, "utf8") : (this.version(threadId, design, latest.version) ?? "");
    return { html, path: latest.path, version: latest.version };
  }

  /** Puts a kept version back in the design's file, as a new version. */
  restore(threadId: string, design: string, version: number) {
    const latest = this.latest(threadId, design);
    const html = latest ? this.version(threadId, design, version) : null;
    if (!latest || html === null) throw new Error("That version isn't kept any more.");
    return this.show(threadId, { design, html, note: `Back to version ${version}` }).item;
  }

  /** A session's designs, newest first, with the version you had built of each. */
  list(threadId: string): DesignInfo[] {
    return designsOf(this.store.timeline(threadId)).map(({ item, versions }) => {
      const built = this.meta(threadId, item.design).built;
      return { design: item.design, title: item.title, path: item.path, size: item.size, versions, ...(built ? { built } : {}) };
    });
  }

  private meta(threadId: string, design: string): { built?: { version: number; at: number } } {
    try {
      return JSON.parse(readFileSync(join(this.dir(threadId, design), "meta.json"), "utf8")) as { built?: { version: number; at: number } };
    } catch {
      return {};
    }
  }

  /** You asked for this version to be built. */
  built(threadId: string, design: string, version: number) {
    if (!this.latest(threadId, design)) throw new Error("That design isn't in this session.");
    mkdirSync(this.dir(threadId, design), { recursive: true });
    writeFileSync(join(this.dir(threadId, design), "meta.json"), JSON.stringify({ ...this.meta(threadId, design), built: { version, at: Date.now() } }));
    return this.list(threadId);
  }

  /**
    Adds .liner/ to the repository's info/exclude (shared by its worktrees), once: designs are the
    session's drafts, not the project's files. Not a repository: nothing to do.
  */
  private async keepOutOfGit(root: string) {
    if (this.excluded.has(root)) return;
    this.excluded.add(root);
    const r = await run("git", ["rev-parse", "--git-common-dir"], { cwd: root, timeout: 10000 });
    if (r.code !== 0 || !r.stdout.trim()) return;
    const file = join(resolve(root, r.stdout.trim()), "info", "exclude");
    try {
      const have = existsSync(file) ? readFileSync(file, "utf8") : "";
      if (/^\/?\.liner\/?\s*$/m.test(have)) return;
      mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, `${have && !have.endsWith("\n") ? "\n" : ""}# Liner Code's designs (its Design surface)\n.liner/\n`);
    } catch {
      // A repository we can't write to: its designs show as new files, and that's all.
    }
  }

  /** A Design surface opened (or closed) for a thread: its designs' folders are watched while one is open. */
  watch(threadId: string, on: boolean) {
    const w = this.watching.get(threadId) ?? { n: 0, dirs: new Map(), timers: new Map() };
    w.n = Math.max(0, w.n + (on ? 1 : -1));
    if (w.n > 0) {
      this.watching.set(threadId, w);
      this.arm(threadId);
      return;
    }
    for (const d of w.dirs.values()) d.close();
    for (const t of w.timers.values()) clearTimeout(t);
    this.watching.delete(threadId);
  }

  /** Watches the folders of a thread's designs, for one that's watched; a change says which design, once it settles. */
  private arm(threadId: string) {
    const w = this.watching.get(threadId);
    const root = this.cwdOf(threadId);
    if (!w || !root) return;
    const designs = designsOf(this.store.timeline(threadId)).map((d) => d.item);
    for (const dir of new Set(designs.map((d) => dirname(join(root, d.path))))) {
      if (w.dirs.has(dir) || !existsSync(dir)) continue;
      try {
        const fw = watch(dir, (_event, name) => {
          if (!name) return;
          const changed = join(dir, name.toString());
          for (const d of designsOf(this.store.timeline(threadId)).map((x) => x.item)) {
            if (join(root, d.path) !== changed) continue;
            clearTimeout(w.timers.get(d.design));
            w.timers.set(
              d.design,
              setTimeout(() => {
                w.timers.delete(d.design);
                this.store.emit({ type: "design.changed", threadId, design: d.design, at: Date.now() });
              }, 250),
            );
          }
        });
        fw.on("error", () => (fw.close(), w.dirs.delete(dir)));
        w.dirs.set(dir, fw);
      } catch {
        // Can't watch it: the surface still draws each new version.
      }
    }
  }
}
