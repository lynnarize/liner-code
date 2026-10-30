/*
  How risky a tool call is, for the approval card: high risk approves with a hold instead of a
  press, and in Full access the guard still asks about anything that can't be undone.
*/
import type { Risk, ToolKind } from "../../contracts/src/index.ts";

const HIGH = [
  /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b/i,
  /\brm\s+-[a-z]*r\b.*\s(\/|~|\$HOME|\.\.?)(\s|$)/i,
  /\bgit\s+push\b.*(--force|-f\b|--force-with-lease)/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[a-z]*f/i,
  /\bgit\s+branch\s+-D\b/i,
  /\bgit\s+checkout\s+--\s+\./i,
  /\bsudo\b/,
  /\bmkfs\b|\bdd\s+if=/,
  /\bchmod\s+-R\s+777\b/,
  /(curl|wget)[^|]*\|\s*(sh|bash|zsh)\b/,
  /\bdrop\s+(table|database)\b/i,
  /\btruncate\s+table\b/i,
  /\bnpm\s+publish\b|\bcargo\s+publish\b|\bgh\s+release\s+create\b/,
  /\bkubectl\s+delete\b|\bterraform\s+(apply|destroy)\b/,
  />\s*\/dev\/(sd|disk)/,
];
const MEDIUM = [/\bgit\s+(push|commit|merge|rebase|tag)\b/, /\b(npm|pnpm|yarn|bun)\s+(i|install|add|remove)\b/, /\bpip\s+install\b/, /\bbrew\s+install\b/, /\bmv\b|\bcp\s+-r\b/, /\bgh\s+pr\s+(create|merge)\b/, /\bdocker\s+(rm|rmi|system\s+prune)\b/, /\bcurl\b.*-X\s*(POST|PUT|DELETE|PATCH)/i];

export function commandRisk(command: string): Risk {
  if (HIGH.some((r) => r.test(command))) return "high";
  if (MEDIUM.some((r) => r.test(command))) return "medium";
  return "low";
}

/**
  A command that only reads (pwd, ls, cat, sed -n, rg, git diff…), alone or piped and chained,
  including one wrapped in a login shell the way Codex runs them. Redirects, substitutions,
  in-place edits, and the flags that make a reader write a file or run a command never count.
*/
export function readsOnly(command: string) {
  const c = command.trim().replace(/^(?:\/bin\/)?(?:ba|z)?sh\s+-l?c\s+(["']?)([\s\S]*)\1$/, "$2").trim();
  // What's quoted is an argument (a path with spaces, a sed pattern with < in it), never a redirect or a pipe.
  // Double quotes still expand $( ) and backticks, so those stay visible. The quoted text is kept
  // aside, so a sed script in it can still be read.
  const quoted: string[] = [];
  const aside = (m: string) => `\u0000${quoted.push(m.slice(1, -1)) - 1}\u0000`;
  const bare = c.replace(/'[^']*'/g, aside).replace(/"[^"$`]*"/g, aside);
  if (!bare || /[<>`]|\$\(/.test(bare)) return false;
  // A lone & and a new line start another command as surely as ; does.
  return bare.split(/&&|\|\||;|\||&|[\r\n]/).every((part) => {
    const p = part.trim().replace(/^cd\s+\S+$/, "pwd");
    const words = p.split(/\s+/).map((w) => w.replace(/\u0000(\d+)\u0000/g, (_, i: string) => quoted[Number(i)]));
    if (/^(pwd|ls|cat|head|tail|wc|nl|grep|stat|echo)\b/.test(p)) return true;
    // rg --pre runs a command on every file; tree -o, file -C and git --output write one.
    if (/^rg\b/.test(p)) return !words.some((w) => /^--pre(=|$)/.test(w));
    if (/^tree\b/.test(p)) return !words.some((w) => /^-[^-]*o/.test(w));
    if (/^file\b/.test(p)) return !words.some((w) => /^-[^-]*C|^--compile$/.test(w));
    if (/^sed\b/.test(p)) return sedReads(words);
    if (/^find\b/.test(p)) return !/-(delete|exec|execdir|ok|fprint|fls)/.test(p);
    return /^git\s+(status|diff|log|show|ls-files|rev-parse|branch)\b/.test(p) && !words.some((w) => /^--output(=|$)/.test(w));
  });
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
/** Shells and wrappers: a rule for one would allow any command it's handed. */
const WRAPPERS = /^(sh|bash|zsh|fish|dash|ksh|env|xargs|eval|exec|command|builtin|nohup|time|nice|timeout|sudo|doas)$/;

/**
  What "Don't ask again for … this session" would allow: a single plain command, named by its
  program (and subcommand, for git, npm and the like), after any leading `cd <dir> &&`. A
  compound command (&&, &, ;, |, a new line, redirects, substitutions) gets none, and neither
  does a shell or a wrapper that runs whatever follows it, so a rule can never carry something
  else along with it.
*/
export function ruleFor(command: string): string | undefined {
  let c = command.trim().replace(/^(?:cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*&&\s*)+/, "");
  c = c.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)+/, "");
  if (!c || /[&;|<>`\r\n]|\$\(/.test(c)) return undefined;
  const words = c.split(/\s+/);
  const program = words[0].split("/").pop() ?? words[0];
  if (WRAPPERS.test(program)) return undefined;
  const sub = SUB.test(program) && words[1] && !words[1].startsWith("-") ? words[1] : "";
  return sub ? `${program} ${sub}` : program;
}
