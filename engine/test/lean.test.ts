/*
  Liner Design's lean: DESIGN.md read as people write it (the Foreshore sample, a looser file, an
  empty one), the built-in Liner 2.0, the design skills of a home pointed at a temp folder, and
  the "## Design" note a message from the Design face carries to its turn, the same words for
  every provider. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DesignFile, ProviderInfo } from "../../contracts/src/index.ts";
import { emptyUsage, FRAME_CHANGED } from "../../contracts/src/index.ts";
import { builtinLean, designNote, isDesignSkill, listSkills, parseLean, readLean, writeLean } from "../src/lean.ts";
import { linerName, providers, Runtime, toolsNote } from "../src/runtime.ts";
import type { Provider } from "../src/providers/types.ts";
import { Store } from "../src/store.ts";

/** A design file on disk as any writer leaves it (the canvas reads it back through peekFile / readFile). */
function saveDesign(cwd: string, slug: string, d: DesignFile) {
  mkdirSync(join(cwd, ".liner", "designs", slug, "frames"), { recursive: true });
  writeFileSync(join(cwd, ".liner", "designs", slug, "design.json"), JSON.stringify(d, null, 2));
}

const FORESHORE = join(import.meta.dirname, "..", "..", "docs", "demo", "foreshore", "DESIGN.md");
const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

test("lean: Foreshore's DESIGN.md gives its colours, two voices of type, the steps, the corner and the rules", () => {
  const t = parseLean(readFileSync(FORESHORE, "utf8"));
  assert.deepEqual(t.colours.slice(0, 6), [
    { name: "Deep", value: "#F7F8F5" },
    { name: "Shallows", value: "#BFE0EA" },
    { name: "Foreshore", value: "#B5D3A0" },
    { name: "Land", value: "#F0DA9C" },
    { name: "Ink", value: "#11181B" },
    { name: "Mark", value: "#C4127A" },
  ]);
  assert.deepEqual(t.colours.find((c) => c.name === "Mark (night)"), { name: "Mark (night)", value: "#FF5FB0" }, "the night set, named as a set");
  assert.deepEqual(t.type.map((x) => [x.name, x.size, x.family]), [["Figure", 172, "Archivo"], ["Water", 34, "Archivo"], ["Body", 15, "Archivo"], ["Label", 11, "Archivo"], ["Newsreader", undefined, "Newsreader"]]);
  assert.equal(t.type.find((x) => x.name === "Newsreader")?.italic, true);
  assert.deepEqual(t.steps, [4, 8, 12, 16, 24, 32]);
  assert.deepEqual(t.corners, [{ name: "Corners", value: 4 }]);
  assert.deepEqual(t.rules, ["Never magenta as decoration", "Never a time of tide that stands upright", "Never 12-hour times"]);
});

test("lean: a loose file reads without failing, and an empty one gives nothing", () => {
  const loose = [
    "# Our look",
    "Some words about the brand, *with emphasis*, and no headings we expect.",
    "",
    "## Colors",
    "* `--brand`: rgb(12, 40, 200) for links",
    "* paper = #fff",
    "* A line with no value at all",
    "",
    "## Typography",
    "Headings in \"Inter\", body in Inter too.",
    "Display 56 · Title 24/1.2 · Caption 12 weight 500",
    "",
    "## Spacing",
    "We use 2, 4, 8, 16 and sometimes 64px.",
    "",
    "## Shape",
    "Radius: buttons 6px; cards 12",
    "",
    "## Don't",
    "- use more than one accent",
    "- No shadows",
    "```",
    "## Never (inside a code block: not a heading)",
    "```",
  ].join("\n");
  const t = parseLean(loose);
  assert.deepEqual(t.colours, [{ name: "brand", value: "rgb(12, 40, 200)" }, { name: "paper", value: "#fff" }]);
  assert.deepEqual(t.type.filter((x) => x.size).map((x) => [x.name, x.size, x.line, x.weight]), [["Display", 56, undefined, undefined], ["Title", 24, "1.2", undefined], ["Caption", 12, undefined, 500]]);
  assert.ok(t.type.every((x) => x.family === "Inter"));
  assert.deepEqual(t.steps, [2, 4, 8, 16]);
  assert.deepEqual(t.corners, [{ name: "buttons", value: 6 }, { name: "cards", value: 12 }]);
  assert.deepEqual(t.rules, ["Don't use more than one accent", "No shadows"]);
  for (const s of ["", "   \n\n", "---\nname: x\n---\n", "#", "## Colour\n#zzz not a colour\n## Type\n123"]) assert.deepEqual(parseLean(s), { colours: [], type: [], steps: [], corners: [], rules: [] }, JSON.stringify(s));
});

