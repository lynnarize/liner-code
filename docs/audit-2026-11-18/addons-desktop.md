# Audit: engine add-ons and side services, and the desktop shell

Scope read: `engine/src/{dsh,dsh-hosts,dsh-host,dsh-mcp,addons,panels,surfaces,proxy,updates,imports,sources,offers,creator,buildlinks,buildlinks-tools,precheck,export,outside,outside-tools,backgrounds,apps,winterm,version}.ts` (dsh-shims.ts only skimmed), `contracts/src/{dsh,panel}.ts` (cast.ts skimmed), all of `desktop/src`, `desktop/build.ts`, `desktop/package.ts`, `desktop/native/mac.mm`, `scripts/dev.ts`, `scripts/build-mac.sh`, `scripts/release.sh`. Swift sources under `mac/Sources` were checked for drift against the shipped shell, not read line by line.

None of the files in this area are modified in the working tree (`git status` shows no changes under `desktop/`, `mac/`, `scripts/` or these engine files), so there are no "(new today)" findings here. Routines skipped as instructed.

---

### 1. Every add-on lookup reads and re-validates manifests from disk; `get(id)` builds the whole list to find one, and this runs on every DSH frame request and every panel call
- category: perf
- severity: medium
- confidence: confirmed
- where: `engine/src/addons.ts:557-572` (`manifest`, `get`), `:603-609` (`panel`), `:635-658` (`list`); callers on hot paths `engine/src/dsh-hosts.ts:631-632` (`serve`, every proxied request), `:705-706` (`mcp`, every agent tool call), `:440-441` (`changed`), `engine/src/api.ts:1404` (`panel.call`)
- evidence:
  ```ts
  get(id: string) { return this.list().find((a) => a.id === id); }
  ...
  list(): AddonInfo[] { for (const [id, e] of Object.entries(this.index.addons)) { const m = this.manifest(id); ...
  manifest(id, version?) { ... return checkManifest(JSON.parse(readFileSync(join(this.dir, id, `v${v}`, "addon.json"), "utf8")), { dsh: true }); }
  ```
  `serve()`: `const m = this.addons.panel(id); const version = this.addons.get(id)?.version;`
- what goes wrong: with N add-ons installed, each request a ported DSH page makes to `/dsh/<token>/…` (its API calls, each picture under `plugins/<pkg>/assets/`) costs N+1 sync `readFileSync` + `JSON.parse` + full `checkManifest` (dozens of regexes) on the engine's event loop, plus `accessWords`/`reachOf` string building for every entry. Same for each `panel.call` (`addons().panel()` reads the manifest again) and each agent call into a plugin's tools.
- fix: versions are immutable once written, so cache the checked manifest by `id@version` in a `Map` (drop the entry in `install` when a version folder is rewritten). Make `get(id)` build only that one entry, or have `serve`/`mcp` read `this.index.addons[id].version` directly.
- effort: S
- risk of the fix: a stale cache if a version folder is ever rewritten in place (only `install` does, guarded by `wouldBe`); test install over an existing id, version switch, remove/restore.

### 2. A DSH plugin's program that dies is started again on the very next request, with no back-off
- category: bug
- severity: medium
- confidence: confirmed
- where: `engine/src/dsh-hosts.ts:465-470` (`start`), `:554-567` (exit handler), `:664` (`serve` calls `start` per request), `:724` (`mcp`)
- evidence:
  ```ts
  const have = this.runs.get(m.id);
  if (have && have.version === version && !have.error && have.child.exitCode === null) return have.ready;
  if (have) this.stop(m.id);
  ... // exit:
  if (this.runs.get(run.id) === run) this.runs.delete(run.id);
  ```
- what goes wrong: a plugin whose Node half throws at start or crashes soon after `ready` is removed from `runs` on exit, so the frame's next fetch (a status poll, the next asset) spawns `sandbox-exec` + Electron-as-Node + the plugin's import again. A page that polls once a second becomes a spawn per second for as long as the panel is open, each one also appending to host.log. The engine shell's own child has a cap (desktop/src/engine.ts:91-96: five in a minute); these hosts have none.
- fix: keep `{ at, error, count }` per `id@version` after an exit before ready (or a crash within, say, 30 s of ready); while inside an exponential window (1 s, 2 s, 4 s … 60 s) answer 503 with the last error instead of spawning. Reset on `changed()`, a version change, or the add-on being turned on again.
- effort: S
- risk of the fix: a plugin that legitimately restarts would wait a second; test a plugin that throws in `apply`, and one that exits after ready.

