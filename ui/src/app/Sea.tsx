/*
  The sea behind Home: a humpback whale drawn as a cloud of points, in the dot-matrix look of a
  scan (the reference the person gave: creatures of fine indigo dots that turn in space and shed
  thin strands). The whale is fourteen thousand points on a 3D body (round head, grooved throat,
  long flippers, swept flukes, a small dorsal fin, eyes). The sea is open, not a tank: the whale is
  at most a third of the paper long and mostly well out in the water, small in the murk, and it
  swims long passes that start and end beyond the edges (across, up from below, out of the deep),
  under the message box too, so it turns out of sight and the water is empty for a while between.
  Now and then it comes close and big. Depth shows round it: it fades as it goes deep, a far whale
  crosses faint in the fog, a school of fish goes by in the middle distance, the snow falls at
  three depths' pace, light comes down in slanting shafts, and the paper's edges thin out to
  murk. It swims as one: kicks and glides, its head nodding against its tail, banking and
  bending into its turns, its flippers rowing, its eyes blinking, its points shimmering. Each frame the points
  are projected and counted into a fine grid, and every cell of the grid is a square dot sized by
  how many points fell in it and how much light they caught: the halftone. Dust trails off the
  flukes and the flipper tips, the edges shed a little, snow drifts down, and a bracket with a
  caption follows the whale's head. Moving through the water stirs the points away from the
  pointer; a click lets out bubbles, and on the whale it blows.

  It's cheap on purpose (memory, browser-panel-perf: measure frames): 30 frames a second at most,
  the dots filled as one path per size, the middle of the paper dimmed in the drawing itself rather
  than with a mask, and nothing drawn while the window is hidden. Reduce motion gets one still
  frame. Settings, Appearance chooses what's behind Home (look.ts, `home`): the sea, your own dots
  (Dots.tsx), or nothing; the first time the sea shows, a small card says so, and offers to make
  your own.
*/
import { useEffect, useRef, useState } from "react";
import { toast } from "@liner/components/toast/toast";
import { BehindHome, Dots, DotsHello, onWater, useBehindHome } from "./Dots";
import { I } from "./icons";
import { homeShown, updateLook, useLook } from "./look";

/** The small card on the sea stays, visit after visit, until its × closes it for good. */
const HELLO_KEY = "liner-code:sea-hello";
/** The grid's cell, in CSS pixels: one dot each. */
const CELL = 4;
/**
  How often it draws: 24 a second while the whale is in sight (up close it moves about one 4px
  cell a frame at that, so more would draw the same dots again), 15 while the water is empty (snow
  and light move a cell or two a second), and 10 while the window isn't the one in use. Measured
  2026-11-25 at 1440 by 900 at 2x on an M5: about 14% of one core in all with the whale in sight
  (page 9%, graphics 5%), against 25% before the per-point work was cut.
*/
const FRAME_MS = { seen: 1000 / 24, empty: 1000 / 15, away: 1000 / 10 };
/** A sine table for the points' shimmer: one lookup a point instead of a Math.sin. */
const SINE = Float32Array.from({ length: 256 }, (_, i) => Math.sin((i / 256) * Math.PI * 2));
/** The body's wave is worked out at this many places along it each frame, and each point takes the nearest: not two sines and two powers a point. */
const ALONG = 64;
const POINTS = 14000;
/** How much a cell must hold for each dot size, and the size and strength of each. */
const STEPS = [0.14, 0.32, 0.56, 0.9, 1.35, 1.95];
const SIZES = [0.8, 1.1, 1.5, 1.9, 2.4, 2.9];
const ALPHAS = [0.38, 0.52, 0.66, 0.78, 0.9, 1];

const BODY = 0;
const FLIPPER = 1;
const FLUKE = 2;
const FIN = 3;
const EYE = 4;

const clamp = (v: number, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
/** A small seeded random, so the whale is the same whale every time. */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
};

/** The body's radius along its length, 0 at the nose to 1 at the tail stock: a round head, a long taper. */
const profile = (u: number) => {
  if (u <= 0 || u >= 1.02) return 0;
  if (u < 0.24) return Math.sqrt(1 - ((0.24 - u) / 0.24) ** 2);
  return Math.max(0.06, 1 - 0.94 * ((u - 0.24) / 0.76) ** 1.6);
};

/** Body radius against length: a humpback is about four and a half times as long as it is deep. */
const R = 0.105;
/** Where the flipper joins, and where it reaches, in the whale's own frame (x ahead, y up, z to its right; length 1). */
const FLIP_ROOT = [0.19, -0.05, 0.075] as const;
const FLIP_DIR = [-0.45, -0.38, 0.81] as const;
const FLIP_SPAN = 0.32;

type Cloud = { pos: Float32Array; nor: Float32Array; u: Float32Array; part: Uint8Array; side: Int8Array };

