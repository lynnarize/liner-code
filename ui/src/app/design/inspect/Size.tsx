/*
  Size: width and height as Fill, Hug or Fixed; opened, the place (X, Y), the size (W, H) and the
  width's least and most.

  How the three are written is a judgement, made by the parent's flow:
  - Fill along a flex parent's main axis is `flex: 1 1 0` (with min 0 so it may shrink); across its
    cross axis it is `align-self: stretch` with the size auto; in a parent that isn't flex (block or
    grid) it is `width: 100%` / `height: 100%`.
  - Hug is `width: fit-content` (auto alone would fill a block parent) and `height: auto`, with
    `flex: none` in a flex parent so it doesn't grow on the main axis.
  - Fixed writes the size it has now, in px.
  Reading it back: inline styles first; with none, a size equal to the parent's content box is Fill,
  text hugs, and the rest is Fixed (a stylesheet's width can't be told from content's).
*/
import type { NodeRead } from "@contracts";
import { Choice, Num, Row, Section } from "./controls";
import { px } from "./css";
import type { Style, Target } from "./target";

type Mode = "fill" | "hug" | "fixed";
type Flow = "down" | "across" | "block";
const MODES = [
  { value: "fill" as const, label: "Fill" },
  { value: "hug" as const, label: "Hug" },
  { value: "fixed" as const, label: "Fixed" },
];

export function flowOf(parent?: NodeRead): Flow {
  const d = parent?.computed.display ?? "";
  if (!/flex/.test(d)) return "block";
  return /column/.test(parent?.computed["flex-direction"] ?? "") ? "down" : "across";
}

function modeOf(n: NodeRead, parent: NodeRead | undefined, axis: "w" | "h"): Mode {
  const prop = axis === "w" ? "width" : "height";
  const v = n.inline[prop];
  const flow = flowOf(parent);
  const main = (flow === "across" && axis === "w") || (flow === "down" && axis === "h");
  const grow = Number(n.inline["flex-grow"] ?? /^\s*(\d+)/.exec(n.inline.flex ?? "")?.[1] ?? 0);
  if (v === "100%" || (main && grow >= 1) || (!main && flow !== "block" && n.inline["align-self"] === "stretch" && (!v || v === "auto"))) return "fill";
  if (v && /^(auto|fit-content|max-content|min-content)$/.test(v)) return "hug";
  if (px(v) !== undefined) return "fixed";
  if (parent) {
    const c = parent.computed;
    const inner = axis === "w" ? parent.rect.w - (px(c["padding-left"]) ?? 0) - (px(c["padding-right"]) ?? 0) : parent.rect.h - (px(c["padding-top"]) ?? 0) - (px(c["padding-bottom"]) ?? 0);
    if (Math.abs((axis === "w" ? n.rect.w : n.rect.h) - inner) <= 1) return "fill";
  }
  if (n.kind === "text" || axis === "h") return n.kind === "image" ? "fixed" : "hug";
  return "fixed";
}

function styleFor(mode: Mode, n: NodeRead, parent: NodeRead | undefined, axis: "w" | "h"): Style {
  const out = styleOf(mode, n, parent, axis);
  // Setting flex sets flex-grow too: a null for it after would take the new flex away again.
  if (typeof out.flex === "string") delete out["flex-grow"];
  return out;
}

function styleOf(mode: Mode, n: NodeRead, parent: NodeRead | undefined, axis: "w" | "h"): Style {
  const prop = axis === "w" ? "width" : "height";
  const flow = flowOf(parent);
  const main = (flow === "across" && axis === "w") || (flow === "down" && axis === "h");
  // Undo what the other modes wrote inline, so one mode is written at a time.
  const clean: Style = {};
  if (n.inline.flex !== undefined || n.inline["flex-grow"] !== undefined) Object.assign(clean, { flex: null, "flex-grow": null });
  if (!main && n.inline["align-self"] === "stretch") clean["align-self"] = null;
  if (mode === "fill") {
    if (flow === "block") return { ...clean, [prop]: "100%" };
    if (main) return { ...clean, flex: "1 1 0", [`min-${prop}`]: "0", [prop]: "auto" };
    return { ...clean, "align-self": "stretch", [prop]: "auto" };
  }
  if (mode === "hug") return { ...clean, [prop]: axis === "w" ? "fit-content" : "auto", ...(main ? { flex: "none" } : {}) };
  return { ...clean, [prop]: `${Math.round(axis === "w" ? n.rect.w : n.rect.h)}px`, ...(main ? { flex: "none" } : {}) };
}

/** Placed by its own left and top (absolute or fixed), so X and Y can move it. */
const placed = (n: NodeRead) => /absolute|fixed/.test(n.computed.position ?? n.inline.position ?? "");

export function Size({ t }: { t: Target }) {
  const { node, parent } = t;
  const w = modeOf(node, parent, "w");
  const h = modeOf(node, parent, "h");
  const same = (axis: "w" | "h") => t.all.every((x) => modeOf(x.node, x === t.all[0] ? parent : undefined, axis) === (axis === "w" ? w : h));
  const pick = (axis: "w" | "h") => (m: Mode) => t.set((n) => styleFor(m, n, n === node ? parent : undefined, axis), `size-${axis}`);
  const can = placed(node);
  // A placed node's left and top, from its own (or, failing that, its place against its parent).
  const move = (axis: "x" | "y") => (v: number, key: string) =>
    t.set((n) => {
      const prop = axis === "x" ? "left" : "top";
      const now = px(n.inline[prop]) ?? px(n.computed[prop]) ?? (axis === "x" ? n.rect.x - (n === node && parent ? parent.rect.x : 0) : n.rect.y - (n === node && parent ? parent.rect.y : 0));
      return { [prop]: `${Math.round(now + v - (axis === "x" ? node.rect.x : node.rect.y))}px` };
    }, key);
  const size = (prop: string) => (v: number, key: string) => t.set({ [prop]: `${v}px` }, key);
  const one = t.all.length === 1;
  return (
    <Section
      id="size"
      title="Size"
      plain={!t.lean}
      more={
        <>
          <Row>
            <Num prefix="X" name="X" value={node.rect.x} mixed={!one} onChange={move("x")} disabled={!can} title={can ? undefined : "Placed by its stack: reorder it in Layers"} />
            <Num prefix="Y" name="Y" value={node.rect.y} mixed={!one} onChange={move("y")} disabled={!can} title={can ? undefined : "Placed by its stack: reorder it in Layers"} />
          </Row>
          <Row>
            <Num prefix="W" name="Width" value={node.rect.w} mixed={!one} min={0} onChange={size("width")} />
            <Num prefix="H" name="Height" value={node.rect.h} mixed={!one} min={0} onChange={size("height")} />
          </Row>
          <Row>
            <Num prefix="Min" name="Least width" value={px(t.value("min-width"))} mixed={t.mixed("min-width")} min={0} onChange={size("min-width")} />
            <Num prefix="Max" name="Most width" value={px(t.value("max-width"))} mixed={t.mixed("max-width")} min={0} onChange={size("max-width")} />
          </Row>
        </>
      }
    >
      <Row label="Width">
        <Choice label="Width" options={MODES} value={same("w") ? w : undefined} onPick={pick("w")} />
      </Row>
      <Row label="Height">
        <Choice label="Height" options={MODES} value={same("h") ? h : undefined} onPick={pick("h")} />
      </Row>
    </Section>
  );
}
