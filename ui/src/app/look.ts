/*
  How the app looks: the theme, the accent, the composer's glass,
  where designs open, and the backdrop, kept in this browser's storage and put on the page (and
  the window) at launch, before Settings is ever opened.
*/
import { useEffect, useState } from "react";
import { bridge } from "./bridge";
import { clearTheme, inkOn, readThemes, varsOf } from "./themes";

/**
  `custom`: one of your themes, by id. `accentColor`: your own accent, when `accent` is "own".
  `composer`: how much of the thread shows through the composer, the one glass surface left.
  `designs`: where a design or an HTML page an agent shows opens: in the panel beside the chat,
  or wide in the chat itself. `designsAuto`: beside the chat, whether the panel comes up on its own.
  `action`: the colour of the most important buttons (Send, Commit and push, a card's main button):
  red, the accent, ink, or `actionColor` when it's "own".
  `background`: the picture behind the session ("apple:<name>", "own", or none), with how much it's
  blurred (px) and how much of it shows through (0 to 1). Or "desktop": no picture, the window
  itself see-through, so the Mac's wallpaper and windows show behind the whole app; `bgShow` is
  then how much of the desktop comes through, and `bgFrost` (off unless true) blurs it.
  `motion`: Full plays every view's way in each time it opens; Quick shows a view you open as it is
  and keeps the motion for what arrives while you watch. The system's Reduce motion stops both.
  `home`: what's behind Home: the sea with its whale (Sea.tsx), your own dots (Dots.tsx), or
  nothing. `sea` is the switch it replaced: a look saved with the sea off and no `home` reads as
  nothing. `homeIn`: whether it shows in both looks or only the dark or the light one.
  `dots`: how your dots are drawn (DotLook), only what was chosen.
*/
export type Glass = "clear" | "tinted" | "solid";
export type ActionColour = "red" | "accent" | "ink" | "own";
export type DesignsWhere = "panel" | "chat";
export type Motion = "full" | "quick";
export type BehindHome = "sea" | "dots" | "none";
/** In which looks what's behind Home shows: in the other, Home is plain paper. */
export type HomeIn = "both" | "dark" | "light";
export type DotSource = "picture" | "words" | "moon" | "ridges" | "aurora";
export type DotStyle = "squares" | "halftone" | "round";
export type DotTone = "duo" | "ink" | "picture";
export type DotMove = "still" | "breathe" | "stir";
/**
  The dots behind Home. `source`: your picture (kept by the engine, wallpaper.*), words, or one of
  the three scenes the app draws. `prompt`: the words last asked of the AI pictures model.
  `cell`: the grid's cell in CSS pixels, one dot each (2 to 12; unset, 2 on light paper and 5 in the dark). `light` and `fade` are 0 to 100. `focus`:
  the point of your picture that stays in view when it's cropped to fill Home, 0 to 1 each way.
  `pic` goes up when the saved picture changes, so it's fetched again.
*/
export type DotLook = { source: DotSource; words: string; prompt: string; style: DotStyle; tone: DotTone; ink: string; cell: number; light: number; fade: number; move: DotMove; focus: { x: number; y: number }; pic: number };
export type Look = { theme: "light" | "dark" | "system"; accent: string; composer: Glass; designs: DesignsWhere; designsAuto: boolean; action: ActionColour; motion: Motion; custom?: string; accentColor?: string; actionColor?: string; background?: string; bgBlur?: number; bgShow?: number; bgFrost?: boolean; sea?: boolean; home?: BehindHome; homeIn?: HomeIn; dots?: Partial<DotLook>; v?: number };
export const LOOK_KEY = "liner-code:look";
const MOTIONS: Motion[] = ["full", "quick"];
const HOMES: BehindHome[] = ["sea", "dots", "none"];
/** The inks the dots can take, by name. */
export const DOT_INKS = [
  { name: "Indigo", color: "#6f5cff" },
  { name: "Sea", color: "#2fb4c8" },
  { name: "Ember", color: "#ff7442" },
  { name: "Moss", color: "#7ccf5e" },
  { name: "Bone", color: "#e6e2d6" },
];
/** Still by default: drawn once, it costs nothing after. */
export const DOTS_DEFAULT: DotLook = { source: "moon", words: "liner", prompt: "", style: "squares", tone: "duo", ink: "#6f5cff", cell: 5, light: 50, fade: 70, move: "still", focus: { x: 0.5, y: 0.5 }, pic: 0 };
const oneOf = <T extends string>(v: unknown, all: readonly T[], or: T): T => (all.includes(v as T) ? (v as T) : or);
const within = (v: unknown, lo: number, hi: number, or: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : or);
/** What's behind Home, from a look. */
export const homeOf = (l: Look): BehindHome => oneOf(l.home, HOMES, l.sea === false ? "none" : "sea");
/** In which looks it shows. */
export const homeInOf = (l: Look): HomeIn => oneOf(l.homeIn, ["both", "dark", "light"], "both");
/** Whether the look on the page now is the dark one (applyLook sets it, a theme of your own by its base). */
export const darkNow = () => document.documentElement.dataset.theme === "dark";
/** What's behind Home in the look on the page now: nothing in a look `homeIn` leaves out. */
export const homeShown = (l: Look): BehindHome => {
  const where = homeInOf(l);
  return where === "both" || (where === "dark") === darkNow() ? homeOf(l) : "none";
};
/**
  A look's dots as they can be drawn: a word this build doesn't know, or a number out of range,
  goes back to its default. A size never chosen is 2 px on light paper (the fine mosaic) and 5 in
  the dark; once you choose one it holds in both.
*/
export const dotsOf = (l: Look, paper: "light" | "dark" = "dark"): DotLook => {
  const d: Partial<DotLook> = l.dots ?? {};
  const f = d.focus;
  return {
    source: oneOf(d.source, ["picture", "words", "moon", "ridges", "aurora"], DOTS_DEFAULT.source),
    words: typeof d.words === "string" ? d.words : DOTS_DEFAULT.words,
    prompt: typeof d.prompt === "string" ? d.prompt : DOTS_DEFAULT.prompt,
    style: oneOf(d.style, ["squares", "halftone", "round"], DOTS_DEFAULT.style),
    tone: oneOf(d.tone, ["duo", "ink", "picture"], DOTS_DEFAULT.tone),
    ink: typeof d.ink === "string" && /^#[0-9a-f]{6}$/i.test(d.ink) ? d.ink : DOTS_DEFAULT.ink,
    cell: Math.round(within(d.cell, 2, 12, paper === "light" ? 2 : DOTS_DEFAULT.cell)),
    light: within(d.light, 0, 100, DOTS_DEFAULT.light),
    fade: within(d.fade, 0, 100, DOTS_DEFAULT.fade),
    move: oneOf(d.move, ["still", "breathe", "stir"], DOTS_DEFAULT.move),
    focus: { x: within(f?.x, 0, 1, 0.5), y: within(f?.y, 0, 1, 0.5) },
    pic: within(d.pic, 0, Number.MAX_SAFE_INTEGER, 0),
  };
};
export const LOOK_DEFAULT: Look = { theme: "system", accent: "blue", composer: "tinted", designs: "panel", designsAuto: true, action: "red", motion: "quick" };
export const readLook = (): Look => {
  let saved: Partial<Look> & { v?: number } = {};
  try {
    saved = JSON.parse(localStorage.getItem(LOOK_KEY) || "{}") as typeof saved;
  } catch {
    // storage is off: the defaults
  }
  // Before 0.1.4 the whole window was glass, with a material behind it and Clear to Tinted; one
  // ground replaced them. The session tray's glass went with the tray. What's left of either in a
  // saved look is dropped here.
  const { glass: _glass, material: _material, tray: _tray, ...rest } = saved as Partial<Look> & { glass?: string; material?: string; tray?: string };
  const look = { ...LOOK_DEFAULT, ...rest, v: 3 };
  // A look saved before there was a choice, or with a word this build doesn't know, moves as Quick.
  if (!MOTIONS.includes(look.motion)) look.motion = LOOK_DEFAULT.motion;
  // Before the dots, the sea's switch was all there was: off is nothing behind Home.
  if (!HOMES.includes(look.home as BehindHome)) look.home = look.sea === false ? "none" : "sea";
  // The desktop's "Shows through" went to 75% before 0.2.8; past DESK_MAX it comes back to it.
  if (look.background === "desktop" && typeof look.bgShow === "number" && look.bgShow > DESK_MAX) look.bgShow = DESK_MAX;
  return look;
};

