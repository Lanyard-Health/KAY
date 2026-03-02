import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusBadge from './StatusBadge';

describe('StatusBadge', () => {
  it('renders the label text', () => {
    render(<StatusBadge label="Active" />);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('defaults to neutral variant', () => {
    render(<StatusBadge label="Unknown" />);
    const badge = screen.getByText('Unknown');
    expect(badge.className).toContain('bg-gray-50');
    expect(badge.className).toContain('text-gray-600');
  });

  it('applies success variant styles', () => {
    render(<StatusBadge label="Approved" variant="success" />);
    const badge = screen.getByText('Approved');
    expect(badge.className).toContain('bg-green-50');
    expect(badge.className).toContain('text-green-700');
  });

  it('applies danger variant styles', () => {
    render(<StatusBadge label="Rejected" variant="danger" />);
    const badge = screen.getByText('Rejected');
    expect(badge.className).toContain('bg-red-50');
    expect(badge.className).toContain('text-red-700');
  });

  it('applies warning variant styles', () => {
    render(<StatusBadge label="Pending" variant="warning" />);
    const badge = screen.getByText('Pending');
    expect(badge.className).toContain('bg-amber-50');
  });

  it('applies info variant styles', () => {
    render(<StatusBadge label="In Progress" variant="info" />);
    const badge = screen.getByText('In Progress');
    expect(badge.className).toContain('bg-blue-50');
  });

  it('does not render dot by default', () => {
    const { container } = render(<StatusBadge label="Test" />);
    const dots = container.querySelectorAll('.h-1\\.5.w-1\\.5.rounded-full');
    expect(dots.length).toBe(0);
  });

  it('renders dot when dot prop is true', () => {
    const { container } = render(<StatusBadge label="Test" variant="success" dot />);
    const dots = container.querySelectorAll('.rounded-full');
    // Find the small dot (not the badge itself which is also rounded-full)
    const smallDot = Array.from(dots).find(
      (el) => el.className.includes('bg-green-500') && el.className.includes('h-1.5'),
    );
    expect(smallDot).toBeTruthy();
  });

  it('accepts custom className', () => {
    render(<StatusBadge label="Custom" className="my-custom-class" />);
    const badge = screen.getByText('Custom');
    expect(badge.className).toContain('my-custom-class');
  });
});
