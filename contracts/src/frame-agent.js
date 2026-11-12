/*
  Liner Design's frame agent: the one script inside every frame on the canvas, a drawn frame's
  (inlined into its srcdoc by the app, which imports this file with ?raw) and a live frame's
  (injected by the engine's proxy, which reads this file from disk). It answers the app's ToFrame
  messages with FromFrame ones (contracts/src/design.ts), by postMessage only.

  What it does: gives every element of the page that has none a data-l id (in document order, so
  the same document gets the same ids), says what is under a point, the page's outline, one node
  read whole, keeps the app told where watched nodes are (once a frame of animation at most), and
  applies changes, answering with the whole document serialised without itself and without the
  <base> the app put in. While a text is edited in place it says "edited" when the editing ends.

  It must never throw into the page, and never touch storage or the network: everything is in
  try/catch, and it reads and writes the DOM only.

  Whoever puts it in a page (the app's srcdoc, the engine's proxy for a live frame) puts it in one
  <script data-liner-agent> tag: that attribute is how the agent knows its own tag, and serialising
  takes every script[data-liner-agent] (and the app's base[data-liner-base]) out of the document,
  so the agent never ends up in a frame's file. The same tag may start with
  `window.__linerComputed = [...]` (contracts' COMPUTED, as JSON) before this file's text: the agent
  reads the computed properties from it, so the list lives in one place. The list below is only the
  fallback for a tag that doesn't set it, and must match COMPUTED in contracts/src/design.ts.
*/
(() => {
  if (window.__linerFrameAgent) return;
  window.__linerFrameAgent = true;
  const me = document.currentScript;
  const say = (m) => {
    try {
      parent.postMessage(m, "*");
    } catch {
      // nobody listening
    }
  };

  const OWN_COMPUTED = [
    "display", "flex-direction", "flex-wrap", "gap", "align-items", "justify-content",
    "padding-top", "padding-right", "padding-bottom", "padding-left",
    "width", "height", "min-width", "max-width",
    "background-color", "background-image", "color",
    "border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius",
    "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
    "border-top-style", "border-right-style", "border-bottom-style", "border-left-style",
    "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
    "box-shadow", "opacity", "mix-blend-mode",
    "font-family", "font-size", "font-weight", "line-height", "letter-spacing", "text-align",
    "object-fit", "overflow",
    "position", "left", "top",
  ];
  const COMPUTED = Array.isArray(window.__linerComputed) && window.__linerComputed.length ? window.__linerComputed.map(String) : OWN_COMPUTED;
  const SKIP = new Set(["SCRIPT", "STYLE", "LINK", "META", "TITLE", "HEAD", "BASE", "NOSCRIPT", "TEMPLATE", "BR", "WBR"]);
  const IMAGE = new Set(["IMG", "SVG", "PICTURE", "VIDEO", "CANVAS", "IFRAME"]);
  const INLINE = new Set(["B", "I", "EM", "STRONG", "SPAN", "A", "SMALL", "SUB", "SUP", "CODE", "MARK", "U", "S", "ABBR", "TIME", "BR", "WBR", "KBD", "Q", "CITE"]);

  const isMe = (el) => el === me || (el.tagName === "SCRIPT" && el.hasAttribute("data-liner-agent"));
  // An element the editor may address: in the body, not the agent, not inside an svg drawing.
  const addressable = (el) => el.nodeType === 1 && !SKIP.has(el.tagName) && !isMe(el) && !(el.ownerSVGElement);

  // data-l ids: the frame's own, plus new ones for elements without, in document order.
  let next = 0;
  const taken = () => {
    const used = new Set();
    for (const el of document.querySelectorAll("[data-l]")) used.add(el.getAttribute("data-l"));
    return used;
  };
  function stamp() {
    try {
      if (!document.body) return;
      const used = taken();
      const fresh = () => {
        let id;
        do id = `n${(++next).toString(36)}`;
        while (used.has(id));
        used.add(id);
        return id;
      };
      if (!document.body.hasAttribute("data-l")) document.body.setAttribute("data-l", fresh());
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, { acceptNode: (el) => (SKIP.has(el.tagName) || isMe(el) ? NodeFilter.FILTER_REJECT : el.ownerSVGElement ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
      for (let el = walk.nextNode(); el; el = walk.nextNode()) {
        const id = el.getAttribute("data-l");
        if (!id) el.setAttribute("data-l", fresh());
      }
      // Two elements with one id (a node copied by hand): the later one gets its own.
      const seen = new Set();
      for (const el of document.querySelectorAll("[data-l]")) {
        const id = el.getAttribute("data-l");
        if (seen.has(id)) el.setAttribute("data-l", fresh());
        else seen.add(id);
      }
    } catch {
      // a page that won't be stamped is still shown
    }
  }

  const byId = (id) => {
    try {
      return document.querySelector(`[data-l="${CSS.escape(String(id))}"]`);
    } catch {
      return null;
    }
  };
  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round((r.left + scrollX) * 10) / 10, y: Math.round((r.top + scrollY) * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
  };
  const stamped = (el) => (el && el.nodeType === 1 && el.hasAttribute("data-l") ? el : null);
  const kids = (el) => {
    const out = [];
    const go = (p) => {
      for (const c of p.children) {
        if (!addressable(c) && !(c.tagName === "svg" || c.tagName === "SVG")) continue;
        if (stamped(c)) out.push(c);
        else go(c);
      }
    };
    go(el);
    return out;
  };
  const ownText = (el) => {
    let t = "";
    for (const c of el.childNodes) if (c.nodeType === 3) t += c.nodeValue;
    return t.replace(/\s+/g, " ").trim();
  };
  const textOf = (el) => (el.textContent || "").replace(/\s+/g, " ").trim();
  function kindOf(el) {
    const tag = el.tagName.toUpperCase();
    if (IMAGE.has(tag)) return "image";
    let d = "";
    try {
      d = getComputedStyle(el).display;
    } catch {
      // detached
    }
    const children = [...el.children].filter((c) => !SKIP.has(c.tagName) && !isMe(c));
    const allInline = children.every((c) => INLINE.has(c.tagName.toUpperCase()) && !c.querySelector("img,svg,div,p,section,ul,ol"));
    if (textOf(el) && allInline && !/flex|grid/.test(d)) return "text";
    if (/flex|grid/.test(d) || children.length > 1) return "stack";
    return children.length ? "stack" : "box";
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  function nameOf(el, kind) {
    const named = el.getAttribute("data-name") || el.getAttribute("aria-label") || el.getAttribute("title");
    if (named) return named.slice(0, 60);
    if (el === document.body) return document.title || "Page";
    if (kind === "text") {
      const t = textOf(el);
      return t.length > 40 ? `${t.slice(0, 39)}…` : t;
    }
    // Layout helpers ("abs", "row") don't name a thing: the element's own kind does.
    const cls = [...el.classList].find((c) => !/^(abs|row|col|mut|lab|flex|grid|wrap|box)$/.test(c));
    if (el.id && !/^n[0-9a-z]+$/.test(el.id)) return cap(el.id.replace(/[-_]+/g, " "));
    if (cls) return cap(cls.replace(/[-_]+/g, " "));
    const tag = el.tagName.toLowerCase();
    return { svg: "Picture", img: "Picture", ul: "List", ol: "List", li: "Item", nav: "Navigation", header: "Header", footer: "Footer", button: "Button", a: "Link", section: "Section", main: "Main", aside: "Aside", form: "Form", input: "Field" }[tag] || cap(tag);
  }
  const refOf = (el) => {
    const kind = kindOf(el);
    return { id: el.getAttribute("data-l"), tag: el.tagName.toLowerCase(), name: nameOf(el, kind), kind, rect: rectOf(el) };
  };

  function tree(el, depth) {
    const ref = refOf(el);
    const node = { ...ref, children: [] };
    if (ref.kind === "text") node.text = textOf(el).slice(0, 200);
    if (depth < 40 && ref.kind !== "text" && ref.kind !== "image") for (const c of kids(el)) node.children.push(tree(c, depth + 1));
    return node;
  }

  function read(el) {
    const ref = refOf(el);
    const inline = {};
    for (let i = 0; i < el.style.length; i++) {
      const k = el.style[i];
      inline[k] = el.style.getPropertyValue(k);
    }
    const computed = {};
    try {
      const cs = getComputedStyle(el);
      for (const k of COMPUTED) computed[k] = cs.getPropertyValue(k);
    } catch {
      // detached
    }
    const node = { ...ref, html: clean(el.outerHTML), inline, computed };
    const t = ref.kind === "text" ? textOf(el) : ownText(el);
    if (t) node.text = t;
    const src = el.getAttribute("data-source");
    if (src) {
      const [file, line] = src.split(":");
      node.source = line ? { file, line: Number(line) } : { file };
    }
    return node;
  }

  const clean = (html) => html.replace(/\s(contenteditable|spellcheck)="[^"]*"/g, "");

  // The whole document as it is now, without the agent and the app's <base>.
  function serialise() {
    const root = document.documentElement.cloneNode(true);
    for (const el of root.querySelectorAll("script[data-liner-agent], base[data-liner-base]")) el.remove();
    if (me && me.id) {
      const copy = root.querySelector(`#${CSS.escape(me.id)}`);
      if (copy) copy.remove();
    }
    for (const el of root.querySelectorAll("[contenteditable]")) {
      el.removeAttribute("contenteditable");
      el.removeAttribute("spellcheck");
    }
    for (const el of root.querySelectorAll("[data-liner-editing]")) el.removeAttribute("data-liner-editing");
    const dt = document.doctype ? `<!doctype ${document.doctype.name}>\n` : "<!doctype html>\n";
    return dt + root.outerHTML + "\n";
  }
  const ids = () => [...document.querySelectorAll("[data-l]")].map((el) => el.getAttribute("data-l"));

  const parse = (html) => {
    const t = document.createElement("template");
    t.innerHTML = html;
    return t.content;
  };
  function op(o) {
    if (o.into !== undefined && o.insert !== undefined) {
      const p = byId(o.into);
      if (!p) return;
      const before = o.before ? byId(o.before) : null;
      p.insertBefore(parse(o.insert), before && before.parentNode === p ? before : null);
      return;
    }
    const el = byId(o.id);
    if (!el) return;
    if (o.style) {
      for (const k of Object.keys(o.style)) {
        const v = o.style[k];
        if (v === null || v === "") el.style.removeProperty(k);
        else {
          const imp = /!important\s*$/.test(v);
          el.style.setProperty(k, v.replace(/\s*!important\s*$/, ""), imp ? "important" : "");
        }
      }
      if (!el.getAttribute("style")) el.removeAttribute("style");
    } else if (o.text !== undefined) {
      el.textContent = o.text;
    } else if (o.attr) {
      for (const k of Object.keys(o.attr)) {
        if (k === "data-l") continue;
        const v = o.attr[k];
        if (v === null) el.removeAttribute(k);
        else el.setAttribute(k, v);
      }
    } else if (o.html !== undefined) {
      const frag = parse(o.html);
      const first = frag.firstElementChild;
      // The node keeps its id when the new html doesn't give one.
      if (first && !first.hasAttribute("data-l")) first.setAttribute("data-l", el.getAttribute("data-l"));
      el.replaceWith(frag);
    } else if (o.remove) {
      if (el !== document.body) el.remove();
    } else if (o.move) {
      const before = o.move.before ? byId(o.move.before) : null;
      const into = o.move.into ? byId(o.move.into) : null;
      if (before && before !== el && !el.contains(before)) before.parentNode.insertBefore(el, before);
      else if (into && !el.contains(into)) into.appendChild(el);
    }
  }

  // Watched nodes: their rects once a frame of animation at most, whenever something may have moved them.
  let watched = [];
  let queued = 0;
  const sendRects = () => {
    queued = 0;
    if (!watched.length) return;
    const rects = {};
    for (const id of watched) {
      const el = byId(id);
      if (el) rects[id] = rectOf(el);
    }
    say({ t: "rects", rects });
  };
  const soon = () => {
    if (!queued && watched.length) queued = requestAnimationFrame(sendRects);
  };
  let ro;
  const observe = () => {
    try {
      if (ro) ro.disconnect();
      if (!watched.length) return;
      ro = new ResizeObserver(soon);
      for (const id of watched) {
        const el = byId(id);
        if (el) ro.observe(el);
      }
      if (document.body) ro.observe(document.body);
    } catch {
      // no ResizeObserver: rects come on mutations and resizes only
    }
  };

  // Editing a text in place.
  // The text is the source's (textContent), never as shown (innerText would bake a CSS
  // text-transform's capitals into the file). While it's edited the transform is off, so what you
  // see and retype is what's in the file; it goes back as it was when the editing ends.
  let editing = null;
  let wasTransform = null;
  function endEdit() {
    const el = editing;
    if (!el) return;
    editing = null;
    try {
      el.removeAttribute("contenteditable");
      el.removeAttribute("spellcheck");
      el.removeAttribute("data-liner-editing");
      if (wasTransform) el.style.setProperty("text-transform", wasTransform.value, wasTransform.priority);
      else el.style.removeProperty("text-transform");
      if (!el.getAttribute("style")) el.removeAttribute("style");
      wasTransform = null;
      say({ t: "edited", id: el.getAttribute("data-l"), text: (el.textContent || "").replace(/\n+$/, "") });
    } catch {
      // gone while it was edited
    }
  }
  function startEdit(id) {
    endEdit();
    const el = byId(id);
    if (!el) return;
    editing = el;
    try {
      el.setAttribute("contenteditable", "plaintext-only");
      el.setAttribute("spellcheck", "false");
      el.setAttribute("data-liner-editing", "");
      const v = el.style.getPropertyValue("text-transform");
      wasTransform = v ? { value: v, priority: el.style.getPropertyPriority("text-transform") } : null;
      el.style.setProperty("text-transform", "none", "important");
      el.focus();
      const r = document.createRange();
      r.selectNodeContents(el);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
    } catch {
      // the text can't take a caret
    }
  }
  addEventListener("keydown", (e) => {
    if (!editing) return;
    if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey)) {
      e.preventDefault();
      endEdit();
    }
  }, true);
  addEventListener("focusout", (e) => {
    if (editing && e.target === editing) endEdit();
  }, true);
  addEventListener("input", soon, true);

  /*
    The checks, on the page as it is laid out now, with no agent and no tokens. Each finding is
    one plain sentence (CheckFinding in contracts/src/design.ts):
    - contrast: a text against what is really behind it (what is under its words, the drawing of
      an svg included, not only the boxes it sits in), under 4.5 to 1, or 3 to 1 for text 24 px
      and up or 19 px bold. Colours are written as hex; the app says them by the lean's names.
    - touch: things to press under 24 px either way, on a page narrower than 1000 (a touch screen).
      Real controls, and the ones a drawn screen draws: the items of a tab bar or a nav, and
      boxes whose class says they are a button or a field. The current tab is left out.
    - name: what a screen reader can't say: fields with only a hint in them, buttons and links
      with no words, pictures with no alt.
    - fit: what runs past the right edge of the page at this width, one finding a thing, with
      `width`; the app runs the page at several widths and says it in one sentence.
  */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function rgba(s) {
    const m = /rgba?\(([^)]*)\)/.exec(s || "");
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map((x) => (x.endsWith("%") ? parseFloat(x) / 100 : Number(x)));
    if (p.length < 3 || p.some((x) => Number.isNaN(x))) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  const hex = (c) => `#${[c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const lum = (c) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const x = lum(a);
    const y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  // How see-through an element is, its own opacity times its parents', kept for the length of one run.
  let seenMemo = new Map();
  const seen = (el) => {
    if (!el || el.nodeType !== 1) return 1;
    if (seenMemo.has(el)) return seenMemo.get(el);
    const o = (Number(getComputedStyle(el).opacity) || 0) * seen(el.parentElement);
    seenMemo.set(el, o);
    return o;
  };
  const SHAPES = new Set(["rect", "path", "circle", "ellipse", "polygon", "polyline"]);
  // The colour under a point of a text, from the top down: boxes with a colour, an svg's shapes. Null when a picture or a gradient is there.
  function behind(el, x, y) {
    const layers = [];
    let stack = [];
    try {
      stack = document.elementsFromPoint(x, y);
    } catch {
      return null;
    }
    for (const e of stack) {
      if ((e !== el && el.contains(e)) || isMe(e)) continue;
      const cs = getComputedStyle(e);
      const tag = e.tagName.toLowerCase();
      if (e.ownerSVGElement) {
        if (!SHAPES.has(tag)) continue;
        if (/url\(/.test(cs.fill)) return null;
        const f = rgba(cs.fill);
        if (!f || cs.fill === "none") continue;
        const a = f.a * (Number(cs.fillOpacity) || 0) * seen(e);
        if (a <= 0.01) continue;
        layers.push({ ...f, a });
        if (a >= 0.995) break;
        continue;
      }
      if (/^(img|video|canvas|iframe|picture|object|embed)$/.test(tag)) return null;
      if (cs.backgroundImage && cs.backgroundImage !== "none") return null;
      if (tag === "svg") continue;
      const b = rgba(cs.backgroundColor);
      if (!b || b.a <= 0.01) continue;
      const a = b.a * seen(e);
      layers.push({ ...b, a });
      if (a >= 0.995) break;
    }
    let c = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) c = over(layers[i], c);
    return c;
  }
  // The boxes of a text's own words (its text nodes), not of what's inside it.
  function wordBoxes(el) {
    const out = [];
    for (const c of el.childNodes) {
      if (c.nodeType !== 3 || !c.nodeValue.trim()) continue;
      const r = document.createRange();
      r.selectNodeContents(c);
      for (const b of r.getClientRects()) if (b.width > 1 && b.height > 1) out.push(b);
    }
    return out;
  }
  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && seen(el) > 0.05;
  };
  const quote = (s) => `"${s.length > 32 ? `${s.slice(0, 31)}…` : s}"`;
  const say1 = (el) => {
    const t = textOf(el);
    return t ? quote(t) : nameOf(el, kindOf(el));
  };

  function contrast(out) {
    for (const el of document.body.querySelectorAll("*")) {
      if (!addressable(el) || !stamped(el) || el.ownerSVGElement || IMAGE.has(el.tagName)) continue;
      if (!ownText(el)) continue;
      if (!visible(el)) continue;
      const cs = getComputedStyle(el);
      const fg0 = rgba(cs.color);
      if (!fg0) continue;
      const boxes = wordBoxes(el);
      if (!boxes.length) continue;
      const size = parseFloat(cs.fontSize) || 16;
      const bold = (Number(cs.fontWeight) || 400) >= 700;
      const need = size >= 24 || (size >= 19 && bold) ? 3 : 4.5;
      let worst = null;
      // At most six points a text: three along each of its first two lines.
      for (const b of boxes.slice(0, 2)) {
        for (const fx of [0.2, 0.5, 0.8]) {
          const x = b.left + b.width * fx;
          const y = b.top + b.height / 2;
          if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
          const bg = behind(el, x, y);
          if (!bg) continue;
          const fg = over({ ...fg0, a: fg0.a * seen(el) }, bg);
          const r = ratio(fg, bg);
          if (!worst || r < worst.r) worst = { r, fg, bg };
        }
      }
      if (!worst || worst.r >= need) continue;
      const r = Math.floor(worst.r * 10) / 10;
      out.push({ kind: "contrast", id: el.getAttribute("data-l"), rect: rectOf(el), ratio: r, text: `${quote(ownText(el))} in ${hex(worst.fg)} on ${hex(worst.bg)} is ${r} to 1. Text this ${need === 3 ? "large" : "small"} needs ${need}.` });
    }
  }

  const REAL = "a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=switch],[role=radio],[onclick],[tabindex]:not([tabindex='-1'])";
  const BAR = /(^|[\s_-])(tabs?|tab-?bar|nav|navbar|menu|toolbar|segmented)($|[\s_-])/i;
  const CONTROL = /(^|[\s_-])(btn|button|cta|chip|find|search|field|input)($|[\s_-])/i;
  const FIELD = /(^|[\s_-])(find|search|field|input)($|[\s_-])/i;
  const cls = (el) => (typeof el.className === "string" ? el.className : "");
  const isBar = (el) => el && el.nodeType === 1 && (el.tagName === "NAV" || /^(tablist|navigation|menubar|toolbar)$/.test(el.getAttribute("role") || "") || BAR.test(cls(el)));
  // The tab you are on: marked as current, or the one bold item among plain ones.
  const isCurrent = (el) => {
    if (el.getAttribute("aria-current") || el.getAttribute("aria-selected") === "true" || /(^|\s)(on|active|current|selected)(\s|$)/.test(cls(el))) return true;
    const sib = [...el.parentElement.children];
    const bold = (x) => /^(B|STRONG)$/.test(x.tagName);
    return bold(el) && sib.filter(bold).length === 1 && sib.length > 1;
  };
  function pressables() {
    const set = new Set();
    for (const el of document.querySelectorAll(REAL)) if (addressable(el)) set.add(el);
    for (const el of document.body.querySelectorAll("*")) {
      if (!addressable(el) || set.has(el)) continue;
      if (isBar(el.parentElement) && textOf(el) && !isCurrent(el)) set.add(el);
      else if (CONTROL.test(cls(el)) && textOf(el) && !isBar(el)) set.add(el);
    }
    return [...set].filter((el) => !el.closest("[aria-hidden=true]") && visible(el));
  }

  function touch(out) {
    if (innerWidth >= 1000) return;
    // Small ones of one size in one bar are one finding: "Week and Stations are 20 high".
    const groups = new Map();
    for (const el of pressables()) {
      const r = el.getBoundingClientRect();
      const h = Math.round(r.height);
      const w = Math.round(r.width);
      if (h >= 24 && w >= 24) continue;
      const side = h < 24 ? `${h} high` : `${w} wide`;
      const key = `${side}|${isBar(el.parentElement) ? el.parentElement.getAttribute("data-l") : el.getAttribute("data-l")}`;
      if (!groups.has(key)) groups.set(key, { side, els: [] });
      groups.get(key).els.push(el);
    }
    for (const { side, els } of groups.values()) {
      const names = els.map((el) => textOf(el) || nameOf(el, kindOf(el)));
      const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
      const box = els.map(rectOf).reduce((a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x), h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y) }));
      out.push({ kind: "touch", id: els[0].getAttribute("data-l"), rect: box, text: `${list} ${els.length === 1 ? "is" : "are"} ${side} to touch. 24 is the least.` });
    }
  }

  const labelled = (el) => {
    if ((el.getAttribute("aria-label") || "").trim() || (el.getAttribute("title") || "").trim()) return true;
    const by = el.getAttribute("aria-labelledby");
    if (by && by.split(/\s+/).some((id) => (document.getElementById(id)?.textContent || "").trim())) return true;
    if (el.id) {
      try {
        if ([...document.querySelectorAll(`label[for="${CSS.escape(el.id)}"]`)].some((l) => l.textContent.trim())) return true;
      } catch {
        // an id CSS can't say
      }
    }
    const wrap = el.closest("label");
    return Boolean(wrap && wrap.textContent.trim());
  };
  function names(out) {
    const add = (el, text) => out.push({ kind: "name", id: el.getAttribute("data-l"), rect: rectOf(el), text });
    for (const el of document.body.querySelectorAll("*")) {
      if (!addressable(el) || !stamped(el) || el.closest("[aria-hidden=true]") || !visible(el)) continue;
      const tag = el.tagName;
      const type = (el.getAttribute("type") || "").toLowerCase();
      if ((tag === "INPUT" && !/^(hidden|submit|button|reset|image)$/.test(type)) || tag === "SELECT" || tag === "TEXTAREA") {
        if (labelled(el)) continue;
        const hint = (el.getAttribute("placeholder") || "").trim();
        add(el, hint ? `${quote(hint)} has no name a screen reader can say.` : "A field has no name a screen reader can say.");
      } else if (tag === "BUTTON" || (tag === "A" && el.hasAttribute("href")) || el.getAttribute("role") === "button") {
        const inside = textOf(el) || [...el.querySelectorAll("img[alt]")].map((i) => i.getAttribute("alt")).join("").trim();
        if (!inside && !labelled(el)) add(el, `A ${tag === "A" ? "link" : "button"} has no words a screen reader can say.`);
      } else if (tag === "IMG") {
        if (!el.hasAttribute("alt") && !labelled(el)) add(el, "A picture has nothing a screen reader can say: give it alt words, or an empty alt if it only decorates.");
      } else if (FIELD.test(cls(el)) && !el.getAttribute("role") && !labelled(el) && textOf(el) && !el.querySelector("input,select,textarea")) {
        // A field a screen drew as a box with its hint inside: built, it has no name but the hint.
        add(el, `${quote(textOf(el))} has no name a screen reader can say.`);
      }
    }
  }

  // What runs past the page's right edge at this width: the outermost thing with words or a picture.
  function fit(out) {
    const W = document.documentElement.clientWidth || innerWidth;
    const clips = (el) => {
      for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (/hidden|clip|auto|scroll/.test(o) && p.getBoundingClientRect().right <= W + 1) return true;
      }
      return false;
    };
    const told = [];
    for (const el of document.body.querySelectorAll("*")) {
      if (!addressable(el) || !stamped(el) || el.ownerSVGElement) continue;
      const k = IMAGE.has(el.tagName) ? "image" : ownText(el) ? "text" : "";
      if (!k || !visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.right <= W + 1 && r.left >= -1) continue;
      if (clips(el) || told.some((t) => t.contains(el))) continue;
      told.push(el);
      out.push({ kind: "fit", id: el.getAttribute("data-l"), rect: rectOf(el), width: W, text: say1(el) });
    }
  }

  async function checks() {
    if (!document.body) return [];
    stamp();
    seenMemo = new Map();
    try {
      // Fonts are waited for only while some are still loading (layout first, so the page asks for them).
      void document.body.offsetHeight;
      if (document.fonts && document.fonts.status === "loading") await Promise.race([document.fonts.ready, sleep(2500)]);
    } catch {
      // fonts that won't say when they're ready: measured as they are
    }
    await sleep(16);
    const out = [];
    for (const run of [contrast, touch, names, fit]) {
      try {
        run(out);
      } catch {
        // one check that can't run doesn't stop the others
      }
    }
    return out;
  }

  addEventListener("message", (e) => {
    if (e.source !== parent) return;
    const m = e.data;
    if (!m || typeof m !== "object") return;
    try {
      switch (m.t) {
        case "hit": {
          let el = document.elementFromPoint(m.x - scrollX, m.y - scrollY);
          while (el && !stamped(el)) el = el.parentElement;
          const path = [];
          for (let p = el; p && p !== document.documentElement; p = p.parentElement) if (stamped(p) && p !== document.body && !p.ownerSVGElement) path.unshift(refOf(p));
          const node = path.length ? (m.deep ? path[path.length - 1] : path[0]) : null;
          return say({ t: "hit", n: m.n, node, path });
        }
        case "tree":
          stamp();
          return say({ t: "tree", n: m.n, root: tree(document.body, 0) });
        case "read": {
          const el = byId(m.id);
          if (!el) return say({ t: "node", n: m.n, node: null });
          return say({ t: "node", n: m.n, node: read(el) });
        }
        case "watch":
          watched = Array.isArray(m.ids) ? m.ids.slice(0, 200) : [];
          observe();
          return sendRects();
        case "apply": {
          endEdit();
          for (const o of m.ops || []) {
            try {
              op(o);
            } catch {
              // one change that can't be made doesn't stop the rest
            }
          }
          stamp();
          observe();
          soon();
          return say({ t: "applied", n: m.n, html: serialise(), ids: ids() });
        }
        case "edit":
          if (m.on) startEdit(m.id);
          else endEdit();
          return;
        case "check":
          return void checks().then((findings) => say({ t: "checks", n: m.n, findings }), () => say({ t: "checks", n: m.n, findings: [] }));
      }
    } catch {
      // an answer that can't be given times out on the app's side
    }
  });

  const ready = () => {
    stamp();
    try {
      new MutationObserver(soon).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    } catch {
      // nothing to observe
    }
    addEventListener("resize", soon);
    addEventListener("load", soon);
    const el = document.documentElement;
    say({ t: "ready", w: el.scrollWidth, h: el.scrollHeight });
  };
  try {
    if (document.readyState === "loading") addEventListener("DOMContentLoaded", ready, { once: true });
    else ready();
  } catch {
    // never into the page
  }
})();
