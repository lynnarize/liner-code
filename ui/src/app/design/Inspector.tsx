/*
  Liner Design's inspector: the column at the right of the canvas, in the panel's place. Its top
  row holds the tabs (inspect/tabs.ts: Style and HTML here, Build and Checks from later builders; HTML, not "Code", which is the other face's name),
  then the selected layer's name and kind, a body that scrolls, and a foot level with the
  composer that other parts fill (inspect/slots.ts). Which tab is up is kept per window.

  `end` is for the face: what sits at the right of the top row (the column's own toggle).
*/
import { useState, type ReactNode } from "react";
import type { NodeRef } from "@contracts";
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

/** The selected layer's name and kind, or the frame's. */
function Head() {
  const node = useDesign((s) => s.node);
  const count = useDesign((s) => s.sel.filter((x) => x.node).length);
  const frame = useDesign((s) => (s.sel.length === 1 && !s.sel[0].node ? frameOf(s, s.sel[0].frame) : undefined));
  if (!node && !frame) return null;
  return (
    <div className="ld-ish">
      <Glyph kind={node ? node.kind : "frame"} />
      <span className="ld-ish-n">{node ? (count > 1 ? `${node.name} and ${count - 1} more` : node.name) : frame!.name}</span>
      <small>{node ? KIND[node.kind] : "Frame"}</small>
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
  return (
    <aside className="ld-insp" aria-label="Inspector">
      <div className="lc-panel-top lc-stabs ld-insp-top">
        <div className="lc-stabs-row" role="tablist" aria-label="Inspector" onKeyDown={onKey}>
          {TABS.map((t, i) => {
            const n = counts[i];
            const up = t === on;
            return (
              <span key={t.id} className="lc-stab" data-on={up || undefined}>
                <button type="button" role="tab" id={`ld-tab-${t.id}`} aria-selected={up} aria-controls="ld-insp-pane" tabIndex={up ? 0 : -1} className="lc-stab-b l-focus" onClick={() => pick(t.id)}>
                  <span>{t.label}</span>
                  {n ? <span className="lc-stab-n">{n}</span> : null}
                </button>
              </span>
            );
          })}
        </div>
        {end && <span className="ld-insp-end">{end}</span>}
      </div>
      <div className="ld-insp-pane" id="ld-insp-pane" role="tabpanel" aria-labelledby={`ld-tab-${on.id}`}>
        {on.head !== false && <Head />}
        {on.render()}
      </div>
      {FOOT.length > 0 && (
        <div className="ld-insp-foot">
          {FOOT.map((f) => (
            <div key={f.id} className="ld-insp-slot">
              {f.render()}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
