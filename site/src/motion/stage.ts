// The sea's driver. One canvas for the whole site, moved into the stage on screen; one variable
// per stage (the hero's scroll progress) decides the camera, the word, the figure, the quiet and,
// once the camera is overhead, the sea parting for the app's home window, which then lies on it.
import { gsap } from 'gsap';
import { SplitText } from 'gsap/SplitText';
import { Sea, type Camera } from '../sea/sea';
import { isTouch, onPage, prefersReducedMotion } from '../engine';

gsap.registerPlugin(SplitText);

let sea: Sea | null | undefined;
let drawn = false;
const getSea = () => {
  if (sea === undefined) {
    sea = Sea.create();
    if (sea) document.documentElement.classList.add('gl-on');
  }
  return sea;
};

type Stage = {
  el: HTMLElement;
  kind: string;
  slot: HTMLElement;
  word: HTMLElement | null;
  figure: HTMLElement | null;
  horizon: number; // px from the stage's top
  visible: boolean;
  progress: number;
  floor: HTMLElement | null; // under the sea: the app's home window
  grow: number;
};

// The hero's scroll, in phases. The camera tips overhead, then the sea parts for the window and
// stays open to its frame for the rest of the hero.
const PH = { tilt: 0.42, part: [0.46, 0.8] as const };
// The window's own frame inside its picture, as fractions of the picture, and its corner as a
// fraction of the picture's width. The picture is the window edge to edge (scripts/study-shot.mjs:
// 1360 wide, 12px corners); the sea draws its shadow.
const PAD = { l: 0, r: 0, t: 0, b: 0, corner: 12 / 1360 };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const fmt = (n: number) => (n < 0 ? `−${-n}` : `${n}`);

function baseCamera(st: Stage): Omit<Camera, 'pitch'> {
  const w = st.el.clientWidth, h = st.el.clientHeight;
  const portrait = w / h < 0.85;
  if (st.kind === 'tile') return { height: 2.6, back: 4.6, fovY: 0.62, fovX: 1.0 };
  return portrait ? { height: 3.0, back: 3.4, fovY: 0.98, fovX: 0.95 } : { height: 3.2, back: 4.2, fovY: 0.8, fovX: 1.2 };
}

function measure(st: Stage) {
  const h = st.el.clientHeight;
  let horizon = h * (st.kind === 'tile' ? 0.58 : 0.5);
  if (st.kind === 'hero') {
    const top = st.el.querySelector<HTMLElement>('[data-hero-top]');
    const word = st.word?.firstElementChild as HTMLElement | null;
    const topBottom = top ? top.offsetTop + top.offsetHeight : 0;
    const wordH = word ? word.offsetHeight : 0;
    // The word's box runs a quarter of its height under the horizon: count only what shows.
    horizon = Math.min(h * 0.62, Math.max(h * 0.46, topBottom + wordH * 0.7 + h * 0.03));
  } else if (st.kind === 'page') {
    horizon = h * 0.64;
  }
  st.horizon = horizon;
  st.el.style.setProperty('--horizon', `${horizon}px`);
}

function cameraFor(st: Stage): Camera {
  const base = baseCamera(st);
  const w = st.el.clientWidth, h = st.el.clientHeight;
  const frac = 1 - st.horizon / h;
  const pitch0 = Sea.pitchFor(base, frac, w / h);
  if (st.kind !== 'hero') return { ...base, pitch: pitch0 };
  const e = smooth(0, PH.tilt, st.progress);
  return {
    ...base,
    height: lerp(base.height, 7.2, e),
    back: lerp(base.back, 0.0001, e),
    pitch: lerp(pitch0, Math.PI / 2 - 0.0001, e),
  };
}

