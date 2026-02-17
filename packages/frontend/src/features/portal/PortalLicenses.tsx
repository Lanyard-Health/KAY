import { useState } from 'react';
import { PlusIcon, PencilIcon, TrashIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { CheckBadgeIcon } from '@heroicons/react/24/solid';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import {
  usePortalLicenses,
  useCreateLicense,
  useUpdateLicense,
  useDeleteLicense,
  type PortalLicense,
} from './hooks/usePortalData';
import ConfirmDialog from '../../components/ConfirmDialog';

const LICENSE_TYPES: Record<string, string> = {
  state_medical: 'State Medical License',
  state_psychology: 'State Psychology License',
  state_social_work: 'State Social Work License',
  state_counseling: 'State Counseling License',
  state_marriage_family: 'Marriage & Family Therapy',
  dea: 'DEA Registration',
  controlled_substance: 'Controlled Substance',
  npi: 'NPI',
};

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  active: { bg: 'bg-green-50 border-green-200', text: 'text-green-700' },
  expired: { bg: 'bg-red-50 border-red-200', text: 'text-red-700' },
  pending: { bg: 'bg-yellow-50 border-yellow-200', text: 'text-yellow-700' },
  revoked: { bg: 'bg-gray-50 border-gray-200', text: 'text-gray-500' },
};

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  expired: 'bg-red-100 text-red-800',
  pending: 'bg-yellow-100 text-yellow-800',
  revoked: 'bg-gray-100 text-gray-600',
};

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS',
  'KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY',
  'NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
];

