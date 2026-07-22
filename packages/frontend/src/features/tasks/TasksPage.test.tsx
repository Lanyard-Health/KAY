import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../stores/auth.store', () => ({
  useAuthStore: vi.fn((sel: any) => sel({ user: { id: 'u1', role: 'admin' } })),
}));
import { useAuthStore } from '../../stores/auth.store';

vi.mock('../../hooks/useStaffTasks', () => ({
  useStaffTasks: vi.fn(() => ({
    data: {
      data: [
        {
          id: 't1',
          title: 'Follow Up — Aetna Better Health',
          status: 'IN_PROGRESS',
          priority: 'URGENT',
          dueDate: '2026-07-12T00:00:00Z',
          createdAt: '2026-07-10T00:00:00Z',
          taskGroup: 'FOLLOW_UP',
          payer: { id: 'p1', name: 'Aetna Better Health', phone: '(800) 555-0100', contactInfo: { phone: '(800) 555-0142' } },
          assignedTo: { id: 'u1', firstName: 'Kay', lastName: 'Ward' },
        },
        {
          id: 't2',
          title: 'Verify NPI for Dr. Lee',
          status: 'PENDING',
          priority: 'NORMAL',
          dueDate: null,
          createdAt: '2026-07-02T00:00:00Z',
          assignedTo: null,
        },
      ],
      meta: { total: 2 },
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })),
  useTaskCounts: vi.fn(() => ({ data: { open: 1, overdue: 1 } })),
  useAssignees: vi.fn(() => ({ data: [] })),
  useClaimTask: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateStaffTask: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useCreateStaffTask: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useDeleteTask: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  usePayerContactInfo: vi.fn(() => ({ data: null, isLoading: false, isError: false })),
  useSavePayerContactInfo: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useReviewStats: vi.fn(() => ({ data: { needsReviewCount: 3, missedLast30: 0, mostMissedBy: null, slowestPayer: null } })),
  useMyOverdueUnanswered: vi.fn(() => ({ data: [], isSuccess: true, isError: false })),
}));

vi.mock('./NewTaskModal', () => ({
  default: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div data-testid="new-task-modal" /> : null),
}));

import { useStaffTasks, useMyOverdueUnanswered } from '../../hooks/useStaffTasks';
import TasksPage from './TasksPage';

