/*
  Pull requests and issues across your projects, for the Pull requests and Issues pages (W3) and for apps through Liner's
  MCP server (mcp-tools.ts reuses listPrs and listIssues). GitHub's come from gh in each project's folder, as the PR card's
  already do (surfaces.ts); Linear's from its API with the key you added (sourcecontrol.ts keeps it in memory, scmKey).
  Projects are read a few at a time, and one that can't be read (gh missing or signed out, not on GitHub, gh failed) is
  named in `unavailable` with why, instead of failing the list.

  Each project's list is kept for about as long as Settings › Source control's refresh says (worklistRefresh), so pages
  that ask on a timer, and several pages at once, don't start gh again each time; `fresh` asks again anyway.

  The Demo (Settings showDemo, its Sample project) gets the mockup's pull requests and issues, so the pages can be tried
  without a GitHub account: nothing is asked of gh or Linear for it.
*/
import { resolve } from "node:path";
import type { IssueItem, PrCheckCounts, PrDetail, PrItem, PrState, Project, WorklistQuery, WorklistResult } from "../../contracts/src/index.ts";
import { hostOn, scmKey, scmSettings, trackerOn } from "../../contracts/src/index.ts";
import { run as runCmd, which as whichCmd } from "./exec.ts";
import type { Runner } from "./sourcecontrol.ts";
import type { Store } from "./store.ts";
import { ghCheck } from "./surfaces.ts";

export type WorklistCtx = { env: NodeJS.ProcessEnv; keys: Map<string, string>; run?: Runner; which?: (cmd: string, env: NodeJS.ProcessEnv) => string | null; fetch?: typeof fetch; now?: () => number };
/** The part of the store a list reads. */
export type WorklistStore = Pick<Store, "projects" | "threads" | "settings" | "home">;

/** How many projects' gh runs at once: enough to be quick, few enough not to trip GitHub's secondary limits. */
const AT_ONCE = 3;
const LIMIT = 50;
/** gh's fields for a list row. `changedFiles`, `labels`, `updatedAt` and `reviewRequests` are all `gh pr list --json` fields. */
const PR_LIST_FIELDS = "number,title,url,state,isDraft,author,headRefName,baseRefName,additions,deletions,changedFiles,labels,updatedAt,reviewRequests,statusCheckRollup";
const ISSUE_LIST_FIELDS = "number,title,url,state,author,assignees,labels,comments,updatedAt";

type GhLabel = { name: string; color?: string };
export type GhPrRow = { number: number; title: string; url: string; state: string; isDraft?: boolean; author?: { login?: string } | null; headRefName?: string; baseRefName?: string; additions?: number; deletions?: number; changedFiles?: number; labels?: GhLabel[]; updatedAt?: string; reviewRequests?: { login?: string; name?: string }[]; statusCheckRollup?: Parameters<typeof ghCheck>[0][]; body?: string; files?: { path: string; additions?: number; deletions?: number }[]; headRefOid?: string; isCrossRepository?: boolean };
export type GhIssueRow = { number: number; title: string; url: string; state: string; author?: { login?: string } | null; assignees?: { login?: string }[]; labels?: GhLabel[]; comments?: unknown[] | number; updatedAt?: string; body?: string };

const labelsOf = (l?: GhLabel[]) => (l ?? []).filter((x) => x?.name).map((x) => ({ name: x.name, ...(x.color ? { color: x.color.startsWith("#") ? x.color : `#${x.color}` } : {}) }));
const timeOf = (s?: string) => {
  const t = s ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? t : 0;
};
const same = (a?: string, b?: string) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());

/** gh's checks counted, through the PR card's own reading of each (ghCheck): a skipped one counts nowhere. */
export function checkCounts(rollup: GhPrRow["statusCheckRollup"]): PrCheckCounts | undefined {
  const all = (rollup ?? []).map(ghCheck).filter((c) => c.state !== "skipped");
  if (!all.length) return undefined;
  const failing = all.filter((c) => c.state === "fail").map((c) => c.name);
  return { passed: all.filter((c) => c.state === "pass").length, failed: failing.length, pending: all.filter((c) => c.state === "pending").length, ...(failing.length ? { failing } : {}) };
}

