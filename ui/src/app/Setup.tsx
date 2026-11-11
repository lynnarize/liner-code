/*
  First launch. The mark draws itself in the middle of the window, glides left as "Liner Code"
  comes into focus, the line under it says what this is, and the lockup docks in the corner as
  the first step arrives. Then three steps: connect the models you already pay for, add the
  projects you work in, and pick who works on a new session: a pair, the best model or the fast one (optional).
*/
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { FoundRepo, ProviderInfo, Settings, SystemCheck } from "@contracts";
import { castOf } from "@contracts";
import { Alert } from "@liner/components/alert/alert";
import { toast } from "@liner/components/toast/toast";
import { prefersReducedMotion } from "@liner/lib/spring";
import { bridge } from "./bridge";
import { rpc, useEngine } from "./engine";
import { Glyph, I, ModelMark, type MarkKind } from "./icons";
import { markOf, modelLabel, pairReady, plural, since } from "./model";

type Start = NonNullable<Settings["start"]>;
import * as os from "./os";

/** Each tool and each maker shows its own mark, in the same ink on the same tile as in the model picker. */
const TOOLS: { id: ProviderInfo["id"]; mark: MarkKind; name: string; beta?: boolean }[] = [
  { id: "claude", mark: "claudecode", name: "Claude Code" },
  { id: "codex", mark: "codex", name: "Codex CLI" },
  { id: "opencode", mark: "opencode", name: "OpenCode" },
  { id: "hermes", mark: "hermes", name: "Hermes" },
  { id: "cursor", mark: "cursor", name: "Cursor", beta: true },
  { id: "grok", mark: "grok", name: "Grok Build", beta: true },
];
/** The API key that stands in for a tool's own sign-in. */
const KEY_OF: Partial<Record<string, string>> = { claude: "anthropic", codex: "openai" };
const KEYS: { id: string; mark: MarkKind; name: string; note: string; live: boolean }[] = [
  { id: "anthropic", mark: "claude", name: "Anthropic", note: "Claude models, as Anthropic asks apps to use them", live: true },
  { id: "openai", mark: "openai", name: "OpenAI", note: "GPT models, through Codex", live: true },
  { id: "google", mark: "gemini", name: "Google", note: "Gemini models", live: false },
  { id: "xai", mark: "grok", name: "xAI", note: "Grok models", live: false },
  { id: "mistral", mark: "mistral", name: "Mistral", note: "Mistral and Codestral", live: false },
  { id: "deepseek", mark: "deepseek", name: "DeepSeek", note: "DeepSeek models", live: false },
  { id: "openrouter", mark: "openrouter", name: "OpenRouter", note: "Hundreds of models, one key", live: false },
  { id: "local", mark: "ollama", name: "Local", note: `Ollama or LM Studio, on ${os.here}`, live: false },
];

