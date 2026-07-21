import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import AutoTitlePreview from './AutoTitlePreview';

describe('AutoTitlePreview', () => {
  afterEach(() => vi.useRealTimers());

  it('is a read-only polite status region labeled "Task title, automatic"', async () => {
    vi.useFakeTimers();
    render(<AutoTitlePreview group="FOLLOW_UP" payerName="Molina Healthcare of Texas" />);
    await act(async () => { vi.advanceTimersByTime(400); });
    const region = screen.getByRole('status', { name: 'Task title, automatic' });
    expect(region).toHaveTextContent('Follow Up — Molina Healthcare of Texas');
  });

  it('debounces recomposition — one settled announcement, not per keystroke', async () => {
    vi.useFakeTimers();
    const { rerender } = render(<AutoTitlePreview group="FOLLOW_UP" />);
    await act(async () => { vi.advanceTimersByTime(400); });
    rerender(<AutoTitlePreview group="FOLLOW_UP" payerName="Aet" />);
    rerender(<AutoTitlePreview group="FOLLOW_UP" payerName="Aetna Better Health" />);
    // before settle, still the old value
    expect(screen.getByRole('status')).toHaveTextContent(/^Follow Up$/);
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(screen.getByRole('status')).toHaveTextContent('Follow Up — Aetna Better Health');
  });
});
