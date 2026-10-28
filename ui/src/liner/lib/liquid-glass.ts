/*
  Liner liquid glass
  Apple's Liquid Glass bends light instead of scattering it: what passes behind a glass
  surface is pulled through a lens at its rim, and its edge catches the light.

  startLiquidGlass() gives every glass surface on the page (matched by `selector`, and
  any added later) its own SVG displacement filter, shaped to that surface's size and
  corner radius, and exposes it as --l-lens. Glass CSS puts var(--l-lens) in front of its
  blur, so the backdrop is refracted first, then softened.

  Only glass that floats over content gets a lens: overlays, bars and .l-frame-float.
  Frames sitting on the plain page have nothing behind them to bend, so they skip it. The
  lens is part of live blur: it runs only while <html> has data-blur="live", and stops
  when the page goes back to the fake blur.

  Lensing through backdrop-filter only renders in Chromium. Everywhere else, and when
  someone asks for reduced transparency or motion, the glass stays a clear blur. Phones and
  tablets keep the blur too: the lens re-runs over everything behind it on every frame that
  scrolls, a cost a mid-range phone GPU feels and a desktop one doesn't.
*/

export type LiquidGlassOptions = {
  /** Surfaces that get a lens. */
  selector?: string;
  /** How far the rim bends what is behind it, in px at the strongest point. */
  depth?: number;
};

/** Every glass surface in the library. Add .l-lens to your own. */
const DEFAULT_SELECTOR = [
  ".l-glass",
  ".l-frame-float",
  ".l-pop",
  ".l-lens",
  ".l-ai-menu",
  ".l-cmp__pop",
  ".l-cite-card",
  ".l-toast__body",
  ".l-cmd__panel",
  ".l-desk-pill",
  ".l-feed-jump",
  ".l-chat-jump",
  ".l-msel__panel",
  ".l-table__bar",
  ".l-act-tip",
].join(", ");
const SVG_NS = "http://www.w3.org/2000/svg";

let started = false;
let defs: SVGDefsElement | null = null;
const filters = new Map<string, string>();
let seq = 0;

export function supportsLens() {
  if (typeof window === "undefined") return false;
  const brands = (navigator as Navigator & { userAgentData?: { brands: { brand: string }[] } }).userAgentData?.brands ?? [];
  const chromium = brands.some((b) => /Chromium|Google Chrome|Microsoft Edge/.test(b.brand));
  const reduced = matchMedia("(prefers-reduced-transparency: reduce)").matches;
  const touch = matchMedia("(pointer: coarse)").matches;
  return chromium && !reduced && !touch;
}

/**
 * The displacement map for a rounded rectangle. Red and green carry where to sample from:
 * near the rim, a point looks a little further in, like light through the curved edge of
 * a lens; deeper in, it looks straight through.
 */
