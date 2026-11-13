/*
  An agent's ask, at the composer. A command it wants to run (or any plain tool or edit) isn't a
  card in the timeline any more: there it is a row that waits, and the ask itself takes the head of
  the composer's tray, where your hands already are. It says who asks and in its own words what the
  command will do, the command a row a step, why it came to you and where it runs; then Not this,
  and Run it with an arrow for the ways to say yes for longer. Typing into the empty box, or Not
  this, turns it into sending it back with your words. What can't be undone is shown whole, in a
  red ring, and only a hold runs it.

  Session.tsx makes the dock (useDockAsk) and hands it both to the tray's head (AskDock) and to the
  composer, which keeps the keys: Enter answers only as askKey (ask-text.ts) says. Add-on cards,
  questions, plans and the PR card's test run stay where they were.
*/
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as KeyEvent, type MutableRefObject, type ReactNode } from "react";
import { PR_TEST_TOOL, type ApprovalGrant, type ApprovalWhy, type GrantKind, type Item, type Thread } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { HoldToConfirm } from "@liner/components/hold-to-confirm/hold-to-confirm";
import { rpc, useEngine, useItemsWhere } from "./engine";
import { I } from "./icons";
import { accessOf, agentOf, plural } from "./model";
import { Kbd, Pop, Row, Sep } from "./ui";
import { askKey, bitsOf, rowsOf } from "./ask-text";
import * as os from "./os";

type Ask = Extract<Item, { kind: "approval" }>;

/** An ask the composer takes: a plain tool, edit or command ask still waiting. Add-ons and the PR card's test run keep their own cards. */
export const isDockable = (it: Item): it is Ask => it.kind === "approval" && it.state === "asking" && !it.addon && it.tool !== PR_TEST_TOOL;
/** The view the dock reads: its asks, and the turns' marks for who asks. */
const isDockView = (it: Item) => it.kind === "turn" || isDockable(it);

const SHELLS = new Set(["Bash", "shell", "execute", PR_TEST_TOOL]);
/** The command an ask would run, when it is one. */
export const commandOf = (it: Ask) => it.fields.find((f) => f.label === "Command")?.value;
const isCommand = (it: Ask) => commandOf(it) !== undefined || SHELLS.has(it.tool);
/** The fields that say where it runs: they go with the facts, not under the command. */
const WHERE = new Set(["Where", "Runs in"]);
/** What an ask says it does: the agent's own words, else its title. */
export const askWords = (it: Ask) => it.says?.trim() || it.title;
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
/**
  The headline: the agent's own words, unless they only repeat the command; for an ask that isn't
  a command, its title. A command's title is the command itself (OpenCode's) or "Run <command>",
  which the block under the headline already shows whole, so a command with no words of its own
  has no headline: the top line and the command carry it.
*/
export function headlineOf(it: Ask): string | undefined {
  const cmd = commandOf(it);
  const says = it.says?.trim();
  const repeats = (s: string) => cmd !== undefined && squash(s.replace(/^Run\s+/i, "")) === squash(cmd);
  if (says && !repeats(says)) return says;
  return cmd === undefined ? it.title : undefined;
}
/** Whether "Don't ask again this turn" may be offered: the engine says so on the item (`turnGrant`). */
const offersTurn = (it: Ask) => it.turnGrant === true;

/** What the composer and the tray's head share about the ask in view. */
export type DockAsk = {
  threadId: string;
  it: Ask;
  who: string;
  /** The access level's name, for "Auto asks because …". */
  level: string;
  /** The session's own folders, so "Runs in" can say "the project" or "the worktree" for them. */
  home: { project?: string; worktree?: string };
  /** It and the asks after it, oldest first. */
  index: number;
  total: number;
  next: Ask[];
  mode: "choose" | "back";
  setMode: (m: "choose" | "back") => void;
  /** Yes: once, or with a grant ("turn": until the turn ends). */
  run: (grant?: GrantKind | "turn") => void;
  /** No, with the box's words as the reason (Composer reads them). */
  sendBack: () => void;
  /** Set by the composer each time it draws: its box, to read, empty into a reason and focus. */
  box: MutableRefObject<{ text: () => string; take: () => string | undefined; focus: () => void } | null>;
  /** When the box last changed (the composer sets it), and when this ask came into view: askKey's guards. */
  typedAt: MutableRefObject<number>;
  shownAt: number;
  /** Enter and Esc on the ask itself, or in the composer's box: true when the key was the ask's. */
  onKey: (e: KeyEvent) => boolean;
};