function renderPage(initialEntries = ['/tasks']) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <TasksPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TasksPage', () => {
  beforeEach(() => {
    vi.mocked(useStaffTasks).mockRestore();
    // Shortcut-off toggle (Task 13) reads/writes localStorage on mount; stub
    // it the same way Dashboard.test.tsx does, since the local Node runtime's
    // built-in global `localStorage` stub has no-op methods.
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

  it('renders tabs and an urgent overdue task', () => {
    renderPage();
    expect(screen.getByRole('tab', { name: /my tasks/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /task pool/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /all tasks/i })).toBeInTheDocument();
    expect(screen.getByText('Follow Up — Aetna Better Health')).toBeInTheDocument();
    expect(screen.getByText(/overdue/i)).toBeInTheDocument();
  });

  it('deep link (?taskId=) switches to the All Tasks tab so the task can be found regardless of which view it lives in', () => {
    renderPage(['/tasks?taskId=t1']);
    const allTasksTab = screen.getByRole('tab', { name: /all tasks/i });
    expect(allTasksTab).toHaveAttribute('aria-selected', 'true');
  });

  it('a second deep link within the same mount re-forces the All Tasks tab (refs are keyed to the taskId, not latched forever)', async () => {
    // Drives a second in-app navigation (e.g. clicking another task
    // notification without leaving the page) inside the same MemoryRouter.
    function DeepLinkDriver() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate('/tasks?taskId=t2')}>
          go-to-t2
        </button>
      );
    }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/tasks?taskId=t1']}>
          <TasksPage />
          <DeepLinkDriver />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // First deep link: detail panel opened for t1 (the open Dialog marks the
    // rest of the page aria-hidden, so close it before asserting on tabs).
    await waitFor(() => expect(screen.getByLabelText('Close details')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Close details'));
    await waitFor(() => expect(screen.queryByLabelText('Close details')).not.toBeInTheDocument());
    expect(screen.getByRole('tab', { name: /all tasks/i })).toHaveAttribute('aria-selected', 'true');

    // User wanders off to another tab...
    fireEvent.click(screen.getByRole('tab', { name: /my tasks/i }));
    expect(screen.getByRole('tab', { name: /my tasks/i })).toHaveAttribute('aria-selected', 'true');

    // ...then a SECOND deep link arrives. The old one-shot latch would leave
    // the page inert; the taskId-keyed ref must treat it as brand new: the
    // panel opens for the newly linked task...
    fireEvent.click(screen.getByText('go-to-t2'));
    await waitFor(() => expect(screen.getByLabelText('Close details')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Close details'));
    await waitFor(() => expect(screen.queryByLabelText('Close details')).not.toBeInTheDocument());
    // ...and the All Tasks tab has been re-forced.
    expect(screen.getByRole('tab', { name: /all tasks/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('pressing "n" opens the New Task modal', () => {
    renderPage();
    expect(screen.queryByTestId('new-task-modal')).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'n' });
    expect(screen.getByTestId('new-task-modal')).toBeInTheDocument();
  });

  it('pressing "n" while a filter select has focus does not open the New Task modal', () => {
    renderPage();
    const prioritySelect = screen.getByLabelText(/filter by priority/i);
    fireEvent.keyDown(prioritySelect, { key: 'n' });
    expect(screen.queryByTestId('new-task-modal')).not.toBeInTheDocument();
  });

  it('selecting two rows shows "2 selected" in the floating bulk-action bar', () => {
    renderPage();
    fireEvent.click(screen.getByLabelText('Select Follow Up — Aetna Better Health'));
    fireEvent.click(screen.getByLabelText('Select Verify NPI for Dr. Lee'));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
  });

  it('renders the group pill and the payer tel link on rows', () => {
    renderPage();
    // Scoped to the row (not the group filter select, which also has a
    // "Follow Up" option) — see the group-filter select added in this task.
    const row = screen.getByText('Follow Up — Aetna Better Health').closest('.group') as HTMLElement;
    expect(within(row).getByText('Follow Up')).toBeInTheDocument(); // TaskGroupPill
    const tel = screen.getByRole('link', { name: 'Call Aetna Better Health credentialing, (800) 555-0142' });
    expect(tel).toHaveAttribute('href', 'tel:(800) 555-0142'); // contactInfo.phone wins over the raw Stedi phone
  });

  it('offers a group filter with all nine groups', () => {
    renderPage();
    const filter = screen.getByLabelText('Filter by group');
    expect(filter).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'CAQH Update / Re-attestation' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Check-in' })).toBeInTheDocument();
  });

  it('prunes a selection that disappears from the list (e.g. a filter change) and hides the bulk bar', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // A fresh element (not a shared reference) is built per render call: if
    // `rerender` is handed the exact same JSX object twice, React sees
    // identical props by reference and bails out of re-invoking TasksPage
    // entirely, so the updated mock below would never be read.
    const makeTree = () => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/tasks']}>
          <TasksPage />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const { rerender } = render(makeTree());

    fireEvent.click(screen.getByLabelText('Select Follow Up — Aetna Better Health'));
    expect(screen.getByText('1 selected')).toBeInTheDocument();

    // Simulate a filter change that removes the selected task ("Follow Up — Aetna Better Health",
    // t1) from the visible list.
    vi.mocked(useStaffTasks).mockReturnValue({
      data: {
        data: [
          {
            id: 't2',
            title: 'Verify NPI for Dr. Lee',
            status: 'PENDING',
            priority: 'NORMAL',
            dueDate: null,
            createdAt: '2026-07-02T00:00:00Z',
            assignedTo: null,
          },
        ],
        meta: { total: 1 },
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as any);

    rerender(makeTree());

    await waitFor(() => expect(screen.queryByText(/selected/i)).not.toBeInTheDocument());
  });

  it('admin sees the Needs review tab with its count in the accessible name', () => {
    renderPage();
    expect(screen.getByRole('tab', { name: 'Needs review, 3 tasks' })).toBeInTheDocument();
  });

  it('the tab does not render for lanyard_staff (no "admin only" text ships)', () => {
    vi.mocked(useAuthStore).mockImplementation((sel: any) => sel({ user: { id: 'u9', role: 'lanyard_staff' } }));
    renderPage();
    expect(screen.queryByRole('tab', { name: /needs review/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/admin only/i)).not.toBeInTheDocument();
  });

  it('mounts the reason dialog only after overdue-mine resolves with tasks', () => {
    vi.mocked(useMyOverdueUnanswered).mockReturnValue({ data: [{ id: 'o1', title: 'Follow Up — Aetna', description: null, dueDate: new Date(Date.now() - 86_400_000).toISOString() }], isSuccess: true, isError: false } as any);
    renderPage();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('fails open — a failed overdue query never blocks the page', () => {
    vi.mocked(useMyOverdueUnanswered).mockReturnValue({ data: undefined, isSuccess: false, isError: true } as any);
    renderPage();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /my tasks/i })).toBeInTheDocument();
  });

  it('deep link wins over the dialog', () => {
    vi.mocked(useMyOverdueUnanswered).mockReturnValue({ data: [{ id: 'o1', title: 'x', description: null, dueDate: new Date().toISOString() }], isSuccess: true, isError: false } as any);
    renderPage(['/tasks?taskId=t1']);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
