/*
  Liner Security: a scan, fix or question session (boards D, E, F). A scan is an ordinary session of your own tool, so
  it reads like one: the app's own timeline (its turn heads, its plan list, its steps and words) and the app's own
  composer, with Read only locked on it (the engine refuses any other level too). What is a scan's own is drawn here,
  through the timeline's `draw` hook: your choices as its first message with where they came from, each finding as a row
  the moment it is reported (it opens the finding), your answers to its questions with "saved to SECURITY.md", and the
  second look as a second voice once the scan ends. Its questions dock at the composer as one card (Questions.tsx), and
  the scan stays paused on them until you answer or skip: nothing here ever answers for you. The tray's status row says
  how far it is (Stop) or how it ended (Fix the confirmed one, Open the findings); the panel beside the chat is what it
  has found (FoundPanel). The top row has its name, the Read only tag, Scan again once it's done, and the panel's toggle.

  A fix is a session in a worktree that changes code: it gets the app's whole session view (Session.tsx), with its
  changes, its Reviewer and its terminal. A question about a finding reads like a scan, with that finding beside it.
  With ?ls-mock=d, e or f in the dev URL, a scan session shows the mockup's boards from scan-mock.ts instead of its timeline.
*/
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Item, ScanRecord, SecurityFinding, SecurityItem, Thread } from "@contracts";
import { DEPTH_LABEL, splitModel } from "@contracts";
import { useStickToBottom } from "@liner/pro/agents/agents";
import { toast } from "@liner/components/toast/toast";
import { AskDock, useDockAsk } from "../Ask";
import { Composer, type Outgoing, type RunSettings } from "../Composer";
import { getState, loadItems, rpc, threadOf, useEngine, useItems } from "../engine";
import { I, ModelMark, Spinner } from "../icons";
import { agentOf, duration, markOf, plural } from "../model";
import { Session } from "../Session";
import { Timeline } from "../Timeline";
import * as os from "../os";
import { FoundPanel, placeOf, type FoundData } from "./FoundPanel";
import { SevMark, Tag, TwoLines } from "./parts";
import { guessOf, onward, ScanQuestions, type QState, type QuestionItem } from "./Questions";
import { mockMode, mockScan, type MockScan } from "./scan-mock";
import { goSecurity, useScan, useSecurity } from "./store";
import "./scan.css";

const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));
const NONE_SEEN = new Set<string>();
/** The tool a scan reports a finding with, whatever its CLI calls Liner's tools (mcp__liner__…, liner_…). */
const REPORTS = /(^|_)security_report_finding$/;
const isAsking = (it: Item): it is QuestionItem => it.kind === "question" && it.state === "asking";
/** Below this width (the session's own) the found panel lies over the chat instead of beside it: the chat keeps 560px and the panel 420. */
const NARROW = 1000;

/**
  Where a card starts: the answers the engine kept while it asks (Item.partial, by question text), on the first question
  still unanswered, or further on where you had got to (a question skipped has no answer: where you were is kept here,
  in the window, so a reload doesn't ask it again).
*/
const AT_KEY = "liner.security-card-at.";
function startOf(q: QuestionItem): QState {
  const answers = q.partial ?? {};
  const first = q.questions.findIndex((x) => answers[x.question] === undefined);
  let kept = 0;
  try {
    kept = Number(sessionStorage.getItem(AT_KEY + q.id)) || 0;
  } catch {
    // no storage: the first unanswered question
  }
  const at = Math.max(first < 0 ? q.questions.length - 1 : first, Math.min(kept, q.questions.length - 1));
  return { at, answers };
}
function keepAt(itemId: string, at: number) {
  try {
    sessionStorage.setItem(AT_KEY + itemId, String(at));
  } catch {
    // kept until it reloads
  }
}

/** What the scan's own drawings in the timeline read: its findings, the card's answers so far, the first message's words. */
type ScanView = { scan: ScanRecord | null; findings: SecurityFinding[]; q: QuestionItem | null; qs: QState; first?: string };
const View = createContext<ScanView>({ scan: null, findings: [], q: null, qs: { at: 0, answers: {} } });

