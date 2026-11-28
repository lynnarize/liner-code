/*
  The Pull requests and Issues pages' words and order, and the two small things beside them (a session's pull request
  said on its sidebar row, and the message box's usage ring), with no React and no alias imports, so plain Node can
  test them (engine/test/worklists-pages.test.ts). The lists come from the engine (worklists.prs, worklists.issues);
  everything here only reads them.
  The search field takes words and a few filters, read on this Mac: label:bug, label:"good first issue", author:devon,
  is:draft, is:mine. Words match the title, the number, the project, the branch and the author.
*/
import type { IssueItem, LimitWindow, PrItem, Thread, ToolLimits } from "../../../contracts/src/index.ts";

export type Search = { words: string[]; labels: string[]; authors: string[]; draft: boolean; mine: boolean };

/** The search field's words and filters: `key:value` or `key:"two words"` for label, author and is; anything else is a word. */
export function parseSearch(q: string): Search {
  const out: Search = { words: [], labels: [], authors: [], draft: false, mine: false };
  for (const m of q.matchAll(/([a-z]+):"([^"]*)"|([a-z]+):(\S+)|"([^"]*)"|(\S+)/gi)) {
    const key = (m[1] ?? m[3])?.toLowerCase();
    const value = (m[2] ?? m[4] ?? "").trim().toLowerCase();
    if (key === "label" && value) out.labels.push(value);
    else if (key === "author" && value) out.authors.push(value.replace(/^@/, ""));
    else if (key === "is" && value === "draft") out.draft = true;
    else if (key === "is" && (value === "mine" || value === "assigned")) out.mine = true;
    else {
      const word = (m[5] ?? m[6] ?? m[0]).trim().toLowerCase();
      if (word) out.words.push(word);
    }
  }
  return out;
}

const hasLabels = (labels: { name: string }[], want: string[]) => want.every((w) => labels.some((l) => l.name.toLowerCase() === w));

export function prMatches(pr: PrItem, s: Search) {
  if (s.draft && pr.state !== "draft") return false;
  if (s.mine && !pr.mine) return false;
  if (s.authors.length && !s.authors.includes(pr.author.toLowerCase())) return false;
  if (!hasLabels(pr.labels, s.labels)) return false;
  const text = `${pr.title}\n#${pr.number}\n${pr.project}\n${pr.branch}\n${pr.author}`.toLowerCase();
  return s.words.every((w) => text.includes(w));
}

export function issueMatches(issue: IssueItem, s: Search) {
  // An issue is never a draft: asking for drafts on the Issues page finds none, rather than ignoring what you typed.
  if (s.draft) return false;
  if (s.mine && !issue.assignedToMe) return false;
  if (s.authors.length && !s.authors.includes(issue.author.toLowerCase())) return false;
  if (!hasLabels(issue.labels, s.labels)) return false;
  const text = `${issue.title}\n${issue.key}\n${issue.project}\n${issue.author}`.toLowerCase();
  return s.words.every((w) => text.includes(w));
}

export type PrSort = "updated" | "number" | "size";
export const PR_SORTS: Record<PrSort, string> = { updated: "Recently updated", number: "Newest first", size: "Most changed" };
const prOrder = (sort: PrSort) => (a: PrItem, b: PrItem) =>
  sort === "number" ? b.number - a.number || a.project.localeCompare(b.project) : sort === "size" ? b.additions + b.deletions - (a.additions + a.deletions) : b.updatedAt - a.updatedAt;

export type Group<T> = { id: string; name: string; items: T[] };

/** Needs your review (asked of you, not yours), Yours, then Others; each in the sort picked, an empty group left out. */
export function groupPrs(items: PrItem[], sort: PrSort = "updated"): Group<PrItem>[] {
  const by = prOrder(sort);
  const review = items.filter((p) => p.reviewRequested && !p.mine).sort(by);
  const yours = items.filter((p) => p.mine).sort(by);
  const others = items.filter((p) => !p.mine && !p.reviewRequested).sort(by);
  return [
    { id: "review", name: "Needs your review", items: review },
    { id: "yours", name: "Yours", items: yours },
    { id: "others", name: "Others", items: others },
  ].filter((g) => g.items.length > 0);
}

