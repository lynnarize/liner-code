# Liner Code: threat model

Repository: `lynnarize/liner-code`, version 0.3.0 beta. No infrastructure repository: the app runs locally, and the marketing site is a static Cloudflare Worker defined in `site/wrangler.jsonc`.
Legend: **[user]** = stated by the repo owner; **[code]** = inferred from the code.

## System overview and trust boundaries
Liner Code is a single-user desktop agent harness (Electron, macOS and Windows). It drives the agent CLIs the user already has: Claude Code, Codex, OpenCode, Hermes, ACP agents, and OpenAI-compatible API endpoints. **[code]**

- **Electron shell ↔ renderer.** The window uses `contextIsolation`, `sandbox` and no `nodeIntegration` (`desktop/src/main.ts`). The preload (`desktop/src/preload.ts`) exposes `__LINER__` (the engine URL and token) and `linerShell.call` over one IPC channel. Popups go to `shell.openExternal` (http/https/mailto only), "Open in your editor" (`openFile`, from Changes and a Security finding) opens only a file inside the session's or project's own folder, which the shell reads from the engine rather than the page, links resolved (`desktop/src/editor.ts`), and never runs it; `openIn` (a folder in Finder, a terminal or an editor) takes the page's path, follows its links first (realpath) and judges what it resolves to, refusing a path that doesn't resolve (a dangling link, nothing there), and never opens a file as itself: a file sent to an editor goes to a known editor, else TextEdit on a Mac or Notepad on Windows (one argument, no shell), else is shown in its folder, and a file sent anywhere else is shown in its folder; on a Mac a folder whose real name has an extension (`Foo.app`, a workflow, or a link named `tools/run` that points at one) is shown in Finder whatever was asked; a plain folder is still handed to `shell.openPath`, `<webview>` is blocked, and permissions are limited to the app origin.
- **Shell ↔ engine.** The engine is a child Node process on 127.0.0.1 (`engine/src/server.ts`). `/events` and `/rpc` require `x-liner-token`, a random 24-byte per-run token compared in constant time. Secrets reach the engine on stdin and are not passed on to anything it spawns (`engine/src/main.ts`).
- **Engine ↔ local machine / other origins.** Other local apps and web pages in the user's browser can reach 127.0.0.1. Routes that skip the app token, each with its own guard:
  - `/surface`: per-session key, used by an agent's MCP tools.
  - `/outside`: key in `~/.liner-code/outside.json`, only while that setting is on.
  - `/hooks/r/<id>?key=`: a routine's webhook secret. Routines are switched off in this version (ROUTINES_ON in contracts/src/index.ts), so no webhook is taken.
  - `/addon-check/<token>`, `/dsh/<token>/…`: a per-run token.
  - `PANEL_FRAME`, `/health`, the static UI: no guard.
- **Engine ↔ agents.** Agents run with the user's sign-ins and an access mode (read/ask/edits/auto/full). `engine/src/risk.ts` classifies tool-call risk for approval cards; even in Full access, the guard asks about irreversible steps.
- **Untrusted content → agents.** Repo files, PR and issue bodies (routines), webhook bodies, and pages in the Browser surface can carry prompt injection.
- **Add-ons.** MCP connections (manifest only; secrets sealed in the keychain), panels in a `sandbox="allow-scripts"` iframe with a CSP and Connection-Allowlist (`contracts/src/panel.ts`, `engine/src/panels.ts`), and ported DeepSeek Harness plugins run as separate processes. Those processes are sandboxed with `sandbox-exec` on macOS and unsandboxed on Windows and Linux (`engine/src/dsh-hosts.ts`).
- **Release → user machine.** Self-update from GitHub releases checks the SHA-256 (from the release digest or a sidecar file), the bundle id, the version, `codesign --verify --deep --strict` and the same Team ID (`engine/src/updates.ts`). The shell checks the bundle id and the signature again right before it swaps the bundle in (`desktop/src/signed.ts`, `desktop/src/update.ts`); one that fails is deleted, the engine says so once, and the release downloads again.

