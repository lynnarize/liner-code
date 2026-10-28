/*
  The inspector: the picked step's settings in Liner's own fields, how its paths split,
  what it saw on the last test and how it did this week. With nothing picked, the workflow
  at a glance. Every change shows on the canvas as you make it.
*/
import { useId } from "react";
import { Button } from "../../components/button/button";
import { TextField } from "../../components/text-field/text-field";
import { Textarea } from "../../components/textarea/textarea";
import { Select } from "../../components/select/select";
import { Switch } from "../../components/switch/switch";
import { Slider } from "../../components/slider/slider";
import { Segmented } from "../../components/segmented/segmented";
import { InlineEdit } from "../../components/inline-edit/inline-edit";
import { DropdownMenu } from "../../components/menu/menu";
import { Sparkline } from "../../components/sparkline/sparkline";
import { RollingNumber } from "../../components/rolling-number/rolling-number";
import { AiMark } from "../ai-kit/marks";
import { Glyph, Icon } from "./glyphs";
import type { StepRun } from "./canvas";
import { formatSeconds, type WorkflowField, type WorkflowFieldValue, type WorkflowRunRecord, type WorkflowStats, type WorkflowStep } from "./model";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export type InspectorProps = {
  step: WorkflowStep | null;
  /** Its place: step n of total, and the path it is on. */
  where?: { n: number; total: number; path?: string };
  run?: StepRun;
  onTitle: (title: string) => void;
  onField: (id: string, value: WorkflowFieldValue) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onAddPath: () => void;
  /** Shown as a close button, when the inspector is a sheet. */
  onClose?: () => void;
  overview: { title: string; steps: number; paths: number; stats?: WorkflowStats; runs: WorkflowRunRecord[] };
};

function Close({ onClose }: { onClose?: () => void }) {
  if (!onClose) return null;
  return (
    <button type="button" className="l-wf-ins__close l-plate l-focus" aria-label="Close settings" onClick={onClose}>
      <Icon.close />
    </button>
  );
}