export type IssueSort = "updated" | "number" | "comments";
export const ISSUE_SORTS: Record<IssueSort, string> = { updated: "Recently updated", number: "Newest first", comments: "Most talked about" };
const issueOrder = (sort: IssueSort) => (a: IssueItem, b: IssueItem) =>
  sort === "number" ? (b.number ?? 0) - (a.number ?? 0) || b.updatedAt - a.updatedAt : sort === "comments" ? b.comments - a.comments : b.updatedAt - a.updatedAt;

/** Assigned to you, then Everyone else. */
export function groupIssues(items: IssueItem[], sort: IssueSort = "updated"): Group<IssueItem>[] {
  const by = issueOrder(sort);
  return [
    { id: "mine", name: "Assigned to you", items: items.filter((i) => i.assignedToMe).sort(by) },
    { id: "rest", name: "Everyone else", items: items.filter((i) => !i.assignedToMe).sort(by) },
  ].filter((g) => g.items.length > 0);
}

/**
  What the Pull requests page does with an open detail its list doesn't hold. One asked for as the page came up (`pick`,
  an issue's Linked line) may be merged or closed, so the open list hasn't it: the page looks in every state first. Any
  other (a row a search or another state now hides, or a pick not there in any state) closes.
*/
export function missingPick(open: string | null, pick: string | undefined, shown: string, found: boolean): "keep" | "all" | "close" {
  if (!open || found) return "keep";
  return open === pick && shown !== "all" ? "all" : "close";
}

/** A row's key: a number is only unique within its project. */
export const prKey = (p: { projectId: string; number: number }) => `${p.projectId}#${p.number}`;
export const issueKey = (i: { projectId: string; key: string }) => `${i.projectId}#${i.key}`;

export type ChecksSaid = { tone: "ok" | "bad" | "pending"; short: string; long: string; failing: string[] };
/** A pull request's checks in a few characters ("5/5", "1 failing", "2 running") and in a sentence for its detail; none reported is null. */
export function checksSaid(c: PrItem["checks"]): ChecksSaid | null {
  if (!c) return null;
  const total = c.passed + c.failed + c.pending;
  if (total === 0) return null;
  const failing = c.failing ?? [];
  if (c.failed > 0) return { tone: "bad", short: `${c.failed} failing`, long: `${c.failed} of ${total} failing`, failing };
  if (c.pending > 0) return { tone: "pending", short: `${c.pending} running`, long: `${c.pending} of ${total} still running`, failing };
  return { tone: "ok", short: `${c.passed}/${total}`, long: total === 1 ? "Passed" : `All ${total} passed`, failing };
}

/** Where your review stands on it, for its detail. */
export const reviewSaid = (pr: PrItem) => (pr.mine ? "Yours, so not yours to review" : pr.reviewRequested ? "Waits for yours" : "Not asked of you");

const STATE_WORD: Record<string, string> = { open: "open", merged: "merged", closed: "closed", all: "" };
/** The page's head after its name: "6 open in 3 projects", "2 merged in 1 project", "Nothing open". */
export function headCount(items: { projectId: string; project?: string }[], state: string) {
  const word = STATE_WORD[state] ?? "";
  if (items.length === 0) return word ? `Nothing ${word}` : "None";
  // By name, as the rows say them: one folder can hold several repositories' lists (the Demo's sample does).
  const projects = new Set(items.map((x) => x.project ?? x.projectId)).size;
  return `${items.length}${word ? ` ${word}` : ""} in ${projects} ${projects === 1 ? "project" : "projects"}`;
}

/** "now", "9m", "5h", "2d", "3w", "4mo", "2y": a row's age, short. */
export function age(at: number, now = Date.now()) {
  const m = Math.max(0, Math.floor((now - at) / 60000));
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  if (d < 35) return `${Math.floor(d / 7)}w`;
  if (d < 365) return `${Math.floor(d / 30)}mo`;
  return `${Math.floor(d / 365)}y`;
}

