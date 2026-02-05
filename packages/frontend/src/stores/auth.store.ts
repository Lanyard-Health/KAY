import { create } from 'zustand';

// Check if dev bypass is enabled (works in both dev and production)
const DEV_BYPASS_ENABLED = import.meta.env.VITE_DEV_AUTH_BYPASS === 'true';
const API_BASE_URL = import.meta.env.VITE_API_URL || '/api/v1';

// Lazy load Amplify auth functions only when needed (not in dev bypass mode)
const getAmplifyAuth = async () => {
  const { fetchAuthSession, signIn, signOut } = await import('aws-amplify/auth');
  return { fetchAuthSession, signIn, signOut };
};

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'credentialing_staff' | 'provider';
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
  logout: () => Promise<void>;
  setUser: (user: User | null) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  token: null,
  error: null,
  isDevMode: DEV_BYPASS_ENABLED,

  checkAuth: async () => {
    try {
      set({ isLoading: true });

      // In dev bypass mode, check if we have a stored dev session
      if (DEV_BYPASS_ENABLED) {
        const devSession = localStorage.getItem('dev_session');
        if (devSession) {
          // Fetch user from API (backend will auto-authenticate in dev mode)
          const response = await fetch(`${API_BASE_URL}/users/me`);
          if (response.ok) {
            const { data } = await response.json();
            set({
              user: data,
              isAuthenticated: true,
              token: 'dev-token',
              isLoading: false,
            });
            return;
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

  // Development login bypass
  devLogin: async () => {
    if (!DEV_BYPASS_ENABLED) {
      throw new Error('Dev login only available when VITE_DEV_AUTH_BYPASS is enabled');
    }

    set({ isLoading: true, error: null });

    try {
      // Store dev session marker
      localStorage.setItem('dev_session', 'true');

      // Fetch user from API (backend auto-creates dev user)
      const response = await fetch(`${API_BASE_URL}/users/me`);

      if (response.ok) {
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

  login: async (email: string, password: string) => {
    try {
      set({ isLoading: true, error: null });

      const { signIn } = await getAmplifyAuth();
      await signIn({ username: email, password });
      await get().checkAuth();
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Login failed',
        isLoading: false,
      });
      throw error;
    }
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
