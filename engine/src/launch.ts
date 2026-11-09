/*
  The dev servers of a session folder's .claude/launch.json, the file Claude Code reads for its
  previews (the same format, so one file serves both), run by the engine for the Browser. They
  come and go as Claude Code's do: one runs when you press Run, never by itself the first time,
  and stops by itself when no session in its folder has been on screen for half an hour and none
  of them is working a turn, when the session that started it is archived, when another needs
  its port, and when Liner Code quits. One stopped for your being away (or by the quit) starts
  again when you open a session in its folder, as long as its entry in launch.json is still the
  one you ran: a command the file says now is never run without a press.

  Agents start them too (server_start, agent-tools.ts), and what one starts follows the same rules.
  The entries you've run in a folder are kept, so an agent runs one of those as freely as you did;
  any other command comes to you first, unless the session may run commands without asking.
*/
import type { ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, Socket } from "node:net";
import { basename, join, resolve } from "node:path";
import type { EngineEvent, LaunchServer } from "../../contracts/src/index.ts";
import { closesOnExit, killTree, spawn, THREAD_ENV } from "./exec.ts";

const win = process.platform === "win32";

/** How long a folder's servers stay up with none of its sessions on screen or working (Claude Code's: 30 minutes). */
export const IDLE_MS = 30 * 60_000;
/** A server that ends this soon hasn't started (Claude Code waits as long before it counts one as up). */
const EARLY_MS = 3000;
/** How long one may take to answer on its port before it counts as up anyway. */
const READY_MS = 60_000;
/** The entries kept as yours to run again, newest last. */
const TRUSTED = 500;
/** The lines of its output kept, the last few of them shown when it ends. */
const TAIL = 200;
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g;

/** An entry of launch.json, as it runs. `raw` is the entry as written, to tell when the file says something else. */
export type LaunchEntry = { name: string; command?: string; args: string[]; port: number; cwd: string; env: Record<string, string>; autoPort?: boolean; url?: string; raw: string; problem?: string };

/** JSON with comments and trailing commas, as launch.json may be written (VS Code's own allows them), made plain JSON. */
export function plainJson(text: string) {
  // Past blanks and comments, from j: where the next thing that counts starts.
  const skip = (j: number) => {
    for (;;) {
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text.startsWith("//", j)) while (j < text.length && text[j] !== "\n") j++;
      else if (text.startsWith("/*", j)) {
        const end = text.indexOf("*/", j + 2);
        j = end < 0 ? text.length : end + 2;
      } else return j;
    }
  };
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      // A string as it is, escapes and all: a // or a ,] inside one is text.
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === "/" && (text[i + 1] === "/" || text[i + 1] === "*")) {
      out += " ";
      i = skip(i) - 1;
    } else if (c === ",") {
      const next = text[skip(i + 1)];
      if (next !== "]" && next !== "}") out += c;
    } else out += c;
  }
  return out;
}

/** The servers launch.json lists in `root`, in its order; `file` says whether there is one. */
export function readLaunch(root: string): { entries: LaunchEntry[]; file: boolean; error?: string } {
  const path = join(root, ".claude", "launch.json");
  if (!existsSync(path)) return { entries: [], file: false };
  let doc: unknown;
  try {
    doc = JSON.parse(plainJson(readFileSync(path, "utf8")));
  } catch (e) {
    return { entries: [], file: true, error: `.claude/launch.json can't be read: ${e instanceof Error ? e.message : String(e)}` };
  }
  const list = (doc as { configurations?: unknown } | null)?.configurations;
  if (!Array.isArray(list)) return { entries: [], file: true, error: ".claude/launch.json has no configurations list." };
  const names = new Set<string>();
  const entries: LaunchEntry[] = [];
  for (const c of list as unknown[]) {
    if (!c || typeof c !== "object") continue;
    const name = (c as { name?: unknown }).name;
    // A name is how a server is known, kept and woken: one without, or twice, can't be told apart.
    if (typeof name !== "string" || !name.trim() || names.has(name.trim())) continue;
    names.add(name.trim());
    entries.push(entryOf(root, c as Record<string, unknown>));
  }
  return { entries, file: true };
}

