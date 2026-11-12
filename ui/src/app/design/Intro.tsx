/*
  Liner Design's first-open sheet: the first time a person's window shows the Design face, one sheet
  over it says what the face is for. A picture on the canvas ground, then four points; each point
  opens its own picture, a short story that plays again. Until a point is picked the sheet moves on
  by itself every 9s, the open point's plate filling as it goes. Start drawing, the cross, Esc or a
  click outside closes it for good (localStorage; once per window where there's none).

  Still, by the system's Reduce motion, no story plays and the sheet doesn't move on: each picture
  rests where its story ends. The app's Quick motion leaves the stories alone: Quick is the default
  and is about navigation, and this sheet is a film shown once. App.tsx mounts it, lazily, wherever the
  Design face shows (Design Home or the canvas); nothing of it loads in the Code face.
*/
import { useEffect, useRef, useState } from "react";
import { I } from "../icons";
import { shortcutOf } from "../keymap";
import landing from "./intro/landing.jpg";
import brand from "./intro/brand.jpg";
import desktop from "./intro/desktop.jpg";
import "./intro.css";

const KEY = "liner.design.intro";
let seenHere = false;
const seen = () => {
  if (seenHere) return true;
  try {
    return localStorage.getItem(KEY) === "seen";
  } catch {
    return false;
  }
};
const markSeen = () => {
  seenHere = true;
  try {
    localStorage.setItem(KEY, "seen");
  } catch {
    // no storage: once per window
  }
};

