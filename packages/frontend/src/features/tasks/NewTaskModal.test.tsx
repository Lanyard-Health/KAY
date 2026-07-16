import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const createMutate = vi.fn();

vi.mock('../../hooks/useStaffTasks', () => ({
  useCreateStaffTask: vi.fn(() => ({ mutate: createMutate, isPending: false })),
  useAssignees: vi.fn(() => ({ data: [{ id: 'u1', firstName: 'Kay', lastName: 'Ward', role: 'admin' }] })),
}));

vi.mock('../../stores/auth.store', () => ({
  useAuthStore: vi.fn((selector: (s: { user: { id: string } }) => unknown) => selector({ user: { id: 'u1' } })),
}));

vi.mock('../../services/api', () => ({
  api: {
    get: vi.fn(() => Promise.resolve({ data: { success: true, data: [] } })),
  },
}));

import NewTaskModal from './NewTaskModal';

function renderModal(onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <NewTaskModal isOpen onClose={onClose} />
    </QueryClientProvider>,
  );
}

describe('NewTaskModal', () => {
  it('shows an inline error and does not call the create mutation when title is empty', async () => {
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: /create task/i }));

    await waitFor(() => {
      expect(screen.getByText('Give the task a title so the team knows what it is.')).toBeInTheDocument();
    });
    expect(createMutate).not.toHaveBeenCalled();
  });
});
