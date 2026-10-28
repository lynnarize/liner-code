/*
  First launch. The mark draws itself in the middle of the window, glides left as "Liner Code"
  comes into focus, the line under it says what this is, and the lockup docks in the corner as
  the first step arrives. Then three steps: connect the models you already pay for, add the
  projects you work in, and pick how you'll work (optional).
*/
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { FoundRepo, ProviderInfo, SystemCheck } from "@contracts";
import { Alert } from "@liner/components/alert/alert";
import { toast } from "@liner/components/toast/toast";
import { prefersReducedMotion } from "@liner/lib/spring";
import { bridge } from "./bridge";
import { rpc, useEngine } from "./engine";
import { Glyph, I, Mark } from "./icons";
import { plural, since } from "./model";

const TOOLS: { id: ProviderInfo["id"]; tile: string; name: string; beta?: boolean }[] = [
  { id: "claude", tile: "CC", name: "Claude Code" },
  { id: "codex", tile: "CX", name: "Codex CLI" },
  { id: "opencode", tile: "OC", name: "OpenCode" },
  { id: "hermes", tile: "HE", name: "Hermes" },
  { id: "cursor", tile: "CU", name: "Cursor", beta: true },
  { id: "grok", tile: "GR", name: "Grok Build", beta: true },
];
/** The API key that stands in for a tool's own sign-in. */
const KEY_OF: Partial<Record<string, string>> = { claude: "anthropic", codex: "openai" };
const KEYS: { id: string; tile: string; name: string; note: string; live: boolean }[] = [
  { id: "anthropic", tile: "A", name: "Anthropic", note: "Opus, Sonnet, Haiku, through Claude Code. Anthropic asks apps built on its Agent SDK to use a key", live: true },
  { id: "openai", tile: "O", name: "OpenAI", note: "GPT models, through Codex", live: true },
  { id: "google", tile: "G", name: "Google", note: "Gemini models", live: false },
  { id: "xai", tile: "X", name: "xAI", note: "Grok models", live: false },
  { id: "mistral", tile: "M", name: "Mistral", note: "Mistral and Codestral", live: false },
  { id: "deepseek", tile: "D", name: "DeepSeek", note: "DeepSeek models", live: false },
  { id: "openrouter", tile: "R", name: "OpenRouter", note: "Hundreds of models, one key", live: false },
  { id: "local", tile: "L", name: "Local", note: "Ollama or LM Studio, on this Mac", live: false },
];

export function Setup({ onDone }: { onDone: () => void }) {
  const [intro, setIntro] = useState(() => !prefersReducedMotion());
  const [step, setStep] = useState(0);
  const machine = window.__LINER__?.machine ?? "This computer";
  useEffect(() => {
    if (!intro) return;
    const t = window.setTimeout(() => setIntro(false), 3300);
    return () => window.clearTimeout(t);
  }, [intro]);

  return (
    <div className="lc-setup" data-intro={intro || undefined}>
      <header className="lc-setup-top" data-drag>
        <Lockup intro={intro} />
        <ol className="lc-stepper" aria-label="Setup steps">
          {["Connect models", "Add projects", "How you'll work"].map((s, i) => (
            <li key={s} data-state={i < step ? "done" : i === step ? "now" : "next"}>
              <span className="lc-step-n">{i < step ? <I.check size={11} /> : i + 1}</span>
              {s}
              {i === 2 && <span className="lc-quiet">optional</span>}
            </li>
          ))}
        </ol>
        <span className="lc-machine">
          <i />
          {machine}
        </span>
      </header>
      <main className="lc-setup-main">
        {step === 0 && <Models onNext={() => setStep(1)} />}
        {step === 1 && <Projects onBack={() => setStep(0)} onNext={() => setStep(2)} />}
        {step === 2 && <Work onBack={() => setStep(1)} onDone={onDone} />}
      </main>
    </div>
  );
}

/** The mark and the wordmark, which start large in the middle and dock in the corner. */
function Lockup({ intro }: { intro: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [from, setFrom] = useState<{ x: number; y: number } | null>(null);
  // Measured untransformed, and again once the font has loaded and the wordmark has its width.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !intro) return;
    const measure = () => {
      const r = { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight };
      for (let p = el.offsetParent as HTMLElement | null; p; p = p.offsetParent as HTMLElement | null) {
        r.left += p.offsetLeft;
        r.top += p.offsetTop;
      }
      setFrom({ x: window.innerWidth / 2 - (r.left + r.width / 2), y: window.innerHeight / 2 - 40 - (r.top + r.height / 2) });
    };
    measure();
    void document.fonts.ready.then(measure);
  }, [intro]);
  return (
    <span ref={ref} className="lc-lockup" data-intro={intro || undefined} data-measured={Boolean(from) || undefined} style={from && intro ? ({ "--fx": `${from.x}px`, "--fy": `${from.y}px` } as CSSProperties) : undefined}>
      <Mark size={26} draw />
      <span className="lc-lockup-wm">Liner Code</span>
      <span className="lc-lockup-tag" aria-hidden={!intro}>
        Your models, your code. Agents when you want them.
      </span>
    </span>
  );
}

