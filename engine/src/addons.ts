/*
  Add-ons, phase 1: connections. A connection is an MCP server that every agent tool gets beside
  Liner Code's own `liner` server: Claude Code, Codex, OpenCode and Hermes. An agent writes its
  manifest as a draft in the session's folder (.liner/addons/<id>/addon.json, kept out of git like
  designs) and asks with addon_install; you add it on the install card. The manifest is checked
  again and kept as a version, ~/.liner-code/addons/<id>/v<n>/addon.json, every one of them, and
  index.json says which version is in use, whether it's on, where it applies and who added it.

  Nothing here runs what an agent wrote: a manifest is settings, and each tool starts the server
  itself. A key is never written in a manifest, only named. You type it on the card, it's sealed
  in the keychain like an API key in Settings › Models, and it reaches the server only when its
  tool starts it: never the transcript, the agent's tool result or a log.

  An agent drafting a plugin and a manager installing it behind your OK is DeepSeek Harness's
  Creator mode (github.com/deepseek-ai/deepseek-harness, MIT); the shape and the code are our own.
*/
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { AddonAsk, AddonInfo, AddonManifest, AddonSecret } from "../../contracts/src/index.ts";
import { addonKey } from "../../contracts/src/index.ts";
import { writeAtomic } from "./store.ts";

/** Where an agent writes a draft, in the session's folder. */
export const ADDON_DIR = ".liner/addons";
/** A connection as its tool starts it: the manifest with its keys filled in. Only ever in memory. */
export type Connection = { name: string; stdio?: { command: string; args: string[]; env: Record<string, string> }; http?: { url: string; headers: Record<string, string> } };