export function ScanSession({ sidebar, onSidebar, threadId }: { sidebar: boolean; onSidebar: () => void; /** The session: a thread tagged security (scan, fix or ask). */ threadId: string }) {
  const thread = useEngine((s) => threadOf(s, threadId));
  if (!thread) return null;
  // A fix changes code in a worktree of its own: the whole session view, with its changes, Reviewer and terminal.
  if (thread.security?.kind === "fix")
    return <Session thread={thread} sidebar={sidebar} onSidebar={onSidebar} onNewAgent={() => {}} onOpenSession={(id) => threadOf(getState(), id)?.security && goSecurity({ kind: "scan", threadId: id })} onRoutine={() => {}} />;
  return <ScanChat thread={thread} sidebar={sidebar} onSidebar={onSidebar} />;
}

function ScanChat({ thread, sidebar, onSidebar }: { thread: Thread; sidebar: boolean; onSidebar: () => void }) {
  const tag = thread.security;
  const isScan = tag?.kind === "scan";
  const project = useEngine((s) => s.projects.find((p) => p.id === thread.projectId));
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  const coder = agentOf(thread.agent, agents, providers);

  // The dev mock (?ls-mock=d, e or f): the mockup's board in place of the timeline, moved on as you answer.
  const asked = mockMode();
  const [mock, setMock] = useState<MockScan | null>(() => (isScan && (asked === "d" || asked === "e" || asked === "f") ? mockScan(asked, thread.id, thread.agent) : null));
  const own = useItems(mock ? undefined : thread.id);
  const items = mock?.items ?? own;
  useEffect(() => {
    if (!mock) void loadItems(thread.id).catch(() => {});
  }, [thread.id]);
  // Items there when the session opened render at once; newer ones come in.
  const seen = useRef<Set<string> | null>(null);
  if (seen.current === null && items.length) seen.current = new Set(items.map((x) => x.id));

  const live = useScan(mock ? undefined : tag?.scan);
  const scan = mock?.scan ?? live;
  const listed = useSecurity("security.findings.list", { projectId: thread.projectId }, ["findings"]);
  const findings = mock?.findings ?? listed.data ?? [];
  const status = mock ? mock.status : thread.status;
  const busy = status === "running";

  // The question waiting, and where its card is.
  const q = useMemo(() => (items.findLast(isAsking) as QuestionItem | undefined) ?? null, [items]);
  const [qs, setQs] = useState<{ id: string; s: QState } | null>(null);
  const qState: QState = q && qs?.id === q.id ? qs.s : q && mock?.seed ? mock.seed : q ? startOf(q) : { at: 0, answers: {} };
  // Each answer goes to the engine as it is given (question.partial), so the answers so far survive a reload; once the
  // card is done the engine has them all through question.answer and may refuse this one, which is fine.
  const setQState = (s: QState) => {
    if (!q) return;
    setQs({ id: q.id, s });
    keepAt(q.id, s.at);
    if (!mock && JSON.stringify(s.answers) !== JSON.stringify(qState.answers)) void rpc("question.partial", { threadId: thread.id, itemId: q.id, answers: s.answers }).catch(() => {});
  };
  const answer = (answers: Record<string, string>) => {
    if (!q) return;
    if (mock) return setMock(mockScan("e", thread.id, thread.agent));
    const given = Object.keys(answers).length > 0;
    void rpc("question.answer", { threadId: thread.id, itemId: q.id, ...(given ? { answers } : {}) }).catch(fail);
  };
  const asking = useDockAsk(thread, coder.name);

  // The plan's progress and a guess at the time left, kept fresh while it runs.
  const plan = items.findLast((x): x is Extract<Item, { kind: "plan" }> => x.kind === "plan");
  const done = plan?.entries.filter((e) => e.status === "completed").length ?? 0;
  const total = plan?.entries.length ?? 0;
  const running = Boolean(scan && (scan.state === "running" || scan.state === "asking"));
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [running]);
  const left = running && scan && !scan.looking ? leftOf(scan, done, total, now) : undefined;

  // Writing when a question came (the box wasn't empty): those words stay a message, sent after the questions; once the box
  // is empty again, what you write answers the card.
  const [writing, setWriting] = useState(false);
  useEffect(() => {
    const box = root.current?.querySelector<HTMLTextAreaElement>(".lc-compose textarea.lc-field");
    setWriting(Boolean(q && box?.value.trim()));
  }, [q?.id]);
  // Beside the chat when there is room for both; narrower, the panel lies over the chat, shut until you open it, and a
  // question that comes shuts it so the card is in sight.
  const root = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  const [panelPick, setPanel] = useState<boolean | null>(null);
  const panel = panelPick ?? !narrow;
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setNarrow(el.clientWidth < NARROW));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    // Back to the panel's own default (shut when narrow): wide again, it shows as it would have.
    if (q && narrow) setPanel(null);
  }, [q?.id, narrow]);
  const { ref: scroller, contentRef, away, jump, stick, follow } = useStickToBottom();
  const foot = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const d = foot.current;
    if (!d) return;
    // The composer's height, for the text to scroll clear of it and for the narrow panel to end above it.
    const ro = new ResizeObserver(() => (threadRef.current?.style.setProperty("--lc-dock-h", `${d.offsetHeight}px`), root.current?.style.setProperty("--lsc-dock-h", `${d.offsetHeight}px`)));
    ro.observe(d);
    return () => ro.disconnect();
  }, []);

  // The first message, which Start a scan wrote: drawn with where it came from.
  const first = items.find((x) => x.kind === "user")?.id;
  // The engine's own lines (Item kind "security"): the last word on how it ended, and the second look's result.
  const lines = items.flatMap((x) => (x.kind === "security" ? [x.event] : []));
  const ended = lines.findLast((e): e is Extract<SecurityItem, { type: "done" }> => e.type === "done");
  const look = lines.findLast((e): e is Extract<SecurityItem, { type: "look" }> => e.type === "look");
  // A question whose answers the engine wrote down after it (an "answers" line) is drawn from that line, not twice.
  const told = new Set<string>();
  for (const a of items) if (a.kind === "security" && a.event.type === "answers") {
    const was = items.findLast((x) => x.kind === "question" && x.state !== "asking" && x.at <= a.at && !told.has(x.id));
    if (was) told.add(was.id);
  }
  const toldRef = useRef(told);
  toldRef.current = told;
  const view: ScanView = { scan, findings, q, qs: qState, first };
  const drawOwn = useCallback((it: Item): ReactNode | null | undefined => {
    if (it.kind === "user" && it.id === first) return <FirstMessage it={it} />;
    if (it.kind === "security") return it.event.type === "finding" ? <Reported ev={it.event} /> : it.event.type === "answers" ? <Answers ev={it.event} /> : it.event.type === "look" ? <Voice ev={it.event} /> : null;
    // The report call itself is the "finding" line above, which knows the finding's id: one row per finding.
    if (it.kind === "tool" && REPORTS.test(it.tool)) return null;
    if (it.kind === "question") return it.state === "asking" ? <SoFar id={it.id} /> : toldRef.current.has(it.id) ? null : <Answered it={it} />;
    return undefined;
  }, [first]);

  const settings: RunSettings = { agent: thread.agent, model: thread.model, effort: thread.effort ?? coder.effort, access: thread.access, ...(thread.sidekick ? { sidekick: thread.sidekick } : {}) };
  const update = (patch: Partial<RunSettings>) => {
    const p: Parameters<typeof rpc<"thread.update">>[1] = { id: thread.id };
    // A Specialist scan is sealed: the engine refuses a model that can't run sealed, and its own words show as they are (fail).
    if ("agent" in patch) p.agent = patch.agent;
    if ("model" in patch) p.model = patch.model ?? null;
    if ("effort" in patch) p.effort = patch.effort;
    // A scan stays at Read only (the chip is locked, and the engine refuses it too).
    if ("access" in patch && !isScan && tag?.kind !== "ask") p.access = patch.access;
    void rpc("thread.update", p).catch(fail);
  };
  const send = async (m: Outgoing) => {
    // A question up: what you write is your own answer to it, not a message; unless you were already writing when it came.
    if (q && !writing) {
      const cur = q.questions[Math.min(qState.at, q.questions.length - 1)];
      if (cur) setQState(onward(q, qState, { ...qState.answers, [cur.question]: m.text.trim() }, answer));
      return;
    }
    if (mock) return;
    try {
      await rpc("thread.send", { id: thread.id, text: m.text, files: m.files, mode: q ? "queue" : m.mode });
      setWriting(false);
      stick();
    } catch (e) {
      fail(e);
      throw e;
    }
  };
  // Enter alone in the box, while a question is up, takes the scan's guess.
  const takeGuess = (e: KeyboardEvent) => {
    if (!q || e.key !== "Enter" || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || e.nativeEvent.isComposing) return;
    if (!(e.target instanceof HTMLTextAreaElement) || e.target.value.trim()) return;
    const cur = q.questions[Math.min(qState.at, q.questions.length - 1)];
    const guess = cur && guessOf(cur);
    if (!guess) return;
    e.preventDefault();
    e.stopPropagation();
    setQState(onward(q, qState, { ...qState.answers, [cur.question]: guess.label }, answer));
  };
  // Stop: the scan while it runs; once it has ended, the session is an ordinary chat, and Stop stops its turn.
  const stop = () => void (mock ? undefined : (tag?.scan && running ? rpc("security.scan.stop", { id: tag.scan }) : rpc("thread.stop", { id: thread.id })).catch(fail));

  const finished = scan && (scan.state === "done" || scan.state === "stopped" || scan.state === "failed");
  const fresh = findings.filter((f) => scan && f.scan === scan.id);
  // Which held up: the second look's own word on each, else what the findings carry.
  const held = look?.results.filter((r) => r.state === "confirmed").map((r) => r.finding) ?? fresh.filter((f) => f.look.state === "confirmed").map((f) => f.id);
  const confirmed = held.map((id) => findings.find((f) => f.id === id)).filter((f): f is SecurityFinding => Boolean(f && f.state === "open" && !f.fix));
  const newCount = ended?.counts.fresh ?? scan?.counts.fresh ?? fresh.length;
  const heldCount = ended?.confirmed ?? held.length;
  const lookName = useLookName(look?.by ?? scan?.secondLook);
  const fix = async (f: SecurityFinding) => {
    if (mock) return toast("The dev mock doesn't start a fix");
    try {
      const t = await rpc("security.finding.fix", { id: f.id });
      goSecurity({ kind: "scan", threadId: t.id });
    } catch (e) {
      fail(e);
    }
  };
  const row = q ? (
    <ScanQuestions key={q.id} it={q} state={qState} onState={setQState} onDone={answer} note={writing ? "Enter sends what you are writing as a message, after the questions. Empty the box to answer here." : undefined} />
  ) : asking ? (
    <AskDock dock={asking} />
  ) : isScan && scan && !finished ? (
    <div className="lc-trow" role="status">
      <Spinner size={16} />
      <span className="lc-trow-t lc-grow">{scan.looking ? `Second look · ${lookName ?? "another maker's model"} reads what it found` : ["Scanning", total ? `${done} of ${total} done` : "", left ?? ""].filter(Boolean).join(" · ")}</span>
      <button type="button" className="lc-trow-lk l-focus" onClick={stop}>
        Stop
      </button>
    </div>
  ) : isScan && scan && finished ? (
    <div className="lc-trow" role="status">
      {scan.state === "done" ? <I.settle size={16} /> : <I.alert size={16} />}
      <span className="lc-trow-t lc-grow">
        {scan.error ? scan.error.replace(/\.$/, "") : scan.state === "done" ? "Scan finished" : scan.state === "stopped" ? "Scan stopped" : "The scan didn't finish"} · {newCount ? `${plural(newCount, "new finding")}${scan.secondLook || look ? `, ${heldCount} confirmed` : ""}` : "nothing new found"}
      </span>
      {scan.error && (
        <button type="button" className="lc-trow-lk l-focus" onClick={() => goSecurity({ kind: "start", projectId: thread.projectId })}>
          Scan again
        </button>
      )}
      {confirmed.length > 0 && (
        <button type="button" className="lc-trow-lk l-focus" title="Starts a session in a worktree of its own with this finding as its brief" onClick={() => void fix(confirmed[0])}>
          {confirmed.length === 1 ? "Fix the confirmed one" : "Fix the first confirmed one"}
        </button>
      )}
      <button type="button" className="lc-trow-lk l-focus" onClick={() => goSecurity({ kind: "findings", state: "open", ...(scan ? { scan: scan.id } : {}) })}>
        Open the findings
      </button>
    </div>
  ) : null;

  const placeholder = q && writing ? "Your message goes after the questions" : q ? "Something else? Type it here. Enter alone takes my guess" : !isScan ? `Ask ${coder.name} about this finding` : finished ? "Ask about a finding, or say what to scan next" : "Say where to look next, or ask about a finding";
  const data: FoundData | undefined = mock ? { scan: mock.scan, findings: mock.findings, model: mock.model } : undefined;
  return (
    <View.Provider value={view}>
      <div ref={root} className="lc-session lsc-scan" data-found={panel || undefined} data-narrow={narrow || undefined}>
        <div className="lc-body">
          <section ref={threadRef} className="lc-thread" aria-label={isScan ? "The scan" : "Session"}>
            <header className="lc-top" data-drag>
              {!sidebar && (
                <button type="button" className="lc-tb l-focus" aria-label="Show the sidebar" title={`Show the sidebar (${os.mod}\\)`} onClick={onSidebar}>
                  <I.sidebar size={16} />
                </button>
              )}
              <h1 className="lc-title">{thread.title}</h1>
              {thread.access === "read" && (
                <span className="ls-tag lsc-ro" title={isScan ? "A scan only reads: it stays at Read only" : "This session only reads"}>
                  <I.lock size={12} />
                  Read only
                </span>
              )}
              <span className="lc-grow" data-drag />
              {isScan && finished && (
                <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => goSecurity({ kind: "start", projectId: thread.projectId })}>
                  Scan again
                </button>
              )}
              <button type="button" className="lc-tb l-focus" aria-pressed={panel} aria-label={panel ? "Hide what the scan has found" : "Show what the scan has found"} title={panel ? "Hide what the scan has found" : "Show what the scan has found"} onClick={() => setPanel(!panel)}>
                <I.panel size={16} />
              </button>
            </header>
            <div className="lc-stage">
              <div ref={scroller} className="lc-scroll">
                <div ref={contentRef} className="lc-scroll-in">
                  <Timeline threadId={thread.id} items={mock ? items : undefined} docked seen={seen.current ?? NONE_SEEN} onReview={() => {}} onGrow={follow} draw={isScan ? drawOwn : undefined} />
                </div>
              </div>
            </div>
            <div ref={foot} className="lc-thread-foot">
              {away && (
                <button type="button" className="lc-jump l-glass l-focus" onClick={jump}>
                  <I.chevD size={14} />
                  Latest
                </button>
              )}
              {project && (
                <div className="lc-compose" onKeyDownCapture={takeGuess} onInputCapture={(e) => writing && e.target instanceof HTMLTextAreaElement && !e.target.value.trim() && setWriting(false)}>
                  <Composer
                    variant="session"
                    project={project}
                    thread={thread}
                    settings={settings}
                    onSettings={update}
                    onSend={send}
                    onStop={stop}
                    busy={busy && !q}
                    placeholder={placeholder}
                    autoFocus={!q}
                    ask={q ? undefined : (asking ?? undefined)}
                    accessLock={isScan ? "A scan only reads: it stays at Read only" : tag?.kind === "ask" ? "A question about a finding stays at Read only." : undefined}
                    checkOff
                    top={row}
                  />
                </div>
              )}
            </div>
          </section>
          {panel && <FoundPanel scanId={isScan ? (scan?.id ?? tag?.scan) : undefined} finding={tag?.finding} threadId={thread.id} projectId={thread.projectId} paused={Boolean(q)} left={left} data={data} onClose={() => setPanel(false)} />}
        </div>
      </div>
    </View.Provider>
  );
}

