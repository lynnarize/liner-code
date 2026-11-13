/*
  Liner Design: the shapes the Design face, the engine and the frames share. A design file belongs
  to a folder, not to a session: .liner/designs/<slug>/ holds design.json (DesignFile, below), one
  whole HTML document per frame in frames/, and the pictures they use in assets/. Every element an
  editor or an agent may address carries data-l="<short id>", unique in its frame and kept across
  edits; the engine stamps the missing ones whenever it reads or writes a frame.

  The frame bridge: a drawn frame runs sandboxed with no origin, and talks to the app only by
  postMessage, through the agent script (contracts/src/frame-agent.js). ToFrame is what the app
  asks, FromFrame what the frame answers. `n` pairs an answer with its question.

  The RPC and the events are in index.ts, beside the others; the engine's halves are
  engine/src/canvas.ts, lean.ts, buildlinks.ts and pictures.ts.
*/
import type { DesignSize } from "./index.ts";

/** A box in a frame's own pixels, from its top left. */
export type Rect = { x: number; y: number; w: number; h: number };

/** Who drew a frame: the agent and its name, what it cost and took, the way it was one of (Ways), and the session it drew in. */
export type FrameBy = { agent: string; name: string; cost?: number; ms?: number; way?: string; thread?: string };
/** A frame built as a file of the project: the file, and both sides' hashes when they last agreed. */
export type FrameBuilt = { file: string; frameHash: string; fileHash: string; at: number; turn?: number };

/** One frame on the canvas: drawn (an HTML file of the design's) or live (a page of the running app). */
export type DesignFrame = {
  id: string;
  page: string;
  /** "Phone / Today" */
  name: string;
  kind: "drawn" | "live";
  /** drawn: frames/<id>.html, from the design's folder */
  path?: string;
  /** live: localhost:5173/today */
  url?: string;
  /** On the canvas, in frame px (390 × 844, 1280 × 800, any). */
  x: number;
  y: number;
  w: number;
  h: number;
  by?: FrameBy;
  built?: FrameBuilt;
  /** false: not a screen of the app (a brand board, a reference sheet): Build leaves it out and Checks treat it as a sheet. Absent: a screen. */
  screen?: false;
  /** Its file isn't there now (moved away, mid-rename): set by the engine as it reads, never written to design.json. The entry stays, with all it holds, and the frame is itself again when the file is back at `path`. */
  missing?: true;
};

/** design.json, a design file's index. */
export type DesignFile = {
  v: 1;
  id: string;
  title: string;
  pages: { id: string; name: string }[];
  frames: DesignFrame[];
  /** The lean it follows: a file (path from the folder) or a built-in one by name ("liner-2"), and the design skills loaded, by name. */
  lean: { path?: string; builtin?: string; skills: string[] };
  /** When the lead must ask before it makes a picture; and which picture model the file uses: an endpoint's id from settings.pictures, null for no one (pictures refused, nobody asked), unset for Settings' first. */
  pictures?: { ask: "first" | "always" | "never"; model?: string | null };
};

/** A design file as Home and the sidebar list it. `id` is its folder's slug; `thumb`, the frame its picture is of. */
export type DesignFileInfo = { id: string; title: string; frames: number; updated: number; thumb?: string; /** design.json is there but can't be read: why, in one plain sentence (also what canvas.open refuses with, after DESIGN_UNREADABLE). Nothing writes over it. */ unreadable?: string };

/** What canvas.save may change: the index fields, and each frame's place, size, name and page (by id). */
export type DesignPatch = Partial<Pick<DesignFile, "title" | "pages" | "lean" | "pictures">> & { frames?: ({ id: string } & Partial<Pick<DesignFrame, "x" | "y" | "w" | "h" | "name" | "page">> & { /** false marks it not a screen; true makes it one again. */ screen?: boolean })[] };

/** A frame to add: drawn by default (with the html it starts with, else an empty page), or live with its url. The engine picks its id, path and, when left out, its place and page. */
export type NewFrame = { name: string; w: number; h: number; kind?: "drawn" | "live"; url?: string; page?: string; x?: number; y?: number; by?: FrameBy; /** false: not a screen (a brand board, a reference sheet). */ screen?: false; /** Adopt an old single-HTML design of a session (the Design surface): its page, and its size and title when w, h or name are left 0 or empty. */ adopt?: { threadId: string; design: string; version?: number } };