function lensMap(w: number, h: number, r: number) {
  const k = 0.5; // the map is drawn at half size and stretched; it is smooth anyway
  const W = Math.max(2, Math.round(w * k));
  const H = Math.max(2, Math.round(h * k));
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(W, H);
  const bezel = Math.max(8, Math.min(r * 1.35 + 6, Math.min(w, h) / 2));
  for (let j = 0; j < H; j++) {
    const y = (j + 0.5) / k;
    for (let i = 0; i < W; i++) {
      const x = (i + 0.5) / k;
      // Distance to the edge and the inward direction, for straight sides and round corners.
      const cx = Math.min(Math.max(x, r), w - r);
      const cy = Math.min(Math.max(y, r), h - r);
      const dx = x - cx;
      const dy = y - cy;
      let d: number;
      let nx = 0;
      let ny = 0;
      if (dx === 0 && dy === 0) {
        const m = Math.min(x, w - x, y, h - y);
        d = m;
        if (m === x) nx = 1;
        else if (m === w - x) nx = -1;
        else if (m === y) ny = 1;
        else ny = -1;
      } else {
        const dist = Math.hypot(dx, dy);
        d = r - dist;
        nx = -dx / dist;
        ny = -dy / dist;
      }
      const t = Math.min(1, Math.max(0, d / bezel));
      // A convex profile: strongest right at the rim, gone by the end of the bezel.
      const f = d < 0 ? 0 : Math.pow(1 - t, 1.7);
      const o = (j * W + i) * 4;
      img.data[o] = 128 + Math.round(127 * f * nx);
      img.data[o + 1] = 128 + Math.round(127 * f * ny);
      img.data[o + 2] = 128;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

function ensureDefs() {
  if (defs) return defs;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.position = "absolute";
  svg.style.pointerEvents = "none";
  defs = document.createElementNS(SVG_NS, "defs");
  svg.appendChild(defs);
  document.body.appendChild(svg);
  return defs;
}

/** One filter per rounded size, shared by every surface that has it. */
function filterFor(w: number, h: number, r: number, depth: number) {
  w = Math.round(w / 2) * 2;
  h = Math.round(h / 2) * 2;
  r = Math.round(Math.min(r, w / 2, h / 2));
  const key = `${w}x${h}r${r}`;
  const hit = filters.get(key);
  if (hit) return hit;
  const id = `l-lens-${++seq}`;
  const f = document.createElementNS(SVG_NS, "filter");
  f.setAttribute("id", id);
  f.setAttribute("x", "0");
  f.setAttribute("y", "0");
  f.setAttribute("width", String(w));
  f.setAttribute("height", String(h));
  f.setAttribute("filterUnits", "userSpaceOnUse");
  f.setAttribute("primitiveUnits", "userSpaceOnUse");
  f.setAttribute("color-interpolation-filters", "sRGB");
  const map = document.createElementNS(SVG_NS, "feImage");
  map.setAttribute("href", lensMap(w, h, r));
  map.setAttribute("x", "0");
  map.setAttribute("y", "0");
  map.setAttribute("width", String(w));
  map.setAttribute("height", String(h));
  map.setAttribute("preserveAspectRatio", "none");
  map.setAttribute("result", "map");
  const disp = document.createElementNS(SVG_NS, "feDisplacementMap");
  disp.setAttribute("in", "SourceGraphic");
  disp.setAttribute("in2", "map");
  // Small controls bend less than big panels, as a thinner lens would.
  disp.setAttribute("scale", String(Math.round(Math.min(depth, Math.min(w, h) * 0.9))));
  disp.setAttribute("xChannelSelector", "R");
  disp.setAttribute("yChannelSelector", "G");
  f.append(map, disp);
  ensureDefs().appendChild(f);
  const url = `url(#${id})`;
  filters.set(key, url);
  return url;
}

/** Lens every matching surface, now and as they appear, until the returned stop is called. */
function lensOn(selector: string, depth: number) {
  const watched = new Set<HTMLElement>();
  const queued = new Set<HTMLElement>();
  let frame = 0;
  const apply = () => {
    frame = 0;
    for (const el of queued) {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (!w || !h || !el.isConnected) continue;
      const r = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
      el.style.setProperty("--l-lens", filterFor(w, h, r, depth));
    }
    queued.clear();
  };
  const ro = new ResizeObserver((entries) => {
    for (const e of entries) queued.add(e.target as HTMLElement);
    if (!frame) frame = requestAnimationFrame(apply);
  });
  const watch = (el: Element) => {
    if (!(el instanceof HTMLElement) || watched.has(el)) return;
    watched.add(el);
    ro.observe(el);
  };
  const scan = (root: ParentNode) => {
    if (root instanceof Element && root.matches(selector)) watch(root);
    root.querySelectorAll?.(selector).forEach(watch);
  };
  const mo = new MutationObserver((records) => {
    for (const rec of records) {
      rec.addedNodes.forEach((n) => n instanceof Element && scan(n));
      rec.removedNodes.forEach((n) => {
        if (!(n instanceof Element)) return;
        for (const el of watched)
          if (!el.isConnected && (el === n || n.contains(el))) {
            ro.unobserve(el);
            watched.delete(el);
          }
      });
      if (rec.type === "attributes" && rec.target instanceof Element) scan(rec.target);
    }
  });
  scan(document.body);
  mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  document.documentElement.dataset.lens = "";
  return () => {
    mo.disconnect();
    ro.disconnect();
    cancelAnimationFrame(frame);
    for (const el of watched) el.style.removeProperty("--l-lens");
    delete document.documentElement.dataset.lens;
  };
}

export function startLiquidGlass({ selector = DEFAULT_SELECTOR, depth = 64 }: LiquidGlassOptions = {}) {
  if (started || typeof window === "undefined") return () => {};
  started = true;
  const html = document.documentElement;
  let stop: (() => void) | null = null;
  // The lens bends a live blur, so it runs only while <html> has data-blur="live". With the
  // fake blur, the default, there is no backdrop to bend and nothing here watches the page.
  const sync = () => {
    const on = html.dataset.blur === "live" && supportsLens();
    if (on && !stop) stop = lensOn(selector, depth);
    else if (!on && stop) {
      stop();
      stop = null;
    }
  };
  sync();
  const mo = new MutationObserver(sync);
  mo.observe(html, { attributes: true, attributeFilter: ["data-blur"] });

  return () => {
    mo.disconnect();
    stop?.();
    stop = null;
    started = false;
  };
}
