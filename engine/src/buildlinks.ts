/*
  Liner Design's build links: which project file each frame was built as (design_built, or tied by
  hand), and whether they still agree: in step, the design ahead, the code ahead, or not built.
  A link is kept in the frame's `built` in design.json, with both sides' hashes from when it was
  made; the frame's HTML at that moment is kept beside the canvas's versions
  (~/.liner-code/designs/built/<folder>/<file>/<frame>.html), so "design ahead" can say in words
  what moved since, element by element by data-l: "Next tide: gap 12 to 16".
*/
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { DesignFile, FrameBuild } from "../../contracts/src/index.ts";
import type { McpResult } from "./agent-tools.ts";
import { canvasHooks, designFor, frameOf, readFile, readFrame, setBuilt, type DesignCall, type DesignCtx, type DesignRpc } from "./canvas.ts";
import { atomic, inside, safeSlug } from "./lean.ts";

export { TOOLS } from "./buildlinks-tools.ts";

export type BuildMethod = "build.state" | "build.link" | "build.unlink";

/** The most lines "what changed" says; the rest is counted. */
const LINES = 10;

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex").slice(0, 32);
/** A frame's hash: its HTML without the ids the engine stamps, so stamping alone never reads as a change. */
export const frameHash = (html: string) => sha(html.replace(/\sdata-l="[^"]*"/g, "").replace(/\s+/g, " ").trim());
const fileHash = (abs: string) => {
  try {
    return sha(readFileSync(abs));
  } catch {
    return "";
  }
};

/** Where the frame's HTML at build time is kept: beside the versions, by folder, design file and frame. */
export function builtCopy(home: string, cwd: string, slug: string, frame: string) {
  return join(home, "designs", "built", sha(cwd).slice(0, 16), safeSlug(slug), `${safeSlug(frame) || "frame"}.html`);
}

/** A drawn frame's HTML through the canvas (stamped), or "" when its file is gone. */
const htmlOf = (ctx: DesignCtx, cwd: string, slug: string, frame: string) => {
  try {
    return readFrame(ctx, cwd, slug, frame);
  } catch {
    return "";
  }
};

/** Ties a frame to a project file as both are now, and keeps the frame's HTML of this moment. */
export function link(ctx: DesignCtx, cwd: string, slug: string, frameRef: string, path: string, turn?: number): DesignFile {
  const f = frameOf(readFile(ctx, cwd, slug), frameRef);
  if (f.kind === "live") throw new Error(`${f.name} is a live frame: it's the running app already, so there's nothing to tie it to.`);
  const abs = inside(cwd, String(path ?? "").trim());
  if (!abs) throw new Error("The file has to be a path inside this folder, like src/screens/Today.tsx.");
  if (!existsSync(abs) || !statSync(abs).isFile()) throw new Error(`There's no file ${relative(cwd, abs)} yet: write it first, then record it.`);
  const html = htmlOf(ctx, cwd, slug, f.id);
  atomic(builtCopy(ctx.store.home, cwd, slug, f.id), html);
  return setBuilt(ctx, cwd, slug, f.id, { file: relative(cwd, abs).split(sep).join("/"), frameHash: frameHash(html), fileHash: fileHash(abs), at: Date.now(), ...(turn ? { turn } : {}) });
}

/** Lets go of a frame's link and its kept copy. */
export function unlink(ctx: DesignCtx, cwd: string, slug: string, frameRef: string): DesignFile {
  const f = frameOf(readFile(ctx, cwd, slug), frameRef);
  const next = setBuilt(ctx, cwd, slug, f.id, undefined);
  rmSync(builtCopy(ctx.store.home, cwd, slug, f.id), { force: true });
  return next;
}

/** Each frame against its file: none, in step, design ahead (with what changed), code ahead. */
export function buildState(ctx: DesignCtx, cwd: string, slug: string): FrameBuild[] {
  const file = readFile(ctx, cwd, slug);
  return file.frames.map((f): FrameBuild => {
    const b = f.built;
    // Not a screen (a brand board): never for code, so not "not built" either.
    if (f.screen === false) return { frame: f.id, state: "none", screen: false };
    if (!b || f.kind === "live") return { frame: f.id, state: "none", ...(f.missing ? { missing: true as const } : {}) };
    // Its file is gone for now: nothing to compare, so nothing is ahead; Build leaves it be until the file is back.
    if (f.missing) return { frame: f.id, state: "step", file: b.file, missing: true };
    const abs = inside(cwd, b.file);
    const html = htmlOf(ctx, cwd, slug, f.id);
    const design = frameHash(html) !== b.frameHash;
    const code = !abs || fileHash(abs) !== b.fileHash;
    if (!design && !code) return { frame: f.id, state: "step", file: b.file };
    if (!design) return { frame: f.id, state: "code-ahead", file: b.file, changed: abs && existsSync(abs) ? `${b.file} changed since it was built.` : `${b.file} isn't there any more.` };
    let then = "";
    try {
      then = readFileSync(builtCopy(ctx.store.home, cwd, slug, f.id), "utf8");
    } catch {
      // built before the copy was kept, or by hand elsewhere
    }
    const lines = then ? diffFrames(then, html) : [];
    const changed = (lines.length ? lines : ["The frame changed since it was built."]).concat(code ? [`${b.file} changed too.`] : []).join("\n");
    return { frame: f.id, state: "design-ahead", file: b.file, changed, ...(code ? { both: true } : {}) };
  });
}

// What changed, in words.

type El = { id: string; tag: string; name: string; style: Record<string, string>; attrs: Record<string, string>; text: string; parent?: string };

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

function attrsOf(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  return out;
}

export function styleOf(s: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(s ?? "").split(";")) {
    const i = part.indexOf(":");
    if (i > 0) out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  return out;
}

/**
  The elements of a page that carry data-l, each with its own text (not its children's), its
  inline style and attributes. A tolerant walk over the tags, enough for pages people and agents
  write; scripts, styles and comments are skipped whole.
*/
export function elementsOf(html: string): Map<string, El> {
  const out = new Map<string, El>();
  const stack: { tag: string; id?: string }[] = [];
  const re = /<!--[\s\S]*?-->|<(script|style|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g;
  for (const m of html.matchAll(re)) {
    if (m[2]) {
      const tag = m[2].toLowerCase();
      const at = stack.map((s) => s.tag).lastIndexOf(tag);
      if (at >= 0) stack.length = at;
    } else if (m[3]) {
      const tag = m[3].toLowerCase();
      const a = attrsOf(m[4] ?? "");
      const id = a["data-l"];
      const parent = [...stack].reverse().find((s) => s.id)?.id;
      if (id && !out.has(id)) {
        const cls = (a.class ?? "").split(/\s+/).filter(Boolean)[0];
        out.set(id, { id, tag, name: a["data-name"] || a["aria-label"] || (cls ? `.${cls}` : "") || tag, style: styleOf(a.style), attrs: a, text: "", ...(parent ? { parent } : {}) });
      }
      if (!VOID.has(tag) && !/\/\s*$/.test(m[4] ?? "")) stack.push({ tag, id });
    } else if (m[5] && m[5].trim()) {
      const owner = [...stack].reverse().find((s) => s.id)?.id;
      const el = owner ? out.get(owner) : undefined;
      if (el && stack[stack.length - 1]?.id === owner) el.text = `${el.text} ${m[5]}`.replace(/\s+/g, " ").trim();
    } else if (m[1]) {
      // A script or style: kept out of anyone's text.
    }
  }
  return out;
}

const px = (a: string, b: string) => (/^-?[\d.]+px$/.test(a) && /^-?[\d.]+px$/.test(b) ? [a.slice(0, -2), b.slice(0, -2)] : [a, b]);
const q = (s: string) => `“${s.length > 40 ? `${s.slice(0, 38)}…` : s}”`;

/** What differs between a frame then and now, at most ten lines in plain words. */
export function diffFrames(before: string, after: string): string[] {
  const a = elementsOf(before);
  const b = elementsOf(after);
  if (!a.size) return [];
  const lines: string[] = [];
  const nameOf = (e: El) => (e.name.startsWith(".") || e.name === e.tag ? `${e.text ? q(e.text) : e.name}` : e.name);
  for (const [id, now] of b) {
    const was = a.get(id);
    if (!was) {
      // Only the outermost of what's new: its children came with it.
      if (!now.parent || a.has(now.parent)) lines.push(`Added ${now.tag === "img" ? "a picture" : nameOf(now)}${now.parent && b.get(now.parent) ? ` in ${nameOf(b.get(now.parent)!)}` : ""}`);
      continue;
    }
    const changes: string[] = [];
    for (const k of new Set([...Object.keys(was.style), ...Object.keys(now.style)])) {
      const [x, y] = px(was.style[k] ?? "", now.style[k] ?? "");
      if (x === y) continue;
      changes.push(!x ? `${k} set to ${y}` : !y ? `${k} ${x} taken off` : `${k} ${x} to ${y}`);
    }
    if (was.text !== now.text) changes.push(was.text && now.text ? `text ${q(was.text)} to ${q(now.text)}` : now.text ? `text ${q(now.text)}` : "text taken out");
    if ((was.attrs.src ?? "") !== (now.attrs.src ?? "")) changes.push("a new picture");
    if ((was.attrs.class ?? "") !== (now.attrs.class ?? "")) changes.push(`class ${q(was.attrs.class ?? "")} to ${q(now.attrs.class ?? "")}`);
    // Any other attribute (aria-label, alt, href, title): said by name.
    for (const k of new Set([...Object.keys(was.attrs), ...Object.keys(now.attrs)])) {
      if (["data-l", "style", "class", "src"].includes(k) || (was.attrs[k] ?? null) === (now.attrs[k] ?? null)) continue;
      changes.push(now.attrs[k] === undefined ? `${k} taken off` : was.attrs[k] === undefined ? `${k} set to ${q(now.attrs[k])}` : `${k} ${q(was.attrs[k])} to ${q(now.attrs[k])}`);
    }
    if (changes.length) lines.push(`${nameOf(was)}: ${changes.join(", ")}`);
  }
  for (const [id, was] of a) if (!b.has(id) && (!was.parent || b.has(was.parent))) lines.push(`Removed ${nameOf(was)}`);
  return lines.length > LINES ? [...lines.slice(0, LINES - 1), `and ${lines.length - LINES + 1} more changes`] : lines;
}

// The module's face.

/** The build links' RPC handlers, for api.ts. */
export function rpc(x: () => DesignCtx): DesignRpc<BuildMethod> {
  // design_files says each frame's state through canvas.ts's hook, which can't import this module.
  canvasHooks.builds = (cwd, file) => buildState(x(), cwd, file);
  return {
    "build.state": ({ cwd, file }) => {
      const c = x();
      return buildState(c, c.folder(cwd), file);
    },
    "build.link": ({ cwd, file, frame, path }) => {
      const c = x();
      const root = c.folder(cwd);
      const f = frameOf(link(c, root, file, frame, path), frame);
      c.emit({ type: "canvas.changed", cwd: root, file, frame: f.id, by: "you", at: Date.now() });
      return buildState(c, root, file);
    },
    "build.unlink": ({ cwd, file, frame }) => {
      const c = x();
      const root = c.folder(cwd);
      unlink(c, root, file, frame);
      c.emit({ type: "canvas.changed", cwd: root, file, by: "you", at: Date.now() });
      return buildState(c, root, file);
    },
  };
}

const text = (t: string): McpResult => ({ content: [{ type: "text", text: t }] });

/** design_built, for agent-tools.ts. */
export async function call(name: string, args: Record<string, unknown>, at: DesignCall): Promise<McpResult> {
  if (name !== "design_built") throw new Error(`${name} isn't one of the build tools.`);
  if (at.readOnly(at.threadId)) throw new Error("This session is at Read only now (or it's a side chat), so it doesn't record builds.");
  const cwd = at.cwdOf(at.threadId);
  const slug = designFor(at, cwd, args.design, false);
  const file = link(at, cwd, slug, String(args.frame ?? ""), String(args.file ?? ""), at.turnOf(at.threadId));
  const f = frameOf(file, args.frame);
  at.emit({ type: "canvas.changed", cwd, file: slug, frame: f.id, by: "agent", threadId: at.threadId, at: Date.now() });
  return text(`recorded: ${f.name} is built as ${f.built?.file}. The person sees them tied, and Liner Design says when either moves on from the other.`);
}

/** A row's title on the timeline for design_built; undefined for a tool that isn't its own. */
export function titleOf(tool: string, input: Record<string, unknown>): string | undefined {
  const s = (v: unknown) => String(v ?? "").slice(0, 60);
  return tool === "design_built" ? `Tie ${s(input.frame) || "a frame"} to ${s(input.file) || "its file"}` : undefined;
}
