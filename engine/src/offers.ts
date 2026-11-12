/*
  "Make it an app": an agent's offer, at the end of its turn, to make something as an app in Liner
  Code, and what happens when you take it. The card says what it would be, where it would go (the
  right dock, a tab beside Chat, a page of its own, or where you write), and exactly what it would
  touch. Create makes it in a background session of its own, with a brief, while you keep
  chatting; when that session's turn ends, the engine adds what it made, if it touches no more than
  the card said. Then Keep, or Undo (removed, its files kept) and Restore.

  DeepSeek Harness's creation recommendations (packages/experimental/creation-recommendations,
  MIT) are the flow and the words; ours makes a panel (addons.ts) rather than a plugin, and the
  child is an ordinary session you can open and watch, in Workshop, so it has the guide and
  draws in Liner 2.0 (creator.ts).
*/
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Item, PanelAccess, PanelPlace, SessionMode, Thread } from "../../contracts/src/index.ts";
import { accessWords, ADDON_ID, checkManifest, modelHostRefusal, readDraft, widerAccess, type Addons } from "./addons.ts";
import { uid, writeAtomic, type Store } from "./store.ts";

type Offer = Extract<Item, { kind: "offer" }>;
const PLACES: Record<PanelPlace, string> = { dock: "the right dock, beside the session", tab: "a tab beside Chat in the session", page: "a page of its own, opened from Apps in the left sidebar" };

export type OfferHost = {
  store: Store;
  addons: Addons;
  createThread(p: { projectId: string; agent: string; model?: string; title: string; access: Thread["access"]; mode?: SessionMode }): Promise<Thread>;
  send(threadId: string, text: string): Promise<void>;
  stop(threadId: string): void;
  cwdOf(threadId: string): string;
  whoIs(threadId: string): string;
  readOnly(threadId: string): boolean;
  turnOf(threadId: string): number;
};

/** An id for what it makes, from its name, that no add-on has yet (or this offer's own). */
export function idFor(name: string, taken: (id: string) => boolean) {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/^[^a-z]+/, "")
      .slice(0, 32)
      .replace(/-+$/, "") || "app";
  const fit = base.length < 2 ? `${base}-app` : base;
  for (let n = 1; ; n++) {
    const id = n === 1 ? fit : `${fit}-${n}`;
    if (ADDON_ID.test(id) && !taken(id)) return id;
  }
}

/** The brief the background session gets: what to make, where, what it may touch, and when to stop. */
export function briefOf(o: Offer, id: string) {
  const where = o.custom ? `where the person asked for it, in their words: “${o.custom}”. Pick the place in the manifest that does that (dock, tab or page); if none can, say so and make nothing` : `in ${PLACES[o.place]} (manifest place "${o.place}")`;
  return [
    `Make an app for Liner Code: a panel called “${o.name}”, with the id ${id}. Read liner_inspect first: it says how a panel is written. Then read its "design" topic, Liner 2.0, and draw the panel in it, so it looks like part of Liner Code.`,
    "",
    `What it does: ${o.brief}`,
    "",
    `Put it ${where}.`,
    `It may touch only this, which the person saw before they said yes: ${accessWords(o.access, o.place)}. Its manifest's access must be ${JSON.stringify(o.access)} or less; asking for more means it won't be added.`,
    ...(o.seed?.length ? ["", "It starts with these, as the person gave them:", ...o.seed.map((s) => `- ${s}`)] : []),
    "",
    `Write it in .liner/addons/${id}/ (addon.json and its files). Check it with addon_check, fix what's off, and check again until it draws without errors. Then stop: don't call addon_install. Liner Code adds it when you're done, because the person already said yes on the card.`,
  ].join("\n");
}

export class Offers {
  /** Background sessions making an app, by session: the offer they answer to, and whether their turn has started. Kept on disk: quitting doesn't end them. */
  private making = new Map<string, { threadId: string; itemId: string; id: string; started: boolean }>();

  private h: OfferHost;

  constructor(h: OfferHost) {
    this.h = h;
    try {
      if (existsSync(this.file)) this.making = new Map(JSON.parse(readFileSync(this.file, "utf8")) as [string, { threadId: string; itemId: string; id: string; started: boolean }][]);
    } catch {
      // torn: its cards can be cancelled by hand
    }
    h.store.on((e) => {
      if (e.type === "thread") this.watch(e.thread);
      if (e.type === "thread.removed") this.gone(e.id);
    });
  }

  private get file() {
    return join(this.h.store.home, "making.json");
  }

  private keep() {
    writeAtomic(this.file, JSON.stringify([...this.making]));
  }

