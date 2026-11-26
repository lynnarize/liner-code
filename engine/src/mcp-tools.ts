/*
  Liner MCP's tools, one table for both doors: the stdio server terminal agents start (outside.ts) and the app listener
  apps on the internet reach (mcp-http.ts). Each tool carries the least level an app needs for it (contracts MCP_TOOL_LEVELS),
  and the engine checks it on every call (mcp-apps.ts McpGate), whatever list the app was shown. It imports nothing from the
  engine, so the stdio server, which runs on its own, can share it.
*/
import { MCP_ASKED_TOOLS, MCP_TOOL_LEVELS, mcpLevelAtLeast, type McpLevel } from "../../contracts/src/mcp.ts";

type Prop = { type: string; description: string };
export type ToolSchema = { type: "object"; properties: Record<string, Prop>; required?: string[] };
export type McpToolDef = { name: string; description: string; inputSchema: ToolSchema; level: McpLevel; asks: boolean };

const s = (properties: Record<string, Prop>, required?: string[]): ToolSchema => ({ type: "object", properties, ...(required ? { required } : {}) });
const cursor = { type: "string", description: "Where the last page ended (its next cursor); the first page when left out" };
const project = { type: "string", description: "A project's id, name or folder" };

const DEFS: Omit<McpToolDef, "level" | "asks">[] = [
  { name: "liner_projects", description: "The projects in Liner Code: id, name and folder.", inputSchema: s({}) },
  { name: "liner_sessions", description: "Recent Liner Code sessions, newest first: id, title, project and status (running, waiting on the person, done). Twenty a page.", inputSchema: s({ project: { ...project, description: "A project's id, name or folder; all when left out" }, limit: { type: "number", description: "How many, up to 50" }, cursor }) },
  { name: "liner_read", description: "A session's last turns: what the person asked, what the agent answered and did, what changed, what the Reviewer found, and anything waiting on the person.", inputSchema: s({ session: { type: "string", description: "The session's id" }, turns: { type: "number", description: "How many turns back, up to 10" } }, ["session"]) },
  { name: "liner_pull_requests", description: "Open pull requests across the person's projects (or one): number, title, author, checks. Twenty a page.", inputSchema: s({ project: { ...project, description: "A project's id, name or folder; all when left out" }, state: { type: "string", description: "open (the default), closed, merged or all" }, cursor }) },
  { name: "liner_issues", description: "Open issues across the person's projects (or one), from GitHub or Linear: key, title, labels. Twenty a page.", inputSchema: s({ project: { ...project, description: "A project's id, name or folder; all when left out" }, state: { type: "string", description: "open (the default), closed or all" }, cursor }) },
  { name: "liner_findings", description: "Open security findings Liner Security keeps for a project: severity, title, file. Twenty a page.", inputSchema: s({ project: { ...project, description: "A project's id, name or folder; all when left out" }, pr: { type: "number", description: "Only what a scan of this pull request found" }, issue: { type: "string", description: "Only what a scan of this issue found, by its key (#42, LIN-12)" }, cursor }) },
  { name: "liner_start", description: "Starts a session in a project with a message, on the project's usual agent unless you name one. What it asks waits for the person in Liner Code.", inputSchema: s({ project, message: { type: "string", description: "What the session should do" }, agent: { type: "string", description: "An agent's id, or provider:model like codex:gpt-6-luna" }, clientRequestId: { type: "string", description: "Your own id for this start: the same id again returns the session already started instead of a second one" } }, ["project", "message"]) },
  { name: "liner_send", description: "Sends a message to a session; while it works, the message waits for its turn to end.", inputSchema: s({ session: { type: "string", description: "The session's id" }, message: { type: "string", description: "The message" } }, ["session", "message"]) },
  { name: "liner_wait", description: "Waits for a session to stop working, then reads its last turn. Returns within a minute; when it says it's still working, call it again.", inputSchema: s({ session: { type: "string", description: "The session's id" }, seconds: { type: "number", description: "How long to wait at most, default 50, up to 55 (240 on this Mac)" } }, ["session"]) },
  { name: "liner_answer", description: "Answers a question a session asked the person (never a permission ask: those stay the person's).", inputSchema: s({ session: { type: "string", description: "The session's id" }, answer: { type: "string", description: "The answer: one of the question's options, or your own words" } }, ["session", "answer"]) },
  { name: "liner_scan", description: "Starts a read only Liner Security scan of a pull request or an issue. liner_findings reads what it found once it's done.", inputSchema: s({ project, pr: { type: "number", description: "The pull request's number" }, issue: { type: "string", description: "Or the issue's key (#42, LIN-12)" } }, ["project"]) },
  { name: "liner_stop", description: "Stops a session's turn while it works.", inputSchema: s({ session: { type: "string", description: "The session's id" } }, ["session"]) },
];

export const MCP_TOOLS: McpToolDef[] = DEFS.map((d) => ({ ...d, level: MCP_TOOL_LEVELS[d.name] ?? "trusted", asks: MCP_ASKED_TOOLS.includes(d.name) }));

export const toolDef = (name: string) => MCP_TOOLS.find((t) => t.name === name);

/** What an app at `level` is shown in tools/list: only what it may call, as MCP lists a tool (name, description, schema). */
export function toolsFor(level: McpLevel) {
  return MCP_TOOLS.filter((t) => mcpLevelAtLeast(level, t.level)).map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

export const SERVER_INSTRUCTIONS = "The person's Liner Code sessions. Read what a session did before you redo it; start or message one to hand work to Liner Code's agents, then wait for it and read what it did. What a session asks waits for the person in Liner Code.";
