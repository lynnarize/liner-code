/*
  The 2026-11-18 polish round, the desktop shell: a quit that waits on an engine gone silent, and
  the sign-in scripts left in the temporary folder.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QuitWhenDone, type Live } from "../src/finish.ts";
import { oldScripts } from "../src/temp.ts";

const t = (id: string, status: string): Live => ({ id, title: `Session ${id}`, status });

/** Unanswered looks every `every` ms from `from`, as main.ts makes them (a 3 s tick, each look held to 5 s): what the last said. */
const silentFor = (q: QuitWhenDone, from: number, n: number, every = 6000) => {
  let quit = false;
  for (let i = 0; i < n; i++) quit = q.unanswered(from + i * every);
  return quit;
};

test("an engine that stops answering doesn't keep a quit that waits out of sight for ever", () => {
  const q = new QuitWhenDone(0, 60_000);
  // The last answer said a session works: the app waits.
  assert.equal(q.read([t("a", "running")], 0).quit, false);
  // Then each look times out: it waits a minute of silence, look after look, not for ever.
  assert.equal(silentFor(q, 6000, 10), false, "ten looks over 54 s");
  assert.equal(q.unanswered(66_000), true, "eleven looks over a minute awake");
});

test("one answer in the silence starts it over, and work it reports still holds the app", () => {
  const q = new QuitWhenDone(0, 60_000);
  q.read([t("a", "running")], 0);
  assert.equal(silentFor(q, 6000, 8), false);
  // It answered (a busy moment, not a stuck engine), and the session still works.
  assert.equal(q.read([t("a", "running")], 50_000).quit, false);
  assert.equal(silentFor(q, 56_000, 10), false, "silence counts from the last answer");
  assert.equal(q.unanswered(116_000), true);
});

test("a Mac asleep between two unanswered looks doesn't quit: the minute is counted awake, and starts again after the sleep", () => {
  const q = new QuitWhenDone(0, 60_000);
  q.read([t("a", "running")], 0);
  assert.equal(q.unanswered(6000), false, "a look fails just before the lid closes");
  // An hour asleep; the first look after waking fails too, while the engine wakes.
  assert.equal(q.unanswered(6000 + 3600_000), false, "not a minute of silence, a sleep");
  assert.equal(silentFor(q, 6000 + 3600_000 + 6000, 9), false, "the minute starts after the sleep");
  assert.equal(q.unanswered(6000 + 3600_000 + 60_000), true, "and real silence after it still quits");
});

test("a few failed looks spread over a minute aren't silence: it takes several in a row", () => {
  const q = new QuitWhenDone(0, 60_000);
  q.read([t("a", "running")], 0);
  // Four looks 25 s apart (each under the sleep gap): 75 s, but only four tries.
  assert.equal(silentFor(q, 25_000, 4, 25_000), false);
});

test("an engine that answers, even to say no, is there: its no never counts towards the silence", () => {
  const q = new QuitWhenDone(0, 60_000);
  q.read([t("a", "running")], 0);
  assert.equal(silentFor(q, 6000, 9), false);
  // main.ts: an ok:false answer (or one that isn't JSON) to state.get calls answered, never unanswered.
  q.answered();
  assert.equal(silentFor(q, 60_000, 10), false, "the count started again at the answer");
  for (let i = 0; i < 30; i++) q.answered();
  assert.equal(q.unanswered(200_000), false);
});

test("sign-in scripts a day old go from the temporary folder; new ones and anything else stay", () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-polish-temp-"));
  const day = 86_400_000;
  const make = (name: string, age: number) => {
    const f = join(dir, name);
    writeFileSync(f, "#!/bin/zsh -l\n");
    const t = new Date(Date.now() - age);
    utimesSync(f, t, t);
    return f;
  };
  const old = make("liner-0a1b2c3d.command", 2 * day);
  const oldWin = make("liner-0a1b2c3e.cmd", 2 * day);
  const fresh = make("liner-0a1b2c3f.command", 60_000);
  const other = make("liner-notes.command", 2 * day);
  const elses = make("someone-else.command", 2 * day);
  oldScripts(dir);
  assert.equal(existsSync(old), false);
  assert.equal(existsSync(oldWin), false);
  for (const f of [fresh, other, elses]) assert.equal(existsSync(f), true, f);
});
