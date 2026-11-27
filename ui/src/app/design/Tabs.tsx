/*
  The Design face's open designs ("tabs"): listed at the top of the Design sidebar (OpenDesigns),
  named in the top row with a menu of them (TabTitle), and gone through with ⌃Tab (useTabKeys).
  Which are open is face.ts's, kept for the window.

  Also here, Build in a project (design.attach) for a design on its own, which the top row's ···
  offers (DesignFace.tsx): the tab carries on in the project.
*/
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Project, Thread } from "@contracts";
import { DESIGNS_FOLDER } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { getState, rpc, useEngine } from "../engine";
import { closeTab, getTabs, HOME_TAB, moveTab, showTab, subscribeTabs, tabKey, useTabs, type DesignTab } from "../face";
import { I, type MarkKind } from "../icons";
import { ago, clock, markOf, modelLabel, plural, threadModel } from "../model";
import { keys } from "../os";
import { SideFacts, SideFolder, SideHead, SideLabel, SideMark, SideRow, useFieldNew, useWindowFocused, type SideState } from "../SideList";
import { askWords, markStateOf, seenAsk, sideStateOf, type MarkState } from "../session-state";
import { Pop, Row, Sep } from "../ui";
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
/** By status's groups, in order, with the sidebar's names, and the marks each holds: Needs you is waiting on you, a problem or its plan's limit, as Code's is. */
const STATUS: [string, SideState[]][] = [["Needs you", ["needs", "error", "limited"]], ["Working", ["working"]], ["Finished", ["done"]]];
const asks = (st: SideState) => st === "needs" || st === "error" || st === "limited";
/** A question you've opened and left, or are looking at (the open design in a focused window): still waiting, no longer news (session-state.ts, seenAsk): no mark, grey words, and a folded folder doesn't count it. */
const seenQ = (x: { s?: Thread; state: SideState }, looking: boolean) => x.state === "needs" && Boolean(x.s && seenAsk(x.s, looking));

/** How a design's session stands, as its row's mark shows it. */
const standOf = (t: DesignTab, threads: Thread[]) => {
  const s = sessionOf(t, threads);
  // As Code's rows mark it (session-state.ts), but a design's row has no "not started" mark.
  return { s, state: sideStateOfDesign(s) };
};
/** A design's state mark as Code's rows draw it (markStateOf): fresh until you open what finished while you were elsewhere; never "not started", which a design's row doesn't say. */
export const markOfTab = (s: Thread | undefined, looking: boolean): MarkState => {
  const m = s ? markStateOf(s, { looking }) : "done";
  return m === "new" ? "done" : m;
};
/**
  A design row's second line, the same here and in Design Home's list of every design, worded as Code's rows word it
  (rowWords): what it draws now, a question in its own words, a problem, its plan's limit (and when it's back), else its
  frames when they're known. With its colour: amber for a question you haven't opened or a limit, red for a problem.
*/
export function designWords(s: Thread | undefined, state: SideState, seen: boolean, n: number | undefined): { text?: string; tone?: "warn" | "danger" } {
  const text = state === "working" ? s?.doing?.text || "Working" : state === "needs" && s ? askWords(s) : state === "error" ? "Ran into a problem" : state === "limited" ? `Hit its plan's limit${s?.limit?.until ? `, back at ${clock(s.limit.until)}` : ""}` : n === undefined ? undefined : n ? plural(n, "frame") : "No frames yet";
  // A question is amber until you have seen it, then plain grey (session-state.ts seenAsk).
  return { text, tone: (state === "needs" && !seen) || state === "limited" ? "warn" : state === "error" ? "danger" : undefined };
}
/** How a design's session stands, for a row that has the session (or none). */
export const sideStateOfDesign = (s: Thread | undefined): SideState => {
  const mark = s ? sideStateOf(s) : "done";
  return mark === "new" ? "done" : mark;
};

/**
  The open designs as the list lays them out, from the tabs, the view, the sessions and the projects
  alone: the folders, and `order`, the designs in the order the list puts them. Every open design is
  listed, and the list scrolls (no "N more" fold, as Code's list has none). The list draws from it,
  and ⌃Tab walks `order`.
*/
function laidOut(list: DesignTab[], at: string, view: View, threads: Thread[], projects: Project[]) {
  const here = list.find((t) => tabKey(t) === at);
  const folderOf = (t: DesignTab) => (projects.find((p) => p.id === t.projectId)?.kind === "design" ? OWN : t.projectId);
  // By folder: one folder per project, in the order their first design was opened; designs on their own share "On its own".
  const folders: { id: string; name: string; tabs: DesignTab[] }[] = [];
  for (const t of list) {
    const id = folderOf(t);
    let f = folders.find((x) => x.id === id);
    if (!f) folders.push((f = { id, name: id === OWN ? "On its own" : (projects.find((p) => p.id === id)?.name ?? "A project"), tabs: [] }));
    f.tabs.push(t);
  }
  const rank = (t: DesignTab) => (view === "folder" ? folders.findIndex((f) => f.id === folderOf(t)) : STATUS.findIndex(([, sts]) => sts.includes(standOf(t, threads).state)));
  const order = list.map((t, i) => [rank(t), i, t] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, , t]) => tabKey(t));
  return { here, folderOf, folders, order };
}

