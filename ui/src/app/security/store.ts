/*
  Liner Security's own small store, loaded with the face: which page the main area shows (Overview, Findings, Projects,
  Start a scan, or one scan, fix or question session), the period and project the pages read, and data hooks over the
  engine's security.* methods that ask again whenever the engine says something changed (security.changed), so every
  page stays true without polling. Kept per window, like the face itself (sessionStorage).
*/
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { FindingSource, FindingState, RpcMethod, RpcParams, RpcResult, ScanRecord, SecurityChange } from "@contracts";
import { onStream, rpc } from "../engine";

/** The page the Security face shows. `scan`: a scan, fix or question session (a Thread tagged security), by thread id. */
export type SecurityPage =
  | { kind: "overview" }
  | { kind: "findings"; finding?: string; state?: FindingState; source?: FindingSource; /** Only what one scan found or raised again (its ScanRecord id). */ scan?: string }
  | { kind: "projects"; projectId?: string }
  | { kind: "start"; projectId?: string }
  | { kind: "scan"; threadId: string };

const PAGE_KEY = "liner.security-page";
const KINDS = ["overview", "findings", "projects", "start", "scan"];
let page: SecurityPage = (() => {
  try {
    const v = JSON.parse(sessionStorage.getItem(PAGE_KEY) ?? "null") as SecurityPage | null;
    return v && KINDS.includes(v.kind) && (v.kind !== "scan" || typeof v.threadId === "string") ? v : { kind: "overview" };
  } catch {
    return { kind: "overview" };
  }
})();
const pageListeners = new Set<() => void>();
export const getSecurityPage = () => page;
/** Shows a page of the Security face. */
export function goSecurity(next: SecurityPage) {
  page = next;
  try {
    sessionStorage.setItem(PAGE_KEY, JSON.stringify(next));
  } catch {
    // a window without storage keeps the page until it closes
  }
  for (const l of pageListeners) l();
}
const subscribePage = (fn: () => void) => {
  pageListeners.add(fn);
  return () => void pageListeners.delete(fn);
};
export const useSecurityPage = () => useSyncExternalStore(subscribePage, getSecurityPage);

/** What the pages read across: a period of days (the Overview's "Last 30 days") and one project, or all. */
export type SecurityScope = { days: number; projectId?: string };
let scope: SecurityScope = { days: 30 };
const scopeListeners = new Set<() => void>();
export const getSecurityScope = () => scope;
export function setSecurityScope(next: Partial<SecurityScope>) {
  scope = { ...scope, ...next };
  for (const l of scopeListeners) l();
}
export const useSecurityScope = () =>
  useSyncExternalStore((fn) => {
    scopeListeners.add(fn);
    return () => void scopeListeners.delete(fn);
  }, getSecurityScope);

type SecurityMethod = Extract<RpcMethod, `security.${string}`>;
/** The last answer to each call, by method and params, so a page shows what it had at once while it asks again. */
const cache = new Map<string, unknown>();

/** Every security event the engine sends: what changed (security.changed), and a scan's record as it moves (security.scan). */
export function onSecurity(fn: (e: { type: "security.changed"; what: SecurityChange[]; projectId?: string } | { type: "security.scan"; scan: ScanRecord }) => void) {
  return onStream((e) => {
    if (e.type === "security.changed" || e.type === "security.scan") fn(e);
  });
}

/**
  One security.* call's answer, asked again when its params change and whenever the engine says Security changed (`on`: only
  for those kinds of change; a scan's progress counts as "scans"). `data` is the last answer (null before the first),
  `error` the last failure in words.
*/
export function useSecurity<M extends SecurityMethod>(method: M, params: RpcParams<M>, on?: SecurityChange[]): { data: RpcResult<M> | null; error: string | null; loading: boolean; reload: () => void } {
  const key = `${method} ${JSON.stringify(params)}`;
  // The answer is kept with the key it answers, so a page never shows another project's or period's data while it asks.
  const [got, setGot] = useState<{ key: string; data: RpcResult<M> } | null>(() => (cache.has(key) ? { key, data: cache.get(key) as RpcResult<M> } : null));
  const [error, setError] = useState<{ key: string; text: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const latest = useRef(key);
  latest.current = key;
  useEffect(() => {
    let live = true;
    setLoading(true);
    rpc(method, params).then(
      (r) => {
        cache.set(key, r);
        if (live && latest.current === key) (setGot({ key, data: r }), setError(null), setLoading(false));
      },
      (e: Error) => live && latest.current === key && (setError({ key, text: e.message }), setLoading(false)),
    );
    return () => {
      live = false;
    };
  }, [key, tick]);
  const data = got?.key === key ? got.data : ((cache.get(key) as RpcResult<M> | undefined) ?? null);
  // Asked again at most once in 150 ms: a scan sends an event for each area it reads and each finding it counts.
  useEffect(() => {
    let soon = 0;
    const off = onSecurity((e) => {
      const what: SecurityChange[] = e.type === "security.scan" ? ["scans"] : e.what;
      if ((!on || what.some((w) => on.includes(w))) && !soon) soon = window.setTimeout(() => ((soon = 0), setTick((n) => n + 1)), 150);
    });
    return () => (off(), clearTimeout(soon));
  }, [on?.join(",")]);
  return { data, error: error?.key === key ? error.text : null, loading, reload: () => setTick((n) => n + 1) };
}

/** A scan's record, live: its last security.scan event, else what security.scans.list said. */
export function useScan(id: string | undefined): ScanRecord | null {
  // Asked once, not on each event: the scan's own events (security.scan) carry its record as it moves.
  const { data } = useSecurity("security.scans.list", {}, []);
  const [live, setLive] = useState<ScanRecord | null>(null);
  useEffect(() => onSecurity((e) => e.type === "security.scan" && e.scan.id === id && setLive(e.scan)), [id]);
  if (!id) return null;
  return live?.id === id ? live : (data?.find((s) => s.id === id) ?? null);
}
