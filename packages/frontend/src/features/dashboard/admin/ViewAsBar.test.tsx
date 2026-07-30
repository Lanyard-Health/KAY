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

const idleProps = {
  viewing: null,
  onEnterPractice: () => {},
  onEnterStaff: () => {},
  onExit: () => {},
};

describe('ViewAsBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({ data: { data: [
      { id: 'p1', name: 'Greens Health' },
      { id: 'p2', name: 'Juna Health' },
    ] } });
  });

  it('has a labeled radiogroup with both role pills, a labeled practice select, and enters practice view-as', async () => {
    const onEnterPractice = vi.fn();
    wrap(<ViewAsBar {...idleProps} onEnterPractice={onEnterPractice} />);

    expect(screen.getByRole('radiogroup', { name: /view as/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Practice Admin' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Credentialing Staff' })).toHaveAttribute('aria-checked', 'false');

    const select = await screen.findByLabelText(/practice/i);
    // Wait for the practices query to resolve and populate the option before
    // selecting it — the select renders immediately, but its options arrive async.
    await screen.findByRole('option', { name: 'Juna Health' });
    fireEvent.change(select, { target: { value: 'p2' } });
    fireEvent.click(screen.getByRole('button', { name: /^view$/i }));
    expect(onEnterPractice).toHaveBeenCalledWith('p2');
  });

  it('does not enter practice view-as without a practice selected', async () => {
    const onEnterPractice = vi.fn();
    wrap(<ViewAsBar {...idleProps} onEnterPractice={onEnterPractice} />);
    await screen.findByLabelText(/practice/i);
    fireEvent.click(screen.getByRole('button', { name: /^view$/i }));
    expect(onEnterPractice).not.toHaveBeenCalled();
  });

  it('staff pill needs no practice: picker hides and View enters the staff view', async () => {
    const onEnterStaff = vi.fn();
    wrap(<ViewAsBar {...idleProps} onEnterStaff={onEnterStaff} />);

    fireEvent.click(screen.getByRole('radio', { name: 'Credentialing Staff' }));
    expect(screen.getByRole('radio', { name: 'Credentialing Staff' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByLabelText(/practice/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^view$/i }));
    expect(onEnterStaff).toHaveBeenCalled();
  });

  it('while viewing a practice: shows the role="status" banner with exact copy and an exit action', () => {
    const onExit = vi.fn();
    wrap(<ViewAsBar {...idleProps} viewing={{ kind: 'practice', id: 'p1', name: 'Greens Health' }} onExit={onExit} />);

    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('Now viewing as Practice Admin: Greens Health. Read-only preview.');
    fireEvent.click(screen.getByRole('button', { name: /exit/i }));
    expect(onExit).toHaveBeenCalled();
  });

  it('while viewing as staff: shows the staff banner copy and an exit action', () => {
    const onExit = vi.fn();
    wrap(<ViewAsBar {...idleProps} viewing={{ kind: 'staff' }} onExit={onExit} />);

    expect(screen.getByRole('status')).toHaveTextContent(
      'Now viewing as Credentialing Staff: all practices. Read-only preview.',
    );
    fireEvent.click(screen.getByRole('button', { name: /exit/i }));
    expect(onExit).toHaveBeenCalled();
  });
});
