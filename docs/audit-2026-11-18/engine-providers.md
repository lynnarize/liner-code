# Audit: engine/src/providers

Scope: acp.ts, claude.ts, codex-server.ts, codex.ts, types.ts, models.ts, added.ts, plain.ts, endpoint.ts, opencode-go.ts, attachments.ts; demo.ts / demo-canvas.ts read for bugs only.
No file under `engine/src/providers` has uncommitted changes (`git status --short engine/src/providers` is empty). The newest provider code is commit de80da8 (2026-11-18 11:38, Liner Security: `scan` / `sealed`). Findings that sit in that code are marked "(new today)".

---

### 1. Every OpenCode turn ends by exporting the whole OpenCode session, parsing it, and holding the turn open while it runs
- category: perf (and ux)
- severity: medium
- confidence: likely (the code path is confirmed; that `opencode export` dumps every message with its parts, so the dump grows with the session, is the assumed link)
- where: engine/src/providers/acp.ts:1716 (call), acp.ts:337-403 (opencodeTurnUsage), acp.ts:361-365, 380-381
- evidence:
  ```ts
  // finally of turn(), before the turn is handed back:
  const real = this.opencode ? await opencodeTurnUsage(this.cmd, session, since, { cwd: this.o.cwd, env: this.o.env }) : null;
  ...
  child.stdout.on("data", (d: Buffer) => { stdout += d; if (stdout.length > 128 * 1024 * 1024 && !over) (over = true), killTree(child); });
  ...
  const j = start >= 0 ? (JSON.parse(out.stdout.slice(start)) ...
  ```
- what goes wrong: each OpenCode turn, Stopped ones included, spawns `opencode export --pure <session>` (or `session export --standalone`), collects the whole session as one string (allowed up to 128 MB), copies it with `slice`, and parses all of it, only to sum the tokens of the last turn's messages. The work grows with the session's length, every turn. The turn also stays "running" until this finishes, by its own comment up to 4 s cold (OPENCODE_USAGE_MS), so after Stop the turn takes up to 4 s more to end, and in a long session the timeout cuts in and the count falls back anyway.
- fix: skip the export when ACP's own numbers are exact already: a turn with no tool calls (`this.calls.size === 0`) has one step, so `r.usage` is the whole turn. Skip it after Stop too, or cap it (e.g. 1.5 s), so Stop ends at once. If the store grows, read only the tail of the export rather than parsing all of it.
- effort: S
- risk of the fix: the usage numbers of multi-step turns stay as they are. Test with acp/opencode usage tests (`setOpencodeUsageMs`).

### 2. Each API endpoint runs its base tool's full detect again, with the same env: Codex endpoints spawn 4 Codex processes each at startup
- category: perf
- severity: medium
- confidence: confirmed
- where: engine/src/providers/endpoint.ts:109-110; engine/src/api.ts:308-311 (every provider's detect in parallel, same `env`); engine/src/runtime.ts:61,65 (one endpoint provider per endpoint, plus the voucher); codex.ts:275
- evidence:
  ```ts
  // endpoint.ts
  async detect(env) { const d = await base.detect(env); ... models: models(), modelsFrom: "builtin", signedIn: keyed ? true : undefined, ...
  // codex.ts detect
  const [version, listed, server, status] = await Promise.all([versionOf(path, env), catalog(path, env), run(path, ["app-server", "--help"], ...), run(path, ["login", "status"], ...)]);
  ```
- what goes wrong: api's `detect()` already detects `codex` and `claude` with this `env`. Each endpoint routed through Codex (and the voucher's) detects Codex again, identically: `--version`, `debug models` (up to 20 s), `app-server --help` and `login status`, 4 spawns. Through Claude Code it's 2 (`--version`, `auth status`); through OpenCode it's 1. The endpoint then throws away the models and sign-in it got. With three Codex endpoints that's 16 Codex starts at launch, all at the same moment, competing with the app's own start (the memory notes launch time as something already worked on).
- fix: share one detect per base tool and env within a round. Either memoise in `endpointProvider` (a promise kept per `base.id`, a few seconds long), or let api's `detect()` run base tools first and hand their result to endpoint detects.
- effort: S
- risk of the fix: an endpoint's `available`/`version` must still follow the base tool's. Test that adding or removing an endpoint updates the picker.

