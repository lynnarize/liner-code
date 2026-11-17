/*
  The Design face's open designs ("tabs"): listed at the top of the Design sidebar (OpenDesigns),
  named in the top row with a menu of them (TabTitle), and gone through with ⌃Tab (useTabKeys).
  Which are open is face.ts's, kept for the window.

  Also here, the top row's "On its own" chip for a design on its own: where its files are, and
  Build in a project (design.attach), after which the chip is gone and the tab carries on.
*/
import { useEffect, useState } from "react";
import type { Project } from "@contracts";
import { DESIGNS_FOLDER } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { bridge } from "../bridge";
import { getState, rpc, useEngine } from "../engine";
import { closeTab, getTabs, HOME_TAB, moveTab, showTab, tabKey, useTabs, type DesignTab } from "../face";
import { I } from "../icons";
import { keys } from "../os";
import { ProjectChooser } from "../Projects";
import { Pop, Row, Sep } from "../ui";
import { D } from "./Rail";
import { dropIfUntouched, newDesign, sessionOf } from "./session";
import { design } from "./store";

const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));

/**
  Closes a tab: what it parked in the store goes with it, and nothing of a design is touched; but a
  design still untouched since New design made it is removed too, quietly (session.ts).
*/
export function close(key: string) {
  const tab = getTabs().list.find((t) => tabKey(t) === key);
  closeTab(key);
  design.forget(key);
  if (tab?.fresh) void dropIfUntouched(tab);
}

const nameOf = (t: DesignTab) => t.title ?? "Design";
/** How many open designs the sidebar lists before the rest fold into one "N more" row. */
const FOLD = 5;

/**
  The open designs, at the top of the Design sidebar (where Code keeps its sessions): Home, then a
  row per open design (a dot in the lead's colour while an agent draws there, a cross to close it),
  then + for a new design. Past FOLD of them the rest fold into one row, which opens them all; the
  one you're in is always among those shown. A middle-click or the cross closes a design's row:
  nothing is deleted and nothing stops.
*/
export function OpenDesigns() {
  const { list, at } = useTabs();
  const threads = useEngine((s) => s.threads);
  const [all, setAll] = useState(false);
  const folds = list.length > FOLD + 1;
  let shown = list;
  if (folds && !all) {
    shown = list.slice(0, FOLD);
    const here = list.find((t) => tabKey(t) === at);
    if (here && !shown.includes(here)) shown = [...shown.slice(0, FOLD - 1), here];
  }
  const rest = list.filter((t) => !shown.includes(t));
  return (
    <div className="ld-open" role="tablist" aria-label="Open designs" aria-orientation="vertical">
      <div className="lc-sb-lab ld-lab ld-open-lab">
        Designs
        <span className="ld-open-end">
          {list.length > 0 && <span className="ld-lab-q">{list.length} open</span>}
          <button type="button" className="lc-ib l-focus ld-lab-b" aria-label="New design" title={`New design (${keys("mod+n")})`} onClick={() => void newDesign().catch(fail)}>
            <I.plus size={14} />
          </button>
        </span>
      </div>
      <button type="button" role="tab" className="ld-tr l-focus" aria-selected={at === HOME_TAB} data-on={at === HOME_TAB || undefined} onClick={() => showTab(HOME_TAB)}>
        <I.home size={14} />
        <span className="ld-ell">Home</span>
      </button>
      {shown.map((t) => {
        const k = tabKey(t);
        const on = k === at;
        const busy = sessionOf(t, threads)?.status === "running";
        const name = nameOf(t);
        return (
          <div
            key={k}
            role="tab"
            tabIndex={0}
            className="ld-tr ld-open-r l-focus"
            aria-selected={on}
            data-on={on || undefined}
            title={busy ? `${name}: an agent is drawing here` : name}
            onClick={() => showTab(k)}
            // Its own keys only: Enter and Space on the cross inside it close the design, not open it.
            onKeyDown={(e) => e.target === e.currentTarget && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), showTab(k))}
            // A middle-click closes it, as a browser's tab.
            onMouseDown={(e) => e.button === 1 && e.preventDefault()}
            onAuxClick={(e) => e.button === 1 && (e.preventDefault(), close(k))}
          >
            <D.frame size={14} />
            <span className="ld-ell">{name}</span>
            {busy && <span className="ld-pd" data-lead aria-label="An agent is drawing here" />}
            <button type="button" className="ld-open-x l-focus" aria-label={`Close ${name}`} title="Close: the design stays" onClick={(e) => (e.stopPropagation(), close(k))}>
              <I.close size={12} />
            </button>
          </div>
        );
      })}
      {rest.length > 0 && (
        <button type="button" className="ld-tr ld-open-more l-focus" data-rest onClick={() => setAll(true)} title={rest.map(nameOf).join(", ")}>
          <span className="ld-open-n">{rest.length} more</span>
          <span className="ld-ell">{rest.slice(0, 2).map(nameOf).join(", ")}{rest.length > 2 ? "…" : ""}</span>
          {rest.some((t) => sessionOf(t, threads)?.status === "running") && <span className="ld-pd" data-lead aria-label="An agent is drawing in one of them" />}
        </button>
      )}
      {folds && all && (
        <button type="button" className="ld-tr ld-open-more l-focus" data-rest onClick={() => setAll(false)}>
          <span className="ld-ell">Show fewer</span>
        </button>
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

/** ⌃Tab and ⇧⌃Tab: the next and the last of Home and the open designs, round. Heard while Liner Design shows, and nothing that takes typing or a dialog has the keyboard. */
export function useTabKeys() {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !e.ctrlKey || e.metaKey || e.altKey || e.isComposing || notOurs(e.target)) return;
      const { list, at } = getTabs();
      const ring = [HOME_TAB, ...list.map(tabKey)];
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
