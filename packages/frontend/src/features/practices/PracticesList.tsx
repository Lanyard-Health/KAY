import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BuildingOffice2Icon, PlusIcon } from '@heroicons/react/24/outline';
import EmptyState from '../../components/ui/EmptyState';
import PageTransition from '../../components/ui/PageTransition';
import clsx from 'clsx';
import { usePractices } from '../../hooks/usePractices';
import PracticeFormModal from './PracticeFormModal';

export default function PracticesList() {
  const navigate = useNavigate();
  const { data: practices, isLoading } = usePractices();
  const [createModalOpen, setCreateModalOpen] = useState(false);

  if (isLoading) {
    return (
      <div>
        <div className="sm:flex sm:items-center sm:justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Practices</h1>
            <p className="mt-1 text-sm text-gray-500">Manage practice organizations and their members</p>
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
          <h1 className="text-2xl font-bold text-gray-900">Practices</h1>
          <p className="mt-1 text-sm text-gray-500">Manage practice organizations and their members</p>
        </div>
        <button
          onClick={() => setCreateModalOpen(true)}
          className="btn-primary mt-4 sm:mt-0"
        >
          <PlusIcon className="-ml-1 mr-2 h-5 w-5" />
          Add Practice
        </button>
      </div>

      {!practices || practices.length === 0 ? (
        <EmptyState
          illustration="inbox"
          title="No practices"
          description="Get started by creating a practice."
          action={{ label: 'Create your first practice', onClick: () => setCreateModalOpen(true) }}
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
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Providers
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Users
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Phone
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Email
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {practices.map((practice) => (
                <tr
                  key={practice.id}
                  onClick={() => navigate(`/practices/${practice.id}`)}
                  className="hover:bg-gray-50 cursor-pointer transition-colors"
                >
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="h-10 w-10 rounded-lg bg-primary-100 flex items-center justify-center">
                        <BuildingOffice2Icon className="h-5 w-5 text-primary-600" />
                      </div>
                      <div className="ml-3">
                        <p className="text-sm font-medium text-gray-900">{practice.name}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={clsx(
                        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                        practice.status === 'ACTIVE'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-600'
                      )}
                    >
                      {practice.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {practice._count?.providers ?? 0}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {practice._count?.users ?? 0}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {practice.phone || '—'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {practice.email || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PracticeFormModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
      />
    </div>
    </PageTransition>
  );
}