/**
  Whether the window can be see-through: only the Mac app's Electron shell, with its addon, can
  turn its window clear (desktop/native/mac.mm), and it says so (preload.ts, `clear`). In a
  browser, on Windows, or in a shell without the addon, Desktop is shown but can't be picked.
*/
export const seeThrough = () => window.linerShell?.clear === true;
/** How much of the desktop comes through when nothing's been chosen: enough to see it, not so much a busy wallpaper fights the text. */
const DESK_SHOW = 0.4;
/** The most of the desktop "Shows through" goes to (it went to 75%, where text over a black wallpaper in the light theme was 1.6:1). */
export const DESK_MAX = 0.5;
/**
  Of what "Shows through" says, the share that comes through the window's ground (--lc-see): at
  DESK_MAX a quarter, so the ground behind any text is three quarters its own colour at the least.
  Over a pure black or white desktop, the worst there is, that keeps body text (--l-ink, --l-ink-2)
  at 5.3:1 or more and the greys (--l-ink-3, and --l-ink-4, which is --l-ink-3 here: app.css) at
  3.1:1 or more, in both themes, in the sidebar; the page has its paper over the ground besides.
*/
const DESK_THROUGH = 0.5;
/** "Shows through" on the desktop as it can be: the saved value, from 15% to DESK_MAX. */
export const deskShow = (l: Look) => Math.min(DESK_MAX, Math.max(0.15, l.bgShow ?? DESK_SHOW));
/** How much of the desktop comes through the window's ground, 0 to 1 (--lc-see). */
export const deskSee = (l: Look) => deskShow(l) * DESK_THROUGH;
/** The Mac's Reduce transparency (Accessibility, Display): the window stays solid whatever the look says. */
export const lessGlass = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-transparency: reduce)").matches;
/** The look shows the desktop behind the window, where it can. */
export const onDesktop = (l: Look) => l.background === "desktop" && seeThrough() && !lessGlass();
/**
  The see-through window's ground as one colour: what the page paints round the paper, and what
  the shell's boot screen paints before the page is there, so the hand-over doesn't jump.
  Blurred or not, the same tint: the page can't know how much the blur's own material hides.
*/
const deskGround = (l: Look) => `color-mix(in oklab, ${getComputedStyle(document.documentElement).getPropertyValue("--lc-ground").trim()} ${Math.round((1 - deskSee(l)) * 100)}%, transparent)`;