### 3. A panel with `sessions: "all"` loads every session's whole timeline into the engine's memory for good, on each `sessions.list`
- category: perf
- severity: medium
- confidence: confirmed
- where: `engine/src/panels.ts:185-194`; cache in `engine/src/store.ts:461-463` (timelines are only dropped at `store.ts:394`, on delete)
- evidence:
  ```ts
  case "sessions.list":
    return env.threads().filter((t) => !t.archived).sort(...).slice(0, 200).map((t) => { const ch = changesOf(env.timeline(t.id)); ...
  ```
- what goes wrong: the first call reads and parses up to 200 timeline logs from disk synchronously, and `store.timeline` keeps each parsed array in `items` until the session is deleted. A user with many long sessions gets hundreds of MB held in the engine because one panel listed sessions; every later call re-walks all of those arrays (`changesOf` over every item). Panels are told to redraw on `liner.on("session")`, so this can run on each session event.
- fix: compute the per-session change summary from data the thread already keeps (or a small per-thread cache keyed by `updatedAt`), and read timelines that aren't cached without putting them in the store's cache (a `peek` read).
- effort: M
- risk of the fix: the counts must match what `session.info` says; compare both on a session with reverted and committed checkpoints.

### 4. Launch: first paint waits on `whoami()`, and the engine waits on a login shell that only starts after `whenReady`
- category: perf
- severity: medium
- confidence: confirmed (order of operations); the time saved is suspected (not measured)
- where: `desktop/src/main.ts:957-1005`, `desktop/src/engine.ts:181-202`, `:226-230`
- evidence:
  ```ts
  createWindow();
  mac?.quietWritingBadge();
  const who = await whoami();            // two child processes before anything loads
  ...
  void win?.loadURL(`data:text/html;...bootPage(...)`);   // the window shows on ready-to-show, after this load
  ...
  const [env, own] = await Promise.all([loginEnvironment(), keys.all()...]);   // `zsh -i -l -c`, up to 8 s (+5 s fallback)
  engine.start(paths, ...)
  ```
- what goes wrong: the window is created `show: false` and shown on `ready-to-show`, which needs the boot page to load, which waits for `id -F` and `scutil` (normally tens of ms, up to the 5 s `run` timeout each). The engine, which is the long pole, is spawned only after an interactive login shell has run its rc files (nvm, oh-my-zsh: often 0.5-2 s), and that shell is started only after Electron's `whenReady`.
- fix: start `const envP = loginEnvironment(); const whoP = whoami();` at module top level (neither needs Electron), load the boot page right after `createWindow()`, and await `whoP` only where `boot.user` is needed (before the engine origin loads). `keys.all()` still has to wait for ready (safeStorage).
- effort: S
- risk of the fix: `boot.user`/`machine` must be set before the real page reads `liner:boot`; it is read when the engine origin loads, which already comes after the env. Test first launch, dev mode (`LINER_UI_URL`), and a shell rc that stalls.

### 5. The updater does a full network check and runs every tool's `--version` (and `hermes update --check`, a git fetch) 8 s after every launch, ignoring the `checkedAt` it saves
- category: perf
- severity: medium
- confidence: confirmed
- where: `engine/src/updates.ts:281-286` (`start`), `:313-317` (`look`), `:546-583` (`checkTools`), `:140-147` (Hermes), `:177`/`:224` (`checkedAt` read but never compared)
- evidence:
  ```ts
  start() {
    this.timers.push(setTimeout(() => void this.auto(), 8000));
    this.timers.push(setInterval(() => void this.auto(), EVERY));
  ```
  `checkedAt` appears only in `state`, `save` and the constructor's read.
- what goes wrong: restarting the app (an update, "Start without add-ons", a crash relaunch, a quick quit and reopen) re-runs GitHub + four npm registry requests + up to five CLI processes (`claude --version` etc. are Node start-ups) + a ~20 s Hermes git fetch, right when the first turns of the session are starting. Six hours between checks is the intent; in practice it is "every launch".
- fix: in `start`, schedule the first `auto()` at `max(8 s, checkedAt + EVERY - now)`; keep "Look now" (`check`) unconditional.
- effort: S
- risk of the fix: an app that is always restarted within 6 h would rely on the interval; fine since the interval timer still runs. Test with a `state.json` checkedAt one hour old.

