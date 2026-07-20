import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  usePayerContactInfo: vi.fn(),
  useSavePayerContactInfo: vi.fn(),
  notifyError: vi.fn(),
}));
vi.mock('../../hooks/useStaffTasks', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePayerContactInfo: mocks.usePayerContactInfo,
  useSavePayerContactInfo: mocks.useSavePayerContactInfo,
}));
vi.mock('../../utils/notify', () => ({ notify: { error: mocks.notifyError, success: vi.fn() } }));

import PayerContactCard from './PayerContactCard';

describe('PayerContactCard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('on-file state: tel link carries the payer + consequence in its accessible name', () => {
    mocks.usePayerContactInfo.mockReturnValue({ data: { phone: '(800) 555-0142', email: 'cred@aetna.com', bestWay: 'Phone, ask for credentialing dept', hours: 'M-F 8-5 CT', notes: null }, isLoading: false, isError: false });
    mocks.useSavePayerContactInfo.mockReturnValue({ mutate: vi.fn(), isPending: false });
    render(<PayerContactCard payerId="p1" payerName="Aetna Better Health" />);
    expect(screen.getByText('On file')).toBeInTheDocument();
    const tel = screen.getByRole('link', { name: 'Call Aetna Better Health credentialing, (800) 555-0142' });
    expect(tel).toHaveAttribute('href', 'tel:(800) 555-0142');
    expect(screen.getByRole('button', { name: 'Edit contact info' })).toBeInTheDocument();
  });

  it('empty state: invitation copy verbatim + labeled add form', () => {
    mocks.usePayerContactInfo.mockReturnValue({ data: null, isLoading: false, isError: false });
    mocks.useSavePayerContactInfo.mockReturnValue({ mutate: vi.fn(), isPending: false });
    render(<PayerContactCard payerId="p1" payerName="Molina Healthcare of Texas" />);
    expect(screen.getByText('Nothing on file')).toBeInTheDocument();
    expect(screen.getByText('Be the first to add it — every teammate after you gets this automatically.')).toBeInTheDocument();
    expect(screen.getByLabelText('Phone')).toBeInTheDocument();
    expect(screen.getByLabelText('Best way to contact')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save contact info' })).toBeInTheDocument();
  });

  it('a failed save shows a toast and keeps the entered values', async () => {
    mocks.usePayerContactInfo.mockReturnValue({ data: null, isLoading: false, isError: false });
    const mutate = vi.fn((_vars: unknown, opts?: { onError?: (e: unknown) => void }) => opts?.onError?.(new Error('network')));
    mocks.useSavePayerContactInfo.mockReturnValue({ mutate, isPending: false });
    render(<PayerContactCard payerId="p1" payerName="Molina Healthcare of Texas" />);
    await userEvent.type(screen.getByLabelText('Phone'), '(800) 555-0111');
    await userEvent.click(screen.getByRole('button', { name: 'Save contact info' }));
    await waitFor(() => expect(mocks.notifyError).toHaveBeenCalled());
    expect(screen.getByLabelText('Phone')).toHaveValue('(800) 555-0111'); // values kept, task creation unaffected
  });

  it('Enter inside a card input saves the card and never submits an enclosing form', async () => {
    mocks.usePayerContactInfo.mockReturnValue({ data: null, isLoading: false, isError: false });
    const mutate = vi.fn();
    mocks.useSavePayerContactInfo.mockReturnValue({ mutate, isPending: false });
    const outerSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      // Mirrors NewTaskModal: the card renders inside the task <form>.
      <form onSubmit={outerSubmit}>
        <PayerContactCard payerId="p1" payerName="Molina Healthcare of Texas" />
      </form>,
    );
    await userEvent.type(screen.getByLabelText('Phone'), '(800) 555-0111{Enter}');
    expect(outerSubmit).not.toHaveBeenCalled(); // no implicit form submission
    expect(mutate).toHaveBeenCalledTimes(1); // Enter routed to the card's own save
    expect(mutate.mock.calls[0][0]).toMatchObject({ payerId: 'p1', data: expect.objectContaining({ phone: '(800) 555-0111' }) });
  });
});
