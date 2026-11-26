/*
  Liner Security's tools, as a scan's agent is told of them (security_report_finding and friends): data only, no imports
  that do anything, because mcp.ts runs on its own and reads this list through liner-tools.ts (canvas-tools.ts says the
  same). security-scan.ts answers them (call, titleOf). Every one of them writes nothing but findings and the scan's
  record, and SECURITY.md only after the person says yes on a card (security_propose_model) or answers a question
  (security_ask appends the answer). They answer only in a session Liner tagged as a scan; the two that only read
  (security_list_findings, security_read_model) also in a fix of a finding or a question about one.

  The descriptions are what the model reads: plain words, what each is for and when to call it.
*/
import type { ToolDef } from "./liner-tools.ts";

const SEVERITY = ["critical", "high", "medium", "low"];
/** The two that only read: a fix of a finding, or a question about one, is offered these; a scan is offered all. */
export const SECURITY_READS = ["security_list_findings", "security_read_model"];

export const TOOLS: ToolDef[] = [
  {
    name: "security_report_finding",
    // Short on purpose (agy drops a tool over about a kilobyte, liner-tools.test.ts): a scan's first message (scanPrompt in
    // security-scan.ts, and security-targets.ts for a pull request or an issue) says how to word the parts and rank severity.
    description:
      "Only in a Liner Security scan. Reports a problem you're sure of, at once, as the scan's message says: lead (what someone can do), wrong, where (excerpts {file, start, lines, hit}), who, gets, see (steps), area (a SECURITY.md heading), why. Plain text: `code`, ``` fences, \"- \" lists. An open finding is merged; a dismissed one stays.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        severity: { type: "string", enum: SEVERITY },
        file: { type: "string" },
        line: { type: "number" },
        end_line: { type: "number" },
        rule: { type: "string" },
        area: { type: "string" },
        lead: { type: "string" },
        wrong: { type: "string" },
        where: { type: "array", items: { type: "object" } },
        who: { type: "string" },
        gets: { type: "string" },
        see: { type: "array", items: { type: "string" } },
        why: { type: "string" },
      },
      required: ["title", "severity", "lead", "wrong"],
    },
  },
  {
    name: "security_update_finding",
    description: "Only in a Liner Security scan. Changes a finding this scan reported, by the id security_report_finding gave: a better title, another severity, more of its parts (as for security_report_finding), its area. Use it when you learn more; never to report a new problem. Changes no file.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        severity: { type: "string", enum: SEVERITY },
        area: { type: "string" },
        lead: { type: "string" },
        wrong: { type: "string" },
        where: { type: "array", items: { type: "object" } },
        who: { type: "string" },
        gets: { type: "string" },
        see: { type: "array", items: { type: "string" } },
      },
      required: ["id"],
    },
  },
  {
    name: "security_list_findings",
    description: "Only in a Liner Security session. What is already known in this project: the open findings (don't report these again unless you found something new about them), the dismissed ones with why (the person decided: don't raise them again), and the fixed ones. Each with its id, severity, file and line. Changes nothing.",
    inputSchema: { type: "object", properties: { state: { type: "string", enum: ["open", "dismissed", "fixed"], description: "Only these; all when left out" } } },
  },
  {
    name: "security_read_model",
    description: "Only in a Liner Security session. The project's threat model (SECURITY.md unless the person named another file): whether it is there, its whole text, and its areas (each heading and the line under it) with what is open in each. Read it first in a scan. Changes nothing.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "security_note_area",
    description: "Only in a Liner Security scan. Says where the scan is, for the person's panel: an area of the threat model you are reading now, have read, or that this scan will not touch (a branch that didn't change it). Call it as you start and finish each area. Changes no file.",
    inputSchema: {
      type: "object",
      properties: {
        area: { type: "string", description: "The area's heading, exactly as SECURITY.md writes it" },
        state: { type: "string", enum: ["reading", "read", "untouched"], description: "reading, read, or untouched (this scan won't read it)" },
      },
      required: ["area", "state"],
    },
  },
  {
    name: "security_ask",
    description: [
      "Only in a Liner Security scan, before you read on. Asks the person what the threat model doesn't say and would change a ranking (can anyone sign up, may one person see another's data). At most three questions, in this one call; none the code or SECURITY.md answers.",
      "Each has two to four answers, your own guess from the code first, with guess_reason. The scan waits while the person picks, writes their own or skips; where they skip, go by your guess and say so. Answers are saved to SECURITY.md.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        questions: { type: "array", items: { type: "object" }, description: "Each { question, answers: [your guess, others], guess_reason, header? }" },
      },
      required: ["questions"],
    },
  },
  {
    name: "security_propose_model",
    description: "Only in a Liner Security scan, and only when the project has no threat model yet. Proposes one for Liner to write as SECURITY.md: a short first paragraph, then one ## heading per area someone could attack (sign-in, the API, saved data, file uploads…), each with one line under it saying what must hold. The person is asked on a card; on their yes Liner writes the file, which is the only file a scan may write. Never write it yourself. Answers whether it was written.",
    inputSchema: { type: "object", properties: { text: { type: "string", description: "The whole file, in Markdown" } }, required: ["text"] },
  },
  {
    name: "security_finish",
    description: "Only in a Liner Security scan, last of all. Records how it ended for the person: what this code lets someone do (or that you found nothing worth acting on), what you read, and what you didn't get to. Then say the same in your last message. Changes no file.",
    inputSchema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "What this lets someone do, or that nothing was found" },
        read: { type: "array", items: { type: "string" }, description: "A sentence each" },
        missed: { type: "array", items: { type: "string" }, description: "A sentence each, with why" },
        verdict: { type: "string", enum: ["real", "not-real", "unsure"], description: "Only when checking an issue: is it real here (unsure: you couldn't tell from reading)" },
        severity: { type: "string", enum: SEVERITY, description: "Only with verdict real" },
      },
      required: ["summary"],
    },
  },
];