/** "about 2 min left": by how long the plan's steps have taken so far, never past when the engine stops it. */
function leftOf(scan: ScanRecord, done: number, total: number, now: number) {
  const spent = now - scan.startedAt;
  // When the engine will stop it (pushed on by the time it waited on you), else Stops after from its start.
  const cap = scan.endsAt ? scan.endsAt - now : scan.stopsAfter ? scan.stopsAfter * 60_000 - spent : Infinity;
  const guess = done > 0 && total > done ? (spent / done) * (total - done) : cap;
  const ms = Math.min(guess, cap);
  if (!Number.isFinite(ms)) return undefined;
  const min = Math.max(1, Math.ceil(ms / 60_000));
  return `about ${min} min left`;
}

/** The first message: your choices on Start a scan, in your words, and where they came from. */
function FirstMessage({ it }: { it: Extract<Item, { kind: "user" }> }) {
  const { scan } = useContext(View);
  const [told, setTold] = useState(false);
  const words = it.shown?.text ?? it.text.split(/\n\s*\n/)[0];
  const meta = ["From Start a scan", scan && (scan.depth === "branch" ? "this branch's changes" : DEPTH_LABEL[scan.depth].toLowerCase()), scan?.stopsAfter && `stops after ${scan.stopsAfter} min`].filter(Boolean).join(" · ");
  return (
    <div className="lsc-first">
      <div className="lc-you">
        <p className="lc-you-shown">{words}</p>
      </div>
      <div className="lsc-bmeta">
        {meta}
        {words.trim() !== it.text.trim() && (
          <button type="button" className="lc-you-told l-focus" aria-expanded={told} onClick={() => setTold(!told)}>
            What the scan was told
            <I.chevR size={12} />
          </button>
        )}
      </div>
      {told && <pre className="lc-you-toldbox">{it.text}</pre>}
    </div>
  );
}

