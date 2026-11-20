# 023. The engine checks before it works: addon-check tokens, the boot reply, the MCP key, endpoint keys, the file walk, the turn grant

**Commit message:** `A caller without a key is turned away before its body is read everywhere, the boot reply gives the token only to the app's page, and a key never goes to an http address off this Mac`

Written by the advisor on 2026-11-20 against commit `bfb0ebc` (branch `design-and-api-endpoints`, Liner Code 0.3.0 beta).
Refreshed 2026-11-20 at 13c7757 after the advisor's review. None of the files this plan touches changed between
`bfb0ebc` and `13c7757`; the line numbers below were read again at `13c7757`.
Findings: SEC-03, SEC-05, SEC-07, SEC-08 + FEAT-11 + FEAT-04 (one walk/search path), PROV-02, CORE-11, and the doc half
of SEC-01.

## What the review changed

- Step 1: the test request carries a timeout, so before the fix it fails instead of hanging (seen failing).
- Step 2: the STOP grep counts only `src` folders; test fixtures that set `LINER_SURFACE_KEY` are inert (seen failing).
- Step 3: the window's first page is a `data:` boot page whose preload also calls `liner:boot`. The reply now always
  carries platform/lights/clear and adds base/token/user/machine only when the sender guard passes. A bare
  `{ refused: true }` would have thrown in preload's `setLights`.
- Step 4: the walk and the search loop are exported and tested directly with a `setImmediate` flag. The old test
  ("a timer fired before the promise resolved") passed before the fix, because of the `git` spawn awaited first.
  Dangling links are skipped (symlink part seen failing).
- Step 5: refuse only when a KEY would go over http to a host that isn't this Mac, where the key is sent
  (`endpointModels`, `askEndpoint`, `endpointOptions`), never on save. Keyless LAN servers (Ollama or vLLM on
  another machine) keep working. README gains a line (seen failing).
- Step 6: calls `inFolder` from `providers/acp.ts`, already imported by runtime.ts (seen failing; the fix was tried
  in a scratch copy and the whole of `grants.test.ts` passed, 39 of 39).
- New step 7: SECURITY_MODEL.md's "not passed on to anything it spawns" is narrowed to what is true (SEC-01's doc half).

## Why this matters

The repo already built this discipline once: plan 011 made `/rpc` and `/events` check the caller before reading the
body, and `/surface`/`/outside` carry the comment "a caller without one isn't worth 64 MB of reading"
(`engine/src/server.ts:40`, `:168`). These paths still work before they check, or check less than their neighbours:

1. **SEC-03.** `/addon-check/<tok>/call` and `/report` (`server.ts:208-214`) do `await body(req)` (up to 64 MB,
   `server.ts:98`) and only then look the token up in `checkCall`/`checkReport` (`engine/src/agent-tools.ts:864,887`).
   Who can reach it: the Host check (`server.ts:116`) stops DNS rebinding only. A page posting straight to
   `127.0.0.1:<port>` gets through (Safari and Firefox let it; Chrome's Local Network Access asks first), and so does
   any local process. There is no limit on concurrent requests. The realistic attacker is a web page; severity LOW-MED,
   the fix is cheap.
2. **SEC-05.** `engine/src/mcp.ts:15` still honours `LINER_SURFACE_KEY` from the environment before the key file:
   the exact path plan 004 removed ("an environment … can be read by anything running as you (ps eww)",
   `agent-tools.ts:310`). Nothing in `src` sets the variable any more (only `LINER_SURFACE_KEY_FILE`,
   `agent-tools.ts:329`); the fallback is dead code that silently reopens the hole if anything ever sets it.
3. **SEC-07.** `ipcMain.on("liner:boot", …)` (`desktop/src/main.ts:380-383`) answers ANY sender with the boot object,
   which holds the engine token; the `liner` channel beside it (`:385-387`) checks sender, main frame and origin.
   Today only the main window's main frame has the preload (`main.ts:218`; nothing sets
   `nodeIntegrationInSubFrames`), `<webview>` is refused (`main.ts:286`), offscreen windows have no preload
   (`main.ts:401`), and the main frame never leaves the app's origin (`main.ts:273-279`). So the Browser panel's
   pages, add-on panels and Design frames cannot call it. LOW severity, latent: the guard still stops a renderer
   exploit in a cross-site frame from forging the IPC from its own frame.
