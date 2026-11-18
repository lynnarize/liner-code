# Audit: UI CSS, bundle and dead files

Auditor area: `ui/src` CSS, the Vite bundle, dead files and exports across ui, engine, contracts and desktop, the vendored `ui/src/liner`, and stray repo files. Read only. Analysis scripts are in the scratchpad (`graph.mjs`, `static.mjs`, `minsize.mjs`, `css.mjs`, `exp.mjs`, `exports.mjs`). The minified-size numbers come from running each statically reachable source file through the repo's own esbuild (`transform`, minify). That is an estimate per file, with no bundling and no `vite build`. Its totals line up with `ui/dist/assets`: 857 KB of source plus about 190 KB of React gives the 1.04 MB main chunk.

Note: the sidebar rewrite that was uncommitted at the start was committed during the audit as `220cc0e` ("A new left panel: sessions by folder..."). "(new today)" below means code in `220cc0e` or `de80da8` (Liner Security, also from today). The working tree did not change under me after that, and the analysis was re-run on the committed state with identical results.

## Ranked findings

### 1. `.ld-sel` and `.ld-empty` are defined in two Design stylesheets with conflicting rules; the inspector's copy loads later and breaks the canvas's
- category: bug
- severity: medium
- confidence: likely (the cascade order is confirmed from the build; I did not watch it on screen)
- where: ui/src/app/design/design-face.css:654 and ui/src/app/design/inspector.css:322 (`.ld-sel`); design-face.css:472 and inspector.css:479 (`.ld-empty`)
- evidence:
  - design-face.css:654 `.ld-sel { position: absolute; z-index: 2; box-shadow: 0 0 0 1.5px var(--l-accent); }` is the canvas selection box. In Canvas.tsx:640 it is placed with `style={b}` (left/top/width/height).
  - inspector.css:322 `.ld-sel { position: relative; }` is a select drawn as a field. In inspect/controls.tsx:253 the markup is `<label className="ld-fld ld-sel">`.
  - In the build, design-face.css lands in `Skills-Df2vYMtQ.css` and inspector.css in `Shell-C8lRpt8J.css`. Vite's preload list for the Design shell is `..."./Skills-BPOVsq6M.js","./Skills-Df2vYMtQ.css","./Shell-C8lRpt8J.css"...` (index-Dr1PxeHg.js, `__vite__mapDeps`), so the inspector sheet is appended last and wins ties.
- what goes wrong: Both selectors have the same specificity, so these properties merge:
  - Every canvas selection box gets `position: relative`. A single selection still lands right, because its static position is the container's origin. With two or more selected nodes, each later box is pushed down by the heights of the boxes before it.
  - Every inspector select field (`.ld-fld.ld-sel`) picks up `z-index: 2` and the accent ring `box-shadow: 0 0 0 1.5px var(--l-accent)`.
  - `.ld-empty` merges both ways. The canvas empty state (DesignFace.tsx:344) gets `display: grid; padding: 24px 28px 80px; flex: 1` and its absolute inset is padded. The inspector's empty state (inspect/Empty.tsx:5) and ChecksTab.tsx:105 get `position: absolute; inset: 0 0 160px`.
- fix: Rename the inspector's classes (`.ld-fsel`, `.ld-insp-empty`) or scope them (`.ld-insp .ld-sel`, `.ld-insp .ld-empty`). Then select two layers on the canvas and check that the boxes sit on them.
- effort: S
- risk of the fix: Low. Check the inspector's select fields, the Checks tab empty state and the canvas empty state.

### 2. Panel and App statically import every side-panel surface and the Add-ons page, so about 60 to 165 KB of minified JS is in the main chunk the first frame never shows
- category: perf
- severity: medium
- confidence: confirmed (import graph); the saving is an estimate
- where: ui/src/app/Panel.tsx:31-44, ui/src/app/App.tsx:53,55,56
- evidence: `import { BrowserSurface } from "./Browser"; import { DesignSurface } from "./Design"; import { DeviceSurface } from "./Device"; import { FilesSurface } from "./Files"; import { LinkedSurface, PrSurface } from "./Pr"; import { MoreFiles, Review, TurnPicker, Viewed } from "./Review"; import { RoutinesList, RunDetail } from "./Routines"; import { SideChat } from "./SideChat";` (Panel.tsx). `import { AddonsPage } from "./AddonsPage";` (App.tsx:53). Terminal and SessionInfo in the same file are already `lazy`.
- what goes wrong: Estimated minified sizes in the main chunk:

  | Module | Size | Imported only by |
  |---|---|---|
  | Review | 16.8 KB | Panel |
  | Device | 6.4 KB | Panel |
  | SideChat | 3.1 KB | Panel |
  | AddonsPage | 25.0 KB, plus addons-page.css 8.8 KB | App |
  | Routines | 11.3 KB | Panel, while App lazy-loads it; feature is off |

  That is about 63 KB that could split with no other change. Another roughly 100 KB needs one small helper moved out first:

  | Module | Size | Helper to move out first |
  |---|---|---|
  | Browser | 24.6 KB | `HiddenBrowsers` (App) |
  | Design + DesignMini | 36 KB | `startDesigns` (App), Page, Timeline |
  | Pr + PrCard | 32 KB | Timeline |
  | Files | 8.6 KB | Session |

  All of it is parsed and compiled at launch, which counts against the launch and first-token pass.
- fix: Load each surface with `lazy`, and preload it with the existing `early()` idle pattern from App.tsx:29-37 so the first open shows no fallback. Before splitting Browser, Design, Pr and Files, move the shared helpers (`HiddenBrowsers`, `startDesigns`, the parts Timeline uses from Pr and Design) into small modules.
- effort: M
- risk of the fix: Suspense fallbacks inside the panel. Each surface needs its first open checked, and a `Boundary` around it.

### 3. Opening or closing the sidebar animates `grid-template-columns` on the whole app for 520 ms, which reflows the thread, the composer and the panel on every frame
- category: perf
- severity: medium
- confidence: suspected (needs a performance trace on a long thread)
- where: ui/src/app/app.css:229 (`.lc-app { ... transition: grid-template-columns 520ms var(--l-spring-smooth); }`) and app.css:234 (`.lc-app[data-sidebar]`)
- evidence: The paper's column width changes every frame. The thread text re-wraps, and the composer's `::before` blur at 22 px (app.css:3209) is redrawn over new content. Quick motion (app.css:7486-7490) only covers `.lc-panel`, `.lc-sheet` and `.lc-session .lc-body`, not `.lc-app`. The memory note "Navigation feel" already measured 56 to 72 ms paints.
- what goes wrong: On a long thread, each frame of the 520 ms toggle is a full layout of every turn, so the toggle drops frames. The same pattern with `padding` (520 ms) is on `html[data-native="mac"] :is(.lc-top, .lc-panel-top)` (app.css:369) and `.ld-bar` (design-face.css:1258), but those only run on a full-screen change.
- fix: Either snap the column and slide the sidebar with `transform` (its width is already fixed, per the comment at app.css:236), or at least add `contain: layout paint` to the thread scroller and snap the change under `html[data-motion="quick"]`.
- effort: M
- risk of the fix: The sidebar's slide-under-the-edge look. Check that the window gap stays steady.

### 4. Streamed markdown animates `filter: blur(8px)` on every chunk span while an answer streams
- category: perf
- severity: low
- confidence: suspected
- where: ui/src/liner/pro/ai-kit/ai-kit.css:6-17 (`.l-chunk { animation: l-chunk-in 620ms ... }`, `@keyframes l-chunk-in { from { opacity: 0; filter: blur(8px) } }`); used through `StreamedMarkdown` at Timeline.tsx:282-289 (`animate={fresh(it.id)}`) and markdown.tsx:600 (`className={cls ? \`l-chunk ${cls}\` : "l-chunk"}`)
- what goes wrong: Each new chunk becomes its own filter layer for 620 ms. A fast stream keeps a dozen or more blur animations going at once, inside the scroller under the composer glass, so the backdrop blur is redrawn as well.
- fix: In app.css (the app already overrides Liner classes there), give `.lc-md .l-chunk` an opacity-only keyframe, or a blur of 2 px or less.
- effort: S
- risk of the fix: Only the look of streaming text.

### 5. Infinite `box-shadow` pulses repaint every frame while a run is going, one of them inside the scrolling thread
- category: perf
- severity: low
- confidence: likely
- where:
  - surfaces.css:4867-4880: `.lc-tstep[data-state="running"] .lc-tstep-dot { animation: lc-pulse-dot 1.6s ... infinite }`, whose keyframes animate a two-layer `box-shadow` out to 9 px.
  - crew.css:30-44: `.lc-cr-faces > span[data-lead] { animation: lc-cr-ring 1.6s ease-in-out infinite }`, also box-shadow.
- what goes wrong: Box-shadow cannot be composited, so each frame repaints the dot's area. The running step sits in the thread, and when it is under the composer, the 22 px backdrop blur is redrawn every frame for the whole run.
- fix: Draw the ring on a `::after` and animate `transform: scale()` and `opacity`, as `ld-pres::after` already does (design-face.css:626).
- effort: S
- risk of the fix: The look of the pulse.

### 6. Full-screen design view puts a 20 px backdrop blur over the whole app behind an 84%-opaque fill
- category: perf
- severity: low
- confidence: likely
- where: ui/src/app/design.css:492-505 (`.lc-dz-full { position: fixed; inset: 0; background: color-mix(in oklab, var(--lc-ground) 84%, transparent); backdrop-filter: blur(20px); ... }`)
- what goes wrong: Anything that keeps changing underneath (a streaming thread, a live browser panel) is blurred again over the whole window on every frame, for a blur that hardly shows through 84% fill. The small pills `.lc-dz-zoom` (design.css:277, 16 px) and `.lc-dz-over` (design.css:447, 14 px) cost little.
- fix: Drop the backdrop-filter and raise the fill to opaque.
- effort: S
- risk of the fix: None beyond the look.

### 7. About 600 lines (11 KB) of CSS no markup uses, mostly the old sidebar and the old Design dock; the sidebar rewrite committed today left none
- category: dead
- severity: low
- confidence: confirmed (selector classes checked against the string literals of every reachable .ts/.tsx/.html, then `git grep -F` per class; dynamic stems like `md-${c}` and `l-tok-${kind}` counted as used)
- where: The full block list with line ranges is in Appendix A. The biggest blocks:
  - face.css:20-63 and 125-127: `.lc-sb-face`. The switch left Sidebar.tsx in 0c55f8c on 2026-11-14; only `lc-sb-facepick` is used now.
  - design-face.css:808-827 (`ld-head`), 877-896 (`ld-sheet`), 917-944 (`ld-bubble`, `ld-tl`), 953-1010 (`ld-tiles`, `ld-tile*`), 1017-1019 (`lc-sb-face`), and chat.css:187-189 (`ld-sheet`). These left the code on 2026-11-13.
  - app.css:1391-1417 (`lc-sb-fdot`, `lc-sb-av`), 1508-1593 (`lc-sb-me`, `lc-sb-me-n`, `lc-sb-agent`), 1928-1987 (`lc-chain`), 4500-4528 (`lc-ask-p`, `lc-proj`), 4895-4935 (`lc-agent-card*`).
  - dock.css:584-620 and 946-948 (`lc-sb-more*`, last used 2026-11-05).
  - surfaces.css:513-568 (`lc-sinfo-file`, `-st`, `-path`, `-export`), 1593-1779 (`lc-pr-branches`, `-commit`, `-foot`, `-row`), 4133-4152 (`lc-swatch-own`), 6118-6151 (`lc-foot-changes`, `lc-trail-agents`).
- evidence:
  - Sidebar check: `git show HEAD~1:ui/src/app/Sidebar.tsx` lists 18 `lc-sb-*` classes that are gone now; `grep -rF` finds 0 hits for each in ui/src/app, and all 54 classes the commit added to CSS are referenced. So `220cc0e` is clean.
  - Exception: surfaces.css:622-625 `.xterm-viewport` is drawn by xterm at runtime, so it is not dead.
- fix: Delete the listed blocks. Where a dead selector shares a rule list with live ones (app.css:2786, 2803, 2815, 2917, 3356, 6264; surfaces.css:1672, 1681), delete only that selector.
- effort: S
- risk of the fix: Low. Grep each class once more before deleting, in case another session has brought it back.

### 8. Dead components and exports in the UI: TopBar, ContextMeter, LimitMeter and more; two Security helpers added today are already unused
- category: dead
- severity: low
- confidence: confirmed (`git grep -nw <name>` across ui/src, engine, contracts, desktop, scripts and site/scripts gives exactly 1 hit, the declaration)
- where:
  - ui/src/app/TopBar.tsx:127-150 `export function TopBar(...)`, plus `useGiveWay` and `GIVE` (TopBar.tsx:78-125), which only it uses. Nothing renders `<TopBar`; the last render was removed in 0c55f8c. The type `OpenTab` on TopBar.tsx:151 is unused too.
  - ui/src/app/ui.tsx:363 `ContextMeter` (about 45 lines) and ui.tsx:442 `LimitMeter` (about 60 lines). Last rendered in 0c55f8c.
  - ui/src/app/Composer.tsx:1892 `Hints`.
  - ui/src/app/icons.tsx:355 `ToolIcon`.
  - ui/src/app/model.ts:275 `statusLine`.
  - ui/src/app/dock.ts:58 `toggleDock`.
  - ui/src/app/security/parts.tsx:158 `ChoiceBox` and parts.tsx:233 `NotBuilt` (new today, de80da8).
  - ui/src/app/design: Frame.tsx:211 `heldMarks`, store.ts:301 `heldRedraws`, Skills.tsx:212 `useLoadedCount`, bridge.ts:320 `sizeOf`, inspect/target.ts:57 `once`, DesignFace.tsx:112 `cwdOf`.
  - Engine and contracts dead exports are in finding 13.
- what goes wrong: `noUnusedLocals` does not catch exported symbols, so this code stays, gets read and is shipped (tree-shaking drops most of it from the bundle).
- fix: Delete. TopBar.tsx keeps `onOpenSurface`, `openSurface`, `SideKeys`, `usePins` and `pin`, which are used. Its comments, and dock.css:8, 29 and 929, point at `useGiveWay`, so update or remove those comments.
- effort: S
- risk of the fix: Low. Run `npm run typecheck` in ui.

### 9. The Security mock (`scan-mock.ts`) ships in the production Security chunk, although its header says nothing here ships
- category: dead
- severity: low
- confidence: confirmed (its strings are in the build: `grep -lF "Routes under src/routes, who may call each" ui/dist/assets/*.js` gives `Shell-CMcQoVwZ.js`)
- where: ui/src/app/security/scan-mock.ts:5 (comment "Nothing here ships: every export answers null outside dev") and scan-mock.ts:14-18; call sites StartScan.tsx:42-44 and ScanSession.tsx:92-93,124
- evidence: `export function mockMode(): MockMode | null { if (!import.meta.env.DEV || ...) return null; ... }`. Call sites use `mockMode()` and then call `mockScan(...)` and `mockChoices(...)` under a runtime check.
- what goes wrong: Rollup does not fold a function's return value across modules, so `mockScan`, `mockChoices` and all their sample text (about 12 KB of source) stay in the lazy Security chunk. The design store's `?ld-mock` path is similar: `store-qSeqlLEI.js` still holds the `foreshore.css` mock string. `security/mock.ts` (`MOCK` is a module constant) folds correctly.
- fix: Guard each call site: `const mock = import.meta.env.DEV ? mockMode() : null;`.
- effort: S
- risk of the fix: None in production. Check the dev `?ls-mock=d` boards still open.

### 10. Liner: unused components are not bundled, but four stylesheets for things the app never renders ride along in the main CSS (about 15 KB of 434 KB)
- category: perf
- severity: low
- confidence: confirmed for the import chains; the sizes are estimates
- where:
  - `ui/src/liner/pro/agents/agents.css` (about 3.7 KB minified). It comes in only because Session.tsx:11, SideChat.tsx:9 and security/ScanSession.tsx:19 import the hook `useStickToBottom` from `@liner/pro/agents/agents`, and agents.tsx:10 has `import "./agents.css"`. No `l-agent*` class is rendered by the app.
  - `ui/src/liner/components/reasoning/reasoning.css` (about 3.5 KB). It comes in through `liner/pro/ai-kit/marks.tsx:37 export { SourceMark } from "../../components/reasoning/reasoning";`, reached by StreamedMarkdown, then cite.tsx, then marks.
  - `ai-kit.css:492-965`, "The AI surface" (about 10 KB source, about 7 KB minified): `l-ai-who`, `-source`, `-actions`, `-versions`, `-reasons`, `-menu`. No reachable code uses these classes; only unreached liner files do.
  - `code-block.css` `l-code__*` chrome (about 1.5 KB). code.tsx:7 imports the stylesheet only for its `l-tok-*` colours.
