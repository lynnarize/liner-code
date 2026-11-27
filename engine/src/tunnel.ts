/*
  Liner MCP from the internet: an https address that reaches the app listener (mcp-http.ts) and nothing else on this Mac.
  Three ways, and none unless you picked it in Settings › Liner MCP › From the internet:
  - Tailscale Funnel: `tailscale funnel --bg <port>` puts this Mac's tailnet name on the internet at :443, forwarding to the
    listener; the address is read from `tailscale status --json`, and `tailscale funnel --https=443 off` takes it down
    when Liner Code quits or you pick another way. If Funnel already serves something else here, it's left alone.
  - Cloudflare quick tunnel: `cloudflared tunnel --url http://127.0.0.1:<port>`, no account; the trycloudflare.com address
    it prints is new each time it starts. It ends with the process.
  - Your own address: an https address you already forward to the port; Liner only uses it as the address apps are given.
  The tools are run here and nowhere else, through `deps`, so tests use fakes and never start a real tunnel.
*/
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { posix, win32 } from "node:path";
import type { McpReach, TunnelCheck } from "../../contracts/src/mcp.ts";

export type TunnelState = { state: "off" | "starting" | "up" | "down"; url?: string; note?: string; link?: string };
/** One try of an address: Liner's own answer came back, or why not. */
export type Probe = { ok: true; ms: number } | { ok: false; reason: "dns" | "timeout" | "refused" | "status" | "other"; status?: number; detail?: string };
export type TunnelDeps = {
  /** The tool's path, or null when it isn't on this computer. */
  which: (name: "tailscale" | "cloudflared") => Promise<string | null>;
  /** Runs a command to its end. */
  run: (cmd: string, args: string[], timeoutMs: number) => Promise<{ code: number; stdout: string; stderr: string }>;
  /** Starts a command that keeps running (cloudflared). */
  spawn: (cmd: string, args: string[]) => Pick<ChildProcess, "stdout" | "stderr" | "kill" | "once">;
  /** The system it runs on, for the words a missing tool is told in (process.platform when not given). */
  platform?: NodeJS.Platform;
  /** Tries an address that's up for Liner's own answer. Without it the address isn't tried and the step isn't listed. */
  probe?: (origin: string) => Promise<Probe>;
};

/** The Mac App Store's and the standalone app's CLI, when `tailscale` isn't on the PATH. */
const TAILSCALE_APP = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
/** The quick tunnel's own address, never cloudflared's API (api.trycloudflare.com), which its error lines name. */
const TRYCLOUDFLARE = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/;
/** A page on Tailscale's admin site that its CLI asks you to visit. */
const TAILSCALE_PAGE = /https:\/\/login\.tailscale\.com\/[^\s"'<>]+/;

type TailscaleSelf = { DNSName?: string; ID?: string; CapMap?: Record<string, unknown> | null; Capabilities?: string[] | null };
/**
  Whether this node is plainly without Funnel: Tailscale needs both the "https" and "funnel" capabilities, given in CapMap
  (or the older Capabilities list). A status that carries neither says nothing, so Funnel is tried as before.
*/
function funnelOff(self: TailscaleSelf) {
  if (!self.CapMap && !self.Capabilities) return false;
  const has = (c: string) => Boolean(self.CapMap && c in self.CapMap) || Boolean(self.Capabilities?.includes(c));
  return !has("https") || !has("funnel");
}

/** An address of your own: https, a host, no user or password; what apps are given is it with /mcp. */
export function ownAddress(raw: string | undefined): URL | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" || !u.hostname || u.username || u.password) return null;
    return u;
  } catch {
    return null;
  }
}
/** The /mcp address under a public origin. */
export const mcpUrl = (origin: string) => `${origin.replace(/\/+$/, "")}/mcp`;

