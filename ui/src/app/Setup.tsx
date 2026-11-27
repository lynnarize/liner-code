/*
  First launch (board Setup of "line and dot", 2026-11-27): one page on the sheet, with no sidebar, in one left-set
  column. "Welcome to Liner Code." in ink and "Setting up this Mac." in grey, one grey line of what it found, then
  sections with a grey label in a narrow column at their left: Agents (a row per tool with Ready, Sign in or Install
  at its end, and under them a way to add more: installs, an API key, Look again), Projects (the repositories to bring
  in as ticked rows, the newest three first, the rest a press away, a folder or a clone after them) and Who works.
  A ruled foot holds "Start without an agent" while no agent is ready, else the one white button that brings the
  picked projects in and starts. The faint halftone sits in the sheet's top right corner. The name the boot screen
  showed stays in place while the line under it says what this is, then gives way to the page.
*/
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { FoundRepo, ProviderInfo, Settings, SystemCheck } from "@contracts";
import { castOf } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { prefersReducedMotion } from "@liner/lib/spring";
import { bridge } from "./bridge";
import { rpc, useEngine } from "./engine";
import { I, ModelMark, StateMark, type MarkKind } from "./icons";
import { PaneCheck } from "./Pane";
import { Badge, LookAgain } from "./ui";
import { markOf, modelLabel, pairReady, plural, since } from "./model";
import { startModel, StartPick } from "./Models";
import * as os from "./os";
import "./setup.css";

type Start = NonNullable<Settings["start"]>;
type Opened = "tools" | "projects" | null;
type Opens = { opened: Opened; toggle: (o: Exclude<Opened, null>) => void };
type Adds = { count: number; run: () => Promise<void>; looked?: boolean };

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
/** A tool's state, the way its line says it: a tool still asking you to sign in (with no key standing in) isn't ready. */
const toolState = (p: ProviderInfo | undefined, id: string, keys: string[]) => (!p ? "looking" : p.available && p.adapter ? (p.signedIn === false && !keys.includes(KEY_OF[id] ?? "") ? "signin" : "ready") : p.available ? "soon" : "install");
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
  // What the line under the title says it found: only what it did find (a tool ready, projects to add or already here).
  const providers = useEngine((s) => s.providers);
  const keys = useEngine((s) => s.keys);
  const tool = TOOLS.some((t) => toolState(providers.find((x) => x.id === t.id), t.id, keys) === "ready");
  const have = useEngine((s) => s.projects.some((p) => p.kind !== "design"));
  const project = adds.count > 0 || have;
  const looked = providers.length > 0 && adds.looked === true;
  const found = !looked
    ? "Liner Code is looking around for your agents and projects."
    : tool && project
      ? "Liner Code looked around and guessed all three. Change what's wrong, then start."
      : tool
        ? "Liner Code found your agents, and no project yet. Add one, or start without."
        : project
          ? "Liner Code found your projects, and no agent yet. Install one or add a key, then start."
          : "Pick an agent and a project to start.";

  const starting = busy ? (adds.count ? "Adding…" : "Starting…") : undefined;
  return (
    <div className="lc-wel" data-intro={played || undefined}>
      <div className="lc-wel-drag" data-drag />
      <div className="lc-wel-sheet">
        <i className="lc-ht lc-ht-corner lc-ht-big lc-ht-faint lc-wel-ht" aria-hidden />
        <main className="lc-wel-main" aria-label="Set up Liner Code">
          <header className="lc-wel-head" style={{ "--i": 1 } as CSSProperties}>
            <h1>
              Welcome to Liner Code. <span>Setting up {machine}.</span>
            </h1>
            <p>
              {found} {note}
            </p>
          </header>
          <Part label="Agents" i={2}>
            <SystemRows />
            <Tools opened={opened} toggle={toggle} setOpened={setOpened} />
          </Part>
          <Part label="Projects" i={3}>
            <Projects onAdds={setAdds} opened={opened} toggle={toggle} />
          </Part>
          <Part label="Who works" i={4}>
            <Work onStart={setStart} />
          </Part>
          <div className="lc-wel-foot" style={{ "--i": 5 } as CSSProperties}>
            {/* With no agent ready the way on is the outlined one; with one, the white button brings the projects in and starts. */}
            {!tool && (
              <button type="button" className="lc-btn" data-kind="outline" disabled={busy} onClick={() => void go()}>
                {starting ?? "Start without an agent"}
              </button>
            )}
            <span className="lc-grow" />
            <span className="lc-wel-later">You can change all of this in Settings</span>
            {tool && (
              <button type="button" className="lc-btn" data-kind="ink" disabled={busy} onClick={() => void go()}>
                {starting ?? (adds.count ? `Bring in ${plural(adds.count, "project")} and start` : "Start")}
              </button>
            )}
          </div>
        </main>
      </div>
      {intro && (
        <div className="lc-wel-intro" data-from-boot={fromBoot || undefined} aria-hidden>
          <span className="lc-wel-wm">Liner Code</span>
          <span className="lc-wel-tag">Your models, your code. Agents when you want them.</span>
        </div>
      )}
    </div>
  );
}

