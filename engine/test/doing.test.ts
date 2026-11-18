/*
  What a session is doing now (Thread.doing), the sidebar's second line while a turn runs: its words (contracts doingOf),
  short and plain, with nothing secret or long in them; how often it is sent (at most one line a session about every 700 ms,
  the latest winning, nothing when the words didn't change); and that it goes at once whenever the turn ends, is stopped,
  fails, hits a limit or waits on you, and after the engine starts again. The lead's steps say it, not its agents'. The
  Demo says it too. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderInfo, Thread } from "../../contracts/src/index.ts";
import { callCommand, canvasFrame, canvasWords, CARD_TOOLS, cutDoing, DESIGN_TOOLS, DOING_MAX, doingCommand, doingOf, emptyUsage, isStepCall, KIND_WORDS, PR_TEST_TOOL, readableFrame, SIDEKICK_WORDS, toolNameOf, type DoingCall } from "../../contracts/src/index.ts";
import { providers, Runtime } from "../src/runtime.ts";
import type { OpenOptions, Provider, TurnSink } from "../src/providers/types.ts";
import { Store } from "../src/store.ts";

const info = (id: ProviderInfo["id"], models: string[]): ProviderInfo => ({ id, label: id, available: true, adapter: true, login: "", models: models.map((m) => ({ id: m, label: m, description: "" })), supports: { approvals: true, resume: true, effort: true, plan: true } });
const ready = [info("claude", ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]), info("demo", ["demo"])];
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

/** One call as a provider reports it. */
const call = (tool: string, toolKind: string, title: string, more: Partial<DoingCall> = {}): DoingCall => ({ tool, toolKind, title, ...more });
const words = (...calls: DoingCall[]) => doingOf(calls);

/** Every line it may say: sentence case, at most 48 characters, no full stop and no "…" at the end, one line. */
function plain(text: string | undefined) {
  assert.ok(text, "it says something");
  assert.ok(text!.length <= DOING_MAX, `at most ${DOING_MAX} characters: ${text}`);
  assert.match(text!, /^[A-Z]/, `sentence case: ${text}`);
  assert.doesNotMatch(text!, /[.…]$/, `no full stop or "…": ${text}`);
  assert.doesNotMatch(text!, /\n/, "one line");
}

test("words: a step as it starts, in the trail's verbs", () => {
  assert.equal(words(call("Read", "read", "Read /Users/someone/Project/app/ui/src/app/Sidebar.tsx", { path: "/Users/someone/Project/app/ui/src/app/Sidebar.tsx" })), "Reading Sidebar.tsx");
  assert.equal(words(call("Edit", "edit", "Edit ui/src/app/app.css", { path: "ui/src/app/app.css" })), "Editing app.css");
  assert.equal(words(call("Write", "write", "write")), "Changing a file", "a call that names no file");
  assert.equal(words(call("Bash", "exec", "Run npm test", { input: JSON.stringify({ command: "npm test" }) })), "Running npm test");
  assert.equal(words(call("Bash", "exec", "execute")), "Running a command", "a command it can't name");
  assert.equal(words(call("Grep", "search", "Search for nextHigh(")), "Searching the code");
  assert.equal(words(call("Bash", "exec", "Run gh pr create", { input: "gh pr create --title 'Fix the tide' --body 'x'" })), "Opening a pull request");
  assert.equal(words(call("think", "think", "think")), "Thinking");
  assert.equal(words(call("WebFetch", "fetch", "fetch")), "Reading a page");
  assert.equal(words(call("Task", "task", "task")), "Sending an agent", "the trail's words too, for a call that says only its kind");
  assert.equal(words(call("mcp__liner__sidekick", "task", "Sidekick: change nextHigh")), "Working with its sidekick", "the Design face's trail says it so too");
  assert.equal(words(call("mcp__liner__browser_open", "other", "Open localhost:5173 in the Browser")), "Checking in the Browser");
  assert.equal(words(call("mcp__liner__server_start", "other", "Run web from launch.json")), "Starting web");
  assert.equal(words(call("mcp__github__create_pull_request", "other", "mcp__github__create_pull_request")), "Using github");
  assert.equal(words(call("mcp__liner__lean_read", "other", "")), "Using a tool", "Liner's own tools aren't named by their ids");
});

test("words: reads in a row gather into one, as the trail has them", () => {
  const read = (p: string) => call("Read", "read", `Read ${p}`, { path: p });
  assert.equal(words(read("a/x.ts"), read("b/y.ts"), read("c/z.ts")), "Reading 3 files");
  assert.equal(words(read("a/x.ts"), read("a/x.ts")), "Reading x.ts", "the same file twice is one file");
  assert.equal(words(read("a/x.ts"), call("Bash", "exec", "Run ls", { input: "ls" }), read("b/y.ts")), "Reading y.ts", "a command between starts a new step");
  assert.equal(words(call("Read", "read", "read"), call("Read", "read", "read")), "Reading 2 files", "reads that name no file are counted");
  // A question between two reads isn't a step: the reads stay one.
  assert.equal(words(read("a/x.ts"), call("AskUserQuestion", "other", "Ask"), read("b/y.ts")), "Reading 2 files");
});

