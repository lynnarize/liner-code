/*
  The Device surface: an iOS Simulator beside the session. The screen refreshes while the tab
  is in view; point at something on it to ask the agent, and the screenshot goes with the
  question. Light and dark switch the simulator's appearance; the log under it follows the
  device, filtered to what you name.
*/
import { useEffect, useRef, useState } from "react";
import type { Device, Thread } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { onStream, rpc } from "./engine";
import { I } from "./icons";
import { PanelHead, Pop, Row, Sep } from "./ui";
import { SurfaceNote } from "./Surfaces";
import { SendBox } from "./Composer";
import { PANE_PICK, PANE_TOOL, PaneButton, PaneHead, PaneTool } from "./Pane";
import { textRead, wordWrite } from "./kept.ts";

export function DeviceSurface({ thread, agentName, visible }: { thread: Thread; agentName: string; visible: boolean }) {
  const [list, setList] = useState<{ devices: Device[]; ready: boolean; detail?: string } | null>(null);
  const [udid, setUdid] = useState<string | null>(() => textRead(localStorage, "lc:device", null));
  const [shot, setShot] = useState<string | null>(null);
  const [booting, setBooting] = useState(false);
  // The simulator doesn't say which it's in, so neither is marked until you pick one here.
  const [look, setLook] = useState<"light" | "dark" | null>(null);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const [question, setQuestion] = useState("");
  const [logOn, setLogOn] = useState(false);
  const [filter, setFilter] = useState("");
  // The filter the log runs with: a pause in the typing, not each letter, restarts its `log stream`.
  const [logFilter, setLogFilter] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setLogFilter(filter.trim()), 400);
    return () => window.clearTimeout(t);
  }, [filter]);
  const [asking, setAsking] = useState(false);
  const sending = useRef(false);
  const [lines, setLines] = useState<string[]>([]);
  const screen = useRef<HTMLDivElement>(null);
  const logBox = useRef<HTMLDivElement>(null);

  const load = () =>
    rpc("device.list", {})
      .then((d) => {
        setList(d);
        return d;
      })
      .catch((e) => {
        setList({ devices: [], ready: false, detail: e instanceof Error ? e.message : String(e) });
        return null;
      });
  useEffect(() => {
    void load().then((d) => {
      if (!d) return;
      if (!udid || !d.devices.some((x) => x.udid === udid)) setUdid(d.devices.find((x) => x.state === "Booted")?.udid ?? d.devices[0]?.udid ?? null);
    });
  }, []);
  useEffect(() => {
    if (udid) wordWrite(localStorage, "lc:device", udid);
  }, [udid]);

  const dev = list?.devices.find((d) => d.udid === udid);
  const booted = dev?.state === "Booted";

  // The screen, about once a second while you can see it: not while the window is hidden or
  // minimised (the tab can be up in a window you can't see), and again as soon as it shows.
  useEffect(() => {
    if (!visible || !booted || !udid) return;
    let live = true;
    let going = false;
    let t = 0;
    const tick = async () => {
      if (!live || going || document.hidden) return;
      going = true;
      try {
        const r = await rpc("device.shot", { udid });
        if (live) setShot(`data:image/png;base64,${r.png}`);
      } catch {
        // the device went away
      }
      going = false;
      if (live) t = window.setTimeout(tick, point ? 4000 : 1100);
    };
    const shows = () => {
      if (document.hidden) return;
      window.clearTimeout(t);
      void tick();
    };
    document.addEventListener("visibilitychange", shows);
    void tick();
    return () => {
      live = false;
      window.clearTimeout(t);
      document.removeEventListener("visibilitychange", shows);
    };
  }, [visible, booted, udid, point !== null]);

  // The device's log, while it is on.
  useEffect(() => {
    if (!udid || !booted || !logOn) return;
    void rpc("device.log", { udid, on: true, filter: logFilter || undefined }).catch(() => {});
    const off = onStream((e) => {
      if (e.type === "devlog" && e.udid === udid) setLines((l) => [...l, ...e.lines].slice(-400));
    });
    return () => {
      off();
      void rpc("device.log", { udid, on: false }).catch(() => {});
    };
  }, [udid, booted, logOn, logFilter]);
  useEffect(() => {
    const b = logBox.current;
    if (b) b.scrollTop = b.scrollHeight;
  }, [lines]);

  const boot = async () => {
    if (!udid) return;
    setBooting(true);
    try {
      await rpc("device.boot", { udid });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBooting(false);
    }
  };

  // Two quick Enters are one question, with one screenshot (Browser's ask does the same).
  const ask = async () => {
    if (!shot || !question.trim() || !point || sending.current) return;
    sending.current = true;
    setAsking(true);
    const where = `about ${Math.round(point.x * 100)}% across and ${Math.round(point.y * 100)}% down the screen`;
    try {
      await rpc("thread.send", { id: thread.id, text: `${question.trim()}\n\n(On the ${dev?.name ?? "simulator"}, ${where}. The screenshot is attached.)`, files: [{ name: "simulator.png", data: shot.split(",")[1] }], mode: thread.status === "running" ? "queue" : undefined });
      toast(`Asked ${agentName}`, { description: "With the screenshot" });
      setPoint(null);
      setQuestion("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      sending.current = false;
      setAsking(false);
    }
  };

  const save = () => {
    if (!shot) return;
    const a = document.createElement("a");
    a.href = shot;
    a.download = `${dev?.name ?? "Simulator"} ${new Date().toLocaleTimeString("en-GB").replace(/:/g, ".")}.png`;
    a.click();
  };

  // Before there is a simulator to show, the frame's head alone (its name, Full canvas, Close) over the one note.
  if (!list)
    return (
      <>
        <PaneHead />
        <SurfaceNote icon={<I.device size={20} />} title="Looking for simulators" />
      </>
    );
  if (!list.ready)
    return (
      <>
        <PaneHead />
        <SurfaceNote icon={<I.device size={20} />} title="The Device surface needs Xcode">
          {list.detail ?? "Install Xcode from the App Store, then open it once so it finishes setting up."}
        </SurfaceNote>
      </>
    );
  if (!list.devices.length)
    return (
      <>
        <PaneHead />
        <SurfaceNote icon={<I.device size={20} />} title="No simulators yet" action={<PaneButton icon={<I.refresh size={14} />} onClick={() => void load()}>Look again</PaneButton>}>
          Add an iOS runtime in Xcode, under Settings, Components. Its simulators show up here.
        </SurfaceNote>
      </>
    );

  const byRuntime = [...new Set(list.devices.map((d) => d.runtime))];

  return (
    <div className="lc-dev">
      {/* The head (Pane.tsx): the simulator picker, then appearance, a screenshot and pointing to ask. */}
      <PaneHead
        shows={
          <Pop
            label="Pick a simulator"
            width={300}
            triggerClass={PANE_PICK}
            trigger={
              <>
                {dev?.name ?? "Pick a simulator"}
                {dev && <span className="lc-dev-state" data-on={booted || undefined}>{booted ? "Booted" : dev.state}</span>}
                <I.chevD size={12} />
              </>
            }
          >
            {(close) => (
              <>
                {byRuntime.map((rt, i) => (
                  <div key={rt}>
                    {i > 0 && <Sep />}
                    <PanelHead>{rt}</PanelHead>
                    {list.devices
                      .filter((d) => d.runtime === rt)
                      .map((d) => (
                        <Row key={d.udid} title={d.name} end={d.state === "Booted" ? "Booted" : undefined} on={d.udid === udid} onPick={() => (setUdid(d.udid), setShot(null), close())} />
                      ))}
                  </div>
                ))}
              </>
            )}
          </Pop>
        }
        tools={
          <>
            {/* Light or Dark, both offered: the simulator doesn't say which it's in, so one button that flipped did nothing the first time on a dark one. */}
            <Pop label="Appearance" align="end" width={200} menu triggerClass={PANE_TOOL} triggerAttrs={{ title: "Light or dark appearance" }} disabled={!booted} trigger={<I.contrast size={16} />}>
              {(close) => (
                <>
                  {(["light", "dark"] as const).map((mode) => (
                    <Row
                      key={mode}
                      title={mode === "light" ? "Light appearance" : "Dark appearance"}
                      on={look === mode}
                      onPick={() => {
                        close();
                        setLook(mode);
                        if (udid) void rpc("device.appearance", { udid, mode }).catch((e) => toast.error(String(e?.message ?? e)));
                      }}
                    />
                  ))}
                </>
              )}
            </Pop>
            <PaneTool label="Save a screenshot" icon={<I.camera size={16} />} disabled={!shot} onClick={save} />
            <PaneTool label={`Point at something on screen to ask ${agentName}`} icon={<I.target size={16} />} pressed={point !== null} disabled={!shot} onClick={() => setPoint((p) => (p ? null : { x: 0.5, y: 0.5 }))} />
          </>
        }
      />
      <div className="lc-dev-stage">
        {!booted ? (
          <SurfaceNote icon={<I.device size={20} />} title={`${dev?.name ?? "The simulator"} is off`} action={<PaneButton ink disabled={booting} onClick={() => void boot()}>{booting ? "Starting it" : "Start it"}</PaneButton>}>
            Starting it opens the Simulator app too; the screen shows here.
          </SurfaceNote>
        ) : (
          <div
            ref={screen}
            className="lc-dev-screen"
            aria-label={`${dev?.name} screen`}
            data-pointing={point !== null || undefined}
            onClick={(e) => {
              if (point === null) return;
              const r = e.currentTarget.getBoundingClientRect();
              setPoint({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
            }}
          >
            {shot ? <img src={shot} alt="" draggable={false} /> : <span className="l-shimmer">Reading the screen</span>}
            {point && <span className="lc-dev-dot" style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }} />}
          </div>
        )}
        {/* The Browser's ask, the same shape: where you pointed and a way to close, then the message box's field and Send. */}
        {point && (
          <div className="lc-br-ask lc-dev-ask l-glass" role="dialog" aria-label={`Ask ${agentName} about the screen`}>
            <div className="lc-br-ask-h">
              <I.target size={14} />
              <span className="lc-quiet lc-br-ask-p">
                {Math.round(point.x * 100)}% across, {Math.round(point.y * 100)}% down · click the screen to move it
              </span>
              <button type="button" className="lc-ib l-focus" aria-label="Close" onClick={() => setPoint(null)}>
                <I.close size={14} />
              </button>
            </div>
            <SendBox autoFocus value={question} onChange={setQuestion} disabled={asking} label={`Ask ${agentName} about the screen. Sends a screenshot and where you pointed`} placeholder={`Ask ${agentName} about this`} onSend={() => void ask()} onEscape={() => setPoint(null)} />
          </div>
        )}
      </div>
      {/* The foot: the Device log's toggle, shaped as the Browser's Console; it opens upward. */}
      <div className="lc-dev-log" data-open={logOn || undefined}>
        {logOn && (
          <div ref={logBox} className="lc-br-logs lc-mono" role="log" aria-label="Device log">
            {lines.length ? lines.map((l, i) => <div key={i} className="lc-br-log">{l}</div>) : <p className="lc-quiet">Waiting for the device to say something.</p>}
          </div>
        )}
        <div className="lc-dev-log-h">
          <button type="button" className="lc-br-console-h l-focus" aria-expanded={logOn} disabled={!booted} onClick={() => (setLogOn((o) => !o), setLines([]))}>
            <I.chevU size={12} />
            <b>Device log</b>
            <span className="lc-quiet">{logOn ? (filter.trim() ? `Filtered to ${filter.trim()}` : "Everything") : "Off"}</span>
          </button>
          {logOn && <input className="lc-dev-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter, like your app's name" aria-label="Filter the log" />}
        </div>
      </div>
    </div>
  );
}
