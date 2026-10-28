/*
  A page an agent showed you: a chart, a table, a mockup. It runs in a sandboxed frame with no
  network and no way into the app (no same-origin, a strict content policy), sized to what it
  holds. The app's colours reach it as CSS variables, and follow light and dark while it's open.
*/
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Item } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { I } from "./icons";
import { cssVar } from "./Surfaces";

const VARS: [string, string][] = [
  ["--bg", "--l-bg"],
  ["--surface", "--l-surface"],
  ["--ink", "--l-ink"],
  ["--ink-2", "--l-ink-2"],
  ["--ink-3", "--l-ink-3"],
  ["--line", "--l-line-2"],
  ["--accent", "--l-accent"],
  ["--font", "--l-font-body"],
  ["--font-mono", "--l-font-mono"],
];
const theme = () => Object.fromEntries(VARS.map(([k, from]) => [k, cssVar(from)]));

/** The page as the frame loads it: the theme first, then what the agent wrote, then a line that reports its height. */
function documentOf(id: string, html: string, vars: Record<string, string>) {
  const root = Object.entries(vars)
    .map(([k, v]) => `${k}:${v || "initial"}`)
    .join(";");
  const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:"><style>:root{${root};color-scheme:light dark}html,body{margin:0}body{padding:16px 18px;background:var(--surface);color:var(--ink);font:13.5px/1.55 var(--font),system-ui,sans-serif}table{border-collapse:collapse;font-variant-numeric:tabular-nums}th,td{padding:6px 10px;border-bottom:1px solid var(--line);text-align:left}th{font-weight:500;color:var(--ink-2)}code,pre{font-family:var(--font-mono),ui-monospace,monospace}</style>`;
  const tail = `<script>(()=>{const id=${JSON.stringify(id)};let last=0;const say=()=>{const b=document.body;const h=Math.ceil(b?b.getBoundingClientRect().height+parseFloat(getComputedStyle(b).marginTop)+parseFloat(getComputedStyle(b).marginBottom):document.documentElement.scrollHeight);if(h!==last){last=h;parent.postMessage({__linerPage:id,h},"*")}};new ResizeObserver(say).observe(document.body||document.documentElement);addEventListener("load",say);say();addEventListener("message",(e)=>{if(e.source!==parent||!e.data)return;if(e.data.__linerPing){last=0;say()}if(e.data.__linerTheme)for(const[k,v]of Object.entries(e.data.__linerTheme))document.documentElement.style.setProperty(k,v)})})()</script>`;
  const whole = /<html[\s>]/i.test(html);
  if (!whole) return `<!doctype html><html><head>${head}</head><body>${html}${tail}</body></html>`;
  const withHead = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}${head}`) : html.replace(/<html[^>]*>/i, (m) => `${m}<head>${head}</head>`);
  return /<\/body>/i.test(withHead) ? withHead.replace(/<\/body>/i, `${tail}</body>`) : `${withHead}${tail}`;
}

export function PageCard({ it }: { it: Extract<Item, { kind: "page" }> }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(160);
  const [tall, setTall] = useState(false);
  const doc = useMemo(() => documentOf(it.id, it.html, theme()), [it.id, it.html]);
  // Listening before the frame loads; on load it's asked again, in case its first word came early.
  useLayoutEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || e.data?.__linerPage !== it.id) return;
      setHeight(Math.max(60, Number(e.data.h) || 0));
    };
    window.addEventListener("message", onMsg);
    // Light and dark, and the accent, follow the app without reloading the page.
    const mo = new MutationObserver(() => frame.current?.contentWindow?.postMessage({ __linerTheme: theme() }, "*"));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-accent", "style"] });
    return () => {
      window.removeEventListener("message", onMsg);
      mo.disconnect();
    };
  }, [it.id]);
  const cap = tall ? 2000 : 560;
  return (
    <figure className="lc-page lc-frame">
      <div className="lc-fcard">
        <figcaption className="lc-page-h">
          <I.sparkle size={13} />
          <b>{it.title}</b>
          <span className="lc-grow" />
          {height > 560 && (
            <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" aria-expanded={tall} onClick={() => setTall((t) => !t)}>
              {tall ? "Less" : "All of it"}
            </button>
          )}
          <button
            type="button"
            className="lc-ib l-focus"
            aria-label="Copy the page's HTML"
            title="Copy the HTML"
            onClick={() =>
              void navigator.clipboard
                .writeText(it.html)
                .then(() => toast.success("Copied the page's HTML"))
                .catch(() => toast.error("Couldn't copy it"))
            }
          >
            <I.copy size={13} />
          </button>
        </figcaption>
        <iframe ref={frame} className="lc-page-f" title={it.title} sandbox="allow-scripts" srcDoc={doc} onLoad={() => frame.current?.contentWindow?.postMessage({ __linerPing: 1 }, "*")} style={{ height: Math.min(height, cap) }} />
      </div>
    </figure>
  );
}
