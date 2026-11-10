/*
  The Browser surface: your dev server, beside the session. The engine passes the page through
  a small proxy on this Mac, so the page can tell the app what it logs and which element you
  pointed at. A page that needs no server (an index.html) comes straight from the session's
  folder. It opens on its own only what is this session's: a server its agent or its Terminal
  started, one running in its folder, or the folder's own HTML; other servers on the Mac are
  offered, never picked. Pick an element and ask the agent about it; the question goes with the element's
  place in the page and its HTML. Desktop, Tablet and Phone set the page's width; Offline makes
  the page's requests fail the way they would without a network. The ⋯ menu zooms the page and
  shows it light or dark. Where an agent clicks, its pointer glides there and pulses. A launch.json
  entry nobody has said yes to as it is now shows what it runs before it runs: its command, folder,
  environment and port, on a card to run or not.
*/
import { useEffect, useMemo, useRef, useState } from "react";
import type { LaunchAsk, LaunchServer, LocalServer, Thread } from "@contracts";
import { ApprovalCard } from "@liner/pro/approval-card/approval-card";
import { Segmented } from "@liner/components/segmented/segmented";
import { Switch } from "@liner/components/switch/switch";
import { toast } from "@liner/components/toast/toast";
import { bridge, isNative } from "./bridge";
import { onAgentBrowser, useHiddenBrowsers } from "./agentBrowser";
import { rpc, useEngine } from "./engine";
import { I } from "./icons";
import { launchNote, useLaunch } from "./launch";
import { SurfaceNote } from "./Surfaces";
import { EnvLine, PanelHead, Pop } from "./ui";
import * as os from "./os";

type Log = { level: string; text: string; at: number };
type Picked = { selector: string; path: string; text: string; html: string; rect: { x: number; y: number; w: number; h: number } };
type Width = "desktop" | "tablet" | "phone";
const WIDTH: Record<Width, number | null> = { desktop: null, tablet: 820, phone: 390 };

/** What the Browser shows: a page of a local port, or (port null) a page of the session's own folder; `server`, the launch.json server it's of, followed to another port if it moves. */
type Target = { port: number | null; path: string; server?: string };

/** A browser's zoom steps, as Chrome's (T3 Code: preview/PreviewMoreMenu.tsx). */
const ZOOMS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
type Scheme = "system" | "light" | "dark";
/** How long the agent's pointer takes to glide to a point, before the click lands there. */
const GLIDE_MS = 380;
/** A page point the agent acted on, and whether it clicked there (the pulse). seq tells one act from the next. */
type Pointer = { x: number; y: number; click: boolean; seq: number };

const kept = <T,>(key: string, fallback: T, ok: (v: unknown) => boolean): T => {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "null") as unknown;
    return ok(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
};
const keep = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // Shut storage: it lasts until the window closes.
  }
};

/** Ports the engine will pass through (proxy.ts): the rest are refused, so they aren't asked for. */
const servable = (port: number) => port >= 1024 && port <= 65535;

