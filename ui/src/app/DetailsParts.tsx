/*
  The session details card's Context and Setup (Env.tsx DetailsCard; the owner approved the drawing, 2026-11-27: "session as
  1 in pop up rather than 2"). They held the Session surface's two lower sections, which went from the panel with it, so the
  card is the one place for everything about a session.

  Context: the ring, "N% used" and, at the right, Compact (its own button, so a press there never folds the row) and the
  chevron; under it the bar of dots, one colour per source, with the mark where the tool compacts by itself. Pressed, the row
  unfolds in place: "X of Y", a row per source with its round dot and its count, what is free, and the grey note.
  Setup: one row, the tool preset in grey, opening a menu to the card's left with the six settings the surface had, each
  opening what it opened there. Neither says what anything costs: Usage and cost is where that is.
*/
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { ContextPart, ContextSource, SessionInfo, Thread } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { rpc, useEngine } from "./engine";
import { I } from "./icons";
import { compact } from "./model";
import { MOTION } from "./motion";
import { setContextOpen, useContextOpen } from "./pinned";
import { addFive } from "./session-pop";
import { MenuFoot, NamedSwitch, PanelHead, Pop, Row, Sep, SubMenu, usePresence } from "./ui";
import * as os from "./os";

const fail = (e: Error) => toast.error(e.message);

/**
  Compact, as the Session surface pressed it. A second press before the turn's status lands would queue another /compact,
  summarising what was just summarised: the press disables the button at once, and keeps it so until the turn is seen running
  (thread.send answers before that), when the turn's own state takes over; a send that fails lets it go, and so do five
  seconds without a turn.
*/
export function useCompact(thread: Thread) {
  const running = thread.status === "running";
  const [compacting, setCompacting] = useState(false);
  const compactNow = () => {
    if (compacting) return;
    setCompacting(true);
    rpc("thread.send", { id: thread.id, text: "/compact" }).then(
      () => toast("Compacting the conversation", { description: "The tool sums up what came before, so the context has room again." }),
      (e: Error) => (setCompacting(false), toast.error(e.message)),
    );
  };
  useEffect(() => {
    if (!compacting) return;
    if (running) return void setCompacting(false);
    const t = setTimeout(() => setCompacting(false), 5000);
    return () => clearTimeout(t);
  }, [compacting, running]);
  return { compacting, compactNow };
}

/** What each kind of source is, for its row's tooltip. */
const GROUP_WORD: Record<ContextSource["group"], string> = { setup: "The tool's own", project: "Your project", talk: "The conversation", files: "Files", runs: "Commands", web: "The web", tools: "Other tools" };

/** Each kind of source's colour in the bar of dots and on its round dot (one colour per source, board Panel). */
const GROUP_COLOUR: Record<ContextSource["group"], string> = { setup: "var(--l-ink-3)", project: "var(--l-warn)", talk: "var(--lc-blue)", files: "var(--lc-merged)", runs: "var(--l-ok)", web: "var(--lc-progress)", tools: "var(--l-ink-2)" };

/** The parts a tool lists, as sources, when it doesn't say more: used parts in the conversation's colour, past the first. */
const asSources = (parts: ContextPart[]): ContextSource[] => parts.filter((p) => p.kind === "used").map((p, i) => ({ name: p.name, tokens: p.tokens, group: i === 0 ? "setup" : "talk" }));

