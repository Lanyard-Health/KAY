import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EmptyState from './EmptyState';

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => children,
}));

// Mock illustrations
vi.mock('./illustrations', () => ({
  SearchIllustration: ({ size }: { size: number }) => (
    <svg data-testid="search-illustration" width={size} height={size} />
  ),
  InboxIllustration: ({ size }: { size: number }) => (
    <svg data-testid="inbox-illustration" width={size} height={size} />
  ),
  ClipboardIllustration: ({ size }: { size: number }) => (
    <svg data-testid="clipboard-illustration" width={size} height={size} />
  ),
  FolderIllustration: ({ size }: { size: number }) => (
    <svg data-testid="folder-illustration" width={size} height={size} />
  ),
  ChartIllustration: ({ size }: { size: number }) => (
    <svg data-testid="chart-illustration" width={size} height={size} />
  ),
  PeopleIllustration: ({ size }: { size: number }) => (
    <svg data-testid="people-illustration" width={size} height={size} />
  ),
}));

describe('EmptyState', () => {
  it('renders title', () => {
    render(<EmptyState title="No items found" />);
    expect(screen.getByText('No items found')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(<EmptyState title="Empty" description="Try adjusting your filters" />);
    expect(screen.getByText('Try adjusting your filters')).toBeInTheDocument();
  });

  it('does not render description when not provided', () => {
    const { container } = render(<EmptyState title="Empty" />);
    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs.length).toBe(0);
  });

  it('renders icon when provided', () => {
    render(
      <EmptyState
        title="Empty"
        icon={<span data-testid="custom-icon">Icon</span>}
      />,
    );
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument();
  });

  it('renders illustration when preset is provided', () => {
    render(<EmptyState title="Empty" illustration="search" />);
    expect(screen.getByTestId('search-illustration')).toBeInTheDocument();
  });

  it('prefers illustration over icon when both provided', () => {
    render(
      <EmptyState
        title="Empty"
        illustration="inbox"
        icon={<span data-testid="custom-icon">Icon</span>}
      />,
    );
    expect(screen.getByTestId('inbox-illustration')).toBeInTheDocument();
    expect(screen.queryByTestId('custom-icon')).not.toBeInTheDocument();
  });

  it('renders action button when provided', () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        title="Empty"
        action={{ label: 'Add Item', onClick }}
      />,
    );
    const button = screen.getByText('Add Item');
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not render action button when not provided', () => {
    const { container } = render(<EmptyState title="Empty" />);
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(0);
  });

  it('applies custom className', () => {
    const { container } = render(<EmptyState title="Empty" className="my-class" />);
    expect((container.firstChild as HTMLElement)?.className).toContain('my-class');
  });
});
