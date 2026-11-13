/*
  Live frames: the running app itself on the canvas, beside the drawn frames. A live frame is a
  page of a dev server of the session's folder (the ones the Browser panel runs, from launch.json,
  or one already running), through the engine's proxy with the frame's marker (?__liner_frame=1),
  so the frame agent is in it and it is picked, read and laid out as a drawn frame is; its layers
  are the page's own elements.

  A change made in the inspector is applied in the page at once and held (the store's `pending`),
  with where it started ("was 12 in the code") and one press to put it back. Send to code sends one
  ask with every held change: the element (a selector, its text, its outer HTML cut to 400
  characters), the property, from and to, and the file and line when the page says them (a
  data-source attribute a React plugin left); otherwise the agent finds the file itself. The page
  reloads by itself when the change lands (the dev server's hot reload).

  Here too: the server chip in the canvas's top row (which server, Stop and Restart with the
  Browser panel's rules), and "Put the running app on the canvas" for the Frame tool's menu and
  Design Home.
*/
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { DesignFrame, FrameOp, LaunchAsk, LaunchServer, LocalServer, NodeRead, Project } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { getState, rpc, useEngine } from "../engine";
import { I } from "../icons";
import { useLaunch } from "../launch";
import { agentOf } from "../model";
import { Pop, Row, Sep } from "../ui";
import { frames } from "./bridge";
import { askAgent, shownAsk } from "./BuildTab";
import { design, getDesign, subscribeDesign, useDesign, type DesignState } from "./store";
import { STYLE_TOP } from "./inspect/slots";
import "./build.css";

const MARK = "__liner_frame";

/** A live frame's address, split: the port and the path. */
export function partsOf(url?: string): { host: string; port: number; path: string } | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(/^https?:/.test(url) ? url : `http://${url}`);
    const port = Number(u.port);
    if (!port) return undefined;
    return { host: u.hostname, port, path: `${u.pathname}${u.search}${u.hash}` || "/" };
  } catch {
    return undefined;
  }
}

// The proxy's address for each port, asked once a session.
const proxies = new Map<number, Promise<string>>();
const proxyOf = (port: number) => {
  let p = proxies.get(port);
  if (!p) {
    p = rpc("browser.proxy", { port }).then((r) => r.url.replace(/\/$/, ""));
    p.catch(() => proxies.delete(port));
    proxies.set(port, p);
  }
  return p;
};
/** Where the page is, through the proxy, at a path, with or without the frame agent. */
export async function proxied(port: number, path: string, agent = true) {
  const base = await proxyOf(port);
  const [rest, hash = ""] = path.split("#");
  const mark = agent ? `${rest.includes("?") ? "&" : "?"}${MARK}=1` : "";
  return `${base}${rest.startsWith("/") ? rest : `/${rest}`}${mark}${hash ? `#${hash}` : ""}`;
}

/** Frame.tsx: a live frame's src, the page through the proxy with the frame agent in it. */
export function useLiveSrc(frame: DesignFrame) {
  const [src, setSrc] = useState<string | undefined>();
  const at = frame.kind === "live" ? partsOf(frame.url) : undefined;
  useEffect(() => {
    if (!at) return setSrc(undefined);
    let live = true;
    void proxied(at.port, at.path).then((u) => live && setSrc(u), () => live && setSrc(undefined));
    return () => void (live = false);
  }, [at?.port, at?.path]);
  return src;
}

/** Beside a live frame's name: the dot, and its address (or, after the first of a page, what differs: "390 wide", "/station"). */
export function LiveMark({ frame }: { frame: DesignFrame }) {
  const file = useDesign((s) => s.file);
  if (frame.kind !== "live") return null;
  const at = partsOf(frame.url);
  const live = (file?.frames ?? []).filter((f) => f.kind === "live");
  const before = live.slice(0, live.indexOf(frame));
  const same = before.find((f) => f.url === frame.url);
  const host = before.find((f) => partsOf(f.url)?.port === at?.port);
  const text = !at ? (frame.url ?? "") : same ? `${frame.w} wide` : host ? at.path : `localhost:${at.port}${at.path === "/" ? "" : at.path}`;
  return (
    <span className="ld-lmark" title={`The running app: ${frame.url}`}>
      <span className="ld-bdot" aria-hidden />
      {text}
    </span>
  );
}

