import { ShieldExclamationIcon } from '@heroicons/react/24/outline';

interface StepProps {
  data: Record<string, any>;
  onChange: (updates: Record<string, any>) => void;
}

const COVERAGE_TYPES = [
  { value: '', label: 'Select coverage type' },
  { value: 'occurrence', label: 'Occurrence' },
  { value: 'claims_made', label: 'Claims Made' },
  { value: 'tail', label: 'Tail Coverage' },
];

const ACCOUNT_TYPES = [
  { value: '', label: 'Select account type' },
  { value: 'checking', label: 'Checking' },
  { value: 'savings', label: 'Savings' },
];

const inputClass =
  'block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500';
const labelClass = 'block text-sm font-medium text-gray-700 mb-1';

export default function InsuranceBankingStep({ data, onChange }: StepProps) {
  const insurance = data.malpracticeInsurance || {};
  const banking = data.banking || {};

  const updateInsurance = (updates: Record<string, any>) => {
    onChange({ malpracticeInsurance: { ...insurance, ...updates } });
  };

  const updateBanking = (updates: Record<string, any>) => {
    onChange({ banking: { ...banking, ...updates } });
  };

  return (
    <div className="space-y-10">
      {/* Malpractice Insurance */}
      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-4">
          Malpractice Insurance
        </h2>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Carrier Name</label>
              <input
                type="text"
                value={insurance.carrierName || ''}
                onChange={(e) =>
                  updateInsurance({ carrierName: e.target.value })
                }
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Policy Number</label>
              <input
                type="text"
                value={insurance.policyNumber || ''}
                onChange={(e) =>
                  updateInsurance({ policyNumber: e.target.value })
                }
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>Coverage Type</label>
            <select
              value={insurance.coverageType || ''}
              onChange={(e) =>
                updateInsurance({ coverageType: e.target.value })
              }
              className={inputClass}
            >
              {COVERAGE_TYPES.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Per Claim Amount ($)</label>
              <input
                type="text"
                placeholder="e.g. 1000000"
                value={insurance.perClaimAmount || ''}
                onChange={(e) =>
                  updateInsurance({ perClaimAmount: e.target.value })
                }
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Aggregate Amount ($)</label>
              <input
                type="text"
                placeholder="e.g. 3000000"
                value={insurance.aggregateAmount || ''}
                onChange={(e) =>
                  updateInsurance({ aggregateAmount: e.target.value })
                }
                className={inputClass}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Effective Date</label>
              <input
                type="date"
                value={insurance.effectiveDate || ''}
                onChange={(e) =>
                  updateInsurance({ effectiveDate: e.target.value })
                }
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Expiration Date</label>
              <input
                type="date"
                value={insurance.expirationDate || ''}
                onChange={(e) =>
                  updateInsurance({ expirationDate: e.target.value })
                }
                className={inputClass}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Banking Information */}
      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-4">
          Banking Information
        </h2>

        <div className="flex items-start gap-3 rounded-lg bg-amber-50 border border-amber-200 p-3 mb-6">
          <ShieldExclamationIcon className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-amber-800">
            Banking information is not saved to draft — it is only submitted
            securely on final submission.
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className={labelClass}>Bank Name</label>
            <input
              type="text"
              autoComplete="off"
              value={banking.bankName || ''}
              onChange={(e) => updateBanking({ bankName: e.target.value })}
              className={inputClass}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Routing Number</label>
              <input
                type="text"
                autoComplete="off"
                maxLength={9}
                placeholder="9 digits"
                value={banking.routingNumber || ''}
                onChange={(e) =>
                  updateBanking({
                    routingNumber: e.target.value
                      .replace(/\D/g, '')
                      .slice(0, 9),
                  })
                }
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Account Number</label>
              <input
                type="text"
                autoComplete="off"
                value={banking.accountNumber || ''}
                onChange={(e) =>
                  updateBanking({
                    accountNumber: e.target.value.replace(/\D/g, ''),
                  })
                }
                className={inputClass}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Account Type</label>
              <select
                autoComplete="off"
                value={banking.accountType || ''}
                onChange={(e) =>
                  updateBanking({ accountType: e.target.value })
                }
                className={inputClass}
              >
                {ACCOUNT_TYPES.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Account Holder Name</label>
              <input
                type="text"
                autoComplete="off"
                value={banking.accountHolderName || ''}
                onChange={(e) =>
                  updateBanking({ accountHolderName: e.target.value })
                }
                className={inputClass}
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
