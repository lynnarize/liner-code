# 028. Four provider details: an ACP refusal is an error, Codex's step tokens clamp at zero, the OpenCode prompt map is bounded, and model choices are deduped

**Commit message:** `An ACP refusal reads as an error, Codex's step counts never go negative, and the model picker lists each choice once`

Written by the advisor on 2026-11-20 against commit `bfb0ebc` (branch `design-and-api-endpoints`, Liner Code 0.3.0 beta).
Refreshed 2026-11-20 at 13c7757 after the advisor's review (engine/src is unchanged since bfb0ebc, so the line numbers hold).
Findings: PROV-04, PROV-05, PROV-07, PROV-08 (all S).

## What the review changed

- Step 1 now applies only to ACP agents **without** a `known.refusal`. For Antigravity, `stopReason: "refusal"` is a used-up quota (`acp.ts:2495`), pinned as a notice by `engine/test/antigravity.test.ts:751`, and it stays exactly as it is. Making it `why: "refusal"` would block Carry on for a quota.
- PROV-04's claim that "the fallback never fires" was wrong. A refusal never offers another tool, and `carryOn` refuses after one (`runtime.ts:3200`, `:3766-3770`). The test now asserts exactly that: Carry on refuses after an ACP refusal.
- The comment the old plan quoted ("An error, not a notice…", `acp.ts:1871`) is about `cut`, not refusals. That citation is dropped.
- Step 3 deletes the `PROMPTED` entry only if it still holds this read's `since`. Otherwise two reads that finish out of order lose the bound.
- Step 2 reuses the fake app server in `engine/test/codex-access.test.ts`. Step 1 reuses `acpProvider("acp.fake", …)` from `engine/test/polish-providers.test.ts:90-97` and the runtime pattern in `engine/test/carry-on-why.test.ts:72-112`.

## Why this matters

1. **PROV-04.** An ACP turn that ends with `stopReason: "refusal"` is reported as a notice (`engine/src/providers/acp.ts:1874`: `if (r.stopReason === "refusal") sink.notice(this.known.refusal ?? "The agent declined this one.")`). Claude (`claude.ts:1425-1431`) and Codex (`codex-server.ts:874-875`, `codexWhy` at :115-127) report refusals with `sink.error(…, { why: "refusal" })`. The runtime then marks the thread as errored, offers no other tool, and `carryOn` refuses. For an agent with no refusal words of its own, the notice leaves the turn reading as done.
2. **PROV-05.** The Codex app-server path reports `inputTokens: step.input - step.cached` with no floor (`codex-server.ts:843`). The exec path clamps (`codex.ts:194`: `Math.max(0, (e.usage.input_tokens ?? 0) - cached)`). A report whose cached count exceeds its input count (the `last` fallback at :838-840) gives a negative step.
3. **PROV-07.** `const PROMPTED = new Map<string, number>()` (`acp.ts:393`) is keyed by OpenCode session id. It is written at :1817, read only at :1860 (the `next` bound passed to `opencodeTurnUsage`), and never pruned. It is small, but it grows for the engine's life.
4. **PROV-08.** `acpModels` (`engine/src/providers/models.ts:106`) flattens groups but pushes every option with no dedupe and no empty-value filter. An empty value can't be picked (`acpModelRequest`, :180, returns null for it). The `availableModels` branch (:110) has the same lack of dedupe.

## Current state (drift check)

```bash
git log --oneline -1                                  # 13c7757 or later
git diff 13c7757 -- engine/src/providers | head       # expect nothing
sed -n '1870,1878p' engine/src/providers/acp.ts       # cut's error, the refusal notice, agy's failedWords, max_tokens
sed -n '2493,2496p' engine/src/providers/acp.ts       # Antigravity's spec: refusal is its quota
sed -n '1425,1431p' engine/src/providers/claude.ts    # the refusal exemplar
sed -n '3198,3200p;3764,3771p' engine/src/runtime.ts  # carryOn refuses after a refusal; a refusal offers no fallback
sed -n '836,843p' engine/src/providers/codex-server.ts # the step and the unclamped subtraction
sed -n '192,195p' engine/src/providers/codex.ts       # the exec clamp
grep -n "PROMPTED" engine/src/providers/acp.ts        # expect exactly :393, :1817, :1860
sed -n '100,113p;178,185p' engine/src/providers/models.ts # acpModels and acpModelRequest
```

