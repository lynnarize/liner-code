# Plan 011: The engine checks who is calling before it reads a request, and answers only to its own address

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Refreshed on 2026-11-19 after a first attempt was blocked.** The first executor stopped, correctly, because an
> existing test sends a made-up `Host: x` to the webhook route and the new rule answered it 403. That made-up host
> is not what the test is about, so this version of the plan changes that one header (Step 2, part 3). Everything
> else is as before. The first attempt confirmed that the key-before-body half works.
>
> **Drift check (run first)**: `git diff --stat f4f3c84..HEAD -- engine/src/server.ts engine/src/main.ts engine/test/engine.test.ts engine/test/audit-api.test.ts`
> If any of these changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: MED (a wrong Host rule would lock the app out of its own engine)
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `f4f3c84`, 2026-11-19 (first written at `6970155`; `engine/src/server.ts` and `engine/src/main.ts` are unchanged since then)

## Why this matters

The engine is a small HTTP server on `127.0.0.1`. Two of its routes, `/surface` and `/outside`, are guarded by a key in a header instead of the app's token. Today they read and parse the whole request body, up to 64 MB, before they look at the key. Any web page open in the person's browser can send such a request (a plain POST needs no permission from the browser), and each one makes the engine's single thread buffer and parse 64 MB, which stalls every session.

Second, the server does not check the `Host` header. A web page can point a name it owns at `127.0.0.1` (this is called DNS rebinding); its requests then carry that name as `Host`. The Browser panel's proxy already refuses those; the engine itself does not. Nothing sensitive is reachable that way today, because everything sensitive needs a token or key, but the check is cheap and closes the door for any future route.

## Current state

- `engine/src/server.ts:82-92` (the body reader):

  ```ts
  const body = async (req: IncomingMessage) => {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > 64 * 1024 * 1024) throw new Error("That's too large to send.");
      chunks.push(c as Buffer);
    }
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
  };
  ```
- `engine/src/server.ts:102-105` (start of the request handler):

  ```ts
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = URL.parse(req.url ?? "/", "http://localhost");
    // "//" and the like aren't addresses at all.
    if (!url) return void res.writeHead(400).end("Bad request");
  ```
- `engine/src/server.ts:151-160`:

  ```ts
    if ((url.pathname === "/surface" || url.pathname === "/outside") && req.method === "POST") {
      const outside = url.pathname === "/outside";
      const take = outside ? o.outside : o.surface;
      if (!take) return void res.writeHead(404).end();
      try {
        const { tool, args } = (await body(req)) as { tool?: string; args?: Record<string, unknown> };
        const gone = new AbortController();
        res.on("close", () => res.writableEnded || gone.abort());
        const work = take(String(req.headers[outside ? "x-liner-outside" : "x-liner-surface"] ?? ""), String(tool ?? ""), args ?? {}, gone.signal);
        if (!work) return void res.writeHead(401).end("Unauthorized");
  ```
  `o` is the options object `startServer` receives; its type is declared near the top of the file together with `type Surface = (key: string, tool: string, args: Record<string, unknown>, gone?: AbortSignal) => Promise<unknown> | null;`.
- `engine/src/main.ts:184-188` (how the engine fills those options):

  ```ts
  surface: (key, tool, args, gone) => {
    const threadId = key ? tools.threadOf(key) : undefined;
    return threadId ? tools.call(threadId, tool, args, gone) : null;
  },
  outside: (key, tool, args) => (outside.now?.allows(key) ? outside.now.call(tool, args) : null),
  ```
  `tools.threadOf(key)` returns the session a key belongs to or `undefined`; `outside.now.allows(key)` compares in constant time.
- The check to copy, `engine/src/proxy.ts:86-90`:

  ```ts
  function addressed(server: Server, host?: string) {
    const a = server.address();
    const port = typeof a === "object" && a ? a.port : -1;
    return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
  }
  ```
