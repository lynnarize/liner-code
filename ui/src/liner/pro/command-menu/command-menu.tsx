/*
  Liner Pro · Command menu
  One field to find and run anything. Fuzzy matches are softly tinted,
  a single highlight glides between rows, and the list height springs as results change.
*/
import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { feedback } from "../../lib/feedback";
import "./command-menu.css";

export type CommandItem = {
  id: string;
  label: string;
  group?: string;
  icon?: ReactNode;
  keywords?: string[];
  /** Keys shown as caps on the right, e.g. ["⌘", "D"]. */
  shortcut?: string[];
  hint?: string;
  /** A nested page of items. Selecting the item opens it. */
  items?: CommandItem[];
  onSelect?: () => void;
  /** Keep the menu open after selecting (toggles, pickers). */
  keepOpen?: boolean;
};

export type CommandMenuProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: CommandItem[];
  placeholder?: string;
  /** Global shortcut with ⌘ or Ctrl. Pass null to disable. */
  hotkey?: string | null;
  footer?: ReactNode;
};

/** Subsequence match that rewards word starts and runs. Returns matched indexes. */
export function fuzzy(query: string, text: string): { score: number; hits: number[] } | null {
  if (!query) return { score: 0, hits: [] };
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const direct = t.indexOf(q);
  if (direct >= 0) {
    const atStart = direct === 0 || /\W/.test(t[direct - 1]);
    return { score: 100 - direct + (atStart ? 40 : 0) + q.length * 4, hits: Array.from({ length: q.length }, (_, i) => direct + i) };
  }
  const hits: number[] = [];
  let score = 0;
  let ti = 0;
  for (const ch of q) {
    if (ch === " ") continue;
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    const prev = hits[hits.length - 1];
    score += found === prev + 1 ? 6 : 1;
    if (found === 0 || /\W/.test(t[found - 1])) score += 8;
    hits.push(found);
    ti = found + 1;
  }
  return { score: score - (t.length - q.length) * 0.05, hits };
}

function Highlight({ text, hits }: { text: string; hits: number[] }) {
  if (!hits.length) return <>{text}</>;
  const set = new Set(hits);
  const out: ReactNode[] = [];
  let run = "";
  let marked = false;
  const flush = (k: number) => {
    if (!run) return;
    out.push(marked ? <mark key={k}>{run}</mark> : <Fragment key={k}>{run}</Fragment>);
    run = "";
  };
  Array.from(text).forEach((ch, i) => {
    const m = set.has(i);
    if (m !== marked) {
      flush(i);
      marked = m;
    }
    run += ch;
  });
  flush(text.length);
  return <>{out}</>;
}

type Page = { title: string; items: CommandItem[] };

