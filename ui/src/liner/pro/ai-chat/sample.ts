/*
  Sample data and a simulated model for the AI chat. Replace `respond` with your API;
  everything here exists so the block plays a believable conversation with no backend.
*/
import type { Source } from "../ai-kit/cite";

export type ChatModel = { id: string; name: string; note: string; effort?: "low" | "medium" | "high" };
export type ChatTool = {
  id: string;
  kind: "search" | "query";
  label: string;
  status: "running" | "done" | "error";
  summary?: string;
  sources?: Source[];
  input?: string;
  output?: string;
};
export type ChatEvent =
  | { type: "reasoning"; step: string }
  | { type: "reasoning-end"; seconds?: number }
  | { type: "tool"; tool: ChatTool }
  | { type: "sources"; sources: Source[] }
  | { type: "text"; delta: string }
  | { type: "error"; message: string };
export type ChatMessage = { role: "user" | "assistant"; content: string };
export type ChatOptions = { signal: AbortSignal; model: ChatModel; effort?: "low" | "medium" | "high"; search?: boolean; think?: boolean };
export type ChatRespond = (messages: ChatMessage[], options: ChatOptions) => AsyncIterable<ChatEvent>;
export type ChatSuggestion = { label: string; prompt?: string; icon: "launch" | "chart" | "pen" };

export const sampleModels: ChatModel[] = [
  { id: "balanced", name: "Balanced", note: "Everyday work", effort: "medium" },
  { id: "deep", name: "Deep", note: "Thinks longer, cites more", effort: "high" },
  { id: "swift", name: "Swift", note: "Fast, short answers", effort: "low" },
];

export const sampleSuggestions: ChatSuggestion[] = [
  { label: "Plan the launch week for Liner UI", icon: "launch" },
  { label: "Estimate signups from 40k visits", icon: "chart" },
  { label: "Write a release note for the Composer", icon: "pen" },
];

const src = {
  changelog: { name: "Changelog", title: "Liner UI 0.2: the Composer and AI blocks", domain: "liner.dev/changelog", snippet: "The Composer tints mentions as you type and turns send into stop while a reply streams.", hue: 220 },
  launch: { name: "Launch notes", title: "How small teams pace a product launch week", domain: "notes.studio", snippet: "Announce on a Tuesday, keep Wednesday for fixes, and save the deep-dive post for Thursday.", hue: 30 },
  forum: { name: "Forum", title: "Thread: what we learned shipping a UI kit", domain: "forum.makers.dev", snippet: "Live demos converted three times better than screenshots on the launch page.", hue: 280 },
  analytics: { name: "Analytics", title: "Visits and signups, last 90 days", domain: "app.analytics.io", snippet: "Visit to signup conversion held between 3.1% and 3.6% across the quarter.", hue: 200 },
  style: { name: "Style guide", title: "Writing release notes people finish", domain: "liner.dev/guide", snippet: "Lead with what changed for the reader, keep one idea per line, and show the thing moving.", hue: 340 },
} satisfies Record<string, Source>;

type Script = { reasoning: string[]; tools?: Array<Omit<ChatTool, "status">>; sources?: Source[]; text: string; fail?: string };

