/*
  Whose a dev server is, where a process's environment can't be read: macOS 27 prints none for Apple's own programs (/bin/sh,
  /usr/bin/nc), so a server like that is the session's only by the marker file it inherited (exec.ts Mark, marking), or by
  a parent that holds it. Each server here is started the way Liner Code starts one: a Terminal's shell, a launch.json entry
  (what server_start runs), a Node launcher that drops the descriptor for its child (as `npm run dev` does for vite). Two
  sessions aren't mixed up, a server started outside Liner Code is nobody's, and one session can't stop another's.
  Run with `npm test -w engine`.
*/
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { endAll, markDir, markedPids, markFile, marking, sweepMarks, threadMark, type Mark } from "../src/exec.ts";
import { Launcher } from "../src/launch.ts";
import { listeningPorts, stopServers, Terminals } from "../src/surfaces.ts";
import { Store } from "../src/store.ts";
import { noLeaks } from "./leaks.ts";

noLeaks();
// The sessions' marker files these tests made (they outlive a session by design: the next one of its processes uses the same).
after(() => { for (const id of ["th_term_a", "th_term_b", "th_launch", "th_other", "th_one", "th_two"]) rmSync(threadMark(id).file!, { force: true }); });

const freePort = () =>
  new Promise<number>((done) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const a = s.address();
      s.close(() => done(typeof a === "object" && a ? a.port : 0));
    });
  });
const until = async (ok: () => boolean | Promise<boolean>, what: string, ms = 10_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await ok()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail(what);
};
const owner = async (threadId: string, port: number, folders: string[] = []) => (await listeningPorts(process.env, { threadId, folders })).find((s) => s.port === port)?.owner ?? null;
const listening = async (port: number) => (await listeningPorts(process.env)).some((s) => s.port === port);
/** Apple's own nc, whose environment macOS 27 won't print: a "server" that is nobody's by its environment alone. */
const NC = (port: number) => `exec /usr/bin/nc -kl 127.0.0.1 ${port}`;

test("owners: a server from a session's Terminal is that session's, by the marker its shell holds; not another session's", async () => {
  const away = realpathSync(mkdtempSync(join(tmpdir(), "lc-own-term-")));
  const terms = new Terminals(new Store(join(away, "home")), { ...process.env, SHELL: "/bin/sh", PS1: "$ " });
  const port = await freePort();
  terms.open(away, 80, 24, NC(port), "th_term_a", "Shell");
  try {
    await until(() => listening(port), "nc listens");
    assert.equal(await owner("th_term_a", port), "session");
    assert.equal(await owner("th_term_b", port), null, "another session's");
    await assert.rejects(stopServers(process.env, { threadId: "th_term_b", folders: [] }, { port }), /isn't this session's/);
    assert.equal(await listening(port), true, "still up");
  } finally {
    terms.closeAll();
  }
});

test("owners: a launch.json server (server_start) is its session's, and one a Node launcher starts under it too", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lc-own-launch-")));
  mkdirSync(join(root, ".claude"));
  const [a, b] = [await freePort(), await freePort()];
  // b: Node starts nc, and Node's spawn hands its child no inherited descriptor: the parent says whose it is.
  writeFileSync(join(root, "launcher.js"), `require("child_process").spawn("/usr/bin/nc", ["-kl", "127.0.0.1", process.env.PORT], { stdio: "ignore" }); setInterval(() => {}, 1000);`);
  writeFileSync(join(root, ".claude", "launch.json"), JSON.stringify({ version: "0.0.1", configurations: [{ name: "nc", runtimeExecutable: "/bin/sh", runtimeArgs: ["-c", "exec /usr/bin/nc -kl 127.0.0.1 $PORT"], port: a }, { name: "node", runtimeExecutable: process.execPath, runtimeArgs: ["launcher.js"], port: b }] }));
  const l = new Launcher({ env: process.env, emit: () => {}, cwdOf: () => root, sessionsIn: () => [{ id: "th_launch", busy: false }], now: () => Date.now(), idleMs: 600_000 });
  try {
    await l.start("th_launch", "nc");
    await l.start("th_launch", "node");
    await until(async () => (await listening(a)) && (await listening(b)), "both listen");
    assert.equal(await owner("th_launch", a), "session");
    assert.equal(await owner("th_launch", b), "session", "by its parent's marker");
    assert.equal(await owner("th_other", a), null);
    assert.equal(await owner("th_other", b), null);
  } finally {
    await l.stop("th_launch", "nc");
    await l.stop("th_launch", "node");
  }
});

