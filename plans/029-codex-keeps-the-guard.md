# 029. The destructive-command guard holds on Codex at Full access, as it does on Claude and ACP

**Commit message:** `Full access on Codex still asks before a command that can't be undone, while the guard is on`

Written by the advisor on 2026-11-20 against commit `bfb0ebc` (branch `design-and-api-endpoints`, Liner Code 0.3.0 beta).
Refreshed 2026-11-20 at 13c7757 after the advisor's review (engine/src is unchanged since bfb0ebc, so the line numbers hold).
Finding: PROV-01. The code's gap is certain; what a real Codex hands over under each policy is owed to a real-Codex run (the owner's gate).

## What the review changed

- The old plan guessed that Liner's handler "likely auto-approves" at Full. It doesn't. `onRequest` brings every command Codex hands over to `sink.approve` (`codex-server.ts:1152-1170`). `runtime.approve` has no Full auto-allow (`runtime.ts:3557-3660`), so each one becomes a card today. The whole gap is that Codex at `danger-full-access` + `on-request` hands nothing over.
- So the fix is decided, not left to an investigation:
  - Full **plus guard** uses approval policy `untrusted`, with the sandbox unchanged.
  - The driver itself accepts non-destructive commands and file changes at Full, as `acp.ts:1453-1458` does.
  - Without the driver-side accept, `untrusted` would card every command.
- The failing-first assertion is **the policy sent**: the `full` row of `engine/test/codex-access.test.ts`, whose sessions open with `guard: true`. The old "destructive → card" test already passes before the fix.
- The `codex exec` path can't be guarded. `approval_policy="never"`, and command items arrive only once the command has started. It stays a said exception.
- The real-Codex run is the owner's gate before release. The executor does not start a real Codex.
- Does this need a model server? No. App-server approvals are Codex's own JSON-RPC protocol; Liner already answers them under `untrusted` for Edits and Review (`codex-server.ts:32,34`).

## Why this matters

The promise is cross-tool, in three places:
- `contracts/src/index.ts:36`: "full (acts, and tells you; destructive commands still ask while the guard is on)".
- `SECURITY_MODEL.md:71`: "risk.ts marks destructive commands as high risk, and Full access still asks about irreversible steps."
- `ui/src/app/Settings.tsx:2361`: "Even in Full access: force pushes, rm -rf, sudo, publishing. They come back to you as a request."

The guard is on by default: `guardDestructive: true`, `engine/src/store.ts:81`, read at open in `runtime.ts:707`.

Two drivers keep it:
- Claude (`engine/src/providers/claude.ts:882`): `if (this.access === "full" && !forced && !(this.o.guard && isDestructive(command))) return { behavior: "allow", … };`
- ACP (`engine/src/providers/acp.ts:1453-1458`): `free = this.o.access === "full" || …`; `if (free && !(this.o.guard && isDestructive(command))) { …allow… }`

Codex doesn't. Neither Codex file reads `o.guard` or calls `isDestructive`:
- `codex-server.ts:35`: `full: { sandbox: "danger-full-access", approval: "on-request" }`. With nothing outside the sandbox to escalate for, Codex has no reason to ask, so a `rm -rf`, a `git reset --hard` or a force-push runs without the ask the setting promises.
- `codex.ts:26,102`: exec runs `sandbox_mode="danger-full-access"` with `approval_policy="never"` and never asks at all.

`isDestructive` is `commandRisk(command) === "high"` (`engine/src/risk.ts:1558`). `commandRisk` is already imported in codex-server.ts (:19).

## Current state (drift check)

