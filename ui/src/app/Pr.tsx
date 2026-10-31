/*
  Pull requests, from the GitHub CLI. The Pull request surface is the PR card (PrCard.tsx) on
  this session's branch: your commits as rows under Merge into the base, what reached the base
  beside them, each clash with its two lines, the checks, and Squash and merge once it's ready.
  A real agent drives it (see sessionPrAgent), with Liner's PR flow's events.
  Linked pull requests lists the project's, with the one this session opened on top, and says
  what each waits on.
  Asking for a pull request in the chat ("create pr", /pr) puts the same card in the conversation.
  There it runs the project's tests on this Mac before anything is pushed: a check on the card,
  the usual request first when the session asks first, and the output in a console under it.
*/
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PR_TEST_TOOL, type Item, type PrInfo, type PrPicture, type Thread } from "@contracts";
import type { PrAgent, PrCheck, PrCommit, PrConflict, PrEvent, PrStage } from "@liner/pro/pr-flow/pr-flow";
import { Switch } from "@liner/components/switch/switch";
import { toast } from "@liner/components/toast/toast";
import { Segmented } from "@liner/components/segmented/segmented";
import { bridge } from "./bridge";
import { getState, isCheckpoint, rpc, subscribe, useEngine, useItemsWhere } from "./engine";
import { I, Rays } from "./icons";
import { agentOf, checkpointsOf, duration, plural, sumLines } from "./model";
import { PrCard } from "./PrCard";
import { prLine, SurfaceNote } from "./Surfaces";
import { Badge, Lines } from "./ui";

type Gh = "ready" | "missing" | "signed-out" | "no-remote";

function GhNote({ gh, detail, onRetry }: { gh: Gh; detail?: string; onRetry: () => void }) {
  if (gh === "missing")
    return (
      <SurfaceNote icon={<I.pr size={20} />} title="Pull requests need the GitHub CLI" action={<button type="button" className="lc-btn" data-kind="plain" onClick={() => bridge.runInTerminal("brew install gh && gh auth login")}>Install it in Terminal</button>}>
        Liner Code reads and opens pull requests through <span className="lc-code">gh</span>, signed in as you.
      </SurfaceNote>
    );
  if (gh === "signed-out")
    return (
      <SurfaceNote
        icon={<I.pr size={20} />}
        title="Sign in to GitHub first"
        action={
          <span className="lc-noproj-acts">
            <button type="button" className="lc-btn" data-kind="primary" onClick={() => bridge.runInTerminal("gh auth login")}>
              Sign in in Terminal
            </button>
            <button type="button" className="lc-btn" data-kind="plain" onClick={onRetry}>
              I've signed in
            </button>
          </span>
        }
      >
        {detail ?? "The GitHub CLI is installed but not signed in."}
      </SurfaceNote>
    );
  return (
    <SurfaceNote icon={<I.pr size={20} />} title="This project has no GitHub remote" action={<button type="button" className="lc-btn" data-kind="plain" onClick={onRetry}>Look again</button>}>
      Push it to GitHub first, with <span className="lc-code">gh repo create</span> or a remote of your own. Then its pull requests show here.
    </SurfaceNote>
  );
}

const stateBadge = (pr: PrInfo) =>
  pr.state === "MERGED" ? <Badge tone="accent">Merged</Badge> : pr.state === "CLOSED" ? <Badge tone="neutral">Closed</Badge> : pr.isDraft ? <Badge tone="neutral">Draft</Badge> : <Badge tone="ok">Open</Badge>;

const CHECK: Record<PrInfo["checks"][number]["state"], PrCheck["state"]> = { pass: "passed", fail: "failed", pending: "running", skipped: "passed" };
const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = window.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (window.clearTimeout(t), reject(new DOMException("Stopped", "AbortError"))), { once: true });
  });
const names = (list: string[]) => (list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : (list[0] ?? ""));

type Emit = (e: PrEvent) => void;
type Tool = Extract<Item, { kind: "tool" }>;

/** Keeps the card's own check, the tests on this Mac, ahead of the ones GitHub reports. */
function localCheck() {
  let local: PrCheck | null = null;
  let rest: PrCheck[] = [];
  let raw: Emit | null = null;
  const show = () => raw?.({ type: "checks", checks: local ? [local, ...rest] : rest });
  return {
    wrap: (emit: Emit): Emit => {
      raw = emit;
      return (e) => (e.type === "checks" ? ((rest = e.checks), show()) : emit(e));
    },
    set: (c: PrCheck | null) => ((local = c), show()),
  };
}

const untilStopped = <T,>(p: Promise<T>, signal: AbortSignal) =>
  new Promise<T>((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError")), { once: true });
    p.then(resolve, reject);
  });

