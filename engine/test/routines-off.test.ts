/*
  Routines switched off (contracts, ROUTINES_ON): Run now and Test start nothing and say why, and
  what's saved can still be read. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROUTINES_ON } from "../../contracts/src/index.ts";
import { Store } from "../src/store.ts";

test("switched off, a routine's Run now and Test start nothing and say routines are off", { skip: ROUTINES_ON && "routines are on" }, async () => {
  const { createApi } = await import("../src/api.ts");
  const { Runtime } = await import("../src/runtime.ts");
  const store = new Store(realpathSync(mkdtempSync(join(tmpdir(), "lc-routines-off-"))));
  const env = { PATH: "/usr/bin:/bin", HOME: store.home };
  const started: string[] = [];
  const routines = { routines: [{ id: "rt1" }], recent: [], fire: (id: string) => started.push(`run ${id}`), test: (id: string) => started.push(`test ${id}`) };
  const api = createApi(store, new Runtime(store, env), env, { routines, terms: {}, logs: {}, proxies: {} } as never);
  await assert.rejects(async () => api.call("routine.run", { id: "rt1" }), /Routines are switched off/);
  await assert.rejects(async () => api.call("routine.test", { id: "rt1", number: 1 }), /Routines are switched off/);
  assert.deepEqual(started, []);
  // What's saved is still there to read.
  const snap = (await api.call("state.get", {})) as { routines: { id: string }[] };
  assert.deepEqual(snap.routines.map((r) => r.id), ["rt1"]);
});
