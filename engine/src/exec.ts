/*
  Small process helpers. Apps launched from the Dock don't get your shell's PATH, so the shell
  passes it in and everything here runs with it.
*/
import { execFile, execFileSync, spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { accessSync, closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
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
      // One that never started (a folder that's gone), or was cut off, printed nothing: what happened is in `err`.
      resolve({ code, stdout: stdout ?? "", stderr: stderr || (err && typeof (err as { code?: unknown }).code !== "number" ? String(err.message) : "") });
    });
    // What it prints as it goes, both streams, for a caller that shows progress.
    if (o.onOutput) for (const s of [child.stdout, child.stderr]) s?.on("data", (d: Buffer | string) => o.onOutput!(String(d)));
    if (o.input !== undefined) {
      // One that ends without reading it breaks the pipe: its exit says what happened, and this would be an uncaught error.
      child.stdin?.on("error", () => {});
      child.stdin?.end(o.input);
    }
  });
}

/**
  "close" waits for the process's pipes, which something it left behind can hold for as long as it
  lives. Once the process itself is gone, those pipes are let go and "close" comes.
*/
export function closesOnExit(child: ChildProcess) {
  child.once("exit", () => {
    setTimeout(() => {
      child.stdout?.destroy();
      child.stderr?.destroy();
    }, 500).unref();
  });
}

/** How long a process group gets to end by itself. */
const KILL_AFTER_MS = 2000;

/**
  Named in the environment of one agent's process, a value new for each process (AcpSession): every process it starts
  inherits it, and keeps it once it has left the agent's tree (a command the agent sent to the background, `nohup … &`, a
  double fork), so all of them can be found and ended with the turn. The idea is THREAD_ENV's, for processes instead of ports.
*/
export const RUN_ENV = "LINER_RUN_ID";

export type Proc = { pid: number; ppid: number; command: string; pgid?: number };
/**
  What marks a process and all it starts as someone's: `name`=`value` in its environment (RUN_ENV for an agent's run, THREAD_ENV
  for a session), and `file`, which it holds open (marking: at whatever descriptor follows its own stdio), and so does everything
  it starts that keeps its inherited descriptors. Either is found (marked): the environment where it can be read, the file, by
  its path, where it's held. Never by a descriptor's number, which says nothing once a process has moved it.
*/
export type Mark = { name?: string; value: string; file?: string };

/**
  Where every engine keeps its marker files: a folder each in the temp folder, named for the engine process that made it, its pid
  and when it started (`<pid>-<start>`), with an `engine` file it holds open for as long as it runs. An engine that died hard (a
  SIGKILL, a crash) leaves its folder, and what it started may still hold the markers in it: the next engine to start ends those
  and removes the folder (sweepMarks), and never touches a folder whose engine still runs (two copies of the app may), told by its
  pid and start time together, not its pid alone, which the system gives out again.
*/
const MARKS = join(tmpdir(), "liner-marks");
let own: { dir: string; fd: number } | undefined;
/** Kept on quitting (marksKept): what the folder's markers are held by may still run, and the next engine ends it. */
let keep = false;

/** This engine's own marker folder, made the first time it's needed. Windows: none. */
export function markDir() {
  if (own) return own.dir;
  const start = startedAt(process.pid) ?? Math.round(performance.timeOrigin);
  const dir = join(MARKS, `${process.pid}-${start}`);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "engine");
  writeFileSync(file, JSON.stringify({ pid: process.pid, start }));
  // Held for this engine's life (Node opens it close-on-exec, so nothing it starts holds it): while it's held, the engine runs.
  own = { dir, fd: openSync(file, "r") };
  // Gone as the engine goes, unless something it marked may still be running (marksKept), or a run's marker is still there,
  // which only its close removes, once all that held it has ended: then the next engine's sweep ends that first.
  process.once("exit", () => {
    if (keep || !own) return;
    try {
      if (readdirSync(own.dir).some((f) => f.startsWith("liner-run-"))) return;
      rmSync(own.dir, { recursive: true, force: true });
    } catch {
      // already gone
    }
  });
  return dir;
}

/** On an orderly quit, once all this engine started has ended: its marker folder goes. */
export function dropMarks() {
  if (!own) return;
  try {
    closeSync(own.fd);
  } catch {
    // closed already
  }
  rmSync(own.dir, { recursive: true, force: true });
  own = undefined;
}
/** On a quit that didn't wait for everything to end: the folder stays for the next engine's sweep. */
export const marksKept = () => void (keep = true);

/** A file for a marker in this engine's folder: `liner-<kind>-<id>`. */
export const markFile = (kind: "run" | "thread", id: string) => join(win ? tmpdir() : markDir(), `liner-${kind}-${id.replace(/[^\w-]/g, "_")}`);

