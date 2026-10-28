/*
  The workflow as data: steps on one line, and branches whose paths are lines of their own
  that meet again below. Pure helpers find, insert, remove and update steps without
  touching the original, and read a step's one-line summary from its settings.
*/
import type { ReactNode } from "react";

export type WorkflowStepKind = "trigger" | "ai" | "branch" | "wait" | "action" | "person";

export type GlyphName = "form" | "bolt" | "mail" | "clock" | "branch" | "person" | "refund" | "send" | "chat" | "record" | "code" | "task" | "doc";

type FieldBase = { id: string; label: string; hint?: string };
export type WorkflowField =
  | (FieldBase & { type: "text"; value: string; placeholder?: string })
  | (FieldBase & { type: "longtext"; value: string })
  | (FieldBase & { type: "select"; value: string; options: { value: string; label: string; hint?: string }[] })
  | (FieldBase & { type: "choice"; value: string; options: { value: string; label: string }[] })
  /** `on` and `off` are what the summary says for each state: "paid plans only". */
  | (FieldBase & { type: "toggle"; value: boolean; on?: string; off?: string })
  | (FieldBase & { type: "range"; value: number; min: number; max: number; step?: number; prefix?: string; suffix?: string })
  /** Named values a step reads or keeps, like the fields an AI step pulls out of a message. */
  | (FieldBase & { type: "list"; value: { name: string; type: string }[]; noun?: string });

export type WorkflowFieldValue = WorkflowField["value"];

export type WorkflowPath = {
  id: string;
  label: string;
  /** Share of runs that take this path, 0 to 100. */
  share?: number;
  steps: WorkflowStep[];
};

export type WorkflowStats = {
  runs: number;
  /** Percent that passed. */
  ok: number;
  /** Average time, in seconds. */
  seconds: number;
  /** Runs per day, oldest first. */
  week?: number[];
};

export type WorkflowStep = {
  id: string;
  kind: WorkflowStepKind;
  /** The template it came from, like "read" or "refund". */
  type?: string;
  /** The quiet line above the title: what kind of step it is. "AI · Read" */
  label: string;
  /** Its name, yours to change. */
  title: string;
  /** One line under the title, read from the settings: "Reads {reads} · {model}". */
  summary?: string;
  glyph?: GlyphName;
  /** Your own glyph, in place of the built-in ones. */
  icon?: ReactNode;
  fields?: WorkflowField[];
  /** A branch's paths. Each is a line of steps; they meet again after the branch. */
  paths?: WorkflowPath[];
  stats?: WorkflowStats;
};

/** What the add menu offers. Picking one makes a step from it. */
export type WorkflowTemplate = {
  type: string;
  kind: WorkflowStepKind;
  /** Heading it sits under in the menu: AI, Logic, Actions, People. */
  group: string;
  /** Its name in the menu. */
  name: string;
  hint?: string;
  label: string;
  title: string;
  summary?: string;
  glyph?: GlyphName;
  fields?: WorkflowField[];
  /** A branch's paths, by label. */
  paths?: string[];
};

/** Where a new step goes: a list ("root" or a path's id) and the index in it. */
export type InsertAt = { list: string; index: number };

/** What a test run reports as it goes. */
export type WorkflowRunEvent =
  | { type: "status"; text: string }
  | { type: "step"; id: string; state: "running" | "done" | "failed"; note?: string; seconds?: number; output?: Record<string, string> }
  /** A branch chose a path; the others are skipped. */
  | { type: "path"; branch: string; path: string };

/** Runs the steps on a test case. Resolve with what to say at the end; throw to fail it. */
export type WorkflowRunner = (steps: WorkflowStep[], emit: (e: WorkflowRunEvent) => void, signal: AbortSignal) => Promise<{ text?: string } | void>;

/** Turns a request in words into a change. Leave `steps` out to only answer. */
export type WorkflowAsk = (
  text: string,
  context: { steps: WorkflowStep[]; selected: string | null; templates: WorkflowTemplate[] },
  signal: AbortSignal,
) => Promise<{ steps?: WorkflowStep[]; note: string; select?: string }>;

/** One run, for the recent list. */
export type WorkflowRunRecord = { id: string; title: string; path?: string; seconds: number; when: string; ok: boolean; test?: boolean };

export const ROOT = "root";

export type StepPlace = {
  step: WorkflowStep;
  /** The list it is in: "root" or a path's id. */
  list: string;
  index: number;
  siblings: WorkflowStep[];
  /** The path and branch it sits in, when it is inside one. */
  path?: WorkflowPath;
  branch?: WorkflowStep;
};

/** Every step in reading order: down the line, each path in turn before what follows it. */
export function flat(steps: WorkflowStep[], list = ROOT, path?: WorkflowPath, branch?: WorkflowStep, out: StepPlace[] = []) {
  steps.forEach((step, index) => {
    out.push({ step, list, index, siblings: steps, path, branch });
    step.paths?.forEach((p) => flat(p.steps, p.id, p, step, out));
  });
  return out;
}

