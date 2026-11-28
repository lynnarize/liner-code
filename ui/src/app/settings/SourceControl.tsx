/*
  Settings › Source control & issues: how branches and merges go, where your code lives (each tool found on this Mac,
  asked again with Look again), the issue trackers, and how commit messages and pull requests are written. The engine
  asks the tools (engine/src/sourcecontrol.ts); only GitHub and Linear fill the Pull requests and Issues lists in this
  build, so the other hosts say so once they're found. A Bitbucket or Linear key goes to the keychain like a model's key,
  and the engine keeps it in memory: what comes back is a name or its last four characters, never the key.
*/
import { useEffect, useState, type ReactNode } from "react";
import type { ScmTool, ScmTokenId, Settings } from "@contracts";
import { hostOn, scmKey, scmSettings, trackerOn } from "@contracts";
import { Select } from "@liner/components/select/select";
import { toast } from "@liner/components/toast/toast";
import { bridge } from "../bridge";
import { rpc, useEngine } from "../engine";
import { I } from "../icons";
import * as os from "../os";
import { ScmIcon, SCM_NAME, type ScmMark } from "../scm-icons";
import { LookAgain, NamedSwitch, Pop, Row as MenuRow, SureButton } from "../ui";
import { HostTile, Mono, Row, RowMore, Section, SubRow, Tag } from "./parts";
import "./source-control.css";

const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));
const save = (patch: Partial<Settings>) => void rpc("settings.save", patch).catch(fail);

/** A hint's `code` spans, as the engine writes them, drawn in mono. */
function Hint({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <>
      {text.split("`").map((part, i) => (i % 2 ? <Mono key={i}>{part}</Mono> : <span key={i}>{part}</span>))}
    </>
  );
}

/** A small menu in a row's end: the choice shown on its button, the others in a menu under it. */
function Choice<T extends string | number>({ label, value, options, onPick, quiet }: { label: string; value: T; options: { value: T; label: string; note?: string }[]; onPick: (v: T) => void; quiet?: boolean }) {
  const shown = options.find((o) => o.value === value) ?? options[0];
  return (
    <Pop label={label} menu align="end" width={240} triggerClass={quiet ? "lc-sc-quiet l-focus" : "lc-btn"} triggerAttrs={quiet ? { "aria-label": label } : { "data-kind": "plain", "data-size": "sm", "aria-label": label }} trigger={<>{shown.label}<I.chevD size={12} /></>}>
      {(close) => (
        <>
          {options.map((o) => (
            <MenuRow key={String(o.value)} title={o.label} note={o.note} keepNote={Boolean(o.note)} on={o.value === value} onPick={() => (close(), onPick(o.value))} />
          ))}
        </>
      )}
    </Pop>
  );
}

const MERGES: { value: NonNullable<Settings["mergeMethod"]>; label: string }[] = [
  { value: "squash", label: "Squash" },
  { value: "merge", label: "Merge commit" },
  { value: "rebase", label: "Rebase" },
];
const REFRESH: { value: number; label: string }[] = [
  { value: 60, label: "Every minute while open" },
  { value: 120, label: "Every 2 minutes while open" },
  { value: 300, label: "Every 5 minutes while open" },
  { value: 900, label: "Every 15 minutes while open" },
  { value: 0, label: "Only when opened" },
];
const STYLES: { value: "repo" | "conventional" | "custom"; label: string; hint: string }[] = [
  { value: "repo", label: "The repository's own", hint: "As its recent commits read" },
  { value: "conventional", label: "Conventional Commits", hint: "feat: …, fix: …" },
  { value: "custom", label: "Your own words", hint: "Say how, below" },
];

/** The hosts after Git and GitHub, each with the commands its row names. */
const OTHERS: { id: Exclude<ScmTool["id"], "git" | "github" | "linear" | "bitbucket">; cmds: string }[] = [
  { id: "gitlab", cmds: "glab" },
  { id: "azure", cmds: "az" },
  { id: "forgejo", cmds: "fj · tea" },
  { id: "origin", cmds: "origin" },
];