/** One answer in the thread: the question, quiet, over what you answered. */
function Bubble({ pairs, meta }: { pairs: [string, string][]; meta: string }) {
  return (
    <div className="lsc-qa">
      <div className="lsc-qa-b">
        {pairs.map(([q, a]) => (
          <span key={q} className="lsc-qa-p">
            <span className="lsc-qq">{q}</span>
            <span className="lsc-aa">{a}</span>
          </span>
        ))}
      </div>
      <div className="lsc-bmeta">{meta}</div>
    </div>
  );
}

const SAVED = "saved to SECURITY.md, so the next scan won't ask";
/** "it was my guess" when every answer given was the scan's guess. */
const guessed = (it: QuestionItem, answers: Record<string, string>) => {
  const given = it.questions.filter((q) => answers[q.question] !== undefined);
  return given.length > 0 && given.every((q) => guessOf(q)?.label === answers[q.question]);
};

/** A scan's questions once answered or skipped: what you said stays in the thread. */
function Answered({ it }: { it: QuestionItem }) {
  const answers = it.answers ?? {};
  const pairs = it.questions.filter((q) => answers[q.question] !== undefined).map((q) => [q.question, answers[q.question]] as [string, string]);
  if (it.state === "expired") return <p className="lsc-qa-note">The scan stopped before you answered {plural(it.questions.length, "question")}.</p>;
  if (!pairs.length) return <p className="lsc-qa-note">You skipped {it.questions.length === 1 ? "the question" : `the ${it.questions.length} questions`}: the scan goes by its guesses and says so in each finding.</p>;
  const skipped = it.questions.length - pairs.length;
  const meta = it.questions.length === 1 ? ["Your answer", guessed(it, answers) && "it was my guess", SAVED] : [`Your answers to ${pairs.length} of ${it.questions.length} questions`, skipped > 0 && `${skipped} skipped`, guessed(it, answers) && "each was my guess", "saved to SECURITY.md"];
  return <Bubble pairs={pairs} meta={meta.filter(Boolean).join(" · ")} />;
}

