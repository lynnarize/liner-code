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
*/
export type Glass = "clear" | "tinted" | "solid";
export type ActionColour = "red" | "accent" | "ink" | "own";
export type DesignsWhere = "panel" | "chat";
export type Look = { theme: "light" | "dark" | "system"; accent: string; composer: Glass; designs: DesignsWhere; designsAuto: boolean; action: ActionColour; custom?: string; accentColor?: string; actionColor?: string; background?: string; bgBlur?: number; bgShow?: number; v?: number };
export const LOOK_KEY = "liner-code:look";
export const LOOK_DEFAULT: Look = { theme: "system", accent: "blue", composer: "tinted", designs: "panel", designsAuto: true, action: "red" };
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
  return { ...LOOK_DEFAULT, ...rest, v: 3 };
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
