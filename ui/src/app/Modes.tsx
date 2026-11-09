/*
  Modes: how the agent works in a session, picked when it starts and fixed for its life (DeepSeek
  Harness's agent presets). Standard is everyday work. Workshop (DeepSeek's Creator mode) changes Liner Code itself through
  conversation: the agent makes connections, panels and apps, each asked for on a card. A custom mode
  is one of your named agents, laid over whichever model the session runs: named agents are only ever
  a way to give a model instructions.

  Here: the picker under Home's composer, the chip beside a session's title, Settings › Modes,
  and the one way into a Workshop session from anywhere.
*/
import { useState, type ReactNode } from "react";
import type { AgentProfile, SessionMode, Thread } from "@contracts";
import { BUILTIN_MODES, modeName } from "@contracts";
import { Dialog } from "@liner/components/dialog/dialog";
import { Tooltip } from "@liner/components/tooltip/tooltip";
import { toast } from "@liner/components/toast/toast";
import { openSession } from "./Addon";
import { getState, rpc, useEngine } from "./engine";
import { Glyph, I } from "./icons";
import { startOf } from "./model";
import { Pop, Row, Sep } from "./ui";
import "./modes.css";

const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));
const ICON: Record<"standard" | "creator", (p: { size?: number }) => ReactNode> = { standard: I.code, creator: I.blocks };
const iconOf = (mode?: SessionMode) => (mode === "creator" ? ICON.creator : mode?.startsWith("agent:") ? I.agents : ICON.standard);
/** A mode's icon: Standard's code brackets, Workshop's blocks, and one of yours drawn with its agent's own glyph. */
function ModeIcon({ mode, agents, size }: { mode: SessionMode; agents: AgentProfile[]; size: number }) {
  if (mode.startsWith("agent:")) {
    const a = agents.find((x) => `agent:${x.id}` === mode);
    return a ? <Glyph glyph={a.glyph} size={size} /> : <I.agents size={size} />;
  }
  const Icon = iconOf(mode);
  return <Icon size={size} />;
}
/** Your named agents that can be a mode: every one but the Demo's. */
const customs = (agents: AgentProfile[]) => agents.filter((a) => a.id !== "demo");

/**
  A Workshop session, from anywhere (the Add-ons page, Settings › Modes): in the project you were in,
  else your first one, else Scratch. With `text`, it's sent as the first message.
*/
export async function startCreator(o: { projectId?: string; text?: string; title?: string }) {
  try {
    const { projects, settings, providers } = getState();
    const projectId = o.projectId ?? projects.find((p) => p.agent !== "demo")?.id ?? (await rpc("project.scratch", {})).id;
    const start = startOf(settings.mode, settings, providers);
    const t = await rpc("thread.create", { projectId, mode: "creator", ...(start ? { agent: start.agent, lead: start.lead, route: start.route, dual: start.dual } : {}), ...(o.title ? { title: o.title } : {}) });
    if (o.text) await rpc("thread.send", { id: t.id, text: o.text });
    openSession(t.id);
    return t;
  } catch (e) {
    fail(e);
  }
}

/**
  The mode a new session starts in, at the right end of the strip under Home's composer:
  Standard, Workshop, or one of yours, and the way to Settings › Modes. Workshop tints it.
*/
export function ModePick({ value, onPick }: { value: SessionMode; onPick: (m: SessionMode) => void }) {
  const agents = useEngine((s) => s.agents);
  const name = modeName(value, agents);
  // The name alone, as the menu says it: "Standard", "Workshop", or yours.
  const label = name;
  return (
    <Pop
      label={`Mode: ${name}. Change it`}
      width={300}
      menu
      triggerClass={`lc-pb lc-mode-pick${value === "creator" ? " lc-mode-creator" : ""}`}
      trigger={
        <>
          <ModeIcon mode={value} agents={agents} size={13} />
          <span className="lc-strip-cap">{label}</span>
          <I.chevD size={11} />
        </>
      }
    >
      {(close) => (
        <div className="lc-mode-menu">
          {BUILTIN_MODES.map((m) => (
            <Row key={m.id} keepIcon icon={<ModeIcon mode={m.id} agents={agents} size={15} />} title={m.name} note={m.id === "creator" ? "Add connections, panels and apps to Liner Code" : "Everyday work on your code"} on={value === m.id} onPick={() => (onPick(m.id), close())} />
          ))}
          {customs(agents).map((a) => (
            <Row key={a.id} keepIcon icon={<ModeIcon mode={`agent:${a.id}`} agents={agents} size={15} />} title={a.name} note={a.role} on={value === `agent:${a.id}`} onPick={() => (onPick(`agent:${a.id}`), close())} />
          ))}
          <Sep />
          <button type="button" role="menuitem" className="lc-mode-more l-focus" onClick={() => (close(), window.dispatchEvent(new CustomEvent("lc:open-settings", { detail: "modes" })))}>
            <I.sliders size={15} />
            Modes in Settings…
          </button>
        </div>
      )}
    </Pop>
  );
}

