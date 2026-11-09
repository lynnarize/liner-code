/*
  DeepSeek Harness plugins, ported: a DSH plugin package (from npm, "dsh-media-desk", or a folder on
  this Mac) read into a Liner Code add-on, for the same card as any add-on from outside (sources.ts).

  A DSH plugin is an npm package with a `dsh` block in its package.json
  (github.com/deepseek-ai/deepseek-harness, MIT: the plugin skill in
  packages/preset/agent-preset/skills/cordis-plugin-development, packages/client/modules):
  - `dsh.bundle.patch`, a cordis.patch.yml whose `insert` rows turn on plugins: the package's own
    Node half (its main export, a Cordis plugin), or DSH's own, like @deepseek-ai/dsh-mcp-client
    with a server's settings.
  - `dsh.client`, its browser half: the package's ./client export, a bundle that registers itself
    with DSH's module loader and puts React components into the window's slots.

  What Liner Code makes of it:
  - A browser half that draws a sidebar page, a right-pane tab or a conversation view becomes a
    panel: a page, a dock panel or a tab. Its client.js runs in the sealed frame, under the loader
    in contracts/src/dsh.ts. Its Node half, when it has one, runs in a process of its own beside the
    engine (dsh-hosts.ts), never in it; the card says so, and what that process may touch.
  - A bundle that only turns on dsh-mcp-client becomes a connection, its server's settings mapped
    onto a connection's manifest and checked as any is.
  - The tools its Node half gives DSH's agent (ctx.tools.register, a search or fetch provider for
    web_search and web_fetch) are your agents' instead, served from its own process as an MCP
    server (dsh-hosts.ts). They're read from its code before it's added, by the names written in
    it: the card lists them, and those are all its program may give. A plugin that draws nothing
    and gives tools becomes a connection of its own.
  - Anything else of DSH's (its agent's context, other slots, DSH packages it turns on) is said on
    the card as left out, rather than half run.

  Nothing from the package runs here. Its tarball is checked against the registry's integrity and
  unpacked by the small reader below: plain files and folders only, no links, nothing outside its
  folder, and no install scripts. Dependencies, for a Node half that has them, are installed with
  npm's scripts off.
*/
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";
import type { AddonManifest, DshInstructions, DshPlugin, DshSlot, DshTool, PanelManifest } from "../../contracts/src/index.ts";
import { dshEntry } from "../../contracts/src/index.ts";
import { ADDON_ID, checkManifest, DSH_TOOLS_MAX, type PanelFiles } from "./addons.ts";
import { SHIMMED, WEB_TOOLS } from "./dsh-shims.ts";

/** An npm package's name: an optional @scope, lower case, as npm allows them. */
const NAME = /^(?:@[a-z0-9][a-z0-9._~-]{0,100}\/)?[a-z0-9][a-z0-9._~-]{0,180}$/;
/** A version, or a dist-tag (latest, next…). Ranges aren't resolved: the newest is "latest". */
const VERSION = /^(?:v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?|[a-z][a-z0-9._-]{0,40})$/;

