/*
  Your own changes go along (edits.ts): a message after files changed between turns tells the agent which ones, by name and
  line counts, ahead of your words, and your message keeps the list for its grey line. No change gives no note; what Liner
  can't place is said as changed outside the session's turns, never as a person's; an Undo of a turn is named as an Undo;
  another session's work in the folder (a turn still running, a turn it undid) as that session's; the note stops at 20 names; the switch in Settings turns it off. A fake Claude Code
  in a throwaway repository.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EditedFile, Item, ProviderInfo, Thread } from "../../contracts/src/index.ts";
import { createApi } from "../src/api.ts";
import { editsNote, NOTE_CAP } from "../src/edits.ts";
import { run } from "../src/exec.ts";
import type { Provider, TurnSink } from "../src/providers/types.ts";
import { providers, Runtime } from "../src/runtime.ts";
import { Store } from "../src/store.ts";

const info = (id: ProviderInfo["id"], models: string[]): ProviderInfo => ({ id, label: id, available: true, adapter: true, login: "", models: models.map((m) => ({ id: m, label: m, description: "" })), supports: { approvals: true, resume: true, effort: true, plan: true } });
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean, what: string) {
  for (let i = 0; i < 500 && !ok(); i++) await tick();
  assert.ok(ok(), what);
}
const who = { GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" };
const git = (cwd: string, ...args: string[]) => run("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd, env: { ...process.env, ...who } });

/** Claude Code, faked: records each prompt, and runs `work` in the turn (an agent's own edits). */
function fake(work: (text: string, sink: TurnSink) => void = () => {}) {
  const prompts: string[] = [];
  const p: Provider = {
    id: "claude",
    detect: async () => info("claude", ["claude-opus-5-5"]),
    open: () => ({ close() {}, turn: async (text, sink) => void (prompts.push(text), work(text, sink)) }),
  };
  const saved = providers.claude;
  providers.claude = p;
  return { prompts, restore: () => (providers.claude = saved) };
}

async function setup() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "lc-edits-dir-")));
  await git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, ".gitignore"), "ignored/\n");
  writeFileSync(join(dir, "app.ts"), "one\ntwo\nthree\n");
  writeFileSync(join(dir, "notes.md"), "# notes\n");
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", "start");
  const home = realpathSync(mkdtempSync(join(tmpdir(), "lc-edits-home-")));
  const store = new Store(home);
  store.putProject({ id: "p", name: "p", path: dir, git: true, createdAt: Date.now() });
  const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", ...who };
  const runtime = new Runtime(store, env);
  runtime.providerInfo = [info("claude", ["claude-opus-5-5"])];
  const api = createApi(store, runtime, env, { routines: { routines: [], recent: [] }, terms: {}, logs: {}, proxies: {} } as never);
  const call = <T>(method: string, params: unknown) => api.call(method, params) as Promise<T>;
  const t = await call<Thread>("thread.create", { projectId: "p", agent: "@claude:claude-opus-5-5", review: false, worktree: false });
  const turn = async (text: string, n: number) => {
    await call("thread.send", { id: t.id, text });
    await until(() => store.timeline(t.id).filter((x) => x.kind === "turn").length === n && !runtime.isRunning(t.id), `turn ${n} ran`);
  };
  const lastUser = () => store.timeline(t.id).findLast((x): x is Extract<Item, { kind: "user" }> => x.kind === "user")!;
  return { dir, store, runtime, call, t, turn, lastUser };
}

test("edits: no change between turns gives no note, and the message goes as it was written", async () => {
  const f = fake();
  try {
    const s = await setup();
    await s.turn("first", 1);
    await s.turn("second", 2);
    assert.equal(f.prompts[1], "second");
    assert.equal(s.lastUser().edits, undefined);
  } finally {
    f.restore();
  }
});

