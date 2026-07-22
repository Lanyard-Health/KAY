import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({ mutateAsync: vi.fn() }));
vi.mock('../../hooks/useStaffTasks', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useUpdateStaffTask: vi.fn(() => ({ mutateAsync: mocks.mutateAsync, isPending: false })),
}));

import OverdueReasonDialog from './OverdueReasonDialog';

const TASKS = [
  { id: 't1', title: 'Call Back — Aetna Better Health — Sunrise', description: 'Rep asked for Thursday', dueDate: new Date(Date.now() - 3 * 86_400_000).toISOString() },
  { id: 't2', title: 'Follow Up — Molina Healthcare of Texas', description: null, dueDate: new Date(Date.now() - 86_400_000).toISOString() },
];

describe('OverdueReasonDialog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the contract: heading, subhead, chips, per-task labeled inputs, both footer buttons', () => {
    render(<OverdueReasonDialog tasks={TASKS} onClose={vi.fn()} />);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('Before you dive in — 2 tasks missed their deadlines')).toBeInTheDocument();
    expect(screen.getByText("A quick reason for each helps Kay review them. You can defer, but it'll ask again next time.")).toBeInTheDocument();
    expect(screen.getAllByText("Payer hasn't responded")).toHaveLength(2); // chips per task
    expect(screen.getByRole('textbox', { name: 'What got in the way? — Call Back — Aetna Better Health — Sunrise' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save reasons' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "I'll answer later" })).toBeInTheDocument();
  });

  it('singular heading for one task', () => {
    render(<OverdueReasonDialog tasks={[TASKS[0]]} onClose={vi.fn()} />);
    expect(screen.getByText('Before you dive in — 1 task missed its deadline')).toBeInTheDocument();
  });

  it('a chip fills the field, which stays editable', async () => {
    render(<OverdueReasonDialog tasks={[TASKS[0]]} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Waiting on documents' }));
    const input = screen.getByRole('textbox', { name: /Call Back/ });
    expect(input).toHaveValue('Waiting on documents');
    await userEvent.type(input, ' — chased Friday');
    expect(input).toHaveValue('Waiting on documents — chased Friday');
  });

  it('a successful save calls the mutation with the exact payload contract the backend expects', async () => {
    mocks.mutateAsync.mockResolvedValueOnce({});
    const onClose = vi.fn();
    render(<OverdueReasonDialog tasks={[TASKS[0]]} onClose={onClose} />);
    await userEvent.type(screen.getByRole('textbox', { name: /Call Back/ }), 'Payer went dark');
    await userEvent.click(screen.getByRole('button', { name: 'Save reasons' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith('saved'));
    expect(mocks.mutateAsync).toHaveBeenCalledWith({ taskId: 't1', data: { overdueReason: 'Payer went dark' } });
  });

  it('empty fields block submit with inline errors and an announced count — dialog stays open', async () => {
    const onClose = vi.fn();
    render(<OverdueReasonDialog tasks={TASKS} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save reasons' }));
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getAllByText('Add a one-line reason')).toHaveLength(2);
    expect(screen.getByRole('textbox', { name: /Call Back/ })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('dialog-announcer')).toHaveTextContent('2 reasons still needed');
  });

  it('a failed save shows the inline retry error, keeps the text, and never blocks the buttons (D24)', async () => {
    mocks.mutateAsync
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({});
    const onClose = vi.fn();
    render(<OverdueReasonDialog tasks={TASKS} onClose={onClose} />);
    await userEvent.type(screen.getByRole('textbox', { name: /Call Back/ }), 'Payer went dark');
    await userEvent.type(screen.getByRole('textbox', { name: /Follow Up/ }), 'Ran out of time');
    await userEvent.click(screen.getByRole('button', { name: 'Save reasons' }));
    await waitFor(() =>
      expect(screen.getByText('Couldn\'t save this reason — check your connection and try again. Your text is kept.')).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled(); // one failure → stays open for retry
    expect(screen.getByRole('textbox', { name: /Call Back/ })).toHaveValue('Payer went dark'); // text kept
    expect(screen.getByRole('button', { name: "I'll answer later" })).toBeEnabled(); // deferral always usable
  });

  it('Esc performs the same deferral as the button', async () => {
    const onClose = vi.fn();
    render(<OverdueReasonDialog tasks={TASKS} onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledWith('deferred');
  });
});