/**
  An npm package as people paste it: a name ("dsh-media-desk", "@scope/name@1.2.3"), the command
  they'd install it with ("npm i dsh-media-desk", "dsh plugin --profile web add dsh-media-desk"), or
  its page on npmjs.com. Null for anything else (a GitHub address, a folder).
*/
export function npmOf(source: string): { name: string; version?: string } | null {
  let s = source.trim();
  if (!s || /github\.com|^[~/.]|^[A-Za-z]:\\|^file:/i.test(s)) return null;
  const page = /^(?:https?:\/\/)?(?:www\.)?npmjs\.(?:com|org)\/package\/((?:@[^/\s]+\/)?[^/\s?#]+)(?:\/v\/([^/\s?#]+))?\/?(?:[?#].*)?$/i.exec(s);
  if (page) {
    try {
      s = page[2] ? `${decodeURIComponent(page[1])}@${page[2]}` : decodeURIComponent(page[1]);
    } catch {
      return null;
    }
  } else {
    // The command around it, by position: npm i <it>, pnpm/yarn/bun add <it>, dsh plugin [--profile p] add <it>; flags go.
    const words = s.split(/\s+/);
    const tool = (words[0] ?? "").toLowerCase();
    if (/^(?:npm|pnpm|yarn|bun|dsh)$/.test(tool)) {
      const rest = words.slice(1).filter((w, i, all) => !w.startsWith("-") && !/^--?profile$/.test(all[i - 1] ?? ""));
      const verbs = tool === "dsh" ? ["plugin", "add"] : [tool === "npm" ? /^(?:i|install|add)$/i : /^add$/i];
      for (const v of verbs) {
        if (!(typeof v === "string" ? rest[0] === v : v.test(rest[0] ?? ""))) return null;
        rest.shift();
      }
      if (rest.length !== 1) return null;
      s = rest[0];
    } else if (words.length > 1) return null;
  }
  s = s.replace(/^npm:/i, "");
  const at = s.lastIndexOf("@");
  const [name, version] = at > 0 ? [s.slice(0, at), s.slice(at + 1)] : [s, undefined];
  if (!NAME.test(name) || name.length > 214) return null;
  if (version !== undefined && !VERSION.test(version)) return null;
  return { name, ...(version ? { version } : {}) };
}

const REGISTRY = "https://registry.npmjs.org";
/** The most a tarball may weigh, and what it may come to unpacked. */
export const TARBALL_MAX = 60_000_000;
export const UNPACKED_MAX = 160_000_000;
const FILES_MAX = 20_000;

type Fetch = typeof fetch;
/**
  A package's version from the registry: its tarball, checked against the integrity the registry
  gives, and unpacked into `dest`. What it says is what npm says, in plain words.
*/
export async function npmFetch(spec: { name: string; version?: string }, dest: string, f: Fetch = fetch): Promise<{ name: string; version: string; integrity?: string }> {
  const meta = await f(`${REGISTRY}/${spec.name.replace("/", "%2f")}`, { headers: { accept: "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8" }, signal: AbortSignal.timeout(30_000) }).catch((e: unknown) => {
    throw new Error(`npm couldn't be reached: ${e instanceof Error ? e.message : String(e)}`);
  });
  if (meta.status === 404) throw new Error(`There's no package called ${spec.name} on npm.`);
  if (!meta.ok) throw new Error(`npm answered ${meta.status} for ${spec.name}.`);
  const doc = (await meta.json()) as { versions?: Record<string, { dist?: { tarball?: string; integrity?: string; shasum?: string }; deprecated?: string }>; "dist-tags"?: Record<string, string> };
  const tags = doc["dist-tags"] ?? {};
  const want = spec.version?.replace(/^v(?=\d)/, "") ?? "latest";
  const version = doc.versions?.[want] ? want : tags[want];
  const v = version ? doc.versions?.[version] : undefined;
  if (!version || !v) throw new Error(spec.version ? `${spec.name} has no version ${spec.version} on npm.` : `${spec.name} has no version to install on npm.`);
  const url = URL.parse(v.dist?.tarball ?? "");
  if (!url || url.protocol !== "https:" || url.hostname !== "registry.npmjs.org") throw new Error(`npm gave no tarball for ${spec.name}@${version} on registry.npmjs.org.`);
  const res = await f(url.href, { signal: AbortSignal.timeout(120_000) }).catch((e: unknown) => {
    throw new Error(`${spec.name}@${version} couldn't be downloaded: ${e instanceof Error ? e.message : String(e)}`);
  });
  if (!res.ok) throw new Error(`npm answered ${res.status} for ${spec.name}@${version}'s tarball.`);
  if (Number(res.headers.get("content-length") ?? 0) > TARBALL_MAX) throw new Error(`${spec.name}@${version} is over ${TARBALL_MAX / 1_000_000} MB.`);
  const tgz = Buffer.from(await res.arrayBuffer());
  if (tgz.length > TARBALL_MAX) throw new Error(`${spec.name}@${version} is over ${TARBALL_MAX / 1_000_000} MB.`);
  const integrity = v.dist?.integrity;
  const sri = integrity ? /^(sha512|sha384|sha256)-([A-Za-z0-9+/=]+)$/.exec(integrity.split(/\s+/).find((x) => x.startsWith("sha512-")) ?? integrity.split(/\s+/)[0]) : null;
  if (sri) {
    if (createHash(sri[1]).update(tgz).digest("base64") !== sri[2]) throw new Error(`${spec.name}@${version}'s tarball isn't the one npm vouches for: its checksum doesn't match.`);
  } else if (v.dist?.shasum) {
    if (createHash("sha1").update(tgz).digest("hex") !== v.dist.shasum) throw new Error(`${spec.name}@${version}'s tarball isn't the one npm vouches for: its checksum doesn't match.`);
  } else throw new Error(`npm gave no checksum for ${spec.name}@${version}, so it can't be checked.`);
  untar(tgz, dest);
  return { name: spec.name, version, ...(sri ? { integrity: `${sri[1]}-${sri[2]}` } : {}) };
}

/**
  A .tgz unpacked into `dest`, its first folder ("package/") dropped: plain files and folders only.
  Links, devices and anything that would land outside `dest` are left out; so is anything past the
  size or count it may come to.
*/
export function untar(tgz: Buffer, dest: string) {
  let tar: Buffer;
  try {
    tar = gunzipSync(tgz, { maxOutputLength: UNPACKED_MAX + 50_000_000 });
  } catch (e) {
    throw new Error(`The tarball doesn't unpack: ${e instanceof Error ? e.message : String(e)}`);
  }
  mkdirSync(dest, { recursive: true });
  const root = resolve(dest);
  let off = 0;
  let total = 0;
  let count = 0;
  let long: string | null = null;
  let pax: Record<string, string> = {};
  const text = (h: Buffer, a: number, b: number) => h.subarray(a, b).toString("utf8").replace(/\0[\s\S]*$/, "");
  while (off + 512 <= tar.length) {
    const h = tar.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const size = parseInt(text(h, 124, 136).trim() || "0", 8);
    if (!Number.isFinite(size) || size < 0) throw new Error("The tarball is damaged.");
    const type = h[156] ? String.fromCharCode(h[156]) : "0";
    const ustar = h.subarray(257, 262).toString("latin1") === "ustar";
    const prefix = ustar ? text(h, 345, 500) : "";
    const body = tar.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === "L") {
      long = body.toString("utf8").replace(/\0[\s\S]*$/, "");
      continue;
    }
    if (type === "x") {
      pax = paxOf(body);
      continue;
    }
    if (type === "g") continue;
    const name = long ?? pax.path ?? (prefix ? `${prefix}/${text(h, 0, 100)}` : text(h, 0, 100));
    long = null;
    pax = {};
    const parts = name.split("/").filter((p) => p && p !== ".");
    parts.shift();
    if (!parts.length || parts.some((p) => p === ".." || p.includes("\\") || p.includes("\0"))) continue;
    const abs = resolve(root, ...parts);
    const rel = relative(root, abs);
    if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) continue;
    if (++count > FILES_MAX) throw new Error(`The package has more than ${FILES_MAX} files.`);
    if (type === "5") {
      mkdirSync(abs, { recursive: true });
      continue;
    }
    // Links, devices and the like: never written.
    if (type !== "0" && type !== "7") continue;
    total += size;
    if (total > UNPACKED_MAX) throw new Error(`The package comes to over ${UNPACKED_MAX / 1_000_000} MB unpacked.`);
    mkdirSync(dirname(abs), { recursive: true });
    if (existsSync(abs) && lstatSync(abs).isSymbolicLink()) continue;
    const mode = parseInt(text(h, 100, 108).trim() || "644", 8);
    writeFileSync(abs, body, { mode: mode & 0o111 ? 0o755 : 0o644 });
  }
}
const paxOf = (b: Buffer) => {
  const out: Record<string, string> = {};
  const s = b.toString("utf8");
  let i = 0;
  while (i < s.length) {
    const sp = s.indexOf(" ", i);
    const len = parseInt(s.slice(i, sp), 10);
    if (!(len > 0) || sp < 0) break;
    const rec = s.slice(sp + 1, i + len - 1);
    const eq = rec.indexOf("=");
    if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1);
    i += len;
  }
  return out;
};

