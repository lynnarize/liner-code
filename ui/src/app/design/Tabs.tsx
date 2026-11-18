/*
  The Design face's open designs ("tabs"): listed at the top of the Design sidebar (OpenDesigns),
  named in the top row with a menu of them (TabTitle), and gone through with ⌃Tab (useTabKeys).
  Which are open is face.ts's, kept for the window.

  Also here, the top row's "On its own" chip for a design on its own: where its files are, and
  Build in a project (design.attach), after which the chip is gone and the tab carries on.
*/
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Project, Thread } from "@contracts";
import { DESIGNS_FOLDER } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { bridge } from "../bridge";
import { getState, rpc, useEngine } from "../engine";
import { closeTab, getTabs, HOME_TAB, moveTab, showTab, subscribeTabs, tabKey, useTabs, type DesignTab } from "../face";
import { I, N } from "../icons";
import { clock, plural } from "../model";
import { keys } from "../os";
import { ProjectChooser } from "../Projects";
import { SideFolder, SideHead, SideLabel, SideMark, SideRow, type SideState } from "../SideList";
import { Pop, Row, Sep } from "../ui";
import { D } from "./Rail";
import { dropIfUntouched, newDesign, sessionOf } from "./session";
import { design, getDesign, useDesign } from "./store";

const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));

/**
  Closes a tab: what it parked in the store goes with it, and nothing of a design is touched; but a
  design still untouched since New design made it is removed too, quietly (session.ts).
*/
export function close(key: string) {
  const tab = getTabs().list.find((t) => tabKey(t) === key);
  closeTab(key);
  design.forget(key);
  frames.delete(key);
  if (tab?.fresh) void dropIfUntouched(tab);
}

// The last design tab closed (here, by the shell for a project that went, or in another window): the store lets its file go,
// so no watch, build check or hidden check runs on for a design nothing shows.
subscribeTabs(() => void (!getTabs().list.length && getDesign().file && design.close()));

const nameOf = (t: DesignTab) => t.title ?? "Design";
/** How many open designs the sidebar lists before the rest fold into one "N more" row. */
const FOLD = 5;

/**
  How many frames each design has, as the sidebar last heard it without opening a file for it:
  Design Home's list (design.all, which DesignFiles asks for anyway) and the open design's own file.
  An open design's row says it when nothing runs there; unheard, the row says nothing.
*/
const frames = new Map<string, number>();
const frameFns = new Set<() => void>();
let framesRev = 0;
export function knowFrames(key: string, n: number) {
  if (frames.get(key) === n) return;
  frames.set(key, n);
  framesRev++;
  frameFns.forEach((f) => f());
}
const useFramesRev = () => useSyncExternalStore((f) => (frameFns.add(f), () => void frameFns.delete(f)), () => framesRev);