export function CommandMenu({ open, onOpenChange, items, placeholder = "Search or run a command", hotkey = "k", footer }: CommandMenuProps) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const [pages, setPages] = useState<Page[]>([]);
  const [active, setActive] = useState(0);
  const [closing, setClosing] = useState(false);
  const [pageDir, setPageDir] = useState<"in" | "out" | null>(null);
  const [hl, setHl] = useState<{ y: number; h: number } | null>(null);
  const [listH, setListH] = useState<number | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const pointerMoved = useRef(false);

  const page = pages[pages.length - 1];
  const source = page ? page.items : items;

  const results = useMemo(() => {
    const scored = source
      .map((item) => {
        // Labels match fuzzily; keywords only by substring, or long ones would match everything.
        const q = query.trim().toLowerCase();
        const m = fuzzy(q, item.label) ?? (q.length > 1 && item.keywords?.some((k) => k.toLowerCase().includes(q)) ? { score: -5, hits: [] } : null);
        return m ? { item, ...m } : null;
      })
      .filter(Boolean) as Array<{ item: CommandItem; score: number; hits: number[] }>;
    if (query.trim()) scored.sort((a, b) => b.score - a.score);
    // Group, keeping the best group first when searching.
    const groups = new Map<string, typeof scored>();
    for (const r of scored) {
      const g = r.item.group ?? "";
      groups.set(g, [...(groups.get(g) ?? []), r]);
    }
    return [...groups.entries()];
  }, [source, query]);
  const flat = results.flatMap(([, rs]) => rs);

  // Hotkey
  useEffect(() => {
    if (!hotkey) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === hotkey) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkey, open, onOpenChange]);

  // Open and close the native dialog, with an exit that plays before it leaves the top layer.
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) {
      restoreRef.current = document.activeElement as HTMLElement | null;
      setClosing(false);
      setQuery("");
      setPages([]);
      setPageDir(null);
      setActive(0);
      setListH(null);
      d.showModal();
      requestAnimationFrame(() => inputRef.current?.focus());
      feedback.play("tap", 4);
    } else if (open && d.open) {
      // Reopened while the exit was playing: stay open. Left closing, the panel would end
      // invisible while the modal still blocks every tap on the page.
      setClosing(false);
      inputRef.current?.focus();
    } else if (!open && d.open) {
      setClosing(true);
      const t = window.setTimeout(() => {
        d.close();
        setClosing(false);
        restoreRef.current?.focus?.();
      }, 160);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query, pages.length]);

  // Measure the active row for the gliding highlight, and the list for its height spring.
  useLayoutEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (row) {
      setHl({ y: row.offsetTop, h: row.offsetHeight });
      if (!pointerMoved.current) row.scrollIntoView({ block: "nearest" });
    } else setHl(null);
    pointerMoved.current = false;
  }, [active, results]);
  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setListH(Math.min(el.offsetHeight, 360)));
    ro.observe(el);
    return () => ro.disconnect();
    // The inner list remounts per page, so observe the new one each time.
  }, [open, pages.length]);

  function select(item: CommandItem) {
    if (item.items) {
      setPageDir("in");
      setPages((p) => [...p, { title: item.label, items: item.items! }]);
      setQuery("");
      feedback.play("tick", 5);
      return;
    }
    setPicked(item.id);
    feedback.play("tap", 6);
    window.setTimeout(() => {
      setPicked(null);
      item.onSelect?.();
      if (!item.keepOpen) onOpenChange(false);
    }, 110);
  }

  function back() {
    setPageDir("out");
    setPages((p) => p.slice(0, -1));
    setQuery("");
  }

  return (
    <dialog
      ref={dialogRef}
      className="l-cmd"
      data-closing={closing || undefined}
      aria-labelledby={`${id}-title`}
      onCancel={(e) => {
        e.preventDefault();
        if (pages.length) back();
        else onOpenChange(false);
      }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div className="l-cmd__panel">
        <h2 id={`${id}-title`} className="l-sr-only">
          Command menu
        </h2>
        <div className="l-cmd__field">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden className="l-cmd__search">
            <circle cx="7.2" cy="7.2" r="4.6" stroke="currentColor" strokeWidth="1.5" />
            <path d="m10.6 10.6 2.9 2.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          {page && (
            <button type="button" className="l-cmd__crumb" key={page.title} onClick={back} aria-label={`Back from ${page.title}`}>
              {page.title}
              <svg viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          <input
            ref={inputRef}
            className="l-cmd__input"
            value={query}
            placeholder={page ? `Search ${page.title.toLowerCase()}` : placeholder}
            role="combobox"
            aria-expanded
            aria-controls={`${id}-list`}
            aria-activedescendant={flat[active] ? `${id}-${flat[active].item.id}` : undefined}
            aria-autocomplete="list"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              const n = flat.length;
              if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
                e.preventDefault();
                if (n) setActive((a) => (a + 1) % n);
              } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
                e.preventDefault();
                if (n) setActive((a) => (a - 1 + n) % n);
              } else if (e.key === "Home" && n) {
                e.preventDefault();
                setActive(0);
              } else if (e.key === "End" && n) {
                e.preventDefault();
                setActive(n - 1);
              } else if (e.key === "Enter") {
                e.preventDefault();
                const r = flat[active];
                if (r) select(r.item);
              } else if (e.key === "Backspace" && !query && pages.length) {
                e.preventDefault();
                back();
              }
            }}
          />
          <kbd className="l-cmd__esc">esc</kbd>
        </div>
        <div className="l-cmd__list" ref={listRef} id={`${id}-list`} role="listbox" style={listH !== null ? { height: listH } : undefined}>
          <div className="l-cmd__inner" ref={innerRef} key={pages.length} data-dir={pageDir ?? undefined}>
            {hl && flat.length > 0 && <span className="l-cmd__hl" style={{ transform: `translateY(${hl.y}px)`, height: hl.h }} aria-hidden />}
            {flat.length === 0 ? (
              <p className="l-cmd__empty" key={query}>
                No results for <q>{query}</q>
              </p>
            ) : (
              results.map(([group, rs]) => (
                <div key={group || "_"} className="l-cmd__group" role="group" aria-label={group || undefined}>
                  {group && <div className="l-cmd__heading">{group}</div>}
                  {rs.map((r) => {
                    const index = flat.indexOf(r);
                    return (
                      <div
                        key={r.item.id}
                        id={`${id}-${r.item.id}`}
                        role="option"
                        aria-selected={index === active}
                        data-index={index}
                        data-active={index === active || undefined}
                        data-picked={picked === r.item.id || undefined}
                        className="l-cmd__item"
                        onPointerMove={() => {
                          if (index !== active) {
                            pointerMoved.current = true;
                            setActive(index);
                          }
                        }}
                        onClick={() => select(r.item)}
                      >
                        {r.item.icon && <span className="l-cmd__icon">{r.item.icon}</span>}
                        <span className="l-cmd__label">
                          <Highlight text={r.item.label} hits={r.hits} />
                        </span>
                        {r.item.hint && <span className="l-cmd__hint">{r.item.hint}</span>}
                        {r.item.shortcut && (
                          <span className="l-cmd__keys">
                            {r.item.shortcut.map((k) => (
                              <kbd key={k}>{k}</kbd>
                            ))}
                          </span>
                        )}
                        {r.item.items && (
                          <svg viewBox="0 0 16 16" fill="none" aria-hidden className="l-cmd__chev">
                            <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
        <div className="l-cmd__foot">
          {footer ?? <span className="l-cmd__brand">Liner</span>}
          <span className="l-cmd__help">
            <kbd>↑</kbd>
            <kbd>↓</kbd> to move <kbd>↵</kbd> to {flat[active]?.item.items ? "open" : "run"}
            {pages.length > 0 && (
              <>
                {" "}
                <kbd>⌫</kbd> back
              </>
            )}
          </span>
        </div>
      </div>
    </dialog>
  );
}