function scriptFor(prompt: string): Script {
  const p = prompt.toLowerCase();
  if (/error|fail|break/.test(p))
    return { reasoning: ["Reading the question", "Calling the model"], text: "", fail: "The model timed out after 30 seconds." };
  if (/launch|week|plan/.test(p))
    return {
      reasoning: ["Reading what is shipping", "Looking at how other small teams launch", "Laying the week out day by day"],
      tools: [{ id: "t1", kind: "search", label: "Searched the web", summary: "3 sources", sources: [src.changelog, src.launch, src.forum] }],
      sources: [src.changelog, src.launch, src.forum],
      text: `Spread it over four days so each piece gets its own moment.\n\n1. **Tuesday, announce.** Lead with the Composer and the AI blocks, since they are what changed [1].\n2. **Wednesday, fix.** Keep the day free for whatever people find on day one [2].\n3. **Thursday, go deep.** Publish the motion write-up with live demos, not screenshots [3].\n4. **Friday, thank.** Share what you learned and the first numbers.\n\nPin the gallery link everywhere: people try a component before they read about it [3].`,
    };
  if (/signup|visit|estimate|40k/.test(p))
    return {
      reasoning: ["Pulling the conversion rate", "Checking it held steady", "Working out a range"],
      tools: [
        {
          id: "t2",
          kind: "query",
          label: "Queried analytics",
          summary: "90 days",
          input: "select avg(signups::float / visits)\nfrom daily_traffic\nwhere day > now() - interval '90 days';",
          output: "0.0334",
        },
      ],
      sources: [src.analytics],
      text: `About **1,340 signups**, likely between 1,240 and 1,440.\n\nConversion held between 3.1% and 3.6% for the last 90 days [1], so:\n\n- **Low:** 40,000 × 3.1% = 1,240\n- **Expected:** 40,000 × 3.34% = 1,336\n- **High:** 40,000 × 3.6% = 1,440\n\nTo track it during launch week:\n\n\`\`\`sql\nselect day, signups::float / visits as rate\nfrom daily_traffic\norder by day desc\nlimit 7;\n\`\`\``,
    };
  if (/release|note|composer|write/.test(p))
    return {
      reasoning: ["Reading the changelog", "Checking the style guide", "Drafting in short lines"],
      tools: [{ id: "t3", kind: "search", label: "Read the docs", summary: "2 pages", sources: [src.changelog, src.style] }],
      sources: [src.changelog, src.style],
      text: `### The Composer\n\nWrite to a teammate or a model in one field [1].\n\n- **Mentions and commands** get a soft tint as you type.\n- **Suggestions** open right at the caret.\n- **Files** drop in with a little gulp and an upload ring.\n- **Send turns into stop** while a reply streams.\n\nOne idea per line, and the demo does the rest [2].`,
    };
  return {
    reasoning: ["Reading the question", "Deciding what matters most"],
    tools: [{ id: "t4", kind: "search", label: "Searched the docs", summary: "1 source", sources: [src.changelog] }],
    sources: [src.changelog],
    text: `Here is the short version for **"${prompt.trim().slice(0, 60)}"**.\n\nStart with the smallest piece that proves it works, then show it moving. The Liner docs pair every component with a live demo and its motion rules for exactly this reason [1].\n\nWant me to turn that into a checklist?`,
  };
}

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((res, rej) => {
    const t = setTimeout(res, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), rej(new DOMException("Aborted", "AbortError"))), { once: true });
  });

/** A simulated model: reasoning, tools, sources, then text in uneven network-sized chunks. */
export const simulatedRespond: ChatRespond = async function* (messages, { signal, model, think }) {
  const prompt = messages[messages.length - 1]?.content ?? "";
  const s = scriptFor(prompt);
  // Think on: one more pass over the answer before writing, and a slower pace.
  if (think && !s.fail) s.reasoning = [...s.reasoning, "Checking the answer once more"];
  const pace = (model.id === "swift" ? 0.6 : model.id === "deep" ? 1.5 : 1) * (think ? 1.25 : 1);
  for (const step of s.reasoning) {
    yield { type: "reasoning", step };
    await wait(520 * pace, signal);
  }
  yield { type: "reasoning-end", seconds: Math.max(1, Math.round((s.reasoning.length * 520 * pace) / 1000)) };
  if (s.fail) {
    await wait(500, signal);
    yield { type: "error", message: s.fail };
    return;
  }
  for (const t of s.tools ?? []) {
    yield { type: "tool", tool: { ...t, status: "running", summary: undefined } };
    await wait(800 * pace, signal);
    yield { type: "tool", tool: { ...t, status: "done" } };
  }
  if (s.sources) yield { type: "sources", sources: s.sources };
  let i = 0;
  while (i < s.text.length) {
    const n = 6 + Math.floor(Math.random() * 30);
    yield { type: "text", delta: s.text.slice(i, i + n) };
    i += n;
    await wait(40 + Math.random() * 50, signal);
  }
};
