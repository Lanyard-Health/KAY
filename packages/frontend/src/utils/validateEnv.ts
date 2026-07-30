/**
 * Validates frontend environment variables at startup.
 * In production builds, blocks on critical misconfigurations.
 * In dev, logs warnings only.
 */
export function validateEnv(): void {
  const apiUrl = import.meta.env.VITE_API_URL;
  const devBypass = import.meta.env.VITE_DEV_AUTH_BYPASS;
  const cognitoPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID;
  const cognitoClientId = import.meta.env.VITE_COGNITO_CLIENT_ID;
  const isProd = import.meta.env.PROD;

  // VITE_API_URL, if set, must end with /api/v1
  if (apiUrl && !apiUrl.endsWith('/api/v1')) {
    console.warn(
      `[env] VITE_API_URL is set to "${apiUrl}" but does not end with /api/v1. ` +
        'In dev, leave VITE_API_URL unset; the Vite proxy handles forwarding. ' +
        'In production, set it to your backend URL with the /api/v1 suffix ' +
        '(e.g. https://your-backend.onrender.com/api/v1).',
    );
  }

  // Safety guard: dev bypass must never be active in a production build
  if (devBypass === 'true' && isProd) {
    throw new Error(
      '[SECURITY] VITE_DEV_AUTH_BYPASS=true in a production build! ' +
        'Auth is bypassed. Remove VITE_DEV_AUTH_BYPASS from your production environment.',
    );
  }

  // When not using dev bypass, Cognito vars are required
  if (devBypass !== 'true') {
    if (!cognitoPoolId || !cognitoClientId) {
      if (isProd) {
        throw new Error(
          '[env] Cognito config missing in production build. ' +
            'Set VITE_COGNITO_USER_POOL_ID and VITE_COGNITO_CLIENT_ID.',
        );
      }
      console.warn(
        '[env] VITE_DEV_AUTH_BYPASS is not "true", but Cognito config is missing. ' +
          'Set VITE_COGNITO_USER_POOL_ID and VITE_COGNITO_CLIENT_ID, ' +
          'or enable VITE_DEV_AUTH_BYPASS=true for local development.',
      );
    }
  }
}