const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));

/** The oldest ask the composer takes in this session, and what goes with it; null when none waits. */
export function useDockAsk(thread: Thread, fallbackWho: string): DockAsk | null {
  const view = useItemsWhere(thread.id, isDockView);
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  const projectPath = useEngine((s) => s.projects.find((p) => p.id === thread.projectId)?.path);
  // Answered here and on its way: out of view at once, so the next one (or none) shows, and a second Enter can't answer it twice.
  const [gone, setGone] = useState<Set<string>>(() => new Set());
  const [back, setBack] = useState<string | null>(null);
  const typedAt = useRef(0);
  const box = useRef<{ text: () => string; take: () => string | undefined; focus: () => void } | null>(null);
  const shown = useRef<{ id: string; at: number } | null>(null);
  const asks = useMemo(() => view.filter((x): x is Ask => isDockable(x) && !gone.has(x.id)).sort((a, b) => a.at - b.at), [view, gone]);
  const it = asks[0];
  if (!it) return null;
  if (shown.current?.id !== it.id) shown.current = { id: it.id, at: Date.now() };
  const mark = view.find((x) => x.kind === "turn" && x.turn === it.turn);
  const who = mark?.kind === "turn" ? agentOf(mark.agent, agents, providers).name : fallbackWho;
  const mode = back === it.id ? "back" : "choose";
  const answer = (allow: boolean, extra: { reason?: string; grant?: GrantKind | "turn" }) => {
    const id = it.id;
    setGone((g) => new Set(g).add(id));
    setBack(null);
    rpc("approval.answer", { threadId: thread.id, itemId: id, allow, ...extra }).catch((e) => {
      setGone((g) => {
        const n = new Set(g);
        n.delete(id);
        return n;
      });
      fail(e);
    });
  };
  const dock: DockAsk = {
    threadId: thread.id,
    it,
    who,
    level: accessOf(thread.access).short,
    home: { project: projectPath, worktree: thread.worktree?.path },
    index: 1,
    total: asks.length,
    next: asks.slice(1, 3),
    mode,
    setMode: (m) => setBack(m === "back" ? it.id : null),
    run: (grant) => answer(true, grant ? { grant } : {}),
    sendBack: () => answer(false, { reason: box.current?.take() }),
    box,
    typedAt,
    shownAt: shown.current.at,
    onKey: (e) => {
      const act = askKey({
        key: e.key,
        mod: e.metaKey || e.ctrlKey,
        shift: e.shiftKey,
        alt: e.altKey,
        repeat: e.repeat,
        mode,
        high: it.risk === "high",
        grants: it.grants?.length ?? 0,
        box: box.current?.text() ?? "",
        now: Date.now(),
        typedAt: typedAt.current,
        shownAt: shown.current?.at ?? Date.now(),
      });
      if (!act) return false;
      e.preventDefault();
      e.stopPropagation();
      if (act === "run") dock.run();
      else if (act === "grant" && it.grants?.[0]) dock.run(it.grants[0].kind);
      else if (act === "send-back") dock.sendBack();
      else if (act === "not-this") (dock.setMode("back"), box.current?.focus());
      else if (act === "back") dock.setMode("choose");
      return true;
    },
  };
  return dock;
}