### 6. `sessions.recent` walks Codex's whole sessions tree with sync fs on the engine's thread, again on each window focus after a minute
- category: perf
- severity: medium
- confidence: likely (the walk is confirmed; the size of `~/.codex/sessions` on a heavy user is the assumed link)
- where: `engine/src/imports.ts:123-139` (`rollouts`), `:99-111` (`newest`: `statSync` on every file), `:168-185`, `:198-208`; caller `engine/src/api.ts:814`; UI trigger `ui/src/app/Sidebar.tsx:1406-1418` (focus/visibilitychange when the last read is a minute old)
- evidence:
  ```ts
  for (let dir = dirs.pop(); dir !== undefined; dir = dirs.pop()) { entries = readdirSync(dir, { withFileTypes: true }); ...
  const newest = (files) => files.flatMap((f) => { const st = statSync(f, ...); ... }).sort(...).slice(0, LATEST);
  ```
- what goes wrong: Codex keeps every rollout ever, in `YYYY/MM/DD` folders. Each read lists every folder and stats every file (thousands after months of use) synchronously, then reads 96 KB of each of the newest 60, all while the engine's event loop is blocked, so every live session's stream stalls for that time. It runs each time the window comes back to the front after a minute.
- fix: the folders are named by date, so walk them newest first (sort the year, month and day names descending) and stop once `LATEST` files are collected; optionally cache `path -> {id, cwd, title}` per run, since a rollout's head never changes.
- effort: S
- risk of the fix: a rollout with an old folder but a recent mtime (resumed session) would be missed; walk the newest few day folders plus anything with mtime newer than the cutoff, or accept it. Test against a tree with resumed sessions.

### 7. The Glass and Vibrancy materials are dead: the page has not sent `setGlassRect` since 29 Oct and only ever sends solid, clear or frost
- category: dead
- severity: medium
- confidence: confirmed
- where: `desktop/src/main.ts:120`, `:144-152`, `:368-372` (`rectOf`/`frameOf`), `:519-532` (`setMaterial` defaulting to "glass", `setGlassRect`); `desktop/src/mac.ts:10`; `desktop/native/mac.mm:63-73` (`frameMask`), `:84-93`, `:109-163` (vibrancy, `NSGlassEffectView`, mask layer); `ui/src/app/bridge.ts:115-126`; Swift twin `mac/Sources/LinerCode/AppDelegate.swift:196-199`, `:286-293`
- evidence: `git grep -n -i 'setGlassRect'` finds only the definitions (main.ts, AppDelegate.swift, bridge.ts) and no caller; `git log -S'setGlassRect(' -- ui/src` shows the last caller removed in 35d3511 ("Seamless: one ground …"). The only `setMaterial` call is `ui/src/app/look.ts:138`: `bridge.setMaterial(!desk ? "solid" : l.bgFrost === true ? "frost" : "clear", ...)`.
- what goes wrong: nothing visible (an old `prefs.material` of "glass" now renders as solid because the rect is 0×0), but about 80 lines of native and shell code, a bridge method and the `hole`/mask plumbing are kept and must be reasoned about on every Electron upgrade.
- fix: drop `setGlassRect`, `glassRect`, `frameOf`, the `hole` type and the vibrancy/glass branches; have `backdrop` handle solid/clear/frost only; map any stored material other than clear/frost to solid in `loadPrefs`. Keep `trafficLightPosition` and the Electron `vibrancy` constructor option only if the transparent-page trick still needs it (the comment at main.ts:212-213 says it does).
- effort: S
- risk of the fix: the see-through window; test clear, frost, solid, full screen in and out, and a profile whose shell.json says "glass".

### 8. A window saved maximized is shown before its first paint: `maximize()` on a hidden window shows it
- category: ux
- severity: low
- confidence: likely (Electron documents that `maximize()` "will also show (but not focus) the window if it isn't being displayed already")
- where: `desktop/src/main.ts:210`, `:220`, `:227-230`
- evidence:
  ```ts
  win = new BrowserWindow({ ..., show: false, backgroundColor: mac ? "#00000000" : windowColor(), ... });
  if (prefs.maximized) win.maximize();
  ```
- what goes wrong: for someone who keeps the window maximized, it appears before `ready-to-show`, and with the Mac addon its background is fully transparent, so there is a frame of empty glass (or the desktop) before the boot page draws. It also bypasses the `app.focus` in `ready-to-show`.
- fix: pass the work area as the initial bounds when maximized, and call `maximize()` inside the `ready-to-show` handler before `show()`.
- effort: S
- risk of the fix: un-maximize must return to `prefs.bounds`; set them first. Test maximized launch on one and two displays.

