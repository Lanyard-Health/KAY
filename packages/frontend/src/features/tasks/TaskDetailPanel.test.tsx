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

  it('keeps the status select on COMPLETED after a re-render with the same stale task prop', () => {
    // The old bug: the select read `task.status` directly, so any re-render
    // (e.g. isPending flipping during the mutation) re-asserted the stale
    // prop value and the select snapped back to IN_PROGRESS. Forcing a
    // `rerender` with the SAME task object reference reproduces that
    // re-assertion without needing to fake the mutation's pending state.
    updateMutate.mockImplementation(() => {});
    const task = { ...baseTask };
    const onClose = vi.fn();
    const { rerender } = render(
      <MemoryRouter>
        <TaskDetailPanel task={task} onClose={onClose} />
      </MemoryRouter>,
    );

    const statusSelect = screen.getByLabelText('Status');
    fireEvent.change(statusSelect, { target: { value: 'COMPLETED' } });

    // Re-render with the identical `task` reference to mimic a parent
    // re-render (e.g. isPending flipping) that does NOT bring fresh data.
    rerender(
      <MemoryRouter>
        <TaskDetailPanel task={task} onClose={onClose} />
      </MemoryRouter>,
    );

    expect((statusSelect as HTMLSelectElement).value).toBe('COMPLETED');
    expect(updateMutate).toHaveBeenCalledWith(
      { taskId: 't1', data: { status: 'COMPLETED' } },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it('shows the true assignee name (with "(unavailable)") when they are missing from the assignees list', () => {
    const ghostTask: StaffTask = {
      ...baseTask,
      assignedTo: { id: 'ghost', firstName: 'Old', lastName: 'Staffer' },
    };
    renderPanel(ghostTask);
    const select = screen.getByLabelText('Assigned to') as HTMLSelectElement;
    expect(select).toHaveValue('ghost');
    expect(screen.getByText('Old Staffer (unavailable)')).toBeInTheDocument();
  });
});
