/*
  A small tokenizer: not a parser. It marks what a reader scans for (keywords, strings,
  comments, tags, numbers, functions) and leaves the rest as text.
*/
export type Lang = "tsx" | "ts" | "js" | "css" | "json" | "bash" | "html";
export type Token = { text: string; kind: string };
type Rule = [RegExp, string];

const KW = /\b(?:import|from|export|default|function|return|const|let|var|if|else|for|of|in|while|switch|case|break|continue|new|typeof|type|interface|extends|as|await|async|try|catch|finally|throw|satisfies|keyof|void|null|undefined|true|false|class|this)\b/;
const script: Rule[] = [
  [/\/\*[\s\S]*?\*\//, "comment"],
  [/\/\/[^\n]*/, "comment"],
  [/`(?:\\.|[^`\\])*`/, "string"],
  [/"(?:\\.|[^"\\])*"/, "string"],
  [/'(?:\\.|[^'\\])*'/, "string"],
  [/<\/?[A-Za-z][\w.]*/, "tag"],
  [/\/?>/, "tag"],
  [KW, "keyword"],
  [/\b\d+(?:\.\d+)?\b/, "number"],
  [/\b[A-Z][A-Za-z0-9]*\b/, "type"],
  [/\b[a-z_$][\w$]*(?=\s*\()/, "fn"],
  [/[a-zA-Z-]+(?==)/, "attr"],
];
const RULES: Record<Lang, Rule[]> = {
  tsx: script,
  ts: script,
  js: script,
  css: [
    [/\/\*[\s\S]*?\*\//, "comment"],
    [/"(?:\\.|[^"\\])*"/, "string"],
    [/@[\w-]+/, "keyword"],
    [/--[\w-]+/, "attr"],
    [/[\w-]+(?=\s*:[^:{};]*;)/, "attr"],
    [/#[\da-fA-F]{3,8}\b/, "number"],
    [/-?\d*\.?\d+(?:px|ms|s|%|em|rem|deg|fr|vh|vw)?\b/, "number"],
    [/[.#][\w-]+/, "tag"],
    [/\b[\w-]+(?=\()/, "fn"],
  ],
  json: [
    [/"(?:\\.|[^"\\])*"(?=\s*:)/, "attr"],
    [/"(?:\\.|[^"\\])*"/, "string"],
    [/\b(?:true|false|null)\b/, "keyword"],
    [/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/, "number"],
  ],
  bash: [
    [/#[^\n]*/, "comment"],
    [/"(?:\\.|[^"\\])*"/, "string"],
    [/'[^']*'/, "string"],
    [/(?:^|(?<=\n))\s*[\w./-]+/, "fn"],
    [/\s--?[\w-]+/, "attr"],
    [/\$\w+/, "keyword"],
  ],
  html: [
    [/<!--[\s\S]*?-->/, "comment"],
    [/<\/?[\w-]+/, "tag"],
    [/\/?>/, "tag"],
    [/[\w-]+(?==)/, "attr"],
    [/"(?:\\.|[^"\\])*"/, "string"],
  ],
};
const compiled = Object.fromEntries(Object.entries(RULES).map(([k, rs]) => [k, rs.map(([re, c]) => [new RegExp(re.source, "y"), c] as Rule)])) as Record<Lang, Rule[]>;

/** Tokens per line; multi-line tokens are split at line breaks. */
export function tokenize(code: string, lang: Lang): Token[][] {
  const rules = compiled[lang] ?? [];
  const lines: Token[][] = [[]];
  let pos = 0;
  let plain = "";
  const push = (text: string, kind: string) => {
    text.split("\n").forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ text: part, kind });
    });
  };
  const flush = () => {
    if (plain) push(plain, "");
    plain = "";
  };
  while (pos < code.length) {
    let hit = false;
    for (const [re, kind] of rules) {
      re.lastIndex = pos;
      const m = re.exec(code);
      if (m && m[0].length) {
        flush();
        push(m[0], kind);
        pos += m[0].length;
        hit = true;
        break;
      }
    }
    if (!hit) plain += code[pos++];
  }
  flush();
  return lines;
}
