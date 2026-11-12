/*
  What in the open design file is off its lean: every drawn frame walked through the frame bridge
  (its outline, then each node read for its computed styles), and each value no token matches
  kept with the nodes that use it. The Lean page lists them, each with one press that brings them
  back through design.apply; the inspector's off-lean note asks here how often a value is used, to
  offer "Add to the lean" from the third use on. addToLean writes that line into DESIGN.md's text.

  A walk runs only while something listens (the Lean page, a note in the inspector), again a moment
  after a frame's HTML or the lean changes, and reads at most MAX_NODES nodes a frame.
*/
import { useEffect, useSyncExternalStore } from "react";
import type { FrameOp, LeanTokens, NodeRead, TreeNode } from "@contracts";
import { frames, isReady, onReady } from "./bridge";
import { colour, px } from "./inspect/css";
import { leanNow, nearest, nearestColour, ruleAbout, varsIn, written } from "./lean";
import { design, getDesign, subscribeDesign } from "./store";

export type OffKind = "colour" | "space" | "corner" | "type" | "outline" | "shadow";
type Use = { frame: string; id: string; name: string; props: string[] };
export type OffFinding = {
  key: string;
  kind: OffKind;
  /** "#C9D6DA", "14": what is used. */
  value: string;
  uses: Use[];
  text: string;
  /** The press that brings it back, and the value it writes into each property a use has. */
  act: string;
  to: string;
  /** The lean's name for what it writes (a colour's "Shallows"), so a frame's own custom property can be used. */
  toName?: string;
  /** How often this value is used in the file, all properties together (for Add to the lean). */
  count: number;
};
export type OffState = { file?: string; findings: OffFinding[]; samples: Record<number, string>; busy: boolean; at: number };

const MAX_NODES = 600;
const FULL = 100;
let now: OffState = { findings: [], samples: {}, busy: false, at: 0 };
const fns = new Set<() => void>();
const set = (s: Partial<OffState>) => ((now = { ...now, ...s }), fns.forEach((f) => f()));
let listeners = 0;
let timer = 0;
let run = 0;
let stopHearing: (() => void) | undefined;
let lastHtml: unknown;
let lastLean: unknown;

