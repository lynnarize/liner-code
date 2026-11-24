/*
  The Style tab: the selected layer's sections, in the mockup's order. A picture layer leads with
  how it fits; a text has no layout of its own. Sections other parts add for a node's kind come
  first (slots.ts). With a frame selected and nothing in it, the frame's own size; with nothing,
  what a frame is and how to select.
*/
import { FRAME_SIZES } from "@contracts";
import { design, frameOf, useDesign } from "../store";
import { Corners } from "./Corners";
import { Choice, Num, Row, Section } from "./controls";
import { Blur, Shadow, Stroke } from "./Effects";
import { Empty } from "./Empty";
import { Fill } from "./Fill";
import { Layout } from "./Layout";
import { Picture } from "./Picture";
import { Size } from "./Size";
import { STYLE_TOP } from "./slots";
import { useTarget } from "./target";
import { TextInside } from "./Text";

export function StyleTab() {
  const t = useTarget();
  const sel = useDesign((s) => s.sel);
  const waiting = useDesign((s) => sel.some((x) => x.node) && !s.node);
  if (!t) return waiting ? <div className="ld-body" aria-busy /> : sel.length ? <FrameStyle /> : <Empty />;
  const kind = t.node.kind;
  const top = STYLE_TOP.filter((s) => !s.kinds || s.kinds.includes(kind));
  // Text inside shows for a text, and for anything with text somewhere in it (what its texts inherit).
  const text = kind === "text" || Boolean(t.node.text?.trim()) || /> *[^<\s][^<]*</.test(t.node.html);
  return (
    <div className="ld-body">
      {top.map((s) => (
        <div key={s.id}>{s.render(t)}</div>
      ))}
      {kind === "image" ? (
        <>
          <Picture t={t} />
          <Corners t={t} />
          <Size t={t} />
        </>
      ) : (
        <>
          <Size t={t} />
          {kind !== "text" && <Layout t={t} />}
          <Fill t={t} />
          <Corners t={t} />
          {text && <TextInside t={t} />}
        </>
      )}
      <Stroke t={t} />
      <Shadow t={t} />
      <Blur t={t} />
    </div>
  );
}

const PRESETS = [
  { value: "desktop" as const, label: "Desktop" },
  { value: "tablet" as const, label: "Tablet" },
  { value: "phone" as const, label: "Phone" },
];

