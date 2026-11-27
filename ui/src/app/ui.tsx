/*
  Small pieces the screens share: an anchored glass panel with rich rows, agent discs, the
  model chip, badges and the session's status mark.
*/
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useDismiss } from "@liner/lib/overlay";
import { cx } from "@liner/lib/hooks";
import type { AgentProfile, LimitWindow } from "@contracts";
import { Glyph, I, ModelMark, N, StateMark, type MarkKind, type MarkState } from "./icons";
import { clock } from "./model";
import { stopIgnored } from "./stop-guard";
import { CONFIRM_LAPSE, confirmPress } from "./confirm";
import { shortcutOf } from "./keymap";
import { panelLeft, panelSide, placeMenu, sideMenuLeft, TOP_ROW, type Box } from "./menu-place";
import { backFromSide, FIRST_FOCUS, inText, movesRows } from "./menu-keys";
import * as os from "./os";
import { RollingNumber } from "@liner/components/rolling-number/rolling-number";
import { Switch, type SwitchProps } from "@liner/components/switch/switch";

/** A callback that keeps one identity while it calls the latest one given, so it doesn't redraw what it's handed to (a memoised Turn, Session, a sidebar row). */
export function useSteady<A extends unknown[], R = void>(fn: ((...a: A) => R) | undefined) {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...a: A) => ref.current?.(...a) as R, []);
}

type Side = "top" | "bottom";
const EDGE = 10;
const GAP = 6;
type Place = { side: Side | "left" | "right"; top: number; left: number; max?: number; w?: number; ready: boolean };

/** The least room a panel that keeps its side needs there, before it gives up and flips. */
const KEEP_MIN = 260;

/**
  Where a panel opens. Panels live in a layer above the whole window (a portal), so no sidebar,
  paper or scroller clips them. It takes the preferred side when it fits, else the side with more
  room, is never taller than that room (it scrolls inside), and stays inside the window sideways.
  One that `keep`s its side stays there while it has a fair room, and fits itself to it. One
  `beside` its trigger opens to its left, level with it, while there's room there. One kept
  `within` an element (the sidebar's foot menu) stays inside that element's box, its padding
  apart, sideways: never wider than it, never past its edges; `width` "within" is its whole width.
  One beside on the right opens past that element's right edge instead (the sidebar's Carry on
  opens beside the sidebar, never over your sessions), its top a little above the trigger's so
  its title sits level with it; with no room there it opens under the trigger as any other.
*/
function usePlace(open: boolean, anchor: RefObject<HTMLElement | null>, panel: RefObject<HTMLElement | null>, prefer: Side, align: "start" | "end" | "center", width: number | "trigger" | "within", keep: boolean, beside: "left" | "right" | false = false, within?: () => HTMLElement | null, whole = false, out = 0) {
  const [at, setAt] = useState<Place>({ side: prefer, top: -9999, left: -9999, ready: false });
  useLayoutEffect(() => {
    if (!open) return setAt((a) => ({ ...a, ready: false }));
    const place = () => {
      const a = anchor.current;
      const p = panel.current;
      if (!a || !p) return;
      const r = a.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const below = vh - r.bottom - GAP - EDGE;
      // Above it stops at the window's top row, where the Mac's window buttons are (menu-place.ts).
      const above = r.top - GAP - TOP_ROW;
      // The box it keeps inside sideways: the window, or the element it's kept within, its padding apart.
      const box = within?.();
      const pad = box ? getComputedStyle(box) : null;
      const b = box?.getBoundingClientRect();
      const lo = b && pad ? Math.max(EDGE, b.left + parseFloat(pad.paddingLeft)) : EDGE;
      const hi = b && pad ? Math.min(vw - EDGE, b.right - parseFloat(pad.paddingRight)) : vw - EDGE;
      // Beside, to the right: past the right edge of what it's kept within (or the trigger's), as wide as asked while the window has room.
      const from = Math.round((b ? b.right : r.right) + GAP + 2);
      const wide = typeof width === "number" ? Math.min(width, vw - EDGE - from) : 0;
      const right = beside === "right" && wide >= Math.min(220, typeof width === "number" ? width : 220);
      const w = Math.min(width === "trigger" ? r.width : width === "within" ? hi - lo : width, hi - lo);
      // Measured at the width it will have: one first drawn at its own width wraps otherwise, and its
      // height (and so where a panel over its trigger starts) would be a line out until it settled.
      p.style.width = `${right ? wide : w}px`;
      // Its own height, not the one a room it was fitted to gave it: a panel that shrinks into its
      // room would otherwise read as fitting, open up again, and never settle.
      // The room a whole panel's cards were fitted to goes too, or they would measure as fitting where they don't.
      const fitted = p.style.maxHeight;
      const fittedRoom = p.style.getPropertyValue("--lc-pop-room");
      p.style.maxHeight = "none";
      p.style.removeProperty("--lc-pop-room");
      const h = p.scrollHeight;
      p.style.maxHeight = fitted;
      if (fittedRoom) p.style.setProperty("--lc-pop-room", fittedRoom);
      const { side, max } = panelSide({ h, below, above, prefer, keep, keepMin: KEEP_MIN, whole });
      const tall = Math.min(h, max ?? h);
      if (right) {
        const fit = Math.min(h, vh - EDGE - TOP_ROW);
        const top = Math.max(TOP_ROW, Math.min(r.top - 8, vh - EDGE - fit));
        setAt({ side: "right", top: Math.round(top), left: from, max: h > fit ? fit : undefined, w: wide, ready: true });
        return;
      }
      // Beside, to the left (the session tray's menus): level with the trigger's top, kept on screen.
      if (beside === "left" && r.left - GAP - w >= EDGE) {
        const fit = Math.min(h, vh - EDGE - TOP_ROW);
        const top = Math.max(TOP_ROW, Math.min(r.top, vh - EDGE - fit));
        setAt({ side: "left", top: Math.round(top), left: Math.round(r.left - GAP * 2 - w), max: h > fit ? fit : undefined, w, ready: true });
        return;
      }
      const left = panelLeft(align, r, w, lo, hi, out);
      const top = side === "bottom" ? r.bottom + GAP : Math.max(TOP_ROW, r.top - GAP - tall);
      setAt({ side, top: Math.round(top), left: Math.round(left), max, w, ready: true });
    };
    place();
    window.addEventListener("resize", place);
    // A scroller under the trigger moving it: the panel follows rather than floating off. Its own
    // lists scrolling move nothing, and measuring would put them back at the top mid-scroll.
    const moved = (e: Event) => {
      if (!(e.target instanceof Node && panel.current?.contains(e.target))) place();
    };
    window.addEventListener("scroll", moved, true);
    // Content that arrives after it opens (a list still loading) gets room, or the other side.
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => place());
    if (panel.current?.firstElementChild) ro?.observe(panel.current.firstElementChild);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", moved, true);
    };
    // A width that changes while open (the model picker gains or loses its side card as the window is resized) is placed again.
  }, [open, width, out]);
  return at;
}

