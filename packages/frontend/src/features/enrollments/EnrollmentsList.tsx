import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import PageTransition from '../../components/ui/PageTransition';
import { notify } from '../../utils/notify';
import { api } from '../../services/api';
import RefreshIndicator from '../../components/RefreshIndicator';
import { useAuthStore } from '../../stores/auth.store';
import { usePractice } from '../../hooks/usePractices';
import { AnimatedList, AnimatedListItem } from '../../components/ui/AnimatedList';
import {
  MagnifyingGlassIcon,
  FunnelIcon,
  ArrowPathIcon,
  PlusIcon,
  XMarkIcon,
  UserIcon,
  Squares2X2Icon,
  TableCellsIcon,
  ClockIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  CalendarDaysIcon,
  ClipboardDocumentCheckIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';

interface Payer {
  id: string;
  name: string;
  payerId: string;
  payerType: string;
}

interface ProviderProfile {
  id: string;
  firstName: string;
  lastName: string;
  npi: string;
  providerType?: string;
  status?: string;
}

interface Enrollment {
  id: string;
  providerId: string;
  payerId: string;
  status: string;
  isDraft?: boolean;
  productTypes: string[];
  applicationDate: string | null;
  effectiveDate: string | null;
  lastFollowUpDate: string | null;
  recredentialingDate: string | null;
  providerNumber: string | null;
  notes: string | null;
  payer: Payer;
  provider: ProviderProfile;
  workflowProgress?: { total: number; completed: number };
}

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'not_started', label: 'Not Started', color: 'bg-gray-100 text-gray-800', borderColor: 'border-gray-300', headerBg: 'bg-gray-50', icon: ClockIcon },
  { value: 'in_progress', label: 'In Progress', color: 'bg-yellow-100 text-yellow-800', borderColor: 'border-yellow-300', headerBg: 'bg-yellow-50', icon: ArrowRightIcon },
  { value: 'submitted', label: 'Submitted', color: 'bg-primary-100 text-primary-800', borderColor: 'border-primary-300', headerBg: 'bg-primary-50', icon: ArrowRightIcon },
  { value: 'pending_review', label: 'Pending Review', color: 'bg-purple-100 text-purple-800', borderColor: 'border-purple-300', headerBg: 'bg-purple-50', icon: ClockIcon },
  { value: 'approved', label: 'Approved', color: 'bg-green-100 text-green-800', borderColor: 'border-green-300', headerBg: 'bg-green-50', icon: CheckCircleIcon },
  { value: 'denied', label: 'Denied', color: 'bg-red-100 text-red-800', borderColor: 'border-red-300', headerBg: 'bg-red-50', icon: XCircleIcon },
  { value: 'terminated', label: 'Terminated', color: 'bg-gray-100 text-gray-800', borderColor: 'border-gray-300', headerBg: 'bg-gray-100', icon: XCircleIcon },
];

const ENROLLMENT_STATUS_OPTIONS = STATUS_OPTIONS.filter((s) => s.value !== '');

// Pipeline columns for kanban view (grouped statuses for cleaner view)
const PIPELINE_COLUMNS = [
  {
    id: 'working',
    label: 'In Progress',
    statuses: ['not_started', 'in_progress'],
    color: 'yellow',
    bgColor: 'bg-yellow-50',
    borderColor: 'border-yellow-200',
    headerColor: 'text-yellow-700',
    description: 'Application being prepared'
  },
  {
    id: 'submitted',
    label: 'Submitted',
    statuses: ['submitted', 'pending_review'],
    color: 'blue',
    bgColor: 'bg-primary-50',
    borderColor: 'border-primary-200',
    headerColor: 'text-primary-700',
    description: 'Awaiting payer response'
  },
  {
    id: 'approved',
    label: 'Approved',
    statuses: ['approved'],
    color: 'green',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
    headerColor: 'text-green-700',
    description: 'Successfully credentialed'
  },
  {
    id: 'closed',
    label: 'Closed',
    statuses: ['denied', 'terminated'],
    color: 'red',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    headerColor: 'text-red-700',
    description: 'Denied or terminated'
  },
];

const PRODUCT_TYPE_OPTIONS = [
  'Commercial',
  'Medicare',
  'Medicaid',
  'Medicare Advantage',
  'Managed Medicaid',
  'EAP',
  'Tricare',
  'Workers Comp',
];

const getStatusConfig = (status: string) => {
  return STATUS_OPTIONS.find((s) => s.value === status) || STATUS_OPTIONS[1];
};

interface EnrollmentFormData {
  payerName: string;
  status: string;
  productTypes: string[];
  applicationDate: string;
  effectiveDate: string;
  dateContractReceived: string;
  dateContractSigned: string;
  lastFollowUpDate: string;
  recredentialingDate: string;
  providerNumber: string;
  groupNumber: string;
  notes: string;
}

