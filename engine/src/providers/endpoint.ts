/*
  An API endpoint as a tool. Its models run through the agent tool that speaks its protocol, with
  that tool pointed at it: Claude Code for Anthropic's Messages (DeepSeek, Kimi, GLM and MiniMax
  have Anthropic-compatible URLs), Codex for OpenAI's Responses (OpenAI, OpenRouter, LM Studio,
  Ollama), OpenCode for Chat Completions (anything else OpenAI-compatible). So an API model gets
  what the tool brings (files, commands, approvals, resume) and Liner Code's own tools (the
  Browser, designs), with no agent loop of Liner Code's own to keep up with theirs.

  Each is a tool of its own in the model picker ("claude.api-deepseek"), its models the ones you
  listed. Its key comes from the keychain when a session opens, and goes to the tool's process
  only, under a name of its own.
*/
import type { Endpoint, EndpointProtocol, ModelInfo, ProviderId } from "../../../contracts/src/index.ts";
import { ENDPOINT_TOOL, VOUCHER } from "../../../contracts/src/index.ts";
import type { OpenOptions, Provider } from "./types.ts";
import { goUsage, isGo } from "./opencode-go.ts";

/** The variable a tool reads the endpoint's key from (Codex's env_key, OpenCode's {env:…}). */
export const KEY_VAR = "LINER_ENDPOINT_KEY";

