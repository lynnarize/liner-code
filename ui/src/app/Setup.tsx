/*
  First launch, as one window that never scrolls: Liner Code on a quiet aside at the left (what this is,
  which computer is being set up, and that it never sees a sign-in), and at the right what it guessed,
  ready to start. Three rows, each a status circle, a line of what it found and one quiet button:
  the tools that are ready (with installs, sign-ins and an API key under Add more), the projects to add
  (every repository under Choose), and who works on a new session. One part opens at a time, takes the
  room the window has and scrolls inside itself; the button at the foot stays in view. The name the boot
  screen showed stays in place while the line under it says what this is, then gives way to the page.
*/
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { FoundRepo, ProviderInfo, Settings, SystemCheck } from "@contracts";
import { castOf } from "@contracts";
import { Segmented } from "@liner/components/segmented/segmented";
import { toast } from "@liner/components/toast/toast";
import { prefersReducedMotion } from "@liner/lib/spring";
import { bridge } from "./bridge";
import { rpc, useEngine } from "./engine";
import { I, ModelMark, type MarkKind } from "./icons";
import { markOf, modelLabel, pairReady, plural, since } from "./model";
import * as os from "./os";
import "./setup.css";

type Start = NonNullable<Settings["start"]>;
type Opened = "tools" | "projects" | null;
type Opens = { opened: Opened; toggle: (o: Exclude<Opened, null>) => void };
type Adds = { count: number; run: () => Promise<void> };

/** Each tool shows its own mark, in the same ink as in the model picker. */
const TOOLS: { id: ProviderInfo["id"]; mark: MarkKind; name: string; beta?: boolean }[] = [
  { id: "claude", mark: "claudecode", name: "Claude Code" },
  { id: "codex", mark: "codex", name: "Codex CLI" },
  { id: "opencode", mark: "opencode", name: "OpenCode" },
  { id: "hermes", mark: "hermes", name: "Hermes" },
  { id: "cursor", mark: "cursor", name: "Cursor", beta: true },
  { id: "grok", mark: "grok", name: "Grok Build", beta: true },
  { id: "antigravity", mark: "antigravity", name: "Antigravity CLI", beta: true },
];
/** The API key that stands in for a tool's own sign-in. */
const KEY_OF: Partial<Record<string, string>> = { claude: "anthropic", codex: "openai" };
/** The keys that work today. The ones still to come are in Settings › Models. */
const KEYS: { id: "anthropic" | "openai"; name: string }[] = [
  { id: "anthropic", name: "Anthropic" },
  { id: "openai", name: "OpenAI" },
];

/** The boot screen hands its name over only once a launch; setup run again from Settings brings it in. */
let booted = false;

