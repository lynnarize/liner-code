/**
  Liner MCP: apps outside Liner Code (Grok Bot, Muse, Claude, ChatGPT, a terminal agent) that reach it over MCP, on this
  Mac or from the internet through a tunnel. The engine holds every app to its level on every call (engine/src/mcp-tools.ts).
*/

/**
  What an app may do. `read`: look only (projects, sessions, pull requests, issues, findings). `ask`: also start, send,
  scan and stop, each only after the person allows it on a card in the app. `trusted`: the same without asking; a session it
  starts still never runs at Full access.
*/
export type McpLevel = "read" | "ask" | "trusted";
export const MCP_LEVELS: McpLevel[] = ["read", "ask", "trusted"];
export const MCP_LEVEL_NAMES: Record<McpLevel, string> = { read: "Read only", ask: "Asks first", trusted: "Trusted" };
/** Which app it is, for its logo and the steps to connect it. */
export type McpAppKind = "grokbot" | "muse" | "claude" | "chatgpt" | "terminal" | "other";
export const MCP_KIND_NAMES: Record<McpAppKind, string> = { grokbot: "Grok Bot", muse: "Muse", claude: "Claude", chatgpt: "ChatGPT", terminal: "Terminal agent", other: "Another app" };

/**
  One app let in. `keyEnd`: the last characters of its key (or token), so the person can tell keys apart; the key itself is
  shown once and kept only as a hash. `auth`: a key the person pasted into the app, or an OAuth sign-in the app did itself.
*/
export type McpApp = { id: string; name: string; kind: McpAppKind; level: McpLevel; via: "stdio" | "internet"; createdAt: number; expiresAt: number; lastCallAt?: number; lastTool?: string; keyEnd: string; auth: "key" | "oauth"; /** A terminal agent you turned away (by the name it gives), listed so you can let it in again. */ blocked?: boolean };

/**
  An app at "Asks first" wants to do something: the card in the app (AppAsk.tsx) shows it until the person allows or denies
  it, or ten minutes pass. `message`: what it wants to send, quoted on the card (only ever shown to the person, never logged).
*/
export type McpAsk = { id: string; appId: string; appName: string; appKind: McpAppKind; tool: string; summary: string; project?: string; message?: string; at: number; /** Who runs the session, by name, and its model ref ("claude:claude-sonnet-5-5") for the tool's mark. */ runsOn?: string; runsOnRef?: string; /** What the session may do, in words ("Manual: every change asks you here"). */ access?: string; /** The session it's about (made already for a start, so Open it first shows it). */ threadId?: string };
/** Liner MCP's cards, sent to the app whenever one comes or goes. */
export type McpEvent = { type: "mcp"; asks: McpAsk[]; signIns: McpSignIn[] };

/**
  An app's sign-in (OAuth) waiting for the person to choose what it may do. `clientName` is only what the app calls itself,
  never trusted for a logo or a kind; `expect` is the app you picked in Add an app, which opened the sign-in window;
  `redirectHost` is where the sign-in goes back to, the one thing on the card the app can't make up.
*/
export type McpSignIn = { id: string; clientName: string; expect: McpAppKind; redirectHost: string; at: number };

/** How the app listener is reached from the internet. Never on unless the person picked one. */
export type McpReach = "off" | "tailscale" | "cloudflare" | "own";

/** Settings › Connections › Liner MCP, as the engine reports it. */
export type McpStatus = {
  on: boolean;
  /** The app listener's port on 127.0.0.1 (0 while off). */
  port: number;
  /** The local address apps on this Mac use. */
  localUrl: string;
  /** The command that hands a terminal agent the stdio server. */
  command: string;
  reach: McpReach;
  /** The tunnel or own address, once known: the /mcp URL apps outside this Mac use. */
  publicUrl?: string;
  tunnel: { state: "off" | "starting" | "up" | "down"; note?: string; found?: { tailscale: boolean; cloudflared: boolean } };
  /** Level a terminal agent on stdio gets (today's behaviour was Trusted). */
  stdioLevel: McpLevel;
  webhook?: { url: string; hasSecret: boolean };
  apps: McpApp[];
};

/** A key made for an app: `key` is shown once and never again. */
export type McpNewKey = { app: McpApp; key: string; url: string };

/** The tools, by the level they need: Settings shows them and the engine enforces them (mcp-tools.ts). */
export const MCP_TOOL_LEVELS: Record<string, McpLevel> = {
  liner_projects: "read",
  liner_sessions: "read",
  liner_read: "read",
  liner_pull_requests: "read",
  liner_issues: "read",
  liner_findings: "read",
  liner_start: "ask",
  liner_send: "ask",
  liner_wait: "ask",
  liner_answer: "ask",
  liner_scan: "ask",
  liner_stop: "ask",
};
/** The tools that wait for the person's Allow at "Asks first". */
export const MCP_ASKED_TOOLS = ["liner_start", "liner_send", "liner_answer", "liner_scan", "liner_stop"];
export function mcpLevelAtLeast(have: McpLevel, need: McpLevel): boolean {
  return MCP_LEVELS.indexOf(have) >= MCP_LEVELS.indexOf(need);
}
/**
  The words on an ask card's trust switch. A terminal agent's level is one setting for every terminal agent (Settings ›
  Liner MCP › Terminal agents may), so its card says so rather than seeming to trust that one alone.
*/
export const mcpTrustWords = (kind: McpAppKind, name: string) => (kind === "terminal" ? "Trust terminal agents from now on" : `Trust ${name} from now on`);
