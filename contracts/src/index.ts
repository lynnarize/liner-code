/*
  Liner Code · Contracts
  Everything that crosses the wire between the engine and the app. The engine owns the state;
  the app renders it and sends commands. Change a shape here and both sides follow.

  Words, kept the same everywhere:
  - provider: the agent runtime the engine drives (Claude Code, Codex, Hermes, OpenCode, Demo).
  - agent: a named profile you open threads with: a provider and model, an effort, a soul.md.
  - project: a folder on this machine.
  - thread: one conversation with an agent in a project, made of turns.
  - turn: one message from you and everything the agent did until it stopped.
  - item: one thing on a thread's timeline: your message, the agent's text, a tool call, a plan,
    an approval it is waiting on, the checkpoint that closed a turn.
*/

/** The tools Liner Code knows by name. */
export type BuiltinProvider = "claude" | "codex" | "hermes" | "opencode" | "cursor" | "grok" | "demo";
/**
  A tool Liner Code drives. Besides the built-in ones: another account of one ("claude.work", its
  own config folder and sign-in) and an ACP agent you added ("acp.gemini"), from the registry or
  as a command of your own.
*/
export type ProviderId = BuiltinProvider | `${BuiltinProvider | "acp"}.${string}`;
/** "claude.work" → "claude": which tool an account is of. Agents you added are "acp". */
export function familyOf(id: ProviderId): BuiltinProvider | "acp" {
  return id.split(".")[0] as BuiltinProvider | "acp";
}

/**
  What a session may do without asking, from least to most:
  read (reads and answers), ask (asks before every command and edit), edits (edits files, asks
  before commands), auto (a reviewer approves routine steps and asks you about the rest),
  full (acts, and tells you; destructive commands still ask while the guard is on).
*/
/**
  What an agent may do on its own. `auto` is the tool's own auto mode (Claude Code's classifier,
  Codex judging when to ask); `review` hands each step it would ask about to the Reviewer, another
  model family, which lets routine ones go ahead and passes the rest to you.
*/
export type Access = "read" | "ask" | "edits" | "auto" | "review" | "full";
export const ACCESS: Access[] = ["read", "ask", "edits", "auto", "review", "full"];
/** How hard it thinks, by the tool's own name for it: low, medium, high, xhigh, max, and Claude Code's ultracode and ultrathink. */
export type Effort = string;
export type EffortInfo = { id: string; label: string; description?: string };

/** A model as its tool reports it. `id` is what the tool takes; `group` is where it comes from inside the tool (an ACP agent's provider). */
export type ModelInfo = {
  id: string;
  label: string;
  description: string;
  /** The effort levels the tool accepts for this model, lowest first. None: it doesn't take one. */
  efforts?: EffortInfo[];
  defaultEffort?: string;
  /** Older models, folded away in the picker. */
  legacy?: boolean;
  group?: string;
  /** What the tool picks when you don't. */
  isDefault?: boolean;
  /** A model id you added that the tool doesn't list. */
  custom?: boolean;
};

/** On a Mac without Apple's command line tools, /usr/bin/git and /usr/bin/python3 are stubs that pop an installer. */
/** What agents need on this Mac. `rg`: ripgrep, which agents search code with; `rgInstall` when it's missing and Homebrew can add it. */
export type SystemCheck = { git: boolean; python: boolean; clt: boolean; install?: string; rg: boolean; rgInstall?: string };

export type ProviderInfo = {
  id: ProviderId;
  label: string;
  /** Installed and runnable on this machine. */
  available: boolean;
  /** Liner Code can drive it. Detected tools without an adapter yet show as coming soon. */
  adapter: boolean;
  /** The command that signs it in, shown on the setup screen. */
  login: string;
  /** What the tool's own status command says (`claude auth status`, `codex login status`); unset when it has none. */
  signedIn?: boolean;
  version?: string;
  /** Why it is unavailable, or how it is signed in. */
  detail?: string;
  /** How to install it, when it is missing. */
  install?: string;
  models: ModelInfo[];
  /** "cli" when the tool itself listed them (then `modelsAt` says when), "builtin" when it couldn't. */
  modelsFrom?: "cli" | "builtin";
  modelsAt?: number;
  supports: { approvals: boolean; resume: boolean; effort: boolean; plan: boolean };
  /** Another account of a tool: its name ("Work"), beside the tool's own label. */
  account?: string;
  /** An ACP agent you added: from the registry, or a command of your own. */
  added?: "registry" | "local";
};

/**
  Another account of a tool: its own config folder (Claude Code's CLAUDE_CONFIG_DIR, Codex's
  CODEX_HOME, Hermes's HERMES_HOME), so it signs in apart, plus any variables it needs (a router's
  base URL) and, when it runs a different copy of the tool, that copy's path.
*/
export const ACCOUNT_HOME: Partial<Record<BuiltinProvider, string>> = { claude: "CLAUDE_CONFIG_DIR", codex: "CODEX_HOME", hermes: "HERMES_HOME" };
export type ToolAccount = { id: string; provider: BuiltinProvider; label: string; home?: string; env?: Record<string, string>; binary?: string };
/** An ACP agent you added. `command` runs it; it speaks ACP on stdio. */
export type AddedAgent = { id: string; label: string; command: string[]; env?: Record<string, string>; from: "registry" | "local"; registryId?: string; version?: string; description?: string };
/** A model id a tool takes but doesn't list. */
export type CustomModel = { provider: ProviderId; id: string; label?: string };
/** An agent in the ACP registry, and how Liner Code would run it here. */
export type RegistryAgent = {
  id: string;
  name: string;
  version: string;
  description: string;
  website?: string;
  /** npx and uvx run it from its package; binary is downloaded for this Mac. */
  how: "npx" | "uvx" | "binary";
  /** Runnable here: the package runner is installed, or there's a build for this Mac. */
  runnable: boolean;
  /** Already one of your tools. */
  added?: ProviderId;
};

export type AgentGlyph = "sun" | "leaf" | "moon" | "pen" | "shapes" | "code" | "scope" | "lens" | "spark";
export type Specialty = "designer" | "coder" | "debugger" | "researcher" | "writer" | "custom";

