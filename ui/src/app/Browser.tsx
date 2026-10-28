/*
  The Browser surface: your dev server, beside the session. The engine passes the page through
  a small proxy on this Mac, so the page can tell the app what it logs and which element you
  pointed at. Pick an element and ask the agent about it; the question goes with the element's
  place in the page and its HTML. Desktop, Tablet and Phone set the page's width; Offline makes
  the page's requests fail the way they would without a network.
*/
import { useEffect, useMemo, useRef, useState } from "react";
import type { Thread } from "@contracts";
import { Segmented } from "@liner/components/segmented/segmented";
import { Switch } from "@liner/components/switch/switch";
import { toast } from "@liner/components/toast/toast";
import { bridge, isNative } from "./bridge";
import { onAgentBrowser } from "./agentBrowser";
import { rpc } from "./engine";
import { I } from "./icons";
import { SurfaceNote } from "./Surfaces";

type Log = { level: string; text: string; at: number };
type Picked = { selector: string; path: string; text: string; html: string; rect: { x: number; y: number; w: number; h: number } };
type Width = "desktop" | "tablet" | "phone";
const WIDTH: Record<Width, number | null> = { desktop: null, tablet: 820, phone: 390 };

const LIKELY = /node|vite|next|bun|deno|python|ruby|php|astro|webpack|rails|uvicorn|gunicorn|hugo|jekyll|java/i;

/** "5173", "localhost:5173/notes", "http://127.0.0.1:3000/x" → a port and a path; anything else stays a link. */
function parseAddress(s: string): { port: number; path: string } | { external: string } | null {
  const v = s.trim();
  if (!v) return null;
  if (/^\d{2,5}$/.test(v)) return { port: Number(v), path: "/" };
  const m = /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):(\d{2,5})(\/.*)?$/i.exec(v);
  if (m) return { port: Number(m[1]), path: m[2] || "/" };
  if (/^https?:\/\//i.test(v) || /^[\w-]+(\.[\w-]+)+/.test(v)) return { external: /^https?:/i.test(v) ? v : `https://${v}` };
  return null;
}

