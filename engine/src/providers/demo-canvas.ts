/*
  The Demo agent on Liner Design's canvas. A message from the Design face carries the "## Design"
  note (lean.ts designNote); the Demo reads the ask under it and does what it says, with its own
  file tools as any agent would, and only in its sample project or in a design on its own made for
  it (design.new's folder: OpenOptions.designOnItsOwn); elsewhere it answers in words, as demo.ts
  promises for every edit:

  - the first ask draws Foreshore, the tide tables sample of the approved mockup: seven frames one
    after another, into empty frames Design Home made where there are some, in two tidy rows. It
    follows the folder's lean when there is one; it writes a DESIGN.md only when the ask says to
    (the lean is optional);
  - Build writes a small page per named frame under src/pages/, from the frame's own HTML, and
    records each with design_built; Update code writes the frame again into its file; Bring it into
    the frame takes the file's change back into the frame, keeping its data-l ids;
  - Send to code puts the held changes into the file the ask names, when it names one here;
  - 3 more like this draws three different takes into the take frames the ask names;
  - a Fix from Checks fixes the named finding in the named frame;
  - an ask that says dark, night or light turns the selected frame to the other light.

  Frames are found by their exact id or name. design_built goes through Liner Code's own tools, the
  same door as demo.ts's design_show. The frames are copies of docs/demo/foreshore/ beside this file
  (demo-foreshore/): foreshore.css inlined, fonts from Google Fonts as they were.
*/
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { DesignFile, DesignFrame } from "../../../contracts/src/index.ts";
import { designDir, inDesign } from "../canvas.ts";
import { addressable, applyOps, attr, outline, parse } from "../canvas-html.ts";
import { atomic, inside, leanFile, noLinks, safeSlug } from "../lean.ts";
import type { OpenOptions, TurnSink } from "./types.ts";

/** The sample's files, shipped with the engine. */
export const FORESHORE = join(import.meta.dirname, "demo-foreshore");

type Spec = { id: string; name: string; src: string; w: number; h: number; x: number; y: number; night?: boolean; screen?: false };
/** Foreshore's frames, in the order they're drawn, and where they sit: the big ones in a row, the phones under them, 160 apart in a row and 240 between the rows, so each frame's label clears its neighbours even zoomed far out. */
export const TIDE_FRAMES: Spec[] = [
  { id: "desktop-today", name: "Desktop / Today", src: "desktop.html", w: 1280, h: 800, x: 0, y: 0 },
  { id: "brand-board", name: "Brand / Board", src: "brand.html", w: 1280, h: 800, x: 1440, y: 0, screen: false },
  { id: "phone-today", name: "Phone / Today", src: "phone-today.html", w: 390, h: 844, x: 0, y: 1040 },
  { id: "phone-station", name: "Phone / Station", src: "phone-station.html", w: 390, h: 844, x: 550, y: 1040 },
  { id: "phone-week", name: "Phone / Week", src: "phone-week.html", w: 390, h: 844, x: 1100, y: 1040 },
  { id: "dark-today", name: "Dark / Today", src: "phone-today.html", w: 390, h: 844, x: 1650, y: 1040, night: true },
  { id: "web-launch", name: "Web / Launch", src: "landing.html", w: 1280, h: 800, x: 2880, y: 0 },
];

/** A frame's page as the Demo draws it: day, or night (class "night" on <html>). */
export function foreshorePage(src: string, night = false) {
  const html = readFileSync(join(FORESHORE, src), "utf8");
  return night ? toNight(html) : html;
}
const toNight = (html: string) => html.replace(/<html([^>]*)>/i, (m, a: string) => (/class=/.test(a) ? m.replace(/class="([^"]*)"/, 'class="$1 night"') : `<html${a} class="night">`));
const toDay = (html: string) => html.replace(/(<html[^>]*class="[^"]*?)\s*\bnight\b/i, "$1").replace(/<html([^>]*) class=""/i, "<html$1");
const isNight = (html: string) => /<html[^>]*class="[^"]*\bnight\b/i.test(html);

/** The design file a design turn names, from its note: .liner/designs/<slug>/. */
export const slugOfNote = (text: string) => safeSlug(/\.liner\/designs\/([a-z0-9-]+)\//.exec(text)?.[1] ?? "") || "tide-tables";
/** The ask under the note: the runtime puts it after the note's second blank line. */
export const askOf = (text: string) => (/^## Design\n/.test(text) ? text.split("\n\n").slice(2).join("\n\n") : text).trim();

/** The Demo's sample project: the one with the tide tables' own code. */
export const isSample = (cwd: string) => {
  try {
    return readFileSync(join(cwd, "src/tides.js"), "utf8").includes("nextHigh");
  } catch {
    return false;
  }
};

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new Error("stopped"));
    const stop = () => (clearTimeout(t), reject(new Error("stopped")));
    const t = setTimeout(() => (signal.removeEventListener("abort", stop), resolve()), ms);
    signal.addEventListener("abort", stop, { once: true });
  });

