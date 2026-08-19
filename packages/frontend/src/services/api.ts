import { useAuthStore } from '../stores/auth.store';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api/v1';

// Check if dev bypass is enabled
const DEV_BYPASS_ENABLED = import.meta.env.VITE_DEV_AUTH_BYPASS === 'true';
const isDevelopment = import.meta.env.DEV;

// Single-flight guard so parallel 401s don't trigger multiple navigations.
let sessionExpiryHandled = false;

function handleSessionExpired(): void {
  if (sessionExpiryHandled) return;
  sessionExpiryHandled = true;

  // Flash flag picked up by LoginPage on mount.
  try {
    sessionStorage.setItem('flash:session-expired', '1');
  } catch {
    /* sessionStorage unavailable (private mode, etc.) — proceed anyway */
  }

  // Fire-and-forget; page is about to navigate.
  void useAuthStore.getState().logout();

  // Avoid loop if we're already on /login.
  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    window.location.replace('/login');
  }
}

// Single-flight, same reasoning as the 401 guard above.
let mfaRedirectHandled = false;

/**
 * The backend refuses the API to a signed-in user who has no second sign-in
 * factor and no skips left (mfaEnrollmentGate). Any request can be the one that
 * hits it, so the redirect lives here rather than in each caller.
 */
function handleMfaEnrollmentRequired(): void {
  if (mfaRedirectHandled) return;
  mfaRedirectHandled = true;

  if (typeof window !== 'undefined' && window.location.pathname !== '/mfa-setup') {
    window.location.replace('/mfa-setup');
  }
}

class ApiClient {
  private async getAuthToken(): Promise<string | null> {
    // In dev bypass mode, use the dev token
    if (DEV_BYPASS_ENABLED) {
      const devSession = localStorage.getItem('dev_session');
      return devSession ? 'dev-token' : null;
    }

    // Otherwise, get token from Amplify
    try {
      const { fetchAuthSession } = await import('aws-amplify/auth');
      const session = await fetchAuthSession();
      return session.tokens?.accessToken?.toString() || null;
    } catch {
      return null;
    }
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<{ data: T; status: number }> {
    const token = await this.getAuthToken();

    // In dev mode, pass the role header so backend knows which user to use
    const devRole = isDevelopment && DEV_BYPASS_ENABLED
      ? localStorage.getItem('dev_session')
      : null;

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(devRole && devRole !== 'true' && { 'X-Dev-Role': devRole }),
      ...options.headers,
    };

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });

    if (response.status === 401 && !DEV_BYPASS_ENABLED) {
      handleSessionExpired();
      throw new Error('Session expired');
    }

    const data = await response.json();

    // Checked before the generic error throw so every caller gets the redirect,
    // not just the ones that inspect the error body.
    if (response.status === 403 && data?.code === 'MFA_ENROLLMENT_REQUIRED') {
      handleMfaEnrollmentRequired();
    }

    if (!response.ok) {
      const error = new Error(data.error?.message || 'Request failed') as Error & {
        response?: { data: any; status: number };
      };
      error.response = { data, status: response.status };
      throw error;
    }

    return { data, status: response.status };
  }

  async get<T = any>(endpoint: string): Promise<{ data: T; status: number }> {
    return this.request<T>(endpoint, { method: 'GET' });
  }

  async post<T = any>(
    endpoint: string,
    body?: any
  ): Promise<{ data: T; status: number }> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async put<T = any>(
    endpoint: string,
    body?: any
  ): Promise<{ data: T; status: number }> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async patch<T = any>(
    endpoint: string,
    body?: any
  ): Promise<{ data: T; status: number }> {
    return this.request<T>(endpoint, {
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async delete<T = any>(endpoint: string): Promise<{ data: T; status: number }> {
    return this.request<T>(endpoint, { method: 'DELETE' });
  }

  /**
   * Upload a file via FormData. Omits Content-Type so the browser sets
   * the multipart boundary automatically.
   */
  async upload<T = any>(
    endpoint: string,
    formData: FormData
  ): Promise<{ data: T; status: number }> {
    const token = await this.getAuthToken();

    const devRole = isDevelopment && DEV_BYPASS_ENABLED
      ? localStorage.getItem('dev_session')
      : null;

    const headers: HeadersInit = {
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(devRole && devRole !== 'true' && { 'X-Dev-Role': devRole }),
    };

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (response.status === 401 && !DEV_BYPASS_ENABLED) {
      handleSessionExpired();
      throw new Error('Session expired');
    }

    const data = await response.json();

    if (!response.ok) {
      const error = new Error(data.error?.message || data.error || 'Upload failed') as Error & {
        response?: { data: any; status: number };
      };
      error.response = { data, status: response.status };
      throw error;
    }

    return { data, status: response.status };
  }

  /**
   * Download a file as text (e.g., CSV). Returns the raw response text
   * instead of parsing as JSON.
   */
  async download(endpoint: string): Promise<{ text: string; status: number; headers: Headers }> {
    const token = await this.getAuthToken();

    const devRole = isDevelopment && DEV_BYPASS_ENABLED
      ? localStorage.getItem('dev_session')
      : null;

    const reqHeaders: HeadersInit = {
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(devRole && devRole !== 'true' && { 'X-Dev-Role': devRole }),
    };

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'GET',
      headers: reqHeaders,
    });

    if (response.status === 401 && !DEV_BYPASS_ENABLED) {
      handleSessionExpired();
      throw new Error('Session expired');
    }

    if (!response.ok) {
      const errorText = await response.text();
      let message = 'Download failed';
      try {
        const errorData = JSON.parse(errorText);
        message = errorData.error?.message || errorData.error || message;
      } catch { /* not JSON */ }
      const error = new Error(message) as Error & {
        response?: { data: any; status: number };
      };
      error.response = { data: errorText, status: response.status };
      throw error;
    }

    return { text: await response.text(), status: response.status, headers: response.headers };
  }

  /**
   * Download a file as a Blob (binary-safe — e.g., PDF). Use `download()` for text.
   */
  async downloadBlob(endpoint: string): Promise<{ blob: Blob; status: number; headers: Headers }> {
    const token = await this.getAuthToken();

    const devRole = isDevelopment && DEV_BYPASS_ENABLED
      ? localStorage.getItem('dev_session')
      : null;

    const reqHeaders: HeadersInit = {
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(devRole && devRole !== 'true' && { 'X-Dev-Role': devRole }),
    };

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'GET',
      headers: reqHeaders,
    });

    if (response.status === 401 && !DEV_BYPASS_ENABLED) {
      handleSessionExpired();
      throw new Error('Session expired');
    }

    if (!response.ok) {
      const errorText = await response.text();
      let message = 'Download failed';
      let data: any = errorText;
      try {
        const errorData = JSON.parse(errorText);
        message = errorData.error?.message || errorData.error || message;
        data = errorData;
      } catch { /* not JSON */ }
      const error = new Error(message) as Error & {
        response?: { data: any; status: number };
      };
      error.response = { data, status: response.status };
      throw error;
    }

    return { blob: await response.blob(), status: response.status, headers: response.headers };
  }
}

export const api = new ApiClient();
