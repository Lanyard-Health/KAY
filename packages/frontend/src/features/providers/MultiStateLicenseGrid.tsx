import { useState, useMemo } from 'react';
import clsx from 'clsx';
import { format, differenceInDays, parseISO } from 'date-fns';
import {
  MapIcon,
  XMarkIcon,
  GlobeAmericasIcon,
} from '@heroicons/react/24/outline';

interface MultiStateLicenseGridProps {
  providerId: string;
  licenses: any[];
  providerType?: string;
  onAddLicense?: (state: string) => void;
}

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
];

const PSYPACT_STATES = new Set([
  'AL','AZ','AR','CO','CT','DE','DC','GA','ID','IL',
  'IN','KS','KY','ME','MD','MN','MO','NE','NV','NH',
  'NJ','NC','ND','OH','OK','PA','RI','SC','TN','TX',
  'UT','VA','WA','WV','WI','WY',
]);

type LicenseStatus = 'active' | 'expiring' | 'expired' | 'none';

interface StateLicenseInfo {
  state: string;
  status: LicenseStatus;
  license?: any;
}

function getLicenseStatus(license: any): LicenseStatus {
  if (!license) return 'none';
  const expDate = license.expirationDate || license.expiration_date;
  if (!expDate) return 'active';
  const end = parseISO(expDate);
  const today = new Date();
  const daysUntilExpiry = differenceInDays(end, today);
  if (daysUntilExpiry < 0) return 'expired';
  if (daysUntilExpiry <= 90) return 'expiring';
  return 'active';
}

export default function MultiStateLicenseGrid({
  licenses,
  providerType,
  onAddLicense,
}: MultiStateLicenseGridProps) {
  const [selectedState, setSelectedState] = useState<string | null>(null);

  // Build a map of state → license (using the best/most recent license per state)
  const licenseByState = useMemo(() => {
    const map: Record<string, any> = {};
    for (const lic of licenses) {
      const state = lic.state || lic.licenseState || lic.issuingState;
      if (state) {
        // Keep the most recent / active one if multiple
        if (!map[state] || getLicenseStatus(lic) === 'active') {
          map[state] = lic;
        }
      }
    }
    return map;
  }, [licenses]);

  const stateInfos: StateLicenseInfo[] = useMemo(() => {
    return US_STATES.map((state) => ({
      state,
      status: getLicenseStatus(licenseByState[state]),
      license: licenseByState[state],
    }));
  }, [licenseByState]);

  const selectedInfo = selectedState
    ? stateInfos.find((s) => s.state === selectedState)
    : null;

  const licensedCount = stateInfos.filter((s) => s.status !== 'none').length;

  // PSYPACT compact info
  const isPsychologist =
    providerType?.toLowerCase().includes('psychologist') ||
    providerType === 'Psychologist';
  const psypactLicensedCount = isPsychologist
    ? stateInfos.filter(
        (s) => PSYPACT_STATES.has(s.state) && s.status !== 'none'
      ).length
    : 0;

  const handleStateClick = (info: StateLicenseInfo) => {
    if (info.status === 'none') {
      if (onAddLicense) {
        onAddLicense(info.state);
      }
    } else {
      setSelectedState(selectedState === info.state ? null : info.state);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-primary-50">
            <MapIcon className="h-5 w-5 text-primary-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              Multi-State License Grid
            </h3>
            <p className="text-sm text-gray-500">
              {licensedCount} state{licensedCount !== 1 ? 's' : ''} licensed
            </p>
          </div>
        </div>
      </div>

      {/* PSYPACT compact badge */}
      {isPsychologist && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-indigo-50 border border-indigo-200 px-3 py-2">
          <GlobeAmericasIcon className="h-4 w-4 text-indigo-600 shrink-0" />
          <p className="text-xs font-medium text-indigo-700">
            PSYPACT: Licensed in {psypactLicensedCount} / {PSYPACT_STATES.size}{' '}
            member states
          </p>
        </div>
      )}

      {/* State Grid: 10 cols x 5 rows */}
      <div className="grid grid-cols-10 gap-1.5">
        {stateInfos.map((info) => (
          <button
            key={info.state}
            type="button"
            onClick={() => handleStateClick(info)}
            title={
              info.status === 'none'
                ? `${info.state} — No license (click to add)`
                : `${info.state} — ${info.status}`
            }
            className={clsx(
              'w-10 h-10 rounded-lg text-xs font-medium flex items-center justify-center cursor-pointer transition-all',
              'hover:ring-2 hover:ring-offset-1',
              {
                'bg-green-100 text-green-800 hover:ring-green-400':
                  info.status === 'active',
                'bg-amber-100 text-amber-800 hover:ring-amber-400':
                  info.status === 'expiring',
                'bg-red-100 text-red-800 hover:ring-red-400':
                  info.status === 'expired',
                'bg-gray-50 text-gray-400 hover:ring-gray-300':
                  info.status === 'none',
                'ring-2 ring-offset-1 ring-primary-500':
                  selectedState === info.state,
              }
            )}
          >
            {info.state}
          </button>
        ))}
      </div>

      {/* Legend */}
      <div className="mt-3 flex items-center gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-green-100 border border-green-300" />
          Active
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-100 border border-amber-300" />
          Expiring
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-red-100 border border-red-300" />
          Expired
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-gray-50 border border-gray-300" />
          No License
        </span>
      </div>

      {/* Expanded details panel */}
      {selectedInfo && selectedInfo.status !== 'none' && selectedInfo.license && (
        <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-gray-900">
              {selectedInfo.state} License Details
            </h4>
            <button
              type="button"
              onClick={() => setSelectedState(null)}
              className="text-gray-400 hover:text-gray-600"
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-xs text-gray-500">License Type</p>
              <p className="font-medium text-gray-900">
                {selectedInfo.license.licenseType ||
                  selectedInfo.license.type ||
                  'N/A'}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">License Number</p>
              <p className="font-medium text-gray-900">
                {selectedInfo.license.licenseNumber ||
                  selectedInfo.license.number ||
                  'N/A'}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Expiration</p>
              <p
                className={clsx('font-medium', {
                  'text-green-700': selectedInfo.status === 'active',
                  'text-amber-700': selectedInfo.status === 'expiring',
                  'text-red-700': selectedInfo.status === 'expired',
                })}
              >
                {selectedInfo.license.expirationDate ||
                selectedInfo.license.expiration_date
                  ? format(
                      parseISO(
                        selectedInfo.license.expirationDate ||
                          selectedInfo.license.expiration_date
                      ),
                      'MMM d, yyyy'
                    )
                  : 'No expiration'}
              </p>
            </div>
          </div>
          {isPsychologist && PSYPACT_STATES.has(selectedInfo.state) && (
            <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
              <GlobeAmericasIcon className="h-3 w-3" />
              PSYPACT member state
            </div>
          )}
        </div>
      )}
    </div>
  );
}
