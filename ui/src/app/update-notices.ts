/*
  Which tool notices still speak: a dismissal is kept until a newer version comes out (Updates.tsx's own promise),
  whatever state the tool is in now. Pure, so a node test can pin it.
*/
export const toolShown = (t: { id: string; latest?: string }, dismissed: Record<string, string | undefined>) =>
  dismissed[t.id] !== t.latest;