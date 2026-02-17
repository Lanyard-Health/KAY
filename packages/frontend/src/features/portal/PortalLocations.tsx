import { useState } from 'react';
import {
  PlusIcon,
  PencilIcon,
  MapPinIcon,
  PhoneIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import {
  useCurrentProvider,
  usePortalLocations,
  useCreateLocation,
  useUpdateLocation,
  type PracticeLocation,
} from './hooks/usePortalData';

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS',
  'KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY',
  'NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
];

const LOCATION_TYPES = [
  'Office', 'Hospital', 'Telehealth', 'Urgent Care', 'Surgery Center', 'Clinic', 'Other',
];

interface LocationFormData {
  locationName: string;
  locationType: string;
  isPrimary: boolean;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  zipCode: string;
  phone: string;
  fax: string;
  email: string;
  wheelchairAccessible: boolean;
  publicTransitAccess: boolean;
  parkingAvailable: boolean;
  acceptingNewPatients: boolean;
  notes: string;
}

const emptyForm: LocationFormData = {
  locationName: '',
  locationType: 'Office',
  isPrimary: false,
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  zipCode: '',
  phone: '',
  fax: '',
  email: '',
  wheelchairAccessible: false,
  publicTransitAccess: false,
  parkingAvailable: true,
  acceptingNewPatients: true,
  notes: '',
};

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors',
          checked ? 'bg-primary-600' : 'bg-gray-200',
        )}
      >
        <span
          className={clsx(
            'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-4' : 'translate-x-0',
          )}
        />
      </button>
      <span className="text-sm text-gray-700">{label}</span>
    </label>
  );
}