// Held changes: where each property started, by frame, node and property, read from the node as it was before the first change.
type Was = { inline?: string; shown: string };
const origins: Record<string, Record<string, Record<string, Was>>> = {};
let lastNode: NodeRead | undefined;
let lastPending: DesignState["pending"] = {};
const originFns = new Set<() => void>();
let originRev = 0;

const LONG: Record<string, string> = { padding: "padding-top", margin: "margin-top", "border-radius": "border-top-left-radius", border: "border-top-width", "border-width": "border-top-width", "border-color": "border-top-color", background: "background-color", flex: "width", inset: "top" };
subscribeDesign(() => {
  const s = getDesign();
  if (s.pending !== lastPending) {
    for (const [frame, ops] of Object.entries(s.pending)) {
      const was = lastPending[frame] ?? [];
      for (const op of ops.slice(was.length)) {
        if (!("style" in op)) continue;
        const n = lastNode && lastNode.id === op.id ? lastNode : undefined;
        const at = ((origins[frame] ??= {})[op.id] ??= {});
        for (const k of Object.keys(op.style)) {
          if (at[k]) continue;
          at[k] = { inline: n?.inline[k], shown: n ? (n.inline[k] ?? n.computed[k] ?? n.computed[LONG[k] ?? ""] ?? "") : "" };
        }
      }
    }
    for (const frame of Object.keys(origins)) if (!s.pending[frame]?.length) delete origins[frame];
    lastPending = s.pending;
    originRev++;
    originFns.forEach((f) => f());
  }
  lastNode = s.node;
});
const useOrigins = () => useSyncExternalStore((f) => (originFns.add(f), () => void originFns.delete(f)), () => originRev);

/** The changes held, one per property of a node (what "1 change waiting" counts). */
export function heldOf(s: DesignState) {
  const out: { frame: string; id: string; prop?: string; op: FrameOp }[] = [];
  for (const [frame, ops] of Object.entries(s.pending)) {
    const seen = new Map<string, number>();
    for (const op of ops) {
      const id = "id" in op ? op.id : op.into;
      const props = "style" in op ? Object.keys(op.style) : [undefined];
      for (const prop of props) {
        const k = `${id}\n${prop ?? JSON.stringify(Object.keys(op))}`;
        const was = seen.get(k);
        if (was !== undefined && prop) out[was] = { frame, id, prop, op };
        else if (was === undefined) seen.set(k, out.push({ frame, id, prop, op }) - 1);
        else out.push({ frame, id, prop, op });
      }
    }
  }
  return out;
}
export const pendingCount = (s: DesignState) => heldOf(s).length;

const px = (v?: string) => (v ?? "").replace(/(\d)px\b/g, "$1").trim() || "nothing";
const LABEL: Record<string, string> = { gap: "Spacing", "row-gap": "Spacing", "column-gap": "Spacing", padding: "Padding", "background-color": "Fill", "background-image": "Fill", "border-radius": "Corners", "font-size": "Text size", "font-weight": "Weight", color: "Text colour", "flex-direction": "Flow", width: "Width", height: "Height" };
const nameOfProp = (k: string) => LABEL[k] ?? (k.startsWith("padding") ? "Padding" : k.includes("radius") ? "Corners" : k.charAt(0).toUpperCase() + k.slice(1).replace(/-/g, " "));

/** Takes one held property back: the page gets its own value again, and it no longer waits. */
async function putBack(frame: string, id: string, prop: string) {
  const was = origins[frame]?.[id]?.[prop];
  const keep: FrameOp[] = [];
  for (const op of getDesign().pending[frame] ?? []) {
    if (!("style" in op) || op.id !== id || !(prop in op.style)) {
      keep.push(op);
      continue;
    }
    const { [prop]: _gone, ...rest } = op.style;
    if (Object.keys(rest).length) keep.push({ id: op.id, style: rest });
  }
  await frames.apply(frame, [{ id, style: { [prop]: was?.inline ?? null } }]).catch(() => undefined);
  if (origins[frame]?.[id]) delete origins[frame][id][prop];
  design.keepPending(frame, keep);
  void design.refreshNode();
}

