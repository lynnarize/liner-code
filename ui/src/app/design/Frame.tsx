/*
  One frame on the canvas. A drawn frame is its HTML in a sandboxed iframe with no origin (scripts
  and forms only, as the Design surface's withShim gives a design), with the frame agent inlined
  first and a <base> at the design's folder so its pictures and styles load. A live frame is the
  running page through the engine's proxy, which puts the same agent in. Each is drawn at its own
  size and scaled with the canvas's transform, never clipped round or blurred, and stays mounted:
  its document loads again only when the engine says the file changed (a new `rev`), not after
  an edit made here, which the frame already shows.
*/
import { memo, useEffect, useMemo, useRef } from "react";
import type { DesignFrame } from "@contracts";
import { COMPUTED } from "@contracts";
import agent from "../../../../contracts/src/frame-agent.js?raw";
import { attach, detach, reloading } from "./bridge";
import { useLiveSrc } from "./Live";
import { getDesign, useDesign } from "./store";

// The computed properties come from contracts (COMPUTED) with the agent, so the two can't drift.
const SCRIPT = `<script data-liner-agent>window.__linerComputed=${JSON.stringify(COMPUTED)};${agent}</script>`;

/** The frame's document as the iframe gets it: the agent first in its head, and the base its paths are read from. */
export function srcDocOf(html: string, base?: string) {
  const baseTag = base ? `<base data-liner-base href="${base.replace(/\/?$/, "/")}frames/">` : "";
  const head = `${baseTag}${SCRIPT}`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${head}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${head}</head>`);
  return `<!doctype html><html><head>${head}</head><body>${html}</body></html>`;
}

export const Frame = memo(function Frame({ frame, editing, live }: { frame: DesignFrame; editing: boolean; live: boolean }) {
  const el = useRef<HTMLIFrameElement>(null);
  const rev = useDesign((s) => s.rev[frame.id] ?? 0);
  const has = useDesign((s) => s.html[frame.id] !== undefined);
  const base = useDesign((s) => s.base);
  // Read when the frame must load again, not on every edit.
  const doc = useMemo(() => (frame.kind === "drawn" && has ? srcDocOf(getDesign().html[frame.id] ?? "", base) : undefined), [rev, has, base, frame.kind, frame.id]);
  useEffect(() => {
    const f = el.current;
    if (!f) return;
    attach(frame.id, f);
    return () => detach(frame.id, f);
  }, [frame.id]);
  useEffect(() => reloading(frame.id), [doc, frame.url]);
  // A live frame is the page through the engine's proxy, with the frame agent (Live.tsx).
  const src = useLiveSrc(frame);
  return (
    <iframe
      ref={el}
      className="ld-iframe"
      title={frame.name}
      // No allow-same-origin for a drawn frame: it can't reach the app, its storage or its cookies.
      // A live frame keeps its own origin (the proxy's, never the app's), or its dev server's modules don't load.
      sandbox={frame.kind === "live" ? "allow-scripts allow-forms allow-same-origin" : "allow-scripts allow-forms"}
      srcDoc={doc}
      src={src}
      width={frame.w}
      height={frame.h}
      tabIndex={editing ? 0 : -1}
      data-live={live || undefined}
      style={{ width: frame.w, height: frame.h, pointerEvents: editing || live ? "auto" : "none" }}
    />
  );
});
