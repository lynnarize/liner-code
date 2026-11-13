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
      "Asks for an AI picture, one a model generates from words (a photograph, an illustration, a texture), from the AI pictures model the person set up, and saves it under the design file's assets/. AI pictures are optional: with none set up, or off for the design file, it makes nothing and says so, and you leave a labelled empty box where the picture goes. With into, it goes straight into that element of a frame. The design file says whether the person is asked first; this waits for their answer. Returns the file's path, from the design's folder, to use in a frame's HTML.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "What the picture shows, its light and its style, in a few sentences" },
        width: { type: "number", description: "Its width in px" },
        height: { type: "number", description: "Its height in px" },
        into: { type: "object", description: "Where it goes: {frame, id}, a frame's id or name and the data-l id of an img or a box to fill" },
        lean: { type: "boolean", description: "false to leave the lean's colours out of the ask (they go with it otherwise)" },
        design: { type: "string", description: "The design file's slug" },
      },
      required: ["prompt", "width", "height"],
    },
  },
];
