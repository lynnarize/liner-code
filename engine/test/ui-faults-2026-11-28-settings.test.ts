/*
  Faults found on 2026-11-28, in the review before 0.3.3, in Settings and the pages beside it (Pull requests, Issues and
  their Liner Security chips). A store that imports the app's aliases is bundled with esbuild here, each alias stood in
  for, so it runs as written. Run with `node --test engine/test/ui-faults-2026-11-28-settings.test.ts`.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const ui = fileURLToPath(new URL("../../ui/src/app/", import.meta.url));

/** The chips' store (security/target-store.ts), with React, the engine and the toast stood in for by `globalThis.__stub`. */
async function loadTargetStore() {
  const out = await build({
    entryPoints: [`${ui}security/target-store.ts`],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    logLevel: "error",
    plugins: [
      {
        name: "stubs",
        setup(b) {
          const stub = (path: string, body: string) => b.onResolve({ filter: new RegExp(`^${path.replace(/[./@]/g, "\\$&")}$`) }, () => ({ path, namespace: "stub", pluginData: body }));
          stub("react", "export const useEffect = (f) => globalThis.__stub.effect(f); export const useSyncExternalStore = () => 0;");
          stub("@contracts", "export const targetKey = (t) => (t.kind === 'pr' ? `pr:${t.projectId}:${t.number}` : `issue:${t.projectId}:${t.key}`);");
          stub("../engine", "export const onStream = (f) => globalThis.__stub.stream.push(f); export const rpc = (m, a) => globalThis.__stub.rpc(m, a);");
          stub("@liner/components/toast/toast", "export const toast = { error() {} };");
          b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({ contents: a.pluginData as string, loader: "js" }));
        },
      },
    ],
  });
  return (await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`)) as { useScanSummary: (target: { kind: "pr"; projectId: string; number: number }) => { state: string } | null | undefined };
}

test("A pull request's scan chip, back on screen after its scan finished elsewhere, no longer says Scanning", async () => {
  const cleanups: (() => void)[] = [];
  const asked: unknown[] = [];
  let answer: Record<string, unknown> = {};
  const g = globalThis as Record<string, unknown>;
  g.window = globalThis;
  g.sessionStorage = { getItem: () => null, setItem() {} };
  g.__stub = {
    stream: [] as ((e: unknown) => void)[],
    effect: (f: () => void | (() => void)) => void cleanups.push(f() || (() => {})),
    rpc: async (m: string, a: unknown) => (asked.push([m, a]), m === "security.targetStatus" ? answer : {}),
  };
  const stub = g.__stub as { stream: ((e: unknown) => void)[] };
  const settle = () => new Promise((r) => setTimeout(r, 300));
  const store = await loadTargetStore();
  const target = { kind: "pr", projectId: "p1", number: 131 } as const;
  const key = "pr:p1:131";
  const running = { scanId: "s1", threadId: "t1", state: "running", high: 0, medium: 0, low: 0, at: 1 };

  // On the Pull requests page: the chip asks, and the scan is running.
  answer = { [key]: running };
  assert.equal(store.useScanSummary(target), undefined);
  await settle();
  assert.equal(store.useScanSummary(target)?.state, "running");
  // The page goes (a session opened): the chip unmounts.
  for (const c of cleanups.splice(0)) c();
  // The scan finishes while no chip shows it.
  const record = { id: "s1", threadId: "t1", state: "done", target, startedAt: 1, finishedAt: 2, auto: false, counts: { bySeverity: { critical: 0, high: 0, medium: 0, low: 0 } } };
  answer = { [key]: { ...running, state: "done", at: 2 } };
  for (const f of stub.stream) f({ type: "security.scan", scan: record });
  await settle();
  // Back on the page: the chip mounts again.
  store.useScanSummary(target);
  await settle();
  assert.equal(store.useScanSummary(target)?.state, "done", "the chip says Scanning for a scan that ended while the page was away");
});

test("A linked pull request opened from an issue shows even when it is no longer open, rather than its detail closing at once", async () => {
  const logic = (await import("../../ui/src/app/worklists-logic.ts")) as Record<string, unknown>;
  const missing = logic.missingPick as ((open: string | null, pick: string | undefined, shown: string, found: boolean) => "keep" | "all" | "close") | undefined;
  assert.equal(typeof missing, "function", "the Pull requests page closes a picked pull request that the open list doesn't hold");
  // Asked for from an issue's Linked line: #42 was merged, so the open list hasn't it. The page looks in every state.
  assert.equal(missing!("p1#42", "p1#42", "open", false), "all");
  // Not in every state either (gone from the host): then it closes.
  assert.equal(missing!("p1#42", "p1#42", "all", false), "close");
  // A row opened by hand that a search or another state hides closes, as before; one in the list stays.
  assert.equal(missing!("p1#7", "p1#42", "open", false), "close");
  assert.equal(missing!("p1#7", undefined, "merged", false), "close");
  assert.equal(missing!("p1#42", "p1#42", "open", true), "keep");
  assert.equal(missing!(null, "p1#42", "open", false), "keep");
  const page = (await import("node:fs")).readFileSync(new URL("../../ui/src/app/PullRequests.tsx", import.meta.url), "utf8");
  assert.match(page, /missingPick\(open, pick, shown, Boolean\(picked\)\)/, "the page doesn't ask what to do with a pick it can't find");
});
