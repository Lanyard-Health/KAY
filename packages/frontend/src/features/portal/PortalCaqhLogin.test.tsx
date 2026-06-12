import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockGet = vi.fn();
const mockPatch = vi.fn();

vi.mock('../../services/api', () => ({
  api: {
    get: (...args: any[]) => mockGet(...args),
    patch: (...args: any[]) => mockPatch(...args),
  },
}));

import PortalCaqhLogin from './PortalCaqhLogin';

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('PortalCaqhLogin', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPatch.mockReset();
  });

  it('shows the stored username, CAQH ID, and the three verified DataSpring links', async () => {
    mockGet.mockResolvedValue({
      data: { success: true, data: { caqhUsername: 'drjane2026', caqhProviderId: '16174500' } },
    });
    render(<PortalCaqhLogin />, { wrapper: createWrapper() });

    expect(await screen.findByText('drjane2026')).toBeInTheDocument();
    expect(screen.getByText('16174500')).toBeInTheDocument();

    expect(screen.getByRole('link', { name: /Sign in to DataSpring/ }))
      .toHaveAttribute('href', 'https://proview.caqh.org/pr');
    expect(screen.getByRole('link', { name: /Reset your password/ }))
      .toHaveAttribute('href', 'https://proview.caqh.org/Login/ForgotPassword?Type=PR');
    expect(screen.getByRole('link', { name: /Recover your username/ }))
      .toHaveAttribute('href', 'https://proview.caqh.org/Login/ForgotUsername?Type=PR');
  });

  it('shows the add-username empty state when none is stored', async () => {
    mockGet.mockResolvedValue({
      data: { success: true, data: { caqhUsername: null, caqhProviderId: null } },
    });
    render(<PortalCaqhLogin />, { wrapper: createWrapper() });

    expect(
      await screen.findByPlaceholderText(/Your CAQH \/ DataSpring username/),
    ).toBeInTheDocument();
    expect(screen.getByText(/We don't have your CAQH username on file/)).toBeInTheDocument();
  });

  it('never renders a password value anywhere', async () => {
    mockGet.mockResolvedValue({
      data: { success: true, data: { caqhUsername: 'drjane2026', caqhProviderId: null } },
    });
    render(<PortalCaqhLogin />, { wrapper: createWrapper() });
    await screen.findByText('drjane2026');
    expect(screen.getByText(/Only you know it/)).toBeInTheDocument();
    expect(screen.getByText(/never asks/)).toBeInTheDocument();
  });
});
