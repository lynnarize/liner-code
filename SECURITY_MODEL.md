# Liner Code: threat model

Repository: `lynnarize/liner-code`, version 0.2.5 beta. No infrastructure repository: the app runs locally, and the marketing site is a static Cloudflare Worker defined in `site/wrangler.jsonc`.
Legend: **[user]** = stated by the repo owner; **[code]** = inferred from the code.

## System overview and trust boundaries
Liner Code is a single-user desktop agent harness (Electron, macOS and Windows). It drives the agent CLIs the user already has: Claude Code, Codex, OpenCode, Hermes, ACP agents, and OpenAI-compatible API endpoints. **[code]**

- **Electron shell ↔ renderer.** The window uses `contextIsolation`, `sandbox` and no `nodeIntegration` (`desktop/src/main.ts`). The preload (`desktop/src/preload.ts`) exposes `__LINER__` (the engine URL and token) and `linerShell.call` over one IPC channel. Popups go to `shell.openExternal` (http/https/mailto only), `<webview>` is blocked, and permissions are limited to the app origin.
- **Shell ↔ engine.** The engine is a child Node process on 127.0.0.1 (`engine/src/server.ts`). `/events` and `/rpc` require `x-liner-token`, a random 24-byte per-run token compared in constant time. Secrets reach the engine on stdin and are not passed on to anything it spawns (`engine/src/main.ts`).
- **Engine ↔ local machine / other origins.** Other local apps and web pages in the user's browser can reach 127.0.0.1. Routes that skip the app token, each with its own guard:
  - `/surface`: per-session key, used by an agent's MCP tools.
  - `/outside`: key in `~/.liner-code/outside.json`, only while that setting is on.
  - `/hooks/r/<id>?key=`: a routine's webhook secret.
  - `/addon-check/<token>`, `/dsh/<token>/…`: a per-run token.
  - `PANEL_FRAME`, `/health`, the static UI: no guard.
- **Engine ↔ agents.** Agents run with the user's sign-ins and an access mode (read/ask/edits/auto/full). `engine/src/risk.ts` classifies tool-call risk for approval cards; even in Full access, the guard asks about irreversible steps.
- **Untrusted content → agents.** Repo files, PR and issue bodies (routines), webhook bodies, and pages in the Browser surface can carry prompt injection.
- **Add-ons.** MCP connections (manifest only; secrets sealed in the keychain), panels in a `sandbox="allow-scripts"` iframe with a CSP and Connection-Allowlist (`contracts/src/panel.ts`, `engine/src/panels.ts`), and ported DeepSeek Harness plugins run as separate processes. Those processes are sandboxed with `sandbox-exec` on macOS and unsandboxed on Windows and Linux (`engine/src/dsh-hosts.ts`).
- **Release → user machine.** Self-update from GitHub releases checks the SHA-256 (from the release digest or a sidecar file), the bundle id, the version, `codesign --verify --deep --strict` and the same Team ID (`engine/src/updates.ts`). The shell swaps the bundle in (`desktop/src/update.ts`).

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
- GitHub data polled by routines through `gh`; webhook bodies.
- GitHub release assets fetched by the updater; npm dist-tags for tool updates.

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
- Panels get a sandboxed iframe with an opaque origin, a CSP, a Connection-Allowlist against WebRTC, and an engine-side access check (`panels.ts` `refusal`).
- The proxy checks that Host is 127.0.0.1/localhost on its own port, against DNS rebinding.
- DSH plugins run under `sandbox-exec` on macOS (no access to keys or Liner state); there is no sandbox on Windows or Linux, and the plugin's card says so.
- Updates are checked by SHA-256, bundle id, version, codesign and the same Team ID.
- `risk.ts` marks destructive commands as high risk, and Full access still asks about irreversible steps.
- Routine gates are code, not AI: merges are limited per day and pinned to the commit that was read.

## Out of scope / accepted risk
- `site/` (the marketing website) **[user]**.

## Open questions
- Is Windows auto-update in place, and does it get integrity checks equivalent to codesign and Team ID?
- Is remote access or a public webhook ingress planned? It would widen the routines and engine surface.