/**
  Where a tool is: on the PATH, or where its app puts it when it isn't. On Windows the PATH is split on ";" (and may be
  spelt "Path"), a folder may be quoted, and the file is the name with PATHEXT's .exe or .com: a .cmd or .bat would need a
  shell to start, which the tunnel doesn't use. `platform` and `exists` are given by tests.
*/
export function findTool(name: "tailscale" | "cloudflared", env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform, exists: (file: string) => boolean = existsSync): string | null {
  const win = platform === "win32";
  const path = win ? win32 : posix;
  const get = (k: string) => env[k] ?? (win ? Object.entries(env).find(([n]) => n.toUpperCase() === k)?.[1] : undefined);
  const said = win ? (get("PATHEXT") || ".COM;.EXE").toLowerCase().split(";").filter((e) => e === ".exe" || e === ".com") : [""];
  const exts = said.length ? said : [".exe"];
  for (const raw of (get("PATH") ?? "").split(path.delimiter)) {
    const dir = win ? raw.replace(/^"|"$/g, "") : raw;
    if (!dir) continue;
    for (const ext of exts) if (exists(path.join(dir, name + ext))) return path.join(dir, name + ext);
  }
  if (name !== "tailscale") return null;
  // Tailscale's Windows installer puts it in Program Files, and adds that to the PATH only for shells started after it.
  const app = win ? path.join(get("ProgramFiles") || "C:\\Program Files", "Tailscale", "tailscale.exe") : platform === "darwin" ? TAILSCALE_APP : null;
  return app && exists(app) ? app : null;
}

/** How this computer is named in what the tunnel says, as the app names it (ui/src/app/os.ts). */
const onWindows = (platform: NodeJS.Platform | undefined) => (platform ?? process.platform) === "win32";
const here = (platform: NodeJS.Platform | undefined) => (onWindows(platform) ? "this PC" : "this Mac");

export function defaultDeps(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): TunnelDeps {
  return {
    platform,
    which: async (name) => findTool(name, env, platform),
    run: (cmd, args, timeoutMs) =>
      new Promise((resolve) => {
        // A tool may be a wrapper script that starts the real one without exec (Tailscale's /usr/local/bin/tailscale on a
        // Mac): killing the script leaves the real one holding the pipes, so "close" never comes. It runs in a group of
        // its own, the whole group is killed when the time is up, and an exit is an end even while a pipe stays open.
        const group = platform !== "win32";
        const p = nodeSpawn(cmd, args, { env, stdio: ["ignore", "pipe", "pipe"], detached: group, windowsHide: true });
        let stdout = "";
        let stderr = "";
        let done = false;
        const end = (code: number, err?: string) => {
          if (done) return;
          done = true;
          clearTimeout(t);
          resolve({ code, stdout, stderr: stderr || err || "" });
        };
        const kill = () => {
          try {
            if (group && p.pid) process.kill(-p.pid, "SIGKILL");
            else p.kill("SIGKILL");
          } catch {
            // Already gone.
          }
        };
        const t = setTimeout(() => (kill(), end(-1)), timeoutMs);
        p.stdout.on("data", (d: Buffer) => void (stdout.length < 1e6 && (stdout += String(d))));
        p.stderr.on("data", (d: Buffer) => void (stderr.length < 1e6 && (stderr += String(d))));
        p.on("error", (e) => end(-1, e.message));
        p.on("close", (code) => end(code ?? -1));
        // What's still in the pipes comes within a moment of the exit; anything left in the group after that is killed.
        p.on("exit", (code) => void setTimeout(() => done || (kill(), end(code ?? -1)), 200).unref?.());
      }),
    spawn: (cmd, args) => nodeSpawn(cmd, args, { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true }),
    probe: (origin) => probeAddress(origin),
  };
}