## Components
| Component | Code |
| --- | --- |
| **Desktop shell** | `desktop/` (main, preload, IPC, keys, tray, update swap), `mac/` (Swift shell, Keychain) |
| **Engine API** | `engine/src/server.ts`, `api.ts`, `main.ts`, `store.ts`, `contracts/src/index.ts` |
| **Agent runtime** | `engine/src/runtime.ts`, `providers/`, `risk.ts`, `exec.ts`, `agent-tools.ts`, `mcp.ts`, `liner-tools.ts`, `checkpoints.ts`, `worktrees.ts`, `review.ts`, `sidekick.ts`, `launch.ts`, `imports.ts`, `memory.ts` |
| **Surfaces** | `engine/src/proxy.ts`, `surfaces.ts`, `designs.ts`, `files.ts`, `watch.ts`, `winterm.ts` (Browser, Terminal, Files, Design, Device) |
| **Add-ons & plugins** | `engine/src/addons.ts`, `panels.ts`, `creator.ts`, `dsh*.ts`, `contracts/src/panel.ts`, `contracts/src/dsh.ts` |
| **Routines & outside access** | `engine/src/routines.ts`, `prflow.ts`, `outside.ts`, `outside-tools.ts` |
| **Updates & release** | `engine/src/updates.ts`, `desktop/src/update.ts`, `scripts/`, `.github/` |
| **UI** | `ui/` (React renderer) |
| **Website** | `site/`: out of scope **[user]** |