export function BrowserSurface({ thread, agentName }: { thread: Thread; agentName: string }) {
  const key = `lc:browse:${thread.projectId}`;
  const [ports, setPorts] = useState<{ port: number; process: string }[] | null>(null);
  const [target, setTarget] = useState<{ port: number; path: string } | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) || "null") as { port: number; path: string } | null;
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
  const frame = useRef<HTMLIFrameElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  // The agent at the wheel: the page's answers it waits on, and the loads it waits for.
  const answers = useRef(new Map<string, (r: { ok: boolean; value?: unknown; error?: string }) => void>());
  const loads = useRef(new Set<() => void>());
  const now = useRef({ target, logs });
  now.current = { target, logs };
  const [driving, setDriving] = useState(0);

  const findPorts = () =>
    rpc("ports.list", {})
      .then((p) => {
        setPorts(p);
        return p;
      })
      .catch(() => {
        setPorts([]);
        return [];
      });

  // The first time: the port you used last in this project, else the likeliest dev server.
  useEffect(() => {
    void findPorts().then((p) => {
      if (!target) {
        const dev = p.find((x) => LIKELY.test(x.process));
        if (dev) setTarget({ port: dev.port, path: "/" });
      }
    });
  }, [thread.projectId]);

  useEffect(() => {
    if (!target) return;
    localStorage.setItem(key, JSON.stringify(target));
    setAddress(`localhost:${target.port}${target.path === "/" ? "" : target.path}`);
    let live = true;
    void rpc("browser.proxy", { port: target.port })
      .then((r) => live && setProxy(r.url))
      .catch((e) => toast.error(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [target?.port]);

  // What the page says: console lines, where it went, what you picked.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || !e.data?.__liner) return;
      const d = e.data as { kind: string } & Record<string, unknown>;
      if (d.kind === "console") setLogs((l) => [...l.slice(-199), { level: String(d.level), text: String(d.text), at: Number(d.at) }]);
      else if (d.kind === "nav") {
        const path = String(d.path || "/");
        setTarget((t) => (t ? { ...t, path } : t));
        setAddress((a) => (document.activeElement?.classList.contains("lc-br-addr") ? a : `localhost:${target?.port ?? ""}${path === "/" ? "" : path}`));
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
      const r = (await page("read")) as Record<string, unknown>;
      return { ...r, port: now.current.target?.port, errors: now.current.logs.filter((l) => l.level === "error").slice(-10).map((l) => l.text) };
    };
    return onAgentBrowser(thread.id, async (op, args) => {
      setDriving(Date.now());
      if (op === "open") {
        const a = parseAddress(String(args.url ?? ""));
        if (!a || "external" in a) throw new Error("Only pages on this Mac: localhost:<port>/<path>, or a port.");
        // Asked afresh: the engine may have restarted since, with a new proxy for the port.
        const { url } = await rpc("browser.proxy", { port: a.port });
        const wait = loaded(15000);
        setPicked(null);
        setLogs([]);
        setProxy(url);
        setTarget({ port: a.port, path: a.path });
        setNonce((n) => n + 1);
        await wait;
        await new Promise((r) => setTimeout(r, 400));
        return read();
      }
      if (op === "read") return read();
      if (op === "click" || op === "type") {
        await page(op, args);
        await new Promise((r) => setTimeout(r, 700));
        return read();
      }
      if (op === "screenshot") {
        if (!isNative()) throw new Error("Screenshots of the Browser need the Liner Code app; this is its preview in a web browser.");
        const f = frame.current?.getBoundingClientRect();
        if (!f) throw new Error("No page is open in the Browser.");
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

  const go = (raw: string) => {
    const a = parseAddress(raw);
    if (!a) return toast("Type a port or a local address", { description: "Like 5173, or localhost:3000/settings" });
    if ("external" in a) {
      bridge.openExternal(a.external);
      return toast("Opened in your browser", { description: "Only pages on this Mac open beside the session." });
    }
    setPicked(null);
    setLogs([]);
    if (target && a.port === target.port) {
      setTarget({ port: a.port, path: a.path });
      setNonce((n) => n + 1);
    } else setTarget({ port: a.port, path: a.path });
  };

  const ask = async () => {
    if (!picked || !question.trim()) return;
    const where = `localhost:${target?.port}${target?.path ?? ""}`;
    const text = `${question.trim()}\n\nAbout the element \`${picked.selector}\` on ${where} (${picked.path}):\n\n\`\`\`html\n${picked.html}\n\`\`\``;
    try {
      await rpc("thread.send", { id: thread.id, text, mode: thread.status === "running" ? "queue" : undefined });
      toast(`Asked ${agentName}`, { description: picked.selector });
      setPicked(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const errors = logs.filter((l) => l.level === "error").length;
  const src = useMemo(() => (proxy && target ? `${proxy}${target.path}` : null), [proxy, target?.port, nonce]);
  const w = WIDTH[width];

  // Where the ask card sits: under the element, inside the stage.
  const card = useMemo(() => {
    if (!picked || !frame.current || !stage.current) return null;
    const f = frame.current.getBoundingClientRect();
    const s = stage.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(f.left - s.left + picked.rect.x, s.width - 328));
    const below = f.top - s.top + picked.rect.y + picked.rect.h + 8;
    const top = below + 150 > s.height ? Math.max(8, f.top - s.top + picked.rect.y - 158) : below;
    return { left, top };
  }, [picked]);

  if (!target)
    return (
      <SurfaceNote icon={<I.globe size={20} />} title={ports === null ? "Looking for a dev server" : "Nothing is listening yet"}>
        {ports === null ? null : (
          <>
            Start your dev server in the Terminal, or type its port below.
            <span className="lc-br-ports">
              {ports.slice(0, 6).map((p) => (
                <button key={p.port} type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => setTarget({ port: p.port, path: "/" })}>
                  <span className="lc-mono">:{p.port}</span>
                  <span className="lc-quiet">{p.process}</span>
                </button>
              ))}
            </span>
            <form
              className="lc-br-first"
              onSubmit={(e) => {
                e.preventDefault();
                go(address);
              }}
            >
              <input className="lc-input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="5173, or localhost:3000" aria-label="Address" />
              <button type="submit" className="lc-btn" data-kind="primary">
                Open
              </button>
            </form>
          </>
        )}
      </SurfaceNote>
    );

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
            go(address);
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
        <button type="button" className="lc-ib l-focus" aria-label="Open in your browser" title="Open in your browser" onClick={() => bridge.openExternal(`http://localhost:${target.port}${target.path}`)}>
          <I.external size={14} />
        </button>
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
          <iframe
            key={src}
            ref={frame}
            className="lc-br-frame"
            src={src}
            title="Page preview"
            onLoad={onLoad}
            style={w ? { width: w } : undefined}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
          />
        ) : (
          <div className="lc-diff-wait">
            <span className="l-shimmer">Opening localhost:{target.port}</span>
          </div>
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