test("words: a card isn't a step, so what it said before stands", () => {
  for (const tool of ["AskUserQuestion", "ExitPlanMode", "mcp__liner__design_show", "liner.design_show", "liner_design_show", "mcp__liner__show_page", "liner.test"]) assert.equal(words(call("Read", "read", "Read a.ts", { path: "a.ts" }), call(tool, "other", "x")), undefined, tool);
  assert.equal(words(), undefined);
});

test("words: drawing names the frame when it is known, else just says drawing", () => {
  const path = ".liner/designs/tides/frames/phone-week.html";
  assert.equal(words(call("Write", "write", "Draw Phone / Week", { path })), "Drawing Phone / Week", "the Demo's title names it");
  assert.equal(doingOf([call("Write", "write", "Write phone-week.html", { path: `/abs/${path}` })], (frame, design) => (frame === "phone-week" && design === "tides" ? "Phone / Week" : undefined)), "Drawing Phone / Week", "the design file names it");
  assert.equal(words(call("Write", "write", "Write phone-week.html", { path })), "Drawing Phone week", "nobody names it: a name made from its id, as the trail's");
  assert.equal(words(call("mcp__liner__design_frame", "other", "design_frame", { input: JSON.stringify({ name: "Phone / Today", w: 390 }) })), "Drawing Phone / Today");
  assert.equal(words(call("liner_design_frame", "other", "design_frame", { input: "{}" })), "Drawing a frame");
  assert.equal(words(call("mcp__liner__design_files", "other", "design_files")), "Reading the design files");
  assert.equal(words(call("mcp__liner__design_node", "other", "design_node", { input: JSON.stringify({ frame: "brand-board", html: "<p>" }) })), "Changing Brand board");
});

test("words: where the trail and the line said different things, they say one now (F1)", () => {
  const path = "/abs/.liner/designs/tides/frames/phone-week.html";
  const known = (frame: string, design: string) => (frame === "phone-week" && design === "tides" ? "Phone / Week" : undefined);
  // A frame already in its design file: an edit changes it, as the trail says; the turn's first whole write draws it.
  assert.equal(doingOf([call("Edit", "edit", "Edit phone-week.html", { path })], known), "Changing Phone / Week");
  assert.equal(doingOf([call("Write", "write", "Write phone-week.html", { path })], known), "Drawing Phone / Week");
  assert.equal(doingOf([call("Write", "write", "Write phone-week.html", { path }), call("Write", "write", "Write phone-week.html", { path })], known), "Changing Phone / Week", "written again in the turn");
  assert.equal(doingOf([call("Edit", "edit", "Edit phone-day.html", { path: path.replace("week", "day") })], known), "Drawing Phone day", "a frame not in the file yet is being drawn");
  // The design file's name before the call's own.
  assert.equal(doingOf([call("Write", "write", "Draw Phone week view", { path })], known), "Drawing Phone / Week");
  // A canvas call's frame: "for" a picture's, the frame being marked built.
  assert.equal(words(call("mcp__liner__design_picture", "other", "design_picture", { input: JSON.stringify({ frame: "brand-board" }) })), "Making a picture for Brand board");
  assert.equal(words(call("mcp__liner__design_built", "other", "Tie x", { input: JSON.stringify({ frame: "brand-board", file: "src/x.tsx" }) })), "Marking it built Brand board");
  assert.equal(words(call("mcp__liner__design_picture", "other", "design_picture", { input: "{}" })), "Making a picture");
  // A read titled with its path is said by the file's name, as a read with a path is.
  assert.equal(words(call("Read", "read", "Read src/app/a.ts")), "Reading a.ts");
  // A server start that names no server.
  assert.equal(words(call("mcp__liner__server_start", "other", "Run")), "Starting a server");
  // A tool by its MCP server's name, else by its own: one rule for the trail and the line.
  assert.equal(toolNameOf("mcp__github__create_issue"), "github");
  assert.equal(toolNameOf("mcp__liner__lean_read"), undefined);
  assert.equal(toolNameOf("Skill"), "Skill");
  assert.equal(toolNameOf("edit"), undefined);
  // Codex's command array is said as the shell reads it, in the trail too: its quoted part stays one word.
  assert.equal(callCommand(call("shell", "exec", "shell", { input: JSON.stringify({ command: ["bash", "-lc", "npm test"] }) })), "bash -lc 'npm test'");
  assert.equal(callCommand(call("Bash", "exec", "Run ls -la")), "ls -la");
});

