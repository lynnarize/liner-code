/*
  Codex, through `codex exec --json`. Each turn is one process: the first starts a Codex
  thread, later ones resume it by id. Exec mode can't stop to ask, so access becomes Codex's
  sandbox instead: read only, write inside the project, or full access.
*/
import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Access, ModelInfo, PlanEntry, ProviderInfo } from "../../../contracts/src/index.ts";
import { jsonLines, run, spawn, versionOf, which } from "../exec.ts";
import { codexAsk, CodexServerSession, isLimit } from "./codex-server.ts";
import { effortOf, skillsIn } from "./models.ts";
import type { OpenOptions, Provider, ProviderSession, TurnSink } from "./types.ts";

let appServer = false;

const SANDBOX: Record<Access, string> = { read: "read-only", ask: "workspace-write", edits: "workspace-write", auto: "workspace-write", full: "danger-full-access" };

type CodexItem = {
  id: string;
  type: string;
  text?: string;
  command?: string;
  aggregated_output?: string;
  exit_code?: number | null;
  status?: string;
  changes?: { path: string; kind?: string }[];
  server?: string;
  tool?: string;
  query?: string;
  items?: { text: string; completed: boolean }[];
  message?: string;
};

/** The models this Codex sign-in can use, from its own catalog. */
async function catalog(bin: string, env: NodeJS.ProcessEnv) {
  const r = await run(bin, ["debug", "models"], { env, timeout: 20000 });
  try {
    const d = JSON.parse(r.stdout) as { models: { slug: string; display_name?: string; description?: string; visibility?: string; priority?: number; default_reasoning_level?: string; supported_reasoning_levels?: { effort: string; description?: string }[] }[] };
    return d.models.filter((m) => m.visibility === "list").sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  } catch {
    return [];
  }
}

/** Codex's errors come as JSON inside a string; this keeps the sentence a person reads. */
function readable(message: string) {
  try {
    const v = JSON.parse(message) as { message?: string; error?: { message?: string } };
    return v.error?.message ?? v.message ?? message;
  } catch {
    return message;
  }
}

function configuredModel(env: NodeJS.ProcessEnv) {
  try {
    const toml = readFileSync(join(env.CODEX_HOME || join(homedir(), ".codex"), "config.toml"), "utf8");
    return /^model\s*=\s*"([^"]+)"/m.exec(toml)?.[1];
  } catch {
    return undefined;
  }
}

class CodexSession implements ProviderSession {
  private thread: string | undefined;
  private o: OpenOptions;
  constructor(o: OpenOptions) {
    this.o = o;
    this.thread = o.resume;
  }

