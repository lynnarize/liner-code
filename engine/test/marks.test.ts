/*
  The marker folders' own bookkeeping (exec.ts markDir, marking, engineAlive, sweepMarks, startedAt): a look that failed never
  removes a folder, a removed folder is made again rather than failing a spawn, and an engine's start reads the same in every
  time zone. The looks (ps, lsof) are injected or made to fail on purpose, so these run where a sandbox refuses ps as well.
  Everything happens in a temp folder of its own (TMPDIR set before exec.ts is loaded), never in the real liner-marks.
  Run with `npm test -w engine`.
*/
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "lc-marks-"));
process.env.TMPDIR = root;
const { engineAlive, lstartUtc, markDir, markFile, marking, startedAt, sweepMarks } = await import("../src/exec.ts");
const MARKS = join(root, "liner-marks");
after(() => rmSync(root, { recursive: true, force: true }));

const skip = process.platform === "win32";
const sleeper = () => spawn("/bin/sleep", ["30"], { stdio: "ignore" });
const end = (c: ChildProcess) => new Promise((r) => (c.exitCode !== null || c.signalCode !== null ? r(null) : (c.once("exit", r), c.kill("SIGKILL"))));
/** A dead engine's folder, or a live one's (named for `pid`), with an `engine` file and one run's marker. */
const folder = (pid: number, start: number) => {
  const dir = join(MARKS, `${pid}-${start}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "engine"), JSON.stringify({ pid, start }));
  writeFileSync(join(dir, "liner-run-x"), "");
  return dir;
};
/** PATH with a ps and an lsof that answer nothing but a failure, as a sandbox or a machine under load does. */
const failingTools = () => {
  const bin = mkdtempSync(join(root, "bin-"));
  for (const t of ["ps", "lsof"]) {
    writeFileSync(join(bin, t), "#!/bin/sh\necho refused >&2\nexit 2\n");
    chmodSync(join(bin, t), 0o755);
  }
  return bin;
};

test("markers: a look that failed never takes a live engine for a dead one, and its folder stays", { skip }, async () => {
  const live = sleeper();
  try {
    const dir = folder(live.pid!, 1);
    // Neither look answers: couldn't tell, never "dead".
    const blind = { startedAt: () => undefined, holders: async () => null };
    assert.equal(await engineAlive(live.pid!, 1, dir, blind), null);
    const r = await sweepMarks(blind);
    assert.equal(r.folders, 0);
    assert.equal(r.ended, 0);
    assert.ok(existsSync(dir) && existsSync(join(dir, "liner-run-x")), "the folder and its markers stay");
    // The same with the real looks made to fail (ps and lsof refused, as execFileSync's 3 s timeout or a sandbox does).
    const path = process.env.PATH;
    process.env.PATH = `${failingTools()}:${path}`;
    try {
      assert.equal(startedAt(live.pid!), undefined);
      assert.equal(await engineAlive(live.pid!, 1, dir), null);
      assert.equal((await sweepMarks()).folders, 0);
    } finally {
      process.env.PATH = path;
    }
    assert.ok(existsSync(dir), "still there after a sweep with ps and lsof refused");
    // Answered: a live pid whose start is another's is that engine no longer, and its folder goes.
    assert.equal(await engineAlive(live.pid!, 1, dir, { startedAt: () => 1 + 60_000 }), false);
    assert.equal(await engineAlive(live.pid!, 1, dir, { startedAt: () => 1 }), true);
    assert.equal(await engineAlive(live.pid!, 1, dir, { startedAt: () => undefined, holders: async () => new Set([live.pid!]) }), true);
    assert.equal(await engineAlive(live.pid!, 1, dir, { startedAt: () => undefined, holders: async () => new Set() }), false);
    rmSync(dir, { recursive: true, force: true });
  } finally {
    await end(live);
  }
});

test("markers: a dead engine's folder whose markers couldn't be looked at stays for the next sweep; once answered, it goes", { skip }, async () => {
  const gone = sleeper();
  await end(gone);
  const dir = folder(gone.pid!, 1);
  assert.equal(await engineAlive(gone.pid!, 1, dir), false, "its pid is gone");
  assert.equal((await sweepMarks({ holders: async () => null })).folders, 0);
  assert.ok(existsSync(dir), "a look that failed isn't 'nothing holds it'");
  assert.equal((await sweepMarks({ holders: async () => new Set() })).folders, 1);
  assert.ok(!existsSync(dir), "nothing holds them: the folder goes");
});

test("marking: a marker whose folder was removed is made again with the folder, and a spawn never fails for a marker", { skip }, async () => {
  const dir = markDir();
  assert.ok(dir.startsWith(MARKS));
  const start = JSON.parse(readFileSync(join(dir, "engine"), "utf8")).start;
  const run = { value: "", file: markFile("run", "again") };
  // Removed under the running engine (a sweep that couldn't tell, a temp cleaner).
  rmSync(dir, { recursive: true, force: true });
  const { stdio, done } = marking(["ignore", "ignore", "ignore"], [run]);
  assert.equal(stdio.length, 4, "the marker is handed on");
  const child = spawn("/bin/sh", ["-c", "exit 0"], { stdio: stdio as ["ignore", "ignore", "ignore"] });
  done();
  await new Promise((r) => child.once("exit", r));
  assert.ok(existsSync(run.file), "the marker is there again");
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "engine"), "utf8")), { pid: process.pid, start }, "and the engine's own file, under the same name");
  // Gone again: markFile alone (as threadMark calls it) makes it again too.
  rmSync(dir, { recursive: true, force: true });
  assert.equal(markDir(), dir);
  assert.ok(existsSync(join(dir, "engine")));
  // One that can't be made at all (its folder is a file): the spawn goes on without it.
  const blocker = join(root, "a-file");
  writeFileSync(blocker, "");
  const errors: unknown[] = [];
  const error = console.error;
  console.error = (...a: unknown[]) => void errors.push(a);
  try {
    const m = marking(["ignore", "ignore", "ignore"], [{ value: "", file: join(blocker, "liner-run-y") }, run]);
    assert.equal(m.stdio.length, 4, "the one that could be made is still handed on");
    m.done();
  } finally {
    console.error = error;
  }
  assert.equal(errors.length, 1, "and the one that couldn't is said");
  rmSync(run.file, { force: true });
  assert.equal(dirname(run.file), dir);
});

test("startedAt: ps's start time is read in UTC, the same in every time zone, the repeated hour of a clock going back included", { skip }, () => {
  const tz = process.env.TZ;
  try {
    for (const zone of ["America/New_York", "Europe/London", "Australia/Sydney", "UTC"]) {
      process.env.TZ = zone;
      // 1 Nov 2026: New York's clocks go back at 06:00 UTC, so 01:30 local happens twice; printed in UTC there's no doubt.
      assert.equal(lstartUtc("Sun Nov  1 05:30:00 2026"), Date.UTC(2026, 10, 1, 5, 30), zone);
      assert.equal(lstartUtc("Sun Nov  1 06:30:00 2026")! - lstartUtc("Sun Nov  1 05:30:00 2026")!, 3600_000, zone);
      assert.equal(lstartUtc("Fri Nov 13 21:33:15 2026"), Date.UTC(2026, 10, 13, 21, 33, 15), zone);
      assert.equal(lstartUtc("not a date"), undefined);
      assert.equal(lstartUtc(""), undefined);
      // This process, as ps says it: the clock a folder is named by (or performance.timeOrigin, where ps can't) and read back by.
      const at = startedAt(process.pid);
      if (at !== undefined) assert.ok(Math.abs(at - performance.timeOrigin) < 3000, `${zone}: ${new Date(at).toISOString()} vs ${new Date(performance.timeOrigin).toISOString()}`);
    }
  } finally {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  }
});
