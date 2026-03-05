import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeftIcon,
  ArrowRightOnRectangleIcon,
  UserGroupIcon,
  ClipboardDocumentListIcon,
  InformationCircleIcon,
  UserPlusIcon,
  BriefcaseIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';
import {
  useOpsPractice,
  useUpdateServiceTier,
  useOpsAssignments,
  useCreateAssignment,
  useOpsStaff,
} from '../../hooks/useOps';
import { useAuthStore } from '../../stores/auth.store';
import Breadcrumbs from '../../components/ui/Breadcrumbs';

const TIER_OPTIONS = [
  { value: 'full_service', label: 'Full Service' },
  { value: 'white_glove', label: 'White Glove' },
  { value: 'self_serve', label: 'Self-Serve' },
];

const TIER_BADGE: Record<string, { label: string; className: string }> = {
  full_service: { label: 'Full Service', className: 'bg-purple-100 text-purple-800' },
  white_glove: { label: 'White Glove', className: 'bg-blue-100 text-blue-800' },
  self_serve: { label: 'Self-Serve', className: 'bg-gray-100 text-gray-600' },
};

const TABS = ['Overview', 'Providers', 'Assignments', 'Work Items'] as const;
type TabName = (typeof TABS)[number];

const TAB_ICONS: Record<TabName, React.ComponentType<{ className?: string }>> = {
  Overview: InformationCircleIcon,
  Providers: UserGroupIcon,
  Assignments: BriefcaseIcon,
  'Work Items': ClipboardDocumentListIcon,
};

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    ACTIVE: 'bg-green-100 text-green-800',
    active: 'bg-green-100 text-green-800',
    PENDING: 'bg-yellow-100 text-yellow-800',
    pending: 'bg-yellow-100 text-yellow-800',
    INACTIVE: 'bg-gray-100 text-gray-600',
    inactive: 'bg-gray-100 text-gray-600',
    open: 'bg-blue-100 text-blue-800',
    OPEN: 'bg-blue-100 text-blue-800',
    in_progress: 'bg-indigo-100 text-indigo-800',
    IN_PROGRESS: 'bg-indigo-100 text-indigo-800',
    completed: 'bg-green-100 text-green-800',
    COMPLETED: 'bg-green-100 text-green-800',
  };

  return (
    <span
      className={clsx(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
        styles[status] ?? 'bg-gray-100 text-gray-600',
      )}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}

