/*
  Workshop (once Creator mode) and the other modes. A session's mode is set as it starts and kept (a
  fork keeps its parent's); Workshop adds its short guide to what the agent is told, a custom mode
  its named agent's instructions, Standard nothing; liner_inspect reads the guide's deeper parts by
  topic; and mode_add makes a custom mode only on the person's yes. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentProfile, Item, PanelManifest } from "../../contracts/src/index.ts";
import { asksForAddon, BUILTIN_MODES, CREATE_ADDON_ASK, emptyUsage, modeName } from "../../contracts/src/index.ts";
import { Addons, STORAGE_MAX } from "../src/addons.ts";
import { AgentTools, type AddonHost } from "../src/agent-tools.ts";
import { creatorNote, LINER_2, modeNote, topicText, TOPICS } from "../src/creator.ts";
import { ADDON_GUIDE } from "../src/addons.ts";
import { CHECK_THEME } from "../src/panels.ts";
import { Store } from "../src/store.ts";

const reviewer: AgentProfile = { id: "rev", name: "Code review", role: "Bugs and missing tests first", glyph: "lens", specialty: "custom", model: "claude:claude-sonnet-5-5", effort: "medium", soul: "Prioritise likely bugs. Cite files and lines." };
const n = (t: string) => `mcp__liner__${t}`;

test("modes: a session's mode is set as it starts, kept by a fork, and only one that exists", async () => {
  const { createApi } = await import("../src/api.ts");
  const { Runtime } = await import("../src/runtime.ts");
  const store = new Store(mkdtempSync(join(tmpdir(), "lc-mode-")));
  store.putProject({ id: "p", name: "p", path: mkdtempSync(join(tmpdir(), "lc-mode-p-")), git: false, createdAt: 1 });
  store.setAgents([...store.agents, reviewer]);
  const api = createApi(store, new Runtime(store, { PATH: "/usr/bin:/bin" }), { PATH: "/usr/bin:/bin" }, { routines: { routines: [], recent: [] }, terms: {}, logs: {}, proxies: {} } as never);
  const call = <T>(m: string, p: unknown) => api.call(m, p) as Promise<T>;
  const creator = await call<{ id: string; mode?: string }>("thread.create", { projectId: "p", agent: "@claude:claude-sonnet-5-5", mode: "creator" });
  assert.equal(creator.mode, "creator");
  assert.equal((await call<{ mode?: string }>("thread.create", { projectId: "p", agent: "@claude:claude-sonnet-5-5", mode: "standard" })).mode, undefined, "Standard is no mode at all");
  assert.equal((await call<{ mode?: string }>("thread.create", { projectId: "p", agent: "@claude:claude-sonnet-5-5", mode: "agent:rev" })).mode, "agent:rev");
  await assert.rejects(call("thread.create", { projectId: "p", mode: "agent:gone" }), /no mode by that name/);
  await assert.rejects(call("thread.create", { projectId: "p", mode: "cordis" }), /no mode by that name/);
  assert.equal((await call<{ mode?: string }>("thread.create", { projectId: "p", forkOf: creator.id })).mode, "creator", "a fork keeps its parent's mode");
});

test("modes: Workshop adds its guide, a custom one its instructions, Standard nothing", () => {
  const cwd = mkdtempSync(join(tmpdir(), "lc-mode-cwd-"));
  const note = modeNote({ mode: "creator", agent: "@claude:x" }, [], cwd, n, true);
  assert.match(note, /^## Workshop\n/);
  assert.match(note, /mcp__liner__addon_check/);
  assert.match(note, /mcp__liner__liner_inspect with a topic/);
  assert.match(note, /design or review, report/);
  assert.ok(note.length < 3500, `a short catalogue, not the whole guide (${note.length})`);
  assert.equal(modeNote({ mode: "creator", agent: "@claude:x" }, [], cwd, n, false), "", "no guide where Liner Code's tools aren't there to use it");
  assert.equal(modeNote({ agent: "@claude:x" }, [reviewer], cwd, n, true), "");
  assert.match(modeNote({ mode: "agent:rev", agent: "@claude:x" }, [reviewer], cwd, n, true), /^## Mode: Code review\n\nPrioritise likely bugs/);
  assert.equal(modeNote({ mode: "agent:rev", agent: "rev" }, [reviewer], cwd, n, true), "", "its own agent brings its brief already");
  assert.equal(modeNote({ mode: "agent:gone", agent: "@claude:x" }, [reviewer], cwd, n, true), "");
  assert.deepEqual(BUILTIN_MODES.map((m) => m.id), ["standard", "creator"]);
  assert.deepEqual(BUILTIN_MODES.map((m) => m.name), ["Standard", "Workshop"], "renamed in words only: its id stays creator");
  assert.deepEqual([modeName(undefined, []), modeName("creator", []), modeName("agent:rev", [reviewer])], ["Standard", "Workshop", "Code review"]);
});

test("liner_inspect: each topic of the guide, read on its own, and what's installed with its manifest and files", async () => {
  const home = mkdtempSync(join(tmpdir(), "lc-topics-"));
  const addons = new Addons(home);
  const notes: PanelManifest = { apiVersion: 1, id: "notes", kind: "panel", name: "Notes", place: "page", entry: "index.html", icon: "notes", access: { storage: 1024 } };
  addons.install(notes, { by: { agent: "x", at: 1 } }, { "index.html": "<p>notes</p>" });
  for (const t of TOPICS) {
    const s = topicText(t, { addons, draftRoot: "/x", n });
    assert.ok(s.length > 200 && s.length < 8192, `${t} reads as one part, under the pruner's head (${s.length})`);
  }
  assert.equal(topicText("catalogue", { addons, draftRoot: null, n }), creatorNote(n));
  const installed = topicText("installed", { addons, draftRoot: "/x", n });
  assert.match(installed, /- notes: Notes, panel \(page\), v1 of 1, on/);
  assert.match(installed, new RegExp(`${join(addons.dir, "notes", "v1", "files").replace(/[/\\]/g, ".")}`));
  assert.match(installed, /"access":\{"storage":1024\}/);
  assert.match(topicText("bridge", { addons, draftRoot: null, n }), /liner\.sessions\.list\(\).*access\.sessions "all"/);

  const store = new Store(mkdtempSync(join(tmpdir(), "lc-topics-s-")));
  store.putProject({ id: "p", name: "p", path: home, git: false, createdAt: 1 });
  store.putThread({ id: "t", projectId: "p", title: "x", agent: "x", status: "idle", access: "edits", turns: 1, usage: emptyUsage(), createdAt: 1, updatedAt: 1, mode: "creator" });
  const tools = new AgentTools(store, process.env);
  tools.addons = addons;
  const said = (r: { content: ({ text: string } | { data: string })[] }) => r.content.map((c) => ("text" in c ? c.text : "")).join("");
  assert.match(said(await tools.call("t", "liner_inspect", { topic: "places" })), /^Places: which one fits/);
  const bad = await tools.call("t", "liner_inspect", { topic: "plugins" });
  assert.equal(bad.isError, true);
  assert.match(said(bad), /There's no topic "plugins"\. The topics are catalogue, connections/);
  assert.match(said(await tools.call("t", "liner_inspect", {})), /^Liner Code add-ons: connections and panels/, "without a topic, the short guide as in Standard");
});

test("Create your add-on: its ask means a page, and a page app is held to the full version", () => {
  // The sidebar's Create your add-on writes DeepSeek Harness's ask; the guide reads a left sidebar entry as a page.
  assert.equal(CREATE_ADDON_ASK, "Create a Liner Code add-on with a left sidebar entry.");
  const note = creatorNote(n);
  assert.match(note, /An ask for a left sidebar entry, a page, a full-page app or a workspace is a page \(place "page"\), never the right dock/);
  assert.match(note, /full version of what was asked, not a demo/);
  assert.match(note, /"apps" the bar a full-page app meets/);
  assert.ok(note.length < 3500, `still a short catalogue (${note.length})`);
  const read = (t: (typeof TOPICS)[number]) => topicText(t, { addons: undefined, draftRoot: null, n });
  assert.match(read("places"), /"a left sidebar entry", "a page", "full page", "its own page" or "like Word" .* all mean "page", which takes the whole centre column/);
  // The bar, as screenshot 10's notes app meets it: library with search and New, a whole toolbar, empty states,
  // autosave with a status, counts, keys, both themes, room for the work, and the line for the Add-ons list.
  const apps = read("apps");
  for (const w of ["search", "New note", "undo and redo", "bold, italic, underline, strikethrough", "bulleted and numbered lists", "Empty states", '"Saved"', "words and characters", "⌘B", "⌥⌘N for New", "leave them alone: ⌘N", "[hidden] { display: none !important; }", 'liner.on("theme")', `${STORAGE_MAX} KB`, "A summary sentence"]) assert.ok(apps.includes(w), `the apps bar names ${w}`);
  assert.match(read("starters"), new RegExp(`"place": "page", "icon": "notes", "access": \\{ "storage": ${STORAGE_MAX} \\}`));
  assert.match(read("starters"), /grid-template: auto 1fr auto \/ 260px 1fr/);
  // The MCP server (its own small process) lists the topics by hand: it keeps up with the guide's.
  const enumOf = /enum: \[("catalogue"[^\]]*)\]/.exec(readFileSync(new URL("../src/liner-tools.ts", import.meta.url), "utf8"))?.[1];
  assert.deepEqual(JSON.parse(`[${enumOf}]`), [...TOPICS]);
});

/** AgentTools with a host that answers mode_add's card. */
function rig(allow: boolean, readOnly = false) {
  const store = new Store(mkdtempSync(join(tmpdir(), "lc-modeadd-")));
  const root = mkdtempSync(join(tmpdir(), "lc-modeadd-p-"));
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, "README.md"), "# p");
  store.putProject({ id: "p", name: "p", path: root, git: false, createdAt: 1 });
  store.putThread({ id: "t", projectId: "p", title: "Make a mode", agent: "@claude:claude-opus-5-5", effort: "high", status: "running", access: "edits", turns: 1, usage: emptyUsage(), createdAt: 1, updatedAt: 1, mode: "creator" });
  const tools = new AgentTools(store, process.env);
  tools.addons = new Addons(store.home);
  const asked: Parameters<AddonHost["askLiner"]>[1][] = [];
  tools.host = {
    keys: new Map(),
    providerInfo: [],
    askLiner(threadId, ask) {
      asked.push(ask);
      const id = `it-${asked.length}`;
      store.putItem(threadId, { kind: "approval", id, turn: 1, at: Date.now(), ...ask, state: allow ? "approved" : "denied" } as Item);
      return { id, answer: Promise.resolve({ allow }) };
    },
    relink: async () => new Map(),
    readOnly: () => readOnly,
    whoIs: () => "Opus 5.5",
    toolOf: () => ({ label: "Claude Code", family: "claude" }),
  };
  return { store, tools, asked };
}

