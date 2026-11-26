/*
  Tell an app (Settings › Liner MCP): when a session starts waiting on you, one line goes to an https address you set, such
  as a Grok Bot routine's webhook, so it can reach you on your phone. It says that a session needs you and the session's
  title, and nothing else: no code, no message, no answer. The optional secret goes as a bearer token from the keychain
  (keys.set "mcp.webhook"). A post that fails is tried twice more, then dropped quietly. Like a picture's link (pictures.ts),
  it never goes to this computer or a private network, by its address or by what its name looks up to as it's sent, so the
  secret and the post can't be pointed at a service on this computer or the local network.
*/
import type { EngineEvent, Thread } from "../../contracts/src/index.ts";
import { LOOPBACK, addressesOf, normalIp, privateIp } from "./ip.ts";

/** This computer or a private network by how the host is written: an address there, localhost or a name under it. */
const nearby = (host: string) => {
  const h = normalIp(host).replace(/\.$/, "");
  return LOOPBACK(h) || privateIp(h) || h.endsWith(".localhost");
};

/** An address Liner may post to: https only, with no user or password in it, and not this computer or a private network. */
export function webhookOk(raw: unknown): URL | null {
  if (typeof raw !== "string" || raw.length > 2000) return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" && u.hostname && !u.username && !u.password && !nearby(u.hostname) ? u : null;
  } catch {
    return null;
  }
}

export type WebhookOptions = {
  url: () => string | undefined;
  secret: () => string | undefined;
  fetch?: typeof fetch;
  /** Waits before the second and third tries. */
  delays?: number[];
  log?: (line: string) => void;
  /** What the host leads to as it's sent (ip.ts addressesOf); tests give their own. */
  lookup?: (host: string) => Promise<string[]>;
};

export class Webhook {
  private o: WebhookOptions;
  /** What each session was last, so only a session that starts waiting is told, once per wait. */
  private was = new Map<string, Thread["status"]>();

  constructor(o: WebhookOptions) {
    this.o = o;
  }

  /** Read every thread event: a session that turns to waiting is told about. */
  hear(e: EngineEvent) {
    if (e.type === "thread.removed") return void this.was.delete(e.id);
    if (e.type !== "thread") return;
    const t = e.thread;
    const before = this.was.get(t.id);
    this.was.set(t.id, t.status);
    if (t.status === "waiting" && before !== undefined && before !== "waiting" && !t.sideOf) void this.tell(t.title || "A session");
  }

  /** Posts the one line, trying twice more if it fails. Resolves true once it went. */
  async tell(title: string): Promise<boolean> {
    const u = webhookOk(this.o.url());
    if (!u) return false;
    const secret = this.o.secret();
    const go = this.o.fetch ?? fetch;
    const delays = this.o.delays ?? [2000, 10_000];
    const body = JSON.stringify({ event: "needs_you", session: title.slice(0, 200), app: "Liner Code" });
    const say = this.o.log ?? ((l: string) => console.error(l));
    for (let i = 0; i <= delays.length; i++) {
      if (i) await new Promise((r) => setTimeout(r, delays[i - 1]));
      try {
        // Looked up at each try, as pictures.ts does: a name that leads into a private network is refused at once.
        const ips = await (this.o.lookup ?? addressesOf)(u.hostname);
        if (ips.some(privateIp)) return (say(`[mcp] Tell an app: ${u.host} leads to this computer or a private network, so nothing was sent`), false);
        if (!ips.length) throw new Error("not found");
        const r = await go(u.toString(), { method: "POST", headers: { "content-type": "application/json", ...(secret ? { authorization: `Bearer ${secret}` } : {}) }, body, redirect: "error", signal: AbortSignal.timeout(10_000) });
        if (r.ok) return true;
      } catch {
        // Unreachable or slow: tried again below.
      }
    }
    say(`[mcp] Tell an app: ${u.host} didn't take it after three tries`);
    return false;
  }
}
