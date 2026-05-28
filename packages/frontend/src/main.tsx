import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import App from './App';
import './index.css';
import { validateEnv } from './utils/validateEnv';
import { BugReportingErrorBoundary } from './components/BugReportingErrorBoundary';
import { registerGlobalErrorHandlers } from './utils/global-error-handlers';

// Only configure AWS Amplify if not in dev bypass mode
const DEV_BYPASS_ENABLED = import.meta.env.VITE_DEV_AUTH_BYPASS === 'true';
const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID;
const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID;

const initApp = async () => {
  validateEnv();

  // Only load and configure Amplify when not in dev bypass mode
  if (!DEV_BYPASS_ENABLED && userPoolId && clientId) {
    const { Amplify } = await import('aws-amplify');
    Amplify.configure({
      Auth: {
        Cognito: {
          userPoolId,
          userPoolClientId: clientId,
          loginWith: {
            email: true,
          },
        },
      },
    });
  }

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000, // 5 minutes
        retry: 1,
      },
    },
  });

  const apiUrl = import.meta.env.VITE_API_URL || '/api/v1';
  registerGlobalErrorHandlers(apiUrl);

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <BugReportingErrorBoundary apiUrl={apiUrl}>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
            <Toaster
              position="top-right"
              toastOptions={{
                duration: 4000,
                // Default styling for raw toast.success / toast.error calls so they
                // render visibly. The `notify` helper uses toast.custom and passes
                // its own style override to render the branded Toast component
                // without this wrapper.
                style: {
                  background: '#fff',
                  color: '#111827',
                  border: '1px solid rgba(229, 231, 235, 0.6)',
                  boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
                  borderRadius: '0.75rem',
                  padding: '0.875rem 1rem',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                },
                success: { iconTheme: { primary: '#0A3D2E', secondary: '#fff' } },
                error: { iconTheme: { primary: '#dc2626', secondary: '#fff' } },
              }}
              containerStyle={{ top: 16, right: 16 }}
              gutter={8}
            />
          </BrowserRouter>
        </QueryClientProvider>
      </BugReportingErrorBoundary>
    </React.StrictMode>
  );
};

initApp();