test("edits: files you changed, added and deleted between turns go ahead of your words, with line counts, no contents; ignored files don't", async () => {
  const f = fake();
  try {
    const s = await setup();
    await s.turn("first", 1);
    writeFileSync(join(s.dir, "app.ts"), "one\nTWO\nthree\nfour\n");
    writeFileSync(join(s.dir, "new.ts"), "export const x = 1;\nSECRET-CONTENT\n");
    await run("rm", [join(s.dir, "notes.md")]);
    await run("mkdir", ["-p", join(s.dir, "ignored")]);
    writeFileSync(join(s.dir, "ignored", "build.js"), "x\n");
    await s.turn("carry on", 2);
    const prompt = f.prompts[1];
    assert.ok(prompt.endsWith("\n\ncarry on"), "your words come last, as you wrote them");
    assert.match(prompt, /## Files changed since your last turn/);
    assert.match(prompt, /Changed since your last turn, outside your turns:/);
    assert.match(prompt, /app\.ts \(modified, \+2 −1\)/);
    assert.match(prompt, /new\.ts \(added, \+2 −0\)/);
    assert.match(prompt, /notes\.md \(deleted\)/);
    assert.ok(!prompt.includes("SECRET-CONTENT"), "no contents");
    assert.ok(!prompt.includes("ignored/"), "ignored files are left out");
    assert.ok(!/\b(?:you must|please|do not)\b/i.test(prompt.split("\n\ncarry on")[0]), "information, not an instruction");
    const u = s.lastUser();
    assert.equal(u.text, "carry on", "the bubble keeps your words only");
    assert.deepEqual(u.edits?.map((e) => `${e.path}:${e.by}`).sort(), ["app.ts:outside", "new.ts:outside", "notes.md:outside"]);
  } finally {
    f.restore();
  }
});

test("edits: the agent's own edits in its turn aren't yours, and an Undo of a turn is named as an Undo", async () => {
  // Turn 1 writes made.ts (the agent's edit); you undo it; turn 2 hears an Undo, not an edit of yours.
  let s!: Awaited<ReturnType<typeof setup>>;
  const f = fake((text) => {
    if (text === "make it") writeFileSync(join(s.dir, "made.ts"), "a\nb\n");
  });
  try {
    s = await setup();
    await s.turn("make it", 1);
    await s.turn("look", 2);
    assert.equal(s.lastUser().edits, undefined, "the turn's own file isn't called yours");
    const cp = s.store.timeline(s.t.id).find((x) => x.kind === "checkpoint")!;
    await s.call("checkpoint.revert", { threadId: s.t.id, itemId: cp.id });
    writeFileSync(join(s.dir, "app.ts"), "one\ntwo\nthree\nmine\n");
    await s.turn("and now", 3);
    const edits = s.lastUser().edits!;
    assert.deepEqual(edits.map((e) => `${e.path}:${e.by}${e.turn ? `:${e.turn}` : ""}`).sort(), ["app.ts:outside", "made.ts:undo:1"]);
    const prompt = f.prompts.at(-1)!;
    assert.match(prompt, /Put back by an Undo of turn 1 in Liner Code[^\n]*\n- made\.ts \(deleted\)/);
    assert.match(prompt, /outside your turns:\n- app\.ts/);
    assert.ok(!/outside your turns:\n(?:- [^\n]*\n)*- made\.ts/.test(prompt), "made.ts isn't among yours");
  } finally {
    f.restore();
  }
});

test("edits: the switch in Settings turns the note off", async () => {
  const f = fake();
  try {
    const s = await setup();
    await s.turn("first", 1);
    s.store.setSettings({ shareEdits: false });
    writeFileSync(join(s.dir, "app.ts"), "changed\n");
    await s.turn("second", 2);
    assert.equal(f.prompts[1], "second");
    assert.equal(s.lastUser().edits, undefined);
  } finally {
    f.restore();
  }
});

test("edits: the note stops at 20 names and says how many more", () => {
  const files: EditedFile[] = Array.from({ length: 34 }, (_, i) => ({ path: `src/f${i}.ts`, status: "modified", added: 1, removed: 0, by: "outside" }));
  const note = editsNote(files);
  assert.equal(NOTE_CAP, 20);
  assert.equal(note.split("\n").filter((l) => l.startsWith("- src/")).length, 20);
  assert.match(note, /- and 14 more$/);
  // Across groups the cap is shared; a tool told the conversation again isn't told of an Undo twice.
  const mixed: EditedFile[] = [...files.slice(0, 15), ...Array.from({ length: 10 }, (_, i): EditedFile => ({ path: `old/u${i}.ts`, status: "deleted", added: 0, removed: 3, by: "undo", turn: 2 }))];
  const both = editsNote(mixed);
  assert.equal(both.split("\n").filter((l) => /^- (src|old)\//.test(l)).length, 20);
  assert.match(both, /- and 5 more$/);
  assert.ok(!editsNote(mixed, { skipUndo: true }).includes("Undo"));
  assert.equal(editsNote(mixed.slice(15), { skipUndo: true }), "");
});

test("edits: what came with a branch switch is named as that, not as yours", async () => {
  const f = fake();
  try {
    const s = await setup();
    await git(s.dir, "checkout", "-q", "-b", "other");
    writeFileSync(join(s.dir, "theirs.ts"), "from the other branch\n");
    await git(s.dir, "add", "-A");
    // Made before the session's turn, as a branch you switch to was (authoredPaths counts commits made since as yours).
    await run("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "-q", "-m", "other work"], { cwd: s.dir, env: { ...process.env, ...who, GIT_COMMITTER_DATE: "2020-01-01T00:00:00Z", GIT_AUTHOR_DATE: "2020-01-01T00:00:00Z" } });
    await git(s.dir, "checkout", "-q", "main");
    await s.turn("first", 1);
    await git(s.dir, "checkout", "-q", "other");
    writeFileSync(join(s.dir, "app.ts"), "one\ntwo\nthree\nmine\n");
    await s.turn("second", 2);
    assert.deepEqual(s.lastUser().edits?.map((e) => `${e.path}:${e.by}`).sort(), ["app.ts:outside", "theirs.ts:branch"]);
    assert.match(f.prompts[1], /Came in with a pull, merge or branch switch:\n- theirs\.ts/);
  } finally {
    f.restore();
  }
});

test("edits: the note never says a person did it; the default group is only 'outside your turns'", async () => {
  const f = fake();
  try {
    const s = await setup();
    await s.turn("first", 1);
    writeFileSync(join(s.dir, "app.ts"), "changed\n");
    await s.turn("second", 2);
    assert.match(f.prompts[1], /Changed since your last turn, outside your turns:\n- app\.ts/);
    assert.ok(!/person|by you|you changed|you edited/i.test(f.prompts[1].split("\n\nsecond")[0]), "claims only what Liner knows");
  } finally {
    f.restore();
  }
});

test("edits: another session's turn still running in the same folder, and another session's undone turn, are named as that session's", async () => {
  // Two sessions in one checkout. B's turn writes b.ts and waits; A sends meanwhile: b.ts is B's, not outside work.
  let s!: Awaited<ReturnType<typeof setup>>;
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const f = fake();
  const saved = providers.claude;
  providers.claude = {
    ...saved,
    open: (o) => {
      const inner = saved.open(o);
      return {
        ...inner,
        turn: async (text, sink, signal) => {
          if (text === "b works") {
            writeFileSync(join(s.dir, "b.ts"), "b\n");
            await held;
          }
          if (text === "b undoable") writeFileSync(join(s.dir, "undone.ts"), "u\n");
          return inner.turn(text, sink, signal);
        },
      };
    },
  };
  try {
    s = await setup();
    const b = await s.call<Thread>("thread.create", { projectId: "p", agent: "@claude:claude-opus-5-5", review: false, worktree: false, title: "Session B" });
    s.store.patchThread(b.id, { title: "Session B" });
    await s.turn("first", 1);
    // Changed before B's turn began: outside work. (One made while B runs can't be told from B's, and is named as B's.)
    writeFileSync(join(s.dir, "app.ts"), "outside\n");
    await s.call("thread.send", { id: b.id, text: "b works" });
    await until(() => existsSync(join(s.dir, "b.ts")) && s.store.timeline(b.id).some((x) => x.kind === "turn" && x.status === "running"), "B's turn is under way");
    await s.turn("second", 2);
    assert.deepEqual(s.lastUser().edits?.map((e) => `${e.path}:${e.by}${e.title ? `:${e.title}` : ""}`).sort(), ["app.ts:outside", "b.ts:session:Session B"]);
    assert.match(f.prompts.at(-1)!, /another session working in this folder \("Session B"\):\n- b\.ts/);
    release();
    await until(() => !s.runtime.isRunning(b.id), "B's turn ended");
    // B's next turn writes undone.ts before A's third turn; B undoes it after: for A the file going is B's Undo, not outside work.
    await s.call("thread.send", { id: b.id, text: "b undoable" });
    await until(() => !s.runtime.isRunning(b.id) && s.store.timeline(b.id).filter((x) => x.kind === "checkpoint").length === 2, "B's second turn left a checkpoint");
    await s.turn("third", 3);
    const cp = s.store.timeline(b.id).findLast((x) => x.kind === "checkpoint")!;
    await s.call("checkpoint.revert", { threadId: b.id, itemId: cp.id });
    assert.ok(!existsSync(join(s.dir, "undone.ts")), "B's Undo took the file away");
    await s.turn("fourth", 4);
    assert.deepEqual(s.lastUser().edits?.map((e) => `${e.path}:${e.by}${e.title ? `:${e.title}` : ""}`), ["undone.ts:session:Session B"]);
  } finally {
    providers.claude = saved;
    f.restore();
  }
});

/**
  Git on PATH for this file's own calls (edits.ts runs git from process.env): each call is logged, and the note's list of the
  session's refs waits eight seconds while the file `slowFile` is there. Everything else goes to the real git.
*/
async function gitShim() {
  const real = (await run("sh", ["-c", "command -v git"])).stdout.trim();
  const bin = realpathSync(mkdtempSync(join(tmpdir(), "lc-edits-bin-")));
  const log = join(bin, "calls.log");
  const slowFile = join(bin, "slow");
  writeFileSync(log, "");
  writeFileSync(join(bin, "git"), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\ncase "$*" in *"%(objectname) %(committerdate:unix)"*) [ -f '${slowFile}' ] && sleep 8;; esac\nexec '${real}' "$@"\n`);
  chmodSync(join(bin, "git"), 0o755);
  const saved = process.env.PATH;
  process.env.PATH = `${bin}:${saved ?? ""}`;
  return { log, slowFile, calls: () => readFileSync(log, "utf8").split("\n").filter(Boolean), restore: () => (process.env.PATH = saved) };
}

test("edits: many files changed while another session's turn runs in the folder take one diff, not a git process each", async () => {
  let s!: Awaited<ReturnType<typeof setup>>;
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const f = fake();
  const saved = providers.claude;
  providers.claude = {
    ...saved,
    open: (o) => {
      const inner = saved.open(o);
      return {
        ...inner,
        turn: async (text, sink, signal) => {
          if (text === "b works") {
            for (let i = 0; i < 60; i++) writeFileSync(join(s.dir, `b${i}.ts`), `b${i}\n`);
            await held;
          }
          return inner.turn(text, sink, signal);
        },
      };
    },
  };
  const shim = await gitShim();
  try {
    s = await setup();
    const b = await s.call<Thread>("thread.create", { projectId: "p", agent: "@claude:claude-opus-5-5", review: false, worktree: false, title: "Session B" });
    s.store.patchThread(b.id, { title: "Session B" });
    await s.turn("first", 1);
    await s.call("thread.send", { id: b.id, text: "b works" });
    await until(() => existsSync(join(s.dir, "b59.ts")) && s.store.timeline(b.id).some((x) => x.kind === "turn" && x.status === "running"), "B's turn is under way");
    const before = shim.calls().length;
    await s.turn("second", 2);
    const edits = s.lastUser().edits ?? [];
    assert.equal(edits.length, 60);
    assert.ok(edits.every((e) => e.by === "session" && e.title === "Session B"), "every one is B's");
    const diffs = shim.calls().slice(before).filter((c) => c.includes("diff --name-only"));
    assert.ok(diffs.length <= 3, `one diff for the running turn's files, not one each: ${diffs.length}`);
    release();
    await until(() => !s.runtime.isRunning(b.id), "B's turn ended");
  } finally {
    shim.restore();
    providers.claude = saved;
    f.restore();
  }
});

test("edits: a note that takes too long is left out and doesn't hold the turn; a Stop while it's read stops the turn at once", async () => {
  const f = fake();
  const shim = await gitShim();
  try {
    const s = await setup();
    s.runtime.editsMs = 300;
    await s.turn("first", 1);
    writeFileSync(join(s.dir, "app.ts"), "changed\n");
    writeFileSync(shim.slowFile, "");
    let at = Date.now();
    await s.turn("second", 2);
    assert.ok(Date.now() - at < 5000, `went without waiting for the note: ${Date.now() - at} ms`);
    assert.equal(f.prompts.at(-1), "second", "no note");
    assert.equal(s.lastUser().edits, undefined);
    // Waiting as long as it likes now, but Stop ends it.
    s.runtime.editsMs = 60_000;
    writeFileSync(join(s.dir, "app.ts"), "changed again\n");
    at = Date.now();
    await s.call("thread.send", { id: s.t.id, text: "third" });
    await until(() => s.runtime.isRunning(s.t.id), "the third turn began");
    await tick(300);
    await s.call("thread.stop", { id: s.t.id });
    await until(() => !s.runtime.isRunning(s.t.id), "stopped");
    assert.ok(Date.now() - at < 5000, `Stop didn't wait for the note: ${Date.now() - at} ms`);
    assert.equal(f.prompts.length, 2, "the stopped turn never reached the tool");
  } finally {
    shim.restore();
    f.restore();
  }
});
