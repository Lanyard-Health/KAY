import { useQuery } from '@tanstack/react-query';
import { api } from '../../../services/api';
import ErrorState from '../../../components/ui/ErrorState';
import CountTile from '../practice/CountTile';
import { DELAYED_META } from '../practice/statusMeta';

interface AdminPayload {
  tiles: { activePractices: number; openApplications: number; approvedThisQuarter: number; delayedPlatformWide: number };
  churnRisk: Array<{ practiceId: string; practiceName: string; delayedCount: number; overdueFollowUps: number; openCount: number }>;
}

// Chips reuse the slice 1 soft-chip look; "Delayed platform-wide" is sanctioned
// staff shop-talk (EXPERIENCE.md two-vocabulary rule) and carries the warm treatment.
const CHIP_NEUTRAL = 'bg-gray-100 text-gray-700';
const CHIP_TEAL = 'bg-[#E0F2F6] text-[#0E7490]';
const CHIP_GREEN = 'bg-[#E7F3EC] text-[#15803D]';

export default function AdminDashboard({ onViewPractice }: { onViewPractice: (practiceId: string) => void }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: AdminPayload }>('/dashboard/admin');
      return res.data.data;
    },
  });

  if (error && !data) {
    return (
      <ErrorState
        title="We couldn't load the platform overview right now."
        message="Check your connection and try again."
        onRetry={() => refetch()}
      />
    );
  }

  if (isLoading || !data) {
    return (
      <div className="animate-pulse space-y-3.5">
        <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-28 rounded-2xl bg-gray-200" />)}
        </div>
        <div className="h-56 rounded-2xl bg-gray-200" />
      </div>
    );
  }

  return (
    <div className="space-y-3.5">
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <CountTile value={data.tiles.activePractices} chip="Active practices" chipClass={CHIP_NEUTRAL} to="/practices" />
        <CountTile value={data.tiles.openApplications} chip="Open applications" chipClass={CHIP_TEAL} to="/enrollments" />
        <CountTile value={data.tiles.approvedThisQuarter} chip="Approved this quarter" chipClass={CHIP_GREEN} to="/enrollments?status=approved" />
        <CountTile value={data.tiles.delayedPlatformWide} chip="Delayed platform-wide" chipClass={DELAYED_META.chip} hot={data.tiles.delayedPlatformWide > 0} />
      </div>

      <div className="rounded-2xl border border-gray-200/60 bg-white p-5 shadow-sm">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Practices needing attention</h2>
        {data.churnRisk.length === 0 ? (
          <p className="mt-4 text-sm text-gray-700">
            No practices need attention right now — nothing delayed, no overdue follow-ups.
          </p>
        ) : (
          <table className="mt-3 w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                <th className="px-2 py-2">Practice</th>
                <th className="px-2 py-2 text-right">Delayed</th>
                <th className="px-2 py-2 text-right">Overdue follow-ups</th>
                <th className="px-2 py-2 text-right">Open</th>
              </tr>
            </thead>
            <tbody>
              {data.churnRisk.map((c) => (
                <tr key={c.practiceId} className="border-t border-gray-100">
                  <td className="px-2 py-2.5">
                    <button
                      type="button"
                      onClick={() => onViewPractice(c.practiceId)}
                      className="font-semibold text-gray-900 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                    >
                      {c.practiceName}
                    </button>
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{c.delayedCount}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{c.overdueFollowUps}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{c.openCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