/** A key field in a row, for Bitbucket's app password or Linear's API key: Save checks it with the engine first. */
function KeyField({ id, onDone }: { id: ScmTokenId; onDone: () => void }) {
  const [v, setV] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    const key = v.trim();
    if (!key || busy) return;
    setBusy(true);
    try {
      // The engine takes it first (Linear's is checked with Linear), then the keychain keeps it for the next launch.
      await rpc("sourcecontrol.setToken", { id, token: key });
      try {
        await bridge.keychainSet(`key:${scmKey(id)}`, key);
      } catch (e) {
        await rpc("sourcecontrol.clearToken", { id }).catch(() => {});
        throw e;
      }
      toast.success(`Key saved in ${os.keyStore()}`);
      onDone();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="lc-sc-key">
      <span className="lc-st-input">
        <I.lock size={14} />
        <input type="password" autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => (e.key === "Enter" ? void go() : e.key === "Escape" ? onDone() : undefined)} placeholder={id === "linear" ? "lin_api_…" : "App password"} spellCheck={false} autoComplete="off" aria-label={id === "linear" ? "Linear API key" : "Bitbucket app password"} />
      </span>
      <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={onDone}>
        Cancel
      </button>
      <button type="button" className="lc-btn" data-kind="primary" data-size="sm" disabled={!v.trim() || busy} onClick={() => void go()}>
        {busy ? "Checking" : "Save"}
      </button>
    </span>
  );
}

const forget = async (id: ScmTokenId) => {
  try {
    await bridge.keychainSet(`key:${scmKey(id)}`, null);
    await rpc("sourcecontrol.clearToken", { id });
    toast.success("Key removed");
  } catch (e) {
    fail(e);
  }
};

/** Who gh is signed in as, blurred until it's clicked: a screen share or a capture shouldn't show it by accident. */
function Account({ name }: { name: string }) {
  const [shown, setShown] = useState(false);
  return shown ? (
    <span>Signed in as {name}</span>
  ) : (
    <span>
      Signed in as{" "}
      <button type="button" className="lc-sc-blur l-focus" onClick={() => setShown(true)} aria-label="Show the account">
        {name}
      </button>{" "}
      · click to show
    </span>
  );
}