/** A session's marker, held by what is started for it (its Terminal's shell, its agent, a server from its launch.json). */
export const threadMark = (threadId: string): Mark => ({ name: THREAD_ENV, value: threadId, file: win ? undefined : markFile("thread", threadId) });

/**
  When a process started, in ms, as `ps` says it (to the second): for telling an engine that still runs from another process the
  system has given its pid since. Linux: /proc. Undefined where neither answers (`ps` is setuid, and a sandbox may refuse it).
*/
function startedAt(pid: number): number | undefined {
  if (win) return undefined;
  if (process.platform === "linux") {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const ticks = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]);
      const boot = Number(/^btime (\d+)$/m.exec(readFileSync("/proc/stat", "utf8"))?.[1]);
      return Number.isFinite(ticks) && boot ? boot * 1000 + Math.round((ticks / 100) * 1000) : undefined;
    } catch {
      return undefined;
    }
  }
  try {
    const out = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" }, timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }).trim();
    const at = Date.parse(out);
    return Number.isFinite(at) ? at : undefined;
  } catch {
    return undefined;
  }
}

/** Whether the engine that made a marker folder still runs: its pid is up, and it's the same process (its start, or its `engine` file held). */
async function engineAlive(pid: number, start: number, dir: string) {
  try {
    process.kill(pid, 0);
  } catch (e) {
    // No such process. (EPERM: one of another user's, which no engine of this user's is.)
    if ((e as NodeJS.ErrnoException).code === "ESRCH" || (e as NodeJS.ErrnoException).code === "EPERM") return false;
  }
  const now = startedAt(pid);
  // `ps` reads to the second; an engine's own start (performance.timeOrigin) is a moment after its exec.
  if (now !== undefined) return Math.abs(now - start) < 3000;
  // Where its start can't be read: the engine holds its folder's `engine` file for as long as it runs.
  return (await markedPids({ value: "", file: join(dir, "engine") })).has(pid);
}

/**
  On starting: the marker folders of engines that no longer run. Whatever still holds a marker of theirs (a command agy sent to the
  background, a server one of its sessions started) is ended the same way a session's close ends it (endAll), children first, and
  checked gone; then the folder goes. A folder whose engine runs (another copy of the app) is left alone, and so is this one's own.
  Markers from before these folders, straight in the temp folder, say no engine: only those nothing holds are removed.
  Resolves with how many processes were ended and how many were still running after.
*/
export async function sweepMarks(): Promise<{ ended: number; left: Proc[]; folders: number }> {
  const out = { ended: 0, left: [] as Proc[], folders: 0 };
  if (win) return out;
  let names: string[] = [];
  try {
    names = readdirSync(MARKS);
  } catch {
    // none yet
  }
  for (const name of names) {
    const m = /^(\d+)-(\d+)$/.exec(name);
    const dir = join(MARKS, name);
    if (!m || dir === own?.dir || (await engineAlive(Number(m[1]), Number(m[2]), dir))) continue;
    let files: string[] = [];
    try {
      files = readdirSync(dir).filter((f) => /^liner-(?:run|thread)-/.test(f)).map((f) => join(dir, f));
    } catch {
      continue;
    }
    let stuck = false;
    for (const file of files) {
      const mark: Mark = { value: "", file };
      const holding = await marked(mark);
      if (!holding.length) continue;
      const still = await endAll(holding, () => marked(mark));
      out.ended += holding.length - still.length;
      out.left.push(...still);
      stuck ||= still.length > 0;
    }
    // One whose holders didn't all end stays, for the next look.
    if (stuck) continue;
    rmSync(dir, { recursive: true, force: true });
    out.folders++;
  }
  for (const f of readdirSync(tmpdir()).filter((x) => /^liner-run-[0-9a-f]+$/.test(x))) {
    const file = join(tmpdir(), f);
    if (!(await markedPids({ value: "", file })).size) rmSync(file, { force: true });
  }
  return out;
}

/**
  stdio for a spawn that carries marks: `base` as it is, then each mark's file open as the next descriptors after it (3 and 4 for
  an agent on three pipes; 4 for a Terminal, whose helper talks on 3), made if it isn't there. Never at fixed high numbers: once the
  engine had forty-odd descriptors open, Node's own pipes for the child landed on the 42 and 43 the markers were handed at, and the
  child was wired wrongly (V3: "agy stopped reading: write EPIPE" from the ninth session on). The parent's copies are kept above
  every number the child is handed at, so none is a source for one slot and the target of another. Call `done` once the process
  is spawned: the parent's copies close, the child keeps its own. Windows: `base` alone.
*/
export function marking<T>(base: readonly T[], marks: Mark[]) {
  const held = win ? [] : marks.filter((m) => m.file);
  const slots = base.length + held.length;
  const fds: number[] = [];
  const low: number[] = [];
  for (const mark of held) {
    if (!existsSync(mark.file!)) writeFileSync(mark.file!, "");
    let fd = openSync(mark.file!, "r");
    while (fd < slots) {
      low.push(fd);
      fd = openSync(mark.file!, "r");
    }
    fds.push(fd);
  }
  for (const fd of low) closeSync(fd);
  const stdio: (T | number)[] = [...base, ...fds];
  return { stdio, done: () => fds.forEach((fd) => closeSync(fd)) };
}

