import { useMemo } from 'react';
import clsx from 'clsx';
import { format, differenceInDays, parseISO } from 'date-fns';
import {
  ClockIcon,
  PlusIcon,
  ShieldCheckIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';

interface SupervisionTrackerProps {
  providerId: string;
  providerType?: string;
  supervisingPhysicians: any[];
  onAdd?: () => void;
}

const STATE_SUPERVISION_REQUIREMENTS: Record<string, Record<string, string>> = {
  TX: {
    LCSW: 'Texas requires 3,000 supervised hours for LCSW licensure',
    LPC: 'Texas requires 3,000 supervised hours for LPC licensure',
  },
  CA: {
    LCSW: 'California requires 3,200 hours of supervised experience',
    LMFT: 'California requires 3,000 hours of supervised experience',
  },
  NY: {
    LCSW: 'New York requires 3 years post-masters supervised experience',
  },
  FL: {
    LCSW: 'Florida requires 2 years of supervised clinical experience',
  },
};

type AgreementStatus = 'active' | 'expiring' | 'expired';

function getAgreementStatus(endDate?: string | null): AgreementStatus {
  if (!endDate) return 'active';
  const end = parseISO(endDate);
  const today = new Date();
  const daysUntilExpiry = differenceInDays(end, today);
  if (daysUntilExpiry < 0) return 'expired';
  if (daysUntilExpiry <= 90) return 'expiring';
  return 'active';
}

function StatusBadge({ status }: { status: AgreementStatus }) {
  return (
    <span
      className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', {
        'bg-green-100 text-green-800': status === 'active',
        'bg-amber-100 text-amber-800': status === 'expiring',
        'bg-red-100 text-red-800': status === 'expired',
      })}
    >
      {status === 'active' && <ShieldCheckIcon className="h-3.5 w-3.5" />}
      {status === 'expiring' && <ExclamationTriangleIcon className="h-3.5 w-3.5" />}
      {status === 'expired' && <XCircleIcon className="h-3.5 w-3.5" />}
      {status === 'active' && 'Active'}
      {status === 'expiring' && 'Expiring soon'}
      {status === 'expired' && 'Expired'}
    </span>
  );
}

function SupervisionTypeBadge({ type }: { type?: string }) {
  const label = type || 'GENERAL';
  return (
    <span className="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
      {label}
    </span>
  );
}

export default function SupervisionTracker({
  providerId,
  providerType,
  supervisingPhysicians,
  onAdd,
}: SupervisionTrackerProps) {
  const agreements = useMemo(() => {
    return supervisingPhysicians.map((sp) => ({
      ...sp,
      status: getAgreementStatus(sp.endDate || sp.agreementEndDate),
    }));
  }, [supervisingPhysicians]);

  const activeCount = agreements.filter((a) => a.status === 'active').length;

  // Find state requirement note if applicable
  const stateReqNote = useMemo(() => {
    if (!providerType) return null;
    // Try to extract state from first agreement or provider data
    for (const sp of supervisingPhysicians) {
      const state = sp.state || sp.practiceState;
      if (state && STATE_SUPERVISION_REQUIREMENTS[state]?.[providerType]) {
        return {
          state,
          note: STATE_SUPERVISION_REQUIREMENTS[state][providerType],
        };
      }
    }
    return null;
  }, [providerType, supervisingPhysicians]);

  const handleAdd = () => {
    if (onAdd) {
      onAdd();
    } else {
      window.dispatchEvent(
        new CustomEvent('open-supervision-modal', { detail: { providerId } })
      );
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-primary-50">
            <UserGroupIcon className="h-5 w-5 text-primary-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              Supervision Agreements
            </h3>
            <p className="text-sm text-gray-500">
              {activeCount} active of {agreements.length} total
            </p>
          </div>
          <span className="inline-flex items-center justify-center h-6 min-w-[1.5rem] rounded-full bg-primary-100 px-2 text-xs font-semibold text-primary-700">
            {agreements.length}
          </span>
        </div>
      </div>

      {/* State Requirements Panel */}
      {stateReqNote && (
        <div className="mb-4 rounded-lg bg-blue-50 border border-blue-200 p-3">
          <div className="flex items-start gap-2">
            <ShieldCheckIcon className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-blue-800">
                {stateReqNote.state} State Requirement
              </p>
              <p className="text-sm text-blue-700 mt-0.5">{stateReqNote.note}</p>
            </div>
          </div>
        </div>
      )}

      {/* Timeline */}
      {agreements.length === 0 ? (
        <div className="text-center py-8">
          <UserGroupIcon className="h-10 w-10 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">No supervision agreements on file.</p>
          <p className="text-xs text-gray-400 mt-1">
            Add an agreement to track supervision requirements.
          </p>
        </div>
      ) : (
        <div className="relative space-y-0">
          {/* Vertical timeline line */}
          <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200" />

          {agreements.map((agreement, idx) => (
            <div key={agreement.id || idx} className="relative pl-10 pb-6 last:pb-0">
              {/* Timeline dot */}
              <div
                className={clsx(
                  'absolute left-2.5 top-1.5 h-3 w-3 rounded-full border-2 border-white',
                  {
                    'bg-green-500': agreement.status === 'active',
                    'bg-amber-500': agreement.status === 'expiring',
                    'bg-red-500': agreement.status === 'expired',
                  }
                )}
              />

              {/* Entry card */}
              <div
                className={clsx(
                  'rounded-xl border p-4 border-l-4',
                  {
                    'border-l-green-500 border-gray-200': agreement.status === 'active',
                    'border-l-amber-500 border-amber-200 bg-amber-50/30':
                      agreement.status === 'expiring',
                    'border-l-red-500 border-red-200 bg-red-50/30':
                      agreement.status === 'expired',
                  }
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-gray-900">
                        {agreement.name ||
                          `${agreement.firstName || ''} ${agreement.lastName || ''}`.trim() ||
                          'Unknown Supervisor'}
                      </p>
                      <SupervisionTypeBadge
                        type={agreement.supervisionType || agreement.type}
                      />
                      <StatusBadge status={agreement.status} />
                    </div>

                    {(agreement.npi || agreement.npiNumber) && (
                      <p className="text-xs text-gray-500 mt-1">
                        NPI: {agreement.npi || agreement.npiNumber}
                      </p>
                    )}

                    <div className="flex items-center gap-1.5 mt-2 text-xs text-gray-500">
                      <ClockIcon className="h-3.5 w-3.5" />
                      <span>
                        {agreement.startDate || agreement.agreementStartDate
                          ? format(
                              parseISO(
                                agreement.startDate || agreement.agreementStartDate
                              ),
                              'MMM d, yyyy'
                            )
                          : 'Start N/A'}
                        {' → '}
                        {agreement.endDate || agreement.agreementEndDate
                          ? format(
                              parseISO(
                                agreement.endDate || agreement.agreementEndDate
                              ),
                              'MMM d, yyyy'
                            )
                          : 'Ongoing'}
                      </span>
                    </div>

                    {(agreement.state || agreement.practiceState) && (
                      <p className="text-xs text-gray-400 mt-1">
                        State: {agreement.state || agreement.practiceState}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add button */}
      <button
        type="button"
        onClick={handleAdd}
        className="mt-4 w-full flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 py-3 text-sm font-medium text-gray-500 hover:border-primary-400 hover:text-primary-600 transition-colors"
      >
        <PlusIcon className="h-4 w-4" />
        Add Supervision Agreement
      </button>
    </div>
  );
}