- Who calls the engine and with which `Host`: the app's own page (served by the engine itself at `http://127.0.0.1:<port>`), the MCP servers (`tools.url = `http://127.0.0.1:${server.port}``, `engine/src/main.ts:195`), and in development Vite's proxy with `changeOrigin: true` and target `http://127.0.0.1:7317` (`ui/vite.config.ts:8-10`), which rewrites `Host` to the target's.
- `engine/test/engine.test.ts` already starts the real engine and checks a wrong token gets 401 (near line 419), and has a `get(url, headers)` helper (line 313) that sends a request with chosen headers and returns `{ status, body }`.

Conventions: TypeScript run directly by Node 24. Long hand-formatted lines; never run a formatter. Comments are plain sentences that say why. Every fix comes with a test that fails without it.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck -w engine` | exit 0 |
| Server tests | `node --test engine/test/engine.test.ts` | all pass |
| Tool-call tests | `node --test engine/test/providers.test.ts engine/test/outside.test.ts engine/test/panels.test.ts engine/test/dsh.test.ts engine/test/bundle.test.ts` | all pass |
| Engine suite | `npm run test:steady -w engine` | all pass (about 11 minutes) |

## Scope

**In scope**:
- `engine/src/server.ts`
- `engine/src/main.ts` (the `startServer({ … })` options only)
- `engine/test/engine.test.ts` (add tests)
- `engine/test/audit-api.test.ts`: one header in one test only (Step 2, part 3)

**Out of scope**:
- `engine/src/proxy.ts` (it already has its own check).
- The `/addon-check/…`, `/dsh/…`, `/hooks/…` and `/panel-frame` routes' own guards.
- The 64 MB limit itself: design frames sent through `/surface` can be large.
- Adding a Content-Security-Policy to the app page (deferred; it needs the running app to verify).

## Git workflow

- Stay on `design-and-api-endpoints`. One commit for this plan, a plain sentence (example from `git log`: `A Reviewer block reads as one, without a question's amber`). Do not push.

## Steps

### Step 1: Write the failing tests

In `engine/test/engine.test.ts`, beside the test that checks a wrong token gets 401 on the real engine, add two tests that use the same way of starting the engine and the same request helper:

1. `"the engine answers only requests addressed to itself: a page that points its own name at this machine is refused"`: a GET to `/health` with header `host: evil.example:<engine port>` → status `403`; the same GET with the normal host → `200`.
2. `"a tool call with no key or a wrong one is refused before its body is read"`: a POST to `/surface` with header `x-liner-surface: nope` and a body that is NOT valid JSON (for example the text `not json`) → status `401`. (Today the body is parsed first, so the answer is a 200 with an error about JSON; after the fix the key is refused first.) The same for `/outside` with `x-liner-outside: nope` → `401` or `404` (404 when outside access is off, which is the default).

**Verify**: `node --test engine/test/engine.test.ts` → the two new tests FAIL; the others pass.

### Step 2: Refuse a request not addressed to this server

In `engine/src/server.ts`:

1. Near the `authed` helper add:

   ```ts
   /**
     A request for this server itself. A web page that points a name of its own at 127.0.0.1 (DNS rebinding) sends that name
     as its Host, and would be read as the app's own origin: only this address is answered, as the Browser's proxy does
     (proxy.ts addressed).
   */
   const addressed = (host?: string) => {
     const a = server.address();
     const port = typeof a === "object" && a ? a.port : -1;
     return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
   };
   ```
   Use the name of the variable that holds the `createServer(...)` result in this file in place of `server` if it differs.
2. In `handle`, right after the `if (!url) …` line, add:
   `if (!addressed(req.headers.host)) return void res.writeHead(403).end("Forbidden");`
   It must come after the `if (!url)` line, not before: `engine/test/audit-api.test.ts:81` sends `GET //` with `Host: x` and expects 400, and that order keeps it passing unchanged.
