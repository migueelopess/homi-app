import React from 'react';

// Catches a crash inside a page and offers a way out.
//
// Without one, a single thrown render leaves a blank white screen with no
// controls at all — the only escape is force-closing the app, which is exactly
// the experience this app keeps trying to avoid. "Tentar novamente" re-mounts
// the page; "Recarregar" does a full reload for when the code itself is stale.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Page crashed:', error, info?.componentStack);
  }

  componentDidUpdate(prevProps) {
    // A new route is a fresh chance: clear the error so navigating away from a
    // broken page works instead of showing the same message forever.
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="max-w-lg mx-auto px-6 pt-20 flex flex-col items-center text-center">
        <div className="w-20 h-20 rounded-full bg-destructive/10 flex items-center justify-center mb-4 text-4xl">
          😵
        </div>
        <h2 className="text-xl font-bold text-foreground mb-2">Algo correu mal</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Esta página não conseguiu abrir. Tenta outra vez — não perdeste nada.
        </p>
        <button
          onClick={() => this.setState({ error: null })}
          className="w-full max-w-xs py-3.5 rounded-2xl bg-primary text-primary-foreground font-bold text-sm active:scale-[0.98] transition-transform"
        >
          Tentar novamente
        </button>
        <button
          onClick={() => window.location.reload()}
          className="w-full max-w-xs py-3 mt-2 rounded-2xl bg-muted text-muted-foreground font-medium text-sm"
        >
          Recarregar a app
        </button>
      </div>
    );
  }
}
