import type { AuditLogEntry } from './hooks';

/**
 * Expanded detail for one audit entry: old → new change diff plus
 * request metadata (IP, user agent).
 */
export default function AuditEntryDetail({ entry }: { entry: AuditLogEntry }) {
  const changes = entry.changes as { before?: Record<string, unknown>; after?: Record<string, unknown> } | null;
  const hasBeforeAfter = changes && (changes.before || changes.after);
  const keys = hasBeforeAfter
    ? [...new Set([...Object.keys(changes?.before ?? {}), ...Object.keys(changes?.after ?? {})])]
    : [];

  const fmt = (v: unknown) =>
    v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v);

  return (
    <div className="bg-gray-50 px-6 py-4 text-sm space-y-3">
      {hasBeforeAfter ? (
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Changes</p>
          <table className="text-sm">
            <tbody>
              {keys.map((k) => (
                <tr key={k}>
                  <td className="pr-4 py-0.5 font-mono text-xs text-gray-500">{k}</td>
                  <td className="pr-2 py-0.5 text-red-700 line-through decoration-red-300">
                    {fmt(changes?.before?.[k])}
                  </td>
                  <td className="pr-2 py-0.5 text-gray-400">→</td>
                  <td className="py-0.5 text-green-700 font-medium">{fmt(changes?.after?.[k])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : entry.changes ? (
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Details</p>
          <pre className="text-xs bg-white border border-gray-200 rounded-lg p-3 overflow-x-auto max-h-48">
            {JSON.stringify(entry.changes, null, 2)}
          </pre>
        </div>
      ) : (
        <p className="text-gray-400 text-xs">No change details recorded.</p>
      )}
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500">
        {entry.resourceId && <span>Resource ID: <span className="font-mono">{entry.resourceId}</span></span>}
        {entry.ipAddress && <span>IP: {entry.ipAddress}</span>}
        {entry.userAgent && <span className="truncate max-w-md" title={entry.userAgent}>Agent: {entry.userAgent}</span>}
      </div>
    </div>
  );
}