test("steps: one list of cards, the same for the trail and the line", () => {
  for (const tool of [...CARD_TOOLS, ...DESIGN_TOOLS, PR_TEST_TOOL]) assert.equal(isStepCall(call(tool, "other", "x")), false, tool);
  assert.equal(isStepCall(call("Task", "task", "Opus: plan the change")), false, "asking Opus to plan is its own line");
  assert.equal(isStepCall(call("Task", "task", "Explore the code")), true);
  assert.equal(isStepCall(call("mcp__liner__design_frame", "other", "design_frame")), true, "the canvas tools are steps");
  // The canvas's words under way and done, the trail's both.
  const node = call("mcp__liner__design_node", "other", "design_node", { input: JSON.stringify({ frame: "brand-board", html: "<p>" }) });
  assert.equal(canvasFrame(node, "node"), "Brand board");
  assert.equal(canvasFrame(node, "node", (id) => (id === "brand-board" ? "Brand / Board" : undefined)), "Brand / Board");
  assert.deepEqual(canvasWords(node, "node", true, "Brand board"), { verb: "Changing", target: "Brand board" });
  assert.deepEqual(canvasWords(node, "node", false, "Brand board"), { verb: "Changed", target: "Brand board" });
  assert.deepEqual(canvasWords(node, "frame", true), { verb: "Drawing", target: "a frame" });
  assert.equal(readableFrame("brand-board~2"), "Brand board");
  assert.equal(readableFrame("Phone / Week"), "Phone / Week");
  assert.equal(KIND_WORDS.task[0], words(call("Task", "task", "task")));
  assert.equal(SIDEKICK_WORDS[0], words(call("liner.sidekick", "task", "x")));
});

test("words: a command by its program and at most two plain words, never a secret or a whole command line", () => {
  const ran = (command: string) => words(call("Bash", "exec", `Run ${command}`, { input: JSON.stringify({ command }) }));
  assert.equal(ran("git status"), "Running git status");
  assert.equal(ran("npm run build -- --prod"), "Running npm run build");
  assert.equal(ran("npm run build:web extra more"), "Running npm run build:web", "two words after the program at most");
  assert.equal(ran('curl -H "Authorization: Bearer sk-ant-api03-SECRETSECRET" https://api.example.com/v1'), "Running curl", "a flag ends it, and the token after it is never said");
  assert.equal(ran("GITHUB_TOKEN=ghp_abcdefghijklmnop npm publish --otp 123456"), "Running npm publish", "NAME=value before it is passed over");
  assert.equal(ran("export OPENAI_API_KEY=sk-123; node scripts/seed.js"), "Running node", "a path isn't said");
  assert.equal(ran("cd /Users/someone/Project/secret-client && npm test"), "Running npm test", "cd … && is passed over");
  assert.equal(ran("psql postgres://admin:hunter2@db.internal:5432/prod -c 'select 1'"), "Running psql", "a URL with a password in it isn't a plain word");
  assert.equal(ran("echo ghp_abcdefghijklmnopqrstuvwxyz0123456789"), "Running echo", "a long token isn't a plain word");
  assert.equal(ran("/usr/local/bin/python3 -m pytest -k secret"), "Running python3 -m pytest", "the program without its folder, and Python's module");
  assert.equal(ran("python3 manage.py runserver"), "Running python3", "nothing else after Python");
  assert.equal(ran("node -e \"console.log(1)\"\nnpm test\nrm -rf build"), "Running node", "the first line only");
  assert.equal(ran("cat <<'EOF' > notes.md\nline one\nEOF"), "Running cat");
  // Codex reports the command as an array, wrapped in a shell.
  assert.equal(words(call("shell", "exec", "shell", { input: JSON.stringify({ command: ["bash", "-lc", "cd app && pnpm test --run"] }) })), "Running pnpm test");
  assert.equal(doingCommand("/bin/zsh -c 'yarn lint'"), "yarn lint");
  assert.equal(doingCommand(""), "");
  // Words after the program only where they are subcommands by convention: anything else could be a password.
  assert.equal(ran("echo hunter2 | sudo -S ls"), "Running echo");
  assert.equal(ran("sshpass hunter2pass ssh host"), "Running sshpass");
  assert.equal(ran("mysql -u root -phunter2"), "Running mysql");
  assert.equal(ran('curl -H "Authorization: Bearer x" https://api.example.com'), "Running curl");
  assert.equal(ran("openssl passwd hunter2"), "Running openssl");
  assert.equal(ran('git commit -m "secret words"'), "Running git commit");
  assert.equal(ran("npm run build -- --token abc"), "Running npm run build");
  assert.equal(ran("docker compose up -d"), "Running docker compose up");
  assert.equal(ran("docker run hunter2"), "Running docker run", "docker run takes one word");
  assert.equal(ran("gh pr view 12"), "Running gh pr view");
  assert.equal(ran("kubectl apply -f x.yaml"), "Running kubectl apply");
  assert.equal(ran("npx prettier --check ."), "Running npx prettier");
  assert.equal(ran("pnpm dlx create-vite app"), "Running pnpm dlx create-vite");
  assert.equal(ran("vitest run hunter2"), "Running vitest");
  assert.equal(ran("sudo -u root npm test"), "Running npm test", "sudo and its flags are passed over");
  assert.equal(ran("env -i TOKEN=abc time nohup make deploy"), "Running make deploy", "env, time and nohup too");
  assert.equal(ran("sudo -S"), "Running a command", "nothing plain after sudo");
  // Quotes are read as the shell reads them: nothing inside them is ever a program or a word said.
  const probes: [string, string][] = [
    ["PGPASSWORD='correct horse battery' psql -h db", "Running psql"],
    ["TOKEN='abc def' npm test", "Running npm test"],
    ["export PASSWORD='p@ss|word123' && psql", "Running psql"],
    ['export TOKEN="abc;def"; curl x', "Running curl"],
    ["cd 'my dir; x' && npm test", "Running npm test"],
    ['GIT_AUTHOR_NAME="Jane Doe" git commit -m x', "Running git commit"],
    ['env -S "sshpass secret ssh"', "Running a command"],
    ["sudo --user root x", "Running x"],
    ["sudo --user=root npm test", "Running npm test"],
    ["sudo --frobnicate root npm test", "Running a command"],
    ['"C:\\Program Files\\nodejs\\node.exe" x', "Running node"],
    ["C:\\Program Files\\nodejs\\node.exe x", "Running a command"],
    ["'npm test'", "Running a command"],
    ["echo 'unclosed", "Running a command"],
    ["$(cat secret) --flag", "Running a command"],
    ["`cat secret` x", "Running a command"],
    ["TOKEN=$(cat secret) npm test", "Running a command"],
    ['npm test -- "$(cat secret)"', "Running npm test"],
    ["FOO=bar npm test", "Running npm test"],
    ["cd app && npm run build", "Running npm run build"],
    ["bash -lc 'npm test'", "Running npm test"],
    ['bash -c "$(curl -s https://x.sh)"', "Running a command"],
    ['"/usr/local/bin/node" script.js', "Running node"],
    ["sudo -u root npm test", "Running npm test"],
    ["npm test 2>&1 | tail -5", "Running npm test"],
  ];
  for (const [command, want] of probes) assert.equal(ran(command), want, command);
  assert.equal(doingCommand("API_KEY=x"), "", "nothing but a value: nothing to say");
});