/** How fast words come: a model's pace, or at once in a test (a gap of 0). */
let pace = 1;
async function say(sink: TurnSink, block: string, text: string, signal: AbortSignal, ms = 26 * pace) {
  const words = text.match(/\S+\s*/g) ?? [];
  for (let i = 0; i < words.length; i += 2) {
    sink.text(words.slice(i, i + 2).join(""), block);
    await pause(ms, signal);
  }
}
async function think(sink: TurnSink, block: string, text: string, signal: AbortSignal) {
  const words = text.match(/\S+\s*/g) ?? [];
  for (let i = 0; i < words.length; i += 2) {
    sink.reasoning(words.slice(i, i + 2).join(""), block);
    await pause(20 * pace, signal);
  }
}

/**
  design.json read and written as an agent's own file tools would, plain JSON on disk: canvas.ts
  reads it back and makes it whole (and the watcher tells the canvas), as it does for any agent.
*/
function readIndex(cwd: string, slug: string): DesignFile | null {
  try {
    const d = JSON.parse(readFileSync(indexPath(cwd, slug), "utf8")) as DesignFile;
    return d && Array.isArray(d.frames) ? { ...d, pages: Array.isArray(d.pages) ? d.pages : [], lean: d.lean ?? { skills: [] } } : null;
  } catch {
    return null;
  }
}
const indexPath = (cwd: string, slug: string) => noLinks(cwd, join(designDir(cwd, slug), "design.json"));
const writeIndex = (cwd: string, slug: string, d: DesignFile) => atomic(indexPath(cwd, slug), `${JSON.stringify(d, null, 2)}\n`);

/** A frame's file, by its path in design.json, only through the checks: frames/<slug>.html, inside the design's folder, no link on the way. */
function frameFile(cwd: string, slug: string, f: Pick<DesignFrame, "id" | "path">) {
  const path = f.path ?? `frames/${f.id}.html`;
  if (!/^frames\/[a-z0-9][a-z0-9-]{0,63}\.html$/.test(path)) throw new Error(`${path} isn't a frame's file.`);
  return noLinks(cwd, inDesign(designDir(cwd, slug), path));
}
const readFrameOf = (cwd: string, slug: string, f: Pick<DesignFrame, "id" | "path">) => {
  try {
    return readFileSync(frameFile(cwd, slug, f), "utf8");
  } catch {
    return "";
  }
};
/** A file of the sample project the Demo may write: inside it, not under .liner/, no link on the way. */
function projectFile(cwd: string, rel: string) {
  const abs = inside(cwd, rel);
  if (!abs || /^\.liner(?:[\\/]|$)/.test(relative(cwd, abs))) return null;
  try {
    return noLinks(cwd, abs);
  } catch {
    return null;
  }
}

/** A frame by its exact id, else its exact name: "Phone / Station" is never "Phone". */
export const frameNamed = (file: DesignFile, ref: string) => file.frames.find((f) => f.id === ref.trim()) ?? file.frames.find((f) => f.name === ref.trim());

/** A frame with nothing in it beyond the starter page (Design Home's "Desktop and phone"). */
export function isEmptyFrame(html: string) {
  if (!html.trim()) return true;
  const o = outline(html);
  return !o || (!o.children.length && !o.text);
}

const stripIds = (html: string) => html.replace(/\sdata-l="[^"]*"/g, "");

/** One of Liner Code's tools, through the same door any agent's call takes (demo.ts's design_show does too). */
async function liner(o: OpenOptions, tool: string, args: Record<string, unknown>, signal: AbortSignal): Promise<{ ok: boolean; said: string }> {
  try {
    if (!o.mcp) throw new Error("Liner Code's tools aren't with this session.");
    const r = await fetch(o.mcp.env.LINER_SURFACE_URL, { method: "POST", headers: { "content-type": "application/json", "x-liner-surface": o.mcp.env.LINER_SURFACE_KEY }, body: JSON.stringify({ tool, args }), signal });
    const b = (await r.json()) as { ok: boolean; result?: { content: { type: string; text?: string }[]; isError?: boolean }; error?: string };
    return { ok: b.ok && !b.result?.isError, said: b.result?.content.find((c) => c.type === "text")?.text ?? b.error ?? "" };
  } catch (e) {
    if (signal.aborted) throw e;
    return { ok: false, said: e instanceof Error ? e.message : String(e) };
  }
}

type Ctx = { o: OpenOptions; sink: TurnSink; signal: AbortSignal; t: string; slug: string; rel: string; gap: number; n: number };
const step = async (c: Ctx, tool: string, kind: "read" | "write" | "edit" | "other", title: string, path: string | undefined, run: () => Promise<string> | string) => {
  const key = `${c.t}-s${++c.n}`;
  sink(c, { key, tool, toolKind: kind, title, ...(path ? { path } : {}), status: "running" });
  await pause(c.gap * 0.6, c.signal);
  try {
    const output = await run();
    sink(c, { key, tool, toolKind: kind, title, ...(path ? { path } : {}), status: "done", output });
    return true;
  } catch (e) {
    if (c.signal.aborted) throw e;
    sink(c, { key, tool, toolKind: kind, title, ...(path ? { path } : {}), status: "failed", output: e instanceof Error ? e.message : String(e) });
    return false;
  }
};
const sink = (c: Ctx, u: Parameters<TurnSink["tool"]>[0]) => c.sink.tool(u);
const done = (c: Ctx, inTok = 3100, outTok = 1400) => c.sink.usage({ inputTokens: inTok, outputTokens: outTok, cacheReadTokens: 4200, costUsd: 0, contextTokens: 24000, contextWindow: 200000 });

