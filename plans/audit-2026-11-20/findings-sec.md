# Security audit findings — Liner Code (SEC)

Auditor: security subagent, 2026-11-20. Repo HEAD bfb0ebc, branch design-and-api-endpoints.
Playbook read: /Users/hilmi/.hermes/skills/improve/references/audit-playbook.md (sections 2. Security, Finding format, Prioritization rubric). Threat model read: SECURITY_MODEL.md.
npm audit (prod and full): only the 5 already-REJECTED moderate advisories (hono/@hono/node-server via SDK MCP lib; glob/minimatch/@electron/asar via packager). No new high/critical. Not re-reported.

Findings are appended as confirmed; IDs are stable.

### [SEC-01] Endpoint and add-on keys reach spawned processes through the environment, where anything running as you can read them

- **Evidence**: `engine/src/providers/endpoint.ts:45` — third-party endpoint key set as `ANTHROPIC_AUTH_TOKEN` in the spawned Claude Code process env; `engine/src/providers/endpoint.ts:64,71` — same key as `LINER_ENDPOINT_KEY` in Codex/OpenCode env. `engine/src/addons.ts:826-830` — add-on connection secrets filled into spawned MCP servers' env. Contrast `engine/src/agent-tools.ts:310-319`, which moved the session key to a 0600 file precisely because "an environment and a command line can be read by anything running as you (ps eww), a sandboxed plugin included". `SECURITY_MODEL.md:10` states secrets "are not passed on to anything it spawns" — the code passes these keys on, in env.
- **Impact**: Any same-user process — including a sandboxed DSH plugin, whose sandbox allows reading process info — can harvest third-party API keys and add-on secrets from the env of running agent tools/MCP servers with `ps eww`. The session-key fix (plan 004) closed this hole for surface keys but left the larger-value keys (API keys are "equally critical" assets per SECURITY_MODEL.md) exposed. Also decision-drift: the threat model's shell↔engine bullet claims spawned processes get no secrets.
- **Effort**: M — pass endpoint/add-on keys via a per-session 0600 file or stdin handoff where each tool supports it (Codex env_key and OpenCode {env:…} read env by design, so some tools need a wrapper or a documented exception); update SECURITY_MODEL.md to say exactly which keys go where.
- **Risk**: MED — each agent tool reads its key differently; a wrong handoff breaks endpoint sessions. Needs the real-tool run the release rules already require.
- **Confidence**: HIGH (code read; exposure mechanism is the one the repo itself documents at agent-tools.ts:310).
- **Fix sketch**: Extend the plan-004 key-file pattern to endpoint and add-on keys where the tool can read a file/stdin; where a tool only accepts env, record that exception explicitly in SECURITY_MODEL.md and the ROADMAP open item instead of the blanket "not passed on" claim.

### [SEC-02] The update's signature is re-verified before the waiter script starts, not right before the swap

- **Evidence**: `desktop/src/update.ts:53-61` — `install()` calls `staged()` (which runs codesign/Team-ID checks via `desktop/src/signed.ts:39-59`), then spawns a bash script; `desktop/src/update.ts:40-45` (SCRIPT) — the script waits up to 60 s for the app to exit and only then `mv`s the bundle into place. `SECURITY_MODEL.md:20` says the shell checks the signature "again right before it swaps the bundle in".
- **Impact**: A same-user local process (attacker profile 1 in the threat model) with write access to `~/.liner-code/updates` can replace the verified bundle during the verify→exit→mv window (tens of seconds, plus however long the user takes to quit), and the swap installs the replacement as the app. The script also strips quarantine (`update.ts:47`), so Gatekeeper's first-launch assessment never runs on what was swapped in. The re-verification built in plan 010 covers download→swap tampering at rest, but not this race.
- **Effort**: M — re-run `signedAsOurs` inside the swap script immediately before `mv` (codesign is available to bash), or verify-and-move atomically via a hardlink/rename of a just-verified copy; add a desktop test that swaps the staged bundle after verification and expects refusal.
- **Risk**: LOW — the check already exists; moving it later in the sequence only adds a refusal path.
- **Confidence**: MED (race read from code; needs a local writer to exploit, and the ad-hoc-trust open item already accepts a weaker baseline for unsigned copies).
- **Fix sketch**: Verify in the script right before the move (fail → swap-failed.txt), and correct SECURITY_MODEL.md's "right before" wording to match wherever the check lands.

### [SEC-03] /addon-check call and report read the whole body before checking the token

- **Evidence**: `engine/src/server.ts:208-214` — `/addon-check/<tok>/call` and `/report` do `await body(req)` (up to 64 MB, `server.ts:98`) and only then look the token up in `checkCall`/`checkReport` (`engine/src/agent-tools.ts:864-866,887-889`). Contrast `engine/src/server.ts:168-169`: /surface and /outside check the key first, with the comment "a caller without one isn't worth 64 MB of reading".
- **Impact**: Any web page (simple POST, no preflight needed for text/plain) or local process can make the engine buffer up to 64 MB per request against invented 36-hex tokens, with no rate limit — memory pressure / slow-body DoS on the engine that drives the user's agents. The same guard the repo built for the other keyless routes is missing here.
- **Effort**: S — add a `knows.check(token)` pre-check (the checks map already exists) before reading the body, mirroring the surface/outside path; test that an unknown token is refused without a body read.
- **Risk**: LOW — mirrors an existing, tested pattern.
- **Confidence**: HIGH.
- **Fix sketch**: Extend the `knows` hook with a check-token predicate and refuse unknown tokens before `body(req)` on call/report (settle/page are GET and already cheap).

### [SEC-04] The Browser proxy strips the dev server's CSP and X-Frame-Options from every page

