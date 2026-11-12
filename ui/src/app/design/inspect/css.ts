/*
  Small readings of CSS values for the inspector: pixels from "12px", a colour as #RRGGBB and its
  alpha whatever way the browser wrote it, and whether two colours are the same. The frame agent
  hands computed values as the browser resolves them (rgb(), px), and inline ones as written.
*/

/** "12px" → 12, "0" → 0, "1.4" → 1.4; anything else (auto, var(), %) → undefined. */
export function px(v?: string | null): number | undefined {
  if (v == null) return undefined;
  const m = /^\s*(-?\d*\.?\d+)(px)?\s*$/.exec(v);
  return m ? Number(m[1]) : undefined;
}

/** A number as the inspector shows it: at most two decimals, no trailing zeros. */
export const fmt = (n: number | undefined) => (n === undefined || !Number.isFinite(n) ? "" : String(Math.round(n * 100) / 100));

let probe: CanvasRenderingContext2D | null | undefined;
/** Any CSS colour the browser knows → { hex: "#RRGGBB", a: 0..1 }; undefined for var(), gradients, nonsense. */
export function colour(v?: string | null): { hex: string; a: number } | undefined {
  if (!v) return undefined;
  const s = v.trim();
  if (/^transparent$/i.test(s)) return { hex: "#000000", a: 0 };
  let m = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return undefined;
    return { hex: "#" + h.slice(0, 6).toUpperCase(), a: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 };
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(s);
  if (m) {
    const hex = "#" + [m[1], m[2], m[3]].map((c) => Math.round(Math.min(255, Number(c))).toString(16).padStart(2, "0")).join("").toUpperCase();
    const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
    return { hex, a };
  }
  if (/var\(|gradient|url\(/i.test(s)) return undefined;
  // Named colours and the rest: let a canvas say what it is.
  if (probe === undefined) probe = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  if (!probe) return undefined;
  probe.fillStyle = "#010203";
  probe.fillStyle = s;
  const out = String(probe.fillStyle);
  if (out === "#010203" && !/^#010203$/i.test(s)) return undefined;
  return colour(out);
}

/** The same colour, alpha included, whatever way each was written. */
export function sameColour(a?: string | null, b?: string | null) {
  const x = colour(a);
  const y = colour(b);
  return Boolean(x && y && x.hex === y.hex && Math.abs(x.a - y.a) < 0.01);
}

/** "#BFE0EA" and 0.5 → "rgba(191, 224, 234, 0.5)"; a whole alpha keeps the hex. */
export function withAlpha(hex: string, a: number) {
  if (a >= 1) return hex.toUpperCase();
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.round(a * 100) / 100})`;
}

/** A computed colour is see-through (nothing painted). */
export const clear = (v?: string) => !v || colour(v)?.a === 0;

/** The first shadow of a box-shadow, read: offsets, blur, spread, colour. undefined for none. */
export function shadowOf(v?: string): { x: number; y: number; blur: number; spread: number; colour: string; inset: boolean } | undefined {
  if (!v || v === "none") return undefined;
  const first = splitTop(v)[0];
  const col = /(rgba?\([^)]*\)|#[0-9a-f]{3,8}\b|[a-z]+(?=\s|$))/i.exec(first.replace(/\binset\b/, ""));
  const nums = (first.replace(col?.[0] ?? "", "").match(/-?\d*\.?\d+(px)?/g) ?? []).map((n) => parseFloat(n));
  return { x: nums[0] ?? 0, y: nums[1] ?? 0, blur: nums[2] ?? 0, spread: nums[3] ?? 0, colour: col?.[0] ?? "rgba(0, 0, 0, 0.2)", inset: /\binset\b/.test(first) };
}

/** Splits at the commas that aren't inside brackets ("a, rgb(1,2,3)" → two). */
export function splitTop(v: string) {
  const out: string[] = [];
  let depth = 0;
  let at = 0;
  for (let i = 0; i < v.length; i++) {
    if (v[i] === "(") depth++;
    else if (v[i] === ")") depth--;
    else if (v[i] === "," && depth === 0) out.push(v.slice(at, i).trim()), (at = i + 1);
  }
  out.push(v.slice(at).trim());
  return out.filter(Boolean);
}

/** The first family of a font-family list, without its quotes. */
export const familyOf = (v?: string) => (v ? splitTop(v)[0]?.replace(/^["']|["']$/g, "") : undefined);
