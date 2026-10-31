/*
  The Browser surface: your dev server, beside the session. The engine passes the page through
  a small proxy on this Mac, so the page can tell the app what it logs and which element you
  pointed at. A page that needs no server (an index.html) comes straight from the session's
  folder. It opens on its own only what is this session's: a server its agent or its Terminal
  started, one running in its folder, or the folder's own HTML; other servers on the Mac are
  offered, never picked. Pick an element and ask the agent about it; the question goes with the element's
  place in the page and its HTML. Desktop, Tablet and Phone set the page's width; Offline makes
  the page's requests fail the way they would without a network. The ⋯ menu zooms the page and
  shows it light or dark. Where an agent clicks, its pointer glides there and pulses.
*/
import { useEffect, useMemo, useRef, useState } from "react";
import type { LocalServer, Thread } from "@contracts";
import { Segmented } from "@liner/components/segmented/segmented";
import { Switch } from "@liner/components/switch/switch";
import { toast } from "@liner/components/toast/toast";
import { bridge, isNative } from "./bridge";
import { onAgentBrowser, useHiddenBrowsers } from "./agentBrowser";
import { rpc, useEngine } from "./engine";
import { I } from "./icons";
import { SurfaceNote } from "./Surfaces";
import { PanelHead, Pop } from "./ui";

type Log = { level: string; text: string; at: number };
type Picked = { selector: string; path: string; text: string; html: string; rect: { x: number; y: number; w: number; h: number } };
type Width = "desktop" | "tablet" | "phone";
const WIDTH: Record<Width, number | null> = { desktop: null, tablet: 820, phone: 390 };

/** What the Browser shows: a page of a local port, or (port null) a page of the session's own folder. */
type Target = { port: number | null; path: string };

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

