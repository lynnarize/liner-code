# Audit: engine API surface, Liner Design and Liner Security (engine side)

Scope read: `engine/src/api.ts` (all), `canvas.ts` (all), `canvas-html.ts` (stamp/splice/guard and the export list), `designs.ts`, `design-prefs.ts`, `design-start.ts`, `lean.ts` (file helpers, note, rpc), `pictures.ts`, `security.ts`, `security-scan.ts`, `security-checks.ts`, `security-bringin.ts`, `security-tools.ts`, `security-demo.ts` (seeding path only), `doctor.ts`, `contracts/src/design.ts`, `contracts/src/security.ts`.

None of these files is modified in the working tree (`git status` shows only `contracts/src/index.ts`, `runtime.ts`, `store.ts` changed in engine/contracts), so nothing below is "(new today)". Security landed in de80da8 this morning; Check my tools in 779de1c yesterday.

---

### 1. `stamp()` is quadratic: a large unstamped frame blocks the engine for seconds on every read
- category: perf
- severity: high
- confidence: confirmed (measured)
- where: `engine/src/canvas-html.ts:381-385` (`splice`), `:392-422` (`stamp`), `:429-454` (`undoes`); called from `canvas.ts:837, 965-970, 981, 1040, 1546`
- evidence:
  ```ts
  const splice = (html: string, edits: Splice[]) => {
    let out = html;
    for (const e of [...edits].sort((a, b) => b.at - a.at)) out = out.slice(0, e.at) + e.ins + out.slice(e.at + e.del);
  ```
  and in `undoes`: `for (const el of addressable(doc)) { … if (a && edits.some((e) => e.id === a.value)) …`
- what goes wrong: one string rebuild per element that needs an id (O(elements × bytes)), and an O(E²) id lookup in the guard. I ran `stamp()` from the real module on generated pages (scratchpad `stampbench.mjs`):
  500 elements / 51 KB: 23 ms; 2000 / 207 KB: 329 ms; 6000 / 625 KB: **2670 ms**; re-stamping an already stamped page: 7-20 ms. 625 KB is well under the 2 MB `MAX_FRAME`. An agent that writes a frame with its own file tools (no ids) makes the first `canvas.frame.read`, `design_tree`, `design_node`, `design_frame` and the watcher's adopt pay this, on the engine's only thread, so every session's stream stalls. Worse, `peekFrame` (the Code face's mini view, `:978-982`) and `versionRead` (`:1546`) stamp in memory and never write, so they pay it on **every** read of that frame.
- fix: build the output once: walk edits in ascending order, push `html.slice(prev, e.at)` and `e.ins` into an array, `join("")`. In `undoes`, put the edit ids in a `Map<id, edit>` instead of `edits.some`. Same `splice` change also helps `applyOps`' own splices.
- effort: S
- risk of the fix: ids and bytes must come out identical; `canvas.test.ts` stamp/guard tests cover byte-for-byte round trips. Re-run the bench.

### 2. Canvas versions copy every design folder (assets included) for every session in that folder, and turn copies are never pruned
- category: perf (disk and I/O)
- severity: medium
- confidence: confirmed
- where: `engine/src/canvas.ts:1607-1627` (`attach` listens to every turn of every thread), `:1466-1469` (`turnStarted`), `:1476-1484` (`turnEnded`), `:1397-1407` (`keepVersionAsync`); prune exists only for "before" copies `:1424-1428`; fork copy `engine/src/api.ts:1060-1061`
- evidence:
  ```ts
  if (e.type === "item" && e.item.kind === "turn") { … queue(ctx, threadId, () => turnStarted(ctx, threadId, turn)); …
  export async function turnStarted(ctx, threadId, turn) {
    const cwd = resolve(ctx.cwdOf(threadId));
    for (const slug of slugsIn(cwd)) if (!kept(ctx, threadId, slug).length && !brokenIndex(...)) await keepVersionAsync(...)
  ```
  `grep -n rmSync engine/src/canvas.ts` shows no removal of `t<turn>` copies anywhere.
