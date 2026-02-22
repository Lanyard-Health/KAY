import { useCallback } from 'react';
import clsx from 'clsx';
import {
  CreditCardIcon,
  DocumentTextIcon,
  ArrowTopRightOnSquareIcon,
  ExclamationTriangleIcon,
  ArrowDownTrayIcon,
} from '@heroicons/react/24/outline';
import {
  useSubscription,
  useInvoices,
  useCreateCheckout,
  useCreatePortal,
  type Invoice,
} from '../../hooks/useBilling';

// ── Helpers ────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function daysUntil(iso: string | null): number {
  if (!iso) return 0;
  const now = new Date();
  const target = new Date(iso);
  const diff = target.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

const statusStyles: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  TRIALING: 'bg-amber-100 text-amber-700',
  PAST_DUE: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-red-100 text-red-700',
  PAUSED: 'bg-gray-100 text-gray-600',
};

const invoiceStatusStyles: Record<string, string> = {
  paid: 'bg-green-100 text-green-700',
  open: 'bg-amber-100 text-amber-700',
  draft: 'bg-gray-100 text-gray-600',
  void: 'bg-gray-100 text-gray-500',
  uncollectible: 'bg-red-100 text-red-700',
};

const planLabels: Record<string, string> = {
  STARTER: 'Starter',
  PROFESSIONAL: 'Professional',
  ENTERPRISE: 'Enterprise',
};

// ── Skeleton Components ──────────────────────────

function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={clsx('animate-pulse bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6', className)}>
      <div className="h-4 w-32 bg-gray-200 rounded mb-4" />
      <div className="h-6 w-24 bg-gray-200 rounded mb-3" />
      <div className="h-3 w-48 bg-gray-200 rounded mb-2" />
      <div className="h-3 w-40 bg-gray-200 rounded" />
    </div>
  );
}

function SkeletonTable() {
  return (
    <div className="animate-pulse bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6">
      <div className="h-4 w-32 bg-gray-200 rounded mb-6" />
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-6 py-3 border-b border-gray-100 last:border-0">
          <div className="h-3 w-24 bg-gray-100 rounded" />
          <div className="h-3 w-16 bg-gray-100 rounded" />
          <div className="h-3 w-16 bg-gray-100 rounded" />
          <div className="h-3 w-32 bg-gray-100 rounded" />
          <div className="h-3 w-12 bg-gray-100 rounded" />
        </div>
      ))}
    </div>
  );
}

// ── Main Component ───────────────────────────────

