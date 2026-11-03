/*
  Add-ons someone else made: from a GitHub address or a folder on this Mac, added from the Add-ons
  page. Nothing from outside gets more than an agent's draft does. A GitHub repository is cloned,
  shallow and without its submodules, LFS files or hooks, into a staging folder of the engine's own;
  the add-on in it (or in the folder) goes through the same manifest and file checks, and is shown
  on the same card, with what it can touch and the network held as before. Only the card's yes copies
  that checked snapshot into the store, where it runs as any add-on does: a connection's server is
  started by each agent tool, a panel in its sealed frame. A no, or nothing at all, leaves nothing.
*/
import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddonAsk, AddonManifest } from "../../contracts/src/index.ts";
import { ADDON_DIR, checkManifest, readPanelFiles, reachOf, type Addons, type PanelFiles } from "./addons.ts";
import { run } from "./exec.ts";

/** A GitHub address, as people paste them: owner/repo, maybe a branch and a folder in it. */
export function githubOf(source: string): { owner: string; repo: string; branch?: string; path?: string } | null {
  const s = source.trim().replace(/^git\+/, "").replace(/\/+$/, "");
  const m = /^(?:https?:\/\/)?(?:www\.)?github\.com[/:]([A-Za-z0-9-]{1,39})\/([A-Za-z0-9_.-]{1,100}?)(?:\.git)?(?:\/tree\/([A-Za-z0-9._/-]{1,200}?)(?:\/(.+))?)?$/.exec(s);
  if (!m || m[2] === "." || m[2] === "..") return null;
  // A branch with a slash in it can't be told from a folder; the first part is taken as the branch.
  const path = m[4]?.split("/").filter(Boolean);
  if (path?.some((p) => p === ".." || p.startsWith("."))) return null;
  return { owner: m[1], repo: m[2], ...(m[3] ? { branch: m[3] } : {}), ...(path?.length ? { path: path.join("/") } : {}) };
}

/**
  Where the add-on is in a folder: beside an addon.json at its top, or the one add-on in its
  .liner/addons/ (where agents write theirs). More than one there means saying which.
*/
export function findAddon(dir: string): string {
  if (existsSync(join(dir, "addon.json"))) return dir;
  const drafts = join(dir, ADDON_DIR);
  const found = existsSync(drafts) && statSync(drafts).isDirectory() ? readdirSync(drafts).filter((n) => !n.startsWith(".") && existsSync(join(drafts, n, "addon.json"))) : [];
  if (found.length === 1) return join(drafts, found[0]);
  if (found.length > 1) throw new Error(`There are ${found.length} add-ons in ${ADDON_DIR} there (${found.join(", ")}): choose the folder of the one you want.`);
  throw new Error("There's no add-on there: an add-on is a folder with an addon.json in it.");
}

