/*
  A node's HTML said three ways for the Code tab, and back again:
  - "HTML and CSS": its HTML without the data-l ids (they are the editor's, not the layer's) and
    with its own inline styles taken out into a rule under it. Reading the text back puts the rule
    into the root's style again and gives every element its id back, by place (the n-th element
    of a tag keeps the n-th one's id), so an edit keeps the selection and the layers.
  - JSX: attributes renamed as React has them, inline styles as a style object, void tags closed.
  - Tailwind: the JSX with each inline declaration Tailwind has an exact class for turned into
    that class (its default scale only), and the rest left in style.
  Plain and honest conversions, not a compiler: event attributes are left out of both.
*/
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

function parse(html: string) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  return tpl.content;
}

/** "a: b; c: d" → [["a","b"],["c","d"]], keeping values with semicolons in brackets whole. */
export function decls(css: string): [string, string][] {
  const out: [string, string][] = [];
  let depth = 0;
  let at = 0;
  const push = (s: string) => {
    const i = s.indexOf(":");
    if (i > 0) out.push([s.slice(0, i).trim().toLowerCase(), s.slice(i + 1).trim()]);
  };
  for (let i = 0; i < css.length; i++) {
    if (css[i] === "(") depth++;
    else if (css[i] === ")") depth--;
    else if (css[i] === ";" && depth === 0) push(css.slice(at, i)), (at = i + 1);
  }
  push(css.slice(at));
  return out.filter(([k, v]) => k && v);
}

const selectorOf = (el: Element, id: string) => {
  // The last class, which is usually the layer's own (abs next → .next).
  const c = el.classList[el.classList.length - 1];
  return c ? `.${c}` : `[data-l="${id}"]`;
};

/** The HTML and CSS text of a node, and where its rule starts (a 0-based line). */
export function htmlAndCss(html: string, id: string): { text: string; ruleAt: number } {
  const frag = parse(html);
  const root = frag.firstElementChild;
  if (!root) return { text: html, ruleAt: -1 };
  const style = root.getAttribute("style") ?? "";
  root.removeAttribute("style");
  for (const el of [root, ...root.querySelectorAll("[data-l]")]) el.removeAttribute("data-l");
  const body = serialise(frag).trim();
  const list = decls(style);
  if (!list.length) return { text: body, ruleAt: -1 };
  const rule = `${selectorOf(root, id)} {\n${list.map(([k, v]) => `  ${k}: ${v};`).join("\n")}\n}`;
  const lines = body.split("\n").length;
  return { text: `${body}\n\n${rule}`, ruleAt: lines + 1 };
}

const serialise = (frag: DocumentFragment) => {
  const box = document.createElement("div");
  box.append(frag.cloneNode(true));
  return box.innerHTML;
};

/** Where the first start tag ends (its ">"), with quoted attribute values stepped over; -1 if it doesn't. */
function startTagEnd(html: string, from: number) {
  let q = "";
  for (let i = from; i < html.length; i++) {
    const c = html[i];
    if (q) {
      if (c === q) q = "";
    } else if (c === '"' || c === "'") q = c;
    else if (c === ">") return i;
  }
  return -1;
}

/**
  The edited text back to what is sent for the layer: the HTML exactly as typed, never parsed and
  written out again (a browser would move a misplaced piece, and the file would hold its re-parse
  instead of what was typed, with no word from the engine). The one change: the rule under it goes
  into the root's style attribute, in place of a style the root has. The layer keeps its id (the
  engine keeps it when the piece gives none); new children get their ids from the engine. Undefined
  when there is no element to put in the layer's place.
*/
export function backToHtml(text: string, original: string, id: string): string | undefined {
  let html = text;
  let style: string | undefined;
  let rule: string | undefined;
  const m = /\n?\s*([^{}\n]+)\{([^{}]*)\}\s*$/.exec(text);
  if (m && !/[<>]/.test(m[1])) {
    html = text.slice(0, m.index);
    rule = m[2];
    style = decls(m[2]).map(([k, v]) => `${k}: ${v}`).join("; ");
  }
  // The rule as the tab showed it: untouched, the root's style goes out as it came, byte for byte.
  const shown = htmlAndCss(original, id);
  const shownRule = shown.ruleAt >= 0 ? /\{([^{}]*)\}\s*$/.exec(shown.text)?.[1] : undefined;
  const same = (a?: string, b?: string) => JSON.stringify(decls(a ?? "")) === JSON.stringify(decls(b ?? ""));
  const raw = /^\s*<[a-zA-Z][\w:-]*(?:\s+[^>]*?)?\s(style\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))/i.exec(original)?.[1];
  const keepRaw = raw !== undefined && same(rule, shownRule);
  html = html.trim();
  const open = /^<([a-zA-Z][\w:-]*)/.exec(html);
  if (!open) return undefined;
  const end = startTagEnd(html, open[0].length);
  if (end < 0) return undefined;
  if (style === undefined && !keepRaw) return html;
  let tag = html.slice(0, end);
  const self = tag.endsWith("/");
  if (self) tag = tag.slice(0, -1);
  tag = tag.replace(/\sstyle\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, "");
  const attr = keepRaw ? ` ${raw}` : style ? ` style="${(style + ";").replace(/"/g, "&quot;")}"` : "";
  return `${tag.replace(/\s+$/, "")}${attr}${self ? " /" : ""}${html.slice(end)}`;
}

