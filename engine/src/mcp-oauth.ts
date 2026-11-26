/*
  OAuth 2.1 for apps that sign in to Liner MCP themselves (Claude, ChatGPT), after T3 Code's auth/McpOAuth.ts and
  auth/mcpOAuthHttp.ts: dynamic client registration with the client's name and redirects signed into its id (so registering
  stores nothing), the authorization code grant with PKCE S256 only, short-lived access tokens and a refresh token that is
  used up as it's used. Redirects must be https, or http on this Mac's loopback.

  Unlike T3, /authorize asks nothing in the browser: it makes a sign-in that waits for you in the Liner app, as a card that
  says who wants in and lets you choose what it may do (Read only, Asks first, Trusted), and shows a page that waits until
  you've answered there. Only then does the browser go back to the app with a code (or with access_denied). The code is good
  once, for a minute, and only with the verifier the app made, so a code seen on the way is no use to anyone else.
*/
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { McpAppKind, McpLevel, McpSignIn } from "../../contracts/src/mcp.ts";
import { MCP_LEVELS } from "../../contracts/src/mcp.ts";
import { cleanName, sha256, type McpApps } from "./mcp-apps.ts";

const CODE_TTL = 60_000;
/** How long a sign-in waits for you in the app. */
export const SIGN_IN_WAIT = 10 * 60_000;
/** Sign-ins waiting at once: more are refused, so nobody fills the app with cards. */
const MAX_WAITING = 5;
const MAX_REDIRECTS = 10;
/** How long after you pick an app that signs in itself (Add an app) a sign-in is taken: none comes in at any other time. */
export const EXPECT_WINDOW = 15 * 60_000;
/**
  Cards a minute: only a sign-in that would make one counts (refused ones don't, so nobody can use up the count to keep a
  real sign-in out). Registrations, which store nothing, have a larger count of their own, of those taken.
*/
export const CARD_RATE = 10;
export const REGISTER_RATE = 300;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
/** The computer Liner Code runs on, as the app names it (ui/src/app/os.ts): the waiting page says where to answer. */
const MACHINE = process.platform === "win32" ? "PC" : "Mac";

export type Urls = { issuer: string; resource: string };
export const urlsOf = (origin: string): Urls => ({ issuer: origin, resource: `${origin}/mcp` });

export const protectedResource = (u: Urls) => ({ resource: u.resource, authorization_servers: [u.issuer], bearer_methods_supported: ["header"], resource_name: "Liner Code" });
export const authorizationServer = (u: Urls) => ({
  issuer: u.issuer,
  authorization_endpoint: `${u.issuer}/authorize`,
  token_endpoint: `${u.issuer}/token`,
  registration_endpoint: `${u.issuer}/register`,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none"],
  authorization_response_iss_parameter_supported: true,
});

