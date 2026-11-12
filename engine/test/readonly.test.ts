/*
  Read only means one thing on every tool: what it forbids (a tool's own edit, a command that changes things, more access) is
  refused by Liner Code itself, with no card, in a sentence the model can act on, and the timeline says so quietly. The same
  asks at Ask still come as cards. An answer to a card is judged by the level when it's given: one allowed after the session
  went to Read only is refused. And a call still running when you press Stop reads stopped, however its tool ends it.
  Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Access, Item } from "../../contracts/src/index.ts";
import { emptyUsage } from "../../contracts/src/index.ts";
import { claude, sdk } from "../src/providers/claude.ts";
import type { ApprovalRequest, OpenOptions, TurnSink } from "../src/providers/types.ts";
import { providers, readForbids, Runtime } from "../src/runtime.ts";
import { Store } from "../src/store.ts";
import { noLeaks } from "./leaks.ts";

// Every test ends with no process of its own still running (leaks.ts).
noLeaks();

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

/** What each tool asks Liner Code, in its own words (claude.ts, codex-server.ts, acp.ts build these). */
const ASKS: Record<string, ApprovalRequest> = {
  "Claude Code's Write": { key: "w", tool: "Write", title: "Write src/a.ts", risk: "low", fields: [{ label: "File", value: "src/a.ts" }], rule: "Edit" },
  "Claude Code's Bash": { key: "b", tool: "Bash", title: "Run touch x", risk: "low", fields: [{ label: "Command", value: "touch x" }], rule: "touch" },
  "Codex's apply_patch": { key: "p", tool: "apply_patch", title: "Edit a.ts", risk: "medium", fields: [{ label: "File", value: "a.ts" }], rule: "Edit" },
  "Codex's command": { key: "c", tool: "shell", title: "Run rm a.ts", risk: "medium", fields: [{ label: "Command", value: "rm a.ts" }], rule: "rm" },
  "Codex's more access": { key: "g", tool: "permissions", title: "Grant Codex more access", risk: "medium", fields: [{ label: "Write access to", value: "/tmp/x" }] },
  "an ACP agent's edit": { key: "e", tool: "edit", title: "Edit src/a.ts", risk: "low", fields: [{ label: "File", value: "src/a.ts" }], rule: "Edit" },
  "an ACP agent's delete": { key: "d", tool: "delete", title: "Delete src/a.ts", risk: "low", fields: [{ label: "File", value: "src/a.ts" }] },
  "an ACP agent's command": { key: "x", tool: "execute", title: "touch x", risk: "low", fields: [{ label: "Command", value: "touch x" }], rule: "touch" },
};

function rig(access: Access) {
  const cwd = mkdtempSync(join(tmpdir(), "lc-ro-"));
  const store = new Store(mkdtempSync(join(tmpdir(), "lc-ro-home-")));
  store.putProject({ id: "p", name: "p", path: cwd, git: false, createdAt: 1 });
  store.putThread({ id: "t", access, projectId: "p", title: "T", agent: "@claude:claude-opus-5-5", status: "idle", turns: 0, usage: emptyUsage(), createdAt: 1, updatedAt: 1 });
  const runtime = new Runtime(store, { PATH: "/usr/bin:/bin" });
  runtime.providerInfo = [{ id: "claude", label: "Fake tool", available: true, adapter: true, login: "", models: [{ id: "claude-opus-5-5", label: "Opus", description: "" }], supports: { approvals: true, resume: true, effort: false, plan: true } }];
  return { store, runtime };
}

/** A fake tool whose turn runs `work` with the turn's sink. */
async function withTool<T>(work: (sink: TurnSink, signal: AbortSignal) => Promise<T>, run: (out: { got: T[] }) => Promise<void>) {
  const saved = providers.claude;
  const out = { got: [] as T[] };
  providers.claude = { id: "claude", detect: async () => ({}) as never, open: () => ({ close() {}, turn: async (_t, sink, signal) => void out.got.push(await work(sink, signal)) }) };
  try {
    await run(out);
  } finally {
    providers.claude = saved;
  }
}

