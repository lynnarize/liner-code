/*
  Fill: what a node is painted with. First the lean's colours as swatches, with the name of the
  one it is; opened, solid / gradient / picture, the colour as hex and its opacity, and how it
  blends with a picture under it (background-blend-mode). A swatch writes background-color as
  var(--name) when the frame declares that colour, else its hex.
*/
import { colourToken, nearestColour, written } from "../lean";
import { Chip, Choice, Num, OffLean, Row, Section, Select, Swatches, Text } from "./controls";
import { clear, colour, withAlpha } from "./css";
import type { Target } from "./target";

type Kind = "solid" | "gradient" | "picture";
const KINDS = [
  { value: "solid" as const, label: "Solid" },
  { value: "gradient" as const, label: "Gradient" },
  { value: "picture" as const, label: "Picture" },
];
export const BLENDS = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"].map((b) => ({ value: b, label: b === "normal" ? "Normal" : b[0].toUpperCase() + b.slice(1).replace("-", " ") }));

export function Fill({ t }: { t: Target }) {
  const bg = t.value("background-color");
  const img = t.value("background-image");
  const kind: Kind | undefined = img === undefined ? undefined : /url\(/.test(img) ? "picture" : /gradient/.test(img) ? "gradient" : "solid";
  const token = colourToken(t.lean, bg);
  const c = colour(bg);
  const mixed = t.mixed("background-color");
  const none = !mixed && clear(bg) && (!img || img === "none");
  const lean = t.lean?.colours ?? [];
  const off = lean.length && !none && kind === "solid" && !token && c;
  const near = off ? nearestColour(t.lean, bg) : undefined;
  const paint = (hex: string, key: string, name?: string) => t.set({ "background-color": written(hex, "colour", t.vars, name) }, key);
  const setKind = (k: Kind) => {
    if (k === "solid") return t.set({ "background-image": "none" }, "fill-kind");
    if (k === "gradient") return t.set({ "background-image": `linear-gradient(180deg, ${c ? withAlpha(c.hex, c.a) : "#FFFFFF"}, transparent)` }, "fill-kind");
    t.set({ "background-image": "url(../assets/picture.png)", "background-size": "cover", "background-position": "center" }, "fill-kind");
  };
  const name = mixed ? "Mixed" : none ? "None" : token?.name ?? c?.hex ?? "";

  return (
    <Section
      id="fill"
      title="Fill"
      plain={!t.lean}
      more={
        <>
          <Row>
            <Choice label="Fill kind" options={KINDS} value={kind} onPick={setKind} />
          </Row>
          {kind === "gradient" || kind === "picture" ? (
            <Row>
              <Text prefix={kind === "picture" ? "Url" : undefined} name={kind === "picture" ? "Picture" : "Gradient"} mono value={img ?? ""} onChange={(v) => t.set({ "background-image": v || null }, "fill-image")} />
            </Row>
          ) : null}
          <Row>
            <Text prefix="#" name="Colour, hex" mono value={c ? c.hex.slice(1) : ""} onChange={(v) => {
              const h = colour(v.startsWith("#") ? v : `#${v}`);
              if (h) paint(withAlpha(h.hex, c?.a ?? 1), "fill-hex");
            }} />
            <Num prefix="%" name="Opacity of the fill" value={c ? Math.round(c.a * 100) : undefined} min={0} max={100} wide={76} onChange={(v, k) => c && paint(withAlpha(c.hex, v / 100), k)} />
          </Row>
          <Row label="Blend">
            <Select name="Blend with the picture under it" value={t.inline("background-blend-mode") ?? "normal"} options={BLENDS} onChange={(v) => t.set({ "background-blend-mode": v === "normal" ? null : v }, "fill-blend")} />
          </Row>
        </>
      }
    >
      {lean.length ? (
        <Row>
          <Swatches label="The lean's colours" colours={lean} value={token?.name} end={name} onPick={(k) => paint(k.value, "fill", k.name)} />
        </Row>
      ) : (
        <Row>
          <div className="ld-sws">
            <Chip colour={bg ?? "transparent"} name={name || "No fill"} />
            <span className="ld-nm">{name}</span>
          </div>
        </Row>
      )}
      {off && near ? <OffLean why={`The lean's colours don't have ${c.hex}.`} act={`Bring it to ${near.name}`} onAct={() => paint(near.value, "fill-back", near.name)} about={{ kind: "colour", value: c.hex, prop: "background-color" }} /> : null}
    </Section>
  );
}
