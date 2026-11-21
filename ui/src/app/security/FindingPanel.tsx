/*
  Liner Security: one finding, open in the panel beside the Findings list (board B). Its head (how bad, what the second
  look said, the finding before and after, close), its title and where it is, then its own tabs: Summary (the one
  sentence that says what someone can do with it, the second look, what is wrong, where, who can do it, what they get,
  and the steps to see it), Code (every place it touches, each with Open in your editor) and Activity (what happened to it,
  with times). The body scrolls and fades at its foot; the actions stay: Dismiss (with why), Ask about it, and Fix, which
  becomes Open the session while a fix is at work and Reopen once it is dismissed or fixed. Builder U2.

  Everything a finding says was written by an agent, a checker or a SARIF file, so it is shown as text only, never as
  HTML. The few shapes it may take are read here: `code` in backticks, a fenced ``` block as a command, lines starting
  "- " as a list. Long unbroken strings wrap, so nothing widens the panel.
*/
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import type { CodeExcerpt, DismissReason, SecurityFinding } from "@contracts";
import { DISMISS_LABEL, splitModel, familyOf } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { bridge } from "../bridge";
import { useEngine } from "../engine";
import { I } from "../icons";
import { providerLabel } from "../model";
import { Pop, Row } from "../ui";
import { act, MOCK } from "./findings-data";
import { SevMark, Tag } from "./parts";
import { goSecurity } from "./store";
import { fixedAt, insideProject, tidyEnd, when } from "./when";
import "./findings.css";

type Tab = "summary" | "code" | "activity";
const REASONS = Object.keys(DISMISS_LABEL) as DismissReason[];
const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));

/** Who did something, as a sentence names them: a model ref by its maker ("Claude", "Codex"), else "you", "the free checks", "GitHub's alerts". */
export function useWho() {
  const providers = useEngine((s) => s.providers);
  return (by?: string) => {
    if (!by) return "";
    if (by === "you") return "you";
    if (by === "free checks") return "the free checks";
    if (by === "gh") return "GitHub's alerts";
    if (by === "sarif") return "a report file";
    if (!by.includes(":")) return by;
    const family = familyOf(splitModel(by.replace(/^@/, "")).provider);
    const known: Record<string, string> = { claude: "Claude", codex: "Codex", opencode: "OpenCode", gemini: "Gemini", demo: "the Demo" };
    return known[family] ?? providerLabel(by.replace(/^@/, ""), providers).replace(/ (Code|CLI)$/, "");
  };
}

/** A line of a finding's words with its `code` spans drawn as code, and nothing else read as markup. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/`([^`\n]+)`/);
  return <>{parts.map((p, i) => (i % 2 ? <code key={i}>{p}</code> : <Fragment key={i}>{p}</Fragment>))}</>;
}

/** A finding's words as blocks: paragraphs (one per line), "- " lines as a list, and ``` fenced blocks as a command. */
function Words({ text, tight }: { text: string; tight?: boolean }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let list: string[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={`u${blocks.length}`}>{list.map((l, i) => <li key={i}><Inline text={l} /></li>)}</ul>);
    list = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flush();
      const cmd: string[] = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i])) cmd.push(lines[i]);
      blocks.push(<div key={`c${blocks.length}`} className="lf-x-ev lf-x-cmd">{cmd.join("\n")}</div>);
    } else if (/^\s*[-•]\s+/.test(line)) list.push(line.replace(/^\s*[-•]\s+/, ""));
    else if (line.trim()) (flush(), blocks.push(tight && !blocks.length ? <Fragment key={`p${blocks.length}`}><Inline text={line} /></Fragment> : <p key={`p${blocks.length}`}><Inline text={line} /></p>));
  }
  flush();
  return <>{blocks}</>;
}

