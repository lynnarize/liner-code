/*
  What sits beside a session besides the diff: the project's files, a terminal, its pull
  requests (through the GitHub CLI), the dev servers listening on this Mac, and the iOS
  Simulator. Each one is a few commands the engine runs for the app.
*/
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { Device, PrInfo } from "../../contracts/src/index.ts";
import { run, which } from "./exec.ts";
import { uid, type Store } from "./store.ts";

/* ---------- Files ---------- */

/** A file in the session's folder, as text; anything binary or huge says so instead. */
export function readFile(root: string, path: string) {
  const abs = resolve(root, path);
  const rel = relative(root, abs);
  if (rel.startsWith("..")) throw new Error("That file is outside the project.");
  if (!existsSync(abs)) throw new Error("That file isn't there any more.");
  const size = statSync(abs).size;
  if (size > 2_000_000) return { text: "", size, binary: true };
  const buf = readFileSync(abs);
  const binary = buf.subarray(0, 8000).includes(0);
  return { text: binary ? "" : buf.toString("utf8"), size, binary };
}

/* ---------- Terminal ---------- */

/**
  A real terminal without a native module: Python's pty module forks the shell on a
  pseudo-terminal and relays bytes both ways. Window size changes come in on file descriptor 3
  as "cols rows" lines and reach the shell as SIGWINCH.
*/
const PTY = String.raw`
import os, pty, sys, select, signal, fcntl, termios, struct
pid, fd = pty.fork()
if pid == 0:
    shell = os.environ.get("SHELL", "/bin/zsh")
    os.execvp(shell, [shell, "-l"])
def size(cols, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    os.kill(pid, signal.SIGWINCH)
size(int(sys.argv[1]), int(sys.argv[2]))
ctl = os.fdopen(3, "rb", buffering=0)
buf = b""
while True:
    try:
        r, _, _ = select.select([fd, 0, 3], [], [])
    except InterruptedError:
        continue
    if fd in r:
        try:
            data = os.read(fd, 65536)
        except OSError:
            break
        if not data:
            break
        os.write(1, data)
    if 0 in r:
        data = os.read(0, 65536)
        if not data:
            break
        os.write(fd, data)
    if 3 in r:
        buf += ctl.read(256) or b""
        while b"\n" in buf:
            line, buf = buf.split(b"\n", 1)
            try:
                c, rr = line.split()
                size(int(c), int(rr))
            except Exception:
                pass
_, status = os.waitpid(pid, 0)
sys.exit(os.WEXITSTATUS(status) if os.WIFEXITED(status) else 1)
`;

type Term = { child: ChildProcessWithoutNullStreams; ctl: NodeJS.WritableStream };

export class Terminals {
  private terms = new Map<string, Term>();
  private store: Store;
  private env: NodeJS.ProcessEnv;
  constructor(store: Store, env: NodeJS.ProcessEnv) {
    this.store = store;
    this.env = env;
  }

  open(cwd: string, cols: number, rows: number, command?: string) {
    const python = which("python3", this.env) ?? "/usr/bin/python3";
    const id = uid("tm");
    const child = spawn(python, ["-I", "-c", PTY, String(Math.max(20, cols)), String(Math.max(5, rows))], {
      cwd,
      env: { ...this.env, TERM: "xterm-256color", COLORTERM: "truecolor", LINER_CODE: "1" },
      stdio: ["pipe", "pipe", "pipe", "pipe"],
    }) as unknown as ChildProcessWithoutNullStreams;
    const ctl = (child as unknown as { stdio: NodeJS.WritableStream[] }).stdio[3];
    this.terms.set(id, { child, ctl });
    // Output goes out in small batches, so a noisy command doesn't send an event per byte.
    let pending = "";
    let timer: NodeJS.Timeout | null = null;
    const flush = () => {
      timer = null;
      if (pending) this.store.emit({ type: "term", id, data: pending });
      pending = "";
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d: string) => {
      pending += d;
      timer ??= setTimeout(flush, 16);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d: string) => {
      pending += d;
      timer ??= setTimeout(flush, 16);
    });
    child.on("close", (code) => {
      flush();
      this.terms.delete(id);
      this.store.emit({ type: "term.exit", id, code: code ?? 0 });
    });
    // A script to run: typed into the shell once it's up, so it stays after the command ends.
    if (command) setTimeout(() => this.terms.get(id)?.child.stdin.write(`${command}\r`), 350);
    return { id, cwd };
  }
  write(id: string, data: string) {
    this.terms.get(id)?.child.stdin.write(data);
  }
  resize(id: string, cols: number, rows: number) {
    this.terms.get(id)?.ctl.write(`${cols} ${rows}\n`);
  }
  close(id: string) {
    const t = this.terms.get(id);
    if (!t) return;
    t.child.stdin.end();
    t.child.kill("SIGHUP");
    this.terms.delete(id);
  }
  closeAll() {
    for (const id of [...this.terms.keys()]) this.close(id);
  }
}