/**
  The project's tests on this Mac, before anything is pushed. The check follows what the engine
  puts in the card's turn (the request, then the run); false when they failed or were stopped,
  and the card says why. Leaving the card doesn't stop them: opening it again waits for that run.
*/
async function testFirst(o: { threadId: string; itemId: string; agentName: string }, emit: Emit, signal: AbortSignal, set: (c: PrCheck | null) => void) {
  const label = "On this Mac";
  let said = "";
  const say = (text: string) => text !== said && (emit({ type: "status", text }), (said = text));
  say("Finding the project's tests");
  let state = "";
  const follow = () => {
    const items = getState().items[o.threadId] ?? [];
    const ask = items.find((x) => x.kind === "approval" && x.tool === PR_TEST_TOOL && x.state === "asking");
    const run = items.findLast((x) => x.kind === "tool" && x.tool === PR_TEST_TOOL && x.status === "running");
    const now = ask ? "ask" : run ? "run" : state;
    if (now === state) return;
    state = now;
    if (ask?.kind === "approval") {
      set({ id: "local", label, state: "queued", result: "Needs your OK" });
      say(`Waiting for you to allow ${ask.title.replace(/^Run /, "")}`);
    } else if (run?.kind === "tool") {
      set({ id: "local", label, state: "running" });
      say(`Running ${run.input ?? "the tests"} on this Mac`);
    }
  };
  const stop = subscribe(follow);
  try {
    follow();
    const r = await untilStopped(rpc("pr.test", { threadId: o.threadId, itemId: o.itemId }), signal);
    const detail = r.command ? `${r.command} · ${r.summary}${r.seconds ? ` · ${duration(r.seconds)}` : ""}` : undefined;
    if (r.state === "passed") {
      set({ id: "local", label, state: "passed", result: r.summary, detail });
      say(`${r.command} passed on this Mac`);
      return true;
    }
    if (r.state === "failed") {
      // The tile is narrow: what failed; the note says the rest.
      set({ id: "local", label, state: "failed", result: r.summary.split(",")[0], detail });
      emit({ type: "message", text: `\`${r.command}\` failed on this Mac: ${r.summary}. Nothing was pushed. ${o.agentName} can fix it; then open it again.` });
      emit({ type: "status", text: "" });
      emit({ type: "stage", stage: "idle" });
      return false;
    }
    set(null);
    if (r.summary === "Stopped") {
      emit({ type: "message", text: "The tests were stopped, so nothing was pushed." });
      emit({ type: "status", text: "" });
      emit({ type: "stage", stage: "idle" });
      return false;
    }
    say(r.summary === "You said no" ? `You said no to ${r.command}, so it goes up untested` : "No tests to run on this Mac");
    return true;
  } finally {
    stop();
  }
}