/** One row of `gh pr list --json` as the pages show it. `me`: the gh account's login, for Yours and Needs your review. */
export function prItemOf(p: GhPrRow, proj: Pick<Project, "id" | "name">, me?: string, threadId?: string): PrItem {
  const s = p.state.toUpperCase();
  const state: PrState = s === "MERGED" ? "merged" : s === "CLOSED" ? "closed" : p.isDraft ? "draft" : "open";
  const checks = checkCounts(p.statusCheckRollup);
  return {
    projectId: proj.id,
    project: proj.name,
    host: "github",
    number: p.number,
    title: p.title,
    url: p.url,
    state,
    author: p.author?.login ?? "someone",
    mine: same(p.author?.login, me),
    reviewRequested: (p.reviewRequests ?? []).some((r) => same(r.login, me)),
    branch: p.headRefName ?? "",
    base: p.baseRefName ?? "",
    additions: p.additions ?? 0,
    deletions: p.deletions ?? 0,
    files: p.changedFiles ?? p.files?.length ?? 0,
    ...(checks ? { checks } : {}),
    labels: labelsOf(p.labels),
    updatedAt: timeOf(p.updatedAt),
    ...(p.body !== undefined ? { body: p.body } : {}),
    ...(threadId ? { threadId } : {}),
  };
}

/** One row of `gh issue list --json` as the pages show it. */
export function issueItemOf(i: GhIssueRow, proj: Pick<Project, "id" | "name">, me?: string): IssueItem {
  return {
    projectId: proj.id,
    project: proj.name,
    tracker: "github",
    key: `#${i.number}`,
    number: i.number,
    title: i.title,
    url: i.url,
    state: i.state.toUpperCase() === "OPEN" ? "open" : "closed",
    author: i.author?.login ?? "someone",
    assignedToMe: (i.assignees ?? []).some((a) => same(a.login, me)),
    labels: labelsOf(i.labels),
    comments: Array.isArray(i.comments) ? i.comments.length : typeof i.comments === "number" ? i.comments : 0,
    updatedAt: timeOf(i.updatedAt),
    ...(i.body !== undefined ? { body: i.body } : {}),
  };
}

/* ---------- Linear ---------- */

export type LinearNode = { identifier: string; number?: number; title: string; url: string; updatedAt?: string; description?: string | null; state?: { type?: string } | null; creator?: { name?: string; displayName?: string } | null; assignee?: { id?: string } | null; team?: { key?: string; name?: string } | null; labels?: { nodes?: { name: string; color?: string }[] } | null; comments?: { nodes?: unknown[] } | null };

/** Linear's issues stand apart from your folders: they come under this project id, named by their team. */
export const LINEAR_PROJECT = "linear";
/** A Linear issue's key: its team's key and its number ("LIN-12"). */
const LINEAR_KEY = /^[A-Za-z][A-Za-z0-9]*-\d+$/;

const LINEAR_FIELDS = "identifier number title url updatedAt state { type } creator { name displayName } assignee { id } team { key name } labels { nodes { name color } } comments(first: 50) { nodes { id } }";

/** One Linear issue as the Issues page shows it. Done and canceled are closed. */
export function linearItemOf(n: LinearNode, viewerId?: string): IssueItem {
  const t = n.state?.type ?? "";
  return {
    projectId: LINEAR_PROJECT,
    project: n.team?.name || n.team?.key || "Linear",
    tracker: "linear",
    key: n.identifier,
    ...(typeof n.number === "number" ? { number: n.number } : {}),
    title: n.title,
    url: n.url,
    state: t === "completed" || t === "canceled" ? "closed" : "open",
    author: n.creator?.displayName || n.creator?.name || "someone",
    assignedToMe: Boolean(viewerId && n.assignee?.id === viewerId),
    labels: (n.labels?.nodes ?? []).map((l) => ({ name: l.name, ...(l.color ? { color: l.color } : {}) })),
    comments: n.comments?.nodes?.length ?? 0,
    updatedAt: timeOf(n.updatedAt),
    ...(n.description != null ? { body: n.description } : {}),
  };
}

