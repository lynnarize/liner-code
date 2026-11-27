/*
  Your own dots behind Home: a picture, words, or one of three scenes the app paints (a moon over
  water, ridges at dusk, northern lights), drawn as a grid of dots after Capy's Home. The picture is
  painted small (two pixels a cell), shrunk to one pixel a cell, and each cell's light becomes one
  dot: squares in a 4×4 ordered dither, halftone squares that grow with the light, or round ones.
  Two inks put indigo in the shadows and pale lavender in the lights; one ink says the light by how
  bright a dot is; the picture's own keeps its colours, a little stronger. Your own picture has its
  darkest and lightest stretched first (the 2nd to 98th of its light), so a dark or washed-out photo
  starts neither faint nor full, and it's cropped to fill Home round a focus point you drag. The
  dots fade under the message box (measured, as the sea does), are dimmed round the heading and the
  box so what's written there reads, and thin out at the paper's edges. The light look prints
  instead, after Capy's light Home: a fine mosaic in the picture's own colours (or the ink's) laid
  over the paper see-through, the three scenes in day colours, and the paper coming back toward
  the foot (drawMosaic).

  It's cheap on purpose (Sea.tsx's rule, browser-panel-perf: measure frames). Still, the default,
  draws once per change or resize and then costs nothing. Breathes draws the whole grid at most 15
  times a second; Stirs draws only round the pointer, and only when it moved. Either draws 10 a
  second while the window isn't the one in use, none while it's hidden, and Reduce motion makes
  them Still. The dots are filled one path per colour, and the paper under them is the page's own
  (the canvas is clear), so a theme of your own carries them.

  The panel, Behind Home, opens over Home on the right (lc:behind-home): from the sea's card and
  this one's, and from Settings, Appearance. Every change in it applies at once (look.ts, dots).
*/
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Segmented } from "@liner/components/segmented/segmented";
import { Select } from "@liner/components/select/select";
import { Slider } from "@liner/components/slider/slider";
import { toast } from "@liner/components/toast/toast";
import { rpc } from "./engine";
import { I } from "./icons";
import { darkNow, DOT_INKS, dotsOf, homeInOf, homeOf, homeShown, readLook, updateDots, updateLook, type BehindHome as Behind, type HomeIn, type DotLook, type DotMove, type DotSource, type DotStyle, type DotTone, type Look } from "./look";
import "./dots.css";

/** The dots' small card stays, visit after visit, until its × closes it for good. */
const HELLO_KEY = "liner-code:dots-hello";
/** How often a moving look draws: Breathes swells slowly, so 15 a second is plenty; 10 while the window isn't the one in use. */
const FRAME_MS = { here: 1000 / 15, away: 1000 / 10 };
/** The thumbnails' cell, in CSS pixels. */
const THUMB_CELL = 3;
const TAU = Math.PI * 2;

/** Whether a move landed on the paper, not on something to use: the sea and the dots stir only there. */
export const onWater = (target: EventTarget | null) => target instanceof Element && !target.closest("button, a, input, textarea, select, [role='button'], [role='menu'], [role='dialog'], .lc-home-compose, .lc-home-top, .lc-sea-hello, .lc-bh, .lc-up-home, .lc-noproj");

/* ---------- Painting the scenes ---------- */

