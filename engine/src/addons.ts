/*
  Add-ons. Phase 1: connections. A connection is an MCP server that every agent tool gets beside
  Liner Code's own `liner` server: Claude Code, Codex, OpenCode and Hermes. An agent writes its
  manifest as a draft in the session's folder (.liner/addons/<id>/addon.json, kept out of git like
  designs) and asks with addon_install; you add it on the install card. The manifest is checked
  again and kept as a version, ~/.liner-code/addons/<id>/v<n>/addon.json, every one of them, and
  index.json says which version is in use, whether it's on, where it applies and who added it.

  Nothing here runs what an agent wrote: a manifest is settings, and each tool starts the server
  itself. A key is never written in a manifest, only named. You type it on the card, it's sealed
  in the keychain like an API key in Settings › Models, and it reaches the server only when its
  tool starts it: never the transcript, the agent's tool result or a log.

  Phase 2: panels. A panel is a small page of the agent's own (its HTML, scripts and styles beside
  the manifest) that opens in the right dock, as a tab beside Chat, or as a page from the left
  sidebar. It runs in a sealed frame in the window (contracts/src/panel.ts), never here, and its
  manifest says what it may touch (`access`), which its bridge holds it to (panels.ts). Its files
  are kept with each version; its storage, one per add-on, outlives versions and removal.

  An agent drafting a plugin and a manager installing it behind your OK is DeepSeek Harness's
  Creator mode (github.com/deepseek-ai/deepseek-harness, MIT); the shape and the code are our own.
*/
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { AddonAsk, AddonInfo, AddonManifest, AddonSecret, ConnectionAsk, ConnectionManifest, PanelAccess, PanelManifest } from "../../contracts/src/index.ts";
import { addonKey, PANEL_ICONS } from "../../contracts/src/index.ts";
import { loadState, writeAtomic } from "./store.ts";

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
  if (m.kind === "panel") return checkPanel(m, bad, { obj, only, text });
  only(m, "", ["apiVersion", "id", "kind", "name", "description", "summary", "server", "secrets"]);
  if (m.apiVersion !== 1) bad.push("apiVersion must be 1.");
  const id = text(m.id, "id", 40);
  if (id !== undefined && !ADDON_ID.test(id)) bad.push("id must be 2 to 40 characters of a–z, 0–9 and -, starting with a letter and not ending with -.");
  if (id !== undefined && /^liner/.test(id)) bad.push("id can't start with liner: that's Liner Code's own server.");
  if (m.kind !== "connection") bad.push('kind must be "connection" (an MCP server) or "panel" (a page of your own in Liner Code).');
  const name = text(m.name, "name", 60);
  const description = m.description === undefined ? undefined : text(m.description, "description", 300);
  const summary = m.summary === undefined ? undefined : text(m.summary, "summary", 140);

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

  let server: ConnectionManifest["server"] | undefined;
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
  return { apiVersion: 1, id: id!, kind: "connection", name: name!, ...(description ? { description } : {}), ...(summary ? { summary } : {}), server: server!, ...(secrets.length ? { secrets } : {}) };
}

const said = (bad: string[]) => (bad.length === 1 ? `The manifest isn't right: ${bad[0]}` : `The manifest isn't right:\n${bad.map((b) => `- ${b}`).join("\n")}`);

type Checks = {
  obj: (v: unknown, at: string) => Record<string, unknown> | null;
  only: (o: Record<string, unknown>, at: string, keys: string[]) => void;
  text: (v: unknown, at: string, max: number) => string | undefined;
};
/** A host a panel may reach: a name with a dot in it, no scheme, port, path or wildcard. */
const HOST = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
/** An entry file: a name of its own folder's, ending .html. */
const ENTRY = /^(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)?[A-Za-z0-9_-][A-Za-z0-9._-]*\.html?$/;
/** The most storage a panel may keep, in KB. */
export const STORAGE_MAX = 1024;