/** Rows inside a menu are its items: role="menuitem", which the arrow keys go by. */
const InMenu = createContext(false);
/**
  The panels a menu has opened to its side (SubMenu): they live in the layer above the window, outside the
  menu's own box, so a press in one would read as a press outside the menu and close both. The menu that
  opened them counts them as its own.
*/
const Subs = createContext<Set<HTMLElement> | null>(null);
/** A ref the dismiss hook can ask: is this node in one of the side panels? */
function useSubs() {
  const subs = useRef(new Set<HTMLElement>());
  const inside = useRef({ contains: (n: Node | null) => [...subs.current].some((s) => s.contains(n)) } as unknown as HTMLElement);
  return { subs: subs.current, inside };
}

/** A trigger and a glass panel under (or over) it, in the layer above the window. The panel gets `close`. */
export function Pop({
  trigger,
  label,
  children,
  align = "start",
  side = "bottom",
  width = 300,
  className,
  triggerClass,
  disabled,
  keep = false,
  menu = false,
  triggerAttrs,
  within,
  describedBy,
  bare = false,
  out = 0,
  open: openAsked,
  onOpenChange,
}: {
  trigger: ReactNode;
  label: string;
  children: (close: () => void) => ReactNode;
  align?: "start" | "end" | "center";
  /** "left" opens beside the trigger, as the session tray's menus do; "right" past the right edge of `within` (or the trigger), as the sidebar's Carry on does. */
  side?: "top" | "bottom" | "left" | "right";
  /** Its width, or the trigger's own ("trigger"), as a menu under a sidebar entry, or all of `within`'s ("within"). */
  width?: number | "trigger" | "within";
  className?: string;
  triggerClass?: string;
  disabled?: boolean;
  /** Stay on `side` while there's fair room, fitting to it, rather than flip to where it all fits. */
  keep?: boolean;
  /** A menu of actions rather than a panel: its rows are menu items, and the arrow keys move between them. */
  menu?: boolean;
  /** More for the trigger itself: the page it stands for being open (aria-current), a state its look reads. */
  triggerAttrs?: Record<string, string | boolean | undefined>;
  /** An element it stays inside sideways (its padding apart), as the sidebar's foot menu stays in the sidebar. */
  within?: () => HTMLElement | null;
  /** The id of a line inside the panel that says what it is (Carry on's), read after its label. */
  describedBy?: string;
  /** No glass of its own: what it holds draws its own cards (the model picker's rail, list and side card). */
  bare?: boolean;
  /** How far it hangs out past the trigger's edge it is aligned on, in px: the model picker's side card past its chip (picker.ts pickerOut). */
  out?: number;
  /** Open or shut from outside, as a key opens the agents popup; leave both unset and the trigger alone opens it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [own, setOwn] = useState(false);
  const open = openAsked ?? own;
  const setOpen = (v: boolean) => {
    if (openAsked === undefined) setOwn(v);
    onOpenChange?.(v);
  };
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const { subs, inside } = useSubs();
  const at = usePlace(open, btn, panel, side === "left" || side === "right" ? "bottom" : side, align, width, keep, side === "left" || side === "right" ? side : false, within, bare, out);
  useDismiss(open, () => setOpen(false), [wrap, panel, inside], btn);
  const close = () => {
    setOpen(false);
    btn.current?.focus({ preventScroll: true });
  };
  // Focus moves into the panel once it is placed, so the keyboard carries on inside it.
  useEffect(() => {
    if (!open || !at.ready) return;
    // A part may say where the keyboard starts (the model picker's Find, past its rail); else the first that takes it.
    const first = panel.current?.querySelector<HTMLElement>("[data-autofocus]") ?? panel.current?.querySelector<HTMLElement>("input, textarea, [data-on], button, [tabindex]:not([tabindex='-1'])");
    first?.focus({ preventScroll: true });
  }, [open, at.ready]);
  return (
    <div ref={wrap} className={cx("lc-pop", className)}>
      <button ref={btn} type="button" {...triggerAttrs} className={cx("lc-pick l-focus", triggerClass)} aria-haspopup={menu ? "menu" : "dialog"} aria-expanded={open} aria-label={label} disabled={disabled} data-open={open || undefined} onClick={() => setOpen(!open)}>
        {trigger}
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            className={cx("l-pop lc-pop-panel lc-layer", bare && "lc-pop-bare")}
            data-side={at.side}
            data-align={align}
            data-ready={at.ready || undefined}
            role={menu ? "menu" : "dialog"}
            aria-label={label}
            aria-describedby={describedBy}
            // Placed here, not by Liner's anchored rules: those (bottom, translate) would fight the fixed layer.
            style={{ width: typeof width === "number" && !within ? Math.min(width, document.documentElement.clientWidth - EDGE * 2) : at.w, maxHeight: at.max, ...(at.max !== undefined ? { "--lc-pop-room": `${at.max}px` } : {}), top: at.top, left: at.left, right: "auto", bottom: "auto", translate: "none" }}
            onKeyDown={(e) => {
              // Something inside that took the Escape first (a list open in the panel) has closed itself; the panel stays.
              if (e.key === "Escape" && !e.defaultPrevented) {
                e.preventDefault();
                close();
              }
              // A menu's rows, by the arrow keys, Home and End, round from the last to the first; a text field in it keeps them for its caret.
              if (menu && movesRows(e.key, inText(e.target as HTMLElement))) {
                const rows = [...(panel.current?.querySelectorAll<HTMLElement>("[role^='menuitem']:not(:disabled)") ?? [])];
                const i = rows.indexOf(document.activeElement as HTMLElement);
                const to = e.key === "Home" ? 0 : e.key === "End" ? rows.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
                rows[to]?.focus();
                e.preventDefault();
              }
            }}
          >
            <Subs.Provider value={subs}>
              <InMenu.Provider value={menu}>{children(close)}</InMenu.Provider>
            </Subs.Provider>
          </div>,
          // Inside a modal dialog the panel joins it in the top layer, or the dialog would cover it.
          wrap.current?.closest("dialog[open]") ?? document.body,
        )}
    </div>
  );
}

/**
  A menu at the pointer, for right-clicks, or hung under a row's ··· (`under`, the button's box, and `row`, the row's):
  the same glass panel, kept inside the window and under its top row (menu-place.ts).
*/
export function ContextMenu({ at, label, onClose, children, width = 240 }: { at: { x: number; y: number; under?: Box; row?: Box } | null; label: string; onClose: () => void; children: (close: () => void) => ReactNode; width?: number }) {
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; max?: number } | null>(null);
  const { subs, inside } = useSubs();
  useDismiss(Boolean(at), onClose, [panel, inside]);
  // Focus goes back where it was when the menu goes: a row whose menu the keyboard opened keeps the keyboard.
  const shown = Boolean(at);
  useLayoutEffect(() => {
    if (!shown) return;
    const back = document.activeElement as HTMLElement | null;
    return () => back?.focus({ preventScroll: true });
  }, [shown]);
  useLayoutEffect(() => {
    const p = panel.current;
    if (!at || !p) return setPos(null);
    const place = () => {
      // Its own height, not the room it was fitted to last time.
      const fitted = p.style.maxHeight;
      p.style.maxHeight = "none";
      const h = p.scrollHeight;
      p.style.maxHeight = fitted;
      const to = placeMenu({ at, under: at.under, row: at.row, w: Math.min(width, document.documentElement.clientWidth - EDGE * 2), h, vw: document.documentElement.clientWidth, vh: window.innerHeight });
      setPos((was) => (was && was.top === to.top && was.left === to.left && was.max === to.max ? was : { top: to.top, left: to.left, max: to.max }));
    };
    place();
    // A list that opens in the menu's place (Snooze until, Move to a group) is another height: the menu keeps to its button, above or below.
    // The panel itself is watched, since its rows may sit in a part that draws no box of its own (display: contents).
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    ro?.observe(p);
    window.addEventListener("resize", place);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [at?.x, at?.y, width]);
  // The first row has the keyboard once it is placed; placed again (a list opened in it), the focus stays where the list put it.
  useEffect(() => {
    if (pos) panel.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }, [Boolean(pos)]);
  if (!at) return null;
  return createPortal(
    <div
      ref={panel}
      className="l-pop lc-pop-panel lc-layer"
      data-side="bottom"
      data-ready={pos ? true : undefined}
      role="menu"
      aria-label={label}
      style={{ width, top: pos?.top ?? -9999, left: pos?.left ?? -9999, maxHeight: pos?.max, right: "auto", bottom: "auto", translate: "none" }}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          const list = [...(panel.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? [])];
          const i = list.indexOf(document.activeElement as HTMLElement);
          list[(i + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length]?.focus();
          e.preventDefault();
        }
      }}
    >
      <Subs.Provider value={subs}>
        <InMenu.Provider value>{children(onClose)}</InMenu.Provider>
      </Subs.Provider>
    </div>,
    document.body,
  );
}

