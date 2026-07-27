import { Link } from 'react-router-dom';
import { StatusBadge, useAetnaRuns, type RunSummary } from './shared';

/**
 * Aetna Submissions queue — cross-provider work list for the Aetna
 * "Join the Network" automation. Runs awaiting review surface at the top;
 * each row links to the enrollment page where review/approval happens.
 * Launching runs happens from the provider record (readiness card).
 */
export default function AetnaEnrollmentPage() {
  const { data: runs } = useAetnaRuns();

  const awaiting = (runs ?? []).filter((r) => r.status === 'AWAITING_REVIEW');

  const enrollmentLink = (r: RunSummary) => `/enrollments/${r.enrollmentId}?aetnaRun=${r.id}`;
  const providerName = (r: RunSummary) =>
    r.enrollment?.provider ? `${r.enrollment.provider.lastName}, ${r.enrollment.provider.firstName}` : '—';

  return (
    <div className="space-y-8" data-testid="aetna-enrollment-page">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Aetna Submissions</h1>
        <p className="text-sm text-gray-500 mt-1">
          Work queue for automated Aetna “Join the Network” applications. To start one, open a provider’s
          record — the readiness checklist and Launch button live next to their Payer Submission Details.
        </p>
      </div>

      {/* Awaiting review — the action items */}
      {awaiting.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-6" data-testid="aetna-awaiting-review">
          <h2 className="text-lg font-medium text-amber-900 mb-1">Awaiting your review</h2>
          <p className="text-sm text-amber-800 mb-4">
            These filled applications pause for 25 minutes — approve or reject before the session expires.
          </p>
          <ul className="space-y-2">
            {awaiting.map((r) => (
              <li key={r.id}>
                <Link
                  to={enrollmentLink(r)}
                  className="flex items-center justify-between bg-white border border-amber-200 rounded-md px-4 py-3 hover:border-amber-400"
                >
                  <span className="text-sm font-medium text-gray-900">{providerName(r)}</span>
                  <span className="text-sm text-primary-600">Review &amp; approve →</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Run history */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Run history</h2>
        {(runs ?? []).length === 0 ? (
          <p className="text-sm text-gray-500">
            No Aetna runs yet. Open a provider’s record and launch from their Aetna readiness card.
          </p>
        ) : (
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                <th className="py-2 pr-4">Provider</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Started</th>
                <th className="py-2 pr-4">Aetna Request ID</th>
                <th className="py-2 pr-4">Error</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(runs ?? []).map((r) => (
                <tr key={r.id}>
                  <td className="py-2 pr-4">
                    {r.enrollment?.provider
                      ? <Link className="text-primary-600 hover:underline" to={`/providers/${r.enrollment.provider.id}`}>{providerName(r)}</Link>
                      : '—'}
                  </td>
                  <td className="py-2 pr-4"><StatusBadge status={r.status} /></td>
                  <td className="py-2 pr-4 text-gray-600">{new Date(r.startedAt).toLocaleString()}</td>
                  <td className="py-2 pr-4 font-mono">{r.confirmationNumber || r.externalReference || '—'}</td>
                  <td className="py-2 pr-4 text-red-600 text-xs max-w-xs truncate">{r.errorDetails?.message || ''}</td>
                  <td className="py-2 text-right">
                    <Link className="text-primary-600 hover:underline" to={enrollmentLink(r)}>
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