export function SourceControlPlace() {
  const s = useEngine((x) => x.settings);
  const keys = useEngine((x) => x.keys);
  const projects = useEngine((x) => x.projects).filter((p) => !p.kind && !p.demoFor);
  const [tools, setTools] = useState<ScmTool[] | null>(null);
  const [looking, setLooking] = useState(false);
  const [openGh, setOpenGh] = useState(false);
  const [keyFor, setKeyFor] = useState<ScmTokenId | null>(null);
  const [prefix, setPrefix] = useState(s.branchPrefix);
  const [words, setWords] = useState(s.commitInstructions ?? "");
  useEffect(() => setPrefix(s.branchPrefix), [s.branchPrefix]);
  useEffect(() => setWords(s.commitInstructions ?? ""), [s.commitInstructions]);
  const look = (force: boolean) => {
    setLooking(true);
    void rpc("sourcecontrol.scan", { force })
      .then(setTools, fail)
      .finally(() => setLooking(false));
  };
  useEffect(() => look(false), []);
  // A key added or removed (here or in another window) is a tool to look at again.
  const keyed = keys.filter((k) => k.startsWith("scm.")).sort().join(",");
  useEffect(() => {
    if (tools) look(false);
  }, [keyed]);

  const c = scmSettings(s);
  const tool = (id: ScmTool["id"]) => tools?.find((t) => t.id === id);
  const onGithub = projects.filter((p) => p.remote).length;
  const commitPrefix = () => {
    const v = prefix.trim().replace(/\s+/g, "-");
    const next = !v ? s.branchPrefix : v.endsWith("/") || v.endsWith("-") ? v : `${v}/`;
    setPrefix(next);
    if (next !== s.branchPrefix) save({ branchPrefix: next });
  };
  const head = (id: ScmMark, cmd: string, t?: ScmTool, tag?: ReactNode) => (
    <>
      {SCM_NAME[id]} {t?.found && t.version ? <Mono>{`${cmd} ${t.version}`}</Mono> : <Mono>{cmd}</Mono>}
      {tag}
    </>
  );
  const tile = (id: ScmMark, t?: ScmTool) => (
    <HostTile on={t ? Boolean(t.found && t.signedIn !== false) : undefined} label={SCM_NAME[id]}>
      <ScmIcon id={id} />
    </HostTile>
  );
  const wait = !tools ? "Looking…" : undefined;

  const gh = tool("github");
  const git = tool("git");
  const bb = tool("bitbucket");
  const lin = tool("linear");
  const ghUsable = Boolean(gh?.found && gh.signedIn);

  return (
    <>
      <Section title="Repositories">
        <Row title="Keep the default branch pulled" note="Pulls when the checkout has no changes or commits of its own.">
          <NamedSwitch name="Keep the default branch pulled" checked={s.autoPull === true} onCheckedChange={(autoPull) => save({ autoPull })} />
        </Row>
        <Row title="Branch names start with" note="For the branches of new worktrees and pull requests.">
          <span className="lc-st-input lc-sc-prefix">
            <input className="lc-mono" value={prefix} onChange={(e) => setPrefix(e.target.value)} onBlur={commitPrefix} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} spellCheck={false} aria-label="Branch names start with" />
          </span>
        </Row>
        <Row title="Default merge method" note="What Merge does on a pull request.">
          <span className="lc-st-sel lc-sc-sel">
            <Select options={MERGES} value={c.mergeMethod} onValueChange={(v) => save({ mergeMethod: v as NonNullable<Settings["mergeMethod"]> })} placeholder="Merge method" />
          </span>
        </Row>
      </Section>

      <Section title="Where your code lives" end={<LookAgain looking={looking} onLook={() => look(true)} title="Ask each tool again" />}>
        <Row lead={tile("git", git)} title={head("git", "git", git)} note={wait ?? (git?.found ? "Snapshots, worktrees and branches. Liner Code needs it, so it stays on." : <Hint text={git?.how} />)}>
          {git && (git.found ? <Tag tone="ok">In use</Tag> : <Tag tone="warn">Missing</Tag>)}
        </Row>
        <Row lead={tile("github", gh)} title={head("github", "gh", gh)} note={wait ?? (ghUsable && gh?.account ? <Account name={gh.account} /> : <Hint text={gh?.how} />)}>
          {gh?.found && (
            <button type="button" className="lc-ib l-focus" aria-label={openGh ? "Hide GitHub's details" : "Show GitHub's details"} aria-expanded={openGh} onClick={() => setOpenGh(!openGh)}>
              {openGh ? <I.chevU size={14} /> : <I.chevD size={14} />}
            </button>
          )}
          <NamedSwitch name="Use GitHub" disabled={!gh?.found} checked={Boolean(gh?.found) && hostOn(s, "github")} onCheckedChange={(on) => save({ hosts: { ...s.hosts, github: on } })} />
        </Row>
        {openGh && gh?.found && (
          <RowMore>
            <SubRow title="Projects on GitHub">{`${onGithub} of ${projects.length}`}</SubRow>
            <SubRow title="Pull requests and issues refresh">
              <Choice quiet label="Pull requests and issues refresh" value={REFRESH.some((r) => r.value === c.worklistRefresh) ? c.worklistRefresh : 120} options={REFRESH} onPick={(worklistRefresh) => save({ worklistRefresh })} />
            </SubRow>
            <SubRow title="Signed in through">
              <Mono>gh auth login</Mono>
            </SubRow>
          </RowMore>
        )}
        {OTHERS.slice(0, 1).map(({ id, cmds }) => {
          const t = tool(id);
          return (
            <Row key={id} lead={tile(id, t)} title={head(id, t?.found && id === "forgejo" ? (t.path?.split(/[\\/]/).pop() ?? cmds) : cmds, t)} note={wait ?? (t?.found && t.signedIn && t.account ? <span>Signed in as {t.account}. <Hint text={t.how} /></span> : <Hint text={t?.how} />)}>
              <NamedSwitch name={`Use ${SCM_NAME[id]}`} disabled={!t?.found} checked={Boolean(t?.found) && hostOn(s, id)} onCheckedChange={(on) => save({ hosts: { ...s.hosts, [id]: on } })} />
            </Row>
          );
        })}
        <Row lead={tile("bitbucket", bb)} title={<>Bitbucket {bb?.signedIn ? <Mono>{bb.account ?? ""}</Mono> : <Tag>No token</Tag>}</>} note={keyFor === "bitbucket" ? undefined : bb?.signedIn ? <Hint text={bb.how} /> : "Kept in your keychain. Pull requests from Bitbucket come later."} below={keyFor === "bitbucket"}>
          {keyFor === "bitbucket" ? (
            <KeyField id="bitbucket" onDone={() => setKeyFor(null)} />
          ) : bb?.signedIn ? (
            <SureButton className="lc-btn" attrs={{ "data-kind": "ghost", "data-size": "sm" }} sure="Remove the key?" onConfirm={() => void forget("bitbucket")}>
              Remove
            </SureButton>
          ) : (
            <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => setKeyFor("bitbucket")}>
              Add a token
            </button>
          )}
        </Row>
        {OTHERS.slice(1).map(({ id, cmds }) => {
          const t = tool(id);
          return (
            <Row key={id} lead={tile(id, t)} title={head(id, t?.found && id === "forgejo" ? (t.path?.split(/[\\/]/).pop() ?? cmds) : cmds, t)} note={wait ?? (t?.found && t.signedIn && t.account ? <span>Signed in as {t.account}. <Hint text={t.how} /></span> : <Hint text={t?.how} />)}>
              <NamedSwitch name={`Use ${SCM_NAME[id]}`} disabled={!t?.found} checked={Boolean(t?.found) && hostOn(s, id)} onCheckedChange={(on) => save({ hosts: { ...s.hosts, [id]: on } })} />
            </Row>
          );
        })}
      </Section>

      <Section title="Issues">
        <Row lead={tile("github", gh)} title="GitHub Issues" note={ghUsable ? `Through the same gh sign-in, for the ${onGithub === 1 ? "1 project" : `${onGithub} projects`} on GitHub.` : "Through gh, once it's signed in."}>
          <NamedSwitch name="Use GitHub Issues" disabled={!ghUsable} checked={ghUsable && trackerOn(s, "github")} onCheckedChange={(on) => save({ trackers: { ...s.trackers, github: on } })} />
        </Row>
        <Row lead={tile("linear", lin)} title={<>Linear {lin?.signedIn ? <Mono>{lin.account ?? ""}</Mono> : <Tag tone="new">New</Tag>}</>} note={keyFor === "linear" ? undefined : lin?.signedIn ? "Your teams' issues, through the key you added. It goes to linear.app and nowhere else." : "A Linear team's issues, with a key you make in Linear. The key goes to linear.app and nowhere else."} below={keyFor === "linear"}>
          {keyFor === "linear" ? (
            <KeyField id="linear" onDone={() => setKeyFor(null)} />
          ) : lin?.signedIn ? (
            <>
              <SureButton className="lc-btn" attrs={{ "data-kind": "ghost", "data-size": "sm" }} sure="Remove the key?" onConfirm={() => void forget("linear")}>
                Remove
              </SureButton>
              <NamedSwitch name="Use Linear" checked={trackerOn(s, "linear")} onCheckedChange={(on) => save({ trackers: { ...s.trackers, linear: on } })} />
            </>
          ) : (
            <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => setKeyFor("linear")}>
              Connect
            </button>
          )}
        </Row>
      </Section>

      <Section title="Commits and pull requests">
        <Row title="How commit messages are written" note="The agent that made the change writes the message, in this style.">
          <span className="lc-st-sel">
            <Select options={STYLES} value={c.commitStyle} onValueChange={(v) => save({ commitStyle: v as (typeof STYLES)[number]["value"] })} placeholder="Style" />
          </span>
        </Row>
        {c.commitStyle === "custom" && (
          <Row title="Your words" note="Told to the agent each time it writes a commit message." below>
            <textarea className="lc-input lc-sc-words" rows={3} value={words} onChange={(e) => setWords(e.target.value)} onBlur={() => words !== (s.commitInstructions ?? "") && save({ commitInstructions: words })} placeholder="Start with the ticket number, then what changed." maxLength={2000} aria-label="How commit messages are written, in your words" />
          </Row>
        )}
        <Row title="Follow pull request templates" note="A new pull request uses the repository's template when it has one.">
          <NamedSwitch name="Follow pull request templates" checked={c.followPrTemplates} onCheckedChange={(followPrTemplates) => save({ followPrTemplates })} />
        </Row>
        <Row title={<>Scan new pull requests <Tag tone="new">New</Tag></>} note="A read-only Liner Security scan as one opens or gets new commits: one at a time, never a draft, at most 10 a day, while Liner Code is open. It costs tokens on your plan.">
          <NamedSwitch name="Scan new pull requests" checked={c.scanNewPrs} onCheckedChange={(scanNewPrs) => save({ scanNewPrs })} />
        </Row>
      </Section>
    </>
  );
}
