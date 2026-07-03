import { lazy, Suspense, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../services/api';
import { useAuthStore } from '../../../stores/auth.store';
import { dashboardGreeting } from '../greeting';
import PageTransition from '../../../components/ui/PageTransition';
import ErrorState from '../../../components/ui/ErrorState';
import RefreshIndicator from '../../../components/RefreshIndicator';
import CountTile from './CountTile';
import EtaBar from './EtaBar';
import AttentionPanel from './AttentionPanel';
import StatusDotGrid, { type GridRowView } from './StatusDotGrid';
import { STATUS_META, DELAYED_META, type AttentionItemView } from './statusMeta';

const PracticeCharts = lazy(() => import('./PracticeCharts'));

interface PracticePayload {
  tiles: { inProgress: number; submitted: number; approved: number; approvedThisMonth: number; runningLong: number };
  charts: {
    approvedByPayer: Array<{ payerName: string; count: number }>;
    approvalsByMonth: Array<{ month: string; count: number }>;
  };
  grid: { payers: Array<{ id: string; name: string }>; rows: GridRowView[] };
  inFlight: Array<{
    enrollmentId: string; providerName: string; payerName: string;
    status: 'submitted' | 'pending_review';
    dayCount: number; minDays: number | null; maxDays: number | null; isDelayed: boolean;
  }>;
  attention: AttentionItemView[];
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-3.5">
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => <div key={i} className="h-28 rounded-2xl bg-gray-200" />)}
      </div>
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <div className="h-64 rounded-2xl bg-gray-200" />
        <div className="h-64 rounded-2xl bg-gray-200" />
      </div>
      <div className="h-72 rounded-2xl bg-gray-200" />
    </div>
  );
}

export default function PracticeDashboard() {
  const { user } = useAuthStore();

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['practice-dashboard'],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: PracticePayload }>('/dashboard/practice');
      return res.data.data;
    },
  });

  const scrollToAttention = () => {
    // behavior:'smooth' silently no-ops in some Chromium contexts (verified in
    // dev); instant scroll is reliable and matches reduced-motion preferences.
    document.getElementById('attention')?.scrollIntoView({ block: 'start' });
  };

  // Deep-link support (/#attention): the page transition on mount interrupts an
  // immediate smooth scroll, so wait for it to settle before scrolling.
  const { hash } = useLocation();
  useEffect(() => {
    if (hash === '#attention' && !isLoading) {
      const t = setTimeout(scrollToAttention, 450);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [hash, isLoading]);

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Dashboard</h1>
        <ErrorState
          title="We couldn't load your dashboard right now."
          message="Check your connection and try again."
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const totalEnrollments = data ? data.grid.rows.reduce((s, r) => s + r.totalCount, 0) : 0;

  return (
    <PageTransition>
      <div className="mx-auto max-w-[1080px] space-y-3.5">
        {/* Greeting header (kept from the previous practice dashboard) */}
        <div className="rounded-2xl bg-gradient-to-br from-primary-600 via-primary-700 to-primary-800 p-8 text-white">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{dashboardGreeting(user?.firstName)}</h1>
            <RefreshIndicator isFetching={isFetching && !isLoading} />
          </div>
          <p className="mt-1 text-primary-100">Where every enrollment stands, at a glance.</p>
        </div>

        {isLoading || !data ? (
          <Skeleton />
        ) : (
          <>
            {/* 1 — Count tiles (each tile is a filter) */}
            <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
              <CountTile value={data.tiles.inProgress} chip={STATUS_META.in_progress.label} chipClass={STATUS_META.in_progress.chip} to="/enrollments?status=in_progress" />
              <CountTile value={data.tiles.submitted} chip={STATUS_META.submitted.label} chipClass={STATUS_META.submitted.chip} to="/enrollments?status=submitted" />
              <CountTile
                value={data.tiles.approved}
                chip={STATUS_META.approved.label}
                chipClass={STATUS_META.approved.chip}
                to="/enrollments?status=approved"
                delta={data.tiles.approvedThisMonth > 0 ? `+${data.tiles.approvedThisMonth} this month` : undefined}
              />
              <CountTile value={data.tiles.runningLong} chip={DELAYED_META.label} chipClass={DELAYED_META.chip} onClick={scrollToAttention} hot={data.tiles.runningLong > 0} />
            </div>

            {/* 2 — Charts */}
            <Suspense fallback={<div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2"><div className="h-64 animate-pulse rounded-2xl bg-gray-200" /><div className="h-64 animate-pulse rounded-2xl bg-gray-200" /></div>}>
              <PracticeCharts approvedByPayer={data.charts.approvedByPayer} approvalsByMonth={data.charts.approvalsByMonth} />
            </Suspense>

            {/* 3 — Provider × payer grid */}
            {data.grid.rows.length > 0 ? (
              <StatusDotGrid payers={data.grid.payers} rows={data.grid.rows} />
            ) : (
              <div className="rounded-2xl border border-gray-200/60 bg-white p-8 text-center shadow-sm">
                <p className="text-sm text-gray-700">Enrollments will appear here as Lanyard begins them for your providers.</p>
              </div>
            )}

            {/* 4 + 5 — In flight & attention */}
            <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1.7fr,1fr]">
              <div className="rounded-2xl border border-gray-200/60 bg-white p-5 shadow-sm">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">In flight — where each application stands</h2>
                {data.inFlight.length === 0 ? (
                  <p className="mt-4 text-sm text-gray-700">Nothing is in flight right now.</p>
                ) : (
                  <ul className="mt-4 space-y-4">
                    {data.inFlight.map((item) => (
                      <li key={item.enrollmentId}>
                        <div className="mb-1 flex items-baseline justify-between gap-2">
                          <span className="text-sm font-semibold text-gray-900">
                            {item.providerName} — {item.payerName}
                            <span className={`ml-2 rounded-lg px-2 py-0.5 text-xs font-semibold ${item.isDelayed ? DELAYED_META.chip : STATUS_META[item.status].chip}`}>
                              {item.isDelayed ? DELAYED_META.label : STATUS_META[item.status].label}
                            </span>
                          </span>
                        </div>
                        <EtaBar dayCount={item.dayCount} minDays={item.minDays} maxDays={item.maxDays} isDelayed={item.isDelayed} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <AttentionPanel items={data.attention} approvedCount={data.tiles.approved} totalCount={totalEnrollments} />
            </div>
          </>
        )}
      </div>
    </PageTransition>
  );
}
