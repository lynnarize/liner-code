/*
  After each test of a file that starts agents: no process that test started is still alive. A session closed with its agent
  still running is a leak in the app (an agent nobody owns, which on a real account may go on calling the model), and in a
  test it would only show as a file that never exits. So it fails the test by name, and ends what it found, so the rest run.
*/
import { after, afterEach } from "node:test";
import { execFileSync } from "node:child_process";

/** This process's descendants, as ps lists them now, with their commands. */
export function descendants(root = process.pid) {
  let rows: { pid: number; ppid: number; command: string }[] = [];
  try {
    rows = execFileSync("ps", ["-A", "-o", "pid=", "-o", "ppid=", "-o", "stat=", "-o", "command="], { encoding: "utf8" })
      .split("\n")
      .flatMap((l) => {
        const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s(.*)$/.exec(l);
        return m && !m[3].startsWith("Z") ? [{ pid: Number(m[1]), ppid: Number(m[2]), command: m[4].trim() }] : [];
      });
  } catch {
    return [];
  }
  const out: typeof rows = [];
  const walk = (p: number) => {
    for (const r of rows) if (r.ppid === p && !out.some((o) => o.pid === r.pid)) (out.push(r), walk(r.pid));
  };
  walk(root);
  // ps itself, listing.
  return out.filter((r) => !/(?:^|\/)ps -A -o pid=/.test(r.command));
}

/** Registers the check for every test in the file. `grace`: how long a process ending as asked may take to go. */
export function noLeaks(grace = 3000) {
  afterEach((t) => check(`“${t.name}”`, grace));
  // And once the file is done: something a test set off that only starts later (a job that outlives its test) is caught too.
  after(() => check("the file, after its last test", grace));
}

async function check(who: string, grace: number) {
  let left = descendants();
  for (const end = Date.now() + grace; left.length && Date.now() < end; left = descendants()) await new Promise((r) => setTimeout(r, 50));
  if (!left.length) return;
  for (const p of left) {
    try {
      process.kill(p.pid, "SIGKILL");
    } catch {
      // gone
    }
  }
  throw new Error(`${who} left ${left.length} process${left.length === 1 ? "" : "es"} running: ${left.map((p) => `${p.pid} ${p.command.slice(0, 120)}`).join("; ")}`);
}
