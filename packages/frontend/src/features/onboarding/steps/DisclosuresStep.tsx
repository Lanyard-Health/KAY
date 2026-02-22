import { useState } from 'react';
import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';

interface StepProps {
  data: Record<string, any>;
  onChange: (updates: Record<string, any>) => void;
}

interface DisclosureQuestion {
  category: string;
  question: string;
}

const DISCLOSURE_QUESTIONS: DisclosureQuestion[] = [
  {
    category: 'LICENSE_ACTION',
    question:
      'Have you ever had a professional license, certificate, or registration denied, revoked, suspended, reduced, limited, placed on probation, or not renewed in any state or jurisdiction?',
  },
  {
    category: 'HOSPITAL_PRIVILEGES',
    question:
      'Have you ever had hospital or clinical privileges denied, revoked, suspended, reduced, limited, placed on probation, or not renewed at any hospital or healthcare facility?',
  },
  {
    category: 'FELONY_CONVICTION',
    question:
      'Have you ever been convicted of, or entered a plea of guilty or no contest to, a felony?',
  },
  {
    category: 'MISDEMEANOR_CONVICTION',
    question:
      'Have you ever been convicted of, or entered a plea of guilty or no contest to, a misdemeanor related to the practice of your profession, fraud, dishonesty, or substance abuse?',
  },
  {
    category: 'SUBSTANCE_ABUSE',
    question:
      'Do you currently use any controlled substances or alcohol in a manner that impairs or could impair your ability to practice with reasonable skill and safety?',
  },
  {
    category: 'MALPRACTICE_CLAIMS',
    question:
      'Have you ever had any malpractice claims, suits, or judgments filed against you, whether or not they resulted in settlement or judgment?',
  },
  {
    category: 'INVESTIGATION',
    question:
      'Are you currently under investigation by any licensing board, hospital, healthcare entity, or government agency?',
  },
  {
    category: 'OTHER',
    question:
      'Is there any other information relevant to your credentialing application that you wish to disclose?',
  },
];

const SUPERVISION_TYPES = [
  { value: '', label: 'Select supervision type' },
  { value: 'DIRECT', label: 'Direct' },
  { value: 'GENERAL', label: 'General' },
  { value: 'COLLABORATIVE', label: 'Collaborative' },
  { value: 'ADMINISTRATIVE', label: 'Administrative' },
];

const inputClass =
  'block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500';
const labelClass = 'block text-sm font-medium text-gray-700 mb-1';

export default function DisclosuresStep({ data, onChange }: StepProps) {
  const disclosures: Record<string, { answer: boolean; explanation: string }> =
    data.disclosures || {};
  const supervisor = data.supervisingPhysician || {};
  const [showSupervisor, setShowSupervisor] = useState(
    !!supervisor.firstName || !!supervisor.lastName
  );

  const updateDisclosure = (
    category: string,
    updates: { answer?: boolean; explanation?: string }
  ) => {
    const current = disclosures[category] || { answer: false, explanation: '' };
    onChange({
      disclosures: {
        ...disclosures,
        [category]: { ...current, ...updates },
      },
    });
  };

  const updateSupervisor = (updates: Record<string, any>) => {
    onChange({ supervisingPhysician: { ...supervisor, ...updates } });
  };

  return (
    <div className="space-y-10">
      {/* Disclosure Questions */}
      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-4">
          Disclosure Questions
        </h2>
        <p className="text-sm text-gray-500 mb-6">
          Please answer each question truthfully. If you answer &quot;Yes&quot;
          to any question, provide a detailed explanation.
        </p>

        <div className="space-y-6">
          {DISCLOSURE_QUESTIONS.map((q) => {
            const entry = disclosures[q.category] || {
              answer: false,
              explanation: '',
            };
            return (
              <div
                key={q.category}
                className="border border-gray-200 rounded-xl p-5"
              >
                <p className="text-sm text-gray-800 mb-3">{q.question}</p>

                <div className="flex gap-4 mb-2">
                  <button
                    type="button"
                    onClick={() =>
                      updateDisclosure(q.category, { answer: false })
                    }
                    className={clsx(
                      'px-4 py-1.5 text-sm font-medium rounded-lg border transition-colors',
                      !entry.answer
                        ? 'bg-primary-50 border-primary-300 text-primary-700'
                        : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                    )}
                  >
                    No
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateDisclosure(q.category, { answer: true })
                    }
                    className={clsx(
                      'px-4 py-1.5 text-sm font-medium rounded-lg border transition-colors',
                      entry.answer
                        ? 'bg-red-50 border-red-300 text-red-700'
                        : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                    )}
                  >
                    Yes
                  </button>
                </div>

                {entry.answer && (
                  <div className="mt-3">
                    <label className={labelClass}>Explanation</label>
                    <textarea
                      rows={3}
                      value={entry.explanation}
                      onChange={(e) =>
                        updateDisclosure(q.category, {
                          explanation: e.target.value,
                        })
                      }
                      placeholder="Please provide details..."
                      className={inputClass}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Supervising Physician */}
      <section>
        <button
          type="button"
          onClick={() => setShowSupervisor(!showSupervisor)}
          className="flex items-center gap-2 text-base font-semibold text-gray-900 mb-4"
        >
          Supervising Physician
          <span className="text-sm font-normal text-gray-500">
            (optional)
          </span>
          {showSupervisor ? (
            <ChevronUpIcon className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronDownIcon className="w-4 h-4 text-gray-500" />
          )}
        </button>

        {showSupervisor && (
          <div className="border border-gray-200 rounded-xl p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>First Name</label>
                <input
                  type="text"
                  value={supervisor.firstName || ''}
                  onChange={(e) =>
                    updateSupervisor({ firstName: e.target.value })
                  }
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Last Name</label>
                <input
                  type="text"
                  value={supervisor.lastName || ''}
                  onChange={(e) =>
                    updateSupervisor({ lastName: e.target.value })
                  }
                  className={inputClass}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>NPI</label>
                <input
                  type="text"
                  maxLength={10}
                  value={supervisor.npi || ''}
                  onChange={(e) =>
                    updateSupervisor({
                      npi: e.target.value.replace(/\D/g, '').slice(0, 10),
                    })
                  }
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>License Number</label>
                <input
                  type="text"
                  value={supervisor.licenseNumber || ''}
                  onChange={(e) =>
                    updateSupervisor({ licenseNumber: e.target.value })
                  }
                  className={inputClass}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>License State</label>
                <input
                  type="text"
                  maxLength={2}
                  placeholder="e.g. NY"
                  value={supervisor.licenseState || ''}
                  onChange={(e) =>
                    updateSupervisor({
                      licenseState: e.target.value.toUpperCase().slice(0, 2),
                    })
                  }
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Supervision Type</label>
                <select
                  value={supervisor.supervisionType || ''}
                  onChange={(e) =>
                    updateSupervisor({ supervisionType: e.target.value })
                  }
                  className={inputClass}
                >
                  {SUPERVISION_TYPES.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
