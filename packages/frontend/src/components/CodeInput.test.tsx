import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import CodeInput from './CodeInput';

/** Stateful wrapper so interaction tests exercise the controlled loop. */
function Harness({ autoFocus = false }: { autoFocus?: boolean }) {
  const [value, setValue] = useState('');
  return <CodeInput value={value} onChange={setValue} autoFocus={autoFocus} />;
}

const boxes = () => screen.getAllByRole('textbox') as HTMLInputElement[];
const joined = () => boxes().map((b) => b.value).join('');

describe('CodeInput', () => {
  it('renders 6 labeled boxes inside a labeled group', () => {
    render(<Harness />);
    expect(screen.getByRole('group', { name: '6-digit verification code' })).toBeInTheDocument();
    for (let i = 1; i <= 6; i++) {
      expect(screen.getByLabelText(`Digit ${i} of 6`)).toBeInTheDocument();
    }
  });

  it('builds the value and advances focus as digits are typed', () => {
    render(<Harness />);
    const b = boxes();
    fireEvent.change(b[0], { target: { value: '4' } });
    expect(document.activeElement).toBe(b[1]);
    fireEvent.change(b[1], { target: { value: '8' } });
    fireEvent.change(b[2], { target: { value: '2' } });
    fireEvent.change(b[3], { target: { value: '9' } });
    fireEvent.change(b[4], { target: { value: '1' } });
    fireEvent.change(b[5], { target: { value: '3' } });
    expect(joined()).toBe('482913');
    // focus stays on the last box once full
    expect(document.activeElement).toBe(b[5]);
  });

  it('ignores non-digit input', () => {
    render(<Harness />);
    fireEvent.change(boxes()[0], { target: { value: 'a' } });
    expect(joined()).toBe('');
  });

  it('backspace clears the current box, then steps back and clears the previous one', () => {
    render(<Harness />);
    const b = boxes();
    fireEvent.change(b[0], { target: { value: '1' } });
    fireEvent.change(b[1], { target: { value: '2' } });
    // focus is on box 2 (empty): backspace clears box 1 and moves focus there
    fireEvent.keyDown(b[2], { key: 'Backspace' });
    expect(joined()).toBe('1');
    expect(document.activeElement).toBe(b[1]);
    // box 1 refilled, backspace on a filled box clears it in place
    fireEvent.change(b[1], { target: { value: '9' } });
    fireEvent.keyDown(b[2], { key: 'Backspace' });
    expect(joined()).toBe('1');
  });

  it('fills all boxes from pasted text containing a 6-digit run', () => {
    render(<Harness />);
    const group = screen.getByRole('group');
    fireEvent.paste(group, { clipboardData: { getData: () => 'Your code is 482913' } });
    expect(joined()).toBe('482913');
    expect(document.activeElement).toBe(boxes()[5]);
  });

  it('ignores pasted text without a 6-digit run', () => {
    render(<Harness />);
    fireEvent.paste(screen.getByRole('group'), {
      clipboardData: { getData: () => 'no code here 123' },
    });
    expect(joined()).toBe('');
  });

  it('distributes a multi-digit change on box 1 across all boxes (OS autofill path)', () => {
    render(<Harness />);
    fireEvent.change(boxes()[0], { target: { value: '482913' } });
    expect(joined()).toBe('482913');
  });

  it('derives boxes from the controlled value, including clearing and dirty values', () => {
    const noop = vi.fn();
    const { rerender } = render(<CodeInput value="12" onChange={noop} />);
    expect(joined()).toBe('12');
    rerender(<CodeInput value="1a2b3c" onChange={noop} />);
    expect(joined()).toBe('123');
    rerender(<CodeInput value="" onChange={noop} />);
    expect(joined()).toBe('');
  });

  it('sets autoComplete="one-time-code" on the first box only', () => {
    render(<Harness />);
    const b = boxes();
    expect(b[0]).toHaveAttribute('autocomplete', 'one-time-code');
    expect(b[1]).toHaveAttribute('autocomplete', 'off');
  });

  it('focuses the first box when autoFocus is set, not otherwise', () => {
    const { unmount } = render(<Harness autoFocus />);
    expect(document.activeElement).toBe(boxes()[0]);
    unmount();
    render(<Harness />);
    expect(document.activeElement).toBe(document.body);
  });

  it('does not swallow Enter, so the surrounding form can submit', () => {
    render(<Harness />);
    // fireEvent returns false when preventDefault was called
    expect(fireEvent.keyDown(boxes()[0], { key: 'Enter' })).toBe(true);
    expect(fireEvent.keyDown(boxes()[0], { key: 'Backspace' })).toBe(false);
  });
});