/** An add-on read from outside, checked, with its files: exactly what Add copies, if it's added. */
export function readSource(dir: string): { manifest: AddonManifest; files?: PanelFiles } {
  const file = join(dir, "addon.json");
  if (lstatSync(file).isSymbolicLink()) throw new Error("Its addon.json is a link; an add-on's files must be its own.");
  if (statSync(file).size > 64_000) throw new Error("Its addon.json is over 64 KB; a manifest is a few lines.");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`Its addon.json isn't JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const manifest = checkManifest(raw);
  return manifest.kind === "panel" ? { manifest, files: readPanelFiles(dir, manifest.entry) } : { manifest };
}

type Staged = { manifest: AddonManifest; files?: PanelFiles; from: string; dir?: string; at: number };

export class Sources {
  private staged = new Map<string, Staged>();
  readonly root: string;
  private addons: Addons;
  private env: NodeJS.ProcessEnv;
  /** Whether panels may reach the internet at all (Settings › Add-ons). */
  network: () => "ask" | "never" = () => "ask";

  constructor(addons: Addons, env: NodeJS.ProcessEnv) {
    this.addons = addons;
    this.env = env;
    this.root = join(addons.dir, ".staging");
    // What was left from a run that stopped half way goes.
    rmSync(this.root, { recursive: true, force: true });
  }

  /**
    Reads an add-on from a GitHub address or a folder, checks it, and says what its card shows.
    Nothing is added yet: `adopt` does that, on the person's yes.
  */
  async open(source: string): Promise<{ token: string; from: string; ask: AddonAsk }> {
    const s = source.trim();
    if (!s) throw new Error("Paste a GitHub address, or choose a folder.");
    const gh = githubOf(s);
    let dir: string;
    let from: string;
    let clone: string | undefined;
    const token = randomBytes(12).toString("hex");
    if (gh) {
      clone = join(this.root, token);
      mkdirSync(this.root, { recursive: true });
      from = `github.com/${gh.owner}/${gh.repo}${gh.path ? `/${gh.path}` : ""}`;
      // Shallow, no submodules, no LFS, no prompts, no links checked out: only what an add-on is.
      const r = await run("git", ["-c", "core.symlinks=false", "-c", "filter.lfs.smudge=", "-c", "filter.lfs.process=", "-c", "filter.lfs.required=false", "clone", "--depth", "1", "--single-branch", "--no-tags", ...(gh.branch ? ["--branch", gh.branch] : []), `https://github.com/${gh.owner}/${gh.repo}.git`, clone], {
        env: { ...this.env, GIT_TERMINAL_PROMPT: "0", GIT_LFS_SKIP_SMUDGE: "1", GIT_ASKPASS: "echo" },
        timeout: 60_000,
      });
      if (r.code !== 0) {
        rmSync(clone, { recursive: true, force: true });
        const why = (r.stderr || r.stdout).trim().split("\n").pop() ?? "";
        throw new Error(/not found|could not read|Authentication/i.test(why) ? `There's no public repository at github.com/${gh.owner}/${gh.repo}.` : `It couldn't be fetched from GitHub${why ? `: ${why}` : "."}`);
      }
      dir = gh.path ? resolve(clone, gh.path) : clone;
      const rel = relative(clone, dir);
      if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("That folder is outside the repository.");
    } else {
      // A file:// address (spaces as %20) is its path; ~ is your home folder.
      let path = s.replace(/^~(?=\/)/, process.env.HOME ?? "~");
      if (/^file:\/\//i.test(path))
        try {
          path = fileURLToPath(path);
        } catch {
          throw new Error("That file:// address isn't a folder on this Mac.");
        }
      if (!isAbsolute(path)) throw new Error("That isn't a GitHub address or a folder: paste github.com/owner/repo, or choose a folder.");
      if (!existsSync(path) || !statSync(path).isDirectory()) throw new Error("There's no folder there.");
      dir = path;
      from = `the folder ${basename(path)}`;
    }
    try {
      const at = findAddon(dir);
      const { manifest, files } = readSource(at);
      if (manifest.kind === "panel" && manifest.access.network && this.network() === "never") throw new Error(`It reaches ${manifest.access.network}, and panels may never reach the internet (Settings › Add-ons).`);
      const have = this.addons.get(manifest.id);
      if (have && have.kind !== manifest.kind) throw new Error(`You already have a ${have.kind} called ${manifest.id}; this one is a ${manifest.kind} with the same id.`);
      this.staged.set(token, { manifest, files, from, dir: clone, at: Date.now() });
      const shown = { id: "", name: "Every project" };
      const path = clone ? relative(clone, at).split(sep).join("/") || "." : at;
      const ask: AddonAsk =
        manifest.kind === "panel"
          ? { ...this.addons.panelAsk(manifest, path, shown, files!), scope: "all" }
          : { ...this.addons.askOf(manifest, path, shown, ["Claude Code", "Codex", "OpenCode", "Hermes"]), scope: "all" };
      return { token, from, ask };
    } catch (e) {
      if (clone) rmSync(clone, { recursive: true, force: true });
      throw e;
    }
  }

  /** The card's yes: the checked snapshot goes into the store, as a new version unless it's the same as one kept. */
  adopt(token: string) {
    const s = this.staged.get(token);
    if (!s) throw new Error("That's gone: add it again.");
    this.staged.delete(token);
    try {
      const version = this.addons.install(s.manifest, { by: { agent: "You", from: s.from, at: Date.now() } }, s.files);
      return { id: s.manifest.id, version, kind: s.manifest.kind, reaches: s.manifest.kind === "connection" ? reachOf(s.manifest) : undefined };
    } finally {
      if (s.dir) rmSync(s.dir, { recursive: true, force: true });
    }
  }

  /** The card's no, or the dialog closed: nothing is kept. */
  drop(token: string) {
    const s = this.staged.get(token);
    this.staged.delete(token);
    if (s?.dir) rmSync(s.dir, { recursive: true, force: true });
  }
}
