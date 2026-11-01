/*
  The Design surface: the session's designs (engine/src/designs.ts), each drawn full size in a
  frame at the size it's made for (desktop, tablet, phone), fitted to the panel. Live is the
  design's file as it is now, served from the session's folder so its scripts and the pictures
  beside it work, and drawn again each time the agent edits it: the new drawing loads behind the
  old and takes its place when it's ready, so nothing flashes. A version is that state as it was
  kept, drawn on its own with no way into the app. Pick a part of it and say what should change:
  the comment goes to the agent with the element. Build hands the design to the agent to make it
  for real, and the surface remembers which version you had built.

  The timeline's card for each version (DesignCard) draws a small picture of it and opens it here.
  Ideas from Kun's Design mode (github.com/KunAgent/Kun) and T3 Code's previews; no code from either.
*/
import { useEffect, useMemo, useRef, useState } from "react";
import type { DesignInfo, DesignSize, Item, Thread } from "@contracts";
import { Segmented } from "@liner/components/segmented/segmented";
import { toast } from "@liner/components/toast/toast";
import { bridge } from "./bridge";
import { langOf, linesOf, tokensOf, Toks } from "./code";
import { onStream, rpc } from "./engine";
import { I } from "./icons";
import { SurfaceNote, useCwd } from "./Surfaces";
import { PanelHead, Pop, Row } from "./ui";
import "./design.css";

type DesignItem = Extract<Item, { kind: "design" }>;
type Picked = { selector: string; path: string; text: string; html: string; rect: { x: number; y: number; w: number; h: number } };
type Scheme = "system" | "light" | "dark";

/** The frame each size is drawn in (the engine's DESIGN_FRAME). */
export const FRAME: Record<DesignSize, { width: number; height: number }> = {
  desktop: { width: 1280, height: 800 },
  tablet: { width: 834, height: 1112 },
  phone: { width: 390, height: 844 },
};

/** Each design of a session with all its versions, oldest first; the design shown last comes first. */
export function designsIn(items: Item[]) {
  const by = new Map<string, { versions: DesignItem[]; last: number }>();
  items.forEach((it, i) => {
    if (it.kind !== "design") return;
    const d = by.get(it.design) ?? { versions: [], last: i };
    d.versions.push(it);
    d.last = i;
    by.set(it.design, d);
  });
  return [...by.values()]
    .sort((a, b) => b.last - a.last)
    .map(({ versions }) => {
      const sorted = [...versions].sort((a, b) => a.version - b.version);
      return { item: sorted[sorted.length - 1], versions: sorted };
    });
}

/** A path in the session's folder as its address on the folder's server. */
const served = (base: string, path: string) => `${base}/${path.split("/").map(encodeURIComponent).join("/")}`;
const noQuery = (url: string) => url.replace(/\?.*$/, "");

/**
  A version drawn on its own (no origin of its own: it can't reach the app) can't use
  localStorage or sessionStorage, which throw there; a page that does gets ones that keep its
  values for as long as it's open.
*/
const SHIM = `<script>(()=>{const m=()=>{const s=new Map();return{getItem:k=>s.has(String(k))?s.get(String(k)):null,setItem:(k,v)=>void s.set(String(k),String(v)),removeItem:k=>void s.delete(String(k)),clear:()=>s.clear(),key:i=>[...s.keys()][i]??null,get length(){return s.size}}};for(const n of["localStorage","sessionStorage"]){try{void window[n].length}catch{try{Object.defineProperty(window,n,{value:m(),configurable:true})}catch{}}}})()</script>`;
export const withShim = (html: string) => (/<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + SHIM) : SHIM + html);

/** Versions' HTML, kept while the app is open: a version never changes. */
const kept = new Map<string, Promise<string>>();
export function versionHtml(threadId: string, design: string, version: number) {
  const key = `${threadId}:${design}:${version}`;
  let p = kept.get(key);
  if (!p) {
    p = rpc("design.read", { threadId, design, version }).then((r) => r.html);
    p.catch(() => kept.delete(key));
    kept.set(key, p);
  }
  return p;
}

