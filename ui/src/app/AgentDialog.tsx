/*
  New agent (or editing one), in two columns. The agent: what it's good at (its name, model,
  effort and what it may change fill in from that), how it runs and its subagents. What it knows:
  its soul.md, a prompt added to every turn, the skills it reads when a task calls for one, and
  files read at the start of each session. The foot says how it will show in the team.
*/
import { useEffect, useMemo, useRef, useState } from "react";
import type { Access, AgentGlyph, AgentProfile, Effort, RunMode, SkillInfo, Specialty } from "@contracts";
import { Segmented } from "@liner/components/segmented/segmented";
import { toast } from "@liner/components/toast/toast";
import { rpc, useEngine } from "./engine";
import { Glyph, I, ModelMark } from "./icons";
import { allModels, effortsFor, markOf, modelLabel, onClaude, plural } from "./model";
import { EffortPick, ModelPicker } from "./Models";
import { PanelHead, Pop, Row, Sep } from "./ui";

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
  const [prompt, setPrompt] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [contextFiles, setContextFiles] = useState<string[]>([]);

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
    setPrompt(agent?.prompt ?? "");
    setSkills(agent?.skills ?? []);
    setContextFiles(agent?.contextFiles ?? []);
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
          {key === "reviewer" && <option value="auto">Another family</option>}
          {list.map((m) => (
            <option key={m.ref} value={m.ref}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
    );
  };
  const glyph = agent?.glyph && spec === agent.specialty ? agent.glyph : preset.glyph;

  const save = async () => {
    const n = name.trim();
    if (!n) return toast.error("Give it a name first.");
    const id = agent?.id ?? (n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `agent-${Date.now().toString(36)}`);
    if (!agent && agents.some((a) => a.id === id)) return toast.error(`There's already an agent called ${n}.`);
    const knows = { prompt: prompt.trim() || undefined, skills: skills.length ? skills : undefined, contextFiles: contextFiles.length ? contextFiles : undefined };
    const next: AgentProfile = { id, name: n, role: role.trim() || preset.role, glyph, specialty: spec, model, effort, access, soul, ...knows, ...(claude ? { runMode, subagents: subs } : { subagents: { reviewer: subs.reviewer } }) };
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

  const efforts = effortsFor(model, providers).list;
  const RUNS = [
    { id: "helpers", t: "With cheap helpers", n: "Explorers and the test runner do the reading, so its context stays on the work" },
    { id: "escalate", t: "Sonnet, asks Opus when stuck", n: "Lowest cost on routine work; Opus plans the hard parts" },
    { id: "single", t: `${modelLabel(model, providers)} alone`, n: "No subagents" },
  ] as const;
  const summary = [modelLabel(model, providers), MAY.find((m) => m.id === access)?.label, skills.length ? plural(skills.length, "skill") : "", contextFiles.length ? plural(contextFiles.length, "file") : ""].filter(Boolean).join(" · ");

  return (
    <dialog ref={ref} className="lc-sheet lc-ad" aria-labelledby="lc-agent-t" onCancel={(e) => (e.preventDefault(), onClose())} onClick={(e) => e.target === ref.current && onClose()}>
      <div className="lc-sheet-frame lc-ad-frame">
        <div className="lc-sheet-head lc-ad-head">
          <span>
            <b id="lc-agent-t">{agent ? `Edit ${agent.name}` : "New agent"}</b>
            <small>Joins your team. Every project can use it.</small>
          </span>
          <button type="button" className="lc-ib l-focus" aria-label="Close" onClick={onClose}>
            <I.close size={14} />
          </button>
        </div>
        <div className="lc-ad-body">
          <div className="lc-ad-col">
            <span className="lc-ad-ch">The agent</span>
            <div className="lc-ad-f">
              <span className="lc-ad-l">Good at</span>
              <div className="lc-specs" role="radiogroup" aria-label="Good at">
                {PRESETS.map((p) => (
                  <button key={p.id} type="button" role="radio" aria-checked={spec === p.id} title={p.note} className="lc-spec l-focus" data-on={spec === p.id || undefined} onClick={() => choose(p.id)}>
                    <span className="lc-spec-g">
                      <Glyph glyph={p.glyph} size={13} />
                    </span>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="lc-two">
              <label className="lc-ad-f">
                <span className="lc-ad-l">Name</span>
                <input
                  className="lc-ad-in"
                  value={name}
                  onChange={(e) => {
                    setTouched(true);
                    setName(e.target.value);
                  }}
                />
              </label>
              <div className="lc-ad-f">
                <span className="lc-ad-l">Effort</span>
                {efforts.length > 0 && efforts.length <= 3 ? (
                  <Segmented full size="sm" value={efforts.some((e) => e.id === effort) ? effort : efforts[0].id} onValueChange={(v) => setEffort(v as Effort)} options={efforts.map((e) => ({ value: e.id, label: e.label }))} aria-label="Effort" />
                ) : (
                  <EffortPick modelRef={model} value={effort} onChange={(v) => setEffort(v as Effort)} triggerClass="lc-ad-dd" icon={false} />
                )}
              </div>
            </div>
            <div className="lc-two">
              <div className="lc-ad-f">
                <span className="lc-ad-l">Model</span>
                <Pop
                  label="Its model"
                  width={420}
                  triggerClass="lc-ad-dd"
                  trigger={
                    <>
                      <span className="lc-ad-mk">
                        <ModelMark kind={markOf(model)} size={12} />
                      </span>
                      <span className="lc-ad-dd-t">{modelLabel(model, providers)}</span>
                      <small>{providers.find((x) => model.startsWith(`${x.id}:`))?.label}</small>
                      <I.chevD size={11} />
                    </>
                  }
                >
                  {(close) => <ModelPicker value={model} height={300} onPick={(r) => (setModel(r), close())} />}
                </Pop>
              </div>
              <div className="lc-ad-f">
                <span className="lc-ad-l">How it runs</span>
                {claude ? (
                  <Pop
                    label="How it runs"
                    width={320}
                    align="end"
                    triggerClass="lc-ad-dd"
                    trigger={
                      <>
                        <span className="lc-ad-dd-t">{RUNS.find((m) => m.id === runMode)?.t}</span>
                        <I.chevD size={11} />
                      </>
                    }
                  >
                    {(close) => (
                      <>
                        <PanelHead>How it runs</PanelHead>
                        {RUNS.map((m) => (
                          <Row key={m.id} title={m.t} note={m.n} on={runMode === m.id} onPick={() => (setRunMode(m.id), close())} />
                        ))}
                      </>
                    )}
                  </Pop>
                ) : (
                  <span className="lc-ad-dd" data-off>
                    The model alone
                  </span>
                )}
              </div>
            </div>
            <div className="lc-ad-f">
              <span className="lc-ad-l">Subagents</span>
              <div className="lc-subs">
                {claude && runMode !== "single" && subPick("explorer", "Explorer", "Reads and searches the code", small, haiku)}
                {claude && runMode !== "single" && subPick("tests", "Test runner", "Runs the tests, reads failures", small, haiku)}
                {subPick("reviewer", "Reviewer", "Reads the diff before you do", models)}
              </div>
            </div>
            <div className="lc-ad-f">
              <span className="lc-ad-l">May change things</span>
              <Segmented full size="sm" value={access} onValueChange={setAccess} options={MAY.map((m) => ({ value: m.id, label: m.label }))} aria-label="May change things" />
              <span className="lc-ad-hint">Pushing and merging still ask you.</span>
            </div>
          </div>

          <div className="lc-ad-col">
            <span className="lc-ad-ch">What it knows</span>
            <label className="lc-ad-f">
              <span className="lc-ad-l">
                <span className="lc-mono">soul.md</span>
                <small>Who it is and how it works</small>
                <span className="lc-ad-end">Drop a .md file</span>
              </span>
              <textarea
                className="lc-ad-code lc-mono"
                value={soul}
                spellCheck={false}
                rows={7}
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
            </label>
            <label className="lc-ad-f">
              <span className="lc-ad-l">
                Prompt<span className="lc-ad-new">New</span>
                <small>Added to every turn, after the soul</small>
              </span>
              <textarea className="lc-ad-code lc-ad-prompt" value={prompt} rows={2} placeholder="Keep diffs small. When you touch a file you didn't expect to, say why." onChange={(e) => setPrompt(e.target.value)} />
            </label>
            <div className="lc-ad-f">
              <span className="lc-ad-l">
                Skills<span className="lc-ad-new">New</span>
                <small>skill.md files it reads when a task calls for one</small>
              </span>
              <Paths list={skills} onChange={setSkills} kind="skill" />
            </div>
            <div className="lc-ad-f">
              <span className="lc-ad-l">
                Context files<span className="lc-ad-new">New</span>
                <small>Read at the start of each session</small>
              </span>
              <Paths list={contextFiles} onChange={setContextFiles} kind="file" />
            </div>
          </div>
        </div>
        <div className="lc-sheet-foot lc-ad-foot">
          <span className="lc-ad-sum">
            <span className="lc-ad-disc">
              <Glyph glyph={glyph} size={14} />
            </span>
            <b>{name || "Unnamed"}</b>
            <span>{summary}</span>
          </span>
          <span className="lc-grow" />
          {agent && (
            <button type="button" className="lc-btn" data-kind="ghost" onClick={() => void remove()}>
              Remove
            </button>
          )}
          <button type="button" className="lc-btn" data-kind="ghost" onClick={onClose}>
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

/** Where a path is read: an absolute or ~ path is the same everywhere; a relative one is in each project. */
const isOwn = (p: string) => p.startsWith("/") || p.startsWith("~/");
const shortPath = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");
/** A skill's description to its first sentence, for a list. */
const brief = (d: string) => {
  const first = d.split(/(?<=\.)\s/)[0] ?? d;
  return first.length > 90 ? `${first.slice(0, 88)}…` : first;
};
/** A skill's name from its path: the folder of a SKILL.md, or the file. */
const skillName = (p: string) => {
  const parts = p.split("/").filter(Boolean);
  const last = parts[parts.length - 1] ?? p;
  return /^skill\.md$/i.test(last) ? (parts[parts.length - 2] ?? last) : last.replace(/\.md$/i, "");
};

/**
  Skills or context files as chips, each saying whose it is (yours, the same in every project, or
  each project's own), and a picker that adds one: the skills on this Mac and in your last
  project, or any path you type.
*/
function Paths({ list, onChange, kind }: { list: string[]; onChange: (l: string[]) => void; kind: "skill" | "file" }) {
  const [found, setFound] = useState<{ yours: SkillInfo[]; project: SkillInfo[] } | null>(null);
  const [typed, setTyped] = useState("");
  const load = () => {
    if (kind !== "skill" || found) return;
    let projectId: string | undefined;
    try {
      projectId = localStorage.getItem("lc:project") ?? undefined;
    } catch {
      projectId = undefined;
    }
    void rpc("skills.list", { projectId })
      .catch(() => rpc("skills.list", {}))
      .then(setFound)
      .catch(() => setFound({ yours: [], project: [] }));
  };
  const add = (p: string) => {
    const v = p.trim();
    if (v && !list.includes(v)) onChange([...list, v]);
  };
  const offers = kind === "file" ? ["AGENTS.md", "CLAUDE.md", "README.md"].filter((x) => !list.includes(x)) : [];
  return (
    <div className="lc-ad-chips">
      {list.map((p) => (
        <span key={p} className="lc-ad-chip" title={p}>
          <span className="lc-mono">{kind === "skill" ? skillName(p) : isOwn(p) ? shortPath(p) : p}</span>
          <i>{isOwn(p) ? "yours" : kind === "skill" ? "this project" : "each project"}</i>
          <button type="button" className="lc-ad-x l-focus" aria-label={`Remove ${p}`} onClick={() => onChange(list.filter((x) => x !== p))}>
            <I.close size={10} />
          </button>
        </span>
      ))}
      <span onPointerDown={load} onFocusCapture={load}>
        <Pop
          label={kind === "skill" ? "Add a skill" : "Add a context file"}
          width={340}
          triggerClass="lc-ad-add"
          trigger={
            <>
              <I.plus size={12} />
              {kind === "skill" ? "skill.md" : "A file"}
            </>
          }
        >
          {(close) => (
            <>
              {kind === "skill" && (
                <>
                  <PanelHead>Yours</PanelHead>
                  {found === null && <span className="l-shimmer lc-ad-wait">Looking for skills</span>}
                  {found?.yours.map((x) => (
                    <Row key={x.path} title={x.name} note={brief(x.description) || shortPath(x.path ?? "")} on={list.includes(x.path ?? "")} onPick={() => (add(x.path ?? ""), close())} />
                  ))}
                  {found && !found.yours.length && <span className="lc-quiet lc-ad-wait">None in ~/.claude/skills or ~/.codex/skills</span>}
                  {found && found.project.length > 0 && (
                    <>
                      <Sep />
                      <PanelHead>Each project's own</PanelHead>
                      {found.project.map((x) => (
                        <Row key={x.path} title={x.name} note={x.path ?? ""} on={list.includes(x.path ?? "")} onPick={() => (add(x.path ?? ""), close())} />
                      ))}
                    </>
                  )}
                  <Sep />
                </>
              )}
              {offers.map((x) => (
                <Row key={x} title={x} note="In each project" onPick={() => (add(x), close())} />
              ))}
              <form
                className="lc-ad-type"
                onSubmit={(e) => {
                  e.preventDefault();
                  add(typed);
                  setTyped("");
                  close();
                }}
              >
                <input className="lc-ad-in" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={kind === "skill" ? "A path to a skill.md, ~/… or in the project" : "docs/architecture.md, or ~/notes/…"} aria-label="A path" />
                <button type="submit" className="lc-btn" data-kind="accent" data-size="sm" disabled={!typed.trim()}>
                  Add
                </button>
              </form>
            </>
          )}
        </Pop>
      </span>
    </div>
  );
}
