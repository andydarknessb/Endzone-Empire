import React from 'react';
import { captureBrowserError } from '../../monitoring/sentry';

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    captureBrowserError(error, { componentStack: info.componentStack });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main role="alert" style={{ maxWidth: 640, margin: '4rem auto', padding: '1.5rem' }}>
        <h1>Endzone Empire hit an unexpected error</h1>
        <p>The error was reported. Reload the app to try again.</p>
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </main>
    );
  }
}

export default AppErrorBoundary;
