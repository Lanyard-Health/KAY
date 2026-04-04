import { useState, useEffect } from 'react';
import { useCurrentPractice, useUpdateCurrentPractice } from '../../hooks/useSettings';

export default function PracticeProfileTab() {
  const { data: practice, isLoading } = useCurrentPractice();
  const updatePractice = useUpdateCurrentPractice();

  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    website: '',
    notes: '',
  });
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (practice) {
      setForm({
        name: practice.name || '',
        phone: practice.phone || '',
        email: practice.email || '',
        website: practice.website || '',
        notes: practice.notes || '',
      });
      setIsDirty(false);
    }
  }, [practice]);

  const handleChange = (field: string, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    setIsDirty(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updatePractice.mutate(form, {
      onSuccess: () => setIsDirty(false),
    });
  };

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4 max-w-2xl">
        <div className="h-10 bg-gray-200 rounded w-2/3" />
        <div className="h-10 bg-gray-200 rounded w-1/2" />
        <div className="h-10 bg-gray-200 rounded w-3/4" />
      </div>
    );
  }

  if (!practice) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-gray-500">No practice found. You may not be assigned to a practice.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="space-y-6 max-w-2xl">
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700">Practice Name</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => handleChange('name', e.target.value)}
            required
            className="input-field mt-1"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Phone</label>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => handleChange('phone', e.target.value)}
              className="input-field mt-1"
              placeholder="(555) 123-4567"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => handleChange('email', e.target.value)}
              className="input-field mt-1"
              placeholder="office@practice.com"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Website</label>
          <input
            type="url"
            value={form.website}
            onChange={(e) => handleChange('website', e.target.value)}
            className="input-field mt-1"
            placeholder="https://www.practice.com"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Notes</label>
          <textarea
            value={form.notes}
            onChange={(e) => handleChange('notes', e.target.value)}
            rows={3}
            className="input-field mt-1"
            placeholder="Internal notes about this practice..."
          />
        </div>
      </div>

      {isDirty && (
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={updatePractice.isPending}
            className="btn-primary text-sm"
          >
            {updatePractice.isPending ? 'Saving...' : 'Save Changes'}
          </button>
          <button
            type="button"
            onClick={() => {
              if (practice) {
                setForm({
                  name: practice.name || '',
                  phone: practice.phone || '',
                  email: practice.email || '',
                  website: practice.website || '',
                  notes: practice.notes || '',
                });
                setIsDirty(false);
              }
            }}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Discard
          </button>
        </div>
      )}
    </form>
  );
}