type RGB = [number, number, number];
const BAYER = Float32Array.from([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5], (v) => (v + 0.5) / 16);
const hexRgb = (h: string): RGB => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [111, 92, 255];
};
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgba = (c: RGB, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
/** The scenes' own seeded random (the mockup's), so the stars are the same stars every time. */
const seeded = (seed: number) => {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 4294967296);
};
const clamp = (v: number, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
const smooth = (x: number) => ((x = clamp(x)), x * x * (3 - 2 * x));
/** A colour channel in steps of 24, so the picture's own colours fall into a few hundred paths, not one a dot. */
const qz = (v: number) => Math.min(255, Math.round(clamp(v, 0, 255) / 24) * 24 + 8);

function paintMoon(c: CanvasRenderingContext2D, W: number, H: number) {
  const R = seeded(7);
  const m = Math.min(W, H);
  const hz = H * 0.64;
  const g = c.createLinearGradient(0, 0, 0, hz);
  g.addColorStop(0, "#4b4fa8");
  g.addColorStop(1, "#10122e");
  c.fillStyle = g;
  c.fillRect(0, 0, W, hz);
  const mx = W * 0.42;
  const my = H * 0.26;
  const r = m * 0.16;
  const h = c.createRadialGradient(mx, my, r * 0.9, mx, my, r * 3.4);
  h.addColorStop(0, "rgba(210,205,255,0.5)");
  h.addColorStop(1, "rgba(210,205,255,0)");
  c.fillStyle = h;
  c.fillRect(0, 0, W, hz);
  for (let i = 0; i < 160; i++) {
    const x = R() * W;
    const y = R() * hz * 0.95;
    const b = R();
    c.fillStyle = `rgba(255,255,255,${0.3 + b * 0.7})`;
    const z = b > 0.85 ? m * 0.006 : m * 0.003;
    c.fillRect(x, y, z, z);
  }
  const mg = c.createRadialGradient(mx - r * 0.35, my - r * 0.35, r * 0.1, mx, my, r);
  mg.addColorStop(0, "#fffdf0");
  mg.addColorStop(1, "#c9c2ad");
  c.fillStyle = mg;
  c.beginPath();
  c.arc(mx, my, r, 0, TAU);
  c.fill();
  // The moon's seas.
  c.fillStyle = "rgba(110,102,88,0.38)";
  for (const [x, y, s] of [[-0.3, -0.1, 0.22], [0.25, 0.2, 0.16], [0.05, -0.42, 0.12], [-0.1, 0.38, 0.1], [0.42, -0.22, 0.09]]) {
    c.beginPath();
    c.arc(mx + x * r, my + y * r, s * r, 0, TAU);
    c.fill();
  }
  // Two thin clouds, one across the moon.
  c.fillStyle = "rgba(14,16,42,0.8)";
  c.beginPath();
  c.ellipse(mx - r * 0.5, my + r * 0.78, r * 1.9, r * 0.15, -0.04, 0, TAU);
  c.fill();
  c.beginPath();
  c.ellipse(W * 0.82, H * 0.16, W * 0.2, H * 0.022, 0.03, 0, TAU);
  c.fill();
  const s = c.createLinearGradient(0, hz, 0, H);
  s.addColorStop(0, "#1c1e48");
  s.addColorStop(1, "#04050c");
  c.fillStyle = s;
  c.fillRect(0, hz, W, H - hz);
  // The moon's road on the water.
  for (let k = 0; k < 28; k++) {
    const yy = hz + H * 0.004 + k * H * 0.012 + R() * H * 0.003;
    const len = r * (1.6 - k * 0.045) * (0.5 + R() * 0.6);
    c.fillStyle = `rgba(255,248,225,${Math.max(0, 0.9 - k * 0.03)})`;
    c.fillRect(mx - len / 2 + (R() - 0.5) * r * 0.35, yy, len, H * 0.005);
  }
  // A headland on the right.
  c.fillStyle = "#07081a";
  c.beginPath();
  c.moveTo(W, hz + 1);
  for (let xx = W; xx >= W * 0.6; xx -= W / 80) {
    const u = (W - xx) / (W * 0.4);
    c.lineTo(xx, hz - H * 0.07 * Math.sin(u * 3.6) ** 2 * (1 - u));
  }
  c.lineTo(W * 0.6, hz + 1);
  c.fill();
}

function paintRidges(c: CanvasRenderingContext2D, W: number, H: number) {
  const g = c.createLinearGradient(0, 0, 0, H * 0.7);
  g.addColorStop(0, "#1d1440");
  g.addColorStop(0.55, "#7a3e7a");
  g.addColorStop(1, "#f39a62");
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  const sx = W * 0.4;
  const sy = H * 0.46;
  const sr = Math.min(W, H) * 0.11;
  const sg = c.createRadialGradient(sx, sy, sr * 0.2, sx, sy, sr * 3.2);
  sg.addColorStop(0, "rgba(255,220,160,0.9)");
  sg.addColorStop(1, "rgba(255,200,140,0)");
  c.fillStyle = sg;
  c.fillRect(0, 0, W, H);
  c.fillStyle = "#ffe6b0";
  c.beginPath();
  c.arc(sx, sy, sr, 0, TAU);
  c.fill();
  const cols = ["#a65c8c", "#76406f", "#4c2853", "#2a1636", "#120a1c"];
  for (let L = 0; L < 5; L++) {
    const base = H * (0.44 + L * 0.105);
    c.fillStyle = cols[L];
    c.beginPath();
    c.moveTo(0, H);
    for (let x = 0; x <= W + 1; x += W / 140) {
      const u = x / W;
      c.lineTo(x, base - H * (0.09 - L * 0.008) * (0.6 * Math.sin(u * (5 + L * 1.7) + L * 2.1) + 0.3 * Math.sin(u * (13 + L * 3) + L) + 0.15 * Math.sin(u * 31 + L * 5)));
    }
    c.lineTo(W, H);
    c.fill();
  }
}

function paintAurora(c: CanvasRenderingContext2D, W: number, H: number) {
  const R = seeded(3);
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#050817");
  g.addColorStop(1, "#0c1a2a");
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  for (let i = 0; i < 220; i++) {
    const b = R();
    c.fillStyle = `rgba(255,255,255,${0.25 + b * 0.6})`;
    c.fillRect(R() * W, R() * H * 0.8, 1.5, 1.5);
  }
  c.save();
  c.filter = `blur(${Math.max(2, Math.round(W * 0.016))}px)`;
  c.globalCompositeOperation = "lighter";
  const bands: [string, number, number][] = [["#3dffb0", 0.3, 0.1], ["#7c5cff", 0.2, 0.08], ["#38e0ff", 0.42, 0.05]];
  bands.forEach(([colour, at, width], n) => {
    c.strokeStyle = colour;
    c.globalAlpha = 0.6;
    c.lineWidth = H * width * 2;
    c.beginPath();
    for (let x = -W * 0.1; x <= W * 1.1; x += W / 80) {
      const u = x / W;
      const y = H * at + H * 0.08 * Math.sin(u * 4 + n * 1.3) + H * 0.04 * Math.sin(u * 9 + n);
      if (x === -W * 0.1) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.stroke();
  });
  // The curtains' rays.
  c.globalAlpha = 0.4;
  for (let k = 0; k < 70; k++) {
    const sx = R() * W;
    const top = H * (0.1 + R() * 0.2);
    const gr = c.createLinearGradient(0, top, 0, top + H * 0.3);
    gr.addColorStop(0, "rgba(80,255,190,0)");
    gr.addColorStop(0.5, "rgba(80,255,190,0.85)");
    gr.addColorStop(1, "rgba(80,255,190,0)");
    c.fillStyle = gr;
    c.fillRect(sx, top, W * 0.006, H * 0.3);
  }
  c.restore();
  // The pines along the foot.
  c.fillStyle = "#010205";
  c.beginPath();
  c.moveTo(0, H);
  const base = H * 0.84;
  let px = 0;
  while (px < W) {
    const w = W * (0.012 + R() * 0.02);
    const hh = H * (0.05 + R() * 0.13);
    c.lineTo(px, base);
    c.lineTo(px + w / 2, base - hh);
    c.lineTo(px + w, base);
    px += w * 0.8;
  }
  c.lineTo(W, base);
  c.lineTo(W, H);
  c.fill();
}

/** Up to three lines, set heavy and large in the app's own sans, over the message box: light on the night, or ink on white paper. */
function paintWords(c: CanvasRenderingContext2D, W: number, H: number, text: string, font: string, light: boolean) {
  if (light) {
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, W, H);
  } else {
    const g = c.createRadialGradient(W * 0.45, H * 0.3, 0, W * 0.45, H * 0.3, W * 0.7);
    g.addColorStop(0, "#2a2c55");
    g.addColorStop(1, "#05060c");
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
  }
  const lines = (text.trim() || "liner").split("\n").slice(0, 3);
  let size = H * 0.3;
  c.font = `800 ${size}px ${font}`;
  const widest = Math.max(...lines.map((l) => c.measureText(l).width || 1));
  size = Math.min((size * (W * 0.8)) / widest, (H * 0.42) / lines.length);
  c.font = `800 ${size}px ${font}`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.letterSpacing = `${Math.round(-size * 0.04)}px`;
  const tg = c.createLinearGradient(0, H * 0.1, 0, H * 0.5);
  tg.addColorStop(0, light ? "#2e2a6e" : "#ffffff");
  tg.addColorStop(1, light ? "#9a94dc" : "#7d79c0");
  c.fillStyle = tg;
  const top = H * 0.27 - (lines.length - 1) * size * 0.48;
  lines.forEach((l, n) => c.fillText(l, W * 0.5, top + n * size * 0.96));
}

/*
  The light look prints like a soft print on white paper (Capy's light Home): white gets no dots,
  so the three night scenes would print as a dense field. Each has a day version instead, in
  pastels with a lot of white sky: the moon at a pale dawn, a pale dusk, and the lights on white.
*/
function paintDawn(c: CanvasRenderingContext2D, W: number, H: number) {
  const m = Math.min(W, H);
  const hz = H * 0.64;
  const g = c.createLinearGradient(0, 0, 0, hz);
  g.addColorStop(0, "#8a93dc");
  g.addColorStop(0.55, "#eeedf9");
  g.addColorStop(1, "#f9e3da");
  c.fillStyle = g;
  c.fillRect(0, 0, W, hz);
  const mx = W * 0.42;
  const my = H * 0.26;
  const r = m * 0.16;
  // A day moon: a white disc in the blue, its seas a pale lilac.
  c.fillStyle = "#fbfaff";
  c.beginPath();
  c.arc(mx, my, r, 0, TAU);
  c.fill();
  c.fillStyle = "#c3bde3";
  for (const [x, y, z] of [[-0.3, -0.1, 0.22], [0.25, 0.2, 0.16], [0.05, -0.42, 0.12], [-0.1, 0.38, 0.1], [0.42, -0.22, 0.09]]) {
    c.beginPath();
    c.arc(mx + x * r, my + y * r, z * r, 0, TAU);
    c.fill();
  }
  c.fillStyle = "rgba(255,255,255,0.85)";
  c.beginPath();
  c.ellipse(mx - r * 0.5, my + r * 0.78, r * 1.9, r * 0.15, -0.04, 0, TAU);
  c.fill();
  c.fillStyle = "#c9c1ea";
  c.beginPath();
  c.ellipse(W * 0.82, H * 0.16, W * 0.2, H * 0.022, 0.03, 0, TAU);
  c.fill();
  const s = c.createLinearGradient(0, hz, 0, H);
  s.addColorStop(0, "#8f9fdb");
  s.addColorStop(1, "#d6def3");
  c.fillStyle = s;
  c.fillRect(0, hz, W, H - hz);
  // The light on the water, white.
  const R = seeded(7);
  for (let k = 0; k < 28; k++) {
    const yy = hz + H * 0.004 + k * H * 0.012 + R() * H * 0.003;
    const len = r * (1.6 - k * 0.045) * (0.5 + R() * 0.6);
    c.fillStyle = `rgba(255,255,255,${Math.max(0, 0.9 - k * 0.03)})`;
    c.fillRect(mx - len / 2 + (R() - 0.5) * r * 0.35, yy, len, H * 0.005);
  }
  c.fillStyle = "#4f4c7c";
  c.beginPath();
  c.moveTo(W, hz + 1);
  for (let xx = W; xx >= W * 0.6; xx -= W / 80) {
    const u = (W - xx) / (W * 0.4);
    c.lineTo(xx, hz - H * 0.07 * Math.sin(u * 3.6) ** 2 * (1 - u));
  }
  c.lineTo(W * 0.6, hz + 1);
  c.fill();
}

function paintDayDusk(c: CanvasRenderingContext2D, W: number, H: number) {
  const g = c.createLinearGradient(0, 0, 0, H * 0.7);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(0.45, "#fde7dc");
  g.addColorStop(1, "#f4b597");
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  const sx = W * 0.4;
  const sy = H * 0.46;
  const sr = Math.min(W, H) * 0.11;
  const sg = c.createRadialGradient(sx, sy, sr * 0.9, sx, sy, sr * 2.6);
  sg.addColorStop(0, "rgba(246,160,120,0.7)");
  sg.addColorStop(1, "rgba(250,190,150,0)");
  c.fillStyle = sg;
  c.fillRect(0, 0, W, H);
  c.fillStyle = "#ffffff";
  c.beginPath();
  c.arc(sx, sy, sr, 0, TAU);
  c.fill();
  const cols = ["#e9b1c6", "#d08eb0", "#ad6e98", "#82537b", "#563d62"];
  for (let L = 0; L < 5; L++) {
    const base = H * (0.44 + L * 0.105);
    c.fillStyle = cols[L];
    c.beginPath();
    c.moveTo(0, H);
    for (let x = 0; x <= W + 1; x += W / 140) {
      const u = x / W;
      c.lineTo(x, base - H * (0.09 - L * 0.008) * (0.6 * Math.sin(u * (5 + L * 1.7) + L * 2.1) + 0.3 * Math.sin(u * (13 + L * 3) + L) + 0.15 * Math.sin(u * 31 + L * 5)));
    }
    c.lineTo(W, H);
    c.fill();
  }
}

function paintDayAurora(c: CanvasRenderingContext2D, W: number, H: number) {
  const R = seeded(3);
  c.fillStyle = "#ffffff";
  c.fillRect(0, 0, W, H);
  c.save();
  c.filter = `blur(${Math.max(2, Math.round(W * 0.016))}px)`;
  const bands: [string, number, number][] = [["#45cc98", 0.3, 0.1], ["#9682ec", 0.2, 0.08], ["#55bfe2", 0.42, 0.05]];
  bands.forEach(([colour, at, width], n) => {
    c.strokeStyle = colour;
    c.globalAlpha = 0.85;
    c.lineWidth = H * width * 2;
    c.beginPath();
    for (let x = -W * 0.1; x <= W * 1.1; x += W / 80) {
      const u = x / W;
      const y = H * at + H * 0.08 * Math.sin(u * 4 + n * 1.3) + H * 0.04 * Math.sin(u * 9 + n);
      if (x === -W * 0.1) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.stroke();
  });
  c.globalAlpha = 0.45;
  for (let k = 0; k < 70; k++) {
    const sx = R() * W;
    const top = H * (0.1 + R() * 0.2);
    const gr = c.createLinearGradient(0, top, 0, top + H * 0.3);
    gr.addColorStop(0, "rgba(70,190,150,0)");
    gr.addColorStop(0.5, "rgba(70,190,150,0.8)");
    gr.addColorStop(1, "rgba(70,190,150,0)");
    c.fillStyle = gr;
    c.fillRect(sx, top, W * 0.006, H * 0.3);
  }
  c.restore();
  c.fillStyle = "#3d4a52";
  c.beginPath();
  c.moveTo(0, H);
  const base = H * 0.84;
  let px = 0;
  while (px < W) {
    const w = W * (0.012 + R() * 0.02);
    const hh = H * (0.05 + R() * 0.13);
    c.lineTo(px, base);
    c.lineTo(px + w / 2, base - hh);
    c.lineTo(px + w, base);
    px += w * 0.8;
  }
  c.lineTo(W, base);
  c.lineTo(W, H);
  c.fill();
}

type Paper = "light" | "dark";
type Scene = { kind: DotSource; words: string; img: ImageBitmap | null; focus: { x: number; y: number }; font: string; paper: Paper };

/** Your picture, cropped to fill the paper round its focus point, with no empty edge. */
function paintPicture(c: CanvasRenderingContext2D, W: number, H: number, img: ImageBitmap, focus: { x: number; y: number }) {
  const s = Math.max(W / img.width, H / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  c.fillStyle = "#000";
  c.fillRect(0, 0, W, H);
  c.drawImage(img, clamp(W / 2 - focus.x * dw, W - dw, 0), clamp(H / 2 - focus.y * dh, H - dh, 0), dw, dh);
}

function paintScene(c: CanvasRenderingContext2D, W: number, H: number, s: Scene) {
  const light = s.paper === "light";
  if (s.kind === "picture" && s.img) return paintPicture(c, W, H, s.img, s.focus);
  if (s.kind === "words") return paintWords(c, W, H, s.words, s.font, light);
  if (s.kind === "ridges") return light ? paintDayDusk(c, W, H) : paintRidges(c, W, H);
  if (s.kind === "aurora") return light ? paintDayAurora(c, W, H) : paintAurora(c, W, H);
  return light ? paintDawn(c, W, H) : paintMoon(c, W, H);
}

/**
  A scene read one cell at a time: each cell's light, and its colour as an index into a few
  hundred. For light paper also how much ink the cell takes (its darkness, or its colour where
  that's stronger), and its colour lifted toward white, a pastel.
*/
type Sample = { cols: number; rows: number; lum: Float32Array; ink: Float32Array; rgb: Uint8ClampedArray; tint: Uint16Array; tints: string[]; pale: string[] };

/** Paints a scene at two pixels a cell and shrinks it to one, so each cell's light is the mean of what's in it. */
function sampleScene(s: Scene, cols: number, rows: number): Sample {
  const a = document.createElement("canvas");
  a.width = cols * 2;
  a.height = rows * 2;
  paintScene(a.getContext("2d")!, a.width, a.height, s);
  const b = document.createElement("canvas");
  b.width = cols;
  b.height = rows;
  const d = b.getContext("2d", { willReadFrequently: true })!;
  d.imageSmoothingEnabled = true;
  d.imageSmoothingQuality = "high";
  d.drawImage(a, 0, 0, cols, rows);
  const px = d.getImageData(0, 0, cols, rows).data;
  const n = cols * rows;
  const lum = new Float32Array(n);
  const ink = new Float32Array(n);
  const rgb = new Uint8ClampedArray(n * 3);
  const tint = new Uint16Array(n);
  const tints: string[] = [];
  const pale: string[] = [];
  const tintOf = new Map<string, number>();
  // A picture of your own: its own darkest to lightest (the 2nd to the 98th of its light) is
  // stretched to the whole range first, so a dark photo isn't faint or a pale one full before
  // Light is touched. The scenes are painted to the range already.
  let lo = 0;
  let span = 1;
  if (s.kind === "picture" && s.img) {
    const hist = new Uint32Array(256);
    for (let q = 0; q < n; q++) hist[Math.round(0.2126 * px[q * 4] + 0.7152 * px[q * 4 + 1] + 0.0722 * px[q * 4 + 2])]++;
    const at = (share: number) => {
      let sum = 0;
      for (let v = 0; v < 256; v++) if ((sum += hist[v]) >= n * share) return v;
      return 255;
    };
    const dark = at(0.02);
    const light = at(0.98);
    // A picture that's nearly one grey all over isn't stretched into noise.
    if (light - dark >= 16) (lo = dark), (span = 255 / (light - dark));
  }
  for (let q = 0; q < n; q++) {
    const r = (px[q * 4] - lo) * span;
    const g = (px[q * 4 + 1] - lo) * span;
    const bl = (px[q * 4 + 2] - lo) * span;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    lum[q] = clamp(l / 255);
    const rr = clamp(r, 0, 255);
    const gg = clamp(g, 0, 255);
    const bb = clamp(bl, 0, 255);
    rgb[q * 3] = rr;
    rgb[q * 3 + 1] = gg;
    rgb[q * 3 + 2] = bb;
    ink[q] = Math.max(1 - lum[q], ((Math.max(rr, gg, bb) - Math.min(rr, gg, bb)) / 255) * 0.85);
    const key = `rgb(${qz(l + (r - l) * 1.4)},${qz(l + (g - l) * 1.4)},${qz(l + (bl - l) * 1.4)})`;
    let t = tintOf.get(key);
    if (t === undefined) {
      tintOf.set(key, (t = tints.push(key) - 1));
      // The same colour a little stronger, then a third of the way to white.
      pale.push(`rgb(${qz(255 - (255 - (l + (r - l) * 1.2)) * 0.66)},${qz(255 - (255 - (l + (g - l) * 1.2)) * 0.66)},${qz(255 - (255 - (l + (bl - l) * 1.2)) * 0.66)})`);
    }
    tint[q] = t;
  }
  return { cols, rows, lum, ink, rgb, tint, tints, pale };
}

/* ---------- Drawing the dots ---------- */

/** How a frame is drawn. `from` and `span`: where the fade under the box starts and how far it runs, as shares of the paper's height. */
type Draw = { cell: number; style: DotStyle; tone: DotTone; ink: string; light: number; fade: number; move: DotMove; paper: Paper; paperRgb: RGB; from: number; span: number; calm: Calm };
/** The heading and the message box on the canvas, in CSS pixels [left, top, right, bottom]: the dots are dimmed there, as the sea is, so what's written over them reads. */
type Calm = [number, number, number, number] | null;
/** How much of the dots shows in the calm zone, as the sea's 0.72 round the box; the light look's dark dots against dark text need it calmer. */
const CALM = { dark: 0.72, light: 0.5 };
/** How far past the heading and the box the calm reaches before the dots are whole again, in CSS pixels. */
const CALM_REACH = 56;
/** The most a dot can be on light paper: the darkest parts print as a strong tint, not a solid field. */
const LIGHT_MOST = 0.85;
/** On light paper the ink a cell takes is raised to this power, so light and middle tones stay mostly paper. */
const LIGHT_GAMMA = 1.1;
type Point = { x: number; y: number } | null;
/** A part of the grid, in cells: [first column, first row, past the last column, past the last row]. */
type Box = [number, number, number, number];

// The working arrays, grown as needed and kept, so a frame allocates only its small table of colour counts.
let K = new Int16Array(0);
let S = new Float32Array(0);
let B = new Int32Array(0);
let order = new Int32Array(0);
const grow = (n: number) => {
  if (K.length >= n) return;
  K = new Int16Array(n);
  S = new Float32Array(n);
  B = new Int32Array(n);
  order = new Int32Array(n);
};

/** Eight inks from shadow to light, and the faint one for the dots too dim to be any of them. */
const palettes = new Map<string, { pal: string[]; faint: string }>();
function paletteOf(o: Draw) {
  const key = `${o.ink}|${o.tone}|${o.paper}`;
  let p = palettes.get(key);
  if (p) return p;
  const light = o.paper === "light";
  const ink = hexRgb(o.ink);
  const pale = mix(ink, [246, 244, 255], 0.72);
  const deep = mix(ink, [8, 8, 20], 0.3);
  const dark = mix(ink, [12, 10, 30], 0.5);
  const pal: string[] = [];
  for (let k = 0; k < 8; k++) {
    const u = k / 7;
    // On light paper the ink and its pastel tints: the palest for the lightest dots, the ink itself (a little deeper) for the darkest.
    if (light) pal.push(o.tone === "ink" ? rgba(ink, 0.32 + 0.5 * u) : rgba(mix(mix(ink, [255, 255, 255], 0.6), mix(ink, [28, 22, 56], 0.25), u)));
    else if (o.tone === "ink") pal.push(rgba(ink, 0.42 + 0.58 * u));
    else pal.push(rgba(mix(deep, pale, u ** 1.5)));
  }
  // Light paper has no faint dots: where the picture is light the paper shows clean.
  const faint = o.tone === "picture" ? "rgba(255,255,255,0.07)" : rgba(light ? dark : ink, 0.22);
  palettes.set(key, (p = { pal, faint }));
  return p;
}

/**
  Draws the cells of a part of the grid as dots: each cell reads the scene's light there and
  becomes one dot, or none. The dots are sorted by colour first and each colour is one path, one
  fill: a few dozen fills a frame rather than one a dot. Squares sit on whole device pixels.
*/
function drawDots(c: CanvasRenderingContext2D, src: Sample, o: Draw, t: number, p: Point, box: Box, dpr: number) {
  const { cols, rows, lum } = src;
  const light = o.paper === "light";
  const [i0, j0, i1, j1] = box;
  const bw = i1 - i0;
  const n = bw * (j1 - j0);
  if (n <= 0) return;
  grow(n);
  const cell = o.cell;
  // On light paper more light is less ink; the fade and the calm zone are laid over the layer afterwards (soften).
  const gain = light ? 1.9 - o.light / 100 : 0.55 + o.light / 100;
  const fa = light ? 0 : o.fade / 100;
  const edge = Math.max(2, 20 / cell);
  const stir = o.move === "stir" && p !== null;
  const pi = stir ? p.x / cell : -1e4;
  const pj = stir ? p.y / cell : -1e4;
  const reach = Math.max(10, 120 / cell);
  const breathe = o.move === "breathe";
  const dither = o.style === "squares";
  const swell = o.style === "round" ? 1.1 : 0.94;
  const picture = o.tone === "picture";
  // Buckets: the eight inks and the faint one, or the picture's colours and the faint one.
  const faintAt = picture ? src.tints.length : 8;
  const counts = new Int32Array(faintAt + 2);
  const most = light ? LIGHT_MOST : 1;
  // The calm zone in cells, and how much shows in it.
  const calm = light ? null : o.calm;
  const cx0 = calm ? calm[0] / cell : 0;
  const cy0 = calm ? calm[1] / cell : 0;
  const cx1 = calm ? calm[2] / cell : 0;
  const cy1 = calm ? calm[3] / cell : 0;
  const calmReach = CALM_REACH / cell;
  const calmBy = CALM[o.paper];
  for (let j = j0; j < j1; j++) {
    const fr = 1 - fa * smooth((j / rows - o.from) / o.span);
    const cdy = calm ? Math.max(cy0 - j - 0.5, 0, j + 0.5 - cy1) : 0;
    const ey = Math.min(1, (j + 0.5) / edge, (rows - j - 0.5) / edge);
    for (let i = i0; i < i1; i++) {
      const q = (j - j0) * bw + (i - i0);
      let si = i;
      let sj = j;
      let boost = 0;
      if (stir) {
        // Round the pointer the picture is drawn a third larger, and a little lighter: a lens.
        const dx = i - pi;
        const dy = j - pj;
        const d2 = dx * dx + dy * dy;
        if (d2 < reach * reach) {
          let f = 1 - Math.sqrt(d2) / reach;
          f = f * f * (3 - 2 * f);
          si = pi + dx * (1 - 0.34 * f);
          sj = pj + dy * (1 - 0.34 * f);
          boost = 0.16 * f;
        }
      }
      const idx = (sj < 0 ? 0 : sj >= rows ? rows - 1 : sj | 0) * cols + (si < 0 ? 0 : si >= cols ? cols - 1 : si | 0);
      const L = light ? src.ink[idx] ** LIGHT_GAMMA : lum[idx];
      let v = ((L * gain - 0.03) * Math.min(ey, (i + 0.5) / edge, (cols - i - 0.5) / edge) + boost) * fr;
      if (breathe) v *= 0.82 + 0.18 * Math.sin(t * 0.9 + i * 0.06 - j * 0.045);
      if (calm && cdy < calmReach) {
        const cdx = Math.max(cx0 - i - 0.5, 0, i + 0.5 - cx1);
        if (cdx < calmReach) v *= calmBy + (1 - calmBy) * smooth(Math.sqrt(cdx * cdx + cdy * cdy) / calmReach);
      }
      if (v <= 0.006) {
        K[q] = -1;
        continue;
      }
      if (v > most) v = most;
      const lv = Math.min(7, (v * 8) | 0);
      let k: number;
      if (dither) {
        k = v > BAYER[((j & 3) << 2) | (i & 3)] ? lv : 8;
        S[q] = cell * 0.64;
      } else {
        const sz = cell * swell * Math.sqrt(v);
        if (sz < cell * 0.24) {
          k = 8;
          S[q] = cell * 0.26;
        } else {
          k = lv;
          S[q] = sz;
        }
      }
      if (k === 8 && light) {
        K[q] = -1;
        continue;
      }
      K[q] = k;
      const bucket = k === 8 ? faintAt : picture ? src.tint[idx] : k;
      B[q] = bucket;
      counts[bucket + 1]++;
    }
  }
  // Each bucket's run in `order`, then the cells put in their runs.
  for (let b = 1; b < counts.length; b++) counts[b] += counts[b - 1];
  const end = counts.slice();
  for (let q = 0; q < n; q++) if (K[q] >= 0) order[end[B[q]]++] = q;
  const { pal, faint } = paletteOf(o);
  const round = o.style === "round";
  const half = cell / 2;
  // On light paper the dots are one layer, a little see-through, as the mosaic is.
  c.globalAlpha = light ? layerOf(o) : 1;
  for (let b = 0; b <= faintAt; b++) {
    const from = counts[b];
    const to = counts[b + 1];
    if (from === to) continue;
    c.beginPath();
    for (let k = from; k < to; k++) {
      const q = order[k];
      const x = (i0 + (q % bw)) * cell + half;
      const y = (j0 + ((q / bw) | 0)) * cell + half;
      const s = S[q];
      if (round) {
        c.moveTo(x + s / 2, y);
        c.arc(x, y, s / 2, 0, TAU);
      } else {
        const sd = Math.max(1, Math.round(s * dpr));
        c.rect(Math.round(x * dpr - sd / 2) / dpr, Math.round(y * dpr - sd / 2) / dpr, sd / dpr, sd / dpr);
      }
    }
    c.fillStyle = b === faintAt ? faint : picture ? (light ? src.pale[b] : src.tints[b]) : pal[b];
    c.fill();
  }
  c.globalAlpha = 1;
}

/*
  The light look prints the picture as a mosaic, as Capy's light Home does: every cell is filled,
  opaque, in an 8×8 ordered dither with four steps of lightness, and the whole layer is laid over
  the paper see-through (60% at the default Light), so white stays white, colours wash toward the
  paper into pastels and black becomes a soft grey. Over it the paper comes back toward the foot,
  as a gradient, and round the heading and the box. A cell's colour is the picture's own hue at
  the stepped lightness, or for the inks a mix from the paper to the ink by how dark the step is.
  Drawn at one pixel a cell into a small canvas and scaled up without smoothing: one image, not a
  path of a hundred thousand squares.
*/
const BAYER8 = (() => {
  // Built up from the 2×2 one, each step four of the last: 4M, 4M + 2, 4M + 3, 4M + 1.
  let m = [[0]];
  while (m.length < 8) m = [...m.map((r) => [...r.map((v) => 4 * v), ...r.map((v) => 4 * v + 2)]), ...m.map((r) => [...r.map((v) => 4 * v + 3), ...r.map((v) => 4 * v + 1)])];
  return Float32Array.from(m.flat(), (v) => (v + 0.5) / 64);
})();
/** How much of the layer shows over light paper: 60% at the default Light, from 12% to all of it. */
const layerOf = (o: Draw) => clamp((0.6 * o.light) / 50, 0.12, 1);
/** The paper coming back over the layer toward the foot (Capy's light stops), as strong as "Fades under the box" says (70%, the default, is all of it). */
const FADE_STOPS: [number, number][] = [[0, 0], [0.3, 0], [0.48, 0.48], [0.66, 0.86], [0.82, 1], [1, 1]];

let tile: HTMLCanvasElement | null = null;
let tileImg: ImageData | null = null;
function drawMosaic(c: CanvasRenderingContext2D, src: Sample, o: Draw, t: number, p: Point, box: Box) {
  const { cols, rows, lum, rgb } = src;
  const [i0, j0, i1, j1] = box;
  const bw = i1 - i0;
  const bh = j1 - j0;
  if (bw <= 0 || bh <= 0) return;
  tile ??= document.createElement("canvas");
  if (tile.width < bw || tile.height < bh) (tile.width = Math.max(tile.width, bw)), (tile.height = Math.max(tile.height, bh));
  const tc = tile.getContext("2d")!;
  // One image a size, kept: the whole grid's on a full draw, a few thousand cells' for a stir.
  const img = tileImg?.width === bw && tileImg.height === bh ? tileImg : (tileImg = tc.createImageData(bw, bh));
  const px = img.data;
  const cell = o.cell;
  const paper = o.paperRgb;
  const ink = hexRgb(o.ink);
  const pale = mix(ink, [255, 255, 255], 0.6);
  const stir = o.move === "stir" && p !== null;
  const pi = stir ? p.x / cell : -1e4;
  const pj = stir ? p.y / cell : -1e4;
  const reach = Math.max(10, 120 / cell);
  const breathe = o.move === "breathe";
  for (let j = j0; j < j1; j++)
    for (let i = i0; i < i1; i++) {
      let si = i;
      let sj = j;
      let deeper = 0;
      if (stir) {
        // The same lens as the dark look's: larger round the pointer, and a little more ink.
        const dx = i - pi;
        const dy = j - pj;
        const d2 = dx * dx + dy * dy;
        if (d2 < reach * reach) {
          let f = 1 - Math.sqrt(d2) / reach;
          f = f * f * (3 - 2 * f);
          si = pi + dx * (1 - 0.34 * f);
          sj = pj + dy * (1 - 0.34 * f);
          deeper = 0.16 * f;
        }
      }
      const idx = (sj < 0 ? 0 : sj >= rows ? rows - 1 : sj | 0) * cols + (si < 0 ? 0 : si >= cols ? cols - 1 : si | 0);
      let L = lum[idx] - deeper;
      if (breathe) L = 1 - (1 - L) * (0.82 + 0.18 * Math.sin(t * 0.9 + i * 0.06 - j * 0.045));
      const q = Math.round(clamp(L + (BAYER8[((j & 7) << 3) | (i & 7)] - 0.5) / 4) * 4) / 4;
      const at = ((j - j0) * bw + (i - i0)) * 4;
      if (o.tone === "picture") {
        // The picture's own hue at the stepped lightness.
        const k = q / Math.max(lum[idx], 0.001) / 255;
        px[at] = rgb[idx * 3] * k * 255;
        px[at + 1] = rgb[idx * 3 + 1] * k * 255;
        px[at + 2] = rgb[idx * 3 + 2] * k * 255;
      } else {
        const dq = 1 - q;
        const col = o.tone === "ink" ? mix(paper, ink, dq) : dq < 0.5 ? mix(paper, pale, dq * 2) : mix(pale, ink, (dq - 0.5) * 2);
        px[at] = col[0];
        px[at + 1] = col[1];
        px[at + 2] = col[2];
      }
      px[at + 3] = 255;
    }
  tc.putImageData(img, 0, 0);
  c.save();
  c.imageSmoothingEnabled = false;
  c.globalAlpha = layerOf(o);
  c.drawImage(tile, 0, 0, bw, bh, i0 * cell, j0 * cell, bw * cell, bh * cell);
  c.restore();
}

/**
  Over light paper: the paper back toward the foot, and round the heading and the box. Worked out
  once a size (a quarter size, it's all soft) and laid over each draw as one image, within `clip`:
  a blur and a gradient each frame cost Breathes half a core at 2 px.
*/
let veil: { key: string; canvas: HTMLCanvasElement } | null = null;
const VEIL_SCALE = 4;
function soften(c: CanvasRenderingContext2D, o: Draw, W: number, H: number, clip: [number, number, number, number]) {
  const strength = Math.min(1, o.fade / 70);
  if (strength <= 0 && !o.calm) return;
  const key = `${W}|${H}|${strength}|${o.calm?.map(Math.round).join(",")}`;
  if (veil?.key !== key) {
    const canvas = veil?.canvas ?? document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(W / VEIL_SCALE));
    canvas.height = Math.max(1, Math.ceil(H / VEIL_SCALE));
    const v = canvas.getContext("2d")!;
    v.scale(1 / VEIL_SCALE, 1 / VEIL_SCALE);
    if (strength > 0) {
      const g = v.createLinearGradient(0, 0, 0, H);
      for (const [at, a] of FADE_STOPS) g.addColorStop(at, `rgba(0,0,0,${a * strength})`);
      v.fillStyle = g;
      v.fillRect(0, 0, W, H);
    }
    if (o.calm) {
      const [x0, y0, x1, y1] = o.calm;
      const r = CALM_REACH;
      v.filter = `blur(${r / 2.5 / VEIL_SCALE}px)`;
      v.fillStyle = `rgba(0,0,0,${1 - CALM.light})`;
      v.fillRect(x0 - r / 4, y0 - r / 4, x1 - x0 + r / 2, y1 - y0 + r / 2);
    }
    veil = { key, canvas };
  }
  c.save();
  c.beginPath();
  c.rect(clip[0], clip[1], clip[2] - clip[0], clip[3] - clip[1]);
  c.clip();
  c.globalCompositeOperation = "destination-out";
  c.imageSmoothingEnabled = true;
  c.drawImage(veil.canvas, 0, 0, W, H);
  c.restore();
}

/** One part of the grid: the dark look's dots as built, or on light paper the mosaic (Squares) or dots, then the paper over them. */
function paint(c: CanvasRenderingContext2D, src: Sample, o: Draw, t: number, p: Point, box: Box, dpr: number) {
  if (o.paper !== "light") return drawDots(c, src, o, t, p, box, dpr);
  if (o.style === "squares") drawMosaic(c, src, o, t, p, box);
  else drawDots(c, src, o, t, p, box, dpr);
  soften(c, o, src.cols * o.cell, src.rows * o.cell, [box[0] * o.cell, box[1] * o.cell, box[2] * o.cell, box[3] * o.cell]);
}

/** Whether the paper behind an element is light: its CSS colour (`color: var(--lc-paper)` in dots.css), read back from one pixel. */
let probe: CanvasRenderingContext2D | null = null;
function readPaper(el: Element): { paper: Paper; rgb: RGB } {
  probe ??= Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", { willReadFrequently: true });
  const theme: Paper = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  const guess = { paper: theme, rgb: (theme === "dark" ? [20, 20, 22] : [255, 255, 255]) as RGB };
  if (!probe) return guess;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "#000";
  probe.fillStyle = getComputedStyle(el).color;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  // A see-through paper (the desktop behind the window) can't say: the theme does.
  if (a < 200) return guess;
  return { paper: 0.2126 * r + 0.7152 * g + 0.0722 * b > 140 ? "light" : "dark", rgb: [r, g, b] };
}

const reduced = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
/** What a look moves as here: Reduce motion holds it still. */
const moveOf = (d: DotLook): DotMove => (reduced?.matches ? "still" : d.move);
/** What a look draws: your picture once it's there, the moon until then. */
const kindOf = (d: DotLook, img: ImageBitmap | null): DotSource => (d.source === "picture" && !img ? "moon" : d.source);

/* ---------- The picture ---------- */

let held: { pic: number; at: Promise<ImageBitmap | null> } | null = null;
/** The saved picture, fetched once per `pic` and kept decoded for the life of the page; a fetch that fails rejects, isn't kept, and is asked again. */
function pictureOf(pic: number) {
  if (held?.pic === pic) return held.at;
  const old = held;
  const at = rpc("wallpaper.image", {})
    .then((r) => (r ? createImageBitmap(new Blob([Uint8Array.from(atob(r.data), (ch) => ch.charCodeAt(0))], { type: r.type })) : null))
    .catch((e: unknown) => {
      if (held?.at === at) held = null;
      throw e;
    });
  held = { pic, at };
  // The one it replaces is never drawn again. One that failed has nothing to close, and its failure was the caller's to hear.
  void old?.at.then((b) => b?.close(), () => {});
  return at;
}

/** The saved picture, once it's decoded, while `want` holds. */
function usePicture(pic: number, want: boolean) {
  const [img, setImg] = useState<{ pic: number; bm: ImageBitmap | null } | null>(null);
  // A fetch that failed (the engine restarting) is tried again a few seconds on, and when the window comes back to the front.
  const [again, setAgain] = useState(0);
  useEffect(() => {
    if (!want) return;
    let live = true;
    let timer = 0;
    const retry = () => live && setAgain((n) => n + 1);
    pictureOf(pic).then(
      (bm) => live && setImg({ pic, bm }),
      () => {
        if (!live) return;
        timer = window.setTimeout(retry, 5000);
        window.addEventListener("focus", retry, { once: true });
      },
    );
    return () => {
      live = false;
      clearTimeout(timer);
      window.removeEventListener("focus", retry);
    };
  }, [pic, want, again]);
  return want && img?.pic === pic ? img.bm : null;
}

/* ---------- The canvas behind Home ---------- */

function run(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")!;
  const home = canvas.parentElement!;
  let W = 0;
  let H = 0;
  let dpr = 1;
  let d: DotLook | null = null;
  let img: ImageBitmap | null = null;
  let paper: Paper = "dark";
  let paperRgb: RGB = [20, 20, 22];
  let src: Sample | null = null;
  let srcKey = "";
  let o: Draw | null = null;
  let wantKey = "";
  let boxTop = -1;
  let boxBottom = -1;
  let calm: Calm = null;
  let font = "sans-serif";
  let fontAsked = "";
  let pointer: Point = null;
  let drawn: Point = null;
  let timer = 0;
  let raf = 0;
  let last = 0;
  const t0 = performance.now();
  // Gone from the page: a font that loads late doesn't draw on a canvas no one holds.
  let stopped = false;

  /** The message box's top on the canvas, or -1 when Home has none (no project yet); and the calm zone round the heading and the box. */
  const measureBox = () => {
    const at = canvas.getBoundingClientRect();
    const box = home.querySelector(".lc-home-compose")?.getBoundingClientRect();
    let zone: Calm = null;
    for (const el of home.querySelectorAll(".lc-home-top, .lc-ask-h, .lc-home-compose, .lc-noproj")) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const z: [number, number, number, number] = [r.left - at.left, r.top - at.top, r.right - at.left, r.bottom - at.top];
      zone = zone ? [Math.min(zone[0], z[0]), Math.min(zone[1], z[1]), Math.max(zone[2], z[2]), Math.max(zone[3], z[3])] : z;
    }
    calm = zone;
    boxBottom = box && box.height ? box.bottom - at.top : -1;
    return box && box.height ? box.top - at.top : -1;
  };
  const resize = () => {
    const r = canvas.getBoundingClientRect();
    W = r.width;
    H = r.height;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
  };
  /** The scene sampled for this size, and how to draw it; false while there's nothing to draw on. */
  const prepare = () => {
    if (!d || W < 1 || H < 1) return false;
    const cols = Math.ceil(W / d.cell);
    const rows = Math.ceil(H / d.cell);
    const kind = kindOf(d, img);
    if (kind === "words" && fontAsked !== font) {
      // The heavy weight may not be loaded yet, and a canvas doesn't ask for it: once it's in, the words are set again.
      fontAsked = font;
      void document.fonts?.load(`800 40px ${font}`).then(() => stopped || ((srcKey = ""), redraw()));
    }
    const key = [kind, paper, kind === "words" ? d.words : "", kind === "picture" ? `${d.pic}|${d.focus.x}|${d.focus.y}` : "", cols, rows, kind === "words" ? font : ""].join("|");
    if (key !== srcKey || !src) {
      src = sampleScene({ kind, words: d.words, img, focus: d.focus, font, paper }, cols, rows);
      srcKey = key;
    }
    // In the dark the fade runs from the box's top to past the foot; on light paper from the box's foot to clean paper at 80% of the height.
    let from = boxTop > 0 ? clamp(boxTop / H, 0.1, 0.95) : 0.5;
    let span = Math.max(0.08, (1 - from) * 0.84);
    if (paper === "light") {
      from = boxBottom > 0 ? clamp(boxBottom / H, 0.1, 0.75) : 0.55;
      span = Math.max(0.05, 0.8 - from);
    }
    o = { cell: d.cell, style: d.style, tone: d.tone, ink: d.ink, light: d.light, fade: d.fade, move: moveOf(d), paper, paperRgb, from, span, calm };
    return true;
  };
  const now = () => (performance.now() - t0) / 1000;
  /** The whole paper. */
  const redraw = () => {
    if (!prepare() || !src || !o) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    paint(ctx, src, o, now(), pointer, [0, 0, src.cols, src.rows], dpr);
    drawn = pointer;
  };
  /** Only the cells round where the pointer was and is: a stir moves nothing else. */
  const restir = () => {
    if (!prepare() || !src || !o) return;
    const { cols, rows } = src;
    const cell = o.cell;
    const reach = Math.max(10, 120 / cell) + 1;
    let box: Box | null = null;
    for (const p of [drawn, pointer]) {
      if (!p) continue;
      const b: Box = [Math.floor(p.x / cell - reach), Math.floor(p.y / cell - reach), Math.ceil(p.x / cell + reach), Math.ceil(p.y / cell + reach)];
      box = box ? [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])] : b;
    }
    drawn = pointer;
    if (!box) return;
    const [i0, j0, i1, j1] = [Math.max(0, box[0]), Math.max(0, box[1]), Math.min(cols, box[2]), Math.min(rows, box[3])];
    if (i1 <= i0 || j1 <= j0) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(i0 * cell, j0 * cell, (i1 - i0) * cell, (j1 - j0) * cell);
    ctx.clip();
    ctx.clearRect(i0 * cell, j0 * cell, (i1 - i0) * cell, (j1 - j0) * cell);
    // A cell more all round, clipped: the round dots reach a little past their cells.
    paint(ctx, src, o, now(), pointer, [Math.max(0, i0 - 1), Math.max(0, j0 - 1), Math.min(cols, i1 + 1), Math.min(rows, j1 + 1)], dpr);
    ctx.restore();
  };

  // Between frames it sleeps on a timer rather than waking every display refresh only to skip it.
  const frame = (at: number) => {
    raf = 0;
    last = at;
    if (!d) return;
    const move = moveOf(d);
    if (move === "breathe") {
      redraw();
      kick();
    } else if (move === "stir" && (drawn?.x !== pointer?.x || drawn?.y !== pointer?.y)) restir();
  };
  const kick = () => {
    if (timer || raf || document.hidden || !d || moveOf(d) === "still") return;
    const gap = document.hasFocus() ? FRAME_MS.here : FRAME_MS.away;
    timer = window.setTimeout(
      () => {
        timer = 0;
        raf = requestAnimationFrame(frame);
      },
      Math.max(0, gap - (performance.now() - last)),
    );
  };
  const pause = () => {
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    raf = 0;
    timer = 0;
  };
  const onVisible = () => (document.hidden ? pause() : kick());
  const onMove = (e: PointerEvent) => {
    if (!d || d.move !== "stir") return;
    const r = canvas.getBoundingClientRect();
    pointer = onWater(e.target) ? { x: e.clientX - r.left, y: e.clientY - r.top } : null;
    kick();
  };
  const onLeave = () => {
    pointer = null;
    kick();
  };
  const ro = new ResizeObserver(() => {
    resize();
    boxTop = measureBox();
    redraw();
  });
  ro.observe(canvas);
  // The box grows with what's typed in it, and moves when the headline over it wraps: looked at once a second, not each frame.
  const watch = window.setInterval(() => {
    if (document.hidden || !d) return;
    const was = calm;
    const top = measureBox();
    const moved = !was !== !calm || (was && calm && was.some((v, k) => Math.abs(v - calm![k]) > d!.cell));
    if (Math.abs(top - boxTop) > d.cell || moved) {
      boxTop = top;
      redraw();
    }
  }, 1000);
  const onMotion = () => (redraw(), kick());
  reduced?.addEventListener("change", onMotion);
  document.addEventListener("visibilitychange", onVisible);
  home.addEventListener("pointermove", onMove);
  home.addEventListener("pointerleave", onLeave);
  void document.fonts?.ready.then(() => stopped || ((srcKey = ""), redraw()));
  resize();

  return {
    /** A look to draw: does nothing if nothing it draws by changed. */
    set(next: DotLook, bm: ImageBitmap | null) {
      ({ paper, rgb: paperRgb } = readPaper(canvas));
      font = getComputedStyle(canvas).fontFamily || font;
      const key = JSON.stringify([next, paper, font, moveOf(next)]);
      if (key === wantKey && bm === img) return;
      wantKey = key;
      d = next;
      img = bm;
      if (next.move !== "stir") pointer = null;
      if (boxTop < 0) boxTop = measureBox();
      redraw();
      if (moveOf(next) === "still") pause();
      else kick();
    },
    stop() {
      stopped = true;
      pause();
      ro.disconnect();
      clearInterval(watch);
      reduced?.removeEventListener("change", onMotion);
      document.removeEventListener("visibilitychange", onVisible);
      home.removeEventListener("pointermove", onMove);
      home.removeEventListener("pointerleave", onLeave);
    },
  };
}

