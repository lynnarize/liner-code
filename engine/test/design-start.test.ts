/*
  Starting a design (design-start.ts): the designs home and its rules, design.new on its own and in
  a project, design.all, design.rename, sessions of a design project, design.attach ("Build in a
  project") with everything kept by folder carried and a failure half way leaving the original as
  it was, and the Demo drawing in a design on its own. Everything on temp folders with fakes; the
  last test fails if anything appeared under the real home's Liner Designs. Run with
  `npm test -w engine`.
*/
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { join, relative, resolve } from "node:path";
import type { ProviderInfo, RpcMethod, RpcParams, RpcResult } from "../../contracts/src/index.ts";
import { emptyUsage } from "../../contracts/src/index.ts";
import { createApi } from "../src/api.ts";
import { builtCopy } from "../src/buildlinks.ts";
import { designCtx } from "../src/canvas.ts";
import { picturesPref, setPicturesPref } from "../src/design-prefs.ts";
import { attachCrash, CRASH, designsHome } from "../src/design-start.ts";
import { designNote } from "../src/lean.ts";
import { factsOf, remember } from "../src/memory.ts";
import { drawTides } from "../src/providers/demo-canvas.ts";
import type { OpenOptions, TurnSink } from "../src/providers/types.ts";
import { providers, Runtime } from "../src/runtime.ts";
import { Store } from "../src/store.ts";

/** The real home, as the system has it (not $HOME, which a test may point elsewhere), and what its Liner Designs held before. */
const REAL = join(userInfo().homedir, "Liner Designs");
const realBefore = existsSync(REAL) ? readdirSync(REAL).sort() : null;

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const env = () => ({ PATH: "/usr/bin:/bin", HOME: tmp("lc-start-home-") }) as NodeJS.ProcessEnv;
const opened: { stop(): void }[] = [];
after(() => {
  for (const o of opened) o.stop();
});

function setup() {
  const home = tmp("lc-start-liner-");
  const store = new Store(home);
  const e = env();
  const runtime = new Runtime(store, e);
  const design = designCtx(store, { env: e });
  const raw = createApi(store, runtime, e, { routines: { routines: [], recent: [], put: () => undefined, remove: () => undefined }, terms: {}, logs: {}, proxies: {}, design } as never);
  opened.push({ stop: () => (raw.updates.stop(), runtime.shutdown()) });
  // Typed by the RPC map, as the app calls it.
  const api = { call: <M extends RpcMethod>(m: M, p: RpcParams<M>) => raw.call(m, p) as Promise<RpcResult<M>> };
  const project = (name: string) => {
    const dir = tmp(`lc-start-${name}-`);
    return store.putProject({ id: `pr_${name}`, name, path: dir, git: false, createdAt: Date.now() });
  };
  return { home, store, runtime, design, api, project, e };
}

test("the designs home: LINER_DESIGNS_HOME first, else under a home that isn't the default, else ~/Liner Designs", () => {
  assert.equal(designsHome("/x/liner", { LINER_DESIGNS_HOME: "/y/designs" }), "/y/designs");
  assert.equal(designsHome("/x/liner", {}), "/x/liner/Liner Designs", "an isolated run keeps them under its own home");
  assert.equal(designsHome(join(homedir(), ".liner-code"), {}), join(homedir(), "Liner Designs"));
  // A test's store is never the default: its designs are under its temp home.
  const { store } = setup();
  assert.ok(designsHome(store.home, {}).startsWith(store.home));
  assert.ok(relative(userInfo().homedir, designsHome(store.home, {})).startsWith(".."), "nowhere under the real home");
});

test("design.new on its own: a folder and a project of kind design, its design file of the same slug with one empty frame, no session, no Git", async () => {
  const { api, store, home } = setup();
  const r = await api.call("design.new", { size: "phone" });
  assert.equal(r.project.kind, "design");
  assert.equal(r.project.name, "Untitled design");
  assert.equal(r.project.git, false);
  assert.equal(r.project.path, join(home, "Liner Designs", "untitled-design"));
  assert.equal(r.file.id, "untitled-design");
  assert.deepEqual(r.file.frames.map((f) => [f.name, f.w, f.h]), [["Phone", 390, 844]]);
  assert.ok(existsSync(join(r.project.path, ".liner/designs/untitled-design/design.json")));
  assert.equal(existsSync(join(r.project.path, ".git")), false);
  assert.equal(existsSync(join(r.project.path, "DESIGN.md")), false, "no lean nobody asked for");
  assert.equal(store.threads.length, 0, "no session until the first ask");
  assert.ok(!store.projects.some((p) => /Scratch/.test(p.name)), "never Scratch");
  // Slugs never collide; both frames for desktop+phone, side by side.
  const two = await api.call("design.new", { size: "desktop+phone" });
  assert.equal(two.file.id, "untitled-design-2");
  assert.deepEqual(two.file.frames.map((f) => [f.name, f.w]), [["Desktop", 1280], ["Phone", 390]]);
  const [d, p] = two.file.frames;
  assert.ok(p.x >= d.x + d.w, "the phone beside the desktop, not on it");
  // A size that isn't one: refused, nothing made.
  await assert.rejects(api.call("design.new", { title: "Odd", size: "watch" as never }), /desktop, tablet, phone or desktop\+phone/);
  assert.equal(existsSync(join(home, "Liner Designs", "odd")), false);
  // The canvas takes the folder as one of the projects.
  const opened2 = await api.call("canvas.open", { cwd: r.project.path, file: r.file.id });
  assert.equal(opened2.file.id, "untitled-design");
});

