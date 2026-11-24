/*
  Liner-native Teamwork & Swarm tests: verifies universal tool gating, active process pooling,
  hibernation to 0 MB RAM, @mention wakeups, auto-post fallback, stateless resume/model swap,
  deterministic stall detection, and isolated git worktree landing.
*/
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { EngineEvent, Item, ProviderId, Settings, Thread } from "../../contracts/src/index.ts";
import { emptyUsage, parseMentions, parseScreenshots, validWorkerName } from "../../contracts/src/index.ts";
import { SWARM_ENV, toolsFor } from "../src/liner-tools.ts";
import { linerCall } from "../src/providers/acp.ts";
import { OpenCodeServerSession, daemonConfigContent, opencodeSessionRules, stripLeadingCd } from "../src/providers/opencode-server.ts";
import { ResumeFailed, type ProviderSession, type ToolUpdate, type TurnSink } from "../src/providers/types.ts";
import { SwarmManager, pickSwarmWorkerModel, swarmCoordinatorDirective, swarmCoordinatorRules, type SwarmHost } from "../src/swarm.ts";

const temps: string[] = [];
function tempDir(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

function git(cwd: string, args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function makeHarness(o: {
  gitRepo?: boolean;
  maxActive?: number;
  hibernateSec?: number;
  onWorkerTurn: (args: {
    name: string;
    model: string;
    cwd: string;
    prompt: string;
    resume?: string;
    sink: TurnSink;
    swarm: SwarmManager;
  }) => Promise<void>;
}) {
  const home = tempDir("liner-swarm-home-");
  const project = tempDir("liner-swarm-proj-");
  if (o.gitRepo) {
    git(project, ["init", "-b", "main"]);
    git(project, ["config", "user.email", "test@liner.local"]);
    git(project, ["config", "user.name", "Liner Test"]);
    writeFileSync(join(project, "README.md"), "# Demo\n");
    git(project, ["add", "."]);
    git(project, ["commit", "-m", "Initial commit"]);
  }
  const thread: Thread = {
    id: "th_swarm_1",
    projectId: "proj_1",
    title: "Swarm test",
    agent: "@claude:claude-opus-5-5",
    status: "idle",
    access: "full",
    turns: 1,
    usage: emptyUsage(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const settings: Settings = {
    onboarded: true,
    claudeBilling: "plan",
    settleDays: 0,
    notify: false,
    guardDestructive: true,
    defaultAccess: "full",
    worktrees: false,
    branchPrefix: "liner/",
    badge: false,
    swarmMaxActive: o.maxActive ?? 2,
    swarmHibernateSec: o.hibernateSec ?? 0,
    swarmWorkspace: "share",
    swarmStallMonitor: true,
    swarmAutoPost: true,
  };
  const events: EngineEvent[] = [];
  const items = new Map<string, Item>();
  const coordWakes: string[] = [];
  let closedSessions = 0;
  let openSessions = 0;
  let maxConcurrentOpen = 0;
  let coordBusy = false;

  let swarm!: SwarmManager;
  const host: SwarmHost = {
    home,
    thread: (id) => {
      if (id !== thread.id) throw new Error(`Unknown thread ${id}`);
      return thread;
    },
    projectPath: () => project,
    settings: () => settings,
    emit: (e) => events.push(e),
    patchThread: (_id, patch) => Object.assign(thread, patch),
    resolveCoordinator: () => ({ provider: "claude", model: "claude-opus-5-5", label: "Opus 5.5", ref: "claude:claude-opus-5-5" }),
    resolveModel: (ref) => {
      const i = ref.indexOf(":");
      const provider = (i < 0 ? ref : ref.slice(0, i)) as ProviderId;
      const model = i < 0 ? "default" : ref.slice(i + 1);
      return { provider, model, label: model, ref: `${provider}:${model}` };
    },
    defaultWorkerModel: () => "opencode:deepseek-v4.1-flash",
    openWorkerSession: ({ member, cwd, resume }) => {
      openSessions++;
      maxConcurrentOpen = Math.max(maxConcurrentOpen, openSessions);
      let closed = false;
      const session: ProviderSession = {
        async turn(prompt, sink) {
          await o.onWorkerTurn({ name: member.name, model: member.model, cwd, prompt, resume, sink, swarm });
        },
        close() {
          if (!closed) {
            closed = true;
            openSessions--;
            closedSessions++;
          }
        },
      };
      return session;
    },
    isCoordinatorBusy: () => coordBusy,
    wakeCoordinator: async (_id, text) => {
      coordWakes.push(text);
    },
    logUsage: () => {},
    approve: async () => ({ allow: true }),
    putItem: (_id, item) => items.set(item.id, item),
    turnOf: () => thread.turns,
  };

  swarm = new SwarmManager(host);
  swarm.enable(thread.id, { enabled: true, maxActive: o.maxActive ?? 2, hibernateSec: o.hibernateSec ?? 0 });
  return {
    home,
    project,
    thread,
    settings,
    swarm,
    events,
    items,
    coordWakes,
    getClosedCount: () => closedSessions,
    getOpenCount: () => openSessions,
    getMaxConcurrentOpen: () => maxConcurrentOpen,
    setCoordBusy: (v: boolean) => {
      coordBusy = v;
    },
  };
}

async function waitFor(fn: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error("Timed out waiting for swarm condition");
}

describe("Liner-native Teamwork and Swarm", () => {
  it("Validates worker names, parses @mentions without matching emails, and strips worker MCP tools.", () => {
    assert.equal(validWorkerName("Backend-1"), "backend-1");
    assert.equal(validWorkerName("@verifier"), "verifier");
    assert.equal(validWorkerName("coordinator"), null);
    assert.equal(validWorkerName("all"), null);
    assert.equal(validWorkerName("coordinator-2"), null);
    assert.deepEqual(parseMentions("Ping @backend and @verifier (not dev@example.com) plus @all"), ["backend", "verifier", "all"]);

    const none = toolsFor({}).map((t) => t.name);
    assert.ok(!none.includes("swarm_manage") && !none.includes("swarm_post") && !none.includes("swarm_read"));

    const coord = toolsFor({ [SWARM_ENV]: "coordinator" }).map((t) => t.name);
    assert.ok(coord.includes("swarm_manage") && coord.includes("swarm_post") && coord.includes("swarm_read"));

    const worker = toolsFor({ [SWARM_ENV]: "worker" }).map((t) => t.name);
    assert.deepEqual(worker.sort(), ["swarm_post", "swarm_read"]);
  });

  it("Caps active worker processes for low RAM and hibernates parked workers to 0 MB.", async () => {
    let activeNow = 0;
    let peakActive = 0;
    const h = makeHarness({
      maxActive: 1,
      hibernateSec: 0,
      onWorkerTurn: async ({ name, sink, swarm }) => {
        activeNow++;
        peakActive = Math.max(peakActive, activeNow);
        await new Promise((r) => setTimeout(r, 40));
        sink.session(`sess-${name}`);
        swarm.post("th_swarm_1", { from: name, text: `@coordinator Finished ${name}.` });
        activeNow--;
      },
    });
    try {
      await h.swarm.addWorker("th_swarm_1", { name: "alpha", workspace: "inherit", mode: "read", brief: "Audit auth" });
      await h.swarm.addWorker("th_swarm_1", { name: "beta", workspace: "inherit", mode: "read", brief: "Audit ui" });
      await h.swarm.addWorker("th_swarm_1", { name: "gamma", workspace: "inherit", mode: "read", brief: "Audit tests" });

      await waitFor(() => {
        const snap = h.swarm.snapshot("th_swarm_1")!;
        return snap.members.filter((m) => m.name !== "coordinator").every((m) => m.state === "hibernated");
      });

      const snap = h.swarm.snapshot("th_swarm_1")!;
      assert.equal(peakActive, 1, "Never runs more workers than maxActive");
      assert.equal(h.getMaxConcurrentOpen(), 1, "Never holds more live CLI processes than maxActive");
      assert.equal(h.getOpenCount(), 0, "All parked workers closed their processes");
      assert.equal(h.getClosedCount(), 3);
      assert.equal(snap.rssMb, 0);
      assert.equal(snap.hibernatedCount, 3);
      assert.ok(h.coordWakes.length >= 1, "Coordinator received wake digest for worker posts");
    } finally {
      h.swarm.dispose();
    }
  });

  it("Auto-posts a worker summary to @coordinator when a model ends without calling swarm_post.", async () => {
    const h = makeHarness({
      maxActive: 2,
      hibernateSec: 0,
      onWorkerTurn: async ({ sink }) => {
        sink.text("Found 2 unused exports in auth.ts.");
      },
    });
    try {
      await h.swarm.addWorker("th_swarm_1", { name: "auditor", workspace: "inherit", mode: "read", brief: "Find unused exports" });
      await waitFor(() => h.swarm.snapshot("th_swarm_1")!.posts.some((p) => p.from === "auditor" && p.autoPosted));

      const auto = h.swarm.snapshot("th_swarm_1")!.posts.find((p) => p.from === "auditor");
      assert.ok(auto);
      assert.equal(auto.autoPosted, true);
      assert.ok(auto.to.includes("coordinator"));
      assert.match(auto.text, /Found 2 unused exports/);
    } finally {
      h.swarm.dispose();
    }
  });

  it("Recovers cleanly via stateless board checkpoint on ResumeFailed and cross-provider model swaps.", async () => {
    const prompts: { model: string; resume?: string; prompt: string }[] = [];
    let failResumeOnce = true;
    const h = makeHarness({
      maxActive: 2,
      hibernateSec: 0,
      onWorkerTurn: async ({ name, model, resume, prompt, sink, swarm }) => {
        prompts.push({ model, resume, prompt });
        if (resume && failResumeOnce) {
          failResumeOnce = false;
          throw new ResumeFailed("Session expired on disk");
        }
        sink.session(`sid-${model}`);
        swarm.post("th_swarm_1", { from: name, text: `@coordinator Done on ${model}` });
      },
    });
    try {
      await h.swarm.addWorker("th_swarm_1", { name: "backend", model: "codex:gpt-6.1-sol", workspace: "inherit", mode: "read", brief: "Check API routes" });
      await waitFor(() => h.swarm.snapshot("th_swarm_1")!.members.find((m) => m.name === "backend")?.state === "hibernated");

      // Second wake triggers ResumeFailed and recovers with a stateless board-checkpoint prompt.
      h.swarm.post("th_swarm_1", { from: "you", text: "@backend Also check error codes", kind: "user" });
      await waitFor(() => prompts.length >= 3 && h.swarm.snapshot("th_swarm_1")!.members.find((m) => m.name === "backend")?.state === "hibernated");
      assert.equal(prompts[1].resume, "sid-codex:gpt-6.1-sol");
      assert.equal(prompts[2].resume, undefined);
      assert.match(prompts[2].prompt, /Brief for @backend/);
      assert.match(prompts[2].prompt, /Also check error codes/);

      // Hot-swap across providers to OpenCode/DeepSeek and verify stateless handoff.
      h.swarm.swapModel("th_swarm_1", "backend", "opencode:deepseek-v4.1-flash", "quota limit");
      await waitFor(() => prompts.length >= 4 && h.swarm.snapshot("th_swarm_1")!.members.find((m) => m.name === "backend")?.state === "hibernated");
      assert.equal(prompts[3].model, "opencode:deepseek-v4.1-flash");
      assert.equal(prompts[3].resume, undefined);
      assert.match(prompts[3].prompt, /Your model was switched/);
    } finally {
      h.swarm.dispose();
    }
  });

  it("Runs deterministic stall detection without spawning an LLM monitor and stops after [done].", async () => {
    const h = makeHarness({
      maxActive: 2,
      hibernateSec: 0,
      onWorkerTurn: async ({ name, sink }) => {
        // Simulates a worker that failed to post anything.
        sink.session(`s-${name}`);
      },
    });
    h.settings.swarmAutoPost = false;
    try {
      await h.swarm.addWorker("th_swarm_1", { name: "checker", workspace: "inherit", mode: "read", brief: "Verify build" });
      await waitFor(() => h.swarm.snapshot("th_swarm_1")!.members.find((m) => m.name === "checker")?.state === "hibernated");

      // First stall check pings the silent worker directly.
      const nudge1 = h.swarm.checkStall("th_swarm_1");
      assert.ok(nudge1);
      assert.equal(nudge1.kind, "stall");
      assert.ok(nudge1.to.includes("checker"));
      await waitFor(() => h.swarm.snapshot("th_swarm_1")!.members.find((m) => m.name === "checker")?.state === "hibernated");

      // Second stall check escalates to @coordinator to swap its model.
      const nudge2 = h.swarm.checkStall("th_swarm_1");
      assert.ok(nudge2);
      assert.ok(nudge2.to.includes("coordinator"));
      assert.match(nudge2.text, /swap/i);

      // Once coordinator posts [done], stall monitor goes dormant.
      h.swarm.post("th_swarm_1", { from: "coordinator", text: "[done] Shipped." });
      assert.equal(h.swarm.checkStall("th_swarm_1"), null);
    } finally {
      h.swarm.dispose();
    }
  });

  it("Isolates write workers in git worktrees and lands their branch cleanly into the main checkout.", async () => {
    const h = makeHarness({
      gitRepo: true,
      maxActive: 2,
      hibernateSec: 0,
      onWorkerTurn: async ({ name, cwd, swarm }) => {
        writeFileSync(join(cwd, "feature.txt"), "hello from swarm worktree\n");
        swarm.post("th_swarm_1", { from: name, text: "@coordinator Wrote feature.txt in isolated worktree." });
      },
    });
    try {
      const { member } = await h.swarm.addWorker("th_swarm_1", { name: "writer", workspace: "share", mode: "write", brief: "Add feature.txt" });
      assert.equal(member.workspace, "share");
      assert.ok(member.worktreePath && existsSync(member.worktreePath));
      assert.ok(member.branch?.startsWith("swarm/"));

      await waitFor(() => h.swarm.snapshot("th_swarm_1")!.members.find((m) => m.name === "writer")?.state === "hibernated");
      // Main checkout is untouched until landing.
      assert.equal(existsSync(join(h.project, "feature.txt")), false);

      // The coordinator can't land it: merging into the person's checkout is the person's own press, as committing is.
      const asked = await h.swarm.handleTool("th_swarm_1", undefined, "swarm_manage", { action: "land", name: "writer" });
      assert.equal(asked.isError, true);
      assert.match(asked.text, /Only the person merges a worktree/);
      const helper = await h.swarm.handleTool("th_swarm_1", "writer", "swarm_manage", { action: "land", name: "writer" });
      assert.equal(helper.isError, true);
      assert.equal(existsSync(join(h.project, "feature.txt")), false, "nothing was merged by an agent");
      assert.equal(git(h.project, ["status", "--porcelain"]).trim(), "", "and nothing was committed there");
      // Nor does the panel's Land merge while the session's own turn is editing the checkout.
      h.setCoordBusy(true);
      await assert.rejects(h.swarm.landWorker("th_swarm_1", "writer"), /Wait for this session's turn to finish/);
      h.setCoordBusy(false);

      const { summary, snapshot } = await h.swarm.landWorker("th_swarm_1", "writer");
      assert.match(summary, /Landed swarm\//);
      assert.equal(readFileSync(join(h.project, "feature.txt"), "utf8"), "hello from swarm worktree\n");
      assert.equal(snapshot.members.find((m) => m.name === "writer")?.landed, true);
    } finally {
      h.swarm.dispose();
    }
  });

  it("Runs hierarchical Teamwork (Coordinator -> Orchestrator -> Specialists + skipped Interviewer), mirrors nested timeline items, and denies rogue OpenCode native subagents.", async () => {
    // OpenCode V2 denies native task* / subagent* when Swarm is active so providers use Liner's structured Teamwork tree.
    const rules = opencodeSessionRules({ swarm: true }, "liner");
    const taskRule = [...rules].reverse().find((r) => r.action === "task*");
    const subRule = [...rules].reverse().find((r) => r.action === "subagent*");
    assert.equal(taskRule?.effect, "deny");
    assert.equal(subRule?.effect, "deny");

    // Orchestrators get swarm_manage + swarm_post + swarm_read; leaf specialists get only swarm_post + swarm_read.
    assert.deepEqual(toolsFor({ [SWARM_ENV]: "orchestrator" }).map((t) => t.name).sort(), ["swarm_manage", "swarm_post", "swarm_read"]);

    let orchRuns = 0;
    const h = makeHarness({
      maxActive: 2,
      hibernateSec: 0,
      onWorkerTurn: async ({ name, sink, swarm }) => {
        if (name === "orchestrator") {
          orchRuns++;
          if (orchRuns === 1) {
            await swarm.handleTool("th_swarm_1", "orchestrator", "swarm_manage", { action: "add", name: "backend", role: "Backend & Desktop Explorer", workspace: "inherit", mode: "read", brief: "Audit engine" });
            await swarm.handleTool("th_swarm_1", "orchestrator", "swarm_manage", { action: "add", name: "ui", role: "UI Code & Shell Explorer", workspace: "inherit", mode: "read", brief: "Audit UI" });
            // End turn while specialists run (hibernates to 0 MB until specialists post back to @orchestrator).
            return;
          }
          await swarm.handleTool("th_swarm_1", "orchestrator", "swarm_post", { text: "@coordinator Synthesized findings from Backend and UI explorers." });
          return;
        }
        // Leaf specialist cannot call swarm_manage (max depth 2 enforced).
        const denied = await swarm.handleTool("th_swarm_1", name, "swarm_manage", { action: "add", name: "nested", brief: "Should fail" });
        assert.equal(denied.isError, true);
        sink.text(`Findings from ${name}`);
      },
    });
    try {
      await h.swarm.handleTool("th_swarm_1", undefined, "swarm_manage", { action: "skip", name: "interviewer", role: "Task Interviewer", reason: "Prompt is already clear" });
      await h.swarm.handleTool("th_swarm_1", undefined, "swarm_manage", { action: "add", name: "orchestrator", role: "Project Orchestrator", can_delegate: true, workspace: "inherit", mode: "read", brief: "Decompose codebase audit into specialists" });

      await waitFor(() => h.swarm.snapshot("th_swarm_1")!.posts.some((p) => p.from === "orchestrator" && p.text.includes("Synthesized findings")));

      const snap = h.swarm.snapshot("th_swarm_1")!;
      const orch = snap.members.find((m) => m.name === "orchestrator")!;
      const be = snap.members.find((m) => m.name === "backend")!;
      const ui = snap.members.find((m) => m.name === "ui")!;
      const iv = snap.members.find((m) => m.name === "interviewer")!;

      assert.equal(iv.state, "skipped");
      assert.equal(be.parent, "orchestrator");
      assert.equal(ui.parent, "orchestrator");
      assert.equal(be.canDelegate, undefined);

      // Verify native nested timeline items: Root -> Orchestrator -> Specialists + Root -> Skipped Interviewer.
      const rootItem = [...h.items.values()].find((it) => it.kind === "tool" && it.agent?.name === "Teamwork Coordinator");
      const orchItem = orch.itemId ? h.items.get(orch.itemId) : undefined;
      const beItem = be.itemId ? h.items.get(be.itemId) : undefined;
      const ivItem = iv.itemId ? h.items.get(iv.itemId) : undefined;

      assert.ok(rootItem && rootItem.kind === "tool");
      assert.ok(orchItem && orchItem.kind === "tool" && orchItem.agent?.parent === rootItem.id);
      assert.ok(beItem && beItem.kind === "tool" && beItem.agent?.parent === orchItem.id);
      assert.ok(ivItem && ivItem.kind === "tool" && ivItem.agent?.parent === rootItem.id && ivItem.status === "stopped");
      assert.equal(h.getOpenCount(), 0, "Every worker hibernated back to 0 open CLI processes");
    } finally {
      h.swarm.dispose();
    }
  });

  it("Suppresses duplicate OpenCode background subagent launcher rows and recognizes liner_<tag>_swarm_* MCP tool names.", () => {
    // OpenCode V2 exposes registered MCP tools as `${serverName}_${tool}` (e.g. `liner_1234abcd_swarm_manage`).
    const parsed = linerCall("liner_1234abcd_swarm_manage", { action: "add", name: "backend" }, "liner_1234abcd");
    assert.equal(parsed?.name, "swarm_manage");

    // Simulate OpenCode firing a native background subagent tool call followed by the real child session.
    const updates: ToolUpdate[] = [];
    const sink: TurnSink = {
      text: () => {},
      reasoning: () => {},
      tool: (u) => updates.push(u),
      plan: () => {},
      approve: async () => ({ allow: true }),
      ask: async () => null,
      propose: async () => ({ approve: false }),
      usage: () => {},
      session: () => {},
      notice: () => {},
      error: () => {},
      limited: () => {},
    };
    const s = new OpenCodeServerSession(
      { cwd: tempDir("liner-oc-dup-"), model: "deepseek/v4", effort: "", access: "auto", soul: "", guard: true, env: process.env },
      async () => {
        throw new Error("unused");
      },
    );
    (s as unknown as { sink: TurnSink }).sink = sink;
    s.onEvent("session.tool.input.started", { id: "call_1", name: "subagent_create" });
    s.onEvent("session.tool.called", { id: "call_1", name: "subagent_create", input: { description: "Audit engine", prompt: "Inspect swarm.ts" } });
    s.onChildCreated("ses_real_1", "ses_parent", { agent: "explore", title: "Audit engine" });
    s.onEvent("session.tool.success", { id: "call_1", name: "subagent_create", content: [{ type: "text", text: "The subagent is working in the background (sessionID: ses_real_1)" }] });

    // Only the real Explore child row is emitted — zero duplicate "Subagent: The subagent is working in the background" rows.
    const keys = [...new Set(updates.map((u) => u.key))];
    assert.deepEqual(keys, ["opencode:ses_real_1"]);
    assert.equal(updates.at(-1)?.agent?.name, "Explore");
    assert.equal(updates.at(-1)?.agent?.task, "Audit engine");
  });

  it("Strips redundant leading cd to the workspace folder from shell step titles without hiding other directories.", () => {
    const cwd = "/Users/hilmi/Project/Claude/X Apps/Liner Code";
    assert.equal(stripLeadingCd(`cd "${cwd}" && git diff --stat`, cwd), "git diff --stat");
    assert.equal(stripLeadingCd(`cd '${cwd}/'; npm test`, cwd), "npm test");
    assert.equal(stripLeadingCd(`cd "/tmp/other" && ls -la`, cwd), `cd "/tmp/other" && ls -la`);
    assert.equal(stripLeadingCd("git status", cwd), "git status");
  });

  it("Runs Swarm mode as a peer-to-peer board with sharded tasks, fork context, helper scoping, and screenshot timeline parsing.", async () => {
    const swarmRules = swarmCoordinatorRules((t) => t, "squad", 2, "swarm");
    const teamRules = swarmCoordinatorRules((t) => t, "squad", 2, "teamwork");
    assert.match(swarmRules, /peer-to-peer shared message board/i);
    assert.doesNotMatch(swarmRules, /Task Interviewer/);
    assert.match(teamRules, /Project Orchestrator/);

    assert.deepEqual(parseScreenshots("Looks clean now.\nScreenshot: /tmp/after.png | Fixed 360px overflow\n"), [{ path: "/tmp/after.png", caption: "Fixed 360px overflow" }]);

    const h = makeHarness({
      maxActive: 2,
      hibernateSec: 0,
      onWorkerTurn: async ({ name, sink, swarm }) => {
        sink.session(`s-${name}`);
        swarm.post("th_swarm_1", {
          from: name,
          text: `@coordinator Done from @${name}.\nScreenshot: /tmp/${name}.png | Verified ${name} layout`,
        });
      },
    });
    try {
      h.swarm.enable("th_swarm_1", { enabled: true, mode: "swarm" });
      assert.equal(h.swarm.snapshot("th_swarm_1")?.mode, "swarm");

      // Sharded batch via tasks[] spawns audit-1 and audit-2 with per-slice briefs.
      const sharded = await h.swarm.handleTool("th_swarm_1", undefined, "swarm_manage", {
        action: "add",
        name: "audit",
        role: "Auditor",
        workspace: "inherit",
        mode: "read",
        brief: "Inspect panel width",
        tasks: ["crew.css grid tracks", "AgentView step titles"],
      });
      assert.equal(sharded.isError, undefined);
      assert.match(sharded.text, /@audit-1, @audit-2/);

      await waitFor(() => {
        const snap = h.swarm.snapshot("th_swarm_1")!;
        return snap.members.find((m) => m.name === "audit-1")?.state === "hibernated" && snap.members.find((m) => m.name === "audit-2")?.state === "hibernated";
      });

      // Verify screenshot lines were parsed onto board posts.
      const shotPost = h.swarm.snapshot("th_swarm_1")!.posts.find((p) => p.from === "audit-1");
      assert.equal(shotPost?.screenshots?.[0]?.path, "/tmp/audit-1.png");

      // Fork seeds context from @audit-1 into a new peer worker.
      const forked = await h.swarm.handleTool("th_swarm_1", undefined, "swarm_manage", {
        action: "add",
        name: "fixer",
        role: "Fixer",
        workspace: "inherit",
        mode: "read",
        fork: "audit-1",
        brief: "Apply fixes based on audit-1",
      });
      assert.equal(forked.isError, undefined);
      const fixer = h.swarm.snapshot("th_swarm_1")!.members.find((m) => m.name === "fixer")!;
      assert.match(fixer.brief, /Forked context from @audit-1/);

      // Peer worker @fixer can add its own helper, cannot update plan or kill @audit-1, and can kill its own helper.
      const helperRes = await h.swarm.handleTool("th_swarm_1", "fixer", "swarm_manage", {
        action: "add",
        name: "css-check",
        role: "Helper",
        workspace: "inherit",
        mode: "read",
        brief: "Double-check crew.css",
      });
      assert.equal(helperRes.isError, undefined);
      assert.equal(h.swarm.snapshot("th_swarm_1")!.members.find((m) => m.name === "css-check")?.parent, "fixer");

      const badPlan = await h.swarm.handleTool("th_swarm_1", "fixer", "swarm_manage", { action: "plan", plan: { goal: { title: "x", line: "y" }, tasks: {}, threads: [] } });
      assert.equal(badPlan.isError, true);

      const badKill = await h.swarm.handleTool("th_swarm_1", "fixer", "swarm_manage", { action: "kill", name: "audit-1" });
      assert.equal(badKill.isError, true);

      const goodKill = await h.swarm.handleTool("th_swarm_1", "fixer", "swarm_manage", { action: "kill", name: "css-check" });
      assert.equal(goodKill.isError, undefined);
      assert.equal(h.swarm.snapshot("th_swarm_1")!.members.find((m) => m.name === "css-check")?.state, "killed");
    } finally {
      h.swarm.dispose();
    }
  });

  it("Emits explicit auto-spawn directives and resets stale coordinator sessions when enabling or switching Swarm mode.", async () => {
    const swDir = swarmCoordinatorDirective("swarm", (t) => `liner_${t}`);
    const twDir = swarmCoordinatorDirective("teamwork", (t) => `mcp__liner__${t}`);
    assert.match(swDir, /Do NOT edit files or implement this task solo/);
    assert.match(swDir, /liner_swarm_manage/);
    assert.match(twDir, /Project Orchestrator/);
    assert.match(twDir, /mcp__liner__swarm_manage/);

    const resets: string[] = [];
    const h = makeHarness({ onWorkerTurn: async () => {} });
    // Attach resetCoordinatorSession spy onto the harness host.
    (h.swarm as unknown as { host: SwarmHost }).host.resetCoordinatorSession = (tid) => resets.push(tid);
    try {
      // Initial thread starts with teamwork enabled; re-enabling teamwork is idempotent (0 resets).
      h.swarm.enable("th_swarm_1", { enabled: true, mode: "teamwork" });
      assert.equal(resets.length, 0);

      // Switching from teamwork -> swarm resets the stale coordinator session so fresh MCP permissions + soul load.
      h.swarm.enable("th_swarm_1", { enabled: true, mode: "swarm" });
      assert.equal(resets.length, 1);

      // `models` action lists available cross-provider models cleanly.
      (h.swarm as unknown as { host: SwarmHost }).host.listModels = () => [{ ref: "opencode:deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash", provider: "OpenCode" }];
      const modelsOut = await h.swarm.handleTool("th_swarm_1", undefined, "swarm_manage", { action: "models" });
      assert.equal(modelsOut.isError, undefined);
      assert.match(modelsOut.text, /opencode:deepseek-v4\.1-flash/);

      // Turning off resets once; turning back on resets again.
      h.swarm.enable("th_swarm_1", { enabled: false });
      assert.equal(resets.length, 2);
      h.swarm.enable("th_swarm_1", { enabled: true, mode: "swarm" });
      assert.equal(resets.length, 3);
    } finally {
      h.swarm.dispose();
    }

    // OpenCode v2 daemon config must never globally deny `liner_*` or allow `subagent*` (which would override per-session rules).
    const daemonCfg = JSON.parse(daemonConfigContent({})) as { permission: Record<string, string> };
    assert.equal(daemonCfg.permission["liner_*"], undefined);
    assert.equal(daemonCfg.permission["subagent*"], undefined);
    assert.equal(daemonCfg.permission["task*"], undefined);
    assert.equal(daemonCfg.permission["execute*"], "deny");

    // Workers inherit the session's main model by default, use an explicit setting when ready, and fall back to main if that CLI isn't signed in.
    assert.equal(pickSwarmWorkerModel("opencode:hy4-flash-free", undefined, () => true), "opencode:hy4-flash-free");
    assert.equal(pickSwarmWorkerModel("opencode:hy4-flash-free", "same", () => true), "opencode:hy4-flash-free");
    assert.equal(pickSwarmWorkerModel("opencode:hy4-flash-free", "codex:gpt-6.1-sol", (r) => r.startsWith("codex:")), "codex:gpt-6.1-sol");
    assert.equal(pickSwarmWorkerModel("opencode:hy4-flash-free", "claude:claude-sonnet-5-5", () => false), "opencode:hy4-flash-free");
  });
});
