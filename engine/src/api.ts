/*
  The commands the app can send, one handler each. Anything slow (a turn) runs in the
  background and reports through events; handlers answer as soon as the command is accepted.
*/
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { homedir, hostname, userInfo } from "node:os";
import { setupOf, setupsOf, splitModel, TRIAL } from "../../contracts/src/index.ts";
import type { AddedAgent, CommandInfo, Effort, FoundRepo, ModelInfo, SkillInfo, ProviderInfo, Rpc, RpcMethod, Snapshot, Thread, ToolLimits, UsageSummary, WayStats } from "../../contracts/src/index.ts";
import { emptyUsage } from "../../contracts/src/index.ts";
import { branchOf, capture, changes, diffFiles, forget, isRepo, restore } from "./checkpoints.ts";
import { run, which } from "./exec.ts";
import { editors, openWith } from "./apps.ts";
import { Backgrounds } from "./backgrounds.ts";
import { findFiles, gitStatus, tree } from "./files.ts";
import { ensureSampleProject } from "./providers/demo.ts";
import type { Routines } from "./routines.ts";
import { providers, syncProviders, titleFrom, type Runtime } from "./runtime.ts";
import { fromRegistry, listRegistry, readRegistry, slugFor, splitCommand } from "./providers/added.ts";
import { picture } from "./prflow.ts";
import { uid, type Store } from "./store.ts";
import { appearance, boot, devices, ghState, listeningPorts, prCreate, prFor, prList, prMerge, readFile, screenshot, type DeviceLogs, type Terminals } from "./surfaces.ts";
import type { Proxies } from "./proxy.ts";
import type { AgentTools } from "./agent-tools.ts";
import { Updater } from "./updates.ts";

type Handlers = { [M in RpcMethod]: (p: Rpc[M][0]) => Promise<Rpc[M][1]> | Rpc[M][1] };

const git = (cwd: string, args: string[]) => run("git", args, { cwd, timeout: 120000 });

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

const ROOTS = ["Code", "code", "Projects", "projects", "Project", "Developer", "dev", "src", "repos", "GitHub", "Documents/GitHub", "AndroidStudioProjects", "Sites", "work"];

type Extras = { routines: Routines; terms: Terminals; logs: DeviceLogs; proxies: Proxies; tools?: AgentTools };