/** An agent you open threads with. `model` is "<provider>:<model id>", like "claude:claude-opus-5-5". */
export type AgentProfile = {
  id: string;
  name: string;
  role: string;
  glyph: AgentGlyph;
  specialty: Specialty;
  model: string;
  effort: Effort;
  /** Appended to the provider's own system prompt. */
  soul: string;
  /** Added to every turn, after the soul. */
  prompt?: string;
  /**
    skill.md files it reads when a task calls for one. An absolute path is one of yours, the same
    in every project; a relative one is looked for in each session's project.
  */
  skills?: string[];
  /** Files read at the start of each session and handed to it: absolute paths, or relative to each project. */
  contextFiles?: string[];
  /** What it may change on its own in a new session; the session can lower it. */
  access?: Access;
  /**
    How it runs (Claude Code only): "helpers" keeps its model and sends reading and tests to
    cheap subagents; "escalate" runs on Sonnet and asks Opus only for the hard parts; "single"
    is the model alone.
  */
  runMode?: RunMode;
  /** Its subagents: the Explorer and Test runner's models, and who reviews its work (null: nobody). */
  subagents?: { explorer?: string; tests?: string; reviewer?: string | null };
};
export type RunMode = "helpers" | "escalate" | "single";

/** Your own team before setups (read once, to make your first setup from it). */
export type TeamPlan = { lead: string | null; writer: string; crew: string[] };

/** One stage of the writing in a setup: who writes (an agent's id, or "@<provider>:<model>" for a model on its own) and what its part is. */
export type Stage = { who: string; job: string };

/**
  A way of working you set up and named (Settings › Agentic features). `lead` takes your message
  and plans (null: straight to the first stage). `stages` write in order: the first builds, each
  next one takes the change on with its own job. `crew` are agents the lead may give a plan step
  to. `checks` is who reads the whole change ("auto": another model family than the last stage's;
  null: nobody) and how many rounds it may send back.
*/
export type Setup = { id: string; name: string; lead: string | null; stages: Stage[]; crew: string[]; checks: { by: string | null; rounds: number } };

/**
  Your setups as they stand: the saved ones, minus agents that are gone. Before you saved any
  (or when none still works), your old team or your coder alone is the first, "My team".
*/
export function setupsOf(settings: Pick<Settings, "setups" | "team" | "reviewRounds">, agents: AgentProfile[]): Setup[] {
  const real = agents.filter((a) => a.id !== "demo");
  const ok = (id?: string | null): id is string => Boolean(id && (id.startsWith("@") || real.some((a) => a.id === id)));
  const clean = (s: Setup): Setup | null => {
    const stages = s.stages.filter((x) => ok(x.who));
    if (!stages.length) return null;
    const lead = ok(s.lead) && s.lead !== stages[0].who ? s.lead : null;
    const crew = lead ? [...new Set(s.crew)].filter((id) => !id.startsWith("@") && ok(id) && !stages.some((x) => x.who === id) && id !== lead) : [];
    return { ...s, lead, stages, crew, checks: { by: s.checks?.by === undefined ? "auto" : s.checks.by, rounds: Math.min(3, Math.max(1, s.checks?.rounds ?? 2)) } };
  };
  // With none left that still work (their agents are gone), your coder alone comes back as "My team".
  const saved = (settings.setups ?? []).map(clean).filter((s): s is Setup => Boolean(s));
  if (saved.length) return saved;
  const writer = ok(settings.team?.writer) ? settings.team.writer : (real.find((a) => a.specialty === "coder") ?? real[0])?.id;
  if (!writer) return [];
  const first = clean({ id: "mine", name: "My team", lead: settings.team?.lead ?? null, stages: [{ who: writer, job: "" }], crew: settings.team?.crew ?? [], checks: { by: "auto", rounds: settings.reviewRounds ?? 2 } });
  return first ? [first] : [];
}

/** The setup new sessions start with under "My team": the one you picked, or your first. */
export const setupOf = (settings: Pick<Settings, "setups" | "team" | "reviewRounds" | "setup">, agents: AgentProfile[], id = settings.setup) => {
  const all = setupsOf(settings, agents);
  return all.find((s) => s.id === id) ?? all[0];
};

/**
  Routed (after GitHub Copilot's Fusion): for each message, the least work likely to do it well.
  single: one model does it. cascade: the everyday model does it and a judge from another family
  reads the change; it passes, or goes with the judge's findings to the strong model to repair,
  and the judge reads the repair once. critique: the strong model does it, critics from other
  families read it side by side, and it revises once with what they found. The level is how far
  it may go: standard keeps to one model a message (the strong one for hard jobs), high adds the
  cascade for medium jobs and a critic for hard ones, max checks everything and brings two
  critics to the hardest.
*/
export type RouteLevel = "standard" | "high" | "max";
export type RoutePattern = "single" | "cascade" | "critique";
/** How big a job a message looks: light (talk, a small change), medium, heavy. */
export type RouteWeight = "light" | "medium" | "heavy";
/** Who does what in a routed session, each "<provider>:<model>". */
export type RouteCast = { everyday: string; strong: string; judge: string; critics: string[] };
/** A routed session: its level and cast, the model writing now (`root`), and what the last message got. */
export type ThreadRoute = { level: RouteLevel; cast: RouteCast; root: string; last?: { at: number; weight: RouteWeight; pattern: RoutePattern; escalated?: boolean } };
export const ROUTE_LEVELS: { id: RouteLevel; label: string; note: string }[] = [
  { id: "standard", label: "Standard", note: "One model a message: the everyday one, the strong one for hard jobs" },
  { id: "high", label: "High", note: "Medium jobs get a judge that passes them or hands them up; hard ones a critic" },
  { id: "max", label: "Max", note: "Everything is checked; the hardest jobs get two critics" },
];

/**
  The cast from what's ready, paired the way Fusion pairs them: a quick model for everyday work
  (GPT Luna, else Sonnet), the strongest of another family for hard jobs and repairs (Opus, else
  GPT Sol), a judge from another family than the everyday model's, and critics from families
  other than the strong model's. `mine` (Settings) replaces any of them.
*/
export function castOf(providers: ProviderInfo[], mine: Partial<RouteCast> = {}): RouteCast | null {
  const ready = providers.filter((p) => p.available && p.adapter && p.id !== "demo" && p.models.length);
  if (!ready.length) return null;
  const pick = (family: string, ...want: RegExp[]) => {
    for (const re of want) for (const p of ready) if (familyOf(p.id) === family) for (const m of p.models) if (!m.legacy && re.test(m.id)) return `${p.id}:${m.id}`;
    return undefined;
  };
  const first = `${ready[0].id}:${(ready[0].models.find((m) => m.isDefault) ?? ready[0].models[0]).id}`;
  const best = (family: string) => (family === "claude" ? pick("claude", /opus/i, /sonnet/i) : family === "codex" ? pick("codex", /sol(?!.*pro)/i, /sol/i, /luna/i) : undefined);
  // Your picks count while their tool is ready; one that isn't falls back to the automatic choice.
  const ok = (ref?: string) => (ref && ready.some((p) => p.id === splitModel(ref).provider) ? ref : undefined);
  const everyday = ok(mine.everyday) ?? pick("codex", /luna(?!.*pro)/i) ?? pick("claude", /sonnet/i) ?? first;
  const strong = ok(mine.strong) ?? best("claude") ?? best("codex") ?? everyday;
  const family = (ref: string) => familyOf(splitModel(ref).provider);
  const other = (ref: string) => (family(ref) === "claude" ? best("codex") : best("claude"));
  const judge = ok(mine.judge) ?? (family(strong) !== family(everyday) ? strong : (other(everyday) ?? strong));
  // Reads from outside the strong model's family where there is one: its best, and the everyday model when that's another one.
  const outside = other(strong);
  const second = family(everyday) !== family(strong) ? everyday : undefined;
  const yours = (mine.critics ?? []).filter((c) => ok(c));
  const critics = yours.length ? [...new Set(yours)] : outside ? [...new Set([outside, second ?? outside])] : [everyday];
  return { everyday, strong, judge, critics };
}

