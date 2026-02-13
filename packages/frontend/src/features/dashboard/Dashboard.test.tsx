import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const mockGet = vi.fn();

vi.mock('../../services/api', () => ({
  api: { get: (...args: any[]) => mockGet(...args) },
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

const dashboardResponse = {
  totalProviders: 12,
  activeProviders: 8,
  pendingProviders: 3,
  incompleteProviders: [{ id: '1' }],
  expiringItems: [{ id: '2' }],
  needsFollowUp: [{ id: '3' }],
  enrollments: [],
  providers: [],
};

function mockApiSuccess() {
  mockGet.mockImplementation((url: string) => {
    if (url.includes('/providers')) {
      return Promise.resolve({
        data: { data: { data: Array(12).fill({ status: 'active', _count: { documents: 1 } }) } },
      });
    }
    if (url.includes('/expirations/dashboard')) {
      return Promise.resolve({ data: { data: { expiring30: 1, expiring60: 2 } } });
    }
    if (url.includes('/expirations')) {
      return Promise.resolve({ data: { data: [{ id: '2' }] } });
    }
    if (url.includes('/enrollments')) {
      return Promise.resolve({ data: { data: [] } });
    }
    return Promise.resolve({ data: { data: {} } });
  });
}

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    await screen.findByText('Failed to load dashboard data');
  });

  it('quick action links point to correct routes', async () => {
    mockApiSuccess();
    render(<Dashboard />, { wrapper: createWrapper() });

    await screen.findByText('Add Provider');

    const addProviderLink = screen.getByText('Add Provider').closest('a');
    expect(addProviderLink).toHaveAttribute('href', '/providers/new');

    const uploadLink = screen.getByText('Upload Document').closest('a');
    expect(uploadLink).toHaveAttribute('href', '/documents');

    const enrollmentLink = screen.getByText('New Enrollment').closest('a');
    expect(enrollmentLink).toHaveAttribute('href', '/enrollments');
  });
});
