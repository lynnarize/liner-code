/*
  The Checks tab, and where the checks show on the canvas: what checks.ts found, in the panel's
  sections (To fix, one finding a card: its number, its frame, its kind, the sentence, the evidence
  where it helps, and Fix; then Passed, folded to its count), and Fix all as the inspector's foot
  while the tab shows (the one ink action, in Build's place). On the canvas each finding is a numbered mark where it is, and
  each frame's name says how it stands ("2 to fix", "passed", or why it isn't checked); Layers
  shows the count beside the frame, and the dock a row with Fix all. Finding is free; a fix that
  the finding carries (contrast: a lean colour) is made here, the rest goes to the agent.
*/
import { useMemo, useState } from "react";
import type { DesignFrame } from "@contracts";
import { I, StepMark } from "../icons";
import { plural } from "../model";
import { PaneButton, PaneFoot, PaneNote, PaneRow, PaneSection } from "../Pane";
import { Row } from "../ui";
import { srcDocOf } from "./Frame";
import { fixAll, fixerName, fixOne, KIND_NAME, notAScreen, show, toFix, useChecks, watchChecks, type Finding } from "./checks";
import { design, getDesign, useDesign } from "./store";
import { FOOT } from "./inspect/slots";
import { useInkClaim, useTrayInk } from "./tray-ink";
import "./checks.css";

watchChecks();

/** A finding's number, as on its mark on the canvas. */
const Num = ({ n }: { n: number }) => (
  <span className="ld-ck-n" aria-hidden>
    {n}
  </span>
);

/** The top of the frame at the width it fails at, round what runs furthest past the edge: the evidence for fit. */
function Evidence({ f }: { f: Finding }) {
  const html = useDesign((s) => s.html[f.frame]);
  const base = useDesign((s) => s.base);
  const frame = useDesign((s) => s.file?.frames.find((x) => x.id === f.frame));
  const doc = useMemo(() => (html ? srcDocOf(html, base) : ""), [html, base]);
  if (!html || !frame || !f.at) return null;
  const W = f.at;
  // From a little left of the edge to past it; the band round the top of the thing that runs off.
  const x0 = Math.max(0, W - 210);
  const y0 = Math.max(0, Math.round((f.box?.y ?? 0) - 18));
  const scale = 1.25;
  return (
    <div className="ld-ck-ev" aria-label={`The frame at ${W} wide: what runs off the edge`} role="img">
      <div className="ld-ck-ev-in" style={{ width: (W - x0 + 36) * scale }}>
        <iframe title="" tabIndex={-1} sandbox="allow-scripts" srcDoc={doc} width={W} height={frame.h} style={{ width: W, height: frame.h, transform: `scale(${scale}) translate(${-x0}px, ${-y0}px)` }} />
        <i className="ld-ck-edge" style={{ left: (W - x0) * scale }} />
      </div>
    </div>
  );
}

function Card({ f, n }: { f: Finding; n: number }) {
  const frame = useDesign((s) => s.file?.frames.find((x) => x.id === f.frame));
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  const showAt = (w: number) => {
    const fr = getDesign().file?.frames.find((x) => x.id === f.frame);
    if (fr) design.place([{ id: fr.id, w }], { before: [fr] });
    show(f);
  };
  return (
    <article className="ld-ck-card">
      <button type="button" className="ld-ck-h l-focus" title="Show it on the canvas" onClick={() => show(f)}>
        <Num n={n} />
        <b className="ld-ell">{frame?.name ?? f.frame}</b>
        <span className="lc-grow" />
        <small>{KIND_NAME[f.kind]}</small>
      </button>
      <p className="ld-ck-t">{f.text}</p>
      {f.kind === "fit" && <Evidence f={f} />}
      <div className="ld-ck-acts">
        <PaneButton disabled={busy} onClick={() => void run(() => fixOne(f))}>
          {f.fixLabel ?? "Fix"}
        </PaneButton>
        {f.kind === "fit" && f.at && frame && f.at !== frame.w ? <PaneButton onClick={() => showAt(f.at!)}>Show at {f.at}</PaneButton> : <PaneButton onClick={() => show(f)}>Show</PaneButton>}
      </div>
    </article>
  );
}