test("words: a run of dots not at the end costs nothing (the cut's end rule never backtracks), and dots at the end still go", () => {
  const dots = `Reading a${".".repeat(10_000)}b`;
  let t = performance.now();
  cutDoing(dots);
  cutDoing(`${dots}...…`);
  words(call("mcp__liner__design_frame", "other", "design_frame", { input: JSON.stringify({ name: `Phone ${".".repeat(10_000)} Week` }) }));
  words(call("Read", "read", "Read x", { path: `src/a${".".repeat(10_000)}b.ts` }));
  assert.ok(performance.now() - t < 50, `took ${Math.round(performance.now() - t)} ms`);
  assert.equal(cutDoing("Reading the files....…."), "Reading the files");
  assert.equal(cutDoing("Reading a.b"), "Reading a.b");
});

test("words: long names are cut at a word with nothing after, or said plainer; every line keeps the rules", () => {
  const long = `${"a-very-long-generated-file-name-".repeat(3)}.ts`;
  assert.equal(words(call("Read", "read", `Read ${long}`, { path: `/abs/${long}` })), "Reading a file", "a name too long for the line");
  assert.equal(words(call("Edit", "edit", "Edit x", { path: `src/${long}` })), "Changing a file");
  const frame = "Phone / Week view with the spring tides and the neap tides side by side";
  const cut = words(call("mcp__liner__design_frame", "other", "design_frame", { input: JSON.stringify({ name: frame }) }));
  plain(cut);
  assert.ok(frame.startsWith(cut!.replace(/^Drawing /, "")) && !cut!.endsWith(" "), `cut at a word: ${cut}`);
  assert.equal(cutDoing("Reading the files."), "Reading the files");
  assert.equal(cutDoing("Reading the files…"), "Reading the files");
  assert.equal(cutDoing("Reading\nthe   files"), "Reading the files");
  assert.equal(cutDoing("Drawing " + "x".repeat(80)).length <= DOING_MAX, true);
  const many = [
    call("Read", "read", "Read /Users/someone/.ssh/id_ed25519", { path: "/Users/someone/.ssh/id_ed25519" }),
    call("Bash", "exec", "Run thing", { input: `${"x".repeat(200)} --token abc` }),
    call("Bash", "exec", "Run", { input: JSON.stringify({ command: "a\nb\nc" }) }),
    call("mcp__liner__server_start", "other", `Run ${"web ".repeat(40)}from launch.json`),
    call("Search", "search", "Search for password=hunter2"),
    call("Whatever", "other", "Do a thing."),
  ];
  for (const c of many) plain(words(c));
  assert.equal(words(many[0]), "Reading id_ed25519", "a file by its name alone, never its folder");
  // A name is said only when it is a plain file name: never from a URL, never with a value in it.
  assert.equal(words(call("Read", "read", "Read https://host/x?token=abc")), "Reading a file");
  assert.equal(words(call("Read", "read", "Read https://host/notes.md")), "Reading a file");
  assert.equal(words(call("Read", "read", "Read x?token=abc")), "Reading a file");
  assert.equal(words(call("Edit", "edit", "Edit a=b&c.ts")), "Changing a file");
  assert.equal(words(call("Read", "read", "Read", { path: "C:\\Program Files\\app\\main (copy).ts" })), "Reading main (copy).ts");
  assert.equal(words(call("Read", "read", "Read", { path: "C:\\Program Files\\app\\" })), "Reading app");
  assert.equal(words(call("mcp__liner__design_frame", "other", "design_frame", { input: JSON.stringify({ name: "Phone?token=abc" }) })), "Drawing a frame");
  assert.equal(words(call("mcp__liner__server_start", "other", "Run https://x.dev/?k=1 from launch.json")), "Starting a server");
  assert.doesNotMatch(words(many[4])!, /hunter2/);
});