function ListField({ field, onValue }: { field: Extract<WorkflowField, { type: "list" }>; onValue: (v: WorkflowFieldValue) => void }) {
  const id = useId();
  const noun = field.noun ?? "item";
  const next = () => {
    let n = field.value.length + 1;
    while (field.value.some((r) => r.name === `${noun}_${n}`)) n++;
    return `${noun}_${n}`;
  };
  return (
    <div className="l-in l-wf-list">
      <span className="l-in-label" id={id}>
        {field.label}
      </span>
      <ul className="l-wf-list__rows" aria-labelledby={id}>
        {field.value.map((r, i) => (
          <li key={`${r.name}-${i}`}>
            <code>{r.name}</code>
            <span className="l-wf-list__type">{r.type}</span>
            <button type="button" className="l-wf-list__rm l-focus" aria-label={`Remove ${r.name}`} onClick={() => onValue(field.value.filter((_, k) => k !== i))}>
              <Icon.close />
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="l-wf-list__add l-focus" onClick={() => onValue([...field.value, { name: next(), type: "text" }])}>
        <Icon.plus />
        Add a {noun}
      </button>
      {field.hint && <span className="l-in-hint">{field.hint}</span>}
    </div>
  );
}

function FieldControl({ field: f, onValue }: { field: WorkflowField; onValue: (v: WorkflowFieldValue) => void }) {
  switch (f.type) {
    case "text":
      return <TextField label={f.label} value={f.value} placeholder={f.placeholder} description={f.hint} onValueChange={onValue} />;
    case "longtext":
      return <Textarea label={f.label} value={f.value} description={f.hint} minRows={3} maxRows={7} onValueChange={onValue} />;
    case "select":
      return <Select label={f.label} value={f.value} options={f.options} description={f.hint ?? f.options.find((o) => o.value === f.value)?.hint} onValueChange={onValue} />;
    case "choice":
      return (
        <div className="l-in">
          <span className="l-in-label">{f.label}</span>
          <Segmented aria-label={f.label} size="sm" full options={f.options} value={f.value} onValueChange={onValue} />
          {f.hint && <span className="l-in-hint">{f.hint}</span>}
        </div>
      );
    case "toggle":
      return <Switch size="sm" label={f.label} description={f.hint} checked={f.value} onCheckedChange={onValue} />;
    case "range":
      return <Slider label={f.label} min={f.min} max={f.max} step={f.step ?? 1} value={f.value} marks={false} format={(v) => `${f.prefix ?? ""}${v.toLocaleString("en-US")}${f.suffix ?? ""}`} onValueChange={onValue} />;
    case "list":
      return <ListField field={f} onValue={onValue} />;
  }
}

function Stats({ stats, title }: { stats: WorkflowStats; title: string }) {
  return (
    <section className="l-wf-sec">
      <p className="l-wf-sec__head">{title}</p>
      <div className="l-wf-stats">
        <span>
          <b className="l-num">
            <RollingNumber value={stats.runs} />
          </b>
          runs
        </span>
        <span>
          <b className="l-num">{stats.ok}%</b>
          passed
        </span>
        <span>
          <b className="l-num">{formatSeconds(stats.seconds)}</b>
          on average
        </span>
      </div>
      {stats.week && stats.week.length > 1 && <Sparkline className="l-wf-spark" data={stats.week} labels={DAYS.slice(-stats.week.length)} height={34} label="Runs each day this week" format={(v) => `${v} runs`} />}
    </section>
  );
}

function LastTest({ run }: { run: StepRun }) {
  const label = run.state === "running" ? "Running now" : run.state === "skipped" ? "Skipped" : run.state === "failed" ? "Failed" : run.seconds !== undefined ? `Took ${formatSeconds(run.seconds)}` : "Done";
  return (
    <section className="l-wf-sec l-wf-test" data-state={run.state}>
      <p className="l-wf-sec__head">
        Last test
        <span key={run.state}>{label}</span>
      </p>
      {run.state === "skipped" ? (
        <p className="l-wf-test__note">The test took another path.</p>
      ) : (
        run.note && (
          <p className="l-wf-test__note" key={run.note}>
            {run.note}
          </p>
        )
      )}
      {run.output && (
        <dl className="l-wf-out">
          {Object.entries(run.output).map(([k, v], i) => (
            <div key={k} style={{ animationDelay: `${i * 50}ms` }}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function StepView({ step, where, run, onTitle, onField, onRemove, onDuplicate, onAddPath, onClose }: InspectorProps & { step: WorkflowStep }) {
  const trigger = step.kind === "trigger";
  return (
    <>
      <header className="l-wf-ins__head">
        <span className="l-wf-ins__glyph" data-kind={step.kind} aria-hidden>
          {step.icon ?? (step.kind === "ai" ? <AiMark size={20} phase={run?.state === "running" ? "thinking" : "idle"} /> : <Glyph name={step.glyph} kind={step.kind} />)}
        </span>
        <div className="l-wf-ins__id">
          <InlineEdit label="Step name" value={step.title} onSave={onTitle} className="l-wf-ins__title" />
          <span className="l-wf-ins__sub">
            {step.label}
            {where && (
              <>
                {" · "}
                <span className="l-num">
                  Step {where.n} of {where.total}
                </span>
              </>
            )}
          </span>
        </div>
        <DropdownMenu
          iconOnly
          label="Step actions"
          align="end"
          trigger={<Icon.more />}
          className="l-wf-ins__more"
          items={[
            { id: "dup", label: "Duplicate", icon: <Icon.copy />, disabled: trigger, onSelect: onDuplicate },
            { type: "separator", id: "sep" },
            { id: "rm", label: "Remove step", icon: <Icon.trash />, danger: true, disabled: trigger, hint: trigger ? "Every workflow starts here" : undefined, onSelect: onRemove },
          ]}
        />
        <Close onClose={onClose} />
      </header>
      <div className="l-wf-ins__body">
        {where?.path && (
          <p className="l-wf-ins__where">
            On the <b>{where.path}</b> path
          </p>
        )}
        {step.fields?.length ? (
          <div className="l-wf-fields">
            {step.fields.map((f) => (
              <FieldControl key={f.id} field={f} onValue={(v) => onField(f.id, v)} />
            ))}
          </div>
        ) : (
          <p className="l-wf-ins__empty">Nothing to set up here.</p>
        )}
        {step.paths && (
          <section className="l-wf-sec">
            <p className="l-wf-sec__head">
              Paths<span>Share of runs</span>
            </p>
            <ul className="l-wf-paths">
              {step.paths.map((p) => (
                <li key={p.id}>
                  <span className="l-wf-paths__name">{p.label}</span>
                  <span className="l-wf-paths__bar" aria-hidden>
                    <i style={{ width: `${p.share ?? 0}%` }} />
                  </span>
                  <b className="l-num">{p.share === undefined ? "New" : <><RollingNumber value={p.share} />%</>}</b>
                </li>
              ))}
            </ul>
            <Button size="sm" variant="ghost" icon={<Icon.plus />} onClick={onAddPath} className="l-wf-paths__add">
              Add a path
            </Button>
          </section>
        )}
        {run && <LastTest run={run} />}
        {step.stats && <Stats stats={step.stats} title="This week" />}
      </div>
    </>
  );
}

function Overview({ title, steps, paths, stats, runs, onClose }: InspectorProps["overview"] & { onClose?: () => void }) {
  return (
    <>
      <header className="l-wf-ins__head">
        <span className="l-wf-ins__glyph" aria-hidden>
          <Icon.flow />
        </span>
        <div className="l-wf-ins__id">
          <b className="l-wf-ins__name">{title}</b>
          <span className="l-wf-ins__sub l-num">
            {steps} {steps === 1 ? "step" : "steps"}
            {paths > 0 && ` · ${paths} ${paths === 1 ? "path" : "paths"}`}
          </span>
        </div>
        <Close onClose={onClose} />
      </header>
      <div className="l-wf-ins__body">
        {stats && <Stats stats={stats} title="This week" />}
        {runs.length > 0 && (
          <section className="l-wf-sec">
            <p className="l-wf-sec__head">Recent runs</p>
            <ul className="l-wf-runs">
              {runs.slice(0, 4).map((r) => (
                <li key={r.id} data-ok={r.ok || undefined}>
                  <span className="l-wf-runs__mark" aria-hidden>
                    {r.ok ? <Icon.check /> : <Icon.warn />}
                  </span>
                  <span className="l-wf-runs__text">
                    <b>{r.title}</b>
                    <span>{[r.test ? "Test" : null, r.path ? `${r.path} path` : null, formatSeconds(r.seconds)].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="l-wf-runs__when l-num">{r.when}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <p className="l-wf-tip">
          Pick a step to change it, or press
          <span className="l-wf-tip__plus" aria-label="plus">
            <Icon.plus />
          </span>
          on the line to add one.
        </p>
      </div>
    </>
  );
}

export function Inspector(props: InspectorProps) {
  return (
    <div className="l-wf-ins" key={props.step?.id ?? "overview"}>
      {props.step ? <StepView {...props} step={props.step} /> : <Overview {...props.overview} onClose={props.onClose} />}
    </div>
  );
}
