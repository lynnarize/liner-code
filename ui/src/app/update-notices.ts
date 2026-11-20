/*
  Which tool notices still speak: a dismissal is kept until a newer version comes out (Updates.tsx's own promise) while
  the tool is offered, waiting or updating, so putting one away keeps it away when Home opens again. "Updated" and
  "failed" are news you haven't seen, so they speak even at a version you put away; the engine clears each of them
  when you put that notice itself away (updates.ts, dismiss), so they don't come back. A tool with no version known
  isn't one you put away. Pure, so a node test can pin it.
*/
export const toolShown = (t: { id: string; state: string; latest?: string }, dismissed: Record<string, string | undefined>) =>
  t.state === "updated" || t.state === "failed" || t.latest === undefined || dismissed[t.id] !== t.latest;