const flat = (n: TreeNode, out: TreeNode[] = []) => {
  out.push(n);
  for (const c of n.children) flat(c, out);
  return out;
};
const hexOf = (v?: string) => {
  const c = colour(v);
  return c && c.a > 0.02 ? c.hex : undefined;
};
const who = (uses: Use[]) => {
  const names = [...new Set(uses.map((u) => u.name))];
  return names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names[0]} and ${names.length - 1} more`;
};

/** The findings for one node, by group key. */
function look(t: LeanTokens, r: NodeRead, add: (key: string, kind: OffKind, value: string, prop: string, extra?: Partial<OffFinding>) => void) {
  const c = r.computed;
  const hexes = t.colours.map((x) => hexOf(x.value)).filter(Boolean) as string[];
  const known = (hex: string) => hexes.includes(hex);
  if (hexes.length) {
    const bg = hexOf(c["background-color"]);
    if (bg && !known(bg)) add(`fill:${bg}`, "colour", bg, "background-color");
    const ink = r.kind === "text" ? hexOf(c.color) : undefined;
    if (ink && !known(ink)) add(`ink:${ink}`, "colour", ink, "color");
  }
  const sides = ["top", "right", "bottom", "left"].filter((s) => (px(c[`border-${s}-width`]) ?? 0) > 0 && !/none|hidden/.test(c[`border-${s}-style`] ?? "none"));
  const noOutlines = ruleAbout(t, /outline|border|stroke/i);
  if (sides.length === 4 && noOutlines) {
    const hex = hexOf(c["border-top-color"]) ?? "";
    add(`outline:${hex}`, "outline", hex, "border-style");
  } else if (hexes.length) {
    for (const s of sides) {
      const hex = hexOf(c[`border-${s}-color`]);
      if (hex && !known(hex)) add(`line:${hex}`, "colour", hex, `border-${s}-color`);
    }
  }
  if (c["box-shadow"] && c["box-shadow"] !== "none" && ruleAbout(t, /shadow/i)) add("shadow", "shadow", "", "box-shadow");
  if (t.steps.length) {
    const off = (n?: number) => n !== undefined && n > 0 && !t.steps.includes(n);
    if (/flex|grid/.test(c.display ?? "")) for (const g of new Set((c.gap ?? "").split(/\s+/).map(px))) if (off(g)) add(`gap:${g}`, "space", String(g), "gap");
    for (const s of ["top", "right", "bottom", "left"]) {
      const p = px(c[`padding-${s}`]);
      if (off(p)) add(`pad:${p}`, "space", String(p), `padding-${s}`);
    }
  }
  if (t.corners.length) {
    const ok = [0, ...t.corners.map((x) => x.value)];
    for (const k of ["top-left", "top-right", "bottom-right", "bottom-left"]) {
      const v = px(c[`border-${k}-radius`]);
      if (v !== undefined && v > 0 && v < FULL && !ok.includes(v)) add(`corner:${v}`, "corner", String(v), `border-${k}-radius`);
    }
  }
  const sizes = t.type.map((x) => x.size).filter((x): x is number => x !== undefined);
  if (sizes.length && r.kind === "text") {
    const v = px(c["font-size"]);
    if (v !== undefined && !sizes.includes(v)) add(`type:${v}`, "type", String(v), "font-size");
  }
}

/** Words and the fix for a group of uses. */
function finish(t: LeanTokens, f: Omit<OffFinding, "text" | "act" | "to" | "count">): Omit<OffFinding, "count"> | undefined {
  const many = new Set(f.uses.map((u) => u.name)).size > 1;
  const name = who(f.uses);
  const is = many ? "are" : "is";
  const has = many ? "have" : "has";
  const v = Number(f.value);
  const between = (list: number[]) => (v > Math.min(...list) && v < Math.max(...list) ? "between two steps" : "off the steps");
  if (f.kind === "outline") return { ...f, text: `${name} ${has} an outline${f.value ? `, ${f.value}` : ""}`, act: "Take it off", to: "none" };
  if (f.kind === "shadow") return { ...f, text: `${name} ${has} a shadow`, act: "Take it off", to: "none" };
  if (f.kind === "space") {
    const to = nearest(t.steps, v);
    const word = f.key.startsWith("gap") ? "spaced" : "padded";
    return { ...f, text: `${name} ${is} ${word} ${f.value}, ${between(t.steps)}`, act: `Use ${to}`, to: `${to}px` };
  }
  if (f.kind === "corner") {
    const to = nearest([0, ...t.corners.map((c) => c.value)], v);
    return { ...f, text: `${name} ${has} corners of ${f.value}, not the lean's`, act: `Use ${to}`, to: `${to}px` };
  }
  if (f.kind === "type") {
    const styles = t.type.filter((s) => s.size !== undefined);
    const to = styles.reduce((a, b) => (Math.abs(b.size! - v) < Math.abs(a.size! - v) ? b : a), styles[0]);
    return { ...f, text: `${name} ${is} set at ${f.value}, not one of the type styles`, act: `Use ${to.name}`, to: `${to.size}px` };
  }
  // A day colour before a night one ("Shallows (night)"), when the lean has both.
  const day = t.colours.filter((c) => !/\(.*\)$/.test(c.name));
  const near = nearestColour(day.length ? { ...t, colours: day } : t, f.value);
  if (!near || !colour(near.value)) return undefined;
  const what = f.key.startsWith("fill") ? `${name} ${is} filled ${f.value}` : f.key.startsWith("ink") ? `The text of ${name} is ${f.value}` : `${name}${many ? "" : "'s"} ${many ? "have lines in" : "line is"} ${f.value}`;
  return { ...f, text: `${what}, not a lean colour`, act: `Use ${near.name}`, to: near.value, toName: near.name };
}

