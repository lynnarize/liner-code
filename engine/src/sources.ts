/*
  Add-ons someone else made: from a GitHub address, a folder on this Mac, or a DeepSeek Harness
  plugin on npm (dsh.ts), added from the Add-ons page. Nothing from outside gets more than an agent's
  draft does, but for a DSH plugin's Node half, which the card names and holds to allow. A GitHub repository is cloned,
  shallow and without its submodules, LFS files or hooks, into a staging folder of the engine's own;
  the add-on in it (or in the folder) goes through the same manifest and file checks, and is shown
  on the same card, with what it can touch and the network held as before. Only the card's yes copies
  that checked snapshot into the store, where it runs as any add-on does: a connection's server is
  started by each agent tool, a panel in its sealed frame. A no, or nothing at all, leaves nothing.
*/
import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import type { AddonAsk, AddonManifest } from "../../contracts/src/index.ts";
import { ADDON_DIR, checkManifest, readPanelFiles, reachOf, type Addons, type PanelFiles } from "./addons.ts";
import { isDsh, npmFetch, npmOf, readDsh } from "./dsh.ts";
import { sandboxWords, savesFolder } from "./dsh-hosts.ts";
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
  if (!statSync(file).isFile()) throw new Error("Its addon.json isn't a plain file.");
  if (statSync(file).size > 64_000) throw new Error("Its addon.json is over 64 KB; a manifest is a few lines.");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`Its addon.json isn't JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const manifest = checkManifest(raw);
  // Loose: a repository's LICENSE, sources and deeper folders beside the page are left out, not refused.
  return manifest.kind === "panel" ? { manifest, files: readPanelFiles(dir, manifest.entry, true) } : { manifest };
}

type Staged = { manifest: AddonManifest; files?: PanelFiles; from: string; dir?: string; pkg?: { dir: string; modules: boolean }; at: number };

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
    // A card never answered (the dialog closed while it was fetched) goes after half an hour.
    for (const [k, v] of this.staged) if (Date.now() - v.at > 30 * 60_000) this.drop(k);
    const s = source.trim();
    if (!s) throw new Error("Paste a GitHub address or an npm package, or choose a folder.");
    const gh = githubOf(s);
    const npm = gh ? null : npmOf(s);
    let dir: string;
    let from: string;
    let clone: string | undefined;
    let integrity: string | undefined;
    const token = randomBytes(12).toString("hex");
    if (npm) {
      // A DeepSeek Harness plugin on npm: its tarball, checked and unpacked, scripts never run.
      clone = join(this.root, token);
      mkdirSync(clone, { recursive: true });
      try {
        const got = await npmFetch(npm, join(clone, "package"));
        integrity = got.integrity;
        from = `npmjs.com/package/${got.name}`;
      } catch (e) {
        rmSync(clone, { recursive: true, force: true });
        throw e;
      }
      dir = join(clone, "package");
    } else if (gh) {
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
      if (!isAbsolute(path)) throw new Error("That isn't a GitHub address, an npm package or a folder: paste github.com/owner/repo or a package's name, or choose a folder.");
      if (!existsSync(path) || !statSync(path).isDirectory()) throw new Error("There's no folder there.");
      dir = path;
      from = `the folder ${basename(path)}`;
    }
    try {
      if (npm || (isDsh(dir) && !existsSync(join(dir, "addon.json")))) return await this.openDsh({ token, dir, from, clone, integrity, npm: !!npm });
      const at = findAddon(dir);
      const { manifest, files } = readSource(at);
      if (manifest.kind === "panel" && manifest.access.network && this.network() === "never") throw new Error(`It reaches ${manifest.access.network}, and panels may never reach the internet (Settings › Add-ons).`);
      const have = this.addons.get(manifest.id);
      if (have && have.kind !== manifest.kind) throw new Error(`You already have a ${have.kind} called ${manifest.id}; this one is a ${manifest.kind} with the same id.`);
      // Keys and storage are kept by id, removed or not: another source's add-on never takes them over.
      if (have && have.by.from?.toLowerCase() !== from.toLowerCase()) {
        const who = have.by.from ? `from ${have.by.from}` : have.by.agent === "You" ? "that you added" : `made by ${have.by.agent}`;
        throw new Error(`You already have an add-on called ${manifest.id}${have.removed ? " (removed, but kept)" : ""}, ${who}; its keys and storage stay with that id. This one is from ${from}.`);
      }
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

  /**
    A DeepSeek Harness plugin, unpacked in `dir`: read into the add-on it makes, its Node half's
    dependencies installed (npm's scripts off), and its card, which says what of it is left out.
  */
  private async openDsh(o: { token: string; dir: string; from: string; clone?: string; integrity?: string; npm: boolean }): Promise<{ token: string; from: string; ask: AddonAsk }> {
    const read = readDsh(o.dir, { integrity: o.integrity });
    const { manifest } = read;
    const have = this.addons.get(manifest.id);
    if (have && have.kind !== manifest.kind) throw new Error(`You already have a ${have.kind} called ${manifest.id}; this one is a ${manifest.kind} with the same id.`);
    if (have && have.by.from?.toLowerCase() !== o.from.toLowerCase()) {
      const who = have.by.from ? `from ${have.by.from}` : have.by.agent === "You" ? "that you added" : `made by ${have.by.agent}`;
      throw new Error(`You already have an add-on called ${manifest.id}${have.removed ? " (removed, but kept)" : ""}, ${who}; its keys and storage stay with that id. This one is from ${o.from}.`);
    }
    // A folder you chose is copied on the yes, its node_modules only when its program needs them; one from npm is ours to finish here.
    if (read.deps.length) {
      if (!o.clone) {
        if (!existsSync(join(o.dir, "node_modules"))) throw new Error(`Its program needs ${read.deps.slice(0, 3).join(", ")}${read.deps.length > 3 ? "…" : ""}: run npm install in that folder first.`);
      } else await this.dependencies(o.dir, read.deps);
    }
    this.staged.set(o.token, { manifest, files: read.files, from: o.from, dir: o.clone, pkg: manifest.dsh ? { dir: o.dir, modules: read.deps.length > 0 } : undefined, at: Date.now() });
    const shown = { id: "", name: "Every project" };
    const path = o.npm ? `${manifest.dsh ? manifest.dsh.package : o.from.replace(/^npmjs\.com\/package\//, "")}` : o.dir;
    // Its card: its package, what its program may do here, the tools it gives your agents and what it tells them, and what of it is left out.
    const said = manifest.dsh?.instructions;
    // Where it would save in your Documents: a folder Liner Code makes for it when it first runs, or why it gets none.
    const saves = manifest.kind === "panel" && manifest.dsh?.host && sandboxWords() ? savesFolder(this.env.HOME ?? homedir(), [manifest.name, manifest.id], join(this.addons.dir, manifest.id, "folders.json")) : null;
    const dsh = manifest.dsh ? { package: manifest.dsh.package, version: manifest.dsh.version, host: !!manifest.dsh.host, ...(manifest.dsh.host && sandboxWords() ? { sandbox: sandboxWords()! } : {}), ...(manifest.dsh.tools?.length ? { tools: manifest.dsh.tools.map((t) => t.name), gives: manifest.dsh.tools } : {}), ...(said?.texts.length ? { instructions: said.texts.join("\n\n") } : {}), ...(said?.live ? { instructionsLive: true } : {}), ...(saves?.path ? { saves: { path: saves.path, ...(saves.why ? { why: saves.why } : {}) } } : {}), left: read.left, size: read.size } : undefined;
    if (manifest.kind === "panel") return { token: o.token, from: o.from, ask: { ...this.addons.panelAsk(manifest, path, shown, read.files!), scope: "all", ...(dsh ? { dsh } : {}) } };
    return { token: o.token, from: o.from, ask: { ...this.addons.askOf(manifest, path, shown, ["Claude Code", "Codex", "OpenCode", "Hermes"]), scope: "all", ...(dsh ? { dsh } : {}) } };
  }

  /**
    A Node half's dependencies, installed beside it with npm, scripts off: in a clean folder of the
    engine's own first (never one of the package's, whose .npmrc npm would obey), with only versions
    from npm's registry (no git, file or web addresses), none of your npm settings, and nothing of the
    engine's environment; then moved in. Only the ones it names, and DeepSeek Harness's public ones.
  */
  private async dependencies(dir: string, deps: string[]) {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Record<"dependencies" | "peerDependencies" | "devDependencies", Record<string, string> | undefined>;
    const want = Object.fromEntries(deps.map((d) => [d, pkg.dependencies?.[d] ?? pkg.peerDependencies?.[d] ?? pkg.devDependencies?.[d] ?? "*"]));
    const odd = Object.entries(want).filter(([, v]) => typeof v !== "string" || /[:/#\\]/.test(v) || v.length > 100);
    if (odd.length) throw new Error(`Its program needs ${odd[0][0]} from ${String(odd[0][1]).slice(0, 60)}, not npm's registry, which Liner Code doesn't install from.`);
    mkdirSync(this.root, { recursive: true });
    const side = mkdtempSync(join(this.root, "deps-"));
    try {
      // Two empty files: npm 11 refuses one file read as both the user's settings and the global ones.
      const empty = join(side, "npmrc");
      const none = join(side, "npmrc-global");
      writeFileSync(empty, "");
      writeFileSync(none, "");
      writeFileSync(join(side, "package.json"), JSON.stringify({ name: "liner-dsh-deps", private: true, dependencies: want }));
      const e = this.env;
      const env = Object.fromEntries(Object.entries({ PATH: e.PATH, HOME: e.HOME, TMPDIR: e.TMPDIR, LANG: e.LANG, SystemRoot: e.SystemRoot, APPDATA: e.APPDATA, LOCALAPPDATA: e.LOCALAPPDATA, USERPROFILE: e.USERPROFILE, npm_config_ignore_scripts: "true" }).filter(([, v]) => v !== undefined)) as NodeJS.ProcessEnv;
      const r = await run("npm", ["install", "--omit=dev", "--omit=peer", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock", "--loglevel=error", `--userconfig=${empty}`, `--globalconfig=${none}`, "--registry=https://registry.npmjs.org/"], { cwd: side, env, timeout: 180_000 });
      if (r.code !== 0) {
        const why = (r.stderr || r.stdout).trim().split("\n").filter(Boolean).pop() ?? "";
        throw new Error(/ENOENT|not found|command not found/i.test(why) || r.code === 127 ? "Its program needs packages from npm, and npm isn't on this Mac's PATH." : `Its program's packages didn't install${why ? `: ${why}` : "."}`);
      }
      if (existsSync(join(side, "node_modules"))) {
        rmSync(join(dir, "node_modules"), { recursive: true, force: true });
        renameSync(join(side, "node_modules"), join(dir, "node_modules"));
      }
    } finally {
      rmSync(side, { recursive: true, force: true });
    }
  }

  /** The card's yes: the checked snapshot goes into the store, as a new version unless it's the same as one kept. */
  adopt(token: string) {
    const s = this.staged.get(token);
    if (!s) throw new Error("That's gone: add it again.");
    this.staged.delete(token);
    try {
      const version = this.addons.install(s.manifest, { by: { agent: "You", from: s.from, at: Date.now() } }, s.files, s.pkg);
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
