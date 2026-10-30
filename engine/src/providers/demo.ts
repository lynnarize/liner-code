/*
  The demo agent: a scripted run that uses every part of the app (thinking, a plan, reads, a
  search, an approval, a real edit, the summary) with no provider installed. It edits files only
  inside the sample project the engine makes for it; anywhere else it says what it would do.
*/
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProviderInfo } from "../../../contracts/src/index.ts";
import { run } from "../exec.ts";
import type { OpenOptions, Provider, ProviderSession, TurnSink } from "./types.ts";

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), reject(new Error("stopped"))), { once: true });
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

class DemoSession implements ProviderSession {
  private o: OpenOptions;
  private turns = 0;
  constructor(o: OpenOptions) {
    this.o = o;
  }

  async turn(text: string, sink: TurnSink, signal: AbortSignal) {
    const n = ++this.turns;
    const t = `demo-${Date.now().toString(36)}`;
    sink.session(`demo-session`);
    const file = join(this.o.cwd, "src/tides.js");
    const sample = existsSync(file) && readFileSync(file, "utf8").includes("nextHigh");
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
    sink.usage({ inputTokens: 1800 + n * 420, outputTokens: 260, cacheReadTokens: 1200 * n, costUsd: 0, contextTokens: 6200 + n * 900, contextWindow: 200000 }, true);
  }
  /** A lead's turn: talk is answered; a change gets a look, one question, and a plan to approve. */
  private async plan(text: string, sink: TurnSink, signal: AbortSignal, t: string) {
    if (!/\b(fix|add|change|make|build|update|remove|delete|rename|refactor|move|write|implement|handle|show|support)\b/i.test(text)) {
      await stream((d) => sink.text(d, `${t}-a`), "Hi, Demo here. I'm a scripted lead, so I can't really chat, but I answer like a real one: talk gets a reply, and a change gets a plan. Ask me to fix the tide time after midnight to see the plan.", signal);
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
    // Handed over the way a real lead does it, in <plan> tags the turn turns into a card when it ends.
    await stream(
      (d) => sink.text(d, `${t}-a`),
      `<plan title="Wrap round to tomorrow's first high tide">\n1. Fall back to the first high tide of the list when none is left today — src/tides.js\n2. Mark it as tomorrow so the label can say so — src/tides.js\n3. Add a test for a time after the last high tide — src/tides.test.js\n4. Run npm test\n</plan>`,
      signal,
      90,
    );
    sink.usage({ inputTokens: 900, outputTokens: 180, cacheReadTokens: 400, costUsd: 0, contextTokens: 4100, contextWindow: 200000 }, false);
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
