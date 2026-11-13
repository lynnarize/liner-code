/*
  Liner Design's AI pictures (pictures a model generates from words, never the person's own files):
  the AI pictures model the lead calls (design_picture, or the inspector's Picture pane), an
  OpenAI-Images-compatible endpoint set up in Settings › Models ("AI pictures"), optional:
  settings.pictures, its key in the keychain as pictureKey(id). A picture is saved as a PNG under
  the design file's assets/; the lean's colours go with every ask, so pictures keep to them, unless
  the ask says lean: false. The design file names its model (pictures.model: an endpoint's id, or
  null for no one, which refuses at once and asks nobody); unset, or an id Settings no longer has,
  is Settings' first. pictures.add puts a picture file of the person's own into assets/ the same way.

  Before an agent's picture the person is asked on a card on the timeline (the runtime's askLiner,
  as an add-on's install is): before the session's first one, before each, or never, as the design
  file's `pictures.ask` says ("first" when it says nothing). The person's own press in the
  inspector is their yes already. The key goes only in the request's header: never in a result,
  an error or a log, and never after a redirect. Tested only against a local fake.
*/
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { DesignFile, PictureEndpoint, PictureModel } from "../../contracts/src/index.ts";
import { pictureKey } from "../../contracts/src/index.ts";
import type { McpResult } from "./agent-tools.ts";
import { designDir, designFor, linkFree, frameOf, readFile, readFrame, writeFrame, type DesignCall, type DesignCtx, type DesignRpc } from "./canvas.ts";
import { atomic, readLean } from "./lean.ts";
import { uid } from "./store.ts";

export { TOOLS } from "./pictures-tools.ts";

export type PicturesMethod = "pictures.models" | "pictures.make" | "pictures.add";

/** A picture model's answer takes this long at most. */
const WAIT = 180_000;
const MAX_COUNT = 4;

/** The picture models Settings has, as the app lists them: no url, no key. */
export function models(ctx: Pick<DesignCtx, "store">): PictureModel[] {
  return (ctx.store.settings.pictures ?? []).map((e) => ({ id: e.id, name: e.label || e.model, kind: "openai-images", model: e.model }));
}

const endpointOf = (ctx: Pick<DesignCtx, "store">, id?: string): PictureEndpoint | undefined => {
  const all = ctx.store.settings.pictures ?? [];
  return id ? all.find((e) => e.id === id) : all[0];
};

/** An answer, or a picture fetched by its link, is read up to this much and refused beyond it. */
export const ANSWER_MAX = 40 * 1024 * 1024;