/**
  Asks the address for what only Liner's listener answers: its protected-resource page, naming the address itself as the
  resource. One request to the person's own tunnel, sent nowhere else. From this computer a tailnet name may be reached over
  the tailnet rather than the internet; it still proves Funnel's handler leads to the listener.
*/
export async function probeAddress(origin: string, timeoutMs = 10_000): Promise<Probe> {
  const t0 = Date.now();
  try {
    const r = await fetch(`${origin}/.well-known/oauth-protected-resource/mcp`, { signal: AbortSignal.timeout(timeoutMs), redirect: "manual", headers: { accept: "application/json" } });
    const body = await r.text().catch(() => "");
    if (r.status !== 200) return { ok: false, reason: "status", status: r.status };
    let resource = "";
    try {
      resource = String((JSON.parse(body) as { resource?: unknown }).resource ?? "");
    } catch {
      // Not JSON: not Liner.
    }
    return resource === mcpUrl(origin) ? { ok: true, ms: Date.now() - t0 } : { ok: false, reason: "other" };
  } catch (e) {
    const err = e as { name?: string; message?: string; cause?: { code?: string } };
    const code = err.cause?.code ?? "";
    if (err.name === "TimeoutError" || err.name === "AbortError") return { ok: false, reason: "timeout" };
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") return { ok: false, reason: "dns" };
    if (code === "ECONNREFUSED" || code === "ECONNRESET") return { ok: false, reason: "refused", detail: code };
    return { ok: false, reason: "other", detail: (code || err.message || "").slice(0, 120) };
  }
}

const firstLine = (s: string) => s.split("\n").map((l) => l.trim()).find(Boolean)?.slice(0, 300) ?? "";
const seconds = (since: number | undefined) => `${((Date.now() - (since ?? Date.now())) / 1000).toFixed(1)} s`;
/** How often an address that's up is tried again, so one that stopped reaching this computer is said without a restart. */
export const RECHECK_MS = 5 * 60_000;

export class Tunnel {
  private deps: TunnelDeps;
  /** Told whenever the state changes, for Settings. */
  onChange: () => void = () => {};
  now: TunnelState = { state: "off" };
  kind: McpReach = "off";
  /** The steps of the latest start, in order, for Settings' check list. Empty while off. */
  checks: TunnelCheck[] = [];
  /** When the latest start began, and when its address was last tried. */
  since?: number;
  checkedAt?: number;
  /** The latest try of the address, for tests and for Check again to wait on. */
  checking: Promise<void> = Promise.resolve();
  /** The wait between tries of an address whose name isn't found yet (a new quick tunnel's takes a few seconds). */
  retryMs = 3000;
  private recheck: NodeJS.Timeout | undefined;
  private child: Pick<ChildProcess, "kill" | "once"> | null = null;
  private tailscale: string | null = null;
  /** Bumped by each start and stop: a start that finishes after a newer one was asked for leaves no tunnel behind. */
  private gen = 0;

  constructor(deps: TunnelDeps) {
    this.deps = deps;
  }

  private set(s: TunnelState) {
    this.now = s;
    this.onChange();
  }

  /** Changes one step of the start `gen`, unless a newer start or a stop came since. */
  private mark(gen: number, id: string, patch: Partial<TunnelCheck>) {
    if (gen !== this.gen) return;
    const c = this.checks.find((x) => x.id === id);
    if (!c) return;
    Object.assign(c, patch, patch.state === "run" ? { at: Date.now() } : {});
    this.onChange();
  }

  /** A step that failed: said on it, with what fixes it, and the tunnel down with the same words. */
  private fail(gen: number, id: string, note: string, more: { why?: string; fix?: string; link?: string; value?: string } = {}) {
    this.mark(gen, id, { state: "bad", why: more.why ?? note, ...(more.fix ? { fix: more.fix } : {}), ...(more.link ? { link: more.link } : {}), ...(more.value ? { value: more.value } : {}) });
    if (gen === this.gen) this.set({ state: "down", note, ...(more.link ? { link: more.link } : {}) });
  }