/** A new design file's index, as canvas.create makes one. */
const fresh = (slug: string): DesignFile => ({ v: 1, id: slug, title: "Tide tables", pages: [{ id: "p1", name: "Page 1" }], frames: [], lean: { skills: [] } });

/**
  One design turn of the Demo. `gap`: the pause between steps (0 in tests). Says what it did, as
  the other scripted turns do; writes only in its sample project, and never in a session that only reads.
*/
export async function drawTides(o: OpenOptions, text: string, sink: TurnSink, signal: AbortSignal, t: string, gap = 1100) {
  pace = gap ? 1 : 0;
  const slug = slugOfNote(text);
  const ask = askOf(text);
  const c: Ctx = { o, sink, signal, t, slug, rel: `.liner/designs/${slug}`, gap, n: 0 };
  if (o.access === "read") {
    await think(sink, `${t}-r`, "This session only reads, so I can't change the design.", signal);
    return say(sink, `${t}-a`, `I'd ${whatIdDo(ask)}, but this session only reads. Switch it to Edits and ask again.`, signal);
  }
  if (!isSample(o.cwd) && !o.designOnItsOwn) {
    await think(sink, `${t}-r`, "This isn't the Demo's sample project or a design on its own, so I won't write anything here.", signal);
    return say(sink, `${t}-a`, `I'm the Demo, so I only draw and change files in my sample project (Sample project in the sidebar) or in a design on its own. Here I'd ${whatIdDo(ask)}.`, signal);
  }
  const file = readIndex(o.cwd, slug);
  const drawn = Boolean(file) && TIDE_FRAMES.every((s) => file!.frames.some((f) => f.name === s.name));
  if (/^Build (?:this frame|these frames) of the design file/.test(ask)) return build(c, ask, file);
  if (/changed since it was built as \S+\. Change only this in/.test(ask)) return update(c, ask, file);
  if (/^\S+ changed after .+ was built from it/.test(ask)) return bring(c, ask, file);
  if (/^Change the code so the running app shows/.test(ask)) return toCode(c, ask);
  if (/^Draw (?:3 more ways|another way) of “/.test(ask)) return takes(c, ask, file);
  if (/^Fix (?:this check in|these \d* ?checks? on the canvas)/.test(ask)) return fix(c, ask, file);
  if (drawn && /\b(?:dark|night|light)\b/i.test(ask)) return light(c, text, ask, file!);
  if (!drawn) return drawAll(c, file, ask);
  await think(sink, `${t}-r`, `"${ask.split("\n")[0].slice(0, 80)}": the tide tables are drawn already, and that's an ask the Demo has no script for.`, signal);
  await say(sink, `${t}-a`, "The tide tables are on the canvas already. I'm the Demo, so I can do what the canvas's own buttons ask: Build frames into the sample project, Update code or Bring it into the frame, Send to code from a live frame, 3 more like this, Fix a check, or turn a frame to night or day. I didn't change anything this time.", signal);
  done(c, 1800, 300);
}

/** What the Demo would do for an ask, in words, where it doesn't write. */
function whatIdDo(ask: string) {
  if (/^Build /.test(ask)) return "write a page in the project for each frame named and record each with design_built";
  if (/changed since it was built/.test(ask)) return "write each frame again into the file it was built as";
  if (/was built from it/.test(ask)) return "bring the file's change back into its frame";
  if (/^Change the code so/.test(ask)) return "put the held changes into the file the ask names";
  if (/^Draw (?:3 more ways|another way)/.test(ask)) return "draw three different takes of the frame into the take frames";
  if (/^Fix /.test(ask)) return "fix the named check in its frame";
  return "draw the tide tables as seven frames (desktop, the brand board, three phone screens, the night chart and the launch page)";
}

// The first drawing.

