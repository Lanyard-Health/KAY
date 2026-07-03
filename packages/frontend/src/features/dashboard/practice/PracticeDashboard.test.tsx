import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const mockGet = vi.fn();

vi.mock('../../../services/api', () => ({
  api: { get: (...args: any[]) => mockGet(...args) },
}));

const mockUseAuthStore = vi.fn();
vi.mock('../../../stores/auth.store', () => ({
  useAuthStore: () => mockUseAuthStore(),
}));

vi.mock('./PracticeCharts', () => ({
  default: () => <div data-testid="practice-charts" />,
}));

import PracticeDashboard from './PracticeDashboard';

const PAYLOAD = {
  tiles: { inProgress: 1, submitted: 2, approved: 3, approvedThisMonth: 1, runningLong: 0 },
  charts: { approvedByPayer: [], approvalsByMonth: [] },
  grid: { payers: [], rows: [] },
  inFlight: [],
  attention: [],
};

function renderWithClient(queryClient: QueryClient) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(<PracticeDashboard />, { wrapper: Wrapper });
}

describe('PracticeDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuthStore.mockReturnValue({
      user: { id: 'u1', role: 'practice_admin', firstName: 'Pat', practices: [] },
    });
  });

  it('shows the error card when the first load fails and there is no data', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithClient(queryClient);

    await screen.findByText("We couldn't load your dashboard right now.");
  });

  it('keeps the rendered dashboard when a background refetch fails', async () => {
    mockGet.mockRejectedValue(new Error('Network blip'));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Prime the cache as if a previous fetch succeeded, then let the
    // on-mount refetch fail.
    queryClient.setQueryData(['practice-dashboard'], PAYLOAD);
    renderWithClient(queryClient);

    await waitFor(() => {
      expect(queryClient.getQueryState(['practice-dashboard'])?.status).toBe('error');
    });

    expect(screen.queryByText("We couldn't load your dashboard right now.")).not.toBeInTheDocument();
    expect(screen.getByText('Submitted to payer')).toBeInTheDocument();
  });
});
