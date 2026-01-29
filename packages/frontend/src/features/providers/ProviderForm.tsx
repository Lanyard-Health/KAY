import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { api } from '../../services/api';

const PROVIDER_TYPES = [
  { value: 'psychiatrist', label: 'Psychiatrist (MD/DO)' },
  { value: 'psychologist', label: 'Psychologist (PhD/PsyD)' },
  { value: 'lcsw', label: 'Licensed Clinical Social Worker (LCSW)' },
  { value: 'lpc', label: 'Licensed Professional Counselor (LPC)' },
  { value: 'lmft', label: 'Licensed Marriage & Family Therapist (LMFT)' },
  { value: 'pmhnp', label: 'Psychiatric Mental Health Nurse Practitioner (PMHNP)' },
  { value: 'other', label: 'Other' },
];

// Format phone number as (XXX) XXX-XXXX
const formatPhoneNumber = (value: string): string => {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 0) return '';
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
};

interface ProviderFormData {
  npi: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  suffix?: string;
  dateOfBirth: string;
  gender: 'male' | 'female' | 'other' | 'prefer_not_to_say';
  email: string;
  phone: string;
  mobilePhone?: string;
  providerType: string;
  taxonomy?: string;
}

export default function ProviderForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isEditing = !!id;

  const { data: provider, isLoading: loadingProvider } = useQuery({
    queryKey: ['provider', id],
    queryFn: async () => {
      const response = await api.get(`/providers/${id}`);
      return response.data.data;
    },
    enabled: isEditing,
  });

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ProviderFormData>({
    defaultValues: provider
      ? {
          ...provider,
          dateOfBirth: provider.dateOfBirth?.split('T')[0],
          phone: formatPhoneNumber(provider.phone || ''),
          mobilePhone: formatPhoneNumber(provider.mobilePhone || ''),
        }
      : {},
  });

  const phoneValue = watch('phone');
  const mobilePhoneValue = watch('mobilePhone');

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>, field: 'phone' | 'mobilePhone') => {
    const formatted = formatPhoneNumber(e.target.value);
    setValue(field, formatted, { shouldValidate: true });
  };

  const mutation = useMutation({
    mutationFn: async (data: ProviderFormData) => {
      if (isEditing) {
        return api.put(`/providers/${id}`, data);
      }
      return api.post('/providers', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['providers'] });
      if (id) queryClient.invalidateQueries({ queryKey: ['provider', id] });
      toast.success(isEditing ? 'Provider updated' : 'Provider created');
      navigate('/providers');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error?.message || 'An error occurred');
    },
  });

  const onSubmit = (data: ProviderFormData) => {
    mutation.mutate(data);
  };

  if (isEditing && loadingProvider) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          {isEditing ? 'Edit Provider' : 'Add New Provider'}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {isEditing
            ? 'Update provider information'
            : 'Enter the provider details to create a new record'}
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Basic Information */}
        <div className="card card-body">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Basic Information</h2>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <label className="label">NPI *</label>
              <input
                type="text"
                {...register('npi', {
                  required: 'NPI is required',
                  pattern: {
                    value: /^\d{10}$/,
                    message: 'NPI must be exactly 10 digits',
                  },
                })}
                className="input"
                placeholder="1234567890"
              />
              {errors.npi && (
                <p className="mt-1 text-sm text-red-600">{errors.npi.message}</p>
              )}
            </div>

            <div>
              <label className="label">Provider Type *</label>
              <select {...register('providerType', { required: true })} className="input">
                <option value="">Select type...</option>
                {PROVIDER_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">First Name *</label>
              <input
                type="text"
                {...register('firstName', { required: 'First name is required' })}
                className="input"
              />
              {errors.firstName && (
                <p className="mt-1 text-sm text-red-600">{errors.firstName.message}</p>
              )}
            </div>

            <div>
              <label className="label">Last Name *</label>
              <input
                type="text"
                {...register('lastName', { required: 'Last name is required' })}
                className="input"
              />
              {errors.lastName && (
                <p className="mt-1 text-sm text-red-600">{errors.lastName.message}</p>
              )}
            </div>

            <div>
              <label className="label">Middle Name</label>
              <input type="text" {...register('middleName')} className="input" />
            </div>

            <div>
              <label className="label">Suffix</label>
              <input
                type="text"
                {...register('suffix')}
                className="input"
                placeholder="MD, PhD, etc."
              />
            </div>
          </div>
        </div>

        {/* Personal Information */}
        <div className="card card-body">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Personal Information</h2>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <label className="label">Date of Birth *</label>
              <input
                type="date"
                {...register('dateOfBirth', { required: 'Date of birth is required' })}
                className="input"
              />
              {errors.dateOfBirth && (
                <p className="mt-1 text-sm text-red-600">{errors.dateOfBirth.message}</p>
              )}
            </div>

            <div>
              <label className="label">Gender *</label>
              <select {...register('gender', { required: true })} className="input">
                <option value="">Select...</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
                <option value="prefer_not_to_say">Prefer not to say</option>
              </select>
            </div>
          </div>
        </div>

        {/* Contact Information */}
        <div className="card card-body">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Contact Information</h2>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <label className="label">Email *</label>
              <input
                type="email"
                {...register('email', {
                  required: 'Email is required',
                  pattern: {
                    value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                    message: 'Invalid email address',
                  },
                })}
                className="input"
              />
              {errors.email && (
                <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>
              )}
            </div>

            <div>
              <label className="label">Phone *</label>
              <input
                type="tel"
                value={phoneValue || ''}
                onChange={(e) => handlePhoneChange(e, 'phone')}
                className="input"
                placeholder="(555) 555-5555"
              />
              <input type="hidden" {...register('phone', { required: 'Phone is required' })} />
              {errors.phone && (
                <p className="mt-1 text-sm text-red-600">{errors.phone.message}</p>
              )}
            </div>

            <div>
              <label className="label">Mobile Phone</label>
              <input
                type="tel"
                value={mobilePhoneValue || ''}
                onChange={(e) => handlePhoneChange(e, 'mobilePhone')}
                className="input"
                placeholder="(555) 555-5555"
              />
              <input type="hidden" {...register('mobilePhone')} />
            </div>

            <div>
              <label className="label">Taxonomy Code</label>
              <input
                type="text"
                {...register('taxonomy')}
                className="input"
                placeholder="101Y00000X"
              />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => navigate('/providers')}
            className="btn-secondary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting || mutation.isPending}
            className="btn-primary"
          >
            {isSubmitting || mutation.isPending
              ? 'Saving...'
              : isEditing
              ? 'Update Provider'
              : 'Create Provider'}
          </button>
        </div>
      </form>
    </div>
  );
}
