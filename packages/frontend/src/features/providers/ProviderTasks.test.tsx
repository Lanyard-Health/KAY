import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockUseTasks = vi.fn();
const mockUseTerminationLetters = vi.fn();

vi.mock('../../hooks/useTasks', () => ({
  useTasks: (...args: any[]) => mockUseTasks(...args),
  useTerminationLetters: (...args: any[]) => mockUseTerminationLetters(...args),
}));

// Mock child modals
vi.mock('./TaskStatusUpdateModal', () => ({
  default: ({ task, onClose }: any) => (
    <div data-testid="task-modal">
      <span>{task.title}</span>
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

vi.mock('./TerminationLetterModal', () => ({
  default: ({ letterId, onClose }: any) => (
    <div data-testid="letter-modal">
      <span>{letterId}</span>
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

import ProviderTasks from './ProviderTasks';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

const mockTasks = [
  {
    id: 't1',
    title: 'Terminate Aetna enrollment',
    type: 'TERMINATE_ENROLLMENT',
    status: 'PENDING',
    enrollment: { payer: { name: 'Aetna' } },
    assignedTo: { firstName: 'Jane', lastName: 'Admin' },
    dueDate: '2024-03-01',
  },
  {
    id: 't2',
    title: 'Check Availity listing',
    type: 'CHECK_AVAILITY',
    status: 'COMPLETED',
    enrollment: { payer: { name: 'UHC' } },
    assignedTo: null,
    dueDate: null,
  },
];

describe('ProviderTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseTerminationLetters.mockReturnValue({ data: { data: [] } });
  });

  it('shows loading skeleton when loading', () => {
    mockUseTasks.mockReturnValue({ data: null, isLoading: true, error: null });
    render(<ProviderTasks providerId="p1" />, { wrapper: createWrapper() });

    // Skeleton renders animated pulse divs
    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('shows error state on failure', () => {
    mockUseTasks.mockReturnValue({ data: null, isLoading: false, error: new Error('fail') });
    render(<ProviderTasks providerId="p1" />, { wrapper: createWrapper() });

    expect(screen.getByText(/Failed to load tasks/)).toBeInTheDocument();
  });

  it('shows empty state when no tasks', () => {
    mockUseTasks.mockReturnValue({ data: { data: [] }, isLoading: false, error: null });
    render(<ProviderTasks providerId="p1" />, { wrapper: createWrapper() });

    expect(screen.getByText('No Tasks')).toBeInTheDocument();
  });

  it('renders task list with columns', () => {
    mockUseTasks.mockReturnValue({ data: { data: mockTasks }, isLoading: false, error: null });
    render(<ProviderTasks providerId="p1" />, { wrapper: createWrapper() });

    expect(screen.getByText('Terminate Aetna enrollment')).toBeInTheDocument();
    expect(screen.getByText('Aetna')).toBeInTheDocument();
    // "Terminate Enrollment" appears in both the type filter dropdown and the table cell
    expect(screen.getAllByText('Terminate Enrollment').length).toBeGreaterThanOrEqual(2);
    // "Pending" appears in both the status filter dropdown and the status badge
    expect(screen.getAllByText('Pending').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Jane Admin')).toBeInTheDocument();
    expect(screen.getByText('Check Availity listing')).toBeInTheDocument();
    // "Completed" appears in both the status filter dropdown and the status badge
    expect(screen.getAllByText('Completed').length).toBeGreaterThanOrEqual(2);
  });

  it('shows pending count badge', () => {
    mockUseTasks.mockReturnValue({ data: { data: mockTasks }, isLoading: false, error: null });
    render(<ProviderTasks providerId="p1" />, { wrapper: createWrapper() });

    expect(screen.getByText('1 pending')).toBeInTheDocument();
  });

  it('has status and type filter dropdowns', () => {
    mockUseTasks.mockReturnValue({ data: { data: mockTasks }, isLoading: false, error: null });
    render(<ProviderTasks providerId="p1" />, { wrapper: createWrapper() });

    const selects = screen.getAllByRole('combobox');
    expect(selects).toHaveLength(2);

    // Change status filter
    fireEvent.change(selects[0], { target: { value: 'PENDING' } });
    expect(mockUseTasks).toHaveBeenCalledWith('p1', { status: 'PENDING' });
  });

  it('opens task modal when clicking a row', () => {
    mockUseTasks.mockReturnValue({ data: { data: mockTasks }, isLoading: false, error: null });
    render(<ProviderTasks providerId="p1" />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByText('Terminate Aetna enrollment'));
    expect(screen.getByTestId('task-modal')).toBeInTheDocument();
  });
});
