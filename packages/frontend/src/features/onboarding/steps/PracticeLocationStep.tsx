import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';

interface StepProps {
  data: Record<string, any>;
  onChange: (updates: Record<string, any>) => void;
}

interface Location {
  addressLine1: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  telehealth: boolean;
}

const EMPTY_LOCATION: Location = {
  addressLine1: '',
  city: '',
  state: '',
  zip: '',
  phone: '',
  telehealth: false,
};

const US_STATES = [
  '', 'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN',
  'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH',
  'NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT',
  'VT','VA','WA','WV','WI','WY',
];

const inputClass =
  'block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500';
const labelClass = 'block text-sm font-medium text-gray-700 mb-1';

export default function PracticeLocationStep({ data, onChange }: StepProps) {
  const locations: Location[] =
    data.locations && data.locations.length > 0
      ? data.locations
      : [{ ...EMPTY_LOCATION }];

  const updateLocation = (index: number, updates: Partial<Location>) => {
    const updated = locations.map((loc, i) =>
      i === index ? { ...loc, ...updates } : loc
    );
    onChange({ locations: updated });
  };

  const addLocation = () => {
    onChange({ locations: [...locations, { ...EMPTY_LOCATION }] });
  };

  const removeLocation = (index: number) => {
    if (locations.length <= 1) return;
    onChange({ locations: locations.filter((_, i) => i !== index) });
  };

  return (
    <div>
      <h2 className="text-base font-semibold text-gray-900 mb-4">
        Practice Locations
      </h2>
      <p className="text-sm text-gray-500 mb-6">
        Add at least one practice location where you provide services.
      </p>

      <div className="space-y-6">
        {locations.map((loc, idx) => (
          <div
            key={idx}
            className="relative border border-gray-200 rounded-xl p-5"
          >
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium text-gray-900">
                Location {idx + 1}
              </span>
              {locations.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeLocation(idx)}
                  className="text-red-500 hover:text-red-700 p-1"
                >
                  <TrashIcon className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <label className={labelClass}>Address Line 1</label>
                <input
                  type="text"
                  value={loc.addressLine1}
                  onChange={(e) =>
                    updateLocation(idx, { addressLine1: e.target.value })
                  }
                  className={inputClass}
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="col-span-2 sm:col-span-1">
                  <label className={labelClass}>City</label>
                  <input
                    type="text"
                    value={loc.city}
                    onChange={(e) =>
                      updateLocation(idx, { city: e.target.value })
                    }
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>State</label>
                  <select
                    value={loc.state}
                    onChange={(e) =>
                      updateLocation(idx, { state: e.target.value })
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
                <div>
                  <label className={labelClass}>Zip</label>
                  <input
                    type="text"
                    maxLength={10}
                    value={loc.zip}
                    onChange={(e) =>
                      updateLocation(idx, { zip: e.target.value })
                    }
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
                <div>
                  <label className={labelClass}>Phone</label>
                  <input
                    type="tel"
                    value={loc.phone}
                    onChange={(e) =>
                      updateLocation(idx, { phone: e.target.value })
                    }
                    className={inputClass}
                  />
                </div>
                <div className="flex items-center gap-2 pb-1">
                  <input
                    type="checkbox"
                    id={`telehealth-${idx}`}
                    checked={loc.telehealth}
                    onChange={(e) =>
                      updateLocation(idx, { telehealth: e.target.checked })
                    }
                    className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <label
                    htmlFor={`telehealth-${idx}`}
                    className="text-sm text-gray-700"
                  >
                    Telehealth location
                  </label>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addLocation}
        className="mt-4 flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700"
      >
        <PlusIcon className="w-4 h-4" />
        Add Location
      </button>
    </div>
  );
}