export function ChecksTab() {
  const file = useDesign((s) => s.file);
  const byFrame = useChecks((s) => s.byFrame);
  const running = useChecks((s) => s.running > 0);
  const ms = useChecks((s) => s.ms);
  const [passedOpen, setPassedOpen] = useState(false);
  const all = useMemo(() => toFix(), [byFrame, file]);
  const passed = useMemo(() => (file?.frames ?? []).flatMap((f) => (byFrame[f.id]?.passed ?? []).map((p) => ({ frame: f, p }))), [byFrame, file]);
  const checked = (file?.frames ?? []).filter((f) => byFrame[f.id] && !byFrame[f.id].skipped && !byFrame[f.id].failed).length;
  const failed = (file?.frames ?? []).filter((f) => byFrame[f.id]?.failed);
  if (!file) return <PaneNote icon={<I.shield size={20} />} title="No design file open">Open a design file to check its screens.</PaneNote>;
  // Where the checks stand is the first section's note, as a pull request's Checks says "3 of 3 passed".
  const stand = running ? (
    <span className="ld-ck-q" aria-live="polite">
      <StepMark state="working" size={12} />
      {checked ? `${plural(checked, "screen")} checked` : "Checking"}
    </span>
  ) : (
    <span className="ld-ck-q" aria-live="polite">
      {plural(checked, "screen")} checked{ms !== undefined ? ` · ${(ms / 1000).toFixed(1)} s` : ""}
    </span>
  );
  return (
    <div className="ld-body ld-ck">
      <PaneSection label={all.length ? `To fix ${all.length}` : "To fix"} note={stand}>
        {all.length ? (
          all.map((f, i) => <Card key={f.key} f={f} n={i + 1} />)
        ) : (
          <p className="ld-note ld-ck-none">{running ? "Looking at each screen at the widths it is for." : "Nothing to fix. Each screen passed every check."}</p>
        )}
        {failed.map((f) => (
          <p key={f.id} className="ld-note ld-ck-none">
            {f.name} couldn't be checked: {byFrame[f.id].failed}
          </p>
        ))}
      </PaneSection>
      <PaneSection className="ld-ck-passed" label="Passed" note={passed.length ? undefined : "None yet"}>
        {passed.length > 0 && (
          <>
            <PaneRow icon={<I.check size={14} />} value={passedOpen ? "Fold" : undefined} quiet opens={!passedOpen} onClick={() => setPassedOpen(!passedOpen)}>
              {plural(passed.length, "check")} passed
            </PaneRow>
            {passedOpen &&
              passed.map(({ frame, p }) => (
                <PaneRow key={`${frame.id}:${p}`} icon={<I.check size={14} />} value={p} quiet>
                  {frame.name}
                </PaneRow>
              ))}
          </>
        )}
      </PaneSection>
      <p className="ld-note ld-ck-lede">Run on this Mac, on the frames as real pages. No agent and no tokens, so they run again each time a frame changes.</p>
    </div>
  );
}

/** The inspector's foot while Checks shows and something waits to be fixed: where a fix goes, and Fix all, the tab's one ink action. */
function ChecksFoot() {
  const byFrame = useChecks((s) => s.byFrame);
  const frames_ = useDesign((s) => s.file?.frames);
  const all = useMemo(() => toFix(), [byFrame, frames_]);
  const [busy, setBusy] = useState(false);
  // While this foot shows, its Fix all is the face's one ink action and the dock's row keeps the same action quiet (tray-ink.ts).
  useInkClaim("foot", all.length ? "fix" : undefined);
  if (!all.length) return null;
  const frames = new Set(all.map((f) => f.frame)).size;
  return (
    <PaneFoot say={`A fix goes to ${fixerName()}`}>
      <PaneButton ink disabled={busy} onClick={() => (setBusy(true), void fixAll().finally(() => setBusy(false)))} title={`${all.length} to fix in ${plural(frames, "frame")}`}>
        Fix all {all.length}
      </PaneButton>
    </PaneFoot>
  );
}

