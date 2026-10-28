/*
  Themes of your own: a VS Code colour theme brought in (its JSON, comments and all), or one you
  make from a few colours. A theme is a base (light or dark, for everything it doesn't set) and
  the colours Liner's look is built from: the window, the paper, the ink, the accent, and the
  three states. The rest (lines, washes, the softer inks) is mixed from those, so the whole app
  follows. Kept in this window's storage, like the rest of the look.
*/
import { hexOf } from "./Surfaces";

export type Theme = {
  id: string;
  name: string;
  base: "light" | "dark";
  colors: { bg: string; surface: string; ink: string; accent: string; ok?: string; warn?: string; danger?: string };
  from: "vscode" | "mine";
};

const KEY = "liner-code:themes";
export function readThemes(): Theme[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]") as Theme[];
    return Array.isArray(v) ? v.filter((t) => t && t.id && t.colors) : [];
  } catch {
    return [];
  }
}
export function saveThemes(list: Theme[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // storage is off; the theme lasts until the window closes
  }
}

const isColor = (v: unknown): v is string => typeof v === "string" && /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v.trim());
/** "#rrggbbaa" loses its alpha: a theme's surfaces are drawn opaque here. */
const solid = (v: string) => (v.length === 9 ? v.slice(0, 7) : v.length === 5 ? v.slice(0, 4) : v);

/** A VS Code theme's JSON as a theme here, or what's missing. */
export function fromVSCode(text: string, fileName = ""): { theme?: Theme; error?: string } {
  const clean = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'\\])\/\/.*$/gm, "$1")
    .replace(/,\s*([\]}])/g, "$1");
  let v: { name?: string; type?: string; colors?: Record<string, unknown> };
  try {
    v = JSON.parse(clean) as typeof v;
  } catch {
    return { error: "That isn't a theme's JSON. In VS Code: Developer: Generate Color Theme From Current Settings, then save the file." };
  }
  const c = v.colors ?? {};
  const pick = (...keys: string[]) => keys.map((k) => c[k]).find(isColor) as string | undefined;
  const surface = pick("editor.background");
  const ink = pick("editor.foreground", "foreground");
  if (!surface || !ink) return { error: "The theme has no editor colours (editor.background and editor.foreground)." };
  const bg = pick("sideBar.background", "activityBar.background", "editorGroupHeader.tabsBackground") ?? surface;
  const accent = pick("focusBorder", "button.background", "textLink.foreground", "activityBarBadge.background", "progressBar.background") ?? ink;
  const name = (v.name || fileName.replace(/\.(json|jsonc)$/i, "").replace(/[-_]+/g, " ") || "Imported theme").trim();
  const base = v.type === "light" || v.type === "hcLight" ? "light" : v.type === "dark" || v.type === "hc" || v.type === "hcDark" ? "dark" : lightness(surface) > 0.5 ? "light" : "dark";
  return {
    theme: {
      id: `t${Date.now().toString(36)}`,
      name,
      base,
      from: "vscode",
      colors: {
        bg: solid(bg),
        surface: solid(surface),
        ink: solid(ink),
        accent: solid(accent),
        ok: pick("terminal.ansiGreen", "gitDecoration.addedResourceForeground"),
        warn: pick("editorWarning.foreground", "terminal.ansiYellow"),
        danger: pick("errorForeground", "editorError.foreground", "terminal.ansiRed"),
      },
    },
  };
}

/** 0 for black, 1 for white, near enough for picking light or dark text. */
export function lightness(hex: string) {
  const h = solid(hex).replace("#", "");
  const full = h.length === 3 ? h.replace(/./g, (x) => x + x) : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** Text that reads on a colour. */
export const inkOn = (hex: string) => (lightness(hex) > 0.36 ? "#16181d" : "#ffffff");

const mix = (a: string, b: string, p: number) => `color-mix(in oklab, ${a} ${p}%, ${b})`;

/** Liner's tokens, from a theme's few colours. */
export function varsOf(t: Theme): Record<string, string> {
  const { bg, surface, ink, accent, ok, warn, danger } = t.colors;
  const out: Record<string, string> = {
    "--l-bg": bg,
    "--l-surface": surface,
    "--l-surface-2": mix(ink, surface, 4),
    "--l-surface-3": mix(ink, surface, 8),
    "--l-ink": ink,
    "--l-ink-2": mix(ink, surface, 80),
    "--l-ink-3": mix(ink, surface, 64),
    "--l-ink-4": mix(ink, surface, 48),
    "--l-ink-5": mix(ink, surface, 32),
    "--l-line": mix(ink, "transparent", 8),
    "--l-line-2": mix(ink, "transparent", 13),
    "--l-line-strong": mix(ink, "transparent", 24),
    "--l-wash": mix(ink, "transparent", 4),
    "--l-wash-2": mix(ink, "transparent", 7),
    "--l-wash-3": mix(ink, "transparent", 11),
    "--l-glass-base": bg,
    "--l-accent": accent,
    "--l-accent-ink": inkOn(accent),
  };
  if (ok) out["--l-ok"] = ok;
  if (warn) out["--l-warn"] = warn;
  if (danger) out["--l-danger"] = danger;
  return out;
}

/** Every token a theme or an accent of your own can set, to clear them again. */
const ALL = ["--l-bg", "--l-surface", "--l-surface-2", "--l-surface-3", "--l-ink", "--l-ink-2", "--l-ink-3", "--l-ink-4", "--l-ink-5", "--l-line", "--l-line-2", "--l-line-strong", "--l-wash", "--l-wash-2", "--l-wash-3", "--l-glass-base", "--l-accent", "--l-accent-ink", "--l-ok", "--l-warn", "--l-danger"];
export function clearTheme(h: HTMLElement) {
  for (const k of ALL) h.style.removeProperty(k);
}

/** The colours the app shows now, as a starting point for one of your own. */
export function current(base: "light" | "dark"): Theme["colors"] {
  const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  return { bg: hexOf(css("--l-bg"), base === "dark" ? "#1b1c1f" : "#f7f8fa"), surface: hexOf(css("--l-surface"), base === "dark" ? "#25262a" : "#ffffff"), ink: hexOf(css("--l-ink"), base === "dark" ? "#f4f4f6" : "#1d1f24"), accent: hexOf(css("--l-accent"), "#2f7ae5") };
}
