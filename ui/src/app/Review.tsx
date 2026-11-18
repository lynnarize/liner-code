/*
  Review, with the whole window: the files on the left with what you've looked at, what the
  subagents checked, and the diff beside them. Press a line number (shift for a range) to ask
  the agent about those lines; its answer stays on those lines. The Reviewer's findings sit on
  the lines they name. Step through the changes with the arrows, or J and K. Long lines wrap, and
  test files step aside, if you ask; both are remembered, and so is what you've viewed, until the
  file changes again. It sits under the panel's tab row, which is the paper's header in the full
  canvas: the row's shrink button is the way back to the session, so it has no header of its own.
*/
import { Fragment, memo, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { FileDiff, Finding, Item, Thread } from "@contracts";
import { CodeDiff } from "@liner/pro/code-diff/code-diff";
import { diffRows, segment, type Row } from "@liner/pro/code-diff/diff";
import { Segmented } from "@liner/components/segmented/segmented";
import { toast } from "@liner/components/toast/toast";
import { prefersReducedMotion } from "@liner/lib/spring";
import { CommitButton } from "./Commit";
import { is } from "./keymap";
import { isCheckpoint, rpc, useEngine, useItemsWhere } from "./engine";
import { I, ModelMark } from "./icons";
import { agentTask, isSidekick, whoIs } from "./Crew";
import { agentOf, ago, markOf, modelLabel, plural } from "./model";
import { baseOf, dirOf, langOf, linesOf, tokensOf, Toks } from "./code";
import { Lines, ModelTag } from "./ui";
import { StreamedMarkdown } from "@liner/pro/ai-kit/streamed";
import { FindBar } from "./Find";
import { MoreFiles, SurfaceNote, TurnPicker, Viewed } from "./Surfaces";
import { SideKeys } from "./TopBar";
import { undoTurn } from "./undo";

type Checkpoint = Extract<Item, { kind: "checkpoint" }>;

/** A switch in Review that's remembered: wrap and hide tests (T3 Code: diffs/useHideTestFiles.ts). */
function usePref(key: string) {
  const [on, set] = useState(() => {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });
  const flip = (v: boolean) => {
    set(v);
    try {
      localStorage.setItem(key, v ? "1" : "0");
    } catch {
      // Shut storage: it lasts until the window closes.
    }
  };
  return [on, flip] as const;
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
function readViewed(): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(VIEWED) || "{}") as unknown;
    return v && typeof v === "object" ? (v as Record<string, number>) : {};
  } catch {
    return {};
  }
}
function writeViewed(all: Record<string, number>) {
  try {
    const newest = Object.entries(all)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_VIEWED);
    localStorage.setItem(VIEWED, JSON.stringify(Object.fromEntries(newest)));
  } catch {
    // Shut storage: viewed lasts as long as Review is open.
  }
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


