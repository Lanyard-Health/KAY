import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  createMutate: vi.fn(),
  providersByPractice: {
    'practice-1': [{ id: 'prov-1', firstName: 'Dana', lastName: 'Reyes' }],
    'practice-2': [] as { id: string; firstName: string; lastName: string }[],
  } as Record<string, { id: string; firstName: string; lastName: string }[]>,
}));

vi.mock('../../hooks/useStaffTasks', () => ({
  useCreateStaffTask: vi.fn(() => ({ mutate: mocks.createMutate, isPending: false })),
  useAssignees: vi.fn(() => ({ data: [{ id: 'u1', firstName: 'Kay', lastName: 'Ward', role: 'admin' }] })),
  usePayerContactInfo: vi.fn(() => ({ data: null, isLoading: false, isError: false })),
  useSavePayerContactInfo: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));
vi.mock('../../stores/auth.store', () => ({ useAuthStore: vi.fn((sel: any) => sel({ user: { id: 'u1', role: 'admin' } })) }));
vi.mock('../../services/api', () => ({
  api: {
    get: vi.fn(async (url: string) => {
      if (url.startsWith('/practices')) return { data: { data: [{ id: 'practice-1', name: 'Sunrise Behavioral Health' }, { id: 'practice-2', name: 'Lakeside Counseling' }] } };
      if (url.startsWith('/providers')) {
        const practiceId = new URLSearchParams(url.split('?')[1]).get('practiceId')!;
        return { data: { data: { data: mocks.providersByPractice[practiceId] ?? [] } } };
      }
      if (url.startsWith('/enrollments/payers')) return { data: { data: [{ id: 'payer-1', name: 'Aetna Better Health' }] } };
      return { data: { data: [] } };
    }),
  },
}));
vi.mock('../../utils/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NewTaskModal from './NewTaskModal';

function renderModal() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NewTaskModal isOpen onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe('NewTaskModal (guided)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('has no free-text title input anywhere; shows the automatic title preview', () => {
    renderModal();
    // Scoped to actual form controls: queryByLabelText(/title/i) would also match
    // AutoTitlePreview's own aria-label ("Task title, automatic"), which is the
    // read-only preview itself, not a free-text input — see deviation note below.
    expect(screen.queryByRole('textbox', { name: /title/i })).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Task title, automatic' })).toBeInTheDocument();
    // the 8 human groups, verbatim
    const groupSelect = screen.getByLabelText('Task group *');
    expect(groupSelect).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'CAQH Update / Re-attestation' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /check-in/i })).not.toBeInTheDocument(); // system-only
  });

  it('requires a task group — validation keeps the modal open', async () => {
    renderModal();
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    expect(await screen.findByText("Pick a task group; it's the only required field.")).toBeInTheDocument();
    expect(mocks.createMutate).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'New Task' })).toBeInTheDocument();
  });

  it('submits the guided payload (no title key)', async () => {
    renderModal();
    await userEvent.selectOptions(screen.getByLabelText('Task group *'), 'CALL_BACK');
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(mocks.createMutate).toHaveBeenCalled());
    const payload = mocks.createMutate.mock.calls[0][0];
    expect(payload.taskGroup).toBe('CALL_BACK');
    expect(payload.title).toBeUndefined();
  });

  it('Assign To defaults to the signed-in user, and picking Task Pool sends no assignee', async () => {
    renderModal();
    expect(screen.getByLabelText('Assign To')).toHaveValue('u1');
    await userEvent.selectOptions(screen.getByLabelText('Task group *'), 'CALL_BACK');
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(mocks.createMutate).toHaveBeenCalled());
    expect(mocks.createMutate.mock.calls[0][0].assignedToId).toBe('u1');

    mocks.createMutate.mockClear();
    await userEvent.selectOptions(screen.getByLabelText('Assign To'), '');
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(mocks.createMutate).toHaveBeenCalled());
    expect(mocks.createMutate.mock.calls[0][0].assignedToId).toBeUndefined();
  });

  it('cascade rule: changing Practice clears an incompatible Provider and announces it', async () => {
    renderModal();
    await userEvent.selectOptions(screen.getByLabelText('Task group *'), 'CALL_BACK');
    await userEvent.selectOptions(screen.getByLabelText(/practice/i), 'practice-1');
    expect(await screen.findByText('Filtered to providers at the selected practice')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('option', { name: 'Dana Reyes' })).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText(/provider/i), 'prov-1');
    await userEvent.selectOptions(screen.getByLabelText(/practice/i), 'practice-2');
    await waitFor(() =>
      expect(screen.getByTestId('cascade-announcement')).toHaveTextContent("Provider cleared: Dana Reyes isn't at Lakeside Counseling"));
    expect(screen.getByLabelText(/provider/i)).toHaveValue('');
  });
});
