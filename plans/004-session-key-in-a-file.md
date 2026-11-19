# Plan 004: A session's key to Liner Code's tools is no longer in any process environment or command line

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 6970155..HEAD -- engine/src/agent-tools.ts engine/src/mcp.ts engine/src/providers/types.ts engine/src/providers/demo.ts engine/src/providers/demo-canvas.ts engine/src/security-demo.ts`
> If any of these changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (touches how every agent tool is handed Liner Code's own tools)
- **Depends on**: none (run plan 002 first if you can, so the fixture fix is in)
- **Category**: security
- **Planned at**: commit `6970155`, 2026-11-19

## Why this matters

Every session gets a small MCP server (`engine/src/mcp.ts`) that gives its agent Liner Code's own tools. That server proves which session it speaks for with a random key. Today the key is passed in the server's environment as `LINER_SURFACE_KEY`, and for `codex exec` it also lands on Codex's command line. On macOS any process of the same user can read another process's environment and arguments (`ps eww`). The engine's own comment in `engine/src/main.ts:49-52` says this is why the engine's token goes over stdin instead.

A plugin running in Liner Code's sandbox may run `/bin/ps` and reach `127.0.0.1`. With a stolen key it can call the `sidekick` tool (a brief that runs at that session's access level, Full included) or `memory_add`. This plan moves the key into a file under Liner Code's own folder, readable only by the user, which the plugin sandbox is already forbidden to read. The same pattern already exists for the "outside" key (`outside.json`, mode 0600).

## Current state

- `engine/src/agent-tools.ts:253`: `private keys = new Map<string, string>();` (key → thread id).
- `engine/src/agent-tools.ts:295-311` (`serverFor`):

  ```ts
  serverFor(threadId: string, o: { pair?: boolean; sidekick?: boolean } = {}): { command: string; args: string[]; env: Record<string, string> } | null {
    if (!this.url) return null;
    const who = o.sidekick ? `${threadId}${AS_SIDEKICK}` : threadId;
    let key = [...this.keys].find(([, t]) => t === who)?.[0];
    if (!key) {
      key = randomBytes(18).toString("hex");
      this.keys.set(key, who);
    }
    …
    return { command: process.execPath, args: [script("mcp")], env: { ...electron, LINER_SURFACE_URL: `${this.url}/surface`, LINER_SURFACE_KEY: key, ...(o.pair && !o.sidekick ? { [PAIR_ENV]: "1" } : {}), ...(level ? { [SECURITY_ENV]: level } : {}) } };
  }
  ```
- `engine/src/agent-tools.ts:313-320`:

  ```ts
  threadOf(key: string) {
    return this.keys.get(key);
  }

  /** Forgets every key of a thread that never came to be … */
  forget(threadId: string) {
    for (const [key, who] of this.keys) if (who === threadId || who === `${threadId}${AS_SIDEKICK}`) this.keys.delete(key);
  }
  ```
- `engine/src/mcp.ts:11-12`:

  ```ts
  const url = process.env.LINER_SURFACE_URL ?? "";
  const key = process.env.LINER_SURFACE_KEY ?? "";
  ```
  and it sends the key as the `x-liner-surface` header on each call (`mcp.ts:33`). The file's header comment says it "imports nothing from the engine but the list of tools"; Node built-ins are fine.
- `engine/src/providers/types.ts:192`: `mcp?: { command: string; args: string[]; env: Record<string, string> };`
- How the tools receive it (each forwards `command`, `args`, `env` field by field, never the whole object):
  - `engine/src/providers/claude.ts:64`: `out.liner = { type: "stdio", command: o.mcp.command, args: o.mcp.args, env: o.mcp.env, timeout: … }`
  - `engine/src/providers/codex-server.ts:156`: `"mcp_servers.liner.env": o.mcp.env` (and `engine/src/providers/codex.ts:257` `execMcp` turns that whole table into `-c` flags on `codex exec`'s command line)
  - `engine/src/providers/acp.ts:2121`: `const m = o.mcp;` (read what follows it)
- In-process callers that read the key from the env object (the Demo runs inside the engine and has no child process):
  - `engine/src/providers/demo.ts:311` and `:355`, `engine/src/providers/demo-canvas.ts:201`, `engine/src/security-demo.ts:274`: `headers: { …, "x-liner-surface": o.mcp.env.LINER_SURFACE_KEY }`
- Tests that read the key from `serverFor(...)` or from a provider's open options: `engine/test/polish-core.test.ts:85,360`, `engine/test/sidekick.test.ts:101,186,241,344,356`, `engine/test/pair-design.test.ts:121`, `engine/test/warmnew.test.ts:213`. Tests that build their own `mcp` object with `env: { LINER_SURFACE_KEY: "k" }`: `engine/test/addons.test.ts:180`, `engine/test/audit-claude-mcp.test.ts:390`, `engine/test/models-reach.test.ts:267`, `engine/test/live-frames.test.ts:128`. `engine/test/providers.test.ts:1088` spawns `mcp.ts` with the key in the environment.
- The precedent to copy, `engine/src/outside-tools.ts:66-70`:
  `writeFileSync(this.file, JSON.stringify({ url: `${this.url}/outside`, key: this.key }), { mode: 0o600 });`
- The plugin sandbox denies reading Liner Code's home: `engine/src/dsh-hosts.ts:345` lists `o.linerHome` among the paths under `(deny file-read-data …)`.
- `this.store.home` is the engine's data folder (used at `agent-tools.ts:470`).

Conventions: TypeScript run directly by Node 24 (imports end in `.ts`, no enums). Long hand-formatted lines; do not re-wrap untouched code and never run a formatter. Comments are plain sentences that say why. Tests are `node:test` with sentence names.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck -w engine` | exit 0 |
| Find leftovers | `grep -rn "LINER_SURFACE_KEY" engine/src` | only `mcp.ts` (the fallback read) and the new `LINER_SURFACE_KEY_FILE` lines |
| Focused tests | `node --test engine/test/polish-core.test.ts engine/test/sidekick.test.ts engine/test/pair-design.test.ts engine/test/warmnew.test.ts engine/test/live-frames.test.ts engine/test/providers.test.ts` | all pass |
| Engine suite | `npm run test:steady -w engine` | all pass (about 11 minutes) |