/**
  The YAML a cordis.patch.yml is written in, as far as patches use it: block lists and maps,
  quoted and plain scalars, flow [lists] and {maps}, | and > text, comments. DSH's `!!js` (an
  expression its loader evaluates) comes back as { "!!js": "…" }, which nothing here evaluates.
  Anchors and other tags aren't read.
*/
export function readYaml(source: string): unknown {
  type Line = { n: number; indent: number; text: string };
  const raw = source.replace(/\r\n?/g, "\n").split("\n");
  const lines: Line[] = [];
  raw.forEach((l, n) => {
    if (/^\s*(?:#.*)?$/.test(l) || /^(?:---|\.\.\.)\s*$/.test(l)) return;
    if (/^\s*\t/.test(l)) throw new Error(`Line ${n + 1} is indented with a tab.`);
    lines.push({ n, indent: l.length - l.trimStart().length, text: l.trim() });
  });
  const stripComment = (s: string) => {
    let q: string | null = null;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) {
        if (q === '"' && c === "\\") i++;
        else if (c === q) q = null;
      } else if (c === "'" || c === '"') q = c;
      else if (c === "#" && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).trimEnd();
    }
    return s;
  };
  const scalar = (t: string): unknown => {
    const s = stripComment(t).trim();
    if (/^!!js\b/.test(s)) return { "!!js": s.replace(/^!!js\s*/, "") };
    if (/^[&*!]/.test(s)) throw new Error(`${s.slice(0, 30)}: anchors, aliases and tags other than !!js aren't read.`);
    if (s.startsWith("[") || s.startsWith("{")) return flow(s);
    if (s.startsWith("'")) {
      if (!s.endsWith("'") || s.length < 2) throw new Error(`${s.slice(0, 30)} isn't closed.`);
      return s.slice(1, -1).replace(/''/g, "'");
    }
    if (s.startsWith('"')) return JSON.parse(s);
    if (s === "" || s === "~" || s === "null") return null;
    if (s === "true" || s === "false") return s === "true";
    if (/^[-+]?(?:\d+|\d*\.\d+)(?:e[-+]?\d+)?$/i.test(s)) return Number(s);
    return s;
  };
  // A flow collection on one line: [a, 'b', {c: 1}].
  const flow = (s: string): unknown => {
    let i = 0;
    const ws = () => {
      while (/\s/.test(s[i] ?? "")) i++;
    };
    const item = (): unknown => {
      ws();
      if (s[i] === "[") {
        i++;
        const out: unknown[] = [];
        for (ws(); s[i] !== "]"; ws()) {
          if (i >= s.length) throw new Error(`${s.slice(0, 30)} isn't closed.`);
          out.push(item());
          ws();
          if (s[i] === ",") i++;
        }
        i++;
        return out;
      }
      if (s[i] === "{") {
        i++;
        const out: Record<string, unknown> = {};
        for (ws(); s[i] !== "}"; ws()) {
          if (i >= s.length) throw new Error(`${s.slice(0, 30)} isn't closed.`);
          const k = String(item());
          ws();
          if (s[i] !== ":") throw new Error(`${s.slice(0, 30)}: a key without a value.`);
          i++;
          out[k] = item();
          ws();
          if (s[i] === ",") i++;
        }
        i++;
        return out;
      }
      const q = s[i];
      if (q === "'" || q === '"') {
        let j = i + 1;
        while (j < s.length && !(s[j] === q && !(q === "'" && s[j + 1] === "'"))) j += (q === "'" && s[j] === "'") || (q === '"' && s[j] === "\\") ? 2 : 1;
        const v = scalar(s.slice(i, j + 1));
        i = j + 1;
        return v;
      }
      const m = /^[^,\]}:]*(?::(?=[^\s,\]}])[^,\]}:]*)*/.exec(s.slice(i))![0];
      // Always a step forward, or a word on what stood in the way: never a loop.
      if (!m.trim()) throw new Error(`${s.slice(0, 30)}: ${s[i] ?? "its end"} where a value goes.`);
      i += m.length;
      return scalar(m);
    };
    const v = item();
    return v;
  };
  const KEY = /^((?:'[^']*'|"(?:[^"\\]|\\.)*"|[^\s'"#\-?:,[\]{}][^:#]*?|-[^\s:#][^:#]*?))\s*:(?:\s+|$)(.*)$/;
  const block = (i: number, indent: number): [unknown, number] => {
    const first = lines[i];
    if (!first || first.indent < indent) return [null, i];
    // A list.
    if (first.text === "-" || first.text.startsWith("- ")) {
      const out: unknown[] = [];
      const at = first.indent;
      while (i < lines.length && lines[i].indent === at && (lines[i].text === "-" || lines[i].text.startsWith("- "))) {
        const rest = lines[i].text.replace(/^-\s*/, "");
        if (!rest) {
          const [v, next] = lines[i + 1] && lines[i + 1].indent > at ? block(i + 1, lines[i + 1].indent) : [null, i + 1];
          out.push(v);
          i = next;
          continue;
        }
        // "- key: value" goes on as a map at the column its key starts at.
        const col = at + (lines[i].text.length - rest.length);
        lines[i] = { n: lines[i].n, indent: col, text: rest };
        const [v, next] = block(i, col);
        out.push(v);
        i = next;
      }
      return [out, i];
    }
    // A map.
    if (KEY.test(first.text)) {
      const out: Record<string, unknown> = {};
      const at = first.indent;
      while (i < lines.length && lines[i].indent === at) {
        const m = KEY.exec(lines[i].text);
        if (!m) throw new Error(`Line ${lines[i].n + 1} isn't a key: ${lines[i].text.slice(0, 40)}`);
        const key = String(scalar(m[1]));
        const value = stripComment(m[2]).trim();
        if (/^[|>][-+]?$/.test(value)) {
          const body: string[] = [];
          let j = i + 1;
          const deeper = lines[j]?.indent ?? 0;
          while (j < lines.length && lines[j].indent > at) body.push(" ".repeat(lines[j].indent - deeper) + lines[j].text), j++;
          out[key] = value.startsWith("|") ? `${body.join("\n")}\n` : `${body.join(" ")}\n`;
          i = j;
        } else if (value) {
          out[key] = scalar(value);
          i++;
        } else if (lines[i + 1] && (lines[i + 1].indent > at || (lines[i + 1].indent === at && lines[i + 1].text.startsWith("-")))) {
          const [v, next] = block(i + 1, lines[i + 1].indent);
          out[key] = v;
          i = next;
        } else {
          out[key] = null;
          i++;
        }
      }
      return [out, i];
    }
    return [scalar(first.text), i + 1];
  };
  if (!lines.length) return null;
  const [v, end] = block(0, lines[0].indent);
  if (end < lines.length) throw new Error(`Line ${lines[end].n + 1} doesn't line up with what's above it.`);
  return v;
}

