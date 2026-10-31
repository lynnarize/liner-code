/*
  The Session surface: where this session runs (the Mac, the folder, the branch, the tool and its
  model), what fills its context as the tool counts it, source by source, with Compact, and the
  changes still to commit, each opening in the diff. It asks the engine when it shows, again when a
  turn starts or ends, and on Refresh.
*/
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ContextPart, ContextSource, FileChange, Item, SessionInfo, Thread } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { Tooltip } from "@liner/components/tooltip/tooltip";
import { rpc, useEngine } from "./engine";
import { I } from "./icons";
import { accessOf, checkpointsOf, compact, markOf, modelLabel, plural, sumLines } from "./model";
import { exportSession } from "./Sidebar";
import { Lines, ModelTag, PanelHead } from "./ui";

const home = (path: string) => path.replace(/^\/Users\/[^/]+/, "~");

export function SessionSurface({ thread, items, visible, onShowChange }: { thread: Thread; items: Item[]; visible: boolean; onShowChange: (path: string) => void }) {
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const { open, files } = useMemo(() => openFiles(items), [items]);
  const [failed, setFailed] = useState("");
  const [looking, setLooking] = useState(false);
  const providers = useEngine((s) => s.providers);
  const running = thread.status === "running";
  const look = () => {
    setLooking(true);
    rpc("thread.info", { id: thread.id })
      .then((i) => (setInfo(i), setFailed("")), (e: Error) => setFailed(e.message))
      .finally(() => setLooking(false));
  };
  // When it shows, and when a turn starts or ends.
  useEffect(() => {
    if (visible) look();
  }, [visible, thread.id, thread.turns, running]);

  const compactNow = () => {
    rpc("thread.send", { id: thread.id, text: "/compact" }).then(
      () => toast("Compacting the conversation", { description: "The tool sums up what came before, so the context has room again." }),
      (e: Error) => toast.error(e.message),
    );
  };

  if (!info) return <div className="lc-sinfo">{failed ? <p className="lc-sinfo-note">{failed}</p> : <span className="l-shimmer lc-sinfo-note">Asking the session</span>}</div>;

  return (
    <div className="lc-sinfo">
      <section className="lc-sinfo-card">
        <PanelHead
          end={
            <button type="button" className="lc-ib l-focus" aria-label="Refresh" title="Ask the session again" disabled={looking} onClick={look}>
              <I.refresh size={13} />
            </button>
          }
        >
          Environment
        </PanelHead>
        <Line icon={<I.laptop size={14} />}>{info.machine}</Line>
        <Line icon={<I.folder size={14} />} title={info.path}>
          {info.project} <span className="lc-quiet">· {home(info.path)}</span>
        </Line>
        {info.branch && (
          <Line icon={<I.branch size={14} />}>
            {info.branch} {info.worktree && <span className="lc-quiet">· its own worktree</span>}
          </Line>
        )}
        <Line icon={<I.chip size={14} />}>
          {info.tool} <ModelTag kind={markOf(`${info.provider}:${info.model}`)} label={modelLabel(`${info.provider}:${info.model}`, providers)} />
        </Line>
        <Line icon={<I.lock size={14} />}>{accessOf(info.access).label}</Line>
      </section>

      <ContextCard info={info} doing={running ? doingOf(items) : ""} running={running} onCompact={compactNow} />

      <section className="lc-sinfo-card">
        <PanelHead end={files.length > 0 && <Lines {...sumLines(files)} />}>Changes</PanelHead>
        {files.length ? (
          <>
            {files.map((f) => (
              <button key={f.path} type="button" className="lc-sinfo-file l-focus" title={f.from ? `${f.from} → ${f.path}` : f.path} onClick={() => onShowChange(f.path)}>
                <span className="lc-sinfo-st" data-status={f.status}>
                  {LETTER[f.status]}
                </span>
                <span className="lc-sinfo-path">
                  {f.path.includes("/") && <span className="lc-quiet">{f.path.slice(0, f.path.lastIndexOf("/") + 1)}</span>}
                  {f.path.slice(f.path.lastIndexOf("/") + 1)}
                </span>
                <Lines added={f.added} removed={f.removed} />
              </button>
            ))}
            <p className="lc-sinfo-note">
              {plural(files.length, "file")} from {plural(open.length, "turn")}, not committed yet. Press one to see it in the diff.
            </p>
          </>
        ) : (
          <p className="lc-sinfo-note">Nothing waiting to commit. When a turn edits files, they show here.</p>
        )}
      </section>

      <button type="button" className="lc-btn lc-sinfo-export" data-kind="ghost" data-size="sm" onClick={() => exportSession(thread.id)}>
        <I.download size={13} />
        Export as Markdown
      </button>
    </div>
  );
}

