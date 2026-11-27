/*
  The Design surface for a session with a Liner Design file: a small, read-only view of its canvas,
  every frame drawn at a size that fits the panel with its name over it, as on the canvas, kept in
  step with the file (canvas.changed: a frame drawn again, new frames come, removed ones go) and
  with who is on a frame now (canvas.presence: the ring in the lead's or the sidekick's colour).
  In the panel's frame: the head says the design (a picker when the chat showed designs too) and how
  many frames, the foot who is drawing what and Open in Liner Design; pressing a frame opens it there
  too, on that frame (face.ts landOn).

  Its own light read of the file through the canvas's calls (canvas.open, canvas.frame.read,
  canvas.watch), never the Design face's store, which holds the one file that face shows. A frame is
  its HTML in a sandboxed iframe with no origin, as the timeline's design card draws one (withShim),
  with the <base> the canvas gives it so its pictures load; no frame agent and no bridge, since
  nothing here edits it. A drawing that changes loads behind the one shown and takes its place when
  it has loaded, so nothing flashes. Cost: only frames in view (and a few just past it, MAX_LIVE in
  all), and none while the panel is hidden, hold a live iframe; the rest are a flat box of their size.
*/
import { useEffect, useMemo, useRef, useState } from "react";
import type { DesignFile, DesignFrame, Item, Thread } from "@contracts";
import { DESIGN_UNREADABLE } from "@contracts";
import { SHIM } from "./Design";
import { onStream, rpc, useEngine } from "./engine";
import { drawingOf, landOn } from "./face";
import { I, StateMark } from "./icons";
import { plural } from "./model";
import { reviewHeld } from "./session-state";
import { SurfaceNote } from "./Surfaces";
import { DESIGN_TOOL } from "./surface-row";
import { PANE_PICK, PaneButton, PaneFoot, PaneHead, PaneWords } from "./Pane";
import { PanelHead, Pop, Row, Sep } from "./ui";

/** Frames just past the view hold a live iframe only while fewer than MAX_LIVE do; every frame in view does, up to MAX_IN_VIEW (a safety cap for a very tall panel). */
const MAX_LIVE = 8;
const MAX_IN_VIEW = 24;
/** A column's least width, the gap between frames, and how tall a frame is drawn at most. */
const COL = 150;
const GAP = 14;
const TALL = 240;
const TALL_WIDE = 300;

/* ---------- Which design file the session draws ---------- */

/* A call of Liner's design tools that draws (DESIGN_TOOL, kept in surface-row.ts, which the panel's + reads too), by any tool's name for them (face.ts CANVAS_TOOL); the ones that only read (tree, shot, files) don't count. */
const SLUG_IN = /^\.liner\/designs\/([^/]+)\/(?:frames\/[^/]+\.html|design\.json)$/;
/**
  A path a tool wrote, from the session's folder: one outside it is no design of this folder. A
  Windows absolute path ("C:\…") is read as relative and so never matches: left as it is for now.
*/
const inFolder = (path: string, cwd: string) => {
  const p = path.replace(/\\/g, "/");
  const root = cwd.replace(/\\/g, "/").replace(/\/?$/, "/");
  return p.startsWith("/") ? (p.startsWith(root) ? p.slice(root.length) : undefined) : p.replace(/^\.\//, "");
};
/**
  The design file a session without a design mark drew on, newest first: the one a design tool named
  (its `design`, a slug or a title: useSessionDesign reads it against the folder's files), the one
  whose frame file it wrote in this folder (a read doesn't count); "" for a design tool that named
  none; undefined when it never drew. For "" the engine meant the file the person last opened in
  Liner Design (canvas.ts designFor), which can't be asked without a call that would itself count as
  opening one, so the folder's newest stands in for it, as the face switch does. `rows`: how many
  finished rows drew, so a design folder that appeared after its first row is looked for again.
*/
function drewOn(items: Item[], cwd: string): { name?: string; rows: number } {
  let name: string | undefined;
  let rows = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind !== "tool") continue;
    const rel = it.path && (it.toolKind === "edit" || it.toolKind === "write") ? inFolder(it.path, cwd) : undefined;
    const p = rel?.match(SLUG_IN)?.[1];
    let n: string | undefined = p;
    if (!p && DESIGN_TOOL.test(it.tool)) {
      try {
        const d = (JSON.parse(it.input ?? "") as Record<string, unknown>).design;
        n = typeof d === "string" && d.trim() ? d.trim() : "";
      } catch {
        n = "";
      }
    }
    if (n === undefined) continue;
    if (name === undefined) name = n;
    if (it.status !== "running") rows++;
  }
  return { name, rows };
}