async function drawAll(c: Ctx, had: DesignFile | null, ask: string) {
  const { o, sink, signal, t, slug, rel, gap } = c;
  // The lean: the folder's own when there is one. With none, a DESIGN.md is written only when the ask says to.
  const lean = leanFile(o.cwd);
  const write = !lean && /\bDESIGN\.md\b/i.test(ask);
  const leanRel = lean?.path ?? "DESIGN.md";
  await think(sink, `${t}-r`, `A home screen for the tide tables, on the canvas. ${lean ? "I'll read the lean first, then draw" : write ? `I'll write ${leanRel} first, as asked, then draw` : "There's no lean here, so I'll draw in Foreshore's own look"} the frames one by one: the desktop day, the brand board, the phone screens, the night chart and the launch page.`, signal);
  const plan = (n: number) =>
    sink.plan([
      { title: lean ? "Read the lean" : write ? `Write ${leanRel}` : "Settle the look", status: n > 0 ? "completed" : "in_progress" },
      { title: "Draw the desktop and the brand board", status: n > 2 ? "completed" : n > 0 ? "in_progress" : "pending" },
      { title: "Draw the phone screens and the night chart", status: n > 6 ? "completed" : n > 2 ? "in_progress" : "pending" },
      { title: "Draw the launch page", status: n > 7 ? "completed" : n > 6 ? "in_progress" : "pending" },
    ]);
  plan(0);
  let wrote = false;
  if (lean || write) {
    const leanCall = { key: `${t}-lean`, tool: lean ? "Read" : "Write", toolKind: lean ? ("read" as const) : ("write" as const), title: `${lean ? "Read" : "Write"} ${leanRel}`, path: leanRel };
    sink.tool({ ...leanCall, status: "running" });
    await pause(gap * 0.7, signal);
    if (write) {
      const abs = projectFile(o.cwd, leanRel);
      if (abs) atomic(abs, readFileSync(join(FORESHORE, "DESIGN.md"), "utf8"));
      wrote = Boolean(abs);
    }
    sink.tool({ ...leanCall, status: "done", output: lean ? "The project's lean" : "Foreshore's lean: the chart's colours, two voices of type, steps of 4, corners 4" });
  }
  let file: DesignFile = had ?? fresh(slug);
  if (wrote) file = { ...file, lean: { ...file.lean, path: leanRel, builtin: undefined } };
  if (!file.frames.some((f) => TIDE_FRAMES.some((s) => s.name === f.name)) && /^(?:untitled|design)$/i.test(file.title)) file = { ...file, title: "Tide tables" };
  if (!file.pages.length) file = { ...file, pages: [{ id: "p1", name: "Page 1" }] };
  const page = file.pages[0].id;

  // Empty frames Design Home made take the Demo's first desktop and phone: same id, renamed.
  const taken = new Map<string, DesignFrame>();
  for (const f of file.frames) {
    if (f.kind !== "drawn" || f.by?.agent === "demo" || TIDE_FRAMES.some((s) => s.name === f.name) || !isEmptyFrame(readFrameOf(o.cwd, slug, f))) continue;
    const want = f.w >= 1000 ? "Desktop / Today" : f.w <= 500 ? "Phone / Today" : "";
    if (want && !taken.has(want)) taken.set(want, f);
  }
  // The rest of what's there stays where it is; the Demo's two rows go to its right.
  const others = file.frames.filter((f) => ![...taken.values()].includes(f) && !TIDE_FRAMES.some((s) => s.name === f.name));
  const dx = others.length ? Math.max(...others.map((f) => f.x + f.w)) + 240 : 0;
  const dy = others.length ? Math.min(...others.map((f) => f.y)) : 0;
  writeIndex(o.cwd, slug, file);
  plan(1);
  let n = 1;
  for (const s of TIDE_FRAMES) {
    const have = file.frames.find((f) => f.name === s.name) ?? taken.get(s.name);
    const id = have?.id ?? s.id;
    const path = have?.path ?? `frames/${id}.html`;
    const call = { key: `${t}-f${n}`, tool: "Write", toolKind: "write" as const, title: `Draw ${s.name}`, path: `${rel}/${path}` };
    sink.tool({ ...call, status: "running", input: JSON.stringify({ file_path: `${rel}/${path}`, size: `${s.w} × ${s.h}` }) });
    await pause(gap, signal);
    atomic(frameFile(o.cwd, slug, { id, path }), foreshorePage(s.src, s.night));
    // Its own frames keep where the person moved them; anything else goes in the rows.
    const mine = have?.by?.agent === "demo";
    const frame: DesignFrame = { ...(have ?? {}), id, page: have?.page ?? page, name: s.name, kind: "drawn", path, x: mine ? have!.x : s.x + dx, y: mine ? have!.y : s.y + dy, w: s.w, h: s.h, by: { agent: "demo", name: "Demo" }, ...(s.screen === false ? { screen: false as const } : {}) };
    // Read again before each write: the canvas may have moved a frame, or taken the new file in, meanwhile.
    file = readIndex(o.cwd, slug) ?? file;
    file = { ...file, frames: file.frames.some((f) => f.id === id) ? file.frames.map((f) => (f.id === id ? { ...frame, ...(f.by?.agent === "demo" ? { x: f.x, y: f.y } : {}) } : f)) : [...file.frames, frame] };
    writeIndex(o.cwd, slug, file);
    sink.tool({ ...call, status: "done", output: `${s.w} × ${s.h}${s.night ? ", the night chart" : ""}${taken.get(s.name)?.id === id ? `, into the empty “${taken.get(s.name)!.name}”` : ""}` });
    plan(++n);
  }
  plan(8);
  await say(
    sink,
    `${t}-a`,
    `The tide tables are on the canvas: seven frames in “${file.title}”. Desktop / Today leads, the day drawn the way a sea chart draws a coast, with the time of high water standing on the high-water line. Brand / Board has the mark, the colours and the two voices of type; the phones carry Today, a station and the week, and Dark / Today is the night chart. Web / Launch is the launch page.${taken.size ? ` I drew into the empty ${[...taken.values()].map((f) => `“${f.name}”`).join(" and ")} rather than beside ${taken.size === 1 ? "it" : "them"}.` : ""}\n\n${lean ? `I followed ${leanRel}: steps of 4, corners 4, and magenta only for now.` : wrote ? `I wrote ${leanRel} as you asked, Foreshore's lean, and followed it: steps of 4, corners 4, and magenta only for now.` : "There's no lean here, so I drew it in Foreshore's own look: steps of 4, corners 4, and magenta only for now."} Select any part of a frame and say what should change.`,
    signal,
  );
  done(c, 5200, 14800);
}

// Build, Update code, Bring it into the frame.

/** Where the Demo builds a frame: a page of the sample app, per frame. */
export const builtPath = (f: Pick<DesignFrame, "id">) => `src/pages/${f.id}.html`;
const builtPage = (f: DesignFrame, html: string) => stripIds(html).replace(/^(<!doctype[^>]*>\s*)?/i, (m) => `${m}<!-- The tide tables' ${f.name}, built from its frame on Liner Design's canvas. -->\n`);

async function build(c: Ctx, ask: string, file: DesignFile | null) {
  const { o, sink, signal, t, slug } = c;
  const named = [...ask.matchAll(/^- (.+?) \(\.liner\/designs\/[a-z0-9-]+\/frames\/[a-z0-9-]+\.html, \d+ × \d+\)$/gm)].map((m) => m[1]);
  const frames = named.map((n) => (file ? frameNamed(file, n) : undefined)).filter((f): f is DesignFrame => Boolean(f) && f!.kind === "drawn");
  await think(sink, `${t}-r`, `Build ${frames.length === 1 ? frames[0].name : `${frames.length} frames`}: a page of the tide tables app for each, from the frame's own HTML, then design_built for each so Liner keeps them in step.`, signal);
  const built: string[] = [];
  const failed: string[] = [];
  for (const f of frames) {
    const path = builtPath(f);
    const abs = projectFile(o.cwd, path);
    if (!abs) {
      failed.push(f.name);
      continue;
    }
    const wrote = await step(c, "Write", "write", `Write ${path}`, path, () => {
      atomic(abs, builtPage(f, readFrameOf(o.cwd, slug, f)));
      return `${f.name} as a page of the app`;
    });
    if (!wrote) {
      failed.push(f.name);
      continue;
    }
    const r = await recordBuilt(c, f, path);
    (r ? built : failed).push(f.name);
  }
  await say(
    sink,
    `${t}-a`,
    built.length
      ? `Built ${built.length === 1 ? built[0] : `${built.length} frames`} into the sample project: ${frames.filter((f) => built.includes(f.name)).map((f) => `${f.name} as ${builtPath(f)}`).join(", ")}. Each is recorded with design_built, so the Build tab shows ${built.length === 1 ? "it" : "them"} In step.${failed.length ? ` ${failed.join(", ")} didn't go: ${failed.length === 1 ? "it" : "they"} couldn't be written or recorded.` : ""}${named.length > frames.length ? ` ${named.length - frames.length} named in the ask ${named.length - frames.length === 1 ? "isn't a drawn frame" : "aren't drawn frames"} here, so I left ${named.length - frames.length === 1 ? "it" : "them"}.` : ""}`
      : "I couldn't find a drawn frame of this design file among the ones the ask names, so I built nothing.",
    signal,
  );
  done(c);
}

async function recordBuilt(c: Ctx, f: DesignFrame, path: string) {
  const key = `${c.t}-b${++c.n}`;
  const call = { key, tool: "mcp__liner__design_built", toolKind: "other" as const, title: `Tie ${f.name} to ${path}`, input: JSON.stringify({ frame: f.id, file: path, design: c.slug }) };
  c.sink.tool({ ...call, status: "running" });
  const r = await liner(c.o, "design_built", { frame: f.id, file: path, design: c.slug }, c.signal);
  c.sink.tool({ ...call, status: r.ok ? "done" : "failed", output: r.said.slice(0, 600) });
  return r.ok;
}

async function update(c: Ctx, ask: string, file: DesignFile | null) {
  const { o, sink, signal, t, slug } = c;
  const parts = [...ask.matchAll(/^(.+?) \(\.liner\/designs\/[^)]+\) changed since it was built as (\S+)\. Change only this in \S+:\n((?:- .*\n?)*)/gm)];
  await think(sink, `${t}-r`, "Update code: each frame changed since it was built. I'll write only that into its file, then record it again.", signal);
  const did: string[] = [];
  for (const [, name, path, lines] of parts) {
    const f = file ? frameNamed(file, name) : undefined;
    const abs = projectFile(o.cwd, path);
    if (!f || !abs || !existsSync(abs)) continue;
    const ok = await step(c, "Edit", "edit", `Edit ${path}`, path, () => {
      atomic(abs, builtPage(f, readFrameOf(o.cwd, slug, f)));
      return lines.trim() || "the frame's change";
    });
    if (ok && (await recordBuilt(c, f, path))) did.push(`${f.name} into ${path} (${lines.trim().split("\n").length} ${lines.trim().split("\n").length === 1 ? "change" : "changes"})`);
  }
  await say(sink, `${t}-a`, did.length ? `Updated the code from the canvas: ${did.join("; ")}. The rest of each file is as it was, and each frame is In step again.` : "I couldn't find the frame and its file the ask names in the sample project, so I changed nothing.", signal);
  done(c);
}

