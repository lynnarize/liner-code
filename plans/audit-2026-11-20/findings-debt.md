# DEBT findings — bounded pass (auditor: perf-debt, HEAD bfb0ebc + uncommitted layout work)

Verified merged/fixed since the 11-18 audit (NOT re-reported): F5 "is anything asking" → one `Runtime.asking()` (runtime.ts, 10 call sites); F5 usage totals → one `summarize` (api.ts:2266); F7 version compare/bundle id/app name → contracts `newerVersion`/`APP_BUNDLE_ID`/`APP_BUNDLE_NAME` (contracts/src/index.ts:1962-1966, used by engine updates.ts and desktop signed.ts); A13 → UI keeps KEEP=20 idle timelines with hold/release (ui engine.ts:165-213); C8 → engine evicts idle timelines every 30 s (store.ts:568, runtime.ts:361-366), state.json written flat with 120 ms debounce (store.ts:638-648), appendText/putItem use findLastIndex; C17 usage.jsonl read incrementally (store.ts:389-418); A16 Security refetch throttled to 150 ms (security/store.ts:138-145); A11 isBlank memoised per frame HTML (design/store.ts:141-149); D6 pulses now opacity/transform-only; Inter latin font preloaded (main.tsx:16); E1/E3 CSS cleanup holds — scans found 0 unused keyframes, 0 duplicate keyframes, 0 unread custom properties, 0 dead app classes (token scans over app+liner TSX; dsh-shims.ts exports excluded — they answer plugin-side imports, not dead).

### [DEBT-01] One working-folder helper instead of the expression written 27 times

- **Evidence**: `grep -rn "worktree?.path ??" engine/src/*.ts` → 27 lines across 7 files: `engine/src/runtime.ts:373,804,906,1292,1383,1531` (and more), `engine/src/api.ts:597,1126,2080`, `engine/src/agent-tools.ts:711,810,906`, `engine/src/canvas.ts:101`, `engine/src/main.ts:123,158`. `main.ts:121-124` defines a local `folderOf` with the same body but exports nothing; `runtime.ts:371-374` installs the same expression as `tools.cwdOf`. This is F5's unmerged half (the asking-test and usage-totals halves merged).
- **Impact**: the worktree-vs-project resolution rule lives in 27 copies; a change to it (e.g. a new worktree layout) must touch 7 files in lockstep, and the copies already differ in whether they consult `cwdOf` first.
- **Effort**: S — export one `cwdOfThread(store, t)` (Store method or contracts helper), replace the sites mechanically, one test pinning worktree precedence.
- **Risk**: LOW — pure expression extraction; the sites are read-only path picks.
- **Confidence**: HIGH (grep count above).
- **Fix sketch**: add `Store.cwdOf(threadId)` next to `thread()`/`project()`, make `folderOf`/`tools.cwdOf` delegate to it, and replace the inline expressions file by file.

### [DEBT-02] Merge the three copies of the stdio tool-server loop (cancel + progress beat)

- **Evidence**: `engine/src/mcp.ts:25-63` (88 lines), `engine/src/outside.ts:39-76` (101 lines), `engine/src/dsh-mcp.ts:48-69` (100 lines) — each re-implements the same JSON-RPC-over-stdio server: an in-flight map by request id, a `CANCELLED` symbol, `notifications/cancelled` handling, and a byte-identical 20 s progress beat (`mcp.ts:40` and `outside.ts:51` are the same line; `dsh-mcp.ts:48` differs only in its send function and message). Plan 014's notes flagged the trio; the cancel/progress loops are still three copies. (Distinct from held-back F2, which is the client side in codex-server/acp/models.)
- **Impact**: a fix to cancellation or progress semantics (e.g. the B13-class swallowed-line bug) must land three times; the copies have already drifted in message wording and send path.
- **Effort**: M — one shared `stdioToolServer({ dispatch, send })` helper owning the loop, cancel map and beat; the three files keep only their dispatch tables; characterization tests per server first.
- **Risk**: MED — these run inside agent tool processes; a protocol regression breaks MCP calls silently. Needs the real-tool run per CLAUDE.md.
- **Confidence**: HIGH.
- **Fix sketch**: extract the shared loop with the cancel/beat behaviour pinned by the existing tests, port one server at a time, verify against a fake MCP client then a real tool.

