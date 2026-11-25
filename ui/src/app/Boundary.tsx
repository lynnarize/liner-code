/*
  A part of the app that broke says so in its own place, with a way to try again, instead of
  taking the whole window with it (T3 Code's RenderErrorBoundary does the same). The window, each
  turn of a thread and each surface in the panel stand behind one, as do the paper's pages and the
  agent dialog. A part whose code didn't load (a chunk asked for as the engine restarts) says
  "Couldn't open this", and Try again asks for it again (early.ts).
*/
import { Component, type ErrorInfo, type ReactNode } from "react";
import { retryChunks } from "./early";
import { I } from "./icons";
import { PaneButton, PaneNote, usePaneFrame } from "./Pane";

type Props = {
  children: ReactNode;
  label: string;
  quiet?: boolean;
  /** Where it stands: in a page's place (centred in the paper), or over the window (for a dialog). In the flow when unset. */
  place?: "page" | "float";
  /** When this changes, a broken part tries again (the paper's page or session that shows). */
  resetKey?: unknown;
  /** False: nothing of it is on screen (a shut dialog), so a fault shows nothing; it tries again once it is shown. */
  shown?: boolean;
  /** A Close beside Try again, for a dialog. */
  onClose?: () => void;
};
type State = { error: Error | null };

/** The import of a part's code failed, as each browser words it. */
const unloaded = (e: Error) => /dynamically imported module|importing a module script failed|error loading dynamically imported|loading (css )?chunk/i.test(e.message || "");

export class Boundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[Liner Code] ${this.props.label} broke`, error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (!this.state.error) return;
    if (prev.resetKey !== this.props.resetKey || (prev.shown === false && this.props.shown !== false)) this.retry();
  }

  /** Shows the part again; a part whose code didn't load asks for it again (early.ts). */
  retry = () => {
    retryChunks();
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.shown === false) return null;
    const away = unloaded(error);
    return <Broke label={this.props.label} error={error} away={away} quiet={this.props.quiet} place={this.props.place} onRetry={this.retry} onClose={this.props.onClose} />;
  }
}

/**
  What a broken part shows. In a surface of the panel it is the one empty state every surface has (PaneNote: what
  broke, why, Try again), with no box, since a pane has none (F49); elsewhere the tinted notice in its place.
*/
function Broke({ label, error, away, quiet, place, onRetry, onClose }: { label: string; error: Error; away: boolean; quiet?: boolean; place?: Props["place"]; onRetry: () => void; onClose?: () => void }) {
  const { inPanel } = usePaneFrame();
  if (inPanel)
    return (
      <div className="lc-broke-pane" role="alert">
        <PaneNote icon={<I.alert size={16} />} title={away ? "Couldn't open this" : `${label} couldn't show`} action={<PaneButton onClick={onRetry}>Try again</PaneButton>}>
          {away ? `${label} didn't load, perhaps as Liner Code's engine restarted.` : error.message || String(error)}
        </PaneNote>
      </div>
    );
  return (
    <div className="lc-broke" role="alert" data-quiet={quiet || undefined} data-place={place} data-away={away || undefined}>
      <b>{away ? "Couldn't open this." : `${label} couldn't show.`}</b>
      <span className="lc-quiet">{away ? `${label} didn't load, perhaps as Liner Code's engine restarted.` : error.message || String(error)}</span>
      <span className="lc-broke-do">
        <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={onRetry}>
          Try again
        </button>
        {onClose && (
          <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={onClose}>
            Close
          </button>
        )}
      </span>
    </div>
  );
}