```bash
git log --oneline -1                                   # 13c7757 or later
git diff 13c7757 -- engine/src/providers engine/src/runtime.ts | head   # expect nothing
sed -n '26,26p;83,98p;102,102p' engine/src/providers/codex.ts  # SANDBOX.full; the once-notice field `told`; approval never
sed -n '29,36p;415,415p;496,496p' engine/src/providers/codex-server.ts  # POLICY and its two readers (thread start/resume)
sed -n '626,633p' engine/src/providers/codex-server.ts # setAccess: a raised level goes by Liner's answers mid-turn
sed -n '1138,1185p' engine/src/providers/codex-server.ts # onRequest: the stale guard, then command and file-change asks
sed -n '880,884p' engine/src/providers/claude.ts       # the guard exemplar
sed -n '1453,1458p' engine/src/providers/acp.ts        # the ACP guard and Full's accept
grep -n "guard\|isDestructive" engine/src/providers/codex*.ts   # expect: nothing
sed -n '78,99p' engine/test/codex-access.test.ts       # WANT, the access table (plan 009's tripwire)
```

## Rules

- Never run a formatter; do not re-wrap or re-indent unchanged lines. Comments are plain sentences that say why.
- Do not touch `ui/src/liner/**`, Routines, `mac/`, the Demo provider, `CHANGELOG.md`, the untracked folders.
- Every fix comes with a test that fails without it, written first and seen failing. Fake Codex: `script()`,
  `CODEX`, `opts()` and `recorder()` in `engine/test/codex-access.test.ts`. `opts()` defaults to `guard: true`.
  Test commands need `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID node --test <file>`.
- Do not start a real Codex. The release rules' real-Codex run against a fake local API (CLAUDE.md, "Before a release")
  is the owner's gate for this change. Record it as owed.
- One local commit, the message above. Never push.

## Steps

### 1. Full plus guard asks Codex to hand commands over (`untrusted`)

In codex-server.ts, replace the two direct `POLICY[this.o.access]` reads (:415, :496) with one small function:

```ts
const policyOf = (access: Access, guard: boolean) => (access === "full" && guard ? { ...POLICY.full, approval: "untrusted" } : POLICY[access]);
```

- The sandbox stays `danger-full-access` and Full without the guard stays `on-request`, exactly as today.
- One comment: at full access Codex has nothing to escalate for and hands no command over, so the guard can only see a command when Codex asks before everything it doesn't trust. Liner then lets through all but what can't be undone (onRequest).
- Update the file's header bullet for `full` (:11) to say the same in one line.
- Mid-turn (`setAccess`, :630): the policy goes with the turn as it started, and Liner's answers follow the new level. Leave that as it is.

**Test first** (`engine/test/codex-access.test.ts`):
- Change WANT's `full` row deliberately to `approval: "untrusted"` (the sessions there open with `guard: true`), and write in the note that the access table changed.
- Add one test: `access: "full", guard: false` still sends `on-request` in both `thread/start` and `turn/start`.

The changed row fails before the fix (it gets `on-request`), for exactly the reason the plan exists.
**Verify:** `node --test engine/test/codex-access.test.ts`, `npm run typecheck`.

### 2. The driver lets through at Full what the guard doesn't stop

In `onRequest` (codex-server.ts:1138-1185), after the stale/no-sink block (:1144-1151), which stays first, add Full's accept in each approval branch, mirroring acp.ts:1453-1458.

- **Commands** (`item/commandExecution/requestApproval`, `execCommandApproval`): when `this.o.access === "full"`, `!extra` (no network host and no extra access asked), and `!(this.o.guard && isDestructive(command))`, return the accept in the method's own shape. That is `{ decision: "approved" }` for `execCommandApproval` and `{ decision: "accept" }` otherwise, the shapes at :1170.
  - A destructive command under the guard goes on to `sink.approve` as today: a card with `risk: "high"`, which no rule or turn grant can pass (runtime.ts:3579, :3636).
  - An `extra` ask also goes to a card as today.
- **File changes** (`item/fileChange/requestApproval`, `applyPatchApproval`): at Full, accept in the method's shape (`{ decision: "approved" }` / `{ decision: "accept" }`, :1182). Edits are not commands, and ACP's `free` at Full covers them.
- Import `isDestructive` from `../risk.ts` beside `commandRisk`.
- One comment at the command branch: Full acts, except where the guard says the step can't be undone (claude.ts:881's words).

