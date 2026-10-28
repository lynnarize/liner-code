/*
  Keeps Liner Code and the agent tools current.

  Liner Code: the latest release on GitHub, from the repository the app was built from
  (package.json's liner.releases). The zip for this Mac is downloaded in the background, checked
  against the SHA-256 the release gives (GitHub's own digest, or a .sha256 file beside the zip),
  unpacked, and checked again (the bundle id, the version, an intact signature) before it waits in
  <home>/updates. The shell puts it in place of the running app when you restart or quit; the
  engine never touches the app itself, and says so when that swap didn't go through. A private
  repository is read with the GitHub CLI's sign-in.

  The tools: each one's newest version from where it's published (npm, or Hermes's own check),
  and its own updater (claude update, codex update, opencode upgrade, hermes update), run only
  while no session is working on that tool. Its idle sessions close after, so the next turn
  starts the new version and resumes where it was.
*/
import { createHash } from "node:crypto";
import { accessSync, constants, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { AppUpdate, BuiltinProvider, Settings, ToolUpdate, Updates } from "../../contracts/src/index.ts";
import { newerVersion, updateModes } from "../../contracts/src/index.ts";
import { run, which } from "./exec.ts";
import type { Store } from "./store.ts";

const EVERY = 6 * 3600_000;
const BUNDLE_ID = "app.liner.code";
const APP_NAME = "Liner Code.app";
/** The app's own package.json: the repo's root while developing, the staged one inside the app. */
const PACKAGE = join(import.meta.dirname, "../../package.json");

/** "v0.2.0", "codex-cli 0.164.0" → [0, 2, 0]. */
export function versionParts(s?: string) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(s ?? "");
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
export const versionOf = (s?: string) => versionParts(s)?.join(".");

/** The Team ID in `codesign -dv` output; nothing for an ad-hoc or unsigned app. */
export function teamIn(out: string) {
  const id = /^TeamIdentifier=(.+)$/m.exec(out)?.[1]?.trim();
  return id && id !== "not set" ? id : undefined;
}
const teamOf = async (app: string) => teamIn((await run("codesign", ["-dv", "--verbose=2", app], { timeout: 60_000 })).stderr);
export const newer = newerVersion;

/** "github:o/n", "o/n", "https://github.com/o/n.git", { url } → "o/n". */
export function repoName(v: unknown): string | undefined {
  const s = typeof v === "string" ? v : v && typeof v === "object" && typeof (v as { url?: unknown }).url === "string" ? (v as { url: string }).url : "";
  const m = /^(?:github:)?([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(s.trim()) ?? /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(s.trim());
  return m?.[1];
}

/** The zip in a release for this Mac: "Liner-Code-0.2.0-mac-arm64.zip". */
export function pickAsset<T extends { name: string }>(assets: T[], arch = process.arch): T | undefined {
  const macs = assets.filter((a) => /\.zip$/i.test(a.name) && /mac|darwin|osx/i.test(a.name));
  // A release may carry other zips (tools, symbols): the app's own name first.
  const ours = macs.filter((a) => /liner/i.test(a.name));
  const zips = ours.length ? ours : macs;
  const mine = arch === "arm64" ? /arm64|aarch64|apple-?silicon/i : /x64|x86[-_]?64|intel/i;
  // A zip that names no architecture runs anywhere; one built for the other kind of Mac isn't taken.
  return zips.find((a) => mine.test(a.name)) ?? zips.find((a) => /universal/i.test(a.name)) ?? zips.find((a) => !/arm64|aarch64|x64|x86|intel/i.test(a.name));
}

type Asset = { id: number; name: string; size: number; url: string; digest?: string | null };
type Release = { tag_name: string; name?: string; body?: string; html_url: string; published_at?: string; draft?: boolean; prerelease?: boolean; assets: Asset[] };

/** What the engine asks of the runtime: how many turns run on a tool, and closing its idle sessions. */
export type Busy = { working(family: string): number; restartIdle(family: string): void };

type ToolSpec = {
  id: BuiltinProvider;
  label: string;
  bin: string;
  /** The tool's own updater, from where it's installed; null when Liner Code can't update it. */
  updater: (path: string, real: string) => string[] | null;
  latest: (path: string, env: NodeJS.ProcessEnv) => Promise<string | undefined>;
};

const getJson = async <T>(url: string, headers: Record<string, string> = {}): Promise<T> => {
  const r = await fetch(url, { headers: { "user-agent": "Liner Code", ...headers }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw Object.assign(new Error(`${r.status} from ${new URL(url).host}`), { status: r.status });
  return (await r.json()) as T;
};
const npm = (pkg: string, tag = () => "latest") => async () => {
  const tags = await getJson<Record<string, string>>(`https://registry.npmjs.org/-/package/${pkg}/dist-tags`);
  return tags[tag()] ?? tags.latest;
};
/** Claude Code follows its own channel: "latest", or "stable" a few versions behind. */
const claudeChannel = () => {
  try {
    const dir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
    const s = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")) as { autoUpdatesChannel?: string };
    return s.autoUpdatesChannel === "stable" ? "stable" : "latest";
  } catch {
    return "latest";
  }
};

export const TOOLS: ToolSpec[] = [
  { id: "claude", label: "Claude Code", bin: "claude", updater: (p) => [p, "update"], latest: npm("@anthropic-ai/claude-code", claudeChannel) },
  { id: "codex", label: "Codex CLI", bin: "codex", updater: (p) => [p, "update"], latest: npm("@openai/codex") },
  { id: "opencode", label: "OpenCode", bin: "opencode", updater: (p) => [p, "upgrade"], latest: npm("opencode-ai") },
  {
    id: "hermes",
    label: "Hermes",
    bin: "hermes",
    updater: (p) => [p, "update", "--yes"],
    // Hermes knows its own channel and install; asking it takes a git fetch (about 20 s).
    latest: async (path, env) => {
      const r = await run(path, ["update", "--check"], { env, timeout: 120_000, input: "" });
      const out = `${r.stdout}\n${r.stderr}`;
      const m = /available:?\s+(?:\w+\s+)?v?(\d+\.\d+\.\d+)/i.exec(out);
      if (m) return m[1];
      if (r.code !== 0) throw new Error(out.trim().split("\n").pop() || `hermes update --check failed (${r.code})`);
      return undefined;
    },
  },
  {
    id: "grok",
    label: "Grok Build",
    bin: "grok",
    // Installed with npm: npm, from the same Node, updates it.
    updater: (_p, real) => {
      const m = /^(.*)\/lib\/node_modules\/@xai-official\/grok\//.exec(real);
      return m && existsSync(join(m[1], "bin/npm")) ? [join(m[1], "bin/npm"), "install", "-g", "@xai-official/grok@latest"] : null;
    },
    latest: npm("@xai-official/grok"),
  },
];

const writable = (p: string) => {
  try {
    accessSync(p, constants.W_OK);
    return true;
  } catch {
    return false;
  }
};
const short = (s: string) => s.trim().split("\n").filter(Boolean).slice(-1)[0]?.slice(0, 240) ?? "";

export class Updater {
  private app: AppUpdate;
  /** The running app's bundle, when it runs from one. */
  private bundle?: string;
  private tools: ToolUpdate[] = [];
  private checkedAt?: number;
  private checking: Promise<Updates> | null = null;
  private downloading: Promise<void> | null = null;
  private dismissed: Record<string, string> = {};
  /** Tools you (or auto) asked to update, waiting for their sessions to finish. */
  private wanted = new Set<BuiltinProvider>();
  private running: BuiltinProvider | null = null;
  private release?: Release;
  /**
    A version that downloaded but couldn't take this copy's place. The shell's swap script leaves
    why in swap-failed.txt; that version isn't downloaded and tried again by itself, since it
    would only fail the same way at every quit. A newer release is tried as usual.
  */
  private stuck?: { version: string; why: string };
  private token: string | undefined | null = null;
  private timers: NodeJS.Timeout[] = [];
  private readonly dir: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly store: Store;
  private readonly busy: Busy;
  private readonly onTools: () => void;

  constructor(store: Store, env: NodeJS.ProcessEnv, busy: Busy, onTools: () => void) {
    this.store = store;
    this.env = env;
    this.busy = busy;
    this.onTools = onTools;
    this.dir = join(store.home, "updates");
    let pkg: { version?: string; repository?: unknown; liner?: { releases?: string } } = {};
    try {
      pkg = JSON.parse(readFileSync(PACKAGE, "utf8")) as typeof pkg;
    } catch {
      // no package.json beside the engine
    }
    const bundle = env.LINER_APP_BUNDLE;
    this.bundle = bundle;
    this.app = {
      current: env.LINER_APP_VERSION || pkg.version || "0.0.0",
      repo: repoName(env.LINER_UPDATE_REPO) ?? repoName(pkg.liner?.releases) ?? repoName(pkg.repository),
      state: "idle",
      can: !bundle || process.platform !== "darwin" ? "source" : bundle.includes("/AppTranslocation/") ? "translocated" : writable(dirname(bundle)) && writable(bundle) ? "install" : "readonly",
    };
    try {
      const s = JSON.parse(readFileSync(join(this.dir, "state.json"), "utf8")) as { dismissed?: Record<string, string>; checkedAt?: number; stuck?: Updater["stuck"] };
      this.dismissed = s.dismissed ?? {};
      this.checkedAt = s.checkedAt;
      if (s.stuck && newer(s.stuck.version, this.app.current)) this.stuck = s.stuck;
    } catch {
      // first run
    }
    this.readSwap();
    this.readStaged();
    // A newer release that's already waiting comes before one that didn't go in.
    if (this.stuck && this.app.state !== "ready") this.app = { ...this.app, latest: this.stuck.version, state: "failed", stuck: true, error: this.stuckError() };
  }

  private stuckError() {
    return `It downloaded, but couldn't take this copy's place (${this.stuck?.why || "no reason given"}). Get it from the release page and drag it to Applications.`;
  }

  /** What the swap script left after a swap that didn't go through. */
  private readSwap() {
    const file = join(this.dir, "swap-failed.txt");
    if (!existsSync(file)) return;
    try {
      const said = short(readFileSync(file, "utf8"));
      console.error(`[updates] the update didn't go in: ${said}`);
      // mv's own words end with the reason ("…: Operation not permitted"); the paths stay in the log.
      const why = said.split(": ").pop() ?? said;
      const r = JSON.parse(readFileSync(join(this.dir, "ready.json"), "utf8")) as { version?: string };
      if (r.version && newer(r.version, this.app.current)) this.stuck = { version: r.version, why };
    } catch {
      // nothing was staged
    }
    rmSync(file, { force: true });
    this.clearStaged();
    this.save();
  }

  private get settings(): Settings {
    return this.store.settings;
  }
  private get modeApp() {
    return updateModes(this.settings).app;
  }
  private get modeTools() {
    return updateModes(this.settings).tools;
  }

  get state(): Updates {
    return { checkedAt: this.checkedAt, checking: Boolean(this.checking), app: { ...this.app }, tools: this.tools.map((t) => ({ ...t })), dismissed: { ...this.dismissed } };
  }

  private emit() {
    this.store.emit({ type: "updates", updates: this.state });
  }

  private save() {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, "state.json"), JSON.stringify({ dismissed: this.dismissed, checkedAt: this.checkedAt, stuck: this.stuck }, null, 2));
  }

  start() {
    // A little after launch, then every six hours; waiting tools are looked at every half minute.
    this.timers.push(setTimeout(() => void this.auto(), 8000));
    this.timers.push(setInterval(() => void this.auto(), EVERY));
    this.timers.push(setInterval(() => void this.next(), 30_000));
  }

  stop() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  /** What runs by itself: a look at what isn't off, then what "auto" does with it. */
  async auto() {
    if (this.modeApp === "off" && this.modeTools === "off") return;
    await this.check({ app: this.modeApp !== "off", tools: this.modeTools !== "off" }).catch(() => {});
    if (this.modeApp === "auto" && this.app.state === "available" && this.app.can === "install") void this.download().catch(() => {});
    if (this.modeTools === "auto") {
      // A failed one gets another go after an hour (the network, a lock), not at every look.
      for (const t of this.tools) if (t.state === "available" || (t.state === "failed" && Date.now() - (t.at ?? 0) > 3600_000 && newer(t.latest, t.current))) this.wanted.add(t.id);
      void this.next();
    }
  }

  /** Looks for what's new (both, when you press Look now); one look at a time. */
  check(parts = { app: true, tools: true }): Promise<Updates> {
    if (this.checking) return this.checking;
    this.checking = this.look(parts);
    this.emit();
    return this.checking;
  }

  private async look(parts: { app: boolean; tools: boolean }) {
    try {
      await Promise.all([parts.app ? this.checkApp() : null, parts.tools ? this.checkTools() : null]);
      this.checkedAt = Date.now();
      this.save();
    } finally {
      this.checking = null;
      this.emit();
    }
    return this.state;
  }

  dismiss(key: string) {
    const tool = this.tools.find((t) => t.id === key);
    if (key === "app") this.dismissed.app = this.app.latest ?? "";
    // "Updated" is news, not an offer: putting it away says nothing about the next version.
    else if (tool && tool.state !== "updated") this.dismissed[key] = tool.latest ?? "";
    // The notice of what already happened goes away for good.
    this.tools = this.tools.map((t) => (t.id === key && (t.state === "updated" || t.state === "failed") ? { ...t, state: newer(t.latest, t.current) ? "available" : "current", from: undefined, error: undefined } : t));
    this.save();
    this.emit();
    return this.state;
  }

  // ---------- Liner Code ----------

  private async github<T>(path: string): Promise<T> {
    const url = `${(this.env.LINER_UPDATE_API || "https://api.github.com").replace(/\/$/, "")}${path}`;
    const headers = { accept: "application/vnd.github+json", "user-agent": `Liner Code/${this.app.current}` };
    try {
      return await getJson<T>(url, headers);
    } catch (e) {
      // A private repository answers 404 to a stranger, and anyone runs out of unsigned requests:
      // the GitHub CLI's sign-in, when you have one, gets through both.
      const status = (e as { status?: number }).status;
      const token = status === 404 || status === 401 || status === 403 ? await this.ghToken() : undefined;
      if (!token) throw e;
      return await getJson<T>(url, { ...headers, authorization: `Bearer ${token}` });
    }
  }

  private async ghToken() {
    if (this.token === null) {
      const gh = which("gh", this.env);
      this.token = gh ? (await run(gh, ["auth", "token"], { env: this.env, timeout: 8000 })).stdout.trim() || undefined : undefined;
    }
    return this.token;
  }

  private async checkApp() {
    if (!this.app.repo) return;
    if (this.app.state === "downloading") return;
    try {
      const r = await this.github<Release>(`/repos/${this.app.repo}/releases/latest`);
      const latest = versionOf(r.tag_name);
      if (!latest) throw new Error(`The latest release's tag (${r.tag_name}) isn't a version.`);
      this.release = r;
      const fresh = newer(latest, this.app.current);
      const staged = this.app.state === "ready" && this.app.latest === latest;
      const stuck = fresh && !staged && this.stuck?.version === latest;
      this.app = {
        ...this.app,
        latest,
        notes: r.body?.trim() || undefined,
        url: r.html_url,
        publishedAt: r.published_at ? Date.parse(r.published_at) : undefined,
        size: pickAsset(r.assets)?.size,
        state: staged ? "ready" : stuck ? "failed" : fresh ? "available" : "current",
        stuck: stuck || undefined,
        error: stuck ? this.stuckError() : undefined,
      };
      if (fresh && !staged && !stuck && !pickAsset(r.assets)) this.app.error = "This release has no download for this Mac yet.";
    } catch (e) {
      const status = (e as { status?: number }).status;
      this.app = { ...this.app, state: this.app.state === "ready" ? "ready" : "failed", stuck: undefined, error: status === 404 ? `No published release in ${this.app.repo} yet.` : `Couldn't reach GitHub: ${(e as Error).message}` };
    }
  }

  /** The staged app from an earlier download, if it's still newer than this one. */
  private readStaged() {
    try {
      const r = JSON.parse(readFileSync(join(this.dir, "ready.json"), "utf8")) as { version: string; app: string };
      if (newer(r.version, this.app.current) && existsSync(r.app)) this.app = { ...this.app, latest: r.version, state: "ready" };
      else this.clearStaged();
    } catch {
      // nothing staged
    }
  }

  private clearStaged() {
    rmSync(join(this.dir, "ready.json"), { force: true });
    rmSync(join(this.dir, APP_NAME), { recursive: true, force: true });
    for (const n of existsSync(this.dir) ? readdirSync(this.dir) : []) if (/^(download-|unpack-)/.test(n)) rmSync(join(this.dir, n), { recursive: true, force: true });
  }

  download(): Promise<Updates> {
    if (this.app.can !== "install") return Promise.reject(new Error(this.app.can === "source" ? "This copy runs from source: pull and build it instead." : "Move Liner Code to Applications to update it in place."));
    if (this.app.state === "ready") return Promise.resolve(this.state);
    this.downloading ??= this.fetchApp().finally(() => {
      this.downloading = null;
      this.emit();
    });
    return this.downloading.then(() => {
      if (this.app.state === "failed") throw new Error(this.app.error ?? "The download didn't finish.");
      return this.state;
    });
  }

  private async fetchApp() {
    if (!this.release || this.app.state !== "available") await this.checkApp();
    const r = this.release;
    const version = this.app.latest;
    const asset = r && pickAsset(r.assets);
    if (!r || !version || !asset || !newer(version, this.app.current)) return;
    const fail = (error: string) => {
      this.app = { ...this.app, state: "failed", progress: undefined, error };
      this.clearStaged();
    };
    this.clearStaged();
    mkdirSync(this.dir, { recursive: true });
    this.app = { ...this.app, state: "downloading", progress: 0, error: undefined, size: asset.size };
    this.emit();
    try {
      const want = asset.digest?.startsWith("sha256:") ? asset.digest.slice(7).toLowerCase() : await this.sidecarSum(r, asset);
      if (!want) return fail("This release has no SHA-256 for its download, so it can't be checked. Get it from the release page instead.");
      const zip = join(this.dir, `download-${version}.zip`);
      const got = await this.stream(asset, zip);
      if (got !== want) return fail("The download didn't match the release's SHA-256. Nothing was changed.");
      const out = join(this.dir, `unpack-${version}`);
      const unzip = await run("ditto", ["-x", "-k", zip, out], { timeout: 10 * 60_000 });
      rmSync(zip, { force: true });
      if (unzip.code !== 0) return fail(`The download didn't unpack: ${short(unzip.stderr)}`);
      const app = join(out, APP_NAME);
      const bad = await this.verify(app, version);
      if (bad) return fail(bad);
      renameSync(app, join(this.dir, APP_NAME));
      rmSync(out, { recursive: true, force: true });
      writeFileSync(join(this.dir, "ready.json"), JSON.stringify({ version, app: join(this.dir, APP_NAME), at: Date.now() }, null, 2));
      this.app = { ...this.app, state: "ready", progress: 1 };
    } catch (e) {
      fail(`The download stopped: ${(e as Error).message}`);
    }
  }

  /** "<zip>.sha256" beside the zip: its first word. */
  private async sidecarSum(r: Release, asset: Asset) {
    const side = r.assets.find((a) => a.name === `${asset.name}.sha256`);
    if (!side) return undefined;
    const text = (await this.fetchAsset(side)).toString("utf8");
    return /^[0-9a-f]{64}/i.exec(text.trim())?.[0].toLowerCase();
  }

  private async assetResponse(asset: Asset) {
    // The API's own address for an asset works for public and private releases alike.
    const headers: Record<string, string> = { accept: "application/octet-stream", "user-agent": `Liner Code/${this.app.current}` };
    let res = await fetch(asset.url, { headers, redirect: "follow" });
    if (res.status === 404 || res.status === 401 || res.status === 403) {
      const token = await this.ghToken();
      if (token) res = await fetch(asset.url, { headers: { ...headers, authorization: `Bearer ${token}` }, redirect: "follow" });
    }
    if (!res.ok || !res.body) throw new Error(`${res.status} for ${asset.name}`);
    return res;
  }

  private async fetchAsset(asset: Asset) {
    return Buffer.from(await (await this.assetResponse(asset)).arrayBuffer());
  }

  /** Streams an asset to a file, hashing it on the way; the SHA-256 in hex. */
  private async stream(asset: Asset, file: string) {
    const res = await this.assetResponse(asset);
    const total = Number(res.headers.get("content-length")) || asset.size || 0;
    const hash = createHash("sha256");
    const out = createWriteStream(file);
    let done = 0;
    let told = 0;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      hash.update(chunk);
      done += chunk.byteLength;
      if (!out.write(chunk)) await new Promise<void>((r) => out.once("drain", () => r()));
      if (total && Date.now() - told > 250) {
        told = Date.now();
        this.app = { ...this.app, progress: Math.min(0.99, done / total) };
        this.emit();
      }
    }
    await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())));
    return hash.digest("hex");
  }

  /** Why an unpacked app isn't the one to put in, or nothing. */
  private async verify(app: string, version: string) {
    if (!existsSync(join(app, "Contents/Info.plist"))) return `The download has no ${APP_NAME} at its top.`;
    const read = async (key: string) => (await run("plutil", ["-extract", key, "raw", "-o", "-", join(app, "Contents/Info.plist")])).stdout.trim();
    if ((await read("CFBundleIdentifier")) !== BUNDLE_ID) return "The download isn't Liner Code (its bundle id is different).";
    const v = await read("CFBundleShortVersionString");
    if (v !== version) return `The download says it's ${v || "no version"}, not ${version}.`;
    const sig = await run("codesign", ["--verify", "--deep", "--strict", app], { timeout: 120_000 });
    if (sig.code !== 0) return `The download's signature is broken: ${short(sig.stderr)}`;
    // A signature only says the files weren't changed since someone signed them. Once this copy is
    // signed by a developer, an update has to come from the same one; an ad-hoc copy (the alphas)
    // takes the first signed release, and from then on it's pinned.
    const mine = this.bundle ? await teamOf(this.bundle) : undefined;
    if (mine) {
      const theirs = await teamOf(app);
      if (theirs !== mine) return `The download is signed by ${theirs ? `another developer (${theirs})` : "nobody you know"}, not by ${mine}, who signed this copy.`;
    }
    return null;
  }

  // ---------- The agent tools ----------

  private async checkTools() {
    const found = await Promise.all(
      TOOLS.map(async (spec): Promise<ToolUpdate | null> => {
        const path = which(spec.bin, this.env);
        if (!path) return null;
        let real = path;
        try {
          real = realpathSync(path);
        } catch {
          // a broken link: the updater may still mend it
        }
        const argv = spec.updater(path, real);
        const had = this.tools.find((t) => t.id === spec.id);
        // A look doesn't disturb an update that's running.
        if (had?.state === "updating") return had;
        const current = versionOf((await run(path, ["--version"], { env: this.env, timeout: 10_000, input: "" })).stdout) ?? had?.current;
        const command = argv ? [argv[0] === path ? spec.bin : basename(argv[0]), ...argv.slice(1)].join(" ") : "";
        const base: ToolUpdate = { id: spec.id, label: spec.label, current, command, state: "current" };
        if (!argv) return { ...base, error: "Liner Code doesn't know how this copy was installed, so it can't update it." };
        let latest: string | undefined;
        try {
          latest = (await spec.latest(path, this.env)) ?? current;
        } catch (e) {
          return { ...base, latest: had?.latest, state: had && newer(had.latest, current) ? "available" : "current", error: `Couldn't see what's new: ${(e as Error).message}` };
        }
        const fresh = newer(latest, current);
        // What happened stays on show until you put it away: done while nothing newer is out, failed while it still is.
        if ((had?.state === "updated" && !fresh) || (had?.state === "failed" && fresh)) return { ...had, current, latest };
        return { ...base, latest, state: fresh ? (this.wanted.has(spec.id) ? "waiting" : "available") : "current" };
      }),
    );
    this.tools = found.filter((t): t is ToolUpdate => Boolean(t));
  }

  /** Asks for a tool's update (every tool with one, without an id); it runs once nothing works on it. */
  updateTool(id?: BuiltinProvider) {
    const asked = this.tools.filter((t) => (!id || t.id === id) && (t.state === "available" || t.state === "failed") && newer(t.latest, t.current));
    if (id && !asked.length) throw new Error("There's nothing newer to update to.");
    for (const t of asked) this.wanted.add(t.id);
    void this.next();
    return this.state;
  }

  /** Runs the next wanted tool whose sessions are all idle, one at a time; the rest wait their turn. */
  private async next(): Promise<void> {
    let changed = false;
    const wait = (t: ToolUpdate, busy: number) => {
      if (t.state === "waiting" && t.busy === busy) return;
      Object.assign(t, { state: "waiting", busy });
      changed = true;
    };
    // While one runs, the others asked for say they're waiting (behind it, or for their sessions).
    const ready = this.running ? undefined : this.tools.find((t) => this.wanted.has(t.id) && this.busy.working(t.id) === 0);
    for (const t of this.tools) if (this.wanted.has(t.id) && t !== ready && t.id !== this.running) wait(t, this.busy.working(t.id));
    if (!ready) {
      if (changed) this.emit();
      return;
    }
    this.wanted.delete(ready.id);
    this.running = ready.id;
    Object.assign(ready, { state: "updating", busy: undefined, error: undefined });
    this.emit();
    try {
      await this.runUpdate(ready);
    } finally {
      this.running = null;
    }
    this.emit();
    this.onTools();
    return this.next();
  }

  private async runUpdate(t: ToolUpdate) {
    const spec = TOOLS.find((s) => s.id === t.id);
    const path = spec && which(spec.bin, this.env);
    if (!spec || !path) return void Object.assign(t, { state: "failed", error: `${t.label} isn't on this Mac any more.`, at: Date.now() });
    let real = path;
    try {
      real = realpathSync(path);
    } catch {
      // as is
    }
    const argv = spec.updater(path, real);
    if (!argv) return void Object.assign(t, { state: "failed", error: "Liner Code can't update this copy.", at: Date.now() });
    const before = t.current;
    // Its stdin is closed at once, so an updater that would stop to ask goes on (or fails) instead of hanging.
    const r = await run(argv[0], argv.slice(1), { env: this.env, timeout: 15 * 60_000, input: "" });
    const now = versionOf((await run(path, ["--version"], { env: this.env, timeout: 10_000, input: "" })).stdout);
    if (now && newer(now, before)) {
      Object.assign(t, { state: "updated", from: before, current: now, latest: newer(t.latest, now) ? t.latest : now, at: Date.now() });
      this.busy.restartIdle(t.id);
    } else if (r.code !== 0) Object.assign(t, { state: "failed", error: short(r.stderr || r.stdout) || `${t.command} stopped (${r.code}).`, at: Date.now() });
    // It ran fine and stayed where it was: its own channel has nothing newer for it.
    else Object.assign(t, { state: "current", latest: now ?? t.latest, at: Date.now() });
  }
}
