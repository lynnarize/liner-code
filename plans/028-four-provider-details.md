# 028. Four provider details: a refusal is an error, Codex's step tokens clamp at zero, the OpenCode prompt map is bounded, and model choices are deduped

**Commit message:** `An ACP refusal reads as an error, Codex's step counts never go negative, and the model picker lists each choice once`

Written by the advisor on 2026-11-20 against commit `bfb0ebc` (branch `design-and-api-endpoints`, Liner Code 0.3.0 beta).
Findings: PROV-04, PROV-05, PROV-07, PROV-08 (all S). Every excerpt below is from the advisor's own read.

## Why this matters

1. **PROV-04.** An ACP turn the model refused ends as a plain NOTICE (`engine/src/providers/acp.ts:1875`:
   `if (r.stopReason === "refusal") sink.notice(this.known.refusal ?? "The agent declined this one.")`). Claude
   (`claude.ts:1425-1431`) and Codex (`codex-server.ts:874-875`) report refusals via `sink.error(…, { why: "refusal" })`.
   The comment two lines above the ACP path even says the intent: "An error, not a notice: this turn didn't do what
   was asked, and a routine's step mustn't read as done." As a notice, the timeline reads the refused turn as done,
   a routine/goal counts the step as success, and the runtime's fallback (which keys off `why === "refusal"`) never
   fires.
2. **PROV-05.** The Codex app-server path reports `inputTokens: step.input - step.cached` with no floor
   (`codex-server.ts:843`); the exec path clamps (`codex.ts:194`: `Math.max(0, (e.usage.input_tokens ?? 0) - cached)`).
   When a report's cached count exceeds its input (a totals rollback), the app-server path reports NEGATIVE input
   tokens, corrupting the thread's usage/cost accounting. The exec guard implies the case is possible.
3. **PROV-07.** `const PROMPTED = new Map<string, number>()` (`acp.ts:393`), keyed by OpenCode session id, written at
   :1817 and never pruned — every OpenCode session ever opened adds an entry for the engine's lifetime. It exists only
   to bound a stopped turn's usage read against the next prompt.
4. **PROV-08.** `acpModels` (`engine/src/providers/models.ts:106`) flattens groups but pushes every option with no
   dedupe and no empty-value filter; `acpModelRequest` (:180) returns null for an empty model, so an empty-valued
   default is an unselectable "" entry in the picker. The remainder of EDGE-CASES case 111 (groups flattened;
   dedupe/empty still open).

## Current state (drift check)

```bash
git log --oneline -1                                  # bfb0ebc or later
sed -n '1871,1878p' engine/src/providers/acp.ts       # the refusal notice and its neighbours
sed -n '1425,1431p' engine/src/providers/claude.ts    # the refusal exemplar
sed -n '872,877p' engine/src/providers/codex-server.ts # codex's refusal exemplar
sed -n '843,843p' engine/src/providers/codex-server.ts # the unclamped subtraction
sed -n '192,195p' engine/src/providers/codex.ts       # the exec clamp
sed -n '393,393p;1815,1818p' engine/src/providers/acp.ts # PROMPTED
grep -n "PROMPTED" engine/src/providers/acp.ts        # every reader (the prune must keep the pending read's entry)
sed -n '100,112p;178,184p' engine/src/providers/models.ts # acpModels and acpModelRequest
```

## Rules

- Never run a formatter; do not re-wrap or re-indent unchanged lines. Comments are plain sentences that say why.
- Do not touch `ui/src/liner/**`, Routines, `mac/`, the Demo provider, `CHANGELOG.md`, the untracked folders.
- Every fix comes with a test that fails without it, written first. Fake-ACP pattern: `engine/test/polish-providers.test.ts`
  and `engine/test/drivers.test.ts` (grep `stopReason`/`acp` for the existing fakes). Test commands need
  `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID`.
- One local commit, the message above. Never push. Steps independent.
- These are provider drivers: the release rules' real-tool run applies before a release ships them (CLAUDE.md).
  The tests use fakes; note what only a real tool can confirm.