/** The whale's points, once: on its body, its throat grooves, its flippers, flukes and dorsal fin. */
function buildWhale(n: number): Cloud {
  const rnd = seeded(7);
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const u = new Float32Array(n);
  const part = new Uint8Array(n);
  const side = new Int8Array(n);
  const set = (i: number, x: number, y: number, z: number, nx: number, ny: number, nz: number, uu: number, p: number, s: number) => {
    const j = (rnd() - 0.5) * 0.004;
    const l = Math.hypot(nx, ny, nz) || 1;
    pos[i * 3] = x + j;
    pos[i * 3 + 1] = y + j;
    pos[i * 3 + 2] = z - j;
    nor[i * 3] = nx / l;
    nor[i * 3 + 1] = ny / l;
    nor[i * 3 + 2] = nz / l;
    u[i] = uu;
    part[i] = p;
    side[i] = s;
  };
  for (let i = 0; i < n; i++) {
    const pick = rnd();
    if (pick < 0.68) {
      // The body: placed by how much skin there is along it, so the dots spread evenly.
      let uu = 0;
      do uu = rnd() * 1.02;
      while (rnd() > profile(uu) + 0.04);
      const p = profile(uu);
      let a = rnd() * Math.PI * 2;
      // Half the throat's points sit on its grooves, marked so they're drawn as if etched: lines in the shade.
      const groove = uu > 0.03 && uu < 0.5 && Math.cos(a) < -0.55 && rnd() < 0.55;
      if (groove) a = Math.PI + Math.round((a - Math.PI) / 0.085) * 0.085;
      const top = Math.cos(a) > 0;
      const ry = R * p * (top ? (uu < 0.22 ? 0.86 : 1) : 1.14);
      const rz = R * p * 0.9;
      const slope = (profile(uu + 0.01) - profile(uu - 0.01)) / 0.02;
      set(i, 0.5 - uu, ry * Math.cos(a), rz * Math.sin(a), R * slope * 0.9, Math.cos(a) / (ry || 1e-3), Math.sin(a) / (rz || 1e-3), uu, BODY, groove ? 1 : 0);
    } else if (pick < 0.81) {
      // A flipper: long and narrow, with the humpback's bumpy leading edge.
      const s = rnd();
      const w = rnd();
      const sd = rnd() < 0.5 ? -1 : 1;
      const chord = 0.065 * (1 - s * 0.72);
      const bump = 0.005 * Math.sin(s * 46);
      const x = FLIP_ROOT[0] + FLIP_DIR[0] * FLIP_SPAN * s - (w * chord - bump);
      const y = FLIP_ROOT[1] + FLIP_DIR[1] * FLIP_SPAN * s;
      const z = sd * (FLIP_ROOT[2] + FLIP_DIR[2] * FLIP_SPAN * s);
      set(i, x, y, z, 0.1, 1, -0.35 * sd, 0.3, FLIPPER, sd);
    } else if (pick < 0.96) {
      // The flukes: swept back, notched in the middle, pointed at the tips.
      const sd = rnd() < 0.5 ? -1 : 1;
      const s = Math.sqrt(rnd());
      const w = rnd();
      const lead = -0.52 - 0.145 * s ** 1.6;
      const trail = -0.555 - 0.11 * s ** 0.6;
      set(i, lead + (trail - lead) * w, (rnd() - 0.5) * 0.006, sd * s * 0.2, 0, 1, 0, 1, FLUKE, sd);
    } else if (pick < 0.97) {
      // An eye on each side, a tight cluster just under the midline, so it can glint and blink.
      const sd = rnd() < 0.5 ? -1 : 1;
      const a = rnd() * Math.PI * 2;
      const rr = Math.sqrt(rnd()) * 0.0065;
      const p = profile(0.115);
      set(i, 0.385 + Math.cos(a) * rr, -0.006 + Math.sin(a) * rr, sd * (R * p * 0.9 + 0.002), 0, 0, sd, 0.115, EYE, sd);
    } else {
      // The small dorsal fin, two thirds of the way back.
      const s = rnd();
      const h = rnd();
      const uu = 0.6 + s * 0.12;
      const top = R * profile(uu);
      set(i, 0.5 - uu - h * 0.03, top + h * 0.03 * (1 - Math.abs(s - 0.55) * 1.6), (rnd() - 0.5) * 0.008, 0, 0.4, 1, uu, FIN, 0);
    }
  }
  return { pos, nor, u, part, side };
}

let cloud: Cloud | null = null;

type Mote = { x: number; y: number; vx: number; vy: number; age: number; life: number; w: number; ring: number };
type V3 = [number, number, number];
/** A pass: in from beyond the paper's edge (or out of the deep), along a gentle curve, and away again. */
type Pass = { a: V3; b: V3; c: V3; len: number };
/** A whale in the water: the one that comes close, or a far one that crosses now and then, small and faint. */
type Swimmer = { far: boolean; pass: Pass | null; prog: number; wait: number; beat: number; stroke: number; speed: number; amp: number; startle: number; turn: number; lastYaw: number | null };
/** A small school of fish crossing in the middle distance. */
type School = { x: number; y: number; vx: number; n: number };

const between = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const bez = (p: Pass, u: number): V3 => {
  // Past its end, a pass goes straight on the way it was heading, so the whale swims on out of sight rather than stopping.
  if (u > 1) {
    const k = 2 * (u - 1);
    return [p.c[0] + (p.c[0] - p.b[0]) * k, p.c[1] + (p.c[1] - p.b[1]) * k, p.c[2] + (p.c[2] - p.b[2]) * k];
  }
  const v = 1 - u;
  return [v * v * p.a[0] + 2 * v * u * p.b[0] + u * u * p.c[0], v * v * p.a[1] + 2 * v * u * p.b[1] + u * u * p.c[1], v * v * p.a[2] + 2 * v * u * p.b[2] + u * u * p.c[2]];
};
/** A cheap fixed noise for a cell, 0 to 1: the light shafts' stipple. */
const cellNoise = (c: number, r: number) => (((c * 73856093) ^ (r * 19349663)) >>> 0) % 1024 / 1024;
const swimmer = (far: boolean): Swimmer => ({ far, pass: null, prog: 0, wait: 0, beat: Math.random() * 6, stroke: 0, speed: 1, amp: 0.06, startle: 0, turn: 0, lastYaw: null });

/** The message box's top and bottom on the canvas, if there's one on the page, for the crossings that go under it. */
type BoxEdges = () => { top: number; bottom: number } | null;

