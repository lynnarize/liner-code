/*
  The Terminal surface: a real shell in the session's folder (its worktree, when it has one).
  The shells live in the engine, not here: switching sessions or shutting the panel only lets go
  of the view, and coming back attaches to the same shells and replays what they printed, so a
  dev server started from a script keeps running (T3 Code: web components/PersistentThreadTerminals.tsx,
  ThreadTerminalDrawer.tsx). A shell ends when you close its tab. It follows the panel's size and
  takes the app's colours. A project script runs in a shell of its own, as a tab beside the first.
  ⌘-click a local address to open it in the session's Browser, a file's path to open it in Files,
  and any other link in your browser.
*/
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Terminal as XTerm, type ILink } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { Thread } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { browseTo } from "./agentBrowser";
import { bridge } from "./bridge";
import { onStream, rpc, useEngine } from "./engine";
import { I } from "./icons";
import { cssVar, hexOf, takeScripts, onScript } from "./Surfaces";
import { toComposer } from "./Find";
import { Pop, Row } from "./ui";

function themeNow() {
  const ink = hexOf(cssVar("--l-ink"), "#1d1f24");
  return {
    background: "#00000000",
    foreground: ink,
    cursor: ink,
    cursorAccent: hexOf(cssVar("--l-surface"), "#ffffff"),
    selectionBackground: hexOf(`color-mix(in oklab, ${cssVar("--l-accent")} 24%, transparent)`, "#2f7ae540"),
  };
}

/** Fits the shell to its box; one that was following its output still is (T3 Code: ThreadTerminalDrawer.tsx). */
function fitKeepingEnd(t: XTerm, f: FitAddon) {
  const buf = t.buffer.active;
  const atEnd = buf.viewportY >= buf.baseY;
  f.fit();
  if (atEnd) t.scrollToBottom();
}

/* ---------- A session's tabs, kept while the app is open ---------- */

/** A tab: its terminal in the engine once it has one (`id`), and how often it was started afresh (`gen`). */
type Pane = { key: string; title: string; command?: string; id?: string; gen: number };
type Tabs = { panes: Pane[]; on: string };
const NONE: Tabs = { panes: [], on: "" };
const tabsOf = new Map<string, Tabs>();
const watchers = new Set<() => void>();
const put = (threadId: string, f: (t: Tabs) => Tabs) => {
  tabsOf.set(threadId, f(tabsOf.get(threadId) ?? NONE));
  for (const w of watchers) w();
};
const useTabs = (threadId: string) =>
  useSyncExternalStore(
    (f) => (watchers.add(f), () => void watchers.delete(f)),
    () => tabsOf.get(threadId) ?? NONE,
  );
let seq = 0;
const newKey = () => `p${Date.now().toString(36)}${seq++}`;
const shellPane = (): Pane => ({ key: newKey(), title: "Shell", gen: 0 });

