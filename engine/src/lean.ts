/*
  Liner Design's lean: the project's DESIGN.md (at its root, else .liner/DESIGN.md), or a built-in
  one (Liner 2.0), read and parsed into tokens the inspector offers first; the design skills that
  go with it; and what a design turn is told (the "## Design" part of a message sent from the
  Design face, every provider the same words).

  The parser reads Markdown as people write it, not a format of ours: under a heading that speaks
  of colour, a name and a hex or rgb value on a line; under type, family names and sizes ("Display
  56 · Title 24"); under space, the steps ("4, 8, 12, 16"); under shape, corners; a Never or Don't
  list as rules. What it doesn't understand stays in the text, which is what an agent reads.

  Design files (design.json, frames/) are canvas.ts's: this module reads them through it, and
  writes none.
*/
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { FRAME_CHANGED } from "../../contracts/src/index.ts";
import type { DesignFile, DesignSelection, DesignSkill, Lean, LeanTokens } from "../../contracts/src/index.ts";
import type { McpResult } from "./agent-tools.ts";
import { canvasHooks, linkFree, peekFile, readFile, type DesignCall, type DesignCtx, type DesignRpc } from "./canvas.ts";
import { LINER_2 } from "./creator.ts";
import { skillsIn } from "./providers/models.ts";

export { TOOLS } from "./lean-tools.ts";

export type LeanMethod = "lean.read" | "lean.write" | "lean.skills";

/** The built-in leans, by name: Liner 2.0, Liner Code's own look. */
export const BUILTIN: Record<string, { name: string; path: string }> = { "liner-2": { name: "Liner 2.0", path: LINER_2 } };
/** A DESIGN.md over this is not a lean, it's a book: read only its start. */
const LEAN_MAX = 200_000;

const empty = (): LeanTokens => ({ colours: [], type: [], steps: [], corners: [], rules: [] });

// Parsing.

const HEX = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/i;
const FUNC = /\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\([^)]*\)/i;
const VALUE = new RegExp(`${HEX.source}|${FUNC.source}`, "gi");
/** Words that name a property, not a style, in a line of type ("width 125", "weight 700"). */
const NOT_A_STYLE = new Set(["weights", "numbers", "sizes", "radii", "heights", "width", "wdth", "weight", "tracked", "tracking", "line", "height", "size", "sizes", "step", "steps", "at", "from", "under", "over", "to", "up", "than", "of", "and", "by", "in", "on", "is", "nothing", "only", "with", "or"]);
/** Capitalised words that start a sentence or name a part, never a typeface. */
const NOT_A_FAMILY = new Set(["The", "A", "An", "And", "Or", "In", "On", "For", "With", "Sizes", "Size", "Weights", "Weight", "Numbers", "Sentence", "Nothing", "Body", "Label", "Labels", "Title", "Display", "Heading", "Headings", "Figure", "Water", "Land", "Notes", "No", "Never", "Use", "Type", "Two", "One", "Times", "Caps", "Italic", "Bold", "Regular", "Medium", "Light", "Upright", "Mono", "Sans", "Serif", "It", "Its"]);

