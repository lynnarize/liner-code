/*
  Settings › Source control & issues: which of the tools that know about your code are on this Mac and signed in
  (git, gh, glab, az, fj or tea, Cursor Origin), the two keys Liner keeps itself (a Bitbucket app password and a
  Linear API key, both in the keychain, never in settings.json), and the settings that page saves. The engine's
  half is engine/src/sourcecontrol.ts.
*/
import type { Host } from "./worklists.ts";
import type { Settings } from "./index.ts";

/** One tool found (or not) on this Mac. A token is never in it: `account` is a name, or the last 4 characters of a key at most. */
export type ScmTool = { id: Host | "git" | "linear"; found: boolean; version?: string; signedIn?: boolean; account?: string; path?: string; how?: string /* install/sign-in hint */ };
/** The keys Liner keeps itself, for hosts and trackers no CLI signs in to. */
export type ScmTokenId = "bitbucket" | "linear";
/** Where a key Liner keeps is held: the keychain account "key:<this>", and the engine's in-memory keys under this name. */
export const scmKey = (id: ScmTokenId) => `scm.${id}`;

export type MergeMethod = "squash" | "merge" | "rebase";
/** The Source control settings, each with its default when it isn't set (scmSettings). */
export type ScmSettings = {
  /** The merge method a pull request's Merge uses when none is picked. */
  mergeMethod: MergeMethod;
  /** How commit messages are written: the repository's own recent style, Conventional Commits, or your own words. */
  commitStyle: "repo" | "conventional" | "custom";
  commitInstructions?: string;
  /** A drafted pull request's body follows the repository's template when it has one (off until you turn it on, so drafting reads as before). */
  followPrTemplates: boolean;
  /** A new pull request is scanned by Liner Security as it opens (engine/src/security-watch.ts). */
  scanNewPrs: boolean;
  /** Seconds the Pull requests and Issues lists are kept before they're asked for again (0: only when opened). */
  worklistRefresh: number;
  /** Per host, whether its pull requests are listed (on unless false). */
  hosts?: Partial<Record<Host, boolean>>;
  /** Per tracker, whether its issues are listed (on unless false). */
  trackers?: { github?: boolean; linear?: boolean };
};

export const SCM_DEFAULTS: ScmSettings = { mergeMethod: "squash", commitStyle: "repo", followPrTemplates: false, scanNewPrs: false, worklistRefresh: 120 };

/** The Source control settings with their defaults filled in. */
export const scmSettings = (s: Partial<Settings> | undefined): ScmSettings => ({
  // A "last" saved before Last used was taken away (nothing ever picked a method for it) reads as the default.
  mergeMethod: s?.mergeMethod === "merge" || s?.mergeMethod === "rebase" || s?.mergeMethod === "squash" ? s.mergeMethod : SCM_DEFAULTS.mergeMethod,
  commitStyle: s?.commitStyle ?? SCM_DEFAULTS.commitStyle,
  commitInstructions: s?.commitInstructions,
  followPrTemplates: s?.followPrTemplates ?? SCM_DEFAULTS.followPrTemplates,
  scanNewPrs: s?.scanNewPrs ?? SCM_DEFAULTS.scanNewPrs,
  worklistRefresh: typeof s?.worklistRefresh === "number" && Number.isFinite(s.worklistRefresh) ? Math.max(0, Math.round(s.worklistRefresh)) : SCM_DEFAULTS.worklistRefresh,
  hosts: s?.hosts,
  trackers: s?.trackers,
});

/** A host's or tracker's switch: on unless turned off. */
export const hostOn = (s: Partial<Settings> | undefined, h: Host) => s?.hosts?.[h] !== false;
export const trackerOn = (s: Partial<Settings> | undefined, t: "github" | "linear") => s?.trackers?.[t] !== false;