/**
  The file's change back into the frame: the file is the frame's page without its ids, so its
  elements meet the frame's in order; each gets its frame element's id back, and the result is the
  frame, every id kept. A file whose elements no longer line up is said so, and left.
*/
export function bringBack(fileHtml: string, frameHtml: string): string | null {
  const ids = addressable(parse(frameHtml)).map((el) => ({ tag: el.tag, id: attr(el, "data-l")?.value }));
  const doc = parse(fileHtml);
  const els = addressable(doc);
  if (els.length !== ids.length || els.some((el, i) => el.tag !== ids[i].tag)) return null;
  let out = doc.html;
  for (let i = els.length - 1; i >= 0; i--) {
    const id = ids[i].id;
    if (!id) continue;
    const at = els[i].start + 1 + els[i].tag.length;
    out = `${out.slice(0, at)} data-l="${id}"${out.slice(at)}`;
  }
  return out.replace(/<!-- The tide tables' .*? built from its frame on Liner Design's canvas\. -->\n/, "");
}

async function bring(c: Ctx, ask: string, file: DesignFile | null) {
  const { o, sink, signal, t, slug } = c;
  const m = /^(\S+) changed after (.+?) was built from it/.exec(ask)!;
  const [, path, name] = m;
  const f = file ? frameNamed(file, name) : undefined;
  const abs = projectFile(o.cwd, path);
  await think(sink, `${t}-r`, `${path} moved on after ${name} was built from it. I'll take its change back into the frame and keep every data-l id.`, signal);
  if (!f || !abs || !existsSync(abs)) {
    await say(sink, `${t}-a`, `I couldn't find ${name} and ${path} in the sample project, so I changed nothing.`, signal);
    return done(c);
  }
  const next = bringBack(readFileSync(abs, "utf8"), readFrameOf(o.cwd, slug, f));
  if (!next) {
    await say(sink, `${t}-a`, `${path} has elements added or taken away since the build, more than the Demo can line up with ${f.name} by itself, so I left the frame as it is.`, signal);
    return done(c);
  }
  await step(c, "Edit", "edit", `Edit ${f.name}`, `${c.rel}/${f.path ?? `frames/${f.id}.html`}`, () => {
    atomic(frameFile(o.cwd, slug, f), next);
    return `${path}'s change, ids kept`;
  });
  await recordBuilt(c, f, path);
  await say(sink, `${t}-a`, `Done: ${f.name} has ${path}'s change now, with every data-l id kept, and the two are In step again.`, signal);
  done(c);
}

