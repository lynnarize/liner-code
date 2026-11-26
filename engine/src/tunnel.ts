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
import type { McpReach } from "../../contracts/src/mcp.ts";

export type TunnelState = { state: "off" | "starting" | "up" | "down"; url?: string; note?: string };
export type TunnelDeps = {
  /** The tool's path, or null when it isn't on this computer. */
  which: (name: "tailscale" | "cloudflared") => Promise<string | null>;
  /** Runs a command to its end. */
  run: (cmd: string, args: string[], timeoutMs: number) => Promise<{ code: number; stdout: string; stderr: string }>;
  /** Starts a command that keeps running (cloudflared). */
  spawn: (cmd: string, args: string[]) => Pick<ChildProcess, "stdout" | "stderr" | "kill" | "once">;
  /** The system it runs on, for the words a missing tool is told in (process.platform when not given). */
  platform?: NodeJS.Platform;
};

/** The Mac App Store's and the standalone app's CLI, when `tailscale` isn't on the PATH. */
const TAILSCALE_APP = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
/** The quick tunnel's own address, never cloudflared's API (api.trycloudflare.com), which its error lines name. */
const TRYCLOUDFLARE = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/;

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
        const p = nodeSpawn(cmd, args, { env, stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs });
        let stdout = "";
        let stderr = "";
        p.stdout.on("data", (d: Buffer) => void (stdout.length < 1e6 && (stdout += String(d))));
        p.stderr.on("data", (d: Buffer) => void (stderr.length < 1e6 && (stderr += String(d))));
        p.on("error", (e) => resolve({ code: -1, stdout, stderr: stderr || e.message }));
        p.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
      }),
    spawn: (cmd, args) => nodeSpawn(cmd, args, { env, stdio: ["ignore", "pipe", "pipe"] }),
  };
}

const firstLine = (s: string) => s.split("\n").map((l) => l.trim()).find(Boolean)?.slice(0, 300) ?? "";

export class Tunnel {
  private deps: TunnelDeps;
  /** Told whenever the state changes, for Settings. */
  onChange: () => void = () => {};
  now: TunnelState = { state: "off" };
  kind: McpReach = "off";
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
    if (kind === "off") return this.set({ state: "off" });
    if (kind === "own") {
      const u = ownAddress(own);
      return this.set(u ? { state: "up", url: mcpUrl(u.origin) } : { state: "down", note: `Type the https address that already forwards to ${here(this.deps.platform)}.` });
    }
    this.set({ state: "starting" });
    if (kind === "tailscale") return this.startTailscale(gen, port);
    return this.startCloudflare(gen, port);
  }

  private async startTailscale(gen: number, port: number) {
    const bin = await this.deps.which("tailscale");
    if (!bin) return this.set({ state: "down", note: `Tailscale isn't on ${here(this.deps.platform)}. Install it from tailscale.com and sign in.` });
    const status = await this.deps.run(bin, ["status", "--json"], 10_000);
    let dns = "";
    try {
      const s = JSON.parse(status.stdout) as { BackendState?: string; Self?: { DNSName?: string } };
      if (s.BackendState === "Running") dns = String(s.Self?.DNSName ?? "").replace(/\.$/, "");
    } catch {
      // Not JSON: it isn't running.
    }
    if (gen !== this.gen) return;
    if (!dns) return this.set({ state: "down", note: `Tailscale isn't running or signed in on ${here(this.deps.platform)}.` });
    // Funnel serving something of yours already: left as it is, and said.
    const serving = await this.deps.run(bin, ["funnel", "status", "--json"], 10_000);
    try {
      const web = (JSON.parse(serving.stdout || "{}") as { Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }> }).Web ?? {};
      const ours = new Set([`http://127.0.0.1:${port}`, `127.0.0.1:${port}`, `http://localhost:${port}`, String(port)]);
      const other = Object.entries(web).some(([at, w]) => at.endsWith(":443") && Object.values(w.Handlers ?? {}).some((h) => !ours.has(String(h.Proxy ?? ""))));
      if (other) return this.set({ state: "down", note: `Tailscale Funnel already serves something else on ${here(this.deps.platform)}, so Liner leaves it alone. Pick Cloudflare or your own address.` });
    } catch {
      // Nothing served, or an older Tailscale that says it another way: go on.
    }
    if (gen !== this.gen) return;
    const r = await this.deps.run(bin, ["funnel", "--bg", String(port)], 30_000);
    if (gen !== this.gen) return;
    if (r.code !== 0) return this.set({ state: "down", note: firstLine(r.stderr) || firstLine(r.stdout) || "Tailscale Funnel didn't start." });
    this.tailscale = bin;
    const version = firstLine((await this.deps.run(bin, ["version"], 5000)).stdout);
    if (gen !== this.gen) return;
    this.set({ state: "up", url: mcpUrl(`https://${dns}`), note: version ? `Up, through Tailscale ${version}` : "Up, through Tailscale" });
  }

  private async startCloudflare(gen: number, port: number) {
    const bin = await this.deps.which("cloudflared");
    if (gen !== this.gen) return;
    if (!bin) return this.set({ state: "down", note: `cloudflared isn't on ${here(this.deps.platform)}. Install it (${onWindows(this.deps.platform) ? "winget install --id Cloudflare.cloudflared" : "brew install cloudflared"}).` });
    let child: ReturnType<TunnelDeps["spawn"]>;
    try {
      child = this.deps.spawn(bin, ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`]);
    } catch (e) {
      return this.set({ state: "down", note: `cloudflared didn't start: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300) });
    }
    this.child = child;
    let t: NodeJS.Timeout | undefined;
    // A binary that can't run (gone, not executable) says so here, not as a crash of the engine.
    child.once("error", (e: Error) => {
      clearTimeout(t);
      if (this.child === child) this.child = null;
      if (gen === this.gen) this.set({ state: "down", note: `cloudflared didn't start: ${e.message}`.slice(0, 300) });
    });
    let found = false;
    const read = (d: Buffer) => {
      const m = TRYCLOUDFLARE.exec(String(d));
      if (m && !found && gen === this.gen) {
        found = true;
        this.set({ state: "up", url: mcpUrl(m[0]), note: "Up, through Cloudflare. The address is new each time Liner starts it." });
      }
    };
    child.stdout?.on("data", read);
    child.stderr?.on("data", read);
    child.once("exit", () => {
      // It ended on its own: that's the reason shown, not the wait for an address running out after it.
      clearTimeout(t);
      if (this.child === child) this.child = null;
      if (gen === this.gen) this.set({ state: "down", note: "The Cloudflare tunnel ended." });
    });
    t = setTimeout(() => {
      if (!found && gen === this.gen) {
        this.set({ state: "down", note: "Cloudflare didn't give an address within 30 seconds." });
        child.kill();
      }
    }, 30_000);
    t.unref?.();
  }

  /**
    Takes down what Liner started: Funnel's :443 handler, or the cloudflared process. Resolves with the generation it set,
    so a start that waited on it can tell whether anything was asked since.
  */
  async stop() {
    const gen = ++this.gen;
    const child = this.child;
    this.child = null;
    child?.kill();
    const bin = this.tailscale;
    this.tailscale = null;
    if (bin) await this.deps.run(bin, ["funnel", "--https=443", "off"], 10_000).catch(() => null);
    // A start asked while Funnel came down has its own state by now: that one stays.
    if (gen === this.gen && this.now.state !== "off") this.set({ state: "off" });
    return gen;
  }
}
