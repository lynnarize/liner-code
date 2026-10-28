/*
  New agent (or editing one). Pick what it's good at and its name, model, effort, what it may
  change and its soul.md fill in; change any of them. The preview on the right is how it shows
  in the team, the composer's picker and the session.
*/
import { useEffect, useMemo, useRef, useState } from "react";
import type { Access, AgentGlyph, AgentProfile, Effort, RunMode, Specialty } from "@contracts";
import { Segmented } from "@liner/components/segmented/segmented";
import { toast } from "@liner/components/toast/toast";
import { rpc, useEngine } from "./engine";
import { Glyph, I } from "./icons";
import { allModels, effortName, markOf, modelLabel, onClaude } from "./model";
import { EffortPick, ModelPicker } from "./Models";
import { Badge, ModelTag } from "./ui";

type Preset = { id: Specialty; label: string; note: string; glyph: AgentGlyph; name: string; role: string; effort: Effort; access: Access; prefer: string[]; soul: (n: string) => string };

const PRESETS: Preset[] = [
  { id: "designer", label: "Designer", note: "Screens and flows", glyph: "shapes", name: "Prism", role: "Design", effort: "medium", access: "ask", prefer: ["opus", "sonnet"], soul: (n) => `# ${n}\n\nYou are ${n}, the team's designer. You make screens that are calm and easy to use.\n\n## How you work\n- Read the components that already exist before you add one.\n- Keep to the project's tokens: one accent, quiet greys.\n- Say what you changed on screen, and how to see it.` },
  { id: "coder", label: "Coder", note: "Ships clean code", glyph: "code", name: "Forge", role: "Code", effort: "medium", access: "edits", prefer: ["sonnet"], soul: (n) => `# ${n}\n\nYou are ${n}, the team's coder. You build what was asked, in the project's own style.\n\n## How you work\n- Read the code around a change before you make it.\n- Run the tests that cover it.\n- End by saying what changed and what you didn't get to.` },
  { id: "debugger", label: "Debugger", note: "Finds the cause", glyph: "scope", name: "Tracer", role: "Debugger", effort: "high", access: "ask", prefer: ["opus"], soul: (n) => `# ${n}\n\nYou are ${n}, the team's debugger. You find the cause before you touch the fix.\n\n## How you work\n- Reproduce it first, then narrow it down.\n- Write the failing test before the fix.\n- Name the cause in one sentence.\n\n## Never\n- Paper over a symptom.` },
  { id: "researcher", label: "Researcher", note: "Reads and cites", glyph: "lens", name: "Atlas", role: "Research", effort: "medium", access: "read", prefer: ["opus", "hermes"], soul: (n) => `# ${n}\n\nYou are ${n}, the team's researcher. You read before you claim, and cite what you read.\n\n## How you work\n- Say plainly when you're not sure.\n- Keep answers short; link the files and lines.` },
  { id: "writer", label: "Writer", note: "Posts and docs", glyph: "pen", name: "Quill", role: "Writing", effort: "medium", access: "edits", prefer: ["sonnet"], soul: (n) => `# ${n}\n\nYou are ${n}, the team's writer. You write docs and release notes people read to the end.\n\n## How you work\n- Plain words, short sentences, the reader's task first.` },
  { id: "custom", label: "Custom", note: "A blank soul", glyph: "spark", name: "", role: "Agent", effort: "medium", access: "ask", prefer: [], soul: (n) => `# ${n || "New agent"}\n\n` },
];

const MAY: { id: Access; label: string }[] = [
  { id: "read", label: "Only reads" },
  { id: "ask", label: "Edits, asks first" },
  { id: "edits", label: "Edits freely" },
];

