/*
  How risky a tool call is, for the approval card: high risk approves with a hold instead of a
  press, and in Full access the guard still asks about anything that can't be undone. Each table
  carries why it matched, so what the card says came from the check that decided (approval `why`).
*/
import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import { ACCESS_NAMES, type ApprovalWhy, type Risk, type ToolKind } from "../../contracts/src/index.ts";

/**
  Any start of a long flag's name as a pattern, `--h` up to `--hard`: git's parse-options takes each start only that flag
  begins with (`git reset --h` is --hard, `git clean --f` is --force, `git restore --sta --work` throws the worktree away).
*/
const startOf = (name: string) => `--${name[0]}` + [...name.slice(1)].reduceRight((rest, ch) => `(?:${ch}${rest})?`, "");

/** Gone for good: the text completes "Can't be undone: …". */
const HIGH: [RegExp, string][] = [
  // rm recursive and forced, however its flags are written: -rf, -r -f, -Rfv, --recursive --force,
  // and the --rec --f that GNU rm takes for them.
  [/\brm\b(?=[^;&|\n]*\s(?:-[a-zA-Z]*[rR][a-zA-Z]*|--r[a-z]*)\b)(?=[^;&|\n]*\s(?:-[a-zA-Z]*f[a-zA-Z]*|--f[a-z]*)\b)/, "deletes files for good"],
  [/\brm\s+-[a-z]*r\b.*\s(\/|~|\$HOME|\.\.?)(\s|$)/i, "deletes a whole folder for good"],
  // A refspec with a + in front (`git push origin +main`) forces that one.
  [/\bgit\s+push\b.*(--force|-f\b|--force-with-lease|\s\+[^\s;&|])/i, "writes over what the remote had"],
  [new RegExp(String.raw`\bgit\s+reset\b[^;&|\n]*\s${startOf("hard")}\b`, "i"), "throws away changes that aren't committed"],
  [new RegExp(String.raw`\bgit\s+clean\b[^;&|\n]*\s(?:-[a-zA-Z]*f[a-zA-Z]*|${startOf("force")})\b`, "i"), "deletes the files git doesn't track"],
  // What throws away work git can't give back: changes not committed, stashes, unmerged branches.
  // [^;&|\n]* keeps a rule to the one command, so a later one in a chain isn't read as its flag.
  [/\bgit\s+branch\b[^;&|\n]*\s-[a-zA-Z]*D/, "deletes a branch that may not be merged"],
  [new RegExp(String.raw`\bgit\s+branch\b(?=[^;&|\n]*\s(?:-[a-zA-Z]*d|${startOf("delete")})\b)(?=[^;&|\n]*\s(?:-[a-zA-Z]*f|${startOf("force")})\b)`), "deletes a branch that may not be merged"],
  [/\bgit\s+checkout\b[^;&|\n]*\s--(?:\s|$)/, "throws away changes that aren't committed"],
  [/\bgit\s+checkout\b[^;&|\n]*\s\.(?:\/[^\s;&|]*)?(?=[\s;&|]|$)/, "throws away changes that aren't committed"],
  [new RegExp(String.raw`\bgit\s+checkout\b[^;&|\n]*\s(?:-f|${startOf("force")})\b`), "throws away changes that aren't committed"],
  // git restore puts back the working tree unless it's told only --staged (the index).
  [/\bgit\s+restore\b(?![^;&|\n]*\s(?:--staged|-S)\b)/, "throws away changes that aren't committed"],
  [new RegExp(String.raw`\bgit\s+restore\b(?=[^;&|\n]*\s(?:${startOf("worktree")}|-W)\b)`), "throws away changes that aren't committed"],
  [/\bgit\s+stash\s+(?:clear|drop)\b/, "throws away stashed changes"],
  [new RegExp(String.raw`\bgit\s+switch\b[^;&|\n]*\s(?:${startOf("discard-changes")}|-f|${startOf("force")})\b`), "throws away changes that aren't committed"],
  [new RegExp(String.raw`\bgit\s+worktree\s+remove\b[^;&|\n]*\s(?:${startOf("force")}|-f)\b`), "removes a worktree with its changes"],
  [/\bfind\b[^;&|\n]*\s['"]?-delete\b/, "deletes files for good"],
  [/\bfind\b[^;&|\n]*\s['"]?-exec(?:dir)?['"]?\s+['"]?rm\b/, "deletes files for good"],
  [/\bsudo\b/, "runs as the administrator"],
  [/\bmkfs\b|\bdd\s+if=/, "writes over a disk"],
  [new RegExp(String.raw`\bchmod\s+(?:-R|${startOf("recursive")})\s+777\b`), "opens every file in a folder to anyone"],
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
  [new RegExp(String.raw`\bgit\s+branch\b[^;&|\n]*\s(?:-d|${startOf("delete")})\b`), { kind: "changes", text: "it deletes a branch" }],
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
    // Not a cd into git's own folder: a shell the tool keeps between commands writes the next one's `config` there.
    const cd = /^cd\s+(\S+)$/.exec(part.trim());
    if (cd && intoGit(cd[1].replace(/\u0000(\d+)\u0000/g, (_, i: string) => quoted[Number(i)]))) return false;
    const p = part.trim().replace(/^cd\s+\S+$/, "pwd");
    const words = p.split(/\s+/).map((w) => w.replace(/\u0000(\d+)\u0000/g, (_, i: string) => quoted[Number(i)]));
    // A whole word: tree-sitter, cat-file-writer and the like are programs of their own.
    if (/^(pwd|ls|cat|head|tail|wc|nl|grep|stat|echo)(?=\s|$)/.test(p)) return true;
    // rg --pre and --hostname-bin run a command; tree -o, file -C and git --output write a file. Long flags by any
    // start of their name too (longFlagOf): getopt_long and git take `--comp` for `--compile`.
    if (/^rg(?=\s|$)/.test(p)) return !words.some((w) => longFlagOf(w, ["pre", "hostname-bin"]));
    if (/^tree(?=\s|$)/.test(p)) return !words.some((w) => /^-[^-]*[oRH]/.test(w) || longFlagOf(w, ["output", "fromfile"]));
    if (/^file(?=\s|$)/.test(p)) return !words.some((w) => /^-[^-]*C/.test(w) || longFlagOf(w, ["compile"]));
    if (/^sed(?=\s|$)/.test(p)) return sedReads(words);
    // Read off the words with their quotes put back, so a quoted '-delete' is seen too.
    if (/^find(?=\s|$)/.test(p)) return !words.some((w) => /^-(delete|exec|ok|fprint|fls)/.test(w));
    if (/^git\s+branch(?=\s|$)/.test(p)) return branchLists(words.slice(2));
    return /^git\s+(status|diff|log|show|ls-files|rev-parse)(?=\s|$)/.test(p) && !words.some((w) => longFlagOf(w, ["output", "ext-diff"]));
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
  Named any way the shell or a program could make the name: with quotes in it, as a pattern or a variable that could
  stand for one (patternNamesSecret), .envrc, a search for what reads like a key, or a variable named like one.
*/
export function namesSecret(command: string) {
  // The name as written, and as the shell hands it over with its quotes out (`.e""nv` is `.env`).
  for (const text of [command, ...shellWords(command).map(unquoted)]) {
    for (const m of text.matchAll(ENV_NAME)) {
      const name = m[1];
      const next = text[m.index + m[0].length] ?? "";
      if (next === "/" || next === "\\") continue;
      if (/\.example$/i.test(name) || /(?:^|\.)(?:process|meta)\.env(?:\.|$)/.test(name)) continue;
      return true;
    }
  }
  // direnv's .envrc holds keys as often as .env does.
  if (/(?:^|[^\w.-])[\w.-]*\.envrc(?![\w.-])/i.test(command)) return true;
  // A search for what reads like a key (`grep -r API_KEY .`): what it prints is the key's line.
  if (GREPS.test(command) && secretish(command)) return true;
  // A variable named like a key (`echo $OPENAI_API_KEY`) prints the key.
  for (const m of command.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)/g)) if (secretish(m[1])) return true;
  return patternNamesSecret(command);
}

/** A name that reads like a key, a token or a password, as a search pattern or a variable has it (API_KEY, apiKey, GH_TOKEN, accessToken), not tokenize or monkey. */
const secretish = (s: string) => /(?:^|[^a-z])keys?(?:[^a-z]|$)|apikey|token(?![a-z])|secret|passw|credential/i.test(s) || /[a-z]Keys?(?![a-z])/.test(s);
/** Variables the shell sets to what's no .env file: a folder, a name. */
const PLAIN_VARS = /\$\{?(?:HOME|PWD|OLDPWD|USER|LOGNAME|TMPDIR|SHELL)\b\}?/g;
/** What a pattern ends with, written out, that no .env file ends with: code, documents, pictures. */
const CODE_END = /\.(?:[cm]?[jt]sx?|d\.ts|md|mdx|txt|py|go|rs|rb|java|kt|swift|c|h|cc|cpp|hpp|cs|php|css|scss|less|html|vue|svelte|astro|sh|sql|svg|png|jpe?g|gif|webp|ico|lua|ex|exs|dart|zig|log|csv|example|sample|template)$/i;
/** A program that searches files' text, as a word of a command. */
const GREPS = /(?:^|[\s;&|(`"'])(?:[ef]?grep|rg|ag|ack|findstr|select-string|sls)(?=[\s;&|)`"']|$)/i;

/**
  Whether a word the shell or the program fills in (a pattern `*`, `?`, `[…]`, a `{a,b}`, a variable or a substitution)
  could stand for a .env name: `cat .e*v`, `cat .en[v]`, `tail .e?v.local`, `cat .e${X}nv`. Read off the word's last
  part, with each such piece standing for any text. A search's own pattern, quoted whole so the shell leaves it alone
  (`grep -rn "foo.*bar" src`), is a pattern for the text, not a name, and isn't read; one written bare is, since the
  shell expands it to file names first.
*/
function patternNamesSecret(command: string) {
  // Command by command (a quoted separator splits too early, which only ever reads more words as names).
  for (const part of command.split(/[;&|\r\n]/)) {
    const words = shellWords(part);
    // Searches and git match their own arguments against file names (`rg -g '.e*'`, `grep --include`, a pathspec), so in
    // them a quoted pattern counts too. Elsewhere only what the shell fills in: what isn't quoted, and what's in double
    // quotes when a `$` or a backtick is in them; text quoted plainly is dropped, which only lets the rest match more.
    const globs = words.some((w) => /^(?:[ef]?grep|rg|ag|ack|git|fd)$/i.test(unquoted(w)));
    let pattern = false;
    for (let i = 0; i < words.length; i++) {
      const raw = words[i];
      const w = globs ? unquoted(raw) : raw.replace(/'[^']*'/g, "").replace(/"([^"]*)"/g, (_, inner: string) => (/[$`]/.test(inner) ? inner : ""));
      if (/^(?:[ef]?grep|rg|ag|ack)$/i.test(w)) {
        pattern = true;
        continue;
      }
      // The search's pattern: its first word that isn't a flag, quoted whole, right after the program or flags that take
      // no value (so `rg -g '.e*'`, a flag's value, is still read as a name). -e and -f give the pattern another way.
      if (pattern && w.startsWith("-")) {
        if (!/^-[rRnliwvcosFEHhIsUP]+$|^--(?:line-number|ignore-case|recursive|count|fixed-strings|extended-regexp|word-regexp|no-heading|with-filename|smart-case)$/.test(w)) pattern = false;
        continue;
      }
      if (pattern) {
        pattern = false;
        if (/^'[^']*'$|^"[^"$`]*"$/.test(raw)) continue;
      }
      const filled = w.replace(PLAIN_VARS, "x");
      if (!/[*?[{$`]/.test(filled)) continue;
      const last = filled.split(/[\\/]/).pop() ?? "";
      // `*.ts`, `src/*.md`: what's written after the last pattern piece says it's code, not a key's file.
      if (CODE_END.test(/[^*?\]}$`]*$/.exec(last)?.[0] ?? "")) continue;
      if (globCouldBeEnv(last)) return true;
    }
  }
  return false;
}

/**
  Whether a pattern could match a .env name: anything with `.env` at its end or followed by a dot, or `.envrc`. Read as
  one machine over both, the pattern's pieces against the name's, with letters standing for themselves (any case: a
  Mac's disk doesn't tell them apart) and `*`, `?`, a set, a `{…}` or a `$…` for what they can be.
*/
function globCouldBeEnv(pattern: string) {
  // Each piece: "*" any text, "?" one character, or the characters it may be ("x" standing for any other character).
  type Piece = { star: true } | { star: false; can: Set<string> };
  const REPS = [".", "e", "n", "v", "r", "c", "x"];
  const rep = (ch: string) => (REPS.includes(ch) ? ch : "x");
  const pieces: Piece[] = [];
  const p = pattern.toLowerCase();
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ch === "*" || ch === "{" || ch === "$" || ch === "`") {
      pieces.push({ star: true });
      // A `{…}`, `${…}` or `$(…)` stands for any text up to where it closes; a `$name` up to the name's end.
      const close = ch === "{" ? p.indexOf("}", i) : p[i + 1] === "{" ? p.indexOf("}", i) : p[i + 1] === "(" ? p.indexOf(")", i) : ch === "`" ? p.indexOf("`", i + 1) : -1;
      if (close > i) i = close;
      else if (ch === "$") while (/[a-z0-9_]/.test(p[i + 1] ?? "")) i++;
    } else if (ch === "?") pieces.push({ star: false, can: new Set(REPS) });
    else if (ch === "[" && p.indexOf("]", i + 2) > i) {
      const end = p.indexOf("]", i + 2);
      let body = p.slice(i + 1, end);
      const not = /^[!^]/.test(body);
      if (not) body = body.slice(1);
      const has = new Set<string>();
      for (let k = 0; k < body.length; k++) {
        if (body[k + 1] === "-" && body[k + 2]) {
          for (let c = body.charCodeAt(k); c <= body.charCodeAt(k + 2); c++) has.add(rep(String.fromCharCode(c)));
          k += 2;
        } else has.add(rep(body[k]));
      }
      // Negated, a set may be any character it doesn't name, and always some other one.
      pieces.push({ star: false, can: new Set(not ? REPS.filter((r) => r === "x" || !has.has(r)) : [...has]) });
      i = end;
    } else pieces.push({ star: false, can: new Set([rep(ch)]) });
  }
  // The name's machine: 0 anything so far, 1 ".", 2 ".e", 3 ".en", 4 ".env" (a match), 5 ".env." and then anything (a match), 6 ".envr", 7 ".envrc" (a match).
  const step = (s: number, c: string): number[] => {
    if (s === 0) return c === "." ? [0, 1] : [0];
    if (s === 5) return [5];
    const next: Record<number, [string, number][]> = { 1: [["e", 2]], 2: [["n", 3]], 3: [["v", 4]], 4: [[".", 5], ["r", 6]], 6: [["c", 7]] };
    return (next[s] ?? []).filter(([ch]) => ch === c).map(([, to]) => to);
  };
  const seen = new Set<string>();
  const todo: [number, number][] = [[0, 0]];
  while (todo.length) {
    const [i, s] = todo.pop()!;
    const key = `${i}:${s}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (i === pieces.length) {
      if (s === 4 || s === 5 || s === 7) return true;
      continue;
    }
    const piece = pieces[i];
    if (piece.star) {
      todo.push([i + 1, s]);
      for (const c of REPS) for (const t of step(s, c)) todo.push([i, t]);
    } else for (const c of piece.can) for (const t of step(s, c)) todo.push([i + 1, t]);
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
  What Auto runs without asking on a tool with no safety check of its own (OpenCode and the other ACP tools, Antigravity,
  Claude Code through another maker's API). An allowlist on top of a floor: the floor is the old check (rated low, or
  medium only for a commit or an install from the lock file; naming no place outside its folder; none of the few a low
  rating says too little about), and on top of it every part of the command must be one the list knows (unknownWhy:
  KNOWN's programs and subcommands, with only literal words, redirects into the folder, and `cd` into a subfolder).
  Anything else comes to you, never the other way round. All of it is read off the text, as the rating is: what the text
  can't vouch for comes to you, and a pattern that only looks like a path (`grep "/api/"`) does too.
  Not everything it lets through stays on the Mac: an install from the project's own lists (npm ci, pnpm install, yarn)
  reaches the package registry and runs the packages' install scripts, and a build or test runs the project's own
  scripts and config. That's the trade-off taken for Auto: what the project already says to install and run.
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
  // Rated medium only for a commit or an install from the lock file, when every part is one of those or low; the
  // allowlist below still has to know each part.
  if (rated.risk === "high" || (rated.risk === "medium" && !localMedium(command, platform))) return { ok: false, why: rated.why };
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
  if (!outside.length) {
    // All of the above is the floor. What passes it still runs only when every part of it is one the list knows.
    const why = unknownWhy(command, { platform, paths, fold, root, script, cwd, home });
    return why ? { ok: false, why } : { ok: true };
  }
  // Named for what it is: a script an interpreter runs, in its skill's folder when it's one; else the place as written.
  const first = fold(paths.resolve(outside[0].replace(/^(?:~|\$HOME\b|\$\{HOME\})(?=$|[\\/])/, home)));
  const tilde = (p: string) => (within(p, fold(home)) ? `~${p.slice(home.length)}` : p);
  const scripts = (parseShell(command)?.list ?? []).map((x) => scriptOf(x.words)).filter((w): w is string => Boolean(w));
  const run = scripts.some((w) => fullPath(w, cwd, home, paths) !== undefined && fold(fullPath(w, cwd, home, paths)!) === first);
  const text = run ? `the script is outside the project, in ${tilde(skillFolder(first, fold(home), paths) ?? paths.dirname(first))}` : `it names ${tilde(first)}, outside the project`;
  return { ok: false, why: { kind: "outside", text }, outside };
}

/*
  The allowlist. A command is known only when every part of it is: each simple command (a pipe's stage, a chain's part
  after &&, ||, ; or a new line) a program on the list below, named bare, with the subcommands and flags it allows, and
  every word literal. Nothing the shell fills in ($ of any kind, a substitution, a backtick, ~, a bare glob, a brace), no
  redirect but into the folder or /dev/null (and 2>&1), no variable set, no loop or background job, `cd` only into a
  subfolder named literally. Interpreters, shells, wrappers, the network's programs, and settings beyond the project are
  on no list. Windows's commands, PowerShell's or cmd's, get a shorter list still (windowsWhy).
*/

/** Why Auto left a command it doesn't know to you, by the first thing it didn't know. */
const UNKNOWN: ApprovalWhy = { kind: "level", text: `${ACCESS_NAMES.auto} runs only the everyday commands it knows for a tool with no safety check of its own` };
const FILLS_IN: ApprovalWhy = { kind: "level", text: "the shell fills in part of it (a variable, a substitution, a pattern), so the text can't say what it does" };
const RUNS_CODE: ApprovalWhy = { kind: "changes", text: "it runs code it's handed, which can do anything" };
const NETWORK_WHY: ApprovalWhy = { kind: "network", text: "it reaches the network" };
const SETUP_WHY: ApprovalWhy = { kind: "changes", text: "it changes settings or installs beyond the project" };
const WRITES_WHY: ApprovalWhy = { kind: "changes", text: "it writes somewhere Auto doesn't write unasked" };
const PRINTS_KEYS: ApprovalWhy = { kind: "level", text: "it prints the shell's variables, keys among them" };
const ELSEWHERE: ApprovalWhy = { kind: "outside", text: "it names a place outside the project" };

/** What the allowlist needs from judge: where the folder is, and the skill script you allowed, if any, in full and folded. */
type Known = { platform: NodeJS.Platform; paths: typeof posix; fold: (p: string) => string; root: string; script?: string; cwd: string; home: string };

/** Programs that reach the network or another machine, named for why they ask. */
const NET_PROGRAMS = /^(?:curl|wget|dig|nslookup|host|ping|nc|ncat|netcat|socat|telnet|ftp|sftp|ssh|scp|rsync|gh|hub|glab|aws|gcloud|gsutil|az|kubectl|helm|terraform|pulumi|vercel|netlify|fly|flyctl|heroku|firebase|wrangler|railway|docker|podman|http|https|xh|ngrok|npx|bunx|pnpx|brew|pip|pip3|pipx|uv|poetry|gem|apt|apt-get|port|invoke-webrequest|invoke-restmethod|iwr|irm)$/;
/** Programs that run code they're handed, or set what runs. */
const CODE_PROGRAMS = /^(?:awk|gawk|nawk|deno|jq|yq|source|\.|exec|eval|xargs|parallel|tclsh|expect|osascript|swift|java|jshell|irb)$/;

/**
  The flags that make a program write a file, run a program or code it's handed, or open a server, whatever else it's
  doing: what the list refuses on its programs (KNOWN), and what a "don't ask again" rule never covers either (hazardOf),
  as a rule names only the program and its subcommand. Each long flag by any start of its name, as the program takes one
  (longFlagOf): getopt_long takes `sort --out=b`, git's parse-options `git grep --open='…'`, npm's nopt `npm test --scr=./x`.
*/
const BANS: Record<string, (args: string[]) => ApprovalWhy | undefined> = {
  git: (a) => gitBans(a),
  sort: (a) => (a.some((w) => /^-[^-]*o/.test(w) || longFlagOf(w, ["output", "compress-program"])) ? WRITES_WHY : undefined),
  rg: (a) => (a.some((w) => longFlagOf(w, ["pre", "hostname-bin"])) ? RUNS_CODE : undefined),
  // find's tests are whole words, never taken by a start of their name.
  find: (a) => (a.some((w) => /^-(?:delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)$/.test(w)) ? RUNS_CODE : undefined),
  tree: (a) => (a.some((w) => /^-[^-]*[oRH]/.test(w) || longFlagOf(w, ["output", "fromfile"])) ? WRITES_WHY : undefined),
  file: (a) => (a.some((w) => /^-[^-]*C/.test(w) || longFlagOf(w, ["compile"])) ? WRITES_WHY : undefined),
  npm: (a) => packageBans(a),
  pnpm: (a) => packageBans(a),
  yarn: (a) => packageBans(a),
  // bun runs code it's handed too, before its subcommand or after it (`bun test --preload ./x`).
  bun: (a) => packageBans(a) ?? (a.some((w) => /^-[a-zA-Z]*[ep]$/.test(w) || longFlagOf(w, ["eval", "print", "preload", "require", "import"])) ? RUNS_CODE : undefined),
  cargo: (a) => (a.some((w) => /^-Z/.test(w) || longFlagOf(w, ["config"])) ? RUNS_CODE : undefined),
  // Go's flag package takes a flag's whole name only (`-o` is never `-overlay`), so these are matched whole.
  go: (a) => (a.some((w) => /^--?(?:exec|toolexec|vettool|overlay)(?:=|$)/.test(w)) ? RUNS_CODE : undefined),
  // --eval (-E) is make code, which runs the shell; SHELL and the like choose the program each recipe runs in.
  make: (a) => (a.some((w) => /^-[^-]*E/.test(w) || longFlagOf(w, ["eval"]) || /^(?:SHELL|MAKESHELL|\.SHELLFLAGS|MAKEFLAGS)=/.test(w)) ? RUNS_CODE : undefined),
  pytest: (a) => pytestBans(a),
  // The UI and the API open a server that runs tests on request, the inspector a debugger anyone on the port can drive.
  vitest: (a) => (a.some((w) => /^--(?:ui|api|inspect|inspect-brk|browser)(?:[.=]|$)/i.test(w)) ? RUNS_CODE : undefined),
};

/**
  git's flags that write a file, run a program or make a repository whose settings Liner Code never saw, by any start of
  their name (GIT_BANNED), with the subcommand first: grep's -O (attached or alone, in a cluster too), which opens its
  matches in any program, and rebase's -x, which runs a command after each commit (its --exec is in GIT_BANNED).
*/
function gitBans([sub, ...rest]: string[]) {
  if (rest.some((w) => longFlagOf(w, GIT_BANNED))) return RUNS_CODE;
  if (sub === "grep" && rest.some((w) => /^-[^-]*O/.test(w))) return RUNS_CODE;
  if (sub === "rebase" && rest.some((w) => /^-[^-]*x/.test(w))) return RUNS_CODE;
  return undefined;
}

/**
  npm's, pnpm's and yarn's own settings that choose a program or load code, as flags before `--` (what's after it is the
  script's): a shell for scripts, Node's options (`--node-options=--import=data:text/javascript,…` runs that code),
  another settings file, git, an editor or a browser, pnpm's `--config.<name>`; -c, npm exec's code. A global install
  reaches beyond the project.
*/
const PACKAGE_BANNED = ["node-options", "script-shell", "userconfig", "globalconfig", "git", "shell", "editor", "browser", "viewer", "onload-script", "init-module", "call", "node-gyp"];
function packageBans(args: string[]) {
  const end = args.indexOf("--");
  const own = end < 0 ? args : args.slice(0, end);
  if (own.some((w) => /^-[a-zA-Z]*g[a-zA-Z]*$/.test(w) || longFlagOf(w, ["global", "location"]))) return SETUP_WHY;
  if (own.some((w) => longFlagOf(w, PACKAGE_BANNED) || /^--config\./i.test(w) || /^-[a-zA-Z]*c[a-zA-Z]*$/.test(w))) return RUNS_CODE;
  return undefined;
}

/**
  pytest: never -p, which loads a plugin by name, unless it turns one off (-p no:cacheprovider), nor -o or --override-ini
  (any start), which can set addopts to a -p of its own. Its short flags cluster as argparse takes them (`-xp x`, `-xo
  addopts=-px`): read letter by letter, a flag that takes a value taking the rest of the word or the next.
*/
function pytestBans(args: string[]) {
  for (let i = 0; i < args.length; i++) {
    const w = args[i];
    if (w === "--") break;
    if (longFlagOf(w, ["override-ini"])) return RUNS_CODE;
    if (!/^-[^-]/.test(w)) continue;
    for (let j = 1; j < w.length; j++) {
      const ch = w[j];
      if (ch === "o") return RUNS_CODE;
      if (ch === "p") {
        const value = j + 1 < w.length ? w.slice(j + 1) : (args[++i] ?? "");
        if (!/^no:/.test(value)) return RUNS_CODE;
        break;
      }
      // The rest of the word is this flag's value, or the next word is.
      if ("kmcrWn".includes(ch)) {
        if (j + 1 === w.length) i++;
        break;
      }
    }
  }
  return undefined;
}

/**
  The programs on the list and what each allows. Paths aren't checked here: judge's floor has already said every place
  named is in the folder, and plainWord that nothing is filled in. Writing programs never write into .git (its hooks and
  its config run code). Each returns why not, or nothing when it knows the command.
*/
const KNOWN: Record<string, (args: string[], k: Known) => ApprovalWhy | undefined> = {
  ...Object.fromEntries(["ls", "pwd", "cat", "head", "tail", "wc", "nl", "stat", "du", "diff", "cmp", "cut", "tr", "column", "basename", "dirname", "realpath", "echo", "true", "false", "which", "sleep", "grep", "egrep", "fgrep"].map((p) => [p, () => undefined])),
  // (Readers, these and rg, find, tree, file, sed and sort, may name the temporary folders the floor lets through; see READERS.)
  printf: (a) => (a.some((w) => /^-[a-zA-Z]*v/.test(w)) ? UNKNOWN : undefined),
  // A format, UTC, the ISO, RFC 3339 and RFC 2822 spellings, and BSD's -v that shifts the date it shows (`-v-1d`): never
  // -s or -f, nor a long flag but those named whole (--set, and its starts, sets the clock).
  date: (a) => (a.every((w) => /^\+|^-u$|^-R$|^-I(?:date|hours|minutes|seconds|ns)?$|^-v[+-]?\d+[ymwdHMS]$|^--(?:iso-8601(?:=(?:date|hours|minutes|seconds|ns))?|rfc-3339=(?:date|seconds|ns)|rfc-email|utc|universal)$/.test(w)) ? undefined : UNKNOWN),
  sort: BANS.sort,
  uniq: (a) => (a.filter((w) => !w.startsWith("-")).length > 1 ? WRITES_WHY : undefined),
  rg: BANS.rg,
  find: BANS.find,
  tree: BANS.tree,
  file: BANS.file,
  sed: (a) => (sedReads(["sed", ...a]) ? undefined : WRITES_WHY),
  mkdir: (a) => writes(a, /^-[pv]+$/, /^-m$/),
  touch: (a) => writes(a, /^-[acmh]+$/, /^-[rtd]$/),
  tee: (a) => writes(a, /^-[ai]+$/),
  // Copies a file within the folder; a folder's copy (-r, -R, -a) is the floor's to rate.
  cp: (a) => writes(a, /^-[fnipvlLHP]+$/),
  chmod: (a) => {
    const [mode, ...paths] = a;
    if (!mode || !/^(?:[ugoa]*[-+=][rwxX]*(?:,[ugoa]*[-+=][rwxX]*)*|[0-7]{3,4})$/.test(mode) || !paths.length) return UNKNOWN;
    return writes(paths, /^$/);
  },
  git: gitWhy,
  npm: (a) => packagesWhy("npm", a),
  pnpm: (a) => packagesWhy("pnpm", a),
  yarn: (a) => packagesWhy("yarn", a),
  bun: (a) => packagesWhy("bun", a),
  cargo: (a) => {
    const [sub] = a;
    if (!sub || !/^(?:build|b|test|t|check|c|fmt|clippy)$/.test(sub)) return sub === "install" || sub === "publish" || sub === "login" ? SETUP_WHY : UNKNOWN;
    return BANS.cargo(a);
  },
  go: (a) => {
    const [sub] = a;
    if (!sub || !/^(?:build|test|vet|fmt)$/.test(sub)) return sub === "install" || sub === "get" ? SETUP_WHY : UNKNOWN;
    return BANS.go(a);
  },
  // Targets and the flags that only say how; never -f, -C, --eval or a variable set (CC=…, SHELL=… choose what runs).
  make: (a) => (a.every((w) => /^-(?:j\d*|k|s|B|n|q|w)$|^--(?:silent|keep-going|jobs(?:=\d+)?)$/.test(w) || /^[A-Za-z0-9_][\w./-]*$/.test(w)) ? undefined : UNKNOWN),
  pytest: BANS.pytest,
  tsc: () => undefined,
  eslint: () => undefined,
  vitest: BANS.vitest,
  jest: () => undefined,
  // Only checking: --write rewrites every file it's given.
  prettier: (a) => (a.some((w) => /^(?:--check|-c|--list-different|-l)$/.test(w)) && !a.some((w) => w === "-w" || longFlagOf(w, ["write"])) ? undefined : WRITES_WHY),
};

/** The programs that only read, which alone may name a place the floor counts as nobody's (/tmp): anything else that names a path from the root names one in the folder. */
const READERS = /^(?:ls|pwd|cat|head|tail|wc|nl|stat|du|diff|cmp|cut|tr|column|basename|dirname|realpath|echo|true|false|which|sleep|grep|egrep|fgrep|rg|find|tree|file|sed|sort)$/;

/** A writing program's words: its flags (alone, or one that takes the next word), then paths, none of them in .git. */
function writes(args: string[], alone: RegExp, takes?: RegExp) {
  const paths: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const w = args[i];
    if (w === "--") {
      paths.push(...args.slice(i + 1));
      break;
    }
    if (alone.test(w)) continue;
    else if (takes?.test(w) && args[i + 1] !== undefined) i++;
    else if (w.startsWith("-")) return UNKNOWN;
    else paths.push(w);
  }
  return paths.length && paths.every((p) => !gitPlace(p)) ? undefined : GIT_FOLDER_OR_WRITES(paths);
}

/** Why a writing program's paths came to you: git's own folder (or a gitdir's HEAD) by name, else a write the list doesn't know. */
const GIT_FOLDER_OR_WRITES = (paths: string[]) => (paths.some(gitPlace) ? GIT_FOLDER : WRITES_WHY);

/**
  A path with a .git folder in it, however it's written (`./.git/`, `.//.git`, `sub/.GIT/hooks`): by its parts, in any
  case, as a Mac's disk doesn't tell them apart, and as git itself reads a name (is_hfs_dotgit, is_ntfs_dotgit): with
  the characters HFS+ ignores taken out and the dots and spaces Windows drops from a name's end.
*/
const intoGit = (p: string) => p.split(/[\\/]/).some((s) => s.normalize("NFC").replace(/[\u200b-\u200f\u202a-\u202e\u206a-\u206f\ufeff]/g, "").toLowerCase().replace(/[. ]+$/, "") === ".git");

/**
  A place no command on the list writes: one in a .git folder, or a file named HEAD (any case). git takes any folder
  holding a HEAD, objects/ and refs/ for a repository of its own, and a `config` there runs code (core.fsmonitor) on the
  next `git status` run in it: `mkdir -p x/objects x/refs`, `echo 'ref: refs/heads/main' > x/HEAD`, a config, `cd x`.
  Without a HEAD there's no repository, so a HEAD is the one file it can't do without.
*/
export const gitPlace = (p: string) => intoGit(p) || /^head[. ]*$/i.test(p.split(/[\\/]/).filter(Boolean).pop() ?? "");

/** The flags whose value is a pattern a tool skips, never a place it writes (`eslint --ignore-pattern .git`), by the program. */
const PATTERN_FLAGS: Record<string, RegExp> = { eslint: /^--ignore-pattern$/, pytest: /^--ignore(?:-glob)?$/, vitest: /^--exclude$/, tsc: /^--exclude(?:Directories|Files)$/ };

/**
  Why a program's words reach git's own folder, or nothing: each word, a flag's value (`--outDir=.git/x`) and what's glued
  to a short flag (`-o.git/config`). For git a name in .git only (HEAD is a commit to it); for every other program a file
  named HEAD too, as a build's output can be one (`tsc --outFile x/HEAD`, `go build -o x/HEAD`). What a pattern flag is given
  (PATTERN_FLAGS) is no place. A program that only reads may name either (READERS); the caller leaves those out.
*/
function gitArgsWhy(name: string, args: string[]) {
  const place = name === "git" ? intoGit : gitPlace;
  const pattern = PATTERN_FLAGS[name];
  for (let i = 0; i < args.length; i++) {
    const w = args[i];
    if (pattern?.test(w)) {
      i++;
      continue;
    }
    if (pattern && w.includes("=") && pattern.test(w.slice(0, w.indexOf("=")))) continue;
    if ([w, w.replace(/^[^=]*=/, ""), w.replace(/^-[A-Za-z]+/, "")].some(place)) return GIT_FOLDER;
  }
  return undefined;
}

/**
  Whether a word is a long flag `banned` names (names without their dashes): the name before any `=`, when it's one of
  them or the start of one. getopt_long (sort, file, GNU's tools), git's parse-options (grep, init, commit and the rest
  but log, diff and show) and npm's nopt all take any start of a long flag's name that only one flag has (`sort --out=b`
  is `--output=b`, `git grep --open='…'` is `--open-files-in-pager='…'`, `git init --templ=x`), so a ban on the whole
  name alone lets its shorter spellings through. Any start counts, however short, so a spelling the program would call
  ambiguous comes to you too; `--` alone (the end of the flags) and a word with one dash are no long flag.
*/
function longFlagOf(word: string, banned: string[]) {
  if (!/^--[^-]/.test(word)) return false;
  const name = word.slice(2).split("=")[0].toLowerCase();
  return banned.some((b) => b.startsWith(name));
}

/** git's subcommands that stay in the folder and the network never sees. */
const GIT_KNOWN = /^(?:status|diff|log|show|add|commit|branch|switch|checkout|restore|stash|ls-files|rev-parse|blame|shortlog|describe|merge-base|grep|init|reflog)$/;
const GIT_NETWORK = /^(?:push|fetch|pull|clone|remote|submodule|ls-remote|send-email|request-pull|archive|svn|p4|daemon)$/;
/**
  The subcommands' flags that write a file, run a program or make a repository whose settings Liner Code never saw
  (--bare and --separate-git-dir make one with no .git in its path), by any start of their name (longFlagOf).
*/
const GIT_BANNED = ["output", "ext-diff", "open-files-in-pager", "upload-pack", "receive-pack", "exec", "template", "separate-git-dir", "bare"];
const GIT_ELSEWHERE: ApprovalWhy = { kind: "changes", text: "it points git at another repository, whose settings can run code" };
const GIT_FOLDER: ApprovalWhy = { kind: "changes", text: "it reaches into git's own folder, whose hooks and settings run code" };
const CHECKOUT_WHY: ApprovalWhy = { kind: "changes", text: "git checkout with a name puts back a file of that name, throwing its changes away, and the text can't tell a file from a branch" };
/** What git config reads, and how it says it: a key's value (--get, --get-all, --get-regexp) or the list, from the settings git already reads. */
const CONFIG_READS = /^(?:--get|--get-all|--get-regexp|--list|-l)$/;
const CONFIG_SAYS = /^(?:--local|--show-origin|--show-scope|--name-only|-z|--null)$/;

/**
  git: before the subcommand only --no-pager and --no-optional-locks (never -C, --git-dir or --work-tree, which point
  it at a repository whose settings can run code, nor -c, which sets any setting, nor --exec-path); the subcommand on
  GIT_KNOWN; and none of the flags gitBans names. What only lists or reads: `config` with one key to get or the list (no
  setting, no other file: --global, --system and --file read past the project's own), `remote` alone or -v, `worktree
  list`, and `reflog` but its expire, delete and drop. `checkout` only alone or making a branch (-b): with a name it
  puts back a file of that name, which a branch's name can't be told from; `switch` takes only branches. What can't be
  undone (reset --hard, checkout ., restore without --staged, branch -D) the floor rated.
*/
function gitWhy(args: string[]) {
  let i = 0;
  while (args[i]?.startsWith("-")) {
    if (args[i] === "--no-pager" || args[i] === "--no-optional-locks") i++;
    else if (/^-C/.test(args[i]) || /^--(?:git-dir|work-tree|bare|namespace)(?:=|$)/.test(args[i])) return GIT_ELSEWHERE;
    else return args[i] === "-c" || /^--(?:config-env|exec-path)/.test(args[i]) ? SETUP_WHY : UNKNOWN;
  }
  const sub = args[i];
  const rest = args.slice(i + 1);
  if (sub === "config") {
    const reads = rest.filter((w) => CONFIG_READS.test(w));
    const keys = rest.filter((w) => !w.startsWith("-"));
    const listing = reads.length === 1 && /^(?:--list|-l)$/.test(reads[0]);
    return reads.length === 1 && rest.every((w) => CONFIG_READS.test(w) || CONFIG_SAYS.test(w) || !w.startsWith("-")) && keys.length === (listing ? 0 : 1) ? undefined : SETUP_WHY;
  }
  if (sub === "remote") return rest.every((w) => w === "-v" || w === "--verbose") ? undefined : NETWORK_WHY;
  if (sub === "worktree") return rest[0] === "list" && rest.slice(1).every((w) => /^(?:--porcelain|-v|--verbose|-z)$/.test(w)) ? undefined : UNKNOWN;
  if (!sub || !GIT_KNOWN.test(sub)) return sub && GIT_NETWORK.test(sub) ? NETWORK_WHY : UNKNOWN;
  if (sub === "reflog" && rest.some((w) => /^(?:expire|delete|drop|write)$/.test(w))) return UNKNOWN;
  // Alone, or -b with a new branch and the commit it starts from (with -b that's a commit, never a path).
  if (sub === "checkout" && rest.length) {
    const words = rest.filter((w) => w !== "-q" && w !== "--quiet");
    if (!(words[0] === "-b" && words.length >= 2 && words.length <= 3 && words.slice(1).every((w) => !w.startsWith("-")))) return CHECKOUT_WHY;
  }
  if (sub === "init" && rest.some((w) => longFlagOf(w, ["bare", "separate-git-dir"]))) return GIT_ELSEWHERE;
  return gitBans([sub, ...rest]);
}

/** Script names `pnpm build`, `yarn lint` and `bun lint` run bare. */
const BARE_SCRIPTS = /^(?:build|test|lint|typecheck|check|format)$/;
/** An install's flags that only say how: from the lock file, quietly, without scripts. */
const INSTALL_FLAGS = /^(?:--frozen-lockfile|--prefer-offline|--offline|--no-audit|--no-fund|--silent|--ignore-scripts|--legacy-peer-deps|--immutable|--production|--prod|--loglevel=\w+|-s|-q)$/;
/** A script's run's own flags, which say only where it runs and how quietly; pnpm's that pick its packages. */
const RUN_FLAGS = /^(?:--if-present|-s|--silent|--workspaces|--ws|--include-workspace-root)$/;
const PNPM_FLAGS = /^(?:-r|--recursive|--parallel|--stream|--no-bail|-w|--workspace-root)$/;

/**
  npm, pnpm, yarn, bun: only test, run with a script's name, a bare script name the others run (BARE_SCRIPTS), or
  install and ci from the lock file: no package named, nothing packageBans names. Never exec, x, dlx, publish, config,
  link or the rest. The flags before `--` are the tool's own (`npm test -- -g foo` hands -g to the script), and those are
  only the few that say where and how quietly (RUN_FLAGS, PNPM_FLAGS): npm's -w, --workspace and --prefix and pnpm's
  --filter, -F, -C and --dir, each with a literal value in the project, before the subcommand too (`npm --prefix ui test`,
  `pnpm -r test`); anything else, `--node-options`, `--script-shell` or one nobody listed, comes to you. pnpm hands every
  word after the script's name to the script (pnpm 12.9.1: `pnpm test --watch`), so those are the script's. bun runs a
  file it's named (`bun run x.ts`), so its script names have no dot or slash.
*/
function packagesWhy(pm: "npm" | "pnpm" | "yarn" | "bun", args: string[]) {
  const banned = BANS[pm](args);
  if (banned) return banned;
  const end = args.indexOf("--");
  const own = end < 0 ? args : args.slice(0, end);
  const value = (w: string | undefined) => w !== undefined && w !== "" && !w.startsWith("-") && !posix.isAbsolute(w) && !win32.isAbsolute(w);
  const takes = pm === "npm" ? /^(?:-w|--workspace|--prefix)$/ : pm === "pnpm" ? /^(?:--filter|-F|-C|--dir)$/ : undefined;
  const glued = pm === "npm" ? /^--(?:workspace|prefix)=(.*)$/ : pm === "pnpm" ? /^--(?:filter|dir)=(.*)$/ : undefined;
  /** Past the flag at words[i], to the next word: or -1 when it isn't one of the few. */
  const past = (words: string[], i: number) => {
    const w = words[i];
    if (RUN_FLAGS.test(w) || (pm === "pnpm" && PNPM_FLAGS.test(w)) || (glued?.test(w) && value(glued.exec(w)![1]))) return i + 1;
    return takes?.test(w) && value(words[i + 1]) ? i + 2 : -1;
  };
  /** Every flag among words one of the few. */
  const known = (words: string[]) => {
    for (let i = 0; i < words.length; ) {
      if (!words[i].startsWith("-")) i++;
      else if ((i = past(words, i)) < 0) return false;
    }
    return true;
  };
  let i = 0;
  if (pm === "npm" || pm === "pnpm") while (i >= 0 && i < own.length && own[i].startsWith("-")) i = past(own, i);
  if (i < 0) return UNKNOWN;
  const sub = own[i];
  const after = own.slice(i + 1);
  // Bare yarn installs.
  if (sub === undefined) return pm === "yarn" && args.length === 0 ? undefined : UNKNOWN;
  if (/^(?:install|i|ci)$/.test(sub) && (sub !== "ci" || pm === "npm")) return args.slice(i + 1).every((w) => INSTALL_FLAGS.test(w)) ? undefined : SETUP_WHY;
  if (/^(?:test|t|tst)$/.test(sub) || (pm !== "npm" && BARE_SCRIPTS.test(sub))) return pm === "pnpm" || known(after) ? undefined : UNKNOWN;
  if (sub === "run" || sub === "run-script") {
    let j = 0;
    while (j >= 0 && j < after.length && after[j].startsWith("-")) j = past(after, j);
    if (j < 0 || !after[j] || !(pm === "bun" ? /^[A-Za-z0-9][\w:-]*$/ : /^[A-Za-z0-9][\w:.-]*$/).test(after[j])) return UNKNOWN;
    return pm === "pnpm" || known(after.slice(j + 1)) ? undefined : UNKNOWN;
  }
  return /^(?:exec|x|dlx|create|init|publish|unpublish|deprecate|dist-tag|owner|access|login|logout|adduser|token|team|config|set|link|add|remove|uninstall|rm|un|update|up|upgrade|global)$/.test(sub) ? SETUP_WHY : UNKNOWN;
}

/**
  A raw word (quotes still on, as parseShell keeps it) as the program gets it, or none when the shell would fill any of
  it in: a `$` or substitution outside single quotes, a backtick or backslash, a bare `*`, `?`, `[` or brace, `~` where it
  starts a home folder (a word's start, after `=` or `:`), and `=` at a word's start (zsh's program lookup).
*/
function plainWord(raw: string): string | undefined {
  let out = "";
  for (let i = 0; i < raw.length; ) {
    const ch = raw[i];
    if (ch === "'" || ch === '"') {
      const end = raw.indexOf(ch, i + 1);
      if (end < 0) return undefined;
      const inner = raw.slice(i + 1, end);
      if (ch === '"' && /[$`\\\u0001]/.test(inner)) return undefined;
      out += inner;
      i = end + 1;
    } else {
      if (/[$`\\\u0001*?[\]{}]/.test(ch)) return undefined;
      if (ch === "~" && (i === 0 || /[=:]/.test(raw[i - 1]))) return undefined;
      if (ch === "=" && i === 0) return undefined;
      out += ch;
      i++;
    }
  }
  return out;
}

/** Why a command isn't one the list knows, or nothing when it is: every part, every word, every redirect. */
function unknownWhy(command: string, k: Known): ApprovalWhy | undefined {
  if (k.platform === "win32") return windowsWhy(command, k);
  const p = parseShell(command);
  if (!p || p.subst) return FILLS_IN;
  if (p.keyword || p.assign || p.assigns.length || p.background || !p.list.length) return UNKNOWN;
  for (const r of p.redirects) {
    // 2>&1 and >&2: what it prints, joined.
    if (r.op === ">&") {
      if (/^[12]$/.test(r.target) && /^[12]?$/.test(r.fd)) continue;
      return UNKNOWN;
    }
    if (r.op !== ">" && r.op !== "<") return UNKNOWN;
    if (r.fd && !/^[012]$/.test(r.fd)) return UNKNOWN;
    const t = plainWord(r.target);
    if (t === undefined) return FILLS_IN;
    if (t === "/dev/null") continue;
    // Into the folder only: a path from the root must be in it (the floor let the temporary folders through as places).
    if (k.paths.isAbsolute(t) && !k.fold(k.paths.resolve(t)).startsWith(k.root + k.paths.sep)) return WRITES_WHY;
    if (r.op === ">" && gitPlace(t)) return GIT_FOLDER;
  }
  for (const x of p.list) {
    const why = simpleWhy(x.words, k);
    if (why) return why;
  }
  return undefined;
}

/** One simple command's words, raw: the skill script you allowed, `cd` into a subfolder, or a program KNOWN knows. */
function simpleWhy(words: string[], k: Known): ApprovalWhy | undefined {
  // An interpreter running the one skill script you allowed (skillOffer), with literal words after it.
  const script = k.script ? scriptOf(words) : undefined;
  if (script && fullPath(script, k.cwd, k.home, k.paths) !== undefined && k.fold(fullPath(script, k.cwd, k.home, k.paths)!) === k.script) return words.slice(2).every((w) => plainWord(w) !== undefined) ? undefined : FILLS_IN;
  const plain = words.map(plainWord);
  if (plain.some((w) => w === undefined)) return FILLS_IN;
  const [first, ...args] = plain as string[];
  // A program by its path (`./git`, `/tmp/x/npm`) is whatever that file is.
  if (!first || /[\\/]/.test(first)) return UNKNOWN;
  // A path from the root, as a word, a flag's value (`--rulesdir=/tmp/x`) or glued to a short flag, is in the folder, unless the program only reads.
  if (!READERS.test(first.toLowerCase()) && k.platform !== "win32") {
    for (const w of args) {
      const m = /^(?:-[A-Za-z]+|[^=]*=)?(\/.*)$/.exec(w);
      if (m && m[1] !== "/dev/null" && !k.fold(k.paths.resolve(m[1])).startsWith(k.root + k.paths.sep) && k.fold(k.paths.resolve(m[1])) !== k.root) return ELSEWHERE;
    }
  }
  // Nor, unless it only reads, git's own folder or a HEAD of a repository of its own: as a word, a flag's value or glued to
  // a short flag (`go build -o .git/hooks/pre-commit`, `tsc --outDir=.git/x`, `tsc --outFile x/HEAD`), whose hooks and
  // settings run code (gitArgsWhy).
  if (!READERS.test(first.toLowerCase())) {
    const why = gitArgsWhy(first.toLowerCase(), args);
    if (why) return why;
  }
  return programWhy(first.toLowerCase(), args, k);
}

/** A program named bare, by its name in lower case, with its words: what KNOWN says, or why it's on no list. */
function programWhy(name: string, args: string[], k: Known): ApprovalWhy | undefined {
  // Into a subfolder, never git's own (`cd .git && printf … > config`: what's written next lands in it).
  if (name === "cd") return args.length !== 1 || args[0].startsWith("-") || k.paths.isAbsolute(args[0]) || /^[A-Za-z]:/.test(args[0]) ? UNKNOWN : intoGit(args[0]) ? GIT_FOLDER : undefined;
  if (/^python[\d.]*$|^py$/.test(name) && args[0] === "-m" && args[1] === "pytest") return pytestBans(args.slice(2));
  const known = Object.hasOwn(KNOWN, name) ? KNOWN[name] : undefined;
  if (known) return known(args, k);
  if (name === "env" || name === "printenv" || name === "set" || name === "export" || name === "declare") return PRINTS_KEYS;
  if (NET_PROGRAMS.test(name)) return NETWORK_WHY;
  if (INTERPRETERS.test(name) || WRAPPERS.test(name) || CODE_PROGRAMS.test(name)) return RUNS_CODE;
  return UNKNOWN;
}

/** Windows's programs on the list, PowerShell's and cmd's: those that read in the folder, and the build tools KNOWN knows. */
const WINDOWS_READS = /^(?:dir|type|findstr|get-childitem|gci|ls|get-content|gc|cat|select-string|sls|get-location|pwd|echo|write-output)$/;
const WINDOWS_BUILDS = /^(?:git|npm|pnpm|yarn|cargo|go|tsc|eslint|pytest|vitest|jest|prettier)$/;

/** A part of a Windows command in words, as cmd and PowerShell split them: on spaces outside double quotes, the quotes then taken out. None when a quote is left open. */
function windowsWords(part: string) {
  const words: string[] = [];
  let w = "";
  let quoted = false;
  let any = false;
  for (const ch of part) {
    if (ch === '"') (quoted = !quoted), (any = true);
    else if (/\s/.test(ch) && !quoted) {
      if (any) words.push(w);
      (w = ""), (any = false);
    } else (w += ch), (any = true);
  }
  if (quoted) return undefined;
  if (any) words.push(w);
  return words;
}

/**
  On Windows the command may be PowerShell's, cmd's or bash's, so only the plainest is known: no %VAR%, $ of any kind, ^,
  backtick, single quote, pipe, redirect, parenthesis, brace, @, ! or pattern; parts joined only by && or ;; and in
  each, a program from WINDOWS_READS or WINDOWS_BUILDS named bare, `cd` into a subfolder, and no word with a `:` but a
  drive's (env:, HKCU: and the like are places of their own).
*/
function windowsWhy(command: string, k: Known): ApprovalWhy | undefined {
  const c = command.trim();
  if (/[%$`^'|<>(){}@!*?[\]\r\n]/.test(c)) return FILLS_IN;
  for (const part of c.split(/&&|;/)) {
    if (part.includes("&")) return UNKNOWN;
    const words = windowsWords(part);
    if (!words) return FILLS_IN;
    const [first, ...args] = words;
    if (!first || /[\\/:]/.test(first)) return UNKNOWN;
    if (args.some((a) => a.includes(":") && !/^[A-Za-z]:[\\/][^:]*$/.test(a))) return UNKNOWN;
    const name = first.toLowerCase().replace(ENDS_LIKE_A_PROGRAM, "");
    if (name === "cd") {
      if (args.length !== 1 || /^[\\/]|^[A-Za-z]:/.test(args[0]) || args[0].startsWith("-")) return UNKNOWN;
      if (intoGit(args[0])) return GIT_FOLDER;
      continue;
    }
    if (WINDOWS_READS.test(name)) continue;
    if (!WINDOWS_BUILDS.test(name)) return programWhy(name, [], k) ?? UNKNOWN;
    // git's own folder and a HEAD of a repository of its own, by backslash as well (`go build -o .git\hooks\pre-commit`).
    const why = gitArgsWhy(name, args) ?? programWhy(name, args, k);
    if (why) return why;
  }
  return undefined;
}

/**
  What a "don't ask again" rule never covers, whatever it names (runtime.ts, ruleAllows). A rule is a program and its
  subcommand (ruleFor), so a grant for `git grep` would run `git grep --open='touch x' foo` too, its pager any command.
  So each part of the command, a `cd` in front of it included, is held to what the list holds its program to, past the
  subcommand: none of the flags BANS names for it; and, but for a program that only reads, nothing into git's own folder
  or a HEAD of a repository of its own (gitArgsWhy), nor a place outside the folder (git names none it writes); a `cd`
  only into a subfolder, never .git; no redirect into either. A word the shell fills in can't be read for any of that,
  so on a program with bans or one that writes it comes to you as well. Nothing here when the rule may cover it.
*/
export function hazardOf(command: string, cwd: string, platform: NodeJS.Platform = process.platform): ApprovalWhy | undefined {
  const paths = platform === "win32" ? win32 : posix;
  const fold = (p: string) => (platform === "win32" ? p.toLowerCase() : p);
  const root = fold(paths.resolve(cwd));
  const within = (p: string) => {
    const full = fold(paths.resolve(cwd, p));
    return full === root || full.startsWith(root + paths.sep);
  };
  // A place a word names outside the folder: home, a variable's, another machine's, from the root or a drive, or up with `..`.
  const away = (w: string) => /^[~$%]/.test(w) || /^[\\/]{2}/.test(w) || UP.test(w) || ((paths.isAbsolute(w) || /^[A-Za-z]:/.test(w)) && w !== "/dev/null" && !within(w));
  const parts: { name: string; words: (string | undefined)[] }[] = [];
  if (platform === "win32") {
    for (const part of command.trim().split(/&&|;|\|/)) {
      const words = windowsWords(part);
      if (!words) return FILLS_IN;
      if (words.length) parts.push({ name: programOf(words[0]), words: words.slice(1).map((w) => (/[%$`^]/.test(w) ? undefined : w)) });
    }
  } else {
    const p = parseShell(command);
    if (!p || p.subst) return FILLS_IN;
    for (const r of p.redirects) {
      if (r.op === ">&") continue;
      const t = plainWord(r.target);
      if (t === undefined) return FILLS_IN;
      if (t === "/dev/null") continue;
      if (gitPlace(t)) return GIT_FOLDER;
      if (r.op !== "<" && away(t)) return WRITES_WHY;
    }
    for (const x of p.list) parts.push({ name: programOf(x.words[0] ?? ""), words: x.words.slice(1).map(hazardWord) });
  }
  for (const { name, words } of parts) {
    if (name === "cd") {
      const [to] = words;
      if (words.length !== 1 || to === undefined || to.startsWith("-") || away(to)) return ELSEWHERE;
      if (intoGit(to)) return GIT_FOLDER;
      continue;
    }
    // sed writes with -i, or a script's w.
    const reads = READERS.test(name) && name !== "sed";
    const bans = Object.hasOwn(BANS, name) ? BANS[name] : undefined;
    if (words.some((w) => w === undefined)) {
      if (bans || !reads) return FILLS_IN;
      continue;
    }
    const args = words as string[];
    const banned = bans?.(args);
    if (banned) return banned;
    if (reads) continue;
    const git = gitArgsWhy(name, args);
    if (git) return git;
    if (name !== "git" && args.some((w) => [w, w.replace(/^[^=]*=/, ""), w.replace(/^-[A-Za-z]+/, "")].some(away) || [...w.matchAll(PLACE)].some((m) => away(m[1])))) return ELSEWHERE;
  }
  return undefined;
}

/**
  A word as hazardOf reads it: as the program gets it (plainWord), or, when the shell would expand a pattern or a brace in
  it, as written with its quotes off, when what that expands to still starts as written (`src/*.ts`). Never a word with a
  $, a substitution, a backtick or a backslash, nor one a pattern, a brace, `~` or `=` starts, nor a flag with one in it
  (`-{-open=x,}`, or `*` where a file named `--open=x` would fill it in).
*/
function hazardWord(raw: string) {
  const plain = plainWord(raw);
  if (plain !== undefined) return plain;
  if (/[$`\\\u0001]/.test(raw)) return undefined;
  const bare = unquoted(raw);
  return /^[-*?[\]{}~=]/.test(bare) ? undefined : bare;
}

/**
  Whether a command rated medium is so only for what stays in the folder: each part rated low, or medium for a commit or
  an install (MEDIUM's own entries), which the allowlist then narrows to a commit and an install from the lock file.
*/
function localMedium(command: string, platform: NodeJS.Platform) {
  const local = new Set([MEDIUM[1][1], MEDIUM[3][1]]);
  const parts = platform === "win32" ? command.split(/&&|;/) : parseShell(command)?.list.map((x) => x.raw.join(" "));
  return Boolean(parts?.length) && parts!.every((part) => {
    const r = riskOf(part);
    return r.risk === "low" || (r.risk === "medium" && r.why !== undefined && local.has(r.why));
  });
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
  statement of its own. `subs`: what each `$( )` holds, by the number in its placeholder (\u0001<n>\u0001). `redirects`:
  every redirect as written, the spare ones (2>&1, >/dev/null) too, for the allowlist (unknownWhy).
*/
type Parsed = { list: Simple[]; subst: boolean; keyword: boolean; assign: boolean; redirect: boolean; background: boolean; seps: string[]; assigns: { word: string; target?: Simple }[]; subs: Simple[][]; loops: { name: string; literal: boolean }[]; redirects: { op: string; fd: string; target: string }[] };
const UNREADABLE = new Error("unreadable");
export function parseShell(command: string): Parsed | undefined {
  const s = command;
  const out: Parsed = { list: [], subst: false, keyword: false, assign: false, redirect: false, background: false, seps: [], assigns: [], subs: [], loops: [], redirects: [] };
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
        out.redirects.push({ op, fd, target });
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