function getDaysUntilExpiration(dateStr: string): number {
  const exp = new Date(dateStr);
  const now = new Date();
  return Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

interface LicenseFormData {
  licenseType: string;
  licenseNumber: string;
  state: string;
  issueDate: string;
  expirationDate: string;
}

const emptyForm: LicenseFormData = {
  licenseType: 'state_medical',
  licenseNumber: '',
  state: '',
  issueDate: '',
  expirationDate: '',
};

export default function PortalLicenses() {
  const { data, isLoading, error } = usePortalLicenses();
  const createMutation = useCreateLicense();
  const updateMutation = useUpdateLicense();
  const deleteMutation = useDeleteLicense();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<LicenseFormData>(emptyForm);
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; id: string; name: string }>({
    isOpen: false, id: '', name: '',
  });

  const licenses: PortalLicense[] = (data as any)?.data ?? [];

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEdit = (license: PortalLicense) => {
    setEditingId(license.id);
    setForm({
      licenseType: license.licenseType,
      licenseNumber: license.licenseNumber,
      state: license.state || '',
      issueDate: license.issueDate ? license.issueDate.slice(0, 10) : '',
      expirationDate: license.expirationDate ? license.expirationDate.slice(0, 10) : '',
    });
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.licenseNumber.trim() || !form.expirationDate) {
      toast.error('License number and expiration date are required');
      return;
    }

    try {
      if (editingId) {
        await updateMutation.mutateAsync({ id: editingId, ...form });
        toast.success('License updated');
      } else {
        await createMutation.mutateAsync(form);
        toast.success('License added');
      }
      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm);
    } catch {
      toast.error(editingId ? 'Failed to update license' : 'Failed to add license');
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="h-8 w-48 bg-gray-200 rounded animate-pulse" />
          <div className="h-10 w-32 bg-gray-200 rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2].map((i) => (
            <div key={i} className="bg-white rounded-lg shadow p-6 animate-pulse">
              <div className="h-5 w-40 bg-gray-200 rounded mb-3" />
              <div className="h-4 w-32 bg-gray-200 rounded mb-2" />
              <div className="h-4 w-24 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <ExclamationTriangleIcon className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="text-sm font-medium text-red-800">Failed to load licenses</h3>
            <p className="text-sm text-red-600 mt-1">Please try refreshing the page.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Licenses & Credentials</h1>
        <button
          onClick={openCreate}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 transition-colors"
        >
          <PlusIcon className="h-4 w-4 mr-2" />
          Add License
        </button>
      </div>

      {/* Add/Edit Form */}
      {showForm && (
        <div className="bg-white rounded-lg shadow mb-6 border border-primary-200">
          <div className="px-6 py-4 border-b border-gray-200 bg-primary-50 rounded-t-lg">
            <h2 className="text-lg font-semibold text-gray-900">
              {editingId ? 'Edit License' : 'Add New License'}
            </h2>
          </div>
          <form onSubmit={handleSubmit} className="p-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">License Type</label>
                <select
                  value={form.licenseType}
                  onChange={(e) => setForm({ ...form, licenseType: e.target.value })}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
                >
                  {Object.entries(LICENSE_TYPES).map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">License Number</label>
                <input
                  type="text"
                  value={form.licenseNumber}
                  onChange={(e) => setForm({ ...form, licenseNumber: e.target.value })}
                  placeholder="e.g. MD-12345"
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
                <select
                  value={form.state}
                  onChange={(e) => setForm({ ...form, state: e.target.value })}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
                >
                  <option value="">Select state</option>
                  {US_STATES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Issue Date</label>
                <input
                  type="date"
                  value={form.issueDate}
                  onChange={(e) => setForm({ ...form, issueDate: e.target.value })}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Expiration Date</label>
                <input
                  type="date"
                  value={form.expirationDate}
                  onChange={(e) => setForm({ ...form, expirationDate: e.target.value })}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
                  required
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => { setShowForm(false); setEditingId(null); }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 border border-transparent rounded-md hover:bg-primary-700 disabled:opacity-50 transition-colors"
              >
                {isSaving ? 'Saving...' : editingId ? 'Update License' : 'Add License'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* License Cards */}
      {licenses.length === 0 ? (
        <div className="bg-white rounded-lg shadow">
          <div className="p-8 text-center">
            <CheckBadgeIcon className="mx-auto h-12 w-12 text-gray-300" />
            <h3 className="mt-3 text-sm font-medium text-gray-900">No licenses yet</h3>
            <p className="mt-1 text-sm text-gray-500">
              Add your professional licenses and credentials to keep them organized.
            </p>
            <button
              onClick={openCreate}
              className="mt-4 inline-flex items-center px-4 py-2 text-sm font-medium text-primary-700 bg-primary-50 rounded-md hover:bg-primary-100 transition-colors"
            >
              <PlusIcon className="h-4 w-4 mr-2" />
              Add Your First License
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {licenses.map((license) => {
            const days = getDaysUntilExpiration(license.expirationDate);
            const isExpiringSoon = days > 0 && days <= 30;
            const isExpired = days <= 0;
            const status = isExpired ? 'expired' : license.status;
            // eslint-disable-next-line security/detect-object-injection -- status is derived from license data, not user input
            const styles = STATUS_STYLES[status] || STATUS_STYLES.active;

            return (
              <div
                key={license.id}
                className={clsx(
                  'bg-white rounded-lg shadow border transition-shadow hover:shadow-md',
                  styles.bg,
                )}
              >
                <div className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-semibold text-gray-900 truncate">
                          {LICENSE_TYPES[license.licenseType] || license.licenseType}
                        </h3>
                        <span className={clsx(
                          'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize',
                          STATUS_BADGE[status] || STATUS_BADGE.active, // eslint-disable-line security/detect-object-injection
                        )}>
                          {status}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600">#{license.licenseNumber}</p>
                      {license.state && (
                        <p className="text-xs text-gray-500 mt-0.5">State: {license.state}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 ml-2">
                      <button
                        onClick={() => openEdit(license)}
                        className="p-1.5 text-gray-400 hover:text-primary-600 rounded-md hover:bg-gray-100 transition-colors"
                        title="Edit"
                      >
                        <PencilIcon className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setDeleteConfirm({
                          isOpen: true,
                          id: license.id,
                          name: LICENSE_TYPES[license.licenseType] || license.licenseType,
                        })}
                        className="p-1.5 text-gray-400 hover:text-red-600 rounded-md hover:bg-red-50 transition-colors"
                        title="Delete"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-gray-500">Issued</span>
                      <p className="font-medium text-gray-700">
                        {license.issueDate ? new Date(license.issueDate).toLocaleDateString() : '—'}
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-500">Expires</span>
                      <p className={clsx('font-medium', isExpired ? 'text-red-600' : isExpiringSoon ? 'text-yellow-600' : 'text-gray-700')}>
                        {new Date(license.expirationDate).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  {(isExpiringSoon || isExpired) && (
                    <div className={clsx(
                      'mt-3 flex items-center gap-1.5 text-xs font-medium rounded-md px-2.5 py-1.5',
                      isExpired ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700',
                    )}>
                      <ExclamationTriangleIcon className="h-3.5 w-3.5" />
                      {isExpired ? 'Expired' : `Expires in ${days} day${days === 1 ? '' : 's'}`}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        onClose={() => setDeleteConfirm({ isOpen: false, id: '', name: '' })}
        onConfirm={async () => {
          try {
            await deleteMutation.mutateAsync(deleteConfirm.id);
            toast.success('License deleted');
          } catch {
            toast.error('Failed to delete license');
          }
          setDeleteConfirm({ isOpen: false, id: '', name: '' });
        }}
        title="Delete License"
        message={`Delete "${deleteConfirm.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
      />
    </div>
  );
}