/** run(), never throwing: a program the sandbox it runs in won't start (EPERM) is a failed run like any other. */
const tryRun = (cmd: string, args: string[], o: Parameters<typeof run>[2] = {}) => run(cmd, args, o).catch((e): RunResult => ({ code: 1, stdout: "", stderr: String(e) }));

/**
  Whether `ps -E` prints a process's environment here, asked of what it says for this one (whose PATH is always set). macOS 27
  prints none for Apple's own programs (/bin/zsh, /bin/sleep, the system python), and still does for others (Node, Homebrew's
  Python); an older macOS does for all. Asked once, by what it answers, never by a version number.
*/
let envShown: Promise<boolean> | undefined;
const envReadable = () => (envShown ??= tryRun("ps", ["-E", "-ww", "-o", "command=", "-p", String(process.pid)], { timeout: 5000 }).then((r) => /(?:^|\s)PATH=/.test(r.stdout)));

/**
  This user's processes, with their parents and commands, ended ones (zombies) left out. `ps` where it runs; where it can't (it's
  setuid, and a sandbox may refuse it) lsof for each process's parent and pgrep for its command, which need no privilege.
*/
export async function processes(): Promise<Proc[]> {
  if (win) return [];
  const uid = process.getuid?.();
  const listed = await tryRun("ps", ["-A", "-ww", "-o", "pid=", "-o", "ppid=", "-o", "pgid=", "-o", "uid=", "-o", "stat=", "-o", "command="], { timeout: 5000, maxBuffer: 64 * 1024 * 1024 });
  if (listed.code === 0)
    return listed.stdout.split("\n").flatMap((l): Proc[] => {
      const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s(.*)$/.exec(l);
      // An ended process its parent hasn't heard of yet (a zombie) runs nothing.
      return m && (uid === undefined || Number(m[4]) === uid) && !m[5].startsWith("Z") ? [{ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), command: m[6].trim() }] : [];
    });
  const [tree, names] = await Promise.all([
    tryRun("lsof", ["-w", "-n", "-P", ...(uid === undefined ? [] : ["-u", String(uid), "-a"]), "-d", "cwd", "-F", "pRg"], { timeout: 8000, maxBuffer: 64 * 1024 * 1024 }),
    tryRun("pgrep", ["-l", "-f", ...(uid === undefined ? [] : ["-U", String(uid)]), "."], { timeout: 5000, maxBuffer: 64 * 1024 * 1024 }),
  ]);
  const command = new Map<number, string>();
  for (const l of names.stdout.split("\n")) {
    const m = /^(\d+)\s(.*)$/.exec(l);
    if (m) command.set(Number(m[1]), m[2].trim());
  }
  const out = new Map<number, Proc>();
  let pid = 0;
  for (const l of tree.stdout.split("\n")) {
    if (l[0] === "p") pid = Number(l.slice(1));
    else if (l[0] === "R" && pid) out.set(pid, { ...out.get(pid), pid, ppid: Number(l.slice(1)), command: command.get(pid) ?? "" });
    else if (l[0] === "g" && pid) out.set(pid, { ppid: 0, command: command.get(pid) ?? "", ...out.get(pid), pid, pgid: Number(l.slice(1)) });
  }
  return [...out.values()];
}

/**
  This user's processes that carry `mark`, the engine left out: by the environment where it can be read, and by the marker
  file where it's held, whichever answers (markedPids). Linux: /proc/<pid>/environ, readable for one's own. macOS: `ps -E`
  where it prints environments (macOS 27 prints none for Apple's own programs, /bin/zsh and /bin/sleep among them, so a shell
  agy runs a command in is found only by the file), and lsof for every process holding the file. Windows has neither: none,
  and killTree's taskkill /T, which ends the agent and what is still below it, is all there is there.
*/
export async function marked(mark: Mark): Promise<Proc[]> {
  const pids = await markedPids(mark);
  if (!pids.size) return [];
  return (await processes()).filter((r) => pids.has(r.pid));
}