/** The questions still on the card: the answers given so far stay in the thread as you go (board D). */
function SoFar({ id }: { id: string }) {
  const { q, qs } = useContext(View);
  if (!q || q.id !== id) return null;
  const pairs = q.questions.filter((x) => qs.answers[x.question] !== undefined).map((x) => [x.question, qs.answers[x.question]] as [string, string]);
  return (
    <>
      {pairs.map(([question, a]) => {
        const it = q.questions.find((x) => x.question === question)!;
        return <Bubble key={question} pairs={[[question, a]]} meta={["Your answer", guessOf(it)?.label === a && "it was my guess", "goes to SECURITY.md, so the next scan won't ask"].filter(Boolean).join(" · ")} />;
      })}
    </>
  );
}

/** The second look's model by its tool's name ("Codex"), from "<provider>:<model>". */
function useLookName(by: string | undefined) {
  const providers = useEngine((s) => s.providers);
  if (!by) return undefined;
  const { provider } = splitModel(by);
  return providers.find((p) => p.id === provider)?.label ?? provider.charAt(0).toUpperCase() + provider.slice(1);
}

/**
  A finding the scan reported (the engine's "finding" line), as a row in the thread the moment it comes: how bad, what,
  where, and the second look as it stands now. One already open or dismissed before isn't raised again: the panel lists
  what was already open apart, so the thread shows nothing for it.
*/
function Reported({ ev }: { ev: Extract<SecurityItem, { type: "finding" }> }) {
  const { scan, findings } = useContext(View);
  if (ev.outcome === "already-open" || ev.outcome === "dismissed-before" || !ev.finding) return null;
  const f = findings.find((x) => x.id === ev.finding);
  const severity = f?.severity ?? ev.severity;
  const look = f?.look.state ?? "none";
  const waiting = look === "none" && Boolean(scan?.secondLook) && (scan?.looking || (scan?.state !== "done" && scan?.state !== "stopped" && scan?.state !== "failed"));
  const note = [placeOf(f ?? { file: ev.file, line: ev.line }), ev.outcome === "reopened" ? "found again after its fix" : "", waiting ? "waiting for the second look" : ""].filter(Boolean).join(" · ");
  return (
    <button type="button" className="lsc-rw lsc-tl-rw l-focus" title={ev.why} onClick={() => goSecurity({ kind: "findings", finding: ev.finding, state: f?.state })}>
      <SevMark severity={severity} />
      <TwoLines title={f?.title ?? ev.title} note={note} />
      {look !== "none" && <Tag tone={look === "confirmed" ? "ok" : undefined}>{look === "confirmed" ? "Confirmed" : "Couldn't confirm"}</Tag>}
    </button>
  );
}

