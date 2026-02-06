const API_BASE_URL = import.meta.env.VITE_API_URL || '/api/v1';

// Check if dev bypass is enabled
const DEV_BYPASS_ENABLED = import.meta.env.VITE_DEV_AUTH_BYPASS === 'true';
const isDevelopment = import.meta.env.DEV;

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

    const data = await response.json();

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
}

export const api = new ApiClient();