- what goes wrong: How the bundle is built today:
  - CSS is per component (no barrel). Of 161 liner directories, 119 are never imported (Appendix D). Vite never reads them, so the unreached 1.1 MB of liner source costs nothing in the bundle.
  - Liner makes up about 87 KB of the main CSS (about 20%) and about 96 KB of the main JS (about 9%). Nearly all of that is rendered. The exceptions are the stylesheets above, about 15 KB, roughly 3.5% of the main CSS.
  - pr-flow is imported type-only (Pr.tsx:14, PrCard.tsx:10), so pr-flow.css is correctly absent. workflow-builder is only in the lazy RoutineBuilder chunk.
- fix: Since files in `ui/src/liner` must not be edited by hand, fix this upstream in Liner UI:
  - Move `useStickToBottom` to `lib/hooks.ts`, or its own `pro/agents/stick.ts` with no CSS import.
  - Have `marks.tsx` re-export `SourceMark` from a file that does not import reasoning.css.
  - Split `ai-kit.css` into `markdown.css` (chunks, markdown, cite) and `surface.css`.

  Then re-run `scripts/sync-liner.sh`. Trimming the sync to an include list built from the import graph would only make the repo smaller, not the bundle, so it is optional.
- effort: S upstream
- risk of the fix: Other apps of the owner's that use these modules expect the CSS to come with them. Keep the old paths re-exporting.

### 11. Fonts: `font-display: swap` is set everywhere and nothing is preloaded; extra subsets and `.woff` fallbacks cost only package size
- category: polish
- severity: low
- confidence: confirmed
- where: ui/src/main.tsx:3-6; built `index-DGTAvCTv.css` (21 `@font-face` rules, all `font-display:swap`); `ui/dist/assets/*.woff*`
- evidence:
  - Inter Variable is the UI face (app.css:14-15).
  - Instrument Sans is used only for the app name (app.css:16 `--lc-font-name`, used at app.css:1045 and 8307) and as a fallback at surfaces.css:2580.
  - Geist Mono is used for code.
  - The Inter cyrillic, cyrillic-ext, greek, greek-ext and vietnamese subsets (about 134 KB) download only if those characters appear (unicode-range).
  - Every Geist Mono subset is emitted as both `.woff2` and `.woff`, about 70 KB of `.woff` that Chromium never loads. Two small symbols2 faces are inlined as base64.
  - `index.html` has no `<link rel="preload">`. Its only blocking work is the small inline theme script; the module script and the 434 KB stylesheet come after it.
- what goes wrong: On a cold start the boot text (`lc-boot`) can draw once in the system face and then swap to Inter, a one-frame flash. The extra files only weigh down the app package.
- fix: Optional. Preload `inter-latin-opsz-normal` (import it with `?url` and inject a preload link from main.tsx), or use `font-display: block` for Inter only. To drop the `.woff` duplicates, import Geist Mono's woff2-only CSS or write a small `@font-face` by hand.
- effort: S
- risk of the fix: None.

### 12. Repo leftovers: 7.4 GB in the ignored `build/`, plus untracked `site-next/` (217 MB), `ads/` (144 MB), `docs/demo/` and `.taste-skill/`
- category: dead
- severity: low
- confidence: confirmed
- where: repo root
- evidence:
  - `build/` is ignored, so it costs disk only. `build/release` holds 100 files, 6.4 GB: every win-x64 zip from 0.1.8 to 0.2.8 at about 154 MB each, mac dmgs back to 0.1.0, and so on. `build/Liner Code (0.2.7 before 16 Nov).app` is a stale 318 MB copy.
  - `site-next/` is untracked: 197 MB of `node_modules`, a `dist/`, and its own copy of `brand-kit.png`, sitting beside the live `site/`.
  - `ads/` is untracked, 144 MB, mostly mp4s (largest: `ads/release-0.2.2/video/liner-code-0.2.2-16x9.mp4`, 26 MB).
  - `docs/demo/` is untracked, 9.4 MB, but design/store.ts:1102-1103 `import.meta.glob`s `docs/demo/foreshore/*.html` for the dev mock. A fresh clone has no Foreshore sample, and the `?ld-mock` dev page is empty.
  - `.taste-skill/` is untracked, 1.4 MB of skill output (`direction.json`, `inspect/*.jpg`).
  - Tracked files total 23 MB over 928 files, which is healthy. The largest is `site/brand-kit.png` at 2.8 MB.
- fix:
  - Decide on `docs/demo` (commit it, since dev code depends on it).
  - Add `.taste-skill/`, `site-next/node_modules`, `site-next/dist` and probably `ads/**/*.mp4` to `.gitignore`.
  - Prune `build/release` down to the last two versions.
- effort: S
- risk of the fix: None. The owner decides.

### 13. Engine and contracts: dead exports and an unused keyframe
- category: dead
- severity: low
- confidence: confirmed (`git grep -nw` gives 1 hit each)
- where:
  - Engine:
    - `engine/src/doctor.ts:61` `setTurnMs`
    - `engine/src/dsh.ts:481` `HOST_SERVICES`
    - `engine/src/lean.ts:293` `leanRev`
    - `engine/src/risk.ts:1562` `toolRisk`
    - `engine/src/surfaces.ts:582` `parseTable`
  - Contracts:
    - `contracts/src/dsh.ts:26` `dshBase`
    - `contracts/src/index.ts:1004` `ItemKind`
    - `contracts/src/panel.ts:28-32` `PanelRequest`, `PanelReport`, `PanelReply`
    - `contracts/src/security.ts:324` `SCAN_ACCESS` (new today, de80da8)
  - `engine/src/dsh-shims.ts:40-42, 155, 215, 218` (`RUN_CODE_NAME`, `TOOL_ABORTED*`, `assertSupportedJsonSchema`, `validateArgs`, `projectToolSchema`) are unused too. That file is a port of DSH code, so they may be kept on purpose to stay a faithful copy.
  - Not dead: `titleOf` and `call` in canvas.ts, lean.ts, pictures.ts and buildlinks.ts are reached as `m.titleOf` and `m.call` through the module table in agent-tools.ts:42-110.
  - CSS keyframes: `@keyframes lc-pulse` (surfaces.css:5736) is never used. `@keyframes lc-row-in` is defined twice, identically (app.css:1291, surfaces.css:5026).
- fix: Delete. For the shims, keep them or add a one-line note saying why.
- effort: S
- risk of the fix: Engine typecheck plus `node --test` for risk and surfaces.

### 14. Custom properties: six defined and never read, and two read but never defined, so they always use the fallback
- category: dead
- severity: low
- confidence: confirmed
- where:
  - Defined, never read: `--lc-bar`, `--lc-bar-hover`, `--lc-bar-tile`, `--lc-ctl-tile`, `--lc-lift`, `--lc-warn-dot` (all app.css).
  - Read, never defined: `--l-font-sans` at surfaces.css:819 and 6213 (`font-family: var(--l-font-sans, inherit)`), which always resolves to `inherit`. The comment at surfaces.css:2561 already notes that it isn't a token. Also `--lc-lane` at design.css:409, which is always 0.
- fix: Delete the six. Replace `var(--l-font-sans, inherit)` with `inherit` or `var(--l-font-body)`, whichever was meant, and drop `--lc-lane` or set it.
- effort: S
- risk of the fix: None.

Routines (switched off on purpose, not reviewed): Routines.tsx, RoutineBuilder.tsx and engine/src/routines.ts come to 1363 lines. Panel.tsx:42's static import keeps Routines.tsx (11 KB minified) in the main chunk even though App lazy-loads it; this is counted in finding 2.

## In good shape (checked)
- **Reduced motion.** It is honoured everywhere: a catch-all at `liner/foundation.css:619-627` cuts every animation and transition on `.l-scope *` (and the body carries `l-scope`), JS springs check `prefersReducedMotion()`, and the only WAAPI call is in the unreached `lib/flip.ts`. The Motion setting (Quick) only governs entry motion, as look.ts:21-22 intends; things that arrive while you watch still animate.
- **Liner glass.** `index.html` sets `data-blur="fake"`, so Liner's `--l-backdrop` and `--l-frame-backdrop` resolve to `none`. Pops, toasts, the command menu and dialogs do not blur. The real backdrop blurs are the composer glass (app.css:3209, on `::before`, a deliberate choice), the sidebar foot's 44 px sticky strip at 5 px (app.css:1178), and finding 6.
- **No `transition: all`** anywhere. There is one `will-change` (`.ld-plane`, the zoomed canvas plane), which is justified.
- **`:has()`** is used 51 times, almost all with a child combinator or a narrow subject class. None is on `html`, `body` or a scroller's root.
- **The lazy split is good otherwise.** Settings, Usage, Wall, Setup, Compare, RoutineBuilder, Terminal (341 KB), SessionInfo, the Design face (Canvas 172 KB, Shell, Tabs, Layers, Intro with its three jpgs at about 160 KB), the Security face, and the DSH platform (222 KB, a second React built as a string) are all separate chunks. None of them is pulled back into main by a static import, except Routines.
- **Dead files.**
  - UI: from `ui/src/main.tsx` (static imports, `import()`, CSS, `@liner`, `@contracts`), every file under `ui/src/app` is reachable except `design/inspect/dev.tsx`, a dev-only page its header says nothing imports. `dsh-platform.d.ts` is a types file.
  - Engine: from `engine/src/main.ts`, every file is reachable once `script("dsh-host")`, `script("dsh-mcp")`, `script("dsh-shims")` and `script("mcp")` count as entries. No engine file is reachable only from tests.
  - Desktop: every file is reachable from `main.ts` + `preload.ts`.
- **Today's sidebar commit** (`220cc0e`) removed its old CSS together with its old markup, and its new rules are cheap (background transitions, an opacity-only `lc-row-in`, `:has` on child combinators).

## Not done
- No runtime traces: findings 3 to 6 are not measured. Finding 1 is reasoned from the cascade order, not seen on screen.
- Per-class usage inside liner CSS files is only module-level. A class counts as used if its liner module is reached, even when the component that uses it is never rendered. That is why ai-kit and code-block were checked by hand and others were not.
- "Can lose the export keyword" (310) and test-only (215) exports are listed in Appendix E but not reviewed one by one.
- I did not read component logic. Other auditors own that.

---
## Appendix A. Unused CSS classes per file