/**
  An address in one plain form: IPv4 dotted decimal (from decimal, octal, hex or short forms, and
  from IPv6 that maps or embeds one: ::ffff:7f00:1, ::ffff:127.0.0.1, ::127.0.0.1), IPv6 as eight
  full groups; a name as it is, lower case. Brackets come off.
*/
export function normalIp(host: string): string {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const v4 = ipv4(h);
  if (v4) return v4;
  if (!h.includes(":")) return h;
  const groups = ipv6(h);
  if (!groups) return h;
  // Mapped (::ffff:a.b.c.d) or compatible (::a.b.c.d, not :: or ::1): the IPv4 inside.
  const zero5 = groups.slice(0, 5).every((g) => g === 0);
  if (zero5 && (groups[5] === 0xffff || (groups[5] === 0 && (groups[6] !== 0 || groups[7] > 1)))) return [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join(".");
  return groups.map((g) => g.toString(16)).join(":");
}

/** IPv4 as a browser reads it: 1 to 4 parts, each decimal, 0x hex or 0 octal, the last filling what's left. */
function ipv4(h: string): string | null {
  const parts = h.split(".");
  if (parts.length < 1 || parts.length > 4 || parts.some((p) => !/^(?:0x[0-9a-f]*|0[0-7]*|[1-9]\d*)$/.test(p))) return null;
  const nums = parts.map((p) => (/^0x/.test(p) ? parseInt(p.slice(2) || "0", 16) : /^0\d/.test(p) ? parseInt(p, 8) : Number(p)));
  const last = nums.pop()!;
  if (nums.some((n) => n > 255) || last >= 256 ** (4 - nums.length)) return null;
  let v = last;
  nums.forEach((n, i) => (v += n * 256 ** (3 - i)));
  return [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].join(".");
}

/** IPv6 as eight numbers, :: and a dotted IPv4 tail allowed; null when it isn't one. */
function ipv6(h: string): number[] | null {
  let tail: number[] = [];
  let s = h;
  const dotted = /(?:^|:)(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (dotted) {
    const v4 = ipv4(dotted[1]);
    if (!v4) return null;
    const b = v4.split(".").map(Number);
    tail = [(b[0] << 8) | b[1], (b[2] << 8) | b[3]];
    s = s.slice(0, s.length - dotted[1].length);
    if (!s.endsWith("::")) s = s.replace(/:$/, "");
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parse = (x: string) => (x ? x.split(":").map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN)) : []);
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  const fill = 8 - tail.length - head.length - rest.length;
  if ([...head, ...rest].some(Number.isNaN) || (halves.length === 1 ? fill !== 0 : fill < 0)) return null;
  return [...head, ...Array(halves.length === 2 ? fill : 0).fill(0), ...rest, ...tail];
}

/** This Mac: localhost, 127/8, ::1, in whatever form the address is written. */
export const LOOPBACK = (host: string) => {
  const ip = normalIp(host);
  return ip === "localhost" || /^127\./.test(ip) || ip === "0:0:0:0:0:0:0:1";
};
/** An address of a private network (or this Mac's own link), in any form: a picture's link may not lead there unless the endpoint is on that host. */
export function privateIp(addr: string) {
  const ip = normalIp(addr);
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 10 || a === 0 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  if (!ip.includes(":")) return false;
  const first = parseInt(ip.split(":")[0], 16);
  return ip === "0:0:0:0:0:0:0:1" || ip === "0:0:0:0:0:0:0:0" || (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
}

/**
  A picture model's base address: https, or http only on this Mac (localhost, 127.0.0.1, [::1]), so
  its key never crosses the network in clear. Checked where the endpoint is saved and where it's used.
*/
export function checkEndpointUrl(url: unknown) {
  let u: URL;
  try {
    u = new URL(String(url ?? "").trim());
  } catch {
    throw new Error("An AI pictures model's address must be a full URL, starting https://.");
  }
  if (u.protocol === "https:" || (u.protocol === "http:" && LOOPBACK(u.hostname))) return u;
  throw new Error("An AI pictures model's address must start https:// (http:// only for one on this Mac), so its key never goes across the network in clear.");
}

/** A response's body, up to max bytes: refused beyond, by its stated length or as it comes. */
async function readCapped(r: Response, max: number, what: string): Promise<Buffer> {
  const said = Number(r.headers.get("content-length") ?? NaN);
  if (said > max) throw new Error(`${what} was over ${Math.round(max / 1024 / 1024)} MB, so it wasn't read.`);
  const chunks: Buffer[] = [];
  let got = 0;
  if (!r.body) return Buffer.alloc(0);
  for await (const c of r.body as unknown as AsyncIterable<Uint8Array>) {
    got += c.length;
    if (got > max) {
      await r.body.cancel().catch(() => {});
      throw new Error(`${what} was over ${Math.round(max / 1024 / 1024)} MB, so it wasn't read.`);
    }
    chunks.push(Buffer.from(c));
  }
  return Buffer.concat(chunks);
}

/**
  A picture an endpoint answered with a link to: over https; on this Mac (http or https) only when
  the endpoint itself is on this Mac; never from a private network unless the endpoint itself is on
  that host; no redirects; capped; without the key.
  (The name is looked up once here and again by fetch; a name that changes its address between the
  two is not caught.)
*/
export async function fetchLinked(link: string, endpoint: URL, signal: AbortSignal): Promise<Buffer> {
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    throw new Error("The AI pictures model answered with a link that isn't one.");
  }
  const host = normalIp(u.hostname);
  if (!(u.protocol === "https:" || (u.protocol === "http:" && LOOPBACK(u.hostname)))) throw new Error("The AI pictures model answered with a link that isn't https, so it wasn't fetched.");
  // A remote endpoint never gets a request sent to a service on this Mac on its behalf.
  if (LOOPBACK(u.hostname) && !LOOPBACK(endpoint.hostname)) throw new Error("The AI pictures model answered with a link to this Mac, which only an AI pictures model on this Mac may do, so it wasn't fetched.");
  if (!LOOPBACK(u.hostname) && u.hostname !== endpoint.hostname) {
    const ips = isIP(host) || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":") ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
    if (!ips.length || ips.some(privateIp)) throw new Error("The AI pictures model answered with a link into a private network, so it wasn't fetched.");
  }
  const r = await fetch(u, { signal, redirect: "error" });
  if (!r.ok) throw new Error(`The picture's link answered ${r.status}.`);
  return readCapped(r, ANSWER_MAX, "The picture");
}

