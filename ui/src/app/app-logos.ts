/*
  The logos of the apps outside Liner Code that reach it through Liner MCP (contracts/src/mcp.ts, McpAppKind), for a
  session's sidebar row and anywhere else an app is named. The pictures are T3 Code's (MIT,
  apps/web/src/components/mcp/logos), copied into assets/apps. A terminal agent and another app have none: their row
  draws an icon instead.
*/
import type { McpAppKind } from "@contracts";
import chatgpt from "./assets/apps/chatgpt.png";
import claude from "./assets/apps/claude.png";
import grokbot from "./assets/apps/grokbot.png";
import muse from "./assets/apps/muse.png";

export const APP_LOGO: Partial<Record<McpAppKind, string>> = { grokbot, muse, claude, chatgpt };
