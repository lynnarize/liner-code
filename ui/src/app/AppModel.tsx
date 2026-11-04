/*
  A model in an app (access.ai): Liner Code's own popup, never the app's, where you pick which of
  your models an app may ask and allow it (DeepSeek Harness hands its plugins the host's model,
  ctx.llm, the same way: the plugin never holds a key). It's just a model: what the app sends in,
  text out, with no tools, files or agent, billed to that model's account. Only models that can
  answer that way are offered (plainWay): your API endpoints' and Claude Code's.

  pickAppModel opens it from anywhere (an app's first ask, liner.ai.pick, its strip) and resolves
  with the model allowed, or null; AppModelHost, in the window once, draws it. The choice is kept
  by the app's id in your settings (addonModels), so it holds through versions.
*/
import { useEffect, useMemo, useState } from "react";
import type { ProviderInfo, Settings } from "@contracts";
import { plainWay, splitModel } from "@contracts";
import { Dialog } from "@liner/components/dialog/dialog";
import { toast } from "@liner/components/toast/toast";
import { getState, rpc, useEngine } from "./engine";
import { I } from "./icons";
import { modelLabel } from "./model";
import { ModelPicker } from "./Models";

type Asking = { addon: string; name: string; done: Promise<string | null>; resolve: (ref: string | null) => void };
let open: Asking | null = null;
const ears = new Set<() => void>();
const tell = () => ears.forEach((f) => f());

/** Whether a model can answer an app now: its tool is ready, lists it, and asks it with no tools. */
export function appModelReady(ref: string | undefined, providers: ProviderInfo[], s: Pick<Settings, "endpoints" | "voucher">) {
  if (!ref) return false;
  const { provider, model } = splitModel(ref);
  const p = providers.find((x) => x.id === provider);
  return Boolean(p?.available && p.adapter && plainWay(p.id, s) && p.models.some((m) => m.id === model));
}

/** The model an app may ask, ready now; else undefined. */
export function appModelOf(addon: string) {
  const { settings, providers } = getState();
  const ref = settings.addonModels?.[addon];
  return appModelReady(ref, providers, settings) ? ref : undefined;
}

/** Opens the popup for an app (or joins the one open for it) and resolves with the model you allowed, or null. */
export function pickAppModel(addon: string, name: string): Promise<string | null> {
  if (open?.addon === addon) return open.done;
  // Another app's popup is up: that one is answered "not now" first.
  open?.resolve(null);
  let resolve!: (ref: string | null) => void;
  const done = new Promise<string | null>((r) => (resolve = r));
  const me: Asking = {
    addon,
    name,
    done,
    resolve: (ref) => {
      if (open === me) open = null;
      resolve(ref);
      tell();
    },
  };
  open = me;
  tell();
  return done;
}

/** The popup, drawn once in the window. */
export function AppModelHost() {
  const [, redraw] = useState(0);
  useEffect(() => {
    const f = () => redraw((n) => n + 1);
    ears.add(f);
    return () => void ears.delete(f);
  }, []);
  return open ? <AppModelDialog key={open.addon} asking={open} /> : null;
}

function AppModelDialog({ asking }: { asking: Asking }) {
  const settings = useEngine((s) => s.settings);
  const providers = useEngine((s) => s.providers);
  const had = settings.addonModels?.[asking.addon];
  const [pick, setPick] = useState<string | undefined>(() => (appModelReady(had, providers, settings) ? had : undefined));
  const [busy, setBusy] = useState(false);
  const endpoints = settings.endpoints;
  const voucher = settings.voucher;
  const only = useMemo(() => (p: ProviderInfo) => Boolean(plainWay(p.id, { endpoints, voucher })), [endpoints, voucher]);
  const any = providers.some((p) => p.available && p.adapter && p.models.length && only(p));
  const allow = async () => {
    if (!pick) return;
    setBusy(true);
    try {
      await rpc("settings.save", { addonModels: { ...(getState().settings.addonModels ?? {}), [asking.addon]: pick } });
      asking.resolve(pick);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && asking.resolve(null)}
      icon={<I.sparkle size={16} />}
      title={`${asking.name} wants to use a model`}
      description="Pick one of your models for it. It's just a model: it gets what the app sends and answers with text, with no tools, files or agent. Each ask is billed to that model's account."
      size="md"
      className="lc-appmodel"
      actions={
        <>
          <button type="button" className="lc-btn" data-kind="ghost" onClick={() => asking.resolve(null)}>
            Don't allow
          </button>
          <button type="button" className="lc-btn" data-kind="primary" disabled={!pick || busy} onClick={() => void allow()}>
            {pick ? `Allow ${modelLabel(pick, providers)}` : "Allow"}
          </button>
        </>
      }
    >
      {any ? (
        <ModelPicker value={pick} onPick={(ref) => setPick(ref)} only={only} height={300} autoFocus foot={<span className="lc-appmodel-foot">Models that only run through Codex, OpenCode or Hermes aren't here: those tools bring tools of their own, which an app must never reach.</span>} />
      ) : (
        <p className="lc-appmodel-none">None of your models can answer an app yet. Sign in to Claude Code, or add an API endpoint in Settings › Models, and it shows here.</p>
      )}
    </Dialog>
  );
}

/** On an app's strip: the model it asks, or a way to pick one, opening the popup. */
export function AppModelChip({ addon, name }: { addon: string; name: string }) {
  const ref = useEngine((s) => s.settings.addonModels?.[addon]);
  const providers = useEngine((s) => s.providers);
  const settings = useEngine((s) => s.settings);
  const ready = appModelReady(ref, providers, settings);
  return (
    <button type="button" className="lc-appmodel-chip l-focus" title={ready ? "The model this app asks. Change it" : "Pick the model this app may ask"} onClick={() => void pickAppModel(addon, name)}>
      <I.sparkle size={12} />
      {ref && ready ? modelLabel(ref, providers) : ref ? "Its model isn't ready" : "Pick a model"}
    </button>
  );
}
