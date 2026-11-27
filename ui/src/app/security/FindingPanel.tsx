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
import { SendBox } from "../Composer";
import { PaneBody, PaneButton, PaneFile, PaneFoot, PaneHead, PaneRow, PaneSection, PaneTool, PaneWords, PANE_TOOL } from "../Pane";
import { MenuFoot, PanelHead, Pop, Row, Sep } from "../ui";
import { act, MOCK } from "./findings-data";
import { SevMark } from "./parts";
import { goSecurity } from "./store";
import { fixedAt, insideProject, tidyEnd, when } from "./when";
import "./findings.css";

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
  A piece of code under its file's own row (the frame's PaneFile, as Changes and Files draw a file): the file and its first
  line that matters, Open in your editor at the row's end when it opens, then the lines flush under it, the ones that
  matter tinted as Files tints a change.
*/
function Excerpt({ x, onOpen }: { x: CodeExcerpt; onOpen?: () => void }) {
  return (
    <div className="lf-x-exc">
      <PaneFile path={`${x.file}${x.hit.length ? `:${x.hit[0]}` : ""}`}>{onOpen && <PaneTool label="Open in your editor" icon={<I.external size={14} />} onClick={onOpen} />}</PaneFile>
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

/** The icon an activity row is drawn with, by what happened. */
const ACT_ICON: Record<string, (p: { size?: number }) => ReactNode> = { found: I.search, "raised-again": I.refresh, looked: I.settle, dismissed: I.close, reopened: I.undo, "fix-started": I.tool, fixed: I.check, note: I.comment };

/**
  Dismiss, with why: a reason picks it at once; Other asks for a note first, in the same menu, with a way back on top and
  the note sent by Enter, or no note by the row under it (a menu holds rows, never buttons of its own). It is keyed by
  the finding, so Next never carries one finding's note to the next.
*/
function Dismiss({ onDismiss }: { onDismiss: (r: DismissReason, note?: string) => void }) {
  const [other, setOther] = useState(false);
  const [note, setNote] = useState("");
  return (
    <Pop
      label="Dismiss, and say why"
      menu
      side="top"
      align="end"
      width={280}
      triggerClass="lc-pane-btn lf-x-dismiss"
      // Shut by a click outside or Escape, it opens next time at its reasons, not on Other with the note left in it.
      onOpenChange={(open) => !open && (setOther(false), setNote(""))}
      trigger={
        <>
          Dismiss
          <I.chevD size={12} />
        </>
      }
    >
      {(close) =>
        other ? (
          <>
            <Row title="Back" icon={<I.chevL size={14} />} onPick={() => setOther(false)} />
            <Sep />
            <PanelHead>Why it isn't one to act on</PanelHead>
            <div className="lf-x-other">
              <SendBox
                value={note}
                lines={3}
                autoFocus
                label="Why it isn't one to act on"
                placeholder="In a few words"
                onChange={setNote}
                onEscape={() => setOther(false)}
                onSend={() => {
                  close();
                  setOther(false);
                  onDismiss("other", note.trim() || undefined);
                  setNote("");
                }}
              />
            </div>
            {/* The box sends only words, and the note was always optional: while it is empty, this row dismisses without one. */}
            {!note.trim() && (
              <>
                <Sep />
                <Row title="Dismiss without a note" icon={<I.close size={14} />} onPick={() => (close(), setOther(false), onDismiss("other"), setNote(""))} />
              </>
            )}
          </>
        ) : (
          <>
            <PanelHead>Why it isn't one to act on</PanelHead>
            {REASONS.map((r) => (
              <Row key={r} title={DISMISS_LABEL[r]} opens={r === "other" ? "Why" : undefined} onPick={() => (r === "other" ? setOther(true) : (close(), onDismiss(r)))} />
            ))}
            <Sep />
            <MenuFoot>The next scan won't raise it again.</MenuFoot>
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
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const who = useWho();
  const root = useRef<HTMLElement>(null);
  // A new finding starts at its top.
  useEffect(() => void root.current?.querySelector(".lc-pane-body")?.scrollTo({ top: 0 }), [f.id]);
  // And with an empty note box: the panel stays up across Next, and Enter would add words meant for the last finding to this one.
  useEffect(() => setNote(""), [f.id]);

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
  const secondLook = () => run(act.look(f.id).then((n) => (toast(n.look.state === "confirmed" ? "Second look confirmed it" : "Second look finished"), onActed?.(n))));
  const addNote = () => {
    const text = note.trim();
    if (!text) return;
    setNote("");
    run(act.note(f.id, text).then((n) => (toast("Note added"), onActed?.(n))));
  };
  // The head's ···: what acts on the finding beyond the foot's own actions. Shown only when it has a row.
  const canLook = f.state === "open" && f.look.state === "none";
  const more = (canLook || f.url) && (
    <Pop label="More for this finding" menu align="end" width={240} triggerClass={PANE_TOOL} trigger={<I.more size={16} />}>
      {(close) => (
        <>
          {canLook && <Row title="Get a second look" note="Have another model double-check this finding against the code" icon={<I.settle size={14} />} disabled={busy} onPick={() => (close(), secondLook())} />}
          {f.url && <Row title="Open on GitHub" icon={<I.external size={14} />} onPick={() => (close(), bridge.openExternal(f.url!))} />}
        </>
      )}
    </Pop>
  );
  // How it stands, as plain words in the head (the pull request's head says its state so): the second look, then fixed or dismissed.
  const states = [f.look.state === "confirmed" ? ["Confirmed", "ok"] : f.look.state === "unconfirmed" ? ["Couldn't confirm", ""] : null, f.state === "fixed" ? ["Fixed", ""] : f.state === "dismissed" ? ["Dismissed", ""] : null].filter((x): x is string[] => Boolean(x));

  return (
    <aside ref={root} className="lf-x" aria-label={`The finding: ${f.title}`}>
      <PaneHead
        name="Finding"
        onClose={onClose}
        shows={
          <>
            <span className="lf-x-sev"><SevMark severity={f.severity} dot /></span>
            {states.map(([w, tone]) => (
              <span key={w} className="lf-x-state" data-tone={tone || undefined}>{w}</span>
            ))}
            {place && <span className="lf-x-place"><PaneWords>{place}</PaneWords></span>}
          </>
        }
        tools={
          <>
            <PaneTool label={`The finding before (↑)${place ? `, ${place}` : ""}`} icon={<I.chevU size={16} />} disabled={!onPrev} onClick={onPrev} />
            <PaneTool label={`The next finding (↓)${place ? `, ${place}` : ""}`} icon={<I.chevD size={16} />} disabled={!onNext} onClick={onNext} />
            {more}
          </>
        }
      />

      <PaneBody className="lf-x-body">
        <div className="lf-x-top">
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
        </div>

        {/* Summary, Code and Activity are sections of one column, as the panel's surfaces have them: no tabs in a body. */}
        <PaneSection label="Summary">
          {/* The lead sentence in a block tinted by how bad it is, with that colour's halftone in its corner. */}
          <div className="lf-x-leadbox" data-sev={f.severity}>
            <i className="lc-ht lc-ht-corner lc-ht-soft" aria-hidden />
            <p className="lf-x-lead"><Inline text={tidyEnd(ex?.lead || f.title)} /></p>
            {!ex && <p className="lf-x-quiet">No more was said about it than its title{f.rule ? ` and its rule, ${f.rule}` : ""}.</p>}
          </div>
        </PaneSection>
        {f.state === "dismissed" && f.dismissed && (
          <PaneSection label="Dismissed">
            <div className="lf-x-txt">
              <p>{DISMISS_LABEL[f.dismissed.reason]}, {when(f.dismissed.at)}{f.dismissed.note ? `: ${f.dismissed.note}` : "."}</p>
            </div>
          </PaneSection>
        )}
        {f.look.state !== "none" && (
          <PaneSection label="A second look">
            <PaneRow icon={f.look.state === "confirmed" ? <span className="lf-x-ok"><I.settle size={14} /></span> : <I.info size={14} />}>
              {f.look.state === "confirmed" ? `Confirmed by ${who(f.look.by) || "another model"}` : `${who(f.look.by) || "Another model"} couldn't confirm it`}
            </PaneRow>
            <div className="lf-x-txt">
              <p className="lf-x-quiet">
                {f.look.state === "confirmed" ? "A model from another maker than the one that scanned." : "Reading as a model from another maker than the one that scanned."}
                {f.look.words && <> {f.look.words}</>}
              </p>
            </div>
          </PaneSection>
        )}
        {ex?.wrong && (
          <PaneSection label="What is wrong">
            <div className="lf-x-txt"><Words text={ex.wrong} /></div>
          </PaneSection>
        )}
        {codeCount > 0 && (
          <PaneSection label="Code" note={codeCount}>
            {places.length ? (
              places.map((x, i) => <Excerpt key={i} x={x} onOpen={open(x.file)} />)
            ) : (
              <div className="lf-x-exc">
                <PaneFile path={`${f.file}${f.line ? `:${f.line}` : ""}`}>{open(f.file!) && <PaneTool label="Open in your editor" icon={<I.external size={14} />} onClick={open(f.file!)} />}</PaneFile>
                <div className="lf-x-txt"><p className="lf-x-quiet">No lines came with this finding, only the file.</p></div>
              </div>
            )}
          </PaneSection>
        )}
        {ex?.who && (
          <PaneSection label="Who can do it">
            <div className="lf-x-txt"><Words text={ex.who} /></div>
          </PaneSection>
        )}
        {ex?.gets && (
          <PaneSection label="What they get">
            <div className="lf-x-txt"><Words text={ex.gets} /></div>
          </PaneSection>
        )}
        {ex?.see?.length ? (
          <PaneSection label="How to see it">
            <div className="lf-x-txt">
              <ol>
                {ex.see.map((s, i) => (
                  <li key={i}>
                    <Words text={s} tight />
                  </li>
                ))}
              </ol>
            </div>
          </PaneSection>
        ) : null}
        <PaneSection label="Activity" note={f.activity.length}>
          {[...f.activity].reverse().map((a, i) => {
            const Icon = ACT_ICON[a.kind] ?? I.info;
            return (
              <PaneRow key={i} icon={<Icon size={14} />} value={[who(a.by).replace(/^./, (c) => c.toUpperCase()), when(a.at)].filter(Boolean).join(" · ")} quiet title={a.text}>
                <Inline text={a.text} />
              </PaneRow>
            );
          })}
          <div className="lf-x-note">
            <SendBox value={note} label="Add a triage note" placeholder="Add a triage note" disabled={busy} onChange={setNote} onSend={addNote} />
          </div>
        </PaneSection>
      </PaneBody>

      {/* Three buttons leave the words little room in a narrow panel: a few words, the whole sentence in the tooltip. */}
      {f.state === "open" ? (
        <PaneFoot say={<span title={fixing ? (f.fix?.state === "ready" ? "Its fix is ready to merge" : "Being fixed in a session in its own worktree") : "Fix starts a session in its own worktree, with this as its brief"}>{fixing ? (f.fix?.state === "ready" ? "Fix ready to merge" : "Being fixed") : "Fix works in a worktree"}</span>}>
          <Dismiss key={f.id} onDismiss={(r, note) => run(act.dismiss(f.id, r, note).then((n) => (toast(`Dismissed as ${DISMISS_LABEL[r].toLowerCase()}. The next scan won't raise it again.`), onActed?.(n))))} />
          <PaneButton disabled={busy} onClick={() => run(act.ask(f.id).then((t) => (t ? goThread(t.id) : MOCK && toast("Mock: a session to ask about it would open here."))))}>
            Ask about it
          </PaneButton>
          {fixing ? (
            <PaneButton ink onClick={() => goThread(f.fix?.threadId)}>
              Open the session
            </PaneButton>
          ) : (
            <PaneButton ink disabled={busy} title="A session in its own worktree, with this as its brief" onClick={() => run(act.fix(f.id).then((t) => (t ? goThread(t.id) : MOCK && toast("Mock: the fix session would open here."))))}>
              Fix
            </PaneButton>
          )}
        </PaneFoot>
      ) : (
        <PaneFoot say={f.state === "dismissed" ? `Dismissed${f.dismissed ? ` as ${DISMISS_LABEL[f.dismissed.reason].toLowerCase()}, ${when(f.dismissed.at)}` : ""}` : `Fixed, ${when(fixedAt(f))}`}>
          {f.fix?.threadId && f.state === "fixed" && <PaneButton onClick={() => goThread(f.fix?.threadId)}>Open the session</PaneButton>}
          <PaneButton ink disabled={busy} onClick={() => run(act.reopen(f.id).then((n) => (toast("Reopened"), onActed?.(n))))}>
            Reopen
          </PaneButton>
        </PaneFoot>
      )}
    </aside>
  );
}