- **Evidence**: `engine/src/proxy.ts:424-427` — `delete headers["x-frame-options"]; delete headers["content-security-policy"]; delete headers["content-security-policy-report-only"]` on every proxied response. SECURITY_MODEL.md's proxy bullet (line 37) documents only Host/Origin checks, not header stripping.
- **Impact**: A local dev server's own XSS mitigations (CSP) are removed inside Liner's Browser surface, so injected script in a proxied page runs with fewer defenses than the same page in a normal browser; the probe script the proxy adds also runs in that weakened context. Framing needs the strip (the page is iframed), but CSP could be kept with frame-ancestors relaxed instead of dropped wholesale. (Browser iframe sandbox posture in the UI still being verified — impact may grow if the frame is unsandboxed.)
- **Effort**: M — preserve CSP while allowing framing (rewrite frame-ancestors/x-frame-options only), keep the probe working under the page's own policy, pin with a proxy test.
- **Risk**: MED — dev servers' varied CSPs could break the probe or the page inside the app; needs real-server checks.
- **Confidence**: MED (strip is certain; net impact depends on the UI frame's sandbox, verification in progress).
- **Fix sketch**: Strip only framing directives, pass the rest of the dev server's CSP through, and document the choice in SECURITY_MODEL.md either way.

### [SEC-05] mcp.ts still accepts the session key from the environment (dead plan-004 fallback)

- **Evidence**: `engine/src/mcp.ts:15` — `if (process.env.LINER_SURFACE_KEY) return process.env.LINER_SURFACE_KEY;` before the key-file read. Grep of engine/ui/desktop/contracts shows no remaining setter of `LINER_SURFACE_KEY` (only `LINER_SURFACE_KEY_FILE` is set, `engine/src/agent-tools.ts:329`).
- **Impact**: The env path plan 004 removed is still honored: any future code (or a user's wrapper) that sets the variable puts the session key back into `ps eww` reach silently, with no test to catch the regression. Today it is dead code, so exposure is latent, not live.
- **Effort**: S — delete the env fallback, add a test that the MCP server reads only the key file.
- **Risk**: LOW — nothing sets the variable.
- **Confidence**: HIGH.
- **Fix sketch**: Remove the fallback and pin file-only key reading in a test.

### [SEC-06] The DSH sandbox denies reading secrets but not hard-linking them; some credential paths are unlisted

- **Evidence**: `engine/src/dsh-hosts.ts:342-365` — the secret denylist is `file-read-data` only; the `file-link` deny at `dsh-hosts.ts:357` applies only to the KEPT user folders, and `(allow default)` (line 349) leaves `file-link` on secret paths allowed. A hard link made inside the plugin's own folder (read-allowed, line 367) would be read by its new path if XNU's `link()` permits linking a file the caller cannot read. The list also misses some agent credential stores (e.g. `~/.aider.conf.yml`, `~/.continue`, `~/.codeium`, `~/.tabnine`), while covering `.claude`, `.codex`, `.hermes`, `.local/share`, keychains.
- **Impact**: If the hard-link path works, a sandboxed plugin reads SSH/AWS keys the profile explicitly means to keep from it — a concrete escape beyond the owner-decided allow-everything posture. The unlisted stores are readable regardless (posture), but they are the same class of asset the list exists to protect.
- **Effort**: S — add `(deny file-link ${sub(secret)})` and extend the list; verify the hard-link behavior on a real Mac first (investigate plan, not blind fix).
- **Risk**: LOW — deny rules only narrow the plugin.
- **Confidence**: LOW (SBPL semantics and XNU link() permission need a real-machine check; read-only audit could not run sandbox-exec).
- **Fix sketch**: Probe hard-link-then-read under the profile on a real Mac; deny file-link on secrets either way, and add the missing credential paths.

### [SEC-07] liner:boot IPC answers any sender, unlike the guarded liner channel

- **Evidence**: `desktop/src/main.ts:380-383` — `ipcMain.on("liner:boot", (e) => { e.returnValue = { ...boot, ... } })` with no sender/frame check; `boot` holds the engine token (`desktop/src/main.ts:77,1064`). Contrast `desktop/src/main.ts:387`, which checks sender, main frame and origin for the "liner" channel.
- **Impact**: Today only the main frame gets the preload (sandbox on, nodeIntegrationInSubFrames off), so no other frame can call it — but the token-bearing boot reply is one preload-in-subframes change away from being readable by any embedded page (Browser surface, panels). Defense-in-depth inconsistency in the shell's most sensitive reply.
- **Effort**: S — apply the same sender/main-frame/origin guard as the "liner" handler; test that a subframe sender is refused.
- **Risk**: LOW — the legitimate caller is exactly the main frame.
- **Confidence**: HIGH (code fact; latent, not currently exploitable).
- **Fix sketch**: Guard liner:boot identically to liner.

### [SEC-08] The non-git file walk follows symlinked directories, listing names outside the project

- **Evidence**: `engine/src/files.ts:32-36` — fallback walk uses `statSync` (follows links) and recurses into symlinked directories; `engine/src/panels.ts:131-133` (files.list) returns those names to a panel. Reads stay guarded (`panels.ts:68-81` realpath checks), and the git path (`git ls-files`) does not follow links.
- **Impact**: In a non-git session folder, a panel with access.files can enumerate file names outside the project through a symlinked directory (e.g. one a cloned repository brings). Names only — content reads are still refused — so this is a small leak across the panel's stated "this project's files" boundary.
- **Effort**: S — lstat in the walk and skip symlinked directories (or list the link itself); test with a symlinked dir.
- **Risk**: LOW — listing only.
- **Confidence**: HIGH.
- **Fix sketch**: Use lstatSync in the walk fallback and don't recurse through links.