/**
  A menu that a part draws in place rather than in a Pop (the findings at one spot on the design canvas): its rows are
  the menu's items, so a reader hears them as such, and ↑ ↓ Home End walk them as they do in every other menu.
*/
export function MenuList({ className, label, children }: { className?: string; label: string; children: ReactNode }) {
  const list = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={list}
      className={className}
      role="menu"
      aria-label={label}
      onKeyDown={(e) => {
        if (!movesRows(e.key, inText(e.target as HTMLElement))) return;
        const rows = [...(list.current?.querySelectorAll<HTMLElement>("[role^='menuitem']:not(:disabled)") ?? [])];
        const i = rows.indexOf(document.activeElement as HTMLElement);
        const to = e.key === "Home" ? 0 : e.key === "End" ? rows.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
        rows[to]?.focus();
        e.preventDefault();
      }}
    >
      <InMenu.Provider value>{children}</InMenu.Provider>
    </div>
  );
}

/**
  The app's one menu row, in every menu and picker of Code, Liner Design and Liner Security (board Menus,
  2026-11-25): one line 28px high, set 4px in from the menu's edge with a 6px corner, a 14px icon in the
  fourth ink (never the accent), the title in ink at 13px, and at the far right, in 12.5px fourth ink, its
  key or value (`end`), a tick when it is the one picked (`on`), or for a row that opens a list in the
  menu's place (`opens`, the list's name, which the row carries as data-opens so focus can come back to it)
  a ›. A row whose value leads somewhere else (a surface, a page) without opening a list takes `chevron`
  for the same ›. A row with no icon starts its words at the icons' edge. `red`: a destructive row, in the
  danger colour from the start (Stop, Turn the swarm off); `forGood` is the same look for a row that deletes.
  A `note` is the row's tooltip, not a second line: only a row that can't be read without it shows it
  under the title (`keepNote`: a confirm about to act, a row that can't be pressed and says why).
  A note that says WHICH thing the row is (`which`: a project's path or remote beside another of the same name, a skill's
  path, a version's frame count) stays in sight on the title's line, at its end in the third ink, cut with an ellipsis
  (from the left for a path, `whichPath`, so its end shows) and whole in its tooltip. A note that isn't words (code, two
  lines) can't be a tooltip, so without `keepNote` it shows there too rather than being dropped.
  `rove`: one of the rows the arrow keys walk in a place that walks them (the model picker's pinned rows, Models.tsx rove).
  Picked, its tick goes at the end and the icon stays (`keepIcon` is how that was asked for once; it is the
  rule now, and the prop stays so the rows that pass it need no change).
  `danger`: the confirm's look, a row about to do what can't be undone (ConfirmRow). `forGood`: a row
  that deletes for good is red from the start; one that can be undone (Archive) never is.
*/
export function Row({ title, note, keepNote, which, whichPath, rove, on, icon, end, opens, chevron, disabled, keepIcon: _keepIcon, danger, forGood, red, label, back, onPick, onBlur }: { title: ReactNode; note?: ReactNode; keepNote?: boolean; which?: string; whichPath?: boolean; rove?: boolean; on?: boolean; icon?: ReactNode; end?: ReactNode; opens?: string; chevron?: boolean; disabled?: boolean; keepIcon?: boolean; danger?: boolean; forGood?: boolean; red?: boolean; label?: string; back?: boolean; onPick?: () => void; onBlur?: () => void }) {
  const tickEnd = Boolean(on);
  const inMenu = useContext(InMenu);
  const shown = keepNote && note;
  const words = typeof note === "string" || typeof note === "number";
  const tip = !shown && words ? String(note) : undefined;
  const loose = !shown && !words && note !== undefined && note !== null && note !== false ? note : undefined;
  const aside = which ? (
    <span className="lc-row-which" data-path={whichPath || undefined} title={which}>
      {whichPath ? <bdi>{which}</bdi> : which}
    </span>
  ) : loose !== undefined ? (
    <span className="lc-row-which">{loose}</span>
  ) : undefined;
  return (
    <button type="button" className="lc-row l-focus" role={inMenu ? (on === undefined ? "menuitem" : "menuitemcheckbox") : undefined} aria-label={label} aria-haspopup={opens ? "menu" : undefined} data-opens={opens} data-back={back || undefined} data-rove={rove || undefined} title={tip} data-on={on || undefined} data-danger={danger || undefined} data-for-good={forGood || red || undefined} data-bare={icon ? undefined : true} disabled={disabled} aria-pressed={inMenu ? undefined : on} aria-checked={inMenu ? on : undefined} onClick={onPick} onBlur={onBlur}>
      {icon && <span className="lc-row-tick">{icon}</span>}
      <span className="lc-row-t">
        {aside ? (
          <span className="lc-row-line">
            <b>{title}</b>
            {aside}
          </span>
        ) : (
          <b>{title}</b>
        )}
        {shown && <small>{note}</small>}
      </span>
      {(end || tickEnd || opens || chevron) && (
        <span className="lc-row-end">
          {end}
          {tickEnd && <I.check size={14} className="lc-row-on" />}
          {(opens || chevron) && <I.chevR size={14} />}
        </span>
      )}
    </button>
  );
}