/**
  The card's Context: its row, its bar of dots and, unfolded, its sources. `info` is the card's own thread.info (null until
  it answers, or when it couldn't). Folded or not is one choice while the app is open (pinned.ts).
*/
export function CardContext({ thread, info }: { thread: Thread; info: SessionInfo | null }) {
  const { open, shown } = useContextOpen();
  const { compacting, compactNow } = useCompact(thread);
  const [hl, setHl] = useState<number | null>(null);
  const life = usePresence(open, MOTION.fold);
  const box = useRef<HTMLDivElement>(null);
  // Asked for from the message box's ring: the row comes into view in the card's own scroll.
  useEffect(() => {
    if (shown) box.current?.scrollIntoView({ block: "nearest" });
  }, [shown]);
  const running = thread.status === "running";
  const ctx = info?.context;
  const share = ctx ? Math.min(100, Math.round((ctx.used / ctx.max) * 100)) : null;
  const compactNote = running ? "Once the turn ends" : ctx?.autoCompact === false ? "Auto-compact is off" : ctx?.compactAt && ctx.compactAt > ctx.used ? `${compact(ctx.compactAt - ctx.used)} until the tool compacts` : undefined;
  const sources = !ctx ? [] : ctx.sources?.length ? ctx.sources : ctx.measured ? asSources(ctx.parts) : [{ name: "Used", tokens: ctx.used, group: "talk" as const }];
  const pct = (n: number) => (ctx ? `${Math.min(100, (n / ctx.max) * 100)}%` : "0%");
  const known = Boolean(ctx && (ctx.measured || ctx.sources?.length));
  const free = ctx ? Math.max(0, ctx.max - ctx.used) : 0;
  const by = ctx?.compactAt && ctx.autoCompact !== false && ctx.compactAt < ctx.max ? ctx.compactAt : undefined;
  const fold = () => setContextOpen(!open);
  // The grey note under the sources: how fresh the numbers are when the tool gives only a total, when it compacts by itself.
  const note = !ctx
    ? "The first turn fills it."
    : [
        !known ? `As of the last turn. ${info?.provider === "claude" ? "Claude Code shows what fills it once its session is open here again." : `${info?.tool ?? "The tool"} gives the total, not the parts.`}` : "",
        by ? `It compacts by itself at ${Math.round((by / ctx.max) * 100)}%.` : ctx.autoCompact === false ? "Auto-compact is off." : "",
        ctx.deferred ? `${compact(ctx.deferred)} of tools wait until used.` : "",
      ]
        .filter(Boolean)
        .join(" ");
  return (
    <div ref={box} className="lc-dc-ctxw" data-open={open || undefined}>
      <div className="lc-dr lc-dc-ctx">
        <button type="button" className="lc-dr-main l-focus" aria-expanded={open} title={ctx ? `${compact(ctx.used)} of ${compact(ctx.max)}` : undefined} onClick={fold}>
          <i className="lc-dr-ring" style={{ "--v": `${share ?? 0}%` } as CSSProperties} aria-hidden />
          <span className="lc-dr-t">Context</span>
          <em>{!ctx ? "Empty" : open ? `${compact(ctx.used)} of ${compact(ctx.max)}` : `${share}% used`}</em>
        </button>
        {/* Only where the surface offered it: a tool that compacts on request. Its own button, beside the row's. */}
        {info?.compact && (
          <button type="button" className="lc-dc-compact l-focus" title={compactNote} disabled={running || !ctx || compacting} onClick={compactNow}>
            Compact
          </button>
        )}
        <button type="button" className="lc-dr-end lc-dc-chev" tabIndex={-1} aria-hidden onClick={fold}>
          <I.chevR size={14} />
        </button>
      </div>
      {ctx && (
        <div className="lc-dc-bar" role="img" aria-label={`${share}% of the context used${by ? `; it compacts at ${compact(by)}` : ""}`}>
          <div className="lc-dotbar" data-hl={hl !== null || undefined}>
            {sources.map((s, i) => (
              <span key={`${i}:${s.group}:${s.name}`} data-on={hl === i || undefined} style={{ width: pct(s.tokens), "--lc-dotbar-c": GROUP_COLOUR[s.group] } as CSSProperties} />
            ))}
          </div>
          {by && <span className="lc-dc-mark" style={{ left: pct(by) }} aria-hidden />}
        </div>
      )}
      <div className="lc-fold">
        <div>
          {life.mounted && (
            <>
              {ctx && (
                // Each source with its round dot and its count; pointing at one lights its part of the bar.
                <div className="lc-dc-src" onMouseLeave={() => setHl(null)}>
                  {sources.map((s, i) => (
                    <div key={`${i}:${s.group}:${s.name}`} className="lc-dc-k" title={`${s.detail ?? GROUP_WORD[s.group]} · ${s.tokens / ctx.max < 0.001 ? "under 0.1%" : `${((s.tokens / ctx.max) * 100).toFixed(1)}%`}`} onMouseEnter={() => setHl(i)}>
                      <i style={{ background: GROUP_COLOUR[s.group] }} aria-hidden />
                      <span className="lc-dc-kt">{s.name}</span>
                      <span className="lc-dc-kn l-num">{compact(s.tokens)}</span>
                    </div>
                  ))}
                  <div className="lc-dc-k" data-free>
                    <i aria-hidden />
                    <span className="lc-dc-kt">Free</span>
                    <span className="lc-dc-kn l-num">{compact(free)}</span>
                  </div>
                </div>
              )}
              {note && <p className="lc-dc-note">{note}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
  The card's Setup: one row with the tool preset in grey, opening the menu of the six the Session surface had, to the card's
  left (the card stands at the chat's right edge). Each row opens what its row there opened, from the same parts below.
*/
export function CardSetup({ thread }: { thread: Thread }) {
  const keepAwake = useEngine((s) => s.settings.keepAwake !== false);
  // The tool's effort as it runs, when that isn't what was asked (a usage limit moved it): the surface said so under Context.
  const moved = thread.effortNow && thread.effort && thread.effortNow !== thread.effort;
  return (
    <div className="lc-dr">
      <Pop
        label="Setup"
        menu
        side="left"
        width={260}
        className="lc-dc-setup"
        triggerClass="lc-dr-main l-focus"
        trigger={
          <>
            <I.sliders size={14} />
            <span className="lc-dr-t">Setup</span>
            <em>{thread.toolPreset === "lean" ? "Lean" : "Standard"} preset</em>
            <span className="lc-dr-v">
              <I.chevR size={14} />
            </span>
          </>
        }
      >
        {() => (
          <>
            <PanelHead>Setup</PanelHead>
            <Setup thread={thread} />
            {/* The switch is the row's one control, as on the surface: it saves at once, for every session. */}
            <div className="lc-row lc-dc-sw">
              <span className="lc-row-tick">
                <I.laptop size={14} />
              </span>
              <span className="lc-row-t">
                <b>Keep {os.here} awake</b>
              </span>
              <span className="lc-row-end">
                <NamedSwitch name={`Keep ${os.here} awake`} size="sm" checked={keepAwake} onCheckedChange={(on) => void rpc("settings.save", { keepAwake: on }).catch(fail)} />
              </span>
            </div>
            {moved && (
              <>
                <Sep />
                <MenuFoot>
                  Running at effort {thread.effortNow}, asked {thread.effort}
                </MenuFoot>
              </>
            )}
          </>
        )}
      </Pop>
    </div>
  );
}

/** The setup rows: each a value and a menu to its side, as the Session surface's Setup section had them. */
function Setup({ thread }: { thread: Thread }) {
  const update = (patch: Omit<Parameters<typeof rpc<"thread.update">>[1], "id">) => void rpc("thread.update", { id: thread.id, ...patch }).catch(fail);
  const usage = thread.usage;
  return (
    <>
      <SubMenu title="Tool preset" icon={<I.sliders size={14} />} value={thread.toolPreset === "lean" ? "Lean" : "Standard"} label="Tool preset" width={270}>
        {(done) => (
          <>
            <Row title="Standard" on={thread.toolPreset !== "lean"} onPick={() => (done(), update({ toolPreset: "standard" }))} />
            <Row title="Lean" note="Leaves heavy add-ons out, for faster turns that use fewer tokens" on={thread.toolPreset === "lean"} onPick={() => (done(), update({ toolPreset: "lean" }))} />
          </>
        )}
      </SubMenu>
      {thread.sidekick && (
        <SubMenu title="Sidekick context" icon={<I.agents size={14} />} value={thread.sidekickContext === "fork" ? "Fork" : "Isolated"} label="Sidekick context" width={270}>
          {(done) => (
            <>
              <Row title="Isolated" note="The sidekick starts fresh on each brief" on={thread.sidekickContext !== "fork"} onPick={() => (done(), update({ sidekickContext: "isolated" }))} />
              <Row title="Fork" note="The sidekick inherits a summary of this conversation" on={thread.sidekickContext === "fork"} onPick={() => (done(), update({ sidekickContext: "fork" }))} />
            </>
          )}
        </SubMenu>
      )}
      <Connections thread={thread} />
      {/* No money in the card: the row says whether a limit is set; the amounts are in its menu. */}
      <SubMenu title="Spend limit" icon={<I.shield size={14} />} value={thread.spendLimit ? "Set" : "None"} label="Spend limit" width={240}>
        {(done) => (
          <>
            <Row title="Add $5" icon={<I.plus size={14} />} onPick={() => (done(), update({ spendLimit: addFive(thread.spendLimit, usage?.costUsd ?? 0) }))} />
            <Row title="Clear the limit" icon={<I.close size={14} />} disabled={!thread.spendLimit} onPick={() => (done(), update({ spendLimit: null }))} />
            <Sep />
            <MenuFoot>{thread.spendLimit ? "Its turns stop once it is reached. Usage and cost says what it has spent." : "No limit set"}</MenuFoot>
          </>
        )}
      </SubMenu>
      <SubMenu title="Workspace memory" icon={<I.file size={14} />} value="Save notes" label="Workspace memory" width={260}>
        {(done) => (
          <>
            <Row
              title="Distill to MEMORY.md"
              note="This session's goal, changed files and outcome"
              disabled={thread.status === "running" || thread.turns === 0}
              onPick={() => {
                done();
                void rpc("memory.distill", { threadId: thread.id })
                  .then((r) => toast(r.added ? `Saved ${r.added} notes to MEMORY.md` : "MEMORY.md already has these notes"))
                  .catch(fail);
              }}
            />
            <Sep />
            <MenuFoot>{thread.status === "running" ? "Once the turn ends" : thread.turns === 0 ? "After the first turn" : "Agents read it in later sessions"}</MenuFoot>
          </>
        )}
      </SubMenu>
    </>
  );
}

/**
  The connections this session's tool may get, each ticked on or off for this session alone, in a menu to the side. The
  same choice the engine makes (Addons.connections): on in Add-ons, not removed, for this project or every one; a
  connection, or a ported plugin's program that gives tools. A change reaches a turn under way where its tool takes
  connections in place, else from its next turn, as a change in Add-ons does.
*/
function Connections({ thread }: { thread: Thread }) {
  const addons = useEngine((s) => s.addons);
  const off = useEngine((s) => s.addonsOff);
  const all = off ? [] : addons.filter((a) => a.enabled && !a.removed && (!a.project || a.project === thread.projectId) && (a.kind === "connection" ? !a.dsh || Boolean(a.dsh.tools?.length) : Boolean(a.panel?.dsh?.host && a.panel.dsh.tools?.length)));
  if (!all.length) return null;
  const offHere = thread.connectionsOff ?? [];
  const on = all.filter((a) => !offHere.includes(a.id)).length;
  const flip = (id: string) => {
    const next = offHere.includes(id) ? offHere.filter((x) => x !== id) : [...offHere, id];
    rpc("thread.update", { id: thread.id, connectionsOff: next.length ? next : null }).catch(fail);
  };
  return (
    <SubMenu title="Connections" icon={<I.globe size={14} />} value={`${on} of ${all.length} on`} label="Connections" width={250}>
      {() => (
        <>
          {/* The switches are this session's alone: the list says so where it starts, as the board's labels do. */}
          <PanelHead>In this session</PanelHead>
          {all.map((a) => (
            <Row key={a.id} title={a.name} on={!offHere.includes(a.id)} onPick={() => flip(a.id)} />
          ))}
        </>
      )}
    </SubMenu>
  );
}
