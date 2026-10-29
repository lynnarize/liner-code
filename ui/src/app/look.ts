/*
  How the app looks: the theme, the accent, the session tray's glass and the backdrop, kept in
  this browser's storage and put on the page (and the window) at launch, before Settings is ever
  opened.
*/
import { bridge } from "./bridge";
import { clearTheme, inkOn, readThemes, varsOf } from "./themes";

/**
  `custom`: one of your themes, by id. `accentColor`: your own accent, when `accent` is "own".
  `tray`: how much of the thread shows through the session tray, the one glass surface left.
  `action`: the colour of the most important buttons (Send, Commit and push, a card's main button):
  red, the accent, the tray's ink, or `actionColor` when it's "own".
  `background`: the picture behind the session ("apple:<name>", "own", or none), with how much it's
  blurred (px) and how much of it shows through (0 to 1).
*/
export type TrayGlass = "clear" | "tinted" | "solid";
export type ActionColour = "red" | "accent" | "ink" | "own";
export type Look = { theme: "light" | "dark" | "system"; accent: string; tray: TrayGlass; action: ActionColour; custom?: string; accentColor?: string; actionColor?: string; background?: string; bgBlur?: number; bgShow?: number; v?: number };
export const LOOK_KEY = "liner-code:look";
export const LOOK_DEFAULT: Look = { theme: "system", accent: "blue", tray: "tinted", action: "red" };
export const readLook = (): Look => {
  let saved: Partial<Look> & { v?: number } = {};
  try {
    saved = JSON.parse(localStorage.getItem(LOOK_KEY) || "{}") as typeof saved;
  } catch {
    // storage is off: the defaults
  }
  // Before 0.1.4 the whole window was glass, with a material behind it and Clear to Tinted; one
  // ground replaced them, and only the session tray keeps glass.
  const { glass: _glass, material: _material, ...rest } = saved as Partial<Look> & { glass?: string; material?: string };
  return { ...LOOK_DEFAULT, ...rest, v: 3 };
};

/** Puts a look on the page (and on the window, in the shell). */
export function applyLook(l: Look) {
  const h = document.documentElement;
  const dark = l.theme === "dark" || (l.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
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
  h.dataset.tray = l.tray;
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
  bridge.setAppearance(own ? own.base : l.theme);
  bridge.setMaterial("solid");
  // The backdrop behind the session follows along.
  window.dispatchEvent(new CustomEvent("lc:look", { detail: l }));
}
