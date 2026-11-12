/*
  Liner Design's lean tools, as an agent is told of them: data only, which liner-tools.ts lists and
  lean.ts answers (lean.ts re-exports it as its TOOLS). None yet: an agent reads the lean as a file,
  by the path design_files gives. Nothing here may import anything that does anything (mcp.ts).
*/
import type { ToolDef } from "./liner-tools.ts";

export const TOOLS: ToolDef[] = [];
