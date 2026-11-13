/*
  Ported DeepSeek Harness plugins' Node halves, from the engine's side: one process each
  (dsh-host.ts), started when its frame first opens, stopped when it's turned off, removed or
  replaced, and when Liner Code quits. None of it runs in the engine.

  Its frame reaches it at /dsh/<token>/ on the engine's own address: a token made for this run,
  which only that frame's document is given, and which reaches that plugin and nothing else. The
  engine passes each request on to the process's 127.0.0.1 port with the run's secret, and answers
  the package's pictures (plugins/<package>/assets/…) from its kept files itself, as DSH's /plugins
  route does. The frame's origin is opaque, so these answers say any origin may read them: the
  token is what's guarded.

  On a Mac the process runs under a sandbox (sandbox-exec): it reads what you can, but not your
  keys (.ssh, .aws, keychains and the like) nor Liner Code's own state beyond its add-on; it writes
  as it likes only in a folder of its own (DSH_HOME, ~/.liner-code/dsh/<id>, its temporary folder
  inside); a plugin with a page also keeps pictures, sound, video, PDFs and plain text, and saves
  again over them, in a folder Liner Code makes for it in your Documents (~/Documents/Media Desk);
  elsewhere in Documents, Downloads, Desktop, Pictures, Movies and Music it may only add new
  pictures, sound, video and PDFs, and make no folders. It connects to no other program's unix
  socket. It gets your PATH and home, never the engine's keys or token, and none of the
  environment's API keys. Elsewhere (Windows, Linux) it runs with no sandbox, and its card says so.

  Its model calls are an app's: the model you picked for it (Settings.addonModels), asked as just a
  model through the engine (api.ts, aiFor), with the same limits, streamed back to it.

  The tools it gives an agent reach yours as an MCP server: each agent tool starts dsh-mcp.ts, a
  small stdio server of Liner Code's, which brings the agent's calls to /dsh/<agent token>/mcp on
  the engine (a token of its own, never a frame's), and the engine to the plugin's process over
  IPC, starting it if it isn't running. Only the tools its card named are offered or run, and only
  while its add-on is on; each is described, and agents are told what it says, in the words its
  card showed (or, where its code didn't spell them out, its program's, as the card says).
*/
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, lstatSync, mkdirSync, openSync, closeSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync, writeSync, ftruncateSync, fstatSync, type Dirent } from "node:fs";
import { request, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { DshFrame, DshInstructions, DshTool, PanelManifest } from "../../contracts/src/index.ts";
import { DSH_TOKEN } from "../../contracts/src/index.ts";
import type { Addons, Connection } from "./addons.ts";
import { killTree } from "./exec.ts";
import { groupsGone } from "./launch.ts";

/** A tool as MCP lists it. */
type McpTool = { name: string; description: string; inputSchema: unknown };
/** What a call comes back as, for the agent: MCP's CallToolResult. */
type CallResult = { content: { type: string; [k: string]: unknown }[]; isError?: boolean };
type Run = { id: string; version: number; child: ChildProcess; secret: string; ready: Promise<number>; port?: number; error?: string; log: number; tools: McpTool[]; instructions: string; calls: Map<string, (r: CallResult) => void>; notice?: string };
/** A ported plugin with a program, as its manifest has it: a page's or a connection's. */
type Dsh = { id: string; name: string; dsh: { package: string; host?: string; config?: Record<string, unknown>; tools?: DshTool[]; instructions?: DshInstructions; slot?: string } };
type Ask = (addon: string, name: string, o: { prompt: string; system?: string; call: string; onText: (t: string) => void }) => Promise<{ text: string }>;

/** A call of a plugin's, named for it: a name it chose can't be another app's. */
const callOf = (id: string, call: string) => `dsh:${id}:${call.slice(0, 80)}`;
const PICTURES: Record<string, string> = { ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif" };
const LOG_MAX = 1_000_000;
const START_WAIT = 25_000;
/** The calls an agent may have running in one plugin at once, and the most a call's arguments may weigh. */
const CALLS_MAX = 16;
const BODY_MAX = 4_000_000;

/**
  Ends a plugin's program and what it started: its process group on a Mac or Linux; on Windows,
  which has none, its whole tree with taskkill /T, as the rest of the engine does (exec.ts, killTree).
*/
function end(child: ChildProcess, sig: NodeJS.Signals) {
  if (process.platform === "win32") return void killTree(child);
  try {
    if (child.pid) process.kill(-child.pid, sig);
    else child.kill(sig);
  } catch {
    // Gone already.
  }
}

/**
  What its program tells your agents (its systemPrompt sections, as it runs): only the sections its
  card showed, word for word, unless the card said some are worked out as it runs.
*/
export function told(card: DshInstructions | undefined, sections: unknown[]) {
  const shown = new Set(card?.texts ?? []);
  return sections
    .filter((t): t is string => typeof t === "string" && !!t.trim() && (card?.live === true || shown.has(t)))
    .join("\n\n")
    .slice(0, 8000);
}

const TYPES = new Set(["object", "array", "string", "number", "integer", "boolean", "null"]);
const SCHEMA_KEYS = new Set(["type", "properties", "required", "items", "prefixItems", "enum", "const", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "pattern", "format", "minItems", "maxItems", "uniqueItems", "minProperties", "maxProperties", "additionalProperties", "anyOf", "oneOf", "allOf", "not", "nullable", "default", "description", "title"]);
const PROPERTY = /^[A-Za-z0-9_.$-]{1,64}$/;

/**
  A tool's input schema as your agents get it, from its program as it runs (none is read at
  install: its parameters are worked out from DSH's schema language as it starts). Its shape is
  kept (types, properties, required, items, enums, bounds); its free text is cut down (a
  description to 300 characters, a title to 60, 6000 in all, whitespace run together); an enum, a
  const or a default with a long word in it goes, as do examples, comments, x-… and anything else a
  program could fill with words; a property whose name isn't a name goes; and past 8 levels, nothing.
*/
export function tidySchema(v: unknown): Record<string, unknown> {
  let budget = 6000;
  const text = (s: unknown, max: number) => {
    if (typeof s !== "string" || budget <= 0) return undefined;
    const t = s.replace(/\s+/g, " ").trim().slice(0, Math.min(max, budget));
    budget -= t.length;
    return t || undefined;
  };
  const word = (x: unknown) => typeof x === "number" || typeof x === "boolean" || x === null || (typeof x === "string" && x.length <= 100);
  const walk = (s: unknown, depth: number): Record<string, unknown> | boolean => {
    if (typeof s === "boolean") return s;
    if (!s || typeof s !== "object" || Array.isArray(s) || depth > 8) return {};
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(s as Record<string, unknown>)) {
      if (!SCHEMA_KEYS.has(k)) continue;
      if (k === "description" || k === "title") {
        const t = text(x, k === "title" ? 60 : 300);
        if (t) out[k] = t;
      } else if (k === "type") {
        const ty = Array.isArray(x) ? x.filter((t) => typeof t === "string" && TYPES.has(t)) : typeof x === "string" && TYPES.has(x) ? x : undefined;
        if (ty !== undefined) out.type = ty;
      } else if (k === "properties" && x && typeof x === "object" && !Array.isArray(x)) out.properties = Object.fromEntries(Object.entries(x).filter(([n]) => PROPERTY.test(n)).slice(0, 64).map(([n, y]) => [n, walk(y, depth + 1)]));
      else if (k === "required" && Array.isArray(x)) out.required = x.filter((n) => typeof n === "string" && PROPERTY.test(n)).slice(0, 64);
      else if (k === "items" || k === "additionalProperties" || k === "not") out[k] = walk(x, depth + 1);
      else if ((k === "anyOf" || k === "oneOf" || k === "allOf" || k === "prefixItems") && Array.isArray(x)) out[k] = x.slice(0, 16).map((y) => walk(y, depth + 1));
      else if (k === "enum" && Array.isArray(x)) {
        if (x.length <= 64 && x.every(word)) out.enum = x;
      } else if (k === "const" || k === "default") {
        if (word(x)) out[k] = x;
      } else if (k === "pattern") {
        if (typeof x === "string" && x.length <= 200) out.pattern = x;
      } else if (k === "format") {
        if (typeof x === "string" && /^[a-z0-9-]{1,32}$/i.test(x)) out.format = x;
      } else if (typeof x === "number" || typeof x === "boolean") out[k] = x;
    }
    return out;
  };
  const top = walk(v, 0);
  return typeof top === "object" ? { ...top, type: "object" } : { type: "object" };
}

/** SBPL's quoting for a path. */
const q = (p: string) => `"${p.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
/** Where a path leads, links on the way followed; for one that isn't there yet, where its nearest folder that is leads, and the rest. */
const real = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    const up = dirname(p);
    return up === p ? p : join(real(up), basename(p));
  }
};

/**
  What a plugin's program may add to the folders you keep things in: pictures, sound, video and
  PDFs, which nothing runs, nor reads as settings or instructions. No SVG (it can carry script), no
  code, config or Markdown (a conftest.py, a vite.config.ts, a CLAUDE.md all run or steer what runs
  later), and nothing without one of these at the end of its name (a Makefile, a justfile).
*/
export const INERT = ["png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "avif", "tif", "tiff", "bmp", "mp3", "m4a", "aac", "wav", "aif", "aiff", "flac", "ogg", "oga", "opus", "caf", "mp4", "m4v", "mov", "webm", "mkv", "avi", "pdf"];
/** Your folders a plugin's program may add those to. */
export const KEPT = ["Documents", "Downloads", "Desktop", "Pictures", "Movies", "Music"];
/** What it may also keep, and write over, in a folder named for it there: plain text (Media Desk saves its script as script.md). */
export const TEXT = ["md", "txt"];
/**
  Names an agent reads as its instructions in a folder it works in or reads from (Claude Code's
  CLAUDE.md, Codex's and OpenCode's AGENTS.md, Gemini's GEMINI.md), and text files a build or an
  install runs from (CMakeLists.txt, requirements.txt): never written, in any case, even in a
  folder named for the plugin.
*/
const STEERS = ["claude", "claude.local", "agents", "agents.override", "agent", "gemini"];
/** Folders that hold projects by their name: never a plugin's, whatever it's called. */
const ROOTS = new Set(["code", "projects", "project", "developer", "dev", "src", "source", "repos", "repositories", "github", "gitlab", "git", "work", "workspace", "workspaces", "sites", "android", "androidstudioprojects", "xcode", "documents", "downloads", "desktop", "pictures", "movies", "music", "library", "applications"]);
/** What says a folder holds a repository or a project. */
const MARKERS = /^(?:\.git|\.hg|\.svn|\.claude|\.vscode|\.idea|package\.json|pyproject\.toml|setup\.py|requirements\.txt|cargo\.toml|go\.mod|gemfile|makefile|gnumakefile|cmakelists\.txt|pom\.xml|build\.gradle(?:\.kts)?|composer\.json|deno\.jsonc?|package\.swift|claude\.md|agents\.md|.*\.(?:xcodeproj|xcworkspace|sln|csproj))$/i;

/** Whether a folder holds a repository or a project, a few levels down; one too big to look through counts as one. */
function holdsProject(dir: string, depth = 6, budget = { left: 20_000 }): boolean {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  if ((budget.left -= entries.length) < 0) return true;
  if (entries.some((d) => MARKERS.test(d.name))) return true;
  return depth > 1 && entries.some((d) => d.isDirectory() && !d.name.startsWith(".") && holdsProject(join(dir, d.name), depth - 1, budget));
}

/** Folder names that are bundles a click runs, or code a runtime loads by its name: never made in a plugin's folder. */
const BUNDLES = /^(?:node_modules|bower_components|jspm_packages|__pycache__|site-packages|dist-packages|venv|virtualenv|vendor|pods|carthage|.*\.(?:app|appex|command|tool|terminal|workflow|action|bundle|framework|plugin|kext|pkg|mpkg|xpc|prefpane|saver|qlgenerator|mdimporter|component|vst3?|scptd|wdgt|xcodeproj|xcworkspace|playground|lproj|dsym|egg|egg-info|dist-info))$/i;
/** A name a plugin's folder may be called, or a folder in it: no dot first, no slash, not a project's or a bundle's. */
const subName = (n: string) => /^\S/.test(n) && n.length <= 120 && !/[/\\\0:]/.test(n) && !n.startsWith(".") && !BUNDLES.test(n);
/** What a plugin's own folder may be called: a folder's name, under 60, and none project folders are called. */
const plainName = (n: string) => subName(n) && n.length <= 60 && n.trim() === n && !ROOTS.has(n.toLowerCase());

/** The folders Liner Code made for each plugin, kept beside its add-on, where its program can't write. */
type Made = { made: { path: string; ino: number; at: number }[] };
const madeIn = (record: string): Made => {
  try {
    const v = JSON.parse(readFileSync(record, "utf8")) as Made;
    return { made: Array.isArray(v?.made) ? v.made.filter((x) => x && typeof x.path === "string" && typeof x.ino === "number") : [] };
  } catch {
    return { made: [] };
  }
};

/**
  Where a plugin keeps what it saves: ~/Documents/<its name> (Media Desk saves to ~/Documents/Media
  Desk; its id when its name won't do), and only a folder Liner Code made for it and keeps in its
  record (folders.json beside its add-on, which its program can't write), the same folder still
  (by its inode). Never one that was there already, which would be yours (a plugin called "Notes"
  doesn't get your ~/Documents/Notes), nor a link, nor one that is, holds or sits in a project, one
  of yours in Liner Code or a repository. With `make`, one that isn't there yet is made and kept.
  `path`, where it would be, for its card; `why`, why it gets none.
*/
export function savesFolder(home: string, names: string[], record: string, o: { projects?: string[]; make?: boolean } = {}): { dir?: string; path?: string; why?: string } {
  const name = names.map((n) => n.trim()).find(plainName);
  if (!name) return { why: "its name isn't one a folder of yours can be given" };
  const path = join(home, "Documents", name);
  const at = real(path);
  if (o.projects?.map(real).some((p) => p === at || at.startsWith(`${p}/`) || p.startsWith(`${at}/`))) return { path, why: "it is, holds or sits in one of your projects" };
  const kept = madeIn(record);
  let st: ReturnType<typeof lstatSync> | null = null;
  try {
    st = lstatSync(path);
  } catch {
    // Not there: Liner Code makes it.
  }
  if (st) {
    if (st.isSymbolicLink() || !st.isDirectory()) return { path, why: "something else is there already" };
    if (!kept.made.some((x) => x.path === path && x.ino === st.ino)) return { path, why: "a folder of that name was there already, and Liner Code didn't make it, so it stays yours" };
    if (holdsProject(path)) return { path, why: "it holds a repository, a project or instructions for agents now" };
    return { dir: path, path };
  }
  if (!o.make) return { path };
  try {
    mkdirSync(path);
    const ino = lstatSync(path).ino;
    mkdirSync(dirname(record), { recursive: true });
    writeFileSync(record, JSON.stringify({ made: [...kept.made.filter((x) => x.path !== path), { path, ino, at: Date.now() }] }));
    return { dir: path, path };
  } catch (e) {
    return { path, why: `it couldn't be made: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
  A folder its program asks for in the one Liner Code made for it (dsh-host.ts sends fs.mkdir
  there): made by the engine, a name at a time, each plain and none a bundle or a package's, through
  folders only (no link on the way). The sandbox makes no folder there itself, so nothing built
  elsewhere can be moved in whole. Answers as mkdir would: the first folder made, or an error's code.
*/
export function makeIn(named: string | undefined, path: string, recursive: boolean): { first?: string; error?: string; code?: string } {
  const no = (code: string, error: string) => ({ code, error: `${code}: ${error}, mkdir '${path}'` });
  if (!named || !isAbsolute(path)) return no("EPERM", "operation not permitted");
  const rel = relative(named, resolve(path));
  if (!rel) return recursive ? {} : no("EEXIST", "file already exists");
  const parts = rel.split(sep);
  if (rel.startsWith("..") || isAbsolute(rel) || parts.length > 12 || !parts.every(subName)) return no("EPERM", "operation not permitted");
  let at = named;
  let first: string | undefined;
  for (const [i, p] of parts.entries()) {
    at = join(at, p);
    let st: ReturnType<typeof lstatSync> | null = null;
    try {
      st = lstatSync(at);
    } catch {
      // Not there yet.
    }
    if (st) {
      if (st.isSymbolicLink() || !st.isDirectory()) return no(i === parts.length - 1 ? "EEXIST" : "ENOTDIR", i === parts.length - 1 ? "file already exists" : "not a directory");
      if (i === parts.length - 1 && !recursive) return no("EEXIST", "file already exists");
      continue;
    }
    if (!recursive && i < parts.length - 1) return no("ENOENT", "no such file or directory");
    try {
      mkdirSync(at);
    } catch (e) {
      return no((e as NodeJS.ErrnoException).code ?? "EPERM", e instanceof Error ? e.message : String(e));
    }
    first ??= at;
  }
  return recursive && first ? { first } : {};
}
/** A plugin's own folder: its DSH_HOME, where it writes as it likes. */
export const ownDir = (dshHome: string, id: string) => join(dshHome, id);
const anyCase = (s: string) => [...s].map((c) => (/[a-z]/.test(c) ? `[${c}${c.toUpperCase()}]` : c)).join("");

/**
  The sandbox a plugin's process runs under on a Mac: everything as you, but no reading your keys,
  your agents' sign-ins or Liner Code's state, and writes by an allowlist, not a denylist:
  - in its own folder (its DSH_HOME, its TMPDIR inside), anything;
  - in your Documents, Downloads, Desktop, Pictures, Movies and Music, only a new file of an inert
    kind (INERT), and no name starting with a dot anywhere on the way. A file that's there already
    isn't written over, cut short, renamed or removed. No folder at all: SBPL can't tell a mkdir
    from a folder built elsewhere and moved in whole, whose insides nothing would check (a
    node_modules/.bin, an Evil.app). Nor a clone (clonefile), which is judged by where it's from.
    What SBPL can't see either is whether a folder holds a repository or a project, so these rules
    carry that: nothing a repository's tools run or read (a conftest.py, a Makefile, a .git or
    .claude folder) can be made, and its existing files can't be changed;
  - in the folder Liner Code made for it there (`named`: ~/Documents/Media Desk, by savesFolder),
    plain text too (.md, .txt), and it may write over those files' bytes, so Save saves again; still
    never code or settings, a dotfile, a link, nor what an agent reads as instructions (CLAUDE.md,
    AGENTS.md) or a build runs (CMakeLists.txt, requirements.txt). Folders in it are made by the
    engine when it asks (makeIn), each name checked, never by itself;
  - nowhere else: not the temporary folders other programs keep projects in (/tmp, /var/folders).
  It connects to no unix socket but DNS's (mDNSResponder) and its own: not ssh-agent's, Docker's or
  any other program's. The internet and localhost ports it reaches, as the card says.
  None of the programs that would start something outside it run (open, osascript, launchctl,
  security, shortcuts, automator), nor anything from where it writes (a copy of open would be the
  same program), nor does it map code from there; nor does it change other apps' settings. Writes
  of a new file's mode and dates are allowed with it (copyFile sets them), and so on an existing
  picture too: those, not what's in it. A sandbox narrows what a program does, not who wrote it:
  the card asks you to trust where it's from.
*/
export function sandboxProfile(o: { home: string; linerHome: string; own: string; addonDir: string; named?: string[] }) {
  const h = (p: string) => join(o.home, p);
  // A folder that's a link (dotfiles kept elsewhere) is ruled by where it leads, and by its own name.
  const both = (p: string) => [...new Set([p, real(p)])];
  const sub = (ps: string[]) => ps.map((p) => `(subpath ${q(p)})`).join(" ");
  const own = [o.own, "/dev"].flatMap(both);
  const kept = KEPT.map(h).flatMap(both);
  const inKept = `(require-any ${sub(kept)})`;
  // No component on the way may start with a dot: .git, .claude, .vscode, .husky, node_modules/.bin, .envrc.
  const plain = '(require-not (regex #"/\\."))';
  const inert = `(regex #"\\.(${INERT.map(anyCase).join("|")})$")`;
  // The folder made for it (savesFolder): its pictures and the like, and plain text, which it may write over.
  const named = (o.named ?? []).flatMap(both);
  const steers = `(regex #"/(${STEERS.map((n) => anyCase(n).replace(/\./g, "\\.")).join("|")})\\.${anyCase("md")}$")`;
  const builds = `(regex #"/(${anyCase("cmakelists")}|[^/]*${anyCase("requirements")}[^/]*|[^/]*${anyCase("constraints")}[^/]*)\\.${anyCase("txt")}$")`;
  const kept2 = `(require-all (require-any ${sub(named)}) (vnode-type REGULAR-FILE) (regex #"\\.(${[...INERT, ...TEXT].map(anyCase).join("|")})$") ${plain} (require-not ${steers}) (require-not ${builds}))`;
  const secret = [
    ...[".ssh", ".aws", ".gnupg", ".kube", ".docker", ".config", ".azure", ".netrc", ".npmrc", ".pypirc", ".git-credentials", ".gitconfig", ".claude", ".claude.json", ".codex", ".cursor", ".gemini", ".hermes", ".local/share", ".zsh_history", ".bash_history", ".zshrc", ".bashrc", ".profile", ".zprofile", ".env"].map(h),
    ...["Keychains", "Cookies", "Mail", "Messages", "Safari", "Application Support/Google", "Application Support/Firefox", "Application Support/Arc", "Application Support/BraveSoftware", "Application Support/Claude", "Application Support/Liner Code", "Application Support/Code/User"].map((p) => h(`Library/${p}`)),
    o.linerHome,
  ].flatMap(both);
  return [
    "(version 1)",
    "(allow default)",
    '(deny file-write* (subpath "/"))',
    `(allow file-write* ${sub(own)})`,
    // Your folders: a new file of an inert kind. file-write* (copyFile needs more of it than create
    // and mode), then, by name (a rule naming an operation outranks file-write*), none of what changes
    // a file that's there: its bytes (write, append, truncate), its name (unlink, rename over), its
    // flags, owner or ACL, and no hard link to it. No folder: nothing allows one.
    `(allow file-write* (require-all ${inKept} (vnode-type REGULAR-FILE) ${inert} ${plain}))`,
    `(deny file-write-data file-write-unlink file-write-flags file-write-owner file-write-setugid file-write-acl file-link file-revoke ${inKept})`,
    // A clone is judged by where it's from (its own folder), so none, anywhere; copyFile copies.
    "(deny file-clone)",
    // In the folder made for it, text too, and writing over what's there: its bytes only. A rule
    // naming an operation outranks file-write* whatever the order, so file-write-data is named to
    // undo the deny above; unlink, flags, links and the rest stay denied there.
    ...(named.length ? [`(allow file-write* ${kept2})`, `(allow file-write-data ${kept2})`] : []),
    // What's in them, not that they're there: Node looks up each folder on a path as it loads a file.
    `(deny file-read-data ${sub(secret)})`,
    // The same operation as the rule above, or it doesn't take its place.
    `(allow file-read-data ${sub([o.addonDir, o.own].flatMap(both))})`,
    // What would start something outside the sandbox, and anything from where it writes (a copy of open is open).
    `(deny process-exec (literal "/usr/bin/open") (literal "/usr/bin/osascript") (literal "/bin/launchctl") (literal "/usr/bin/security") (literal "/usr/bin/sudo") (literal "/usr/sbin/installer") (literal "/usr/bin/shortcuts") (literal "/usr/bin/automator") ${sub([o.own, ...kept].flatMap(both))})`,
    `(deny file-map-executable ${sub([o.own, ...kept].flatMap(both))})`,
    // Other apps' settings, which cfprefsd writes for it outside the sandbox.
    "(deny user-preference-write)",
    // A unix socket is a path (the internet and localhost ports have none): only DNS's and its own.
    '(deny network-outbound (subpath "/"))',
    `(allow network-outbound (literal "/private/var/run/mDNSResponder") ${sub([o.own].flatMap(both))})`,
  ].join("\n");
}

/** Whether a ported plugin's program runs under a sandbox here: on a Mac, with sandbox-exec. */
export const sandboxed = (platform: NodeJS.Platform = process.platform) => platform === "darwin" && existsSync("/usr/bin/sandbox-exec");

/** What the sandbox lets its program do, in words, for the card: null where there's none (not a Mac). */
export const sandboxWords = (platform: NodeJS.Platform = process.platform) =>
  sandboxed(platform)
    ? "Runs as you, in a process of its own, and reaches the internet and every port on this Mac (localhost), but no other program's socket (ssh-agent's, Docker's). A sandbox keeps it from your keys, your sign-ins, Liner Code's state and other apps. It writes as it likes only in a folder of its own. In a folder Liner Code makes for it in your Documents it may keep and save again pictures, sound, video, PDFs and plain text; elsewhere in your Documents, Downloads, Desktop, Pictures, Movies and Music it may only add new pictures, sound, video and PDFs, never change a file that's there, and make no folders. Never code, settings or agents' instructions."
    : null;

export class DshHosts {
  private addons: Addons;
  private env: NodeJS.ProcessEnv;
  private linerHome: string;
  private runs = new Map<string, Run>();
  /** This run's tokens, both ways: one per add-on, made when its frame first asks. */
  private tokens = new Map<string, string>();
  private ids = new Map<string, string>();
  /** Calls its process is waiting on, to stop when it asks or goes. */
  private asking = new Map<string, { id: string }>();
  /** This run's tokens for your agents' tool calls, one per add-on: never a frame's, nor given to one. */
  private agentTokens = new Map<string, string>();
  private agentIds = new Map<string, string>();
  /** The engine's own address (http://127.0.0.1:<port>), where an agent's MCP server brings its calls; set once it listens. */
  url?: string;
  /** The model an app asks: answered by api.ts (aiFor), set once the API is made. */
  ask?: Ask;
  cancel?: (call: string) => void;
  modelOf?: (addon: string) => string | null;
  /** Off for a test: no sandbox. */
  sandbox = sandboxed();
  /** Your projects' folders (and sessions' worktrees): a folder named for a plugin is never one of them, nor in or round one. */
  projects?: () => string[];
  readonly dshHome: string;

  constructor(addons: Addons, env: NodeJS.ProcessEnv, linerHome: string) {
    this.addons = addons;
    this.env = env;
    this.linerHome = linerHome;
    this.dshHome = join(linerHome, "dsh");
    // The tools a ported plugin gives your agents reach them as a connection of its own.
    addons.dshTools = (id, name) => this.connection(id, name);
  }

  /**
    What an agent tool starts for a plugin's tools: Liner Code's MCP server on stdio (dsh-mcp.ts),
    told where to bring its calls by its environment, never its command line. None before the
    engine listens.
  */
  connection(id: string, name: string): Connection | null {
    if (!this.url) return null;
    let token = this.agentTokens.get(id);
    if (!token) {
      token = randomBytes(16).toString("hex");
      this.agentTokens.set(id, token);
      this.agentIds.set(token, id);
    }
    // Under the Electron shell process.execPath is the app itself, which is a Node only when told so.
    const electron: Record<string, string> = process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {};
    return { name: id, stdio: { command: process.execPath, args: [fileURLToPath(new URL("./dsh-mcp.ts", import.meta.url))], env: { ...electron, LINER_DSH_URL: `${this.url}/dsh/${token}/mcp`, LINER_DSH_NAME: name } } };
  }

  /** A model picked or changed: each process hears it, for its currentSelection(). */
  models() {
    for (const r of this.runs.values()) r.child.connected && r.child.send({ t: "model", model: this.modelOf?.(r.id) ?? null });
  }

  /** The add-ons changed: a process whose add-on is off, removed or on another version stops. */
  changed() {
    for (const r of [...this.runs.values()]) {
      const m = this.addons.dshOf(r.id);
      if (!m?.dsh.host || this.addons.get(r.id)?.version !== r.version) this.stop(r.id);
    }
  }

  /** What a ported plugin's frame needs to start: its token's path, and its Node half up (or why not). */
  async frame(m: PanelManifest, version: number): Promise<DshFrame> {
    const dsh = m.dsh!;
    let token = this.tokens.get(m.id);
    if (!token) {
      token = randomBytes(16).toString("hex");
      this.tokens.set(m.id, token);
      this.ids.set(token, m.id);
    }
    const out: DshFrame = { package: dsh.package, slot: dsh.slot, ...(dsh.config ? { config: dsh.config } : {}), base: `/dsh/${token}/` };
    if (!dsh.host) return out;
    try {
      await this.start({ id: m.id, name: m.name, dsh }, version);
    } catch (e) {
      out.error = e instanceof Error ? e.message : String(e);
    }
    const notice = this.runs.get(m.id)?.notice;
    return notice ? { ...out, notice } : out;
  }

  private start(m: Dsh, version: number): Promise<number> {
    const have = this.runs.get(m.id);
    if (have && have.version === version && !have.error && have.child.exitCode === null) return have.ready;
    if (have) this.stop(m.id);
    const dir = this.addons.packageDir(m.id, version);
    if (!dir) return Promise.reject(new Error("Its package isn't kept: add it again."));
    // A folder of its own, not one it shares with other plugins: theirs aren't its to read or change.
    const own = ownDir(this.dshHome, m.id);
    const tmp = join(own, "tmp");
    mkdirSync(tmp, { recursive: true });
    const addonDir = join(this.addons.dir, m.id);
    const logFile = join(addonDir, "host.log");
    const log = openSync(logFile, "a");
    if (fstatSync(log).size > LOG_MAX) ftruncateSync(log, 0);
    const script = fileURLToPath(new URL("./dsh-host.ts", import.meta.url));
    const node = process.execPath;
    const e = this.env;
    // Your PATH and home, its own folder and a temporary one inside it, and nothing else of the engine's: no keys, no token.
    const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries({ PATH: e.PATH, HOME: e.HOME ?? homedir(), USER: e.USER, LOGNAME: e.LOGNAME, SHELL: e.SHELL, LANG: e.LANG ?? "en_US.UTF-8", LC_ALL: e.LC_ALL, TMPDIR: tmp, TZ: e.TZ, SystemRoot: e.SystemRoot, APPDATA: e.APPDATA, LOCALAPPDATA: e.LOCALAPPDATA, USERPROFILE: e.USERPROFILE, DSH_HOME: own, NODE_NO_WARNINGS: "1", ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}) }).filter(([, v]) => v !== undefined));
    const args = ["--disable-warning=ExperimentalWarning", script];
    // The folder a plugin with a page saves to in your Documents, made by Liner Code for it; why not, in its log and on its page.
    // One that only gives your agents tools gets none (and no folder in your Documents it never asked for).
    const saves = this.sandbox && m.dsh.slot ? savesFolder(env.HOME!, [m.name, m.id], join(addonDir, "folders.json"), { projects: this.projects?.() ?? [], make: true }) : {};
    const notice = saves.why ? `It can't save to ${saves.path ?? "a folder in your Documents"}: ${saves.why}.${saves.path ? ` Move or rename that folder, then turn ${m.name} off and on again.` : ""}` : undefined;
    try {
      if (notice) writeSync(log, `${new Date().toISOString()} liner ${notice}\n`);
    } catch {
      // A full disk: the log goes without it.
    }
    const named = saves.dir ? [saves.dir] : [];
    const boxed = this.sandbox ? ["-p", sandboxProfile({ home: env.HOME!, linerHome: this.linerHome, own, addonDir, named }), node, ...args] : null;
    // A process group of its own, so what it starts goes when it does.
    const child = spawn(boxed ? "/usr/bin/sandbox-exec" : node, boxed ?? args, { cwd: dir, env, stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true, detached: process.platform !== "win32" });
    const write = (b: Buffer) => {
      try {
        writeSync(log, b);
      } catch {
        // A full disk: its log goes, it doesn't.
      }
    };
    child.stdout?.on("data", write);
    child.stderr?.on("data", write);
    const secret = randomBytes(24).toString("hex");
    let settle: { ok: (p: number) => void; no: (e: Error) => void } | undefined;
    const ready = new Promise<number>((ok, no) => (settle = { ok, no }));
    // Waited on by its frame and by the proxy: a failure is said where it's asked for.
    ready.catch(() => {});
    const run: Run = { id: m.id, version, child, secret, ready, log, tools: [], instructions: "", calls: new Map(), ...(notice ? { notice } : {}) };
    this.runs.set(m.id, run);
    const timer = setTimeout(() => {
      run.error = "Its program took too long to start.";
      settle?.no(new Error(run.error));
      end(child, "SIGTERM");
    }, START_WAIT);
    child.on("message", (raw: unknown) => {
      const msg = raw as { t?: string; port?: number; error?: string; call?: string; prompt?: string; system?: string; tools?: unknown; instructions?: unknown; sections?: unknown; content?: unknown; isError?: unknown; id?: unknown; path?: unknown; recursive?: unknown };
      // What it offers your agents: only the tools its card named, however its program lists them,
      // and in the words the card showed: a description read from its code is the one told, and only
      // one its code didn't spell out comes from the program (the card says so).
      const offers = () => {
        const card = new Map((m.dsh.tools ?? []).map((t) => [t.name, t]));
        if (Array.isArray(msg.tools)) run.tools = (msg.tools as McpTool[]).filter((t) => t && typeof t.name === "string" && card.has(t.name)).map((t) => ({ name: t.name, description: card.get(t.name)?.description ?? String(t.description ?? "").slice(0, 4000), inputSchema: tidySchema(t.inputSchema) }));
        if (Array.isArray(msg.sections)) run.instructions = told(m.dsh.instructions, msg.sections);
      };
      if (msg.t === "ready" && typeof msg.port === "number") {
        clearTimeout(timer);
        run.port = msg.port;
        offers();
        settle?.ok(msg.port);
      } else if (msg.t === "tools") offers();
      else if (msg.t === "result" && typeof msg.call === "string") {
        const done = run.calls.get(msg.call);
        run.calls.delete(msg.call);
        done?.({ content: Array.isArray(msg.content) ? (msg.content as CallResult["content"]) : [{ type: "text", text: "(no output)" }], ...(msg.isError === true ? { isError: true } : {}) });
      } else if (msg.t === "failed") {
        clearTimeout(timer);
        run.error = String(msg.error ?? "It stopped as it started.");
        settle?.no(new Error(run.error));
        end(child, "SIGTERM");
      } else if (msg.t === "mkdir" && typeof msg.id === "string" && typeof msg.path === "string") child.connected && child.send({ t: "made", id: msg.id, ...makeIn(named[0], msg.path, msg.recursive === true) });
      else if (msg.t === "ask" && typeof msg.call === "string") void this.answer(run, m, msg.call, String(msg.prompt ?? ""), msg.system);
      // Its own calls only: each is named for it, so it can't stop another app's.
      else if (msg.t === "cancel" && typeof msg.call === "string" && this.asking.get(callOf(run.id, msg.call))?.id === run.id) this.cancel?.(callOf(run.id, msg.call));
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      run.error = `Its program couldn't start: ${err.message}`;
      settle?.no(new Error(run.error));
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (!run.error && run.port === undefined) run.error = `Its program stopped as it started (${signal ?? `exit ${code}`}). Its log: ${logFile}`;
      settle?.no(new Error(run.error ?? "Its program stopped."));
      for (const [call, a] of this.asking) if (a.id === run.id) this.cancel?.(call), this.asking.delete(call);
      for (const done of run.calls.values()) done({ content: [{ type: "text", text: `${m.name}'s program stopped before it answered. Its log: ${logFile}` }], isError: true });
      run.calls.clear();
      try {
        closeSync(log);
      } catch {
        // Closed already.
      }
      if (this.runs.get(run.id) === run) this.runs.delete(run.id);
    });
    child.send({ t: "start", dir, entry: m.dsh.host!, config: m.dsh.config ?? {}, name: m.name, secret, model: this.modelOf?.(m.id) ?? null, tools: (m.dsh.tools ?? []).map((t) => t.name), named });
    return ready;
  }

  private async answer(run: Run, m: Dsh, call: string, prompt: string, system?: string) {
    const back = (x: Record<string, unknown>) => run.child.connected && run.child.send(x);
    if (!this.ask) return back({ t: "fail", call, error: "Models aren't available here." });
    const key = callOf(run.id, call);
    if (this.asking.has(key)) return back({ t: "fail", call, error: "That call is already being answered." });
    this.asking.set(key, { id: run.id });
    try {
      await this.ask(run.id, m.name, { prompt, system, call: key, onText: (text) => back({ t: "text", call, text }) });
      back({ t: "done", call });
    } catch (e) {
      back({ t: "fail", call, error: e instanceof Error ? e.message : String(e) });
    } finally {
      this.asking.delete(key);
    }
  }

  stop(id: string) {
    const r = this.runs.get(id);
    if (!r) return;
    this.runs.delete(id);
    r.error ??= "It was stopped.";
    try {
      r.child.disconnect();
    } catch {
      // Gone already.
    }
    // Its group: what it started too. Its own stop is held to two seconds (dsh-host.ts), and this backs it.
    // On Windows the disconnect above is its stop: its tree is ended (taskkill /T /F) only if it's still there after.
    if (process.platform !== "win32") end(r.child, "SIGTERM");
    const t = setTimeout(() => r.child.exitCode === null && r.child.signalCode === null && end(r.child, "SIGKILL"), process.platform === "win32" ? 2500 : 3000);
    t.unref();
  }

  /**
    Every program stops (Liner Code quits): each is asked to, and once they've gone, or after `ms`,
    what's left of their groups is killed, so one that ignores its stop doesn't outlive the engine.
  */
  async stopAll(ms = 1500) {
    const runs = [...this.runs.values()];
    for (const id of [...this.runs.keys()]) this.stop(id);
    if (process.platform !== "win32") return groupsGone(runs.flatMap((r) => (r.child.pid ? [r.child.pid] : [])), ms);
    // Windows: each gets the moment to go by itself, then its tree is ended.
    const gone = (c: ChildProcess) => (c.exitCode !== null || c.signalCode !== null ? Promise.resolve() : new Promise<void>((ok) => c.once("exit", () => ok())));
    await Promise.race([Promise.all(runs.map((r) => gone(r.child))), new Promise((ok) => setTimeout(ok, ms))]);
    for (const r of runs) if (r.child.exitCode === null && r.child.signalCode === null) end(r.child, "SIGKILL");
  }

  /**
    A request from a frame for /dsh/<token>/<rest>: its package's pictures, or its Node half. False
    when the token isn't one of this run's (the caller answers 404).
  */
  serve(token: string, rest: string, search: string, req: IncomingMessage, res: ServerResponse): boolean {
    if (!DSH_TOKEN.test(token)) return false;
    const agent = this.agentIds.get(token);
    if (agent) return void this.mcp(agent, rest, req, res), true;
    const id = this.ids.get(token);
    if (!id) return false;
    const cors = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS", "access-control-allow-headers": String(req.headers["access-control-request-headers"] ?? "content-type"), "access-control-max-age": "600", vary: "origin" };
    if (req.method === "OPTIONS") return void res.writeHead(204, cors).end(), true;
    const m = this.addons.panel(id);
    const version = this.addons.get(id)?.version;
    if (!m?.dsh || version === undefined) return void res.writeHead(404, cors).end(), true;
    // Its package's pictures, as DSH serves them: plugins/<package>/assets/<path>.
    const own = `plugins/${m.dsh.package}/assets/`;
    if (rest.startsWith(own)) {
      const dir = this.addons.packageDir(id, version);
      let path: string;
      try {
        path = decodeURIComponent(rest.slice(own.length));
      } catch {
        return void res.writeHead(400, cors).end(), true;
      }
      const file = dir ? resolve(dir, "assets", path) : "";
      const rel = dir ? relative(join(dir, "assets"), file) : "..";
      const type = PICTURES[extname(file).toLowerCase()];
      if (!type || !rel || rel.startsWith("..") || isAbsolute(rel) || !existsSync(file) || !statSync(file).isFile()) return void res.writeHead(404, cors).end(), true;
      // Its links followed, it must still be in the package's assets, so a link can't serve what's outside.
      let real = "";
      try {
        const base = realpathSync(join(dir!, "assets"));
        real = realpathSync(file);
        const r = relative(base, real);
        if (!r || r.startsWith("..") || isAbsolute(r)) real = "";
      } catch {
        real = "";
      }
      if (!real) return void res.writeHead(404, cors).end(), true;
      res.writeHead(200, { ...cors, "content-type": type, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff", ...(type === "image/svg+xml" ? { "content-security-policy": "script-src 'none'" } : {}) });
      createReadStream(real).pipe(res);
      return true;
    }
    if (!m.dsh.host) return void res.writeHead(404, cors).end(), true;
    void this.start({ id: m.id, name: m.name, dsh: m.dsh }, version).then(
      (port) => {
        const run = this.runs.get(id);
        if (!run) return void res.writeHead(503, { ...cors, "content-type": "application/json" }).end(JSON.stringify({ error: `${m.name}'s program stopped.` }));
        const headers: Record<string, string | string[] | undefined> = { ...req.headers, host: `127.0.0.1:${port}`, "x-liner-dsh": run.secret };
        delete headers.origin;
        delete headers.referer;
        delete headers["x-liner-token"];
        const up = request({ host: "127.0.0.1", port, method: req.method, path: `/${rest}${search}`, headers }, (r) => {
          // Its answer, but nothing that would act on the app's own origin: no cookies, no clearing its storage.
          const back: Record<string, string | string[] | undefined> = { ...r.headers, ...cors };
          for (const h of ["set-cookie", "clear-site-data", "service-worker-allowed", "refresh", "link"]) delete back[h];
          res.writeHead(r.statusCode ?? 502, back);
          r.on("error", () => res.destroy());
          r.on("aborted", () => res.destroy());
          r.pipe(res);
        });
        up.on("error", (e) => {
          if (res.headersSent) return void res.destroy();
          res.writeHead(502, { ...cors, "content-type": "application/json" }).end(JSON.stringify({ error: `${m.name}'s program didn't answer: ${e.message}` }));
        });
        // The frame gone: its request to the program goes too.
        res.on("close", () => !res.writableFinished && up.destroy());
        req.pipe(up);
      },
      (e: unknown) => {
        res.writeHead(503, { ...cors, "content-type": "application/json" }).end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
      },
    );
    return true;
  }

  /**
    An agent's MCP server (dsh-mcp.ts) asking for a plugin's tools, or calling one: { op: "list" }
    or { op: "call", name, arguments }. Its program starts if it isn't running. A call's answer is
    held open with a space every 20 seconds, so a long one isn't given up on, and the agent's going
    stops it.
  */
  private async mcp(id: string, rest: string, req: IncomingMessage, res: ServerResponse) {
    const json = (status: number, body: unknown) => void res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(body));
    if (rest !== "mcp" || req.method !== "POST") return json(404, { error: "Not found" });
    const m = this.addons.dshOf(id);
    const version = this.addons.get(id)?.version;
    // While its add-on is on and gives tools: off, removed or replaced by one that doesn't, it reaches nothing.
    if (!m?.dsh.host || !m.dsh.tools?.length || version === undefined) return json(404, { error: "That add-on is off in Liner Code, or gives your agents no tools now." });
    let body: { op?: unknown; name?: unknown; arguments?: unknown };
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const c of req) {
        size += (c as Buffer).length;
        if (size > BODY_MAX) throw new Error("too large");
        chunks.push(c as Buffer);
      }
      body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as typeof body;
    } catch {
      return json(400, { error: "That isn't a call Liner Code reads." });
    }
    let run: Run | undefined;
    try {
      await this.start(m, version);
      run = this.runs.get(id);
    } catch (e) {
      return json(503, { error: `${m.name}'s program didn't start: ${e instanceof Error ? e.message : String(e)}` });
    }
    if (!run) return json(503, { error: `${m.name}'s program stopped.` });
    if (body.op === "list") return json(200, { tools: run.tools, ...(run.instructions ? { instructions: run.instructions } : {}) });
    if (body.op !== "call" || typeof body.name !== "string") return json(400, { error: "That isn't a call Liner Code reads." });
    const name = body.name;
    const said = (text: string): CallResult => ({ content: [{ type: "text", text }], isError: true });
    if (!run.tools.some((t) => t.name === name)) return json(200, said(`${m.name} gives your agents no tool called ${name.slice(0, 80)}.`));
    if (run.calls.size >= CALLS_MAX) return json(200, said(`${m.name} is already running ${CALLS_MAX} calls: try again when one is done.`));
    const r = run;
    const call = randomBytes(8).toString("hex");
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    const beat = setInterval(() => res.write(" "), 20_000);
    r.calls.set(call, (result) => {
      clearInterval(beat);
      res.end(JSON.stringify(result));
    });
    res.on("close", () => {
      clearInterval(beat);
      // The agent went (its call called off, or itself gone): the program stops that call.
      if (r.calls.delete(call) && r.child.connected) r.child.send({ t: "abort", call });
    });
    if (r.child.connected) r.child.send({ t: "call", call, name, args: body.arguments && typeof body.arguments === "object" ? body.arguments : {} });
    else r.calls.get(call)?.(said(`${m.name}'s program stopped.`)), r.calls.delete(call);
  }
}