/** One entry, read as Claude Code reads it: runtimeExecutable and runtimeArgs, or a program for node; port 3000 unless it says. */
function entryOf(root: string, c: Record<string, unknown>): LaunchEntry {
  const sub = (s: string) => s.replaceAll("${workspaceFolder}", root);
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" || typeof x === "number").map((x) => sub(String(x))) : []);
  const env: Record<string, string> = {};
  if (c.env && typeof c.env === "object") for (const [k, v] of Object.entries(c.env)) if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && v !== null && v !== undefined && typeof v !== "object") env[k] = sub(String(v));
  let command: string | undefined;
  let args: string[] = [];
  if (typeof c.runtimeExecutable === "string" && c.runtimeExecutable.trim()) (command = sub(c.runtimeExecutable.trim())), (args = strs(c.runtimeArgs));
  else if (typeof c.program === "string" && c.program.trim()) (command = "node"), (args = [sub(c.program.trim()), ...strs(c.args)]);
  const url = typeof c.url === "string" && c.url.trim() ? c.url.trim() : undefined;
  const given = typeof c.port === "number" && Number.isInteger(c.port) && c.port > 0 && c.port <= 65535 ? c.port : undefined;
  let port = given ?? 3000;
  let problem: string | undefined;
  if (url) {
    try {
      const u = new URL(url);
      const local = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(u.hostname) || /\.localhost$/i.test(u.hostname);
      const at = Number(u.port || (u.protocol === "https:" ? 443 : 80));
      if (!/^https?:$/.test(u.protocol)) problem = "Its url isn't an http or https address.";
      else if (!local) problem = "Its url is a site elsewhere; the Browser opens servers on this computer.";
      else if (given === undefined) port = at;
      else if (at !== port) problem = `Its url's port (${at}) isn't its port (${port}).`;
    } catch {
      problem = "Its url isn't an address.";
    }
  }
  if (!command && !url) problem ??= "It names nothing to run (runtimeExecutable or program) and no url.";
  if (port < 1024) problem ??= `Port ${port} is under 1024; the Browser opens ports from 1024 up.`;
  return { name: String(c.name).trim(), command, args, port, cwd: typeof c.cwd === "string" && c.cwd.trim() ? resolve(root, sub(c.cwd.trim())) : root, env, autoPort: typeof c.autoPort === "boolean" ? c.autoPort : undefined, url, raw: JSON.stringify(c), problem };
}

/**
  The command with its port changed where it names it (--port 5173, --port=5173, -p 5173, or in a
  whole command line given as one argument, bash -c "… --port 5173"); null when it names it nowhere.
  Only that port: a line that also starts something on another port keeps that one.
*/
export function movePort(args: string[], from: number, to: number): string[] | null {
  let moved = false;
  const out = args.map((a, i) => {
    if (a === String(from) && (args[i - 1] === "--port" || args[i - 1] === "-p")) return (moved = true), String(to);
    if (a === `--port=${from}`) return (moved = true), `--port=${to}`;
    if (/\s/.test(a)) return a.replace(new RegExp(`(--port[= ]|-p )${from}(?!\\d)`, "g"), (_, flag: string) => ((moved = true), `${flag}${to}`));
    return a;
  });
  return moved ? out : null;
}