### 9. A DSH plugin's host.log grows without limit while its program runs
- category: bug
- severity: low
- confidence: confirmed
- where: `engine/src/dsh-hosts.ts:476-478`, `:498-506`
- evidence:
  ```ts
  const log = openSync(logFile, "a");
  if (fstatSync(log).size > LOG_MAX) ftruncateSync(log, 0);
  ... child.stdout?.on("data", write); child.stderr?.on("data", write);
  ```
- what goes wrong: `LOG_MAX` (1 MB) is checked only when the program starts. A plugin that logs on each poll or each tool call fills `~/.liner-code/addons/<id>/host.log` for as long as the engine runs (days, for a Mac left open).
- fix: count bytes in `write`, and past `LOG_MAX` truncate (or rename to host.log.1 and reopen).
- effort: S
- risk of the fix: none worth naming; the log is only read by people.

### 10. Adding a DSH plugin from npm unpacks it synchronously on the engine's thread
- category: perf
- severity: low
- confidence: confirmed (sync calls); stall length suspected
- where: `engine/src/dsh.ts:134-190` (`untar`: `gunzipSync` up to 210 MB, `writeFileSync` per entry), `:423-427` (`digestOf`), `:717` (reads every host .js file), `engine/src/sources.ts:102`
- evidence: `tar = gunzipSync(tgz, { maxOutputLength: UNPACKED_MAX + 50_000_000 });` then a loop of `mkdirSync`/`writeFileSync`.
- what goes wrong: a large package (the limits allow a 60 MB tarball) freezes every session's stream, the event stream to the window and every RPC for the seconds it takes to inflate and write.
- fix: `await promisify(gunzip)` (off-thread in libuv) and `await writeFile` in the loop; the rest of `readDsh` is small.
- effort: S
- risk of the fix: concurrent adds into the same staging token folder can't happen (random token); test a scoped package and a pax-header tarball.