/** A panel's manifest: where it opens, its entry file, and what it may touch, each checked. */
function checkPanel(m: Record<string, unknown>, bad: string[], c: Checks): PanelManifest {
  c.only(m, "", ["apiVersion", "id", "kind", "name", "description", "summary", "place", "entry", "icon", "access"]);
  if (m.apiVersion !== 1) bad.push("apiVersion must be 1.");
  const id = c.text(m.id, "id", 40);
  if (id !== undefined && !ADDON_ID.test(id)) bad.push("id must be 2 to 40 characters of a–z, 0–9 and -, starting with a letter and not ending with -.");
  if (id !== undefined && /^liner/.test(id)) bad.push("id can't start with liner.");
  const name = c.text(m.name, "name", 60);
  const description = m.description === undefined ? undefined : c.text(m.description, "description", 300);
  const summary = m.summary === undefined ? undefined : c.text(m.summary, "summary", 140);
  const place = m.place;
  if (place !== "dock" && place !== "tab" && place !== "page") bad.push('place must be "dock" (the right dock, beside a session), "tab" (a tab beside Chat) or "page" (a page of its own, from the left sidebar).');
  const entry = m.entry === undefined ? "index.html" : c.text(m.entry, "entry", 120);
  if (entry !== undefined && !ENTRY.test(entry)) bad.push("entry must be an .html file beside the manifest (index.html), or one folder down.");
  const icon = m.icon;
  if (icon !== undefined && !(PANEL_ICONS as readonly unknown[]).includes(icon)) bad.push(`icon must be one of ${PANEL_ICONS.join(", ")}.`);
  const access: PanelAccess = {};
  const a = m.access === undefined ? {} : c.obj(m.access, "access");
  if (a) {
    c.only(a, "access", ["files", "sessions", "composer", "storage", "network", "ai"]);
    if (a.files !== undefined) {
      if (a.files !== "project") bad.push('access.files must be "project" (the session\'s project folder, to read), or left out.');
      else access.files = "project";
    }
    if (a.sessions !== undefined) {
      if (a.sessions !== "this" && a.sessions !== "all") bad.push('access.sessions must be "this" (the session it\'s beside) or "all" (every session\'s titles and changes), or left out.');
      else access.sessions = a.sessions;
    }
    if (a.composer !== undefined) {
      if (typeof a.composer !== "boolean") bad.push("access.composer must be true or false.");
      else if (a.composer) access.composer = true;
    }
    if (a.storage !== undefined) {
      if (typeof a.storage !== "number" || !Number.isInteger(a.storage) || a.storage < 0 || a.storage > STORAGE_MAX) bad.push(`access.storage is how many KB it keeps: a whole number up to ${STORAGE_MAX}.`);
      else if (a.storage > 0) access.storage = a.storage;
    }
    if (a.ai !== undefined) {
      if (typeof a.ai !== "boolean") bad.push("access.ai must be true or false: true lets it ask a model the person picks (text in, text out).");
      else if (a.ai) access.ai = true;
    }
    if (a.network !== undefined) {
      const h = typeof a.network === "string" ? a.network.trim().toLowerCase() : "";
      if (!HOST.test(h)) bad.push('access.network is the one host it reaches over https, like "api.github.com": no https://, port, path or *.');
      else if (/(?:^|\.)(?:localhost|local|internal|lan|home|arpa)$/.test(h)) bad.push("access.network must be a host on the internet, not on this Mac or its network.");
      else access.network = h;
    }
  }
  // A page has no session beside it, so nothing of one to read or write to.
  if (place === "page" && (access.files || access.sessions === "this" || access.composer)) bad.push('A page (place "page") has no session beside it: access.files, sessions "this" and composer are for "dock" and "tab". It may read every session (sessions "all"). For AI on the page, ask for "ai": true and call liner.ai.ask: a model the person picks answers the page itself.');
  if (bad.length) throw new Error(said(bad));
  return { apiVersion: 1, id: id!, kind: "panel", name: name!, ...(description ? { description } : {}), ...(summary ? { summary } : {}), place: place as PanelManifest["place"], entry: entry!, ...(icon ? { icon: icon as PanelManifest["icon"] } : {}), access };
}