  /** The steps a start of `kind` goes through, all waiting. The address is tried only where there's a way to try it. */
  private plan(kind: McpReach, port: number): TunnelCheck[] {
    const at = here(this.deps.platform);
    const reaches = this.deps.probe ? [{ id: "reaches", label: `The address reaches ${at}` }] : [];
    const steps =
      kind === "tailscale"
        ? [{ id: "tool", label: `Tailscale is on ${at}` }, { id: "signedIn", label: "Running and signed in" }, { id: "funnelOn", label: "HTTPS and Funnel turned on for your tailnet" }, { id: "free", label: "Nothing else served on :443" }, { id: "started", label: `Funnel started on port ${port}` }, ...reaches]
        : kind === "cloudflare"
          ? [{ id: "tool", label: `cloudflared is on ${at}` }, { id: "started", label: "Started, and gave an address" }, ...reaches]
          : kind === "own"
            ? [{ id: "address", label: "An https address of your own" }, ...reaches]
            : [];
    return steps.map((s) => ({ ...s, state: "wait" as const }));
  }

  /** The host apps reach the listener by while it's up, for the listener's Host check. */
  get host(): string | null {
    if (this.now.state !== "up" || !this.now.url) return null;
    try {
      return new URL(this.now.url).host.toLowerCase();
    } catch {
      return null;
    }
  }

  async found() {
    const [t, c] = await Promise.all([this.deps.which("tailscale"), this.deps.which("cloudflared")]);
    return { tailscale: Boolean(t), cloudflared: Boolean(c) };
  }

  /** Brings up the way you picked, to the listener's port; whatever ran before is taken down first. */
  async start(kind: McpReach, port: number, own?: string) {
    // A stop or another start while the old one comes down (Funnel's off can take seconds) is the newer ask: this one goes.
    if ((await this.stop()) !== this.gen) return;
    const gen = ++this.gen;
    this.kind = kind;
    this.checks = this.plan(kind, port);
    this.since = Date.now();
    this.checkedAt = undefined;
    if (kind === "off") return this.set({ state: "off" });
    if (kind === "own") {
      const u = ownAddress(own);
      if (!u) return this.fail(gen, "address", `Type the https address that already forwards to ${here(this.deps.platform)}.`);
      this.mark(gen, "address", { state: "ok", value: u.host });
      this.set({ state: "up", url: mcpUrl(u.origin) });
      return this.reachable(gen);
    }
    this.set({ state: "starting" });
    if (kind === "tailscale") return this.startTailscale(gen, port);
    return this.startCloudflare(gen, port);
  }