test("owners: a server started outside Liner Code is nobody's; two sessions' servers aren't mixed up", async () => {
  const away = realpathSync(mkdtempSync(join(tmpdir(), "lc-own-out-")));
  const port = await freePort();
  const outside = spawn("/bin/sh", ["-c", NC(port)], { cwd: away, stdio: "ignore", detached: true });
  const terms = new Terminals(new Store(join(away, "home")), { ...process.env, SHELL: "/bin/sh", PS1: "$ " });
  const [p1, p2] = [await freePort(), await freePort()];
  terms.open(away, 80, 24, NC(p1), "th_one", "Shell");
  terms.open(away, 80, 24, NC(p2), "th_two", "Shell");
  try {
    await until(async () => (await listening(port)) && (await listening(p1)) && (await listening(p2)), "all listen");
    assert.equal(await owner("th_one", port), null, "started outside: nobody's");
    assert.deepEqual([await owner("th_one", p1), await owner("th_one", p2)], ["session", null]);
    assert.deepEqual([await owner("th_two", p1), await owner("th_two", p2)], [null, "session"]);
    // In the session's own folder it's the project's, as before: a server there may be stopped from it, as it could.
    assert.equal(await owner("th_one", port, [away]), "project");
  } finally {
    terms.closeAll();
    try {
      process.kill(-outside.pid!, "SIGKILL");
    } catch {
      // gone
    }
  }
});

test("marking: sixty sessions' marked children in one process with many descriptors open all start, are found by their markers, and end", { skip: process.platform === "win32" }, async () => {
  // A long-running engine's descriptors: past the forties, with holes where its pipes for a child would land (V3's clash came
  // from markers handed at 42 and 43 once Node's own pipes for the child landed there too).
  const held: number[] = [];
  for (let fd = openSync("/dev/null", "r"); ; fd = openSync("/dev/null", "r")) {
    held.push(fd);
    if (fd >= 96) break;
  }
  for (const hole of [16, 40, 42, 43, 44, 47, 52, 61]) if (held.includes(hole)) (closeSync(hole), held.splice(held.indexOf(hole), 1));
  const kids: { child: ChildProcess; run: Mark; thread: Mark }[] = [];
  try {
    for (let i = 0; i < 60; i++) {
      const run: Mark = { value: randomBytes(6).toString("hex"), file: markFile("run", randomBytes(6).toString("hex")) };
      const thread = threadMark(`th_sixty_${i}`);
      const { stdio, done } = marking(["pipe", "pipe", "pipe"], [run, thread]);
      try {
        // The shell answers on its own pipes, then becomes a sleep that holds both markers at the numbers after them (3 and 4).
        kids.push({ child: spawn("/bin/sh", ["-c", 'read x; echo "$x $(ls /dev/fd | tr "\\n" " ")"; exec sleep 30'], { stdio: stdio as ["pipe", "pipe", "pipe"], detached: true }), run, thread });
      } finally {
        done();
      }
    }
    // All start, each wired to its own pipes.
    const said = await Promise.all(
      kids.map((k, i) => new Promise<string>((ok, no) => {
        let out = "";
        k.child.stdout!.on("data", (d) => ((out += d), out.includes("\n") && ok(out)));
        k.child.once("error", no);
        setTimeout(() => no(new Error(`child ${i} never answered: ${out}`)), 15_000).unref();
        k.child.stdin!.write(`ping-${i}\n`);
      })),
    );
    said.forEach((s, i) => {
      assert.match(s, new RegExp(`^ping-${i} `), `child ${i} heard on its own stdin`);
      // Its descriptors: its three pipes and the two markers, nothing at 42 or 43.
      assert.match(s, / 3 4 /, `child ${i}: ${s}`);
    });
    // All found by their marker files, by path, never by number.
    for (const k of kids) {
      assert.ok((await markedPids({ value: "", file: k.run.file })).has(k.child.pid!), "by its run marker");
      assert.ok((await markedPids({ value: "", file: k.thread.file })).has(k.child.pid!), "by its session's marker");
    }
    // All end.
    const left = await endAll(kids.map((k) => ({ pid: k.child.pid!, ppid: process.pid, command: "sleep 30" })), undefined, 300);
    assert.deepEqual(left, []);
  } finally {
    for (const k of kids) {
      try {
        process.kill(k.child.pid!, "SIGKILL");
      } catch {
        // ended
      }
      rmSync(k.run.file!, { force: true });
      rmSync(k.thread.file!, { force: true });
    }
    for (const fd of held) closeSync(fd);
  }
});