// ---------- JSX and Tailwind

const RENAME: Record<string, string> = {
  class: "className", for: "htmlFor", tabindex: "tabIndex", readonly: "readOnly", maxlength: "maxLength", minlength: "minLength", colspan: "colSpan", rowspan: "rowSpan",
  srcset: "srcSet", crossorigin: "crossOrigin", autocomplete: "autoComplete", autofocus: "autoFocus", contenteditable: "contentEditable", spellcheck: "spellCheck",
  enterkeyhint: "enterKeyHint", inputmode: "inputMode", datetime: "dateTime", allowfullscreen: "allowFullScreen", frameborder: "frameBorder", novalidate: "noValidate",
  "accept-charset": "acceptCharset", "http-equiv": "httpEquiv", referrerpolicy: "referrerPolicy",
};
const camel = (k: string) => (k.startsWith("--") ? k : k.replace(/^-ms-/, "ms-").replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()));
const attrName = (k: string, svg: boolean) => RENAME[k] ?? (svg && !/^(data|aria)-/.test(k) && k.includes("-") ? camel(k) : k.includes(":") ? camel(k.replace(":", "-")) : k);
const q = (s: string) => JSON.stringify(s);
const UNITLESS = new Set(["z-index", "opacity", "flex-grow", "flex-shrink", "font-weight", "line-height", "order"]);
const styleObject = (list: [string, string][]) => `{{ ${list.map(([k, v]) => `${k.startsWith("--") ? q(k) : camel(k)}: ${UNITLESS.has(k) && /^-?\d*\.?\d+$/.test(v) ? v : q(v)}`).join(", ")} }}`;
const text = (s: string) => s.replace(/[{}<>]/g, (c) => `{${q(c)}}`);

function jsxOf(node: Node, tw: boolean, svg = false): string {
  if (node.nodeType === Node.TEXT_NODE) return text(node.textContent ?? "");
  if (node.nodeType === Node.COMMENT_NODE) return `{/* ${(node.textContent ?? "").trim()} */}`;
  if (!(node instanceof Element)) return "";
  // SVG's own tags keep their case (linearGradient); HTML's are lower case.
  const tag = node.namespaceURI === "http://www.w3.org/2000/svg" ? node.tagName : node.tagName.toLowerCase();
  const inSvg = svg || tag === "svg";
  const attrs: string[] = [];
  let classes = node.getAttribute("class") ?? "";
  let style = decls(node.getAttribute("style") ?? "");
  if (tw) {
    const out = tailwind(style);
    style = out.rest;
    classes = [classes, ...out.classes].filter(Boolean).join(" ");
  }
  for (const a of [...node.attributes]) {
    const k = a.name;
    if (k === "data-l" || k === "style" || k === "class" || /^on/i.test(k)) continue;
    attrs.push(a.value === "" && !/^(data|aria)-/.test(k) ? attrName(k, inSvg) : `${attrName(k, inSvg)}=${q(a.value)}`);
  }
  if (classes) attrs.unshift(`className=${q(classes)}`);
  if (style.length) attrs.push(`style=${styleObject(style)}`);
  const open = `<${tag}${attrs.length ? " " + attrs.join(" ") : ""}`;
  const kids = node instanceof HTMLTemplateElement ? node.content.childNodes : node.childNodes;
  if (VOID.has(tag) || !kids.length) return `${open} />`;
  return `${open}>${[...kids].map((k) => jsxOf(k, tw, inSvg)).join("")}</${tag}>`;
}

/** The node as JSX (`tw`: with Tailwind classes where they say exactly the same). */
export function toJsx(html: string, tw = false) {
  const frag = parse(html);
  return [...frag.childNodes].map((n) => jsxOf(n, tw)).join("").trim();
}