const REDUCE = "(prefers-reduced-motion: reduce)";
const isStill = () => {
  try {
    return matchMedia(REDUCE).matches;
  } catch {
    return false;
  }
};
/** Reduce motion: the stories rest and the sheet waits for a pick. */
function useStill() {
  const [still, setStill] = useState(isStill);
  useEffect(() => {
    const on = () => setStill(isStill());
    const mq = matchMedia(REDUCE);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return still;
}

const STEP = 9000;

/** The pictures' glyphs: 24-grid, drawn as in the mockup. */
const G = ({ d }: { d: string }) => (
  <svg className="ld-in-g" viewBox="0 0 24 24" aria-hidden>
    <path d={d} />
  </svg>
);
const POINTER = "M5 3l14 8-6 2-2 6-6-16z";
const TICK = "M5 12.5l4.5 4.5L19 7.5";

type Point = { t: string; n: string; d: string };
const POINTS: Point[] = [
  { t: "Say what to draw", n: "Your agent draws real HTML and CSS.", d: "M5 6h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM7 12h4M16 15V9.5M13.5 11.5L16 9l2.5 2.5" },
  { t: "Change anything yourself", n: "Click to style, double-click to go deeper.", d: "M15 8.5V4H4v11h4.5M11 11l10 3.5-4.2 1.6-1.8 4.4L11 11z" },
  { t: "A lean keeps it yours", n: "DESIGN.md, and skills such as /awwwards.", d: "M7 3h7l4 4v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM14 3v4h4M8 12.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0M13.5 12.5H16M8.5 17H16" },
  { t: "Check it, then build it", n: "Frames become code and stay in step.", d: "M7.5 7.5L3 12l4.5 4.5M16.5 7.5L21 12l-4.5 4.5M9 12.2l2.2 2.3 3.8-4.8" },
];

/** The agent's pointer with its name, in the lead's colour. */
const Who = ({ name, className }: { name: string; className: string }) => (
  <div className={`ld-in-who ${className}`}>
    <G d={POINTER} />
    <span>{name}</span>
  </div>
);

/** 1 · The switch to Design, and the agent drawing a frame beside two others. */
function Canvas({ agent }: { agent: string }) {
  return (
    <>
      <div className="ld-in-sw">
        <b><G d="M8 7l-5 5 5 5M16 7l5 5-5 5" />Code</b>
        <b className="on"><G d="M4 20l4-1L19 8l-3-3L5 16l-1 4z" />Design</b>
        <span className="ld-in-key">{shortcutOf("face") ?? "⌥⌘E"}</span>
      </div>
      <div className="ld-in-fr ld-in-p1a"><div className="ld-in-fr-n">Web / Launch</div><img src={landing} alt="" /></div>
      <div className="ld-in-fr ld-in-p1b"><div className="ld-in-fr-n">Brand / Board</div><img src={brand} alt="" /></div>
      <div className="ld-in-fr ld-in-p1c"><div className="ld-in-fr-n">Desktop / Today</div><div className="ld-in-crop"><img src={desktop} alt="" /></div></div>
      <Who name={agent} className="ld-in-p1who" />
    </>
  );
}

/** 2 · You click the heading and say what to change; the agent takes it. */
function Change({ agent }: { agent: string }) {
  return (
    <>
      <div className="ld-in-fr ld-in-p2f"><img src={landing} alt="" /></div>
      <div className="ld-in-sel"><i /><i /><i /><i /><span>Heading</span></div>
      <Who name={agent} className="ld-in-p2who" />
      <div className="ld-in-box ld-in-ins">
        <div className="ld-in-tabs"><b className="on">Style</b><b>Code</b><b>Build</b></div>
        <div className="ld-in-lab">Type</div>
        <div className="ld-in-fld">Display<span>56</span></div>
        <div className="ld-in-lab">Fill, from the lean</div>
        <div className="ld-in-dabs"><i className="c-night on" /><i className="c-buoy" /><i className="c-sea" /><i className="c-marsh" /><i className="c-sand" /></div>
      </div>
      <div className="ld-in-box ld-in-say">
        <span className="ld-in-chip">Heading</span>
        <div><span className="ld-in-typed">Make it calmer</span><span className="ld-in-send"><G d="M12 19V5M6 11l6-6 6 6" /></span></div>
      </div>
      <div className="ld-in-me ld-in-p2me"><G d={POINTER} /></div>
    </>
  );
}

/** 3 · The lean fills in, and a skill is switched on and off. */
function Lean() {
  return (
    <>
      <div className="ld-in-box ld-in-lean">
        <div className="ld-in-lean-h">
          <span className="ld-in-quad"><i className="c-sand" /><i className="c-sea" /><i className="c-marsh" /><i className="c-chalk" /></span>
          <div><div className="ld-in-t">DESIGN.md</div><div className="ld-in-n">12 colours · 5 voices · 4 pt step</div></div>
        </div>
        <div className="ld-in-lab">Colours</div>
        <div className="ld-in-sws"><i className="c-sand" /><i className="c-sea" /><i className="c-marsh" /><i className="c-buoy" /><i className="c-night" /><i className="c-chalk" /></div>
        <div className="ld-in-lab">Voices</div>
        <div className="ld-in-voices"><b>Aa</b><em>Aa</em><span>14:32</span></div>
        <div className="ld-in-lab">Step</div>
        <div className="ld-in-bars"><i /><i /><i /><i /><i /></div>
      </div>
      <div className="ld-in-skills">
        <div className="ld-in-lab">Skills</div>
        <div className="ld-in-box ld-in-sk"><div><div className="ld-in-t">/awwwards</div><div className="ld-in-n">Sites at award level</div></div><span className="ld-in-switch on" /></div>
        <div className="ld-in-box ld-in-sk"><div><div className="ld-in-t">/brandkit</div><div className="ld-in-n">Brand boards and logos</div></div><span className="ld-in-switch on" /></div>
        <div className="ld-in-box ld-in-sk"><div><div className="ld-in-t">/stageshow</div><div className="ld-in-n">Product pictures that move</div></div><span className="ld-in-switch" /></div>
        <div className="ld-in-more"><G d="M12 5v14M5 12h14" />2 more skills</div>
      </div>
    </>
  );
}

/** 4 · Checks finds one thing, Fix clears it, Build puts the frame in step. */
function Build() {
  return (
    <>
      <div className="ld-in-fr ld-in-p4f">
        <div className="ld-in-fr-n">
          Desktop / Today
          <span className="ld-in-swap">
            <span className="warn ld-in-4w"><G d="M12 4l9 16H3l9-16zM12 10v4.5M12 17.5v.01" />1 to fix</span>
            <span className="ok ld-in-4p"><G d={TICK} />passed</span>
          </span>
        </div>
        <img src={desktop} alt="" />
      </div>
      <span className="ld-in-mark ld-in-p4m">1</span>
      <div className="ld-in-col">
        <div className="ld-in-box ld-in-find ld-in-p4find">
          <span className="ld-in-swap"><span className="ld-in-mark ld-in-4wm">1</span><span className="ld-in-mark done ld-in-4p"><G d={TICK} /></span></span>
          <div>
            <div className="ld-in-t">The week's bars run off the edge at 320 wide</div>
            <div className="ld-in-n">Desktop / Today<span className="ld-in-swap"><b className="ld-in-4w">Fix</b><span className="ok ld-in-4p">Fixed</span></span></div>
          </div>
        </div>
        <div className="ld-in-box ld-in-built">
          <div className="ld-in-bl"><G d={TICK} /><div><div className="ld-in-t">Web / Launch</div><code>src/pages/web-launch.html</code></div><span>In step</span></div>
          <div className="ld-in-rule" />
          <div className="ld-in-bl">
            <span className="ld-in-swap">
              <svg className="ld-in-g idle ld-in-4n" viewBox="0 0 24 24" aria-hidden><path d="M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z" /></svg>
              <svg className="ld-in-g ld-in-4b" viewBox="0 0 24 24" aria-hidden><path d={TICK} /></svg>
            </span>
            <div><div className="ld-in-t">Desktop / Today</div><div className="ld-in-swap"><div className="ld-in-n ld-in-4n">Not built yet</div><code className="ld-in-4b">src/pages/desktop.html</code></div></div>
            <span className="ld-in-4b">In step</span>
          </div>
          <div className="ld-in-go">
            <span className="ld-in-n ld-in-swap"><span className="ld-in-4n">2 frames, 1 built</span><span className="ld-in-4b">2 frames, 2 built</span></span>
            <span className="ld-in-pill">Build</span>
          </div>
        </div>
      </div>
      <div className="ld-in-me ld-in-p4me"><G d={POINTER} /></div>
    </>
  );
}

/** `agent`: the lead's name in the open session, where there is one. */
export function DesignIntro({ agent }: { agent?: string }) {
  const [open, setOpen] = useState(() => !seen());
  const [tab, setTab] = useState(0);
  const [auto, setAuto] = useState(true);
  const [hidden, setHidden] = useState(() => document.hidden);
  // Bumped when the window comes back, so the plate fills again with a fresh 9s.
  const [round, setRound] = useState(0);
  const still = useStill();
  const ref = useRef<HTMLDialogElement>(null);
  const start = useRef<HTMLButtonElement>(null);
  const pressedOutside = useRef(false);

  useEffect(() => {
    const d = ref.current;
    if (!open || !d) return;
    if (!d.open) d.showModal();
    start.current?.focus();
  }, [open]);

  useEffect(() => {
    const on = () => {
      setHidden(document.hidden);
      if (!document.hidden) setRound((r) => r + 1);
    };
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);

  const playing = open && auto && !still && !hidden;
  useEffect(() => {
    if (!playing) return;
    const t = window.setTimeout(() => setTab((n) => (n + 1) % POINTS.length), STEP);
    return () => window.clearTimeout(t);
  }, [playing, tab, round]);

  if (!open) return null;
  const close = () => {
    markSeen();
    ref.current?.close();
    setOpen(false);
  };
  const pick = (n: number) => {
    setTab(n);
    setAuto(false);
  };
  const agentName = agent || "Your agent";

  return (
    <dialog
      ref={ref}
      className="lc-sheet ld-intro"
      aria-labelledby="ld-in-title"
      data-still={still || undefined}
      onCancel={(e) => (e.preventDefault(), close())}
      onClose={() => open && close()}
      onPointerDown={(e) => (pressedOutside.current = e.target === ref.current)}
      onClick={(e) => e.target === ref.current && pressedOutside.current && close()}
    >
      <div className="lc-sheet-frame ld-in-frame">
        <div key={tab} className="ld-in-pic" aria-hidden>
          {tab === 0 ? <Canvas agent={agentName} /> : tab === 1 ? <Change agent={agentName} /> : tab === 2 ? <Lean /> : <Build />}
        </div>
        <button type="button" className="ld-in-x" aria-label="Close" onClick={close}>
          <I.close size={16} />
        </button>
        <div className="ld-in-copy">
          <div className="ld-in-kicker">Liner Design</div>
          <h2 id="ld-in-title" className="ld-in-title">Draw it here, build it in the same session</h2>
          <div className="ld-in-pts">
            {POINTS.map((p, i) => (
              <button key={p.t} type="button" className="ld-in-pt" aria-pressed={tab === i} data-auto={(playing && tab === i) || undefined} onClick={() => pick(i)}>
                {playing && tab === i && <i key={`${tab}.${round}`} className="ld-in-prog" />}
                <svg viewBox="0 0 24 24" aria-hidden><path d={p.d} /></svg>
                <span>
                  <span className="ld-in-t">{p.t}</span>
                  <span className="ld-in-n">{p.n}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="ld-in-foot">
          <button ref={start} type="button" className="lc-btn" data-kind="ink" autoFocus onClick={close}>
            Start drawing
          </button>
        </div>
      </div>
    </dialog>
  );
}
