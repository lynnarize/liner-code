/*
  Liner MCP's apps and the gate every call goes through (T3 Code: apps/server/src/mcp/McpToolAccess.ts, auth/McpOAuth.ts).

  McpApps keeps the apps let in, in ~/.liner-code/mcp-apps.json (LINER_HOME moves it), readable only by you. An app's key
  ("lc_" and 32 random bytes) and its OAuth tokens are never kept: only their SHA-256, compared in constant time. A key is
  shown once, when it's made. Each app has a level and runs out after 30 days; Revoke ends it at once.

  McpGate holds every call to its app's level, whichever door it came in by (the stdio server or the app listener): the tool
  must be one the level allows; at Asks first a start, send, scan or stop waits for your Allow on a card in the app (ten
  minutes, then it's refused); sessions an app starts run at Manual there, and at your default access but never Full access
  when it's trusted. An app never answers a permission ask or changes a setting: there is no tool for either. Each call is
  logged by app, tool and outcome, never with what it said, and an app gets 60 calls a minute.
*/
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Access, Thread } from "../../contracts/src/index.ts";
import { ACCESS_NAMES } from "../../contracts/src/index.ts";
import { MCP_KIND_NAMES, MCP_LEVEL_NAMES, mcpLevelAtLeast, type McpApp, type McpAppKind, type McpAsk, type McpLevel } from "../../contracts/src/mcp.ts";
import type { McpResult } from "./agent-tools.ts";
import { toolDef } from "./mcp-tools.ts";
import type { CallCtx } from "./outside-tools.ts";

const DAY = 86_400_000;
/** How long a key or a sign-in lasts unless revoked. */
export const APP_DAYS = 30;
/** An OAuth access token's life: short, so a revoked or expired app stops within the hour even if a check were missed. */
export const ACCESS_TTL = 3_600_000;
/** How long an ask waits for you before it's refused. */
export const ASK_WAIT = 10 * 60_000;
/** Calls an app may make in a minute. */
export const RATE = 60;