const approvals = (store: Store) => store.timeline("t").filter((x): x is Extract<Item, { kind: "approval" }> => x.kind === "approval");

test("read only: every tool's edit, changing command and request for more access is refused with no card, in one sentence for the model, and said once on the timeline", async () => {
  for (const [what, req] of Object.entries(ASKS)) assert.equal(readForbids(req), true, what);
  assert.equal(readForbids({ tool: "Bash", fields: [{ label: "Command", value: "ls src" }] }), false, "a command that only reads");
  assert.equal(readForbids({ tool: "mcp__github", fields: [{ label: "Asked by", value: "github" }] }), false, "a connection's tool is the card's, as before");
  const { store, runtime } = rig("read");
  await withTool(
    async (sink, signal) => Promise.all(Object.values(ASKS).map((req) => sink.approve(req, signal))),
    async (out) => {
      await runtime.send("t", "go");
      const answers = out.got[0];
      assert.equal(answers.length, Object.keys(ASKS).length);
      for (const a of answers) {
        assert.equal(a.allow, false);
        assert.equal(a.level, true);
        assert.match(String(a.reason), /^This session is Read only, so Liner Code refused this (command|change) without asking anyone\. Don't try/);
      }
      assert.equal(approvals(store).length, 0, "no card");
      const said = store.timeline("t").filter((x) => x.kind === "notice" && /This session is Read only, so Liner Code refused/.test(x.text));
      assert.equal(said.length, 1, "once a turn");
    },
  );
});

test("read only: the same asks at Ask still come as cards; a side chat isn't changed", async () => {
  const { store, runtime } = rig("ask");
  await withTool(
    async (sink, signal) => {
      const going = Promise.all(Object.values(ASKS).map((req) => sink.approve(req, signal)));
      return going;
    },
    async () => {
      const sent = runtime.send("t", "go");
      for (let i = 0; i < 200 && approvals(store).filter((a) => a.state === "asking").length < Object.keys(ASKS).length; i++) await tick();
      assert.equal(approvals(store).filter((a) => a.state === "asking").length, Object.keys(ASKS).length, "a card each");
      for (const a of approvals(store)) runtime.answer("t", a.id, false);
      await sent;
    },
  );
  // A side chat at Read only: its asks still come to you, as they did.
  const side = rig("read");
  side.store.patchThread("t", { sideOf: "x" });
  await withTool(
    async (sink, signal) => sink.approve(ASKS["Claude Code's Write"], signal),
    async () => {
      const sent = side.runtime.send("t", "go");
      for (let i = 0; i < 200 && !approvals(side.store).length; i++) await tick();
      assert.equal(approvals(side.store).length, 1);
      side.runtime.answer("t", approvals(side.store)[0].id, false);
      await sent;
    },
  );
});

test("read only: a card asked at Ask and allowed after the session went to Read only is refused, with one line", async () => {
  const { store, runtime } = rig("ask");
  await withTool(
    async (sink, signal) => [await sink.approve(ASKS["an ACP agent's edit"], signal), await sink.approve(ASKS["Claude Code's Bash"], signal)],
    async (out) => {
      const sent = runtime.send("t", "go");
      for (let i = 0; i < 200 && !approvals(store).length; i++) await tick();
      store.patchThread("t", { access: "read" });
      runtime.answer("t", approvals(store)[0].id, true);
      await sent;
      const [first, second] = out.got[0];
      assert.equal(first.allow, false, "the allow is refused");
      assert.match(String(first.reason), /Read only/);
      assert.equal(second.allow, false, "the next ask, at Read only, comes as no card at all");
      assert.equal(approvals(store).length, 1);
      assert.equal(approvals(store)[0].state, "denied");
      assert.ok(store.timeline("t").some((x) => x.kind === "notice" && /^Access went to Read only while “Edit src\/a\.ts” waited for you, so Liner Code refused it\.$/.test(x.text)));
    },
  );
  // Raised meanwhile, or still at Ask: the allow stands.
  const up = rig("ask");
  await withTool(
    async (sink, signal) => sink.approve(ASKS["an ACP agent's edit"], signal),
    async (out) => {
      const sent = up.runtime.send("t", "go");
      for (let i = 0; i < 200 && !approvals(up.store).length; i++) await tick();
      up.store.patchThread("t", { access: "edits" });
      up.runtime.answer("t", approvals(up.store)[0].id, true);
      await sent;
      assert.equal(out.got[0].allow, true);
    },
  );
});

test("stop: a call still running when you press Stop reads stopped, though its tool comes back failed or done", async () => {
  const { store, runtime } = rig("full");
  await withTool(
    async (sink, signal) => {
      sink.tool({ key: "a", tool: "Bash", toolKind: "exec", title: "sleep 8", status: "running" });
      sink.tool({ key: "b", tool: "bash", toolKind: "exec", title: "sleep 9", status: "running" });
      await new Promise<void>((r) => signal.addEventListener("abort", () => r(), { once: true }));
      // Claude Code's interrupted command, OpenCode's after cancel.
      sink.tool({ key: "a", tool: "Bash", toolKind: "exec", title: "sleep 8", status: "failed" });
      sink.tool({ key: "b", tool: "bash", toolKind: "exec", title: "sleep 9", status: "done" });
      return null;
    },
    async () => {
      const sent = runtime.send("t", "go");
      await tick(100);
      runtime.stop("t");
      await sent;
      const rows = store.timeline("t").filter((x) => x.kind === "tool").map((x) => (x as { status: string }).status);
      assert.deepEqual(rows, ["stopped", "stopped"]);
      assert.ok(store.timeline("t").some((x) => x.kind === "notice" && x.text === "You stopped this turn."));
    },
  );
});

test("stop: after a quick drop and raise of the level, the stop line names the level that stopped it, and doesn't say you stopped it", async () => {
  const { store, runtime } = rig("full");
  const saved = providers.claude;
  providers.claude = {
    id: "claude",
    detect: async () => ({}) as never,
    open: () => ({
      close() {},
      // Can't be held below Full, and slow to say so: the level is back up by then.
      setAccess: async (a) => (await tick(80), a === "full" ? true : "it was given your connections as this turn started"),
      turn: async (_t, _s, signal) => void (await new Promise<void>((r) => (signal.addEventListener("abort", () => r(), { once: true }), setTimeout(r, 2000)))),
    }),
  };
  try {
    const sent = runtime.send("t", "go");
    await tick(100);
    store.patchThread("t", { access: "read" });
    const down = runtime.accessChanged("t", "full");
    await tick(20);
    store.patchThread("t", { access: "full" });
    await Promise.all([down, runtime.accessChanged("t", "read")]);
    await sent;
  } finally {
    providers.claude = saved;
  }
  const lines = store.timeline("t").filter((x) => x.kind === "notice").map((x) => (x as { text: string }).text);
  assert.ok(lines.some((l) => /^Access went down to Read only during this turn, .*, so Liner Code stopped the turn\.$/.test(l)), lines.join(" | "));
  assert.ok(!lines.includes("You stopped this turn."), lines.join(" | "));
});

test("claude code: Read only's refusal reaches the model in its own sentence, not as the person's no", async () => {
  const saved = sdk.query;
  let options: Record<string, unknown> = {};
  sdk.query = (({ options: o }: { options: Record<string, unknown> }) => {
    options = o;
    return { async *[Symbol.asyncIterator]() {}, initializationResult: async () => ({}), interrupt: async () => {}, setPermissionMode: async () => {}, return: async () => ({ done: true, value: undefined }) };
  }) as unknown as typeof sdk.query;
  try {
    const s = claude.open({ cwd: "/tmp", model: "claude-opus-5-5", effort: "medium", access: "read", soul: "", guard: true, env: { PATH: "" } } as OpenOptions);
    const sink = { text() {}, reasoning() {}, tool() {}, plan() {}, approve: async () => ({ allow: false, level: true, reason: "READ-ONLY-SENTENCE" }), ask: async () => null, propose: async () => ({ approve: false }), usage() {}, session() {}, notice() {}, error() {}, limited() {} } as unknown as TurnSink;
    void s.turn("go", sink, new AbortController().signal).catch(() => {});
    for (let i = 0; i < 100 && !options.canUseTool; i++) await tick();
    const ask = options.canUseTool as (n: string, i: Record<string, unknown>, o: Record<string, unknown>) => Promise<{ behavior: string; message?: string }>;
    const r = await ask("Write", { file_path: "/tmp/a.ts", content: "x" }, { signal: new AbortController().signal, toolUseID: "t1" });
    assert.deepEqual(r, { behavior: "deny", message: "READ-ONLY-SENTENCE" });
    s.close();
  } finally {
    sdk.query = saved;
  }
});

test("read only through Claude Code's canUseTool, end to end in the runtime: its Write and Bash are refused with no card, and the model hears the sentence; at Ask they're cards", async () => {
  for (const access of ["read", "ask"] as Access[]) {
    const { store, runtime } = rig(access);
    const saved = sdk.query;
    const said: { behavior: string; message?: string }[] = [];
    sdk.query = (({ prompt, options }: { prompt: AsyncIterable<unknown>; options: Record<string, unknown> }) => {
      const ask = options.canUseTool as (n: string, i: Record<string, unknown>, o: Record<string, unknown>) => Promise<{ behavior: string; message?: string }>;
      const w: { wake: (() => void) | null } = { wake: null };
      const out: unknown[] = [];
      void (async () => {
        for await (const _m of prompt) {
          said.push(await ask("Write", { file_path: "/tmp/lc-ro-never.ts", content: "x" }, { signal: new AbortController().signal, toolUseID: "w1" }));
          said.push(await ask("Bash", { command: "touch /tmp/lc-ro-never.txt" }, { signal: new AbortController().signal, toolUseID: "b1" }));
          out.push({ type: "result", subtype: "success", is_error: false, result: "", num_turns: 1, duration_ms: 1, duration_api_ms: 1, stop_reason: null, total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 }, modelUsage: {}, permission_denials: [], uuid: "r", session_id: "s" });
          w.wake?.();
        }
      })();
      return {
        async *[Symbol.asyncIterator]() {
          for (;;) {
            if (out.length) yield out.shift();
            else await new Promise<void>((r) => (w.wake = r));
          }
        },
        initializationResult: async () => ({}), interrupt: async () => {}, setPermissionMode: async () => {}, setModel: async () => {}, applyFlagSettings: async () => {}, setMcpServers: async () => ({ added: [], removed: [], errors: {} }), return: async () => ({ done: true, value: undefined }),
      };
    }) as unknown as typeof sdk.query;
    const savedP = providers.claude;
    providers.claude = { ...claude, open: (o) => claude.open({ ...o, env: { PATH: "" } }) };
    try {
      const sent = runtime.send("t", "go");
      if (access === "ask")
        for (let n = 0; n < 2; n++) {
          let card: { id: string } | undefined;
          for (let i = 0; i < 300 && !(card = approvals(store).find((x) => x.state === "asking")); i++) await tick();
          assert.ok(card, `card ${n + 1}`);
          runtime.answer("t", card!.id, false);
        }
      await sent;
    } finally {
      sdk.query = saved;
      providers.claude = savedP;
      runtime.shutdown();
    }
    if (access === "read") {
      assert.equal(approvals(store).length, 0);
      assert.deepEqual(said.map((x) => x.behavior), ["deny", "deny"]);
      assert.match(String(said[0].message), /^This session is Read only, so Liner Code refused this change without asking anyone/);
      assert.match(String(said[1].message), /^This session is Read only, so Liner Code refused this command without asking anyone/);
    } else {
      assert.equal(approvals(store).length, 2);
      assert.match(String(said[0].message), /^The user said no/);
    }
  }
});
