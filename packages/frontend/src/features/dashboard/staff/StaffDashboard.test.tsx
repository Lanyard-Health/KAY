import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const mockGet = vi.fn();
vi.mock('../../../services/api', () => ({
  api: { get: (...args: any[]) => mockGet(...args) },
}));

vi.mock('../../../stores/auth.store', () => ({
  useAuthStore: () => ({ user: { id: 'u1', firstName: 'Sam', role: 'credentialing_staff' } }),
}));

// Recharts' ResponsiveContainer needs ResizeObserver, which jsdom lacks.
vi.mock('./StaffCharts', () => ({
  default: () => <div data-testid="staff-charts" />,
}));

import StaffDashboard from './StaffDashboard';

const PAYLOAD = {
  tiles: { submittedThisWeek: 3, needsFollowUp: 2, delayed: 1, inIntake: 4 },
  queue: [
    {
      enrollmentId: 'e-delayed', providerName: 'Dana Reyes', payerName: 'Aetna',
      practiceName: 'Greens Health', status: 'submitted', daysInStatus: 97,
      isDelayed: true, needsFollowUp: false, nextAction: 'Call payer rep — escalate', dueDate: null,
    },
    {
      enrollmentId: 'e-followup', providerName: 'Lee Park', payerName: 'Cigna',
      practiceName: null, status: 'in_progress', daysInStatus: 40,
      isDelayed: false, needsFollowUp: true, nextAction: 'Check status with payer', dueDate: '2026-06-30T00:00:00.000Z',
    },
  ],
  charts: {
    pipelineByStage: [
      { stage: 'intake', count: 4 }, { stage: 'in_progress', count: 2 },
      { stage: 'submitted', count: 3 }, { stage: 'pending_review', count: 1 },
      { stage: 'delayed', count: 1 },
    ],
    submissionsByWeek: [{ weekStart: '2026-06-29', count: 3 }],
  },
};

function wrap(children: ReactNode, queryClient?: QueryClient) {
  const qc = queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>,
  );
}

describe('StaffDashboard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the four staff tiles with values', async () => {
    mockGet.mockResolvedValue({ data: { data: PAYLOAD } });
    wrap(<StaffDashboard />);

    expect(await screen.findByText('Submitted this week')).toBeInTheDocument();
    // "Needs follow-up" also appears as a queue flag chip — assert at least the tile.
    expect(screen.getAllByText('Needs follow-up').length).toBeGreaterThan(0);
    expect(screen.getByText('Delayed past window')).toBeInTheDocument();
    expect(screen.getByText('In intake')).toBeInTheDocument();
    expect(screen.getAllByText('97').length).toBeGreaterThan(0); // queue row day count
  });

  it('renders queue rows with human status labels plus separate flag chips', async () => {
    mockGet.mockResolvedValue({ data: { data: PAYLOAD } });
    wrap(<StaffDashboard />);

    // Desktop table and small-screen cards both render in jsdom (CSS visibility
    // classes don't apply), so every row's text appears twice.
    await screen.findAllByText('Dana Reyes');
    // Status label and flag chip coexist — the flag never replaces the status.
    const statusLabels = screen.getAllByText('Submitted to payer');
    expect(statusLabels.length).toBeGreaterThan(0);
    expect(screen.getAllByText('Delayed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('In progress').length).toBeGreaterThan(0);
    // Raw enums never render.
    expect(screen.queryByText('pending_review')).not.toBeInTheDocument();
    expect(screen.queryByText('in_progress')).not.toBeInTheDocument();
    // Next actions are verb phrases.
    expect(screen.getAllByText('Call payer rep — escalate').length).toBeGreaterThan(0);
    // Null practice renders an em dash.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('celebrates an empty queue with the queue-clear copy', async () => {
    mockGet.mockResolvedValue({ data: { data: { ...PAYLOAD, queue: [] } } });
    wrap(<StaffDashboard />);

    expect(await screen.findByText('Queue clear. Nothing is delayed and no follow-ups are due.')).toBeInTheDocument();
    // Tiles still render their counts.
    expect(screen.getByText('Submitted this week')).toBeInTheDocument();
  });

  it('keeps the rendered dashboard when a background refetch fails', async () => {
    mockGet.mockRejectedValue(new Error('Network blip'));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(['staff-dashboard'], PAYLOAD);
    wrap(<StaffDashboard />, qc);

    await waitFor(() => {
      expect(qc.getQueryState(['staff-dashboard'])?.status).toBe('error');
    });
    expect(screen.queryByText("We couldn't load your work queue right now.")).not.toBeInTheDocument();
    expect(screen.getByText('Submitted this week')).toBeInTheDocument();
  });

  it('shows the error card when the first load fails', async () => {
    mockGet.mockRejectedValue(new Error('down'));
    wrap(<StaffDashboard />);

    expect(await screen.findByText("We couldn't load your work queue right now.")).toBeInTheDocument();
  });
});