- what goes wrong: a project with `.liner/designs/` (say 40 MB of AI pictures in `assets/`) gets a full copy under `~/.liner-code/designs/<thread>/canvas/` for **every** session that runs a turn there: Code-face sessions, side chats, Security scans and fixes, Compare takes, none of which touch the design. Each turn that changed anything adds another full copy (pictures and all), forever, until the session is deleted. Archived sessions keep theirs. A fork then `cpSync`s the parent's whole `designs/<id>` folder synchronously on the request path (`api.ts:1061`), so fork time grows with the parent's turn count.
- fix: (a) only take versions for threads that draw: `t.design` set, or the project is `kind: "design"`, or the turn's tool rows touched `.liner/designs/` (presence already knows); (b) keep the newest N turn copies per design per session (as BEFORE_KEEP does) or dedupe unchanged files by hard-linking from the previous copy; (c) copy `assets/` by link or not at all (pictures are content-addressed by name already).
- effort: M
- risk of the fix: Versions scrubbing (`Versions.tsx`) must still find the turns it lists; restore of a pruned turn must say so. Test a fork of a design session.

### 3. Security rewrites the whole project record (with two fsyncs) up to twice per finding, and once per finding in the free checks
- category: perf
- severity: medium
- confidence: confirmed
- where: `engine/src/security.ts:276-281` (`save` → `writeAtomic`), `:328-333` (`add` saves), `:484-493` (`countOn` → `patchScan` → save + `security.scan` event); `engine/src/security-scan.ts:804-810`; `engine/src/security-checks.ts:433-443`
- evidence:
  ```ts
  for (const a of sec.addMany(projectId, list, BY) as SecurityFindingAdded[]) {
    …
    if (scan) { try { sec.countOn(scan, a); } catch {} }
  ```
  `countOn` ends in `this.patchScan(scanId, { counts: c })`, which does `this.save(projectId)` (JSON.stringify of every finding and up to 200 scans, `writeAtomic` with file and dir fsync) and `this.emit({ type: "security.scan", … })`.
- what goes wrong: a scan whose free checks find 300 npm advisories does one batched write for the findings, then 300 more whole-file writes and 300 scan events, all sync on the engine thread. Each `security_report_finding` from the agent writes the file twice (add, then countOn). `security_note_area` writes it once per call. The comment at `security-bringin.ts:30` ("each is a write of the project's record") is stale since `addMany` batches.
- fix: add `Security.countMany(scanId, added[])` that folds all outcomes into one `patchScan`; in `report_finding` let `add` skip its save when a `countOn` follows (or give `add` the scan id and count inside the same save).
- effort: S
- risk of the fix: scan counts on the Scans page and the "done" line; `security.test.ts` count assertions.

### 4. Each canvas tool call re-reads every design file of the folder several times (and the prefs file, and every skill)
- category: perf
- severity: medium
- confidence: confirmed
- where: `engine/src/canvas.ts:1785-1802` (`designFor` → `listFiles` → `readFile` per design), `:1928-1937` (`design_frame`: designFor, then readFile, then writeFrame→readFile, then saveFile→readFile), `:1814-1828` (`filesSaid`: listFiles then readFile again per file, plus `canvasHooks.skills` per file), `:362-365` (`withPrefs` re-reads `design-pictures.json` on every readFile, `design-prefs.ts:18-32`), `lean.ts:349-363` (`listSkills` reads every SKILL.md under four roots), `:1960-1982` (`design_node`: 4 whole-document parses)
- evidence: `const files = listFiles(ctx, cwd);` inside `designFor`, which every tool except `design_selection` calls; `listFiles` does `readFile(ctx, cwd, slug)` for each slug (parse design.json, lstat every frame, readdir frames/, read prefs JSON, and may write the index).
- what goes wrong: with 10 design files of 20 frames, one `design_frame` does ~13 design.json parses, ~260 lstats and ~13 reads of the prefs file before it writes anything; `design_files` additionally walks all skill folders once per design file (each SKILL.md read whole). `design_node` parses the frame in `readFrameRev`/`stamp`, `replaceNode`, `writeFrame`'s `stamp`, then `parse(out)` again. Cost grows with designs × frames × skills on every agent step while drawing.
- fix: in `designFor`, when a name is given, test `existsSync(designDir/…/design.json)` instead of listing; reuse the `DesignFile` already read inside `design_frame`/`writeFrame`/`saveFile` (pass it in); read `design-pictures.json` once per call (or cache by mtime); compute `listSkills` once per `filesSaid` call, not per file.
- effort: M
- risk of the fix: readFile's adopt-on-read side effect must still happen once per call; canvas tool tests.

