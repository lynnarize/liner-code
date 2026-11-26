/*
  The Pull requests and Issues pages without a page (ui/src/app/worklists-logic.ts): what the search field's filters
  keep, the groups each page shows and their order, a pull request's checks said short, a session's pull request said on
  its sidebar row, the briefs a session starts with, the page head's count and the message box's usage ring.
  Run with `node --test engine/test/worklists-pages.test.ts`.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import type { IssueItem, PrItem, Thread, ToolLimits } from "../../contracts/src/index.ts";
import { age, appAskWords, canCheckIssue, checksSaid, headShaOf, issueProject, prStart, groupIssues, groupPrs, headCount, issueBrief, issueMatches, labelColor, parseSearch, prBrief, prLine, prMatches, ringOf, spanWord, splitPath, waitsOnYourReview } from "../../ui/src/app/worklists-logic.ts";

const pr = (o: Partial<PrItem>): PrItem => ({ projectId: "fs", project: "foreshore", host: "github", number: 1, title: "A change", url: "https://github.com/o/r/pull/1", state: "open", author: "devon", mine: false, reviewRequested: false, branch: "liner/a", base: "main", additions: 1, deletions: 0, files: 1, labels: [], updatedAt: 0, ...o });
const issue = (o: Partial<IssueItem>): IssueItem => ({ projectId: "fs", project: "foreshore", tracker: "github", key: "#1", number: 1, title: "Something is wrong", url: "https://github.com/o/r/issues/1", state: "open", author: "kai", assignedToMe: false, labels: [], comments: 0, updatedAt: 0, ...o });

test("The search field reads label, author and is filters, quoted or not, and keeps the rest as words", () => {
  const s = parseSearch(`tide label:bug label:"good first issue" author:@Devon is:draft is:mine "per harbour"`);
  assert.deepEqual(s.labels, ["bug", "good first issue"]);
  assert.deepEqual(s.authors, ["devon"]);
  assert.equal(s.draft, true);
  assert.equal(s.mine, true);
  assert.deepEqual(s.words, ["tide", "per harbour"]);
  // A key it doesn't know is a word, not a filter that hides everything.
  assert.deepEqual(parseSearch("fix:now").words, ["fix:now"]);
});

test("A pull request matches only when every word and every filter does", () => {
  const p = pr({ title: "Store tide alerts per harbour", number: 131, labels: [{ name: "Bug" }], author: "devon" });
  assert.equal(prMatches(p, parseSearch("harbour")), true);
  assert.equal(prMatches(p, parseSearch("#131")), true);
  assert.equal(prMatches(p, parseSearch("label:bug")), true, "a label's case was taken to matter");
  assert.equal(prMatches(p, parseSearch("label:bug label:security")), false, "one label of two was enough");
  assert.equal(prMatches(p, parseSearch("author:mara")), false);
  assert.equal(prMatches(p, parseSearch("is:draft")), false, "an open pull request passed as a draft");
  assert.equal(prMatches(pr({ state: "draft" }), parseSearch("is:draft")), true);
  assert.equal(prMatches(p, parseSearch("is:mine")), false);
});

test("Drafts asked for on the Issues page find no issue, rather than the filter being ignored", () => {
  assert.equal(issueMatches(issue({}), parseSearch("is:draft")), false);
  assert.equal(issueMatches(issue({ assignedToMe: true }), parseSearch("is:mine")), true);
  assert.equal(issueMatches(issue({ key: "LIN-12", tracker: "linear" }), parseSearch("lin-12")), true);
});

test("Pull requests group as Needs your review, Yours and Others, newest first, empty groups left out", () => {
  const list = [pr({ number: 1, mine: true, updatedAt: 1 }), pr({ number: 2, reviewRequested: true, updatedAt: 5 }), pr({ number: 3, updatedAt: 9 }), pr({ number: 4, mine: true, updatedAt: 7 }), pr({ number: 5, reviewRequested: true, mine: true, updatedAt: 3 })];
  const g = groupPrs(list);
  assert.deepEqual(g.map((x) => x.name), ["Needs your review", "Yours", "Others"]);
  assert.deepEqual(g[0].items.map((p) => p.number), [2]);
  // Your own pull request is never one waiting for your review, even when you are asked on it.
  assert.deepEqual(g[1].items.map((p) => p.number), [4, 5, 1]);
  assert.deepEqual(g[2].items.map((p) => p.number), [3]);
  assert.deepEqual(groupPrs([pr({ mine: true })]).map((x) => x.id), ["yours"]);
  assert.deepEqual(groupPrs(list, "size").length, 3);
});

test("Issues group as Assigned to you, then Everyone else", () => {
  const g = groupIssues([issue({ key: "#1", updatedAt: 1 }), issue({ key: "#2", assignedToMe: true }), issue({ key: "#3", updatedAt: 4 })]);
  assert.deepEqual(g.map((x) => x.name), ["Assigned to you", "Everyone else"]);
  assert.deepEqual(g[1].items.map((i) => i.key), ["#3", "#1"]);
});

test("Checks are said in a few characters, and none reported is nothing", () => {
  assert.equal(checksSaid(undefined), null);
  assert.equal(checksSaid({ passed: 0, failed: 0, pending: 0 }), null);
  assert.deepEqual(checksSaid({ passed: 5, failed: 1, pending: 0, failing: ["lint"] }), { tone: "bad", short: "1 failing", long: "1 of 6 failing", failing: ["lint"] });
  assert.equal(checksSaid({ passed: 5, failed: 0, pending: 0 })?.short, "5/5");
  assert.equal(checksSaid({ passed: 3, failed: 0, pending: 2 })?.short, "2 running");
});

test("The amber dot shows only for an open pull request someone else asked you to review", () => {
  assert.equal(waitsOnYourReview([pr({ reviewRequested: true })]), true);
  assert.equal(waitsOnYourReview([pr({ reviewRequested: true, mine: true })]), false);
  assert.equal(waitsOnYourReview([pr({ reviewRequested: true, state: "merged" })]), false);
  assert.equal(waitsOnYourReview([]), false);
});

test("A session's pull request is said on its row by number and how it stands", () => {
  const p = (state: string, checks?: NonNullable<Thread["pr"]>["checks"]) => ({ number: 129, url: "", state, checks }) as NonNullable<Thread["pr"]>;
  assert.equal(prLine(p("OPEN", { state: "passed" } as never)).text, "#129 is ready to merge");
  assert.equal(prLine(p("OPEN")).text, "#129 waits for review");
  assert.deepEqual(prLine(p("OPEN", { state: "failed", failed: 1 } as never)), { text: "#129: 1 check failed", tone: "danger", num: "bad" });
  assert.equal(prLine(p("OPEN", { state: "running" } as never)).text, "#129's checks are running");
  assert.equal(prLine(p("MERGED")).text, "#129 is merged");
  assert.equal(prLine(p("closed")).text, "#129 was closed");
});

test("A session started from a pull request or an issue is told which, where it is, and to reference it", () => {
  const b = prBrief(pr({ number: 131, title: "Store tide alerts", branch: "liner/alerts", checks: { passed: 5, failed: 1, pending: 0, failing: ["lint"] }, body: "x".repeat(4000) }));
  assert.match(b, /Pull request #131, "Store tide alerts", by devon: liner\/alerts into main\./);
  assert.match(b, /Failing: lint\./);
  assert.ok(b.length < 2200, "a long body went whole into the brief");
  assert.match(b, /Don't push, comment or merge unless I ask\./);
  const i = issueBrief(issue({ key: "#42", number: 42, title: "Alerts show for the wrong harbour", body: "Signed in as Whitby." }));
  assert.match(i, /^Issue #42: Alerts show for the wrong harbour/);
  assert.match(i, /Mention #42 in the commit message/);
  assert.match(issueBrief(issue({ tracker: "linear", key: "LIN-12", number: undefined })), /Mention LIN-12/);
});

test("The page's head says how many and in how many projects", () => {
  assert.equal(headCount([{ projectId: "a" }, { projectId: "a" }, { projectId: "b" }], "open"), "3 open in 2 projects");
  assert.equal(headCount([{ projectId: "a" }], "merged"), "1 merged in 1 project");
  assert.equal(headCount([], "open"), "Nothing open");
  assert.equal(headCount([{ projectId: "a" }], "all"), "1 in 1 project");
});

test("Small words: an age, a label's colour, a path split for the files list", () => {
  const now = 10 * 86400000;
  assert.equal(age(now - 30_000, now), "now");
  assert.equal(age(now - 9 * 60000, now), "9m");
  assert.equal(age(now - 5 * 3600000, now), "5h");
  assert.equal(age(now - 3 * 86400000, now), "3d");
  assert.equal(labelColor("d73a4a"), "#d73a4a");
  assert.equal(labelColor("red; background:url(x)"), undefined, "a label's colour went into the style unchecked");
  assert.deepEqual(splitPath("src/alerts/store.ts"), { dir: "src/alerts/", name: "store.ts" });
  assert.deepEqual(splitPath("README.md"), { dir: "", name: "README.md" });
});

test("The usage ring shows the chosen tool's busiest window, and nothing for a tool with no limit", () => {
  const now = 1_000_000;
  const limits: ToolLimits[] = [
    { provider: "claude", label: "Claude Code", windows: [{ label: "5-hour window", usedPercent: 38.4, kind: "session", minutes: 300 }, { label: "Weekly", usedPercent: 12, kind: "weekly", minutes: 10080 }], at: 0 },
    { provider: "opencode", label: "OpenCode Go", windows: [{ label: "Monthly", usedPercent: 90, kind: "monthly" }], at: 0, models: "opencode-go" },
  ] as ToolLimits[];
  assert.deepEqual(ringOf(limits, "claude:sonnet", now), { pct: 38, tip: "Claude Code: 38% of the 5-hour limit used", high: false });
  assert.equal(ringOf(limits, "codex:gpt", now), null);
  // OpenCode Go's limits are Go's models' only, not Zen's.
  assert.equal(ringOf(limits, "opencode:opencode-zen/x", now), null);
  assert.equal(ringOf(limits, "opencode:opencode-go/kimi", now)?.high, true);
  // A window whose reset has passed is empty until the tool is asked again.
  const reset = [{ provider: "claude", label: "Claude Code", windows: [{ label: "5-hour window", usedPercent: 99, resetsAt: now - 1, minutes: 300 }], at: 0 }] as ToolLimits[];
  assert.equal(ringOf(reset, "claude:opus", now)?.pct, 0);
  assert.equal(spanWord({ label: "Short window", usedPercent: 1 }), "short");
});

test("An app waiting on your yes is said on its session's row by what it asks", () => {
  assert.equal(appAskWords("Grok Bot", "liner_start"), "Grok Bot asks to start it");
  assert.equal(appAskWords("Muse", "liner_send"), "Muse asks to send to it");
  assert.equal(appAskWords("Claude", "liner_stop"), "Claude asks to stop it");
  assert.equal(appAskWords("Claude", "liner_something_new"), "Claude asks first");
});

test("A session on a pull request uses a local branch only when its tip is the pull request's head", () => {
  const head = "a".repeat(40);
  const local = { branches: [{ name: "main", sha: "b".repeat(40) }, { name: "liner/alerts", sha: head }], worktrees: [] };
  // A fork's head named main is other code than this Mac's main: the session checks it out with gh.
  assert.deepEqual(prStart({ branch: "main", headSha: head }, local), { checkout: true }, "a local branch merely named like a fork's head was used as the base");
  assert.deepEqual(prStart({ branch: "liner/alerts", headSha: head.toUpperCase() }, local), { base: "liner/alerts" });
  // With no head SHA to compare, a same-named branch is never trusted.
  assert.deepEqual(prStart({ branch: "liner/alerts" }, local), { checkout: true });
  assert.deepEqual(prStart({ branch: "liner/alerts", headSha: head }, null), { checkout: true });
  const trees = { branches: [], worktrees: [{ path: "/w/a", branch: "liner/alerts", sha: head }, { path: "/w/b", branch: "liner/alerts", sha: head, threadId: "th1" }] };
  assert.deepEqual(prStart({ branch: "liner/alerts", headSha: head }, trees), { inWorktree: "/w/a" });
  assert.deepEqual(prStart({ branch: "liner/alerts", headSha: head }, { branches: [], worktrees: [{ path: "/w/a", branch: "liner/alerts", sha: "c".repeat(40) }] }), { checkout: true });
});

test("A Linear issue is never checked or started under the project id linear", () => {
  const ids = ["fs"];
  assert.equal(canCheckIssue({ tracker: "linear", projectId: "linear" }, ids), false, "a Linear issue offered Check, which fails for want of a project");
  assert.equal(canCheckIssue({ tracker: "github", projectId: "fs" }, ids), true);
  assert.equal(canCheckIssue({ tracker: "github", projectId: "gone" }, ids), false);
  assert.equal(issueProject({ tracker: "linear", projectId: "linear" }, ["linear", ...ids]), null, "a Linear issue started a session with the project id linear");
  assert.equal(issueProject({ tracker: "github", projectId: "fs" }, ids), "fs");
});

test("A press before the pull request's detail came still compares against its head commit, read from the detail", () => {
  assert.equal(headShaOf({}, { headSha: "abc" }), "abc", "a press with no head SHA of its own ignored the detail read for it");
  assert.equal(headShaOf({ headSha: "def" }, { headSha: "abc" }), "def");
  assert.equal(headShaOf({}, null), undefined);
  assert.equal(headShaOf({ headSha: "" }, {}), undefined);
});