## Scope

**In scope**:
- `engine/src/agent-tools.ts` (`serverFor`, `forget`, the constructor)
- `engine/src/mcp.ts` (how it reads the key)
- `engine/src/providers/types.ts` (the `mcp` option's type)
- `engine/src/providers/demo.ts`, `engine/src/providers/demo-canvas.ts`, `engine/src/security-demo.ts` (read `o.mcp.key`)
- The test files listed above, plus one new test file `engine/test/surface-key.test.ts`

**Out of scope**:
- `engine/src/dsh-hosts.ts` and the sandbox profile: tightening it is a separate decision.
- `engine/src/dsh-mcp.ts` and `engine/src/outside.ts`: different servers with their own keys.
- `claude.ts`, `codex-server.ts`, `codex.ts`, `acp.ts`: they keep forwarding `o.mcp.env` as they do. If one of them needs a change, that is a STOP condition.

## Git workflow

- Stay on `design-and-api-endpoints`. One commit for this plan, a plain sentence (example from `git log`: `A Reviewer block reads as one, without a question's amber`). Do not push.

## Steps

### Step 1: Write the failing test

Create `engine/test/surface-key.test.ts`, modelled on the top of `engine/test/memory.test.ts` (imports, a temp home, `new Store(home)`, `new AgentTools(store, process.env)`):

```ts
/*
  A session's key to Liner Code's own tools: kept in a file only this user can read, under Liner Code's folder, and named to the
  tool's MCP server by its path. Never in an environment or on a command line, which any process of this user can read.
  Run with `node --test engine/test/surface-key.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentTools } from "../src/agent-tools.ts";
import { execMcp } from "../src/providers/codex.ts";
import { Store } from "../src/store.ts";

