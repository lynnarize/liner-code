/*
  The sample: Halcyon's support team handing refund requests to a workflow. Small refunds
  go straight back to the card; the rest wait for Priya. Also the step menu, a simulated
  test run that plays two real-feeling requests in turn, and a simulated assistant that
  understands a few kinds of change. Swap any of them for your own.
*/
import {
  fieldOf,
  fieldText,
  findStep,
  flat,
  fromTemplate,
  insertAt,
  removeStep,
  ROOT,
  setField,
  type InsertAt,
  type WorkflowAsk,
  type WorkflowRunner,
  type WorkflowRunRecord,
  type WorkflowStats,
  type WorkflowStep,
  type WorkflowTemplate,
} from "./model";

const people = [
  { value: "priya", label: "Priya, support lead" },
  { value: "jonas", label: "Jonas, billing" },
  { value: "ines", label: "Ines, founder" },
];

export const sampleTemplates: WorkflowTemplate[] = [
  {
    type: "read",
    kind: "ai",
    group: "AI",
    name: "Read",
    hint: "Pull the details out of a message or a file",
    label: "AI · Read",
    title: "Read the message",
    summary: "Reads {reads}",
    fields: [
      { id: "prompt", label: "Instructions", type: "longtext", value: "Find what they are asking for and anything that identifies the order." },
      { id: "reads", label: "Reads", type: "list", noun: "field", value: [{ name: "topic", type: "text" }] },
    ],
  },
  {
    type: "write",
    kind: "ai",
    group: "AI",
    name: "Write",
    hint: "Draft a reply or a note in your voice",
    label: "AI · Write",
    title: "Write a reply",
    summary: "{tone}, signed by {sign}",
    fields: [
      {
        id: "tone",
        label: "Tone",
        type: "choice",
        value: "warm",
        options: [
          { value: "warm", label: "Warm" },
          { value: "brief", label: "Brief" },
          { value: "formal", label: "Formal" },
        ],
      },
      { id: "sign", label: "Signed by", type: "text", value: "The Halcyon team" },
    ],
  },
  {
    type: "summarize",
    kind: "ai",
    group: "AI",
    name: "Summarize",
    hint: "Boil it down to a few lines",
    label: "AI · Summarize",
    title: "Sum it up",
    summary: "{length}",
    fields: [
      {
        id: "length",
        label: "Length",
        type: "choice",
        value: "three",
        options: [
          { value: "one", label: "One line" },
          { value: "three", label: "Three lines" },
          { value: "points", label: "Bullet points" },
        ],
      },
    ],
  },
  {
    type: "if",
    kind: "branch",
    group: "Logic",
    name: "If",
    hint: "Split the line into paths",
    label: "If",
    title: "Check a rule",
    summary: "{rule}",
    glyph: "branch",
    fields: [{ id: "rule", label: "Rule", type: "text", value: "The amount is under $100", placeholder: "Describe the rule" }],
    paths: ["Yes", "Otherwise"],
  },
  {
    type: "wait",
    kind: "wait",
    group: "Logic",
    name: "Wait",
    hint: "Pause before the next step",
    label: "Wait",
    title: "Give it a moment",
    summary: "For {for}",
    glyph: "clock",
    fields: [
      {
        id: "for",
        label: "Wait for",
        type: "choice",
        value: "1h",
        options: [
          { value: "15m", label: "15 minutes" },
          { value: "1h", label: "1 hour" },
          { value: "1d", label: "1 day" },
        ],
      },
    ],
  },
  {
    type: "email",
    kind: "action",
    group: "Actions",
    name: "Send an email",
    hint: "From a shared address",
    label: "Action · Email",
    title: "Send an email",
    summary: "From {from}",
    glyph: "mail",
    fields: [
      { id: "from", label: "Send from", type: "text", value: "support@halcyon.app" },
      { id: "subject", label: "Subject", type: "text", value: "About your request" },
    ],
  },
  {
    type: "post",
    kind: "action",
    group: "Actions",
    name: "Post a message",
    hint: "To one of your team's channels",
    label: "Action · Message",
    title: "Tell the team",
    summary: "In {channel}",
    glyph: "chat",
    fields: [
      {
        id: "channel",
        label: "Channel",
        type: "select",
        value: "support",
        options: [
          { value: "support", label: "#support" },
          { value: "billing", label: "#billing" },
          { value: "general", label: "#general" },
        ],
      },
    ],
  },
  {
    type: "refund",
    kind: "action",
    group: "Actions",
    name: "Refund a charge",
    hint: "Back to the card that paid",
    label: "Action · Payments",
    title: "Refund the charge",
    summary: "{amount} to the card used",
    glyph: "refund",
    fields: [
      {
        id: "amount",
        label: "Refund",
        type: "choice",
        value: "full",
        options: [
          { value: "full", label: "Full amount" },
          { value: "half", label: "Half" },
        ],
      },
      { id: "cancel", label: "Cancel the subscription too", type: "toggle", value: false },
    ],
  },
  {
    type: "record",
    kind: "action",
    group: "Actions",
    name: "Update a record",
    hint: "Change a row in your database",
    label: "Action · Records",
    title: "Update the customer",
    summary: "In {table}",
    glyph: "record",
    fields: [
      {
        id: "table",
        label: "Table",
        type: "select",
        value: "customers",
        options: [
          { value: "customers", label: "Customers" },
          { value: "orders", label: "Orders" },
          { value: "tickets", label: "Tickets" },
        ],
      },
    ],
  },
  {
    type: "webhook",
    kind: "action",
    group: "Actions",
    name: "Call a webhook",
    hint: "Send the details to any address",
    label: "Action · Webhook",
    title: "Call a webhook",
    summary: "{method} to {url}",
    glyph: "code",
    fields: [
      {
        id: "method",
        label: "Method",
        type: "choice",
        value: "post",
        options: [
          { value: "post", label: "POST" },
          { value: "put", label: "PUT" },
        ],
      },
      { id: "url", label: "Address", type: "text", value: "api.halcyon.app/hooks", placeholder: "https://" },
    ],
  },
  {
    type: "approval",
    kind: "person",
    group: "People",
    name: "Ask for approval",
    hint: "Someone says yes or no first",
    label: "Ask a person",
    title: "Get a yes",
    summary: "{who} · within {within}",
    glyph: "person",
    fields: [
      { id: "who", label: "Who", type: "select", value: "priya", options: people },
      {
        id: "within",
        label: "Answer within",
        type: "choice",
        value: "4h",
        options: [
          { value: "1h", label: "1 hour" },
          { value: "4h", label: "4 hours" },
          { value: "1d", label: "1 day" },
        ],
      },
      { id: "remind", label: "Remind them halfway", type: "toggle", value: true },
    ],
  },
  {
    type: "task",
    kind: "person",
    group: "People",
    name: "Assign a task",
    hint: "Someone does it by hand",
    label: "Ask a person",
    title: "Hand it to someone",
    summary: "{who} · due {due}",
    glyph: "task",
    fields: [
      { id: "who", label: "Who", type: "select", value: "jonas", options: people },
      {
        id: "due",
        label: "Due",
        type: "choice",
        value: "today",
        options: [
          { value: "today", label: "today" },
          { value: "tomorrow", label: "tomorrow" },
          { value: "week", label: "this week" },
        ],
      },
    ],
  },
];

