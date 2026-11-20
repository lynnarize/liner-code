# 023. The engine checks before it works: addon-check tokens, the boot reply, the MCP key, endpoint addresses, and the file walk

**Commit message:** `A caller without a key is turned away before its body is read everywhere, the boot reply answers only the app's page, and a key never goes to a remote http address`

Written by the advisor on 2026-11-20 against commit `bfb0ebc` (branch `design-and-api-endpoints`, Liner Code 0.3.0 beta).
Findings: SEC-03, SEC-05, SEC-07, SEC-08 + FEAT-11 + FEAT-04 (one walk/search path), PROV-02. Every excerpt below is
from the advisor's own read.

## Why this matters

The repo already built this discipline once: plan 011 made `/rpc` and `/events` check the caller before reading the
body, and `/surface`/`/outside` carry the comment "a caller without one isn't worth 64 MB of reading"
(`engine/src/server.ts:168-169`). Five paths still work before they check, or check less than their neighbours:

1. **SEC-03.** `/addon-check/<tok>/call` and `/report` (`server.ts:208-214`) do `await body(req)` (up to 64 MB,
   `server.ts:98`) and only then look the token up in `checkCall`/`checkReport` (`engine/src/agent-tools.ts:864,887`).
   Any web page (simple POST, text/plain, no preflight) can make the engine buffer 64 MB per request against invented
   36-hex tokens, with no rate limit.
2. **SEC-05.** `engine/src/mcp.ts:15` still honours `LINER_SURFACE_KEY` from the environment before the key file —
   the exact path plan 004 removed ("an environment … can be read by anything running as you (ps eww)",
   `agent-tools.ts:310`). Nothing sets the variable any more (only `LINER_SURFACE_KEY_FILE`, `agent-tools.ts:329`);
   the fallback is dead code that silently re-opens the hole if anything ever sets it.
3. **SEC-07.** `ipcMain.on("liner:boot", …)` (`desktop/src/main.ts:380-383`) answers ANY sender with the boot object,
   which holds the engine token; the `liner` channel beside it (:387) checks sender, main frame and origin. Today only
   the main frame gets the preload, so this is latent — one preload-in-subframes change away from live.
4. **SEC-08 + FEAT-11 + FEAT-04.** The non-git file walk (`engine/src/files.ts:19-41`) uses `statSync` (follows
   links) and recurses into symlinked directories, listing names outside the project to a panel (`panels.ts:131-133`);
   reads stay guarded, so this is a name leak. The same walk is fully synchronous (up to 20k entries), and a panel's
   `files.search` (`panels.ts:150-178`) scans every file synchronously — realpath×2 + stat + read per file, no await
   until the limits — holding the engine's single thread for seconds in a large project.
5. **PROV-02.** `endpointModels` (`engine/src/providers/endpoint.ts:88`) accepts any `^https?://` base and sends the
   key (`x-api-key`/`Bearer`, :90-93); its own error text promises "http:// for one on this Mac" but nothing enforces
   it. `local()` (:28) exists and is used only for the sign-in guess (:126). `plain.ts:38` likewise fetches the
   configured URL with the key over whatever scheme it has. A typo'd or hostile `http://api.example.com` sends the
   API key in cleartext.

## Current state (drift check)

```bash
git log --oneline -1                                  # bfb0ebc or later
sed -n '40,40p;163,171p;195,214p' engine/src/server.ts # the knows hook, the surface exemplar, addon-check
sed -n '189,189p' engine/src/main.ts                  # knows wiring: tools.threadOf(key)
sed -n '12,21p' engine/src/mcp.ts                     # the env fallback before the key file
sed -n '380,393p' desktop/src/main.ts                 # boot unguarded, liner guarded
sed -n '13,41p' engine/src/files.ts                   # the walk
sed -n '150,178p' engine/src/panels.ts                # files.search
sed -n '28,28p;86,93p' engine/src/providers/endpoint.ts # local(), endpointModels
```

The surface exemplar (`server.ts:167-169`):

```ts
      const key = String(req.headers[outside ? "x-liner-outside" : "x-liner-surface"] ?? "");
      // The key first: any page in a browser can post here, and its body is read only once it has shown a key of ours.
      if (o.knows && !(outside ? o.knows.outside(key) : o.knows.surface(key))) return void res.writeHead(401).end("Unauthorized");
```

## Rules