test("a session's key is in a file of the user's own, and nowhere a process listing shows", { skip: process.platform === "win32" }, () => {
  const home = mkdtempSync(join(tmpdir(), "lc-key-"));
  const tools = new AgentTools(new Store(home), process.env);
  tools.url = "http://127.0.0.1:9";
  const s = tools.serverFor("t")!;
  assert.equal(s.env.LINER_SURFACE_KEY, undefined, "not in the environment");
  const file = s.env.LINER_SURFACE_KEY_FILE;
  assert.ok(file.startsWith(join(home, "surface-keys")), "under Liner Code's folder");
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(readFileSync(file, "utf8"), s.key);
  assert.equal(tools.threadOf(s.key!), "t");
  assert.ok(!execMcp({ mcp: s }).join(" ").includes(s.key!), "not on codex exec's command line");
  // The same session again: the same key and file.
  assert.equal(tools.serverFor("t")!.env.LINER_SURFACE_KEY_FILE, file);
  tools.forget("t");
  assert.ok(!existsSync(file), "gone with the key");
});
```

**Verify**: `node --test engine/test/surface-key.test.ts` → FAILS (the env still carries the key).

### Step 2: Widen the option's type

In `engine/src/providers/types.ts:192` change the line to:

```ts
  /** `key`: the session's key itself, for a caller inside the engine (the Demo). The tool's MCP server reads it from the file `env` names; it is never put in an environment or on a command line. */
  mcp?: { command: string; args: string[]; env: Record<string, string>; key?: string };
