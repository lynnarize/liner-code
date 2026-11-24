/*
  Headless CLI attachment to a running Liner Code engine (inspired by OpenCode's `--attach`).
  Connects to `http://127.0.0.1:${LINER_PORT || 7317}` with `LINER_TOKEN` (or `--token <tok>`),
  streams live SSE `/events` to stdout, and lets operators inspect threads, send prompts, or stop
  active turns directly from a terminal.
*/
import { createInterface } from "node:readline";

export type AttachConfig = { base: string; token: string; threadId?: string };

export function parseAttachArgs(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): AttachConfig {
  let port = Number(env.LINER_PORT) || 7317;
  let host = env.LINER_HOST || "127.0.0.1";
  let token = env.LINER_TOKEN || "";
  let threadId: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((a === "--port" || a === "-p") && argv[i + 1]) port = Number(argv[++i]) || port;
    else if (a === "--host" && argv[i + 1]) host = argv[++i];
    else if ((a === "--token" || a === "-t") && argv[i + 1]) token = argv[++i];
    else if ((a === "--thread" || a === "-s") && argv[i + 1]) threadId = argv[++i];
    else if (/^https?:\/\//i.test(a)) {
      const u = new URL(a);
      host = u.hostname;
      if (u.port) port = Number(u.port);
    }
  }
  return { base: `http://${host}:${port}`, token, threadId };
}

/** The engine takes its token in x-liner-token (server.ts, authed) and nowhere else: a Bearer header is refused like none. */
export const authHeaders = (token: string): Record<string, string> => (token ? { "x-liner-token": token } : {});

export async function rpcCall<T = unknown>(cfg: AttachConfig, method: string, params: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${cfg.base}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(cfg.token) },
    body: JSON.stringify({ method, params }),
  });
  if (res.status === 401) throw new Error("The engine refused the token: pass the one in <LINER_HOME>/dev-token with --token or LINER_TOKEN.");
  const body = (await res.json()) as { ok: boolean; result?: T; error?: string };
  if (!body.ok) throw new Error(body.error || `RPC ${method} failed`);
  return body.result as T;
}

/**
  Splits the engine's /events stream into its events. It is newline-delimited JSON (server.ts writes one event a line,
  application/x-ndjson), not SSE frames: `buf` is what came so far, and what's after the last newline waits for more.
*/
export function eventsIn(buf: string): { events: { type: string; threadId?: string; text?: string; item?: { kind: string; title?: string; text?: string } }[]; rest: string } {
  const lines = buf.split("\n");
  const rest = lines.pop() ?? "";
  const events = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // a line that isn't JSON is skipped
    }
  }
  return { events, rest };
}

async function main() {
  const cfg = parseAttachArgs(process.argv.slice(2));
  let activeThread = cfg.threadId;
  const state = await rpcCall<{ threads: { id: string; title: string; status: string; archived?: boolean }[] }>(cfg, "state.get");
  const live = state.threads.filter((t) => !t.archived);
  if (!activeThread && live[0]) activeThread = live[0].id;
  console.log(`[attach] Connected to ${cfg.base}. Active thread: ${activeThread ?? "(none)"}. Commands: /threads, /use <id>, /stop, /quit`);

  const ac = new AbortController();
  void (async () => {
    try {
      const res = await fetch(`${cfg.base}/events`, {
        headers: authHeaders(cfg.token),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) return void console.error(`[attach] the engine's events refused: ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const { events, rest } = eventsIn(buf + dec.decode(value, { stream: true }));
        buf = rest;
        for (const ev of events) {
          if (activeThread && ev.threadId && ev.threadId !== activeThread) continue;
          if (ev.type === "delta" && ev.text) process.stdout.write(ev.text);
          else if (ev.type === "item" && ev.item?.kind === "tool") console.log(`\n[tool] ${ev.item.title ?? ""}`);
          else if (ev.type === "item" && ev.item?.kind === "notice" && ev.item.text) console.log(`\n[notice] ${ev.item.text}`);
        }
      }
    } catch (e) {
      if (!ac.signal.aborted) console.error("[attach] stream ended:", e instanceof Error ? e.message : String(e));
    }
  })();

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on("line", async (line) => {
    const s = line.trim();
    if (!s) return;
    if (s === "/quit" || s === "/exit") {
      ac.abort();
      rl.close();
      return;
    }
    if (s === "/threads") {
      const st = await rpcCall<{ threads: { id: string; title: string; status: string; archived?: boolean }[] }>(cfg, "state.get");
      for (const t of st.threads.filter((x) => !x.archived).slice(0, 20)) {
        console.log(`${t.id === activeThread ? "*" : " "} ${t.id} [${t.status}] ${t.title}`);
      }
      return;
    }
    if (s.startsWith("/use ")) {
      activeThread = s.slice(5).trim();
      console.log(`[attach] Switched to ${activeThread}`);
      return;
    }
    if (s === "/stop" && activeThread) {
      await rpcCall(cfg, "thread.stop", { id: activeThread });
      console.log(`[attach] Stopped ${activeThread}`);
      return;
    }
    if (!activeThread) {
      console.log("[attach] No active thread. Use /threads and /use <id>.");
      return;
    }
    await rpcCall(cfg, "thread.send", { id: activeThread, text: s });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((e) => {
    console.error("[attach]", e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
