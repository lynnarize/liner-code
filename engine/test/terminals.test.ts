/*
  A session's terminals outlive its Terminal surface: what they print is kept (the last lines, up
  to a size), a Terminal that comes back attaches and replays it, and a terminal ends only when
  it's closed, when its session goes, or when the engine quits. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EngineEvent } from "../../contracts/src/index.ts";
import { Store } from "../src/store.ts";
import { Backlog, Terminals } from "../src/surfaces.ts";

const until = async (ok: () => boolean, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
};

test("backlog: keeps the last lines, a line still being written counting as one", () => {
  const b = new Backlog(3, 1_000_000);
  b.push("a\nb\nc\nd\n");
  assert.equal(b.text(), "b\nc\nd\n");
  b.push("e");
  assert.equal(b.text(), "c\nd\ne");
  // `end` counts everything ever written, dropped or not, and Clear keeps it.
  assert.equal(b.end, 9);
  b.clear();
  b.push("f\n");
  assert.equal(b.text(), "f\n");
  assert.equal(b.end, 11);
});

test("backlog: over its size, the oldest whole lines go, multi-byte characters counted as bytes", () => {
  const b = new Backlog(1000, 10);
  b.push("12345\n");
  b.push("abcdef\n");
  assert.equal(b.text(), "abcdef\n");
  const u = new Backlog(1000, 8);
  u.push("é\né\né\n");
  assert.equal(u.text(), "é\né\n");
});

test("backlog: a long part with no line end goes whole when its line is the oldest", () => {
  const b = new Backlog(2, 1_000_000_000);
  b.push("x".repeat(16 * 1024));
  b.push("\na\nb\n");
  assert.equal(b.text(), "a\nb\n");
  assert.equal(b.end, 16 * 1024 + 5);
});

test("terminals: attach replays what it printed, and live output says where it starts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-term-"));
  const store = new Store(join(dir, "home"));
  const events: EngineEvent[] = [];
  store.on((e) => void events.push(e));
  const terms = new Terminals(store, { ...process.env, SHELL: "/bin/sh", PS1: "$ " });
  const { id } = terms.open(dir, 80, 24, undefined, "th1", "Shell");
  try {
    terms.write(id, "echo liner-$((40+2))\r");
    await until(() => terms.attach(id).text.includes("liner-42"));
    const a = terms.attach(id);
    assert.equal(a.end, a.text.length);
    // Every batch that went out starts where the one before it ended, and together they are the backlog.
    const out = events.flatMap((e) => (e.type === "term" && e.id === id ? [e] : []));
    let at = 0;
    for (const e of out) {
      assert.equal(e.at, at);
      at += e.data.length;
    }
    assert.equal(out.map((e) => e.data).join(""), a.text);
    assert.deepEqual(
      terms.list("th1").map((t) => [t.id, t.title]),
      [[id, "Shell"]],
    );
    assert.deepEqual(terms.list("th2"), []);

    // A shell that ends stays, with its code and what it printed, until its tab is closed.
    terms.write(id, "exit 3\r");
    await until(() => terms.list("th1")[0]?.exited !== undefined);
    assert.equal(terms.list("th1")[0].exited, 3);
    assert.equal(terms.attach(id).exited, 3);
    assert.ok(terms.attach(id).text.includes("liner-42"));
  } finally {
    terms.close(id);
  }
  assert.deepEqual(terms.list("th1"), []);
  assert.throws(() => terms.attach(id), /closed/);
});

test("terminals: a session going closes its terminals and no one else's", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-term-"));
  const terms = new Terminals(new Store(join(dir, "home")), { ...process.env, SHELL: "/bin/sh" });
  const a = terms.open(dir, 80, 24, undefined, "th1");
  const b = terms.open(dir, 80, 24, "echo hi", "th1", "dev");
  const c = terms.open(dir, 80, 24, undefined, "th2");
  try {
    assert.deepEqual(
      terms.list("th1").map((t) => [t.id, t.title, t.command]),
      [
        [a.id, "Shell", undefined],
        [b.id, "dev", "echo hi"],
      ],
    );
    terms.closeThread("th1");
    assert.deepEqual(terms.list("th1"), []);
    assert.deepEqual(
      terms.list("th2").map((t) => t.id),
      [c.id],
    );
  } finally {
    terms.closeAll();
  }
  assert.deepEqual(terms.list("th2"), []);
});
