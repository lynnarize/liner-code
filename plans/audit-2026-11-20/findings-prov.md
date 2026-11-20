# Findings — CORRECTNESS: providers & agent-facing tools (PROV)

Repo: /Users/hilmi/Project/Claude/X Apps/Liner Code · branch design-and-api-endpoints · HEAD bfb0ebc
Scope: engine/src/providers/{claude,codex,codex-server,acp,endpoint,models,plain,added,attachments,opencode-go,types}.ts, engine/src/{risk,mcp,agent-tools,liner-tools,outside,outside-tools,exec}.ts. Read-only; no fixes. Playbook format. Reconciliation lists in 00-shared.md honored (F2 duplication, C9–C12, B8/B13/B18/B19, plans 003/004/005 not re-reported).

---

### [PROV-01] Enforce the destructive-command guard on Codex at Full access

- **Evidence**: `engine/src/providers/codex.ts:26,102` — Full maps to `sandbox_mode="danger-full-access"` with `approval_policy="never"`; `engine/src/providers/codex-server.ts:29-36` — `POLICY.full = { sandbox: "danger-full-access", approval: "on-request" }`. Neither file reads `o.guard` or calls `isDestructive` (grep: only `claude.ts:882` and `acp.ts:1455` do). The promise is cross-tool: `contracts/src/index.ts:36` ("full … destructive commands still ask while the guard is on"), `SECURITY_MODEL.md:71`, `ui/src/app/Settings.tsx:2361` ("Always ask before commands that can't be undone").
- **Impact**: With the guard on, a Codex session at Full access runs `rm -rf …`, `git reset --hard`, force-push etc. without the deterministic ask the setting promises. `codex exec` never asks at all (approval never); the app server only asks for what Codex itself judges risky, so Liner's `isDestructive` backstop is silently absent. Claude Code and ACP honour the same setting, so the behaviour is inconsistent per tool.
- **Effort**: M
- **Risk**: MED — forcing destructive commands to ask on Codex means a sandbox/approval change (e.g. keep workspace-write + on-request, or apply `isDestructive` in the exec/app-server approval path); must not break normal Full-access flow. Needs a real-Codex check of which commands it hands over.
- **Confidence**: MED — code absence is certain (HIGH); whether Codex's own on-request already catches every destructive command needs a real-tool run.
- **Fix sketch**: Apply `isDestructive(command)` in the Codex approval paths and, for Full+guard, choose an approval policy/sandbox that hands destructive commands to Liner instead of running them silently; add a test that a destructive command at Full+guard asks on both exec and app-server. Alternatively document the Codex exception explicitly in SECURITY_MODEL.md and the setting (decision-drift fix).

### [PROV-02] Reject plaintext-HTTP remote endpoints before sending the key

