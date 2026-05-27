import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const logoutMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../stores/auth.store', () => ({
  useAuthStore: {
    getState: () => ({ logout: logoutMock }),
  },
}));

describe('api 401 handling', () => {
  let originalLocation: Location;
  let replaceMock: ReturnType<typeof vi.fn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    logoutMock.mockClear();

    vi.stubEnv('VITE_DEV_AUTH_BYPASS', 'false');

    replaceMock = vi.fn();
    originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        pathname: '/dashboard',
        replace: replaceMock,
      },
    });

    sessionStorage.clear();

    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('redirects to /login and sets a flash flag when request() gets 401', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'Unauthorized' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const { api } = await import('./api');

    await expect(api.get('/anything')).rejects.toThrow(/session expired/i);

    expect(replaceMock).toHaveBeenCalledWith('/login');
    expect(logoutMock).toHaveBeenCalled();
    expect(sessionStorage.getItem('flash:session-expired')).toBe('1');
  });

  it('redirects when upload() gets 401', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const { api } = await import('./api');

    await expect(api.upload('/upload', new FormData())).rejects.toThrow(/session expired/i);
    expect(replaceMock).toHaveBeenCalledWith('/login');
  });

  it('redirects when download() gets 401', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }));

    const { api } = await import('./api');

    await expect(api.download('/file.csv')).rejects.toThrow(/session expired/i);
    expect(replaceMock).toHaveBeenCalledWith('/login');
  });

  it('redirects when downloadBlob() gets 401', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }));

    const { api } = await import('./api');

    await expect(api.downloadBlob('/file.pdf')).rejects.toThrow(/session expired/i);
    expect(replaceMock).toHaveBeenCalledWith('/login');
  });

  it('does not redirect when DEV_AUTH_BYPASS is enabled', async () => {
    vi.stubEnv('VITE_DEV_AUTH_BYPASS', 'true');
    // Dev bypass branch reads localStorage for the dev session token; ensure it's queryable.
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => 'admin'),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'Unauthorized' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const { api } = await import('./api');

    await expect(api.get('/anything')).rejects.toThrow(/Unauthorized/);
    expect(replaceMock).not.toHaveBeenCalled();
    expect(logoutMock).not.toHaveBeenCalled();
  });

  it('does not redirect on non-401 errors', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'Server boom' } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const { api } = await import('./api');

    await expect(api.get('/anything')).rejects.toThrow(/Server boom/);
    expect(replaceMock).not.toHaveBeenCalled();
    expect(logoutMock).not.toHaveBeenCalled();
  });

  it('does not redirect if already on /login (avoids loop)', async () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { pathname: '/login', replace: replaceMock },
    });

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'Unauthorized' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const { api } = await import('./api');

    await expect(api.get('/anything')).rejects.toThrow(/session expired/i);
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