// Tailwind's default spacing scale: n × 4px for these n.
const SCALE = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72, 80, 96];
const space = (v: string) => {
  if (v === "0" || v === "0px") return "0";
  const m = /^(-?\d*\.?\d+)px$/.exec(v);
  if (!m) return v === "1px" ? "px" : undefined;
  const n = Number(m[1]) / 4;
  return Number(m[1]) === 1 ? "px" : SCALE.includes(n) ? String(n) : undefined;
};
const RADIUS: Record<string, string> = { "0": "rounded-none", "0px": "rounded-none", "2px": "rounded-sm", "4px": "rounded", "6px": "rounded-md", "8px": "rounded-lg", "12px": "rounded-xl", "16px": "rounded-2xl", "24px": "rounded-3xl", "999px": "rounded-full", "9999px": "rounded-full" };
const EXACT: Record<string, Record<string, string>> = {
  display: { flex: "flex", block: "block", "inline-block": "inline-block", inline: "inline", grid: "grid", "inline-flex": "inline-flex", none: "hidden", contents: "contents" },
  "flex-direction": { column: "flex-col", row: "flex-row", "column-reverse": "flex-col-reverse", "row-reverse": "flex-row-reverse" },
  "flex-wrap": { wrap: "flex-wrap", nowrap: "flex-nowrap" },
  flex: { "1 1 0": "flex-1", "1 1 0%": "flex-1", "1 1 auto": "flex-auto", none: "flex-none", "0 1 auto": "flex-initial" },
  "align-items": { center: "items-center", "flex-start": "items-start", start: "items-start", "flex-end": "items-end", end: "items-end", stretch: "items-stretch", baseline: "items-baseline" },
  "justify-content": { center: "justify-center", "flex-start": "justify-start", start: "justify-start", "flex-end": "justify-end", end: "justify-end", "space-between": "justify-between", "space-around": "justify-around", "space-evenly": "justify-evenly" },
  "align-self": { stretch: "self-stretch", center: "self-center", "flex-start": "self-start", "flex-end": "self-end", auto: "self-auto" },
  overflow: { hidden: "overflow-hidden", auto: "overflow-auto", visible: "overflow-visible", scroll: "overflow-scroll", clip: "overflow-clip" },
  "text-align": { left: "text-left", center: "text-center", right: "text-right", justify: "text-justify" },
  "font-weight": { "100": "font-thin", "200": "font-extralight", "300": "font-light", "400": "font-normal", "500": "font-medium", "600": "font-semibold", "700": "font-bold", "800": "font-extrabold", "900": "font-black" },
  "font-style": { italic: "italic", normal: "not-italic" },
  position: { absolute: "absolute", relative: "relative", fixed: "fixed", sticky: "sticky", static: "static" },
  "object-fit": { cover: "object-cover", contain: "object-contain", fill: "object-fill", none: "object-none" },
  "mix-blend-mode": Object.fromEntries(["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"].map((b) => [b, `mix-blend-${b}`])),
  "box-sizing": { "border-box": "box-border", "content-box": "box-content" },
  "white-space": { nowrap: "whitespace-nowrap", normal: "whitespace-normal", pre: "whitespace-pre" },
};
const SIZE: Record<string, string> = { "100%": "full", auto: "auto", "fit-content": "fit", "min-content": "min", "max-content": "max" };
const SPACED: Record<string, string> = { gap: "gap", "row-gap": "gap-y", "column-gap": "gap-x", padding: "p", "padding-top": "pt", "padding-right": "pr", "padding-bottom": "pb", "padding-left": "pl", margin: "m", "margin-top": "mt", "margin-right": "mr", "margin-bottom": "mb", "margin-left": "ml", top: "top", left: "left", right: "right", bottom: "bottom" };
const RADII: Record<string, string> = { "border-radius": "", "border-top-left-radius": "-tl", "border-top-right-radius": "-tr", "border-bottom-right-radius": "-br", "border-bottom-left-radius": "-bl" };

function tailwind(list: [string, string][]) {
  const classes: string[] = [];
  const rest: [string, string][] = [];
  for (const [k, v] of list) {
    const val = v.trim();
    let c: string | undefined = EXACT[k]?.[val];
    if (!c && k in SPACED && !/\s/.test(val)) {
      const s = space(val);
      if (s) c = `${SPACED[k]}-${s}`;
    }
    if (!c && (k === "width" || k === "height" || k === "min-width" || k === "max-width" || k === "min-height" || k === "max-height")) {
      const pre = { width: "w", height: "h", "min-width": "min-w", "max-width": "max-w", "min-height": "min-h", "max-height": "max-h" }[k];
      const s = SIZE[val] ?? space(val);
      if (s && !(k.startsWith("max") && s === "auto")) c = `${pre}-${s}`;
    }
    if (!c && k in RADII) {
      const r = RADIUS[val];
      if (r) c = r.replace("rounded", `rounded${RADII[k]}`);
    }
    if (!c && k === "opacity") {
      const n = Math.round(Number(val) * 100);
      if (Number.isFinite(n) && n % 5 === 0 && String(n / 100) === String(Number(val))) c = `opacity-${n}`;
    }
    if (c) classes.push(c);
    else rest.push([k, val]);
  }
  return { classes, rest };
}
