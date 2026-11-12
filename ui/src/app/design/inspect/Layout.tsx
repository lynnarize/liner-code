/*
  Layout: how a stack lays out what is in it. First the flow (down, across, wrap) and the lean's
  steps for spacing and padding; opened, the nine-dot alignment, the gap and padding as numbers,
  each side's padding and whether it clips.

  Flow is flexbox: Down is `display: flex; flex-direction: column`, Across is `row`, Wrap is `row`
  with `flex-wrap: wrap`. Spacing (the gap) is offered only on a stack, a flex or grid container,
  where it does something; a plain box offers to become a stack first (flowing down, which looks
  the same as before, since block children already stack downwards), and then the spacing shows.
*/
import type { LeanTokens } from "@contracts";
import { nearest, paddingChoices, spacingChoices, written } from "../lean";
import { Num, OffLean, Row, Section, Stops, Toggle } from "./controls";
import { px } from "./css";
import type { Style, Target } from "./target";

type Flow = "down" | "across" | "wrap";
const FLOWS = [
  { value: "down" as const, label: "Down" },
  { value: "across" as const, label: "Across" },
  { value: "wrap" as const, label: "Wrap" },
];
const SIDES = [
  ["padding-top", "T", "Top padding"],
  ["padding-right", "R", "Right padding"],
  ["padding-bottom", "B", "Bottom padding"],
  ["padding-left", "L", "Left padding"],
] as const;
const POS = ["flex-start", "center", "flex-end"] as const;
const ROWS = ["Top", "Middle", "Bottom"];
const COLS = ["left", "centre", "right"];

const isFlex = (d?: string) => Boolean(d && /flex/.test(d));
const isGrid = (d?: string) => Boolean(d && /grid/.test(d));

function flowNow(t: Target): Flow | undefined {
  const d = t.value("display");
  if (!isFlex(d)) return undefined;
  const dir = t.value("flex-direction");
  if (dir === undefined) return undefined;
  if (/column/.test(dir)) return "down";
  return t.value("flex-wrap") === "wrap" ? "wrap" : "across";
}

const posOf = (v?: string) => (!v || /normal|stretch|start|left|baseline/.test(v) ? 0 : /center/.test(v) ? 1 : /end|right/.test(v) ? 2 : undefined);

export function Layout({ t }: { t: Target }) {
  const lean: LeanTokens | undefined = t.lean;
  const flow = flowNow(t);
  const d = t.value("display");
  const laid = isFlex(d) || isGrid(d);
  const gap = px(t.value("gap")?.split(" ")[0]) ?? (laid ? 0 : undefined);
  const pads = SIDES.map(([p]) => px(t.value(p)));
  const pad = pads.every((p) => p === pads[0]) ? pads[0] : undefined;
  const steps = lean?.steps ?? [];
  const spacing = spacingChoices(lean, gap);
  const padding = paddingChoices(lean, pad);
  const step = (v: number) => written(`${v}px`, "space", t.vars);

  const setFlow = (f: Flow) => t.set({ display: "flex", "flex-direction": f === "down" ? "column" : "row", "flex-wrap": f === "wrap" ? "wrap" : null }, "flow");
  const setGap = (v: number, key = "gap") => t.set({ ...(laid ? {} : { display: "flex", "flex-direction": "column" }), gap: step(v) }, key);
  const setPad = (v: number, key = "padding") => t.set({ "padding-top": null, "padding-right": null, "padding-bottom": null, "padding-left": null, padding: step(v) }, key);
  const setSide = (p: string) => (v: number, key: string) => t.set({ [p]: step(v) }, key);

  // Nine dots: down, the rows are the main axis (justify) and the columns the cross (align); across, the other way.
  const across = flow === "across" || flow === "wrap";
  const jc = posOf(t.value("justify-content"));
  const ai = posOf(t.value("align-items"));
  const at = flow ? (across ? { r: ai, c: jc } : { r: jc, c: ai }) : undefined;
  const align = (r: number, c: number) => {
    const main = across ? c : r;
    const cross = across ? r : c;
    const base: Style = flow ? {} : { display: "flex", "flex-direction": "column" };
    t.set({ ...base, "justify-content": POS[main], "align-items": POS[cross] }, "align");
  };

  // Off the lean: spacing or padding that isn't one of the steps.
  const offGap = steps.length && laid && gap !== undefined && gap > 0 && !steps.includes(gap);
  const offPad = steps.length && !offGap && pads.find((p) => p !== undefined && p > 0 && !steps.includes(p));
  const plain = !lean;

  return (
    <Section
      id="layout"
      title="Layout"
      plain={plain}
      more={
        <>
          <Row label="Align" top>
            <div className="ld-g9" role="group" aria-label="Alignment">
              {ROWS.map((rn, r) =>
                COLS.map((cn, c) => {
                  const on = at?.r === r && at?.c === c;
                  return <button key={`${r}${c}`} type="button" className="l-focus" aria-label={r === 1 && c === 1 ? "Centre" : `${rn} ${cn}`} aria-pressed={on} data-across={across || undefined} onClick={() => align(r, c)} />;
                }),
              )}
            </div>
            <div className="ld-col">
              {laid && <Num prefix="Gap" name="Gap" value={gap} mixed={t.mixed("gap")} min={0} onChange={(v, k) => setGap(v, k)} />}
              <Toggle prefix="Clip" name="Clip what overflows" on={/hidden|clip/.test(t.value("overflow") ?? "")} onChange={(on) => t.set({ overflow: on ? "hidden" : null }, "clip")} />
            </div>
          </Row>
          <Row>
            {SIDES.map(([p, k, name], i) => (
              <Num key={p} prefix={k} name={name} value={pads[i]} mixed={t.mixed(p)} min={0} onChange={setSide(p)} />
            ))}
          </Row>
        </>
      }
    >
      <Row label="Flow">
        <Stops label="Flow" options={FLOWS} value={flow} onPick={setFlow} />
      </Row>
      {!laid && (
        <Row label="Spacing">
          <span className="ld-plainbox">
            A plain box: spacing works in a stack.
            <button type="button" className="lc-btn l-focus" data-kind="ghost" data-size="sm" onClick={() => setFlow("down")}>
              Make it a stack
            </button>
          </span>
        </Row>
      )}
      {!plain && (
        <>
          {laid && (
            <Row label="Spacing">
              <Stops label="Spacing" options={spacing.map((s) => ({ value: s, label: String(s) }))} value={gap} onPick={(v) => setGap(v)} />
            </Row>
          )}
          <Row label="Padding">
            <Stops label="Padding" options={padding.map((s) => ({ value: s, label: String(s) }))} value={pad} onPick={(v) => setPad(v)} />
          </Row>
        </>
      )}
      {offGap ? <OffLean why={`A gap of ${gap} isn't one of the lean's steps.`} act={`Bring it to ${nearest(steps, gap!)}`} onAct={() => setGap(nearest(steps, gap!), "gap-back")} about={{ kind: "space", value: String(gap), prop: "gap" }} /> : null}
      {offPad ? <OffLean why={`Padding of ${offPad} isn't one of the lean's steps.`} act={`Bring it to ${nearest(steps, offPad)}`} onAct={() => t.set(Object.fromEntries(SIDES.map(([p], i) => [p, pads[i] !== undefined && !steps.includes(pads[i]!) ? step(nearest(steps, pads[i]!)) : undefined]).filter(([, v]) => v)), "pad-back")} about={{ kind: "space", value: String(offPad), prop: "padding" }} /> : null}
    </Section>
  );
}