/** Claude Code, faked: each turn runs `work`. */
function fake(work: (text: string, sink: TurnSink, signal: AbortSignal) => Promise<void>) {
  const make: Provider = {
    id: "claude",
    detect: async () => ready[0],
    open: (_o: OpenOptions) => ({ turn: (text, sink, signal) => work(text, sink, signal), close() {} }),
  };
  const saved = providers.claude;
  providers.claude = make;
  return () => (providers.claude = saved);
}

function session(extra: Partial<Thread> = {}, doingMs = 0) {
  const home = mkdtempSync(join(tmpdir(), "lc-doing-"));
  const dir = mkdtempSync(join(tmpdir(), "lc-doing-dir-"));
  const store = new Store(home);
  store.putProject({ id: "p", name: "p", path: dir, git: false, createdAt: Date.now() });
  store.putThread({ id: "t", projectId: "p", title: "New session", agent: "forge", status: "idle", access: "full", turns: 0, usage: emptyUsage(), createdAt: Date.now(), updatedAt: Date.now(), ...extra });
  const runtime = new Runtime(store, process.env);
  runtime.providerInfo = ready;
  runtime.doingMs = doingMs;
  // Every doing line the app is sent, in order ("" when it's cleared).
  const said: string[] = [];
  let last: string | undefined;
  store.on((e) => {
    if (e.type !== "thread" || e.thread.id !== "t" || e.thread.doing?.text === last) return;
    last = e.thread.doing?.text;
    said.push(last ?? "");
    if (e.thread.doing && e.thread.status !== "running") throw new Error(`doing on a session that is ${e.thread.status}`);
  });
  return { store, runtime, said, home };
}

async function until(ok: () => boolean, what: string) {
  for (let i = 0; i < 300 && !ok(); i++) await tick();
  assert.ok(ok(), what);
}
const step = (sink: TurnSink, key: string, tool: string, toolKind: "read" | "edit" | "exec" | "task" | "other", title: string, status: "running" | "done" = "running", more: object = {}) => sink.tool({ key, tool, toolKind, title, status, ...more });

test("a turn: each step says what it does as it starts, and it's gone the moment the turn ends", async () => {
  let seenRunning = "";
  const restore = fake(async (_t, sink) => {
    sink.reasoning("Let me look.", "r1");
    step(sink, "1", "Read", "read", "Read src/tides.js", "running", { path: "src/tides.js" });
    step(sink, "1", "Read", "read", "Read src/tides.js", "done", { path: "src/tides.js" });
    step(sink, "2", "Read", "read", "Read src/b.js", "running", { path: "src/b.js" });
    step(sink, "2", "Read", "read", "Read src/b.js", "done", { path: "src/b.js" });
    step(sink, "3", "Edit", "edit", "edit");
    // OpenCode names the file only after it starts.
    step(sink, "3", "Edit", "edit", "Edit src/tides.js", "running", { path: "src/tides.js" });
    step(sink, "4", "Bash", "exec", "Run npm test", "running", { input: "npm test" });
    await tick(5);
    seenRunning = String(store.thread("t").doing?.text);
  });
  const { store, runtime, said } = session();
  try {
    await runtime.send("t", "fix it");
    assert.equal(seenRunning, "Running npm test", "the thread says it while the step runs");
    assert.deepEqual(said, ["Thinking", "Reading tides.js", "Reading 2 files", "Changing a file", "Editing tides.js", "Running npm test", ""]);
    assert.equal(store.thread("t").doing, undefined);
    assert.equal(store.thread("t").status, "done");
  } finally {
    restore();
  }
});