export default function BillingPage() {
  const { data: subscription, isLoading: subLoading, error: subError } = useSubscription();
  const { data: invoices, isLoading: invLoading, error: invError } = useInvoices();
  const createCheckout = useCreateCheckout();
  const createPortal = useCreatePortal();

  const handleCheckout = useCallback(
    async (plan: string) => {
      try {
        const result = await createCheckout.mutateAsync({ plan });
        window.location.href = result.url;
      } catch {
        // error handled by mutation state
      }
    },
    [createCheckout],
  );

  const handlePortal = useCallback(async () => {
    try {
      const result = await createPortal.mutateAsync();
      window.location.href = result.url;
    } catch {
      // error handled by mutation state
    }
  }, [createPortal]);

  const isLoading = subLoading || invLoading;
  const hasError = subError || invError;

  // ── Loading State ─────────────────────────────
  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <div>
          <div className="h-7 w-56 bg-gray-200 rounded animate-pulse mb-2" />
          <div className="h-4 w-80 bg-gray-100 rounded animate-pulse" />
        </div>
        <SkeletonCard />
        <SkeletonTable />
      </div>
    );
  }

  // ── Error State ───────────────────────────────
  if (hasError) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 flex items-start gap-3">
          <ExclamationTriangleIcon className="h-6 w-6 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-red-800">Failed to load billing information</h3>
            <p className="text-sm text-red-600 mt-1">
              {(subError as Error)?.message || (invError as Error)?.message || 'An unexpected error occurred.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const trialDays = subscription?.trialEndsAt ? daysUntil(subscription.trialEndsAt) : 0;
  const providerPct =
    subscription && subscription.providerLimit > 0
      ? Math.round((subscription.providerCount / subscription.providerLimit) * 100)
      : 0;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      {/* ── Header ───────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Billing &amp; Subscription</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage your plan, payment method, and view invoice history.
        </p>
      </div>

      {/* ── Trial Banner ─────────────────────────── */}
      {subscription?.status === 'TRIALING' && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <ExclamationTriangleIcon className="h-5 w-5 text-amber-600 flex-shrink-0" />
            <p className="text-sm font-medium text-amber-800">
              {trialDays} {trialDays === 1 ? 'day' : 'days'} left in your free trial
              {subscription.trialEndsAt && (
                <span className="text-amber-600 font-normal">
                  {' '}&mdash; ends {formatDate(subscription.trialEndsAt)}
                </span>
              )}
            </p>
          </div>
          <button
            onClick={() => handleCheckout(subscription.plan)}
            disabled={createCheckout.isPending}
            className="flex-shrink-0 inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors disabled:opacity-50"
          >
            <CreditCardIcon className="h-4 w-4" />
            {createCheckout.isPending ? 'Redirecting...' : 'Add Payment Method'}
          </button>
        </div>
      )}

      {/* ── Current Plan Card ────────────────────── */}
      {subscription ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6">
          <div className="flex items-start justify-between mb-5">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold text-gray-900">Current Plan</h2>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary-100 text-primary-700">
                  {planLabels[subscription.plan] || subscription.plan}
                </span>
                <span
                  className={clsx(
                    'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold',
                    statusStyles[subscription.status] || 'bg-gray-100 text-gray-600',
                  )}
                >
                  {subscription.status}
                </span>
              </div>
              {subscription.currentPeriodStart && subscription.currentPeriodEnd && (
                <p className="mt-1 text-sm text-gray-500">
                  Current period: {formatShortDate(subscription.currentPeriodStart)} &mdash;{' '}
                  {formatDate(subscription.currentPeriodEnd)}
                </p>
              )}
            </div>
          </div>

          {/* Provider usage */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-medium text-gray-700">Provider usage</span>
              <span className="text-sm text-gray-500">
                {subscription.providerCount} of {subscription.providerLimit} providers
              </span>
            </div>
            <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={clsx(
                  'h-full rounded-full transition-all duration-300',
                  providerPct >= 90 ? 'bg-red-500' : providerPct >= 70 ? 'bg-amber-500' : 'bg-primary-500',
                )}
                style={{ width: `${Math.min(providerPct, 100)}%` }}
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => handleCheckout(subscription.plan)}
              disabled={createCheckout.isPending}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors disabled:opacity-50"
            >
              <ArrowTopRightOnSquareIcon className="h-4 w-4" />
              {createCheckout.isPending ? 'Redirecting...' : 'Upgrade Plan'}
            </button>
            <button
              onClick={handlePortal}
              disabled={createPortal.isPending}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg transition-colors disabled:opacity-50"
            >
              <CreditCardIcon className="h-4 w-4" />
              {createPortal.isPending ? 'Redirecting...' : 'Manage Billing'}
            </button>
          </div>

          {/* Mutation errors */}
          {(createCheckout.error || createPortal.error) && (
            <p className="mt-3 text-sm text-red-600">
              {(createCheckout.error as Error)?.message ||
                (createPortal.error as Error)?.message ||
                'Something went wrong. Please try again.'}
            </p>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6 text-center">
          <DocumentTextIcon className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">No active subscription found.</p>
          <button
            onClick={() => handleCheckout('STARTER')}
            disabled={createCheckout.isPending}
            className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors disabled:opacity-50"
          >
            {createCheckout.isPending ? 'Redirecting...' : 'Get Started'}
          </button>
        </div>
      )}

      {/* ── Invoice History ──────────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Invoice History</h2>
        </div>

        {invoices && invoices.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide border-b border-gray-100">
                  <th className="px-6 py-3">Date</th>
                  <th className="px-6 py-3">Amount</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Period</th>
                  <th className="px-6 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {invoices.map((invoice: Invoice) => (
                  <tr key={invoice.id} className="hover:bg-gray-50/50">
                    <td className="px-6 py-3 text-gray-900">
                      {formatDate(invoice.createdAt)}
                    </td>
                    <td className="px-6 py-3 font-medium text-gray-900">
                      {formatCents(invoice.amount)}
                    </td>
                    <td className="px-6 py-3">
                      <span
                        className={clsx(
                          'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold',
                          invoiceStatusStyles[invoice.status] || 'bg-gray-100 text-gray-600',
                        )}
                      >
                        {invoice.status}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-gray-500">
                      {formatShortDate(invoice.periodStart)} &mdash; {formatShortDate(invoice.periodEnd)}
                    </td>
                    <td className="px-6 py-3">
                      {invoice.pdfUrl ? (
                        <a
                          href={invoice.pdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-primary-600 hover:text-primary-700 font-medium"
                        >
                          <ArrowDownTrayIcon className="h-4 w-4" />
                          PDF
                        </a>
                      ) : invoice.invoiceUrl ? (
                        <a
                          href={invoice.invoiceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-primary-600 hover:text-primary-700 font-medium"
                        >
                          <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                          View
                        </a>
                      ) : (
                        <span className="text-gray-400">&mdash;</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-6 py-12 text-center">
            <DocumentTextIcon className="h-10 w-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No invoices yet</p>
          </div>
        )}
      </div>
    </div>
  );
}