const VIA: Record<EndpointProtocol, string> = { anthropic: "Claude Code", responses: "Codex", chat: "OpenCode" };
/** "https://api.deepseek.com/anthropic" → "api.deepseek.com". */
export const hostOf = (url: string) => URL.parse(url.trim())?.host ?? url.trim();
/** A name the tool takes for the endpoint (Codex's model_provider, OpenCode's provider id): letters, digits and _. */
const nameOf = (e: Endpoint) => `liner_${e.id.replace(/[^a-zA-Z0-9]/g, "_")}`;
/** The voucher's endpoint (Liner Code's site), not one you added. */
const isVoucher = (e: Endpoint) => e.id === VOUCHER.id && e.url === VOUCHER.url;
const local = (url: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(url.trim());

/**
  What a session's tool is given for the endpoint: its environment, its settings (-c, for Codex),
  and the model as the tool names it. Claude Code's own aliases (sonnet, haiku: its subagents and
  quick asks) go to the same model, since the endpoint has no Claude models; and Liner Code's
  Anthropic key, when you bill Claude Code to it, stays away from someone else's endpoint.
*/
export function endpointOptions(e: Endpoint, model: string, key: string | undefined, env: NodeJS.ProcessEnv): { env: NodeJS.ProcessEnv; config?: Record<string, unknown>; model: string } {
  const url = e.url.trim().replace(/\/+$/, "");
  if (e.protocol === "anthropic") {
    const { ANTHROPIC_API_KEY: _ours, ...rest } = env;
    return {
      model,
      env: {
        ...rest,
        ANTHROPIC_BASE_URL: url,
        ...(key ? { ANTHROPIC_AUTH_TOKEN: key } : { ANTHROPIC_AUTH_TOKEN: "none" }),
        ANTHROPIC_MODEL: model,
        ANTHROPIC_DEFAULT_OPUS_MODEL: model,
        ANTHROPIC_DEFAULT_SONNET_MODEL: model,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
        ANTHROPIC_SMALL_FAST_MODEL: model,
        CLAUDE_CODE_SUBAGENT_MODEL: model,
        // Telemetry and error reports go to Anthropic, which this endpoint isn't.
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        // Every tool in the list from the start (Liner Code's designs and Browser too), not found
        // through Claude Code's tool search: another maker's model may not search, or its API may
        // refuse tools that load later.
        ENABLE_TOOL_SEARCH: "false",
      },
    };
  }
  if (e.protocol === "responses") {
    // T3 Code's managed Codex sets the same two: no OpenAI sign-in, and plain HTTP rather than a websocket.
    const provider = { name: e.label, base_url: url, wire_api: "responses", requires_openai_auth: false, supports_websockets: false, ...(key ? { env_key: KEY_VAR } : {}) };
    return { model, env: key ? { ...env, [KEY_VAR]: key } : env, config: { model_provider: nameOf(e), [`model_providers.${nameOf(e)}`]: provider } };
  }
  const id = nameOf(e);
  const config = {
    provider: { [id]: { npm: "@ai-sdk/openai-compatible", name: e.label, options: { baseURL: url, ...(key ? { apiKey: `{env:${KEY_VAR}}` } : {}) }, models: Object.fromEntries(e.models.map((m) => [m, { name: m }])) } },
    model: `${id}/${model}`,
  };
  return { model: `${id}/${model}`, env: { ...env, ...(key ? { [KEY_VAR]: key } : {}), OPENCODE_CONFIG_CONTENT: JSON.stringify(config) } };
}

/**
  The models an endpoint lists, for picking when you add it: its /models in OpenAI's shape (and
  Anthropic's, under /v1 as Claude Code addresses it). The key never follows a redirect elsewhere.
*/
export async function endpointModels(url: string, protocol: EndpointProtocol, key?: string): Promise<string[]> {
  const base = url.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^/]/i.test(base)) throw new Error("Give its address, starting https:// (or http:// for one on this Mac).");
  const at = protocol === "anthropic" ? `${base}/v1/models` : `${base}/models`;
  const auth: Record<string, string> = key ? (protocol === "anthropic" ? { "x-api-key": key, authorization: `Bearer ${key}` } : { authorization: `Bearer ${key}` }) : {};
  let r: Response;
  try {
    r = await fetch(at, { headers: { ...(protocol === "anthropic" ? { "anthropic-version": "2023-06-01" } : {}), ...auth }, signal: AbortSignal.timeout(10000), redirect: "error" });
  } catch (e) {
    throw new Error(`${hostOf(base)} didn't answer: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!r.ok) throw new Error(`${hostOf(base)} answered ${r.status}${r.status === 401 || r.status === 403 ? ": check the key" : r.status === 404 ? ": it doesn't list its models, so type them" : ""}.`);
  const b = (await r.json().catch(() => ({}))) as { data?: { id?: string; name?: string }[]; models?: { id?: string; name?: string }[] };
  const ids = [...(b.data ?? []), ...(b.models ?? [])].map((m) => String(m.id ?? m.name ?? "")).filter(Boolean);
  return [...new Set(ids)].slice(0, 200);
}

/** The endpoint `e`, through `base` (the tool for its protocol). `key` is read when a session opens, so a key saved later counts. */
export function endpointProvider(base: Provider, e: Endpoint, key: () => string | undefined): Provider {
  const id = `${ENDPOINT_TOOL[e.protocol]}.${e.id}` as ProviderId;
  const models = (): ModelInfo[] => e.models.map((m, i) => ({ id: m, label: isVoucher(e) ? "DeepSeek V4.1 Flash" : m, description: `${e.label}, through ${VIA[e.protocol]}`, ...(i === 0 ? { isDefault: true } : {}) }));
  return {
    id,
    async detect(env) {
      const d = await base.detect(env);
      // A key, or one on this Mac: ready. A hosted one with no key may need none (some are free); its first answer says.
      const keyed = Boolean(key()) || local(e.url);
      return {
        ...d,
        id,
        label: e.label,
        account: undefined,
        endpoint: hostOf(e.url),
        login: "",
        signedIn: keyed ? true : undefined,
        models: models(),
        modelsFrom: "builtin",
        modelsAt: undefined,
        detail: !d.available ? `Needs ${VIA[e.protocol]}, which runs its models: ${d.detail ?? "it isn't installed"}` : `${hostOf(e.url)}, through ${VIA[e.protocol]}${keyed ? "" : ", with no key"}`,
      };
    },
    commands: base.commands,
    // OpenCode Go added as an endpoint shows its plan's windows, read with the endpoint's key; the
    // voucher's, its five hours and its week, come from Liner Code's site with the voucher.
    ...((isGo(e.url) || isVoucher(e)) && {
      async limits() {
        const k = key();
        const windows = k ? await goUsage([k], isVoucher(e) ? `${VOUCHER.url}/usage` : undefined) : null;
        return windows && { plan: isVoucher(e) ? "Promo" : "Go", windows };
      },
    }),
    open: (o: OpenOptions) => {
      const model = o.model && o.model !== "default" ? o.model : (e.models[0] ?? "");
      const x = endpointOptions(e, model, key(), o.env);
      // Claude Code's subagents name Claude models; here they run on the endpoint's.
      const subagents = o.subagents && Object.fromEntries(Object.entries(o.subagents).map(([n, a]) => [n, { ...a, model: undefined }]));
      const s = base.open({ ...o, env: x.env, model: x.model, subagents, config: { ...o.config, ...x.config } });
      // Another model reopens the session: the endpoint's model is set in its environment and config, not
      // only in the tool, and OpenCode knows it by a name of its own. Effort and access change in place.
      const update = s.update?.bind(s);
      s.update = async (u) => (u.model === o.model && update ? update({ ...u, model: x.model }) : false);
      return s;
    },
  };
}