// The colours last put on the page, so a change of theme or accent can land in one frame.
let painted = "";

/** Puts a look on the page (and on the window, in the shell). */
export function applyLook(l: Look) {
  const h = document.documentElement;
  const dark = l.theme === "dark" || (l.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  // A new theme or accent changes every colour at once. With each control's own fade it crossed
  // the window in a hundred fades out of step, a flicker; it lands in one frame instead, with
  // transitions held while the new colours are worked out (T3 Code: .no-transitions, index.css).
  const colours = [dark, l.custom, l.accent, l.accentColor, l.action, l.actionColor].join("|");
  const still = painted !== "" && colours !== painted;
  painted = colours;
  if (still) h.dataset.still = "";
  const own = l.custom ? readThemes().find((t) => t.id === l.custom) : undefined;
  h.dataset.theme = own ? own.base : dark ? "dark" : "light";
  h.dataset.accent = l.accent === "own" ? "blue" : l.accent;
  clearTheme(h);
  // One of your themes sets every colour it has; your own accent goes on top of Liner's.
  if (own) for (const [k, v] of Object.entries(varsOf(own))) h.style.setProperty(k, v);
  if (l.accent === "own" && l.accentColor) {
    h.style.setProperty("--l-accent", l.accentColor);
    h.style.setProperty("--l-accent-ink", inkOn(l.accentColor));
  }
  h.dataset.composer = l.composer;
  h.dataset.motion = l.motion;
  // The main buttons' colour: red by default (app.css); your own goes on the page, with ink that reads on it.
  const action = l.action === "own" && !l.actionColor ? "red" : l.action;
  h.dataset.action = action;
  if (action === "own") {
    h.style.setProperty("--lc-act", l.actionColor!);
    h.style.setProperty("--lc-act-ink", inkOn(l.actionColor!));
  } else {
    h.style.removeProperty("--lc-act");
    h.style.removeProperty("--lc-act-ink");
  }
  if (still) {
    void h.offsetHeight;
    delete h.dataset.still;
  }
  bridge.setAppearance(own ? own.base : l.theme);
  // The window is solid, or clear with the desktop behind it (crisp unless you asked for the blur).
  // The ground and the paper turn to tints of themselves here, at once, rather than when the
  // backdrop's component catches up (Backdrop.tsx, Scene, says the same for a picture).
  // (ui/index.html sets the same three before the first paint, so the page doesn't flash opaque.)
  const desk = onDesktop(l);
  if (desk) {
    h.dataset.bg = "desktop";
    h.style.setProperty("--lc-see", String(deskSee(l)));
  } else {
    if (h.dataset.bg === "desktop") delete h.dataset.bg;
    h.style.removeProperty("--lc-see");
  }
  h.toggleAttribute("data-frost", desk && l.bgFrost === true);
  bridge.setMaterial(!desk ? "solid" : l.bgFrost === true ? "frost" : "clear", desk ? deskGround(l) : undefined);
  // The backdrop behind the session follows along.
  window.dispatchEvent(new CustomEvent("lc:look", { detail: l }));
}

/** The look as it is now, again whenever Settings changes it. */
export function useLook() {
  const [look, setLook] = useState(readLook);
  useEffect(() => {
    const on = (e: Event) => setLook((e as CustomEvent<Look>).detail);
    window.addEventListener("lc:look", on);
    return () => window.removeEventListener("lc:look", on);
  }, []);
  return look;
}

/** Changes part of the dots behind Home, and puts the look on the page. */
export function updateDots(patch: Partial<DotLook>) {
  // Only what was chosen is kept, so a size never chosen still follows the look (dotsOf).
  const was = readLook();
  const next = { ...was, dots: { ...was.dots, ...patch } };
  try {
    localStorage.setItem(LOOK_KEY, JSON.stringify(next));
  } catch {
    // storage is off: it lasts while the app is open
  }
  // The dots change with every keystroke and drag: the look goes round without being put on the
  // page again (applyLook rewrites the theme's colours and tells the shell), since none of that changed.
  window.dispatchEvent(new CustomEvent("lc:look", { detail: next }));
  return next;
}

/** Changes part of the look from outside Settings (a design's own menu), and puts it on the page. */
export function updateLook(patch: Partial<Look>) {
  const next = { ...readLook(), ...patch };
  try {
    localStorage.setItem(LOOK_KEY, JSON.stringify(next));
  } catch {
    // storage is off: it lasts while the app is open
  }
  applyLook(next);
  return next;
}

/*
  Quick motion: a view you open shows what it holds as it is, in its first frame, and what arrives
  while you watch moves as in Full. For a moment after a view opens (its entering window) every
  animation and transition that starts in it is ended on the spot: once as it opens, and again
  after each change React makes in it, from a MutationObserver, which runs before the frame is
  painted. Ending them from here leaves nothing to undo when the window closes: no class to take
  off (which would restyle the whole view), no endless spinner put out of step, no long animation
  that picks up half way. Not ended: what runs for ever, hints that wait or repeat on purpose
  (the state mark's dots, whose change of state is how a person reads it, as their light is; the
  live line's newest step sliding in, which says the work moved on; a badge's pulse) and timers,
  which measure time.
*/
const ENTER_MS = 700;
const HINTS = ".lc-mk > i, .lc-ll-tick > *, .l-badge__dot, [data-timer]";
const windows = new WeakMap<Element, { watch: MutationObserver; timer: number }>();

/** Opens a view's entering window, from now. A callback ref as it is, or call it when the view changes. */
export function entering(el: Element | null) {
  if (!el || document.documentElement.dataset.motion !== "quick") return;
  const open = windows.get(el);
  if (open) clearTimeout(open.timer);
  const watch = open?.watch ?? new MutationObserver(() => settle(el));
  if (!open) watch.observe(el, { childList: true, subtree: true, attributes: true });
  windows.set(el, { watch, timer: window.setTimeout(() => (watch.disconnect(), windows.delete(el)), ENTER_MS) });
  settle(el);
}

/** Ends what has started in a view: getAnimations works its styles out first, so what this frame starts is there. */
function settle(el: Element) {
  // All of them read first, then all ended: reading a CSS animation's state works the styles out
  // again after each one ended, so asking and ending in turn restyled the view once per animation.
  const ending = el.getAnimations({ subtree: true }).filter((a) => {
    const target = a.effect instanceof KeyframeEffect ? a.effect.target : null;
    return target && a.playState !== "finished" && a.effect!.getComputedTiming().endTime !== Infinity && !target.matches(HINTS);
  });
  for (const a of ending) {
    // One that won't end (finish() throws when it can't) is left to play: it must not take the view down with it.
    try {
      a.finish();
    } catch {}
  }
}