/**
  A tab's terminal is opened once: a view that comes and goes while it's on its way waits for the
  same one. One that arrives for a tab closed or started afresh meanwhile is closed again.
*/
const opening = new Map<string, Promise<string>>();
function start(threadId: string, pane: Pane, cols: number, rows: number) {
  let p = opening.get(pane.key);
  if (p) return p;
  // Opened already: a view that read the tab before it had its id takes the one it has.
  const have = tabsOf.get(threadId)?.panes.find((x) => x.key === pane.key)?.id;
  if (have) return Promise.resolve(have);
  p = rpc("term.open", { threadId, cols, rows, title: pane.title, command: pane.gen === 0 ? pane.command : undefined }).then((r) => {
    const wanted = opening.get(pane.key) === p && (tabsOf.get(threadId)?.panes.some((x) => x.key === pane.key) ?? false);
    if (!wanted) {
      void rpc("term.close", { id: r.id }).catch(() => {});
      throw new Error("That shell was closed.");
    }
    // The engine's list may have brought it back as a tab of its own meanwhile; this one keeps it.
    put(threadId, (t) => ({ ...t, panes: t.panes.filter((x) => x.key === pane.key || x.id !== r.id).map((x) => (x.key === pane.key ? { ...x, id: r.id } : x)) }));
    // The tab holds its id now, so the promise needn't be kept for the app's lifetime.
    if (opening.get(pane.key) === p) opening.delete(pane.key);
    return r.id;
  });
  p.catch(() => opening.get(pane.key) === p && opening.delete(pane.key));
  opening.set(pane.key, p);
  return p;
}
/** Ends a terminal in the engine: its tab was closed, or it was started afresh. */
const end = (id?: string) => {
  if (id) void rpc("term.close", { id }).catch(() => {});
};
/** The engine's list is the truth: tabs whose shells it no longer has go, ones it has that aren't shown come back. */
const reconcile = (k: Tabs, list: { id: string; title: string; command?: string }[] | null, extra: Pane[] = []): Tabs => {
  let panes = k.panes;
  if (list) {
    const ids = new Set(list.map((x) => x.id));
    panes = panes.filter((p) => !p.id || ids.has(p.id));
    for (const x of list) if (!panes.some((p) => p.id === x.id)) panes = [...panes, { key: x.id, title: x.title, command: x.command, id: x.id, gen: 1 }];
  }
  panes = [...panes, ...extra];
  if (!panes.length) panes = [shellPane()];
  const on = extra.at(-1)?.key ?? (panes.some((p) => p.key === k.on) ? k.on : panes[panes.length - 1].key);
  return { panes, on };
};
/** A tab's shell: its id, from the tab as it is now if the one in hand was read before it had one, else the open on its way. */
const idOf = (pane: Pane): Promise<string | undefined> => {
  const id = pane.id ?? [...tabsOf.values()].flatMap((t) => t.panes).find((x) => x.key === pane.key)?.id;
  return id ? Promise.resolve(id) : (opening.get(pane.key)?.catch(() => undefined) ?? Promise.resolve(undefined));
};

/* ---------- Links ---------- */

