/*
  What a session is doing right now, in a few plain words: the sidebar's second line while a turn runs (Thread.doing).
  The engine asks doingOf as each step of the lead's turn starts. Its verbs are those the session's own trail uses
  (trailSteps in ui/src/app/Timeline.tsx), said as under way: "Reading Sidebar.tsx", "Running npm test", "Drawing Phone /
  Week". Nothing secret or long gets into them: a file by its name alone, a command by its program and at most two
  plain words after it, never a whole command line.

  This file is also the one place a step's words come from for the trail and Liner Design's chat (Timeline.tsx,
  design/Chat.tsx): what is a step and what is a card (isStepCall), which tools are Liner's own (BROWSER_TOOL and the
  rest), the words for a canvas step, a frame, a file, a command and a tool by its name, and each step's kind (stepKind),
  which gives it its mark. The trail adds what only it
  shows (the whole command, a search's pattern, a call's own title, how a step ended); the line holds to the rule above.
  What a session waits on you for (Thread.asking, askingOf) is said here too, by the same rules.
  Nothing here may use Node's or the browser's own objects: the engine and the interface both load it.
*/

/** What doingOf reads of a tool call: the fields a timeline's tool row and a provider's update share. */
export type DoingCall = { tool: string; toolKind: string; title: string; input?: string; path?: string };
/** Turns a frame's id in a design file into its name, when the engine can say it. */
export type DoingFrameNamer = (frame: string, design: string) => string | undefined;

/** The longest a doing line runs, in characters. */
export const DOING_MAX = 48;

/** The PR card's own tool: its run of the project's tests on this Mac, and the request to run them. */
export const PR_TEST_TOOL = "liner.test";
/** Cards of their own in the trail, not steps: a question, a plan handed over, a page shown. */
export const CARD_TOOLS = new Set(["AskUserQuestion", "ExitPlanMode", "mcp__liner__show_page", "liner.show_page"]);
/**
  Showing a design, under each way a tool names it (OpenCode's is liner_design_show): never a step, and its card once the
  turn has one. Liner Design's canvas tools (design_frame, design_node and the rest) aren't here on purpose: they draw on
  the canvas, which has no card, so each is a step.
*/
export const DESIGN_TOOLS = new Set(["mcp__liner__design_show", "liner.design_show", "liner_design_show"]);
/** A call the trail draws as a step and the doing line speaks for: not a card of its own, nor the PR card's test run, nor asking Opus to plan (its own line). */
export const isStepCall = (c: DoingCall) => !CARD_TOOLS.has(c.tool) && !DESIGN_TOOLS.has(c.tool) && c.tool !== PR_TEST_TOOL && !(c.toolKind === "task" && /^Opus\b/.test(c.title));
/** Liner Code's own Browser tools, under either way an agent tool names them; the action after browser_. */
export const BROWSER_TOOL = /^(?:mcp__liner__|liner\.)browser_(\w+)/;
/** Its dev servers from launch.json, the same way; the action after server_. */
export const SERVER_TOOL = /^(?:mcp__liner__|liner\.)server_(\w+)/;
/** Liner Design's canvas tools, by any tool's name for them (Claude Code's mcp__liner__, ACP's liner., OpenCode's liner_, Antigravity's mcp_liner_). */
export const CANVAS_TOOL = /^(?:mcp__liner__|mcp_liner_|liner\.|liner_)?design_(files|frame|tree|node|selection|shot|picture|built)$/;
/** A lead's brief to its sidekick (Liner's sidekick tool, under any tool's name for it). */
export const SIDEKICK_TOOL = /(?:^|[._])sidekick$/;
/** A frame's file in a design file: .liner/designs/<file>/frames/<id>.html. */
export const FRAME_FILE = /\.liner\/designs\/([^/]+)\/frames\/([^/]+)\.html$/;
/** A title that is only a tool's kind, or nothing. */
const BARE = /^(?:edit|write|delete|move|execute|exec|bash|shell|read|search|grep|glob|fetch|web|think|other|task|tool|use a tool)?$/i;
/** A title that says nothing a person could use: only the tool's kind ("edit", "execute": OpenCode's before it says more), or nothing. */
export const bareTitle = (title?: string) => BARE.test((title ?? "").trim());
const bare = bareTitle;
/** A step whose call says only its kind, by that kind: under way, and done. The sidebar counts agents at work by "Sending an agent" (Sidebar.tsx). */
export const KIND_WORDS: Record<string, [string, string]> = { think: ["Thinking", "Thought it through"], fetch: ["Reading a page", "Read a page"], web: ["Reading the web", "Read the web"], task: ["Sending an agent", "Sent an agent"] };
/**
  A lead's brief, as the step under way and done: what the sidekick does is its own part. Working, not waiting, under way:
  in the sidebar and the chat's header "waiting" is for a session waiting on you.
*/
export const SIDEKICK_WORDS: [string, string] = ["Working with its sidekick", "Handed work to its sidekick"];