**Test first** (`engine/test/codex-access.test.ts`):
- A fake whose `turn/start` sends, as a server request with an id, `item/commandExecution/requestApproval` for `rm -rf build`, then one for `ls -la`, then an `item/fileChange/requestApproval`. It logs Liner's replies (the log already holds every line it reads).
- The recorder's `approve` counts calls and allows.
- At `access: "full", guard: true`: one `approve` call (for `rm -rf build`), and `ls -la` and the file change answered `accept` with no `approve` call.
- At `guard: false`: zero `approve` calls, all three accepted.

It fails before, for the stated reason: today all three go to `sink.approve`, so the count is 3. The real guard failure (Codex never asking) is pinned by step 1.
**Verify:** the tests, `node --test engine/test/codex-access.test.ts engine/test/drivers.test.ts engine/test/carry-on-why.test.ts`, `npm run typecheck`.

### 3. The exec path: a said exception, not a silent hole

`codex exec` cannot stop to ask: `approval_policy="never"` (codex.ts:102), and a command's `item.started` arrives as it runs. Full plus guard can't be enforced there. The driver already prefers the app server (`appServerFor`, codex.ts:24); exec is the older-Codex fallback.

- When a session runs Full with the guard through exec, say it once per session with `sink.notice`. Use a field of its own beside `told` (codex.ts:83), not `told` itself, which is the read-only notice's. The words: "This Codex can't stop to ask, so the guard on commands that can't be undone doesn't hold on it. Update Codex to get its app server."
- Do NOT map Full to read-only on exec: that would silently break Full's meaning.
- Draft, in the note, the doc wording for `SECURITY_MODEL.md:71` and the Settings note (Settings.tsx:2361): the guard holds on Codex's app server, and an older Codex without one says it can't. Do not change either text in this plan without the owner's yes; record it as owed.

**Test first** (`engine/test/drivers.test.ts`, the exec access test at :990-1026). Its `sandbox(access)` helper runs two turns, and `opts()` (:375) defaults to `guard: true`.
- The existing `sandbox("full")` assertion (:1025, which expects `notices: []`) changes deliberately: the sandbox is the same, with one notice matching `/guard/`, said once across both turns.
- Let the helper take `guard`, and add `sandbox("full", false)` → no notice.

The changed line fails before (no notice). Record the change in the note.
**Verify:** the tests, `node --test engine/test/drivers.test.ts`, `npm run typecheck`.

## Done

- Steps 1-3 tests fail before and pass after; codex-access.test.ts's `full` row deliberately updated and recorded;
  `npm run typecheck` exits 0; the whole engine suite (`npm test -w engine`, or `npm run test:steady -w engine`) passes,
  since several tests run Codex sessions at Full (`engine/test/stop-grace.test.ts:250`, `readonly.test.ts:192`).
- One commit, the message above. Executor note:
  - the policy choice and why;
  - the exec exception and its doc wording, owed to the owner;
  - "real-Codex run owed (owner's gate)". The run must check three things:
    - that Codex at `danger-full-access` + `untrusted` asks before `rm -rf` on a temp fixture, a `git reset --hard`, and a force-push to a local bare remote;
    - that it does not ask before read-only commands it trusts;
    - whether Codex's own "dangerous command" check already prompts for some of these under `on-request` (not verified in this repo).

## STOP conditions

- A cited region's substance changed: stop that step, report.
- `untrusted` turns out (from Codex's protocol types or a run the owner did) to refuse rather than ask under `danger-full-access`, or to stop Full's ordinary flow: stop, report. The fallback, the documented exception of step 3 applied to both paths, is the owner's decision.
- A real Codex run would need a real account or a destructive command outside a temp fixture: do not do it.

## Maintenance note

The guard is now a cross-tool contract enforced in three drivers; codex-access.test.ts's access table and the Full
accept test are its tripwires. A new driver copies claude's line. If Codex changes which commands `untrusted` hands
over, the owner's real-Codex check is the pattern for re-proving it (the ROADMAP's "re-prove access levels when a
tool updates" direction).