/** What a connection reaches, in words: its address, or the command it runs. */
export const reachOf = (m: ConnectionManifest) => ("http" in m.server ? m.server.http.url : [m.server.stdio.command, ...(m.server.stdio.args ?? [])].join(" "));

/** A panel's files: what it may hold, and how much. */
const PANEL_TYPES = /\.(?:html?|m?js|css|json|svg|png|jpe?g|gif|webp|txt|md)$/i;
const BINARY = /\.(?:png|jpe?g|gif|webp)$/i;
export const PANEL_FILES = 40;
export const PANEL_FILE_MAX = 512_000;
export const PANEL_TOTAL_MAX = 2_000_000;
/** A panel's files by path, as the frame takes them: text as it is, pictures in base64. */
export type PanelFiles = Record<string, string>;

/**
  The files in a panel's folder beside its manifest, read for its frame: no links, nothing hidden,
  only the kinds a page is made of, 40 at most and 2 MB in all. Every problem is said at once.
  `loose`, for a folder from outside (a repository with its LICENSE and sources beside the page):
  files of other kinds and folders too deep are left out rather than said.
*/
export function readPanelFiles(dir: string, entry: string, loose = false): PanelFiles {
  const files: PanelFiles = {};
  const bad: string[] = [];
  let total = 0;
  const walk = (at: string, depth: number) => {
    for (const name of readdirSync(at).sort()) {
      const abs = join(at, name);
      const rel = relative(dir, abs).split(sep).join("/");
      if (rel === "addon.json") continue;
      if (name.startsWith(".")) continue;
      const st = lstatSync(abs);
      if (st.isSymbolicLink()) {
        bad.push(`${rel} is a link; a panel's files must be its own.`);
        continue;
      }
      if (st.isDirectory()) {
        if (depth < 2) walk(abs, depth + 1);
        else if (!loose) bad.push(`${rel} is too deep: two folders down at most.`);
        continue;
      }
      // A pipe or a device would hang the read: only plain files.
      if (!st.isFile()) {
        bad.push(`${rel} isn't a plain file.`);
        continue;
      }
      if (!PANEL_TYPES.test(name)) {
        if (!loose) bad.push(`${rel} isn't a kind of file a panel holds (html, js, css, json, svg, png, jpg, gif, webp, txt, md).`);
        continue;
      }
      if (st.size > PANEL_FILE_MAX) {
        bad.push(`${rel} is over ${PANEL_FILE_MAX / 1000} KB.`);
        continue;
      }
      total += st.size;
      if (Object.keys(files).length >= PANEL_FILES) {
        bad.push(`It has more than ${PANEL_FILES} files.`);
        return;
      }
      const buf = readFileSync(abs);
      files[rel] = BINARY.test(name) ? buf.toString("base64") : buf.toString("utf8");
    }
  };
  walk(dir, 0);
  if (total > PANEL_TOTAL_MAX) bad.push(`Its files come to over ${PANEL_TOTAL_MAX / 1_000_000} MB.`);
  if (files[entry] === undefined) bad.push(`There's no ${entry} beside the manifest: that's the page it opens on (entry).`);
  if (bad.length) throw new Error(bad.length === 1 ? `The panel's files aren't right: ${bad[0]}` : `The panel's files aren't right:\n${bad.map((b) => `- ${b}`).join("\n")}`);
  return files;
}

/**
  Hosts that serve models: a panel never reaches one itself (no key belongs in a panel), it asks for
  "ai" instead. Held at install and offer, not when a kept manifest is read, so nothing you have goes.
*/
const MODEL_HOSTS = /(?:^|\.)(?:openai\.com|anthropic\.com|claude\.ai|openrouter\.ai|deepseek\.com|googleapis\.com|mistral\.ai|x\.ai|groq\.com|together\.xyz|fireworks\.ai|moonshot\.(?:ai|cn)|bigmodel\.cn|z\.ai|minimax(?:i)?\.(?:io|chat|com)|opencode\.ai|cohere\.(?:ai|com)|perplexity\.ai|huggingface\.co|replicate\.com)$/;
export function modelHostRefusal(network?: string) {
  if (!network || !MODEL_HOSTS.test(network)) return null;
  return `${network} serves models, and a panel never reaches one itself, nor holds a key for one. Ask for "ai": true instead and call liner.ai.ask: the person picks one of their own models in Liner Code, and the answer comes back to the panel.`;
}

