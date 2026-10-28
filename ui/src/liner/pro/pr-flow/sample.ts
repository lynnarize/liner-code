/*
  A simulated agent that plays the whole story: open the PR, find that main moved on,
  resolve the conflicts, run the checks, merge. Swap it for a real one with the same shape.
*/
import type { PrAgent, PrCheck, PrCommit, PrConflict, PrEvent } from "./pr-flow";

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = window.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });

const BRANCH = "feat/session-refresh";

const mine: PrCommit[] = [
  { id: "c1", title: "Read session expiry from the token", lane: "branch", hash: "1f8e3b", who: "You", when: "40m ago" },
  { id: "c2", title: "Refresh sessions near expiry", lane: "branch", hash: "c78a92", who: "You", when: "25m ago" },
  { id: "c3", title: "Add session refresh tests", lane: "branch", hash: "d29f58", who: "You", when: "4m ago" },
];
// What reached main while the branch was being worked on.
const landed: PrCommit[] = [
  { id: "b1", title: "Rotate session keys", lane: "base", hash: "a3f9c1", who: "Lena", when: "18m ago" },
  { id: "b2", title: "Let health checks skip auth", lane: "base", hash: "5be27d", who: "Omar", when: "6m ago" },
];
const clashes: PrConflict[] = [
  { id: "k1", file: "src/auth.ts", line: 18, base: "verify(token, keys.current())", yours: "verify(token, SECRET, { refresh: true })", commit: "b1" },
  { id: "k2", file: "src/auth.ts", line: 31, base: "if (rotating) return reissue(s)", yours: "if (expiresSoon(s)) return refresh(s)", commit: "b1" },
  { id: "k3", file: "src/middleware.ts", line: 7, base: 'const open = ["/login", "/api/health"]', yours: 'const open = ["/login", "/refresh"]', commit: "b2" },
];
// Each fix keeps both sides.
const fixes: Record<string, string> = {
  k1: "verify(token, keys.current(), { refresh: true })",
  k2: "if (rotating || expiresSoon(s)) return refresh(s)",
  k3: 'const open = ["/login", "/api/health", "/refresh"]',
};
// When each check finishes, in ticks of the run below.
const plan = [
  { id: "lint", label: "Lint", ends: 7, result: "Clean", detail: "eslint · no warnings · 6s" },
  { id: "types", label: "Types", ends: 13, result: "No errors", detail: "tsc --noEmit · no errors · 21s" },
  { id: "tests", label: "Tests", ends: 23, result: "42 passed", detail: "vitest · 42 passed, 0 failed · 38s", of: 42 },
  { id: "preview", label: "Preview", ends: 28, result: "Deployed", detail: "session-refresh.preview.acme.dev · 1m 4s" },
];

export function simulatedPrAgent(): PrAgent {
  let commits: PrCommit[] = [];
  let conflicts: PrConflict[] = [];
  const setCommits = (emit: (e: PrEvent) => void, next: PrCommit[]) => {
    commits = next;
    emit({ type: "commits", commits });
  };
  const patch = (emit: (e: PrEvent) => void, id: string, p: Partial<PrConflict>) => {
    conflicts = conflicts.map((k) => (k.id === id ? { ...k, ...p } : k));
    emit({ type: "conflicts", conflicts });
  };

  return {
    async create(emit, signal) {
      emit({ type: "stage", stage: "creating" });
      emit({ type: "status", text: "Reading the branch" });
      await wait(700, signal);
      emit({ type: "status", text: "Pushing 3 commits" });
      setCommits(emit, mine);
      await wait(1200, signal);
      emit({ type: "status", text: "Opening the pull request" });
      await wait(800, signal);
      emit({ type: "pr", number: 128, url: "https://github.com" });
      emit({ type: "message", text: "Opened #128 with your three commits. Checking it against `main` before anyone reviews it." });
      emit({ type: "stage", stage: "checking" });
      emit({ type: "status", text: "Fetching main" });
      await wait(1000, signal);
      // Main moved on: what landed there arrives on the line below.
      setCommits(emit, [...commits, landed[0]]);
      await wait(360, signal);
      setCommits(emit, [...commits, landed[1]]);
      emit({ type: "status", text: "Checking it merges cleanly" });
      await wait(1100, signal);
      conflicts = clashes;
      emit({ type: "conflicts", conflicts });
      emit({ type: "stage", stage: "conflicts" });
      emit({ type: "status", text: "3 conflicts with main" });
      emit({
        type: "message",
        text: "`main` moved on while I worked: Lena rotated the session keys and Omar let health checks skip auth, on the same lines as yours. I can bring `main` in and keep both sides.",
      });
    },

    async resolve(emit, signal) {
      emit({ type: "stage", stage: "resolving" });
      emit({ type: "status", text: "Merging main into the branch" });
      await wait(500, signal);
      setCommits(emit, [...commits, { id: "mc", title: `Merge main into ${BRANCH}`, lane: "branch", merge: true, hash: "7e0c3b", who: "Agent", when: "just now" }]);
      await wait(900, signal);
      for (let i = 0; i < conflicts.length; i++) {
        const id = conflicts[i].id;
        emit({ type: "status", text: `Resolving ${i + 1} of ${conflicts.length}` });
        patch(emit, id, { active: true });
        await wait(1100, signal);
        patch(emit, id, { active: false, resolved: fixes[id] });
        await wait(380, signal);
      }
      emit({ type: "status", text: "Pushing the merge" });
      await wait(800, signal);
      emit({ type: "stage", stage: "testing" });
      emit({ type: "message", text: "Kept both sides each time: the current key with the refresh, and the health check next to the refresh route. Running the checks." });
      const last = Math.max(...plan.map((p) => p.ends));
      for (let t = 0; t <= last; t++) {
        const checks = plan.map((p): PrCheck => {
          const { id, label } = p;
          if (t === 0) return { id, label, state: "queued" };
          if (t >= p.ends) return { id, label, state: "passed", result: p.result, detail: p.detail };
          if (!p.of) return { id, label, state: "running" };
          return { id, label, state: "running", progress: t / p.ends, result: `${Math.floor((p.of * t) / p.ends)} of ${p.of}` };
        });
        emit({ type: "checks", checks });
        const tests = checks.find((k) => k.id === "tests");
        emit({ type: "status", text: t === 0 ? "Starting the checks" : tests?.state === "running" ? `Running ${tests.result} tests` : t < last ? "Deploying a preview" : "All checks passed" });
        await wait(t === 0 ? 500 : 130, signal);
      }
      emit({ type: "stage", stage: "ready" });
      emit({ type: "status", text: "Ready to merge" });
      emit({ type: "message", text: "All four checks passed. It's ready to go into `main` whenever you are." });
    },

    async merge(emit, signal) {
      emit({ type: "stage", stage: "merging" });
      emit({ type: "status", text: "Merging into main" });
      await wait(1200, signal);
      emit({ type: "stage", stage: "merged" });
      emit({ type: "status", text: "Merged into main" });
      emit({ type: "message", text: "Merged. Sessions now refresh before they expire, signed with the current key." });
    },
  };
}