test("lean: the built-in Liner 2.0 reads its tokens, steps, corners and rules from its SKILL.md", () => {
  const l = builtinLean();
  assert.equal(l.off, "builtin");
  assert.equal(l.builtin, "liner-2");
  assert.ok(l.tokens.colours.some((c) => c.name === "accent" && c.value === "var(--accent)"), "its colours are the app's tokens");
  assert.deepEqual(l.tokens.steps, [4, 6, 8, 10, 12, 16, 20, 24]);
  assert.deepEqual(l.tokens.corners.slice(0, 3), [{ name: "controls", value: 9 }, { name: "rows", value: 11 }, { name: "fields and cards", value: 12 }]);
  assert.ok(l.tokens.rules.includes("No uppercase labels"));
  assert.ok(!l.tokens.rules.some((r) => /tokens/.test(r)), "a heading that mentions never isn't a list of rules");
});

test("lean: found at the root, else in .liner, else none; a design file can name its own; written where it is", () => {
  const cwd = tmp("lc-lean-");
  assert.equal(readLean(cwd).off, "none");
  mkdirSync(join(cwd, ".liner"));
  writeFileSync(join(cwd, ".liner", "DESIGN.md"), "## Colour\n- Ink #111111\n");
  assert.deepEqual([readLean(cwd).off, readLean(cwd).path, readLean(cwd).tokens.colours[0]?.value], ["liner", join(".liner", "DESIGN.md"), "#111111"]);
  writeFileSync(join(cwd, "DESIGN.md"), "## Colour\n- Ink #222222\n");
  assert.deepEqual([readLean(cwd).off, readLean(cwd).path], ["root", "DESIGN.md"]);
  assert.equal(readLean(cwd, { lean: { builtin: "liner-2", skills: [] } }).off, "builtin");
  assert.equal(readLean(cwd, { lean: { path: ".liner/DESIGN.md", skills: [] } }).tokens.colours[0].value, "#111111");
  assert.equal(readLean(cwd, { lean: { path: "../../etc/passwd", skills: [] } }).path, "DESIGN.md", "a path out of the folder falls back to the folder's own");
  const w = writeLean(cwd, "## Colour\n- Mark #C4127A\n");
  assert.equal(w.tokens.colours[0].value, "#C4127A");
  assert.match(readFileSync(join(cwd, "DESIGN.md"), "utf8"), /Mark/);
  assert.throws(() => writeLean(cwd, "x".repeat(300_000)), /under 200 KB/);
});

