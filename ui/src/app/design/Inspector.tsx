/*
  Liner Design's inspector: the column at the right of the canvas, in the panel's place, drawn in the
  panel's own frame (Pane.tsx) so the two faces read as one app. Its head holds the tabs as the one
  thing it shows (inspect/tabs.ts: Style and HTML here, Build and Checks from later builders; HTML,
  not "Code", which is the other face's name) and the face's Hide at its right end; then the selected
  layer's name and kind as a row, a body that scrolls, and the foot other parts fill (inspect/slots.ts),
  the one ink action of the tab that shows. Which tab is up is kept per window.

  `end` is for the face: what sits at the right of the head (the column's own Hide).
*/
import { useState, type ReactNode } from "react";
import type { NodeRef } from "@contracts";
import { PaneHead, PaneRow } from "../Pane";
import { frameOf, useDesign } from "./store";
import { D } from "./Rail";
import { FOOT } from "./inspect/slots";
import { TABS } from "./inspect/tabs";
import "./inspector.css";

const TAB_KEY = "liner.ld.tab";
const tabAtStart = () => {
  try {
    return sessionStorage.getItem(TAB_KEY) ?? TABS[0].id;
  } catch {
    return TABS[0].id;
  }
};

const KIND: Record<NodeRef["kind"], string> = { stack: "Stack", text: "Text", image: "Picture", box: "Box" };

/** The kind's glyph: the rail's own (Rail.tsx D), so a box, a text, a picture, a stack and a frame look one way in the rail, Layers and here. */
const Glyph = ({ kind }: { kind: NodeRef["kind"] | "frame" }) => (kind === "stack" ? <D.stack /> : kind === "text" ? <D.text /> : kind === "image" ? <D.picture /> : kind === "frame" ? <D.frame /> : <D.box />);

/** The selected layer's name and kind, or the frame's: a body's row, its kind as the value at the right end. */
function Head() {
  const node = useDesign((s) => s.node);
  const count = useDesign((s) => s.sel.filter((x) => x.node).length);
  const frame = useDesign((s) => (s.sel.length === 1 && !s.sel[0].node ? frameOf(s, s.sel[0].frame) : undefined));
  if (!node && !frame) return null;
  return (
    <div className="ld-ish">
      <PaneRow icon={<Glyph kind={node ? node.kind : "frame"} />} value={node ? KIND[node.kind] : "Frame"} quiet>
        {node ? (count > 1 ? `${node.name} and ${count - 1} more` : node.name) : frame!.name}
      </PaneRow>
    </div>
  );
}

export function Inspector({ end }: { end?: ReactNode } = {}) {
  const [tab, setTab] = useState(tabAtStart);
  // The tabs' counts as one string, so panning the canvas doesn't draw the column again.
  const counts = useDesign((s) => TABS.map((t) => t.count?.(s) ?? 0).join(" ")).split(" ").map(Number);
  const on = TABS.find((t) => t.id === tab) ?? TABS[0];
  const pick = (id: string) => {
    setTab(id);
    try {
      sessionStorage.setItem(TAB_KEY, id);
    } catch {
      // kept for this view only
    }
  };
  const onKey = (e: React.KeyboardEvent) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    const i = (TABS.indexOf(on) + step + TABS.length) % TABS.length;
    pick(TABS[i].id);
    (e.currentTarget.querySelectorAll<HTMLElement>("[role=tab]")[i] as HTMLElement | undefined)?.focus();
  };
  // The head as a surface's in the panel: the tab that shows reads as the surface's name, the others quiet beside it, so a
  // press is still all it takes to change tab (a picker would hide Checks' count behind a menu).
  const tabs = (
    <div className="ld-itabs" role="tablist" aria-label="Inspector" onKeyDown={onKey}>
      {TABS.map((t, i) => {
        const n = counts[i];
        const up = t === on;
        return (
          <button key={t.id} type="button" role="tab" id={`ld-tab-${t.id}`} aria-selected={up} aria-controls="ld-insp-pane" tabIndex={up ? 0 : -1} className="ld-itab l-focus" onClick={() => pick(t.id)}>
            {t.label}
            {n ? <span className="ld-itab-n">{n}</span> : null}
          </button>
        );
      })}
    </div>
  );
  return (
    <aside className="ld-insp" aria-label="Inspector">
      <PaneHead name={<span className="ld-sr">Inspector</span>} shows={tabs} tools={end} canvas={false} />
      <div className="ld-insp-pane" id="ld-insp-pane" role="tabpanel" aria-labelledby={`ld-tab-${on.id}`}>
        {on.head !== false && <Head />}
        {on.render()}
      </div>
      {/* Each slot draws its own PaneFoot, or nothing: the tab that shows decides which one has the foot (Checks' Fix all, else Build's). */}
      {FOOT.map((f) => (
        <FootSlot key={f.id} render={f.render} tab={on.id} />
      ))}
    </aside>
  );
}

const FootSlot = ({ render, tab }: { render: (tab: string) => ReactNode; tab: string }) => <>{render(tab)}</>;