/**
  marked()'s pids alone, without listing every process: a look cheap enough for every turn's start and end. `among`: only these
  pids are asked about (the listeners the Browser lists), each way in one call for all of them, never one per pid.
*/
export async function markedPids(mark: Mark, among?: number[]): Promise<Set<number>> {
  const has = new Set<number>();
  if (win || (!mark.value && !mark.file) || (among && !among.length)) return has;
  const tag = `${mark.name ?? RUN_ENV}=${mark.value}`;
  // A marker known only by its file (a dead engine's, swept) has no environment to look for.
  if (mark.value && process.platform === "linux") {
    let pids = among?.map(String) ?? [];
    if (!among)
      try {
        pids = readdirSync("/proc").filter((d) => /^\d+$/.test(d));
      } catch {
        // no /proc
      }
    for (const pid of pids) {
      try {
        if (readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").includes(tag)) has.add(Number(pid));
      } catch {
        // gone, or not ours to read
      }
    }
  } else if (mark.value && process.platform !== "linux" && (await envReadable())) {
    const env = await tryRun("ps", ["-E", "-ww", "-o", "pid=", "-o", "command=", ...(among ? ["-p", among.join(",")] : ["-A"])], { timeout: 5000, maxBuffer: 256 * 1024 * 1024 });
    for (const l of env.stdout.split("\n")) {
      const m = /^\s*(\d+)\s(.*)$/.exec(l);
      if (m && ` ${m[2]} `.includes(` ${tag} `)) has.add(Number(m[1]));
    }
  }
  if (mark.file && existsSync(mark.file)) {
    const holding = await tryRun("lsof", ["-w", "-t", ...(among ? ["-a", "-p", among.join(",")] : []), "--", mark.file], { timeout: 8000 });
    for (const l of holding.stdout.split("\n")) if (/^\d+$/.test(l.trim())) has.add(Number(l.trim()));
  }
  has.delete(process.pid);
  return has;
}

/**
  Ends these processes, children before their parents, and checks they are gone: SIGTERM, then SIGKILL for any still there
  after `graceMs` (KILL_AFTER_MS unless the caller says), then a last look. `again` finds them again (marked, say) for what started meanwhile (a double fork
  caught between the two). Resolves with those still running, which the caller says by command rather than claiming them ended.
*/
export async function endAll(procs: Proc[], again?: () => Promise<Proc[]>, graceMs = KILL_AFTER_MS): Promise<Proc[]> {
  // Which of them still run: an ended one whose parent hasn't heard yet (a zombie) still answers a signal, and is ended all the same.
  const living = async (list: Proc[]) => {
    if (!list.length) return [];
    const up = new Set((await processes()).map((p) => p.pid));
    return list.filter((p) => up.has(p.pid));
  };
  const depth = (p: Proc, all: Proc[]) => {
    let d = 0;
    for (let q = all.find((x) => x.pid === p.ppid); q && d < 64; q = all.find((x) => x.pid === q!.ppid)) d++;
    return d;
  };
  const signal = (list: Proc[], s: NodeJS.Signals) => {
    for (const p of [...list].sort((a, b) => depth(b, list) - depth(a, list))) {
      try {
        process.kill(p.pid, s);
      } catch {
        // gone already
      }
    }
  };
  const wait = async (list: Proc[], ms: number) => {
    let left = await living(list);
    for (const end = Date.now() + ms; Date.now() < end && left.length; left = await living(left)) await new Promise((r) => setTimeout(r, 100));
    return left;
  };
  let todo = procs;
  for (let round = 0; round < 3 && todo.length; round++) {
    signal(todo, "SIGTERM");
    const stubborn = await wait(todo, graceMs);
    if (stubborn.length) {
      signal(stubborn, "SIGKILL");
      await wait(stubborn, 500);
    }
    // What is still there, and what started while these ended (marked, found again), goes the same way.
    todo = again ? await again() : await living(todo);
  }
  return living(todo);
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
    if (child.pid) {
      const group = child.pid;
      process.kill(-group, "SIGTERM");
      // One that ignores it would go on working beside whatever starts next (T3 Code force-kills after a deadline too).
      setTimeout(() => {
        try {
          process.kill(-group, "SIGKILL");
        } catch {
          // it went when it was asked
        }
      }, KILL_AFTER_MS).unref();
      return;
    }
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
  const take = (line: string) => {
    if (!line) return;
    try {
      onLine(JSON.parse(line));
    } catch {
      onRaw?.(line);
    }
  };
  stream.on("data", (chunk: string) => {
    buf += chunk;
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      take(line);
    }
  });
  // A last line with no new line after it counts (T3 Code's protocol.test.ts): a request can wait on it.
  stream.on("end", () => {
    const line = buf.trim();
    buf = "";
    take(line);
  });
}