test("thinking: said before any step, and after a finished step only once its words have stood thinkMs; a short think between steps shows nothing", async () => {
  const restore = fake(async (_t, sink) => {
    sink.reasoning("First, a look.", "r0");
    await tick(20);
    step(sink, "1", "Read", "read", "Read a.ts", "running", { path: "a.ts" });
    step(sink, "1", "Read", "read", "Read a.ts", "done", { path: "a.ts" });
    // A short think, then the next step: nothing new is said for it.
    sink.reasoning("Now the edit.", "r1");
    await tick(20);
    step(sink, "2", "Edit", "edit", "Edit a.ts", "running", { path: "a.ts" });
    // A think while a step still runs (a tool that reasons alongside) isn't said either, however long.
    sink.reasoning("While it edits.", "r2");
    await tick(150);
    step(sink, "2", "Edit", "edit", "Edit a.ts", "done", { path: "a.ts" });
    // A long think after a finished step: said once its words have stood thinkMs.
    sink.reasoning("That was harder than it looked.", "r3");
    await tick(200);
    step(sink, "3", "Bash", "exec", "Run npm test", "running", { input: "npm test" });
    // A think left waiting when the turn ends is never said.
    step(sink, "3", "Bash", "exec", "Run npm test", "done", { input: "npm test" });
    sink.reasoning("Done, I think.", "r4");
  });
  const { runtime, said } = session();
  runtime.thinkMs = 100;
  try {
    await runtime.send("t", "go");
    await tick(150);
    assert.deepEqual(said, ["Thinking", "Reading a.ts", "Editing a.ts", "Thinking", "Running npm test", ""]);
  } finally {
    restore();
  }
});

test("writing the answer: said before any step, and after a finished step only once its words have stood thinkMs; a short line between steps shows nothing", async () => {
  const restore = fake(async (_t, sink) => {
    step(sink, "1", "Read", "read", "Read a.ts", "running", { path: "a.ts" });
    step(sink, "1", "Read", "read", "Read a.ts", "done", { path: "a.ts" });
    // A line of text between two steps: nothing new is said.
    sink.text("Now the edit.", "a1");
    await tick(20);
    step(sink, "2", "Bash", "exec", "Run npm test", "running", { input: "npm test" });
    step(sink, "2", "Bash", "exec", "Run npm test", "done", { input: "npm test" });
    // A long final answer: said once the step's words have stood thinkMs.
    sink.text("All passing. Here is what changed", "a2");
    await tick(200);
    sink.text(", and why.", "a2");
  });
  const { runtime, said } = session();
  runtime.thinkMs = 100;
  try {
    await runtime.send("t", "go");
    await tick(150);
    assert.deepEqual(said, ["Reading a.ts", "Running npm test", "Writing its answer", ""], "and nothing after the turn ends");
  } finally {
    restore();
  }
});

test("writing the answer: a turn with no steps says so at once; one that ends before the time is up says nothing more", async () => {
  const restore = fake(async (_t, sink) => {
    sink.text("Just an answer.", "a1");
    await tick(20);
  });
  const { runtime, said } = session();
  runtime.thinkMs = 100;
  try {
    await runtime.send("t", "go");
    assert.deepEqual(said, ["Writing its answer", ""]);
  } finally {
    restore();
  }
  const quick = fake(async (_t, sink) => {
    step(sink, "1", "Bash", "exec", "Run npm test", "running", { input: "npm test" });
    step(sink, "1", "Bash", "exec", "Run npm test", "done", { input: "npm test" });
    sink.text("Done.", "a1");
  });
  const again = session();
  again.runtime.thinkMs = 100;
  try {
    await again.runtime.send("t", "go");
    await tick(200);
    assert.deepEqual(again.said, ["Running npm test", ""], "a waiting line is never said after the turn ends");
  } finally {
    quick();
  }
});

