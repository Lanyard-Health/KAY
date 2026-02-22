import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import {
  DocumentCheckIcon,
  CheckCircleIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';
import { api } from '../../services/api';

interface Payer {
  id: string;
  name: string;
  type: string;
  avgProcessingDays: number | null;
}

interface EnrollResult {
  created: number;
  alreadyExisted: number;
}

const TYPE_BADGE: Record<string, string> = {
  commercial: 'bg-blue-50 text-blue-700',
  medicaid: 'bg-emerald-50 text-emerald-700',
  medicare: 'bg-purple-50 text-purple-700',
  tricare: 'bg-amber-50 text-amber-700',
  managed_care: 'bg-teal-50 text-teal-700',
};

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-xl border border-gray-200 p-4">
      <div className="h-4 w-3/4 bg-gray-200 rounded mb-3" />
      <div className="h-3 w-1/3 bg-gray-100 rounded mb-2" />
      <div className="h-3 w-1/2 bg-gray-100 rounded" />
    </div>
  );
}

export default function BatchEnroll() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const providerId = searchParams.get('providerId') || '';
  const state = searchParams.get('state') || '';
  const providerType = searchParams.get('providerType') || '';

  const [payers, setPayers] = useState<Payer[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState('');
  const [result, setResult] = useState<EnrollResult | null>(null);

  const fetchPayers = useCallback(async () => {
    setLoading(true);
    setApiError('');
    try {
      const params = new URLSearchParams();
      if (state) params.set('state', state);
      if (providerType) params.set('providerType', providerType);
      const qs = params.toString();
      const { data } = await api.get<any>(`/setup/recommended-payers${qs ? `?${qs}` : ''}`);
      const list: Payer[] = data?.data ?? data ?? [];
      setPayers(list);
      // Pre-select all by default
      setSelected(new Set(list.map((p) => p.id)));
    } catch (err: any) {
      setApiError(err.response?.data?.error?.message || err.message || 'Failed to load payers');
    } finally {
      setLoading(false);
    }
  }, [state, providerType]);

  useEffect(() => {
    fetchPayers();
  }, [fetchPayers]);

  const togglePayer = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === payers.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(payers.map((p) => p.id)));
    }
  };

  const handleEnroll = async () => {
    if (selected.size === 0) return;
    setSubmitting(true);
    setApiError('');
    try {
      const { data } = await api.post<any>('/setup/batch-enroll', {
        providerId: providerId || undefined,
        payerIds: Array.from(selected),
      });
      const res = data?.data ?? data;
      setResult({ created: res.created ?? 0, alreadyExisted: res.alreadyExisted ?? 0 });
    } catch (err: any) {
      setApiError(err.response?.data?.error?.message || err.message || 'Enrollment failed');
    } finally {
      setSubmitting(false);
    }
  };

  // Success view
  if (result) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6 sm:p-8 text-center">
        <div className="flex justify-center mb-4">
          <span className="flex items-center justify-center w-14 h-14 rounded-full bg-primary-50 text-primary-600">
            <CheckCircleIcon className="w-8 h-8" />
          </span>
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">You're All Set!</h2>
        <p className="text-sm text-gray-600 mb-1">
          {result.created} enrollment{result.created !== 1 ? 's' : ''} created
          {result.alreadyExisted > 0 && (
            <>, {result.alreadyExisted} already existed</>
          )}
          .
        </p>
        <p className="text-sm text-gray-500 mb-6">
          Your credentialing dashboard is ready. Track every enrollment from one place.
        </p>
        <button
          onClick={() => navigate('/')}
          className={clsx(
            'inline-flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-medium text-white shadow-sm transition',
            'bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2',
          )}
        >
          Go to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6 sm:p-8">
      {/* Card header */}
      <div className="flex items-center gap-3 mb-6">
        <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary-50 text-primary-600">
          <DocumentCheckIcon className="w-5 h-5" />
        </span>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Enroll with Payers</h2>
          <p className="text-sm text-gray-500">
            Select payers to start credentialing. We recommend these based on your state and specialty.
          </p>
        </div>
      </div>

      {apiError && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {apiError}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}

      {/* Payer grid */}
      {!loading && payers.length > 0 && (
        <>
          {/* Select all toggle */}
          <div className="flex items-center justify-between mb-4">
            <button
              type="button"
              onClick={toggleAll}
              className="text-sm font-medium text-primary-600 hover:text-primary-800 transition"
            >
              {selected.size === payers.length ? 'Deselect All' : 'Select All'}
            </button>
            <span className="text-sm text-gray-500">
              {selected.size} of {payers.length} selected
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
            {payers.map((payer) => {
              const isSelected = selected.has(payer.id);
              return (
                <button
                  key={payer.id}
                  type="button"
                  onClick={() => togglePayer(payer.id)}
                  className={clsx(
                    'rounded-xl border p-4 text-left transition',
                    isSelected
                      ? 'border-primary-400 bg-primary-50/50 ring-1 ring-primary-300'
                      : 'border-gray-200 bg-white hover:border-gray-300',
                  )}
                >
                  <div className="flex items-start justify-between">
                    <span className="text-sm font-medium text-gray-900">{payer.name}</span>
                    <span
                      className={clsx(
                        'w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition',
                        isSelected
                          ? 'bg-primary-600 border-primary-600'
                          : 'border-gray-300 bg-white',
                      )}
                    >
                      {isSelected && (
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 mt-2">
                    {payer.type && (
                      <span
                        className={clsx(
                          'inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize',
                          TYPE_BADGE[payer.type] || 'bg-gray-100 text-gray-600',
                        )}
                      >
                        {payer.type.replace(/_/g, ' ')}
                      </span>
                    )}
                    {payer.avgProcessingDays != null && (
                      <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                        <ClockIcon className="w-3.5 h-3.5" />
                        ~{payer.avgProcessingDays}d avg
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* Empty state */}
      {!loading && payers.length === 0 && !apiError && (
        <div className="text-center py-10 text-sm text-gray-500">
          No recommended payers found. You can add enrollments from your dashboard later.
        </div>
      )}

      {/* Actions */}
      {!loading && (
        <div className="flex items-center justify-between pt-2 border-t border-gray-100">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="text-sm text-gray-500 hover:text-gray-700 underline underline-offset-2 transition"
          >
            Skip — go to dashboard
          </button>
          {payers.length > 0 && (
            <button
              type="button"
              onClick={handleEnroll}
              disabled={submitting || selected.size === 0}
              className={clsx(
                'inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium text-white shadow-sm transition',
                'bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2',
                (submitting || selected.size === 0) && 'opacity-60 cursor-not-allowed',
              )}
            >
              {submitting ? 'Enrolling...' : `Enroll Selected (${selected.size})`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