/**
  Liner Design's side of the sidebar, as Code's: your places on top (Home; New design and Search are the sidebar's field above),
  "Designs" with its one menu (By folder, By status), and the open designs as Code's two-line rows
  (SideRow, Rows.dc.html). A row says how its session stands in the state mark (working in its
  model's colour, needs when it waits on you and you haven't opened it since, grey after, fresh when
  it finished while you were elsewhere), its title with the time since its session last did
  something, what it is drawing now, what it asks you in its own words or how many frames it has,
  and its model's mark at the line's end; pointing at it brings its cross (a design has no pull
  request or worktree to show). The rows are tabs: ⌃Tab goes through them (useTabKeys), a
  middle-click or the cross closes one, and nothing is deleted and nothing stops. Every open design
  is listed and the list scrolls; the one you're in has its folder opened to show it.
*/
export function OpenDesigns() {
  const { list, at } = useTabs();
  const threads = useEngine((s) => s.threads);
  const projects = useEngine((s) => s.projects);
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  // Only which file is open and how many frames it has: a frame dragged on the canvas draws nothing here.
  const fileId = useDesign((s) => s.file?.id);
  const fileFrames = useDesign((s) => s.file?.frames.length);
  useFramesRev();
  const [view, setView] = useKept<View>(VIEW_KEY, "folder", isView);
  const [shut, setShut] = useKept<string[]>("ld:sb-shut", [], isIds);
  const { here, folderOf, folders } = laidOut(list, at, view, threads, projects);
  // Liner Design's new thing sits in the sidebar's field, where Code's New session is (SideList.tsx useFieldNew), under the same ⌘N.
  useFieldNew({ label: "New design", onClick: () => void newDesign().catch(fail) });
  // The times move on their own.
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  /** A session's model, for its working light's colour and its mark among the row's facts. */
  const modelOf = (s?: Thread): { ref?: string; brand?: MarkKind } => {
    const ref = s ? threadModel(s, agents, providers) : undefined;
    return { ref, brand: ref ? markOf(ref) : undefined };
  };
  // The open design's own file says how many frames it has now.
  useEffect(() => void (here && fileFrames !== undefined && fileId === here.file && knowFrames(tabKey(here), fileFrames)), [here, fileId, fileFrames]);
  // A design opened (or come to with ⌃Tab) in a folded folder: the folder opens to show it.
  const hereFolder = here ? folderOf(here) : undefined;
  useEffect(() => void (view === "folder" && hereFolder && shut.includes(hereFolder) && setShut(shut.filter((x) => x !== hereFolder))), [at, hereFolder]);
  const stand = (t: DesignTab) => standOf(t, threads);
  // The open design in a focused window is being looked at: no amber for it, in its row or its folder.
  const focused = useWindowFocused();
  const looking = (t: DesignTab) => focused && tabKey(t) === at;

  const row = (t: DesignTab) => {
    const k = tabKey(t);
    const on = k === at;
    const name = nameOf(t);
    const { s, state } = stand(t);
    const seen = seenQ({ s, state }, looking(t));
    const mark = markOfTab(s, looking(t));
    const { ref, brand } = modelOf(s);
    const words = designWords(s, state, seen, frames.get(k));
    return (
      <SideRow
        key={k}
        data-row={s?.id ?? k}
        data-design-tab={k}
        compact
        loud={state === "needs" && !seen}
        current={on}
        quiet={state === "done"}
        mark={<SideMark state={mark} brand={brand} label={seen ? "Waits for your answer" : undefined} />}
        title={name}
        ago={s ? ago(s.updatedAt, now) : undefined}
        sub={words.text}
        tone={words.tone}
        facts={brand && <SideFacts model={brand} modelName={ref && modelLabel(ref, providers)} />}
        // A middle-click closes it, as a browser's tab.
        onMouseDown={(e) => e.button === 1 && e.preventDefault()}
        onAuxClick={(e) => e.button === 1 && (e.preventDefault(), close(k))}
        pick={{
          role: "tab",
          tabIndex: 0,
          "aria-selected": on,
          className: "l-focus",
          title: name,
          onClick: () => showTab(k),
          onKeyDown: (e) => e.target === e.currentTarget && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), showTab(k)),
        }}
        acts={
          <button type="button" className="lc-sb-a l-focus" aria-label={`Close ${name}`} title="Close: the design stays" onClick={() => close(k)}>
            <I.close size={14} />
          </button>
        }
      />
    );
  };

  // By status: those waiting on you, those at work, the rest; each in the order they were opened.
  const by = (sts: SideState[]) => list.filter((t) => sts.includes(stand(t).state));
  /** A run of rows is a tablist of its own (named for its folder or group): every child of it is a tab row. */
  const tabs = (name: string, ts: DesignTab[]) => (
    <div className="ld-open-tabs" role="tablist" aria-label={`Open designs ${name}`} aria-orientation="vertical">
      {ts.map(row)}
    </div>
  );

  return (
    <div className="ld-open">
      {/* New design is the compose button at the end of the sidebar's field (useFieldNew, above), under the same ⌘N. */}
      <div className="lc-sb-top">
        <button type="button" className="lc-sb-nav l-focus" aria-current={at === HOME_TAB ? "page" : undefined} title="Design Home: start a design, or find one" onClick={() => showTab(HOME_TAB)}>
          <I.home size={14} />
          <span>Home</span>
        </button>
      </div>
      <SideHead title="Designs" note={view === "status" ? "By status" : undefined} menuLabel="What the list shows">
        {(done) => (
          <>
            <Row title="By folder" icon={<I.folder size={16} />} keepIcon on={view === "folder"} onPick={() => (done(), setView("folder"))} />
            <Row title="By status" icon={<I.list size={16} />} keepIcon on={view === "status"} onPick={() => (done(), setView("status"))} />
            <Sep />
            <Row title="New design" icon={<I.plus size={16} />} end={keys("mod+n")} onPick={() => (done(), void newDesign().catch(fail))} />
          </>
        )}
      </SideHead>
      {list.length === 0 && <p className="ld-open-none">The designs you open show here.</p>}
      {list.length > 0 && (
        <div className="lc-sl-list ld-open-list">
          {view === "folder" &&
            folders.map((f) => {
              const working = f.tabs.find((t) => stand(t).state === "working");
              return (
                <SideFolder
                  key={f.id}
                  compact
                  name={f.name}
                  count={f.tabs.length}
                  open={!shut.includes(f.id)}
                  onToggle={() => setShut(shut.includes(f.id) ? shut.filter((x) => x !== f.id) : [...shut, f.id])}
                  needs={f.tabs.some((t) => asks(stand(t).state) && !seenQ(stand(t), looking(t)))}
                  working={Boolean(working)}
                  brand={working && modelOf(stand(working).s).brand}
                  icon={f.id === OWN ? <I.edit size={12} /> : undefined}
                  what="designs"
                >
                  {tabs(f.id === OWN ? "on their own" : `in ${f.name}`, f.tabs)}
                </SideFolder>
              );
            })}
          {view === "status" &&
            STATUS.map(([name, sts]) => {
              const ts = by(sts);
              if (!ts.length) return null;
              return (
                <section key={name} className="ld-open-sec" aria-label={name}>
                  <SideLabel name={name} count={ts.length} />
                  {tabs(`that are ${name === "Needs you" ? "waiting on you" : name.toLowerCase()}`, ts)}
                </section>
              );
            })}
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
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  const here = list.find((t) => tabKey(t) === at);
  const name = here ? nameOf(here) : "Home";
  return (
    <Pop label={`${name}: the open designs`} width={300} triggerClass="ld-tt" trigger={<><span className="ld-ell">{name}</span><I.chevD size={12} /></>} menu>
      {(done) => (
        <>
          <Row title="Home" icon={<I.home size={16} />} on={!here} keepIcon onPick={() => (done(), showTab(HOME_TAB))} />
          {list.map((t) => {
            const k = tabKey(t);
            // Each design's mark in the icon place, as its row in the sidebar has it.
            const s = sessionOf(t, threads);
            const ref = s ? threadModel(s, agents, providers) : undefined;
            return <Row key={k} title={nameOf(t)} icon={<SideMark state={markOfTab(s, false)} brand={ref ? markOf(ref) : undefined} />} on={k === at} keepIcon onPick={() => (done(), showTab(k))} />;
          })}
          <Sep />
          <Row title="New design" icon={<I.plus size={16} />} end={keys("mod+n")} onPick={() => (done(), void newDesign().catch(fail))} />
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
      const ring = [HOME_TAB, ...laidOut(list, at, readKept(VIEW_KEY, "folder", isView), threads, projects).order];
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