/**
  The session's design file: the one it was begun from (Thread.design), else, for a session of a
  project, the one it drew on (drewOn), else none. A session that never drew keeps the panel's start.
*/
export function useSessionDesign(thread: Thread, items: Item[], cwd: string, visible: boolean) {
  const marked = thread.design?.file;
  const drew = useMemo(() => (marked ? undefined : drewOn(items, cwd)), [marked, items, cwd]);
  const named = drew?.name;
  // The name read against the folder's files: by id, by title, by the title's slug; "" is the newest.
  // Read again when the panel shows, when another row drew, and (while none is found) when a design of the folder changes: never polled.
  const [found, setFound] = useState<{ cwd: string; named: string; file?: string }>();
  const [nudge, setNudge] = useState(0);
  const missing = named !== undefined && !(found?.cwd === cwd && found.named === named && found.file);
  useEffect(() => {
    if (!missing || !visible || !cwd) return;
    return onStream((e) => void (e.type === "canvas.changed" && e.cwd === cwd && setNudge((n) => n + 1)));
  }, [missing, visible, cwd]);
  useEffect(() => {
    if (marked || named === undefined || !cwd || !visible) return;
    let on = true;
    void rpc("canvas.list", { cwd, peek: true }).then((files) => {
      const n = named.toLowerCase();
      const slug = n.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      const f = !named ? [...files].sort((a, b) => b.updated - a.updated)[0] : (files.find((x) => x.id === named) ?? files.find((x) => x.title.toLowerCase() === n) ?? files.find((x) => x.id === slug));
      if (on) setFound({ cwd, named, file: f?.id });
      // (The file shown meanwhile stays: below, a new name only switches once its answer is another file.)
    }, () => {});
    return () => {
      on = false;
    };
  }, [marked, named, drew?.rows, cwd, visible, nudge]);
  // While a new name is looked up, the file found last stays shown (the same design named by title, slug or not at all doesn't remount the view).
  return marked ?? (named !== undefined && found?.cwd === cwd ? found.file : undefined);
}

/* ---------- The file, read and kept in step ---------- */

type Who = { lead: boolean; name: string; threadId?: string };
type Read = { file: DesignFile; base: string };
type State = { read?: Read; html: Record<string, string>; who: Record<string, Who>; why?: string };

