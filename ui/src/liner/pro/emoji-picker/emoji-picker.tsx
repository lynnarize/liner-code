/*
  Liner Pro · Emoji picker
  Search by name, jump by group, and find what you used last at the top. The group bar is
  monochrome glyphs on glass; the emoji themselves are the only color, as content should be.
  Arrow keys move through the grid and the footer names what is highlighted.
*/
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { useDismiss, useFlip } from "../../lib/overlay";
import { emojiGroups, type Emoji } from "./emoji-data";
import "./emoji-picker.css";

const COLS = 8;
const RECENT_KEY = "liner:emoji-recent";

const icon = (d: string) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);
const GROUP_ICONS: Record<string, ReactNode> = {
  recent: icon("M8 2.25a5.75 5.75 0 1 1 0 11.5 5.75 5.75 0 0 1 0-11.5ZM8 5v3.25l2.1 1.4"),
  smileys: icon("M8 2.25a5.75 5.75 0 1 1 0 11.5 5.75 5.75 0 0 1 0-11.5ZM5.75 9.5c.55.85 1.35 1.25 2.25 1.25s1.7-.4 2.25-1.25M6 6.4v.2M10 6.4v.2"),
  people: icon("M8 7.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5ZM3.5 13.25c.45-2.3 2.3-3.75 4.5-3.75s4.05 1.45 4.5 3.75"),
  nature: icon("M3 13c4-1 8-4.5 9.5-10.5C6.5 3 3.5 6 3 13Zm0 0 5-5"),
  food: icon("M4.5 2.5v4.25a1.75 1.75 0 0 0 3.5 0V2.5M6.25 2.5v11M11 13.5V2.5c-1.4.6-2 2.3-2 4.5 0 1.3.6 2 2 2"),
  activity: icon("M8 2.25a5.75 5.75 0 1 1 0 11.5 5.75 5.75 0 0 1 0-11.5ZM2.5 8h11M8 2.25c1.6 1.6 2.4 3.5 2.4 5.75S9.6 12.15 8 13.75M8 2.25C6.4 3.85 5.6 5.75 5.6 8s.8 4.15 2.4 5.75"),
  travel: icon("M13.5 3 2.5 7.25l4.5 1.75 1.75 4.5L13.5 3Z"),
  objects: icon("M6 13.5h4M6.5 11.25h3M8 2.25a3.75 3.75 0 0 0-2.25 6.75c.45.35.75.85.75 1.4v.85h3v-.85c0-.55.3-1.05.75-1.4A3.75 3.75 0 0 0 8 2.25Z"),
  symbols: icon("M8 13.25S2.75 10.25 2.75 6.4A2.65 2.65 0 0 1 8 5.1a2.65 2.65 0 0 1 5.25 1.3C13.25 10.25 8 13.25 8 13.25Z"),
};

