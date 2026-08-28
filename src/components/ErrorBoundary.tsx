import { Component, type ErrorInfo, type ReactNode } from 'react';

// Last-resort net so a render/effect throw shows a recoverable card instead of
// unmounting the whole app to a blank page.
type Props = { children: ReactNode };
type State = { error: Error | null };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="root toppad">
        <div className="panel">
          <div className="emoji">💥</div>
          <h1 style={{ marginBottom: 10 }}>Bir şeyler ters gitti</h1>
          <p className="panel-sub">
            Beklenmeyen bir hata oluştu. Sayfayı yenilemek çoğu zaman sorunu çözer.
          </p>
          <p className="panel-sub" style={{ fontFamily: 'var(--mono)', fontSize: 12, opacity: 0.7 }}>
            {this.state.error.message}
          </p>
          <button className="btn secondary" onClick={() => window.location.reload()}>
            Sayfayı Yenile
          </button>
        </div>
      </div>
    );
  }
}