  turn(text: string, sink: TurnSink, signal: AbortSignal) {
    const o = this.o;
    const bin = which("codex", o.env);
    if (!bin) return Promise.reject(new Error("Codex isn't installed."));
    const common = ["--json", "--skip-git-repo-check", "-c", `sandbox_mode="${SANDBOX[o.access]}"`, "-c", `approval_policy="never"`];
    // Claude Code's extras mean nothing here; anything else is Codex's own name for the level.
    if (o.effort && !/^ultra(code|think)$/.test(o.effort)) common.push("-c", `model_reasoning_effort="${o.effort}"`);
    if (o.model && o.model !== "default") common.push("-m", o.model);
    if (o.soul) common.push("-c", `developer_instructions=${JSON.stringify(o.soul)}`);
    const args = this.thread ? ["exec", "resume", ...common, this.thread, "-"] : ["exec", ...common, "-C", o.cwd, "-"];
    return new Promise<void>((resolve, reject) => {
      const child = spawn(bin, args, { cwd: o.cwd, env: o.env, stdio: ["pipe", "pipe", "pipe"] });
      let err = "";
      const started = new Map<string, number>();
      // Codex repeats a failure as an item, an event and a turn failure; it's said once.
      const said = new Set<string>();
      const once = (say: (m: string) => void, raw: string) => {
        const m = readable(raw);
        if (said.has(m)) return;
        said.add(m);
        say(m);
      };
      child.stdin.end(text);
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (d: string) => (err = (err + d).slice(-4000)));
      const onItem = (it: CodexItem, phase: "started" | "updated" | "completed") => {
        const done = phase === "completed";
        if (!started.has(it.id)) started.set(it.id, Date.now());
        switch (it.type) {
          case "agent_message":
            if (done && it.text) sink.text(it.text, it.id);
            break;
          case "reasoning":
            if (done && it.text) sink.reasoning(it.text, it.id);
            break;
          case "command_execution": {
            const failed = done && it.exit_code != null && it.exit_code !== 0;
            sink.tool({ key: it.id, tool: "shell", toolKind: "exec", title: short(it.command), input: it.command, output: it.aggregated_output, status: !done ? "running" : failed || it.status === "failed" ? "failed" : "done" });
            break;
          }
          case "file_change": {
            const paths = (it.changes ?? []).map((c) => c.path.replace(o.cwd + "/", ""));
            sink.tool({ key: it.id, tool: "apply_patch", toolKind: "edit", title: `Edit ${paths.slice(0, 3).join(", ")}${paths.length > 3 ? ` and ${paths.length - 3} more` : ""}`, path: paths[0], status: !done ? "running" : it.status === "failed" ? "failed" : "done" });
            break;
          }
          case "mcp_tool_call":
            sink.tool({ key: it.id, tool: `${it.server}.${it.tool}`, toolKind: "other", title: `${it.server} · ${it.tool}`, status: !done ? "running" : it.status === "failed" ? "failed" : "done" });
            break;
          case "web_search":
            sink.tool({ key: it.id, tool: "web_search", toolKind: "web", title: `Search the web for ${short(it.query, 50)}`, status: done ? "done" : "running" });
            break;
          case "todo_list":
            sink.plan((it.items ?? []).map((t, i, all): PlanEntry => ({ title: t.text, status: t.completed ? "completed" : all.slice(0, i).every((x) => x.completed) ? "in_progress" : "pending" })));
            break;
          case "error":
            if (it.message) once(sink.notice, it.message);
            break;
        }
      };
      jsonLines(child.stdout, (v) => {
        const e = v as { type: string; thread_id?: string; item?: CodexItem; usage?: { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number }; error?: { message?: string }; message?: string };
        if (e.type === "thread.started" && e.thread_id) {
          this.thread = e.thread_id;
          sink.session(e.thread_id);
        } else if (e.item && (e.type === "item.started" || e.type === "item.updated" || e.type === "item.completed")) {
          onItem(e.item, e.type.slice(5) as "started" | "updated" | "completed");
        } else if (e.type === "turn.completed" && e.usage) {
          sink.usage({ inputTokens: e.usage.input_tokens ?? 0, cacheReadTokens: e.usage.cached_input_tokens ?? 0, outputTokens: e.usage.output_tokens ?? 0 });
        } else if (e.type === "turn.failed") {
          const m = e.error?.message ?? "Codex stopped with an error.";
          once(isLimit({ message: readable(m) }) ? (x) => sink.limited(x) : sink.error, m);
        } else if (e.type === "error" && e.message) {
          once(sink.error, e.message);
        }
      });
      const stop = () => child.kill("SIGINT");
      signal.addEventListener("abort", stop, { once: true });
      child.on("error", (e) => reject(e));
      child.on("close", (code) => {
        signal.removeEventListener("abort", stop);
        if (code === 0 || signal.aborted || said.size) resolve();
        else reject(new Error(err.trim().split("\n").slice(-3).join("\n") || `Codex exited with ${code}.`));
      });
    });
  }

  async update(o: Pick<OpenOptions, "model" | "effort" | "access">) {
    Object.assign(this.o, o);
    return true;
  }
  close() {}
}