/**
  The way back from a list that opened in a menu's place (the branches under From a branch, older versions,
  what a session no longer asks about): a menu row like every other, its ‹ in the icons' column and the list's
  name as its words in the second ink, 4px over the list (put a Sep after it where the menu has rules). It carries data-back, so a part that puts the keyboard on the
  list's first row passes over it with `:not([data-back])`. In a menu it is one of the menu's items; `menu`
  makes it one where the panel is not a Pop menu. `rove`: one of the rows the arrow keys walk (Models.tsx rove),
  on by default as the old back row was.
*/
export function BackRow({ name, label, menu, rove = true, onBack }: { name: ReactNode; label?: string; menu?: boolean; rove?: boolean; onBack: () => void }) {
  const row = <Row title={name} icon={<I.chevL size={14} />} label={label ?? (typeof name === "string" ? `Back from ${name}` : "Back")} back rove={rove} onPick={onBack} />;
  return menu ? <InMenu.Provider value>{row}</InMenu.Provider> : row;
}

/**
  A row that opens a menu to its side (board Menus: Your apps, a Browser's Width, Snooze until): the row
  with its value and a ›, and beside the menu it is in, level with the row, a menu of its own in the same
  shape. It opens by a press, Enter or →, and goes by Escape or ←, back to its row; a press outside every
  menu closes them all, and a press on another row of the first closes this one. `children` gets `done`,
  which closes it; pass the outer menu's `close` too when a pick should close everything. It works inside
  a Pop and a ContextMenu.
*/
export function SubMenu({ title, icon, value, label, width = 240, children }: { title: ReactNode; icon?: ReactNode; value?: ReactNode; label: string; width?: number; children: (done: () => void) => ReactNode }) {
  const subs = useContext(Subs);
  // A menu item only inside a menu, as Row is: in the pinned Session card, which is no menu, it is a plain button that opens one.
  const inMenu = useContext(InMenu);
  const row = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; max?: number; side: "left" | "right" } | null>(null);
  const done = () => {
    setOpen(false);
    row.current?.focus({ preventScroll: true });
  };
  // Counted as the menu's own while it shows, so a press in it doesn't close the menu.
  useLayoutEffect(() => {
    const p = panel.current;
    if (!open || !p || !subs) return;
    subs.add(p);
    return () => void subs.delete(p);
  }, [open]);
  // Beside the menu it opened from: to its right while the window has room, else its left (menu-place.ts sideMenuLeft).
  useLayoutEffect(() => {
    if (!open) return setPos(null);
    const r = row.current;
    const p = panel.current;
    const menu = r?.closest<HTMLElement>(".lc-pop-panel");
    if (!r || !p) return;
    const m = (menu ?? r).getBoundingClientRect();
    const rr = r.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const w = Math.min(width, vw - EDGE * 2);
    const left = sideMenuLeft(m, w, vw, menu?.dataset.side === "left");
    p.style.maxHeight = "none";
    const h = p.scrollHeight;
    const fit = Math.min(h, vh - EDGE - TOP_ROW);
    const top = Math.max(TOP_ROW, Math.min(rr.top - 4, vh - EDGE - fit));
    setPos({ top: Math.round(top), left: Math.round(left), max: h > fit ? fit : undefined, side: left < m.left ? "left" : "right" });
  }, [open, width]);
  // The keyboard goes in once it is placed: to its text field when it has one (a chooser's find field), else its first row.
  useEffect(() => {
    if (pos) (panel.current?.querySelector<HTMLElement>(FIRST_FOCUS) ?? panel.current?.querySelector<HTMLElement>("button:not(:disabled)"))?.focus({ preventScroll: true });
  }, [Boolean(pos)]);
  // A press anywhere but here or on its row closes it (another row of the menu, or outside, where the menu goes too). A press in
  // a side menu opened from this one (Your apps inside +'s More) is one of its own: that menu is among the outer menu's `subs`.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || row.current?.contains(t)) return;
      // (Two side menus of one menu are never open at once, a press on another row closing this one, so any other is this one's.)
      if ([...(subs ?? [])].some((s) => s !== panel.current && s.contains(t))) return;
      setOpen(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [open]);
  return (
    <>
      <button
        ref={row}
        type="button"
        className="lc-row l-focus"
        role={inMenu ? "menuitem" : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        data-open={open || undefined}
        data-bare={icon ? undefined : true}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" && !open) (e.preventDefault(), setOpen(true));
        }}
      >
        {icon && <span className="lc-row-tick">{icon}</span>}
        <span className="lc-row-t">
          <b>{title}</b>
        </span>
        <span className="lc-row-end">
          {value}
          <I.chevR size={14} />
        </span>
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            className="l-pop lc-pop-panel lc-layer"
            data-side={pos?.side ?? "right"}
            data-ready={pos ? true : undefined}
            role="menu"
            aria-label={label}
            style={{ width: Math.min(width, document.documentElement.clientWidth - EDGE * 2), top: pos?.top ?? -9999, left: pos?.left ?? -9999, maxHeight: pos?.max, right: "auto", bottom: "auto", translate: "none" }}
            onKeyDown={(e) => {
              // Its own Escape and ←: back to its row, the menu it came from still open. A text field in it keeps ← for its caret.
              const typing = inText(e.target as HTMLElement);
              if (backFromSide(e.key, typing) && !e.defaultPrevented) {
                e.preventDefault();
                e.stopPropagation();
                done();
              }
              if (movesRows(e.key, typing)) {
                const rows = [...(panel.current?.querySelectorAll<HTMLElement>("[role^='menuitem']:not(:disabled)") ?? [])];
                const i = rows.indexOf(document.activeElement as HTMLElement);
                const to = e.key === "Home" ? 0 : e.key === "End" ? rows.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
                rows[to]?.focus();
                e.preventDefault();
                e.stopPropagation();
              }
            }}
          >
            <InMenu.Provider value>{children(done)}</InMenu.Provider>
          </div>,
          row.current?.closest("dialog[open]") ?? document.body,
        )}
    </>
  );
}
/**
  A row that asks before it acts: the first press turns it into its confirm (`sure`, in the danger look) and only a later
  press acts. The ask lives in the row, so it goes with the menu: shut, or another row's menu opened, it asks from the
  start. A press that comes too soon after the ask (confirm.ts) is the second click of a double-click and does nothing.
  The confirm's `sureNote` shows under it, since it says what the press will do; the first state's `note` is its tooltip.
  Where the row stays up (the team card pinned beside the chat), the ask runs out after CONFIRM_LAPSE or once the focus
  leaves the row, so it never waits in red for a press meant for something else.
*/
export function ConfirmRow({ title, sure, note, sureNote, icon, forGood, red, onConfirm }: { title: ReactNode; sure: ReactNode; note?: ReactNode; sureNote?: ReactNode; icon?: ReactNode; forGood?: boolean; red?: boolean; onConfirm: () => void }) {
  const [askedAt, setAskedAt] = useState<number | null>(null);
  const asked = askedAt !== null;
  useEffect(() => {
    if (askedAt === null) return;
    const t = setTimeout(() => setAskedAt(null), CONFIRM_LAPSE);
    return () => clearTimeout(t);
  }, [askedAt]);
  return (
    <Row
      title={asked ? sure : title}
      note={asked ? sureNote : note}
      keepNote={asked}
      icon={icon}
      danger={asked}
      forGood={forGood}
      red={red}
      onBlur={asked ? () => setAskedAt(null) : undefined}
      onPick={() => {
        const now = performance.now();
        const step = confirmPress(askedAt, now);
        if (step === "ask") setAskedAt(now);
        else if (step === "do") onConfirm();
      }}
    />
  );
}
/**
  A menu's grey label (12.5px, fourth ink, 28px), over the rows it names: "Dev servers", "This session".
  `end` is a live note at its right end ("1 running", "1 open"), in the same grey.
*/
export const PanelHead = ({ children, end }: { children: ReactNode; end?: ReactNode }) => (
  <div className="lc-pop-head">
    <span>{children}</span>
    {end && <span>{end}</span>}
  </div>
);
/** A rule between a menu's groups: edge to edge of the menu, 4px above and below. */
export const Sep = () => <span className="lc-sep" role="separator" />;
/** A menu's grey foot line under a rule, saying how things stand: "Servers come from .claude/launch.json", "No limit set". */
export const MenuFoot = ({ children }: { children: ReactNode }) => <div className="lc-pop-foot">{children}</div>;

