/*
  Claude Code's process after an engine that died hard (a SIGKILL, a crash): pid 1's now, it goes on until the command it runs
  ends, which for a dev server is never (Claude Code 2.1.332 finishes its command after its stdin closes, then quits). Like every
  other agent's, it holds a marker file of this engine's (exec.ts Mark, marking), so the next engine's sweep finds it and ends it
  with what it runs, even a command that let the marker go. A session closed in order leaves no marker behind. A fake `claude`
  (a shell script) stands in for the real one: it starts a command, and on its stdin closing waits for it, as Claude Code does.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sweepMarks } from "../src/exec.ts";
import { noLeaks } from "./leaks.ts";

noLeaks();
const skip = process.platform === "win32";
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const until = async (ok: () => boolean, what: string, ms = 15_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if (ok()) return;
  assert.fail(what);
};
const pidIn = (file: string) => (existsSync(file) ? Number(readFileSync(file, "utf8").trim()) || 0 : 0);

/**
  A fake `claude` that says its pid, starts a long command which lets go of every descriptor past its stdio (as a command a
  program started without passing them on would), and then waits for its stdin to close: then it waits for its command, as
  Claude Code does (FAKE_END unset), or ends it and goes (FAKE_END=1), as Claude Code does on a close.
*/
function fakeClaude() {
  const dir = mkdtempSync(join(tmpdir(), "lc-claude-marks-"));
  writeFileSync(
    join(dir, "claude"),
    `#!/bin/sh
echo $$ > "${dir}/claude.pid"
/bin/sh -c 'echo $$ > "${dir}/cmd.pid"; exec /bin/sleep 60' 3<&- 4<&- 5<&- &
cmd=$!
/bin/cat > /dev/null
[ -n "$FAKE_END" ] && kill $cmd
wait
`,
  );
  chmodSync(join(dir, "claude"), 0o755);
  return { dir, claude: join(dir, "claude.pid"), cmd: join(dir, "cmd.pid") };
}

test("Claude Code left running by an engine killed hard is ended by the next engine's sweep, with the command it runs", { skip }, async () => {
  const f = fakeClaude();
  // A fake engine: it opens a Claude Code session on the fake, starts its process (warm), and waits to be killed.
  const engine = join(f.dir, "engine.mts");
  writeFileSync(
    engine,
    `import { claude } from ${JSON.stringify(new URL("../src/providers/claude.ts", import.meta.url).pathname)};
const s = claude.open({ cwd: ${JSON.stringify(f.dir)}, model: "claude-opus-5-5", effort: "medium", access: "edits", soul: "", guard: true, env: { PATH: ${JSON.stringify(f.dir)} } });
await s.warm();
setInterval(() => {}, 1000);
`,
  );
  const child = spawn(process.execPath, [engine], { stdio: ["ignore", "ignore", "inherit"] });
  let claudePid = 0;
  let cmdPid = 0;
  try {
    await until(() => Boolean((claudePid = pidIn(f.claude)) && (cmdPid = pidIn(f.cmd))), "the fake claude started its command");
    child.kill("SIGKILL");
    await new Promise((r) => child.once("exit", r));
    assert.ok(alive(claudePid) && alive(cmdPid), "both outlive the engine, as with the real Claude Code");
    const r = await sweepMarks();
    assert.deepEqual(r.left, []);
    await until(() => !alive(claudePid), "the sweep ended Claude Code's process", 5000);
    await until(() => !alive(cmdPid), "and the command it ran, which held no marker of its own", 5000);
  } finally {
    for (const pid of [claudePid, cmdPid]) {
      try {
        if (pid) process.kill(pid, "SIGKILL");
      } catch {
        // ended
      }
    }
  }
});

test("A Claude Code session closed in order leaves no marker of its process behind", { skip }, async () => {
  const f = fakeClaude();
  const { claude } = await import("../src/providers/claude.ts");
  const { markDir } = await import("../src/exec.ts");
  const runs = () => readdirSync(markDir()).filter((n) => n.startsWith("liner-run-"));
  const before = new Set(runs());
  const s = claude.open({ cwd: f.dir, model: "claude-opus-5-5", effort: "medium", access: "edits", soul: "", guard: true, env: { PATH: f.dir, FAKE_END: "1" } });
  await s.warm?.();
  await until(() => Boolean(pidIn(f.claude) && pidIn(f.cmd)), "the fake claude started its command");
  assert.ok(runs().some((n) => !before.has(n)), "its process holds a marker of its own while it runs");
  await s.close();
  await until(() => !alive(pidIn(f.claude)) && !alive(pidIn(f.cmd)), "closed, it and its command are gone", 10_000);
  await until(() => !runs().some((n) => !before.has(n)), "and so is its marker", 10_000);
});
