/*
  The session tray, upright at the right edge of the thread in a lane of its own: one quiet glass
  column. The panel; the surfaces it holds, each a press away, the open one's icon on a tile; and
  shipping: commit and push (the files waiting to be committed in a small badge on the arrow) and
  every other surface. While the panel is open beside the thread the tray lies down at the foot
  of the panel, a size smaller, in a lane the panel keeps for it (under the side chat's composer
  too): each of its buttons travels there from the edge, and back when the panel shuts. The bar
  keeps the session's own things (who works on it, its place, Changes).
*/
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { prefersReducedMotion } from "@liner/lib/spring";
import type { Thread } from "@contracts";
import { Tooltip } from "@liner/components/tooltip/tooltip";
import { toast } from "@liner/components/toast/toast";
import { CommitForm, type Then } from "./Commit";
import { ship } from "./Ship";
import { rpc } from "./engine";
import { I } from "./icons";
import { shortcutOf } from "./keymap";
import * as os from "./os";
import { plural } from "./model";
import { openTab, type PanelState, type SurfaceId } from "./Surfaces";
import { PanelHead, Pop, Row } from "./ui";

const SHOWN: { id: SurfaceId; label: string; icon: (p: { size?: number }) => ReactNode }[] = [
  { id: "side", label: "Side chat", icon: I.comment },
  { id: "terminal", label: "Terminal", icon: I.terminal },
  { id: "browser", label: "Browser", icon: I.globe },
  { id: "files", label: "Files", icon: I.file },
  { id: "device", label: "Device", icon: I.device },
  { id: "pr", label: "Pull request", icon: I.pr },
];

const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));
const savedThen = (): Then => {
  try {
    return (localStorage.getItem("lc:commit-then") as Then) ?? "push";
  } catch {
    return "push";
  }
};

function Btn({ k, label, keys, on, side, onClick, children }: { k: string; label: string; keys?: string; on?: boolean; side: "left" | "top"; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip content={label} shortcut={keys} side={side}>
      <button type="button" className="lc-rail-b l-focus" data-k={k} aria-label={label} aria-pressed={on ?? false} onClick={onClick}>
        {children}
      </button>
    </Tooltip>
  );
}

/*
  The open session's panel, reachable from outside it: ⌘K's "Open Browser" and the like go to the
  session on screen through its tray, which holds the panel. Answers whether a session took it.
*/
const panels = new Map<string, (tab: SurfaceId) => void>();
export function openSurface(threadId: string, tab: SurfaceId) {
  const open = panels.get(threadId);
  open?.(tab);
  return Boolean(open);
}

