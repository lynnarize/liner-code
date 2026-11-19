/*
  Which page a change of face keeps, in its own file so the engine's tests can read it: face.ts brings React
  and a stylesheet with it, which Node cannot load (plans/layout L02).
*/
// The pages a face draws itself: its Home and a session. Every other page (Add-ons, Usage, the Wall, an app) is reached
// from Liner Code's sidebar, so a change of face leaves it: the paper would otherwise keep it under another face's sidebar.
export const keptOnFaceChange = (kind: string) => kind === "home" || kind === "session";