/** An agent's disc: a planner's from before pairs is filled (when the caller says so), the rest are outlined. */
export function Disc({ agent, size = 22, lead }: { agent: Pick<AgentProfile, "glyph" | "role" | "name">; size?: number; lead?: boolean }) {
  const filled = Boolean(lead);
  return (
    <span className="lc-disc" data-filled={filled || undefined} style={{ width: size, height: size }} aria-hidden>
      <Glyph glyph={agent.glyph} size={Math.round(size * 0.28) * 2} />
    </span>
  );
}

/** A model's mark and name, quiet. */
export const ModelTag = ({ kind, label, size = 12 }: { kind: MarkKind; label: string; size?: number }) => (
  <span className="lc-model">
    <ModelMark kind={kind} size={size} />
    {label}
  </span>
);

/**
  Show the sidebar, in a page's top row while the sidebar is hidden: one part for every page in every face, the session
  header's 32px button (lc-sw-b, as the switcher's icons and Design's row) with the sidebar's own 20px icon, the one its
  Hide draws (Sidebar.tsx), so the icon keeps its size and drawing as the sidebar comes and goes; its key in its tooltip
  (your binding, keymap.ts).
*/
export function ShowSidebar({ onShow }: { onShow: () => void }) {
  const key = os.keys(shortcutOf("sidebar") ?? []);
  return (
    <button type="button" className="lc-sw-b l-focus" aria-label="Show the sidebar" title={key ? `Show the sidebar (${key})` : "Show the sidebar"} onClick={onShow}>
      <N.sidebar />
    </button>
  );
}

