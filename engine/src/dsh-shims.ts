/*
  What a ported DeepSeek Harness plugin's program imports of DSH's own packages that aren't on npm
  in a form that runs on its own, answered by Liner Code inside that program's process: dsh-host.ts
  maps @deepseek-ai/dsh-tools and @deepseek-ai/dsh-settings here. Never loaded by the engine.

  defineTool is DSH's (github.com/deepseek-ai/deepseek-harness, MIT: packages/core/tools/src/
  schema.ts, json-schema.ts, contracts.ts), written small: the schema DSL a plugin declares its
  parameters in, compiled to the JSON Schema a model sees; arguments checked against it before the
  tool's body runs, a call with bad ones failing in words rather than running; and its output's
  render, which makes what the agent reads. What DSH's registry does around that (policy, approval,
  timeouts, presentation) is the agent tool's here, not the plugin's.

  It imports nothing, so it runs wherever the plugin's program does. The engine reads only its two
  lists (SHIMMED, WEB_TOOLS), to say on a plugin's card what Liner Code answers for it.
*/

/** DSH's packages a plugin's program imports that Liner Code answers itself, from this file: never from npm or its node_modules. */
export const SHIMMED = ["@deepseek-ai/dsh-tools", "@deepseek-ai/dsh-settings"];

/**
  DSH's web_search and web_fetch (packages/web/tool-web), which DSH's agent gets over the search and
  fetch providers a plugin registers with ctx.web: a plugin that registers one gives these tools.
*/
export const WEB_TOOLS = {
  web_search: { name: "web_search", description: "Search the web for current information. Returns an optional summary answer and a list of source URLs.", provider: "registerSearchProvider" },
  web_fetch: { name: "web_fetch", description: "Fetch the content of a specific HTTP(S) URL and return it decoded to text.", provider: "registerFetchProvider" },
} as const;

/** DSH's error with a code a caller can route on (packages/llm/llm, HarnessError). */
export class HarnessError extends Error {
  readonly code: string;
  constructor(message: string, code: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "HarnessError";
    this.code = code;
  }
}

/** The name DSH keeps for its code-mode transport: no plugin may register a tool by it. */
export const RUN_CODE_NAME = "run_code";
export const TOOL_ABORTED = "ABORTED";
export const TOOL_ABORTED_BEFORE_DISPATCH = "ABORTED_BEFORE_DISPATCH";

export class JsonSchemaError extends HarnessError {
  constructor(message: string) {
    super(message, "INVALID_JSON_SCHEMA");
    this.name = "JsonSchemaError";
  }
}
/** Arguments a model sent that don't fit the tool's parameters: the call fails, saying which. */
export class ToolArgsError extends HarnessError {
  readonly violations: string[];
  constructor(violations: string[]) {
    super(`invalid arguments: ${violations.join("; ")}`, "INVALID_ARGS");
    this.name = "ToolArgsError";
    this.violations = violations;
  }
}
export class ToolNotFoundError extends HarnessError {
  constructor(toolName: string, reachableFrom?: string) {
    super(reachableFrom === undefined ? `unknown tool "${toolName}"` : `unknown tool "${toolName}": ${reachableFrom}`, "UNKNOWN_TOOL");
    this.name = "ToolNotFoundError";
  }
}
export class ToolOutputError extends HarnessError {
  readonly violations: string[];
  constructor(toolName: string, violations: string[]) {
    super(`tool "${toolName}" returned invalid output: ${violations.join("; ")}`, "INVALID_TOOL_OUTPUT");
    this.name = "ToolOutputError";
    this.violations = violations;
  }
}
export class ToolActivationError extends HarnessError {
  constructor(name: string, cause: unknown) {
    super(`cannot resolve availability of tool "${name}"`, "TOOL_ACTIVATION_FAILED", { cause });
    this.name = "ToolActivationError";
  }
}
/** @deepseek-ai/dsh-settings: a settings write that lost to another. Liner Code's settings never change under a plugin, so none is thrown. */
export class SettingsConflictError extends HarnessError {
  constructor(message = "the settings document changed", options?: { cause?: unknown }) {
    super(message, "SETTINGS_CONFLICT", options);
    this.name = "SettingsConflictError";
  }
}

type Rec = Record<string, unknown>;
type Node = Rec;
const isRec = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);
const ANNOTATIONS = ["description", "title", "default", "examples"];
const SCALARS = ["string", "number", "integer", "boolean", "null"];
const fail = (m: string): never => {
  throw new JsonSchemaError(m);
};
/** Deeper than this, a schema or a value is refused rather than walked. */
const DEPTH = 64;