/*
  The tray's move between the edge and the panel's foot. They are two trays, one in each place:
  the one that goes notes where it stood and its buttons were, in the render before the commit
  moves it, and the one that comes starts from there, its box and each button on one spring, so
  every icon travels to its own place (FLIP). The spring and its length are the panel column's,
  so the tray lands as the panel does.
*/
type Stood = { at: number; box: DOMRect; r: string; items: Map<string, DOMRect> };
const stood = new Map<string, Stood>();
const measure = (nav: HTMLElement): Stood => ({
  at: performance.now(),
  box: nav.getBoundingClientRect(),
  r: getComputedStyle(nav).borderRadius,
  items: new Map([...nav.querySelectorAll<HTMLElement>("[data-k]")].map((el) => [el.dataset.k!, el.getBoundingClientRect()])),
});
const mid = (r: DOMRect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

function travel(nav: HTMLElement, from: Stood, ms: number) {
  // Its own entrance would start it from nothing, and off its place; it comes from where the
  // other one stood, to where it rests, so that is cancelled before it is measured.
  for (const x of nav.getAnimations()) if (x instanceof CSSAnimation) x.cancel();
  const to = measure(nav);
  const a = mid(from.box);
  const b = mid(to.box);
  const timing = { duration: ms, easing: getComputedStyle(nav).getPropertyValue("--l-spring-smooth").trim() || "ease-out" };
  // The box keeps its centre where it stands (app.css), so its size and the buttons, which keep
  // theirs about that centre, blend on the same curve and never part.
  nav.animate(
    [
      { width: `${from.box.width}px`, height: `${from.box.height}px`, borderRadius: from.r, transform: `translate(${a.x - b.x}px, ${a.y - b.y}px)` },
      { width: `${to.box.width}px`, height: `${to.box.height}px`, borderRadius: to.r, transform: "none" },
    ],
    timing,
  );
  for (const [k, r] of to.items) {
    const was = from.items.get(k);
    const el = nav.querySelector<HTMLElement>(`[data-k="${k}"]`);
    if (!was || !el) continue;
    const p = mid(was);
    const q = mid(r);
    const dx = p.x - a.x - (q.x - b.x);
    const dy = p.y - a.y - (q.y - b.y);
    el.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${was.width / r.width}, ${was.height / r.height})` }, { transform: "none" }], timing);
  }
  // The hairlines between the groups turn with the tray: they show once it has mostly arrived.
  for (const seg of nav.querySelectorAll(".lc-rail-seg + .lc-rail-seg")) seg.animate([{ opacity: 0 }, { opacity: 0, offset: 0.55 }, { opacity: 1 }], { ...timing, pseudoElement: "::before" });
}

/**
 * `docked`: the tray at the foot of the panel (Session.tsx puts it there while the panel is open
 * beside the thread), lying down. `leaving`: that panel is shutting, and the tray at the edge
 * takes over from it.
 */
export function Rail({ thread, panel, onPanel, onTab, files, branch, hidden, docked, leaving }: { thread: Thread; panel: PanelState; onPanel: (f: (p: PanelState) => PanelState) => void; onTab: (tab: SurfaceId) => void; files: number; branch?: string; hidden?: boolean; docked?: boolean; leaving?: boolean }) {
  const showing = panel.open && !panel.picking ? panel.tab : null;
  const side = docked ? "top" : "left";
  const setPanel = useRef(onPanel);
  setPanel.current = onPanel;
  useEffect(() => {
    // The tray at the edge is there for the session's whole life, so it is the one ⌘K goes through.
    if (docked) return;
    const open = (tab: SurfaceId) => setPanel.current((p) => openTab(p, tab));
    panels.set(thread.id, open);
    return () => {
      if (panels.get(thread.id) === open) panels.delete(thread.id);
    };
  }, [thread.id, docked]);

  const nav = useRef<HTMLElement>(null);
  const away = Boolean(docked ? leaving : hidden);
  const wasAway = useRef(away);
  // Going: where it stands now, read in this render, before the commit hides it. Not from the
  // edge of a thread that isn't showing (Review full width): there is nothing there to leave.
  if (away && !wasAway.current && nav.current && !prefersReducedMotion()) {
    const column = nav.current.closest<HTMLElement>(".lc-thread");
    if (!column || Number(getComputedStyle(column).opacity) > 0.5) stood.set(thread.id, measure(nav.current));
  }
  const arrive = () => {
    const from = stood.get(thread.id);
    stood.delete(thread.id);
    // Only from a tray that went in this same change, never from one noted long ago.
    if (!from || !nav.current || performance.now() - from.at > 200) return;
    // Out to the panel on its opening spring; home on its shutting one (app.css, .lc-body).
    travel(nav.current, from, docked ? 520 : 400);
  };
  useLayoutEffect(() => {
    if (docked) arrive();
  }, []);
  useLayoutEffect(() => {
    if (!docked && wasAway.current && !away) arrive();
    wasAway.current = away;
  }, [away]);

  return (
    // At the edge it is hidden rather than gone: ⌘K's "Open Browser" reaches the panel through it (openSurface).
    <nav ref={nav} className="lc-rail" aria-label="Panel and surfaces" hidden={hidden} data-dock={docked || undefined} data-leaving={leaving || undefined} inert={leaving || undefined}>
      <div className="lc-rail-seg" data-solo>
        <Btn k="panel" side={side} label={panel.open ? "Hide the panel" : "Show the panel"} on={panel.open} onClick={() => onPanel((p) => (p.open ? { ...p, open: false, wide: false, picking: false } : { ...p, open: true }))}>
          <I.panel size={16} />
        </Btn>
      </div>
      <div className="lc-rail-seg" role="group" aria-label="Surfaces">
        {SHOWN.map((s) => (
          <Btn key={s.id} k={s.id} side={side} label={s.label} keys={os.keys(shortcutOf(`surface.${s.id}`) ?? []) || undefined} on={showing === s.id} onClick={() => onTab(s.id)}>
            <s.icon size={16} />
          </Btn>
        ))}
      </div>
      <div className="lc-rail-seg" role="group" aria-label="Ship" data-act>
        <ShipButton thread={thread} files={files} branch={branch} side={side} triggerClass="lc-rail-b lc-rail-ship" />
        <Btn k="more" side={side} label="Every surface" on={panel.open && panel.picking} onClick={() => onPanel((p) => ({ ...p, open: true, picking: !(p.open && p.picking) }))}>
          <I.more size={16} />
        </Btn>
      </div>
    </nav>
  );
}

/** Commit and push, with how many files wait in a badge on the arrow: in the tray, or in the bar while the panel is open. */
export function ShipButton({ thread, files, branch, side, triggerClass }: { thread: Thread; files: number; branch?: string; side: "left" | "top" | "bottom"; triggerClass: string }) {
  const running = thread.status === "running";
  return (
    <Tooltip content={files ? `Commit ${plural(files, "file")}` : "Push or open a PR"} side={side}>
      <span className="lc-rail-pop" data-k="ship" data-count={files > 0 || undefined}>
        <Pop
          label={files ? `Commit and push, ${plural(files, "file")} waiting` : "Commit and push"}
          side={side}
          align={side === "bottom" ? "end" : undefined}
          width={files ? 380 : 280}
          triggerClass={triggerClass}
          disabled={running}
          trigger={
            <>
              <I.push size={side === "left" ? 17 : 16} />
              {files > 0 && (
                <span key={files} className="lc-rail-count l-num" aria-hidden>
                  {files > 99 ? "99+" : files}
                </span>
              )}
            </>
          }
        >
          {(close) =>
            files > 0 ? (
              <CommitForm thread={thread} files={files} then={savedThen()} onDone={close} />
            ) : (
              <div className="lc-ship-menu">
                <PanelHead>Nothing to commit</PanelHead>
                <Row
                  title={`Push ${branch ?? "this branch"}`}
                  note="To its branch on GitHub"
                  icon={<I.push size={13} />}
                  onPick={() => {
                    close();
                    void ship(thread, null);
                  }}
                />
                <Row title="Open a pull request" note="The PR card, in the chat" icon={<I.pr size={13} />} onPick={() => (close(), void rpc("thread.send", { id: thread.id, text: "create pr" }).catch(fail))} />
              </div>
            )
          }
        </Pop>
      </span>
    </Tooltip>
  );
}
