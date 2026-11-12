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

/** A frame on its own: its size on the canvas (the frame's content reflows to it). */
function FrameStyle() {
  const id = useDesign((s) => (s.sel.length === 1 ? s.sel[0].frame : undefined));
  const frame = useDesign((s) => frameOf(s, id));
  if (!frame) return <Empty several />;
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
