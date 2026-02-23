async function sendBugReport(apiUrl: string, report: Record<string, unknown>): Promise<void> {
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
      try { await send(); } catch { console.warn('[BugMonitor] Failed to report error after retry'); }
    }, 5000);
  }
}

export function registerGlobalErrorHandlers(apiUrl: string): void {
  // Catch non-React JS errors
  window.addEventListener('error', (event) => {
    sendBugReport(apiUrl, {
      source: 'frontend-crash',
      title: `Window Error: ${event.message}`.substring(0, 200),
      errorMessage: event.message,
      errorClass: 'WindowError',
      stackTrace: event.error?.stack || `${event.filename}:${event.lineno}:${event.colno}`,
      metadata: {
        url: window.location.href,
        userAgent: navigator.userAgent,
        filename: event.filename || 'unknown',
        lineno: String(event.lineno),
        colno: String(event.colno),
      },
      environment: import.meta.env.MODE === 'production' ? 'production' : 'development',
    });
  });

  // Catch unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
    sendBugReport(apiUrl, {
      source: 'frontend-crash',
      title: `Unhandled Rejection: ${error.message}`.substring(0, 200),
      errorMessage: error.message,
      errorClass: 'UnhandledRejection',
      stackTrace: error.stack,
      metadata: {
        url: window.location.href,
        userAgent: navigator.userAgent,
      },
      environment: import.meta.env.MODE === 'production' ? 'production' : 'development',
    });
  });
}