/**
  "Look again": asks again for what a list or a page shows (your tools, add-ons, limits, releases,
  what agents remember), one control everywhere: a quiet small button with its refresh mark and the
  words, "Looking" while it asks. Busy is the words, not a state mark: nothing runs that you'd watch.
*/
export function LookAgain({ looking = false, onLook, title }: { looking?: boolean; onLook: () => void; title?: string }) {
  return (
    <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" disabled={looking} title={title} onClick={onLook}>
      <I.refresh size={14} />
      {looking ? "Looking" : "Look again"}
    </button>
  );
}

/** A word on a tinted pill. A fact is the word alone; `mark` puts the state mark before it where the word says how a thing that runs stands (a session, a check, a pull request), so no Badge has a dot of its own. */
export function Badge({ tone = "neutral", children, mark }: { tone?: "ok" | "warn" | "danger" | "neutral" | "accent"; children: ReactNode; mark?: MarkState }) {
  return (
    <span className="lc-badge" data-tone={tone}>
      {mark && <StateMark state={mark} size={12} />}
      {children}
    </span>
  );
}

/**
  The composer's one round button, as Claude Code and the other harnesses have it: while a turn runs
  and there's nothing to send it is Stop, a neutral ink square; the moment you write, it is Send in
  the action colour. Both marks are always drawn and only the one in use shows, so one turns into the
  other in place (app.css, .lc-send[data-stop]). `stop` unset is a plain Send.
*/
export function SendButton({ ready, stop, label, title, disabled, submit, className, size = 16, onSend }: { ready: boolean; size?: number; stop?: { onStop: () => void; title?: string }; label: string; title?: string; disabled?: boolean; submit?: boolean; className?: string; onSend?: () => void }) {
  const stopping = Boolean(stop) && !ready;
  // When it last became Stop, so the second click of a double-click on Send doesn't stop the turn it just sent to (stop-guard.ts).
  const since = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    since.current = stopping ? performance.now() : undefined;
  }, [stopping]);
  return (
    <button
      type={submit && !stopping ? "submit" : "button"}
      className={cx("lc-send l-focus", className)}
      aria-label={stopping ? "Stop" : label}
      title={stopping ? (stop?.title ?? "Stop") : title}
      data-ready={(ready && !disabled) || undefined}
      data-stop={stopping || undefined}
      disabled={!stopping && disabled}
      onClick={(e) => {
        if (stopping) {
          e.preventDefault();
          if (stopIgnored(since.current, performance.now(), e.detail)) return;
          stop!.onStop();
        } else if (onSend) onSend();
      }}
    >
      <I.send size={size} className="lc-send-up" />
      <I.stop size={Math.round((size * 11) / 16)} className="lc-send-sq" />
    </button>
  );
}

