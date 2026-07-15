import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../hooks/useStaffTasks', () => ({
  useStaffTasks: vi.fn(() => ({
    data: {
      data: [
        {
          id: 't1',
          title: 'Chase W-9',
          status: 'IN_PROGRESS',
          priority: 'URGENT',
          dueDate: '2026-07-12T00:00:00Z',
          createdAt: '2026-07-01T00:00:00Z',
          assignedTo: { id: 'u1', firstName: 'Kay', lastName: 'Ward' },
        },
      ],
      meta: { total: 1 },
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })),
  useTaskCounts: vi.fn(() => ({ data: { open: 1, overdue: 1 } })),
  useAssignees: vi.fn(() => ({ data: [] })),
  useClaimTask: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateStaffTask: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useCreateStaffTask: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useDeleteTask: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

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
  it('renders tabs and an urgent overdue task', () => {
    renderPage();
    expect(screen.getByRole('tab', { name: /my tasks/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /task pool/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /all tasks/i })).toBeInTheDocument();
    expect(screen.getByText('Chase W-9')).toBeInTheDocument();
    expect(screen.getByText(/overdue/i)).toBeInTheDocument();
  });

  it('deep link (?taskId=) switches to the All Tasks tab so the task can be found regardless of which view it lives in', () => {
    renderPage(['/tasks?taskId=t1']);
    const allTasksTab = screen.getByRole('tab', { name: /all tasks/i });
    expect(allTasksTab).toHaveAttribute('aria-selected', 'true');
  });
});