/** Choices set in this window, so a read outside React (⌃Tab) sees what the list shows even where localStorage can't keep it. */
const keptNow = new Map<string, unknown>();
/** A choice kept in localStorage (how the list shows, what you folded), read where it's needed; a private window keeps it until it closes. */
function readKept<T>(key: string, fallback: T, ok: (v: unknown) => v is T): T {
  if (keptNow.has(key)) return keptNow.get(key) as T;
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    return ok(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function useKept<T>(key: string, fallback: T, ok: (v: unknown) => v is T) {
  const [value, setValue] = useState<T>(() => readKept(key, fallback, ok));
  const set = (v: T) => {
    setValue(v);
    keptNow.set(key, v);
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      // private window: the choice lasts until the window closes
    }
  };
  return [value, set] as const;
}
type View = "folder" | "status";
const isView = (v: unknown): v is View => v === "folder" || v === "status";
const isIds = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
/** Designs on their own share one folder in the list, whichever project each is. */
const OWN = "own";
const VIEW_KEY = "ld:sb-list";
/** By status's groups, in order, and the marks each holds: Needs you is waiting on you, a problem or its plan's limit, as Code's is. */
const STATUS: [string, SideState[]][] = [["Needs you", ["needs", "error", "limited"]], ["Drawing", ["working"]], ["At rest", ["done"]]];
const asks = (st: SideState) => st === "needs" || st === "error" || st === "limited";

/** Whether "N more" is opened: one choice for the window, so ⌃Tab walks what the list shows. */
let showAll = false;
const allFns = new Set<() => void>();
const setShowAll = (v: boolean) => ((showAll = v), allFns.forEach((f) => f()));
const useShowAll = () => useSyncExternalStore((f) => (allFns.add(f), () => void allFns.delete(f)), () => showAll);

/** How a design's session stands, as its row's mark shows it. */
const standOf = (t: DesignTab, threads: Thread[]) => {
  const s = sessionOf(t, threads);
  const state: SideState = s?.status === "running" ? "working" : s?.status === "waiting" ? "needs" : s?.status === "error" ? "error" : s?.status === "limited" ? "limited" : "done";
  return { s, state };
};

/**
  The open designs as the list lays them out, from the tabs, the view, the sessions, the projects and
  the fold alone: what shows and what folds under "N more" (past FOLD, the one you're in always
  shown), the folders, and `order`, the designs in the order the list puts them (those under "N more"
  after the shown ones, in their own listed order). The list draws from it, and ⌃Tab walks `order`.
*/
function laidOut(list: DesignTab[], at: string, all: boolean, view: View, threads: Thread[], projects: Project[]) {
  const here = list.find((t) => tabKey(t) === at);
  const folderOf = (t: DesignTab) => (projects.find((p) => p.id === t.projectId)?.kind === "design" ? OWN : t.projectId);
  const folds = list.length > FOLD + 1;
  let shown = list;
  if (folds && !all) {
    shown = list.slice(0, FOLD);
    if (here && !shown.includes(here)) shown = [...shown.slice(0, FOLD - 1), here];
  }
  const rest = list.filter((t) => !shown.includes(t));
  // By folder: one folder per project, in the order their first design was opened; designs on their own share "On its own". `tabs` are those shown, `open` all of them.
  const folders: { id: string; name: string; tabs: DesignTab[]; open: DesignTab[] }[] = [];
  for (const t of list) {
    const id = folderOf(t);
    let f = folders.find((x) => x.id === id);
    if (!f) folders.push((f = { id, name: id === OWN ? "On its own" : (projects.find((p) => p.id === id)?.name ?? "A project"), tabs: [], open: [] }));
    f.open.push(t);
    if (shown.includes(t)) f.tabs.push(t);
  }
  const rank = (t: DesignTab) => (view === "folder" ? folders.findIndex((f) => f.id === folderOf(t)) : STATUS.findIndex(([, sts]) => sts.includes(standOf(t, threads).state)));
  const listed = (ts: DesignTab[]) => ts.map((t, i) => [rank(t), i, t] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, , t]) => tabKey(t));
  return { here, folderOf, folds, shown, rest, folders, order: [...listed(shown), ...listed(rest)] };
}

