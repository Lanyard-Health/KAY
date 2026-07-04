import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockGet = vi.fn();
vi.mock('../../../services/api', () => ({
  api: { get: (...args: any[]) => mockGet(...args) },
}));

import ViewAsBar from './ViewAsBar';

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{children}</QueryClientProvider>);
}

describe('ViewAsBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({ data: { data: [
      { id: 'p1', name: 'Greens Health' },
      { id: 'p2', name: 'Juna Health' },
    ] } });
  });

  it('has a labeled radiogroup, a labeled practice select, and enters view-as', async () => {
    const onEnter = vi.fn();
    wrap(<ViewAsBar viewingPractice={null} onEnter={onEnter} onExit={() => {}} />);

    expect(screen.getByRole('radiogroup', { name: /view as/i })).toBeInTheDocument();
    const select = await screen.findByLabelText(/practice/i);
    // Wait for the practices query to resolve and populate the option before
    // selecting it — the select renders immediately, but its options arrive async.
    await screen.findByRole('option', { name: 'Juna Health' });
    fireEvent.change(select, { target: { value: 'p2' } });
    fireEvent.click(screen.getByRole('button', { name: /^view$/i }));
    expect(onEnter).toHaveBeenCalledWith('p2');
  });

  it('does not enter view-as without a practice selected', async () => {
    const onEnter = vi.fn();
    wrap(<ViewAsBar viewingPractice={null} onEnter={onEnter} onExit={() => {}} />);
    await screen.findByLabelText(/practice/i);
    fireEvent.click(screen.getByRole('button', { name: /^view$/i }));
    expect(onEnter).not.toHaveBeenCalled();
  });

  it('while viewing: shows the role="status" banner with exact copy and an exit action', () => {
    const onExit = vi.fn();
    wrap(<ViewAsBar viewingPractice={{ id: 'p1', name: 'Greens Health' }} onEnter={() => {}} onExit={onExit} />);

    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('Now viewing as Practice Admin — Greens Health. Read-only preview.');
    fireEvent.click(screen.getByRole('button', { name: /exit/i }));
    expect(onExit).toHaveBeenCalled();
  });
});
