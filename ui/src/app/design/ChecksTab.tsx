/*
  The Checks tab, and where the checks show on the canvas: what checks.ts found, one finding a card
  (its number, its frame, its kind, the sentence, the evidence where it helps, and Fix), what
  passed, and Fix all at the foot. On the canvas each finding is a numbered mark where it is, and
  each frame's name says how it stands ("2 to fix", "passed", or why it isn't checked); Layers
  shows the count beside the frame, and the dock a row with Fix all. Finding is free; a fix that
  the finding carries (contrast: a lean colour) is made here, the rest goes to the agent.
*/
import { useMemo, useState } from "react";
import type { DesignFrame } from "@contracts";
import { Segmented } from "@liner/components/segmented/segmented";
import { I } from "../icons";
import { plural } from "../model";
import { srcDocOf } from "./Frame";
import { fixAll, fixerName, fixOne, KIND_NAME, notAScreen, show, toFix, useChecks, watchChecks, type Finding } from "./checks";
import { design, getDesign, useDesign } from "./store";
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
        <button type="button" className="lc-btn" data-kind="plain" data-size="sm" disabled={busy} onClick={() => void run(() => fixOne(f))}>
          {f.fixLabel ?? "Fix"}
        </button>
        {f.kind === "fit" && f.at && frame && f.at !== frame.w ? (
          <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => showAt(f.at!)}>
            Show at {f.at}
          </button>
        ) : (
          <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => show(f)}>
            Show
          </button>
        )}
      </div>
    </article>
  );
}

export function ChecksTab() {
  const file = useDesign((s) => s.file);
  const byFrame = useChecks((s) => s.byFrame);
  const running = useChecks((s) => s.running > 0);
  const ms = useChecks((s) => s.ms);
  const [view, setView] = useState<"fix" | "passed">("fix");
  const all = useMemo(() => toFix(), [byFrame, file]);
  const passed = useMemo(() => (file?.frames ?? []).flatMap((f) => (byFrame[f.id]?.passed ?? []).map((p) => ({ frame: f, p }))), [byFrame, file]);
  const checked = (file?.frames ?? []).filter((f) => byFrame[f.id] && !byFrame[f.id].skipped && !byFrame[f.id].failed).length;
  const failed = (file?.frames ?? []).filter((f) => byFrame[f.id]?.failed);
  const busy = useState(false);
  if (!file) return <div className="ld-empty">Open a design file to check its screens.</div>;
  const frames = new Set(all.map((f) => f.frame)).size;
  return (
    <div className="ld-body ld-ck">
      <div className="ld-ck-top" aria-live="polite">
        <I.shield size={15} />
        <b>{running && !checked ? "Checking the screens" : `${plural(checked, "screen")} checked`}</b>
        <span className="lc-grow" />
        {running ? <span className="ld-ck-q l-shimmer">Checking</span> : ms !== undefined && <span className="ld-ck-q">{(ms / 1000).toFixed(1)} s</span>}
      </div>
      <p className="ld-ck-lede">Run on this Mac, on the frames as real pages. No agent and no tokens, so they run again each time a frame changes.</p>
      <div className="ld-ck-seg">
        <Segmented
          size="sm"
          value={view}
          onValueChange={(v) => setView(v as "fix" | "passed")}
          aria-label="Findings"
          options={[
            { value: "fix", label: `To fix ${all.length}` },
            { value: "passed", label: `Passed ${passed.length}` },
          ]}
        />
      </div>
      {view === "fix" ? (
        all.length ? (
          all.map((f, i) => <Card key={f.key} f={f} n={i + 1} />)
        ) : (
          <p className="ld-note">{running ? "Looking at each screen at the widths it is for." : "Nothing to fix. Each screen passed every check."}</p>
        )
      ) : (
        <div className="ld-ck-pass">
          {passed.map(({ frame, p }) => (
            <div key={`${frame.id}:${p}`} className="ld-ck-pr">
              <I.check size={13} />
              <span className="ld-ell">{frame.name}</span>
              <span className="lc-grow" />
              <small>{p}</small>
            </div>
          ))}
          {!passed.length && <p className="ld-note">Nothing has passed yet.</p>}
        </div>
      )}
      {failed.map((f) => (
        <p key={f.id} className="ld-note">
          {f.name} couldn't be checked: {byFrame[f.id].failed}
        </p>
      ))}
      {all.length > 0 && view === "fix" && (
        <div className="ld-ck-foot">
          <span className="ld-ck-q">A fix goes to {fixerName()}</span>
          <span className="lc-grow" />
          <button type="button" className="lc-btn" data-kind="ink" data-size="sm" disabled={busy[0]} onClick={() => (busy[1](true), void fixAll().finally(() => busy[1](false)))} title={`${all.length} things to fix in ${plural(frames, "frame")}`}>
            Fix all {all.length}
          </button>
        </div>
      )}
    </div>
  );
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
              <div className="ld-ck-spot-list" role="list">
                {p.items.map((x) => (
                  <button key={x.f.key} type="button" role="listitem" className="ld-ck-spot-row l-focus" onClick={() => (show(x.f), setOpen(null))}>
                    <span className="ld-ck-n">{x.n}</span>
                    <span className="ld-ell">{x.f.text}</span>
                  </button>
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
  if (!all.length) return null;
  const frames = new Set(all.map((f) => f.frame)).size;
  return (
    <div className="lc-trow ld-ck-row" role="status">
      <span className="ld-ck-n" aria-hidden>
        {all.length}
      </span>
      <span className="lc-trow-t">
        {plural(all.length, "thing")} to fix in {plural(frames, "frame")}
      </span>
      <span className="lc-grow" />
      <button type="button" className="lc-trow-lk l-focus" disabled={busy} onClick={() => (setBusy(true), void fixAll().finally(() => setBusy(false)))}>
        Fix all {all.length}
      </button>
    </div>
  );
}
