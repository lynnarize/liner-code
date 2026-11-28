/*
  Compact under a session's message box, beside "N% of context", and the box's "Compact now" once the cache has run out:
  on every tool that compacts (all of them now, the Demo apart), pressed through the details card's one guarded press.
  The deciding part runs as pure functions (composer-rules.ts); the wiring is read from the source as written (precedent:
  stale-ui-state.test.ts). Run with `node --test engine/test/compact-button.test.ts`.
*/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { coldCompact, COLD_TOKENS, compactButton, compactsOn } from "../../ui/src/app/composer-rules.ts";

const source = (name: string) => readFileSync(new URL(`../../ui/src/app/${name}`, import.meta.url), "utf8");

test("Every tool compacts, a second account and an ACP agent as much as Claude Code, but the Demo does not", () => {
  for (const p of ["claude", "claude.work", "codex", "opencode", "hermes", "cursor", "grok", "antigravity", "acp.kimi"]) assert.equal(compactsOn(p), true, `${p} isn't offered Compact`);
  assert.equal(compactsOn("demo"), false);
});

test("The Compact button shows once the context holds something on a tool that compacts, and not on an empty one or the Demo", () => {
  const at = { running: false, compacting: false };
  assert.equal(compactButton({ provider: "opencode", contextTokens: 12_000, ...at }).shown, true);
  assert.equal(compactButton({ provider: "opencode", contextTokens: 0, ...at }).shown, false);
  assert.equal(compactButton({ provider: "opencode", ...at }).shown, false);
  assert.equal(compactButton({ provider: "demo", contextTokens: 12_000, ...at }).shown, false);
});

test("The Compact button can't be pressed while a turn runs or while a compact is on its way, and can otherwise", () => {
  const ctx = { provider: "codex", contextTokens: 50_000 };
  assert.equal(compactButton({ ...ctx, running: false, compacting: false }).disabled, false);
  assert.equal(compactButton({ ...ctx, running: true, compacting: false }).disabled, true);
  assert.equal(compactButton({ ...ctx, running: false, compacting: true }).disabled, true);
});

test("Compact now after the cache runs out is offered on any tool that compacts, not only on Claude Code and Codex", () => {
  const cold = { cacheUntil: 1_000, now: 2_000, contextTokens: COLD_TOKENS + 1 };
  for (const p of ["claude", "codex", "opencode", "hermes", "acp.kimi"]) assert.equal(coldCompact({ provider: p, ...cold }), true, `${p} isn't offered Compact now`);
  assert.equal(coldCompact({ provider: "demo", ...cold }), false);
  // Still only past the cache's end, on a long thread, and not once dismissed for this cache.
  assert.equal(coldCompact({ provider: "opencode", ...cold, now: 500 }), false);
  assert.equal(coldCompact({ provider: "opencode", ...cold, contextTokens: COLD_TOKENS }), false);
  assert.equal(coldCompact({ provider: "opencode", ...cold, seen: 1_000 }), false);
  assert.equal(coldCompact({ provider: "opencode", ...cold, cacheUntil: undefined }), false);
});

test("The message box presses Compact through the details card's guarded press, and no longer limits it to two tools", () => {
  const box = source("Composer.tsx");
  assert.match(box, /useCompact\(thread\)/, "the box sends /compact on its own instead of through useCompact");
  assert.doesNotMatch(box, /\["claude", "codex"\]\.includes/, "the box still limits Compact to Claude Code and Codex");
  assert.doesNotMatch(box, /text: "\/compact"/, "the box has a send of /compact of its own");
  // The button sits in the line under the box, right after the context's share.
  const under = box.slice(box.indexOf('className="lc-under"'));
  assert.ok(under.indexOf("% of context") > 0 && under.indexOf("compactBtn.shown") > under.indexOf("% of context"), "Compact isn't beside the context's share");
  assert.match(source("DetailsParts.tsx"), /export function useCompact\(thread: Thread \| undefined\)/);
});
