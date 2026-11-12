/*
  Text inside: the lean's type styles first (a style is a size, a weight and, when the lean names
  one, a family, a line height and italic); opened, each of those on its own, the alignment and
  the text's colour. On a stack it sets what its texts inherit.
*/
import { colourToken, typeToken, written } from "../lean";
import { Num, OffLean, Row, Section, Select, Stops, Swatches } from "./controls";
import { colour, familyOf, px, splitTop } from "./css";
import type { Style, Target } from "./target";

const WEIGHTS = ["100", "200", "300", "400", "500", "600", "700", "800", "900"].map((w) => ({ value: w, label: w }));
const ALIGNS = [
  { value: "left", label: "Left" },
  { value: "center", label: "Centre" },
  { value: "right", label: "Right" },
];

export function TextInside({ t }: { t: Target }) {
  const lean = t.lean;
  const styles = lean?.type ?? [];
  const token = typeToken(lean, t.node.computed);
  const size = px(t.value("font-size"));
  const lineRaw = t.value("line-height");
  const line = lineRaw === "normal" ? undefined : px(lineRaw) !== undefined && size ? Math.round((px(lineRaw)! / size) * 100) / 100 : undefined;
  const track = t.value("letter-spacing") === "normal" ? 0 : px(t.value("letter-spacing"));
  const family = familyOf(t.value("font-family"));
  const families = [...new Set([...styles.map((s) => s.family).filter((f): f is string => Boolean(f)), ...(family ? [family] : [])])];
  const ink = colourToken(lean, t.value("color"));
  const stack = (f: string) => {
    const rest = splitTop(t.node.computed["font-family"] ?? "").slice(1);
    return [/\s/.test(f) ? `"${f}"` : f, ...(rest.length ? rest : ["sans-serif"])].join(", ");
  };
  const apply = (name: string) => {
    const s = styles.find((x) => x.name === name);
    if (!s) return;
    const style: Style = { "font-size": s.size ? `${s.size}px` : null, "font-weight": String(s.weight ?? 400), "font-style": s.italic ? "italic" : "normal" };
    if (s.family) style["font-family"] = stack(s.family);
    if (s.line) style["line-height"] = s.line;
    t.set(style, "type");
  };
  const sizes = styles.map((s) => s.size).filter((n): n is number => n !== undefined);
  const off = styles.length && size !== undefined && !token && !sizes.includes(size);
  const near = off ? styles.filter((s) => s.size !== undefined).reduce((a, b) => (Math.abs(b.size! - size!) < Math.abs(a.size! - size!) ? b : a)) : undefined;
  const many = styles.length > 5;

  return (
    <Section
      id="text"
      title="Text inside"
      plain={!lean}
      more={
        <>
          {families.length > 0 && (
            <Row>
              <Select name="Family" value={family ?? ""} options={families.map((f) => ({ value: f, label: f }))} onChange={(f) => t.set({ "font-family": stack(f) }, "family")} />
            </Row>
          )}
          <Row>
            <Num prefix="Size" name="Text size" value={size} mixed={t.mixed("font-size")} min={1} onChange={(v, k) => t.set({ "font-size": `${v}px` }, k)} />
            <Select prefix="Weight" name="Weight" value={t.mixed("font-weight") ? "" : t.value("font-weight") ?? "400"} options={WEIGHTS} onChange={(v) => t.set({ "font-weight": v }, "weight")} />
          </Row>
          <Row>
            <Num prefix="Line" name="Line height, times the size" value={line} mixed={t.mixed("line-height")} min={0} step={0.05} onChange={(v, k) => t.set({ "line-height": String(v) }, k)} />
            <Num prefix="Track" name="Tracking, px" value={track} mixed={t.mixed("letter-spacing")} step={0.1} onChange={(v, k) => t.set({ "letter-spacing": v ? `${v}px` : null }, k)} />
          </Row>
          <Row>
            <Stops label="Text alignment" options={ALIGNS} value={/center/.test(t.value("text-align") ?? "") ? "center" : /right|end/.test(t.value("text-align") ?? "") ? "right" : t.value("text-align") ? "left" : undefined} onPick={(v) => t.set({ "text-align": v }, "text-align")} />
          </Row>
          {lean?.colours.length ? (
            <Row>
              <Swatches label="Text colour" colours={lean.colours} value={ink?.name} end={ink?.name ?? colour(t.value("color"))?.hex ?? ""} onPick={(k) => t.set({ color: written(k.value, "colour", t.vars, k.name) }, "text-colour")} />
            </Row>
          ) : null}
        </>
      }
    >
      {styles.length > 0 &&
        (many ? (
          <Row>
            <Select name="Type style" value={token?.name ?? ""} options={styles.map((s) => ({ value: s.name, label: `${s.name}${s.size ? ` · ${s.size}` : ""}` }))} onChange={apply} />
          </Row>
        ) : (
          <Row>
            <Stops label="Type style" options={styles.map((s) => ({ value: s.name, label: s.name, name: `${s.name}${s.size ? `, ${s.size} px` : ""}` }))} value={token?.name} onPick={apply} />
          </Row>
        ))}
      {off && near ? <OffLean why={`Text at ${size} isn't one of the lean's type styles.`} act={`Bring it to ${near.name}`} onAct={() => apply(near.name)} about={{ kind: "type", value: String(size), prop: "font-size" }} /> : null}
    </Section>
  );
}
