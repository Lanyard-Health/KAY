import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { BuildingOffice2Icon } from '@heroicons/react/24/outline';
import { api } from '../../services/api';
import { useAuthStore } from '../../stores/auth.store';

const SPECIALTY_OPTIONS = [
  { value: 'behavioral_health', label: 'Behavioral Health' },
  { value: 'psychiatry', label: 'Psychiatry' },
  { value: 'psychology', label: 'Psychology' },
  { value: 'counseling', label: 'Counseling' },
  { value: 'family_therapy', label: 'Family Therapy' },
  { value: 'general_medical', label: 'General Medical' },
  { value: 'telehealth', label: 'Telehealth' },
  { value: 'multi_specialty', label: 'Multi-Specialty' },
];

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
];

interface FormData {
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  zipCode: string;
  phone: string;
  groupNpi: string;
  taxId: string;
  specialtyFocus: string;
}

interface FieldError {
  [key: string]: string;
}

export default function PracticeProfile() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const practiceName = user?.practices?.[0]?.practice?.name ?? '';

  const [form, setForm] = useState<FormData>({
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    zipCode: '',
    phone: '',
    groupNpi: '',
    taxId: '',
    specialtyFocus: '',
  });

  const [errors, setErrors] = useState<FieldError>({});
  const [submitting, setSubmitting] = useState(false);
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

  function validate(): FieldError {
    const errs: FieldError = {};
    if (!form.addressLine1.trim()) errs.addressLine1 = 'Address is required';
    if (!form.city.trim()) errs.city = 'City is required';
    if (!form.state) errs.state = 'State is required';
    if (!/^\d{5}(-\d{4})?$/.test(form.zipCode.trim()))
      errs.zipCode = 'Enter a valid ZIP (e.g. 12345)';
    if (!/^\d{10}$/.test(form.phone.replace(/\D/g, '')))
      errs.phone = 'Enter a 10-digit phone number';
    if (form.taxId && !/^\d{2}-\d{7}$/.test(form.taxId.trim()))
      errs.taxId = 'Format: XX-XXXXXXX';
    if (form.groupNpi && !/^\d{10}$/.test(form.groupNpi.trim()))
      errs.groupNpi = 'NPI must be 10 digits';
    if (!form.specialtyFocus) errs.specialtyFocus = 'Select a specialty';
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
      await api.post('/setup/practice-profile', {
        addressLine1: form.addressLine1.trim(),
        addressLine2: form.addressLine2.trim() || undefined,
        city: form.city.trim(),
        state: form.state,
        zipCode: form.zipCode.trim(),
        phone: form.phone.replace(/\D/g, ''),
        groupNpi: form.groupNpi.trim() || undefined,
        taxId: form.taxId.trim() || undefined,
        specialtyFocus: form.specialtyFocus,
      });
      navigate('/setup/provider');
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
          <BuildingOffice2Icon className="w-5 h-5" />
        </span>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Practice Profile</h2>
          <p className="text-sm text-gray-500">Tell us about your practice location.</p>
        </div>
      </div>

      {apiError && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {apiError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Practice name (read-only) */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Practice Name</label>
          <input
            type="text"
            value={practiceName}
            readOnly
            className="block w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500 cursor-not-allowed"
          />
        </div>

        {/* Address */}
        <div className="grid grid-cols-1 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Address Line 1</label>
            <input type="text" value={form.addressLine1} onChange={update('addressLine1')} className={inputClass('addressLine1')} placeholder="123 Main St" />
            {errors.addressLine1 && <p className="mt-1 text-xs text-red-600">{errors.addressLine1}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Address Line 2</label>
            <input type="text" value={form.addressLine2} onChange={update('addressLine2')} className={inputClass('addressLine2')} placeholder="Suite 100 (optional)" />
          </div>
        </div>

        {/* City / State / Zip */}
        <div className="grid grid-cols-6 gap-4">
          <div className="col-span-3">
            <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
            <input type="text" value={form.city} onChange={update('city')} className={inputClass('city')} />
            {errors.city && <p className="mt-1 text-xs text-red-600">{errors.city}</p>}
          </div>
          <div className="col-span-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
            <select value={form.state} onChange={update('state')} className={inputClass('state')}>
              <option value="">--</option>
              {US_STATES.map((st) => (
                <option key={st} value={st}>{st}</option>
              ))}
            </select>
            {errors.state && <p className="mt-1 text-xs text-red-600">{errors.state}</p>}
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">ZIP Code</label>
            <input type="text" value={form.zipCode} onChange={update('zipCode')} className={inputClass('zipCode')} placeholder="12345" maxLength={10} />
            {errors.zipCode && <p className="mt-1 text-xs text-red-600">{errors.zipCode}</p>}
          </div>
        </div>

        {/* Phone */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
          <input type="tel" value={form.phone} onChange={update('phone')} className={inputClass('phone')} placeholder="(555) 123-4567" />
          {errors.phone && <p className="mt-1 text-xs text-red-600">{errors.phone}</p>}
        </div>

        {/* Group NPI / Tax ID */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Group NPI <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input type="text" value={form.groupNpi} onChange={update('groupNpi')} className={inputClass('groupNpi')} placeholder="10 digits" maxLength={10} />
            {errors.groupNpi && <p className="mt-1 text-xs text-red-600">{errors.groupNpi}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Tax ID <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input type="text" value={form.taxId} onChange={update('taxId')} className={inputClass('taxId')} placeholder="XX-XXXXXXX" maxLength={10} />
            {errors.taxId && <p className="mt-1 text-xs text-red-600">{errors.taxId}</p>}
          </div>
        </div>

        {/* Specialty Focus */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Specialty Focus</label>
          <select value={form.specialtyFocus} onChange={update('specialtyFocus')} className={inputClass('specialtyFocus')}>
            <option value="">Select specialty...</option>
            {SPECIALTY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          {errors.specialtyFocus && <p className="mt-1 text-xs text-red-600">{errors.specialtyFocus}</p>}
        </div>

        {/* Submit */}
        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={submitting}
            className={clsx(
              'inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium text-white shadow-sm transition',
              'bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2',
              submitting && 'opacity-60 cursor-not-allowed',
            )}
          >
            {submitting ? 'Saving...' : 'Continue'}
          </button>
        </div>
      </form>
    </div>
  );
}