### 11. Under `npm run app:dev` the shell's own RPC goes to port 0 with the wrong token: tray Allow and "Quit When It Finishes" never work
- category: bug
- severity: low
- confidence: confirmed
- where: `desktop/src/main.ts:338-343` (`engineRpc`), `:973-977` (dev branch), `:887-911` (`checkWaiting`)
- evidence:
  ```ts
  if (devUrl) { boot.token = process.env.LINER_TOKEN || "liner-dev"; appOrigin = new URL(devUrl).origin; void win?.loadURL(devUrl); return; }
  ...
  fetch(`http://127.0.0.1:${engine.port}/rpc`, { ... "x-liner-token": engine.token ...
  ```
  `engine.port` stays 0 and `engine.token` is a random value the dev engine never saw.
- what goes wrong: in dev, the menu bar item's request list is always empty, its Allow fails, and choosing "Quit When It Finishes" hides the window and polls a dead address every 3 s forever (each failure is caught and logged), so the app never quits by itself.
- fix: in the dev branch set `engine.port = 7317` (or read `LINER_ENGINE_PORT`) and give `engineRpc` the dev token (`boot.token`) instead of `engine.token`.
- effort: S
- risk of the fix: dev only.

### 12. The older Swift shell (mac/, about 760 lines) has drifted from the bridge and is kept alive by a script and by fallbacks in the page
- category: dead
- severity: low
- confidence: confirmed (drift); whether to keep it is the owner's call
- where: `mac/Sources/LinerCode/AppDelegate.swift:256-311` (no `status`, `relaunch`, `installUpdate`, `shotUrl`, `shotPage`, `setMenuFace`), `package.json` `"mac:swift"`, `scripts/build-mac-swift.sh`; the page side that only it uses: `ui/src/app/bridge.ts:12-13`, `:27-47` (webkit path, `__linerReply`), `:154-164` (`enableWindowDrag`); `desktop/src/main.ts:548-552` (`dragWindow`, `zoomWindow` cases, only reachable from that webkit path)
- evidence: `git grep -n 'zoomWindow\|dragWindow' -- ui/src` hits only `bridge.ts:160-161` inside `enableWindowDrag`, which returns at once unless `window.webkit` exists. README.md:413 calls it "the older Swift shell".
- what goes wrong: a second shell that no longer runs the current app correctly (no quit-wait, no updates, no off-screen shots) still has to be kept compiling, and its fallbacks sit in the page and in main.ts.
- fix: if the Electron shell is the only one shipped, delete `mac/`, `scripts/build-mac-swift.sh`, the `mac:swift` script, the webkit branch of `bridge.ts`, and the `dragWindow`/`zoomWindow` cases. Keep `desktop/src/keys.ts`'s one-time keychain migration.
- effort: S
- risk of the fix: anyone still on a Swift build loses nothing they can update anyway; check README and docs references.

### 13. Exports nothing uses
- category: dead
- severity: low
- confidence: confirmed
- where: `engine/src/dsh.ts:481` (`HOST_SERVICES`), `contracts/src/dsh.ts:22-26` (`DSH_PATH`, `dshBase`), `contracts/src/panel.ts:28-32` (`PanelRequest`, `PanelReport`, `PanelReply` types), `engine/src/updates.ts:63-66` (`versionParts` exported, used only inside the file)
- evidence: a sweep of every `export` in the files in scope against `git grep -lw <name> -- engine ui/src contracts desktop scripts` excluding the defining file. `HOST_SERVICES` and `dshBase` appear only at their definitions; `DSH_PATH` only inside `dshBase`. (The dsh-shims.ts exports also show no callers but are the module plugins import, so they stay.)
- what goes wrong: `HOST_SERVICES` reads like the list dsh-host.ts enforces, but dsh-host.ts has its own `services` object, so the two can disagree silently.
- fix: delete `HOST_SERVICES`, `dshBase`/`DSH_PATH`; keep the panel message types only if they are meant as documentation (then use them in the UI's handler).
- effort: S
- risk of the fix: none.

### 14. `shoot()` and `look()` in main.ts are the same function twice
- category: refactor
- severity: low
- confidence: confirmed
- where: `desktop/src/main.ts:393-416` and `:432-464`
- evidence: both build an identical hidden `BrowserWindow` with the same `webPreferences`, the same `setWindowOpenHandler` and `will-frame-navigate` guard, the same 15 s load race inside the `stuck(w)` race, a settle wait, `capturePage`, and `w.destroy()` in `finally`; `look` adds console errors and a resize to the page's height.
- what goes wrong: a fix to the off-screen window's guard (the security-relevant part) has to be made twice.
- fix: one `offscreen(url, w, h, after: (win) => Promise<T>)` helper holding the window, guards and deadlines; `shoot` and `look` pass their capture step.
- effort: S
- risk of the fix: test both shot kinds and a page that never finishes loading.

### 15. Version comparison is written three times
- category: refactor
- severity: low
- confidence: confirmed
- where: `desktop/src/update.ts:18-25` (`parts`, `newer`), `contracts/src/index.ts:1950-1957` (`newerVersion`), `engine/src/updates.ts:63-67` (`versionParts`, `versionOf`); also `BUNDLE_ID`/`APP_NAME` in both `desktop/src/update.ts:15-16` and `engine/src/updates.ts:31-32`
- evidence: the same `/(\d+)\.(\d+)\.(\d+)/` and three-part loop in each.
- what goes wrong: the shell and the engine decide "newer" for the same staged update; if one copy changes (a pre-release suffix, say), the engine stages an update the shell refuses, or the reverse.
- fix: desktop already imports from contracts (`main.ts:14`); import `newerVersion` in `update.ts`, and move the two constants next to it.
- effort: S
- risk of the fix: esbuild bundles contracts into main.cjs already; none.

### 16. Duplicated checks in the add-on sources
- category: refactor
- severity: low
- confidence: confirmed
- where: `engine/src/sources.ts:146-152` and `:174-179` (the "You already have an add-on called …" id/source clash, word for word); `engine/src/dsh.ts:484` and `engine/src/addons.ts:230` (`TOOL_NAME`, same regex); `engine/src/dsh.ts:44` vs `engine/src/addons.ts:266` (package-name regex, written twice with different length limits)
- evidence: lines 146-152 and 174-179 differ only in `from` vs `o.from`.
- what goes wrong: the clash rule protects keys and storage kept by id; a change to it in one path and not the other lets an npm package take over a GitHub add-on's keys or the reverse.
- fix: one `clash(manifest, from)` in sources.ts; export `TOOL_NAME` and the package-name regex from one place.
- effort: S
- risk of the fix: none.

### 17. A panel's storage is read from disk on every get and rewritten whole on every set
- category: perf
- severity: low
- confidence: confirmed
- where: `engine/src/addons.ts:613-633`
- evidence: `storage(id)` does `readFileSync` + `JSON.parse` each call; `store()` reads it all, changes one key, `JSON.stringify` + `writeAtomic` (tmp file + rename) of up to 1 MB.
- what goes wrong: the guide's own notes starter saves 600 ms after typing stops, so a 1 MB store costs a 1 MB parse and an atomic 1 MB write per pause, on the engine thread, plus a read per `get`.
- fix: keep the parsed object in memory per id (invalidated on install/remove), and debounce the write (flush on quit).
- effort: S
- risk of the fix: lose the last write on a crash within the debounce; flush in the engine's quit steps.

### 18. The menu bar item's menu waits for up to eight engine calls, with no time-out, before it opens
- category: ux
- severity: low
- confidence: likely (assumes a busy or hung engine; a refused connection fails fast)
- where: `desktop/src/tray.ts:114-127`, `desktop/src/main.ts:338-343`
- evidence: `await Promise.all(needs.filter((n) => n.waiting).slice(0, 8).map(async (n) => { const items = await this.hooks.rpc("thread.items", { id: n.id }) ...` and `engineRpc` is a bare `fetch` without a signal. Each `thread.items` returns the whole timeline.
- what goes wrong: clicking the item while the engine is busy (a large session's timeline to serialise, or the sync work in findings 6 and 10) shows nothing until every answer is in; the click feels dead.
- fix: `AbortSignal.timeout(800)` in `engineRpc` for the tray, and show the menu without Allow rows for any that didn't answer. Longer term, an RPC that returns only open approvals.
- effort: S
- risk of the fix: none.

### 19. Sign-in scripts and problem reports are left in the temporary folder
- category: polish
- severity: low
- confidence: confirmed
- where: `desktop/src/main.ts:650-668` (`runInTerminal` writes `liner-<hex>.command` / `.cmd`), `:786-797` (`reportProblem` copies engine.log and engine.previous.log into `$TMPDIR/Liner Code report …/` and zips it)
- evidence: no `rmSync` follows either.
- what goes wrong: each sign-in leaves an executable script, and each report leaves an unzipped copy of the logs (which hold folder names and agent output, as the dialog warns) in `$TMPDIR` until macOS sweeps it.
- fix: remove the report folder after `ditto` succeeds; delete `.command` files older than a day at launch (the script itself can't delete itself before Terminal reads it).
- effort: S
- risk of the fix: none.

### 20. Proxy servers are never closed before the engine quits, and the frame agent is read from disk on each page
- category: perf
- severity: low
- confidence: confirmed
- where: `engine/src/proxy.ts:205-208` (`open`, `folders` maps), `:396-400` (`closeAll`, called only at quit, `engine/src/main.ts:217`), `:57-63` and `:388` (`frameAgent()` → `readFileSync` per HTML response), `:216-305` (files server uses `realpathSync`/`statSync`/`readFileSync` per request)
- evidence: `git grep -n 'closeAll\|proxies\.' -- engine/src` shows no other close.
- what goes wrong: every dev-server port and every session folder ever browsed keeps two listening sockets (127.0.0.1 and ::1) for the life of the engine; a long-running engine with many sessions accumulates them. Each proxied HTML page re-reads the frame agent file.
- fix: cache `frameAgent()` once (or by mtime); close a folder's server when its last session is archived or deleted (the engine already has that hook for terminals, `closeThread`).
- effort: S
- risk of the fix: a page still open for an archived session would lose its server; acceptable.

### 21. The proxy decodes every HTML answer as UTF-8 and drops its content-encoding
- category: bug
- severity: low
- confidence: suspected
- where: `engine/src/proxy.ts:325` (`"accept-encoding": "identity"`), `:384-393`
- evidence:
  ```ts
  const body = withProbe(Buffer.concat(chunks).toString("utf8"), ...);
  delete headers["content-length"]; delete headers["content-encoding"];
  ```
- what goes wrong: a dev server that compresses regardless of `accept-encoding` gets its gzip bytes decoded as text and served as plain HTML (a garbage page); a page in another charset (Shift_JIS, Latin-1) has its non-ASCII text mangled. Both are rare with Vite/Next.
- fix: if `content-encoding` is gzip/br/deflate, inflate before injecting; take the charset from `content-type` and re-encode with it, or inject into the bytes before the first `<script`/after `<head>` without decoding.
- effort: S
- risk of the fix: test Vite, Next and a static server with gzip on.

### 22. The Apple Intelligence badge hider runs on every pass of the app's event loop
- category: perf
- severity: low
- confidence: suspected
- where: `desktop/native/mac.mm:203-216`
- evidence: an observer on `NSApplicationDidUpdateNotification` (posted after every event the app handles: each mouse move, key, timer) iterating `NSApp.windows` and doing `NSStringFromClass(...) containsString:` on each.
- what goes wrong: small but constant main-thread work during pointer movement and typing in the composer.
- fix: observe `NSWindowDidBecomeKeyNotification`/`NSWindowDidUpdateNotification` filtered to the badge's window class, or check only when the window count changes.
- effort: S
- risk of the fix: the badge must still be hidden on macOS 27; test focusing the composer.

### 23. The GitHub CLI token is looked up once per run, "none" included
- category: bug
- severity: low
- confidence: confirmed
- where: `engine/src/updates.ts:354-360`
- evidence: `if (this.token === null) { ... this.token = ... || undefined }`; `undefined` is never asked again.
- what goes wrong: someone on a private release repository who runs `gh auth login` after the app started keeps getting "Couldn't reach GitHub: 404" until they restart Liner Code.
- fix: cache `undefined` for a few minutes only, or re-ask when a check fails with 401/403/404.
- effort: S
- risk of the fix: one extra `gh auth token` per failed check.

---

## In good shape (checked, nothing to report)
- Desktop IPC: `ipcMain.handle("liner")` checks sender, main frame and origin (`main.ts:379-387`); every argument goes through `str`/`num`; `openExternal` and the window-open handler allow only http(s)/mailto; `will-frame-navigate` keeps the main frame on the app's origin and sealed frames on their document; `will-attach-webview` denied; permission handler allows two permissions to the app origin only.
- `webPreferences`: `sandbox`, `contextIsolation`, no `nodeIntegration`, devtools off unless `LINER_INSPECT`; off-screen windows add `disableDialogs` and deny popups.
- Engine child lifecycle: token and keys over stdin, not env; restart on the same port and token with a five-a-minute cap; stdin EPIPE handled; Windows waits for the save before quitting; the engine quits on stdin end, so a force-quit shell leaves no orphan; `dsh-host.ts` quits on IPC disconnect, so plugin programs don't outlive the engine either.
- Renderer crash reload capped at three a minute; listeners are attached once (one window per run); `nativeTheme`/tray listeners guarded.
- Quit-when-done logic (`finish.ts`) is pure, settles 2.5 s, and handles "waiting for days" sessions correctly.
- Updates: SHA-256 required, bundle id, version and signature re-checked, team-id pinning, stall time-out on the download, swap script restores the old copy on failure and reports why; `staged()` re-checks everything in the shell.
- `proxy.ts` access rules: Host-header check against DNS rebinding, own Origin stripped only for itself, folder server follows links and rejects dotfiles, `O_NOFOLLOW` single descriptor, HTML escaped in notes, upstream request destroyed when the page goes.
- DSH: tarball integrity checked, tar reader refuses links, `..`, devices and over-size; npm deps installed with scripts off, empty npmrc, registry pinned; sandbox profile is an allowlist for writes; tools offered only by the names on the card; MCP calls capped at 16 with a 4 MB body limit and heartbeats.
- Terminals: backlog capped by lines and bytes, output batched at 16 ms, Python pty holds typed input instead of blocking, SIGHUP on close.
- `precheck.ts`, `export.ts`, `outside*.ts`, `backgrounds.ts`, `apps.ts`, `offers.ts`, `creator.ts`, `buildlinks.ts`: no bugs found; `outside-tools` polls once a second only while an outside agent waits.
- Scripts: `dev.ts`, `build-mac.sh`, `release.sh` are each reachable from `package.json` and fail early on missing tools.

## Not covered
- `engine/src/dsh-shims.ts` beyond its header and exports (the schema DSL and argument validation were not read line by line).
- `contracts/src/cast.ts` logic (only its exports were checked for use).
- The Swift sources were compared against the bridge, not audited.
- `winterm.ts` only read, not reasoned through for Windows edge cases (no Windows run).
- Nothing was run: timings in findings 4, 6, 10 and 22 are not measured.
- Routines: skipped as instructed.
