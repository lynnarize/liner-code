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

export function DeviceSurface({ thread, agentName, visible }: { thread: Thread; agentName: string; visible: boolean }) {
  const [list, setList] = useState<{ devices: Device[]; ready: boolean; detail?: string } | null>(null);
  const [udid, setUdid] = useState<string | null>(() => localStorage.getItem("lc:device"));
  const [shot, setShot] = useState<string | null>(null);
  const [booting, setBooting] = useState(false);
  const [dark, setDark] = useState(false);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const [question, setQuestion] = useState("");
  const [logOn, setLogOn] = useState(false);
  const [filter, setFilter] = useState("");
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
    if (udid) localStorage.setItem("lc:device", udid);
  }, [udid]);

  const dev = list?.devices.find((d) => d.udid === udid);
  const booted = dev?.state === "Booted";

  // The screen, about once a second while you can see it.
  useEffect(() => {
    if (!visible || !booted || !udid) return;
    let live = true;
    let t = 0;
    const tick = async () => {
      try {
        const r = await rpc("device.shot", { udid });
        if (live) setShot(`data:image/png;base64,${r.png}`);
      } catch {
        // the device went away
      }
      if (live) t = window.setTimeout(tick, point ? 4000 : 1100);
    };
    void tick();
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [visible, booted, udid, point !== null]);

  // The device's log, while it is on.
  useEffect(() => {
    if (!udid || !booted || !logOn) return;
    void rpc("device.log", { udid, on: true, filter: filter.trim() || undefined }).catch(() => {});
    const off = onStream((e) => {
      if (e.type === "devlog" && e.udid === udid) setLines((l) => [...l, ...e.lines].slice(-400));
    });
    return () => {
      off();
      void rpc("device.log", { udid, on: false }).catch(() => {});
    };
  }, [udid, booted, logOn, filter]);
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

  const ask = async () => {
    if (!shot || !question.trim() || !point) return;
    const where = `about ${Math.round(point.x * 100)}% across and ${Math.round(point.y * 100)}% down the screen`;
    try {
      await rpc("thread.send", { id: thread.id, text: `${question.trim()}\n\n(On the ${dev?.name ?? "simulator"}, ${where}. The screenshot is attached.)`, files: [{ name: "simulator.png", data: shot.split(",")[1] }], mode: thread.status === "running" ? "queue" : undefined });
      toast(`Asked ${agentName}`, { description: "With the screenshot" });
      setPoint(null);
      setQuestion("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const save = () => {
    if (!shot) return;
    const a = document.createElement("a");
    a.href = shot;
    a.download = `${dev?.name ?? "Simulator"} ${new Date().toLocaleTimeString("en-GB").replace(/:/g, ".")}.png`;
    a.click();
  };

  if (!list) return <SurfaceNote icon={<I.device size={20} />} title="Looking for simulators" />;
  if (!list.ready) return <SurfaceNote icon={<I.device size={20} />} title="The Device surface needs Xcode">{list.detail ?? "Install Xcode from the App Store, then open it once so it finishes setting up."}</SurfaceNote>;
  if (!list.devices.length)
    return (
      <SurfaceNote icon={<I.device size={20} />} title="No simulators yet" action={<button type="button" className="lc-btn" data-kind="plain" onClick={() => void load()}>Look again</button>}>
        Add an iOS runtime in Xcode, under Settings, Components. Its simulators show up here.
      </SurfaceNote>
    );

  const byRuntime = [...new Set(list.devices.map((d) => d.runtime))];

  return (
    <div className="lc-dev">
      <div className="lc-dev-bar">
        <Pop
          label="Pick a simulator"
          width={300}
          triggerClass="lc-turnpick"
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
                      <Row key={d.udid} title={d.name} note={d.state === "Booted" ? "Booted" : undefined} on={d.udid === udid} onPick={() => (setUdid(d.udid), setShot(null), close())} />
                    ))}
                </div>
              ))}
            </>
          )}
        </Pop>
        <span className="lc-grow" />
        <button
          type="button"
          className="lc-ib l-focus"
          aria-label={dark ? "Light appearance" : "Dark appearance"}
          title={dark ? "Light appearance" : "Dark appearance"}
          aria-pressed={dark}
          disabled={!booted}
          onClick={() => {
            const next = !dark;
            setDark(next);
            if (udid) void rpc("device.appearance", { udid, mode: next ? "dark" : "light" }).catch((e) => toast.error(String(e?.message ?? e)));
          }}
        >
          <I.contrast size={14} />
        </button>
        <button type="button" className="lc-ib l-focus" aria-label="Save a screenshot" title="Save a screenshot" disabled={!shot} onClick={save}>
          <I.camera size={14} />
        </button>
        <button type="button" className="lc-ib l-focus" aria-label={`Point at something on screen to ask ${agentName}`} title={`Point at something to ask ${agentName}`} aria-pressed={point !== null} disabled={!shot} onClick={() => setPoint((p) => (p ? null : { x: 0.5, y: 0.5 }))}>
          <I.target size={14} />
        </button>
      </div>
      <div className="lc-dev-stage">
        {!booted ? (
          <SurfaceNote
            icon={<I.device size={20} />}
            title={`${dev?.name ?? "The simulator"} is off`}
            action={
              <button type="button" className="lc-btn" data-kind="primary" disabled={booting} onClick={() => void boot()}>
                {booting ? "Starting it" : "Start it"}
              </button>
            }
          >
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
        {point && (
          <div className="lc-dev-ask l-glass" role="dialog" aria-label={`Ask ${agentName} about the screen`}>
            <input
              className="lc-input"
              autoFocus
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={`Click the screen, then ask ${agentName}`}
              onKeyDown={(e) => {
                if (e.key === "Enter") void ask();
                if (e.key === "Escape") setPoint(null);
              }}
            />
            <button type="button" className="lc-btn" data-kind="primary" data-size="sm" disabled={!question.trim()} onClick={() => void ask()}>
              Ask
            </button>
          </div>
        )}
      </div>
      <div className="lc-dev-log" data-open={logOn || undefined}>
        <div className="lc-dev-log-h">
          <button type="button" className="lc-br-console-h l-focus" aria-expanded={logOn} disabled={!booted} onClick={() => (setLogOn((o) => !o), setLines([]))}>
            <I.chevU size={12} />
            <b>Device log</b>
            <span className="lc-quiet">{logOn ? (filter.trim() ? `Filtered to ${filter.trim()}` : "Everything") : "Off"}</span>
          </button>
          {logOn && <input className="lc-dev-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter, like your app's name" aria-label="Filter the log" />}
        </div>
        {logOn && (
          <div ref={logBox} className="lc-br-logs lc-mono" role="log" aria-label="Device log">
            {lines.length ? lines.map((l, i) => <div key={i} className="lc-br-log">{l}</div>) : <p className="lc-quiet">Waiting for the device to say something.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
