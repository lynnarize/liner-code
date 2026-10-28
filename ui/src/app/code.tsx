/*
  Code as the Files and Review surfaces show it: lines, tokens coloured as Liner's code block
  colours them, and which lines a turn added or changed.
*/
import { tokenize, type Lang, type Token } from "@liner/components/code-block/tokenize";
import { diffRows, type Row } from "@liner/pro/code-diff/diff";
import "@liner/components/code-block/code-block.css";

const EXT: Record<string, Lang> = { tsx: "tsx", jsx: "tsx", ts: "ts", mts: "ts", cts: "ts", js: "js", mjs: "js", cjs: "js", css: "css", scss: "css", json: "json", sh: "bash", bash: "bash", zsh: "bash", html: "html", svg: "html", xml: "html", vue: "html", svelte: "html" };
export const langOf = (path: string): Lang | undefined => EXT[path.split(".").pop()?.toLowerCase() ?? ""];
export const linesOf = (text?: string) => (text === undefined || text === "" ? [] : text.replace(/\n$/, "").split("\n"));
export const tokensOf = (lines: string[], lang?: Lang): Token[][] => (lang && lines.length < 20000 ? tokenize(lines.join("\n"), lang) : lines.map((l) => (l ? [{ text: l, kind: "" }] : [])));

export const Toks = ({ line }: { line?: Token[] }) => (
  <>
    {(line ?? []).map((t, k) =>
      t.kind ? (
        <span key={k} className={`l-tok-${t.kind}`}>
          {t.text}
        </span>
      ) : (
        t.text
      ),
    )}
  </>
);

/** Lines of the new text a change touched: added outright, or changed from an old line. */
export function marksOf(before: string | undefined, after: string | undefined) {
  const rows: Row[] = diffRows(linesOf(before), linesOf(after));
  const withDel = new Set(rows.flatMap((r) => (r.kind === "del" ? [r.change] : [])));
  const marks = new Map<number, "added" | "changed">();
  for (const r of rows) if (r.kind === "add" && r.new !== undefined) marks.set(r.new, withDel.has(r.change) ? "changed" : "added");
  return marks;
}

export const dirOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "");
export const baseOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