/** Asks Linear's GraphQL API, with the key alone as its authorization (how Linear takes a personal API key). */
async function linear<T>(f: typeof fetch, key: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const r = await f("https://api.linear.app/graphql", { method: "POST", headers: { "content-type": "application/json", authorization: key }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(15_000), redirect: "error" }).catch(() => null);
  if (!r) throw new Error("Linear didn't answer.");
  if (r.status === 401 || r.status === 403) throw new Error("Linear didn't take the key. Connect it again in Settings › Source control & issues.");
  if (!r.ok) throw new Error(`Linear answered ${r.status}.`);
  const j = (await r.json().catch(() => null)) as { data?: T; errors?: { message?: string }[] } | null;
  if (!j?.data) throw new Error(j?.errors?.[0]?.message ? `Linear: ${j.errors[0].message}` : "Linear's answer couldn't be read.");
  return j.data;
}

/* ---------- Filtering ---------- */

/** Whether an item matches the search box: "#42" or "42", "label:bug", "author:mara", and words in its title or project. */
export function matches(it: { number?: number; key?: string; title: string; project: string; author: string; labels: { name: string }[] }, q?: string): boolean {
  const words = (q ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  for (const w of words) {
    const [k, v] = w.includes(":") ? [w.slice(0, w.indexOf(":")), w.slice(w.indexOf(":") + 1)] : ["", w];
    if (k === "label") {
      if (!it.labels.some((l) => l.name.toLowerCase() === v || l.name.toLowerCase().includes(v))) return false;
    } else if (k === "author") {
      if (!it.author.toLowerCase().includes(v)) return false;
    } else if (/^#?\d+$/.test(w)) {
      if (it.number !== Number(w.replace("#", "")) && it.key?.toLowerCase() !== w) return false;
    } else if (!`${it.title} ${it.project} ${it.key ?? ""}`.toLowerCase().includes(w)) return false;
  }
  return true;
}

/* ---------- The lists ---------- */

type Unavailable = WorklistResult<unknown>["unavailable"][number];
type Kept<T> = { at: number; value: Promise<T> };

/** Runs `fn` over `items`, `n` at a time, in order. */
async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

/** gh's own words when it fails, the last line of them, or a plain sentence. */
const ghWhy = (stderr: string, fallback: string) => stderr.trim().split(/\r?\n/).filter(Boolean).pop()?.slice(0, 200) || fallback;

export class Worklists {
  ctx: WorklistCtx;
  private kept = new Map<string, Kept<unknown>>();
  constructor(ctx: WorklistCtx) {
    this.ctx = ctx;
  }
  private now() {
    return this.ctx.now?.() ?? Date.now();
  }
  private run(args: string[], cwd?: string, timeout = 30_000) {
    return (this.ctx.run ?? runCmd)("gh", args, { cwd, env: this.ctx.env, timeout }).catch((e: Error) => ({ code: 1, stdout: "", stderr: e.message }));
  }
  /** How long a list is kept: a little under the page's refresh, so its timer finds a fresh one; a minute when it only refreshes as it opens. */
  private ttl(store: WorklistStore) {
    const r = scmSettings(store.settings).worklistRefresh;
    return r > 0 ? Math.max(15_000, r * 1000 - 5_000) : 60_000;
  }
  /** One value kept by key, the same promise to everyone who asks while it's being got. A failure isn't kept. */
  private keep<T>(key: string, ttl: number, fresh: boolean | undefined, get: () => Promise<T>): Promise<T> {
    const k = this.kept.get(key) as Kept<T> | undefined;
    if (k && !fresh && this.now() - k.at < ttl) return k.value;
    const value = get();
    this.kept.set(key, { at: this.now(), value });
    value.catch(() => this.kept.get(key)?.value === value && this.kept.delete(key));
    return value;
  }
  /** Forgets every kept list: a key added or taken away, a host switched. */
  forget() {
    this.kept.clear();
  }

  /** Whether gh is here and signed in, asked at most once a minute: undefined when it is, else why not. */
  private ghReady(): Promise<string | undefined> {
    return this.keep("gh:ready", 60_000, false, async () => {
      if (!(this.ctx.which ?? whichCmd)("gh", this.ctx.env)) return `The GitHub CLI isn't installed. Run ${process.platform === "win32" ? "winget install --id GitHub.cli" : "brew install gh"}, then gh auth login.`;
      const r = await this.run(["auth", "status"], undefined, 15_000);
      return r.code === 0 ? undefined : "The GitHub CLI isn't signed in. Run gh auth login.";
    });
  }
  /** The gh account's login, for Yours, Needs your review and Assigned to you; kept ten minutes. Undefined when gh won't say. */
  private me(): Promise<string | undefined> {
    return this.keep("gh:me", 10 * 60_000, false, async () => {
      const r = await this.run(["api", "user", "--jq", ".login"], undefined, 15_000);
      const login = r.code === 0 ? r.stdout.trim() : "";
      return /^[\w-]+$/.test(login) ? login : undefined;
    });
  }

  /** The projects a list reads: yours (not designs, not the Demo's stand-in folders), or the one asked for. */
  private projectsFor(store: WorklistStore, q: WorklistQuery) {
    return store.projects.filter((p) => !p.kind && !p.demoFor && (!q.projectId || p.id === q.projectId));
  }
  /** Whether a project is the Demo's Sample project, shown with the mockup's lists. */
  isDemo(store: WorklistStore, p: Project) {
    return store.settings.showDemo === true && resolve(p.path) === resolve(store.home, "Sample project");
  }
  /** Why a project can't be read from GitHub, or undefined when it can. */
  private async notGithub(p: Project): Promise<string | undefined> {
    if (p.remote) return undefined;
    if (!p.git) return "Not a Git repository.";
    // Project.remote is read as the project is added; one given a GitHub remote since is asked again.
    const r = await (this.ctx.run ?? runCmd)("git", ["remote", "get-url", "origin"], { cwd: p.path, env: this.ctx.env, timeout: 8_000 }).catch(() => ({ code: 1, stdout: "", stderr: "" }));
    return r.code === 0 && /github\.com[:/]/i.test(r.stdout) ? undefined : "Not on GitHub.";
  }
  private threadFor(store: WorklistStore, projectId: string, n: number, branch: string) {
    return store.threads.find((t) => t.projectId === projectId && !t.archived && (t.pr?.number === n || (branch && t.worktree?.branch === branch)))?.id;
  }

  async prs(store: WorklistStore, q: WorklistQuery = {}): Promise<WorklistResult<PrItem>> {
    const state = q.state ?? "open";
    const items: PrItem[] = [];
    const unavailable: Unavailable[] = [];
    const projects = this.projectsFor(store, q);
    const ttl = this.ttl(store);
    await pool(projects, AT_ONCE, async (p) => {
      if (this.isDemo(store, p)) return void items.push(...demoPrs(p, this.now()).filter((x) => stateFits(x.state, state)));
      if (!hostOn(store.settings, "github")) return;
      const off = await this.notGithub(p);
      if (off) return void unavailable.push({ projectId: p.id, project: p.name, why: off });
      const ready = await this.ghReady();
      if (ready) return void unavailable.push({ projectId: p.id, project: p.name, why: ready });
      try {
        const [rows, me] = await Promise.all([
          this.keep(`prs:${p.id}:${state}`, ttl, q.fresh, async () => {
            const r = await this.run(["pr", "list", "--state", state, "--limit", String(LIMIT), "--json", PR_LIST_FIELDS], p.path);
            if (r.code !== 0) throw new Error(ghWhy(r.stderr, "gh couldn't list its pull requests."));
            return JSON.parse(r.stdout) as GhPrRow[];
          }),
          this.me(),
        ]);
        for (const row of rows) items.push(prItemOf(row, p, me, this.threadFor(store, p.id, row.number, row.headRefName ?? "")));
      } catch (e) {
        unavailable.push({ projectId: p.id, project: p.name, why: (e as Error).message || "gh couldn't list its pull requests." });
      }
    });
    return { items: items.filter((x) => matches(x, q.q)).sort((a, b) => b.updatedAt - a.updatedAt), unavailable, at: this.now() };
  }

  async issues(store: WorklistStore, q: WorklistQuery = {}): Promise<WorklistResult<IssueItem>> {
    const state = q.state === "merged" ? "closed" : (q.state ?? "open");
    const items: IssueItem[] = [];
    const unavailable: Unavailable[] = [];
    const ttl = this.ttl(store);
    const projects = q.projectId === LINEAR_PROJECT ? [] : this.projectsFor(store, q);
    const github = pool(projects, AT_ONCE, async (p) => {
      if (this.isDemo(store, p)) return void items.push(...demoIssues(p, this.now()).filter((x) => state === "all" || x.state === state));
      if (!trackerOn(store.settings, "github")) return;
      const off = await this.notGithub(p);
      if (off) return void unavailable.push({ projectId: p.id, project: p.name, why: off });
      const ready = await this.ghReady();
      if (ready) return void unavailable.push({ projectId: p.id, project: p.name, why: ready });
      try {
        const [rows, me] = await Promise.all([
          this.keep(`issues:${p.id}:${state}`, ttl, q.fresh, async () => {
            const r = await this.run(["issue", "list", "--state", state, "--limit", String(LIMIT), "--json", ISSUE_LIST_FIELDS], p.path);
            if (r.code !== 0) throw new Error(ghWhy(r.stderr, "gh couldn't list its issues."));
            return JSON.parse(r.stdout) as GhIssueRow[];
          }),
          this.me(),
        ]);
        for (const row of rows) items.push(issueItemOf(row, p, me));
      } catch (e) {
        unavailable.push({ projectId: p.id, project: p.name, why: (e as Error).message || "gh couldn't list its issues." });
      }
    });
    // Linear's, when a key was added and its switch is on: they belong to no folder, so a list of one project leaves them out.
    const key = this.ctx.keys.get(scmKey("linear"));
    const lin = key && trackerOn(store.settings, "linear") && (!q.projectId || q.projectId === LINEAR_PROJECT)
      ? this.keep(`linear:${state}`, ttl, q.fresh, () => this.linearIssues(key, state)).then(
          (l) => void items.push(...l),
          (e: Error) => void unavailable.push({ projectId: LINEAR_PROJECT, project: "Linear", why: e.message }),
        )
      : Promise.resolve();
    await Promise.all([github, lin]);
    return { items: items.filter((x) => matches(x, q.q)).sort((a, b) => b.updatedAt - a.updatedAt), unavailable, at: this.now() };
  }

  /** Linear's issues the key can see (yours and your teams'), most recently changed first. */
  private async linearIssues(key: string, state: "open" | "closed" | "all"): Promise<IssueItem[]> {
    const filter = state === "open" ? { state: { type: { nin: ["completed", "canceled"] } } } : state === "closed" ? { state: { type: { in: ["completed", "canceled"] } } } : undefined;
    const d = await linear<{ viewer: { id: string }; issues: { nodes: LinearNode[] } }>(this.ctx.fetch ?? fetch, key, `query Issues($filter: IssueFilter) { viewer { id } issues(first: ${LIMIT}, filter: $filter, orderBy: updatedAt) { nodes { ${LINEAR_FIELDS} } } }`, filter ? { filter } : {});
    return (d.issues?.nodes ?? []).map((n) => linearItemOf(n, d.viewer?.id));
  }

  /** One pull request with its body and changed files. */
  async pr(store: WorklistStore, projectId: string, n: number): Promise<PrDetail> {
    // gh would read anything else as a branch or a flag.
    if (!Number.isInteger(n) || n <= 0) throw new Error("That isn't a pull request's number.");
    const p = store.projects.find((x) => x.id === projectId);
    if (!p) throw new Error("That project isn't in Liner Code.");
    if (this.isDemo(store, p)) {
      const it = demoPrs(p, this.now()).find((x) => x.number === n);
      if (!it) throw new Error(`There's no pull request #${n} here.`);
      // A made-up head commit: no branch in the Sample project has it, so a session on one starts from the pull request's branch as gh would fetch it.
      return { ...it, fileList: DEMO_FILES[n] ?? [], headSha: demoSha(n), isCrossRepository: false };
    }
    const off = (await this.notGithub(p)) ?? (await this.ghReady());
    if (off) throw new Error(off);
    const [r, me] = await Promise.all([this.run(["pr", "view", String(n), "--json", `${PR_LIST_FIELDS},body,files,headRefOid,isCrossRepository`], p.path), this.me()]);
    if (r.code !== 0) throw new Error(ghWhy(r.stderr, `gh couldn't read pull request #${n}.`));
    const row = JSON.parse(r.stdout) as GhPrRow;
    return { ...prItemOf(row, p, me, this.threadFor(store, p.id, row.number, row.headRefName ?? "")), fileList: (row.files ?? []).map((f) => ({ path: f.path, additions: f.additions ?? 0, deletions: f.deletions ?? 0 })), ...(row.headRefOid ? { headSha: row.headRefOid } : {}), isCrossRepository: row.isCrossRepository === true };
  }

  /**
    One issue with its body: "#42" in a project's repository, or a Linear key ("LIN-12"), asked of Linear whether it comes
    under LINEAR_PROJECT or under the project a scan of it was started from (security-targets.ts).
  */
  async issue(store: WorklistStore, projectId: string, key: string): Promise<IssueItem> {
    if (projectId === LINEAR_PROJECT || LINEAR_KEY.test(key)) {
      const k = this.ctx.keys.get(scmKey("linear"));
      if (!k) throw new Error("Linear isn't connected. Connect it in Settings › Source control & issues.");
      if (!LINEAR_KEY.test(key)) throw new Error("That isn't a Linear issue's key.");
      const d = await linear<{ viewer: { id: string }; issue: LinearNode | null }>(this.ctx.fetch ?? fetch, k, `query Issue($id: String!) { viewer { id } issue(id: $id) { ${LINEAR_FIELDS} description } }`, { id: key });
      if (!d.issue) throw new Error(`Linear has no issue ${key}.`);
      return linearItemOf(d.issue, d.viewer?.id);
    }
    const p = store.projects.find((x) => x.id === projectId);
    if (!p) throw new Error("That project isn't in Liner Code.");
    const n = Number(key.replace(/^#/, ""));
    if (!Number.isInteger(n) || n <= 0) throw new Error("That isn't an issue's number.");
    if (this.isDemo(store, p)) {
      const it = demoIssues(p, this.now()).find((x) => x.number === n);
      if (!it) throw new Error(`There's no issue #${n} here.`);
      return it;
    }
    const off = (await this.notGithub(p)) ?? (await this.ghReady());
    if (off) throw new Error(off);
    const [r, me] = await Promise.all([this.run(["issue", "view", String(n), "--json", `${ISSUE_LIST_FIELDS},body`], p.path), this.me()]);
    if (r.code !== 0) throw new Error(ghWhy(r.stderr, `gh couldn't read issue #${n}.`));
    return issueItemOf(JSON.parse(r.stdout) as GhIssueRow, p, me);
  }
}

/** Whether a pull request's state is among those asked for: open takes drafts too, as gh's --state open does. */
const stateFits = (s: PrState, want: NonNullable<WorklistQuery["state"]>) => want === "all" || s === want || (want === "open" && s === "draft");

/* ---------- Shared with Liner's MCP server and the scan watcher ---------- */

let shared: Worklists | undefined;
/** Sets up the engine's one Worklists (api.ts does, with the agents' PATH and the keys in memory). */
export function useWorklists(ctx: WorklistCtx): Worklists {
  shared = new Worklists(ctx);
  return shared;
}
const one = () => (shared ??= new Worklists({ env: process.env, keys: new Map() }));
/** Pull requests across your projects (or one), as the Pull requests page lists them. */
export const listPrs = (store: WorklistStore, q: WorklistQuery = {}) => one().prs(store, q);
/** Issues across your projects (or one) and Linear, as the Issues page lists them. */
export const listIssues = (store: WorklistStore, q: WorklistQuery = {}) => one().issues(store, q);
export const getPr = (store: WorklistStore, projectId: string, n: number) => one().pr(store, projectId, n);
export const getIssue = (store: WorklistStore, projectId: string, key: string) => one().issue(store, projectId, key);

/* ---------- The Demo ---------- */

const H = 60 * 60_000;
const D = 24 * H;
const BUG = { name: "bug", color: "#d73a4a" };

/**
  The mockup's pull requests (board PullRequests): three made-up projects' worth, all under the Sample project's id so
  each opens there. The names are the mockup's, labels on sample data only; "you" is whoever is trying the Demo.
*/
export function demoPrs(p: Pick<Project, "id">, now: number): PrItem[] {
  const pr = (o: Partial<PrItem> & Pick<PrItem, "number" | "title" | "project" | "author" | "branch" | "additions" | "deletions" | "files" | "updatedAt">): PrItem => ({ projectId: p.id, host: "github", url: `https://github.com/liner-demo/${o.project}/pull/${o.number}`, state: "open", mine: false, reviewRequested: false, base: "main", labels: [], ...o });
  return [
    pr({ number: 131, title: "Store tide alerts per harbour", project: "foreshore", author: "devon", reviewRequested: true, branch: "liner/alerts", additions: 342, deletions: 58, files: 9, checks: { passed: 5, failed: 1, pending: 0, failing: ["lint"] }, updatedAt: now - 5 * H, body: "Alerts were one list for every harbour. This keeps them per harbour in SQLite, so a harbour master sees only theirs, and adds a page to edit them." }),
    pr({ number: 128, title: "A wind slider and falling leaves", project: "bonsai", author: "mara", reviewRequested: true, branch: "mara/wind", additions: 214, deletions: 31, files: 6, checks: { passed: 5, failed: 0, pending: 0 }, updatedAt: now - 2 * H, body: "A slider for the wind, and leaves that fall with it." }),
    pr({ number: 129, title: "Fix the tide time after midnight", project: "foreshore", author: "you", mine: true, branch: "liner/tide-midnight", additions: 18, deletions: 4, files: 2, checks: { passed: 4, failed: 0, pending: 0 }, updatedAt: now - 9 * 60_000, body: "Past the last high tide of the day, the next one is tomorrow's first." }),
    pr({ number: 126, title: "Read tides from the new harbour API", project: "foreshore", author: "you", mine: true, state: "draft", branch: "liner/harbour-api", additions: 96, deletions: 40, files: 4, updatedAt: now - D }),
    pr({ number: 58, title: "The site's footer drawn like the page", project: "liner-site", author: "you", mine: true, branch: "liner/footer", additions: 61, deletions: 22, files: 3, checks: { passed: 3, failed: 0, pending: 0 }, updatedAt: now - 2 * D }),
    pr({ number: 124, title: "Bump vite from 7.1.4 to 7.2.0", project: "bonsai", author: "dependabot", branch: "dependabot/npm_and_yarn/vite-7.2.0", additions: 3, deletions: 3, files: 2, checks: { passed: 5, failed: 0, pending: 0 }, labels: [{ name: "dependencies", color: "#0366d6" }], updatedAt: now - 3 * D }),
  ];
}

/** A Demo pull request's head commit: 40 hex digits made from its number. */
const demoSha = (n: number) => (n.toString(16).padStart(4, "0") + "d3e0").repeat(5);

/** The files the Demo's pull requests change, #131's as the mockup lists them. */
const DEMO_FILES: Record<number, PrDetail["fileList"]> = {
  131: [
    { path: "src/alerts/store.ts", additions: 128, deletions: 12 },
    { path: "src/alerts/AlertCard.tsx", additions: 64, deletions: 20 },
    { path: "src/pages/harbour-admin.tsx", additions: 97, deletions: 0 },
    { path: "db/0007_alerts.sql", additions: 22, deletions: 0 },
    { path: "src/alerts/list.ts", additions: 12, deletions: 18 },
    { path: "src/alerts/types.ts", additions: 8, deletions: 4 },
    { path: "src/pages/harbour.tsx", additions: 6, deletions: 4 },
    { path: "test/alerts.test.ts", additions: 4, deletions: 0 },
    { path: "README.md", additions: 1, deletions: 0 },
  ],
  128: [
    { path: "src/wind.ts", additions: 120, deletions: 8 },
    { path: "src/leaves.ts", additions: 64, deletions: 12 },
    { path: "src/Slider.tsx", additions: 18, deletions: 5 },
    { path: "src/scene.ts", additions: 8, deletions: 4 },
    { path: "src/styles.css", additions: 3, deletions: 2 },
    { path: "README.md", additions: 1, deletions: 0 },
  ],
  129: [
    { path: "src/tides.js", additions: 12, deletions: 3 },
    { path: "src/tides.test.js", additions: 6, deletions: 1 },
  ],
  126: [
    { path: "src/feed.js", additions: 70, deletions: 32 },
    { path: "src/tides.js", additions: 14, deletions: 6 },
    { path: "src/feed.test.js", additions: 11, deletions: 0 },
    { path: "README.md", additions: 1, deletions: 2 },
  ],
  58: [
    { path: "site/footer.html", additions: 40, deletions: 18 },
    { path: "site/site.css", additions: 20, deletions: 4 },
    { path: "site/index.html", additions: 1, deletions: 0 },
  ],
  124: [
    { path: "package.json", additions: 1, deletions: 1 },
    { path: "package-lock.json", additions: 2, deletions: 2 },
  ],
};

/** The mockup's issues (board Issues), under the Sample project's id like its pull requests. */
export function demoIssues(p: Pick<Project, "id">, now: number): IssueItem[] {
  const issue = (o: Partial<IssueItem> & Pick<IssueItem, "number" | "title" | "project" | "author" | "updatedAt">): IssueItem => ({ projectId: p.id, tracker: "github", key: `#${o.number}`, url: `https://github.com/liner-demo/${o.project}/issues/${o.number}`, state: "open", assignedToMe: false, labels: [], comments: 0, ...o });
  return [
    issue({ number: 42, title: "Harbour alerts show for the wrong harbour", project: "foreshore", author: "kai", assignedToMe: true, labels: [BUG], comments: 4, updatedAt: now - D, linkedPrs: [131], body: "Signed in as the Whitby harbour master, I can see Scarborough's storm alerts too, and edit them. Started after last week's release." }),
    issue({ number: 40, title: "The tide chart is blank on Safari 18", project: "foreshore", author: "rui", assignedToMe: true, labels: [BUG], comments: 3, updatedAt: now - 2 * D, body: "On Safari 18 the chart's area is there but nothing is drawn in it. Chrome and Firefox are fine." }),
    issue({ number: 37, title: "Tide times in Spanish", project: "foreshore", author: "ana", assignedToMe: true, labels: [{ name: "enhancement", color: "#a2eeef" }], updatedAt: now - 6 * D, body: "Harbour masters in Galicia would like the tide tables in Spanish." }),
    issue({ number: 35, title: "Script in an alert's text runs on the editor page", project: "foreshore", author: "an outside reporter", labels: [{ name: "security", color: "#e4a11b" }], comments: 1, updatedAt: now - 3 * H, body: "An alert whose text holds a script tag runs it when the alert is opened in the editor." }),
    issue({ number: 31, title: "Leaves fall through the pot", project: "bonsai", author: "mara", labels: [BUG], updatedAt: now - 4 * D, body: "With a strong wind, some leaves fall through the pot instead of landing on it." }),
    issue({ number: 12, title: "The harbours page is a 404", project: "liner-site", author: "devon", updatedAt: now - 7 * D, body: "The link in the footer goes to /harbours, which isn't there." }),
  ];
}
