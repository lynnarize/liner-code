/*
  Liner · Code block
  Code on a white card with its file name and a copy button on the glass above. Lines can be
  numbered and picked out; syntax colors are quiet, mixed toward the ink so they suit either
  theme without a second palette.
*/
import { useMemo, useState } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { tokenize, type Lang } from "./tokenize";
import "./code-block.css";

export type CodeBlockProps = {
  code: string;
  language?: Lang;
  filename?: string;
  /** 1-based line numbers to pick out. */
  highlight?: number[];
  lineNumbers?: boolean;
  /** Wrap long lines instead of scrolling. */
  wrap?: boolean;
  maxHeight?: number;
  className?: string;
};

export function CodeBlock({ code, language = "tsx", filename, highlight = [], lineNumbers = true, wrap, maxHeight = 420, className }: CodeBlockProps) {
  const lines = useMemo(() => tokenize(code.replace(/\n$/, ""), language), [code, language]);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      /* clipboard can be blocked; the code is still selectable */
    }
    setCopied(true);
    feedback.play("success");
    window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <figure className={cx("l-code l-frame", className)} data-wrap={wrap || undefined}>
      <div className="l-frame-strip l-code__bar">
        <span className="l-code__name">{filename ?? language}</span>
        <span className="l-code__tools">
          {filename && <span className="l-code__lang">{language}</span>}
          <button type="button" className="l-code__copy" onClick={copy} aria-label={copied ? "Copied" : "Copy code"}>
            <span key={String(copied)}>
              {copied ? (
                <svg viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M3.6 8.4 6.6 11.3 12.4 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
                  <rect x="5.5" y="5.5" width="8" height="8" rx="1.8" />
                  <path d="M10.5 3.25H4.25a1.5 1.5 0 0 0-1.5 1.5v6" strokeLinecap="round" />
                </svg>
              )}
              {copied ? "Copied" : "Copy"}
            </span>
          </button>
        </span>
      </div>
      <div className="l-frame-card l-code__card">
        <pre className="l-code__pre" style={{ maxHeight }} tabIndex={0} aria-label={filename ? `${filename}, ${language}` : `${language} code`}>
          <code>
            {lines.map((toks, i) => (
              <span key={i} className="l-code__line" data-hl={highlight.includes(i + 1) || undefined}>
                {lineNumbers && (
                  <span className="l-code__n" aria-hidden>
                    {i + 1}
                  </span>
                )}
                <span className="l-code__src">
                  {toks.length
                    ? toks.map((t, j) =>
                        t.kind ? (
                          <span key={j} className={`l-tok-${t.kind}`}>
                            {t.text}
                          </span>
                        ) : (
                          t.text
                        ),
                      )
                    : " "}
                </span>
              </span>
            ))}
          </code>
        </pre>
      </div>
    </figure>
  );
}