## Rules

- Never run a formatter; do not re-wrap or re-indent unchanged lines. Comments are plain sentences that say why.
- Do not touch `ui/src/liner/**`, Routines, `mac/`, the Demo provider, `CHANGELOG.md`, the untracked folders.
- Every fix comes with a test that fails without it, written first and seen failing. Test commands need
  `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID node --test <file>`.
- One local commit, the message above. Never push. Steps are independent.
- These are provider drivers: the release rules' real-tool run applies before a release ships them (CLAUDE.md).
  The tests use fakes; note what only a real tool can confirm.

## Steps

### 1. An ACP refusal is an error, except where the agent says what its refusal means (PROV-04)

At `acp.ts:1874`, keep the notice when `this.known.refusal` is set. That is Antigravity's quota, and the agent's own words for it stay a notice, unchanged. Otherwise, call `sink.error("The agent declined this one.", { why: "refusal" })`:

```ts
if (r.stopReason === "refusal") {
  if (this.known.refusal) sink.notice(this.known.refusal);
  else sink.error("The agent declined this one.", { why: "refusal" });
}
```

- Keep the `else if` chain's shape for the `failedWords` line.
- One comment: a refusal is an error as on Claude and Codex, so Carry on won't send it to another tool. An agent whose "refusal" means something else names it in its spec (Antigravity: a used-up quota) and stays a notice.
- Words the turn already streamed stay where they are; the error doesn't repeat them.
- Do not change `max_tokens`' notice, the cut path, or the Antigravity spec.
- Record the owner question in the note: Antigravity's quota arguably reads better as a limit (`sink.limited`), so Carry on can offer another tool. That is a product decision, not this plan's.

**Test first:**
- **(a) The driver.** In `engine/test/polish-providers.test.ts`, use its `script()` and `recorder()` with a generic ACP agent, `acpProvider("acp.fake", { label: "Fake", cmd: [fake.file], login: "" })` (as `acpAsk` does at :90-97). The fake answers `session/prompt` with `{ stopReason: "refusal" }`. Assert the recorder holds one error, "The agent declined this one.", and no notice. If the recorder doesn't keep the `why`, extend it to.
- **(b) The runtime.** In `engine/test/carry-on-why.test.ts`, following the test at :87-112:
  - Widen `fake`'s `id` to include `"opencode"`, an ACP tool, and open the session with `agent: "@opencode:opencode/big-pickle"` (the file's `opencode` info, :26).
  - Its work opens `acpProvider("acp.fake", …)` on the refusal script and runs a turn with the runtime's own sink: `(sink) => s.turn("go", sink, new AbortController().signal)`.
  - Assert the timeline's error has `why: "refusal"` and no `fallback`, and that `runtime.carryOn("t")` rejects with `/refused/`.
- Both fail before: (a) sees a notice, and (b) has no error item, so carryOn doesn't reject for a refusal.
- `antigravity.test.ts:751` must stay green unchanged.

**Verify:** the new tests, `node --test engine/test/antigravity.test.ts engine/test/polish-providers.test.ts engine/test/carry-on-why.test.ts`, `npm run typecheck`.

### 2. Codex's step input clamps at zero (PROV-05)

At `codex-server.ts:843`, use `inputTokens: Math.max(0, step.input - step.cached)`, the exec path's guard. One comment: a report's cached count can exceed its input; the exec path clamps the same (codex.ts:194).

**Test first:** in `engine/test/codex-access.test.ts`, reuse `script("codex", …)` with a `CODEX`-like switch whose `turn/start` also sends `{ method: "thread/tokenUsage/updated", params: { threadId: "t-1", tokenUsage: { total: {}, last: { inputTokens: 10, cachedInputTokens: 40, outputTokens: 5 } } } }`, then `turn/completed`. Give the recorder a `usage` spy. The step's `inputTokens` is 0, never -30. It fails before (it is -30).
**Verify:** the test, `node --test engine/test/codex-access.test.ts engine/test/drivers.test.ts`, `npm run typecheck`.