/** What a design file with AI pictures off (its model null) is answered: one sentence an agent can act on. */
export const NO_ONE = "AI pictures are off for this design file, so no picture was made and nothing was charged. Leave a labelled empty box where the picture goes (say in it what it would show) and carry on; don't ask for AI pictures again in this file. The person's own image files always work: they can drop one on the box.";
/** What design_picture answers when no AI pictures model is set up at all: the same, and never a nudge to add one. */
export const NO_MODEL = "There's no AI pictures model, so no picture was made and nothing was charged. Leave a labelled empty box where the picture goes (say in it what it would show) and carry on. The person's own image files always work: they can drop one on the box.";

/** The model a design file uses: its own choice, null for no one; unset, or one Settings no longer has, is Settings' first. */
export function modelFor(ctx: Pick<DesignCtx, "store">, file: DesignFile): PictureEndpoint | null | undefined {
  const want = file.pictures?.model;
  if (want === null) return null;
  return (want ? endpointOf(ctx, want) : undefined) ?? endpointOf(ctx);
}

/** The sizes OpenAI's image models draw: the nearest by shape. Other endpoints take them too. */
export const sizeFor = (w: number, h: number) => (w / h > 1.2 ? "1536x1024" : h / w > 1.2 ? "1024x1536" : "1024x1024");

/** A message with the key taken out, wherever it is. */
const scrub = (s: string, key?: string) => (key ? s.split(key).join("…") : s).replace(/(Bearer\s+)[\w.~+/=-]{6,}/gi, "$1…").replace(/\b(sk-[\w-]{4})[\w-]{8,}/g, "$1…");

/** Words for a file name from the prompt: "a-harbour-at-dusk". */
const stem = (prompt: string) => prompt.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").split("-").slice(0, 6).join("-") || "picture";