/** What each kind of source is, for its tooltip. */
const GROUP_WORD: Record<ContextSource["group"], string> = { setup: "The tool's own", project: "Your project", talk: "The conversation", files: "Files", runs: "Commands", web: "The web", tools: "Other tools" };
/** Chips shown before "more": the bar still draws them all. */
const FIRST_CHIPS = 9;

/** The parts a tool lists, as sources, when it doesn't say more: used parts in the conversation's colour, past the first. */
const asSources = (parts: ContextPart[]): ContextSource[] => parts.filter((p) => p.kind === "used").map((p, i) => ({ name: p.name, tokens: p.tokens, group: i === 0 ? "setup" : "talk" }));

/** What the agent is at while its turn runs, in a word or two, beside the context it fills. */
function doingOf(items: Item[]) {
  const t = items.findLast((x): x is Extract<Item, { kind: "tool" }> => x.kind === "tool" && x.status === "running");
  if (items.some((x) => (x.kind === "approval" || x.kind === "question" || x.kind === "proposal") && x.state === "asking")) return "waiting for you";
  if (t) {
    if (/^(?:mcp__liner__|liner\.)browser_/.test(t.tool) || t.toolKind === "web" || t.toolKind === "fetch") return "on the web";
    return t.toolKind === "read" ? "reading" : t.toolKind === "edit" || t.toolKind === "write" ? "editing" : t.toolKind === "search" ? "searching" : t.toolKind === "exec" ? "running a command" : t.toolKind === "task" ? "with a subagent" : "working";
  }
  const last = items.at(-1);
  return last?.kind === "reasoning" && last.streaming ? "thinking" : last?.kind === "text" && last.streaming ? "writing" : "working";
}