### 5. Canvas and design watch counts leak when the window reloads, leaving fs.watch and a 1 Hz poll running forever
- category: bug (leak)
- severity: low
- confidence: likely (link assumed: nothing resets counts when the event stream reconnects; I found no such reset in `server.ts`)
- where: `engine/src/canvas.ts:1142-1182` (`watchFile` counts `w.n`/`w.peek`, `setInterval(…, 1000)`), `engine/src/designs.ts:253-264`; callers `ui/src/app/design/store.ts:508-510`, `ui/src/app/DesignMini.tsx:184,207`, `ui/src/app/Design.tsx:352-355`
- evidence: `else w.n = Math.max(0, w.n + (on ? 1 : -1)); … w.poll ??= setInterval(() => { … }, 1000);` The off call only comes from a React effect cleanup.
- what goes wrong: a renderer reload (Cmd+R, a crash, HMR in dev) never sends `on: false`; the reloaded window adds another `on: true`. The count never reaches 0, so the recursive watcher, its per-file timers and the 1 s poll stay for the engine's life, and `canvas.changed` keeps being emitted for designs no window shows.
- fix: key watches by the event-stream client (server.ts already tracks `clients`) and drop a client's watches when its stream closes; or have the UI send one `canvas.unwatchAll` at boot.
- effort: S
- risk of the fix: two windows on one design must still each hold their watch.

### 6. `projects.scan` walks the home folder synchronously on the request path
- category: perf
- severity: low
- confidence: likely (cost depends on the disk; the code is all sync)
- where: `engine/src/api.ts:116-152` (`findRepos`: `readdirSync` + `statSync` per entry, 14 roots, depth 3), `:927-934`
- evidence: `names = readdirSync(dir); … if (statSync(abs).isDirectory()) walk(abs, depth + 1);`
- what goes wrong: on a home with large `~/Documents/GitHub`, `~/Developer` or `~/work` trees (thousands of folders at depth 3, only dot-folders, `node_modules` and `Library` skipped), the scan blocks the engine thread for hundreds of ms to seconds while sessions stream; every running turn's output stalls.
- fix: use `fs.promises.readdir(dir, { withFileTypes: true })` (also drops the per-entry `statSync`), or yield with `setImmediate` every few ms as `security-checks.ts:290-294` already does.
- effort: S
- risk of the fix: result order and the 200 cap; `findRepos` tests.

### 7. RPC methods nothing in the app calls
- category: dead
- severity: low
- confidence: confirmed
- where: `engine/src/security.ts:652, 657`; `engine/src/pictures.ts:363`; `engine/src/api.ts:813, 1465-1470`; `engine/src/buildlinks.ts:201, 208`
- evidence: for each of the 198 names in `Rpc` (`contracts/src/index.ts:1520-1933`) I ran `git grep -F "\"<name>\"" -- ui/src desktop/src` plus `grep -rnF "<name>"` over `ui/src desktop/src` (to include untracked files such as `SideList.tsx`). No caller:
  - `security.checks.run`, `security.finding.get` (no caller anywhere, not even tests; the free checks run through `security.scan.start` depth "checks")
  - `review.run` (the Reviewer is started by `/reviewer` through `thread.send`)
  - `pictures.models` (tests only: `engine/test/pictures.test.ts:124`)
  - `sessions.importable` (tests only; the app uses `sessions.recent`)
  - `build.link`, `build.unlink` (tests only)
  - `desk.ask` (kept on purpose with the hidden Desk) and `routine.remove` (Routines): listed, not to act on.
- fix: delete the first five and their contract entries, or keep with a one-line note if a UI is planned; for `build.link`/`build.unlink` confirm with the owner whether the Build tab should link by hand.
- effort: S
- risk of the fix: tests that call them need trimming.

### 8. Dead code and stale comments in the design and security files
- category: dead
- severity: low
- confidence: confirmed
- where and evidence (each checked with `grep -rn <name> engine ui/src desktop/src contracts`):
  - `engine/src/lean.ts:293` `export function leanRev` : used nowhere, not even in tests.
  - `engine/src/canvas.ts:1383` `keepVersion` and the sync `digest` (`:1304`) : `keepVersion` is used only by `engine/test/canvas.test.ts`; the engine uses `keepVersionAsync`/`digestAsync`. Two copies of the same copy-and-fingerprint logic.
  - `engine/src/canvas.ts:424` `sync(dir, file, _drop?, was?)` and `readFile`'s `o.drop` (`:464, 489`, passed by `canvas.open` `:1705`) : the parameter is ignored.
  - `contracts/src/security.ts:324` `export const SCAN_ACCESS: Access = "read"` : no reader; `api.ts:712` hard-codes `"read"`.
  - `engine/src/api.ts:533-538` : two doc comments stacked on `withContext`, the first a cut-down copy of the second.
  - `engine/src/security-bringin.ts:30-31` : "each is a write of the project's record" is no longer true (`addMany` writes once).