/** A redirect an app may register: https, or http on loopback; no fragment, no user or password. */
export function parseRedirect(v: unknown): URL | undefined {
  if (typeof v !== "string" || v.length > 512 || v.includes("#")) return undefined;
  try {
    const u = new URL(v);
    const ok = u.protocol === "https:" || (u.protocol === "http:" && LOOPBACK.has(u.hostname));
    return ok && !u.username && !u.password ? u : undefined;
  } catch {
    return undefined;
  }
}
/** Loopback redirects may change port (RFC 8252 §7.3); https ones must match exactly. */
export function redirectMatches(registered: string, presented: string) {
  const a = parseRedirect(registered);
  const b = parseRedirect(presented);
  if (!a || !b) return false;
  if (a.protocol === "https:" || b.protocol === "https:") return a.href === b.href;
  return a.hostname === b.hostname && a.pathname === b.pathname && a.search === b.search;
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const sameText = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

type Client = { clientId: string; name: string; redirects: string[] };
type Waiting = SignInRecord & { expect: McpAppKind; decision?: { allow: boolean; level: McpLevel } };
type SignInRecord = { id: string; client: Client; redirectUri: string; challenge: string; state?: string; issuer: string; resource: string; at: number };
type Code = { clientId: string; name: string; kind: McpAppKind; redirectUri: string; challenge: string; resource: string; level: McpLevel; exp: number };

/** An answer for the HTTP layer to send as it is. */
export type Reply = { status: number; headers?: Record<string, string>; json?: unknown; html?: string };

const PAGE_HEADERS = { "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'", "x-frame-options": "DENY", "referrer-policy": "no-referrer" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** The page the browser shows while you decide in the Liner app: it asks again every few seconds, with no script. */
function page(title: string, body: string, refresh?: string): Reply {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${refresh ? `<meta http-equiv="refresh" content="3;url=${esc(refresh)}">` : ""}<title>${esc(title)}</title><style>body{font:15px/1.5 -apple-system,system-ui,sans-serif;max-width:460px;margin:18vh auto;padding:0 20px;color:#222;background:#fafafa}@media(prefers-color-scheme:dark){body{color:#eee;background:#181818}}h1{font-size:18px;font-weight:600;margin:0 0 8px}p{margin:0;opacity:.75}</style></head><body><h1>${esc(title)}</h1><p>${esc(body)}</p></body></html>`;
  return { status: 200, headers: PAGE_HEADERS, html };
}
const errorPage = (body: string): Reply => ({ ...page("This sign-in can't go on", body), status: 400 });
const redirect = (to: string): Reply => ({ status: 302, headers: { location: to, "referrer-policy": "no-referrer" } });
function withParams(uri: string, params: Record<string, string | undefined>) {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString();
}
const tokenError = (error: string, description: string, status = 400): Reply => ({ status, json: { error, error_description: description } });

export class McpOAuth {
  private apps: McpApps;
  private now: () => number;
  private waiting = new Map<string, Waiting>();
  private codes = new Map<string, Code>();
  /** The app you picked in Add an app that signs in itself, and until when a sign-in is taken for it. */
  private expected: { kind: McpAppKind; until: number } | null = null;
  private made: number[] = [];
  private registered: number[] = [];
  /** Whether `list` already holds `max` in the last minute (nothing is added here). */
  private full(list: number[], max: number) {
    const now = this.now();
    const recent = list.filter((t) => now - t < 60_000);
    list.splice(0, list.length, ...recent);
    return recent.length >= max;
  }
  /** The sign-ins waiting for you changed: the app draws its cards again. */
  onChange: () => void = () => {};

  constructor(apps: McpApps, now: () => number = Date.now) {
    this.apps = apps;
    this.now = now;
  }

  private sign(body: string) {
    return createHmac("sha256", this.apps.secret).update(`mcp-client-id.${body}`).digest("base64url");
  }
  private clientOf(id: string): Client | undefined {
    const [body, sig, extra] = String(id ?? "").split(".");
    if (!body || !sig || extra !== undefined || id.length > 8192 || !sameText(sig, this.sign(body))) return undefined;
    try {
      const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { v?: number; n?: unknown; r?: unknown };
      if (p.v !== 1 || typeof p.n !== "string" || !Array.isArray(p.r) || !p.r.every((x) => typeof x === "string")) return undefined;
      return { clientId: id, name: p.n, redirects: p.r as string[] };
    } catch {
      return undefined;
    }
  }

  /** Dynamic client registration (RFC 7591): nothing is stored; what it registered is signed into its client_id. */
  register(meta: unknown): Reply {
    const m = (meta && typeof meta === "object" ? meta : {}) as { client_name?: unknown; redirect_uris?: unknown };
    const redirects = Array.isArray(m.redirect_uris) ? m.redirect_uris : [];
    if (!redirects.length || redirects.length > MAX_REDIRECTS) return tokenError("invalid_redirect_uri", `Register between 1 and ${MAX_REDIRECTS} redirect URIs.`);
    if (!redirects.every((r) => parseRedirect(r))) return tokenError("invalid_redirect_uri", "Redirect URIs must be https, or http on localhost, 127.0.0.1 or [::1].");
    if (this.full(this.registered, REGISTER_RATE)) return { status: 429, headers: { "retry-after": "60" }, json: { error: "slow_down", error_description: "Too many registrations at once. Try again in a minute." } };
    this.registered.push(this.now());
    const name = cleanName(m.client_name, "An app");
    const body = b64(JSON.stringify({ v: 1, n: name, r: redirects }));
    const clientId = `${body}.${this.sign(body)}`;
    return { status: 201, json: { client_id: clientId, client_name: name, redirect_uris: redirects, grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" } };
  }

  /**
    You picked an app that signs in itself (Claude, ChatGPT, Another app) in Add an app: a sign-in is taken for the next 15
    minutes. Outside that window /authorize makes no card, so nobody who finds the address can put cards in front of you.
  */
  expect(kind: McpAppKind) {
    this.expected = { kind, until: this.now() + EXPECT_WINDOW };
  }

  /** Sign-ins waiting for you, for the app's cards. */
  list(): McpSignIn[] {
    this.sweep();
    return [...this.waiting.values()].filter((w) => !w.decision).map((w) => ({ id: w.id, clientName: w.client.name, expect: w.expect, redirectHost: new URL(w.redirectUri).host, at: w.at }));
  }

  private sweep() {
    const now = this.now();
    let changed = false;
    for (const [id, w] of this.waiting) if (now - w.at > SIGN_IN_WAIT) (this.waiting.delete(id), (changed = true));
    for (const [k, c] of this.codes) if (c.exp <= now) this.codes.delete(k);
    if (changed) this.onChange();
  }

  /** Your answer on the sign-in card: allowed at a level, or refused. The waiting browser picks it up on its next look. */
  decide(id: string, allow: boolean, level: McpLevel = "read") {
    const w = this.waiting.get(id);
    if (!w || w.decision) throw new Error("That sign-in isn't waiting any more.");
    if (!MCP_LEVELS.includes(level)) throw new Error("That isn't a level.");
    w.decision = { allow, level };
    // The sign-in you started is in: the window it came through closes, so no second one rides on it.
    if (allow) this.expected = null;
    this.onChange();
  }

  /**
    GET /authorize. A new request is checked, kept as a sign-in waiting for you, and the browser sent on to its own waiting
    address (so a reload doesn't make a second one). That address (`pending`) shows the waiting page until you answer, then
    goes back to the app. An unknown app or redirect is said on the page, never followed.
  */
  authorize(q: URLSearchParams, urls: Urls): Reply {
    this.sweep();
    const pending = q.get("pending");
    if (pending !== null) {
      const w = this.waiting.get(pending);
      if (!w) return errorPage("This sign-in ran out or was answered already. Start it again from the app.");
      if (!w.decision) return page("Allow it in Liner Code", `${w.client.name} is waiting for you. Open Liner Code on your ${MACHINE} and choose what it may do on the card there; this page goes on by itself.`, `/authorize?pending=${encodeURIComponent(w.id)}`);
      this.waiting.delete(w.id);
      this.onChange();
      if (!w.decision.allow) return redirect(withParams(w.redirectUri, { error: "access_denied", state: w.state, iss: w.issuer }));
      const code = randomBytes(32).toString("base64url");
      this.codes.set(sha256(code), { clientId: w.client.clientId, name: w.client.name, kind: w.expect, redirectUri: w.redirectUri, challenge: w.challenge, resource: w.resource, level: w.decision.level, exp: this.now() + CODE_TTL });
      return redirect(withParams(w.redirectUri, { code, state: w.state, iss: w.issuer }));
    }
    const expected = this.expected && this.expected.until > this.now() ? this.expected : null;
    if (!expected) return errorPage("Liner Code isn't expecting a sign-in. Start this sign-in from Liner Code › Settings › Liner MCP › Add an app, then try again here.");
    const client = this.clientOf(q.get("client_id") ?? "");
    if (!client) return errorPage("This sign-in names an app Liner Code doesn't know. Start it again from the app.");
    const redirectUri = q.get("redirect_uri") ?? "";
    if (!client.redirects.some((r) => redirectMatches(r, redirectUri))) return errorPage("This sign-in would send you to an address the app didn't register.");
    const state = q.get("state") ?? undefined;
    const back = (error: string, description: string) => redirect(withParams(redirectUri, { error, error_description: description, state, iss: urls.issuer }));
    if (q.get("response_type") !== "code") return back("unsupported_response_type", "Only response_type=code is supported.");
    const challenge = q.get("code_challenge") ?? "";
    if (q.get("code_challenge_method") !== "S256" || !CHALLENGE.test(challenge)) return back("invalid_request", "PKCE with code_challenge_method=S256 is required.");
    const resource = q.get("resource");
    if (resource !== null && resource.replace(/\/+$/, "") !== urls.resource) return back("invalid_target", `This server only issues tokens for ${urls.resource}.`);
    if ([...this.waiting.values()].filter((w) => !w.decision).length >= MAX_WAITING) return errorPage("Too many sign-ins are waiting in Liner Code already. Answer those first, then try again.");
    if (this.full(this.made, CARD_RATE)) return errorPage("Too many sign-ins came in this minute. Wait a minute, then try again.");
    this.made.push(this.now());
    const id = randomBytes(32).toString("base64url");
    this.waiting.set(id, { id, client, expect: expected.kind, redirectUri, challenge, state, issuer: urls.issuer, resource: urls.resource, at: this.now() });
    this.onChange();
    return redirect(`/authorize?pending=${encodeURIComponent(id)}`);
  }

  /** POST /token: a code for tokens (with its verifier), or a refresh token for new ones. */
  token(form: URLSearchParams): Reply {
    this.sweep();
    const grant = form.get("grant_type");
    const clientId = form.get("client_id") ?? "";
    if (grant === "authorization_code") {
      const code = form.get("code") ?? "";
      const verifier = form.get("code_verifier") ?? "";
      const redirectUri = form.get("redirect_uri") ?? "";
      // Every code was given for the redirect_uri /authorize was sent, so the same one must come back with it (RFC 6749 §4.1.3).
      if (!code || !verifier || !clientId || !redirectUri) return tokenError("invalid_request", "code, client_id, code_verifier and redirect_uri are required.");
      const key = sha256(code);
      const c = this.codes.get(key);
      // Used once, whatever comes of it: a code tried twice is a code someone else may hold.
      this.codes.delete(key);
      if (!c || c.exp <= this.now()) return tokenError("invalid_grant", "That code isn't good any more. Sign in again.");
      if (!sameText(c.clientId, clientId)) return tokenError("invalid_grant", "That code was given to another app.");
      if (redirectUri !== c.redirectUri) return tokenError("invalid_grant", "That code was given for another redirect_uri.");
      const resource = form.get("resource");
      if (resource !== null && resource.replace(/\/+$/, "") !== c.resource) return tokenError("invalid_target", `This server only issues tokens for ${c.resource}.`);
      if (!VERIFIER.test(verifier) || !sameText(createHash("sha256").update(verifier).digest("base64url"), c.challenge)) return tokenError("invalid_grant", "The code_verifier doesn't match.");
      const app = this.apps.createOAuth({ name: c.name, kind: c.kind, level: c.level, clientId: c.clientId });
      const t = this.apps.issue(app.id);
      return { status: 200, json: { access_token: t.access, token_type: "Bearer", expires_in: t.expiresIn, refresh_token: t.refresh } };
    }
    if (grant === "refresh_token") {
      const app = this.apps.byRefresh(form.get("refresh_token") ?? "", clientId);
      if (!app) return tokenError("invalid_grant", "That refresh token isn't good any more. Sign in again.");
      const t = this.apps.issue(app.id);
      return { status: 200, json: { access_token: t.access, token_type: "Bearer", expires_in: t.expiresIn, refresh_token: t.refresh } };
    }
    return tokenError("unsupported_grant_type", "Only authorization_code and refresh_token are supported.");
  }
}