/** A section of the page: its grey label in the narrow column at the left, its rows at the right. */
function Part({ label, i, children }: { label: string; i: number; children: ReactNode }) {
  return (
    <section className="lc-wel-part" aria-label={label} style={{ "--i": i } as CSSProperties}>
      <h2 className="lc-wel-lab">{label}</h2>
      <div className="lc-wel-rows">{children}</div>
    </section>
  );
}

/**
  A row: a tile with a mark (or a state mark for something this computer needs), a title over one grey line, what you
  can do at its end, and what it opens under it.
*/
function Row({ lead, title, line, end, open, fold, off }: { lead: ReactNode; title: ReactNode; line?: ReactNode; end?: ReactNode; open?: boolean; fold?: ReactNode; off?: boolean }) {
  return (
    <div className="lc-wel-row" data-open={open || undefined} data-off={off || undefined}>
      <div className="lc-wel-rh">
        <span className="lc-wel-tile">{lead}</span>
        <div className="lc-wel-rt">
          <div className="lc-wel-title">{title}</div>
          {line && <div className="lc-wel-line">{line}</div>}
        </div>
        {end && <div className="lc-wel-end">{end}</div>}
      </div>
      {fold}
    </div>
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
          lead={<StateMark state="needs" size={14} />}
          title={`${os.Here} needs Apple's command line tools`}
          line={`${[!mac.git && "Git", !mac.python && "Python"].filter(Boolean).join(" and ") || "Git and Python"} come with them. Apple's installer takes a few minutes.`}
          end={
            <>
              <Tb onClick={() => bridge.runInTerminal(mac.install!)}>Install</Tb>
              <LookAgain onLook={checkMac} />
            </>
          }
        />
      )}
      {!mac.rg && (
        <Row
          lead={<StateMark state="needs" size={14} />}
          title={`${os.Here} needs ripgrep`}
          line={mac.rgInstall ? "Agents search code with it; without it, their first search fails." : "Agents search code with it. Install it from github.com/BurntSushi/ripgrep."}
          end={
            <>
              {mac.rgInstall && <Tb onClick={() => bridge.runInTerminal(mac.rgInstall!)}>Install</Tb>}
              <LookAgain onLook={checkMac} />
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
    return { ...t, p, state: toolState(p, t.id, keys) };
  });
  const ready = rows.filter((r) => r.state === "ready");
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
  // What a tool's row says under its name, and what it offers at its end: Ready, Sign in, Install, or why there is nothing to press.
  const lineOf = (r: (typeof rows)[number]) =>
    r.state === "looking" ? <span className="l-shimmer">Looking for it</span> : r.state === "ready" ? [r.p?.version, r.p?.detail].filter(Boolean).join(" · ") || "Installed" : r.state === "signin" ? [r.p?.version, "not signed in"].filter(Boolean).join(" · ") : r.state === "soon" ? "Installed · Liner Code can't drive it yet" : `Not on ${os.here}`;
  const endOf = (r: (typeof rows)[number]) =>
    r.state === "ready" ? (
      <Badge tone="ok">Ready</Badge>
    ) : r.state === "signin" ? (
      <Tb title={`${r.p!.login}, in Terminal`} onClick={() => bridge.runInTerminal(r.p!.login)}>
        Sign in
      </Tb>
    ) : r.state === "install" && r.p?.install ? (
      <Tb title={r.p.install} onClick={() => bridge.runInTerminal(r.p!.install!)}>
        Install
      </Tb>
    ) : undefined;

  return (
    <>
      {rows.map((r) => (
        <Row
          key={r.id}
          off={r.state === "install" || r.state === "soon"}
          lead={<ModelMark kind={r.mark} size={14} />}
          title={
            <>
              {r.name.replace(/ CLI$/, "")}
              {r.beta && <Badge>Beta</Badge>}
            </>
          }
          line={<span className="lc-wel-cut">{lineOf(r)}</span>}
          end={endOf(r)}
        />
      ))}
      <Row
        open={open}
        lead={<I.plus size={14} />}
        title={
          <button type="button" className="lc-wel-more l-focus" aria-expanded={open} aria-controls="lc-wel-tools" onClick={() => toggle("tools")}>
            Add more agents, or an API key
            <I.chevD size={12} className="lc-wel-chev" />
          </button>
        }
        line={ready.length || install.length ? undefined : "Install one, or add an API key"}
        fold={
          <Fold open={open} id="lc-wel-tools">
          <div className="lc-wel-pills">
            <Pill on={Boolean(keyFor)} onClick={() => (setKeyFor((k) => (k ? null : "anthropic")), setValue(""))}>
              Add an API key
            </Pill>
            <LookAgain looking={checking} onLook={look} />
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
              <button type="button" className="lc-btn" data-size="sm" disabled={!value.trim()} onClick={() => void save()}>
                Save
              </button>
            </div>
          )}
          </Fold>
        }
      />
    </>
  );
}

