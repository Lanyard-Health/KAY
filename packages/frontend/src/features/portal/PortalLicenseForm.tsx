import { useState } from 'react';
import { ShieldCheckIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { usePortalLicenses, useCreateLicense } from './hooks/usePortalData';

const US_STATES = [
  '', 'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS',
  'KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY',
  'NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
];

const LICENSE_TYPES = [
  { value: '', label: 'Select License Type' },
  { value: 'state_medical', label: 'State Medical License' },
  { value: 'state_psychology', label: 'State Psychology License' },
  { value: 'state_social_work', label: 'State Social Work License' },
  { value: 'state_counseling', label: 'State Counseling License' },
  { value: 'state_marriage_family', label: 'State Marriage & Family License' },
  { value: 'dea', label: 'DEA Registration' },
  { value: 'controlled_substance', label: 'Controlled Substance License' },
  { value: 'npi', label: 'NPI' },
];

export default function PortalLicenseForm() {
  const { data, isLoading } = usePortalLicenses();
  const createMutation = useCreateLicense();

  const [form, setForm] = useState({
    state: '',
    licenseNumber: '',
    licenseType: '',
    expirationDate: '',
  });

  const licenses = (data as any)?.data ?? [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.licenseNumber || !form.licenseType || !form.expirationDate) {
      toast.error('Please fill in all required fields');
      return;
    }

    try {
      await createMutation.mutateAsync(form);
      toast.success('License added');
      setForm({ state: '', licenseNumber: '', licenseType: '', expirationDate: '' });
    } catch {
      toast.error('Failed to add license');
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200 border-t-primary-600" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Licenses</h1>

      {/* Add License Form */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <ShieldCheckIcon className="h-5 w-5 text-primary-500" />
          Add License
        </h2>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              License Type <span className="text-red-500">*</span>
            </label>
            <select
              name="licenseType"
              value={form.licenseType}
              onChange={handleChange}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 sm:text-sm"
            >
              {LICENSE_TYPES.map((lt) => (
                <option key={lt.value} value={lt.value}>{lt.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              License Number <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="licenseNumber"
              value={form.licenseNumber}
              onChange={handleChange}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 sm:text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
            <select
              name="state"
              value={form.state}
              onChange={handleChange}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 sm:text-sm"
            >
              <option value="">Select State</option>
              {US_STATES.filter(Boolean).map((st) => (
                <option key={st} value={st}>{st}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Expiration Date <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              name="expirationDate"
              value={form.expirationDate}
              onChange={handleChange}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 sm:text-sm"
            />
          </div>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-xl text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50"
            >
              {createMutation.isPending ? 'Adding...' : 'Add License'}
            </button>
          </div>
        </form>
      </div>

      {/* Existing Licenses */}
      {licenses.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6 text-center">
          <ShieldCheckIcon className="mx-auto h-10 w-10 text-gray-300 mb-2" />
          <p className="text-gray-500">No licenses added yet.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50/80">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Number</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">State</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Expires</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {licenses.map((lic: any) => (
                <tr key={lic.id} className="hover:bg-gray-50/80">
                  <td className="px-6 py-4 text-sm text-gray-900 capitalize">
                    {lic.licenseType.replace(/_/g, ' ')}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">{lic.licenseNumber}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">{lic.state || '\u2014'}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {new Date(lic.expirationDate).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 capitalize">
                      {lic.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
