/*
  Liner Pro · Workflow builder
  An automation drawn as one line. Every step is a white card on it, and a branch splits it
  into paths that meet again below. Press + on the line for a glass menu of steps; pick a
  step to set it up beside the canvas, and the card changes as you do. Run a test to watch
  it work: the line fills with the accent from the trigger down, each step shimmers while
  it works and lands with its time, and the path it didn't take steps back. Ask for a change
  in words and it is made the same way, with an Undo.

  Bring your own runner (`run`) and assistant (`ask`); without them, a simulated test plays
  two sample requests in turn and a simulated assistant understands a few kinds of change.
*/
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cx, useIsoLayoutEffect, useSeen, useSize } from "../../lib/hooks";
import { clamp } from "../../lib/spring";
import { feedback } from "../../lib/feedback";
import { Button } from "../../components/button/button";
import { AvatarGroup } from "../../components/avatar/avatar";
import { TextShimmer } from "../../components/text-shimmer/text-shimmer";
import { AiMark, Rays } from "../ai-kit/marks";
import { Canvas, type CanvasApi, type RunView, type StepRun } from "./canvas";
import { Inspector } from "./inspector";
import { StepPicker } from "./picker";
import { Icon } from "./glyphs";
import { layoutOf, type Pt } from "./layout";
import {
  duplicate,
  findPath,
  findStep,
  flat,
  fromTemplate,
  insertAt,
  newId,
  pathsIn,
  removeStep,
  setField,
  stepsIn,
  updateStep,
  type InsertAt,
  type WorkflowAsk,
  type WorkflowFieldValue,
  type WorkflowRunEvent,
  type WorkflowRunner,
  type WorkflowRunRecord,
  type WorkflowStats,
  type WorkflowStep,
  type WorkflowTemplate,
} from "./model";
import { sampleEstimate, samplePeople, sampleRuns, sampleStats, sampleSteps, sampleTemplates, simulatedAsk, simulatedRunner } from "./sample";
import "../ai-kit/ai-kit.css";
import "./workflow-builder.css";

export type {
  GlyphName,
  InsertAt,
  WorkflowAsk,
  WorkflowField,
  WorkflowPath,
  WorkflowRunEvent,
  WorkflowRunner,
  WorkflowRunRecord,
  WorkflowStats,
  WorkflowStep,
  WorkflowStepKind,
  WorkflowTemplate,
} from "./model";

export type WorkflowBuilderProps = {
  title?: string;
  /** Controlled steps; pair with onStepsChange. */
  steps?: WorkflowStep[];
  defaultSteps?: WorkflowStep[];
  onStepsChange?: (steps: WorkflowStep[]) => void;
  /** What the add menu offers. */
  templates?: WorkflowTemplate[];
  /** Who else has it open. */
  people?: { name: string; src?: string }[];
  /** The version being drafted, and whether it is already live. */
  version?: number;
  published?: boolean;
  onPublish?: () => Promise<void> | void;
  /** Runs a test. Defaults to a simulated run of two sample requests. */
  run?: WorkflowRunner;
  /** Makes a change from words. Null hides the field. */
  ask?: WorkflowAsk | null;
  /** How runs split across a branch's paths for its settings, so the shares follow as you change them. */
  estimate?: (step: WorkflowStep) => number[] | undefined;
  /** The workflow's week, and its recent runs, shown when no step is picked. */
  stats?: WorkflowStats;
  runs?: WorkflowRunRecord[];
  defaultSelected?: string | null;
  /** "view" draws the workflow without editing: no strips, no settings, no +. */
  mode?: "edit" | "view";
  /** Start a test once it is on screen, for demos. */
  autoRun?: boolean;
  className?: string;
};

type Notice = { id: number; tone?: "ok" | "danger" | "ai"; busy?: boolean; text: string; action?: { label: string; run: () => void } };
type Testing = RunView & { status: "idle" | "running" | "done" };
type Picker = { at: InsertAt; x: number; y: number; side: "top" | "bottom"; origin: number; max: number; title: string };

const PICK_W = 296;
const runIdle: RunView = { active: false, steps: {}, lit: [], taken: {}, skipped: [] };
const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