const initialFormData: EnrollmentFormData = {
  payerName: '',
  status: 'not_started',
  productTypes: [],
  applicationDate: '',
  effectiveDate: '',
  dateContractReceived: '',
  dateContractSigned: '',
  lastFollowUpDate: '',
  recredentialingDate: '',
  providerNumber: '',
  groupNumber: '',
  notes: '',
};

type ViewMode = 'table' | 'kanban';

export default function EnrollmentsList() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const userPracticeId = user?.practices?.[0]?.practiceId;
  const { data: userPractice } = usePractice(userPracticeId ?? '');
  const targetPayerIds = userPractice?.targetPayerIds ?? [];

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [payerFilter, setPayerFilter] = useState('');
  const [showDrafts, setShowDrafts] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('kanban');

  // New enrollment modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<ProviderProfile | null>(null);
  const [providerSearch, setProviderSearch] = useState('');
  const [showProviderDropdown, setShowProviderDropdown] = useState(false);
  const [payerSearch, setPayerSearch] = useState('');
  const [showPayerDropdown, setShowPayerDropdown] = useState(false);
  const [formData, setFormData] = useState<EnrollmentFormData>(initialFormData);

  // Fetch all enrollments
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['all-enrollments'],
    queryFn: async () => {
      const response = await api.get<{ success: boolean; data: Enrollment[] }>('/enrollments');
      return response.data;
    },
  });

  // Fetch all providers
  const { data: providersData } = useQuery({
    queryKey: ['all-providers'],
    queryFn: async () => {
      const response = await api.get<{ success: boolean; data: { data: ProviderProfile[]; total: number } }>('/providers?pageSize=100');
      return response.data;
    },
  });

  // Fetch payers for filter dropdown
  const { data: payersData } = useQuery({
    queryKey: ['payers'],
    queryFn: async () => {
      const response = await api.get<{ success: boolean; data: Payer[] }>('/enrollments/payers');
      return response.data;
    },
  });

  const enrollments = (data?.data as Enrollment[] | undefined) || [];
  const providers = (providersData?.data?.data as ProviderProfile[] | undefined) || [];
  const payers = (payersData?.data as Payer[] | undefined) || [];

  // Filter providers based on search
  const filteredProviders = useMemo(() => {
    if (!providerSearch.trim()) return providers.slice(0, 20);
    const searchLower = providerSearch.toLowerCase();
    return providers
      .filter(
        (p) =>
          p.firstName?.toLowerCase().includes(searchLower) ||
          p.lastName?.toLowerCase().includes(searchLower) ||
          `${p.firstName} ${p.lastName}`.toLowerCase().includes(searchLower) ||
          p.npi?.includes(providerSearch)
      )
      .slice(0, 20);
  }, [providers, providerSearch]);

  // Filter payers based on search, with practice target payers prioritized
  const filteredPayers = useMemo(() => {
    let list = payers;
    if (payerSearch.trim()) {
      const searchLower = payerSearch.toLowerCase();
      list = payers.filter((p) => p.name.toLowerCase().includes(searchLower));
    }
    if (targetPayerIds.length > 0) {
      const targetSet = new Set(targetPayerIds);
      const preferred = list.filter((p) => targetSet.has(p.id));
      const others = list.filter((p) => !targetSet.has(p.id));
      return [...preferred, ...others].slice(0, 50);
    }
    return list.slice(0, 50);
  }, [payers, payerSearch, targetPayerIds]);

  // Get unique payers from enrollments for the filter
  const enrolledPayers = useMemo(() => {
    const payerMap = new Map<string, Payer>();
    enrollments.forEach((e) => {
      if (e.payer) {
        payerMap.set(e.payer.id, e.payer);
      }
    });
    return Array.from(payerMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [enrollments]);

  // Filter enrollments
  const filteredEnrollments = useMemo(() => {
    return enrollments.filter((enrollment) => {
      // Search filter
      if (search) {
        const searchLower = search.toLowerCase();
        const matchesPayer = enrollment.payer?.name?.toLowerCase().includes(searchLower);
        const matchesProvider =
          enrollment.provider?.firstName?.toLowerCase().includes(searchLower) ||
          enrollment.provider?.lastName?.toLowerCase().includes(searchLower) ||
          `${enrollment.provider?.firstName} ${enrollment.provider?.lastName}`
            .toLowerCase()
            .includes(searchLower);
        const matchesNpi = enrollment.provider?.npi?.includes(search);
        const matchesProviderNumber = enrollment.providerNumber?.toLowerCase().includes(searchLower);

        if (!matchesPayer && !matchesProvider && !matchesNpi && !matchesProviderNumber) {
          return false;
        }
      }

      // Status filter
      if (statusFilter && enrollment.status !== statusFilter) {
        return false;
      }

      // Payer filter
      if (payerFilter && enrollment.payer?.id !== payerFilter) {
        return false;
      }

      // Draft filter
      if (!showDrafts && enrollment.isDraft) {
        return false;
      }

      return true;
    });
  }, [enrollments, search, statusFilter, payerFilter, showDrafts]);

  // Search providers directly (for quick enrollment creation)
  const searchedProviders = useMemo(() => {
    if (!search.trim() || search.length < 2) return [];
    const searchLower = search.toLowerCase();
    return providers
      .filter(
        (p) =>
          p.firstName?.toLowerCase().includes(searchLower) ||
          p.lastName?.toLowerCase().includes(searchLower) ||
          `${p.firstName} ${p.lastName}`.toLowerCase().includes(searchLower) ||
          p.npi?.includes(search)
      )
      .slice(0, 10);
  }, [providers, search]);

  // Summary stats — drafts are placeholders, not real work, so exclude them
  const stats = useMemo(() => {
    const real = enrollments.filter((e) => !e.isDraft);
    return {
      total: real.length,
      drafts: enrollments.length - real.length,
      approved: real.filter((e) => e.status === 'approved').length,
      inProgress: real.filter((e) =>
        ['in_progress', 'submitted', 'pending_review'].includes(e.status)
      ).length,
      notStarted: real.filter((e) => e.status === 'not_started').length,
      needsFollowUp: real.filter((e) => {
        if (!e.lastFollowUpDate) return false;
        const followUp = new Date(e.lastFollowUpDate);
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        return followUp < weekAgo && !['approved', 'denied', 'terminated'].includes(e.status);
      }).length,
    };
  }, [enrollments]);

  // Create enrollment mutation
  const createMutation = useMutation({
    mutationFn: (data: { providerId: string; formData: EnrollmentFormData }) =>
      api.post(`/enrollments/provider/${data.providerId}`, data.formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-enrollments'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-full'] });
      closeModal();
      notify.success('Enrollment created');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error?.message || 'Failed to create enrollment';
      notify.error('Enrollment failed', { description: message });
    },
  });

  // Delete mutation (drafts only — UI gates which rows show the trash icon)
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/enrollments/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-enrollments'] });
      notify.success('Draft enrollment removed');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error?.message || 'Failed to remove draft';
      notify.error('Delete failed', { description: message });
    },
  });

  const openModal = (provider?: ProviderProfile) => {
    setSelectedProvider(provider || null);
    setProviderSearch('');
    setShowProviderDropdown(false);
    setPayerSearch('');
    setShowPayerDropdown(false);
    setFormData(initialFormData);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedProvider(null);
    setProviderSearch('');
    setPayerSearch('');
    setFormData(initialFormData);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProvider) return;
    createMutation.mutate({ providerId: selectedProvider.id, formData });
  };

  if (error) {
    return (
      <div className="text-red-600 p-4 bg-red-50 rounded-xl">
        Failed to load enrollments. Please try again.
      </div>
    );
  }

  return (
    <PageTransition>
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">Enrollment Pipeline</h1>
            <RefreshIndicator isFetching={isFetching && !isLoading} />
          </div>
          <p className="text-sm text-gray-500">
            Track and manage all payer enrollments across providers
          </p>
        </div>
        <div className="flex gap-3">
          {/* View Toggle */}
          <div className="inline-flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setViewMode('kanban')}
              className={`inline-flex items-center px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                viewMode === 'kanban'
                  ? 'bg-primary-100 text-primary-700'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
              title="Pipeline View"
            >
              <Squares2X2Icon className="h-5 w-5" />
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`inline-flex items-center px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                viewMode === 'table'
                  ? 'bg-primary-100 text-primary-700'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
              title="Table View"
            >
              <TableCellsIcon className="h-5 w-5" />
            </button>
          </div>
          <button
            onClick={() => refetch()}
            className="inline-flex items-center px-4 py-2 bg-white border border-gray-300 rounded-xl hover:bg-gray-50"
          >
            <ArrowPathIcon className="h-5 w-5 mr-2 text-gray-500" />
            Refresh
          </button>
          <button
            onClick={() => openModal()}
            className="inline-flex items-center px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
          >
            <PlusIcon className="h-5 w-5 mr-2" />
            Add Enrollment
          </button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
          <div className="text-sm text-gray-500">Total Enrollments</div>
        </div>
        <div className="bg-green-50 rounded-2xl shadow-sm p-4">
          <div className="text-2xl font-bold text-green-600">{stats.approved}</div>
          <div className="text-sm text-green-800">Approved</div>
        </div>
        <div className="bg-yellow-50 rounded-2xl shadow-sm p-4">
          <div className="text-2xl font-bold text-yellow-600">{stats.inProgress}</div>
          <div className="text-sm text-yellow-800">In Progress</div>
        </div>
        <div className="bg-gray-50 rounded-2xl shadow-sm p-4">
          <div className="text-2xl font-bold text-gray-600">{stats.notStarted}</div>
          <div className="text-sm text-gray-800">Not Started</div>
        </div>
        <div className="bg-orange-50 rounded-2xl shadow-sm p-4">
          <div className="text-2xl font-bold text-orange-600">{stats.needsFollowUp}</div>
          <div className="text-sm text-orange-800">Needs Follow-up</div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-sm p-4">
        <div className="flex flex-col md:flex-row gap-4">
          {/* Search */}
          <div className="flex-1">
            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by provider, payer, NPI, or provider #..."
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>

          {/* Status Filter */}
          <div className="w-full md:w-48">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {/* Payer Filter */}
          <div className="w-full md:w-64">
            <select
              value={payerFilter}
              onChange={(e) => setPayerFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">All Payers</option>
              {enrolledPayers.map((payer) => (
                <option key={payer.id} value={payer.id}>
                  {payer.name}
                </option>
              ))}
            </select>
          </div>

          {/* Show drafts toggle */}
          {stats.drafts > 0 && (
            <label className="flex items-center gap-2 text-sm text-gray-700 whitespace-nowrap cursor-pointer">
              <input
                type="checkbox"
                checked={showDrafts}
                onChange={(e) => setShowDrafts(e.target.checked)}
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              Show drafts ({stats.drafts})
            </label>
          )}
        </div>

        {(search || statusFilter || payerFilter) && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-sm text-gray-500">
              Showing {filteredEnrollments.length} of {enrollments.length} enrollments
            </span>
            <button
              onClick={() => {
                setSearch('');
                setStatusFilter('');
                setPayerFilter('');
              }}
              className="text-sm text-primary-600 hover:text-primary-800"
            >
              Clear filters
            </button>
          </div>
        )}
      </div>

      {/* Matching Providers Section */}
      {search && searchedProviders.length > 0 && (
        <div className="bg-primary-50 rounded-2xl shadow-sm p-4">
          <h3 className="text-sm font-medium text-primary-900 mb-3">
            Matching Providers ({searchedProviders.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {searchedProviders.map((provider) => (
              <div
                key={provider.id}
                className="flex items-center justify-between bg-white rounded-lg p-3 border border-primary-200"
              >
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary-600 flex items-center justify-center">
                    <span className="text-white font-medium text-sm">
                      {provider.firstName?.[0]}
                      {provider.lastName?.[0]}
                    </span>
                  </div>
                  <div>
                    <Link
                      to={`/providers/${provider.id}`}
                      className="font-medium text-gray-900 hover:text-primary-600"
                    >
                      {provider.firstName} {provider.lastName}
                    </Link>
                    <div className="text-xs text-gray-500">NPI: {provider.npi}</div>
                  </div>
                </div>
                <button
                  onClick={() => openModal(provider)}
                  className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-primary-700 bg-primary-100 rounded-md hover:bg-primary-200"
                >
                  <PlusIcon className="h-4 w-4 mr-1" />
                  Enroll
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Enrollments Display */}
      {isLoading ? (
        <div className="animate-pulse space-y-4">
          {viewMode === 'kanban' ? (
            <div className="flex gap-4 overflow-x-auto pb-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex-shrink-0 w-72 h-96 bg-gray-200 rounded-xl"></div>
              ))}
            </div>
          ) : (
            [1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-16 bg-gray-200 rounded-lg"></div>
            ))
          )}
        </div>
      ) : enrollments.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-2xl shadow-sm border border-gray-200/60">
          <FunnelIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No Enrollments Found</h3>
          <p className="text-gray-500 mb-4">
            {targetPayerIds.length > 0 && providers.length === 0
              ? 'Add a provider — drafts will auto-populate for your target payers.'
              : 'Get started by adding an enrollment for a provider.'}
          </p>
          {targetPayerIds.length > 0 && providers.length === 0 ? (
            <Link
              to="/providers/new"
              className="inline-flex items-center px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
            >
              <PlusIcon className="h-5 w-5 mr-2" />
              Add First Provider
            </Link>
          ) : (
            <button
              onClick={() => openModal()}
              className="inline-flex items-center px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
            >
              <PlusIcon className="h-5 w-5 mr-2" />
              Add First Enrollment
            </button>
          )}
        </div>
      ) : viewMode === 'kanban' ? (
        /* Kanban Pipeline View */
        <div className="flex gap-4 overflow-x-auto pb-4">
          {PIPELINE_COLUMNS.map((column) => {
            const columnEnrollments = filteredEnrollments.filter((e) =>
              column.statuses.includes(e.status)
            );

            return (
              <div
                key={column.id}
                className={`flex-shrink-0 w-80 rounded-2xl border-2 ${column.borderColor} ${column.bgColor} overflow-hidden`}
              >
                {/* Column Header */}
                <div className={`p-4 border-b ${column.borderColor}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className={`font-semibold ${column.headerColor}`}>
                        {column.label}
                      </h3>
                      <p className="text-xs text-gray-500">{column.description}</p>
                    </div>
                    <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold ${
                      column.color === 'gray' ? 'bg-gray-200 text-gray-700' :
                      column.color === 'yellow' ? 'bg-yellow-200 text-yellow-700' :
                      column.color === 'blue' ? 'bg-primary-200 text-primary-700' :
                      column.color === 'green' ? 'bg-green-200 text-green-700' :
                      'bg-red-200 text-red-700'
                    }`}>
                      {columnEnrollments.length}
                    </span>
                  </div>
                </div>

                {/* Column Cards */}
                <div className="p-3 space-y-3 max-h-[calc(100vh-380px)] overflow-y-auto">
                  {columnEnrollments.length === 0 ? (
                    <div className="text-center py-8 text-gray-400">
                      <p className="text-sm">No enrollments</p>
                    </div>
                  ) : (
                    columnEnrollments.map((enrollment) => {
                      const statusConfig = getStatusConfig(enrollment.status);
                      const needsFollowUp =
                        enrollment.lastFollowUpDate &&
                        new Date(enrollment.lastFollowUpDate) <
                          new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) &&
                        !['approved', 'denied', 'terminated'].includes(enrollment.status);

                      return (
                        <Link
                          key={enrollment.id}
                          to={`/enrollments/${enrollment.id}`}
                          className={`block rounded-xl shadow-sm border hover:shadow-md transition-all duration-200 overflow-hidden ${
                            enrollment.isDraft
                              ? 'bg-gray-50 border-dashed border-gray-300 hover:border-gray-400'
                              : 'bg-white border-gray-200/60 hover:border-primary-300'
                          }`}
                        >
                          {/* Card Header with Provider */}
                          <div className="p-3 border-b border-gray-100">
                            <div className="flex items-center gap-3">
                              <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center flex-shrink-0">
                                <span className="text-white font-medium text-sm">
                                  {enrollment.provider?.firstName?.[0]}
                                  {enrollment.provider?.lastName?.[0]}
                                </span>
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="font-medium text-gray-900 truncate">
                                  {enrollment.provider?.firstName} {enrollment.provider?.lastName}
                                </p>
                                <p className="text-xs text-gray-500">
                                  NPI: {enrollment.provider?.npi}
                                </p>
                              </div>
                              {enrollment.isDraft && (
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-200 text-gray-700 uppercase tracking-wide">
                                    Draft
                                  </span>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      if (confirm(`Remove draft enrollment for ${enrollment.payer?.name}?`)) {
                                        deleteMutation.mutate(enrollment.id);
                                      }
                                    }}
                                    className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
                                    aria-label="Remove draft"
                                  >
                                    <TrashIcon className="h-4 w-4" />
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Card Body with Payer Info */}
                          <div className="p-3 space-y-2">
                            <div>
                              <p className="text-sm font-medium text-gray-900 truncate">
                                {enrollment.payer?.name}
                              </p>
                              <p className="text-xs text-gray-500">{enrollment.payer?.payerType}</p>
                            </div>

                            {/* Product Types */}
                            {enrollment.productTypes && enrollment.productTypes.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {enrollment.productTypes.slice(0, 2).map((type) => (
                                  <span
                                    key={type}
                                    className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-primary-50 text-primary-700"
                                  >
                                    {type}
                                  </span>
                                ))}
                                {enrollment.productTypes.length > 2 && (
                                  <span className="text-xs text-gray-500">
                                    +{enrollment.productTypes.length - 2}
                                  </span>
                                )}
                              </div>
                            )}

                            {/* Status Badge (for combined columns) */}
                            {column.statuses.length > 1 && (
                              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusConfig.color}`}>
                                {statusConfig.label}
                              </span>
                            )}
                          </div>

                          {/* Card Footer */}
                          <div className="px-3 py-2 bg-gray-50 border-t border-gray-100 flex items-center justify-between text-xs">
                            {enrollment.effectiveDate ? (
                              <span className="text-gray-600 flex items-center gap-1">
                                <CalendarDaysIcon className="h-3.5 w-3.5" />
                                {new Date(enrollment.effectiveDate).toLocaleDateString()}
                              </span>
                            ) : enrollment.applicationDate ? (
                              <span className="text-gray-500">
                                Applied {new Date(enrollment.applicationDate).toLocaleDateString()}
                              </span>
                            ) : (
                              <span className="text-gray-400">No date</span>
                            )}

                            {needsFollowUp && (
                              <span className="flex items-center gap-1 text-orange-600 font-medium">
                                <ExclamationTriangleIcon className="h-3.5 w-3.5" />
                                Follow-up
                              </span>
                            )}

                            {enrollment.workflowProgress && enrollment.workflowProgress.total > 0 && (
                              <span className="text-gray-500 flex items-center gap-1">
                                <ClipboardDocumentCheckIcon className="h-3.5 w-3.5" />
                                {enrollment.workflowProgress.completed}/{enrollment.workflowProgress.total}
                              </span>
                            )}

                            {enrollment.providerNumber && (
                              <span className="text-gray-500">
                                #{enrollment.providerNumber}
                              </span>
                            )}
                          </div>
                        </Link>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Table View */
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 overflow-hidden overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50/50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Provider
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Payer
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Product Types
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Provider #
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Effective Date
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Last Follow-up
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <AnimatedList as="tbody" className="bg-white divide-y divide-gray-200">
              {filteredEnrollments.map((enrollment, index) => {
                const statusConfig = getStatusConfig(enrollment.status);
                const needsFollowUp =
                  enrollment.lastFollowUpDate &&
                  new Date(enrollment.lastFollowUpDate) <
                    new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) &&
                  !['approved', 'denied', 'terminated'].includes(enrollment.status);

                return (
                  <AnimatedListItem itemKey={enrollment.id} index={index} as="tr" className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <Link
                        to={`/providers/${enrollment.providerId}`}
                        className="text-primary-600 hover:text-primary-800"
                      >
                        <div className="font-medium">
                          {enrollment.provider?.firstName} {enrollment.provider?.lastName}
                        </div>
                        <div className="text-sm text-gray-500">
                          NPI: {enrollment.provider?.npi}
                        </div>
                      </Link>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="font-medium text-gray-900">{enrollment.payer?.name}</div>
                      <div className="text-sm text-gray-500">{enrollment.payer?.payerType}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1">
                        {enrollment.productTypes && enrollment.productTypes.length > 0 ? (
                          enrollment.productTypes.map((type) => (
                            <span
                              key={type}
                              className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-primary-100 text-primary-800"
                            >
                              {type}
                            </span>
                          ))
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-3 py-1 rounded-full text-sm font-medium ${statusConfig.color}`}
                        >
                          {statusConfig.label}
                        </span>
                        {enrollment.isDraft && (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-gray-200 text-gray-700 uppercase tracking-wide">
                            Draft
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-900">
                      {enrollment.providerNumber || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-500">
                      {enrollment.effectiveDate
                        ? new Date(enrollment.effectiveDate).toLocaleDateString()
                        : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {enrollment.lastFollowUpDate ? (
                        <span
                          className={
                            needsFollowUp ? 'text-orange-600 font-medium' : 'text-gray-500'
                          }
                        >
                          {new Date(enrollment.lastFollowUpDate).toLocaleDateString()}
                          {needsFollowUp && ' (overdue)'}
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <div className="flex items-center justify-end gap-3">
                        <Link
                          to={`/enrollments/${enrollment.id}`}
                          className="text-primary-600 hover:text-primary-800 text-sm font-medium"
                        >
                          View
                        </Link>
                        {enrollment.isDraft && (
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm(`Remove draft enrollment for ${enrollment.payer?.name}?`)) {
                                deleteMutation.mutate(enrollment.id);
                              }
                            }}
                            className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
                            aria-label="Remove draft"
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </AnimatedListItem>
                );
              })}
            </AnimatedList>
          </table>
        </div>
      )}

      {/* Add Enrollment Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
            <div
              className="fixed inset-0 transition-opacity bg-gray-900/40 backdrop-blur-sm"
              onClick={closeModal}
            />

            <div className="relative z-10 inline-block w-full max-w-2xl p-6 my-8 text-left align-middle bg-white rounded-2xl shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-gray-900">Add New Enrollment</h3>
                <button
                  onClick={closeModal}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <XMarkIcon className="h-6 w-6" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
                {/* Provider Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Provider *
                  </label>
                  {selectedProvider ? (
                    <div className="flex items-center gap-3 p-3 bg-primary-50 rounded-lg">
                      <div className="h-10 w-10 rounded-full bg-primary-600 flex items-center justify-center">
                        <span className="text-white font-medium">
                          {selectedProvider.firstName?.[0]}
                          {selectedProvider.lastName?.[0]}
                        </span>
                      </div>
                      <div className="flex-1">
                        <div className="font-medium text-gray-900">
                          {selectedProvider.firstName} {selectedProvider.lastName}
                        </div>
                        <div className="text-sm text-gray-500">NPI: {selectedProvider.npi}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedProvider(null)}
                        className="text-primary-600 hover:text-primary-800"
                      >
                        Change
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <div className="relative">
                        <UserIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                        <input
                          type="text"
                          value={providerSearch}
                          onChange={(e) => {
                            setProviderSearch(e.target.value);
                            setShowProviderDropdown(true);
                          }}
                          onFocus={() => setShowProviderDropdown(true)}
                          placeholder="Search providers by name or NPI..."
                          className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                      </div>
                      {showProviderDropdown && (
                        <div className="absolute z-10 mt-1 w-full bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
                          {filteredProviders.length > 0 ? (
                            filteredProviders.map((provider) => (
                              <button
                                key={provider.id}
                                type="button"
                                onClick={() => {
                                  setSelectedProvider(provider);
                                  setProviderSearch('');
                                  setShowProviderDropdown(false);
                                }}
                                className="w-full text-left px-4 py-2 hover:bg-primary-50 focus:bg-primary-50 focus:outline-none"
                              >
                                <div className="font-medium text-gray-900">
                                  {provider.firstName} {provider.lastName}
                                </div>
                                <div className="text-sm text-gray-500">
                                  NPI: {provider.npi}
                                  {provider.providerType && ` | ${provider.providerType}`}
                                </div>
                              </button>
                            ))
                          ) : (
                            <div className="px-4 py-3 text-sm text-gray-500">
                              No providers found. Try a different search.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Payer Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Payer *
                  </label>
                  <div className="relative">
                    <div className="relative">
                      <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                      <input
                        type="text"
                        value={payerSearch}
                        onChange={(e) => {
                          setPayerSearch(e.target.value);
                          setShowPayerDropdown(true);
                        }}
                        onFocus={() => setShowPayerDropdown(true)}
                        placeholder="Search payers..."
                        className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                    {formData.payerName && (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-sm text-gray-600">Selected:</span>
                        <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-primary-100 text-primary-800">
                          {formData.payerName}
                          <button
                            type="button"
                            onClick={() => {
                              setFormData({ ...formData, payerName: '' });
                              setPayerSearch('');
                            }}
                            className="ml-2 text-primary-600 hover:text-primary-800"
                          >
                            &times;
                          </button>
                        </span>
                      </div>
                    )}
                    {showPayerDropdown && !formData.payerName && (
                      <div className="absolute z-10 mt-1 w-full bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
                        {filteredPayers.length > 0 ? (
                          <>
                            {(() => {
                              const targetSet = new Set(targetPayerIds);
                              const preferred = filteredPayers.filter((p) => targetSet.has(p.id));
                              const others = filteredPayers.filter((p) => !targetSet.has(p.id));
                              return (
                                <>
                                  {preferred.length > 0 && (
                                    <div className="px-4 py-1.5 text-xs font-semibold text-gray-400 uppercase bg-gray-50">Your payers</div>
                                  )}
                                  {preferred.map((payer) => (
                                    <button
                                      key={payer.id}
                                      type="button"
                                      onClick={() => {
                                        setFormData({ ...formData, payerName: payer.name });
                                        setPayerSearch('');
                                        setShowPayerDropdown(false);
                                      }}
                                      className="w-full text-left px-4 py-2 hover:bg-primary-50 focus:bg-primary-50 focus:outline-none"
                                    >
                                      <div className="font-medium text-gray-900">{payer.name}</div>
                                      <div className="text-xs text-gray-500">{payer.payerType}</div>
                                    </button>
                                  ))}
                                  {preferred.length > 0 && others.length > 0 && (
                                    <div className="px-4 py-1.5 text-xs font-semibold text-gray-400 uppercase bg-gray-50 border-t border-gray-200">Other payers</div>
                                  )}
                                  {others.map((payer) => (
                                    <button
                                      key={payer.id}
                                      type="button"
                                      onClick={() => {
                                        setFormData({ ...formData, payerName: payer.name });
                                        setPayerSearch('');
                                        setShowPayerDropdown(false);
                                      }}
                                      className="w-full text-left px-4 py-2 hover:bg-primary-50 focus:bg-primary-50 focus:outline-none"
                                    >
                                      <div className="font-medium text-gray-900">{payer.name}</div>
                                      <div className="text-xs text-gray-500">{payer.payerType}</div>
                                    </button>
                                  ))}
                                </>
                              );
                            })()}
                            {payerSearch.trim() && !filteredPayers.some(p => p.name.toLowerCase() === payerSearch.trim().toLowerCase()) && (
                              <button
                                type="button"
                                onClick={() => {
                                  setFormData({ ...formData, payerName: payerSearch.trim() });
                                  setPayerSearch('');
                                  setShowPayerDropdown(false);
                                }}
                                className="w-full text-left px-4 py-2 border-t border-gray-100 hover:bg-primary-50 focus:bg-primary-50 focus:outline-none"
                              >
                                <div className="font-medium text-primary-700">+ Use &quot;{payerSearch.trim()}&quot;</div>
                                <div className="text-xs text-gray-500">Create new payer</div>
                              </button>
                            )}
                          </>
                        ) : payerSearch.trim() ? (
                          <button
                            type="button"
                            onClick={() => {
                              setFormData({ ...formData, payerName: payerSearch.trim() });
                              setPayerSearch('');
                              setShowPayerDropdown(false);
                            }}
                            className="w-full text-left px-4 py-2 hover:bg-primary-50 focus:bg-primary-50 focus:outline-none"
                          >
                            <div className="font-medium text-primary-700">+ Use &quot;{payerSearch.trim()}&quot;</div>
                            <div className="text-xs text-gray-500">Create new payer</div>
                          </button>
                        ) : (
                          <div className="px-4 py-3 text-sm text-gray-500">
                            Type to search payers or enter a custom name.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Product Types */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Product Types
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {PRODUCT_TYPE_OPTIONS.map((type) => (
                      <label
                        key={type}
                        className={`inline-flex items-center px-3 py-1 rounded-full text-sm cursor-pointer border ${
                          formData.productTypes.includes(type)
                            ? 'bg-primary-100 border-primary-500 text-primary-800'
                            : 'bg-gray-50 border-gray-300 text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={formData.productTypes.includes(type)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setFormData({
                                ...formData,
                                productTypes: [...formData.productTypes, type],
                              });
                            } else {
                              setFormData({
                                ...formData,
                                productTypes: formData.productTypes.filter((t) => t !== type),
                              });
                            }
                          }}
                          className="sr-only"
                        />
                        {type}
                      </label>
                    ))}
                  </div>
                </div>

                {/* Status */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    {ENROLLMENT_STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Provider & Group Numbers */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Provider Number
                    </label>
                    <input
                      type="text"
                      value={formData.providerNumber}
                      onChange={(e) =>
                        setFormData({ ...formData, providerNumber: e.target.value })
                      }
                      placeholder="Assigned provider #"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Group Number
                    </label>
                    <input
                      type="text"
                      value={formData.groupNumber}
                      onChange={(e) => setFormData({ ...formData, groupNumber: e.target.value })}
                      placeholder="Group #"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                </div>

                {/* Key Dates */}
                <div className="border-t pt-4 mt-4">
                  <h4 className="text-sm font-medium text-gray-900 mb-3">Key Dates</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Submission Date
                      </label>
                      <input
                        type="date"
                        value={formData.applicationDate}
                        onChange={(e) =>
                          setFormData({ ...formData, applicationDate: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Effective Date
                      </label>
                      <input
                        type="date"
                        value={formData.effectiveDate}
                        onChange={(e) =>
                          setFormData({ ...formData, effectiveDate: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Contract Received
                      </label>
                      <input
                        type="date"
                        value={formData.dateContractReceived}
                        onChange={(e) =>
                          setFormData({ ...formData, dateContractReceived: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Contract Signed
                      </label>
                      <input
                        type="date"
                        value={formData.dateContractSigned}
                        onChange={(e) =>
                          setFormData({ ...formData, dateContractSigned: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Last Follow Up
                      </label>
                      <input
                        type="date"
                        value={formData.lastFollowUpDate}
                        onChange={(e) =>
                          setFormData({ ...formData, lastFollowUpDate: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Recredentialing Date
                      </label>
                      <input
                        type="date"
                        value={formData.recredentialingDate}
                        onChange={(e) =>
                          setFormData({ ...formData, recredentialingDate: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                  </div>

                  {/* Date validation warnings */}
                  {(() => {
                    const warnings: string[] = [];
                    const { applicationDate, effectiveDate, dateContractReceived, dateContractSigned } = formData;
                    if (applicationDate && effectiveDate && effectiveDate < applicationDate) {
                      warnings.push('Effective date is before submission date');
                    }
                    if (dateContractReceived && dateContractSigned && dateContractSigned < dateContractReceived) {
                      warnings.push('Contract signed before it was received');
                    }
                    if (applicationDate && dateContractReceived && dateContractReceived < applicationDate) {
                      warnings.push('Contract received before submission date');
                    }
                    if (warnings.length === 0) return null;
                    return (
                      <div className="mt-2 text-xs text-amber-600 bg-amber-50 rounded-md px-3 py-2 space-y-1">
                        {warnings.map((w) => (
                          <div key={w}>{w}</div>
                        ))}
                      </div>
                    );
                  })()}
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    rows={3}
                    placeholder="Any additional notes..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>

                {/* Validation hints */}
                {(!selectedProvider || !formData.payerName) && (
                  <div className="text-sm text-amber-600 bg-amber-50 rounded-md px-3 py-2">
                    {!selectedProvider && <div>Please select a provider above.</div>}
                    {!formData.payerName && <div>Please select or enter a payer name.</div>}
                  </div>
                )}

                {/* Actions */}
                <div className="flex justify-end space-x-3 mt-6 pt-4 border-t">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!selectedProvider || !formData.payerName || createMutation.isPending}
                    className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {createMutation.isPending ? 'Creating...' : 'Create Enrollment'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
    </PageTransition>
  );
}