### [DEBT-03] Drop the export keyword on ~20 UI symbols used only in their own file

- **Evidence**: scan `for f in ui/src/app/*.ts*; do grep -oE "^export (const|function|class|type|interface) …" | check refs outside own file; done` → 0 outside refs for: `browserFrame.ts:DESKTOP`, `dock.ts:onScreen,canSplit`, `engine.ts:EngineState`, `launch.ts:LaunchList`, `model.ts:isSampleProject`, `stop-guard.ts:STOP_GRACE_MS`, `themes.ts:lightness`, `Addon.tsx:accessLine,AddonMenu,willTouch`, `Crew.tsx:isCrewItem,isAgent,shortModel,PairNames,agentNow,agentStats,AgentNode,Member,crewOf,useCrew,showAgent`, `Design.tsx:FRAME,designsIn,versionHtml`, `Models.tsx:EffortRows`, `Review.tsx:isTestFile`, `Updates.tsx:firstNote,toolNotice,noticesOf`, `Wall.tsx:wallOrder` (each still used inside its own file — total-refs grep ≥2 — so this is dead public surface, not dead code). E2 deleted ~15 of these on 11-18; these are the leftovers.
- **Impact**: a falsely public surface invites wrong imports (the F8 `commandWords` clash was exactly this) and makes dead-code scans noisier for the next pass.
- **Effort**: S — unexport each (keep the symbol), typecheck; no behaviour change.
- **Risk**: LOW — `npm run typecheck` catches any missed consumer.
- **Confidence**: HIGH (grep proofs above; re-grep each before deleting per house practice).
- **Fix sketch**: remove `export` from the listed symbols in one pass; leave `EngineState` exported only if a consumer needs the type (none found).

### [DEBT-04] Decide the fate of 14 test-only engine exports

- **Evidence**: word-membership scan of all src vs all test files: `engine/src/providers/acp.ts` `setSwitchMs,setOpencodeUsageMs,setOpencodeExportMax,setCancelMs,setCommandsAgainMs` (src refs=1, test refs=1 each — timing seams), `engine/src/surfaces.ts:parseThreads`, `engine/src/addons.ts:programWhere`, `engine/src/agent-tools.ts:NO_PICTURE,isPage`, `engine/src/api.ts:githubName,foldLate`, `engine/src/buildlinks.ts:buildState,elementsOf,diffFrames`, `engine/src/canvas-html.ts:stampGuard,carryIds` — all referenced only by their own file plus tests. E5's four test-only RPC calls were deliberately kept; these are the same class, one layer down.
- **Impact**: production modules carry exports that exist only for tests, blurring the real API surface; the acp setters also let tests mutate module-level timing globals, which is how parallel-load flakes breed.
- **Effort**: S — either document them as test seams (one comment each) or move the seams behind a test-only injection; no deletion without the owner's call, per the E5 precedent.
- **Risk**: LOW — tests pin the behaviour either way.
- **Confidence**: HIGH.
- **Fix sketch**: list them in the module header as test seams, or pass the timings in as options so tests construct instead of mutate; keep the E5 decision consistent.

### [DEBT-05] Runtime pins lag: Electron one major behind, SDK 19 patches behind

