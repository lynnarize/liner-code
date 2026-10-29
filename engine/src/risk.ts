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
  including one wrapped in a login shell the way Codex runs them. Redirects, substitutions and
  in-place edits never count as reading.
*/
export function readsOnly(command: string) {
  const c = command.trim().replace(/^(?:\/bin\/)?(?:ba|z)?sh\s+-l?c\s+(["']?)([\s\S]*)\1$/, "$2").trim();
  if (!c || /[<>`]|\$\(/.test(c)) return false;
  return c.split(/&&|\|\||;|\|/).every((part) => {
    const p = part.trim().replace(/^cd\s+\S+$/, "pwd");
    if (/^(pwd|ls|cat|head|tail|wc|nl|grep|rg|file|stat|tree|echo)\b/.test(p)) return true;
    if (/^sed\b/.test(p)) return /\s-n\b/.test(p) && !/\s-i/.test(p);
    if (/^find\b/.test(p)) return !/-(delete|exec|execdir|ok|fprint)/.test(p);
    return /^git\s+(status|diff|log|show|ls-files|rev-parse|branch)\b/.test(p);
  });
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

/**
  What "Don't ask again for … this session" would allow: a single plain command, named by its
  program (and subcommand, for git, npm and the like), after any leading `cd <dir> &&`. A
  compound command (&&, ;, |, redirects, substitutions) gets none, so a rule can never carry
  something else along with it.
*/
export function ruleFor(command: string): string | undefined {
  let c = command.trim().replace(/^(?:cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*&&\s*)+/, "");
  c = c.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)+/, "");
  if (!c || /&&|\|\||[;|<>`]|\$\(/.test(c)) return undefined;
  const words = c.split(/\s+/);
  const program = words[0].split("/").pop() ?? words[0];
  const sub = SUB.test(program) && words[1] && !words[1].startsWith("-") ? words[1] : "";
  return sub ? `${program} ${sub}` : program;
}
