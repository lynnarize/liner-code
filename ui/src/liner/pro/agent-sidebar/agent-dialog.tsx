/*
  Liner Pro · Agent sidebar · Agent dialog
  Making or editing an agent on one page rather than in steps: what it is good at, its name,
  the model and effort it runs on, and its soul.md, beside a preview that comes into focus as
  you go. A specialty fills in the rest, but never over something you have changed.
*/
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useIsoLayoutEffect } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { Dialog } from "../../components/dialog/dialog";
import { Button } from "../../components/button/button";
import { TextField } from "../../components/text-field/text-field";
import { Segmented } from "../../components/segmented/segmented";
import { AgentAvatar } from "../agents/agents";
import { ModelMark } from "../ai-kit/marks";
import { presetOf, soulFor, specialties, type AgentEffort, type AgentModel, type AgentSpec, type Specialty } from "./presets";

export type AgentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The agent being edited; a new one when left out. */
  agent?: AgentSpec;
  models: AgentModel[];
  /** Names other agents already have. */
  taken: string[];
  /** Throw to keep the dialog open. */
  onSave: (agent: AgentSpec) => void | Promise<void>;
};

type Overrides = { name?: string; model?: string; effort?: AgentEffort; soul?: string };

const efforts: Array<{ value: AgentEffort; label: string }> = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];
let seq = 1;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "agent";