export default function OpsPracticeDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabName>('Overview');
  const [assignStaffId, setAssignStaffId] = useState('');

  const { data: practice, isLoading, isError } = useOpsPractice(id!);
  const updateTier = useUpdateServiceTier();
  const { data: assignments, isLoading: assignmentsLoading } = useOpsAssignments({
    practiceId: id,
  });
  const createAssignment = useCreateAssignment();
  const { data: staffList } = useOpsStaff();

  const handleEnterPractice = () => {
    if (!practice) return;
    useAuthStore.getState().enterPracticeContext(id!, practice.name);
    navigate('/');
  };

  const handleTierChange = (newTier: string) => {
    if (!id) return;
    updateTier.mutate({ practiceId: id, tier: newTier });
  };

  const handleAssign = () => {
    if (!assignStaffId || !id) return;
    createAssignment.mutate(
      { staffId: assignStaffId, practiceId: id },
      { onSuccess: () => setAssignStaffId('') },
    );
  };

  // Loading
  if (isLoading) {
    return (
      <div>
        <div className="h-4 w-32 bg-gray-200 rounded animate-pulse mb-6" />
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6 animate-pulse">
          <div className="flex items-center justify-between mb-6">
            <div className="space-y-2">
              <div className="h-6 w-56 bg-gray-200 rounded" />
              <div className="h-4 w-32 bg-gray-200 rounded" />
            </div>
            <div className="h-10 w-32 bg-gray-200 rounded-lg" />
          </div>
          <div className="flex gap-4 border-b border-gray-200/60 mb-6">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-8 w-24 bg-gray-200 rounded mb-2" />
            ))}
          </div>
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-12 bg-gray-100 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Error
  if (isError || !practice) {
    return (
      <div>
        <Link
          to="/ops/practices"
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-6"
        >
          <ArrowLeftIcon className="h-4 w-4 mr-1" />
          Back to Practices
        </Link>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-12 text-center">
          <p className="text-sm text-red-600">
            {isError ? 'Failed to load practice details.' : 'Practice not found.'}
          </p>
          <Link
            to="/ops/practices"
            className="text-primary-600 hover:underline mt-2 inline-block text-sm"
          >
            Return to practices list
          </Link>
        </div>
      </div>
    );
  }

  const tierBadge = TIER_BADGE[practice.serviceTier] ?? {
    label: practice.serviceTier,
    className: 'bg-gray-100 text-gray-600',
  };

  return (
    <div>
      <Breadcrumbs items={[
        { label: 'Practices', href: '/ops/practices' },
        { label: practice.name },
      ]} />

      {/* Header Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6 mb-6">
        <div className="sm:flex sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{practice.name}</h1>
              <span
                className={clsx(
                  'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                  tierBadge.className,
                )}
              >
                {tierBadge.label}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-4">
              <label className="text-sm text-gray-500">Service Tier:</label>
              <select
                value={practice.serviceTier}
                onChange={(e) => handleTierChange(e.target.value)}
                disabled={updateTier.isPending}
                className="text-sm border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
              >
                {TIER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button
            onClick={handleEnterPractice}
            className="mt-4 sm:mt-0 inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
          >
            <ArrowRightOnRectangleIcon className="h-4 w-4 mr-2" />
            Enter Practice
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 overflow-hidden">
        <div className="flex space-x-1 border-b border-gray-200/60 px-4">
          {TABS.map((tab) => {
            const Icon = TAB_ICONS[tab];
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={clsx(
                  'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors focus:outline-none',
                  activeTab === tab
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
                )}
              >
                <Icon className="h-4 w-4" />
                {tab}
              </button>
            );
          })}
        </div>

        <div className="p-6">
          {/* Overview Tab */}
          {activeTab === 'Overview' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
                  Practice Information
                </h3>
                <dl className="space-y-3">
                  <div>
                    <dt className="text-sm text-gray-500">Name</dt>
                    <dd className="text-sm font-medium text-gray-900">{practice.name}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-gray-500">Phone</dt>
                    <dd className="text-sm font-medium text-gray-900">
                      {practice.phone || '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm text-gray-500">Email</dt>
                    <dd className="text-sm font-medium text-gray-900">
                      {practice.email || '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm text-gray-500">SLA Target Days</dt>
                    <dd className="text-sm font-medium text-gray-900">
                      {practice.slaTargetDays ?? '—'}
                    </dd>
                  </div>
                </dl>
              </div>
              <div>
                <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
                  Contract
                </h3>
                <dl className="space-y-3">
                  <div>
                    <dt className="text-sm text-gray-500">Contract Start</dt>
                    <dd className="text-sm font-medium text-gray-900">
                      {practice.contractStartDate
                        ? new Date(practice.contractStartDate).toLocaleDateString()
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm text-gray-500">Contract End</dt>
                    <dd className="text-sm font-medium text-gray-900">
                      {practice.contractEndDate
                        ? new Date(practice.contractEndDate).toLocaleDateString()
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm text-gray-500">Providers</dt>
                    <dd className="text-sm font-medium text-gray-900">
                      {practice.providerCount ?? 0}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm text-gray-500">Enrollments</dt>
                    <dd className="text-sm font-medium text-gray-900">
                      {practice.enrollmentCount ?? 0}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
          )}

          {/* Providers Tab */}
          {activeTab === 'Providers' && (
            <div>
              {!practice.providers || practice.providers.length === 0 ? (
                <div className="text-center py-12">
                  <UserGroupIcon className="mx-auto h-10 w-10 text-gray-300" />
                  <p className="mt-2 text-sm text-gray-500">
                    No providers associated with this practice.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200/60">
                    <thead className="bg-gray-50/50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Name
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          NPI
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200/60">
                      {practice.providers.map(
                        (provider: {
                          id: string;
                          firstName: string;
                          lastName: string;
                          npiNumber?: string;
                          status?: string;
                        }) => (
                          <tr
                            key={provider.id}
                            className="hover:bg-gray-50/50 transition-colors"
                          >
                            <td className="px-4 py-3 whitespace-nowrap">
                              <Link
                                to={`/providers/${provider.id}`}
                                className="text-sm font-medium text-primary-600 hover:text-primary-700"
                              >
                                {provider.firstName} {provider.lastName}
                              </Link>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                              {provider.npiNumber || '—'}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <StatusBadge status={provider.status || 'ACTIVE'} />
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Assignments Tab */}
          {activeTab === 'Assignments' && (
            <div>
              {/* Add Assignment */}
              <div className="flex items-center gap-3 mb-6 p-4 bg-gray-50/50 rounded-xl">
                <UserPlusIcon className="h-5 w-5 text-gray-400 flex-shrink-0" />
                <select
                  value={assignStaffId}
                  onChange={(e) => setAssignStaffId(e.target.value)}
                  className="flex-1 max-w-xs text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
                >
                  <option value="">Select staff member...</option>
                  {staffList?.map((staff) => (
                    <option key={staff.id} value={staff.id}>
                      {staff.firstName} {staff.lastName}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleAssign}
                  disabled={!assignStaffId || createAssignment.isPending}
                  className={clsx(
                    'px-4 py-2 text-sm font-medium rounded-lg transition-colors',
                    assignStaffId && !createAssignment.isPending
                      ? 'bg-primary-600 text-white hover:bg-primary-700'
                      : 'bg-gray-200 text-gray-400 cursor-not-allowed',
                  )}
                >
                  {createAssignment.isPending ? 'Assigning...' : 'Assign'}
                </button>
              </div>

              {/* Assignments List */}
              {assignmentsLoading ? (
                <div className="space-y-3">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />
                  ))}
                </div>
              ) : !assignments || assignments.length === 0 ? (
                <div className="text-center py-12">
                  <BriefcaseIcon className="mx-auto h-10 w-10 text-gray-300" />
                  <p className="mt-2 text-sm text-gray-500">
                    No staff assignments for this practice.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200/60">
                    <thead className="bg-gray-50/50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Staff Member
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Primary
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Assigned
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200/60">
                      {assignments.map((assignment) => (
                        <tr key={assignment.id}>
                          <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                            {assignment.staff
                              ? `${assignment.staff.firstName} ${assignment.staff.lastName}`
                              : '—'}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            {assignment.isPrimary ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-800">
                                Primary
                              </span>
                            ) : (
                              <span className="text-xs text-gray-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                            {new Date(assignment.assignedAt).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Work Items Tab */}
          {activeTab === 'Work Items' && (
            <div>
              {!practice.workItems || practice.workItems.length === 0 ? (
                <div className="text-center py-12">
                  <ClipboardDocumentListIcon className="mx-auto h-10 w-10 text-gray-300" />
                  <p className="mt-2 text-sm text-gray-500">
                    No open work items for this practice.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200/60">
                    <thead className="bg-gray-50/50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Title
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Category
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Status
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Priority
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Assigned To
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200/60">
                      {practice.workItems.map(
                        (item: {
                          id: string;
                          title: string;
                          category: string;
                          status: string;
                          priority: string;
                          assignedTo?: {
                            id: string;
                            firstName: string;
                            lastName: string;
                          } | null;
                        }) => (
                          <tr
                            key={item.id}
                            className="hover:bg-gray-50/50 transition-colors"
                          >
                            <td className="px-4 py-3 whitespace-nowrap">
                              <Link
                                to={`/ops/work-queue/${item.id}`}
                                className="text-sm font-medium text-primary-600 hover:text-primary-700"
                              >
                                {item.title}
                              </Link>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                              {item.category.replace(/_/g, ' ')}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <StatusBadge status={item.status} />
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span
                                className={clsx(
                                  'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                                  item.priority === 'urgent'
                                    ? 'bg-red-100 text-red-800'
                                    : item.priority === 'high'
                                      ? 'bg-orange-100 text-orange-800'
                                      : item.priority === 'medium'
                                        ? 'bg-yellow-100 text-yellow-800'
                                        : 'bg-gray-100 text-gray-600',
                                )}
                              >
                                {item.priority}
                              </span>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                              {item.assignedTo
                                ? `${item.assignedTo.firstName} ${item.assignedTo.lastName}`
                                : '—'}
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