// Send to code.

type Held = { selector: string; text?: string; file?: string; changes: { prop?: string; to: string; from?: string; text?: boolean }[] };
export function heldChanges(ask: string): Held[] {
  const out: Held[] = [];
  for (const block of ask.split(/\n(?=\d+\. )/)) {
    const head = /^\d+\. (?:`([^`]+)`|the element (\S+))(?: “(.*?)”)?, on .*?(?:, from ([^\s:,]+)(?::\d+)?)?$/m.exec(block);
    if (!head) continue;
    const h: Held = { selector: head[1] ?? `[data-l="${head[2]}"]`, ...(head[3] ? { text: head[3] } : {}), ...(head[4] ? { file: head[4] } : {}), changes: [] };
    for (const l of block.split("\n").slice(1)) {
      const s = /^ {3}([a-z-]+): (.*?) → (.*)$/.exec(l);
      if (s && s[1] !== "attributes") h.changes.push({ prop: s[1], from: s[2], to: s[3] === "taken away" ? "" : s[3] });
      const tx = /^ {3}its text → “(.*)”$/.exec(l);
      if (tx) h.changes.push({ text: true, to: tx[1] });
    }
    out.push(h);
  }
  return out;
}

async function toCode(c: Ctx, ask: string) {
  const { o, sink, signal, t } = c;
  const held = heldChanges(ask);
  await think(sink, `${t}-r`, "Changes held on a live frame, for the code. I'll put each into the file it comes from, where the ask names one, and leave the canvas alone: the frame reloads by itself.", signal);
  const said: string[] = [];
  for (const h of held) {
    const style = h.changes.filter((x) => x.prop && x.to);
    const text = h.changes.find((x) => x.text);
    const abs = h.file ? projectFile(o.cwd, h.file) : null;
    if (!abs || !existsSync(abs)) {
      said.push(`${h.selector}: I'd set ${[...style.map((x) => `${x.prop} to ${x.to}`), ...(text ? [`its text to “${text.to}”`] : [])].join(", ") || "what was held"}${h.file ? ` in ${h.file}, which isn't in the sample project` : ", but the ask names no file of the sample project, so I didn't guess one"}`);
      continue;
    }
    await step(c, "Edit", "edit", `Edit ${h.file}`, h.file, () => {
      let src = readFileSync(abs, "utf8");
      if (text && h.text && src.includes(h.text)) src = src.replace(h.text, text.to);
      if (style.length) {
        const rule = `${h.selector} { ${style.map((x) => `${x.prop}: ${x.to};`).join(" ")} }`;
        src = /\.css$/i.test(h.file!) ? `${src.replace(/\s*$/, "\n")}/* From Liner Design's canvas. */\n${rule}\n` : /<\/head>/i.test(src) ? src.replace(/<\/head>/i, `<style>/* From Liner Design's canvas. */ ${rule}</style>\n</head>`) : `${src.replace(/\s*$/, "\n")}<style>/* From Liner Design's canvas. */ ${rule}</style>\n`;
      }
      atomic(abs, src);
      return [...style.map((x) => `${x.prop}: ${x.from ?? "not set"} → ${x.to}`), ...(text ? [`text → “${text.to}”`] : [])].join(", ");
    });
    said.push(`${h.selector} in ${h.file}: ${[...style.map((x) => `${x.prop} ${x.to}`), ...(text ? [`text “${text.to}”`] : [])].join(", ")}`);
  }
  await say(sink, `${t}-a`, held.length ? `${said.length === 1 ? "One change" : `${said.length} changes`} for the code: ${said.join("; ")}. I didn't touch the canvas: the live frame shows the code as it is.` : "I couldn't read a held change in the ask, so I changed nothing.", signal);
  done(c);
}