/** One app as kept on disk: what Settings shows, plus the hashes that let it in. */
export type StoredApp = McpApp & {
  /** SHA-256 (hex) of its key, for an app added with a key. */
  keyHash?: string;
  /** Its OAuth tokens' hashes: access tokens with when each runs out, and the one refresh token it holds now. */
  tokens?: { hash: string; exp: number }[];
  refreshHash?: string;
  clientId?: string;
  /** A terminal agent on stdio, by the name it gave (its clientInfo): no key of its own, the outside.json key lets it in. */
  client?: string;
  /** A terminal agent you revoked: refused by that name until you let terminal agents in again. */
  blocked?: boolean;
};
type File = { v: 1; secret: string; apps: StoredApp[] };

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
/** Two hex hashes alike, in constant time. */
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
/** A name an app gave itself, safe to show and to log: no control characters, short. */
export const cleanName = (s: unknown, fallback: string) => String(s ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || fallback;

/** What Settings is told of an app: never a hash. */
export const shown = (a: StoredApp): McpApp => ({ id: a.id, name: a.name, kind: a.kind, level: a.level, via: a.via, createdAt: a.createdAt, expiresAt: a.expiresAt, ...(a.lastCallAt ? { lastCallAt: a.lastCallAt } : {}), ...(a.lastTool ? { lastTool: a.lastTool } : {}), keyEnd: a.keyEnd, auth: a.auth, ...(a.blocked ? { blocked: true } : {}) });

export class McpApps {
  readonly file: string;
  private now: () => number;
  private data: File;
  private saving: NodeJS.Timeout | undefined;
  /** Told when an app goes (revoked or run out), so its open calls and streams end with it. */
  onGone: (id: string) => void = () => {};
  /** Told when the list changes, for Settings. */
  onChange: () => void = () => {};

  constructor(home: string, now: () => number = Date.now) {
    this.file = join(home, "mcp-apps.json");
    this.now = now;
    this.data = this.load();
  }

  private load(): File {
    try {
      const d = JSON.parse(readFileSync(this.file, "utf8")) as Partial<File>;
      if (d && typeof d.secret === "string" && d.secret.length >= 32 && Array.isArray(d.apps)) return { v: 1, secret: d.secret, apps: d.apps.filter((a) => a && typeof a.id === "string") };
    } catch {
      // None yet, or unreadable: a fresh one. Keys made before are gone with it, which only means adding those apps again.
    }
    return { v: 1, secret: randomBytes(32).toString("hex"), apps: [] };
  }

  /** Written whole and readable only by you: into a file beside it made 0600 from the start, then renamed over it. */
  save() {
    clearTimeout(this.saving);
    this.saving = undefined;
    if (!existsSync(dirname(this.file))) mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 1), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.file);
  }
  /** A call's last-seen time is saved a moment later, so sixty calls a minute aren't sixty writes. */
  private saveSoon() {
    this.saving ??= setTimeout(() => this.save(), 2000);
    this.saving.unref?.();
  }

  /** The secret OAuth client ids are signed with (mcp-oauth.ts): made once, kept beside the apps. */
  get secret() {
    if (!existsSync(this.file)) this.save();
    return this.data.secret;
  }

  /** Apps you can see in Settings: those still good, and those run out in the last week (shown with no days left). */
  list(): McpApp[] {
    const now = this.now();
    const before = this.data.apps.length;
    this.data.apps = this.data.apps.filter((a) => a.via === "stdio" || a.expiresAt > now - 7 * DAY);
    if (this.data.apps.length !== before) this.save();
    return this.data.apps.map(shown);
  }

  get(id: string): StoredApp | undefined {
    return this.data.apps.find((a) => a.id === id);
  }

  /** A new app with a key: the key is returned once, here, and kept only as its hash. */
  create(o: { name: string; kind: McpAppKind; level: McpLevel; days?: number }): { app: McpApp; key: string } {
    const key = `lc_${randomBytes(32).toString("base64url")}`;
    const now = this.now();
    const app: StoredApp = { id: `app_${randomUUID().slice(0, 8)}`, name: cleanName(o.name, MCP_KIND_NAMES[o.kind]), kind: o.kind, level: o.level, via: "internet", createdAt: now, expiresAt: now + (o.days ?? APP_DAYS) * DAY, keyEnd: key.slice(-4), auth: "key", keyHash: sha256(key) };
    this.data.apps.push(app);
    this.save();
    this.onChange();
    return { app: shown(app), key };
  }

  /**
    An app signed in through OAuth, at the level you chose on its card; its tokens come from issue(). Its kind is the app you
    picked in Add an app (never what it calls itself), and so is its name unless you picked Another app.
  */
  createOAuth(o: { name: string; kind: McpAppKind; level: McpLevel; clientId: string }): StoredApp {
    const now = this.now();
    const name = o.kind === "other" ? `${cleanName(o.name, "An app")} (as it calls itself)` : MCP_KIND_NAMES[o.kind];
    const app: StoredApp = { id: `app_${randomUUID().slice(0, 8)}`, name, kind: o.kind, level: o.level, via: "internet", createdAt: now, expiresAt: now + APP_DAYS * DAY, keyEnd: "", auth: "oauth", clientId: o.clientId, tokens: [] };
    this.data.apps.push(app);
    this.save();
    this.onChange();
    return app;
  }

  /** A fresh access token (an hour) and refresh token for an OAuth app; the refresh token it held before stops working. */
  issue(id: string): { access: string; refresh: string; expiresIn: number } {
    const a = this.get(id);
    if (!a || a.auth !== "oauth") throw new Error("No such app.");
    const now = this.now();
    const access = `lca_${randomBytes(32).toString("base64url")}`;
    const refresh = `lcr_${randomBytes(32).toString("base64url")}`;
    a.tokens = [...(a.tokens ?? []).filter((t) => t.exp > now), { hash: sha256(access), exp: now + ACCESS_TTL }].slice(-5);
    a.refreshHash = sha256(refresh);
    a.keyEnd = access.slice(-4);
    this.save();
    return { access, refresh, expiresIn: ACCESS_TTL / 1000 };
  }

  /** The OAuth app a refresh token belongs to, for that client, while it's good; the token is used up by the issue() that follows. */
  byRefresh(token: string, clientId: string): StoredApp | undefined {
    if (!token.startsWith("lcr_")) return undefined;
    const h = sha256(token);
    const now = this.now();
    let hit: StoredApp | undefined;
    for (const a of this.data.apps) if (a.auth === "oauth" && a.refreshHash && same(a.refreshHash, h) && a.clientId === clientId && a.expiresAt > now) hit = a;
    return hit;
  }

  /** The app a bearer (a key or an access token) lets in, while it's good. Every app is compared, so how long it takes says nothing. */
  verify(bearer: string): StoredApp | undefined {
    if (!bearer || bearer.length > 200 || !/^lca?_/.test(bearer)) return undefined;
    const h = sha256(bearer);
    const now = this.now();
    let hit: StoredApp | undefined;
    for (const a of this.data.apps) {
      if (a.via === "stdio" || a.expiresAt <= now) continue;
      if (a.keyHash && same(a.keyHash, h)) hit = a;
      for (const t of a.tokens ?? []) if (same(t.hash, h) && t.exp > now) hit = a;
    }
    return hit;
  }

  /** A terminal agent on stdio by the name it gave: kept so Settings lists it, made the first time it calls. */
  stdio(client: string): StoredApp {
    const name = cleanName(client, "Terminal agent");
    let a = this.data.apps.find((x) => x.via === "stdio" && x.client === name);
    if (!a) {
      const now = this.now();
      a = { id: `app_${randomUUID().slice(0, 8)}`, name: prettyClient(name), kind: "terminal", level: "trusted", via: "stdio", createdAt: now, expiresAt: 0, keyEnd: "", auth: "key", client: name };
      this.data.apps.push(a);
      this.save();
      this.onChange();
    }
    return a;
  }

  /** Terminal agents let in again (Let apps outside Liner Code in, switched on): the ones you turned away are forgotten. */
  unblockStdio() {
    const before = this.data.apps.length;
    this.data.apps = this.data.apps.filter((a) => !(a.via === "stdio" && a.blocked));
    if (before !== this.data.apps.length) (this.save(), this.onChange());
  }

  /** One terminal agent you turned away, let in again. */
  unblock(id: string) {
    const a = this.get(id);
    if (!a || a.via !== "stdio" || !a.blocked) throw new Error("That agent isn't turned away.");
    delete a.blocked;
    this.save();
    this.onChange();
  }

  /** Your own name for an app (two "Another app"s told apart). */
  rename(id: string, name: string) {
    const a = this.get(id);
    if (!a) throw new Error("That app isn't let in any more.");
    const n = cleanName(name, "");
    if (!n) throw new Error("Give it a name.");
    a.name = n;
    this.save();
    this.onChange();
    return shown(a);
  }

  /** "Another app", then "Another app 2" and on: the first name of that kind no app has yet. */
  freeName(base: string) {
    const taken = new Set(this.data.apps.map((a) => a.name));
    if (!taken.has(base)) return base;
    for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`)) return `${base} ${i}`;
  }

  setLevel(id: string, level: McpLevel) {
    const a = this.get(id);
    if (!a) throw new Error("That app isn't let in any more.");
    a.level = level;
    this.save();
    this.onChange();
    return shown(a);
  }

  /** Ends an app at once: its key or tokens stop working, and its open calls and streams end (onGone). */
  revoke(id: string) {
    const a = this.get(id);
    if (!a) return false;
    /*
      A terminal agent has no key of its own to take back: it's refused by the name it gives from now on, and stays listed so
      you can let it in again. That's a request, not a lock: anything running as you can read outside.json and call under
      another name, and a new key wouldn't change it (the stdio server reads the file at every call). Switching Let apps in
      off is what stops every terminal agent.
    */
    if (a.via === "stdio") a.blocked = true;
    else this.data.apps = this.data.apps.filter((x) => x.id !== id);
    this.save();
    this.onGone(id);
    this.onChange();
    return true;
  }

  touch(id: string, tool: string) {
    const a = this.get(id);
    if (!a) return;
    a.lastCallAt = this.now();
    a.lastTool = tool;
    this.saveSoon();
    this.onChange();
  }

  flush() {
    if (this.saving) this.save();
  }
}

/** "claude-code" as people call it. */
function prettyClient(name: string) {
  const known: Record<string, string> = { "claude-code": "Claude Code", codex: "Codex", "codex-mcp-client": "Codex", hermes: "Hermes", opencode: "OpenCode", gemini: "Gemini CLI" };
  return known[name.toLowerCase()] ?? name;
}

const fail = (t: string): McpResult => ({ content: [{ type: "text", text: t }], isError: true });

/** What runs a call once the gate lets it through: outside-tools.ts Outside. */
type Runner = { call(tool: string, args: Record<string, unknown>, ctx: CallCtx): Promise<McpResult>; thread(id: unknown): Thread; project(ref: unknown): { id: string; name: string }; /** The question a session asks now, in its words, if it asks one an app may answer. */ question(threadId: string): string | undefined; /** Why an app may not answer what it asks now (a choice an MCP server asks), if that's why. */ unanswerable?(threadId: string): string | undefined };
/** What an app that's trusted may let its sessions do: your default, but never Full access (Edits on its own instead). */
export const trustedAccess = (dflt: Access): Access => (dflt === "full" ? "edits" : dflt);

export type GateOptions = {
  apps: McpApps;
  runner: Runner;
  /** Your default access, for a trusted app's sessions. */
  defaultAccess: () => Access;
  /** What a terminal agent may do (Settings › Liner MCP; Trusted when unset). */
  stdioLevel: () => McpLevel;
  /** Who runs a session, by name ("Claude Code · Sonnet 5.5"), and its model ref for the tool's mark, for the card. */
  runsOn?: (threadId: string) => string;
  runsOnRef?: (threadId: string) => string | undefined;
  /** The asks changed: the app draws its cards again. */
  onAsks?: () => void;
  /** Trust from now on, for a terminal agent: their level is a setting, not the app's own. */
  trustStdio?: () => void;
  log?: (line: string) => void;
  now?: () => number;
};

export class McpGate {
  private o: GateOptions;
  private now: () => number;
  private asks = new Map<string, { ask: McpAsk; done: (allow: boolean) => void }>();
  private calls = new Map<string, number[]>();

  constructor(o: GateOptions) {
    this.o = o;
    this.now = o.now ?? Date.now;
  }

  /** The asks waiting for you, oldest first. */
  list(): McpAsk[] {
    return [...this.asks.values()].map((x) => x.ask);
  }

  /** Your answer on a card. `trust`: from now on this app asks no more (it becomes Trusted). */
  decide(id: string, allow: boolean, trust?: boolean) {
    const a = this.asks.get(id);
    if (!a) throw new Error("That ask isn't waiting any more.");
    if (allow && trust) {
      const app = this.o.apps.get(a.ask.appId);
      if (app?.via === "stdio") this.o.trustStdio?.();
      else if (app) this.o.apps.setLevel(app.id, "trusted");
    }
    a.done(allow);
  }

  /** An app gone: what it was asking goes too, refused. */
  dropApp(appId: string) {
    for (const a of [...this.asks.values()]) if (a.ask.appId === appId) a.done(false);
  }

  /** The level an app holds now: a terminal agent's is the setting's, never above it. */
  levelOf(app: StoredApp): McpLevel {
    return app.via === "stdio" ? this.o.stdioLevel() : app.level;
  }

  private log(app: StoredApp, tool: string, outcome: string) {
    // Its name, the tool and how it went: never its words, its key, or what came back.
    (this.o.log ?? ((l: string) => console.error(l)))(`[mcp] ${cleanName(app.name, "app")} ${/^[a-z_]{1,40}$/.test(tool) ? tool : "(unknown tool)"} ${outcome}`);
  }

  private limited(id: string) {
    const now = this.now();
    const recent = (this.calls.get(id) ?? []).filter((t) => now - t < 60_000);
    recent.push(now);
    this.calls.set(id, recent);
    return recent.length > RATE;
  }

  /** Waits for your Allow on a card: true on Allow, false on Deny, after ten minutes, or once the caller has gone. */
  private ask(app: StoredApp, tool: string, o: { summary: string; project?: string; message?: string; threadId?: string; runsOn?: string; access?: Access }, gone?: AbortSignal): Promise<boolean> {
    if (gone?.aborted) return Promise.resolve(false);
    const id = randomUUID();
    const ask: McpAsk = { id, appId: app.id, appName: app.name, appKind: app.kind, tool, summary: o.summary, at: this.now(), ...(o.project ? { project: o.project } : {}), ...(o.message ? { message: o.message.slice(0, 2000) } : {}), ...(o.threadId ? { threadId: o.threadId } : {}), ...(o.runsOn ? { runsOn: o.runsOn } : {}), ...(o.threadId && this.o.runsOnRef?.(o.threadId) ? { runsOnRef: this.o.runsOnRef(o.threadId) } : {}), ...(o.access ? { access: o.access === "ask" ? "Manual: every change asks you here" : ACCESS_NAMES[o.access] } : {}) };
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => done(false), ASK_WAIT);
      timer.unref?.();
      const onGone = () => done(false);
      const done = (allow: boolean) => {
        if (!this.asks.delete(id)) return;
        clearTimeout(timer);
        gone?.removeEventListener("abort", onGone);
        this.o.onAsks?.();
        resolve(allow);
      };
      gone?.addEventListener("abort", onGone, { once: true });
      this.asks.set(id, { ask, done });
      this.o.onAsks?.();
    });
  }

  /**
    One call from an app, start to end. `waitMax`: how long liner_wait may hold it (55 seconds on the internet, 240 on stdio).
    Whatever the app was shown, it's checked here again.
  */
  async call(app: StoredApp, tool: string, args: Record<string, unknown>, o: { gone?: AbortSignal; waitMax: number }): Promise<McpResult> {
    const def = toolDef(tool);
    if (!def) return this.log(app, tool, "refused: no such tool"), fail(`Liner Code has no tool called ${tool}.`);
    // Gone since its call was let in (revoked, run out): nothing more.
    const live = this.o.apps.get(app.id);
    if (!live || live.blocked || (live.via !== "stdio" && live.expiresAt <= this.now())) return this.log(app, tool, "refused: revoked"), fail("Liner Code doesn't let this app in any more.");
    if (this.limited(app.id)) return this.log(app, tool, "refused: too many calls"), fail("That's more than 60 calls in a minute. Wait a moment and try again.");
    const level = this.levelOf(live);
    if (!mcpLevelAtLeast(level, def.level)) {
      this.log(live, tool, "refused: level");
      return fail(`${live.name} may only read (${MCP_LEVEL_NAMES[level]}). The person can let it do more in Liner Code › Settings › Liner MCP.`);
    }
    this.o.apps.touch(live.id, tool);
    const startedBy = { appId: live.id, name: live.name, kind: live.kind };
    const ctx: CallCtx = { gone: o.gone, waitMax: o.waitMax, appId: live.id, startedBy, access: level === "trusted" ? trustedAccess(this.o.defaultAccess()) : "ask" };
    try {
      let asked = false;
      if (level === "ask" && def.asks && tool !== "liner_start") {
        // Asked about before anything is done: what it names must be there, or the card would ask about nothing.
        const card = this.card(tool, args);
        if ("error" in card) return this.log(live, tool, "error"), fail(card.error);
        asked = true;
        if (!(await this.ask(live, tool, card, o.gone))) return this.log(live, tool, "denied"), fail("The person didn't allow it in Liner Code.");
      }
      // The session it messages or answers runs at Full access: that's more than an app is ever given, so it asks, whatever its level.
      if (!asked && (tool === "liner_send" || tool === "liner_answer")) {
        const t = this.o.runner.thread(args.session);
        if (t.access === "full") {
          const card = this.card(tool, args);
          if ("error" in card) return fail(card.error);
          if (!(await this.ask(live, tool, { ...card, summary: `It wants to ${tool === "liner_send" ? "message" : "answer"} a session that runs at Full access.` }, o.gone))) return this.log(live, tool, "denied"), fail("The person didn't allow it in Liner Code.");
        }
      }
      if (tool === "liner_start" && level === "ask") {
        ctx.startedBy = { ...startedBy, asks: true };
        ctx.allowStart = (t, message) => this.ask(live, tool, { summary: "It wants to start a session.", project: this.projectName(t.projectId), message, threadId: t.id, runsOn: this.o.runsOn?.(t.id), access: t.access }, o.gone);
      }
      const r = await this.o.runner.call(tool, args, ctx);
      this.log(live, tool, r.isError ? "error" : "ok");
      return r;
    } catch (e) {
      this.log(live, tool, "error");
      return fail(e instanceof Error ? e.message : String(e));
    }
  }

  private projectName(id: string) {
    try {
      return this.o.runner.project(id).name;
    } catch {
      return undefined;
    }
  }

  /** What a card says for a send, an answer, a scan or a stop. */
  private card(tool: string, args: Record<string, unknown>): { summary: string; project?: string; message?: string; threadId?: string; runsOn?: string; access?: Access } | { error: string } {
    try {
      if (tool === "liner_scan") {
        const p = this.o.runner.project(args.project);
        const name = args.pr !== undefined ? `pull request #${Math.floor(Number(args.pr))}` : args.issue !== undefined ? `issue ${String(args.issue).slice(0, 40)}` : "";
        if (!name) return { error: "Name the pull request (pr) or the issue (issue) to scan." };
        return { summary: `It wants to scan ${name}, read only.`, project: p.name };
      }
      const t = this.o.runner.thread(args.session);
      const project = this.projectName(t.projectId);
      if (tool === "liner_send") return { summary: `It wants to send a message to “${t.title || "a session"}”.`, project, message: String(args.message ?? ""), threadId: t.id, runsOn: this.o.runsOn?.(t.id), access: t.access };
      if (tool === "liner_answer") {
        // What it would answer, quoted: the question is the session's own, and the answer goes into its turn.
        const q = this.o.runner.question(t.id);
        if (!q) return { error: this.o.runner.unanswerable?.(t.id) ?? "That session isn't asking a question. What it asks for permission stays the person's to answer in Liner Code." };
        return { summary: `It wants to answer “${q}” in “${t.title || "a session"}”.`, project, message: String(args.answer ?? ""), threadId: t.id, runsOn: this.o.runsOn?.(t.id), access: t.access };
      }
      return { summary: `It wants to stop “${t.title || "a session"}”.`, project, threadId: t.id };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }
}