function compileValue(spec: unknown, path: string, depth: number): Node {
  if (depth > DEPTH) fail(`${path} is nested too deeply`);
  if (!isRec(spec)) return fail(`${path} must be a value schema object`);
  const node: Node = {};
  for (const k of ANNOTATIONS) if (Object.hasOwn(spec, k)) node[k] = spec[k];
  if (Object.hasOwn(spec, "oneOf")) {
    if (Object.hasOwn(spec, "type")) fail(`${path} cannot declare both type and oneOf`);
    if (!Array.isArray(spec.oneOf) || spec.oneOf.length < 2) fail(`${path}.oneOf must be an array of at least two value schemas`);
    node.oneOf = (spec.oneOf as unknown[]).map((b, i) => compileValue(b, `${path}.oneOf[${i}]`, depth + 1));
    return node;
  }
  const type = spec.type;
  if (type === "json") return node;
  if (type === "object") {
    if (typeof spec.additionalProperties !== "boolean") fail(`${path}.additionalProperties must be explicitly true or false`);
    node.type = "object";
    node.additionalProperties = spec.additionalProperties;
    if (Object.hasOwn(spec, "properties")) Object.assign(node, compileMap(spec.properties, `${path}.properties`, depth + 1));
    return node;
  }
  if (type === "array") {
    node.type = "array";
    if (Object.hasOwn(spec, "items")) node.items = compileValue(spec.items, `${path}.items`, depth + 1);
    return node;
  }
  if (typeof type === "string" && SCALARS.includes(type)) {
    node.type = type;
    if (Object.hasOwn(spec, "enum")) {
      if (!Array.isArray(spec.enum) || !spec.enum.length) fail(`${path}.enum must be a non-empty array of scalar values`);
      node.enum = [...(spec.enum as unknown[])];
    }
    if (Object.hasOwn(spec, "const")) node.const = spec.const;
    return node;
  }
  return fail(`${path}.type must be string/number/integer/boolean/null/array/object/json, or use oneOf`);
}

/** A map of properties, each `required: true` or not: an object's properties and its required list. */
function compileMap(spec: unknown, path: string, depth: number): { properties: Record<string, Node>; required?: string[] } {
  if (!isRec(spec)) return fail(`${path} must be an object of value schemas`);
  const properties: Record<string, Node> = {};
  const required: string[] = [];
  for (const [key, p] of Object.entries(spec)) {
    if (!isRec(p)) fail(`${path}.${key} must be a value schema object`);
    const { required: req, ...rest } = p as Rec;
    if (req !== undefined && req !== true) fail(`${path}.${key}.required must be true when present`);
    if (req === true) required.push(key);
    properties[key] = compileValue(rest, `${path}.${key}`, depth + 1);
  }
  return { properties, ...(required.length ? { required } : {}) };
}

/** A value schema in DSH's DSL, as raw JSON Schema. */
export const valueSchemaSpecToJsonSchema = (spec: unknown): Node => compileValue(spec, "schema", 0);
/** A tool's parameters (a map of properties), as the object schema a model sees. */
export const parameterSchemaSpecToJsonSchema = (spec: unknown): Node => ({ type: "object", ...compileMap(spec, "parameters", 0) });
/** DSH checks a raw schema is one it supports; here, that it's an object at least. */
export function assertSupportedJsonSchema(schema: unknown): asserts schema is Node {
  if (!isRec(schema)) fail("a schema must be an object");
}

