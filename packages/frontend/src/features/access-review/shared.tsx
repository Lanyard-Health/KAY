import clsx from 'clsx';

export const ROLE_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  admin: { bg: 'bg-purple-100', text: 'text-purple-800', label: 'Admin' },
  lanyard_staff: { bg: 'bg-indigo-100', text: 'text-indigo-800', label: 'Lanyard Health Staff' },
  credentialing_staff: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Credentialing Staff' },
  provider: { bg: 'bg-green-100', text: 'text-green-800', label: 'Provider' },
  practice_admin: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Practice Admin' },
};

export function RoleBadge({ role }: { role: string }) {
  const badge = ROLE_BADGE[role] || { bg: 'bg-gray-100', text: 'text-gray-800', label: role };
  return (
    <span className={clsx('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium', badge.bg, badge.text)}>
      {badge.label}
    </span>
  );
}

export function StatusBadge({ isActive }: { isActive: boolean }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
        isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
      )}
    >
      {isActive ? 'Active' : 'Inactive'}
    </span>
  );
}

export function PermissionChips({ permissions }: { permissions: string[] }) {
  return (
    <div className="flex flex-wrap gap-1 max-w-md">
      {permissions.map((p) => (
        <span
          key={p}
          className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 text-[11px] font-mono"
        >
          {p}
        </span>
      ))}
      {permissions.length === 0 && <span className="text-xs text-gray-400">none</span>}
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  total,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200 text-sm">
      <span className="text-gray-500">
        Page {page} of {totalPages} · {total} total
      </span>
      <div className="flex gap-2">
        <button
          className="btn-secondary px-3 py-1 text-sm disabled:opacity-50"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </button>
        <button
          className="btn-secondary px-3 py-1 text-sm disabled:opacity-50"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