test("throttled: at most one line about every doingMs, the latest wins, nothing when the words didn't change; clearing isn't held", async () => {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const restore = fake(async (_t, sink) => {
    step(sink, "1", "Read", "read", "Read a.ts", "running", { path: "a.ts" });
    step(sink, "2", "Bash", "exec", "Run ls", "running", { input: "ls" });
    step(sink, "3", "Bash", "exec", "Run git status", "running", { input: "git status" });
    step(sink, "4", "Edit", "edit", "Edit b.ts", "running", { path: "b.ts" });
    await held;
    // Then the same words again: nothing is sent.
    step(sink, "5", "Edit", "edit", "Edit b.ts", "running", { path: "b.ts" });
    // A step just before the turn ends: its line waits out the time, and the end clears it at once all the same.
    step(sink, "6", "Bash", "exec", "Run npm test", "running", { input: "npm test" });
  });
  const { store, runtime, said } = session({}, 150);
  try {
    const going = runtime.send("t", "go");
    await until(() => said.length === 1, "the first step is said at once");
    assert.deepEqual(said, ["Reading a.ts"]);
    await tick(60);
    assert.deepEqual(said, ["Reading a.ts"], "the next waits out the time");
    await until(() => said.length === 2, "then the latest goes");
    assert.deepEqual(said, ["Reading a.ts", "Editing b.ts"], "the steps between are passed over");
    release();
    await going;
    assert.deepEqual(said, ["Reading a.ts", "Editing b.ts", ""], "the same words aren't sent again, and the end clears without waiting");
    await tick(200);
    assert.deepEqual(said, ["Reading a.ts", "Editing b.ts", ""], "nothing waiting goes after the end");
    assert.equal(store.thread("t").doing, undefined);
  } finally {
    restore();
  }
});

test("Stop clears it at once, before the turn has wound down", async () => {
  const restore = fake(async (_t, sink, signal) => {
    step(sink, "1", "Bash", "exec", "Run npm test", "running", { input: "npm test" });
    // A tool slow to hear Stop, and a word from it after.
    while (!signal.aborted) await tick(5);
    await tick(40);
    step(sink, "2", "Read", "read", "Read a.ts", "running", { path: "a.ts" });
  });
  const { store, runtime, said } = session();
  try {
    const going = runtime.send("t", "go");
    await until(() => store.thread("t").doing?.text === "Running npm test", "it runs the tests");
    runtime.stop("t");
    assert.equal(store.thread("t").doing, undefined, "gone when Stop is pressed");
    assert.ok(runtime.isRunning("t"), "while the turn still winds down");
    await going;
    assert.deepEqual(said, ["Running npm test", ""], "nothing it did after Stop is said");
  } finally {
    restore();
  }
});

test("a problem, a thrown turn and a limit each clear it at once", async () => {
  for (const how of ["error", "throw", "limit"] as const) {
    let after = "";
    const restore = fake(async (_t, sink) => {
      step(sink, "1", "Bash", "exec", "Run npm test", "running", { input: "npm test" });
      if (how === "error") sink.error("The model is overloaded.");
      if (how === "limit") sink.limited("You've hit your limit.", Date.now() + 3_600_000);
      if (how === "throw") throw new Error("The tool broke off.");
      after = String(store.thread("t").doing?.text);
      await tick(20);
    });
    const { store, runtime, said } = session();
    try {
      await runtime.send("t", "go");
      if (how !== "throw") assert.equal(after, "undefined", `${how}: gone as soon as it's said`);
      assert.deepEqual(said, ["Running npm test", ""], how);
      assert.equal(store.thread("t").doing, undefined, how);
      assert.equal(store.thread("t").status, how === "limit" ? "limited" : "error", how);
    } finally {
      restore();
    }
  }
});

test("waiting on you: a permission card or a question clears it; an allowed step says so again, after a question it thinks", async () => {
  const restore = fake(async (_t, sink, signal) => {
    step(sink, "1", "Bash", "exec", "Run npm test", "running", { input: "npm test" });
    const a = await sink.approve({ key: "1", tool: "Bash", title: "Run npm test", risk: "low", fields: [{ label: "Command", value: "npm test" }] }, signal);
    assert.ok(a.allow);
    await tick(20);
    step(sink, "2", "Read", "read", "Read a.ts", "running", { path: "a.ts" });
    await sink.ask([{ question: "Which file?", options: [{ label: "a" }, { label: "b" }] }], signal);
    await tick(20);
  });
  const { store, runtime, said } = session({ access: "ask" });
  try {
    const going = runtime.send("t", "go");
    await until(() => store.timeline("t").some((x) => x.kind === "approval" && x.state === "asking"), "it asks to run the tests");
    assert.equal(store.thread("t").status, "waiting");
    assert.equal(store.thread("t").doing, undefined, "a session waiting on you says nothing of the step");
    runtime.answer("t", store.timeline("t").find((x) => x.kind === "approval")!.id, true);
    assert.equal(store.thread("t").doing?.text, "Running npm test", "allowed, the command runs, and says so");
    await until(() => store.timeline("t").some((x) => x.kind === "question" && x.state === "asking"), "it asks a question");
    assert.equal(store.thread("t").doing, undefined, "a question clears it too");
    runtime.answerQuestion("t", store.timeline("t").find((x) => x.kind === "question")!.id, { "Which file?": "a" });
    await going;
    assert.deepEqual(said, ["Running npm test", "", "Running npm test", "Reading a.ts", "", "Thinking", ""], "the step before the question is over");
    assert.equal(store.thread("t").doing, undefined);
  } finally {
    restore();
  }
});

