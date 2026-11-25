/*
  A repository's `.liner/patch.json` comes with the clone, so it may only tighten what agents may do (patches.ts). Its rules
  were read after the person's, last match winning: a project `ask` for a command the person set to `deny` won, and the
  command the person had refused outright came to a card instead, where one click runs it. The stricter of the two holds.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Item, ProviderId, ProviderInfo, Thread } from "../../contracts/src/index.ts";
import { emptyUsage } from "../../contracts/src/index.ts";
import { permissionFor } from "../src/patches.ts";
import { providers, Runtime } from "../src/runtime.ts";
import type { OpenOptions, Provider } from "../src/providers/types.ts";
import { Store } from "../src/store.ts";

const info = (id: ProviderInfo["id"], models: string[]): ProviderInfo => ({ id, label: id, available: true, adapter: true, login: "", models: models.map((m) => ({ id: m, label: m, description: "" })), supports: { approvals: true, resume: true, effort: true, plan: true } });

test("A repository's patch.json that says ask can't turn a command the person denied into a card", async () => {
  const home = mkdtempSync(join(tmpdir(), "lc-patch-deny-"));
  const dir = mkdtempSync(join(tmpdir(), "lc-patch-deny-dir-"));
  mkdirSync(join(dir, ".liner"));
  writeFileSync(join(dir, ".liner", "patch.json"), JSON.stringify({ permissionRules: [{ kind: "command", pattern: "git push*", action: "ask" }] }));
  const store = new Store(home);
  store.settings.permissionRules = [{ kind: "command", pattern: "git push*", action: "deny" }];
  store.putProject({ id: "p", name: "p", path: dir, git: false, createdAt: Date.now() });
  const t: Thread = { id: "t", projectId: "p", title: "New session", agent: "forge", status: "idle", access: "auto", turns: 0, usage: emptyUsage(), createdAt: Date.now(), updatedAt: Date.now() };
  store.putThread(t);
  const answered: boolean[] = [];
  const make = (id: ProviderId): Provider => ({
    id,
    detect: async () => info(id, []),
    open: (_o: OpenOptions) => ({
      turn: async (_text, sink, signal) => {
        const a = await sink.approve({ key: "c1", tool: "Bash", title: "Run git push", risk: "low", fields: [{ label: "Command", value: "git push origin main" }], rule: "git push" }, signal);
        answered.push(a.allow);
        sink.text("ok");
      },
      close() {},
    }),
  });
  const saved = { claude: providers.claude, codex: providers.codex };
  providers.claude = make("claude");
  providers.codex = make("codex");
  const runtime = new Runtime(store, process.env);
  runtime.providerInfo = [info("claude", ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]), info("codex", ["gpt-6-sol", "gpt-6-luna-mini"])];
  try {
    const sent = runtime.send("t", "ship it");
    for (let i = 0; i < 100 && !answered.length && !store.timeline("t").some((x) => x.kind === "approval" && x.state === "asking"); i++) await new Promise((r) => setTimeout(r, 20));
    const card = store.timeline("t").find((x): x is Extract<Item, { kind: "approval" }> => x.kind === "approval" && x.state === "asking");
    if (card) runtime.answer("t", card.id, false);
    await sent;
    assert.equal(card, undefined, "no card was put up for a command the person denied");
    assert.deepEqual(answered, [false]);
    assert.ok(store.timeline("t").some((x) => x.kind === "notice" && /Denied .* by permission rule \(command: git push\*\)/.test(x.text)), "it was refused by the person's rule");
  } finally {
    Object.assign(providers, saved);
    runtime.shutdown();
  }
});

test("The stricter of the person's rules and a repository's holds, whichever comes last", () => {
  const home = mkdtempSync(join(tmpdir(), "lc-patch-strict-"));
  const dir = mkdtempSync(join(tmpdir(), "lc-patch-strict-dir-"));
  mkdirSync(join(dir, ".liner"));
  writeFileSync(join(dir, ".liner", "patch.json"), JSON.stringify({ permissionRules: [{ kind: "command", pattern: "npm *", action: "ask" }, { kind: "command", pattern: "npm publish*", action: "deny" }] }));
  const person = [{ kind: "command" as const, pattern: "npm *", action: "allow" as const }, { kind: "command" as const, pattern: "rm *", action: "deny" as const }];
  assert.equal(permissionFor(person, home, dir, { command: "npm test" })?.action, "ask", "the repository may ask where the person allowed");
  assert.equal(permissionFor(person, home, dir, { command: "npm publish" })?.action, "deny");
  assert.equal(permissionFor(person, home, dir, { command: "rm -rf build" })?.action, "deny");
  assert.equal(permissionFor(person, home, dir, { command: "ls" }), null);
  assert.equal(permissionFor(person, home, undefined, { command: "npm test" })?.action, "allow", "no project: the person's own");
});