export type Project = {
  id: string;
  name: string;
  path: string;
  /** Who a new thread in this project starts with. */
  agent?: string;
  /** Runs in each new worktree before its first turn, like "npm install". */
  setup?: string;
  /** Named commands with a run button (a dev server, the tests); some also run in each new worktree. */
  scripts?: ProjectScript[];
  git: boolean;
  /** When the last commit was made, for the project list. */
  lastCommitAt?: number;
  branch?: string;
  /** Its GitHub repository, as "owner/name", when origin points there. */
  remote?: string;
  createdAt: number;
};

/** limited: the tool's plan ran out mid-turn; Resume carries on once it resets. */
export type ThreadStatus = "idle" | "running" | "waiting" | "done" | "error" | "limited";

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  /** Tokens in the context at the end of the last turn, and the window, when the provider says. */
  contextTokens?: number;
  contextWindow?: number;
};

export type Thread = {
  id: string;
  projectId: string;
  title: string;
  /** Who works on it. In a lead-and-coder session this is the coder. */
  agent: string;
  /** In a lead-and-coder session, the agent who plans first; you approve, then `agent` builds. */
  lead?: string;
  /** Who took the last turn: the lead while it plans and its plan waits on you, then the coder. */
  turnBy?: string;
  status: ThreadStatus;
  access: Access;
  /** Overrides the agent's model for this thread. */
  model?: string;
  effort?: Effort;
  forkOf?: string;
  archived?: boolean;
  /** Where you put a session: Pinned on top, Snoozed until a time, or settled (`done`), out of the way until it's busy again. Only you settle a session, unless you turned on a rule that does. */
  pinned?: boolean;
  snoozedUntil?: number;
  done?: boolean;
  /** Changes from finished turns that you haven't committed or undone yet. */
  toReview?: number;
  /** A turn finished while you were looking elsewhere. */
  unread?: boolean;
  /** Messages you wrote while it worked, sent in order when the turn ends. */
  queue?: QueuedMessage[];
  /** Agents the lead may hand steps to, besides the coder. */
  helpers?: string[];
  /** The Reviewer's last word on this session's changes. */
  verdict?: { state: "checking" | "verified" | "blocked"; note?: string; round: number };
  /** Your own sidebar group. */
  group?: string;
  /** Snoozed until something happens rather than a time. */
  wake?: { kind: "checks" | "reply"; pr: number };
  /** One of several models given the same ask, to compare and keep one. */
  compare?: { id: string; base: string };
  /** The pull request this session's branch opened. */
  pr?: { number: number; url: string; state: string };
  /** A routine's run. */
  routine?: { id: string; run: string };
  /**
    One way's run in a cost test (Settings › Agentic features): the same small task in each way,
    with nobody watching, so its plan is approved as it stands and commands are declined.
    `finished` is when its last turn (and the Reviewer) ended; `failed` says why it stopped short.
  */
  trial?: { id: string; way: string; at: number; finished?: number; failed?: string };
  /**
    Started from one of your setups: its name, the stages that write in turn (the first is
    `agent`), and who checks the whole change and for how many rounds.
  */
  setup?: { id: string; name: string };
  stages?: Stage[];
  checks?: { by: string | null; rounds: number };
  /** Routed: each message gets its own pattern and models (see ThreadRoute); `agent` is the everyday model. */
  route?: ThreadRoute;
  /**
    Runs in a worktree of its own, on this branch. `path` is where it works; for a project inside
    a bigger repository that is the project's folder within the worktree, whose top is `root`.
  */
  worktree?: { path: string; branch: string; root?: string };
  /** Why it's limited and when the window reopens, while `status` is "limited". */
  limit?: { message: string; until?: number; provider: string };
  /** A goal it keeps working toward across turns (/goal), until it says the goal is met. */
  goal?: { text: string; status: "active" | "met" | "stopped"; turns: number; max: number };
  /** The provider's own session id, for resume. */
  providerSession?: string;
  /** The lead's own provider session, in a lead-and-coder session. */
  leadSession?: string;
  /** A fork's first turn: the parent's provider session it continues from. */
  forkSession?: string;
  /**
    A side chat beside the session `sideOf`: a fork of it that only reads and answers, so you can
    ask about the session without stopping it or adding to it. It knows the session up to turn
    `sideFrom`; its own turns come after. It never shows in the sidebar.
  */
  sideOf?: string;
  sideFrom?: number;
  turns: number;
  usage: Usage;
  /** Where the spending cap stops this session now: the cap, plus another cap's worth each time you go on past it. */
  spendLimit?: number;
  createdAt: number;
  updatedAt: number;
};

export type QueuedMessage = { id: string; text: string; at: number };
export type Question = { question: string; header?: string; options: { label: string; description?: string; suggested?: boolean }[]; multiSelect?: boolean };

export type ToolKind = "read" | "edit" | "write" | "exec" | "search" | "fetch" | "think" | "task" | "web" | "other";
export type FileChange = { path: string; status: "added" | "modified" | "deleted" | "renamed"; added: number; removed: number; from?: string };
export type PlanEntry = { title: string; status: "pending" | "in_progress" | "completed" };
export type Risk = "low" | "medium" | "high";