function useMiniFile(cwd: string, slug: string, on: boolean) {
  const [s, setS] = useState<State>({ html: {}, who: {} });
  const revs = useRef<Record<string, string>>({});
  const read = useRef<Read | undefined>(undefined);
  // Another file: nothing of the one before.
  useEffect(() => {
    setS({ html: {}, who: {} });
    revs.current = {};
    read.current = undefined;
  }, [cwd, slug]);
  const connected = useEngine((x) => x.connected);
  useEffect(() => {
    if (!on || !connected || !cwd || !slug) return;
    let live = true;
    // One read of a frame at a time; a change heard meanwhile reads it once more after.
    const busy = new Set<string>();
    const again = new Set<string>();
    const readFrame = async (frame: string) => {
      if (busy.has(frame)) return void again.add(frame);
      busy.add(frame);
      try {
        // A look only: the frame as it is on disk, nothing written into it and nothing marked as heard.
        const r = await rpc("canvas.frame.read", { cwd, file: slug, frame, peek: true });
        if (!live) return;
        revs.current[frame] = r.rev;
        setS((x) => (x.html[frame] === r.html ? x : { ...x, html: { ...x.html, [frame]: r.html } }));
      } catch {
        // gone with its frame, or the engine away: the next change reads it again
      } finally {
        busy.delete(frame);
        if (live && again.delete(frame)) void readFrame(frame);
      }
    };
    const open = async () => {
      try {
        // A look only: nothing adopted or written, and the agent's "file the person has open" stays whatever Liner Design opened.
        const r = await rpc("canvas.open", { cwd, file: slug, peek: true });
        if (!live) return;
        read.current = { file: r.file, base: r.base };
        const there = new Set(r.file.frames.map((f) => f.id));
        // What changed since it was read last (its revision), and what was never read.
        const stale = r.file.frames.filter((f) => f.kind === "drawn" && !f.missing && (!revs.current[f.id] || revs.current[f.id] !== r.revs[f.id]));
        setS((x) => ({ read: read.current, why: undefined, html: Object.fromEntries(Object.entries(x.html).filter(([k]) => there.has(k))), who: Object.fromEntries(Object.entries(x.who).filter(([k]) => there.has(k))) }));
        await Promise.all(stale.map((f) => readFrame(f.id)));
      } catch (e) {
        if (!live) return;
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.startsWith(DESIGN_UNREADABLE)) return gone(`This design can't be read: ${msg.slice(DESIGN_UNREADABLE.length).trim()}`);
        const files = await rpc("canvas.list", { cwd, peek: true }).catch(() => undefined);
        if (live && files && !files.some((f) => f.id === slug)) gone();
      }
    };
    const gone = (why = "This design isn't on disk any more. It was deleted or moved.") => {
      read.current = undefined;
      revs.current = {};
      setS({ html: {}, who: {}, why });
    };
    void open();
    // A watch that only looks: alone on the folder it writes nothing. On and off aren't awaited: the engine
    // takes calls in the order sent, so a quick off then on stays balanced. Left so on purpose.
    void rpc("canvas.watch", { cwd, file: slug, on: true, peek: true }).catch(() => {});
    const off = onStream((e) => {
      if (e.type === "canvas.changed") {
        if (e.cwd !== cwd || e.file !== slug) return;
        if (e.gone === true) return gone();
        const f = e.frame;
        // The file's index (frames added, removed, moved, renamed), or a frame it doesn't know yet.
        if (!f || e.gone === false || !read.current?.file.frames.some((x) => x.id === f)) return void open();
        if (e.rev && revs.current[f] === e.rev) return;
        void readFrame(f);
      } else if (e.type === "canvas.presence") {
        if (e.cwd !== cwd || e.file !== slug) return;
        setS((x) => {
          const who = { ...x.who };
          if (e.on) who[e.frame] = { lead: e.agent !== "sidekick", name: e.name, threadId: e.threadId };
          else delete who[e.frame];
          return { ...x, who };
        });
      }
    });
    return () => {
      live = false;
      off();
      void rpc("canvas.watch", { cwd, file: slug, on: false, peek: true }).catch(() => {});
      // An "off" said while nobody listens would be lost: who is drawing is heard afresh (DesignMini falls back on the running turn meanwhile).
      setS((x) => (Object.keys(x.who).length ? { ...x, who: {} } : x));
    };
  }, [on, connected, cwd, slug]);
  return s;
}

/* ---------- Drawing a frame ---------- */

/**
  A frame's page as its iframe gets it: the storage stand-ins and hidden scrollbar (Design.tsx SHIM)
  and the canvas's <base> at the design's frames, after a leading doctype, <html> and <head>, so
  its pictures and styles load as on the canvas. A piece of a page gets a document round it.
*/
const LEAD = /^(\s*<!doctype[^>]*>)?(\s*<html(?=[\s/>])[^>]*>)?(\s*<head(?=[\s/>])[^>]*>)?/i;
function docOf(html: string, base: string) {
  const head = `${base ? `<base href="${base.replace(/\/?$/, "/")}frames/">` : ""}${SHIM}`;
  if (!/<!doctype|<(html|head|body)[\s/>]/i.test(html)) return `<!doctype html><html><head>${head}</head><body>${html}</body></html>`;
  const at = LEAD.exec(html)?.[0].length ?? 0;
  return html.slice(0, at) + head + html.slice(at);
}
/** Nothing drawn in it yet (as store.ts blankHtml). */
const blank = (html: string) => !/<body[^>]*>[\s\S]*?<[a-z]/i.test(html.replace(/<script\b[\s\S]*?<\/script>/gi, ""));