export const sampleSteps: WorkflowStep[] = [
  {
    id: "request",
    kind: "trigger",
    type: "form",
    glyph: "form",
    label: "Trigger · Help center",
    title: "A refund is requested",
    summary: "{form} · {plans}",
    fields: [
      {
        id: "form",
        label: "Form",
        type: "select",
        value: "refund",
        options: [
          { value: "refund", label: "Refund form" },
          { value: "contact", label: "Contact form" },
          { value: "cancel", label: "Cancel form" },
        ],
      },
      { id: "plans", label: "Paid plans only", type: "toggle", value: true, on: "paid plans only", off: "every plan", hint: "Free plans have nothing to refund." },
    ],
    stats: { runs: 214, ok: 100, seconds: 0.2, week: [28, 34, 31, 36, 39, 22, 24] },
  },
  {
    id: "read",
    kind: "ai",
    type: "read",
    label: "AI · Read",
    title: "Understand the request",
    summary: "Reads {reads} · {model}",
    fields: [
      {
        id: "model",
        label: "Model",
        type: "select",
        value: "swift",
        options: [
          { value: "swift", label: "Swift", hint: "Quick and light, about $0.002 a run" },
          { value: "deep", label: "Deep", hint: "Careful with long threads, about $0.01 a run" },
        ],
      },
      {
        id: "prompt",
        label: "Instructions",
        type: "longtext",
        value: "Find the order, how much they paid and why they want it back. Note whether they have had a refund before. Leave a field empty when the message doesn't say.",
      },
      {
        id: "reads",
        label: "Reads",
        type: "list",
        noun: "field",
        value: [
          { name: "order_id", type: "text" },
          { name: "amount", type: "money" },
          { name: "reason", type: "text" },
          { name: "first_refund", type: "yes or no" },
        ],
      },
    ],
    stats: { runs: 214, ok: 98.6, seconds: 1.3, week: [28, 34, 31, 36, 39, 22, 24] },
  },
  {
    id: "check",
    kind: "branch",
    type: "if",
    glyph: "branch",
    label: "If",
    title: "Can we refund it now?",
    summary: "Under {limit}, {first}",
    fields: [
      { id: "limit", label: "Refund right away under", type: "range", value: 200, min: 50, max: 500, step: 10, prefix: "$" },
      { id: "first", label: "First refunds only", type: "toggle", value: true, on: "first refund", off: "any refund", hint: "Anyone asking again goes to a person." },
    ],
    paths: [
      {
        id: "yes",
        label: "Yes",
        share: 68,
        steps: [
          {
            id: "refund",
            kind: "action",
            type: "refund",
            glyph: "refund",
            label: "Action · Payments",
            title: "Refund the charge",
            summary: "{amount} to the card used",
            fields: [
              {
                id: "amount",
                label: "Refund",
                type: "choice",
                value: "full",
                options: [
                  { value: "full", label: "Full amount" },
                  { value: "half", label: "Half" },
                ],
              },
              { id: "cancel", label: "Cancel the subscription too", type: "toggle", value: false },
            ],
            stats: { runs: 146, ok: 99.3, seconds: 0.9, week: [19, 24, 21, 25, 27, 14, 16] },
          },
        ],
      },
      {
        id: "no",
        label: "Otherwise",
        share: 32,
        steps: [
          {
            id: "review",
            kind: "person",
            type: "approval",
            glyph: "person",
            label: "Ask a person",
            title: "Priya decides",
            summary: "{who} · within {within}",
            fields: [
              { id: "who", label: "Who", type: "select", value: "priya", options: people },
              {
                id: "within",
                label: "Answer within",
                type: "choice",
                value: "4h",
                options: [
                  { value: "1h", label: "1 hour" },
                  { value: "4h", label: "4 hours" },
                  { value: "1d", label: "1 day" },
                ],
              },
              { id: "remind", label: "Remind them halfway", type: "toggle", value: true },
            ],
            stats: { runs: 68, ok: 100, seconds: 5820, week: [9, 10, 10, 11, 12, 8, 8] },
          },
        ],
      },
    ],
    stats: { runs: 214, ok: 100, seconds: 0.1, week: [28, 34, 31, 36, 39, 22, 24] },
  },
  {
    id: "reply",
    kind: "ai",
    type: "write",
    label: "AI · Write",
    title: "Reply to the customer",
    summary: "{tone}, signed by {sign}",
    fields: [
      {
        id: "tone",
        label: "Tone",
        type: "choice",
        value: "warm",
        options: [
          { value: "warm", label: "Warm" },
          { value: "brief", label: "Brief" },
          { value: "formal", label: "Formal" },
        ],
      },
      { id: "sign", label: "Signed by", type: "text", value: "Priya" },
      { id: "hold", label: "Let me read it first", type: "toggle", value: false, hint: "Replies wait in your inbox until you send them." },
    ],
    stats: { runs: 214, ok: 99.5, seconds: 1.6, week: [28, 34, 31, 36, 39, 22, 24] },
  },
];

