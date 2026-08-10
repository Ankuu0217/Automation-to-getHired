import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Root error boundary. Without one, any render-time crash unmounts the whole
 * tree and leaves a raw white screen with no way back (e.g. a stale frame
 * restored when returning from the external Gmail-OAuth redirect). This catches
 * the crash and offers a reload instead. Styles are inline so the fallback shows
 * even if a theme/provider is what threw.
 */
interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('Unhandled render error:', error, info.componentStack);
  }

  private reload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 20,
          background: '#222f30',
          color: '#e9ede9',
          fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
          padding: 24,
          textAlign: 'center',
        }}
      >
        <p style={{ margin: 0, fontSize: 18, fontWeight: 400 }}>Something went wrong.</p>
        <p style={{ margin: 0, fontSize: 14, opacity: 0.65, maxWidth: 360 }}>
          The page hit an unexpected error. Reloading usually fixes it.
        </p>
        <button
          type="button"
          onClick={this.reload}
          style={{
            marginTop: 4,
            padding: '10px 20px',
            fontSize: 14,
            fontFamily: 'inherit',
            color: '#222f30',
            background: '#cef79e',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}