/** What a DSH package is, read: the add-on it makes, and what of it Liner Code leaves out. */
export type DshRead = { manifest: AddonManifest; files?: PanelFiles; left: string[]; size: number; deps: string[] };

type Pkg = { name?: string; version?: string; description?: string; displayName?: string; main?: string; exports?: unknown; dependencies?: Record<string, string>; dsh?: { bundle?: { patch?: string }; client?: { platform?: string; inject?: string[]; external?: string[] } } };

/** Whether a folder holds a DSH plugin: a package.json with a `dsh` block. */
export function isDsh(dir: string) {
  const file = join(dir, "package.json");
  if (!existsSync(file) || !statSync(file).isFile()) return false;
  try {
    const p = JSON.parse(readFileSync(file, "utf8")) as Pkg;
    return !!p && typeof p === "object" && !!p.dsh && typeof p.dsh === "object";
  } catch {
    return false;
  }
}

/** Where an export points, for a subpath of the package ("." or "./client"). */
function exportOf(p: Pkg, sub: string): string | undefined {
  const pick = (v: unknown): string | undefined => {
    if (typeof v === "string") return v;
    if (Array.isArray(v)) return v.map(pick).find(Boolean);
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      for (const k of ["import", "node", "default", "browser", "require"]) {
        const got = pick(o[k]);
        if (got) return got;
      }
    }
    return undefined;
  };
  const e = p.exports;
  if (typeof e === "string" || Array.isArray(e)) return sub === "." ? pick(e) : undefined;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    if (Object.keys(o).some((k) => k.startsWith("."))) return pick(o[sub]);
    return sub === "." ? pick(o) : undefined;
  }
  return sub === "." ? (p.main ?? "index.js") : undefined;
}

/** A file of the package's own, by the path it names: inside it, and a plain file, through no link on the way. */
function own(dir: string, path: string | undefined) {
  if (!path) return null;
  const abs = resolve(dir, path);
  const rel = relative(dir, abs);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  if (!existsSync(abs) || lstatSync(abs).isSymbolicLink() || !statSync(abs).isFile()) return null;
  const really = relative(realpathSync(dir), realpathSync(abs));
  if (!really || really === ".." || really.startsWith(`..${sep}`) || isAbsolute(really)) return null;
  return { abs, rel: rel.split(sep).join("/") };
}

/**
  A folder's package as one checksum (sha256, of every file's path and bytes but node_modules and
  .git): a folder you add again with its program changed is a new version, not the one kept.
*/
function digestOf(dir: string, files: { rel: string }[]) {
  const h = createHash("sha256");
  for (const f of [...files].sort((a, b) => a.rel.localeCompare(b.rel))) h.update(`${f.rel}\0`).update(readFileSync(join(dir, f.rel))).update("\0");
  return `sha256-${h.digest("base64")}`;
}

/** A Node half that does nothing (DSH's template for a browser-only plugin): no process for it. */
const idle = (code: string) => /^(?:export(?:async)?functionapply\([^)]*\)\{\};?|exportconstapply=(?:async)?\([^)]*\)=>\{\};?|exportdefault\{apply\([^)]*\)\{\}\};?|exportconstname=(?:'[^']*'|"[^"]*");?)+$/.test(code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\s+/g, ""));

const SLOTS: DshSlot[] = ["sidebar.panellist", "sidebar.right.pane.tab", "conversation.view"];
const PLACE: Record<DshSlot, PanelManifest["place"]> = { "sidebar.panellist": "page", "sidebar.right.pane.tab": "dock", "conversation.view": "tab" };
/** The modules a frame's loader shares; anything else a bundle requires isn't there. */
const SHARED = new Set(["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom", "react-dom/client"]);
/** DeepSeek Harness's own packages that are public on npm (MIT): a Node half that imports one gets it installed beside it. */
const PUBLIC_DSH = new Set(["@deepseek-ai/cordis", "@deepseek-ai/schemastery", "@deepseek-ai/cosmokit"]);