function run(canvas: HTMLCanvasElement, still: boolean, boxOf: BoxEdges) {
  const ctx = canvas.getContext("2d", { alpha: true })!;
  const whale = (cloud ??= buildWhale(POINTS));
  const sx = new Float32Array(POINTS);
  const sy = new Float32Array(POINTS);
  let W = 0;
  let H = 0;
  let cols = 0;
  let rows = 0;
  let acc = new Float32Array(0);
  let fade = new Float32Array(0);
  let rays = new Float32Array(0);
  // The cells something landed in this frame, so the drawing and the clearing visit only those, not the whole grid.
  let touched = new Int32Array(0);
  let nTouched = 0;
  // The light shafts' cells, worked out a few times a second: they drift far slower than that.
  let rayCells = new Int32Array(0);
  let nRays = 0;
  let raysAt = -1;
  // Each lit cell's dot size, for drawing them size by size.
  let level = new Uint8Array(0);
  const motes: Mote[] = [];
  let snow: { x: number; y: number; d: number }[] = [];
  let t = still ? 30 : 0;
  let ink = "#889";
  let life = "#aab";
  let strength = 1;
  let mono = "ui-monospace, Menlo, monospace";
  let pointer: { x: number; y: number; at: number } | null = null;
  let stir = 0;
  let blowAt = 4;
  const shimmer = Uint8Array.from({ length: POINTS }, (_, i) => (i * 97) & 255);
  // Each point's place along the body, as a step of the wave tables below.
  const along = Uint8Array.from(whale.u, (u) => Math.round(clamp(u) * ALONG));
  const bendAt = new Float32Array(ALONG + 1);
  const sideAt = new Float32Array(ALONG + 1);
  // The whale that comes close, and a far one that crosses deep in the fog now and then.
  const lead = swimmer(false);
  const distant = swimmer(true);
  distant.wait = between(16, 30);
  let school: School | null = null;
  let schoolAt = between(22, 40);
  let raf = 0;
  let last = 0;
  let frames = 0;
  // Where the lead's head, blowhole and tips are this frame, for the bracket, the trails and the caption.
  const marks = { head: [0, 0], blow: [0, 0], flukes: [0, 0, 0, 0], flips: [0, 0, 0, 0], scale: 0, heading: 0, near: 0, seen: false, depth: 0 };

  const PITCH = 0.24;
  const cp = Math.cos(PITCH);
  const sp = Math.sin(PITCH);
  const focal = () => W * 1.15 + 600;
  /**
    Nearly half the paper long up close: deeper than the message box is tall, so passing under the
    box its back shows over it and its flippers under it. Out in the water it's smaller, with room round it.
  */
  const lengthOf = () => clamp(Math.min(W * 0.48, H * 0.85), 280, 720);

  /** Where a point of the water lands on the paper, and its scale there. */
  const screenOf = (p: V3) => {
    const f = focal();
    const s = f / (f - p[1] * sp + p[2] * cp);
    return [W / 2 + p[0] * s, H * 0.47 - (p[1] * cp + p[2] * sp) * s, s] as const;
  };
  /** Whether a whale centred here would show any of itself: on the paper with its length round it, and not lost in the murk. */
  const inSight = (p: V3) => {
    const [x, y, s] = screenOf(p);
    if (s <= 0 || clamp((s - 0.3) / 0.7) ** 0.8 < 0.06) return false;
    const reach = lengthOf() * s * 0.8;
    return x > -reach && x < W + reach && y > -reach && y < H + reach;
  };

  const readInks = () => {
    const s = getComputedStyle(canvas);
    ink = s.getPropertyValue("--lc-sea-ink").trim() || ink;
    life = s.getPropertyValue("--lc-sea-life").trim() || life;
    strength = Number(s.getPropertyValue("--lc-sea-strength")) || 1;
    mono = s.getPropertyValue("--l-font-mono").trim() || mono;
  };

  const resize = () => {
    const r = canvas.getBoundingClientRect();
    W = r.width;
    H = r.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cols = Math.ceil(W / CELL);
    rows = Math.ceil(H / CELL);
    acc = new Float32Array(cols * rows);
    touched = new Int32Array(cols * rows);
    level = new Uint8Array(cols * rows);
    nTouched = 0;
    rays = new Float32Array(cols + rows);
    rayCells = new Int32Array(cols * rows);
    raysAt = -1;
    // Round the box, where the project's name sits, the sea shows at nearly three quarters; behind the
    // box it's hidden, as the whale swims under it. Toward the paper's edges it thins out to nothing,
    // so the edges read as murk, not walls.
    fade = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const x = (c + 0.5) * CELL;
        const y = (r + 0.5) * CELL;
        const dx = (x - W / 2) / (W * 0.3);
        const dy = (y - H * 0.53) / (H * 0.14);
        const e = clamp(Math.min(x, W - x, y, H - y) / 90);
        fade[r * cols + c] = (0.72 + 0.28 * clamp((dx * dx + dy * dy - 0.8) / 1.4)) * e * e * (3 - 2 * e);
      }
    const rnd = seeded(3);
    snow = Array.from({ length: Math.round((W * H) / 4200) }, () => ({ x: rnd() * W, y: rnd() * H, d: 0.2 + rnd() * 0.8 }));
    readInks();
  };

  const add = (x: number, y: number, w: number) => {
    const c = (x / CELL) | 0;
    const r = (y / CELL) | 0;
    if (c < 0 || r < 0 || c >= cols || r >= rows) return;
    const i = r * cols + c;
    if (acc[i] === 0) touched[nTouched++] = i;
    acc[i] += w;
  };

  const emit = (x: number, y: number, n: number, kind: "dust" | "bubble", spread = 3) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      if (kind === "dust") motes.push({ x: x + Math.cos(a) * spread * Math.random(), y: y + Math.sin(a) * spread * Math.random(), vx: (Math.random() - 0.5) * 8, vy: (Math.random() - 0.5) * 8 - 3, age: 0, life: 3 + Math.random() * 3.5, w: 0.5 + Math.random() * 0.35, ring: 0 });
      else motes.push({ x: x + (Math.random() - 0.5) * spread * 4, y: y - Math.random() * spread * 3, vx: (Math.random() - 0.5) * 10, vy: -(28 + Math.random() * 46), age: 0, life: 5 + Math.random() * 3, w: 0.9, ring: 1.5 + Math.random() * 2.5 });
    }
  };

  /**
    The next pass. Most cross the paper well out in the water, small; some come nearer; now and
    then one comes close, big, for a moment. Some rise from below and drift away up and out, some
    come up out of the deep and swim off a side. Each starts and ends beyond the edge, so the whale
    turns out of sight and the water is open while it's gone. The far one only crosses, deep.
  */
  const newPass = (sw: Swimmer, first: boolean): Pass => {
    const f = focal();
    const L = lengthOf();
    const pick = Math.random();
    // Some crossings go under the message box, at its height and near enough to show round it.
    const under = !sw.far && !first && Math.random() < 0.35;
    const z = sw.far ? W * between(1.7, 2.5) : first ? W * 0.28 : under ? W * between(-0.02, 0.2) : pick < 0.12 ? W * between(-0.1, 0.03) : pick < 0.5 ? W * between(0.05, 0.35) : W * between(0.35, 0.72);
    const kind = sw.far || first || under ? "cross" : (["cross", "cross", "cross", "rise", "deep"] as const)[(Math.random() * 5) | 0];
    const s = f / (f + z);
    const halfX = W / 2 / s + L * 0.75;
    const halfY = H / 2 / s;
    const dir = first ? -1 : Math.random() < 0.5 ? -1 : 1;
    let a: V3;
    let c: V3;
    if (kind === "rise") {
      a = [-dir * between(0.1, 0.6) * (W / 2 / s), -(halfY + L * 0.45), z + between(-0.1, 0.1) * W];
      c = [dir * halfX, between(0.1, 0.5) * halfY, z + between(0.1, 0.3) * W];
    } else if (kind === "deep") {
      a = [between(-0.4, 0.4) * W, between(-0.3, 0.3) * H, W * 2.8];
      c = [dir * halfX, between(-0.45, 0.45) * halfY, z];
    } else if (under) {
      // Along the box's top edge, its back showing over the box as it goes, or along its bottom
      // edge, its belly and flippers showing under it: so it never vanishes whole, however big the box.
      const box = boxOf();
      const edge = box ? (Math.random() < 0.6 ? box.top + between(0, 0.1) * L * s : box.bottom - between(0, 0.1) * L * s) : H * 0.47;
      const y = ((H * 0.47 - edge) / s - z * sp) / cp;
      a = [-dir * halfX, y, z + between(-0.04, 0.04) * W];
      c = [dir * halfX, y + between(-0.015, 0.015) * H, z + between(-0.04, 0.04) * W];
    } else {
      const y = between(-0.55, 0.55) * halfY;
      a = [-dir * halfX, y, z + between(-0.15, 0.15) * W];
      c = [dir * halfX, y + between(-0.3, 0.3) * halfY, z + between(-0.15, 0.15) * W];
    }
    const b: V3 = under ? [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2 + between(-0.01, 0.01) * H, (a[2] + c[2]) / 2 + between(-0.04, 0.04) * W] : [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2 + between(-0.25, 0.25) * halfY, (a[2] + c[2]) / 2 + between(-0.25, 0.25) * W];
    // Each end where it really can't be seen: the edge was worked out for the pass's middle depth,
    // and an end that sits deeper is drawn nearer the middle of the paper, so it moves on out along
    // the curve until no part of the whale would show there. Otherwise it appeared or vanished in plain sight.
    for (let k = 0; k < 24 && inSight(a); k++) for (let j = 0; j < 3; j++) a[j] += (a[j] - b[j]) * 0.25;
    for (let k = 0; k < 24 && inSight(c); k++) for (let j = 0; j < 3; j++) c[j] += (c[j] - b[j]) * 0.25;
    const pass: Pass = { a, b, c, len: 0 };
    let prev = bez(pass, 0);
    for (let k = 1; k <= 16; k++) {
      const p = bez(pass, k / 16);
      pass.len += Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
      prev = p;
    }
    return pass;
  };

  /** A swimmer moves on: along its pass at a rhythm of kicks and glides, or waits out of sight for the next. */
  const swim = (sw: Swimmer, dt: number) => {
    if (!sw.pass) {
      sw.wait -= dt;
      if (sw.wait > 0) return;
      sw.pass = newPass(sw, false);
      sw.prog = 0;
      sw.lastYaw = null;
      sw.turn = 0;
    }
    const want = clamp(1 + 0.45 * Math.sin(t * 0.17 + (sw.far ? 2 : 0)) + 0.25 * Math.sin(t * 0.43 + 1) + sw.startle * 1.4, 0.4, 2.8);
    sw.speed += (want - sw.speed) * Math.min(1, dt * 1.5);
    sw.startle = Math.max(0, sw.startle - dt * 0.35);
    // About a body length every six seconds at its easy pace.
    sw.prog += (dt * sw.speed * lengthOf() * (sw.far ? 0.12 : 0.17)) / sw.pass.len;
    sw.beat += dt * (0.7 + 0.95 * sw.speed);
    sw.stroke += dt * (0.5 + 0.35 * sw.speed);
    // Gliding, the tail barely moves; kicking, it sweeps.
    sw.amp += (0.035 + 0.06 * clamp((sw.speed - 0.6) / 1.2) - sw.amp) * Math.min(1, dt * 2);
    // The pass is over only once the whale is out of sight; until then it swims on, straight.
    if (sw.prog >= 1 && (!inSight(bez(sw.pass, sw.prog)) || sw.prog > 4)) {
      sw.pass = null;
      sw.wait = sw.far ? between(35, 75) : between(2.5, 6.5);
      return;
    }
    const p0 = bez(sw.pass, sw.prog);
    const p1 = bez(sw.pass, Math.min(1, sw.prog + 0.01));
    const yaw = Math.atan2(p1[2] - p0[2], p1[0] - p0[0]);
    if (sw.lastYaw !== null && dt > 0) {
      const d = Math.atan2(Math.sin(yaw - sw.lastYaw), Math.cos(yaw - sw.lastYaw));
      sw.turn += (d / dt - sw.turn) * Math.min(1, dt * 2.5);
    }
    sw.lastYaw = yaw;
  };

  /** A whale this frame: swum, turned, projected, and counted into the grid. The lead also leaves its marks. */
  const drawSwimmer = (sw: Swimmer, least: number) => {
    const main = sw === lead;
    if (!sw.pass) {
      if (main) marks.seen = false;
      return;
    }
    const L = lengthOf();
    const f = focal();
    const [wx, wy, wz] = bez(sw.pass, sw.prog);
    const ahead = bez(sw.pass, Math.min(1, sw.prog + 0.01));
    const vx = ahead[0] - wx;
    const vy = ahead[1] - wy;
    const vz = ahead[2] - wz;
    const yaw = Math.atan2(vz, vx);
    // It points where it goes: up as it climbs, down as it dives.
    const climb = clamp(Math.atan2(vy, Math.hypot(vx, vz)) * 0.75, -0.45, 0.45);
    // It banks into a turn and curves its body round it.
    const roll = clamp(-sw.turn * 0.9, -0.55, 0.55);
    const curve = clamp(sw.turn * 0.3, -0.14, 0.14);
    const cyaw = Math.cos(yaw);
    const syaw = Math.sin(yaw);
    const cc = Math.cos(climb);
    const sc = Math.sin(climb);
    const cr = Math.cos(roll);
    const sr = Math.sin(roll);
    const cx = W / 2;
    const cy = H * 0.47;
    // Out in the water it fades into the murk; the points are weighed by how close together they land, so near or far it reads as the same body.
    const s0 = f / (f - wy * sp + wz * cp);
    const fog = clamp((s0 - 0.3) / 0.7) ** 0.8;
    // Out in the water the whale covers few cells, so every second or third point draws it as well as all of them would.
    const stride = Math.max(least, s0 < 0.62 ? 3 : s0 < 0.85 ? 2 : 1);
    const weigh = fog * s0 * s0 * stride * (sw.far ? 0.8 : 1);
    if (weigh < 0.01) {
      if (main) marks.seen = false;
      return;
    }
    const flap = Math.sin(sw.stroke) * 0.38;
    const beat = sw.beat;
    const amp = sw.amp;
    const turn = sw.turn;
    // The tail's wave, the head's small nod against it, and a slow sway along the body.
    const bend = (uu: number) => Math.sin(beat - uu * 3.1) * amp * Math.max(0, uu - 0.22) ** 2.2 - Math.sin(beat) * amp * 0.16 * (1 - uu) ** 3;
    const side = (uu: number) => curve * (uu - 0.35) ** 2 + Math.sin(beat * 0.5 - uu * 2) * 0.012 * uu;
    const tail = bend(1);
    const tailAngle = Math.atan((bend(1) - bend(0.97)) / 0.03) * 1.4 + Math.sin(beat - 3.4) * amp * 3.6;
    const ct = Math.cos(tailAngle);
    const st = Math.sin(tailAngle);
    // A blink every seven seconds or so; when startled, the eye is wide and bright.
    const blink = t % 7.3 < 0.16 ? 0 : 1 + sw.startle * 1.5;
    const lx = -0.25;
    const ly = 0.9;
    const lz = -0.36;

    // One point of the whale's own frame to the screen, with its normal's light and how much it faces us.
    const place = (x: number, y: number, z: number, nx: number, ny: number, nz: number, out: Float32Array) => {
      // The bank (about its length), the climb (about z), then the turn (about y), then out to its place on the pass.
      const yr = y * cr - z * sr;
      const zr = y * sr + z * cr;
      const nyr = ny * cr - nz * sr;
      const nzr = ny * sr + nz * cr;
      const x1 = x * cc - yr * sc;
      const y1 = x * sc + yr * cc;
      const n1x = nx * cc - nyr * sc;
      const n1y = nx * sc + nyr * cc;
      const X = (x1 * cyaw - zr * syaw) * L + wx;
      const Z = (x1 * syaw + zr * cyaw) * L + wz;
      const Y = y1 * L + wy;
      const nX = n1x * cyaw - nzr * syaw;
      const nZ = n1x * syaw + nzr * cyaw;
      // The camera looks down a little, so what's farther sits higher.
      const Y2 = Y * cp + Z * sp;
      const Z2 = -Y * sp + Z * cp;
      const nY2 = n1y * cp + nZ * sp;
      const nZ2 = -n1y * sp + nZ * cp;
      const s = f / (f + Z2);
      out[0] = cx + X * s;
      out[1] = cy - Y2 * s;
      out[2] = s;
      out[3] = Math.max(0, nX * lx + nY2 * ly + nZ2 * lz);
      out[4] = -nZ2;
    };
    const o = new Float32Array(5);
    // Where each point is in its shimmer, as a step round the sine table.
    const tick = ((t * 2.3 * 256) / (Math.PI * 2)) | 0;
    for (let k = 0; k <= ALONG; k++) {
      bendAt[k] = bend(k / ALONG);
      sideAt[k] = side(k / ALONG);
    }
    const flipY = bend(0.3);
    const flipZ = side(0.3);
    const tailZ = side(1);
    // The flippers' stroke, one angle for each side.
    const rowL = flap * -1 + turn * 0.25;
    const rowR = flap + turn * 0.25;
    const rowCos = [Math.cos(rowL), Math.cos(rowR)];
    const rowSin = [Math.sin(rowL), Math.sin(rowR)];
    const pos = whale.pos;
    const nor = whale.nor;
    const stirring = main && stir > 0.01 && pointer;
    let near = 0;
    for (let i = 0; i < POINTS; i += stride) {
      let x = pos[i * 3];
      let y = pos[i * 3 + 1];
      let z = pos[i * 3 + 2];
      let nx = nor[i * 3];
      let ny = nor[i * 3 + 1];
      let nz = nor[i * 3 + 2];
      const part = whale.part[i];
      if (part === FLUKE) {
        // The flukes pitch with the beat, about the tail stock.
        const dx = x + 0.5;
        x = -0.5 + dx * ct - y * st;
        y = dx * st + y * ct + tail;
        z += tailZ;
        const nx2 = nx * ct - ny * st;
        ny = nx * st + ny * ct;
        nx = nx2;
      } else if (part === FLIPPER) {
        // The flippers row about their roots; the inner one dips in a turn.
        const right = whale.side[i] > 0 ? 1 : 0;
        const dy = y - FLIP_ROOT[1];
        const dz = z - whale.side[i] * FLIP_ROOT[2];
        const ca = rowCos[right];
        const sa = rowSin[right];
        y = FLIP_ROOT[1] + dy * ca - dz * sa + flipY;
        z = whale.side[i] * FLIP_ROOT[2] + dy * sa + dz * ca + flipZ;
        const ny2 = ny * ca - nz * sa;
        nz = ny * sa + nz * ca;
        ny = ny2;
      } else {
        y += bendAt[along[i]];
        z += sideAt[along[i]];
      }
      place(x, y, z, nx, ny, nz, o);
      let px = o[0];
      let py = o[1];
      // The pointer stirs the points nearby out of its way.
      if (stirring) {
        const dx = px - pointer!.x;
        const dy = py - pointer!.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 120 * 120) {
          const d = Math.sqrt(d2) || 1;
          const push = (1 - d / 120) ** 2 * 34 * stir;
          px += (dx / d) * push;
          py += (dy / d) * push;
          near++;
        }
      }
      if (main) {
        sx[i] = px;
        sy[i] = py;
      }
      const facing = o[4];
      const etched = part === BODY && whale.side[i] === 1 ? 0.3 : 0;
      // Lit from above and ahead; the far side shows through faintly, as a scan does; the outline glows a little; every point shimmers on its own.
      const glint = 0.74 + 0.26 * SINE[(tick + shimmer[i]) & 255];
      const lit = o[3];
      const edge = 1 - Math.abs(facing);
      const w = part === EYE ? (facing > 0.1 ? 2.2 : 0) * blink : (facing < 0 ? 0.24 : 1) * (0.07 + etched + 0.93 * lit * Math.sqrt(lit) + 0.5 * edge * edge * edge) * 1.05 * glint;
      add(px, py, w * weigh);
    }
    if (!main) return;
    marks.near = near;
    // The head, the blowhole and the tips, for the bracket and the trails.
    place(0.42, bend(0.08) + 0.01, side(0.08), 0, 1, 0, o);
    marks.head = [o[0], o[1]];
    marks.scale = o[2];
    marks.seen = fog > 0.15 && o[0] > -40 && o[0] < W + 40 && o[1] > -40 && o[1] < H + 40;
    place(0.36, bend(0.14) + R * 0.95, side(0.14), 0, 1, 0, o);
    marks.blow = [o[0], o[1]];
    for (let k = 0; k < 2; k++) {
      const sd = k ? 1 : -1;
      place(-0.5 + 0.165 * ct, 0.165 * st + tail, sd * 0.2 + side(1), 0, 1, 0, o);
      marks.flukes[k * 2] = o[0];
      marks.flukes[k * 2 + 1] = o[1];
      place(FLIP_ROOT[0] + FLIP_DIR[0] * FLIP_SPAN, FLIP_ROOT[1] + FLIP_DIR[1] * FLIP_SPAN + bend(0.3), sd * (FLIP_ROOT[2] + FLIP_DIR[2] * FLIP_SPAN) + side(0.3), 0, 1, 0, o);
      marks.flips[k * 2] = o[0];
      marks.flips[k * 2 + 1] = o[1];
    }
    marks.heading = ((yaw * 180) / Math.PI + 450) % 360;
    marks.depth = 14 + clamp((wz + W * 0.1) / (W * 1.1)) * 60 - wy / H * 8;
  };

  const step = (dt: number) => {
    t += dt;
    swim(lead, dt);
    swim(distant, dt);
    if (marks.seen) {
      // Dust off the flukes and the flipper tips, and a little shed from anywhere on the skin; more when it's near.
      const n = marks.scale > 0.85 ? 2 : 1;
      for (let k = 0; k < 2; k++) {
        emit(marks.flukes[k * 2], marks.flukes[k * 2 + 1], lead.speed > 1.2 ? n + 1 : n, "dust", 4);
        if (Math.random() < 0.6) emit(marks.flips[k * 2], marks.flips[k * 2 + 1], 1, "dust", 3);
      }
      for (let k = 0; k < 3; k++) {
        const i = (Math.random() * POINTS) | 0;
        emit(sx[i], sy[i], 1, "dust", 1);
      }
      if (t >= blowAt) {
        emit(marks.blow[0], marks.blow[1], Math.round(8 + 8 * marks.scale), "bubble", 3);
        blowAt = t + 10 + Math.random() * 10;
      }
    }
    for (const m of motes) {
      m.age += dt;
      m.x += (m.vx + Math.sin(m.y * 0.02 + t * 0.6) * 4) * dt;
      m.y += m.vy * dt;
      m.vx *= 1 - dt * 0.4;
      if (m.ring) m.vy *= 1 - dt * 0.1;
    }
    for (let i = motes.length - 1; i >= 0; i--) if (motes[i].age > motes[i].life || motes[i].y < -20) motes.splice(i, 1);
    // The snow falls at three depths' pace: the near flakes big and quick, the far ones fine and slow.
    for (const s of snow) {
      s.y += (3 + 11 * s.d * s.d) * dt;
      s.x += Math.sin(t * 0.3 + s.d * 9) * 3 * s.d * dt;
      if (s.y > H + 4) (s.y = -4), (s.x = Math.random() * W);
    }
    if (school) {
      school.x += school.vx * dt;
      if (school.x < -160 || school.x > W + 160) (school = null), (schoolAt = t + between(30, 60));
    } else if (t >= schoolAt) {
      const dir = Math.random() < 0.5 ? -1 : 1;
      school = { x: dir > 0 ? -140 : W + 140, y: H * between(0.15, 0.85), vx: dir * between(24, 38), n: 26 + ((Math.random() * 10) | 0) };
    }
  };

  /** The bracket that follows the whale's head, and the caption in the corner: what it reads while the whale's in sight, and that it's listening while it's gone. */
  const drawLabels = () => {
    ctx.fillStyle = ink;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1;
    const [hx, hy] = marks.head;
    const at = marks.seen ? fade[clamp(((hy / CELL) | 0) * cols + ((hx / CELL) | 0), 0, fade.length - 1)] ?? 1 : 0;
    const a = 0.7 * strength * at * clamp((marks.scale - 0.5) / 0.3);
    if (a > 0.05) {
      const half = 26 * marks.scale;
      const x0 = Math.round(hx - half) + 0.5;
      const y0 = Math.round(hy - half) + 0.5;
      const x1 = Math.round(hx + half) + 0.5;
      const y1 = Math.round(hy + half) + 0.5;
      const tick = 7;
      ctx.globalAlpha = a;
      ctx.beginPath();
      for (const [x, y, sxn, syn] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]] as const) {
        ctx.moveTo(x + tick * sxn, y);
        ctx.lineTo(x, y);
        ctx.lineTo(x, y + tick * syn);
      }
      // The leader goes off the side the nose points to, into open water, not across the body.
      const ahead = hx <= (marks.flukes[0] + marks.flukes[2]) / 2 ? -1 : 1;
      const ex = ahead < 0 ? x0 : x1;
      ctx.moveTo(ex, y0);
      ctx.lineTo(ex + 18 * ahead, y0 - 18);
      ctx.lineTo(ex + 30 * ahead, y0 - 18);
      ctx.stroke();
      ctx.font = `9px ${mono}`;
      ctx.textBaseline = "middle";
      ctx.textAlign = ahead < 0 ? "right" : "left";
      ctx.fillText("SPECIMEN 01", ex + 34 * ahead, y0 - 18);
    }
    ctx.globalAlpha = 0.55 * strength;
    ctx.font = `10px ${mono}`;
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText("MEGAPTERA NOVAEANGLIAE", W - 22, 56);
    ctx.globalAlpha = 0.38 * strength;
    ctx.fillText(marks.seen ? `DEPTH ${marks.depth.toFixed(1)} M  ·  HDG ${String(Math.round(marks.heading)).padStart(3, "0")}°  ·  ${(1.4 * lead.speed).toFixed(1)} KN` : `NO CONTACT  ·  LISTENING${".".repeat(1 + (Math.floor(t * 1.5) % 3))}`, W - 22, 72);
    ctx.globalAlpha = 1;
  };

  /** The light shafts' cells: slanting bands from the surface, stippled, fading with depth. */
  const workOutRays = () => {
    for (let k = 0; k < rays.length; k++) {
      const v = Math.sin(k * CELL * 0.0055 + t * 0.05) * 0.6 + Math.sin(k * CELL * 0.0021 - t * 0.03) * 0.4;
      rays[k] = v > 0.55 ? ((v - 0.55) / 0.45) ** 2 : 0;
    }
    nRays = 0;
    const deep = Math.ceil(rows * 0.75);
    for (let r = 0; r < deep; r++) {
      const fall = (1 - r / deep) ** 1.7 * 0.4;
      const shift = Math.round(r * 0.42);
      for (let c = 0, i = r * cols; c < cols; c++, i++) {
        const ray = rays[c + shift] * fall;
        if (ray > 0.01 && cellNoise(c, r) < ray) rayCells[nRays++] = i;
      }
    }
    raysAt = t;
  };

  const paint = () => {
    // Only the cells last frame touched need clearing.
    for (let k = 0; k < nTouched; k++) acc[touched[k]] = 0;
    nTouched = 0;
    if (raysAt < 0 || Math.abs(t - raysAt) > 0.4) workOutRays();
    for (let k = 0; k < nRays; k++) {
      const i = rayCells[k];
      if (acc[i] === 0) touched[nTouched++] = i;
      acc[i] += 0.16;
    }
    drawSwimmer(distant, 4);
    if (school) {
      // Each fish a short dash of two dots, circling its place in the school as the school moves on.
      const dir = school.vx > 0 ? 1 : -1;
      const sy0 = school.y + Math.sin(t * 0.5) * 12;
      for (let k = 0; k < school.n; k++) {
        const ph = k * 2.399963;
        const fx = school.x + Math.cos(ph + t * 0.9) * (16 + (k % 5) * 6) + Math.sin(t * 0.4 + k) * 6;
        const fy = sy0 + Math.sin(ph * 1.3 + t * 1.1) * (8 + (k % 4) * 3);
        add(fx, fy, 0.34);
        add(fx - dir * CELL, fy, 0.22);
      }
    }
    drawSwimmer(lead, 1);
    for (const m of motes) {
      const w = m.w * (1 - m.age / m.life);
      if (!m.ring) add(m.x, m.y, w);
      else {
        // A bubble: a small ring of dots that grows as it rises.
        const r = m.ring + m.age * 1.6;
        const n = r > 5 ? 12 : 8;
        for (let k = 0; k < n; k++) add(m.x + Math.cos((k / n) * Math.PI * 2) * r, m.y + Math.sin((k / n) * Math.PI * 2) * r, w * 0.7);
      }
    }
    for (const s of snow) {
      const w = 0.15 + s.d * 0.22;
      add(s.x, s.y, w);
      // The nearest flakes are two dots across, a little out of focus.
      if (s.d > 0.85) add(s.x + CELL, s.y, w * 0.7), add(s.x, s.y + CELL, w * 0.7);
    }
    // Each touched cell to its dot size once (255: too faint to draw), then the dots drawn size by size.
    const sizes = STEPS.length;
    for (let k = 0; k < nTouched; k++) {
      const i = touched[k];
      const f = acc[i] * fade[i];
      let lv = 255;
      if (f >= STEPS[0]) {
        lv = 0;
        while (lv < sizes - 1 && f >= STEPS[lv + 1]) lv++;
      }
      level[k] = lv;
    }
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = life;
    for (let lv = 0; lv < sizes; lv++) {
      const size = SIZES[lv];
      const off = (CELL - size) / 2;
      ctx.globalAlpha = Math.min(1, ALPHAS[lv] * strength);
      ctx.beginPath();
      let any = false;
      for (let k = 0; k < nTouched; k++) {
        if (level[k] !== lv) continue;
        const i = touched[k];
        ctx.rect((i % cols) * CELL + off, ((i / cols) | 0) * CELL + off, size, size);
        any = true;
      }
      if (any) ctx.fill();
    }
    ctx.globalAlpha = 1;
    drawLabels();
  };

  // Between frames it sleeps on a timer rather than waking every display refresh only to skip it.
  let timer = 0;
  const frame = (now: number) => {
    raf = 0;
    const dt = Math.min(0.1, last ? (now - last) / 1000 : 0);
    last = now;
    // The theme can change under it: its inks are read again every second or so.
    if (++frames % 20 === 0) readInks();
    stir += ((pointer && t - pointer.at < 1.2 ? 1 : 0) - stir) * 0.08;
    step(dt);
    paint();
    const gap = !document.hasFocus() ? FRAME_MS.away : marks.seen || motes.length > 40 || stir > 0.01 ? FRAME_MS.seen : FRAME_MS.empty;
    timer = window.setTimeout(() => {
      timer = 0;
      raf = requestAnimationFrame(frame);
    }, Math.max(0, gap - (performance.now() - now) - 1));
  };

  const play = () => {
    if (still || raf || timer || document.hidden) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  };
  const pause = () => {
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    raf = 0;
    timer = 0;
  };
  const onVisible = () => (document.hidden ? pause() : play());
  const ro = new ResizeObserver(() => {
    resize();
    if (still || !raf) paint();
  });
  ro.observe(canvas);
  document.addEventListener("visibilitychange", onVisible);
  resize();
  // The first time, it's already in sight, a quarter of the way into a pass across the water.
  lead.pass = newPass(lead, true);
  lead.prog = still ? 0.5 : 0.22;
  swim(lead, 0);
  void document.fonts?.ready.then(() => (readInks(), paint()));
  paint();
  play();

  return {
    stop() {
      pause();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisible);
    },
    /** The pointer over the water: it stirs the points, and lets a little dust go behind it. */
    move(x: number, y: number) {
      if (Math.random() < 0.5) emit(x, y, 1, "dust", 6);
      pointer = { x, y, at: t };
    },
    /** A click on the water: bubbles, or on the whale, its breath. */
    poke(x: number, y: number) {
      const onWhale = marks.seen && (Math.hypot(x - marks.head[0], y - marks.head[1]) < 160 * marks.scale || marks.near > 40);
      if (onWhale) {
        // Startled: it blows, and kicks off quickly for a while.
        emit(marks.blow[0], marks.blow[1], 22, "bubble", 3);
        blowAt = t + 10;
        lead.startle = 1;
      } else emit(x, y, 9, "bubble", 2);
      pointer = { x, y, at: t };
      if (still) paint();
    },
  };
}

