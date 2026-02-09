import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import toast from 'react-hot-toast';

const mockGenerateEmailMutation = {
  mutate: vi.fn(),
  data: null as any,
  isPending: false,
  isError: false,
};

vi.mock('../../hooks/useAi', () => ({
  useGenerateEmail: vi.fn(() => mockGenerateEmailMutation),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import AiEmailPreviewModal from './AiEmailPreviewModal';

const baseProps = {
  isOpen: true,
  onClose: vi.fn(),
  email: {
    subject: 'Follow-up on enrollment',
    body: 'Dear Payer, please provide an update.',
    htmlBody: '<p>Dear Payer, please provide an update.</p>',
    tone: 'polite' as const,
    escalationLevel: 1,
  },
  enrollmentId: 'enroll-1',
  recommendationId: 'rec-1',
  providerName: 'Dr. Jane Doe',
  payerName: 'Blue Cross',
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('AiEmailPreviewModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateEmailMutation.isError = false;
    mockGenerateEmailMutation.isPending = false;
    mockGenerateEmailMutation.data = null;
  });

  it('renders error banner when generateEmail.isError is true', () => {
    mockGenerateEmailMutation.isError = true;

    render(<AiEmailPreviewModal {...baseProps} />, { wrapper: createWrapper() });

    expect(screen.getByText(/regeneration failed/i)).toBeInTheDocument();
  });

  it('does not render error banner when there is no error', () => {
    mockGenerateEmailMutation.isError = false;

    render(<AiEmailPreviewModal {...baseProps} />, { wrapper: createWrapper() });

    expect(screen.queryByText(/regeneration failed/i)).not.toBeInTheDocument();
  });

  it('Copy & Use button calls toast.success', async () => {
    // Mock clipboard API
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });

    render(<AiEmailPreviewModal {...baseProps} />, { wrapper: createWrapper() });

    const copyButton = screen.getByRole('button', { name: /copy & use/i });
    fireEvent.click(copyButton);

    expect(toast.success).toHaveBeenCalledWith('Email content copied to clipboard.');
    expect(baseProps.onClose).toHaveBeenCalled();
  });
});
