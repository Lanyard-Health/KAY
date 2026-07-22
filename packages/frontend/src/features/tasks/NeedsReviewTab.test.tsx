import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({ updateMutate: vi.fn() }));
vi.mock('../../hooks/useStaffTasks', () => ({
  useStaffTasks: vi.fn(() => ({
    data: {
      data: [
        { id: 't1', title: 'Follow Up — Molina Healthcare of Texas', status: 'IN_PROGRESS', priority: 'NORMAL',
          taskGroup: 'FOLLOW_UP', dueDate: new Date(Date.now() - 5 * 86_400_000).toISOString(), createdAt: '2026-07-01T00:00:00Z',
          assignedTo: { id: 'u2', firstName: 'Dana', lastName: 'Reyes' },
          overdueReason: 'Payer portal was down all week' },
        { id: 't2', title: 'Call Back — Aetna Better Health', status: 'PENDING', priority: 'NORMAL',
          taskGroup: 'CALL_BACK', dueDate: new Date(Date.now() - 2 * 86_400_000).toISOString(), createdAt: '2026-07-01T00:00:00Z',
          assignedTo: { id: 'u3', firstName: 'Marcus', lastName: 'Tate' },
          overdueReason: null },
      ],
      meta: { total: 2 },
    },
    isLoading: false, isError: false, refetch: vi.fn(),
  })),
  useReviewStats: vi.fn(() => ({ data: { needsReviewCount: 2, missedLast30: 7, mostMissedBy: { name: 'Dana Reyes', count: 4 }, slowestPayer: { name: 'Molina TX', count: 3 } } })),
  useUpdateStaffTask: vi.fn(() => ({ mutate: mocks.updateMutate, isPending: false })),
  useAssignees: vi.fn(() => ({ data: [{ id: 'u2', firstName: 'Dana', lastName: 'Reyes', role: 'lanyard_staff' }] })),
}));
vi.mock('../../utils/notify', () => ({ notify: { error: vi.fn(), success: vi.fn() } }));

import NeedsReviewTab from './NeedsReviewTab';
import { useStaffTasks } from '../../hooks/useStaffTasks';

describe('NeedsReviewTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the patterns strip with full programmatic names', () => {
    render(<MemoryRouter><NeedsReviewTab onOpenDetail={vi.fn()} /></MemoryRouter>);
    expect(screen.getByLabelText('Missed: 7 tasks in the last 30 days')).toBeInTheDocument();
    expect(screen.getByLabelText('Most missed by: Dana Reyes, 4 missed tasks in the last 30 days')).toBeInTheDocument();
    expect(screen.getByLabelText('Slowest payer: Molina TX, 3 missed tasks in the last 30 days')).toBeInTheDocument();
  });

  it('shows the reason chip, and the full-opacity Awaiting reason pending variant', () => {
    render(<MemoryRouter><NeedsReviewTab onOpenDetail={vi.fn()} /></MemoryRouter>);
    expect(screen.getByText('Reason: "Payer portal was down all week"')).toBeInTheDocument();
    expect(screen.getByText('Awaiting reason…')).toBeInTheDocument();
  });

  it('row actions carry the task identity in their accessible names; Close = SKIPPED', async () => {
    render(<MemoryRouter><NeedsReviewTab onOpenDetail={vi.fn()} /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'Close — Follow Up — Molina Healthcare of Texas' }));
    expect(mocks.updateMutate).toHaveBeenCalledWith(
      { taskId: 't1', data: { status: 'SKIPPED' } },
      expect.anything(),
    );
    expect(screen.getByRole('button', { name: 'New deadline — Call Back — Aetna Better Health' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reassign — Call Back — Aetna Better Health' })).toBeInTheDocument();
  });

  it('pluralizes the overdue count: "N days overdue" for N > 1', () => {
    render(<MemoryRouter><NeedsReviewTab onOpenDetail={vi.fn()} /></MemoryRouter>);
    // t1 is 5 days overdue, t2 is 2 days overdue
    expect(screen.getByText(/5 days overdue/)).toBeInTheDocument();
    expect(screen.getByText(/2 days overdue/)).toBeInTheDocument();
  });

  it('uses singular "1 day overdue" (not "1 days") when exactly one day past due', () => {
    vi.mocked(useStaffTasks).mockReturnValueOnce({
      data: {
        data: [
          { id: 't9', title: 'Escalation — Aetna', status: 'PENDING', priority: 'NORMAL',
            taskGroup: 'ESCALATION', dueDate: new Date(Date.now() - 1 * 86_400_000).toISOString(), createdAt: '2026-07-01T00:00:00Z',
            assignedTo: null, overdueReason: null },
        ],
        meta: { total: 1 },
      },
      isLoading: false, isError: false, refetch: vi.fn(),
    } as any);
    render(<MemoryRouter><NeedsReviewTab onOpenDetail={vi.fn()} /></MemoryRouter>);
    expect(screen.getByText(/1 day overdue/)).toBeInTheDocument();
    expect(screen.queryByText(/1 days overdue/)).not.toBeInTheDocument();
  });
});