/**
  A !!js value DSH works out from the launch environment's keys, as MCP bundles write them:
  (process.env.KEY ? { Authorization: 'Bearer ' + process.env.KEY } : {}), or 'Bearer ' + process.env.KEY.
  Read as Liner Code's \${KEY}, a key you type on the card (optional when the expression leaves it
  out without one); anything more than that isn't read. `map` for a map of headers or variables.
*/
export function envOf(js: string, map: boolean): { value: string | Record<string, string>; keys: string[]; optional: boolean } | null {
  let e = js.trim();
  if (e.startsWith('"')) {
    try {
      e = JSON.parse(e) as string;
    } catch {
      return null;
    }
  } else if (e.startsWith("'") && e.endsWith("'")) e = e.slice(1, -1).replace(/''/g, "'");
  const keys = new Set<string>();
  const one = (v: string) => {
    const m = /^(?:(['"`])([^'"`$\\]*)\1\s*\+\s*)?process\.env\.([A-Z][A-Z0-9_]{1,63})(?:\s*\+\s*(['"`])([^'"`$\\]*)\4)?$/.exec(v.trim());
    if (!m) return null;
    keys.add(m[3]);
    return `${m[2] ?? ""}\${${m[3]}}${m[5] ?? ""}`;
  };
  const optional = /\?|\|\||&&/.test(e);
  if (!map) {
    const v = one(e.replace(/^\(|\)$/g, ""));
    return v ? { value: v, keys: [...keys], optional } : null;
  }
  const out: Record<string, string> = {};
  const entry = /([A-Za-z_][\w-]*|'[^']+'|"[^"]+")\s*:\s*((?:(['"`])[^'"`$\\]*\3\s*\+\s*)?process\.env\.[A-Z][A-Z0-9_]*(?:\s*\+\s*(['"`])[^'"`$\\]*\4)?)/g;
  let rest = e;
  for (const m of e.matchAll(entry)) {
    const v = one(m[2]);
    if (!v) return null;
    out[m[1].replace(/^['"]|['"]$/g, "")] = v;
    rest = rest.replace(m[0], "");
  }
  // What's left may only be the shape round them: (process.env.KEY ? { … } : {}).
  if (!Object.keys(out).length || !/^[\s(){}?:,|&!]*$/.test(rest.replace(/process\.env\.[A-Z][A-Z0-9_]*/g, ""))) return null;
  return { value: out, keys: [...keys], optional };
}

/** The services a Node half gets here (dsh-host.ts). */
export const HOST_SERVICES = ["webServer", "connection", "llm", "agentDefaultModel", "tools", "web", "systemPrompt", "settings", "logger"];

/** A tool's name as every agent tool takes it over MCP. */
const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;
/** A JS string literal's text, its escapes read. */
const unquote = (body: string) => body.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (_, e: string) => (e[0] === "u" ? String.fromCodePoint(parseInt(e.replace(/[u{}]/g, ""), 16)) : e[0] === "x" ? String.fromCharCode(parseInt(e.slice(1), 16)) : (({ n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", "0": "\0" }) as Record<string, string>)[e] ?? e));

/**
  The keys written as text at the top of an object literal in `code` from its `{` at `at`: what a
  tool's definition says its name and description are, when they're plain strings. Strings,
  templates and comments are stepped over; anything worked out as it runs isn't read.
*/
function literalKeys(code: string, at: number, want: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  let depth = 0;
  let last = "";
  const end = Math.min(code.length, at + 60_000);
  for (let i = at; i < end; i++) {
    const c = code[i];
    if (c === "/" && code[i + 1] === "/") {
      i = code.indexOf("\n", i);
      if (i < 0) break;
      continue;
    }
    if (c === "/" && code[i + 1] === "*") {
      i = code.indexOf("*/", i + 2) + 1;
      if (i <= 0) break;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < end && code[j] !== c) j += code[j] === "\\" ? 2 : 1;
      i = j;
      last = c;
      continue;
    }
    if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") {
      if (--depth === 0) break;
    } else if (depth === 1 && (last === "{" || last === ",") && /[A-Za-z_$"']/.test(c)) {
      const m = /^(?:([A-Za-z_$][\w$]*)|"([^"\\]*)"|'([^'\\]*)')\s*:\s*(?:"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\$]|\\.|\$(?!\{))*)`)?/.exec(code.slice(i, i + 4000));
      const key = m && (m[1] ?? m[2] ?? m[3]);
      // A value that's the whole of a string, not the start of one worked out as it runs ('a' + b).
      const whole = m && /^\s*[,}]/.test(code.slice(i + m[0].length, i + m[0].length + 200));
      if (m && key && want.includes(key) && !(key in out) && (m[4] ?? m[5] ?? m[6]) !== undefined && whole) out[key] = unquote(m[4] ?? m[5] ?? m[6]);
      if (m && key) {
        // On past the key and its value's opening, so its text isn't read as more keys.
        i += (m[1] ?? m[2] ?? m[3])!.length + (m[2] !== undefined || m[3] !== undefined ? 1 : 0);
        last = "k";
        continue;
      }
    }
    if (!/\s/.test(c)) last = c;
  }
  return out;
}

/**
  The tools a plugin's program gives DSH's agent, by its code: each defineTool({ … }) and
  tools.register({ … }) whose name is written as text, and DSH's web_search and web_fetch when it
  registers a search or fetch provider. `unnamed`, the definitions whose names it works out as it
  runs, which can't be listed before it's added and so aren't given.
*/
export function toolsIn(code: string[]): { tools: DshTool[]; unnamed: number } {
  const tools: DshTool[] = [];
  let unnamed = 0;
  const at = /(?:\bdefineTool|\btools\s*\??\.\s*register|["'`]tools["'`]\s*\)\s*\??\.\s*register)\s*\(\s*(?:defineTool\s*\(\s*)?\{/g;
  for (const c of code)
    for (const m of c.matchAll(at)) {
      const k = literalKeys(c, m.index + m[0].length - 1, ["name", "description"]);
      if (!k.name || !TOOL_NAME.test(k.name)) {
        unnamed++;
        continue;
      }
      if (tools.some((t) => t.name === k.name)) continue;
      const description = k.description?.replace(/\s+/g, " ").trim().slice(0, 1000);
      tools.push({ name: k.name, ...(description ? { description } : {}) });
    }
  for (const w of Object.values(WEB_TOOLS)) if (code.some((c) => new RegExp(`\\.${w.provider}\\s*\\(`).test(c)) && !tools.some((t) => t.name === w.name)) tools.push({ name: w.name, description: w.description });
  return { tools, unnamed };
}

/**
  What a plugin's program tells DSH's agent, by its code: the text of each section({ … text }) written
  as plain text. `live` when a call to systemPrompt.section(…) gives it any other way (a function, a
  string worked out as it runs, an object made elsewhere), which can't be shown before it's added.
  What's read here is all your agents are told, unless `live` (dsh-hosts.ts, told): a section it
  adds some way this doesn't see is left out, not told unshown.
*/
export function sectionsIn(code: string[]): DshInstructions {
  const texts: string[] = [];
  let live = false;
  for (const c of code)
    for (const m of c.matchAll(/(\bsystemPrompt\s*\??|["'`]systemPrompt["'`]\s*\)\s*\??)?\.\s*section\s*\(\s*(\{)?/g)) {
      const k = m[2] ? literalKeys(c, m.index + m[0].length - 1, ["text"]) : {};
      if (typeof k.text !== "string") {
        if (m[1]) live = true;
        continue;
      }
      const text = k.text.slice(0, 8000);
      if (text.trim() && !texts.includes(text)) texts.push(text);
    }
  return { texts, ...(live ? { live: true } : {}) };
}

/** A Liner Code add-on id from a package's name: "@michengai/dsh-archive" → "michengai-dsh-archive". */
export function idOf(name: string) {
  let id = name.toLowerCase().replace(/^@/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!/^[a-z]/.test(id) || /^liner/.test(id)) id = `dsh-${id}`;
  id = id.slice(0, 40).replace(/-+$/, "");
  if (!ADDON_ID.test(id)) throw new Error(`${name} doesn't make an add-on id.`);
  return id;
}
/** "dsh-media-desk" → "Media Desk". */
const nameOf = (pkg: string) =>
  pkg
    .replace(/^@[^/]+\//, "")
    .replace(/^(?:dsh-(?:plugin-|client-ui-)?|deepseek-harness-)/, "")
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ")
    .slice(0, 60) || pkg.slice(0, 60);
/** Mostly Latin letters: words Liner Code's English can show as they are. */
const latin = (s: string) => (s.match(/[A-Za-z]/g)?.length ?? 0) > s.replace(/[\s\d\p{P}]/gu, "").length * 0.7;
/**
  The first plain paragraph of the package's English README (README.en.md, or a README.md in
  English): what an add-on says of itself when its package.json describes it in another language.
*/
function englishBlurb(dir: string) {
  for (const n of ["README.en.md", "README_EN.md", "README.en-US.md", "README.md"]) {
    const f = own(dir, n);
    if (!f) continue;
    for (const block of readFileSync(f.abs, "utf8").slice(0, 40_000).split(/\n\s*\n/)) {
      if (/^\s*(?:#|\||```|>|!\[|[-*+] |\d+\. )/.test(block) || /<h[1-6]\b|<img\b|<picture\b/i.test(block)) continue;
      // A note about the README itself, its languages or its docs isn't what the plugin does.
      if (/\b(?:readme|documentation|translat\w*|english version|in english|中文|简体|language)\b|^\s*(?:note|english)\b/i.test(block)) continue;
      const plain = block.replace(/<[^>]+>/g, " ").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`]+/g, "").replace(/\s+/g, " ").trim();
      if (plain.length >= 30 && latin(plain)) return plain;
    }
  }
  return undefined;
}
const oneLine = (s: unknown, max: number) => (typeof s === "string" && s.trim() ? s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : undefined);

/** Every file of the package, with its size: what its card counts, and what its Node half's checks read. */
function walk(dir: string, skip = new Set(["node_modules", ".git"])) {
  const out: { rel: string; size: number }[] = [];
  const go = (at: string) => {
    for (const n of readdirSync(at)) {
      if (skip.has(n)) continue;
      const abs = join(at, n);
      const st = lstatSync(abs);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) go(abs);
      else if (st.isFile()) out.push({ rel: relative(dir, abs).split(sep).join("/"), size: st.size });
    }
  };
  go(dir);
  return out;
}

/** A DSH client.js's size, at most: a bundle with React left out is a few hundred KB. */
export const CLIENT_MAX = 4_000_000;

/**
  A DSH package in `dir`, read into the add-on it makes. `integrity` is the tarball's, from npm.
  Throws, in words, when there's nothing Liner Code can show or run of it.
*/
export function readDsh(dir: string, o: { integrity?: string } = {}): DshRead {
  const pj = own(dir, "package.json");
  if (!pj) throw new Error("There's no package.json there.");
  let p: Pkg;
  try {
    p = JSON.parse(readFileSync(pj.abs, "utf8")) as Pkg;
  } catch (e) {
    throw new Error(`Its package.json isn't JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const pkg = typeof p.name === "string" && NAME.test(p.name) ? p.name : null;
  if (!pkg) throw new Error("Its package.json has no name npm would take.");
  if (!p.dsh || typeof p.dsh !== "object") throw new Error(`${pkg} isn't a DeepSeek Harness plugin: its package.json has no dsh block.`);
  const version = typeof p.version === "string" ? p.version : "0.0.0";
  const files = walk(dir);
  const size = files.reduce((n, f) => n + f.size, 0);
  const left: string[] = [];

  // Its patch: which rows turn on its own Node half, which turn on DSH's MCP client, and the rest.
  type Row = { id?: string; name?: string; config?: Record<string, unknown>; disabled?: boolean };
  const rows: Row[] = [];
  const patchFile = p.dsh.bundle?.patch ? own(dir, p.dsh.bundle.patch) : null;
  if (p.dsh.bundle?.patch && !patchFile) throw new Error(`Its patch, ${p.dsh.bundle.patch}, isn't in the package.`);
  if (patchFile) {
    let doc: unknown;
    try {
      doc = readYaml(readFileSync(patchFile.abs, "utf8"));
    } catch (e) {
      throw new Error(`Its ${patchFile.rel} doesn't read: ${e instanceof Error ? e.message : String(e)}`);
    }
    for (const op of Array.isArray(doc) ? doc : doc ? [doc] : []) {
      if (!op || typeof op !== "object") continue;
      for (const [verb, list] of Object.entries(op as Record<string, unknown>)) {
        if (verb !== "insert") {
          left.push(`Its patch's ${verb} step, which changes DeepSeek Harness's own setup.`);
          continue;
        }
        for (const r of Array.isArray(list) ? list : []) if (r && typeof r === "object") rows.push(r as Row);
      }
    }
  }
  const mine = rows.filter((r) => r.name === pkg && !r.disabled);
  const mcp = rows.filter((r) => r.name === "@deepseek-ai/dsh-mcp-client" && !r.disabled);
  for (const r of rows) if (r.name !== pkg && r.name !== "@deepseek-ai/dsh-mcp-client" && !r.disabled) left.push(`It turns on ${String(r.name ?? r.id ?? "a plugin")} in DeepSeek Harness, which Liner Code doesn't have.`);
  if (mine.length > 1) left.push(`It runs its Node half ${mine.length} times with different settings; Liner Code runs the first.`);

  // Its browser half: the slot it draws in makes where it shows.
  const clientPath = p.dsh.client ? exportOf(p, "./client") : undefined;
  const client = clientPath ? own(dir, clientPath) : null;
  if (p.dsh.client && !client) throw new Error(`Its browser half, ${clientPath ?? "./client"}, isn't in the package${clientPath && /lib\/|dist\//.test(clientPath) ? ": it may need building first" : ""}.`);
  let slot: DshSlot | undefined;
  let clientCode = "";
  if (client) {
    if (statSync(client.abs).size > CLIENT_MAX) throw new Error(`Its browser half is over ${CLIENT_MAX / 1_000_000} MB.`);
    clientCode = readFileSync(client.abs, "utf8");
    if (!/__ModuleLoader__/.test(clientCode)) throw new Error("Its browser half doesn't register with DeepSeek Harness's module loader, so it can't be started.");
    slot = SLOTS.find((s) => new RegExp(`["'\`]${s.replace(/\./g, "\\.")}["'\`]`).test(clientCode));
    const others = [...new Set([...clientCode.matchAll(/\bname\s*:\s*["'`]([a-z][a-zA-Z]*(?:\.[a-zA-Z]+)+)["'`]/g)].map((m) => m[1]))].filter((s) => !SLOTS.includes(s as DshSlot) && s !== "main" && !s.startsWith(`${slot}.`));
    for (const s of others.slice(0, 6)) left.push(`What it adds to DeepSeek Harness's ${s}, which Liner Code doesn't have.`);
    const needs = [...new Set([...clientCode.matchAll(/\brequire\(\s*["'`]([^"'`]+)["'`]\s*\)/g)].map((m) => m[1]))].filter((r) => !SHARED.has(r) && r !== pkg && !r.startsWith("./"));
    for (const r of needs.slice(0, 6)) left.push(`Its page needs ${r}, which Liner Code doesn't have, so it may not start.`);
  }

  // Its Node half, unless it does nothing.
  let host: string | undefined;
  const hostFile = mine.length ? own(dir, exportOf(p, ".")) : null;
  if (mine.length && !hostFile) throw new Error(`Its Node half, ${exportOf(p, ".") ?? "its main file"}, isn't in the package.`);
  if (hostFile && !idle(readFileSync(hostFile.abs, "utf8"))) host = hostFile.rel;
  const hostCode = host ? files.filter((f) => /\.(?:m?js|cjs)$/.test(f.rel) && f.rel !== client?.rel && f.size < 8_000_000).map((f) => readFileSync(join(dir, f.rel), "utf8")) : [];
  const usesModel = hostCode.some((c) => /["'`]llm["'`]|\bctx\.llm\b/.test(c));
  if (host) {
    const dshImports = new Set(hostCode.flatMap((c) => [...c.matchAll(/(?:from|import\()\s*["'`](@deepseek-ai\/[a-z0-9-]+)/g)].map((m) => m[1])));
    for (const d of dshImports) if (!PUBLIC_DSH.has(d) && !SHIMMED.includes(d)) left.push(`Its program imports ${d}, a part of DeepSeek Harness that Liner Code doesn't have, so it may not start.`);
  }
  // The tools it gives an agent, as its code names them: your agents get these, and only these.
  const found = host ? toolsIn(hostCode) : { tools: [], unnamed: 0 };
  const tools = found.tools.slice(0, DSH_TOOLS_MAX);
  // What it tells every agent with its tools, as its code writes it: on the card, and all they're told.
  const told = host && tools.length ? sectionsIn(hostCode) : null;
  const instructions = told && (told.texts.length || told.live) ? { instructions: told } : {};
  if (found.tools.length > DSH_TOOLS_MAX) left.push(`${found.tools.length - DSH_TOOLS_MAX} more tools: your agents get the first ${DSH_TOOLS_MAX}.`);
  if (found.unnamed || (host && !tools.length && hostCode.some((c) => /\btools\s*\??\.\s*register\s*\(|["'`]tools["'`]\s*\)\s*\??\.\s*register\s*\(/.test(c)))) left.push("Tools whose names its program works out as it runs: your agents get only the tools it names before it's added.");
  // What its program needs from npm: what it names, none of DSH's but the public ones it imports, which DSH would have given it.
  const imported = host ? hostCode.flatMap((c) => [...c.matchAll(/(?:from|import\()\s*["'`](@deepseek-ai\/[a-z0-9-]+)/g)].map((m) => m[1])).filter((d) => PUBLIC_DSH.has(d)) : [];
  const deps = host ? [...new Set([...Object.keys(p.dependencies ?? {}).filter((d) => !d.startsWith("@deepseek-ai/") || PUBLIC_DSH.has(d)), ...imported])] : [];

  // The meta DSH's plugin pages show (locale/en.json), else the package's own words.
  let meta: { title?: unknown; description?: unknown } = {};
  for (const at of ["locale/en.json", "locales/en.json", "locale/en-US.json"]) {
    const f = own(dir, at);
    if (!f) continue;
    try {
      meta = ((JSON.parse(readFileSync(f.abs, "utf8")) as { meta?: typeof meta }).meta ?? {}) as typeof meta;
    } catch {
      // Unreadable words: the package's own name stands.
    }
    break;
  }
  const name = oneLine(meta.title, 60) ?? oneLine(p.displayName, 60) ?? nameOf(pkg);
  const own_ = oneLine(meta.description, 300) ?? oneLine(p.description, 300);
  const description = own_ && latin(own_) ? own_ : (oneLine(englishBlurb(dir), 300) ?? own_);
  // Its summary: one sentence of what it does, without saying it's a plugin.
  const what = description?.replace(/^(?:an?\s+)?(?:deepseek harness|dsh)\s+(?:plugin|插件)[^.:。：]{0,60}[.:。：]\s*/i, "");
  const first = what?.match(/^[^.!?。！？]{4,138}[.!?。！？]/)?.[0];
  const id = idOf(pkg);

  if (slot) {
    const dsh: DshPlugin = { package: pkg, version, integrity: o.integrity ?? digestOf(dir, files), ...(host ? { host } : {}), ...(host && mine[0]?.config && typeof mine[0].config === "object" ? { config: mine[0].config } : {}), ...(tools.length ? { tools } : {}), ...instructions, slot };
    const raw = { apiVersion: 1, id, kind: "panel", name, ...(description ? { description } : {}), ...(first ? { summary: first } : {}), place: PLACE[slot], entry: "index.html", icon: slot === "sidebar.panellist" ? "app" : "blocks", access: usesModel ? { ai: true } : {}, dsh };
    const manifest = checkManifest(raw, { dsh: true });
    if (mcp.length) left.push(`The MCP server it connects in DeepSeek Harness: add it as a connection of its own.`);
    return { manifest, files: { "index.html": dshEntry(name), "client.js": clientCode }, left, size, deps };
  }
  if (mcp.length) {
    if (tools.length) left.push("The tools its own program gives DeepSeek Harness's agent: Liner Code adds the MCP server it connects instead.");
    const c = { ...(mcp[0].config ?? {}) };
    // Headers and variables DSH fills from the launch environment's keys become keys you type on the card.
    const secrets: { name: string; label: string; optional?: boolean }[] = [];
    const js = (v: unknown) => (v && typeof v === "object" && "!!js" in (v as object) ? String((v as { "!!js": unknown })["!!js"]) : null);
    const took = (keys: string[], optional: boolean) => {
      for (const k of keys) if (!secrets.some((s) => s.name === k)) secrets.push({ name: k, label: k.toLowerCase().split("_").map((w, i) => (i ? w : w[0].toUpperCase() + w.slice(1))).join(" ").replace(/\bapi\b/, "API").slice(0, 60), ...(optional ? { optional: true } : {}) });
    };
    for (const field of ["headers", "env"]) {
      const whole = js(c[field]);
      if (whole !== null) {
        const got = envOf(whole, true);
        if (got) (c[field] = got.value), took(got.keys, got.optional);
      } else if (c[field] && typeof c[field] === "object")
        c[field] = Object.fromEntries(
          Object.entries(c[field] as Record<string, unknown>).map(([k, v]) => {
            const one = js(v);
            const got = one === null ? null : envOf(one, false);
            if (got) took(got.keys, got.optional);
            return [k, got ? got.value : v];
          }),
        );
    }
    const still = Object.entries(c).filter(([, v]) => js(v) !== null || (v && typeof v === "object" && Object.values(v as object).some((x) => js(x) !== null)));
    if (still.length) throw new Error(`Its server's ${still.map(([k]) => k).join(", ")} ${still.length > 1 ? "are" : "is"} worked out by DeepSeek Harness (!!js) beyond a key, which Liner Code can't do: add the server as a connection by hand.`);
    const str = (v: unknown) => (typeof v === "string" ? v : undefined);
    const strs = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === "string")) as Record<string, string> : undefined);
    const transport = str(c.transport) ?? (c.command ? "stdio" : "streamable-http");
    const server = transport === "stdio" ? { stdio: { command: str(c.command), ...(Array.isArray(c.args) ? { args: c.args.map(String) } : {}), ...(strs(c.env) ? { env: strs(c.env) } : {}) } } : { http: { url: str(c.url), ...(strs(c.headers) ? { headers: strs(c.headers) } : {}) } };
    if (transport !== "stdio" && transport !== "streamable-http" && transport !== "http") throw new Error(`Its server speaks ${transport}, which Liner Code's connections don't: streamable HTTP or a command only.`);
    if (mcp.length > 1) left.push(`${mcp.length - 1} more MCP server${mcp.length > 2 ? "s" : ""} it connects: Liner Code adds the first.`);
    if (c.cwd) left.push("The folder it starts its server in: Liner Code's tools start it in the session's.");
    const sid = typeof c.serverName === "string" && ADDON_ID.test(c.serverName) && !/^liner/.test(c.serverName) ? c.serverName : id;
    const manifest = checkManifest({ apiVersion: 1, id: sid, kind: "connection", name, ...(description ? { description } : {}), ...(first ? { summary: first } : {}), server, ...(secrets.length ? { secrets } : {}) });
    return { manifest, left, size, deps: [] };
  }
  // Tools and nothing to show: a connection whose server is its own program.
  if (host && tools.length) {
    if (usesModel) left.push("The model its program asks for itself: with no page to pick one on, it has none here.");
    const dsh = { package: pkg, version, integrity: o.integrity ?? digestOf(dir, files), host, ...(mine[0]?.config && typeof mine[0].config === "object" ? { config: mine[0].config } : {}), tools, ...instructions };
    const manifest = checkManifest({ apiVersion: 1, id, kind: "connection", name, ...(description ? { description } : {}), ...(first ? { summary: first } : {}), dsh }, { dsh: true });
    return { manifest, left, size, deps };
  }
  if (host) throw new Error(`${pkg} works inside DeepSeek Harness's own agent and window${left.length ? ` (${left[0].replace(/\.$/, "").replace(/^./, (c) => c.toLowerCase())})` : ""}, and has nothing Liner Code can show or give your agents: no page, panel, tools it names or MCP server.`);
  throw new Error(`${pkg} has nothing Liner Code can show or connect: no page, panel or MCP server${client ? " (it adds to parts of DeepSeek Harness's window Liner Code doesn't have)" : ""}.`);
}
