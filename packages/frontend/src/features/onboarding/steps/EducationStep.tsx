import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';

interface StepProps {
  data: Record<string, any>;
  onChange: (updates: Record<string, any>) => void;
}

interface Education {
  schoolName: string;
  degreeType: string;
  educationType: string;
  fieldOfStudy: string;
  startDate: string;
  endDate: string;
}

const EMPTY_EDUCATION: Education = {
  schoolName: '',
  degreeType: '',
  educationType: '',
  fieldOfStudy: '',
  startDate: '',
  endDate: '',
};

const DEGREE_TYPES = [
  { value: '', label: 'Select degree' },
  { value: 'md', label: 'MD' },
  { value: 'do', label: 'DO' },
  { value: 'phd', label: 'PhD' },
  { value: 'psyd', label: 'PsyD' },
  { value: 'msw', label: 'MSW' },
  { value: 'ma', label: 'MA' },
  { value: 'ms', label: 'MS' },
  { value: 'bsn', label: 'BSN' },
  { value: 'msn', label: 'MSN' },
  { value: 'dnp', label: 'DNP' },
  { value: 'other', label: 'Other' },
];

const EDUCATION_TYPES = [
  { value: '', label: 'Select type' },
  { value: 'UNDERGRADUATE', label: 'Undergraduate' },
  { value: 'MEDICAL_SCHOOL', label: 'Medical School' },
  { value: 'GRADUATE_SCHOOL', label: 'Graduate School' },
  { value: 'INTERNSHIP', label: 'Internship' },
  { value: 'RESIDENCY', label: 'Residency' },
  { value: 'FELLOWSHIP', label: 'Fellowship' },
  { value: 'POSTDOC', label: 'Postdoc' },
  { value: 'CONTINUING_EDUCATION', label: 'Continuing Education' },
];

const inputClass =
  'block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500';
const labelClass = 'block text-sm font-medium text-gray-700 mb-1';

export default function EducationStep({ data, onChange }: StepProps) {
  const education: Education[] =
    data.education && data.education.length > 0
      ? data.education
      : [{ ...EMPTY_EDUCATION }];

  const updateEducation = (index: number, updates: Partial<Education>) => {
    const updated = education.map((ed, i) =>
      i === index ? { ...ed, ...updates } : ed
    );
    onChange({ education: updated });
  };

  const addEducation = () => {
    onChange({ education: [...education, { ...EMPTY_EDUCATION }] });
  };

  const removeEducation = (index: number) => {
    if (education.length <= 1) return;
    onChange({ education: education.filter((_, i) => i !== index) });
  };

  return (
    <div>
      <h2 className="text-base font-semibold text-gray-900 mb-4">
        Education & Training
      </h2>
      <p className="text-sm text-gray-500 mb-6">
        Add your educational background and training history.
      </p>

      <div className="space-y-6">
        {education.map((ed, idx) => (
          <div
            key={idx}
            className="relative border border-gray-200 rounded-xl p-5"
          >
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium text-gray-900">
                Education {idx + 1}
              </span>
              {education.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeEducation(idx)}
                  className="text-red-500 hover:text-red-700 p-1"
                >
                  <TrashIcon className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <label className={labelClass}>School Name</label>
                <input
                  type="text"
                  value={ed.schoolName}
                  onChange={(e) =>
                    updateEducation(idx, { schoolName: e.target.value })
                  }
                  className={inputClass}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Degree Type</label>
                  <select
                    value={ed.degreeType}
                    onChange={(e) =>
                      updateEducation(idx, { degreeType: e.target.value })
                    }
                    className={inputClass}
                  >
                    {DEGREE_TYPES.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Education Type</label>
                  <select
                    value={ed.educationType}
                    onChange={(e) =>
                      updateEducation(idx, { educationType: e.target.value })
                    }
                    className={inputClass}
                  >
                    {EDUCATION_TYPES.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className={labelClass}>Field of Study</label>
                <input
                  type="text"
                  value={ed.fieldOfStudy}
                  onChange={(e) =>
                    updateEducation(idx, { fieldOfStudy: e.target.value })
                  }
                  className={inputClass}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Start Date</label>
                  <input
                    type="date"
                    value={ed.startDate}
                    onChange={(e) =>
                      updateEducation(idx, { startDate: e.target.value })
                    }
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>End Date</label>
                  <input
                    type="date"
                    value={ed.endDate}
                    onChange={(e) =>
                      updateEducation(idx, { endDate: e.target.value })
                    }
                    className={inputClass}
                  />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addEducation}
        className="mt-4 flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700"
      >
        <PlusIcon className="w-4 h-4" />
        Add Education
      </button>
    </div>
  );
}