/** Your answers to the scan's questions, as the engine took them (its "answers" line): each answer, and where it went. */
function Answers({ ev }: { ev: Extract<SecurityItem, { type: "answers" }> }) {
  const given = ev.lines.filter((l) => l.answer !== undefined);
  if (!given.length) return <p className="lsc-qa-note">You skipped {ev.asked === 1 ? "the question" : `the ${ev.asked} questions`}: the scan goes by its guesses and says so in each finding.</p>;
  const where = ev.saved ? `saved to ${ev.saved}` : "kept for the threat model";
  const meta = ev.asked === 1 ? ["Your answer", given[0].guess && "it was my guess", ev.saved ? `${where}, so the next scan won't ask` : where] : [`Your answers to ${ev.answered} of ${ev.asked} questions`, ev.skipped > 0 && `${ev.skipped} skipped`, where];
  return <Bubble pairs={given.map((l) => [l.question, l.answer!] as [string, string])} meta={meta.filter(Boolean).join(" · ")} />;
}

/**
  The second look, as a second voice in the same thread (the engine's "look" line, the same item from running to done):
  another maker's model, Read only, saying which finding holds.
*/
function Voice({ ev }: { ev: Extract<SecurityItem, { type: "look" }> }) {
  const name = useLookName(ev.by) ?? "Another model";
  const words = ev.words?.trim() || ev.results.flatMap((r) => (r.words ? [r.words] : [])).join(" ");
  return (
    <div className="lsc-voice">
      <div className="lc-head">
        <span className="lc-disc lc-disc-model" style={{ width: 22, height: 22 }} aria-hidden>
          <ModelMark kind={markOf(ev.by)} size={14} />
        </span>
        <b>{name}</b>
        <span className="lc-head-meta">· Second look · Read only{ev.state === "done" && ev.seconds ? ` · ${duration(ev.seconds)}` : ""}</span>
      </div>
      {ev.state === "running" ? (
        <p className="lsc-voice-wait">
          <Spinner size={14} />
          <span className="l-shimmer">Reading what the scan found</span>
        </p>
      ) : ev.state === "failed" ? (
        <p className="lsc-voice-wait">The second look didn't finish{ev.error ? `: ${ev.error}` : ""}. The findings stay unconfirmed.</p>
      ) : (
        <div className="lc-md">
          <p>{words}</p>
        </div>
      )}
    </div>
  );
}
