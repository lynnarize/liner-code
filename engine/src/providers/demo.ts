/*
  The demo agent: a scripted run that uses every part of the app (thinking, a plan, reads, a
  search, an approval, a real edit, the summary) with no provider installed. It edits files only
  inside the sample project the engine makes for it; anywhere else it says what it would do.
  Asked for a design, it draws a tide screen through Liner Code's own design_show, the same call
  any agent makes, and draws it again for each comment.
*/
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProviderInfo } from "../../../contracts/src/index.ts";
import { run } from "../exec.ts";
import type { OpenOptions, Provider, ProviderSession, TurnSink } from "./types.ts";

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    // A signal that's already aborted never fires again (Stop while it asked you): stopped now, not after the rest of the script.
    if (signal.aborted) return reject(new Error("stopped"));
    const stop = () => (clearTimeout(t), reject(new Error("stopped")));
    // Each wait lets go of the signal when it's over: a long reply would otherwise leave hundreds on it.
    const t = setTimeout(() => (signal.removeEventListener("abort", stop), resolve()), ms);
    signal.addEventListener("abort", stop, { once: true });
  });

/** Writes text out a few words at a time, the way a model streams it. */
async function stream(say: (t: string) => void, text: string, signal: AbortSignal, ms = 28) {
  const words = text.match(/\S+\s*/g) ?? [];
  for (let i = 0; i < words.length; i += 2) {
    say(words.slice(i, i + 2).join(""));
    await wait(ms, signal);
  }
}

export const SAMPLE_FILES: Record<string, string> = {
  "README.md": "# Tidewater\n\nA tiny tide-table service, used by Liner Code's demo agent.\n\n```bash\nnpm test\n```\n",
  "package.json": JSON.stringify({ name: "tidewater", version: "0.1.0", type: "module", scripts: { test: "node --test" } }, null, 2) + "\n",
  "src/tides.js":
    "// Returns the next high tide after `from`, given today's tide times.\nexport function nextHigh(times, from) {\n  for (const t of times) {\n    if (t.kind === \"high\" && t.at > from) return t;\n  }\n  return null;\n}\n\nexport function label(t) {\n  return `High tide at ${t.at}`;\n}\n",
  "src/tides.test.js":
    'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { nextHigh } from "./tides.js";\n\nconst day = [\n  { kind: "low", at: "03:10" },\n  { kind: "high", at: "09:24" },\n  { kind: "low", at: "15:40" },\n  { kind: "high", at: "21:52" },\n];\n\ntest("finds the next high tide", () => {\n  assert.equal(nextHigh(day, "10:00").at, "21:52");\n});\n',
};

