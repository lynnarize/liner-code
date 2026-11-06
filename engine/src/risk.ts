/*
  How risky a tool call is, for the approval card: high risk approves with a hold instead of a
  press, and in Full access the guard still asks about anything that can't be undone.
*/
import type { Risk, ToolKind } from "../../contracts/src/index.ts";

const HIGH = [
  // rm recursive and forced, however its flags are written: -rf, -r -f, -Rfv, --recursive --force,
  // and the --rec --f that GNU rm takes for them.
  /\brm\b(?=[^;&|\n]*\s(?:-[a-zA-Z]*[rR][a-zA-Z]*|--r[a-z]*)\b)(?=[^;&|\n]*\s(?:-[a-zA-Z]*f[a-zA-Z]*|--f[a-z]*)\b)/,
  /\brm\s+-[a-z]*r\b.*\s(\/|~|\$HOME|\.\.?)(\s|$)/i,
  /\bgit\s+push\b.*(--force|-f\b|--force-with-lease)/i,
  /\bgit\s+reset\b[^;&|\n]*\s--hard\b/i,
  /\bgit\s+clean\b[^;&|\n]*\s(?:-[a-zA-Z]*f[a-zA-Z]*|--force)\b/i,
  // What throws away work git can't give back: changes not committed, stashes, unmerged branches.
  // [^;&|\n]* keeps a rule to the one command, so a later one in a chain isn't read as its flag.
  /\bgit\s+branch\b[^;&|\n]*\s-[a-zA-Z]*D/,
  /\bgit\s+branch\b(?=[^;&|\n]*\s(?:-[a-zA-Z]*d|--delete)\b)(?=[^;&|\n]*\s(?:-[a-zA-Z]*f|--force)\b)/,
  /\bgit\s+checkout\b[^;&|\n]*\s--(?:\s|$)/,
  /\bgit\s+checkout\b[^;&|\n]*\s\.(?:\/[^\s;&|]*)?(?=[\s;&|]|$)/,
  /\bgit\s+checkout\b[^;&|\n]*\s(?:-f|--force)\b/,
  // git restore puts back the working tree unless it's told only --staged (the index).
  /\bgit\s+restore\b(?![^;&|\n]*\s(?:--staged|-S)\b)/,
  /\bgit\s+restore\b(?=[^;&|\n]*\s(?:--worktree|-W)\b)/,
  /\bgit\s+stash\s+(?:clear|drop)\b/,
  /\bgit\s+switch\b[^;&|\n]*\s(?:--discard-changes|-f|--force)\b/,
  /\bgit\s+worktree\s+remove\b[^;&|\n]*\s(?:--force|-f)\b/,
  /\bfind\b[^;&|\n]*\s['"]?-delete\b/,
  /\bfind\b[^;&|\n]*\s['"]?-exec(?:dir)?['"]?\s+['"]?rm\b/,
  /\bsudo\b/,
  /\bmkfs\b|\bdd\s+if=/,
  /\bchmod\s+-R\s+777\b/,
  /(curl|wget)[^|]*\|\s*(sh|bash|zsh)\b/,
  /\bdrop\s+(table|database)\b/i,
  /\btruncate\s+table\b/i,
  // Flags can stand in front of publish, and a flag's value with them (npm --prefix app publish), and cargo's +toolchain.
  /\b(?:npm|pnpm|yarn|bun|cargo)(?:\s+-[^\s;&|]*(?:\s+[^-\s;&|][^\s;&|]*)?|\s+\+[^\s;&|]+)*\s+publish\b|\bgem\s+push\b|\btwine\s+upload\b|\bgh\s+release\s+create\b/,
  /\bkubectl\s+delete\b|\bterraform\s+(apply|destroy)\b/,
  />\s*\/dev\/(sd|disk)/,
];
// On Windows, agents' commands are PowerShell's or cmd.exe's as often as bash's: their ways to delete
// a tree or a disk, to run a script straight from the web, and to run as administrator.
if (process.platform === "win32")
  HIGH.push(
    /\b(?:Remove-Item|ri|rm|rmdir|rd|del|erase)\b(?=[^;&|\n]*\s-r(?:ecurse)?\b)(?=[^;&|\n]*\s-fo(?:rce)?\b)/i,
    /\b(?:rd|rmdir)\b[^;&|\n]*\s\/s\b/i,
    /\b(?:del|erase)\b[^;&|\n]*\s\/s\b/i,
    /\bformat\s+[a-z]:/i,
    /\b(?:Format-Volume|Clear-Disk|Remove-Partition)\b/i,
    /\b(?:iwr|irm|curl|wget|Invoke-WebRequest|Invoke-RestMethod)\b[^|]*\|\s*(?:iex|Invoke-Expression)\b/i,
    /-Verb\s+RunAs\b/i,
  );
const MEDIUM = [/\bgit\s+(push|commit|merge|rebase|tag)\b/, /\bgit\s+branch\b[^;&|\n]*\s(?:-d|--delete)\b/, /\b(npm|pnpm|yarn|bun)\s+(i|install|add|remove)\b/, /\bpip\s+install\b/, /\bbrew\s+install\b/, /\bmv\b|\bcp\s+-r\b/, /\bgh\s+pr\s+(create|merge)\b/, /\bdocker\s+(rm|rmi|system\s+prune)\b/, /\bcurl\b.*-X\s*(POST|PUT|DELETE|PATCH)/i];

/** One word as the shell reads it, so a quoted space stays inside it. */
const WORD = String.raw`(?:"[^"]*"|'[^']*'|[^\s"';&|])+`;
/** A command's words as the shell reads them, quotes still on. */
export const shellWords = (command: string) => command.match(new RegExp(WORD, "g")) ?? [];
/**
  The options git takes before its command, which say nothing about what the command does: the ones
  whose value is the next word by name, then any other `--option` or `--option=value`, which git either
  takes or refuses. Not `-c alias.x=…`: that's the command itself, so it stays to be read.
*/
const GIT_OPTION = String.raw`-C\s+${WORD}|-c\s+(?!['"]?[aA][lL][iI][aA][sS]\.)${WORD}|--(?:git-dir|work-tree|namespace|config-env|attr-source)\s+${WORD}|--[a-z][a-z-]*(?:=${WORD})?|-[pP]`;
const GIT_OPTIONS = new RegExp(String.raw`\bgit(?:\s+(?:${GIT_OPTION}))+(?=\s)`, "g");

/** A command with those options taken out, so `git -C app reset --hard` reads as what it is. */
export const plainGit = (command: string) => command.replace(GIT_OPTIONS, "git");

/** The endings Windows finds a program by when it's named without one. */
const ENDING = String.raw`\.(?:exe|cmd|bat|com)`;
const ENDS_LIKE_A_PROGRAM = new RegExp(`${ENDING}$`);
const WINDOWS_PROGRAMS = new RegExp(String.raw`"(?:[^"\n]*[\\/])?([^"\n\\/]+)${ENDING}"|'(?:[^'\n]*[\\/])?([^'\n\\/]+)${ENDING}'|(?<![^\s;&|])(?:[^\s"';&|]*[\\/])?([^\s"';&|\\/]+)${ENDING}(?=$|[\s;&|])`, "gi");

/** A command with each Windows program as its bare name, so `C:\Git\git.exe push --force` reads as what it is. Only for reading its risk: see ruleFor. */
const bareNames = (command: string) => command.replace(WINDOWS_PROGRAMS, (_, a?: string, b?: string, c?: string) => (a ?? b ?? c ?? "").toLowerCase());

export function commandRisk(command: string): Risk {
  // As written too: what the plain text no longer shows (a quoted `rm -rf` in an option) still counts.
  const texts = [command, bareNames(command)].flatMap((c) => [c, plainGit(c)]);
  if (HIGH.some((r) => texts.some((c) => r.test(c)))) return "high";
  if (MEDIUM.some((r) => texts.some((c) => r.test(c)))) return "medium";
  return "low";
}

/**
  The script a login shell is handed, the way Codex runs commands. Only when the outer shell hands it
  over as written: one quoted string with no quote of its kind inside it, and in double quotes no
  backslash, $ or backtick it would expand first.
*/
export const unwrapped = (command: string) => command.trim().replace(/^(?:\/bin\/)?(?:ba|z)?sh\s+-l?c\s+(?:'([^']*)'|"([^"\\$`]*)"|([^'"\\]*))$/, (_, a?: string, b?: string, d?: string) => a ?? b ?? d ?? "").trim();

/**
  A command that only reads (pwd, ls, cat, sed -n, rg, git diff…), alone or piped and chained,
  including one wrapped in a login shell the way Codex runs them. Redirects, substitutions,
  in-place edits, and the flags that make a reader write a file or run a command never count.
*/
export function readsOnly(command: string) {
  const c = unwrapped(command);
  // What's quoted is an argument (a path with spaces, a sed pattern with < in it), never a redirect or a pipe.
  // Double quotes still expand $( ) and backticks, so those stay visible. The quoted text is kept
  // aside, so a sed script in it can still be read. Quotes pair left to right the way the shell
  // pairs them, and a quote left unpaired or escaped, or a backslash outside quotes, never counts
  // as a read: it could hide a ; that the shell sees. Neither does a # that starts a comment (the
  // shell skips a quote after it) or $'…' (where a backslash escapes a quote). A bare ( or ) never
  // counts either, nor ${( in double quotes: zsh runs code from =(…), a glob's *(e:…:) and ${(e)…}.
  const quoted: string[] = [];
  const aside = (m: string) => `\u0000${quoted.push(m.slice(1, -1)) - 1}\u0000`;
  const bare = c.replace(/'[^']*'|"(?:[^"$`\\]|\\[\s\S]|\$(?!\(|\{\())*"/g, aside);
  if (!bare || /[<>`'"\\()]|\$\u0000|(?:^|[\s;&|])#/.test(bare)) return false;
  // A lone & and a new line start another command as surely as ; does.
  return bare.split(/&&|\|\||;|\||&|[\r\n]/).every((part) => {
    const p = part.trim().replace(/^cd\s+\S+$/, "pwd");
    const words = p.split(/\s+/).map((w) => w.replace(/\u0000(\d+)\u0000/g, (_, i: string) => quoted[Number(i)]));
    // A whole word: tree-sitter, cat-file-writer and the like are programs of their own.
    if (/^(pwd|ls|cat|head|tail|wc|nl|grep|stat|echo)(?=\s|$)/.test(p)) return true;
    // rg --pre and --hostname-bin run a command; tree -o, file -C and git --output write a file.
    if (/^rg(?=\s|$)/.test(p)) return !words.some((w) => /^--(pre|hostname-bin)(=|$)/.test(w));
    if (/^tree(?=\s|$)/.test(p)) return !words.some((w) => /^-[^-]*o/.test(w));
    if (/^file(?=\s|$)/.test(p)) return !words.some((w) => /^-[^-]*C|^--compile$/.test(w));
    if (/^sed(?=\s|$)/.test(p)) return sedReads(words);
    // Read off the words with their quotes put back, so a quoted '-delete' is seen too.
    if (/^find(?=\s|$)/.test(p)) return !words.some((w) => /^-(delete|exec|ok|fprint|fls)/.test(w));
    if (/^git\s+branch(?=\s|$)/.test(p)) return branchLists(words.slice(2));
    return /^git\s+(status|diff|log|show|ls-files|rev-parse)(?=\s|$)/.test(p) && !words.some((w) => /^--output(=|$)/.test(w));
  });
}

/** `git branch` flags that only list, and the ones of them that take a value (a commit, a key, a format). */
const LISTS = /^--(?:all|remotes|verbose|list|show-current|ignore-case|no-color|no-column|no-abbrev|omit-empty|(?:color|column|abbrev|contains|no-contains|merged|no-merged|points-at|sort|format)(?:=.*)?)$/;
const TAKES = /^--(?:contains|no-contains|merged|no-merged|points-at|sort|format)$/;

/**
  `git branch` that only lists: listing flags alone, or --list with patterns. A name alone makes a
  branch, and -d, -D, -m, -M, -c, -C, -f, -u and the like change them.
*/
function branchLists(args: string[]) {
  let list = false;
  let names = 0;
  for (let i = 0; i < args.length; i++) {
    const w = args[i];
    if (/^-[arvil]+$/.test(w)) list ||= w.includes("l");
    else if (LISTS.test(w)) {
      list ||= w === "--list";
      if (TAKES.test(w) && args[i + 1] && !args[i + 1].startsWith("-")) i++;
    } else if (w.startsWith("-")) return false;
    else names++;
  }
  return !names || list;
}

/** `sed -n` with scripts that only print: no -i or -f, and no w, W or e command or s flag (they write a file or run a command). */
function sedReads(words: string[]) {
  const scripts: string[] = [];
  const rest: string[] = [];
  let quiet = false;
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    if (w === "-e" || w === "--expression") scripts.push(words[++i] ?? "");
    else if (w.startsWith("--expression=")) scripts.push(w.slice(13));
    else if (w === "--quiet" || w === "--silent") quiet = true;
    else if (/^-[nEru]+$/.test(w)) quiet ||= w.includes("n");
    else if (w.startsWith("-")) return false;
    else rest.push(w);
  }
  if (!scripts.length) scripts.push(rest[0] ?? "");
  return quiet && scripts.every(sedScriptReads);
}

/** A sed script of addresses and commands that print, read left to right so a pattern's own letters aren't taken for commands. */
function sedScriptReads(s: string) {
  let i = 0;
  // Past the text up to and including the closing delimiter `d`, escapes and all.
  const past = (d: string) => {
    while (i < s.length && s[i] !== d) i += s[i] === "\\" ? 2 : 1;
    i++;
    return i <= s.length;
  };
  while (i < s.length) {
    const ch = s[i];
    if (ch === "/") {
      i++;
      if (!past("/")) return false;
    } else if (ch === "\\") {
      const d = s[i + 1];
      i += 2;
      if (!d || !past(d)) return false;
    } else if (ch === "s" || ch === "y") {
      const d = s[i + 1];
      if (!d || /[\s\\]/.test(d)) return false;
      i += 2;
      if (!past(d) || !past(d)) return false;
      const flags = ch === "s" ? (/^[a-zA-Z0-9]*/.exec(s.slice(i))?.[0] ?? "") : "";
      if (/[we]/i.test(flags)) return false;
      i += flags.length;
    } else if (/[\d\s,$!;{}+~pP=lnNqQdDgGhHx]/.test(ch)) i++;
    else return false;
  }
  return true;
}

/** True when the guard should ask even in Full access. */
export function isDestructive(command: string) {
  return commandRisk(command) === "high";
}

export function toolRisk(kind: ToolKind, command?: string): Risk {
  if (kind === "exec") return commandRisk(command ?? "");
  if (kind === "edit" || kind === "write") return "low";
  if (kind === "fetch" || kind === "web") return "low";
  return "low";
}

/** Tools whose first word says little on its own: their subcommand is part of the rule. */
const SUB = /^(git|npm|pnpm|yarn|bun|npx|bunx|cargo|go|docker|kubectl|gh|make|pip|uv|poetry|swift|xcodebuild|dotnet|deno|rails|bundle|mix)$/;
/** Shells and wrappers, by a lower-case name: a rule for one would allow any command it's handed. The second line is Windows's. */
const WRAPPERS = new RegExp(`^(${[
  "sh|bash|zsh|fish|dash|ksh|csh|tcsh|env|xargs|eval|exec|command|builtin|nohup|time|nice|timeout|sudo|doas",
  "cmd|powershell|pwsh|wsl|start|call|runas|forfiles|cscript|wscript|mshta|rundll32|regsvr32|msiexec|iex|invoke-expression|icm|invoke-command|saps|start-process",
].join("|")})$`);
/** Interpreters: what they run is in their arguments, so a rule is for those arguments and no others, or `python x.py` would allow `python -c …`. */
const INTERPRETERS = /^(python[\d.]*|py|pypy[\d.]*|node|nodejs|ruby|perl|php|lua|rscript|osascript)$/;

/**
  What "Don't ask again for … this session" would allow: a single plain command, named by its
  program (and subcommand, for git, npm and the like), after any leading `cd <dir> &&`. A
  compound command (&&, &, ;, |, a new line, redirects, substitutions) gets none, and neither
  does a shell or a wrapper that runs whatever follows it, so a rule can never carry something
  else along with it. Nor does one that starts by setting a variable (PATH, NODE_OPTIONS,
  GIT_EXTERNAL_DIFF can change what runs), nor a program that is one ($SHELL, %COMSPEC%), and the
  program is matched as written, so `./git` or `/tmp/x/npm` never passes for the `git` or `npm` a
  rule names. What a program is goes by its name in any case, with no folder and none of Windows's
  endings: a Mac's disk and Windows both find `BASH`, and `C:\Windows\System32\cmd.exe` is cmd.
  A bare `git.exe` is `git`, and the rule says so; one with a folder keeps it, as above.
*/
export function ruleFor(command: string): string | undefined {
  const c = command.trim().replace(/^(?:cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*&&\s*)+/, "");
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(c)) return undefined;
  if (!c || /[&;|<>`\r\n]|\$\(/.test(c)) return undefined;
  const [first, ...rest] = shellWords(c);
  if (!first) return undefined;
  const path = first.replace(/["']/g, "");
  if (/[$%]/.test(path)) return undefined;
  const file = path.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  const name = file.replace(ENDS_LIKE_A_PROGRAM, "");
  if (WRAPPERS.test(name)) return undefined;
  const head = name !== file && !/[\\/]/.test(path) ? name : first;
  const whole = () => (commandRisk(c) === "high" ? undefined : [head, ...rest].join(" "));
  if (INTERPRETERS.test(name)) return whole();
  if (SUB.test(name) && /^[-+]/.test(rest[0] ?? "")) {
    // `git -C app status` has no subcommand to name: the rule would be `git`, for every git command written that way.
    if (name === "git") return undefined;
    // The same goes for `make -j8 test` or `npm --prefix ui run build`, where a flag's value can't be told from a
    // subcommand, and `cargo +nightly test`: the rule is the whole command, which allows that one again and nothing else.
    return whole();
  }
  return SUB.test(name) && rest[0] ? `${head} ${rest[0]}` : head;
}