/* ---------- Pull requests, through gh ---------- */

export type GhState = "ready" | "missing" | "signed-out" | "no-remote";

export async function ghState(cwd: string, env: NodeJS.ProcessEnv): Promise<{ state: GhState; detail?: string }> {
  if (!which("gh", env)) return { state: "missing", detail: "The GitHub CLI isn't installed. brew install gh, then gh auth login." };
  const remote = await run("git", ["remote", "get-url", "origin"], { cwd, env });
  if (remote.code !== 0) return { state: "no-remote", detail: "This project has no origin remote on GitHub." };
  const auth = await run("gh", ["auth", "status"], { cwd, env, timeout: 15000 });
  if (auth.code !== 0) return { state: "signed-out", detail: "The GitHub CLI isn't signed in. Run gh auth login." };
  return { state: "ready" };
}

const PR_FIELDS = "number,title,url,state,isDraft,headRefName,baseRefName,additions,deletions,author,mergeable,reviewDecision,commits,statusCheckRollup,reviews,reviewRequests";

type GhPr = {
  number: number;
  title: string;
  url: string;
  state: PrInfo["state"];
  isDraft: boolean;
  headRefName: string;
  baseRefName: string;
  additions: number;
  deletions: number;
  author?: { login: string };
  mergeable?: string;
  reviewDecision?: string;
  commits?: { oid: string; messageHeadline: string }[];
  statusCheckRollup?: { name?: string; context?: string; conclusion?: string; status?: string; state?: string; detailsUrl?: string }[];
  reviews?: { author?: { login: string }; state: string; submittedAt?: string }[];
  reviewRequests?: { login?: string; name?: string }[];
};

function toPr(p: GhPr): PrInfo {
  const check = (c: NonNullable<GhPr["statusCheckRollup"]>[number]): PrInfo["checks"][number] => {
    const v = (c.conclusion || c.state || c.status || "").toUpperCase();
    const state = /SUCCESS|NEUTRAL/.test(v) ? "pass" : /FAIL|ERROR|CANCEL|TIMED|ACTION_REQUIRED/.test(v) ? "fail" : /SKIP/.test(v) ? "skipped" : "pending";
    return { name: c.name || c.context || "Check", state, detail: v.toLowerCase() };
  };
  return {
    number: p.number,
    title: p.title,
    url: p.url,
    state: p.state,
    isDraft: p.isDraft,
    head: p.headRefName,
    base: p.baseRefName,
    additions: p.additions,
    deletions: p.deletions,
    author: p.author?.login,
    mergeable: p.mergeable,
    reviewDecision: p.reviewDecision,
    commits: (p.commits ?? []).map((c) => ({ sha: c.oid.slice(0, 7), title: c.messageHeadline })),
    checks: (p.statusCheckRollup ?? []).map(check),
    reviews: (p.reviews ?? []).map((r) => ({ author: r.author?.login ?? "someone", state: r.state, at: r.submittedAt })),
    requested: (p.reviewRequests ?? []).map((r) => r.login ?? r.name ?? "").filter(Boolean),
  };
}

export async function prFor(cwd: string, branch: string, env: NodeJS.ProcessEnv): Promise<PrInfo | null> {
  const r = await run("gh", ["pr", "view", branch, "--json", PR_FIELDS], { cwd, env, timeout: 30000 });
  if (r.code !== 0) return null;
  try {
    return toPr(JSON.parse(r.stdout) as GhPr);
  } catch {
    return null;
  }
}

export async function prList(cwd: string, env: NodeJS.ProcessEnv): Promise<PrInfo[]> {
  const r = await run("gh", ["pr", "list", "--state", "all", "--limit", "30", "--json", PR_FIELDS], { cwd, env, timeout: 30000 });
  if (r.code !== 0) throw new Error(r.stderr.trim() || "gh pr list failed.");
  return (JSON.parse(r.stdout) as GhPr[]).map(toPr);
}

/** Pushes the branch and opens a pull request for it. */
export async function prCreate(cwd: string, branch: string, o: { title: string; body: string; draft: boolean }, env: NodeJS.ProcessEnv) {
  const push = await run("git", ["push", "-u", "origin", branch], { cwd, env, timeout: 120000 });
  if (push.code !== 0) throw new Error(push.stderr.trim().split("\n").pop() || "The push failed.");
  const args = ["pr", "create", "--head", branch, "--title", o.title, "--body", o.body || " "];
  if (o.draft) args.push("--draft");
  const r = await run("gh", args, { cwd, env, timeout: 60000 });
  if (r.code !== 0) throw new Error(r.stderr.trim().split("\n").pop() || "gh pr create failed.");
  const pr = await prFor(cwd, branch, env);
  if (!pr) throw new Error("The pull request opened, but gh couldn't read it back.");
  return pr;
}