/** Makes the demo agent's sample project once, as a git repo with one commit. */
export async function ensureSampleProject(home: string) {
  const dir = join(home, "Sample project");
  if (existsSync(join(dir, ".git"))) return dir;
  for (const [path, text] of Object.entries(SAMPLE_FILES)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  const env = { ...process.env, GIT_AUTHOR_NAME: "Liner Code", GIT_AUTHOR_EMAIL: "demo@liner.local", GIT_COMMITTER_NAME: "Liner Code", GIT_COMMITTER_EMAIL: "demo@liner.local" };
  await run("git", ["init", "-q", "-b", "main"], { cwd: dir, env });
  await run("git", ["add", "-A"], { cwd: dir, env });
  await run("git", ["commit", "-q", "-m", "Tide tables"], { cwd: dir, env });
  return dir;
}

/** A design asked for, or a comment on one (the Design surface's say "the design"); building one is a change like any other. */
const DESIGN_ASK = /\b(design|mock-?up|wireframe|prototype|screen|landing page)\b/i;

/** The demo's design: a phone screen for the tide tables, in three rounds (a draft, night colours, the week added). */
export function tideDesign(round: number) {
  const night = round % 3 >= 1;
  const week = round % 3 === 2;
  const c = night
    ? { bg: "#0b1220", card: "#111a2e", ink: "#e8eefc", ink2: "#9aa8c7", line: "#1f2a44", accent: "#5eb3ff", soft: "rgba(94,179,255,.16)", drop: "rgba(0,0,0,.5)" }
    : { bg: "#eef3f7", card: "#ffffff", ink: "#0f1c2b", ink2: "#5b6b7d", line: "#e3e9ef", accent: "#0a72d1", soft: "rgba(10,114,209,.10)", drop: "rgba(15,28,43,.25)" };
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const highs = ["09:24", "10:02", "10:41", "11:19", "11:58", "12:37", "13:15"];
  const curve = "M0 70 C 30 70, 40 18, 75 18 S 120 72, 150 72 S 200 12, 245 12 S 300 60, 320 52";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tidewater</title>
<style>
:root { --bg: ${c.bg}; --card: ${c.card}; --ink: ${c.ink}; --ink2: ${c.ink2}; --line: ${c.line}; --accent: ${c.accent}; --soft: ${c.soft}; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.45 -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
.app { max-width: 430px; margin: 0 auto; padding: 56px 20px 32px; }
header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
.place { font-size: 13px; color: var(--ink2); }
h1 { margin: 2px 0 0; font-size: 24px; letter-spacing: -0.01em; }
.avatar { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 50%; background: var(--soft); color: var(--accent); font-weight: 600; }
.card { margin-bottom: 14px; padding: 20px; border-radius: 20px; background: var(--card); box-shadow: 0 1px 0 var(--line), 0 12px 32px -18px ${c.drop}; }
.label { font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink2); }
.next { display: flex; align-items: baseline; gap: 10px; margin: 6px 0 2px; }
.time { font-size: 44px; font-weight: 650; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; }
.in { font-size: 14px; font-weight: 550; color: var(--accent); }
.height { font-size: 14px; color: var(--ink2); }
svg { display: block; width: 100%; height: auto; margin-top: 16px; }
.list { margin: 0; padding: 0; list-style: none; }
.list li { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-top: 1px solid var(--line); font-variant-numeric: tabular-nums; }
.list li:first-child { border-top: 0; }
.list li.now { margin: 0 -10px; padding: 12px 10px; border-top-color: transparent; border-radius: 12px; background: var(--soft); }
.list li.now + li { border-top-color: transparent; }
.dot { width: 10px; height: 10px; border: 2px solid var(--accent); border-radius: 50%; }
.dot.high { background: var(--accent); }
.k { flex: 1; }
.m { font-size: 14px; color: var(--ink2); }
.week { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; margin-top: 10px; font-size: 12px; text-align: center; color: var(--ink2); }
.week div { padding: 6px 0; border-radius: 12px; }
.week b { display: block; margin-top: 4px; font-size: 13px; color: var(--ink); font-variant-numeric: tabular-nums; }
.week .on { background: var(--soft); color: var(--accent); }
</style>
</head>
<body>
<main class="app">
  <header>
    <div><div class="place">Pier 39 · San Francisco</div><h1>Today's tides</h1></div>
    <div class="avatar" aria-label="Your profile">L</div>
  </header>
  <section class="card" aria-label="Next high tide">
    <div class="label">Next high tide</div>
    <div class="next"><span class="time">21:52</span><span class="in">in 3 h 08 min</span></div>
    <div class="height">1.9 m · rising</div>
    <svg viewBox="0 0 320 90" role="img" aria-label="Tide height through the day">
      <path d="${curve} V90 H0Z" fill="var(--soft)" />
      <path d="${curve}" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" />
      <line x1="196" x2="196" y1="0" y2="90" stroke="var(--ink2)" stroke-dasharray="3 4" />
      <circle cx="245" cy="12" r="5" fill="var(--accent)" />
    </svg>
  </section>${
    week
      ? `
  <section class="card" aria-label="This week's first high tides">
    <div class="label">This week</div>
    <div class="week">${days.map((d, i) => `<div class="${i === 2 ? "on" : ""}">${d}<b>${highs[i]}</b></div>`).join("")}</div>
  </section>`
      : ""
  }
  <section class="card" aria-label="All of today's tides">
    <div class="label">Today</div>
    <ul class="list">
      <li><span class="dot"></span><span class="k">Low</span><span class="m">0.4 m</span><b>03:10</b></li>
      <li><span class="dot high"></span><span class="k">High</span><span class="m">1.8 m</span><b>09:24</b></li>
      <li><span class="dot"></span><span class="k">Low</span><span class="m">0.6 m</span><b>15:40</b></li>
      <li class="now"><span class="dot high"></span><span class="k">High · next</span><span class="m">1.9 m</span><b>21:52</b></li>
    </ul>
  </section>
</main>
</body>
</html>
`;
}

class DemoSession implements ProviderSession {
  private o: OpenOptions;
  private turns = 0;
  private designs = 0;
  constructor(o: OpenOptions) {
    this.o = o;
  }

  async turn(text: string, sink: TurnSink, signal: AbortSignal) {
    const n = ++this.turns;
    const t = `demo-${Date.now().toString(36)}`;
    sink.session(`demo-session`);
    const file = join(this.o.cwd, "src/tides.js");
    const sample = existsSync(file) && readFileSync(file, "utf8").includes("nextHigh");
    if (DESIGN_ASK.test(text) && !/^Build the design\b/i.test(text.trim())) return this.design(text, sink, signal, t);
    if (this.o.planning) return this.plan(text, sink, signal, t);

    await stream((d) => sink.reasoning(d, `${t}-r`), `They asked: "${text.slice(0, 80)}". I'll look at how the tide times are read first, then make the smallest change and run the tests.`, signal, 22);
    await wait(300, signal);
    sink.plan([
      { title: "Read how tide times are compared", status: "in_progress" },
      { title: "Handle times past midnight", status: "pending" },
      { title: "Run the tests", status: "pending" },
    ]);
    sink.tool({ key: `${t}-1`, tool: "Read", toolKind: "read", title: "Read src/tides.js", path: "src/tides.js", status: "running" });
    await wait(700, signal);
    sink.tool({ key: `${t}-1`, tool: "Read", toolKind: "read", title: "Read src/tides.js", path: "src/tides.js", status: "done", output: sample ? readFileSync(file, "utf8") : "(not in this project)" });
    sink.tool({ key: `${t}-2`, tool: "Grep", toolKind: "search", title: "Search for nextHigh(", status: "running" });
    await wait(500, signal);
    sink.tool({ key: `${t}-2`, tool: "Grep", toolKind: "search", title: "Search for nextHigh(", status: "done", output: "src/tides.js:2\nsrc/tides.test.js:3\nsrc/tides.test.js:13" });
    sink.plan([
      { title: "Read how tide times are compared", status: "completed" },
      { title: "Handle times past midnight", status: "in_progress" },
      { title: "Run the tests", status: "pending" },
    ]);

    await stream((d) => sink.text(d, `${t}-a`), "Times are compared as strings, which works until the last high tide has passed: after 21:52 it returns nothing instead of tomorrow's first high tide. ", signal);
    await wait(200, signal);

    if (this.o.access !== "read") {
      sink.tool({ key: `${t}-3`, tool: "Edit", toolKind: "edit", title: "Edit src/tides.js", path: "src/tides.js", status: "running" });
      await wait(600, signal);
      if (sample) {
        const before = readFileSync(file, "utf8");
        const after = before.includes("tomorrow")
          ? before.replace("return `High tide at ${t.at}`;", n % 2 ? "return `High tide at ${t.at}${t.tomorrow ? \" tomorrow\" : \"\"}`;" : "return `High tide at ${t.at}`;")
          : before.replace(
              "  return null;\n}",
              "  // Past the last high tide: wrap round to tomorrow's first one.\n  const first = times.find((t) => t.kind === \"high\");\n  return first ? { ...first, tomorrow: true } : null;\n}",
            );
        writeFileSync(file, after);
      }
      sink.tool({ key: `${t}-3`, tool: "Edit", toolKind: "edit", title: "Edit src/tides.js", path: "src/tides.js", status: "done", output: sample ? "Wrapped round to tomorrow's first high tide" : "(skipped: the demo only edits its sample project)" });
    }

    let ran = true;
    if (this.o.access === "ask") {
      const a = await sink.approve(
        { key: `${t}-4`, tool: "Bash", title: "Run npm test", description: "Runs the project's tests to check the change.", risk: "low", fields: [{ label: "Command", value: "npm test" }, { label: "Where", value: this.o.cwd }] },
        signal,
      );
      ran = a.allow;
    }
    if (ran && this.o.access !== "read") {
      sink.tool({ key: `${t}-4`, tool: "Bash", toolKind: "exec", title: "Run npm test", input: "npm test", status: "running" });
      await wait(1400, signal);
      sink.tool({ key: `${t}-4`, tool: "Bash", toolKind: "exec", title: "Run npm test", input: "npm test", status: "done", output: "✔ finds the next high tide (0.6ms)\nℹ tests 1\nℹ pass 1\nℹ fail 0" });
    }
    sink.plan([
      { title: "Read how tide times are compared", status: "completed" },
      { title: "Handle times past midnight", status: this.o.access === "read" ? "pending" : "completed" },
      { title: "Run the tests", status: ran && this.o.access !== "read" ? "completed" : "pending" },
    ]);
    await stream(
      (d) => sink.text(d, `${t}-b`),
      this.o.access === "read"
        ? "This thread is read only, so I left the file alone. The fix is to fall back to the first high tide of the list, marked as tomorrow."
        : ran
          ? "\n\nNow it wraps round to tomorrow's first high tide and marks it, so the label can say so. The test passes. You can see the change on the right, and take it back from there if you'd rather not keep it."
          : "\n\nI made the change but didn't run the tests, since you said no. Run `npm test` when you're ready.",
      signal,
    );
    // Each turn's own use: what one turn of the work reads and writes (not running totals, which the work and design turns counted differently).
    sink.usage({ inputTokens: 1800 + n * 420, outputTokens: 260, cacheReadTokens: 1200 * n, costUsd: 0, contextTokens: 6200 + n * 900, contextWindow: 200000 });
  }
  /** A planner's turn: talk is answered; a change gets a look, one question, and a plan to approve. */
  private async plan(text: string, sink: TurnSink, signal: AbortSignal, t: string) {
    if (!/\b(fix|add|change|make|build|update|remove|delete|rename|refactor|move|write|implement|handle|show|support)\b/i.test(text)) {
      await stream((d) => sink.text(d, `${t}-a`), "Hi, Demo here. I'm a scripted planner, so I can't really chat, but I answer like a real one: talk gets a reply, and a change gets a plan. Ask me to fix the tide time after midnight to see the plan.", signal);
      sink.usage({ inputTokens: 300, outputTokens: 60, cacheReadTokens: 0, costUsd: 0, contextTokens: 1400, contextWindow: 200000 }, false);
      return;
    }
    await stream((d) => sink.reasoning(d, `${t}-r`), `Before planning "${text.slice(0, 60)}", I'll read how tide times are compared and what the tests cover.`, signal, 22);
    sink.tool({ key: `${t}-1`, tool: "Read", toolKind: "read", title: "Read src/tides.js", path: "src/tides.js", status: "running" });
    await wait(600, signal);
    sink.tool({ key: `${t}-1`, tool: "Read", toolKind: "read", title: "Read src/tides.js", path: "src/tides.js", status: "done" });
    sink.tool({ key: `${t}-2`, tool: "Read", toolKind: "read", title: "Read src/tides.test.js", path: "src/tides.test.js", status: "running" });
    await wait(500, signal);
    sink.tool({ key: `${t}-2`, tool: "Read", toolKind: "read", title: "Read src/tides.test.js", path: "src/tides.test.js", status: "done" });
    const answers = await sink.ask(
      [
        {
          question: "After the last high tide of the day, what should it show?",
          header: "Past midnight",
          options: [
            { label: "Tomorrow's first high tide", description: "Marked as tomorrow, so the label can say so.", suggested: true },
            { label: "Nothing until the next table loads", description: "The simplest, but the card goes blank at night." },
            { label: "The last high tide that passed", description: "Never blank, but it can look like an error." },
          ],
        },
      ],
      signal,
    ).catch(() => null);
    const pick = answers ? Object.values(answers)[0] : "Tomorrow's first high tide";
    await stream((d) => sink.text(d, `${t}-a`), `Times are compared as strings, so after the last high tide it returns nothing. You picked: ${pick}. Here's the plan for the coder.\n\n`, signal);
    // Handed over the way a real planner does it, in <plan> tags the turn turns into a card when it ends.
    await stream(
      (d) => sink.text(d, `${t}-a`),
      `<plan title="Wrap round to tomorrow's first high tide">\n1. Fall back to the first high tide of the list when none is left today — src/tides.js\n2. Mark it as tomorrow so the label can say so — src/tides.js\n3. Add a test for a time after the last high tide — src/tides.test.js\n4. Run npm test\n</plan>`,
      signal,
      90,
    );
    // A real planner often says a word after the plan too; it reads below the card.
    await stream((d) => sink.text(d, `${t}-a`), "\n\nIt's a small change in one file plus a test. Approve it and the builder starts, or tell me what to change.", signal);
    sink.usage({ inputTokens: 900, outputTokens: 180, cacheReadTokens: 400, costUsd: 0, contextTokens: 4100, contextWindow: 200000 }, false);
  }

  /**
    A design: drawn as one HTML page and shown with design_show through Liner Code's tools, the way
    any agent does it (mcp.ts posts each call to the same place). A comment on it draws it again.
  */
  private async design(text: string, sink: TurnSink, signal: AbortSignal, t: string) {
    const round = this.designs++;
    const asked = text.trim().split("\n")[0].slice(0, 90);
    await stream(
      (d) => sink.reasoning(d, `${t}-r`),
      round === 0 ? "They want a design. I'll draw the tide screen as one HTML page, for a phone, show it in the Design surface, and look at the picture it sends back." : `A comment on the design: "${asked}". I'll change only that, and show it again as the next version.`,
      signal,
      22,
    );
    const note = round % 3 === 0 ? (round ? "Back to day colours" : undefined) : round % 3 === 1 ? "Night colours" : "Adds the week";
    const args = { title: "Tide screen", html: tideDesign(round), size: "phone", ...(note ? { note } : {}) };
    const call = { key: `${t}-d`, tool: "mcp__liner__design_show", toolKind: "other" as const, title: "Show the design “Tide screen”", input: JSON.stringify({ title: args.title, size: args.size, note }) };
    sink.tool({ ...call, status: "running" });
    let said = "";
    let failed = false;
    try {
      if (!this.o.mcp) throw new Error("Liner Code's tools aren't with this session.");
      const r = await fetch(this.o.mcp.env.LINER_SURFACE_URL, { method: "POST", headers: { "content-type": "application/json", "x-liner-surface": this.o.mcp.env.LINER_SURFACE_KEY }, body: JSON.stringify({ tool: "design_show", args }), signal });
      const b = (await r.json()) as { ok: boolean; result?: { content: { type: string; text?: string }[]; isError?: boolean }; error?: string };
      said = b.result?.content.find((c) => c.type === "text")?.text ?? b.error ?? "";
      failed = !b.ok || Boolean(b.result?.isError);
    } catch (e) {
      if (signal.aborted) throw e;
      said = e instanceof Error ? e.message : String(e);
      failed = true;
    }
    sink.tool({ ...call, status: failed ? "failed" : "done", output: said.slice(0, 2000) });
    const version = Number(/version (\d+)/.exec(said)?.[1] ?? 0);
    await stream(
      (d) => sink.text(d, `${t}-a`),
      failed
        ? `I couldn't show the design: ${said}`
        : round === 0
          ? "Here's a first draft of the tide screen, drawn for a phone, in the Design surface beside the session. It leads with the next high tide and how far off it is, then the day's curve, then every tide in a list with the next one marked.\n\nPick any part of it with the comment button to say what should change, or press **Build it** when it's right."
          : `Done: ${note ? note.toLowerCase() : "the change you asked for"}. It's version ${version || round + 1} now; the earlier ones stay in the Versions menu if you'd like one back.`,
      signal,
    );
    sink.usage({ inputTokens: 2400 + round * 600, outputTokens: 1900, cacheReadTokens: 1500 * round, costUsd: 0, contextTokens: 7800 + round * 2100, contextWindow: 200000 });
  }

  close() {}
}

export const demo: Provider = {
  id: "demo",
  async detect(): Promise<ProviderInfo> {
    return { id: "demo", label: "Demo", adapter: true, login: "", available: true, detail: "Scripted: no model, no account", models: [{ id: "demo", label: "Demo", description: "Plays a short scripted run" }], supports: { approvals: true, resume: false, effort: false, plan: true } };
  },
  open: (o) => new DemoSession(o),
};
