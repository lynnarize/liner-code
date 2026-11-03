/*
  The commands the app can send, one handler each. Anything slow (a turn) runs in the
  background and reports through events; handlers answer as soon as the command is accepted.
*/
import { fileURLToPath } from "node:url";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { homedir, hostname, userInfo } from "node:os";
import { castOf, endpointKey, splitModel, VOUCHER } from "../../contracts/src/index.ts";
import type { AddedAgent, CommandInfo, FileChange, Item, FoundRepo, GitCommit, ModelInfo, SkillInfo, ProviderId, ProviderInfo, Mode, RouteLevel, Rpc, RpcMethod, Snapshot, SystemCheck, Thread, ToolLimits, UsageSummary, WayStats } from "../../contracts/src/index.ts";
import { emptyUsage } from "../../contracts/src/index.ts";
import { branchOf, capture, changes, diffFiles, forget, isRepo, keep, literal, local, PATCH, prefixOf, undo } from "./checkpoints.ts";
import { recreateWorktree, removeWorktree, submodules } from "./worktrees.ts";
import { saveToDownloads, sessionMarkdown } from "./export.ts";
import { importable, transcript } from "./imports.ts";
import { outside, run, shellOf, which } from "./exec.ts";
import { editors, openWith } from "./apps.ts";
import { Backgrounds } from "./backgrounds.ts";
import { findFiles, gitStatus, tree } from "./files.ts";
import { ensureSampleProject } from "./providers/demo.ts";
import { endpointModels } from "./providers/endpoint.ts";
import { skillsIn } from "./providers/models.ts";
import type { Routines } from "./routines.ts";
import { providers, syncProviders, titleFrom, type Runtime } from "./runtime.ts";
import { fromRegistry, listRegistry, readRegistry, slugFor, splitCommand } from "./providers/added.ts";
import { picture } from "./prflow.ts";
import { uid, type Store } from "./store.ts";
import { appearance, boot, devices, ghState, htmlPages, listeningPorts, pagePath, stopServers, prCreate, prFor, prList, prMerge, readFile, screenshot, type DeviceLogs, type Terminals } from "./surfaces.ts";
import type { Proxies } from "./proxy.ts";
import type { AgentTools } from "./agent-tools.ts";
import type { Designs } from "./designs.ts";
import { factsOf, forget as forgetFact, remember, searchSessions } from "./memory.ts";
import { checkManifest } from "./addons.ts";
import { refusal, type PanelMethod, type PanelWhere } from "./panels.ts";
import type { Offers } from "./offers.ts";
import type { Sources } from "./sources.ts";
import { Updater } from "./updates.ts";

type Handlers = { [M in RpcMethod]: (p: Rpc[M][0]) => Promise<Rpc[M][1]> | Rpc[M][1] };

/**
  An item copied into a fork or a side chat, under an id of its own and settled: what the session is
  in the middle of (a reply streaming, a step running, a card asking) goes on there, not in the copy,
  which would otherwise show it running or asking for good. A fork of a session at rest keeps a plan
  or question that waits for you (`keepAsks`): answering it there carries the fork on.
*/
export function settledCopy(it: Item, keepAsks = false): Item {
  const copy = { ...it, id: uid("it") } as Item;
  if ((copy.kind === "text" || copy.kind === "reasoning") && copy.streaming) copy.streaming = false;
  if (copy.kind === "tool" && copy.status === "running") copy.status = "failed";
  if (copy.kind === "turn" && copy.status === "running") copy.status = "stopped";
  if (copy.kind === "review" && copy.status === "running") copy.status = "error";
  if ((copy.kind === "approval" || (!keepAsks && (copy.kind === "question" || copy.kind === "proposal"))) && copy.state === "asking") copy.state = "expired";
  return copy;
}

const git = (cwd: string, args: string[]) => run("git", args, { cwd, timeout: 120000 });

/** Git and Python, for real: Apple's stubs in /usr/bin only work once the command line tools are in. */
export async function systemCheck(env: NodeJS.ProcessEnv): Promise<SystemCheck> {
  // Found on PATH, or linked into Liner Code's helpers from another tool's copy.
  const rg = Boolean(which("rg", env));
  const rgInstall = rg ? undefined : which("brew", env) ? "brew install ripgrep" : undefined;
  if (process.platform !== "darwin") return { git: Boolean(which("git", env)), python: Boolean(which("python3", env)), clt: true, rg, rgInstall };
  const clt = (await run("xcode-select", ["-p"], { env, timeout: 10000 })).code === 0;
  const real = (cmd: string) => {
    const path = which(cmd, env);
    return Boolean(path) && (clt || path !== `/usr/bin/${cmd}`);
  };
  const git = real("git");
  const python = real("python3");
  return { git, python, clt, install: git && python ? undefined : "xcode-select --install", rg, rgInstall };
}

/** "git@github.com:halcyon/app.git" or "https://github.com/halcyon/app" → "halcyon/app". */
export const githubName = (url: string) => /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url.trim())?.[1];

async function repoInfo(path: string) {
  const [branch, last, origin] = await Promise.all([branchOf(path), git(path, ["log", "-1", "--format=%ct"]), git(path, ["remote", "get-url", "origin"])]);
  return { branch, lastCommitAt: last.code === 0 && last.stdout.trim() ? Number(last.stdout.trim()) * 1000 : undefined, remote: origin.code === 0 ? githubName(origin.stdout) : undefined };
}

/** Git repositories in the usual places people keep code, three levels down. */
function findRepos(roots: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (dir: string, depth: number) => {
    if (out.length > 200 || depth > 3) return;
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    if (names.includes(".git")) {
      if (!seen.has(dir)) out.push(dir);
      seen.add(dir);
      return;
    }
    for (const n of names) {
      if (n.startsWith(".") || n === "node_modules" || n === "Library") continue;
      const abs = join(dir, n);
      try {
        if (statSync(abs).isDirectory()) walk(abs, depth + 1);
      } catch {
        // unreadable
      }
    }
  };
  for (const r of roots) if (existsSync(r)) walk(r, 0);
  return out;
}

/** What a commit message or a pull request is written from, and how it should read. */
function writePrompt(kind: "commit" | "pr", asks: string[], diff: string, paths: string[], log = "", checks: string[] = []) {
  const cut = diff.length > 40000 ? `${diff.slice(0, 40000)}\n… (the rest of the diff is cut off)` : diff;
  const why = asks.length ? `What was asked in the session:\n${asks.map((a) => `- ${a.slice(0, 500)}`).join("\n")}\n\n` : "";
  if (kind === "commit")
    return `${why}Write the commit message for these changes${paths.length ? ` (${paths.join(", ")})` : ""}. A subject line in the imperative, at most 72 characters, saying what changed and why it matters; then, only if it helps, a blank line and a few short lines on the reasons. No headings, no "This commit". Answer with the message alone, inside <message></message>.\n\n<diff>\n${cut}\n</diff>`;
  return `${why}Write the pull request for this branch.${log ? `\n\nIts commits:\n${log}` : ""}${checks.length ? `\n\nWhat the session ran that passed:\n${checks.map((c) => `- ${c}`).join("\n")}` : ""}\n\nA title of at most 70 characters, plain and specific. A description in Markdown: what changed and why, in a few sentences; then a short list of the notable changes; then how it was checked${checks.length ? " (from what passed above)" : ""}. No filler. Answer as <title>…</title><body>…</body>.\n\n<diff>\n${cut}\n</diff>`;
}

/** A question on the Desk about a session's case, and what the answer can lean on. */
function deskPrompt(title: string, asks: string[], said: string[], files: string[], context: string, question: string, diff = "") {
  const why = asks.length ? `What was asked in the session:\n${asks.map((a) => `- ${a.slice(0, 500)}`).join("\n")}\n\n` : "";
  const last = said.length ? `What the agent said last:\n${said.map((t) => `> ${t.slice(0, 1500).replace(/\n/g, "\n> ")}`).join("\n\n")}\n\n` : "";
  const touched = files.length ? `Files it changed:\n${files.map((f) => `- ${f}`).join("\n")}\n\n` : "";
  const changes = diff.trim() ? `The changes not committed yet:\n<diff>\n${diff.length > 20000 ? `${diff.slice(0, 20000)}\n… (the rest is cut off)` : diff}\n</diff>\n\n` : "";
  return `Someone is deciding on a coding session's work, "${title}", and asks you about it.\n\n${why}${last}${touched}${changes}The case as they see it:\n${context.slice(0, 4000)}\n\nTheir question: ${question}\n\nAnswer in two to four plain sentences; Markdown is fine, no headings. Read the files in this folder if you need to, and change nothing. If you can't tell, say what would settle it.`;
}

/** Commands Liner Code runs itself, on any tool. */
const LINER_COMMANDS: CommandInfo[] = [
  { name: "goal", description: "Keep working, turn after turn, until this is done", hint: "<what done means>", source: "liner" },
  { name: "reviewer", description: "Have the Reviewer, another model family, read the changes now", source: "liner" },
  { name: "pr", description: "Open a pull request from this branch, right here in the chat", source: "liner" },
];

/** A project's CLAUDE.md and AGENTS.md, as they are at its root. */
function rulesOf(root: string) {
  const read = (name: string) => {
    try {
      return readFileSync(join(root, name), "utf8").slice(0, 200_000);
    } catch {
      return undefined;
    }
  };
  const claude = read("CLAUDE.md");
  const agents = read("AGENTS.md");
  return { claude, agents, linked: claude?.trim() === "@AGENTS.md" };
}

const ROOTS = ["Code", "code", "Projects", "projects", "Project", "Developer", "dev", "src", "repos", "GitHub", "Documents/GitHub", "AndroidStudioProjects", "Sites", "work"];

type Extras = { routines: Routines; terms: Terminals; logs: DeviceLogs; proxies: Proxies; tools?: AgentTools; designs?: Designs; outside?: { apply(): void }; offers?: Offers; sources?: Sources };