// 3 more like this.

/** Three takes of a frame, each visibly different: another layout where Foreshore has one, the night chart, the figures larger, the sea and the land swapped. */
export function takesOf(f: DesignFrame, html: string): { html: string; what: string }[] {
  const inject = (h: string, css: string) => (/<\/head>/i.test(h) ? h.replace(/<\/head>/i, `<style data-take>${css}</style>\n</head>`) : `<style data-take>${css}</style>\n${h}`);
  const night = isNight(html) ? { html: toDay(html), what: "the day chart" } : { html: toNight(html), what: "the night chart" };
  const larger = { html: inject(html, "body{zoom:1.14}.fig,.t{letter-spacing:-0.02em}"), what: "the figures larger, the chart closer in" };
  const sea = { html: inject(html, ":root{--paper:#BFE0EA;--shallows:#F7F8F5;--land:#B5D3A0;--foreshore:#F0DA9C}"), what: "the sea and the land swapped, the page in shallows" };
  if (f.name === "Phone / Today" || /phone-today/.test(f.id)) return [{ html: foreshorePage("phone-dial.html"), what: "the day as a tide clock" }, { html: foreshorePage("phone-ribbon.html"), what: "the day running down the screen" }, night];
  return [night, larger, sea];
}

async function takes(c: Ctx, ask: string, file: DesignFile | null) {
  const { o, sink, signal, t, slug } = c;
  const head = /^Draw (?:3 more ways|another way) of “(.+?)” \(frames\/([a-z0-9-]+)\.html\)/.exec(ask)!;
  const original = file ? (frameNamed(file, head[2]) ?? frameNamed(file, head[1])) : undefined;
  const into = [...ask.matchAll(/frames\/([a-z0-9-]+)\.html/g)].map((m) => m[1]).filter((id) => id !== head[2]);
  const targets = [...new Set(into)].map((id) => (file ? frameNamed(file, id) : undefined)).filter((f): f is DesignFrame => Boolean(f) && f!.id !== original?.id && f!.kind === "drawn");
  await think(sink, `${t}-r`, `${targets.length === 1 ? "Another take" : `${targets.length} takes`} of ${head[1]}, each into its own frame, and the original left as it is.`, signal);
  if (!original || !targets.length) {
    await say(sink, `${t}-a`, `I couldn't find ${!original ? `“${head[1]}”` : "the take frames the ask names"} in this design file, so I drew nothing.`, signal);
    return done(c);
  }
  const options = takesOf(original, readFrameOf(o.cwd, slug, original));
  const did: string[] = [];
  for (const [i, f] of targets.entries()) {
    const take = options[i % options.length];
    await step(c, "Write", "write", `Draw ${f.name}`, `${c.rel}/${f.path ?? `frames/${f.id}.html`}`, () => {
      atomic(frameFile(o.cwd, slug, f), take.html);
      return take.what;
    });
    did.push(`${f.name === original.name ? f.id : f.name}: ${take.what}`);
  }
  await say(sink, `${t}-a`, `${did.length === 1 ? "One take" : `${did.length} takes`} of ${original.name}, each in its own frame: ${did.join("; ")}. ${original.name} itself is as it was. Keep the one you like.`, signal);
  done(c, 4200, 9800);
}