const slashed = (p: string) => p.replace(/\\/g, "/");
/** A path's last part (either slash), a folder's too: the name a file is called by. */
export const stepFileName = (p: string) => slashed(p).replace(/\/+$/, "").split("/").pop() || p;
const baseName = stepFileName;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
/** A call's input as an object, when it is JSON; else nothing in it. */
export const callInput = (c: Pick<DoingCall, "input">): Record<string, unknown> => {
  try {
    const j = JSON.parse(c.input ?? "") as unknown;
    return j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};
const inputOf = callInput;
/** The path a call is about: its own, else a path in its input, else its title without the verb (a real title only). Not yet a name to say. */
export function callPath(c: DoingCall, verb: RegExp) {
  const i = inputOf(c);
  return c.path ?? str(i.file_path) ?? str(i.filePath) ?? str(i.path) ?? str(i.file) ?? str(i.filename) ?? (bare(c.title) ? undefined : c.title.replace(verb, "").trim() || undefined);
}
/**
  Another tool, by its name when that is a word: an MCP server's own name ("github" for mcp__github__create_issue), never
  Liner's, else the tool's own short name. Undefined when it has none worth saying.
*/
export function toolNameOf(tool: string) {
  const server = /^mcp__([a-z0-9-]+)__/i.exec(tool)?.[1];
  if (server && server !== "liner" && PROGRAM.test(server)) return server;
  if (!/^(?:mcp_|liner)/.test(tool) && /^[A-Za-z][A-Za-z0-9_-]{0,23}$/.test(tool) && !bare(tool)) return tool;
  return undefined;
}
/** One line, no control characters, no "…" or full stop at the end. */
const oneLine = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
/** Without the full stops and "…" at its end, walked from the end: an end-anchored regex tries every run of dots it meets, slow on thousands of them. */
const noDots = (s: string) => {
  let i = s.length;
  while (i > 0 && (s[i - 1] === "." || s[i - 1] === "…")) i--;
  return s.slice(0, i);
};
/** At most DOING_MAX characters, cut at a word with nothing put after it, and no full stop or "…" at the end. */
export function cutDoing(text: string) {
  let s = noDots(oneLine(text)).trim();
  if (s.length > DOING_MAX) {
    const cut = s.slice(0, DOING_MAX + 1);
    const at = cut.lastIndexOf(" ");
    s = (at > 0 ? cut.slice(0, at) : s.slice(0, DOING_MAX)).replace(/[\s,;:·/–-]+$/, "");
  }
  return noDots(s).trim();
}
/**
  A verb and what it touches. Past the line, a name of several words is cut at a word ("Drawing Phone / Week view with
  the…" without the "…"); one long word (a generated file name) gives way to the plainer words.
*/
function said(verb: string, target: string | undefined, plainer: string) {
  const t = target ? oneLine(target) : "";
  if (!t) return plainer;
  const full = `${verb} ${t}`;
  if (full.length <= DOING_MAX) return full;
  const cut = cutDoing(full);
  return / /.test(t) && cut.length > verb.length + 1 ? cut : plainer;
}

/** A file's name worth saying: letters, digits, `. _ - + @ ( )` and spaces. Nothing that could carry a value (`? = & : %`). */
const FILE_NAME = /^[\p{L}\p{N}._+@() -]{1,200}$/u;
/** A frame's or a server's name worth saying: as a file's, and the slashes and dashes of names like "Phone / Week". */
const NAME = /^[\p{L}\p{N}._+@() /·'’–—-]{1,200}$/u;
/** A name as a target, or nothing: never one from a URL, never one with a value in it. */
const safe = (name: string | undefined, rule = NAME) => (name && !/:\/\//.test(name) && rule.test(name.trim()) ? name.trim() : undefined);
/** The file a call is about, by its name alone (its path's, else a path's in its input, else its title's without the verb), when that name is plain. */
function fileOf(c: DoingCall, verb: RegExp) {
  const p = callPath(c, verb);
  if (!p || /:\/\//.test(p)) return undefined;
  return safe(baseName(p), FILE_NAME);
}

/** The command a call ran: Claude Code reports its input as JSON, Codex and the rest as the command; "" when nothing names it. */
export function callCommand(c: DoingCall) {
  const raw = c.input ?? "";
  try {
    const j = JSON.parse(raw) as { command?: unknown; cmd?: unknown };
    const v = j?.command ?? j?.cmd;
    if (typeof v === "string") return v;
    // An array (Codex's) is joined with each part quoted as the shell would need, so its words stay its words.
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v.map((x: string) => (/^[\w@%+=:,./-]+$/.test(x) ? x : `'${x.replace(/'/g, "'\\''")}'`)).join(" ");
    if (j && typeof j === "object") return "";
  } catch {
    // the command itself
  }
  return raw || (bare(c.title) ? "" : c.title.replace(/^Run\s+/, ""));
}

/** A word after the program that is worth saying: a plain subcommand or script name, never a flag, a path, a value or anything long. */
const PLAIN_WORD = /^[a-z][a-z0-9:_-]{0,19}$/i;
/** A program's name: a plain word (its folder dropped). */
const PROGRAM = /^[a-z0-9][a-z0-9._+-]{0,23}$/i;
/** Commands whose plain words say more than their program: what the trail's reader would call them. */
const KNOWN: [RegExp, string][] = [[/^gh pr create$/, "Opening a pull request"]];

/**
  How many plain words after a program are said, by program: only those whose next words are subcommands or script names
  by convention ("npm run build", "git status", "docker compose up"). `first` is the first word after the program, for
  programs that take a second only after some first words. Any program not here is named alone, since what follows it
  could be anything, a password included ("echo hunter2", "sshpass hunter2pass ssh host").
*/
const SUBCOMMANDS: Record<string, (first?: string) => number> = {
  npm: (f) => (f === "run" || f === "run-script" ? 2 : 1),
  pnpm: (f) => (f === "run" || f === "dlx" ? 2 : 1),
  yarn: (f) => (f === "run" ? 2 : 1),
  bun: (f) => (f === "run" ? 2 : 1),
  npx: () => 1,
  bunx: () => 1,
  git: () => 1,
  gh: () => 2,
  cargo: () => 1,
  go: () => 1,
  make: () => 1,
  docker: (f) => (f && /^(?:compose|image|container|network|volume|system|buildx|builder|context)$/.test(f) ? 2 : 1),
  "docker-compose": () => 1,
  kubectl: () => 1,
  brew: () => 1,
  pip: () => 1,
  pip3: () => 1,
  uv: (f) => (f === "run" || f === "pip" ? 2 : 1),
};
/**
  Programs that run another, passed over to the program they run, with their flags. `value`: flags that take a value
  (`-u root`, `--user root`, `--user=root`); `alone`: flags that take none; `giveUp`: flags after which the program can't be
  told (env -S splits a string into a command). Any other flag after one of them gives up too: guessing could name a value.
*/
const WRAPPERS: Record<string, { value: string[]; alone: string[]; giveUp?: string[] }> = {
  sudo: {
    value: ["-u", "-g", "-h", "-p", "-C", "-D", "-R", "-T", "-U", "--user", "--group", "--host", "--prompt", "--close-from", "--chdir", "--chroot", "--command-timeout", "--other-user", "--role", "--type"],
    alone: ["-A", "-b", "-E", "-H", "-i", "-k", "-K", "-n", "-P", "-s", "-S", "-B", "--askpass", "--background", "--preserve-env", "--set-home", "--login", "--reset-timestamp", "--remove-timestamp", "--non-interactive", "--preserve-groups", "--shell", "--stdin", "--bell"],
  },
  env: { value: ["-u", "-C", "--unset", "--chdir"], alone: ["-i", "-0", "-", "--ignore-environment", "--null"], giveUp: ["-S", "--split-string"] },
  time: { value: ["-f", "-o", "--format", "--output"], alone: ["-p", "-v", "-l", "-a", "--portability", "--verbose", "--append"] },
  nohup: { value: [], alone: [] },
};
/** A Python module after -m: a plain dotted name. */
const MODULE = /^[a-z_][a-z0-9_.]{0,30}$/i;
/** A part that only sets the shell up for the next: passed over when choosing what the command does. */
const SETUP = new Set(["cd", "pushd", "popd", "export", "set", "unset", "source", ".", "alias"]);

/** A word of a command as the shell reads it: its value, and whether any of it was quoted or escaped. */
type ShellWord = { text: string; quoted: boolean };
/**
  A command read once, as a shell would: words, with quotes and backslashes taken into account, and parts split at
  `| || & && ;` and new lines only where they are outside quotes. `risky`: the index of the first word at or after which
  something can't be read safely (a `$(`, a backtick, a heredoc); `torn`: a quote that never closes.
*/
function shellParts(command: string): { parts: ShellWord[][]; risky: number; torn: boolean } {
  const parts: ShellWord[][] = [[]];
  let word: ShellWord | null = null;
  let count = 0;
  let risky = Infinity;
  const end = () => {
    if (word) parts[parts.length - 1].push(word), count++;
    word = null;
  };
  const cut = () => {
    end();
    if (parts[parts.length - 1].length) parts.push([]);
  };
  const add = (ch: string, quoted = false) => {
    word ??= { text: "", quoted: false };
    word.text += ch;
    if (quoted) word.quoted = true;
  };
  const hazard = () => (risky = Math.min(risky, count));
  const s = command.replace(/\r/g, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'") {
      const close = s.indexOf("'", i + 1);
      if (close < 0) return { parts, risky, torn: true };
      add(s.slice(i + 1, close), true);
      word!.quoted = true;
      i = close;
    } else if (ch === '"') {
      let j = i + 1;
      let text = "";
      for (; j < s.length && s[j] !== '"'; j++) {
        if (s[j] === "\\" && j + 1 < s.length && '"\\$`\n'.includes(s[j + 1])) text += s[++j];
        else {
          if (s[j] === "`" || (s[j] === "$" && s[j + 1] === "(")) hazard();
          text += s[j];
        }
      }
      if (j >= s.length) return { parts, risky, torn: true };
      add(text, true);
      word!.quoted = true;
      i = j;
    } else if (ch === "\\") {
      // An escaped character is the character; an escaped new line joins the lines.
      if (s[i + 1] === "\n") i++;
      else if (i + 1 < s.length) add(s[++i], true);
    } else if (ch === "`" || (ch === "$" && s[i + 1] === "(")) {
      hazard();
      add(ch);
    } else if (ch === "<" && s[i + 1] === "<") {
      hazard();
      add("<<");
      i++;
    } else if (ch === " " || ch === "\t") end();
    else if (ch === "\n" || ch === ";") cut();
    else if (ch === "|" || (ch === "&" && !/[<>]/.test(s[i - 1] ?? ""))) {
      if (s[i + 1] === ch) i++;
      cut();
    } else add(ch);
  }
  end();
  return { parts: parts.filter((p) => p.length), risky, torn: false };
}

/** A NAME=value word: a setting before a program (its value is never said). */
const assigns = (w: ShellWord) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(w.text);
/**
  A word as a program's name, or "": a plain unquoted name, or a path (quoted or not, Windows' too) whose last part is
  one. `.exe`, `.cmd` and `.bat` are left off.
*/
function programOf(w: ShellWord) {
  const plain = (n: string) => (PROGRAM.test(n) ? n.replace(/\.(?:exe|cmd|bat)$/i, "") : "");
  if (!w.quoted && PROGRAM.test(w.text)) return plain(w.text);
  if (/[\\/]/.test(w.text) && !/:\/\//.test(w.text)) return plain(baseName(w.text));
  return "";
}

/**
  A command as a few words: its program, and after it only the subcommand or script words its program is known for
  (SUBCOMMANDS), each a plain unquoted word, at most two. It is read as a shell reads it (shellParts), so nothing inside
  quotes is ever taken for a program or a word. A shell's -c is opened; parts that only set up (`cd … &&`, `export …;`),
  NAME=value and sudo / env / time / nohup before the program are passed over. "" when the program can't be named safely:
  a quote that never closes, a `$(`, a backtick or a heredoc before it, a wrapper's flag it doesn't know, or a program that
  isn't a plain name. For the doing line only: acp.ts's commandWords, which reads a command's every word for read checks,
  is another thing.
*/
export function doingCommand(command: string, depth = 0): string {
  const { parts, risky, torn } = shellParts(command);
  if (torn || depth > 3) return "";
  let seen = 0;
  for (const part of parts) {
    const start = seen;
    seen += part.length;
    let i = 0;
    while (i < part.length && assigns(part[i])) i++;
    if (i >= part.length || (!part[i].quoted && SETUP.has(part[i].text))) continue;
    // Past sudo, env, time and nohup, with their flags and settings.
    for (let wrap = WRAPPERS[programOf(part[i])]; wrap; wrap = WRAPPERS[programOf(part[i])]) {
      i++;
      while (i < part.length) {
        const w = part[i];
        if (assigns(w)) i++;
        else if (w.text === "--" && !w.quoted) {
          i++;
          break;
        } else if (w.text.startsWith("-") && !w.quoted) {
          const flag = w.text.replace(/=.*$/, "");
          if (wrap.giveUp?.includes(flag)) return "";
          if (wrap.value.includes(flag)) i += w.text.includes("=") ? 1 : 2;
          else if (wrap.alone.includes(w.text)) i++;
          else return "";
        } else break;
      }
      if (i >= part.length) return "";
    }
    if (start + i >= risky) return "";
    const program = programOf(part[i]);
    if (!program) return "";
    const rest = part.slice(i + 1);
    const word = (w?: ShellWord) => (w && !w.quoted && PLAIN_WORD.test(w.text) ? w.text : undefined);
    // bash -lc 'npm test': the command inside.
    if (/^(?:ba|z|da)?sh$/.test(program)) {
      const c = rest.findIndex((w) => !w.quoted && /^-[a-z]*c$/.test(w.text));
      return c >= 0 && rest.slice(0, c).every((w) => !w.quoted && /^-[a-z]+$/.test(w.text)) && rest[c + 1] ? doingCommand(rest[c + 1].text, depth + 1) : program;
    }
    // python -m pytest: the module, a plain name. Nothing else after Python.
    if (/^python(?:3(?:\.\d+)?)?$/.test(program)) return rest[0]?.text === "-m" && !rest[0].quoted && rest[1] && !rest[1].quoted && MODULE.test(rest[1].text) ? `${program} -m ${rest[1].text}` : program;
    const most = SUBCOMMANDS[program]?.(word(rest[0])) ?? 0;
    const out = [program];
    for (const w of rest.slice(0, most)) {
      if (!word(w)) break;
      out.push(w.text);
    }
    return out.join(" ");
  }
  return "";
}

/** A frame's id as a name: brand-board is "Brand board", never the slug. For a frame not in its design file yet, or with nothing to name it. */
export const readableFrame = (id: string) => {
  if (!/^[a-z0-9][a-z0-9_~-]*$/.test(id)) return id;
  const w = id.replace(/~.*$/, "").replace(/[-_]+/g, " ").trim();
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : id;
};
/** A frame written as its file, by its name: the design file's (`known`), else the call's own ("Draw Phone / Week", the Demo's), else one made from its id. */
export const frameFileName = (c: DoingCall, frame: string, known?: string) => known || /^Draw\s+(.+)$/.exec(c.title.trim())?.[1] || readableFrame(frame);
/** Turns a frame's id into its name: the trail's (the open design file's, in the Design face) and the engine's alike. `design`: the design file the call names. */
export type StepFrameNamer = (frame: string, design?: string) => string | undefined;
/**
  The frame a canvas call is about, by its name: as the design file has it, else as the call names it, else made from
  its id. design_frame draws a frame by the name it gives first.
*/
export function canvasFrame(c: DoingCall, kind: string, names?: StepFrameNamer) {
  const i = inputOf(c);
  const id = str(i.frame) ?? str(i.id);
  const named = (id && names?.(id, str(i.design))) || str(i.name) || (id && readableFrame(id)) || undefined;
  return kind === "frame" ? (str(i.name) ?? named) : named;
}
/** A canvas call's step in plain words, under way or done: "Reading Phone / Menu", "Changed Phone / Menu". `frame`: canvasFrame's. */
export function canvasWords(c: DoingCall, kind: string, running: boolean, frame?: string): { verb: string; target?: string } {
  const v = (now: string, done: string) => (running ? now : done);
  switch (kind) {
    case "files":
      return { verb: v("Reading the design files", "Read the design files") };
    case "frame":
      return { verb: v("Drawing", "Drew"), target: frame ?? "a frame" };
    case "tree":
      return { verb: v("Reading", "Read"), target: frame ?? "a frame" };
    case "node":
      return inputOf(c).html === undefined ? { verb: v("Reading", "Read"), target: frame ?? "a frame" } : { verb: v("Changing", "Changed"), target: frame ?? "a frame" };
    case "selection":
      return { verb: v("Looking at what's selected", "Looked at what's selected") };
    case "shot":
      return { verb: v("Looking at", "Looked at"), target: frame ?? "a frame" };
    case "picture":
      return { verb: v("Making a picture", "Made a picture"), ...(frame ? { target: `for ${frame}` } : {}) };
    default:
      return { verb: v("Marking it built", "Marked it built"), ...(frame ? { target: frame } : {}) };
  }
}
/** The Browser's steps, under way and done. */
export const BROWSER_WORDS: [string, string] = ["Checking in the Browser", "Checked in the Browser"];

/**
  What kind of step a call is, for the mark a turn's line shows for it (Timeline.tsx: the live line's row of kinds, each
  step's icon, the folded line): a file read or changed, a search, a command (a dev server started is one), the web (a
  page fetched, the Browser), an agent (a brief to a sidekick or an agent sent off), Liner Design's canvas (its tools,
  and a design's frame written as its file), or another tool.
*/
export type StepKind = "file" | "search" | "command" | "web" | "agent" | "canvas" | "other";
/** The kinds in the order a line shows them, whatever order a turn used them in: "other" has no mark of its own there. */
export const STEP_KINDS: StepKind[] = ["file", "search", "command", "web", "agent", "canvas"];
export function stepKind(c: DoingCall): StepKind {
  if (CANVAS_TOOL.test(c.tool)) return "canvas";
  if (BROWSER_TOOL.test(c.tool)) return "web";
  if (SERVER_TOOL.test(c.tool)) return "command";
  if (SIDEKICK_TOOL.test(c.tool) || c.toolKind === "task") return "agent";
  if (c.toolKind === "edit" || c.toolKind === "write") return FRAME_FILE.test(slashed(c.path ?? str(inputOf(c).file_path) ?? "")) ? "canvas" : "file";
  if (c.toolKind === "read") return "file";
  if (c.toolKind === "search") return "search";
  if (c.toolKind === "exec") return "command";
  if (c.toolKind === "fetch" || c.toolKind === "web") return "web";
  return "other";
}
/** A dev server a server_start call starts, by its title ("Run web from launch.json" is web); undefined when it names none. */
export const serverOf = (c: DoingCall) => c.title.replace(/^Run\b\s*|\s+from launch\.json$/g, "").trim() || undefined;

/** A canvas tool's step as under way: the trail's words, with only a name worth saying in them. */
function canvasDoing(c: DoingCall, kind: string, names?: StepFrameNamer) {
  const w = canvasWords(c, kind, true, safe(canvasFrame(c, kind, names)));
  const plainer = canvasWords(c, kind, true);
  return said(w.verb, w.target, [plainer.verb, plainer.target].filter(Boolean).join(" "));
}

/**
  What the turn is doing as its latest step starts, from the lead's calls so far this turn, in order (the latest last).
  Reads in a row gather into one, as the trail has them ("Reading 3 files"). Undefined when the latest call isn't a step
  (a question, a plan, a design shown): what was said before stands.
*/
export function doingOf(calls: DoingCall[], names?: DoingFrameNamer): string | undefined {
  const c = calls.at(-1);
  if (!c || !isStepCall(c)) return undefined;
  // The engine names a frame only in a design file it is told of.
  const named: StepFrameNamer | undefined = names && ((frame, design) => (design ? names(frame, design) : undefined));
  return cutDoing(stepWords(calls.filter(isStepCall), c, named));
}

/** The file an edit or a write is about, as its call has it (its path, else its input's), for telling two calls of one file apart. */
const editPath = (c: DoingCall) => slashed(c.path ?? str(inputOf(c).file_path) ?? "");

function stepWords(calls: DoingCall[], c: DoingCall, names?: StepFrameNamer): string {
  const canvas = CANVAS_TOOL.exec(c.tool);
  if (canvas) return canvasDoing(c, canvas[1], names);
  if (BROWSER_TOOL.test(c.tool)) return BROWSER_WORDS[0];
  if (SERVER_TOOL.exec(c.tool)?.[1] === "start") return said("Starting", safe(serverOf(c)), "Starting a server");
  if (SIDEKICK_TOOL.test(c.tool)) return SIDEKICK_WORDS[0];
  if (c.toolKind === "read") {
    // The reads in a row up to this one, as one step.
    let n = calls.length - 1;
    while (n > 0 && calls[n - 1].toolKind === "read") n--;
    const run = calls.slice(n);
    const files = [...new Set(run.flatMap((x) => fileOf(x, /^Read\s+/) ?? []))];
    if (files.length > 1) return `Reading ${files.length} files`;
    if (files.length === 1) return said("Reading", files[0], run.length > 1 ? `Reading ${run.length} files` : "Reading a file");
    return run.length > 1 ? `Reading ${run.length} files` : "Reading a file";
  }
  if (c.toolKind === "search") return "Searching the code";
  if (c.toolKind === "edit" || c.toolKind === "write") {
    // A design file's frame is called by its name, as the trail calls it in the Design face: the design file's, else the
    // call's own ("Draw Phone / Week"), else one made from its id. Drawing when the frame isn't in its design file yet or
    // this is the turn's first whole write of its file (the trail: the session's first), else changing.
    const path = editPath(c);
    const [, design, frame] = FRAME_FILE.exec(path) ?? [];
    if (frame) {
      const known = names?.(frame, design);
      const drawn = !known || (c.toolKind === "write" && !calls.slice(0, -1).some((x) => editPath(x) === path));
      const name = safe(frameFileName(c, frame, known));
      return drawn ? said("Drawing", name, "Drawing a frame") : said("Changing", name, "Changing a frame");
    }
    return said("Editing", fileOf(c, /^(?:Edit|Write)\s+/), "Changing a file");
  }
  if (c.toolKind === "exec") {
    const ran = doingCommand(callCommand(c));
    const known = KNOWN.find(([re]) => re.test(ran));
    if (known) return known[1];
    return said("Running", ran || undefined, "Running a command");
  }
  // A call titled with only its kind is said by its kind. The trail says a real title too; the line never quotes one.
  const kind = KIND_WORDS[c.toolKind];
  if (kind) return kind[0];
  // Another tool, by its name when that is a word: an MCP server's own name ("Using github"), never Liner's.
  const name = toolNameOf(c.tool);
  return name ? `Using ${name}` : "Using a tool";
}

/** The longest a question's own words run on a row (Thread.asking): a question says more than a step, and the row cuts it anyway. */
export const ASKING_MAX = 72;
/** What askingOf reads of an ask: the fields an approval, a question and a plan to approve carry. */
export type AskingItem =
  | { kind: "approval"; tool: string; title: string; fields: { label: string; value: string }[]; addon?: { name: string } }
  | { kind: "question"; questions: { question: string }[] }
  | { kind: "proposal"; title: string };

/**
  What a session waits on you for, in a few plain words (Thread.asking): a question in its own words, cut at a word past
  ASKING_MAX; an approval as what it would let the agent do, by the doing line's rules ("Run npm test?", "Edit tides.js?",
  "Start web?"), so never a whole command line or a path; a plan as "Approve its plan?". Undefined for an ask that says nothing.
*/
export function askingOf(it: AskingItem): string | undefined {
  if (it.kind === "question") {
    const q = oneLine(it.questions[0]?.question ?? "");
    if (!q) return undefined;
    if (q.length <= ASKING_MAX) return q;
    const cut = q.slice(0, ASKING_MAX + 1);
    const at = cut.lastIndexOf(" ");
    return noDots((at > 0 ? cut.slice(0, at) : q.slice(0, ASKING_MAX)).replace(/[\s,;:·/–-]+$/, "")).trim();
  }
  if (it.kind === "proposal") return "Approve its plan?";
  const asked = (words: string) => `${words}?`;
  if (it.addon) return asked(said("Add", safe(it.addon.name), "Add an add-on"));
  if (SERVER_TOOL.exec(it.tool)?.[1] === "start") return asked(said("Start", safe(serverOf({ tool: it.tool, toolKind: "exec", title: it.title })), "Start a server"));
  if (BROWSER_TOOL.test(it.tool)) return "Use the Browser?";
  const command = it.fields.find((f) => f.label === "Command")?.value;
  if (command !== undefined) {
    const ran = doingCommand(command);
    return asked(said("Run", ran || undefined, "Run a command"));
  }
  // An edit: by its File fields (Codex's), else by a title that says Edit or Write and the file (Claude Code's, ACP's).
  const files = [...new Set(it.fields.filter((f) => f.label === "File").map((f) => f.value))];
  const titled = /^(?:Edit|Write)\b/.test(it.title);
  const verb = /^Write\b/.test(it.title) ? "Write" : "Edit";
  if (files.length > 1) return asked(`${verb} ${files.length} files`);
  if (files.length || titled) {
    const file = files[0] ? safe(baseName(files[0]), FILE_NAME) : fileOf({ tool: it.tool, toolKind: "edit", title: it.title }, /^(?:Edit|Write)\s+/);
    return asked(said(verb, file, verb === "Write" ? "Write a file" : "Change a file"));
  }
  const name = toolNameOf(it.tool);
  return asked(name ? `Use ${name}` : "Use a tool");
}
