import { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePermissionCatalog, usePermissionUsers } from './hooks';
import { RoleBadge, StatusBadge, Pagination } from './shared';
import EmptyState from '../../components/ui/EmptyState';

/**
 * Permission-centric view: pick a permission, see every user who has it
 * (scoped server-side to what the viewer may see).
 */
export default function PermissionLookupView() {
  const [permission, setPermission] = useState('');
  const [page, setPage] = useState(1);

  const { data: catalog, isLoading: catalogLoading } = usePermissionCatalog();
  const { data, isLoading } = usePermissionUsers(permission, page);

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-end gap-3 mb-6">
        <div>
          <label className="label">Who can do…</label>
          <select
            className="input w-auto min-w-[240px] font-mono text-sm"
            value={permission}
            onChange={(e) => { setPermission(e.target.value); setPage(1); }}
          >
            <option value="">Select a permission</option>
            {(catalog ?? []).map((entry) => (
              <option key={entry.permission} value={entry.permission}>
                {entry.permission}
              </option>
            ))}
          </select>
        </div>
        {data && (
          <div className="text-sm text-gray-500 pb-2">
            Granted by role{data.grantedByRoles.length === 1 ? '' : 's'}:{' '}
            <span className="inline-flex flex-wrap gap-1 align-middle">
              {data.grantedByRoles.map((r) => <RoleBadge key={r} role={r} />)}
              {data.grantedByRoles.length === 0 && <span className="text-gray-400">none</span>}
            </span>
          </div>
        )}
      </div>

      {!permission ? (
        <EmptyState
          illustration="people"
          title="Select a permission"
          description={catalogLoading ? 'Loading permission catalog…' : 'Choose a permission above to see every user who holds it.'}
        />
      ) : isLoading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="card card-body animate-pulse">
              <div className="h-5 w-64 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
      ) : !data || data.data.length === 0 ? (
        <EmptyState
          illustration="people"
          title="No users hold this permission"
          description="No visible user has a role that grants this permission."
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50/80">
              <tr>
                {['User', 'Role', 'Status', 'Practices'].map((h) => (
                  <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {data.data.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <Link to={`/users/${user.id}`} className="text-sm font-medium text-primary-600 hover:text-primary-500">
                      {user.firstName} {user.lastName}
                    </Link>
                    <p className="text-xs text-gray-500">{user.email}</p>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap"><RoleBadge role={user.role} /></td>
                  <td className="px-6 py-4 whitespace-nowrap"><StatusBadge isActive={user.isActive} /></td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {user.practices.length > 0
                      ? user.practices.map((p) => p.practice.name).join(', ')
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPageChange={setPage} />
        </div>
      )}
    </div>
  );
}
