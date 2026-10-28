/*
  Small process helpers. Apps launched from the Dock don't get your shell's PATH, so the shell
  passes it in and everything here runs with it.
*/
import { execFile, spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

/** The full path of a command on PATH, or null. */
export function which(cmd: string, env: NodeJS.ProcessEnv = process.env): string | null {
  // A path is itself; an account that runs its own copy of a tool says where, as LINER_BIN_<TOOL>.
  const own = cmd.includes("/") ? cmd : env[binVar(cmd)];
  if (own) {
    try {
      accessSync(own, constants.X_OK);
      return own;
    } catch {
      return null;
    }
  }
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const p = join(dir, cmd);
    try {
      accessSync(p, constants.X_OK);
      return p;
    } catch {
      // not here
    }
  }
  return null;
}

/** "cursor-agent" → "LINER_BIN_CURSOR_AGENT". */
export const binVar = (cmd: string) => `LINER_BIN_${cmd.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;

export type Secrets = { token?: string; keys: Record<string, string> };

/**
  The engine's token and the keys from the keychain, taken out of `env`. Everything the engine
  starts (agents, their commands, the Terminal, git) inherits the environment, and a command
  that could read the token could answer its own approvals through /rpc. Only an engine run by
  hand passes them this way: a process's starting environment stays readable to anything running
  as you (`ps eww`) however much of it is deleted later, so the shell hands them over stdin.
*/
export function takeSecrets(env: NodeJS.ProcessEnv): Secrets {
  const token = env.LINER_TOKEN || undefined;
  let keys: Record<string, string> = {};
  try {
    keys = JSON.parse(env.LINER_KEYS || "{}") as Record<string, string>;
  } catch {
    // none
  }
  delete env.LINER_TOKEN;
  delete env.LINER_KEYS;
  return { token, keys };
}

/** The token and keys from the line the shell writes first on the engine's stdin. */
export function secretsFrom(line: string | null): Secrets {
  try {
    const v = JSON.parse(line ?? "") as { token?: unknown; keys?: unknown };
    const keys = v.keys && typeof v.keys === "object" ? Object.fromEntries(Object.entries(v.keys).filter((e): e is [string, string] => typeof e[1] === "string")) : {};
    return { token: typeof v.token === "string" && v.token ? v.token : undefined, keys };
  } catch {
    return { token: undefined, keys: {} };
  }
}

/** A stream's first line, or null if it ends first. The stream stays open (the engine's stdin is its lifeline). */
export function firstLine(stream: NodeJS.ReadableStream): Promise<string | null> {
  return new Promise((resolve) => {
    let got = "";
    const data = (chunk: Buffer | string) => {
      got += chunk.toString();
      const nl = got.indexOf("\n");
      if (nl < 0) return;
      stream.off("data", data);
      stream.off("end", end);
      stream.pause();
      resolve(got.slice(0, nl));
    };
    const end = () => {
      stream.off("data", data);
      resolve(null);
    };
    stream.on("data", data);
    stream.once("end", end);
  });
}

export type RunResult = { code: number; stdout: string; stderr: string };

/** Runs a command to the end and collects its output. Never throws on a non-zero exit. */
export function run(cmd: string, args: string[], o: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string; timeout?: number; maxBuffer?: number } = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { cwd: o.cwd, env: o.env ?? process.env, timeout: o.timeout ?? 30000, maxBuffer: o.maxBuffer ?? 32 * 1024 * 1024, encoding: "utf8" }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === "number" ? ((err as unknown as { code: number }).code) : 1) : 0;
      resolve({ code, stdout: stdout ?? "", stderr: stderr ?? (err ? String(err.message) : "") });
    });
    if (o.input !== undefined) {
      child.stdin?.end(o.input);
    }
  });
}

/** First line of `cmd --version`, or undefined. */
export async function versionOf(path: string, env: NodeJS.ProcessEnv, args = ["--version"]) {
  const r = await run(path, args, { env, timeout: 8000 });
  const line = (r.stdout || r.stderr).trim().split("\n")[0];
  return r.code === 0 && line ? line.slice(0, 80) : undefined;
}

/** Reads a child's stdout as lines of JSON, calling back for each parsed object. */
export function jsonLines(stream: NodeJS.ReadableStream, onLine: (v: unknown) => void, onRaw?: (line: string) => void) {
  let buf = "";
  stream.setEncoding?.("utf8");
  stream.on("data", (chunk: string) => {
    buf += chunk;
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        onLine(JSON.parse(line));
      } catch {
        onRaw?.(line);
      }
    }
  });
}

export { spawn };