// Fixes from Checks.

export type Finding = { frame: string; kind: string; id?: string; text: string };
export function findingsOf(ask: string): Finding[] {
  return [...ask.matchAll(/^- (.+?) \((fit|contrast|touch|name)(?:, data-l ([A-Za-z0-9_-]+))?\): (.*)$/gm)].map((m) => ({ frame: m[1], kind: m[2], ...(m[3] ? { id: m[3] } : {}), text: m[4] }));
}

/** The Demo's fix for a finding: one small change to the element it names. */
export function fixOps(f: Finding) {
  if (!f.id) return null;
  if (f.kind === "contrast") return [{ id: f.id, style: { color: "var(--ink)" } }];
  if (f.kind === "touch") return [{ id: f.id, style: { "min-height": "24px", "min-width": "24px" } }];
  if (f.kind === "fit") return [{ id: f.id, style: { "white-space": "normal", "overflow-wrap": "anywhere", "max-width": "100%" } }];
  if (f.kind === "name") {
    const words = /^[“"](.+?)[”"]/.exec(f.text)?.[1];
    return [{ id: f.id, attr: /^A picture/.test(f.text) ? { alt: "" } : { "aria-label": words ?? (/link/.test(f.text) ? "Open" : "Search") } }];
  }
  return null;
}

async function fix(c: Ctx, ask: string, file: DesignFile | null) {
  const { o, sink, signal, t, slug } = c;
  const all = findingsOf(ask);
  await think(sink, `${t}-r`, `${all.length === 1 ? "One check" : `${all.length} checks`} to fix. I'll change only what each needs, in its own frame.`, signal);
  const did: string[] = [];
  const left: string[] = [];
  for (const finding of all) {
    const f = file ? frameNamed(file, finding.frame) : undefined;
    const ops = fixOps(finding);
    if (!f || f.kind !== "drawn" || !ops) {
      left.push(`${finding.frame} (${finding.kind})`);
      continue;
    }
    const ok = await step(c, "Edit", "edit", `Edit ${f.name}`, `${c.rel}/${f.path ?? `frames/${f.id}.html`}`, () => {
      const out = applyOps(readFrameOf(o.cwd, slug, f), ops as Parameters<typeof applyOps>[1]).html;
      atomic(frameFile(o.cwd, slug, f), out);
      return `${finding.kind} on ${finding.id}: ${JSON.stringify((ops[0] as { style?: object; attr?: object }).style ?? (ops[0] as { attr?: object }).attr)}`;
    });
    (ok ? did : left).push(`${f.name}, ${finding.kind}${finding.id ? ` (${finding.id})` : ""}`);
  }
  await say(sink, `${t}-a`, `${did.length ? `Fixed ${did.join("; ")}: the smallest change each needs, the rest of the frame as it was.` : "I fixed nothing."}${left.length ? ` I left ${left.join("; ")}: I couldn't find the frame or the element, or it's a check the Demo has no fix for.` : ""}`, signal);
  done(c);
}

// Night and day.

async function light(c: Ctx, text: string, ask: string, file: DesignFile) {
  const { o, sink, signal, t, slug } = c;
  const picked = (/^Selected: (.*?)\. design_selection/m.exec(text)?.[1] ?? /^Selected: (.*)$/m.exec(text)?.[1] ?? "").split("; ").map((p) => p.split(" › ")[0].replace(/\.$/, "").trim());
  // The frame the selection holds, else one the ask names exactly (the longest name that's in it); never a guess.
  const named = file.frames.filter((f) => f.kind === "drawn" && ask.includes(f.name)).sort((a, b) => b.name.length - a.name.length)[0];
  const frame = picked.map((p) => frameNamed(file, p)).find((f) => f?.kind === "drawn") ?? named;
  if (!frame) {
    await say(sink, `${t}-a`, "Which frame should change? Select one, or name it (“Phone / Today”), and ask again: I didn't change anything.", signal);
    return done(c, 1200, 200);
  }
  const now = readFrameOf(o.cwd, slug, frame);
  const want = /\blight\b|\bday\b/i.test(ask) && !/\b(?:dark|night)\b/i.test(ask) ? "day" : /\b(?:dark|night)\b/i.test(ask) ? "night" : isNight(now) ? "day" : "night";
  await think(sink, `${t}-r`, `${frame.name} in the ${want} colours, and the rest left alone.`, signal);
  await step(c, "Edit", "edit", `Edit ${frame.name}`, `${c.rel}/${frame.path ?? `frames/${frame.id}.html`}`, () => {
    atomic(frameFile(o.cwd, slug, frame), want === "night" ? (isNight(now) ? now : toNight(now)) : toDay(now));
    return want === "night" ? "class night on <html>" : "class night taken off";
  });
  await say(sink, `${t}-a`, `Done: ${frame.name} is in the ${want} colours now.`, signal);
  done(c);
}