test("design.new in a project, design.all and design.rename", async () => {
  const { api, project, store } = setup();
  const site = project("site");
  project("empty");
  const inSite = await api.call("design.new", { title: "Landing", size: "desktop", projectId: site.id });
  assert.equal(inSite.project.id, site.id);
  assert.ok(existsSync(join(site.path, ".liner/designs/landing/design.json")));
  const own = await api.call("design.new", { title: "Tide tables" });
  const all = await api.call("design.all", {});
  assert.deepEqual(all.map((x) => x.project.id), [own.project.id, site.id], "on their own first, then projects with designs; one without none isn't listed");
  assert.deepEqual(all[1].files.map((f) => f.id), ["landing"]);
  // Rename: on its own, the project's name too (the folder keeps its name); in a project, only the file.
  const r1 = await api.call("design.rename", { projectId: own.project.id, file: own.file.id, title: "Foreshore" });
  assert.deepEqual([r1.file.title, r1.project.name, r1.project.path], ["Foreshore", "Foreshore", own.project.path]);
  const r2 = await api.call("design.rename", { projectId: site.id, file: "landing", title: "Launch page" });
  assert.deepEqual([r2.file.title, store.project(site.id).name], ["Launch page", "site"]);
  await assert.rejects(api.call("design.rename", { projectId: site.id, file: "landing", title: "  " }), /needs a name/);
});

test("sessions of a design on its own carry Thread.design; Add a project refuses its folder; settings.openIn", async () => {
  const { api } = setup();
  const own = await api.call("design.new", { title: "Harbour" });
  const t = await api.call("thread.create", { projectId: own.project.id, agent: "@demo:demo", title: "Harbour" });
  assert.deepEqual(t.design, { file: "harbour" }, "set though the app didn't name it");
  const named = await api.call("thread.create", { projectId: own.project.id, agent: "@demo:demo", design: { file: "harbour" } });
  assert.deepEqual(named.design, { file: "harbour" });
  await assert.rejects(api.call("thread.create", { projectId: own.project.id, design: { file: "../x" } }), /isn't a design file's name/);
  await assert.rejects(api.call("project.add", { path: own.project.path }), /is a design on its own/);
  assert.equal((await api.call("settings.save", { openIn: "design" })).openIn, "design");
  await assert.rejects(api.call("settings.save", { openIn: "paper" as never }), /Code or Design/);
});

test("the lean is optional: the ## Design note of a design without one never mentions writing a DESIGN.md", async () => {
  const { api } = setup();
  const own = await api.call("design.new", { title: "Harbour", size: "phone" });
  const note = designNote(own.project.path, { file: own.file.id }, { HOME: tmp("lc-start-skills-") });
  assert.doesNotMatch(note, /DESIGN\.md/);
  assert.match(note, /This design has no lean: use any skills you have loaded, and otherwise your own judgement/);
  // Skills load for a design file with no lean (lean.skills, canvas.save).
  const home = tmp("lc-start-skillhome-");
  mkdirSync(join(home, ".claude/skills/brandkit"), { recursive: true });
  writeFileSync(join(home, ".claude/skills/brandkit/SKILL.md"), "---\nname: brandkit\ndescription: Brand design boards\n---\n# Brandkit\n");
  const saved = await api.call("canvas.save", { cwd: own.project.path, file: own.file.id, patch: { lean: { skills: ["brandkit"] } } });
  assert.deepEqual(saved.lean, { skills: ["brandkit"] });
  const withSkill = designNote(own.project.path, { file: own.file.id }, { HOME: home });
  assert.match(withSkill, /Read first: .*brandkit\/SKILL\.md\./);
  assert.match(withSkill, /no lean: go by the skills above/);
  assert.doesNotMatch(withSkill, /DESIGN\.md/);
});

