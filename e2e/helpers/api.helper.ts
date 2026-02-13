const BASE_URL = 'http://localhost:3002';

export async function apiRequest(endpoint: string, options: RequestInit = {}) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer dev-token',
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${options.method || 'GET'} ${endpoint} failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function getProviders() {
  return apiRequest('/api/v1/providers?pageSize=100');
}

let npiCounter = 1000000000;

export async function createTestProvider(overrides: Record<string, unknown> = {}) {
  const npi = String(npiCounter++);
  const payload = {
    npi,
    firstName: 'Test',
    lastName: `Provider${npi.slice(-4)}`,
    email: `test.provider.${npi.slice(-4)}@example.com`,
    phone: '(555) 555-0100',
    providerType: 'psychiatrist',
    dateOfBirth: '1980-01-15',
    gender: 'male',
    status: 'active',
    ...overrides,
  };
  return apiRequest('/api/v1/providers', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
