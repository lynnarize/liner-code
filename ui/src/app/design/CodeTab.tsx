/*
  The Code tab: the selected layer itself, not an export. "HTML and CSS" is its HTML with its own
  inline styles as a rule under it, and it is editable: type, then leave the field or press
  ⌘Enter, and the layer is replaced with what you wrote (one { id, html } op, one undo step); Esc
  puts it back. A change made in Style marks the line it changed. JSX and Tailwind are the same
  layer said another way, read only (inspect/convert.ts says how, and what it leaves out).

  A drawn frame's layer is its file's own source (canvas.frame.node), read again whenever the
  file's revision moves: never the page on screen, whose scripts may have built children into it
  or set attributes on it, which an edit here would otherwise write into the file for good. A live
  page (and the mock) has only the page, so there it is the page's.
*/
import { useEffect, useMemo, useRef, useState } from "react";
import { Toks, tokensOf } from "../code";
import { rpc } from "../engine";
import { design, frameOf, useDesign } from "./store";
import { Choice } from "./inspect/controls";
import { backToHtml, htmlAndCss, toJsx } from "./inspect/convert";
import { Empty } from "./inspect/Empty";
import { useLastChange } from "./inspect/target";

type Way = "html" | "jsx" | "tailwind";
const WAYS = [
  { value: "html" as const, label: "HTML and CSS" },
  { value: "jsx" as const, label: "JSX" },
  { value: "tailwind" as const, label: "Tailwind" },
];
const WAY_KEY = "liner.ld.code";
const wayAtStart = (): Way => {
  try {
    const v = sessionStorage.getItem(WAY_KEY);
    return v === "jsx" || v === "tailwind" ? v : "html";
  } catch {
    return "html";
  }
};

export function CodeTab() {
  const node = useDesign((s) => s.node);
  const sel = useDesign((s) => s.sel);
  const frame = sel.find((x) => x.node)?.frame;
  const several = sel.filter((x) => x.node).length;
  const [way, setWay] = useState<Way>(wayAtStart);
  const pick = (w: Way) => {
    setWay(w);
    try {
      sessionStorage.setItem(WAY_KEY, w);
    } catch {
      // kept for this view only
    }
  };
  const source = useSource(frame, node?.id);
  if (!node || !frame) return sel.length ? <Empty several={sel.length > 1} /> : <Empty />;
  const html = source.from === "page" ? node.html : source.html;
  return (
    <div className="ld-body ld-code-tab">
      <div className="ld-segs">
        <Choice label="Say it as" options={WAYS} value={way} onPick={pick} fit />
      </div>
      {html === undefined ? (
        source.missing ? (
          <p className="ld-note" role="status">This layer isn't in the frame's file: the page's own script draws it, so there is no HTML of it to show or change here. Change the script, or ask the agent.</p>
        ) : (
          <p className="ld-note l-shimmer" role="status">Reading the layer from its file</p>
        )
      ) : way === "html" ? (
        <Editable key={`${frame}/${node.id}`} frame={frame} id={node.id} html={html} />
      ) : (
        <ReadOnly code={toJsx(html, way === "tailwind")} />
      )}
      {several > 1 && <p className="ld-note">The first of {several} selected layers.</p>}
      {way === "html" ? (
        <>
          <p className="ld-note">This is the layer itself, not an export. Type here and the layer redraws; move a control in Style and its line changes.</p>
          <p className="ld-note">Where the frame declares the lean's tokens, their names stay names (<span className="ld-mono">var(--space-3)</span>, not 12), so the build can map them to the project's own tokens.</p>
        </>
      ) : way === "jsx" ? (
        <p className="ld-note">Read only. The same layer said in JSX: attributes as React names them, inline styles as a style object, event attributes left out.</p>
      ) : (
        <p className="ld-note">Read only. A Tailwind class only where one says exactly the same, on its default scale; everything else stays in style.</p>
      )}
    </div>
  );
}