const short = (s: unknown, n = 80) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export const codex: Provider = {
  id: "codex",
  async detect(env): Promise<ProviderInfo> {
    const path = which("codex", env);
    const configured = configuredModel(env);
    const base = { id: "codex" as const, label: "Codex CLI", adapter: true, login: "codex login", supports: { approvals: false, resume: true, effort: true, plan: true } };
    if (!path) return { ...base, models: [], available: false, detail: "Codex isn't installed.", install: "npm install -g @openai/codex, then codex login" };
    const [version, listed, server, status] = await Promise.all([versionOf(path, env), catalog(path, env), run(path, ["app-server", "--help"], { env, timeout: 15000 }), run(path, ["login", "status"], { env, timeout: 15000 })]);
    // "Logged in using ChatGPT" / "Not logged in"; an OpenAI key in the environment works too.
    const answer = `${status.stdout}${status.stderr}`;
    const signedIn = /logged in/i.test(answer) ? status.code === 0 && !/not logged in/i.test(answer) : env.OPENAI_API_KEY ? true : undefined;
    // A Codex with the app server can stop and ask; an older one runs through exec, which can't.
    appServer = server.code === 0;
    const models: ModelInfo[] = listed.map((m) => ({ id: m.slug, label: m.display_name ?? m.slug, description: m.description ?? "", efforts: (m.supported_reasoning_levels ?? []).map((e) => effortOf(e.effort, e.description)), defaultEffort: m.default_reasoning_level }));
    const usable = !configured || models.some((m) => m.id === configured);
    // The configured model goes first when this sign-in can use it; otherwise the catalog's own order.
    if (configured && usable) models.sort((a, b) => Number(b.id === configured) - Number(a.id === configured));
    if (!models.length) models.push({ id: "default", label: configured ?? "Configured model", description: "What ~/.codex/config.toml sets" });
    if (models[0]) models[0].isDefault = true;
    const detail = usable ? "Uses your Codex sign-in. Runs in Codex's sandbox; it can't stop to ask." : `Your config.toml picks ${configured}, which this sign-in can't use. Liner Code uses ${models[0].label} instead.`;
    const said = appServer ? detail.replace(" Runs in Codex's sandbox; it can't stop to ask.", " Asks before it acts, through its app server.") : detail;
    return { ...base, supports: { ...base.supports, approvals: appServer }, models, modelsFrom: listed.length ? ("cli" as const) : ("builtin" as const), modelsAt: Date.now(), available: true, version, signedIn, detail: signedIn === false ? "Not signed in: run codex login, or add an OpenAI key" : said };
  },
  open: (o) => (appServer ? new CodexServerSession(o) : new CodexSession(o)),
  async commands(env, cwd) {
    if (!appServer) return { commands: [], skills: skillsIn([join(env.CODEX_HOME || join(homedir(), ".codex"), "skills"), join(cwd, ".codex", "skills")]) };
    const r = await codexAsk<{ data?: { skills?: { name: string; description: string; shortDescription?: string; path: string; enabled: boolean }[] }[] }>(env, cwd, "skills/list", { cwds: [cwd] });
    const skills = (r.data ?? []).flatMap((d) => d.skills ?? []).filter((x) => x.enabled).map((x) => ({ name: x.name, description: x.shortDescription || x.description, path: x.path }));
    return { commands: [], skills };
  },
  async limits(env, scratch) {
    if (!appServer) return null;
    mkdirSync(scratch, { recursive: true });
    const r = await codexAsk<{ rateLimits?: Snapshot; rateLimitsByLimitId?: Record<string, Snapshot | undefined> | null }>(env, scratch, "account/rateLimits/read", {});
    const snaps = Object.values(r.rateLimitsByLimitId ?? {}).filter((x): x is Snapshot => Boolean(x));
    const all = snaps.length ? snaps : r.rateLimits ? [r.rateLimits] : [];
    const window = (w: Window | null | undefined, name: string) => (w ? [{ label: name, usedPercent: w.usedPercent, resetsAt: w.resetsAt ? w.resetsAt * 1000 : undefined }] : []);
    const span = (mins: number | null | undefined, fallback: string) => (!mins ? fallback : mins <= 300 ? `${Math.round(mins / 60)}-hour window` : mins >= 10000 ? "Weekly" : `${Math.round(mins / 1440)}-day window`);
    return {
      plan: all[0]?.planType ?? undefined,
      windows: all.flatMap((sn) => [...window(sn.primary, `${sn.limitName ? `${sn.limitName}, ` : ""}${span(sn.primary?.windowDurationMins, "Short window")}`), ...window(sn.secondary, `${sn.limitName ? `${sn.limitName}, ` : ""}${span(sn.secondary?.windowDurationMins, "Long window")}`)]),
    };
  },
};
type Window = { usedPercent: number; windowDurationMins: number | null; resetsAt: number | null };
type Snapshot = { limitName: string | null; primary: Window | null; secondary: Window | null; planType: string | null };