/**
  A piece of code with its line numbers, the lines that matter marked. `head`: its file and Open in your editor above it (the
  Code tab); `cap`: only its file's name above it (Summary, for a file other than the finding's own).
*/
function Excerpt({ x, head, cap, onOpen }: { x: CodeExcerpt; head?: boolean; cap?: boolean; onOpen?: () => void }) {
  return (
    <div className="lf-x-exc">
      {cap && !head && <div className="lf-x-cap lf-x-mono">{x.file}</div>}
      {head && (
        <div className="lf-x-exh">
          <span className="lf-x-mono">{x.file}{x.hit.length ? `:${x.hit[0]}` : ""}</span>
          {onOpen && (
            <button type="button" className="lc-btn l-focus" data-kind="ghost" data-size="sm" onClick={onOpen}>
              <I.external size={14} />
              Open in your editor
            </button>
          )}
        </div>
      )}
      <div className="lf-x-ev" role="group" aria-label={`${x.file}, from line ${x.start}`}>
        {x.lines.map((l, i) => {
          const n = x.start + i;
          const hit = x.hit.includes(n);
          return (
            <div key={i} className="lf-x-dl" data-hit={hit || undefined}>
              <span className="lf-x-n" aria-hidden>{n}</span>
              <span>{l || " "}</span>
              {hit && <span className="l-sr-only"> (this line)</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Dismiss, with why: a reason picks it at once; Other asks for a note first. */
function Dismiss({ onDismiss }: { onDismiss: (r: DismissReason, note?: string) => void }) {
  const [other, setOther] = useState(false);
  const [note, setNote] = useState("");
  return (
    <Pop
      label="Dismiss, and say why"
      side="top"
      width={260}
      triggerClass="lc-btn lf-x-dismiss"
      triggerAttrs={{ "data-kind": "ghost", "data-size": "sm" }}
      trigger={
        <>
          Dismiss
          <I.chevD size={12} />
        </>
      }
    >
      {(close) =>
        other ? (
          <form
            className="lf-x-other"
            onSubmit={(e) => {
              e.preventDefault();
              close();
              setOther(false);
              onDismiss("other", note.trim() || undefined);
              setNote("");
            }}
          >
            <label htmlFor="lf-x-note">Why it isn't one to act on</label>
            <textarea id="lf-x-note" rows={3} value={note} placeholder="In a few words" onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), e.currentTarget.form?.requestSubmit())} />
            <span className="lf-x-otherb">
              <button type="button" className="lc-btn l-focus" data-kind="ghost" data-size="sm" onClick={() => setOther(false)}>Back</button>
              <button type="submit" className="lc-btn l-focus" data-kind="ink" data-size="sm">Dismiss</button>
            </span>
          </form>
        ) : (
          <>
            <div className="lf-x-why">Why it isn't one to act on. The next scan won't raise it again.</div>
            {REASONS.map((r) => (
              <Row key={r} title={DISMISS_LABEL[r]} onPick={() => (r === "other" ? setOther(true) : (close(), onDismiss(r)))} end={r === "other" ? <I.chevR size={12} /> : undefined} />
            ))}
          </>
        )
      }
    </Pop>
  );
}

export function FindingPanel({ finding: f, onClose, onPrev, onNext, place, projectName, projectPath, onActed }: {
  finding: SecurityFinding;
  onClose: () => void;
  /** The finding before and after it in the list as it is narrowed and sorted; unset at its ends. */
  onPrev?: () => void;
  onNext?: () => void;
  /** "2 of 4", read out with the arrows. */
  place?: string;
  projectName?: string;
  /** The project's folder, for Open in your editor. */
  projectPath?: string;
  /** After Dismiss or Reopen moved it out of the tab it was in, so the list can open the next one. */
  onActed?: (f: SecurityFinding) => void;
}) {
  const [tab, setTab] = useState<Tab>("summary");
  const [busy, setBusy] = useState(false);
  const who = useWho();
  const body = useRef<HTMLDivElement>(null);
  // A new finding starts at its Summary, scrolled to the top.
  useEffect(() => {
    setTab("summary");
    void body.current?.scrollTo({ top: 0 });
  }, [f.id]);
  useEffect(() => void body.current?.scrollTo({ top: 0 }), [tab]);

  const ex = f.explain;
  const places: CodeExcerpt[] = ex?.where?.length ? ex.where : [];
  const codeCount = places.length || (f.file ? 1 : 0);
  const firstFound = f.activity.find((a) => a.kind === "found");
  const fixing = f.state === "open" && (f.fix?.state === "working" || f.fix?.state === "ready");
  // Only a file that stays inside the project's folder opens; anything else has no Open in your editor. The shell checks it again
  // against the project's folder as the engine has it, and never runs it (desktop/src/editor.ts).
  const open = (file: string) => {
    const path = projectPath && bridge.opensFiles() ? insideProject(projectPath, file) : null;
    return path ? () => void bridge.openFile({ projectId: f.projectId }, path.slice(projectPath!.replace(/[\\/]+$/, "").length + 1)).catch(fail) : undefined;
  };
  const run = (p: Promise<unknown>) => (setBusy(true), void p.catch(fail).finally(() => setBusy(false)));
  const goThread = (id?: string) => id && goSecurity({ kind: "scan", threadId: id });

  const look = f.look.state === "none" ? null : (
    <div className="lf-x-look" data-state={f.look.state}>
      {f.look.state === "confirmed" ? <I.settle size={16} /> : <I.info size={16} />}
      <span>
        {f.look.state === "confirmed" ? (
          <>
            <b>Confirmed by {who(f.look.by) || "another model"}</b>, a model from another maker than the one that scanned.
          </>
        ) : (
          <>
            <b>{who(f.look.by) || "Another model"} couldn't confirm it</b>, reading as a model from another maker than the one that scanned.
          </>
        )}
        {f.look.words && <> {f.look.words}</>}
      </span>
    </div>
  );

  return (
    <aside className="lf-x" aria-label={`The finding: ${f.title}`}>
      <header className="lf-x-bar" data-drag>
        <SevMark severity={f.severity} dot />
        {(f.look.state !== "none" || f.state !== "open") && (
          <span className="lf-x-tags">
            {f.look.state === "confirmed" && <Tag tone="ok">Confirmed</Tag>}
            {f.look.state === "unconfirmed" && <Tag>Couldn't confirm</Tag>}
            {f.state !== "open" && <Tag>{f.state === "fixed" ? "Fixed" : "Dismissed"}</Tag>}
          </span>
        )}
        <span className="lc-grow" />
        <button type="button" className="lc-tb l-focus" aria-label={`The finding before${place ? `, ${place}` : ""}`} title="The finding before (↑)" disabled={!onPrev} onClick={onPrev}>
          <I.chevU size={16} />
        </button>
        <button type="button" className="lc-tb l-focus" aria-label={`The next finding${place ? `, ${place}` : ""}`} title="The next finding (↓)" disabled={!onNext} onClick={onNext}>
          <I.chevD size={16} />
        </button>
        <button type="button" className="lc-tb l-focus" aria-label="Close the finding" title="Close (Esc)" onClick={onClose}>
          <I.close size={16} />
        </button>
      </header>

      <div className="lf-x-body" ref={body} tabIndex={-1}>
        <h2 className="lf-x-h2">{f.title}</h2>
        <div className="lf-x-meta">
          {projectName && <span>{projectName}</span>}
          {f.file && (
            <>
              {projectName && <span aria-hidden>·</span>}
              <span className="lf-x-mono">{f.file}{f.line ? `:${f.line}` : ""}</span>
            </>
          )}
          <span aria-hidden>·</span>
          <span>{f.source === "agent" ? `found by ${who(firstFound?.by) || "a scan"}, ${when(firstFound?.at ?? f.foundAt)}` : `${f.source === "checks" ? "found by the free checks" : f.source === "github" ? "brought in from GitHub" : "brought in from a report"}, ${when(f.foundAt)}`}</span>
        </div>

        <div className="ls-segs lf-x-tabs" role="tablist" aria-label="About this finding">
          {([["summary", "Summary"], ["code", "Code", codeCount], ["activity", "Activity", f.activity.length]] as [Tab, string, number?][]).map(([id, label, n]) => (
            <button key={id} type="button" role="tab" id={`lf-x-t-${id}`} aria-controls="lf-x-tab" aria-selected={tab === id} className="ls-sg l-focus" onClick={() => setTab(id)}>
              {label}
              {n !== undefined && <span className="ls-num">{n}</span>}
            </button>
          ))}
        </div>

        <div id="lf-x-tab" role="tabpanel" aria-labelledby={`lf-x-t-${tab}`}>
          {tab === "summary" && (
            <>
              <p className="lf-x-lead"><Inline text={tidyEnd(ex?.lead || f.title)} /></p>
              {f.state === "dismissed" && f.dismissed && (
                <>
                  <h3>Dismissed</h3>
                  <p>{DISMISS_LABEL[f.dismissed.reason]}, {when(f.dismissed.at)}{f.dismissed.note ? `: ${f.dismissed.note}` : "."}</p>
                </>
              )}
              {look && (
                <>
                  <h3>A second look</h3>
                  {look}
                </>
              )}
              {ex?.wrong && (
                <>
                  <h3>What is wrong</h3>
                  <Words text={ex.wrong} />
                </>
              )}
              {places.length > 0 && (
                <>
                  <h3>Where</h3>
                  {/* The file is named above an excerpt from another file, unless its own first line names it already. */}
                  {places.map((x, i) => <Excerpt key={i} x={x} cap={x.file !== f.file && !x.lines[0]?.includes(x.file)} />)}
                </>
              )}
              {ex?.who && (
                <>
                  <h3>Who can do it</h3>
                  <Words text={ex.who} />
                </>
              )}
              {ex?.gets && (
                <>
                  <h3>What they get</h3>
                  <Words text={ex.gets} />
                </>
              )}
              {ex?.see?.length ? (
                <>
                  <h3>How to see it</h3>
                  <ol>
                    {ex.see.map((s, i) => (
                      <li key={i}>
                        <Words text={s} tight />
                      </li>
                    ))}
                  </ol>
                </>
              ) : null}
              {!ex && <p className="lf-x-quiet">No more was said about it than its title{f.rule ? ` and its rule, ${f.rule}` : ""}.</p>}
              {f.url && (
                <p className="lf-x-quiet">
                  <button type="button" className="lf-x-link l-focus" onClick={() => bridge.openExternal(f.url!)}>
                    Where it lives on GitHub <I.external size={12} />
                  </button>
                </p>
              )}
            </>
          )}

          {tab === "code" &&
            (places.length ? (
              places.map((x, i) => <Excerpt key={i} x={x} head onOpen={open(x.file)} />)
            ) : f.file ? (
              <div className="lf-x-exc">
                <div className="lf-x-exh">
                  <span className="lf-x-mono">{f.file}{f.line ? `:${f.line}` : ""}</span>
                  {open(f.file) && (
                    <button type="button" className="lc-btn l-focus" data-kind="ghost" data-size="sm" onClick={open(f.file)}>
                      <I.external size={14} />
                      Open in your editor
                    </button>
                  )}
                </div>
                <p className="lf-x-quiet">No lines came with this finding, only the file.</p>
              </div>
            ) : (
              <p className="lf-x-quiet">This finding names no file.</p>
            ))}

          {tab === "activity" && (
            <ol className="lf-x-acts">
              {[...f.activity].reverse().map((a, i) => (
                <li key={i} data-kind={a.kind}>
                  <span className="lf-x-dot" aria-hidden />
                  <span className="lf-x-act">
                    <b><Inline text={a.text} /></b>
                    <small>{[who(a.by).replace(/^./, (c) => c.toUpperCase()), when(a.at)].filter(Boolean).join(" · ")}</small>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      <footer className="lf-x-act-bar">
        {f.state === "open" ? (
          <>
            <Dismiss onDismiss={(r, note) => run(act.dismiss(f.id, r, note).then((n) => (toast(`Dismissed as ${DISMISS_LABEL[r].toLowerCase()}. The next scan won't raise it again.`), onActed?.(n))))} />
            <span className="lc-grow" />
            <span className="lf-x-hint">{fixing ? (f.fix?.state === "ready" ? "Its fix is ready to merge" : "Being fixed in its own worktree") : "A session in its own worktree, with this as its brief"}</span>
            <button type="button" className="lc-btn l-focus" data-kind="ghost" data-size="sm" disabled={busy} onClick={() => run(act.ask(f.id).then((t) => (t ? goThread(t.id) : MOCK && toast("Mock: a session to ask about it would open here."))))}>
              Ask about it
            </button>
            {fixing ? (
              <button type="button" className="lc-btn l-focus" data-kind="ink" data-size="sm" onClick={() => goThread(f.fix?.threadId)}>
                Open the session
              </button>
            ) : (
              <button type="button" className="lc-btn l-focus" data-kind="ink" data-size="sm" disabled={busy} onClick={() => run(act.fix(f.id).then((t) => (t ? goThread(t.id) : MOCK && toast("Mock: the fix session would open here."))))}>
                Fix
              </button>
            )}
          </>
        ) : (
          <>
            <span className="lf-x-hint lf-x-hint-l">{f.state === "dismissed" ? `Dismissed${f.dismissed ? ` as ${DISMISS_LABEL[f.dismissed.reason].toLowerCase()}, ${when(f.dismissed.at)}` : ""}` : `Fixed, ${when(fixedAt(f))}`}</span>
            <span className="lc-grow" />
            {f.fix?.threadId && f.state === "fixed" && (
              <button type="button" className="lc-btn l-focus" data-kind="ghost" data-size="sm" onClick={() => goThread(f.fix?.threadId)}>
                Open the session
              </button>
            )}
            <button type="button" className="lc-btn l-focus" data-kind="ink" data-size="sm" disabled={busy} onClick={() => run(act.reopen(f.id).then((n) => (toast("Open again"), onActed?.(n))))}>
              Reopen
            </button>
          </>
        )}
      </footer>
    </aside>
  );
}