### 3. The PROMPTED map is bounded (PROV-07)

Its only reader is the `next` bound at `acp.ts:1860`, used while that turn's `opencodeTurnUsage` read runs. Once the read settles, both on the awaited path (`counts(first)`) and on the stopped path (`void reading!.then(counts)`), delete the entry only if it is still this turn's: `if (session && PROMPTED.get(session) === since) PROMPTED.delete(session)`. A newer prompt's entry (a later turn already sent) stays, so an earlier stopped turn's late read keeps its bound, and the later turn removes its own. Put the delete in a `finally` around the read's settle, and extend the map's comment by one sentence: an entry goes when its turn's read is done, and only if no newer prompt replaced it.

**Test first:**
- Export a small read-only seam beside the file's other seams (`setOpencodeUsageMs` at :342): `export const promptedSize = () => PROMPTED.size` (or `promptedHas(id)`).
- Run one OpenCode turn with the existing fake (`opencodeTurn` in `engine/test/providers.test.ts:1559`). After it ends, the entry is gone.
- Run a stopped turn, then send a second prompt before the first read settles (the existing "Stop, then the next message" test shapes in providers.test.ts and polish-providers.test.ts). After the first read settles, the second turn's entry is still there.

It fails before: the entry stays after the first case.
**Verify:** the tests, the OpenCode usage tests in `engine/test/providers.test.ts` and `engine/test/polish-providers.test.ts` (the known timing flake "opencode: Stop, then the next message at once…" runs alone if it fails), `npm run typecheck`.

### 4. Model choices are deduped and non-empty (PROV-08)

In `models.ts`'s `acpModels`:
- After the flatMap (:106), skip options whose `value` is empty, and push an id only once (first wins). Do the same in the `availableModels` branch (:110) for an empty or repeated `modelId`.
- `isDefault` is only used to find `now` (:112) and is stripped from the output (:113), so dedupe keeps the first and nothing else changes.
- One comment: an agent's select can list a value twice (a "recent" group and its provider group) or an empty one, which can't be picked (acpModelRequest returns null for it).

**Test first:** reuse the `acpModels` fake in `engine/test/audit-claude-mcp.test.ts:1184-1210` (an ACP agent answering `session/new` with `configOptions`). Give it grouped options holding the same value twice and one `value: ""`. The list holds each id once and no `""` (beyond the leading `default` entry). It fails before.
**Verify:** the test, the models tests, `npm run typecheck`.

## Done

- All four tests fail before and pass after; `antigravity.test.ts`, `carry-on-why.test.ts` and `codex-access.test.ts` pass unchanged; `npm run typecheck` exits 0.
- One commit, the message above. Executor note: commit, the Antigravity owner question, and what only a real tool can confirm. The open questions:
  - Which ACP agents send `stopReason: "refusal"`. OpenCode 2.3 ends a turn on a person's "No" (acp.ts:302); if it does so with `refusal` rather than `cancelled`, a "No" would read as a refusal error. Check on the real tool, and if so give OpenCode a spec `refusal` like Antigravity's.
  - Codex's rollback reports.
  - Any STOP.

## STOP conditions

- A cited region's substance changed: stop that step, report.
- Step 1: an ACP agent in `engine/src/providers` other than Antigravity is found (from its comments, tests or EDGE-CASES) to send `refusal` for something that is not a refusal: stop, report it, and add its own `refusal` words instead of the error.
- Step 3: a `PROMPTED` reader other than :1860 appears: stop, report the reader list.

## Maintenance note

The drivers classify refusals the same way; a new driver copies claude's shape, and an agent whose `refusal` stop
means something else says so in its spec (`refusal`), as Antigravity does. The usage clamps are paired (exec and
app-server): a change to one checks the other. The PROMPTED prune is tied to the usage read's lifecycle; if that read
changes, the prune moves with it.