async function walk() {
  const me = ++run;
  const s = getDesign();
  const lean = leanNow();
  const t = lean?.tokens;
  if (!s.file || !t) return set({ file: s.file?.id, findings: [], samples: {}, busy: false, at: Date.now() });
  set({ busy: true });
  const groups = new Map<string, Omit<OffFinding, "text" | "act" | "to" | "count">>();
  const counts = new Map<string, number>();
  const samples: Record<number, string> = {};
  for (const f of s.file.frames) {
    if (f.kind !== "drawn" || !isReady(f.id)) continue;
    let root: TreeNode;
    try {
      root = await frames.tree(f.id);
    } catch {
      continue;
    }
    const nodes = flat(root).slice(0, MAX_NODES);
    for (let i = 0; i < nodes.length; i += 40) {
      const reads = await Promise.all(nodes.slice(i, i + 40).map((n) => frames.read(f.id, n.id).catch(() => undefined)));
      if (me !== run) return;
      for (const r of reads) {
        if (!r) continue;
        const size = px(r.computed["font-size"]);
        const words = r.kind === "text" ? (r.text ?? "").trim().replace(/\s+/g, " ") : "";
        if (size && words && words.length <= 28 && !samples[size]) samples[size] = words;
        look(t, r, (key, kind, value, prop) => {
          const g = groups.get(key) ?? { key, kind, value, uses: [] };
          const u = g.uses.find((x) => x.frame === f.id && x.id === r.id);
          if (u) u.props.push(prop);
          else g.uses.push({ frame: f.id, id: r.id, name: r.name || r.tag, props: [prop] });
          groups.set(key, g);
          const c = `${kind}:${value}`;
          if (!u) counts.set(c, (counts.get(c) ?? 0) + 1);
        });
      }
    }
  }
  if (me !== run) return;
  const findings = [...groups.values()].map((g) => finish(t, g)).filter((x): x is Omit<OffFinding, "count"> => Boolean(x)).map((x) => ({ ...x, count: counts.get(`${x.kind}:${x.value}`) ?? x.uses.length }));
  findings.sort((a, b) => b.uses.length - a.uses.length);
  set({ file: s.file.id, findings, samples, busy: false, at: Date.now() });
}

const soon = (ms = 700) => {
  clearTimeout(timer);
  timer = window.setTimeout(() => void walk(), ms);
};

function hear() {
  const unDesign = subscribeDesign(() => {
    const s = getDesign();
    const lean = leanNow();
    if (s.html === lastHtml && lean === lastLean) return;
    lastHtml = s.html;
    lastLean = lean;
    soon();
  });
  const unReady = onReady(() => soon(900));
  return () => (unDesign(), unReady());
}

/** What is off the lean in the open design file, walked while this is used. */
export function useOffLean(): OffState {
  useEffect(() => {
    if (listeners++ === 0) {
      stopHearing = hear();
      soon(60);
    }
    return () => {
      if (--listeners === 0) {
        stopHearing?.();
        stopHearing = undefined;
        clearTimeout(timer);
      }
    };
  }, []);
  return useSyncExternalStore((f) => (fns.add(f), () => void fns.delete(f)), () => now);
}

/** Walk again now (the Lean page's "Check again"). */
export const walkAgain = () => soon(0);

/** Brings a group back to the lean: its fix written into every node that uses it, a frame at a time. */
export async function bringBack(f: OffFinding) {
  const byFrame = new Map<string, FrameOp[]>();
  // var(--name) where the frame declares one for the value (foreshore.css's --shallows), else the value.
  const kind = f.kind === "colour" || f.kind === "space" || f.kind === "corner" ? f.kind : undefined;
  for (const u of f.uses) {
    const to = kind ? written(f.to, kind, varsIn(getDesign().html[u.frame] ?? ""), f.toName) : f.to;
    byFrame.set(u.frame, [...(byFrame.get(u.frame) ?? []), { id: u.id, style: Object.fromEntries(u.props.map((p) => [p, to])) }]);
  }
  for (const [frame, ops] of byFrame) await design.apply(frame, ops);
  soon(200);
}

