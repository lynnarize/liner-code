/*
  Liner MCP's OAuth: registration signs what the app said into its id, /authorize asks nothing in the browser and waits for
  your answer in the app, a code goes only to the verifier that made it and only once, and refresh tokens are used up as
  they're used. Run with `node --test engine/test/mcp-oauth.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpApps } from "../src/mcp-apps.ts";
import { CARD_RATE, EXPECT_WINDOW, McpOAuth, REGISTER_RATE, SIGN_IN_WAIT, redirectMatches, urlsOf } from "../src/mcp-oauth.ts";

const urls = urlsOf("https://liner.tail1234.ts.net");
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

function rig(now?: () => number, expect: "claude" | "other" | null = "claude") {
  const home = mkdtempSync(join(tmpdir(), "lc-mcp-oauth-"));
  const apps = new McpApps(home, now);
  const oauth = new McpOAuth(apps, now);
  let changes = 0;
  oauth.onChange = () => void changes++;
  if (expect) oauth.expect(expect);
  const reg = oauth.register({ client_name: "Claude", redirect_uris: [REDIRECT] });
  const clientId = (reg.json as { client_id: string }).client_id;
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorize = (extra: Record<string, string> = {}) => oauth.authorize(new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state: "s1", resource: urls.resource, ...extra }), urls);
  return { home, apps, oauth, clientId, verifier, challenge, authorize, changes: () => changes };
}
const pendingOf = (location: string) => new URL(location, urls.issuer).searchParams.get("pending")!;

test("Registration takes only https or loopback redirects and stores nothing", () => {
  const { oauth, home } = rig();
  assert.equal(oauth.register({ client_name: "x", redirect_uris: ["http://evil.example/cb"] }).status, 400);
  assert.equal(oauth.register({ client_name: "x", redirect_uris: [] }).status, 400);
  assert.equal(oauth.register({ client_name: "x", redirect_uris: ["https://a.example/cb#x"] }).status, 400);
  assert.equal(oauth.register({ client_name: "x", redirect_uris: ["http://127.0.0.1:9999/cb"] }).status, 201);
  assert.equal(JSON.parse(readFileSync(join(home, "mcp-apps.json"), "utf8")).apps.length, 0);
  assert.equal(redirectMatches("http://127.0.0.1:1/cb", "http://127.0.0.1:2/cb"), true, "loopback ports may change");
  assert.equal(redirectMatches("https://a.example/cb", "https://a.example/cb2"), false);
});

test("/authorize asks nothing in the browser: it waits for your answer in the app, then sends a code back", () => {
  const { oauth, authorize, changes } = rig();
  const first = authorize();
  assert.equal(first.status, 302);
  const id = pendingOf(first.headers!.location);
  assert.ok(changes() > 0, "the app is told a sign-in waits");
  const [card] = oauth.list();
  assert.deepEqual({ name: card.clientName, expect: card.expect, host: card.redirectHost }, { name: "Claude", expect: "claude", host: "claude.ai" });
  const waiting = oauth.authorize(new URLSearchParams({ pending: id }), urls);
  assert.equal(waiting.status, 200);
  assert.match(waiting.html!, /Allow it in Liner Code/);
  assert.doesNotMatch(waiting.html!, /<form|<button|<script/i, "nothing to click in the browser");
  oauth.decide(id, true, "ask");
  const back = oauth.authorize(new URLSearchParams({ pending: id }), urls);
  assert.equal(back.status, 302);
  const to = new URL(back.headers!.location);
  assert.equal(`${to.origin}${to.pathname}`, REDIRECT);
  assert.equal(to.searchParams.get("state"), "s1");
  assert.equal(to.searchParams.get("iss"), urls.issuer);
  assert.ok(to.searchParams.get("code"));
  assert.equal(oauth.authorize(new URLSearchParams({ pending: id }), urls).status, 400, "answered once");
});

test("Denied in the app, the browser goes back with access_denied", () => {
  const { oauth, authorize } = rig();
  const id = pendingOf(authorize().headers!.location);
  oauth.decide(id, false);
  const to = new URL(oauth.authorize(new URLSearchParams({ pending: id }), urls).headers!.location);
  assert.equal(to.searchParams.get("error"), "access_denied");
  assert.equal(to.searchParams.get("code"), null);
});

test("An unknown app or redirect is said on the page, never followed; no PKCE goes back as an error", () => {
  const { authorize } = rig();
  assert.equal(authorize({ client_id: "forged.sig" }).status, 400);
  assert.equal(authorize({ redirect_uri: "https://evil.example/cb" }).status, 400);
  const noPkce = authorize({ code_challenge_method: "plain" });
  assert.equal(noPkce.status, 302);
  assert.equal(new URL(noPkce.headers!.location).searchParams.get("error"), "invalid_request");
  assert.equal(new URL(authorize({ resource: "https://other.example/mcp" }).headers!.location).searchParams.get("error"), "invalid_target");
});

test("A code is good once, only with its verifier, and makes an app at the level you chose with hashed tokens", () => {
  const { oauth, apps, authorize, clientId, verifier, home } = rig();
  const id = pendingOf(authorize().headers!.location);
  oauth.decide(id, true, "read");
  const code = new URL(oauth.authorize(new URLSearchParams({ pending: id }), urls).headers!.location).searchParams.get("code")!;
  const bad = oauth.token(new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId, code_verifier: randomBytes(32).toString("base64url"), redirect_uri: REDIRECT }));
  assert.equal(bad.status, 400);
  // A wrong verifier used the code up: the right one now is too late.
  assert.equal(oauth.token(new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId, code_verifier: verifier, redirect_uri: REDIRECT })).status, 400);

  // Allowing the first sign-in closed its window: you start adding the app again.
  oauth.expect("claude");
  const id2 = pendingOf(authorize().headers!.location);
  oauth.decide(id2, true, "read");
  const code2 = new URL(oauth.authorize(new URLSearchParams({ pending: id2 }), urls).headers!.location).searchParams.get("code")!;
  const ok = oauth.token(new URLSearchParams({ grant_type: "authorization_code", code: code2, client_id: clientId, code_verifier: verifier, redirect_uri: REDIRECT }));
  assert.equal(ok.status, 200);
  const t = ok.json as { access_token: string; refresh_token: string; expires_in: number };
  assert.equal(t.expires_in, 3600);
  const app = apps.verify(t.access_token)!;
  assert.equal(app.level, "read");
  assert.equal(app.kind, "claude");
  assert.equal(app.auth, "oauth");
  const disk = readFileSync(join(home, "mcp-apps.json"), "utf8");
  assert.equal(disk.includes(t.access_token) || disk.includes(t.refresh_token), false);
  assert.equal(oauth.token(new URLSearchParams({ grant_type: "authorization_code", code: code2, client_id: clientId, code_verifier: verifier, redirect_uri: REDIRECT })).status, 400, "used once");

  // Refreshed: new tokens, and the refresh token used is used up.
  const r = oauth.token(new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: clientId }));
  assert.equal(r.status, 200);
  assert.equal(oauth.token(new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: clientId })).status, 400);
  assert.equal(oauth.token(new URLSearchParams({ grant_type: "refresh_token", refresh_token: (r.json as { refresh_token: string }).refresh_token, client_id: "someone-else" })).status, 400);
  // Revoked, none of its tokens work.
  apps.revoke(app.id);
  assert.equal(apps.verify((r.json as { access_token: string }).access_token), undefined);
});

test("A code is exchanged only with the redirect_uri it was given for, never without one", () => {
  const { oauth, authorize, clientId, verifier } = rig();
  const codeFor = () => {
    oauth.expect("claude");
    const id = pendingOf(authorize().headers!.location);
    oauth.decide(id, true, "read");
    return new URL(oauth.authorize(new URLSearchParams({ pending: id }), urls).headers!.location).searchParams.get("code")!;
  };
  const left = oauth.token(new URLSearchParams({ grant_type: "authorization_code", code: codeFor(), client_id: clientId, code_verifier: verifier }));
  assert.equal(left.status, 400, "RFC 6749 4.1.3: /authorize had one, so /token must send it");
  assert.equal((left.json as { error: string }).error, "invalid_request");
  assert.equal(oauth.token(new URLSearchParams({ grant_type: "authorization_code", code: codeFor(), client_id: clientId, code_verifier: verifier, redirect_uri: `${REDIRECT}/` })).status, 400, "only the very same one");
  assert.equal(oauth.token(new URLSearchParams({ grant_type: "authorization_code", code: codeFor(), client_id: clientId, code_verifier: verifier, redirect_uri: REDIRECT })).status, 200);
});

test("An access token runs out after an hour, and a sign-in nobody answers after ten minutes", () => {
  let now = 5_000_000;
  const { oauth, apps, authorize, clientId, verifier } = rig(() => now);
  const id = pendingOf(authorize().headers!.location);
  oauth.decide(id, true, "trusted");
  const code = new URL(oauth.authorize(new URLSearchParams({ pending: id }), urls).headers!.location).searchParams.get("code")!;
  const t = oauth.token(new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId, code_verifier: verifier, redirect_uri: REDIRECT })).json as { access_token: string };
  now += 3_600_001;
  assert.equal(apps.verify(t.access_token), undefined);
  oauth.expect("claude");
  authorize();
  assert.equal(oauth.list().length, 1);
  now += SIGN_IN_WAIT + 1;
  assert.equal(oauth.list().length, 0);
});

test("No more than five sign-ins wait at once", () => {
  const { authorize } = rig();
  for (let i = 0; i < 5; i++) assert.equal(authorize().status, 302);
  assert.equal(authorize().status, 400);
});

test("No sign-in is taken unless you started adding an app that signs in itself, in the last 15 minutes", () => {
  let now = 9_000_000;
  const cold = rig(() => now, null);
  const r = cold.authorize();
  assert.equal(r.status, 400);
  assert.match(r.html!, /Start this sign-in from Liner Code › Settings › Liner MCP › Add an app/);
  assert.equal(cold.oauth.list().length, 0, "no card");
  cold.oauth.expect("claude");
  assert.equal(cold.authorize().status, 302);
  now += EXPECT_WINDOW + 1;
  assert.equal(cold.authorize().status, 400, "the window closed");
});

test("A signed-in app's kind and logo come from what you picked, never from the name it gives", () => {
  const { oauth, apps, authorize, clientId, verifier } = rig(undefined, "other");
  const id = pendingOf(authorize().headers!.location);
  assert.equal(oauth.list()[0].expect, "other");
  assert.equal("kind" in oauth.list()[0], false);
  oauth.decide(id, true, "read");
  const code = new URL(oauth.authorize(new URLSearchParams({ pending: id }), urls).headers!.location).searchParams.get("code")!;
  const t = oauth.token(new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId, code_verifier: verifier, redirect_uri: REDIRECT })).json as { access_token: string };
  const app = apps.verify(t.access_token)!;
  assert.equal(app.kind, "other", "it called itself Claude, but you added another app");
  assert.equal(app.name, "Claude (as it calls itself)");
});

test("Sign-ins refused before a card don't count, so nobody can use up the limit to keep yours out", () => {
  const { oauth, authorize } = rig(undefined, null);
  // Outside the window, with a forged app, or with no PKCE: refused, and none of it counted.
  for (let i = 0; i < CARD_RATE * 5; i++) assert.equal(authorize().status, 400);
  oauth.expect("claude");
  for (let i = 0; i < CARD_RATE * 5; i++) authorize({ client_id: "forged.sig" });
  assert.equal(authorize().status, 302, "your own sign-in still makes its card");
});

test("Only so many cards a minute are made, and registrations have a larger count of their own", () => {
  let now = 1_000_000;
  const { oauth, authorize } = rig(() => now);
  let made = 0;
  for (let round = 0; round < 3; round++) {
    for (const s of oauth.list()) oauth.decide(s.id, false);
    for (let i = 0; i < 5; i++) if (authorize().status === 302) made++;
    oauth.expect("claude");
  }
  assert.equal(made, CARD_RATE);
  now += 60_001;
  for (const s of oauth.list()) oauth.decide(s.id, false);
  oauth.expect("claude");
  assert.equal(authorize().status, 302, "a minute on, it takes them again");
  for (let i = 0; i < REGISTER_RATE; i++) assert.equal(oauth.register({ client_name: "x", redirect_uris: ["https://a.example/cb"] }).status, 201);
  assert.equal(oauth.register({ client_name: "x", redirect_uris: ["http://evil.example/cb"] }).status, 400);
  assert.equal(oauth.register({ client_name: "x", redirect_uris: ["https://a.example/cb"] }).status, 429, "a refused registration didn't count");
});

test("Allowing a sign-in closes the window it came through", () => {
  const { oauth, authorize } = rig();
  const id = pendingOf(authorize().headers!.location);
  oauth.decide(id, true, "read");
  const r = authorize();
  assert.equal(r.status, 400);
  assert.match(r.html!, /expecting a sign-in/);
});