/** Keeps the last value a beat after it goes, so it can leave instead of vanishing. */
function useLeaving<T>(value: T | null | false, ms: number): [T | null, boolean] {
  const [last, setLast] = useState<T | null>(value || null);
  const [out, setOut] = useState(false);
  useEffect(() => {
    if (value) {
      setLast(value);
      setOut(false);
      return;
    }
    setOut(true);
    const t = window.setTimeout(() => {
      setLast(null);
      setOut(false);
    }, ms);
    return () => window.clearTimeout(t);
  }, [value]);
  return [value || last, !value && out];
}

export function WorkflowBuilder({
  title = "Refund requests",
  steps: given,
  defaultSteps,
  onStepsChange,
  templates = sampleTemplates,
  people = samplePeople,
  version = 15,
  published = false,
  onPublish,
  run: runner,
  ask,
  estimate,
  stats,
  runs,
  defaultSelected,
  mode = "edit",
  autoRun = false,
  className,
}: WorkflowBuilderProps) {
  const sample = given === undefined && defaultSteps === undefined;
  const edit = mode === "edit";
  const titleId = useId();
  const [inner, setInner] = useState(() => defaultSteps ?? sampleSteps);
  const steps = given ?? inner;
  const latest = useRef(steps);
  useIsoLayoutEffect(() => {
    latest.current = steps;
  });
  const layout = useMemo(() => layoutOf(steps, { tail: edit }), [steps, edit]);
  const places = useMemo(() => flat(steps), [steps]);

  const [simRun] = useState(simulatedRunner);
  const asker = ask === null ? null : (ask ?? simulatedAsk);
  const est = estimate ?? (sample ? sampleEstimate : undefined);
  const weekStats = stats ?? (sample ? sampleStats : undefined);

  const [sizeRef, size] = useSize<HTMLElement>();
  const [seenRef, seen] = useSeen<HTMLElement>(autoRun);
  const narrow = (size?.width ?? 960) < 720;
  const tiny = (size?.width ?? 960) < 460;
  const canvas = useRef<CanvasApi | null>(null);
  const side = useRef<HTMLElement | null>(null);

  const [picked, setPicked] = useState<string | null>(() => (defaultSelected !== undefined ? defaultSelected : sample && edit ? "read" : null));
  const place = picked ? (places.find((p) => p.step.id === picked) ?? null) : null;
  const selected = place ? picked : null;
  const [sheet, setSheet] = useState(false);

  const [notice, setNotice] = useState<Notice | null>(null);
  const seq = useRef(0);
  const say = (n: Omit<Notice, "id">) => setNotice({ ...n, id: ++seq.current });
  useEffect(() => {
    if (!notice || notice.busy) return;
    const t = window.setTimeout(() => setNotice((n) => (n?.id === notice.id ? null : n)), notice.action ? 6500 : 4200);
    return () => window.clearTimeout(t);
  }, [notice]);

  /* ---------- Changes, saving and undo ---------- */
  const history = useRef<WorkflowStep[][]>([]);
  const burst = useRef<{ key: string; at: number } | null>(null);
  const [edits, setEdits] = useState(0);
  const [saving, setSaving] = useState(false);
  const [live, setLive] = useState(published);
  const [ver, setVer] = useState(version);
  const [publishing, setPublishing] = useState(false);
  useEffect(() => {
    if (!edits) return;
    setSaving(true);
    const t = window.setTimeout(() => setSaving(false), 700);
    return () => window.clearTimeout(t);
  }, [edits]);

  const write = (next: WorkflowStep[]) => {
    if (given === undefined) setInner(next);
    latest.current = next;
    onStepsChange?.(next);
    setEdits((n) => n + 1);
    // Read from a ref: an Undo pressed long after its notice appeared still sees what is true now.
    if (now.current.live) {
      setLive(false);
      setVer((v) => v + 1);
    }
    if (now.current.status !== "idle") clearRun();
  };
  /** A change you can undo. Typing into one field keeps adding to the same change. */
  const commit = (next: WorkflowStep[], key?: string) => {
    const now = performance.now();
    const same = key && burst.current?.key === key && now - burst.current.at < 1500;
    if (!same) {
      history.current.push(latest.current);
      if (history.current.length > 40) history.current.shift();
    }
    burst.current = key ? { key, at: now } : null;
    write(next);
  };
  const undo = () => {
    const prev = history.current.pop();
    if (!prev) return;
    burst.current = null;
    write(prev);
    say({ text: "Put back the way it was." });
    feedback.play("tap", -2);
  };

  /* ---------- Selection ---------- */
  const reveal = useRef<string | null>(null);
  const focusSide = useRef(false);
  const select = (id: string | null, how?: "pointer" | "key" | "focus") => {
    setPicked(id);
    if (!id) setSheet(false);
    else if (narrow && how === "pointer") setSheet(true);
  };
  const open = (id: string) => {
    setPicked(id);
    if (narrow) setSheet(true);
    focusSide.current = true;
  };
  // After a change lands: bring the new step into view, and focus moves with it.
  useEffect(() => {
    const id = reveal.current;
    if (!id) return;
    reveal.current = null;
    canvas.current?.reveal(id);
    if (!sheet) canvas.current?.focus(id);
  }, [layout]);
  useEffect(() => {
    if (!focusSide.current) return;
    focusSide.current = false;
    side.current?.querySelector<HTMLElement>("input, textarea, button:not([disabled])")?.focus({ preventScroll: true });
  });

  /* ---------- Editing ---------- */
  const [picker, setPicker] = useState<Picker | null>(null);
  const onAdd = (at: InsertAt, p: Pt, label: string, view: { w: number; h: number }) => {
    if (testing.status === "running") return;
    const x = clamp(p.x - PICK_W / 2, 8, Math.max(8, view.w - PICK_W - 8));
    const below = view.h - p.y > 300 || p.y < view.h / 2;
    const max = below ? view.h - p.y - 70 : p.y - 70;
    setPicker({ at, x, y: below ? p.y + 16 : view.h - p.y + 16, side: below ? "bottom" : "top", origin: p.x - x, max: Math.max(140, max), title: label });
    feedback.play("tick");
  };
  const closePicker = () => {
    const inside = document.activeElement?.closest(".l-wf-pick");
    setPicker(null);
    if (inside && selected) canvas.current?.focus(selected);
  };
  const pick = (t: WorkflowTemplate) => {
    if (!picker) return;
    const step = fromTemplate(t);
    commit(insertAt(latest.current, picker.at, step));
    setPicker(null);
    setPicked(step.id);
    reveal.current = step.id;
    say({ text: `Added “${step.title}”.`, action: { label: "Undo", run: undo } });
    feedback.play("pop", 3);
  };
  const remove = (id: string) => {
    const p = findStep(latest.current, id);
    if (!p) return;
    if (p.step.kind === "trigger") {
      say({ text: "The trigger starts the workflow, so it stays." });
      feedback.play("error");
      return;
    }
    const next = p.siblings[p.index + 1] ?? p.siblings[p.index - 1] ?? p.branch;
    commit(removeStep(latest.current, id));
    setPicked(next?.id ?? null);
    if (next) reveal.current = next.id;
    say({ text: `Removed “${p.step.title}”.`, action: { label: "Undo", run: undo } });
    feedback.play("tap", -3);
  };
  const copy = (id: string) => {
    const p = findStep(latest.current, id);
    if (!p || p.step.kind === "trigger") return;
    const twin = duplicate(p.step);
    commit(insertAt(latest.current, { list: p.list, index: p.index + 1 }, twin));
    setPicked(twin.id);
    reveal.current = twin.id;
    feedback.play("pop", 2);
  };
  const rename = (id: string, name: string) => commit(updateStep(latest.current, id, (s) => ({ ...s, title: name.trim() || s.title })));
  const setValue = (id: string, field: string, value: WorkflowFieldValue) => {
    let next = updateStep(latest.current, id, (s) => setField(s, field, value));
    const s = findStep(next, id)?.step;
    const shares = s?.paths && est?.(s);
    if (shares) next = updateStep(next, id, (b) => ({ ...b, paths: b.paths?.map((p, i) => ({ ...p, share: shares[i] ?? p.share })) }));
    commit(next, `${id}:${field}`);
  };
  const addPath = (id: string) => {
    const b = findStep(latest.current, id)?.step;
    if (!b?.paths) return;
    const label = `Path ${b.paths.length + 1}`;
    commit(updateStep(latest.current, id, (s) => ({ ...s, paths: [...(s.paths ?? []), { id: newId("path"), label, steps: [] }] })));
    say({ text: `Added ${label}. Press + on it to give it a step.`, action: { label: "Undo", run: undo } });
    feedback.play("pop", 1);
  };

  /* ---------- Test runs ---------- */
  const [testing, setTesting] = useState<Testing>({ ...runIdle, status: "idle" });
  const now = useRef({ live, status: testing.status });
  useIsoLayoutEffect(() => {
    now.current = { live, status: testing.status };
  });
  const [recent, setRecent] = useState<WorkflowRunRecord[]>(() => runs ?? (sample ? sampleRuns : []));
  const abortRun = useRef<AbortController | null>(null);
  const abortAsk = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      abortRun.current?.abort();
      abortAsk.current?.abort();
    },
    [],
  );
  function clearRun() {
    abortRun.current?.abort();
    abortRun.current = null;
    now.current.status = "idle";
    setTesting({ ...runIdle, status: "idle" });
    setNotice((n) => (n?.busy && n.tone !== "ai" ? null : n));
  }
  async function test() {
    if (testing.status === "running") {
      abortRun.current?.abort();
      return;
    }
    const ctl = new AbortController();
    abortRun.current = ctl;
    setPicker(null);
    setTesting({ ...runIdle, active: true, status: "running" });
    feedback.play("tap", 2);
    let took: string | undefined;
    const t0 = performance.now();
    const emit = (e: WorkflowRunEvent) => {
      if (ctl.signal.aborted) return;
      if (e.type === "status") say({ busy: true, text: e.text });
      else if (e.type === "step") {
        const r: StepRun = { state: e.state, note: e.note, seconds: e.seconds, output: e.output };
        setTesting((t) => ({ ...t, steps: { ...t.steps, [e.id]: r }, lit: e.state === "running" && !t.lit.includes(e.id) ? [...t.lit, e.id] : t.lit }));
        if (e.state === "running") canvas.current?.reveal(e.id);
      } else {
        const b = findStep(latest.current, e.branch)?.step;
        const others = b?.paths?.filter((p) => p.id !== e.path) ?? [];
        const skippedPaths = others.flatMap((p) => [p.id, ...pathsIn(p.steps)]);
        const skippedSteps = others.flatMap((p) => stepsIn(p.steps).map((s): [string, StepRun] => [s.id, { state: "skipped" }]));
        took ??= findPath(latest.current, e.path)?.path.label;
        setTesting((t) => ({ ...t, taken: { ...t.taken, [e.branch]: e.path }, skipped: [...t.skipped, ...skippedPaths], steps: { ...t.steps, ...Object.fromEntries(skippedSteps) } }));
      }
    };
    try {
      const res = await (runner ?? simRun)(latest.current, emit, ctl.signal);
      if (ctl.signal.aborted) return;
      const seconds = (performance.now() - t0) / 1000;
      setTesting((t) => ({ ...t, active: false, status: "done" }));
      say({ tone: "ok", text: res?.text ?? `Passed in ${seconds.toFixed(1)}s.`, action: { label: "Clear", run: clearRun } });
      const when = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      setRecent((list) => [{ id: newId("run"), title: "Test run", path: took, seconds, when, ok: true, test: true }, ...list]);
      feedback.play("success");
    } catch (err) {
      if (abortRun.current !== ctl) return;
      setTesting((t) => ({ ...t, active: false, status: "done" }));
      if ((err as Error).name === "AbortError") say({ text: "Stopped the test. What ran so far stays marked.", action: { label: "Clear", run: clearRun } });
      else {
        say({ tone: "danger", text: (err as Error).message || "The test failed.", action: { label: "Clear", run: clearRun } });
        feedback.play("error");
      }
    } finally {
      if (abortRun.current === ctl) abortRun.current = null;
    }
  }
  useEffect(() => {
    if (!autoRun || !seen) return;
    const t = window.setTimeout(test, 900);
    return () => window.clearTimeout(t);
  }, [seen]);

  /* ---------- Publish ---------- */
  const publish = async () => {
    if (publishing || live) return;
    setPublishing(true);
    try {
      await (onPublish ? onPublish() : wait(900));
      setLive(true);
      say({ tone: "ok", text: `Version ${ver} is live. New requests run on it from now.` });
      feedback.play("success");
    } catch (err) {
      say({ tone: "danger", text: (err as Error).message || "Couldn't publish. Try again." });
    } finally {
      setPublishing(false);
    }
  };

  /* ---------- Ask for a change ---------- */
  const [askText, setAskText] = useState("");
  const [thinking, setThinking] = useState(false);
  const submit = async () => {
    const text = askText.trim();
    if (!text || thinking || !asker) return;
    const ctl = new AbortController();
    abortAsk.current = ctl;
    setThinking(true);
    setPicker(null);
    say({ tone: "ai", busy: true, text: "Working on it" });
    try {
      const res = await asker(text, { steps: latest.current, selected, templates }, ctl.signal);
      if (ctl.signal.aborted) return;
      if (res.steps) {
        commit(res.steps);
        if (res.select) {
          setPicked(res.select);
          reveal.current = res.select;
        }
        setAskText("");
        say({ tone: "ai", text: res.note, action: { label: "Undo", run: undo } });
        feedback.play("pop", 4);
      } else say({ tone: "ai", text: res.note });
    } catch (err) {
      if ((err as Error).name !== "AbortError") say({ tone: "danger", text: "That didn't work. Try again in a moment." });
    } finally {
      setThinking(false);
    }
  };

  const onRootKey = (e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.key.toLowerCase() !== "z") return;
    if ((e.target as HTMLElement).closest("input, textarea, [contenteditable]")) return;
    e.preventDefault();
    undo();
  };
  const onSideKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    if ((e.target as HTMLElement).closest("input, textarea, .l-pop")) return;
    e.preventDefault();
    if (narrow) setSheet(false);
    if (selected) canvas.current?.focus(selected);
  };

  const [shownNotice, noticeOut] = useLeaving(notice, 200);
  const [sheetStep, sheetOut] = useLeaving(narrow && sheet && edit ? (place?.step ?? null) : null, 240);
  // The sheet's height is room the canvas gives up, so the picked step stays in sight above it.
  const [sheetH, setSheetH] = useState(0);
  const sheetOpen = !!sheetStep && !sheetOut;
  useIsoLayoutEffect(() => {
    const el = sheetOpen ? side.current : null;
    if (!el) return setSheetH(0);
    const measure = () => setSheetH(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sheetOpen]);
  useEffect(() => {
    if (sheetH && selected) canvas.current?.reveal(selected);
  }, [sheetH > 0, selected]);
  const running = testing.status === "running";
  const where = place ? { n: places.indexOf(place) + 1, total: places.length, path: place.path?.label } : undefined;
  const pathCount = places.reduce((n, p) => n + (p.step.paths?.length ?? 0), 0);
  const inspector = (onClose?: () => void, step = place?.step ?? null) => (
    <Inspector
      step={step}
      where={step ? where : undefined}
      run={step ? testing.steps[step.id] : undefined}
      onTitle={(t) => step && rename(step.id, t)}
      onField={(f, v) => step && setValue(step.id, f, v)}
      onRemove={() => step && remove(step.id)}
      onDuplicate={() => step && copy(step.id)}
      onAddPath={() => step && addPath(step.id)}
      onClose={onClose}
      overview={{ title, steps: places.length, paths: pathCount, stats: weekStats, runs: recent }}
    />
  );

  const noticeIcon = shownNotice?.busy ? (
    shownNotice.tone === "ai" ? (
      <AiMark phase="thinking" size={16} />
    ) : (
      <Rays className="l-wf-notice__rays" />
    )
  ) : shownNotice?.tone === "ai" ? (
    <AiMark size={16} />
  ) : shownNotice?.tone === "ok" ? (
    <Icon.check />
  ) : shownNotice?.tone === "danger" ? (
    <Icon.warn />
  ) : null;

  return (
    <section
      ref={(el) => {
        sizeRef.current = el;
        seenRef.current = el;
      }}
      className={cx("l-wf l-frame", className)}
      data-mode={mode}
      data-narrow={narrow || undefined}
      aria-labelledby={edit ? titleId : undefined}
      aria-label={edit ? undefined : title}
      onKeyDown={onRootKey}
    >
      {edit && (
        <header className="l-frame-strip l-wf-top">
          <div className="l-wf-id">
            <span className="l-wf-mark" aria-hidden>
              <Icon.flow />
            </span>
            <b className="l-wf-name" id={titleId}>
              {title}
            </b>
            <span className="l-wf-badge" data-live={live || undefined} key={live ? "live" : "draft"}>
              {live ? "Live" : "Draft"}
            </span>
            <span className="l-wf-saved l-num" key={publishing ? "p" : saving ? "s" : live ? `l${ver}` : `d${ver}`}>
              {publishing ? "Publishing" : saving ? "Saving" : live ? `Version ${ver}` : `Version ${ver} · saved`}
            </span>
          </div>
          <div className="l-wf-acts">
            {!narrow && people.length > 0 && <AvatarGroup people={people} size={26} max={3} className="l-wf-people" />}
            <Button size="sm" variant="secondary" icon={running ? <Icon.stop /> : <Icon.play />} iconOnly={tiny} aria-label={tiny ? (running ? "Stop the test" : "Test run") : undefined} onClick={test}>
              {tiny ? undefined : running ? "Stop" : "Test run"}
            </Button>
            <Button size="sm" variant="accent" icon={live ? <Icon.check /> : <Icon.publish />} loading={publishing} disabled={live} onClick={publish}>
              {live ? "Published" : "Publish"}
            </Button>
          </div>
        </header>
      )}
      <div className="l-wf-body">
        <div className="l-frame-card l-wf-stage">
          <Canvas
            steps={steps}
            layout={layout}
            mode={mode}
            selected={selected}
            run={{ ...testing, active: running }}
            insets={{ top: 12, bottom: !edit ? 12 : sheetH ? sheetH + 18 : 64 }}
            onSelect={select}
            onOpen={open}
            onRemove={remove}
            onAdd={onAdd}
            onUserMove={() => picker && setPicker(null)}
            api={canvas}
          >
            {shownNotice && (
              <div className="l-wf-notice l-glass" data-wf-hit="" data-tone={shownNotice.tone} data-out={noticeOut || undefined} key={shownNotice.id}>
                {noticeIcon && <span className="l-wf-notice__icon">{noticeIcon}</span>}
                <span className="l-wf-notice__text">{shownNotice.busy ? <TextShimmer>{shownNotice.text}</TextShimmer> : shownNotice.text}</span>
                {shownNotice.action && (
                  <button
                    type="button"
                    className="l-wf-notice__act l-focus"
                    onClick={() => {
                      shownNotice.action?.run();
                      setNotice(null);
                    }}
                  >
                    {shownNotice.action.label}
                  </button>
                )}
              </div>
            )}
            {edit && asker && (
              <form
                className="l-wf-ask l-glass"
                data-wf-hit=""
                data-busy={thinking || undefined}
                data-filled={!!askText.trim() || undefined}
                onSubmit={(e) => {
                  e.preventDefault();
                  submit();
                }}
              >
                <AiMark phase={thinking ? "thinking" : "idle"} size={18} />
                <input className="l-wf-ask__input" value={askText} readOnly={thinking} onChange={(e) => setAskText(e.target.value)} placeholder="Ask for a change" aria-label="Ask for a change to this workflow" enterKeyHint="send" />
                <button type="submit" className="l-wf-ask__send l-focus" aria-label="Send" disabled={!askText.trim() || thinking}>
                  <Icon.up />
                </button>
              </form>
            )}
            {picker && (
              <StepPicker
                key={`${picker.at.list}:${picker.at.index}`}
                templates={templates}
                title={picker.title}
                x={picker.x}
                y={picker.y}
                side={picker.side}
                origin={picker.origin}
                max={picker.max}
                onPick={pick}
                onClose={closePicker}
              />
            )}
            {sheetStep && (
              <div
                ref={(el) => {
                  side.current = el;
                }}
                className="l-wf-sheet l-frame l-frame-float"
                data-wf-hit=""
                data-out={sheetOut || undefined}
                role="dialog"
                aria-label={`${sheetStep.title} settings`}
                onKeyDown={onSideKey}
              >
                <div className="l-frame-card l-wf-sheet__card">{inspector(() => setSheet(false), sheetStep)}</div>
              </div>
            )}
          </Canvas>
        </div>
        {edit && !narrow && (
          <aside
            ref={(el) => {
              side.current = el;
            }}
            className="l-frame-card l-wf-side"
            aria-label="Step settings"
            onKeyDown={onSideKey}
          >
            {inspector()}
          </aside>
        )}
      </div>
      <p className="l-sr-only" role="status">
        {notice?.text ?? ""}
      </p>
    </section>
  );
}
