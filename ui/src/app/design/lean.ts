/*
  The lean in the inspector: the project's DESIGN.md read into tokens (the lean.read RPC), turned
  into the choices each section shows first, and the other way round, a value told by its token's
  name. Until the engine answers (or when the folder has no lean) there is none, and the sections
  show plain values and their opened controls.

  What gets written: a token's own custom property when the frame's stylesheet declares one with
  the same value (var(--shallows), var(--space-3)), so the build can map names to the project's
  tokens; otherwise the plain value. The frame's custom properties come from its own <style> and
  the stylesheets it links beside it in the design folder.
*/
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Lean, LeanTokens } from "@contracts";
import { rpc } from "../engine";
import { getDesign, useDesign } from "./store";
import { colour, px, sameColour } from "./inspect/css";

// ---------- Reading the lean

const leans = new Map<string, Lean | null>();
const asking = new Set<string>();
const fns = new Set<() => void>();
const ping = () => fns.forEach((f) => f());

// The Foreshore sample's lean, for the canvas's ?ld-mock (dev only): its DESIGN.md as tokens.
const MOCK_LEAN: Lean = {
  path: "DESIGN.md",
  off: "root",
  text: "",
  tokens: {
    colours: [
      { name: "Deep", value: "#F7F8F5" },
      { name: "Shallows", value: "#BFE0EA" },
      { name: "Foreshore", value: "#B5D3A0" },
      { name: "Land", value: "#F0DA9C" },
      { name: "Ink", value: "#11181B" },
      { name: "Mark", value: "#C4127A" },
    ],
    type: [
      { name: "Label", family: "Archivo", size: 11, weight: 600 },
      { name: "Body", family: "Archivo", size: 15, weight: 400, line: "1.4" },
      { name: "Water", family: "Archivo", size: 34, weight: 700, italic: true },
      { name: "Figure", family: "Archivo", size: 172, weight: 800, italic: true },
    ],
    steps: [4, 8, 12, 16, 24, 32],
    corners: [{ name: "Corner", value: 4 }],
    rules: ["No outlines, no shadows.", "Magenta only for marks."],
  },
};

const keyOf = (cwd?: string, file?: string) => `${cwd ?? ""}\n${file ?? ""}`;

function ask(cwd: string | undefined, file: string | undefined, mock: boolean) {
  const k = keyOf(cwd, file);
  if (leans.has(k) || asking.has(k)) return;
  if (mock) return void (leans.set(k, MOCK_LEAN), ping());
  if (!cwd) return;
  asking.add(k);
  rpc("lean.read", { cwd, file })
    .then((l) => leans.set(k, l.off === "none" ? null : l))
    // Not built yet, or no engine: no lean, and the sections show plain values.
    .catch(() => leans.set(k, null))
    .finally(() => (asking.delete(k), ping()));
}

/** Reads the lean again (after DESIGN.md changed). */
export function reloadLean() {
  leans.clear();
  ping();
}

/** The open design file's lean, or null when there is none (or it can't be read yet). */
export function useLean(): Lean | null {
  const cwd = useDesign((s) => s.cwd);
  const file = useDesign((s) => s.file?.id);
  const mock = useDesign((s) => s.mock);
  const lean = useSyncExternalStore((f) => (fns.add(f), () => void fns.delete(f)), () => leans.get(keyOf(cwd, file)));
  useEffect(() => ask(cwd, file, mock), [cwd, file, mock, lean]);
  return lean ?? null;
}

/** For the inspector's own test page: a lean as if the engine had read it. */
export function setLean(cwd: string | undefined, file: string | undefined, lean: Lean | null) {
  leans.set(keyOf(cwd, file), lean);
  ping();
}

// ---------- The frame's own custom properties

/** name (without the dashes) → value as declared, the first declaration of each. */
export type FrameVars = Map<string, string>;
const EMPTY: FrameVars = new Map();

function declared(css: string, into: FrameVars) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of clean.matchAll(/--([\w-]+)\s*:\s*([^;}]+)/g)) if (!into.has(m[1])) into.set(m[1], m[2].trim());
}