Method: css.mjs parses each stylesheet that is reachable from main.tsx (the app's CSS plus the liner CSS that is actually imported) and pulls the class names out of every selector. A class counts as used if it appears in a string literal of any reachable .ts or .tsx file or in index.html. "maybe" means the class shares a stem with a dynamic template (`x-${...}` or `"x-" +`). "engine/unreached" means it is mentioned only in engine/contracts code or in an unreached UI file. A rule is listed as dead when every selector in its list has an unused class; the line ranges below are those rules merged. No files in ui/src/liner are listed for deletion (see finding 10).

| file | classes | unused | maybe | engine-only | dead rule lines |
|---|---|---|---|---|---|
| ui/src/app/app.css | 619 | 19 | 6 | 0 | 195 |
| ui/src/app/surfaces.css | 556 | 17 | 15 | 0 | 159 |
| ui/src/app/design/design-face.css | 103 | 10 | 0 | 0 | 129 |
| ui/src/app/dock.css | 90 | 2 | 0 | 0 | 40 |
| ui/src/app/face.css | 6 | 2 | 0 | 0 | 47 |
| ui/src/app/design/chat.css | 48 | 1 | 0 | 0 | 3 |
| ui/src/app/timeline.css | 37 | 1 | 0 | 0 | 15 |
| ui/src/app/updates.css | 11 | 1 | 0 | 0 | 4 |
| ui/src/liner/lib/field.css | 8 | 1 | 0 | 0 | 0 |
| ui/src/app/addons-page.css | 40 | 0 | 0 | 0 | 0 |
| ui/src/app/agentic.css | 16 | 0 | 0 | 0 | 0 |
| ui/src/app/crew.css | 71 | 0 | 0 | 0 | 0 |
| ui/src/app/design/build.css | 60 | 0 | 0 | 0 | 0 |
| ui/src/app/design/checks.css | 24 | 0 | 0 | 0 | 0 |
| ui/src/app/design/inspector.css | 46 | 0 | 0 | 0 | 0 |
| ui/src/app/design/intro.css | 80 | 0 | 0 | 0 | 0 |
| ui/src/app/design/lean-page.css | 64 | 0 | 0 | 0 | 0 |
| ui/src/app/design/live.css | 3 | 0 | 0 | 0 | 0 |
| ui/src/app/design/ways.css | 23 | 0 | 0 | 0 | 0 |
| ui/src/app/design.css | 63 | 0 | 0 | 0 | 0 |
| ui/src/app/models.css | 45 | 0 | 0 | 0 | 0 |
| ui/src/app/modes.css | 21 | 0 | 0 | 0 | 0 |
| ui/src/app/precheck.css | 12 | 0 | 0 | 0 | 0 |
| ui/src/app/security/findings.css | 53 | 0 | 0 | 0 | 0 |
| ui/src/app/security/overview.css | 67 | 0 | 0 | 0 | 0 |
| ui/src/app/security/scan.css | 76 | 0 | 0 | 0 | 0 |
| ui/src/app/security/security.css | 27 | 0 | 0 | 0 | 0 |
| ui/src/app/security/side.css | 5 | 0 | 0 | 0 | 0 |
| ui/src/app/settings.css | 57 | 0 | 0 | 0 | 0 |
| ui/src/app/setup.css | 38 | 0 | 0 | 0 | 0 |
| ui/src/app/wall.css | 50 | 0 | 0 | 0 | 0 |
| ui/src/liner/components/avatar/avatar.css | 6 | 0 | 0 | 0 | 0 |
| ui/src/liner/components/badge/badge.css | 4 | 0 | 0 | 0 | 0 |
| ui/src/liner/components/breadcrumb/breadcrumb.css | 7 | 0 | 0 | 0 | 0 |
| ui/src/liner/components/button/button.css | 10 | 0 | 0 | 0 | 0 |
| ui/src/liner/components/chart/chart.css | 27 | 0 | 0 | 0 | 0 |
| ui/src/liner/components/code-block/code-block.css | 19 | 0 | 8 | 0 | 0 |
| ui/src/liner/components/copy-button/copy-button.css | 4 | 0 | 0 | 0 | 0 |
| ui/src/liner/components/dialog/dialog.css | 11 | 0 | 0 | 0 | 0 |
| ui/src/liner/components/hold-to-confirm/hold-to-confirm.css | 5 | 0 | 0 | 0 | 0 |
| ui/src/liner/components/inline-edit/inline-edit.css | 8 | 0 | 0 | 0 | 0 |
| ui/src/liner/components/menu/menu.css | 5 | 0 | 0 | 0 | 0 |
| ui/src/liner/components/notice-stack/notice-stack.css | 8 | 0 | 0 | 0 | 0 |
| ui/src/liner/components/progress/progress.css | 9 | 0 | 0 | 0 | 0 |
| ui/src/liner/components/radio-cards/radio-cards.css | 9 | 0 | 0 | 0 | 0 |
| ui/src/liner/components/radio-group/radio-group.css | 8 | 0 | 0 | 0 | 0 |
| ui/src/liner/components/reasoning/reasoning.css | 19 | 0 | 0 | 0 | 0 |
| ui/src/liner/components/rolling-number/rolling-number.css | 5 | 0 | 0 | 0 | 0 |
| ui/src/liner/components/segmented/segmented.css | 9 | 0 | 0 | 0 | 0 |
| ui/src/liner/components/select/options.css | 9 | 0 | 0 | 0 | 0 |
| ui/src/liner/components/slider/slider.css | 9 | 0 | 0 | 0 | 0 |
| ui/src/liner/components/sparkline/sparkline.css | 5 | 0 | 0 | 0 | 0 |
| ui/src/liner/components/switch/switch.css | 6 | 0 | 0 | 0 | 0 |
| ui/src/liner/components/text-field/text-field.css | 15 | 0 | 0 | 0 | 0 |
| ui/src/liner/components/text-shimmer/text-shimmer.css | 1 | 0 | 0 | 0 | 0 |
| ui/src/liner/components/textarea/textarea.css | 2 | 0 | 0 | 0 | 0 |
| ui/src/liner/components/toast/toast.css | 13 | 0 | 0 | 0 | 0 |
| ui/src/liner/components/tooltip/tooltip.css | 2 | 0 | 0 | 0 | 0 |
| ui/src/liner/components/tree-view/tree-view.css | 9 | 0 | 0 | 0 | 0 |
| ui/src/liner/foundation.css | 15 | 0 | 0 | 0 | 0 |
| ui/src/liner/lib/overlay.css | 13 | 0 | 0 | 0 | 0 |
| ui/src/liner/pro/agents/agents.css | 11 | 0 | 0 | 0 | 0 |
| ui/src/liner/pro/ai-kit/ai-kit.css | 58 | 0 | 2 | 0 | 0 |
| ui/src/liner/pro/approval-card/approval-card.css | 14 | 0 | 0 | 0 | 0 |
| ui/src/liner/pro/code-diff/code-diff.css | 34 | 0 | 0 | 0 | 0 |
| ui/src/liner/pro/command-menu/command-menu.css | 21 | 0 | 0 | 0 | 0 |
| ui/src/liner/pro/pr-flow/pr-flow.css | 66 | 0 | 0 | 0 | 0 |
| ui/src/liner/pro/workflow-builder/workflow-builder.css | 90 | 0 | 0 | 0 | 0 |

### Detail (dead rule blocks with line ranges, then loose classes)

#### ui/src/app/app.css
Dead rule blocks (every selector has an unreferenced class):
- L201-205 (1 rules): lc-small
- L1391-1404 (2 rules): lc-sb-fdot
- L1411-1417 (1 rules): lc-sb-av
- L1508-1537 (4 rules): lc-sb-me, lc-sb-av, lc-sb-me-n
- L1554-1569 (2 rules): lc-sb-agent
- L1590-1593 (1 rules): lc-sb-agent
- L1928-1951 (3 rules): lc-chain
- L1969-1975 (2 rules): lc-chain
- L1985-1987 (1 rules): lc-chain
- L2821-2830 (1 rules): lc-ask-icon
- L2850-2855 (1 rules): lc-ask-desc
- L2909-2916 (2 rules): lc-instead
- L2940-2944 (1 rules): lc-hold
- L3678-3680 (1 rules): lc-under-long
- L4500-4528 (5 rules): lc-ask-p, lc-proj
- L4895-4908 (2 rules): lc-agent-card
- L4926-4935 (2 rules): lc-agent-card-m
Unreferenced classes only in selector lists that also have live selectors: lc-ask, lc-ask-top, lc-way-chip-i
Rules with a dead selector inside a live list (line: classes): 2786: lc-ask; 2803: lc-ask; 2815: lc-ask-top; 2917: lc-instead; 3356: lc-way-chip-i; 6264: lc-ask
Maybe (share a dynamic stem): lc-accent-t, lc-sb-team-list, lc-sb-agent-t, lc-ask-title, lc-box-keys, lc-agent-card-t
Referenced only from engine/contracts: l-frame-solo(unreached ui file)

#### ui/src/app/surfaces.css
Dead rule blocks (every selector has an unreferenced class):
- L312-316 (1 rules): lc-spick-foot
- L513-560 (6 rules): lc-sinfo-file, lc-sinfo-st, lc-sinfo-path
- L565-568 (1 rules): lc-sinfo-export
- L622-625 (1 rules): xterm-viewport
- L1593-1601 (1 rules): lc-pr-branches
- L1693-1702 (2 rules): lc-pr-commit
- L1707-1710 (1 rules): lc-pr-foot
- L1775-1779 (1 rules): lc-pr-row
- L3024-3028 (1 rules): lc-mchip
- L3254-3258 (1 rules): lc-sub-tile
- L4133-4152 (3 rules): lc-swatch-own
- L4420-4422 (1 rules): lc-prf
- L5186-5188 (1 rules): lc-trail-took
- L6118-6151 (5 rules): lc-foot-changes, lc-trail-agents
Rules with a dead selector inside a live list (line: classes): 1672: lc-pr-commit; 1681: lc-pr-commit
Maybe (share a dynamic stem): md-mk, md-b, md-i, md-s, md-code, md-cb, md-fence, md-h, md-q, md-q-mk, md-li, md-a, md-url, md-at, lc-trail-agent-t

#### ui/src/app/design/design-face.css
Dead rule blocks (every selector has an unreferenced class):
- L808-827 (4 rules): ld-head
- L877-896 (2 rules): ld-sheet, ld-sheet-h
- L917-944 (5 rules): ld-bubble, ld-tl
- L953-1010 (8 rules): ld-tiles, ld-tile, ld-tile-pic, ld-tile-frame
- L1017-1019 (1 rules): lc-sb-face
Rules with a dead selector inside a live list (line: classes): 1012: ld-sheet

#### ui/src/app/face.css
Dead rule blocks (every selector has an unreferenced class):
- L20-63 (5 rules): lc-sb-face, lc-sb-face-b
- L125-127 (1 rules): lc-sb-face

#### ui/src/app/dock.css
Dead rule blocks (every selector has an unreferenced class):
- L584-620 (6 rules): lc-sb-more-pop, lc-sb-more
- L946-948 (1 rules): lc-sb-more

#### ui/src/app/timeline.css
Dead rule blocks (every selector has an unreferenced class):
- L111-125 (3 rules): lc-tstep-go

#### ui/src/app/updates.css
Dead rule blocks (every selector has an unreferenced class):
- L65-68 (1 rules): lc-up-quiet

#### ui/src/app/design/chat.css
Dead rule blocks (every selector has an unreferenced class):
- L187-189 (1 rules): ld-sheet

#### ui/src/liner/components/code-block/code-block.css
Maybe (share a dynamic stem): l-tok-keyword, l-tok-string, l-tok-tag, l-tok-number, l-tok-fn, l-tok-type, l-tok-attr, l-tok-comment
Referenced only from engine/contracts: l-code(unreached ui file), l-code__bar(unreached ui file), l-code__name(unreached ui file), l-code__tools(unreached ui file), l-code__lang(unreached ui file), l-code__copy(unreached ui file), l-code__card(unreached ui file), l-code__pre(unreached ui file), l-code__line(unreached ui file), l-code__n(unreached ui file), l-code__src(unreached ui file)

#### ui/src/liner/lib/field.css
Unreferenced classes only in selector lists that also have live selectors: l-in-input
Rules with a dead selector inside a live list (line: classes): 62: l-in-input
Referenced only from engine/contracts: l-in-btn(unreached ui file), l-kbd(unreached ui file)

#### ui/src/liner/pro/ai-kit/ai-kit.css
Maybe (share a dynamic stem): l-ai-source-title, l-ai-menu-list
Referenced only from engine/contracts: l-swap(unreached ui file), l-ai-who(unreached ui file), l-ai-who-mark(unreached ui file), l-ai-who-text(unreached ui file), l-ai-sources(unreached ui file), l-ai-source(unreached ui file), l-ai-slot(unreached ui file), l-ai-source-site(unreached ui file), l-ai-source-n(unreached ui file), l-ai-actions(unreached ui file), l-ai-actions-row(unreached ui file), l-ai-act(unreached ui file), l-ai-thumb(unreached ui file), l-ai-regen(unreached ui file), l-ai-versions(unreached ui file), l-ai-ver(unreached ui file), l-ai-meta(unreached ui file), l-ai-reasons(unreached ui file), l-ai-reason(unreached ui file), l-ai-menu(unreached ui file), l-ai-hl(unreached ui file), l-ai-menu-item(unreached ui file), l-ai-menu-icon(unreached ui file), l-ai-menu-text(unreached ui file), l-ai-menu-name(unreached ui file), l-ai-menu-desc(unreached ui file), l-ai-menu-check(unreached ui file)

Note: surfaces.css:622-625 `.xterm-viewport` is xterm's own runtime class, so it is not dead. The md-* and l-tok-* classes are built dynamically (mdMirror.tsx:75, code.tsx:18), so they are used.

## Appendix B. The same selector in more than one file (top level, same @media context)

Most of these are additive splits inside the main chunk, so the load order is fixed. The exception is .ld-empty/.ld-sel (finding 1), which collides across lazy chunks. The Liner overrides (.l-frame*, :root, [data-theme]) are deliberate: the app re-tones Liner from app.css without editing the vendored file.

- `:root`: ui/src/app/app.css, ui/src/app/face.css, ui/src/app/modes.css, ui/src/liner/foundation.css
- `[data-theme]`: ui/src/app/app.css, ui/src/app/security/security.css, ui/src/liner/foundation.css
- `[data-theme="dark"]`: ui/src/app/app.css, ui/src/app/modes.css, ui/src/app/security/security.css, ui/src/liner/foundation.css
- `[data-accent]`: ui/src/app/app.css, ui/src/liner/foundation.css
- `[style*="--l-glass-opacity"]`: ui/src/app/app.css, ui/src/liner/foundation.css
- `.l-frame`: ui/src/app/app.css, ui/src/liner/foundation.css
- `.l-frame::after`: ui/src/app/app.css, ui/src/liner/foundation.css
- `.l-frame-solo::after`: ui/src/app/app.css, ui/src/liner/foundation.css
- `.l-frame-float`: ui/src/app/app.css, ui/src/liner/foundation.css
- `.l-frame-card`: ui/src/app/app.css, ui/src/liner/foundation.css
- `.l-frame-solo`: ui/src/app/app.css, ui/src/liner/foundation.css
- `.l-cdiff__card`: ui/src/app/app.css, ui/src/liner/pro/code-diff/code-diff.css
- `.lc-home`: ui/src/app/app.css, ui/src/app/updates.css
- `.lc-mention`: ui/src/app/app.css, ui/src/app/surfaces.css
- `.lc-mention-row`: ui/src/app/app.css, ui/src/app/surfaces.css
- `.lc-panel`: ui/src/app/app.css, ui/src/app/surfaces.css
- `.lc-st-scroll`: ui/src/app/app.css, ui/src/app/surfaces.css
- `@media (prefers-reduced-motion: reduce) .lc-st-side`: ui/src/app/app.css, ui/src/app/settings.css
- `.lc-ship-tag`: ui/src/app/app.css, ui/src/app/surfaces.css
- `.lc-ship-tag[data-m]`: ui/src/app/app.css, ui/src/app/surfaces.css
- `.lc-ship-hsw`: ui/src/app/app.css, ui/src/app/surfaces.css
- `.lc-prc-ttl`: ui/src/app/app.css, ui/src/app/surfaces.css
- `.lc-prc-num`: ui/src/app/app.css, ui/src/app/surfaces.css
- `.lc-prc-state`: ui/src/app/app.css, ui/src/app/surfaces.css
- `.lc-prc-note`: ui/src/app/app.css, ui/src/app/surfaces.css
- `.lc-prc-file`: ui/src/app/app.css, ui/src/app/surfaces.css
- `.lc-prc-checks li`: ui/src/app/app.css, ui/src/app/surfaces.css
- `.l-root`: ui/src/app/app.css, ui/src/liner/foundation.css
- `.l-scope`: ui/src/app/app.css, ui/src/liner/foundation.css
- `.ld-empty`: ui/src/app/design/design-face.css, ui/src/app/design/inspector.css
- `.ld-empty > svg`: ui/src/app/design/design-face.css, ui/src/app/design/inspector.css
- `.ld-empty b`: ui/src/app/design/design-face.css, ui/src/app/design/inspector.css
- `.ld-sel`: ui/src/app/design/design-face.css, ui/src/app/design/inspector.css
- `@media (prefers-reduced-motion: reduce) .lc-sb-face::before`: ui/src/app/design/design-face.css, ui/src/app/face.css
- `.lc-mp-tool`: ui/src/app/models.css, ui/src/app/surfaces.css
- `.lc-rv-main`: ui/src/app/models.css, ui/src/app/surfaces.css
- `[data-theme="light"]`: ui/src/app/modes.css, ui/src/liner/foundation.css

## Appendix C. Custom properties and keyframes

Raw output. Most entries in "read, never defined" are set from TSX as `["--x" as string]: ...` (av, cd-digits, ld-gx, ld-gy, level, sg-cols, front-h, delay, drag, dur, spread, cell, name, shallows, space-3), or from desktop/src/preload.ts:32-33 (lc-lights-x, lc-lights-y), so those are false positives. The real cases are --l-font-sans and --lc-lane (finding 14). In "defined, never read", the --l-* tokens belong to Liner's foundation and are expected to be unused; the --lc-* ones are the app's own (finding 14).

### Defined, never read
- --l-card-shadow (ui/src/liner/foundation.css)
- --l-cat-1 (ui/src/liner/foundation.css)
- --l-cat-2 (ui/src/liner/foundation.css)
- --l-cat-3 (ui/src/liner/foundation.css)
- --l-cat-4 (ui/src/liner/foundation.css)
- --l-cat-5 (ui/src/liner/foundation.css)
- --l-cat-6 (ui/src/liner/foundation.css)
- --l-cat-7 (ui/src/liner/foundation.css)
- --l-cat-8 (ui/src/liner/foundation.css)
- --l-dur-bouncy (ui/src/liner/foundation.css)
- --l-mark (ui/src/liner/foundation.css)
- --l-panel (ui/src/liner/foundation.css)
- --l-r-panel (ui/src/liner/foundation.css)
- --l-r-pill (ui/src/liner/foundation.css)
- --l-r-surface (ui/src/liner/foundation.css)
- --l-r-xs (ui/src/liner/foundation.css)
- --l-spring-bouncy (ui/src/liner/foundation.css)
- --l-text-3xl (ui/src/liner/foundation.css)
- --l-text-4xl (ui/src/liner/foundation.css)
- --l-text-5xl (ui/src/liner/foundation.css)
- --l-tray (ui/src/liner/foundation.css)
- --l-tray-fill (ui/src/liner/foundation.css)
- --l-tray-pad (ui/src/liner/foundation.css)
- --l-tray-ring (ui/src/liner/foundation.css)
- --lc-bar (ui/src/app/app.css)
- --lc-bar-hover (ui/src/app/app.css)
- --lc-bar-tile (ui/src/app/app.css)
- --lc-ctl-tile (ui/src/app/app.css)
- --lc-lift (ui/src/app/app.css)
- --lc-warn-dot (ui/src/app/app.css)

### Read, never defined
- --av (ui/src/liner/components/avatar/avatar.css)
- --cd-digits (ui/src/app/app.css, ui/src/liner/pro/code-diff/code-diff.css)
- --cell (ui/src/liner/components/activity-heatmap/activity-heatmap.tsx)
- --delay (ui/src/liner/components/rolling-number/rolling-number.css)
- --drag (ui/src/liner/components/switch/switch.css)
- --dur (ui/src/liner/components/text-shimmer/text-shimmer.css)
- --front-h (ui/src/liner/components/toast/toast.css)
- --l-cat- (ui/src/liner/components/chart/palette.ts)
- --l-font-sans (ui/src/app/surfaces.css)
- --lc-lane (ui/src/app/design.css)
- --lc-lights-x (ui/src/app/app.css, ui/src/app/design/design-face.css, ui/src/app/design.css)
- --lc-lights-y (ui/src/app/app.css, ui/src/app/design/design-face.css, ui/src/app/settings.css)
- --ld-gx (ui/src/app/design/design-face.css)
- --ld-gy (ui/src/app/design/design-face.css)
- --level (ui/src/liner/components/tree-view/tree-view.css)
- --name (ui/src/app/design/inspect/Fill.tsx, ui/src/app/design/lean.ts, ui/src/app/design/leanwalk.ts)
- --sg-cols (ui/src/liner/components/segmented/segmented.css)
- --shallows (ui/src/app/design/lean.ts)
- --space-3 (ui/src/app/design/CodeTab.tsx, ui/src/app/design/lean.ts)
- --spread (ui/src/liner/components/text-shimmer/text-shimmer.css)

Dead keyframes (line numbers below are from comment-stripped text; real: l-blur-out foundation.css:559, vendored, lc-pulse surfaces.css:5736): 2
- l-blur-out ui/src/liner/foundation.css:507
- lc-pulse ui/src/app/surfaces.css:5682
DUPLICATE KEYFRAME NAMES 1
- lc-row-in ui/src/app/app.css:1220,ui/src/app/surfaces.css:4975

## Appendix D. Liner components the app never imports (not bundled)

Reached, 42 directories: components/avatar, badge, bar-chart, breadcrumb, button, chart, code-block, copy-button, dialog, hold-to-confirm, inline-edit, menu, notice-stack, progress, radio-cards, radio-group, reasoning, rolling-number, segmented, select, slider, sparkline, switch, text-field, text-shimmer, textarea, toast, tooltip, tree-view; lib/feedback, field.css, hooks, overlay, spring; pro/agents, ai-kit, approval-card, code-diff, command-menu, pr-flow (type-only, so no code or CSS is bundled), workflow-builder (lazy RoutineBuilder chunk only).

Source sizes: 96 reached files (429 KB TS, 210 KB CSS) against 242 unreached (781 KB TS, 339 KB CSS). The unreached part is never read by Vite.

Unreached (120): components/accordion, components/action-button, components/activity-heatmap, components/alert, components/announcement-bar, components/billing-toggle, components/bottom-sheet, components/brush-chart, components/button-group, components/calendar, components/card, components/card-stack, components/carousel, components/chat-thread, components/checkbox, components/chip-group, components/color-picker, components/combobox, components/comment-thread, components/confirm-morph, components/cookie-consent, components/countdown, components/data-grid, components/data-table, components/date-picker, components/donut-chart, components/drawer, components/elastic-slider, components/empty-state, components/expandable-card, components/expandable-text, components/expanding-search, components/file-dropzone, components/filter-toolbar, components/funnel, components/gauge, components/hover-card, components/icon-morph, components/image-compare, components/json-viewer, components/like-button, components/line-chart, components/list-item, components/mention-input, components/meter, components/metric-card, components/money-input, components/morph-select, components/multi-select, components/onboarding-checklist, components/otp-input, components/pagination, components/password-field, components/payment-method, components/phone-input, components/plan-card, components/popover, components/property-list, components/race-bar, components/radar, components/range-slider, components/rating, components/reactions, components/reorderable-list, components/resizable, components/rich-text-editor, components/ridgeline, components/sankey, components/scroll-area, components/scrub-input, components/search-field, components/shortcut-recorder, components/side-panel, components/sidebar, components/signature-pad, components/skeleton, components/slope-chart, components/slot-text, components/spark-bars, components/split-button, components/stepper, components/steps, components/stream-chart, components/streamgraph, components/sunburst, components/swipe-actions, components/tabs, components/tag-input, components/text-morph, components/theme-switch, components/thinking, components/time-picker, components/timeline, components/treemap, components/unblur-text, components/usage-meter, components/usage-summary, components/user-menu, components/waffle-chart, components/workspace-switcher, lib/flip.ts, lib/liquid-glass.ts, pro/agent-feed, pro/agent-plan, pro/agent-sidebar, pro/ai-answer, pro/ai-chat, pro/avatar-upload, pro/composer, pro/diff-review, pro/emoji-picker, pro/mega-menu, pro/presence-stack, pro/pricing-cards, pro/reply-bar, pro/share-access, pro/slide-to-confirm, pro/split-bar, pro/tool-calls

## Appendix E. Exports nobody else imports (ui/src/app, engine/src, contracts/src)

Method: exports.mjs resolves every import, re-export, `import * as`, and dynamic `import()` with `.then(m => m.X)` or destructuring, across ui/src, engine/src, engine/test, desktop/src, contracts/src and the build scripts. `@contracts` resolves to every contracts file through `export *`. In "dead", the name is not used even in its own file. False positives in "dead": the `titleOf` entries in buildlinks, canvas, lean and pictures, and `call` in lean, are reached through the module table (agent-tools.ts:42-110 `m.titleOf`), so they are not dead. "local" means used only in its own file, so the export keyword can go. "testOnly" means imported only by engine/test, which is fine for engine functions exported for tests; listed for completeness.


### dead (38)
- ui/src/app/Composer.tsx:1892 Hints
- ui/src/app/TopBar.tsx:127 TopBar
- ui/src/app/TopBar.tsx:151 OpenTab
- ui/src/app/design/DesignFace.tsx:112 cwdOf
- ui/src/app/design/Frame.tsx:211 heldMarks
- ui/src/app/design/Skills.tsx:212 useLoadedCount
- ui/src/app/design/bridge.ts:320 sizeOf
- ui/src/app/design/inspect/target.ts:57 once
- ui/src/app/design/store.ts:301 heldRedraws
- ui/src/app/dock.ts:58 toggleDock
- ui/src/app/icons.tsx:355 ToolIcon
- ui/src/app/model.ts:275 statusLine
- ui/src/app/security/parts.tsx:158 ChoiceBox
- ui/src/app/security/parts.tsx:233 NotBuilt
- ui/src/app/ui.tsx:363 ContextMeter
- ui/src/app/ui.tsx:442 LimitMeter
- engine/src/buildlinks.ts:233 titleOf
- engine/src/canvas.ts:2004 titleOf
- engine/src/doctor.ts:61 setTurnMs
- engine/src/dsh-shims.ts:40 RUN_CODE_NAME
- engine/src/dsh-shims.ts:41 TOOL_ABORTED
- engine/src/dsh-shims.ts:42 TOOL_ABORTED_BEFORE_DISPATCH
- engine/src/dsh-shims.ts:155 assertSupportedJsonSchema
- engine/src/dsh-shims.ts:215 validateArgs
- engine/src/dsh-shims.ts:218 projectToolSchema
- engine/src/dsh.ts:481 HOST_SERVICES
- engine/src/lean.ts:293 leanRev
- engine/src/lean.ts:537 call
- engine/src/lean.ts:544 titleOf
- engine/src/pictures.ts:427 titleOf
- engine/src/risk.ts:1562 toolRisk
- engine/src/surfaces.ts:582 parseTable
- contracts/src/dsh.ts:26 dshBase
- contracts/src/index.ts:1004 ItemKind
- contracts/src/panel.ts:28 PanelRequest
- contracts/src/panel.ts:30 PanelReport
- contracts/src/panel.ts:32 PanelReply
- contracts/src/security.ts:324 SCAN_ACCESS

### local (310)
- ui/src/app/Addon.tsx:49 accessLine
- ui/src/app/Addon.tsx:435 AddonMenu
- ui/src/app/Addon.tsx:518 willTouch
- ui/src/app/AppModel.tsx:28 appModelReady
- ui/src/app/Ask.tsx:39 askWords
- ui/src/app/Backdrop.tsx:24 backgroundUrl
- ui/src/app/Backdrop.tsx:65 useLook
- ui/src/app/Crew.tsx:35 isCrewItem
- ui/src/app/Crew.tsx:36 isAgent
- ui/src/app/Crew.tsx:40 agentName
- ui/src/app/Crew.tsx:42 stateOf
- ui/src/app/Crew.tsx:60 shortModel
- ui/src/app/Crew.tsx:76 PairNames
- ui/src/app/Crew.tsx:80 doing
- ui/src/app/Crew.tsx:86 agentNow
- ui/src/app/Crew.tsx:99 agentStats
- ui/src/app/Crew.tsx:106 AgentNode
- ui/src/app/Crew.tsx:107 Member
- ui/src/app/Crew.tsx:109 Crew
- ui/src/app/Crew.tsx:120 crewOf
- ui/src/app/Crew.tsx:168 useCrew
- ui/src/app/Crew.tsx:215 showAgent
- ui/src/app/Crew.tsx:249 Mark
- ui/src/app/Design.tsx:37 FRAME
- ui/src/app/Design.tsx:44 designsIn
- ui/src/app/Design.tsx:71 withShim
- ui/src/app/Design.tsx:81 versionHtml
- ui/src/app/Design.tsx:120 openInLinerDesign
- ui/src/app/Files.tsx:45 openInFiles
- ui/src/app/Models.tsx:362 EffortRows
- ui/src/app/Review.tsx:58 isTestFile
- ui/src/app/RoutineBuilder.tsx:135 toSteps
- ui/src/app/RoutineBuilder.tsx:147 fromSteps
- ui/src/app/Settings.tsx:58 SettingsPage
- ui/src/app/Settings.tsx:2363 AddonsPlace
- ui/src/app/Sidebar.tsx:1656 exportSession
- ui/src/app/Surfaces.tsx:296 ghLine
- ui/src/app/Updates.tsx:34 firstNote
- ui/src/app/Updates.tsx:66 toolNotice
- ui/src/app/Updates.tsx:99 noticesOf
- ui/src/app/Wall.tsx:36 WallKind
- ui/src/app/Wall.tsx:40 wallKind
- ui/src/app/Wall.tsx:44 wallOrder
- ui/src/app/ask-text.ts:119 Bit
- ui/src/app/ask-text.ts:160 TYPING_GUARD
- ui/src/app/ask-text.ts:162 SHOWN_GUARD
- ui/src/app/ask-text.ts:164 AskKeyIn
- ui/src/app/design/BuildTab.tsx:35 refreshBuilds
- ui/src/app/design/BuildTab.tsx:97 linesOf
- ui/src/app/design/BuildTab.tsx:139 buildAsk
- ui/src/app/design/BuildTab.tsx:152 updateAsk
- ui/src/app/design/BuildTab.tsx:158 bringAsk
- ui/src/app/design/BuildTab.tsx:169 StateIcon
- ui/src/app/design/BuildTab.tsx:181 notScreen
- ui/src/app/design/BuildTab.tsx:184 setScreen
- ui/src/app/design/Canvas.tsx:62 boundsOf
- ui/src/app/design/Chat.tsx:276 Hosts
- ui/src/app/design/Compare.tsx:28 pathFor
- ui/src/app/design/Compare.tsx:69 fixAsk
- ui/src/app/design/DesignFace.tsx:43 FaceBoundary
- ui/src/app/design/DesignHome.tsx:61 shortTitle
- ui/src/app/design/Frame.tsx:60 agentAt
- ui/src/app/design/Frame.tsx:93 Settle
- ui/src/app/design/Frame.tsx:136 planOf
- ui/src/app/design/Frame.tsx:189 stillMotion
- ui/src/app/design/Live.tsx:36 partsOf
- ui/src/app/design/Live.tsx:132 heldOf
- ui/src/app/design/Live.tsx:175 sourceOf
- ui/src/app/design/Live.tsx:331 addLive
- ui/src/app/design/Pictures.tsx:46 modelFor
- ui/src/app/design/Skills.tsx:39 openLean
- ui/src/app/design/Skills.tsx:126 fits
- ui/src/app/design/Tabs.tsx:342 ownPlace
- ui/src/app/design/Versions.tsx:28 nameOf
- ui/src/app/design/Ways.tsx:53 Way
- ui/src/app/design/Ways.tsx:55 waysOf
- ui/src/app/design/Ways.tsx:90 offLean
- ui/src/app/design/checks.ts:27 Kind
- ui/src/app/design/checks.ts:32 FrameChecks
- ui/src/app/design/checks.ts:43 getChecks
- ui/src/app/design/checks.ts:57 widthsOf
- ui/src/app/design/checks.ts:95 ratioOf
- ui/src/app/design/checks.ts:328 runChecks
- ui/src/app/design/checks.ts:470 ask
- ui/src/app/design/inspect/Size.tsx:28 flowOf
- ui/src/app/design/inspect/controls.tsx:24 useOpen
- ui/src/app/design/inspect/controls.tsx:91 Stop
- ui/src/app/design/inspect/convert.ts:21 decls
- ui/src/app/design/inspect/slots.ts:13 StyleSlot
- ui/src/app/design/inspect/slots.ts:16 FootSlot
- ui/src/app/design/inspect/tabs.ts:15 InspectorTab
- ui/src/app/design/lean.ts:146 Kind
- ui/src/app/design/leanwalk.ts:35 OffState
- ui/src/app/design/store.ts:28 Presence
- ui/src/app/design/store.ts:111 getChat
- ui/src/app/design/store.ts:265 AgentRedraw
- ui/src/app/dock.ts:20 Pane
- ui/src/app/dock.ts:25 STARTERS
- ui/src/app/dock.ts:27 MAX_PANES
- ui/src/app/engine.ts:16 EngineState
- ui/src/app/face.ts:13 FACES
- ui/src/app/face.ts:60 Tabs
- ui/src/app/face.ts:112 subscribeTabs
- ui/src/app/face.ts:175 CANVAS_TOOL
- ui/src/app/keymap.ts:13 Command
- ui/src/app/keymap.ts:99 parse
- ui/src/app/keymap.ts:145 holds
- ui/src/app/launch.ts:11 LaunchList
- ui/src/app/look.ts:58 DESK_SHOW
- ui/src/app/model.ts:26 EFFORTS
- ui/src/app/model.ts:35 modelInfo
- ui/src/app/security/FindingPanel.tsx:33 useWho
- ui/src/app/security/OpenChart.tsx:19 axisTop
- ui/src/app/security/OpenChart.tsx:30 scanSentence
- ui/src/app/security/Side.tsx:28 scanNote
- ui/src/app/security/Side.tsx:34 scanLine
- ui/src/app/security/parts.tsx:16 Tone
- ui/src/app/security/scan-mock.ts:10 MockMode
- ui/src/app/security/store.ts:30 getSecurityPage
- ui/src/app/security/store.ts:48 SecurityScope
- ui/src/app/security/store.ts:67 onSecurity
- ui/src/app/security/when.ts:15 dateOf
- ui/src/app/services.ts:12 Service
- ui/src/app/themes.ts:82 lightness
- ui/src/app/ui.tsx:342 ContextRing
- ui/src/app/ui.tsx:492 HIDDEN_VALUE
- engine/src/addons.ts:361 toolWords
- engine/src/addons.ts:372 PANEL_FILES
- engine/src/addons.ts:373 PANEL_FILE_MAX
- engine/src/addons.ts:374 PANEL_TOTAL_MAX
- engine/src/addons.ts:376 DSH_LIMITS
- engine/src/agent-tools.ts:45 McpContent
- engine/src/agent-tools.ts:227 ADDON_TOOL
- engine/src/agent-tools.ts:237 CHECK_SIZE
- engine/src/agent-tools.ts:232 commandLine
- engine/src/agents.ts:25 pathIn
- engine/src/api.ts:61 settledCopy
- engine/src/api.ts:78 systemCheck
- engine/src/backgrounds.ts:16 Picture
- engine/src/buildlinks.ts:19 BuildMethod
- engine/src/buildlinks.ts:19 unlink
- engine/src/buildlinks.ts:109 styleOf
- engine/src/canvas-html.ts:18 Attr
- engine/src/canvas-html.ts:26 Txt
- engine/src/canvas-html.ts:25 Child
- engine/src/canvas-html.ts:29 Doc
- engine/src/canvas-html.ts:46 isEl
- engine/src/canvas-html.ts:258 scriptEnd
- engine/src/canvas-html.ts:299 cleanEnd
- engine/src/canvas-html.ts:330 contentRoot
- engine/src/canvas-html.ts:354 goodId
- engine/src/canvas-html.ts:359 freshId
- engine/src/canvas-html.ts:467 withId
- engine/src/canvas-html.ts:482 swappable
- engine/src/canvas-html.ts:494 balanced
- engine/src/canvas-html.ts:550 placeable
- engine/src/canvas-html.ts:586 LINE_UP_CAP
- engine/src/canvas-html.ts:657 carryIds
- engine/src/canvas-html.ts:711 nameOf
- engine/src/canvas.ts:142 MAX_FRAME
- engine/src/canvas.ts:189 framePath
- engine/src/canvas.ts:314 side
- engine/src/canvas.ts:388 placeFree
- engine/src/canvas.ts:655 blankPage
- engine/src/canvas.ts:935 copyFrame
- engine/src/canvas.ts:978 peekFrame
- engine/src/canvas.ts:1012 readNode
- engine/src/canvas.ts:1648 CanvasMethod
- engine/src/canvas.ts:2025 adopt
- engine/src/checkpoints.ts:318 Undo
- engine/src/checkpoints.ts:324 edited
- engine/src/creator.ts:32 liner2Skill
- engine/src/design-prefs.ts:13 PicturesPref
- engine/src/designs.ts:22 DESIGN_DIR
- engine/src/doctor.ts:39 DoctorDeps
- engine/src/doctor.ts:59 TURN_MS
- engine/src/doctor.ts:92 Ctx
- engine/src/doctor.ts:111 CHECKS
- engine/src/doctor.ts:282 Probe
- engine/src/doctor.ts:862 listTools
- engine/src/dsh-hosts.ts:161 INERT
- engine/src/dsh-hosts.ts:163 KEPT
- engine/src/dsh-hosts.ts:165 TEXT
- engine/src/dsh-shims.ts:30 HarnessError
- engine/src/dsh-shims.ts:44 JsonSchemaError
- engine/src/dsh-shims.ts:51 ToolArgsError
- engine/src/dsh-shims.ts:59 ToolNotFoundError
- engine/src/dsh-shims.ts:65 ToolOutputError
- engine/src/dsh-shims.ts:73 ToolActivationError
- engine/src/dsh-shims.ts:80 SettingsConflictError
- engine/src/dsh-shims.ts:151 valueSchemaSpecToJsonSchema
- engine/src/dsh-shims.ts:153 parameterSchemaSpecToJsonSchema
- engine/src/dsh-shims.ts:171 validateJsonSchemaValue
- engine/src/dsh-shims.ts:242 defineTool
- engine/src/dsh.ts:88 TARBALL_MAX
- engine/src/dsh.ts:89 UNPACKED_MAX
- engine/src/dsh.ts:367 DshRead
- engine/src/dsh.ts:644 CLIENT_MAX
- engine/src/exec.ts:72 shimTarget
- engine/src/exec.ts:169 HELPERS
- engine/src/exec.ts:213 Secrets
- engine/src/exec.ts:268 RunResult
- engine/src/launch.ts:35 IDLE_MS
- engine/src/launch.ts:357 LaunchHost
- engine/src/lean.ts:29 LeanMethod
- engine/src/lean.ts:32 BUILTIN
- engine/src/lean.ts:272 leanTarget
- engine/src/lean.ts:333 DESIGN_WORDS
- engine/src/lean.ts:339 homeOf
- engine/src/liner-tools.ts:14 Schema
- engine/src/memory.ts:88 SessionHit
- engine/src/offers.ts:36 idFor
- engine/src/offers.ts:54 briefOf
- engine/src/outside-tools.ts:24 readout
- engine/src/panels.ts:64 AI_SYSTEM_MAX
- engine/src/paths.ts:11 ENGINE_DIR
- engine/src/pictures.ts:29 PicturesMethod
- engine/src/pictures.ts:29 models
- engine/src/pictures.ts:102 LOOPBACK
- engine/src/pictures.ts:182 NO_MODEL
- engine/src/pictures.ts:185 modelFor
- engine/src/pictures.ts:213 Made
- engine/src/pictures.ts:29 make
- engine/src/pictures.ts:323 kindOf
- engine/src/pictures.ts:339 addPicture
- engine/src/precheck.ts:120 subjectQuestion
- engine/src/prflow.ts:17 parseMergeTree
- engine/src/providers/acp.ts:111 opencodeRules
- engine/src/providers/acp.ts:175 isDelegation
- engine/src/providers/acp.ts:190 DelegateResult
- engine/src/providers/acp.ts:476 MCP_WRAP
- engine/src/providers/acp.ts:2082 namesNote
- engine/src/providers/acp.ts:2097 AcpSpec
- engine/src/providers/added.ts:34 accountEnv
- engine/src/providers/claude.ts:104 terminalError
- engine/src/providers/claude.ts:278 storedTasks
- engine/src/providers/claude.ts:438 SCAN_DENIED
- engine/src/providers/codex-server.ts:63 unwrap
- engine/src/providers/demo-canvas.ts:110 askOf
- engine/src/providers/demo-canvas.ts:113 isSample
- engine/src/providers/demo-canvas.ts:186 frameNamed
- engine/src/providers/demo-canvas.ts:189 isEmptyFrame
- engine/src/providers/demo-canvas.ts:510 builtPath
- engine/src/providers/demo-canvas.ts:582 bringBack
- engine/src/providers/demo-canvas.ts:625 heldChanges
- engine/src/providers/demo-canvas.ts:674 takesOf
- engine/src/providers/demo-canvas.ts:710 Finding
- engine/src/providers/demo-canvas.ts:711 findingsOf
- engine/src/providers/demo-canvas.ts:716 fixOps
- engine/src/providers/demo.ts:39 SAMPLE_FILES
- engine/src/providers/demo.ts:83 tideDesign
- engine/src/providers/plain.ts:21 PlainAnswer
- engine/src/proxy.ts:125 agentAt
- engine/src/review.ts:11 CRITERIA
- engine/src/review.ts:113 SubagentDef
- engine/src/review.ts:116 runModeOf
- engine/src/risk.ts:421 JudgeOptions
- engine/src/routines.ts:74 denied
- engine/src/runtime.ts:108 QUIET_STEP_MS
- engine/src/runtime.ts:197 READ_MS
- engine/src/runtime.ts:199 REVIEW_MS
- engine/src/runtime.ts:201 DOING_MS
- engine/src/runtime.ts:203 THINK_MS
- engine/src/runtime.ts:205 WARM_MS
- engine/src/runtime.ts:216 IDLE_MS
- engine/src/runtime.ts:218 spanOf
- engine/src/runtime.ts:220 QuietTimeout
- engine/src/security-bringin.ts:112 ghWhy
- engine/src/security-bringin.ts:145 dependabotFinding
- engine/src/security-bringin.ts:172 fingerprintOf
- engine/src/security-checks.ts:43 SECRET_PATTERNS
- engine/src/security-checks.ts:73 SecretHit
- engine/src/security-checks.ts:121 maskLine
- engine/src/security-checks.ts:219 packageFinding
- engine/src/security-demo.ts:26 DEMO_LOOK_BY
- engine/src/security-demo.ts:83 seedDemo
- engine/src/security-demo.ts:289 DEMO_QUESTIONS
- engine/src/security-scan.ts:78 branchOf
- engine/src/security-scan.ts:173 ScanBrief
- engine/src/security-scan.ts:867 letGoShort
- engine/src/security.ts:28 SecurityMethod
- engine/src/security.ts:44 SecurityHost
- engine/src/security.ts:77 bareKey
- engine/src/security.ts:107 worstFirst
- engine/src/sidekick.ts:198 briefStarted
- engine/src/sources.ts:47 readSource
- engine/src/store.ts:97 OldSettings
- engine/src/surfaces.ts:355 GhState
- engine/src/updates.ts:63 versionParts
- engine/src/updates.ts:75 newer
- engine/src/updates.ts:99 Busy
- engine/src/updates.ts:130 TOOLS
- engine/src/winterm.ts:28 WinShell
- contracts/src/design.ts:23 FrameBuilt
- contracts/src/doing.ts:12 DoingFrameNamer
- contracts/src/dsh.ts:22 DSH_PATH
- contracts/src/index.ts:319 ThreadStatus
- contracts/src/index.ts:558 AddonServer
- contracts/src/index.ts:659 ModeGuide
- contracts/src/index.ts:728 OfferState
- contracts/src/index.ts:730 PanelInfo
- contracts/src/index.ts:798 DshAsk
- contracts/src/index.ts:1469 TermInfo
- contracts/src/panel.ts:35 PanelTheme
- contracts/src/security.ts:49 SecondLook
- contracts/src/security.ts:51 FindingFix
- contracts/src/security.ts:53 FindingEventKind
- contracts/src/security.ts:245 ScanDepthChoice
- contracts/src/tuning.ts:15 BriefStyle
- contracts/src/tuning.ts:19 Reviewing

### testOnly (215)
- ui/src/app/dock.ts:34 onScreen (also used in its own file)
- ui/src/app/dock.ts:36 behind (also used in its own file)
- ui/src/app/dock.ts:152 canSplit (also used in its own file)
- ui/src/app/dock.ts:155 split (also used in its own file)
- engine/src/addons.ts:359 programWhere (also used in its own file)
- engine/src/agent-tools.ts:120 NO_PICTURE (also used in its own file)
- engine/src/agent-tools.ts:123 wordsOnly (also used in its own file)
- engine/src/agent-tools.ts:160 isPage (also used in its own file)
- engine/src/agent-tools.ts:229 SERVER_TOOL (also used in its own file)
- engine/src/api.ts:94 githubName (also used in its own file)
- engine/src/api.ts:116 findRepos (also used in its own file)
- engine/src/buildlinks.ts:26 frameHash (also used in its own file)
- engine/src/buildlinks.ts:19 link (also used in its own file)
- engine/src/buildlinks.ts:70 buildState (also used in its own file)
- engine/src/buildlinks.ts:123 elementsOf (also used in its own file)
- engine/src/buildlinks.ts:157 diffFrames (also used in its own file)
- engine/src/buildlinks.ts:221 call
- engine/src/canvas-html.ts:307 decode (also used in its own file)
- engine/src/canvas-html.ts:457 stampGuard (also used in its own file)
- engine/src/canvas.ts:240 revOf (also used in its own file)
- engine/src/canvas.ts:782 rebase (also used in its own file)
- engine/src/canvas.ts:875 removeFrame (also used in its own file)
- engine/src/canvas.ts:901 unremoveFrame (also used in its own file)
- engine/src/canvas.ts:959 readFrameRev (also used in its own file)
- engine/src/canvas.ts:1056 applyFrame (also used in its own file)
- engine/src/canvas.ts:1142 watchFile (also used in its own file)
- engine/src/canvas.ts:1383 keepVersion
- engine/src/canvas.ts:1466 turnStarted (also used in its own file)
- engine/src/canvas.ts:1476 turnEnded (also used in its own file)
- engine/src/canvas.ts:1487 canvasIdle (also used in its own file)
- engine/src/canvas.ts:1502 versions (also used in its own file)
- engine/src/canvas.ts:1528 versionRead (also used in its own file)
- engine/src/canvas.ts:1561 restore (also used in its own file)
- engine/src/canvas.ts:1607 attach (also used in its own file)
- engine/src/canvas.ts:1897 call (also used in its own file)
- engine/src/checkpoints.ts:292 restore (also used in its own file)
- engine/src/creator.ts:39 creatorNote (also used in its own file)
- engine/src/design-start.ts:37 designsHome (also used in its own file)
- engine/src/design-start.ts:400 CRASH (also used in its own file)
- engine/src/design-start.ts:401 attachCrash (also used in its own file)
- engine/src/designs.ts:48 designPath (also used in its own file)
- engine/src/designs.ts:57 designsOf (also used in its own file)
- engine/src/doctor.ts:53 WRITE_FILE (also used in its own file)
- engine/src/doctor.ts:54 RAN_FILE (also used in its own file)
- engine/src/doctor.ts:68 clearScratch (also used in its own file)
- engine/src/doctor.ts:285 probeEnv (also used in its own file)
- engine/src/doctor.ts:371 testModel (also used in its own file)
- engine/src/dsh-hosts.ts:82 told (also used in its own file)
- engine/src/dsh-hosts.ts:102 tidySchema (also used in its own file)
- engine/src/dsh-hosts.ts:255 makeIn (also used in its own file)
- engine/src/dsh-hosts.ts:288 ownDir (also used in its own file)
- engine/src/dsh-hosts.ts:318 sandboxProfile (also used in its own file)
- engine/src/dsh.ts:134 untar (also used in its own file)
- engine/src/dsh.ts:214 readYaml (also used in its own file)
- engine/src/dsh.ts:445 envOf (also used in its own file)
- engine/src/dsh.ts:544 toolsIn (also used in its own file)
- engine/src/dsh.ts:570 sectionsIn (also used in its own file)
- engine/src/dsh.ts:587 idOf (also used in its own file)
- engine/src/edits.ts:22 NOTE_CAP (also used in its own file)
- engine/src/exec.ts:51 pathOf (also used in its own file)
- engine/src/exec.ts:338 markDir (also used in its own file)
- engine/src/exec.ts:402 startedAt (also used in its own file)
- engine/src/exec.ts:423 lstartUtc (also used in its own file)
- engine/src/exec.ts:444 engineAlive (also used in its own file)
- engine/src/launch.ts:47 LaunchEntry (also used in its own file)
- engine/src/launch.ts:64 HIDDEN (also used in its own file)
- engine/src/launch.ts:71 plainJson (also used in its own file)
- engine/src/launch.ts:104 readLaunch (also used in its own file)
- engine/src/launch.ts:165 movePort (also used in its own file)
- engine/src/launch.ts:181 canMove (also used in its own file)
- engine/src/launch.ts:223 portFree (also used in its own file)
- engine/src/launch.ts:342 runKey (also used in its own file)
- engine/src/lean.ts:54 parseLean (also used in its own file)
- engine/src/lean.ts:250 builtinLean (also used in its own file)
- engine/src/lean.ts:320 writeLean (also used in its own file)
- engine/src/lean.ts:336 isDesignSkill (also used in its own file)
- engine/src/lean.ts:349 listSkills (also used in its own file)
- engine/src/lean.ts:437 sidekickPart (also used in its own file)
- engine/src/offers.ts:23 OfferHost (also used in its own file)
- engine/src/panels.ts:21 PANEL_METHODS (also used in its own file)
- engine/src/panels.ts:63 AI_PROMPT_MAX (also used in its own file)
- engine/src/panels.ts:67 readable (also used in its own file)
- engine/src/paths.ts:14 BUNDLED (also used in its own file)
- engine/src/pictures.ts:46 ANSWER_MAX (also used in its own file)
- engine/src/pictures.ts:53 normalIp (also used in its own file)
- engine/src/pictures.ts:107 privateIp (also used in its own file)
- engine/src/pictures.ts:159 fetchLinked (also used in its own file)
- engine/src/pictures.ts:180 NO_ONE (also used in its own file)
- engine/src/pictures.ts:192 sizeFor (also used in its own file)
- engine/src/pictures.ts:296 placeInto (also used in its own file)
- engine/src/pictures.ts:331 ADD_MAX (also used in its own file)
- engine/src/pictures.ts:379 call (also used in its own file)
- engine/src/precheck.ts:57 tasksOf (also used in its own file)
- engine/src/precheck.ts:87 smallAsk (also used in its own file)
- engine/src/precheck.ts:95 longSession (also used in its own file)
- engine/src/precheck.ts:108 maybeNewSubject (also used in its own file)
- engine/src/precheck.ts:135 yesNo (also used in its own file)
- engine/src/providers/acp.ts:111 opencodeAsks (also used in its own file)
- engine/src/providers/acp.ts:177 delegatedTasks (also used in its own file)
- engine/src/providers/acp.ts:192 delegateResults (also used in its own file)
- engine/src/providers/acp.ts:296 opencodeEnv (also used in its own file)
- engine/src/providers/acp.ts:317 OPENCODE_USAGE_MS (also used in its own file)
- engine/src/providers/acp.ts:319 setOpencodeUsageMs
- engine/src/providers/acp.ts:337 opencodeTurnUsage (also used in its own file)
- engine/src/providers/acp.ts:415 linerCall (also used in its own file)
- engine/src/providers/acp.ts:475 isMcpWrap (also used in its own file)
- engine/src/providers/acp.ts:503 hermesWait (also used in its own file)
- engine/src/providers/acp.ts:581 secretFile (also used in its own file)
- engine/src/providers/acp.ts:588 homeTitle (also used in its own file)
- engine/src/providers/acp.ts:598 fromFolder (also used in its own file)
- engine/src/providers/acp.ts:611 leaves (also used in its own file)
- engine/src/providers/acp.ts:1970 acpMcp (also used in its own file)
- engine/src/providers/acp.ts:1993 CANCEL_MS (also used in its own file)
- engine/src/providers/acp.ts:1995 setCancelMs
- engine/src/providers/acp.ts:2009 commandWords (also used in its own file)
- engine/src/providers/acp.ts:2061 levelNote (also used in its own file)
- engine/src/providers/acp.ts:2090 standingNote (also used in its own file)
- engine/src/providers/acp.ts:2161 checkGate (also used in its own file)
- engine/src/providers/acp.ts:2183 toolGate (also used in its own file)
- engine/src/providers/acp.ts:2295 ANTIGRAVITY (also used in its own file)
- engine/src/providers/claude.ts:39 sdk (also used in its own file)
- engine/src/providers/claude.ts:46 waits (also used in its own file)
- engine/src/providers/claude.ts:60 claudeMcp (also used in its own file)
- engine/src/providers/claude.ts:139 resultError (also used in its own file)
- engine/src/providers/claude.ts:159 whyOf (also used in its own file)
- engine/src/providers/claude.ts:179 signedOut (also used in its own file)
- engine/src/providers/claude.ts:194 TaskList (also used in its own file)
- engine/src/providers/claude.ts:207 applyTaskTool (also used in its own file)
- engine/src/providers/claude.ts:312 withFiles (also used in its own file)
- engine/src/providers/claude.ts:432 modeOf (also used in its own file)
- engine/src/providers/claude.ts:448 LINER_ASKS (also used in its own file)
- engine/src/providers/claude.ts:461 askRuleNames (also used in its own file)
- engine/src/providers/claude.ts:512 contextSources (also used in its own file)
- engine/src/providers/claude.ts:636 agentReport (also used in its own file)
- engine/src/providers/codex-server.ts:42 withExit (also used in its own file)
- engine/src/providers/codex-server.ts:137 codexMcp (also used in its own file)
- engine/src/providers/codex-server.ts:165 CodexServer (also used in its own file)
- engine/src/providers/codex.ts:254 execMcp (also used in its own file)
- engine/src/providers/demo-canvas.ts:42 FORESHORE (also used in its own file)
- engine/src/providers/demo-canvas.ts:46 TIDE_FRAMES (also used in its own file)
- engine/src/providers/demo-canvas.ts:57 foreshorePage (also used in its own file)
- engine/src/providers/demo-canvas.ts:70 piecesOf (also used in its own file)
- engine/src/providers/demo-canvas.ts:108 slugOfNote (also used in its own file)
- engine/src/providers/demo-canvas.ts:278 HANDED (also used in its own file)
- engine/src/providers/demo-canvas.ts:397 frameBrief (also used in its own file)
- engine/src/providers/demo.ts:74 PLAN_ASK (also used in its own file)
- engine/src/providers/endpoint.ts:19 KEY_VAR (also used in its own file)
- engine/src/providers/endpoint.ts:36 endpointOptions (also used in its own file)
- engine/src/providers/endpoint.ts:80 modelEntry (also used in its own file)
- engine/src/proxy.ts:27 FRAME_MARK (also used in its own file)
- engine/src/proxy.ts:30 fromFrame (also used in its own file)
- engine/src/proxy.ts:47 unmarked (also used in its own file)
- engine/src/risk.ts:91 plainGit (also used in its own file)
- engine/src/risk.ts:1271 provenPlainFetch (also used in its own file)
- engine/src/risk.ts:1389 parseShell (also used in its own file)
- engine/src/routines.ts:27 sameSecret (also used in its own file)
- engine/src/routines.ts:34 nextRun (also used in its own file)
- engine/src/routines.ts:55 describeTrigger (also used in its own file)
- engine/src/routines.ts:64 fill (also used in its own file)
- engine/src/runtime.ts:107 QUIET_MS (also used in its own file)
- engine/src/runtime.ts:123 TurnEnd (also used in its own file)
- engine/src/runtime.ts:142 etaOf (also used in its own file)
- engine/src/runtime.ts:3689 linerName (also used in its own file)
- engine/src/runtime.ts:3695 toolsNote (also used in its own file)
- engine/src/runtime.ts:3721 clean (also used in its own file)
- engine/src/runtime.ts:3731 isPrAsk (also used in its own file)
- engine/src/runtime.ts:3770 handoff (also used in its own file)
- engine/src/runtime.ts:3811 reviewerWord (also used in its own file)
- engine/src/runtime.ts:132 leavesMac (also used in its own file)
- engine/src/security-bringin.ts:58 githubRepoOf (also used in its own file)
- engine/src/security-bringin.ts:179 codeScanningFinding (also used in its own file)
- engine/src/security-bringin.ts:265 parseSarif (also used in its own file)
- engine/src/security-checks.ts:61 entropy (also used in its own file)
- engine/src/security-checks.ts:69 masked (also used in its own file)
- engine/src/security-checks.ts:71 isPlaceholder (also used in its own file)
- engine/src/security-checks.ts:102 secretsIn (also used in its own file)
- engine/src/security-checks.ts:127 shownLine (also used in its own file)
- engine/src/security-checks.ts:167 parseAudit (also used in its own file)
- engine/src/security-demo.ts:64 demoWanted (also used in its own file)
- engine/src/security-scan.ts:38 clock (also used in its own file)
- engine/src/security-scan.ts:198 scanPrompt (also used in its own file)
- engine/src/security-scan.ts:233 shownLine (also used in its own file)
- engine/src/security-scan.ts:458 lookPrompt (also used in its own file)
- engine/src/security-scan.ts:486 parseLook (also used in its own file)
- engine/src/security-scan.ts:548 DATA_NOTE (also used in its own file)
- engine/src/security-scan.ts:584 fixPrompt (also used in its own file)
- engine/src/security-scan.ts:704 withAnswers (also used in its own file)
- engine/src/security-scan.ts:865 LET_GO (also used in its own file)
- engine/src/security.ts:123 stateAt (also used in its own file)
- engine/src/sidekick.ts:27 BRIEF_MARGIN_MS (also used in its own file)
- engine/src/sources.ts:23 githubOf (also used in its own file)
- engine/src/sources.ts:37 findAddon (also used in its own file)
- engine/src/store.ts:77 defaultSettings (also used in its own file)
- engine/src/store.ts:84 fourLevels (also used in its own file)
- engine/src/store.ts:93 BEFORE_PAIRS (also used in its own file)
- engine/src/store.ts:123 toPairs (also used in its own file)
- engine/src/store.ts:197 fromWorkStyle (also used in its own file)
- engine/src/surfaces.ts:123 Backlog (also used in its own file)
- engine/src/surfaces.ts:450 parseListeners (also used in its own file)
- engine/src/surfaces.ts:472 parseNetstat (also used in its own file)
- engine/src/surfaces.ts:492 parseThreads
- engine/src/surfaces.ts:597 stoppableGroup (also used in its own file)
- engine/src/updates.ts:42 progressIn (also used in its own file)
- engine/src/updates.ts:67 versionOf (also used in its own file)
- engine/src/updates.ts:70 teamIn (also used in its own file)
- engine/src/updates.ts:78 repoName (also used in its own file)
- engine/src/updates.ts:85 pickAsset (also used in its own file)
- engine/src/worktrees.ts:28 localChanges (also used in its own file)
- contracts/src/doing.ts:15 DOING_MAX (also used in its own file)
- contracts/src/doing.ts:45 cutDoing (also used in its own file)
- contracts/src/doing.ts:241 commandWords (also used in its own file)
- contracts/src/index.ts:49 ACCESS
- contracts/src/index.ts:161 PICTURE_GUESS (also used in its own file)
- contracts/src/index.ts:676 asksForAddon
- contracts/src/panel.ts:118 panelPolicy (also used in its own file)

### devOnly (0)

## Appendix F. Unreachable files

- ui (from ui/src/main.tsx): ui/src/app/design/inspect/dev.tsx (dev page, intended), ui/src/app/dsh-platform.d.ts (types), plus the 242 liner files in Appendix D.
- engine (from engine/src/main.ts plus script() entries): none. Reachable only from engine/test: none.
- desktop (from main.ts + preload.ts): none.

## Appendix G. Expensive-CSS scan, raw (every reachable stylesheet)

Sections: backdrop = backdrop-filter; blur = static filter: blur; tlayout = transitions of layout properties; infinite = infinite animations; shadowAnim = box-shadow transitions (on hover or focus only, cheap); has = :has() selectors; kfLayout, kfShadow and kfFilter = keyframes that animate layout, box-shadow or filter. The last section lists, per file: prefers-reduced-motion queries / animation declarations / transition declarations. The global catch-all in foundation.css:619 covers all of them.


## backdrop (33)
- ui/src/app/app.css:1178 `.lc-sb-blur` backdrop-filter: blur(5px);
- ui/src/app/app.css:3209 `html:not([data-composer="solid"]) .lc-thread-foot .lc-card::before` backdrop-filter: blur(22px) saturate(160%);
- ui/src/app/app.css:3210 `html:not([data-composer="solid"]) .lc-thread-foot .lc-card::before` -webkit-backdrop-filter: blur(22px) saturate(160%);
- ui/src/app/app.css:3231 `html:not([data-composer="solid"]) .lc-thread-foot .lc-tray:has(> .lc-tray-head > *)::before` backdrop-filter: blur(22px) saturate(160%);
- ui/src/app/app.css:3232 `html:not([data-composer="solid"]) .lc-thread-foot .lc-tray:has(> .lc-tray-head > *)::before` -webkit-backdrop-filter: blur(22px) saturate(160%);
- ui/src/liner/foundation.css:402 `.l-glass` backdrop-filter: var(--l-lens,) var(--l-backdrop);
- ui/src/liner/foundation.css:403 `.l-glass` -webkit-backdrop-filter: var(--l-lens,) var(--l-backdrop);
- ui/src/liner/foundation.css:441 `.l-frame-float` backdrop-filter: var(--l-lens,) var(--l-frame-backdrop);
- ui/src/liner/foundation.css:442 `.l-frame-float` -webkit-backdrop-filter: var(--l-lens,) var(--l-frame-backdrop);
- ui/src/liner/lib/overlay.css:14 `.l-pop` backdrop-filter: var(--l-lens,) var(--l-backdrop);
- ui/src/liner/lib/overlay.css:15 `.l-pop` -webkit-backdrop-filter: var(--l-lens,) var(--l-backdrop);
- ui/src/liner/components/toast/toast.css:123 `.l-toast__body` backdrop-filter: var(--l-lens,) var(--l-backdrop);
- ui/src/liner/components/toast/toast.css:124 `.l-toast__body` -webkit-backdrop-filter: var(--l-lens,) var(--l-backdrop);
- ui/src/liner/components/toast/toast.css:256 `.l-toast__close` backdrop-filter: var(--l-lens,) var(--l-backdrop);
- ui/src/liner/components/toast/toast.css:257 `.l-toast__close` -webkit-backdrop-filter: var(--l-lens,) var(--l-backdrop);
- ui/src/app/design.css:277 `.lc-dz-zoom` backdrop-filter: blur(16px) saturate(150%);
- ui/src/app/design.css:278 `.lc-dz-zoom` -webkit-backdrop-filter: blur(16px) saturate(150%);
- ui/src/app/design.css:447 `.lc-dz-over` backdrop-filter: blur(14px) saturate(150%);
- ui/src/app/design.css:448 `.lc-dz-over` -webkit-backdrop-filter: blur(14px) saturate(150%);
- ui/src/app/design.css:503 `.lc-dz-full` backdrop-filter: blur(20px);
- ui/src/app/design.css:504 `.lc-dz-full` -webkit-backdrop-filter: blur(20px);
- ui/src/liner/components/dialog/dialog.css:23 `[data-blur="live"] .l-sheet::backdrop` backdrop-filter: blur(6px) saturate(120%);
- ui/src/liner/components/dialog/dialog.css:24 `[data-blur="live"] .l-sheet::backdrop` -webkit-backdrop-filter: blur(6px) saturate(120%);
- ui/src/liner/pro/ai-kit/ai-kit.css:345 `.l-cite-card` backdrop-filter: var(--l-lens,) var(--l-backdrop);
- ui/src/liner/pro/ai-kit/ai-kit.css:346 `.l-cite-card` -webkit-backdrop-filter: var(--l-lens,) var(--l-backdrop);
- ui/src/liner/pro/ai-kit/ai-kit.css:558 `.l-ai-source` backdrop-filter: var(--l-lens,) var(--l-backdrop-sm);
- ui/src/liner/pro/ai-kit/ai-kit.css:559 `.l-ai-source` -webkit-backdrop-filter: var(--l-lens,) var(--l-backdrop-sm);
- ui/src/liner/pro/ai-kit/ai-kit.css:817 `.l-ai-menu` backdrop-filter: var(--l-lens,) var(--l-backdrop);
- ui/src/liner/pro/ai-kit/ai-kit.css:818 `.l-ai-menu` -webkit-backdrop-filter: var(--l-lens,) var(--l-backdrop);
- ui/src/liner/pro/command-menu/command-menu.css:25 `[data-blur="live"] .l-cmd::backdrop` backdrop-filter: blur(10px) saturate(130%);
- ui/src/liner/pro/command-menu/command-menu.css:26 `[data-blur="live"] .l-cmd::backdrop` -webkit-backdrop-filter: blur(10px) saturate(130%);
- ui/src/liner/pro/command-menu/command-menu.css:48 `.l-cmd__panel` backdrop-filter: var(--l-lens,) var(--l-backdrop);
- ui/src/liner/pro/command-menu/command-menu.css:49 `.l-cmd__panel` -webkit-backdrop-filter: var(--l-lens,) var(--l-backdrop);

## blur (14)
- ui/src/app/app.css:6320 `.lc-ship-msg p` filter: blur(5px);
- ui/src/app/app.css:6436 `.lc-ship-row` filter: blur(5px);
- ui/src/app/app.css:6583 `.lc-ship-sw > *` filter: blur(4px);
- ui/src/app/app.css:6688 `.lc-ship-next` filter: blur(4px);
- ui/src/liner/components/hold-to-confirm/hold-to-confirm.css:72 `.l-hold__label` filter: blur(4px);
- ui/src/liner/components/button/button.css:180 `.l-btn__icon[data-hide]` filter: blur(2px);
- ui/src/liner/components/button/button.css:185 `.l-btn__spin` filter: blur(2px);
- ui/src/liner/pro/pr-flow/pr-flow.css:616 `.l-prf-hunk:not([data-done]) .l-prf-code[data-side="both"] p` filter: blur(4px);
- ui/src/liner/pro/pr-flow/pr-flow.css:848 `.l-prf__act[data-out]` filter: blur(3px);
- ui/src/liner/components/copy-button/copy-button.css:20 `.l-copy-icon__fail` filter: blur(2px);
- ui/src/liner/components/copy-button/copy-button.css:31 `.l-copy-icon[data-state="failed"] .l-copy-icon__copy` filter: blur(2px);
- ui/src/liner/components/notice-stack/notice-stack.css:48 `.l-notes__card[data-leaving]` filter: blur(3px);
- ui/src/liner/pro/workflow-builder/workflow-builder.css:792 `.l-wf-notice[data-out]` filter: blur(3px);
- ui/src/liner/components/text-field/text-field.css:204 `.l-field__clear` filter: blur(2px);

## tall (0)

## tlayout (42)
- ui/src/app/app.css:229 `.lc-app` transition: grid-template-columns 520ms var(--l-spring-smooth);
- ui/src/app/app.css:369 `html[data-native="mac"] :is(.lc-top, .lc-panel-top)` transition: padding 520ms var(--l-spring-smooth);
- ui/src/app/app.css:1690 `.lc-sbc[data-glide]` transition: top 180ms var(--l-ease-out);
- ui/src/app/app.css:2524 `.lc-fold` transition: grid-template-rows 420ms var(--l-spring-smooth);
- ui/src/app/app.css:3268 `.lc-field` transition: height 200ms var(--l-ease-out);
- ui/src/app/app.css:4385 `.lc-cost-dot` transition: left 320ms var(--l-ease-out);
- ui/src/app/app.css:4393 `.lc-cost-pair` transition: left 320ms var(--l-ease-out);
- ui/src/app/app.css:4402 `.lc-cost-tick` transition: left 320ms var(--l-ease-out);
- ui/src/app/app.css:4865 `.lc-viewed-bar i` transition: width 600ms var(--l-spring-smooth);
- ui/src/app/app.css:5044 `.lc-bar i` transition: width 700ms var(--l-spring-smooth);
- ui/src/app/app.css:6308 `.lc-ship-msg` transition: grid-template-rows calc(520ms * var(--k)) var(--l-spring-smooth);
- ui/src/app/app.css:6374 `.lc-ship-body` transition: grid-template-rows calc(380ms * var(--k)) var(--l-spring-smooth);
- ui/src/app/app.css:7217 `.lc-ctxm-bar > i` transition: width 500ms var(--l-ease-out);
- ui/src/app/app.css:7259 `.lc-lim-bars i` transition: width 700ms var(--l-spring-smooth);
- ui/src/liner/components/switch/switch.css:78 `.l-switch[data-dragging] .l-switch__thumb` transition: width 260ms var(--l-ease-out);
- ui/src/liner/components/toast/toast.css:23 `.l-toaster__list` transition: height 400ms var(--l-ease-out);
- ui/src/app/surfaces.css:696 `.lc-br-frame` transition: width 420ms var(--l-spring-smooth);
- ui/src/app/surfaces.css:3196 `.lc-budget-bar i` transition: width 700ms var(--l-spring-smooth);
- ui/src/app/surfaces.css:3456 `.lc-limits-bar i` transition: width 700ms var(--l-spring-smooth);
- ui/src/app/surfaces.css:4073 `.lc-page-f` transition: height 240ms var(--l-spring-smooth);
- ui/src/app/surfaces.css:5795 `.lc-br-zoom` transition: width 420ms var(--l-spring-smooth);
- ui/src/app/surfaces.css:6332 `.lc-sinfo-bar > span` transition: width 500ms ease;
- ui/src/liner/pro/approval-card/approval-card.css:8 `.l-appr__card` transition: height 380ms var(--l-spring-smooth);
- ui/src/liner/components/button/button.css:144 `.l-btn__sizer[data-ready]` transition: width var(--l-dur-spring-snappy) var(--l-spring-snappy);
- ui/src/liner/pro/pr-flow/pr-flow.css:143 `.l-prf__hero` transition: height 720ms var(--l-spring-smooth);
- ui/src/liner/pro/pr-flow/pr-flow.css:574 `.l-prf-code` transition: grid-template-rows 560ms var(--l-spring-smooth);
- ui/src/liner/components/reasoning/reasoning.css:62 `.l-reason-body` transition: height 360ms var(--l-ease-out);
- ui/src/liner/components/tree-view/tree-view.css:79 `.l-tree__kids` transition: grid-template-rows 320ms var(--l-spring-smooth);
- ui/src/app/dock.css:806 `.lc-offer-bar > div` transition: width 600ms var(--l-spring-smooth);
- ui/src/liner/pro/code-diff/code-diff.css:201 `.l-cdiff__body` transition: grid-template-rows 420ms var(--l-spring-smooth);
- ui/src/liner/pro/code-diff/code-diff.css:205 `.l-cdiff__file[data-folded] .l-cdiff__body` transition: grid-template-rows 260ms var(--l-ease-out);
- ui/src/liner/pro/code-diff/code-diff.css:382 `.l-cdiff__more` transition: grid-template-rows 480ms var(--l-spring-smooth);
- ui/src/app/design/design-face.css:1258 `html[data-native="mac"] .ld-bar` transition: padding 520ms var(--l-spring-smooth);
- ui/src/app/setup.css:269 `.lc-wel-fold` transition: grid-template-rows 380ms var(--l-ease-out);
- ui/src/liner/pro/workflow-builder/workflow-builder.css:708 `.l-wf-ask` transition: width 520ms var(--l-spring-smooth);
- ui/src/liner/pro/workflow-builder/workflow-builder.css:1115 `.l-wf-paths__bar > i` transition: width 620ms var(--l-spring-smooth);
- ui/src/liner/components/textarea/textarea.css:12 `.l-textarea__box > textarea` transition: height 260ms var(--l-ease-out);
- ui/src/liner/components/text-field/text-field.css:51 `.l-field__outline legend` transition: max-width 80ms linear;
- ui/src/liner/components/text-field/text-field.css:61 `.l-field[data-up] .l-field__outline legend` transition: max-width 260ms var(--l-ease-out) 40ms;
- ui/src/liner/components/text-field/text-field.css:230 `.l-field__msg` transition: grid-template-rows var(--l-dur-slow) var(--l-ease-out);
- ui/src/liner/components/avatar/avatar.css:56 `.l-avgroup__item` transition: margin 380ms var(--l-spring-snappy), translate 300ms var(--l-spring-snappy);
- ui/src/liner/pro/command-menu/command-menu.css:147 `.l-cmd__list` transition: height 380ms var(--l-spring-smooth);

## willchange (1)
- ui/src/app/design/design-face.css:526 `.ld-plane` will-change: transform;

## infinite (61)
- ui/src/app/app.css:585 `.lc-spin-arc` animation: lc-turn 900ms cubic-bezier(0.5, 0.15, 0.5, 0.85) infinite;
- ui/src/app/app.css:2721 `.lc-stepmark-arc` animation: lc-turn 900ms cubic-bezier(0.5, 0.15, 0.5, 0.85) infinite;
- ui/src/app/app.css:6476 `.lc-ship[data-p="2"] .lc-ship-rail .dash` animation: lc-ship-flow calc(600ms * var(--k)) linear infinite;
- ui/src/app/app.css:6642 `.lc-ship-spin` animation: l-spin 900ms linear infinite;
- ui/src/app/app.css:6856 `.lc-prc[data-busy] .lc-ship-rail .dash` animation: lc-ship-flow 600ms linear infinite;
- ui/src/app/app.css:7022 `.lc-prc-checks li[data-state="running"] .lc-prc-ck > span` animation: l-spin 900ms linear infinite;
- ui/src/liner/foundation.css:603 `.l-shimmer` animation: l-shimmer-light 2.2s linear infinite;
- ui/src/app/design/intro.css:342 `.ld-in-p1b::after` animation: ld-in-ring 9s linear 1200ms infinite backwards;
- ui/src/app/design/intro.css:347 `.ld-in-p1b img` animation: ld-in-draw 9s linear 1200ms infinite backwards;
- ui/src/app/design/intro.css:352 `.ld-in-p1who` animation: ld-in-who-x 9s linear 1200ms infinite backwards, ld-in-who-y 9s ease-in-out 1200ms infinite backwards;
- ui/src/app/design/intro.css:364 `.ld-in-p2f img` animation: ld-in2-ring 9s ease 700ms infinite backwards;
- ui/src/app/design/intro.css:373 `.ld-in-sel` animation: ld-in2-sel 9s ease 700ms infinite backwards;
- ui/src/app/design/intro.css:478 `.ld-in-chip` animation: ld-in2-chip 9s ease 700ms infinite backwards;
- ui/src/app/design/intro.css:488 `.ld-in-typed` animation: ld-in2-typed 9s ease 700ms infinite backwards;
- ui/src/app/design/intro.css:499 `.ld-in-send` animation: ld-in2-send 9s ease 700ms infinite backwards;
- ui/src/app/design/intro.css:510 `.ld-in-p2who` animation: ld-in2-who 9s var(--l-ease-out) 700ms infinite backwards;
- ui/src/app/design/intro.css:515 `.ld-in-p2me` animation: ld-in2-me 9s var(--l-ease-in-out) 700ms infinite backwards;
- ui/src/app/design/intro.css:660 `.ld-in-switch:not(.on)  animation: ld-in3-track 7s ease 1900ms infinite backwards; }` .ld-in-switch:not(.on) { animation: ld-in3-track 7s ease 1900ms infinite backwards; }
- ui/src/app/design/intro.css:661 `.ld-in-switch:not(.on)::after  animation: ld-in3-knob 7s var(--l-ease-out) 1900ms infinite backwards; }` .ld-in-switch:not(.on)::after { animation: ld-in3-knob 7s var(--l-ease-out) 1900ms infinite backwards; }
- ui/src/app/design/intro.css:787 `.ld-in-pill` animation: ld-in4-pill 9s ease 700ms infinite backwards;
- ui/src/app/design/intro.css:797 `.ld-in-4wm  animation: ld-in4-wm 9s var(--l-ease-out) 700ms infinite backwards; }` .ld-in-4wm { animation: ld-in4-wm 9s var(--l-ease-out) 700ms infinite backwards; }
- ui/src/app/design/intro.css:798 `.ld-in-4w  animation: ld-in4-w 9s ease 700ms infinite backwards; }` .ld-in-4w { animation: ld-in4-w 9s ease 700ms infinite backwards; }
- ui/src/app/design/intro.css:799 `.ld-in-p4find  animation: ld-in4-find 9s var(--l-ease-out) 700ms infinite backwards; }` .ld-in-p4find { animation: ld-in4-find 9s var(--l-ease-out) 700ms infinite backwards; }
- ui/src/app/design/intro.css:802 `.ld-in-4p` animation: ld-in4-p 9s ease 700ms infinite backwards;
- ui/src/app/design/intro.css:804 `.ld-in-4n  animation: ld-in4-n 9s ease 700ms infinite backwards; }` .ld-in-4n { animation: ld-in4-n 9s ease 700ms infinite backwards; }
- ui/src/app/design/intro.css:807 `.ld-in-4b` animation: ld-in4-b 9s ease 700ms infinite backwards;
- ui/src/app/design/intro.css:812 `.ld-in-p4me` animation: ld-in4-me 9s var(--l-ease-in-out) 700ms infinite backwards;
- ui/src/liner/components/toast/toast.css:166 `.l-toast__spin` animation: l-spin 0.8s linear infinite;
- ui/src/app/timeline.css:48 `.lc-you-thumb-wait` animation: lc-thumb-wait 1.4s linear infinite;
- ui/src/app/crew.css:30 `.lc-cr-faces > span[data-lead]` animation: lc-cr-ring 1.6s ease-in-out infinite;
- ui/src/app/crew.css:463 `.lc-cr-disc[data-on]` animation: lc-cr-ring 1.6s ease-in-out infinite;
- ui/src/app/surfaces.css:1047 `.lc-br-lspin` animation: l-spin 900ms linear infinite;
- ui/src/app/surfaces.css:1665 `.lc-pr-dot[data-tone="warn"]` animation: lc-breathe 1.6s ease-in-out infinite;
- ui/src/app/surfaces.css:1734 `.lc-rt-spin` animation: l-spin 900ms linear infinite;
- ui/src/app/surfaces.css:2098 `.lc-rt-mk[data-s="run"]` animation: l-spin 900ms linear infinite;
- ui/src/app/surfaces.css:3738 `.lc-commit-wait > i` animation: lc-commit-type 2.4s var(--l-ease-enter) infinite both;
- ui/src/app/surfaces.css:4043 `.lc-br-agent-dot` animation: lc-br-breathe 1.6s ease-in-out infinite;
- ui/src/app/surfaces.css:4826 `.lc-trail-light::before` animation: lc-rail 1.8s var(--l-ease-out) infinite;
- ui/src/app/surfaces.css:4867 `.lc-tstep[data-state="running"] .lc-tstep-dot` animation: lc-pulse-dot 1.6s var(--l-ease-out) infinite;
- ui/src/app/surfaces.css:5226 `.lc-pip` animation: lc-beat 1.4s ease-in-out infinite;
- ui/src/app/face.css:91 `.ld-pd[data-lead]::after` animation: ld-dot 1.6s cubic-bezier(0.22, 1, 0.36, 1) infinite;
- ui/src/app/design.css:780 `.lc-dm-box[data-on]::after` animation: lc-dm-breathe 1.6s cubic-bezier(0.22, 1, 0.36, 1) infinite;
- ui/src/liner/components/button/button.css:194 `.l-btn__spin[data-show] svg` animation: l-spin 0.7s linear infinite;
- ui/src/liner/pro/pr-flow/pr-flow.css:298 `.l-prf-target[data-state="busy"] .l-prf-target__arc` animation: l-spin 0.9s linear infinite;
- ui/src/liner/pro/pr-flow/pr-flow.css:560 `.l-prf-hunk[data-active]::after` animation: l-prf-scan 1.2s var(--l-ease-in-out) infinite;
- ui/src/liner/pro/pr-flow/pr-flow.css:755 `.l-prf-ring[data-spin] .l-prf-ring__arc` animation: l-spin 0.9s linear infinite;
- ui/src/liner/pro/ai-kit/ai-kit.css:438 `.l-aimark[data-phase="thinking"] .l-aimark-core` animation: l-aimark-breathe 1.6s var(--l-ease-in-out) infinite;
- ui/src/liner/pro/ai-kit/ai-kit.css:441 `.l-aimark[data-phase="thinking"] .l-aimark-spark` animation: l-aimark-twinkle 1.6s var(--l-ease-in-out) infinite;
- ui/src/liner/pro/ai-kit/ai-kit.css:445 `.l-aimark[data-phase="reading"] .l-aimark-sheen` animation: l-aimark-sheen 1.3s var(--l-ease-in-out) infinite;
- ui/src/liner/pro/ai-kit/ai-kit.css:448 `.l-aimark[data-phase="writing"] .l-aimark-spark` animation: l-aimark-turn 1.4s var(--l-ease-in-out) infinite;
- ui/src/liner/pro/ai-kit/ai-kit.css:602 `.l-ai-slot > i` animation: l-ai-slot-sheen 1.6s linear infinite;
- ui/src/liner/pro/ai-kit/ai-kit.css:958 `.l-rays__arc` animation: l-spin 900ms cubic-bezier(0.5, 0.15, 0.5, 0.85) infinite;
- ui/src/liner/components/reasoning/reasoning.css:132 `.l-reason-step[data-active] .l-reason-dot::before` animation: l-reason-pulse 1.2s var(--l-ease-in-out) infinite;
- ui/src/liner/components/text-shimmer/text-shimmer.css:10 `.l-tshimmer[data-active]` animation: l-shimmer-text var(--dur) linear infinite;
- ui/src/app/dock.css:229 `.lc-addon-frame[data-wait]` animation: lc-frame-wait 1.4s ease-in-out infinite;
- ui/src/liner/pro/agents/agents.css:58 `.l-agent[data-status="waiting"] .l-agent-badge::after` animation: l-agent-pulse 1.4s var(--l-ease-in-out) infinite;
- ui/src/liner/pro/agents/agents.css:69 `.l-agent-spin` animation: l-spin 0.9s linear infinite;
- ui/src/app/design/design-face.css:626 `.ld-pres::after` animation: ld-breathe 1.6s cubic-bezier(0.22, 1, 0.36, 1) infinite;
- ui/src/liner/components/progress/progress.css:49 `.l-progress__track[data-indeterminate] .l-progress__fill` animation: l-progress-sweep 1.5s var(--l-ease-in-out) infinite;
- ui/src/liner/components/inline-edit/inline-edit.css:156 `.l-iedit__spin` animation: l-spin 0.7s linear infinite;
- ui/src/app/addons-page.css:77 `.lc-ao-ghost[data-busy] svg` animation: lc-ao-spin 700ms linear infinite;

## shadowAnim (23)
- ui/src/app/app.css:737 `.lc-input` transition: box-shadow 160ms ease;
- ui/src/app/app.css:752 `.lc-radio` transition: box-shadow 260ms var(--l-spring-smooth);
- ui/src/app/app.css:3188 `.lc-card` transition: box-shadow 200ms ease;
- ui/src/app/app.css:5849 `.lc-st-mode` transition: box-shadow 200ms var(--l-ease-out);
- ui/src/app/app.css:6182 `.lc-swatch` transition: box-shadow 260ms var(--l-spring-smooth);
- ui/src/app/models.css:559 `.lc-mpop` transition: box-shadow 140ms ease;
- ui/src/app/timeline.css:271 `.lc-addon-key input` transition: box-shadow 180ms var(--l-ease-out);
- ui/src/app/surfaces.css:276 `.lc-spick-b` transition: box-shadow 160ms ease;
- ui/src/app/surfaces.css:657 `.lc-br-addr` transition: box-shadow 160ms ease;
- ui/src/app/surfaces.css:5637 `.lc-foot-chip` transition: box-shadow 160ms ease;
- ui/src/app/design.css:732 `.lc-dm-box` transition: box-shadow 140ms ease;
- ui/src/liner/pro/approval-card/approval-card.css:105 `.l-appr__why textarea` transition: box-shadow 180ms var(--l-ease-out);
- ui/src/liner/pro/pr-flow/pr-flow.css:548 `.l-prf-hunk` transition: box-shadow 300ms ease;
- ui/src/liner/pro/ai-kit/ai-kit.css:156 `.l-md-link[data-file] > code` transition: box-shadow 160ms ease;
- ui/src/app/dock.css:719 `.lc-offer-place` transition: box-shadow 140ms ease;
- ui/src/liner/pro/agents/agents.css:141 `.l-agent-ask__field` transition: box-shadow 180ms var(--l-ease-out);
- ui/src/app/design/design-face.css:982 `.ld-tile-pic` transition: box-shadow 140ms ease;
- ui/src/app/design/inspector.css:272 `.ld-fld` transition: box-shadow 140ms ease;
- ui/src/app/setup.css:422 `.lc-wel-clone input` transition: box-shadow 160ms ease;
- ui/src/app/wall.css:97 `.lc-wt` transition: box-shadow 160ms var(--l-ease-out);
- ui/src/app/wall.css:510 `.lc-wt-field` transition: box-shadow 140ms ease;
- ui/src/app/settings.css:104 `.lc-sb-find.lc-st-find` transition: box-shadow 160ms ease;
- ui/src/liner/components/slider/slider.css:28 `.l-slider__bar` transition: box-shadow var(--l-dur-fast) ease;

## has (51)
- ui/src/app/app.css:1073 .lc-sb-find:not(.lc-st-find):has(input:focus-visible) {
- ui/src/app/app.css:3116 .lc-tray:has(> .lc-tray-head > *, > .lc-strip) {
- ui/src/app/app.css:3235 html[data-composer="clear"] .lc-thread-foot .lc-tray:has(> .lc-tray-head > *)::before {
- ui/src/app/app.css:3242 html[data-composer="solid"] .lc-thread-foot .lc-tray:has(> .lc-tray-head > *) {
- ui/src/app/app.css:3534 .lc-card-row[data-give~="wrap"] .lc-seg > .lc-pop:has(.lc-who) {
- ui/src/app/app.css:3838 .lc-pop-panel:has(> .lc-team) {
- ui/src/app/app.css:3877 .lc-team-col:not(:has(> .lc-mp)) {
- ui/src/app/app.css:4572 .lc-home-in:has(> .lc-noproj) {
- ui/src/app/app.css:5342 .lc-ad-dd:has(> .lc-ad-mk) {
- ui/src/app/app.css:8639 .lc-sl-title:has(.lc-sb-rename) {
- ui/src/app/app.css:8666 .lc-sl-acts:has([data-open]) {
- ui/src/app/app.css:8669 .lc-sl-row:is(:hover, :focus-within):has(> .lc-sl-acts) > .lc-sl-pick,
- ui/src/app/app.css:8670 .lc-sl-row:has(> .lc-sl-acts [data-open]) > .lc-sl-pick,
- ui/src/app/app.css:8671 .lc-sl-fold:is(:hover, :focus-within):has(> .lc-sl-acts) > .lc-sl-fold-b {
- ui/src/app/app.css:8675 .lc-sl-row:is(:hover, :focus-within):has(> .lc-sl-acts) .lc-sl-end,
- ui/src/app/app.css:8676 .lc-sl-row:has(> .lc-sl-acts [data-open]) .lc-sl-end,
- ui/src/app/app.css:8677 .lc-sl-fold:is(:hover, :focus-within):has(> .lc-sl-acts) .lc-sl-fold-end {
- ui/src/app/app.css:8775 .lc-sb-row[data-forks]:has(> .lc-sl-acts [data-open]) > .lc-sb-forks {
- ui/src/liner/foundation.css:393 .l-focus-within:has(:focus-visible) {
- ui/src/liner/foundation.css:483 [style*="--l-lens"]:has(iframe) {
- ui/src/app/security/scan.css:236 .lsc-kvr:has(.lsc-field:focus-visible) {
- ui/src/app/security/scan.css:377 .lc-blk:has(> .lsc-tl-rw) + .lc-blk > .lsc-tl-rw::before {
- ui/src/app/security/scan.css:396 .lc-blk:has(> .lsc-tl-rw) {
- ui/src/app/timeline.css:241 .lc-addon .l-appr__fields > div:has(.lc-addon-key, .lc-addon-json, .lc-addon-long, .lc-ao-told) {
- ui/src/app/timeline.css:244 .lc-addon .l-appr__fields > div:has(.lc-addon-key) dt {
- ui/src/app/timeline.css:334 .lc-foot-row:has(> .lc-ledger) {
- ui/src/app/surfaces.css:189 .lc-stab:has(.lc-stab-x:focus-visible) .lc-stab-b > svg {
- ui/src/app/surfaces.css:1038 .lc-br-lgo:disabled:not(:has(.lc-br-lspin)) {
- ui/src/app/surfaces.css:1117 .lc-br-start-in:has(.lc-br-ask) {
- ui/src/app/surfaces.css:3293 .lc-turn:has(.lc-dz-inline) {
- ui/src/app/surfaces.css:4499 .lc-appr .l-appr__ask:has(.l-appr__why) .l-appr__actions {
- ui/src/app/surfaces.css:4887 .lc-tstep-verb:not(:has(+ .lc-tstep-target)) {
- ui/src/app/surfaces.css:5080 .lc-wk-verb:not(:has(+ .lc-wk-target)) {
- ui/src/app/surfaces.css:5247 .lc-tray:has(> .lc-tray-head > .lc-dask) {
- ui/src/app/surfaces.css:5250 .lc-tray:has(> .lc-tray-head > .lc-dask[data-high]) {
- ui/src/liner/components/code-block/code-block.css:115 .l-code__line:not(:has(.l-code__n)) .l-code__src {
- ui/src/liner/pro/ai-kit/ai-kit.css:151 .l-md-link[data-file]:has(> code) {
- ui/src/app/security/findings.css:191 .lf-li:has(> .lf-rw[data-on]) + .lf-li .lf-rw::before,
- ui/src/app/security/findings.css:192 .lf-li:has(> .lf-rw:hover) + .lf-li .lf-rw::before {
- ui/src/app/design/design-face.css:373 .ld-bar .lc-pop:has(> .ld-tt) {
- ui/src/app/design/design-face.css:1245 .lc-home-in:has(.ld-home-head > .ld-fit) .lc-home-compose .lc-tray {
- ui/src/app/design/lean-page.css:13 .ld-face:has(> .ld-lp) {
- ui/src/app/design/lean-page.css:448 .lc-home-in:has(> .ld-fit) .lc-home-compose .lc-tray {
- ui/src/app/design/build.css:574 .ld-label:has(.ld-bmark, .ld-lmark) > b {
- ui/src/app/design/checks.css:195 .ld-ck-spot:has([aria-expanded="true"]) {
- ui/src/app/design/chat.css:242 .ldc-body .lc-blk:has(> .lc-head:not([data-part])) {
- ui/src/liner/components/chart/chart.css:63 .l-viz__legend:has(li[data-muted]) li:not([data-muted]) {
- ui/src/liner/components/slider/slider.css:30 .l-slider__bar:has(.l-slider__range:focus-visible) {
- ui/src/liner/pro/workflow-builder/workflow-builder.css:402 .l-wf-node:has(.l-wf-node__side) .l-wf-node__kind {
- ui/src/liner/pro/workflow-builder/workflow-builder.css:780 .l-wf-notice:has(.l-wf-notice__act) {
- ui/src/liner/components/text-field/text-field.css:108 .l-field:has(.l-field__input:autofill) .l-field__label {

## kfLayout (2)
- ui/src/liner/components/rolling-number/rolling-number.css:24 `@keyframes l-roll-grow` grid-template-columns: 0fr;
- ui/src/liner/components/rolling-number/rolling-number.css:31 `@keyframes l-roll-shrink` grid-template-columns: 0fr;

## kfShadow (8)
- ui/src/app/app.css:1662 `@keyframes lc-ping`
- ui/src/app/crew.css:35 `@keyframes lc-cr-ring`
- ui/src/app/crew.css:40 `@keyframes lc-cr-ring`
- ui/src/app/surfaces.css:4872 `@keyframes lc-pulse-dot`
- ui/src/app/surfaces.css:4877 `@keyframes lc-pulse-dot`
- ui/src/app/surfaces.css:5738 `@keyframes lc-pulse`
- ui/src/app/surfaces.css:5741 `@keyframes lc-pulse`
- ui/src/liner/components/inline-edit/inline-edit.css:108 `@keyframes l-iedit-open`

## kfFilter (46)
- ui/src/app/app.css:1696 `@keyframes lc-sbc-in` filter: blur(2px);
- ui/src/app/app.css:2286 `@keyframes lc-focus-in` filter: blur(6px);
- ui/src/app/app.css:2811 `@keyframes lc-ask-in` filter: blur(6px);
- ui/src/app/app.css:5080 `@keyframes lc-wm` filter: blur(8px);
- ui/src/app/app.css:5560 `@keyframes lc-st-in` filter: blur(4px);
- ui/src/app/app.css:6840 `@keyframes lc-prc-row` filter: blur(5px);
- ui/src/liner/foundation.css:541 `@keyframes l-rise-in` filter: blur(3px);
- ui/src/liner/foundation.css:549 `@keyframes l-unblur` filter: blur(8px);
- ui/src/liner/foundation.css:555 `@keyframes l-blur-in` filter: blur(6px);
- ui/src/liner/foundation.css:562 `@keyframes l-blur-out` filter: blur(3px);
- ui/src/liner/foundation.css:614 `@keyframes l-swap-in` filter: blur(5px);
- ui/src/app/design/intro.css:837 `@keyframes ld-in-focus` from { opacity: 0; filter: blur(4px); }
- ui/src/app/design/intro.css:840 `@keyframes ld-in-rise` from { opacity: 0; filter: blur(4px); translate: 0 8px; }
- ui/src/app/design/intro.css:899 `@keyframes ld-in2-chip` 0%, 17% { opacity: 0; filter: blur(4px); }
- ui/src/app/design/intro.css:904 `@keyframes ld-in2-typed` 0%, 30% { opacity: 0; filter: blur(4px); }
- ui/src/app/design/intro.css:953 `@keyframes ld-in4-find` 0%, 9% { opacity: 0; translate: 0 8px; filter: blur(4px); }
- ui/src/app/design/intro.css:968 `@keyframes ld-in4-b` 0%, 64% { opacity: 0; filter: blur(3px); }
- ui/src/liner/components/rolling-number/rolling-number.css:26 `@keyframes l-roll-grow` filter: blur(3px);
- ui/src/liner/components/rolling-number/rolling-number.css:33 `@keyframes l-roll-shrink` filter: blur(3px);
- ui/src/liner/components/rolling-number/rolling-number.css:70 `@keyframes l-roll-in-up` filter: blur(2px);
- ui/src/liner/components/rolling-number/rolling-number.css:77 `@keyframes l-roll-out-up` filter: blur(2px);
- ui/src/liner/components/rolling-number/rolling-number.css:84 `@keyframes l-roll-in-down` filter: blur(2px);
- ui/src/liner/components/rolling-number/rolling-number.css:91 `@keyframes l-roll-out-down` filter: blur(2px);
- ui/src/liner/lib/overlay.css:45 `@keyframes l-pop-in` filter: blur(6px);
- ui/src/liner/lib/overlay.css:52 `@keyframes l-pop-up` filter: blur(6px);
- ui/src/liner/components/tooltip/tooltip.css:53 `@keyframes l-tip-in` filter: blur(4px);
- ui/src/liner/components/button/button.css:231 `@keyframes l-btn-in` filter: blur(4px);
- ui/src/liner/components/button/button.css:238 `@keyframes l-btn-out` filter: blur(4px);
- ui/src/liner/pro/pr-flow/pr-flow.css:842 `@keyframes l-prf-act` filter: blur(4px);
- ui/src/liner/pro/ai-kit/ai-kit.css:12 `@keyframes l-chunk-in` filter: blur(8px);
- ui/src/liner/pro/ai-kit/ai-kit.css:581 `@keyframes l-ai-card-in` filter: blur(6px);
- ui/src/liner/pro/ai-kit/ai-kit.css:827 `@keyframes l-ai-menu-in` filter: blur(6px);
- ui/src/liner/pro/ai-kit/ai-kit.css:853 `@keyframes l-ai-menu-down` filter: blur(6px);
- ui/src/liner/components/reasoning/reasoning.css:180 `@keyframes l-reason-chip` filter: blur(2px);
- ui/src/app/design/inspector.css:132 `@keyframes ld-in` filter: blur(4px);
- ui/src/app/setup.css:447 `@keyframes lc-wel-in` filter: blur(4px);
- ui/src/app/setup.css:486 `@keyframes lc-wel-out` filter: blur(6px);
- ui/src/liner/pro/workflow-builder/workflow-builder.css:294 `@keyframes l-wf-in` filter: blur(6px);
- ui/src/liner/pro/workflow-builder/workflow-builder.css:320 `@keyframes l-wf-out` filter: blur(4px);
- ui/src/liner/pro/workflow-builder/workflow-builder.css:507 `@keyframes l-wf-pill-in` filter: blur(4px);
- ui/src/liner/pro/workflow-builder/workflow-builder.css:786 `@keyframes l-wf-note-in` filter: blur(6px);
- ui/src/liner/components/avatar/avatar.css:94 `@keyframes l-avtip-in` filter: blur(4px);
- ui/src/liner/pro/command-menu/command-menu.css:60 `@keyframes l-cmd-in` filter: blur(6px);
- ui/src/liner/pro/command-menu/command-menu.css:67 `@keyframes l-cmd-out` filter: blur(4px);
- ui/src/liner/pro/command-menu/command-menu.css:162 `@keyframes l-cmd-page-in` filter: blur(3px);
- ui/src/liner/pro/command-menu/command-menu.css:169 `@keyframes l-cmd-page-back` filter: blur(3px);

## reduced-motion per file (reduce-queries, animation decls, transition decls)
- ui/src/app/app.css: 13 / 74 / 94
- ui/src/liner/foundation.css: 2 / 2 / 1
- ui/src/app/design/intro.css: 1 / 42 / 2
- ui/src/app/security/security.css: 0 / 1 / 0
- ui/src/liner/components/switch/switch.css: 0 / 0 / 5
- ui/src/liner/components/rolling-number/rolling-number.css: 1 / 4 / 0
- ui/src/liner/lib/overlay.css: 1 / 2 / 2
- ui/src/app/security/scan.css: 0 / 2 / 1
- ui/src/app/models.css: 2 / 3 / 7
- ui/src/liner/components/toast/toast.css: 1 / 5 / 8
- ui/src/app/timeline.css: 1 / 5 / 5
- ui/src/app/precheck.css: 2 / 4 / 0
- ui/src/app/crew.css: 1 / 5 / 4
- ui/src/app/surfaces.css: 11 / 52 / 45
- ui/src/app/face.css: 2 / 3 / 3
- ui/src/liner/components/hold-to-confirm/hold-to-confirm.css: 1 / 1 / 5
- ui/src/app/design.css: 2 / 6 / 5
- ui/src/liner/components/code-block/code-block.css: 0 / 1 / 1
- ui/src/liner/components/segmented/segmented.css: 1 / 1 / 4
- ui/src/liner/components/dialog/dialog.css: 0 / 4 / 1
- ui/src/liner/components/tooltip/tooltip.css: 0 / 1 / 0
- ui/src/liner/pro/approval-card/approval-card.css: 1 / 5 / 3
- ui/src/liner/components/badge/badge.css: 1 / 3 / 0
- ui/src/liner/components/button/button.css: 1 / 5 / 5
- ui/src/liner/pro/pr-flow/pr-flow.css: 0 / 23 / 26
- ui/src/liner/pro/ai-kit/ai-kit.css: 2 / 20 / 14
- ui/src/liner/components/reasoning/reasoning.css: 1 / 6 / 5
- ui/src/liner/components/text-shimmer/text-shimmer.css: 1 / 3 / 0
- ui/src/liner/components/copy-button/copy-button.css: 0 / 0 / 3
- ui/src/liner/components/tree-view/tree-view.css: 0 / 0 / 4
- ui/src/app/dock.css: 0 / 5 / 4
- ui/src/liner/pro/agents/agents.css: 0 / 4 / 3
- ui/src/liner/pro/code-diff/code-diff.css: 1 / 2 / 9
- ui/src/app/agentic.css: 0 / 0 / 2
- ui/src/app/security/overview.css: 0 / 0 / 1
- ui/src/app/security/findings.css: 0 / 1 / 0
- ui/src/app/design/design-face.css: 2 / 8 / 10
- ui/src/app/design/lean-page.css: 1 / 4 / 3
- ui/src/app/design/live.css: 1 / 4 / 0
- ui/src/app/design/ways.css: 0 / 1 / 0
- ui/src/app/design/inspector.css: 1 / 1 / 4
- ui/src/app/design/chat.css: 1 / 4 / 1
- ui/src/app/setup.css: 1 / 8 / 6
- ui/src/app/wall.css: 1 / 4 / 5
- ui/src/liner/components/chart/chart.css: 1 / 6 / 5
- ui/src/app/settings.css: 2 / 5 / 11
- ui/src/app/updates.css: 0 / 0 / 1
- ui/src/liner/components/notice-stack/notice-stack.css: 1 / 2 / 6
- ui/src/liner/components/slider/slider.css: 0 / 0 / 4
- ui/src/liner/lib/field.css: 0 / 1 / 3
- ui/src/liner/components/select/options.css: 0 / 2 / 3
- ui/src/liner/components/progress/progress.css: 0 / 1 / 3
- ui/src/liner/components/radio-group/radio-group.css: 0 / 0 / 3
- ui/src/liner/components/radio-cards/radio-cards.css: 0 / 0 / 3
- ui/src/liner/components/breadcrumb/breadcrumb.css: 0 / 1 / 1
- ui/src/liner/components/menu/menu.css: 0 / 0 / 2
- ui/src/liner/pro/workflow-builder/workflow-builder.css: 1 / 27 / 21
- ui/src/liner/components/sparkline/sparkline.css: 0 / 0 / 1
- ui/src/liner/components/inline-edit/inline-edit.css: 0 / 4 / 2
- ui/src/liner/components/textarea/textarea.css: 0 / 1 / 2
- ui/src/liner/components/text-field/text-field.css: 1 / 6 / 11
- ui/src/liner/components/avatar/avatar.css: 0 / 1 / 1
- ui/src/app/addons-page.css: 2 / 4 / 3
- ui/src/liner/pro/command-menu/command-menu.css: 1 / 9 / 5

## Appendix H. Main chunk, estimated minified size per source file (top 45)

```
134656 ui/src/app/app.css
93218 ui/src/app/surfaces.css
65559 ui/src/app/Timeline.tsx
47146 ui/src/app/Composer.tsx
45972 ui/src/app/Sidebar.tsx
39402 ui/src/app/brands.ts
35626 ui/src/app/Crew.tsx
27012 ui/src/app/Session.tsx
26997 ui/src/app/App.tsx
25805 ui/src/app/icons.tsx
25635 ui/src/app/Design.tsx
25055 ui/src/app/AddonsPage.tsx
24840 ui/src/app/Pr.tsx
24586 ui/src/app/Browser.tsx
22479 ui/src/app/Addon.tsx
16751 ui/src/app/Review.tsx
16303 ui/src/app/Panel.tsx
15184 ui/src/liner/pro/ai-kit/ai-kit.css
15104 ui/src/liner/pro/ai-kit/markdown.tsx
14827 ui/src/liner/foundation.css
14314 ui/src/app/dock.css
13644 ui/src/app/AgentDialog.tsx
13245 ui/src/app/Agentic.tsx
12888 ui/src/app/ui.tsx
12150 ui/src/app/crew.css
11305 ui/src/app/Routines.tsx
11297 ui/src/app/Models.tsx
11294 ui/src/app/design.css
10891 ui/src/liner/pro/code-diff/code-diff.tsx
10501 ui/src/app/DesignMini.tsx
10298 ui/src/app/Ask.tsx
10269 contracts/src/dsh.ts
10098 contracts/src/index.ts
9883 ui/src/app/model.ts
8789 ui/src/app/addons-page.css
8638 ui/src/app/Files.tsx
8470 ui/src/app/models.css
8465 ui/src/app/Surfaces.tsx
8464 ui/src/app/Projects.tsx
8081 contracts/src/doing.ts
7933 ui/src/app/keymap.ts
7583 contracts/src/panel.ts
7534 ui/src/app/Env.tsx
7362 ui/src/app/PrCard.tsx
7256 ui/src/liner/pro/code-diff/code-diff.css
```

Totals (minified estimate): app JS 717 KB, liner JS 96 KB, contracts JS 44 KB; app CSS 301 KB, liner CSS 87 KB, xterm/fonts CSS 7 KB.
