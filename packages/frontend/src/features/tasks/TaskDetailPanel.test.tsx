import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { StaffTask } from '../../hooks/useStaffTasks';

const updateMutate = vi.fn();
const deleteMutate = vi.fn();

vi.mock('../../hooks/useStaffTasks', () => ({
  useUpdateStaffTask: vi.fn(() => ({ mutate: updateMutate, isPending: false })),
  useDeleteTask: vi.fn(() => ({ mutate: deleteMutate, isPending: false })),
  useAssignees: vi.fn(() => ({
    data: [
      { id: 'u1', firstName: 'Kay', lastName: 'Ward', role: 'admin' },
      { id: 'u2', firstName: 'Sam', lastName: 'Lee', role: 'staff' },
    ],
  })),
}));

import TaskDetailPanel from './TaskDetailPanel';

const baseTask: StaffTask = {
  id: 't1',
  title: 'Chase W-9 from Dr. Smith',
  description: 'Follow up with the practice for the missing W-9.',
  status: 'IN_PROGRESS',
  priority: 'URGENT',
  dueDate: '2026-06-01T00:00:00Z',
  createdAt: '2026-05-01T00:00:00Z',
  completedAt: null,
  assignedTo: { id: 'u1', firstName: 'Kay', lastName: 'Ward' },
  createdBy: { id: 'u2', firstName: 'Sam', lastName: 'Lee' },
  completedBy: null,
  provider: null,
  practice: null,
  enrollment: null,
};

function renderPanel(task: StaffTask | null = baseTask, onClose = vi.fn()) {
  return render(
    <MemoryRouter>
      <TaskDetailPanel task={task} onClose={onClose} />
    </MemoryRouter>,
  );
}

describe('TaskDetailPanel', () => {
  it('renders the task title and the current status', () => {
    renderPanel();
    expect(screen.getByRole('heading', { name: 'Chase W-9 from Dr. Smith' })).toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toHaveValue('IN_PROGRESS');
  });

  it('renders nothing when task is null', () => {
    renderPanel(null);
    expect(screen.queryByRole('heading', { name: 'Chase W-9 from Dr. Smith' })).not.toBeInTheDocument();
  });

  it('changing assignee to Back to Task Pool calls the update mutation with assignedToId: null', () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText('Assigned to'), { target: { value: '' } });
    expect(updateMutate).toHaveBeenCalledWith(
      { taskId: 't1', data: { assignedToId: null } },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });
});
