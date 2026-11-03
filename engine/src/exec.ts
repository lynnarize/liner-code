/*
  Small process helpers. Apps launched from the Dock don't get your shell's PATH, so the shell
  passes it in and everything here runs with it.
*/
import { execFile, spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { accessSync, constants, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, extname, isAbsolute, join, sep } from "node:path";

const win = process.platform === "win32";

/** The full path of a command on PATH, or null. */
export function which(cmd: string, env: NodeJS.ProcessEnv = process.env): string | null {
  // A path is itself; an account that runs its own copy of a tool says where, as LINER_BIN_<TOOL>.
  const own = (win ? /[\\/]/.test(cmd) : cmd.includes("/")) ? cmd : env[binVar(cmd)];
  if (own) return runnable(own, env);
  for (const dir of pathOf(env).split(delimiter)) {
    if (!dir) continue;
    const p = runnable(join(win ? dir.replace(/^"|"$/g, "") : dir, cmd), env);
    if (p) return p;
  }
  return null;
}

/**
  The file itself when it runs, else null. On Windows that's a file with one of PATHEXT's
  extensions (npm's folder also holds a bare `claude` script for Git Bash, which Windows can't
  start), tried in PATHEXT's order (T3 Code: packages/shared/src/shell.ts).
*/
function runnable(p: string, env: NodeJS.ProcessEnv): string | null {
  if (!win) {
    try {
      accessSync(p, constants.X_OK);
      return p;
    } catch {
      return null;
    }
  }
  const exts = (env.PATHEXT || ".COM;.EXE;.BAT;.CMD").toLowerCase().split(";").filter((e) => [".com", ".exe", ".bat", ".cmd"].includes(e));
  for (const c of exts.includes(extname(p).toLowerCase()) ? [p] : exts.map((e) => p + e)) {
    try {
      if (statSync(c).isFile()) return c;
    } catch {
      // not this one
    }
  }
  return null;
}

/** An environment's PATH, however it's spelt: Windows keeps it as "Path", and a copied env is case-sensitive. */
export function pathOf(env: NodeJS.ProcessEnv): string {
  return env.PATH ?? (win ? Object.entries(env).find(([k]) => k.toUpperCase() === "PATH")?.[1] : undefined) ?? "";
}

/** `env` with its PATH set to `path`, under one spelling: two on Windows ("Path" and "PATH") leave a child with either (T3 Code's setWindowsPath). */
export function withPath(env: NodeJS.ProcessEnv, path: string | undefined): NodeJS.ProcessEnv {
  const out = { ...env };
  if (win) for (const k of Object.keys(out)) if (k.toUpperCase() === "PATH") delete out[k];
  out.PATH = path;
  return out;
}

/** A path relative() gave for something outside the folder it was asked from: up out of it, or (Windows) on another drive. */
export const outside = (rel: string) => rel === ".." || rel.startsWith(`..${sep}`) || rel.startsWith("../") || isAbsolute(rel);

/**
  What an npm .cmd shim on Windows starts: the file named in its last line (a .exe, or a script
  for Node), or null for any other .cmd. Node won't start a .cmd without a shell (CVE-2024-27980),
  and through cmd.exe stopping it leaves the tool running; started directly it ends with the
  engine (T3 Code: packages/shared/src/shell.ts npmShimExecutable).
*/
export function shimTarget(path: string): string | null {
  if (!/\.cmd$/i.test(path)) return null;
  try {
    const last = readFileSync(path, "utf8").split(/\r?\n/).filter((l) => l.trim()).at(-1) ?? "";
    const m = /"%dp0%\\([^"%]+)"\s+%\*\s*$/.exec(last) ?? /"%~dp0\\([^"%]+)"\s+%\*\s*$/.exec(last);
    const target = m && join(dirname(path), m[1]);
    return target && existsSync(target) ? target : null;
  } catch {
    return null;
  }
}

/**
  Claude Code's path for the Agent SDK, which starts it without a shell or a PATH search: on
  Windows an npm shim gives way to the package's claude.exe (or cli.js, which the SDK runs with
  Node). T3 Code: apps/server/src/provider/Drivers/ClaudeExecutable.ts.
*/
export function sdkPath<T extends string | null | undefined>(path: T): T {
  if (!win || !path || !/\.(cmd|bat|ps1)$/i.test(path)) return path;
  const pkg = join(dirname(path), "node_modules", "@anthropic-ai", "claude-code");
  return (shimTarget(path) ?? [join(pkg, "bin", "claude.exe"), join(pkg, "cli.js")].find((p) => existsSync(p)) ?? path) as T;
}

const found = new Map<string, { path: string; at: number }>();

/**
  How to start `cmd` on Windows: its full path, or for an npm shim what the shim starts (with
  Node for a script), or, for any other .cmd or .bat, cmd.exe with each argument quoted for it
  (T3 Code's escapeWindowsShellArg). Elsewhere it's started as it is.
*/
function launch(cmd: string, args: readonly string[], env: NodeJS.ProcessEnv): { cmd: string; args: string[]; shell?: boolean } {
  // A name found on PATH is kept for half a minute: git runs often, and each look is a stat per folder and extension.
  // A miss isn't kept, so a tool installed a moment ago is found at once.
  const key = `${pathOf(env)}\0${cmd}`;
  let kept = found.get(key);
  if (!kept || Date.now() - kept.at > 30_000) {
    const p = which(cmd, env);
    kept = p ? { path: p, at: Date.now() } : undefined;
    if (kept) found.set(key, kept);
    else found.delete(key);
  }
  const path = kept?.path ?? cmd;
  if (!/\.(cmd|bat)$/i.test(path)) return { cmd: path, args: [...args] };
  const target = shimTarget(path);
  if (target && /\.exe$/i.test(target)) return { cmd: target, args: [...args] };
  const node = target && /\.[cm]?js$/i.test(target) ? (existsSync(join(dirname(path), "node.exe")) ? join(dirname(path), "node.exe") : which("node", env)) : null;
  if (target && node) return { cmd: node, args: [target, ...args] };
  const quote = (a: string) => `"${a.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")}"`.replace(/([()\][%!^"`<>&|;, *?])/g, "^$1");
  return { cmd: [path, ...args].map(quote).join(" "), args: [], shell: true };
}

/**
  child_process.spawn, made to work on Windows too: a .cmd shim starts what it names (see launch),
  no console window flashes up, and nothing is detached (a detached child gets a console of its
  own and outlives the engine; killTree ends the tree there instead of a process group).
*/
export const spawn = ((cmd: string, args?: readonly string[] | object, o?: object) => {
  if (!win || !Array.isArray(args)) return (nodeSpawn as (...a: unknown[]) => ChildProcess)(cmd, args, o);
  const opts = (o ?? {}) as { env?: NodeJS.ProcessEnv };
  const l = launch(cmd, args as string[], opts.env ?? process.env);
  return nodeSpawn(l.cmd, l.args, { ...opts, windowsHide: true, detached: false, ...(l.shell ? { shell: true } : {}) });
}) as typeof nodeSpawn;

/**
  A command line for your shell: `$SHELL -c` (or -lc), or cmd.exe on Windows, as Node's own
  `shell: true` runs it there (its argument passed as it is, `verbatim`).
*/
export function shellOf(command: string, env: NodeJS.ProcessEnv, login = false): { cmd: string; args: string[]; verbatim: boolean } {
  if (win) return { cmd: env.ComSpec || env.COMSPEC || "cmd.exe", args: ["/d", "/s", "/c", `"${command}"`], verbatim: true };
  return { cmd: env.SHELL || "/bin/zsh", args: [login ? "-lc" : "-c", command], verbatim: false };
}

/**
  Named in the environment of everything a session's agent or its Terminal starts. A dev server
  keeps it after the shell that started it exits, so the Browser can tell the session's own
  server from every other one on the Mac. The idea is T3 Code's (T3CODE_THREAD_ID).
*/
export const THREAD_ENV = "LINER_THREAD_ID";

/**
  Codex's own install keeps the helpers its commands reach for (rg) in `codex-path`, beside its
  `bin/`, and expects them on PATH. Started straight from the binary, they aren't: every Codex
  session's first search (`rg --files …`) failed with "command not found" on a Mac without ripgrep.
*/
export function withCodexPath(bin: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  try {
    const dir = join(dirname(dirname(realpathSync(bin))), "codex-path");
    return existsSync(dir) ? { ...env, PATH: [dir, env.PATH].filter(Boolean).join(delimiter) } : env;
  } catch {
    return env;
  }
}

/**
  Helpers agents take for granted and a Mac may not have, with the copies other tools ship. Codex's
  models search with `rg` first, and so do others; on a Mac without ripgrep that first command failed.
*/
export const HELPERS: Record<string, string[]> = {
  rg: ["~/.codex/packages/standalone/current/codex-path/rg", "/Applications/ChatGPT.app/Contents/Resources/codex-cli/codex-path/rg", "/opt/homebrew/bin/rg", "/usr/local/bin/rg"],
};

/**
  One folder of helpers (`~/.liner-code/bin`) first on the PATH of everything Liner Code runs: every
  agent tool, the commands it runs, the Terminal. A helper already on PATH is left to PATH; one that
  isn't is linked from a copy another tool ships. Returns the env to run with, and what's missing everywhere.
*/
export function linkHelpers(dir: string, env: NodeJS.ProcessEnv, helpers = HELPERS): { env: NodeJS.ProcessEnv; missing: string[] } {
  const missing: string[] = [];
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    return { env, missing: Object.keys(helpers) };
  }
  for (const [name, places] of Object.entries(helpers)) {
    const link = join(dir, name);
    const ours = (() => {
      try {
        return lstatSync(link).isSymbolicLink() ? readlinkSync(link) : null;
      } catch {
        return null;
      }
    })();
    const onPath = which(name, { ...env, PATH: pathOf(env).split(delimiter).filter((p) => p !== dir).join(delimiter) });
    // The places are a Mac's, and a link on Windows needs admin rights or Developer Mode.
    const copy = onPath || win ? null : places.map((p) => p.replace(/^~(?=\/)/, homedir())).find((p) => which(p, env));
    if (copy === ours) continue;
    try {
      if (ours !== null) rmSync(link, { force: true });
      if (copy) symlinkSync(copy, link);
      else if (!onPath) missing.push(name);
    } catch {
      // Another engine linked it first, or something not ours sits at the link: leave it.
      if (!onPath && !existsSync(link)) missing.push(name);
    }
  }
  return { env: { ...env, PATH: [dir, ...pathOf(env).split(delimiter).filter((p) => p && p !== dir)].join(delimiter) }, missing };
}

/** "cursor-agent" → "LINER_BIN_CURSOR_AGENT". */
export const binVar = (cmd: string) => `LINER_BIN_${cmd.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;

export type Secrets = { token?: string; keys: Record<string, string> };

/**
  The engine's token and the keys from the keychain, taken out of `env`. Everything the engine
  starts (agents, their commands, the Terminal, git) inherits the environment, and a command
  that could read the token could answer its own approvals through /rpc. Only an engine run by
  hand passes them this way: a process's starting environment stays readable to anything running
  as you (`ps eww`) however much of it is deleted later, so the shell hands them over stdin.
*/
export function takeSecrets(env: NodeJS.ProcessEnv): Secrets {
  const token = env.LINER_TOKEN || undefined;
  let keys: Record<string, string> = {};
  try {
    keys = JSON.parse(env.LINER_KEYS || "{}") as Record<string, string>;
  } catch {
    // none
  }
  delete env.LINER_TOKEN;
  delete env.LINER_KEYS;
  return { token, keys };
}

/** The token and keys from the line the shell writes first on the engine's stdin. */
export function secretsFrom(line: string | null): Secrets {
  try {
    const v = JSON.parse(line ?? "") as { token?: unknown; keys?: unknown };
    const keys = v.keys && typeof v.keys === "object" ? Object.fromEntries(Object.entries(v.keys).filter((e): e is [string, string] => typeof e[1] === "string")) : {};
    return { token: typeof v.token === "string" && v.token ? v.token : undefined, keys };
  } catch {
    return { token: undefined, keys: {} };
  }
}

/** A stream's first line, or null if it ends first. The stream stays open (the engine's stdin is its lifeline). */
export function firstLine(stream: NodeJS.ReadableStream): Promise<string | null> {
  return new Promise((resolve) => {
    let got = "";
    const data = (chunk: Buffer | string) => {
      got += chunk.toString();
      const nl = got.indexOf("\n");
      if (nl < 0) return;
      stream.off("data", data);
      stream.off("end", end);
      stream.pause();
      resolve(got.slice(0, nl));
    };
    const end = () => {
      stream.off("data", data);
      resolve(null);
    };
    stream.on("data", data);
    stream.once("end", end);
  });
}

export type RunResult = { code: number; stdout: string; stderr: string };

/** Runs a command to the end and collects its output. Never throws on a non-zero exit. `verbatim`: shellOf's arguments, passed to cmd.exe as they are. */
export function run(cmd: string, args: string[], o: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string; timeout?: number; maxBuffer?: number; onOutput?: (chunk: string) => void; verbatim?: boolean } = {}): Promise<RunResult> {
  // On Windows a .cmd shim starts what it names, and no console window flashes up (see launch).
  const l = win && !o.verbatim ? launch(cmd, args, o.env ?? process.env) : { cmd, args, shell: false };
  return new Promise((resolve) => {
    const child = execFile(l.cmd, l.args, { cwd: o.cwd, env: o.env ?? process.env, timeout: o.timeout ?? 30000, maxBuffer: o.maxBuffer ?? 32 * 1024 * 1024, encoding: "utf8", ...(win ? { windowsHide: true, windowsVerbatimArguments: Boolean(o.verbatim), ...(l.shell ? { shell: true } : {}) } : {}) }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === "number" ? ((err as unknown as { code: number }).code) : 1) : 0;
      resolve({ code, stdout: stdout ?? "", stderr: stderr ?? (err ? String(err.message) : "") });
    });
    // What it prints as it goes, both streams, for a caller that shows progress.
    if (o.onOutput) for (const s of [child.stdout, child.stderr]) s?.on("data", (d: Buffer | string) => o.onOutput!(String(d)));
    if (o.input !== undefined) {
      child.stdin?.end(o.input);
    }
  });
}

/** Stops a process started in a group of its own, and everything in that group; the process alone if that fails. */
export function killTree(child: { pid?: number; kill: (s?: NodeJS.Signals) => boolean }) {
  // Windows has no process groups: taskkill ends the process and everything it started (T3 Code:
  // AcpSessionRuntime.ts). Detached, so it finishes even when the engine is quitting.
  if (win) {
    if (!child.pid) return void child.kill();
    const tk = nodeSpawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true, detached: true });
    tk.on("error", () => child.kill());
    return void tk.unref();
  }
  try {
    if (child.pid) return void process.kill(-child.pid, "SIGTERM");
  } catch {
    // the group is gone already, or it isn't one
  }
  child.kill();
}

/** First line of `cmd --version`, or undefined. */
export async function versionOf(path: string, env: NodeJS.ProcessEnv, args = ["--version"]) {
  const r = await run(path, args, { env, timeout: 8000 });
  const line = (r.stdout || r.stderr).trim().split(/\r?\n/)[0];
  return r.code === 0 && line ? line.slice(0, 80) : undefined;
}

/** Reads a child's stdout as lines of JSON, calling back for each parsed object. */
export function jsonLines(stream: NodeJS.ReadableStream, onLine: (v: unknown) => void, onRaw?: (line: string) => void) {
  let buf = "";
  stream.setEncoding?.("utf8");
  stream.on("data", (chunk: string) => {
    buf += chunk;
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        onLine(JSON.parse(line));
      } catch {
        onRaw?.(line);
      }
    }
  });
}
