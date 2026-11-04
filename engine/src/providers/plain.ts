/*
  Just a model, for an app (access.ai): what the app sends, text back, and nothing else. An API
  endpoint's model is asked here, straight over HTTP in the endpoint's own protocol (Anthropic's
  Messages, OpenAI's Responses, or Chat Completions), so no agent tool and none of its tools are
  in between. Claude Code's own models are asked through Claude Code with every tool, setting and
  server off (claude.ts, `plain`); the runtime picks the way (plainWay in contracts).

  The key goes to the endpoint's address only, never through a redirect. What goes wrong reaches
  the app, so it names the endpoint by its label, never its address, and a refused key by its
  status alone: the service's own words may echo part of the key.
*/
import type { Endpoint } from "../../../contracts/src/index.ts";

/** What a model is told before an app's own instructions, whichever way it's asked. */
export const PLAIN_SOUL =
  "You are a model inside a small app in Liner Code. The app sends you a request and shows your answer as it is. Answer the request directly, in the form it asks for. You have no tools, files, web or memory: work only from what the request gives you.";

/** The most an answer may run to, in tokens. */
const MAX_OUT = 8192;

export type PlainAnswer = { text: string; inputTokens: number; outputTokens: number };

/** Asks an endpoint's model once, the answer's pieces to `onText` as they come. */
export async function askEndpoint(e: Endpoint, key: string | undefined, model: string, o: { system: string; prompt: string; signal: AbortSignal; onText?: (t: string) => void }): Promise<PlainAnswer> {
  const base = e.url.trim().replace(/\/+$/, "");
  const host = e.label || "The endpoint";
  const auth: Record<string, string> = key ? (e.protocol === "anthropic" ? { "x-api-key": key, authorization: `Bearer ${key}` } : { authorization: `Bearer ${key}` }) : {};
  const [at, body] =
    e.protocol === "anthropic"
      ? [`${base}/v1/messages`, { model, max_tokens: MAX_OUT, system: o.system, messages: [{ role: "user", content: o.prompt }], stream: true }]
      : e.protocol === "responses"
        ? [`${base}/responses`, { model, instructions: o.system, input: o.prompt, max_output_tokens: MAX_OUT, stream: true, store: false }]
        : [`${base}/chat/completions`, { model, messages: [{ role: "system", content: o.system }, { role: "user", content: o.prompt }], max_tokens: MAX_OUT, stream: true, stream_options: { include_usage: true } }];
  let r: Response;
  try {
    r = await fetch(at, { method: "POST", headers: { "content-type": "application/json", accept: "text/event-stream", ...(e.protocol === "anthropic" ? { "anthropic-version": "2023-06-01" } : {}), ...auth }, body: JSON.stringify(body), signal: o.signal, redirect: "error" });
  } catch (err) {
    if (o.signal.aborted) throw new Error("Stopped.");
    throw new Error(`${host} didn't answer: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!r.ok || !r.body) {
    const said = await r.text().catch(() => "");
    const msg = (() => {
      try {
        const j = JSON.parse(said) as { error?: { message?: string } | string; message?: string };
        return typeof j.error === "string" ? j.error : (j.error?.message ?? j.message ?? "");
      } catch {
        return said.slice(0, 200);
      }
    })();
    if (r.status === 401 || r.status === 403) throw new Error(`${host} answered ${r.status}: check its key in Settings.`);
    throw new Error(`${host} answered ${r.status}${msg ? `: ${msg.slice(0, 200)}` : "."}`);
  }
  const out: PlainAnswer = { text: "", inputTokens: 0, outputTokens: 0 };
  const put = (t: unknown) => {
    if (typeof t !== "string" || !t) return;
    out.text += t;
    o.onText?.(t);
  };
  for await (const data of events(r.body, o.signal)) {
    if (data === "[DONE]") break;
    let j: Record<string, any>;
    try {
      j = JSON.parse(data);
    } catch {
      continue;
    }
    if (j.error || j.type === "error" || j.type === "response.failed") throw new Error(`${host}: ${j.error?.message ?? j.response?.error?.message ?? j.message ?? "the model failed"}`);
    if (e.protocol === "anthropic") {
      if (j.type === "content_block_delta" && j.delta?.type === "text_delta") put(j.delta.text);
      else if (j.type === "message_start") out.inputTokens = Number(j.message?.usage?.input_tokens ?? 0) + Number(j.message?.usage?.cache_read_input_tokens ?? 0);
      else if (j.type === "message_delta" && j.usage) out.outputTokens = Number(j.usage.output_tokens ?? out.outputTokens);
    } else if (e.protocol === "responses") {
      if (j.type === "response.output_text.delta") put(j.delta);
      else if (j.type === "response.completed" && j.response?.usage) {
        out.inputTokens = Number(j.response.usage.input_tokens ?? 0);
        out.outputTokens = Number(j.response.usage.output_tokens ?? 0);
      }
    } else {
      put(j.choices?.[0]?.delta?.content);
      if (j.usage) {
        out.inputTokens = Number(j.usage.prompt_tokens ?? 0);
        out.outputTokens = Number(j.usage.completion_tokens ?? 0);
      }
    }
  }
  if (o.signal.aborted) throw new Error("Stopped.");
  return out;
}

/** A server-sent event stream's data, one event at a time. */
async function* events(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<string> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const stop = () => void reader.cancel().catch(() => {});
  signal.addEventListener("abort", stop, { once: true });
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let cut: number;
      while ((cut = buf.search(/\r?\n\r?\n/)) >= 0) {
        const block = buf.slice(0, cut);
        buf = buf.slice(cut).replace(/^\r?\n\r?\n/, "");
        const data = block
          .split(/\r?\n/)
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).replace(/^ /, ""))
          .join("\n");
        if (data) yield data;
      }
    }
    const tail = buf
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).replace(/^ /, ""))
      .join("\n");
    if (tail) yield tail;
  } finally {
    signal.removeEventListener("abort", stop);
  }
}
