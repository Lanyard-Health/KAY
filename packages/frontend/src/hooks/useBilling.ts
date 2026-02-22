import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../services/api';

// ── Types ────────────────────────────────────────

export interface Subscription {
  id: string;
  practiceId: string;
  plan: 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE';
  status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'PAUSED';
  providerCount: number;
  providerLimit: number;
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelledAt: string | null;
  createdAt: string;
}

export interface Invoice {
  id: string;
  stripeInvoiceId: string;
  amount: number; // cents
  status: string;
  invoiceUrl: string | null;
  pdfUrl: string | null;
  periodStart: string;
  periodEnd: string;
  paidAt: string | null;
  createdAt: string;
}

// ── Query Hooks ──────────────────────────────────

export function useSubscription() {
  return useQuery({
    queryKey: ['billing-subscription'],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Subscription | null }>('/billing/subscription');
      return res.data.data;
    },
  });
}

export function useInvoices() {
  return useQuery({
    queryKey: ['billing-invoices'],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Invoice[] }>('/billing/invoices');
      return res.data.data;
    },
  });
}

// ── Mutation Hooks ───────────────────────────────

export function useCreateCheckout() {
  return useMutation({
    mutationFn: async (data: { plan: string }) => {
      const res = await api.post<{ success: boolean; data: { url: string } }>('/billing/create-checkout', data);
      return res.data.data;
    },
  });
}

export function useCreatePortal() {
  return useMutation({
    mutationFn: async () => {
      const res = await api.post<{ success: boolean; data: { url: string } }>('/billing/create-portal');
      return res.data.data;
    },
  });
}
