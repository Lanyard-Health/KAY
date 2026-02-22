import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import clsx from 'clsx';
import {
  UserPlusIcon,
  MagnifyingGlassIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import { api } from '../../services/api';

const PROVIDER_TYPES = [
  { value: 'psychiatrist', label: 'Psychiatrist' },
  { value: 'psychologist', label: 'Psychologist' },
  { value: 'lcsw', label: 'LCSW' },
  { value: 'lpc', label: 'LPC' },
  { value: 'lmft', label: 'LMFT' },
  { value: 'lmhc', label: 'LMHC' },
  { value: 'pmhnp', label: 'PMHNP' },
  { value: 'aprn', label: 'APRN' },
  { value: 'pa', label: 'PA' },
  { value: 'bcba', label: 'BCBA' },
  { value: 'other', label: 'Other' },
];

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
];

interface FormData {
  npi: string;
  firstName: string;
  lastName: string;
  email: string;
  providerType: string;
  primaryState: string;
}

interface FieldError {
  [key: string]: string;
}

export default function QuickProvider() {
  const navigate = useNavigate();

  const [form, setForm] = useState<FormData>({
    npi: '',
    firstName: '',
    lastName: '',
    email: '',
    providerType: '',
    primaryState: '',
  });

  const [errors, setErrors] = useState<FieldError>({});
  const [submitting, setSubmitting] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupDone, setLookupDone] = useState(false);
  const [apiError, setApiError] = useState('');

  const update = (field: keyof FormData) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const handleNpiLookup = async () => {
    const npi = form.npi.trim();
    if (!/^\d{10}$/.test(npi)) {
      setErrors((prev) => ({ ...prev, npi: 'NPI must be 10 digits' }));
      return;
    }

    setLookingUp(true);
    setApiError('');
    try {
      const { data } = await api.get<any>(`/setup/npi-lookup/${npi}`);
      const result = data?.data ?? data;
      setForm((f) => ({
        ...f,
        firstName: result.firstName || f.firstName,
        lastName: result.lastName || f.lastName,
        providerType: result.providerType || f.providerType,
        primaryState: result.primaryState || f.primaryState,
      }));
      setLookupDone(true);
    } catch (err: any) {
      setApiError(err.response?.data?.error?.message || err.message || 'NPI lookup failed');
    } finally {
      setLookingUp(false);
    }
  };

  function validate(): FieldError {
    const errs: FieldError = {};
    if (!/^\d{10}$/.test(form.npi.trim())) errs.npi = 'NPI must be 10 digits';
    if (!form.firstName.trim()) errs.firstName = 'First name is required';
    if (!form.lastName.trim()) errs.lastName = 'Last name is required';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errs.email = 'Valid email required';
    if (!form.providerType) errs.providerType = 'Select provider type';
    if (!form.primaryState) errs.primaryState = 'Select state';
    return errs;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError('');
    const v = validate();
    if (Object.keys(v).length > 0) {
      setErrors(v);
      return;
    }

    setSubmitting(true);
    try {
      const { data } = await api.post<any>('/setup/quick-provider', {
        npi: form.npi.trim(),
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        providerType: form.providerType,
        primaryState: form.primaryState,
      });
      const providerId = data?.data?.id ?? data?.id;
      navigate(`/setup/enroll?providerId=${providerId}&state=${form.primaryState}&providerType=${form.providerType}`);
    } catch (err: any) {
      setApiError(err.response?.data?.error?.message || err.message || 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass = (field: string) =>
    clsx(
      'block w-full rounded-lg border px-3 py-2 text-sm shadow-sm transition',
      'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500',
      errors[field] ? 'border-red-400 bg-red-50/40' : 'border-gray-300 bg-white',
    );

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6 sm:p-8">
      {/* Card header */}
      <div className="flex items-center gap-3 mb-6">
        <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary-50 text-primary-600">
          <UserPlusIcon className="w-5 h-5" />
        </span>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Add Your First Provider</h2>
          <p className="text-sm text-gray-500">Enter an NPI to auto-fill provider details.</p>
        </div>
      </div>

      {apiError && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {apiError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* NPI Lookup */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">NPI Number</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={form.npi}
              onChange={update('npi')}
              className={clsx(inputClass('npi'), 'flex-1')}
              placeholder="10-digit NPI"
              maxLength={10}
            />
            <button
              type="button"
              onClick={handleNpiLookup}
              disabled={lookingUp || form.npi.trim().length < 10}
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition shadow-sm',
                'bg-primary-50 text-primary-700 border border-primary-200 hover:bg-primary-100',
                'focus:outline-none focus:ring-2 focus:ring-primary-500',
                (lookingUp || form.npi.trim().length < 10) && 'opacity-50 cursor-not-allowed',
              )}
            >
              {lookingUp ? (
                <ArrowPathIcon className="w-4 h-4 animate-spin" />
              ) : (
                <MagnifyingGlassIcon className="w-4 h-4" />
              )}
              Lookup
            </button>
          </div>
          {errors.npi && <p className="mt-1 text-xs text-red-600">{errors.npi}</p>}
          {lookupDone && !apiError && (
            <p className="mt-1 text-xs text-primary-600">Fields auto-filled from NPI registry.</p>
          )}
        </div>

        {/* Name */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">First Name</label>
            <input type="text" value={form.firstName} onChange={update('firstName')} className={inputClass('firstName')} />
            {errors.firstName && <p className="mt-1 text-xs text-red-600">{errors.firstName}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
            <input type="text" value={form.lastName} onChange={update('lastName')} className={inputClass('lastName')} />
            {errors.lastName && <p className="mt-1 text-xs text-red-600">{errors.lastName}</p>}
          </div>
        </div>

        {/* Email */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input type="email" value={form.email} onChange={update('email')} className={inputClass('email')} placeholder="provider@example.com" />
          {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email}</p>}
        </div>

        {/* Provider Type / State */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Provider Type</label>
            <select value={form.providerType} onChange={update('providerType')} className={inputClass('providerType')}>
              <option value="">Select type...</option>
              {PROVIDER_TYPES.map((pt) => (
                <option key={pt.value} value={pt.value}>{pt.label}</option>
              ))}
            </select>
            {errors.providerType && <p className="mt-1 text-xs text-red-600">{errors.providerType}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Primary State</label>
            <select value={form.primaryState} onChange={update('primaryState')} className={inputClass('primaryState')}>
              <option value="">--</option>
              {US_STATES.map((st) => (
                <option key={st} value={st}>{st}</option>
              ))}
            </select>
            {errors.primaryState && <p className="mt-1 text-xs text-red-600">{errors.primaryState}</p>}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-2">
          <Link
            to="/setup/enroll"
            className="text-sm text-gray-500 hover:text-gray-700 underline underline-offset-2 transition"
          >
            Skip for now
          </Link>
          <button
            type="submit"
            disabled={submitting}
            className={clsx(
              'inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium text-white shadow-sm transition',
              'bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2',
              submitting && 'opacity-60 cursor-not-allowed',
            )}
          >
            {submitting ? 'Adding...' : 'Add Provider & Continue'}
          </button>
        </div>
      </form>
    </div>
  );
}