/** Your dots, filling Home's paper behind everything on it. */
export function Dots({ look }: { look: Look }) {
  const theme = darkNow() ? "dark" : "light";
  const d = dotsOf(look, theme);
  const ref = useRef<HTMLCanvasElement>(null);
  const dots = useRef<ReturnType<typeof run> | null>(null);
  const img = usePicture(d.pic, d.source === "picture");
  useEffect(() => {
    dots.current = run(ref.current!);
    return () => {
      dots.current?.stop();
      dots.current = null;
    };
  }, []);
  // Handed over when the dots, the picture or the theme change (a new theme changes the paper, not
  // the dots), not on every render of Home: reading the paper's colour isn't free.
  const key = JSON.stringify(d);
  useEffect(() => dots.current?.set(JSON.parse(key) as DotLook, img), [key, img, theme, look.custom, look.accent]);
  return <canvas ref={ref} className="lc-sea lc-dots" aria-hidden />;
}

/* ---------- Opening the panel ---------- */

let wanted = false;
/** Opens Behind Home, going to Home first when it's asked for elsewhere (Settings, Appearance: App.tsx goes Home). */
export function openBehindHome() {
  wanted = true;
  window.dispatchEvent(new Event("lc:behind-home"));
}
/** Whether Behind Home is open on this Home: asked for before Home was here, it opens as Home comes. */
export function useBehindHome() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => ((wanted = false), setOpen(true));
    if (wanted) on();
    window.addEventListener("lc:behind-home", on);
    return () => window.removeEventListener("lc:behind-home", on);
  }, []);
  return [open, setOpen] as const;
}