- fix: delete `leanRev`, `SCAN_ACCESS`, the `_drop`/`drop` plumbing and the first comment; point the tests at `keepVersionAsync` and delete `keepVersion` (keep sync `digest` only if `keepBefore` stays sync); fix the comment.
- effort: S
- risk of the fix: none beyond the tests named.

### 9. Four atomic-write helpers; two of them leave `.tmp` files behind on failure
- category: refactor (and small bug)
- severity: low
- confidence: confirmed
- where: `engine/src/store.ts:38` (`writeAtomic`, fsyncs), `engine/src/canvas.ts:263-297` (`writeWhole`, keeps mode, cleans up), `engine/src/lean.ts:497-502` (`atomic`), `engine/src/design-prefs.ts:39-42`
- evidence:
  ```ts
  export function atomic(abs, data) { mkdirSync(dirname(abs), …); const tmp = `${abs}.${process.pid}.…tmp`; writeFileSync(tmp, data); renameSync(tmp, abs); }
  ```
- what goes wrong: `lean.atomic` (used for DESIGN.md and every AI picture, `pictures.ts:327`) and `setPicturesPref` leave the temp file on a full disk or a failed rename; in `assets/` that's a stray file the canvas then serves and the version copies carry. Four helpers with different guarantees for the same job.
- fix: make `lean.atomic` call `canvas.writeWhole` (mkdir first), and `setPicturesPref` call `store.writeAtomic`.
- effort: S
- risk of the fix: Windows rename fallback in `writeWhole` now also covers lean and pictures (good); check pictures tests.

### 10. `rel.startsWith("..")` refuses real files whose name starts with two dots
- category: bug
- severity: low
- confidence: confirmed
- where: `engine/src/canvas.ts:203, 212` (and 3 more), `designs.ts:51, 164`, `lean.ts:461, 486, 494`, `security.ts:516`, `security-scan.ts:645`, `security-checks.ts:241`, `security-bringin.ts:254`, `design-start.ts:223` (16 sites in these files; `git grep -c 'startsWith("..")' -- engine/src`)
- evidence: `if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("A design's file must be inside this session's folder.");` while `engine/src/exec.ts:64` already has the right test: `rel === ".." || rel.startsWith(\`..${sep}\`) || rel.startsWith("../") || isAbsolute(rel)`.
- what goes wrong: a finding in `..well-known/x`, a threat model named `..security.md`, or a design path `..drafts/a.html` is refused as "outside the folder". Rare, but each site words its refusal differently and some are security guards, so one shared helper is worth it.
- fix: replace each with `!rel || outside(rel)` from `exec.ts`.
- effort: S
- risk of the fix: none for containment (`outside` is stricter in the right way); path-guard tests.

### 11. `files.raw` and `attachment.read` are the same handler twice
- category: refactor
- severity: low
- confidence: confirmed
- where: `engine/src/api.ts:1704-1718`, `:1719-1737`
- evidence: both do `realpathSync` root, `relative`, `outside(rel) || resolve(root, rel) !== real`, `statSync`, size cap, the same extension regex and an almost identical MIME table (one has `ico`), then `readFileSync(real).toString("base64")`.
- fix: one `readInside(root, path, { cap, refusal })` returning `{ data, mime, size }`; the attachments variant keeps its "refuse before lookup" check.
- effort: S
- risk of the fix: the two refusal sentences differ; keep them as parameters.

### 12. Repeated guards and lookups in api.ts that one helper each would remove
- category: refactor
- severity: low
- confidence: confirmed
- where: `engine/src/api.ts:1248, 1467, 1498, 1513, 1557, 1585` (`if (working(id)) throw new Error(setups.has(id) ? SETTING_UP : "…")`); `:1515, 1526, 1849, 1861, 1921` (`t.worktree?.branch ?? (await branchOf(cwd))`); `:1517-1519` and `:1527-1528` (pick origin else first remote)
- fix: `idleOr(id, why)`, `branchFor(threadId)`, `remoteOf(cwd)`.
- effort: S
- risk of the fix: wording of each refusal must stay.