type Base = { id: string; turn: number; at: number };
export type Item =
  | (Base & {
      kind: "turn";
      /** Who worked this turn and on what, for the line above its work. */
      agent: string;
      model: string;
      /** A lead's turn, which ends in a plan rather than in edits. */
      planning?: boolean;
      status: "running" | "done" | "stopped" | "error";
      seconds?: number;
    })
  | (Base & {
      kind: "user";
      text: string;
      files?: string[];
      steer?: boolean;
      /** Asked about lines in the diff: the agent's answer belongs to this place. */
      anchor?: { file: string; line: number; endLine?: number };
    })
  | (Base & {
      kind: "review";
      /** Who reviewed, as "<provider>:<model>". */
      reviewer: string;
      round: number;
      status: "running" | "passed" | "blocked" | "error";
      findings: Finding[];
      summary?: string;
      seconds?: number;
    })
  | (Base & { kind: "text"; text: string; streaming: boolean })
  | (Base & { kind: "reasoning"; text: string; streaming: boolean; seconds?: number })
  | (Base & {
      kind: "tool";
      /** The provider's tool name, in mono: Bash, Edit, mcp__github__create_pr. */
      tool: string;
      toolKind: ToolKind;
      /** What it is doing, in words: "Run npm test", "Edit src/app.ts". */
      title: string;
      input?: string;
      output?: string;
      status: "running" | "done" | "failed";
      seconds?: number;
      path?: string;
    })
  | (Base & { kind: "plan"; entries: PlanEntry[] })
  /** A page the agent showed you: a chart, a table, a mockup. It runs sandboxed, in the app's colours. */
  | (Base & { kind: "page"; title: string; html: string })
  /** You asked for a pull request in the chat: Liner's PR card opens it there. `demo` plays the story on the sample project. */
  | (Base & { kind: "pr"; demo?: boolean })
  | (Base & {
      kind: "approval";
      tool: string;
      title: string;
      description?: string;
      risk: Risk;
      fields: { label: string; value: string }[];
      state: "asking" | "approved" | "denied" | "expired";
      reason?: string;
      /** What "Don't ask again" would allow for the rest of the session, like "pnpm test". */
      rule?: string;
      /** The tool call it was for: once answered, it folds into that call's row. */
      toolId?: string;
      /** The Reviewer's model, when it decided instead of you (Reviewer decides). */
      reviewer?: string;
    })
  | (Base & { kind: "question"; questions: Question[]; state: "asking" | "answered" | "skipped" | "expired"; answers?: Record<string, string> })
  | (Base & { kind: "proposal"; title: string; plan: string; state: "asking" | "approved" | "changed" | "expired"; note?: string })
  | (Base & {
      kind: "checkpoint";
      files: FileChange[];
      /** The snapshots before and after the turn (git commits under refs/liner/). */
      from?: string;
      to?: string;
      reverted?: boolean;
      /** The commit these changes went into, once you committed them. */
      committed?: string;
      /** Files from this turn already committed with only some others: `files` keeps the rest, so they're what's left to commit or undo. */
      done?: FileChange[];
      seconds?: number;
    })
  | (Base & { kind: "error"; message: string })
  /** `fallback`: another ready tool's model that can carry on (another account of the same tool first). */
  | (Base & { kind: "limit"; message: string; until?: number; provider: string; fallback?: string })
  | (Base & { kind: "notice"; text: string });

export type ItemKind = Item["kind"];
/** The PR card's own tool: its run of the project's tests on this Mac, and the request to run them. */
export const PR_TEST_TOOL = "liner.test";
export type PrTestResult = { state: "passed" | "failed" | "skipped"; command?: string; summary: string; seconds?: number };
export type Finding = { file: string; line?: number; endLine?: number; severity: "blocking" | "note"; note: string };

/** One file's before and after, for the diff card. */
export type FileDiff = { path: string; before?: string; after?: string; from?: string };

export type Settings = {
  /** You've been through the first run. */
  onboarded: boolean;
  /** Just a model, a lead and a coder, or your own team. */
  workStyle: "model" | "lead" | "team";
  /** Before setups: who did what under "My team". Read once to make your first setup. */
  team?: TeamPlan;
  /** Ways of working you set up and named; `setup` is the one new sessions start with when `workStyle` is "team". */
  setups?: Setup[];
  setup?: string;
  /** How many times the Reviewer sends blocking findings back before it's yours (default 2). */
  reviewRounds?: number;
  /** The Reviewer reads small changes too (SMALL_CHANGE lines or fewer, or only docs), which it otherwise lets through. */
  reviewSmall?: boolean;
  /** Agents outside Liner Code (Claude Code or Codex in a terminal) may list, read, start and message sessions, through its MCP server. */
  outside?: boolean;
  /** When a tool runs out of usage mid-session: wait for it to reset (the default), or carry on with another ready tool. */
  onLimit?: "wait" | "carry";
  /** Routed sessions: the level new ones start at (high unless set), and models of your own in place of the cast's. */
  route?: { level?: RouteLevel; cast?: Partial<RouteCast> };
  /** Claude Code bills to your Claude plan, or to the Anthropic key you added. */
  claudeBilling: "plan" | "key";
  /** Settle sessions that wait on nothing from you after this many days (0: never, the default). */
  settleDays: number;
  /** Where to start from when you add a project. */
  projectsRoot?: string;
  /** Notify when a thread needs you or finishes while the app is in the background. */
  notify: boolean;
  /** Even in Full access, commands that can't be undone come back to you. */
  guardDestructive: boolean;
  /** What a new session may do without asking, until you change it in the session. */
  defaultAccess: Access;
  /** New sessions in a Git project start in a worktree of their own instead of this checkout. */
  worktrees: boolean;
  /** What a new worktree's branch starts with, before the session's id. */
  branchPrefix: string;
  /** The Dock icon counts the sessions that need you. */
  badge: boolean;
  /** A monthly budget in dollars, for the Usage page's pace line (0: none). */
  budgetUsd?: number;
  /** What one session, or one routine run, may spend before it stops and asks, in dollars (0: no cap). Only tools that report cost (Claude Code) can be held to it. */
  capUsd?: number;
  /** Keeps the Mac from sleeping while an agent works (on unless turned off). */
  keepAwake?: boolean;
  /** The menu bar item: what works and what needs you (on unless turned off). */
  menuBar?: boolean;
  /** Settle a session when its pull request merges, or when a routine run handled everything itself. Off unless you turn them on. */
  settleOnMerge?: boolean;
  settleOnRoutine?: boolean;
  /** 2 once settling became yours to do: the old defaults that settled sessions by themselves were switched off once. */
  settleVersion?: number;
  /** Where new worktrees go (default: the Liner Code home's worktrees folder). */
  worktreeRoot?: string;
  /** Keep each project's default-branch checkout pulled (fast-forward only, when it's clean). */
  autoPull?: boolean;
  /** Models you starred, as "<provider>:<model>", first in every model picker. */
  favoriteModels?: string[];
  /** More accounts of a tool, each its own entry in the model picker. */
  accounts?: ToolAccount[];
  /** ACP agents you added. */
  addedAgents?: AddedAgent[];
  /** Model ids you added to a tool's list. */
  customModels?: CustomModel[];
  /** Your shortcuts, the way VS Code writes keybindings.json: keys for a command in place of its own, "-command" to take its keys away. */
  keybindings?: KeyBinding[];
  /** Liner Code's own releases: downloaded and put in when you quit or restart ("auto", the default), only told about, or not looked for. */
  updateApp?: UpdateMode;
  /** The agent tools' own updaters: run when no session is working on that tool, only told about ("notify", the default), or not looked for. */
  updateTools?: UpdateMode;
  /** The Demo (Demo run, its model, the sample project): hidden until you tap your name in the sidebar six times. */
  showDemo?: boolean;
};

