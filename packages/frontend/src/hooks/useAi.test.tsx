import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import toast from 'react-hot-toast';

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { api } from '../services/api';
import {
  useGenerateEmail,
  useAnalyzeEnrollment,
  useAnalyzePortfolio,
  useUpdateRecommendation,
} from './useAi';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useAi mutation hooks — error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('useGenerateEmail calls toast.error on API failure', async () => {
    const apiError = new Error('Request failed');
    (apiError as any).response = { data: { error: 'Budget exceeded' }, status: 429 };
    (api.post as any).mockRejectedValue(apiError);

    const { result } = renderHook(() => useGenerateEmail(), { wrapper: createWrapper() });

    result.current.mutate({ enrollmentId: 'e1' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toast.error).toHaveBeenCalledWith('Budget exceeded');
  });

  it('useAnalyzeEnrollment calls toast.error on API failure', async () => {
    const apiError = new Error('Request failed');
    (apiError as any).response = { data: { error: 'Enrollment not found' }, status: 404 };
    (api.post as any).mockRejectedValue(apiError);

    const { result } = renderHook(() => useAnalyzeEnrollment(), { wrapper: createWrapper() });

    result.current.mutate('e1');

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toast.error).toHaveBeenCalledWith('Enrollment not found');
  });

  it('useAnalyzePortfolio calls toast.error on API failure', async () => {
    const apiError = new Error('Request failed');
    (apiError as any).response = { data: { error: 'AI not configured' }, status: 503 };
    (api.post as any).mockRejectedValue(apiError);

    const { result } = renderHook(() => useAnalyzePortfolio(), { wrapper: createWrapper() });

    result.current.mutate();

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toast.error).toHaveBeenCalledWith('AI not configured');
  });

  it('useUpdateRecommendation calls toast.error on API failure', async () => {
    const apiError = new Error('Request failed');
    (apiError as any).response = { data: { error: 'Recommendation not found' }, status: 404 };
    (api.patch as any).mockRejectedValue(apiError);

    const { result } = renderHook(() => useUpdateRecommendation(), { wrapper: createWrapper() });

    result.current.mutate({ id: 'rec-1', status: 'accepted' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toast.error).toHaveBeenCalledWith('Recommendation not found');
  });

  it('falls back to error.message when response.data.error is missing', async () => {
    const apiError = new Error('Network failure');
    (api.post as any).mockRejectedValue(apiError);

    const { result } = renderHook(() => useGenerateEmail(), { wrapper: createWrapper() });

    result.current.mutate({ enrollmentId: 'e1' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toast.error).toHaveBeenCalledWith('Network failure');
  });
});