export function Setup({ onDone }: { onDone: () => void }) {
  // The intro plays once per mount; `played` keeps the page's delay steady after the intro has gone.
  const [intro, setIntro] = useState(() => !prefersReducedMotion());
  const [played] = useState(intro);
  const [fromBoot] = useState(() => !booted);
  useEffect(() => {
    booted = true;
    if (!intro) return;
    const t = window.setTimeout(() => setIntro(false), 1800);
    return () => window.clearTimeout(t);
  }, [intro]);
  const machine = window.__LINER__?.machine ?? os.here;

  // What the foot button adds, kept here so its words can say it.
  const [adds, setAdds] = useState<Adds>({ count: 0, run: async () => {} });
  const [start, setStart] = useState<Start>("best");
  const [busy, setBusy] = useState(false);
  // One part open at a time, so what's open has the room the window has.
  const [opened, setOpened] = useState<Opened>(null);
  const toggle = (o: Exclude<Opened, null>) => setOpened((was) => (was === o ? null : o));
  const go = async () => {
    setBusy(true);
    try {
      await adds.run();
      await rpc("settings.save", { onboarded: true, start });
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  const note = "Liner Code never sees a sign-in and resells no tokens. Every call is billed to your own account.";

  return (
    <div className="lc-wel" data-intro={played || undefined}>
      <div className="lc-wel-drag" data-drag />
      <aside className="lc-wel-side" style={{ "--i": 0 } as CSSProperties}>
        <div className="lc-wel-name">Liner Code</div>
        <p className="lc-wel-what">Your models, your code. Agents when you want them.</p>
        <span className="lc-wel-grow" />
        <div className="lc-wel-machine">Setting up {machine}</div>
        <p className="lc-wel-note">{note}</p>
      </aside>
      <main className="lc-wel-main" aria-label="Set up Liner Code">
        <header className="lc-wel-head" style={{ "--i": 1 } as CSSProperties}>
          <h1>Ready when you are</h1>
          <p>Liner Code looked around and guessed all three. Change what's wrong, then start.</p>
        </header>
        <div className="lc-wel-rows">
          <SystemRows />
          <Tools opened={opened} toggle={toggle} setOpened={setOpened} />
          <Projects onAdds={setAdds} opened={opened} toggle={toggle} />
          <Work onStart={setStart} />
        </div>
        <p className="lc-wel-note lc-wel-narrow-note">{note}</p>
        <div className="lc-wel-foot" style={{ "--i": 6 } as CSSProperties}>
          <span>Change any of it later in Settings.</span>
          <button type="button" className="lc-btn" data-kind="accent" data-size="lg" disabled={busy} onClick={() => void go()}>
            {busy ? (adds.count ? "Adding…" : "Starting…") : adds.count ? `Start with ${plural(adds.count, "project")}` : "Start"}
          </button>
        </div>
      </main>
      {intro && (
        <div className="lc-wel-intro" data-from-boot={fromBoot || undefined} aria-hidden>
          <span className="lc-wel-wm">Liner Code</span>
          <span className="lc-wel-tag">Your models, your code. Agents when you want them.</span>
        </div>
      )}
    </div>
  );
}

/** Where a row stands: settled (a green tick), still to do (an empty ring), or needing you (an amber ring). */
function Status({ state }: { state: "ok" | "todo" | "warn" }) {
  return (
    <svg className="lc-wel-st" data-state={state} width="20" height="20" viewBox="0 0 20 20" aria-hidden>
      {state === "ok" ? (
        <>
          <circle cx="10" cy="10" r="9" fill="currentColor" />
          <path d="M6 10.2l2.6 2.6L14 7.4" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <circle cx="10" cy="10" r="8.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      )}
    </svg>
  );
}

/** A row: its status, a title over one grey line, what you can do at the right, and what it opens under it. */
function Row({ state, title, line, end, i, open, fold }: { state: "ok" | "todo" | "warn"; title: ReactNode; line: ReactNode; end: ReactNode; i: number; open?: boolean; fold?: ReactNode }) {
  return (
    <section className="lc-wel-row" data-open={open || undefined} style={{ "--i": i } as CSSProperties}>
      <div className="lc-wel-rh">
        <Status state={state} />
        <div className="lc-wel-rt">
          <div className="lc-wel-title">{title}</div>
          <div className="lc-wel-line">{line}</div>
        </div>
        <div className="lc-wel-end">{end}</div>
      </div>
      {fold}
    </section>
  );
}

/** A quiet text button. */
const Tb = ({ children, onClick, title, disabled, expanded, controls }: { children: ReactNode; onClick: () => void; title?: string; disabled?: boolean; expanded?: boolean; controls?: string }) => (
  <button type="button" className="lc-wel-tb l-focus" title={title} disabled={disabled} aria-expanded={expanded} aria-controls={controls} onClick={onClick}>
    {children}
  </button>
);

/** A pill under an opened row. */
const Pill = ({ children, onClick, title, on }: { children: ReactNode; onClick: () => void; title?: string; on?: boolean }) => (
  <button type="button" className="lc-wel-pill l-focus" title={title} data-on={on || undefined} onClick={onClick}>
    {children}
  </button>
);

/**
  Opens in place under its row: its height grows, and what's inside can't be reached while it's shut. It never grows the
  page past the window: `children` scroll inside it when there isn't room, while `foot` stays under them.
*/
const Fold = ({ open, id, children, foot }: { open: boolean; id: string; children: ReactNode; foot?: ReactNode }) => (
  <div id={id} className="lc-wel-fold" data-open={open || undefined} inert={!open || undefined}>
    <div>
      <div className="lc-wel-fscroll">{children}</div>
      {foot}
    </div>
  </div>
);

/** What this computer lacks for agents to work, a row each, only when it does. */
function SystemRows() {
  const [mac, setMac] = useState<SystemCheck | null>(null);
  const checkMac = () => void rpc("system.check", {}).then(setMac, () => {});
  useEffect(checkMac, []);
  if (!mac) return null;
  return (
    <>
      {mac.install && (
        <Row
          state="warn"
          i={2}
          title={`${os.Here} needs Apple's command line tools`}
          line={`${[!mac.git && "Git", !mac.python && "Python"].filter(Boolean).join(" and ") || "Git and Python"} come with them. Apple's installer takes a few minutes.`}
          end={
            <>
              <Tb onClick={() => bridge.runInTerminal(mac.install!)}>Install</Tb>
              <Tb onClick={checkMac}>Look again</Tb>
            </>
          }
        />
      )}
      {!mac.rg && (
        <Row
          state="warn"
          i={2}
          title={`${os.Here} needs ripgrep`}
          line={mac.rgInstall ? "Agents search code with it; without it, their first search fails." : "Agents search code with it. Install it from github.com/BurntSushi/ripgrep."}
          end={
            <>
              {mac.rgInstall && <Tb onClick={() => bridge.runInTerminal(mac.rgInstall!)}>Install</Tb>}
              <Tb onClick={checkMac}>Look again</Tb>
            </>
          }
        />
      )}
    </>
  );
}

function Tools({ opened, toggle, setOpened }: Opens & { setOpened: (o: Opened) => void }) {
  const providers = useEngine((s) => s.providers);
  const keys = useEngine((s) => s.keys);
  const [checking, setChecking] = useState(false);
  const [keyFor, setKeyFor] = useState<"anthropic" | "openai" | null>(null);
  const [value, setValue] = useState("");
  const open = opened === "tools";

  // Each tool's state, the way its line says it: a tool still asking you to sign in (with no key standing in) isn't ready.
  const rows = TOOLS.map((t) => {
    const p = providers.find((x) => x.id === t.id);
    const state = !p ? "looking" : p.available && p.adapter ? (p.signedIn === false && !keys.includes(KEY_OF[t.id] ?? "") ? "signin" : "ready") : p.available ? "soon" : "install";
    return { ...t, p, state };
  });
  const ready = rows.filter((r) => r.state === "ready");
  const signin = rows.filter((r) => r.state === "signin");
  const install = rows.filter((r) => r.state === "install" && r.p?.install);

  // With no tool ready this row starts open, so Install is in view; it never shuts by itself.
  const loaded = providers.length > 0;
  useEffect(() => {
    if (loaded && !ready.length) setOpened("tools");
  }, [loaded]);

  const save = async () => {
    const key = value.trim();
    if (!key || !keyFor) return;
    try {
      await bridge.keychainSet(`key:${keyFor}`, key);
      await rpc("keys.set", { provider: keyFor, key });
      if (keyFor === "anthropic") await rpc("settings.save", { claudeBilling: "key" });
      toast.success(`${KEYS.find((k) => k.id === keyFor)?.name} key saved`, { description: `Kept in ${os.keyStore("this Mac's keychain")}.` });
      setKeyFor(null);
      setValue("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const look = () => {
    setChecking(true);
    void rpc("providers.refresh", {}).finally(() => setChecking(false));
  };
  const needs = signin.length ? <span className="lc-wel-grey"> · {signin.length} {signin.length === 1 ? "needs" : "need"} you to sign in</span> : null;

  return (
    <Row
      state={ready.length ? "ok" : "todo"}
      i={3}
      open={open}
      title={
        <>
          {ready.length ? `${plural(ready.length, "tool")} ${ready.length === 1 ? "is" : "are"} ready` : "No coding tool yet"}
          {needs}
        </>
      }
      line={
        ready.length ? (
          <>
            <span className="lc-wel-marks" aria-hidden>
              {ready.map((r) => (
                <ModelMark key={r.id} kind={r.mark} size={16} />
              ))}
            </span>
            <span className="lc-wel-cut">{ready.map((r) => r.name.replace(/ CLI$/, "")).join(", ")}</span>
          </>
        ) : (
          <span className="lc-wel-cut">Install one, or add an API key</span>
        )
      }
      end={
        <Tb expanded={open} controls="lc-wel-tools" onClick={() => toggle("tools")}>
          {open ? "Done" : "Add more"}
        </Tb>
      }
      fold={
        <Fold open={open} id="lc-wel-tools">
          <div className="lc-wel-pills">
            {install.map((r) => (
              <Pill key={r.id} title={r.p!.install} onClick={() => bridge.runInTerminal(r.p!.install!)}>
                <ModelMark kind={r.mark} size={14} />
                Install {r.name}
              </Pill>
            ))}
            {signin.map((r) => (
              <Pill key={r.id} title={`${r.p!.login}, in Terminal`} onClick={() => bridge.runInTerminal(r.p!.login)}>
                <ModelMark kind={r.mark} size={14} />
                Sign in to {r.name}
              </Pill>
            ))}
            <Pill on={Boolean(keyFor)} onClick={() => (setKeyFor((k) => (k ? null : "anthropic")), setValue(""))}>
              Add an API key
            </Pill>
            <Tb disabled={checking} onClick={look}>
              {checking ? "Looking" : "Look again"}
            </Tb>
          </div>
          {keyFor && (
            <div className="lc-wel-key">
              {KEYS.map((k) => (
                <Pill key={k.id} on={keyFor === k.id} onClick={() => setKeyFor(k.id)}>
                  {keys.includes(k.id) && <I.check size={12} />}
                  {k.name}
                </Pill>
              ))}
              <span className="lc-wel-keyf">
                <I.lock size={12} />
                <input autoFocus type="password" placeholder={keyFor === "anthropic" ? "sk-ant-…" : "sk-…"} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => (e.key === "Enter" ? void save() : e.key === "Escape" && (setKeyFor(null), setValue("")))} aria-label={`${KEYS.find((k) => k.id === keyFor)?.name} key`} />
              </span>
              <button type="button" className="lc-btn" data-kind="primary" data-size="sm" disabled={!value.trim()} onClick={() => void save()}>
                Save
              </button>
            </div>
          )}
        </Fold>
      }
    />
  );
}

function Projects({ onAdds, opened, toggle }: { onAdds: (a: Adds) => void } & Opens) {
  const [found, setFound] = useState<FoundRepo[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [first, setFirst] = useState<string[]>([]);
  // The sample project is the Demo's, so it's offered only while the Demo is shown.
  const showDemo = useEngine((s) => s.settings.showDemo === true);
  const [sample, setSample] = useState(showDemo);
  const open = opened === "projects";
  const [clone, setClone] = useState("");
  const [cloning, setCloning] = useState(false);

  useEffect(() => {
    // A scan that fails says nothing turned up, rather than looking for ever.
    void rpc("projects.scan", {})
      .then((r) => {
        setFound(r);
        const newest = r.filter((x) => !x.added).slice(0, 3).map((x) => x.path);
        setFirst(newest);
        setPicked(new Set(newest));
      })
      .catch(() => setFound([]));
  }, []);
  const roots = useMemo(() => [...new Set((found ?? []).map((f) => os.tilde(f.path.replace(/[\\/][^\\/]+$/, ""))))].slice(0, 2), [found]);
  const count = picked.size + (showDemo && sample ? 1 : 0);

  // What the foot button adds: each pick, marked added as it goes, so a second press after a failure doesn't add it twice.
  useEffect(() => {
    onAdds({
      count,
      run: async () => {
        for (const path of [...picked]) {
          await rpc("project.add", { path });
          setPicked((p) => new Set([...p].filter((x) => x !== path)));
          setFound((f) => (f ?? []).map((x) => (x.path === path ? { ...x, added: true } : x)));
        }
        if (showDemo && sample) {
          await rpc("project.add", { path: "@sample" });
          setSample(false);
        }
      },
    });
  }, [count, picked, sample, showDemo]);

  const addFolder = async () => {
    const path = await bridge.pickFolder();
    if (!path) return;
    try {
      const p = await rpc("project.add", { path });
      setFound((f) => [{ path: p.path, name: p.name, branch: p.branch, lastCommitAt: p.lastCommitAt, added: true }, ...(f ?? []).filter((x) => x.path !== p.path)]);
      setPicked((s) => new Set([...s].filter((x) => x !== p.path)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const doClone = async () => {
    if (!clone.trim()) return;
    setCloning(true);
    try {
      const p = await rpc("project.clone", { url: clone.trim() });
      setFound((f) => [{ path: p.path, name: p.name, branch: p.branch, lastCommitAt: p.lastCommitAt, added: true }, ...(f ?? []).filter((x) => x.path !== p.path)]);
      setClone("");
      toast.success(`Cloned ${p.name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setCloning(false);
    }
  };
  const pick = (path: string, yes: boolean) =>
    setPicked((p) => {
      const n = new Set(p);
      if (yes) n.add(path);
      else n.delete(path);
      return n;
    });

  const names = [...(showDemo && sample ? ["Sample project"] : []), ...(found ?? []).filter((f) => picked.has(f.path)).map((f) => f.name)];
  // "the newest of 13" only while the picks are still the newest; once you've chosen, just where they were found.
  const newest = picked.size === first.length && first.every((p) => picked.has(p));
  const where = found?.length ? ` · ${newest ? "the newest of" : "of"} ${found.length} found${roots.length ? ` in ${roots.join(", ")}` : ""}` : "";
  const title = found === null ? "Projects to add" : count ? `${plural(count, "project")} to add` : "No projects yet";
  const line =
    found === null ? (
      <span className="l-shimmer">Looking for Git repositories on {os.here}</span>
    ) : count ? (
      <span className="lc-wel-cut">
        {names.join(", ")}
        {where}
      </span>
    ) : (
      <span className="lc-wel-cut">{found.length || showDemo ? "Choose some, or start without one" : "No Git repositories in the usual places. Add a folder, or clone one."}</span>
    );

  return (
    <Row
      state={count ? "ok" : "todo"}
      i={4}
      open={open}
      title={title}
      line={line}
      end={
        <Tb expanded={open} controls="lc-wel-projects" disabled={found === null} onClick={() => toggle("projects")}>
          {open ? "Done" : "Choose"}
        </Tb>
      }
      fold={
        <Fold
          open={open}
          id="lc-wel-projects"
          foot={
            <div className="lc-wel-extras">
              <Tb onClick={() => void addFolder()}>
                <I.folder size={14} />
                Add a folder…
              </Tb>
              <span className="lc-wel-clone">
                <input className="l-focus" placeholder="Clone owner/repo or a URL" aria-label="Clone from GitHub: owner/repo or a URL" value={clone} onChange={(e) => setClone(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void doClone()} />
                <Tb disabled={cloning || !clone.trim()} onClick={() => void doClone()}>
                  {cloning ? "Cloning" : "Clone"}
                </Tb>
              </span>
            </div>
          }
        >
          {showDemo && (
            <label className="lc-wel-repo">
              <input type="checkbox" checked={sample} onChange={(e) => setSample(e.target.checked)} />
              <b>Sample project</b>
              <small>Tide tables, with the Demo agent</small>
              <span className="lc-wel-grey lc-wel-mono">main</span>
            </label>
          )}
          {(found ?? []).map((f) => (
            <label key={f.path} className="lc-wel-repo" data-added={f.added || undefined}>
              <input type="checkbox" checked={f.added || picked.has(f.path)} disabled={f.added} onChange={(e) => pick(f.path, e.target.checked)} />
              <b>{f.name}</b>
              <small className="lc-wel-mono">{os.tilde(f.path)}</small>
              <span className="lc-wel-grey">
                {f.added ? (
                  "Added"
                ) : (
                  <>
                    <span className="lc-wel-mono">{f.branch ?? "—"}</span>
                    {f.lastCommitAt ? ` · ${since(f.lastCommitAt)}` : ""}
                  </>
                )}
              </span>
            </label>
          ))}
        </Fold>
      }
    />
  );
}

function Work({ onStart }: { onStart: (s: Start) => void }) {
  const providers = useEngine((s) => s.providers);
  const settings = useEngine((s) => s.settings);
  // Who'd work, from the tools found: the lead and its sidekick, your own picks first.
  const pair = useMemo(() => castOf(providers, { picks: settings.picks }), [providers, settings.picks]);
  const two = pairReady(pair);
  // Starts on what you have, so running the setup again doesn't change it; unset, a pair when there can be one.
  const [pick, setPick] = useState<Start>(() => settings.start ?? (two ? "pair" : "best"));
  const shown: Start = pick === "pair" && !two ? "best" : pick;
  useEffect(() => onStart(shown), [shown]);
  const name = (ref: string) => modelLabel(ref, providers);
  // A model by its mark and name, inside the line.
  const model = (ref: string) => (
    <>
      <span className="lc-wel-im">
        <ModelMark kind={markOf(ref)} size={14} />
      </span>
      {name(ref)}
    </>
  );
  // Each way's line, drawn with its models' marks; `plain` is the same words for the tooltip when the line is cut short.
  const ways: Record<Start, { name: string; line: ReactNode; plain: string }> = {
    pair: two && pair ? { name: "Fusion", line: <>{model(pair.lead)} leads, {model(pair.sidekick)} helps</>, plain: `${name(pair.lead)} leads, ${name(pair.sidekick)} does the legwork it hands over` } : { name: "Fusion", line: "Needs two different models ready", plain: "Needs two different models ready" },
    best: pair ? { name: "Best", line: <>{model(pair.lead)} alone, on everything</>, plain: `${name(pair.lead)} alone, on everything` } : { name: "Best", line: "The best model you connect, on everything", plain: "The best model you connect, on everything" },
    fast: two && pair ? { name: "Fast", line: <>{model(pair.sidekick)} alone, for small, clear asks</>, plain: `${name(pair.sidekick)} alone, for small, clear asks` } : pair ? { name: "Fast", line: <>{model(pair.lead)} alone too, with one model ready</>, plain: `${name(pair.lead)} alone too, with one model ready` } : { name: "Fast", line: "A quicker model, for small, clear asks", plain: "A quicker model, for small, clear asks" },
  };
  const w = ways[shown];
  return (
    <Row
      state="ok"
      i={5}
      title={<span key={shown}>{w.name}</span>}
      line={
        <span className="lc-wel-cut" key={shown} title={w.plain}>
          {w.line}
        </span>
      }
      end={
        <Segmented
          size="sm"
          value={shown}
          onValueChange={(v) => setPick(v)}
          options={[
            { value: "pair", label: "Fusion", disabled: !two },
            { value: "best", label: "Best" },
            { value: "fast", label: "Fast", disabled: !two },
          ]}
          aria-label="Who works on a new session"
        />
      }
    />
  );
}