export type UpdateMode = "auto" | "notify" | "off";

/**
  A project's rules for agents, at its root: CLAUDE.md for Claude Code, AGENTS.md for Codex,
  OpenCode, Cursor and the rest. `linked`: CLAUDE.md only imports AGENTS.md (`@AGENTS.md`), so
  the two say the same.
*/
export type ProjectRules = { claude?: string; agents?: string; linked: boolean };

/** A past Claude Code or Codex session in a project's folder, that can be brought in to carry on here. */
export type ImportableSession = { tool: "claude" | "codex"; id: string; title: string; at: number };

/** One row of what fills a session's context, as its tool counts it. "deferred" rows sit outside the window. */
export type ContextPart = { name: string; tokens: number; kind: "used" | "free" | "buffer" | "deferred" };

/** What the Session surface shows from the engine: where a session runs, and what fills its context. */
export type SessionInfo = {
  machine: string;
  project: string;
  /** The folder the agent works in: the project, or the session's worktree. */
  path: string;
  worktree: boolean;
  branch?: string;
  /** The tool (its name and id) and the model the writer runs on. */
  tool: string;
  provider: ProviderId;
  model: string;
  access: Access;
  /** A session is open in the tool, so the context is what it says now. */
  live: boolean;
  /** From the tool now, by part (`measured`), or the last turn's total. None before the first turn. */
  context?: { used: number; max: number; parts: ContextPart[]; measured: boolean };
  /** The tool compacts on request: the Compact button sends it `/compact`. */
  compact: boolean;
};

/** A change this many lines or under (added and removed together) is small: the Reviewer lets it through unless `reviewSmall`. */
export const SMALL_CHANGE = 6;