/** The dots' small card on Home, as the sea has: what's there, Change, Settings, and × to close it for good. */
export function DotsHello({ onChange }: { onChange: () => void }) {
  const [shown, setShown] = useState(() => {
    try {
      return localStorage.getItem(HELLO_KEY) !== "1";
    } catch {
      return false;
    }
  });
  if (!shown) return null;
  const seen = () => {
    setShown(false);
    try {
      localStorage.setItem(HELLO_KEY, "1");
    } catch {
      // storage is off: it shows again next time
    }
  };
  return (
    <div className="lc-sea-hello" role="status">
      <span className="lc-sea-hello-mark" aria-hidden />
      <span className="lc-sea-hello-words">Your dots</span>
      <button type="button" className="lc-sea-hello-act" onClick={onChange}>
        Change
      </button>
      <button type="button" className="lc-sea-hello-act" onClick={() => window.dispatchEvent(new CustomEvent("lc:open-settings", { detail: "appearance" }))}>
        Settings
      </button>
      <button type="button" className="lc-sea-hello-x" aria-label="Close this for good, and keep the dots" title="Close" onClick={seen}>
        <I.close size={12} />
      </button>
    </div>
  );
}

/* ---------- The panel ---------- */

/** A thumbnail: one scene as dots, in the look's own style, tone and ink. */
function Thumb({ kind, d, img, label, on, onPick }: { kind: DotSource; d: DotLook; img: ImageBitmap | null; label: string; on: boolean; onPick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !cv.offsetWidth) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(cv.offsetWidth * dpr);
    cv.height = Math.round(cv.offsetHeight * dpr);
    const c = cv.getContext("2d")!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { paper, rgb: paperRgb } = readPaper(cv);
    const src = sampleScene({ kind, words: d.words, img, focus: d.focus, font: getComputedStyle(cv).fontFamily, paper }, Math.ceil(cv.offsetWidth / THUMB_CELL), Math.ceil(cv.offsetHeight / THUMB_CELL));
    paint(c, src, { cell: THUMB_CELL, style: d.style, tone: d.tone, ink: d.ink, light: d.light, fade: 0, move: "still", paper, paperRgb, from: 1, span: 1, calm: null }, 0, null, [0, 0, src.cols, src.rows], dpr);
    // The theme is read at each render, so a new one draws them again on the new paper.
  }, [kind, d.style, d.tone, d.ink, d.light, d.focus.x, d.focus.y, img, document.documentElement.dataset.theme]);
  return (
    <button type="button" className="lc-bh-thumb l-focus" aria-pressed={on} data-on={on || undefined} onClick={onPick}>
      <canvas ref={ref} aria-hidden />
      <span>{label}</span>
    </button>
  );
}

