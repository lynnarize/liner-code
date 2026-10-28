/*
  The Session surface: where this session runs (the Mac, the folder, the branch, the tool and its
  model), what fills its context as the tool counts it, with Compact, and the changes still to
  commit, each opening in the diff. It asks the engine when it shows, again when a turn starts or
  ends, and on Refresh.
*/
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ContextPart, FileChange, Item, SessionInfo, Thread } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { rpc, useEngine } from "./engine";
import { I } from "./icons";
import { accessOf, checkpointsOf, compact, markOf, modelLabel, plural, sumLines } from "./model";
import { exportSession } from "./Sidebar";
import { Lines, ModelTag, PanelHead } from "./ui";

/** The used parts' colors, in the order the tool lists them; the reserve and free space stay grey. */
const INKS = ["var(--l-accent)", "var(--l-warn)", "var(--l-ok)", "color-mix(in oklab, var(--l-accent) 55%, var(--l-danger))", "var(--l-ink-3)", "var(--l-ink-4)"];
const inkOf = (p: ContextPart, i: number) => (p.kind === "used" ? INKS[Math.min(i, INKS.length - 1)] : p.kind === "buffer" ? "var(--l-line-2)" : "var(--l-wash-2)");

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
  const ctx = info.context;
  const used = ctx ? ctx.parts.filter((p) => p.kind === "used") : [];
  const shown = ctx ? ctx.parts.filter((p) => p.kind !== "deferred") : [];
  const deferred = ctx ? ctx.parts.filter((p) => p.kind === "deferred") : [];
  const share = (n: number) => (ctx && ctx.max ? `${((n / ctx.max) * 100).toFixed(1)}%` : "");

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

      <section className="lc-sinfo-card">
        <PanelHead
          end={
            info.compact && (
              <button type="button" className="lc-btn" data-kind="plain" data-size="sm" disabled={running || !ctx} title={running ? "Wait for the turn to finish" : "Sum up the conversation so far, to make room"} onClick={compactNow}>
                Compact
              </button>
            )
          }
        >
          Context
        </PanelHead>
        {ctx ? (
          <>
            <div className="lc-sinfo-total">
              <b>{Math.round((ctx.used / ctx.max) * 100)}% used</b>
              <span className="lc-quiet">
                {compact(ctx.used)} / {compact(ctx.max)}
              </span>
            </div>
            <div className="lc-sinfo-bar" role="img" aria-label={`${Math.round((ctx.used / ctx.max) * 100)}% of the context used`}>
              {(used.length ? used : [{ name: "Used", tokens: ctx.used, kind: "used" as const }]).map((p, i) => (
                <i key={p.name} style={{ width: `${(p.tokens / ctx.max) * 100}%`, background: inkOf(p, i) }} />
              ))}
              {shown
                .filter((p) => p.kind === "buffer")
                .map((p) => (
                  <i key={p.name} style={{ width: `${(p.tokens / ctx.max) * 100}%`, background: inkOf(p, 0) }} />
                ))}
            </div>
            {ctx.measured ? (
              <div className="lc-sinfo-parts">
                {shown.map((p) => (
                  <div key={p.name} className="lc-sinfo-part" data-kind={p.kind}>
                    <i style={{ background: inkOf(p, used.indexOf(p)) }} />
                    <span>{p.name}</span>
                    <span className="lc-mono">{compact(p.tokens)}</span>
                    <span className="lc-mono lc-quiet">{share(p.tokens)}</span>
                  </div>
                ))}
                {deferred.map((p) => (
                  <div key={p.name} className="lc-sinfo-part" data-kind="deferred" title="Tool descriptions the model loads only when it needs them: outside the window until then">
                    <i style={{ background: inkOf(p, 0) }} />
                    <span>{p.name}</span>
                    <span className="lc-mono">{compact(p.tokens)}</span>
                    <span className="lc-mono lc-quiet">–</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="lc-sinfo-note">As of the last turn. {info.provider === "claude" ? "Claude Code shows what fills it once its session is open here again." : `${info.tool} gives the total, not the parts.`}</p>
            )}
          </>
        ) : (
          <p className="lc-sinfo-note">Empty so far: the first turn fills it.</p>
        )}
      </section>

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