/**
  The agent behind the card: it opens the pull request from this branch (writing its text when
  you haven't), watches the checks, shows what reached the base and where it clashes, sends
  the session's agent to bring the base in, and merges. Each step reports to the card.
*/
function sessionPrAgent(o: { thread: Thread; agentName: string; fields: () => { title: string; body: string; draft: boolean } | null; seen: () => boolean; onChange: () => void; itemId?: string }): PrAgent {
  const threadId = o.thread.id;
  const local = localCheck();
  let last: PrPicture | null = null;
  let number = 0;
  const look = async (emit: (e: PrEvent) => void) => {
    const [st, pic] = await Promise.all([rpc("pr.status", { threadId }), rpc("pr.picture", { threadId })]);
    last = pic;
    const mine: PrCommit[] = (st.pr?.commits.length ? st.pr.commits : pic.branchCommits).map((c) => ({ id: c.sha, title: c.title, lane: "branch", hash: c.sha.slice(0, 7) }));
    const theirs: PrCommit[] = pic.baseCommits.map((c) => ({ id: `base-${c.sha}`, title: c.title, lane: "base", hash: c.sha, who: c.who, when: c.when }));
    emit({ type: "commits", commits: [...mine, ...theirs] });
    return { st, pic };
  };
  const moved = (pic: PrPicture) => (pic.baseCommits.length ? `\`${pic.base}\` moved on while ${o.agentName} worked: ${names([...new Set(pic.baseCommits.map((c) => c.who))].slice(0, 3))} landed ${plural(pic.baseCommits.length, "commit")}` : "");
  // Until it's your turn again: every check settled, a clash with the base, or merged.
  const watch = async (emit: (e: PrEvent) => void, signal: AbortSignal) => {
    let said = "";
    const say = (text: string) => text !== said && (emit({ type: "message", text }), (said = text));
    for (;;) {
      const { st, pic } = await look(emit);
      const pr = st.pr;
      if (!pr) {
        emit({ type: "stage", stage: "idle" });
        return;
      }
      number = pr.number;
      emit({ type: "pr", number: pr.number, url: pr.url });
      emit({ type: "checks", checks: pr.checks.map((c) => ({ id: c.name, label: c.name, state: CHECK[c.state], result: c.state === "skipped" ? "Skipped" : undefined })) });
      if (pr.state === "MERGED") {
        say(`Merged into \`${pr.base}\`.`);
        emit({ type: "status", text: `Merged into ${pr.base}` });
        emit({ type: "stage", stage: "merged" });
        o.onChange();
        return;
      }
      if (pr.state === "CLOSED") {
        say("It was closed on GitHub without merging.");
        emit({ type: "status", text: "" });
        emit({ type: "stage", stage: "idle" });
        return;
      }
      if (pic.conflicts.length || pr.mergeable === "CONFLICTING") {
        emit({ type: "conflicts", conflicts: pic.conflicts });
        say(`${moved(pic) || `\`${pic.base}\` changed`}, on the same lines as yours. ${o.agentName} can bring \`${pic.base}\` in and keep both sides.`);
        emit({ type: "status", text: `${plural(Math.max(pic.conflicts.length, 1), "conflict")} with ${pic.base}` });
        emit({ type: "stage", stage: "conflicts" });
        return;
      }
      const pending = pr.checks.filter((c) => c.state === "pending").length;
      const passed = pr.checks.filter((c) => c.state === "pass").length;
      if (!pending && pr.mergeable !== "UNKNOWN") {
        const failed = pr.checks.filter((c) => c.state === "fail").map((c) => c.name);
        say(failed.length ? `${names(failed)} failed. You can merge anyway, or ask ${o.agentName} to fix ${failed.length === 1 ? "it" : "them"}.` : `${moved(pic) ? `${moved(pic)}, with no overlap. ` : ""}${pr.checks.length ? "Every check passed." : "Nothing runs on this repository's pull requests."}`);
        emit({ type: "status", text: failed.length ? `${plural(failed.length, "check")} failed` : `Ready to merge into ${pr.base}` });
        emit({ type: "stage", stage: "ready" });
        return;
      }
      emit({ type: "stage", stage: "checking" });
      emit({ type: "status", text: pr.checks.length ? `Running the checks, ${passed} of ${pr.checks.length}` : "Waiting for GitHub to look at it" });
      await pause(o.seen() ? 8000 : 25000, signal);
    }
  };
  // A step that fails says why, in the card's note, and goes back to where you can press again.
  const guarded =
    (back: PrStage, step: (emit: (e: PrEvent) => void, signal: AbortSignal) => Promise<void>) =>
    async (raw: (e: PrEvent) => void, signal: AbortSignal) => {
      const emit = local.wrap(raw);
      try {
        await step(emit, signal);
      } catch (e) {
        if ((e as Error).name === "AbortError") throw e;
        emit({ type: "message", text: (e instanceof Error ? e.message : String(e)).split("\n")[0].slice(0, 300) || "That didn't work." });
        emit({ type: "status", text: "" });
        emit({ type: "stage", stage: back });
      }
    };
  return {
    create: guarded("idle", async (emit, signal) => {
      emit({ type: "status", text: "Looking at the branch" });
      const { st, pic } = await look(emit);
      if (!st.pr) {
        if (!pic.ahead) {
          emit({ type: "message", text: "Nothing is committed on this branch yet. Commit the changes from the Diff tab first; the pull request carries what's committed." });
          emit({ type: "stage", stage: "idle" });
          return;
        }
        // From the chat, the tests run on this Mac first.
        if (o.itemId && !(await testFirst({ threadId, itemId: o.itemId, agentName: o.agentName }, emit, signal, local.set))) return;
        const f = o.fields();
        let title = f?.title.trim() ?? "";
        let body = f?.body.trim() ?? "";
        if (!title) {
          emit({ type: "status", text: "Writing the title and description from the branch" });
          const d = await rpc("pr.draft", { threadId });
          title = d.title;
          body = body || d.body;
        }
        emit({ type: "status", text: `Pushing ${pic.branch} and opening it` });
        await rpc("pr.create", { threadId, title, body, draft: f?.draft ?? false });
        o.onChange();
      }
      emit({ type: "stage", stage: "checking" });
      await watch(emit, signal);
    }),
    resolve: guarded("conflicts", async (emit, signal) => {
      const pic = last ?? (await rpc("pr.picture", { threadId }));
      emit({ type: "stage", stage: "resolving" });
      emit({ type: "status", text: `Asking ${o.agentName} to bring ${pic.base} in` });
      const files = [...new Set(pic.conflicts.map((k) => k.file))];
      await rpc("thread.send", { id: threadId, text: `\`${pic.branch}\` conflicts with \`${pic.base}\`${files.length ? ` in ${names(files)}` : ""}. Bring ${pic.base} into it, resolve the conflicts keeping what both sides meant, run the tests and push.`, mode: o.thread.status === "running" ? "queue" : undefined });
      const was = pic.conflicts;
      for (;;) {
        await pause(o.seen() ? 8000 : 25000, signal);
        const { st, pic: now } = await look(emit);
        if (!now.conflicts.length && st.pr?.mergeable !== "CONFLICTING") {
          // Settled: each pair folds into the line your branch has now.
          emit({ type: "conflicts", conflicts: was.map((k) => ({ ...k, resolved: k.yours })) });
          emit({ type: "message", text: `${o.agentName} brought \`${now.base}\` in and pushed. The checks run again.` });
          emit({ type: "stage", stage: "testing" });
          break;
        }
        emit({ type: "status", text: `${o.agentName} is on it: ${plural(now.conflicts.length || was.length, "conflict")} left` });
      }
      await watch(emit, signal);
    }),
    merge: guarded("ready", async (emit) => {
      emit({ type: "stage", stage: "merging" });
      emit({ type: "status", text: "Squashing and merging" });
      await rpc("pr.merge", { projectId: o.thread.projectId, number });
      emit({ type: "message", text: `Merged into \`${last?.base ?? "main"}\`.` });
      emit({ type: "status", text: `Merged into ${last?.base ?? "main"}` });
      emit({ type: "stage", stage: "merged" });
      o.onChange();
    }),
  };
}