/** An id names the MCP server in every tool: a–z, 0–9 and -, 2 to 40 of them, starting with a letter. */
export const ADDON_ID = /^[a-z][a-z0-9-]{0,38}[a-z0-9]$/;
const SECRET = /^[A-Z][A-Z0-9_]{1,63}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const HEADER = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,128}$/;
const REF = /\$\{([^}]*)\}/g;
/** A name that says its value is a secret. */
const SECRETISH = /key|token|secret|passw|pwd|auth|credential|cookie|session|private|signature/i;
/** A plain word or number, which no key is: AUTH_MODE=oauth, TOKEN_TTL=3600. */
const PLAIN = /^(?:[a-z][a-z-]{0,15}|\d{1,6})$/;
/**
  What a key looks like when one is written in by mistake: a prefix services give theirs, a JWT,
  or a long run of letters and digits.
*/
const TOKENISH =
  /\b(?:sk-[A-Za-z0-9_-]{8,}|[sr]k_(?:live|test)_|pk_live_|gh[pousr]_[A-Za-z0-9]{10,}|github_pat_|glpat-|xox[abposr]-|lin_(?:api|oauth)_|AKIA[0-9A-Z]{12}|AIza[0-9A-Za-z_-]{20,}|ya29\.|npm_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})|(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{32,}/;
const LOCAL = /^(?:localhost|127\.0\.0\.1|\[::1\])$/i;
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
  A manifest, checked strictly: known keys only, a sane id, and keys named, never written in. Every
  problem is said at once, in words an agent can fix them from.
*/
export function checkManifest(raw: unknown): AddonManifest {
  const bad: string[] = [];
  const obj = (v: unknown, at: string) => {
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    bad.push(`${at} must be an object.`);
    return null;
  };
  const only = (o: Record<string, unknown>, at: string, keys: string[]) => {
    for (const k of Object.keys(o)) if (!keys.includes(k)) bad.push(`${at ? `${at}.` : ""}${k} isn't a key a manifest has here (${at || "the top level"} takes ${keys.join(", ")}).`);
  };
  const text = (v: unknown, at: string, max: number) => {
    if (typeof v !== "string" || !v.trim()) return void bad.push(`${at} must be a string, and not empty.`);
    if (v.length > max) return void bad.push(`${at} is longer than ${max} characters.`);
    if (CONTROL.test(v)) return void bad.push(`${at} has a control character (a newline, say) in it.`);
    return v;
  };

  const m = obj(raw, "The manifest");
  if (!m) throw new Error(said(bad));
  only(m, "", ["apiVersion", "id", "kind", "name", "description", "server", "secrets"]);
  if (m.apiVersion !== 1) bad.push("apiVersion must be 1.");
  const id = text(m.id, "id", 40);
  if (id !== undefined && !ADDON_ID.test(id)) bad.push("id must be 2 to 40 characters of a–z, 0–9 and -, starting with a letter and not ending with -.");
  if (id !== undefined && /^liner/.test(id)) bad.push("id can't start with liner: that's Liner Code's own server.");
  if (m.kind !== "connection") bad.push('kind must be "connection": that\'s the one kind of add-on so far.');
  const name = text(m.name, "name", 60);
  const description = m.description === undefined ? undefined : text(m.description, "description", 300);

  // The secrets first: the server's values may name them.
  const secrets: AddonSecret[] = [];
  if (m.secrets !== undefined) {
    if (!Array.isArray(m.secrets)) bad.push("secrets must be a list: [{ \"name\": \"LINEAR_API_KEY\", \"label\": \"Linear key\" }].");
    else if (m.secrets.length > 16) bad.push("secrets has more than 16 in it.");
    else
      m.secrets.forEach((s, i) => {
        const at = `secrets[${i}]`;
        const o = obj(s, at);
        if (!o) return;
        only(o, at, ["name", "label"]);
        const n = text(o.name, `${at}.name`, 64);
        const label = text(o.label, `${at}.label`, 60);
        if (n !== undefined && !SECRET.test(n)) bad.push(`${at}.name must be a name like LINEAR_API_KEY: A–Z, 0–9 and _, starting with a letter.`);
        else if (n !== undefined && secrets.some((x) => x.name === n)) bad.push(`${at}.name ${n} is named twice.`);
        if (n !== undefined && label !== undefined) secrets.push({ name: n, label });
      });
  }
  const declared = new Set(secrets.map((s) => s.name));
  const used = new Set<string>();
  /** A value with ${NAME} in it: each must be a secret. What's left must not look like a key. */
  const value = (v: string, at: string, named?: string) => {
    for (const r of v.matchAll(REF)) {
      if (declared.has(r[1])) used.add(r[1]);
      else bad.push(`${at} has \${${r[1]}}, which isn't one of secrets.`);
    }
    const rest = v.replace(REF, "").trim();
    if (TOKENISH.test(rest)) bad.push(`${at} looks like it has a key written in. Name it in secrets and write \${NAME} in its place.`);
    else if (named && SECRETISH.test(named) && rest && !PLAIN.test(rest) && !/^(?:Bearer|Basic|Token)$/i.test(rest)) bad.push(`${at}: its name says it holds a secret, so its value must come from one. Name it in secrets and write \${NAME}.`);
  };

  let server: AddonManifest["server"] | undefined;
  const s = obj(m.server, "server");
  if (s) {
    only(s, "server", ["stdio", "http"]);
    if (("stdio" in s) === ("http" in s)) bad.push("server must have one of stdio (a command on this Mac) or http (an address), not both.");
    else if ("stdio" in s) {
      const o = obj(s.stdio, "server.stdio");
      if (o) {
        only(o, "server.stdio", ["command", "args", "env"]);
        const command = text(o.command, "server.stdio.command", 1000);
        if (command !== undefined) {
          if (command.includes("${")) bad.push("server.stdio.command can't name a secret.");
          else if (/\s/.test(command) && !(isAbsolute(command) && existsSync(command))) bad.push("server.stdio.command is one program (npx, uvx, node, a path to one): put what follows it in args. No shell runs it, so pipes and && don't work.");
          else if (TOKENISH.test(command)) bad.push("server.stdio.command looks like it has a key written in.");
        }
        const args: string[] = [];
        if (o.args !== undefined) {
          if (!Array.isArray(o.args) || o.args.some((a) => typeof a !== "string")) bad.push("server.stdio.args must be a list of strings.");
          else if (o.args.length > 64) bad.push("server.stdio.args has more than 64 in it.");
          else
            (o.args as string[]).forEach((a, i) => {
              const at = `server.stdio.args[${i}]`;
              if (a.length > 1000 || CONTROL.test(a)) return void bad.push(`${at} is too long, or has a control character in it.`);
              // Any program on this Mac can read a command line, the agent's included.
              if (a.includes("${")) return void bad.push(`${at} names a secret, and a command line is no place for one (anything on this Mac can read it): pass it in env.`);
              const flag = /^--?([\w.-]+)(?:=(.*))?$/.exec(a);
              const prev = /^--?([\w.-]+)$/.exec((o.args as string[])[i - 1] ?? "");
              if (TOKENISH.test(a)) bad.push(`${at} looks like it has a key written in. Pass it in env from a secret instead.`);
              else if (flag?.[2] !== undefined && SECRETISH.test(flag[1]) && flag[2] && !PLAIN.test(flag[2])) bad.push(`${at} gives ${flag[1]} a value written in. Pass it in env from a secret instead.`);
              else if (!flag && prev && SECRETISH.test(prev[1]) && !PLAIN.test(a)) bad.push(`${at} gives ${prev[1]} a value written in. Pass it in env from a secret instead.`);
              args.push(a);
            });
        }
        const env: Record<string, string> = {};
        if (o.env !== undefined) {
          const e = obj(o.env, "server.stdio.env");
          if (e) {
            if (Object.keys(e).length > 64) bad.push("server.stdio.env has more than 64 in it.");
            for (const [k, v] of Object.entries(e)) {
              const at = `server.stdio.env.${k}`;
              if (!ENV_NAME.test(k)) bad.push(`${at} isn't a variable's name.`);
              else if (typeof v !== "string" || v.length > 2000 || CONTROL.test(v)) bad.push(`${at} must be a string, without newlines.`);
              else {
                value(v, at, k);
                env[k] = v;
              }
            }
          }
        }
        if (command !== undefined) server = { stdio: { command, ...(args.length ? { args } : {}), ...(Object.keys(env).length ? { env } : {}) } };
      }
    } else {
      const o = obj(s.http, "server.http");
      if (o) {
        only(o, "server.http", ["url", "headers"]);
        const url = text(o.url, "server.http.url", 2000);
        const u = url === undefined ? null : URL.parse(url);
        if (url !== undefined && !u) bad.push("server.http.url isn't an address.");
        else if (u) {
          if (u.protocol !== "https:" && !(u.protocol === "http:" && LOCAL.test(u.hostname))) bad.push("server.http.url must be https://, or http:// on this Mac (localhost).");
          if (u.username || u.password) bad.push("server.http.url has a sign-in written in it. Name the key in secrets and send it in a header.");
          if (url!.includes("${")) bad.push("server.http.url can't name a secret: send it in a header.");
          for (const [k, v] of u.searchParams) if ((SECRETISH.test(k) && v && !PLAIN.test(v)) || TOKENISH.test(v)) bad.push(`server.http.url has ${k}= written in it. Name the key in secrets and send it in a header.`);
        }
        const headers: Record<string, string> = {};
        if (o.headers !== undefined) {
          const h = obj(o.headers, "server.http.headers");
          if (h) {
            if (Object.keys(h).length > 32) bad.push("server.http.headers has more than 32 in it.");
            for (const [k, v] of Object.entries(h)) {
              const at = `server.http.headers.${k}`;
              if (!HEADER.test(k)) bad.push(`${at} isn't a header's name.`);
              else if (typeof v !== "string" || v.length > 2000 || CONTROL.test(v)) bad.push(`${at} must be a string, without newlines.`);
              else {
                value(v, at, k);
                headers[k] = v;
              }
            }
          }
        }
        if (u && url !== undefined) server = { http: { url, ...(Object.keys(headers).length ? { headers } : {}) } };
      }
    }
  }
  // A stdio server gets each secret in its environment under its own name; an address has only its headers to take one.
  if (server && "http" in server) for (const n of declared) if (!used.has(n)) bad.push(`secrets has ${n}, which no header uses: put \${${n}} in one, like "Authorization": "Bearer \${${n}}".`);
  if (bad.length) throw new Error(said(bad));
  return { apiVersion: 1, id: id!, kind: "connection", name: name!, ...(description ? { description } : {}), server: server!, ...(secrets.length ? { secrets } : {}) };
}

const said = (bad: string[]) => (bad.length === 1 ? `The manifest isn't right: ${bad[0]}` : `The manifest isn't right:\n${bad.map((b) => `- ${b}`).join("\n")}`);

/** What a connection reaches, in words: its address, or the command it runs. */
export const reachOf = (m: AddonManifest) => ("http" in m.server ? m.server.http.url : [m.server.stdio.command, ...(m.server.stdio.args ?? [])].join(" "));

/**
  A draft in the session's folder, by id (.liner/addons/<id>/addon.json) or path (the file, or its
  folder), checked. One outside the folder, a link included, isn't read.
*/
export function readDraft(root: string, asked: string): { path: string; manifest: AddonManifest } {
  const a = asked.trim().replace(/^file:\/\//i, "");
  if (!a) throw new Error("Say which draft: its id (for .liner/addons/<id>/addon.json) or its path in this folder.");
  let file = ADDON_ID.test(a) ? join(root, ADDON_DIR, a, "addon.json") : resolve(root, a);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "addon.json");
  const rel = relative(root, file);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("A draft must be in this session's folder, under .liner/addons/.");
  if (!existsSync(file)) throw new Error(`There's no ${rel.split(sep).join("/")}. Write the manifest there first (liner_inspect has its shape).`);
  const real = relative(realpathSync(root), realpathSync(file));
  if (real.startsWith("..") || isAbsolute(real)) throw new Error("That draft is a link to outside this session's folder.");
  if (statSync(file).size > 64_000) throw new Error("That draft is over 64 KB; a manifest is a few lines.");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${rel} isn't JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const manifest = checkManifest(raw);
  if (ADDON_ID.test(a) && manifest.id !== a) throw new Error(`The draft at ${rel} says its id is ${manifest.id}, not ${a}.`);
  return { path: rel.split(sep).join("/"), manifest };
}

/** The same manifest, the same text: key order doesn't make a new version. */
const canon = (m: AddonManifest) => JSON.stringify(m, (_k, v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));

type Entry = { version: number; enabled: boolean; project?: string; removed?: number; by: AddonInfo["by"]; versions: { v: number; at: number }[] };
type Index = { v: 1; addons: Record<string, Entry> };

export class Addons {
  readonly dir: string;
  /** This run started without add-ons (Settings › Add-ons): none reach any tool until Liner Code starts again. */
  off = false;
  private index: Index = { v: 1, addons: {} };
  /** Told after every change, with the list as it is now. */
  onChange: (list: AddonInfo[]) => void = () => {};

  constructor(home: string) {
    this.dir = join(home, "addons");
    mkdirSync(this.dir, { recursive: true });
    try {
      const read = JSON.parse(readFileSync(join(this.dir, "index.json"), "utf8")) as Index;
      if (read && typeof read.addons === "object") this.index = { v: 1, addons: read.addons };
    } catch {
      // none yet
    }
    // Start without add-ons holds for one start: its mark goes as it's read.
    const once = join(this.dir, "off-once");
    if (existsSync(once)) {
      this.off = true;
      rmSync(once, { force: true });
    }
  }

  private save() {
    writeAtomic(join(this.dir, "index.json"), JSON.stringify(this.index, null, 2), { backup: true });
    this.onChange(this.list());
  }

  /** No add-ons from now on, nor when Liner Code next starts. */
  turnOff() {
    this.off = true;
    writeFileSync(join(this.dir, "off-once"), `${new Date().toISOString()}\n`);
    this.onChange(this.list());
  }

  /** A kept version's manifest (the one in use without `version`), checked again as it's read. */
  manifest(id: string, version?: number): AddonManifest | null {
    const e = this.index.addons[id];
    const v = version ?? e?.version;
    if (!ADDON_ID.test(id) || !v) return null;
    try {
      return checkManifest(JSON.parse(readFileSync(join(this.dir, id, `v${v}`, "addon.json"), "utf8")));
    } catch {
      return null;
    }
  }

  get(id: string) {
    return this.list().find((a) => a.id === id);
  }

  list(): AddonInfo[] {
    const out: AddonInfo[] = [];
    for (const [id, e] of Object.entries(this.index.addons)) {
      const m = this.manifest(id);
      if (!m) continue;
      out.push({
        id,
        kind: m.kind,
        name: m.name,
        ...(m.description ? { description: m.description } : {}),
        version: e.version,
        versions: e.versions.map((x) => x.v).sort((a, b) => a - b),
        enabled: e.enabled,
        ...(e.removed ? { removed: e.removed } : {}),
        ...(e.project ? { project: e.project } : {}),
        by: e.by,
        transport: "http" in m.server ? "http" : "stdio",
        reaches: reachOf(m),
        secrets: m.secrets ?? [],
      });
    }
    return out.sort((a, b) => a.by.at - b.by.at);
  }

  /** The version this manifest would be, and the one in use it would replace (none when it's the same). */
  wouldBe(m: AddonManifest): { version: number; replaces?: number } {
    const e = this.index.addons[m.id];
    if (!e) return { version: 1 };
    const same = e.versions.find((x) => {
      const kept = this.manifest(m.id, x.v);
      return kept && canon(kept) === canon(m);
    });
    if (same) return { version: same.v, ...(same.v !== e.version ? { replaces: e.version } : {}) };
    return { version: Math.max(...e.versions.map((x) => x.v)) + 1, replaces: e.version };
  }

  /** Adds it, as a new version unless one kept is the same, on and in use. */
  install(m: AddonManifest, o: { project?: string; by: AddonInfo["by"] }) {
    const { version } = this.wouldBe(m);
    const e = this.index.addons[m.id];
    if (!e?.versions.some((x) => x.v === version)) {
      const dir = join(this.dir, m.id, `v${version}`);
      mkdirSync(dir, { recursive: true });
      writeAtomic(join(dir, "addon.json"), `${JSON.stringify(m, null, 2)}\n`);
    }
    const versions = e ? [...e.versions.filter((x) => x.v !== version), { v: version, at: Date.now() }] : [{ v: version, at: Date.now() }];
    this.index.addons[m.id] = { version, enabled: true, ...(o.project ? { project: o.project } : {}), by: e?.by ?? o.by, versions };
    this.save();
    return version;
  }

  update(id: string, p: { enabled?: boolean; version?: number; removed?: boolean }) {
    const e = this.index.addons[id];
    if (!e) throw new Error("There's no add-on by that id.");
    if (p.version !== undefined) {
      if (!e.versions.some((x) => x.v === p.version) || !this.manifest(id, p.version)) throw new Error(`There's no version ${p.version} of it.`);
      e.version = p.version;
    }
    if (p.enabled !== undefined) e.enabled = p.enabled;
    // Removed, it stays on disk and off; restored, it's back on where it was.
    if (p.removed === true) Object.assign(e, { removed: Date.now(), enabled: false });
    if (p.removed === false) Object.assign(e, { removed: undefined, enabled: true });
    this.save();
    return this.list();
  }

  /**
    The connections a session in `projectId` gets, its keys filled in from `keys` (the engine's, from
    the keychain). A value whose key isn't set yet is left out rather than sent empty.
  */
  connections(projectId: string, keys: Map<string, string>): Connection[] {
    if (this.off) return [];
    const out: Connection[] = [];
    for (const [id, e] of Object.entries(this.index.addons)) {
      if (!e.enabled || e.removed || (e.project && e.project !== projectId)) continue;
      const m = this.manifest(id);
      if (!m) continue;
      const fill = (v: string) => {
        let missing = false;
        const out = v.replace(REF, (_, n: string) => keys.get(addonKey(id, n)) ?? ((missing = true), ""));
        return missing ? null : out;
      };
      const filled = (o: Record<string, string> = {}) => Object.fromEntries(Object.entries(o).flatMap(([k, v]) => (fill(v) === null ? [] : [[k, fill(v)!]])));
      if ("http" in m.server) out.push({ name: id, http: { url: m.server.http.url, headers: filled(m.server.http.headers) } });
      else {
        const named = Object.values(m.server.stdio.env ?? {}).join(" ");
        const own = Object.fromEntries((m.secrets ?? []).flatMap((s) => (named.includes(`\${${s.name}}`) || !keys.get(addonKey(id, s.name)) ? [] : [[s.name, keys.get(addonKey(id, s.name))!]])));
        out.push({ name: id, stdio: { command: m.server.stdio.command, args: m.server.stdio.args ?? [], env: { ...own, ...filled(m.server.stdio.env) } } });
      }
    }
    return out;
  }

  /** What the install card shows for a manifest read from `path`, in the session's project, reaching the tools named. */
  askOf(m: AddonManifest, path: string, project: { id: string; name: string }, reaches: string[]): AddonAsk {
    const { replaces } = this.wouldBe(m);
    const had = this.index.addons[m.id];
    return {
      id: m.id,
      name: m.name,
      ...(m.description ? { description: m.description } : {}),
      transport: "http" in m.server ? "http" : "stdio",
      server: reachOf(m),
      ...("stdio" in m.server ? { env: [...new Set([...Object.keys(m.server.stdio.env ?? {}), ...(m.secrets ?? []).map((x) => x.name)])] } : {}),
      reaches,
      path,
      secrets: m.secrets ?? [],
      project,
      manifest: JSON.stringify(m, null, 2),
      ...(replaces && !had?.removed ? { replaces } : {}),
      // The card offers where it was the last time, else every project.
      scope: had?.project ? "project" : "all",
    };
  }
}

/** A fingerprint of what a session's tools get, so a change reopens or updates them; never kept anywhere. */
export const fingerprint = (c: Connection[]) => (c.length ? createHash("sha256").update(JSON.stringify(c)).digest("hex").slice(0, 16) : "");

/** What liner_inspect tells an agent about add-ons, well under 8k characters. */
export const ADDON_GUIDE = `Liner Code add-ons, phase 1: connections

A connection is an MCP server Liner Code hands to every agent tool it runs (Claude Code, Codex, OpenCode and Hermes), next to its own liner server. It's settings, not code: each tool starts the server itself, and nothing runs inside Liner Code. Make one when the person wants their agents to reach a service (Linear, Sentry, a database) through MCP, instead of adding it to one tool's own config.

How to add one
1. Find the service's MCP server: a hosted address (streamable HTTP), or a command that runs it on this Mac (npx, uvx, a program). Prefer the service's own.
2. Write the manifest to .liner/addons/<id>/addon.json in this session's folder. It stays out of git.
3. Call addon_install with the id. The person sees a card with what it reaches, types any key it needs, and picks every project or only this one. You get back one of:
   - applied: its tools are in this session now;
   - saved, starts in the next turn: this session's tool picks it up when the next turn starts, so say so;
   - denied: they said no. Don't ask again unless they do.
4. To change one, edit the draft and call addon_install again: a changed manifest is a new version, and asks again. addon_remove takes one away (the person can restore it in Settings › Add-ons).

The manifest, version 1. Only these keys:
{
  "apiVersion": 1,
  "id": "linear",
  "kind": "connection",
  "name": "Linear",
  "description": "Issues and projects in Linear",
  "server": { "http": { "url": "https://mcp.linear.app/mcp", "headers": { "Authorization": "Bearer \${LINEAR_API_KEY}" } } },
  "secrets": [{ "name": "LINEAR_API_KEY", "label": "Linear key" }]
}
- id: 2 to 40 of a-z, 0-9 and -, starting with a letter. It names the MCP server in every tool (Claude Code calls its tools mcp__<id>__<tool>).
- name: what the person reads on the card. description: optional, one sentence.
- server: one of
  { "http": { "url": "https://...", "headers": { ... } } }   a hosted server (https, or http on localhost)
  { "stdio": { "command": "npx", "args": ["-y", "@sentry/mcp-server"], "env": { "SENTRY_HOST": "sentry.io" } } }   a server this Mac runs
  command is one program; its arguments go in args. No shell runs it, so pipes and && don't work.
- secrets: optional, the keys it needs, each { "name": "A_NAME", "label": "what the person reads" }.

Keys
- Never write a key, token or password in the manifest, not even one the person pasted in the chat. Name it in secrets: they type it on the card, it's sealed in this Mac's keychain, and you never see it.
- In a header or an env value, \${NAME} stands for a secret. A stdio server also gets each secret in its environment under its own name, so a server that reads LINEAR_API_KEY needs only the secret.
- args can't carry a secret (anything on this Mac can read a command line): use env.
- A variable, header or flag whose name says key, token, secret, password or auth must take its value from a secret.
- No key in an address: send it in a header.

Limits
- A server that signs in through a browser (OAuth) can't be set up as a connection yet. Say so, and offer the service's API key if it has one.
- A read-only session can't add one, and the person may have turned add-ons off in Settings › Add-ons.`;
