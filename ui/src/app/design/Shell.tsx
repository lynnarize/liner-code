/*
  The Design face's main area: the tab that shows, Design Home or a design on its canvas. A tab
  whose project went away (a design deleted, or moved into a project elsewhere) is let go quietly.
  It also tells the store who makes the session of a design that has none yet (session.ts), for
  the asks that don't come from the dock (a fix, an AI picture, the lean).
*/
import { useEffect } from "react";
import { useEngine } from "../engine";
import { closeTab, tabKey, useTabs } from "../face";
import { DesignFace } from "./DesignFace";
import { DesignHome } from "./DesignHome";
import { freshProject, makeSession, sessionOf } from "./session";
import { design, setSessionMaker } from "./store";

export function DesignShell({ sidebar, onSidebar, onNewAgent }: { sidebar: boolean; onSidebar: () => void; onNewAgent: () => void }) {
  const { list, at } = useTabs();
  const projects = useEngine((s) => s.projects);
  const threads = useEngine((s) => s.threads);
  const tab = list.find((t) => tabKey(t) === at);
  const project = tab ? (projects.find((p) => p.id === tab.projectId) ?? freshProject(tab.projectId)) : undefined;

  useEffect(() => {
    for (const t of list)
      if (!projects.some((p) => p.id === t.projectId) && !freshProject(t.projectId)) {
        closeTab(tabKey(t));
        design.forget(tabKey(t));
      }
  }, [projects, list]);
  useEffect(() => {
    setSessionMaker(tab && project ? async () => (await makeSession(tab)).id : undefined);
    return () => setSessionMaker(undefined);
  }, [at, project?.id]);

  if (!tab || !project) return <DesignHome sidebar={sidebar} onSidebar={onSidebar} onNewAgent={onNewAgent} />;
  return <DesignFace key={at} tab={tab} project={project} thread={sessionOf(tab, threads)} sidebar={sidebar} onSidebar={onSidebar} />;
}
