import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { api } from '../../services/api';
import {
  CheckIcon,
  UserIcon,
  BriefcaseIcon,
  DocumentTextIcon,
  ClipboardDocumentCheckIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CloudArrowUpIcon,
} from '@heroicons/react/24/outline';
import { CheckCircleIcon } from '@heroicons/react/24/solid';
import clsx from 'clsx';
import DocumentUploadModal from '../../components/DocumentUploadModal';

const PROVIDER_TYPES = [
  { value: 'psychiatrist', label: 'Psychiatrist (MD/DO)' },
  { value: 'psychologist', label: 'Psychologist (PhD/PsyD)' },
  { value: 'lcsw', label: 'Licensed Clinical Social Worker (LCSW)' },
  { value: 'lpc', label: 'Licensed Professional Counselor (LPC)' },
  { value: 'lmft', label: 'Licensed Marriage & Family Therapist (LMFT)' },
  { value: 'pmhnp', label: 'Psychiatric Mental Health Nurse Practitioner (PMHNP)' },
  { value: 'other', label: 'Other' },
];

const PROVIDER_STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'pending', label: 'Pending' },
  { value: 'inactive', label: 'Inactive' },
];

const WIZARD_STEPS = [
  { id: 1, name: 'Basic Info', icon: UserIcon, description: 'Name and contact details' },
  { id: 2, name: 'Professional', icon: BriefcaseIcon, description: 'Provider type and credentials' },
  { id: 3, name: 'Documents', icon: DocumentTextIcon, description: 'Upload required documents' },
  { id: 4, name: 'Review', icon: ClipboardDocumentCheckIcon, description: 'Review and submit' },
];

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
  status?: 'active' | 'pending' | 'inactive';
}

