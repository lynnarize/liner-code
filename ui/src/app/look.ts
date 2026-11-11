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
  blurred (px) and how much of it shows through (0 to 1).
  `motion`: Full plays every view's way in each time it opens; Quick shows a view you open as it is
  and keeps the motion for what arrives while you watch. The system's Reduce motion stops both.
*/
export type Glass = "clear" | "tinted" | "solid";
export type ActionColour = "red" | "accent" | "ink" | "own";
export type DesignsWhere = "panel" | "chat";
export type Motion = "full" | "quick";
export type Look = { theme: "light" | "dark" | "system"; accent: string; composer: Glass; designs: DesignsWhere; designsAuto: boolean; action: ActionColour; motion: Motion; custom?: string; accentColor?: string; actionColor?: string; background?: string; bgBlur?: number; bgShow?: number; v?: number };
export const LOOK_KEY = "liner-code:look";
const MOTIONS: Motion[] = ["full", "quick"];
export const LOOK_DEFAULT: Look = { theme: "system", accent: "blue", composer: "tinted", designs: "panel", designsAuto: true, action: "red", motion: "quick" };
export const readLook = (): Look => {
  let saved: Partial<Look> & { v?: number } = {};
  try {
    saved = JSON.parse(localStorage.getItem(LOOK_KEY) || "{}") as typeof saved;
  } catch {
    // storage is off: the defaults
  }
  // Before 0.1.4 the whole window was glass, with a material behind it and Clear to Tinted; one
  // ground replaced them. The session tray's glass went with the tray, for the top-right row
  // (TopBar.tsx). What's left of either in a saved look is dropped here.
  const { glass: _glass, material: _material, tray: _tray, ...rest } = saved as Partial<Look> & { glass?: string; material?: string; tray?: string };
  const look = { ...LOOK_DEFAULT, ...rest, v: 3 };
  // A look saved before there was a choice, or with a word this build doesn't know, moves as Quick.
  if (!MOTIONS.includes(look.motion)) look.motion = LOOK_DEFAULT.motion;
  return look;
};

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
  bridge.setMaterial("solid");
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
  (Home's cue, the ping of a session that needs you, a badge's pulse) and timers, which measure time,
  like the line under the Desk's cue that drains while the second scroll counts.
*/
const ENTER_MS = 700;
const HINTS = ".lc-desk-cue, .lc-desk-cue-chev, .lc-desk-cue-n i, .lc-desk-cue-bar, .lc-mk > i, .l-badge__dot, [data-timer]";
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
