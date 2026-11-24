/*
  Liner Security: where the Findings page gets its findings and how it acts on one (dismiss, reopen, fix, ask about it).
  From the engine (security.findings.list and friends), asked again whenever findings change. In the dev build with
  ?ls-mock in the URL they come instead from board B's sample, in memory (findings-mock.ts, loaded on demand), and the
  actions change that copy, so the page can be built and checked before the Demo's data exists. Production never mocks.
*/
import { useEffect, useSyncExternalStore } from "react";
import type { DismissReason, SecurityFinding, Thread } from "@contracts";
import { rpc } from "../engine";
import { useSecurity } from "./store";

/** Dev only: ?ls-mock in the URL. */
export const MOCK = import.meta.env.DEV && typeof location !== "undefined" && new URLSearchParams(location.search).has("ls-mock");

let mock: SecurityFinding[] | null = null;
let mockLoading = false;
const mockListeners = new Set<() => void>();
const mockSet = (next: SecurityFinding[]) => ((mock = next), mockListeners.forEach((l) => l()));
function mockLoad(projectId: string) {
  if (mock || mockLoading || !MOCK) return;
  mockLoading = true;
  void import("./findings-mock").then((m) => mockSet(m.mockFindings(projectId)));
}
function mockPatch(id: string, fn: (f: SecurityFinding) => SecurityFinding): SecurityFinding {
  const f = (mock ?? []).find((x) => x.id === id);
  if (!f) throw new Error("That finding is gone.");
  const next = fn(f);
  mockSet((mock ?? []).map((x) => (x.id === id ? next : x)));
  return next;
}

/**
  Every finding of one project (or all), whatever its state, worst first as the engine keeps them: the page counts the
  tabs and narrows the list itself. `mockProject`: the project the dev sample is put in.
*/
export function useFindings(projectId: string | undefined, mockProject: string): { list: SecurityFinding[] | null; error: string | null } {
  const live = useSecurity("security.findings.list", projectId ? { projectId } : {}, ["findings"]);
  const sample = useSyncExternalStore(
    (fn) => (mockListeners.add(fn), () => void mockListeners.delete(fn)),
    () => mock,
  );
  useEffect(() => mockLoad(mockProject), [mockProject]);
  if (!MOCK) return { list: live.data, error: live.data ? null : live.error };
  return { list: sample ? sample.filter((f) => !projectId || f.projectId === projectId) : null, error: null };
}

/** What can be done to a finding from its panel. Each resolves with the finding as it is now (or the new session). */
export const act = {
  dismiss: async (id: string, reason: DismissReason, note?: string): Promise<SecurityFinding> =>
    MOCK ? mockPatch(id, (f) => ({ ...f, state: "dismissed", dismissed: { reason, note, at: Date.now() }, activity: [...f.activity, { at: Date.now(), kind: "dismissed", text: `Dismissed${note ? `: ${note}` : ""}`, by: "you" }] })) : rpc("security.finding.dismiss", { id, reason, note }),
  reopen: async (id: string): Promise<SecurityFinding> =>
    MOCK ? mockPatch(id, (f) => ({ ...f, state: "open", dismissed: undefined, fix: undefined, activity: [...f.activity, { at: Date.now(), kind: "reopened", text: "Opened again", by: "you" }] })) : rpc("security.finding.reopen", { id }),
  note: async (id: string, text: string): Promise<SecurityFinding> =>
    MOCK ? mockPatch(id, (f) => ({ ...f, activity: [...f.activity, { at: Date.now(), kind: "note", text, by: "you" }] })) : rpc("security.finding.note", { id, text }),
  look: async (id: string): Promise<SecurityFinding> =>
    MOCK ? mockPatch(id, (f) => ({ ...f, look: { state: "confirmed", by: "mock", words: "Confirmed in mock mode.", at: Date.now() }, activity: [...f.activity, { at: Date.now(), kind: "looked", text: "Confirmed by a second look", by: "mock" }] })) : rpc("security.finding.look", { id }),
  /** Starts a session in its own worktree with the finding as its brief. The mock marks it being fixed and makes no session (null). */
  fix: async (id: string): Promise<Thread | null> => {
    if (!MOCK) return rpc("security.finding.fix", { id });
    mockPatch(id, (f) => ({ ...f, fix: { threadId: "thread-mock-fix-new", state: "working", at: Date.now() }, activity: [...f.activity, { at: Date.now(), kind: "fix-started", text: "A fix started in its own worktree", by: "you" }] }));
    return null;
  },
  /** Opens a session with the finding as its context, to ask about it. The mock makes none (null). */
  ask: async (id: string): Promise<Thread | null> => (MOCK ? null : rpc("security.finding.ask", { id })),
};