/**
  A grant as the menu says it, from its label and kind: `what` it stops asking about (after "don't
  ask again for"), `short` for the quiet button, and what still asks. A skill's says its folder too.
*/
function grantWords(g: ApprovalGrant): { what: ReactNode; short: ReactNode; stays: string; folder?: string } {
  if (g.kind === "skill") return { what: "this skill's scripts", short: "this skill's scripts", folder: g.label, stays: "This session. Its scripts count as the project's own; anything else they reach still asks." };
  // A tool's rule is its name ("Edit"); a command's is that one command's rule.
  const tool = !/[\s,]/.test(g.label) && /^[A-Z]/.test(g.label);
  const label = g.label === "Edit" ? "edits" : g.label;
  return { what: <code className="lc-code">{label}</code>, short: label, stays: tool ? "This session. Other tools still ask." : "This session. Only this command goes ahead; anything else still asks." };
}

/** A why, as the facts line says it: the level's own sentence, "Can't be undone: …", or "<Level> asks because …". */
function whyLine(w: ApprovalWhy, level: string): ReactNode {
  if (w.kind === "level") return w.text;
  if (w.kind === "undo")
    return (
      <>
        <b>Can't be undone:</b> {w.text}
      </>
    );
  // The names in it (a host, a folder) read in the warning colour, the rest as words.
  return (
    <>
      {level} asks because{" "}
      {w.text.split(/(\s+)/).map((x, i) => (/[~/.]\S/.test(x) ? <b key={i}>{os.tilde(x)}</b> : x))}
    </>
  );
}

const WHY_ICON: Record<ApprovalWhy["kind"], ReactNode> = {
  undo: <I.alert size={13} />,
  outside: <I.folder size={13} />,
  network: <I.globe size={13} />,
  changes: <I.edit size={13} />,
  level: <I.shield size={13} />,
};

/** The command, a row a step, each on one line until you ask for it whole. Past eight rows it scrolls. */
function Command({ text, whole }: { text: string; whole: boolean }) {
  const rows = useMemo(() => rowsOf(text), [text]);
  const [open, setOpen] = useState(false);
  const pre = useRef<HTMLPreElement>(null);
  // "Show it whole" only when a row is cut short: a short command is already whole.
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const el = pre.current;
    if (!el || whole) return;
    const measure = () => setCut([...el.children].some((r) => r.scrollWidth > r.clientWidth + 1));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [rows, whole]);
  const on = whole || open;
  return (
    <div className="lc-dask-cmd" data-open={on || undefined}>
      <pre ref={pre} aria-label="The command">
        {rows.map((r, i) => (
          <span key={i} className="lc-dask-l">
            {bitsOf(r).map((b, j) => (b.k === "p" ? <b key={j}>{b.t}</b> : b.k === "u" ? <span key={j} className="lc-dask-u">{b.t}</span> : b.t))}
            {"\n"}
          </span>
        ))}
      </pre>
      {!whole && (cut || open) && (
        <div className="lc-dask-foot">
          <span>{rows.length > 1 ? `${plural(rows.length, "part")}, a row each` : "One line, cut short"}</span>
          <span className="lc-grow" />
          <button type="button" className="lc-dask-more l-focus" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "A row a line" : "Show it whole"}
          </button>
        </div>
      )}
    </div>
  );
}