export function PrSurface({ thread, agentName, visible }: { thread: Thread; agentName: string; visible: boolean }) {
  const [st, setSt] = useState<{ pr: PrInfo | null; branch?: string; ahead?: number; gh: Gh; detail?: string } | null>(null);
  const [n, setN] = useState(0);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [draft, setDraft] = useState(false);
  const [editing, setEditing] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [diff, setDiff] = useState<{ add: number; del: number } | undefined>();
  const seen = useRef(visible);
  seen.current = visible;
  const fields = useRef({ title, body, draft });
  fields.current = { title, body, draft };

  useEffect(() => {
    let live = true;
    const get = () =>
      rpc("pr.status", { threadId: thread.id })
        .then((s) => live && setSt(s))
        .catch((e) => live && setSt({ pr: null, gh: "no-remote", detail: e instanceof Error ? e.message : String(e) }));
    void get();
    void rpc("pr.picture", { threadId: thread.id })
      .then((p) => live && setDiff(p.diff))
      .catch(() => {});
    // The card watches its own checks; this keeps the reviews under it current.
    const t = visible ? window.setInterval(get, 30000) : 0;
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, [thread.id, n, visible]);

  // Made once per session's card, so the steps it's running survive a re-render.
  const agent = useMemo(() => sessionPrAgent({ thread, agentName, fields: () => (editing || fields.current.title || fields.current.body ? fields.current : null), seen: () => seen.current, onChange: () => setN((x) => x + 1) }), [thread.id]);

  const draftIt = async () => {
    setDrafting(true);
    try {
      const r = await rpc("pr.draft", { threadId: thread.id });
      setTitle(r.title);
      setBody(r.body);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setDrafting(false);
    }
  };

  if (!st) return <SurfaceNote icon={<I.pr size={20} />} title="Asking GitHub" />;
  if (st.gh !== "ready") return <GhNote gh={st.gh} detail={st.detail} onRetry={() => setN((x) => x + 1)} />;
  const pr = st.pr;
  const approved = pr?.reviews.filter((r) => r.state === "APPROVED").length ?? 0;

  return (
    <div className="lc-pr">
      <div className="lc-pr-scroll">
        <PrCard
          key={thread.id}
          variant="panel"
          title={pr?.title ?? (title.trim() || thread.title)}
          branch={st.branch ?? "this branch"}
          base={pr?.base ?? "main"}
          agent={agent}
          diff={pr ? { add: pr.additions, del: pr.deletions } : (diff ?? { add: 0, del: 0 })}
          start={Boolean(pr)}
        />

        {!pr && (
          <div className="lc-pr-sec lc-pr-edit" data-open={editing || undefined}>
            <button type="button" className="lc-pr-lab lc-pr-fold l-focus" aria-expanded={editing} onClick={() => setEditing((e) => !e)}>
              <I.chevR size={11} />
              Title and description
              <span>{editing ? "Yours, if you write them" : "Written from the branch"}</span>
            </button>
            <div className="lc-fold">
              <div>
                <div className="lc-pr-new">
                  <div className="lc-pr-write">
                    <button type="button" className="lc-btn" data-kind="plain" data-size="sm" disabled={drafting || !st.ahead} onClick={() => void draftIt()}>
                      <I.sparkle size={12} />
                      {drafting ? "Writing it" : "Write it for me"}
                    </button>
                    <span className="lc-quiet">From the branch's changes, its commits and what the session checked</span>
                  </div>
                  <label className="lc-pr-field">
                    <span>Title</span>
                    <input className="lc-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={thread.title} />
                  </label>
                  <label className="lc-pr-field">
                    <span>What it does</span>
                    <textarea className="lc-input lc-pr-body" value={body} onChange={(e) => setBody(e.target.value)} placeholder={`A few lines for the reviewer. ${agentName} can write it: ask in the session.`} />
                  </label>
                  <Switch size="sm" checked={draft} onCheckedChange={setDraft} label="Open it as a draft" />
                </div>
              </div>
            </div>
          </div>
        )}

        {pr && (pr.reviews.length > 0 || pr.requested.length > 0) && (
          <div className="lc-pr-sec">
            <div className="lc-pr-lab">
              Reviews
              <span>{`${approved} of ${Math.max(pr.reviews.length + pr.requested.length, 1)} approved`}</span>
            </div>
            {pr.reviews.map((r, i) => (
              <div key={`${r.author}-${i}`} className="lc-pr-person">
                <span className="lc-me-av">{r.author.slice(0, 2).toUpperCase()}</span>
                <b>{r.author}</b>
                <span className="lc-grow" />
                <Badge tone={r.state === "APPROVED" ? "ok" : r.state === "CHANGES_REQUESTED" ? "danger" : "neutral"}>{r.state === "APPROVED" ? "Approved" : r.state === "CHANGES_REQUESTED" ? "Asked for changes" : "Commented"}</Badge>
              </div>
            ))}
            {pr.requested.map((p) => (
              <div key={p} className="lc-pr-person">
                <span className="lc-me-av">{p.slice(0, 2).toUpperCase()}</span>
                <b>{p}</b>
                <span className="lc-grow" />
                <Badge tone="warn">Waiting</Badge>
              </div>
            ))}
          </div>
        )}
        {pr && (
          <p className="lc-pr-out">
            <button type="button" className="lc-linkbtn l-focus" onClick={() => bridge.openExternal(pr.url)}>
              Open #{pr.number} on GitHub
            </button>
            {pr.author && <span className="lc-quiet"> · by {pr.author}</span>}
          </p>
        )}
      </div>
    </div>
  );
}

/**
  The Demo's pull request, played on its sample project: the tide fix goes up, `main` has moved
  on under it (the harbour feed now gives heights), the two clash on two lines, and each fix
  keeps both sides. Nothing reaches GitHub.
*/
function demoPrAgent(threadId: string, itemId: string, branch: string, base: string, agentName: string): PrAgent {
  const local = localCheck();
  let commits: PrCommit[] = [];
  let conflicts: PrConflict[] = [];
  const mine: PrCommit[] = [
    { id: "d1", title: "Wrap round to tomorrow's first high tide", lane: "branch", hash: "4c1e9a0", who: "You", when: "12m ago" },
    { id: "d2", title: "Say tomorrow in the label", lane: "branch", hash: "b72d5f3", who: "You", when: "3m ago" },
  ];
  const landed: PrCommit = { id: "e1", title: "Read heights from the harbour feed", lane: "base", hash: "e9a4c27", who: "Mara", when: "20m ago" };
  const clashes: PrConflict[] = [
    { id: "k1", file: "src/tides.js", line: 1, base: "// Returns the next high tide after `from`, with its height.", yours: "// Returns the next high tide after `from`, or tomorrow's first.", commit: "e1" },
    { id: "k2", file: "src/tides.js", line: 12, base: "return `High tide at ${t.at}, ${t.height} m`;", yours: 'return `High tide at ${t.at}${t.tomorrow ? " tomorrow" : ""}`;', commit: "e1" },
  ];
  const fixes: Record<string, string> = {
    k1: "// Returns the next high tide after `from` with its height, or tomorrow's first.",
    k2: 'return `High tide at ${t.at}${t.tomorrow ? " tomorrow" : ""}, ${t.height} m`;',
  };
  // When each check finishes, in ticks of the run below.
  const plan = [
    { id: "tests", label: "Tests", ends: 16, result: "3 passed", detail: "node --test · 3 passed, 0 failed · 0.4s", of: 3 },
    { id: "lint", label: "Lint", ends: 9, result: "Clean", detail: "eslint · no warnings · 2s" },
  ];
  const setCommits = (emit: (e: PrEvent) => void, next: PrCommit[]) => {
    commits = next;
    emit({ type: "commits", commits });
  };
  const patch = (emit: (e: PrEvent) => void, id: string, p: Partial<PrConflict>) => {
    conflicts = conflicts.map((k) => (k.id === id ? { ...k, ...p } : k));
    emit({ type: "conflicts", conflicts });
  };
  return {
    async create(raw, signal) {
      const emit = local.wrap(raw);
      emit({ type: "status", text: "Looking at the branch" });
      await pause(700, signal);
      // The story is played, but the tests are the sample project's own, run for real.
      if (!(await testFirst({ threadId, itemId, agentName }, emit, signal, local.set))) return;
      emit({ type: "status", text: `Pushing ${plural(mine.length, "commit")}` });
      setCommits(emit, mine);
      await pause(1100, signal);
      emit({ type: "status", text: "Opening the pull request" });
      await pause(700, signal);
      emit({ type: "pr", number: 7 });
      emit({ type: "message", text: `Opened #7 with your two commits. Checking it against \`${base}\` before anyone reviews it.` });
      emit({ type: "stage", stage: "checking" });
      emit({ type: "status", text: `Fetching ${base}` });
      await pause(1000, signal);
      setCommits(emit, [...commits, landed]);
      emit({ type: "status", text: "Checking it merges cleanly" });
      await pause(1100, signal);
      conflicts = clashes;
      emit({ type: "conflicts", conflicts });
      emit({ type: "stage", stage: "conflicts" });
      emit({ type: "status", text: `${plural(conflicts.length, "conflict")} with ${base}` });
      emit({ type: "message", text: `\`${base}\` moved on while ${agentName} worked: Mara made the label show each tide's height, on the same lines as yours. ${agentName} can bring \`${base}\` in and keep both sides.` });
    },
    async resolve(raw, signal) {
      const emit = local.wrap(raw);
      emit({ type: "stage", stage: "resolving" });
      emit({ type: "status", text: `Bringing ${base} into ${branch}` });
      await pause(500, signal);
      setCommits(emit, [...commits, { id: "dm", title: `Merge ${base} into ${branch}`, lane: "branch", merge: true, hash: "a51f0d8", who: agentName, when: "just now" }]);
      await pause(900, signal);
      for (let i = 0; i < conflicts.length; i++) {
        const id = conflicts[i].id;
        emit({ type: "status", text: `Resolving ${i + 1} of ${conflicts.length}` });
        patch(emit, id, { active: true });
        await pause(1100, signal);
        patch(emit, id, { active: false, resolved: fixes[id] });
        await pause(380, signal);
      }
      emit({ type: "status", text: "Pushing the merge" });
      await pause(800, signal);
      emit({ type: "stage", stage: "testing" });
      emit({ type: "message", text: "Kept both sides each time: the label says tomorrow, and still shows the height. Running the checks." });
      const last = Math.max(...plan.map((p) => p.ends));
      for (let t = 0; t <= last; t++) {
        const checks = plan.map(({ id, label, ends, result, detail, of }): PrCheck => {
          if (t === 0) return { id, label, state: "queued" };
          if (t >= ends) return { id, label, state: "passed", result, detail };
          return of ? { id, label, state: "running", progress: t / ends, result: `${Math.floor((of * t) / ends)} of ${of}` } : { id, label, state: "running" };
        });
        emit({ type: "checks", checks });
        emit({ type: "status", text: t === 0 ? "Starting the checks" : t < last ? `Running the checks, ${checks.filter((k) => k.state === "passed").length} of ${checks.length}` : "Every check passed" });
        await pause(t === 0 ? 500 : 140, signal);
      }
      emit({ type: "stage", stage: "ready" });
      emit({ type: "status", text: `Ready to merge into ${base}` });
      emit({ type: "message", text: `Both checks passed. It's ready to go into \`${base}\` whenever you are.` });
    },
    async merge(raw, signal) {
      const emit = local.wrap(raw);
      emit({ type: "stage", stage: "merging" });
      emit({ type: "status", text: "Squashing and merging" });
      await pause(1200, signal);
      emit({ type: "stage", stage: "merged" });
      emit({ type: "status", text: `Merged into ${base}` });
      emit({ type: "message", text: `Merged into \`${base}\`. After the last high tide, the card shows tomorrow's first one, with its height.` });
    },
  };
}

/**
  "Create PR" in the chat: the PR card in the conversation. A session's card opens the pull
  request from its branch, like the surface's; the Demo's plays the story above. A card from an
  earlier visit picks up a pull request that's open, and otherwise waits for a press rather than
  opening another one by itself.
*/
export function PrChatCard({ threadId, it, fresh, run, ask }: { threadId: string; it: Extract<Item, { kind: "pr" }>; fresh: boolean; run?: Tool; ask?: (who: string) => ReactNode }) {
  const thread = useEngine((s) => s.threads.find((t) => t.id === threadId));
  // Only its checkpoints, so the card doesn't redraw with every word of a reply streaming beside it.
  const items = useItemsWhere(threadId, isCheckpoint);
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  const agentName = agentOf(thread?.agent, agents, providers).name;
  const [st, setSt] = useState<{ pr: PrInfo | null; branch?: string; gh: Gh; detail?: string; diff?: { add: number; del: number } } | null>(null);
  const [n, setN] = useState(0);
  // Asked just now: a new session's first message counts as already there, so its age decides too.
  const [live] = useState(() => fresh || Date.now() - it.at < 30000);

  useEffect(() => {
    if (it.demo) return;
    let live = true;
    void Promise.all([rpc("pr.status", { threadId }), rpc("pr.picture", { threadId }).catch(() => null)])
      .then(([s, p]) => live && setSt({ ...s, diff: p?.diff }))
      .catch((e) => live && setSt({ pr: null, gh: "no-remote", detail: e instanceof Error ? e.message : String(e) }));
    return () => {
      live = false;
    };
  }, [threadId, it.demo, n]);

  const branch = it.demo ? (thread?.worktree?.branch ?? "fix/tide-after-midnight") : (st?.branch ?? "this branch");
  // Made once per card, so the steps it's running survive a re-render.
  const agent = useMemo(
    () => (it.demo ? demoPrAgent(threadId, it.id, branch, "main", agentName) : thread ? sessionPrAgent({ thread, agentName, fields: () => null, seen: () => !document.hidden, onChange: () => setN((x) => x + 1), itemId: it.id }) : null),
    [it.id, Boolean(thread)],
  );
  if (!thread || !agent) return null;

  // Under the card: the request to run the tests while it waits, then their console.
  const under = (
    <>
      {ask?.(agentName)}
      {run && <PrConsole threadId={threadId} run={run} agentName={agentName} />}
    </>
  );
  if (it.demo) {
    const lines = sumLines(checkpointsOf(items ?? []).filter((c) => !c.reverted).flatMap((c) => c.files));
    return (
      <div className="lc-prchat">
        <PrCard key={it.id} title="Wrap round to tomorrow's first high tide" branch={branch} base="main" agent={agent} diff={lines.added || lines.removed ? { add: lines.added, del: lines.removed } : { add: 4, del: 1 }} start={live} />
        {under}
      </div>
    );
  }
  if (!st) return <p className="lc-notice">Asking GitHub</p>;
  if (st.gh !== "ready") return <GhNote gh={st.gh} detail={st.detail} onRetry={() => setN((x) => x + 1)} />;
  const pr = st.pr;
  return (
    <div className="lc-prchat">
      <PrCard key={it.id} title={pr?.title ?? thread.title} branch={branch} base={pr?.base ?? "main"} agent={agent} diff={pr ? { add: pr.additions, del: pr.deletions } : (st.diff ?? { add: 0, del: 0 })} start={live || Boolean(pr)} />
      {under}
    </div>
  );
}

/**
  The card's console: the tests it ran on this Mac, how they went, and their output as it comes.
  Open while they run and when they fail, folded once they pass. A failure can go straight to
  the session's agent, with the end of the output.
*/
function PrConsole({ threadId, run, agentName }: { threadId: string; run: Tool; agentName: string }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const [asked, setAsked] = useState(false);
  const busy = useEngine((s) => s.threads.find((t) => t.id === threadId)?.status === "running");
  const out = useRef<HTMLPreElement>(null);
  const running = run.status === "running";
  const isOpen = open ?? run.status !== "done";
  // The end stays in view: the newest lines while it runs, then where the runner says how it went.
  useEffect(() => {
    if (out.current) out.current.scrollTop = out.current.scrollHeight;
  }, [run.output, isOpen]);
  const fix = async () => {
    const end = (run.output ?? "").trim().split("\n").slice(-30).join("\n");
    try {
      await rpc("thread.send", { id: threadId, text: `\`${run.input}\` fails on this branch, so the pull request didn't go up. Fix what it reports, run it again, and commit the fix.${end ? `\n\nThe end of its output:\n\`\`\`\n${end}\n\`\`\`` : ""}`, mode: busy ? "queue" : undefined });
      setAsked(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="lc-prcon lc-frame" data-state={run.status} data-open={isOpen || undefined}>
      <div className="lc-fcard">
        <button type="button" className="lc-prcon-h l-focus" aria-expanded={isOpen} onClick={() => setOpen(!isOpen)}>
          <I.terminal size={14} />
          <code>{run.input}</code>
          <span className="lc-quiet">on this Mac</span>
          <span className="lc-grow" />
          <span className="lc-prcon-st" key={run.status}>
            {running ? <Rays size={11} /> : run.status === "done" ? <I.check size={12} /> : <I.close size={12} />}
            {running ? "Running" : run.status === "done" ? "Passed" : "Failed"}
          </span>
          {!running && <span className="lc-quiet l-num">{duration(run.seconds)}</span>}
          <I.chevR size={11} />
        </button>
        <div className="lc-fold">
          <div>
            <pre ref={out} className="lc-prcon-out">
              {run.output || "Starting…"}
            </pre>
          </div>
        </div>
        {run.status === "failed" && (
          <div className="lc-prcon-f">
            <span className="lc-quiet">Nothing was pushed.</span>
            <span className="lc-grow" />
            <button type="button" className="lc-btn" data-kind="plain" data-size="sm" disabled={asked} onClick={() => void fix()}>
              {asked ? `Asked ${agentName}` : `Ask ${agentName} to fix it`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function LinkedSurface({ thread, agentName, onOpenSession }: { thread: Thread; agentName: string; onOpenSession: (id: string) => void }) {
  const [st, setSt] = useState<{ prs: PrInfo[]; gh: Gh; detail?: string } | null>(null);
  const [which, setWhich] = useState<"open" | "all">("open");
  const [n, setN] = useState(0);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    void rpc("pr.list", { projectId: thread.projectId })
      .then((s) => live && setSt(s))
      .catch((e) => live && setSt({ prs: [], gh: "no-remote", detail: e instanceof Error ? e.message : String(e) }));
    return () => {
      live = false;
    };
  }, [thread.projectId, n]);

  if (!st) return <SurfaceNote icon={<I.link size={20} />} title="Asking GitHub" />;
  if (st.gh !== "ready") return <GhNote gh={st.gh} detail={st.detail} onRetry={() => setN((x) => x + 1)} />;

  const mine = (p: PrInfo) => p.threadId === thread.id || p.number === thread.pr?.number;
  const list = st.prs.filter((p) => which === "all" || p.state === "OPEN").sort((a, b) => Number(mine(b)) - Number(mine(a)));

  const merge = async (p: PrInfo) => {
    setBusy(p.number);
    try {
      await rpc("pr.merge", { projectId: thread.projectId, number: p.number });
      toast.success(`Merged #${p.number}`);
      setN((x) => x + 1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const resolve = async (p: PrInfo) => {
    const target = p.threadId ?? thread.id;
    try {
      await rpc("thread.send", { id: target, text: `#${p.number} (${p.head}) conflicts with ${p.base}. Bring ${p.base} into it, resolve the conflicts, run the tests and push.`, mode: "queue" });
      toast(p.threadId ? "Asked its session to resolve them" : `Asked ${agentName} to resolve them`);
      if (p.threadId && p.threadId !== thread.id) onOpenSession(p.threadId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="lc-linked">
      <div className="lc-linked-top">
        <Segmented
          size="sm"
          value={which}
          onValueChange={setWhich}
          options={[
            { value: "open", label: "Open" },
            { value: "all", label: "All" },
          ]}
          aria-label="Which pull requests"
        />
        <span className="lc-grow" />
        <button type="button" className="lc-ib l-focus" aria-label="Look again" title="Look again" onClick={() => setN((x) => x + 1)}>
          <I.refresh size={14} />
        </button>
      </div>
      <div className="lc-linked-list">
        {list.length === 0 && <p className="lc-quiet lc-pr-none">{which === "open" ? "No pull request is open in this project." : "This project has no pull requests yet."}</p>}
        {list.map((p, i) => {
          const failed = p.checks.some((c) => c.state === "fail");
          const pending = p.checks.some((c) => c.state === "pending");
          const conflict = p.mergeable === "CONFLICTING";
          const ready = p.state === "OPEN" && !p.isDraft && !conflict && !failed && !pending;
          const line = p.state === "MERGED" ? "Merged" : p.state === "CLOSED" ? "Closed" : conflict ? "Conflicts with the base branch" : failed ? "A check failed" : pending ? "Checks running" : p.reviewDecision === "CHANGES_REQUESTED" ? "Changes asked for" : ready ? "Ready to merge, and waiting for you" : prLine(p);
          return (
            <article key={p.number} className="lc-linked-card" style={{ animationDelay: `${i * 30}ms` }} data-mine={mine(p) || undefined}>
              <div className="lc-linked-h">
                <span className="lc-linked-t">
                  <b>{p.title}</b>
                  <small className="lc-quiet">
                    #{p.number} · {mine(p) ? "this session" : p.threadId ? "another session" : (p.author ?? "")} · <Lines added={p.additions} removed={p.deletions} />
                  </small>
                </span>
                {stateBadge(p)}
              </div>
              <div className="lc-linked-f">
                <span className="lc-linked-line" data-tone={conflict || failed ? "danger" : pending ? "warn" : undefined}>
                  {line}
                </span>
                <span className="lc-grow" />
                {p.threadId && p.threadId !== thread.id && (
                  <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => onOpenSession(p.threadId!)}>
                    Open its session
                  </button>
                )}
                {conflict && p.state === "OPEN" && (
                  <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => void resolve(p)}>
                    Resolve conflicts
                  </button>
                )}
                {ready && (
                  <button type="button" className="lc-btn" data-kind="primary" data-size="sm" disabled={busy !== null} onClick={() => void merge(p)}>
                    {busy === p.number ? "Merging" : "Merge"}
                  </button>
                )}
                <button type="button" className="lc-ib l-focus" aria-label={`Open #${p.number} on GitHub`} onClick={() => bridge.openExternal(p.url)}>
                  <I.push size={13} />
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