/** What a panel may touch, in words, for its strip and Settings: "reads this project's files · no network". */
export function accessWords(a: PanelAccess, place?: PanelManifest["place"]) {
  const out: string[] = [];
  if (a.files) out.push("reads this project's files");
  if (a.sessions === "this") out.push(place === "tab" ? "reads this session" : "reads the session it's beside");
  if (a.sessions === "all") out.push("reads your sessions' titles and changes");
  if (a.composer) out.push("can put text in the composer");
  if (a.storage) out.push(`keeps its own storage, up to ${sizeWords(a.storage)}`);
  if (a.ai) out.push("asks a model you pick");
  out.push(a.network ? `reaches ${a.network}` : "no network");
  return out.join(" · ");
}
export const sizeWords = (kb: number) => (kb >= 1024 && kb % 1024 === 0 ? `${kb / 1024} MB` : `${kb} KB`);

/**
  What a version asks to touch that the one before didn't, in words: nothing (an empty list) lets
  it in without asking again. Reading more sessions, more storage or another host all count.
*/
export function widerAccess(was: PanelAccess, now: PanelAccess): string[] {
  const out: string[] = [];
  if (now.files && !was.files) out.push("Read the project's files");
  const rank = { undefined: 0, this: 1, all: 2 } as Record<string, number>;
  if (rank[String(now.sessions)] > rank[String(was.sessions)]) out.push(now.sessions === "all" ? "Read every session's titles and changes" : "Read the session it's beside");
  if (now.composer && !was.composer) out.push("Put text in the composer");
  if ((now.storage ?? 0) > (was.storage ?? 0)) out.push(was.storage ? `Keep more in its storage: up to ${sizeWords(now.storage!)}, not ${sizeWords(was.storage)}` : `Keep its own storage, up to ${sizeWords(now.storage!)}`);
  if (now.ai && !was.ai) out.push("Ask a model you pick, billed to its account");
  if (now.network && now.network !== was.network) out.push(was.network ? `Reach ${now.network} instead of ${was.network}` : `Reach ${now.network} over the internet`);
  return out;
}

const hashOf = (files: PanelFiles) => createHash("sha256").update(JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))).digest("hex");

/**
  A draft in the session's folder, by id (.liner/addons/<id>/addon.json) or path (the file, or its
  folder), checked. One outside the folder, a link included, isn't read.
*/
export function readDraft(root: string, asked: string): { path: string; manifest: AddonManifest; files?: PanelFiles } {
  const a = asked.trim().replace(/^file:\/\//i, "");
  if (!a) throw new Error("Say which draft: its id (for .liner/addons/<id>/addon.json) or its path in this folder.");
  let file = ADDON_ID.test(a) ? join(root, ADDON_DIR, a, "addon.json") : resolve(root, a);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "addon.json");
  const rel = relative(root, file);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("A draft must be in this session's folder, under .liner/addons/.");
  if (!existsSync(file)) throw new Error(`There's no ${rel.split(sep).join("/")}. Write the manifest there first (liner_inspect has its shape).`);
  const real = relative(realpathSync(root), realpathSync(file));
  if (real.startsWith("..") || isAbsolute(real)) throw new Error("That draft is a link to outside this session's folder.");
  if (!statSync(file).isFile()) throw new Error(`${rel} isn't a plain file.`);
  if (statSync(file).size > 64_000) throw new Error("That draft is over 64 KB; a manifest is a few lines.");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${rel} isn't JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const manifest = checkManifest(raw);
  if (ADDON_ID.test(a) && manifest.id !== a) throw new Error(`The draft at ${rel} says its id is ${manifest.id}, not ${a}.`);
  if (manifest.kind !== "panel") return { path: rel.split(sep).join("/"), manifest };
  return { path: rel.split(sep).join("/"), manifest, files: readPanelFiles(dirname(file), manifest.entry) };
}