/** How often a value is used in the file (from the last walk), for the inspector's note. */
export const usesOf = (kind: OffKind, value: string) => now.findings.filter((f) => f.kind === kind && f.value.toLowerCase() === value.toLowerCase()).reduce((n, f) => Math.max(n, f.count), 0);

// ---------- Add to the lean

const HEADS: Record<"colour" | "space" | "corner" | "type", { find: RegExp; head: string }> = {
  colour: { find: /colou?r|palette|swatch/i, head: "## Colour" },
  space: { find: /space|spacing|grid|layout|step/i, head: "## Space" },
  corner: { find: /shape|corner|radi/i, head: "## Shape" },
  type: { find: /\btype\b|typograph|font|typeface/i, head: "## Type" },
};

/**
  DESIGN.md with one more value, in the section it belongs to (the last line of that section), or
  a new section at the end when there is none. Lines are written the way the engine's parser reads
  them (engine/src/lean.ts):
    colour  "- Mist #C9D6DA"
    type    "- Text 13"
    corner  "- Corners: soft 6"
    space   the steps' own line gets the number, in order ("4, 8, 12, 14, 16"); else "Steps: …"
*/
export function addToLean(md: string, kind: "colour" | "space" | "corner" | "type", value: string, name: string, steps: number[] = []): string {
  const lines = md.replace(/\s+$/, "").split("\n");
  const at = HEADS[kind];
  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const h = /^\s{0,3}#{1,6}\s+(.*)$/.exec(lines[i]);
    if (!h) continue;
    if (start >= 0) {
      end = i;
      break;
    }
    if (at.find.test(h[1])) start = i;
  }
  if (kind === "space" && start >= 0) {
    for (let i = start + 1; i < end; i++) {
      const run = /\d+(?:px)?(?:\s*,\s*\d+(?:px)?){2,}/.exec(lines[i]);
      if (!run) continue;
      const all = [...new Set([...run[0].split(",").map((x) => parseFloat(x)), Number(value)])].sort((a, b) => a - b);
      lines[i] = lines[i].slice(0, run.index) + all.join(", ") + lines[i].slice(run.index + run[0].length);
      return `${lines.join("\n")}\n`;
    }
  }
  const line = kind === "colour" ? `- ${name} ${value.toUpperCase()}` : kind === "type" ? `- ${name} ${value}` : kind === "corner" ? `- Corners: ${name} ${value}` : `Steps: ${[...new Set([...steps, Number(value)])].sort((a, b) => a - b).join(", ")}.`;
  if (start < 0) return `${lines.join("\n")}${lines.length && lines[lines.length - 1].trim() ? "\n\n" : "\n"}${at.head}\n\n${line}\n`;
  // After the section's last line with words, before the blank lines that end it.
  let last = end - 1;
  while (last > start && !lines[last].trim()) last--;
  lines.splice(last + 1, 0, line);
  return `${lines.join("\n")}\n`;
}

/** A name for a new value: beside the lean's nearest colour ("Shallows 2"), or what kind it is. */
export function nameFor(t: LeanTokens | undefined, kind: "colour" | "space" | "corner" | "type", value: string) {
  if (kind === "colour") {
    const base = nearestColour(t, value)?.name.replace(/\s*\(.*\)$/, "") ?? "Colour";
    let n = 2;
    while (t?.colours.some((c) => c.name === `${base} ${n}`)) n++;
    return `${base} ${n}`;
  }
  return kind === "type" ? "Text" : kind === "corner" ? "soft" : "";
}