test("mode_add: a custom mode is a named agent's instructions, added only on the person's yes", async () => {
  const yes = rig(true);
  const before = yes.store.agents.length;
  const r = await yes.tools.call("t", "mode_add", { name: "Code review", description: "Bugs first", instructions: "Prioritise likely bugs.", skills: ["~/.claude/skills/review/SKILL.md"] });
  assert.match(r.content.map((c) => ("text" in c ? c.text : "")).join(""), /^applied: the mode Code review is added \(agent:mode-/);
  assert.equal(yes.asked[0].title, "Add the mode Code review");
  const made = yes.store.agents.at(-1)!;
  assert.equal(yes.store.agents.length, before + 1);
  assert.deepEqual([made.name, made.role, made.soul, made.model, made.effort, made.skills], ["Code review", "Bugs first", "Prioritise likely bugs.", "claude:claude-opus-5-5", "high", ["~/.claude/skills/review/SKILL.md"]]);
  const again = await yes.tools.call("t", "mode_add", { name: "code review", instructions: "x" });
  assert.equal(again.isError, true, "one name, one mode");

  const no = rig(false);
  const n0 = no.store.agents.length;
  await no.tools.call("t", "mode_add", { name: "Code review", instructions: "Prioritise likely bugs." });
  assert.equal(no.store.agents.length, n0, "a no adds nothing");
  const ro = rig(true, true);
  assert.equal((await ro.tools.call("t", "mode_add", { name: "X", instructions: "y" })).isError, true, "a read-only session can't");
  assert.equal(ro.asked.length, 0);
  assert.equal((await yes.tools.call("t", "mode_add", { name: "Y" })).isError, true, "it needs instructions");
});

test("mode_add: the card carries every word of the instructions, and add-ons set to never offer don't stop a mode", async () => {
  const x = rig(true);
  x.store.setSettings({ addonOffers: "never" });
  const long = `${"Read before you edit. ".repeat(60)}And never push.`;
  const r = await x.tools.call("t", "mode_add", { name: "Careful", instructions: long });
  assert.match(r.content.map((c) => ("text" in c ? c.text : "")).join(""), /^applied: the mode Careful/);
  assert.equal(x.asked[0].fields?.find((f) => f.label === "Instructions")?.value, long, "what's approved is what's saved");
});

test("Liner 2.0: a SKILL.md beside the engine's source, read as the guide's design topic, before any HTML or CSS", () => {
  // A real skill: front matter naming it, shipped with the engine's source (build-mac.sh copies engine/src whole).
  const file = readFileSync(LINER_2, "utf8");
  assert.match(file, /^---\nname: liner-2\ndescription: Liner 2\.0, Liner Code's own look/);
  assert.ok(LINER_2.includes(join("engine", "src", "skills", "liner-2", "SKILL.md")));
  const design = topicText("design", { addons: undefined, draftRoot: null, n });
  assert.match(design, /^# Liner 2\.0\n/, "the body, without the front matter");
  assert.ok(design.length < 8192, `under the pruner's head (${design.length})`);
  // Every token the skill names, a frame gets (and addon_check draws with).
  for (const k of new Set(design.match(/--[a-z][a-z0-9-]*(?=[`)])/g))) assert.ok(k in CHECK_THEME, `the frame has ${k}`);
  for (const k of ["--well", "--plate", "--ink-4", "--hair", "--act", "--act-ink", "--ok", "--warn", "--danger", "--font-display"]) assert.ok(design.includes(`\`${k}\``), `the skill says how to use ${k}`);
  // Workshop reads it before drawing; a Standard session's short guide points to it too.
  const note = creatorNote(n);
  assert.match(note, /2\. Read "design" before any HTML or CSS: a panel or page is drawn in Liner 2\.0/);
  assert.ok(note.length < 3500, `still a short catalogue (${note.length})`);
  assert.match(ADDON_GUIDE, /Draw it in Liner 2\.0, Liner Code's own look.*liner_inspect with the topic "design"/);
  assert.match(topicText("theme", { addons: undefined, draftRoot: null, n }), /var\(--act\)  the main button/);
});

test("an add-on ask: Home switches a Standard task to Workshop for one, and not for work on the feature or another program's add-ons", () => {
  for (const ask of [CREATE_ADDON_ASK, "make me an add-on that tracks my todos", "buatkan add-on untuk catatan", "I want a Liner addon for Linear", "Add a panel to Liner Code that lists my TODOs", "create a page in Liner with a left sidebar entry for notes", "the add-on I asked for yesterday doesn't open", "bikin plugin buat liner code", "Can you build a Liner Code connection to Sentry?"])
    assert.ok(asksForAddon(ask), ask);
  for (const ask of ["", "Fix the flaky login test", "fix the add-ons page layout", "Fix my Firefox add-on's manifest", "make the add-on install card smaller", "add a settings panel to my app", "build a VS Code plugin", "Make Liner Code's add-ons page faster", "In Liner Code, the sidebar entry for Apps is misaligned, fix it", "make a wordpress add-on for bookings", "the add-ons are slow", "make the add-on work in Firefox", "port the add-on to Chrome. It's for my team", "publish my add-on for VS Code"])
    assert.ok(!asksForAddon(ask), ask);
  // Another program named after the add-on counts only in its own sentence, and not when Liner is named.
  for (const ask of ["make an add-on for my notes. It should open in Chrome", "a Liner Code add-on that opens links in Chrome"]) assert.ok(asksForAddon(ask), ask);
  // In Liner Code's own source, "add a tab to Liner" is work on the code; an add-on by name still counts.
  assert.ok(asksForAddon("Add a tab to Liner that lists my TODOs"));
  assert.ok(!asksForAddon("Add a tab to Liner that lists my TODOs", { ownSource: true }));
  assert.ok(asksForAddon("make me an add-on that tracks my todos", { ownSource: true }));
});
