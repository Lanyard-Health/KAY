import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockGet = vi.fn();
const mockPut = vi.fn();

vi.mock('../../services/api', () => ({
  api: {
    get: (...args: any[]) => mockGet(...args),
    put: (...args: any[]) => mockPut(...args),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import OnboardingProgress from './OnboardingProgress';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

const mockProvidersData = {
  providers: [
    {
      id: 'p1',
      name: 'Dr. Smith',
      npi: '1234567890',
      providerType: 'physician',
      approvedAt: '2024-01-01',
      onboardingCompletedAt: null,
      onboardingProgress: { percentage: 50, steps: [], isComplete: false },
    },
    {
      id: 'p2',
      name: 'Dr. Jones',
      npi: '0987654321',
      providerType: 'nurse_practitioner',
      approvedAt: '2024-01-15',
      onboardingCompletedAt: '2024-02-01',
      onboardingProgress: { percentage: 100, steps: [], isComplete: true },
    },
  ],
  summary: { total: 2, completed: 1, inProgress: 1, notStarted: 0 },
};

const mockDocuments = [
  {
    id: 'd1',
    originalFileName: 'license.pdf',
    documentType: 'medical_license',
    reviewStatus: null,
    reviewNotes: null,
    createdAt: '2024-01-10',
    fileSize: 1024 * 512,
  },
  {
    id: 'd2',
    originalFileName: 'dea.pdf',
    documentType: 'dea_certificate',
    reviewStatus: 'approved',
    reviewNotes: null,
    createdAt: '2024-01-11',
    fileSize: 1024 * 1024 * 2,
    reviewedAt: '2024-01-12',
  },
];

describe('OnboardingProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading skeleton initially', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    render(<OnboardingProgress />, { wrapper: createWrapper() });

    expect(screen.getByText('Provider Onboarding')).toBeInTheDocument();
  });

  it('renders summary cards and providers table', async () => {
    mockGet.mockResolvedValue({ data: { data: mockProvidersData } });
    render(<OnboardingProgress />, { wrapper: createWrapper() });

    await screen.findByText('Dr. Smith');
    // Summary card labels exist (some appear in tabs too, use getAllByText)
    expect(screen.getByText('Total Approved')).toBeInTheDocument();
    expect(screen.getByText('Onboarding Complete')).toBeInTheDocument();
    // Provider data in the table
    expect(screen.getByText('1234567890')).toBeInTheDocument();
    expect(screen.getByText('Dr. Jones')).toBeInTheDocument();
    expect(screen.getByText('0987654321')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('filter tabs filter the provider list', async () => {
    mockGet.mockResolvedValue({ data: { data: mockProvidersData } });
    render(<OnboardingProgress />, { wrapper: createWrapper() });

    await screen.findByText('Dr. Smith');

    // Find the tab buttons in the filter nav
    const tabNav = document.querySelector('nav.-mb-px');
    const completeTab = Array.from(tabNav!.querySelectorAll('button')).find(
      (btn) => btn.textContent?.includes('Complete')
    );
    fireEvent.click(completeTab!);

    // Dr. Jones (complete) should still be visible, Dr. Smith (in progress) should be hidden
    expect(screen.getByText('Dr. Jones')).toBeInTheDocument();
    expect(screen.queryByText('Dr. Smith')).not.toBeInTheDocument();
  });

  it('opens review modal and shows documents with details', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/documents')) {
        return Promise.resolve({ data: { data: mockDocuments } });
      }
      return Promise.resolve({ data: { data: mockProvidersData } });
    });
    render(<OnboardingProgress />, { wrapper: createWrapper() });

    await screen.findByText('Dr. Smith');

    // Find the eye button in the actions column (last <td> in first data row)
    const rows = document.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
    const actionButton = rows[0].querySelector('td:last-child button')!;
    fireEvent.click(actionButton);

    // Modal should appear with document list
    await screen.findByText(/Portal Documents/);
    await screen.findByText('license.pdf');

    // Check file size rendering
    expect(screen.getByText(/512\.0 KB/)).toBeInTheDocument();
    expect(screen.getByText(/2\.0 MB/)).toBeInTheDocument();
    // Check reviewed timestamp
    expect(screen.getByText(/Reviewed/)).toBeInTheDocument();
    // Check download buttons exist
    const downloadButtons = screen.getAllByTitle('Download / Preview');
    expect(downloadButtons.length).toBe(2);
  });
});