## Steps

### 1. An ACP refusal is an error (PROV-04)

In `acp.ts:1875`: route `stopReason === "refusal"` to `sink.error(this.known.refusal ?? "The agent declined this one.", { why: "refusal" })`,
matching claude/codex-server. Keep the streamed words where they are (the error doesn't repeat them — claude's
comment at :1427-1428 says the rule). Leave the `failedWords` heuristic (:1877-1878, Antigravity's quota words) as a
notice for now, and record the owner question in the note: agy's used-up quota arguably reads better as a limit
(`sink.limited`) so carry-on can offer another tool — that is a product decision, not this plan's.
Do not change `max_tokens`' notice or the cut path.

**Test first:** a fake ACP turn ending with `stopReason: "refusal"` → the sink records an ERROR with why "refusal"
(not a notice), and the runtime's fallback sees it (the existing refusal-fallback test pattern — grep `refusal` in
engine/test). Fails before.
**Verify:** the new test, the ACP/driver tests, engine typecheck.

### 2. Codex's step input clamps at zero (PROV-05)

In `codex-server.ts:843`: `inputTokens: Math.max(0, step.input - step.cached)` — the exec path's guard, one comment
saying why (a report's cached can exceed its input on a rollback; the exec path already clamps).

**Test first:** feed the app-server fake a token report with cached > input → the step's inputTokens is 0, never
negative; the thread's usage totals stay sane. Fails before.
**Verify:** tests, engine typecheck.

### 3. The PROMPTED map is bounded (PROV-07)

Read every `PROMPTED` reader (the drift-check grep): the entry bounds a stopped turn's usage read
(`opencodeTurnUsage`). Delete the session's entry once that read is DONE (in the read's finally, or where its result
is applied) — not before, or a late count loses its bound. If a session is closed/removed (grep the close path),
delete its entry there too. Keep the map's purpose comment; extend it one sentence: the entry goes when its read does.

**Test first:** a fake OpenCode session whose stopped-turn usage read completes → PROMPTED no longer holds its entry
(export a test seam if the map is module-private — the file already has timing seams, e.g. `setOpencodeUsageMs`;
follow that pattern, or assert via the observable behaviour the map exists for: a second stopped turn's read is not
bounded by the first session's prompt time). Fails before (the entry stays).
**Verify:** tests, the OpenCode usage tests, engine typecheck.

### 4. Model choices are deduped and non-empty (PROV-08)

In `models.ts`'s `acpModels` (:106): after the flatMap, filter out options with an empty `value` and dedupe by id
(first wins — the default marking stays on the first). One comment: an agent's select can list a value twice or an
empty one; the picker shows each choice once, and an empty value is unselectable (acpModelRequest returns null for
it). Do not change the `default` entry's shape or the availableModels path unless it has the same hole (read it; if
it does, fix it the same way and say so).

**Test first:** a fake session config with grouped options holding a duplicate value and an empty value → the model
list has each id once and no "" entry; the default marking survives. Fails before.
**Verify:** tests, the models tests, engine typecheck.

## Done

- All four tests fail before and pass after; the named existing tests pass; `npm run typecheck` exits 0.
- One commit, the message above. Executor note: commit, the agy-quota owner question, what only a real tool can
  confirm (refusal wording per agent, Codex's rollback reports), any STOP.

## STOP conditions

- A cited region's substance changed: stop that step, report.
- Step 3: the PROMPTED readers cannot be enumerated safely (a reader the grep misses would lose its bound): stop,
  report the reader list you found.
- Step 1: an ACP agent's refusal legitimately ends a routine step as success by design (read the routine gate —
  routines are off, but the runtime's goal logic is live): the error classification is still right; if the goal
  logic treats refusal-errors as retryable loops, report it, do not change the goal logic here.

## Maintenance note

The drivers now classify refusals the same way; a new driver copies claude's shape. The usage clamps are paired
(exec and app-server) — a change to one checks the other. The PROMPTED prune is tied to the usage read's lifecycle;
if that read changes, the prune moves with it.
