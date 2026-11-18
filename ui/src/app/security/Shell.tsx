/*
  Liner Security's face: the page its small store says (store.ts, security/Side.tsx picks it), in the paper beside the
  sidebar, as design/Shell.tsx does for Liner Design. Loaded only when the face is first shown (App.tsx, lazy). A page
  whose session went away (a scan or fix deleted) goes back to the Overview; one that is only on its way (a fix session
  just made, the engine still connecting) is waited for a moment first.
*/
import { useEffect, useState } from "react";
import { useEngine } from "../engine";
import { Findings } from "./Findings";
import { Overview } from "./Overview";
import { Projects } from "./Projects";
import { ScanSession } from "./ScanSession";
import { StartScan } from "./StartScan";
import { goSecurity, useSecurityPage } from "./store";
import "./security.css";

/** How long a session asked for may take to come in before the page gives up on it. */
const WAIT_MS = 4000;

export function SecurityShell({ sidebar, onSidebar }: { sidebar: boolean; onSidebar: () => void }) {
  const page = useSecurityPage();
  const id = page.kind === "scan" ? page.threadId : null;
  const there = useEngine((s) => id !== null && s.threads.some((t) => t.id === id));
  const ready = useEngine((s) => s.ready);
  // Not there yet: a session just made comes with the engine's next event, so it is only gone once it hasn't come in a few seconds.
  const [gone, setGone] = useState(false);
  useEffect(() => {
    setGone(false);
    if (id === null || there || !ready) return;
    const t = setTimeout(() => setGone(true), WAIT_MS);
    return () => clearTimeout(t);
  }, [id, there, ready]);
  useEffect(() => {
    if (gone) goSecurity({ kind: "overview" });
  }, [gone]);
  switch (page.kind) {
    case "findings":
      // Narrowed to one scan ("Open the findings" on a scan): Findings reads that from the page itself.
      return <Findings sidebar={sidebar} onSidebar={onSidebar} finding={page.finding} state={page.state} source={page.source} />;
    case "projects":
      return <Projects sidebar={sidebar} onSidebar={onSidebar} projectId={page.projectId} />;
    case "start":
      return <StartScan sidebar={sidebar} onSidebar={onSidebar} projectId={page.projectId} />;
    case "scan":
      return there ? <ScanSession key={page.threadId} sidebar={sidebar} onSidebar={onSidebar} threadId={page.threadId} /> : <div className="lc-diff-wait"><span className="l-shimmer">Opening the session</span></div>;
    default:
      return <Overview sidebar={sidebar} onSidebar={onSidebar} />;
  }
}
