import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import toast from 'react-hot-toast';

// Mock all hooks used by the dashboard
const mockAnalyzePortfolio = {
  mutateAsync: vi.fn(),
  isPending: false,
};
const mockGenerateEmail = {
  mutateAsync: vi.fn(),
  isPending: false,
};
const mockUpdateRecommendation = {
  mutate: vi.fn(),
};

vi.mock('../../hooks/useAi', () => ({
  useAiStatus: vi.fn(() => ({ data: { data: { configured: true, model: 'test-model' } }, isLoading: false })),
  useAiUsage: vi.fn(() => ({
    data: {
      data: {
        budget: { used: 1000, daily: 100000, remaining: 99000, allowed: true, percentUsed: 1 },
      },
    },
  })),
  useAiRecommendations: vi.fn(() => ({ data: { data: [] }, isLoading: false })),
  useAnalyzePortfolio: vi.fn(() => mockAnalyzePortfolio),
  useGenerateEmail: vi.fn(() => mockGenerateEmail),
  useUpdateRecommendation: vi.fn(() => mockUpdateRecommendation),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

// Must mock the child modal to keep test focused
vi.mock('./AiEmailPreviewModal', () => ({
  default: () => <div data-testid="email-modal">Modal</div>,
}));

import AiAgentDashboard from './AiAgentDashboard';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('AiAgentDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls toast.error (not window.alert) when portfolio analysis fails', async () => {
    mockAnalyzePortfolio.mutateAsync.mockRejectedValue(new Error('Budget exceeded'));

    render(<AiAgentDashboard />, { wrapper: createWrapper() });

    const runButton = screen.getByRole('button', { name: /run analysis/i });
    fireEvent.click(runButton);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Analysis failed'));
    });
  });

  it('calls toast.error when email generation fails', async () => {
    // Set up portfolio results so "Draft Email" buttons appear
    mockAnalyzePortfolio.mutateAsync.mockResolvedValue({
      data: {
        analysis: {
          enrollments: [{
            enrollmentId: 'e1',
            providerName: 'Jane Doe',
            payerName: 'Blue Cross',
            status: 'submitted',
            urgencyScore: 8,
            riskLevel: 'high',
            recommendation: 'Follow up',
            daysSinceApplication: 30,
            daysSinceLastFollowUp: 10,
          }],
          summary: 'One high priority enrollment.',
        },
      },
    });

    render(<AiAgentDashboard />, { wrapper: createWrapper() });

    // Click Run Analysis to populate the table
    const runButton = screen.getByRole('button', { name: /run analysis/i });
    fireEvent.click(runButton);

    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    });

    // Now make generateEmail fail and click Draft Email
    mockGenerateEmail.mutateAsync.mockRejectedValue(new Error('AI error'));

    const draftButton = screen.getByRole('button', { name: /draft email/i });
    fireEvent.click(draftButton);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Email generation failed'));
    });
  });
});