export const sampleStats: WorkflowStats = { runs: 214, ok: 99.1, seconds: 3.2, week: [28, 34, 31, 36, 39, 22, 24] };

export const sampleRuns: WorkflowRunRecord[] = [
  { id: "r1", title: "Lena Ortiz, $36", path: "Yes", seconds: 3.4, when: "09:12", ok: true },
  { id: "r2", title: "Omar Haddad, $410", path: "Otherwise", seconds: 6720, when: "08:47", ok: true },
  { id: "r3", title: "Sun Wei, $18", path: "Yes", seconds: 2.9, when: "08:30", ok: true },
];

export const samplePeople = [{ name: "Priya Raman" }, { name: "Jonas Berg" }];

const num = (s: WorkflowStep, id: string) => {
  const f = fieldOf(s, id);
  return f?.type === "range" ? f.value : undefined;
};
const yes = (s: WorkflowStep, id: string) => {
  const f = fieldOf(s, id);
  return f?.type === "toggle" ? f.value : undefined;
};

/** How runs split at the sample's rule: about 68% of requests are under $200 and a first refund. */
export function sampleEstimate(step: WorkflowStep): number[] | undefined {
  const limit = num(step, "limit");
  if (limit === undefined || step.paths?.length !== 2) return;
  const share = Math.round(Math.min(96, 90 * (1 - Math.exp(-limit / 140)) * (yes(step, "first") === false ? 1.12 : 1)));
  return [share, 100 - share];
}

