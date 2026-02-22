import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';

interface StepProps {
  data: Record<string, any>;
  onChange: (updates: Record<string, any>) => void;
}

interface License {
  licenseType: string;
  licenseNumber: string;
  state: string;
  issueDate: string;
  expirationDate: string;
}

interface BoardCert {
  boardType: string;
  boardName: string;
  certNumber: string;
  specialty: string;
  initialDate: string;
  expirationDate: string;
}

interface DeaRegistration {
  deaNumber: string;
  state: string;
  schedules: string[];
  issueDate: string;
  expirationDate: string;
}

const EMPTY_LICENSE: License = {
  licenseType: '',
  licenseNumber: '',
  state: '',
  issueDate: '',
  expirationDate: '',
};

const EMPTY_BOARD_CERT: BoardCert = {
  boardType: '',
  boardName: '',
  certNumber: '',
  specialty: '',
  initialDate: '',
  expirationDate: '',
};

const EMPTY_DEA: DeaRegistration = {
  deaNumber: '',
  state: '',
  schedules: [],
  issueDate: '',
  expirationDate: '',
};

const LICENSE_TYPES = [
  { value: '', label: 'Select license type' },
  { value: 'state_medical', label: 'State Medical License' },
  { value: 'state_psychology', label: 'State Psychology License' },
  { value: 'state_social_work', label: 'State Social Work License' },
  { value: 'state_counseling', label: 'State Counseling License' },
  { value: 'state_marriage_family', label: 'State Marriage & Family License' },
  { value: 'state_nursing', label: 'State Nursing License' },
  { value: 'dea', label: 'DEA Registration' },
  { value: 'other', label: 'Other' },
];

const BOARD_TYPES = [
  { value: '', label: 'Select board' },
  { value: 'abpn_psychiatry', label: 'ABPN - Psychiatry' },
  { value: 'abpn_child_adolescent', label: 'ABPN - Child & Adolescent' },
  { value: 'abpn_addiction', label: 'ABPN - Addiction' },
  { value: 'abpp_clinical', label: 'ABPP - Clinical' },
  { value: 'abpp_counseling', label: 'ABPP - Counseling' },
  { value: 'abpp_neuropsychology', label: 'ABPP - Neuropsychology' },
  { value: 'nbcc', label: 'NBCC' },
  { value: 'nasw', label: 'NASW' },
  { value: 'other', label: 'Other' },
];

const DEA_SCHEDULES = ['II', 'III', 'IV', 'V'];

const US_STATES = [
  '', 'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN',
  'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH',
  'NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT',
  'VT','VA','WA','WV','WI','WY',
];

const inputClass =
  'block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500';
const labelClass = 'block text-sm font-medium text-gray-700 mb-1';

