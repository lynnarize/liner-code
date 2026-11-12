/*
  A picture layer's first section: how the picture fits its box (object-fit), where it comes from
  and what it says to someone who can't see it. "Made by / Asked for" (a picture the model drew)
  is a later builder's, in the slot at the top of Style (tabs.ts, STYLE_TOP).
*/
import { Row, Section, Stops, Text } from "./controls";
import type { Target } from "./target";

const FITS = [
  { value: "cover", label: "Crop", name: "Crop to fill the box" },
  { value: "contain", label: "Fit", name: "Fit inside the box" },
  { value: "fill", label: "Stretch", name: "Stretch to the box" },
  { value: "none", label: "None", name: "At its own size" },
];

const attrOf = (html: string, name: string) => new RegExp(`^<[^>]*\\s${name}="([^"]*)"`, "i").exec(html)?.[1] ?? "";

export function Picture({ t }: { t: Target }) {
  const fit = t.value("object-fit") ?? "fill";
  const isImg = /^img$/i.test(t.node.tag);
  const attr = (name: string) => (v: string) => t.ops((n) => [{ id: n.id, attr: { [name]: v || null } }], `attr-${name}`);
  return (
    <Section id="picture" title="Fit" action="open" plain>
      <Row>
        <Stops label="How the picture fits" options={FITS} value={FITS.some((f) => f.value === fit) ? fit : undefined} onPick={(v) => t.set({ "object-fit": v }, "fit")} />
      </Row>
      {isImg && t.all.length === 1 && (
        <>
          <Row label="Source">
            <Text name="Picture source" mono value={attrOf(t.node.html, "src")} onChange={attr("src")} />
          </Row>
          <Row label="Says">
            <Text name="What the picture says, for screen readers" value={attrOf(t.node.html, "alt")} placeholder="What it shows" onChange={attr("alt")} />
          </Row>
        </>
      )}
    </Section>
  );
}