/** Where a node comes from in the project, when the page says: the agent's read, or a source attribute a dev plugin left. */
export function sourceOf(n: Pick<NodeRead, "source" | "html">): { file: string; line?: number } | undefined {
  if (n.source?.file) return n.source;
  const open = n.html.match(/^<[^>]*>/)?.[0] ?? "";
  const attr = (k: string) => open.match(new RegExp(`\\s${k}="([^"]*)"`))?.[1];
  const loc = attr("data-source") ?? attr("data-loc") ?? attr("data-locator") ?? attr("data-component-source");
  if (loc) {
    const m = loc.match(/^(.*?):(\d+)(?::\d+)?$/);
    return m ? { file: m[1], line: Number(m[2]) } : { file: loc };
  }
  const file = attr("data-inspector-relative-path") ?? attr("data-sentry-source-file");
  if (file) {
    const line = Number(attr("data-inspector-line"));
    return line ? { file, line } : { file };
  }
  return undefined;
}

/** A selector a person or an agent can find the element by: its tag, id and classes (none of Liner's own). */
function selectorOf(n: NodeRead) {
  const open = n.html.match(/^<[^>]*>/)?.[0] ?? "";
  const id = open.match(/\sid="([^"]+)"/)?.[1];
  const cls = (open.match(/\sclass="([^"]+)"/)?.[1] ?? "").split(/\s+/).filter(Boolean).slice(0, 4);
  return `${n.tag}${id ? `#${id}` : ""}${cls.map((c) => `.${c}`).join("")}`;
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const clean = (html: string) => html.replace(/\sdata-l="[^"]*"/g, "").replace(/\sdata-liner-[a-z-]+(="[^"]*")?/g, "");

