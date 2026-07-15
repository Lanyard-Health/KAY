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
  it('primes seen notifications on first render without toasting, then toasts only newly-appeared ones', () => {
    const first = {
      notifications: [notification('n1', 't1', 'Review CAQH doc'), notification('n2', 't2', 'Chase reference')],
      totalCount: 2,
      unreadCount: 2,
    };
    mockUseNotifications.mockReturnValue({ data: first });

    const { rerender } = render(<TaskAssignmentToasts />);

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
});
