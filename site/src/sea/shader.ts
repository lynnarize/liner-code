// The sea of code. A dome of paper seen from a camera above it; every ring around the pole (where
// you stand) is one real line of Liner Code's source, set in Geist Mono and drifting along its ring.
// Bands of ultramarine flow outward from the middle. A ripple bends the rings it crosses, scrambles
// each line as its front passes and leaves the line rewritten behind it. Seen from overhead, the sea
// can part in the shape of the app's window (uWin, uGrow), the way pepper runs from a drop of soap:
// the rings are pushed out and bunch at a churning rim, and once it is open the water lies along the
// window's frame with the window's shadow on it.
// At night (uDark) every colour keeps its hue and turns its lightness over, in OKLab, so the bands
// stay blue, the paper goes to night and the code reads light on it.

export const VERT = /* glsl */ `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

export const MAX_RIPPLES = 8;

export const FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

uniform vec2 uRes;
uniform vec3 uCamPos;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamFwd;
uniform vec2 uTan;
uniform float uRs;
uniform float uTime;
uniform float uQuiet;
uniform vec4 uWin;           // the window's frame on screen, in drawing-buffer px: centre x, y (from the bottom), half w, h
uniform float uWinR;         // its corner radius, in px
uniform float uPxQ;          // dome units per px, overhead: to turn the frame's px into the sea's distances
uniform float uGrow;         // how far the sea has parted for it: 0 whole, 1 open to the frame
uniform float uDark;         // 0 the blue sea on paper, 1 the night sea
uniform float uHorizon;      // distance from the camera to the limb, for the haze
uniform sampler2D uAtlas;    // 16 x 6 cells, ASCII 32..126, white on black
uniform usampler2D uLines;   // RG8UI: char code, token class; texel (135, line) holds the length
uniform usampler2D uRowGen;  // R8UI: how many settled turns rewrote each row
uniform int uLineCount;
uniform vec4 uRip[${MAX_RIPPLES}];   // centre q.x, q.y, front radius, strength
uniform int uRipId[${MAX_RIPPLES}];
uniform int uRipCount;
uniform vec3 uPointer;       // q.x, q.y, strength
uniform vec3 uPaper;
uniform vec3 uTide;
uniform vec3 uDeep;
uniform vec3 uInk;
out vec4 frag;

const float ROW = 0.11;
const float CELL = 0.066;
const float BAND = 0.95;
const float CLEAR = 0.34;
const float TAU = 6.2831853;

uint hu(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
float h1(int a) { return float(hu(uint(a) * 747796405u + 2891336453u) & 65535u) / 65535.0; }
float h3(int a, int b, int c) { return float(hu(uint(a) * 1973u + hu(uint(b) * 9277u + uint(c) * 26699u)) & 65535u) / 65535.0; }
// Does the turn with this id rewrite this row? Mirrored in sea.ts (picked()).
bool picked(int row, int id) { return (hu(uint(row) * 1973u + uint(id) * 9277u) & 1023u) < 430u; }

// Value noise whose lattice wraps every w cells in x, for patterns that run round a ring.
float vnoiseW(vec2 p, float w) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  int x0 = int(mod(i.x, w)), x1 = int(mod(i.x + 1.0, w));
  float a = h3(x0, int(i.y), 7), b = h3(x1, int(i.y), 7);
  float c = h3(x0, int(i.y) + 1, 7), d = h3(x1, int(i.y) + 1, 7);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Night: lightness turned over in OKLab, hue kept. The darkest is a night blue, the lightest a soft paper,
// and neutrals lean a little toward the blue.
vec3 lin(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
vec3 srgb(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }
vec3 toLab(vec3 c) {
  vec3 lms = vec3(dot(c, vec3(0.4122214708, 0.5363325363, 0.0514459929)),
                  dot(c, vec3(0.2119034982, 0.6806995451, 0.1073969566)),
                  dot(c, vec3(0.0883024619, 0.2817188376, 0.6299787005)));
  lms = pow(max(lms, 0.0), vec3(1.0 / 3.0));
  return vec3(dot(lms, vec3(0.2104542553, 0.7936177850, -0.0040720468)),
              dot(lms, vec3(1.9779984951, -2.4285922050, 0.4505937099)),
              dot(lms, vec3(0.0259040371, 0.7827717662, -0.8086757660)));
}
vec3 fromLab(vec3 c) {
  vec3 lms = vec3(c.x + 0.3963377774 * c.y + 0.2158037573 * c.z,
                  c.x - 0.1055613458 * c.y - 0.0638541728 * c.z,
                  c.x - 0.0894841775 * c.y - 1.2914855480 * c.z);
  lms = lms * lms * lms;
  return vec3(dot(lms, vec3(4.0767416621, -3.3077115913, 0.2309699292)),
              dot(lms, vec3(-1.2684380046, 2.6097574011, -0.3413193965)),
              dot(lms, vec3(-0.0041960863, -0.7034186147, 1.7076147010)));
}
vec3 night(vec3 c) {
  vec3 lab = toLab(lin(c));
  float L = mix(0.16, 0.9, 1.0 - lab.x);
  float ch = length(lab.yz);
  vec2 ab = lab.yz * 1.08 + vec2(-0.006, -0.05) * (1.0 - smoothstep(0.0, 0.09, ch));
  return srgb(fromLab(vec3(L, ab)));
}

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = h3(int(i.x), int(i.y), 7), b = h3(int(i.x) + 1, int(i.y), 7);
  float c = h3(int(i.x), int(i.y) + 1, 7), d = h3(int(i.x) + 1, int(i.y) + 1, 7);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void main() {
  vec2 ndc = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  vec3 rd = normalize(uCamFwd + ndc.x * uTan.x * uCamRight + ndc.y * uTan.y * uCamUp);
  vec3 C = vec3(0.0, -uRs, 0.0);
  vec3 oc = uCamPos - C;
  float b = dot(oc, rd);
  float c = dot(oc, oc) - uRs * uRs;
  float disc = b * b - c;
  // The limb, antialiased in screen space.
  float edge = clamp(disc / max(fwidth(disc), 1e-6), 0.0, 1.0);
  if (disc <= 0.0) { frag = vec4(0.0); return; }
  float t = -b - sqrt(disc);
  if (t <= 0.0) { frag = vec4(0.0); return; }
  vec3 P = uCamPos + rd * t;
  vec3 n = normalize(P - C);
  float ang = acos(clamp(n.y, -1.0, 1.0));
  float len2 = max(length(n.xz), 1e-6);
  vec2 q = n.xz / len2 * (uRs * ang);          // azimuthal equidistant: distance along the dome

  // The sea breathes: a slow swell on the radius.
  float r0 = length(q);
  vec2 qd = q;
  qd *= 1.0 + 0.012 * sin(r0 * 1.7 - uTime * 0.7);

  // The pointer is a lens: the code under it reads a little larger.
  vec2 pv = qd - uPointer.xy;
  float pf = exp(-dot(pv, pv) / 1.1) * uPointer.z;
  qd = uPointer.xy + pv * (1.0 - 0.22 * pf);

  // Ripples bend the rings near their front.
  float front = 0.0, wake = 0.0, scramble = 0.0, swell = 0.0;
  int extra[${MAX_RIPPLES}];
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    extra[i] = 0;
    if (i >= uRipCount) break;
    vec4 R = uRip[i];
    vec2 dv = qd - R.xy;
    float d = length(dv);
    float x = d - R.z;
    // A wave train: one strong crest at the front and two echoes behind it, like water.
    float env = exp(-x * x / 1.8) * R.w * smoothstep(0.0, 1.2, R.z);
    float lead = exp(-x * x / 0.06) * R.w;
    float wave = sin(x * 7.5) * env * step(x, 0.35);
    qd += (dv / max(d, 1e-4)) * (wave * 0.085 + lead * 0.06);
    front = max(front, lead);
    swell += wave;
    if (x < 0.0) { extra[i] = 1; wake = max(wake, exp(x / 1.6) * R.w); }
    scramble = max(scramble, exp(-x * x / 0.16) * R.w);
  }

  // The parting, in the window's rounded shape. The shape is taken on screen, where the window is (on
  // the curved dome a rectangle's sides would bow), and turned into the sea's units for the rest; the
  // pointer's lens and the ripples never move its edge off the frame. While it opens the edge is
  // water, ragged and moving; open, it lies along the frame. Outside it the rings bunch up.
  float rimD = 1e9, holeA = 1.0, fringe = 0.0;
  if (uGrow > 0.0) {
    vec2 hs = uWin.zw * uGrow;
    float rr = min(uWinR, min(hs.x, hs.y));
    vec2 dp = gl_FragCoord.xy - uWin.xy;
    vec2 a = abs(dp) - (hs - rr);
    float sdp = length(max(a, 0.0)) + min(max(a.x, a.y), 0.0) - rr;
    vec2 np = max(a.x, a.y) > 0.0 ? normalize(max(a, 0.0) + 1e-6) * sign(dp) : (a.x > a.y ? vec2(sign(dp.x), 0.0) : vec2(0.0, sign(dp.y)));
    vec2 nrm = vec2(np.x, -np.y);              // screen up is the dome's -y overhead
    vec2 dq = dp * uPxQ;
    float sd = sdp * uPxQ;
    float rag = (vnoise(dq * 2.4 + vec2(uTime * 0.25, 4.0)) - 0.5) * 0.5 + (vnoise(dq * 7.0 + vec2(1.0, uTime * 0.4)) - 0.5) * 0.2;
    float open = 1.0 - uGrow;
    float born = smoothstep(0.0, 0.08, uGrow);  // the first and last of it ease, never pop
    rimD = sd - rag * 0.6 * open * open * born;
    holeA = smoothstep(-0.5, 0.5, rimD / uPxQ);
    float push = (0.3 + 1.1 * open) * exp(-max(rimD, 0.0) / 1.1) * born;
    qd -= nrm * push;
    scramble = max(scramble, exp(-rimD * rimD / 0.05) * holeA * mix(1.0, 0.3, uGrow));
  }

  float r = length(qd);
  float rf = r / ROW;
  int row = int(floor(rf));
  float fy = fract(rf);

  // Which line this row shows: the settled rewrites plus the turns whose front has passed it.
  int gen = int(texelFetch(uRowGen, ivec2(row & 511, 0), 0).r);
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    if (i >= uRipCount) break;
    if (extra[i] == 1 && picked(row, uRipId[i])) gen += 1;
  }
  int line = (row + 41 * gen) % uLineCount;

  // Cells along the ring: a whole number of them, so the ring closes on itself.
  float rc = (float(row) + 0.5) * ROW;
  float circ = TAU * uRs * sin(rc / uRs);
  float cells = max(floor(circ / CELL), 6.0);
  float dir = (row % 2 == 0) ? 1.0 : -1.0;
  float speed = dir * (0.05 + 0.09 * h1(row));
  float theta = -atan(qd.y, qd.x) / TAU + 0.5;
  float ux = fract(theta + uTime * speed / circ) * cells;
  int col = int(floor(ux));
  float fx = fract(ux);

  // Analytic gradients (atan jumps at the seam; these don't).
  vec2 gx = dFdx(qd), gy = dFdy(qd);
  float qq = max(dot(qd, qd), 1e-6);
  float dthx = -(qd.x * gx.y - qd.y * gx.x) / qq / TAU;
  float dthy = -(qd.x * gy.y - qd.y * gy.x) / qq / TAU;
  vec2 gradX = vec2(dthx * cells, dFdx(rf)) / vec2(16.0, 6.0);
  vec2 gradY = vec2(dthy * cells, dFdy(rf)) / vec2(16.0, 6.0);

  int llen = int(texelFetch(uLines, ivec2(135, line), 0).r);
  int period = llen + 5;
  int cc = col % period;
  int ch = 32, cls = 0;
  if (cc < llen) {
    uvec2 v = texelFetch(uLines, ivec2(cc, line), 0).rg;
    ch = int(v.r); cls = int(v.g);
  }
  // The front scrambles what it crosses.
  if (scramble > 0.02 && h3(row, col, int(uTime * 18.0)) < scramble * 0.85) {
    ch = 33 + int(h3(col, row, int(uTime * 18.0) + 3) * 93.0);
  }
  float glyph = 0.0;
  if (ch > 32 && r > CLEAR) {
    int k = ch - 32;
    vec2 cell = vec2(float(k % 16), float(k / 16));
    vec2 uv = (cell + vec2(fx, fy)) / vec2(16.0, 6.0);
    glyph = textureGrad(uAtlas, uv, gradX, gradY).r;
  }

  // Bands: ultramarine flowing outward, their edges brushed.
  float brush = vnoiseW(vec2(theta * 260.0, r * 2.2), 260.0) * 0.12 + vnoiseW(vec2(theta * 36.0, r * 0.6), 36.0) * 0.22;
  float bc = r / BAND - uTime * 0.045 + brush;
  float s = sin(bc * TAU);
  float dense = smoothstep(0.12, 0.5, s);
  float inner = smoothstep(CLEAR, CLEAR + 0.9, r);
  dense *= inner;

  vec3 bandBg = mix(uPaper, uTide, 0.9);
  vec3 bg = mix(uPaper, bandBg, dense);
  vec3 ink = cls == 1 ? uDeep : cls == 2 ? mix(uTide, uPaper, 0.22) : cls == 3 ? mix(uTide, uPaper, 0.5) : cls == 4 ? mix(uTide, uPaper, 0.15) : uTide;
  vec3 inkDense = cls == 3 ? mix(uPaper, uTide, 0.45) : mix(uPaper, vec3(1.0), 0.25);
  vec3 g = mix(ink, inkDense, dense);
  // Freshly written lines are darker for a moment, the front darkest of all.
  g = mix(g, dense > 0.5 ? uPaper : uInk, clamp(wake * 0.55 + front * 0.5, 0.0, 0.85));
  g = mix(g, uInk, pf * 0.55 * (1.0 - dense));
  float a = glyph * mix(0.9, 1.0, dense);
  vec3 col3 = mix(bg, g, a);
  // Crests catch the light, troughs fall into shade.
  float sw = clamp(swell, -1.0, 1.0);
  col3 = mix(col3, mix(uPaper, vec3(1.0), 0.6), max(sw, 0.0) * 0.24);
  col3 = mix(col3, uDeep, max(-sw, 0.0) * 0.2);
  col3 = mix(col3, mix(uDeep, uInk, 0.35), front * 0.5);

  // The figure's shadow, thrown forward and to the right.
  vec2 sh = (q - vec2(0.16, 0.035)) * vec2(5.5, 22.0);
  col3 *= 1.0 - 0.32 * exp(-dot(sh, sh));
  vec2 sh2 = q * vec2(16.0, 26.0);
  col3 *= 1.0 - 0.45 * exp(-dot(sh2, sh2));

  // Haze toward the limb, like the light on a far field.
  float haze = smoothstep(0.45, 1.0, t / uHorizon);
  col3 = mix(col3, mix(uPaper, vec3(1.0), 0.35), haze * 0.55);

  // Quiet: the sea settles into paper.
  vec3 calm = mix(uPaper, ink, glyph * 0.16 * inner);
  col3 = mix(col3, calm, uQuiet);

  // The rim of the parting: a dark line of bunched code, then foam, after the quiet so it holds.
  if (uGrow > 0.0) {
    float dO = max(rimD, 0.0);
    float line = exp(-dO * dO / 0.0016);
    float foam = exp(-dO / mix(0.16, 0.08, uGrow)) * (0.5 + 0.5 * vnoise(q * 14.0 + vec2(uTime * 0.6, 0.0)));
    line *= mix(1.0, 0.0, uGrow);              // open, the frame's own edge is the line
    float shade = exp(-dO / 0.9);
    col3 = mix(col3, mix(uPaper, vec3(1.0), 0.7), foam * 0.75);
    col3 = mix(col3, mix(uDeep, uPaper, 0.12), shade * 0.18);
    col3 = mix(col3, mix(uDeep, uInk, 0.3), line * 0.85);
  }
  vec3 under = mix(uDeep, uInk, 0.55);
  if (uDark > 0.0) { col3 = mix(col3, night(col3), uDark); under = mix(under, mix(uPaper, vec3(1.0), 0.3), uDark); }
  // The window's shadow on the water, below and around its frame: after the night, so it stays a shadow.
  // (q.y runs down the screen when the camera looks straight down.)
  if (uGrow > 0.0) {
    vec2 sp = gl_FragCoord.xy - uWin.xy + vec2(0.0, 0.18 / uPxQ);
    vec2 sa = abs(sp) - (uWin.zw - uWinR);
    float sds = (length(max(sa, 0.0)) + min(max(sa.x, sa.y), 0.0) - uWinR) * uPxQ;
    col3 *= 1.0 - exp(-max(sds, 0.0) / 0.45) * 0.55 * smoothstep(0.55, 1.0, uGrow);
  }
  float alpha = holeA + fringe * (1.0 - holeA);
  vec3 pre = col3 * holeA + under * fringe * (1.0 - holeA);

  frag = vec4(pre * edge, alpha * edge);
}
`;
