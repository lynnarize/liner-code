/*
  Liner Design's picture tool, as an agent is told of it: data only, which liner-tools.ts lists and
  pictures.ts answers (pictures.ts re-exports it as its TOOLS). Nothing here may import anything
  that does anything (mcp.ts).
*/
import type { ToolDef } from "./liner-tools.ts";

export const TOOLS: ToolDef[] = [
  {
    name: "design_picture",
    description:
      "Asks the AI pictures model the person set up for a picture made from words (a photograph, an illustration, a texture) and saves it under the design file's assets/. It's optional: with none set up, or off for this design, it makes nothing and says so, and you leave a labelled empty box there. With into, it goes straight into that element. It may wait for the person's yes. Returns the file's path from the design's folder, for a frame's HTML.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "What it shows, its light and style, in a few sentences" },
        width: { type: "number" },
        height: { type: "number" },
        into: { type: "object", description: "{frame, id}: a frame and the data-l id of an img or box" },
        lean: { type: "boolean", description: "false: without the lean's colours" },
        design: { type: "string" },
      },
      required: ["prompt", "width", "height"],
    },
  },
];