/** One frame's drawing: two iframes that take turns, the new drawing loading behind the one shown. */
function Drawing({ doc, f, scale }: { doc: string; f: DesignFrame; scale: number }) {
  const [slots, setSlots] = useState<[string | null, string | null]>([doc, null]);
  const [front, setFront] = useState<0 | 1>(0);
  const want = useRef(doc);
  want.current = doc;
  useEffect(() => {
    // Back to what the front shows while a newer one still loads behind: that one goes.
    if (slots[front] === doc) return void (slots[front ? 0 : 1] !== null && setSlots((s) => (front === 0 ? [s[0], null] : [null, s[1]])));
    setSlots((s) => (front === 0 ? [s[0], doc] : [doc, s[1]]));
  }, [doc]);
  return (
    <>
      {([0, 1] as const).map((i) =>
        slots[i] !== null ? (
          <iframe
            key={i}
            className="lc-dm-f"
            title={f.name}
            srcDoc={slots[i]!}
            // No origin: it can't reach the app. Scripts run, so a page drawn by them shows.
            sandbox="allow-scripts"
            tabIndex={-1}
            aria-hidden
            data-behind={i !== front || undefined}
            style={{ width: f.w, height: f.h, transform: `scale(${scale})` }}
            onLoad={() => {
              if (i === front || slots[i] !== want.current) return;
              setFront(i);
              // The one it replaced goes, so only one iframe a frame is left working.
              setSlots((s) => (i === 0 ? [s[0], null] : [null, s[1]]));
            }}
          />
        ) : null,
      )}
    </>
  );
}

/* ---------- The surface ---------- */

type Laid = { f: DesignFrame; span: number; scale: number; w: number; h: number };