  /** The offer a background session answers to, if that session is still there. */
  private offerOf(m: { threadId: string; itemId: string }) {
    if (!this.h.store.threads.some((t) => t.id === m.threadId)) return null;
    const it = this.h.store.timeline(m.threadId).find((x) => x.id === m.itemId);
    return it?.kind === "offer" ? it : null;
  }

  /** Once the engine is back: what was being made carries on with its session, or is added, or says why not. `going` is who carried on by itself. */
  resume(going: string[]) {
    for (const [child, m] of [...this.making]) {
      const t = this.h.store.threads.find((x) => x.id === child);
      if (!t) this.gone(child);
      else if (going.includes(child)) m.started = false;
      else {
        m.started = true;
        this.watch(t);
      }
    }
  }

  /** The session making it was deleted: its card says so, and can be tried again. */
  private gone(child: string) {
    const m = this.making.get(child);
    if (!m) return;
    this.making.delete(child);
    this.keep();
    const it = this.offerOf(m);
    if (it && (it.state === "creating" || it.state === "installing")) this.h.store.putItem(m.threadId, { ...it, state: "failed", error: "The session making it was deleted. Try again." });
  }

  /**
    addon_offer: a card at the end of this turn. One a turn; a newer one replaces an offer in this
    session that wasn't taken yet. What it would touch is checked as a manifest's access would be.
  */
  offer(threadId: string, args: Record<string, unknown>): string {
    const store = this.h.store;
    if (store.settings.addonOffers === "never") throw new Error("The person turned this off: in Settings › Add-ons, agents may never offer add-ons. Answer as you would without one.");
    if (this.h.readOnly(threadId)) throw new Error("This session is at Read only now (or it's a side chat), so it can't offer to make an app. Say what you'd make instead.");
    const name = String(args.name ?? "").trim();
    const brief = String(args.brief ?? "").trim();
    const place = String(args.place ?? "");
    if (!name || name.length > 60) throw new Error("name is what the app is called: a few words, up to 60 characters.");
    if (brief.length < 20 || brief.length > 2000) throw new Error("brief says what it does, what it reads and what it keeps, in a few sentences (up to 2,000 characters): the session that makes it reads nothing else.");
    if (place !== "dock" && place !== "tab" && place !== "page") throw new Error('place is "dock" (beside the session), "tab" (beside Chat) or "page" (a page of its own, from the left sidebar).');
    // What it touches, checked as a panel's manifest is.
    const m = checkManifest({ apiVersion: 1, id: "offer", kind: "panel", name, place, access: args.access ?? {} });
    const access = (m as { access: PanelAccess }).access;
    if (access.network && store.settings.addonNetwork === "never") throw new Error("The person set panels never to reach the internet (Settings › Add-ons): offer it without access.network.");
    const modelHost = modelHostRefusal(access.network);
    if (modelHost) throw new Error(modelHost);
    const seed = Array.isArray(args.initialContent) ? args.initialContent.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim().slice(0, 300)).slice(0, 40) : undefined;
    const turn = this.h.turnOf(threadId);
    const items = store.timeline(threadId);
    if (items.some((x) => x.kind === "offer" && x.turn === turn && x.state !== "replaced")) throw new Error("There's an offer in this turn already: one a turn.");
    for (const x of items) if (x.kind === "offer" && x.state === "proposed") store.putItem(threadId, { ...x, state: "replaced" });
    store.putItem(threadId, { kind: "offer", id: uid("it"), turn, at: Date.now(), name, brief, place, access, ...(seed?.length ? { seed } : {}), state: "proposed" });
    return `offered: a card for ${name} is at the end of your answer. The person may Create it (it's made in the background, and you hear nothing more of it), change where it goes, or say Not now. Don't make it yourself, and don't offer another this turn.`;
  }

  async answer(threadId: string, itemId: string, act: "create" | "dismiss" | "cancel" | "keep" | "undo" | "restore", place?: PanelPlace, custom?: string) {
    const store = this.h.store;
    const it = store.item(threadId, itemId);
    if (it.kind !== "offer") throw new Error("That isn't an offer.");
    const put = (p: Partial<Offer>) => store.putItem(threadId, { ...(store.item(threadId, itemId) as Offer), ...p });
    switch (act) {
      case "dismiss":
        if (it.state !== "proposed" && it.state !== "cancelled" && it.state !== "failed") throw new Error("It's past that.");
        return put({ state: "dismissed" });
      case "cancel":
        if (it.state !== "creating" || !it.child) throw new Error("It isn't being made.");
        this.making.delete(it.child);
        this.keep();
        this.h.stop(it.child);
        return put({ state: "cancelled" });
      case "keep":
        if (it.state !== "installed") throw new Error("There's nothing to keep yet.");
        return put({ state: "kept" });
      case "undo":
        if ((it.state !== "installed" && it.state !== "kept") || !it.addon) throw new Error("There's nothing to undo.");
        this.h.addons.update(it.addon, { removed: true });
        return put({ state: "removed" });
      case "restore":
        if (it.state !== "removed" || !it.addon) throw new Error("There's nothing to restore.");
        if (!this.h.addons.get(it.addon)) throw new Error("Its files are gone: ask for a new one.");
        this.h.addons.update(it.addon, { removed: false });
        return put({ state: "installed" });
      case "create":
        return this.create(threadId, it, place, custom);
    }
  }

  private async create(threadId: string, it: Offer, place?: PanelPlace, custom?: string) {
    const store = this.h.store;
    if (it.state !== "proposed" && it.state !== "cancelled" && it.state !== "failed") throw new Error("It's past that.");
    const words = custom?.trim();
    if (custom !== undefined && (!words || words.length > 1000)) throw new Error("Choose a place, or describe it in up to 1,000 characters.");
    if (this.h.readOnly(threadId)) throw new Error("This session is read-only. Switch its access to make apps.");
    const parent = store.thread(threadId);
    const id = it.addon ?? idFor(it.name, (x) => Boolean(this.h.addons.get(x)));
    const o: Offer = { ...it, place: place ?? it.place, ...(words ? { custom: words } : { custom: undefined }), addon: id };
    // Making an add-on is Workshop's work, whatever mode the session that offered it is in: its guide and Liner 2.0 come with it.
    const child = await this.h.createThread({ projectId: parent.projectId, agent: parent.agent, model: parent.model, title: `Make ${it.name}`, access: parent.access === "read" ? "edits" : parent.access, mode: "creator" });
    this.making.set(child.id, { threadId, itemId: it.id, id, started: false });
    this.keep();
    store.putItem(threadId, { ...o, state: "creating", child: child.id, error: undefined });
    try {
      await this.h.send(child.id, briefOf(o, id));
    } catch (e) {
      // Nothing is being made: the card says why, and Create is there again.
      this.making.delete(child.id);
      this.keep();
      store.putItem(threadId, { ...(store.item(threadId, it.id) as Offer), state: "failed", error: `It didn't start: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  /** A background session moved on: once its turn has run and ended, what it made is added, or it says why not. */
  private watch(t: Thread) {
    const m = this.making.get(t.id);
    if (!m) return;
    if (t.status === "running") {
      m.started = true;
      return;
    }
    if (!m.started || t.status === "waiting") return;
    this.making.delete(t.id);
    this.keep();
    const store = this.h.store;
    // Told from inside whatever changed this session (its turn ending): the session that offered it may be gone.
    const it = this.offerOf(m);
    if (!it || (it.state !== "creating" && it.state !== "installing")) return;
    if (t.status === "error" || t.status === "limited") return void store.putItem(m.threadId, { ...it, state: "failed", error: "Making it stopped with an error. Try again." });
    store.putItem(m.threadId, { ...it, state: "installing" });
    try {
      const { manifest, files } = readDraft(this.h.cwdOf(t.id), m.id);
      if (manifest.kind !== "panel") throw new Error("It made something that isn't a panel.");
      if (!it.custom && manifest.place !== it.place) throw new Error(`It made it for ${manifest.place === "page" ? "a page" : manifest.place === "tab" ? "a tab" : "the dock"}, not where you said.`);
      const more = widerAccess(it.access, manifest.access);
      if (more.length) throw new Error(`It asks for more than the card said (${more.join("; ").toLowerCase()}), so it wasn't added.`);
      // The setting may have changed while it was being made.
      if (manifest.access.network && store.settings.addonNetwork === "never") throw new Error(`It reaches ${manifest.access.network}, and panels may never reach the internet (Settings › Add-ons).`);
      const version = this.h.addons.install(manifest, { by: { agent: this.h.whoIs(t.id), threadId: t.id, title: t.title, at: Date.now() } }, files);
      store.putItem(m.threadId, { ...(store.item(m.threadId, m.itemId) as Offer), state: "installed", version, place: manifest.place, error: undefined });
    } catch (e) {
      store.putItem(m.threadId, { ...(store.item(m.threadId, m.itemId) as Offer), state: "failed", error: e instanceof Error ? e.message.replace(/^The manifest isn't right:\s*/, "Its manifest isn't right: ") : String(e) });
    }
  }
}