- **Evidence**: `engine/src/providers/endpoint.ts:88-93` — `endpointModels` accepts any `^https?://` base and sends `x-api-key`/`authorization: Bearer <key>`; the error text says "http:// for one on this Mac" but nothing restricts http to loopback. `local()` at `:28` (localhost/127.0.0.1/[::1]) is used only for the `signedIn` guess in `detect`, not to gate the key. `plain.ts:38` and `opencode-go.ts:89` likewise fetch the configured URL with the key over whatever scheme it has.
- **Impact**: A user who types `http://api.example.com` (or a typo'd/hostile address) has their API key sent in cleartext over the network, readable by any on-path observer. The UI wording implies http is local-only, so the behaviour contradicts the stated contract.
- **Effort**: S
- **Risk**: LOW — only refuses non-loopback http; local endpoints (LM Studio, Ollama) keep working.
- **Confidence**: HIGH
- **Fix sketch**: In `endpointModels`/`askEndpoint`/endpoint open, allow `http:` only when `local(url)` is true; otherwise throw the "https:// (or http:// on this Mac)" error before any fetch. Test that a remote http URL is refused and a loopback http URL is allowed.

### [PROV-03] Make Claude plan-window utilization units consistent

- **Evidence**: `engine/src/providers/claude.ts:2175` — `limits()` sets `usedPercent: w.utilization` straight from the experimental usage API; `engine/src/providers/claude.ts:88` — `windowOf()` (rate_limit_event path) computes `usedPercent: … info.utilization * 100`, with the comment at `:83` stating utilization is 0–1.
- **Impact**: If the usage API returns the same 0–1 fraction as the rate-limit event, the Settings/composer limit bars from `limits()` show ~0–1% instead of 0–100% (a nearly-empty bar for a nearly-full window), while the mid-turn bars are correct. Two code paths disagree on the unit of the same field.
- **Effort**: S
- **Risk**: LOW — a unit fix; must confirm the SDK's usage-API shape so the correct path is changed.
- **Confidence**: MED — the inconsistency is certain; which unit the experimental API actually returns needs the SDK/real-tool check (no test fakes it; grep of drivers.test.ts found no utilization fixture).
- **Fix sketch**: Confirm the usage API's utilization range, then normalize both paths to percent (multiply the fraction by 100, clamp 0–100). Add a test feeding a 0–1 fraction to `limits()` and asserting a percent bar.

### [PROV-04] Report an ACP refusal as an error, not a notice

- **Evidence**: `engine/src/providers/acp.ts:1874` — `if (r.stopReason === "refusal") sink.notice(this.known.refusal ?? "The agent declined this one.")`. Compare `claude.ts:1425-1431` and `codex-server.ts:874-875`, which report refusals via `sink.error(..., { why: "refusal" })`.
- **Impact**: An ACP turn the model refused ends as a plain notice, so the timeline reads it as done: a routine/goal counts the step as success, and the runtime's fallback-to-another-tool (which keys off `ErrorWhy === "refusal"`) never fires. For Antigravity the refusal is a used-up quota, which should read as a limit/error, not a completed answer.
- **Effort**: S
- **Risk**: LOW — changes how a refused turn is classified; verify agy's quota wording still reads well as an error/limit.
- **Confidence**: MED
- **Fix sketch**: Route `stopReason === "refusal"` to `sink.error` with `why: "refusal"` (or `sink.limited` for the quota case), matching the other drivers; add a test that a refused ACP turn ends as an error and offers fallback.

### [PROV-05] Clamp Codex per-step input tokens at zero

- **Evidence**: `engine/src/providers/codex-server.ts:843` — `sink.usage({ inputTokens: step.input - step.cached, … })` with no floor; `engine/src/providers/codex.ts:194` does `Math.max(0, (e.usage.input_tokens ?? 0) - cached)` for the same subtraction.
- **Impact**: When a Codex report's cached count exceeds its input count (a totals rollback or a version where `last.inputTokens` excludes cache), the app-server path reports negative input tokens for the step, corrupting the thread's usage/cost accounting. The exec path already guards this; the app-server path does not.
- **Effort**: S
- **Risk**: LOW
- **Confidence**: MED — depends on Codex emitting cached > input, which the exec guard implies is possible.
- **Fix sketch**: Wrap the subtraction in `Math.max(0, …)` as codex.ts does; add a test feeding cached > input and asserting a non-negative step.

### [PROV-06] Redact the endpoint key from streamed answers, not only errors

- **Evidence**: `engine/src/providers/plain.ts:27-28` — comment says a service may quote the key "in a refusal or partway through an answer" and defines `clean()`; but `clean` is applied only in the `!r.ok` message (`:54`) and `failure()` (`:62`). The streamed/whole answer text goes through `put()` (`:57-61,72,90,96,103`) with no redaction.
- **Impact**: If an endpoint echoes its key inside a successful answer (the case the comment anticipates), the key reaches the app and is stored on the timeline unredacted, defeating the stated redaction. The error path is protected; the success path is not.
- **Effort**: S
- **Risk**: LOW — redaction only; must not mangle normal text (split/join on the exact key, as `clean` already does).
- **Confidence**: MED
- **Fix sketch**: Run `put()`'s text through `clean()` (buffering enough to catch a key split across deltas, or redacting the accumulated text before it is shown/saved). Test that a key echoed mid-answer is replaced with [key].

### [PROV-07] Bound the module-level OpenCode prompt-time map

- **Evidence**: `engine/src/providers/acp.ts:393` — `const PROMPTED = new Map<string, number>()` keyed by session id; written at `:1817` (`PROMPTED.set(session, since)`) and never pruned. `EXPORTS` (`:396`) and `FAMILIES` (`:2213`) are similarly module-level but bounded by tool/command count.
- **Impact**: Every OpenCode session ever opened in the engine's lifetime adds an entry that is never removed; a long-running engine accumulates them without bound (small, but a genuine leak). The map exists only to bound a stopped turn's usage read against the next prompt.
- **Effort**: S
- **Risk**: LOW — pruning must keep the entry for the session whose stopped-turn count is still being read.
- **Confidence**: HIGH (leak is certain; impact minor)
- **Fix sketch**: Delete a session's entry once its turn's usage read is done (or cap the map to recent sessions / expire entries older than the usage-read window).

### [PROV-08] Deduplicate and drop empty ACP model choices

- **Evidence**: `engine/src/providers/models.ts:106` — `acpModels` flattens groups (`c.options ?? [c]`) but pushes every option with no dedupe and no empty-value filter; `acpModelRequest` (`models.ts:180`) returns null for an empty model, so an empty-valued default is unselectable. This is the remainder of EDGE-CASES.md case 111 (groups now flattened; dedupe/empty still open).
- **Impact**: An agent whose model select lists duplicate values yields duplicate picker entries; an empty-valued choice yields an unselectable "" entry. Cosmetic but confusing in the model picker.
- **Effort**: S
- **Risk**: LOW
- **Confidence**: MED — needs an agent that emits duplicates/empty values (recorded in T3's sessionConfig tests).
- **Fix sketch**: Filter out empty `o.value` and dedupe by id when building `out`; add a test with grouped, duplicate and empty options.