/** A name's initial and a soft colour of its own, the same for the same name everywhere. */
export function avatarOf(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return { letter: ([...name.replace(/^@/, "")][0] ?? "?").toUpperCase(), hue: h % 360 };
}

/** A label's colour as GitHub gives it ("d73a4a"), as CSS, or nothing when it isn't one. */
export const labelColor = (c?: string) => (c && /^#?[0-9a-f]{6}$/i.test(c) ? (c.startsWith("#") ? c : `#${c}`) : undefined);

/** A path split for the files list: its folder in grey and its name in ink. */
export function splitPath(path: string) {
  const i = path.lastIndexOf("/");
  return i < 0 ? { dir: "", name: path } : { dir: path.slice(0, i + 1), name: path.slice(i + 1) };
}

/** Whether one of these waits on your review: the amber dot on Pull requests at the sidebar's foot. */
export const waitsOnYourReview = (items: PrItem[]) => items.some((p) => p.reviewRequested && !p.mine && (p.state === "open" || p.state === "draft"));

/**
  A session's pull request on its sidebar row, after the PR mark: "#129 is ready to merge", "#128 waits for review",
  "#130: 1 check failed" (red), "#127's checks are running", "#126 is merged", "#125 was closed". `num` is the state the
  mark takes its colour from.
*/
export function prLine(pr: NonNullable<Thread["pr"]>): { text: string; tone?: "danger"; num: "open" | "merged" | "closed" | "bad" | "checks" } {
  const n = `#${pr.number}`;
  const s = pr.state.toUpperCase();
  if (s === "MERGED") return { text: `${n} is merged`, num: "merged" };
  if (s === "CLOSED") return { text: `${n} was closed`, num: "closed" };
  const c = pr.checks;
  if (c?.state === "failed") return { text: c.failed ? `${n}: ${c.failed} ${c.failed === 1 ? "check" : "checks"} failed` : `${n}: its checks failed`, tone: "danger", num: "bad" };
  if (c?.state === "running") return { text: `${n}'s checks are running`, num: "checks" };
  if (c?.state === "passed") return { text: `${n} is ready to merge`, num: "open" };
  return { text: `${n} waits for review`, num: "open" };
}

/** What an app waits on you for, on its session's row (board Approve): "Grok Bot asks to start it". */
export function appAskWords(app: string, tool: string) {
  const what = tool === "liner_start" ? "asks to start it" : tool === "liner_send" ? "asks to send to it" : tool === "liner_stop" ? "asks to stop it" : tool === "liner_scan" ? "asks to scan" : "asks first";
  return `${app} ${what}`;
}

/**
  Where a session on a pull request starts. A worktree or branch on this Mac counts only when its tip is the pull
  request's head commit (`headSha`): a branch merely named like the head (a fork's main, patch-1) is other code. With
  no head SHA to compare, or none matching, the session checks the pull request out itself with gh.
*/
export function prStart(head: { branch: string; headSha?: string }, local: { branches: { name: string; sha?: string }[]; worktrees: { path: string; branch?: string; sha?: string; threadId?: string }[] } | null): { inWorktree: string } | { base: string } | { checkout: true } {
  const sha = head.headSha?.toLowerCase();
  if (!sha || !local) return { checkout: true };
  const same = (x?: string) => Boolean(x && x.toLowerCase() === sha);
  const tree = local.worktrees.find((w) => w.branch === head.branch && !w.threadId && same(w.sha));
  if (tree) return { inWorktree: tree.path };
  const branch = local.branches.find((b) => b.name === head.branch && same(b.sha));
  return branch ? { base: branch.name } : { checkout: true };
}

/** The head commit to compare with: the one the press came with, else the detail's (read when the press came before it). */
export const headShaOf = (pr: { headSha?: string }, detail?: { headSha?: string } | null) => pr.headSha || detail?.headSha || undefined;

/** Whether Liner Security can check an issue against the code: only one in a project of yours (a Linear issue belongs to none). */
export const canCheckIssue = (issue: Pick<IssueItem, "tracker" | "projectId">, projectIds: string[]) => issue.tracker !== "linear" && projectIds.includes(issue.projectId);

/** The project a session from an issue starts in: its own, or null when you pick one (a Linear issue, or a project gone). */
export const issueProject = (issue: Pick<IssueItem, "tracker" | "projectId">, projectIds: string[]) => (issue.tracker !== "linear" && projectIds.includes(issue.projectId) ? issue.projectId : null);

/** At most this much of a body goes into a brief: the agent reads the rest itself when it needs it. */
const BRIEF_BODY = 1500;
const clip = (s: string | undefined, n = BRIEF_BODY) => {
  const t = (s ?? "").trim();
  return t.length > n ? `${t.slice(0, n).trimEnd()}…` : t;
};

/** Open a session on it: the pull request named, where it lives, and what is asked; the session works on its branch. */
export function prBrief(pr: PrItem) {
  const checks = checksSaid(pr.checks);
  const failing = checks?.tone === "bad" && checks.failing.length ? ` Failing: ${checks.failing.join(", ")}.` : "";
  return [
    `Pull request #${pr.number}, "${pr.title}", by ${pr.author}: ${pr.branch} into ${pr.base}.`,
    pr.url,
    checks ? `Its checks: ${checks.long.toLowerCase()}.${failing}` : "",
    clip(pr.body) && `What it says:\n${clip(pr.body)}`,
    `Read what it changes, then tell me how it stands: what it does, anything that looks wrong, and what's left before it can merge. Don't push, comment or merge unless I ask.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Start a session from it: the issue's title and body as the brief, its key referenced so the commit and pull request link back. */
export function issueBrief(issue: IssueItem) {
  const ref = issue.tracker === "linear" ? issue.key : `#${issue.number ?? issue.key.replace(/^#/, "")}`;
  return [
    `Issue ${ref}: ${issue.title}`,
    issue.url,
    clip(issue.body),
    `Find where this happens in the code and fix it, with a test that fails without the fix. Mention ${ref} in the commit message and in the pull request.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
  The message box's usage ring: the chosen tool's busiest plan window right now, as a percentage and its tooltip
  ("Claude Code: 38% of the 5-hour limit used"). `ref` is the model the box runs ("<provider>:<model>"). Nothing when the
  tool reports no limit. A window whose reset has passed counts as empty until the tool is asked again (ui.tsx LimitRow).
*/
export function ringOf(limits: ToolLimits[], ref: string, now = Date.now()): { pct: number; tip: string; high: boolean } | null {
  const i = ref.indexOf(":");
  const provider = i < 0 ? ref : ref.slice(0, i);
  const model = i < 0 ? "" : ref.slice(i + 1);
  // A tool's windows that count only for some of its models (OpenCode Go's, not Zen's) are shown only on those.
  const tool = limits.find((l) => l.provider === provider && l.windows.length > 0 && (!l.models || model.startsWith(l.models)));
  if (!tool) return null;
  const used = (w: LimitWindow) => (w.resetsAt !== undefined && w.resetsAt <= now ? 0 : Math.max(0, Math.min(100, w.usedPercent)));
  const busiest = tool.windows.reduce((a, w) => (used(w) > used(a) ? w : a));
  const pct = Math.round(used(busiest));
  return { pct, tip: `${tool.label}: ${pct}% of the ${spanWord(busiest)} limit used`, high: pct >= 80 };
}

/** A window named for a sentence: "5-hour", "weekly", "monthly", else its own label in small letters. */
export function spanWord(w: LimitWindow) {
  if (w.minutes && w.minutes <= 1440) return `${Math.round(w.minutes / 60)}-hour`;
  if (w.kind === "weekly" || w.minutes === 10080) return "weekly";
  if (w.kind === "monthly") return "monthly";
  return w.label.replace(/ window$/i, "").toLowerCase();
}
