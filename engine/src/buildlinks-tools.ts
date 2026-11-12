/*
  Liner Design's build tools, as an agent is told of them: data only, which liner-tools.ts lists
  and buildlinks.ts answers (buildlinks.ts re-exports it as its TOOLS). Nothing here may import
  anything that does anything (mcp.ts).
*/
import type { ToolDef } from "./liner-tools.ts";

export const TOOLS: ToolDef[] = [
  {
    name: "design_built",
    description: "Records that you built a frame of Liner Design's canvas as a file of the project (a component, a page), so the person sees the two tied and knows when one moves on from the other. Call it once the file is written and works, once for each frame you built.",
    inputSchema: {
      type: "object",
      properties: {
        frame: { type: "string", description: "The frame's id or name" },
        file: { type: "string", description: "The project file it became, its path from this folder: src/screens/Today.tsx" },
        design: { type: "string", description: "The design file's slug" },
      },
      required: ["frame", "file"],
    },
  },
];
