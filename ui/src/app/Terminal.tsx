/*
  The Terminal surface: a real shell in the session's folder (its worktree, when it has one).
  It keeps running while you look at other tabs, follows the panel's size, and takes the
  app's colours. When the shell exits, one press starts a new one. A project script runs in a
  shell of its own, as a tab beside the first.
*/
import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { Thread } from "@contracts";
import { onStream, rpc, useEngine } from "./engine";
import { I } from "./icons";
import { cssVar, hexOf, takeScripts, onScript } from "./Surfaces";
import { toComposer } from "./Find";

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

/** One shell. With `command`, it types that in once the shell is up (a project script). */
function TermPane({ thread, visible, command }: { thread: Thread; visible: boolean; command?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const term = useRef<XTerm | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const idRef = useRef<string | null>(null);
  const [gen, setGen] = useState(0);
  const [st, setSt] = useState<{ cwd?: string; exited?: number; error?: string }>({});
  const [picked, setPicked] = useState("");
  const project = useEngine((s) => s.projects.find((p) => p.id === thread.projectId));

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const t = new XTerm({
      fontFamily: `${cssVar("--l-font-mono") || "ui-monospace"}, Menlo, monospace`,
      fontSize: 12.5,
      lineHeight: 1.3,
      cursorBlink: true,
      allowTransparency: true,
      scrollback: 5000,
      theme: themeNow(),
      macOptionIsMeta: true,
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
    let live = true;
    setSt({});
    const off = onStream((e) => {
      if (e.type === "term" && e.id === idRef.current) t.write(e.data);
      if (e.type === "term.exit" && e.id === idRef.current) {
        idRef.current = null;
        setSt((s) => ({ ...s, exited: e.code }));
      }
    });
    void rpc("term.open", { threadId: thread.id, cols: t.cols || 80, rows: t.rows || 24, command: gen === 0 ? command : undefined })
      .then((r) => {
        if (!live) return void rpc("term.close", { id: r.id }).catch(() => {});
        idRef.current = r.id;
        setSt({ cwd: r.cwd });
      })
      .catch((e) => live && setSt({ error: e instanceof Error ? e.message : String(e) }));
    const selection = t.onSelectionChange(() => setPicked(t.getSelection().trim().slice(0, 8000)));
    const input = t.onData((d) => {
      if (idRef.current) void rpc("term.write", { id: idRef.current, data: d }).catch(() => {});
    });
    // The panel resizes it; a frame later the shell hears the new size.
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!el.offsetWidth || !el.offsetHeight) return;
        try {
          f.fit();
        } catch {
          return;
        }
        if (idRef.current) void rpc("term.resize", { id: idRef.current, cols: t.cols, rows: t.rows }).catch(() => {});
      });
    });
    ro.observe(el);
    // The theme follows light and dark.
    const mo = new MutationObserver(() => (t.options.theme = themeNow()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-accent"] });
    return () => {
      live = false;
      off();
      input.dispose();
      selection.dispose();
      ro.disconnect();
      mo.disconnect();
      cancelAnimationFrame(raf);
      if (idRef.current) void rpc("term.close", { id: idRef.current }).catch(() => {});
      idRef.current = null;
      t.dispose();
      term.current = null;
    };
  }, [thread.id, gen]);

  // Coming back to the tab: fit and take the keyboard.
  useEffect(() => {
    if (!visible) return;
    const r = requestAnimationFrame(() => {
      try {
        fit.current?.fit();
      } catch {
        // hidden
      }
      term.current?.focus();
    });
    return () => cancelAnimationFrame(r);
  }, [visible]);

  const where = st.cwd && project ? (st.cwd.startsWith(project.path) ? `${project.name}${st.cwd.slice(project.path.length) || ""}` : st.cwd) : "";

  return (
    <div className="lc-term">
      <div className="lc-term-bar">
        <I.terminal size={13} />
        <span className="lc-mono lc-term-where" title={st.cwd}>
          {where || "Starting a shell"}
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
        <button type="button" className="lc-ib l-focus" aria-label="Clear" title="Clear" onClick={() => term.current?.clear()}>
          <I.trash size={13} />
        </button>
        <button type="button" className="lc-ib l-focus" aria-label="A new shell" title="A new shell" onClick={() => setGen((g) => g + 1)}>
          <I.refresh size={13} />
        </button>
      </div>
      {st.error && <p className="lc-term-err">{st.error}</p>}
      <div ref={box} className="lc-term-box" onClick={() => term.current?.focus()} />
    </div>
  );
}

type Pane = { key: string; title: string; command?: string };

export function TerminalSurface({ thread, visible }: { thread: Thread; visible: boolean }) {
  const [panes, setPanes] = useState<Pane[]>(() => [{ key: "shell", title: "Shell" }, ...takeScripts(thread.id).map((x, i) => ({ key: `s${Date.now()}${i}`, title: x.name, command: x.command }))]);
  const [on, setOn] = useState(() => panes[panes.length - 1].key);
  useEffect(
    () =>
      onScript(thread.id, (x) => {
        const key = `s${Date.now()}`;
        setPanes((p) => [...p, { key, title: x.name, command: x.command }]);
        setOn(key);
      }),
    [thread.id],
  );
  const close = (key: string) => {
    setPanes((p) => {
      const next = p.filter((x) => x.key !== key);
      if (on === key) setOn(next[next.length - 1]?.key ?? "shell");
      return next.length ? next : [{ key: "shell", title: "Shell" }];
    });
  };
  return (
    <div className="lc-terms">
      {panes.length > 1 && (
        <div className="lc-terms-tabs" role="tablist" aria-label="Shells">
          {panes.map((p) => (
            <span key={p.key} className="lc-terms-tab" data-on={p.key === on || undefined}>
              <button type="button" role="tab" aria-selected={p.key === on} className="l-focus" onClick={() => setOn(p.key)} title={p.command ?? "A shell"}>
                {p.command ? <I.play size={10} /> : <I.terminal size={11} />}
                {p.title}
              </button>
              <button type="button" className="lc-terms-x l-focus" aria-label={`Close ${p.title}`} onClick={() => close(p.key)}>
                <I.close size={9} />
              </button>
            </span>
          ))}
        </div>
      )}
      {panes.map((p) => (
        <div key={p.key} className="lc-terms-pane" hidden={p.key !== on}>
          <TermPane thread={thread} visible={visible && p.key === on} command={p.command} />
        </div>
      ))}
    </div>
  );
}