/** "5173", "localhost:5173/notes", "http://127.0.0.1:3000/x" → a port and a path; "index.html" or a file's path → a file; anything else stays a link. */
function parseAddress(s: string): { port: number; path: string } | { file: string } | { external: string } | null {
  const v = s.trim();
  if (!v) return null;
  if (/^\d{2,5}$/.test(v)) return { port: Number(v), path: "/" };
  const m = /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):(\d{2,5})(\/.*)?$/i.exec(v);
  if (m) return { port: Number(m[1]), path: m[2] || "/" };
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
  const [proxy, setProxy] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [width, setWidth] = useState<Width>("desktop");
  const [offline, setOffline] = useState(false);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [question, setQuestion] = useState("");
  const [logs, setLogs] = useState<Log[]>([]);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [nonce, setNonce] = useState(0);
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
  const now = useRef({ target, logs, proxy });
  now.current = { target, logs, proxy };
  const [driving, setDriving] = useState(0);

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

  const where = target ? (target.port ?? `files:${thread.id}`) : null;
  useEffect(() => {
    if (!target) return;
    localStorage.setItem(key, JSON.stringify(target));
    setAddress(shown(target));
    let live = true;
    void (target.port === null ? rpc("browser.files", { threadId: thread.id }) : rpc("browser.proxy", { port: target.port }))
      .then((r) => live && setProxy(r.url))
      .catch((e) => toast.error(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [where]);

  // What the page says: console lines, where it went, what you picked.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || !e.data?.__liner) return;
      const d = e.data as { kind: string } & Record<string, unknown>;
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
  // A reload loses the page's state, so offline goes back to it after load.
  const onLoad = () => {
    if (offline) cmd("offline", { on: true });
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
        if (!a || "external" in a) throw new Error("Only pages on this Mac: localhost:<port>/<path>, a port, or an HTML file in this session's folder.");
        // Asked afresh: the engine may have restarted since, with a new proxy for the port.
        const { url, path } = "file" in a ? await rpc("browser.files", { threadId: thread.id, path: a.file }) : { ...(await rpc("browser.proxy", { port: a.port })), path: a.path };
        const wait = loaded(15000);
        setPicked(null);
        setLogs([]);
        setProxy(url);
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
        const { proxy: base, target: at } = now.current;
        if (hidden) return bridge.shotUrl(base && at ? `${base}${at.path}` : frame.current!.src, Math.round(f.width), Math.round(f.height));
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
      return toast("Opened in your browser", { description: "Only pages on this Mac open beside the session." });
    }
    let next: Target;
    try {
      next = "file" in a ? { port: null, path: (await rpc("browser.files", { threadId: thread.id, path: a.file })).path } : a;
    } catch (e) {
      return toast.error(e instanceof Error ? e.message : String(e));
    }
    setPicked(null);
    setLogs([]);
    setTarget(next);
    if (target && next.port === target.port) setNonce((n) => n + 1);
  };

  // A server the session started, or one running in its folder, can be stopped from here; no other.
  const own = target?.port != null ? ports?.find((p) => p.port === target.port && p.owner) : undefined;
  const stopIt = async () => {
    if (!own) return;
    try {
      await rpc("ports.stop", { threadId: thread.id, port: own.port });
      toast(`Stopped localhost:${own.port}`, { description: own.process });
      setProxy(null);
      const { p, f } = await look();
      setTarget(pick(p, f, null));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const ask = async () => {
    if (!picked || !question.trim() || !target) return;
    const text = `${question.trim()}\n\nAbout the element \`${picked.selector}\` on ${shown(target)} (${picked.path}):\n\n\`\`\`html\n${picked.html}\n\`\`\``;
    try {
      await rpc("thread.send", { id: thread.id, text, mode: thread.status === "running" ? "queue" : undefined });
      toast(`Asked ${agentName}`, { description: picked.selector });
      setPicked(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const errors = logs.filter((l) => l.level === "error").length;
  const src = useMemo(() => (proxy && target ? `${proxy}${target.path}` : null), [proxy, where, nonce]);
  const w = WIDTH[width];

  // Where the ask card sits: under the element, inside the stage. The page's pixels are drawn at its zoom.
  const card = useMemo(() => {
    if (!picked || !frame.current || !stage.current) return null;
    const f = frame.current.getBoundingClientRect();
    const s = stage.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(f.left - s.left + picked.rect.x * zoom, s.width - 328));
    const below = f.top - s.top + (picked.rect.y + picked.rect.h) * zoom + 8;
    const top = below + 150 > s.height ? Math.max(8, f.top - s.top + picked.rect.y * zoom - 158) : below;
    return { left, top };
  }, [picked]);
  // The agent's pointer, from page pixels to the stage's, past its scroll.
  const pointerAt = useMemo(() => {
    const st = stage.current;
    if (!pointer || !frame.current || !st) return null;
    const f = frame.current.getBoundingClientRect();
    const s = st.getBoundingClientRect();
    return { left: f.left - s.left + st.scrollLeft + pointer.x * zoom, top: f.top - s.top + st.scrollTop + pointer.y * zoom };
  }, [pointer, zoom]);

  if (!target) {
    // Servers elsewhere on the Mac are offered, the ones that serve a page first, never opened by themselves.
    const others = (ports ?? []).filter((p) => !p.owner).sort((a, b) => Number(b.web) - Number(a.web));
    return (
      <SurfaceNote icon={<I.globe size={20} />} title={ports === null ? "Looking for a dev server" : "Nothing of this session's is running yet"}>
        {ports === null ? null : (
          <>
            Start the dev server in the Terminal, or ask {agentName} to build a page. Plain HTML opens without one.
            {pages.length > 0 && (
              <span className="lc-br-ports">
                {pages.slice(0, 6).map((f) => (
                  <button key={f} type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => setTarget({ port: null, path: `/${f}` })}>
                    <span className="lc-mono">{f}</span>
                  </button>
                ))}
              </span>
            )}
            {others.length > 0 && (
              <span className="lc-br-ports" aria-label="Other servers on this Mac">
                <span className="lc-quiet">Elsewhere on this Mac</span>
                {others.slice(0, 6).map((p) => (
                  <button key={p.port} type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => setTarget({ port: p.port, path: "/" })}>
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
              <button type="submit" className="lc-btn" data-kind="primary">
                Open
              </button>
            </form>
          </>
        )}
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
        <button type="button" className="lc-ib l-focus" aria-label="Reload" onClick={() => (cmd("reload"), setLogs([]))}>
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
            setPicking((p) => {
              cmd(p ? "unpick" : "pick");
              return !p;
            });
            frame.current?.focus();
          }}
        >
          <I.target size={14} />
        </button>
        {own && (
          <button type="button" className="lc-ib l-focus" aria-label={`Stop localhost:${own.port}`} title={`Stop localhost:${own.port} (${own.process})`} onClick={() => void stopIt()}>
            <I.stop size={12} />
          </button>
        )}
        <button type="button" className="lc-ib l-focus" aria-label="Open in your browser" title="Open in your browser" onClick={() => bridge.openExternal(target.port === null ? `${proxy}${target.path}` : `http://localhost:${target.port}${target.path}`)}>
          <I.external size={14} />
        </button>
        {/* More: the page's zoom, and light or dark (T3 Code: preview/PreviewMoreMenu.tsx). */}
        <Pop label="More for the page" align="end" width={240} triggerClass="lc-ib" trigger={<I.more size={14} />}>
          {() => (
            <div className="lc-br-more">
              <PanelHead end={zoom === 1 ? undefined : `${Math.round(zoom * 100)}%`}>Zoom</PanelHead>
              <div className="lc-br-zoomrow">
                <button type="button" className="lc-ib l-focus" aria-label="Zoom out" disabled={zoom <= ZOOMS[0]} onClick={() => zoomBy(-1)}>
                  <span aria-hidden>−</span>
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
        {src ? (
          // Zoomed as a browser zooms: the frame lays out 1/zoom as wide and tall as the box it's
          // shown in, then is drawn at zoom, so the page reflows rather than only growing.
          <div className="lc-br-zoom" style={w ? { width: w } : undefined}>
            <iframe
              // Opened again at the same address (an agent checking its edit), it loads afresh.
              key={`${src}#${nonce}`}
              ref={frame}
              className="lc-br-frame"
              src={src}
              title="Page preview"
              onLoad={onLoad}
              // A frame's color-scheme is what the page inside reads as prefers-color-scheme.
              style={{ width: `${100 / zoom}%`, height: `${100 / zoom}%`, transform: zoom === 1 ? undefined : `scale(${zoom})`, colorScheme: scheme === "system" ? undefined : scheme }}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
            />
          </div>
        ) : (
          <div className="lc-diff-wait">
            <span className="l-shimmer">Opening {shown(target)}</span>
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
                if (e.key === "Enter") void ask();
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