```

**Verify**: `npm run typecheck -w engine` → exit 0.

### Step 3: Keep the key in a file

In `engine/src/agent-tools.ts`:

1. Add `chmodSync`, `mkdirSync`, `rmSync`, `writeFileSync` to the existing `node:fs` import if they are not there, and `join` from `node:path` if it is not there.
2. Next to `private keys` add:

   ```ts
   /** Where each key is kept for its MCP server to read: a file only this user can read, under Liner Code's folder (which the plugin sandbox may not read). */
   private keyFiles = new Map<string, string>();
   ```
3. In the constructor, after `this.env = env;`, add:

   ```ts
   // Keys are made anew each run: the files of the run before reach nothing now.
   if (typeof store.home === "string") rmSync(join(store.home, "surface-keys"), { recursive: true, force: true });
   ```
4. In `serverFor`, right after the `if (!key) { … }` block, add:

   ```ts
   // An environment and a command line can be read by anything running as you (ps eww), a sandboxed plugin included: the key goes
   // in a file of your own instead, as the outside key does (outside.json), and the MCP server is told only where it is.
   let keyFile = this.keyFiles.get(key);
   if (!keyFile) {
     const dir = join(this.store.home, "surface-keys");
     mkdirSync(dir, { recursive: true, mode: 0o700 });
     keyFile = join(dir, randomBytes(9).toString("hex"));
     writeFileSync(keyFile, key, { mode: 0o600 });
     chmodSync(keyFile, 0o600);
     this.keyFiles.set(key, keyFile);
   }
   ```
5. Change the return type of `serverFor` to add `key: string`, and in the returned object replace `LINER_SURFACE_KEY: key` with `LINER_SURFACE_KEY_FILE: keyFile` and add `key` as a sibling of `env`:
   `return { command: process.execPath, args: [script("mcp")], env: { …, LINER_SURFACE_URL: `${this.url}/surface`, LINER_SURFACE_KEY_FILE: keyFile, … }, key };`
6. In `forget`, delete the file too:

   ```ts
   forget(threadId: string) {
     for (const [key, who] of this.keys) {
       if (who !== threadId && who !== `${threadId}${AS_SIDEKICK}`) continue;
       this.keys.delete(key);
       const file = this.keyFiles.get(key);
       if (file) rmSync(file, { force: true });
       this.keyFiles.delete(key);
     }
   }
   ```

**Verify**: `npm run typecheck -w engine` → reports errors only at the four in-process callers and the tests (fixed next), or exit 0.

### Step 4: Have the MCP server read the file

In `engine/src/mcp.ts` add `import { readFileSync } from "node:fs";` and replace line 12 with:

```ts
/** The session's key, from the file the engine wrote for it (agent-tools.ts serverFor); an environment is where anything running as you could read it. */
const key = (() => {
  if (process.env.LINER_SURFACE_KEY) return process.env.LINER_SURFACE_KEY;
  try {
    return readFileSync(process.env.LINER_SURFACE_KEY_FILE ?? "", "utf8").trim();
  } catch {
    return "";
  }
})();
```

(The environment fallback stays so an existing test that spawns `mcp.ts` by hand keeps working; the engine no longer sets it.)

**Verify**: `node --test engine/test/providers.test.ts` → all pass.

### Step 5: In-process callers use `o.mcp.key`

At `engine/src/providers/demo.ts:311`, `:355`, `engine/src/providers/demo-canvas.ts:201` and `engine/src/security-demo.ts:274`, replace `o.mcp.env.LINER_SURFACE_KEY` (or `this.o.mcp.env.LINER_SURFACE_KEY`) with `o.mcp.key ?? ""` (or `this.o.mcp.key ?? ""`).

**Verify**: `grep -rn "LINER_SURFACE_KEY" engine/src` → matches only in `mcp.ts` and the `LINER_SURFACE_KEY_FILE` lines of `agent-tools.ts`.

### Step 6: Update the tests that read the key

- Where a test reads the key from `serverFor(...)` or from a provider's open options (`polish-core.test.ts:85,360`, `sidekick.test.ts:101,186,241,344,356`, `pair-design.test.ts:121`, `warmnew.test.ts:213`), change `.env.LINER_SURFACE_KEY` to `.key` (keep any `!` the line already has).
- `live-frames.test.ts:128` builds its own `mcp` for the Demo canvas: add `key: "k"` beside its `env`.
- Leave `addons.test.ts:180`, `audit-claude-mcp.test.ts:390` and `models-reach.test.ts:267` alone unless they fail; if one fails because the provider now ignores `env.LINER_SURFACE_KEY`, add `key: "k"` to its `mcp` object.

**Verify**: `npm run typecheck -w engine` → exit 0; `node --test engine/test/surface-key.test.ts engine/test/polish-core.test.ts engine/test/sidekick.test.ts engine/test/pair-design.test.ts engine/test/warmnew.test.ts engine/test/live-frames.test.ts engine/test/providers.test.ts engine/test/addons.test.ts engine/test/audit-claude-mcp.test.ts engine/test/models-reach.test.ts` → all pass.

### Step 7: Whole suite

**Verify**: `npm run test:steady -w engine` → all pass.

## Test plan

- New: `engine/test/surface-key.test.ts` (Step 1): the key is not in `env`, the file is mode 0600 under `<home>/surface-keys`, `codex exec`'s arguments do not contain it, the same session reuses its file, `forget` removes it.
- Existing tests updated in Step 6 keep proving that a key still maps to its session and that the Demo still reaches its tools.

## Done criteria

- [ ] `npm run typecheck -w engine` exits 0
- [ ] `grep -rn "LINER_SURFACE_KEY: " engine/src` → no matches
- [ ] `node --test engine/test/surface-key.test.ts` passes
- [ ] `npm run test:steady -w engine` passes
- [ ] `git status --short` shows no modified file outside the in-scope list
- [ ] `plans/README.md` status row updated, with the note "needs the owner's real-tool run (Claude Code, Codex, OpenCode)"

## STOP conditions

- `acp.ts` after line 2121, or any other provider, forwards the whole `o.mcp` object (a spread such as `{ ...o.mcp }`) so the new `key` field would be sent to a tool. Report the line.
- A provider needs `LINER_SURFACE_KEY` itself in the environment for a reason other than passing it to `mcp.ts`.
- `this.store.home` is not a string in the running engine.
- More than three test files outside the list in "Current state" fail after Step 6.

## Maintenance notes

- This is the part of the app the fakes cannot prove: each real CLI starts `mcp.ts` itself. Before a release the owner should run one turn that uses a Liner tool (for example `show_page`) on Claude Code, Codex (app server and `exec`) and OpenCode, and check `ps eww` shows no key.
- On Windows the file mode is not enforced by the system; the folder is still under the user's own profile.
- A reviewer should check that nothing logs the key file's contents, and that `forget` runs wherever a session's key should die.
- Deferred on purpose: adding `(deny process-info*)` to the plugin sandbox profile. It may break plugins and needs a test on a real plugin.