const sheets = new Map<string, Promise<string>>();
/** A stylesheet the frame links beside it in the design folder (never one from the web). */
function sheet(base: string, href: string) {
  if (/^[a-z]+:|^\/\//i.test(href)) return Promise.resolve("");
  const url = `${base.replace(/\/$/, "")}/frames/${href.replace(/^\.\//, "")}`;
  let p = sheets.get(url);
  if (!p) sheets.set(url, (p = fetch(url).then((r) => (r.ok ? r.text() : "")).catch(() => "")));
  return p;
}

/** The custom properties a frame declares, from its HTML (inline <style>) and the stylesheets it links. */
export function useFrameVars(frame?: string): FrameVars {
  const html = useDesign((s) => (frame ? s.html[frame] : undefined));
  const base = useDesign((s) => s.base);
  const [vars, setVars] = useState<FrameVars>(EMPTY);
  useEffect(() => {
    if (!html) return setVars(EMPTY);
    let live = true;
    const out: FrameVars = new Map();
    for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) declared(m[1], out);
    // Inline style attributes declare custom properties too (style="--x: 4px").
    for (const m of html.matchAll(/style="([^"]*--[^"]*)"/gi)) declared(m[1], out);
    setVars(out);
    const links = [...html.matchAll(/<link\b[^>]*rel=["']?stylesheet[^>]*>/gi)].map((m) => /href=["']([^"']+)["']/i.exec(m[0])?.[1]).filter((h): h is string => Boolean(h));
    if (links.length && base !== undefined) {
      void Promise.all(links.map((h) => sheet(base, h))).then((texts) => {
        if (!live) return;
        const all: FrameVars = new Map(out);
        for (const t of texts) declared(t, all);
        setVars(all);
      });
    }
    return () => void (live = false);
  }, [html, base]);
  return vars;
}

/** The custom properties a frame's HTML declares itself (its <style> blocks and style="--x"), outside a component (E's off-lean fixes). */
export function varsIn(html: string): FrameVars {
  const out: FrameVars = new Map();
  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) declared(m[1], out);
  for (const m of html.matchAll(/style="([^"]*--[^"]*)"/gi)) declared(m[1], out);
  return out;
}

// ---------- Values as written

export type Kind = "colour" | "space" | "corner";
const HINT: Record<Kind, RegExp> = { colour: /./, space: /space|step|gap|pad|gutter|^s-?\d/i, corner: /radius|corner|round|^r-?\d/i };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
  What to write for a token's value: var(--name) when the frame declares a custom property with the
  same value (one named like the token first, then one whose name says what it is for), else the
  value. Lengths are compared in px; colours whatever way each is written.
*/
export function written(value: string, kind: Kind, vars: FrameVars, tokenName?: string): string {
  if (!vars.size) return value;
  const same = (v: string) => (kind === "colour" ? sameColour(v, value) : px(v) !== undefined && px(v) === px(value));
  const named = tokenName ? slug(tokenName) : undefined;
  let hinted: string | undefined;
  for (const [name, v] of vars) {
    if (!same(v)) continue;
    if (named && name === named) return `var(--${name})`;
    if (!hinted && HINT[kind].test(name)) hinted = name;
  }
  return hinted ? `var(--${hinted})` : value;
}

// ---------- Choices

export const nearest = (list: number[], v: number) => list.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), list[0]);

/** Spacing between children: the lean's first five steps. */
export function spacingChoices(t: LeanTokens | undefined, current?: number) {
  return withCurrent((t?.steps ?? []).slice(0, 5), t?.steps, current);
}

/**
  Padding: the steps on the doubled first step (4 → 8, 16, 24, 32), which is how a lean on a 4 grid
  usually pads blocks; a judgement, so a step that isn't shown but is the value now joins the row.
*/
export function paddingChoices(t: LeanTokens | undefined, current?: number) {
  const steps = t?.steps ?? [];
  const unit = (steps[0] ?? 4) * 2;
  let pick = steps.filter((s) => s >= unit && s % unit === 0).slice(0, 5);
  if (pick.length < 2) pick = steps.slice(-4);
  return withCurrent(pick, steps, current);
}

const withCurrent = (shown: number[], all: number[] | undefined, current?: number) => (current !== undefined && !shown.includes(current) && all?.includes(current) ? [...shown, current].sort((a, b) => a - b) : shown);

/** Corners: square, the lean's corners, and fully round. */
export function cornerChoices(t: LeanTokens | undefined): { name: string; value: number; label: string }[] {
  const lean = (t?.corners ?? []).filter((c) => c.value > 0 && c.value < 999).sort((a, b) => a.value - b.value);
  return [{ name: "Square", value: 0, label: "0" }, ...lean.map((c) => ({ ...c, label: String(c.value) })), { name: "Full", value: 999, label: "Full" }];
}

/** The lean's colour this value is, if any. */
export const colourToken = (t: LeanTokens | undefined, v?: string) => (v ? t?.colours.find((c) => sameColour(c.value, v)) : undefined);

/** The lean's colour nearest to this one (by plain distance in RGB, which is enough to pick from six). */
export function nearestColour(t: LeanTokens | undefined, v?: string) {
  const at = colour(v);
  if (!at || !t?.colours.length) return undefined;
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r, g, b] = rgb(at.hex);
  let best = t.colours[0];
  let dist = Infinity;
  for (const c of t.colours) {
    const h = colour(c.value);
    if (!h) continue;
    const [x, y, z] = rgb(h.hex);
    const d = (x - r) ** 2 + (y - g) ** 2 + (z - b) ** 2;
    if (d < dist) (dist = d), (best = c);
  }
  return best;
}

/** The lean's type style a node's text is: the same size and weight (and family, when the style names one). */
export function typeToken(t: LeanTokens | undefined, computed: Record<string, string>) {
  const size = px(computed["font-size"]);
  const weight = Number(computed["font-weight"]) || 400;
  const family = (computed["font-family"] ?? "").toLowerCase();
  return t?.type.find((s) => s.size === size && (s.weight ?? 400) === weight && (!s.family || family.includes(s.family.toLowerCase())));
}

/** A rule the lean writes in words that is about this (no outlines, no shadows), for an off-the-lean note. */
export const ruleAbout = (t: LeanTokens | undefined, about: RegExp) => t?.rules.find((r) => about.test(r));

/** For a test page or a later builder: what a design file's lean is, now. */
export const leanNow = () => leans.get(keyOf(getDesign().cwd, getDesign().file?.id)) ?? null;