/** Your picture, small, with the part that fills Home framed: drag the point (or use the arrow keys) to choose what stays in view. */
function Focus({ img, focus, onFocus }: { img: ImageBitmap; focus: { x: number; y: number }; onFocus: (f: { x: number; y: number }) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  // Home's shape, for the frame: the paper this panel sits on.
  const [shape, setShape] = useState(16 / 10);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    setWidth(el.parentElement?.clientWidth ?? 300);
    const paper = el.closest(".lc-home")?.getBoundingClientRect();
    if (paper && paper.height) setShape(paper.width / paper.height);
  }, []);
  const a = img.width / img.height;
  const w = Math.max(1, Math.min(width, 150 * a));
  const h = w / a;
  useEffect(() => {
    const cv = ref.current;
    if (!cv || w < 2) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    const c = cv.getContext("2d")!;
    c.imageSmoothingQuality = "high";
    c.drawImage(img, 0, 0, cv.width, cv.height);
  }, [img, w, h]);
  // The share of the picture that shows: all of one side, part of the other (a cover fit).
  const fw = a > shape ? shape / a : 1;
  const fh = a > shape ? 1 : a / shape;
  const left = clamp(focus.x - fw / 2, 0, 1 - fw);
  const top = clamp(focus.y - fh / 2, 0, 1 - fh);
  const drag = useRef(false);
  const at = (e: ReactPointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    onFocus({ x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) });
  };
  const keys = (e: ReactKeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    const by: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const m = by[e.key];
    if (!m) return;
    e.preventDefault();
    onFocus({ x: clamp(focus.x + m[0]), y: clamp(focus.y + m[1]) });
  };
  return (
    <div className="lc-bh-focus">
      <div
        ref={wrap}
        className="lc-bh-focus-pic l-focus"
        style={{ width: w, height: h }}
        tabIndex={0}
        role="slider"
        aria-label="What stays in view"
        aria-valuetext={`${Math.round(focus.x * 100)}% across, ${Math.round(focus.y * 100)}% down`}
        onKeyDown={keys}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          drag.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          at(e);
        }}
        onPointerMove={(e) => drag.current && at(e)}
        onPointerUp={() => (drag.current = false)}
        onPointerCancel={() => (drag.current = false)}
      >
        <canvas ref={ref} aria-hidden />
        <span className="lc-bh-focus-frame" style={{ left: `${left * 100}%`, top: `${top * 100}%`, width: `${fw * 100}%`, height: `${fh * 100}%` }} aria-hidden />
        <span className="lc-bh-focus-dot" style={{ left: `${focus.x * 100}%`, top: `${focus.y * 100}%` }} aria-hidden />
      </div>
      <p className="lc-bh-sub">Drag the point to choose what stays in view.</p>
    </div>
  );
}

