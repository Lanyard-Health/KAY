import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SelectWithOther from './SelectWithOther';

const OPTIONS = ['Epic', 'Elation Health'];

describe('SelectWithOther', () => {
  it('renders the options plus an "Other" entry', () => {
    render(<SelectWithOther label="EMR Vendor" value="" onChange={() => {}} options={OPTIONS} />);
    expect(screen.getByRole('option', { name: 'Epic' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Other/ })).toBeInTheDocument();
    // No free-text input until Other is chosen.
    expect(screen.queryByPlaceholderText('Type it in')).not.toBeInTheDocument();
  });

  it('reveals a free-text input and clears the value when Other is selected', () => {
    const onChange = vi.fn();
    render(<SelectWithOther label="EMR Vendor" value="" onChange={onChange} options={OPTIONS} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Other' } });
    expect(onChange).toHaveBeenCalledWith('');
    expect(screen.getByPlaceholderText('Type it in')).toBeInTheDocument();
  });

  it('opens in Other mode when the bound value is not a listed option', () => {
    render(<SelectWithOther label="EMR Vendor" value="Homegrown EMR" onChange={() => {}} options={OPTIONS} />);
    const input = screen.getByPlaceholderText('Type it in') as HTMLInputElement;
    expect(input.value).toBe('Homegrown EMR');
  });

  it('emits the chosen option', () => {
    const onChange = vi.fn();
    render(<SelectWithOther label="EMR Vendor" value="" onChange={onChange} options={OPTIONS} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Epic' } });
    expect(onChange).toHaveBeenCalledWith('Epic');
  });
});