/** A design on its own with a session, and something in every store kept by folder or slug. */
async function designWithHistory(s: ReturnType<typeof setup>, title = "Landing") {
  const { api, store, home } = s;
  const own = await api.call("design.new", { title, size: "desktop" });
  const src = own.project.path;
  const slug = own.file.id;
  const t = await api.call("thread.create", { projectId: own.project.id, agent: "@demo:demo" });
  store.patchThread(t.id, { providerSession: "claude:abc", sessions: { "@codex:gpt-6": "codex:def" }, turns: 2 });
  store.putItem(t.id, { kind: "user", id: "u1", turn: 1, at: 1, text: "Draw the landing page" });
  // A kept version, the picture setting, a built copy, a removed frame, the design's own lean, a memory.
  mkdirSync(join(home, "designs", t.id, "canvas", slug, "t1"), { recursive: true });
  writeFileSync(join(home, "designs", t.id, "canvas", slug, "t1.json"), JSON.stringify({ turn: 1, at: 1, frames: 1, digest: "x" }));
  setPicturesPref(home, src, slug, { ask: "never", model: null });
  const built = builtCopy(home, src, slug, "desktop");
  mkdirSync(join(built, ".."), { recursive: true });
  writeFileSync(built, "<p>built</p>");
  await api.call("canvas.frame.add", { cwd: src, file: slug, frame: { name: "Old", w: 100, h: 100 } });
  await api.call("canvas.frame.remove", { cwd: src, file: slug, frame: "old" });
  writeFileSync(join(src, "DESIGN.md"), "# Landing lean\n\n## Colour\n- Ink #111111\n");
  remember(home, own.project.id, "The landing page leads with the next high tide.");
  return { own, src, slug, t };
}

test("design.attach: the design moves into a project, a clashing slug suffixed, its sessions, versions, picture setting, build copies, trash, lean and memory carried, the design project gone", async () => {
  const s = setup();
  const { api, store, home, project } = s;
  const { own, src, slug, t } = await designWithHistory(s);
  const site = project("site");
  // The target has a design file of the same slug already.
  await api.call("design.new", { title: "Landing", projectId: site.id });
  const r = await api.call("design.attach", { projectId: own.project.id, to: { projectId: site.id } });
  const next = "landing-2";
  assert.equal(r.project.id, site.id);
  assert.equal(r.file.id, next);
  assert.deepEqual(r.moved, [t.id]);
  assert.equal(r.left, undefined);
  const dst = site.path;
  assert.ok(existsSync(join(dst, ".liner/designs", next, "design.json")));
  assert.equal(JSON.parse(readFileSync(join(dst, ".liner/designs", next, "design.json"), "utf8")).id, next);
  assert.ok(existsSync(join(dst, ".liner/designs/landing/design.json")), "the target's own file is untouched");
  assert.deepEqual(readdirSync(join(dst, ".liner/designs")).filter((n) => n.startsWith(".")), [], "no staging folder left");
  // Its lean went with it, beside its design.json, and is what it follows now.
  assert.equal(readFileSync(join(dst, ".liner/designs", next, "DESIGN.md"), "utf8"), "# Landing lean\n\n## Colour\n- Ink #111111\n");
  assert.equal(r.file.lean.path, `.liner/designs/${next}/DESIGN.md`);
  assert.equal((await api.call("lean.read", { cwd: dst, file: next })).tokens.colours[0].value, "#111111");
  // The session is the project's, drawing the new slug, its tools' saved conversations dropped (they were kept by the old folder).
  const moved = store.thread(t.id);
  assert.equal(moved.projectId, site.id);
  assert.deepEqual(moved.design, { file: next });
  assert.equal(moved.providerSession, undefined);
  assert.equal(moved.sessions, undefined);
  assert.equal(store.timeline(t.id).length, 1, "its history stays");
  // Versions by the new slug; the picture setting, build copy and trash under the target's keys, gone from the old.
  assert.ok(existsSync(join(home, "designs", t.id, "canvas", next, "t1")));
  assert.equal(existsSync(join(home, "designs", t.id, "canvas", slug)), false);
  assert.equal((await api.call("canvas.versions", { threadId: t.id, file: next })).length, 1);
  assert.deepEqual(picturesPref(home, dst, next), { ask: "never", model: null });
  assert.equal(picturesPref(home, src, slug), undefined);
  assert.equal(readFileSync(builtCopy(home, dst, next, "desktop"), "utf8"), "<p>built</p>");
  assert.equal(existsSync(builtCopy(home, src, slug, "desktop")), false);
  assert.equal((await api.call("canvas.frame.unremove", { cwd: dst, file: next, frame: "old" })).frames.some((f) => f.id === "old"), true, "the trash came along");
  assert.deepEqual(factsOf(home, site.id), ["The landing page leads with the next high tide."]);
  assert.deepEqual(factsOf(home, own.project.id), []);
  // The design project and its folder are gone; design.all shows it in the project.
  assert.equal(store.projects.some((p) => p.id === own.project.id), false);
  assert.equal(existsSync(src), false);
  assert.deepEqual((await api.call("design.all", {})).map((x) => [x.project.id, x.files.map((f) => f.id).sort()]), [[site.id, ["landing", next]]]);
});