- Never run a formatter; do not re-wrap or re-indent unchanged lines. Comments are plain sentences that say why.
- Do not touch `ui/src/liner/**`, Routines, `mac/`, the Demo provider, `CHANGELOG.md`, the untracked folders.
- Every fix comes with a test that fails without it, written first. Engine tests: `engine/test/audit-api.test.ts`
  shows the server-test pattern (plan 011's tests live there); `engine/test/endpoints.test.ts` has a local HTTP server
  and fetch fakes. Desktop: a source test reading `main.ts` (the desktop suite tests pure modules; main.ts imports
  Electron, so pin the guard by reading the file — precedent: the layout source tests). Test commands need
  `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID`.
- One local commit, the message above. Never push. Steps are independent; a STOP in one leaves the rest doable.
- Never log or print a key value in a test or a comment — reference it by name only.

## Steps

### 1. addon-check: the token before the body (SEC-03)

- In `engine/src/agent-tools.ts`, add a public predicate beside `checkCall` (~:864): `checkKnown(token: string) { return this.checks.has(token); }`
  (read the checks map's name; one line, comment why: asked before a body is read).
- In `engine/src/server.ts:40`, extend the `knows` type with `check(key: string): boolean`; in the `/addon-check`
  branch, before the `call`/`report` body reads (:208-214), add the same refusal the surface path uses:
  `if (o.knows && !o.knows.check(tok)) return void res.writeHead(401).end("Unauthorized");`
  (the GET page/settle paths stay as they are — they are cheap and already token-scoped).
- In `engine/src/main.ts:189`, wire `check: (key) => tools.checkKnown(key)` beside surface/outside.
- Keep the `o.knows`-unset fallback (the call itself says) exactly as the surface path does.

**Test first** (`engine/test/audit-api.test.ts` or a new `engine/test/addon-check-guard.test.ts`, the server-test
pattern): "an addon-check call with an unknown token is refused before its body is read" — POST a body that would
block if read (a stream that never ends, or assert via a spy that `checkCall` is never invoked and the response is
401 while the request body is still unconsumed); "a known token's call still goes through". See the first fail before.
**Verify:** the new tests, the existing audit-api tests (including plan 011's Host-check tests), engine typecheck.

### 2. The MCP server reads only the key file (SEC-05)

- Delete `engine/src/mcp.ts:15` (`if (process.env.LINER_SURFACE_KEY) return process.env.LINER_SURFACE_KEY;`). The
  comment at :13 already says why the file is the path; keep it.
- Grep the whole repo for `LINER_SURFACE_KEY` (word-boundary, not `_FILE`): confirm nothing sets it. If something
  does, STOP and report — the fallback may be load-bearing for a path the audit missed.

**Test first** (`engine/test/mcp-key.test.ts`): stand up a fake engine HTTP server that records the `x-liner-surface`
header; write a key file (0600, temp dir); spawn `node engine/src/mcp.ts` with `LINER_SURFACE_URL` pointing at the
fake, `LINER_SURFACE_KEY_FILE` at the file, AND `LINER_SURFACE_KEY` set to a DIFFERENT sentinel value; send a tool
call over its stdio (the JSON-RPC shape mcp.ts speaks — read its initialize/tools/call handling); assert the fake
received the FILE's key, never the env sentinel. Before the fix the env wins — see it fail. (Spawn pattern:
`engine/test/bundle.test.ts` spawns a child engine; use temp LINER_HOME, kill the child in finally.)
**Verify:** the new test, engine typecheck.

### 3. The boot reply answers only the app's page (SEC-07)

In `desktop/src/main.ts:380-383`, guard `liner:boot` exactly as `liner` (:387):
`if (!win || e.sender !== win.webContents || e.senderFrame !== win.webContents.mainFrame || !ours(e.senderFrame?.url ?? "")) { e.returnValue = { refused: true }; return; }`
— read what the page does with a refused boot (preload.ts's boot call) and choose the refusal shape that fails safe
(the page must not proceed with a partial boot; if preload expects the full object, return the same shape with the
token absent and let the page's existing reconnect path handle it — read preload.ts first and say which you chose).
One comment: the token-bearing reply answers only the app's own page, as the liner channel does.

**Test first** (`desktop/test/boot-guard.test.ts`, source test): read `desktop/src/main.ts`, assert the `liner:boot`
handler region contains the sender/main-frame/origin check (match `e.sender !== win.webContents` within the boot
handler's span). Fails before.
**Verify:** the test, `npm run typecheck -w desktop`, `node desktop/build.ts` exits 0. On screen (or "not seen"):
the app still boots normally (the legitimate caller is exactly the main frame).

### 4. The file walk skips symlinked directories and yields; panel search yields (SEC-08, FEAT-11, FEAT-04)

In `engine/src/files.ts`:
- Use `lstatSync` instead of `statSync` in the walk; a symlinked DIRECTORY is not recursed into (its own name is not
  listed either — the git path lists what git sees, and a planted link is not the project's file); a symlinked FILE
  keeps its name listed (reads of it stay guarded by `readable()` in panels.ts — do not change that).
- Make the walk yield: it is already inside the async `listFiles`; convert `walk` to an async function that awaits
  `new Promise((r) => setImmediate(r))` every ~200 entries (and before recursing), keeping the limit/depth/SKIP
  semantics identical. The git path stays as it is.
In `engine/src/panels.ts`'s `files.search` (:150-178):
- Keep the loop's semantics (readable guard, 512 KB cap, 20 MB read budget, match limit) and add a yield every ~200
  files: `if (++seen % 200 === 0) await new Promise((r) => setImmediate(r));`. Reuse one `realpath` of the root if
  `readable()` re-resolves it per file (read readable() first; do not change its checks).

**Test first** (`engine/test/files-walk.test.ts`): a temp NON-git folder with a symlinked directory pointing outside
(it holds a file with a distinctive name) — `listFiles` does not list the outside name (fails before: statSync walks
it); a symlinked file's own name is listed; a fixture of many files lets a concurrent `setTimeout` callback run
mid-walk and mid-search (assert the timer fired before the promise resolved — fails before the yields).
**Verify:** the new tests, the existing files/panels tests, engine typecheck.

### 5. A key never goes to a remote http address (PROV-02)

In `engine/src/providers/endpoint.ts`:
- Export a guard beside `local()`:

```ts
/** An endpoint's address: https anywhere, http only on this Mac — a key must never cross the network in cleartext.
    The UI's wording promises exactly this ("http:// for one on this Mac"); the engine enforces it, not the form. */
export const endpointUrlOk = (url: string) => /^https:\/\//i.test(url.trim()) || local(url);
```

- In `endpointModels` (:88), replace the scheme regex's acceptance with: keep the "Give its address…" error for a
  non-URL, and add `if (!endpointUrlOk(base)) throw new Error("Give its address starting https:// (or http:// for one on this Mac).");`
  BEFORE any fetch.
- In `engine/src/providers/plain.ts` (the ask path, ~:30-38): the same guard on `base` before the fetch, with the
  same words. Read where `base` comes from (e.url) and guard at the top of the ask.
- At the endpoint SAVE/OPEN path in `engine/src/api.ts` (find `endpoints.add`/`endpoints.update`/the open that builds
  endpointOptions): refuse a non-loopback http URL with the same words, so a stored endpoint cannot be opened into a
  cleartext handoff either. `endpointOptions` itself may also guard (defense in depth) — one call site minimum, the
  save path; say where you put it.
- `opencode-go.ts`'s `goUsage` fetches fixed hosted URLs (USAGE, the voucher's) — read it; if `at` can ever be a
  user-configured URL, guard it too; if it is only the constants, leave it and say so.
- Local endpoints (LM Studio, Ollama on 127.0.0.1) keep working — `local()` already names them.

**Test first** (`engine/test/endpoints.test.ts` extension, its fake-server/fetch pattern): "a remote http endpoint is
refused before any fetch" (spy on global fetch; `endpointModels("http://api.example.com", …)` rejects and the spy is
not called — fails before); "a loopback http endpoint still lists its models" (the existing local server); "https
anywhere is allowed". Add the save-path refusal test if the api guard is testable with the file's stand-ins.
**Verify:** the endpoints tests, engine typecheck.

### 6. The turn-grant's in-project check follows links (CORE-11)

`engine/src/runtime.ts:2880-2882` — `turnCovers` (what "don't ask again this turn" lets an edit go ahead on at
Manual/Edits) checks `resolve(cwd, f.value)` against `resolve(cwd)` with `startsWith` — plain lexical paths, no link
following. The ACP gate for the same rule was fixed to follow links (`engine/src/providers/acp.ts:1311-1313`,
`inProject` → `inFolder`, the EDGE-CASES symlink fix); the runtime's turn-grant gate kept the lexical check. A
symlink inside the project pointing out passes the "every file it names is in the project" test, so an edit through
it goes ahead without asking on a tool whose edits come through Liner's approve (Claude Code's, Codex's apply_patch).
MED confidence: the tool's own path rules may catch some cases — pin with a test, do not assume a bypass.

- Reuse the ACP gate's real-path check: resolve each named file's real path (as `acp.ts`'s `inFolder` does) before
  the in-project test; a link to nothing counts as outside, as there. Read `inFolder` and call the same helper if it
  is exported; else mirror its few lines with a comment naming the sibling.
- Do not widen the grant: the check stays "every file in the project", now link-aware.

**Test first** (`engine/test/turn-grant-links.test.ts`): a temp project with a symlink pointing outside; a turn-grant
("don't ask again this turn") at Edits; an edit naming the link → the grant does NOT cover it (a card comes), while
an edit naming a real in-project file still goes. Fails before (the lexical check covers the link). If the tool's
own path rules refuse the link first in the fake, say so — the runtime gate must still be right on its own.
**Verify:** the new test, the approval/grant tests (grep `turnCovers`/`don't ask again` in engine/test), engine
typecheck.

## Done

- All new tests fail before and pass after; the named existing test files still pass; `npm run typecheck` exits 0;
  `node desktop/build.ts` exits 0.
- One commit, the message above. Executor note: commit, per-step status, what was not seen (step 3's boot on screen),
  any STOP.

## STOP conditions

- Step 2: anything still sets `LINER_SURFACE_KEY`: stop, report.
- Step 3: preload's boot contract cannot fail safe without a page change: stop, report the contract.
- Step 4: `readable()`'s checks would need widening to keep search working: stop — the guard must not loosen.
- Step 5: a legitimate hosted endpoint uses http (none should): stop, report.
- Any step would touch Routines' webhook path (`/hooks`) — it is off and out of scope.

## Maintenance note

The discipline is now uniform: every keyless route checks its key before reading a body; every key handoff checks
the address scheme; the walk never follows a link out of the project. A new route or handoff should copy the
neighbouring guard — the tests name the current ones.
