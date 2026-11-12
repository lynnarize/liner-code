/*
  The inspector's own test page, dev only: /src/app/design/inspect/dev.html?ld-mock. It opens the
  Design face's mock (docs/demo/foreshore, store.ts), loads the Desktop frame in a real iframe with
  the real frame agent, gives the Next tide block the mockup's styles, selects it, and draws the
  inspector beside it. Nothing in the app imports this.
*/
import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useRef } from "react";
import "@fontsource-variable/instrument-sans/wdth.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "../../../liner/foundation.css";
import "../../app.css";
import "../../surfaces.css";
import type { TreeNode } from "@contracts";
import { attach, detach, frames } from "../bridge";
import { srcDocOf } from "../Frame";
import { Inspector } from "../Inspector";
import { design, getDesign, useDesign } from "../store";

document.body.classList.add("l-root", "l-scope");
const q = new URLSearchParams(location.search);

const find = (n: TreeNode, test: (n: TreeNode) => boolean): TreeNode | undefined => (test(n) ? n : n.children.map((c) => find(c, test)).find(Boolean));

function Page() {
  const el = useRef<HTMLIFrameElement>(null);
  const html = useDesign((s) => s.html.desktop);
  useEffect(() => {
    void design.open("/mock");
  }, []);
  useEffect(() => {
    const f = el.current;
    if (!f || !html) return;
    attach("desktop", f);
    void (async () => {
      if (q.has("none")) return;
      const root = await frames.tree("desktop");
      const next = find(root, (n) => /next/i.test(n.name) || n.name === "Next");
      if (!next) return console.warn("no next", root);
      const pick = q.get("pick");
      const target = pick ? find(root, (n) => n.name.toLowerCase().includes(pick.toLowerCase())) ?? next : next;
      if (!q.has("raw") && target === next)
        await design.apply("desktop", [{ id: next.id, attr: { "data-name": "Next tide" } }, { id: next.id, style: { display: "flex", "flex-direction": "column", gap: "12px", padding: "24px", "border-radius": "4px", border: "1px solid #C9D6DA", width: "auto", "align-self": "stretch" } }]);
      design.select([{ frame: "desktop", node: target.id }]);
      if (q.has("several")) {
        const other = find(root, (n) => n !== next && n.kind === "stack");
        if (other) design.select([{ frame: "desktop", node: target.id }, { frame: "desktop", node: other.id }]);
      }
    })();
    return () => detach("desktop", f);
  }, [!html]); // eslint-disable-line react-hooks/exhaustive-deps
  // Loaded once: edits reach the frame through the agent, as on the canvas.
  const doc = useMemo(() => (html ? srcDocOf(getDesign().html.desktop ?? "", getDesign().base) : undefined), [!html]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div style={{ display: "flex", gap: 24, height: "100vh", padding: 24, boxSizing: "border-box", background: "var(--lc-ground)" }}>
      <div style={{ borderRadius: 18, background: "var(--lc-paper)", boxShadow: "0 0 0 1px var(--lc-hair)", overflow: "hidden", height: "100%" }}>
        <Inspector />
      </div>
      <div style={{ width: 640, height: 400, overflow: "hidden", borderRadius: 8, boxShadow: "0 0 0 1px var(--lc-hair)" }}>
        {doc && <iframe ref={el} title="Desktop / Today" sandbox="allow-scripts allow-forms" srcDoc={doc} style={{ width: 1280, height: 800, border: 0, transform: "scale(.5)", transformOrigin: "0 0" }} />}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Page />);