export const findStep = (steps: WorkflowStep[], id: string) => flat(steps).find((p) => p.step.id === id) ?? null;

export function findPath(steps: WorkflowStep[], id: string): { path: WorkflowPath; branch: WorkflowStep } | null {
  for (const { step } of flat(steps)) {
    const path = step.paths?.find((p) => p.id === id);
    if (path) return { path, branch: step };
  }
  return null;
}

/** Every step inside these, nested paths included. */
export const stepsIn = (steps: WorkflowStep[]) => flat(steps).map((p) => p.step);
/** Every path id inside these steps. */
export const pathsIn = (steps: WorkflowStep[]) => stepsIn(steps).flatMap((s) => s.paths?.map((p) => p.id) ?? []);

/** Rebuilds the tree, letting `fn` change each list (deepest first). The original is left alone. */
export function mapLists(steps: WorkflowStep[], fn: (list: WorkflowStep[], id: string) => WorkflowStep[], id = ROOT): WorkflowStep[] {
  const inner = steps.map((s) => (s.paths ? { ...s, paths: s.paths.map((p) => ({ ...p, steps: mapLists(p.steps, fn, p.id) })) } : s));
  return fn(inner, id);
}

export const insertAt = (steps: WorkflowStep[], at: InsertAt, step: WorkflowStep) =>
  mapLists(steps, (list, id) => (id === at.list ? [...list.slice(0, at.index), step, ...list.slice(at.index)] : list));

export const removeStep = (steps: WorkflowStep[], id: string) => mapLists(steps, (list) => list.filter((s) => s.id !== id));

export const updateStep = (steps: WorkflowStep[], id: string, fn: (step: WorkflowStep) => WorkflowStep) =>
  mapLists(steps, (list) => list.map((s) => (s.id === id ? fn(s) : s)));

export const setField = (step: WorkflowStep, id: string, value: WorkflowFieldValue): WorkflowStep => ({
  ...step,
  fields: step.fields?.map((f) => (f.id === id ? ({ ...f, value } as WorkflowField) : f)),
});

export const fieldOf = (step: WorkflowStep, id: string) => step.fields?.find((f) => f.id === id);

/** A short random id, so new steps never clash with the ones you brought. */
export const newId = (base: string) => `${base}-${Math.random().toString(36).slice(2, 7)}`;

export function fromTemplate(t: WorkflowTemplate): WorkflowStep {
  const step: WorkflowStep = {
    id: newId(t.type),
    kind: t.kind,
    type: t.type,
    label: t.label,
    title: t.title,
    summary: t.summary,
    glyph: t.glyph,
    fields: t.fields?.map((f) => ({ ...f, value: Array.isArray(f.value) ? f.value.map((v) => ({ ...v })) : f.value }) as WorkflowField),
  };
  if (t.kind === "branch") {
    const labels = t.paths?.length ? t.paths : ["Yes", "Otherwise"];
    step.paths = labels.map((label) => ({ id: newId("path"), label, share: Math.round(100 / labels.length), steps: [] }));
  }
  return step;
}

/** A copy with new ids all the way down, so it can sit next to the original. */
export function duplicate(step: WorkflowStep): WorkflowStep {
  return {
    ...step,
    id: newId(step.type ?? step.kind),
    title: `${step.title} (copy)`,
    paths: step.paths?.map((p) => ({ ...p, id: newId("path"), steps: p.steps.map(duplicate) })),
  };
}

/** A field's value as words, the way a summary says it. */
export function fieldText(f: WorkflowField): string {
  switch (f.type) {
    case "text":
    case "longtext":
      return f.value.trim() || "nothing yet";
    case "select":
    case "choice":
      return f.options.find((o) => o.value === f.value)?.label ?? f.value;
    case "toggle":
      return f.value ? (f.on ?? "on") : (f.off ?? "off");
    case "range":
      return `${f.prefix ?? ""}${f.value.toLocaleString("en-US")}${f.suffix ?? ""}`;
    case "list": {
      const n = f.value.length;
      return `${n} ${f.noun ?? "item"}${n === 1 ? "" : "s"}`;
    }
  }
}

/** A summary template split into words and the fields it names. Unknown names stay as written. */
export function summaryParts(step: WorkflowStep): (string | WorkflowField)[] {
  if (!step.summary) return [];
  return step.summary
    .split(/(\{[\w-]+\})/)
    .filter(Boolean)
    .map((part) => {
      const m = part.match(/^\{([\w-]+)\}$/);
      return (m && fieldOf(step, m[1])) || part;
    });
}

export const summaryText = (step: WorkflowStep) =>
  summaryParts(step)
    .map((p) => (typeof p === "string" ? p : fieldText(p)))
    .join("");

/** Seconds as people say them: 0.8s, 12s, 4m, 1h 37m. */
export function formatSeconds(s: number) {
  if (s < 10) return `${s.toFixed(1)}s`;
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}