/** A session's mode, beside its title, when it isn't Standard. */
export function ModeChip({ thread }: { thread: Thread }) {
  const agents = useEngine((s) => s.agents);
  if (!thread.mode || thread.mode === "standard") return null;
  return (
    <span className="lc-mode-chip" title={thread.mode === "creator" ? "Workshop: this session adds to Liner Code, each add-on on a card" : "A mode of yours: its instructions, on this session's model"}>
      <ModeIcon mode={thread.mode} agents={agents} size={13} />
      {modeName(thread.mode, agents)}
    </span>
  );
}

type Guide = { intro: string; details: { h: string; p: string }[]; examples: { h: string; ask: string; expect: string }[] };

/** A mode's guide, as DeepSeek Harness opens it from its card: Mode details, or How to use with tasks to copy. */
function GuideDialog({ name, guide, tab, onTab, onClose }: { name: string; guide: Guide; tab: "details" | "how"; onTab: (t: "details" | "how") => void; onClose: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={name} description={guide.intro} size="lg" className="lc-mode-guide">
      <div className="lc-mode-tabs" role="tablist" aria-label="Guide sections">
        <button type="button" role="tab" aria-selected={tab === "details"} className="l-focus" onClick={() => onTab("details")}>
          Mode details
        </button>
        <button type="button" role="tab" aria-selected={tab === "how"} className="l-focus" onClick={() => onTab("how")}>
          How to use
        </button>
      </div>
      <div className="lc-mode-guide-body" role="tabpanel">
        {tab === "details"
          ? guide.details.map((d) => (
              <section key={d.h}>
                <h3>{d.h}</h3>
                <p>{d.p}</p>
              </section>
            ))
          : guide.examples.map((x) => (
              <section key={x.h}>
                <h3>
                  {x.h}
                  {/* The example's chip copies it: "Example task", Copy while you point at it, then Copied. */}
                  <button
                    type="button"
                    className="lc-mode-example l-focus"
                    aria-label={`Copy the example task: ${x.h}`}
                    data-copied={copied === x.h || undefined}
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(x.ask)
                        .then(() => setCopied(x.h))
                        .catch(() => toast.error("Couldn't copy it"))
                    }
                  >
                    <I.notes size={12} />
                    <span data-say="idle">Example task</span>
                    <span data-say="copy">{copied === x.h ? "Copied" : "Copy"}</span>
                  </button>
                </h3>
                <blockquote>{x.ask}</blockquote>
                <p className="lc-mode-expect">Expected output: {x.expect.charAt(0).toLowerCase() + x.expect.slice(1)}</p>
              </section>
            ))}
      </div>
    </Dialog>
  );
}