/**
  Liner Design's side of the sidebar, as Code's: your places on top (New design, Search, Home),
  "Designs" with its one menu (By folder, By status), and the open designs as two-line rows. A row
  says how its session stands (the spinner in the lead's colour while it draws, the amber dot when it
  waits on you), what it is drawing now or what is known of it, and pointing at it brings its cross.
  The rows are tabs: ⌃Tab goes through them (useTabKeys), a middle-click or the cross closes one, and
  nothing is deleted and nothing stops. Past FOLD of them the rest fold into one "N more" row at the
  list's end, which opens them all; the one you're in is always among those shown, and its folder
  opens to show it.
*/
export function OpenDesigns({ onSearch }: { onSearch: () => void }) {
  const { list, at } = useTabs();
  const threads = useEngine((s) => s.threads);
  const projects = useEngine((s) => s.projects);
  // Only which file is open and how many frames it has: a frame dragged on the canvas draws nothing here.
  const fileId = useDesign((s) => s.file?.id);
  const fileFrames = useDesign((s) => s.file?.frames.length);
  useFramesRev();
  const all = useShowAll();
  const [view, setView] = useKept<View>(VIEW_KEY, "folder", isView);
  const [shut, setShut] = useKept<string[]>("ld:sb-shut", [], isIds);
  const { here, folderOf, folds, shown, rest, folders } = laidOut(list, at, all, view, threads, projects);
  // The open design's own file says how many frames it has now.
  useEffect(() => void (here && fileFrames !== undefined && fileId === here.file && knowFrames(tabKey(here), fileFrames)), [here, fileId, fileFrames]);
  // A design opened (or come to with ⌃Tab) in a folded folder: the folder opens to show it.
  const hereFolder = here ? folderOf(here) : undefined;
  useEffect(() => void (view === "folder" && hereFolder && shut.includes(hereFolder) && setShut(shut.filter((x) => x !== hereFolder))), [at, hereFolder]);
  const stand = (t: DesignTab) => standOf(t, threads);

  const row = (t: DesignTab) => {
    const k = tabKey(t);
    const on = k === at;
    const name = nameOf(t);
    const { s, state } = stand(t);
    const n = frames.get(k);
    // How it ended, worded as Code's rows word it: a problem, its plan's limit (and when it's back).
    const sub = state === "working" ? s?.doing?.text || "Drawing" : state === "needs" ? "Waits for your answer" : state === "error" ? "Ran into a problem" : state === "limited" ? `Hit its plan's limit${s?.limit?.until ? `, back at ${clock(s.limit.until)}` : ""}` : n === undefined ? undefined : n ? plural(n, "frame") : "No frames yet";
    return (
      <SideRow
        key={k}
        current={on}
        quiet={state === "done"}
        mark={<SideMark state={state} tint={state === "working" ? "var(--ld-lead)" : undefined} label={state === "working" ? "An agent is drawing here" : state === "done" ? "At rest" : undefined} />}
        title={name}
        sub={sub}
        tone={state === "needs" || state === "limited" ? "warn" : state === "error" ? "danger" : undefined}
        // A middle-click closes it, as a browser's tab.
        onMouseDown={(e) => e.button === 1 && e.preventDefault()}
        onAuxClick={(e) => e.button === 1 && (e.preventDefault(), close(k))}
        pick={{
          role: "tab",
          tabIndex: 0,
          "aria-selected": on,
          className: "l-focus",
          title: state === "working" ? `${name}: an agent is drawing here` : name,
          onClick: () => showTab(k),
          onKeyDown: (e) => e.target === e.currentTarget && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), showTab(k)),
        }}
        acts={
          <button type="button" className="lc-sb-a l-focus" aria-label={`Close ${name}`} title="Close: the design stays" onClick={() => close(k)}>
            <I.close size={12} />
          </button>
        }
      />
    );
  };

  // By status: those waiting on you, those being drawn, the rest; each in the order they were opened. A label counts all of its, "N more" too, as a folder does.
  const by = (sts: SideState[]) => ({ ts: shown.filter((t) => sts.includes(stand(t).state)), n: list.filter((t) => sts.includes(stand(t).state)).length });
  /** A run of rows is a tablist of its own (named for its folder or group): every child of it is a tab row. */
  const tabs = (name: string, ts: DesignTab[]) => (
    <div className="ld-open-tabs" role="tablist" aria-label={`Open designs ${name}`} aria-orientation="vertical">
      {ts.map(row)}
    </div>
  );

  return (
    <div className="ld-open">
      <div className="lc-sb-top">
        <button type="button" className="lc-sb-nav l-focus" title={`New design (${keys("mod+n")})`} onClick={() => void newDesign().catch(fail)}>
          <N.plus />
          <span>New design</span>
        </button>
        <button type="button" className="lc-sb-nav l-focus" title="Search sessions, projects and commands" onClick={onSearch}>
          <N.search />
          <span>Search</span>
        </button>
        <button type="button" className="lc-sb-nav l-focus" aria-current={at === HOME_TAB ? "page" : undefined} title="Design Home: start a design, or find one" onClick={() => showTab(HOME_TAB)}>
          <I.home size={20} />
          <span>Home</span>
        </button>
      </div>
      <SideHead title="Designs" note={view === "status" ? "By status" : undefined} menuLabel="What the list shows">
        {(done) => (
          <>
            <Row title="By folder" icon={<I.folder size={14} />} keepIcon on={view === "folder"} onPick={() => (done(), setView("folder"))} />
            <Row title="By status" icon={<I.list size={14} />} keepIcon on={view === "status"} onPick={() => (done(), setView("status"))} />
            <Sep />
            <Row title="New design" icon={<I.plus size={14} />} end={keys("mod+n")} onPick={() => (done(), void newDesign().catch(fail))} />
          </>
        )}
      </SideHead>
      {list.length === 0 && <p className="ld-open-none">The designs you open show here.</p>}
      {list.length > 0 && (
        <div className="lc-sl-list ld-open-list">
          {view === "folder" &&
            folders.filter((f) => f.tabs.length).map((f) => (
              <SideFolder
                key={f.id}
                name={f.name}
                count={f.open.length}
                open={!shut.includes(f.id)}
                onToggle={() => setShut(shut.includes(f.id) ? shut.filter((x) => x !== f.id) : [...shut, f.id])}
                needs={f.open.some((t) => asks(stand(t).state))}
                working={f.open.some((t) => stand(t).state === "working")}
                tint="var(--ld-lead)"
                icon={f.id === OWN ? <I.edit size={16} /> : undefined}
                what="designs"
              >
                {tabs(f.id === OWN ? "on their own" : `in ${f.name}`, f.tabs)}
              </SideFolder>
            ))}
          {view === "status" &&
            STATUS.map(([name, sts]) => {
              const { ts, n } = by(sts);
              if (!ts.length) return null;
              return (
                <section key={name} className="ld-open-sec" aria-label={name}>
                  <SideLabel name={name} count={n} />
                  {tabs(`that are ${name === "Needs you" ? "waiting on you" : name.toLowerCase()}`, ts)}
                </section>
              );
            })}
          {rest.length > 0 && (
            <button type="button" className="ld-open-more l-focus" onClick={() => setShowAll(true)} title={rest.map(nameOf).join(", ")}>
              <span className="ld-open-more-m" aria-hidden>
                {rest.some((t) => asks(stand(t).state)) ? <SideMark state="needs" /> : rest.some((t) => stand(t).state === "working") ? <SideMark state="working" tint="var(--ld-lead)" label="An agent is drawing in one of them" /> : <I.more size={14} />}
              </span>
              <span className="ld-ell">
                <span className="ld-open-n">{rest.length} more</span> {rest.slice(0, 2).map(nameOf).join(", ")}
                {rest.length > 2 ? "…" : ""}
              </span>
            </button>
          )}
          {folds && all && (
            <button type="button" className="ld-open-more l-focus" onClick={() => setShowAll(false)}>
              <span className="ld-open-more-m" aria-hidden>
                <I.chevU size={12} />
              </span>
              <span className="ld-ell">Show fewer</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
  The top row's name of what shows (Home, or the design), and a menu of the open designs under it:
  the way between them while the sidebar is hidden. ⌃Tab and ⇧⌃Tab go through them too (useTabKeys).
*/
export function TabTitle() {
  const { list, at } = useTabs();
  const threads = useEngine((s) => s.threads);
  const here = list.find((t) => tabKey(t) === at);
  const name = here ? nameOf(here) : "Home";
  return (
    <Pop label={`${name}: the open designs`} width={300} triggerClass="ld-tt" trigger={<><span className="ld-ell">{name}</span><I.chevD size={12} /></>} menu>
      {(done) => (
        <>
          <Row title="Home" icon={<I.home size={14} />} on={!here} keepIcon onPick={() => (done(), showTab(HOME_TAB))} />
          {list.map((t) => {
            const k = tabKey(t);
            const busy = sessionOf(t, threads)?.status === "running";
            return <Row key={k} title={nameOf(t)} icon={<D.frame size={14} />} on={k === at} keepIcon end={busy ? <span className="ld-pd" data-lead aria-label="An agent is drawing here" /> : undefined} onPick={() => (done(), showTab(k))} />;
          })}
          <Sep />
          <Row title="New design" icon={<I.plus size={14} />} end={<span className="ld-k">{keys("mod+n")}</span>} onPick={() => (done(), void newDesign().catch(fail))} />
          {list.length > 1 && <p className="ld-note ld-tt-note">{keys("ctrl+tab")} goes to the next design</p>}
        </>
      )}
    </Pop>
  );
}

/** Where ⌃Tab is someone else's: a field that takes typing (the terminal's too), or a dialog over the face. */
const notOurs = (t: EventTarget | null) =>
  (t instanceof Element && Boolean(t.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), .xterm"))) || Boolean(document.querySelector("dialog[open], [aria-modal='true']"));

/** ⌃Tab and ⇧⌃Tab: the next and the last of Home and the open designs (in the sidebar's order), round. Heard while Liner Design shows, and nothing that takes typing or a dialog has the keyboard. */
export function useTabKeys() {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !e.ctrlKey || e.metaKey || e.altKey || e.isComposing || notOurs(e.target)) return;
      const { list, at } = getTabs();
      // As the list lays them out now, in its view, whether or not the sidebar shows.
      const { threads, projects } = getState();
      const ring = [HOME_TAB, ...laidOut(list, at, showAll, readKept(VIEW_KEY, "folder", isView), threads, projects).order];
      const i = Math.max(0, ring.indexOf(at));
      e.preventDefault();
      e.stopPropagation();
      showTab(ring[(i + (e.shiftKey ? -1 : 1) + ring.length) % ring.length]);
    };
    addEventListener("keydown", on, true);
    return () => removeEventListener("keydown", on, true);
  }, []);
}

/** "Liner Designs / sign-in-screen": where a design on its own is, said short. */
export const ownPlace = (p: Project) => `${DESIGNS_FOLDER} / ${p.path.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop()}`;

/** Moves a design on its own into a project (an existing one, or a folder that becomes one); its tab, canvas and conversation carry on. */
export async function buildIn(tab: DesignTab, to: { projectId: string } | { path: string }) {
  const from = tabKey(tab);
  const r = await rpc("design.attach", { projectId: tab.projectId, to });
  const thread = sessionOf(tab, getState().threads);
  const next: DesignTab = { projectId: r.project.id, file: r.file.id, title: r.file.title, ...(thread && r.moved.includes(thread.id) ? { threadId: thread.id } : {}) };
  design.moved(from, tabKey(next), r.project.path, r.file.id);
  moveTab(from, next);
  toast(`Moved ${r.file.title} into ${r.project.name}`, { description: r.left ?? "The canvas and the conversation carry on there.", duration: 5000 });
  return r;
}

/** The top row's chip for a design on its own: where it is, and Build in a project (choosing a project or a folder in the same panel). */
export function OwnChip({ tab, project }: { tab: DesignTab; project: Project }) {
  const [busy, setBusy] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const go = async (to: { projectId: string } | { path: string }, close: () => void) => {
    setBusy(true);
    try {
      await buildIn(tab, to);
      close();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Pop label="This design is on its own" align="end" width={420} triggerClass="lc-pb ld-own" trigger={<><I.folder size={14} /><span>On its own</span><I.chevD size={12} /></>}>
      {(close) =>
        choosing ? (
          <div className="ld-own-pop">
            <button type="button" className="ld-own-back l-focus" onClick={() => setChoosing(false)}>
              <I.chevL size={14} />
              Build in a project
            </button>
            {busy ? (
              <p className="ld-note ld-own-note l-shimmer">Moving the design in</p>
            ) : (
              <ProjectChooser
                onPick={(p) => void go({ projectId: p.id }, () => (setChoosing(false), close()))}
                extra={<Row title="Another folder" note="One that isn't a project yet" icon={<I.plus size={14} />} onPick={() => void bridge.pickFolder().then((path) => (path ? go({ path }, () => (setChoosing(false), close())) : undefined))} />}
              />
            )}
          </div>
        ) : (
          <div className="ld-own-pop">
            <div className="ld-way-mh">This design is on its own</div>
            <button type="button" className="ld-wl l-focus" onClick={() => (close(), bridge.reveal(project.path))}>
              <I.folder size={16} />
              <span>
                <b>{ownPlace(project)}</b>
                <small>Plain HTML files. Show in Finder</small>
              </span>
            </button>
            <Sep />
            <button type="button" className="ld-wl l-focus" onClick={() => setChoosing(true)}>
              <I.link size={16} />
              <span>
                <b>Build in a project</b>
                <small>Pick a folder. The design moves in with it</small>
              </span>
            </button>
            <p className="ld-note ld-own-note">The conversation is the same in both tabs. Press Code and you are in this design's session, with nothing in Scratch.</p>
          </div>
        )
      }
    </Pop>
  );
}
