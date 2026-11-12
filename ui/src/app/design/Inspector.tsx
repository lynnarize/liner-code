/*
  Liner Design's inspector: the column at the right of the canvas, in the panel's place. Its top
  row holds the tabs (inspect/tabs.ts: Style and Code here, Build and Checks from later builders),
  then the selected layer's name and kind, a body that scrolls, and a foot level with the
  composer that other parts fill (inspect/slots.ts). Which tab is up is kept per window.

  `end` is for the face: what sits at the right of the top row (the column's own toggle).
*/
import { useState, type ReactNode } from "react";
import type { NodeRef } from "@contracts";
import { frameOf, useDesign } from "./store";
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

/** The kind's glyph, drawn as the app's icons are (16 grid, 1.5 strokes, round). */
const Glyph = ({ kind }: { kind: NodeRef["kind"] | "frame" }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {kind === "stack" ? (
      <>
        <rect x="3.25" y="3.25" width="9.5" height="3.5" rx="1" />
        <rect x="3.25" y="9.25" width="9.5" height="3.5" rx="1" />
      </>
    ) : kind === "text" ? (
      <path d="M3.75 4.25h8.5M8 4.25v8" />
    ) : kind === "image" ? (
      <>
        <rect x="2.75" y="3.25" width="10.5" height="9.5" rx="1.5" />
        <path d="m3.25 11.25 3-3 2.5 2.5 1.5-1.5 2.5 2.5" />
        <circle cx="10.25" cy="6" r=".9" />
      </>
    ) : kind === "frame" ? (
      <path d="M5.25 2.75v10.5M10.75 2.75v10.5M2.75 5.25h10.5M2.75 10.75h10.5" />
    ) : (
      <rect x="3.25" y="3.25" width="9.5" height="9.5" rx="1.5" />
    )}
  </svg>
);

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