/**
  Whether an entry may run on another port when its own is taken, by Claude Code's rules: as
  autoPort says, when it says; else yes, unless it's a package script (npm, yarn, pnpm, bun) that
  pins a port of its own, or one that can't be read, and its arguments don't name the port.
*/
export function canMove(e: LaunchEntry): boolean {
  if (e.autoPort !== undefined) return e.autoPort;
  if (movePort(e.args, e.port, e.port + 1)) return true;
  const tool = basename(e.command ?? "").replace(/\.(cmd|exe|ps1)$/i, "");
  if (!["npm", "yarn", "pnpm", "bun"].includes(tool)) return true;
  const at = e.args.findIndex((a) => a === "run" || a === "run-script");
  const script = at >= 0 ? e.args[at + 1] : e.args.find((a) => !a.startsWith("-"));
  try {
    const text = (JSON.parse(readFileSync(join(e.cwd, "package.json"), "utf8")) as { scripts?: Record<string, unknown> }).scripts?.[script ?? ""];
    return typeof text === "string" && !/(--port[= ]?|-p\s*|PORT=)\d{2,5}/.test(text);
  } catch {
    return false;
  }
}

/** Whether something answers on a loopback address and port. */
function answers(port: number, host: string) {
  return new Promise<boolean>((done) => {
    const s = new Socket();
    const end = (v: boolean) => (s.destroy(), done(v));
    s.setTimeout(500);
    s.once("connect", () => end(true));
    s.once("error", () => end(false));
    s.once("timeout", () => end(false));
    s.connect(port, host);
  });
}
/** localhost resolves to either, so a server on one alone is on the port all the same. */
const listening = async (port: number) => (await answers(port, "127.0.0.1")) || (await answers(port, "::1"));

