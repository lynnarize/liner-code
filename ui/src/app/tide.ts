/*
  The numbers and the shader behind Home's drifting corner (homeTide.ts runs them on the page): kept apart, with
  nothing of the browser in them, so the engine's tests can hold them.
*/

/** The grid, in CSS pixels: the CSS halftone's .lc-ht-big. */
export const TIDE_CELL = 6;
/** How much of the dots shows over the paper: the CSS halftone's .lc-ht-faint. */
export const TIDE_ALPHA = 0.22;
/** How often it draws, in milliseconds: the drift is slow enough for 20 a second; the pointer's swell answers a hand, so 30. */
export const TIDE_FRAME_MS = { drift: 1000 / 20, touch: 1000 / 30 };
/** The longest step the clock takes between two frames, in seconds: after a pause it carries on rather than jumping. */
export const TIDE_STEP_MAX = 0.1;

/** When the next frame comes, in milliseconds from the last one; null when none should (hidden, out of sight, not the window in use, or Reduce motion). */
export function tideGap(s: { hidden: boolean; seen: boolean; reduced: boolean; focused: boolean; touched: boolean }): number | null {
  if (s.hidden || !s.seen || s.reduced || !s.focused) return null;
  return s.touched ? TIDE_FRAME_MS.touch : TIDE_FRAME_MS.drift;
}

/** Eases a value toward its target over `dt` seconds, at `rate` per second, the same at any frame rate. */
export const ease = (from: number, to: number, dt: number, rate: number) => from + (to - from) * (1 - Math.exp(-dt * rate));

export const VERTEX = `
attribute vec2 a;
void main() { gl_Position = vec4(a, 0.0, 1.0); }
`;

/*
  Per pixel: which dot it belongs to, how much ink that dot carries, and whether the pixel is inside
  it (with a soft half-pixel edge). The ink is the corner's falloff with its edge pushed in and out
  by two octaves of gradient noise, a broad band running outward, and the pointer's swell; it's
  always nothing at the canvas's own edges, so the drift never meets a straight cut.
*/
export const TIDE_SHADER = `
precision highp float;
uniform vec2 uSize;
uniform float uDpr;
uniform float uTime;
uniform vec3 uInk;
uniform float uAlpha;
uniform vec3 uPointer;
const float CELL = ${TIDE_CELL.toFixed(1)};

vec2 hash(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453) * 2.0 - 1.0;
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(dot(hash(i), f), dot(hash(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
             mix(dot(hash(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)), dot(hash(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, uSize.y * uDpr - gl_FragCoord.y) / uDpr;
  vec2 c = (floor(px / CELL) + 0.5) * CELL;
  float d = length(vec2((uSize.x - c.x) / uSize.x, c.y / uSize.y));
  float t = uTime;
  vec2 n = c / 150.0 + vec2(t * 0.045, -t * 0.03);
  float drift = noise(n) * 0.65 + noise(n * 2.1 + vec2(7.3, 1.9) - vec2(t * 0.02, 0.0)) * 0.35;
  float v = 1.0 - smoothstep(0.04, 0.92, d + drift * 0.22);
  float swell = sin(d * 8.0 - t * 0.55);
  v += 0.16 * swell * swell * swell * smoothstep(0.0, 0.35, v) * (1.0 - v * 0.6);
  float pd = length(c - uPointer.xy);
  v += uPointer.z * 0.5 * exp(-pd * pd / 9800.0);
  v *= 1.0 - smoothstep(0.78, 1.0, d);
  v = clamp(v, 0.0, 1.0);
  float r = CELL * 0.49 * sqrt(v);
  float aa = 0.6 / uDpr;
  float inside = 1.0 - smoothstep(r - aa, r + aa, length(px - c));
  float a = inside * smoothstep(0.015, 0.09, v) * uAlpha * (0.8 + 0.35 * v);
  gl_FragColor = vec4(uInk * a, a);
}
`;