/**
  What's behind Home (look.ts, `home`): the sea, your dots or nothing, their cards, and the Behind
  Home panel when it's open. In a look `homeIn` leaves out, neither is mounted, so nothing runs;
  the theme changing (system's at sunset too) comes as a new look and puts it back.
*/
export function Sea() {
  const look = useLook();
  const home = homeShown(look);
  const [open, setOpen] = useBehindHome();
  return (
    <>
      {home === "sea" && <Whale card={!open} onMake={() => (updateLook({ home: "dots" }), setOpen(true))} />}
      {home === "dots" && <Dots look={look} />}
      {home === "dots" && !open && <DotsHello onChange={() => setOpen(true)} />}
      {open && <BehindHome look={look} onClose={() => setOpen(false)} />}
    </>
  );
}

/** The sea, filling Home's paper behind everything on it, and the card that introduces it the first time (not while Behind Home is open). */
function Whale({ card, onMake }: { card: boolean; onMake: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hello, setHello] = useState(() => {
    try {
      return localStorage.getItem(HELLO_KEY) !== "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const sea = run(canvas, still, () => {
      const box = canvas.parentElement?.querySelector(".lc-home-compose")?.getBoundingClientRect();
      if (!box || !box.height) return null;
      const top = canvas.getBoundingClientRect().top;
      return { top: box.top - top, bottom: box.bottom - top };
    });
    const home = canvas.parentElement!;
    const at = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top] as const;
    };
    const move = (e: PointerEvent) => onWater(e.target) && sea.move(...at(e));
    const down = (e: PointerEvent) => e.button === 0 && onWater(e.target) && sea.poke(...at(e));
    home.addEventListener("pointermove", move);
    home.addEventListener("pointerdown", down);
    return () => {
      sea.stop();
      home.removeEventListener("pointermove", move);
      home.removeEventListener("pointerdown", down);
    };
  }, []);
  const seen = () => {
    setHello(false);
    try {
      localStorage.setItem(HELLO_KEY, "1");
    } catch {
      // storage is off: it shows again next time
    }
  };
  return (
    <>
      <canvas ref={ref} className="lc-sea" aria-hidden />
      {hello && card && (
        <div className="lc-sea-hello" role="status">
          <span className="lc-sea-hello-mark" aria-hidden />
          <span className="lc-sea-hello-words" title="Move through the water to stir it, click for bubbles, or click the whale to make it blow.">
            A whale swims here
          </span>
          {/* None of these closes the card: only its × does. Turned off, the sea and the card go together, and come back together. */}
          <button type="button" className="lc-sea-hello-act" onClick={onMake}>
            Make your own
          </button>
          <button type="button" className="lc-sea-hello-act" onClick={() => (updateLook({ home: "none" }), toast("The whale is off", { description: "Settings, Appearance brings it back." }))}>
            Turn off
          </button>
          <button type="button" className="lc-sea-hello-act" onClick={() => window.dispatchEvent(new CustomEvent("lc:open-settings", { detail: "appearance" }))}>
            Settings
          </button>
          <button type="button" className="lc-sea-hello-x" aria-label="Close this for good, and keep the whale" title="Close" onClick={seen}>
            <I.close size={12} />
          </button>
        </div>
      )}
    </>
  );
}
