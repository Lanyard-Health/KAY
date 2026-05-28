import React from 'react';
import { Sentry } from '../utils/sentry';

interface Props {
  children: React.ReactNode;
  apiUrl: string;
}

interface State {
  hasError: boolean;
  reportedMessage: string | null;
}

export class BugReportingErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, reportedMessage: null };
  }

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Prevent reporting the same error multiple times
    if (this.state.reportedMessage === error.message) return;
    this.setState({ reportedMessage: error.message });

    // Surface React render crashes to Sentry alongside the existing bug-monitor
    // POST. Sentry init no-ops when VITE_SENTRY_DSN is unset (local dev), so this
    // is safe everywhere.
    Sentry.captureException(error, {
      tags: { source: 'react-error-boundary' },
      contexts: {
        react: { componentStack: (errorInfo.componentStack || '').substring(0, 2000) },
      },
    });

    const report = {
      source: 'frontend-crash',
      title: `React Error: ${error.message}`.substring(0, 200),
      errorMessage: error.message,
      errorClass: error.name,
      stackTrace: `${error.stack || ''}\n\nComponent Stack:${errorInfo.componentStack || ''}`,
      metadata: {
        url: window.location.href,
        userAgent: navigator.userAgent,
        componentStack: (errorInfo.componentStack || '').substring(0, 2000),
      },
      environment: import.meta.env.MODE === 'production' ? 'production' : 'development',
    };

    this.sendReport(report);
  }

  private async sendReport(report: Record<string, unknown>): Promise<void> {
    const { apiUrl } = this.props;

    const send = () => fetch(`${apiUrl}/bugs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    });

    try {
      const res = await send();
      if (!res.ok) throw new Error(`${res.status}`);
    } catch {
      // Retry once after 5 seconds
      setTimeout(async () => {
        try { await send(); } catch { console.warn('[BugMonitor] Failed to report React error after retry'); }
      }, 5000);
    }
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
          <div className="max-w-md w-full bg-white rounded-2xl shadow-lg border border-gray-200 p-8 text-center">
            <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-primary-50 flex items-center justify-center">
              <svg className="h-6 w-6 text-primary-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Something went wrong</h2>
            <p className="text-sm text-gray-500 mb-6">
              An unexpected error occurred. Please refresh the page to continue.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 transition-colors"
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