export default function PortalLocations() {
  const { data: providerData, isLoading: providerLoading } = useCurrentProvider();
  const providerId = (providerData as any)?.data?.provider?.id;
  const { data, isLoading, error } = usePortalLocations(providerId);
  const createMutation = useCreateLocation();
  const updateMutation = useUpdateLocation();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<LocationFormData>(emptyForm);

  const locations: PracticeLocation[] = (data as any)?.data ?? [];

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEdit = (loc: PracticeLocation) => {
    setEditingId(loc.id);
    setForm({
      locationName: loc.locationName,
      locationType: loc.locationType,
      isPrimary: loc.isPrimary,
      addressLine1: loc.addressLine1,
      addressLine2: loc.addressLine2 || '',
      city: loc.city,
      state: loc.state,
      zipCode: loc.zipCode,
      phone: loc.phone,
      fax: loc.fax || '',
      email: loc.email || '',
      wheelchairAccessible: loc.wheelchairAccessible,
      publicTransitAccess: loc.publicTransitAccess,
      parkingAvailable: loc.parkingAvailable,
      acceptingNewPatients: loc.acceptingNewPatients,
      notes: loc.notes || '',
    });
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.locationName.trim() || !form.addressLine1.trim() || !form.city.trim() || !form.state || !form.zipCode.trim() || !form.phone.trim()) {
      toast.error('Please fill in all required fields');
      return;
    }

    try {
      if (editingId) {
        await updateMutation.mutateAsync({ id: editingId, ...form });
        toast.success('Location updated');
      } else {
        await createMutation.mutateAsync({ providerId, ...form });
        toast.success('Location added');
      }
      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm);
    } catch {
      toast.error(editingId ? 'Failed to update location' : 'Failed to add location');
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const loading = isLoading || providerLoading;

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="h-8 w-48 bg-gray-200 rounded animate-pulse" />
          <div className="h-10 w-36 bg-gray-200 rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2].map((i) => (
            <div key={i} className="bg-white rounded-lg shadow p-6 animate-pulse">
              <div className="h-5 w-40 bg-gray-200 rounded mb-3" />
              <div className="h-4 w-56 bg-gray-200 rounded mb-2" />
              <div className="h-4 w-32 bg-gray-200 rounded" />
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
            <h3 className="text-sm font-medium text-red-800">Failed to load locations</h3>
            <p className="text-sm text-red-600 mt-1">Please try refreshing the page.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Practice Locations</h1>
        <button
          onClick={openCreate}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 transition-colors"
        >
          <PlusIcon className="h-4 w-4 mr-2" />
          Add Location
        </button>
      </div>

      {/* Add/Edit Form */}
      {showForm && (
        <div className="bg-white rounded-lg shadow mb-6 border border-primary-200">
          <div className="px-6 py-4 border-b border-gray-200 bg-primary-50 rounded-t-lg flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              {editingId ? 'Edit Location' : 'Add New Location'}
            </h2>
            <button
              onClick={() => { setShowForm(false); setEditingId(null); }}
              className="p-1 text-gray-400 hover:text-gray-600 rounded"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {/* Basic Info */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Location Name *</label>
                <input
                  type="text"
                  value={form.locationName}
                  onChange={(e) => setForm({ ...form, locationName: e.target.value })}
                  placeholder="e.g. Main Office"
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Location Type</label>
                <select
                  value={form.locationType}
                  onChange={(e) => setForm({ ...form, locationType: e.target.value })}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
                >
                  {LOCATION_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Address */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Address Line 1 *</label>
              <input
                type="text"
                value={form.addressLine1}
                onChange={(e) => setForm({ ...form, addressLine1: e.target.value })}
                placeholder="Street address"
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Address Line 2</label>
              <input
                type="text"
                value={form.addressLine2}
                onChange={(e) => setForm({ ...form, addressLine2: e.target.value })}
                placeholder="Suite, unit, floor, etc."
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
              />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="col-span-2 sm:col-span-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">City *</label>
                <input
                  type="text"
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">State *</label>
                <select
                  value={form.state}
                  onChange={(e) => setForm({ ...form, state: e.target.value })}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
                  required
                >
                  <option value="">--</option>
                  {US_STATES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ZIP *</label>
                <input
                  type="text"
                  value={form.zipCode}
                  onChange={(e) => setForm({ ...form, zipCode: e.target.value })}
                  placeholder="12345"
                  pattern="\d{5}(-\d{4})?"
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
                  required
                />
              </div>
            </div>

            {/* Contact */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone *</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="555-123-4567"
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Fax</label>
                <input
                  type="tel"
                  value={form.fax}
                  onChange={(e) => setForm({ ...form, fax: e.target.value })}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
                />
              </div>
            </div>

            {/* Toggles */}
            <div className="border-t border-gray-200 pt-4">
              <p className="text-sm font-medium text-gray-700 mb-3">Location Details</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Toggle checked={form.isPrimary} onChange={(v) => setForm({ ...form, isPrimary: v })} label="Primary location" />
                <Toggle checked={form.acceptingNewPatients} onChange={(v) => setForm({ ...form, acceptingNewPatients: v })} label="Accepting new patients" />
                <Toggle checked={form.wheelchairAccessible} onChange={(v) => setForm({ ...form, wheelchairAccessible: v })} label="Wheelchair accessible" />
                <Toggle checked={form.parkingAvailable} onChange={(v) => setForm({ ...form, parkingAvailable: v })} label="Parking available" />
                <Toggle checked={form.publicTransitAccess} onChange={(v) => setForm({ ...form, publicTransitAccess: v })} label="Public transit access" />
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
              />
            </div>

            <div className="flex justify-end gap-3">
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
                {isSaving ? 'Saving...' : editingId ? 'Update Location' : 'Add Location'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Location Cards */}
      {locations.length === 0 ? (
        <div className="bg-white rounded-lg shadow">
          <div className="p-8 text-center">
            <MapPinIcon className="mx-auto h-12 w-12 text-gray-300" />
            <h3 className="mt-3 text-sm font-medium text-gray-900">No practice locations</h3>
            <p className="mt-1 text-sm text-gray-500">
              Add your practice locations so payers and patients can find you.
            </p>
            <button
              onClick={openCreate}
              className="mt-4 inline-flex items-center px-4 py-2 text-sm font-medium text-primary-700 bg-primary-50 rounded-md hover:bg-primary-100 transition-colors"
            >
              <PlusIcon className="h-4 w-4 mr-2" />
              Add Your First Location
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {locations.map((loc) => (
            <div
              key={loc.id}
              className="bg-white rounded-lg shadow border border-gray-200 hover:shadow-md transition-shadow"
            >
              <div className="p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="w-10 h-10 bg-primary-50 rounded-lg flex items-center justify-center flex-shrink-0">
                      <MapPinIcon className="w-5 h-5 text-primary-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <h3 className="text-sm font-semibold text-gray-900 truncate">{loc.locationName}</h3>
                        {loc.isPrimary && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-700">
                            Primary
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500">{loc.locationType}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => openEdit(loc)}
                    className="p-1.5 text-gray-400 hover:text-primary-600 rounded-md hover:bg-gray-100 transition-colors ml-2"
                    title="Edit"
                  >
                    <PencilIcon className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-3 pt-3 border-t border-gray-100 space-y-1.5">
                  <p className="text-sm text-gray-700">
                    {loc.addressLine1}
                    {loc.addressLine2 && `, ${loc.addressLine2}`}
                  </p>
                  <p className="text-sm text-gray-700">
                    {loc.city}, {loc.state} {loc.zipCode}
                  </p>
                  <div className="flex items-center gap-1.5 text-sm text-gray-600">
                    <PhoneIcon className="h-3.5 w-3.5" />
                    {loc.phone}
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap gap-2">
                  {loc.acceptingNewPatients && (
                    <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                      <CheckCircleIcon className="h-3 w-3" />
                      Accepting patients
                    </span>
                  )}
                  {loc.wheelchairAccessible && (
                    <span className="inline-flex items-center text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">
                      Wheelchair accessible
                    </span>
                  )}
                  {loc.parkingAvailable && (
                    <span className="inline-flex items-center text-xs text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full">
                      Parking
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
