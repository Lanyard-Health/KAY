import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useFormPersistence } from '../../hooks/useFormPersistence';
import toast from 'react-hot-toast';
import { api } from '../../services/api';
import {
  CheckIcon,
  UserIcon,
  DocumentTextIcon,
  ClipboardDocumentCheckIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CloudArrowUpIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { CheckCircleIcon } from '@heroicons/react/24/solid';
import clsx from 'clsx';
import DocumentUploadModal from '../../components/DocumentUploadModal';
import { useAuthStore } from '../../stores/auth.store';
import { usePractice, usePractices } from '../../hooks/usePractices';

interface NPILookupResult {
  found: boolean;
  npi?: string;
  entityType?: 'individual' | 'organization';
  firstName?: string;
  lastName?: string;
  middleName?: string;
  suffix?: string;
  credential?: string;
  gender?: string;
  organizationName?: string;
  status?: string;
  enumerationDate?: string;
  lastUpdated?: string;
  primaryTaxonomy?: {
    code: string;
    description: string;
    license?: string;
    state?: string;
  };
  allTaxonomies?: Array<{
    code: string;
    description: string;
    primary: boolean;
    license?: string;
    state?: string;
  }>;
  practiceLocation?: {
    addressLine1: string;
    addressLine2?: string;
    city: string;
    state: string;
    zipCode: string;
    phone?: string;
    fax?: string;
  };
  mailingAddress?: {
    addressLine1: string;
    addressLine2?: string;
    city: string;
    state: string;
    zipCode: string;
    phone?: string;
    fax?: string;
  };
  otherIdentifiers?: Array<{
    type: string;
    identifier: string;
    issuer?: string;
    state?: string;
  }>;
}

interface MedicareEnrollment {
  enrollmentId: string;
  enrollmentDate: string;
  providerTypeCode: string;
  providerTypeDesc: string;
  state: string;
}

interface MedicareEnrollmentResult {
  found: boolean;
  npi?: string;
  pacId?: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  organizationName?: string;
  multipleNpiFlag?: boolean;
  enrollments?: MedicareEnrollment[];
  primaryEnrollment?: MedicareEnrollment;
  orderingPrivileges?: {
    partB: boolean;
    dme: boolean;
    hha: boolean;
    pmd: boolean;
    hospice: boolean;
  };
  verifiedAt?: string;
}

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
  { id: 1, name: 'NPI Lookup', icon: MagnifyingGlassIcon, description: 'Enter NPI to auto-fill' },
  { id: 2, name: 'Provider Info', icon: UserIcon, description: 'Confirm and complete details' },
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
  groupNpi?: string;
  taxId?: string;
  practiceId?: string;
}