export default function ProviderForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isEditing = !!id;

  const [currentStep, setCurrentStep] = useState(1);
  const [createdProviderId, setCreatedProviderId] = useState<string | null>(null);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadedDocs, setUploadedDocs] = useState<{ type: string; name: string }[]>([]);

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
    trigger,
    formState: { errors, isSubmitting },
  } = useForm<ProviderFormData>({
    defaultValues: provider
      ? {
          ...provider,
          dateOfBirth: provider.dateOfBirth?.split('T')[0],
          phone: formatPhoneNumber(provider.phone || ''),
          mobilePhone: formatPhoneNumber(provider.mobilePhone || ''),
          status: provider.status || 'pending',
        }
      : {
          status: 'pending',
        },
  });

  const formValues = watch();

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
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['providers'] });
      if (isEditing) {
        queryClient.invalidateQueries({ queryKey: ['provider', id] });
        toast.success('Provider updated');
        navigate('/providers');
      } else {
        const newProviderId = response.data.data.id;
        setCreatedProviderId(newProviderId);
        toast.success('Provider created! Now upload documents.');
        setCurrentStep(3);
      }
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error?.message || 'An error occurred');
    },
  });

  const validateStep = async (step: number): Promise<boolean> => {
    let fieldsToValidate: (keyof ProviderFormData)[] = [];

    switch (step) {
      case 1:
        fieldsToValidate = ['firstName', 'lastName', 'email', 'phone'];
        break;
      case 2:
        fieldsToValidate = ['npi', 'providerType', 'dateOfBirth', 'gender'];
        break;
    }

    const result = await trigger(fieldsToValidate);
    return result;
  };

  const nextStep = async () => {
    if (currentStep === 2) {
      // Submit the form after step 2
      handleSubmit((data) => mutation.mutate(data))();
    } else if (currentStep < 4) {
      const isValid = await validateStep(currentStep);
      if (isValid) {
        setCurrentStep(currentStep + 1);
      }
    }
  };

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const finishWizard = () => {
    toast.success('Provider setup complete!');
    navigate(`/providers/${createdProviderId}`);
  };

  if (isEditing && loadingProvider) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  // Regular form for editing
  if (isEditing) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Edit Provider</h1>
          <p className="mt-1 text-sm text-gray-500">Update provider information</p>
        </div>

        <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-6">
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
                    pattern: { value: /^\d{10}$/, message: 'NPI must be exactly 10 digits' },
                  })}
                  className="input"
                />
                {errors.npi && <p className="mt-1 text-sm text-red-600">{errors.npi.message}</p>}
              </div>
              <div>
                <label className="label">Provider Type *</label>
                <select {...register('providerType', { required: true })} className="input">
                  <option value="">Select type...</option>
                  {PROVIDER_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Status</label>
                <select {...register('status')} className="input">
                  {PROVIDER_STATUSES.map((status) => (
                    <option key={status.value} value={status.value}>{status.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">First Name *</label>
                <input {...register('firstName', { required: 'Required' })} className="input" />
                {errors.firstName && <p className="mt-1 text-sm text-red-600">{errors.firstName.message}</p>}
              </div>
              <div>
                <label className="label">Last Name *</label>
                <input {...register('lastName', { required: 'Required' })} className="input" />
                {errors.lastName && <p className="mt-1 text-sm text-red-600">{errors.lastName.message}</p>}
              </div>
              <div>
                <label className="label">Middle Name</label>
                <input {...register('middleName')} className="input" />
              </div>
              <div>
                <label className="label">Suffix</label>
                <input {...register('suffix')} className="input" placeholder="MD, PhD, etc." />
              </div>
              <div>
                <label className="label">Date of Birth *</label>
                <input type="date" {...register('dateOfBirth', { required: true })} className="input" />
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
              <div>
                <label className="label">Email *</label>
                <input
                  type="email"
                  {...register('email', { required: 'Required', pattern: { value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i, message: 'Invalid email' } })}
                  className="input"
                />
                {errors.email && <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>}
              </div>
              <div>
                <label className="label">Phone *</label>
                <input
                  type="tel"
                  value={formValues.phone || ''}
                  onChange={(e) => handlePhoneChange(e, 'phone')}
                  className="input"
                  placeholder="(555) 555-5555"
                />
                <input type="hidden" {...register('phone', { required: 'Required' })} />
                {errors.phone && <p className="mt-1 text-sm text-red-600">{errors.phone.message}</p>}
              </div>
              <div>
                <label className="label">Mobile Phone</label>
                <input
                  type="tel"
                  value={formValues.mobilePhone || ''}
                  onChange={(e) => handlePhoneChange(e, 'mobilePhone')}
                  className="input"
                  placeholder="(555) 555-5555"
                />
                <input type="hidden" {...register('mobilePhone')} />
              </div>
              <div>
                <label className="label">Taxonomy Code</label>
                <input {...register('taxonomy')} className="input" placeholder="101Y00000X" />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => navigate('/providers')} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={isSubmitting || mutation.isPending} className="btn-primary">
              {mutation.isPending ? 'Saving...' : 'Update Provider'}
            </button>
          </div>
        </form>
      </div>
    );
  }

  // Wizard for new providers
  return (
    <div className="max-w-4xl mx-auto">
      {/* Wizard Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Add New Provider</h1>
        <p className="mt-1 text-sm text-gray-500">
          Follow the steps below to add a new provider to your system
        </p>
      </div>

      {/* Step Indicator */}
      <nav aria-label="Progress" className="mb-8">
        <ol className="flex items-center">
          {WIZARD_STEPS.map((step, stepIdx) => (
            <li key={step.id} className={clsx('relative', stepIdx !== WIZARD_STEPS.length - 1 && 'pr-8 sm:pr-20 flex-1')}>
              <div className="flex items-center">
                <div
                  className={clsx(
                    'relative flex h-10 w-10 items-center justify-center rounded-full transition-all',
                    currentStep > step.id
                      ? 'bg-green-600'
                      : currentStep === step.id
                      ? 'bg-primary-600'
                      : 'bg-gray-200'
                  )}
                >
                  {currentStep > step.id ? (
                    <CheckIcon className="h-6 w-6 text-white" />
                  ) : (
                    <step.icon className={clsx('h-5 w-5', currentStep === step.id ? 'text-white' : 'text-gray-500')} />
                  )}
                </div>
                {stepIdx !== WIZARD_STEPS.length - 1 && (
                  <div className={clsx(
                    'hidden sm:block absolute top-5 left-10 w-full h-0.5 transition-all',
                    currentStep > step.id ? 'bg-green-600' : 'bg-gray-200'
                  )} />
                )}
              </div>
              <div className="mt-2">
                <span className={clsx(
                  'text-sm font-medium',
                  currentStep >= step.id ? 'text-primary-600' : 'text-gray-500'
                )}>
                  {step.name}
                </span>
                <p className="text-xs text-gray-500 hidden sm:block">{step.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </nav>

      {/* Step Content */}
      <div className="card">
        {/* Step 1: Basic Info */}
        {currentStep === 1 && (
          <div className="card-body">
            <h2 className="text-lg font-semibold text-gray-900 mb-6">Basic Information</h2>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div>
                <label className="label">First Name *</label>
                <input
                  {...register('firstName', { required: 'First name is required' })}
                  className="input"
                  placeholder="Enter first name"
                />
                {errors.firstName && <p className="mt-1 text-sm text-red-600">{errors.firstName.message}</p>}
              </div>
              <div>
                <label className="label">Last Name *</label>
                <input
                  {...register('lastName', { required: 'Last name is required' })}
                  className="input"
                  placeholder="Enter last name"
                />
                {errors.lastName && <p className="mt-1 text-sm text-red-600">{errors.lastName.message}</p>}
              </div>
              <div>
                <label className="label">Middle Name</label>
                <input {...register('middleName')} className="input" placeholder="Optional" />
              </div>
              <div>
                <label className="label">Suffix</label>
                <input {...register('suffix')} className="input" placeholder="MD, PhD, etc." />
              </div>
              <div>
                <label className="label">Email *</label>
                <input
                  type="email"
                  {...register('email', {
                    required: 'Email is required',
                    pattern: { value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i, message: 'Invalid email address' },
                  })}
                  className="input"
                  placeholder="provider@example.com"
                />
                {errors.email && <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>}
              </div>
              <div>
                <label className="label">Phone *</label>
                <input
                  type="tel"
                  value={formValues.phone || ''}
                  onChange={(e) => handlePhoneChange(e, 'phone')}
                  className="input"
                  placeholder="(555) 555-5555"
                />
                <input type="hidden" {...register('phone', { required: 'Phone is required' })} />
                {errors.phone && <p className="mt-1 text-sm text-red-600">{errors.phone.message}</p>}
              </div>
              <div className="sm:col-span-2">
                <label className="label">Mobile Phone</label>
                <input
                  type="tel"
                  value={formValues.mobilePhone || ''}
                  onChange={(e) => handlePhoneChange(e, 'mobilePhone')}
                  className="input"
                  placeholder="(555) 555-5555"
                />
                <input type="hidden" {...register('mobilePhone')} />
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Professional Details */}
        {currentStep === 2 && (
          <div className="card-body">
            <h2 className="text-lg font-semibold text-gray-900 mb-6">Professional Details</h2>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div>
                <label className="label">NPI (National Provider Identifier) *</label>
                <input
                  {...register('npi', {
                    required: 'NPI is required',
                    pattern: { value: /^\d{10}$/, message: 'NPI must be exactly 10 digits' },
                  })}
                  className="input"
                  placeholder="1234567890"
                  maxLength={10}
                />
                {errors.npi && <p className="mt-1 text-sm text-red-600">{errors.npi.message}</p>}
                <p className="mt-1 text-xs text-gray-500">10-digit National Provider Identifier</p>
              </div>
              <div>
                <label className="label">Provider Type *</label>
                <select {...register('providerType', { required: 'Provider type is required' })} className="input">
                  <option value="">Select provider type...</option>
                  {PROVIDER_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </select>
                {errors.providerType && <p className="mt-1 text-sm text-red-600">{errors.providerType.message}</p>}
              </div>
              <div>
                <label className="label">Date of Birth *</label>
                <input
                  type="date"
                  {...register('dateOfBirth', { required: 'Date of birth is required' })}
                  className="input"
                />
                {errors.dateOfBirth && <p className="mt-1 text-sm text-red-600">{errors.dateOfBirth.message}</p>}
              </div>
              <div>
                <label className="label">Gender *</label>
                <select {...register('gender', { required: 'Gender is required' })} className="input">
                  <option value="">Select gender...</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                  <option value="prefer_not_to_say">Prefer not to say</option>
                </select>
                {errors.gender && <p className="mt-1 text-sm text-red-600">{errors.gender.message}</p>}
              </div>
              <div className="sm:col-span-2">
                <label className="label">Taxonomy Code</label>
                <input {...register('taxonomy')} className="input" placeholder="101Y00000X" />
                <p className="mt-1 text-xs text-gray-500">Healthcare Provider Taxonomy Code (optional)</p>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Documents */}
        {currentStep === 3 && (
          <div className="card-body">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Upload Documents</h2>
            <p className="text-sm text-gray-500 mb-6">
              Upload the required documents for credentialing. You can also do this later.
            </p>

            <div className="space-y-4">
              {[
                { type: 'w9', label: 'W-9 Form', description: 'Tax identification form' },
                { type: 'coi', label: 'Certificate of Insurance (COI)', description: 'Malpractice insurance certificate' },
                { type: 'cp575', label: 'IRS CP575 Letter', description: 'EIN confirmation letter' },
              ].map((doc) => {
                const isUploaded = uploadedDocs.some(d => d.type === doc.type);
                return (
                  <div
                    key={doc.type}
                    className={clsx(
                      'flex items-center justify-between p-4 border rounded-lg transition-all',
                      isUploaded ? 'border-green-200 bg-green-50' : 'border-gray-200 hover:border-primary-300'
                    )}
                  >
                    <div className="flex items-center gap-3">
                      {isUploaded ? (
                        <CheckCircleIcon className="h-8 w-8 text-green-500" />
                      ) : (
                        <DocumentTextIcon className="h-8 w-8 text-gray-400" />
                      )}
                      <div>
                        <p className="font-medium text-gray-900">{doc.label}</p>
                        <p className="text-sm text-gray-500">{doc.description}</p>
                      </div>
                    </div>
                    {isUploaded ? (
                      <span className="text-sm text-green-600 font-medium">Uploaded</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setUploadModalOpen(true);
                        }}
                        className="btn-secondary text-sm py-2"
                      >
                        <CloudArrowUpIcon className="h-4 w-4 mr-1" />
                        Upload
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-6 p-4 bg-blue-50 rounded-lg">
              <p className="text-sm text-blue-800">
                <strong>Tip:</strong> You can skip this step and upload documents later from the provider's profile page.
              </p>
            </div>
          </div>
        )}

        {/* Step 4: Review */}
        {currentStep === 4 && (
          <div className="card-body">
            <h2 className="text-lg font-semibold text-gray-900 mb-6">Review & Complete</h2>

            <div className="space-y-6">
              {/* Summary */}
              <div className="bg-gray-50 rounded-lg p-6">
                <div className="flex items-center gap-4 mb-4">
                  <div className="h-16 w-16 rounded-full bg-primary-100 flex items-center justify-center">
                    <span className="text-primary-600 font-bold text-2xl">
                      {formValues.firstName?.[0]}{formValues.lastName?.[0]}
                    </span>
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold text-gray-900">
                      {formValues.firstName} {formValues.lastName}
                      {formValues.suffix && `, ${formValues.suffix}`}
                    </h3>
                    <p className="text-gray-500">
                      {PROVIDER_TYPES.find(t => t.value === formValues.providerType)?.label || formValues.providerType}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-gray-500">NPI</p>
                    <p className="font-medium">{formValues.npi}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Email</p>
                    <p className="font-medium">{formValues.email}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Phone</p>
                    <p className="font-medium">{formValues.phone}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Date of Birth</p>
                    <p className="font-medium">{formValues.dateOfBirth}</p>
                  </div>
                </div>
              </div>

              {/* Documents Summary */}
              <div>
                <h4 className="font-medium text-gray-900 mb-3">Documents Uploaded</h4>
                {uploadedDocs.length > 0 ? (
                  <ul className="space-y-2">
                    {uploadedDocs.map((doc, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm">
                        <CheckCircleIcon className="h-5 w-5 text-green-500" />
                        <span>{doc.name}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-500">No documents uploaded yet. You can add them later.</p>
                )}
              </div>

              {/* Next Steps */}
              <div className="bg-primary-50 rounded-lg p-4">
                <h4 className="font-medium text-primary-900 mb-2">What's Next?</h4>
                <ul className="text-sm text-primary-800 space-y-1">
                  <li>• Complete the credentialing checklist</li>
                  <li>• Add practice locations</li>
                  <li>• Start payer enrollments</li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Navigation Buttons */}
        <div className="px-6 py-4 bg-gray-50 border-t flex justify-between">
          <button
            type="button"
            onClick={currentStep === 1 ? () => navigate('/providers') : prevStep}
            className="btn-secondary"
          >
            <ArrowLeftIcon className="h-4 w-4 mr-2" />
            {currentStep === 1 ? 'Cancel' : 'Back'}
          </button>

          {currentStep < 4 ? (
            <button
              type="button"
              onClick={nextStep}
              disabled={mutation.isPending}
              className="btn-primary"
            >
              {mutation.isPending ? (
                'Creating...'
              ) : currentStep === 2 ? (
                'Create Provider'
              ) : currentStep === 3 ? (
                <>
                  Continue
                  <ArrowRightIcon className="h-4 w-4 ml-2" />
                </>
              ) : (
                <>
                  Next
                  <ArrowRightIcon className="h-4 w-4 ml-2" />
                </>
              )}
            </button>
          ) : (
            <button type="button" onClick={finishWizard} className="btn-primary">
              <CheckIcon className="h-4 w-4 mr-2" />
              Go to Provider Profile
            </button>
          )}
        </div>
      </div>

      {/* Upload Modal */}
      {createdProviderId && (
        <DocumentUploadModal
          isOpen={uploadModalOpen}
          onClose={() => setUploadModalOpen(false)}
          providerId={createdProviderId}
          providerName={`${formValues.firstName} ${formValues.lastName}`}
          onUploadComplete={() => {
            setUploadedDocs([...uploadedDocs, { type: 'document', name: 'Document uploaded' }]);
          }}
        />
      )}
    </div>
  );
}
