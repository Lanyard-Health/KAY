import { lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../services/api';
import { useAuthStore } from '../../../stores/auth.store';
import { dashboardGreeting } from '../greeting';
import PageTransition from '../../../components/ui/PageTransition';
import ErrorState from '../../../components/ui/ErrorState';
import RefreshIndicator from '../../../components/RefreshIndicator';
import CountTile from '../practice/CountTile';
import WorkQueue, { type QueueItemView } from './WorkQueue';
import { STATUS_META, STAFF_DELAYED, NEEDS_FOLLOW_UP } from './staffMeta';

const StaffCharts = lazy(() => import('./StaffCharts'));

interface StaffPayload {
  tiles: { submittedThisWeek: number; needsFollowUp: number; delayed: number; inIntake: number };
  queue: QueueItemView[];
  charts: {
    pipelineByStage: Array<{ stage: 'intake' | 'in_progress' | 'submitted' | 'pending_review' | 'delayed'; count: number }>;
    submissionsByWeek: Array<{ weekStart: string; count: number }>;
  };
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-3.5">
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => <div key={i} className="h-28 rounded-2xl bg-gray-200" />)}
      </div>
      <div className="h-72 rounded-2xl bg-gray-200" />
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <div className="h-64 rounded-2xl bg-gray-200" />
        <div className="h-64 rounded-2xl bg-gray-200" />
      </div>
    </div>
  );
}

export default function StaffDashboard() {
  const { user } = useAuthStore();

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['staff-dashboard'],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: StaffPayload }>('/dashboard/staff');
      return res.data.data;
    },
  });

  const scrollToQueue = () => {
    document.getElementById('queue')?.scrollIntoView({ block: 'start' });
  };

  // Failed background refetch keeps the last good data on screen (slice-1 rule).
  if (error && !data) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Dashboard</h1>
        <ErrorState
          title="We couldn't load your work queue right now."
          message="Check your connection and try again."
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  return (
    <PageTransition>
      <div className="mx-auto max-w-[1080px] space-y-3.5">
        <div className="rounded-2xl bg-gradient-to-br from-primary-600 via-primary-700 to-primary-800 p-8 text-white">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{dashboardGreeting(user?.firstName)}</h1>
            <RefreshIndicator isFetching={isFetching && !isLoading} />
          </div>
          <p className="mt-1 text-primary-100">Your work across all practices, sorted by urgency.</p>
        </div>

        {isLoading || !data ? (
          <Skeleton />
        ) : (
          <>
            {/* 1 — Count tiles */}
            <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
              {/* Approximate filter: the list supports one ?status= value, so it
                  can't reproduce the tile's applicationDate-window count. */}
              <CountTile value={data.tiles.submittedThisWeek} chip="Submitted this week" chipClass={STATUS_META.submitted.chip} to="/enrollments?status=submitted" />
              <CountTile value={data.tiles.needsFollowUp} chip={NEEDS_FOLLOW_UP.label} chipClass={NEEDS_FOLLOW_UP.chip} onClick={scrollToQueue} hot={data.tiles.needsFollowUp > 0} />
              <CountTile value={data.tiles.delayed} chip="Delayed past window" chipClass={STAFF_DELAYED.chip} onClick={scrollToQueue} hot={data.tiles.delayed > 0} />
              <CountTile value={data.tiles.inIntake} chip="In intake" chipClass={STATUS_META.not_started.chip} to="/enrollments?status=not_started" />
            </div>

            {/* 2 — Work queue */}
            <WorkQueue items={data.queue} />

            {/* 3 — Charts */}
            <Suspense fallback={<div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2"><div className="h-64 animate-pulse rounded-2xl bg-gray-200" /><div className="h-64 animate-pulse rounded-2xl bg-gray-200" /></div>}>
              <StaffCharts pipelineByStage={data.charts.pipelineByStage} submissionsByWeek={data.charts.submissionsByWeek} />
            </Suspense>
          </>
        )}
      </div>
    </PageTransition>
  );
}