## Entry points and who can reach them
- The engine's HTTP server on 127.0.0.1: any local process, and any web page via the browser (cross-origin requests, DNS rebinding).
- Per-port proxies of the Browser surface on 127.0.0.1 (Host and Origin checks in `proxy.ts`).
- Agent output and tool calls: driven by model output and whatever content the agent reads.
- MCP stdio servers (`mcp.ts`, `outside.ts`) started by agent tools.
- Add-on manifests and panel/plugin code written by agents or installed by the user.
- GitHub data polled by routines through `gh`, and by the once-a-minute watch (`watch.ts`) on a session's open pull request: while its saved checks read running (two hours at most from when they were first read so, kept with the session across restarts), while Settings settles sessions on merge, or while a snoozed session waits on it. The checks alone only refresh the session's pull request facts; they never settle or wake it. Webhook bodies.
- GitHub release assets fetched by the updater; npm dist-tags for tool updates.
- Commands the engine runs by itself to list a tool's models (`engine/src/providers/`). Each is a listing that runs no model turn and sends no prompt, started with the engine's environment (an OpenCode one also with Liner Code's permission rules) and only the named fields of its answer are kept, in `models.json` (a model's id, name, description, group, effort levels, default and price; never an OpenCode model's `headers` or `settings`). They run at launch when the saved list is half a day old or the tool's version changed, on Look again in Models, and in Check my tools (which gives each 30 seconds). Claude Code: the Agent SDK's `supportedModels()` on a session with no prompt, in `~/.liner-code/probe` with only your user settings, 30 seconds; `claude --version`; and a second such session with the older models added to its picker for that look alone (the `modelPicker` setting), only when its answer for this account and Claude Code version isn't kept yet (`probe/claude-older.json`, the older models' rows alone). Codex: `codex debug models`, 20 seconds. Antigravity: `agy models`, 30 seconds. OpenCode: from version 2 (its `--version`, 8 seconds, read once per program file), `opencode api --standalone GET /api/model` in the probe folder (standalone, so it never starts OpenCode's background service), in a process group of its own that is ended whole past 30 seconds or when the look is stopped; before version 2, or when that fails, its ACP session as below. ACP agents (OpenCode, Hermes, Cursor, Grok Build, ones you added): `initialize` and `session/new` in the probe folder with no MCP servers, 45 seconds, then the process group is ended.
- `liner-code://` links, which any web page can open once the browser's prompt is accepted (`desktop/src/deeplink.ts`): one naming a session opens it; one naming a folder (`open?path=`) asks in a native dialog before the folder is added as a project, since adding one runs git there. A folder named on a command line you typed is added without asking.
- OpenCode's local server: the engine starts `opencode serve` on 127.0.0.1 and drives it over HTTP and server-sent events (`providers/opencode-server.ts`), one process shared by the sessions on that binary and configuration; its permission requests come back to Liner Code's access levels as the ACP driver's do.
- A project's `.liner/patch.json` (`patches.ts`), which comes with the repository: it may add `deny` and `ask` permission rules and change presets, never `allow` rules (those only from `<LINER_HOME>/patch.json` or Settings).
- Outbound, on a press or a keystroke: `gh pr list` when you type `#` in the message box (cached 30 seconds), and `git fetch` and `git pull` from Fetch & pull.
- Outbound: one anonymous usage count a day to linercode.dev (engine/src/usage-ping.ts): install id, version, OS and chip, day, token counts. Off with the Settings switch or LINER_NO_USAGE=1.

## Assets
All of the following are equally critical **[user]**:
- API keys and agent sign-ins (safeStorage in `desktop/src/keys.ts`, the keychain, add-on secrets).
- Source code and git history in the user's projects, including `refs/liner/` checkpoints and worktrees.
- Code execution on the user's machine.
- Routines that act on GitHub: merge, comment, label, close.
- The engine token, the surface/outside keys and webhook secrets, which guard the above.

## Attacker profiles
All of the following matter **[user]**:
1. A malicious web page or another local app reaching the engine, a proxy or a plugin port on 127.0.0.1.
2. Untrusted repo content, PR or issue text, webhook payloads or web pages that steer agents through prompt injection.
3. A malicious add-on, panel or DeepSeek Harness plugin, including one an agent drafted.
4. A tampered update or a compromised release supply chain.

No multi-user, server-side or cloud attacker: the app has no backend of its own **[code]**.

## Existing controls
**[code]**
- The per-run token is required on `/rpc` and `/events`, compared with `timingSafeEqual`, and the server binds to loopback only.
- Each sensitive route has its own scoped secret; webhook secrets are compared in constant time (`routines.ts`).
- The Electron window is hardened: sandbox, context isolation, permission handler, `<webview>` blocked, external links allowlisted by scheme.
- Panels get a sandboxed iframe with an opaque origin, a CSP, a Connection-Allowlist against WebRTC, and an engine-side access check (`panels.ts` `refusal`). The Connection-Allowlist header fails open: if an Electron upgrade stops honouring it, nothing blocks WebRTC from a panel, so desktop/test/panel-network.test.ts must pass (not skip) after every Electron upgrade.
- The proxy checks that Host is 127.0.0.1/localhost on its own port, against DNS rebinding.
- DSH plugins run under `sandbox-exec` on macOS (no access to keys or Liner state); there is no sandbox on Windows or Linux, and the plugin's card says so.
- Updates are checked by SHA-256, bundle id, version, codesign and the same Team ID. The Team ID check applies only once this copy is signed with a Developer ID; an ad-hoc copy takes the first signed release and is pinned from then on. The SHA-256 comes from the same release as the download, so it proves the download is whole, not who published it.
- `risk.ts` marks destructive commands as high risk, and Full access still asks about irreversible steps.
- Hermes's agents sent to the background: the engine reads the live log Hermes writes for each one, only a `task-<n>.log` that resolves (links followed) under that Hermes's own `cache/delegation/live`, whatever path its dispatch names, and only its last megabyte, every 0.7 s while it grows, for six hours at most (`acp.ts` `liveLogs`, `follow`). It reads nothing else of Hermes's home and writes nothing there.
- Routine gates are code, not AI: merges are limited per day and pinned to the commit that was read.

## Out of scope / accepted risk
- `site/` (the marketing website) **[user]**.

## Open questions
- Windows does not update itself yet: a packaged Windows copy only tells you a new version exists (engine/src/updates.ts). When it gains an updater it needs integrity checks equal to codesign and Team ID.
- Is remote access or a public webhook ingress planned? It would widen the routines and engine surface.