/** "5173", "localhost:5173/notes?x=1", "http://127.0.0.1:3000#/x" → a port and a path; "index.html" or a file's path → a file; anything else stays a link. */
function parseAddress(s: string): { port: number; path: string } | { file: string } | { external: string } | null {
  const v = s.trim();
  if (!v) return null;
  if (/^\d{2,5}$/.test(v)) return servable(Number(v)) ? { port: Number(v), path: "/" } : null;
  const m = /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):(\d{2,5})([/?#].*)?$/i.exec(v);
  if (m) return servable(Number(m[1])) ? { port: Number(m[1]), path: m[2]?.startsWith("/") ? m[2] : `/${m[2] ?? ""}` } : null;
  if (/^file:\/\//i.test(v) || /\.html?(?:[?#].*)?$/i.test(v) || /^\.{0,2}\//.test(v)) return { file: v };
  if (/^https?:\/\//i.test(v) || /^[\w-]+(\.[\w-]+)+/.test(v)) return { external: /^https?:/i.test(v) ? v : `https://${v}` };
  return null;
}

/** The address bar's text for a target. */
const shown = (t: Target) => (t.port === null ? t.path.slice(1) || "index.html" : `localhost:${t.port}${t.path === "/" ? "" : t.path}`);

/**
  The Browsers the app keeps out of sight for sessions an agent drives while they aren't on
  screen. They sit behind the app, see-through, at a desktop size: inside the window, so the
  page's timers and animation frames keep running as they would for you.
*/
export function HiddenBrowsers() {
  const ids = useHiddenBrowsers();
  const all = useEngine((s) => s.threads);
  const sides = useEngine((s) => s.sides);
  const threads = useMemo(() => ids.map((id) => all.find((t) => t.id === id) ?? sides.find((t) => t.id === id)).filter((t): t is Thread => Boolean(t)), [ids, all, sides]);
  if (!threads.length) return null;
  return (
    <div className="lc-br-hidden" aria-hidden inert>
      {threads.map((t) => (
        <BrowserSurface key={t.id} thread={t} agentName="The agent" hidden />
      ))}
    </div>
  );
}

export function BrowserSurface({ thread, agentName, hidden }: { thread: Thread; agentName: string; hidden?: boolean }) {
  // v2: before it, the first open could remember any dev server on the Mac, even another app's.
  const key = `lc:browse:v2:${thread.projectId}`;
  const [ports, setPorts] = useState<LocalServer[] | null>(null);
  const [pages, setPages] = useState<string[]>([]);
  const [target, setTarget] = useState<Target | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) || "null") as Target | null;
    } catch {
      return null;
    }
  });
  // The address the page is served from, with the place it was asked for: another server's isn't shown at this one's path.
  const [served, setServed] = useState<{ at: string | number; url: string } | null>(null);
  const connected = useEngine((s) => s.connected);
  const [address, setAddress] = useState("");
  const [width, setWidth] = useState<Width>("desktop");
  const [offline, setOffline] = useState(false);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [question, setQuestion] = useState("");
  const [logs, setLogs] = useState<Log[]>([]);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [nonce, setNonce] = useState(0);
  /** Pressed to try an address that couldn't be opened: the same one, so `where` alone wouldn't ask again. */
  const [retry, setRetry] = useState(0);
  // A page the proxy couldn't reach, or a port it refused: said in the stage, not waited on.
  const [failed, setFailed] = useState<string | null>(null);
  // The page's zoom and its light or dark, kept per project.
  const [zoom, setZoomState] = useState(() => kept(`lc:browse:zoom:${thread.projectId}`, 1, (v) => typeof v === "number" && ZOOMS.includes(v)));
  const [scheme, setSchemeState] = useState<Scheme>(() => kept(`lc:browse:scheme:${thread.projectId}`, "system", (v) => v === "light" || v === "dark" || v === "system"));
  const setZoom = (z: number) => (setZoomState(z), keep(`lc:browse:zoom:${thread.projectId}`, z));
  const setScheme = (s: Scheme) => (setSchemeState(s), keep(`lc:browse:scheme:${thread.projectId}`, s));
  const zoomBy = (step: 1 | -1) => setZoom(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + step))] ?? 1);
  // Where the agent's pointer is, in page pixels; drawn over the frame while it drives.
  const [pointer, setPointer] = useState<Pointer | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  // The agent at the wheel: the page's answers it waits on, and the loads it waits for.
  const answers = useRef(new Map<string, (r: { ok: boolean; value?: unknown; error?: string }) => void>());
  const loads = useRef(new Set<() => void>());
  const where = target ? (target.port ?? `files:${thread.id}`) : null;
  const proxy = served && served.at === where ? served.url : null;
  const now = useRef({ target, logs, proxy, hidden });
  now.current = { target, logs, proxy, hidden };
  const [driving, setDriving] = useState(0);
  // The folder's launch.json servers: run from here, stopped by the engine while no one looks, back when you do.
  const [launch] = useLaunch(thread.id);
  const servers = launch?.servers ?? [];
  // One you pressed Run on, to open once it answers (and when you pressed); a row a press is under way for ("*": all of them).
  const [opening, setOpening] = useState<{ name: string; at: number } | null>(null);
  const [pressing, setPressing] = useState<string | null>(null);
  const [allServers, setAllServers] = useState(false);
  // A Run or Restart the engine answered with what it would run, waiting on a yes.
  const [asked, setAsked] = useState<{ name: string; again: boolean; ask: LaunchAsk } | null>(null);
  useEffect(() => setAsked(null), [thread.id]);
  // The launch.json server the page is of: by name once opened from the list, else by the port it runs on.
  // A stopped one keeps the port it last ran on, but no longer claims it: what serves there now (your own npm run dev) is the page.
  const shownServer = target?.port != null ? (servers.find((s) => s.name === target.server) ?? servers.find((s) => s.at === target.port && s.status !== "stopped")) : undefined;

  /** What could open: the servers on the Mac (the session's first) and the folder's HTML pages. */
  const look = () =>
    Promise.all([
      rpc("ports.list", { threadId: thread.id }).catch((): LocalServer[] => []),
      rpc("browser.files", { threadId: thread.id })
        .then((f) => f.pages)
        .catch((): string[] => []),
    ]).then(([p, f]) => {
      setPorts(p);
      setPages(f);
      return { p, f };
    });

  /**
    What to open by itself: the page you had open last in this project while its server still
    runs, else a server this session's agent or Terminal started, else one running in its folder,
    else the folder's index.html. Never someone else's server.
  */
  const pick = (p: LocalServer[], f: string[], last: Target | null): Target | null => {
    if (last && (last.port === null ? f.length > 0 : p.some((x) => x.port === last.port))) return last;
    const own = p.find((x) => x.owner === "session" && x.web) ?? p.find((x) => x.owner === "project" && x.web);
    if (own) return { port: own.port, path: "/" };
    return f.length ? { port: null, path: `/${f[0]}` } : null;
  };

  // On opening, and again when a turn ends: it may have made a page or started a server. The
  // folder's own pages have no hot reload, so one that's open reloads then, with the turn's edits.
  // Waiting on you is the middle of a turn, its edits half made; only a turn that's over counts.
  const seen = useRef({ id: "", status: thread.status });
  useEffect(() => {
    const was = seen.current;
    seen.current = { id: thread.id, status: thread.status };
    const busy = (s: Thread["status"]) => s === "running" || s === "waiting";
    if (was.id === thread.id && (busy(thread.status) || !busy(was.status))) return;
    if (was.id === thread.id && now.current.target?.port === null) cmd("reload");
    void look().then(({ p, f }) => setTarget((t) => pick(p, f, t)));
  }, [thread.id, thread.status]);

  useEffect(() => {
    if (!target) return;
    keep(key, target);
    setAddress(shown(target));
    setFailed(null);
    // Asked again after a reconnect: a restarted engine serves from new ports.
    if (!connected) return;
    let live = true;
    void (target.port === null ? rpc("browser.files", { threadId: thread.id }) : rpc("browser.proxy", { port: target.port }))
      .then((r) => live && setServed({ at: where!, url: r.url }))
      .catch((e) => live && setFailed(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [where, connected, retry]);

  // Nothing of this session's open yet: the server you start in the Terminal opens by itself, as
  // the note says it will, without waiting for a turn to end. Not for a Browser kept out of sight.
  const waiting = !target && !hidden;
  useEffect(() => {
    if (!waiting) return;
    let live = true;
    const t = window.setInterval(() => {
      void look().then(({ p, f }) => live && setTarget((now) => now ?? pick(p, f, null)));
    }, 5000);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, [waiting]);

  // What the page says: console lines, where it went, what you picked.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || !e.data?.__liner) return;
      const d = e.data as { kind: string } & Record<string, unknown>;
      probed.current = true;
      if (d.kind === "console") setLogs((l) => [...l.slice(-199), { level: String(d.level), text: String(d.text), at: Number(d.at) }]);
      else if (d.kind === "nav") {
        const path = String(d.path || "/");
        setTarget((t) => (t ? { ...t, path } : t));
        setAddress((a) => (document.activeElement?.classList.contains("lc-br-addr") ? a : shown({ port: now.current.target?.port ?? null, path })));
      } else if (d.kind === "picked") {
        setPicking(false);
        setPicked(d as unknown as Picked);
        setQuestion("");
      } else if (d.kind === "unpicked") setPicking(false);
      else if (d.kind === "agent") {
        const done = answers.current.get(String(d.reqId));
        answers.current.delete(String(d.reqId));
        done?.({ ok: Boolean(d.ok), value: d.value, error: d.error === undefined ? undefined : String(d.error) });
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [target?.port]);

  const cmd = (c: string, extra: Record<string, unknown> = {}) => frame.current?.contentWindow?.postMessage({ __linerCmd: c, ...extra }, "*");
  // The proxy's own note (nothing answers on that port) has no probe in it to hear a reload: it's loaded afresh instead.
  const probed = useRef(false);
  const reload = () => {
    setLogs([]);
    setPicked(null);
    if (probed.current) cmd("reload");
    else {
      setNonce((n) => n + 1);
      setRetry((n) => n + 1);
    }
  };
  // A reload loses the page's state, so offline goes back to it after load.
  const onLoad = () => {
    probed.current = false;
    if (offline) cmd("offline", { on: true });
    // The load took the page's picker with it.
    if (picking) cmd("pick");
    cmd("hello");
    for (const f of loads.current) f();
    loads.current.clear();
  };

  // What an agent asks of the page, through the probe.
  useEffect(() => {
    const page = (op: string, extra: Record<string, unknown> = {}) =>
      new Promise<unknown>((resolve, reject) => {
        const reqId = Math.random().toString(36).slice(2);
        const timer = setTimeout(() => {
          answers.current.delete(reqId);
          reject(new Error("The page didn't answer. Is its dev server running?"));
        }, 8000);
        answers.current.set(reqId, (r) => (clearTimeout(timer), r.ok ? resolve(r.value) : reject(new Error(r.error))));
        frame.current?.contentWindow?.postMessage({ __linerCmd: "agent", op, reqId, ...extra }, "*");
      });
    const loaded = (ms: number) => new Promise<void>((resolve) => {
      const done = () => (clearTimeout(t), resolve());
      const t = setTimeout(() => (loads.current.delete(done), resolve()), ms);
      loads.current.add(done);
    });
    const read = async () => {
      let r = (await page("read")) as Record<string, unknown>;
      // Not laid out yet: the window is in the background, or the frame only just got its size.
      for (let i = 0; i < 10 && r.laidOut === false; i++) {
        await new Promise((ok) => setTimeout(ok, 300));
        r = (await page("read")) as Record<string, unknown>;
      }
      return { ...r, port: now.current.target?.port ?? undefined, errors: now.current.logs.filter((l) => l.level === "error").slice(-10).map((l) => l.text) };
    };
    return onAgentBrowser(thread.id, async (op, args) => {
      if (!args.yours) setDriving(Date.now());
      if (op === "open") {
        const a = parseAddress(String(args.url ?? ""));
        if (!a || "external" in a) throw new Error(`Only pages on ${os.here}: localhost:<port>/<path>, a port, or an HTML file in this session's folder.`);
        // Asked afresh: the engine may have restarted since, with a new proxy for the port.
        const { url, path } = "file" in a ? await rpc("browser.files", { threadId: thread.id, path: a.file }) : { ...(await rpc("browser.proxy", { port: a.port })), path: a.path };
        const wait = loaded(15000);
        setPicked(null);
        setLogs([]);
        setServed({ at: "file" in a ? `files:${thread.id}` : a.port, url });
        setTarget({ port: "file" in a ? null : a.port, path });
        setNonce((n) => n + 1);
        await wait;
        await new Promise((r) => setTimeout(r, 400));
        return read();
      }
      if (op === "read") return read();
      if (op === "click" || op === "type" || op === "press") {
        // The agent's pointer glides to where it acts and pulses on a click (T3 Code:
        // preview/AgentBrowserCursor.tsx). A point on the page is known before the click; for a
        // control, the probe says where it was, when it does (an `at` in its answer).
        const aimed = op === "click" && args.target === undefined && typeof args.x === "number" && typeof args.y === "number" ? { x: args.x, y: args.y } : null;
        const glide = async (at: { x: number; y: number }) => {
          setPointer((p) => ({ ...at, click: false, seq: (p?.seq ?? 0) + 1 }));
          await new Promise((r) => setTimeout(r, GLIDE_MS));
        };
        if (aimed) await glide(aimed);
        const answer = (await page(op, args)) as { at?: { x?: unknown; y?: unknown } } | null | undefined;
        const told = answer?.at && typeof answer.at.x === "number" && typeof answer.at.y === "number" ? { x: answer.at.x, y: answer.at.y } : null;
        const at = aimed ?? told;
        if (at && op !== "press") {
          if (!aimed) await glide(at);
          setPointer((p) => ({ ...at, click: op === "click", seq: (p?.seq ?? 0) + 1 }));
        }
        await new Promise((r) => setTimeout(r, 700));
        return read();
      }
      if (op === "screenshot") {
        if (!isNative()) throw new Error("Screenshots of the Browser need the Liner Code app; this is its preview in a web browser.");
        const f = frame.current?.getBoundingClientRect();
        if (!f) throw new Error("No page is open in the Browser.");
        // Out of sight, the page is drawn again in a window of the shell's own, at the same address and size.
        // Read now, not when the agent first reached it: the panel's other tabs cover a Browser that's still laid out.
        const { proxy: base, target: at, hidden: away } = now.current;
        if (away) return bridge.shotUrl(base && at ? `${base}${at.path}` : frame.current!.src, Math.round(f.width), Math.round(f.height));
        return bridge.snapshot({ x: f.left, y: f.top, width: f.width, height: f.height });
      }
      throw new Error(`The Browser can't ${op}.`);
    });
  }, [thread.id]);
  useEffect(() => {
    if (!driving) return;
    const t = setTimeout(() => setDriving(0), 5000);
    return () => clearTimeout(t);
  }, [driving]);
  // The pointer goes once the agent lets go of the page, or the page changes under it.
  useEffect(() => {
    if (!driving) setPointer(null);
  }, [driving]);
  useEffect(() => setPointer(null), [where, nonce, width, zoom]);
  // Faint between acts: bright for a moment after each, as T3 Code's fades (agentBrowserCursorLogic.ts).
  const [pointerLit, setPointerLit] = useState(false);
  useEffect(() => {
    if (!pointer) return;
    setPointerLit(true);
    const t = setTimeout(() => setPointerLit(false), 900);
    return () => clearTimeout(t);
  }, [pointer?.seq]);

  const go = async (raw: string) => {
    const a = parseAddress(raw);
    if (!a) return toast("Type a port, a local address or a page", { description: "Like 5173, localhost:3000/settings, or index.html" });
    if ("external" in a) {
      bridge.openExternal(a.external);
      return toast("Opened in your browser", { description: `Only pages on ${os.here} open beside the session.` });
    }
    let next: Target;
    try {
      next = "file" in a ? { port: null, path: (await rpc("browser.files", { threadId: thread.id, path: a.file })).path } : a;
    } catch (e) {
      return toast.error(e instanceof Error ? e.message : String(e));
    }
    setPicked(null);
    setLogs([]);
    setFailed(null);
    setTarget(next);
    if (target && next.port === target.port) {
      setNonce((n) => n + 1);
      setRetry((n) => n + 1);
    }
  };

  /** Opens a launch.json server's page, on the port it runs on now. */
  const openServer = (s: LaunchServer) => {
    if (!s.at) return;
    const same = target?.port === s.at;
    setOpening(null);
    setPicked(null);
    setLogs([]);
    setFailed(null);
    setTarget({ port: s.at, path: same && target ? target.path : "/", server: s.name });
    if (same) {
      setNonce((n) => n + 1);
      setRetry((n) => n + 1);
    }
  };
  /**
    Runs one (again, restarting it, when `again`): it opens once it answers. One nobody has said yes
    to as the file says it now runs nothing and comes back with what it would run, for the card;
    the yes sends that back (`allow`), and an entry that changed in between asks again.
  */
  const runServer = async (name: string, again = false, allow?: string) => {
    const at = Date.now();
    setPressing(name);
    try {
      const s = await rpc(again ? "launch.restart" : "launch.start", { threadId: thread.id, name, ...(allow ? { allow } : {}) });
      if (s.ask) return setAsked({ name, again, ask: s.ask });
      setAsked(null);
      if (s.status === "running") openServer(s);
      else setOpening({ name, at });
    } catch (e) {
      const [first, ...rest] = (e instanceof Error ? e.message : String(e)).split("\n");
      toast.error(first, { description: rest.slice(-2).join(" · ") || undefined });
      // Said from the card, it stays up to try again.
      if (allow) throw e;
    } finally {
      setPressing(null);
    }
  };
  /** Stops one, or (no name) every one in the folder; none of them comes back by itself after that. */
  const stopServer = async (name?: string) => {
    setPressing(name ?? "*");
    try {
      const n = await rpc("launch.stop", { threadId: thread.id, name });
      if (!name) toast(n ? `Stopped ${n} ${n === 1 ? "server" : "servers"}` : "No server was running");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setPressing(null);
    }
  };
  // Pressed, it opens once it answers; if it ends first, the row says why.
  useEffect(() => {
    if (!opening) return;
    const s = servers.find((x) => x.name === opening.name);
    if (s?.status === "running") openServer(s);
    else if (!s || (s.status === "stopped" && (s.ended?.at ?? 0) >= opening.at)) setOpening(null);
  }, [opening, launch]);
  // One that moved to another port (taken when it came back) is followed there.
  useEffect(() => {
    if (shownServer?.status === "running" && shownServer.at && target && target.port !== shownServer.at) setTarget({ ...target, port: shownServer.at, server: shownServer.name });
  }, [shownServer?.status, shownServer?.at]);
  // Back up after it stopped (it slept while you were away, or you ran it again): the page loads afresh.
  const upBefore = useRef<{ where: unknown; status?: string }>({ where: null });
  useEffect(() => {
    const was = upBefore.current;
    upBefore.current = { where, status: shownServer?.status };
    if (was.where === where && was.status && was.status !== "running" && shownServer?.status === "running") {
      setFailed(null);
      setNonce((n) => n + 1);
      setRetry((n) => n + 1);
    }
  }, [where, shownServer?.status]);

  // A server the session started, or one running in its folder, can be stopped from here; no other.
  // One of launch.json's stops as launch.json's do, and stays on screen to run again.
  const own = target?.port != null ? ports?.find((p) => p.port === target.port && p.owner) : undefined;
  const stopIt = async () => {
    if (shownServer && shownServer.status !== "stopped") return stopServer(shownServer.name);
    if (!own) return;
    try {
      await rpc("ports.stop", { threadId: thread.id, port: own.port });
      toast(`Stopped localhost:${own.port}`, { description: own.process });
      setServed(null);
      const { p, f } = await look();
      setTarget(pick(p, f, null));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  // Two quick Enters are one question.
  const sending = useRef(false);
  const ask = async () => {
    if (!picked || !question.trim() || !target || sending.current) return;
    sending.current = true;
    const text = `${question.trim()}\n\nAbout the element \`${picked.selector}\` on ${shown(target)} (${picked.path}):\n\n\`\`\`html\n${picked.html}\n\`\`\``;
    try {
      await rpc("thread.send", { id: thread.id, text, mode: thread.status === "running" ? "queue" : undefined });
      toast(`Asked ${agentName}`, { description: picked.selector });
      setPicked(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      sending.current = false;
    }
  };

  const errors = logs.filter((l) => l.level === "error").length;
  const src = useMemo(() => (proxy && target ? `${proxy}${target.path}` : null), [proxy, where, nonce]);
  const w = WIDTH[width];
  // A phone or tablet wider than the panel is drawn smaller, 12px in from the stage's edges all
  // round, so it never runs under them; the page still lays out at the device's own width.
  const [room, setRoom] = useState(0);
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setRoom(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [target !== null]);
  const fit = w && room > 24 ? Math.min(1, (room - 24) / w) : 1;
  // What a page pixel is drawn at: its zoom, times the fit.
  const scale = zoom * fit;

  // Where the ask card sits: under the element, inside the stage. The page's pixels are drawn at its scale.
  const card = useMemo(() => {
    if (!picked || !frame.current || !stage.current) return null;
    const f = frame.current.getBoundingClientRect();
    const s = stage.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(f.left - s.left + picked.rect.x * scale, s.width - 328));
    const below = f.top - s.top + (picked.rect.y + picked.rect.h) * scale + 8;
    const top = below + 150 > s.height ? Math.max(8, f.top - s.top + picked.rect.y * scale - 158) : below;
    return { left, top };
  }, [picked]);
  // The agent's pointer, from page pixels to the stage's, past its scroll.
  const pointerAt = useMemo(() => {
    const st = stage.current;
    if (!pointer || !frame.current || !st) return null;
    const f = frame.current.getBoundingClientRect();
    const s = st.getBoundingClientRect();
    return { left: f.left - s.left + st.scrollLeft + pointer.x * scale, top: f.top - s.top + st.scrollTop + pointer.y * scale };
  }, [pointer, scale]);

  if (!target) {
    // Servers elsewhere on the Mac are offered, the ones that serve a page first, never opened by themselves.
    const others = (ports ?? []).filter((p) => !p.owner).sort((a, b) => Number(b.web) - Number(a.web));
    // What a Run would run, in the list's place until it's answered.
    if (asked)
      return (
        <div className="lc-br-start">
          <div className="lc-br-start-in">
            <RunAsk asked={asked} onYes={() => runServer(asked.name, asked.again, asked.ask.key)} onNo={() => setAsked(null)} />
          </div>
        </div>
      );
    // launch.json lists servers: each a press from running, as Claude Code's Browser lists them.
    if (servers.length > 0)
      return (
        <div className="lc-br-start">
          <div className="lc-br-start-in">
            <LaunchRows servers={allServers ? servers : servers.slice(0, 5)} pressing={pressing} onRun={(n, again) => void runServer(n, again)} onStop={(n) => void stopServer(n)} onOpen={openServer} />
            {servers.length > 5 && (
              <button type="button" className="lc-br-seeall l-focus" onClick={() => setAllServers(!allServers)}>
                {allServers ? "Show fewer" : `See all ${servers.length}`}
              </button>
            )}
            {pages.length > 0 && (
              <span className="lc-br-ports" aria-label="Pages in this folder">
                {pages.slice(0, 4).map((f) => (
                  <button key={f} type="button" className="lc-br-port l-focus" onClick={() => setTarget({ port: null, path: `/${f}` })}>
                    <span className="lc-mono">{f}</span>
                  </button>
                ))}
              </span>
            )}
            <form
              className="lc-br-first"
              onSubmit={(e) => {
                e.preventDefault();
                void go(address);
              }}
            >
              <input className="lc-input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="5173, localhost:3000 or index.html" aria-label="Address" />
              <button type="submit" className="lc-btn" data-kind="ink">
                Open
              </button>
            </form>
          </div>
          <p className="lc-br-start-foot">
            Run a server to preview your app, or enter an address.
            <br />
            Edit this list in .claude/launch.json.
          </p>
        </div>
      );
    return (
      <SurfaceNote
        icon={<I.globe size={20} />}
        title={ports === null ? "Looking for a dev server" : "Nothing of this session's is running yet"}
        action={ports === null ? undefined : (
          <>
            {/* Labelled lists of plain rows, as the panel's other surfaces are: no pills. */}
            {pages.length > 0 && (
              <span className="lc-br-ports" aria-label="Pages in this folder">
                <span className="lc-br-ports-h">Pages in this folder</span>
                {pages.slice(0, 6).map((f) => (
                  <button key={f} type="button" className="lc-br-port l-focus" onClick={() => setTarget({ port: null, path: `/${f}` })}>
                    <span className="lc-mono">{f}</span>
                  </button>
                ))}
              </span>
            )}
            {others.length > 0 && (
              <span className="lc-br-ports" aria-label={`Other servers on ${os.here}`}>
                <span className="lc-br-ports-h">Elsewhere on {os.here}</span>
                {others.slice(0, 6).map((p) => (
                  <button key={p.port} type="button" className="lc-br-port l-focus" onClick={() => setTarget({ port: p.port, path: "/" })}>
                    <span className="lc-mono">:{p.port}</span>
                    <span className="lc-quiet">{p.process}</span>
                  </button>
                ))}
              </span>
            )}
            <form
              className="lc-br-first"
              onSubmit={(e) => {
                e.preventDefault();
                void go(address);
              }}
            >
              <input className="lc-input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="5173, localhost:3000 or index.html" aria-label="Address" />
              <button type="submit" className="lc-btn" data-kind="ink">
                Open
              </button>
            </form>
          </>
        )}
      >
        {ports === null ? null : launch?.error ? launch.error : <>Start the dev server in the Terminal, or ask {agentName} to build a page. Plain HTML opens without one. Servers in .claude/launch.json run from here.</>}
      </SurfaceNote>
    );
  }

  return (
    <div className="lc-br">
      <div className="lc-br-bar">
        <button type="button" className="lc-ib l-focus" aria-label="Back" onClick={() => cmd("back")}>
          <I.chevL size={14} />
        </button>
        <button type="button" className="lc-ib l-focus" aria-label="Forward" onClick={() => cmd("forward")}>
          <I.chevR size={14} />
        </button>
        <button type="button" className="lc-ib l-focus" aria-label="Reload" onClick={reload}>
          <I.refresh size={14} />
        </button>
        <form
          className="lc-br-addrf"
          onSubmit={(e) => {
            e.preventDefault();
            void go(address);
            (document.activeElement as HTMLElement | null)?.blur();
          }}
        >
          <input className="lc-br-addr lc-mono" value={address} onChange={(e) => setAddress(e.target.value)} aria-label="Address" spellCheck={false} />
        </form>
        <button
          type="button"
          className="lc-ib l-focus"
          aria-label={`Pick an element to ask ${agentName} about`}
          title={`Pick an element to ask ${agentName} about`}
          aria-pressed={picking}
          onClick={() => {
            setPicked(null);
            cmd(picking ? "unpick" : "pick");
            setPicking(!picking);
            frame.current?.focus();
          }}
        >
          <I.target size={14} />
        </button>
        {servers.length > 0 && (
          <Pop label="Dev servers" align="end" width={320} triggerClass="lc-ib" trigger={<I.server size={14} />}>
            {(close) => (
              <div className="lc-br-more">
                <PanelHead end={servers.some((s) => s.status !== "stopped") ? `${servers.filter((s) => s.status !== "stopped").length} running` : undefined}>Dev servers</PanelHead>
                <LaunchRows servers={servers} pressing={pressing} onRun={(n, again) => void runServer(n, again)} onStop={(n) => void stopServer(n)} onOpen={(s) => (openServer(s), close())} />
                <div className="lc-br-lfoot">
                  <span className="lc-quiet">From .claude/launch.json</span>
                  {servers.some((s) => s.status !== "stopped" && !s.problem) && (
                    <button type="button" className="lc-btn" data-kind="plain" data-size="sm" disabled={pressing === "*"} onClick={() => void stopServer()}>
                      Stop all
                    </button>
                  )}
                </div>
              </div>
            )}
          </Pop>
        )}
        {(own || (shownServer && shownServer.status !== "stopped")) && (
          <button type="button" className="lc-ib l-focus" aria-label={shownServer ? `Stop ${shownServer.name}` : `Stop localhost:${own!.port}`} title={shownServer ? `Stop ${shownServer.name}` : `Stop localhost:${own!.port} (${own!.process})`} onClick={() => void stopIt()}>
            <I.stop size={12} />
          </button>
        )}
        <button type="button" className="lc-ib l-focus" aria-label="Open in your browser" title="Open in your browser" disabled={target.port === null && !proxy} onClick={() => bridge.openExternal(target.port === null ? `${proxy}${target.path}` : `http://localhost:${target.port}${target.path}`)}>
          <I.external size={14} />
        </button>
        {/* More: the page's zoom, and light or dark (T3 Code: preview/PreviewMoreMenu.tsx). */}
        <Pop label="More for the page" align="end" width={240} triggerClass="lc-ib" trigger={<I.more size={14} />}>
          {() => (
            <div className="lc-br-more">
              <PanelHead end={zoom === 1 ? undefined : `${Math.round(zoom * 100)}%`}>Zoom</PanelHead>
              <div className="lc-br-zoomrow">
                <button type="button" className="lc-ib l-focus" aria-label="Zoom out" disabled={zoom <= ZOOMS[0]} onClick={() => zoomBy(-1)}>
                  <I.minus size={13} />
                </button>
                <button type="button" className="lc-btn" data-kind="plain" data-size="sm" aria-label="Reset the zoom" title="Back to 100%" disabled={zoom === 1} onClick={() => setZoom(1)}>
                  {Math.round(zoom * 100)}%
                </button>
                <button type="button" className="lc-ib l-focus" aria-label="Zoom in" disabled={zoom >= ZOOMS[ZOOMS.length - 1]} onClick={() => zoomBy(1)}>
                  <I.plus size={13} />
                </button>
              </div>
              <PanelHead>Page theme</PanelHead>
              <div className="lc-br-zoomrow">
                <Segmented
                  size="sm"
                  value={scheme}
                  onValueChange={setScheme}
                  options={[
                    { value: "system", label: "As the app" },
                    { value: "light", label: "Light" },
                    { value: "dark", label: "Dark" },
                  ]}
                  aria-label="Page theme"
                />
              </div>
              <p className="lc-pop-foot">The page's prefers-color-scheme follows this, for pages that style both.</p>
            </div>
          )}
        </Pop>
      </div>
      <div className="lc-br-opts">
        <Segmented
          size="sm"
          value={width}
          onValueChange={(v) => setWidth(v)}
          options={[
            { value: "desktop", label: "Desktop" },
            { value: "tablet", label: "Tablet" },
            { value: "phone", label: "Phone" },
          ]}
          aria-label="Page width"
        />
        <span className="lc-grow" />
        <Switch
          size="sm"
          checked={offline}
          onCheckedChange={(on) => {
            setOffline(on);
            cmd("offline", { on });
          }}
          label="Offline"
        />
      </div>
      <div ref={stage} className="lc-br-stage" data-width={width}>
        {/* Over the page rather than in its place, so a No leaves it as it was. */}
        {asked && (
          <div className="lc-br-askover">
            <RunAsk asked={asked} onYes={() => runServer(asked.name, asked.again, asked.ask.key)} onNo={() => setAsked(null)} />
          </div>
        )}
        {shownServer && shownServer.status !== "running" ? (
          // Its server isn't up: why, and a press to run it again, in place of the proxy's "nothing answers".
          <ServerDown server={shownServer} pressing={pressing === shownServer.name} onRun={() => void runServer(shownServer.name)} />
        ) : src ? (
          // Zoomed as a browser zooms: the frame lays out 1/zoom as wide and tall as the box it's
          // shown in, then is drawn at zoom, so the page reflows rather than only growing.
          <div className="lc-br-zoom" style={w ? { width: w * fit } : undefined}>
            <iframe
              // Opened again at the same address (an agent checking its edit), it loads afresh.
              key={`${src}#${nonce}`}
              ref={frame}
              className="lc-br-frame"
              src={src}
              title="Page preview"
              onLoad={onLoad}
              // A frame's color-scheme is what the page inside reads as prefers-color-scheme.
              style={{ width: `${100 / scale}%`, height: `${100 / scale}%`, transform: scale === 1 ? undefined : `scale(${scale})`, colorScheme: scheme === "system" ? undefined : scheme }}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
            />
          </div>
        ) : (
          <div className="lc-diff-wait">
            {failed ? <span className="lc-quiet">{failed}</span> : <span className="l-shimmer">Opening {shown(target)}</span>}
          </div>
        )}
        {pointerAt && pointer && (
          <span className="lc-br-pointer" data-lit={pointerLit || undefined} style={{ transform: `translate3d(${pointerAt.left}px, ${pointerAt.top}px, 0)` }} aria-hidden>
            {pointer.click && <span key={pointer.seq} className="lc-br-pointer-pulse" />}
            <svg width="18" height="18" viewBox="0 0 18 18">
              <path d="M2.5 1.75 15 8.1l-5.6 1.45L6.9 15Z" />
            </svg>
          </span>
        )}
        {picking && <span className="lc-br-hint l-glass">Point at an element and click it. Escape stops.</span>}
        {driving > 0 && !picking && (
          <span className="lc-br-hint lc-br-agent l-glass" role="status">
            <span className="lc-br-agent-dot" aria-hidden />
            {agentName} is using this page
          </span>
        )}
        {picked && card && (
          <div className="lc-br-ask l-glass" style={{ left: card.left, top: card.top }} role="dialog" aria-label={`Ask ${agentName} about this element`}>
            <div className="lc-br-ask-h">
              <span className="lc-code">{picked.selector}</span>
              <span className="lc-quiet lc-br-ask-p">{picked.text ? `“${picked.text.slice(0, 48)}${picked.text.length > 48 ? "…" : ""}”` : picked.path}</span>
              <button type="button" className="lc-ib l-focus" aria-label="Close" onClick={() => setPicked(null)}>
                <I.close size={12} />
              </button>
            </div>
            <input
              className="lc-input"
              autoFocus
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={`Ask ${agentName} about this`}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) void ask();
                if (e.key === "Escape") setPicked(null);
              }}
            />
            <div className="lc-br-ask-f">
              <span className="lc-quiet">Sends the element and where it sits</span>
              <button type="button" className="lc-btn" data-kind="primary" data-size="sm" disabled={!question.trim()} onClick={() => void ask()}>
                Ask {agentName}
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="lc-br-console" data-open={consoleOpen || undefined}>
        <button type="button" className="lc-br-console-h l-focus" aria-expanded={consoleOpen} onClick={() => setConsoleOpen((o) => !o)}>
          <I.chevU size={12} />
          <b>Console</b>
          <span className="lc-quiet">
            {logs.length ? `${logs.length} ${logs.length === 1 ? "line" : "lines"}, ${errors ? `${errors} ${errors === 1 ? "error" : "errors"}` : "no errors"}` : "Nothing yet"}
          </span>
          {!consoleOpen && logs.length > 0 && <span className="lc-mono lc-br-last" data-level={logs[logs.length - 1].level}>{logs[logs.length - 1].text}</span>}
        </button>
        {consoleOpen && (
          <div className="lc-br-logs" role="log" aria-label="Console">
            {logs.length === 0 ? (
              <p className="lc-quiet">What the page logs shows here.</p>
            ) : (
              logs.map((l, i) => (
                <div key={i} className="lc-br-log lc-mono" data-level={l.level}>
                  <time>{new Date(l.at).toLocaleTimeString("en-GB")}</time>
                  <span>{l.text}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** What Run says on an entry that would show what it runs before it does. */
const FIRST = "Shows what it runs first";

/**
  An entry of launch.json before it runs, as the engine would run it: the command, the folder, the
  environment as the file writes it (a variable that changes what runs is said so) and the port.
  High risk (such a variable, or a command that is) holds to run, as an add-on with a program
  holds to allow. `key` makes each ask its own card, so one the file changed under comes up afresh.
*/
function RunAsk({ asked: { name, ask }, onYes, onNo }: { asked: { name: string; ask: LaunchAsk }; onYes: () => Promise<void>; onNo: () => void }) {
  const env = Object.entries(ask.env);
  const high = ask.risk === "high";
  return (
    <ApprovalCard
      key={ask.key}
      className="lc-br-ask"
      ask="From .claude/launch.json"
      title={`Run ${name}?`}
      description="Liner Code hasn't run this entry as it is now."
      icon={<I.server size={16} />}
      risk={ask.risk}
      hold={high}
      fields={[
        { label: "Command", value: <code className="lc-ask-cmd">{ask.command}</code> },
        { label: "Where", value: <code className="lc-ask-cmd">{os.tilde(ask.cwd)}</code> },
        ...(env.length
          ? [
              {
                label: "Environment",
                value: (
                  <span className="lc-br-env">
                    {env.map(([k, v]) => (
                      <span key={k} className="lc-br-envrow">
                        <code className="lc-ask-cmd">
                          <EnvLine k={k} v={v} />
                        </code>
                        {ask.risky?.includes(k) && <span className="lc-br-risky">changes what runs</span>}
                      </span>
                    ))}
                  </span>
                ),
              },
            ]
          : []),
        { label: "Port", value: <span className="l-num">{ask.port}</span> },
      ]}
      approveLabel={high ? "Hold to run" : "Run it"}
      denyLabel="Not now"
      explain={false}
      onApprove={onYes}
      onDeny={onNo}
      approvedText={`Running ${name}`}
      deniedText="Not run"
    />
  );
}

/** The folder's launch.json servers, each a press from running: Run, or once it's on, Restart and Stop; a row that's on opens its page. */
function LaunchRows({ servers, pressing, onRun, onStop, onOpen }: { servers: LaunchServer[]; pressing: string | null; onRun: (name: string, again?: boolean) => void; onStop: (name: string) => void; onOpen: (s: LaunchServer) => void }) {
  return (
    <ul className="lc-br-launch" aria-label="Dev servers">
      {servers.map((s) => {
        const on = s.status !== "stopped";
        const busy = pressing === s.name || pressing === "*";
        const note = launchNote(s);
        return (
          <li key={s.name} className="lc-br-lrow" data-status={s.status} data-bad={(!on && s.ended?.failed) || s.problem ? "" : undefined}>
            <button type="button" className="lc-br-lmain l-focus" disabled={s.status !== "running"} title={s.status === "running" ? `Open localhost:${s.at}` : undefined} onClick={() => onOpen(s)}>
              <I.server size={15} />
              <span className="lc-br-ltext">
                <span className="lc-br-lname">{s.name}</span>
                {note && <span className="lc-br-lnote" title={s.ended?.tail?.slice(-6).join("\n")}>{note}</span>}
              </span>
              <span className="lc-br-lport lc-mono">:{s.at ?? s.port}</span>
            </button>
            {s.status === "running" && (
              <button type="button" className="lc-br-lgo l-focus" data-quiet={s.changed ? undefined : ""} aria-label={`Restart ${s.name}`} title={s.ask ? FIRST : s.changed ? "Restart with launch.json as it is now" : "Restart"} disabled={busy} onClick={() => onRun(s.name, true)}>
                <I.refresh size={13} />
              </button>
            )}
            {on ? (
              <button type="button" className="lc-br-lgo l-focus" aria-label={`Stop ${s.name}`} title="Stop" disabled={busy} onClick={() => onStop(s.name)}>
                {s.status === "starting" && <span className="lc-br-lspin" aria-hidden />}
                <span className="lc-br-lstop" aria-hidden>
                  <I.stop size={10} />
                </span>
              </button>
            ) : (
              <button type="button" className="lc-br-lgo l-focus" aria-label={`Run ${s.name}`} title={s.problem ?? (s.ask ? FIRST : "Run")} disabled={busy || Boolean(s.problem)} onClick={() => onRun(s.name)}>
                {busy ? <span className="lc-br-lspin" aria-hidden /> : <I.play size={14} />}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Where the page would be while its launch.json server is starting or stopped: why, what it last printed when it failed, and Run. */
function ServerDown({ server: s, pressing, onRun }: { server: LaunchServer; pressing: boolean; onRun: () => void }) {
  if (s.status === "starting")
    return (
      <div className="lc-diff-wait">
        <span className="l-shimmer">Starting {s.name}</span>
      </div>
    );
  const why = s.asleep ? "It stopped while no session in this folder was on screen. It starts again in a moment." : (s.ended?.reason.split("\n")[0] ?? "It isn't running.");
  return (
    <div className="lc-br-down">
      <I.server size={20} />
      <b>{s.name} isn't running</b>
      <p>{why}</p>
      {s.ended?.failed && s.ended.tail?.length ? <pre className="lc-br-tail lc-mono">{s.ended.tail.slice(-8).join("\n")}</pre> : null}
      {!s.asleep && (
        <button type="button" className="lc-btn" data-kind="primary" data-size="sm" title={s.ask ? FIRST : undefined} disabled={pressing || Boolean(s.problem)} onClick={onRun}>
          <I.play size={12} />
          Run {s.name}
        </button>
      )}
    </div>
  );
}
