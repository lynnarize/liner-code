/*
  Liner Security: Start a scan (boards C and C2). The project is the page's title and its menu. Two choices, each as boxes
  side by side, with their cost at the foot: how far (the free checks only, what this branch changed, the whole project)
  and who reads it (your own tool, with the app's own model picker in its tile; or a Specialist scan, offered only for a
  security model a CLI you're signed in to lists, or an API endpoint you added). With none found (C2) that box can't be
  picked: a tile says so, with Look again, and the endpoint tile stays as the way in. Then the rest: a second look by
  another maker's model (a switch and its model), the reader's effort (its tool's own levels), the threat model (Read or
  edit), Stops after (or no limit), and Look at first. When a CLI that could list a security model is signed out, the
  Specialist tile says so and offers that tool's own Sign in. Start
  the scan opens the scan's session; the free checks alone run here and land on Findings.

  Everything it offers comes from the engine (security.scan.options): the cost lines, the models found, the defaults.
  With ?ls-mock (or ?ls-mock=c2) in the dev URL it shows the mockup's words over them (scan-mock.ts).
*/
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import type { ScanDepth, ScanOptions, ScanReader, SpecialistSource } from "@contracts";
import { reviewerOf, sealable, splitModel } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { bridge, isNative } from "../bridge";
import { rpc, useEngine } from "../engine";
import { I, ModelMark, Spinner } from "../icons";
import { EffortRows, ModelPicker, ModelPop } from "../Models";
import { agentOf, effortName, effortsFor, markOf, modelLabel, plural, toolMarkOf } from "../model";
import { Pop, Row } from "../ui";
import { OnOff, PageTop, PickTile, Tag } from "./parts";
import { mockChoices, mockMode } from "./scan-mock";
import { addSecurityFolder, goSecurity, getSecurityScope, useSecurity, useSecurityProjects } from "./store";
import "./scan.css";

