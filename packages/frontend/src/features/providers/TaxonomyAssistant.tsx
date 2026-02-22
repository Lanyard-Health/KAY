import { useState } from 'react';
import clsx from 'clsx';
import {
  ExclamationTriangleIcon,
  CheckCircleIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';

interface TaxonomyAssistantProps {
  providerId: string;
  providerType?: string;
  currentTaxonomy?: string;
  onUpdate?: (taxonomyCode: string) => void;
}

const TAXONOMY_MAP: Record<string, { code: string; description: string }[]> = {
  LCSW: [{ code: '1041C0700X', description: 'Clinical Social Worker' }],
  LPC: [{ code: '101YM0800X', description: 'Mental Health Counselor' }],
  Psychologist: [
    { code: '103T00000X', description: 'Psychologist' },
    { code: '103TP2701X', description: 'Clinical Psychologist' },
  ],
  Psychiatrist: [{ code: '2084P0800X', description: 'Psychiatry' }],
  LMFT: [{ code: '106H00000X', description: 'Marriage & Family Therapist' }],
  PMHNP: [
    { code: '363LP0200X', description: 'Psychiatric/Mental Health NP' },
  ],
  MD: [
    { code: '207Q00000X', description: 'Family Medicine' },
    { code: '2084P0800X', description: 'Psychiatry' },
  ],
  DO: [{ code: '207Q00000X', description: 'Family Medicine' }],
  NP: [{ code: '363L00000X', description: 'Nurse Practitioner' }],
  PA: [{ code: '363A00000X', description: 'Physician Assistant' }],
};

const ALL_TAXONOMIES: Record<string, string> = {
  '1041C0700X': 'Clinical Social Worker',
  '101YM0800X': 'Mental Health Counselor',
  '103T00000X': 'Psychologist',
  '103TP2701X': 'Clinical Psychologist',
  '2084P0800X': 'Psychiatry',
  '106H00000X': 'Marriage & Family Therapist',
  '363LP0200X': 'Psychiatric/Mental Health NP',
  '207Q00000X': 'Family Medicine',
  '363L00000X': 'Nurse Practitioner',
  '363A00000X': 'Physician Assistant',
};

export default function TaxonomyAssistant({
  providerId,
  providerType,
  currentTaxonomy,
  onUpdate,
}: TaxonomyAssistantProps) {
  const [selectedCode, setSelectedCode] = useState<string>(
    currentTaxonomy || ''
  );

  // Determine current taxonomy description
  const currentDescription = currentTaxonomy
    ? ALL_TAXONOMIES[currentTaxonomy] || 'Unknown taxonomy code'
    : null;

  // Check if current taxonomy matches provider type
  const suggestedCodes = providerType ? TAXONOMY_MAP[providerType] || [] : [];
  const isMatch =
    currentTaxonomy &&
    providerType &&
    suggestedCodes.some((t) => t.code === currentTaxonomy);
  const isMismatch = currentTaxonomy && providerType && !isMatch;

  const handleApply = () => {
    if (selectedCode && onUpdate) {
      onUpdate(selectedCode);
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <SparklesIcon className="h-5 w-5 text-primary-600" />
        <h4 className="text-sm font-semibold text-gray-900">
          Taxonomy Assistant
        </h4>
      </div>

      {/* Current taxonomy display */}
      {currentTaxonomy ? (
        <div
          className={clsx('rounded-lg p-3 mb-3', {
            'bg-green-50 border border-green-200': isMatch,
            'bg-amber-50 border border-amber-200': isMismatch,
            'bg-gray-50 border border-gray-200': !providerType,
          })}
        >
          <div className="flex items-start gap-2">
            {isMatch && (
              <CheckCircleIcon className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
            )}
            {isMismatch && (
              <ExclamationTriangleIcon className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs text-gray-500">Current Taxonomy</p>
              <p className="text-sm font-mono font-medium text-gray-900">
                {currentTaxonomy}
              </p>
              <p className="text-xs text-gray-600 mt-0.5">
                {currentDescription}
              </p>
              {isMismatch && (
                <p className="text-xs text-amber-700 mt-1.5 font-medium">
                  This taxonomy code may not match the provider type &ldquo;
                  {providerType}&rdquo;. Consider updating to a suggested code
                  below.
                </p>
              )}
              {isMatch && (
                <p className="text-xs text-green-700 mt-1">
                  Taxonomy matches provider type.
                </p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 mb-3">
          <p className="text-xs text-gray-500">No taxonomy code assigned.</p>
        </div>
      )}

      {/* Suggested taxonomy dropdown */}
      {providerType && suggestedCodes.length > 0 && (
        <div className="space-y-2">
          <label
            htmlFor={`taxonomy-select-${providerId}`}
            className="block text-xs font-medium text-gray-700"
          >
            Suggested for {providerType}
          </label>
          <select
            id={`taxonomy-select-${providerId}`}
            value={selectedCode}
            onChange={(e) => setSelectedCode(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 bg-white py-2 px-3 text-sm text-gray-900 shadow-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
          >
            <option value="">Select a taxonomy code...</option>
            {suggestedCodes.map((t) => (
              <option key={t.code} value={t.code}>
                {t.code} &mdash; {t.description}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={handleApply}
            disabled={!selectedCode || selectedCode === currentTaxonomy}
            className={clsx(
              'w-full rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              selectedCode && selectedCode !== currentTaxonomy
                ? 'bg-primary-600 text-white hover:bg-primary-700 shadow-sm'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            )}
          >
            Apply Taxonomy Code
          </button>
        </div>
      )}

      {/* No provider type hint */}
      {!providerType && (
        <p className="text-xs text-gray-400 mt-1">
          Set a provider type to get taxonomy suggestions.
        </p>
      )}

      {/* Provider type set but no mapping available */}
      {providerType && suggestedCodes.length === 0 && (
        <p className="text-xs text-gray-500 mt-1">
          No taxonomy suggestions available for &ldquo;{providerType}&rdquo;.
        </p>
      )}
    </div>
  );
}