- **Evidence**: `npm view` (this audit): electron latest **45.4.1** vs pinned **44.9.3** (`desktop/package.json`, root `allowScripts`); `@anthropic-ai/claude-agent-sdk` latest **0.3.329** vs pinned **0.3.310** (`engine/package.json`). Electron supports only the newest three majors, so 44 leaves the support window when 46 ships; the SDK is the engine's only runtime dependency and its patches track Claude Code protocol fixes. Also: all four workspaces say `version: 0.1.0` while root is 0.3.0 — harmless today (`engine/src/version.ts` reads the root/staged package.json, not the workspace one) but a trap for any future tooling that reads workspace versions.
- **Impact**: staying on Electron 44 past its window means no security fixes for the shell that holds the keys and the update swap; SDK lag accumulates protocol drift against the Claude Code the app drives.
- **Effort**: M — Electron bump per CLAUDE.md: bump the pin and root allowScripts together, rebuild the native addon, `desktop/test/panel-network.test.ts` must pass not skip; SDK bump needs the real-tool run against a fake API.
- **Risk**: MED — Electron majors shift Chromium/Node behaviour (the panel-network test exists for exactly this); the release gate covers it.
- **Confidence**: HIGH on the version numbers; MED on the EOL timing (no date asserted).
- **Fix sketch**: schedule the Electron 45 bump as its own release-gated change; review the SDK 0.3.310→0.3.329 changelog and bump with the provider real-tool run; optionally align workspace versions with root or mark them explicitly unused.

### [DEBT-06] Toolchain majors: TypeScript 5.9 vs 7.0, Vite 7 vs 8

- **Evidence**: `npm view`: typescript latest **7.0.2** vs `~5.9.3` in engine/ui/desktop devDependencies; vite latest **8.3.8** vs `^7.2.0` in ui. React 19.2→19.3 and xterm 6.0.0 are current-minor/latest — no action. TS 7 is the native-compiler line; the repo's `erasableSyntaxOnly` direct-TS-on-Node workflow is exactly what it changes.
- **Impact**: major-version lag on the compiler and bundler eventually cuts off ecosystem support and security fixes; the longer the wait, the larger the blast radius (every workspace typechecks, the UI build and the dsh-platform esbuild plugin ride Vite).
- **Effort**: M each, measure first — try TS 7 in a branch: `npm run typecheck` across the three workspaces is the whole verification story; Vite 8 needs one `npm run build` plus the dev-server proxy check.
- **Risk**: MED — TS 7's native compiler may differ on edge-case diagnostics; Vite majors shift plugin APIs (@vitejs/plugin-react pin).
- **Confidence**: HIGH on the lag; MED on migration cost (not attempted — read-only audit).
- **Fix sketch**: spike TS 7 typecheck compatibility first (cheap, reversible), then Vite 8 with the build; keep esbuild pinned per house rule unless a bump is decided.

### [DEBT-07] CI never builds the UI bundle and never runs on Windows, which ships

- **Evidence**: `.github/workflows/check.yml:19-24` — steps are `npm ci`, typecheck, `test:steady -w engine`, `node desktop/build.ts`, `npm test -w desktop`. No `npm run build` (vite) step: a broken import graph, CSS syntax error or chunk failure passes CI and surfaces only at release (`scripts/release.sh` builds). The job is `macos-latest` only (comment cites codesign/sandbox-exec/ditto), yet Windows ships (`scripts/build-win.sh`, `npm run win`) and Windows-specific code exists: `engine/src/awake.ts:57-63` (PowerShell stay-awake), the atomic writer's Windows in-place fallback (`engine/src/atomic.ts`), path handling throughout.
- **Impact**: the bundle — the artifact users actually load — is unverified on every push; Windows regressions (paths, spawn, the awake PowerShell) are caught by no automated check at all.
- **Effort**: S for the build step (one line: `npm run build`); M for a `windows-latest` job running the engine tests that don't need mac tooling (skip codesign/ditto files by name or tag).
- **Risk**: LOW — additive CI; the Windows job may need a few test skips, which should be explicit, not silent.
- **Confidence**: HIGH.
- **Fix sketch**: add `npm run build` after typecheck; add a Windows job with the mac-only test files excluded and a comment saying why, mirroring the macOS job's steady concurrency.

### [DEBT-08] Stale doc claims: SECURITY_MODEL says 0.2.9; BACKEND's macOS floor matches nothing in the build

