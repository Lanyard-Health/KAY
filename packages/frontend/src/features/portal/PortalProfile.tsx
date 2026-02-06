import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCurrentProvider } from './hooks/usePortalData';
import { api } from '../../services/api';

interface ProfileForm {
  firstName: string;
  lastName: string;
  middleName: string;
  suffix: string;
  email: string;
  phone: string;
  specialties: string;
  languages: string;
  taxonomy: string;
}

export default function PortalProfile() {
  const { data, isLoading, error } = useCurrentProvider();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<ProfileForm>({
    firstName: '',
    lastName: '',
    middleName: '',
    suffix: '',
    email: '',
    phone: '',
    specialties: '',
    languages: '',
    taxonomy: '',
  });

  const provider = (data as any)?.data?.provider;

  useEffect(() => {
    if (provider) {
      setForm({
        firstName: provider.firstName || '',
        lastName: provider.lastName || '',
        middleName: provider.middleName || '',
        suffix: provider.suffix || '',
        email: provider.email || '',
        phone: provider.phone || '',
        specialties: (provider.specialties || []).join(', '),
        languages: (provider.languages || []).join(', '),
        taxonomy: provider.taxonomy || '',
      });
    }
  }, [provider]);

  const updateProfile = useMutation({
    mutationFn: async (updates: Record<string, unknown>) => {
      const response = await api.put(`/providers/${provider!.id}`, updates);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal'] });
      setIsEditing(false);
    },
  });

  const handleSave = () => {
    updateProfile.mutate({
      firstName: form.firstName,
      lastName: form.lastName,
      middleName: form.middleName || null,
      suffix: form.suffix || null,
      email: form.email,
      phone: form.phone,
      specialties: form.specialties.split(',').map((s) => s.trim()).filter(Boolean),
      languages: form.languages.split(',').map((s) => s.trim()).filter(Boolean),
      taxonomy: form.taxonomy || null,
    });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200 border-t-primary-600" />
      </div>
    );
  }

  if (error || !provider) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <p className="text-sm text-red-600">Failed to load profile</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Profile</h1>
          <p className="mt-1 text-sm text-gray-500">NPI: {provider.npi}</p>
        </div>
        {!isEditing ? (
          <button
            onClick={() => setIsEditing(true)}
            className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700"
          >
            Edit Profile
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => {
                setIsEditing(false);
                if (provider) {
                  setForm({
                    firstName: provider.firstName || '',
                    lastName: provider.lastName || '',
                    middleName: provider.middleName || '',
                    suffix: provider.suffix || '',
                    email: provider.email || '',
                    phone: provider.phone || '',
                    specialties: (provider.specialties || []).join(', '),
                    languages: (provider.languages || []).join(', '),
                    taxonomy: provider.taxonomy || '',
                  });
                }
              }}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={updateProfile.isPending}
              className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50"
            >
              {updateProfile.isPending ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        )}
      </div>

      {updateProfile.isError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm text-red-600">
            {updateProfile.error instanceof Error ? updateProfile.error.message : 'Failed to save'}
          </p>
        </div>
      )}

      {/* Personal Information */}
      <div className="bg-white rounded-lg shadow mb-6">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Personal Information</h2>
        </div>
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">First Name</label>
            {isEditing ? (
              <input
                type="text"
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
              />
            ) : (
              <p className="text-gray-900">{provider.firstName}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
            {isEditing ? (
              <input
                type="text"
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
              />
            ) : (
              <p className="text-gray-900">{provider.lastName}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Middle Name</label>
            {isEditing ? (
              <input
                type="text"
                value={form.middleName}
                onChange={(e) => setForm({ ...form, middleName: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
              />
            ) : (
              <p className="text-gray-900">{provider.middleName || '\u2014'}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Suffix</label>
            {isEditing ? (
              <input
                type="text"
                value={form.suffix}
                onChange={(e) => setForm({ ...form, suffix: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
              />
            ) : (
              <p className="text-gray-900">{provider.suffix || '\u2014'}</p>
            )}
          </div>
        </div>
      </div>

      {/* Contact Information */}
      <div className="bg-white rounded-lg shadow mb-6">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Contact Information</h2>
        </div>
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            {isEditing ? (
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
              />
            ) : (
              <p className="text-gray-900">{provider.email || '\u2014'}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            {isEditing ? (
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
              />
            ) : (
              <p className="text-gray-900">{provider.phone || '\u2014'}</p>
            )}
          </div>
        </div>
      </div>

      {/* Professional Information */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Professional Information</h2>
        </div>
        <div className="p-6 grid grid-cols-1 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Taxonomy Code</label>
            {isEditing ? (
              <input
                type="text"
                value={form.taxonomy}
                onChange={(e) => setForm({ ...form, taxonomy: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
              />
            ) : (
              <p className="text-gray-900">{provider.taxonomy || '\u2014'}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Specialties <span className="text-gray-400 font-normal">(comma separated)</span>
            </label>
            {isEditing ? (
              <input
                type="text"
                value={form.specialties}
                onChange={(e) => setForm({ ...form, specialties: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
              />
            ) : (
              <p className="text-gray-900">
                {provider.specialties?.length > 0 ? provider.specialties.join(', ') : '\u2014'}
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Languages <span className="text-gray-400 font-normal">(comma separated)</span>
            </label>
            {isEditing ? (
              <input
                type="text"
                value={form.languages}
                onChange={(e) => setForm({ ...form, languages: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
              />
            ) : (
              <p className="text-gray-900">
                {provider.languages?.length > 0 ? provider.languages.join(', ') : '\u2014'}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