/** Takes a port on 127.0.0.1 and lets it go: the port, or (want 0) one the system picked. */
function bind(want: number) {
  return new Promise<number>((done, fail) => {
    const s = createServer();
    s.once("error", fail);
    s.listen(want, "127.0.0.1", () => {
      const a = s.address();
      const port = typeof a === "object" && a ? a.port : want;
      s.close(() => done(port));
    });
  });
}
export async function portFree(port: number) {
  if (await listening(port)) return false;
  return bind(port).then(
    () => true,
    () => false,
  );
}
async function freePort() {
  for (let i = 0; i < 20; i++) {
    const p = await bind(0);
    if (p >= 1024 && !(await listening(p))) return p;
  }
  throw new Error("No free port could be found.");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const keyOf = (root: string, name: string) => `${root}\0${name}`;
const exitWords = (code: number | null, signal: string | null) => (signal ? `Ended by ${signal}` : code ? `Exited with code ${code}` : "Exited");

type Run = {
  key: string;
  root: string;
  entry: LaunchEntry;
  port: number;
  child: ChildProcess;
  status: "starting" | "running";
  startedAt: number;
  threadId: string;
  tail: string[];
  /** A port it printed (a server that went to another port by itself says so: Vite's "Local: http://localhost:5174/"). */
  printed?: number;
  /** Why it's being stopped, once it is: what it says once it has. */
  stop?: string;
  done: boolean;
  gone: Promise<void>;
  /** Settles once it answers on its port, gives up waiting, or ends. */
  ready: Promise<void>;
};
/** A server stopped while no one looked (or by the quit), to start again when a session in its folder is opened. */
type Asleep = { root: string; name: string; threadId: string; raw: string; at: number };
type Ended = { reason: string; at: number; port: number; failed?: boolean; tail?: string[]; lines?: string[] };
/** An entry as written in one folder, for telling the ones you've run. */
const trustKey = (root: string, raw: string) => createHash("sha256").update(`${root}\0${raw}`).digest("hex").slice(0, 32);

export type LaunchHost = {
  env: NodeJS.ProcessEnv;
  emit: (e: EngineEvent) => void;
  /** A session's folder: its worktree's, else its project's. */
  cwdOf: (threadId: string) => string;
  /** The sessions that work in a folder, archived ones left out; `busy` while a turn runs or waits on you. */
  sessionsIn: (root: string) => { id: string; busy: boolean }[];
  /** Where the servers to start again are kept through a quit; none, kept in memory only. */
  file?: string;
  /** Who's on a port, for the note when it's taken. */
  holder?: (port: number) => Promise<string | undefined>;
  now?: () => number;
  idleMs?: number;
};

export class Launcher {
  private host: LaunchHost;
  private runs = new Map<string, Run>();
  private ended = new Map<string, Ended>();
  private asleep: Asleep[];
  /** The entries run in each folder by you, or by an agent you let: run again without asking. */
  private trusted: string[];
  /** When the app last showed each session. */
  private seenAt = new Map<string, number>();
  /** Starts under way, so two quick presses start one server. */
  private starting = new Map<string, Promise<LaunchServer>>();
  private timer: NodeJS.Timeout | null = null;
  constructor(host: LaunchHost) {
    this.host = host;
    const kept = this.load();
    this.asleep = kept.asleep;
    this.trusted = kept.trusted;
  }
  private now() {
    return this.host.now?.() ?? Date.now();
  }
  private get idle() {
    return this.host.idleMs ?? IDLE_MS;
  }

  /** Looks once a minute for folders no one has looked at. */
  watch() {
    this.timer ??= setInterval(() => this.sweep(), 60_000);
    this.timer.unref();
  }

  async list(threadId: string): Promise<{ servers: LaunchServer[]; file: boolean; error?: string }> {
    const root = this.host.cwdOf(threadId);
    const { entries, file, error } = readLaunch(root);
    const servers = await Promise.all(entries.map((e) => this.state(root, e)));
    // One the file no longer names runs on till it's stopped: listed, so it can be.
    for (const r of this.runs.values()) if (r.root === root && !entries.some((e) => e.name === r.entry.name)) servers.push({ ...(await this.state(root, r.entry)), changed: true });
    return { servers, file, error };
  }

  private async state(root: string, e: LaunchEntry): Promise<LaunchServer> {
    const key = keyOf(root, e.name);
    const r = this.runs.get(key);
    if (r) return { name: e.name, port: e.port, at: r.port, status: r.status, startedAt: r.startedAt, changed: r.entry.raw !== e.raw || undefined };
    // An entry with only a url opens a server you run yourself: it runs when something answers there.
    if (!e.command && !e.problem && (await listening(e.port))) return { name: e.name, port: e.port, at: e.port, status: "running" };
    const x = this.ended.get(key);
    const asleep = this.asleep.some((a) => a.root === root && a.name === e.name) || undefined;
    return { name: e.name, port: e.port, at: x?.port, status: "stopped", ended: x && { reason: x.reason, at: x.at, failed: x.failed, tail: x.tail }, asleep, problem: e.problem };
  }

  /** The entry named `name` of the session's folder, as the file says it now. */
  entry(threadId: string, name: string): LaunchEntry {
    const root = this.host.cwdOf(threadId);
    const { entries, file, error } = readLaunch(root);
    if (error) throw new Error(error);
    if (!file) throw new Error(`This folder has no .claude/launch.json, so it has no server named "${name}".`);
    const e = entries.find((x) => x.name === name);
    if (!e) throw new Error(`.claude/launch.json has no server named "${name}"${entries.length ? `; it has ${entries.map((x) => `"${x.name}"`).join(", ")}` : ""}.`);
    return e;
  }

  /** Whether this entry, as written, is one you ran in this folder (or let an agent run). */
  trusts(threadId: string, e: LaunchEntry) {
    return !e.command || this.trusted.includes(trustKey(this.host.cwdOf(threadId), e.raw));
  }

  /**
    Runs the entry named `name` of the session's folder, or answers with the one that runs already.
    With `raw`, only while the file still says that: what you were asked about is what runs.
  */
  async start(threadId: string, name: string, raw?: string) {
    const root = this.host.cwdOf(threadId);
    const e = this.entry(threadId, name);
    if (raw !== undefined && e.raw !== raw) throw new Error(`${name}'s entry in .claude/launch.json changed after it was asked about, so it didn't run.`);
    if (e.command) {
      const k = trustKey(root, e.raw);
      if (this.trusted.at(-1) !== k) (this.trusted = [...this.trusted.filter((x) => x !== k), k].slice(-TRUSTED)), this.save();
    }
    return this.run(root, e, threadId);
  }

  /** Waits, up to `ms`, for a server that's starting to answer on its port or end; then says how it is. */
  async settle(threadId: string, name: string, ms: number) {
    const root = this.host.cwdOf(threadId);
    const r = this.runs.get(keyOf(root, name));
    if (r) await Promise.race([r.ready, sleep(ms)]);
    return (await this.list(threadId)).servers.find((s) => s.name === name);
  }

  /** What a server printed, newest last: the one running, else the last one that ended. */
  logs(threadId: string, name: string) {
    const key = keyOf(this.host.cwdOf(threadId), name);
    const r = this.runs.get(key);
    if (r) return { running: true, lines: [...r.tail] };
    const x = this.ended.get(key);
    return { running: false, lines: x?.lines ?? x?.tail ?? [], ended: x?.reason };
  }

  async restart(threadId: string, name: string) {
    const root = this.host.cwdOf(threadId);
    const r = this.runs.get(keyOf(root, name));
    if (r) await this.halt(r, "Restarted");
    return this.start(threadId, name);
  }

  /** Stops one, or (no name) all of the folder's; and none of them starts again by itself. */
  async stop(threadId: string, name?: string) {
    const root = this.host.cwdOf(threadId);
    const which = [...this.runs.values()].filter((r) => r.root === root && (name === undefined || r.entry.name === name));
    const woke = this.asleep.length;
    this.asleep = this.asleep.filter((a) => !(a.root === root && (name === undefined || a.name === name)));
    if (this.asleep.length !== woke) (this.save(), this.emit(root));
    await Promise.all(which.map((r) => this.halt(r, "Stopped")));
    return which.length;
  }

  /** The app shows this session: its folder counts as looked at, and what stopped while no one looked starts again. */
  seen(threadId: string) {
    this.seenAt.set(threadId, this.now());
    const root = this.host.cwdOf(threadId);
    const wake = this.asleep.filter((a) => a.root === root);
    if (!wake.length) return;
    this.asleep = this.asleep.filter((a) => a.root !== root);
    this.save();
    const { entries } = readLaunch(root);
    const alive = new Set(this.host.sessionsIn(root).map((s) => s.id));
    for (const a of wake) {
      const e = entries.find((x) => x.name === a.name);
      // What runs again is what you ran: a command the file says now waits for your press.
      if (!e || e.raw !== a.raw) {
        const was = this.ended.get(keyOf(root, a.name));
        this.ended.set(keyOf(root, a.name), { reason: e ? "Not started again: its entry in launch.json changed since you ran it" : "Not started again: launch.json no longer has it", at: this.now(), port: was?.port ?? e?.port ?? 0 });
        this.emit(root);
        continue;
      }
      void this.run(root, e, alive.has(a.threadId) ? a.threadId : threadId).catch(() => {});
    }
  }

  /**
    Stops the servers of folders none of whose sessions has been on screen for the idle time and
    none of which is working a turn, to start again when one is opened (Claude Code: its preview
    idle teardown, 30 minutes out of sight).
  */
  sweep() {
    const now = this.now();
    for (const r of [...this.runs.values()]) {
      if (r.stop || now - r.startedAt < this.idle) continue;
      if (this.host.sessionsIn(r.root).some((s) => s.busy || now - (this.seenAt.get(s.id) ?? 0) < this.idle)) continue;
      this.putToSleep(r);
      void this.halt(r, `Stopped after ${Math.round(this.idle / 60_000)} minutes with no session in its folder on screen; it starts again when you open one`);
    }
  }

  /** A session archived or deleted: what it started stops, and so does what's left in its folder once no other session works there. */
  forget(threadId: string) {
    this.seenAt.delete(threadId);
    let root: string;
    try {
      root = this.host.cwdOf(threadId);
    } catch {
      return;
    }
    const alone = !this.host.sessionsIn(root).some((s) => s.id !== threadId);
    const before = this.asleep.length;
    this.asleep = this.asleep.filter((a) => a.threadId !== threadId && !(alone && a.root === root));
    if (this.asleep.length !== before) this.save();
    for (const r of [...this.runs.values()]) if (r.threadId === threadId || (alone && r.root === root)) void this.halt(r, "Stopped with the session that started it");
  }

  /** Liner Code quits: each stops, and is kept to start again when its folder's session is opened next time. */
  quit() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const r of this.runs.values()) {
      if (r.stop) continue;
      this.putToSleep(r);
      r.stop = "Stopped when Liner Code quit";
      killTree(r.child);
    }
    this.save();
  }

  private putToSleep(r: Run) {
    this.asleep = [...this.asleep.filter((a) => !(a.root === r.root && a.name === r.entry.name)), { root: r.root, name: r.entry.name, threadId: r.threadId, raw: r.entry.raw, at: this.now() }];
    this.save();
  }

  private halt(r: Run, why: string) {
    // A start of it still under way is over: the next press starts afresh.
    this.starting.delete(r.key);
    if (!r.done) {
      r.stop ??= why;
      killTree(r.child);
    }
    return r.gone;
  }

  private emit(root: string) {
    this.host.emit({ type: "launch", root });
  }

  private run(root: string, e: LaunchEntry, threadId: string): Promise<LaunchServer> {
    const key = keyOf(root, e.name);
    const live = this.runs.get(key);
    if (live) return this.state(root, e);
    const under = this.starting.get(key);
    if (under) return under;
    const p: Promise<LaunchServer> = this.spawn(root, e, threadId).finally(() => {
      if (this.starting.get(key) === p) this.starting.delete(key);
    });
    this.starting.set(key, p);
    return p;
  }

  private async spawn(root: string, e: LaunchEntry, threadId: string): Promise<LaunchServer> {
    const key = keyOf(root, e.name);
    // What didn't start says so in its row too, not only where it was asked for.
    const refuse = (reason: string, port = e.port): never => {
      this.ended.set(key, { reason, at: this.now(), port, failed: true });
      this.emit(root);
      throw new Error(reason);
    };
    if (e.problem) return refuse(e.problem);
    if (!e.command) {
      if (await listening(e.port)) return { name: e.name, port: e.port, at: e.port, status: "running" };
      return refuse(`Nothing answers at ${e.url}. This entry opens a server you start yourself.`);
    }
    // Pressed again before it woke: it's running now because you asked.
    this.asleep = this.asleep.filter((a) => !(a.root === root && a.name === e.name));
    this.save();
    let port = e.port;
    let args = e.args;
    if (!(await portFree(port))) {
      const ours = [...this.runs.values()].find((r) => r.port === port);
      if (canMove(e)) {
        port = await freePort();
        args = movePort(e.args, e.port, port) ?? e.args;
      } else if (ours) await this.halt(ours, `Stopped to make way for ${e.name}, which needs port ${port}`);
      else {
        const who = await this.host.holder?.(port).catch(() => undefined);
        return refuse(`Port ${port} is taken${who ? ` by ${who}` : ""}. Stop what runs there, or let ${e.name} move with "autoPort": true in .claude/launch.json.`);
      }
    }
    let child: ChildProcess;
    try {
      // A group of its own, so stopping it stops what it started (npm and the server under it).
      child = spawn(e.command, args, { cwd: e.cwd, env: { ...this.host.env, FORCE_COLOR: "1", ...e.env, PORT: String(port), LINER_CODE: "1", [THREAD_ENV]: threadId }, detached: !win, stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      return refuse(`${e.name} didn't start: ${err instanceof Error ? err.message : String(err)}`, port);
    }
    closesOnExit(child);
    let gone!: () => void;
    const r: Run = { key, root, entry: e, port, child, status: "starting", startedAt: this.now(), threadId, tail: [], done: false, gone: new Promise<void>((ok) => (gone = ok)), ready: Promise.resolve() };
    this.runs.set(key, r);
    this.ended.delete(key);
    this.emit(root);
    let part = "";
    const take = (d: Buffer) => {
      const lines = (part + d.toString("utf8")).replace(ANSI, "").split(/\r?\n|\r/);
      part = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        r.tail.push(line.slice(0, 400));
        const m = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):(\d{4,5})/.exec(line);
        if (m) r.printed ??= Number(m[1]);
      }
      if (r.tail.length > TAIL) r.tail.splice(0, r.tail.length - TAIL);
    };
    child.stdout?.on("data", take);
    child.stderr?.on("data", take);
    const end = (code: number | null, signal: string | null, error?: string) => {
      if (r.done) return;
      r.done = true;
      if (part.trim()) r.tail.push(part.slice(0, 400));
      if (error) r.tail.push(error);
      if (this.runs.get(key) === r) this.runs.delete(key);
      const quick = this.now() - r.startedAt < EARLY_MS;
      const lines = r.tail.slice();
      this.ended.set(key, r.stop ? { reason: r.stop, at: this.now(), port: r.port, lines } : { reason: error ? `${e.name} didn't start: ${error}` : exitWords(code, signal), at: this.now(), port: r.port, failed: Boolean(error) || quick || (code !== 0 && code !== null) || Boolean(signal), tail: r.tail.slice(-12), lines });
      gone();
      this.emit(root);
    };
    child.on("exit", (code, signal) => end(code, signal));
    child.on("error", (err) => end(null, null, err.message));
    // Up once it answers on its port (or the one it said it went to).
    const ready = (r.ready = (async () => {
      const until = Date.now() + READY_MS;
      while (!r.done && !r.stop && Date.now() < until) {
        if (await listening(r.port)) break;
        if (r.printed && r.printed !== r.port && (await listening(r.printed))) {
          r.port = r.printed;
          break;
        }
        await sleep(300);
      }
      if (!r.done && r.status === "starting") {
        r.status = "running";
        this.emit(root);
      }
    })());
    await Promise.race([ready, r.gone, sleep(EARLY_MS)]);
    if (r.done) {
      const x = this.ended.get(key);
      throw new Error([x?.reason ?? `${e.name} ended`, ...(x?.tail?.slice(-4) ?? [])].join("\n"));
    }
    return this.state(root, e);
  }

  private load(): { asleep: Asleep[]; trusted: string[] } {
    if (!this.host.file) return { asleep: [], trusted: [] };
    try {
      const v = JSON.parse(readFileSync(this.host.file, "utf8")) as { asleep?: unknown; trusted?: unknown } | unknown[];
      // The first ones kept only the list of servers asleep.
      const asleep = Array.isArray(v) ? v : Array.isArray(v?.asleep) ? v.asleep : [];
      const trusted = !Array.isArray(v) && Array.isArray(v?.trusted) ? v.trusted.filter((k): k is string => typeof k === "string") : [];
      return { asleep: asleep.filter((a): a is Asleep => Boolean(a) && typeof a.root === "string" && typeof a.name === "string" && typeof a.threadId === "string" && typeof a.raw === "string"), trusted: trusted.slice(-TRUSTED) };
    } catch {
      return { asleep: [], trusted: [] };
    }
  }
  private save() {
    if (!this.host.file) return;
    try {
      writeFileSync(this.host.file, JSON.stringify({ asleep: this.asleep, trusted: this.trusted }));
    } catch {
      // A full disk: they don't come back after a quit, and that's all.
    }
  }
}
