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
  private log?: WriteStream;

  start(paths: Paths, env: NodeJS.ProcessEnv, keys: Record<string, string>) {
    mkdirSync(logDir, { recursive: true });
    try {
      renameSync(logFile, previousLogFile);
    } catch {
      // the first launch
    }
    this.log = createWriteStream(logFile, { flags: "w" });
    this.launch(paths, env, keys);
  }

  private launch(paths: Paths, env: NodeJS.ProcessEnv, keys: Record<string, string>) {
    const child = spawn(process.execPath, [paths.engine, "--port", String(this.port), "--ui", paths.ui], {
      cwd: dirname(paths.engine),
      // The token and keys go over stdin, not the environment: anything running as you can read a
      // process's starting environment with `ps eww`, the agents the engine starts included.
      env: { ...env, ELECTRON_RUN_AS_NODE: "1", LINER_PATH: env.PATH, LINER_SECRETS: "stdin" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    child.stdin.write(`${JSON.stringify({ token: this.token, keys })}\n`);
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
      setTimeout(() => this.launch(paths, env, keys), 800);
    });
  }

  stop() {
    this.stopping = true;
    this.child?.stdin?.end();
    this.child?.kill("SIGTERM");
  }
}

const run = (cmd: string, args: string[], timeout = 5000) =>
  new Promise<string>((resolve) => execFile(cmd, args, { timeout, encoding: "utf8" }, (err, out) => resolve(err ? "" : out.trim())));

/**
  The PATH a shell prints between marks (an interactive one may greet you first), or "". It runs in
  a session of its own with nothing on stdin, so it never reaches for a terminal or waits on a
  question; whatever it hasn't said in `timeout` ms is left.
*/
const pathFrom = (sh: string, flags: string[], timeout: number) =>
  new Promise<string>((resolve) => {
    const child = spawn(sh, [...flags, 'printf "__LINER_PATH__%s__LINER_PATH__" "$PATH"'], { detached: true, stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    const done = () => {
      clearTimeout(timer);
      resolve(/__LINER_PATH__(.*?)__LINER_PATH__/s.exec(out)?.[1]?.trim() ?? "");
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
      if (out.split("__LINER_PATH__").length > 2) done();
    });
    child.on("error", done);
    child.on("close", done);
  });

/** The user's shell's PATH, which an app opened from the Dock doesn't get, plus where tools often land. */
export async function loginEnvironment(): Promise<NodeJS.ProcessEnv> {
  const env = { ...process.env };
  if (process.platform === "win32") return env;
  const sh = process.env.SHELL || "/bin/zsh";
  // Interactive as well as login: nvm, Volta, pnpm, mise and asdf go on PATH in .zshrc, which a
  // login shell alone doesn't read. A shell whose .zshrc stalls still gets its login PATH.
  const path = (await pathFrom(sh, ["-i", "-l", "-c"], 8000)) || (await pathFrom(sh, ["-l", "-c"], 5000)) || process.env.PATH || "/usr/bin:/bin";
  const parts = path.split(":");
  const home = homedir();
  const extra = ["/opt/homebrew/bin", "/usr/local/bin", ".local/bin", ".bun/bin", ".volta/bin", "Library/pnpm", ".local/share/mise/shims", ".asdf/shims"]
    .map((p) => (p.startsWith("/") ? p : join(home, p)))
    .filter((p) => !parts.includes(p) && existsSync(p));
  env.PATH = [...parts, ...extra].join(":");
  return env;
}

/** Your full name and this computer's, for the sidebar and Setup. */
export async function whoami(): Promise<{ user: string; machine: string }> {
  const mac = process.platform === "darwin";
  const [user, machine] = await Promise.all([mac ? run("id", ["-F"]) : Promise.resolve(""), mac ? run("scutil", ["--get", "ComputerName"]) : Promise.resolve("")]);
  return { user: user || userInfo().username, machine: machine || hostname().replace(/\.local$/, "") || "This computer" };
}