/** The lean's colours, said to the model with the ask. */
function withLean(cwd: string, file: DesignFile, prompt: string) {
  let tokens;
  try {
    tokens = readLean(cwd, file).tokens;
  } catch {
    // a lean that leads out of the folder: none of it goes to the endpoint
    return prompt.trim();
  }
  const c = tokens.colours.filter((x) => !/\(/.test(x.name)).slice(0, 8);
  return c.length ? `${prompt.trim()}\n\nKeep to this palette: ${c.map((x) => `${x.name} ${x.value}`).join(", ")}.` : prompt.trim();
}

export type Made = { paths: string[]; cost?: number; ms: number; model: string };

/**
  Asks the picture model for `count` pictures and saves them under the design's assets/: their
  paths from the design's folder ("assets/harbour-1.png"). Throws a plain sentence when there's no
  model, or the endpoint fails; the key is never in it.
*/
export async function make(ctx: DesignCtx, o: { threadId?: string; cwd: string; slug: string; prompt: string; size: { w: number; h: number }; count?: number; model?: string; lean?: boolean; signal?: AbortSignal }): Promise<Made> {
  const file = readFile(ctx, o.cwd, o.slug);
  // A model named in the ask wins; else the file's own (null: no one), else Settings' first.
  const chosen = o.model ? endpointOf(ctx, o.model) : modelFor(ctx, file);
  if (chosen === null) throw new Error(NO_ONE);
  const e = chosen;
  if (!e) throw new Error(o.model ? "That AI pictures model isn't in Settings any more." : "There's no AI pictures model. Your own image files always work: drop one on a frame, or use the Picture tool.");
  const prompt = String(o.prompt ?? "").trim();
  if (!prompt) throw new Error("Say what the picture shows.");
  const count = Math.max(1, Math.min(MAX_COUNT, Math.floor(o.count ?? 1)));
  const key = ctx.keys.get(pictureKey(e.id));
  const call = uid("pic");
  const started = Date.now();
  const progress = (done: number, error?: string) => o.threadId && ctx.emit({ type: "pictures.progress", threadId: o.threadId, call, done, count, at: Date.now(), ...(error ? { error } : {}) });
  progress(0);
  const base = checkEndpointUrl(e.url);
  const url = `${e.url.trim().replace(/\/+$/, "")}/images/generations`;
  const body = { model: e.model, prompt: o.lean === false ? prompt : withLean(o.cwd, file, prompt), n: count, size: sizeFor(o.size.w, o.size.h), ...(/^gpt-image/i.test(e.model) ? {} : { response_format: "b64_json" }) };
  let answer: { data?: { b64_json?: string; url?: string }[]; usage?: { cost?: number }; cost?: number; error?: { message?: string } };
  try {
    const signal = o.signal ? AbortSignal.any([o.signal, AbortSignal.timeout(WAIT)]) : AbortSignal.timeout(WAIT);
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body), signal, redirect: "error" });
    const raw = (await readCapped(r, ANSWER_MAX, `${e.label || "The AI pictures model"}'s answer`)).toString("utf8");
    try {
      answer = JSON.parse(raw);
    } catch {
      answer = {};
    }
    if (!r.ok) throw new Error(`${e.label || "The AI pictures model"} answered ${r.status}${answer.error?.message ? `: ${String(answer.error.message).slice(0, 300)}` : ""}.`);
  } catch (err) {
    const why = err instanceof Error ? (err.name === "TimeoutError" ? `${e.label || "The AI pictures model"} took too long to answer.` : /fetch failed|ECONNREFUSED|ENOTFOUND/i.test(err.message + String((err as { cause?: unknown }).cause ?? "")) ? `${e.label || "The AI pictures model"} didn't answer at ${new URL(url).host}.` : err.message) : String(err);
    const said = scrub(why, key);
    progress(0, said);
    throw new Error(said);
  }
  const pictures = (answer.data ?? []).slice(0, count);
  if (!pictures.length) {
    progress(0, "No picture came back.");
    throw new Error(`${e.label || "The AI pictures model"} sent no picture back.`);
  }
  const paths: string[] = [];
  const named = `${stem(prompt)}-${Date.now().toString(36)}`;
  let refused = "";
  for (const [i, p] of pictures.entries()) {
    let bytes: Buffer | null = p.b64_json ? Buffer.from(p.b64_json, "base64") : null;
    // An endpoint that answers with a link to the picture: fetched once, without the key, on the terms above.
    if (!bytes && p.url) {
      try {
        bytes = await fetchLinked(p.url, base, o.signal ? AbortSignal.any([o.signal, AbortSignal.timeout(WAIT)]) : AbortSignal.timeout(WAIT));
      } catch (err) {
        refused = err instanceof Error ? err.message : String(err);
        continue;
      }
    }
    if (!bytes?.length) continue;
    // Saved as what its bytes are, and only if they're a picture.
    const kind = kindOf(bytes);
    if (!kind) {
      refused = `${e.label || "The AI pictures model"} sent something that isn't a picture, so it wasn't saved.`;
      continue;
    }
    const rel = `assets/${named}${pictures.length > 1 ? `-${i + 1}` : ""}.${kind}`;
    assetWrite(o.cwd, o.slug, rel, bytes);
    paths.push(rel);
    progress(paths.length);
  }
  if (!paths.length) {
    const why = refused || `${e.label || "The AI pictures model"} sent nothing that could be saved as a picture.`;
    progress(0, why);
    throw new Error(why);
  }
  const cost = typeof answer.cost === "number" ? answer.cost : typeof answer.usage?.cost === "number" ? answer.usage.cost : undefined;
  return { paths, ms: Date.now() - started, model: e.label || e.model, ...(cost !== undefined ? { cost } : {}) };
}

