# 029. The destructive-command guard holds on Codex at Full access, as it does on Claude and ACP

**Commit message:** `Full access on Codex still asks before a command that can't be undone, while the guard is on`

Written by the advisor on 2026-11-20 against commit `bfb0ebc` (branch `design-and-api-endpoints`, Liner Code 0.3.0 beta).
Finding: PROV-01 (MED confidence — the code absence is certain; what Codex itself hands over needs a real-tool check).
Every excerpt below is from the advisor's own read.

## Why this matters

The promise is cross-tool, in three places:
- `contracts/src/index.ts:36`: "full (acts, and tells you; destructive commands still ask while the guard is on)".
- `SECURITY_MODEL.md:71`: "risk.ts marks destructive commands as high risk, and Full access still asks about irreversible steps."
- `ui/src/app/Settings.tsx:2360`: "Even in Full access: force pushes, rm -rf, sudo, publishing. They come back to you as a request."

Two drivers keep it:
- Claude (`engine/src/providers/claude.ts:882`): `if (this.access === "full" && !forced && !(this.o.guard && isDestructive(command))) return { behavior: "allow", … };`
- ACP (`engine/src/providers/acp.ts:1455`): `if (free && !(this.o.guard && isDestructive(command))) { … }`

Codex does not read `o.guard` or call `isDestructive` anywhere (grep confirms: only claude.ts and acp.ts do):
- `engine/src/providers/codex.ts:26`: `full: "danger-full-access"`; the exec path runs `approval_policy="never"` (:102) —
  it never asks at all.
- `engine/src/providers/codex-server.ts:35`: `full: { sandbox: "danger-full-access", approval: "on-request" }` — the app
  server only asks for what CODEX itself judges risky; Liner's `isDestructive` backstop is silently absent.

So with the guard on, a Codex session at Full access can run `rm -rf …`, `git reset --hard`, a force-push without the
deterministic ask the setting promises. `isDestructive` is `commandRisk(command) === "high"` (`engine/src/risk.ts:1558`).

## Current state (drift check)

```bash
git log --oneline -1                                  # bfb0ebc or later
sed -n '26,26p;100,104p' engine/src/providers/codex.ts # SANDBOX.full; exec's approval never
sed -n '29,36p' engine/src/providers/codex-server.ts  # POLICY
sed -n '880,884p' engine/src/providers/claude.ts      # the guard exemplar
sed -n '1453,1457p' engine/src/providers/acp.ts       # the ACP guard
grep -n "guard\|isDestructive" engine/src/providers/codex*.ts   # expect: nothing
grep -n "execCommandApproval\|applyPatchApproval\|command\|approval" engine/src/providers/codex-server.ts | head -30
```

## Rules

- Never run a formatter; do not re-wrap or re-indent unchanged lines. Comments are plain sentences that say why.
- Do not touch `ui/src/liner/**`, Routines, `mac/`, the Demo provider, `CHANGELOG.md`, the untracked folders.
- Every fix comes with a test that fails without it, written first. Fake-Codex pattern: `engine/test/drivers.test.ts`
  and the Codex tests (grep `codex` in engine/test; plan 009 pinned the access table — keep that test green).
- This changes an approval path: the release rules' REAL-CODEX run is required before shipping (CLAUDE.md). The plan
  has an investigate step that must run against a real Codex if one is installed; if none is, the fix lands with the
  fake tests and the real-tool check is recorded as owed — do not claim it was run.
- One local commit, the message above. Never push.

## Steps

### 1. Investigate: what does Codex hand over at Full?

Read the app-server's approval handlers (the drift-check grep finds them: the JSON-RPC requests for exec command and
applyPatch approval). Answer, from the code and (if available) a real Codex against a fake local API:
- At `danger-full-access` + `on-request`, which commands does Codex send for approval? (Codex's own risk judgment —
  possibly none for ordinary destructive commands, which is the hole.)
- Where does Liner's handler auto-approve at Full? (The gap: it likely allows everything the tool asks about, or the
  tool never asks.)
