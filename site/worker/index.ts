/*
  The Worker behind linercode.dev. The website itself is static assets; only /api/* comes here
  (run_worker_first in wrangler.jsonc), and today that is just the promo.

  The promo: a code Liner Code's users type in the app (LINER_CODE_VOUCHERS, comma-separated, so
  one can be retired without a new release) lets them run one model, DeepSeek V4.1 Flash, on the
  OpenCode Go plan (OPENCODE_GO_API_KEY, a secret on this Worker). The app sends the code as its
  key; the Go key never leaves here, and whatever model the app names, Flash is the one asked.
  The app calls it VOUCHER (contracts/src/index.ts) and shows it as "Promo", never "OpenCode Go".
*/

type Env = { ASSETS: { fetch(request: Request): Promise<Response> }; LINER_CODE_VOUCHERS?: string; OPENCODE_GO_API_KEY?: string };

const MODEL = "deepseek-v4.1-flash";
const CHAT = "https://opencode.ai/inference/go/openai/v1/chat/completions";
const USAGE = "https://opencode.ai/zen/go/v1/usage";
// Go asks clients to name themselves, not a generic HTTP library.
const AGENT = "liner-code-promo/1";

class NotReady extends Error {}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });

/** Compares secrets in constant time, so the answer's timing gives nothing away. */
function same(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const hex = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");

const vouchers = (env: Env) => (env.LINER_CODE_VOUCHERS ?? "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);

function goKey(env: Env) {
  if (!env.OPENCODE_GO_API_KEY) throw new NotReady();
  return env.OPENCODE_GO_API_KEY;
}

/** The code the request carries is one of ours. */
function redeemed(request: Request, env: Env) {
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim().toLowerCase();
  return Boolean(given) && vouchers(env).some((v) => same(v, given));
}

const refused = () => json({ error: { message: "That voucher isn't valid (any more).", type: "invalid_voucher" } }, 401);

/*
  Go refuses a chat without a stable session id in x-opencode-session (for routing and prompt
  caching). The one the client sent is passed on; without one, it is made from the conversation's
  opening (its system prompt and first user message), which stays the same on every turn of it.
*/
async function sessionOf(request: Request, messages: unknown[]) {
  const given = request.headers.get("x-opencode-session")?.trim();
  if (given && given.length <= 200) return given;
  const role = (r: string) => messages.find((m) => (m as { role?: string } | null)?.role === r) ?? null;
  return `liner-${(await hex(JSON.stringify([role("system"), role("user")]))).slice(0, 32)}`;
}

/** A chat request, sent on as Flash and streamed back as it comes. */
async function chat(request: Request, env: Env) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || !Array.isArray(body.messages)) return json({ error: { message: "Send a chat request." } }, 400);
  delete body.n;
  const r = await fetch(CHAT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${goKey(env)}`,
      "content-type": "application/json",
      accept: request.headers.get("accept") ?? "application/json",
      "user-agent": AGENT,
      "x-opencode-session": await sessionOf(request, body.messages),
    },
    body: JSON.stringify({ ...body, model: MODEL }),
    signal: request.signal,
    // Never follow a redirect with the Go key on it (Workers have no redirect: "error").
    redirect: "manual",
  });
  if (r.status >= 300 && r.status < 400) throw new Error(`OpenCode Go redirected the chat (${r.status}).`);
  const headers: Record<string, string> = { "content-type": r.headers.get("content-type") ?? "application/json", "cache-control": "no-store" };
  const retry = r.headers.get("retry-after");
  if (retry) headers["retry-after"] = retry;
  return new Response(r.body, { status: r.status, headers });
}

/** The plan's rolling five hours and its week, as opencode.ai reports them; its month stays here. */
async function usage(env: Env) {
  const r = await fetch(USAGE, { headers: { authorization: `Bearer ${goKey(env)}`, "user-agent": AGENT }, signal: AbortSignal.timeout(5000), redirect: "manual" });
  if (!r.ok) return json({ error: `The plan's usage answered ${r.status}.` }, 502);
  const b = (await r.json().catch(() => ({}))) as { usage?: Record<string, unknown> };
  return json({ usage: { rolling: b.usage?.rolling, weekly: b.usage?.weekly } });
}

const routes: Record<string, Partial<Record<string, (request: Request, env: Env) => Promise<Response> | Response>>> = {
  "/api/code/v1/chat/completions": { POST: chat },
  "/api/code/v1/models": { GET: () => json({ object: "list", data: [{ id: MODEL, object: "model", owned_by: "liner" }] }) },
  "/api/code/v1/usage": { GET: (_, env) => usage(env) },
};

export default {
  async fetch(request: Request, env: Env) {
    const path = new URL(request.url).pathname.replace(/\/$/, "");
    if (!path.startsWith("/api/")) return env.ASSETS.fetch(request);
    const route = Object.hasOwn(routes, path) ? routes[path] : undefined;
    const handler = route?.[request.method === "HEAD" ? "GET" : request.method];
    if (!route) return json({ error: { message: "Not found." } }, 404);
    if (!handler) return json({ error: { message: "Method not allowed." } }, 405);
    try {
      if (!redeemed(request, env)) return refused();
      return await handler(request, env);
    } catch (err) {
      // The detail stays in the Worker's logs; the app is told only what it needs, in OpenAI's shape.
      console.error(err);
      if (err instanceof NotReady) return json({ error: { message: "The promo isn't set up on this site yet." } }, 503);
      return json({ error: { message: "Something went wrong on our side. Try again in a minute." } }, 500);
    }
  },
};