4. **SEC-08 + FEAT-11 + FEAT-04.** The non-git file walk (`engine/src/files.ts:13-42`) uses `statSync` (follows
   links) and recurses into symlinked directories, listing names outside the project to a panel
   (`engine/src/panels.ts:130-134`); reads stay guarded by `readable()` (`panels.ts:68-81`), so this is a name leak.
   The same walk is fully synchronous (up to 20k entries), and a panel's `files.search` (`panels.ts:141-178`) scans
   every file synchronously (`readable()` with two `realpathSync`, `statSync`, `readFile`), with no await until its
   limits. The stall size in a large project has not been measured.
5. **PROV-02.** `endpointModels` (`engine/src/providers/endpoint.ts:86-93`) accepts any `^https?://` base and sends the
   key (`x-api-key`/`Bearer`); `askEndpoint` (`engine/src/providers/plain.ts:24-38`) does the same; and
   `endpointOptions` (`endpoint.ts:36`, called on session open at `:158`) hands the key and URL to the tool. A typo'd
   or hostile `http://api.example.com` sends the API key in cleartext. The docs promise less than the audit said: the
   only "http is local" wording is `endpointModels`' error hint; README lists LM Studio, Ollama, LiteLLM and vLLM
   "on this Mac" and says "One on this Mac needs no key" (README.md:497-503). A keyless server on another machine
   on your network is a legitimate setup and must keep working; only a key over remote http is the hole.
6. **CORE-11.** `turnCovers` (`engine/src/runtime.ts:2875-2883`) checks `resolve(cwd, f.value)` against `resolve(cwd)`
   lexically; the ACP gate for the same rule follows links (`inFolder`, `engine/src/providers/acp.ts:655-665`). An
   in-project link to a file outside passes the turn grant.
7. **SEC-01 (doc half).** `SECURITY_MODEL.md:10` says secrets "are not passed on to anything it spawns". True for the
   shell's handoff (the token and keys reach the engine on stdin and are deleted from its environment,
   `engine/src/main.ts:49-60`), not for tool keys: an endpoint's key goes to its tool in a variable of its own
   (`endpoint.ts:45,64,71`), as README already says (README.md:501-502), and an add-on's stdio server gets its
   secrets in its environment (`engine/src/addons.ts:826-830`). The mechanism change (a key file where a tool can read
   one) stays the owner's decision; this plan only makes the sentence true.

## Current state (drift check)