### 3. Listing an ACP agent's slash commands opens a new session in the person's project, every 5 minutes
- category: ux (and perf)
- severity: medium
- confidence: likely (that OpenCode and Hermes save every `session/new` in their own history is the assumed link; agy's spec comment says exactly that about agy)
- where: engine/src/providers/acp.ts:2240; models.ts:217-262 (acpCommands); api.ts:777-794 (cached 5 min per provider and folder)
- evidence:
  ```ts
  commands: async (env, cwd) => ({ commands: spec.listed ? (HEARD.get(id) ?? []) : await acpCommands(cmd, envOf(env), cwd), skills: [] }),
  // models.ts acpCommands
  await request("session/new", { cwd, mcpServers: [] });
  ```
- what goes wrong: for OpenCode, Hermes, Cursor, Grok and every agent you add, the composer's command list spawns the agent and opens a throwaway session in the project folder. Once the cache is older than 5 minutes, opening the composer does it again. Each run is a cold agent start (OpenCode loads its config, plugins and LSPs), and in OpenCode and Hermes an empty session appears in the person's own history for that project. That is why agy was excluded (acp.ts:2110-2112: "each would stay in the person's history"). `HEARD` already holds the commands that live sessions reported (acp.ts:1193-1194), but it is read only for agy.
- fix: prefer `HEARD` for every ACP agent, keyed by `id` and cwd (it's per id now), and fall back to `acpCommands` only when no live session has said anything yet. Or run that fallback in the scratch folder, if project-level commands can wait for the first live session.
- effort: S
- risk of the fix: a project-specific command (.opencode/command) shows only after the first session in that project. Check the composer's command list for OpenCode before and after.

### 4. ACP `fs/read_text_file` refuses your attachments, and anything outside the project, at every level including Full
- category: bug
- severity: medium
- confidence: likely (that registry agents such as claude-agent-acp read through the client when `readTextFile: true` is advertised is the assumed link; Liner always advertises it, acp.ts:1031)
- where: engine/src/providers/acp.ts:1214-1222; compare acp.ts:1289 (`handed`) and claude.ts:800 / 857 (attachments allowed)
- evidence:
  ```ts
  const inside = (path: unknown) => {
    if (!this.inProject(path)) throw new Error("That path is outside the project.");
    return resolve(this.o.cwd, String(path));
  };
  if (method === "fs/read_text_file") { const text = await readFile(inside(p.path), "utf8"); ...
  ```
- what goes wrong: attachments are saved outside the project and named in the message (`o.dirs`). The permission path treats those folders as readable (`handed`, line 1289), and Claude Code gets them as `additionalDirectories`. But an agent that reads through the client gets "That path is outside the project." for the file you attached, and for any other file outside the project, at Full access too, with no card. That is stricter than the level the person chose, and it breaks attachments for those agents.
- fix: in `fs/read_text_file`, allow `this.o.dirs` as `handed` does (`[this.o.cwd, ...(this.o.dirs ?? [])].some((d) => inFolder(d, path))`). Outside those, send it through `this.ask`-style approval (`session/request_permission` semantics) at levels below Full rather than a flat refusal. Writes stay project-only.
- effort: S
- risk of the fix: keep writes untouched; keep `.env` rule parity with `secretFile` if reads outside are opened up. Test with a fake ACP agent that reads an attachment path.

### 5. Every ACP message chunk re-joins and regex-scans the whole answer so far (O(n²) per turn), for every ACP agent, though only agy needs it
- category: perf
- severity: low
- confidence: confirmed
- where: engine/src/providers/acp.ts:1436-1442; RETRY at acp.ts:2037; only readers: 1642 (hintMs, agy) and 1745 (failedWords, agy)
- evidence:
  ```ts
  if (kind === "agent_message_chunk") {
    const said = blockText(u.content);
    const news = (this.spoken + said).replace(RETRY, "").trim().length;
    ...
    this.spoken += said;
  ```
- what goes wrong: OpenCode and Hermes stream many small chunks. A 40 KB answer in 4,000 chunks copies and scans about 80 MB of text, on the engine's single thread, while the turn streams. `spoken`/`news` are read only when `known.hintMs` or `known.failedWords` is set (Antigravity).
- fix: guard with `if (this.known.hintMs || this.known.failedWords)`. When it is needed, count it incrementally: keep only the text after the last newline as a carry, strip RETRY from `carry + said`, and add the new length.
- effort: S
- risk of the fix: agy's silence hint. Run antigravity.test.ts.

### 6. Errors thrown while handling a streamed line vanish: swallowed by jsonLines, or unhandled rejections from the async onMessage. One of them can leave a Codex turn hanging
- category: bug
- severity: low
- confidence: likely (that a sink call can throw, as EDGE-CASES says of a failed disk write, is the assumed link)
- where: engine/src/exec.ts:785-791 (jsonLines, used by every provider); codex.ts:180; codex-server.ts:205 and 264-280; acp.ts:961 and 1176-1205
- evidence:
  ```ts
  // exec.ts jsonLines
  try { onLine(JSON.parse(line)); } catch { onRaw?.(line); }
  // codex-server.ts / acp.ts
  jsonLines(child.stdout, (v) => void (this.child === child && this.onMessage(v as Msg)));   // onMessage is async
  ```
- what goes wrong: in `codex exec`, any exception in the handler (a sink call, a bug for an odd item) is caught as if the line weren't JSON and dropped without a log. In the app server and ACP, `onMessage` is async: a throw in `onNotify`/`onUpdate` becomes an unhandled rejection. In codex-server.ts:822-830, a throw from `sink.error`/`sink.limited` comes before `this.done?.()`, so the turn never resolves until Stop.
- fix: in jsonLines, parse in the try and call `onLine` outside it, logging a throw with `console.error`. In both clients, `.catch(log)` the onMessage promise. In codex-server's `turn/completed`, call `this.done?.()` in a `finally`.
- effort: S
- risk of the fix: low. A handler bug now shows in the log instead of vanishing.

### 7. Images are labelled by file extension for Codex and ACP agents, by their bytes only for Claude Code
- category: bug
- severity: low
- confidence: likely (that a Codex/ACP backend refuses a mislabelled image as the Anthropic API does is assumed; claude.ts's comment says that API keeps refusing on every later turn)
- where: engine/src/providers/attachments.ts:36-40 (dataUrl, by extension), codex-server.ts:88-95, acp.ts:1688-1692; compare claude.ts:315-321 (imageKind by bytes, 5 MB cap)
- evidence:
  ```ts
  // acp.ts
  const mimeType = imageType(f); const bytes = mimeType ? readUpTo(f, 20 * 1024 * 1024) : null;
  return mimeType && bytes ? [{ type: "image", mimeType, data: bytes.toString("base64") }] : [];
  // claude.ts
  const kind = bytes ? imageKind(bytes) : undefined; if (!bytes || !kind || ...) continue;
  ```
- what goes wrong: a screenshot saved as `.png` that is really a JPEG (or an empty or HTML file named `.png`) goes to Codex's app server and to ACP agents labelled `image/png`. OpenCode in front of an Anthropic model then sends it with the wrong media type, and a conversation that holds a refused image can fail on every turn after. ACP also sends up to 20 MB where Anthropic takes 5 MB per image.
- fix: one helper in attachments.ts, `imagePart(path, max)`, that returns `{ mimeType: imageKind(bytes), data }` or null, used by `withFiles`, `dataUrl` and the ACP prompt.
- effort: S
- risk of the fix: a file whose bytes aren't an image now goes by path alone. That is Claude's behaviour already.

### 8. Two JSON-RPC-over-stdio clients written twice (CodexServer and AcpSession), plus two stripped-down copies in models.ts
- category: refactor
- severity: medium
- confidence: confirmed
- where:
  - codex-server.ts:165-307: `pending` keyed by child, `request` (with a "not running" guard), `notify`, `onMessage` (reply or request dispatch, `Unknown` to -32601), stderr tail, `unstarted`, fail-on-close, `close` with a bounded wait.
  - acp.ts:717-720, 889-907, 958-1005, 1176-1205: the same pieces again; `class Unknown` is at codex-server.ts:85 and acp.ts:1988.
  - models.ts:59-113 (acpModels) and 217-262 (acpCommands): a third and fourth copy of spawn + `waiting` + `request` + jsonLines, whose requests never reject.
  - Small shared bits: the 4000-character stderr tail plus `scrub(last 3 lines)` at codex.ts:145/222, codex-server.ts:203/206 and acp.ts:959/906. `short()` at codex.ts:263, codex-server.ts:48, claude.ts:568 and acp.ts:2043.
- what goes wrong: fixes have to land three or four times. EDGE-CASES shows several that were made in one client and copied to the other: the per-child pending map, the "not running" guard, -32601. The models.ts copies already lack them: no reply to agent requests, and requests that never reject.
- fix: pull `class RpcChild { spawn(path, args, opts); request(method, params, timeout?); notify; onNotify; onRequest; said(); close() }` into a new providers/rpc.ts with the JSON-RPC envelope as an option (ACP adds `jsonrpc: "2.0"`). Move CodexServer onto it first (smallest), then AcpSession's plumbing (not its policy), then acpModels/acpCommands. Move `short` and `stderrTail` into types.ts beside `scrub`.
- effort: M
- risk of the fix: request ids, the per-child failure, and close timing. Run drivers.test.ts, audit-codex-acp.test.ts and antigravity.test.ts.

### 9. `execMcp` restates codexMcp's `liner` keys by hand
- category: refactor
- severity: low
- confidence: confirmed
- where: engine/src/providers/codex.ts:254-255 vs codex-server.ts:145
- evidence: both list `command`, `args`, `env`, `tool_timeout_sec=${LINER_WAIT_SEC}`, `default_tools_approval_mode="approve"` and `omit_tools_from=["deferred"]` under `mcp_servers.liner.*`, one as `-c` strings and one as an object.
- what goes wrong: the next key added to one (as `omit_tools_from` was) can be missed in the other, and the old-Codex path then defers or refuses Liner's tools.
- fix: `export const execMcp = (o) => Object.entries(codexMcp(o)).flatMap(([k, v]) => ["-c", `${k}=${toml(v)}`]);` With no connections, codexMcp returns exactly the liner keys.
- effort: S
- risk of the fix: none in output; codex tests cover the argv.

### 10. Codex's item-to-row mapping is duplicated between exec and the app server
- category: refactor
- severity: low
- confidence: confirmed
- where:
  - File-change title: codex.ts:163, codex-server.ts:870 and again at 1073 (2 names instead of 3).
  - MCP title (`liner` uses linerTitle): codex.ts:167, codex-server.ts:877 and 1076.
  - Web search title: codex.ts:170, codex-server.ts:881 and 1078.
  - Effort filter `!/^ultra(code|think)$/`: codex.ts:105, codex-server.ts:455.
  - `model && model !== "default" ? model : null`: three times in codex-server.ts (389, 466, 476; 476 ignores the `model` const made at 466).
- what goes wrong: the same row reads differently in a sidekick's steps than in the turn ("and 2 more" versus "and 3 more"), and fixes drift.
- fix: small helpers in codex-server.ts, `editTitle(paths, n)`, `mcpTitle(server, tool, args)` and `codexEffort(effort)`, used from both files.
- effort: S
- risk of the fix: titles in snapshots and tests; grep the tests for "and \d more".

### 11. Dead: `ClaudeSession.commands` is written but never read, and `void this.signal;` does nothing
- category: dead
- severity: low
- confidence: confirmed
- where: claude.ts:717-718, 1102-1104, 1186-1189; claude.ts:2054
- evidence: `git grep -n "\.commands\b" -- engine/src | grep -v providers/claude.ts | grep -v "commands("` finds only api.ts's own variables. Nothing reads a session's `commands`. Slash commands come from `claude.commands()`, which spawns its own Claude Code (claude.ts:2076-2095). `void this.signal;` in `close()` is a statement with no effect.
- what goes wrong: it suggests the composer reads live commands when it doesn't. And the live list is the cheap source that `agent.commands` could use instead of spawning a second Claude Code (see 16).
- fix: delete the field and both `commands_changed` assignments (keep the early `return` at 1102), or wire it up: let `agent.commands` read a live session's list. Delete `void this.signal;`.
- effort: S
- risk of the fix: none.

### 12. On `codex exec`, a sidekick may still send its own agents; the app server turns them off
- category: bug
- severity: low
- confidence: confirmed (code); low impact, since exec is only for a Codex without the app server
- where: codex.ts:113 (new today) vs codex-server.ts:385
- evidence:
  ```ts
  // codex.ts
  if (o.scan) common.push("-c", "agents.enabled=false", "-c", "features.multi_agent=false", "-c", `web_search="disabled"`);
  // codex-server.ts
  const alone = this.o.sidekick || this.o.scan ? { "agents.enabled": false, "features.multi_agent": false } : {};
  ```
- what goes wrong: a pair whose sidekick runs on an old Codex can fan out agents nobody sees, which types.ts:179 ("sends no agents of its own") rules out.
- fix: `if (o.sidekick || o.scan)` for the two agents keys; web search for scan only.
- effort: S
- risk of the fix: none.

### 13. (new today) A scan's "no web, no spawning" is applied silently only to Claude Code, Codex and OpenCode
- category: ux
- severity: low
- confidence: likely (that Hermes runs its web and delegate tools without asking is taken from acp.ts's own comment at 1306: "Hermes asks only about commands and edits")
- where: types.ts:172-176 (OpenOptions.scan); acp.ts:2254 (only `isOpenCode` uses `o.scan`); acp.ts:1334 (the Read only refusal covers only agents with `levels` or OpenCode)
- evidence: `o.scan` appears in acp.ts only in `opencodeEnv(..., o.scan ? OPENCODE_SCAN_DENIED : [])`.
- what goes wrong: a Liner Security scan run on Hermes, Cursor, Grok or Antigravity can still fetch from the web and send off subagents (Hermes's `delegate_task` comes unasked), so a prompt injection in the repo can reach out. Nothing on the timeline or the scan says the limits didn't apply. types.ts does say "where the tool lets them be", so it's a known limit, but the person isn't told.
- fix: when `o.scan` is set and the tool is neither Claude Code, Codex nor OpenCode, push one notice at open: "<tool> can't be kept from the web or its own agents during a scan". Or offer scans only on tools that honour it, as `sealable` does for Specialist scans.
- effort: S
- risk of the fix: none.

### 14. Per-session maps that only grow
- category: perf
- severity: low
- confidence: confirmed (no `delete`/`clear`, checked with grep)
- where:
  - codex-server.ts:320 `changes` (set at 685, never deleted).
  - claude.ts:682 `tools`: an entry per tool call for the session's life. `input` is cleared only when a result comes (1305), so a stopped or unreturned Write keeps its whole content.
  - claude.ts:728 `hushed`: cleared only in `lost()`.
  - codex-server.ts:327 `stale`: an id whose late `turn/completed` never comes stays.
- what goes wrong: memory grows with session length; small for most sessions, large for a long Claude session with big Writes that were stopped.
- fix: delete `changes` on `item/completed` once the approval can't come any more (or keep only the last 200). In claude.ts, clear `input` on stop and trim `tools` to the ids still referenced by `runs`/`tasks` at the end of each turn.
- effort: S
- risk of the fix: a late task_notification needs `tools.get(toolUseId)?.name` (1406). Keep name-only entries, or cap them (last 500).

### 15. Codex app server re-copies a running command's 20 KB tail on every output delta
- category: perf
- severity: low
- confidence: confirmed
- where: codex-server.ts:756; compare acp.ts:1498-1505, which cuts back only at twice the cap
- evidence: `out.text = (out.text + String(p.delta ?? "")).slice(-20000);`
- what goes wrong: a chatty build (thousands of small deltas) flattens and copies a 20 KB string per delta, on the engine thread, while the row itself updates only every 250 ms.
- fix: append, and cut to the last 20000 only when the length passes 40000, as ACP's `terminal()` does. The 250 ms timer still sends the last 20000.
- effort: S
- risk of the fix: none (the row already shows only the tail).

### 16. claude.ts: `probe()` and `commands()` are the same throwaway query twice, both bypass the `sdk` test seam, and their timeouts are never cleared
- category: refactor
- severity: low
- confidence: confirmed
- where: claude.ts:381-395 and 2076-2095; the same uncleared-timer pattern in codex-server.ts:127 (codexAsk, 20 s)
- evidence: both build `idle()` + `query({ prompt: idle(), options: {...} })` and race a `setTimeout(..., 30000)` that is never cleared. Both call `query` directly while the session uses `sdk.query` (claude.ts:39, "so tests can stand in a Claude Code of their own").
- what goes wrong: listing models, limits and commands can't be faked in tests, and each call leaves a 30 s (codexAsk: 20 s) timer that holds its closure. Combined with 11, every 5-minute command refresh starts a full Claude Code with the person's MCP servers.
- fix: one `probe(env, cwd, sources, ask)` on `sdk.query` that clears its timer in `finally`, used by `listModels`, `limits` and `commands`. Same `clearTimeout` in `codexAsk`.
- effort: S
- risk of the fix: none.

### 17. (new today) claude.ts builds `disallowedTools` twice: the `sealed` overlay repeats the main expression and replaces it
- category: refactor
- severity: low
- confidence: confirmed
- where: claude.ts:795 and 809
- evidence:
  ```ts
  const sealed = o.sealed && !o.plain ? { ..., disallowedTools: [...(o.side ? SIDE_DENIED : o.sidekick ? ["Task", "Agent", "Workflow"] : []), ...(o.scan ? SCAN_DENIED : []), "Skill"] } : {};
  ...
  disallowedTools: o.side || o.sidekick || o.scan ? [...new Set([...(o.side ? SIDE_DENIED : o.sidekick ? [...] : []), ...(o.scan ? SCAN_DENIED : [])])] : undefined,
  ```
- what goes wrong: the next tool added to the side, sidekick or scan list must be added in two places, or a sealed scan silently gets the old list (sealed wins, since it's spread later).
- fix: compute `const denied = [...]` once, then use `disallowedTools: denied.length ? denied : undefined` and `sealed: { disallowedTools: [...denied, "Skill"] }`.
- effort: S
- risk of the fix: none; the audit-claude tests check the options.

### 18. ACP `update()` and `setAccess()` wait without limit on Antigravity's mode switch
- category: bug
- severity: low
- confidence: suspected (needs an agy that never answers `session/set_mode`; whether the runtime races this await with Stop wasn't traced)
- where: acp.ts:1864-1868 and 1896-1899; request() at 892-902 has no timeout; runtime.ts:719 awaits `update` with only `.catch`
- evidence: `if (this.levels) await switching;`, then `toMode`, then `toLevel`, then `setMode`, then `this.request(...)`, which never times out.
- what goes wrong: if agy stalls on a mode or effort switch between turns, the next turn hangs before it starts, outside the prompt's Stop and quiet-watchdog handling (those start in `turn()`).
- fix: bound these two awaits (e.g. 10 s, as claude.ts does with `waits.settle`). On timeout, return false from `update()` so the runtime reopens.
- effort: S
- risk of the fix: a slow but working switch now reopens the session (it resumes, so nothing is lost).

---

## In good shape
- Stop and end-of-turn, per provider: each ends a turn once. `codex exec` sends SIGINT then SIGKILL after 3 s. The app server ignores stale turns and their late events (`stale`, `early`). ACP waits 15 s after `session/cancel`, then closes, with `answered` stopping a late close. Claude interrupts, and lets go after 4 s with `draining`. Every listener and timer added for a turn is removed in that turn's `finally` (checked codex.ts:202-213, codex-server.ts:500-523, acp.ts:1747-1757, claude.ts:1674-1694).
- Child processes: ACP agents and probes run in their own process group (`detached: true`), with the group killed after the agent exits (acp.ts:979-996), and marker-based ending for agy. Pending requests are failed per child, so a late close can't fail the next process's requests. A spawn failure ("folder gone") gives an error rather than a hang, in both JSON-RPC clients.
- Bounded buffers: stderr tails are 4000 characters everywhere; tool output is capped at 20000; Claude's command tail reads the last 256 KB of the file.
- Permissions: the ACP Read only refusal, `inFolder` following symlinks, the git-directory guard, rules that never come from `other`, Liner's own tools allowed only when the call carries nothing else, and Codex `permissions` entries shown in full. No hole found beyond 4 (which is too strict, not too loose) and 13.
- models.ts and added.ts: the registry is cached for a day; Codex's models come from its catalog with the configured model first; agy's list is cached for 60 s; api.ts caches the models per tool version for 12 h; no blocking call at module load. Claude's FALLBACK ids are current and used only until the real list comes.
- plain.ts: keys never follow redirects, and service errors are cleaned of the key. opencode-go.ts: read-only sqlite with a busy timeout. attachments.ts: size-capped reads.
- demo.ts and demo-canvas.ts: `wait()` clears its timer and listener; Stop rejects at once; no bug found.
- Routines: none of this code is Routines.

## Not done
- Did not run any test file. All findings are from reading.
- Did not trace runtime.ts's handling of `update()` against Stop (18), or how a scan picks its tool (13), beyond `sealable`.
- Did not read demo-canvas.ts past its timers and abort handling.
- Did not check whether `codex exec` (the path for a Codex without the app server) is still needed by any supported Codex version. If not, codex.ts:78-246 could go; worth asking the owner.
