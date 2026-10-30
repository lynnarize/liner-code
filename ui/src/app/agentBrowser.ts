/*
  An agent using a session's Browser. The engine asks (an agent.browser event); the session's
  Browser surface answers when it's on screen. When it isn't, the session opens it, if the
  session itself is open; otherwise the app keeps a Browser for it out of sight, where the page's
  scripts run and its console is read just the same (T3 Code keeps a headless browser for this).
  Only with no window at all does the agent hear that the Browser isn't open, and the engine
  reads the page from the server instead.
*/
import { useSyncExternalStore } from "react";
import type { AgentBrowserOp } from "@contracts";
import { onStream, rpc } from "./engine";

type Handler = (op: AgentBrowserOp, args: Record<string, unknown>) => Promise<unknown>;
/** Each session's Browsers that can answer, the newest last: the one on screen over the hidden one. */
const handlers = new Map<string, Handler[]>();
const openers = new Map<string, () => void>();
const arrived = new Map<string, Set<() => void>>();

/** A Browser of a session answers for it while it's mounted. */
export function onAgentBrowser(threadId: string, fn: Handler) {
  handlers.set(threadId, [...(handlers.get(threadId) ?? []), fn]);
  for (const f of arrived.get(threadId) ?? []) f();
  return () => {
    const rest = (handlers.get(threadId) ?? []).filter((h) => h !== fn);
    if (rest.length) handlers.set(threadId, rest);
    else handlers.delete(threadId);
  };
}

/** An open session can bring its Browser up when an agent wants it. */
export function onBrowserWanted(threadId: string, open: () => void) {
  openers.set(threadId, open);
  return () => {
    if (openers.get(threadId) === open) openers.delete(threadId);
  };
}

/* ---------- Hidden Browsers, for sessions that aren't on screen ---------- */

/** Sessions an agent drives out of sight, and when each was last used; one idle for two minutes is let go. */
const hidden = new Map<string, number>();
let shown: string[] = [];
const watchers = new Set<() => void>();
const changed = () => {
  shown = [...hidden.keys()];
  for (const w of watchers) w();
};
const IDLE = 120_000;
setInterval(() => {
  const before = hidden.size;
  for (const [id, at] of hidden) if (Date.now() - at > IDLE) hidden.delete(id);
  if (hidden.size !== before) changed();
}, 30_000);

/** The sessions whose Browser the app keeps out of sight right now. */
export function useHiddenBrowsers() {
  return useSyncExternalStore(
    (f) => (watchers.add(f), () => void watchers.delete(f)),
    () => shown,
  );
}

const top = (threadId: string) => handlers.get(threadId)?.at(-1);

function handlerFor(threadId: string, wait: number) {
  const have = top(threadId);
  if (have) {
    if (hidden.has(threadId)) hidden.set(threadId, Date.now());
    return Promise.resolve(have);
  }
  const open = openers.get(threadId);
  if (open) open();
  else {
    hidden.set(threadId, Date.now());
    changed();
  }
  return new Promise<Handler | undefined>((resolve) => {
    const set = arrived.get(threadId) ?? new Set();
    const done = () => {
      set.delete(done);
      clearTimeout(timer);
      resolve(top(threadId));
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
