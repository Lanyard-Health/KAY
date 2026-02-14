import { create } from 'zustand';

// Check if dev bypass is enabled (works in both dev and production)
const DEV_BYPASS_ENABLED = import.meta.env.VITE_DEV_AUTH_BYPASS === 'true';
const API_BASE_URL = import.meta.env.VITE_API_URL || '/api/v1';

// Lazy load Amplify auth functions only when needed (not in dev bypass mode)
const getAmplifyAuth = async () => {
  const { fetchAuthSession, signIn, signOut } = await import('aws-amplify/auth');
  return { fetchAuthSession, signIn, signOut };
};

/**
 * Fetch with retry for dev mode — retries on network errors and 503 (server starting).
 * Returns the response on success or non-retryable error, or null if all attempts fail.
 */
async function fetchWithDevRetry(
  url: string,
  headers: Record<string, string>,
  maxAttempts = 3,
  delayMs = 1000,
): Promise<Response | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(url, { headers });
      if (response.status !== 503) return response;
    } catch {
      // Network error — backend not reachable yet
    }
    if (attempt < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return null;
}

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'credentialing_staff' | 'provider' | 'practice_admin';
  providerId?: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  token: string | null;
  error: string | null;
  isDevMode: boolean;

  // Actions
  checkAuth: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  devLogin: () => Promise<void>;
  devProviderLogin: () => Promise<void>;
  devPracticeAdminLogin: () => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: User | null) => void;

  // Challenge flow
  challengeName: string | null;
  challengeSession: any | null;
  challengeEmail: string | null;
  challengeMissingAttributes: string[];
  handleNewPasswordChallenge: (newPassword: string) => Promise<void>;
  handleMfaChallenge: (code: string) => Promise<void>;
  handleMfaSetup: () => Promise<{ qrUri: string; secretCode: string }>;
  confirmMfaSetup: (code: string) => Promise<void>;
  forgotPassword: (email: string) => Promise<void>;
  confirmForgotPassword: (email: string, code: string, newPassword: string) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  token: null,
  error: null,
  isDevMode: DEV_BYPASS_ENABLED,
  challengeName: null,
  challengeSession: null,
  challengeEmail: null,
  challengeMissingAttributes: [],

  checkAuth: async () => {
    try {
      set({ isLoading: true });

      // In dev bypass mode, check if we have a stored dev session
      if (DEV_BYPASS_ENABLED) {
        const devSession = localStorage.getItem('dev_session');
        if (devSession) {
          const headers: Record<string, string> = {
            Authorization: 'Bearer dev-token',
          };
          if (devSession && devSession !== 'true') {
            headers['X-Dev-Role'] = devSession;
          }

          const response = await fetchWithDevRetry(`${API_BASE_URL}/users/me`, headers);

          if (response?.ok) {
            const { data } = await response.json();
            set({
              user: data,
              isAuthenticated: true,
              token: 'dev-token',
              isLoading: false,
            });
            return;
          }

          // Stale session recovery: re-authenticate using the stored role
          if (devSession === 'provider') {
            try {
              await get().devProviderLogin();
              return;
            } catch {
              // Recovery failed — fall through to unauthenticated state
            }
          } else if (devSession === 'practice_admin') {
            try {
              await get().devPracticeAdminLogin();
              return;
            } catch {
              // Recovery failed — fall through to unauthenticated state
            }
          } else {
            try {
              await get().devLogin();
              return;
            } catch {
              // Recovery failed — fall through to unauthenticated state
            }
          }
        }
        set({
          user: null,
          isAuthenticated: false,
          token: null,
          isLoading: false,
        });
        return;
      }

      // Normal Cognito auth flow
      const { fetchAuthSession } = await getAmplifyAuth();
      const session = await fetchAuthSession();

      if (session.tokens?.accessToken) {
        const token = session.tokens.accessToken.toString();

        // Fetch user details from our API
        const response = await fetch(`${API_BASE_URL}/users/me`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (response.ok) {
          const { data } = await response.json();
          set({
            user: data,
            isAuthenticated: true,
            token,
            isLoading: false,
          });
        } else {
          set({
            user: null,
            isAuthenticated: false,
            token: null,
            isLoading: false,
          });
        }
      } else {
        set({
          user: null,
          isAuthenticated: false,
          token: null,
          isLoading: false,
        });
      }
    } catch (error) {
      set({
        user: null,
        isAuthenticated: false,
        token: null,
        isLoading: false,
      });
    }
  },

  // Development admin login bypass
  devLogin: async () => {
    if (!DEV_BYPASS_ENABLED) {
      throw new Error('Dev login only available when VITE_DEV_AUTH_BYPASS is enabled');
    }

    set({ isLoading: true, error: null });

    try {
      localStorage.setItem('dev_session', 'admin');

      // Fetch user from API with retry (backend may still be starting)
      const response = await fetchWithDevRetry(
        `${API_BASE_URL}/users/me`,
        { Authorization: 'Bearer dev-token' },
      );

      if (response?.ok) {
        const { data } = await response.json();
        set({
          user: data,
          isAuthenticated: true,
          token: 'dev-token',
          isLoading: false,
        });
      } else {
        throw new Error('Failed to fetch dev user');
      }
    } catch (error) {
      localStorage.removeItem('dev_session');
      set({
        error: error instanceof Error ? error.message : 'Dev login failed',
        isLoading: false,
      });
      throw error;
    }
  },

  // Development provider login bypass
  devProviderLogin: async () => {
    if (!DEV_BYPASS_ENABLED) {
      throw new Error('Dev login only available when VITE_DEV_AUTH_BYPASS is enabled');
    }

    set({ isLoading: true, error: null });

    try {
      localStorage.setItem('dev_session', 'provider');

      const response = await fetchWithDevRetry(
        `${API_BASE_URL}/users/me`,
        {
          Authorization: 'Bearer dev-token',
          'X-Dev-Role': 'provider',
        },
      );

      if (response?.ok) {
        const { data } = await response.json();
        set({
          user: data,
          isAuthenticated: true,
          token: 'dev-token',
          isLoading: false,
        });
      } else {
        throw new Error('Failed to fetch dev provider user');
      }
    } catch (error) {
      localStorage.removeItem('dev_session');
      set({
        error: error instanceof Error ? error.message : 'Dev provider login failed',
        isLoading: false,
      });
      throw error;
    }
  },

  // Development practice admin login bypass
  devPracticeAdminLogin: async () => {
    if (!DEV_BYPASS_ENABLED) {
      throw new Error('Dev login only available when VITE_DEV_AUTH_BYPASS is enabled');
    }

    set({ isLoading: true, error: null });

    try {
      localStorage.setItem('dev_session', 'practice_admin');

      const response = await fetchWithDevRetry(
        `${API_BASE_URL}/users/me`,
        {
          Authorization: 'Bearer dev-token',
          'X-Dev-Role': 'practice_admin',
        },
      );

      if (response?.ok) {
        const { data } = await response.json();
        set({
          user: data,
          isAuthenticated: true,
          token: 'dev-token',
          isLoading: false,
        });
      } else {
        throw new Error('Failed to fetch dev practice admin user');
      }
    } catch (error) {
      localStorage.removeItem('dev_session');
      set({
        error: error instanceof Error ? error.message : 'Dev practice admin login failed',
        isLoading: false,
      });
      throw error;
    }
  },

  login: async (email: string, password: string) => {
    try {
      set({ isLoading: true, error: null, challengeName: null });

      if (DEV_BYPASS_ENABLED) {
        // Dev mode doesn't use Amplify signIn
        await get().checkAuth();
        return;
      }

      const { signIn, signOut } = await getAmplifyAuth();
      // Clear any stale session before attempting login
      try { await signOut(); } catch { /* no existing session */ }
      const result = await signIn({ username: email, password });

      if (result.nextStep) {
        const step = result.nextStep.signInStep;

        if (step === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
          const missing = (result.nextStep as any).missingAttributes || [];
          set({
            challengeName: 'NEW_PASSWORD_REQUIRED',
            challengeSession: result,
            challengeEmail: email,
            challengeMissingAttributes: missing,
            isLoading: false,
          });
          return;
        }

        if (step === 'CONFIRM_SIGN_IN_WITH_TOTP_CODE') {
          set({
            challengeName: 'MFA_TOTP',
            challengeSession: result,
            isLoading: false,
          });
          return;
        }

        if (step === 'CONTINUE_SIGN_IN_WITH_TOTP_SETUP') {
          set({
            challengeName: 'MFA_SETUP',
            challengeSession: result,
            isLoading: false,
          });
          return;
        }

        if (step === 'DONE') {
          await get().checkAuth();
          return;
        }
      }

      await get().checkAuth();
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Login failed',
        isLoading: false,
      });
      throw error;
    }
  },

  handleNewPasswordChallenge: async (newPassword: string) => {
    try {
      set({ isLoading: true, error: null });
      const { confirmSignIn } = await import('aws-amplify/auth');
      const email = get().challengeEmail || '';
      const missing = get().challengeMissingAttributes;

      // Build userAttributes only for what Cognito says is missing
      const userAttributes: Record<string, string> = {};
      if (missing.length > 0 && email.includes('@')) {
        if (missing.includes('email')) userAttributes.email = email;
        if (missing.includes('name')) userAttributes.name = email.split('@')[0];
        if (missing.includes('given_name')) userAttributes.given_name = email.split('@')[0];
        if (missing.includes('family_name')) userAttributes.family_name = '';
      }

      const result = await confirmSignIn({
        challengeResponse: newPassword,
        ...(Object.keys(userAttributes).length > 0 && {
          options: { userAttributes },
        }),
      });

      if (result.nextStep?.signInStep === 'DONE') {
        set({ challengeName: null, challengeSession: null, challengeEmail: null, challengeMissingAttributes: [] });
        await get().checkAuth();
      } else if (result.nextStep?.signInStep === 'CONTINUE_SIGN_IN_WITH_TOTP_SETUP') {
        set({
          challengeName: 'MFA_SETUP',
          challengeSession: result,
          isLoading: false,
        });
      } else {
        set({ challengeName: null, challengeSession: null, challengeEmail: null, challengeMissingAttributes: [] });
        await get().checkAuth();
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to set new password',
        isLoading: false,
      });
      throw error;
    }
  },

  handleMfaChallenge: async (code: string) => {
    try {
      set({ isLoading: true, error: null });
      const { confirmSignIn } = await import('aws-amplify/auth');
      await confirmSignIn({ challengeResponse: code });
      set({ challengeName: null, challengeSession: null });
      await get().checkAuth();
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Invalid MFA code',
        isLoading: false,
      });
      throw error;
    }
  },

  handleMfaSetup: async () => {
    const { setUpTOTP } = await import('aws-amplify/auth');
    const totpSetup = await setUpTOTP();
    const qrUri = totpSetup.getSetupUri('LanyardHealth').toString();
    const secretCode = totpSetup.sharedSecret;
    return { qrUri, secretCode };
  },

  confirmMfaSetup: async (code: string) => {
    try {
      set({ isLoading: true, error: null });
      const { verifyTOTPSetup, confirmSignIn } = await import('aws-amplify/auth');
      await verifyTOTPSetup({ code });

      const state = get();
      if (state.challengeName === 'MFA_SETUP') {
        try {
          await confirmSignIn({ challengeResponse: code });
        } catch {
          // May already be confirmed
        }
      }

      set({ challengeName: null, challengeSession: null });
      await get().checkAuth();
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'MFA setup failed',
        isLoading: false,
      });
      throw error;
    }
  },

  forgotPassword: async (email: string) => {
    const { resetPassword } = await import('aws-amplify/auth');
    await resetPassword({ username: email });
  },

  confirmForgotPassword: async (email: string, code: string, newPassword: string) => {
    const { confirmResetPassword } = await import('aws-amplify/auth');
    await confirmResetPassword({ username: email, confirmationCode: code, newPassword });
  },

  logout: async () => {
    try {
      // Clear dev session if in dev mode
      if (DEV_BYPASS_ENABLED) {
        localStorage.removeItem('dev_session');
      } else {
        const { signOut } = await getAmplifyAuth();
        await signOut();
      }

      set({
        user: null,
        isAuthenticated: false,
        token: null,
      });
    } catch (error) {
      console.error('Logout error:', error);
    }
  },

  setUser: (user) => {
    set({ user, isAuthenticated: !!user });
  },
}));

// Initialize auth check on app load (wrapped in try-catch to prevent crashes)
try {
  useAuthStore.getState().checkAuth();
} catch (e) {
  console.error('Auth init error:', e);
}