export function startStage() {
  const reduced = prefersReducedMotion();
  let stages: Stage[] = [];
  let active: Stage | null = null;
  let last = performance.now();

  const place = () => {
    const s = getSea();
    const next = stages.filter((st) => st.visible).sort((a, b) => (a.kind === 'hero' ? -1 : b.kind === 'hero' ? 1 : 0))[0] ?? null;
    if (!s || next === active) return;
    active = next;
    if (active && s.canvas.parentElement !== active.slot) active.slot.appendChild(s.canvas);
  };

  const figure = (st: Stage, s: Sea) => {
    if (!st.figure) return;
    const feet = s.project(0, 0, 0);
    const head = s.project(0, 0, 0.36);
    const side = Math.max(4, feet.y - head.y);
    const shoulder = s.project(0.09, 0, 0);
    const top = Math.max(6, Math.abs(shoulder.x - feet.x) * 2.6);
    const e = st.kind === 'hero' ? smooth(0.2, 0.33, st.progress) : 0;
    // The figure goes under as the sea parts at its feet.
    const under = st.kind === 'hero' ? smooth(0.44, 0.5, st.progress) : 0;
    gsap.set(st.figure, { x: feet.x, y: feet.y, '--side': side, '--top': top, '--sv': 1 - e, '--tv': e * (1 - under) });
  };

  const tick = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const s = getSea();
    if (!s || !active) return;
    const st = active;
    if (st.kind === 'hero') {
      const hero = st.el.parentElement!;
      const r = hero.getBoundingClientRect();
      const span = Math.max(1, hero.offsetHeight - innerHeight);
      st.progress = reduced ? 0 : clamp01(-r.top / span);
      applyHero(st);
    }
    s.quiet = st.kind === 'hero' ? smooth(0.3, 0.46, st.progress) * 0.55 : 0;
    // The night sea or the blue one, as <html data-sea> says; a change eases over, never cuts.
    const night = document.documentElement.dataset.sea === 'blue' ? 0 : 1;
    s.dark = reduced ? night : s.dark + (night - s.dark) * (1 - Math.exp(-dt * 4));
    s.setCamera(cameraFor(st));
    s.grow = st.kind === 'hero' ? part(st, s, dt) : 0;
    s.render(dt);
    if (!drawn) { drawn = true; document.documentElement.classList.add('sea-drawn'); }
    figure(st, s);
  };

  // The parting, in the window's shape: it opens from the middle to the window's frame (a pixel
  // wider, so the frame's edge is never cut), the radius following its target with a little lag, the
  // way water does. The frame is measured on screen each frame, so a resize keeps it in place.
  // Closing follows the scroll more closely than opening, and the sea is always whole again before
  // the camera starts to tip back: on a quick scroll up the window can't be left in the sky.
  const part = (st: Stage, s: Sea, dt: number) => {
    const p = st.progress;
    const target = st.floor && p > PH.part[0] ? 1 - (1 - smooth(PH.part[0], PH.part[1], p)) ** 2.2 : 0;
    st.grow += (target - st.grow) * (1 - Math.exp(-dt * (target < st.grow ? 12 : 6)));
    st.grow = Math.min(st.grow, smooth(PH.tilt, PH.part[0], p));
    if (target === 0 && st.grow < 0.002) st.grow = 0;
    if (target === 1 && st.grow > 0.998) st.grow = 1;
    const img = st.floor?.querySelector('img');
    if (!st.floor || !img) return 0;
    const shown = st.grow > 0;
    gsap.set(st.floor, { visibility: shown ? 'visible' : 'hidden' });
    if (st.word) gsap.set(st.word, { visibility: shown ? 'hidden' : 'visible' });
    if (!shown) return 0;
    gsap.set(img, { scale: lerp(0.94, 1, st.grow) });
    // The frame in the canvas's drawing buffer (y from the bottom), and the dome's units per px there.
    s.resize();
    const r = img.getBoundingClientRect(), c = s.canvas.getBoundingClientRect(), k = s.density;
    const x0 = r.left + r.width * PAD.l, x1 = r.right - r.width * PAD.r;
    const y0 = r.top + r.height * PAD.t, y1 = r.bottom - r.height * PAD.b;
    s.win = [((x0 + x1) / 2 - c.left) * k, (c.bottom - (y0 + y1) / 2) * k, ((x1 - x0) / 2) * k, ((y1 - y0) / 2) * k];
    s.winR = PAD.corner * r.width * k;
    const a = s.ray((x0 + x1) / 2, (y0 + y1) / 2), b = s.ray(x1, (y0 + y1) / 2);
    if (a && b) s.pxQ = Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, (x1 - (x0 + x1) / 2) * k);
    return st.grow;
  };

  // The hero's words and controls, from the same progress as the camera.
  const applyHero = (st: Stage) => {
    const p = st.progress;
    const top = st.el.querySelector<HTMLElement>('[data-hero-top]');
    const foot = st.el.querySelector<HTMLElement>('[data-hero-foot]');
    const sink = smooth(0, 0.17, p);
    if (st.word) gsap.set(st.word, { y: sink * st.el.clientHeight * 0.22 });
    if (top) gsap.set(top, { autoAlpha: 1 - smooth(0.01, 0.085, p), y: -smooth(0, 0.1, p) * 40 });
    if (foot) gsap.set(foot, { autoAlpha: 1 - smooth(0.26, 0.35, p) });
    document.documentElement.dataset.navTone = p > 0.18 ? 'paper' : 'sky';
  };

  onPage(({ intro }) => {
    const els = [...document.querySelectorAll<HTMLElement>('[data-sea-stage]')];
    if (!els.length) { document.documentElement.dataset.navTone = ''; return; }
    const s = getSea();
    if (!s) {
      // No WebGL2: the ground picture stays (html lacks .gl-on); still sit the word on its horizon.
      const flat = els.map((el) => ({ el, kind: el.dataset.seaStage!, word: el.querySelector<HTMLElement>('[data-stage-word]') } as unknown as Stage));
      const lay = () => flat.forEach(measure);
      lay();
      document.fonts.ready.then(lay);
      const ro = new ResizeObserver(lay);
      flat.forEach((st) => ro.observe(st.el));
      return () => ro.disconnect();
    }
    s.frozen = reduced;
    stages = els.map((el) => ({
      el, kind: el.dataset.seaStage!, slot: el.querySelector<HTMLElement>('[data-sea-slot]')!,
      word: el.querySelector<HTMLElement>('[data-stage-word]'), figure: el.querySelector<HTMLElement>('[data-figure]'),
      horizon: 0, visible: false, progress: 0, floor: el.querySelector<HTMLElement>('[data-floor]'), grow: 0,
    }));
    active = null;
    const relayout = () => { stages.forEach(measure); };
    relayout();
    document.fonts.ready.then(relayout);
    const ro = new ResizeObserver(relayout);
    stages.forEach((st) => ro.observe(st.el));
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) { const st = stages.find((x) => x.el === en.target); if (st) st.visible = en.isIntersecting; }
      place();
    }, { rootMargin: '10% 0px' });
    stages.forEach((st) => io.observe(st.el));
    gsap.ticker.add(tick);

    // Clicks send a turn; the pointer is a lens.
    const offs: (() => void)[] = [];
    for (const st of stages) {
      const down = (e: PointerEvent) => {
        if ((e.target as HTMLElement).closest('a, button, input, [data-ui]')) return;
        if (active !== st) return;
        send(e.clientX, e.clientY);
      };
      const move = (e: PointerEvent) => {
        if (active !== st || e.pointerType !== 'mouse') return;
        const over = !(e.target as HTMLElement).closest('a, button, input, [data-ui]');
        const on = s.setPointer(e.clientX, e.clientY, over);
        st.el.classList.toggle('is-over-sea', on);
      };
      const leave = () => { s.setPointer(0, 0, false); st.el.classList.remove('is-over-sea'); };
      st.el.addEventListener('pointerdown', down);
      st.el.addEventListener('pointermove', move);
      st.el.addEventListener('pointerleave', leave);
      offs.push(() => { st.el.removeEventListener('pointerdown', down); st.el.removeEventListener('pointermove', move); st.el.removeEventListener('pointerleave', leave); });
    }

    // The turn bar: the diff this page has made, Undo turn, and Send for keyboards.
    const bar = document.querySelector<HTMLElement>('[data-turnbar]');
    const add = bar?.querySelector<HTMLElement>('[data-add]');
    const del = bar?.querySelector<HTMLElement>('[data-del]');
    const undo = bar?.querySelector<HTMLButtonElement>('[data-undo]');
    const sendBtn = bar?.querySelector<HTMLButtonElement>('[data-send]');
    const announce = document.querySelector<HTMLElement>('[data-announce]');
    const total = { a: 0, d: 0, shownA: 0, shownD: 0 };
    s.onChange = (a, d) => {
      total.a += a; total.d += d;
      gsap.to(total, {
        shownA: total.a, shownD: total.d, duration: reduced ? 0 : 1.2, ease: 'power3.out', overwrite: true,
        onUpdate: () => { if (add) add.textContent = `+${Math.round(total.shownA)}`; if (del) del.textContent = fmt(-Math.round(total.shownD)); },
      });
      if (undo) undo.disabled = s.turns === 0;
      if (announce) announce.textContent = a > 0 ? `Turn ${s.turns} sent: ${a} lines rewritten.` : `Turn undone: ${-a} lines back as they were.`;
      if (bar && !reduced) gsap.fromTo(bar, { scale: 1 }, { scale: 1.035, duration: 0.14, yoyo: true, repeat: 1, ease: 'power2.out' });
    };
    const send = (x?: number, y?: number) => s.ripple(x, y);
    const onUndo = () => s.undo();
    const onSend = () => send();
    undo?.addEventListener('click', onUndo);
    sendBtn?.addEventListener('click', onSend);
    const hint = document.querySelector<HTMLElement>('[data-hint]');
    if (hint && isTouch()) hint.textContent = hint.dataset.touch || hint.textContent;

    // Intro: the word rises from behind the horizon, the way the sun would.
    const word = document.querySelector<HTMLElement>('[data-word]');
    if (word && !reduced) {
      const split = SplitText.create(word, { type: 'chars', charsClass: 'word__char' });
      gsap.set(split.chars, { yPercent: 105 });
      intro.add(gsap.to(split.chars, { yPercent: 0, duration: 2.0, ease: 'expo.out', stagger: 0.045, delay: 0.15 }), 0);
      offs.push(() => split.revert());
    }

    return () => {
      gsap.ticker.remove(tick);
      io.disconnect(); ro.disconnect();
      offs.forEach((f) => f());
      undo?.removeEventListener('click', onUndo);
      sendBtn?.removeEventListener('click', onSend);
      if (s) s.onChange = undefined;
      stages = []; active = null;
    };
  });
}
