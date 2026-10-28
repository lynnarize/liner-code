/*
  An agent using a session's Browser. The engine asks (an agent.browser event); the session's
  Browser surface answers when it's on screen. When it isn't, the session opens it, if the
  session itself is open; otherwise the agent hears that the Browser isn't open, and the engine
  reads the page from the server instead.
*/
import type { AgentBrowserOp } from "@contracts";
import { onStream, rpc } from "./engine";

type Handler = (op: AgentBrowserOp, args: Record<string, unknown>) => Promise<unknown>;
const handlers = new Map<string, Handler>();
const openers = new Map<string, () => void>();
const arrived = new Map<string, Set<() => void>>();

/** The Browser surface of a session answers for it while it's mounted. */
export function onAgentBrowser(threadId: string, fn: Handler) {
  handlers.set(threadId, fn);
  for (const f of arrived.get(threadId) ?? []) f();
  return () => {
    if (handlers.get(threadId) === fn) handlers.delete(threadId);
  };
}

/** An open session can bring its Browser up when an agent wants it. */
export function onBrowserWanted(threadId: string, open: () => void) {
  openers.set(threadId, open);
  return () => {
    if (openers.get(threadId) === open) openers.delete(threadId);
  };
}

function handlerFor(threadId: string, wait: number) {
  const have = handlers.get(threadId);
  if (have) return Promise.resolve(have);
  const open = openers.get(threadId);
  if (!open) return Promise.resolve(undefined);
  open();
  return new Promise<Handler | undefined>((resolve) => {
    const set = arrived.get(threadId) ?? new Set();
    const done = () => {
      set.delete(done);
      clearTimeout(timer);
      resolve(handlers.get(threadId));
    };
    const timer = setTimeout(done, wait);
    set.add(done);
    arrived.set(threadId, set);
  });
}

export function startAgentBrowser() {
  return onStream((e) => {
    if (e.type !== "agent.browser") return;
    void (async () => {
      const h = await handlerFor(e.threadId, 5000);
      if (!h) return void rpc("agent.browser.reply", { id: e.id, ok: false, error: "This session isn't open in Liner Code, so its Browser isn't open either." }).catch(() => {});
      try {
        const value = await h(e.op, e.args);
        await rpc("agent.browser.reply", { id: e.id, ok: true, value });
      } catch (err) {
        await rpc("agent.browser.reply", { id: e.id, ok: false, error: err instanceof Error ? err.message : String(err) }).catch(() => {});
      }
    })();
  });
}
