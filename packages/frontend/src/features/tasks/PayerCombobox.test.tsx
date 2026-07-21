import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PayerCombobox from './PayerCombobox';

// jsdom has no ResizeObserver; Headless UI's Combobox.Options uses one
// internally (useElementSize, for --input-width/--button-width) regardless
// of anchor/floating config. Stub it so open/close doesn't throw.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).ResizeObserver = (global as any).ResizeObserver ?? ResizeObserverStub;

vi.mock('../../services/api', () => ({
  api: {
    get: vi.fn(async (url: string) =>
      url.includes('q=aet')
        ? { data: { data: [{ id: 'p1', name: 'Aetna Better Health' }] } }
        : { data: { data: [] } }),
  },
}));

function renderBox(onChange = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PayerCombobox value={null} onChange={onChange} />
    </QueryClientProvider>,
  );
}

describe('PayerCombobox', () => {
  it('shows debounced matches and announces the settled count', async () => {
    renderBox();
    await userEvent.type(screen.getByRole('combobox'), 'aet');
    await waitFor(() => expect(screen.getByText('Aetna Better Health')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 payer found'));
  });

  it('shows the "No payers match" empty row and announces it', async () => {
    renderBox();
    await userEvent.type(screen.getByRole('combobox'), 'zzz');
    await waitFor(() => expect(screen.getByText('No payers match')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('No payers match'));
  });

  it('selects an option via the listbox', async () => {
    const onChange = vi.fn();
    renderBox(onChange);
    await userEvent.type(screen.getByRole('combobox'), 'aet');
    await waitFor(() => expect(screen.getByText('Aetna Better Health')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Aetna Better Health'));
    expect(onChange).toHaveBeenCalledWith({ id: 'p1', name: 'Aetna Better Health' });
  });
});