const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));
/** Stops after: the choices, in minutes; 0 is no limit. */
const STOPS = [5, 10, 15, 30, 60];
/** Effort levels a scan can't run: Ultracode brings workflows, which a scan denies (claude.ts SCAN_DENIED). */
const SCAN_LEAVES = ["ultracode"];
/** "12 Nov". */
const dayOf = (at: number) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export function StartScan({ sidebar, onSidebar, projectId }: { sidebar: boolean; onSidebar: () => void; /** The project it starts in (Projects' Scan); the scope's, else the first, when unset. */ projectId?: string }) {
  // Never the Demo's Sample project (store.ts useSecurityProjects): not offered, and not scanned.
  const { list: projects, hidden } = useSecurityProjects();
  const providers = useEngine((s) => s.providers);
  const agents = useEngine((s) => s.agents);
  const settings = useEngine((s) => s.settings);
  const [picked, setPicked] = useState<string | undefined>(projectId);
  useEffect(() => setPicked(projectId), [projectId]);
  const project = projects.find((p) => p.id === (picked ?? getSecurityScope().projectId)) ?? projects[0];
  // Dev only, and written so a build drops scan-mock.ts: each use of it sits behind import.meta.env.DEV itself, which a build makes false.
  const mock = import.meta.env.DEV ? mockMode() : null;
  const asked = useSecurity("security.scan.options", { projectId: project?.id ?? "" }, ["model", "checks", "scans"]);
  const choices = asked.data && project && asked.data.projectId === project.id ? (import.meta.env.DEV && (mock === "c" || mock === "c2") ? mockChoices(asked.data, mock) : asked.data) : null;

  const [depth, setDepth] = useState<ScanDepth>("branch");
  const [who, setWho] = useState<"own" | "specialist">("own");
  const [agent, setAgent] = useState<string>("");
  const [source, setSource] = useState<string | undefined>();
  const [lookOn, setLookOn] = useState(true);
  const [lookBy, setLookBy] = useState<string | undefined>();
  const [stops, setStops] = useState(10);
  // The reader's effort: "" is its tool's own default.
  const [effort, setEffort] = useState("");
  const [first, setFirst] = useState("");
  const [looking, setLooking] = useState(false);
  const [lookedAt, setLookedAt] = useState<number | null>(null);
  // Sign in was pressed: the tool's own login runs in Terminal, and Start a scan looks again when you come back to the window.
  const [signingIn, setSigningIn] = useState(false);
  const again = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    if (!signingIn) return;
    // Coming back from Terminal: look again, as often as you come back, till the tool says it's signed in.
    const back = () => void again.current();
    window.addEventListener("focus", back);
    return () => window.removeEventListener("focus", back);
  }, [signingIn]);
  // Signed in now (nothing signed out is left): Sign in has done its part.
  const outCount = choices?.signedOut?.length ?? 0;
  useEffect(() => {
    if (!outCount) setSigningIn(false);
  }, [outCount]);
  const [starting, setStarting] = useState(false);
  // Set as start() begins and cleared when it ends, so a second press (Enter held, or pressed again in Look at first) can't
  // slip past before React draws the button as Starting.
  const going = useRef(false);
  // What the engine offers as the start, once per project.
  const [readFor, setReadFor] = useState<string | null>(null);
  useEffect(() => {
    if (!choices || readFor === choices.projectId) return;
    setReadFor(choices.projectId);
    const d = choices.defaults;
    setDepth(choices.branch || d.depth !== "branch" ? d.depth : "project");
    if (d.reader.kind === "own") setAgent(d.reader.agent);
    setWho("own");
    setSource(undefined);
    setStops(d.stopsAfter ?? 0);
    setFirst(d.lookFirst ?? "");
    if (d.secondLook) setLookBy(d.secondLook);
  }, [choices, readFor]);

  const specialist = choices?.specialist ?? [];
  const src = specialist.find((s) => s.id === source) ?? specialist[0];
  // A second look by another maker than whoever reads it: the Reviewer's choice, unless you pick one.
  const readerRef = who === "specialist" && src ? src.ref.replace(/^@/, "") : agent.startsWith("@") ? agent.slice(1) : agent ? agentOf(agent, agents, providers).model : "";
  const autoLook = useMemo(() => reviewerOf(readerRef ? [readerRef] : [], providers.filter((p) => p.id !== "demo" || settings.showDemo)), [readerRef, providers, settings.showDemo]);
  const look = lookBy ?? autoLook ?? undefined;
  // The reader's levels as its tool lists them; a level picked for another model isn't sent to this one.
  const levels = readerRef ? effortsFor(readerRef, providers).list.filter((e) => !SCAN_LEAVES.includes(e.id)) : [];
  const level = effort && levels.some((e) => e.id === effort) ? effort : "";

  const addFolder = async () => {
    const id = await addSecurityFolder(hidden);
    if (id) setPicked(id);
  };

  if (!project)
    return (
      <div className="ls-page">
        <PageTop title="Start a scan" sidebar={sidebar} onSidebar={onSidebar} />
        <div className="ls-scroll">
          <div className="ls-none">
            <span className="ls-disc">
              <I.folder size={16} />
            </span>
            <b>No project yet</b>
            <span>Add a folder you work on, then scan it.</span>
            <button type="button" className="lc-btn lsc-add" data-kind="ink" data-size="sm" onClick={() => void addFolder()}>
              Add a folder
            </button>
          </div>
        </div>
      </div>
    );

  // A model ("@claude:claude-opus-5-5") or one of your agents ("demo", a profile): its tool and model either way.
  const ownRef = agent.startsWith("@") ? agent.slice(1) : agent ? agentOf(agent, agents, providers).model : "";
  const ownProvider = ownRef ? splitModel(ownRef).provider : "";
  const ownTool = providers.find((p) => p.id === ownProvider);
  // "Claude Code · Opus 5.5"; the tool alone where the model would only say its name again (the Demo).
  const ownModel = ownRef && !ownRef.endsWith(":default") ? modelLabel(ownRef, providers) : "";
  const ownName = ownTool ? `${ownTool.label}${ownModel && ownModel !== ownTool.label ? ` · ${ownModel}` : ""}` : ownRef ? modelLabel(ownRef, providers) : "Pick a tool";
  const ownNote = !ownTool ? "" : ownTool.id === "demo" ? "scripted, no model or account" : ownTool.signedIn ? "signed in on this Mac" : (ownTool.detail ?? "on this Mac");
  const billed = !ownTool ? "" : ownTool.id === "demo" ? "Scripted: nothing to pay" : ownTool.id.startsWith("claude") ? (settings.claudeBilling === "key" ? "Billed to your API key" : "On your Claude plan") : `On your ${ownTool.label} account`;
  // C's foot: which of the tools looked in list none, as "Codex lists none."
  const none = (choices?.lookedIn ?? []).filter((n) => !specialist.some((s) => s.via.toLowerCase().includes(n.toLowerCase())));
  // A CLI signed out lists no security model (Claude Code shows Mythos only to an account signed in): C2 says so, not "none",
  // and offers that tool's own sign-in (ProviderInfo.login, as Setup's Sign in does).
  const signedOut = choices?.signedOut ?? [];
  const loginOf = signedOut.map((name) => providers.find((p) => p.label === name && p.signedIn === false && p.login)).find(Boolean);
  const tm = choices?.threatModel;

  const lookAgain = async () => {
    setLooking(true);
    try {
      await rpc("security.specialist.look", {});
      asked.reload();
      setLookedAt(Date.now());
    } catch (e) {
      fail(e);
    } finally {
      setLooking(false);
    }
  };
  again.current = lookAgain;
  const signIn = () => {
    if (!loginOf) return;
    bridge.runInTerminal(loginOf.login);
    setSigningIn(true);
    if (!isNative()) toast(`Copied ${loginOf.login}`, { description: "Run it in your terminal, then press Look again." });
  };
  const use = (s: SpecialistSource) => (setWho("specialist"), setSource(s.id));
  const addEndpoint = () => window.dispatchEvent(new CustomEvent("lc:open-settings", { detail: "models" }));
  const openModel = () => {
    if (!tm) return;
    const path = `${project.path.replace(/\/$/, "")}/${tm.file}`;
    if (tm.exists) bridge.openIn(path, "editor");
    else toast("No threat model yet", { description: `The scan proposes ${tm.file} and asks you before it writes it.` });
  };

  // Whether Start the scan can be pressed: Enter in Look at first asks the same, so it never starts what the button wouldn't.
  const ready = Boolean(choices) && !starting && !(depth !== "checks" && who === "own" && !agent);
  const start = async () => {
    if (!choices || !ready || going.current) return;
    going.current = true;
    const reader: ScanReader =
      who === "specialist" && src
        ? // Your own tool reads for the security model only when it too can run sealed (Claude Code); else the model reads alone.
          { kind: "specialist", source: src.id, model: src.ref, ...(level ? { effort: level } : {}), ...(agent.startsWith("@") && agent !== src.ref && sealable(splitModel(agent.slice(1)).provider) ? { sidekick: agent.slice(1) } : {}) }
        : { kind: "own", agent, ...(level ? { effort: level } : {}) };
    const o: ScanOptions = {
      projectId: project.id,
      depth,
      reader,
      ...(depth !== "checks" && lookOn && look ? { secondLook: look } : {}),
      threatModel: { file: tm?.file ?? "SECURITY.md", write: true },
      ...(stops ? { stopsAfter: stops } : {}),
      ...(first.trim() ? { lookFirst: first.trim() } : {}),
      ...(choices.branch?.base ? { base: choices.branch.base } : {}),
    };
    setStarting(true);
    try {
      const r = await rpc("security.scan.start", o);
      if (r.thread) goSecurity({ kind: "scan", threadId: r.thread.id });
      else goSecurity({ kind: "findings", state: "open" });
    } catch (e) {
      // The dev mock: with no scan runner in the engine yet, a plain tagged session to draw boards D to F in.
      if (import.meta.env.DEV && mock && depth !== "checks") {
        try {
          const t = await rpc("thread.create", { projectId: project.id, agent: agent || "demo", access: "read", worktree: false, title: `${project.name}, ${depth === "branch" ? "this branch" : "in full"}`, security: { kind: "scan", scan: "mock" } });
          return goSecurity({ kind: "scan", threadId: t.id });
        } catch (e2) {
          return fail(e2);
        }
      }
      fail(e);
    } finally {
      going.current = false;
      setStarting(false);
    }
  };

  const projectMenu = (
    <Pop
      label="The project to scan"
      menu
      width={280}
      triggerClass="lsc-h1 l-focus"
      trigger={
        <>
          {project.name}
          <I.chevD size={14} />
        </>
      }
    >
      {(close) => projects.map((p) => <Row key={p.id} title={p.name} note={p.path} on={p.id === project.id} onPick={() => (close(), setPicked(p.id))} />)}
    </Pop>
  );
  const ownPick = (
    <Pop
      label={`The tool that reads it: ${ownName}. Change it`}
      width={360}
      triggerClass="ls-pick lsc-pick-b l-focus"
      trigger={
        <>
          <span className="ls-mk">{ownTool ? <ModelMark kind={toolMarkOf(ownTool.id)} size={16} /> : <I.cube size={16} />}</span>
          <span className="ls-tl2">
            <b>{ownName}</b>
            {ownNote && <small>{ownNote}</small>}
          </span>
          <I.chevD size={12} />
        </>
      }
    >
      {(close) => <ModelPicker value={ownRef} autoFocus onPick={(ref) => (setAgent(`@${ref}`), setWho("own"), close())} />}
    </Pop>
  );

  return (
    <div className="ls-page">
      <PageTop title="Start a scan" sidebar={sidebar} onSidebar={onSidebar} />
      <div className="ls-scroll">
        <div className="lsc-start">
          <h1 className="lsc-h1-wrap">{projectMenu}</h1>
          <p className="lsc-sub">A scan only reads. The agent runs at Read only and changes nothing; fixing is a separate step you start per finding.</p>

          <div className="lsc-blk">
            <div className="ls-blkh">How far</div>
            <div className="lsc-boxes" role="radiogroup" aria-label="How far" onKeyDown={arrows}>
              {(choices?.depths ?? []).map((d) => (
                <Choice
                  key={d.depth}
                  on={depth === d.depth}
                  onPick={() => setDepth(d.depth)}
                  off={d.depth === "branch" && !choices?.branch && !mock}
                  title={d.label}
                  note={d.note}
                  foot={
                    <>
                      {d.cost}
                      {d.costNote && <i>{d.costNote}</i>}
                    </>
                  }
                />
              ))}
              {!choices && <div className="lsc-wait">{asked.error ?? <span className="l-shimmer">Reading the project</span>}</div>}
            </div>
          </div>

          {/* The free checks run on this Mac with no agent: who reads it, and the rows only a reader has, don't apply. */}
          {depth !== "checks" && (
          <div className="lsc-blk">
            <div className="ls-blkh">Who reads it</div>
            <div className="lsc-boxes" role="radiogroup" aria-label="Who reads it" onKeyDown={arrows}>
              <Choice on={who === "own"} onPick={() => setWho("own")} title="Your own tool" note="The CLI you already use, at Read only. Good for everyday scans of a branch." foot={billed}>
                {ownPick}
              </Choice>
              <Choice
                wide
                on={who === "specialist"}
                off={!specialist.length}
                onPick={() => setWho("specialist")}
                title="Specialist scan"
                tags={
                  <>
                    <Tag tone="pro">Professional</Tag>
                    <Tag>Recommended</Tag>
                  </>
                }
                note="A model made for security work leads, when one of your CLIs lists one. Sealed: no skills or add-ons load, and it stays Read only."
                foot={
                  specialist.length ? (
                    <>
                      On your plan<i>or billed by an API</i>
                      <i className="lsc-r">Shows only what your CLIs list.{none.length ? ` ${none.join(" and ")} ${none.length === 1 ? "lists" : "list"} none.` : ""}</i>
                    </>
                  ) : (
                    <>
                      Nothing to run it with yet
                      <i className="lsc-r">{lookedAt ? "Looked just now. " : ""}{signedOut.length ? (signingIn ? "Finish in Terminal; it looks again when you're back." : `Sign in runs ${loginOf?.login ?? "its sign-in"} in Terminal.`) : "A model shows here once a CLI lists it."}</i>
                    </>
                  )
                }
              >
                <span className="lsc-picks" data-first={specialist.length ? undefined : ""}>
                  {specialist.length ? (
                    specialist.map((s) => (
                      <PickTile
                        key={s.id}
                        mark={<ModelMark kind={markOf(s.ref)} size={16} />}
                        title={s.label}
                        note={s.via}
                        action={
                          <button type="button" className="lsc-pb l-focus" aria-pressed={who === "specialist" && src?.id === s.id} onClick={(e) => (e.stopPropagation(), use(s))}>
                            {who === "specialist" && src?.id === s.id ? "In use" : "Use"}
                          </button>
                        }
                      />
                    ))
                  ) : (
                    <PickTile
                      nil
                      mark={<I.search size={16} />}
                      title={signedOut.length ? `${signedOut.join(" and ")} ${signedOut.length === 1 ? "isn't" : "aren't"} signed in` : "No security model"}
                      note={signedOut.length ? `a security model like Mythos is listed only once you sign in` : `in ${(choices?.lookedIn ?? ["Claude Code", "Codex"]).join(" or ")}`}
                      action={
                        loginOf && !signingIn ? (
                          <button type="button" className="lsc-pb l-focus" title={`${loginOf.login}, in Terminal`} onClick={(e) => (e.stopPropagation(), signIn())}>
                            Sign in
                          </button>
                        ) : (
                          <button type="button" className="lsc-pb l-focus" disabled={looking} aria-busy={looking || undefined} onClick={(e) => (e.stopPropagation(), void lookAgain())}>
                            {looking ? (
                              <>
                                <Spinner size={12} />
                                Looking
                              </>
                            ) : (
                              "Look again"
                            )}
                          </button>
                        )
                      }
                    />
                  )}
                  <PickTile
                    mark={<I.cube size={16} />}
                    title={specialist.length ? "Another API endpoint" : "An API endpoint"}
                    note="an unrestricted model"
                    action={
                      <button type="button" className="lsc-pb l-focus" title="Settings › Models: add an endpoint, then mark it as a security model" onClick={(e) => (e.stopPropagation(), addEndpoint())}>
                        Add
                      </button>
                    }
                  />
                </span>
              </Choice>
            </div>
          </div>
          )}

          <div className="lsc-blk">
            <div className="ls-blkh">And</div>
            {depth !== "checks" && (
            <div className="lsc-kvr">
              <span className="lsc-k">Effort</span>
              {readerRef && levels.length ? (
                <Pop
                  label={`How hard it reads: ${level ? effortName(level, readerRef, providers) : "its own default"}. Change it`}
                  width={290}
                  triggerClass="lsc-cb l-focus"
                  trigger={
                    <>
                      {level ? effortName(level, readerRef, providers) : "Its own default"}
                      <I.chevD size={12} />
                    </>
                  }
                >
                  {(close) => <EffortRows modelRef={readerRef} value={level} leave={SCAN_LEAVES} onPick={(id) => (close(), setEffort(id))} />}
                </Pop>
              ) : (
                <span className="lsc-v">None</span>
              )}
              <span className="lc-grow" />
              <span className="lsc-quiet">{levels.length ? "optional · its tool's own default until you pick" : "this model has no effort levels"}</span>
            </div>
            )}
            {depth !== "checks" && (
            <div className="lsc-kvr">
              <span className="lsc-k">A second look</span>
              {lookOn ? <ModelPop label="Who takes the second look" value={look} onPick={setLookBy} align="start" /> : <span className="lsc-v">Off</span>}
              <span className="lc-grow" />
              <span className="lsc-quiet">{lookOn ? "optional · another maker, so they don't share blind spots" : "optional · findings stay unconfirmed until you ask for one"}</span>
              <OnOff on={lookOn} onChange={setLookOn} label="Take a second look" />
            </div>
            )}
            <div className="lsc-kvr">
              <span className="lsc-k">Threat model</span>
              {tm?.exists ? (
                <>
                  <span className="lsc-mono">{tm.file}</span>
                  <span className="lsc-quiet">{[plural(tm.areas.length, "area"), tm.written && `written ${dayOf(tm.written)}`].filter(Boolean).join(", ")}</span>
                </>
              ) : (
                <span className="lsc-quiet">None yet, the scan will propose one</span>
              )}
              <span className="lc-grow" />
              {tm?.exists && (
                <button type="button" className="lc-btn lsc-end" data-kind="ghost" data-size="sm" onClick={openModel}>
                  Read or edit
                </button>
              )}
            </div>
            {depth !== "checks" && (
            <>
            <div className="lsc-kvr">
              <span className="lsc-k">Stops after</span>
              <Pop
                label={stops ? `Stops after ${stops} minutes. Change it` : "No time limit. Change it"}
                menu
                width={180}
                triggerClass="lsc-cb l-focus"
                trigger={
                  <>
                    {stops ? `${stops} min` : "No limit"}
                    <I.chevD size={12} />
                  </>
                }
              >
                {(close) => [...STOPS, 0].map((m) => <Row key={m} title={m ? `${m} min` : "No limit"} on={m === stops} onPick={() => (close(), setStops(m))} />)}
              </Pop>
              <span className="lc-grow" />
              <span className="lsc-quiet">{stops ? "optional · it says what it did not get to" : "optional · it reads till it's done, or you stop it"}</span>
            </div>
            <label className="lsc-kvr">
              <span className="lsc-k">Look at first</span>
              <input className="lsc-field" value={first} maxLength={400} placeholder="Optional. For example: the new alerts API, or anything that takes a file from a visitor" onChange={(e) => setFirst(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && !e.repeat && (e.preventDefault(), void start())} />
            </label>
            </>
            )}
          </div>

          <div className="lsc-go">
            <button type="button" className="lc-btn" data-kind="ink" disabled={!ready} onClick={() => void start()}>
              {starting ? "Starting" : depth === "checks" ? "Run the free checks" : "Start the scan"}
            </button>
            <span className="lsc-quiet">{depth === "checks" ? "On this Mac, in a few seconds. What they find lands on Findings." : "Findings appear as it works. Code and Design stay free to use."}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Arrow keys move the pick among a group's boxes, as a radio group's do (skipping one that can't be picked). */
function arrows(e: KeyboardEvent<HTMLDivElement>) {
  const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
  if (!step) return;
  const radios = [...e.currentTarget.querySelectorAll<HTMLButtonElement>(".lsc-choice-r:not([aria-disabled])")];
  const at = radios.indexOf(document.activeElement as HTMLButtonElement);
  if (at < 0) return;
  e.preventDefault();
  const next = radios[(at + step + radios.length) % radios.length];
  next.focus();
  next.click();
}

/**
  A choice drawn as a box beside its siblings (How far, Who reads it). The radio is the box's head, a button of its own,
  so what else the box holds (the model picker, Use, Look again, Add) stays a button of its own too, never inside a
  disabled radio. A click anywhere else on the box picks it. `off`: shown, but it can't be picked (board C2).
*/
function Choice({ on, onPick, title, tags, note, foot, off, wide, children }: { on: boolean; onPick: () => void; title: ReactNode; tags?: ReactNode; note?: ReactNode; foot?: ReactNode; off?: boolean; wide?: boolean; children?: ReactNode }) {
  const click = (e: MouseEvent) => {
    if (off || (e.target instanceof Element && e.target.closest("button:not(.lsc-choice-r), a, input, [role='dialog'], [role='menu'], [role='listbox']"))) return;
    onPick();
  };
  return (
    <div className="ls-bx lsc-choice" data-on={on || undefined} data-off={off || undefined} data-wide={wide || undefined} onClick={click}>
      <span className="ls-bxh">
        <button type="button" role="radio" aria-checked={on} aria-disabled={off || undefined} tabIndex={on ? 0 : -1} className="lsc-choice-r l-focus">
          <span className="ls-rad" aria-hidden />
          {title}
        </button>
        {tags}
      </span>
      {note && <small>{note}</small>}
      {children}
      {foot && <span className="ls-bxf">{foot}</span>}
    </div>
  );
}