/** What this session no longer asks about (approval.rules), each with a way to take it back. */
function Rules({ threadId, onBack }: { threadId: string; onBack: () => void }) {
  const [rules, setRules] = useState<{ grants: ApprovalGrant[]; turn: boolean } | null>(null);
  const load = () => void rpc("approval.rules", { threadId }).then(setRules, fail);
  useLayoutEffect(load, [threadId]);
  const forget = (kind: GrantKind | "turn", label: string) => void rpc("approval.forget", { threadId, kind, label }).then(load, fail);
  return (
    <div className="lc-dask-rules">
      <button type="button" className="lc-dask-rules-h l-focus" onClick={onBack}>
        <I.chevL size={12} />
        What this session no longer asks about
      </button>
      {!rules ? (
        <p className="lc-quiet">Reading…</p>
      ) : !rules.grants.length && !rules.turn ? (
        <p className="lc-quiet">Nothing: every ask comes to you.</p>
      ) : (
        <ul>
          {rules.turn && (
            <li>
              <span>This turn runs as Auto would: what Auto asks about still comes to you.</span>
              <button type="button" className="lc-trow-lk l-focus" onClick={() => forget("turn", "")}>
                Ask again
              </button>
            </li>
          )}
          {rules.grants.map((g) => (
            <li key={`${g.kind}:${g.label}`}>
              <span>
                {grantWords(g).what}
                {g.kind === "skill" && <> in <code className="lc-code">{g.label}</code></>}
              </span>
              <button type="button" className="lc-trow-lk l-focus" onClick={() => forget(g.kind, g.label)}>
                Forget
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The menu behind Run it's arrow: each way to say yes, saying exactly what it allows. */
function Ways({ dock, yes, close }: { dock: DockAsk; yes: string; close: () => void }) {
  const [rules, setRules] = useState(false);
  const { it, who } = dock;
  const pick = (grant?: GrantKind | "turn") => (close(), dock.run(grant));
  if (rules) return <Rules threadId={dock.threadId} onBack={() => setRules(false)} />;
  return (
    <>
      <Row title={`${yes} once`} end={<Kbd>↵</Kbd>} onPick={() => pick()} />
      {(it.grants ?? []).map((g, i) => {
        const w = grantWords(g);
        return (
          <Row
            key={`${g.kind}:${g.label}`}
            title={
              <>
                {yes}, and don't ask again for {w.what}
              </>
            }
            note={
              w.folder ? (
                <>
                  <code className="lc-code">{w.folder}</code>
                  <br />
                  {w.stays}
                </>
              ) : (
                w.stays
              )
            }
            end={i === 0 ? <Kbd>{os.mod}↵</Kbd> : undefined}
            onPick={() => pick(g.kind)}
          />
        );
      })}
      {offersTurn(it) && <Row title="Don't ask again this turn" note={`Until ${who} answers, this turn runs as Auto would. What Auto asks about still comes to you.`} onPick={() => pick("turn")} />}
      <Sep />
      <Row title={<span className="lc-quiet">What this session no longer asks about…</span>} onPick={() => setRules(true)} />
    </>
  );
}
const bare = (p?: string) => p?.replace(/[\\/]+$/, "");
/**
  Where it runs: "the project" or "the worktree" when it's the session's own folder; else the path
  with ~, on one line, cut from the left so its end (the folder that matters) stays in view.
*/
function RunsIn({ path, home }: { path: string; home: DockAsk["home"] }) {
  const own = bare(path) === bare(home.worktree) ? "the worktree" : bare(path) === bare(home.project) ? "the project" : undefined;
  return (
    <span className="lc-dask-fact lc-dask-where" title={own ? path : undefined}>
      <I.folder size={13} />
      {own ? (
        <span>Runs in {own}</span>
      ) : (
        <>
          <span className="lc-dask-where-k">Runs in</span>
          <b className="lc-dask-path" title={path}>
            <bdi>{os.tilde(path)}</bdi>
          </b>
        </>
      )}
    </span>
  );
}

/** The ask in the composer tray's head. */
export function AskDock({ dock }: { dock: DockAsk }) {
  const { it, who, level, mode } = dock;
  const high = it.risk === "high";
  const command = commandOf(it);
  const shell = isCommand(it);
  const yes = shell ? "Run it" : "Allow";
  const top = shell ? (it.says ? `${who} asks to run a command, and says it will` : `${who} asks to run a command`) : `${who} asks to`;
  const where = it.fields.find((f) => WHERE.has(f.label));
  const rest = it.fields.filter((f) => f.label !== "Command" && !WHERE.has(f.label));
  // The first real reason it came to you. High risk puts what can't be undone first, and says any
  // other reason in the danger tone (Codex reaching a host, more access, outside the project); with
  // no reason given it says none rather than guess one.
  const why = high ? (it.why?.find((w) => w.kind === "undo") ?? it.why?.[0]) : it.why?.find((w) => w.kind !== "undo");
  const headline = headlineOf(it);
  const one = !high && it.grants?.length === 1 ? it.grants[0] : undefined;
  return (
    <section className="lc-dask" data-high={high || undefined} aria-label={`${who} asks: ${askWords(it)}`} tabIndex={-1} onKeyDown={(e) => {
      // A button takes its own Enter; a menu open on the ask has closed itself on Escape.
      if (e.defaultPrevented || e.nativeEvent.isComposing) return;
      if (e.key === "Enter" && e.target instanceof HTMLElement && e.target.closest("button, a, input, textarea")) return;
      dock.onKey(e);
    }}>
      <div className="lc-dask-top">
        <span className="lc-dask-pip" aria-hidden />
        <span className="lc-dask-who">{top}</span>
        {dock.total > 1 && (
          <>
            <span className="lc-grow" />
            <span className="lc-wk-tag l-num">
              {dock.index} of {dock.total}
            </span>
          </>
        )}
      </div>
      {headline && <h3 className="lc-dask-h">{headline}</h3>}
      {command !== undefined && <Command text={command} whole={high} />}
      {rest.length > 0 && (
        <dl className="lc-dask-fields">
          {rest.map((f, i) => (
            <div key={i}>
              <dt>{f.label}</dt>
              <dd>{["File", "Environment", "Instructions"].includes(f.label) ? <code>{os.tilde(f.value)}</code> : os.tilde(f.value)}</dd>
            </div>
          ))}
        </dl>
      )}
      {(why || where) && (
        <div className="lc-dask-facts">
          {why && (
            <span className="lc-dask-fact" data-kind={high ? "bad" : "why"}>
              {WHY_ICON[why.kind]}
              <span>{whyLine(why, level)}</span>
            </span>
          )}
          {where && <RunsIn path={where.value} home={dock.home} />}
        </div>
      )}
      {dock.next.length > 0 && (
        <ul className="lc-dask-next">
          {dock.next.map((n, i) => (
            <li key={n.id}>
              <span>{i === 0 ? "Next" : "Then"}</span>
              <code>{commandOf(n)?.split("\n")[0] ?? askWords(n)}</code>
            </li>
          ))}
        </ul>
      )}
      {mode === "back" ? (
        <div className="lc-dask-acts">
          <button type="button" className="lc-dask-ghost l-focus" onClick={() => dock.setMode("choose")}>
            Back
          </button>
          <span className="lc-grow" />
          <span className="lc-dask-hint">Say what to do instead below, or send it back as it is</span>
          <button type="button" className="lc-dask-run l-focus" data-solo onClick={dock.sendBack}>
            Send it back <kbd>↵</kbd>
          </button>
        </div>
      ) : (
        <div className="lc-dask-acts">
          <button type="button" className="lc-dask-ghost l-focus" onClick={() => (dock.setMode("back"), dock.box.current?.focus())}>
            Not this <kbd>esc</kbd>
          </button>
          <span className="lc-grow" />
          {high ? (
            <HoldToConfirm className="lc-dask-hold" duration={900} resetAfter={null} hintLabel="Keep holding" doneLabel={shell ? "Running it" : "Allowed"} onConfirm={() => dock.run()}>
              {shell ? "Hold to run" : /push/i.test(it.title) ? "Hold to push" : "Hold to allow"}
            </HoldToConfirm>
          ) : (
            <>
              {one && (
                <button type="button" className="lc-dask-also l-focus" title={[grantWords(one).folder, grantWords(one).stays].filter(Boolean).join(": ")} onClick={() => dock.run(one.kind)}>
                  <span className="lc-dask-also-t">Don't ask again for {grantWords(one).short}</span> <kbd>{os.mod}↵</kbd>
                </button>
              )}
              <span className="lc-dask-split">
                <button type="button" className="lc-dask-run l-focus" onClick={() => dock.run()}>
                  {yes} <kbd>↵</kbd>
                </button>
                <Pop label="More ways to answer" side="top" align="end" width={440} menu triggerClass="lc-dask-arrow" trigger={<I.chevU size={12} />}>
                  {(close) => <Ways dock={dock} yes={yes} close={close} />}
                </Pop>
              </span>
            </>
          )}
        </div>
      )}
    </section>
  );
}