/* ---------- A simulated test run ---------- */

type Case = { name: string; first: string; email: string; plan: string; amount: number; again: boolean; reason: string; order: string };
const cases: Case[] = [
  { name: "Maya Lin", first: "Maya", email: "maya@lumen.studio", plan: "Team", amount: 48, again: false, reason: "Charged twice in October", order: "HC-20931" },
  { name: "Kofi Mensah", first: "Kofi", email: "kofi@ashgrove.co", plan: "Business", amount: 240, again: true, reason: "Paid for seats nobody used", order: "HC-20977" },
];

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("Stopped", "AbortError"));
    const t = window.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(t);
        reject(new DOMException("Stopped", "AbortError"));
      },
      { once: true },
    );
  });

/** Does the sample's rule let this case straight through? */
const passes = (s: WorkflowStep, c: Case) => c.amount < (num(s, "limit") ?? 0) && !(yes(s, "first") !== false && c.again);

type Beat = { ms: number; running: string; done: string; output?: Record<string, string> };

/** What each kind of step says while it works and when it is done, for one case. */
function beat(s: WorkflowStep, c: Case, ctx: { yes: boolean }): Beat {
  const money = `$${c.amount}.00`;
  const whoField = fieldOf(s, "who");
  const who = (whoField ? fieldText(whoField) : "Priya").split(",")[0];
  switch (s.type) {
    case "form":
      return { ms: 650, running: "Receiving the request", done: `From ${c.name}, ${c.plan} plan`, output: { from: c.email, plan: c.plan, message: `“${c.reason}.”` } };
    case "read": {
      const reads = fieldOf(s, "reads");
      const n = reads?.type === "list" ? reads.value.length : 4;
      return { ms: 1500, running: "Reading the message", done: `Read ${n} ${n === 1 ? "field" : "fields"}`, output: { order_id: c.order, amount: money, reason: c.reason, first_refund: c.again ? "no" : "yes" } };
    }
    case "if": {
      const limit = num(s, "limit");
      const done =
        limit === undefined ? "Checked the rule" : c.amount >= limit ? `$${c.amount} is over $${limit}` : c.again && yes(s, "first") !== false ? "Not a first refund" : `$${c.amount} is under $${limit}`;
      return { ms: 550, running: "Checking the rule", done };
    }
    case "refund":
      return { ms: 1000, running: `Refunding ${money}`, done: `Refunded ${money}`, output: { refund: `re_${c.order.slice(3)}`, amount: money, arrives: "In 5 to 10 days" } };
    case "approval":
      return { ms: 1900, running: `Waiting for ${who}`, done: `${who} said yes`, output: { decision: "Approved", note: "Fine this once, they moved plans." } };
    case "task":
      return { ms: 1200, running: `Handing it to ${who}`, done: "Done by hand" };
    case "write":
      return { ms: 1600, running: "Writing the reply", done: "Sent, 74 words", output: { to: c.email, subject: ctx.yes ? "Your refund is on its way" : "About your refund" } };
    case "summarize":
      return { ms: 1000, running: "Summing it up", done: "Three lines" };
    case "wait":
      return { ms: 500, running: "Waiting", done: "Skipped in a test" };
    case "email":
      return { ms: 800, running: "Sending", done: `Sent to ${c.email}` };
    case "post":
      return { ms: 700, running: "Posting", done: "Posted" };
    default:
      return { ms: 800, running: "Working", done: "Done" };
  }
}

