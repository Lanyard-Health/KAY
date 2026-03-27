import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PasswordStrength from './PasswordStrength';

describe('PasswordStrength', () => {
  it('renders nothing when password is empty', () => {
    const { container } = render(<PasswordStrength password="" />);
    expect(container.innerHTML).toBe('');
  });

  it('renders all 5 check labels', () => {
    render(<PasswordStrength password="a" />);
    expect(screen.getByText(/12\+ characters/)).toBeInTheDocument();
    expect(screen.getByText(/Uppercase letter/)).toBeInTheDocument();
    expect(screen.getByText(/Lowercase letter/)).toBeInTheDocument();
    expect(screen.getByText(/Number/)).toBeInTheDocument();
    expect(screen.getByText(/Special character/)).toBeInTheDocument();
  });

  it('shows checkmark for passing checks and bullet for failing', () => {
    render(<PasswordStrength password="abc" />);
    // lowercase passes → checkmark (✓)
    const lowercase = screen.getByText(/Lowercase letter/);
    expect(lowercase.textContent).toContain('\u2713');
    // uppercase fails → bullet (•)
    const uppercase = screen.getByText(/Uppercase letter/);
    expect(uppercase.textContent).toContain('\u2022');
  });

  it('marks all checks as passing for a strong password', () => {
    render(<PasswordStrength password="AbCdEf123456!" />);
    const checks = screen.getAllByText(/\u2713/);
    expect(checks.length).toBe(5);
  });

  it('applies green class for strong passwords (4+ checks)', () => {
    const { container } = render(<PasswordStrength password="AbCdEf123456!" />);
    const bars = container.querySelectorAll('.rounded-full.h-1\\.5');
    const greenBars = Array.from(bars).filter((bar) =>
      bar.className.includes('bg-green-500'),
    );
    expect(greenBars.length).toBe(5);
  });

  it('applies red class for weak passwords (1-2 checks)', () => {
    const { container } = render(<PasswordStrength password="ab" />);
    const bars = container.querySelectorAll('.rounded-full.h-1\\.5');
    const redBars = Array.from(bars).filter((bar) =>
      bar.className.includes('bg-red-400'),
    );
    expect(redBars.length).toBe(1); // only lowercase passes
  });
});
