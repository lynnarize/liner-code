# Plan 009: Tests pin Codex's access table, the proxy's WebSocket check, the updater's refusals, rewind's refusal and the open-with list

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 6970155..HEAD -- engine/src/providers/codex-server.ts engine/src/proxy.ts engine/src/updates.ts engine/src/api.ts engine/src/apps.ts engine/test`
> If the source files changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW (tests only)
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `6970155`, 2026-11-19

## Why this matters

Five rules decide what an agent may do or what gets installed, and no test checks them. If someone changes one line by mistake, every existing test still passes:

1. The table that turns Liner Code's access level into Codex's sandbox and approval policy.
2. The Browser proxy's check that a WebSocket upgrade was really addressed to the proxy (a defence against a web page that points its own name at `127.0.0.1`, called DNS rebinding).
3. The updater's refusals of a download that is not Liner Code, has the wrong version, or has no checksum.
4. Rewind-with-files refusing when a later turn's change is already committed.
5. The list of apps "Open in…" may start.

This plan adds tests only. It must not change any file under `engine/src`. These are characterization tests: they record what the code does today.

## Current state

- `engine/src/providers/codex-server.ts:29-37`:

  ```ts
  const POLICY: Record<Access, { sandbox: string; approval: string }> = {
    read: { sandbox: "read-only", approval: "never" },
    ask: { sandbox: "read-only", approval: "on-request" },
    edits: { sandbox: "workspace-write", approval: "untrusted" },
    auto: { sandbox: "workspace-write", approval: "on-request" },
    review: { sandbox: "workspace-write", approval: "untrusted" },
    full: { sandbox: "danger-full-access", approval: "on-request" },
  };
  const sandboxPolicy = (s: string, cwd: string) => (s === "read-only" ? { type: "readOnly", networkAccess: false } : s === "workspace-write" ? { type: "workspaceWrite", writableRoots: [cwd], … } : { type: "dangerFullAccess" });
  ```
  It is sent when the thread opens (`:425`: `const common = { cwd: this.o.cwd, approvalPolicy: p.approval, sandbox: p.sandbox, … }`) and with each turn (`:518-519`: `approvalPolicy: p.approval, sandboxPolicy: sandboxPolicy(p.sandbox, this.o.cwd),`).
- A fake Codex app server already exists in `engine/test/stop-grace.test.ts`: `opts(extra)` (line 42), `recorder()` (line 43), `script(name, on)` (line 52, writes a Node script that logs every JSON message it receives to a file and returns `{ file, log, read }`), the `CODEX` script body (line 209), and a test that drives it (lines 226-241):

  ```ts
  const fake = script("codex", CODEX);
  const s = new CodexServerSession(opts({ env: { ...process.env, LINER_BIN_CODEX: fake.file, FAKE_LOG: fake.log } }));
  const { sink } = recorder();
  const ac = new AbortController();
  const turn = s.turn("go", sink, ac.signal);
  await until(() => fake.read().some((m) => m.method === "turn/start"), "the turn started");
  …
  ac.abort();
  await turn;
  await s.close();
  ```
  `fake.read()` returns the logged messages, each with `method` and `params`.
- `engine/src/proxy.ts:391-398`:

  ```ts
    server.on("upgrade", (req, socket, head) => {
      if (!addressed(server, req.headers.host)) return void socket.destroy();
      const up = connect({ host: "localhost", port: target }, () => {
        const lines = [`${req.method} ${req.url} HTTP/1.1`];
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
          const k = req.rawHeaders[i];
          if (/^host$/i.test(k)) lines.push(`Host: localhost:${target}`);
          else if (!/^origin$/i.test(k) || !fromItself(req)) lines.push(`${k}: ${req.rawHeaders[i + 1]}`);
        }
  ```
  The HTTP path has a test, `engine/test/engine.test.ts:325-336` ("proxy: only requests for the proxy itself get through…"), which builds a `site` server, `const proxies = new Proxies(); const base = await proxies.url(port);` and sends a request with a chosen `Host`. No test sends an upgrade.
- `engine/src/updates.ts:580-596` (`verify`) returns a sentence for each refusal: `The download has no … at its top.`, `The download isn't Liner Code (its bundle id is different).`, `The download says it's ${v || "no version"}, not ${version}.`, `The download's signature is broken: …`, and the Team ID one. `updates.ts:491-492`: a release with no SHA-256 fails with `This release has no SHA-256 for its download, so it can't be checked. Get it from the release page instead.`
  `engine/test/updates.test.ts:125-176` has `miniApp(dir, version)` (a tiny ad-hoc-signed `Liner Code.app` with bundle id `app.liner.code`), `fakeGitHub(release)` and one test that covers a wrong checksum and a good download. It uses `{ skip: process.platform !== "darwin" }`.
- `engine/src/api.ts:1318-1321` (inside `thread.rewind`, when `files` is true):

  ```ts
          const committed = later.find((x) => x.committed);
          if (committed) throw new Error(`Turn ${committed.turn}'s changes are committed (${committed.committed}). Revert the commit first, or keep the changes.`);
  ```
  `engine/test/audit-api-turns.test.ts` has `setup()` (line 60), `fake(work)` (line 38), and near line 138 a rewind test that uses `changed(s)` (a session with one turn that edited `a.txt`), `s.call("thread.rewind", { threadId: t.id, itemId: asked.id, files: true })` and `cpOf(s, t.id)` (that turn's checkpoint item).
- `engine/src/apps.ts:40-42`:

  ```ts
  export async function openWith(path: string, app: string) {
    const known = KNOWN.find((a) => a.id === app);
    if (!known) throw new Error("Liner Code doesn't open folders in that app.");
  ```

Conventions for tests here: `node:test` and `node:assert/strict`; test names are full sentences; each file starts with a block comment saying what it covers and how to run it; helpers such as `tick` and `until` are small and copied per file. Long hand-formatted lines; never run a formatter.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck -w engine` | exit 0 |
| One file | `node --test engine/test/<file>.test.ts` | all pass |
| No source touched | `git status --short engine/src` | no output |

## Scope

**In scope** (tests only):
- `engine/test/codex-access.test.ts` (create)
- `engine/test/apps.test.ts` (create)
- `engine/test/engine.test.ts` (add one test beside the proxy test)
- `engine/test/updates.test.ts` (add tests)
- `engine/test/audit-api-turns.test.ts` (add one test)

**Out of scope**:
- Every file under `engine/src`. If a test shows the code does something other than this plan says, that is a STOP condition, not a reason to edit the code or to bend the test.

## Git workflow

- Stay on `design-and-api-endpoints`. One commit for this plan, a plain sentence (example from `git log`: `A Reviewer block reads as one, without a question's amber`). Do not push.

## Steps

### Step 1: Codex's access table

Create `engine/test/codex-access.test.ts`. Copy from `engine/test/stop-grace.test.ts` the imports it needs and the helpers `tick`, `until`, `opts`, `recorder`, `script` and the `CODEX` script, and call `noLeaks()` as that file does. Start the file with a block comment: what it pins and `Run with node --test engine/test/codex-access.test.ts`.

One test, a loop over the six levels:

```ts
const WANT = {
  read: { sandbox: "read-only", approval: "never", type: "readOnly" },
  ask: { sandbox: "read-only", approval: "on-request", type: "readOnly" },
  edits: { sandbox: "workspace-write", approval: "untrusted", type: "workspaceWrite" },
  auto: { sandbox: "workspace-write", approval: "on-request", type: "workspaceWrite" },
  review: { sandbox: "workspace-write", approval: "untrusted", type: "workspaceWrite" },
  full: { sandbox: "danger-full-access", approval: "on-request", type: "dangerFullAccess" },
} as const;

test("codex app server: each access level is the sandbox and approval policy Codex is told, as the thread opens and with each turn", async () => {
  for (const [access, want] of Object.entries(WANT)) {
    const fake = script("codex", CODEX);
    const s = new CodexServerSession(opts({ access: access as OpenOptions["access"], env: { ...process.env, LINER_BIN_CODEX: fake.file, FAKE_LOG: fake.log } }));
    const { sink } = recorder();
    const ac = new AbortController();
    const turn = s.turn("go", sink, ac.signal);
    await until(() => fake.read().some((m) => m.method === "turn/start"), `${access}: the turn started`);
    const opened = fake.read().find((m) => m.method === "thread/start")!.params;
    const began = fake.read().find((m) => m.method === "turn/start")!.params;
    assert.equal(opened.sandbox, want.sandbox, `${access}: the thread's sandbox`);
    assert.equal(opened.approvalPolicy, want.approval, `${access}: the thread's approval policy`);
    assert.equal(began.approvalPolicy, want.approval, `${access}: the turn's approval policy`);
    assert.equal(began.sandboxPolicy.type, want.type, `${access}: the turn's sandbox`);
    ac.abort();
    await turn;
    await s.close();
  }
});
```

Adjust only the typing of `fake.read()`'s result to what `script` returns in the file you copied from.

**Verify**: `node --test engine/test/codex-access.test.ts` → passes. Then prove it can fail: temporarily change one value in `WANT` (for example `edits.approval` to `"never"`), run again and see it fail, then restore it.

### Step 2: The proxy's WebSocket upgrade

In `engine/test/engine.test.ts`, directly after the test "proxy: only requests for the proxy itself get through; other sites keep their origin", add a test that:

1. Starts a plain `net`/`http` server `site` on `127.0.0.1` port 0 whose `upgrade` event records the request's `host` header and answers `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n`, then ends the socket.
2. Gets the proxy's address the same way the test above does (`new Proxies()`, `await proxies.url(port)`).
3. Opens a raw `net.connect` to the proxy's port and writes `GET / HTTP/1.1\r\nHost: evil.example:<proxy port>\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`. Asserts the socket is closed with no bytes received and that `site` saw no upgrade.
4. Does the same with `Host: 127.0.0.1:<proxy port>`. Asserts the reply starts with `HTTP/1.1 101` and that `site` saw `host` equal to `localhost:<site port>`.
5. Cleans up exactly as the test above does in its `finally`.

Name: `"proxy: a WebSocket upgrade gets through only when it's addressed to the proxy itself"`.

**Verify**: `node --test engine/test/engine.test.ts` → all pass.

### Step 3: The updater's refusals

In `engine/test/updates.test.ts`, after the test "a release is downloaded, checked against its SHA-256…", add three tests, each `{ skip: process.platform !== "darwin" }`, each built like that test (a running `miniApp` at `0.1.0`, a zipped app, `fakeGitHub`, an `Updater`, `up.download()`), with the release's `digest` set to the real SHA-256 of the zip so the checksum passes:

1. **Wrong version**: the release is tagged `v0.2.0` and its asset is named for `0.2.0`, but the zipped app is `miniApp(dir, "0.3.0")`. Expect `up.download()` to reject with `/says it's 0\.3\.0, not 0\.2\.0/` and `ready.json` not to exist.
2. **Not Liner Code**: build `miniApp(dir, "0.2.0")`, then rewrite its `Contents/Info.plist` with `CFBundleIdentifier` `com.example.other` and sign it again (`execFileSync("codesign", ["--force", "--sign", "-", app])`) before zipping. Expect `/bundle id is different/`.
3. **No checksum**: the asset has no `digest` and the release has no `.sha256` file. Expect `/no SHA-256/`.

**Verify**: `node --test engine/test/updates.test.ts` → all pass.

### Step 4: Rewind refuses a committed turn

In `engine/test/audit-api-turns.test.ts`, near the rewind test at line 138, add:

```ts
test("rewind: putting files back is refused when a later turn's change is committed, and nothing is touched", async () => {
  const f = fake(edit);
  try {
    const s = await setup();
    const t = await changed(s);
    const cp = cpOf(s, t.id)!;
    s.store.putItem(t.id, { ...cp, committed: "abc1234" });
    const asked = s.store.timeline(t.id).find((x) => x.kind === "user")!;
    const before = readFileSync(join(s.dir, "a.txt"), "utf8");
    await assert.rejects(() => s.call("thread.rewind", { threadId: t.id, itemId: asked.id, files: true }), /are committed \(abc1234\)/);
    assert.equal(readFileSync(join(s.dir, "a.txt"), "utf8"), before);
    assert.equal(s.store.thread(t.id).turns, 1, "the turn is still there");
  } finally {
    f.restore();
  }
});
```

Use the helper names (`edit`, `changed`, `cpOf`) exactly as the neighbouring tests use them.

**Verify**: `node --test engine/test/audit-api-turns.test.ts` → all pass.

### Step 5: The open-with list

Create `engine/test/apps.test.ts`:

```ts
/*
  "Open in…": only the apps on Liner Code's own list are ever started, so a caller can't name any program. Run with
  `node --test engine/test/apps.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { openWith } from "../src/apps.ts";

test("open with: an app that isn't on the list is refused before anything runs", async () => {
  await assert.rejects(() => openWith("/", "com.example.anything"), /doesn't open folders in that app/);
  await assert.rejects(() => openWith("/", ""), /doesn't open folders in that app/);
});
```

**Verify**: `node --test engine/test/apps.test.ts` → passes.

### Step 6: Full check

**Verify**: `npm run typecheck -w engine` → exit 0; `git status --short engine/src` → no output; `node --test engine/test/codex-access.test.ts engine/test/apps.test.ts engine/test/engine.test.ts engine/test/updates.test.ts engine/test/audit-api-turns.test.ts` → all pass.

## Test plan

This plan is the test plan: one new test for the Codex table, one for the proxy upgrade, three for the updater, one for rewind, one for open-with.

## Done criteria

- [ ] `npm run typecheck -w engine` exits 0
- [ ] The seven new tests exist and pass
- [ ] `git status --short engine/src` prints nothing
- [ ] `plans/README.md` status row updated

## STOP conditions

- A new test fails because the code does something other than "Current state" says (for example Codex is sent a different policy for a level). Report the level and what was sent. Do not change the expectation and do not change the code.
- The fake Codex script does not log `thread/start` or `turn/start` params.
- The proxy test cannot be written with the pieces the neighbouring test uses.
- `changed`, `cpOf` or `edit` do not exist in `audit-api-turns.test.ts` under those names.

## Maintenance notes

- When `POLICY` changes on purpose, the `WANT` table in `codex-access.test.ts` changes in the same commit, so the change is visible in review.
- Still unpinned after this plan: the updater's Team ID refusal (needs two Developer IDs), the swap script in `desktop/src/update.ts` (plan 010 adds part of it), rewind's "another session works in this folder" refusal, and the Electron main process's navigation and permission guards (`desktop/src/main.ts`).
