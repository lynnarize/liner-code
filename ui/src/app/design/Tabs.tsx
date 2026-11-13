/*
  The Design face's tabs, in the canvas's top row: Home, then one per open design (its name, a dot
  in the lead's colour while an agent draws there, a cross on the current one), then + for a new
  design. A middle-click or the cross closes a tab: nothing is deleted and nothing stops. Many tabs
  shrink, then scroll; they never wrap. Which tabs are open is face.ts's, kept for the window.

  Also here, the top row's "On its own" chip for a design on its own: where its files are, and
  Build in a project (design.attach), after which the chip is gone and the tab carries on.
*/
import { useEffect, useRef, useState } from "react";
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

export function Tabs() {
  const { list, at } = useTabs();
  const threads = useEngine((s) => s.threads);
  const strip = useRef<HTMLDivElement>(null);
  // The current tab stays in sight as tabs come and go.
  useEffect(() => {
    strip.current?.querySelector<HTMLElement>("[aria-selected='true']")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [at, list.length]);
  return (
    <div className="ld-tabs-w">
    <div ref={strip} className="ld-tabs" role="tablist" aria-label="Open designs">
      <button type="button" role="tab" className="ld-tab l-focus" data-home aria-selected={at === HOME_TAB} onClick={() => showTab(HOME_TAB)}>
        <I.home size={14} />
        <span className="ld-ell">Home</span>
      </button>
      {list.map((t) => {
        const k = tabKey(t);
        const on = k === at;
        const busy = sessionOf(t, threads)?.status === "running";
        const name = t.title ?? "Design";
        return (
          <div
            key={k}
            role="tab"
            tabIndex={0}
            className="ld-tab l-focus"
            aria-selected={on}
            title={busy ? `${name}: an agent is drawing here` : name}
            onClick={() => showTab(k)}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " " ? (e.preventDefault(), showTab(k)) : undefined)}
            // A middle-click closes it, as a browser's tab.
            onMouseDown={(e) => e.button === 1 && e.preventDefault()}
            onAuxClick={(e) => e.button === 1 && (e.preventDefault(), close(k))}
          >
            <D.frame size={14} />
            <span className="ld-ell">{name}</span>
            {busy && <span className="ld-pd" data-lead aria-label="An agent is drawing here" />}
            {on && (
              <button type="button" className="ld-tab-x l-focus" aria-label={`Close the ${name} tab`} title="Close the tab: the design stays" onClick={(e) => (e.stopPropagation(), close(k))}>
                <I.close size={11} />
              </button>
            )}
          </div>
        );
      })}
    </div>
      {/* Outside the strip that scrolls, so it's always there. */}
      <button type="button" className="ld-tab-new l-focus" aria-label="New design" title={`New design (${keys("mod+n")})`} onClick={() => void newDesign().catch(fail)}>
        <I.plus size={15} />
      </button>
    </div>
  );
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
              <I.chevL size={13} />
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
              <I.folder size={15} />
              <span>
                <b>{ownPlace(project)}</b>
                <small>Plain HTML files. Show in Finder</small>
              </span>
            </button>
            <Sep />
            <button type="button" className="ld-wl l-focus" onClick={() => setChoosing(true)}>
              <I.link size={15} />
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