/** One or more frames on the canvas: size, batch resize, align, and distribute. */
function FrameStyle() {
  const frames = useDesign((s) => {
    const ids = [...new Set(s.sel.map((x) => x.frame))];
    return ids.map((id) => frameOf(s, id)).filter((f): f is NonNullable<typeof f> => Boolean(f));
  });
  if (!frames.length) return <Empty several />;
  if (frames.length > 1) {
    const sameW = frames.every((f) => f.w === frames[0].w) ? frames[0].w : undefined;
    const sameH = frames.every((f) => f.h === frames[0].h) ? frames[0].h : undefined;
    const batch = (fn: (f: (typeof frames)[number], i: number) => { x?: number; y?: number; w?: number; h?: number }) => {
      design.place(frames.map((f, i) => ({ id: f.id, ...fn(f, i) })), { before: frames });
    };
    const align = (how: "left" | "cx" | "right" | "top" | "cy" | "bottom") => {
      const minX = Math.min(...frames.map((f) => f.x));
      const maxX = Math.max(...frames.map((f) => f.x + f.w));
      const minY = Math.min(...frames.map((f) => f.y));
      const maxY = Math.max(...frames.map((f) => f.y + f.h));
      batch((f) => {
        if (how === "left") return { x: minX };
        if (how === "right") return { x: maxX - f.w };
        if (how === "cx") return { x: Math.round((minX + maxX) / 2 - f.w / 2) };
        if (how === "top") return { y: minY };
        if (how === "bottom") return { y: maxY - f.h };
        return { y: Math.round((minY + maxY) / 2 - f.h / 2) };
      });
    };
    const distribute = (axis: "x" | "y") => {
      if (frames.length < 3) return;
      const sorted = [...frames].sort((a, b) => (axis === "x" ? a.x - b.x : a.y - b.y));
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const span = axis === "x" ? last.x + last.w - first.x : last.y + last.h - first.y;
      const sum = sorted.reduce((acc, f) => acc + (axis === "x" ? f.w : f.h), 0);
      const gap = (span - sum) / (sorted.length - 1);
      let cursor = axis === "x" ? first.x : first.y;
      const moves = sorted.map((f) => {
        const pos = Math.round(cursor);
        cursor += (axis === "x" ? f.w : f.h) + gap;
        return axis === "x" ? { id: f.id, x: pos } : { id: f.id, y: pos };
      });
      design.place(moves, { before: frames });
    };
    return (
      <div className="ld-body">
        <Section id="frames-multi" title={`${frames.length} frames`} plain>
          <Row>
            <Num prefix="W" name="Batch frame width" value={sameW} min={40} onChange={(w) => batch(() => ({ w }))} />
            <Num prefix="H" name="Batch frame height" value={sameH} min={40} onChange={(h) => batch(() => ({ h }))} />
          </Row>
          <Row>
            <button type="button" className="lc-btn l-focus" data-kind="plain" data-size="sm" title="Align left edges" onClick={() => align("left")}>Left</button>
            <button type="button" className="lc-btn l-focus" data-kind="plain" data-size="sm" title="Align horizontal centers" onClick={() => align("cx")}>Center H</button>
            <button type="button" className="lc-btn l-focus" data-kind="plain" data-size="sm" title="Align right edges" onClick={() => align("right")}>Right</button>
          </Row>
          <Row>
            <button type="button" className="lc-btn l-focus" data-kind="plain" data-size="sm" title="Align top edges" onClick={() => align("top")}>Top</button>
            <button type="button" className="lc-btn l-focus" data-kind="plain" data-size="sm" title="Align vertical centers" onClick={() => align("cy")}>Center V</button>
            <button type="button" className="lc-btn l-focus" data-kind="plain" data-size="sm" title="Align bottom edges" onClick={() => align("bottom")}>Bottom</button>
          </Row>
          {frames.length >= 3 && (
            <Row>
              <button type="button" className="lc-btn l-focus" data-kind="plain" data-size="sm" title="Distribute horizontally" onClick={() => distribute("x")}>Distribute H</button>
              <button type="button" className="lc-btn l-focus" data-kind="plain" data-size="sm" title="Distribute vertically" onClick={() => distribute("y")}>Distribute V</button>
            </Row>
          )}
        </Section>
      </div>
    );
  }
  const frame = frames[0];
  const preset = PRESETS.find((p) => FRAME_SIZES[p.value].w === frame.w && FRAME_SIZES[p.value].h === frame.h)?.value;
  const place = (patch: { w?: number; h?: number; x?: number; y?: number }) => {
    const before = [frame];
    design.place([{ id: frame.id, ...patch }], { before });
  };
  return (
    <div className="ld-body">
      <Section id="frame" title="Frame" plain>
        <Row>
          <Choice label="Size for" options={PRESETS} value={preset} onPick={(p) => place(FRAME_SIZES[p])} />
        </Row>
        <Row>
          <Num prefix="X" name="X on the canvas" value={frame.x} onChange={(x) => place({ x })} />
          <Num prefix="Y" name="Y on the canvas" value={frame.y} onChange={(y) => place({ y })} />
        </Row>
        <Row>
          <Num prefix="W" name="Frame width" value={frame.w} min={40} onChange={(w) => place({ w })} />
          <Num prefix="H" name="Frame height" value={frame.h} min={40} onChange={(h) => place({ h })} />
        </Row>
      </Section>
      <p className="ld-note">A frame is one HTML file of the design. Click something inside it to style it; double-click goes deeper.</p>
    </div>
  );
}
