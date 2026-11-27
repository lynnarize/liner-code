/*
  Carry on is on unless the person turns it off in Settings ("Show Carry on on Home"): the engine keeps the switch,
  and refuses anything that is not a yes or a no. Run with `node --test engine/test/carry-on-switch.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Settings } from "../../contracts/src/index.ts";
import { carryOnOn } from "../../contracts/src/index.ts";
import { createApi } from "../src/api.ts";
import { Runtime } from "../src/runtime.ts";
import { Store } from "../src/store.ts";

test("Carry on reads as on when the setting was never saved, and as off only when it is false", () => {
  assert.equal(carryOnOn({}), true);
  assert.equal(carryOnOn({ carryOn: true }), true);
  assert.equal(carryOnOn({ carryOn: false }), false);
});

test("settings.save keeps Carry on turned off and on again, across a restart, and refuses anything but a yes or a no", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-carry-on-"));
  const env = { PATH: "/usr/bin:/bin", HOME: dir } as NodeJS.ProcessEnv;
  const home = join(dir, "home");
  const store = new Store(home);
  const runtime = new Runtime(store, env);
  const api = createApi(store, runtime, env, { routines: { routines: [], recent: [], put: () => undefined, remove: () => undefined }, terms: {}, logs: {}, proxies: {} } as never);
  try {
    assert.equal(carryOnOn(store.settings), true, "a new install shows Carry on");
    const save = (carryOn: unknown) => api.call("settings.save", { carryOn } as never) as Promise<Settings>;
    assert.equal((await save(false)).carryOn, false);
    for (const bad of ["no", 0, null, {}]) await assert.rejects(save(bad), /Carry on is on or off/, JSON.stringify(bad));
    assert.equal(store.settings.carryOn, false, "a refused value leaves the one before");
    store.flush();
    assert.equal(new Store(home).settings.carryOn, false, "the switch is kept on disk");
    assert.equal((await save(true)).carryOn, true);
  } finally {
    api.updates.stop();
    runtime.shutdown();
  }
});
