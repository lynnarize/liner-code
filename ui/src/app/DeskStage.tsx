/*
  Home in two areas: the question, and the Desk behind it. The Desk stays out of the way until
  you ask for it: a glass cue at the foot of Home says what's on it, the first scroll down arms
  the cue (Home gives a little and the cue says to scroll again), and a second scroll while it's
  armed slides the Desk up as an area of its own. At the top of the Desk the same two scrolls
  up bring the question back. Pressing a cue does it in one.
*/
import { useEffect, useRef, useState, type ReactNode, type WheelEvent } from "react";
import type { Project } from "@contracts";
import type { RunSettings } from "./Composer";
import { Desk, useDeskCounts } from "./Desk";
import { I } from "./icons";
import { Num } from "./ui";

type Props = { project: Project; settings: RunSettings; worktree: boolean; onOpen: (threadId: string) => void; children: ReactNode };
type Area = "ask" | "desk";
type Dir = "down" | "up";

/** How long an armed cue waits for the second scroll. */
const WINDOW = 1800;
/** How far one gesture has to travel to count as a scroll. */
const TRAVEL = 40;

/** Something between the pointer and the stage that would scroll this way itself. */
function scrollsItself(from: EventTarget | null, dir: Dir, stop: HTMLElement) {
  for (let el = from instanceof Element ? from : null; el && el !== stop; el = el.parentElement) {
    const y = getComputedStyle(el).overflowY;
    if (y !== "auto" && y !== "scroll") continue;
    if (dir === "down" ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0) return true;
  }
  return false;
}

export function DeskStage({ project, settings, worktree, onOpen, children }: Props) {
  const [area, setArea] = useState<Area>("ask");
  const [armed, setArmed] = useState<Dir | null>(null);
  // The Desk mounts the first time it's opened and then stays, so an open case is still there when you come back.
  const [mounted, setMounted] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const deskPage = useRef<HTMLDivElement>(null);
  const gesture = useRef({ last: 0, prev: 0, sum: 0, counted: false });
  const armedAt = useRef<{ dir: Dir; at: number } | null>(null);
  const timer = useRef(0);
  const counts = useDeskCounts();

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const go = (next: Area) => {
    window.clearTimeout(timer.current);
    armedAt.current = null;
    setArmed(null);
    if (next === "desk") setMounted(true);
    setArea(next);
    if (next === "desk") requestAnimationFrame(() => deskPage.current?.scrollTo({ top: 0 }));
  };
  const arm = (dir: Dir) => {
    armedAt.current = { dir, at: performance.now() };
    setArmed(dir);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      armedAt.current = null;
      setArmed(null);
    }, WINDOW);
  };

  // A gesture is a run of wheel events with no pause between them (a trackpad's momentum is part
  // of the swipe that started it); a fresh swipe during momentum shows as the deltas rising again.
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || !stage.current) return;
    // A menu or dialog opened from Home sits outside it (in a portal), but its wheel events still
    // reach here through React: scrolling one never moves Home. While one is open, Home stays
    // under it, so it isn't left floating over the Desk.
    if (!(e.target instanceof Node && stage.current.contains(e.target)) || document.querySelector(".lc-layer, dialog[open]")) return;
    const dir: Dir = e.deltaY > 0 ? "down" : "up";
    const wanted: Dir = area === "ask" ? "down" : "up";
    if (dir !== wanted || scrollsItself(e.target, dir, stage.current)) return;
    const now = performance.now();
    const g = gesture.current;
    const d = Math.abs(e.deltaY);
    const fresh = now - g.last > 220 || (g.counted && d > Math.max(12, g.prev * 2));
    if (fresh) {
      g.sum = 0;
      g.counted = false;
    }
    g.last = now;
    g.prev = d;
    g.sum += d;
    if (g.counted || g.sum < TRAVEL) return;
    g.counted = true;
    const a = armedAt.current;
    if (a && a.dir === dir && now - a.at < WINDOW) go(area === "ask" ? "desk" : "ask");
    else arm(dir);
  };

  return (
    <div ref={stage} className="lc-desk-stage" data-area={area} data-armed={armed ?? undefined} onWheel={onWheel}>
      <div className="lc-desk-page lc-desk-page-ask" inert={area !== "ask" || undefined} aria-hidden={area !== "ask" || undefined}>
        {children}
        <Cue dir="down" armed={armed === "down"} counts={counts} onPress={() => go("desk")} />
      </div>
      <div ref={deskPage} className="lc-desk-page lc-desk-page-desk" inert={area !== "desk" || undefined} aria-hidden={area !== "desk" || undefined}>
        <Cue dir="up" armed={armed === "up"} counts={counts} onPress={() => go("ask")} />
        {mounted && <Desk project={project} settings={settings} worktree={worktree} onOpen={onOpen} />}
      </div>
    </div>
  );
}

/**
  The cue between the two areas: a white pill whose chevron nods toward the Desk a few times
  (again whenever something new comes back to you), with what's on it. Armed, it widens, says
  to scroll again, and a line under it drains for as long as the second scroll counts.
*/
function Cue({ dir, armed, counts, onPress }: { dir: Dir; armed: boolean; counts: { back: number; out: number; yours: number }; onPress: () => void }) {
  const down = dir === "down";
  const Chev = down ? I.chevD : I.chevU;
  const said = [counts.back && `${counts.back} back with you`, counts.out && `${counts.out} out with agents`].filter(Boolean).join(", ");
  return (
    <button
      type="button"
      className="lc-desk-cue l-focus"
      data-dir={dir}
      data-armed={armed || undefined}
      aria-label={down ? `Open the Desk${said ? `: ${said}` : ""}` : "Back to the question"}
      onClick={onPress}
    >
      <span className="lc-desk-cue-chev" key={`${counts.back}-${armed}`} aria-hidden>
        <Chev size={14} />
      </span>
      <span className="lc-desk-cue-t" key={String(armed)}>
        {armed ? (down ? "Scroll again for the Desk" : "Scroll again for Home") : down ? "Desk" : "Home"}
      </span>
      {down && !armed && (counts.back > 0 || counts.out > 0) && (
        <span className="lc-desk-cue-n" aria-hidden>
          {counts.back > 0 && (
            <span data-k="back" key={`b${counts.back}`}>
              <i />
              <Num value={counts.back} /> back
            </span>
          )}
          {counts.out > 0 && (
            <span data-k="out">
              <i />
              <Num value={counts.out} /> out
            </span>
          )}
        </span>
      )}
      {armed && <span className="lc-desk-cue-bar" aria-hidden />}
    </button>
  );
}