```bash
git log --oneline -1                                   # 13c7757 or later
sed -n '40,40p;93,101p;114,117p;163,170p;195,215p' engine/src/server.ts # knows hook, body cap, Host check, surface exemplar, addon-check
sed -n '189,190p' engine/src/main.ts                   # knows + check wiring
sed -n '12,21p' engine/src/mcp.ts                      # the env fallback before the key file
sed -n '380,393p' desktop/src/main.ts                  # boot unguarded, liner guarded
sed -n '1,60p' desktop/src/preload.ts                  # what the page does with the boot reply
sed -n '1040,1066p' desktop/src/main.ts                # the data: boot page, then the app's origin
sed -n '13,42p' engine/src/files.ts                    # the walk
sed -n '67,81p;128,178p' engine/src/panels.ts          # readable(), files.list, files.search
sed -n '27,28p;36,72p;86,93p;158,158p' engine/src/providers/endpoint.ts # local(), endpointOptions, endpointModels, open
sed -n '24,38p' engine/src/providers/plain.ts          # askEndpoint
sed -n '2875,2883p' engine/src/runtime.ts              # turnCovers
sed -n '26,26p' engine/src/runtime.ts                  # already imports from ./providers/acp.ts
sed -n '630,665p' engine/src/providers/acp.ts          # realPath, inFolder
sed -n '10,10p' SECURITY_MODEL.md                      # the sentence step 7 narrows
sed -n '495,503p' README.md                            # the endpoint paragraph step 5 adds to
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
  shows the server-test pattern (plan 011's tests live there); `engine/test/endpoints.test.ts` has fetch fakes;
  `engine/test/grants.test.ts` has the turn-grant harness. Desktop: the suite tests pure modules without Electron.
  Test commands need `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID`.
- One local commit, the message above. Never push. Steps are independent; a STOP in one leaves the rest doable.
- Never log or print a key value in a test or a comment: reference it by name only.

## Steps

### 1. addon-check: the token before the body (SEC-03)

- In `engine/src/agent-tools.ts`, add a public predicate beside `checkCall` (`:864`):
  `checkKnown(token: string) { return this.checks.has(token); }` (the map is `private checks`, `:286`), with one
  comment: asked before a body is read.
- In `engine/src/server.ts:40`, extend the `knows` type with `check(key: string): boolean`; in the `/addon-check`
  branch, before the `call` and `report` body reads (`:208-214`), add the same refusal the surface path uses:
  `if (o.knows && !o.knows.check(tok)) return void res.writeHead(401).end("Unauthorized");`
  The GET page and settle paths stay as they are (cheap, already token-scoped).
- In `engine/src/main.ts:189`, wire `check: (key) => tools.checkKnown(key)` beside surface/outside.
- Keep the `o.knows`-unset fallback (the call itself says), exactly as the surface path does.

**Test first** (`engine/test/audit-api.test.ts`, the server-test pattern):
"server: an addon-check call with a token it doesn't know is refused before its body is read". Start the server
with `check` = stubs that count calls and `knows` = `{ surface: () => false, outside: () => false, check: () => false }`;
POST `/addon-check/<36 hex>/call` with `http.request({ …, timeout: 2000 })`, write `"{"` and never end the body. On
`timeout`, destroy the request and fail with "the engine read the body before it looked at the token". Assert 401 and
that the stubs were never called. Seen failing at 13c7757: it times out with that message. Add "a known token's call
still goes through" (`check: () => true`, a whole body, the stub's answer comes back).
**Verify:** the new tests, the rest of `engine/test/audit-api.test.ts` (including plan 011's Host-check tests),
`npm run typecheck -w engine`.

### 2. The MCP server reads only the key file (SEC-05)

- Delete `engine/src/mcp.ts:15` (`if (process.env.LINER_SURFACE_KEY) return process.env.LINER_SURFACE_KEY;`). The
  comment at `:13` already says why the file is the path; keep it.
- `git grep -nw LINER_SURFACE_KEY -- engine/src desktop/src ui/src contracts/src`: confirm only `mcp.ts:15` matches.
  Test files set it too (`engine/test/addons.test.ts:180`, `audit-claude-mcp.test.ts:390`, `live-frames.test.ts:128`,
  `models-reach.test.ts:267` in fake option objects; `providers.test.ts:1088` spawns mcp.ts with it only for
  `tools/list`, which needs no key). Those are inert: leave them.

**Test first** (`engine/test/mcp-key.test.ts`): "mcp: the session key comes from its file, never from the
environment". A fake engine (`http.createServer` on 127.0.0.1:0) records `x-liner-surface` and answers
`{ ok: true, result: "done" }`; write a key file (mode 0600, temp dir) holding one value; spawn
`node engine/src/mcp.ts` with `LINER_SURFACE_URL=http://127.0.0.1:<port>/surface`, `LINER_SURFACE_KEY_FILE` at the
file, AND `LINER_SURFACE_KEY` set to a different value; write one line
`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"browser_open","arguments":{}}}`; wait for the reply
with `"id":1`; assert the fake saw exactly the file's value. Kill the child and close the fake in `finally`. Seen
failing at 13c7757: the fake saw the environment's value.
**Verify:** the new test, `engine/test/providers.test.ts` (its mcp.ts `tools/list` check), `npm run typecheck -w engine`.

### 3. The boot reply gives the token only to the app's page (SEC-07)

The window's first page is a `data:` boot page (`desktop/src/main.ts:1048`, "Starting the engine"); its preload calls
`liner:boot` too, and `ours()` is false for it. `preload.ts:12-50` reads `boot.platform`, `boot.clear` and
`boot.lights` and calls `setLights(boot.lights)`, which throws on `undefined`. So a refusal must keep those three.

- Create `desktop/src/boot-reply.ts` (no Electron imports, like `signed.ts`):

