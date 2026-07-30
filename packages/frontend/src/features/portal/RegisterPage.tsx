import { useState, useEffect, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircleIcon } from '@heroicons/react/24/outline';
import { notify } from '../../utils/notify';
import { api } from '../../services/api';
import { useAuthStore } from '../../stores/auth.store';
import PasswordStrength from '../../components/PasswordStrength';
import { useFormPersistence } from '../../hooks/useFormPersistence';

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
  caqhProviderId?: string;
  practiceId?: string;
  password?: string;
  confirmPassword?: string;
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
  const navigate = useNavigate();
  const practiceParam = searchParams.get('practice');
  const reapplyParam = searchParams.get('reapply');
  const isSelfServe = !practiceParam;
  const { checkAuth, isDevMode } = useAuthStore();

  const { data: practiceInfo } = useQuery({
    queryKey: ['practice-info', practiceParam],
    queryFn: async () => {
      const res = await api.get(`/portal/practice/${practiceParam}/info`);
      return (res.data as any).data as { name: string; status: string };
    },
    enabled: !!practiceParam,
  });

  const [formData, setFormData, clearPersistedForm] = useFormPersistence<RegistrationData>(
    `provider-register${practiceParam ? `:${practiceParam}` : ''}`,
    {
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
      caqhProviderId: '',
      practiceId: practiceParam || undefined,
      password: '',
      confirmPassword: '',
    },
    { exclude: ['password', 'confirmPassword'] }
  );
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

  // Practice-linked registration mutation (existing flow)
  const registerMutation = useMutation({
    mutationFn: async (data: RegistrationData) => {
      const body = reapplyParam
        ? { ...data, previousApplicationId: reapplyParam }
        : data;
      const response = await api.post('/portal/register', body);
      return response.data;
    },
    onSuccess: () => {
      clearPersistedForm();
      setSubmitted(true);
      notify.success('Application submitted', { description: 'Our team will review and get back to you shortly' });
    },
    onError: (error: any) => {
      const message = error.response?.data?.error || 'Failed to submit application';
      notify.error('Submission failed', { description: message });
    },
  });

  // Self-serve signup mutation (instant access)
  const selfServeMutation = useMutation({
    mutationFn: async (data: RegistrationData) => {
      const response = await api.post('/portal/self-serve-signup', data);
      return response.data;
    },
    onSuccess: async () => {
      clearPersistedForm();
      notify.success('Account created', { description: 'Welcome to Lanyard Health' });
      try {
        if (isDevMode) {
          localStorage.setItem('dev_session', 'provider');
          await checkAuth();
        } else {
          const { login } = useAuthStore.getState();
          await login(formData.email, formData.password!);
        }
        navigate('/portal');
      } catch {
        notify.error('Auto-login failed', { description: 'Your account was created. Please log in manually.' });
        navigate('/login');
      }
    },
    onError: (error: any) => {
      const message = error.response?.data?.error || 'Failed to create account';
      notify.error('Registration failed', { description: message });
    },
  });

  const mutation = isSelfServe ? selfServeMutation : registerMutation;

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

    if (formData.caqhProviderId && !/^\d{6,12}$/.test(formData.caqhProviderId.trim())) {
      newErrors.caqhProviderId = 'CAQH Provider ID should be a number (usually 8 digits)';
    }

    // Self-serve password validation
    if (isSelfServe) {
      if (!formData.password) {
        newErrors.password = 'Password is required';
      } else if (formData.password.length < 12) {
        newErrors.password = 'Password must be at least 12 characters';
      } else if (!/[A-Z]/.test(formData.password)) {
        newErrors.password = 'Password must contain an uppercase letter';
      } else if (!/[a-z]/.test(formData.password)) {
        newErrors.password = 'Password must contain a lowercase letter';
      } else if (!/[0-9]/.test(formData.password)) {
        newErrors.password = 'Password must contain a number';
      } else if (!/[^A-Za-z0-9]/.test(formData.password)) {
        newErrors.password = 'Password must contain a special character';
      }

      if (!formData.confirmPassword) {
        newErrors.confirmPassword = 'Please confirm your password';
      } else if (formData.password !== formData.confirmPassword) {
        newErrors.confirmPassword = 'Passwords do not match';
      }
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
    // eslint-disable-next-line security/detect-object-injection -- name is from e.target.name (form field names are compile-time constants)
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  const inputClass = (field: string) =>
    `mt-1 block w-full rounded-xl bg-white border px-4 py-3 text-[#1f2721] placeholder-[#a49d8f] shadow-sm sm:text-sm outline-none transition focus:ring-4 ${
      // eslint-disable-next-line security/detect-object-injection
      errors[field]
        ? 'border-red-300 focus:border-red-400 focus:ring-red-400/15'
        : 'border-[#e3ddd2] focus:border-[#2d8b6a] focus:ring-[#2d8b6a]/15'
    }`;

  if (submitted) {
    return (
      <div className="min-h-screen bg-[#faf7f2] flex flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-white py-8 px-4 shadow-sm sm:rounded-2xl border border-[#e3ddd2] sm:px-10">
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
    <div className="min-h-screen bg-[#faf7f2] flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <img src="/logo-full.svg" alt="Lanyard Health" className="h-[72px] mx-auto" />
        <h2 className="mt-6 text-center text-3xl font-semibold tracking-tight text-[#1f2721]">
          Provider Registration
        </h2>
        <p className="mt-2 text-center text-sm text-[#6b665c]">
          {isSelfServe
            ? 'Create your account and get instant access'
            : 'Join our provider network by completing the form below'}
        </p>
        {isSelfServe && (
          <div className="mt-5 flex flex-col items-center gap-2">
            {['Complete profile & upload documents', 'Track license expirations', 'NPI auto-lookup from NPPES'].map((feature) => (
              <div key={feature} className="flex items-center gap-2.5 text-sm text-[#57534a]">
                <svg className="w-4 h-4 text-[#2d8b6a] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                {feature}
              </div>
            ))}
          </div>
        )}
        {reapplyParam && (
          <div className="mt-4 mx-auto max-w-lg bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-center">
            <p className="text-sm text-amber-800">
              You are submitting a new application. Previous feedback from our team has been noted.
            </p>
          </div>
        )}
        {practiceInfo && (
          <div className="mt-4 mx-auto max-w-lg bg-white border border-[#e3ddd2] rounded-lg px-4 py-3 text-center">
            <p className="text-sm text-[#57534a]">
              Registering with <span className="text-[#0A3D2E] font-semibold">{practiceInfo.name}</span>
            </p>
          </div>
        )}
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-lg">
        <div className="bg-white border border-[#e3ddd2] shadow-sm py-8 px-4 sm:rounded-2xl sm:px-10">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* NPI */}
            <div>
              <label htmlFor="npi" className="block text-sm font-medium text-[#57534a]">
                NPI <span className="text-[#2d8b6a]">*</span>
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
                  className={inputClass('npi')}
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
                <p className="mt-1 text-sm text-[#2d8b6a]">NPI found; fields pre-filled from NPPES</p>
              )}
              {npiLookupStatus === 'not-found' && (
                <p className="mt-1 text-sm text-amber-600">NPI not found in NPPES registry</p>
              )}
            </div>

            {/* Name Fields */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="firstName" className="block text-sm font-medium text-[#57534a]">
                  First Name <span className="text-[#2d8b6a]">*</span>
                </label>
                <input type="text" name="firstName" id="firstName" value={formData.firstName} onChange={handleChange} className={inputClass('firstName')} />
                {errors.firstName && <p className="mt-1 text-sm text-red-600">{errors.firstName}</p>}
              </div>
              <div>
                <label htmlFor="lastName" className="block text-sm font-medium text-[#57534a]">
                  Last Name <span className="text-[#2d8b6a]">*</span>
                </label>
                <input type="text" name="lastName" id="lastName" value={formData.lastName} onChange={handleChange} className={inputClass('lastName')} />
                {errors.lastName && <p className="mt-1 text-sm text-red-600">{errors.lastName}</p>}
              </div>
            </div>

            {/* Middle Name & Suffix */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="middleName" className="block text-sm font-medium text-[#57534a]">Middle Name</label>
                <input type="text" name="middleName" id="middleName" value={formData.middleName} onChange={handleChange} className="mt-1 block w-full rounded-xl bg-white border border-[#e3ddd2] px-4 py-3 text-[#1f2721] placeholder-[#a49d8f] shadow-sm sm:text-sm outline-none transition focus:ring-4 focus:ring-[#2d8b6a]/15 focus:border-[#2d8b6a]" />
              </div>
              <div>
                <label htmlFor="suffix" className="block text-sm font-medium text-[#57534a]">Suffix</label>
                <input type="text" name="suffix" id="suffix" value={formData.suffix} onChange={handleChange} placeholder="MD, DO, NP, etc." className="mt-1 block w-full rounded-xl bg-white border border-[#e3ddd2] px-4 py-3 text-[#1f2721] placeholder-[#a49d8f] shadow-sm sm:text-sm outline-none transition focus:ring-4 focus:ring-[#2d8b6a]/15 focus:border-[#2d8b6a]" />
              </div>
            </div>

            {/* Contact Fields */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-[#57534a]">Email <span className="text-[#2d8b6a]">*</span></label>
                <input type="email" name="email" id="email" value={formData.email} onChange={handleChange} className={inputClass('email')} />
                {errors.email && <p className="mt-1 text-sm text-red-600">{errors.email}</p>}
              </div>
              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-[#57534a]">Phone <span className="text-[#2d8b6a]">*</span></label>
                <input type="tel" name="phone" id="phone" value={formData.phone} onChange={handleChange} placeholder="(555) 123-4567" className={inputClass('phone')} />
                {errors.phone && <p className="mt-1 text-sm text-red-600">{errors.phone}</p>}
              </div>
            </div>

            {/* Date of Birth & Gender */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="dateOfBirth" className="block text-sm font-medium text-[#57534a]">Date of Birth <span className="text-[#2d8b6a]">*</span></label>
                <input type="date" name="dateOfBirth" id="dateOfBirth" value={formData.dateOfBirth} onChange={handleChange} className={inputClass('dateOfBirth')} />
                {errors.dateOfBirth && <p className="mt-1 text-sm text-red-600">{errors.dateOfBirth}</p>}
              </div>
              <div>
                <label htmlFor="gender" className="block text-sm font-medium text-[#57534a]">Gender <span className="text-[#2d8b6a]">*</span></label>
                <select name="gender" id="gender" value={formData.gender} onChange={handleChange} className={inputClass('gender')}>
                  {GENDER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                {errors.gender && <p className="mt-1 text-sm text-red-600">{errors.gender}</p>}
              </div>
            </div>

            {/* Provider Type */}
            <div>
              <label htmlFor="providerType" className="block text-sm font-medium text-[#57534a]">Provider Type</label>
              <select name="providerType" id="providerType" value={formData.providerType} onChange={handleChange} className="mt-1 block w-full rounded-xl bg-white border border-[#e3ddd2] px-4 py-3 text-[#1f2721] placeholder-[#a49d8f] shadow-sm sm:text-sm outline-none transition focus:ring-4 focus:ring-[#2d8b6a]/15 focus:border-[#2d8b6a]">
                {PROVIDER_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </div>

            {/* CAQH Provider ID */}
            <div>
              <label htmlFor="caqhProviderId" className="block text-sm font-medium text-[#57534a]">CAQH Provider ID</label>
              <input
                type="text"
                inputMode="numeric"
                name="caqhProviderId"
                id="caqhProviderId"
                value={formData.caqhProviderId}
                onChange={handleChange}
                placeholder="Usually 8 digits"
                className={inputClass('caqhProviderId')}
              />
              {errors.caqhProviderId ? (
                <p className="mt-1 text-sm text-red-600">{errors.caqhProviderId}</p>
              ) : (
                <p className="mt-1 text-xs text-[#75705f]">
                  With your CAQH ID we'll import your profile and documents automatically
                  once your account is approved, so there's no need to re-enter them.
                  Don't have one? Leave blank and we'll help you set it up later.
                </p>
              )}
            </div>

            {/* Password fields — self-serve only */}
            {isSelfServe && (
              <>
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-[#57534a]">
                    Password <span className="text-[#2d8b6a]">*</span>
                  </label>
                  <input
                    type="password"
                    name="password"
                    id="password"
                    value={formData.password}
                    onChange={handleChange}
                    placeholder="Minimum 12 characters"
                    className={inputClass('password')}
                  />
                  {errors.password && <p className="mt-1 text-sm text-red-600">{errors.password}</p>}
                  <PasswordStrength password={formData.password || ''} />
                </div>
                <div>
                  <label htmlFor="confirmPassword" className="block text-sm font-medium text-[#57534a]">
                    Confirm Password <span className="text-[#2d8b6a]">*</span>
                  </label>
                  <input
                    type="password"
                    name="confirmPassword"
                    id="confirmPassword"
                    value={formData.confirmPassword}
                    onChange={handleChange}
                    placeholder="Re-enter your password"
                    className={inputClass('confirmPassword')}
                  />
                  {errors.confirmPassword && <p className="mt-1 text-sm text-red-600">{errors.confirmPassword}</p>}
                </div>
              </>
            )}

            {/* Submit Button */}
            <div>
              <button
                type="submit"
                disabled={mutation.isPending}
                className="h-12 w-full flex items-center justify-center rounded-full bg-[#0A3D2E] text-sm font-medium text-white shadow-sm transition hover:bg-[#082f23] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2d8b6a] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
              >
                {mutation.isPending
                  ? (isSelfServe ? 'Creating Account...' : 'Submitting...')
                  : (isSelfServe ? 'Create Account & Get Started' : 'Submit Application')}
              </button>
            </div>
          </form>

          <p className="mt-6 text-center text-sm text-[#6b665c]">
            Already have an account?{' '}
            <a href="/login" className="text-[#0A3D2E] hover:text-[#1a6b4e] font-semibold transition-colors">
              Sign in
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
