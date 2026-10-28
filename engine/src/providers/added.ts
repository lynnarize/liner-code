/*
  Tools you add to the ones Liner Code knows. An account is a known tool with its own config
  folder (so it signs in apart), its own variables and, if you say so, its own copy of the
  binary; it shows as a tool of its own, "Claude Code · Work". An added agent is anything that
  speaks ACP: picked from the ACP registry, or a command you give.

  From the registry, an npx or uvx agent runs from its package; a binary one is downloaded for
  this Mac, checked against the registry's sha256 when it gives one, and unpacked under the
  Liner Code home.
*/
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { AddedAgent, BuiltinProvider, ProviderId, RegistryAgent, ToolAccount } from "../../../contracts/src/index.ts";
import { ACCOUNT_HOME } from "../../../contracts/src/index.ts";
import { binVar, run, which } from "../exec.ts";
import { acpProvider } from "./acp.ts";
import type { Provider } from "./types.ts";

/** The variable that moves each tool's config folder, so a second account signs in apart. */
const HOME_VAR = ACCOUNT_HOME;
const BIN: Partial<Record<BuiltinProvider, string>> = { claude: "claude", codex: "codex", hermes: "hermes", opencode: "opencode", cursor: "cursor-agent", grok: "grok" };

const expand = (p: string) => resolve(p.trim().replace(/^~(?=\/|$)/, homedir()));
const tilde = (p: string) => (p.startsWith(homedir()) ? `~${p.slice(homedir().length)}` : p);
const quote = (v: string) => (/^[\w./:@~-]+$/.test(v) ? v : `'${v.replace(/'/g, `'\\''`)}'`);

/** What an account adds to its tool's environment. */
export function accountEnv(a: ToolAccount): Record<string, string> {
  const out: Record<string, string> = { ...(a.env ?? {}) };
  const home = HOME_VAR[a.provider];
  if (home && a.home?.trim()) out[home] = expand(a.home);
  const bin = BIN[a.provider];
  if (bin && a.binary?.trim()) out[binVar(bin)] = expand(a.binary);
  return out;
}

/** The known tool `base`, as another account. */
export function accountProvider(base: Provider, a: ToolAccount): Provider {
  const id = `${base.id}.${a.id}` as ProviderId;
  const extra = accountEnv(a);
  const envOf = (env: NodeJS.ProcessEnv) => ({ ...env, ...extra });
  const home = HOME_VAR[a.provider] ? extra[HOME_VAR[a.provider]!] : undefined;
  // Signing in runs the tool's own login with the account's folder and copy.
  const vars = Object.entries(extra)
    .filter(([k]) => !k.startsWith("LINER_BIN_"))
    .map(([k, v]) => `${k}=${quote(v)}`)
    .join(" ");
  const bin = BIN[a.provider] ? extra[binVar(BIN[a.provider]!)] : undefined;
  const login = (cmd: string) => {
    const own = bin ? cmd.replace(new RegExp(`^${BIN[a.provider]}\\b`), quote(bin)) : cmd;
    return vars ? `${vars} ${own}` : own;
  };
  return {
    id,
    async detect(env) {
      // Codex wants its home to exist before it will start.
      if (home) mkdirSync(home, { recursive: true });
      const d = await base.detect(envOf(env));
      const where = home ? `Signs in from ${tilde(home)}` : Object.keys(a.env ?? {}).length ? `With ${Object.keys(a.env ?? {}).join(", ")}` : "The same sign-in";
      return { ...d, id, label: `${d.label} · ${a.label}`, account: a.label, login: login(d.login), detail: d.available ? `${where}${bin ? `, runs ${tilde(bin)}` : ""}` : bin ? `${tilde(bin)} isn't there.` : d.detail };
    },
    models: base.models && ((env, scratch) => base.models!(envOf(env), scratch)),
    commands: base.commands && ((env, cwd) => base.commands!(envOf(env), cwd)),
    limits: base.limits && ((env, scratch) => base.limits!(envOf(env), scratch)),
    open: (o) => base.open({ ...o, env: envOf(o.env) }),
  };
}

/** An agent you added, as a tool. */
export function addedProvider(a: AddedAgent): Provider {
  return acpProvider(`acp.${a.id}`, {
    label: a.label,
    cmd: a.command,
    env: a.env,
    added: a.from,
    login: a.command.map(quote).join(" "),
    detail: a.from === "registry" ? `From the ACP registry${a.version ? `, ${a.version}` : ""}` : `Runs ${a.command.map(quote).join(" ")}`,
  });
}

/* ------------------------------------ The ACP registry ------------------------------------ */

const REGISTRY = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
type Runner = { package: string; args?: string[]; env?: Record<string, string> };
type Build = { archive: string; cmd: string; args?: string[]; sha256?: string; env?: Record<string, string> };
type Entry = { id: string; name: string; version: string; description?: string; website?: string; repository?: string; distribution: { npx?: Runner; uvx?: Runner; binary?: Record<string, Build> } };

const PLATFORM = `${process.platform === "win32" ? "windows" : process.platform}-${process.arch === "arm64" ? "aarch64" : "x86_64"}`;

