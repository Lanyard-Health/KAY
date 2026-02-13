import { useState, useEffect, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { CheckCircleIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { api } from '../../services/api';

interface RegistrationData {
  npi: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  suffix?: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  gender: string;
  providerType?: string;
  practiceId?: string;
}

const GENDER_OPTIONS = [
  { value: '', label: 'Select Gender' },
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

const PROVIDER_TYPES = [
  { value: '', label: 'Select Provider Type' },
  { value: 'psychiatrist', label: 'Psychiatrist' },
  { value: 'psychologist', label: 'Psychologist' },
  { value: 'lcsw', label: 'Licensed Clinical Social Worker' },
  { value: 'lpc', label: 'Licensed Professional Counselor' },
  { value: 'lmft', label: 'Licensed Marriage & Family Therapist' },
  { value: 'pmhnp', label: 'Psychiatric Mental Health NP' },
  { value: 'other', label: 'Other' },
];

export default function RegisterPage() {
  const [submitted, setSubmitted] = useState(false);
  const [searchParams] = useSearchParams();
  const practiceParam = searchParams.get('practice');
  const reapplyParam = searchParams.get('reapply');

  const { data: practiceInfo } = useQuery({
    queryKey: ['practice-info', practiceParam],
    queryFn: async () => {
      const res = await api.get(`/portal/practice/${practiceParam}/info`);
      return (res.data as any).data as { name: string; status: string };
    },
    enabled: !!practiceParam,
  });

  const [formData, setFormData] = useState<RegistrationData>({
    npi: '',
    firstName: '',
    lastName: '',
    middleName: '',
    suffix: '',
    email: '',
    phone: '',
    dateOfBirth: '',
    gender: '',
    providerType: '',
    practiceId: practiceParam || undefined,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [npiLookupStatus, setNpiLookupStatus] = useState<'idle' | 'loading' | 'found' | 'not-found'>('idle');
  const npiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced NPI lookup
  useEffect(() => {
    if (npiTimerRef.current) {
      clearTimeout(npiTimerRef.current);
    }

    const npi = formData.npi;
    if (!/^\d{10}$/.test(npi)) {
      setNpiLookupStatus('idle');
      return;
    }

    npiTimerRef.current = setTimeout(async () => {
      setNpiLookupStatus('loading');
      try {
        const response = await api.get(`/portal/npi-lookup/${npi}`);
        const result = response.data as any;
        if (result.success && result.data) {
          const d = result.data;
          // Map NPPES gender values to our enum
          let mappedGender = '';
          if (d.gender === 'Male') mappedGender = 'male';
          else if (d.gender === 'Female') mappedGender = 'female';

          setFormData((prev) => ({
            ...prev,
            firstName: d.firstName || prev.firstName,
            lastName: d.lastName || prev.lastName,
            middleName: d.middleName || prev.middleName,
            suffix: d.suffix || prev.suffix,
            phone: d.phone || prev.phone,
            gender: mappedGender || prev.gender,
          }));
          setNpiLookupStatus('found');
        } else {
          setNpiLookupStatus('not-found');
        }
      } catch {
        setNpiLookupStatus('not-found');
      }
    }, 300);

    return () => {
      if (npiTimerRef.current) {
        clearTimeout(npiTimerRef.current);
      }
    };
  }, [formData.npi]);

  const mutation = useMutation({
    mutationFn: async (data: RegistrationData) => {
      const body = reapplyParam
        ? { ...data, previousApplicationId: reapplyParam }
        : data;
      const response = await api.post('/portal/register', body);
      return response.data;
    },
    onSuccess: () => {
      setSubmitted(true);
      toast.success('Application submitted successfully!');
    },
    onError: (error: any) => {
      const message = error.response?.data?.error || 'Failed to submit application';
      toast.error(message);
    },
  });

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.npi) {
      newErrors.npi = 'NPI is required';
    } else if (!/^\d{10}$/.test(formData.npi)) {
      newErrors.npi = 'NPI must be exactly 10 digits';
    }

    if (!formData.firstName || formData.firstName.length < 2) {
      newErrors.firstName = 'First name must be at least 2 characters';
    }

    if (!formData.lastName || formData.lastName.length < 2) {
      newErrors.lastName = 'Last name must be at least 2 characters';
    }

    if (!formData.email) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Invalid email format';
    }

    if (!formData.phone) {
      newErrors.phone = 'Phone is required';
    }

    if (!formData.dateOfBirth) {
      newErrors.dateOfBirth = 'Date of birth is required';
    } else {
      const dob = new Date(formData.dateOfBirth);
      if (isNaN(dob.getTime())) {
        newErrors.dateOfBirth = 'Invalid date of birth';
      } else {
        const today = new Date();
        const age = today.getFullYear() - dob.getFullYear();
        const monthDiff = today.getMonth() - dob.getMonth();
        const actualAge = monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate()) ? age - 1 : age;
        if (actualAge < 18) {
          newErrors.dateOfBirth = 'Provider must be at least 18 years old';
        }
      }
    }

    if (!formData.gender) {
      newErrors.gender = 'Gender is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validateForm()) {
      mutation.mutate(formData);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary-800 via-primary-600 to-emerald-500 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-white py-8 px-4 shadow-sm sm:rounded-2xl border border-gray-200/60 sm:px-10">
            <div className="text-center">
              <CheckCircleIcon className="mx-auto h-16 w-16 text-green-500" />
              <h2 className="mt-4 text-2xl font-bold text-gray-900">Application Submitted!</h2>
              <p className="mt-2 text-sm text-gray-600">
                Thank you for submitting your provider registration. Our team will review your application and get back to you shortly.
              </p>
              <div className="mt-6 p-4 bg-primary-50 rounded-lg">
                <h3 className="text-sm font-medium text-primary-800">What happens next?</h3>
                <ul className="mt-2 text-sm text-primary-700 list-disc list-inside text-left">
                  <li>A confirmation email has been sent to your address</li>
                  <li>Our credentialing team will review your application</li>
                  <li>You may be contacted for additional information</li>
                  <li>You will receive an email notification once approved</li>
                </ul>
              </div>
              <a
                href="/login"
                className="mt-6 inline-block text-sm text-primary-600 hover:text-primary-500"
              >
                Go to Login
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-800 via-primary-600 to-emerald-500 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <img src="/logo.png" alt="Lanyard Health" className="h-12 mx-auto brightness-0 invert" />
        <h2 className="mt-6 text-center text-3xl font-bold tracking-tight text-white">
          Provider Registration
        </h2>
        <p className="mt-2 text-center text-sm text-white/70">
          Join our provider network by completing the form below
        </p>
        {reapplyParam && (
          <div className="mt-4 mx-auto max-w-lg bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 text-center">
            <p className="text-sm text-yellow-800">
              You are submitting a new application. Previous feedback from our team has been noted.
            </p>
          </div>
        )}
        {practiceInfo && (
          <div className="mt-4 mx-auto max-w-lg bg-primary-50 border border-primary-200 rounded-lg px-4 py-3 text-center">
            <p className="text-sm text-primary-800">
              Registering with <span className="font-semibold">{practiceInfo.name}</span>
            </p>
          </div>
        )}
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-lg">
        <div className="bg-white py-8 px-4 shadow-sm sm:rounded-2xl border border-gray-200/60 sm:px-10">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* NPI */}
            <div>
              <label htmlFor="npi" className="block text-sm font-medium text-gray-700">
                NPI <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  name="npi"
                  id="npi"
                  maxLength={10}
                  value={formData.npi}
                  onChange={handleChange}
                  placeholder="10-digit NPI number"
                  className={`mt-1 block w-full rounded-md shadow-sm sm:text-sm ${
                    errors.npi
                      ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
                      : 'border-gray-300 focus:border-primary-500 focus:ring-primary-500'
                  }`}
                />
                {npiLookupStatus === 'loading' && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 mt-0.5">
                    <svg className="animate-spin h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  </div>
                )}
              </div>
              {errors.npi && <p className="mt-1 text-sm text-red-600">{errors.npi}</p>}
              {npiLookupStatus === 'found' && (
                <p className="mt-1 text-sm text-green-600">NPI found — fields pre-filled from NPPES</p>
              )}
              {npiLookupStatus === 'not-found' && (
                <p className="mt-1 text-sm text-yellow-600">NPI not found in NPPES registry</p>
              )}
            </div>

            {/* Name Fields */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="firstName" className="block text-sm font-medium text-gray-700">
                  First Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="firstName"
                  id="firstName"
                  value={formData.firstName}
                  onChange={handleChange}
                  className={`mt-1 block w-full rounded-md shadow-sm sm:text-sm ${
                    errors.firstName
                      ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
                      : 'border-gray-300 focus:border-primary-500 focus:ring-primary-500'
                  }`}
                />
                {errors.firstName && <p className="mt-1 text-sm text-red-600">{errors.firstName}</p>}
              </div>
              <div>
                <label htmlFor="lastName" className="block text-sm font-medium text-gray-700">
                  Last Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="lastName"
                  id="lastName"
                  value={formData.lastName}
                  onChange={handleChange}
                  className={`mt-1 block w-full rounded-md shadow-sm sm:text-sm ${
                    errors.lastName
                      ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
                      : 'border-gray-300 focus:border-primary-500 focus:ring-primary-500'
                  }`}
                />
                {errors.lastName && <p className="mt-1 text-sm text-red-600">{errors.lastName}</p>}
              </div>
            </div>

            {/* Middle Name & Suffix */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="middleName" className="block text-sm font-medium text-gray-700">
                  Middle Name
                </label>
                <input
                  type="text"
                  name="middleName"
                  id="middleName"
                  value={formData.middleName}
                  onChange={handleChange}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
                />
              </div>
              <div>
                <label htmlFor="suffix" className="block text-sm font-medium text-gray-700">
                  Suffix
                </label>
                <input
                  type="text"
                  name="suffix"
                  id="suffix"
                  value={formData.suffix}
                  onChange={handleChange}
                  placeholder="MD, DO, NP, etc."
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
                />
              </div>
            </div>

            {/* Contact Fields */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                  Email <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  name="email"
                  id="email"
                  value={formData.email}
                  onChange={handleChange}
                  className={`mt-1 block w-full rounded-md shadow-sm sm:text-sm ${
                    errors.email
                      ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
                      : 'border-gray-300 focus:border-primary-500 focus:ring-primary-500'
                  }`}
                />
                {errors.email && <p className="mt-1 text-sm text-red-600">{errors.email}</p>}
              </div>
              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-gray-700">
                  Phone <span className="text-red-500">*</span>
                </label>
                <input
                  type="tel"
                  name="phone"
                  id="phone"
                  value={formData.phone}
                  onChange={handleChange}
                  placeholder="(555) 123-4567"
                  className={`mt-1 block w-full rounded-md shadow-sm sm:text-sm ${
                    errors.phone
                      ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
                      : 'border-gray-300 focus:border-primary-500 focus:ring-primary-500'
                  }`}
                />
                {errors.phone && <p className="mt-1 text-sm text-red-600">{errors.phone}</p>}
              </div>
            </div>

            {/* Date of Birth & Gender */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="dateOfBirth" className="block text-sm font-medium text-gray-700">
                  Date of Birth <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  name="dateOfBirth"
                  id="dateOfBirth"
                  value={formData.dateOfBirth}
                  onChange={handleChange}
                  className={`mt-1 block w-full rounded-md shadow-sm sm:text-sm ${
                    errors.dateOfBirth
                      ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
                      : 'border-gray-300 focus:border-primary-500 focus:ring-primary-500'
                  }`}
                />
                {errors.dateOfBirth && <p className="mt-1 text-sm text-red-600">{errors.dateOfBirth}</p>}
              </div>
              <div>
                <label htmlFor="gender" className="block text-sm font-medium text-gray-700">
                  Gender <span className="text-red-500">*</span>
                </label>
                <select
                  name="gender"
                  id="gender"
                  value={formData.gender}
                  onChange={handleChange}
                  className={`mt-1 block w-full rounded-md shadow-sm sm:text-sm ${
                    errors.gender
                      ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
                      : 'border-gray-300 focus:border-primary-500 focus:ring-primary-500'
                  }`}
                >
                  {GENDER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {errors.gender && <p className="mt-1 text-sm text-red-600">{errors.gender}</p>}
              </div>
            </div>

            {/* Provider Type */}
            <div>
              <label htmlFor="providerType" className="block text-sm font-medium text-gray-700">
                Provider Type
              </label>
              <select
                name="providerType"
                id="providerType"
                value={formData.providerType}
                onChange={handleChange}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
              >
                {PROVIDER_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Submit Button */}
            <div>
              <button
                type="submit"
                disabled={mutation.isPending}
                className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-xl shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {mutation.isPending ? 'Submitting...' : 'Submit Application'}
              </button>
            </div>
          </form>

          <p className="mt-6 text-center text-xs text-gray-500">
            Already have an account?{' '}
            <a href="/login" className="text-primary-600 hover:text-primary-500">
              Sign in
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