function Projects({ onAdds, opened, toggle }: { onAdds: (a: Adds) => void } & Opens) {
  const [found, setFound] = useState<FoundRepo[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [first, setFirst] = useState<string[]>([]);
  // The sample project is the Demo's, so it's offered only while the Demo is shown.
  const showDemo = useEngine((s) => s.settings.showDemo === true);
  // Not when it's in your projects already (Home knows it the same way: the project the Demo works in).
  const hasSample = useEngine((s) => s.projects.some((p) => p.agent === "demo"));
  const offer = showDemo && !hasSample;
  const [sample, setSample] = useState(offer);
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
  const count = picked.size + (offer && sample ? 1 : 0);

  // What the foot button adds: each pick, marked added as it goes, so a second press after a failure doesn't add it twice.
  useEffect(() => {
    onAdds({
      count,
      looked: found !== null,
      run: async () => {
        for (const path of [...picked]) {
          await rpc("project.add", { path });
          setPicked((p) => new Set([...p].filter((x) => x !== path)));
          setFound((f) => (f ?? []).map((x) => (x.path === path ? { ...x, added: true } : x)));
        }
        if (offer && sample) {
          await rpc("project.add", { path: "@sample" });
          setSample(false);
        }
      },
    });
  }, [count, picked, sample, offer, found !== null]);

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

  // The newest three first (the ones ticked for you), and every other one a press away; one you added or ticked stays in view.
  const shown = open ? (found ?? []) : (found ?? []).filter((f) => first.includes(f.path) || picked.has(f.path) || f.added);
  const more = (found?.length ?? 0) - shown.length;
  const where = roots.length ? ` in ${roots.join(", ")}` : "";

  return (
    <>
      {found === null && <p className="lc-wel-say l-shimmer">Looking for Git repositories on {os.here}</p>}
      {found !== null && !found.length && !offer && <p className="lc-wel-say">No Git repositories in the usual places. Add a folder, or clone one.</p>}
      <div id="lc-wel-projects" className="lc-wel-repos">
          {offer && (
            <label className="lc-wel-repo">
              <PaneCheck checked={sample} label="Add the sample project" onChange={setSample} />
              <b>Sample project</b>
              <small>Tide tables, with the Demo agent</small>
              <span className="lc-wel-grey lc-wel-mono">main</span>
            </label>
          )}
          {shown.map((f) => (
            <label key={f.path} className="lc-wel-repo" data-added={f.added || undefined}>
              {/* An added one is ticked for good: the same box, but not a control, so the row can't untick it. */}
              {f.added ? (
                <span className="lc-pane-check" role="checkbox" aria-checked="true" aria-disabled="true" aria-label={`${f.name}, added`}>
                  <I.check size={12} />
                </span>
              ) : (
                <PaneCheck checked={picked.has(f.path)} label={`Add ${f.name}`} onChange={(on) => pick(f.path, on)} />
              )}
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
      </div>
      {(more > 0 || open) && (
        <button type="button" className="lc-wel-more l-focus" aria-expanded={open} aria-controls="lc-wel-projects" onClick={() => toggle("projects")}>
          {open ? "Show the newest only" : `Look at all ${found?.length} found${where}`}
          <I.chevR size={12} />
        </button>
      )}
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
    </>
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
  // Fusion asked for with one model ready is that model; a Best or Fast saved before reads as the model it means.
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
  // The line under the start, drawn with its models' marks; `plain` is the same words for the tooltip when the line is cut short.
  const one = startModel(shown, pair);
  const w: { name: string; line: ReactNode; plain: string } =
    one === "pair" && pair
      ? { name: "Fusion", line: <>{model(pair.lead)} leads, {model(pair.sidekick)} helps</>, plain: `${name(pair.lead)} leads, ${name(pair.sidekick)} does the legwork it hands over` }
      : one
        ? { name: name(one), line: <>{model(one)} alone, on everything</>, plain: `${name(one)} alone, on everything` }
        : { name: "A model", line: "The model you connect, on everything", plain: "The model you connect, on everything" };
  // The pick first, as the board draws it, then what it means in one grey line with its models' marks.
  return (
    <div className="lc-wel-work">
      <StartPick value={shown} onPick={setPick} align="start" />
      <span className="lc-wel-line lc-wel-cut" key={shown} title={`${w.name}: ${w.plain}`}>
        {w.line}
      </span>
    </div>
  );
}
