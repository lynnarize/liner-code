/*
  Corners: square, the lean's corners and fully round first; opened, each corner on its own.
  "Full" writes 999px, which rounds any box fully; a radius at least half the shorter side reads
  as Full too.
*/
import { cornerChoices, nearest, written } from "../lean";
import { Num, OffLean, Row, Section, Stops } from "./controls";
import { px } from "./css";
import type { Target } from "./target";

const CORNERS = [
  ["border-top-left-radius", "◜", "Top left corner"],
  ["border-top-right-radius", "◝", "Top right corner"],
  ["border-bottom-right-radius", "◞", "Bottom right corner"],
  ["border-bottom-left-radius", "◟", "Bottom left corner"],
] as const;

export function Corners({ t }: { t: Target }) {
  const each = CORNERS.map(([p]) => px(t.value(p)));
  const all = each.every((v) => v === each[0]) ? each[0] : undefined;
  const half = Math.min(t.node.rect.w, t.node.rect.h) / 2;
  const choices = cornerChoices(t.lean);
  const shown = all === undefined ? undefined : all >= 999 || (all > 0 && all >= half) ? 999 : all;
  const leanValues = choices.map((c) => c.value);
  const off = t.lean && t.lean.corners.length && shown !== undefined && !leanValues.includes(shown);
  const pick = (v: number, key = "corners") => {
    const c = choices.find((x) => x.value === v);
    // The four corners off first, then the shorthand: in the other order the nulls would take it away again.
    t.set({ ...Object.fromEntries(CORNERS.map(([p]) => [p, null])), "border-radius": v === 999 ? "999px" : written(`${v}px`, "corner", t.vars, c?.name) }, key);
  };
  return (
    <Section
      id="corners"
      title="Corners"
      plain={!t.lean}
      more={
        <Row>
          {CORNERS.map(([p, k, name], i) => (
            <Num key={p} prefix={k} name={name} value={each[i]} mixed={t.mixed(p)} min={0} onChange={(v, key) => t.set({ [p]: written(`${v}px`, "corner", t.vars) }, key)} />
          ))}
        </Row>
      }
    >
      {t.lean && (
        <Row>
          <Stops label="Corners" options={choices.map((c) => ({ value: c.value, label: c.label, name: c.name }))} value={shown} onPick={(v) => pick(v)} />
        </Row>
      )}
      {off ? <OffLean why={`A corner of ${shown} isn't one of the lean's.`} act={`Bring it to ${nearest(leanValues, shown!)}`} onAct={() => pick(nearest(leanValues, shown!), "corners-back")} about={{ kind: "corner", value: String(shown), prop: "border-radius" }} /> : null}
    </Section>
  );
}