const clean = (s: string) => s.replace(/`/g, "").replace(/\*\*?|__/g, "").trim();
const unlist = (s: string) => s.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "");
const words = (s: string) => clean(s).replace(/^[-–—:=\s]+|[-–—:=,\s]+$/g, "").trim();
const capital = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** The lean's tokens from its Markdown. Never throws: a file it can't make sense of gives empty lists. */
export function parseLean(md: string): LeanTokens {
  const out = empty();
  const text = String(md ?? "").replace(/^﻿/, "").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  type Section = { head: string; lines: string[] };
  const sections: Section[] = [{ head: "", lines: [] }];
  let fence = false;
  for (const raw of text.split(/\r?\n/)) {
    // A code block is the text's, never tokens: an example of what not to do stays an example.
    if (/^\s*```/.test(raw)) {
      fence = !fence;
      sections[sections.length - 1].lines.push("");
      continue;
    }
    if (fence) continue;
    const h = /^\s{0,3}#{1,6}\s+(.*)$/.exec(raw);
    if (h) sections.push({ head: h[1].toLowerCase(), lines: [] });
    else sections[sections.length - 1].lines.push(raw);
  }
  const families: { family: string; italic: boolean }[] = [];
  for (const s of sections) {
    const colour = /colou?r|palette|swatch/.test(s.head);
    const type = /\btype\b|typograph|font|typeface/.test(s.head);
    const space = /space|spacing|grid|layout|step/.test(s.head);
    const shape = /shape|corner|radi/.test(s.head);
    // "## Never", "## Don't", "## Rules": a heading that is the rule, not one that mentions it ("Colour: never a hex").
    const rules = /^(?:never|don'?t|do not|avoid|rules?\b|forbidden|not this)/.test(s.head);
    const never = /^never/.test(s.head) ? "Never" : /^(?:don'?t|do not)/.test(s.head) ? "Don't" : /^avoid/.test(s.head) ? "Avoid" : "";
    for (const line of joined(s.lines)) {
      if (!line.trim()) continue;
      if (colour || (!s.head && VALUE.test(line))) colours(line, out);
      VALUE.lastIndex = 0;
      if (type) typeLine(line, out, families);
      if (space) steps(line, out, space);
      if (shape && /corner|radi/i.test(line)) corners(line, out);
      if (rules) rule(line, out, never);
    }
  }
  // A family with no size of its own is still a choice the inspector offers; sizes with no family take the first one.
  const first = families[0]?.family;
  for (const t of out.type) if (!t.family && first) t.family = first;
  for (const f of families) if (!out.type.some((t) => t.family === f.family && t.name !== f.family)) out.type.push({ name: f.family, family: f.family, ...(f.italic ? { italic: true } : {}) });
  out.steps = [...new Set(out.steps)].sort((a, b) => a - b);
  return out;
}

/** A section's lines with wrapped ones joined: a paragraph is one line, a list item one line with its indented rest. */
function joined(lines: string[]) {
  const out: string[] = [];
  let open = false;
  for (const l of lines) {
    if (!l.trim()) {
      open = false;
      continue;
    }
    const item = /^\s*(?:[-*+]|\d+[.)])\s+/.test(l);
    // A list item, or a line after a blank, starts anew; so does one of a paragraph whose line before ended a sentence, for the type and colour lines people write one to a line.
    if (open && !item && !/[.:!?]\s*$/.test(out[out.length - 1])) out[out.length - 1] += ` ${l.trim()}`;
    else out.push(l);
    open = true;
  }
  return out;
}