/** The same manifest, the same text: key order doesn't make a new version. A panel's files count too. */
const canon = (m: AddonManifest, files?: PanelFiles) => JSON.stringify(m, (_k, v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v)) + (files ? hashOf(files) : "");

type Entry = { version: number; enabled: boolean; project?: string; removed?: number; by: AddonInfo["by"]; versions: { v: number; at: number }[] };
type Index = { v: 1; addons: Record<string, Entry> };

export class Addons {
  readonly dir: string;
  /** This run started without add-ons (Settings › Add-ons): none reach any tool until Liner Code starts again. */
  off = false;
  /** By id, with no prototype: an add-on called constructor is just an add-on. */
  private index: Index = { v: 1, addons: Object.create(null) };
  /** Told after every change, with the list as it is now. */
  onChange: (list: AddonInfo[]) => void = () => {};

  constructor(home: string) {
    this.dir = join(home, "addons");
    mkdirSync(this.dir, { recursive: true });
    // One that doesn't read is moved aside and its .bak read instead, so a save can't put it over the good copy.
    const read = loadState<Index>(join(this.dir, "index.json"));
    if (read.addons && typeof read.addons === "object" && !Array.isArray(read.addons)) this.index = { v: 1, addons: Object.assign(Object.create(null), read.addons) };
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

  /** No add-ons from now on; with `next`, nor when Liner Code next starts (it's about to open again). */
  turnOff(next = false) {
    this.off = true;
    if (next) writeFileSync(join(this.dir, "off-once"), `${new Date().toISOString()}\n`);
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

  /** A kept version's files, for a panel (the version in use without `version`). */
  files(id: string, version?: number): PanelFiles | null {
    const v = version ?? this.index.addons[id]?.version;
    const m = v ? this.manifest(id, v) : null;
    if (!m || m.kind !== "panel") return null;
    const dir = join(this.dir, id, `v${v}`, "files");
    try {
      return readPanelFiles(dir, m.entry);
    } catch {
      return null;
    }
  }

  /** A panel that may run now: on, not removed, and for this project (any, without one). */
  panel(id: string, projectId?: string): PanelManifest | null {
    const e = this.index.addons[id];
    if (this.off || !e || !e.enabled || e.removed) return null;
    if (e.project && projectId && e.project !== projectId) return null;
    const m = this.manifest(id);
    return m?.kind === "panel" ? m : null;
  }

  /* A panel's own storage: one JSON file per add-on, kept through its versions and its removal. */
  private storeFile = (id: string) => join(this.dir, id, "storage.json");
  storage(id: string): Record<string, unknown> {
    if (!ADDON_ID.test(id)) return {};
    try {
      const v = JSON.parse(readFileSync(this.storeFile(id), "utf8")) as unknown;
      return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  /** Puts (or with `undefined`, takes away) one key, within its quota in KB. */
  store(id: string, key: string, value: unknown, quota: number) {
    if (!ADDON_ID.test(id)) throw new Error("There's no add-on by that id.");
    const all = this.storage(id);
    if (value === undefined) delete all[key];
    else all[key] = value;
    const text = JSON.stringify(all);
    const size = Buffer.byteLength(text);
    if (value !== undefined && size > quota * 1024) throw new Error(`That would make its storage ${Math.ceil(size / 1024)} KB, over the ${sizeWords(quota)} it asked for.`);
    mkdirSync(join(this.dir, id), { recursive: true });
    writeAtomic(this.storeFile(id), text);
  }

  list(): AddonInfo[] {
    const out: AddonInfo[] = [];
    for (const [id, e] of Object.entries(this.index.addons)) {
      const m = this.manifest(id);
      if (!m) continue;
      const base = {
        id,
        name: m.name,
        ...(m.description ? { description: m.description } : {}),
        ...(m.summary ? { summary: m.summary } : {}),
        version: e.version,
        versions: e.versions.map((x) => x.v).sort((a, b) => a - b),
        dates: Object.fromEntries(e.versions.map((x) => [x.v, x.at])),
        enabled: e.enabled,
        ...(e.removed ? { removed: e.removed } : {}),
        ...(e.project ? { project: e.project } : {}),
        by: e.by,
      };
      if (m.kind === "panel") out.push({ ...base, kind: "panel", reaches: accessWords(m.access, m.place), secrets: [], panel: { place: m.place, access: m.access, entry: m.entry, ...(m.icon ? { icon: m.icon } : {}) } });
      else out.push({ ...base, kind: "connection", transport: "http" in m.server ? "http" : "stdio", reaches: reachOf(m), secrets: m.secrets ?? [] });
    }
    return out.sort((a, b) => a.by.at - b.by.at);
  }

  /** The version this manifest would be, and the one in use it would replace (none when it's the same). */
  wouldBe(m: AddonManifest, files?: PanelFiles): { version: number; replaces?: number } {
    const e = this.index.addons[m.id];
    const same = e?.versions.find((x) => {
      const kept = this.manifest(m.id, x.v);
      return kept && canon(kept, kept.kind === "panel" ? (this.files(m.id, x.v) ?? undefined) : undefined) === canon(m, files);
    });
    if (e && same) return { version: same.v, ...(same.v !== e.version ? { replaces: e.version } : {}) };
    // A version's folder already on disk (kept by an index that didn't read, say) is never written over.
    let v = e ? Math.max(...e.versions.map((x) => x.v)) + 1 : 1;
    while (existsSync(join(this.dir, m.id, `v${v}`))) v++;
    return e ? { version: v, replaces: e.version } : { version: v };
  }

  /** Adds it, as a new version unless one kept is the same, on and in use. A panel brings its files. */
  install(m: AddonManifest, o: { project?: string; by: AddonInfo["by"] }, files?: PanelFiles) {
    const e = this.index.addons[m.id];
    if (e && this.manifest(m.id)?.kind !== m.kind) throw new Error(`${m.id} is already the id of a ${m.kind === "panel" ? "connection" : "panel"}: give this one an id of its own.`);
    if (m.kind === "panel" && !files) throw new Error("A panel needs its files.");
    const { version } = this.wouldBe(m, files);
    if (!e?.versions.some((x) => x.v === version)) {
      const dir = join(this.dir, m.id, `v${version}`);
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      if (m.kind === "panel")
        for (const [path, content] of Object.entries(files!)) {
          const abs = join(dir, "files", path);
          mkdirSync(dirname(abs), { recursive: true });
          writeFileSync(abs, BINARY.test(path) ? Buffer.from(content, "base64") : content);
        }
      writeAtomic(join(dir, "addon.json"), `${JSON.stringify(m, null, 2)}\n`);
    }
    const versions = e ? [...e.versions.filter((x) => x.v !== version), { v: version, at: Date.now() }] : [{ v: version, at: Date.now() }];
    // Who first added it stays, unless this one comes from somewhere else.
    this.index.addons[m.id] = { version, enabled: true, ...(o.project ? { project: o.project } : {}), by: e && e.by.from === o.by.from ? e.by : o.by, versions };
    this.save();
    return version;
  }

  update(id: string, p: { enabled?: boolean; version?: number; removed?: boolean; project?: string | null }) {
    const e = this.index.addons[id];
    if (!e) throw new Error("There's no add-on by that id.");
    // Every project (null), or only one.
    if (p.project !== undefined) {
      if (p.project === null) delete e.project;
      else e.project = p.project;
    }
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
      if (!m || m.kind !== "connection") continue;
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

  /**
    A panel's card: what it may touch, its files, and against the version in use (not one removed),
    what it asks for that that one didn't.
  */
  panelAsk(m: PanelManifest, path: string, project: { id: string; name: string }, files: PanelFiles): Extract<AddonAsk, { kind: "panel" }> {
    const { version: next, replaces } = this.wouldBe(m, files);
    const had = this.index.addons[m.id];
    const was = had && !had.removed ? this.manifest(m.id) : null;
    const wider = was?.kind === "panel" ? widerAccess(was.access, m.access) : undefined;
    return {
      kind: "panel",
      next,
      id: m.id,
      name: m.name,
      ...(m.description ? { description: m.description } : {}),
      place: m.place,
      access: m.access,
      ...(m.icon ? { icon: m.icon } : {}),
      entry: m.entry,
      files: Object.entries(files).map(([p, c]) => ({ path: p, size: BINARY.test(p) ? Math.floor((c.length * 3) / 4) : Buffer.byteLength(c) })),
      path,
      project,
      manifest: JSON.stringify(m, null, 2),
      ...(replaces && !had?.removed ? { replaces } : {}),
      ...(wider ? { wider } : {}),
      // A page belongs to no project; a panel is offered for this one first, unless it was for every one, or another one, before.
      scope: m.place === "page" || (had && had.project !== project.id) ? "all" : "project",
    };
  }

  /** What the install card shows for a manifest read from `path`, in the session's project, reaching the tools named. */
  askOf(m: ConnectionManifest, path: string, project: { id: string; name: string }, reaches: string[]): ConnectionAsk {
    const { replaces } = this.wouldBe(m);
    const had = this.index.addons[m.id];
    // Its keys are kept by id: one pointing somewhere new has them typed again rather than sent there.
    const was = had ? this.manifest(m.id) : null;
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
      ...(was?.kind === "connection" && reachOf(was) !== reachOf(m) ? { moved: reachOf(was) } : {}),
      // The card offers this project only when it was for this one; for another, or every one, every project.
      scope: had?.project === project.id ? "project" : "all",
    };
  }
}

/** A fingerprint of what a session's tools get, so a change reopens or updates them; never kept anywhere. */
export const fingerprint = (c: Connection[]) => (c.length ? createHash("sha256").update(JSON.stringify(c)).digest("hex").slice(0, 16) : "");

/** What liner_inspect tells an agent about add-ons, well under 8k characters. */
export const ADDON_GUIDE = `Liner Code add-ons: connections and panels

Two kinds, each added only when the person says yes on a card in the session, and each kept version by version.
- A connection is an MCP server Liner Code hands to every agent tool it runs (Claude Code, Codex, OpenCode and Hermes), next to its own liner server. Settings, not code: each tool starts the server itself.
- A panel is a small page of your own in Liner Code: in the right dock beside a session, as a tab beside Chat, or a page of its own from the left sidebar. It runs in a sealed frame with only what its manifest lists.

Connections
1. Find the service's MCP server: a hosted address (streamable HTTP), or a command that runs it on this Mac (npx, uvx, a program). Prefer the service's own.
2. Write .liner/addons/<id>/addon.json in this session's folder (it stays out of git):
{ "apiVersion": 1, "id": "linear", "kind": "connection", "name": "Linear", "description": "Issues in Linear", "summary": "Lets your agents read and update your Linear issues.",
  "server": { "http": { "url": "https://mcp.linear.app/mcp", "headers": { "Authorization": "Bearer \${LINEAR_API_KEY}" } } },
  "secrets": [{ "name": "LINEAR_API_KEY", "label": "Linear key" }] }
   server is { "http": { "url", "headers" } } (https, or http on localhost) or { "stdio": { "command": "npx", "args": [...], "env": {...} } }. command is one program; no shell runs it.
3. Call addon_install with the id. It returns applied (its tools are here now), saved, starts in the next turn (say so), or denied (don't ask again unless they do).
Keys: never write one in a manifest, not even one pasted in the chat. Name it in secrets; \${NAME} in a header or env value stands for it; a stdio server also gets each secret in its environment by name. args can't carry a secret, nor an address. A variable, header or flag named like a key, token, secret, password or auth must take its value from a secret. A server that signs in through a browser (OAuth) can't be a connection yet.

Panels
1. Write .liner/addons/<id>/addon.json and the panel's files beside it: index.html, and any .js, .css, .json, .svg or pictures it links by a relative path (40 files, 2 MB at most). No CDN: it can't reach one, so what it needs goes in its own files.
{ "apiVersion": 1, "id": "todos", "kind": "panel", "name": "TODOs", "description": "The TODOs in this project, to hand to the agent", "summary": "Lists the TODOs in your project beside the session, so you can hand one to the agent.",
  "place": "dock", "entry": "index.html", "icon": "list", "access": { "files": "project", "composer": true } }
   summary: always write it: one plain sentence of what it does for the person, as the Add-ons page lists it ("Lets your agents read your Linear issues."). No MCP, manifest, version or access words.
   place: "dock" (beside a session: a viewer, an editor, something to watch while chatting), "tab" (a tab beside Chat: a session's live output or interaction), "page" (global, from the left sidebar: a record kept across projects).
   icon: app, blocks, list, notes, chart, check, clock, globe, flask, star, bolt or inbox.
   access, each left out unless the panel needs it:
   - files: "project": read this project's files.
   - sessions: "this" (the session it's beside: title, changes, commands) or "all" (every session's titles and changes).
   - composer: true: put text in the composer, for the person to send.
   - storage: how many KB of storage of its own (1024 at most), kept across versions.
   - ai: true: ask a model (liner.ai.ask): text in, text out. The person picks which of their models when it first asks, billed to that model's account. Never reach a model's API over network, and never make the person copy a prompt into the chat: this is the way.
   - network: one host, like "api.github.com", over https. The person holds a button to allow it; ask for it only if the panel can't work without it.
   A page has no session beside it: only sessions "all", storage, ai and network.
2. Call addon_check with the id: it draws the panel out of sight at its size, with this project's real data, and returns a picture, its errors and anything it was refused. Fix what's off, and check again.
3. Call addon_install with the id. The person sees it live in the dock, with a card saying what it touches. A changed panel that asks for nothing more than the version in use goes in without a card; one that asks for more asks again. Every version is kept, and the person can go back.
In the frame, window.liner is its only way in. Every call returns a promise, and one its access doesn't allow is refused:
- liner.files.list(dir?) → paths; liner.files.read(path) → { text, size }; liner.files.search(["TODO", "FIXME"], { ignoreCase: false }) → [{ path, line, text }] (plain words, not patterns)
- liner.session.info() → { title, status, branch, project, changes: [{ path, added, removed }] }; liner.session.commands() → [{ title, status, output, at }]
- liner.sessions.list() → [{ id, title, project, status, updatedAt, files, added, removed }]
- liner.composer.put(text)
- liner.storage.get(key), .set(key, value), .remove(key), .keys()
- liner.ai.ask(prompt, { system, onText }) → { text, model }; liner.ai.model() → { name } or null; liner.ai.pick() opens the person's model picker → { name } or null
- liner.on("session", fn) when the session moves on; liner.on("theme", fn) when the colours change.
Draw it in Liner 2.0, Liner Code's own look, so it reads as part of the app: read liner_inspect with the topic "design" before any HTML or CSS. Its colours are the app's, so it follows light and dark: var(--bg), var(--surface), var(--well), var(--plate), var(--ink) to var(--ink-4), var(--hair), var(--line), var(--accent), var(--act) for the one main button, var(--ok), var(--warn), var(--danger), var(--font), var(--font-display), var(--font-mono). An empty state when there's nothing to show; an error said in words when a call fails.

Offering one
When the person didn't ask for an add-on but your answer has a clear use they'll come back to (a record they keep, results they'll explore again), you may answer first and then call addon_offer: a card at the end of your answer offers to make it as an app in the background, where they choose. One a turn, and only when it would really help.

Either kind
To change one, edit its draft and call addon_install again. addon_remove takes one away; the person can restore it in Settings › Add-ons. A read-only session can't add or remove one, and the person may have turned agent add-ons off.`;