const where = (path: string) => path || "arguments";
const at = (path: string, key: string) => (path ? `${path}.${key}` : key);
const plainJson = (v: unknown, depth = 0): boolean => {
  if (depth > DEPTH) return false;
  if (v === null || typeof v === "string" || typeof v === "boolean") return true;
  if (typeof v === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.every((x) => plainJson(x, depth + 1));
  if (isRec(v)) return Object.values(v).every((x) => plainJson(x, depth + 1));
  return false;
};

/** Every way `value` misses `schema`, by path; none when it fits. */
export function validateJsonSchemaValue(schema: Node, value: unknown, path = "value", depth = 0): string[] {
  if (depth > DEPTH) return [`"${where(path)}" is nested too deeply`];
  if (Array.isArray(schema.oneOf)) {
    const hits = (schema.oneOf as Node[]).filter((b) => validateJsonSchemaValue(b, value, path, depth + 1).length === 0).length;
    return hits === 1 ? [] : [`"${where(path)}" must match exactly one oneOf branch (matched ${hits})`];
  }
  const scalar = () => {
    const out: string[] = [];
    if (Array.isArray(schema.enum) && !schema.enum.some((e) => e === value)) out.push(`"${where(path)}" must be one of ${JSON.stringify(schema.enum)}`);
    if (Object.hasOwn(schema, "const") && schema.const !== value) out.push(`"${where(path)}" must be ${JSON.stringify(schema.const)}`);
    return out;
  };
  switch (schema.type) {
    case undefined:
      return plainJson(value, depth) ? [] : [`"${where(path)}" must be a lossless JSON value`];
    case "object": {
      if (!isRec(value)) return [`"${where(path)}" must be an object`];
      const props = isRec(schema.properties) ? (schema.properties as Record<string, Node>) : {};
      const out: string[] = [];
      for (const k of Array.isArray(schema.required) ? (schema.required as string[]) : []) if (value[k] === undefined) out.push(`missing required property "${at(path, k)}"`);
      for (const [k, s] of Object.entries(props)) if (value[k] !== undefined) out.push(...validateJsonSchemaValue(s, value[k], at(path, k), depth + 1));
      if (schema.additionalProperties === false) for (const k of Object.keys(value)) if (!Object.hasOwn(props, k)) out.push(`"${at(path, k)}" is not a declared property (additionalProperties: false)`);
      for (const [k, v] of Object.entries(value)) if (!Object.hasOwn(props, k) && v !== undefined && !plainJson(v, depth + 1)) out.push(`"${at(path, k)}" must be a lossless JSON value`);
      return out;
    }
    case "array": {
      if (!Array.isArray(value)) return [`"${where(path)}" must be an array`];
      if (!isRec(schema.items)) return value.every((x) => plainJson(x, depth + 1)) ? [] : [`"${where(path)}" must be a dense lossless JSON array`];
      return value.flatMap((x, i) => validateJsonSchemaValue(schema.items as Node, x, `${path}[${i}]`, depth + 1));
    }
    case "string":
      return typeof value === "string" ? scalar() : [`"${where(path)}" must be a string`];
    case "number":
      return typeof value !== "number" ? [`"${where(path)}" must be a number`] : !Number.isFinite(value) ? [`"${where(path)}" must be a finite JSON number`] : scalar();
    case "integer":
      return typeof value === "number" && Number.isInteger(value) ? scalar() : [`"${where(path)}" must be an integer`];
    case "boolean":
      return typeof value === "boolean" ? scalar() : [`"${where(path)}" must be a boolean`];
    case "null":
      return value === null ? scalar() : [`"${where(path)}" must be null`];
    default:
      return [`"${where(path)}" has a schema type Liner Code doesn't know: ${String(schema.type)}`];
  }
}
export const validateArgs = (spec: unknown, args: unknown) => validateJsonSchemaValue(parameterSchemaSpecToJsonSchema(spec), args, "");

/** What a model is shown of a tool: its name, what it does, and its parameters. */
export function projectToolSchema(d: { name: string; description: string; parameters: unknown; deferLoading?: boolean }, detach = true) {
  return { name: d.name, description: d.description, parameters: detach ? (JSON.parse(JSON.stringify(d.parameters)) as unknown) : d.parameters, ...(d.deferLoading === true ? { deferLoading: true } : {}) };
}

type Options = {
  name: string;
  description: string;
  parameters?: unknown;
  output: { schema: unknown; render(args: unknown, value: unknown): unknown[]; presentationMeta?(args: unknown, value: unknown): unknown };
  deferLoading?: true;
  timeoutMs?: number;
  isConcurrencySafe?(args: unknown): boolean;
  execute(args: unknown, exec: unknown): Promise<unknown>;
  projectContent?(exec: unknown, result: unknown): unknown[] | undefined;
  finalizeContent?(exec: unknown, result: unknown): unknown[] | undefined;
  presentCall?(args: unknown): unknown;
  presentResult?(args: unknown, result: unknown): unknown;
};

/**
  A tool, as DSH's defineTool makes one: its parameters compiled from the DSL, checked before its
  body runs; its output's render kept for what the agent reads. Presenters fall back quietly on
  arguments that don't fit, as DSH's do.
*/
export function defineTool(o: Options) {
  if (o.timeoutMs !== undefined && (!Number.isFinite(o.timeoutMs) || o.timeoutMs <= 0)) throw new Error(`defineTool(${o.name}): timeoutMs must be a positive finite number`);
  if (!o.output || typeof o.output.render !== "function") throw new TypeError(`tool "${o.name}" must declare output { schema, render, presentationMeta? }`);
  const parameters = parameterSchemaSpecToJsonSchema(o.parameters ?? {});
  const schema = valueSchemaSpecToJsonSchema(o.output.schema);
  const validate = (args: unknown) => validateJsonSchemaValue(parameters, args, "");
  const { execute, projectContent, finalizeContent, presentCall, presentResult, isConcurrencySafe, output } = o;
  return {
    name: o.name,
    description: o.description,
    parameters,
    output: { schema, render: (args: unknown, value: unknown) => output.render(args, value), ...(output.presentationMeta ? { presentationMeta: (args: unknown, value: unknown) => output.presentationMeta!(args, value) } : {}) },
    ...(o.deferLoading === true ? { deferLoading: true as const } : {}),
    ...(o.timeoutMs !== undefined ? { timeoutMs: o.timeoutMs } : {}),
    async execute(args: unknown, exec: unknown) {
      const bad = validate(args);
      if (bad.length) throw new ToolArgsError(bad);
      return execute(args, exec);
    },
    ...(projectContent ? { projectContent: (exec: unknown, result: unknown) => projectContent(exec, result) } : {}),
    ...(finalizeContent ? { finalizeContent: (exec: unknown, result: unknown) => finalizeContent(exec, result) } : {}),
    ...(presentCall ? { presentCall: (args: unknown) => (validate(args).length ? undefined : presentCall(args)) } : {}),
    ...(presentResult ? { presentResult: (args: unknown, result: unknown) => (validate(args).length ? undefined : presentResult(args, result)) } : {}),
    ...(isConcurrencySafe ? { isConcurrencySafe: (args: unknown) => (validate(args).length ? false : isConcurrencySafe(args)) } : {}),
  };
}