/** Puts a picture into an element of a frame by its data-l: an img's src, anything else's background. It keeps who made it, the words, and data-lean="0" when the lean's colours were left out, for "Make again". */
export function placeInto(html: string, id: string, src: string, by: string, made: { prompt?: string; lean?: boolean } = {}): string {
  const re = new RegExp(`<([a-zA-Z][\\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?\\sdata-l=["']${id.replace(/[^\w-]/g, "")}["'](?:[^>"']|"[^"]*"|'[^']*')*)>`);
  const m = re.exec(html);
  if (!m) throw new Error(`There's no element ${id} in that frame. design_tree lists them.`);
  const self = /\/\s*$/.test(m[2]);
  let attrs = m[2].replace(/\s*\/\s*$/, "").replace(/\sdata-(?:by|prompt|lean)=("[^"]*"|'[^']*')/g, "");
  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const mark = ` data-by="${esc(by)}"${made.prompt ? ` data-prompt="${esc(made.prompt.slice(0, 2000))}"` : ""}${made.lean === false ? ' data-lean="0"' : ""}`;
  if (m[1].toLowerCase() === "img") attrs = /\ssrc=/.test(attrs) ? attrs.replace(/\ssrc=("[^"]*"|'[^']*'|[^\s>]+)/, ` src="${src}"`) : `${attrs} src="${src}"`;
  else {
    const fill = `background-image:url(${src});background-size:cover;background-position:center`;
    const style = /\sstyle=("([^"]*)"|'([^']*)')/.exec(attrs);
    const rest = style ? (style[2] ?? style[3] ?? "").split(";").filter((p) => p.trim() && !/^\s*background(-image|-size|-position)?\s*:/i.test(p)).join(";") : "";
    attrs = style ? attrs.replace(style[0], ` style="${rest ? `${rest};` : ""}${fill}"`) : `${attrs} style="${fill}"`;
  }
  return `${html.slice(0, m.index)}<${m[1]}${attrs}${mark}${self ? " /" : ""}>${html.slice(m.index + m[0].length)}`;
}

/** The picture files a person may add, by their first bytes: never by the name or a claimed type. SVG (script) is not among them. */
const KINDS: { ext: string; is: (b: Buffer) => boolean }[] = [
  { ext: "png", is: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: "jpg", is: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: "gif", is: (b) => b.length > 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString("latin1")) },
  { ext: "webp", is: (b) => b.length > 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" },
  { ext: "avif", is: (b) => b.length > 12 && b.subarray(4, 8).toString("latin1") === "ftyp" && /^avi[fs]$/.test(b.subarray(8, 12).toString("latin1")) },
];
/** What a picture's bytes are, as an extension; null for anything else. */
export const kindOf = (b: Buffer) => KINDS.find((k) => k.is(b))?.ext ?? null;

/** A picture into the design's assets/, refused when any part of the way there is a link (canvas.ts linkFree). */
function assetWrite(cwd: string, slug: string, rel: string, bytes: Buffer) {
  atomic(linkFree(designDir(cwd, slug), rel), bytes);
}

/** A picture file of the person's own is at most this. */
export const ADD_MAX = 8 * 1024 * 1024;

/**
  A picture file of the person's own ("From a file") into the design's assets/, as a made one is:
  its path from the design's folder ("assets/harbour-3f9a1c2b.png"). Its kind is read from its
  bytes; the stored name is a slug of `name` and a short hash of the bytes, so no part of a path in
  `name` survives and two files never meet.
*/
export function addPicture(ctx: DesignCtx, cwd: string, slug: string, name: string, data: string): string {
  readFile(ctx, cwd, slug);
  const raw = String(data ?? "").replace(/^data:[^,]*,/, "");
  if (raw.length > Math.ceil((ADD_MAX * 4) / 3) + 8) throw new Error("That picture is over 8 MB. Make it smaller, then add it again.");
  const bytes = Buffer.from(raw, "base64");
  if (!bytes.length) throw new Error("That file is empty.");
  if (bytes.length > ADD_MAX) throw new Error("That picture is over 8 MB. Make it smaller, then add it again.");
  const kind = KINDS.find((k) => k.is(bytes));
  if (!kind) throw new Error("That isn't a picture Liner Design takes: add a PNG, JPEG, WebP, GIF or AVIF file (not SVG).");
  const base = String(name ?? "").split(/[\\/]/).pop()!.replace(/\.[a-z0-9]{1,5}$/i, "");
  const rel = `assets/${stem(base).slice(0, 48)}-${createHash("sha256").update(bytes).digest("hex").slice(0, 8)}.${kind.ext}`;
  assetWrite(cwd, slug, rel, bytes);
  ctx.emit({ type: "canvas.changed", cwd, file: slug, by: "you", at: Date.now() });
  return rel;
}

/** Sessions that said yes to a picture already ("first" asks only once). */
const asked = (ctx: Pick<DesignCtx, "keep">) => ctx.keep("pictures.asked", () => new Set<string>());

// The module's face.

/** The picture model's RPC handlers, for api.ts. pictures.make is the person's own press: it doesn't ask. */
export function rpc(x: () => DesignCtx): DesignRpc<PicturesMethod> {
  return {
    "pictures.models": () => models(x()),
    "pictures.make": async ({ threadId, cwd, file, prompt, size, count, model, lean }) => {
      const c = x();
      const r = await make(c, { threadId, cwd: c.folder(cwd), slug: file, prompt, size, count, model, lean });
      return { paths: r.paths, ms: r.ms, ...(r.cost !== undefined ? { cost: r.cost } : {}) };
    },
    "pictures.add": ({ cwd, file, name, data }) => {
      const c = x();
      return { path: addPicture(c, c.folder(cwd), file, name, data) };
    },
  };
}

const text = (t: string): McpResult => ({ content: [{ type: "text", text: t }] });

/** design_picture, for agent-tools.ts. */
export async function call(name: string, args: Record<string, unknown>, at: DesignCall): Promise<McpResult> {
  if (name !== "design_picture") throw new Error(`${name} isn't one of the picture tools.`);
  const cwd = at.cwdOf(at.threadId);
  const slug = designFor(at, cwd, args.design, false);
  const file = readFile(at, cwd, slug);
  // "No one" for this file: refused at once, nobody asked, the endpoint never called.
  const chosen = modelFor(at, file);
  if (chosen === null) return text(NO_ONE);
  if (!chosen) return text(NO_MODEL);
  if (at.readOnly(at.threadId)) throw new Error("This session is at Read only now (or it's a side chat), so it doesn't make pictures.");
  const lean = args.lean !== false;
  const prompt = String(args.prompt ?? "").trim();
  if (!prompt) throw new Error("prompt is what the picture shows, in a few sentences.");
  const w = Math.max(16, Math.min(4096, Number(args.width) || 1024));
  const h = Math.max(16, Math.min(4096, Number(args.height) || 1024));
  const into = args.into && typeof args.into === "object" ? (args.into as { frame?: unknown; id?: unknown }) : null;
  const target = into ? frameOf(file, into.frame) : null;
  if (target?.kind === "live") throw new Error(`${target.name} is a live frame: put the picture in the project's own files instead.`);
  const e = chosen;
  const when = file.pictures?.ask ?? "first";
  const yes = asked(at);
  if (when === "always" || (when === "first" && !yes.has(at.threadId))) {
    if (!at.ask) throw new Error("Liner Code can't ask the person here, so no picture was made.");
    const { answer } = at.ask(at.threadId, {
      tool: "design_picture",
      title: "Make an AI picture",
      description: `${at.whoIs(at.threadId, at.sidekick)} asks ${e.label || e.model} for an AI picture, which your AI pictures model's account is charged for.${when === "first" ? " A yes covers the rest of this session's AI pictures." : ""}`,
      risk: "medium",
      fields: [
        { label: "Picture", value: prompt.slice(0, 2000) },
        { label: "Size", value: `${w} × ${h}` },
        ...(target ? [{ label: "Goes into", value: `${target.name} › ${String(into?.id ?? "")}` }] : []),
      ],
    });
    const r = await answer;
    if (!r.allow) return text(`denied: the person said no to this picture${r.reason ? `, and said: “${r.reason}”` : ""}. Nothing was made.`);
    if (when === "first") yes.add(at.threadId);
  }
  const made = await make(at, { threadId: at.threadId, cwd, slug, prompt, size: { w, h }, model: e.id, lean, signal: at.gone });
  const path = made.paths[0];
  // Into a frame through the canvas's own writer: stamped, remembered as the engine's, and said (canvas.changed).
  if (target && into) writeFrame(at, cwd, slug, target.id, placeInto(readFrame(at, cwd, slug, target.id), String(into.id ?? ""), `../${path}`, made.model, { prompt, lean }), { by: "agent", threadId: at.threadId });
  else at.emit({ type: "canvas.changed", cwd, file: slug, by: "agent", threadId: at.threadId, at: Date.now() });
  const cost = made.cost !== undefined ? `, $${made.cost.toFixed(3)}` : "";
  return text(`made: ${path} (from the design's folder, .liner/designs/${slug}/; from a frame's HTML it's ../${path}), by ${made.model} in ${(made.ms / 1000).toFixed(1)} s${cost}.${target ? ` It's in ${target.name} now, in ${String(into?.id)}.` : " Put it in a frame with an img or a background-image."}`);
}

/** A row's title on the timeline for design_picture; undefined for a tool that isn't its own. */
export function titleOf(tool: string, input: Record<string, unknown>): string | undefined {
  const s = (v: unknown) => String(v ?? "").slice(0, 60);
  return tool === "design_picture" ? `Make an AI picture${s(input.prompt) ? ` of “${s(input.prompt)}”` : ""}` : undefined;
}
