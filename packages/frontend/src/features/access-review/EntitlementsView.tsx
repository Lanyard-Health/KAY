import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { MagnifyingGlassIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { useEntitlements, downloadEntitlementsCsv } from './hooks';
import type { EntitlementFilters } from './hooks';
import { RoleBadge, StatusBadge, PermissionChips, Pagination } from './shared';
import EmptyState from '../../components/ui/EmptyState';

const ROLE_OPTIONS = [
  { value: '', label: 'All Roles' },
  { value: 'admin', label: 'Admin' },
  { value: 'lanyard_staff', label: 'Lanyard Health Staff' },
  { value: 'credentialing_staff', label: 'Credentialing Staff' },
  { value: 'practice_admin', label: 'Practice Admin' },
  { value: 'provider', label: 'Provider' },
];

/**
 * User-by-user entitlement report: who has which role, which practices,
 * and exactly which permissions that role grants.
 */
export default function EntitlementsView() {
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setDebouncedSearch(value);
      setPage(1);
    }, 300);
  };

  const filters: EntitlementFilters = {
    page,
    ...(debouncedSearch && { search: debouncedSearch }),
    ...(roleFilter && { role: roleFilter }),
    ...(statusFilter && { status: statusFilter }),
  };

  const { data, isLoading } = useEntitlements(filters);

  const handleExport = async () => {
    setExporting(true);
    try {
      await downloadEntitlementsCsv(filters);
      toast.success('Access review exported');
    } catch (error: any) {
      toast.error(error?.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      {/* Filters + export */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            className="input pl-9"
            placeholder="Search by name or email..."
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
        </div>
        <select
          className="input w-auto"
          value={roleFilter}
          onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}
        >
          {ROLE_OPTIONS.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
        <select
          className="input w-auto"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
        >
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <button onClick={handleExport} disabled={exporting} className="btn-secondary whitespace-nowrap">
          <ArrowDownTrayIcon className="-ml-1 mr-2 h-5 w-5" />
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>

      {isLoading ? (
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
          title="No users found"
          description="Try adjusting your filters."
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50/80">
                <tr>
                  {['User', 'Role', 'Status', 'Practices', 'Effective Permissions'].map((h) => (
                    <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {data.data.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50 transition-colors align-top">
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
                    <td className="px-6 py-4">
                      <PermissionChips permissions={user.effectivePermissions} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPageChange={setPage} />
        </div>
      )}
    </div>
  );
}