- **Evidence**: `SECURITY_MODEL.md:3` — "version 0.2.9 beta" while root package.json and CHANGELOG.md are 0.3.0 (tag v0.3.0 exists). `docs/BACKEND.md:19` — "macOS | 14 or newer | the shell", but the build enforces no such floor: `desktop/build.ts:45` compiles the native addon with `-mmacosx-version-min=12.0`, `scripts/build-mac.sh:57` compiles icons with `--minimum-deployment-target 13.0`, and no `LSMinimumSystemVersion` is set anywhere in desktop/build.ts or build-mac.sh; README's install section (153-160) states Apple Silicon only, no macOS minimum. (Route lists checked and accurate: SECURITY_MODEL.md:12-16 covers /surface, /outside, /hooks, /addon-check, /dsh, PANEL_FRAME, /health incl. the unguarded ones; usage-ping payload matches README's data claims — `Ping` is {id,v,os,arch,day,out,in}, usage-ping.ts:31.)
- **Impact**: a security model that names the wrong version undermines the document's authority at review time; a support floor nobody enforces either misleads users (14 claimed, 12/13 built) or hides a real requirement that should be in the plist.
- **Effort**: S — set the version line from the release process; decide the real macOS floor, then either set LSMinimumSystemVersion in the packaged plist or correct BACKEND.md to match.
- **Risk**: LOW — doc/plist only; verify the packaged Info.plist before choosing the number.
- **Confidence**: HIGH on the version drift; MED on the macOS floor (the final plist inside the built app was not inspected — measure/verify first).
- **Fix sketch**: update SECURITY_MODEL.md's version at each release (release.sh can sed it), and reconcile BACKEND.md's macOS row with the packaged plist in the same change.

### [DEBT-09] CHANGELOG-next is empty while 12 user-visible commits sit past v0.3.0

- **Evidence**: `docs/CHANGELOG-next.md` — 4 lines, boilerplate only. `git rev-list --count v0.3.0..HEAD` → **12**, all user-visible layout/behaviour changes ("Corners come in four sizes…", "Switching to Design or Security always shows that face…", "The panel keeps its card while it closes…"), plus uncommitted layout work in the tree. CLAUDE.md: "Notes for the next release go in docs/CHANGELOG-next.md"; the website is built from CHANGELOG.md.
- **Impact**: the next release ships with no notes unless someone reconstructs 12+ commits from memory; the layout pass's visible changes (corner sizes, panel behaviour, face switching) are exactly what users notice and what the changelog exists for.
- **Effort**: S — one pass over `git log v0.3.0..HEAD` writing a note per commit in the owner's voice; make it a release.sh checklist item so it can't be skipped.
- **Risk**: LOW — docs only; the owner's voice rule applies (README copy is the owner's, changelog notes are the process's).
- **Confidence**: HIGH.
- **Fix sketch**: draft the 12 notes now from the commit subjects (they are already written as user-facing sentences), and add a "CHANGELOG-next non-empty" check to release.sh.

### [DEBT-10] Engine debugging has no structure: 7 log lines, no request ids

- **Evidence**: `grep -c console. engine/src/api.ts engine/src/runtime.ts engine/src/server.ts` → 4 / 2 / 1. `engine/src/server.ts:107` — `console.error("[server]", e)` is the server's only log; `/rpc` handlers in api.ts (2,311 lines) log nothing per call. `desktop/src/engine.ts:17` pipes the child's output to `engine.log`, so the log exists but carries no method, thread id, duration or outcome per request.
- **Impact**: diagnosing a slow or refused call ("the engine isn't answering", a stuck turn, a panel call that failed) requires attaching a debugger or adding logs and reproducing — the playbook's "debugging requiring code changes". With ~76 toast sites surfacing engine errors, the engine side gives no correlation to match them against.
- **Effort**: M — one log line per /rpc call (method, thread id when present, ms, ok/error) behind a debug flag or at debug level, plus a request id echoed in the response; keep the log bounded (rotate engine.log).
- **Risk**: LOW — additive; must not log keys, tokens or prompt content (SECURITY_MODEL's data-minimisation rules apply to the log too).
- **Confidence**: MED — the sparsity is certain; the payoff depends on how often support actually needs it (measure against real support cases first).
- **Fix sketch**: wrap the /rpc dispatch in server.ts with a timing+outcome log line and a short request id, redact params, rotate engine.log at a size cap.