```ts
/** What liner:boot answers. Where the page draws (platform, the traffic lights, see-through) goes to any page the
    window shows, the "Starting the engine" page included; the engine's address and token, and your name, only to the
    app's own page, as the liner channel answers only it. */
export function bootReply(boot: { base: string; token: string; machine: string; user: string }, shell: { platform: string; lights: { x: number; y: number }; clear: boolean }, ours: boolean) {
  return ours ? { ...boot, ...shell } : { base: "", token: "", machine: "", user: "", ...shell };
}
```

- In `desktop/src/main.ts:380-383`, compute the same guard as `:387` and answer with it:
  `const mine = !!win && e.sender === win.webContents && e.senderFrame === win.webContents.mainFrame && ours(e.senderFrame?.url ?? "");`
  `e.returnValue = bootReply(boot, { platform: process.platform, lights: lights(), clear: Boolean(mac) }, mine);`
  Keep the existing comment about `clear`.
- Do not change `preload.ts`: it already copes with empty strings (the token is `""` on the boot page today, before
  the engine is up, `main.ts:77`).

**Test first** (`desktop/test/boot-reply.test.ts`, the `signed.test.ts` pattern):
- "boot: a page that isn't the app's gets where to draw but neither the token nor your name": `bootReply(…, false)`
  has platform, lights and clear, and `token`, `base`, `user`, `machine` are `""`.
- "boot: the app's own page gets the token": `bootReply(…, true)` carries them.
- "boot: the shell answers liner:boot only through bootReply, with the liner channel's guard": read
  `desktop/src/main.ts` as text, take the `ipcMain.on("liner:boot"` handler's span, and assert it contains
  `e.senderFrame === win.webContents.mainFrame`, `ours(` and `bootReply(`. This one fails before the fix; the two
  above fail before because the module does not exist.
