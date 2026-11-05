// The renderer for the sea of code: one WebGL2 canvas, moved into whichever stage is on screen
// (the hero, the 404, the footer's horizon tile). Runs on GSAP's ticker; nothing here owns a loop.
import { gsap } from 'gsap';
import { FRAG, MAX_RIPPLES, VERT } from './shader';
import code from '../data/code.json';

export type Camera = { height: number; back: number; pitch: number; fovY: number; fovX?: number };
type Ripple = { id: number; x: number; y: number; r: number; w: number; tween?: gsap.core.Tween; rows: number };

const RS = 26;
const ROW = 0.11;
const MAX_R = 30;

const hu = (x: number) => {
  x >>>= 0;
  x = (x ^ (x >>> 16)) >>> 0; x = Math.imul(x, 0x7feb352d) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0; x = Math.imul(x, 0x846ca68b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x;
};
/** Mirrors picked() in the shader: does turn `id` rewrite `row`? */
const picked = (row: number, id: number) => (hu((Math.imul(row, 1973) + Math.imul(id, 9277)) >>> 0) & 1023) < 430;

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
const v3 = {
  sub: (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  dot: (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  norm: (a: number[]) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  cross: (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
};

export class Sea {
  canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private prog!: WebGLProgram;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private rowGen = new Uint8Array(512);
  private rowTex!: WebGLTexture;
  private ripples: Ripple[] = [];
  private history: Ripple[] = [];
  private nextId = 1;
  private cam: Camera = { height: 3.2, back: 4.2, pitch: 0.55, fovY: 0.84 };
  private basis = { pos: [0, 0, 0], right: [1, 0, 0], up: [0, 1, 0], fwd: [0, 0, -1], tx: 1, ty: 1 };
  private pointer = { x: 0, y: 0, s: 0, target: 0 };
  private scale = 1;
  private frameTimes: number[] = [];
  quiet = 0;
  /** The window the sea parts for, in drawing-buffer px (y from the bottom): centre, half sizes; its
   *  corner; dome units per px; how open (0 the sea is whole). */
  win: [number, number, number, number] = [0, 0, 0, 0];
  winR = 0;
  pxQ = 0.01;
  grow = 0;
  /** 0 the blue sea on paper, 1 the night sea. */
  dark = 0;
  time = 12;
  frozen = false;
  onChange?: (added: number, removed: number) => void;

  static create(): Sea | null {
    const canvas = document.createElement('canvas');
    canvas.className = 'sea-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: true, alpha: true, powerPreference: 'high-performance' });
    if (!gl) return null;
    try { return new Sea(canvas, gl); } catch (e) { console.warn('Sea: no WebGL2 program', e); return null; }
  }

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    this.scale = Math.min(devicePixelRatio || 1, matchMedia('(max-width: 767px)').matches ? 1.5 : 1.75);
    this.program();
    this.textures();
  }

  private program() {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
    this.prog = p;
    gl.useProgram(p);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(p, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const name of ['uRes', 'uCamPos', 'uCamRight', 'uCamUp', 'uCamFwd', 'uTan', 'uRs', 'uTime', 'uQuiet', 'uWin', 'uWinR', 'uPxQ', 'uGrow', 'uDark', 'uHorizon', 'uAtlas', 'uLines',
      'uRowGen', 'uLineCount', 'uRip', 'uRipId', 'uRipCount', 'uPointer', 'uPaper', 'uTide', 'uDeep', 'uInk']) {
      this.u[name] = gl.getUniformLocation(p, name);
    }
    gl.uniform1f(this.u.uRs, RS);
    gl.uniform3fv(this.u.uPaper, hex('#F4EBDC'));
    gl.uniform3fv(this.u.uTide, hex('#2557E3'));
    gl.uniform3fv(this.u.uDeep, hex('#0B33B4'));
    gl.uniform3fv(this.u.uInk, hex('#0B0E1C'));
  }

  private textures() {
    const gl = this.gl;
    // Glyph atlas: Geist Mono, 16 x 6 cells of 64 x 107 px (the cell's shape is the shader's CELL:ROW).
    const cw = 64, chh = 107;
    const atlas = document.createElement('canvas');
    atlas.width = cw * 16; atlas.height = chh * 6;
    const g = atlas.getContext('2d')!;
    g.fillStyle = '#000'; g.fillRect(0, 0, atlas.width, atlas.height);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.font = '500 76px "Geist Mono", ui-monospace, monospace';
    for (let k = 0; k < 95; k++) {
      const x = (k % 16) * cw + cw / 2, y = Math.floor(k / 16) * chh + chh * 0.74;
      g.fillText(String.fromCharCode(32 + k), x, y);
    }
    const tex = (unit: number) => { const t = gl.createTexture()!; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); return t; };
    tex(0);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, atlas);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const ext = gl.getExtension('EXT_texture_filter_anisotropic');
    if (ext) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    gl.uniform1i(this.u.uAtlas, 0);

    // The lines: char code and token class per cell; the length in column 135.
    const lines = code as { t: string; c: string }[];
    const W = 136, H = lines.length;
    const data = new Uint8Array(W * H * 2);
    lines.forEach((l, y) => {
      for (let x = 0; x < Math.min(l.t.length, 132); x++) {
        data[(y * W + x) * 2] = l.t.charCodeAt(x);
        data[(y * W + x) * 2 + 1] = +l.c[x];
      }
      data[(y * W + 135) * 2] = Math.min(l.t.length, 132);
    });
    tex(1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8UI, W, H, 0, gl.RG_INTEGER, gl.UNSIGNED_BYTE, data);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    gl.uniform1i(this.u.uLines, 1);
    gl.uniform1i(this.u.uLineCount, H);

    this.rowTex = tex(2);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, 512, 1, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, this.rowGen);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    gl.uniform1i(this.u.uRowGen, 2);
  }

  private uploadRows() {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.rowTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 512, 1, gl.RED_INTEGER, gl.UNSIGNED_BYTE, this.rowGen);
  }

  /** Drawing-buffer px per CSS px, as the last frame was drawn. */
  get density() { return this.canvas.width / Math.max(1, this.canvas.clientWidth); }

  /** Size the drawing buffer to the canvas's box. */
  resize() {
    const w = Math.max(1, this.canvas.clientWidth), h = Math.max(1, this.canvas.clientHeight);
    const W = Math.round(w * this.scale), H = Math.round(h * this.scale);
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
  }

  setCamera(c: Camera) {
    this.cam = c;
    const w = Math.max(1, this.canvas.clientWidth), h = Math.max(1, this.canvas.clientHeight);
    const aspect = w / h;
    let ty = Math.tan(c.fovY / 2), tx = ty * aspect;
    if (c.fovX) { const mx = Math.tan(c.fovX / 2); if (tx < mx) { tx = mx; ty = tx / aspect; } }
    // The camera sits on a meridian behind the pole, `height` above the surface under it.
    const a = c.back / RS;
    const pos = [0, (RS + c.height) * Math.cos(a) - RS, (RS + c.height) * Math.sin(a)];
    const fwd = v3.norm([0, -Math.sin(c.pitch), -Math.cos(c.pitch)]);
    const ref = Math.abs(fwd[1]) > 0.999 ? [0, 0, -1] : [0, 1, 0];
    const right = v3.norm(v3.cross(fwd, ref));
    const up = v3.cross(right, fwd);
    this.basis = { pos, right, up, fwd, tx, ty };
  }

  /** Pitch that puts the horizon at `frac` of the view's height (0 bottom, 1 top), for a camera. */
  static pitchFor(c: Omit<Camera, 'pitch'>, frac: number, aspect: number) {
    let ty = Math.tan(c.fovY / 2);
    if (c.fovX) { const mx = Math.tan(c.fovX / 2); if (ty * aspect < mx) ty = mx / aspect; }
    const dip = Math.acos(RS / (RS + c.height)) - c.back / RS; // the limb's angle below level, seen from behind the pole
    return dip + Math.atan((2 * frac - 1) * ty);
  }

  /** Where a point on screen meets the dome, in q coordinates (null on the sky). */
  ray(clientX: number, clientY: number) {
    const r = this.canvas.getBoundingClientRect();
    const nx = ((clientX - r.left) / r.width) * 2 - 1;
    const ny = 1 - ((clientY - r.top) / r.height) * 2;
    const { pos, right, up, fwd, tx, ty } = this.basis;
    const d = v3.norm([0, 1, 2].map((i) => fwd[i] + nx * tx * right[i] + ny * ty * up[i]));
    const oc = [pos[0], pos[1] + RS, pos[2]];
    const b = v3.dot(oc, d), c = v3.dot(oc, oc) - RS * RS, disc = b * b - c;
    if (disc <= 0) return null;
    const t = -b - Math.sqrt(disc);
    if (t <= 0) return null;
    const P = [pos[0] + d[0] * t, pos[1] + d[1] * t, pos[2] + d[2] * t];
    const n = v3.norm([P[0], P[1] + RS, P[2]]);
    const ang = Math.acos(Math.max(-1, Math.min(1, n[1])));
    const l = Math.hypot(n[0], n[2]) || 1e-6;
    return { x: (n[0] / l) * RS * ang, y: (n[2] / l) * RS * ang };
  }

  /** Where a point on the dome (in q coordinates, at a height) lands in the canvas box, in CSS px. */
  project(qx: number, qy: number, height = 0) {
    const r = Math.hypot(qx, qy), a = r / RS;
    const dir = r > 1e-6 ? [qx / r, qy / r] : [0, 0];
    const n = [dir[0] * Math.sin(a), Math.cos(a), dir[1] * Math.sin(a)];
    const P = [n[0] * (RS + height), n[1] * (RS + height) - RS, n[2] * (RS + height)];
    const { pos, right, up, fwd, tx, ty } = this.basis;
    const v = v3.sub(P, pos);
    const z = v3.dot(v, fwd);
    const x = v3.dot(v, right) / z / tx, y = v3.dot(v, up) / z / ty;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    return { x: (x + 1) / 2 * w, y: (1 - (y + 1) / 2) * h, z };
  }

  /** How many rows a turn reaches: every row inside the limb. */
  private visibleRows() {
    const lim = RS * Math.acos(RS / (RS + this.cam.height)) + this.cam.back;
    return Math.min(511, Math.ceil(lim / ROW));
  }

  setPointer(clientX: number, clientY: number, on: boolean) {
    const q = on ? this.ray(clientX, clientY) : null;
    if (q) { this.pointer.x = q.x; this.pointer.y = q.y; }
    this.pointer.target = q ? 1 : 0;
    return !!q;
  }

  /** Send a turn from a point on screen; on the sky (or with no point) it starts at your feet. */
  ripple(clientX?: number, clientY?: number) {
    const q = clientX === undefined ? null : this.ray(clientX, clientY!);
    const at = q ?? { x: 0, y: 0 };
    const id = this.nextId++;
    const max = this.visibleRows();
    let rows = 0;
    for (let i = 0; i < max; i++) if (picked(i, id)) rows++;
    const rip: Ripple = { id, x: at.x, y: at.y, r: 0, w: 1, rows };
    this.history.push(rip);
    this.onChange?.(rows, rows);
    if (this.frozen) { this.settle(rip); return rip; }
    if (this.ripples.length >= MAX_RIPPLES) this.settle(this.ripples[0]);
    this.ripples.push(rip);
    rip.tween = gsap.to(rip, { r: MAX_R, duration: 11, ease: 'power1.out', onComplete: () => this.settle(rip) });
    gsap.fromTo(rip, { w: 1 }, { w: 0, duration: 11, ease: 'sine.in' });
    return rip;
  }

  private settle(rip: Ripple) {
    rip.tween?.kill();
    gsap.killTweensOf(rip);
    const i = this.ripples.indexOf(rip);
    if (i >= 0) this.ripples.splice(i, 1);
    for (let row = 0; row < 512; row++) if (picked(row, rip.id)) this.rowGen[row] = (this.rowGen[row] + 1) & 255;
    this.uploadRows();
  }

  /** Take the last turn back: its ripple runs home and the old lines return. */
  undo() {
    const rip = this.history.pop();
    if (!rip) return false;
    this.onChange?.(-rip.rows, -rip.rows);
    const active = this.ripples.includes(rip);
    if (!active) {
      for (let row = 0; row < 512; row++) if (picked(row, rip.id)) this.rowGen[row] = (this.rowGen[row] - 1) & 255;
      this.uploadRows();
      if (this.frozen) return true;
      rip.r = MAX_R; rip.w = 0.7;
      if (this.ripples.length >= MAX_RIPPLES) this.settle(this.ripples[0]);
      this.ripples.push(rip);
    } else {
      rip.tween?.kill();
      gsap.killTweensOf(rip);
    }
    if (this.frozen) { this.ripples.splice(this.ripples.indexOf(rip), 1); return true; }
    gsap.to(rip, { w: 0.9, duration: 0.4, ease: 'power2.out' });
    rip.tween = gsap.to(rip, {
      r: 0, duration: active ? 1.8 : 2.4, ease: 'power3.inOut',
      onComplete: () => { const i = this.ripples.indexOf(rip); if (i >= 0) this.ripples.splice(i, 1); },
    });
    return true;
  }

  get turns() { return this.history.length; }

  render(dt: number) {
    const gl = this.gl;
    this.resize();
    if (!this.frozen) this.time += dt;
    this.pointer.s += (this.pointer.target - this.pointer.s) * Math.min(1, dt * 6);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.prog);
    const { pos, right, up, fwd, tx, ty } = this.basis;
    gl.uniform2f(this.u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform3fv(this.u.uCamPos, pos);
    gl.uniform3fv(this.u.uCamRight, right);
    gl.uniform3fv(this.u.uCamUp, up);
    gl.uniform3fv(this.u.uCamFwd, fwd);
    gl.uniform2f(this.u.uTan, tx, ty);
    gl.uniform1f(this.u.uTime, this.time);
    gl.uniform1f(this.u.uQuiet, this.quiet);
    gl.uniform4fv(this.u.uWin, this.win);
    gl.uniform1f(this.u.uWinR, this.winR);
    gl.uniform1f(this.u.uPxQ, this.pxQ);
    gl.uniform1f(this.u.uGrow, this.grow);
    gl.uniform1f(this.u.uDark, this.dark);
    gl.uniform1f(this.u.uHorizon, Math.sqrt((RS + this.cam.height) ** 2 - RS * RS) + 0.5);
    gl.uniform3f(this.u.uPointer, this.pointer.x, this.pointer.y, this.pointer.s);
    const rip = new Float32Array(MAX_RIPPLES * 4), ids = new Int32Array(MAX_RIPPLES);
    this.ripples.forEach((r, i) => { rip.set([r.x, r.y, r.r, r.w], i * 4); ids[i] = r.id; });
    gl.uniform4fv(this.u.uRip, rip);
    gl.uniform1iv(this.u.uRipId, ids);
    gl.uniform1i(this.u.uRipCount, this.ripples.length);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.adapt(dt);
  }

  // Hold the frame rate: if frames run long, draw fewer pixels.
  private adapt(dt: number) {
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 50) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    if (avg > 0.024 && this.scale > 0.7) this.scale = Math.max(0.7, this.scale * 0.82);
  }
}