/** The registry, kept on disk for a day. */
export async function readRegistry(home: string, force: boolean): Promise<{ entries: Entry[]; at: number; error?: string }> {
  const file = join(home, "acp-registry.json");
  let had: { at: number; agents: Entry[] } | null = null;
  try {
    had = JSON.parse(readFileSync(file, "utf8")) as { at: number; agents: Entry[] };
  } catch {
    // never fetched
  }
  if (had && !force && Date.now() - had.at < 24 * 3600_000) return { entries: had.agents, at: had.at };
  try {
    const r = await fetch(REGISTRY, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`The registry answered ${r.status}.`);
    const body = (await r.json()) as { agents?: Entry[] };
    const agents = (body.agents ?? []).filter((x) => x && typeof x.id === "string" && x.distribution);
    writeFileSync(file, JSON.stringify({ at: Date.now(), agents }));
    return { entries: agents, at: Date.now() };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return had ? { entries: had.agents, at: had.at, error } : { entries: [], at: 0, error };
  }
}

/** How each entry would run here, and which you already added. */
export function listRegistry(entries: Entry[], added: AddedAgent[], env: NodeJS.ProcessEnv): RegistryAgent[] {
  const npx = Boolean(which("npx", env));
  const uvx = Boolean(which("uvx", env));
  return entries
    .map((x): RegistryAgent => {
      const d = x.distribution;
      const how = d.binary?.[PLATFORM] ? "binary" : d.npx ? "npx" : d.uvx ? "uvx" : "binary";
      const runnable = how === "binary" ? Boolean(d.binary?.[PLATFORM]) : how === "npx" ? npx : uvx;
      const mine = added.find((a) => a.registryId === x.id);
      return { id: x.id, name: x.name, version: x.version, description: x.description ?? "", website: x.website ?? x.repository, how, runnable, added: mine ? (`acp.${mine.id}` as ProviderId) : undefined };
    })
    .sort((a, b) => Number(b.runnable) - Number(a.runnable) || a.name.localeCompare(b.name));
}

/** A short id for an added agent, unique among the ones you have. */
export function slugFor(name: string, taken: string[]) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "agent";
  let id = base;
  for (let i = 2; taken.includes(id); i++) id = `${base}-${i}`;
  return id;
}

/** Turns a registry entry into an agent you can run: a package command, or a download for this Mac. */
export async function fromRegistry(entry: Entry, home: string, taken: string[], env: NodeJS.ProcessEnv): Promise<AddedAgent> {
  const d = entry.distribution;
  const id = slugFor(entry.id, taken);
  const base = { id, label: entry.name, from: "registry" as const, registryId: entry.id, version: entry.version, description: entry.description };
  const build = d.binary?.[PLATFORM];
  if (build) {
    const dir = join(home, "agents", entry.id, entry.version);
    const cmd = resolve(dir, build.cmd);
    if (!existsSync(cmd)) await download(build, dir, env);
    if (!existsSync(cmd)) throw new Error(`The download didn't have ${build.cmd} in it.`);
    return { ...base, command: [cmd, ...(build.args ?? [])], env: build.env };
  }
  if (d.npx) {
    if (!which("npx", env)) throw new Error("This agent runs through npx, which isn't installed. Install Node.js, then add it again.");
    return { ...base, command: ["npx", "-y", d.npx.package, ...(d.npx.args ?? [])], env: d.npx.env };
  }
  if (d.uvx) {
    if (!which("uvx", env)) throw new Error("This agent runs through uvx, which isn't installed. Install uv (brew install uv), then add it again.");
    return { ...base, command: ["uvx", d.uvx.package, ...(d.uvx.args ?? [])], env: d.uvx.env };
  }
  throw new Error(`${entry.name} has no build for this Mac.`);
}

async function download(build: Build, dir: string, env: NodeJS.ProcessEnv) {
  const r = await fetch(build.archive, { signal: AbortSignal.timeout(10 * 60_000) });
  if (!r.ok) throw new Error(`The download answered ${r.status}.`);
  const data = Buffer.from(await r.arrayBuffer());
  if (build.sha256 && createHash("sha256").update(data).digest("hex") !== build.sha256.toLowerCase()) throw new Error("The download didn't match the registry's checksum, so it wasn't unpacked.");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const name = build.archive.split("?")[0].split("/").pop() || "agent.tar.gz";
  const archive = join(dir, `.${name}`);
  writeFileSync(archive, data);
  // The system tar unpacks .tar.gz, .tar.bz2 and .zip alike.
  const x = await run("/usr/bin/tar", ["-xf", archive, "-C", dir], { env, timeout: 5 * 60_000 });
  rmSync(archive, { force: true });
  if (x.code !== 0) throw new Error(`Couldn't unpack it: ${(x.stderr || x.stdout).trim().slice(0, 200)}`);
}

/** A command you typed, split the way a shell would for plain words and quotes. */
export function splitCommand(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q: string | null = null;
  let any = false;
  for (const ch of line.trim()) {
    if (q) {
      if (ch === q) q = null;
      else cur += ch;
    } else if (ch === "'" || ch === '"') {
      q = ch;
      any = true;
    } else if (/\s/.test(ch)) {
      if (cur || any) out.push(cur);
      cur = "";
      any = false;
    } else cur += ch;
  }
  if (cur || any) out.push(cur);
  return out.map((w, i) => (i === 0 ? w.replace(/^~(?=\/|$)/, homedir()) : w));
}
