/*
  How the app looks: the theme, the accent, the glass and the backdrop, kept in this browser's
  storage and put on the page (and the window) at launch, before Settings is ever opened.
*/
import { bridge } from "./bridge";
import { clearTheme, inkOn, readThemes, varsOf } from "./themes";

/**
  `custom`: one of your themes, by id. `accentColor`: your own accent, when `accent` is "own".
  `background`: the picture behind the session ("apple:<name>", "own", or none), with how much it's
  blurred (px) and how much of it shows through the paper (0 to 1).
*/
export type Look = { theme: "light" | "dark" | "system"; accent: string; glass: string; material: "glass" | "vibrancy" | "solid"; custom?: string; accentColor?: string; background?: string; bgBlur?: number; bgShow?: number; v?: number };
export const LOOK_KEY = "liner-code:look";
export const LOOK_DEFAULT: Look = { theme: "system", accent: "blue", glass: "0.25", material: "solid" };
export const readLook = (): Look => {
  let saved: Partial<Look> & { v?: number } = {};
  try {
    saved = JSON.parse(localStorage.getItem(LOOK_KEY) || "{}") as typeof saved;
  } catch {
    // storage is off: the defaults
  }
  // Liquid Glass was the default until 2026-10-27, behind the whole window, and it kept the GPU busy.
  // A look saved before then starts on Solid; Liquid Glass is one choice away, behind the sidebar only.
  if (saved.v !== 2 && saved.material === "glass") delete saved.material;
  return { ...LOOK_DEFAULT, ...saved, v: 2 };
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
  h.style.setProperty("--l-glass-opacity", l.glass);
  bridge.setAppearance(own ? own.base : l.theme);
  bridge.setMaterial(l.material);
  // The backdrop behind the session follows along.
  window.dispatchEvent(new CustomEvent("lc:look", { detail: l }));
}