/** A change the Reviewer lets through: a few lines, or only docs. From `git diff --numstat` ("3\t1\tsrc/a.ts" a line; "-" for a binary). */
export function smallChange(numstat: string) {
  const files = numstat.split("\n").filter(Boolean).map((l) => l.split("\t"));
  if (!files.length) return true;
  const docs = files.every((f) => /\.(md|mdx|txt|rst|adoc)$/i.test(f[2] ?? "") || /^docs\//.test(f[2] ?? ""));
  const lines = files.reduce((n, f) => n + (f[0] === "-" ? Infinity : Number(f[0]) + Number(f[1])), 0);
  return docs || lines <= SMALL_CHANGE;
}

/** The update settings as they stand. Liner Code updates itself; the tools are yours, so it only says when one has something new until you choose Automatically. */
export const updateModes = (s: Pick<Settings, "updateApp" | "updateTools">): { app: UpdateMode; tools: UpdateMode } => ({ app: s.updateApp ?? "auto", tools: s.updateTools ?? "notify" });

/** Liner Code against its latest release on GitHub. */
export type AppUpdate = {
  current: string;
  /** "owner/name", where releases come from. None: this copy has no release feed. */
  repo?: string;
  latest?: string;
  /** The release's notes (Markdown) and its page. */
  notes?: string;
  url?: string;
  publishedAt?: number;
  state: "idle" | "current" | "available" | "downloading" | "ready" | "failed";
  /** 0–1 while it downloads, and the download's size in bytes. */
  progress?: number;
  size?: number;
  /**
    Whether this copy can put a new one in its own place: "install"; "source" runs from the repo
    (pull and build instead); "readonly" sits in a folder you can't write to; "translocated" runs
    from where macOS put a downloaded app that wasn't moved to Applications.
  */
  can: "install" | "source" | "readonly" | "translocated";
  error?: string;
  /** "failed" because this version downloaded but couldn't take this copy's place: it comes from the release page, by hand. */
  stuck?: boolean;
};

/** One agent tool: what's here, what's out, and how its update is going. */
export type ToolUpdate = {
  id: BuiltinProvider;
  label: string;
  current?: string;
  latest?: string;
  /** The tool's own updater, as Liner Code runs it ("claude update"). */
  command: string;
  /** waiting: asked for, until the sessions working on it finish (`busy` of them). */
  state: "current" | "available" | "waiting" | "updating" | "updated" | "failed";
  busy?: number;
  /** After an update: the version it came from. */
  from?: string;
  error?: string;
  at?: number;
  /** While updating: how far, 0 to 1, when the updater says (a percentage, or "12 MB / 40 MB"). */
  progress?: number;
  /** While updating: the last line the updater printed, like "Downloading 2.1.312". */
  step?: string;
};

export type Updates = {
  checkedAt?: number;
  checking: boolean;
  app: AppUpdate;
  tools: ToolUpdate[];
  /** What you put away, by "app" or tool id: the version, so a newer one shows again. */
  dismissed: Record<string, string>;
};

/** "mod+shift+b" for "surface.browser"; `when` narrows where it works ("session", "composer && !review"). */
export type KeyBinding = { key: string; command: string; when?: string };

/** A project's command with a run button; `key` runs it from the keyboard in a session ("mod+shift+1"). */
export type ProjectScript = { id: string; name: string; command: string; onWorktree?: boolean; key?: string };
export type SidebarGroup = { id: string; name: string };

/* Routines: work that runs on its own. Models read and report; code in the engine decides. */
export type Trigger =
  | { kind: "schedule"; every: "hour" | "day" | "weekday" | "week"; at?: string; day?: number }
  | { kind: "github"; event: "pr.opened" | "issue.opened"; outside?: boolean }
  | { kind: "webhook"; secret: string }
  | { kind: "manual" };
export type GateRule = { kind: "checks" } | { kind: "reviewer" } | { kind: "maxLines"; n: number } | { kind: "paths"; deny: string[] } | { kind: "knownAuthor" };
export type RoutineStep =
  | { kind: "ai"; role: "read" | "work" | "audit"; agent: string; prompt: string }
  | { kind: "gate"; rules: GateRule[] }
  | { kind: "action"; action: "merge" | "comment" | "label" | "close" | "inbox" | "notify"; arg?: string; when: "pass" | "fail" | "always" };
export type Routine = {
  id: string;
  name: string;
  on: boolean;
  projectId: string;
  trigger: Trigger;
  steps: RoutineStep[];
  /** Each run starts its own session, or adds a turn to one session. */
  runsGo: "own" | "one";
  threadId?: string;
  /** Pause after this many failures in a row (0: never). */
  pauseAfter: number;
  /** Most merges a day, and most tokens a run. */
  limits: { mergesPerDay: number; tokensPerRun: number };
  failures: number;
  lastRun?: number;
  nextRun?: number;
  createdAt: number;
};
export type RunStep = { label: string; detail?: string; model?: string; status: "running" | "done" | "failed" | "skipped"; seconds?: number; at: number };
export type RoutineRun = {
  id: string;
  routineId: string;
  at: number;
  /** What started it, in words: "Oskar opened #140", "Mondays at 9:00". */
  cause: string;
  status: "running" | "merged" | "handed" | "done" | "failed";
  outcome?: string;
  steps: RunStep[];
  threadId?: string;
  /** The pull request or issue it was about. */
  subject?: { kind: "pr" | "issue"; number: number; title: string; author?: string; url?: string };
  rules?: { label: string; ok: boolean; detail?: string }[];
  seconds?: number;
  tokens?: number;
  /** A test: it reads, audits and checks the gate, then says what it would have done. */
  test?: boolean;
};

/* Surfaces beside a session. */
export type PrInfo = {
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  isDraft: boolean;
  head: string;
  base: string;
  additions: number;
  deletions: number;
  author?: string;
  mergeable?: string;
  reviewDecision?: string;
  commits: { sha: string; title: string }[];
  checks: { name: string; state: "pass" | "fail" | "pending" | "skipped"; detail?: string }[];
  reviews: { author: string; state: string; at?: string }[];
  requested: string[];
  threadId?: string;
};
/** What a pull request card draws: your commits over the base, what reached the base since, and where they clash. */
export type PrPicture = {
  branch: string;
  base: string;
  ahead: number;
  behind: number;
  branchCommits: { sha: string; title: string }[];
  baseCommits: { sha: string; title: string; who: string; when: string }[];
  /** One pair of lines per clash: the base's and yours, numbered in your file. */
  conflicts: { id: string; file: string; line: number; base: string; yours: string }[];
  diff: { add: number; del: number };
};
export type Device = { udid: string; name: string; runtime: string; state: string };

export type UsageRecord = { at: number; threadId: string; projectId: string; agent: string; provider: ProviderId; model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; costUsd: number; seconds: number };
export type UsageSummary = {
  from: number;
  to: number;
  totals: { costUsd: number; tokens: number; turns: number; cacheShare: number; perTurn: number; priciest?: { costUsd: number; title: string } };
  days: { day: string; costUsd: number; tokens: number; turns: number }[];
  byAgent: { agent: string; costUsd: number; tokens: number; turns: number }[];
  byModel: { model: string; provider: ProviderId; tokens: number; cacheShare: number; costUsd: number }[];
};
/**
  How each way of working went in your own sessions, sorted by how each session ran: a model on
  its own ("model"), a lead and a coder ("lead"), or one of your setups (its id; sessions from
  before setups count as your first, "mine"). A changed turn is kept when you didn't undo it.
*/
export type WayStats = { way: string; sessions: number; turns: number; changed: number; kept: number; costUsd: number; seconds: number; reviewed: number; firstPass: number };

/** The cost test's project (two short files) and its one small task, the same for every way. */
export const TRIAL = {
  files: {
    "math.js": "export function add(a, b) {\n  return a + b;\n}\n",
    "README.md": "# Math\n\nSmall helpers.\n\n- `add(a, b)`: adds two numbers.\n",
  } as Record<string, string>,
  task: "Add a `multiply(a, b)` function to math.js, next to `add`, and list it in README.md the way `add` is listed. Keep it small, and don't run any commands.",
};

/** A slash command the tool (or Liner Code) understands, and a skill it can use. */
export type CommandInfo = { name: string; description: string; hint?: string; source: "tool" | "liner" };
export type SkillInfo = { name: string; description: string; path?: string };
/** One commit as a list shows it: its short sha, its subject, when, and its added and removed lines. */
export type GitCommit = { sha: string; subject: string; at: number; added?: number; removed?: number };
export type LimitWindow = { label: string; usedPercent: number; resetsAt?: number };
export type ToolLimits = { provider: ProviderId; label: string; plan?: string; windows: LimitWindow[]; detail?: string; at: number };
export type FoundRepo = { path: string; name: string; branch?: string; lastCommitAt?: number; added: boolean; remote?: string };
/** A repository on GitHub you can reach, and the project it already is here, if any. */
export type GitHubRepo = { fullName: string; description?: string; private: boolean; url: string; pushedAt?: number; projectId?: string };

export type Snapshot = {
  version: string;
  /** Which API keys are set (by provider), never the keys themselves. */
  keys: string[];
  home: string;
  projects: Project[];
  threads: Thread[];
  agents: AgentProfile[];
  providers: ProviderInfo[];
  settings: Settings;
  groups: SidebarGroup[];
  routines: Routine[];
  runs: RoutineRun[];
  updates: Updates;
};

/** Engine → app, over the event stream. */
export type EngineEvent =
  | { type: "hello"; snapshot: Snapshot }
  | { type: "project"; project: Project }
  | { type: "project.removed"; id: string }
  | { type: "thread"; thread: Thread }
  | { type: "item"; threadId: string; item: Item }
  | { type: "delta"; threadId: string; itemId: string; text: string }
  /** A thread's whole timeline, after a rewind took turns off it. */
  | { type: "timeline"; threadId: string; items: Item[] }
  | { type: "agents"; agents: AgentProfile[] }
  | { type: "providers"; providers: ProviderInfo[] }
  | { type: "settings"; settings: Settings }
  | { type: "notify"; threadId: string; title: string; body: string; kind: "waiting" | "done" | "error" }
  | { type: "keys"; keys: string[] }
  | { type: "groups"; groups: SidebarGroup[] }
  | { type: "routine"; routine: Routine }
  | { type: "routine.removed"; id: string }
  | { type: "run"; run: RoutineRun }
  | { type: "term"; id: string; data: string }
  | { type: "term.exit"; id: string; code: number }
  | { type: "devlog"; udid: string; lines: string[] }
  | { type: "settled"; threadId: string; reason: string }
  | { type: "updates"; updates: Updates }
  /** An agent uses the session's Browser; the app answers with agent.browser.reply. */
  | { type: "agent.browser"; id: string; threadId: string; op: AgentBrowserOp; args: Record<string, unknown> };

export type AgentBrowserOp = "open" | "read" | "click" | "type" | "press" | "screenshot";

/** A server listening on this Mac, as the Browser sees it. */
export type LocalServer = { port: number; process: string; url: string; owner: "session" | "project" | null; web: boolean };

/** App → engine. Each method's params and result. */
export type Rpc = {
  "state.get": [Record<string, never>, Snapshot];
  "providers.refresh": [Record<string, never>, ProviderInfo[]];
  /** The ACP registry's agents (kept for a day), marked with what's runnable here and what you added. */
  "acp.registry": [{ force?: boolean }, { agents: RegistryAgent[]; at: number; error?: string }];
  /** Adds an agent from the registry (a binary one is downloaded and checked first), or a command of your own. */
  "acp.add": [{ registryId: string } | { label: string; command: string }, AddedAgent];
  "acp.remove": [{ id: string }, Settings];
  /** The app's answer to an agent.browser event. */
  "agent.browser.reply": [{ id: string; ok: boolean; value?: unknown; error?: string }, null];
  "project.add": [{ path: string; agent?: string }, Project];
  "project.update": [{ id: string; name?: string; agent?: string; setup?: string; scripts?: ProjectScript[] }, Project];
  /** The project's branches and worktrees, for starting a session from one. */
  "git.branches": [{ projectId: string }, { current?: string; base?: string; branches: { name: string; lastCommitAt?: number }[]; worktrees: { path: string; branch?: string; threadId?: string }[]; npmScripts: string[] }];
  /** Removes worktrees whose sessions are archived or gone. */
  "worktrees.clean": [{ projectId?: string }, { removed: number; kept: number }];
  "project.remove": [{ id: string }, null];
  "thread.create": [{ projectId: string; agent?: string; lead?: string; setup?: string; route?: RouteLevel; title?: string; forkOf?: string; id?: string; access?: Access; effort?: Effort; model?: string; worktree?: boolean; base?: string; inWorktree?: string }, Thread];
  "thread.update": [{ id: string; title?: string; archived?: boolean; access?: Access; model?: string; effort?: Effort; agent?: string; lead?: string | null; pinned?: boolean; snoozedUntil?: number | null; done?: boolean; unread?: boolean; helpers?: string[]; setup?: string | null; route?: RouteLevel | null; group?: string | null; wake?: { kind: "checks" | "reply"; pr: number } | null }, Thread];
  "thread.items": [{ id: string }, Item[]];
  /** Agents outside Liner Code: whether they may in, and the commands that add its MCP server to Claude Code and Codex. */
  "outside.info": [Record<string, never>, { on: boolean; claude: string; codex: string }];
  /** What agents remember about a project (memory_add), oldest first; add, and forget by place. */
  "memory.list": [{ projectId: string }, string[]];
  "memory.add": [{ projectId: string; fact: string }, string[]];
  "memory.forget": [{ projectId: string; index: number }, string[]];
  /** A project's earlier sessions, searched: your messages and the agents' answers. */
  "sessions.search": [{ projectId: string; query: string }, { threadId: string; title: string; at: number; who: "you" | "agent"; snippet: string }[]];
  /** A limited session carries on with another tool's model (`model`, else the one its limit card offers). */
  "thread.carryOn": [{ id: string; model?: string }, null];
  "thread.send": [{ id: string; text: string; files?: { name: string; data: string }[]; mode?: "queue" | "steer"; anchor?: { file: string; line: number; endLine?: number } }, null];
  "thread.queue": [{ id: string; queue: QueuedMessage[] }, Thread];
  /** Rewinds to just before a message you sent: the turns from there come off, and with `files`, so do their changes. */
  "thread.rewind": [{ threadId: string; itemId: string; files: boolean }, { turn: number; files: number }];
  "thread.remove": [{ id: string }, null];
  /** The session's side chat, started now if it has none; `fresh` starts it again from where the session is. */
  "thread.side": [{ id: string; fresh?: boolean }, Thread];
  "thread.stop": [{ id: string }, null];
  "approval.answer": [{ threadId: string; itemId: string; allow: boolean; reason?: string; always?: boolean }, null];
  "question.answer": [{ threadId: string; itemId: string; answers?: Record<string, string> }, null];
  "proposal.answer": [{ threadId: string; itemId: string; approve: boolean; note?: string; plan?: string }, null];
  "review.run": [{ threadId: string }, null];
  "checkpoint.diff": [{ threadId: string; itemId: string }, FileDiff[]];
  "checkpoint.revert": [{ threadId: string; itemId: string }, Item];
  /** Commits the session's open changes, or only `paths` of them. */
  "git.commit": [{ threadId: string; message?: string; paths?: string[] }, { sha: string; files: number }];
  /** Pushes the session's branch to origin, setting its upstream. */
  "git.push": [{ threadId: string }, { branch: string; remote: string }];
  /**
    What a push would send: the commits its remote hasn't got (before the first push, all since the
    base), newest first; the commit the branch left the base at (main, master, or the remote's
    HEAD); and how many commits ahead of the base it is.
  */
  "git.outgoing": [{ threadId: string }, { branch: string; remote: string | null; commits: GitCommit[]; base?: GitCommit & { branch: string }; ahead: number }];
  /** Switches the session's checkout to a branch, or to a new one made from where it is. */
  "git.switch": [{ threadId: string; branch: string; create?: boolean }, { branch: string }];
  /** The editors and terminals on this Mac that can open a folder, by bundle id. */
  "apps.editors": [Record<string, never>, { id: string; name: string; kind: "editor" | "terminal" }[]];
  /** What Liner Code needs from the Mac itself: Git (snapshots, undo, worktrees) and Python (the Terminal's pty). */
  "system.check": [Record<string, never>, SystemCheck];
  /** Opens a folder in one of them. */
  "apps.open": [{ path: string; app: string }, null];
  /** Pictures for behind the session: the landscapes this Mac keeps, and whether you've added one of your own. */
  "background.list": [Record<string, never>, { pictures: { id: string; name: string }[]; own: boolean }];
  /** One picture as a JPEG (base64), by id: "apple:<name>" or "own"; `dark` picks a dynamic wallpaper's night side. */
  "background.image": [{ id: string; dark?: boolean }, { data: string; type: string } | null];
  /** Keeps an image of your own (base64), made a JPEG. */
  "background.save": [{ data: string; name: string }, null];
  "background.remove": [Record<string, never>, null];
  /** A commit message written from the changes still to commit and what you asked for. */
  "git.message": [{ threadId: string }, { message: string; by: string }];
  /** A pull request title and description, from the branch's changes and the session. */
  "pr.draft": [{ threadId: string }, { title: string; body: string; by: string }];
  /** A question about a session's case on the Desk, answered by a quick model from the session and the case (`context`); the session itself carries on undisturbed. */
  "desk.ask": [{ threadId: string; question: string; context: string }, { answer: string; by: string }];
  /** The Session surface: where a session runs, and what fills its context. */
  "thread.info": [{ id: string }, SessionInfo];
  /** The session as Markdown (asks, plans, answers, findings, diffs), saved in Downloads; where it went. */
  "thread.export": [{ id: string }, { path: string }];
  /** Past Claude Code and Codex sessions in the project's folder, newest first. */
  "sessions.importable": [{ projectId: string }, ImportableSession[]];
  /** Brings one in as a session here: its timeline, and its own id, so the next turn carries it on. */
  "sessions.import": [{ projectId: string; tool: "claude" | "codex"; id: string }, Thread];
  /** A project's rules for agents, as its CLAUDE.md and AGENTS.md say them. */
  "project.rules": [{ id: string }, ProjectRules];
  /** Writes the rules to AGENTS.md and makes CLAUDE.md point to it, so every tool reads the same. */
  "project.rules.save": [{ id: string; text: string }, ProjectRules];
  "projects.scan": [{ roots?: string[] }, FoundRepo[]];
  "project.clone": [{ url: string; into?: string }, Project];
  "github.repos": [Record<string, never>, { gh: "ready" | "missing" | "signed-out"; detail?: string; login?: string; repos: GitHubRepo[] }];
  "usage.summary": [{ days?: number; projectId?: string }, UsageSummary];
  "ways.compare": [{ days?: number }, WayStats[]];
  "ways.trial": [{ ways: string[] }, Thread[]];
  /** Each signed-in plan's windows: how much is used and when it resets. */
  "usage.limits": [Record<string, never>, { tools: ToolLimits[] }];
  /** What `/` and `$` offer in the composer, for the tool an agent runs on in a project. */
  "agent.commands": [{ projectId: string; agent: string; threadId?: string }, { commands: CommandInfo[]; skills: SkillInfo[] }];
  /** The skill.md files an agent can be given: yours (Claude Code's and Codex's skills folders) and, with a project, its own. */
  "skills.list": [{ projectId?: string }, { yours: SkillInfo[]; project: SkillInfo[] }];
  "keys.set": [{ provider: string; key: string | null }, string[]];
  "machine.info": [Record<string, never>, { name: string; user: string; home: string }];
  "agents.save": [{ agents: AgentProfile[] }, AgentProfile[]];
  "settings.save": [Partial<Settings>, Settings];
  "fs.files": [{ projectId: string; query?: string; limit?: number }, { path: string; size: number }[]];
  "fs.tree": [{ projectId: string; threadId?: string }, TreeEntry[]];
  "fs.read": [{ threadId: string; path: string }, { text: string; size: number; binary: boolean }];
  "groups.save": [{ groups: SidebarGroup[] }, SidebarGroup[]];
  "compare.start": [{ projectId: string; text: string; files?: { name: string; data: string }[]; models: string[]; effort?: Effort; access?: Access }, Thread[]];
  "compare.keep": [{ threadId: string }, { files: number }];
  "project.scratch": [Record<string, never>, Project];
  "term.open": [{ threadId: string; cols: number; rows: number; command?: string }, { id: string; cwd: string }];
  "term.write": [{ id: string; data: string }, null];
  "term.resize": [{ id: string; cols: number; rows: number }, null];
  "term.close": [{ id: string }, null];
  "pr.status": [{ threadId: string }, { pr: PrInfo | null; branch?: string; ahead?: number; gh: "ready" | "missing" | "signed-out" | "no-remote"; detail?: string }];
  "pr.create": [{ threadId: string; title: string; body: string; draft: boolean }, PrInfo];
  "pr.list": [{ projectId: string }, { prs: PrInfo[]; gh: "ready" | "missing" | "signed-out" | "no-remote"; detail?: string }];
  "pr.merge": [{ projectId: string; number: number }, null];
  /** The branch against its base, fetched at most once a minute, for the pull request card. */
  "pr.picture": [{ threadId: string }, PrPicture];
  /** Runs the project's tests on this Mac for the PR card `itemId`, asking first as the session's access says. */
  "pr.test": [{ threadId: string; itemId: string }, PrTestResult];
  /**
    The servers listening on this Mac. With a session: whose each is (`session`: its agent or its
    Terminal started it; `project`: it runs in the session's folder), the session's first, and
    which answer with a page (`web`).
  */
  "ports.list": [{ threadId?: string }, LocalServer[]];
  /** Stops a dev server of the session's (never another app's); answers with the ports it stopped. */
  "ports.stop": [{ threadId: string; port: number }, number[]];
  /** A proxy onto a local port, for the Browser surface: the page reports its console and answers picks. */
  "browser.proxy": [{ port: number }, { url: string }];
  /** The session folder's own files, served for the Browser (no dev server needed): `path` as asked, in the folder, and its HTML pages. */
  "browser.files": [{ threadId: string; path?: string }, { url: string; path: string; pages: string[] }];
  "device.list": [Record<string, never>, { devices: Device[]; ready: boolean; detail?: string }];
  "device.boot": [{ udid: string }, null];
  "device.shot": [{ udid: string }, { png: string }];
  "device.appearance": [{ udid: string; mode: "light" | "dark" }, null];
  "device.log": [{ udid: string; filter?: string; on: boolean }, null];
  "routine.save": [{ routine: Omit<Routine, "id" | "createdAt" | "failures"> & { id?: string } }, Routine];
  "routine.remove": [{ id: string }, null];
  "routine.run": [{ id: string }, RoutineRun];
  "routine.test": [{ id: string; number?: number }, RoutineRun];
  "routine.stop": [{ runId: string }, null];
  "git.status": [{ projectId: string }, { branch?: string; ahead: number; behind: number; changes: FileChange[] }];
  /** Looks for a new Liner Code and new versions of the agent tools now. */
  "updates.check": [Record<string, never>, Updates];
  /** Downloads the new Liner Code and makes it ready for the shell to put in. */
  "updates.download": [Record<string, never>, Updates];
  /** Runs a tool's own updater (all the tools with one waiting, without `id`), once no session is working on it. */
  "updates.tool": [{ id?: BuiltinProvider }, Updates];
  /** Puts an update's notice away until a newer version comes out. */
  "updates.dismiss": [{ key: "app" | BuiltinProvider }, Updates];
};
export type RpcMethod = keyof Rpc;
export type RpcParams<M extends RpcMethod> = Rpc[M][0];
export type RpcResult<M extends RpcMethod> = Rpc[M][1];

export type TreeEntry = { path: string; dir: boolean; children?: TreeEntry[] };

/** Splits "claude:claude-opus-5-5" into its provider and model. */
export function splitModel(ref: string): { provider: ProviderId; model: string } {
  const i = ref.indexOf(":");
  const provider = (i < 0 ? ref : ref.slice(0, i)) as ProviderId;
  return { provider, model: i < 0 ? "" : ref.slice(i + 1) };
}

export const emptyUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 });

/** a is a later version than b, by their first "x.y.z" ("v0.2.0", "codex-cli 0.164.0"). */
export function newerVersion(a?: string, b?: string) {
  const parts = (s?: string) => /(\d+)\.(\d+)\.(\d+)/.exec(s ?? "")?.slice(1).map(Number);
  const x = parts(a);
  const y = parts(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