test("design.attach to a folder makes it a project; a folder with files of its own stays, said so", async () => {
  const s = setup();
  const { api, store } = s;
  const { own, src } = await designWithHistory(s, "Harbour");
  writeFileSync(join(src, "notes.txt"), "mine");
  // A frame built into the design's own folder: that file stays behind, and the result says the link points nowhere now.
  mkdirSync(join(src, "pages"));
  writeFileSync(join(src, "pages/desktop.html"), "<p>built</p>");
  await api.call("build.link", { cwd: src, file: "harbour", frame: "desktop", path: "pages/desktop.html" });
  const folder = tmp("lc-start-folder-");
  const r = await api.call("design.attach", { projectId: own.project.id, to: { path: folder } });
  assert.match(r.left ?? "", /This build link points at a file that isn't in the project: Desktop → pages\/desktop\.html \(still in the old folder\)/);
  assert.equal(r.project.path, resolve(folder));
  assert.equal(r.project.kind, undefined);
  assert.ok(existsSync(join(folder, ".liner/designs/harbour/design.json")));
  assert.match(r.left ?? "", /stays, as it holds files of its own \((?=[^)]*notes\.txt)(?=[^)]*pages\/desktop\.html)/);
  assert.equal(readFileSync(join(src, "notes.txt"), "utf8"), "mine");
  assert.equal(existsSync(join(src, ".liner/designs/harbour")), false);
  assert.equal(store.projects.some((p) => p.id === own.project.id), false);
});