export default function ProviderForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isEditing = !!id;

  // Fetch current user's practice for address pre-fill
  const user = useAuthStore((s) => s.user);
  const userPracticeId = user?.practices?.[0]?.practiceId;
  const { data: userPractice } = usePractice(userPracticeId ?? '');

  // practice_admin gets practiceId auto-set server-side; everyone else must pick
  // one, or the provider is created unlinked and invisible to practice-scoped roles.
  const needsPracticePicker = !isEditing && user?.role !== 'practice_admin';
  const { data: practiceOptions } = usePractices({ enabled: needsPracticePicker });

  const persistKey = `provider-form:new:${user?.id ?? 'anon'}`;

  const persistedFormDefaults = (() => {
    if (isEditing) return null;
    try {
      const raw = sessionStorage.getItem(`form:${persistKey}:values`);
      if (!raw) return null;
      const { value, savedAt } = JSON.parse(raw);
      if (typeof savedAt !== 'number' || Date.now() - savedAt > 24 * 60 * 60 * 1000) {
        sessionStorage.removeItem(`form:${persistKey}:values`);
        return null;
      }
      return value;
    } catch {
      return null;
    }
  })();

  const [currentStep, setCurrentStep, clearPersistedStep] = useFormPersistence<number>(
    `${persistKey}:step`,
    1
  );
  const [createdProviderId, setCreatedProviderId] = useState<string | null>(null);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadedDocs, setUploadedDocs, clearPersistedDocs] = useFormPersistence<{ type: string; name: string }[]>(
    `${persistKey}:docs`,
    []
  );
  const [npiLookupModalOpen, setNpiLookupModalOpen] = useState(false);
  const [locationCreated, setLocationCreated] = useState<boolean | null>(null);
  const [npiLookupResult, setNpiLookupResult] = useState<NPILookupResult | null>(null);
  const [npiLookupLoading, setNpiLookupLoading] = useState(false);
  const [medicareEnrollment, setMedicareEnrollment] = useState<MedicareEnrollmentResult | null>(null);

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
          groupNpi: (provider.practiceLocations?.find((l: any) => l.isPrimary) || provider.practiceLocations?.[0])?.groupNpi || '',
          taxId: (provider.practiceLocations?.find((l: any) => l.isPrimary) || provider.practiceLocations?.[0])?.taxId || '',
        }
      : persistedFormDefaults
      ? { status: 'active', ...persistedFormDefaults }
      : {
          status: 'active',
        },
  });

  const formValues = watch();

  useEffect(() => {
    if (isEditing) return;
    const subscription = watch((value) => {
      try {
        sessionStorage.setItem(
          `form:${persistKey}:values`,
          JSON.stringify({ value, savedAt: Date.now() })
        );
      } catch {
        /* quota exceeded — ignore */
      }
    });
    return () => subscription.unsubscribe();
  }, [watch, persistKey, isEditing]);

  const clearPersistedForm = () => {
    try {
      sessionStorage.removeItem(`form:${persistKey}:values`);
    } catch {
      /* ignore */
    }
    clearPersistedStep();
    clearPersistedDocs();
  };

  // A finished run clears the form values but a later setCurrentStep re-persists
  // the step. If the user left without clicking "Go to Provider Profile", the next
  // visit restores step 3/4 with an empty form — a blank Review the user can't
  // submit from. No persisted values on a step past 1 means stale state: start over.
  useEffect(() => {
    if (isEditing || currentStep <= 1) return;
    let hasValues = false;
    try {
      hasValues = !!sessionStorage.getItem(`form:${persistKey}:values`);
    } catch {
      /* ignore */
    }
    if (!hasValues) {
      clearPersistedForm();
      setCurrentStep(1);
      setUploadedDocs([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    onSuccess: async (response) => {
      queryClient.invalidateQueries({ queryKey: ['providers'] });
      if (isEditing) {
        queryClient.invalidateQueries({ queryKey: ['provider', id] });
        // Save groupNpi/taxId to practice location if changed
        const primaryLocation = provider?.practiceLocations?.find((l: any) => l.isPrimary) || provider?.practiceLocations?.[0];
        if (primaryLocation) {
          const locationUpdates: Record<string, string> = {};
          const currentGroupNpi = primaryLocation.groupNpi || '';
          const currentTaxId = primaryLocation.taxId || '';
          if (formValues.groupNpi !== currentGroupNpi) locationUpdates.groupNpi = formValues.groupNpi || '';
          if (formValues.taxId !== currentTaxId) locationUpdates.taxId = formValues.taxId || '';
          if (Object.keys(locationUpdates).length > 0) {
            try {
              await api.put(`/practice-locations/${primaryLocation.id}`, locationUpdates);
            } catch (err) {
              console.error('Failed to update practice location identifiers:', err);
            }
          }
        }
        toast.success('Provider updated');
        navigate('/providers');
      } else {
        const newProviderId = response.data.data.id;
        setCreatedProviderId(newProviderId);
        clearPersistedForm();

        // Create practice location from NPI data, or fall back to practice address
        const npiLoc = npiLookupResult?.found ? npiLookupResult.practiceLocation : null;
        const practiceLoc = userPractice?.addressLine1 ? userPractice : null;
        const loc = npiLoc || practiceLoc;

        if (loc) {
          try {
            await api.post(`/practice-locations/provider/${newProviderId}`, {
              locationName: `${loc.city} Office`,
              locationType: 'office',
              isPrimary: true,
              addressLine1: loc.addressLine1,
              addressLine2: loc.addressLine2 || undefined,
              city: loc.city,
              state: loc.state,
              zipCode: loc.zipCode,
              phone: (npiLoc && 'phone' in npiLoc ? npiLoc.phone : null) || formValues.phone,
              fax: (npiLoc && 'fax' in npiLoc ? npiLoc.fax : undefined) || undefined,
              ...(formValues.groupNpi && { groupNpi: formValues.groupNpi }),
              ...(formValues.taxId && { taxId: formValues.taxId }),
            });
            setLocationCreated(true);
            const source = npiLoc ? 'NPI registry' : 'practice';
            toast.success(`Provider created with address from ${source}! Now upload documents.`);
          } catch (err) {
            setLocationCreated(false);
            console.error('Failed to create practice location:', err);
            toast.success('Provider created! Practice location could not be added automatically.');
          }
        } else {
          toast.success('Provider created! Now upload documents.');
        }
        setCurrentStep(3);
      }
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error?.message || 'An error occurred');
    },
  });

  const handleNpiLookup = async () => {
    const npiValue = formValues.npi;
    if (!npiValue || !/^\d{10}$/.test(npiValue)) {
      toast.error('Please enter a valid 10-digit NPI number first');
      return;
    }

    setNpiLookupLoading(true);
    setNpiLookupResult(null);
    setMedicareEnrollment(null);

    try {
      // Fetch NPI Registry and Medicare enrollment in parallel
      const [npiResponse, pecosResponse] = await Promise.all([
        api.get<{ success: boolean; data: NPILookupResult }>(`/npi/lookup/${npiValue}`),
        api.get<{ success: boolean; data: MedicareEnrollmentResult }>(`/pecos/lookup/${npiValue}`).catch(() => null),
      ]);

      const npiResult = npiResponse.data.data;
      setNpiLookupResult(npiResult);

      // Set Medicare enrollment if available
      if (pecosResponse?.data?.data) {
        setMedicareEnrollment(pecosResponse.data.data);
      }

      if (!npiResult.found) {
        toast.error('NPI not found in the registry. You can still continue manually.');
      } else {
        const medicareStatus = pecosResponse?.data?.data?.found ? ' (Medicare enrolled)' : '';
        toast.success(`Provider found${medicareStatus}! Review the details below.`);
      }
    } catch (error) {
      toast.error('Failed to lookup NPI');
      setNpiLookupResult({ found: false });
    } finally {
      setNpiLookupLoading(false);
    }
  };

  const importNpiData = () => {
    if (!npiLookupResult || !npiLookupResult.found) return;

    // Import basic info
    if (npiLookupResult.firstName) {
      setValue('firstName', npiLookupResult.firstName, { shouldValidate: true });
    }
    if (npiLookupResult.lastName) {
      setValue('lastName', npiLookupResult.lastName, { shouldValidate: true });
    }
    if (npiLookupResult.middleName) {
      setValue('middleName', npiLookupResult.middleName);
    }
    if (npiLookupResult.suffix || npiLookupResult.credential) {
      setValue('suffix', npiLookupResult.suffix || npiLookupResult.credential || '');
    }
    if (npiLookupResult.gender) {
      setValue('gender', npiLookupResult.gender as any, { shouldValidate: true });
    }

    // Import phone from practice location, falling back to the mailing address
    // (NPPES phone lives on either block, or neither)
    const npiPhone = npiLookupResult.practiceLocation?.phone || npiLookupResult.mailingAddress?.phone;
    if (npiPhone) {
      const formatted = formatPhoneNumber(npiPhone);
      setValue('phone', formatted, { shouldValidate: true });
    }

    // Import taxonomy
    if (npiLookupResult.primaryTaxonomy?.code) {
      setValue('taxonomy', npiLookupResult.primaryTaxonomy.code);
    }
  };

  const validateStep = async (step: number): Promise<boolean> => {
    let fieldsToValidate: (keyof ProviderFormData)[] = [];

    switch (step) {
      case 1:
        fieldsToValidate = ['npi'];
        break;
      case 2:
        // dateOfBirth/email are optional (CAQH fills DOB later; NPPES publishes
        // neither) — validated only for format via their registered patterns.
        fieldsToValidate = ['firstName', 'lastName', 'email', 'phone', 'providerType', 'gender'];
        if (needsPracticePicker) fieldsToValidate.push('practiceId');
        break;
    }

    const result = await trigger(fieldsToValidate);
    return result;
  };

  const nextStep = async () => {
    if (currentStep === 1) {
      // Moving from NPI lookup to provider info - import the data
      const isValid = await validateStep(1);
      if (!isValid) return;

      // Import NPI data if we have a result
      if (npiLookupResult?.found) {
        importNpiData();
      }
      setCurrentStep(2);
    } else if (currentStep === 2) {
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
    clearPersistedForm();
    toast.success('Provider setup complete!');
    navigate(`/providers/${createdProviderId}`);
  };

  if (isEditing && loadingProvider) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-2 border-gray-200 border-t-primary-600"></div>
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
                <div className="flex gap-2">
                  <input
                    type="text"
                    {...register('npi', {
                      required: 'NPI is required',
                      pattern: { value: /^\d{10}$/, message: 'NPI must be exactly 10 digits' },
                    })}
                    className="input flex-1"
                  />
                  <button
                    type="button"
                    onClick={handleNpiLookup}
                    disabled={npiLookupLoading}
                    className="btn-secondary px-3 flex items-center gap-1"
                    title="Lookup NPI in registry"
                  >
                    {npiLookupLoading ? (
                      <div className="animate-spin h-4 w-4 border-2 border-primary-600 border-t-transparent rounded-full" />
                    ) : (
                      <MagnifyingGlassIcon className="h-4 w-4" />
                    )}
                  </button>
                </div>
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
              <div>
                <label className="label">Group NPI</label>
                <input
                  {...register('groupNpi')}
                  className="input"
                  placeholder="1234567890"
                  maxLength={10}
                />
              </div>
              <div>
                <label className="label">Tax ID (EIN/SSN)</label>
                <input
                  {...register('taxId')}
                  className="input"
                  placeholder="12-3456789"
                />
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

        {/* NPI Lookup Modal for Edit Form */}
        {npiLookupModalOpen && npiLookupResult && (
          <div className="fixed inset-0 z-50 overflow-y-auto">
            <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
              <div
                className="fixed inset-0 transition-opacity bg-gray-900/40 backdrop-blur-sm"
                onClick={() => setNpiLookupModalOpen(false)}
              />
              <div className="relative z-10 inline-block w-full max-w-2xl p-6 my-8 text-left align-middle bg-white rounded-2xl shadow-xl">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium text-gray-900">NPI Registry Results</h3>
                  <button onClick={() => setNpiLookupModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                    <XMarkIcon className="h-6 w-6" />
                  </button>
                </div>
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                  <h4 className="font-semibold text-gray-900">
                    {npiLookupResult.firstName} {npiLookupResult.middleName} {npiLookupResult.lastName}
                    {npiLookupResult.credential && `, ${npiLookupResult.credential}`}
                  </h4>
                  <p className="text-sm text-gray-600">NPI: {npiLookupResult.npi} • Status: {npiLookupResult.status}</p>
                </div>
                {npiLookupResult.practiceLocation && (
                  <div className="text-sm text-gray-600 mb-4">
                    <p className="font-medium text-gray-900">Practice Location</p>
                    <p>{npiLookupResult.practiceLocation.addressLine1}</p>
                    <p>{npiLookupResult.practiceLocation.city}, {npiLookupResult.practiceLocation.state} {npiLookupResult.practiceLocation.zipCode}</p>
                    {npiLookupResult.practiceLocation.phone && <p>Phone: {npiLookupResult.practiceLocation.phone}</p>}
                  </div>
                )}
                <div className="flex justify-end gap-3 pt-4 border-t">
                  <button onClick={() => setNpiLookupModalOpen(false)} className="btn-secondary">Cancel</button>
                  <button onClick={importNpiData} className="btn-primary">Import Data</button>
                </div>
              </div>
            </div>
          </div>
        )}
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
        {/* Step 1: NPI Lookup */}
        {currentStep === 1 && (
          <div className="card-body">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Enter Provider NPI</h2>
            <p className="text-sm text-gray-500 mb-6">
              Enter the provider's NPI to automatically retrieve their information from the national registry.
            </p>

            <div className="max-w-md">
              <label className="label">NPI (National Provider Identifier) *</label>
              <div className="flex gap-2">
                <input
                  {...register('npi', {
                    required: 'NPI is required',
                    pattern: { value: /^\d{10}$/, message: 'NPI must be exactly 10 digits' },
                  })}
                  className="input flex-1 text-lg"
                  placeholder="1234567890"
                  maxLength={10}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={handleNpiLookup}
                  disabled={npiLookupLoading || !formValues.npi || formValues.npi.length !== 10}
                  className="btn-primary px-4 flex items-center gap-2"
                >
                  {npiLookupLoading ? (
                    <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full" />
                  ) : (
                    <MagnifyingGlassIcon className="h-5 w-5" />
                  )}
                  Lookup
                </button>
              </div>
              {errors.npi && <p className="mt-1 text-sm text-red-600">{errors.npi.message}</p>}
              <p className="mt-2 text-xs text-gray-500">
                The NPI is a 10-digit number assigned to healthcare providers. Enter it above to auto-fill provider details.
              </p>
            </div>

            {/* NPI Lookup Result Preview */}
            {npiLookupResult && npiLookupResult.found && (
              <div className="mt-6 border-t pt-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-medium text-gray-900">Provider Found</h3>
                  <span className="text-sm text-green-600 flex items-center gap-1">
                    <CheckCircleIcon className="h-4 w-4" />
                    Verified in NPI Registry
                  </span>
                </div>

                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-start gap-4">
                    <div className="h-14 w-14 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                      <span className="text-green-700 font-bold text-xl">
                        {npiLookupResult.firstName?.[0]}{npiLookupResult.lastName?.[0]}
                      </span>
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold text-gray-900 text-lg">
                        {npiLookupResult.firstName} {npiLookupResult.middleName} {npiLookupResult.lastName}
                        {npiLookupResult.credential && `, ${npiLookupResult.credential}`}
                      </h4>
                      <p className="text-sm text-gray-600">
                        NPI: {npiLookupResult.npi} • Status: <span className="text-green-600 font-medium">{npiLookupResult.status}</span>
                      </p>
                      {npiLookupResult.primaryTaxonomy && (
                        <p className="text-sm text-gray-600 mt-1">
                          Specialty: {npiLookupResult.primaryTaxonomy.description || npiLookupResult.primaryTaxonomy.code}
                        </p>
                      )}
                      {npiLookupResult.practiceLocation && (
                        <p className="text-sm text-gray-500 mt-1">
                          {npiLookupResult.practiceLocation.city}, {npiLookupResult.practiceLocation.state}
                          {npiLookupResult.practiceLocation.phone && ` • ${npiLookupResult.practiceLocation.phone}`}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Medicare Enrollment Status */}
                <div className="mt-3">
                  {medicareEnrollment?.found ? (
                    <div className="p-3 bg-primary-50 border border-primary-200 rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <CheckCircleIcon className="h-5 w-5 text-primary-600 flex-shrink-0" />
                        <p className="text-sm font-medium text-primary-900">Medicare Enrolled</p>
                        {medicareEnrollment.pacId && (
                          <span className="text-xs bg-primary-100 text-primary-700 px-2 py-0.5 rounded">
                            PAC ID: {medicareEnrollment.pacId}
                          </span>
                        )}
                      </div>
                      {medicareEnrollment.primaryEnrollment && (
                        <p className="text-xs text-primary-700 mb-1">
                          Primary: {medicareEnrollment.primaryEnrollment.providerTypeDesc} ({medicareEnrollment.primaryEnrollment.state})
                          {medicareEnrollment.primaryEnrollment.enrollmentDate &&
                            ` • Since ${medicareEnrollment.primaryEnrollment.enrollmentDate}`}
                        </p>
                      )}
                      {medicareEnrollment.enrollments && medicareEnrollment.enrollments.length > 1 && (
                        <p className="text-xs text-primary-600">
                          +{medicareEnrollment.enrollments.length - 1} more enrollment(s) in: {
                            [...new Set(medicareEnrollment.enrollments.slice(1).map(e => e.state))].join(', ')
                          }
                        </p>
                      )}
                      {medicareEnrollment.orderingPrivileges && (
                        <p className="text-xs text-primary-700 mt-1">
                          Can order: {[
                            medicareEnrollment.orderingPrivileges.dme && 'DME',
                            medicareEnrollment.orderingPrivileges.hha && 'Home Health',
                            medicareEnrollment.orderingPrivileges.pmd && 'PMD',
                            medicareEnrollment.orderingPrivileges.hospice && 'Hospice',
                          ].filter(Boolean).join(', ') || 'Standard services'}
                        </p>
                      )}
                    </div>
                  ) : medicareEnrollment && !medicareEnrollment.found ? (
                    <div className="flex items-center gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                      <span className="text-yellow-600 text-sm font-medium">
                        Not found in Medicare enrollment database
                      </span>
                    </div>
                  ) : null}
                </div>

                <div className="mt-4 p-3 bg-primary-50 border border-primary-200 rounded-lg">
                  <p className="text-sm text-primary-800">
                    <strong>Next:</strong> Click "Continue" to review and complete the provider profile.
                    The information above will be pre-filled, and you'll add email and date of birth.
                    {npiLookupResult.practiceLocation && (
                      <span className="block mt-1">
                        <strong>Practice location</strong> will be automatically created from NPI data.
                      </span>
                    )}
                  </p>
                </div>
              </div>
            )}

            {/* Not found state */}
            {npiLookupResult && !npiLookupResult.found && (
              <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-sm text-yellow-800">
                  <strong>NPI not found.</strong> Please verify the number is correct.
                  You can still continue and enter provider information manually.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Provider Info (combined) */}
        {currentStep === 2 && (
          <div className="card-body">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Provider Information</h2>
            <p className="text-sm text-gray-500 mb-6">
              {npiLookupResult?.found
                ? 'Review the pre-filled information and complete any missing fields.'
                : 'Enter the provider details below.'}
            </p>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              {needsPracticePicker && (
                <div className="sm:col-span-2">
                  <label className="label">Practice *</label>
                  <select
                    {...register('practiceId', { required: 'Practice is required' })}
                    className="input"
                  >
                    <option value="">Select the provider's practice...</option>
                    {(practiceOptions ?? []).map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  {errors.practiceId && <p className="mt-1 text-sm text-red-600">{errors.practiceId.message}</p>}
                </div>
              )}

              {/* Row 1: Names */}
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
                <label className="label">Suffix / Credentials</label>
                <input {...register('suffix')} className="input" placeholder="MD, PhD, LCSW, etc." />
              </div>

              {/* Row 2: Provider Type and Taxonomy */}
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
                <label className="label">Taxonomy Code</label>
                <input {...register('taxonomy')} className="input" placeholder="207Q00000X" />
                <p className="mt-1 text-xs text-gray-500">From NPI Registry (auto-filled if available)</p>
              </div>

              {/* Row 3: DOB and Gender */}
              <div>
                <label className="label">Date of Birth</label>
                <input
                  type="date"
                  {...register('dateOfBirth')}
                  className="input"
                />
                <p className="mt-1 text-xs text-gray-500">Optional, but required before CAQH sync can run</p>
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

              {/* Row 4: Contact */}
              <div>
                <label className="label">Email</label>
                <input
                  type="email"
                  {...register('email', {
                    pattern: { value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i, message: 'Invalid email address' },
                  })}
                  className="input"
                  placeholder="provider@example.com"
                />
                <p className="mt-1 text-xs text-gray-500">Optional; needed for portal invites and expiring-credential reminders</p>
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

              {/* Hidden NPI field - already set in step 1 */}
              <input type="hidden" {...register('npi')} />
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

            <div className="mt-6 p-4 bg-primary-50 rounded-lg">
              <p className="text-sm text-primary-800">
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

              {/* Practice Location (if imported from NPI) — only claim success when the save succeeded */}
              {npiLookupResult?.found && npiLookupResult.practiceLocation && locationCreated === true && (
                <div>
                  <h4 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
                    <CheckCircleIcon className="h-5 w-5 text-green-500" />
                    Practice Location Added
                  </h4>
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm">
                    <p className="font-medium text-gray-900">{npiLookupResult.practiceLocation.city} Office</p>
                    <p className="text-gray-600">{npiLookupResult.practiceLocation.addressLine1}</p>
                    {npiLookupResult.practiceLocation.addressLine2 && (
                      <p className="text-gray-600">{npiLookupResult.practiceLocation.addressLine2}</p>
                    )}
                    <p className="text-gray-600">
                      {npiLookupResult.practiceLocation.city}, {npiLookupResult.practiceLocation.state} {npiLookupResult.practiceLocation.zipCode}
                    </p>
                    {npiLookupResult.practiceLocation.phone && (
                      <p className="text-gray-500 mt-1">Phone: {npiLookupResult.practiceLocation.phone}</p>
                    )}
                  </div>
                </div>
              )}
              {locationCreated === false && (
                <div>
                  <h4 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
                    <span className="h-5 w-5 rounded-full border-2 border-yellow-400" />
                    Practice Location Not Added
                  </h4>
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-gray-700">
                    The practice location could not be saved automatically. You can add it from the
                    provider's profile page after finishing.
                  </div>
                </div>
              )}

              {/* Medicare Enrollment Status */}
              {medicareEnrollment && (
                <div>
                  <h4 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
                    {medicareEnrollment.found ? (
                      <CheckCircleIcon className="h-5 w-5 text-primary-500" />
                    ) : (
                      <span className="h-5 w-5 rounded-full border-2 border-yellow-400" />
                    )}
                    Medicare Enrollment
                  </h4>
                  {medicareEnrollment.found ? (
                    <div className="bg-primary-50 border border-primary-200 rounded-lg p-3 text-sm">
                      <div className="flex items-center justify-between mb-2">
                        <p className="font-medium text-primary-900">Enrolled in Medicare</p>
                        {medicareEnrollment.pacId && (
                          <span className="text-xs bg-primary-100 text-primary-700 px-2 py-0.5 rounded">
                            PAC ID: {medicareEnrollment.pacId}
                          </span>
                        )}
                      </div>
                      {medicareEnrollment.enrollments && medicareEnrollment.enrollments.length > 0 && (
                        <div className="space-y-1 mb-2">
                          {medicareEnrollment.enrollments.map((enrollment, idx) => (
                            <p key={idx} className="text-xs text-primary-700">
                              • {enrollment.providerTypeDesc} ({enrollment.state})
                              {enrollment.enrollmentDate && ` - Since ${enrollment.enrollmentDate}`}
                            </p>
                          ))}
                        </div>
                      )}
                      {medicareEnrollment.orderingPrivileges && (
                        <p className="text-primary-700 text-xs">
                          Ordering: {[
                            medicareEnrollment.orderingPrivileges.dme && 'DME',
                            medicareEnrollment.orderingPrivileges.hha && 'Home Health',
                            medicareEnrollment.orderingPrivileges.pmd && 'PMD',
                            medicareEnrollment.orderingPrivileges.hospice && 'Hospice',
                          ].filter(Boolean).join(', ') || 'Standard'}
                        </p>
                      )}
                      <p className="text-primary-600 text-xs mt-1">
                        Verified: {new Date(medicareEnrollment.verifiedAt!).toLocaleDateString()}
                      </p>
                    </div>
                  ) : (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm">
                      <p className="text-yellow-800">Not found in Medicare enrollment database</p>
                    </div>
                  )}
                </div>
              )}

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
                  {!npiLookupResult?.practiceLocation && <li>• Add practice locations</li>}
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

      {/* NPI Lookup Modal */}
      {npiLookupModalOpen && npiLookupResult && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
            <div
              className="fixed inset-0 transition-opacity bg-gray-900/40 backdrop-blur-sm"
              onClick={() => setNpiLookupModalOpen(false)}
            />

            <div className="relative z-10 inline-block w-full max-w-2xl p-6 my-8 text-left align-middle bg-white rounded-2xl shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-gray-900">
                  NPI Registry Results
                </h3>
                <button
                  onClick={() => setNpiLookupModalOpen(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <XMarkIcon className="h-6 w-6" />
                </button>
              </div>

              <div className="space-y-4">
                {/* Provider Info */}
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="h-12 w-12 rounded-full bg-green-100 flex items-center justify-center">
                      <span className="text-green-700 font-bold text-lg">
                        {npiLookupResult.firstName?.[0]}{npiLookupResult.lastName?.[0]}
                      </span>
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900">
                        {npiLookupResult.firstName} {npiLookupResult.middleName} {npiLookupResult.lastName}
                        {npiLookupResult.credential && `, ${npiLookupResult.credential}`}
                      </h4>
                      <p className="text-sm text-gray-600">
                        NPI: {npiLookupResult.npi} • Status: {npiLookupResult.status}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Details Grid */}
                <div className="grid grid-cols-2 gap-4 text-sm">
                  {npiLookupResult.gender && (
                    <div>
                      <p className="text-gray-500 font-medium">Gender</p>
                      <p className="capitalize">{npiLookupResult.gender}</p>
                    </div>
                  )}
                  {npiLookupResult.primaryTaxonomy && (
                    <div>
                      <p className="text-gray-500 font-medium">Specialty</p>
                      <p>{npiLookupResult.primaryTaxonomy.description || npiLookupResult.primaryTaxonomy.code}</p>
                    </div>
                  )}
                  {npiLookupResult.enumerationDate && (
                    <div>
                      <p className="text-gray-500 font-medium">NPI Since</p>
                      <p>{new Date(npiLookupResult.enumerationDate).toLocaleDateString()}</p>
                    </div>
                  )}
                  {npiLookupResult.lastUpdated && (
                    <div>
                      <p className="text-gray-500 font-medium">Last Updated</p>
                      <p>{new Date(npiLookupResult.lastUpdated).toLocaleDateString()}</p>
                    </div>
                  )}
                </div>

                {/* Practice Location */}
                {npiLookupResult.practiceLocation && (
                  <div className="border-t pt-4">
                    <h5 className="font-medium text-gray-900 mb-2">Practice Location</h5>
                    <div className="text-sm text-gray-600">
                      <p>{npiLookupResult.practiceLocation.addressLine1}</p>
                      {npiLookupResult.practiceLocation.addressLine2 && (
                        <p>{npiLookupResult.practiceLocation.addressLine2}</p>
                      )}
                      <p>
                        {npiLookupResult.practiceLocation.city}, {npiLookupResult.practiceLocation.state} {npiLookupResult.practiceLocation.zipCode}
                      </p>
                      {npiLookupResult.practiceLocation.phone && (
                        <p className="mt-1">Phone: {npiLookupResult.practiceLocation.phone}</p>
                      )}
                      {npiLookupResult.practiceLocation.fax && (
                        <p>Fax: {npiLookupResult.practiceLocation.fax}</p>
                      )}
                    </div>
                  </div>
                )}

                {/* Taxonomy Codes */}
                {npiLookupResult.allTaxonomies && npiLookupResult.allTaxonomies.length > 0 && (
                  <div className="border-t pt-4">
                    <h5 className="font-medium text-gray-900 mb-2">Taxonomy Codes</h5>
                    <div className="space-y-1">
                      {npiLookupResult.allTaxonomies.map((tax, i) => (
                        <div key={i} className="text-sm flex items-center gap-2">
                          <code className="bg-gray-100 px-2 py-0.5 rounded text-xs">{tax.code}</code>
                          <span className="text-gray-600">{tax.description}</span>
                          {tax.primary && (
                            <span className="text-xs bg-primary-100 text-primary-700 px-1.5 py-0.5 rounded">Primary</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Import Note */}
                <div className="bg-primary-50 border border-primary-200 rounded-lg p-3 text-sm">
                  <p className="text-primary-800">
                    <strong>Note:</strong> Clicking "Import" will fill in the provider's name, gender, phone, and taxonomy code.
                    You'll still need to enter email and date of birth manually.
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
                <button
                  onClick={() => setNpiLookupModalOpen(false)}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={importNpiData}
                  className="btn-primary"
                >
                  <CheckIcon className="h-4 w-4 mr-2" />
                  Import Data
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
