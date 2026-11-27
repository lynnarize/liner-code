/*
  The paper's halftone in Home's top right corner, alive: the same round dots on a 6px grid in the
  action colour, thinning from the corner along a quarter circle, but their edge drifts like a
  cloud, a slow swell runs out from the corner every dozen seconds, and the dots near the pointer
  grow a little, then settle when it leaves.

  It has to cost next to nothing, so the GPU draws it: one WebGL canvas, one rectangle, and a small
  fragment shader that works out each dot's size from where it is and the time. A frame is a handful
  of uniforms and one draw call for the script (well under a millisecond), and the drawing is a few
  million very simple pixels for the GPU. Each frame still makes Chromium put the window together
  again, which is most of the cost (about 3 ms of CPU a frame across its processes), so it draws as
  few as look smooth: 20 a second for the drift, 30 only while the pointer swells it, and none at all
  while the window isn't the one in use, is hidden, or Home is out of sight. Its clock stops with
  it, so it carries on from where it was instead of jumping. Reduce motion draws one still frame.
  Without WebGL (or when the context is lost) the caller falls back to the halftone in CSS
  (halftone.css, .lc-ht-corner), which looks the same, still. The numbers and the shader are in tide.ts.
*/

import { TIDE_ALPHA, TIDE_SHADER, TIDE_STEP_MAX, VERTEX, ease, tideGap } from "./tide";

type RGB = [number, number, number];
let probe: CanvasRenderingContext2D | null = null;
/** The element's CSS colour as red, green and blue from 0 to 1, read back from one pixel (it may be an oklch() the shader can't take). */
function colourOf(el: Element): RGB {
  probe ??= Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", { willReadFrequently: true });
  if (!probe) return [0.85, 0.2, 0.15];
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "#d33";
  probe.fillStyle = getComputedStyle(el).color;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
  return [r / 255, g / 255, b / 255];
}

function compile(gl: WebGLRenderingContext, kind: number, text: string) {
  const s = gl.createShader(kind);
  if (!s) return null;
  gl.shaderSource(s, text);
  gl.compileShader(s);
  return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
}

/**
  Runs the tide on `canvas` (its CSS colour is the ink). `home` is where the pointer is followed,
  and `onPaper` says whether a move landed on the paper rather than on something to use. Returns
  null when WebGL can't be had, so the caller shows the CSS halftone; `onLost` is called if the
  context goes later, for the same.
*/
export function startTide(canvas: HTMLCanvasElement, home: HTMLElement, onPaper: (target: EventTarget | null) => boolean, onLost: () => void) {
  const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: "low-power" });
  if (!gl) return null;
  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fs = compile(gl, gl.FRAGMENT_SHADER, TIDE_SHADER);
  const prog = gl.createProgram();
  if (!vs || !fs || !prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  // One rectangle over the whole canvas, as two triangles.
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const a = gl.getAttribLocation(prog, "a");
  gl.enableVertexAttribArray(a);
  gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
  const u = (name: string) => gl.getUniformLocation(prog, name);
  const uSize = u("uSize");
  const uDpr = u("uDpr");
  const uTime = u("uTime");
  const uInk = u("uInk");
  const uAlpha = u("uAlpha");
  const uPointer = u("uPointer");
  gl.uniform1f(uAlpha, TIDE_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  const reduced = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  // The tide's own clock, in seconds, which runs only while it draws. Started part of the way through, so the first
  // frame is already a drifted one, not the plain falloff.
  let clock = 40;
  let W = 0;
  let H = 0;
  let dpr = 1;
  let seen = true;
  let timer = 0;
  let raf = 0;
  let last = 0;
  let lost = false;
  // The pointer as drawn (eased toward where it is) and how strongly it swells, 0 to 1.
  const aim = { x: 0, y: 0, on: 0 };
  const at = { x: 0, y: 0, on: 0 };

  const resize = () => {
    const r = canvas.getBoundingClientRect();
    W = r.width;
    H = r.height;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  const ink = () => gl.uniform3f(uInk, ...colourOf(canvas));
  const draw = (now: number) => {
    if (lost || W < 1 || H < 1) return;
    const still = !!reduced?.matches;
    const dt = last ? Math.min(TIDE_STEP_MAX, Math.max(0, now - last) / 1000) : 0;
    last = now;
    if (still) at.on = 0;
    else {
      clock += dt;
      at.x = ease(at.x, aim.x, dt, 9);
      at.y = ease(at.y, aim.y, dt, 9);
      at.on = ease(at.on, aim.on, dt, aim.on > at.on ? 3 : 1.6);
    }
    gl.uniform2f(uSize, canvas.width / dpr, canvas.height / dpr);
    gl.uniform1f(uDpr, dpr);
    gl.uniform1f(uTime, still ? 40 : clock);
    gl.uniform3f(uPointer, at.x, at.y, at.on);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };
  // Between frames it sleeps on a timer rather than waking every display refresh only to skip it.
  const frame = (now: number) => {
    raf = 0;
    draw(now);
    kick();
  };
  const kick = () => {
    if (timer || raf || lost) return;
    const gap = tideGap({ hidden: document.hidden, seen, reduced: !!reduced?.matches, focused: document.hasFocus(), touched: aim.on > 0 || at.on > 0.01 });
    if (gap === null) return;
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
  /** One frame now (a resize, a new colour, Reduce motion turned on), then the clock again. */
  const once = () => {
    pause();
    draw(performance.now());
    kick();
  };

  const ro = new ResizeObserver(() => (resize(), once()));
  ro.observe(canvas);
  // Out of sight (another face, a panel over Home): no frames.
  const io = new IntersectionObserver((e) => {
    seen = e.some((x) => x.isIntersecting);
    if (seen) kick();
    else pause();
  });
  io.observe(canvas);
  // The theme, the accent or a theme of your own changed the colour: the page's root says so.
  const mo = new MutationObserver(() => requestAnimationFrame(() => (ink(), once())));
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class", "data-theme"] });
  const onVisible = () => (document.hidden ? pause() : (last = 0, kick()));
  const onFocus = () => kick();
  const onMove = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    aim.x = e.clientX - r.left;
    aim.y = e.clientY - r.top;
    // The swell grows only on the paper, not over the message box or a button.
    aim.on = onPaper(e.target) ? 1 : 0;
    if (at.on < 0.01 && aim.on) (at.x = aim.x), (at.y = aim.y);
  };
  const onLeave = () => (aim.on = 0);
  const onMotion = () => once();
  // The GPU took the context back (a driver reset, too many contexts): the CSS halftone takes over.
  const lostHandler = (e: Event) => {
    e.preventDefault();
    lost = true;
    pause();
    onLost();
  };
  canvas.addEventListener("webglcontextlost", lostHandler);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", onFocus);
  home.addEventListener("pointermove", onMove, { passive: true });
  home.addEventListener("pointerleave", onLeave);
  reduced?.addEventListener("change", onMotion);
  resize();
  ink();
  once();

  return {
    stop() {
      pause();
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
      canvas.removeEventListener("webglcontextlost", lostHandler);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onFocus);
      home.removeEventListener("pointermove", onMove);
      home.removeEventListener("pointerleave", onLeave);
      reduced?.removeEventListener("change", onMotion);
      // The context isn't lost on purpose here: the same canvas can be started again (React runs an effect twice in
      // development), and a lost context would put it on the still halftone. It goes with the canvas.
    },
  };
}