**Verify:** the test, `npm run typecheck -w desktop`, `node desktop/build.ts` exits 0. On screen, with `npm run app`
(or say "not seen"): the "Starting the engine" page shows, then the app loads and connects (the boot page and the
app's page both work); `npm run dev` + `npm run app:dev` loads the dev page with its token.

### 4. The file walk skips links to folders and yields; panel search yields (SEC-08, FEAT-11, FEAT-04)

In `engine/src/files.ts`:
- Move the fallback walk out of `listFiles` into `export async function walkFiles(root: string, limit = 20000): Promise<string[]>`
  and have `listFiles` call it when `git ls-files` fails. Do this move FIRST with the body unchanged (still
  synchronous inside), so the yield test below can be seen failing against it.
- Then use `lstatSync` instead of `statSync`:
  - a symbolic link to a directory is neither walked nor listed (git lists what git sees; a planted link isn't the
    project's file, and a link to a folder inside the project only repeats files the walk lists anyway);
  - a symbolic link to a file keeps its name listed (reads of it stay guarded by `readable()`; do not change that);
  - a link to nothing is skipped (`statSync` threw on it and skipped it before; keep that). Tell a link's kind with
    one `statSync` of the link itself, in a try, after `lstatSync` says `isSymbolicLink()`.
- Make the walk yield: an inner async walk that awaits `new Promise((r) => setImmediate(r))` every 200 entries and
  before recursing, keeping the limit, depth and `SKIP` semantics identical. The git path stays as it is.
In `engine/src/panels.ts` (`files.search`, `:141-178`):
- Move the loop into `export async function searchFiles(root: string, files: string[], needles: string[], o: { fold: boolean; limit: number }): Promise<{ path: string; line: number; text: string }[]>`
  with the body unchanged first (same `readable` guard, 512 KB cap, 20 MB read budget, match limit); `files.search`
  calls it with `await listFiles(root(), 20000)`.
- Then add `if (++seen % 200 === 0) await new Promise((r) => setImmediate(r));` at the top of the loop. Leave
  `readable()` exactly as it is.

**Test first** (`engine/test/files-walk.test.ts`):
- "files: outside a git repository the walk doesn't go through a link to a folder elsewhere": in a temp folder (not
  a git repository), `project/` holds `a.txt`, `real.txt`, `linked -> ../elsewhere` (a folder holding a file with a
  distinctive name), `alias.txt -> real.txt` and `dangling.txt -> ../nothing`. `listFiles(project)` lists
  `alias.txt`, not the distinctive name and not `dangling.txt`. Seen failing at 13c7757: it listed
  `linked/<the distinctive name>`.
- "files: the walk lets the engine's other work run while it goes": 600 files in a temp folder;
  `let ran = false; setImmediate(() => (ran = true)); await walkFiles(dir); assert.ok(ran)`. With the walk moved but
  still synchronous, the async function resolves in microtasks before any `setImmediate`, so it fails; after the
  yields it passes.
- "panels: a search lets the engine's other work run while it goes": the same pattern over `searchFiles` with 600
  small files and a word none of them holds.
**Verify:** the new tests, `engine/test/panels.test.ts` and any test that greps `files.list`/`files.search`
(`git grep -l "files.search\|listFiles" engine/test`), `npm run typecheck -w engine`.

### 5. A key never goes over http to another machine (PROV-02)

The rule: https anywhere; http to this Mac (`localhost`, any `*.localhost`, `127.0.0.0/8`, `[::1]`) with or without a
key; http to anywhere else only WITHOUT a key. Checked where the key is sent, never when an endpoint is saved
(endpoints save through `settings.save` with the whole list, `engine/src/api.ts:1744`; a refusal there would block
unrelated settings, and endpoints already saved would never pass it).

In `engine/src/providers/endpoint.ts`:
- Replace `local` (`:28`) with an exported helper that parses the address (`URL.parse`), and keep the old name's
  use in `detect` (`:126`):

```ts
/** On this Mac: localhost, a .localhost name, 127.0.0.0/8 or ::1. */
export const local = (url: string) => {
  const u = URL.parse(url.trim());
  if (!u || !/^https?:$/.test(u.protocol)) return false;
  const h = u.hostname.toLowerCase();
  return h === "localhost" || h.endsWith(".localhost") || h === "[::1]" || /^127(\.\d{1,3}){3}$/.test(h);
};
/** Whether a key may go to this address: never in cleartext over the network. Without a key, a server elsewhere on
    your network (Ollama on another machine) is reached as it is. */
export const keyMayGo = (url: string) => /^https:\/\//i.test(url.trim()) || local(url);
export const CLEARTEXT_KEY = "Its key would cross the network unencrypted: give its address starting https://, or remove its key if the server needs none.";
```

- `endpointModels` (`:86`): keep the "Give its address…" check, then
  `if (key && !keyMayGo(base)) throw new Error(CLEARTEXT_KEY);` before any fetch.
- `endpointOptions` (`:36`): the same line at the top (`e.url`, `key`). This is the session-open path (`:158`), so a
  stored endpoint with a key on remote http fails to open with these words instead of handing the key over.
- `engine/src/providers/plain.ts` `askEndpoint` (`:24`): import `keyMayGo` and `CLEARTEXT_KEY` from `./endpoint.ts`
  (no cycle at 13c7757: endpoint.ts imports only contracts, `./types.ts` and `./opencode-go.ts`) and throw before
  the fetch when `key && !keyMayGo(base)`.
- `opencode-go.ts` `goUsage` fetches only fixed https addresses (`USAGE`, `${VOUCHER.url}/usage`,
  `endpoint.ts:150`): leave it.
- README.md, in the endpoint paragraph (after "One on this Mac needs no key.", `:503`), add one sentence: a key is
  only ever sent over https, or over http to this Mac; a server elsewhere on your network over http works without a
  key.

**Test first** (`engine/test/endpoints.test.ts`, its fetch-fake pattern):
- "endpoints: a key is never sent to an http address off this Mac": replace `globalThis.fetch` with a counter;
  `endpointModels("http://api.example.com/v1", "chat", "k")` rejects and the counter stays 0. Seen failing at
  13c7757 ("Missing expected rejection"). Same for `askEndpoint` with an http endpoint elsewhere and a key, and
  `endpointOptions(ep("chat", "http://192.168.1.20:11434/v1"), "m", "k", env)` throws.
- "endpoints: a server elsewhere on your network over http works without a key": `endpointModels("http://192.168.1.20:11434/v1", "chat")`
  fetches; `endpointOptions` with no key returns.
- "endpoints: on this Mac http takes a key": `http://localhost:4000`, `http://127.0.0.2:8000`, `http://[::1]:1234`,
  `http://ollama.localhost` all pass `keyMayGo`; `http://localhost.example.com` does not.
**Verify:** `engine/test/endpoints.test.ts` whole (its `:31` and `:43` loopback cases still pass), the doctor tests
(`git grep -l askEndpoint engine/test`), `npm run typecheck -w engine`.

### 6. The turn grant's in-project check follows links (CORE-11)

In `engine/src/runtime.ts`:
- Add `inFolder` to the existing import from `./providers/acp.ts` (`:26`).
- In `turnCovers` (`:2880-2882`) replace the lexical check with:

```ts
    const files = req.fields.filter((f) => f.label === "File").map((f) => f.value);
    return files.length > 0 && files.every((f) => inFolder(cwd, f));
```

  `inFolder` resolves both sides' real paths (`acp.ts:633-665`): a file that doesn't exist yet keeps its missing
  tail (a new file in the project still goes), a link to nothing counts as outside, and a link inside the project to
  a file inside counts as inside. Do not widen the grant. Drop `resolve`/`sep` from runtime.ts's imports only if
  nothing else there uses them (typecheck says).

**Test first** (`engine/test/grants.test.ts`, beside "the turn's grant covers commands and edits in the project…",
`:741`): "runtime: the turn's grant doesn't cover an edit through a link in the project to a file outside it". Use
`session("ask", …)` and its returned `dir`: put `linked.txt -> <a temp folder elsewhere>/target.txt` in `dir`;
after `npm run build` is granted for the turn, ask an `Edit` naming `linked.txt` and an `Edit` naming `src/new.ts`
(not there yet). Expect `linked.txt` refused (a card comes) and `src/new.ts` allowed. Seen failing at 13c7757:
`linked.txt` went ahead. With the change above, tried in a scratch copy, the new test and all of `grants.test.ts`
passed (39 of 39).
**Verify:** `engine/test/grants.test.ts` whole, `npm run typecheck -w engine`.

### 7. The threat model says where keys go (SEC-01, the doc half)

`SECURITY_MODEL.md:10`: replace the sentence "Secrets reach the engine on stdin and are not passed on to anything it
spawns (`engine/src/main.ts`)." with one that is true, for example:
"The token and keys reach the engine on stdin, never in its environment, and nothing it starts inherits them
(`engine/src/main.ts`). A key is then handed only to what uses it: an endpoint's key to its tool's process in a
variable of its own, as README says, and an add-on's secrets to its MCP server, in its environment where that server
reads them. Anything running as you can read a process's environment (`ps eww`); a key file instead is the owner's
open decision (SEC-01)."
Change nothing else in that bullet. No test (a doc line); the check is that the sentence matches `main.ts:49-60`,
`endpoint.ts:45,64,71` and `addons.ts:826-830`.

## Done

- Every new test fails before and passes after (steps 1, 2, 4's link case, 5 and 6 were seen failing at 13c7757);
  the named existing test files still pass; `npm run typecheck` exits 0; `node desktop/build.ts` exits 0.
- README.md and SECURITY_MODEL.md say what the code does (steps 5 and 7).
- One commit, the message above. Executor note: commit, per-step status, what was not seen (step 3 on screen), any
  STOP.

## STOP conditions

- Step 2: anything in `engine/src`, `desktop/src`, `ui/src` or `contracts/src` besides `mcp.ts:15` sets or reads
  `LINER_SURFACE_KEY`: stop, report. Test files don't count.
- Step 3: the page needs a field of the boot reply this plan withholds from the boot page: stop, report which.
- Step 4: `readable()`'s checks would need widening to keep search working: stop. The guard must not loosen.
- Step 5: a service in `ui/src/app/services.ts` with a key uses plain http off this Mac (none does at 13c7757): stop,
  report.
- Any step would touch Routines' webhook path (`/hooks`): it is off and out of scope.

## Maintenance note

The discipline is now uniform: every keyless route checks its key before reading a body; every key handoff checks
the address; the walk never follows a link out of the project; the turn grant judges a file by where it really is. A
new route or handoff should copy the neighbouring guard; the tests name the current ones.