/**
  One mode's card: its name, badge and id, what it's for; Mode details and How to use open its guide;
  the document icon at its foot sets it as the new task default (its tooltip says so). The default
  card is filled grey, with the badge in ink.
*/
function ModeCard({ id, name, badge, blurb, guide, isDefault, onDefault, end }: { id: string; name: string; badge: string; blurb: string; guide: Guide; isDefault: boolean; onDefault: () => void; end?: ReactNode }) {
  const [open, setOpen] = useState<"details" | "how" | null>(null);
  return (
    <article className="lc-mode-card" data-default={isDefault || undefined} aria-label={name}>
      <header>
        <b>{name}</b>
        <span className="lc-mode-badge" data-on={isDefault || undefined}>
          {isDefault ? "New task default" : badge}
        </span>
        <code>{id}</code>
      </header>
      <p>{blurb}</p>
      <footer>
        <button type="button" className="lc-mode-link l-focus" onClick={() => setOpen("details")}>
          Mode details
        </button>
        <button type="button" className="lc-mode-link l-focus" onClick={() => setOpen("how")}>
          How to use
        </button>
        {end}
        <span className="lc-grow" />
        <Tooltip content={isDefault ? "The new task default" : "Set as new task default"}>
          <button type="button" className="lc-ib l-focus lc-mode-set" aria-label={isDefault ? `${name} is the new task default` : `Set ${name} as new task default`} aria-pressed={isDefault} onClick={() => !isDefault && onDefault()}>
            <I.notes size={14} />
          </button>
        </Tooltip>
      </footer>
      {open && <GuideDialog name={name} guide={guide} tab={open} onTab={setOpen} onClose={() => setOpen(null)} />}
    </article>
  );
}

/** Settings › Modes: the built-in ones, yours, and a way to make one with the agent. */
export function ModesPlace({ onAgent, onClose }: { onAgent: (agent?: AgentProfile) => void; onClose: () => void }) {
  const agents = useEngine((s) => s.agents);
  const current = useEngine((s) => s.settings.defaultMode ?? "standard");
  const setDefault = (m: SessionMode) => void rpc("settings.save", { defaultMode: m }).then(() => toast(`${modeName(m, agents)} is the new task default`)).catch(fail);
  const mine = customs(agents);
  return (
    <div className="lc-modes">
      <span className="lc-modes-k">Built-in</span>
      <div className="lc-modes-grid">
        {BUILTIN_MODES.map((m) => (
          <ModeCard key={m.id} id={m.id} name={m.name} badge="Built-in" blurb={m.blurb} guide={m} isDefault={current === m.id} onDefault={() => setDefault(m.id)} />
        ))}
      </div>
      <span className="lc-modes-k">Custom</span>
      {mine.length > 0 && (
        <div className="lc-modes-grid">
          {mine.map((a) => (
            <ModeCard
              key={a.id}
              id={`agent:${a.id}`}
              name={a.name}
              badge="Custom"
              blurb={a.role || a.soul.split("\n")[0] || "Instructions of your own."}
              guide={{
                intro: `Pick ${a.name} beside the project when you start a session. The model is still yours to choose.`,
                details: [
                  { h: "What it gives the model", p: `Its instructions${a.skills?.length ? `, ${a.skills.length} skill${a.skills.length === 1 ? "" : "s"}` : ""}${a.contextFiles?.length ? ` and ${a.contextFiles.length} context file${a.contextFiles.length === 1 ? "" : "s"}` : ""}, on top of whichever model the session runs. It's one of your agents in Settings › Team, where you change them.` },
                  { h: "Its instructions", p: a.soul.length > 900 ? `${a.soul.slice(0, 900)}…` : a.soul || "None yet." },
                ],
                examples: [{ h: "Start one", ask: `In ${a.name} mode: `, expect: "A session that works the way its instructions say. Safety still decides what it may do." }],
              }}
              isDefault={current === `agent:${a.id}`}
              onDefault={() => setDefault(`agent:${a.id}`)}
              end={
                <button type="button" className="lc-mode-link l-focus" onClick={() => onAgent(a)}>
                  Edit
                </button>
              }
            />
          ))}
        </div>
      )}
      <button
        type="button"
        className="lc-modes-make l-focus"
        onClick={() => {
          onClose();
          void startCreator({ title: "Make a mode", text: "Help me make a mode of my own for Liner Code. Ask me what it's for and how the model should work in it, then add it with mode_add." });
        }}
      >
        <I.plus size={14} />
        Let the agent help me make one
      </button>
    </div>
  );
}