test("skills: yours, the folder's and Liner Code's, design ones first, loaded per design file, on a temp home", () => {
  const home = tmp("lc-lean-home-");
  const cwd = tmp("lc-lean-cwd-");
  const skill = (root: string, name: string, description: string) => {
    mkdirSync(join(root, name), { recursive: true });
    writeFileSync(join(root, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\nBody.\n`);
  };
  skill(join(home, ".claude", "skills"), "brandkit", "Brand kits and logo systems");
  skill(join(home, ".claude", "skills"), "sql-queries", "Write SQL for a warehouse");
  skill(join(cwd, ".claude", "skills"), "awwwards", "Award-caliber websites");
  skill(join(cwd, ".claude", "skills"), "brandkit", "A second one of the same name");
  skill(join(home, ".codex", "skills"), "release-notes", "Write release notes");
  const all = listSkills(cwd, { HOME: home }, ["awwwards"]);
  const by = (n: string) => all.find((s) => s.name === n)!;
  assert.deepEqual([by("brandkit").kind, by("awwwards").kind, by("liner-2").kind, by("sql-queries").kind, by("release-notes").kind], ["design", "design", "design", "other", "other"]);
  assert.equal(by("brandkit").description, "Brand kits and logo systems", "the first of a name wins");
  assert.equal(by("awwwards").loaded, true);
  assert.equal(by("brandkit").loaded, false);
  assert.equal(by("awwwards").path, join(cwd, ".claude", "skills", "awwwards", "SKILL.md"));
  const firstOther = all.findIndex((s) => s.kind === "other");
  assert.ok(all.slice(0, firstOther).every((s) => s.kind === "design") && all.slice(firstOther).every((s) => s.kind === "other"), "design skills first");
  assert.equal(isDesignSkill({ name: "front-end-polish", description: "" }), true);
  assert.equal(isDesignSkill({ name: "deploy", description: "Ships the build" }), false);
  assert.equal(listSkills(cwd, { HOME: tmp("lc-lean-empty-") }).filter((s) => s.name !== "liner-2" && s.name !== "awwwards" && s.name !== "brandkit").length, 0, "nothing from the real home");
});

const tides = (slug = "tide-tables"): DesignFile => ({
  v: 1,
  id: slug,
  title: "Tide tables",
  pages: [{ id: "page-1", name: "Page 1" }],
  frames: [
    { id: "desktop-today", page: "page-1", name: "Desktop / Today", kind: "drawn", path: "frames/desktop-today.html", x: 0, y: 0, w: 1280, h: 800 },
    { id: "phone-today", page: "page-1", name: "Phone / Today", kind: "drawn", path: "frames/phone-today.html", x: 0, y: 900, w: 390, h: 844 },
    { id: "app", page: "page-1", name: "Live / Today", kind: "live", url: "localhost:5173/today", x: 1400, y: 0, w: 390, h: 844 },
  ],
  lean: { skills: ["awwwards"] },
});

function folder() {
  const home = tmp("lc-note-home-");
  const cwd = tmp("lc-note-");
  writeFileSync(join(cwd, "DESIGN.md"), readFileSync(FORESHORE, "utf8"));
  mkdirSync(join(cwd, ".claude", "skills", "awwwards"), { recursive: true });
  writeFileSync(join(cwd, ".claude", "skills", "awwwards", "SKILL.md"), "---\nname: awwwards\ndescription: Award-caliber websites\n---\n");
  saveDesign(cwd, "tide-tables", tides());
  return { home, cwd };
}

test("the ## Design note: where the file is, its frames and paths, the lean and skills to read, the selection, the rules; short", () => {
  const { home, cwd } = folder();
  const note = designNote(cwd, { file: "tide-tables", sel: { file: "tide-tables", frames: [], nodes: [{ frame: "phone-today", id: "n12", html: `<div data-l="n12" class="row hi">  <span>High water</span>  </div>` }] } }, { HOME: home });
  assert.match(note, /^## Design\n/);
  assert.match(note, /“Tide tables”, \.liner\/designs\/tide-tables\/ in this folder/);
  assert.match(note, /- Desktop \/ Today, 1280 × 800: \.liner\/designs\/tide-tables\/frames\/desktop-today\.html/);
  assert.match(note, /- Phone \/ Today, 390 × 844: \.liner\/designs\/tide-tables\/frames\/phone-today\.html/);
  assert.match(note, /- Live \/ Today, 390 × 844: live, localhost:5173\/today/);
  assert.match(note, /design_frame and design_node/);
  assert.match(note, /keeps its data-l id/);
  assert.match(note, /Read first: the lean, DESIGN\.md \(its rules win\); .*awwwards\/SKILL\.md\./);
  assert.match(note, /Selected: Phone \/ Today › n12 \(<div data-l="n12" class="row hi"> <span>High water<\/span> <\/div>\)\. design_selection/);
  assert.match(note, /The lean's rules: Never magenta as decoration; Never a time of tide that stands upright; Never 12-hour times\./);
  assert.ok(note.length < 2000, `${note.length}`);
  assert.match(designNote(cwd, { file: "tide-tables" }, { HOME: home }), /Nothing is selected\./);

  // A file of many frames is still under 2,000 characters: the frames are cut, and counted.
  const many = tides("big");
  many.frames = Array.from({ length: 80 }, (_, i) => ({ id: `frame-${i}`, page: "page-1", name: `Phone / Screen number ${i}`, kind: "drawn" as const, path: `frames/frame-${i}.html`, x: 0, y: 0, w: 390, h: 844 }));
  saveDesign(cwd, "big", many);
  const big = designNote(cwd, { file: "big", sel: { file: "big", frames: ["frame-1"], nodes: [{ frame: "frame-1", id: "a", html: "x".repeat(5000) }] } }, { HOME: home });
  assert.ok(big.length <= 2000, `${big.length}`);
  assert.match(big, /- and \d+ more \(design_files lists them\)/);
  assert.match(big, /The lean's rules/, "the rules survive the cut");

  // A file that isn't there yet, or a slug that tries to climb out: said plainly, nothing read outside.
  assert.match(designNote(cwd, { file: "../../etc" }, { HOME: home }), /\.liner\/designs\/etc\/.*\n[\s\S]*There are no frames yet/);
});

test("the ## Design note goes before the message, once, to every provider in the same words, and toolsNote names the tools", async () => {
  const { home, cwd } = folder();
  const seen: { provider: string; text: string }[] = [];
  const fake = (id: "claude" | "codex" | "opencode"): Provider => ({ id, detect: async () => ({}) as ProviderInfo, open: () => ({ turn: async (text) => void seen.push({ provider: id, text }), close() {} }) });
  const saved = { claude: providers.claude, codex: providers.codex, opencode: providers.opencode };
  Object.assign(providers, { claude: fake("claude"), codex: fake("codex"), opencode: fake("opencode") });
  try {
    const store = new Store(tmp("lc-note-store-"));
    store.putProject({ id: "p", name: "p", path: cwd, git: false, createdAt: 1 });
    const runtime = new Runtime(store, { ...process.env, HOME: home });
    const info = (id: "claude" | "codex" | "opencode", m: string): ProviderInfo => ({ id, label: id, available: true, adapter: true, login: "", models: [{ id: m, label: m, description: "" }], supports: { approvals: true, resume: true, effort: true, plan: true } });
    runtime.providerInfo = [info("claude", "claude-opus-5-5"), info("codex", "gpt-6"), info("opencode", "kimi")];
    const sel = { file: "tide-tables", frames: ["desktop-today"], nodes: [] };
    for (const [i, agent] of ["@claude:claude-opus-5-5", "@codex:gpt-6", "@opencode:kimi"].entries()) {
      store.putThread({ id: `t${i}`, projectId: "p", title: "New session", agent, status: "idle", access: "edits", turns: 0, usage: emptyUsage(), createdAt: 1, updatedAt: 1 });
      await runtime.send(`t${i}`, "Make the next tide larger", "queue", undefined, undefined, { file: "tide-tables", sel });
      await runtime.send(`t${i}`, "And now the week", "queue");
    }
    assert.equal(seen.length, 6);
    const notes = seen.filter((s) => s.text.startsWith("## Design\n"));
    assert.equal(notes.length, 3, "only the message from the Design face carries it");
    const words = (s: string) => s.slice(0, s.lastIndexOf("\n\nMake the next tide larger"));
    assert.equal(new Set(notes.map((s) => words(s.text))).size, 1, "every provider gets the same words");
    assert.ok(notes.every((s) => s.text.endsWith("\n\nMake the next tide larger")));
    assert.match(notes[0].text, /Selected: Desktop \/ Today\./);
    assert.ok(seen.filter((s) => s.text === "And now the week").length === 3, "the next message is the person's words alone");
    const timeline = store.timeline("t0").filter((x) => x.kind === "user");
    assert.deepEqual(timeline.map((x) => x.kind === "user" && x.text), ["Make the next tide larger", "And now the week"], "the timeline shows what was typed, not the note");
  } finally {
    Object.assign(providers, saved);
  }
  for (const fam of ["claude", "codex", "opencode"]) {
    const n = linerName(fam);
    for (const tool of ["design_files", "design_frame", "design_tree", "design_node", "design_selection", "design_shot", "design_built", "design_picture"]) assert.ok(toolsNote(n).includes(n(tool)), `${fam}: ${tool}`);
  }
});

test("the ## Design note through the api: thread.send's design mark reaches the provider once, before the words", async () => {
  const { createApi } = await import("../src/api.ts");
  const { home, cwd } = folder();
  const seen: string[] = [];
  const saved = providers.claude;
  providers.claude = { id: "claude", detect: async () => ({}) as ProviderInfo, open: () => ({ turn: async (text) => void seen.push(text), close() {} }) };
  try {
    const store = new Store(tmp("lc-note-api-"));
    store.putProject({ id: "p", name: "p", path: cwd, git: false, createdAt: 1 });
    store.putThread({ id: "t", projectId: "p", title: "New session", agent: "@claude:claude-opus-5-5", status: "idle", access: "edits", turns: 0, usage: emptyUsage(), createdAt: 1, updatedAt: 1 });
    // No tools of this Mac on the PATH: nothing is looked for or started but the fake.
    const env = { PATH: "/usr/bin:/bin", HOME: home };
    const runtime = new Runtime(store, env);
    runtime.providerInfo = [{ id: "claude", label: "claude", available: true, adapter: true, login: "", models: [{ id: "claude-opus-5-5", label: "Opus", description: "" }], supports: { approvals: true, resume: true, effort: true, plan: true } }];
    const api = createApi(store, runtime, env, { routines: { routines: [], recent: [] }, terms: {}, logs: {}, proxies: {} } as never);
    const until = async (ok: () => boolean) => {
      for (let i = 0; i < 300 && !ok(); i++) await new Promise((r) => setTimeout(r, 10));
      assert.ok(ok());
    };
    await api.call("thread.send", { id: "t", text: "Make the next tide larger", design: { file: "tide-tables", sel: { file: "tide-tables", frames: ["phone-today"], nodes: [] } } });
    await until(() => seen.length === 1 && !runtime.isRunning("t"));
    await api.call("thread.send", { id: "t", text: "Thanks" });
    await until(() => seen.length === 2 && !runtime.isRunning("t"));
    assert.match(seen[0], /^## Design\n[\s\S]*Selected: Phone \/ Today\.[\s\S]*\n\nMake the next tide larger$/);
    assert.equal(seen.filter((s) => s.includes("## Design")).length, 1, "once");
    assert.equal(seen[1], "Thanks");
    api.updates.stop();
    runtime.shutdown();
  } finally {
    providers.claude = saved;
  }
});

// Round 4.

test("L9: the lean doesn't follow links out of the folder: DESIGN.md as a link, a .liner link, lean.path from design.json", () => {
  const cwd = tmp("lc-lean-link-");
  const away = tmp("lc-lean-away-");
  writeFileSync(join(away, "secret.md"), "## Colour\n- Secret #123456\n");
  symlinkSync(join(away, "secret.md"), join(cwd, "DESIGN.md"));
  assert.throws(() => readLean(cwd), /leads out of this folder/);
  assert.throws(() => writeLean(cwd, "## Colour\n- Ink #000000\n"), /leads out of this folder/);
  assert.equal(readFileSync(join(away, "secret.md"), "utf8").includes("Secret"), true, "nothing written through it");
  // The note goes on without a lean it can't read, and nothing of the secret reaches it.
  saveDesign(cwd, "tide-tables", tides());
  const note = designNote(cwd, { file: "tide-tables" }, { HOME: tmp("lc-lean-link-home-") });
  assert.match(note, /^## Design/);
  assert.ok(!note.includes("Secret") && !note.includes("123456"));

  const other = tmp("lc-lean-link2-");
  symlinkSync(away, join(other, ".liner"));
  assert.throws(() => readLean(other, { lean: { path: ".liner/secret.md", skills: [] } }), /is a link/, "design.json's lean.path goes through the same check");
  writeFileSync(join(away, "DESIGN.md"), "## Colour\n- Away #654321\n");
  assert.throws(() => readLean(other), /is a link/, ".liner/DESIGN.md through a .liner link");
  assert.equal(readLean(tmp("lc-lean-ok-"), { lean: { path: "../../etc/passwd", skills: [] } }).off, "none", "a path out of the folder is no lean");
});

test("L6: the design mark goes with its own message only: not from a side chat or a command to a later turn; queued, it waits with its message", async () => {
  const { home, cwd } = folder();
  const seen: { thread: string; text: string }[] = [];
  let hold: (() => void) | undefined;
  const saved = providers.claude;
  providers.claude = {
    id: "claude",
    detect: async () => ({}) as ProviderInfo,
    open: (o) => ({
      turn: async (text) => {
        seen.push({ thread: String(o.env?.LINER_THREAD ?? o.cwd), text });
        if (text.includes("long one")) await new Promise<void>((r) => (hold = r));
      },
      close() {},
    }),
  };
  try {
    const store = new Store(tmp("lc-l6-"));
    store.putProject({ id: "p", name: "p", path: cwd, git: false, createdAt: 1 });
    const base = { projectId: "p", agent: "@claude:claude-opus-5-5", status: "idle" as const, access: "edits" as const, turns: 0, usage: emptyUsage(), createdAt: 1, updatedAt: 1 };
    store.putThread({ id: "t", title: "New session", ...base });
    store.putThread({ id: "side", title: "Side", sideOf: "t", ...base });
    const runtime = new Runtime(store, { PATH: "/usr/bin:/bin", HOME: home });
    runtime.providerInfo = [{ id: "claude", label: "claude", available: true, adapter: true, login: "", models: [{ id: "claude-opus-5-5", label: "Opus", description: "" }], supports: { approvals: true, resume: true, effort: true, plan: true } }];
    const mark = { file: "tide-tables" };
    const until = async (ok: () => boolean) => {
      for (let i = 0; i < 300 && !ok(); i++) await new Promise((r) => setTimeout(r, 10));
      assert.ok(ok());
    };
    // A side chat: no note there, and none left for the session's next turn.
    await runtime.send("side", "what did it do?", "queue", undefined, undefined, mark);
    await runtime.send("t", "plain words", "queue");
    assert.deepEqual(seen.map((x) => x.text.startsWith("## Design")), [false, false]);

    // A queued command (a compaction) with a mark: the command goes as it is, and the next turn has no note.
    const busy = runtime.send("t", "the long one", "queue");
    await until(() => Boolean(hold));
    await runtime.send("t", "/compact", "queue", undefined, undefined, mark);
    hold!();
    await busy;
    await until(() => seen.some((x) => x.text === "/compact") && !runtime.isRunning("t"));
    await runtime.send("t", "after the command", "queue");
    assert.equal(seen.find((x) => x.text.includes("after the command"))?.text, "after the command");

    // A message that waits in the queue keeps its own mark, and becomes the turn that carries it.
    hold = undefined;
    const busy2 = runtime.send("t", "the long one again", "queue");
    await until(() => Boolean(hold));
    await runtime.send("t", "draw it bigger", "queue", undefined, undefined, mark);
    hold!();
    await busy2;
    await until(() => seen.some((x) => x.text.endsWith("draw it bigger")) && !runtime.isRunning("t"));
    assert.match(seen.find((x) => x.text.endsWith("draw it bigger"))!.text, /^## Design\n/);
    await runtime.send("t", "thanks", "queue");
    assert.equal(seen.at(-1)!.text, "thanks");
    assert.equal(seen.filter((x) => x.text.includes("## Design")).length, 1);
  } finally {
    providers.claude = saved;
  }
  void existsSync;
});

test("N13: lean.write with a base refuses when DESIGN.md changed since it was read, and writes nothing", () => {
  const cwd = tmp("lc-lean-rev-");
  assert.equal(readLean(cwd).rev, "", "no file, no revision");
  writeFileSync(join(cwd, "DESIGN.md"), "## Colour\n- Ink #111111\n");
  const read = readLean(cwd);
  assert.match(read.rev ?? "", /^[0-9a-f]{16}$/);
  writeFileSync(join(cwd, "DESIGN.md"), "## Colour\n- Ink #111111\n- Mark #C4127A\n");
  assert.throws(() => writeLean(cwd, "## Colour\n- Ink #222222\n", read.rev), (e: Error) => e.message.startsWith(FRAME_CHANGED) && /changed since it was read/.test(e.message));
  assert.match(readFileSync(join(cwd, "DESIGN.md"), "utf8"), /Mark/, "the other change is kept");
  const now = readLean(cwd);
  const w = writeLean(cwd, "## Colour\n- Ink #222222\n", now.rev);
  assert.equal(w.tokens.colours[0].value, "#222222");
  assert.notEqual(w.rev, now.rev);
  assert.equal(writeLean(cwd, "## Colour\n- Ink #333333\n").tokens.colours[0].value, "#333333", "without a base, as before");
  assert.equal(readLean(tmp("lc-lean-rev2-"), { lean: { builtin: "liner-2", skills: [] } }).rev, "", "a built-in lean, no project file");
});

test("M1: lean.write writes, and hashes, exactly the file lean.read read for the same design file (R's probe7 LW)", async () => {
  const { designCtx, createFile, readFile, saveFile } = await import("../src/canvas.ts");
  const { rpc } = await import("../src/lean.ts");
  const root = tmp("lc-lean-m1-");
  const store = new Store(tmp("lc-lean-m1-home-"));
  store.putProject({ id: "p", name: "p", path: root, git: false, createdAt: 1 });
  const ctx = designCtx(store);
  writeFileSync(join(root, "DESIGN.md"), "# Project lean\n\n## Colour\n- Ink #111111\n");
  mkdirSync(join(root, "docs"));
  writeFileSync(join(root, "docs/brand.md"), "# Brand lean\n\n## Colour\n- Mark #C4127A\n");
  createFile(ctx, root, "Foo", undefined, "foo");
  saveFile(ctx, root, "foo", { lean: { skills: [], path: "docs/brand.md" } });
  const l = readLean(root, readFile(ctx, root, "foo"));
  assert.deepEqual([l.path, l.writes], ["docs/brand.md", "docs/brand.md"]);
  const api = rpc(() => ctx);
  const w = await api["lean.write"]({ cwd: root, file: "foo", text: `${l.text}- Sand #F0DA9C\n`, base: l.rev });
  assert.match(readFileSync(join(root, "docs/brand.md"), "utf8"), /Sand/, "the file that was read got the change");
  assert.match(readFileSync(join(root, "DESIGN.md"), "utf8"), /^# Project lean/, "the project's DESIGN.md is untouched");
  assert.equal(w.writes, "docs/brand.md");
  // DESIGN.md's revision isn't brand.md's: a base from one never passes for the other.
  await assert.rejects(async () => api["lean.write"]({ cwd: root, file: "foo", text: "x", base: readLean(root).rev }), (e: Error) => e.message.startsWith(FRAME_CHANGED));
  assert.match(readFileSync(join(root, "docs/brand.md"), "utf8"), /Sand/);
  // .liner/DESIGN.md as the file's lean, beside a root DESIGN.md: that one is written.
  mkdirSync(join(root, ".liner"), { recursive: true });
  writeFileSync(join(root, ".liner/DESIGN.md"), "# Liner lean\n");
  saveFile(ctx, root, "foo", { lean: { skills: [], path: ".liner/DESIGN.md" } });
  const l2 = await api["lean.read"]({ cwd: root, file: "foo" });
  await api["lean.write"]({ cwd: root, file: "foo", text: "# Liner lean, edited\n", base: l2.rev });
  assert.equal(readFileSync(join(root, ".liner/DESIGN.md"), "utf8"), "# Liner lean, edited\n");
  assert.match(readFileSync(join(root, "DESIGN.md"), "utf8"), /^# Project lean/);
  // A built-in lean, or none: a write makes the project's DESIGN.md at the root, and says so.
  const bare = tmp("lc-lean-m1-bare-");
  const b = readLean(bare, { lean: { builtin: "liner-2", skills: [] } });
  assert.deepEqual([b.writes, b.rev], ["DESIGN.md", ""]);
  writeLean(bare, "# Ours\n", b.rev, { lean: { builtin: "liner-2", skills: [] } });
  assert.equal(readFileSync(join(bare, "DESIGN.md"), "utf8"), "# Ours\n");
  // The design file's lean.path still goes through the folder and link checks.
  const away = tmp("lc-lean-m1-away-");
  writeFileSync(join(away, "x.md"), "# away\n");
  symlinkSync(join(away, "x.md"), join(root, "docs/linked.md"));
  assert.throws(() => writeLean(root, "# nope\n", undefined, { lean: { path: "docs/linked.md", skills: [] } }), /leads out of this folder/);
  assert.equal(readFileSync(join(away, "x.md"), "utf8"), "# away\n");
});