export function createApi(store: Store, runtime: Runtime, env: NodeJS.ProcessEnv, x: Extras) {
  syncProviders(store.settings, runtime.keys);
  let detected: ProviderInfo[] = [];
  // Model ids you added go after the tool's own, taking the effort levels of its default model.
  const withCustom = (d: ProviderInfo): ProviderInfo => {
    const mine = (store.settings.customModels ?? []).filter((c) => c.provider === d.id && !d.models.some((m) => m.id === c.id));
    if (!mine.length) return d;
    const like = d.models.find((m) => m.isDefault && m.efforts?.length) ?? d.models.find((m) => m.efforts?.length);
    return { ...d, models: [...d.models, ...mine.map((c): ModelInfo => ({ id: c.id, label: c.label?.trim() || c.id, description: "A model id you added", efforts: like?.efforts, defaultEffort: like?.defaultEffort, custom: true }))] };
  };
  const shown = () => detected.map(withCustom);
  const publish = () => {
    runtime.providerInfo = shown();
    // An agent that's gone stands in as the everyday model, never as another of your agents.
    store.standIn = castOf(runtime.providerInfo, { picks: store.settings.picks })?.everyday ?? store.standIn;
    store.emit({ type: "providers", providers: runtime.providerInfo });
  };

  // Each tool's own model list. Asking takes a second or more (it starts the tool), so the last
  // answer is kept on disk and shown at once; the tool is asked again in the background when it
  // was updated, after half a day, or when you press Look again.
  const modelsFile = join(store.home, "models.json");
  type Listed = { version?: string; at: number; models: ModelInfo[] };
  let listed: Record<string, Listed> = {};
  try {
    listed = JSON.parse(readFileSync(modelsFile, "utf8")) as Record<string, Listed>;
  } catch {
    // first run
  }
  const asking = new Set<string>();
  const commandsCache = new Map<string, { at: number; commands: CommandInfo[]; skills: SkillInfo[] }>();
  /** When each project's base branch was last fetched, for the pull request card. */
  const fetched = new Map<string, number>();
  const askModels = async (id: ProviderInfo["id"], force: boolean) => {
    const p = providers[id];
    const info = detected.find((d) => d.id === id);
    const had = listed[id];
    if (!p?.models || !info?.available || !info.adapter || asking.has(id)) return;
    if (!force && had && had.version === info.version && Date.now() - had.at < 12 * 3600_000) return;
    asking.add(id);
    try {
      const models = await p.models(env, join(store.home, "probe"));
      if (!models.length) return;
      listed = { ...listed, [id]: { version: info.version, at: Date.now(), models } };
      writeFileSync(modelsFile, JSON.stringify(listed));
      detected = detected.map((d) => (d.id === id ? { ...d, models, modelsFrom: "cli", modelsAt: listed[id].at } : d));
      publish();
    } catch (e) {
      console.error(`[models] ${id}:`, e instanceof Error ? e.message : e);
    } finally {
      asking.delete(id);
    }
  };
  const detect = async (force = false) => {
    detected = await Promise.all(
      Object.values(providers).map((p) =>
        p.detect(env).catch((e): ProviderInfo => ({ id: p.id, label: p.id, available: false, adapter: false, login: "", detail: String(e), models: [], supports: { approvals: false, resume: false, effort: false, plan: false } })),
      ),
    );
    detected = detected.map((d) => {
      const had = listed[d.id];
      return had && d.modelsFrom !== "cli" && had.version === d.version ? { ...d, models: had.models, modelsFrom: "cli", modelsAt: had.at } : d;
    });
    publish();
    for (const d of detected) void askModels(d.id, force);
    return detected;
  };
  // Each tool's plan windows, asked of the tool: once its tools are found, again after a turn on
  // it (fifteen seconds apart at most: Claude Code's answer starts it), and when you press Look
  // again. A minute's answer is reused otherwise. The app is sent them as they come.
  const limits = new Map<ProviderId, ToolLimits>();
  const askingLimits = new Map<ProviderId, Promise<void>>();
  const limited = () => detected.filter((d) => d.available && d.adapter && providers[d.id]?.limits).map((d) => d.id);
  const askLimits = (id: ProviderId, fresh = false): Promise<void> => {
    const d = detected.find((x) => x.id === id);
    const had = limits.get(id);
    if (!d?.available || !d.adapter || !providers[id]?.limits) {
      if (limits.delete(id)) store.emit({ type: "limits", tools: [...limits.values()] });
      return Promise.resolve();
    }
    if (had && Date.now() - had.at < (fresh ? 15_000 : 60_000)) return Promise.resolve();
    const going = askingLimits.get(id);
    if (going) return going;
    const ask = (async () => {
      try {
        const r = await providers[id].limits!(env, join(store.home, "probe"));
        // A tool with nothing to say this time (Claude Code before it has fetched them) keeps the windows its turns reported.
        const kept = r && !r.windows.length && had?.windows.length && had.plan === r.plan ? { windows: had.windows, detail: undefined } : {};
        if (r) limits.set(id, { provider: id, label: d.label, at: Date.now(), ...r, ...kept });
        else limits.delete(id);
      } catch (e) {
        // A tool that didn't answer this time keeps what it said last; one that never did says why.
        if (had?.windows.length) limits.set(id, { ...had, at: Date.now() - 45_000 });
        else limits.set(id, { provider: id, label: d.label, at: Date.now(), windows: [], detail: e instanceof Error ? e.message : String(e) });
      }
      store.emit({ type: "limits", tools: [...limits.values()] });
    })().finally(() => askingLimits.delete(id));
    askingLimits.set(id, ask);
    return ask;
  };
  store.onUsage = (r) => void askLimits(r.provider, true);
  const ORDER = { session: 0, weekly: 1, monthly: 2 };
  store.onWindow = (id, w) => {
    const had = limits.get(id);
    const windows = [...(had?.windows ?? []).filter((x) => x.label !== w.label), w].sort((a, b) => (ORDER[a.kind!] ?? 3) - (ORDER[b.kind!] ?? 3));
    limits.set(id, { provider: id, label: detected.find((x) => x.id === id)?.label ?? id, ...had, windows, detail: undefined, at: Date.now() });
    store.emit({ type: "limits", tools: [...limits.values()] });
  };
  const ready = detect();
  void ready.then(() => limited().forEach((id) => void askLimits(id)));
  // Sessions that name an agent deleted before this was handled carry on with the model it ran on.
  void ready.then(() => store.repairAgents(new Map(), store.standIn));
  // Liner Code's releases and the tools' own updaters; a tool that was updated is found again.
  const updates = new Updater(store, env, runtime, () => void detect());
  const keyList = () => [...runtime.keys.keys()];
  // A side chat works in its session's own folder, so letting it go never touches the worktree.
  const dropSide = (id: string) => {
    const t = store.thread(id);
    runtime.closeThread(id);
    store.removeThread(id);
    store.emit({ type: "thread", thread: { ...t, archived: true } });
  };

  // A new worktree has none of the checkout's installed packages; the project's setup command
  // runs there before the first turn, and says how it went on the timeline.
  const setups = new Map<string, Promise<void>>();
  /**
    Work in flight in a session: a turn, or its new worktree still being set up (up to 15 minutes),
    which a rewind, an undo, a commit or a branch switch mustn't pull files out from under (T3 Code:
    orchestration-v2/CommandPolicy.ts counts a run that is still "preparing" as active).
  */
  const working = (id: string) => runtime.isRunning(id) || setups.has(id);
  const SETTING_UP = "Its new worktree is still being set up. Wait for that to finish.";
  const asksOf = (threadId: string) => store.timeline(threadId).flatMap((x) => (x.kind === "user" && !x.text.startsWith("/") ? [x.text] : x.kind === "proposal" && x.state === "approved" ? [`(approved plan) ${x.title}`] : [])).slice(-6);
  const worktreeRoot = () => (store.settings.worktreeRoot?.trim() ? store.settings.worktreeRoot.trim().replace(/^~(?=\/|$)/, homedir()) : join(store.home, "worktrees"));
  const setUp = async (threadId: string, cwd: string, command: string) => {
    const note = (text: string) => store.putItem(threadId, { kind: "notice", id: uid("it"), turn: 0, at: Date.now(), text });
    const t0 = Date.now();
    note(`Setting up the worktree: ${command}`);
    try {
      const sh = shellOf(command, env, true);
      const r = await run(sh.cmd, sh.args, { cwd, env, timeout: 15 * 60_000, verbatim: sh.verbatim });
      const secs = Math.round((Date.now() - t0) / 1000);
      note(r.code === 0 ? `Set up in ${secs}s.` : `The setup command failed (${r.code}) after ${secs}s: ${(r.stderr || r.stdout).trim().split("\n").slice(-2).join(" ").slice(0, 300)}. The session carries on without it.`);
    } catch (e) {
      note(`The setup command didn't run: ${e instanceof Error ? e.message : String(e)}. The session carries on without it.`);
    } finally {
      setups.delete(threadId);
    }
  };
  /** What sets up a new worktree: the project's setup command, then its scripts marked to run there. */
  const setupSteps = (projectId: string) => {
    const p = store.project(projectId);
    return [p.setup, ...(p.scripts ?? []).filter((x) => x.onWorktree).map((x) => x.command)].filter((x): x is string => Boolean(x));
  };
  /** A folder by its real path: /var is /private/var on a Mac, and git says the latter. */
  const realOf = (p: string) => {
    try {
      return realpathSync(p);
    } catch {
      return resolve(p);
    }
  };
  /** Liner Code made this worktree, not you: marked since it could say, before that a session's folder under the worktree root. */
  const madeHere = (w: NonNullable<Thread["worktree"]>) => {
    if (w.made !== undefined) return w.made;
    const root = w.root ?? w.path;
    return realOf(dirname(root)) === realOf(worktreeRoot()) && /^th_/.test(basename(root));
  };
  /**
    A session's worktree, put back on its branch when it's gone (a clean-up took it, or it was
    deleted by hand) and the session is opened again or sent a message. Only one Liner Code made;
    one you picked is yours. T3 Code's orchestration-v2/ProviderTurnStartService.ts.
  */
  const restoring = new Map<string, Promise<void>>();
  const ensureWorktree = (threadId: string): Promise<void> => {
    const t = store.thread(threadId);
    const w = t.worktree;
    const root = w ? (w.root ?? w.path) : "";
    if (!w || existsSync(root) || !madeHere(w)) return Promise.resolve();
    const busy = restoring.get(root);
    if (busy) return busy;
    const note = (text: string) => store.putItem(threadId, { kind: "notice", id: uid("it"), turn: t.turns, at: Date.now(), text });
    const back = (async () => {
      await recreateWorktree(store.project(t.projectId).path, root, w.branch);
      note(`This session's worktree was gone, so it's back at ${root}, on ${w.branch}.`);
      const sub = await submodules(root);
      if (sub) note(`Its submodules didn't check out (${sub}), so their folders are empty.`);
      const steps = setupSteps(t.projectId);
      if (steps.length) await setUp(threadId, w.path, steps.join(" && "));
    })().finally(() => restoring.delete(root));
    restoring.set(root, back);
    return back;
  };

  const snapshot = (): Snapshot => ({ version: updates.state.app.current, seq: store.seq, keys: keyList(), home: store.home, projects: store.projects, threads: store.threads, agents: store.agents, providers: shown(), settings: store.settings, groups: store.groups, routines: x.routines.routines, runs: x.routines.recent, updates: updates.state, limits: [...limits.values()], addons: runtime.addons?.list() ?? [], addonsOff: runtime.addons?.off ?? false });

  // Each change to your add-ons reaches the app; the sessions get theirs from the runtime (relink).
  if (runtime.addons) runtime.addons.onChange = (addons) => store.emit({ type: "addons", addons, off: runtime.addons?.off ?? false });
  const addons = () => {
    if (!runtime.addons) throw new Error("Add-ons aren't available here.");
    return runtime.addons;
  };

  /** Mentioned files and attachments, said in words the agent can act on. */
  /**
    Mentioned files and attachments, said in words the agent can act on. Attachments are saved and
    go with the message as files: the runtime names them in what the agent is sent, and images and
    PDFs reach the model as they are where its tool takes them; your message shows them as files.
  */
  const withContext = (t: Thread, text: string, files: { name: string; data: string }[] = []) => {
    const project = store.project(t.projectId);
    const cwd = t.worktree?.path ?? project.path;
    const mentioned = [...text.matchAll(/(?:^|\s)@([\w./-]+)/g)].map((m) => m[1]).filter((p) => existsSync(join(cwd, p)));
    let saved: string[] = [];
    if (files.length) {
      const dir = join(store.home, "attachments", t.id);
      mkdirSync(dir, { recursive: true });
      const stamp = Date.now().toString(36);
      saved = files.map((f, i) => {
        const path = join(dir, `${stamp}${i ? `-${i}` : ""}-${basename(f.name)}`);
        writeFileSync(path, Buffer.from(f.data, "base64"));
        return path;
      });
    }
    return { text: mentioned.length ? `${text}\n\nFiles I pointed at: ${[...new Set(mentioned)].join(", ")}` : text, files: saved.length ? saved : undefined };
  };

  const addProject = async (abs: string, name?: string, agent?: string) => {
    if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new Error("That folder doesn't exist.");
    const have = store.projects.find((p) => p.path === abs);
    if (have) return have;
    const isGit = await isRepo(abs);
    const info = isGit ? await repoInfo(abs) : {};
    return store.putProject({ id: uid("pr"), name: name ?? basename(abs), path: abs, agent, git: isGit, ...info, createdAt: Date.now() });
  };

  /**
    What a session takes on to run in Auto at a level: the cast from your models and what's ready
    (with Dual frontier, the session's own when it says), starting on the everyday model. An Auto
    session keeps its cast and the model working now, unless Dual frontier changes. null lets it
    go, and the model working now carries on alone.
  */
  const routeFields = (level: RouteLevel | null, now?: Thread, dual?: boolean): Partial<Thread> => {
    if (level === null) return now?.route ? { route: undefined, agent: `@${now.route.root}`, model: undefined } : {};
    if (now?.route && (dual === undefined || dual === Boolean(now.dual))) return { route: { ...now.route, level } };
    const on = dual ?? store.settings.dual ?? false;
    const cast = castOf(shown(), { dual: on, picks: store.settings.picks });
    if (!cast) throw new Error("Auto needs a model ready: connect one in Settings, Models.");
    return { route: { level, cast, root: cast.everyday }, agent: `@${cast.everyday}`, model: undefined, lead: undefined, leadSession: undefined, dual: on };
  };

  /** A folder that's a Git repository with one commit of these files, made once. */
  const seedRepo = async (dir: string, files: Record<string, string>, message: string) => {
    if (existsSync(join(dir, ".git"))) return;
    mkdirSync(dir, { recursive: true });
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
    const who = { ...env, GIT_AUTHOR_NAME: "Liner Code", GIT_AUTHOR_EMAIL: "scratch@liner.local", GIT_COMMITTER_NAME: "Liner Code", GIT_COMMITTER_EMAIL: "scratch@liner.local" };
    await run("git", ["init", "-q", "-b", "main"], { cwd: dir, env: who });
    await run("git", ["add", "-A"], { cwd: dir, env: who });
    await run("git", ["commit", "-q", "-m", message], { cwd: dir, env: who });
  };

  const backgrounds = new Backgrounds(store.home);

  /**
    A session going for good, and all it kept: its turn stopped and wound down, its snapshots, its
    worktree when nothing in it would be lost, its log, its design versions and its attachments. A
    fork holds its own copies of those (thread.create), so it loses nothing. Returns why a worktree stayed.
  */
  const dropThread = async (id: string) => {
    const t = store.thread(id);
    leftBehind(id);
    for (const s of store.threads.filter((x) => x.sideOf === id)) dropSide(s.id);
    runtime.closeThread(id);
    // A turn that was running winds down first: its last snapshot and items land before they're forgotten,
    // and its tool is out of the worktree before that goes (T3 Code: ThreadDeletion.ts cancels the run as part of the delete).
    await runtime.idle(id);
    // A worktree still being set up finishes first, so it isn't taken out from under its setup command.
    await setups.get(id)?.catch(() => {});
    const project = store.project(t.projectId);
    await forget(project.path, id).catch(() => {});
    // Its worktree goes too, never forced: it stays while another session works there or it holds
    // changes, and one Liner Code didn't make is yours (T3 Code's storageCleanup.ts).
    let kept: string | null = null;
    const root = t.worktree ? (t.worktree.root ?? t.worktree.path) : "";
    if (t.worktree) {
      const others = store.threads.filter((o) => o.id !== id && o.sideOf !== id && o.worktree && (o.worktree.root ?? o.worktree.path) === root);
      if (others.length) kept = others.length === 1 ? `"${others[0].title}" works there too` : `${others.length} other sessions work there`;
      else if (madeHere(t.worktree)) kept = await removeWorktree(project.path, root).catch((e) => String(e?.message ?? e));
    }
    store.removeThread(id);
    // A fork made before forks kept copies of their own still reads its attachments from here: those stay.
    const sent = join(store.home, "attachments", id);
    const lent = store.threads.some((o) => o.forkOf && !o.sideOf && store.peek(o.id, ["user"]).some((x) => x.kind === "user" && x.files?.some((f) => f.startsWith(`${sent}${sep}`))));
    for (const dir of lent ? ["designs"] : ["designs", "attachments"]) rmSync(join(store.home, dir, id), { recursive: true, force: true });
    store.emit({ type: "thread", thread: { ...t, archived: true } });
    if (kept) store.emit({ type: "notify", threadId: id, kind: "done", title: "Kept its worktree", body: `${root} stays: ${kept}. Its branch ${t.worktree!.branch} stays too.` });
    return kept;
  };

  const handlers: Handlers = {
    "state.get": async () => {
      await ready;
      return snapshot();
    },
    "providers.refresh": async () => (await detect(true), shown()),
    "acp.registry": async ({ force }) => {
      const r = await readRegistry(store.home, Boolean(force));
      return { agents: listRegistry(r.entries, store.settings.addedAgents ?? [], env), at: r.at, error: r.error };
    },
    "acp.add": async (p) => {
      const have = store.settings.addedAgents ?? [];
      const taken = [...have.map((a) => a.id), ...Object.keys(providers)];
      let agent: AddedAgent;
      if ("registryId" in p) {
        const entry = (await readRegistry(store.home, false)).entries.find((e) => e.id === p.registryId);
        if (!entry) throw new Error("That agent isn't in the registry any more.");
        agent = await fromRegistry(entry, store.home, taken, env);
      } else {
        const command = splitCommand(p.command);
        if (!command.length) throw new Error("Type the command that starts the agent in ACP mode.");
        if (!which(command[0], env)) throw new Error(`${command[0]} isn't on your PATH.`);
        agent = { id: slugFor(p.label || command[0].split("/").pop() || "agent", taken), label: p.label.trim() || (command[0].split("/").pop() ?? "Agent"), command, from: "local" };
      }
      store.setSettings({ addedAgents: [...have.filter((a) => !(agent.registryId && a.registryId === agent.registryId)), agent] });
      syncProviders(store.settings, runtime.keys);
      await detect(true);
      return agent;
    },
    "acp.remove": async ({ id }) => {
      const settings = store.setSettings({ addedAgents: (store.settings.addedAgents ?? []).filter((a) => a.id !== id), customModels: (store.settings.customModels ?? []).filter((c) => c.provider !== `acp.${id}`) });
      syncProviders(settings, runtime.keys);
      await detect();
      return settings;
    },
    "agent.commands": async ({ projectId, agent, threadId }) => {
      const cwd = threadId ? cwdOf(threadId) : store.project(projectId).path;
      const ref = agent.startsWith("@") ? agent.slice(1) : store.agent(agent).model;
      const { provider } = splitModel(ref);
      const key = `${provider}|${cwd}`;
      const had = commandsCache.get(key);
      const own = { commands: LINER_COMMANDS, skills: [] as SkillInfo[] };
      if (had && Date.now() - had.at < 5 * 60_000) return { commands: [...LINER_COMMANDS, ...had.commands], skills: had.skills };
      const p = providers[provider];
      if (!p?.commands) return own;
      try {
        const r = await p.commands(runtime.envFor(provider), cwd);
        commandsCache.set(key, { at: Date.now(), ...r });
        // Liner Code's own come first; a tool command with the same name stays the tool's.
        return { commands: [...LINER_COMMANDS.filter((c) => !r.commands.some((x) => x.name === c.name)), ...r.commands], skills: r.skills };
      } catch {
        return own;
      }
    },
    "usage.limits": async ({ fresh }) => {
      await Promise.all(limited().map((id) => askLimits(id, fresh)));
      return { tools: [...limits.values()] };
    },
    "machine.info": () => {
      const u = userInfo();
      return { name: env.LINER_MACHINE || hostname().replace(/\.local$/, ""), user: env.LINER_USER_NAME || u.username, home: homedir() };
    },

    "project.add": async ({ path, agent }) => {
      if (path === "@sample") return addProject(await ensureSampleProject(store.home), "Sample project", "demo");
      return addProject(resolve(path.replace(/^~(?=\/|$)/, homedir())), undefined, agent);
    },
    // An empty agent clears it: new sessions there start with whoever Home would pick.
    "sessions.importable": ({ projectId }) => importable(store.project(projectId).path, env, new Set(store.threads.flatMap((t) => (t.providerSession ? [t.providerSession] : [])))),
    "sessions.import": async ({ projectId, tool, id }) => {
      const project = store.project(projectId);
      const taken = store.threads.find((t) => t.providerSession === `${tool}:${id}`);
      if (taken) return taken;
      const s = transcript(tool, id, project.path, env);
      // A session of its own on that model, in the project folder where the tool kept it.
      const t = await handlers["thread.create"]({ projectId, agent: `@${tool}:${s.model || "default"}`, title: s.title || "A session brought in" });
      const label = tool === "claude" ? "Claude Code" : "Codex";
      store.putItem(t.id, { kind: "notice", id: uid("it"), turn: 0, at: s.started || Date.now(), text: `Brought in from ${label}: ${s.turns} ${s.turns === 1 ? "turn" : "turns"}. The next turn carries on ${label}'s own session.` });
      for (const it of s.items) store.putItem(t.id, it);
      return store.patchThread(t.id, { providerSession: `${tool}:${id}`, turns: s.turns, status: "done" });
    },
    "project.rules": ({ id }) => rulesOf(store.project(id).path),
    "project.rules.save": ({ id, text }) => {
      const root = store.project(id).path;
      writeFileSync(join(root, "AGENTS.md"), `${text.trim()}\n`);
      // Claude Code reads CLAUDE.md, and follows an @ import in it: one line keeps the two in step.
      writeFileSync(join(root, "CLAUDE.md"), "@AGENTS.md\n");
      return rulesOf(root);
    },
    "project.update": ({ id, name, agent, setup, scripts }) =>
      store.putProject({
        ...store.project(id),
        ...(name ? { name } : {}),
        ...(agent !== undefined ? { agent: agent || undefined } : {}),
        ...(setup !== undefined ? { setup: setup.trim() || undefined } : {}),
        ...(scripts !== undefined ? { scripts: scripts.filter((x) => x.name.trim() && x.command.trim()).map((x) => ({ ...x, name: x.name.trim(), command: x.command.trim() })) } : {}),
      }),
    "git.branches": async ({ projectId }) => {
      const project = store.project(projectId);
      const cwd = project.path;
      const [cur, list, trees, base] = await Promise.all([
        branchOf(cwd),
        git(cwd, ["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)%09%(committerdate:unix)", "refs/heads"]),
        git(cwd, ["worktree", "list", "--porcelain"]),
        mainBranch(cwd),
      ]);
      const branches = list.stdout.split("\n").filter(Boolean).slice(0, 60).map((l) => {
        const [name, at] = l.split("\t");
        return { name, lastCommitAt: at ? Number(at) * 1000 : undefined };
      });
      // Worktrees other than the checkout itself, with the session that made each, if any.
      const worktrees: { path: string; branch?: string; threadId?: string }[] = [];
      let cur2: { path?: string; branch?: string } = {};
      for (const line of [...trees.stdout.split("\n"), ""]) {
        if (line.startsWith("worktree ")) cur2 = { path: line.slice(9) };
        else if (line.startsWith("branch ")) cur2.branch = line.slice(7).replace(/^refs\/heads\//, "");
        else if (!line && cur2.path) {
          if (realpathSync(cur2.path) !== realpathSync(cwd) && existsSync(cur2.path)) worktrees.push({ path: cur2.path, branch: cur2.branch, threadId: store.threads.find((t) => t.worktree && (t.worktree.root ?? t.worktree.path) === cur2.path && !t.archived)?.id });
          cur2 = {};
        }
      }
      let npmScripts: string[] = [];
      try {
        npmScripts = Object.keys((JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as { scripts?: Record<string, string> }).scripts ?? {});
      } catch {
        // no package.json
      }
      return { current: cur, base, branches, worktrees, npmScripts };
    },
    "worktrees.clean": async ({ projectId }) => {
      // A worktree whose sessions are all archived or deleted is only taking room, unless something
      // in it would be lost: one with changes, or one Liner Code didn't make, stays (T3 Code's storageCleanup.ts).
      let removed = 0;
      let kept = 0;
      const reasons: { path: string; reason: string }[] = [];
      const base = `${realOf(worktreeRoot())}${sep}`;
      for (const p of store.projects.filter((x) => x.git && (!projectId || x.id === projectId))) {
        const r = await git(p.path, ["worktree", "list", "--porcelain"]);
        const paths = r.stdout.split("\n").filter((l) => l.startsWith("worktree ")).map((l) => l.slice(9));
        for (const path of paths) {
          if (!realOf(path).startsWith(base)) continue;
          const users = store.threads.filter((t) => t.worktree && realOf(t.worktree.root ?? t.worktree.path) === realOf(path));
          if (users.some((t) => !t.archived || working(t.id))) {
            kept++;
            continue;
          }
          const ours = users.length ? users.every((t) => madeHere(t.worktree!)) : /^th_/.test(basename(path));
          const why = ours ? await removeWorktree(p.path, path) : "Liner Code didn't make it";
          if (!why) removed++;
          else {
            kept++;
            reasons.push({ path, reason: why });
          }
        }
        await git(p.path, ["worktree", "prune"]);
      }
      return { removed, kept, reasons };
    },
    "project.remove": async ({ id }) => {
      // Each of its sessions goes as one deleted by itself would (its side chats with it), so its logs,
      // snapshots, designs and the worktrees Liner made don't stay behind. Its folder, and what you keep
      // about it in memory, are yours and stay.
      const sessions = store.threads.filter((x) => x.projectId === id && !x.sideOf);
      for (const t of sessions) x.terms.closeThread?.(t.id);
      for (const t of sessions) await dropThread(t.id).catch((e) => console.error("[project.remove]", e));
      for (const t of store.threads.filter((x) => x.projectId === id)) await dropThread(t.id).catch(() => {});
      store.removeProject(id);
      return null;
    },
    "projects.scan": async ({ roots }) => {
      const home = homedir();
      const paths = findRepos((roots?.length ? roots : ROOTS.map((r) => join(home, r))).map((r) => r.replace(/^~(?=\/|$)/, home)));
      const found: FoundRepo[] = await Promise.all(paths.map(async (p) => ({ path: p, name: basename(p), ...(await repoInfo(p)), added: store.projects.some((x) => x.path === p) })));
      return found.sort((a, b) => (b.lastCommitAt ?? 0) - (a.lastCommitAt ?? 0));
    },
    "github.repos": async () => {
      if (!which("gh", env)) return { gh: "missing", detail: "The GitHub CLI isn't installed.", repos: [] };
      const auth = await run("gh", ["auth", "status"], { env, timeout: 15000 });
      if (auth.code !== 0) return { gh: "signed-out", detail: "The GitHub CLI isn't signed in.", repos: [] };
      const [me, list] = await Promise.all([
        run("gh", ["api", "user", "--jq", ".login"], { env, timeout: 20000 }),
        run("gh", ["api", "user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member"], { env, timeout: 30000 }),
      ]);
      if (list.code !== 0) throw new Error(list.stderr.trim().split("\n").pop() || "GitHub didn't answer.");
      // Projects already here, by their GitHub remote, so a repo you have says so instead of cloning again.
      const here = new Map<string, string>();
      await Promise.all(
        store.projects.map(async (p) => {
          const name = p.remote ?? (p.git ? (await repoInfo(p.path)).remote : undefined);
          if (name) here.set(name.toLowerCase(), p.id);
          if (name && !p.remote) store.putProject({ ...p, remote: name });
        }),
      );
      const repos = (JSON.parse(list.stdout) as { full_name: string; description?: string | null; private: boolean; html_url: string; pushed_at?: string }[]).map((r) => ({
        fullName: r.full_name,
        description: r.description ?? undefined,
        private: r.private,
        url: r.html_url,
        pushedAt: r.pushed_at ? Date.parse(r.pushed_at) : undefined,
        projectId: here.get(r.full_name.toLowerCase()),
      }));
      return { gh: "ready", login: me.stdout.trim() || undefined, repos };
    },
    "project.clone": async ({ url, into }) => {
      const spec = url.trim();
      const remote = /^[\w.-]+\/[\w.-]+$/.test(spec) ? `https://github.com/${spec}.git` : spec;
      if (!/^(https:\/\/|git@|ssh:\/\/)/.test(remote)) throw new Error("Give a GitHub owner/repo, or an https or ssh URL.");
      const root = into ?? store.settings.projectsRoot ?? join(homedir(), "Code");
      mkdirSync(root, { recursive: true });
      const name = basename(remote).replace(/\.git$/, "");
      const dest = join(root, name);
      if (existsSync(dest)) throw new Error(`${dest} already exists.`);
      const r = await run("git", ["clone", remote, dest], { timeout: 600000, env });
      if (r.code !== 0) throw new Error(r.stderr.trim().split("\n").pop() || "The clone failed.");
      return addProject(dest);
    },

    "thread.create": async ({ projectId, agent, lead, route, dual, after, title, forkOf, id, access, effort, model, worktree, base, inWorktree, mode }) => {
      const project = store.project(projectId);
      // A mode is set once, as the session starts; a custom one is one of your named agents.
      if (mode !== undefined && mode !== "standard" && mode !== "creator" && !(mode.startsWith("agent:") && store.agents.some((a) => `agent:${a.id}` === mode))) throw new Error("There's no mode by that name.");
      const parent = forkOf ? store.thread(forkOf) : undefined;
      const who = agent ?? parent?.agent ?? project.agent ?? defaultAgent();
      const now = Date.now();
      // An id the app picked (a side chat or a comparison it names ahead) names files too: one of its own, never another's.
      if (id !== undefined && (!/^[\w-]{1,64}$/.test(id) || store.threads.some((t) => t.id === id))) throw new Error("That session id can't be used.");
      const tid = id ?? uid("th");
      // Auto decides who works on it; a fork keeps its parent's route. Asked first: a session Auto can't
      // cast (no model ready) goes no further, so no worktree or branch is left behind for it.
      const routed = route ? routeFields(route, undefined, dual) : parent?.route ? { route: parent.route } : {};
      let tree: Thread["worktree"];
      let notice: string | undefined;
      if (inWorktree && project.git) {
        // Carry on in a worktree that's already there, on its branch.
        const top = (await git(inWorktree, ["rev-parse", "--show-toplevel"])).stdout.trim();
        if (!top) throw new Error("That worktree isn't there any more.");
        const branch = (await branchOf(top)) ?? "HEAD";
        const sub = relative((await git(project.path, ["rev-parse", "--show-toplevel"])).stdout.trim(), realpathSync(project.path));
        tree = sub ? { path: join(top, sub), branch, root: top, made: false } : { path: top, branch, made: false };
      } else if (worktree && project.git) {
        // A worktree of its own, so parallel sessions never edit the same files. A repository
        // with no commits has nothing to check out, so the session stays in the folder instead.
        const [head, top] = await Promise.all([git(project.path, ["rev-parse", "--verify", "-q", "HEAD"]), git(project.path, ["rev-parse", "--show-toplevel"])]);
        if (head.code !== 0 || top.code !== 0) {
          notice = "This project's repository has no commits yet, so a new worktree would be empty. This session works in the project folder instead.";
        } else {
          const branch = `${store.settings.branchPrefix.trim() || "liner/"}${tid.slice(3, 11)}`;
          const root = join(worktreeRoot(), tid);
          const r = await git(project.path, ["worktree", "add", "-b", branch, root, ...(base ? [base] : [])]);
          if (r.code !== 0) throw new Error(r.stderr.trim() || "Couldn't make a worktree.");
          // A project inside a bigger repository works in the same folder of the worktree.
          const sub = relative(top.stdout.trim(), realpathSync(project.path));
          tree = sub ? { path: join(root, sub), branch, root, made: true } : { path: root, branch, made: true };
          // Setting up a new worktree: its submodules, which git leaves empty, then the project's setup
          // command and its scripts marked to run there.
          const steps = setupSteps(projectId);
          const mods = existsSync(join(root, ".gitmodules"));
          const at = tree.path;
          const prep = async () => {
            const why = mods ? await submodules(root) : null;
            if (why) store.putItem(tid, { kind: "notice", id: uid("it"), turn: 0, at: Date.now(), text: `The worktree's submodules didn't check out (${why}), so their folders are empty.` });
            if (steps.length) await setUp(tid, at, steps.join(" && "));
          };
          if (steps.length || mods) setups.set(tid, prep().finally(() => setups.delete(tid)));
        }
      }
      // A model, or an agent you have; one that's gone (a project's, an outside agent's guess) is the everyday model.
      const known = (id?: string) => Boolean(id && (id.startsWith("@") || store.agents.some((a) => a.id === id)));
      const writer = known(who) ? who : defaultAgent();
      // A planner that is also the builder would share its session: that's Solo. The Demo plays both.
      const planner = lead ?? parent?.lead;
      // A fork of a session at work branches from its last turn that ended, not from one half done
      // (T3 Code: ThreadForkService.ts forks from the last stable run), and gets the conversation as text.
      // Half done is its last turn still running, by that turn's own status: one the Reviewer reads now has ended.
      const live = parent ? runtime.isRunning(parent.id) && store.timeline(parent.id).some((x) => x.kind === "turn" && x.turn === parent.turns && x.status === "running") : false;
      const t: Thread = {
        id: tid,
        projectId,
        title: title ?? parent?.title ?? "New session",
        agent: writer,
        lead: known(planner) && (planner !== writer || writer === "demo") ? planner : undefined,
        dual: dual ?? parent?.dual,
        after: after ?? parent?.after,
        checks: parent?.checks,
        status: "idle",
        access: access ?? parent?.access ?? store.settings.defaultAccess,
        model: model ?? parent?.model,
        effort: effort ?? parent?.effort,
        forkOf,
        forkSession: parent ? (live ? "" : (parent.providerSession ?? "")) : undefined,
        worktree: tree ?? parent?.worktree,
        // A fork keeps its parent's mode, as it keeps its conversation.
        ...((mode && mode !== "standard") || parent?.mode ? { mode: mode && mode !== "standard" ? mode : parent?.mode } : {}),
        turns: parent ? parent.turns - (live ? 1 : 0) : 0,
        usage: emptyUsage(),
        createdAt: now,
        updatedAt: now,
        ...routed,
      };
      store.putThread(t);
      if (notice) store.putItem(t.id, { kind: "notice", id: uid("it"), turn: 0, at: now, text: notice });
      // A fork starts with its parent's timeline, so you can see where it branched.
      if (parent) {
        // Your attachments come along under the fork's own folder, so they outlive the session they were sent in.
        const sent = join(store.home, "attachments", parent.id);
        const mine = join(store.home, "attachments", t.id);
        const had = existsSync(sent);
        if (had) cpSync(sent, mine, { recursive: true });
        const moved = (f: string) => (had && f.startsWith(`${sent}${sep}`) ? join(mine, f.slice(sent.length + 1)) : f);
        for (const it of store.timeline(parent.id)) {
          if (live && it.turn >= parent.turns) continue;
          const copy = settledCopy(it, !live);
          store.putItem(t.id, copy.kind === "user" && copy.files ? { ...copy, files: copy.files.map(moved) } : copy);
        }
        // Its own hold on what it copied: deleting the session it came from leaves its diffs, undo and design versions whole.
        const commits = store.timeline(t.id).flatMap((x) => (x.kind === "checkpoint" ? [x.from, x.to, x.redo].filter((c): c is string => Boolean(c)) : []));
        if (commits.length) await keep(t.worktree?.path ?? project.path, t.id, commits).catch(() => {});
        const versions = join(store.home, "designs", parent.id);
        if (existsSync(versions)) cpSync(versions, join(store.home, "designs", t.id), { recursive: true });
      }
      return t;
    },
    "thread.update": ({ id, route, dual, ...patch }) => {
      // null clears a field; undefined leaves it.
      const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined).map(([k, v]) => [k, v === null ? undefined : v]));
      const t = store.thread(id);
      if (patch.archived && !t.archived) leftBehind(id);
      // Opened again: a worktree a clean-up took is put back.
      if (patch.archived === false && t.archived) void ensureWorktree(id).catch((e) => store.emit({ type: "notify", threadId: id, kind: "error", title: "Its worktree didn't come back", body: String(e?.message ?? e) }));
      // Auto brings who works on it; letting it go comes before whoever you picked instead.
      if (route) return store.patchThread(id, { ...clean, ...routeFields(route, t, dual) });
      // Picking someone else to work on it, or a planner, ends Auto.
      const unroute = route === null || (t.route && ((clean.agent && clean.agent !== t.agent) || clean.lead));
      const off = unroute ? routeFields(null, t) : {};
      const next = { ...off, ...clean, ...(dual !== undefined ? { dual } : {}) };
      // A planner that is also the builder would share its session: that's Solo.
      const writer = next.agent ?? t.agent;
      if ("lead" in next && next.lead === writer && writer !== "demo") next.lead = undefined;
      // Another model: the last one's context window says nothing about this one's, until its first turn reports.
      const moved = (clean.model !== undefined && clean.model !== t.model) || (clean.agent !== undefined && clean.agent !== t.agent);
      return store.patchThread(id, moved ? { ...next, usage: { ...t.usage, contextWindow: undefined } } : next);
    },
    "thread.items": ({ id }) => store.timeline(store.thread(id).id),
    "thread.load": ({ id }) => ({ items: store.timeline(store.thread(id).id), seq: store.seq }),
    "thread.export": async ({ id }) => {
      const cwd = cwdOf(id);
      const md = await sessionMarkdown(store, id, async (from, to) => (await git(cwd, ["diff", "--relative", ...PATCH, "-M", from, to])).stdout);
      return { path: saveToDownloads(store.thread(id).title, md) };
    },
    "thread.info": async ({ id }) => {
      const t = store.thread(id);
      const project = store.project(t.projectId);
      const path = cwdOf(id);
      const [s, branch] = await Promise.all([runtime.inspect(id), project.git ? branchOf(path) : undefined]);
      // Before the tool can say (no open session yet), the last turn's total is what there is.
      const u = t.usage;
      const last = u?.contextTokens && u.contextWindow ? { used: u.contextTokens, max: u.contextWindow, parts: [], measured: false } : undefined;
      return {
        machine: env.LINER_MACHINE || hostname().replace(/\.local$/, ""),
        project: project.name,
        path,
        worktree: Boolean(t.worktree),
        branch,
        tool: detected.find((p) => p.id === s.provider)?.label ?? s.provider,
        provider: s.provider,
        model: s.model,
        access: s.access,
        live: s.live,
        context: s.context ? { ...s.context, measured: true } : last,
        compact: s.provider === "claude" || s.provider === "codex",
      };
    },
    "outside.info": () => {
      // How its MCP server starts: on the app's own Node when this is the app, else on this Node.
      const script = fileURLToPath(new URL("./outside.ts", import.meta.url));
      const electron = Boolean(process.versions.electron);
      const home = store.home === join(homedir(), ".liner-code") ? [] : [`LINER_HOME=${store.home}`];
      const vars = [...(electron ? ["ELECTRON_RUN_AS_NODE=1"] : []), ...home];
      // Quoted for the shell you'd paste it in: on Windows, double quotes, which cmd.exe and PowerShell both take.
      const q = (v: string) => (process.platform === "win32" ? (/^[\w.\\/:=-]+$/.test(v) ? v : `"${v}"`) : /^[\w./:=-]+$/.test(v) ? v : `'${v.replace(/'/g, "'\\''")}'`);
      const argv = [process.execPath, script].map(q).join(" ");
      return {
        on: store.settings.outside === true,
        claude: `claude mcp add liner-code${vars.map((v) => ` -e ${q(v)}`).join("")} -- ${argv}`,
        codex: `codex mcp add liner-code${vars.map((v) => ` --env ${q(v)}`).join("")} -- ${argv}`,
      };
    },
    "memory.list": ({ projectId }) => factsOf(store.home, store.project(projectId).id),
    "memory.add": ({ projectId, fact }) => remember(store.home, store.project(projectId).id, fact).facts,
    "memory.forget": ({ projectId, index }) => forgetFact(store.home, store.project(projectId).id, index),
    "sessions.search": ({ projectId, query }) => searchSessions(store, store.project(projectId).id, query),
    "thread.carryOn": async ({ id, model }) => (await ensureWorktree(id), await runtime.carryOn(id, model), null),
    "thread.send": ({ id, text, files, mode, anchor }) => {
      const t = store.thread(id);
      // Liner Code's own commands, whichever tool the session runs on.
      const goal = /^\/goal(?:\s+([\s\S]*))?$/.exec(text.trim());
      const stopGoal = goal && (!(goal[1] ?? "").trim() || /^(stop|clear|off)$/i.test((goal[1] ?? "").trim()));
      if (goal && (stopGoal || !runtime.isRunning(id))) {
        const what = (goal[1] ?? "").trim();
        if (stopGoal) {
          store.patchThread(id, { goal: t.goal ? { ...t.goal, status: "stopped" } : undefined });
          store.putItem(id, { kind: "notice", id: uid("it"), turn: t.turns, at: Date.now(), text: t.goal ? "You stopped the goal." : "There's no goal to stop. Give one: /goal all tests in packages/api pass" });
          return null;
        }
        void runtime.startGoal(id, what).catch((e) => store.emit({ type: "notify", threadId: id, kind: "error", title: "The goal didn't start", body: String(e?.message ?? e) }));
        return null;
      }
      if (/^\/reviewer\s*$/.test(text.trim()) && !runtime.isRunning(id)) {
        void runtime.review(id, t.turns, 1);
        return null;
      }
      // The turn runs on; its progress comes back as events. A new worktree finishes setting up
      // first, and one that's gone is put back.
      void (setups.get(id) ?? Promise.resolve())
        .then(() => ensureWorktree(id))
        .then(() => {
          const c = withContext(t, text, files);
          return runtime.send(id, c.text, mode, anchor, c.files);
        })
        .catch((e) => store.emit({ type: "notify", threadId: id, kind: "error", title: "That didn't start", body: String(e?.message ?? e) }));
      return null;
    },
    "thread.queue": ({ id, queue }) => runtime.setQueue(id, queue),
    "thread.rewind": async ({ threadId, itemId, files, force }) => {
      // Edit from here: the conversation goes back to just before this message.
      const it = store.item(threadId, itemId);
      if (it.kind !== "user") throw new Error("Only a message you sent can be edited.");
      if (working(threadId)) throw new Error(setups.has(threadId) ? SETTING_UP : "Stop the session before going back.");
      const from = it.turn;
      const later = store.timeline(threadId).flatMap((x) => (x.kind === "checkpoint" && x.turn >= from && !x.reverted ? [x] : []));
      let undone = 0;
      if (files && later.length) {
        const committed = later.find((x) => x.committed);
        if (committed) throw new Error(`Turn ${committed.turn}'s changes are committed (${committed.committed}). Revert the commit first, or keep the changes.`);
        const other = busyBeside(threadId);
        if (other) throw new Error(`"${other.title}" is working in this folder now. Wait for it to finish before putting files back.`);
        // Newest first, so each file ends as it was before the first of these turns. The files as they
        // are now are kept in a snapshot first, and one changed after its turn stops it unless forced.
        const turns = [...later].reverse().flatMap((cp) => (cp.from ? [{ from: cp.from, to: cp.to, files: cp.files }] : []));
        await undo(cwdOf(threadId), `${threadId}/undo-${Date.now().toString(36)}`, turns, force);
        undone = new Set(later.flatMap((x) => x.files.map((f) => f.path))).size;
      }
      runtime.closeThread(threadId);
      store.truncate(threadId, from);
      // The tools' own sessions remember the turns that came off, so the next turn starts fresh
      // and gets the conversation that's left as text.
      // Taken back to before a turn, the conversation starts again: how full the old one was no longer holds.
      store.patchThread(threadId, { usage: { ...store.thread(threadId).usage, contextTokens: undefined, contextWindow: undefined }, turns: from - 1, status: "idle", providerSession: undefined, leadSession: undefined, sessions: undefined, forkSession: undefined, queue: [], verdict: undefined, toReview: runtime.toReview(threadId), unread: false, done: false });
      return { turn: from, files: undone };
    },
    "thread.stop": ({ id }) => {
      runtime.stop(id);
      return null;
    },
    /*
      A side chat: a fork of the session that only reads and answers. Who you talk to there is who
      you talk to in the session (the lead, if it has one), continuing that conversation where the
      tool can branch it (Claude Code) and given it as text otherwise. A plan, a route or a setup
      doesn't come along: it's one agent answering.
    */
    "thread.side": ({ id, fresh }) => {
      const parent = store.thread(id);
      const old = store.threads.find((t) => t.sideOf === id);
      if (old && !fresh) return old;
      if (old) dropSide(old.id);
      const now = Date.now();
      // Made whole in one go, so nothing ever sees it as a session of its own.
      const t = store.putThread({
        id: uid("th"),
        projectId: parent.projectId,
        title: `Side chat · ${parent.title}`,
        agent: parent.lead ?? parent.agent,
        status: "idle",
        access: "read",
        model: parent.lead ? undefined : parent.model,
        effort: parent.effort,
        forkOf: id,
        forkSession: (parent.lead ? parent.leadSession : parent.providerSession) ?? "",
        sideOf: id,
        sideFrom: parent.turns,
        worktree: parent.worktree,
        turns: parent.turns,
        usage: emptyUsage(),
        createdAt: now,
        updatedAt: now,
      });
      // The session's timeline comes along (out of sight), so a tool that can't branch it gets it as text.
      for (const it of store.timeline(id)) store.putItem(t.id, settledCopy(it));
      return t;
    },
    "thread.remove": async ({ id }) => {
      const kept = await dropThread(id);
      return kept ? { kept } : null;
    },

    "approval.answer": ({ threadId, itemId, allow, reason, always, scope }) => {
      runtime.answer(threadId, itemId, allow, reason, always, scope);
      return null;
    },
    "addons.update": ({ id, enabled, version, removed, project }) => {
      if (project) store.project(project);
      const list = addons().update(id, { enabled, version, removed, project });
      void runtime.relink();
      return list;
    },
    "addons.add": ({ manifest, project }) => {
      let raw: unknown;
      try {
        raw = JSON.parse(manifest);
      } catch (e) {
        throw new Error(`That isn't JSON: ${e instanceof Error ? e.message : String(e)}`);
      }
      const m = checkManifest(raw);
      if (m.kind === "panel") throw new Error("A panel comes with its files: ask an agent for one, and it shows you a card.");
      if (project) store.project(project);
      addons().install(m, { project, by: { agent: "You", at: Date.now() } });
      void runtime.relink();
      return addons().list();
    },
    "addons.read": ({ id, version }) => {
      const m = addons().manifest(id, version);
      if (!m) throw new Error("There's no such add-on, or no such version of it.");
      return { manifest: JSON.stringify(m, null, 2), dir: join(addons().dir, id) };
    },
    "addons.files": (p) => {
      // A panel whose card is up: the draft exactly as it was asked about.
      if ("itemId" in p) {
        const d = x.tools?.pending.get(p.itemId);
        if (!d || d.threadId !== p.threadId) throw new Error("That panel isn't waiting on a card any more.");
        return { id: d.manifest.id, name: d.manifest.name, place: d.manifest.place, entry: d.manifest.entry, access: d.manifest.access, files: d.files };
      }
      const a = addons();
      const m = a.manifest(p.id, p.version);
      const files = a.files(p.id, p.version);
      if (!m || m.kind !== "panel" || !files) throw new Error("There's no such panel, or no such version of it.");
      return { id: m.id, name: m.name, place: m.place, entry: m.entry, access: m.access, files, version: p.version ?? a.get(p.id)?.version };
    },
    "panel.call": async ({ addon, threadId, preview, method, args, apiVersion }) => {
      // Whatever the frame says, its access is read here: the panel in use, or the draft on its card.
      let where: PanelWhere;
      let storage: { all(): Record<string, unknown>; put(k: string, v: unknown): void };
      let quota = 0;
      if (preview) {
        const d = x.tools?.pending.get(preview);
        if (!d || d.threadId !== threadId || d.manifest.id !== addon) throw new Error("That preview is over.");
        where = { access: d.manifest.access, place: d.manifest.place, threadId: d.manifest.place === "page" ? undefined : threadId };
        // A preview plays with storage that's gone when its card is.
        storage = { all: () => d.storage, put: (k, v) => (v === undefined ? delete d.storage[k] : (d.storage[k] = v)) };
        quota = d.manifest.access.storage ?? 0;
      } else {
        const project = threadId ? store.thread(threadId).projectId : undefined;
        const m = addons().panel(addon, project);
        if (!m) throw new Error("That panel is off, removed, or not for this project.");
        where = { access: m.access, place: m.place, threadId: m.place === "page" ? undefined : threadId };
        const a = addons();
        storage = { all: () => a.storage(addon), put: (k, v) => a.store(addon, k, v, m.access.storage ?? 0) };
        quota = m.access.storage ?? 0;
      }
      const no = refusal(where, method, apiVersion);
      if (no) throw new Error(no);
      if (!x.tools) throw new Error("Panels aren't available here.");
      return x.tools.panelCall(where, method as PanelMethod, (args ?? {}) as Record<string, unknown>, storage, quota);
    },
    "addons.source": async ({ source }) => {
      if (!x.sources) throw new Error("Adding from GitHub or a folder isn't available here.");
      return x.sources.open(source);
    },
    "addons.adopt": async ({ token }) => {
      if (!x.sources) throw new Error("Adding from GitHub or a folder isn't available here.");
      x.sources.adopt(token);
      void runtime.relink();
      return addons().list();
    },
    "addons.drop": ({ token }) => (x.sources?.drop(token), null),
    "addons.list": () => {
      const list = addons().list();
      store.emit({ type: "addons", addons: list, off: addons().off });
      return list;
    },
    "offer.answer": async ({ threadId, itemId, act, place, custom }) => {
      if (!x.offers) throw new Error("Offers aren't available here.");
      await x.offers.answer(threadId, itemId, act, place, custom);
      return null;
    },
    "addons.off": ({ next }) => {
      addons().turnOff(Boolean(next));
      void runtime.relink();
      return null;
    },
    "question.answer": ({ threadId, itemId, answers }) => {
      runtime.answerQuestion(threadId, itemId, answers);
      return null;
    },
    "proposal.answer": ({ threadId, itemId, approve, note, plan }) => {
      runtime.answerProposal(threadId, itemId, approve, note, plan);
      return null;
    },
    "review.run": ({ threadId }) => {
      const t = store.thread(threadId);
      if (working(threadId)) throw new Error(setups.has(threadId) ? SETTING_UP : "Wait for the turn to finish.");
      void runtime.review(threadId, t.turns, 1);
      return null;
    },

    "checkpoint.diff": async ({ threadId, itemId }) => {
      // "all": every turn in the session, from before the first one to the tree as it is now.
      if (itemId === "all") {
        const first = store.timeline(threadId).find((x) => x.kind === "checkpoint");
        if (first?.kind !== "checkpoint" || !first.from) return [];
        const cwd = cwdOf(threadId);
        const now = await capture(cwd, `${threadId}/now`);
        return now ? diffFiles(cwd, first.from, now, await changes(cwd, first.from, now)) : [];
      }
      // "branch": what a pull request from this branch would carry, from where it left the main branch.
      if (itemId === "branch") {
        const cwd = cwdOf(threadId);
        const base = await mainBranch(cwd);
        const mb = base ? (await git(cwd, ["merge-base", "HEAD", base])).stdout.trim() : "";
        const now = await capture(cwd, `${threadId}/now`);
        return mb && now ? diffFiles(cwd, mb, now, await changes(cwd, mb, now)) : [];
      }
      const it = store.item(threadId, itemId);
      if (it.kind !== "checkpoint" || !it.from || !it.to) return [];
      return diffFiles(cwdOf(threadId), it.from, it.to, it.files);
    },
    "checkpoint.revert": async ({ threadId, itemId, force }) => {
      const it = store.item(threadId, itemId);
      if (it.kind !== "checkpoint" || !it.from) throw new Error("That turn has no snapshot to go back to.");
      if (working(threadId)) throw new Error(setups.has(threadId) ? SETTING_UP : "Stop the session before undoing a turn.");
      if (it.committed) throw new Error("Those changes are committed. Revert the commit instead.");
      const other = busyBeside(threadId);
      if (other) throw new Error(`"${other.title}" is working in this folder now. Wait for it to finish before undoing a turn.`);
      // The files as they are now are kept first, so the undo can be taken back too; a file changed
      // after the turn stops it unless forced, since putting the turn back would lose that change.
      const redo = await undo(cwdOf(threadId), `${threadId}/undo-${it.turn}-${Date.now().toString(36)}`, [{ from: it.from, to: it.to, files: it.files }], force);
      const next = store.putItem(threadId, { ...it, reverted: true, redo });
      store.patchThread(threadId, { toReview: runtime.toReview(threadId) });
      return next;
    },
    "git.push": async ({ threadId }) => {
      if (working(threadId)) throw new Error(setups.has(threadId) ? SETTING_UP : "Wait for the turn to finish before pushing.");
      const cwd = cwdOf(threadId);
      const branch = store.thread(threadId).worktree?.branch ?? (await branchOf(cwd));
      if (!branch) throw new Error("This session isn't on a branch.");
      const remotes = (await git(cwd, ["remote"])).stdout.split("\n").map((r) => r.trim()).filter(Boolean);
      if (!remotes.length) throw new Error("This project has no remote to push to. Add one with gh repo create, or git remote add.");
      const remote = remotes.includes("origin") ? "origin" : remotes[0];
      const r = await run("git", ["push", "-u", remote, branch], { cwd, env, timeout: 120000 });
      if (r.code !== 0) throw new Error(r.stderr.trim().split("\n").pop() || "The push failed.");
      return { branch, remote };
    },
    "git.outgoing": async ({ threadId }) => {
      const cwd = cwdOf(threadId);
      const branch = store.thread(threadId).worktree?.branch ?? (await branchOf(cwd)) ?? "HEAD";
      const remotes = (await git(cwd, ["remote"])).stdout.split("\n").map((r) => r.trim()).filter(Boolean);
      const remote = remotes.includes("origin") ? "origin" : (remotes[0] ?? null);
      const upstream = (await git(cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])).stdout.trim();
      // Before its first push a branch is measured from the base it left: main, master, or what origin calls HEAD.
      const head = remote ? (await git(cwd, ["symbolic-ref", "--short", `refs/remotes/${remote}/HEAD`])).stdout.trim() : "";
      let base = "";
      for (const b of [head, "main", "master"].filter(Boolean)) if ((await git(cwd, ["rev-parse", "--verify", "--quiet", b])).code === 0 && b !== branch) { base = b; break; }
      const from = upstream || base;
      const fork = base ? (await git(cwd, ["merge-base", base, "HEAD"])).stdout.trim() : "";
      const log = async (range: string[]) => {
        const r = await git(cwd, ["log", "--format=%h%x1f%s%x1f%ct", "--shortstat", "-n", "30", ...range]);
        const out: GitCommit[] = [];
        for (const line of r.stdout.split("\n")) {
          const [sha, subject, at] = line.split("\x1f");
          if (sha && subject !== undefined && at) out.push({ sha, subject, at: Number(at) * 1000 });
          else if (out.length && /changed/.test(line)) {
            const last = out[out.length - 1];
            last.added = Number(/(\d+) insertion/.exec(line)?.[1] ?? 0);
            last.removed = Number(/(\d+) deletion/.exec(line)?.[1] ?? 0);
          }
        }
        return out;
      };
      const commits = from ? await log([`${from}..HEAD`]) : await log(["-n", "1", "HEAD"]);
      const at = fork ? (await log(["-n", "1", fork]))[0] : undefined;
      const ahead = fork ? Number((await git(cwd, ["rev-list", "--count", `${fork}..HEAD`])).stdout.trim()) || 0 : commits.length;
      return { branch, remote, commits, base: at ? { ...at, branch: base.replace(/^[^/]+\//, "") } : undefined, ahead };
    },
    "git.switch": async ({ threadId, branch, create }) => {
      const t = store.thread(threadId);
      if (working(threadId)) throw new Error(setups.has(threadId) ? SETTING_UP : "Wait for the turn to finish before switching branches.");
      if (t.worktree) throw new Error(`This session works in a worktree of its own, on ${t.worktree.branch}.`);
      const other = busyBeside(threadId);
      if (other) throw new Error(`"${other.title}" is working in this folder now. Wait for it to finish before switching branches.`);
      const name = branch.trim();
      if (!name || name.startsWith("-") || /[\s~^:?*[\\]|\.\.|@\{/.test(name)) throw new Error("That isn't a name git takes for a branch.");
      const project = store.project(t.projectId);
      const r = await run("git", ["switch", ...(create ? ["-c"] : []), name], { cwd: project.path, env, timeout: 30000 });
      if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n").filter((l) => !/^hint:/.test(l)).pop() || "git couldn't switch branches.");
      store.putProject({ ...project, branch: name });
      return { branch: name };
    },
    "apps.editors": () => editors(),
    "system.check": () => systemCheck(env),
    "background.list": () => backgrounds.list(),
    "background.image": ({ id, dark }) => backgrounds.image(id, dark),
    "background.save": async ({ data, name }) => (await backgrounds.save(data, name), null),
    "background.remove": () => (backgrounds.remove(), null),
    "apps.open": async ({ path, app }) => (await openWith(path, app), null),
    "git.commit": async ({ threadId, message, paths: only }) => {
      const t = store.thread(threadId);
      if (working(threadId)) throw new Error(setups.has(threadId) ? SETTING_UP : "Wait for the turn to finish before committing.");
      const cwd = cwdOf(threadId);
      const open = store.timeline(threadId).flatMap((x) => (x.kind === "checkpoint" && !x.reverted && !x.committed ? [x] : []));
      // Some of the files, when you picked: a rename takes its old path along.
      const picked = (f: FileChange) => !only?.length || only.includes(f.path);
      // Paths in the project's folder, as git reads them from here (an older checkpoint's from the repository's top).
      const prefix = await prefixOf(cwd);
      const paths = [...new Set(open.flatMap((x) => x.files.filter(picked).flatMap((f) => [f.path, ...(f.from ? [f.from] : [])])))].map((p) => local(p, prefix));
      if (!paths.length) throw new Error("Nothing to commit.");
      const add = await git(cwd, ["add", "-A", "--", ...literal(paths)]);
      if (add.code !== 0) throw new Error(add.stderr.trim() || "git add failed.");
      // The approved plan's title, or the first line of what you asked, says what the commit is.
      const items = store.timeline(threadId);
      const plan = [...items].reverse().find((x) => x.kind === "proposal" && x.state === "approved");
      const asked = items.find((x) => x.kind === "user");
      const line = (plan?.kind === "proposal" ? plan.title : asked?.kind === "user" ? asked.text.split("\n")[0] : t.title).trim();
      const subject = message ?? (line.length > 72 ? `${line.slice(0, 71).trimEnd()}…` : line);
      // Hooks and signing can take minutes, and nothing here can answer a prompt. What they say, all of it, is why it failed.
      const c = await run("git", ["commit", "-m", subject, "--", ...literal(paths)], { cwd, env: { ...env, GIT_TERMINAL_PROMPT: "0" }, input: "", timeout: 10 * 60_000 });
      if (c.code !== 0) throw new Error(c.stderr.trim() || c.stdout.trim() || "The commit failed.");
      const sha = (await git(cwd, ["rev-parse", "--short", "HEAD"])).stdout.trim();
      // A turn is committed once all its files are; until then the committed ones wait in `done`,
      // so what's left to commit or undo is only the rest.
      for (const it of open) {
        const took = it.files.filter(picked);
        if (!took.length) continue;
        const left = it.files.filter((f) => !picked(f));
        const done = [...(it.done ?? []), ...took];
        store.putItem(threadId, left.length ? { ...it, files: left, done } : { ...it, files: done, done: undefined, committed: sha });
      }
      store.patchThread(threadId, { toReview: runtime.toReview(threadId) });
      return { sha, files: new Set(open.flatMap((x) => x.files.filter(picked).map((f) => f.path))).size };
    },

    "usage.summary": ({ days = 30, projectId }) => summarize(store, days, projectId),
    "ways.compare": ({ days = 30 }) => compareWays(store, days),
    "keys.set": ({ provider, key }) => {
      if (key) runtime.keys.set(provider, key);
      else runtime.keys.delete(provider);
      store.emit({ type: "keys", keys: keyList() });
      // An endpoint's key decides whether it's ready.
      if (provider.startsWith("endpoint.")) void detect();
      // A connection's key reaches the sessions that have it.
      if (provider.startsWith("addon.") && runtime.addons?.get(provider.split(".")[1])?.enabled) void runtime.relink();
      return keyList();
    },
    "voucher.redeem": async ({ code }) => {
      const k = code?.trim();
      if (k) {
        // Liner Code's site says whether it's one of its vouchers: the code is all that's sent.
        const r = await fetch(`${VOUCHER.url}/usage`, { headers: { authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(8000), redirect: "error" }).catch(() => null);
        if (!r) throw new Error("Liner Code's site didn't answer. Try again in a minute.");
        if (r.status === 401 || r.status === 403) throw new Error("That voucher isn't valid.");
        if (!r.ok) throw new Error(`Liner Code's site answered ${r.status}. Try again in a minute.`);
        runtime.keys.set(endpointKey(VOUCHER.id), k);
      } else runtime.keys.delete(endpointKey(VOUCHER.id));
      store.emit({ type: "keys", keys: keyList() });
      const settings = store.setSettings({ voucher: Boolean(k) });
      syncProviders(settings, runtime.keys);
      void detect();
      return settings;
    },
    "endpoint.models": ({ url, protocol, key }) => endpointModels(url, protocol, key),

    "agents.save": ({ agents }) => {
      // Sessions of an agent you removed carry on with the model it ran on.
      const gone = new Map(store.agents.filter((a) => !agents.some((b) => b.id === a.id)).map((a) => [a.id, a.model]));
      const saved = store.setAgents(agents);
      if (gone.size) store.repairAgents(gone, store.standIn);
      return saved;
    },
    "skills.list": ({ projectId }) => {
      const env = process.env;
      const file = (x: SkillInfo) => ({ ...x, path: join(x.path!, "SKILL.md") });
      const yours = skillsIn([join(env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "skills"), join(env.CODEX_HOME || join(homedir(), ".codex"), "skills")]).map(file);
      const root = projectId ? store.project(projectId).path : undefined;
      // A project's own skills are kept relative, so an agent finds the same one in each project that has it.
      const project = root ? skillsIn([join(root, ".claude", "skills"), join(root, ".codex", "skills")]).map((x) => ({ ...file(x), path: relative(root, join(x.path!, "SKILL.md")) })) : [];
      return { yours, project };
    },
    "settings.save": (patch) => {
      const settings = store.setSettings(patch);
      if (patch.outside !== undefined) x.outside?.apply();
      // A new or changed account or endpoint is a tool to find; a model id you added only changes the lists.
      if (patch.accounts || patch.endpoints) {
        syncProviders(settings, runtime.keys);
        void detect();
      } else if (patch.customModels) publish();
      // Turned on: it looks now rather than in six hours.
      if (patch.updateApp === "auto" || patch.updateTools === "auto") void updates.auto();
      return settings;
    },

    "updates.check": () => updates.check(),
    "updates.download": () => updates.download(),
    "updates.tool": ({ id }) => updates.updateTool(id),
    "updates.dismiss": ({ key }) => updates.dismiss(key),

    "fs.files": ({ projectId, query, limit }) => findFiles(store.project(projectId).path, query, limit),
    "fs.tree": ({ projectId, threadId }) => tree(threadId ? cwdOf(threadId) : store.project(projectId).path),
    "fs.read": ({ threadId, path }) => readFile(cwdOf(threadId), path),
    "files.raw": ({ threadId, path }) => {
      // Only inside the session's folder, with links followed first, so a symlink can't reach out of it.
      const root = realpathSync(cwdOf(threadId));
      const abs = resolve(root, path);
      if (!existsSync(abs)) throw new Error("That file isn't there any more.");
      const real = realpathSync(abs);
      const rel = relative(root, real);
      if (!rel || outside(rel) || resolve(root, rel) !== real) throw new Error("That file is outside the session's folder.");
      const st = statSync(real);
      if (!st.isFile()) throw new Error("That isn't a file.");
      if (st.size > 10 * 1024 * 1024) throw new Error("That file is over 10 MB, too big to preview.");
      const ext = /\.([a-z0-9]+)$/i.exec(real)?.[1]?.toLowerCase() ?? "";
      const types: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", svg: "image/svg+xml", ico: "image/x-icon", bmp: "image/bmp", pdf: "application/pdf" };
      return { data: readFileSync(real).toString("base64"), mime: types[ext] ?? "application/octet-stream", size: st.size };
    },
    "attachment.read": ({ path }) => {
      // Only what was attached to a message: inside the attachments folder, links followed first.
      const dir = join(store.home, "attachments");
      const abs = resolve(dir, path);
      // Outside the folder is refused before anything is looked up, so it says nothing about other files.
      const asked = relative(dir, abs);
      if (!asked || outside(asked)) throw new Error("That file isn't an attachment.");
      if (!existsSync(dir) || !existsSync(abs)) throw new Error("That attachment isn't there any more.");
      const root = realpathSync(dir);
      const real = realpathSync(abs);
      const rel = relative(root, real);
      if (!rel || outside(rel) || resolve(root, rel) !== real) throw new Error("That file isn't an attachment.");
      const st = statSync(real);
      if (!st.isFile()) throw new Error("That isn't a file.");
      if (st.size > 20 * 1024 * 1024) throw new Error("That attachment is over 20 MB, too big to show.");
      const ext = /\.([a-z0-9]+)$/i.exec(real)?.[1]?.toLowerCase() ?? "";
      const types: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", svg: "image/svg+xml", bmp: "image/bmp", pdf: "application/pdf" };
      return { data: readFileSync(real).toString("base64"), mime: types[ext] ?? "application/octet-stream", size: st.size };
    },
    "git.status": ({ projectId }) => gitStatus(store.project(projectId).path),

    "groups.save": ({ groups }) => store.setGroups(groups),

    "project.scratch": async () => {
      // A folder for quick tasks with no project, kept as a Git repo so every turn can be undone.
      const dir = join(store.home, "Scratch");
      await seedRepo(dir, { "README.md": "# Scratch\n\nQuick tasks with no project of their own.\n" }, "Scratch");
      return addProject(dir, "Scratch");
    },

    "compare.start": async ({ projectId, text, files, models, effort, access }) => {
      const project = store.project(projectId);
      if (!project.git || (await git(project.path, ["rev-parse", "--verify", "-q", "HEAD"])).code !== 0) throw new Error("Comparing models needs a Git project with at least one commit: each one works in a worktree of its own.");
      if (models.length < 2) throw new Error("Pick at least two to compare.");
      const id = uid("cmp");
      const base = (await git(project.path, ["rev-parse", "HEAD"])).stdout.trim();
      const made: Thread[] = [];
      for (const m of models.slice(0, 4)) {
        // "@claude:claude-sonnet-5-5" reads as "Sonnet 5.5"; an agent by its name.
        const ref = m.startsWith("@") ? splitModel(m.slice(1)) : null;
        const label = ref ? (detected.find((p) => p.id === ref.provider)?.models.find((x) => x.id === ref.model)?.label ?? (ref.model === "default" || !ref.model ? (detected.find((p) => p.id === ref.provider)?.label ?? ref.provider) : ref.model)) : store.agent(m).name;
        const t = await handlers["thread.create"]({ projectId, agent: m, effort, access, worktree: true, title: `${titleFrom(text)} · ${label}` });
        made.push(store.patchThread(t.id, { compare: { id, base } }));
      }
      for (const t of made) {
        const c = withContext(t, text, files);
        // Each starts once its new worktree is set up, as a message sent there would (thread.send).
        void (setups.get(t.id) ?? Promise.resolve()).then(() => runtime.send(t.id, c.text, "queue", undefined, c.files)).catch(() => {});
      }
      return made;
    },
    "compare.keep": async ({ threadId }) => {
      const t = store.thread(threadId);
      if (!t.compare || !t.worktree) throw new Error("That session isn't part of a comparison.");
      const project = store.project(t.projectId);
      const now = await capture(t.worktree.root ?? t.worktree.path, `${threadId}/keep`);
      if (!now) throw new Error("Couldn't read that session's changes.");
      const patch = (await run("git", ["diff", "--binary", ...PATCH, t.compare.base, now], { cwd: t.worktree.root ?? t.worktree.path, maxBuffer: 256 * 1024 * 1024 })).stdout;
      const files = (patch.match(/^diff --git /gm) ?? []).length;
      if (!files) throw new Error("That one didn't change anything.");
      const top = (await git(project.path, ["rev-parse", "--show-toplevel"])).stdout.trim() || project.path;
      const applied = await run("git", ["apply", "--3way", "--whitespace=nowarn", "-"], { cwd: top, input: patch, env });
      if (applied.code !== 0) throw new Error(applied.stderr.trim().split("\n").pop() || "The changes didn't apply to this checkout.");
      // The others are put away, as archiving each would: a turn still running stops, and their shells
      // and servers go. Their worktrees stay until you delete them.
      for (const o of store.threads.filter((x) => x.compare?.id === t.compare!.id && x.id !== t.id)) {
        runtime.stop(o.id);
        leftBehind(o.id);
        store.patchThread(o.id, { archived: true });
      }
      store.patchThread(t.id, { done: true, unread: false });
      return { files };
    },

    "term.open": ({ threadId, cols, rows, command, title }) => x.terms.open(cwdOf(threadId), cols, rows, command, threadId, title),
    "term.attach": ({ id }) => x.terms.attach(id),
    "term.list": ({ threadId }) => x.terms.list(threadId),
    "term.write": ({ id, data }) => (x.terms.write(id, data), null),
    "term.resize": ({ id, cols, rows }) => (x.terms.resize(id, cols, rows), null),
    "term.clear": ({ id }) => (x.terms.clear(id), null),
    "term.close": ({ id }) => (x.terms.close(id), null),

    "pr.status": async ({ threadId }) => {
      const t = store.thread(threadId);
      const cwd = cwdOf(threadId);
      const gh = await ghState(cwd, env);
      const branch = t.worktree?.branch ?? (await branchOf(cwd));
      const base = await mainBranch(cwd);
      const ahead = base ? Number((await git(cwd, ["rev-list", "--count", `${base}..HEAD`])).stdout.trim()) || 0 : 0;
      if (gh.state !== "ready" || !branch) return { pr: null, branch, ahead, gh: gh.state, detail: gh.detail };
      const pr = await prFor(cwd, branch, env);
      if (pr && (t.pr?.number !== pr.number || t.pr.state !== pr.state)) store.patchThread(threadId, { pr: { number: pr.number, url: pr.url, state: pr.state } });
      return { pr, branch, ahead, gh: "ready" };
    },
    "pr.test": ({ threadId, itemId }) => runtime.prTest(threadId, itemId),
    "pr.picture": async ({ threadId }) => {
      const t = store.thread(threadId);
      const cwd = cwdOf(threadId);
      const branch = t.worktree?.branch ?? (await branchOf(cwd)) ?? "HEAD";
      const ref = (await mainBranch(cwd)) ?? "main";
      // What reached the base on GitHub, looked for at most once a minute per project.
      const name = ref.replace(/^origin\//, "");
      const key = `${t.projectId}:${name}`;
      if (Date.now() - (fetched.get(key) ?? 0) > 60_000) {
        fetched.set(key, Date.now());
        await run("git", ["fetch", "--quiet", "origin", name], { cwd, env, timeout: 30000 }).catch(() => null);
      }
      const remote = (await git(cwd, ["rev-parse", "--verify", "-q", `origin/${name}`])).code === 0;
      return { branch, base: name, ...(await picture(cwd, remote ? `origin/${name}` : name)) };
    },
    "git.message": async ({ threadId }) => {
      const t = store.thread(threadId);
      const cwd = cwdOf(threadId);
      const open = store.timeline(threadId).flatMap((x) => (x.kind === "checkpoint" && !x.reverted && !x.committed ? [x] : []));
      const prefix = await prefixOf(cwd);
      const paths = [...new Set(open.flatMap((x) => x.files.map((f) => local(f.path, prefix))))];
      if (!paths.length) throw new Error("Nothing to commit.");
      const diff = (await run("git", ["diff", "--relative", ...PATCH, "-U2", "HEAD", "--", ...literal(paths)], { cwd, timeout: 30000 })).stdout || (await run("git", ["diff", "--relative", ...PATCH, "--cached", "-U2", "--", ...literal(paths)], { cwd, timeout: 30000 })).stdout;
      const by = runtime.writerFor(t);
      const out = await runtime.quiet(threadId, by, cwd, writePrompt("commit", asksOf(threadId), diff, paths), new AbortController().signal);
      const m = /<message>([\s\S]*?)<\/message>/.exec(out)?.[1]?.trim() || out.trim().split("\n\n")[0];
      if (!m) throw new Error("The model didn't write a message.");
      return { message: m, by };
    },
    "pr.draft": async ({ threadId }) => {
      const t = store.thread(threadId);
      const cwd = cwdOf(threadId);
      const base = await mainBranch(cwd);
      const mb = base ? (await git(cwd, ["merge-base", "HEAD", base])).stdout.trim() : "";
      const [diff, log] = await Promise.all([run("git", ["diff", ...PATCH, "-U2", mb || "HEAD~1", "HEAD"], { cwd, timeout: 30000 }), run("git", ["log", "--format=- %s", `${mb || "HEAD~1"}..HEAD`], { cwd, timeout: 15000 })]);
      // What the session checked: the commands it ran that passed, like the tests.
      const checks = store.timeline(threadId).flatMap((x) => (x.kind === "tool" && x.toolKind === "exec" && x.status === "done" && /test|lint|check|build|tsc/i.test(x.title) ? [x.title.replace(/^Run /, "")] : []));
      const by = runtime.writerFor(t);
      const out = await runtime.quiet(threadId, by, cwd, writePrompt("pr", asksOf(threadId), diff.stdout, [], log.stdout, [...new Set(checks)].slice(0, 8)), new AbortController().signal);
      const title = /<title>([\s\S]*?)<\/title>/.exec(out)?.[1]?.trim();
      const body = /<body>([\s\S]*?)<\/body>/.exec(out)?.[1]?.trim();
      if (!title) throw new Error("The model didn't write a title.");
      return { title, body: body ?? "", by };
    },
    "desk.ask": async ({ threadId, question, context }) => {
      const t = store.thread(threadId);
      const items = store.timeline(threadId);
      const said = items.flatMap((x) => (x.kind === "text" && !x.streaming && x.text.trim() ? [x.text.trim()] : [])).slice(-3);
      const files = [...new Set(items.flatMap((x) => (x.kind === "checkpoint" && !x.reverted ? x.files.map((f) => `${f.path} (+${f.added} −${f.removed})`) : [])))].slice(0, 40);
      const cwd = cwdOf(threadId);
      const prefix = await prefixOf(cwd);
      const open = [...new Set(items.flatMap((x) => (x.kind === "checkpoint" && !x.reverted && !x.committed ? x.files.map((f) => local(f.path, prefix)) : [])))];
      const diff = open.length ? (await run("git", ["diff", "--relative", ...PATCH, "-U2", "HEAD", "--", ...literal(open)], { cwd, timeout: 30000 }).catch(() => null))?.stdout ?? "" : "";
      const by = runtime.writerFor(t);
      const out = await runtime.quiet(threadId, by, cwd, deskPrompt(t.title, asksOf(threadId), said, files, context, question.slice(0, 1000), diff), new AbortController().signal, "desk");
      const answer = out.trim();
      if (!answer) throw new Error("The model didn't answer. Ask again in a moment.");
      return { answer, by };
    },
    "pr.create": async ({ threadId, title, body, draft }) => {
      const t = store.thread(threadId);
      const cwd = cwdOf(threadId);
      const branch = t.worktree?.branch ?? (await branchOf(cwd));
      if (!branch) throw new Error("This session isn't on a branch.");
      const base = await mainBranch(cwd);
      if (base && base.replace(/^origin\//, "") === branch) throw new Error(`This session works on ${branch} itself. Start it in a worktree to open a pull request from a branch of its own.`);
      const pr = await prCreate(cwd, branch, { title, body, draft }, env);
      store.patchThread(threadId, { pr: { number: pr.number, url: pr.url, state: pr.state } });
      return pr;
    },
    "pr.list": async ({ projectId }) => {
      const cwd = store.project(projectId).path;
      const gh = await ghState(cwd, env);
      if (gh.state !== "ready") return { prs: [], gh: gh.state, detail: gh.detail };
      const prs = (await prList(cwd, env)).map((p) => ({ ...p, threadId: store.threads.find((t) => t.projectId === projectId && (t.pr?.number === p.number || t.worktree?.branch === p.head))?.id }));
      return { prs, gh: "ready" };
    },
    "pr.merge": async ({ projectId, number }) => {
      await prMerge(store.project(projectId).path, number, env);
      return null;
    },
    "ports.list": ({ threadId }) => (threadId ? listeningPorts(env, mine(threadId)) : listeningPorts(env)),
    "ports.stop": ({ threadId, port }) => stopServers(env, mine(threadId), { port }),
    "browser.proxy": async ({ port }) => ({ url: await x.proxies.url(port) }),
    "browser.files": async ({ threadId, path }) => {
      const root = cwdOf(threadId);
      return { url: await x.proxies.files(root), path: pagePath(root, path ?? ""), pages: htmlPages(root) };
    },
    "agent.browser.reply": ({ id, ok, value, error }) => (x.tools?.reply(id, ok, value, error), null),

    "design.list": ({ threadId }) => designs(threadId).list(threadId),
    "design.read": async ({ threadId, design, version }) => ({ ...designs(threadId).read(threadId, design, version), url: await x.proxies.files(cwdOf(threadId)) }),
    "design.save": ({ threadId, title, html, design, size }) => designs(threadId).show(threadId, { title, html, design, size }).item,
    "design.restore": ({ threadId, design, version }) => designs(threadId).restore(threadId, design, version),
    "design.built": ({ threadId, design, version }) => designs(threadId).built(threadId, design, version),
    "design.watch": ({ threadId, on }) => (x.designs?.watch(threadId, on), null),

    "device.list": () => devices(env),
    "device.boot": async ({ udid }) => (await boot(udid, env), null),
    "device.shot": async ({ udid }) => ({ png: await screenshot(udid, env) }),
    "device.appearance": async ({ udid, mode }) => (await appearance(udid, mode, env), null),
    "device.log": ({ udid, filter, on }) => (x.logs.set(udid, on, filter), null),

    "routine.save": ({ routine }) => x.routines.put(routine),
    "routine.remove": ({ id }) => (x.routines.remove(id), null),
    "routine.run": ({ id }) => x.routines.fire(id, "You ran it by hand"),
    "routine.test": ({ id, number }) => x.routines.test(id, number),
    "routine.stop": ({ runId }) => (x.routines.stopRun(runId), null),
  };

  /** The branch pull requests go into: origin's default, else main or master. */
  async function mainBranch(cwd: string) {
    const head = (await git(cwd, ["rev-parse", "--abbrev-ref", "origin/HEAD"])).stdout.trim();
    if (head && head !== "origin/HEAD") return head;
    for (const b of ["main", "master"]) if ((await git(cwd, ["rev-parse", "--verify", "-q", b])).code === 0) return b;
    return undefined;
  }

  /** A session, as the dev servers on this Mac are told apart: by its id, and its folders. */
  function mine(threadId: string) {
    return { threadId, folders: [...new Set([cwdOf(threadId), store.project(store.thread(threadId).projectId).path])] };
  }
  /** What a session started stops with it, when it's archived or removed (T3 Code's resource cleanup). */
  function leftBehind(threadId: string) {
    // Its Terminal's shells too: they outlive the surface, not the session. (Tests pass no Terminals.)
    x.terms.closeThread?.(threadId);
    void stopServers(env, mine(threadId), { only: "session" }).catch(() => {});
  }
  function cwdOf(threadId: string) {
    const t = store.thread(threadId);
    return t.worktree?.path ?? store.project(t.projectId).path;
  }
  /** The designs, for a session that's there: an id from the app is never a path of its own (designs/<id>/…). */
  function designs(threadId: string) {
    store.thread(threadId);
    if (!x.designs) throw new Error("Designs aren't available here.");
    return x.designs;
  }
  /**
    Another session running now in this one's folder (or one inside it, or around it): putting
    files back or switching branches there would pull them out from under it. A side chat only
    reads. T3 Code's orchestration-v2/CheckpointRestoreSafety.ts.
  */
  function busyBeside(threadId: string) {
    const inside = (a: string, b: string) => {
      const r = relative(a, b);
      return r === "" || !outside(r);
    };
    const cwd = realOf(cwdOf(threadId));
    return store.threads.find((o) => {
      if (o.id === threadId || o.sideOf || !working(o.id)) return false;
      const there = realOf(cwdOf(o.id));
      return inside(cwd, there) || inside(there, cwd);
    });
  }
  function defaultAgent() {
    // A bare model: your cheaper one, else the first that's ready.
    const cast = castOf(shown(), { picks: store.settings.picks });
    const p = detected.find((x) => x.available && x.adapter && x.id !== "demo");
    return cast ? `@${cast.everyday}` : p ? `@${p.id}:${p.models[0]?.id ?? "default"}` : "demo";
  }

  return {
    ready,
    updates,
    async call(method: string, params: unknown) {
      const h = (handlers as Record<string, (p: unknown) => unknown>)[method];
      if (!h) throw new Error(`Unknown method ${method}`);
      return h(params ?? {});
    },
  };
}

const dayOf = (at: number) => new Date(at).toISOString().slice(0, 10);

function summarize(store: Store, days: number, projectId?: string): UsageSummary {
  const to = Date.now();
  const from = to - days * 86400000;
  const rows = store.usage(from).filter((r) => !projectId || r.projectId === projectId);
  const tokens = (r: { inputTokens: number; outputTokens: number; cacheReadTokens: number }) => r.inputTokens + r.outputTokens + r.cacheReadTokens;
  const sum = rows.reduce((s, r) => ({ cost: s.cost + r.costUsd, tokens: s.tokens + tokens(r), cache: s.cache + r.cacheReadTokens, input: s.input + r.inputTokens + r.cacheReadTokens }), { cost: 0, tokens: 0, cache: 0, input: 0 });
  const priciest = rows.reduce<(typeof rows)[number] | undefined>((m, r) => (!m || r.costUsd > m.costUsd ? r : m), undefined);
  const dayMap = new Map<string, { costUsd: number; tokens: number; turns: number }>();
  for (let d = 0; d < days; d++) dayMap.set(dayOf(from + (d + 1) * 86400000), { costUsd: 0, tokens: 0, turns: 0 });
  for (const r of rows) {
    const d = dayMap.get(dayOf(r.at)) ?? { costUsd: 0, tokens: 0, turns: 0 };
    d.costUsd += r.costUsd;
    d.tokens += tokens(r);
    d.turns += 1;
    dayMap.set(dayOf(r.at), d);
  }
  const group = <K extends string>(key: (r: (typeof rows)[number]) => K) => {
    const m = new Map<K, (typeof rows)[number][]>();
    for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
    return m;
  };
  const byAgent = [...group((r) => r.agent)].map(([agent, rs]) => ({ agent, costUsd: rs.reduce((s, r) => s + r.costUsd, 0), tokens: rs.reduce((s, r) => s + tokens(r), 0), turns: rs.length })).sort((a, b) => b.costUsd - a.costUsd || b.tokens - a.tokens);
  const byModel = [...group((r) => `${r.provider}:${r.model}`)]
    .map(([key, rs]) => {
      const input = rs.reduce((s, r) => s + r.inputTokens + r.cacheReadTokens, 0);
      return { model: key.slice(key.indexOf(":") + 1), provider: rs[0].provider, tokens: rs.reduce((s, r) => s + tokens(r), 0), cacheShare: input ? rs.reduce((s, r) => s + r.cacheReadTokens, 0) / input : 0, costUsd: rs.reduce((s, r) => s + r.costUsd, 0) };
    })
    .sort((a, b) => b.costUsd - a.costUsd || b.tokens - a.tokens);
  const title = priciest ? store.threads.find((t) => t.id === priciest.threadId)?.title ?? "A deleted session" : "";
  return {
    from,
    to,
    totals: { costUsd: sum.cost, tokens: sum.tokens, turns: rows.length, cacheShare: sum.input ? sum.cache / sum.input : 0, perTurn: rows.length ? sum.cost / rows.length : 0, priciest: priciest ? { costUsd: priciest.costUsd, title } : undefined },
    days: [...dayMap].map(([day, d]) => ({ day, ...d })),
    byAgent,
    byModel,
  };
}

/**
  How each mode went in your own sessions over `days`: sessions sorted by how they ran
  (see WayStats), with their turns, cost and time from the usage log, the changed turns you kept,
  and how often the Reviewer passed a change the first time. Demo, routine and cost-test sessions don't count.
*/
export function compareWays(store: Store, days: number): WayStats[] {
  const from = Date.now() - days * 86400000;
  const out = new Map<string, WayStats>();
  const of = (way: Mode) => out.get(way) ?? out.set(way, { way, sessions: 0, turns: 0, changed: 0, kept: 0, costUsd: 0, seconds: 0, reviewed: 0, firstPass: 0 }).get(way)!;
  for (const way of ["solo", "plan", "auto"] as const) of(way);
  const wayOf = (t: Thread): Mode => (t.route ? "auto" : t.lead ? "plan" : "solo");
  const threads = new Map(store.threads.filter((t) => t.agent !== "demo" && t.lead !== "demo" && !t.routine && !t.trial && t.updatedAt >= from).map((t) => [t.id, t]));
  for (const r of store.usage(from)) {
    const t = threads.get(r.threadId);
    if (!t) continue;
    const s = of(wayOf(t));
    s.turns += 1;
    s.costUsd += r.costUsd;
    s.seconds += r.seconds;
  }
  for (const t of threads.values()) {
    const s = of(wayOf(t));
    s.sessions += 1;
    for (const m of store.marks(t.id)) {
      if (m.at < from) continue;
      if (m.kind === "checkpoint" && m.files.length) {
        s.changed += 1;
        if (!m.reverted) s.kept += 1;
      }
      if (m.kind === "review" && m.round === 1 && (m.status === "passed" || m.status === "blocked")) {
        s.reviewed += 1;
        if (m.status === "passed") s.firstPass += 1;
      }
    }
  }
  return [...out.values()];
}
