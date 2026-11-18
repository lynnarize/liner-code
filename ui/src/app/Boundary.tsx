/*
  A part of the app that broke says so in its own place, with a way to try again, instead of
  taking the whole window with it (T3 Code's RenderErrorBoundary does the same). The window, each
  turn of a thread and each surface in the panel stand behind one, as do the paper's pages and the
  agent dialog. A part whose code didn't load (a chunk asked for as the engine restarts) says
  "Couldn't open this", and Try again asks for it again (early.ts).
*/
import { Component, type ErrorInfo, type ReactNode } from "react";
import { retryChunks } from "./early";

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
    return (
      <div className="lc-broke" role="alert" data-quiet={this.props.quiet || undefined} data-place={this.props.place} data-away={away || undefined}>
        <b>{away ? "Couldn't open this." : `${this.props.label} couldn't show.`}</b>
        <span className="lc-quiet">{away ? `${this.props.label} didn't load, perhaps as Liner Code's engine restarted.` : error.message || String(error)}</span>
        <span className="lc-broke-do">
          <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={this.retry}>
            Try again
          </button>
          {this.props.onClose && (
            <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={this.props.onClose}>
              Close
            </button>
          )}
        </span>
      </div>
    );
  }
}