/**
  An explanation kept out of the way: it shows on glass under what it explains once the pointer
  rests there (or keyboard focus reaches it), drawn over the page so a scrolling column or a
  popover's edge never cuts it, and flipped above when there's no room under. It never takes the
  pointer, so moving on closes it.
*/
export function HoverNote({ note, children, className, width = 280 }: { note: ReactNode; children: ReactNode; className?: string; width?: number }) {
  const at = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const place = () => {
    const r = at.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setPos(window.innerHeight - r.bottom > 140 ? { left, top: r.bottom + 6 } : { left, bottom: window.innerHeight - r.top + 6 });
  };
  const show = (now = false) => {
    window.clearTimeout(timer.current);
    if (now) place();
    else timer.current = window.setTimeout(place, 450);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setPos(null);
  };
  return (
    <span
      ref={at}
      className={cx("lc-hnote-at", className)}
      onPointerEnter={(e) => e.pointerType === "mouse" && show()}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={(e) => (e.target as HTMLElement).matches(":focus-visible") && show(true)}
      onBlur={hide}
      onKeyDown={(e) => e.key === "Escape" && pos && (e.stopPropagation(), hide())}
    >
      {children}
      {pos && createPortal(<span role="tooltip" className="lc-hnote" style={{ ...pos, width }}>{note}</span>, document.body)}
    </span>
  );
}

