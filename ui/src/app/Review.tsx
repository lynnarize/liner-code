/*
  Changes: one turn's diff, in the side panel and in the full canvas alike. Its top row is the turn,
  its totals, and the tools an engineer reaches for (step through the changes with the arrows or J
  and K, unified or split, wrap long lines, show spaces and tabs, the files as a menu, and ··· for
  find, fold every file, hide tests, copy as a patch and the full canvas). Each file's row says what
  happened to it, takes a Viewed tick, and opens the file in your editor in the desktop app. Press a
  line number (shift for a range) to ask the agent about those lines; its answer stays on those lines.
  The Reviewer's findings sit on the lines they name. Wrap starts on; it, spaces, hiding tests and the
  view are remembered, and so is what you've viewed, until the file changes again. In the full canvas
  (`wide`) the files keep a column of their own on the left with what the subagents checked, and the
  panel's tab row above is the paper's header; ··· and the right edge's menu lead back to the session.
*/
import { Fragment, memo, useContext, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { FileChange, FileDiff, Finding, Item, Thread } from "@contracts";
import type { Token } from "@liner/components/code-block/tokenize";
import { CodeDiff } from "@liner/pro/code-diff/code-diff";
import { diffRows, segment, type Row } from "@liner/pro/code-diff/diff";
import { toast } from "@liner/components/toast/toast";
import { prefersReducedMotion } from "@liner/lib/spring";
import { bridge } from "./bridge";
import { CommitButton } from "./Commit";
import { is, shortcutOf } from "./keymap";
import { isCheckpoint, rpc, useEngine, useItemsWhere } from "./engine";
import { I, ModelMark } from "./icons";
import { agentTask, isSidekick, whoIs } from "./Crew";
import { agentOf, ago, markOf, modelLabel, plural } from "./model";
import { baseOf, dirOf, langOf, linesOf, tokensOf, Toks } from "./code";
import { keptRead, keptWrite, wordRead, wordWrite } from "./kept.ts";
import { fileLetter, fileStatus, patchOf } from "./patch.ts";
import { ship } from "./Ship";
import { Lines, MenuFoot, ModelTag, PanelHead, Pop, Row as MenuRow, Sep, SubMenu } from "./ui";
import { SendBox } from "./Composer";
import { StreamedMarkdown } from "@liner/pro/ai-kit/streamed";
import { FindBar } from "./Find";
import { MoreFiles, SurfaceNote, TurnPicker } from "./Surfaces";
import { SideKeys } from "./TopBar";
import { PANE_PICK, PANE_TOOL, PaneButton, PaneCheck, PaneFile, PaneFoot, PaneHead, PaneStatus, PaneTool, PaneWords } from "./Pane";
import { linesSaid, moreFilesSaid, SPLIT_CHANGE, SPLIT_LINE, viewedSaid } from "./review-words.ts";
import { undoTurn } from "./undo";

type Checkpoint = Extract<Item, { kind: "checkpoint" }>;

/**
  A switch in Changes that's remembered: wrap, spaces and hide tests (T3 Code: diffs/useHideTestFiles.ts). `start` is
  what someone who never chose gets. Through kept.ts: with storage shut it starts at `start` and lasts until the window closes.
*/
function usePref(key: string, start = false) {
  const [on, set] = useState(() => wordRead(localStorage, key, ["1", "0"], start ? "1" : "0") === "1");
  const flip = (v: boolean) => {
    set(v);
    wordWrite(localStorage, key, v ? "1" : "0");
  };
  return [on, flip] as const;
}

/** The same function every render, calling the newest `f`: a memoised file's row doesn't redraw for a new one. */
function useStable<A extends unknown[]>(f: (...a: A) => void) {
  const now = useRef(f);
  now.current = f;
  return useState(() => (...a: A) => now.current(...a))[0];
}

/** What happened to a file, as its letter (patch.ts fileLetter, by git's word for it); PaneStatus says it in words for a screen reader. */
const statusOf = (p: Prepared) => fileLetter(p.file);

/** The width of a line's own indent, in characters (a tab to the next stop of 8, as the code draws it), for a wrapped line to hang under. */
function indentOf(line: Token[] | undefined) {
  let n = 0;
  for (const t of line ?? [])
    for (const ch of t.text) {
      if (ch === " ") n++;
      else if (ch === "\t") n += 8 - (n % 8);
      else return n;
    }
  return 0;
}

/**
  A line with its spaces and tabs shown: each stays the character it is, with a dot or an arrow drawn
  over it (surfaces.css, .lc-ws), so copying the line gives the text as it is.
*/
function Spaced({ line }: { line?: Token[] }) {
  const marked = (text: string) => text.split(/([ \t])/).map((s, j) => (s === " " || s === "\t" ? <span key={j} className="lc-ws" data-tab={s === "\t" || undefined}>{s}</span> : s));
  return <>{(line ?? []).map((t, k) => (t.kind ? <span key={k} className={`l-tok-${t.kind}`}>{marked(t.text)}</span> : <Fragment key={k}>{marked(t.text)}</Fragment>))}</>;
}

/** Tests and their support (mocks, fixtures, snapshots), by path alone (T3 Code: shared/changedFileKind.ts). */
const TEST_NAME = /(\.(test|spec|e2e)\.[^.]+$|_(test|spec)\.[^.]+$|^test_.+\.py$|^conftest\.py$|^(vitest|jest)\.setup\.[^.]+$)/i;
const CLASS_TEST = /(Tests?|Spec)\.(java|kt|kts|scala|groovy|cs|php|swift|m)$/;
const MOCK_NAME = /(\.snap$|\.(mocks?|fixtures?|stubs?|fakes?)\.[^.]+$|^(mocks?|fixtures?|stubs?|fakes?)([-_.A-Z]|$))/;
const TEST_DIRS = new Set(["__tests__", "__test__", "cypress", "e2e", "spec", "specs", "test", "tests", "__fixtures__", "__mocks__", "__snapshots__", "fakes", "fixture", "fixtures", "mock", "mocks", "stubs", "testdata"]);
export function isTestFile(path: string) {
  const parts = path.split("/");
  const name = parts.pop() ?? "";
  return TEST_NAME.test(name) || CLASS_TEST.test(name) || MOCK_NAME.test(name) || parts.some((d) => TEST_DIRS.has(d.toLowerCase()));
}

/*
  Viewed, kept per session, file and what the file now says: a file that changes again after you
  looked comes back unviewed. Only the newest marks are kept.
*/
const VIEWED = "lc:review:viewed:v1";
const MAX_VIEWED = 1500;
/** FNV-1a over the file's new text: a short name for what it says now. */
function hashOf(s: string | undefined) {
  const t = s ?? "\u0000gone";
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
const isMarks = (v: unknown): v is Record<string, number> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
/** Through kept.ts: with storage shut, viewed lasts as long as Changes is open. */
const readViewed = (): Record<string, number> => keptRead(localStorage, VIEWED, {}, isMarks);
function writeViewed(all: Record<string, number>) {
  const newest = Object.entries(all)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_VIEWED);
  keptWrite(localStorage, VIEWED, Object.fromEntries(newest));
}

type Anchor = { file: string; line: number; endLine?: number };
/** A question on lines: its answer is read on its own (Answer), so a reply's words redraw that answer and not the diff. */
type Thread_ = { id: string; anchor: Anchor; question: string; turn: number; who: string; model: string; at: number; running: boolean };
type Prepared = { file: FileDiff; binary: boolean; rows: Row[]; at: Map<Row, number>; segs: ReturnType<typeof segment>; tb: ReturnType<typeof tokensOf>; ta: ReturnType<typeof tokensOf>; added: number; removed: number; isNew: boolean; gone: boolean; moved?: string; seenKey: string };

/*
  Review's views of the timeline (useItemsWhere): none holds a reply's words, so a streamed frame
  of a reply doesn't redraw the diff. Each is its own, so an agent's steps coming in don't remake
  the questions on the lines either.
*/
const isLineAsk = (it: Item) => (it.kind === "user" && Boolean(it.anchor)) || it.kind === "turn";
const isReview = (it: Item) => it.kind === "review";
const isTask = (it: Item) => it.kind === "tool" && it.toolKind === "task";
/** Lines by the line they end on, per file: a row looks its own up, not through the whole list. */
function byLine<T>(list: T[], at: (x: T) => { file: string; line?: number }) {
  const out = new Map<string, Map<number, T[]>>();
  for (const x of list) {
    const { file, line } = at(x);
    // A finding on the file as a whole sits on no line.
    if (line === undefined) continue;
    let lines = out.get(file);
    if (!lines) out.set(file, (lines = new Map()));
    lines.set(line, [...(lines.get(line) ?? []), x]);
  }
  return out;
}


/** With nothing to commit, the foot's one action pushes the branch or opens a pull request: the frame's ink button, as Commit is. */
function PushButton({ thread, branch }: { thread: Thread; branch?: string }) {
  return (
    <Pop label="Push or open a pull request" menu side="top" align="end" width={280} triggerClass="lc-pane-btn" triggerAttrs={{ "data-ink": true }} disabled={thread.status === "running"} trigger={<><I.push size={14} />Push</>}>
      {(close) => (
        <>
          <PanelHead>Nothing to commit</PanelHead>
          <MenuRow title={`Push ${branch ?? "this branch"}`} note="To its branch on GitHub" icon={<I.push size={14} />} onPick={() => (close(), void ship(thread, null))} />
          <MenuRow title="Open a pull request" note="The PR card, in the chat" icon={<I.pr size={14} />} onPick={() => (close(), void rpc("thread.send", { id: thread.id, text: "create pr" }).catch((e) => toast.error(e instanceof Error ? e.message : String(e))))} />
        </>
      )}
    </Pop>
  );
}

export function Review({ thread, focus, onFocus, wide = false, visible = true }: { thread: Thread; focus: { id: string; path?: string } | null; onFocus: (f: { id: string; path?: string } | null) => void; /** In the full canvas: the files keep a column of their own, and the branch and "Change N of M" have room. */ wide?: boolean; /** Showing: a Changes tab out of sight takes no keys. */ visible?: boolean }) {
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  const project = useEngine((s) => s.projects.find((p) => p.id === thread.projectId));
  const cps = useItemsWhere(thread.id, isCheckpoint) as Checkpoint[];
  const lineAsks = useItemsWhere(thread.id, isLineAsk);
  const reviews = useItemsWhere(thread.id, isReview) as Extract<Item, { kind: "review" }>[];
  const tasks = useItemsWhere(thread.id, isTask) as Extract<Item, { kind: "tool" }>[];
  const [diff, setDiff] = useState<FileDiff[] | null>(null);
  const [total, setTotal] = useState(0);
  const [diffErr, setDiffErr] = useState<string | null>(null);
  // Its own key: lc:view is the window's place (App.tsx, in sessionStorage). Released apps kept this choice under lc:view, so that is read when the new key is not there yet.
  const [view, setView] = useState<"unified" | "split">(() => wordRead(localStorage, "lc:changes-view", ["unified", "split"], wordRead(localStorage, "lc:view", ["unified", "split"], "unified")) as "unified" | "split");
  useEffect(() => wordWrite(localStorage, "lc:changes-view", view), [view]);
  const [marks, setMarks] = useState<Record<string, number>>(readViewed);
  // Wrapping starts on for someone who never chose; a saved choice stands.
  const [wrap, setWrap] = usePref("lc:review:wrap", true);
  const [spaces, setSpaces] = usePref("lc:review:spaces");
  const [hideTests, setHideTests] = usePref("lc:review:hide-tests");
  const [sel, setSel] = useState<Anchor | null>(null);
  const [ask, setAsk] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  // Files folded down to their row, by path.
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState<"undo" | null>(null);
  const [finding, setFinding] = useState(false);
  const [wtStatus, setWtStatus] = useState<{ branch?: string; changes: FileChange[] } | null>(null);
  const [wtTick, setWtTick] = useState(0);
  // The working tree is read whenever no turn has changes still to commit (none yet, or all committed or undone), as the
  // message box's commit tab counts it (Session.tsx): while Changes shows that tab steps aside, so Commit is here instead.
  const turnsOpen = cps.some((c) => !c.reverted && !c.committed);
  useEffect(() => {
    if (!project?.git || turnsOpen) return;
    let live = true;
    void rpc("git.status", { projectId: project.id, threadId: thread.id })
      .then((st) => live && setWtStatus({ branch: st.branch, changes: st.changes }))
      .catch(() => live && setWtStatus(null));
    return () => {
      live = false;
    };
  }, [project?.id, project?.git, thread.id, thread.turns, cps.length, turnsOpen, wtTick]);
  // The turn you chose, or else the newest. While a comment is being written on a line, the newest stands still: a turn that
  // ends meanwhile would otherwise move the view to its own diff and close the comment under your hands.
  const chosen = focus?.id && (focus.id === "all" || focus.id === "branch" || cps.some((c) => c.id === focus.id)) ? focus.id : undefined;
  const newest = cps[cps.length - 1]?.id ?? "all";
  const shownNewest = useRef(newest);
  if (!sel) shownNewest.current = newest;
  const pick = chosen ?? shownNewest.current;
  const cp = cps.find((c) => c.id === pick);
  const root = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const coder = agentOf(thread.agent, agents, providers);
  const branch = thread.worktree?.branch ?? project?.branch;

  // All turns and This branch have no one checkpoint to watch: any turn added or undone changes what they show. One turn's own diff doesn't.
  const whole = pick === "all" || pick === "branch";
  const key = `${pick}:${cp?.reverted}:${cp?.committed}:${whole ? `${cps.length}:${cps.filter((c) => c.reverted).length}` : ""}`;
  useEffect(() => {
    // No turn has changed a file yet: there's no diff to ask for.
    if (!cps.length) return setDiff([]);
    let live = true;
    setDiff(null);
    setDiffErr(null);
    void rpc("checkpoint.diff", { threadId: thread.id, itemId: pick })
      .then((d) => {
        if (!live) return;
        setDiff(d.files);
        setTotal(d.total);
      })
      .catch((e) => {
        if (!live) return;
        setDiff([]);
        setTotal(0);
        setDiffErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, [thread.id, key, cps.length > 0]);
  // Another turn's diff: where you stepped to, what you unfolded and folded and the lines you picked were the old one's.
  useEffect(() => {
    setAt(0);
    setOpen(new Set());
    setFolded(new Set());
    setSel(null);
  }, [pick]);

  // Line questions and their answers, and the Reviewer's findings, by file.
  const asked = useMemo(() => {
    const out: Thread_[] = [];
    for (const it of lineAsks) {
      if (it.kind !== "user" || !it.anchor) continue;
      const turn = lineAsks.find((x) => x.kind === "turn" && x.turn === it.turn);
      const who = turn?.kind === "turn" ? turn.agent : thread.agent;
      out.push({ id: it.id, anchor: it.anchor, question: it.text, turn: it.turn, who: agentOf(who, agents, providers).name, model: turn?.kind === "turn" ? turn.model : coder.model, at: it.at, running: turn?.kind === "turn" && turn.status === "running" });
    }
    return out;
  }, [lineAsks, agents, providers, thread.agent, coder.model]);
  const findings = useMemo(() => {
    const last = reviews[reviews.length - 1];
    return { list: last?.findings ?? [], reviewer: last?.reviewer, status: last?.status };
  }, [reviews]);
  const askedAt = useMemo(() => byLine(asked, (t) => ({ file: t.anchor.file, line: t.anchor.endLine ?? t.anchor.line })), [asked]);
  const notesAt = useMemo(() => byLine(findings.list, (f) => ({ file: f.file, line: f.endLine ?? f.line })), [findings.list]);
  const reviewer = findings.reviewer ? modelLabel(findings.reviewer, providers) : "The Reviewer";

  const prepared = useMemo(
    () =>
      (diff ?? []).map((f): Prepared => {
        const before = linesOf(f.before);
        const after = linesOf(f.after);
        const lang = langOf(f.path);
        // git show hands a binary file over as it is: it says so rather than drawing its bytes as lines.
        const binary = f.before?.includes("\u0000") || f.after?.includes("\u0000") || false;
        const rows = binary ? [] : diffRows(before, after);
        return { file: f, binary, rows, at: new Map(rows.map((r, i) => [r, i])), segs: segment(rows, 3), tb: binary ? [] : tokensOf(before, lang), ta: binary ? [] : tokensOf(after, lang), added: rows.filter((r) => r.kind === "add").length, removed: rows.filter((r) => r.kind === "del").length, isNew: fileStatus(f) === "added", gone: fileStatus(f) === "deleted", moved: f.from && f.from !== f.path ? f.from : undefined, seenKey: `${thread.id}|${f.path}|${hashOf(f.after)}` };
      }),
    [diff],
  );
  // Test files out of the way when you ask, except the one you pressed (T3 Code: DiffPanel.tsx).
  const tests = prepared.filter((p) => isTestFile(p.file.path)).length;
  const shown = hideTests ? prepared.filter((p) => !isTestFile(p.file.path) || p.file.path === focus?.path) : prepared;
  const changes = shown.flatMap((p) => [...new Set(p.rows.flatMap((r) => (r.change === undefined ? [] : [r.change])))].map((c) => ({ path: p.file.path, change: c })));
  const viewed = useMemo(() => new Set(prepared.filter((p) => marks[p.seenKey]).map((p) => p.file.path)), [prepared, marks]);
  const setViewed = useStable((path: string, on: boolean) => {
    const p = prepared.find((x) => x.file.path === path);
    if (!p || Boolean(marks[p.seenKey]) === on) return;
    // Read afresh, so another Review's marks aren't written over.
    const all = { ...readViewed(), ...marks };
    if (on) all[p.seenKey] = Date.now();
    else delete all[p.seenKey];
    setMarks(all);
    writeViewed(all);
  });
  const unfold = (path: string) => setFolded((f) => (f.has(path) ? new Set([...f].filter((x) => x !== path)) : f));
  const fold = useStable((path: string) => setFolded((f) => (f.has(path) ? new Set([...f].filter((x) => x !== path)) : new Set(f).add(path))));
  const allFolded = shown.length > 0 && shown.every((p) => folded.has(p.file.path));
  // In the desktop app a file of the turn opens in your editor; the shell checks it's inside the session's folder.
  const canOpen = bridge.opensFiles();
  const openFile = useStable((path: string) => void bridge.openFile({ threadId: thread.id }, path).catch((e) => toast.error(e instanceof Error ? e.message : String(e))));

  // The file pressed elsewhere scrolls into view, unfolded; pressed again after scrolling away, it does again.
  useEffect(() => {
    if (!diff || !focus?.path) return;
    unfold(focus.path);
    const path = focus.path;
    // Split is CodeDiff's, whose files carry no path: there it's found by its place among the files shown.
    const i = shown.findIndex((p) => p.file.path === path);
    requestAnimationFrame(() => (box.current?.querySelector<HTMLElement>(`[data-file="${CSS.escape(path)}"]`) ?? (i >= 0 ? box.current?.querySelectorAll<HTMLElement>(".l-cdiff__file")[i] : null))?.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" }));
    setViewed(focus.path, true);
  }, [diff, focus]);

  const goChange = (i: number) => {
    if (view === "split") {
      const hunks = box.current?.querySelectorAll<HTMLElement>(SPLIT_CHANGE) ?? [];
      if (!hunks.length) return;
      const n = ((i % hunks.length) + hunks.length) % hunks.length;
      setAt(n);
      hunks[n]?.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
      return;
    }
    if (!changes.length) return;
    const n = (i + changes.length) % changes.length;
    setAt(n);
    const c = changes[n];
    // A change in a folded file opens it first, then comes into view once it's drawn.
    unfold(c.path);
    requestAnimationFrame(() => box.current?.querySelector<HTMLElement>(`[data-file="${CSS.escape(c.path)}"] [data-change="${c.change}"]`)?.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" }));
  };
  const stepTo = useRef(goChange);
  stepTo.current = goChange;
  // Beside another session, J, K and ⌘F are the side you're in. In the side panel they're Changes' only while you're in it
  // (a press anywhere on it puts you there), so the chat beside it keeps its own; the full canvas is all Changes.
  const keys = useContext(SideKeys);
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (!keys || e.defaultPrevented) return;
      const t = e.target as HTMLElement;
      if (!wide && !root.current?.contains(t)) return;
      if (is(e, "find")) {
        e.preventDefault();
        setFinding(true);
        return;
      }
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || e.metaKey || e.ctrlKey) return;
      if (e.key === "j") stepTo.current(at + 1);
      else if (e.key === "k") stepTo.current(at - 1);
      else if (e.key === "Escape" && sel) setSel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [at, sel, keys, view, visible, wide]);

  // Two quick Enters are one question.
  const sending = useRef(false);
  const sendNow = useRef(async () => {});
  // The same function every render, so a file's rows don't redraw for a new one; it sends what's picked now.
  const send = useMemo(() => () => sendNow.current(), []);
  sendNow.current = async () => {
    if (!sel || !ask.trim() || sending.current) return;
    sending.current = true;
    try {
      await rpc("thread.send", { id: thread.id, text: ask.trim(), anchor: sel, mode: thread.status === "running" ? "queue" : undefined });
      setAsk("");
      setSel(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      sending.current = false;
    }
  };
  const undo = async () => {
    if (!cp) return;
    setBusy("undo");
    try {
      await undoTurn(thread.id, cp);
    } finally {
      setBusy(null);
    }
  };
  /** The shown turn as one patch on the clipboard (patch.ts), or why it can't be. */
  const copyPatch = async () => {
    const r = patchOf(diff ?? [], total);
    if ("why" in r) return void toast.error("The diff can't be copied as a patch", { description: r.why });
    try {
      await navigator.clipboard.writeText(r.patch);
      toast.success("Copied the diff as a patch", { description: "git apply takes it in the session's folder." });
    } catch {
      toast.error("The clipboard didn't take the patch");
    }
  };

  const openCps = cps.filter((c) => !c.reverted && !c.committed);
  const openFiles = new Set(openCps.flatMap((c) => c.files.map((f) => f.path))).size;
  // What Commit commits: the turns' files still open, else the working tree's (the same count as the message box's tab).
  const toCommit = openFiles || (turnsOpen ? 0 : (wtStatus?.changes.length ?? 0));
  const files = shown.map((p) => p.file.path);
  const seen = files.filter((f) => viewed.has(f)).length;
  const lines = shown.reduce((s, p) => ({ added: s.added + p.added, removed: s.removed + p.removed }), { added: 0, removed: 0 });
  // What the subagents checked: the turn's Task calls and the Reviewer.
  const turnNo = cp?.turn;
  const subs = tasks.filter((x) => turnNo === undefined || x.turn === turnNo);
  const hidden = prepared.length - shown.length;
  const hiddenNote = hidden > 0 && (
    <button type="button" className="lc-rv-hidden lc-quiet l-focus" onClick={() => setHideTests(false)}>
      {plural(hidden, "test file")} hidden · Show
    </button>
  );
  const more = diff && total > diff.length && <MoreFiles n={total - diff.length} turn={Boolean(cp)} pick={pick} />;
  const find = shortcutOf("find");

  if (!cps.length) {
    const wtFiles = wtStatus?.changes ?? [];
    // The working tree's edits before any turn made one: the same frame, its files as the strips a turn's are.
    if (wtFiles.length > 0)
      return (
        <div ref={root} className="lc-rv" data-wide={wide || undefined} tabIndex={-1}>
          <PaneHead
            shows={
              <>
                <PaneWords>Working tree</PaneWords>
                <span className="lc-rv-tot">
                  <PaneWords>{plural(wtFiles.length, "file")}</PaneWords>
                </span>
              </>
            }
            tools={<PaneTool label="Look again" icon={<I.refresh size={16} />} onClick={() => setWtTick((n) => n + 1)} />}
          />
          <div className="lc-rv-files">
            {wtFiles.map((f) => (
              <PaneFile key={f.path} path={f.path} status={f.status[0]?.toUpperCase() || "M"} lines={{ added: f.added, removed: f.removed }} onOpen={() => window.dispatchEvent(new CustomEvent("lc:open-file", { detail: { path: f.path, threadId: thread.id } }))} />
            ))}
          </div>
          {/* The message box's commit tab steps aside while Changes shows, so the white Commit is here, in this view too. */}
          <PaneFoot say={plural(wtFiles.length, "file") + " in the working tree"}>
            <CommitButton thread={thread} files={wtFiles.length} disabled={thread.status === "running"} />
          </PaneFoot>
        </div>
      );
    return (
      <>
        <PaneHead />
        <SurfaceNote icon={<I.changes size={20} />} title="No changes yet">
          When a turn or your working tree edits files, changes land here so you can review, undo or commit them.
        </SurfaceNote>
      </>
    );
  }

  // The files as a menu under "N files ⌄", where they have no column of their own (surfaces.css shows it in a narrow full canvas too).
  const filesMenu = (
    <Pop label="Files in this turn" width={320} className="lc-rv-filesb" triggerClass={PANE_PICK} trigger={<>{plural(files.length, "file")}<I.chevD size={12} /></>}>
      {(close) => (
        <>
          <PanelHead end={viewedSaid(seen, files.length)}>Files in this turn</PanelHead>
          {shown.map((p) => (
            <MenuRow key={p.file.path} icon={<PaneStatus status={statusOf(p)} />} title={baseOf(p.file.path)} which={dirOf(p.file.path) || undefined} whichPath on={viewed.has(p.file.path) || undefined} note={viewed.has(p.file.path) ? "Viewed" : undefined} end={<Lines added={p.added} removed={p.removed} />} onPick={() => (close(), onFocus({ id: pick, path: p.file.path }))} />
          ))}
          {(hidden > 0 || (diff && total > diff.length)) && (
            <>
              <Sep />
              <MenuFoot>{[hidden > 0 ? `${plural(hidden, "test file")} hidden` : "", diff && total > diff.length ? moreFilesSaid(total - diff.length, Boolean(cp), pick) : ""].filter(Boolean).join(" · ")}</MenuFoot>
            </>
          )}
        </>
      )}
    </Pop>
  );
  // How the diff is drawn, under one options button (board Menus): a choice among several is "Label  Value ›".
  const options = (
    <Pop label="How it's shown" menu align="end" width={260} triggerClass={PANE_TOOL} trigger={<I.sliders size={16} />}>
      {(close) => (
        <>
          {/* One column or side by side, and Wrap, are on the bar itself (line and dot, board Main); both remembered (T3 Code: DiffPanel.tsx).
              Split is drawn by CodeDiff, which doesn't mark spaces: there that row stands dimmed and says where it works. */}
          <MenuRow title="Previous change" icon={<I.chevU size={14} />} end="K" disabled={!shown.length} onPick={() => (close(), goChange(at - 1))} />
          <MenuRow title="Next change" icon={<I.chevD size={14} />} end="J" disabled={!shown.length} onPick={() => (close(), goChange(at + 1))} />
          <Sep />
          <MenuRow title="Spaces and tabs" note={view === "split" ? "In the unified view" : undefined} keepNote icon={<I.pilcrow size={14} />} on={spaces && view === "unified"} disabled={view === "split"} onPick={() => (close(), setSpaces(!spaces))} />
          {tests > 0 && (
            <SubMenu title="Test files" icon={<I.flask size={14} />} value={hideTests ? "Hidden" : "Shown"} label="Test files" width={200}>
              {() => (
                <>
                  <MenuRow title="Shown" end={String(tests)} on={!hideTests} onPick={() => (close(), setHideTests(false))} />
                  <MenuRow title="Hidden" on={hideTests} onPick={() => (close(), setHideTests(true))} />
                </>
              )}
            </SubMenu>
          )}
          <Sep />
          <MenuRow title="Find" icon={<I.search size={14} />} end={find?.join("")} onPick={() => (close(), setFinding(true))} />
          <MenuRow title={allFolded ? "Unfold every file" : "Fold every file"} icon={<I.fold size={14} />} disabled={!shown.length} onPick={() => (close(), setFolded(allFolded ? new Set() : new Set(shown.map((p) => p.file.path))))} />
          <MenuRow title="Copy as a patch" icon={<I.copy size={14} />} disabled={!diff?.length} onPick={() => (close(), void copyPatch())} />
        </>
      )}
    </Pop>
  );

  return (
    <div ref={root} className="lc-rv" data-wide={wide || undefined} tabIndex={-1}>
      {/* The turn, its files and totals, then the tools. In the full canvas "Change N of M" and the branch come too, and give way first as it narrows (surfaces.css). */}
      <PaneHead
        shows={
          <>
            <TurnPicker cps={cps} pick={pick} turns={thread.turns} onPick={(id) => onFocus({ id })} />
            {filesMenu}
            <span className="lc-rv-tot">
              <PaneWords>
                <Lines {...lines} />
              </PaneWords>
            </span>
            {wide && changes.length > 0 && view === "unified" && (
              <span className="lc-rv-count">
                <PaneWords>
                  Change {Math.min(at + 1, changes.length)} of {changes.length}
                </PaneWords>
              </span>
            )}
            {wide && branch && (
              <span className="lc-branch lc-mono" title={branch}>
                <I.branch size={12} />
                <span>{branch}</span>
              </span>
            )}
          </>
        }
        tools={
          <>
            <span className="lc-pane-seg" role="group" aria-label="Layout">
              <PaneTool label="One column" icon={<I.unified size={16} />} pressed={view === "unified"} onClick={() => setView("unified")} />
              <PaneTool label="Side by side" icon={<I.split size={16} />} pressed={view === "split"} onClick={() => setView("split")} />
            </span>
            <PaneTool label="Wrap long lines" icon={<I.wrap size={16} />} pressed={wrap} onClick={() => setWrap(!wrap)} />
            {options}
          </>
        }
      />
      <div className="lc-rv-body">
        {wide && (
          <nav className="lc-rv-nav" aria-label="Files in this turn">
            <div className="lc-rv-navh">
              Files
              <span>
                {seen} of {files.length} viewed
              </span>
            </div>
            {shown.map((p) => (
              <div key={p.file.path} className="lc-rv-f" data-on={viewed.has(p.file.path) || undefined}>
                <PaneCheck checked={viewed.has(p.file.path)} label={`Viewed ${p.file.path}`} onChange={(on) => setViewed(p.file.path, on)} />
                <button type="button" className="lc-rv-fb lc-mono l-focus" title={p.file.path} onClick={() => onFocus({ id: pick, path: p.file.path })}>
                  {baseOf(p.file.path)}
                </button>
                <Lines added={p.added} removed={p.removed} />
              </div>
            ))}
            {hiddenNote}
            {more}
            {(subs.length > 0 || findings.reviewer) && (
              <div className="lc-rv-checked">
                <span className="lc-rv-navh">{subs.some(isSidekick) ? "Who else worked on it" : `${coder.name}'s subagents checked`}</span>
                {subs.map((s) => (
                  <div key={s.id} className="lc-rv-sub-a">
                    <span className="lc-tile">{isSidekick(s) && s.agent?.model ? <ModelMark kind={markOf(s.agent.model)} size={12} /> : <I.agents size={12} />}</span>
                    <span>
                      {/* A pair's sidekick by its model, with its brief. */}
                      <b>{isSidekick(s) ? whoIs(s, providers) : s.title.split(":")[0]}</b> <small className="lc-quiet">{s.status === "running" ? "working" : isSidekick(s) ? `Sidekick · ${agentTask(s) || s.status}` : (s.title.split(":").slice(1).join(":").trim() || s.status)}</small>
                    </span>
                  </div>
                ))}
                {findings.reviewer && (
                  <div className="lc-rv-sub-a">
                    <span className="lc-tile">
                      <I.shield size={12} />
                    </span>
                    <span>
                      <b>Reviewer</b> <small className="lc-quiet">{findings.status === "running" ? "reading" : findings.list.length ? plural(findings.list.length, "note") : "nothing to note"}</small>
                      <ModelTag kind={markOf(findings.reviewer)} label={modelLabel(findings.reviewer, providers)} />
                    </span>
                  </div>
                )}
              </div>
            )}
          </nav>
        )}
        <section className="lc-rv-main" aria-label="Changes">
          {finding && (
            <FindBar
              root={box}
              label="Find in the changes"
              onClose={() => setFinding(false)}
              // Folded lines and folded files are searched too: finding opens every fold.
              onQuery={(q) => {
                if (!q.trim()) return;
                setOpen(new Set(prepared.flatMap((p) => p.segs.flatMap((sg) => (sg.kind === "fold" ? [`${p.file.path}:${sg.id}`] : [])))));
                setFolded(new Set());
              }}
            />
          )}
          <div ref={box} className="lc-rv-files" data-wrap={wrap || undefined}>
            {diff === null ? (
              <div className="lc-diff-wait">
                <span className="l-shimmer">Reading the changes</span>
              </div>
            ) : diffErr ? (
              <SurfaceNote icon={<I.alert size={20} />} title="The changes didn't open">
                {diffErr}
              </SurfaceNote>
            ) : !diff.length ? (
              <SurfaceNote title={pick === "branch" ? "This branch matches main" : "Nothing changed here"} />
            ) : !shown.length ? (
              <SurfaceNote title="Only test files changed here" action={<PaneButton ink onClick={() => setHideTests(false)}>Show them</PaneButton>} />
            ) : view === "split" ? (
              // Its own row of tools is hidden (app.css, .lc-diff): the head has them. Clicking a line number lets you ask about that line in split view too.
              <div
                className="lc-diff"
                onClick={(e) => {
                  const target = e.target as HTMLElement | null;
                  const numCell = target?.closest<HTMLElement>(SPLIT_LINE);
                  const lineNo = Number(numCell?.textContent?.trim());
                  if (!Number.isInteger(lineNo) || lineNo <= 0) return;
                  const fileEl = target?.closest<HTMLElement>(".l-cdiff__file");
                  const idx = fileEl ? Array.from(box.current?.querySelectorAll(".l-cdiff__file") ?? []).indexOf(fileEl) : -1;
                  const path = shown[idx]?.file.path;
                  if (!path) return;
                  setSel((prev) => (e.shiftKey && prev?.file === path ? { file: path, line: Math.min(prev.line, lineNo), endLine: Math.max(prev.line, lineNo) } : { file: path, line: lineNo }));
                }}
              >
                <CodeDiff key={`${wrap}:${[...folded].join("\n")}`} files={shown.map((p) => p.file)} view="split" maxHeight={100000} defaultWrap={wrap} defaultCollapsed={[...folded]} />
                {/* The same ask as the unified view's: the lines, then the message box's field and Send. */}
                {sel && (
                  <div className="lc-rv-ask">
                    <span className="lc-rv-lines">{linesSaid(sel)}</span>
                    <SendBox autoFocus value={ask} onChange={setAsk} label={`Ask ${coder.name} about it`} placeholder={`Ask ${coder.name} about ${sel.endLine && sel.endLine !== sel.line ? "these lines" : "this line"} in ${baseOf(sel.file)}`} onSend={() => void send()} onEscape={() => setSel(null)} />
                  </div>
                )}
              </div>
            ) : (
              shown.map((p) => {
                const mine = sel?.file === p.file.path;
                return <FileBody key={p.file.path} p={p} threadId={thread.id} open={open} setOpen={setOpen} sel={mine ? sel : null} setSel={setSel} ask={mine ? ask : ""} setAsk={setAsk} send={send} asks={askedAt.get(p.file.path)} notes={notesAt.get(p.file.path)} reviewer={reviewer} coder={coder.name} folded={folded.has(p.file.path)} onFold={fold} viewed={viewed.has(p.file.path)} onViewed={setViewed} onOpen={canOpen ? openFile : undefined} wrap={wrap} spaces={spaces} />;
              })
            )}
          </div>
          {/* Where things stand, then Undo, then the one action in ink: Commit, or with nothing to commit, Push. */}
          <PaneFoot say={viewedSaid(seen, files.length)}>
            {cp && !cp.reverted && !cp.committed && (
              <PaneButton icon={<I.undo size={14} />} disabled={busy !== null || thread.status === "running"} onClick={() => void undo()}>
                Undo turn {cp.turn}
              </PaneButton>
            )}
            {toCommit > 0 ? <CommitButton thread={thread} files={toCommit} disabled={busy !== null || thread.status === "running"} /> : <PushButton thread={thread} branch={branch} />}
          </PaneFoot>
        </section>
      </div>
    </div>
  );
}

/** What a line number says under the pointer: how to ask about it (the hint the foot used to carry). */
const ASK_TIP = "Press a line number to ask about it; shift for a range";

/*
  One file of the diff, drawn again only when what it shows changes: its rows, what's unfolded, the
  lines picked on it, its questions and notes, whether it's folded or viewed. A 2,000-line diff was
  2,000 rows remade each frame of a reply. Its row: the fold, what happened to it, its path, its
  lines, Viewed, and your editor.
*/
type FileProps = {
  p: Prepared;
  threadId: string;
  open: Set<string>;
  setOpen: (f: (o: Set<string>) => Set<string>) => void;
  /** The lines picked, when they are on this file. */
  sel: Anchor | null;
  setSel: (f: (s: Anchor | null) => Anchor | null) => void;
  ask: string;
  setAsk: (s: string) => void;
  send: () => void;
  asks?: Map<number, Thread_[]>;
  notes?: Map<number, Finding[]>;
  reviewer: string;
  coder: string;
  /** Down to its row. */
  folded: boolean;
  onFold: (path: string) => void;
  viewed: boolean;
  onViewed: (path: string, on: boolean) => void;
  /** Opens it in your editor; none outside the desktop app. */
  onOpen?: (path: string) => void;
  wrap: boolean;
  spaces: boolean;
};
const FileBody = memo(function FileBody({ p, threadId, open, setOpen, sel, setSel, ask, setAsk, send, asks, notes, reviewer, coder, folded, onFold, viewed, onViewed, onOpen, wrap, spaces }: FileProps) {
  const providers = useEngine((s) => s.providers);
  // A folded run doesn't hide what's on its lines: a finding, a question, the line you picked.
  const st = statusOf(p);
  const carries = (r: Row) => r.new !== undefined && (Boolean(asks?.has(r.new)) || Boolean(notes?.has(r.new)) || (sel !== null && (sel.endLine ?? sel.line) === r.new));

  const lineRow = (r: Row, k: number) => {
    const tok = r.kind === "del" ? p.tb[(r.old ?? 1) - 1] : p.ta[(r.new ?? 1) - 1];
    const inSel = sel && r.new !== undefined && r.new >= sel.line && r.new <= (sel.endLine ?? sel.line);
    const here = r.new !== undefined ? (asks?.get(r.new) ?? []) : [];
    const said = r.new !== undefined ? (notes?.get(r.new) ?? []) : [];
    const endsSel = sel && (sel.endLine ?? sel.line) === r.new;
    // A wrapped line hangs under its own indent (surfaces.css), up to a point.
    const hang = wrap ? Math.min(32, indentOf(tok)) : 0;
    return (
      <Fragment key={k}>
        <div className="lc-rv-l" data-kind={r.kind} data-sel={inSel || undefined} data-change={r.kind !== "same" && (k === 0 || p.rows[k - 1]?.change !== r.change) ? r.change : undefined}>
          <span className="lc-rv-n">{r.old ?? ""}</span>
          {r.new !== undefined ? (
            <button
              type="button"
              className="lc-rv-n lc-rv-pick l-focus"
              aria-label={`Ask about line ${r.new}`}
              title={ASK_TIP}
              onClick={(e) => {
                const line = r.new!;
                setSel((s) => (e.shiftKey && s && s.file === p.file.path ? { file: s.file, line: Math.min(s.line, line), endLine: Math.max(s.endLine ?? s.line, line) } : { file: p.file.path, line }));
                setAsk("");
              }}
            >
              {r.new}
            </button>
          ) : (
            <span className="lc-rv-n" />
          )}
          <span className="lc-rv-s" aria-hidden>
            {r.kind === "add" ? "+" : r.kind === "del" ? "−" : ""}
          </span>
          <span className="lc-rv-t" style={hang ? ({ "--hang": `${hang}ch` } as CSSProperties) : undefined}>
            {spaces ? <Spaced line={tok} /> : <Toks line={tok} />}
          </span>
        </div>
        {said.map((f, j) => (
          <Note key={`f${j}`} f={f} reviewer={reviewer} />
        ))}
        {here.map((t) => (
          <div key={t.id} className="lc-rv-thread">
            <div className="lc-rv-q">
              <span className="lc-rv-lines">{linesSaid(t.anchor)}</span>
              <span className="lc-quiet">You · {ago(t.at)}</span>
              <p>{t.question}</p>
            </div>
            <div className="lc-rv-a">
              <b>
                {t.who} <ModelTag kind={markOf(t.model)} label={modelLabel(t.model, providers)} />
              </b>
              <Answer threadId={threadId} turn={t.turn} running={t.running} />
            </div>
          </div>
        ))}
        {endsSel && (
          <div className="lc-rv-ask">
            <span className="lc-rv-lines">{linesSaid(sel!)}</span>
            {/* The message box's field and Send, as every place that writes to an agent has them. */}
            <SendBox autoFocus value={ask} onChange={setAsk} label={`Ask ${coder} about it`} placeholder={`Ask ${coder} about ${sel!.endLine && sel!.endLine !== sel!.line ? "these lines" : "this line"}`} onSend={() => void send()} onEscape={() => setSel(() => null)} />
          </div>
        )}
      </Fragment>
    );
  };

  return (
    <article className="lc-rv-file" data-file={p.file.path}>
      {/* The file's own strip (Pane.tsx), as Files draws one: the fold, what happened, the path, its lines, your editor, Viewed. Sticky, so it stays over its lines. The path folds the file too, as the whole strip once did. */}
      <PaneFile className="lc-rv-fh" path={p.file.path} status={st} lines={{ added: p.added, removed: p.removed }} fold={{ open: !folded, onToggle: () => onFold(p.file.path) }} onOpen={() => onFold(p.file.path)}>
        {p.moved && (
          <span className="lc-rv-from" title={`Moved from ${p.moved}`}>
            from {baseOf(p.moved)}
          </span>
        )}
        {onOpen && !p.gone && <PaneTool label="Open in your editor" icon={<I.external size={14} />} onClick={() => onOpen(p.file.path)} />}
        <PaneCheck checked={viewed} label="Viewed" onChange={(on) => onViewed(p.file.path, on)} />
      </PaneFile>
      {!folded && (
        <div className="lc-rv-code lc-mono">
          {p.binary && <p className="lc-rv-bin lc-quiet">A binary file, so there's no text to compare.</p>}
          {p.segs.map((s, si) =>
            s.kind === "fold" && !open.has(`${p.file.path}:${s.id}`) && !s.rows.some(carries) ? (
              <button key={si} type="button" className="lc-rv-fold l-focus" onClick={() => setOpen((o) => new Set(o).add(`${p.file.path}:${s.id}`))}>
                <I.chevD size={12} />
                {plural(s.rows.length, "unchanged line")}
              </button>
            ) : (
              <Fragment key={si}>{s.rows.map((r) => lineRow(r, p.at.get(r) ?? 0))}</Fragment>
            ),
          )}
        </div>
      )}
    </article>
  );
});

/** The answer to a question on lines: the words of its turn, read here alone, so they stream without redrawing the diff. */
function Answer({ threadId, turn, running }: { threadId: string; turn: number; running: boolean }) {
  // A string, so the same words are the same answer and nothing redraws while another turn streams.
  const answer = useEngine((s) =>
    (s.items[threadId] ?? [])
      .filter((x): x is Extract<Item, { kind: "text" }> => x.kind === "text" && x.turn === turn)
      .map((x) => x.text)
      .join("\n\n"),
  );
  const streaming = useEngine((s) => (s.items[threadId] ?? []).some((x) => x.kind === "text" && x.turn === turn && x.streaming)) || running;
  return answer ? <StreamedMarkdown className="lc-md" text={answer} streaming={streaming} animate={false} /> : <span className="l-shimmer">{streaming ? "Answering" : "Waiting for its turn"}</span>;
}

function Note({ f, reviewer }: { f: Finding; reviewer: string }) {
  return (
    <div className="lc-rv-note" data-sev={f.severity}>
      <I.shield size={12} />
      <span>
        <b>{f.severity === "blocking" ? `${reviewer} blocks this` : reviewer}</b> {f.note}
      </span>
    </div>
  );
}