### 13. Engine-lifetime maps that only grow
- category: bug (small leak)
- severity: low
- confidence: confirmed
- where: `engine/src/canvas.ts:228` `turns` gets `"<thread>#<turn>"` for every turn of every session (`:1613-1621`) and is never deleted, not even on `thread.removed` (`:1628-1631`); `own`, `heard`, `there` (`:219-232`) per path; `canvas.sums` (`:1301`) per file ever digested; `pictures.asked` (`pictures.ts:356`) per thread; `api.ts:471` `aiToday` gets one key per add-on per day; `api.ts:388` `stops`, `:278` `fetched`, `:276` `commandsCache`.
- evidence: `grep -n "turns.delete\|heard.delete\|sums(ctx).delete" engine/src/canvas.ts` returns nothing.
- what goes wrong: small strings, but an engine left up for weeks with many sessions keeps one entry per turn ever run; `aiToday` grows daily.
- fix: delete `turns` keys when the turn ends (only "running" matters) and on `thread.removed`; drop `aiToday` keys not for today when adding; clear `stops` and `asked` on `thread.removed`.
- effort: S
- risk of the fix: the turn-end dedupe relies on `was !== "ended"`; keep a small per-thread "last ended turn" instead.

### 14. Security Overview recomputes every finding's history once per day of the period, on every change
- category: perf
- severity: low
- confidence: likely (not measured; O() read from code)
- where: `engine/src/security.ts:545-572` (`overview`), `:123-133` (`stateAt` sorts the activity each call)
- evidence: `const series = Array.from({ length: span }, … open: all.filter((f) => stateAt(f, end) === "open").length, … found: all.filter(…), fixed: events.filter(…), dismissed: events.filter(…)`
- what goes wrong: days (up to 365) × findings × (sort of activity) plus three more full passes per day; the face asks again on every `security.changed`, which a scan emits per reported finding. With a few thousand findings and a year view it is hundreds of ms per finding reported.
- fix: sort each finding's activity once, then sweep days in order with a running state (or bucket events by day once).
- effort: S
- risk of the fix: the day series numbers; `security.test.ts` overview cases.

### 15. Importing free-check, Dependabot or SARIF results is O(new × stored) in `put`
- category: perf
- severity: low
- confidence: likely
- where: `engine/src/security.ts:358-367`
- evidence: `const instanced = n.instance ? [] : d.findings.filter((f) => f.instance && findingKey(projectId, { ...f, instance: undefined }) === key);` plus `d.findings.find(…)` and `d.dismissed.find(…)` per incoming result.
- what goes wrong: every result without an instance (npm packages, secrets, files, Dependabot) recomputes `findingKey` (normalising the title) for every stored finding that has an instance (SARIF, code scanning, agent findings with a rule). 300 packages against 2000 stored SARIF results is 600k key builds, synchronously.
- fix: in `addMany`, build `Map<key, finding>` and `Map<bareKey-without-instance, finding[]>` once for the batch.
- effort: S
- risk of the fix: dedupe semantics are subtle (comments at `:361-366`); keep the same three lookups, only indexed.

### 16. Moving or removing a design hashes every file twice synchronously on the request path
- category: perf
- severity: low
- confidence: confirmed
- where: `engine/src/design-start.ts:156-173` (`filesOf`, `copyChecked`), used by `attachDesign` `:273`, `removeDesignFile` `:564`, `unremoveDesignFile` `:600`
- evidence: `else if (s.isFile()) out.set(r, createHash("sha256").update(readFileSync(join(dir, r))).digest("hex"));` run over source and copy.
- what goes wrong: a design with 100 MB of pictures reads 200 MB and hashes it on the engine thread; all sessions stall for the duration. The "nothing awaits" rule in `attachDesign` (`:248`) is about turns starting, which is already guarded by `running()`.
- fix: compare size and mtime first and hash only on mismatch, or do the copy-and-check with `fs.promises` before the no-await section begins.
- effort: M
- risk of the fix: the journal and crash-recovery order; `design-start.test.ts` crash steps.

