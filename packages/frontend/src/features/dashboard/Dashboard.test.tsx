import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const mockGet = vi.fn();

vi.mock('../../services/api', () => ({
  api: { get: (...args: any[]) => mockGet(...args) },
}));

const mockUseAuthStore = vi.fn();
vi.mock('../../stores/auth.store', () => ({
  useAuthStore: () => mockUseAuthStore(),
}));

vi.mock('./practice/PracticeDashboard', () => ({
  default: () => <div data-testid="practice-dashboard" />,
}));

vi.mock('./admin/AdminDashboard', () => ({
  default: () => <div data-testid="admin-dashboard" />,
}));

vi.mock('./admin/ViewAsBar', () => ({
  default: () => <div data-testid="view-as-bar" />,
}));

vi.mock('../../hooks/usePractices', () => ({
  usePractices: () => ({ data: [{ id: 'p1', name: 'Greens Health' }] }),
}));

import Dashboard from './Dashboard';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  };
}

function createQueryOnlyWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function mockApiSuccess() {
  mockGet.mockImplementation((url: string) => {
    if (url.includes('/dashboard/stats')) {
      return Promise.resolve({
        data: {
          data: {
            totalProviders: 12,
            activeProviders: 8,
            pendingProviders: 3,
            incompleteProviders: [],
            incompleteCount: 0,
            needsFollowUp: [],
            followUpCount: 0,
          },
        },
      });
    }
    if (url.includes('/expirations/dashboard')) {
      return Promise.resolve({ data: { data: { expiring30: 1, expiring60: 2 } } });
    }
    if (url.includes('/expirations')) {
      return Promise.resolve({ data: { data: [{ id: '2' }] } });
    }
    return Promise.resolve({ data: { data: {} } });
  });
}

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuthStore.mockReturnValue({
      user: { id: 'u1', role: 'admin', email: 'admin@test.com', practices: [] },
    });
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
      clear: () => {
        Object.keys(store).forEach((k) => delete store[k]);
      },
      key: (i: number) => Object.keys(store)[i] ?? null,
      get length() {
        return Object.keys(store).length;
      },
    });
  });

  it('shows loading state initially', () => {
    mockGet.mockReturnValue(new Promise(() => {})); // never resolves
    render(<Dashboard />, { wrapper: createWrapper() });

    // Stats show '-' while loading
    const dashes = screen.getAllByText('-');
    expect(dashes.length).toBeGreaterThan(0);
  });

  it('renders stats after data loads', async () => {
    mockApiSuccess();
    render(<Dashboard />, { wrapper: createWrapper() });

    await screen.findByText('Welcome to Lanyard Health');
    // Verify quick action links
    expect(screen.getByText('Add Provider')).toBeInTheDocument();
    expect(screen.getByText('Upload Document')).toBeInTheDocument();
    expect(screen.getByText('New Enrollment')).toBeInTheDocument();
  });

  it('renders error state on failure', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    render(<Dashboard />, { wrapper: createWrapper() });

    await screen.findByText("Couldn't load dashboard");
  });

  it('quick action links point to correct routes', async () => {
    mockApiSuccess();
    render(<Dashboard />, { wrapper: createWrapper() });

    await screen.findAllByText('Add Provider');

    const addProviderLink = screen.getAllByText('Add Provider')[0]?.closest('a');
    expect(addProviderLink).toHaveAttribute('href', '/providers/new');

    const uploadLink = screen.getAllByText('Upload Document')[0]?.closest('a');
    expect(uploadLink).toHaveAttribute('href', '/documents');

    const enrollmentLink = screen.getAllByText('New Enrollment')[0]?.closest('a');
    expect(enrollmentLink).toHaveAttribute('href', '/enrollments');
  });

  it('renders the practice_admin transparency dashboard for practice_admin role', async () => {
    mockUseAuthStore.mockReturnValue({
      user: { id: 'u2', role: 'practice_admin', email: 'pa@test.com', practices: [] },
    });
    mockApiSuccess();
    render(<Dashboard />, { wrapper: createWrapper() });

    expect(await screen.findByTestId('practice-dashboard')).toBeInTheDocument();
  });

  it('renders ViewAsBar + AdminDashboard for admin role', async () => {
    mockUseAuthStore.mockReturnValue({
      user: { id: 'u3', role: 'admin', email: 'kay@lanyardhealth.com', practices: [] },
    });
    mockApiSuccess();
    render(<Dashboard />, { wrapper: createWrapper() });
    expect(await screen.findByTestId('view-as-bar')).toBeInTheDocument();
    expect(await screen.findByTestId('admin-dashboard')).toBeInTheDocument();
  });

  it('renders the practice dashboard read-only when ?viewAs= is set', async () => {
    mockUseAuthStore.mockReturnValue({
      user: { id: 'u3', role: 'admin', email: 'kay@lanyardhealth.com', practices: [] },
    });
    mockApiSuccess();
    render(
      <MemoryRouter initialEntries={['/?viewAs=p1']}><Dashboard /></MemoryRouter>,
      { wrapper: createQueryOnlyWrapper() }, // wrapper WITHOUT its own MemoryRouter
    );
    expect(await screen.findByTestId('practice-dashboard')).toBeInTheDocument();
    expect(screen.queryByTestId('admin-dashboard')).not.toBeInTheDocument();
  });
});