/**
  A kept state of a design file, to scrub back to. kind "turn": the copy taken at the end of `turn`
  (or, the first time, before it). kind "before": what was there just before turn `back` was
  brought back (canvas.restore), taken on the session's turn `turn`. `key` names it for
  canvas.version.read and canvas.restore ("t5", "b1731400000000"); `at` is when it was taken.
  `backKind`: on a "before" copy, the kind of copy that was being brought back. `frames`: what
  scrubbing to it shows (live frames, and drawn ones whose file it holds).
*/
export type CanvasVersion = { turn: number; at: number; frames: number; key: string; kind: "turn" | "before"; back?: number; backKind?: "turn" | "before" };

/** Where canvas.frame.add put the frame: its place, and `moved` when the place asked overlapped another frame, so it went to the nearest free one to the right. */
export type FramePlaced = { frame: string; x: number; y: number; moved: boolean };

/** The start of the error canvas.frame.write and canvas.frame.apply give when the frame changed since `base`: "changed: …". */
export const FRAME_CHANGED = "changed:";

/** The start of the error canvas.open (and every read of it) gives for a design file whose design.json can't be read: "unreadable: …". */
export const DESIGN_UNREADABLE = "unreadable:";

/** The lean's tokens, as DESIGN.md gives them. Sizes are px; `line` is a CSS line-height as written ("1.4", "24px"). */
export type LeanTokens = {
  colours: { name: string; value: string }[];
  type: { name: string; family?: string; size?: number; weight?: number; line?: string; italic?: boolean }[];
  /** The spacing scale. */
  steps: number[];
  corners: { name: string; value: number }[];
  /** Plain rules the lean writes in words ("Send is the only coloured button"). */
  rules: string[];
};

/**
  The lean: the project's DESIGN.md (at its root, else .liner/DESIGN.md), or a built-in one. `off`
  says where it came from: "root", "liner" (.liner/DESIGN.md), "builtin", or "none" when there's none.
*/
export type Lean = { path?: string; text: string; tokens: LeanTokens; off: "root" | "liner" | "builtin" | "none"; builtin?: string; /** A short hash of the file `writes` names as it is ("" when there's none yet): lean.write's `base`. */ rev?: string; /** The project file (from the folder) lean.write with the same design file writes: the design file's own lean, else DESIGN.md, made at the root when rev is "". */ writes?: string };

/** A design skill: a SKILL.md an agent reads first. `loaded`: switched on for the design file asked about. */
export type DesignSkill = { name: string; description: string; path: string; loaded: boolean; /** "design": its name or description speaks of design (lean.ts DESIGN_WORDS); "other", the rest, listed after. */ kind?: "design" | "other" };

/**
  A frame and the project file it was built as. step: both as they were when built; design-ahead:
  the frame changed since; code-ahead: the file did; none: not built. `changed`, what differs, in words.
*/
export type FrameBuild = { frame: string; state: "none" | "step" | "design-ahead" | "code-ahead"; file?: string; changed?: string; /** design-ahead, and the file moved on too: both sides changed since the build. */ both?: boolean; /** false: the frame isn't a screen (DesignFrame.screen), so it's never built: listed under "Not for code", state "none". */ screen?: false; /** Its file is gone for now (DesignFrame.missing): state "step" when it was built, else "none", never ahead and with no `changed`; keep it out of Build's asks. */ missing?: true };

/** A picture model from Settings › Models: an OpenAI-Images-compatible endpoint and its model. */
export type PictureModel = { id: string; name: string; kind: "openai-images"; model?: string };

/** What the person has selected on the canvas now, for design_selection: frames, nodes (outer HTML), and inspector changes not written yet. */
export type DesignSelection = { file: string; frames: string[]; nodes: { frame: string; id: string; html: string }[]; pending?: { frame: string; ops: FrameOp[] }[] };

/** Who is drawing a frame now, for canvas.presence: lead or sidekick, by its agent and name. */
export type DesignPresence = { cwd: string; file: string; frame: string; node?: string; threadId: string; agent: string; name: string; label: string; on: boolean };

// The frame bridge.