export async function prMerge(cwd: string, n: number, env: NodeJS.ProcessEnv) {
  const r = await run("gh", ["pr", "merge", String(n), "--squash", "--delete-branch=false"], { cwd, env, timeout: 120000 });
  if (r.code !== 0) throw new Error(r.stderr.trim().split("\n").pop() || "The merge failed.");
}

/* ---------- Dev servers on this Mac ---------- */

/** Ports something is listening on, that look like a dev server you'd open in the browser. */
export async function listeningPorts(env: NodeJS.ProcessEnv) {
  const r = await run("lsof", ["+c", "0", "-nP", "-iTCP", "-sTCP:LISTEN"], { env, timeout: 8000 });
  const out = new Map<number, string>();
  const skip = /^(rapportd|ControlCe|ControlCenter|sharingd|AirPlay|figma_age|Dropbox|Spotify|Adobe|com\.docke|postgres|mysqld|redis-ser|mongod|ollama|LM Studio)/i;
  for (const line of r.stdout.split("\n").slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 9) continue;
    const proc = parts[0];
    const m = /:(\d+)$/.exec(parts[8]);
    if (!m) continue;
    const port = Number(m[1]);
    if (port < 1024 || skip.test(proc) || out.has(port)) continue;
    out.set(port, proc.replace(/\\x20/g, " "));
  }
  return [...out].sort((a, b) => a[0] - b[0]).map(([port, process]) => ({ port, process, url: `http://localhost:${port}` }));
}

/* ---------- The iOS Simulator ---------- */

export async function devices(env: NodeJS.ProcessEnv): Promise<{ devices: Device[]; ready: boolean; detail?: string }> {
  const r = await run("xcrun", ["simctl", "list", "devices", "available", "--json"], { env, timeout: 20000 });
  if (r.code !== 0) return { devices: [], ready: false, detail: "The iOS Simulator needs Xcode." };
  const d = JSON.parse(r.stdout) as { devices: Record<string, { udid: string; name: string; state: string }[]> };
  const list: Device[] = [];
  for (const [rt, ds] of Object.entries(d.devices)) {
    const runtime = rt.replace(/^.*SimRuntime\./, "").replace(/-(\d+)-(\d+)$/, " $1.$2").replace(/-(\d+)$/, " $1");
    for (const x of ds) list.push({ udid: x.udid, name: x.name, runtime, state: x.state });
  }
  // Booted first, then iPhones, newest runtime first.
  list.sort((a, b) => Number(b.state === "Booted") - Number(a.state === "Booted") || Number(b.name.startsWith("iPhone")) - Number(a.name.startsWith("iPhone")) || b.runtime.localeCompare(a.runtime));
  return { devices: list, ready: true };
}

export async function boot(udid: string, env: NodeJS.ProcessEnv) {
  await run("xcrun", ["simctl", "boot", udid], { env, timeout: 120000 });
  await run("open", ["-a", "Simulator"], { env });
}

/** The device's screen, as a PNG in base64. */
export function screenshot(udid: string, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolveShot, reject) => {
    const child = spawn("xcrun", ["simctl", "io", udid, "screenshot", "--type=png", "-"], { env });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.on("close", (code) => (code === 0 ? resolveShot(Buffer.concat(chunks).toString("base64")) : reject(new Error("The simulator didn't give a screenshot. Is the device booted?"))));
    child.on("error", reject);
  });
}

export async function appearance(udid: string, mode: "light" | "dark", env: NodeJS.ProcessEnv) {
  await run("xcrun", ["simctl", "ui", udid, "appearance", mode], { env });
}

/** The device's log, streamed as `devlog` events while it's on. */
export class DeviceLogs {
  private live = new Map<string, ChildProcessWithoutNullStreams>();
  private store: Store;
  private env: NodeJS.ProcessEnv;
  constructor(store: Store, env: NodeJS.ProcessEnv) {
    this.store = store;
    this.env = env;
  }
  set(udid: string, on: boolean, filter?: string) {
    this.live.get(udid)?.kill();
    this.live.delete(udid);
    if (!on) return;
    const args = ["simctl", "spawn", udid, "log", "stream", "--style", "compact", "--level", "info"];
    if (filter) args.push("--predicate", `eventMessage CONTAINS[c] "${filter.replace(/"/g, "")}" OR process CONTAINS[c] "${filter.replace(/"/g, "")}"`);
    const child = spawn("xcrun", args, { env: this.env }) as ChildProcessWithoutNullStreams;
    this.live.set(udid, child);
    let buf = "";
    let batch: string[] = [];
    let timer: NodeJS.Timeout | null = null;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d: string) => {
      buf += d;
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      batch.push(...lines.filter((l) => l.trim() && !l.startsWith("Filtering the log data")));
      timer ??= setTimeout(() => {
        timer = null;
        if (batch.length) this.store.emit({ type: "devlog", udid, lines: batch.slice(-200) });
        batch = [];
      }, 250);
    });
    child.on("close", () => this.live.delete(udid));
  }
  stopAll() {
    for (const c of this.live.values()) c.kill();
    this.live.clear();
  }
}