export function Review({ thread, focus, onFocus }: { thread: Thread; focus: { id: string; path?: string } | null; onFocus: (f: { id: string; path?: string } | null) => void }) {
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  const project = useEngine((s) => s.projects.find((p) => p.id === thread.projectId));
  const cps = useItemsWhere(thread.id, isCheckpoint) as Checkpoint[];
  const lineAsks = useItemsWhere(thread.id, isLineAsk);
  const reviews = useItemsWhere(thread.id, isReview) as Extract<Item, { kind: "review" }>[];
  const tasks = useItemsWhere(thread.id, isTask) as Extract<Item, { kind: "tool" }>[];
  const pick = focus?.id && (focus.id === "all" || focus.id === "branch" || cps.some((c) => c.id === focus.id)) ? focus.id : (cps[cps.length - 1]?.id ?? "all");
  const cp = cps.find((c) => c.id === pick);
  const [diff, setDiff] = useState<FileDiff[] | null>(null);
  const [total, setTotal] = useState(0);
  const [diffErr, setDiffErr] = useState<string | null>(null);
  const [view, setView] = useState<"unified" | "split">("unified");
  const [marks, setMarks] = useState<Record<string, number>>(readViewed);
  const [wrap, setWrap] = usePref("lc:review:wrap");
  const [hideTests, setHideTests] = usePref("lc:review:hide-tests");
  const [sel, setSel] = useState<Anchor | null>(null);
  const [ask, setAsk] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState<"undo" | null>(null);
  const [finding, setFinding] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const coder = agentOf(thread.agent, agents, providers);

  // All turns and This branch have no one checkpoint to watch: any turn undone changes what they show.
  const key = `${pick}:${cp?.reverted}:${cp?.committed}:${cps.length}:${cps.filter((c) => c.reverted).length}`;
  useEffect(() => {
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
  }, [thread.id, key]);
  // Another turn's diff: where you stepped to, what you unfolded and the lines you picked were the old one's.
  useEffect(() => {
    setAt(0);
    setOpen(new Set());
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
        return { file: f, binary, rows, at: new Map(rows.map((r, i) => [r, i])), segs: segment(rows, 3), tb: binary ? [] : tokensOf(before, lang), ta: binary ? [] : tokensOf(after, lang), added: rows.filter((r) => r.kind === "add").length, removed: rows.filter((r) => r.kind === "del").length, isNew: f.before === undefined, gone: f.after === undefined, moved: f.from && f.from !== f.path ? f.from : undefined, seenKey: `${thread.id}|${f.path}|${hashOf(f.after)}` };
      }),
    [diff],
  );
  // Test files out of the way when you ask, except the one you pressed (T3 Code: DiffPanel.tsx).
  const tests = prepared.filter((p) => isTestFile(p.file.path)).length;
  const shown = hideTests ? prepared.filter((p) => !isTestFile(p.file.path) || p.file.path === focus?.path) : prepared;
  const changes = shown.flatMap((p) => [...new Set(p.rows.flatMap((r) => (r.change === undefined ? [] : [r.change])))].map((c) => ({ path: p.file.path, change: c })));
  const viewed = useMemo(() => new Set(prepared.filter((p) => marks[p.seenKey]).map((p) => p.file.path)), [prepared, marks]);
  const setViewed = (path: string, on: boolean) => {
    const p = prepared.find((x) => x.file.path === path);
    if (!p || Boolean(marks[p.seenKey]) === on) return;
    // Read afresh, so another Review's marks aren't written over.
    const all = { ...readViewed(), ...marks };
    if (on) all[p.seenKey] = Date.now();
    else delete all[p.seenKey];
    setMarks(all);
    writeViewed(all);
  };

  // The file pressed elsewhere scrolls into view; pressed again after scrolling away, it does again.
  useEffect(() => {
    if (!diff || !focus?.path) return;
    box.current?.querySelector<HTMLElement>(`[data-file="${CSS.escape(focus.path)}"]`)?.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    setViewed(focus.path, true);
  }, [diff, focus]);

  const goChange = (i: number) => {
    if (!changes.length) return;
    const n = (i + changes.length) % changes.length;
    setAt(n);
    const c = changes[n];
    box.current?.querySelector<HTMLElement>(`[data-file="${CSS.escape(c.path)}"] [data-change="${c.change}"]`)?.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  };
  const stepTo = useRef(goChange);
  stepTo.current = goChange;
  // Beside another session, J, K and ⌘F are the side you're in.
  const keys = useContext(SideKeys);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!keys) return;
      const t = e.target as HTMLElement;
      if (is(e, "find")) {
        e.preventDefault();
        setFinding(true);
        return;
      }
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || e.metaKey || e.ctrlKey) return;
      // Split draws its own rows, with no changes to step to.
      if (e.key === "j" && view === "unified") stepTo.current(at + 1);
      else if (e.key === "k" && view === "unified") stepTo.current(at - 1);
      else if (e.key === "Escape" && sel) setSel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [at, sel, keys, view]);

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

  const openCps = cps.filter((c) => !c.reverted && !c.committed);
  const openFiles = new Set(openCps.flatMap((c) => c.files.map((f) => f.path))).size;
  const files = shown.map((p) => p.file.path);
  const seen = files.filter((f) => viewed.has(f)).length;
  const lines = shown.reduce((s, p) => ({ added: s.added + p.added, removed: s.removed + p.removed }), { added: 0, removed: 0 });
  // What the subagents checked: the turn's Task calls and the Reviewer.
  const turnNo = cp?.turn;
  const subs = tasks.filter((x) => turnNo === undefined || x.turn === turnNo);

  return (
    <div className="lc-rv">
      <div className="lc-rv-body">
        <nav className="lc-rv-nav" aria-label="Files in this turn">
          <div className="lc-rv-navh">
            Files
            <span>
              {seen} of {files.length} viewed
            </span>
          </div>
          {shown.map((p) => (
            <label key={p.file.path} className="lc-rv-f" data-on={viewed.has(p.file.path) || undefined}>
              <input type="checkbox" checked={viewed.has(p.file.path)} onChange={(e) => setViewed(p.file.path, e.target.checked)} />
              <button type="button" className="lc-rv-fb lc-mono l-focus" title={p.file.path} onClick={() => onFocus({ id: pick, path: p.file.path })}>
                {baseOf(p.file.path)}
              </button>
              <Lines added={p.added} removed={p.removed} />
            </label>
          ))}
          {prepared.length > shown.length && (
            <button type="button" className="lc-rv-hidden lc-quiet l-focus" onClick={() => setHideTests(false)}>
              {plural(prepared.length - shown.length, "test file")} hidden · Show
            </button>
          )}
          {diff && total > diff.length && <MoreFiles n={total - diff.length} turn={Boolean(cp)} pick={pick} />}
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
        <section className="lc-rv-main" aria-label="Changes">
          <div className="lc-rv-strip">
            <TurnPicker cps={cps} pick={pick} turns={thread.turns} onPick={(id) => onFocus({ id })} />
            <Lines {...lines} />
            <span className="lc-grow" />
            {changes.length > 0 && view === "unified" && (
              <>
                <span className="lc-quiet lc-rv-count">
                  Change {Math.min(at + 1, changes.length)} of {changes.length}
                </span>
                <button type="button" className="lc-ib l-focus" aria-label="Previous change (K)" title="Previous change (K)" onClick={() => goChange(at - 1)}>
                  <I.chevU size={14} />
                </button>
                <button type="button" className="lc-ib l-focus" aria-label="Next change (J)" title="Next change (J)" onClick={() => goChange(at + 1)}>
                  <I.chevD size={14} />
                </button>
              </>
            )}
            {/* Wrap long lines, and tests out of the way: both remembered (T3 Code: DiffPanel.tsx). */}
            {tests > 0 && (
              <button type="button" className="lc-ib l-focus" aria-pressed={hideTests} aria-label={hideTests ? "Show test files" : "Hide test files"} title={hideTests ? `Show test files (${tests})` : `Hide test files (${tests})`} onClick={() => setHideTests(!hideTests)}>
                <I.eye size={14} />
              </button>
            )}
            <button type="button" className="lc-ib l-focus" aria-pressed={wrap} aria-label={wrap ? "Scroll long lines" : "Wrap long lines"} title={wrap ? "Scroll long lines" : "Wrap long lines"} onClick={() => setWrap(!wrap)}>
              <I.wrap size={14} />
            </button>
            <Segmented
              size="sm"
              value={view}
              onValueChange={setView}
              options={[
                { value: "unified", label: "Unified" },
                { value: "split", label: "Split" },
              ]}
              aria-label="Diff view"
            />
            {/* The branch, which the Review's own header carried: the panel's tab row is the header now. */}
            {(thread.worktree?.branch ?? project?.branch) && (
              <span className="lc-branch lc-mono" title={thread.worktree?.branch ?? project?.branch}>
                <I.branch size={12} />
                <span>{thread.worktree?.branch ?? project?.branch}</span>
              </span>
            )}
          </div>
          {finding && (
            <FindBar
              root={box}
              label="Find in the diff"
              onClose={() => setFinding(false)}
              // Folded lines are searched too: finding opens every fold.
              onQuery={(q) => q.trim() && setOpen(new Set(prepared.flatMap((p) => p.segs.flatMap((sg) => (sg.kind === "fold" ? [`${p.file.path}:${sg.id}`] : [])))))}
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
              <div className="lc-panel-empty">
                <b>{pick === "branch" ? "This branch matches main" : "Nothing changed here"}</b>
              </div>
            ) : !shown.length ? (
              <div className="lc-panel-empty">
                <b>Only test files changed here</b>
                <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => setHideTests(false)}>
                  Show them
                </button>
              </div>
            ) : view === "split" ? (
              <CodeDiff key={wrap ? "wrap" : "scroll"} files={shown.map((p) => p.file)} view="split" maxHeight={100000} defaultWrap={wrap} />
            ) : (
              shown.map((p) => {
                const mine = sel?.file === p.file.path;
                return <FileBody key={p.file.path} p={p} threadId={thread.id} open={open} setOpen={setOpen} sel={mine ? sel : null} setSel={setSel} ask={mine ? ask : ""} setAsk={setAsk} send={send} asks={askedAt.get(p.file.path)} notes={notesAt.get(p.file.path)} reviewer={reviewer} coder={coder.name} />;
              })
            )}
          </div>
          <div className="lc-panel-foot">
            <Viewed seen={seen} total={files.length} />
            <span className="lc-quiet lc-rv-hint">Press a line number to ask about it; shift for a range</span>
            <span className="lc-grow" />
            {cp && !cp.reverted && !cp.committed && (
              <button type="button" className="lc-btn" data-kind="ghost" disabled={busy !== null || thread.status === "running"} onClick={() => void undo()}>
                <I.undo size={14} />
                Undo turn {cp.turn}
              </button>
            )}
            {openFiles > 0 && <CommitButton thread={thread} files={openFiles} disabled={busy !== null || thread.status === "running"} />}
          </div>
        </section>
      </div>
    </div>
  );
}

