import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import PageTransition from '../../components/ui/PageTransition';
import { PlusIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';
import { useUsersList } from '../../hooks/useUserManagement';
import type { UserFilters } from '../../hooks/useUserManagement';
import UserFormModal from './UserFormModal';
import { AnimatedList, AnimatedListItem } from '../../components/ui/AnimatedList';
import EmptyState from '../../components/ui/EmptyState';

const ROLE_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  admin: { bg: 'bg-purple-100', text: 'text-purple-800', label: 'Admin' },
  credentialing_staff: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Credentialing Staff' },
  provider: { bg: 'bg-green-100', text: 'text-green-800', label: 'Provider' },
};

export default function UsersList() {
  const navigate = useNavigate();
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Debounce search
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchTimeout = useMemo(() => {
    return (value: string) => {
      const id = setTimeout(() => setDebouncedSearch(value), 300);
      return () => clearTimeout(id);
    };
  }, []);

  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    searchTimeout(value);
  };

  const filters: UserFilters = {
    ...(debouncedSearch && { search: debouncedSearch }),
    ...(roleFilter && { role: roleFilter }),
    ...(statusFilter && { status: statusFilter }),
  };

  const { data: users, isLoading } = useUsersList(filters);

  if (isLoading) {
    return (
      <div>
        <div className="sm:flex sm:items-center sm:justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Users</h1>
            <p className="mt-1 text-sm text-gray-500">Manage system users and their access</p>
          </div>
        </div>
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="card card-body animate-pulse">
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <div className="h-5 w-48 bg-gray-200 rounded" />
                  <div className="h-4 w-32 bg-gray-200 rounded" />
                </div>
                <div className="h-6 w-16 bg-gray-200 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <PageTransition>
    <div>
      <div className="sm:flex sm:items-center sm:justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Users</h1>
          <p className="mt-1 text-sm text-gray-500">Manage system users and their access</p>
        </div>
        <button
          onClick={() => setCreateModalOpen(true)}
          className="btn-primary mt-4 sm:mt-0"
        >
          <PlusIcon className="-ml-1 mr-2 h-5 w-5" />
          Add User
        </button>
      </div>

      {/* Filters */}
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
          onChange={(e) => setRoleFilter(e.target.value)}
        >
          <option value="">All Roles</option>
          <option value="admin">Admin</option>
          <option value="credentialing_staff">Credentialing Staff</option>
          <option value="provider">Provider</option>
        </select>
        <select
          className="input w-auto"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {!users || users.length === 0 ? (
        <EmptyState
          illustration="people"
          title="No users found"
          description={debouncedSearch || roleFilter || statusFilter ? 'Try adjusting your filters.' : 'Get started by creating a user.'}
          action={!debouncedSearch && !roleFilter && !statusFilter ? { label: 'Create your first user', onClick: () => setCreateModalOpen(true) } : undefined}
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50/80">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Email
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Role
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Practices
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
              </tr>
            </thead>
            <AnimatedList as="tbody" className="bg-white divide-y divide-gray-200">
              {users.map((user, index) => {
                const roleBadge = ROLE_BADGE[user.role] || ROLE_BADGE.credentialing_staff;
                return (
                  <AnimatedListItem
                    itemKey={user.id}
                    index={index}
                    as="tr"
                    onClick={() => navigate(`/users/${user.id}`)}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="h-10 w-10 rounded-full bg-primary-100 flex items-center justify-center">
                          <span className="text-primary-600 text-sm font-medium">
                            {user.firstName[0]}{user.lastName[0]}
                          </span>
                        </div>
                        <div className="ml-3">
                          <p className="text-sm font-medium text-gray-900">
                            {user.firstName} {user.lastName}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {user.email}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={clsx(
                          'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                          roleBadge.bg,
                          roleBadge.text
                        )}
                      >
                        {roleBadge.label}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {user.practices.length > 0
                        ? user.practices.map((p) => p.practice.name).join(', ')
                        : '—'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={clsx(
                          'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                          user.isActive
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-600'
                        )}
                      >
                        {user.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                  </AnimatedListItem>
                );
              })}
            </AnimatedList>
          </table>
        </div>
      )}

      <UserFormModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreated={(created) => {
          if (created?.id) navigate(`/users/${created.id}`);
        }}
      />
    </div>
    </PageTransition>
  );
}