const ago = (at: number) => {
  const s = Math.round((Date.now() - at) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(at).toLocaleDateString();
};

/* ---------- Opening a design, from the timeline or when an agent shows one ---------- */

type Want = { threadId: string; design?: string; version?: number; auto?: boolean; at: number };
let waiting: Want | null = null;
const takers = new Set<(w: Want) => void>();
/** Brings up the session's Design surface on a design (a version of it, or its file now). */
export function openInDesign(threadId: string, design?: string, version?: number) {
  window.dispatchEvent(new CustomEvent("lc:open-design", { detail: { threadId, design, version } }));
}
window.addEventListener("lc:open-design", (e) => {
  const d = (e as CustomEvent<Omit<Want, "at">>).detail;
  if (!d?.threadId) return;
  const w: Want = { ...d, at: Date.now() };
  // On screen, it's taken now; else it waits for the Design surface the session is bringing up.
  if (takers.size) for (const f of takers) f(w);
  else waiting = w;
});
function takeWaiting(threadId: string) {
  const w = waiting;
  if (!w || w.threadId !== threadId) return null;
  waiting = null;
  return Date.now() - w.at < 10_000 ? w : null;
}
/** An agent showed a design: its session brings the Design surface up on it (Session.tsx decides whether to). */
export function startDesigns() {
  return onStream((e) => {
    if (e.type === "item" && e.item.kind === "design") window.dispatchEvent(new CustomEvent("lc:open-design", { detail: { threadId: e.threadId, design: e.item.design, auto: true } }));
  });
}

/* ---------- The surface ---------- */

export function DesignSurface({ thread, items, agentName, visible }: { thread: Thread; items: Item[]; agentName: string; visible: boolean }) {
  const designs = useMemo(() => designsIn(items), [items]);
  const cwd = useCwd(thread);
  const [sel, setSel] = useState<string | null>(null);
  const [version, setVersion] = useState<number | "live">("live");
  const [view, setView] = useState<"design" | "code">("design");
  const [sizes, setSizes] = useState<Record<string, DesignSize>>({});
  const [fit, setFit] = useState(true);
  const [scheme, setScheme] = useState<Scheme>("system");
  const [info, setInfo] = useState<DesignInfo[]>([]);
  const [base, setBase] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  // Two frames that take turns: the one in front, and one loading the next drawing behind it.
  const [slots, setSlots] = useState<[string | null, string | null]>([null, null]);
  const [front, setFront] = useState<0 | 1>(0);
  const shown = slots[front];
  const [oldHtml, setOldHtml] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [comment, setComment] = useState("");
  const [box, setBox] = useState({ w: 0, h: 0 });
  const stage = useRef<HTMLDivElement>(null);
  const live = useRef<HTMLIFrameElement | null>(null);

  const d = designs.find((x) => x.item.design === sel) ?? designs[0];
  const latest = d?.item;
  const size: DesignSize = (latest && sizes[latest.design]) ?? latest?.size ?? "desktop";
  const shownVersion = version === "live" ? undefined : d?.versions.find((v) => v.version === version);
  const built = latest ? info.find((x) => x.design === latest.design)?.built : undefined;

  // Asked from elsewhere: the timeline's Open, or an agent showing one.
  useEffect(() => {
    const take = (w: Want) => {
      if (w.threadId !== thread.id) return;
      if (w.design) setSel(w.design);
      setVersion(w.version ?? "live");
      setPicked(null);
    };
    takers.add(take);
    const w = takeWaiting(thread.id);
    if (w) take(w);
    return () => void takers.delete(take);
  }, [thread.id]);

  // The folder's server, once; the designs' files are watched while this is open.
  const any = designs.length > 0;
  useEffect(() => {
    if (!any) return;
    let live = true;
    void rpc("browser.files", { threadId: thread.id })
      .then((r) => live && setBase(r.url))
      .catch(() => live && setBase(null));
    void rpc("design.watch", { threadId: thread.id, on: true }).catch(() => {});
    return () => {
      live = false;
      void rpc("design.watch", { threadId: thread.id, on: false }).catch(() => {});
    };
  }, [thread.id, any]);
  // Which version of each you had built: asked again when a version comes.
  const versions = designs.reduce((n, x) => n + x.versions.length, 0);
  useEffect(() => {
    if (!any) return;
    void rpc("design.list", { threadId: thread.id })
      .then(setInfo)
      .catch(() => {});
  }, [thread.id, versions]);

  // The agent editing the file: it's drawn again.
  useEffect(
    () =>
      onStream((e) => {
        if (e.type === "design.changed" && e.threadId === thread.id && e.design === latest?.design) setRev((r) => r + 1);
      }),
    [thread.id, latest?.design],
  );

  // Live: the file now. The same design drawn again loads in the frame behind and comes to the
  // front when it has loaded; another design takes the front frame at once. Neither frame moves
  // in the page (a frame that moves loads again).
  const liveSrc = base && latest ? `${served(base, latest.path)}?v=${latest.version}.${rev}` : null;
  const wanted = useRef(liveSrc);
  wanted.current = liveSrc;
  useEffect(() => {
    if (!liveSrc || liveSrc === slots[front]) return;
    const now = slots[front];
    if (now && noQuery(now) === noQuery(liveSrc)) setSlots((s) => (front === 0 ? [s[0], liveSrc] : [liveSrc, s[1]]));
    else setSlots((s) => (front === 0 ? [liveSrc, s[1]] : [s[0], liveSrc]));
  }, [liveSrc]);
  useEffect(() => {
    setPicked(null);
    setPicking(false);
  }, [latest?.design, version, shown]);

  // A version, or the code: read when it's what's shown.
  useEffect(() => {
    if (!latest || !shownVersion) return setOldHtml(null);
    let on = true;
    setOldHtml(null);
    void versionHtml(thread.id, latest.design, shownVersion.version)
      .then((h) => on && setOldHtml(h))
      .catch((e) => on && setOldHtml(`<p style="font:14px system-ui;color:#888;padding:24px">${String(e instanceof Error ? e.message : e)}</p>`));
    return () => {
      on = false;
    };
  }, [thread.id, latest?.design, shownVersion?.version]);
  useEffect(() => {
    if (view !== "code" || !latest) return;
    let on = true;
    void (shownVersion ? versionHtml(thread.id, latest.design, shownVersion.version) : rpc("design.read", { threadId: thread.id, design: latest.design }).then((r) => r.html))
      .then((h) => on && setCode(h))
      .catch(() => on && setCode(""));
    return () => {
      on = false;
    };
  }, [view, thread.id, latest?.design, latest?.version, shownVersion?.version, rev]);

  // The stage's size, for fitting the frame.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [any, view]);

  // What the page says through the probe: the part you picked.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== live.current?.contentWindow || !e.data?.__liner) return;
      const m = e.data as { kind: string } & Record<string, unknown>;
      if (m.kind === "picked") {
        setPicking(false);
        setPicked(m as unknown as Picked);
        setComment("");
      } else if (m.kind === "unpicked") setPicking(false);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);
  const cmd = (c: string) => live.current?.contentWindow?.postMessage({ __linerCmd: c }, "*");

  const { width: W, height: H } = FRAME[size];
  const scale = fit && box.w ? Math.min(1, (box.w - 32) / W) : 1;
  // A desktop design fills the stage's height; a tablet or phone keeps its screen.
  const frameH = size === "desktop" && box.h ? Math.max(H, Math.floor((box.h - 32) / scale)) : H;

  // Where the comment card sits: under the part, inside the stage, past its scroll.
  const card = useMemo(() => {
    const st = stage.current;
    const f = live.current;
    if (!picked || !st || !f) return null;
    const fr = f.getBoundingClientRect();
    const sr = st.getBoundingClientRect();
    const left = Math.max(8, Math.min(fr.left - sr.left + picked.rect.x * scale, st.clientWidth - 328));
    const below = fr.top - sr.top + st.scrollTop + (picked.rect.y + picked.rect.h) * scale + 8;
    const top = below + 150 > st.scrollTop + st.clientHeight ? Math.max(st.scrollTop + 8, fr.top - sr.top + st.scrollTop + picked.rect.y * scale - 158) : below;
    return { left, top };
  }, [picked]);

  const send = async (text: string, said: string) => {
    try {
      await rpc("thread.send", { id: thread.id, text, mode: thread.status === "running" ? "queue" : undefined });
      toast(said);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  const ask = async () => {
    if (!picked || !comment.trim() || !latest) return;
    const quote = picked.text ? ` (“${picked.text.slice(0, 80)}${picked.text.length > 80 ? "…" : ""}”)` : "";
    const text = `${comment.trim()}\n\nThat's about this part of the design “${latest.title}” (\`${latest.path}\`): \`${picked.selector}\`${quote}, at ${picked.path}:\n\n\`\`\`html\n${picked.html}\n\`\`\`\n\nChange the design's file, then show it again with design_show.`;
    if (await send(text, `Sent to ${agentName}`)) setPicked(null);
  };

  const build = async () => {
    if (!latest) return;
    const text = `Build the design “${latest.title}” into the app: version ${latest.version}, in \`${latest.path}\`. Read the design file first, then make the real thing with this project's own components, styles and conventions, matching its layout, spacing, type and colours closely. The design is a picture of the result, not code to paste in. When it's done, say what you couldn't match, if anything.`;
    if (!(await send(text, `Asked ${agentName} to build “${latest.title}”`))) return;
    void rpc("design.built", { threadId: thread.id, design: latest.design, version: latest.version })
      .then(setInfo)
      .catch(() => {});
  };

  const restore = async () => {
    if (!latest || !shownVersion) return;
    try {
      await rpc("design.restore", { threadId: thread.id, design: latest.design, version: shownVersion.version });
      setVersion("live");
      toast(`Version ${shownVersion.version} is back`, { description: `As version ${latest.version + 1}, in ${latest.path}` });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const copy = async () => {
    if (!latest) return;
    try {
      const html = shownVersion ? await versionHtml(thread.id, latest.design, shownVersion.version) : (await rpc("design.read", { threadId: thread.id, design: latest.design })).html;
      await navigator.clipboard.writeText(html);
      toast.success("Copied the design's HTML");
    } catch {
      toast.error("Couldn't copy it");
    }
  };

  if (!latest)
    return (
      <SurfaceNote icon={<I.design size={20} />} title="No designs yet">
        Ask {agentName} for a screen, a page or a prototype, like “Design the settings screen”. It draws here, version by version: pick any part of it to say what should change, then have it built.
      </SurfaceNote>
    );

  const toks = view === "code" && code !== null ? tokensOf(linesOf(code), langOf("design.html")) : [];
  const frameStyle = { width: W, height: frameH, transform: scale === 1 ? undefined : `scale(${scale})`, colorScheme: scheme === "system" ? undefined : scheme };

  return (
    <div className="lc-dz">
      <div className="lc-br-bar lc-dz-bar">
        <Pop label="Designs in this session" width={300} triggerClass="lc-dz-pick" trigger={<><I.design size={13} /><b>{latest.title}</b><I.chevD size={12} /></>}>
          {(close) => (
            <div className="lc-dz-menu">
              <PanelHead>Designs in this session</PanelHead>
              {designs.map((x) => (
                <Row
                  key={x.item.design}
                  title={x.item.title}
                  note={`${x.versions.length === 1 ? "1 version" : `${x.versions.length} versions`} · ${x.item.size} · ${ago(x.item.at)}`}
                  on={x.item.design === latest.design}
                  onPick={() => (setSel(x.item.design), setVersion("live"), close())}
                />
              ))}
            </div>
          )}
        </Pop>
        <Pop label="Versions" width={300} triggerClass="lc-dz-pick lc-dz-ver" trigger={<><span>{shownVersion ? `Version ${shownVersion.version}` : "Live"}</span><I.chevD size={12} /></>}>
          {(close) => (
            <div className="lc-dz-menu">
              <PanelHead>Versions</PanelHead>
              <Row title="Live" note={`${latest.path}, as it is now`} on={version === "live"} onPick={() => (setVersion("live"), close())} />
              {[...d.versions].reverse().map((v) => (
                <Row
                  key={v.id}
                  title={`Version ${v.version}${built?.version === v.version ? " · built" : ""}`}
                  note={`${v.note ?? (v.version === 1 ? "The first draft" : "Changed")} · ${ago(v.at)}`}
                  on={version === v.version}
                  onPick={() => (setVersion(v.version), close())}
                />
              ))}
            </div>
          )}
        </Pop>
        <span className="lc-grow" />
        {view === "design" && version === "live" && (
          <button
            type="button"
            className="lc-ib l-focus"
            aria-label={`Pick a part to comment on for ${agentName}`}
            title={`Pick a part to comment on for ${agentName}`}
            aria-pressed={picking}
            onClick={() => {
              setPicked(null);
              setPicking((p) => {
                cmd(p ? "unpick" : "pick");
                return !p;
              });
              live.current?.focus();
            }}
          >
            <I.comment size={14} />
          </button>
        )}
        <button type="button" className="lc-ib l-focus" aria-label={view === "code" ? "Show the design" : "Show its code"} title={view === "code" ? "Show the design" : "Show its code"} aria-pressed={view === "code"} onClick={() => setView((v) => (v === "code" ? "design" : "code"))}>
          <I.file size={14} />
        </button>
        <Pop label="More for the design" align="end" width={250} triggerClass="lc-ib" trigger={<I.more size={14} />}>
          {(close) => (
            <div className="lc-br-more">
              <div className="lc-dz-acts">
                <button type="button" className="lc-btn" data-kind="plain" data-size="sm" disabled={!base} onClick={() => (base && bridge.openExternal(served(base, latest.path)), close())}>
                  <I.external size={13} /> Open in your browser
                </button>
                <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => (void copy(), close())}>
                  <I.copy size={13} /> Copy its HTML
                </button>
                <button type="button" className="lc-btn" data-kind="plain" data-size="sm" disabled={!cwd} onClick={() => (bridge.reveal(`${cwd}/${latest.path}`), close())}>
                  <I.folder size={13} /> Show its file
                </button>
              </div>
              <PanelHead>Theme</PanelHead>
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
                  aria-label="The design's theme"
                />
              </div>
              <p className="lc-pop-foot">Its prefers-color-scheme follows this, for designs that draw both.</p>
            </div>
          )}
        </Pop>
      </div>
      <div className="lc-br-opts">
        <Segmented
          size="sm"
          value={size}
          onValueChange={(v) => setSizes((s) => ({ ...s, [latest.design]: v }))}
          options={[
            { value: "desktop", label: "Desktop" },
            { value: "tablet", label: "Tablet" },
            { value: "phone", label: "Phone" },
          ]}
          aria-label="The size it's drawn at"
        />
        <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" aria-pressed={!fit} title={fit ? "Draw it at its own pixels" : "Fit it to the panel"} onClick={() => setFit((f) => !f)}>
          {fit ? `${Math.round(scale * 100)}%` : "100%"}
        </button>
        <span className="lc-grow" />
        {shownVersion ? (
          <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => void restore()} title={`Put version ${shownVersion.version} back in ${latest.path}`}>
            <I.undo size={13} /> Bring back version {shownVersion.version}
          </button>
        ) : (
          <>
            {built && (
              <span className="lc-dz-built" data-stale={built.version < latest.version || undefined} title={built.version < latest.version ? `You had version ${built.version} built; it has changed since` : `You had version ${built.version} built`}>
                {built.version < latest.version ? `Built v${built.version}, changed since` : `Built v${built.version}`}
              </span>
            )}
            <button type="button" className="lc-btn" data-kind={built?.version === latest.version ? "plain" : "primary"} data-size="sm" onClick={() => void build()} title={`Ask ${agentName} to build version ${latest.version} into the app`}>
              <I.play size={12} /> {built ? "Build again" : "Build it"}
            </button>
          </>
        )}
      </div>
      {view === "code" ? (
        <div className="lc-dz-code">
          {code === null ? (
            <span className="l-shimmer lc-files-wait">Reading {latest.path}</span>
          ) : (
            <pre className="lc-code-view">
              {linesOf(code).map((_, i) => (
                <div key={i} className="lc-cl">
                  <span className="lc-cl-n">{i + 1}</span>
                  <span className="lc-cl-t">
                    <Toks line={toks[i]} />
                    {"\n"}
                  </span>
                </div>
              ))}
            </pre>
          )}
        </div>
      ) : (
        <div ref={stage} className="lc-dz-stage" data-size={size}>
          <div className="lc-dz-board" style={{ width: Math.ceil(W * scale), height: Math.ceil(frameH * scale) }}>
            <div className="lc-dz-frame" style={frameStyle}>
              {shownVersion ? (
                oldHtml === null ? (
                  <span className="l-shimmer lc-dz-wait">Opening version {shownVersion.version}</span>
                ) : (
                  // A version on its own: scripts run, but it has no origin, so it can't reach the app.
                  <iframe key={`v${shownVersion.version}`} className="lc-dz-f" title={`${latest.title}, version ${shownVersion.version}`} srcDoc={withShim(oldHtml)} sandbox="allow-scripts allow-forms allow-modals" />
                )
              ) : (
                <>
                  {([0, 1] as const).map((i) =>
                    slots[i] ? (
                      <iframe
                        key={`${i}:${slots[i]}`}
                        ref={i === front ? (el) => void (live.current = el) : undefined}
                        className="lc-dz-f"
                        data-behind={i !== front || undefined}
                        title={i === front ? latest.title : `${latest.title}, as it's being edited`}
                        src={slots[i]!}
                        // Served from the folder's own address, not the app's: it can't reach into the app.
                        sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
                        tabIndex={i === front && visible ? 0 : -1}
                        aria-hidden={i !== front || undefined}
                        // Only the newest drawing comes to the front, never a stale one that loaded again.
                        onLoad={() => void (slots[i] === wanted.current && setFront(i))}
                      />
                    ) : null,
                  )}
                  {!shown && <span className="l-shimmer lc-dz-wait">Opening {latest.path}</span>}
                </>
              )}
            </div>
          </div>
          {picking && <span className="lc-br-hint l-glass">Point at a part of the design and click it. Escape stops.</span>}
          {picked && card && (
            <div className="lc-br-ask l-glass" style={{ left: card.left, top: card.top }} role="dialog" aria-label={`Comment on this part for ${agentName}`}>
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
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="What should change here?"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void ask();
                  if (e.key === "Escape") setPicked(null);
                }}
              />
              <div className="lc-br-ask-f">
                <span className="lc-quiet">Sends the part with your comment</span>
                <button type="button" className="lc-btn" data-kind="primary" data-size="sm" disabled={!comment.trim()} onClick={() => void ask()}>
                  Send to {agentName}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- The timeline's card ---------- */

/** A version an agent showed, on the timeline: a small picture of it (drawn once it's in view) that opens it in the Design surface. */
export function DesignCard({ threadId, it }: { threadId: string; it: DesignItem }) {
  const box = useRef<HTMLButtonElement>(null);
  const [width, setWidth] = useState(0);
  const [seen, setSeen] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    const io = new IntersectionObserver((es) => es.some((x) => x.isIntersecting) && (setSeen(true), io.disconnect()), { rootMargin: "200px" });
    io.observe(el);
    return () => (ro.disconnect(), io.disconnect());
  }, []);
  useEffect(() => {
    if (!seen) return;
    let on = true;
    void versionHtml(threadId, it.design, it.version)
      .then((h) => on && setHtml(h))
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [seen, threadId, it.design, it.version]);
  const { width: W, height: H } = FRAME[it.size];
  // A desktop design fills the card's width; a tablet or phone fits its whole screen in the card's height.
  const tall = 260;
  const scale = !width ? 0 : it.size === "desktop" ? width / W : Math.min(width / W, tall / H);
  const open = () => openInDesign(threadId, it.design, undefined);
  return (
    <figure className="lc-dz-card lc-frame">
      <div className="lc-fcard">
        <figcaption className="lc-page-h">
          <I.design size={13} />
          <b>{it.title}</b>
          <span className="lc-quiet lc-dz-card-v">
            Version {it.version}
            {it.note ? ` · ${it.note}` : ""}
          </span>
          <span className="lc-grow" />
          <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={open}>
            Open
          </button>
        </figcaption>
        <button ref={box} type="button" className="lc-dz-thumb l-focus" data-size={it.size} aria-label={`Open “${it.title}” in the Design surface`} onClick={open} style={{ height: it.size === "desktop" ? Math.min(tall, Math.round(H * scale) || 200) : tall }}>
          {html !== null && scale > 0 && (
            <span className="lc-dz-thumb-in" style={{ width: Math.round(W * scale), height: Math.round(H * scale) }}>
              {/* Drawn on its own, with no origin: it can't reach the app. */}
              <iframe className="lc-dz-thumb-f" title={`${it.title}, version ${it.version}`} srcDoc={withShim(html)} sandbox="allow-scripts" tabIndex={-1} aria-hidden style={{ width: W, height: H, transform: `scale(${scale})` }} />
            </span>
          )}
        </button>
      </div>
    </figure>
  );
}