Record the answer in the executor note. If a real Codex is installed, run it against a fake local API (the release
rules' pattern) with a harmless-but-destructive-shaped command (`rm -rf` on a temp fixture) and observe whether an
approval request arrives. NEVER run a real destructive command outside a temp fixture.

### 2. Enforce the guard in the app-server path

Mirror claude's rule in the app-server's command-approval handler:
- When `o.access === "full"` and `o.guard` and `isDestructive(command)`: do NOT auto-approve — bring the command to
  the person as Liner's approval card (the same path the ask level uses; read how the handler surfaces a card and
  reuse it). The person's yes goes back as the approval; a no refuses.
- Non-destructive commands at Full stay auto-approved (Full's meaning is unchanged).
- If Codex at `danger-full-access` + `on-request` never hands destructive commands over (step 1's finding), the
  policy must change so it does: Full WITH guard → an approval policy that hands commands to Liner (e.g. `untrusted`,
  which asks for everything not trusted), and Liner's handler auto-approves the non-destructive ones. Full WITHOUT
  guard stays `danger-full-access` + `on-request` as today. Choose the policy from step 1's evidence, comment why,
  and keep plan 009's access-table test green (update it deliberately if the table changes — the test pins the
  contract, so a change to it is a decision, recorded in the note).
- applyPatch at Full: edits are not commands; the guard is about irreversible COMMANDS. Leave edits as they are
  unless step 1 shows Codex routes destructive shell through applyPatch (it does not).

**Test first:** the fake app-server sends a destructive command's approval request at Full+guard → Liner surfaces a
card (the sink/approval spy sees it), and a non-destructive one is allowed without a card; with the guard OFF, both
are allowed. Fails before (both auto-allowed or never asked).
**Verify:** the new tests, plan 009's Codex access-table test, the driver tests, engine typecheck.

### 3. The exec path: a said exception, not a silent hole

`codex exec` cannot stop to ask (approval never; the EDGE-CASES precedent mapped ask/review to read-only there and
SAID so once). Full+guard on exec cannot be enforced the same way. Do the honest minimum:
- When a session runs Full WITH guard through `codex exec` (the older-Codex fallback), say once in the session
  (sink.notice, the file's own once-pattern): this Codex can't stop to ask, so the destructive-command guard can't
  apply on it; update Codex to get the app server. The driver already prefers the app server when it can
  (`appServerFor`) — exec is the fallback.
- Update `SECURITY_MODEL.md`'s risk bullet and the Settings note ONLY if the owner confirms the exception wording
  (the doc must say what is true: the guard holds on the app server; the older exec path says it can't). Draft the
  wording in the note; do not change the Settings UI text in this plan without the owner's yes — record it as owed.
- Do NOT map Full to read-only on exec (that would break Full's meaning silently).

**Test first:** a fake exec session at Full+guard emits the once-notice; at Full without guard, no notice. Fails before.
**Verify:** tests, engine typecheck.

## Done

- Step 1's answer recorded (with the real-Codex observation if one was run, else "owed").
- Steps 2-3 tests fail before and pass after; plan 009's access-table test green (or deliberately updated, recorded);
  engine typecheck exits 0.
- One commit, the message above. Executor note: the policy choice and its evidence, the exec exception, the doc
  wording owed to the owner, the real-tool run status.

## STOP conditions

- Step 1 shows Codex's app-server cannot be made to hand destructive commands to Liner under ANY policy without
  breaking Full's non-destructive flow: stop, report the evidence — the fallback is the documented exception (step 3's
  shape applied to both paths), which is the owner's decision.
- The approval handler's card path is not reachable from the Full branch without restructuring the turn loop: stop,
  report the shape you found.
- A real Codex run would need a real account or a destructive command outside a temp fixture: do not do it.

## Maintenance note

The guard is now a cross-tool contract enforced in three drivers; plan 009's access-table test is its tripwire. A
new driver copies claude's line. If Codex's protocol changes which commands it hands over, step 1's investigation is
the pattern for re-proving it (the ROADMAP's "re-prove access levels when a tool updates" direction).
