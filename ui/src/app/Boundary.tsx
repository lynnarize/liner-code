/*
  A part of the app that broke says so in its own place, with a way to try again, instead of
  taking the whole window with it (T3 Code's RenderErrorBoundary does the same). The window, each
  turn of a thread and each surface in the panel stand behind one.
*/
import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode; label: string; quiet?: boolean };
type State = { error: Error | null };

export class Boundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[Liner Code] ${this.props.label} broke`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="lc-broke" role="alert" data-quiet={this.props.quiet || undefined}>
        <b>{this.props.label} couldn't show.</b>
        <span className="lc-quiet">{error.message || String(error)}</span>
        <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}
