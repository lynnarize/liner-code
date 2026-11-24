/*
  The shared kept-storage helper (ui/src/app/kept.ts, plan 019): a window where storage throws reads its defaults
  and writes quietly, and a corrupted or unknown value falls back instead of passing its cast into the code. Pure
  tests with fake stores; the bare sites' wiring is pinned by the source tests (shell-storage, press-guards).
  Run with `node --test engine/test/kept-storage.test.ts`.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import { draftsToDrop, keptRead, keptWrite, textRead, wordRead, wordWrite, type Store } from "../../ui/src/app/kept.ts";

/** A store that throws on every touch, as a blocked or full one does. */
const throwing = (): Store => ({
  getItem() {
    throw new Error("storage is blocked");
  },
  setItem() {
    throw new Error("storage is full");
  },
});
/** A working store in memory, so a round-trip can be read back. */
const fake = () => {
  const map = new Map<string, string>();
  const s: Store = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
  return { s, map };
};
const isString = (v: unknown): v is string => typeof v === "string";
const isPlace = (v: unknown): v is { kind: string } => typeof v === "object" && v !== null && typeof (v as { kind?: unknown }).kind === "string";

test("a store that throws reads the fallback and writes without throwing", () => {
  const s = throwing();
  assert.deepEqual(keptRead(s, "lc:view", { kind: "home" }, isPlace), { kind: "home" });
  assert.equal(wordRead(s, "lc:sidebar", ["0", "1"], "1"), "1");
  assert.equal(textRead(s, "lc:project", null), null);
  assert.doesNotThrow(() => keptWrite(s, "lc:view", { kind: "home" }));
  assert.doesNotThrow(() => wordWrite(s, "lc:sidebar", "0"));
});

test("a corrupted JSON value falls back instead of passing its cast", () => {
  const { s, map } = fake();
  map.set("lc:view", "{not json");
  assert.deepEqual(keptRead(s, "lc:view", { kind: "home" }, isPlace), { kind: "home" });
  // Parseable, but not the shape the cast claims: the predicate falls back too.
  map.set("lc:view", '"split"');
  assert.deepEqual(keptRead(s, "lc:view", { kind: "home" }, isPlace), { kind: "home" });
  map.set("lc:view", "null");
  assert.deepEqual(keptRead(s, "lc:view", { kind: "home" }, isPlace), { kind: "home" });
  // An empty string, as a cleared key reads, is not JSON either.
  map.set("lc:view", "");
  assert.deepEqual(keptRead(s, "lc:view", { kind: "home" }, isPlace), { kind: "home" });
});

test("a value outside the known words falls back", () => {
  const { s, map } = fake();
  map.set("lc:sidebar", "2");
  assert.equal(wordRead(s, "lc:sidebar", ["0", "1"], "1"), "1");
  map.set("lc:enter", "steer-now");
  assert.equal(wordRead(s, "lc:enter", ["queue", "steer"], "queue"), "queue");
  // A missing key reads the fallback as well.
  assert.equal(wordRead(s, "lc:device", ["a", "b"], "none"), "none");
});

test("a known value reads as itself", () => {
  const { s, map } = fake();
  map.set("lc:sidebar", "0");
  assert.equal(wordRead(s, "lc:sidebar", ["0", "1"], "1"), "0");
  map.set("lc:view", JSON.stringify({ kind: "session", id: "t_1" }));
  assert.deepEqual(keptRead(s, "lc:view", { kind: "home" }, isPlace), { kind: "session", id: "t_1" });
  // A raw keep that is not JSON (a project id, a simulator's udid) reads as itself, not as a parse failure.
  map.set("lc:project", "pr_m3x9k200ab1c");
  assert.equal(textRead(s, "lc:project", null), "pr_m3x9k200ab1c");
  assert.equal(keptRead(s, "lc:project", "fallback", isString), "fallback");
});

test("a write and read round-trip through a working store", () => {
  const { s } = fake();
  keptWrite(s, "lc:view", { kind: "usage" });
  assert.deepEqual(keptRead(s, "lc:view", { kind: "home" }, isPlace), { kind: "usage" });
  wordWrite(s, "lc:enter", "steer");
  assert.equal(wordRead(s, "lc:enter", ["queue", "steer"], "queue"), "steer");
  wordWrite(s, "lc:device", "A1B2C3D4-E5F6-7890");
  assert.equal(textRead(s, "lc:device", null), "A1B2C3D4-E5F6-7890");
});
test("draft attachments kept across a reload stay at the newest drafts', so files of drafts long left don't pile up in IndexedDB", () => {
  const entries = Array.from({ length: 53 }, (_, i) => ({ key: `d${i}`, at: 1000 + i }));
  // One kept before drafts had a time counts as the oldest.
  entries.push({ key: "untimed" } as { key: string; at: number });
  const drop = draftsToDrop(entries, 50);
  assert.deepEqual(drop.sort(), ["d0", "d1", "d2", "untimed"].sort());
  assert.deepEqual(draftsToDrop([{ key: "a", at: 1 }], 50), [], "under the limit nothing goes");
});