const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const LOCAL = /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d{2,5}(?:[/?#]|$)/i;
const URLS = /\bhttps?:\/\/[^\s"'`<>]+|\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d{2,5}(?:\/[^\s"'`<>]*)?/gi;
// A path with a folder in it (src/app.ts, ./x/y.tsx:12, /abs/z.ts:3:7), or a file's name with a line (App.tsx:12).
const PATHS = /(?<![\w.@/~+-])(?:\.\/|\/)?[\w@+-][\w@.+-]*(?:\/[\w@.+-]+)+(?::\d+){0,2}|(?<![\w.@/~+-])[\w@+-][\w@.+-]*\.[A-Za-z]\w{0,9}:\d+(?::\d+)?/g;

type Found = { text: string; start: number; end: number };

/** The links in a line of output, like T3 Code's terminal-links.ts: URLs first, then paths that aren't part of one. */
function findLinks(line: string): Found[] {
  const urls: Found[] = [];
  for (const m of line.matchAll(URLS)) {
    const text = m[0].replace(/[.,;!?)\]}'"]+$/, "");
    if (text) urls.push({ text, start: m.index, end: m.index + text.length });
  }
  const paths: Found[] = [];
  for (const m of line.matchAll(PATHS)) {
    const text = m[0].replace(/[.,;:!?)\]}'"]+$/, "");
    const end = m.index + text.length;
    // A file, not a folder or a fraction: its last part has an extension.
    if (!/\.[A-Za-z]\w*$/.test(text.replace(/(?::\d+){1,2}$/, ""))) continue;
    if (urls.some((u) => m.index < u.end && u.start < end)) continue;
    paths.push({ text, start: m.index, end });
  }
  return [...urls, ...paths].sort((a, b) => a.start - b.start);
}

/** The links on a row, with wrapped rows read as the one line they are; ranges are 1-based and end on their last cell. */
function linksAt(t: XTerm, y: number, make: (text: string) => Omit<ILink, "range" | "text">): ILink[] | undefined {
  const buf = t.buffer.active;
  let first = y - 1;
  while (first > 0 && buf.getLine(first)?.isWrapped) first--;
  const rows: { y: number; from: number }[] = [];
  let text = "";
  for (let i = first; i < first + 50; i++) {
    const line = buf.getLine(i);
    if (!line) break;
    const more = buf.getLine(i + 1)?.isWrapped === true;
    rows.push({ y: i + 1, from: text.length });
    text += line.translateToString(!more);
    if (!more) break;
  }
  if (!rows.length) return undefined;
  const cell = (index: number) => {
    const r = rows.findLast((x) => index >= x.from) ?? rows[0];
    return { x: index - r.from + 1, y: r.y };
  };
  const found = findLinks(text).map((f) => ({ range: { start: cell(f.start), end: cell(f.end - 1) }, text: f.text, ...make(f.text) }));
  return found.length ? found : undefined;
}

/** One shell's view. Its terminal is opened the first time, then attached to every time after. */
/** One shell. In the bottom panel its bar sits in the panel's strip (`slot`), so nothing stacks over the output. */
function TermPane({ thread, pane, visible, onRestart, slot }: { thread: Thread; pane: Pane; visible: boolean; onRestart: () => void; slot?: HTMLElement | null }) {
  const box = useRef<HTMLDivElement>(null);
  const term = useRef<XTerm | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const idRef = useRef<string | null>(null);
  const cwdRef = useRef("");
  const latest = useRef(pane);
  latest.current = pane;
  const [st, setSt] = useState<{ cwd?: string; exited?: number; error?: string }>({});
  const [picked, setPicked] = useState("");
  const project = useEngine((s) => s.projects.find((p) => p.id === thread.projectId));

  /** Where a ⌘-click goes: this Mac's pages to the Browser, files to Files, the rest to your browser. */
  const follow = (e: MouseEvent, text: string) => {
    if (!(mac ? e.metaKey : e.ctrlKey)) return;
    if (LOCAL.test(text)) return void browseTo(thread.id, text).catch((err: Error) => toast.error(err.message));
    if (/^https?:\/\//i.test(text)) return bridge.openExternal(text);
    const m = /^(.*?)(?::(\d+))?(?::\d+)?$/.exec(text);
    let path = m?.[1] ?? text;
    const line = m?.[2] ? Number(m[2]) : undefined;
    const root = cwdRef.current;
    if (path.startsWith("/")) {
      if (!root || !path.startsWith(`${root}/`)) return toast("That file is outside this session's folder", { description: path });
      path = path.slice(root.length + 1);
    }
    window.dispatchEvent(new CustomEvent("lc:open-file", { detail: { path: path.replace(/^\.\//, ""), line, threadId: thread.id } }));
  };
  const followRef = useRef(follow);
  followRef.current = follow;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const hint = mac ? "⌘-click to open" : "Ctrl-click to open";
    const t = new XTerm({
      fontFamily: `${cssVar("--l-font-mono") || "ui-monospace"}, Menlo, monospace`,
      fontSize: 12.5,
      lineHeight: 1.3,
      cursorBlink: true,
      allowTransparency: true,
      scrollback: 5000,
      theme: themeNow(),
      macOptionIsMeta: true,
      // OSC 8 links (a tool's own hyperlinks) go where a ⌘-click on any link goes.
      linkHandler: { activate: (e, uri) => followRef.current(e, uri), hover: () => (el.title = hint), leave: () => (el.title = "") },
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.open(el);
    term.current = t;
    fit.current = f;
    try {
      f.fit();
    } catch {
      // not laid out yet
    }
    const links = t.registerLinkProvider({
      provideLinks: (y, done) =>
        done(
          linksAt(t, y, (text) => ({
            decorations: { pointerCursor: true, underline: true },
            activate: (e) => followRef.current(e, text),
            hover: () => (el.title = hint),
            leave: () => (el.title = ""),
          })),
        ),
    });
    let live = true;
    idRef.current = null;
    setSt({});
    setPicked("");
    // Live output that comes before the backlog waits for it; then only what the backlog lacks is written.
    let held: { data: string; at?: number }[] | null = [];
    let seen = 0;
    const take = (data: string, at?: number) => {
      if (at === undefined) return void t.write(data);
      if (at + data.length <= seen) return;
      t.write(at < seen ? data.slice(seen - at) : data);
      seen = at + data.length;
    };
    const off = onStream((e) => {
      if (e.type === "term" && e.id === idRef.current) {
        if (held) held.push(e);
        else take(e.data, e.at);
      }
      if (e.type === "term.exit" && e.id === idRef.current) setSt((s) => ({ ...s, exited: e.code }));
    });
    const p = latest.current;
    void (p.id ? Promise.resolve(p.id) : start(thread.id, p, t.cols || 80, t.rows || 24))
      .then(async (id) => {
        if (!live) return;
        idRef.current = id;
        const a = await rpc("term.attach", { id });
        if (!live) return;
        if (a.text) t.write(a.text);
        seen = a.end;
        for (const e of held ?? []) take(e.data, e.at);
        held = null;
        cwdRef.current = a.cwd;
        setSt({ cwd: a.cwd, exited: a.exited });
        // The shell hears this view's size, which may not be the one it last had.
        if (a.exited === undefined) tell(true);
      })
      .catch((e) => live && setSt({ error: e instanceof Error ? e.message : String(e) }));
    const selection = t.onSelectionChange(() => setPicked(t.getSelection().trim().slice(0, 8000)));
    const input = t.onData((d) => {
      if (idRef.current)
        void rpc("term.write", { id: idRef.current, data: d }).catch((e) => {
          if (live) setSt((s) => ({ ...s, error: e instanceof Error ? e.message : "The terminal stopped answering." }));
        });
    });
    /*
      The panel resizes it; once the panel has settled the view refits and the shell hears the new
      size, only if it is a new one. A slide or a drag of the grip is many frames: refitting 5,000
      rows of scrollback and a SIGWINCH on each made zsh, vim or an agent's screen redraw every frame.
    */
    let settle = 0;
    let told = "";
    const tell = (always = false) => {
      const id = idRef.current;
      const size = `${t.cols}x${t.rows}`;
      if (!id || (!always && size === told)) return;
      told = size;
      void rpc("term.resize", { id, cols: t.cols, rows: t.rows }).catch(() => {});
    };
    const ro = new ResizeObserver(() => {
      window.clearTimeout(settle);
      settle = window.setTimeout(() => {
        if (!el.offsetWidth || !el.offsetHeight) return;
        try {
          fitKeepingEnd(t, f);
        } catch {
          return;
        }
        tell();
      }, 100);
    });
    ro.observe(el);
    // The theme follows light and dark, and your own theme and accent, which go on the root's style (look.ts).
    const mo = new MutationObserver(() => (t.options.theme = themeNow()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-accent", "style"] });
    // Letting go of the view leaves the shell running; closing its tab is what ends it.
    return () => {
      live = false;
      off();
      links.dispose();
      input.dispose();
      selection.dispose();
      ro.disconnect();
      mo.disconnect();
      window.clearTimeout(settle);
      idRef.current = null;
      t.dispose();
      term.current = null;
    };
  }, [thread.id, pane.key, pane.gen]);

  // Coming back to the tab: fit and take the keyboard.
  useEffect(() => {
    if (!visible) return;
    const r = requestAnimationFrame(() => {
      try {
        if (term.current && fit.current) fitKeepingEnd(term.current, fit.current);
      } catch {
        // hidden
      }
      term.current?.focus();
    });
    return () => cancelAnimationFrame(r);
  }, [visible]);

  const where = st.cwd && project ? (st.cwd.startsWith(project.path) ? `${project.name}${st.cwd.slice(project.path.length) || ""}` : st.cwd) : "";
  const [finding, setFinding] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findHit, setFindHit] = useState<{ line: number; total: number } | null>(null);
  const findInput = useRef<HTMLInputElement>(null);

  const searchScrollback = (query: string, dir: 1 | -1 = 1) => {
    const t = term.current;
    const q = query.trim().toLowerCase();
    if (!t || !q) return void setFindHit(null);
    const buf = t.buffer.active;
    const matches: number[] = [];
    for (let i = 0; i < buf.length; i++) {
      const line = buf.getLine(i)?.translateToString(true) ?? "";
      if (line.toLowerCase().includes(q)) matches.push(i);
    }
    if (!matches.length) return void setFindHit({ line: 0, total: 0 });
    const prevIdx = findHit && findHit.line > 0 ? matches.indexOf(findHit.line - 1) : -1;
    const nextIdx = prevIdx < 0 ? (dir > 0 ? matches.length - 1 : 0) : (prevIdx + dir + matches.length) % matches.length;
    const targetLine = matches[nextIdx];
    t.scrollToLine(Math.max(0, targetLine - Math.floor(t.rows / 2)));
    setFindHit({ line: targetLine + 1, total: matches.length });
  };

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f" && box.current?.closest(".lc-term")?.contains(document.activeElement)) {
        e.preventDefault();
        setFinding(true);
        requestAnimationFrame(() => findInput.current?.focus());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible]);

  const barParts: ReactNode = (
    <>
        <I.terminal size={14} />
        <span className="lc-mono lc-term-where" title={st.cwd}>
          {where || (st.error ? "No shell" : "Starting a shell")}
        </span>
        <span className="lc-grow" />
        {st.exited !== undefined && <span className="lc-quiet">Exited with {st.exited}</span>}
        {picked && (
          <button
            type="button"
            className="lc-btn"
            data-kind="plain"
            data-size="sm"
            title="Put the selected output in the composer"
            onClick={() => {
              toComposer(thread.id, `From the terminal:\n\n\`\`\`\n${picked}\n\`\`\`\n\n`);
              term.current?.clearSelection();
              setPicked("");
            }}
          >
            <I.comment size={12} />
            Ask about this
          </button>
        )}
        {/* The rest of a shell's tools under one ···, as every surface's top row has them. */}
        <Pop label="More for this shell" menu align="end" width={220} triggerClass="lc-ib" triggerAttrs={{ title: "More" }} trigger={<I.more size={14} />}>
          {(close) => (
            <>
              <Row
                title="Clear"
                icon={<I.trash size={16} />}
                onPick={() => {
                  close();
                  term.current?.clear();
                  if (idRef.current) void rpc("term.clear", { id: idRef.current }).catch(() => {});
                }}
              />
              <Row title="Restart the shell" note="In this tab" icon={<I.refresh size={16} />} onPick={() => (close(), onRestart())} />
            </>
          )}
        </Pop>
    </>
  );
  return (
    <div className="lc-term">
      {slot ? visible && createPortal(barParts, slot) : <div className="lc-term-bar">{barParts}</div>}
      {finding && (
        <div className="lc-find" role="search" aria-label="Find in terminal">
          <I.search size={13} />
          <input
            ref={findInput}
            value={findQuery}
            placeholder="Find in terminal output"
            aria-label="Find in terminal output"
            onChange={(e) => {
              setFindQuery(e.target.value);
              searchScrollback(e.target.value, -1);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setFinding(false);
                term.current?.focus();
              } else if (e.key === "Enter") {
                e.preventDefault();
                searchScrollback(findQuery, e.shiftKey ? -1 : 1);
              }
            }}
          />
          {findHit && <span className="lc-quiet l-num">{findHit.total ? `line ${findHit.line} (${findHit.total})` : "No match"}</span>}
          <button type="button" className="lc-ib l-focus" aria-label="Previous match" onClick={() => searchScrollback(findQuery, -1)}>
            <I.chevU size={12} />
          </button>
          <button type="button" className="lc-ib l-focus" aria-label="Next match" onClick={() => searchScrollback(findQuery, 1)}>
            <I.chevD size={12} />
          </button>
          <button type="button" className="lc-ib l-focus" aria-label="Close search" onClick={() => (setFinding(false), term.current?.focus())}>
            <I.close size={12} />
          </button>
        </div>
      )}
      {st.error && <p className="lc-term-err">{st.error}</p>}
      <div ref={box} className="lc-term-box" onClick={() => term.current?.focus()} />
    </div>
  );
}

/**
  The session's shells. In the dock they're a surface; in the bottom panel (`below`) they're the
  panel itself: its strip is their tabs, a + for a new shell, and the open one's folder and tools.
  The right edge's lit Terminal icon puts the panel away, as it does every surface, so the strip
  has no Hide of its own.
*/
/** `lead` starts the bottom panel's row of shells: the project's scripts, which open as tabs of this row. */
export function TerminalSurface({ thread, visible, below, lead }: { thread: Thread; visible: boolean; below?: boolean; lead?: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const tabs = useTabs(thread.id);
  // The engine's list is the truth: the tabs come back after a reload, and ones whose shells it
  // no longer has (it restarted) go. A tab still opening could come back from the list as a second
  // tab, so views wait for it, unless every tab already has its shell (coming back to a session).
  const [ready, setReady] = useState(() => {
    const known = tabsOf.get(thread.id)?.panes ?? [];
    return known.length > 0 && known.every((p) => p.id);
  });
  useEffect(() => {
    let live = true;
    const scripts = takeScripts(thread.id).map((x): Pane => ({ key: newKey(), title: x.name, command: x.command, gen: 0 }));
    void rpc("term.list", { threadId: thread.id })
      .catch(() => null)
      .then((list) => {
        put(thread.id, (k) => reconcile(k, list, scripts));
        if (live) setReady(true);
      });
    return () => {
      live = false;
    };
  }, [thread.id]);
  // A restarted engine has none of the old shells and sends no exit for them: on reconnecting, the list is asked again.
  const connected = useEngine((s) => s.connected);
  const wasOn = useRef(connected);
  useEffect(() => {
    const back = connected && !wasOn.current;
    wasOn.current = connected;
    if (!back) return;
    void rpc("term.list", { threadId: thread.id })
      .then((list) => put(thread.id, (k) => reconcile(k, list)))
      .catch(() => {});
  }, [connected, thread.id]);
  useEffect(
    () =>
      onScript(thread.id, (x) => {
        const p: Pane = { key: newKey(), title: x.name, command: x.command, gen: 0 };
        put(thread.id, (k) => ({ panes: [...k.panes, p], on: p.key }));
      }),
    [thread.id],
  );

  const setOn = (key: string) => put(thread.id, (k) => ({ ...k, on: key }));
  // Closing a tab ends its shell; the last one closed leaves a fresh shell in its place.
  const close = (p: Pane) => {
    void idOf(p).then(end);
    opening.delete(p.key);
    put(thread.id, (k) => {
      const rest = k.panes.filter((x) => x.key !== p.key);
      const panes = rest.length ? rest : [shellPane()];
      return { panes, on: k.on === p.key || !rest.length ? panes[panes.length - 1].key : k.on };
    });
  };
  // The shell started again in the same tab: the old one ends, and a script isn't run again.
  const restart = (p: Pane) => {
    void idOf(p).then(end);
    opening.delete(p.key);
    put(thread.id, (k) => ({ ...k, panes: k.panes.map((x) => (x.key === p.key ? { ...x, id: undefined, gen: x.gen + 1 } : x)) }));
  };

  const { panes, on } = tabs;
  if (!ready || !panes.length)
    return (
      <div className="lc-diff-wait">
        <span className="l-shimmer">Opening a terminal</span>
      </div>
    );
  return (
    <div className="lc-terms" data-below={below ? "" : undefined}>
      {(panes.length > 1 || below) && (
        <div className="lc-terms-tabs" role="tablist" aria-label="Shells">
          {below && lead}
          {panes.map((p) => (
            <span key={p.key} className="lc-terms-tab" data-on={p.key === on || undefined}>
              <button type="button" role="tab" aria-selected={p.key === on} className="l-focus" onClick={() => setOn(p.key)} title={p.command ?? "A shell"}>
                {p.command ? <I.play size={12} /> : <I.terminal size={12} />}
                {p.title}
              </button>
              <button type="button" className="lc-terms-x l-focus" aria-label={`Close ${p.title}`} onClick={() => close(p)}>
                <I.close size={12} />
              </button>
            </span>
          ))}
          {below && (
            <>
              <button type="button" className="lc-ib l-focus" aria-label="A new shell" title="A new shell" onClick={() => put(thread.id, (k) => { const n = shellPane(); return { panes: [...k.panes, n], on: n.key }; })}>
                <I.plus size={14} />
              </button>
              <span className="lc-grow" />
              <span ref={setSlot} className="lc-below-tools" />
            </>
          )}
        </div>
      )}
      {panes.map((p) => (
        <div key={p.key} className="lc-terms-pane" hidden={p.key !== on}>
          <TermPane thread={thread} pane={p} visible={visible && p.key === on} onRestart={() => restart(p)} slot={below ? slot : undefined} />
        </div>
      ))}
    </div>
  );
}
