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
    description: [
      "Only in a Liner Security scan. Reports one security problem you are sure of, as soon as you are sure: it shows in the person's findings at once, and in the scan's chat. One problem per call; the same problem in two places is one finding with two excerpts.",
      "Title it with one plain sentence about the code (\"The station id goes into the database query as text\"), and give the explanation in parts: lead (one sentence: what someone can do with it), wrong (what is wrong, naming the code), where (code excerpts), who (who can do it and what they need), gets (what they get), see (the steps to see it, which only read or use the app as an ordinary user would: never something you ran).",
      "Rank severity against the threat model and the person's answers: critical, someone outside takes over accounts, data or the server; high, someone gets or changes what is not theirs, at scale; medium, it takes an account or a condition, or reaches one person's data; low, it helps an attack but does little alone.",
      "Write the parts as plain text: code names in `backticks`, a command inside ``` fences on lines of their own, and a list (who needs what) as lines starting with \"- \".",
      "A finding already open is merged, not raised again, and one the person dismissed stays dismissed: the answer says which. Changes no file.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "One plain sentence: what is wrong in the code" },
        severity: { type: "string", enum: SEVERITY, description: "critical, high, medium or low" },
        file: { type: "string", description: "The file it is in, relative to the project's folder" },
        line: { type: "number", description: "The line it starts at" },
        end_line: { type: "number", description: "The line it ends at, when it runs over several" },
        rule: { type: "string", description: "A rule or advisory id when one fits (CWE-639, GHSA-…); optional" },
        area: { type: "string", description: "The threat model's area it falls under: a heading of SECURITY.md, exactly as written" },
        lead: { type: "string", description: "One sentence: what someone can do with it" },
        wrong: { type: "string", description: "What is wrong, naming the functions, routes or values involved" },
        where: { type: "array", items: { type: "object" }, description: "Code excerpts: each { file, start (its first line's number), lines (the lines, as text), hit (the line numbers that matter) }" },
        who: { type: "string", description: "Who can do it, and what they need (an account, a link, nothing)" },
        gets: { type: "string", description: "What they get" },
        see: { type: "array", items: { type: "string" }, description: "Steps to see it, one per item" },
        why: { type: "string", description: "One sentence for the chat on how you ranked it, by the threat model or the person's answers" },
      },
      required: ["title", "severity", "lead", "wrong"],
    },
  },
  {
    name: "security_update_finding",
    description: "Only in a Liner Security scan. Changes a finding this scan reported, by its id: a better title, another severity, more of its explanation, its area. Use it when you learn more; never to report a new problem. Changes no file.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The finding's id, as security_report_finding gave it" },
        title: { type: "string", description: "A better title" },
        severity: { type: "string", enum: SEVERITY, description: "Another severity" },
        area: { type: "string", description: "The threat model's area" },
        lead: { type: "string", description: "One sentence: what someone can do with it" },
        wrong: { type: "string", description: "What is wrong" },
        where: { type: "array", items: { type: "object" }, description: "Code excerpts, as for security_report_finding" },
        who: { type: "string", description: "Who can do it" },
        gets: { type: "string", description: "What they get" },
        see: { type: "array", items: { type: "string" }, description: "Steps to see it" },
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
      "Only in a Liner Security scan, before you read on. Asks the person what the threat model does not say and what would change how you rank a finding (can anyone sign up, may one person see another's data, what is private). At most three questions, all in this one call; don't ask what the code or SECURITY.md already answers, and don't ask at all when nothing would change a ranking.",
      "Each question has two to four answers; the first is your own guess from the code, and guess_reason says in a few words why you guessed it. The person picks one, writes their own, or skips: the scan waits until they do. The answer says what they chose; where they skipped, go by your guess and say so in the finding. Their answers are saved to SECURITY.md, so the next scan doesn't ask again.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        questions: { type: "array", items: { type: "object" }, description: "Up to three: each { question, answers: [your guess first, then the others, each a few words], guess_reason: why you guessed the first, header?: a word or two }" },
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
    description: "Only in a Liner Security scan, last of all. Records how it ended for the person: one sentence that says what this code lets someone do (or that you found nothing worth acting on), what you read, and what you did not get to (and why). Then say the same in your own last message. Changes no file.",
    inputSchema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One sentence: what this lets someone do, or that nothing was found" },
        read: { type: "array", items: { type: "string" }, description: "What you read, a sentence each" },
        missed: { type: "array", items: { type: "string" }, description: "What you did not get to, and why, a sentence each" },
      },
      required: ["summary"],
    },
  },
];
