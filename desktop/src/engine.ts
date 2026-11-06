/*
  The engine, as a child process on Electron's own Node (ELECTRON_RUN_AS_NODE), so the app needs
  no Node installed. It runs engine/src/main.ts, which prints `LINER_READY {"port":…}` once it
  listens. Its stdin stays open; when the app quits, the pipe closes and the engine stops with
  it. If it crashes, it comes back on the same port and token, so the page reconnects by itself.
*/
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, renameSync, type WriteStream } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import { dirname, join } from "node:path";

export type Paths = { engine: string; ui: string };

// A test home (LINER_HOME) keeps its log apart, so a test copy doesn't write over your app's.
export const logDir = process.env.LINER_HOME ? join(process.env.LINER_HOME, "logs") : process.platform === "darwin" ? join(homedir(), "Library/Logs/Liner Code") : join(homedir(), ".liner-code", "logs");
export const logFile = join(logDir, "engine.log");
/** The launch before this one's log, kept so a report made after a crash and a relaunch still has the crash. */
export const previousLogFile = join(logDir, "engine.previous.log");

export class Engine {
  port = 0;
  readonly token = randomBytes(24).toString("hex");
  /** The engine's data folder (LINER_HOME or ~/.liner-code), where a downloaded update waits. */
  home = "";
  onReady?: (port: number) => void;
  onFail?: (message: string) => void;
  private child?: ChildProcess;
  private restarts: number[] = [];
  private stopping = false;
  private retry?: NodeJS.Timeout;
  private log?: WriteStream;
  private keys: Record<string, string> = {};

  start(paths: Paths, env: NodeJS.ProcessEnv, keys: Record<string, string>) {
    mkdirSync(logDir, { recursive: true });
    try {
      renameSync(logFile, previousLogFile);
    } catch {
      // the first launch
    }
    this.log = createWriteStream(logFile, { flags: "w" });
    // A full disk costs the log, not a crash dialog from the shell.
    this.log.on("error", (e) => console.error("[shell] the engine's log:", e.message));
    this.keys = { ...keys };
    this.launch(paths, env);
  }

  /** A key saved or removed since launch, so an engine that comes back after a crash has it as it is now. */
  setKey(provider: string, value: string | null) {
    if (value) this.keys[provider] = value;
    else delete this.keys[provider];
  }

  private launch(paths: Paths, env: NodeJS.ProcessEnv) {
    const child = spawn(process.execPath, [paths.engine, "--port", String(this.port), "--ui", paths.ui], {
      cwd: dirname(paths.engine),
      // The token and keys go over stdin, not the environment: anything running as you can read a
      // process's starting environment with `ps eww`, the agents the engine starts included.
      env: { ...env, ELECTRON_RUN_AS_NODE: "1", LINER_PATH: env.PATH, LINER_SECRETS: "stdin" },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    // An engine that fell over as it started: its exit below brings it back. Unheard, this EPIPE would stop the shell with an error box.
    child.stdin.on("error", (e) => console.error("[shell] the engine's stdin:", e.message));
    child.stdin.write(`${JSON.stringify({ token: this.token, keys: this.keys })}\n`);
    let buffer = "";
    child.stdout.on("data", (data: Buffer) => {
      this.log?.write(data);
      buffer += data.toString("utf8");
      for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n")) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("LINER_READY ")) continue;
        try {
          const { port, home } = JSON.parse(line.slice("LINER_READY ".length)) as { port: number; home?: string };
          this.port = port;
          if (home) this.home = home;
          this.onReady?.(port);
        } catch {
          // not the line we wait for
        }
      }
    });
    child.stderr.on("data", (data: Buffer) => this.log?.write(data));
    child.on("error", (e) => this.onFail?.(`The engine didn't start: ${e.message}`));
    child.on("exit", (code, signal) => {
      if (this.stopping || this.child !== child) return;
      // Back on the same port and token; more than five falls in a minute means something is wrong.
      const now = Date.now();
      this.restarts = [...this.restarts.filter((t) => now - t < 60_000), now];
      if (this.restarts.length > 5) {
        this.onFail?.(`The engine keeps stopping (exit ${code ?? signal}). Its log is in ${logFile.replace(homedir(), "~")}.`);
        return;
      }
      // A quit inside the wait doesn't bring one back.
      this.retry = setTimeout(() => {
        if (!this.stopping) this.launch(paths, env);
      }, 800);
    });
  }

  /**
    Stops the engine: its stdin closes, and it saves and exits. On Windows there's no SIGTERM to
    send (kill() ends it at once, before it has saved) and quitting the app takes it down with it,
    so this waits for it to go by itself, three seconds at most; the app waits on that.
  */
  stop(): Promise<void> {
    this.stopping = true;
    clearTimeout(this.retry);
    const child = this.child;
    child?.stdin?.end();
    if (process.platform !== "win32" || !child || child.exitCode !== null || child.signalCode !== null) {
      child?.kill("SIGTERM");
      return Promise.resolve();
    }
    return new Promise((done) => {
      const timer = setTimeout(() => {
        child.kill();
        done();
      }, 3000);
      child.once("exit", () => {
        clearTimeout(timer);
        done();
      });
    });
  }
}

const run = (cmd: string, args: string[], timeout = 5000) =>
  new Promise<string>((resolve) => execFile(cmd, args, { timeout, encoding: "utf8" }, (err, out) => resolve(err ? "" : out.trim())));

/**
  What an app opened from the Dock doesn't get from your shell rc files: PATH, and the CA, SSH-agent
  and locale variables a corporate proxy, 1Password's agent or a UTF-8 tool needs (T3 Code:
  DesktopShellEnvironment.ts LOGIN_SHELL_ENV_NAMES).
*/
const SHELL_NAMES = ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "SSH_AUTH_SOCK", "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS", "HOMEBREW_PREFIX", "JAVA_HOME", "__MISE_DIFF"];