  private async startTailscale(gen: number, port: number) {
    this.mark(gen, "tool", { state: "run" });
    const bin = await this.deps.which("tailscale");
    if (gen !== this.gen) return;
    if (!bin) return this.fail(gen, "tool", `Tailscale isn't on ${here(this.deps.platform)}. Install it from tailscale.com and sign in.`, { link: "https://tailscale.com/download" });
    const version = firstLine((await this.deps.run(bin, ["version"], 5000)).stdout);
    this.mark(gen, "tool", { state: "ok", ...(version ? { value: version } : {}) });
    this.mark(gen, "signedIn", { state: "run" });
    const status = await this.deps.run(bin, ["status", "--json"], 10_000);
    let dns = "";
    let self: TailscaleSelf | undefined;
    try {
      const s = JSON.parse(status.stdout) as { BackendState?: string; Self?: TailscaleSelf };
      if (s.BackendState === "Running") {
        dns = String(s.Self?.DNSName ?? "").replace(/\.$/, "");
        self = s.Self;
      }
    } catch {
      // Not JSON: it isn't running.
    }
    if (gen !== this.gen) return;
    if (!dns) return this.fail(gen, "signedIn", `Tailscale isn't running or signed in on ${here(this.deps.platform)}.`, { why: `Tailscale isn't running or signed in on ${here(this.deps.platform)}. Open it and sign in, then Try again.` });
    this.mark(gen, "signedIn", { state: "ok", value: dns });
    // Without Funnel turned on for the tailnet, `funnel --bg` prints a page to turn it on and waits for it with no end, so
    // that page is given here instead and Funnel isn't started.
    if (self && funnelOff(self)) {
      const link = /^[A-Za-z0-9]+$/.test(self.ID ?? "") ? `https://login.tailscale.com/f/funnel?node=${self.ID}` : "https://login.tailscale.com/admin/acls";
      return this.fail(gen, "funnelOn", "Funnel isn't turned on for your tailnet yet. Turn it on in Tailscale, then Try again.", { why: "Your tailnet hasn't turned on HTTPS and Funnel. Tailscale's page turns both on in one step. Only the tailnet's admin can do it. Then come back and press Try again.", link, value: "not yet" });
    }
    this.mark(gen, "funnelOn", { state: "ok" });
    // Funnel serving something of yours already: left as it is, and said.
    this.mark(gen, "free", { state: "run" });
    const serving = await this.deps.run(bin, ["funnel", "status", "--json"], 10_000);
    try {
      const web = (JSON.parse(serving.stdout || "{}") as { Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }> }).Web ?? {};
      const ours = new Set([`http://127.0.0.1:${port}`, `127.0.0.1:${port}`, `http://localhost:${port}`, String(port)]);
      const other = Object.entries(web).some(([at, w]) => at.endsWith(":443") && Object.values(w.Handlers ?? {}).some((h) => !ours.has(String(h.Proxy ?? ""))));
      if (other) return this.fail(gen, "free", `Tailscale Funnel already serves something else on ${here(this.deps.platform)}, so Liner leaves it alone. Pick Cloudflare or your own address.`, { fix: "tailscale funnel status" });
    } catch {
      // Nothing served, or an older Tailscale that says it another way: go on.
    }
    if (gen !== this.gen) return;
    this.mark(gen, "free", { state: "ok" });
    this.mark(gen, "started", { state: "run" });
    const r = await this.deps.run(bin, ["funnel", "--bg", String(port)], 30_000);
    if (gen !== this.gen) {
      // A stop that came while --bg ran found nothing of Liner's to take down, so the Funnel that came up is taken down here,
      // or it would stay public on :443. A newer Tailscale start that is up, or still starting, serves the same port and takes
      // it down itself when it stops.
      if (r.code !== 0 || this.tailscale) return;
      if (this.kind === "tailscale" && this.now.state === "starting") return void (this.tailscale = bin);
      await this.deps.run(bin, ["funnel", "--https=443", "off"], 10_000).catch(() => null);
      return;
    }
    if (r.code !== 0) {
      // A page Tailscale asks you to visit (turning Funnel or HTTPS on) is given as the way out.
      const link = TAILSCALE_PAGE.exec(r.stdout + "\n" + r.stderr)?.[0];
      const said = firstLine(r.stderr) || firstLine(r.stdout);
      const note = said || (r.code === -1 ? "Tailscale Funnel didn't answer within 30 seconds." : "Tailscale Funnel didn't start.");
      return this.fail(gen, "started", note, { ...(link ? { link } : {}), value: seconds(this.checks.find((c) => c.id === "started")?.at) });
    }
    this.tailscale = bin;
    this.mark(gen, "started", { state: "ok", value: seconds(this.checks.find((c) => c.id === "started")?.at) });
    this.set({ state: "up", url: mcpUrl(`https://${dns}`), note: version ? `Up, through Tailscale ${version}` : "Up, through Tailscale" });
    this.reachable(gen);
  }

  private async startCloudflare(gen: number, port: number) {
    this.mark(gen, "tool", { state: "run" });
    const bin = await this.deps.which("cloudflared");
    if (gen !== this.gen) return;
    if (!bin) return this.fail(gen, "tool", `cloudflared isn't on ${here(this.deps.platform)}. Install it (${onWindows(this.deps.platform) ? "winget install --id Cloudflare.cloudflared" : "brew install cloudflared"}).`, { fix: onWindows(this.deps.platform) ? "winget install --id Cloudflare.cloudflared" : "brew install cloudflared" });
    const version = /version (\S+)/.exec((await this.deps.run(bin, ["--version"], 5000)).stdout)?.[1];
    if (gen !== this.gen) return;
    this.mark(gen, "tool", { state: "ok", ...(version ? { value: version } : {}) });
    this.mark(gen, "started", { state: "run" });
    let child: ReturnType<TunnelDeps["spawn"]>;
    try {
      child = this.deps.spawn(bin, ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`]);
    } catch (e) {
      return this.fail(gen, "started", `cloudflared didn't start: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
    }
    this.child = child;
    let t: NodeJS.Timeout | undefined;
    // A binary that can't run (gone, not executable) says so here, not as a crash of the engine.
    child.once("error", (e: Error) => {
      clearTimeout(t);
      if (this.child === child) this.child = null;
      this.fail(gen, "started", `cloudflared didn't start: ${e.message}`.slice(0, 300));
    });
    let found = false;
    const read = (d: Buffer) => {
      const m = TRYCLOUDFLARE.exec(String(d));
      if (m && !found && gen === this.gen) {
        found = true;
        this.mark(gen, "started", { state: "ok", value: seconds(this.checks.find((c) => c.id === "started")?.at) });
        this.set({ state: "up", url: mcpUrl(m[0]), note: "Up, through Cloudflare. The address is new each time Liner starts it." });
        this.reachable(gen);
      }
    };
    child.stdout?.on("data", read);
    child.stderr?.on("data", read);
    child.once("exit", () => {
      // It ended on its own: that's the reason shown, not the wait for an address running out after it.
      clearTimeout(t);
      if (this.child === child) this.child = null;
      if (gen !== this.gen) return;
      if (found) this.mark(gen, "reaches", { state: "wait", why: undefined, fix: undefined, value: undefined });
      this.fail(gen, "started", "The Cloudflare tunnel ended.");
    });
    t = setTimeout(() => {
      if (found || gen !== this.gen) return;
      child.kill();
      // A Tailscale exit node sends this computer's traffic elsewhere, and that can block the port cloudflared needs.
      void this.exitNode().then((on) =>
        this.fail(gen, "started", "Cloudflare didn't give an address within 30 seconds.", on ? { why: "Cloudflare didn't give an address within 30 seconds. A Tailscale exit node is on, and it can block the port Cloudflare's tunnel uses (7844). Try again with the exit node off.", fix: "tailscale set --exit-node=" } : {}),
      );
    }, 30_000);
    t.unref?.();
  }

  /** Whether Tailscale sends this computer's traffic through an exit node. */
  private async exitNode() {
    const bin = await this.deps.which("tailscale");
    if (!bin) return false;
    try {
      return Boolean((JSON.parse((await this.deps.run(bin, ["status", "--json"], 5000)).stdout) as { ExitNodeStatus?: unknown }).ExitNodeStatus);
    } catch {
      return false;
    }
  }

  /** Tries the address now and every few minutes while it's up; the latest try is `checking`. */
  private reachable(gen: number) {
    if (!this.deps.probe) return;
    clearInterval(this.recheck);
    this.recheck = setInterval(() => void this.tryAddress(gen), RECHECK_MS);
    this.recheck.unref?.();
    void this.tryAddress(gen);
  }

  /** Check again: the address that's up is tried once more. */
  async checkAgain() {
    if (this.now.state === "up") await this.tryAddress(this.gen);
  }

  private tryAddress(gen: number): Promise<void> {
    const run = async () => {
      const probe = this.deps.probe;
      if (!probe || gen !== this.gen || !this.now.url) return;
      const origin = new URL(this.now.url).origin;
      this.mark(gen, "reaches", { state: "run", why: undefined, fix: undefined, value: undefined });
      let r = await probe(origin);
      // A new quick tunnel's name takes a few seconds to be found everywhere: tried a few times before it's said.
      for (let i = 0; !r.ok && r.reason === "dns" && i < (this.kind === "cloudflare" ? 4 : 1); i++) {
        await new Promise((ok) => setTimeout(ok, this.retryMs));
        if (gen !== this.gen) return;
        r = await probe(origin);
      }
      if (gen !== this.gen) return;
      this.checkedAt = Date.now();
      if (r.ok) return this.mark(gen, "reaches", { state: "ok", value: `${r.ms} ms` });
      const said = this.reason(r);
      this.mark(gen, "reaches", { state: "bad", why: said.why, value: said.value, ...(said.fix ? { fix: said.fix } : {}) });
    };
    this.checking = run();
    return this.checking;
  }

  /** What a failed try of the address says, by the way it failed and the tunnel it went through. */
  private reason(r: Exclude<Probe, { ok: true }>): { why: string; value: string; fix?: string } {
    const via = this.kind === "tailscale" ? "Tailscale" : this.kind === "cloudflare" ? "Cloudflare" : "The address";
    const later = "Liner tries again every 5 minutes.";
    if (r.reason === "dns") return { value: "name not found", why: `The address's name isn't found yet. A new one can take a minute to be found everywhere. ${later}` };
    if (r.reason === "timeout") return { value: "no answer", why: `No answer from the address within 10 seconds. ${later}` };
    if (r.reason === "refused") return { value: "turned away", why: `The address turned the call away before it reached Liner${r.detail ? ` (${r.detail})` : ""}.` };
    if (r.reason === "status" && r.status && [502, 503, 504].includes(r.status)) return { value: String(r.status), why: `${via} answers, but nothing of Liner's is behind it (${r.status}). Liner's listener may have stopped, or the tunnel points at another port.`, ...(this.kind === "tailscale" ? { fix: "tailscale funnel status" } : {}) };
    if (r.reason === "status" && r.status === 530) return { value: "530", why: "Cloudflare has no tunnel for this address any more (530). Try again starts a new one." };
    if (r.reason === "status" && r.status === 403) return { value: "403", why: "Liner turned the call away: it came by a name that isn't the tunnel's (403)." };
    if (r.reason === "status") return { value: String(r.status), why: `The address answers ${r.status}, not as Liner does.` };
    return { value: "not Liner", why: `The address answers, but not as Liner does${r.detail ? ` (${r.detail})` : ""}.` };
  }

  /** Stop, while a tunnel is still starting: it comes down and says so, and stays down until Try again. */
  async halt() {
    const kept = this.checks.map((c) => (c.state === "run" ? { ...c, state: "bad" as const, why: "You stopped it.", value: seconds(c.at) } : c));
    const since = this.since;
    await this.stop();
    this.checks = kept;
    this.since = since;
    this.set({ state: "down", note: "Stopped before it came up." });
  }

  /**
    Takes down what Liner started: Funnel's :443 handler, or the cloudflared process. Resolves with the generation it set,
    so a start that waited on it can tell whether anything was asked since.
  */
  async stop() {
    const gen = ++this.gen;
    clearInterval(this.recheck);
    this.recheck = undefined;
    const child = this.child;
    this.child = null;
    child?.kill();
    const bin = this.tailscale;
    this.tailscale = null;
    if (bin) await this.deps.run(bin, ["funnel", "--https=443", "off"], 10_000).catch(() => null);
    // A start asked while Funnel came down has its own state by now: that one stays.
    if (gen === this.gen) {
      this.checks = [];
      this.since = undefined;
      this.checkedAt = undefined;
      if (this.now.state !== "off") this.set({ state: "off" });
    }
    return gen;
  }
}
