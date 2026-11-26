/*
  The promo's relay: the voucher never reaches an agent. OpenCode runs the promo's model with this
  engine as its API (POST /promo/v1/chat/completions on 127.0.0.1) and a key made for this run, and
  the engine sends each call on to Liner Code's site with the voucher as its key. An agent can read
  what its own tool was given (its environment, its config): only that key, which works here alone,
  while this engine runs, and never as the voucher. A real OpenCode printed the voucher from its
  shell when it was given the voucher itself (2.4.1, `echo $LINER_ENDPOINT_KEY`).
*/
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import { VOUCHER } from "../../contracts/src/index.ts";

/** Where the relay is answered on the engine's server. */
export const PROMO_PATH = "/promo/v1";
/** The calls OpenCode makes of an OpenAI-compatible API, each by its method: nothing else of the site is reached through here. */
const ALLOWED: Record<string, string> = { "chat/completions": "POST", models: "GET" };
/** A chat's body, pictures and all, is far below this. */
const MOST = 32 * 1024 * 1024;
/** What of the site's answer goes back: the stream's own headers, never a cookie of the site's. */
const KEEP = ["content-type", "cache-control", "retry-after", "x-request-id"];

export class PromoRelay {
  /** The engine's own address (http://127.0.0.1:port), once its server listens. */
  url?: string;
  /** The key OpenCode is given in place of the voucher, made for this run. */
  readonly token = randomBytes(24).toString("hex");
  /** Where the calls go: Liner Code's site; a test points it at a fake. */
  upstream = VOUCHER.url;
  /** The voucher, read at each call, so a removed one stops the next call. */
  voucher: () => string | undefined;

  constructor(voucher: () => string | undefined) {
    this.voucher = voucher;
  }

  /** What a promo session's tool is pointed at instead of the site; none before the server listens. */
  via(): { url: string; key: string } | undefined {
    return this.url ? { url: `${this.url}${PROMO_PATH}`, key: this.token } : undefined;
  }

  /** Whether a request shows this run's key, compared in constant time. */
  private shows(req: IncomingMessage) {
    const got = Buffer.from(String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""));
    const want = Buffer.from(this.token);
    return got.length === want.length && timingSafeEqual(got, want);
  }

  /** Answers `rest` (what follows PROMO_PATH): the key before anything is read, then the call sent on with the voucher. */
  async serve(rest: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Any page in a browser can post here: nothing is read, and nothing sent on, without this run's key.
    if (!this.shows(req)) return void res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "Unauthorized", type: "invalid_key" } }));
    const path = rest.replace(/^\/+/, "");
    if (!Object.hasOwn(ALLOWED, path) || ALLOWED[path] !== req.method) return void res.writeHead(404).end("Not found");
    const post = req.method === "POST";
    const voucher = this.voucher();
    if (!voucher) return void res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "No voucher is redeemed in Settings.", type: "invalid_voucher" } }));
    let body: Buffer | undefined;
    if (post) {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const c of req) {
        size += (c as Buffer).length;
        if (size > MOST) return void res.writeHead(413).end("Too large");
        chunks.push(c as Buffer);
      }
      body = Buffer.concat(chunks);
    }
    const gone = new AbortController();
    res.on("close", () => res.writableEnded || gone.abort());
    let r: Response;
    try {
      r = await fetch(`${this.upstream}/${path}`, { method: req.method, headers: { authorization: `Bearer ${voucher}`, ...(post ? { "content-type": "application/json" } : {}), accept: String(req.headers.accept ?? "*/*") }, body, signal: gone.signal, redirect: "error" });
    } catch (e) {
      if (gone.signal.aborted) return void res.end();
      return void res.writeHead(502, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: `Liner Code's site didn't answer: ${e instanceof Error ? e.message : String(e)}`, type: "unreachable" } }));
    }
    const headers = Object.fromEntries(KEEP.flatMap((k) => (r.headers.get(k) ? [[k, r.headers.get(k)!]] : [])));
    res.writeHead(r.status, headers);
    // A stream, written as it comes: the model's words show as they're made.
    if (!r.body) return void res.end();
    const out = Readable.fromWeb(r.body as import("node:stream/web").ReadableStream);
    out.on("error", () => res.destroy());
    out.pipe(res);
  }
}
