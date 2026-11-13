/*
  Compare: the running app laid over a built frame, at the frame's size, with a slider between
  them (the frame to its left, the page to its right). The page comes from the session folder's dev
  server through the Browser panel's proxy, at the path its file suggests (src/pages/today.tsx is
  /today), which can be changed in the head. Fix the differences asks the agent to take a picture
  of each (design_shot for the frame, its browser's screenshot for the page) and make the app match.
  Working out the differences is the agent's job; this version draws no boxes of its own.
*/
import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as PE } from "react";
import type { DesignFrame, LaunchServer, LocalServer } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { rpc } from "../engine";
import { I } from "../icons";
import { askAgent, shownAsk, useBuilds } from "./BuildTab";
import { proxied } from "./Live";
import { getDesign, useDesign } from "./store";
import "./build.css";

type On = { frame: string; port: number; path: string; src: string; split: number };
let on: On | undefined;
const fns = new Set<() => void>();
const tell = () => fns.forEach((f) => f());
/** Which frame is being compared now, for the Build tab's button. */
export const compareOn = { sub: (f: () => void) => (fns.add(f), () => void fns.delete(f)), frame: () => on?.frame };
const useOn = () => useSyncExternalStore(compareOn.sub, () => on);

/** The page a built file most likely is: src/pages/today.tsx → /today, an index → /. */
export function pathFor(file?: string) {
  if (!file) return "/";
  const m = file.replace(/\\/g, "/").replace(/\.[a-z]+$/i, "").match(/(?:pages|routes|app|views|screens)\/(.+)$/i);
  const rest = (m ? m[1] : (file.split("/").pop() ?? "")).replace(/(^|\/)(index|page|\+page|route)$/i, "").replace(/\[[^\]]+\]/g, "1");
  return `/${rest.toLowerCase()}`.replace(/\/+$/, "") || "/";
}

/** The port the app runs on: the folder's launch.json server that runs, else one the session or its folder started. */
async function portOf(threadId: string) {
  const [launch, ports] = await Promise.all([
    rpc("launch.list", { threadId }).then((l) => l.servers, (): LaunchServer[] => []),
    rpc("ports.list", { threadId }).catch((): LocalServer[] => []),
  ]);
  const live = getDesign().file?.frames.find((f) => f.kind === "live")?.url?.match(/:(\d+)/)?.[1];
  if (live) return Number(live);
  return launch.find((s) => s.status === "running")?.at ?? ports.find((p) => p.web && p.owner === "session")?.port ?? ports.find((p) => p.web && p.owner === "project")?.port;
}

/** Lays the running app over a frame (or takes it away, with no frame). */
export async function openCompare(frame?: string, path?: string) {
  if (!frame) {
    on = undefined;
    return tell();
  }
  const s = getDesign();
  // A frame whose file is gone has nothing to lay the app over.
  if (s.file?.frames.find((f) => f.id === frame)?.missing) return void toast("This frame's file is gone, so there's nothing to compare", { duration: 3000 });
  if (!s.threadId) return void toast.error("Compare needs the session's dev server");
  const port = on?.frame === frame && on.port ? on.port : await portOf(s.threadId);
  if (!port) return void toast("No running app to compare with", { description: "Start its dev server in the Browser panel or the Terminal, then press Compare again.", duration: 4000 });
  const b = (await rpc("build.state", { cwd: s.cwd!, file: s.file!.id }).catch(() => [])).find((x) => x.frame === frame);
  const p = path ?? pathFor(b?.file);
  try {
    on = { frame, port, path: p, src: await proxied(port, p, false), split: on?.frame === frame ? on.split : 0.5 };
  } catch (e) {
    return void toast.error(e instanceof Error ? e.message : String(e));
  }
  tell();
}

/** Fix the differences: a picture of each, compared by the agent, the app changed to match. */
export function fixAsk(f: DesignFrame, file: string | undefined, url: string) {
  return [
    `Compare the frame ${f.name} with the running app at ${url}, and make the app match the frame.`,
    `Take a picture of the frame with design_shot, and one of the page at ${f.w} × ${f.h} with your browser tool's screenshot.`,
    `Find where they differ (spacing, sizes, colours, type, what's missing), list the differences numbered, then change ${file ?? "the page's file"} so it matches. Change only what differs.`,
    `When they agree, call design_built for ${f.name}${file ? ` with ${file}` : ""}.`,
  ].join("\n");
}

