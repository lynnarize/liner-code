/*
  Stroke, Shadow, and Blur and blending: closed adders (a plus) until the node has one, then its
  values and a minus to take it away.

  Stroke is the border, all four sides at once (the one most nodes have; sides that differ show
  the top one). Shadow edits the first of a box-shadow and keeps the rest. Blur and blending is
  the node's opacity, mix-blend-mode and filter: blur(). Taking one away nulls what is inline, and
  writes its "none" too when a stylesheet gave it (an inline null alone would leave that showing).
*/
import { useState } from "react";
import { colourToken, nearestColour, ruleAbout, written } from "../lean";
import { BLENDS } from "./Fill";
import { Chip, Num, OffLean, Row, Section, Select, Text } from "./controls";
import { colour, px, shadowOf, splitTop, withAlpha } from "./css";
import type { Style, Target } from "./target";

const SIDES = ["top", "right", "bottom", "left"];
const BORDER = SIDES.flatMap((s) => [`border-${s}-width`, `border-${s}-style`, `border-${s}-color`]);

export function Stroke({ t }: { t: Target }) {
  const w = px(t.value("border-top-width")) ?? 0;
  const style = t.value("border-top-style");
  const has = w > 0 && style !== undefined && style !== "none";
  const col = t.value("border-top-color");
  const c = colour(col);
  const lean = t.lean;
  const ink = lean?.colours.find((x) => /ink|text|line/i.test(x.name)) ?? lean?.colours[lean.colours.length - 1];
  const add = () => t.set({ border: `1px solid ${ink ? written(ink.value, "colour", t.vars, ink.name) : "currentColor"}` }, "stroke");
  const remove = () =>
    t.set((n): Style => {
      const inline = Object.keys(n.inline).some((p) => p.startsWith("border") && !p.includes("radius"));
      // Its own border goes; a stylesheet's would still show, so that one is said none inline.
      return inline ? { border: null, ...Object.fromEntries(BORDER.map((p) => [p, null])) } : { "border-style": "none" };
    }, "stroke-off");
  const rule = ruleAbout(lean, /\bno\b[^.]*\b(outline|border|stroke)s?\b/i);
  const token = colourToken(lean, col);
  const near = has && lean?.colours.length && !token ? nearestColour(lean, col) : undefined;
  return (
    <Section id="stroke" title="Stroke" action={has ? "remove" : "add"} onAction={has ? remove : add}>
      {has && (
        <>
          <Row>
            <div className="ld-sws">
              <Chip colour={col ?? "transparent"} name={token?.name ?? c?.hex ?? "Stroke colour"} />
              <Text name="Stroke colour, hex" mono value={token?.name ?? c?.hex ?? ""} onChange={(v) => {
                const k = lean?.colours.find((x) => x.name.toLowerCase() === v.toLowerCase());
                const h = colour(k?.value ?? (v.startsWith("#") ? v : `#${v}`));
                if (h) t.set({ "border-color": written(k?.value ?? withAlpha(h.hex, h.a), "colour", t.vars, k?.name) }, "stroke-colour");
              }} />
              <Num prefix="" name="Stroke width" value={w} suffix="px" min={0} wide={64} onChange={(v, k) => t.set({ "border-width": `${v}px`, ...(style === "none" ? { "border-style": "solid" } : {}) }, k)} />
            </div>
          </Row>
          {rule ? (
            <OffLean why={/outline/i.test(rule) ? "The lean draws blocks with no outline." : `The lean says: ${rule}`} act="Take it off" onAct={remove} />
          ) : near ? (
            <OffLean why={`The lean's colours don't have ${c?.hex}.`} act={`Bring it to ${near.name}`} onAct={() => t.set({ "border-color": written(near.value, "colour", t.vars, near.name) }, "stroke-back")} about={c ? { kind: "colour", value: c.hex, prop: "border-color" } : undefined} />
          ) : null}
        </>
      )}
    </Section>
  );
}

