/*
  How things that open and close move (the motion study after Kimi, approved 2026-11-27): the numbers, and the small
  decisions behind them, worked out apart from React and the page so the tests can run them. The same numbers are tokens
  in app.css (--lc-menu-in and its neighbours); a test holds the two together.
*/

/** Milliseconds, as the approved study gives them. */
export const MOTION = {
  /** A menu or pop-up comes out of its button over this, and goes back over `menuOut`. */
  menuIn: 200,
  menuOut: 140,
  /** The app's tip on an icon button: the wait before the first, the window after one hides in which the next needs none, and its fades. */
  tipWait: 500,
  tipSkip: 300,
  tipIn: 150,
  tipOut: 150,
  /** A dialog and its scrim. */
  sheetIn: 225,
  sheetOut: 160,
  /** A hover card: the wait before it shows, the pause after the pointer leaves, then its fade. */
  cardWait: 250,
  cardLinger: 120,
  cardFade: 120,
  /** A fold, both ways. */
  fold: 240,
  /** The sidebar's and the panel's width with Motion set to Full. */
  sideOpen: 300,
  sideShut: 240,
  /** Under the system's Reduce motion, what still fades. */
  reduced: 100,
} as const;

/**
  How long past its own exit a closing part waits for the end of its animation before it goes anyway: the event never
  comes in a hidden window, under display: none, or when nothing animated.
*/
export const EXIT_SLACK = 80;

/* ---------- The exit ---------- */

/** Where a part that can close with a motion is: gone, open, or on screen and closing. */
export type Stage = "shut" | "open" | "closing";

/**
  The next stage. Opened, it is open whatever it was, so a second open during the exit takes the panel back as it is (no
  flash, nothing left half gone); closed, an open part starts its exit and a shut one stays shut; the exit's end (its
  animation's or the timer's) takes a closing part away and leaves the others as they are, so a late event after a
  reopen does nothing.
*/
export function stageAfter(s: Stage, e: "open" | "close" | "ended"): Stage {
  if (e === "open") return "open";
  if (e === "close") return s === "shut" ? "shut" : "closing";
  return s === "closing" ? "shut" : s;
}

/* ---------- Where a panel grows from ---------- */

export type Rect = { left: number; top: number; width: number; height: number };

/**
  The point a panel grows out of and shrinks back into, in px from its own top left: the trigger's centre on the edge the
  panel hangs from. Under its trigger, the panel's top edge at the trigger's centre across; over it, its bottom edge; opened
  to the trigger's left, its right edge level with the trigger's middle; to its right, its left edge. The point stays on the
  panel, so one pushed along by the window's edge still grows from its own edge nearest the trigger.
*/
export function originOf(side: "top" | "bottom" | "left" | "right", panel: Rect, trigger: Rect): { x: number; y: number } {
  const clamp = (v: number, max: number) => Math.round(Math.max(0, Math.min(max, v)));
  const cx = clamp(trigger.left + trigger.width / 2 - panel.left, panel.width);
  const cy = clamp(trigger.top + trigger.height / 2 - panel.top, panel.height);
  if (side === "bottom") return { x: cx, y: 0 };
  if (side === "top") return { x: cx, y: Math.round(panel.height) };
  if (side === "left") return { x: Math.round(panel.width), y: cy };
  return { x: 0, y: cy };
}

/** The same point as a transform-origin. */
export const originCss = (o: { x: number; y: number }) => `${o.x}px ${o.y}px`;

/* ---------- Tips ---------- */

/**
  How long a tip waits before it shows: none while another is on screen or within the skip window after the last one hid,
  so running along a row of buttons reads each one at once; else the full wait.
*/
export function tipDelay(now: number, lastHidden: number, oneShows: boolean): number {
  return oneShows || now - lastHidden < MOTION.tipSkip ? 0 : MOTION.tipWait;
}

/** A key as a key hint writes it: the Mac's marks run together (⇧⌘D), a PC's names joined by + (Ctrl+Shift+D). */
const KEY = String.raw`(?:[⌘⇧⌥⌃]+|(?:(?:Ctrl|Shift|Alt|Win)\+)+)?(?:[A-Z0-9]|F\d{1,2}|Esc|Enter|Tab|Space|Delete|Backspace|[\[\]\\/,.;'\x60=\-]|[←→↑↓↩⌫⎋])`;
const WITH_KEY = new RegExp(String.raw`^(.*\S)\s+\((${KEY})\)$`);

/**
  A button's tooltip in its words and its key: "Show the panel (⇧⌘D)" is "Show the panel" and "⇧⌘D", so the tip can set
  the key apart in grey as a menu does. Words in brackets that are not a key ("(set, not shown)") stay words.
*/
export function splitTip(title: string): { words: string; keys?: string } {
  const m = WITH_KEY.exec(title.trim());
  return m ? { words: m[1], keys: m[2] } : { words: title.trim() };
}

/** A key hint as aria-keyshortcuts names it (⇧⌘D is Shift+Meta+D), so a screen reader still hears the key once the title is gone. */
export function ariaKeys(keys: string): string {
  const names: Record<string, string> = { "⌘": "Meta", "⇧": "Shift", "⌥": "Alt", "⌃": "Control", Ctrl: "Control", Win: "Meta" };
  const parts = keys.includes("+") && keys.length > 1 ? keys.split("+") : [...keys.matchAll(/[⌘⇧⌥⌃]|[^⌘⇧⌥⌃]+/g)].map((m) => m[0]);
  return parts.map((p) => names[p] ?? (p === "Esc" ? "Escape" : p)).join("+");
}

/** The same words, so the tip adds nothing to what a screen reader already says for the button. */
export const sameWords = (a: string, b: string) => {
  const n = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return n(a) === n(b);
};

/**
  Where a tip goes: under its button while there is room, else over it; centred on it across and kept inside the window.
  `vw` and `vh` are the window's size, `edge` the room kept from its edges.
*/
export function tipPlace(button: Rect, tip: { width: number; height: number }, vw: number, vh: number, gap = 6, edge = 8): { left: number; top: number; side: "top" | "bottom" } {
  const below = button.top + button.height + gap;
  const side = below + tip.height <= vh - edge || button.top - gap - tip.height < edge ? "bottom" : "top";
  const top = side === "bottom" ? below : button.top - gap - tip.height;
  const left = Math.max(edge, Math.min(vw - edge - tip.width, button.left + button.width / 2 - tip.width / 2));
  return { left: Math.round(left), top: Math.round(top), side };
}

/* ---------- Hover cards ---------- */

/** A hover card: nothing, waiting to show, shown, waiting after the pointer left, or fading out. */
export type CardStage = "hidden" | "waiting" | "shown" | "lingering" | "fading";

/**
  What a hover card does next, and how long until its timer (`wait`, none for no timer). The pointer resting starts the
  wait; reaching another row while one shows, lingers or fades takes the card there at once with the new row's words
  (`swap`), never closing it between; leaving starts the pause, then the fade, then it is gone.
*/
export function cardAfter(s: CardStage, e: "enter" | "leave" | "timer"): { to: CardStage; wait?: number; swap?: boolean } {
  if (e === "enter") return s === "hidden" || s === "waiting" ? { to: "waiting", wait: MOTION.cardWait } : { to: "shown", swap: true };
  if (e === "leave") return s === "waiting" ? { to: "hidden" } : s === "shown" ? { to: "lingering", wait: MOTION.cardLinger } : { to: s };
  if (s === "waiting") return { to: "shown" };
  if (s === "lingering") return { to: "fading", wait: MOTION.cardFade };
  if (s === "fading") return { to: "hidden" };
  return { to: s };
}