/** +19 −7, in mono. */
export const Lines = ({ added, removed }: { added: number; removed: number }) => (
  <span className="lc-lines">
    {added > 0 && <span data-add>+{added}</span>}
    {removed > 0 && <span data-del>−{removed}</span>}
  </span>
);

/** "2h 14m", "3d 4h", "12m": how long until `ms` from now. */
const until = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60_000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m % 60}m` : `${m}m`;
};

/**
  One plan window: how much is used, a mark where an even pace through the window would be, and
  when it resets. A window whose reset time has passed is shown empty until the tool is asked again.
*/
export function LimitRow({ w, label, now }: { w: LimitWindow; label: string; now: number }) {
  const reset = w.resetsAt !== undefined && w.resetsAt <= now;
  const used = reset ? 0 : Math.max(0, Math.min(100, w.usedPercent));
  const pace = !reset && w.minutes && w.resetsAt ? Math.max(0, Math.min(1, 1 - (w.resetsAt - now) / (w.minutes * 60_000))) : null;
  return (
    <div className="lc-limits-w" data-high={used >= 80 || undefined}>
      <span className="lc-limits-l">
        <span>{w.label}</span>
        <span className="lc-mono">{Math.round(used)}%</span>
      </span>
      <span className="lc-limits-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(used)} aria-label={`${label}, ${w.label}`}>
        <i style={{ width: `${used}%` }} />
        {pace !== null && <b style={{ left: `${pace * 100}%` }} title="An even pace through the window would be here" aria-hidden />}
      </span>
      {w.resetsAt !== undefined && <small className="lc-quiet">{reset ? `Reset at ${clock(w.resetsAt, now)}` : `Resets in ${until(w.resetsAt - now)}, ${clock(w.resetsAt, now)}`}</small>}
    </div>
  );
}

export const Kbd = ({ children }: { children: ReactNode }) => <kbd className="lc-kbd">{children}</kbd>;

/** What a card shows in place of a secret's value (the engine's launch.ts, HIDDEN). */
const HIDDEN_VALUE = "(set, not shown)";
/** A variable as a card shows it, KEY=value: a value kept back reads quieter, its name kept, so it isn't taken for the value. */
export const EnvLine = ({ k, v }: { k: string; v: string }) => (
  <>
    {k}={v === HIDDEN_VALUE ? <span className="lc-env-hidden">{v}</span> : v}
  </>
);

/**
  A figure that rolls to its new value, digit by digit (Liner's rolling number), written the way
  the rest of Liner Code writes it: 152k, 1.2M, $0.31, 77%.
*/
export function Num({ value, as = "count" }: { value: number; as?: "count" | "compact" | "money" | "percent" }) {
  if (as === "money") return <RollingNumber value={value} format={{ style: "currency", currency: "USD", minimumFractionDigits: value >= 100 ? 0 : 2, maximumFractionDigits: value >= 100 ? 0 : 2 }} />;
  if (as === "percent") return <RollingNumber value={value} format={{ style: "percent", maximumFractionDigits: 0 }} />;
  if (as === "compact" && value >= 1e3) {
    const big = value >= 1e6;
    const n = big ? value / 1e6 : value / 1e3;
    return (
      <span className="lc-num">
        <RollingNumber value={n} format={{ maximumFractionDigits: big || n < 10 ? 1 : 0 }} />
        {big ? "M" : "k"}
      </span>
    );
  }
  return <RollingNumber value={value} />;
}

/**
  Liner's Switch with a name for screen readers, when its words sit beside it (a settings row's
  title) rather than in its own label. The wrapper takes no room, so the row lays out as before.
*/
export function NamedSwitch({ name, rove, ...props }: SwitchProps & { name: string; rove?: boolean }) {
  const wrap = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const sw = wrap.current?.querySelector('[role="switch"]');
    sw?.setAttribute("aria-label", name);
    // In a list the arrows walk (rove, data-rove), as the Effort part's extras are, the switch is one of its stops.
    if (rove) sw?.setAttribute("data-rove", "");
    else sw?.removeAttribute("data-rove");
  }, [name, rove]);
  return (
    <span ref={wrap} style={{ display: "contents" }}>
      <Switch {...props} />
    </span>
  );
}