/**
  What fills the context: how much of the window, as a bar of ticks in each source's colour with
  a mark where the tool compacts older turns, then each source with what it takes. A source says
  more when the pointer rests on it, and its ticks stand out.
*/
function ContextCard({ info, doing, running, onCompact }: { info: SessionInfo; doing: string; running: boolean; onCompact: () => void }) {
  const [hl, setHl] = useState<number | null>(null);
  const [all, setAll] = useState(false);
  const ctx = info.context;
  const compactBtn = info.compact && (
    <button type="button" className="lc-btn" data-kind="plain" data-size="sm" disabled={running || !ctx} title={running ? "Wait for the turn to finish" : "Sum up the conversation so far, to make room"} onClick={onCompact}>
      Compact
    </button>
  );
  if (!ctx)
    return (
      <section className="lc-sinfo-card lc-cx">
        <PanelHead end={compactBtn}>Context</PanelHead>
        <p className="lc-sinfo-note">Empty so far: the first turn fills it.</p>
      </section>
    );
  const sources = ctx.sources?.length ? ctx.sources : ctx.measured ? asSources(ctx.parts) : [{ name: "Used", tokens: ctx.used, group: "talk" as const }];
  const pct = (n: number) => `${Math.min(100, (n / ctx.max) * 100)}%`;
  const share = Math.round((ctx.used / ctx.max) * 100);
  const chips = all ? sources : sources.slice(0, FIRST_CHIPS);
  // Short, so it fits beside a chip at the panel's edge: what it is, then its share of the window.
  const tip = (s: ContextSource) => `${s.detail ?? GROUP_WORD[s.group]} · ${s.tokens / ctx.max < 0.001 ? "under 0.1%" : `${((s.tokens / ctx.max) * 100).toFixed(1)}%`}`;
  return (
    <section className="lc-sinfo-card lc-cx">
      <div className="lc-cx-head">
        <b>Context</b>
        {doing && (
          <span className="lc-cx-doing l-shimmer" key={doing}>
            {doing}
          </span>
        )}
        <span className="lc-grow" />
        <span className="l-num">
          {compact(ctx.used)} <span className="lc-quiet">of {compact(ctx.max)}</span>
        </span>
      </div>
      <div className="lc-cx-bar" role="img" aria-label={`${share}% of the context used${ctx.compactAt ? `; it compacts at ${compact(ctx.compactAt)}` : ""}`}>
        <div className="lc-cx-ticks" data-hl={hl !== null || undefined}>
          {sources.map((s, i) => (
            <i key={`${s.group}:${s.name}`} data-g={s.group} data-on={hl === i || undefined} style={{ width: pct(s.tokens) }} />
          ))}
        </div>
        {ctx.compactAt && ctx.autoCompact !== false && ctx.compactAt < ctx.max && <span className="lc-cx-mark" style={{ left: pct(ctx.compactAt) }} aria-hidden />}
      </div>
      {ctx.measured || ctx.sources?.length ? (
        <div className="lc-cx-chips" onMouseLeave={() => setHl(null)}>
          {chips.map((s, i) => (
            <Tooltip key={`${s.group}:${s.name}`} content={tip(s)}>
              <button type="button" className="lc-cx-chip l-focus" onMouseEnter={() => setHl(i)} onFocus={() => setHl(i)} onBlur={() => setHl(null)}>
                <i data-g={s.group} aria-hidden />
                <span className="lc-cx-name">{s.name}</span>
                <span className="lc-quiet l-num">{compact(s.tokens)}</span>
              </button>
            </Tooltip>
          ))}
          {sources.length > FIRST_CHIPS && (
            <button type="button" className="lc-cx-chip lc-cx-more l-focus" aria-expanded={all} onClick={() => setAll((a) => !a)}>
              {all ? "Fewer" : `${sources.length - FIRST_CHIPS} more`}
            </button>
          )}
        </div>
      ) : (
        <p className="lc-sinfo-note">As of the last turn. {info.provider === "claude" ? "Claude Code shows what fills it once its session is open here again." : `${info.tool} gives the total, not the parts.`}</p>
      )}
      <div className="lc-cx-foot">
        <span className="lc-quiet">
          {ctx.autoCompact === false ? "Auto-compact is off: Compact makes room" : ctx.compactAt ? `Compacts older turns at ${compact(ctx.compactAt)}` : `${share}% used`}
          {ctx.deferred ? ` · ${compact(ctx.deferred)} of tools wait until used` : ""}
        </span>
        {compactBtn}
      </div>
    </section>
  );
}

const LETTER: Record<FileChange["status"], string> = { added: "A", modified: "M", deleted: "D", renamed: "R" };

/** The files still to commit, each once as it stands now: its latest status, its lines from every turn. */
function openFiles(items: Item[]) {
  const open = checkpointsOf(items).filter((c) => !c.reverted && !c.committed);
  const by = new Map<string, FileChange>();
  for (const f of open.flatMap((c) => c.files)) {
    const had = by.get(f.path);
    by.set(f.path, { ...f, added: (had?.added ?? 0) + f.added, removed: (had?.removed ?? 0) + f.removed });
  }
  return { open, files: [...by.values()] };
}

function Line({ icon, title, children }: { icon: ReactNode; title?: string; children: ReactNode }) {
  return (
    <div className="lc-sinfo-line" title={title}>
      <span className="lc-sinfo-ic">{icon}</span>
      <span className="lc-sinfo-v">{children}</span>
    </div>
  );
}