/** Send to code: one ask with every change held on every live frame, then nothing waits. */
export async function sendToCode() {
  const s = getDesign();
  const held = heldOf(s);
  if (!held.length || !s.file) return;
  if (s.scrub !== undefined) return;
  const thread = leadName();
  const byNode = new Map<string, typeof held>();
  for (const h of held) byNode.set(`${h.frame}\n${h.id}`, [...(byNode.get(`${h.frame}\n${h.id}`) ?? []), h]);
  const parts: string[] = [];
  let i = 0;
  for (const [k, list] of byNode) {
    const [frame, id] = k.split("\n");
    const f = s.file.frames.find((x) => x.id === frame);
    const n = await frames.read(frame, id).catch(() => undefined);
    const at = n ? sourceOf(n) : undefined;
    const lines: string[] = [];
    for (const h of list) {
      const op = h.op;
      if ("style" in op && h.prop) lines.push(`   ${h.prop}: ${origins[frame]?.[id]?.[h.prop]?.shown || "not set"} → ${op.style[h.prop] ?? "taken away"}`);
      else if ("text" in op) lines.push(`   its text → “${cut(op.text, 200)}”`);
      else if ("inner" in op) lines.push(`   its text, its marks (bold, links and the like) kept → “${cut(n?.text ?? "", 200)}”`);
      else if ("attr" in op) lines.push(`   attributes: ${Object.entries(op.attr).map(([a, v]) => `${a} → ${v ?? "taken away"}`).join(", ")}`);
      else if ("remove" in op) lines.push("   taken away");
      else if ("move" in op) lines.push("   moved to another place in its parent");
      else if ("insert" in op) lines.push(`   new inside it: ${cut(clean(op.insert), 400)}`);
      else if ("html" in op) lines.push(`   replaced with: ${cut(clean(op.html), 400)}`);
    }
    parts.push(
      [
        `${++i}. ${n ? `\`${selectorOf(n)}\`` : `the element ${id}`}${n?.text ? ` “${cut(n.text, 80)}”` : ""}, on ${f?.url ?? "the page"}${at ? `, from ${at.file}${at.line ? `:${at.line}` : ""}` : ""}`,
        ...lines,
        ...(n ? [`   Its HTML now: ${cut(clean(n.html), 400)}`] : []),
      ].join("\n"),
    );
  }
  const text = [
    `Change the code so the running app shows ${held.length === 1 ? "this change" : "these changes"}. ${held.length === 1 ? "It was" : "They were"} made by hand on the canvas, in a live frame of the app, and ${held.length === 1 ? "is" : "are"} shown there now, but nothing is written to the code yet:`,
    "",
    ...parts,
    "",
    "Find each element in the source (where no file is named, look for it by its classes and text), change only these properties, the way the code already writes its styles (its tokens, classes or components), and leave the rest as it is. The frame reloads by itself when the change lands.",
  ].join("\n");
  const live = [...new Set(held.map((h) => h.frame))].flatMap((id) => s.file?.frames.find((x) => x.id === id) ?? []);
  await askAgent(text, `Sent to ${thread ?? "the agent"}`, shownAsk(`Write ${held.length === 1 ? "the change" : `the ${held.length} changes`} made by hand in ${live.length === 1 ? live[0].name : "the live frames"} into the code`, { kind: "build", label: "Send to code" }, live));
  for (const frame of Object.keys(s.pending)) design.clearPending(frame);
}

/** The session's lead, by name, for what a press says. */
function leadName() {
  const e = getState();
  const t = e.threads.find((x) => x.id === getDesign().threadId);
  return t ? agentOf(t.agent, e.agents, e.providers).name : undefined;
}

/** At the top of Style for a layer of a live frame: where it comes from, what that means, and what's held on it. */
function LiveSection({ frame, node }: { frame: string; node: NodeRead }) {
  const f = useDesign((s) => s.file?.frames.find((x) => x.id === frame));
  const held = useDesign((s) => s.pending[frame]);
  const threadId = useDesign((s) => s.threadId);
  const who = useEngine((s) => {
    const t = s.threads.find((x) => x.id === threadId);
    return t ? agentOf(t.agent, s.agents, s.providers).name : "the agent";
  });
  useOrigins();
  const here = useMemo(() => heldOf(getDesign()).filter((h) => h.frame === frame && h.id === node.id && h.prop), [held, frame, node.id]);
  if (f?.kind !== "live") return null;
  const at = sourceOf(node);
  const open = () => {
    if (!at || !threadId) return;
    design.setFace("code");
    window.setTimeout(() => window.dispatchEvent(new CustomEvent("lc:open-file", { detail: { path: at.file, line: at.line, threadId } })), 60);
  };
  return (
    <div className="ld-live">
      {at && (
        <div className="ld-live-src">
          <I.link size={14} />
          <code className="ld-ell">
            {at.file}
            {at.line ? `:${at.line}` : ""}
          </code>
          <button type="button" className="ld-live-lk l-focus" onClick={open}>
            Open
          </button>
        </div>
      )}
      <p className="ld-live-note">
        This layer is the running app, not a drawing. A change here goes to {who} as a change to {at ? "that file" : "the code"}, and the frame reloads when it lands.
      </p>
      {here.map((h) => (
        <div key={h.prop} className="ld-live-was">
          <span>
            {nameOfProp(h.prop!)} {px("style" in h.op ? (h.op.style[h.prop!] ?? undefined) : undefined)}: was {px(origins[frame]?.[node.id]?.[h.prop!]?.shown)} in the code.
          </span>
          <button type="button" className="ld-live-lk l-focus" onClick={() => void putBack(frame, node.id, h.prop!)}>
            Put it back
          </button>
        </div>
      ))}
    </div>
  );
}

{
  const entry = { id: "live", render: (t: { frame: string; node: NodeRead }) => <LiveSection frame={t.frame} node={t.node} /> };
  const i = STYLE_TOP.findIndex((x) => x.id === "live");
  if (i >= 0) STYLE_TOP[i] = entry;
  else STYLE_TOP.unshift(entry);
}

// The servers a live frame can be of: launch.json's, then what runs on the Mac (the session's and its folder's first).
type Choice = { key: string; name: string; port?: number; launch?: LaunchServer; local?: LocalServer };
function choicesOf(launch: LaunchServer[], ports: LocalServer[]): Choice[] {
  const out: Choice[] = launch.map((l) => ({ key: `l:${l.name}`, name: l.name, port: l.status === "running" ? l.at : undefined, launch: l }));
  const taken = new Set(out.map((c) => c.port).filter(Boolean));
  const rank = (p: LocalServer) => (p.owner === "session" ? 0 : p.owner === "project" ? 1 : 2);
  for (const p of [...ports].filter((x) => x.web).sort((a, b) => rank(a) - rank(b))) if (!taken.has(p.port)) out.push({ key: `p:${p.port}`, name: p.process || `localhost:${p.port}`, port: p.port, local: p });
  return out;
}

/** Live / Today from /today; Home from /. */
const nameFor = (path: string) => {
  const seg = path.split(/[?#]/)[0].split("/").filter(Boolean).pop();
  return `Live / ${seg ? seg.charAt(0).toUpperCase() + seg.slice(1).replace(/[-_]+/g, " ") : "Home"}`;
};

/** Adds live frames of a page, at the widths asked for, to a design file of the folder. */
export async function addLive(cwd: string, file: string, port: number, path: string, sizes: ("desktop" | "phone")[]) {
  const p = path.startsWith("/") ? path : `/${path}`;
  const name = nameFor(p);
  for (const size of sizes) {
    const wh = size === "desktop" ? { w: 1280, h: 800 } : { w: 390, h: 844 };
    await rpc("canvas.frame.add", { cwd, file, frame: { name: size === "desktop" ? name : `${name}, ${wh.w}`, ...wh, kind: "live", url: `localhost:${port}${p}` } });
  }
}

/** The list of servers with a path and widths: what "Put the running app on the canvas" opens. */
function Picker({ threadId, onPut, onClose }: { threadId?: string; onPut: (port: number, path: string, sizes: ("desktop" | "phone")[]) => Promise<void>; onClose: () => void }) {
  const [launch] = useLaunch(threadId ?? "");
  const [ports, setPorts] = useState<LocalServer[] | null>(null);
  const [pick, setPick] = useState<string | undefined>();
  const [path, setPath] = useState("/");
  const [sizes, setSizes] = useState<("desktop" | "phone")[]>(["desktop", "phone"]);
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState<{ name: string; ask: LaunchAsk } | null>(null);
  useEffect(() => {
    let live = true;
    void rpc("ports.list", threadId ? { threadId } : {}).then((p) => live && setPorts(p), () => live && setPorts([]));
    return () => void (live = false);
  }, [threadId, launch]);
  const list = choicesOf(threadId ? (launch?.servers ?? []) : [], ports ?? []);
  const chosen = list.find((c) => c.key === pick) ?? list.find((c) => c.port);
  const run = async (name: string, allow?: string) => {
    if (!threadId) return;
    setBusy(true);
    try {
      const s = await rpc("launch.start", { threadId, name, ...(allow ? { allow } : {}) });
      setAsked(s.ask ? { name, ask: s.ask } : null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message.split("\n")[0] : String(e));
    } finally {
      setBusy(false);
    }
  };
  const put = async () => {
    if (!chosen?.port || !sizes.length) return;
    setBusy(true);
    try {
      await onPut(chosen.port, path.trim() || "/", sizes);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const toggle = (k: "desktop" | "phone") => setSizes((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
  return (
    <div className="ld-lpick">
      <div className="ld-lpick-h">The running app on the canvas</div>
      {ports === null ? (
        <div className="ld-lpick-n l-shimmer">Looking for servers</div>
      ) : !list.length ? (
        <div className="ld-lpick-n">No dev server runs for this folder. Start one in the Terminal or the Browser panel, or add it to .claude/launch.json.</div>
      ) : (
        <div className="ld-lpick-l" role="listbox" aria-label="Servers">
          {list.map((c) => (
            <div key={c.key} className="ld-lpick-r" role="option" aria-selected={chosen?.key === c.key} data-on={chosen?.key === c.key || undefined} onClick={() => c.port && setPick(c.key)}>
              <span className="ld-bdot" data-off={!c.port || undefined} aria-hidden />
              <span className="ld-ell">
                <b>{c.name}</b> {c.port ? `localhost:${c.port}` : c.launch?.status === "starting" ? "starting" : "stopped"}
              </span>
              {!c.port && c.launch && (
                <button type="button" className="ld-live-lk l-focus" disabled={busy || Boolean(c.launch.problem) || c.launch.status === "starting"} title={c.launch.problem} onClick={(e) => (e.stopPropagation(), void run(c.launch!.name))}>
                  Run
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {asked && (
        <div className="ld-lpick-ask">
          <span>From .claude/launch.json, this runs:</span>
          <code>{asked.ask.command}</code>
          <div className="ld-bt-a">
            <button type="button" className="lc-btn" data-size="sm" data-kind="ink" disabled={busy} onClick={() => void run(asked.name, asked.ask.key)}>
              Run it
            </button>
            <button type="button" className="lc-btn" data-size="sm" data-kind="ghost" onClick={() => setAsked(null)}>
              Not now
            </button>
          </div>
        </div>
      )}
      <label className="ld-lpick-f">
        <span>Page</span>
        <input className="ld-lpick-in" value={path} spellCheck={false} onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void put()} aria-label="The page's path" />
      </label>
      <div className="ld-lpick-s" role="group" aria-label="Widths">
        {(["desktop", "phone"] as const).map((k) => (
          <button key={k} type="button" className="ld-lpick-c l-focus" aria-pressed={sizes.includes(k)} onClick={() => toggle(k)}>
            {sizes.includes(k) && <I.check size={12} />}
            {k === "desktop" ? "Desktop, 1280" : "Phone, 390"}
          </button>
        ))}
      </div>
      <div className="ld-bt-a ld-lpick-go">
        <button type="button" className="lc-btn" data-size="sm" data-kind="ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="lc-btn" data-size="sm" data-kind="ink" disabled={busy || !chosen?.port || !sizes.length} onClick={() => void put()}>
          Put it on the canvas
        </button>
      </div>
    </div>
  );
}

// The Frame tool's menu opens the picker in the top row's place, where the server chip is.
let pickerOpen = false;
const pickerFns = new Set<() => void>();
export const openLivePicker = (on = true) => ((pickerOpen = on), pickerFns.forEach((f) => f()));
const usePicker = () => useSyncExternalStore((f) => (pickerFns.add(f), () => void pickerFns.delete(f)), () => pickerOpen);

/**
  The canvas's top row: the server the live frames are of (its name and port), with Stop and
  Restart as the Browser panel has them (launch.json's by name; one the session started, Stop
  only; anyone else's, neither), and the picker when it's open.
*/
export function LiveChip() {
  const file = useDesign((s) => s.file);
  const cwd = useDesign((s) => s.cwd);
  const threadId = useDesign((s) => s.threadId);
  const open = usePicker();
  const live = (file?.frames ?? []).filter((f) => f.kind === "live");
  const port = partsOf(live[0]?.url)?.port;
  const [launch, again] = useLaunch(threadId ?? "");
  const [ports, setPorts] = useState<LocalServer[]>([]);
  const [asked, setAsked] = useState<{ name: string; ask: LaunchAsk } | null>(null);
  useEffect(() => {
    if (!port || !threadId) return;
    let on = true;
    void rpc("ports.list", { threadId }).then((p) => on && setPorts(p), () => {});
    return () => void (on = false);
  }, [port, threadId, launch]);
  const server = launch?.servers.find((s) => s.at === port || s.port === port);
  const local = ports.find((p) => p.port === port);
  const up = server ? server.status === "running" : Boolean(local);
  const name = server?.name ?? local?.process ?? "Server";
  const restart = async (allow?: string) => {
    if (!server || !threadId) return;
    try {
      const s = await rpc("launch.restart", { threadId, name: server.name, ...(allow ? { allow } : {}) });
      setAsked(s.ask ? { name: server.name, ask: s.ask } : null);
      again();
    } catch (e) {
      toast.error(e instanceof Error ? e.message.split("\n")[0] : String(e));
    }
  };
  const stop = async () => {
    if (!threadId) return;
    try {
      if (server && server.status !== "stopped") await rpc("launch.stop", { threadId, name: server.name });
      else if (local?.owner) await rpc("ports.stop", { threadId, port: local.port });
      toast(`Stopped ${name}`, { duration: 2000 });
      again();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const put = async (p: number, path: string, sizes: ("desktop" | "phone")[]) => {
    const s = getDesign();
    if (!s.cwd || !s.file || s.scrub !== undefined) return;
    await addLive(s.cwd, s.file.id, p, path, sizes);
    await design.open(s.cwd, s.file.id);
  };
  return (
    <>
      {port && (
        <Pop
          label={`${name} on port ${port}: the server of the live frames`}
          width={260}
          align="end"
          triggerClass="ld-srv"
          trigger={
            <>
              <span className="ld-bdot" data-off={!up || undefined} aria-hidden />
              <span>
                {name} {up ? "on" : "stopped,"} :{port}
              </span>
              <I.chevD size={12} />
            </>
          }
          menu
        >
          {(close) => (
            <>
              <Row title="Put another page on the canvas" icon={<I.plus size={13} />} onPick={() => (close(), openLivePicker())} />
              <Sep />
              {server ? (
                <>
                  <Row title={server.status === "running" ? "Restart" : "Run"} note={server.changed ? "launch.json changed" : undefined} icon={<I.refresh size={13} />} onPick={() => (close(), void restart())} />
                  <Row title="Stop" icon={<I.stop size={9} />} disabled={server.status === "stopped"} onPick={() => (close(), void stop())} />
                </>
              ) : local?.owner ? (
                <Row title="Stop" note={local.process} icon={<I.stop size={9} />} onPick={() => (close(), void stop())} />
              ) : (
                <Row title="Started outside this session" note="Stop it where it runs" disabled />
              )}
            </>
          )}
        </Pop>
      )}
      {asked && (
        <div className="ld-lpick ld-lpick-float" role="dialog" aria-label="Restart the server">
          <div className="ld-lpick-ask">
            <span>From .claude/launch.json, this runs:</span>
            <code>{asked.ask.command}</code>
            <div className="ld-bt-a">
              <button type="button" className="lc-btn" data-size="sm" data-kind="ink" onClick={() => void restart(asked.ask.key)}>
                Run it
              </button>
              <button type="button" className="lc-btn" data-size="sm" data-kind="ghost" onClick={() => setAsked(null)}>
                Not now
              </button>
            </div>
          </div>
        </div>
      )}
      {open && cwd && (
        <div className="ld-lpick-float" role="dialog" aria-label="Put the running app on the canvas">
          <Picker threadId={threadId} onPut={put} onClose={() => openLivePicker(false)} />
        </div>
      )}
    </>
  );
}

/** Design Home's Or row: the running app on the canvas, in a new design file of the project, then opened. */
export function HomeLive({ project, onOpen }: { project: Project; onOpen: (file: string) => Promise<void> }) {
  const put = async (port: number, path: string, sizes: ("desktop" | "phone")[]) => {
    const df = await rpc("canvas.create", { cwd: project.path, title: "The running app" });
    await addLive(project.path, df.id, port, path, sizes);
    await onOpen(df.id);
  };
  return (
    <Pop label="Put the running app on the canvas, live" width={340} triggerClass="lc-under-b l-focus" trigger={<><I.globe size={13} />put the running app on the canvas, live</>}>
      {(close) => <Picker onPut={put} onClose={close} />}
    </Pop>
  );
}