export function Setup({ onDone }: { onDone: () => void }) {
  const [intro, setIntro] = useState(() => !prefersReducedMotion());
  const [step, setStep] = useState(0);
  const machine = window.__LINER__?.machine ?? "This computer";
  useEffect(() => {
    if (!intro) return;
    const t = window.setTimeout(() => setIntro(false), 2600);
    return () => window.clearTimeout(t);
  }, [intro]);

  return (
    <div className="lc-setup" data-intro={intro || undefined}>
      <header className="lc-setup-top" data-drag>
        <Lockup intro={intro} />
        <ol className="lc-stepper" aria-label="Setup steps">
          {["Connect models", "Add projects", "Who works"].map((s, i) => (
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

/** The wordmark, which starts where the boot screen left it, says what this is, and docks in the corner. */
function Lockup({ intro }: { intro: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [from, setFrom] = useState<{ x: number; y: number } | null>(null);
  // Measured untransformed, and again once the font has loaded and the wordmark has its width.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !intro) return;
    const measure = () => {
      let left = el.offsetLeft;
      for (let p = el.offsetParent as HTMLElement | null; p; p = p.offsetParent as HTMLElement | null) left += p.offsetLeft;
      // The bar's centre, not offsetTop: that rounds, and half a pixel shows when the name changes hands.
      const bar = el.parentElement!.getBoundingClientRect();
      setFrom({ x: window.innerWidth / 2 - (left + el.offsetWidth / 2), y: window.innerHeight / 2 - (bar.top + bar.height / 2) });
    };
    measure();
    void document.fonts.ready.then(measure);
  }, [intro]);
  return (
    <span ref={ref} className="lc-lockup" data-intro={intro || undefined} data-measured={Boolean(from) || undefined} style={from && intro ? ({ "--fx": `${from.x}px`, "--fy": `${from.y}px` } as CSSProperties) : undefined}>
      <span>Liner Code</span>
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
  // Ready the way its row says it: a tool still asking you to sign in (with no key standing in) isn't.
  const ready = TOOLS.filter((t) => providers.find((p) => p.id === t.id && p.available && p.adapter && !(p.signedIn === false && !keys.includes(KEY_OF[t.id] ?? "")))).length;
  // "1 tool is ready", "2 keys are ready", "1 tool and 1 key are ready": only what there is.
  const readyLine = [ready > 0 && plural(ready, "tool"), keys.length > 0 && plural(keys.length, "key")].filter(Boolean).join(" and ");

  const save = async (id: string) => {
    const key = value.trim();
    if (!key) return;
    try {
      await bridge.keychainSet(`key:${id}`, key);
      await rpc("keys.set", { provider: id, key });
      if (id === "anthropic") await rpc("settings.save", { claudeBilling: "key" });
      toast.success(`${KEYS.find((k) => k.id === id)?.name} key saved`, { description: `Kept in ${os.keyStore("this Mac's keychain")}.` });
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
      <div className="lc-step-body">
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
        {mac && !mac.rg && (
          <Alert
            tone="warning"
            title={`Agents search code with ripgrep, which isn't on ${os.here}`}
            actions={
              mac.rgInstall ? (
                <>
                  <button type="button" className="lc-btn" data-kind="primary" data-size="sm" onClick={() => bridge.runInTerminal(mac.rgInstall!)}>
                    Install it
                  </button>
                  <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={checkMac}>
                    Look again
                  </button>
                </>
              ) : undefined
            }
          >
            Without it, an agent's first search fails. {mac.rgInstall ? "Homebrew adds it in a few seconds." : "Install it from github.com/BurntSushi/ripgrep, then look again."}
          </Alert>
        )}
        <div className="lc-grp">
          <div className="lc-grp-h">
            <b>Tools on {os.here}</b>
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
                    <span className="lc-tile-av">
                      <ModelMark kind={t.mark} size={16} />
                    </span>
                    <span>
                      <b>
                        {t.name}
                        {t.beta && <small className="lc-quiet"> · Beta</small>}
                      </b>
                      <code title={p?.login}>{p?.login || "—"}</code>
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
            <span>Kept in {os.keyStore("this Mac's keychain")}, never sent anywhere else</span>
          </div>
          <div className="lc-frame lc-setup-frame">
            <div className="lc-fcard lc-keys">
              {KEYS.map((k) => {
                const has = keys.includes(k.id);
                return (
                  <div key={k.id}>
                    <span className="lc-tile-av" data-round>
                      <ModelMark kind={k.mark} size={16} />
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
                          <input autoFocus type="password" placeholder={k.id === "anthropic" ? "sk-ant-…" : "sk-…"} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => (e.key === "Enter" ? void save(k.id) : e.key === "Escape" && (setTyping(null), setValue("")))} aria-label={`${k.name} key`} />
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
      </div>
      <div className="lc-step-foot">
        <span className="lc-quiet">
          {readyLine ? `${readyLine} ${ready + keys.length === 1 ? "is" : "are"} ready.` : "Nothing is connected yet."} Add more any time in Settings.
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
  // The sample project is the Demo's, so it's offered only while the Demo is shown.
  const showDemo = useEngine((s) => s.settings.showDemo === true);
  const [sample, setSample] = useState(showDemo);
  const [clone, setClone] = useState("");
  const [busy, setBusy] = useState(false);
  const projects = useEngine((s) => s.projects);

  useEffect(() => {
    // A scan that fails says nothing turned up, rather than looking for ever.
    void rpc("projects.scan", {})
      .then((r) => {
        setFound(r);
        setPicked(new Set(r.filter((x) => !x.added).slice(0, 3).map((x) => x.path)));
      })
      .catch(() => setFound([]));
  }, []);
  const roots = useMemo(() => [...new Set((found ?? []).map((f) => os.tilde(f.path.replace(/[\\/][^\\/]+$/, ""))))].slice(0, 2), [found]);

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
          <span className="l-shimmer">Looking for Git repositories on {os.here}</span>
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
      <div className="lc-step-body">
        <div className="lc-frame lc-setup-frame">
          <div className="lc-fcard lc-prj">
            {showDemo && (
              <label className="lc-prj-row">
                <input type="checkbox" checked={sample} onChange={(e) => setSample(e.target.checked)} />
                <I.sparkle size={14} />
                <span>
                  <b>Sample project</b>
                  <small>Tide tables, with the Demo agent. No account needed.</small>
                </span>
                <span className="lc-quiet lc-mono">main</span>
              </label>
            )}
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
                  <small className="lc-mono">{os.tilde(f.path)}</small>
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
            <input className="lc-input" placeholder="Clone from GitHub: owner/repo or a URL" aria-label="Clone from GitHub" value={clone} onChange={(e) => setClone(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void doClone()} />
            <button type="button" className="lc-btn" data-kind="plain" data-size="sm" disabled={busy || !clone.trim()} onClick={() => void doClone()}>
              Clone
            </button>
          </div>
        </div>
      </div>
      <div className="lc-step-foot">
        <span className="lc-quiet">{count ? `${plural(count, "project")}${projects.length ? "" : ""}.` : "No projects yet."} {showDemo ? "Quick tasks can still run in the sample project." : "Quick tasks can still run without a project."}</span>
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
  const providers = useEngine((s) => s.providers);
  const settings = useEngine((s) => s.settings);
  // Who'd work, from the tools found: the lead and its sidekick, your own picks first.
  const pair = useMemo(() => castOf(providers, { picks: settings.picks }), [providers, settings.picks]);
  const two = pairReady(pair);
  // Starts on what you have, so running the setup again doesn't change it; unset, a pair when there can be one.
  const [pick, setPick] = useState<Start>(() => settings.start ?? (two ? "pair" : "best"));
  const shown: Start = pick === "pair" && !two ? "best" : pick;
  const lead = pair ? modelLabel(pair.lead, providers) : "The best model you connect";
  const side = pair ? modelLabel(pair.sidekick, providers) : "a quicker, cheaper one";
  const finish = async () => {
    try {
      await rpc("settings.save", { onboarded: true, start: shown });
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const disc = (ref: string | undefined, glyph: ReactNode) => (
    <span className="lc-disc" style={{ width: 32, height: 32 }}>
      {ref ? <ModelMark kind={markOf(ref)} size={15} /> : glyph}
    </span>
  );
  const cards: { id: Start; title: string; sub: string; body: string; icon: ReactNode; off?: boolean }[] = [
    {
      id: "pair",
      title: "Pair",
      sub: "For most work",
      body: two ? `${lead} leads: it plans, decides and reviews. ${side} does the work it hands over.` : "Needs two different models ready. Connect another tool and it's yours.",
      icon: (
        <span className="lc-stack">
          {disc(two ? pair?.lead : undefined, <Glyph glyph="sun" size={15} />)}
          {disc(two ? pair?.sidekick : undefined, <Glyph glyph="moon" size={15} />)}
        </span>
      ),
      off: !two,
    },
    { id: "best", title: "Best", sub: "One model, the strongest", body: `${lead} alone, on everything you ask.`, icon: disc(pair?.lead, <I.star size={15} />) },
    { id: "fast", title: "Fast", sub: "One model, quick and cheaper", body: two ? `${side} alone. Good for small, clear asks.` : `${lead} alone too, with one model ready.`, icon: disc(pair?.sidekick, <I.bolt size={15} />), off: !two },
  ];
  return (
    <section className="lc-step" aria-label="Who works on your sessions?">
      <h1>Who works on your sessions?</h1>
      <p className="lc-step-sub">What a new session starts with. Each session can change it, or pick any other model, from its composer.</p>
      <div className="lc-step-body">
        <div className="lc-rcs" role="radiogroup" aria-label="Who works on your sessions">
          {cards.map((c, i) => (
            <button key={c.id} type="button" role="radio" aria-checked={shown === c.id} className="lc-rc l-focus" data-on={shown === c.id || undefined} disabled={c.off} style={{ ["--i" as string]: i }} onClick={() => setPick(c.id)}>
              {shown === c.id && (
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
      </div>
      <div className="lc-step-foot">
        <span className="lc-quiet">Settings › Agentic features changes who leads and who's the sidekick.</span>
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