test("markers: an engine killed hard leaves its folder; the next engine ends what still holds its markers and removes it, and leaves a running engine's alone", { skip: process.platform === "win32" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-sweep-"));
  // A fake engine: it makes its marker folder, starts a command that goes to the background holding a run's marker (as one agy
  // sent off would), says where things are, and waits to be killed.
  const engine = join(dir, "engine.mts");
  writeFileSync(
    engine,
    `import { markDir, markFile, marking } from ${JSON.stringify(new URL("../src/exec.ts", import.meta.url).pathname)};
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const run = { value: "x", file: markFile("run", process.argv[2]) };
const { stdio, done } = marking(["ignore", "ignore", "ignore"], [run]);
spawn("/bin/sh", ["-c", process.argv[3]], { stdio, detached: true }).unref();
done();
process.stdout.write(JSON.stringify({ dir: markDir(), file: run.file }) + "\\n");
// Asked to quit: its session's close removes the run's marker (acp.ts close), then out, in order.
process.on("SIGTERM", () => (require("node:fs").rmSync(run.file, { force: true }), process.exit(0)));
setInterval(() => {}, 1000);
`,
  );
  const start = (id: string, line: string) =>
    new Promise<{ child: ChildProcess; dir: string; file: string }>((ok, no) => {
      const child = spawn(process.execPath, [engine, id, line], { stdio: ["ignore", "pipe", "inherit"] });
      let out = "";
      child.stdout!.on("data", (d) => {
        out += d;
        if (out.includes("\n")) ok({ child, ...JSON.parse(out) });
      });
      child.once("error", no);
    });
  const late = join(dir, "late.txt");
  const kept = join(dir, "kept.txt");
  const dead = await start("dead", `sleep 2; touch ${late}`);
  const alive = await start("alive", `sleep 2.5; touch ${kept}`);
  // A folder named for a pid that runs (this one) but with another start: not that engine, whatever its pid says.
  const reused = join(dirname(dead.dir), `${process.pid}-1`);
  mkdirSync(reused, { recursive: true });
  const reusedFile = join(reused, "liner-run-reused");
  writeFileSync(reusedFile, "");
  const { stdio, done } = marking(["ignore", "ignore", "ignore"], [{ value: "", file: reusedFile }]);
  const holder = spawn("/bin/sh", ["-c", `sleep 2; touch ${late}.reused`], { stdio: stdio as ["ignore", "ignore", "ignore"], detached: true });
  done();
  try {
    dead.child.kill("SIGKILL");
    await new Promise((r) => dead.child.once("exit", r));
    assert.ok(existsSync(dead.dir), "a hard kill leaves its folder");
    const r = await sweepMarks();
    assert.ok(r.ended >= 2, `ended ${r.ended}`);
    assert.deepEqual(r.left, []);
    assert.ok(!existsSync(dead.dir), "its folder goes");
    assert.ok(!existsSync(reused), "a pid that runs, with another start, isn't that engine");
    assert.ok(existsSync(alive.dir) && existsSync(alive.file), "a running engine's markers are left alone");
    assert.ok((await markedPids({ value: "", file: alive.file })).size > 0, "and what holds them runs on");
    await new Promise((r) => setTimeout(r, 2800));
    assert.ok(!existsSync(late), "what the dead engine's agent left never wrote its file");
    assert.ok(!existsSync(`${late}.reused`));
    assert.ok(existsSync(kept), "the running engine's command did");
  } finally {
    alive.child.kill("SIGTERM");
    await new Promise((r) => alive.child.once("exit", r));
    try {
      process.kill(holder.pid!, "SIGKILL");
    } catch {
      // ended
    }
  }
  // An engine that quits in order takes its folder with it (exec.ts markDir's exit hook): nothing of the live one is left.
  assert.ok(!existsSync(alive.dir), "gone with its engine");
  assert.ok(markDir().startsWith(dirname(dead.dir)), "this engine's own folder sits beside them");
  assert.ok(!readdirSync(dirname(dead.dir)).includes(`${process.pid}-1`));
});