function Models({ onNext }: { onNext: () => void }) {
  const providers = useEngine((s) => s.providers);
  const keys = useEngine((s) => s.keys);
  const [typing, setTyping] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [checking, setChecking] = useState(false);
  const [mac, setMac] = useState<SystemCheck | null>(null);
  const checkMac = () => void rpc("system.check", {}).then(setMac, () => {});
  useEffect(checkMac, []);
  const ready = TOOLS.filter((t) => providers.find((p) => p.id === t.id && p.available && p.adapter)).length;

  const save = async (id: string) => {
    const key = value.trim();
    if (!key) return;
    try {
      await bridge.keychainSet(`key:${id}`, key);
      await rpc("keys.set", { provider: id, key });
      if (id === "anthropic") await rpc("settings.save", { claudeBilling: "key" });
      toast.success(`${KEYS.find((k) => k.id === id)?.name} key saved`, { description: "Kept in this Mac's keychain." });
      setTyping(null);
      setValue("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="lc-step" aria-label="Connect your models">
      <h1>Connect your models</h1>
      <p className="lc-step-sub">Use the coding tools you already have, each signed in its own way, or API keys. Liner Code never sees a sign-in and doesn't resell tokens: every call is billed to your own account.</p>
      {mac && mac.install && (
        <Alert
          tone="warning"
          title="This Mac needs Apple's command line tools"
          actions={
            <>
              <button type="button" className="lc-btn" data-kind="primary" data-size="sm" onClick={() => bridge.runInTerminal(mac.install!)}>
                Install them
              </button>
              <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={checkMac}>
                Look again
              </button>
            </>
          }
        >
          {[!mac.git && "Git (for undo, diffs and worktrees)", !mac.python && "Python (for the Terminal)"].filter(Boolean).join(" and ")} come with them. Apple's installer takes a few minutes; then look again.
        </Alert>
      )}
      <div className="lc-grp">
        <div className="lc-grp-h">
          <b>Tools on this Mac</b>
          <span>Each signs in through its own login; Liner Code only asks whether it is</span>
          <span className="lc-grow" />
          <button
            type="button"
            className="lc-btn"
            data-kind="ghost"
            data-size="sm"
            disabled={checking}
            onClick={() => {
              setChecking(true);
              void rpc("providers.refresh", {}).finally(() => setChecking(false));
            }}
          >
            <I.refresh size={13} />
            {checking ? "Looking" : "Look again"}
          </button>
        </div>
        <div className="lc-frame lc-setup-frame">
          <div className="lc-fcard lc-cli">
            {TOOLS.map((t, i) => {
              const p = providers.find((x) => x.id === t.id);
              return (
                <div key={t.id} style={{ ["--i" as string]: i }}>
                  <span className="lc-tile-av">{t.tile}</span>
                  <span>
                    <b>
                      {t.name}
                      {t.beta && <small className="lc-quiet"> · Beta</small>}
                    </b>
                    <code>{p?.login || "—"}</code>
                  </span>
                  {!p ? (
                    <span className="lc-quiet">…</span>
                  ) : p.available && p.adapter && p.signedIn === false && !keys.includes(KEY_OF[t.id] ?? "") ? (
                    <button type="button" className="lc-btn" data-kind="plain" data-size="sm" title={`${p.login}, in Terminal`} onClick={() => bridge.runInTerminal(p.login)}>
                      Sign in
                    </button>
                  ) : p.available && p.adapter ? (
                    <span className="lc-ready" title={p.version}>
                      <I.check size={12} />
                      Ready
                    </span>
                  ) : p.available ? (
                    <span className="lc-soon" title={p.detail}>
                      Soon
                    </span>
                  ) : (
                    <button type="button" className="lc-btn" data-kind="plain" data-size="sm" title={p.install} onClick={() => p.install && bridge.runInTerminal(p.install)}>
                      Install
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="lc-grp">
        <div className="lc-grp-h">
          <b>API keys</b>
          <span>Kept in this Mac's keychain, never sent anywhere else</span>
        </div>
        <div className="lc-frame lc-setup-frame">
          <div className="lc-fcard lc-keys">
            {KEYS.map((k) => {
              const has = keys.includes(k.id);
              return (
                <div key={k.id}>
                  <span className="lc-tile-av" data-round>
                    {k.tile}
                  </span>
                  <span>
                    <b>{k.name}</b>
                    <small>{k.note}</small>
                  </span>
                  {has ? (
                    <span className="lc-ready">
                      <I.check size={12} />
                      Connected
                    </span>
                  ) : typing === k.id ? (
                    <span className="lc-keyin">
                      <span className="lc-keyin-f">
                        <I.lock size={12} />
                        <input autoFocus type="password" placeholder={k.id === "anthropic" ? "sk-ant-…" : "sk-…"} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void save(k.id)} aria-label={`${k.name} key`} />
                      </span>
                      <button type="button" className="lc-btn" data-kind="primary" data-size="sm" onClick={() => void save(k.id)}>
                        Save
                      </button>
                    </span>
                  ) : k.live ? (
                    <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => (setTyping(k.id), setValue(""))}>
                      Add key
                    </button>
                  ) : (
                    <span className="lc-soon">Soon</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <p className="lc-sure">
        <span>
          <I.check size={12} />
          No tokens resold, nothing in between
        </span>
        <span>
          <I.check size={12} />
          Switch models mid-session
        </span>
        <span>
          <I.check size={12} />
          Usage shows what each account spent
        </span>
      </p>
      <div className="lc-step-foot">
        <span className="lc-quiet">
          {ready || keys.length ? `${plural(ready, "plan")} and ${plural(keys.length, "key")} ${ready + keys.length === 1 ? "is" : "are"} ready.` : "Nothing is connected yet: the sample project works without any account."} Add more any time in Settings.
        </span>
        <span className="lc-grow" />
        <button type="button" className="lc-btn" data-kind="accent" data-size="lg" onClick={onNext}>
          Continue
        </button>
      </div>
    </section>
  );
}

function Projects({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const [found, setFound] = useState<FoundRepo[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [sample, setSample] = useState(true);
  const [clone, setClone] = useState("");
  const [busy, setBusy] = useState(false);
  const projects = useEngine((s) => s.projects);

  useEffect(() => {
    void rpc("projects.scan", {}).then((r) => {
      setFound(r);
      setPicked(new Set(r.filter((x) => !x.added).slice(0, 3).map((x) => x.path)));
    });
  }, []);
  const roots = useMemo(() => [...new Set((found ?? []).map((f) => f.path.replace(/\/[^/]+$/, "").replace(/^\/Users\/[^/]+/, "~")))].slice(0, 2), [found]);

  const addFolder = async () => {
    const path = await bridge.pickFolder();
    if (!path) return;
    try {
      const p = await rpc("project.add", { path });
      setFound((f) => [{ path: p.path, name: p.name, branch: p.branch, lastCommitAt: p.lastCommitAt, added: true }, ...(f ?? []).filter((x) => x.path !== p.path)]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const doClone = async () => {
    if (!clone.trim()) return;
    setBusy(true);
    try {
      const p = await rpc("project.clone", { url: clone.trim() });
      setFound((f) => [{ path: p.path, name: p.name, branch: p.branch, lastCommitAt: p.lastCommitAt, added: true }, ...(f ?? [])]);
      setClone("");
      toast.success(`Cloned ${p.name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const next = async () => {
    setBusy(true);
    try {
      for (const path of picked) await rpc("project.add", { path });
      if (sample) await rpc("project.add", { path: "@sample" });
      onNext();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const count = picked.size + (sample ? 1 : 0) + (found ?? []).filter((f) => f.added).length;

  return (
    <section className="lc-step lc-step-narrow" aria-label="Add the projects you work in">
      <h1>Add the projects you work in</h1>
      <p className="lc-step-sub">
        {found === null ? (
          <span className="l-shimmer">Looking for Git repositories on this Mac</span>
        ) : found.length ? (
          <>
            Found {plural(found.length, "Git repository", "Git repositories")}
            {roots.length ? (
              <>
                {" "}
                in <code className="lc-code">{roots.join(", ")}</code>
              </>
            ) : null}
            . Pick the ones to add; you can add more any time.
          </>
        ) : (
          "No Git repositories turned up in the usual places. Add a folder, or clone one."
        )}
      </p>
      <div className="lc-frame lc-setup-frame">
        <div className="lc-fcard lc-prj">
          <label className="lc-prj-row">
            <input type="checkbox" checked={sample} onChange={(e) => setSample(e.target.checked)} />
            <I.sparkle size={14} />
            <span>
              <b>Sample project</b>
              <small>Tide tables, with the Demo agent. No account needed.</small>
            </span>
            <span className="lc-quiet lc-mono">main</span>
          </label>
          {(found ?? []).slice(0, 12).map((f) => (
            <label key={f.path} className="lc-prj-row" data-added={f.added || undefined}>
              <input
                type="checkbox"
                checked={f.added || picked.has(f.path)}
                disabled={f.added}
                onChange={(e) =>
                  setPicked((p) => {
                    const n = new Set(p);
                    if (e.target.checked) n.add(f.path);
                    else n.delete(f.path);
                    return n;
                  })
                }
              />
              <I.folder size={14} />
              <span>
                <b>{f.name}</b>
                <small className="lc-mono">{f.path.replace(/^\/Users\/[^/]+/, "~")}</small>
              </span>
              <span className="lc-quiet">
                {f.added ? "Added" : (
                  <>
                    <span className="lc-mono">{f.branch ?? "—"}</span>
                    {f.lastCommitAt ? ` · ${since(f.lastCommitAt)}` : ""}
                  </>
                )}
              </span>
            </label>
          ))}
        </div>
        <div className="lc-prj-strip">
          <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => void addFolder()}>
            <I.folder size={13} />
            Add a folder
          </button>
          <input className="lc-input" placeholder="Clone from GitHub: owner/repo or a URL" value={clone} onChange={(e) => setClone(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void doClone()} />
          <button type="button" className="lc-btn" data-kind="plain" data-size="sm" disabled={busy || !clone.trim()} onClick={() => void doClone()}>
            Clone
          </button>
        </div>
      </div>
      <div className="lc-step-foot">
        <span className="lc-quiet">{count ? `${plural(count, "project")}${projects.length ? "" : ""}.` : "No projects yet."} Quick tasks can still run in the sample project.</span>
        <span className="lc-grow" />
        <button type="button" className="lc-btn" data-kind="ghost" data-size="lg" onClick={onBack}>
          Back
        </button>
        <button type="button" className="lc-btn" data-kind="accent" data-size="lg" disabled={busy} onClick={() => void next()}>
          {busy ? "Adding" : "Continue"}
        </button>
      </div>
    </section>
  );
}

function Work({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const [pick, setPick] = useState<"model" | "lead" | "team">("model");
  const finish = async () => {
    await rpc("settings.save", { onboarded: true, workStyle: pick });
    onDone();
  };
  const cards = [
    { id: "model" as const, title: "Just a model", sub: "Simplest", body: "Talk to one model directly: no roles, no hand-offs. Pick the model for each session.", icon: <span className="lc-disc" style={{ width: 32, height: 32 }}><Glyph glyph="spark" size={15} /></span> },
    {
      id: "lead" as const,
      title: "A lead and a coder",
      sub: "For bigger changes",
      body: "Helm plans on Opus 5.5 and hands the code to Forge on Sonnet 5.5. You approve the plan before anything changes.",
      icon: (
        <span className="lc-stack">
          <span className="lc-disc" data-filled style={{ width: 32, height: 32 }}>
            <Glyph glyph="sun" size={15} />
          </span>
          <span className="lc-disc" style={{ width: 32, height: 32 }}>
            <Glyph glyph="moon" size={15} />
          </span>
        </span>
      ),
    },
    { id: "team" as const, title: "Build your own team", sub: "Any number of agents", body: "Pick what each agent is good at, the model it runs on, what it may change, and its soul.", icon: <span className="lc-disc" style={{ width: 32, height: 32 }}><I.sparkle size={15} /></span> },
  ];
  return (
    <section className="lc-step" aria-label="How do you want to work?">
      <h1>How do you want to work?</h1>
      <p className="lc-step-sub">Agents are optional. Start with a model on its own, and add a team whenever a job calls for one.</p>
      <div className="lc-rcs" role="radiogroup" aria-label="How you'll work">
        {cards.map((c, i) => (
          <button key={c.id} type="button" role="radio" aria-checked={pick === c.id} className="lc-rc l-focus" data-on={pick === c.id || undefined} style={{ ["--i" as string]: i }} onClick={() => setPick(c.id)}>
            {pick === c.id && (
              <span className="lc-rc-tick">
                <I.check size={12} />
              </span>
            )}
            {c.icon}
            <span>
              <b>{c.title}</b>
              <small>{c.sub}</small>
            </span>
            <p>{c.body}</p>
          </button>
        ))}
      </div>
      <div className="lc-step-foot">
        <span className="lc-quiet">You can switch any session between a model and a team from the composer.</span>
        <span className="lc-grow" />
        <button type="button" className="lc-btn" data-kind="ghost" data-size="lg" onClick={onBack}>
          Back
        </button>
        <button type="button" className="lc-btn" data-kind="accent" data-size="lg" onClick={() => void finish()}>
          Open Liner Code
        </button>
      </div>
    </section>
  );
}