3. Two tests in `engine/test/audit-api.test.ts` talk to the server over a raw socket with a made-up `Host: x`. The one at line 81 keeps passing (see part 2). The one at lines 87-98, "server: a webhook that throws is answered, not left hanging", posts to `/hooks/r/abc` and expects 500; with the new rule it would get 403 before reaching the webhook. The made-up host is not what that test is about, so give it the server's real address. Change its request line from

   ```ts
   assert.match(await raw(server.port, "POST /hooks/r/abc?key=k HTTP/1.1\r\nHost: x\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}"), /^HTTP\/1\.1 500/);
   ```
   to

   ```ts
   // Addressed to the server itself, as a real webhook is: one sent under another name is turned away before it gets here.
   assert.match(await raw(server.port, `POST /hooks/r/abc?key=k HTTP/1.1\r\nHost: 127.0.0.1:${server.port}\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}`), /^HTTP\/1\.1 500/);
   ```
   Change nothing else in that file.

**Verify**: `node --test engine/test/engine.test.ts` → the first new test passes and no older test fails.

### Step 3: Check the key before reading the body

1. In `engine/src/server.ts`, add to the type of the options `startServer` takes, beside `surface` and `outside`:

   ```ts
   /** Whether a key is one of ours, asked before a call's body is read: a caller without one isn't worth 64 MB of reading. Unset: the call itself says. */
   knows?: { surface(key: string): boolean; outside(key: string): boolean };
   ```
2. In the `/surface` and `/outside` branch, after the `if (!take) …` line and before the `try {`, add:

   ```ts
   const key = String(req.headers[outside ? "x-liner-outside" : "x-liner-surface"] ?? "");
   // The key first: any page in a browser can post here, and its body is read only once it has shown a key of ours.
   if (o.knows && !(outside ? o.knows.outside(key) : o.knows.surface(key))) return void res.writeHead(401).end("Unauthorized");
   ```
   and inside the `try` use `key` in the `take(…)` call instead of reading the header again.
3. In `engine/src/main.ts`, add to the `startServer({ … })` options, after `outside: …`:

   ```ts
   knows: { surface: (key) => Boolean(key && tools.threadOf(key)), outside: (key) => Boolean(outside.now?.allows(key)) },
   ```

**Verify**: `npm run typecheck -w engine` → exit 0; `node --test engine/test/engine.test.ts` → all pass.

### Step 4: Nothing that calls the engine is locked out

**Verify**: `node --test engine/test/providers.test.ts engine/test/outside.test.ts engine/test/panels.test.ts engine/test/dsh.test.ts engine/test/bundle.test.ts engine/test/addons.test.ts engine/test/live-frames.test.ts` → all pass. Then `npm run test:steady -w engine` → all pass.

## Test plan

Two new tests in `engine/test/engine.test.ts` (Step 1), on the real engine process the file already starts. They fail before Steps 2-3.

## Done criteria

- [ ] `npm run typecheck -w engine` exits 0
- [ ] The two new tests exist and pass
- [ ] `npm run test:steady -w engine` passes
- [ ] `git status --short` shows no modified file outside the three in scope
- [ ] `plans/README.md` status row updated, with "the packaged app and `npm run dev` were not opened" noted

## STOP conditions

- Any existing test other than the one named in Step 2, part 3 fails with status 403 after Step 2. That means something legitimate calls the engine under another host name; report which test and which `Host`, and do not widen the rule yourself.
- The file has no single variable for the server that `handle` can reach.
- A test starts `startServer` without `knows` and now fails for that reason (it should not: `knows` is optional).

## Maintenance notes

- If the engine is ever reached under another name (a `.localhost` name, a relay), `addressed` must learn that name explicitly.
- Not opened on screen: the packaged app, `npm run dev` (Vite's proxy) and `npm run app:dev`. The owner should open each once; a blank window or "Forbidden" means the Host rule is too narrow for that path.
- Deferred, same area: `/addon-check/<token>/call` and `/report` also read a body before checking that the token is known; a plugin's answers on `/dsh/<token>/…` are served on the engine's own origin without a sandbox policy; the app page has no Content-Security-Policy. Each needs the running app to verify.
