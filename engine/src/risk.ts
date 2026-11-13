/*
  How risky a tool call is, for the approval card: high risk approves with a hold instead of a
  press, and in Full access the guard still asks about anything that can't be undone. Each table
  carries why it matched, so what the card says came from the check that decided (approval `why`).
*/
import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import { ACCESS_NAMES, type ApprovalWhy, type Risk, type ToolKind } from "../../contracts/src/index.ts";

/** Gone for good: the text completes "Can't be undone: …". */
const HIGH: [RegExp, string][] = [
  // rm recursive and forced, however its flags are written: -rf, -r -f, -Rfv, --recursive --force,
  // and the --rec --f that GNU rm takes for them.
  [/\brm\b(?=[^;&|\n]*\s(?:-[a-zA-Z]*[rR][a-zA-Z]*|--r[a-z]*)\b)(?=[^;&|\n]*\s(?:-[a-zA-Z]*f[a-zA-Z]*|--f[a-z]*)\b)/, "deletes files for good"],
  [/\brm\s+-[a-z]*r\b.*\s(\/|~|\$HOME|\.\.?)(\s|$)/i, "deletes a whole folder for good"],
  [/\bgit\s+push\b.*(--force|-f\b|--force-with-lease)/i, "writes over what the remote had"],
  [/\bgit\s+reset\b[^;&|\n]*\s--hard\b/i, "throws away changes that aren't committed"],
  [/\bgit\s+clean\b[^;&|\n]*\s(?:-[a-zA-Z]*f[a-zA-Z]*|--force)\b/i, "deletes the files git doesn't track"],
  // What throws away work git can't give back: changes not committed, stashes, unmerged branches.
  // [^;&|\n]* keeps a rule to the one command, so a later one in a chain isn't read as its flag.
  [/\bgit\s+branch\b[^;&|\n]*\s-[a-zA-Z]*D/, "deletes a branch that may not be merged"],
  [/\bgit\s+branch\b(?=[^;&|\n]*\s(?:-[a-zA-Z]*d|--delete)\b)(?=[^;&|\n]*\s(?:-[a-zA-Z]*f|--force)\b)/, "deletes a branch that may not be merged"],
  [/\bgit\s+checkout\b[^;&|\n]*\s--(?:\s|$)/, "throws away changes that aren't committed"],
  [/\bgit\s+checkout\b[^;&|\n]*\s\.(?:\/[^\s;&|]*)?(?=[\s;&|]|$)/, "throws away changes that aren't committed"],
  [/\bgit\s+checkout\b[^;&|\n]*\s(?:-f|--force)\b/, "throws away changes that aren't committed"],
  // git restore puts back the working tree unless it's told only --staged (the index).
  [/\bgit\s+restore\b(?![^;&|\n]*\s(?:--staged|-S)\b)/, "throws away changes that aren't committed"],
  [/\bgit\s+restore\b(?=[^;&|\n]*\s(?:--worktree|-W)\b)/, "throws away changes that aren't committed"],
  [/\bgit\s+stash\s+(?:clear|drop)\b/, "throws away stashed changes"],
  [/\bgit\s+switch\b[^;&|\n]*\s(?:--discard-changes|-f|--force)\b/, "throws away changes that aren't committed"],
  [/\bgit\s+worktree\s+remove\b[^;&|\n]*\s(?:--force|-f)\b/, "removes a worktree with its changes"],
  [/\bfind\b[^;&|\n]*\s['"]?-delete\b/, "deletes files for good"],
  [/\bfind\b[^;&|\n]*\s['"]?-exec(?:dir)?['"]?\s+['"]?rm\b/, "deletes files for good"],
  [/\bsudo\b/, "runs as the administrator"],
  [/\bmkfs\b|\bdd\s+if=/, "writes over a disk"],
  [/\bchmod\s+-R\s+777\b/, "opens every file in a folder to anyone"],
  [/(curl|wget)[^|]*\|\s*(sh|bash|zsh)\b/, "runs a script straight from the web"],
  [/\bdrop\s+(table|database)\b/i, "deletes a database table"],
  [/\btruncate\s+table\b/i, "empties a database table"],
  // Flags can stand in front of publish, and a flag's value with them (npm --prefix app publish), and cargo's +toolchain.
  [/\b(?:npm|pnpm|yarn|bun|cargo)(?:\s+-[^\s;&|]*(?:\s+[^-\s;&|][^\s;&|]*)?|\s+\+[^\s;&|]+)*\s+publish\b|\bgem\s+push\b|\btwine\s+upload\b|\bgh\s+release\s+create\b/, "publishes a release for everyone"],
  [/\bkubectl\s+delete\b|\bterraform\s+(apply|destroy)\b/, "changes live infrastructure"],
  [/>\s*\/dev\/(sd|disk)/, "writes over a disk"],
];
// On Windows, agents' commands are PowerShell's or cmd.exe's as often as bash's: their ways to delete
// a tree or a disk, to run a script straight from the web, and to run as administrator.
if (process.platform === "win32")
  HIGH.push(
    [/\b(?:Remove-Item|ri|rm|rmdir|rd|del|erase)\b(?=[^;&|\n]*\s-r(?:ecurse)?\b)(?=[^;&|\n]*\s-fo(?:rce)?\b)/i, "deletes files for good"],
    [/\b(?:rd|rmdir)\b[^;&|\n]*\s\/s\b/i, "deletes a whole folder for good"],
    [/\b(?:del|erase)\b[^;&|\n]*\s\/s\b/i, "deletes files for good"],
    [/\bformat\s+[a-z]:/i, "writes over a disk"],
    [/\b(?:Format-Volume|Clear-Disk|Remove-Partition)\b/i, "writes over a disk"],
    [/\b(?:iwr|irm|curl|wget|Invoke-WebRequest|Invoke-RestMethod)\b[^|]*\|\s*(?:iex|Invoke-Expression)\b/i, "runs a script straight from the web"],
    [/-Verb\s+RunAs\b/i, "runs as the administrator"],
  );
/** Medium: each with what it does, completing "… asks because ". */
const MEDIUM: [RegExp, ApprovalWhy][] = [
  [/\bgit\s+push\b/, { kind: "network", text: "it pushes to a remote" }],
  [/\bgit\s+(commit|merge|rebase|tag)\b/, { kind: "changes", text: "it changes the git history" }],
  [/\bgit\s+branch\b[^;&|\n]*\s(?:-d|--delete)\b/, { kind: "changes", text: "it deletes a branch" }],
  [/\b(npm|pnpm|yarn|bun)\s+(i|install|add|remove)\b/, { kind: "changes", text: "it installs a package" }],
  [/\bpip\s+install\b/, { kind: "changes", text: "it installs a package" }],
  [/\bbrew\s+install\b/, { kind: "changes", text: "it installs a package" }],
  [/\bmv\b|\bcp\s+-r\b/, { kind: "changes", text: "it moves or copies files" }],
  [/\bgh\s+pr\s+(create|merge)\b/, { kind: "network", text: "it opens or merges a pull request" }],
  [/\bdocker\s+(rm|rmi|system\s+prune)\b/, { kind: "changes", text: "it removes Docker containers or images" }],
  [/\bcurl\b.*-X\s*(POST|PUT|DELETE|PATCH)/i, { kind: "network", text: "it sends a request that changes something on a server" }],
];

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
  return riskOf(command).risk;
}

/** The rating and why, from the entry that matched: for high, what can't be undone. */
export function riskOf(command: string): { risk: Risk; why?: ApprovalWhy } {
  // As written too: what the plain text no longer shows (a quoted `rm -rf` in an option) still counts.
  const texts = [command, bareNames(command)].flatMap((c) => [c, plainGit(c)]);
  const high = HIGH.find(([r]) => texts.some((c) => r.test(c)));
  if (high) return { risk: "high", why: { kind: "undo", text: high[1] } };
  const medium = MEDIUM.find(([r]) => texts.some((c) => r.test(c)));
  if (medium) return { risk: "medium", why: medium[1] };
  return { risk: "low" };
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

/** A name ending in .env or starting with it (.env, .env.local, prod.env), wherever it stands in a command. */
const ENV_NAME = /(?:^|[^\w.-])([\w.-]*\.env(?:\.[\w.-]+)?)(?![\w.-])/gi;

/**
  Whether a command names a .env file, which often holds keys: what the command prints goes to the model, and so to
  whoever runs the model. Auto and Reviewer decides let no such command through as a plain read, whatever it does with
  the file. Not an example (.env.example), which is made to be read, a folder (.env.d/x), nor code's own
  `process.env.X` and `import.meta.env`, which a search of the project is full of. The same files as acp.ts's secretFile.
*/
export function namesSecret(command: string) {
  for (const m of command.matchAll(ENV_NAME)) {
    const name = m[1];
    const next = command[m.index + m[0].length] ?? "";
    if (next === "/" || next === "\\") continue;
    if (/\.example$/i.test(name) || /(?:^|\.)(?:process|meta)\.env(?:\.|$)/.test(name)) continue;
    return true;
  }
  return false;
}

/** Rated low, yet a rating says too little about them for Auto to run them unasked. */
const ASKS: [RegExp, ApprovalWhy][] = [
  // Deleting, however small, and stopping programs that may not be its own.
  [/\b(?:rm|rmdir|unlink|shred|trash)\b/, { kind: "changes", text: "it deletes files" }],
  [/\b(?:kill|pkill|killall)\b/, { kind: "changes", text: "it stops programs that may not be its own" }],
  // A script that isn't a file of the project: piped into a shell or an interpreter, decoded, or put together as text.
  [/\|\s*(?:env\s+)?(?:(?:ba|z|da|k|fi)?sh|python[\d.]*|node|perl|ruby|php|osascript)\b/, { kind: "changes", text: "it runs a script that isn't a file of the project" }],
  [/\beval\b|\bbase64\b[^;&|\n]*\s(?:-d|-D|--decode)\b/, { kind: "changes", text: "it runs a script that isn't a file of the project" }],
  // What sets up this computer rather than the project.
  [/\b(?:osascript|launchctl|crontab|security|networksetup|scutil|dscl)\b|\bdefaults\s+write\b/, { kind: "changes", text: "it changes how this Mac is set up" }],
  // A web address put together from what another command prints.
  [/https?:\/\/[^\s"']*(?:\$\(|`)/i, { kind: "network", text: "it builds a web address from what another command prints" }],
];
if (process.platform === "win32") ASKS.push([/\b(?:del|erase|rd|Remove-Item|ri|taskkill|Stop-Process|iex|Invoke-Expression|schtasks|Set-ExecutionPolicy)\b|\breg\s+add\b/i, { kind: "changes", text: "it deletes files, stops programs or changes how this computer is set up" }]);
/** A command that talks to the network, and a name that reads like a key or a password: the two together come to you. */
const NETWORK = /\b(?:curl|wget|nc|ncat|telnet|ftp|http|https|xh)\b|\bInvoke-(?:WebRequest|RestMethod)\b/i;
const SECRET_NAME = /\.env\b|\.pem\b|\.ssh\b|\.npmrc\b|\.netrc\b|id_(?:rsa|ed25519|ecdsa)|credential|keychain|secret|passw|token|api[_-]?key/i;
/** A place written from the root, from home or from a drive, as a word's start. A web address isn't one: `:` starts no word. */
const PLACE = /(?:^|[\s"'=(<>])((?:~|\$HOME\b|\$\{HOME\}|\/|[A-Za-z]:[\\/]|\\\\)[^\s"'`;&|<>()]*)/g;
/** A place glued to a short flag (`-o/Users/x/.zshrc`, `-o~/x`): curl, cc and the like read the rest of the word as its value. */
const GLUED = /(?:^|[\s"'=])-[A-Za-z]+((?:~|\$HOME\b|\$\{HOME\}|\/|[A-Za-z]:[\\/])[^\s"'`;&|<>()]*)/g;
/** `..`, a step up out of the folder. */
const UP = /(?:^|[\s"'=(<>\/\\])\.\.(?:[\/\\]|[\s"';&|)]|$)/;
/** Outside the project and still nobody's: where output is thrown away, and the temporary folders. */
const SPARE = /^\/(?:dev\/(?:null|stdout|stderr|stdin|tty)|(?:private\/)?tmp|(?:private\/)?var\/folders)(?:\/|$)/;

/**
  Where installed skills keep their folders, under home: the ones Liner Code reads skills from (lean.ts, api.ts) and the
  agents' shared one. A script in `<root>/<name>/` is that skill's own (skillOffer).
*/
const SKILL_ROOTS = [".agents/skills", ".claude/skills", ".codex/skills"];

/**
  What Auto's rule needs besides the command: the platform, the home folder, folders a skill grant counts as inside
  (skillOffer).
*/
export type JudgeOptions = { platform?: NodeJS.Platform; home?: string; inside?: string[] };

/**
  What Auto runs without asking on a tool with no safety check of its own (OpenCode and the other ACP tools, Claude Code
  through another maker's API): a command rated low that names no place outside its folder and isn't one of the few a low
  rating says too little about. All of it is read off the text, as the rating is: nothing here judges what a command is
  for, so what the text can't vouch for comes to you, and a pattern that only looks like a path (`grep "/api/"`) does too.
  `inside`: skill folders you allowed (skillOffer), inside for one word only: the script an interpreter runs as a file. Any
  other word naming a place in one (the same path again, another file there) is outside, and so is the script when the
  command has a redirect or sets a variable first, so nothing is written there and nothing changes what runs.
*/
export function routine(command: string, cwd: string, platform = process.platform, o: Omit<JudgeOptions, "platform"> = {}) {
  return judge(command, cwd, { ...o, platform }).ok;
}

/**
  routine() with why it said no, from the check that said it (the approval card's `why`), and the places it found
  outside the project. A no with no `why` has none the text can name.
*/
export function judge(command: string, cwd: string, o: JudgeOptions = {}): { ok: boolean; why?: ApprovalWhy; outside?: string[] } {
  const platform = o.platform ?? process.platform;
  const home = o.home ?? homedir();
  if (!command.trim()) return { ok: false };
  const rated = riskOf(command);
  if (rated.risk !== "low") return { ok: false, why: rated.why };
  if (namesSecret(command)) return { ok: false, why: { kind: "level", text: `${ACCESS_NAMES.auto} leaves a command that names a .env file to you` } };
  const texts = [command, bareNames(command)];
  const asks = ASKS.find(([r]) => texts.some((c) => r.test(c)));
  if (asks) return { ok: false, why: asks[1] };
  if (NETWORK.test(command) && SECRET_NAME.test(command)) return { ok: false, why: { kind: "network", text: "it reaches the network and names something that may hold a key" } };
  if (UP.test(command)) return { ok: false, why: { kind: "outside", text: "it steps out of the project with .." } };
  const paths = platform === "win32" ? win32 : posix;
  const fold = (p: string) => (platform === "win32" ? p.toLowerCase() : p);
  const root = fold(paths.resolve(cwd));
  const within = (full: string, dir: string) => full === dir || full.startsWith(dir + paths.sep);
  const inside = (o.inside ?? []).map((d) => fold(paths.resolve(d)));
  // The one word a skill folder may be named by: the script an interpreter runs, when there's exactly one such script.
  let script: string | undefined;
  const parsed = inside.length ? parseShell(command) : undefined;
  // Not when it sets a variable or changes the shell (export PYTHONPATH=…): that changes what the script loads.
  if (parsed && !parsed.redirect && !parsed.assign && !parsed.list.some((x) => SHELL_CHANGERS.test(programOf(x.words[0] ?? "")))) {
    const scripts = parsed.list.flatMap((x) => {
      const w = scriptOf(x.words);
      const full = w ? fullPath(w, cwd, home, paths) : undefined;
      return full && inside.some((d) => within(fold(full), d)) ? [fold(full)] : [];
    });
    if (scripts.length === 1) script = scripts[0];
  }
  let scriptSeen = false;
  const outside: string[] = [];
  for (const place of [...[...command.matchAll(PLACE)].map((m) => m[1]), ...[...command.matchAll(GLUED)].map((m) => m[1])]) {
    if (SPARE.test(place)) continue;
    // Home is outside unless the project is under it and the path says so in full.
    const written = place.replace(/^(?:~|\$HOME\b|\$\{HOME\})(?=$|[\\/])/, home);
    // `~someone` is another person's home.
    if (/^[~$]/.test(written)) return { ok: false, why: { kind: "outside", text: "it names another person's home folder" }, outside: [place] };
    const full = fold(paths.resolve(written));
    if (within(full, root)) continue;
    // The script, once: named a second time it's a word of something else.
    if (script && full === script && !scriptSeen) {
      scriptSeen = true;
      continue;
    }
    outside.push(place);
  }
  if (!outside.length) return { ok: true };
  // Named for what it is: a script an interpreter runs, in its skill's folder when it's one; else the place as written.
  const first = fold(paths.resolve(outside[0].replace(/^(?:~|\$HOME\b|\$\{HOME\})(?=$|[\\/])/, home)));
  const tilde = (p: string) => (within(p, fold(home)) ? `~${p.slice(home.length)}` : p);
  const scripts = (parseShell(command)?.list ?? []).map((x) => scriptOf(x.words)).filter((w): w is string => Boolean(w));
  const run = scripts.some((w) => fullPath(w, cwd, home, paths) !== undefined && fold(fullPath(w, cwd, home, paths)!) === first);
  const text = run ? `the script is outside the project, in ${tilde(skillFolder(first, fold(home), paths) ?? paths.dirname(first))}` : `it names ${tilde(first)}, outside the project`;
  return { ok: false, why: { kind: "outside", text }, outside };
}

/** A word as a full path: quotes off, home spelled out, from `cwd`. None for one the text can't settle (a variable, a substitution). */
function fullPath(word: string, cwd: string, home: string, paths: typeof posix) {
  const w = word.replace(/["']/g, "").replace(/^(?:~|\$HOME\b|\$\{HOME\})(?=$|[\\/])/, home);
  if (!w || /[$\u0001~`*?[]/.test(w)) return undefined;
  return paths.resolve(cwd, w);
}

/** The script of `node x.mjs …`, `python3 run.py …`: an interpreter named bare, its first word a file, never a flag (`-c`, `-e`). */
function scriptOf(words: string[]) {
  const program = (words[0] ?? "").replace(/["']/g, "");
  if (/[\\/]/.test(program) || !INTERPRETERS.test(program.toLowerCase().replace(ENDS_LIKE_A_PROGRAM, ""))) return undefined;
  const script = words[1];
  return script && !script.replace(/["']/g, "").startsWith("-") ? script : undefined;
}

/** The skill folder (`~/.agents/skills/<name>`) a full path is in, written in full; none outside every one, or for the folder itself. */
function skillFolder(full: string, home: string, paths: typeof posix) {
  for (const root of SKILL_ROOTS) {
    const base = paths.join(home, root);
    if (!full.startsWith(base + paths.sep)) continue;
    const rest = full.slice(base.length + 1);
    const name = rest.split(paths.sep)[0];
    if (/^[\w][\w.-]*$/.test(name) && rest.length > name.length + 1) return paths.join(base, name);
  }
  return undefined;
}

/**
  The skill grant (Auto only): offered when the one thing outside the project is a script under an installed skill's
  folder, run by an interpreter as a file, and everything else in the command is one Auto would run. The label is the
  folder with ~ (what the card says), `folder` the same in full (what routine() is given as `inside`).
*/
export function skillOffer(command: string, cwd: string, o: { platform?: NodeJS.Platform; home?: string } = {}) {
  const platform = o.platform ?? process.platform;
  const home = o.home ?? homedir();
  const paths = platform === "win32" ? win32 : posix;
  const j = judge(command, cwd, { platform, home });
  if (j.ok || j.why?.kind !== "outside" || !j.outside?.length || leavesMac(command)) return undefined;
  const places = new Set(j.outside.map((p) => paths.resolve(p.replace(/^(?:~|\$HOME\b|\$\{HOME\})(?=$|[\\/])/, home))));
  if (places.size !== 1) return undefined;
  const [place] = places;
  const folder = skillFolder(place, home, paths);
  if (!folder) return undefined;
  // That place is a script an interpreter runs, and nothing else names it.
  const parsed = parseShell(command);
  if (!parsed || parsed.redirect || parsed.assign || parsed.list.some((x) => SHELL_CHANGERS.test(programOf(x.words[0] ?? ""))) || !parsed.list.some((x) => scriptOf(x.words) && fullPath(scriptOf(x.words)!, cwd, home, paths) === place)) return undefined;
  if (!judge(command, cwd, { platform, home, inside: [folder] }).ok) return undefined;
  return { label: `~${folder.slice(home.length)}`, folder };
}

/** A command that reaches outside this Mac, each with what it does: a push, a merge or a post, a send, a copy to another machine. */
const OUTWARD: [RegExp, ApprovalWhy][] = [
  [/\bgit\s+push\b/i, { kind: "network", text: "it pushes to a remote" }],
  [/\bgh\s+(?:\w+\s+)?(?:merge|create|close|edit|comment|review|delete|reopen)\b/i, { kind: "network", text: "it changes something on GitHub" }],
  [/\bgh\s+api\b.*(?:-X|--method|-f\b|-F\b|--field|--input)/i, { kind: "network", text: "it sends a request to GitHub" }],
  [/\b(?:curl|wget)\b.*(?:\s-d\b|--data|\s-F\b|--form|\s-T\b|--upload-file|-X\s*(?:POST|PUT|DELETE|PATCH)|--post-)/i, { kind: "network", text: "it may send something out with curl or wget" }],
  [/\b(?:ssh|scp|rsync|sftp|nc)\s/i, { kind: "network", text: "it connects to another machine" }],
  [/\b(?:docker|podman)\s+push\b/i, { kind: "network", text: "it pushes an image to a registry" }],
];
/** OUTWARD's entry for curl and wget: the only one a proven plain fetch may clear (outwardOf). */
const CURL_OUT = OUTWARD[3][1];
/**
  The base's own test, kept exactly as it was (runtime.ts before grants): one case-insensitive pattern over the whole text.
  OUTWARD above is the same pattern split into its parts, for the reasons.
*/
const BASE_OUTWARD = /\bgit\s+push\b|\bgh\s+(?:\w+\s+)?(?:merge|create|close|edit|comment|review|delete|reopen)\b|\bgh\s+api\b.*(?:-X|--method|-f\b|-F\b|--field|--input)|\b(?:curl|wget)\b.*(?:\s-d\b|--data|\s-F\b|--form|\s-T\b|--upload-file|-X\s*(?:POST|PUT|DELETE|PATCH)|--post-)|\b(?:ssh|scp|rsync|sftp|nc)\s|\b(?:docker|podman)\s+push\b/i;

/**
  Why a command reaches outside this Mac, or none. Built so it's never less strict than the base: outward when the word
  reader says a curl or a wget sends (readerSends, which only ever adds), or when the base's pattern matches, unless the
  only thing it matched is curl's and wget's part and the command is proven to be plain fetches (provenPlainFetch). As
  written too, since what the plain text no longer shows (`git -c core.sshCommand='curl -d @.env …' fetch`) still runs.
*/
export function outwardOf(command: string): ApprovalWhy | undefined {
  if (readerSends(command)) return CURL_OUT;
  const texts = [command, plainGit(command)];
  if (!texts.some((c) => BASE_OUTWARD.test(c))) return undefined;
  const hits = OUTWARD.filter(([r]) => texts.some((c) => r.test(c))).map(([, why]) => why);
  const other = hits.find((why) => why !== CURL_OUT);
  if (other || !hits.length) return other ?? CURL_OUT;
  return provenPlainFetch(command) ? undefined : CURL_OUT;
}
/** Whether a command reaches outside this Mac (outwardOf). */
export const leavesMac = (command: string) => outwardOf(command) !== undefined;

/** Programs and builtins that set a variable for what runs after them, or change the shell itself. */
const SETTERS = /^(?:export|declare|typeset|readonly|local|set|unset|env)$/;
/** A word as the shell hands it over: its quotes taken out (`''--data` is `--data`, `c''url` is `curl`). */
const unquoted = (w: string) => w.replace(/["']/g, "");
/** A program's plain name: no folder, no Windows ending, lower case. */
const programOf = (w: string) => unquoted(w).split(/[\\/]/).pop()!.toLowerCase().replace(ENDS_LIKE_A_PROGRAM, "");

/**
  The word reader, an extra catch on top of the base's pattern: it may only add asks. A command with curl or wget in it
  sends when it can't be read for sure, when anything in it sets a variable (export, declare, env, an assignment: CURL_HOME,
  WGETRC, HOME and a proxy can all point it elsewhere), or when any curl or wget in it (as its program or handed to another,
  `xargs curl`) has a word that sends (sends).
*/
function readerSends(command: string) {
  if (!/\b(?:curl|wget)\b/i.test(unquoted(command))) return false;
  const parsed = parseShell(command);
  if (!parsed || !harmlessAssigns(parsed)) return true;
  for (const x of parsed.list) {
    if (SETTERS.test(programOf(x.words[0] ?? ""))) return true;
    for (let k = 0; k < x.words.length; k++) {
      const p = programOf(x.words[k]);
      if ((p === "curl" || p === "wget") && sends(p, x.words.slice(k + 1).map(unquoted))) return true;
    }
  }
  return false;
}

/** wget's long options that send or configure: it takes any unique start of a name (`--meth`, `--bod`, `--exec`). */
const WGET_SENDS = ["--post-data", "--post-file", "--body-data", "--body-file", "--method", "--config", "--execute"];
/** curl's long options that send something, read a config or put words together from files and variables. */
const CURL_SENDS = /^--(?:data|form|upload-file|json|config|post|body|expand-|variable|url-query|proto-default)/;

/**
  Whether one curl or wget sends or configures, by its words with their quotes out: curl's short d, F, T, K or t
  (telnet's options) anywhere in a cluster of flags (case and all: `-f` and `-sf` aren't `-F`), wget's -e, the long
  options above, a method other than GET or HEAD (-X, --request, --method), an address of any scheme but http, https and
  ftp (as a word or as --url), and a write-out format that writes a file (`%output{…}`). A value glued into a cluster
  that holds one of those letters counts too: wrong the safe way. Headers are read as before: not a send.
*/
function sends(program: "curl" | "wget", args: string[]) {
  const notGet = (v: string | undefined) => v === undefined || !/^(?:GET|HEAD)$/.test(v);
  const odd = (v: string | undefined) => v !== undefined && /^[A-Za-z][\w+.-]*:\/\//.test(v) && !/^(?:https?|ftp):\/\//i.test(v);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const [name, inline] = a.includes("=") ? [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)] : [a, undefined];
      const value = () => inline ?? args[i + 1];
      if (program === "wget") {
        const full = WGET_SENDS.find((w) => (name.length >= 4 && w.startsWith(name)) || name.startsWith(w));
        if (!full) continue;
        if (full === "--method" && !notGet(value())) continue;
        return true;
      }
      if (CURL_SENDS.test(name)) return true;
      if (/^--(?:method|request)$/.test(name) && notGet(value())) return true;
      if (name === "--url" && odd(value())) return true;
      if (name === "--write-out" && /%output\{/.test(value() ?? "")) return true;
      continue;
    }
    if (odd(a)) return true;
    if (!a.startsWith("-") || a === "-") continue;
    const letters = a.slice(1);
    if (program === "curl" ? /[dFTKt]/.test(letters) : /e/.test(letters)) return true;
    if (program !== "curl") continue;
    const x = letters.indexOf("X");
    if (x >= 0 && notGet(letters.slice(x + 1) || args[i + 1])) return true;
    const w = letters.indexOf("w");
    if (w >= 0 && /%output\{/.test(letters.slice(w + 1) || args[i + 1] || "")) return true;
  }
  return false;
}

/** curl's and wget's flags that only shape a fetch, alone and with a value (the next word, or glued for a short one). */
const FETCH_FLAGS = {
  curl: { alone: /^--(?:silent|show-error|location|fail|head|include|compressed|create-dirs)$/, takes: /^--(?:output|write-out|max-time|connect-timeout|retry)$/, short: "sSLfIi", shortTakes: "owm" },
  wget: { alone: /^(?:-nv|-nc|--quiet|--no-verbose|--continue|--timestamping|--show-progress|--no-clobber)$/, takes: /^--(?:output-document|directory-prefix|tries|timeout)$/, short: "qcN", shortTakes: "OPtT" },
};

/**
  The only thing that may clear the base's curl-and-wget match (outwardOf): the command reads for sure, sets no variable
  but the harmless kind (harmlessAssigns), holds nothing but fetches and COMPANIONS, and every curl or wget in it (each
  named in the text as such, no more) is its own program, made only of words unquoted or wholly quoted, each a flag on
  the short list above or an address: a literal http or https URL with its host written out, or localhost, any `$name`
  in them bound where the text shows its values (boundIn). Anything it doesn't know means not proven, and the base's
  answer stands.
*/
export function provenPlainFetch(command: string) {
  const parsed = parseShell(command);
  // Only 2>&1, 2>/dev/null and >/dev/null (which the parser doesn't count): the proof clears only what it reads in full.
  if (!parsed || parsed.redirect || !harmlessAssigns(parsed)) return false;
  const bound = boundIn(parsed);
  let fetches = 0;
  for (const x of parsed.list) {
    const program = x.words[0];
    // Beside the fetches, only programs that can't run what was fetched (`curl -o x.sh … && sh x.sh` isn't proven).
    if (program !== "curl" && program !== "wget") {
      if (!COMPANIONS.test(program ?? "")) return false;
      // cd only into the project: one literal relative path (capture 2's `cd .liner/designs/…/assets`), never home, `-`, a
      // variable, a glob or `..`, so what the fetch writes lands where the rest of the reading put it.
      if (program === "cd" && !(x.words.length === 2 && /^[A-Za-z0-9_.][A-Za-z0-9_./-]*$/.test(x.words[1]) && !x.words[1].split("/").includes(".."))) return false;
      continue;
    }
    if (!plainFetch(program, x.words.slice(1), bound)) return false;
    fetches++;
  }
  return fetches > 0 && (command.match(/\b(?:curl|wget)\b/gi) ?? []).length === fetches;
}

/** What may stand beside a proven fetch, named as is: programs that make a folder, print, look at files or wait, and run nothing. */
const COMPANIONS = /^(?:mkdir|cd|echo|stat|ls|test|true|false|sleep|wc|head|tail|du|file|basename|dirname|date|pwd)$/;

/**
  Whether every variable a command sets is one curl and wget can't feel, the one form the fetch proof and the word reader
  both let pass (so they agree). Each must be:
  - set with `=`, by a name all lower case that doesn't hold "proxy": curl and wget read their settings from upper-case
    names (CURL_HOME, HOME, WGETRC, SSL_CERT_FILE…) and from the lower-case *_proxy ones, and from nothing else lower
    case. So `home=/tmp/x` is safe: it isn't HOME, and a variable set on its own isn't exported to anything anyway;
  - a statement of its own, or a prefix of a command with no curl or wget in it that isn't a wrapper (capture 2's
    `code=$(curl …) echo …`, where only echo sees it);
  - valued with a plain word that expands nothing, or with one `$( … )` holding only curl and wget that are plain fetches.
  Anything else, a setter (export, declare, env…) included, means none pass.
*/
function harmlessAssigns(parsed: Parsed) {
  return parsed.assigns.every(({ word, target }) => {
    const m = /^([a-z][a-z0-9_]*)=(.*)$/s.exec(word);
    if (!m || m[1].includes("proxy")) return false;
    if (target && (WRAPPERS.test(programOf(target.words[0] ?? "")) || target.raw.some((w) => /\b(?:curl|wget)\b/i.test(unquoted(w))))) return false;
    const value = m[2];
    if (/^[A-Za-z0-9_.,:@%+=\/-]*$/.test(value)) return true;
    const sub = /^\u0001(\d+)\u0001$/.exec(value);
    const inside = sub ? parsed.subs[Number(sub[1])] : undefined;
    return Boolean(inside?.length && inside.every((x) => (x.words[0] === "curl" || x.words[0] === "wget") && x.raw.length === x.words.length && plainFetch(x.words[0], x.words.slice(1), boundIn(parsed))));
  });
}

/**
  The variables a command binds where the text shows their values: a `for name in <literal words>` loop's, and the lower-case
  names harmlessAssigns lets pass. The only ones a proven plain fetch may use; `$GH_PAT`, `$1`, `${…}` are none of them.
*/
function boundIn(parsed: Parsed) {
  const names = new Set<string>();
  for (const l of parsed.loops) if (l.literal && /^[a-z][a-z0-9_]*$/.test(l.name)) names.add(l.name);
  for (const a of parsed.assigns) {
    const m = /^([a-z][a-z0-9_]*)=/.exec(a.word);
    if (m) names.add(m[1]);
  }
  return names;
}

function plainFetch(program: "curl" | "wget", words: string[], bound: Set<string>) {
  const f = FETCH_FLAGS[program];
  // Unquoted, or quoted whole with nothing glued to a quote: what's read is what the shell hands over.
  // Every `$` in it a bound name (boundIn), read the shell's way: the longest name it can. Single quotes expand nothing.
  const vars = (w: string) => w.startsWith("'") || !w.replace(/\$([a-z][a-z0-9_]*)/g, (all, name: string) => (bound.has(name) ? "" : all)).includes("$");
  const whole = (w: string | undefined) => w !== undefined && !w.includes("\u0001") && (/^[^'"]*$/.test(w) || /^'[^']*'$/.test(w) || /^"[^"]*"$/.test(w)) && vars(w);
  const bare = (w: string) => w.replace(/^(["'])(.*)\1$/, "$2");
  const format = (v: string) => !/%output\{/.test(v) && !v.startsWith("@");
  let addresses = 0;
  for (let i = 0; i < words.length; i++) {
    if (!whole(words[i])) return false;
    const a = bare(words[i]);
    if (f.alone.test(a)) continue;
    if (a.startsWith("--")) {
      const [name, inline] = a.includes("=") ? [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)] : [a, undefined];
      if (!f.takes.test(name)) return false;
      if (inline === undefined && !whole(words[++i])) return false;
      if (name === "--write-out" && !format(inline ?? bare(words[i]))) return false;
      continue;
    }
    if (a.startsWith("-")) {
      if (a.length < 2) return false;
      for (let k = 1; k < a.length; k++) {
        if (f.short.includes(a[k])) continue;
        if (!f.shortTakes.includes(a[k])) return false;
        const glued = a.slice(k + 1);
        if (!glued && !whole(words[++i])) return false;
        if (a[k] === "w" && !format(glued || bare(words[i]))) return false;
        break;
      }
      continue;
    }
    if (!/^https?:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:[/?#]|$)/.test(a) && !/^(?:localhost|127\.0\.0\.1)(?::\d+)?(?:[/?#]|$)/.test(a)) return false;
    addresses++;
  }
  return addresses > 0;
}

/**
  A command as the shell reads it, to the depth the grants need: each simple command (a pipe's or a chain's part, one in
  a `$( )` too) with its words, quotes kept, a substitution as \u0001, and what it starts with (keywords, variables set)
  taken off. Flags say what else was there. None when the text can't be read for sure: an unclosed quote, a backslash,
  a backtick, `$'…'`, a subshell, braces, a heredoc or a process substitution, a comment, `case` or `function`.
  T3 Code hands this to OpenCode, whose bash tool parses each command with tree-sitter and asks for each part on its own
  (packages/opencode/src/tool/bash.ts); this is the small part of that the grants need, refusing what it doesn't know.
*/
/** `fed`: what a pipe hands it is its input (it follows a `|`). */
type Simple = { words: string[]; raw: string[]; nested: boolean; fed: boolean };
/**
  `assigns`: every variable set, as written (`code=$(…)`), with the command it's a prefix of (`target`), none when it's a
  statement of its own. `subs`: what each `$( )` holds, by the number in its placeholder (\u0001<n>\u0001).
*/
type Parsed = { list: Simple[]; subst: boolean; keyword: boolean; assign: boolean; redirect: boolean; background: boolean; seps: string[]; assigns: { word: string; target?: Simple }[]; subs: Simple[][]; loops: { name: string; literal: boolean }[] };
const UNREADABLE = new Error("unreadable");
export function parseShell(command: string): Parsed | undefined {
  const s = command;
  const out: Parsed = { list: [], subst: false, keyword: false, assign: false, redirect: false, background: false, seps: [], assigns: [], subs: [], loops: [] };
  let i = 0;
  const fail = (): never => {
    throw UNREADABLE;
  };
  const push = (words: string[], nested: boolean, fed: boolean) => {
    let k = 0;
    const set: string[] = [];
    while (k < words.length) {
      const w = words[k];
      if (/^(?:do|then|else|elif|if|while|until|!|done|fi)$/.test(w)) {
        out.keyword = true;
        k++;
      } else if (/^(?:for|select)$/.test(w)) {
        // A loop's head names no command: what it loops over is read where it's a substitution. Its variable is kept, and
        // whether the text shows every value it takes (`for id in a b`, no expansion), for provenPlainFetch.
        out.keyword = true;
        const values = words[k + 2] === "in" ? words.slice(k + 3) : undefined;
        if (words[k + 1]) out.loops.push({ name: words[k + 1], literal: Boolean(values?.length && values.every((v) => /^[A-Za-z0-9_.,:@%+=\/-]+$/.test(v))) });
        k = words.length;
      } else if (/^(?:case|esac|function|coproc|\[\[|\]\])$/.test(w)) fail();
      else if (/^[A-Za-z_][A-Za-z0-9_]*\+?=/.test(w)) {
        out.assign = true;
        set.push(w);
        k++;
      } else break;
    }
    const target = k < words.length ? { words: words.slice(k), raw: words, nested, fed } : undefined;
    if (target) out.list.push(target);
    for (const word of set) out.assigns.push({ word, target });
  };
  const dollar = (): string => {
    const next = s[i + 1];
    if (next === "(") {
      if (s[i + 2] === "(") fail();
      i += 2;
      out.subst = true;
      const from = out.list.length;
      const id = out.subs.push([]) - 1;
      list(true);
      out.subs[id] = out.list.slice(from);
      return `\u0001${id}\u0001`;
    }
    if (next === "'" || next === '"') fail();
    if (next === "{") {
      const end = s.indexOf("}", i);
      if (end < 0 || /[(\s"'`$\\{]/.test(s.slice(i + 2, end))) fail();
      const w = s.slice(i, end + 1);
      i = end + 1;
      return w;
    }
    i++;
    return "$";
  };
  const dquote = () => {
    let w = '"';
    i++;
    for (;;) {
      if (i >= s.length) fail();
      const ch = s[i];
      if (ch === '"') {
        i++;
        return `${w}"`;
      }
      if (ch === "\\" || ch === "`") fail();
      if (ch === "$") w += dollar();
      else {
        w += ch;
        i++;
      }
    }
  };
  const token = () => {
    let w = "";
    while (i < s.length) {
      const ch = s[i];
      if (/[\s;&|()<>]/.test(ch)) break;
      if (ch === "{" || ch === "}" || ch === "`" || ch === "\\" || (ch === "#" && !w)) fail();
      if (ch === "'") {
        const end = s.indexOf("'", i + 1);
        if (end < 0) fail();
        w += s.slice(i, end + 1);
        i = end + 1;
      } else if (ch === '"') w += dquote();
      else if (ch === "$") w += dollar();
      else {
        w += ch;
        i++;
      }
    }
    return w;
  };
  function list(nested: boolean) {
    let words: string[] = [];
    let before = "";
    const end = (sep: string) => {
      push(words, nested, before === "|");
      before = sep;
      words = [];
      if (!nested) out.seps.push(sep);
    };
    while (i < s.length) {
      const ch = s[i];
      if (ch === " " || ch === "\t") i++;
      // The shell reads a carriage return as part of a word, not as a break: text with one can't be read for sure here.
      else if (ch === "\r") fail();
      else if (ch === "\n" || ch === ";") {
        end(ch === ";" ? ";" : "\n");
        i++;
      } else if (ch === "&") {
        if (s[i + 1] === "&") {
          end("&&");
          i += 2;
        } else if (s[i + 1] === ">") fail();
        else {
          out.background = true;
          end("&");
          i++;
        }
      } else if (ch === "|") {
        if (s[i + 1] === "&") fail();
        const two = s[i + 1] === "|";
        end(two ? "||" : "|");
        i += two ? 2 : 1;
      } else if (ch === ")") {
        if (!nested) fail();
        push(words, nested, before === "|");
        i++;
        return;
      } else if (ch === "(") fail();
      else if (ch === "<" || ch === ">") {
        // Its file descriptor, when the word before is one digit written right up to it (2>).
        const fd = words.length && /^\d$/.test(words[words.length - 1]) && /\d/.test(s[i - 1] ?? "") ? words.pop()! : "";
        let op = ch;
        i++;
        if (s[i] === "(" || (ch === "<" && s[i] === "<")) fail();
        if (ch === ">" && (s[i] === ">" || s[i] === "|")) i++;
        else if (s[i] === "&") {
          op += "&";
          i++;
        }
        while (s[i] === " " || s[i] === "\t") i++;
        const target = token();
        if (!target) fail();
        // Thrown away, or the errors joined to what it prints: neither writes anything.
        const spare = (op === ">" && /^[12]?$/.test(fd) && target === "/dev/null") || (op === ">&" && fd === "2" && target === "1");
        if (!spare) out.redirect = true;
      } else {
        const w = token();
        if (!w) fail();
        words.push(w);
      }
    }
    if (nested) fail();
    end("");
  }
  try {
    list(false);
  } catch (e) {
    if (e === UNREADABLE) return undefined;
    throw e;
  }
  return out;
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
  // Runners that run whatever follows them: zsh's noglob and nocorrect, macOS's caffeinate, arch and taskpolicy, and the like.
  "noglob|nocorrect|caffeinate|arch|taskpolicy|ionice|renice|chrt|stdbuf|unbuffer|script|watch|flock|setsid|chroot|gtimeout|gnice|sandbox-exec",
  "cmd|powershell|pwsh|wsl|start|call|runas|forfiles|cscript|wscript|mshta|rundll32|regsvr32|msiexec|iex|invoke-expression|icm|invoke-command|saps|start-process",
].join("|")})$`);
/** Interpreters: what they run is in their arguments, so a rule is for those arguments and no others, or `python x.py` would allow `python -c …`. */
const INTERPRETERS = /^(python[\d.]*|py|pypy[\d.]*|node|nodejs|ruby|perl|php|lua|rscript|osascript)$/;

/**
  The rule a command gets: one real command (ruleOne's rule, as the base gave single commands), optionally followed by
  `2>&1`, `2>/dev/null`, `>/dev/null` and by pipe parts that are strict filters (strictFilter). Any `&&`, `||`, `;` or new
  line, any other redirect, a substitution, a loop or a variable set: no rule at all, as the base had it, but for the
  base's own stripping of a leading `cd <dir> &&`. A list of what changes the shell can't be complete (printf -v, read in
  a pipe, mapfile, emulate…), so nothing that could be one is ever chained to a grant. The label is that one command's
  rule, and a later command is allowed by it only in the same shape (the runtime's matcher calls this too). Kept as a
  list of one for the callers that take one.
*/
export function ruleParts(command: string): string[] | undefined {
  const one = ruleOne(command);
  if (one) return [one];
  const c = command.trim().replace(CD_FIRST, "");
  const p = parseShell(c);
  if (!p || p.subst || p.keyword || p.assign || p.redirect || p.background || !p.list.length || commandRisk(command) === "high") return undefined;
  // A pipe and nothing else between the parts.
  if (p.seps.slice(0, -1).some((sep) => sep !== "|")) return undefined;
  const [first, ...tails] = p.list;
  if (!tails.every(strictFilter)) return undefined;
  const rule = ruleOne(first.words.join(" "));
  return rule ? [rule] : undefined;
}

/** The base's leading `cd <dir> &&`, which a single command's rule has always looked past. */
const CD_FIRST = /^(?:cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*&&\s*)+/;
/** Builtins that change the shell for what follows (a variable, an alias, a trap, the folder) or run something else. */
const SHELL_CHANGERS = /^(?:export|declare|typeset|readonly|local|set|unset|shopt|setopt|hash|trap|alias|unalias|eval|exec|source|\.|builtin|command|enable|cd|pushd|popd)$/;
/** A pattern or a set as written: plain, or quoted whole, with nothing in it the shell expands. */
const LITERAL = /^(?:[^\s'"$`\\\u0001]+|'[^'$`\u0001]*'|"[^"$`\\\u0001]*")$/;
/** One character, plain or quoted whole: a delimiter. */
const ONE_CHAR = /^(?:[^\s'"$`\\\w]|'[^'$`]'|"[^"$`\\]")$/;
/**
  What each filter may be given, and nothing else (no file, no program, no long option):
  - head, tail: -n N, -c N (glued or apart), -N, -q
  - wc: -l -w -c -m, alone or together
  - sort: -r -n -u -f -b -h, alone or together; -k with a key (2, 2,3, 2n); -t with one character
  - uniq: -c -d -i -u, alone or together
  - cut: -d with one character; -f, -c, -b with a list of numbers (1,3-5); -s
  - tr: -d -s -c -C, alone or together, then one or two sets, each a literal
  - grep: -i -v -n -E -F -c -o -w -x -q -s, alone or together, then exactly one pattern, a literal, and nothing after it
*/
function strictFilter(x: Simple) {
  const [program, ...args] = x.words;
  if (!x.fed || !/^(?:head|tail|wc|sort|uniq|cut|tr|grep)$/.test(program ?? "")) return false;
  const cluster = (a: string, letters: string) => a.length > 1 && a.startsWith("-") && [...a.slice(1)].every((ch) => letters.includes(ch));
  const num = (a: string | undefined) => a !== undefined && /^\d+$/.test(a);
  const list = (a: string | undefined) => a !== undefined && /^[\d,-]+$/.test(a);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (program === "head" || program === "tail") {
      if (/^-\d+$/.test(a) || a === "-q" || /^-[nc]\d+$/.test(a)) continue;
      if ((a === "-n" || a === "-c") && num(args[i + 1])) i++;
      else return false;
    } else if (program === "wc") {
      if (!cluster(a, "lwcm")) return false;
    } else if (program === "sort") {
      if (cluster(a, "rnufbh")) continue;
      if (a === "-k" && /^\d+(?:\.\d+)?[bdfghinMRrV]*(?:,\d+(?:\.\d+)?[bdfghinMRrV]*)?$/.test(args[i + 1] ?? "")) i++;
      else if (a === "-t" && ONE_CHAR.test(args[i + 1] ?? "")) i++;
      else return false;
    } else if (program === "uniq") {
      if (!cluster(a, "cdiu")) return false;
    } else if (program === "cut") {
      if (a === "-s" || /^-[fcb][\d,-]+$/.test(a) || /^-d[^\s'"$`\\\w]$/.test(a)) continue;
      if (/^-[fcb]$/.test(a) && list(args[i + 1])) i++;
      else if (a === "-d" && ONE_CHAR.test(args[i + 1] ?? "")) i++;
      else return false;
    } else if (program === "tr") {
      if (cluster(a, "dscC")) continue;
      const sets = args.slice(i);
      return sets.length >= 1 && sets.length <= 2 && sets.every((w) => LITERAL.test(w) && !w.startsWith("-"));
    } else {
      // grep: its flags, then exactly one pattern and nothing after it.
      if (cluster(a, "ivnEFcowxqs")) continue;
      return i === args.length - 1 && LITERAL.test(a) && !a.startsWith("-");
    }
  }
  return program !== "tr" && program !== "grep";
}

/** The rule's label: the one command's rule. */
export function ruleFor(command: string): string | undefined {
  return ruleParts(command)?.join(", ");
}

/**
  What "Don't ask again for … this session" would allow for one command: a single plain command, named by its
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
function ruleOne(command: string): string | undefined {
  const c = command.trim().replace(/^(?:cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*&&\s*)+/, "");
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(c)) return undefined;
  if (!c || /[&;|<>`\r\n]|\$\(/.test(c)) return undefined;
  const [first, ...rest] = shellWords(c);
  if (!first) return undefined;
  const path = first.replace(/["']/g, "");
  if (/[$%]/.test(path)) return undefined;
  const file = path.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  const name = file.replace(ENDS_LIKE_A_PROGRAM, "");
  if (WRAPPERS.test(name) || SHELL_CHANGERS.test(name)) return undefined;
  const head = name !== file && !/[\\/]/.test(path) ? name : first;
  const whole = () => (commandRisk(c) === "high" ? undefined : [head, ...rest].join(" "));
  // An interpreter with nothing to run but what it's handed (alone, `-`, flags only) would run whatever comes next time.
  if (INTERPRETERS.test(name)) return rest.some((w) => w !== "-" && !w.startsWith("-")) ? whole() : undefined;
  if (SUB.test(name) && /^[-+]/.test(rest[0] ?? "")) {
    // `git -C app status` has no subcommand to name: the rule would be `git`, for every git command written that way.
    if (name === "git") return undefined;
    // The same goes for `make -j8 test` or `npm --prefix ui run build`, where a flag's value can't be told from a
    // subcommand, and `cargo +nightly test`: the rule is the whole command, which allows that one again and nothing else.
    return whole();
  }
  return SUB.test(name) && rest[0] ? `${head} ${rest[0]}` : head;
}
