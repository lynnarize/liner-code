/*
  Carry on: work that's already yours to pick up and isn't in Liner Code's list. The work not committed in the project
  you were last in (none offered when that isn't a code project: never another project's), and the sessions in Claude
  Code and Codex in your projects not brought in yet, newest first (sessions.recent, one read of both tools for every
  project). Sessions that wait on you are in the list's own groups already, so they aren't here.
  It shows in two places, from one list (useCarry): the first three as cards under Home's box (HomeCarry, "All N" opens
  the whole list there), and the whole list as a panel beside the sidebar, from its More menu and its Sessions menu
  (CarryOn). A switch in Settings ("Show Carry on on Home", Settings.carryOn, on unless turned off) takes both away,
  and with them every read behind them: neither is mounted while it is off.
*/
import { useEffect, useId, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import type { RecentSession } from "@contracts";
import { carryOnOn } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { rpc, useEngine } from "./engine";
import { I, ModelMark, StateMark, type MarkKind } from "./icons";
import { ago, codeProjects, plural, since } from "./model";
import { Pop } from "./ui";

/**
  What Carry on found last, kept while the app is open: within a minute nothing is asked again. The
  sessions go by your code projects, the work not committed by project. A project whose sessions
  change what they've left uncommitted (a turn ends, a commit goes in) has its count marked old, so
  the next look asks Git again; the old count stands until it answers. The reads out are kept here
  too, so Home's cards and the sidebar's panel, both up at once, ask once between them.
*/
let recentFound: { at: number; key: string; theirs: RecentSession[] } | null = null;
let recentPending: { key: string; p: Promise<RecentSession[]> } | null = null;
type Changed = { at: number; n: number; added: number; removed: number; branch?: string };
const changedFound = new Map<string, Changed>();
const changedPending = new Map<string, Promise<Changed>>();
/** How long what Carry on found stands before it asks again. */
const RECENT_FOR = 60_000;
/** Rows Carry on holds at most. */
const RECENT_MAX = 6;
/** Cards Home shows at most. */
export const HOME_CARDS = 3;
const fresh = (x: { at: number } | null | undefined) => Boolean(x && Date.now() - x.at < RECENT_FOR);
/** The tools Carry on knows by name, in the order their groups come; any other is named after its id and comes after them. */
const TOOLS: Record<string, { name: string; mark: MarkKind }> = { claude: { name: "Claude Code", mark: "claudecode" }, codex: { name: "Codex", mark: "codex" } };
const toolOf = (tool: string) => TOOLS[tool] ?? { name: tool.charAt(0).toUpperCase() + tool.slice(1), mark: "other" as const };
const toolOrder = (tool: string) => (tool in TOOLS ? Object.keys(TOOLS).indexOf(tool) : 99);

/** "just now", "4 min ago", "2 hours ago", "yesterday". */
const agoLong = (at: number, now: number) => {
  const m = Math.floor((now - at) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : since(at, now);
};

/**
  The list Carry on builds, for one place that shows it. It needs its count before it's opened, so it asks once the app
  has been still a moment after it comes up, and again when `again` is called (its panel opens) or the window comes back
  to the front, when what it has is over a minute old (so a row hidden for want of anything, or after a failed read,
  comes back by itself). sessions.recent is a read of the tools' folders on the engine (each project's Claude Code folder
  listed, Codex's whole tree walked, the first 96 KB of the newest few dozen files read), so nothing asks it on a timer.
  Moving to another project asks only Git again, for that project, once a minute at most, or sooner after its sessions
  changed what's uncommitted.
*/
function useCarry(projectId: string | undefined, canCarry: boolean, onOpen: (id: string) => void) {
  const all = useEngine((s) => s.projects);
  const projects = useMemo(() => codeProjects(all), [all]);
  const project = projects.find((p) => p.id === projectId);
  // The sessions are asked again when your code projects change (and on opening or coming back, once a minute old).
  const key = projects.map((p) => p.id).sort().join();
  const gitHere = project?.git ? project.id : undefined;
  const gitRef = useRef(gitHere);
  gitRef.current = gitHere;
  const [found, setFound] = useState(() => (recentFound?.key === key ? recentFound.theirs : null));
  const [changed, setChanged] = useState<Changed | undefined>(() => (gitHere ? changedFound.get(gitHere) : undefined));
  // 0 until the app has been still a moment after it comes up (at once when it has asked before, as after Design); each opening of the panel, or return of the window, counts one more.
  const [asked, setAsked] = useState(() => (recentFound ? 1 : 0));
  // Bumped when this project's count was marked old, so Git is asked again.
  const [stale, setStale] = useState(0);
  const keyRef = useRef(key);
  keyRef.current = key;
  useEffect(() => {
    if (asked) return;
    const go = () => setAsked((a) => a || 1);
    let idle = 0;
    const t = window.setTimeout(() => (typeof requestIdleCallback === "function" ? (idle = requestIdleCallback(go, { timeout: 3000 })) : go()), 1200);
    return () => {
      window.clearTimeout(t);
      if (idle) cancelIdleCallback(idle);
    };
  }, []);
  // Back to the window (from a terminal, from Claude Code): what's over a minute old is asked again.
  useEffect(() => {
    const again = () => {
      if (document.visibilityState !== "visible" || recentPending) return;
      const git = gitRef.current;
      if (!fresh(recentFound) || (git && !fresh(changedFound.get(git)))) setAsked((a) => a + 1);
    };
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, []);
  // A turn ending or a commit going in changes what a session has left uncommitted (Thread.toReview): that project's count is old.
  const marks = useEngine((s) => s.threads.map((t) => `${t.projectId}\t${t.id}=${t.status === "running" ? "r" : (t.toReview ?? 0)}`).join("\n"));
  const seen = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    const by = new Map<string, string>();
    for (const m of marks.split("\n")) if (m) by.set(m.split("\t")[0], `${by.get(m.split("\t")[0]) ?? ""}${m}\n`);
    const was = seen.current;
    seen.current = by;
    if (!was) return;
    for (const [p, v] of by) {
      if (was.get(p) === v) continue;
      const had = changedFound.get(p);
      if (had) changedFound.set(p, { ...had, at: 0 });
      if (p === gitRef.current) setStale((n) => n + 1);
    }
  }, [marks]);
  useEffect(() => {
    if (!asked) return;
    if (recentFound?.key === key && fresh(recentFound)) return setFound(recentFound.theirs);
    let live = true;
    // A read already out for this list is waited on, not asked twice.
    let ask = recentPending?.key === key ? recentPending.p : null;
    if (!ask) {
      const p: Promise<RecentSession[]> = rpc("sessions.recent", { limit: RECENT_MAX }).then((theirs) => {
        // A late answer for a list that has since moved on is let go, not kept.
        if (keyRef.current === key) recentFound = { at: Date.now(), key, theirs };
        return theirs;
      });
      const out = { key, p };
      recentPending = out;
      const done = () => void (recentPending === out && (recentPending = null));
      p.then(done, done);
      ask = p;
    }
    ask.then(
      (theirs) => live && setFound(theirs),
      // Nothing kept: the next look asks again.
      () => live && setFound([]),
    );
    return () => {
      live = false;
    };
  }, [asked, key]);
  useEffect(() => {
    if (!gitHere) return setChanged(undefined);
    // What it found here last stands while it asks again.
    const had = changedFound.get(gitHere);
    setChanged(had);
    if (!asked || fresh(had)) return;
    let live = true;
    // A moment's wait, so running through sessions in several projects asks Git only where you stop.
    const t = window.setTimeout(() => {
      let p = changedPending.get(gitHere);
      if (!p) {
        p = rpc("git.status", { projectId: gitHere }).then((g) => {
          const c: Changed = { at: Date.now(), n: g.changes.length, added: g.changes.reduce((n, x) => n + (x.added || 0), 0), removed: g.changes.reduce((n, x) => n + (x.removed || 0), 0), branch: g.branch };
          changedFound.set(gitHere, c);
          return c;
        });
        changedPending.set(gitHere, p);
        const done = () => void changedPending.delete(gitHere);
        p.then(done, done);
      }
      p.then(
        (c) => live && setChanged(c),
        () => live && setChanged(undefined),
      );
    }, 400);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [asked, gitHere, stale]);
  const bring = (x: RecentSession) =>
    void rpc("sessions.import", { projectId: x.projectId, tool: x.tool, id: x.id }).then(
      (t) => {
        // Brought in, it's in the list now: Carry on lets it go.
        const left = (list: RecentSession[]) => list.filter((y) => !(y.tool === x.tool && y.id === x.id));
        if (recentFound) recentFound = { ...recentFound, theirs: left(recentFound.theirs) };
        setFound((f) => f && left(f));
        onOpen(t.id);
      },
      (e: Error) => toast.error(e.message),
    );
  const carry = canCarry && project ? (changed?.n ?? 0) : 0;
  const theirs = found ? found.slice(0, RECENT_MAX - (carry ? 1 : 0)) : [];
  const nameOf = (id: string) => projects.find((p) => p.id === id)?.name ?? "a project";
  // Known once the sessions are; until then, or with nothing to carry on, it counts none.
  const count = found ? theirs.length + (carry ? 1 : 0) : 0;
  return { project, carry, changed, theirs, count, nameOf, bring, again: () => setAsked((a) => a + 1) };
}
type Carry = ReturnType<typeof useCarry>;

/** The words that ask an agent to finish the work not committed in a project. */
const carryAsk = (files: string) => `Carry on the work that isn't committed here (${files}): read what changed, then finish it.`;

/**
  The whole list, by where the work is: what isn't committed first, then each tool's sessions, newest first in each. A row
  is in the list's order (SideRow's parts, as a menu item): the source's mark in the mark column, the title and the time
  since it last moved at its end, and under it the tool and the project. What pressing it does is in its tooltip. It has
  no state to mark and no facts to give: it isn't a session here yet.
*/
function CarryList({ c, now, intro, close, onCarryOn }: { c: Carry; now: number; intro: string; close: () => void; onCarryOn?: (projectId: string, text: string) => void }) {
  const { project, carry, theirs, count, nameOf, bring } = c;
  const files = plural(carry, "file");
  const sources = [...new Set(theirs.map((x) => x.tool))].sort((a, b) => toolOrder(a) - toolOrder(b));
  const line = (key: string, mark: ReactNode, title: string, where: string, at: number | undefined, tip: string, onPick: () => void) => (
    <button key={key} type="button" role="menuitem" className="lc-carry-row l-focus" title={tip} onClick={onPick}>
      <span className="lc-carry-mk">{mark}</span>
      <b>{title}</b>
      {at !== undefined && <span className="lc-carry-ago">{ago(at, now)}</span>}
      <span className="lc-carry-s">{where}</span>
    </button>
  );
  return (
    <>
      {/* Its title is the panel's label already; the line under it is its description (aria-describedby). */}
      <div className="lc-carry-h">
        <b aria-hidden>Carry on</b>
        <span id={intro}>Work you can pick up here: changes not committed, and sessions in Claude Code and Codex.</span>
      </div>
      {/* The row the keyboard was on went with the rest: it lands here, so Escape and Tab still start from the panel. */}
      {!count && (
        <p className="lc-carry-none" tabIndex={-1} ref={(el) => void (el && (!document.activeElement || document.activeElement === document.body) && el.focus({ preventScroll: true }))}>
          Nothing to carry on right now
        </p>
      )}
      {carry > 0 && project && (
        <div className="lc-carry-g" role="group" aria-label="Not committed">
          <div className="lc-carry-gh" aria-hidden>
            <span>Not committed</span>
            <span>1</span>
          </div>
          {line("carry", <I.changes size={14} />, "Continue uncommitted work", `${project.name} · ${files}`, undefined, `${files} not committed in ${project.name}`, () => {
            close();
            onCarryOn?.(project.id, carryAsk(files));
          })}
        </div>
      )}
      {sources.map((tool) => {
        const { name, mark } = toolOf(tool);
        const xs = theirs.filter((x) => x.tool === tool);
        return (
          <div key={tool} className="lc-carry-g" role="group" aria-label={`From ${name}`}>
            <div className="lc-carry-gh" aria-hidden>
              <span>From {name}</span>
              <span>{xs.length}</span>
            </div>
            {xs.map((x) =>
              line(`${x.tool}:${x.id}`, <ModelMark kind={mark} size={14} />, x.title, `${name} · ${nameOf(x.projectId)}`, x.at, `Bring it in from ${name} · ${nameOf(x.projectId)} · ${agoLong(x.at, now)}`, () => {
                close();
                bring(x);
              }),
            )}
          </div>
        );
      })}
    </>
  );
}

/**
  Carry on beside the sidebar: one row in the More menu and the Sessions menu with the count at its end (`onCount` tells
  the sidebar the count): pressing it opens a panel beside the sidebar, by where the work is, so however much there is
  your sessions don't move. The panel hangs from a button kept out of sight at the heading's end (`opener` presses it),
  so it opens level with the heading. Pressing one there brings it in and opens it, or for the work not committed,
  writes the ask to finish it into Home's box. With nothing to carry on the heading's menu has no row; More's Carry on
  still opens the panel, which says so, and it stays until you close it.
*/
type CarryOnProps = { projectId?: string; now: number; onOpen: (id: string) => void; onCarryOn?: (projectId: string, text: string) => void; side: () => HTMLElement | null; onCount: (n: number) => void; opener: MutableRefObject<(() => void) | null> };
export function CarryOn(props: CarryOnProps) {
  // Turned off in Settings, nothing of it is mounted: no panel, and no read of the tools' folders or of Git behind it.
  const on = useEngine((s) => carryOnOn(s.settings));
  return on ? <CarryOnPanel {...props} /> : null;
}

function CarryOnPanel({ projectId, now, onOpen, onCarryOn, side, onCount, opener }: CarryOnProps) {
  const c = useCarry(projectId, Boolean(onCarryOn), onOpen);
  const intro = useId();
  // The panel is open: the row stays while it is, even with nothing left in it.
  const [showing, setShowing] = useState(false);
  const { count } = c;
  useEffect(() => onCount(count), [count]);
  // Turned off in Settings, it goes: the menus' rows count nothing and the panel has nothing to open from.
  useEffect(
    () => () => {
      onCount(0);
      opener.current = null;
    },
    [],
  );
  // The button the panel hangs from is out of sight: once the panel closes, the keyboard goes back to the menu it was opened from (More or the heading's ···), rather than to it or to nowhere.
  const holder = useRef<HTMLSpanElement>(null);
  const back = useRef<HTMLElement | null>(null);
  opener.current = () => {
    back.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    holder.current?.querySelector<HTMLButtonElement>("button")?.click();
  };
  const wasOpen = useRef(false);
  useEffect(() => {
    if (showing) return void (wasOpen.current = true);
    const at = document.activeElement;
    if (wasOpen.current && (!at || at === document.body || holder.current?.contains(at))) (back.current?.isConnected ? back.current : side()?.querySelector<HTMLElement>(".lc-sl-head-b.lc-pick"))?.focus({ preventScroll: true });
    wasOpen.current = false;
  }, [showing, count]);
  return (
    // Only an anchor for the panel: the menu's row is the way in, so assistive tech is not shown a second Carry on (focus never stays in it: the effect above moves it on).
    <span ref={holder} className="lc-sb-carry-at" aria-hidden>
      <Pop
        label={count ? `Carry on: ${count} to pick up here` : "Carry on"}
        describedBy={intro}
        menu
        side="right"
        width={276}
        within={side}
        triggerClass="lc-sb-carry"
        // Out of the Tab order: the menu's Carry on row is the way in.
        triggerAttrs={{ tabIndex: "-1" }}
        trigger="Carry on"
      >
        {(close) => (
          <CarryPanel
            onShow={() => {
              setShowing(true);
              c.again();
            }}
            onHide={() => setShowing(false)}
          >
            <CarryList c={c} now={now} intro={intro} close={close} onCarryOn={onCarryOn} />
          </CarryPanel>
        )}
      </Pop>
    </span>
  );
}

/** Carry on's panel: opening it is what asks again, when what Carry on has is over a minute old; while it's up, the row stays. */
function CarryPanel({ onShow, onHide, children }: { onShow: () => void; onHide: () => void; children: ReactNode }) {
  useEffect(() => {
    onShow();
    return onHide;
  }, []);
  return <div className="lc-carry">{children}</div>;
}

/** The time, once a minute, for the cards' ages. */
function useMinute() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

/**
  Carry on on Home (board Home, the owner's ruling of 2026-11-27): a grey "Carry on" with "All N" at its end, then the
  first three of the list as cards under the box. A card: the tool's mark and the project in grey with the state mark at
  its end, the title, two grey lines of where it stands, and a foot with the lines not committed or the branch, and its
  age. The dots sit in its top right corner in its state's colour: green for work not committed here, blue for a session
  that's new to Liner Code. "All N" opens the whole list, as the sidebar's panel has it. Nothing to carry on, no cards.
*/
export function HomeCarry({ projectId, onOpen, onCarryOn }: { projectId?: string; onOpen: (id: string) => void; onCarryOn: (projectId: string, text: string) => void }) {
  const c = useCarry(projectId, true, onOpen);
  const now = useMinute();
  const intro = useId();
  // The uncommitted work's age, from what the app already holds: the last session in the project still leaving files to review. None known, no age.
  const touched = useEngine((s) => s.threads.reduce((at, t) => (t.projectId === projectId && (t.toReview ?? 0) > 0 ? Math.max(at, t.updatedAt) : at), 0));
  const { project, carry, changed, theirs, count, nameOf, bring } = c;
  if (!count) return null;
  const files = plural(carry, "file");
  const cards: ReactNode[] = [];
  if (carry > 0 && project)
    cards.push(
      <button key="carry" type="button" className="lc-hc-card l-focus" title={`${files} not committed in ${project.name}: write the ask to finish it`} onClick={() => onCarryOn(project.id, carryAsk(files))}>
        <i className="lc-ht lc-ht-corner lc-ht-soft lc-ht-ok" aria-hidden />
        <span className="lc-hc-top">
          <I.changes size={12} />
          {/* No mark in its head: work not committed isn't finished, and the done mark (a green tick) would say it is. Cards for sessions that work, wait or are new to you keep theirs. */}
          <span className="lc-hc-proj">{project.name}</span>
        </span>
        <b>Continue uncommitted work</b>
        <p>
          {files} not committed in {project.name}. The agent reads what changed, then finishes it.
        </p>
        <span className="lc-hc-foot">
          {changed && (changed.added > 0 || changed.removed > 0) ? (
            <span className="lc-hc-lines">
              <span className="lc-hc-add">+{changed.added}</span>
              <span className="lc-hc-del">−{changed.removed}</span>
            </span>
          ) : changed?.branch ? (
            <span className="lc-hc-branch">
              <I.branch size={12} />
              <span className="lc-mono">{changed.branch}</span>
            </span>
          ) : null}
          <span className="lc-grow" />
          {touched > 0 && <span>{ago(touched, now)}</span>}
        </span>
      </button>,
    );
  for (const x of theirs) {
    if (cards.length >= HOME_CARDS) break;
    const { name, mark } = toolOf(x.tool);
    cards.push(
      <button key={`${x.tool}:${x.id}`} type="button" className="lc-hc-card l-focus" title={`Bring it in from ${name} · ${nameOf(x.projectId)} · ${agoLong(x.at, now)}`} onClick={() => bring(x)}>
        <i className="lc-ht lc-ht-corner lc-ht-soft lc-ht-blue" aria-hidden />
        <span className="lc-hc-top">
          <ModelMark kind={mark} size={12} />
          <span className="lc-hc-proj">{nameOf(x.projectId)}</span>
          <StateMark state="fresh" size={14} label="New to Liner Code" />
        </span>
        <b>{x.title}</b>
        <p>
          A session in {name}, last moved {agoLong(x.at, now)}. Bring it in to carry on here.
        </p>
        <span className="lc-hc-foot">
          <span>From {name}</span>
          <span className="lc-grow" />
          <span>{ago(x.at, now)}</span>
        </span>
      </button>,
    );
  }
  return (
    <section className="lc-hc" aria-label="Carry on">
      <div className="lc-hc-head">
        <span>Carry on</span>
        <span className="lc-grow" />
        <Pop label={`All ${count} to carry on`} describedBy={intro} menu align="end" width={276} triggerClass="lc-hc-all" trigger={<>All {count}<I.chevR size={12} /></>}>
          {(close) => (
            <CarryPanel onShow={c.again} onHide={() => {}}>
              <CarryList c={c} now={now} intro={intro} close={close} onCarryOn={onCarryOn} />
            </CarryPanel>
          )}
        </Pop>
      </div>
      <div className="lc-hc-cards">{cards}</div>
    </section>
  );
}
