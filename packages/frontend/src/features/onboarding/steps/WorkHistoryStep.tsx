import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';

interface StepProps {
  data: Record<string, any>;
  onChange: (updates: Record<string, any>) => void;
}

interface WorkEntry {
  organizationName: string;
  organizationType: string;
  position: string;
  startDate: string;
  endDate: string;
  current: boolean;
}

const EMPTY_WORK: WorkEntry = {
  organizationName: '',
  organizationType: '',
  position: '',
  startDate: '',
  endDate: '',
  current: false,
};

const ORG_TYPES = [
  { value: '', label: 'Select type' },
  { value: 'hospital', label: 'Hospital' },
  { value: 'clinic', label: 'Clinic' },
  { value: 'private_practice', label: 'Private Practice' },
  { value: 'group_practice', label: 'Group Practice' },
  { value: 'community_health', label: 'Community Health Center' },
  { value: 'academic', label: 'Academic / University' },
  { value: 'government', label: 'Government / VA' },
  { value: 'telehealth', label: 'Telehealth' },
  { value: 'other', label: 'Other' },
];

const inputClass =
  'block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500';
const labelClass = 'block text-sm font-medium text-gray-700 mb-1';

export default function WorkHistoryStep({ data, onChange }: StepProps) {
  const workHistory: WorkEntry[] =
    data.workHistory && data.workHistory.length > 0
      ? data.workHistory
      : [{ ...EMPTY_WORK }];

  const updateWork = (index: number, updates: Partial<WorkEntry>) => {
    const updated = workHistory.map((w, i) =>
      i === index ? { ...w, ...updates } : w
    );
    onChange({ workHistory: updated });
  };

  const addWork = () => {
    onChange({ workHistory: [...workHistory, { ...EMPTY_WORK }] });
  };

  const removeWork = (index: number) => {
    if (workHistory.length <= 1) return;
    onChange({ workHistory: workHistory.filter((_, i) => i !== index) });
  };

  return (
    <div>
      <h2 className="text-base font-semibold text-gray-900 mb-4">
        Work History
      </h2>
      <p className="text-sm text-gray-500 mb-6">
        List your employment history, starting with the most recent.
      </p>

      <div className="space-y-6">
        {workHistory.map((work, idx) => (
          <div
            key={idx}
            className="relative border border-gray-200 rounded-xl p-5"
          >
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium text-gray-900">
                Position {idx + 1}
              </span>
              {workHistory.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeWork(idx)}
                  className="text-red-500 hover:text-red-700 p-1"
                >
                  <TrashIcon className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <label className={labelClass}>Organization Name</label>
                <input
                  type="text"
                  value={work.organizationName}
                  onChange={(e) =>
                    updateWork(idx, { organizationName: e.target.value })
                  }
                  className={inputClass}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Organization Type</label>
                  <select
                    value={work.organizationType}
                    onChange={(e) =>
                      updateWork(idx, { organizationType: e.target.value })
                    }
                    className={inputClass}
                  >
                    {ORG_TYPES.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Position</label>
                  <input
                    type="text"
                    value={work.position}
                    onChange={(e) =>
                      updateWork(idx, { position: e.target.value })
                    }
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
                <div>
                  <label className={labelClass}>Start Date</label>
                  <input
                    type="date"
                    value={work.startDate}
                    onChange={(e) =>
                      updateWork(idx, { startDate: e.target.value })
                    }
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>End Date</label>
                  <input
                    type="date"
                    value={work.endDate}
                    disabled={work.current}
                    onChange={(e) =>
                      updateWork(idx, { endDate: e.target.value })
                    }
                    className={inputClass + (work.current ? ' bg-gray-50 text-gray-400' : '')}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id={`current-${idx}`}
                  checked={work.current}
                  onChange={(e) =>
                    updateWork(idx, {
                      current: e.target.checked,
                      endDate: e.target.checked ? '' : work.endDate,
                    })
                  }
                  className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <label
                  htmlFor={`current-${idx}`}
                  className="text-sm text-gray-700"
                >
                  I currently work here
                </label>
              </div>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addWork}
        className="mt-4 flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700"
      >
        <PlusIcon className="w-4 h-4" />
        Add Position
      </button>
    </div>
  );
}