/** An element of a frame, as the bridge names it. kind: a stack lays out children, text holds text, image a picture, box anything else. */
export type NodeRef = { id: string; tag: string; name: string; kind: "stack" | "text" | "image" | "box"; rect: Rect };
export type TreeNode = NodeRef & { text?: string; children: TreeNode[] };
/** One node read whole: its HTML, inline styles, the computed ones the inspector shows, and where it came from in the project (a live frame). */
export type NodeRead = NodeRef & { html: string; text?: string; inline: Record<string, string>; computed: Record<string, string>; source?: { file: string; line?: number } };

/** One change to a frame. null in style or attr takes the property away. */
export type FrameOp =
  | { id: string; style: Record<string, string | null> }
  | { id: string; text: string }
  | { id: string; attr: Record<string, string | null> }
  /** Replace the node. */
  | { id: string; html: string }
  | { id: string; remove: true }
  | { id: string; move: { before?: string; into?: string } }
  /** New html inside a node, before one of its children or at its end. */
  | { into: string; insert: string; before?: string };

/** What the checks found: a text that doesn't fit, too little contrast, a target too small to touch, a layer with no name. */
export type CheckFinding = { kind: "fit" | "contrast" | "touch" | "name"; id?: string; rect?: Rect; text: string; fix?: FrameOp[]; width?: number; ratio?: number };

/** App → frame. */
export type ToFrame =
  | { t: "hit"; n: number; x: number; y: number; deep?: boolean }
  | { t: "tree"; n: number }
  | { t: "read"; n: number; id: string }
  /** Keep sending these nodes' rects. */
  | { t: "watch"; ids: string[] }
  /** Answered with the whole document, serialised, the agent script and base taken out. */
  | { t: "apply"; n: number; ops: FrameOp[] }
  /** Text editing in place. */
  | { t: "edit"; id: string; on: boolean }
  | { t: "check"; n: number };

/** Frame → app. */
export type FromFrame =
  | { t: "ready"; w: number; h: number }
  | { t: "hit"; n: number; node: NodeRef | null; path: NodeRef[] }
  | { t: "tree"; n: number; root: TreeNode }
  | { t: "node"; n: number; node: NodeRead }
  | { t: "rects"; rects: Record<string, Rect> }
  | { t: "applied"; n: number; html: string; ids: string[] }
  | { t: "checks"; n: number; findings: CheckFinding[] }
  /** A text edited in place has ended (Enter, Esc, or the caret left it), with the text it holds now. */
  | { t: "edited"; id: string; text: string };

/** The computed properties a node's read carries, the ones the inspector shows. */
export const COMPUTED = [
  "display", "flex-direction", "flex-wrap", "gap", "align-items", "justify-content",
  "padding-top", "padding-right", "padding-bottom", "padding-left",
  "width", "height", "min-width", "max-width",
  "background-color", "background-image", "color",
  "border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius",
  "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
  "border-top-style", "border-right-style", "border-bottom-style", "border-left-style",
  "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
  "box-shadow", "opacity", "mix-blend-mode",
  "font-family", "font-size", "font-weight", "line-height", "letter-spacing", "text-align",
  "object-fit", "overflow",
  "position", "left", "top",
] as const;

/**
  Where designs on their own live: <designs home>/<slug>/, the home being ~/Liner Designs, or
  LINER_DESIGNS_HOME when set, or "Liner Designs" under LINER_HOME when that isn't the default
  (an isolated run never touches the real home). engine/src/design-start.ts designsHome.
*/
export const DESIGNS_FOLDER = "Liner Designs";
/** design.new's title when none is given. */
export const UNTITLED_DESIGN = "Untitled design";

/** The size a new frame is drawn at, by what it's for: the same frames as the Design surface's. */
export const FRAME_SIZES: Record<DesignSize, { w: number; h: number }> = { desktop: { w: 1280, h: 800 }, tablet: { w: 834, h: 1112 }, phone: { w: 390, h: 844 } };

/**
  A picture model as Settings › Models › Pictures keeps it (settings.pictures): an endpoint that
  speaks OpenAI's Images API (POST <url>/images/generations, b64_json back), the model to ask, and a
  name to show. Its key is in the keychain as pictureKey(id) (keys.set), never in settings.
*/
export type PictureEndpoint = { id: string; label: string; url: string; model: string };
export const pictureKey = (id: string) => `pictures.${id}`;

/** pictures.add: a picture file of the person's own (base64, a data: URL's prefix allowed), into the design's assets/. PNG, JPEG, WebP, GIF or AVIF by its bytes, up to 8 MB. */
export type PictureAdd = { cwd: string; file: string; name: string; data: string };