/** The soul's opening lines, and the headings it is organised under. */
function readSoul(soul: string) {
  const lines = soul.split("\n");
  const sections = lines.filter((l) => /^##\s+\S/.test(l)).map((l) => l.replace(/^##\s+/, "").trim());
  const body: string[] = [];
  for (const l of lines) {
    if (/^#/.test(l)) {
      if (body.length) break;
      continue;
    }
    if (!l.trim()) {
      if (body.length) break;
      continue;
    }
    body.push(l.replace(/^[-*]\s+/, "").trim());
  }
  return { intro: body.join(" "), sections };
}

export function AgentDialog({ open, onOpenChange, agent, models, taken, onSave }: AgentDialogProps) {
  const [specialty, setSpecialty] = useState<Specialty>("designer");
  const [over, setOver] = useState<Overrides>({});
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [drop, setDrop] = useState(false);
  const [plate, setPlate] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const grid = useRef<HTMLDivElement>(null);

  // Each time it opens: the agent being edited, exactly as it is, or the first specialty.
  useEffect(() => {
    if (!open) return;
    setSpecialty(agent?.specialty ?? specialties[0].id);
    setOver(agent ? { name: agent.name, model: agent.model, effort: agent.effort, soul: agent.soul } : {});
    setError(null);
    setFailed(false);
    setSaving(false);
  }, [open, agent]);

  const preset = presetOf(specialty);
  const name = over.name ?? preset.name;
  const model = over.model ?? preset.model;
  const effort = over.effort ?? preset.effort;
  const starter = soulFor(specialty, name);
  const soul = over.soul ?? starter;
  const kept = agent && agent.specialty === specialty;
  const glyph = kept ? agent.glyph : preset.glyph;
  const role = specialty === "custom" ? (kept ? agent.role : "Custom") : preset.label;
  const m = models.find((x) => x.id === model) ?? models[0];
  const { intro, sections } = readSoul(soul);
  const lines = soul.replace(/\n+$/, "").split("\n").length;

  // One plate glides between the specialties.
  useIsoLayoutEffect(() => {
    const g = grid.current;
    if (!g || !open) return;
    const measure = () => {
      const el = g.querySelector<HTMLElement>('[aria-checked="true"]');
      if (el) setPlate({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(g);
    return () => ro.disconnect();
  }, [specialty, open]);

  const pick = (id: Specialty) => {
    if (id === specialty) return;
    setSpecialty(id);
    feedback.play("tick", 4);
  };
  const specKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    // Up and down move a whole row, however many columns the grid has at this width.
    const cols = grid.current ? getComputedStyle(grid.current).gridTemplateColumns.split(" ").length : 3;
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" ? cols : e.key === "ArrowUp" ? -cols : 0;
    if (!step) return;
    e.preventDefault();
    const i = specialties.findIndex((s) => s.id === specialty);
    const next = specialties[Math.min(specialties.length - 1, Math.max(0, i + step))];
    pick(next.id);
    grid.current?.querySelector<HTMLElement>(`[data-spec="${next.id}"]`)?.focus();
  };

  const save = async () => {
    const n = name.trim();
    if (!n) return setError("Give it a name");
    if (taken.some((t) => t.toLowerCase() === n.toLowerCase())) return setError(`There's already an agent called ${n}`);
    const spec: AgentSpec = { id: agent?.id ?? `${slug(n)}-${seq++}`, name: n, role, glyph, specialty, model, effort, soul: `${soul.replace(/\s+$/, "")}\n` };
    setSaving(true);
    setFailed(false);
    try {
      await onSave(spec);
      onOpenChange(false);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      className="l-asb-dialog"
      title={agent ? `Edit ${agent.name}` : "New agent"}
      description="Pick what it's good at. Its name, model and soul.md fill in, and you can change any of them."
      actions={
        <>
          {failed && <span className="l-asb-dialog-fail">Couldn't save. Try again.</span>}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={saving} onClick={save}>
            {agent ? "Save" : "Create agent"}
          </Button>
        </>
      }
    >
      <div className="l-asb-form">
        <div className="l-asb-fields">
          <div className="l-asb-field">
            <span className="l-asb-field-label" id="l-asb-spec-label">
              Good at
            </span>
            <div ref={grid} className="l-asb-spec" role="radiogroup" aria-labelledby="l-asb-spec-label" onKeyDown={specKeys}>
              <span className="l-asb-spec-plate" aria-hidden style={plate ? { transform: `translate(${plate.x}px, ${plate.y}px)`, width: plate.w, height: plate.h, opacity: 1 } : undefined} />
              {specialties.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  data-spec={s.id}
                  aria-checked={s.id === specialty}
                  tabIndex={s.id === specialty ? 0 : -1}
                  className="l-asb-spec-card"
                  onClick={() => pick(s.id)}
                >
                  <AgentAvatar a={{ id: s.id, name: s.label, role: s.label, glyph: s.glyph }} size={28} />
                  <span>
                    <b>{s.label}</b>
                    <span>{s.note}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <TextField
            label="Name"
            value={name}
            error={error}
            maxLength={24}
            onValueChange={(v) => {
              setOver((o) => ({ ...o, name: v }));
              setError(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />

          <div className="l-asb-field">
            <span className="l-asb-field-label">Model</span>
            <Segmented
              full
              size="sm"
              aria-label="Model"
              value={model}
              onValueChange={(v) => setOver((o) => ({ ...o, model: v }))}
              options={models.map((x) => ({ value: x.id, label: x.label, icon: <ModelMark id={x.id} size={14} /> }))}
            />
            <span key={m.id} className="l-asb-hint">
              {m.description}
            </span>
          </div>

          <div className="l-asb-field">
            <span className="l-asb-field-label">Effort</span>
            <Segmented full size="sm" aria-label="Effort" value={effort} onValueChange={(v) => setOver((o) => ({ ...o, effort: v }))} options={efforts} />
          </div>

          <div className="l-asb-field">
            <span className="l-asb-field-label">Soul</span>
            <div
              className="l-asb-soul"
              data-drop={drop || undefined}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes("Files")) return;
                e.preventDefault();
                setDrop(true);
              }}
              onDragLeave={() => setDrop(false)}
              onDrop={async (e) => {
                const file = Array.from(e.dataTransfer.files).find((f) => /\.(md|markdown|txt)$/i.test(f.name) || f.type.startsWith("text/"));
                setDrop(false);
                if (!file) return;
                e.preventDefault();
                const text = await file.text();
                setOver((o) => ({ ...o, soul: text }));
                feedback.play("pop", 2);
              }}
            >
              <div className="l-asb-soul-bar">
                <span className="l-asb-soul-file">soul.md</span>
                <span className="l-num">
                  {lines} {lines === 1 ? "line" : "lines"}
                </span>
                {soul !== starter && (
                  <button type="button" className="l-asb-soul-reset l-focus" onClick={() => setOver((o) => ({ ...o, soul: undefined }))}>
                    Use the {preset.label.toLowerCase()} starter
                  </button>
                )}
              </div>
              <textarea value={soul} spellCheck aria-label="soul.md" onChange={(e) => setOver((o) => ({ ...o, soul: e.target.value }))} />
              <span className="l-asb-soul-drop" aria-hidden>
                Drop a .md file to use it
              </span>
            </div>
          </div>
        </div>

        <aside className="l-asb-preview l-frame-solo" aria-label="Preview">
          <span className="l-asb-pv-kicker">Preview</span>
          <span key={glyph} className="l-asb-pv-avatar">
            <AgentAvatar a={{ id: "preview", name, role, glyph }} size={44} />
          </span>
          <span className="l-asb-pv-who">
            <b key={name}>{name.trim() || "Unnamed"}</b>
            <span key={role}>{role}</span>
          </span>
          <span className="l-asb-pv-chips">
            <span key={m.id}>
              <ModelMark id={m.id} size={13} />
              {m.label}
            </span>
            <span key={effort}>{efforts.find((x) => x.value === effort)?.label} effort</span>
          </span>
          <p key={intro} className="l-asb-pv-intro">
            {intro || "Its soul is empty. Say who it is and how it works."}
          </p>
          {sections.length > 0 && (
            <span className="l-asb-pv-sections" key={sections.join("|")}>
              {sections.map((s) => (
                <span key={s}>{s}</span>
              ))}
            </span>
          )}
        </aside>
      </div>
    </Dialog>
  );
}