export default function LicensesCertsStep({ data, onChange }: StepProps) {
  const licenses: License[] = data.licenses || [];
  const boardCerts: BoardCert[] = data.boardCerts || [];
  const deaRegistrations: DeaRegistration[] = data.deaRegistrations || [];

  // --- Licenses ---
  const updateLicense = (index: number, updates: Partial<License>) => {
    const updated = licenses.map((l, i) =>
      i === index ? { ...l, ...updates } : l
    );
    onChange({ licenses: updated });
  };

  const addLicense = () =>
    onChange({ licenses: [...licenses, { ...EMPTY_LICENSE }] });

  const removeLicense = (index: number) =>
    onChange({ licenses: licenses.filter((_, i) => i !== index) });

  // --- Board Certs ---
  const updateBoardCert = (index: number, updates: Partial<BoardCert>) => {
    const updated = boardCerts.map((b, i) =>
      i === index ? { ...b, ...updates } : b
    );
    onChange({ boardCerts: updated });
  };

  const addBoardCert = () =>
    onChange({ boardCerts: [...boardCerts, { ...EMPTY_BOARD_CERT }] });

  const removeBoardCert = (index: number) =>
    onChange({ boardCerts: boardCerts.filter((_, i) => i !== index) });

  // --- DEA ---
  const updateDea = (index: number, updates: Partial<DeaRegistration>) => {
    const updated = deaRegistrations.map((d, i) =>
      i === index ? { ...d, ...updates } : d
    );
    onChange({ deaRegistrations: updated });
  };

  const addDea = () =>
    onChange({ deaRegistrations: [...deaRegistrations, { ...EMPTY_DEA }] });

  const removeDea = (index: number) =>
    onChange({
      deaRegistrations: deaRegistrations.filter((_, i) => i !== index),
    });

  const toggleSchedule = (deaIdx: number, schedule: string) => {
    const dea = deaRegistrations[deaIdx];
    const current = dea.schedules || [];
    const updated = current.includes(schedule)
      ? current.filter((s) => s !== schedule)
      : [...current, schedule];
    updateDea(deaIdx, { schedules: updated });
  };

  return (
    <div className="space-y-10">
      {/* Licenses */}
      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-4">
          Licenses
        </h2>
        <div className="space-y-6">
          {licenses.map((lic, idx) => (
            <div
              key={idx}
              className="relative border border-gray-200 rounded-xl p-5"
            >
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-medium text-gray-900">
                  License {idx + 1}
                </span>
                <button
                  type="button"
                  onClick={() => removeLicense(idx)}
                  className="text-red-500 hover:text-red-700 p-1"
                >
                  <TrashIcon className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>License Type</label>
                  <select
                    value={lic.licenseType}
                    onChange={(e) =>
                      updateLicense(idx, { licenseType: e.target.value })
                    }
                    className={inputClass}
                  >
                    {LICENSE_TYPES.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>License Number</label>
                  <input
                    type="text"
                    value={lic.licenseNumber}
                    onChange={(e) =>
                      updateLicense(idx, { licenseNumber: e.target.value })
                    }
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>State</label>
                  <select
                    value={lic.state}
                    onChange={(e) =>
                      updateLicense(idx, { state: e.target.value })
                    }
                    className={inputClass}
                  >
                    {US_STATES.map((s) => (
                      <option key={s} value={s}>
                        {s || 'Select'}
                      </option>
                    ))}
                  </select>
                </div>
                <div>{/* spacer */}</div>
                <div>
                  <label className={labelClass}>Issue Date</label>
                  <input
                    type="date"
                    value={lic.issueDate}
                    onChange={(e) =>
                      updateLicense(idx, { issueDate: e.target.value })
                    }
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Expiration Date</label>
                  <input
                    type="date"
                    value={lic.expirationDate}
                    onChange={(e) =>
                      updateLicense(idx, { expirationDate: e.target.value })
                    }
                    className={inputClass}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addLicense}
          className="mt-4 flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700"
        >
          <PlusIcon className="w-4 h-4" />
          Add License
        </button>
      </section>

      {/* Board Certifications */}
      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-4">
          Board Certifications
        </h2>
        <div className="space-y-6">
          {boardCerts.map((cert, idx) => (
            <div
              key={idx}
              className="relative border border-gray-200 rounded-xl p-5"
            >
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-medium text-gray-900">
                  Certification {idx + 1}
                </span>
                <button
                  type="button"
                  onClick={() => removeBoardCert(idx)}
                  className="text-red-500 hover:text-red-700 p-1"
                >
                  <TrashIcon className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Board Type</label>
                  <select
                    value={cert.boardType}
                    onChange={(e) =>
                      updateBoardCert(idx, { boardType: e.target.value })
                    }
                    className={inputClass}
                  >
                    {BOARD_TYPES.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Board Name</label>
                  <input
                    type="text"
                    value={cert.boardName}
                    onChange={(e) =>
                      updateBoardCert(idx, { boardName: e.target.value })
                    }
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Certificate Number</label>
                  <input
                    type="text"
                    value={cert.certNumber}
                    onChange={(e) =>
                      updateBoardCert(idx, { certNumber: e.target.value })
                    }
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Specialty</label>
                  <input
                    type="text"
                    value={cert.specialty}
                    onChange={(e) =>
                      updateBoardCert(idx, { specialty: e.target.value })
                    }
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Initial Date</label>
                  <input
                    type="date"
                    value={cert.initialDate}
                    onChange={(e) =>
                      updateBoardCert(idx, { initialDate: e.target.value })
                    }
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Expiration Date</label>
                  <input
                    type="date"
                    value={cert.expirationDate}
                    onChange={(e) =>
                      updateBoardCert(idx, { expirationDate: e.target.value })
                    }
                    className={inputClass}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addBoardCert}
          className="mt-4 flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700"
        >
          <PlusIcon className="w-4 h-4" />
          Add Board Certification
        </button>
      </section>

      {/* DEA Registrations */}
      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-4">
          DEA Registrations
        </h2>
        <div className="space-y-6">
          {deaRegistrations.map((dea, idx) => (
            <div
              key={idx}
              className="relative border border-gray-200 rounded-xl p-5"
            >
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-medium text-gray-900">
                  DEA Registration {idx + 1}
                </span>
                <button
                  type="button"
                  onClick={() => removeDea(idx)}
                  className="text-red-500 hover:text-red-700 p-1"
                >
                  <TrashIcon className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>DEA Number</label>
                  <input
                    type="text"
                    value={dea.deaNumber}
                    onChange={(e) =>
                      updateDea(idx, { deaNumber: e.target.value })
                    }
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>State</label>
                  <select
                    value={dea.state}
                    onChange={(e) =>
                      updateDea(idx, { state: e.target.value })
                    }
                    className={inputClass}
                  >
                    {US_STATES.map((s) => (
                      <option key={s} value={s}>
                        {s || 'Select'}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mt-4">
                <label className={labelClass}>Schedules</label>
                <div className="flex gap-4">
                  {DEA_SCHEDULES.map((sched) => (
                    <label
                      key={sched}
                      className="flex items-center gap-1.5 text-sm text-gray-700"
                    >
                      <input
                        type="checkbox"
                        checked={(dea.schedules || []).includes(sched)}
                        onChange={() => toggleSchedule(idx, sched)}
                        className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                      {sched}
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                <div>
                  <label className={labelClass}>Issue Date</label>
                  <input
                    type="date"
                    value={dea.issueDate}
                    onChange={(e) =>
                      updateDea(idx, { issueDate: e.target.value })
                    }
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Expiration Date</label>
                  <input
                    type="date"
                    value={dea.expirationDate}
                    onChange={(e) =>
                      updateDea(idx, { expirationDate: e.target.value })
                    }
                    className={inputClass}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addDea}
          className="mt-4 flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700"
        >
          <PlusIcon className="w-4 h-4" />
          Add DEA Registration
        </button>
      </section>
    </div>
  );
}
