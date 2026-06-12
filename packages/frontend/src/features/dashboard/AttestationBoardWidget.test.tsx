import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockGet = vi.fn();

vi.mock('../../services/api', () => ({
  api: { get: (...args: any[]) => mockGet(...args) },
}));

import AttestationBoardWidget from './AttestationBoardWidget';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

const board = {
  counts: { overdue: 1, dueSoon: 1, onTrack: 0, untracked: 0 },
  providers: [
    {
      providerId: 'p1',
      providerName: 'John Smith',
      practice: null,
      providerStatus: 'Expired Attestation',
      lastAttestationDate: null,
      nextDueDate: '2026-06-07T00:00:00.000Z',
      daysUntilDue: -5,
      diffVerdict: 'no_baseline',
      changedSections: [],
      bucket: 'overdue',
    },
    {
      providerId: 'p2',
      providerName: 'Jane Doe',
      practice: { id: 'pr1', name: 'Acme Health' },
      providerStatus: 'Re-Attestation',
      lastAttestationDate: '2026-04-22T00:00:00.000Z',
      nextDueDate: '2026-08-20T00:00:00.000Z',
      daysUntilDue: 10,
      diffVerdict: 'unchanged',
      changedSections: [],
      bucket: 'dueSoon',
    },
  ],
};

describe('AttestationBoardWidget', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('renders counts, urgency labels, and the diff verdict chips', async () => {
    mockGet.mockResolvedValue({ data: { success: true, data: board } });
    render(<AttestationBoardWidget />, { wrapper: createWrapper() });

    expect(await screen.findByText('John Smith')).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('1 overdue')).toBeInTheDocument();
    expect(screen.getByText('1 due soon')).toBeInTheDocument();
    expect(screen.getByText('5d overdue')).toBeInTheDocument();
    expect(screen.getByText('Due in 10d')).toBeInTheDocument();
    expect(screen.getByText('No changes')).toBeInTheDocument();
    expect(screen.getByText('First cycle')).toBeInTheDocument();
    expect(screen.getByText('Acme Health')).toBeInTheDocument();
  });

  it('shows the empty state when nothing is tracked', async () => {
    mockGet.mockResolvedValue({
      data: { success: true, data: { counts: { overdue: 0, dueSoon: 0, onTrack: 0, untracked: 0 }, providers: [] } },
    });
    render(<AttestationBoardWidget />, { wrapper: createWrapper() });

    expect(
      await screen.findByText(/No providers being tracked for re-attestation yet/),
    ).toBeInTheDocument();
  });
});