/** A labelled part of the panel. */
function Part({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="lc-bh-part">
      {title && <h3>{title}</h3>}
      {children}
    </section>
  );
}

const SAMPLES: { kind: DotSource; label: string }[] = [
  { kind: "moon", label: "Moon" },
  { kind: "ridges", label: "Dusk" },
  { kind: "aurora", label: "Aurora" },
];
const MOVE_NOTES: Record<DotMove, string> = {
  still: "Drawn once and kept. Costs nothing after.",
  breathe: "The light swells slowly across it, 15 times a second.",
  stir: "Move over the paper: the dots swell round the pointer.",
};
const PICTURE_TYPES = "image/jpeg,image/png,image/heic,image/heif,image/tiff,image/gif,image/webp";
type From = "picture" | "words" | "ask";
type Info = { picture: boolean; models: { id: string; name: string }[] };

/*
  The one picture being drawn, if any, and what was last kept: here rather than in the panel, so
  a panel closed and opened again while a picture is on its way says "Drawing…" and can't send a
  second one (each is billed; the engine refuses a second too).
*/
let drawing = false;
let drewWith = "";
let pictureName = "";
const drawWatchers = new Set<() => void>();
const drawNews = () => drawWatchers.forEach((f) => f());
function useDrawing() {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    drawWatchers.add(f);
    return () => void drawWatchers.delete(f);
  }, []);
  return { asking: drawing, drew: drewWith, name: pictureName };
}
function drawPicture(prompt: string, model: string) {
  if (drawing) return;
  drawing = true;
  drewWith = "";
  drawNews();
  void rpc("wallpaper.draw", { prompt, model })
    .then((r) => {
      drewWith = r.model;
      pictureName = `“${prompt.split("\n")[0]}”`;
      updateDots({ source: "picture", pic: dotsOf(readLook()).pic + 1, focus: { x: 0.5, y: 0.5 } });
    })
    .catch((e: unknown) => toast.error("Couldn't draw it", { description: e instanceof Error ? e.message : String(e) }))
    .finally(() => {
      drawing = false;
      drawNews();
    });
}