export function Shadow({ t }: { t: Target }) {
  const raw = t.value("box-shadow");
  const s = shadowOf(raw);
  const c = colour(s?.colour);
  const write = (patch: Partial<NonNullable<ReturnType<typeof shadowOf>>>, key: string) => {
    const n = { ...(s ?? { x: 0, y: 4, blur: 12, spread: 0, colour: "rgba(0, 0, 0, 0.16)", inset: false }), ...patch };
    const first = `${n.inset ? "inset " : ""}${n.x}px ${n.y}px ${n.blur}px ${n.spread}px ${n.colour}`;
    const rest = raw && raw !== "none" ? splitTop(raw).slice(1) : [];
    t.set({ "box-shadow": [first, ...rest].join(", ") }, key);
  };
  const remove = () => t.set((n) => ({ "box-shadow": n.inline["box-shadow"] !== undefined && !/none/.test(n.computed["box-shadow"] ?? "") ? null : "none" }), "shadow-off");
  const rule = ruleAbout(t.lean, /\bno\b[^.]*\bshadows?\b/i);
  return (
    <Section id="shadow" title="Shadow" action={s ? "remove" : "add"} onAction={s ? remove : () => write({}, "shadow")}>
      {s && (
        <>
          <Row>
            <Num prefix="X" name="Shadow across" value={s.x} onChange={(v, k) => write({ x: v }, k)} />
            <Num prefix="Y" name="Shadow down" value={s.y} onChange={(v, k) => write({ y: v }, k)} />
            <Num prefix="Blur" name="Shadow blur" value={s.blur} min={0} onChange={(v, k) => write({ blur: v }, k)} />
          </Row>
          <Row>
            <Num prefix="Spread" name="Shadow spread" value={s.spread} onChange={(v, k) => write({ spread: v }, k)} />
            <Text prefix="#" name="Shadow colour, hex" mono value={c ? c.hex.slice(1) : ""} onChange={(v) => {
              const h = colour(v.startsWith("#") ? v : `#${v}`);
              if (h) write({ colour: withAlpha(h.hex, c?.a ?? 1) }, "shadow-colour");
            }} />
            <Num prefix="%" name="Shadow opacity" value={c ? Math.round(c.a * 100) : undefined} min={0} max={100} wide={64} onChange={(v, k) => c && write({ colour: withAlpha(c.hex, v / 100) }, k)} />
          </Row>
          {rule && <OffLean why="The lean draws no shadows." act="Take it off" onAct={remove} />}
        </>
      )}
    </Section>
  );
}

const blurOf = (f?: string) => px(/blur\(([^)]*)\)/.exec(f ?? "")?.[1]);

export function Blur({ t }: { t: Target }) {
  const opacity = Number(t.value("opacity") ?? 1);
  const blend = t.value("mix-blend-mode") ?? "normal";
  const filter = t.inline("filter");
  const blur = blurOf(filter);
  const [added, setAdded] = useState(false);
  const has = added || opacity < 1 || blend !== "normal" || blur !== undefined;
  const remove = () => {
    setAdded(false);
    t.set((n) => ({ opacity: n.inline.opacity !== undefined ? null : Number(n.computed.opacity ?? 1) < 1 ? "1" : null, "mix-blend-mode": n.inline["mix-blend-mode"] !== undefined ? null : n.computed["mix-blend-mode"] && n.computed["mix-blend-mode"] !== "normal" ? "normal" : null, filter: null }), "blur-off");
  };
  return (
    <Section id="blur" title="Blur and blending" action={has ? "remove" : "add"} actionLabel={has ? "Take blur and blending off" : "Add blur or blending"} onAction={has ? remove : () => setAdded(true)}>
      {has && (
        <>
          <Row>
            <Num prefix="Opacity" name="Opacity, %" value={Math.round(opacity * 100)} mixed={t.mixed("opacity")} min={0} max={100} suffix="%" onChange={(v, k) => t.set({ opacity: v >= 100 ? null : String(v / 100) }, k)} />
            <Num prefix="Blur" name="Blur, px" value={blur ?? 0} min={0} onChange={(v, k) => t.set({ filter: v ? `${(filter ?? "").replace(/blur\([^)]*\)\s*/, "")} blur(${v}px)`.trim() : (filter ?? "").replace(/blur\([^)]*\)\s*/, "").trim() || null }, k)} />
          </Row>
          <Row label="Blend">
            <Select name="Blend with what is under it" value={t.mixed("mix-blend-mode") ? "" : blend} options={BLENDS} onChange={(v) => t.set({ "mix-blend-mode": v === "normal" ? null : v }, "blend")} />
          </Row>
        </>
      )}
    </Section>
  );
}
