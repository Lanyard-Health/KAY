import { useState } from 'react';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { api } from '../../../services/api';

interface StepProps {
  data: Record<string, any>;
  onChange: (updates: Record<string, any>) => void;
}

const PROVIDER_TYPES = [
  { value: '', label: 'Select provider type' },
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

const GENDER_OPTIONS = [
  { value: '', label: 'Select gender' },
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'non_binary', label: 'Non-binary' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

const inputClass =
  'block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500';
const labelClass = 'block text-sm font-medium text-gray-700 mb-1';

export default function BasicInfoStep({ data, onChange }: StepProps) {
  const [npiLoading, setNpiLoading] = useState(false);
  const [npiError, setNpiError] = useState<string | null>(null);

  const handleNpiLookup = async () => {
    const npi = data.npi?.trim();
    if (!npi || npi.length !== 10) {
      setNpiError('Please enter a valid 10-digit NPI number.');
      return;
    }
    setNpiLoading(true);
    setNpiError(null);
    try {
      const { data: result } = await api.get(`/setup/npi-lookup/${npi}`);
      const npiData = (result as any)?.data || result;
      onChange({
        firstName: npiData.firstName || data.firstName,
        lastName: npiData.lastName || data.lastName,
        middleName: npiData.middleName || data.middleName,
        suffix: npiData.suffix || data.suffix,
        gender: npiData.gender || data.gender,
        providerType: npiData.providerType || data.providerType,
      });
    } catch {
      setNpiError('NPI lookup failed. You can enter details manually.');
    } finally {
      setNpiLoading(false);
    }
  };

  return (
    <div>
      <h2 className="text-base font-semibold text-gray-900 mb-4">
        Basic Information
      </h2>

      {/* NPI */}
      <div className="mb-6">
        <label className={labelClass}>NPI Number</label>
        <div className="flex gap-2">
          <input
            type="text"
            maxLength={10}
            placeholder="10-digit NPI"
            value={data.npi || ''}
            onChange={(e) =>
              onChange({ npi: e.target.value.replace(/\D/g, '').slice(0, 10) })
            }
            className={inputClass}
          />
          <button
            type="button"
            onClick={handleNpiLookup}
            disabled={npiLoading}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            <MagnifyingGlassIcon className="w-4 h-4" />
            {npiLoading ? 'Looking up...' : 'Lookup'}
          </button>
        </div>
        {npiError && (
          <p className="mt-1 text-xs text-red-600">{npiError}</p>
        )}
      </div>

      {/* Name fields - 2 column grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div>
          <label className={labelClass}>First Name</label>
          <input
            type="text"
            value={data.firstName || ''}
            onChange={(e) => onChange({ firstName: e.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Last Name</label>
          <input
            type="text"
            value={data.lastName || ''}
            onChange={(e) => onChange({ lastName: e.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Middle Name</label>
          <input
            type="text"
            value={data.middleName || ''}
            onChange={(e) => onChange({ middleName: e.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Suffix</label>
          <input
            type="text"
            placeholder="e.g. MD, PhD, LCSW"
            value={data.suffix || ''}
            onChange={(e) => onChange({ suffix: e.target.value })}
            className={inputClass}
          />
        </div>
      </div>

      {/* Date of Birth & Gender */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div>
          <label className={labelClass}>Date of Birth</label>
          <input
            type="date"
            value={data.dateOfBirth || ''}
            onChange={(e) => onChange({ dateOfBirth: e.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Gender</label>
          <select
            value={data.gender || ''}
            onChange={(e) => onChange({ gender: e.target.value })}
            className={inputClass}
          >
            {GENDER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Contact */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div>
          <label className={labelClass}>Email</label>
          <input
            type="email"
            value={data.email || ''}
            onChange={(e) => onChange({ email: e.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Phone</label>
          <input
            type="tel"
            value={data.phone || ''}
            onChange={(e) => onChange({ phone: e.target.value })}
            className={inputClass}
          />
        </div>
      </div>

      {/* Provider Type */}
      <div>
        <label className={labelClass}>Provider Type</label>
        <select
          value={data.providerType || ''}
          onChange={(e) => onChange({ providerType: e.target.value })}
          className={inputClass}
        >
          {PROVIDER_TYPES.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