test("design.attach refuses, changing nothing: while a turn runs, into a design on its own, into its own folder, through a link, and when a step half way fails", async () => {
  const s = setup();
  const { api, store, home, runtime, project } = s;
  const { own, src, slug, t } = await designWithHistory(s);
  const other = await api.call("design.new", { title: "Other" });
  const site = project("site");
  await api.call("design.new", { title: "Landing", projectId: site.id });
  const linked = project("linked");
  const away = tmp("lc-start-away-");
  symlinkSync(away, join(linked.path, ".liner"));
  const snapshot = () => JSON.stringify({ projects: store.projects.map((p) => p.id), thread: store.thread(t.id), files: readdirSync(join(src, ".liner/designs")), target: readdirSync(join(site.path, ".liner/designs")), pref: picturesPref(home, src, slug) });
  const before = snapshot();
  // A turn running (held as one is: runtime.exclusive keeps the session busy).
  let release!: () => void;
  const held = runtime.exclusive(t.id, () => new Promise<void>((r) => (release = r)));
  await assert.rejects(api.call("design.attach", { projectId: own.project.id, to: { projectId: site.id } }), /An agent is working in this design now/);
  release();
  await held;
  await assert.rejects(api.call("design.attach", { projectId: own.project.id, to: { projectId: other.project.id } }), /a design on its own too/);
  await assert.rejects(api.call("design.attach", { projectId: own.project.id, to: { path: join(src, "sub") } }), /this design's own/);
  await assert.rejects(api.call("design.attach", { projectId: site.id, to: { projectId: site.id } }), /in a project already/);
  // The target's .liner is a link: nothing goes through it.
  await assert.rejects(api.call("design.attach", { projectId: own.project.id, to: { projectId: linked.id } }), /couldn't move into linked, so nothing changed: .liner is a link/);
  assert.deepEqual(readdirSync(away), []);
  // Half way: the session's kept versions can't be read to copy, after the staged copy, the journal and the picture setting landed.
  const kept1 = join(home, "designs", t.id, "canvas", slug, "t1");
  writeFileSync(join(kept1, "x.html"), "x");
  chmodSync(join(kept1, "x.html"), 0o000);
  await assert.rejects(api.call("design.attach", { projectId: own.project.id, to: { projectId: site.id } }), /nothing changed/);
  chmodSync(join(kept1, "x.html"), 0o644);
  assert.deepEqual(existsSync(join(home, "attach")) ? readdirSync(join(home, "attach")) : [], [], "no journal left");
  assert.equal(snapshot(), before, "the original as it was, the target without a copy");
  assert.equal(picturesPref(home, site.path, "landing-2"), undefined);
  assert.ok(existsSync(join(home, "designs", t.id, "canvas", slug, "t1")));
  assert.deepEqual(readdirSync(join(site.path, ".liner/designs")), ["landing"], "no staging folder, no half copy");
});

/** Collects what a turn says. */
function sink() {
  let said = "";
  const s: TurnSink = { text: (d: string) => void (said += d), reasoning: () => {}, tool: () => {}, plan: () => {}, usage: () => {} } as unknown as TurnSink;
  return { s, said: () => said };
}

test("the Demo draws Foreshore in a design on its own (its own place), with no DESIGN.md, and the runtime tells it so", async () => {
  const { api, store, runtime, e } = setup();
  const own = await api.call("design.new", { size: "desktop+phone" });
  const note = `## Design\n\nThe design file is “Untitled design”, .liner/designs/${own.file.id}/ in this folder.\n\nDraw the tide tables`;
  const k = sink();
  await drawTides({ cwd: own.project.path, access: "edits", designOnItsOwn: true } as OpenOptions, note, k.s, new AbortController().signal, "t1", 0);
  const file = JSON.parse(readFileSync(join(own.project.path, ".liner/designs", own.file.id, "design.json"), "utf8"));
  assert.equal(file.frames.length, 7, "Foreshore's seven, two into Design Home's empty frames");
  assert.equal(existsSync(join(own.project.path, "DESIGN.md")), false);
  assert.match(k.said(), /seven frames/);
  // Not its own place without the mark: words only.
  const k2 = sink();
  const bare = tmp("lc-start-bare-");
  await drawTides({ cwd: bare, access: "edits" } as OpenOptions, note, k2.s, new AbortController().signal, "t2", 0);
  assert.equal(existsSync(join(bare, ".liner")), false);
  // The runtime marks a session of a design project, and only that.
  const seen: OpenOptions[] = [];
  const saved = providers.claude;
  providers.claude = { id: "claude", detect: async () => ({}) as ProviderInfo, open: (o) => (seen.push(o), { turn: async () => {}, close() {} }) };
  try {
    runtime.providerInfo = [{ id: "claude", label: "claude", available: true, adapter: true, login: "", models: [{ id: "claude-opus-5-5", label: "Opus", description: "" }], supports: { approvals: true, resume: true, effort: true, plan: true } }];
    void e;
    const site = store.putProject({ id: "pr_site", name: "site", path: tmp("lc-start-site-"), git: false, createdAt: 1 });
    for (const [id, projectId] of [["a", own.project.id], ["b", site.id]] as const) store.putThread({ id, projectId, title: "x", agent: "@claude:claude-opus-5-5", status: "idle", access: "edits", turns: 0, usage: emptyUsage(), createdAt: 1, updatedAt: 1 });
    await runtime.send("a", "hello");
    await runtime.send("b", "hello");
    assert.deepEqual(seen.map((o) => o.designOnItsOwn ?? false), [true, false]);
  } finally {
    providers.claude = saved;
  }
});

test("lean.skills with no folder: your own skills and the built-in ones as listed with one, never a project's own, none loaded", async () => {
  const { api, project, design } = setup();
  const site = project("site");
  for (const [root, name] of [[join(design.env.HOME!, ".claude/skills"), "mine-brand"], [join(site.path, ".claude/skills"), "site-ui"]]) {
    mkdirSync(join(root, name), { recursive: true });
    writeFileSync(join(root, name, "SKILL.md"), `---\nname: ${name}\ndescription: Brand and UI design\n---\n# ${name}\n`);
  }
  await api.call("design.new", { title: "Landing", projectId: site.id });
  await api.call("canvas.save", { cwd: site.path, file: "landing", patch: { lean: { skills: ["mine-brand", "site-ui"] } } });
  const withFolder = await api.call("lean.skills", { cwd: site.path, file: "landing" });
  const none = await api.call("lean.skills", {});
  assert.ok(withFolder.some((x) => x.name === "site-ui"), "the project's own, with its folder");
  assert.equal(none.some((x) => x.name === "site-ui"), false, "never without one");
  assert.deepEqual(none, withFolder.filter((x) => x.name !== "site-ui").map((x) => ({ ...x, loaded: false })), "the rest exactly as listed with a folder, none loaded");
  assert.ok(none.some((x) => x.name === "mine-brand") && none.some((x) => x.name === "liner-2"));
});

test("design.remove and design.unremove: one design file of a project to the trash and back, with its build copies and picture setting; refused while drawn in; a design on its own goes as its project", async () => {
  const s = setup();
  const { api, store, home, project, runtime } = s;
  const site = project("site");
  await api.call("design.new", { title: "Landing", size: "phone", projectId: site.id });
  await api.call("design.new", { title: "Other", projectId: site.id });
  const dir = join(site.path, ".liner/designs/landing");
  writeFileSync(join(dir, "frames/phone.html"), "<p>drawn</p>");
  setPicturesPref(home, site.path, "landing", { ask: "always", model: null });
  const built = builtCopy(home, site.path, "landing", "phone");
  mkdirSync(join(built, ".."), { recursive: true });
  writeFileSync(built, "<p>built</p>");
  // Refused while a session begun from it works.
  const t = await api.call("thread.create", { projectId: site.id, agent: "@demo:demo", design: { file: "landing" } });
  let release!: () => void;
  const held = runtime.exclusive(t.id, () => new Promise<void>((r) => (release = r)));
  await assert.rejects(api.call("design.remove", { projectId: site.id, file: "landing" }), /An agent is drawing in this design now/);
  release();
  await held;
  assert.ok(existsSync(dir));
  // Removed: gone from the folder and the engine's keys, kept in the trash.
  assert.deepEqual(await api.call("design.remove", { projectId: site.id, file: "landing" }), { ok: true });
  assert.equal(existsSync(dir), false);
  assert.equal(picturesPref(home, site.path, "landing"), undefined);
  assert.equal(existsSync(built), false);
  assert.deepEqual((await api.call("design.all", {})).find((x) => x.project.id === site.id)?.files.map((f) => f.id), ["other"]);
  await assert.rejects(api.call("design.remove", { projectId: site.id, file: "landing" }), /no design file “landing”/);
  await assert.rejects(api.call("design.remove", { projectId: site.id, file: "../x" }), /isn't a design file's name/);
  // Back as it was.
  const back = await api.call("design.unremove", { projectId: site.id, file: "landing" });
  assert.deepEqual(back.file.frames.map((f) => f.id), ["phone"]);
  assert.equal(readFileSync(join(dir, "frames/phone.html"), "utf8"), "<p>drawn</p>");
  assert.deepEqual(picturesPref(home, site.path, "landing"), { ask: "always", model: null });
  assert.equal(readFileSync(built, "utf8"), "<p>built</p>");
  await assert.rejects(api.call("design.unremove", { projectId: site.id, file: "landing" }), /no removed design file “landing”/);
  // One of that slug made meanwhile: the removed one doesn't come back over it.
  await api.call("design.remove", { projectId: site.id, file: "landing" });
  await api.call("design.new", { title: "Landing", projectId: site.id });
  await assert.rejects(api.call("design.unremove", { projectId: site.id, file: "landing" }), /again, so the removed one can't come back/);
  // Never through a link: a .liner/designs that leads away.
  const linked = project("linked");
  const away = tmp("lc-start-away2-");
  mkdirSync(join(linked.path, ".liner"));
  mkdirSync(join(away, "landing"));
  writeFileSync(join(away, "landing/design.json"), "{}");
  symlinkSync(away, join(linked.path, ".liner/designs"));
  await assert.rejects(api.call("design.remove", { projectId: linked.id, file: "landing" }), /is a link/);
  assert.ok(existsSync(join(away, "landing/design.json")));
  // A design on its own: its project goes, as project.remove takes one; its folder stays.
  const own = await api.call("design.new", { title: "Harbour" });
  await api.call("design.remove", { projectId: own.project.id, file: own.file.id });
  assert.equal(store.projects.some((p) => p.id === own.project.id), false);
  assert.ok(existsSync(join(own.project.path, ".liner/designs/harbour/design.json")));
});

test("design.discard: an untouched design on its own goes whole; one worked on, renamed, with a session or a stray file, or a project, is refused and untouched", async () => {
  const { api, store, project, home } = setup();
  const fresh = await api.call("design.new", { size: "desktop+phone" });
  assert.deepEqual(await api.call("design.discard", { projectId: fresh.project.id }), { ok: true });
  assert.equal(existsSync(fresh.project.path), false, "its folder is gone");
  assert.equal(store.projects.some((p) => p.id === fresh.project.id), false);
  const kept = async (projectId: string, why: RegExp) => {
    const p = store.project(projectId);
    const before = existsSync(p.path) ? readdirSync(p.path, { recursive: true }).map(String).sort() : [];
    await assert.rejects(api.call("design.discard", { projectId }), why);
    assert.ok(store.projects.some((x) => x.id === projectId), "its project stays");
    assert.deepEqual(readdirSync(p.path, { recursive: true }).map(String).sort(), before, "its folder as it was");
  };
  // A drawn frame.
  const drawn = await api.call("design.new", { size: "phone" });
  writeFileSync(join(drawn.project.path, ".liner/designs", drawn.file.id, "frames/phone.html"), "<p>drawn</p>");
  await kept(drawn.project.id, /is kept: its folder has changed since it was made/);
  // Renamed.
  const named = await api.call("design.new", { size: "phone" });
  await api.call("design.rename", { projectId: named.project.id, file: named.file.id, title: "Harbour" });
  await kept(named.project.id, /is kept: it has a name of its own|has changed/);
  // A session made for it (even one deleted since).
  const talked = await api.call("design.new", { size: "phone" });
  const t = await api.call("thread.create", { projectId: talked.project.id, agent: "@demo:demo" });
  await kept(talked.project.id, /is kept: it has a session/);
  await api.call("thread.remove", { id: t.id });
  assert.equal(store.threads.some((x) => x.id === t.id), false);
  await kept(talked.project.id, /is kept: it has been worked on/);
  // A stray file, and an empty folder, in its folder.
  const stray = await api.call("design.new", {});
  writeFileSync(join(stray.project.path, "notes.txt"), "mine");
  await kept(stray.project.id, /is kept: its folder has changed since it was made/);
  const extra = await api.call("design.new", {});
  mkdirSync(join(extra.project.path, ".liner/designs", extra.file.id, "assets", "pic"));
  await kept(extra.project.id, /has changed/);
  // A project, a design in a project, and a design whose folder is a link.
  const site = project("site");
  await api.call("design.new", { projectId: site.id });
  await kept(site.id, /is kept: it isn't a design on its own/);
  const linked = await api.call("design.new", {});
  const away = tmp("lc-start-away3-");
  const real = linked.project.path;
  renameSync(real, join(away, "moved"));
  symlinkSync(join(away, "moved"), real);
  await assert.rejects(api.call("design.discard", { projectId: linked.project.id }), /is kept: its folder is a link/);
  assert.ok(existsSync(join(away, "moved/.liner/designs", linked.file.id, "design.json")));
  // A design on its own whose folder sits outside the designs home.
  const outside = store.putProject({ id: "pr_out", name: "Untitled design", path: tmp("lc-start-out-"), git: false, kind: "design", createdAt: 1 });
  await kept(outside.id, /isn't in the designs home/);
  void home;
});

test("design.attach killed after each step: a fresh engine on the same home finds the design whole on one side, its sessions there, no staging and no journal", async () => {
  for (const step of ["staged", "renamed", "switched", "saved"] as const) {
    const s = setup();
    const { api, store, home, project } = s;
    const { own, src, t } = await designWithHistory(s);
    const site = project("site");
    await api.call("design.new", { title: "Landing", projectId: site.id });
    attachCrash.at = step;
    try {
      await assert.rejects(api.call("design.attach", { projectId: own.project.id, to: { projectId: site.id } }), (e) => e === CRASH);
    } finally {
      attachCrash.at = undefined;
    }
    // The killed engine saves nothing more: its waiting save is dropped, as a kill drops it.
    clearTimeout((store as unknown as { saveTimer: NodeJS.Timeout }).saveTimer);
    (store as unknown as { saveTimer: null }).saveTimer = null;
    // A fresh engine on the same home: its start puts the cut move right.
    const fresh = new Store(home);
    const e = env();
    const runtime = new Runtime(fresh, e);
    const raw = createApi(fresh, runtime, e, { routines: { routines: [], recent: [], put: () => undefined, remove: () => undefined }, terms: {}, logs: {}, proxies: {}, design: designCtx(fresh, { env: e }) } as never);
    opened.push({ stop: () => (raw.updates.stop(), runtime.shutdown()) });
    const thread = fresh.thread(t.id);
    const moved = step === "saved";
    assert.equal(thread.projectId, moved ? site.id : own.project.id, `${step}: the session's side`);
    assert.deepEqual(thread.design, { file: moved ? "landing-2" : "landing" }, `${step}: its design file`);
    assert.equal(fresh.projects.some((p) => p.id === own.project.id), !moved, `${step}: the design project`);
    assert.equal(existsSync(join(src, ".liner/designs/landing/design.json")), !moved, `${step}: the source's design file`);
    assert.equal(existsSync(join(site.path, ".liner/designs/landing-2/design.json")), moved, `${step}: the target's copy`);
    assert.ok(existsSync(join(site.path, ".liner/designs/landing/design.json")), `${step}: the target's own design untouched`);
    assert.deepEqual(readdirSync(join(site.path, ".liner/designs")).filter((n) => n.startsWith(".")), [], `${step}: no staging folder`);
    assert.deepEqual(existsSync(join(home, "attach")) ? readdirSync(join(home, "attach")) : [], [], `${step}: no journal`);
    assert.deepEqual(picturesPref(home, moved ? site.path : src, moved ? "landing-2" : "landing"), { ask: "never", model: null }, `${step}: the picture setting on the design's side`);
    assert.ok(existsSync(join(home, "designs", t.id, "canvas", moved ? "landing-2" : "landing", "t1")), `${step}: the versions under the session's slug`);
    if (moved) assert.equal(existsSync(src), false, `${step}: the emptied source folder finished going`);
  }
});

test("a staging folder a killed move left is cleared as the engine starts, never through a link", () => {
  const { store, home } = setup();
  const site = tmp("lc-start-stale-");
  store.putProject({ id: "pr_stale", name: "stale", path: site, git: false, createdAt: 1 });
  mkdirSync(join(site, ".liner/designs/.attach-at_dead1/landing/frames"), { recursive: true });
  mkdirSync(join(site, ".liner/designs/keep-me"), { recursive: true });
  mkdirSync(join(site, ".liner/designs/.attach-elsewhere"), { recursive: true });
  const linked = tmp("lc-start-stale-linked-");
  const away = tmp("lc-start-stale-away-");
  mkdirSync(join(away, "designs/.attach-at_dead2"), { recursive: true });
  symlinkSync(away, join(linked, ".liner"));
  store.putProject({ id: "pr_linked", name: "linked", path: linked, git: false, createdAt: 1 });
  store.flush();
  const fresh = new Store(home);
  const e = env();
  const runtime = new Runtime(fresh, e);
  const raw = createApi(fresh, runtime, e, { routines: { routines: [], recent: [], put: () => undefined, remove: () => undefined }, terms: {}, logs: {}, proxies: {}, design: designCtx(fresh, { env: e }) } as never);
  opened.push({ stop: () => (raw.updates.stop(), runtime.shutdown()) });
  assert.deepEqual(readdirSync(join(site, ".liner/designs")).sort(), [".attach-elsewhere", "keep-me"], "only the engine's own staging names go");
  assert.ok(existsSync(join(away, "designs/.attach-at_dead2")), "nothing through a link");
});

test("a journal cut short as it was written (only its .tmp) and one that doesn't parse are cleared as the engine starts", () => {
  const { home, store } = setup();
  mkdirSync(join(home, "attach"), { recursive: true });
  writeFileSync(join(home, "attach", "at_cut.json.tmp"), '{"id":"at_cut","sou');
  writeFileSync(join(home, "attach", "at_bad.json"), "{not json");
  store.flush();
  const fresh = new Store(home);
  const e = env();
  const runtime = new Runtime(fresh, e);
  const raw = createApi(fresh, runtime, e, { routines: { routines: [], recent: [], put: () => undefined, remove: () => undefined }, terms: {}, logs: {}, proxies: {}, design: designCtx(fresh, { env: e }) } as never);
  opened.push({ stop: () => (raw.updates.stop(), runtime.shutdown()) });
  assert.deepEqual(readdirSync(join(home, "attach")), []);
});

test("a watched design file removed on disk is told once (canvas.changed, gone: true), and once again when it's back; canvas.open refuses while it's gone", async () => {
  const { api, store } = setup();
  const own = await api.call("design.new", { size: "phone" });
  const cwd = own.project.path;
  const dir = join(cwd, ".liner/designs", own.file.id);
  const gone: (boolean | undefined)[] = [];
  store.on((ev) => {
    if (ev.type === "canvas.changed" && ev.file === own.file.id && ev.gone !== undefined) gone.push(ev.gone);
  });
  const until = async (n: number) => {
    for (let i = 0; i < 60 && gone.length < n; i++) await new Promise((r) => setTimeout(r, 100));
  };
  await api.call("canvas.watch", { cwd, file: own.file.id, on: true });
  try {
    // design.json alone removed, then put back.
    const index = readFileSync(join(dir, "design.json"));
    rmSync(join(dir, "design.json"));
    await until(1);
    assert.deepEqual(gone, [true]);
    await assert.rejects(api.call("canvas.open", { cwd, file: own.file.id }), /isn't there any more: its folder or its design\.json was removed on disk/);
    assert.equal(existsSync(join(dir, "design.json")), false, "never made again behind the person's back");
    writeFileSync(join(dir, "design.json"), index);
    await until(2);
    assert.deepEqual(gone, [true, false]);
    // The whole folder removed, then back.
    const keep = tmp("lc-start-keep-");
    cpSync(dir, join(keep, "d"), { recursive: true });
    rmSync(dir, { recursive: true });
    await until(3);
    await new Promise((r) => setTimeout(r, 1200));
    assert.deepEqual(gone, [true, false, true], "once per change, not once a second");
    await assert.rejects(api.call("canvas.open", { cwd, file: own.file.id }), /isn't there any more/);
    cpSync(join(keep, "d"), dir, { recursive: true });
    await until(4);
    assert.deepEqual(gone, [true, false, true, false]);
    assert.equal((await api.call("canvas.open", { cwd, file: own.file.id })).file.id, own.file.id);
  } finally {
    await api.call("canvas.watch", { cwd, file: own.file.id, on: false });
  }
});

test("nothing was made under the real home's Liner Designs", () => {
  const now = existsSync(REAL) ? readdirSync(REAL).sort() : null;
  assert.deepEqual(now, realBefore, `${REAL} changed during the tests`);
});
