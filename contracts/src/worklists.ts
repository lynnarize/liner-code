/*
  Pull requests and issues across your projects, the lists the Pull requests and Issues pages show and Liner's MCP
  server hands to apps. The engine asks the tools you already have for them (gh for GitHub, Linear's API with a key
  you added), one project at a time, and says which projects it couldn't read and why instead of failing the whole
  list (engine/src/worklists.ts).
*/

/** Where a repository lives. Only GitHub drives the lists in this build; the others are detected (sourcecontrol.ts). */
export type Host = "github" | "gitlab" | "bitbucket" | "azure" | "forgejo" | "origin";
export type PrState = "open" | "draft" | "merged" | "closed";
/** A pull request's checks counted (SPEC calls it PrChecks; that name is the thread row's one-fact PrChecks in index.ts already). */
export type PrCheckCounts = { passed: number; failed: number; pending: number; failing?: string[] };
export type PrItem = { projectId: string; project: string; host: Host; number: number; title: string; url: string; state: PrState; author: string; mine: boolean; reviewRequested: boolean; branch: string; base: string; additions: number; deletions: number; files: number; checks?: PrCheckCounts; labels: { name: string; color?: string }[]; updatedAt: number; body?: string; threadId?: string };
export type IssueItem = { projectId: string; project: string; tracker: "github" | "linear"; key: string /* "#42" or "LIN-12" */; number?: number; title: string; url: string; state: "open" | "closed"; author: string; assignedToMe: boolean; labels: { name: string; color?: string }[]; comments: number; updatedAt: number; body?: string; linkedPrs?: number[] };
/** `q`: words in the title, "#42", "label:bug", "author:mara". `fresh`: ask the hosts again rather than answer from the last minute's lists (a refresh button). */
export type WorklistQuery = { projectId?: string; state?: "open" | "closed" | "merged" | "all"; q?: string; fresh?: boolean };
export type WorklistResult<T> = { items: T[]; unavailable: { projectId: string; project: string; why: string }[]; at: number };
/**
  One pull request with its changed files, for the page's detail. `headSha`: its head commit (gh's headRefOid), so a local
  branch of the same name is used only when its tip is that commit. `isCrossRepository`: it comes from a fork.
*/
export type PrDetail = PrItem & { fileList: { path: string; additions: number; deletions: number }[]; headSha?: string; isCrossRepository?: boolean };