/** Plays the sample's two requests in turn: Maya's small one goes straight through, Kofi's waits for a person. */
export function simulatedRunner(): WorkflowRunner {
  let n = 0;
  return async (steps, emit, signal) => {
    const c = cases[n++ % cases.length];
    const t0 = performance.now();
    emit({ type: "status", text: `Testing with ${c.first}'s $${c.amount} request` });
    const ctx = { yes: true };
    let took = "";
    const walk = async (list: WorkflowStep[]) => {
      for (const s of list) {
        const b = beat(s, c, ctx);
        emit({ type: "step", id: s.id, state: "running", note: b.running });
        const t = performance.now();
        await sleep(b.ms, signal);
        const seconds = (performance.now() - t) / 1000;
        emit({ type: "step", id: s.id, state: "done", note: b.done, seconds, output: b.output });
        if (s.paths?.length) {
          const path = s.type === "if" && num(s, "limit") !== undefined ? s.paths[passes(s, c) ? 0 : Math.min(1, s.paths.length - 1)] : s.paths[0];
          ctx.yes = path === s.paths[0];
          took ||= path.label;
          emit({ type: "path", branch: s.id, path: path.id });
          await walk(path.steps);
        }
      }
    };
    await walk(steps);
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    return { text: `Passed in ${secs}s. ${c.first}'s request ${took ? `took the ${took} path` : "ran every step"}.` };
  };
}

/* ---------- A simulated assistant ---------- */

const STOP = new Set(["the", "a", "an", "to", "it", "step", "and", "of", "for", "with", "this", "that", "please"]);
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));

/** The step whose name shares the most words with what was said. */
function named(steps: WorkflowStep[], q: string) {
  const want = words(q);
  let best: ReturnType<typeof flat>[number] | null = null;
  let score = 0;
  for (const p of flat(steps)) {
    const have = words(`${p.step.title} ${p.step.label}`);
    const s = want.filter((w) => have.some((h) => h.startsWith(w) || w.startsWith(h))).length;
    if (s > score) {
      score = s;
      best = p;
    }
  }
  return best;
}

/** Understands adding a wait, an approval, a message, an email or a summary, and removing a step. */
export const simulatedAsk: WorkflowAsk = async (text, { steps, selected, templates }, signal) => {
  await sleep(1100, signal);
  const t = text.toLowerCase().trim().replace(/[.!?]+$/, "");
  const help = "I can add a wait, an approval, a message, an email or a summary, or remove a step. Try “wait an hour before the reply”.";

  const rm = t.match(/^(?:please\s+)?(?:remove|delete|drop|take out|get rid of)\s+(.+)$/);
  if (rm) {
    const hit = named(steps, rm[1]);
    if (!hit) return { note: `I couldn't find a step like “${rm[1]}”.` };
    if (hit.step.kind === "trigger") return { note: "The trigger starts the workflow, so it has to stay." };
    return { steps: removeStep(steps, hit.step.id), note: `Removed “${hit.step.title}”.` };
  }

  const type = /\b(wait|delay|pause|hold off)\b/.test(t)
    ? "wait"
    : /(approv|review|sign.?off|check with|ask (?:a person|someone)|ok from)/.test(t)
      ? "approval"
      : /(post|notify|tell|message|channel|ping|slack)/.test(t)
        ? "post"
        : /(e-?mail|mail)/.test(t)
          ? "email"
          : /summar/.test(t)
            ? "summarize"
            : null;
  const tpl = type && templates.find((x) => x.type === type);
  if (!tpl) return { note: help };
  let step = fromTemplate(tpl);
  if (type === "wait") {
    const unit = /day/.test(t) ? "1d" : /min/.test(t) ? "15m" : "1h";
    step = { ...setField(step, "for", unit), title: unit === "1d" ? "Wait a day" : unit === "15m" ? "Wait a few minutes" : "Wait an hour" };
  }
  if (type === "approval") {
    const who = ["priya", "jonas", "ines"].find((p) => t.includes(p));
    if (who) step = { ...setField(step, "who", who), title: `${who[0].toUpperCase()}${who.slice(1)} decides` };
  }
  if (type === "post") {
    const ch = ["billing", "general"].find((c) => t.includes(c));
    if (ch) step = setField(step, "channel", ch);
  }

  // Where: "before …" or "after …" a step, else after the one picked, else at the end.
  const where = t.match(/\b(before|after)\s+(.+)$/);
  const anchor = where ? named(steps, where[2]) : selected ? findStep(steps, selected) : null;
  let at: InsertAt = { list: ROOT, index: steps.length };
  let said = "at the end";
  if (anchor) {
    const before = where?.[1] === "before";
    at = { list: anchor.list, index: anchor.index + (before ? 0 : 1) };
    said = `${before ? "before" : "after"} “${anchor.step.title}”`;
  }
  if (at.list === ROOT && at.index === 0) {
    at = { list: ROOT, index: 1 };
    said = `after “${steps[0]?.title}”`;
  }
  return { steps: insertAt(steps, at, step), note: `Added “${step.title}” ${said}.`, select: step.id };
};