/*
  One file of the diff, drawn again only when what it shows changes: its rows, what's unfolded, the
  lines picked on it, its questions and notes. A 2,000-line diff was 2,000 rows remade each frame
  of a reply.
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
};
const FileBody = memo(function FileBody({ p, threadId, open, setOpen, sel, setSel, ask, setAsk, send, asks, notes, reviewer, coder }: FileProps) {
  const providers = useEngine((s) => s.providers);
  // A folded run doesn't hide what's on its lines: a finding, a question, the line you picked.
  const carries = (r: Row) => r.new !== undefined && (Boolean(asks?.has(r.new)) || Boolean(notes?.has(r.new)) || (sel !== null && (sel.endLine ?? sel.line) === r.new));

  const lineRow = (r: Row, k: number) => {
    const tok = r.kind === "del" ? p.tb[(r.old ?? 1) - 1] : p.ta[(r.new ?? 1) - 1];
    const inSel = sel && r.new !== undefined && r.new >= sel.line && r.new <= (sel.endLine ?? sel.line);
    const here = r.new !== undefined ? (asks?.get(r.new) ?? []) : [];
    const said = r.new !== undefined ? (notes?.get(r.new) ?? []) : [];
    const endsSel = sel && (sel.endLine ?? sel.line) === r.new;
    return (
      <Fragment key={k}>
        <div className="lc-rv-l" data-kind={r.kind} data-sel={inSel || undefined} data-change={r.kind !== "same" && (k === 0 || p.rows[k - 1]?.change !== r.change) ? r.change : undefined}>
          <span className="lc-rv-n">{r.old ?? ""}</span>
          {r.new !== undefined ? (
            <button
              type="button"
              className="lc-rv-n lc-rv-pick l-focus"
              aria-label={`Ask about line ${r.new}`}
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
          <span className="lc-rv-t">
            <Toks line={tok} />
          </span>
        </div>
        {said.map((f, j) => (
          <Note key={`f${j}`} f={f} reviewer={reviewer} />
        ))}
        {here.map((t) => (
          <div key={t.id} className="lc-rv-thread">
            <div className="lc-rv-q">
              <span className="lc-rv-lines">{t.anchor.endLine && t.anchor.endLine !== t.anchor.line ? `Lines ${t.anchor.line}–${t.anchor.endLine}` : `Line ${t.anchor.line}`}</span>
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
            <span className="lc-rv-lines">{sel!.endLine && sel!.endLine !== sel!.line ? `Lines ${sel!.line}–${sel!.endLine}` : `Line ${sel!.line}`}</span>
            <input
              className="lc-input"
              autoFocus
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
              placeholder={`Ask ${coder} about ${sel!.endLine && sel!.endLine !== sel!.line ? "these lines" : "this line"}`}
              onKeyDown={(e) => {
                // Enter that picks an input method's word isn't a send (T3 Code: BranchPicker.tsx).
                if (e.key === "Enter" && !e.nativeEvent.isComposing) void send();
                if (e.key === "Escape") setSel(() => null);
              }}
            />
            <button type="button" className="lc-btn" data-kind="primary" data-size="sm" disabled={!ask.trim()} onClick={() => void send()}>
              Ask
            </button>
          </div>
        )}
      </Fragment>
    );
  };

  return (
    <article className="lc-rv-file" data-file={p.file.path}>
      <header className="lc-rv-fh">
        <span className="lc-mono lc-path" title={p.moved ? `Moved from ${p.moved}` : p.file.path}>
          <span className="lc-quiet">{dirOf(p.file.path)}</span>
          <span>{baseOf(p.file.path)}</span>
        </span>
        {p.isNew && <span className="lc-pill" data-tone="ok">New</span>}
        {p.gone && <span className="lc-pill" data-tone="danger">Deleted</span>}
        {p.moved && <span className="lc-pill">Moved</span>}
        <span className="lc-grow" />
        <Lines added={p.added} removed={p.removed} />
      </header>
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