/** Over a frame on the canvas, in screen pixels: the app at the frame's size, clipped by the slider, and its head. */
export function CompareOver({ frame, box, zoom }: { frame: DesignFrame; box: { left: number; top: number; width: number; height: number }; zoom: number }) {
  const now = useOn();
  const builds = useBuilds();
  const [split, setSplit] = useState(now?.split ?? 0.5);
  const drag = useRef<{ x: number; w: number; s: number } | null>(null);
  const [addr, setAddr] = useState(now?.path ?? "/");
  useEffect(() => {
    if (now) (setSplit(now.split), setAddr(now.path));
  }, [now?.frame, now?.path]);
  const page = useDesign((s) => s.page ?? s.file?.pages[0]?.id);
  if (!now || now.frame !== frame.id || frame.page !== page) return null;
  const down = (e: PE<HTMLElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, w: box.width, s: split };
  };
  const move = (e: PE<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const v = Math.min(1, Math.max(0, d.s + (e.clientX - d.x) / d.w));
    setSplit(v);
    if (on) on.split = v;
  };
  const url = `localhost:${now.port}${now.path === "/" ? "" : now.path}`;
  return (
    <>
      <div className="ld-cmp-head" data-ld-ui style={{ left: box.left, top: box.top - 24, width: Math.max(220, box.width) }} onPointerDown={(e) => e.stopPropagation()}>
        <span className="ld-q">Against the running app</span>
        <input
          className="ld-cmp-addr"
          aria-label="The page to compare with"
          value={addr}
          spellCheck={false}
          onChange={(e) => setAddr(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") void openCompare(frame.id, addr.trim() || "/");
          }}
          onBlur={() => addr.trim() !== now.path && void openCompare(frame.id, addr.trim() || "/")}
        />
        <button type="button" className="ld-live-lk l-focus" onClick={() => void askAgent(fixAsk(frame, builds[frame.id]?.file, `http://${url}`), "Sent: fix the differences", shownAsk(`Make the app at ${url} match ${frame.name}`, { kind: "compare", label: "Fix the differences" }, [frame]))}>
          Fix the differences
        </button>
        <button type="button" className="lc-ib l-focus" aria-label="Stop comparing" title="Stop comparing" onClick={() => void openCompare(undefined)}>
          <I.close size={12} />
        </button>
      </div>
      <div className="ld-cmp" style={box}>
        <div className="ld-cmp-app" style={{ clipPath: `inset(0 0 0 ${split * 100}%)` }}>
          <iframe className="ld-cmp-if" title={`The running app at ${url}`} src={now.src} sandbox="allow-scripts allow-same-origin allow-forms" width={frame.w} height={frame.h} tabIndex={-1} style={{ width: frame.w, height: frame.h, transform: `scale(${zoom})` }} />
        </div>
        <div className="ld-cmp-line" style={{ left: `${split * 100}%` }}>
          <i className="ld-cmp-knob" data-ld-ui role="slider" aria-label="Between the frame and the app" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(split * 100)} tabIndex={0} onPointerDown={down} onPointerMove={move} onPointerUp={() => (drag.current = null)} onKeyDown={(e) => {
            const k = e.key === "ArrowLeft" ? -0.05 : e.key === "ArrowRight" ? 0.05 : 0;
            if (!k) return;
            e.preventDefault();
            e.stopPropagation();
            const v = Math.min(1, Math.max(0, split + k));
            setSplit(v);
            if (on) on.split = v;
          }} />
        </div>
        <span className="ld-cmp-tag" style={{ right: `calc(${(1 - split) * 100}% + 8px)` }}>Design</span>
        <span className="ld-cmp-tag" style={{ left: `calc(${split * 100}% + 8px)` }}>App · localhost:{now.port}</span>
      </div>
    </>
  );
}