// The foot is the inspector's slot: one entry, kept once across reloads of this module. Build's foot gives way to it on Checks.
{
  const i = FOOT.findIndex((x) => x.id === "checks");
  const entry = { id: "checks", render: (tab: string) => (tab === "checks" ? <ChecksFoot /> : null) };
  if (i >= 0) FOOT[i] = entry;
  else FOOT.push(entry);
}

/** The tab's count: what there is to fix. */
export const checksCount = () => toFix().length;

/** After a frame's name on the canvas: how it stands. */
export function CheckLabel({ frame }: { frame: DesignFrame }) {
  const r = useChecks((s) => s.byFrame[frame.id]);
  const html = useDesign((s) => s.html[frame.id]);
  const skipped = notAScreen(frame, html);
  // Marked not a screen: Build's "Not for code" says it already, so nothing is added here.
  if (frame.screen === false) return null;
  if (skipped) return <span className="ld-ck-lab">{skipped}</span>;
  if (!r || r.failed) return null;
  const n = r.findings.length;
  return n ? (
    <span className="ld-ck-lab" data-bad>
      <I.alert size={12} />
      {n} to fix
    </span>
  ) : (
    <span className="ld-ck-lab" data-ok>
      <I.check size={12} />
      passed
    </span>
  );
}

const MARK = 18;
/**
  The numbered marks on the frames, where each finding is. A mark stays inside its own frame's box
  (clamped to its edges, so never over the name above or the line under it). Marks that would
  overlap at this zoom fold into one, showing the first number and "+N": pointing at it or pressing
  it opens the list for that spot, and a press also picks the first. Zoomed in, they part again.
*/
export function CheckMarks({ frames, boxOf }: { frames: DesignFrame[]; boxOf: (f: DesignFrame, r?: { x: number; y: number; w: number; h: number }) => { left: number; top: number; width: number; height: number } }) {
  const byFrame = useChecks((s) => s.byFrame);
  // One source for the tab, the dock, the marks and Fix all: the open file's frames as they are now.
  const frames_ = useDesign((s) => s.file?.frames);
  const all = useMemo(() => toFix(), [byFrame, frames_]);
  const [open, setOpen] = useState<string | null>(null);
  const on = new Set(frames.map((f) => f.id));
  // Each mark's box, clamped inside its frame on all four sides; then marks whose boxes touch fold
  // into one (decided on those final boxes, again and again until no two touch). A folded mark is
  // wider ("19 +5") and is clamped again at its own width.
  type Spot = { key: string; frame: string; x: number; y: number; fb: { left: number; top: number; width: number; height: number }; items: { f: Finding; n: number }[] };
  const widthOf = (p: Spot) => (p.items.length > 1 ? 18 + 8 + String(p.items.length - 1).length * 7 + String(p.items[0].n).length * 6 : Math.max(MARK, 8 + String(p.items[0].n).length * 7));
  const place = (p: Spot) => {
    const w = widthOf(p);
    p.x = Math.max(p.fb.left, Math.min(p.x, p.fb.left + p.fb.width - w));
    p.y = Math.max(p.fb.top, Math.min(p.y, p.fb.top + p.fb.height - MARK));
  };
  let spots: Spot[] = [];
  all.forEach((f, i) => {
    if (!on.has(f.frame)) return;
    const fr = frames.find((x) => x.id === f.frame)!;
    // Fit's box is from the narrower page: its mark goes at the frame's right edge, level with it.
    const r = f.kind === "fit" ? { x: fr.w - 1, y: f.box?.y ?? 0, w: 1, h: f.box?.h ?? 20 } : f.box;
    const b = boxOf(fr, r);
    const p: Spot = { key: f.key, frame: f.frame, x: b.left + b.width - MARK / 2, y: b.top - MARK / 2, fb: boxOf(fr), items: [{ f, n: i + 1 }] };
    place(p);
    spots.push(p);
  });
  const touch = (a: Spot, b: Spot) => a.frame === b.frame && a.x < b.x + widthOf(b) + 2 && b.x < a.x + widthOf(a) + 2 && a.y < b.y + MARK + 2 && b.y < a.y + MARK + 2;
  for (let merged = true, rounds = 0; merged && rounds < 200; rounds++) {
    merged = false;
    outer: for (let i = 0; i < spots.length; i++)
      for (let j = i + 1; j < spots.length; j++)
        if (touch(spots[i], spots[j])) {
          const [a, b] = spots[i].items[0].n < spots[j].items[0].n ? [spots[i], spots[j]] : [spots[j], spots[i]];
          a.items = [...a.items, ...b.items].sort((x, y) => x.n - y.n);
          spots = spots.filter((x) => x !== b);
          place(a);
          merged = true;
          break outer;
        }
  }
  return (
    <>
      {spots.map((p) => {
        const [first, ...rest] = p.items;
        const say = p.items.map((x) => `${x.n}: ${x.f.text}`).join("\n");
        return (
          <div key={p.key} className="ld-ck-spot" data-ld-ui style={{ left: p.x, top: p.y }} onPointerEnter={() => rest.length && setOpen(p.key)} onPointerLeave={() => setOpen((k) => (k === p.key ? null : k))} onPointerDown={(e) => e.stopPropagation()}>
            <button type="button" className="ld-ck-mark l-focus" data-more={rest.length || undefined} style={{ width: widthOf(p) }} aria-label={rest.length ? `${p.items.length} findings here. ${say}` : say} aria-expanded={rest.length ? open === p.key : undefined} title={rest.length ? undefined : first.f.text} onClick={() => (show(first.f), rest.length && setOpen(p.key))}>
              {first.n}
              {rest.length > 0 && <small>+{rest.length}</small>}
            </button>
            {open === p.key && rest.length > 0 && (
              <div className="ld-ck-spot-list" role="menu" aria-label="The findings here">
                {p.items.map((x) => (
                  <Row key={x.f.key} title={x.f.text} icon={<span className="ld-ck-n">{x.n}</span>} onPick={() => (show(x.f), setOpen(null))} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/** Beside a frame in Layers: its count, or a tick when it passed. */
export function LayerChecks({ frame }: { frame: string }) {
  const r = useChecks((s) => s.byFrame[frame]);
  if (!r || r.skipped || r.failed) return null;
  return r.findings.length ? <span className="ld-ck-ly" aria-label={`${r.findings.length} to fix`}>{r.findings.length}</span> : <span className="ld-ck-ly" data-ok aria-label="Passed"><I.check size={12} /></span>;
}

/** The dock's row: how many things to fix, and Fix all. */
export function ChecksRow() {
  const byFrame = useChecks((s) => s.byFrame);
  // One source for the tab, the dock, the marks and Fix all: the open file's frames as they are now.
  const frames_ = useDesign((s) => s.file?.frames);
  const all = useMemo(() => toFix(), [byFrame, frames_]);
  const [busy, setBusy] = useState(false);
  const ink = useTrayInk(all.length ? "fix" : undefined);
  if (!all.length) return null;
  const frames = new Set(all.map((f) => f.frame)).size;
  return (
    <div className="lc-trow ld-ck-row" role="status">
      <I.shield size={16} />
      <span className="lc-trow-t">
        {/* "N to fix", as each frame's chip and the tab say it. */}
        {all.length} to fix in {plural(frames, "frame")}
      </span>
      <span className="lc-grow" />
      {/* The shape of the Code face's "N files to commit" row: an icon, the words, one button, ink only as tray-ink.ts allows. */}
      <button type="button" className="lc-btn lc-trow-commit l-focus" data-kind={ink ? "ink" : "ghost"} disabled={busy} onClick={() => (setBusy(true), void fixAll().finally(() => setBusy(false)))}>
        Fix all {all.length}
      </button>
    </div>
  );
}