function colours(line: string, out: LeanTokens) {
  // Tokens named without a value ("`--surface` (the panel's paper)"): the lean's own variables, offered as var(--name).
  VALUE.lastIndex = 0;
  if (!VALUE.test(line)) {
    for (const m of line.matchAll(/`--([a-z][\w-]*)`/g)) if (!out.colours.some((c) => c.name === m[1])) out.colours.push({ name: m[1], value: `var(--${m[1]})` });
    VALUE.lastIndex = 0;
    return;
  }
  VALUE.lastIndex = 0;
  const body = clean(unlist(line));
  // "Night: Deep #0C1315, Shallows #143A4A": the words before the first colon, when several values follow, name the set.
  const many = (body.match(VALUE) ?? []).length > 1;
  const set = many ? /^([A-Za-z][\w ]{0,20}):\s+(?=[A-Za-z-])/.exec(body) : null;
  const rest = set ? body.slice(set[0].length) : body;
  const parts = many ? rest.split(/[,;·]\s*(?=[A-Za-z-]|$)/) : [rest];
  for (const p of parts) {
    VALUE.lastIndex = 0;
    const m = VALUE.exec(p);
    if (!m) continue;
    let name = words(p.slice(0, m.index)).replace(/^--/, "");
    if (!name) name = words(p.slice(m.index + m[0].length)).split(/[,.;(]/)[0].trim().slice(0, 30);
    if (!name || name.length > 40) continue;
    if (set) name = `${name} (${set[1].trim().toLowerCase()})`;
    if (!out.colours.some((c) => c.name === name)) out.colours.push({ name, value: m[0] });
  }
  VALUE.lastIndex = 0;
}

function typeLine(line: string, out: LeanTokens, families: { family: string; italic: boolean }[]) {
  const body = clean(unlist(line));
  // Families: "font-family: Inter", "Family: Archivo", quoted names, or a capitalised name mid-sentence (not a style's).
  const found = new Set<string>();
  for (const m of body.matchAll(/(?:font-family|family|typeface|font)\s*[:=]\s*["']?([A-Z][\w ]{1,30}?)["']?(?=[,;.)]|$)/gi)) found.add(m[1].trim());
  for (const m of body.matchAll(/(?<![.!?]\s|^)(?<=[\s:("'])([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)(?=\s+(?:italic|for|upright|sans|serif|mono|display|text|\d)|[,.;)"']|$)/g)) {
    const name = m[1];
    if (NOT_A_FAMILY.has(name) || NOT_A_FAMILY.has(name.split(" ")[0])) continue;
    // A name followed by a size is a style ("Display 56"), not a typeface.
    if (new RegExp(`${name}\\s+\\d`).test(body)) continue;
    found.add(name);
  }
  for (const family of found) {
    const italic = new RegExp(`${family}\\s+italic`, "i").test(body);
    const have = families.find((f) => f.family === family);
    if (have) have.italic ||= italic;
    else families.push({ family, italic });
  }
  // Styles: "Display 56 · Title 24", "body 13.5px/1.55, controls and rows 13px".
  for (const seg of body.split(/\s*[·•,;|]\s*|\.\s+/)) {
    const m = /^(?:[A-Za-z][\w ]{0,20}:\s*)?([A-Za-z][A-Za-z' ]{0,30}?)\s+(\d{1,3}(?:\.\d+)?)(?:\s*[–-]\s*\d+(?:\.\d+)?)?\s*(?:px)?(?:\s*\/\s*(\d+(?:\.\d+)?(?:px)?))?(?:\s+(.*?))?\.?$/.exec(seg.trim());
    if (!m) continue;
    const name = m[1].trim();
    const last = name.split(" ").pop()!.toLowerCase();
    if (NOT_A_STYLE.has(last) || NOT_A_STYLE.has(name.split(" ")[0].toLowerCase()) || name.length < 2) continue;
    const size = Number(m[2]);
    if (!(size >= 6 && size <= 400)) continue;
    const rest = `${m[4] ?? ""} ${body}`;
    const weight = /\bweight\s+(\d{3})/i.exec(m[4] ?? "")?.[1] ?? /\b([1-9]00)\b/.exec(m[4] ?? "")?.[1];
    const family = [...found].find((f) => seg.includes(f));
    if (out.type.some((t) => t.name === name)) continue;
    out.type.push({ name, size, ...(family ? { family } : {}), ...(weight ? { weight: Number(weight) } : {}), ...(m[3] ? { line: m[3] } : {}), ...(/\bitalic\b/i.test(m[4] ?? "") ? { italic: true } : {}) });
    void rest;
  }
}

function steps(line: string, out: LeanTokens, space: boolean) {
  const body = clean(line);
  // The longest run of numbers with commas between: "4, 8, 12, 16, 24, 32".
  let best: number[] = [];
  for (const m of body.matchAll(/\d+(?:\.\d+)?(?:px)?(?:\s*,\s*\d+(?:\.\d+)?(?:px)?)+/g)) {
    const run = m[0].split(",").map((x) => parseFloat(x));
    if (run.length > best.length) best = run;
  }
  if (best.length >= 3 && (space || /step|space|scale|gap/i.test(body))) out.steps.push(...best.filter((n) => n >= 0 && n <= 512));
}

function corners(line: string, out: LeanTokens) {
  const body = clean(unlist(line));
  for (const seg of body.split(/\s*[,;·(]\s*|\.\s+|\)\s*/)) {
    const s = seg.trim().replace(/^(?:radii|radius|corners?)\s*:\s*/i, "");
    let name = "";
    let value = NaN;
    const after = /^([A-Za-z][A-Za-z' ]{0,30}?)\s+(\d{1,4})(?:px)?\.?$/.exec(s);
    const before = /^(\d{1,4})(?:px)?\s+([A-Za-z][A-Za-z' ]{0,30})$/.exec(s);
    if (after) [name, value] = [after[1], Number(after[2])];
    else if (before) [name, value] = [before[2], Number(before[1])];
    else continue;
    name = name.trim();
    if (/^(?:corners?|radius|radii|all|three corners)$/i.test(name)) name = "Corners";
    if (/^(?:steps?|pad|blocks pad|space)/i.test(name) || NOT_A_STYLE.has(name.toLowerCase())) continue;
    if (!out.corners.some((c) => c.name === name)) out.corners.push({ name, value });
  }
}

function rule(line: string, out: LeanTokens, never: string) {
  const listed = /^\s*(?:[-*+]|\d+[.)])\s+/.test(line);
  const body = clean(unlist(line));
  const parts = listed ? [body] : body.split(/;\s*|\.\s+/);
  for (let p of parts) {
    p = p.trim().replace(/\.$/, "");
    if (p.length < 3) continue;
    if (never && !/^(?:never|no|don'?t|do not|avoid|not)\b/i.test(p)) p = `${never} ${/^[A-Z]{2}|^\d/.test(p) ? p : p[0].toLowerCase() + p.slice(1)}`;
    else p = capital(p);
    if (out.rules.length < 40 && !out.rules.includes(p)) out.rules.push(p);
  }
}

// Reading and writing the lean.

/** The project's own lean: DESIGN.md at the folder's root, else .liner/DESIGN.md. */
export function leanFile(cwd: string): { path: string; off: "root" | "liner" } | null {
  for (const [rel, off] of [["DESIGN.md", "root"], [join(".liner", "DESIGN.md"), "liner"]] as const) {
    const abs = join(cwd, rel);
    if (existsSync(abs) && statSync(abs).isFile()) return { path: rel, off };
  }
  // A file named in another case (design.md) on a filesystem that minds.
  try {
    const hit = readdirSync(cwd).find((n) => n.toLowerCase() === "design.md");
    if (hit && statSync(join(cwd, hit)).isFile()) return { path: hit, off: "root" };
  } catch {
    // no folder
  }
  return null;
}

const readText = (abs: string) => {
  try {
    return readFileSync(abs, "utf8").slice(0, LEAN_MAX);
  } catch {
    return "";
  }
};

/** A built-in lean, by name. */
export function builtinLean(name = "liner-2"): Lean {
  const b = BUILTIN[name] ?? BUILTIN["liner-2"];
  const text = readText(b.path);
  return { path: b.path, text, tokens: parseLean(text), off: "builtin", builtin: BUILTIN[name] ? name : "liner-2" };
}

/**
  The lean a design file follows: the file it names, or the built-in one it names; without a
  file (or one that names neither), the folder's DESIGN.md, else nothing. `path` is from the
  folder for a project file, absolute for a built-in one.
*/
export function readLean(cwd: string, file?: Pick<DesignFile, "lean"> | null): Lean {
  const writes = leanTarget(cwd, file);
  return { ...leanOf(cwd, file), rev: revOf(cwd, writes), writes };
}

/**
  The project file a lean is read from and written to, from the folder: the design file's own
  lean.path when it's there (through the folder and link checks), else the folder's DESIGN.md (or
  .liner/DESIGN.md), else DESIGN.md at the root, made on the first write. A built-in lean is written
  to the same place, so its first edit becomes the project's own.
*/
export function leanTarget(cwd: string, file?: Pick<DesignFile, "lean"> | null): string {
  const own = file?.lean;
  if (own?.path && !own.builtin) {
    const abs = inside(cwd, own.path);
    if (abs && existsSync(abs)) return relative(cwd, safePath(cwd, abs));
  }
  return leanFile(cwd)?.path ?? "DESIGN.md";
}

const revOf = (cwd: string, rel: string) => {
  try {
    return createHash("sha256").update(readFileSync(safePath(cwd, join(cwd, rel)))).digest("hex").slice(0, 16);
  } catch {
    return "";
  }
};

/**
  The project's lean file's revision, as lean.write's `base` names it: a short hash of its text, ""
  when there's none (or it can't be read, a link out of the folder). With a design file, that file's own lean.
*/
export function leanRev(cwd: string, file?: Pick<DesignFile, "lean"> | null) {
  return revOf(cwd, leanTarget(cwd, file));
}

function leanOf(cwd: string, file?: Pick<DesignFile, "lean"> | null): Lean {
  const own = file?.lean;
  if (own?.builtin) return builtinLean(own.builtin);
  if (own?.path) {
    // design.json's lean.path is the agent's to write: it goes through the same folder and link checks as one the app gives.
    const abs = inside(cwd, own.path);
    if (abs && existsSync(abs)) {
      safePath(cwd, abs);
      const text = readText(abs);
      return { path: relative(cwd, abs), text, tokens: parseLean(text), off: relative(cwd, abs).startsWith(".liner") ? "liner" : "root" };
    }
  }
  const at = leanFile(cwd);
  if (!at) return { text: "", tokens: empty(), off: "none" };
  const text = readText(safePath(cwd, join(cwd, at.path)));
  return { path: at.path, text, tokens: parseLean(text), off: at.off };
}

/**
  Writes the lean exactly where lean.read with the same design file read it (leanTarget: its own
  lean.path, else the project's DESIGN.md, made at the root when there's none) and reads it back.
  With `base`, refused when that file changed since it was read.
*/
export function writeLean(cwd: string, text: string, base?: string, file?: Pick<DesignFile, "lean"> | null): Lean {
  if (typeof text !== "string") throw new Error("The lean is text.");
  if (text.length > LEAN_MAX) throw new Error("That DESIGN.md is too long; keep the lean under 200 KB.");
  const at = leanTarget(cwd, file);
  // Written over what was read, or not at all: someone (an agent, another window) changed it meanwhile.
  if (base !== undefined && base !== revOf(cwd, at)) throw new Error(`${FRAME_CHANGED} ${at} changed since it was read, so nothing was written. Read it again and make the change on what's there now.`);
  atomic(safePath(cwd, join(cwd, at)), text);
  return readLean(cwd, file);
}

// Skills.

/** The words that make a skill a design skill, in its name or description. One list, here. */
export const DESIGN_WORDS = ["design", "brand", "ui", "ux", "front end", "front-end", "frontend", "site", "website", "page", "visual", "logo", "typography", "colour", "color", "layout", "landing", "css", "style", "art direction", "illustration", "icon", "mockup", "figma"];
const DESIGNISH = new RegExp(`\\b(?:${DESIGN_WORDS.map((w) => w.replace(/[-\s]/g, "[-\\s]?")).join("|")})s?\\b`, "i");
/** A skill is a design skill when its name or description speaks of design. */
export const isDesignSkill = (s: { name: string; description: string }) => DESIGNISH.test(`${s.name.replace(/[-_]/g, " ")} ${s.description}`);

/** Where this Mac's home is for skills: the env's HOME (tests point it at a temp folder), else the user's. */
export function homeOf(env: NodeJS.ProcessEnv) {
  return env.HOME || homedir();
}

/**
  The skills an agent may be handed with the lean: yours (~/.claude/skills, ~/.codex/skills), the
  folder's own (.claude/skills), and Liner Code's (engine/src/skills); the first of a name wins.
  Design skills first, then the rest (kind "other"). `loaded`: on for the design file. With no
  folder (Design Home, before a design has one), yours and Liner Code's only.
*/
export function listSkills(cwd: string | undefined, env: NodeJS.ProcessEnv, loaded: string[] = []): DesignSkill[] {
  const home = homeOf(env);
  const roots = [join(env.CLAUDE_CONFIG_DIR || join(home, ".claude"), "skills"), ...(cwd ? [join(cwd, ".claude", "skills")] : []), join(env.CODEX_HOME || join(home, ".codex"), "skills"), join(import.meta.dirname, "skills")];
  const seen = new Set<string>();
  const out: DesignSkill[] = [];
  for (const root of roots) {
    for (const s of skillsIn([root])) {
      if (seen.has(s.name)) continue;
      seen.add(s.name);
      out.push({ name: s.name, description: s.description, path: join(s.path!, "SKILL.md"), loaded: loaded.includes(s.name), kind: isDesignSkill(s) ? "design" : "other" });
    }
  }
  const rank = (s: DesignSkill) => (s.kind === "design" ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

// What a design turn is told.

/** What the app sends with a message from the Design face (thread.send's `design`). */
export type DesignMark = { file: string; sel?: DesignSelection };

const NOTE_MAX = 2000;

/**
  The "## Design" part of a message sent from the Design face: where the design file is, its frames
  and their files, the rule that a frame is one HTML file whose data-l ids stay, the lean and the
  loaded skills to read first, the selection in short, and the lean's rules. The same words for
  every provider (the tools by their plain names; toolsNote gives each tool's own), under 2,000
  characters. Reads the design file from disk; one that isn't there yet is said so.
*/
export function designNote(cwd: string, mark: DesignMark, env: NodeJS.ProcessEnv = process.env): string {
  const slug = safeSlug(mark.file);
  const dir = `.liner/designs/${slug}/`;
  const file = slug ? peekFile(cwd, slug) : null;
  // A lean that can't be read (a link out of the folder) leaves the note without it, not the turn without its note.
  let lean: Lean;
  try {
    lean = readLean(cwd, file);
  } catch {
    lean = { text: "", tokens: empty(), off: "none" };
  }
  const skills = file ? listSkills(cwd, env, file.lean.skills).filter((s) => s.loaded) : [];
  const frames = file?.frames ?? [];
  const nameOf = (id: string) => frames.find((f) => f.id === id)?.name ?? id;
  const head = [
    "## Design",
    "",
    `This message comes from Liner Design, the canvas beside this session. The design file is “${file?.title ?? slug}”, ${dir} in this folder (design.json, frames/, assets/).`,
    "A frame is one whole HTML file at its size. Change it with your own file tools or with design_frame and design_node; make a new one with design_frame. Every element keeps its data-l id: never remove or reuse one (new elements get theirs when the file is read).",
  ];
  const frameLines = frames.map((f) => `- ${f.name}, ${f.w} × ${f.h}: ${f.kind === "live" ? `live, ${f.url ?? ""}` : `${dir}${f.path ?? `frames/${f.id}.html`}`}`);
  const read = [lean.path ? `the lean, ${lean.path} (its rules win)` : "", ...skills.map((s) => s.path)].filter(Boolean);
  const sel = mark.sel;
  const picked = sel ? [...sel.frames.map((f) => nameOf(f)), ...sel.nodes.map((n) => `${nameOf(n.frame)} › ${n.id} ${short(n.html)}`)] : [];
  const tail = [
    read.length ? `Read first: ${read.join("; ")}.` : "",
    // The lean is optional: with none, the agent goes by the skills and its own judgement, and is never steered to write one.
    lean.path ? "" : skills.length ? "This design has no lean: go by the skills above, and otherwise your own judgement, keeping to what the frames already do." : "This design has no lean: use any skills you have loaded, and otherwise your own judgement, keeping to what the frames already do.",
    picked.length ? `Selected: ${picked.join("; ")}. design_selection gives all of it, and inspector changes not written yet.` : "Nothing is selected.",
    lean.tokens.rules.length ? `The lean's rules: ${lean.tokens.rules.join("; ")}.` : "",
    "Look at a frame with design_shot before you say it's done.",
  ].filter(Boolean);
  // Frames go first to the cut: the rest is what every turn needs.
  let shown = frameLines.length;
  const make = () => [...head, ...(frames.length ? ["Frames:", ...frameLines.slice(0, shown), ...(shown < frameLines.length ? [`- and ${frameLines.length - shown} more (design_files lists them)`] : [])] : ["There are no frames yet."]), ...tail].join("\n");
  let note = make();
  while (note.length > NOTE_MAX && shown > 3) {
    shown--;
    note = make();
  }
  return note.length > NOTE_MAX ? `${note.slice(0, NOTE_MAX - 1)}…` : note;
}

const short = (html: string) => {
  const s = String(html ?? "").replace(/\s+/g, " ").trim();
  return s.length > 90 ? `(${s.slice(0, 88)}…)` : `(${s})`;
};

// Small file helpers. Design files themselves are read and written by canvas.ts only.

/** A design file's slug as a turn's mark gives it: letters, digits and dashes, nothing that climbs out. */
export const safeSlug = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 64);

/**
  Refuses a path under the folder when any part of the way to it (each folder, and the file itself)
  is a link: for .liner/, where a planted link would carry Liner's writes out of the project. The
  check itself is canvas.ts's linkFree, the one the design folders use; this takes an absolute path.
*/
export function noLinks(cwd: string, abs: string) {
  const rel = relative(cwd, abs);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`${abs} isn't inside this folder.`);
  // The one check, canvas.ts's linkFree: every part of the way down, the file included.
  linkFree(cwd, rel);
  return abs;
}

/**
  A lean file that stays in the folder: under .liner/, no link anywhere on the way; elsewhere (a
  DESIGN.md at the root), its real place, following links, must still be inside the folder.
*/
export function safePath(cwd: string, abs: string) {
  const rel = relative(cwd, abs);
  if (/^\.liner(?:[\\/]|$)/.test(rel)) return noLinks(cwd, abs);
  let real = abs;
  try {
    real = realpathSync(abs);
  } catch {
    // not there yet: its folder must be inside
    try {
      real = join(realpathSync(dirname(abs)), basename(abs));
    } catch {
      return abs;
    }
  }
  const inner = relative(realpathSync(cwd), real);
  if (!inner || inner.startsWith("..") || isAbsolute(inner)) throw new Error(`${rel} leads out of this folder (it's a link), so Liner Design doesn't read or write it.`);
  return abs;
}

/** A path from the folder, or absolute inside it; null when it climbs out. */
export function inside(cwd: string, p: string) {
  const abs = isAbsolute(p) ? resolve(p) : resolve(cwd, p);
  const rel = relative(cwd, abs);
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? abs : null;
}

export function atomic(abs: string, data: string | Buffer) {
  mkdirSync(dirname(abs), { recursive: true });
  const tmp = `${abs}.${process.pid}.${createHash("sha1").update(String(Math.random())).digest("hex").slice(0, 6)}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, abs);
}

// The module's face.

/** The lean's RPC handlers, for api.ts. */
export function rpc(x: () => DesignCtx): DesignRpc<LeanMethod> {
  // design_files names the loaded skills' SKILL.md paths through canvas.ts's hook, which can't import this module.
  canvasHooks.skills = (cwd, file) => {
    let env = process.env;
    try {
      env = x().env;
    } catch {
      // no ctx here (a test's api): the process's own
    }
    return listSkills(cwd, env, peekFile(cwd, file)?.lean.skills ?? []);
  };
  return {
    "lean.read": ({ cwd, file }) => {
      const root = x().folder(cwd);
      return readLean(root, file ? readFile(x(), root, file) : null);
    },
    "lean.write": ({ cwd, text, base, file }) => {
      const root = x().folder(cwd);
      return writeLean(root, text, base, file ? readFile(x(), root, file) : null);
    },
    "lean.skills": ({ cwd, file }) => {
      const c = x();
      if (cwd === undefined || cwd === null || cwd === "") return listSkills(undefined, c.env);
      const root = c.folder(cwd);
      return listSkills(root, c.env, file ? readFile(c, root, file).lean.skills : []);
    },
  };
}

/** The lean has no tools of its own: an agent reads it as a file, by the path design_files gives. */
export async function call(name: string, args: Record<string, unknown>, at: DesignCall): Promise<McpResult> {
  void args;
  void at;
  throw new Error(`${name} isn't one of the lean's tools.`);
}

/** A row's title on the timeline for one of the lean's tools; undefined for a tool that isn't its own. */
export function titleOf(tool: string, input: Record<string, unknown>): string | undefined {
  void tool;
  void input;
  return undefined;
}
