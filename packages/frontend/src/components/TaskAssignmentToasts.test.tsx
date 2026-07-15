import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('../stores/auth.store', () => ({
  useAuthStore: vi.fn((selector: (s: { user: { role: string } }) => unknown) =>
    selector({ user: { role: 'admin' } })),
}));

const markReadMutate = vi.fn();
const mockUseNotifications = vi.fn();
vi.mock('../hooks/useNotifications', () => ({
  useNotifications: (...args: unknown[]) => mockUseNotifications(...args),
  useMarkNotificationsRead: () => ({ mutate: markReadMutate }),
}));

import TaskAssignmentToasts from './TaskAssignmentToasts';

function notification(id: string, taskId: string, title: string) {
  return {
    id,
    userId: 'u1',
    type: 'task',
    title: 'Task assigned',
    message: `You have been assigned: ${title}`,
    read: false,
    metadata: { kind: 'task_assigned', taskId },
    createdAt: new Date().toISOString(),
  };
}

describe('TaskAssignmentToasts', () => {
  it('primes on first real-data render (not the undefined pre-resolution render), then toasts only newly-appeared ones', () => {
    // Real React Query behavior: a fresh query key renders once with data === undefined
    // before the request resolves. Priming against that undefined render (treating it
    // as "items=[]") would prime an empty seen-set and toast-storm every pre-existing
    // unread notification the moment real data lands.
    mockUseNotifications.mockReturnValue({ data: undefined });
    const { rerender } = render(<TaskAssignmentToasts />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    const first = {
      notifications: [notification('n1', 't1', 'Review CAQH doc'), notification('n2', 't2', 'Chase reference')],
      totalCount: 2,
      unreadCount: 2,
    };
    mockUseNotifications.mockReturnValue({ data: first });
    rerender(<TaskAssignmentToasts />);

    // Priming render: no toasts shown even though two task_assigned notifications exist
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    const second = {
      notifications: [
        notification('n3', 't3', 'Verify malpractice policy'),
        ...first.notifications,
      ],
      totalCount: 3,
      unreadCount: 3,
    };
    mockUseNotifications.mockReturnValue({ data: second });

    rerender(<TaskAssignmentToasts />);

    const stack = screen.getByRole('status');
    expect(stack).toBeInTheDocument();
    expect(screen.getByText('Verify malpractice policy')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /view task/i })).toHaveLength(1);
  });

  it('preserves newest-first order when two new items arrive in a single poll', () => {
    const first = {
      notifications: [notification('n1', 't1', 'Review CAQH doc')],
      totalCount: 1,
      unreadCount: 1,
    };
    mockUseNotifications.mockReturnValue({ data: first });
    const { rerender } = render(<TaskAssignmentToasts />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    // Two new items appear in the same poll, newest-first as the API returns them.
    const second = {
      notifications: [
        notification('n3', 't3', 'Newest task'),
        notification('n2', 't2', 'Second newest task'),
        ...first.notifications,
      ],
      totalCount: 3,
      unreadCount: 3,
    };
    mockUseNotifications.mockReturnValue({ data: second });
    rerender(<TaskAssignmentToasts />);

    const titles = screen
      .getAllByText(/Newest task|Second newest task/)
      .map((el) => el.textContent);
    expect(titles).toEqual(['Newest task', 'Second newest task']);
  });

  it('clears auto-dismiss timers on unmount', () => {
    vi.useFakeTimers();
    try {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      mockUseNotifications.mockReturnValue({ data: undefined });
      const { rerender, unmount } = render(<TaskAssignmentToasts />);

      const first = {
        notifications: [notification('n1', 't1', 'Review CAQH doc')],
        totalCount: 1,
        unreadCount: 1,
      };
      mockUseNotifications.mockReturnValue({ data: first });
      rerender(<TaskAssignmentToasts />);

      const second = {
        notifications: [
          notification('n2', 't2', 'New task while mounted'),
          ...first.notifications,
        ],
        totalCount: 2,
        unreadCount: 2,
      };
      mockUseNotifications.mockReturnValue({ data: second });
      rerender(<TaskAssignmentToasts />);

      expect(screen.getByText('New task while mounted')).toBeInTheDocument();

      clearTimeoutSpy.mockClear();
      unmount();

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });
});