function readRecent(): Emoji[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export type EmojiPanelProps = { onPick: (emoji: string) => void; className?: string };

export function EmojiPanel({ onPick, className }: EmojiPanelProps) {
  const id = useId();
  const [q, setQ] = useState("");
  const [recent, setRecent] = useState<Emoji[]>(readRecent);
  const [active, setActive] = useState(0);
  const [group, setGroup] = useState(recent.length ? "recent" : "smileys");
  const scroller = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const jumping = useRef(false);

  const groups = useMemo(() => {
    const all = recent.length ? [{ id: "recent", label: "Recent", items: recent }, ...emojiGroups] : emojiGroups;
    const s = q.trim().toLowerCase();
    if (!s) return all;
    const hits = emojiGroups.flatMap((x) => x.items).filter((e) => e.n.includes(s));
    return [{ id: "results", label: hits.length ? "Results" : "No emoji found", items: hits }];
  }, [q, recent]);
  const flat = groups.flatMap((x) => x.items);
  const current = flat[active];

  useEffect(() => {
    search.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    const cell = scroller.current?.querySelector<HTMLElement>(`[data-i="${active}"]`);
    cell?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (e: Emoji) => {
    onPick(e.e);
    feedback.play("pop", 4);
    const next = [e, ...recent.filter((r) => r.e !== e.e)].slice(0, COLS * 2);
    setRecent(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      /* private mode: recents last for this visit */
    }
  };
  const onKey = (e: KeyboardEvent) => {
    const d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLS, ArrowUp: -COLS }[e.key];
    if (d && !(e.target === search.current && (e.key === "ArrowLeft" || e.key === "ArrowRight") && q)) {
      e.preventDefault();
      setActive((a) => Math.max(0, Math.min(flat.length - 1, a + d)));
    } else if (e.key === "Enter" && current) {
      e.preventDefault();
      pick(current);
    }
  };
  // The group bar follows the scroll; pressing a group scrolls to it.
  const onScroll = () => {
    if (jumping.current) return;
    const el = scroller.current!;
    const heads = [...el.querySelectorAll<HTMLElement>("[data-group]")];
    const top = el.scrollTop + 8;
    const at = heads.filter((h) => h.offsetTop <= top).pop() ?? heads[0];
    if (at) setGroup(at.dataset.group!);
  };
  const jump = (gid: string) => {
    setQ("");
    setGroup(gid);
    jumping.current = true;
    requestAnimationFrame(() => {
      const el = scroller.current?.querySelector<HTMLElement>(`[data-group="${gid}"]`);
      scroller.current?.scrollTo({ top: (el?.offsetTop ?? 0) - 4, behavior: "smooth" });
      window.setTimeout(() => (jumping.current = false), 450);
    });
  };

  let i = 0;
  return (
    <div className={cx("l-emoji", className)} onKeyDown={onKey}>
      <div className="l-emoji__search">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
          <circle cx="7.2" cy="7.2" r="4.6" />
          <path d="m10.6 10.6 2.9 2.9" />
        </svg>
        <input ref={search} placeholder="Search emoji" aria-label="Search emoji" aria-controls={`${id}-grid`} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!q && (
        <div className="l-emoji__tabs" role="tablist" aria-label="Groups">
          {(recent.length ? ["recent", ...emojiGroups.map((x) => x.id)] : emojiGroups.map((x) => x.id)).map((gid) => (
            <button key={gid} type="button" role="tab" aria-selected={group === gid} aria-label={gid === "recent" ? "Recent" : emojiGroups.find((x) => x.id === gid)?.label} data-on={group === gid || undefined} onClick={() => jump(gid)}>
              {GROUP_ICONS[gid]}
            </button>
          ))}
        </div>
      )}
      <div ref={scroller} className="l-emoji__scroll" id={`${id}-grid`} role="grid" aria-label="Emoji" onScroll={onScroll}>
        {groups.map((grp) => (
          <section key={grp.id} data-group={grp.id} aria-label={grp.label}>
            <h4 className="l-emoji__head">{grp.label}</h4>
            <div className="l-emoji__grid">
              {grp.items.map((e) => {
                const n = i++;
                return (
                  <button key={`${grp.id}${e.e}`} type="button" role="gridcell" tabIndex={-1} data-i={n} data-active={n === active || undefined} aria-label={e.n} onPointerMove={() => n !== active && setActive(n)} onClick={() => pick(e)}>
                    {e.e}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <div className="l-emoji__foot" aria-live="polite">
        {current ? (
          <>
            <span className="l-emoji__big" key={current.e}>
              {current.e}
            </span>
            <span className="l-emoji__name" key={current.n}>
              {current.n}
            </span>
          </>
        ) : (
          <span className="l-emoji__name">Try another word</span>
        )}
      </div>
    </div>
  );
}

export type EmojiPickerProps = { onPick: (emoji: string) => void; label?: string; className?: string };

/** A smiley button that opens the panel on glass. */
export function EmojiPicker({ onPick, label = "Add emoji", className }: EmojiPickerProps) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const side = useFlip(open, btn, pop, "top");
  useDismiss(open, () => setOpen(false), [wrap], btn);
  return (
    <div ref={wrap} className={cx("l-anchor l-emojipick", className)}>
      <button ref={btn} type="button" className="l-emojipick__btn l-plate" aria-label={label} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {GROUP_ICONS.smileys}
      </button>
      {open && (
        <div ref={pop} className="l-pop l-emojipick__pop" data-side={side} data-align="start" role="dialog" aria-label={label}>
          <EmojiPanel
            onPick={(e) => {
              onPick(e);
            }}
          />
        </div>
      )}
    </div>
  );
}