export function AgentDialog({ open, agent, onClose }: { open: boolean; agent?: AgentProfile; onClose: () => void }) {
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  const models = useMemo(() => allModels(providers), [providers]);
  const ref = useRef<HTMLDialogElement>(null);
  const [spec, setSpec] = useState<Specialty>("coder");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [effort, setEffort] = useState<Effort>("medium");
  const [model, setModel] = useState("");
  const [access, setAccess] = useState<Access>("ask");
  const [soul, setSoul] = useState("");
  const [touched, setTouched] = useState(false);
  const [runMode, setRunMode] = useState<RunMode>("helpers");
  const [subs, setSubs] = useState<{ explorer?: string; tests?: string; reviewer?: string | null }>({});

  // Opening fills the form: the agent being edited, or the Coder preset.
  useEffect(() => {
    if (!open) return;
    const p = PRESETS.find((x) => x.id === (agent?.specialty ?? "coder"))!;
    setSpec(agent?.specialty ?? "coder");
    setName(agent?.name ?? p.name);
    setRole(agent?.role ?? p.role);
    setEffort(agent?.effort ?? p.effort);
    setModel(agent?.model ?? pickModel(p));
    setAccess(agent?.access ?? p.access);
    setSoul(agent?.soul ?? p.soul(p.name));
    setRunMode(agent?.runMode ?? "helpers");
    setSubs(agent?.subagents ?? {});
    setTouched(Boolean(agent));
    ref.current?.showModal();
  }, [open, agent?.id]);
  useEffect(() => {
    if (!open) ref.current?.close();
  }, [open]);

  function pickModel(p: Preset) {
    for (const want of p.prefer) {
      const m = models.find((x) => x.ref.includes(want));
      if (m) return m.ref;
    }
    return models[0]?.ref ?? "demo:demo";
  }

  const choose = (id: Specialty) => {
    const p = PRESETS.find((x) => x.id === id)!;
    setSpec(id);
    if (!touched) {
      setName(p.name);
      setSoul(p.soul(p.name));
    }
    setRole(p.role);
    setEffort(p.effort);
    setAccess(p.access);
    setModel(pickModel(p));
  };

  const preset = PRESETS.find((x) => x.id === spec)!;
  const claude = onClaude(model);
  const small = models.filter((m) => m.ref.startsWith("claude:"));
  const haiku = small.find((m) => m.ref.includes("haiku"))?.ref;
  const subPick = (key: "explorer" | "tests" | "reviewer", label: string, note: string, list: typeof models, fallback?: string) => {
    const v = subs[key];
    const current = v === null ? "none" : (v ?? (key === "reviewer" ? (spec === "coder" ? "auto" : "none") : (fallback ?? "")));
    return (
      <label className="lc-subrow">
        <span>
          <b>{label}</b>
          <small className="lc-quiet">{note}</small>
        </span>
        <select
          className="lc-subsel"
          value={current}
          aria-label={`${label} runs on`}
          onChange={(e) => setSubs((s) => ({ ...s, [key]: e.target.value === "none" ? null : e.target.value }))}
        >
          {key === "reviewer" && <option value="none">Nobody</option>}
          {key === "reviewer" && <option value="auto">Another model family, picked for you</option>}
          {list.map((m) => (
            <option key={m.ref} value={m.ref}>
              {m.label} · {m.provider}
            </option>
          ))}
        </select>
      </label>
    );
  };
  const glyph = agent?.glyph && spec === agent.specialty ? agent.glyph : preset.glyph;
  const first = soul.split("\n").find((l) => l.trim() && !l.startsWith("#")) ?? "";

  const save = async () => {
    const n = name.trim();
    if (!n) return toast.error("Give it a name first.");
    const id = agent?.id ?? (n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `agent-${Date.now().toString(36)}`);
    if (!agent && agents.some((a) => a.id === id)) return toast.error(`There's already an agent called ${n}.`);
    const next: AgentProfile = { id, name: n, role: role.trim() || preset.role, glyph, specialty: spec, model, effort, access, soul, ...(claude ? { runMode, subagents: subs } : { subagents: { reviewer: subs.reviewer } }) };
    try {
      await rpc("agents.save", { agents: agent ? agents.map((a) => (a.id === agent.id ? next : a)) : [...agents, next] });
      toast.success(agent ? `${n} is updated` : `${n} joined the team`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const remove = async () => {
    if (!agent) return;
    await rpc("agents.save", { agents: agents.filter((a) => a.id !== agent.id) });
    toast(`${agent.name} left the team`);
    onClose();
  };

  return (
    <dialog ref={ref} className="lc-sheet" aria-labelledby="lc-agent-t" onCancel={(e) => (e.preventDefault(), onClose())} onClick={(e) => e.target === ref.current && onClose()}>
      <div className="lc-sheet-frame l-frame l-frame-float">
        <div className="lc-sheet-head">
          <span>
            <b id="lc-agent-t">{agent ? `Edit ${agent.name}` : "New agent"}</b>
            <small>Joins your team. Every project can use it.</small>
          </span>
          <button type="button" className="lc-ib l-focus" aria-label="Close" onClick={onClose}>
            <I.close size={14} />
          </button>
        </div>
        <div className="lc-sheet-body">
          <div className="lc-fcard lc-agent-form">
            <div className="lc-field-l">Good at</div>
            <div className="lc-specs" role="radiogroup" aria-label="Good at">
              {PRESETS.map((p) => (
                <button key={p.id} type="button" role="radio" aria-checked={spec === p.id} className="lc-spec l-focus" data-on={spec === p.id || undefined} onClick={() => choose(p.id)}>
                  <span className="lc-disc" style={{ width: 26, height: 26 }}>
                    <Glyph glyph={p.glyph} size={13} />
                  </span>
                  <span>
                    <b>{p.label}</b>
                    <small>{p.note}</small>
                  </span>
                </button>
              ))}
            </div>
            <div className="lc-two">
              <label>
                <span className="lc-field-l">Name</span>
                <input
                  className="lc-input"
                  value={name}
                  onChange={(e) => {
                    setTouched(true);
                    setName(e.target.value);
                  }}
                />
              </label>
              <span>
                <span className="lc-field-l">Effort</span>
                <EffortPick modelRef={model} value={effort} onChange={setEffort} triggerClass="lc-pb lc-ad-effort" />
              </span>
            </div>
            <div className="lc-field-l">Model</div>
            <div className="lc-ad-models">
              <ModelPicker value={model} height={290} onPick={(ref) => setModel(ref)} />
            </div>
            {claude && (
              <>
                <div className="lc-field-l">How it runs</div>
                <div className="lc-runmodes" role="radiogroup" aria-label="How it runs">
                  {(
                    [
                      { id: "helpers", t: `${modelLabel(model, providers)}, with cheap helpers`, n: "Explorers and the test runner do the reading, so its context stays on the work" },
                      { id: "escalate", t: "Sonnet, asks Opus when stuck", n: "Lowest cost on routine work; Opus plans the hard parts" },
                      { id: "single", t: `${modelLabel(model, providers)} alone`, n: "No subagents" },
                    ] as const
                  ).map((m) => (
                    <button key={m.id} type="button" role="radio" aria-checked={runMode === m.id} className="lc-spec l-focus" data-on={runMode === m.id || undefined} onClick={() => setRunMode(m.id)}>
                      <span>
                        <b>{m.t}</b>
                        <small>{m.n}</small>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
            <div className="lc-field-l">Subagents</div>
            <div className="lc-subs">
              {claude && runMode !== "single" && subPick("explorer", "Explorer", "Reads and searches the code", small, haiku)}
              {claude && runMode !== "single" && subPick("tests", "Test runner", "Runs the tests, reads failures", small, haiku)}
              {subPick("reviewer", "Reviewer", "Reads the diff before you do; another model family misses less", models)}
            </div>
            <div className="lc-field-l">May change things</div>
            <Segmented full size="sm" value={access} onValueChange={setAccess} options={MAY.map((m) => ({ value: m.id, label: m.label }))} aria-label="May change things" />
            <p className="lc-quiet lc-small">It still can't push or merge on its own: commands that leave this machine ask you, whatever this says.</p>
            <div className="lc-soul">
              <div className="lc-soul-h">
                <span className="lc-mono">soul.md</span>
                <span className="lc-quiet">{soul.split("\n").length} lines</span>
                <span className="lc-grow" />
                <span className="lc-quiet">Drop a .md file to use your own</span>
              </div>
              <textarea
                className="lc-soul-t lc-mono"
                value={soul}
                spellCheck={false}
                onChange={(e) => {
                  setTouched(true);
                  setSoul(e.target.value);
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files[0];
                  if (f) void f.text().then((t) => (setTouched(true), setSoul(t)));
                }}
              />
            </div>
          </div>
          <div className="lc-fcard lc-agent-preview">
            <small className="lc-quiet">Preview</small>
            <span className="lc-disc" style={{ width: 48, height: 48 }}>
              <Glyph glyph={glyph} size={22} />
            </span>
            <b className="lc-preview-name">{name || "Unnamed"}</b>
            <span className="lc-quiet">{role || preset.role}</span>
            <span className="lc-preview-tags">
              <Badge tone="neutral" dot={false}>
                <ModelTag kind={markOf(model)} label={modelLabel(model, providers)} />
              </Badge>
              <Badge tone="neutral" dot={false}>
                {effortName(effort, model, providers)}
              </Badge>
              <Badge tone="neutral" dot={false}>
                {MAY.find((m) => m.id === access)?.label}
              </Badge>
            </span>
            <p className="lc-preview-soul">{first}</p>
            <p className="lc-quiet lc-small">Shows up in the team, the composer's picker and the session's header.</p>
          </div>
        </div>
        <div className="lc-sheet-foot">
          {agent && (
            <button type="button" className="lc-btn" data-kind="ghost" onClick={() => void remove()}>
              <I.trash size={13} />
              Remove from the team
            </button>
          )}
          <span className="lc-grow" />
          <button type="button" className="lc-btn" data-kind="plain" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="lc-btn" data-kind="accent" onClick={() => void save()}>
            {agent ? "Save" : "Add to the team"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
