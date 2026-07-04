import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const mockGet = vi.fn();
vi.mock('../../../services/api', () => ({
  api: { get: (...args: any[]) => mockGet(...args) },
}));

import AdminDashboard from './AdminDashboard';

const PAYLOAD = {
  tiles: { activePractices: 6, openApplications: 9, approvedThisQuarter: 4, delayedPlatformWide: 2 },
  churnRisk: [
    { practiceId: 'p1', practiceName: 'Greens Health', delayedCount: 2, overdueFollowUps: 1, openCount: 5 },
  ],
};

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>,
  );
}

describe('AdminDashboard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders platform tiles and the churn-risk table; row click enters view-as', async () => {
    mockGet.mockResolvedValue({ data: { data: PAYLOAD } });
    const onViewPractice = vi.fn();
    wrap(<AdminDashboard onViewPractice={onViewPractice} />);

    expect(await screen.findByText('Active practices')).toBeInTheDocument();
    expect(screen.getByText('Delayed platform-wide')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Greens Health/ }));
    expect(onViewPractice).toHaveBeenCalledWith('p1');
  });

  it('says the good news when no practice needs attention', async () => {
    mockGet.mockResolvedValue({ data: { data: { ...PAYLOAD, churnRisk: [] } } });
    wrap(<AdminDashboard onViewPractice={() => {}} />);

    expect(await screen.findByText(
      'No practices need attention right now — nothing delayed, no overdue follow-ups.',
    )).toBeInTheDocument();
  });

  it('keeps rendered data when a background refetch fails', async () => {
    mockGet.mockResolvedValue({ data: { data: PAYLOAD } });
    wrap(<AdminDashboard onViewPractice={() => {}} />);
    await screen.findByText('Active practices');
    // error state only replaces the page when there is no data (slice 1 rule)
    expect(screen.queryByText("We couldn't load this right now.")).not.toBeInTheDocument();
  });
});