test("waiting on you: a refused step is over, so it thinks rather than say the step again", async () => {
  const restore = fake(async (_t, sink, signal) => {
    step(sink, "1", "Bash", "exec", "Run rm -rf build", "running", { input: "rm -rf build" });
    const a = await sink.approve({ key: "1", tool: "Bash", title: "Run rm -rf build", risk: "high", fields: [{ label: "Command", value: "rm -rf build" }] }, signal);
    assert.equal(a.allow, false);
    await tick(20);
  });
  const { store, runtime, said } = session({ access: "ask" });
  try {
    const going = runtime.send("t", "go");
    await until(() => store.timeline("t").some((x) => x.kind === "approval" && x.state === "asking"), "it asks");
    runtime.answer("t", store.timeline("t").find((x) => x.kind === "approval")!.id, false);
    assert.equal(store.thread("t").doing?.text, "Thinking");
    await going;
    assert.deepEqual(said, ["Running rm", "", "Thinking", ""]);
  } finally {
    restore();
  }
});

test("a turn whose first call isn't a step (a plan, a page) still says Thinking", async () => {
  const restore = fake(async (_t, sink) => {
    sink.tool({ key: "p", tool: "mcp__liner__show_page", toolKind: "other", title: "Show a page", status: "running" });
    sink.reasoning("Let me think about the page.", "r1");
    await tick(20);
  });
  const { runtime, said } = session();
  try {
    await runtime.send("t", "go");
    assert.deepEqual(said, ["Thinking", ""]);
  } finally {
    restore();
  }
});

test("a session put in waiting, done or error by any path never keeps its line", () => {
  const { store } = session();
  store.patchThread("t", { status: "running" });
  store.setDoing("t", { text: "Running npm test" });
  assert.equal(store.thread("t").doing?.text, "Running npm test");
  const at = store.thread("t").updatedAt;
  store.setDoing("t", { text: "Reading a.ts" });
  assert.equal(store.thread("t").updatedAt, at, "a line doesn't move the session in the sidebar");
  for (const status of ["waiting", "done", "error", "limited", "idle"] as const) {
    store.patchThread("t", { status: "running" });
    store.setDoing("t", { text: "Running npm test" });
    store.patchThread("t", { status });
    assert.equal(store.thread("t").doing, undefined, status);
    store.setDoing("t", { text: "Reading a.ts" });
    assert.equal(store.thread("t").doing, undefined, `${status}: not set while it isn't running`);
  }
});

test("after the engine starts again no session has a line, even one saved alongside another change", () => {
  const { store, home } = session();
  store.patchThread("t", { status: "running" });
  store.setDoing("t", { text: "Running npm test" });
  // Another change saves the session with its line on it.
  store.patchThread("t", { title: "Tides" });
  store.flush();
  const again = new Store(home);
  assert.equal(again.thread("t").doing, undefined);
  assert.equal(again.thread("t").title, "Tides");
});

test("the lead's steps say it: an agent's own calls, and an agent's row as it reports, don't", async () => {
  const restore = fake(async (_t, sink) => {
    // The lead sends an agent off.
    sink.tool({ key: "a", tool: "Task", toolKind: "task", title: "Look through the tests", status: "running", agent: { name: "Explore", task: "Look through the tests", state: "running" } });
    // An agent that agent sent, with steps of its own.
    sink.tool({ key: "b", tool: "Task", toolKind: "task", title: "Read the fixtures", status: "running", agent: { name: "Explore", task: "Read the fixtures", state: "running", parentKey: "a" } });
    step(sink, "1", "Read", "read", "Read src/tides.js", "running", { path: "src/tides.js" });
    // The first agent reports a step on its row: the lead is still reading.
    sink.tool({ key: "a", tool: "Task", toolKind: "task", title: "Look through the tests", status: "running", agent: { name: "Explore", task: "Look through the tests", state: "running", steps: [{ title: "Run npm test", toolKind: "exec", status: "running" }] } });
    sink.tool({ key: "a", tool: "Task", toolKind: "task", title: "Look through the tests", status: "done", agent: { name: "Explore", task: "Look through the tests", state: "done" } });
    await tick(5);
  });
  const { runtime, said } = session();
  try {
    await runtime.send("t", "go");
    assert.deepEqual(said, ["Sending an agent", "Reading tides.js", ""]);
  } finally {
    restore();
  }
});

test("the Demo says what it does too, and nothing once it's done", async () => {
  const { store, runtime, said } = session({ agent: "@demo:demo" }, 0);
  await runtime.send("t", "Fix the tide time after midnight");
  for (const s of said.filter(Boolean)) plain(s);
  for (const want of ["Thinking", "Reading tides.js", "Searching the code", "Editing tides.js", "Running npm test"]) assert.ok(said.includes(want), `${want} in ${said.join(" / ")}`);
  assert.equal(said.at(-1), "", "cleared at the end");
  assert.equal(store.thread("t").doing, undefined);
  assert.equal(store.thread("t").status, "done");
});