/**
  `chat`: the designs an agent showed in the chat in this session, which the head's design picker lists under the
  file; picking one shows it (`onChat`, Design.tsx).
*/
export function DesignMini({ thread, items, cwd, file: slug, agentName, visible, chat = [], onChat }: { thread: Thread; items: Item[]; cwd: string; file: string; agentName: string; visible: boolean; chat?: { design: string; title: string }[]; onChat?: (design: string) => void }) {
  const { read, html, who: heard, why } = useMiniFile(cwd, slug, visible);
  const own = useEngine((s) => s.projects.find((p) => p.id === thread.projectId)?.kind === "design");
  const body = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  const [inView, setInView] = useState<Set<string>>(() => new Set());
  const file = read?.file;

  // In reading order, as on the canvas: page by page, then row by row (frames whose tops are near count as one row), then left to right.
  const frames = useMemo(() => {
    if (!file) return [];
    const pageAt = new Map(file.pages.map((p, i) => [p.id, i]));
    return [...file.frames].sort((a, b) => (pageAt.get(a.page) ?? 99) - (pageAt.get(b.page) ?? 99) || (Math.abs(a.y - b.y) > 120 ? a.y - b.y : a.x - b.x));
  }, [file]);

  // Who is on a frame: what the engine says (canvas.presence), else this session's own running turn
  // (face.ts drawingOf), for a view opened after the agent began.
  const now = thread.status === "running" ? drawingOf(items) : undefined;
  // Sessions at work now: a presence whose session's turn has ended is let go, should its "off" never come.
  const working = useEngine((s) => [...s.threads, ...s.sides].filter((t) => t.status === "running" || (t.status === "waiting" && !reviewHeld(t))).map((t) => t.id).join(","));
  // The running turn's row counts only when it is about this design file, where it says which: a frame path names its folder, a design tool its `design`.
  const here = useMemo(() => {
    if (!now) return undefined;
    const rel = now.tool.path ? inFolder(now.tool.path, cwd) : undefined;
    const bySlug = rel?.match(/^\.liner\/designs\/([^/]+)\//)?.[1];
    let asked: unknown;
    try {
      asked = (JSON.parse(now.tool.input ?? "") as Record<string, unknown>).design;
    } catch {
      // no input to read
    }
    if (bySlug) return bySlug === slug ? now : undefined;
    if (typeof asked === "string" && asked.trim()) return asked.trim() === slug || asked.trim().toLowerCase() === file?.title.toLowerCase() ? now : undefined;
    return now;
  }, [now?.tool, now?.frame, cwd, slug, file?.title]);
  const who = useMemo(() => {
    const at = new Set(working.split(","));
    const w = Object.fromEntries(Object.entries(heard).filter(([, x]) => !x.threadId || at.has(x.threadId)));
    const named = here?.frame?.toLowerCase();
    const f = named ? frames.find((x) => x.id.toLowerCase() === named || x.name.toLowerCase() === named) : undefined;
    if (f && !w[f.id]) w[f.id] = { lead: true, name: agentName };
    return w;
  }, [heard, working, here, frames, agentName]);

  // The panel's width, for the columns.
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const cs = getComputedStyle(el);
      setWidth(el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [why === undefined]);

  // Which frames are in view, and which a little past it: only those hold a live iframe, the ones in view first.
  const ids = frames.map((f) => f.id).join(",");
  useEffect(() => {
    const root = body.current;
    if (!root || !visible) return;
    const watch = (set: typeof setSeen, margin: string) => {
      const io = new IntersectionObserver(
        (es) =>
          set((was) => {
            const next = new Set(was);
            for (const e of es) {
              const id = (e.target as HTMLElement).dataset.frame!;
              if (e.isIntersecting) next.add(id);
              else next.delete(id);
            }
            return next;
          }),
        { root, rootMargin: margin },
      );
      for (const el of root.querySelectorAll<HTMLElement>("[data-frame]")) io.observe(el);
      return io;
    };
    const near = watch(setSeen, "160px 0px");
    const shown = watch(setInView, "0px");
    return () => (near.disconnect(), shown.disconnect());
  }, [ids, visible, width > 0]);

  const inner = Math.max(0, width);
  const cols = Math.max(1, Math.floor((inner + GAP) / (COL + GAP)));
  const colW = cols ? (inner - GAP * (cols - 1)) / cols : inner;
  const laid: Laid[] = frames.map((f) => {
    // A frame wider than tall takes two columns when there are two or more.
    const span = cols >= 2 && f.w > f.h * 1.15 ? 2 : 1;
    const room = colW * span + GAP * (span - 1);
    const scale = Math.min(1, room / Math.max(1, f.w), (span > 1 ? TALL_WIDE : TALL) / Math.max(1, f.h));
    return { f, span, scale, w: Math.floor(f.w * scale), h: Math.floor(f.h * scale) };
  });
  // Every frame in view is drawn (past MAX_IN_VIEW, a safety cap, the ones nearest the middle); frames just past the view only while fewer than MAX_LIVE are.
  let shownLive = frames.filter((f) => inView.has(f.id));
  const root = body.current;
  if (shownLive.length > MAX_IN_VIEW && root) {
    const r = root.getBoundingClientRect();
    const mid = r.top + r.height / 2;
    const far = (id: string) => {
      const b = root.querySelector(`[data-frame="${CSS.escape(id)}"]`)?.getBoundingClientRect();
      return b ? Math.abs(b.top + b.height / 2 - mid) : Infinity;
    };
    shownLive = [...shownLive].sort((a, b) => far(a.id) - far(b.id)).slice(0, MAX_IN_VIEW);
  }
  const nearLive = frames.filter((f) => seen.has(f.id) && !inView.has(f.id)).slice(0, Math.max(0, MAX_LIVE - shownLive.length));
  const live = new Set(visible ? [...shownLive, ...nearLive].map((f) => f.id) : []);
  // Each frame's page as its iframe gets it, made again only when its HTML or the base changes.
  const docs = useMemo(() => Object.fromEntries(Object.entries(html).map(([id, h]) => [id, docOf(h, read?.base ?? "")])), [html, read?.base]);
  const pages = file ? new Set(frames.map((f) => f.page)).size : 0;

  const open = (frame?: string) => {
    if (frame) landOn(slug, frame);
    // App opens this file's tab with this session and turns the window to Liner Design.
    window.dispatchEvent(new CustomEvent("lc:open-liner-design", { detail: { threadId: thread.id, cwd, file: slug } }));
  };

  // The head's one picker: the file, and the designs shown in chat when there are any; with none, the file's name in words.
  const name = file?.title ?? slug;
  const pick = chat.length ? (
    <Pop label="Designs in this session" menu width={300} triggerClass={PANE_PICK} trigger={<><span className="lc-dz-pname">{name}</span><I.chevD size={12} /></>}>
      {(close) => (
        <div className="lc-dz-menu">
          <PanelHead>Liner Design</PanelHead>
          <Row title={name} icon={<I.design size={14} />} on onPick={close} />
          <Sep />
          <PanelHead>Shown in chat</PanelHead>
          {chat.map((x) => (
            <Row key={x.design} title={x.title} onPick={() => (close(), onChat?.(x.design))} />
          ))}
        </div>
      )}
    </Pop>
  ) : (
    <PaneWords>{name}</PaneWords>
  );
  if (why)
    return (
      <div className="lc-dm">
        <PaneHead shows={pick} />
        <SurfaceNote icon={<I.design size={20} />} title="Design not found">
          {why}
        </SurfaceNote>
      </div>
    );

  const drawing = Object.entries(who)
    .map(([id, w]) => ({ ...w, frame: frames.find((f) => f.id === id)?.name }))
    .filter((w) => w.frame)
    .sort((a, b) => Number(b.lead) - Number(a.lead));
  const status = drawing.length ? drawing : here ? [{ lead: true, name: agentName, frame: undefined }] : [];

  return (
    <div className="lc-dm">
      <PaneHead shows={<>{pick}{file && <PaneWords>{plural(file.frames.length, "frame")}{own ? " · On its own" : ""}</PaneWords>}</>} />
      {/* Always there, so its first words are heard; it says who is drawing, not every frame they move to. */}
      <span className="l-sr-only" role="status">
        {[...new Set(status.map((w) => w.name))].map((n) => `${n} is drawing on the canvas.`).join(" ")}
      </span>
      <div ref={body} className="lc-dm-body">
        {!file ? (
          <span className="l-shimmer lc-dm-wait">Opening the design</span>
        ) : !frames.length ? (
          <p className="lc-quiet lc-dm-none">No frames yet. Ask {agentName} for one, or draw one in Liner Design.</p>
        ) : (
          <div className="lc-dm-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {laid.map(({ f, span, scale, w, h }, i) => {
              const p = who[f.id];
              const src = html[f.id];
              const head = pages > 1 && (i === 0 || laid[i - 1].f.page !== f.page) ? file.pages.find((x) => x.id === f.page)?.name : undefined;
              return [
                head ? (
                  <div key={`p:${f.page}`} className="lc-dm-page" style={{ gridColumn: "1 / -1" }}>
                    {head}
                  </div>
                ) : null,
                <button
                  key={f.id}
                  type="button"
                  className="lc-dm-tile l-focus"
                  data-frame={f.id}
                  style={{ gridColumn: span > 1 ? `span ${span}` : undefined }}
                  aria-label={`Open ${f.name} in Liner Design`}
                  title={`Open ${f.name} in Liner Design`}
                  onClick={() => open(f.id)}
                >
                  <span className="lc-dm-label">
                    <b>{f.name}</b>
                    {p && (
                      <span className="lc-dm-tag" data-lead={p.lead || undefined}>
                        <StateMark state="working" size={12} tint="#fff" />
                        {p.name}
                      </span>
                    )}
                    <span className="lc-dm-size">
                      {f.w} × {f.h}
                    </span>
                  </span>
                  <span className="lc-dm-box" data-on={p ? (p.lead ? "lead" : "side") : undefined} style={{ width: w, height: h }}>
                    {f.missing ? (
                      <span className="lc-dm-note">File gone</span>
                    ) : f.kind === "live" ? (
                      <span className="lc-dm-note">Live page{f.url ? ` · ${f.url}` : ""}</span>
                    ) : src === undefined ? null : blank(src) ? (
                      <span className="lc-dm-note">Nothing drawn yet</span>
                    ) : live.has(f.id) ? (
                      // Clipped square, never round: a rounded clip round a page that moves costs a pass a frame.
                      <span className="lc-dm-clip">
                        <Drawing doc={docs[f.id]} f={f} scale={scale} />
                      </span>
                    ) : null}
                  </span>
                </button>,
              ];
            })}
          </div>
        )}
      </div>
      {/* Who is drawing what, then the one action: the file in Liner Design. */}
      <PaneFoot
        say={
          status.length > 0 && (
            <span className="lc-dm-status" aria-hidden>
              {status.map((w, i) => (
                <span key={i} className="lc-dm-who">
                  <StateMark state="working" size={12} />
                  <span>
                    {w.name} is drawing {w.frame ?? "on the canvas"}
                  </span>
                </span>
              ))}
            </span>
          )
        }
      >
        <PaneButton ink onClick={() => open()}>
          Open in Liner Design
        </PaneButton>
      </PaneFoot>
    </div>
  );
}