/**
  The SHELL_NAMES a shell prints between marks (an interactive one may greet you first), the empty
  ones left out. It runs in a session of its own with nothing on stdin, so it never reaches for a
  terminal or waits on a question; whatever it hasn't said in `timeout` ms is left.
*/
const shellEnv = (sh: string, flags: string[], timeout: number) =>
  new Promise<Record<string, string>>((resolve) => {
    const child = spawn(sh, [...flags, `printf "__LINER_ENV__"; printf "%s\\0" ${SHELL_NAMES.map((n) => `"${n}=$${n}"`).join(" ")}; printf "__LINER_ENV__"`], { detached: true, stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    const done = () => {
      clearTimeout(timer);
      const vars: Record<string, string> = {};
      for (const entry of /__LINER_ENV__(.*?)__LINER_ENV__/s.exec(out)?.[1]?.split("\0") ?? []) {
        const eq = entry.indexOf("=");
        const value = eq > 0 ? entry.slice(eq + 1).trim() : "";
        if (value) vars[entry.slice(0, eq)] = value;
      }
      resolve(vars);
    };
    const timer = setTimeout(() => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        // already gone
      }
      done();
    }, timeout);
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString("utf8");
      // Said: something it left running may hold stdout open, so this doesn't wait for the close.
      if (out.split("__LINER_ENV__").length > 2) done();
    });
    child.on("error", done);
    child.on("close", done);
  });

/**
  The user's shell's PATH, CA, SSH-agent and locale variables, which an app opened from the Dock
  doesn't get, plus where tools often land.
*/
export async function loginEnvironment(): Promise<NodeJS.ProcessEnv> {
  const env = { ...process.env };
  if (process.platform === "win32") return windowsEnvironment(env);
  const sh = process.env.SHELL || "/bin/zsh";
  // Interactive as well as login: nvm, Volta, pnpm, mise and asdf go on PATH in .zshrc, which a
  // login shell alone doesn't read. A shell whose .zshrc stalls still gets its login PATH.
  const first = await shellEnv(sh, ["-i", "-l", "-c"], 8000);
  const shell = first.PATH ? first : await shellEnv(sh, ["-l", "-c"], 5000);
  // The shell starts from this environment, so a value it doesn't change comes back the same; one it
  // sets (1Password's SSH_AUTH_SOCK over launchd's) wins.
  for (const n of SHELL_NAMES) if (n !== "PATH" && shell[n]) env[n] = shell[n];
  // Terminal sets LANG itself, not the rc files: without one, tools would run in the C locale.
  if (!env.LANG && !env.LC_ALL && !env.LC_CTYPE) env.LC_CTYPE = "en_US.UTF-8";
  const path = shell.PATH || process.env.PATH || "/usr/bin:/bin";
  const parts = path.split(":");
  const home = homedir();
  const extra = ["/opt/homebrew/bin", "/usr/local/bin", ".local/bin", ".bun/bin", ".volta/bin", "Library/pnpm", ".local/share/mise/shims", ".asdf/shims"]
    .map((p) => (p.startsWith("/") ? p : join(home, p)))
    .filter((p) => !parts.includes(p) && existsSync(p));
  env.PATH = [...parts, ...extra].join(":");
  return env;
}

/**
  On Windows an app from the Start menu has your PATH already; it comes as "Path", which a copy of
  the environment keeps (and LINER_PATH reads as PATH), so it's put under one spelling, PATH, with
  the folders agent tools install to that aren't on it yet (T3 Code: packages/shared/src/shell.ts
  resolveKnownWindowsCliDirs).
*/
function windowsEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  let path = "";
  for (const k of Object.keys(env))
    if (k.toUpperCase() === "PATH") {
      path ||= env[k] ?? "";
      delete env[k];
    }
  const parts = path.split(";").filter(Boolean);
  const has = new Set(parts.map((p) => p.replace(/[\\/]+$/, "").toLowerCase()));
  const { APPDATA: roaming, LOCALAPPDATA: local, USERPROFILE: home = homedir() } = env;
  const extra = [roaming && join(roaming, "npm"), local && join(local, "Volta", "bin"), local && join(local, "pnpm"), join(home, ".local", "bin"), join(home, ".bun", "bin"), join(home, "scoop", "shims"), local && join(local, "Microsoft", "WinGet", "Links")].filter((p): p is string => Boolean(p) && !has.has(p!.toLowerCase()) && existsSync(p!));
  env.PATH = [...parts, ...extra].join(";");
  return env;
}

/** Your full name and this computer's, for the sidebar and Setup. */
export async function whoami(): Promise<{ user: string; machine: string }> {
  const mac = process.platform === "darwin";
  const [user, machine] = await Promise.all([mac ? run("id", ["-F"]) : Promise.resolve(""), mac ? run("scutil", ["--get", "ComputerName"]) : Promise.resolve("")]);
  return { user: user || userInfo().username, machine: machine || hostname().replace(/\.local$/, "") || "This computer" };
}