export function createApi(store: Store, runtime: Runtime, env: NodeJS.ProcessEnv, x: Extras) {
  syncProviders(store.settings);
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
  let limitsCache: { at: number; tools: ToolLimits[] } | null = null;
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
  const ready = detect();
  // Liner Code's releases and the tools' own updaters; a tool that was updated is found again.
  const updates = new Updater(store, env, runtime, () => void detect());
  const keyList = () => [...runtime.keys.keys()];

  // A new worktree has none of the checkout's installed packages; the project's setup command
  // runs there before the first turn, and says how it went on the timeline.
  const setups = new Map<string, Promise<void>>();
  const asksOf = (threadId: string) => store.timeline(threadId).flatMap((x) => (x.kind === "user" && !x.text.startsWith("/") ? [x.text] : x.kind === "proposal" && x.state === "approved" ? [`(approved plan) ${x.title}`] : [])).slice(-6);
  const worktreeRoot = () => (store.settings.worktreeRoot?.trim() ? store.settings.worktreeRoot.trim().replace(/^~(?=\/|$)/, homedir()) : join(store.home, "worktrees"));
  const setUp = async (threadId: string, cwd: string, command: string) => {
    const note = (text: string) => store.putItem(threadId, { kind: "notice", id: uid("it"), turn: 0, at: Date.now(), text });
    const t0 = Date.now();
    note(`Setting up the worktree: ${command}`);
    try {
      const r = await run(env.SHELL || "/bin/zsh", ["-lc", command], { cwd, env, timeout: 15 * 60_000 });
      const secs = Math.round((Date.now() - t0) / 1000);
      note(r.code === 0 ? `Set up in ${secs}s.` : `The setup command failed (${r.code}) after ${secs}s: ${(r.stderr || r.stdout).trim().split("\n").slice(-2).join(" ").slice(0, 300)}. The session carries on without it.`);
    } catch (e) {
      note(`The setup command didn't run: ${e instanceof Error ? e.message : String(e)}. The session carries on without it.`);
    } finally {
      setups.delete(threadId);
    }
  };

  const snapshot = (): Snapshot => ({ version: updates.state.app.current, keys: keyList(), home: store.home, projects: store.projects, threads: store.threads, agents: store.agents, providers: shown(), settings: store.settings, groups: store.groups, routines: x.routines.routines, runs: x.routines.recent, updates: updates.state });

  /** Mentioned files and attachments, said in words the agent can act on. */
  const withContext = (t: Thread, text: string, files: { name: string; data: string }[] = []) => {
    const project = store.project(t.projectId);
    const cwd = t.worktree?.path ?? project.path;
    const notes: string[] = [];
    const mentioned = [...text.matchAll(/(?:^|\s)@([\w./-]+)/g)].map((m) => m[1]).filter((p) => existsSync(join(cwd, p)));
    if (mentioned.length) notes.push(`Files I pointed at: ${[...new Set(mentioned)].join(", ")}`);
    if (files.length) {
      const dir = join(store.home, "attachments", t.id);
      mkdirSync(dir, { recursive: true });
      const saved = files.map((f) => {
        const path = join(dir, `${Date.now().toString(36)}-${basename(f.name)}`);
        writeFileSync(path, Buffer.from(f.data, "base64"));
        return path;
      });
      notes.push(`I attached: ${saved.join(", ")}`);
    }
    return notes.length ? `${text}\n\n${notes.join("\n")}` : text;
  };

  const addProject = async (abs: string, name?: string, agent?: string) => {
    if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new Error("That folder doesn't exist.");
    const have = store.projects.find((p) => p.path === abs);
    if (have) return have;
    const isGit = await isRepo(abs);
    const info = isGit ? await repoInfo(abs) : {};
    return store.putProject({ id: uid("pr"), name: name ?? basename(abs), path: abs, agent, git: isGit, ...info, createdAt: Date.now() });
  };

  /** What a session takes on from one of your setups: who it talks to, the stages that write, the crew and the checks. null lets it go. */
  const setupFields = (id: string | null): Partial<Thread> => {
    if (id === null) return { setup: undefined, stages: undefined, checks: undefined, helpers: undefined };
    const s = setupOf(store.settings, store.agents, id);
    if (!s) throw new Error("Make a setup in Settings, Agentic features first.");
    return { setup: { id: s.id, name: s.name }, agent: s.stages[0].who, lead: s.lead ?? undefined, helpers: s.crew.length ? s.crew : undefined, stages: s.stages, checks: s.checks, model: undefined };
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

  /**
    One way of a cost test, start to end, with nobody watching: the task, then the lead's plan
    approved as it stands and built (the coder, its Reviewer, the crew), then marked finished.
  */
  const runTrial = async (threadId: string) => {
    let failed: string | undefined;
    try {
      await runtime.send(threadId, TRIAL.task);
      const plan = [...store.timeline(threadId)].reverse().find((x) => x.kind === "proposal" && x.state === "asking");
      if (plan) await runtime.approvePlan(threadId, plan.id);
      const t = store.thread(threadId);
      if (store.timeline(threadId).some((x) => x.kind === "turn" && x.status === "stopped")) failed = "You stopped it.";
      else if (t.status === "limited") failed = t.limit?.message ?? "It hit a usage limit.";
      else if (t.status === "error") failed = "It ran into a problem. Open it to see what happened.";
    } catch (e) {
      failed = e instanceof Error ? e.message : String(e);
    }
    const t = store.thread(threadId);
    if (t.trial) store.patchThread(threadId, { trial: { ...t.trial, finished: Date.now(), ...(failed ? { failed } : {}) } });
  };

  const backgrounds = new Backgrounds(store.home);
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
      syncProviders(store.settings);
      await detect(true);
      return agent;
    },
    "acp.remove": async ({ id }) => {
      const settings = store.setSettings({ addedAgents: (store.settings.addedAgents ?? []).filter((a) => a.id !== id), customModels: (store.settings.customModels ?? []).filter((c) => c.provider !== `acp.${id}`) });
      syncProviders(settings);
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
    "usage.limits": async () => {
      // Each tool's plan windows, asked of the tool. A minute's answer is reused.
      if (limitsCache && Date.now() - limitsCache.at < 60_000) return { tools: limitsCache.tools };
      const tools = (
        await Promise.all(
          detected
            .filter((d) => d.available && d.adapter && providers[d.id]?.limits)
            .map(async (d): Promise<ToolLimits | null> => {
              try {
                const r = await providers[d.id].limits!(env, join(store.home, "probe"));
                return r ? { provider: d.id, label: d.label, at: Date.now(), ...r } : null;
              } catch (e) {
                return { provider: d.id, label: d.label, at: Date.now(), windows: [], detail: e instanceof Error ? e.message : String(e) };
              }
            }),
        )
      ).filter((x): x is ToolLimits => Boolean(x));
      limitsCache = { at: Date.now(), tools };
      return { tools };
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
      // A worktree whose session is archived or deleted is only taking room.
      let removed = 0;
      let kept = 0;
      for (const p of store.projects.filter((x) => x.git && (!projectId || x.id === projectId))) {
        const r = await git(p.path, ["worktree", "list", "--porcelain"]);
        const paths = r.stdout.split("\n").filter((l) => l.startsWith("worktree ")).map((l) => l.slice(9));
        for (const path of paths) {
          if (!path.startsWith(worktreeRoot())) continue;
          const owner = store.threads.find((t) => t.worktree && (t.worktree.root ?? t.worktree.path) === path);
          if (owner && !owner.archived) {
            kept++;
            continue;
          }
          if ((await git(p.path, ["worktree", "remove", "--force", path])).code === 0) removed++;
        }
        await git(p.path, ["worktree", "prune"]);
      }
      return { removed, kept };
    },
    "project.remove": ({ id }) => {
      for (const t of store.threads.filter((x) => x.projectId === id)) runtime.closeThread(t.id);
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

    "thread.create": async ({ projectId, agent, lead, setup, title, forkOf, id, access, effort, model, worktree, base, inWorktree }) => {
      const project = store.project(projectId);
      const parent = forkOf ? store.thread(forkOf) : undefined;
      const who = agent ?? parent?.agent ?? project.agent ?? defaultAgent();
      const now = Date.now();
      const tid = id ?? uid("th");
      let tree: Thread["worktree"];
      let notice: string | undefined;
      if (inWorktree && project.git) {
        // Carry on in a worktree that's already there, on its branch.
        const top = (await git(inWorktree, ["rev-parse", "--show-toplevel"])).stdout.trim();
        if (!top) throw new Error("That worktree isn't there any more.");
        const branch = (await branchOf(top)) ?? "HEAD";
        const sub = relative((await git(project.path, ["rev-parse", "--show-toplevel"])).stdout.trim(), realpathSync(project.path));
        tree = sub ? { path: join(top, sub), branch, root: top } : { path: top, branch };
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
          tree = sub ? { path: join(root, sub), branch, root } : { path: root, branch };
          // Setting up a new worktree: the project's setup command, then its scripts marked to run there.
          const steps = [project.setup, ...(project.scripts ?? []).filter((x) => x.onWorktree).map((x) => x.command)].filter((x): x is string => Boolean(x));
          if (steps.length) setups.set(tid, setUp(tid, tree.path, steps.join(" && ")));
        }
      }
      const t: Thread = {
        id: tid,
        projectId,
        title: title ?? parent?.title ?? "New session",
        agent: who.startsWith("@") || store.agents.some((a) => a.id === who) ? who : defaultAgent(),
        lead: lead ?? parent?.lead,
        status: "idle",
        access: access ?? parent?.access ?? "ask",
        model: model ?? parent?.model,
        effort: effort ?? parent?.effort,
        forkOf,
        forkSession: parent ? (parent.providerSession ?? "") : undefined,
        worktree: tree ?? parent?.worktree,
        turns: parent?.turns ?? 0,
        usage: emptyUsage(),
        createdAt: now,
        updatedAt: now,
        // A setup decides who works on it; a fork keeps its parent's.
        ...(setup ? setupFields(setup) : parent?.setup ? { setup: parent.setup, stages: parent.stages, checks: parent.checks, helpers: parent.helpers } : {}),
      };
      store.putThread(t);
      if (notice) store.putItem(t.id, { kind: "notice", id: uid("it"), turn: 0, at: now, text: notice });
      // A fork starts with its parent's timeline, so you can see where it branched.
      if (parent) for (const it of store.timeline(parent.id)) store.putItem(t.id, { ...it, id: uid("it") });
      return t;
    },
    "thread.update": ({ id, setup, ...patch }) => {
      // null clears a field; undefined leaves it.
      const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined).map(([k, v]) => [k, v === null ? undefined : v]));
      // A setup brings who works on it; letting it go comes before whoever you picked instead.
      if (setup === undefined) return store.patchThread(id, clean);
      return store.patchThread(id, setup === null ? { ...setupFields(null), ...clean } : { ...clean, ...setupFields(setup) });
    },
    "thread.items": ({ id }) => store.timeline(id),
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
      // The turn runs on; its progress comes back as events. A new worktree finishes setting up first.
      void (setups.get(id) ?? Promise.resolve())
        .then(() => runtime.send(id, withContext(t, text, files), mode, anchor))
        .catch((e) => store.emit({ type: "notify", threadId: id, kind: "error", title: "That didn't start", body: String(e?.message ?? e) }));
      return null;
    },
    "thread.queue": ({ id, queue }) => store.patchThread(id, { queue }),
    "thread.rewind": async ({ threadId, itemId, files }) => {
      // Edit from here: the conversation goes back to just before this message.
      const it = store.item(threadId, itemId);
      if (it.kind !== "user") throw new Error("Only a message you sent can be edited.");
      if (runtime.isRunning(threadId)) throw new Error("Stop the session before going back.");
      const from = it.turn;
      const later = store.timeline(threadId).flatMap((x) => (x.kind === "checkpoint" && x.turn >= from && !x.reverted ? [x] : []));
      let undone = 0;
      if (files && later.length) {
        const committed = later.find((x) => x.committed);
        if (committed) throw new Error(`Turn ${committed.turn}'s changes are committed (${committed.committed}). Revert the commit first, or keep the changes.`);
        // Newest first, so each file ends as it was before the first of these turns.
        for (const cp of [...later].reverse()) if (cp.from) await restore(cwdOf(threadId), cp.from, cp.files);
        undone = new Set(later.flatMap((x) => x.files.map((f) => f.path))).size;
      }
      runtime.closeThread(threadId);
      store.truncate(threadId, from);
      // The tools' own sessions remember the turns that came off, so the next turn starts fresh
      // and gets the conversation that's left as text.
      store.patchThread(threadId, { turns: from - 1, status: "idle", providerSession: undefined, leadSession: undefined, forkSession: undefined, queue: [], verdict: undefined, toReview: runtime.toReview(threadId), unread: false, done: false });
      return { turn: from, files: undone };
    },
    "thread.stop": ({ id }) => {
      runtime.stop(id);
      return null;
    },
    "thread.remove": async ({ id }) => {
      const t = store.thread(id);
      runtime.closeThread(id);
      const project = store.project(t.projectId);
      await forget(project.path, id).catch(() => {});
      if (t.worktree) await git(project.path, ["worktree", "remove", "--force", t.worktree.root ?? t.worktree.path]).catch(() => {});
      store.removeThread(id);
      store.emit({ type: "thread", thread: { ...t, archived: true } });
      return null;
    },

    "approval.answer": ({ threadId, itemId, allow, reason, always }) => {
      runtime.answer(threadId, itemId, allow, reason, always);
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
      if (runtime.isRunning(threadId)) throw new Error("Wait for the turn to finish.");
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
    "checkpoint.revert": async ({ threadId, itemId }) => {
      const it = store.item(threadId, itemId);
      if (it.kind !== "checkpoint" || !it.from) throw new Error("That turn has no snapshot to go back to.");
      if (runtime.isRunning(threadId)) throw new Error("Stop the session before undoing a turn.");
      if (it.committed) throw new Error("Those changes are committed. Revert the commit instead.");
      await restore(cwdOf(threadId), it.from, it.files);
      const next = store.putItem(threadId, { ...it, reverted: true });
      store.patchThread(threadId, { toReview: runtime.toReview(threadId) });
      return next;
    },
    "git.push": async ({ threadId }) => {
      if (runtime.isRunning(threadId)) throw new Error("Wait for the turn to finish before pushing.");
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
    "git.switch": async ({ threadId, branch, create }) => {
      const t = store.thread(threadId);
      if (runtime.isRunning(threadId)) throw new Error("Wait for the turn to finish before switching branches.");
      if (t.worktree) throw new Error(`This session works in a worktree of its own, on ${t.worktree.branch}.`);
      const name = branch.trim();
      if (!name || name.startsWith("-") || /[\s~^:?*[\\]|\.\.|@\{/.test(name)) throw new Error("That isn't a name git takes for a branch.");
      const project = store.project(t.projectId);
      const r = await run("git", ["switch", ...(create ? ["-c"] : []), name], { cwd: project.path, env, timeout: 30000 });
      if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n").filter((l) => !/^hint:/.test(l)).pop() || "git couldn't switch branches.");
      store.putProject({ ...project, branch: name });
      return { branch: name };
    },
    "apps.editors": () => editors(),
    "background.list": () => backgrounds.list(),
    "background.image": ({ id, dark }) => backgrounds.image(id, dark),
    "background.save": async ({ data, name }) => (await backgrounds.save(data, name), null),
    "background.remove": () => (backgrounds.remove(), null),
    "apps.open": async ({ path, app }) => (await openWith(path, app), null),
    "git.commit": async ({ threadId, message }) => {
      const t = store.thread(threadId);
      if (runtime.isRunning(threadId)) throw new Error("Wait for the turn to finish before committing.");
      const cwd = cwdOf(threadId);
      const open = store.timeline(threadId).flatMap((x) => (x.kind === "checkpoint" && !x.reverted && !x.committed ? [x] : []));
      const paths = [...new Set(open.flatMap((x) => x.files.flatMap((f) => [f.path, ...(f.from ? [f.from] : [])])))];
      if (!paths.length) throw new Error("Nothing to commit.");
      const add = await git(cwd, ["add", "-A", "--", ...paths]);
      if (add.code !== 0) throw new Error(add.stderr.trim() || "git add failed.");
      // The approved plan's title, or the first line of what you asked, says what the commit is.
      const items = store.timeline(threadId);
      const plan = [...items].reverse().find((x) => x.kind === "proposal" && x.state === "approved");
      const asked = items.find((x) => x.kind === "user");
      const line = (plan?.kind === "proposal" ? plan.title : asked?.kind === "user" ? asked.text.split("\n")[0] : t.title).trim();
      const subject = message ?? (line.length > 72 ? `${line.slice(0, 71).trimEnd()}…` : line);
      const c = await run("git", ["commit", "-m", subject, "--", ...paths], { cwd, env });
      if (c.code !== 0) throw new Error((c.stderr || c.stdout).trim().split("\n").pop() || "The commit failed.");
      const sha = (await git(cwd, ["rev-parse", "--short", "HEAD"])).stdout.trim();
      for (const it of open) store.putItem(threadId, { ...it, committed: sha });
      store.patchThread(threadId, { toReview: runtime.toReview(threadId) });
      return { sha, files: paths.length };
    },

    "usage.summary": ({ days = 30, projectId }) => summarize(store, days, projectId),
    "ways.compare": ({ days = 30 }) => compareWays(store, days),
    "keys.set": ({ provider, key }) => {
      if (key) runtime.keys.set(provider, key);
      else runtime.keys.delete(provider);
      store.emit({ type: "keys", keys: keyList() });
      return keyList();
    },

    "agents.save": ({ agents }) => store.setAgents(agents),
    "settings.save": (patch) => {
      const settings = store.setSettings(patch);
      // A new or changed account is a tool to find; a model id you added only changes the lists.
      if (patch.accounts) {
        syncProviders(settings);
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
    "git.status": ({ projectId }) => gitStatus(store.project(projectId).path),

    "groups.save": ({ groups }) => store.setGroups(groups),

    "project.scratch": async () => {
      // A folder for quick tasks with no project, kept as a Git repo so every turn can be undone.
      const dir = join(store.home, "Scratch");
      await seedRepo(dir, { "README.md": "# Scratch\n\nQuick tasks with no project of their own.\n" }, "Scratch");
      return addProject(dir, "Scratch");
    },

    "ways.trial": async ({ ways }) => {
      // The cost test's own project: two short files, so every way starts from the same small context.
      const dir = join(store.home, "Cost test");
      await seedRepo(dir, TRIAL.files, "Cost test");
      const project = await addProject(dir, "Cost test");
      const agents = store.agents.filter((a) => a.id !== "demo");
      const lead = agents.find((a) => /lead/i.test(a.role));
      const coder = agents.find((a) => a.specialty === "coder") ?? agents.find((a) => a !== lead);
      const first = detected.find((p) => p.available && p.adapter && p.id !== "demo" && p.models.length);
      const setups = setupsOf(store.settings, store.agents);
      // Who each way puts to work, the way Home starts it: a model alone, the lead and its coder, or one of your setups.
      const cast = (way: string): { agent: string; lead?: string; setup?: string; effort: Effort; name: string } | null => {
        if (way === "model") return first ? { agent: `@${first.id}:${first.models[0].id}`, effort: "medium", name: "Just a model" } : null;
        if (way === "lead") return lead && coder ? { agent: coder.id, lead: lead.id, effort: "medium", name: "A lead and a coder" } : null;
        const s = setups.find((x) => x.id === way);
        return s ? { agent: s.stages[0].who, setup: s.id, effort: s.lead ? "medium" : store.agent(s.stages[0].who).effort, name: s.name } : null;
      };
      const id = uid("tri");
      const made: Thread[] = [];
      for (const way of ways) {
        const c = cast(way);
        if (!c) continue;
        const t = await handlers["thread.create"]({ projectId: project.id, agent: c.agent, lead: c.lead, setup: c.setup, effort: c.effort, access: "edits", worktree: true, title: `Cost test · ${c.name}` });
        made.push(store.patchThread(t.id, { trial: { id, way, at: Date.now() } }));
      }
      if (!made.length) throw new Error("Nothing to test yet: get a model ready in Models, or make agents in Team.");
      for (const t of made) void runTrial(t.id);
      return made;
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
      for (const t of made) void runtime.send(t.id, withContext(t, text, files)).catch(() => {});
      return made;
    },
    "compare.keep": async ({ threadId }) => {
      const t = store.thread(threadId);
      if (!t.compare || !t.worktree) throw new Error("That session isn't part of a comparison.");
      const project = store.project(t.projectId);
      const now = await capture(t.worktree.root ?? t.worktree.path, `${threadId}/keep`);
      if (!now) throw new Error("Couldn't read that session's changes.");
      const patch = (await run("git", ["diff", "--binary", t.compare.base, now], { cwd: t.worktree.root ?? t.worktree.path, maxBuffer: 256 * 1024 * 1024 })).stdout;
      const files = (patch.match(/^diff --git /gm) ?? []).length;
      if (!files) throw new Error("That one didn't change anything.");
      const top = (await git(project.path, ["rev-parse", "--show-toplevel"])).stdout.trim() || project.path;
      const applied = await run("git", ["apply", "--3way", "--whitespace=nowarn", "-"], { cwd: top, input: patch, env });
      if (applied.code !== 0) throw new Error(applied.stderr.trim().split("\n").pop() || "The changes didn't apply to this checkout.");
      // The others are put away; their worktrees stay until you delete them.
      for (const o of store.threads.filter((x) => x.compare?.id === t.compare!.id && x.id !== t.id)) store.patchThread(o.id, { archived: true });
      store.patchThread(t.id, { done: true, unread: false });
      return { files };
    },

    "term.open": ({ threadId, cols, rows, command }) => x.terms.open(cwdOf(threadId), cols, rows, command),
    "term.write": ({ id, data }) => (x.terms.write(id, data), null),
    "term.resize": ({ id, cols, rows }) => (x.terms.resize(id, cols, rows), null),
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
      const paths = [...new Set(open.flatMap((x) => x.files.map((f) => f.path)))];
      if (!paths.length) throw new Error("Nothing to commit.");
      const diff = (await run("git", ["diff", "--no-color", "-U2", "HEAD", "--", ...paths], { cwd, timeout: 30000 })).stdout || (await run("git", ["diff", "--no-color", "--cached", "-U2", "--", ...paths], { cwd, timeout: 30000 })).stdout;
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
      const [diff, log] = await Promise.all([run("git", ["diff", "--no-color", "-U2", mb || "HEAD~1", "HEAD"], { cwd, timeout: 30000 }), run("git", ["log", "--format=- %s", `${mb || "HEAD~1"}..HEAD`], { cwd, timeout: 15000 })]);
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
      const open = [...new Set(items.flatMap((x) => (x.kind === "checkpoint" && !x.reverted && !x.committed ? x.files.map((f) => f.path) : [])))];
      const diff = open.length ? (await run("git", ["diff", "--no-color", "-U2", "HEAD", "--", ...open], { cwd, timeout: 30000 }).catch(() => null))?.stdout ?? "" : "";
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
    "ports.list": () => listeningPorts(env),
    "browser.proxy": async ({ port }) => ({ url: await x.proxies.url(port) }),
    "agent.browser.reply": ({ id, ok, value, error }) => (x.tools?.reply(id, ok, value, error), null),

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

  function cwdOf(threadId: string) {
    const t = store.thread(threadId);
    return t.worktree?.path ?? store.project(t.projectId).path;
  }
  function defaultAgent() {
    // Just a model: the first model that's ready. Otherwise the team's coder.
    if (store.settings.workStyle === "model") {
      const p = detected.find((x) => x.available && x.adapter && x.id !== "demo");
      return p ? `@${p.id}:${p.models[0]?.id ?? "default"}` : "demo";
    }
    return store.agents.find((a) => a.specialty === "coder")?.id ?? store.agents[0]?.id ?? "demo";
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
  How each way of working went in your own sessions over `days`: sessions sorted by how they ran
  (see WayStats), with their turns, cost and time from the usage log, the changed turns you kept,
  and how often the Reviewer passed a change the first time. Demo, routine and cost-test sessions don't count.
*/
export function compareWays(store: Store, days: number): WayStats[] {
  const from = Date.now() - days * 86400000;
  const out = new Map<string, WayStats>();
  const of = (way: string) => out.get(way) ?? out.set(way, { way, sessions: 0, turns: 0, changed: 0, kept: 0, costUsd: 0, seconds: 0, reviewed: 0, firstPass: 0 }).get(way)!;
  for (const way of ["model", "lead", ...setupsOf(store.settings, store.agents).map((x) => x.id)]) of(way);
  // A setup's sessions under its id; a lead with a crew, or your agent with no lead, from before setups count as your first, "mine".
  const wayOf = (t: Thread) => (t.setup ? t.setup.id : t.agent.startsWith("@") ? "model" : t.lead && !t.helpers?.length ? "lead" : "mine");
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