const SHOWS_IN: { value: HomeIn; label: string }[] = [
  { value: "both", label: "Both looks" },
  { value: "dark", label: "Dark only" },
  { value: "light", label: "Light only" },
];

/** Behind Home: what's behind Home, and how your dots are made and drawn. Over Home on the right, so you see each change as you make it. */
export function BehindHome({ look, onClose }: { look: Look; onClose: () => void }) {
  const d = dotsOf(look, darkNow() ? "dark" : "light");
  const home = homeOf(look);
  const shownIn = homeInOf(look);
  const hidden = home !== "none" && homeShown(look) === "none";
  const [from, setFrom] = useState<From>(d.source === "words" ? "words" : "picture");
  // The picture or scene last picked, so Picture after Words goes back to it.
  const lastPic = useRef<DotSource>(d.source === "words" ? "moon" : d.source);
  const [info, setInfo] = useState<Info | null>(null);
  const [asked, setAsked] = useState(0);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const { asking, drew, name: drawnName } = useDrawing();
  const [name, setNameHere] = useState(drawnName);
  const setName = (n: string) => ((pictureName = n), setNameHere(n));
  const [model, setModel] = useState("");
  // A drawing that finished while the panel was open: the picture is there now, and Yours with it.
  const wasAsking = useRef(asking);
  useEffect(() => {
    if (wasAsking.current && !asking) (setAsked((n) => n + 1), setNameHere(pictureName));
    wasAsking.current = asking;
  }, [asking]);
  // Size, light, fade and the focus point while they're dragged: shown at once, and the look written once a frame at most.
  const [draft, setDraft] = useState<Partial<DotLook>>({});
  const pending = useRef<Partial<DotLook>>({});
  const frame = useRef(0);
  const panel = useRef<HTMLElement>(null);
  const hasPicture = info?.picture === true;
  const img = usePicture(d.pic, hasPicture || d.source === "picture");

  useEffect(() => {
    let live = true;
    void rpc("wallpaper.info", {})
      .then((r) => live && setInfo(r))
      .catch(() => live && setInfo({ picture: false, models: [] }));
    return () => void (live = false);
  }, [asked]);
  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
    return () => cancelAnimationFrame(frame.current);
  }, []);

  const set = (patch: Partial<DotLook>) => updateDots(patch);
  const soon = (patch: Partial<DotLook>) => {
    pending.current = { ...pending.current, ...patch };
    setDraft(pending.current);
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const p = pending.current;
      pending.current = {};
      updateDots(p);
      setDraft({});
    });
  };
  const v = { ...d, ...draft };
  const behind = (h: Behind) => updateLook({ home: h });
  const pick = (kind: DotSource) => {
    lastPic.current = kind;
    set({ source: kind });
  };
  const choose = (f: From) => {
    setFrom(f);
    if (f === "words") set({ source: "words" });
    else if (f === "picture") set({ source: lastPic.current });
  };

  /** Your own picture: kept by the engine as the dots' picture, then drawn. */
  const save = (file: File) => {
    if (busy) return;
    if (!file.type.startsWith("image/") && !/\.(heic|heif|tiff?)$/i.test(file.name)) return void toast.error("That isn't a picture", { description: file.name || undefined });
    setBusy(true);
    const r = new FileReader();
    r.onload = () => {
      const data = String(r.result).split(",")[1] ?? "";
      const called = file.name || "Pasted picture";
      void rpc("wallpaper.save", { data, name: called })
        .then(() => {
          setName(called);
          lastPic.current = "picture";
          setFrom("picture");
          // A new picture starts with its middle in view.
          updateDots({ source: "picture", pic: dotsOf(readLook()).pic + 1, focus: { x: 0.5, y: 0.5 } });
          setAsked((n) => n + 1);
        })
        .catch((e: unknown) => toast.error("Couldn't keep that picture", { description: e instanceof Error ? e.message : String(e) }))
        .finally(() => setBusy(false));
    };
    r.onerror = () => (setBusy(false), toast.error("Liner Code couldn't read that file."));
    r.readAsDataURL(file);
  };
  const remove = () =>
    void rpc("wallpaper.remove", {})
      .then(() => {
        setName("");
        lastPic.current = "moon";
        updateDots({ source: d.source === "picture" ? "moon" : d.source, pic: dotsOf(readLook()).pic + 1 });
        setAsked((n) => n + 1);
      })
      .catch((e: unknown) => toast.error("Couldn't remove your picture", { description: e instanceof Error ? e.message : String(e) }));
  const saveRef = useRef(save);
  saveRef.current = save;
  // A picture pasted anywhere while the panel is open; text pastes as ever. One pasted into the
  // message box or another field outside the panel is that field's, not a new wallpaper.
  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      if (e.defaultPrevented) return;
      const at = e.target instanceof Element ? e.target : null;
      if (at && !at.closest(".lc-bh") && at.closest("input, textarea, [contenteditable]:not([contenteditable='false'])")) return;
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.kind === "file" && i.type.startsWith("image/"));
      const file = item?.getAsFile();
      if (!file) return;
      e.preventDefault();
      saveRef.current(file);
    };
    document.addEventListener("paste", paste);
    return () => document.removeEventListener("paste", paste);
  }, []);

  const models = info?.models ?? [];
  const drawWith = models.find((m) => m.id === model) ?? models[0];
  const draw = () => {
    const prompt = d.prompt.trim();
    if (asking || !drawWith) return;
    if (!prompt) return void toast.error("Say what to draw first");
    lastPic.current = "picture";
    drawPicture(prompt, drawWith.id);
  };

  const thumbs: { kind: DotSource; label: string }[] = hasPicture ? [{ kind: "picture", label: "Yours" }, ...SAMPLES] : SAMPLES;
  const drop = (
    <label
      className="lc-bh-drop l-focus-within"
      data-drag={drag || undefined}
      data-busy={busy || undefined}
      onDragOver={(e) => (e.preventDefault(), !drag && setDrag(true))}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer?.files?.[0];
        if (f) save(f);
      }}
    >
      <input type="file" accept={PICTURE_TYPES} aria-label="Choose a picture" onChange={(e) => (e.target.files?.[0] && save(e.target.files[0]), (e.target.value = ""))} />
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 15V4M7 9l5-5 5 5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
      </svg>
      <span className="lc-bh-drop-t">{busy ? <span className="l-shimmer">Keeping it…</span> : name || "Drop a picture here"}</span>
      <span className="lc-bh-sub">or paste one, or click to choose</span>
    </label>
  );

  return (
    <section ref={panel} className="lc-bh" aria-label="Behind Home" tabIndex={-1} onKeyDown={(e) => e.key === "Escape" && !e.defaultPrevented && (e.stopPropagation(), onClose())}>
      <header className="lc-bh-head">
        <span>
          <h2>Behind Home</h2>
          <p className="lc-bh-sub">Anything you give it, drawn in dots.</p>
        </span>
        <button type="button" className="lc-bh-x l-focus" aria-label="Close" title="Close" onClick={onClose}>
          <I.close size={14} />
        </button>
      </header>
      <div className="lc-bh-body">
        {hidden && <p className="lc-bh-hidden">Hidden in the {darkNow() ? "dark" : "light"} look. Advanced › Shows in.</p>}
        <Segmented
          size="sm"
          full
          value={home}
          onValueChange={behind}
          options={[
            { value: "none", label: "Nothing" },
            { value: "sea", label: "The sea" },
            { value: "dots", label: "Your dots" },
          ]}
          aria-label="Behind Home"
        />
        {home === "sea" && <p className="lc-bh-sub">The whale swims here, drawn in fine dots.</p>}
        {home === "none" && <p className="lc-bh-sub">Plain paper.</p>}
        {home === "dots" && (
          <>
            <Part title="From">
              <Segmented
                size="sm"
                full
                value={from}
                onValueChange={choose}
                options={[
                  { value: "picture", label: "Picture" },
                  { value: "words", label: "Words" },
                  { value: "ask", label: "Ask" },
                ]}
                aria-label="From"
              />
              {from === "picture" && (
                <>
                  {drop}
                  <div className="lc-bh-thumbs">
                    {thumbs.map((t) => (
                      <Thumb key={t.kind} kind={t.kind} d={d} img={t.kind === "picture" ? img : null} label={t.label} on={d.source === t.kind} onPick={() => pick(t.kind)} />
                    ))}
                  </div>
                  {d.source === "picture" && img && (
                    <>
                      <Focus img={img} focus={v.focus} onFocus={(focus) => soon({ focus })} />
                      <button type="button" className="lc-linkbtn l-focus lc-bh-remove" onClick={remove}>
                        Remove your picture
                      </button>
                    </>
                  )}
                </>
              )}
              {from === "words" && (
                <>
                  <textarea className="lc-bh-ta" rows={3} aria-label="Words to draw" value={d.words} onChange={(e) => set({ words: e.target.value.split("\n").slice(0, 3).join("\n") })} />
                  <p className="lc-bh-sub">Up to three lines, set heavy and large.</p>
                </>
              )}
              {from === "ask" &&
                (info && !models.length ? (
                  <p className="lc-bh-sub">
                    To have one drawn, add an AI pictures model in{" "}
                    <button type="button" className="lc-linkbtn l-focus" onClick={() => window.dispatchEvent(new CustomEvent("lc:open-settings", { detail: "models" }))}>
                      Settings › Agent tools
                    </button>
                    .
                  </p>
                ) : (
                  info && (
                    <>
                      <textarea className="lc-bh-ta" rows={3} aria-label="What to draw" placeholder="Northern lights over a pine forest" value={d.prompt} onChange={(e) => set({ prompt: e.target.value })} />
                      {models.length > 1 && <Select label="Model" options={models.map((m) => ({ value: m.id, label: m.name }))} value={drawWith?.id} onValueChange={setModel} />}
                      <div className="lc-bh-row">
                        <button type="button" className="lc-btn" data-size="sm" data-kind="secondary" disabled={asking || !d.prompt.trim()} onClick={draw}>
                          {asking ? <span className="l-shimmer">Drawing…</span> : "Draw it"}
                        </button>
                        {drew && !asking && <p className="lc-bh-sub">Drew it with {drew}</p>}
                      </div>
                      <p className="lc-bh-sub">Your words go to {drawWith?.name ?? "your AI pictures model"}, which may charge for one picture. Then it's a picture like any other.</p>
                    </>
                  )
                ))}
            </Part>
            <Part title="Dots">
              <Segmented
                size="sm"
                full
                value={d.style}
                onValueChange={(style) => set({ style })}
                options={[
                  { value: "squares", label: "Squares" },
                  { value: "halftone", label: "Halftone" },
                  { value: "round", label: "Round" },
                ]}
                aria-label="Dots"
              />
              <Slider label="Size" min={2} max={12} step={1} unit=" px" marks={false} value={v.cell} onValueChange={(cell) => soon({ cell })} />
            </Part>
            <Part title="Colour">
              <Segmented
                size="sm"
                full
                value={d.tone}
                onValueChange={(tone) => set({ tone })}
                options={[
                  { value: "duo", label: "Two inks" },
                  { value: "ink", label: "One ink" },
                  { value: "picture", label: "Picture's own" },
                ]}
                aria-label="Colour"
              />
              {d.tone !== "picture" && (
                <span className="lc-swatches" role="radiogroup" aria-label="Ink">
                  {DOT_INKS.map((k) => (
                    <button key={k.color} type="button" role="radio" aria-checked={d.ink === k.color} aria-label={k.name} title={k.name} className="lc-swatch l-focus" data-on={d.ink === k.color || undefined} style={{ background: k.color }} onClick={() => set({ ink: k.color })} />
                  ))}
                </span>
              )}
            </Part>
            <Part>
              <Slider label="Light" min={0} max={100} step={5} unit="%" marks={false} value={v.light} onValueChange={(light) => soon({ light })} />
              <Slider label="Fades under the box" min={0} max={100} step={5} unit="%" marks={false} value={v.fade} onValueChange={(fade) => soon({ fade })} />
            </Part>
            <Part title="Moves">
              <Segmented
                size="sm"
                full
                value={d.move}
                onValueChange={(move) => set({ move })}
                options={[
                  { value: "still", label: "Still" },
                  { value: "breathe", label: "Breathes" },
                  { value: "stir", label: "Stirs" },
                ]}
                aria-label="Moves"
              />
              <p className="lc-bh-sub">{reduced?.matches && d.move !== "still" ? "Reduce motion is on, so it stays still." : MOVE_NOTES[d.move]}</p>
            </Part>
          </>
        )}
        {home !== "none" && (
          <details className="lc-bh-adv" open={hidden || shownIn !== "both" || undefined}>
            <summary>Advanced</summary>
            <Part title="Shows in">
              <Segmented size="sm" full value={shownIn} onValueChange={(homeIn) => updateLook({ homeIn })} options={SHOWS_IN} aria-label="Shows in" />
              <p className="lc-bh-sub">In the other look Home is plain paper, and nothing is drawn.</p>
            </Part>
          </details>
        )}
      </div>
      <footer className="lc-bh-foot">
        <p className="lc-bh-sub">{home === "dots" && from === "ask" ? "Kept on this Mac. Only Draw it sends your words." : "Kept on this Mac. Nothing is sent."}</p>
        <button type="button" className="lc-btn" data-kind="ink" data-size="sm" onClick={onClose}>
          Done
        </button>
      </footer>
    </section>
  );
}