/**
  The layer's HTML as the Code tab shows and edits it: for a drawn frame, its file's own source by
  id, read again when the file's revision moves (an edit here or in Style, undo, an agent's write);
  `missing` when the file hasn't got it (a script on the page draws it). For a live page or the
  mock, the page's (`from: "page"`).
*/
function useSource(frame: string | undefined, id: string | undefined): { from: "file" | "page"; html?: string; missing?: boolean } {
  const drawn = useDesign((s) => !s.mock && frameOf(s, frame)?.kind === "drawn");
  const cwd = useDesign((s) => s.cwd);
  const file = useDesign((s) => s.file?.id);
  const rev = useDesign((s) => (frame ? s.revs[frame] : undefined));
  const [got, setGot] = useState<{ key: string; html?: string; missing?: boolean } | undefined>();
  const key = `${cwd}\u0000${file}\u0000${frame}\u0000${id}`;
  useEffect(() => {
    if (!drawn || !cwd || !file || !frame || !id) return;
    let live = true;
    void rpc("canvas.frame.node", { cwd, file, frame, id }).then(
      (r) => live && setGot({ key, html: r.html }),
      () => live && setGot({ key, missing: true }),
    );
    return () => void (live = false);
  }, [drawn, key, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!drawn) return { from: "page" };
  // Another layer's source is never shown for this one while its own is read.
  return got?.key === key ? { from: "file", html: got.html, missing: got.missing } : { from: "file" };
}

/** "a: b" lines of the rule whose property the last Style change wrote (padding marks padding-top's line too). */
const touches = (line: string, props: string[]) => {
  const m = /^\s+([\w-]+)\s*:/.exec(line);
  if (!m) return false;
  const k = m[1];
  // A corner is border-radius's, not border's.
  return props.some((p) => p === k || (p.startsWith(k + "-") && !(k === "border" && p.includes("radius"))) || k.startsWith(p + "-"));
};

function Editable({ frame, id, html }: { frame: string; id: string; html: string }) {
  const source = useMemo(() => htmlAndCss(html, id), [html, id]);
  const [draft, setDraft] = useState(source.text);
  const [editing, setEditing] = useState(false);
  const [bad, setBad] = useState(false);
  // The engine's sentence when it turned the draft down; the draft stays in the box.
  const [refused, setRefused] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const last = useLastChange();
  useEffect(() => {
    if (!editing) setDraft(source.text);
  }, [source.text, editing]);
  const text = editing ? draft : source.text;
  const lines = text.split("\n");
  const ruleAt = editing ? lines.findIndex((l, i) => i > 0 && /\{\s*$/.test(l) && !/[<>]/.test(l)) : source.ruleAt;
  const toks = useMemo(() => {
    const at = ruleAt < 0 ? lines.length : ruleAt;
    return [...tokensOf(lines.slice(0, at), "html"), ...(at < lines.length ? tokensOf(lines.slice(at), "css") : [])];
  }, [text, ruleAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const marked = (i: number) => !editing && last?.id === id && ruleAt >= 0 && i > ruleAt && touches(lines[i], last.props);

  // The draft on its way, so ⌘Enter and the blur after it send it once (one edit, one step to undo).
  const sending = useRef<string | null>(null);
  const sent = useRef<string | null>(null);
  /** Sends the draft as typed; answers whether the box may let go of it (sent and taken, or nothing to send). */
  const apply = async () => {
    if (draft === source.text || sending.current === draft || sent.current === draft) return true;
    const out = backToHtml(draft, html, id);
    if (!out) return (setBad(true), false);
    setBad(false);
    sending.current = draft;
    const r = await design.apply(frame, [{ id, html: out }], { coalesce: `code:${id}:${Date.now()}`, own: true }).finally(() => (sending.current = null));
    // Taken: the blur that follows ⌘Enter sends nothing more.
    if (!r || r.ok) sent.current = draft;
    if (r && !r.ok) return (setRefused(r.error ?? "The engine didn't take it."), false);
    setRefused(null);
    return true;
  };
  const done = (el?: HTMLTextAreaElement) => void apply().then((ok) => (ok ? (setEditing(false), el?.blur()) : el?.focus()));
  return (
    <div className="ld-code lc-code-view" data-bad={bad || refused ? true : undefined}>
      <div className="ld-code-in">
        {lines.map((_, i) => (
          <div key={i} className="lc-cl" data-mark={marked(i) ? "changed" : undefined}>
            <span className="lc-cl-n">{i + 1}</span>
            <span className="lc-cl-t">
              <Toks line={toks[i]} />
              {"​"}
            </span>
          </div>
        ))}
        <textarea
          ref={area}
          className="ld-code-ta"
          aria-label="The layer's HTML and CSS"
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          wrap="off"
          value={text}
          onFocus={() => ((sent.current = null), setDraft(source.text), setEditing(true))}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => editing && sending.current === null && done()}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              done(e.currentTarget);
            } else if (e.key === "Escape") {
              e.preventDefault();
              setDraft(source.text);
              setBad(false);
              setRefused(null);
              setEditing(false);
              e.currentTarget.blur();
            } else if (e.key === "Tab" && !e.shiftKey) {
              // Two spaces, as the rule is indented; Shift-Tab still leaves the field.
              e.preventDefault();
              const el = e.currentTarget;
              const a = el.selectionStart;
              const next = draft.slice(0, a) + "  " + draft.slice(el.selectionEnd);
              setDraft(next);
              requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2));
            }
          }}
        />
      </div>
      {bad && <p className="ld-note" role="alert">There's no element in it to put in the layer's place. Esc puts it back.</p>}
      {refused && !bad && <p className="ld-note ld-code-no" role="alert">{refused} Your text is still here. Esc puts it back.</p>}
    </div>
  );
}

function ReadOnly({ code }: { code: string }) {
  const lines = code.split("\n");
  const toks = useMemo(() => tokensOf(lines, "tsx"), [code]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="ld-code lc-code-view" tabIndex={0} aria-label="Read only code">
      <div className="ld-code-in">
        {lines.map((_, i) => (
          <div key={i} className="lc-cl">
            <span className="lc-cl-n">{i + 1}</span>
            <span className="lc-cl-t">
              <Toks line={toks[i]} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