### 17. A scan whose first message never starts shows "running" until its time is up, then says it was stopped by the clock
- category: ux
- severity: low
- confidence: suspected (link assumed: a failure before the thread ever reaches status running/waiting; e.g. `ensureWorktree`/`withContext` throwing inside `thread.send`'s background start)
- where: `engine/src/security-scan.ts:296-311` (prompt sent through `thread.send`, which answers `null` at once), `:335-347` (`wake` only finishes once `live.ran`), `:316-329` (`tick`), `:403`
- evidence: `if (t.status === "running" || t.status === "waiting") return void (live.ran = true); if (live.ran) setTimeout(() => void finish(…), 0);` and the error later written: `` `Stopped after ${plural(rec.stopsAfter ?? 0, "minute")}, as you set.` ``
- what goes wrong: the message lands in the queue with a notice, the scan card shows running for 10 to 30 minutes (up to 240), then ends as "Stopped after 30 minutes, as you set". The `.catch` at `:308-311` also clears the interval but leaves the `lives` entry.
- fix: after `thread.send`, if the thread has queued messages and is not running within a few seconds, end the scan as failed with the notice's words; delete the `lives` entry in that catch.
- effort: S
- risk of the fix: a slow first start (Codex app server) must not be mistaken for a failure; use the queue, not a timer alone.

### 18. Commit message, PR draft and Desk answers can't be cancelled
- category: ux
- severity: low
- confidence: confirmed
- where: `engine/src/api.ts:1883, 1897, 1913`
- evidence: `runtime.quiet(threadId, by, cwd, writePrompt(…), new AbortController().signal, "reviewer", 3 * 60_000)`
- what goes wrong: closing the commit or PR card leaves the model call running for up to 3 (Desk: 5) minutes, spending tokens, with nothing to stop it. Pictures (`pictures.make`) has the same shape but a fixed 180 s cap.
- fix: keep the controller in a map by threadId+kind and add a `*.cancel` RPC the card calls on close (as `panel.cancel` does for add-ons).
- effort: S
- risk of the fix: low.

---

## In good shape (checked, nothing to report)
- `/rpc` path handling: `files.raw` and `attachment.read` follow links before the inside check; `thread.create` checks `id`, `base` and the design slug; `git.switch` refuses option-like and malformed branch names; `project.clone` only takes https/ssh/git@ remotes; `apps.open` only opens known bundle ids; `design.*`/`canvas.*` go through `ctx.folder` (known project or worktree) and `linkFree`/`inDesign`.
- Pictures: every network call has a timeout (`WAIT` 180 s, `AbortSignal.timeout`), redirects refused, answers capped, key scrubbed from errors, link fetch blocks loopback and private networks, picture bytes sniffed (no SVG). No temp files beyond item 9.
- Doctor: tiers run per tool in parallel (`Promise.all` at `doctor.ts:613, 623`), probes are shared and reused for 60 s, every spawn has a time-out (`listTools` 15 s, git 10 s, turns `TURN_MS`, model list 30 s), scratch folders cleared at start and per probe, the fake model's server closes all connections. Only nit: `within()` at `:164` gives up on a model list after 30 s but does not stop the underlying call (it relies on the provider's own timeout).
- Security free checks: yield every 8 ms, file and byte caps, `npm audit --package-lock-only` with a 60 s time-out, one run per project at a time, secrets never stored unmasked. Scan clock, ask cap inside the tool's own wait, second look capped at 6 minutes and abortable, stale scans closed on engine start.
- gh calls in Bring in: 15-60 s time-outs, `gh` reach cached for a minute.
- `design.attach`: the journal and `recoverAttaches` cover a crash at each step; rollback is complete.
- Canvas writes: `writeWhole` is atomic with mode kept; user writes are guarded by revision (`base`), agent writes announce an unseen agent edit first (`heardBefore`).

## What I did not get to
- `canvas-html.ts` beyond `stamp`/`splice`/`undoes`: `applyOps`, `replaceNode`, `carryIds`/`lineUp` (`LINE_UP_CAP` 250k suggests it was already tuned) were not read line by line.
- `buildlinks.ts`, `canvas-tools.ts`, `pictures-tools.ts`, `lean-tools.ts` only skimmed (data files).
- `security-demo.ts` beyond `demoOnUse`/`seedDemo`'s first steps.
- The UI side of these RPCs (how often the Security face refetches per `security.changed`), which decides how much items 3 and 14 cost in practice.
- Routines code in api.ts: 6 lines of handlers (`routine.*`), skipped as decided.
