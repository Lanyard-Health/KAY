import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';

interface StepProps {
  data: Record<string, any>;
  onChange: (updates: Record<string, any>) => void;
}

const PROVIDER_TYPE_LABELS: Record<string, string> = {
  psychiatrist: 'Psychiatrist',
  psychologist: 'Psychologist',
  lcsw: 'LCSW',
  lpc: 'LPC',
  lmft: 'LMFT',
  lmhc: 'LMHC',
  pmhnp: 'PMHNP',
  aprn: 'APRN',
  pa: 'PA',
  bcba: 'BCBA',
  other: 'Other',
};

function isBasicInfoComplete(data: Record<string, any>): boolean {
  return !!(data.firstName && data.lastName && data.npi && data.email);
}

function isLocationsComplete(data: Record<string, any>): boolean {
  const locs = data.locations || [];
  return (
    locs.length > 0 &&
    locs.every(
      (l: any) => l.addressLine1 && l.city && l.state && l.zip
    )
  );
}

function isEducationComplete(data: Record<string, any>): boolean {
  const edu = data.education || [];
  return (
    edu.length > 0 &&
    edu.every((e: any) => e.schoolName && e.degreeType)
  );
}

function isLicensesComplete(data: Record<string, any>): boolean {
  const lics = data.licenses || [];
  return (
    lics.length > 0 &&
    lics.every((l: any) => l.licenseType && l.licenseNumber && l.state)
  );
}

function isInsuranceComplete(data: Record<string, any>): boolean {
  const ins = data.malpracticeInsurance || {};
  return !!(ins.carrierName && ins.policyNumber);
}

function isWorkHistoryComplete(data: Record<string, any>): boolean {
  const work = data.workHistory || [];
  return (
    work.length > 0 &&
    work.every((w: any) => w.organizationName && w.position && w.startDate)
  );
}

function isDisclosuresComplete(data: Record<string, any>): boolean {
  const disc = data.disclosures || {};
  return Object.keys(disc).length >= 8;
}

function maskAccountNumber(num: string | undefined): string {
  if (!num || num.length < 4) return '****';
  return '****' + num.slice(-4);
}

function SectionStatus({ complete }: { complete: boolean }) {
  return complete ? (
    <CheckCircleIcon className="w-5 h-5 text-primary-600" />
  ) : (
    <ExclamationTriangleIcon className="w-5 h-5 text-amber-500" />
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: string | undefined | null;
}) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-900">{value || '-'}</dd>
    </div>
  );
}

export default function ReviewSubmitStep({ data }: StepProps) {
  const locations = data.locations || [];
  const education = data.education || [];
  const licenses = data.licenses || [];
  const boardCerts = data.boardCerts || [];
  const deaRegistrations = data.deaRegistrations || [];
  const insurance = data.malpracticeInsurance || {};
  const banking = data.banking || {};
  const workHistory = data.workHistory || [];
  const disclosures = data.disclosures || {};
  const supervisor = data.supervisingPhysician || {};

  const sections = [
    { label: 'Basic Information', complete: isBasicInfoComplete(data) },
    { label: 'Practice Locations', complete: isLocationsComplete(data) },
    { label: 'Education', complete: isEducationComplete(data) },
    { label: 'Licenses & Certifications', complete: isLicensesComplete(data) },
    { label: 'Insurance', complete: isInsuranceComplete(data) },
    { label: 'Work History', complete: isWorkHistoryComplete(data) },
    { label: 'Disclosures', complete: isDisclosuresComplete(data) },
  ];

  const allComplete = sections.every((s) => s.complete);

  return (
    <div>
      <h2 className="text-base font-semibold text-gray-900 mb-2">
        Review & Submit
      </h2>
      <p className="text-sm text-gray-500 mb-6">
        Please review all information before submitting.
      </p>

      {/* Completion Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        {sections.map((s) => (
          <div
            key={s.label}
            className={clsx(
              'flex items-center gap-2 rounded-lg border px-3 py-2',
              s.complete
                ? 'border-primary-200 bg-primary-50'
                : 'border-amber-200 bg-amber-50'
            )}
          >
            <SectionStatus complete={s.complete} />
            <span className="text-xs font-medium text-gray-700">
              {s.label}
            </span>
          </div>
        ))}
      </div>

      {!allComplete && (
        <div className="mb-6 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
          Some sections are incomplete. You can still submit, but incomplete
          information may delay credentialing.
        </div>
      )}

      <div className="space-y-8">
        {/* Basic Info */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <SectionStatus complete={isBasicInfoComplete(data)} />
            <h3 className="text-sm font-semibold text-gray-900">
              Basic Information
            </h3>
          </div>
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 pl-7">
            <Field label="NPI" value={data.npi} />
            <Field label="First Name" value={data.firstName} />
            <Field label="Last Name" value={data.lastName} />
            <Field label="Middle Name" value={data.middleName} />
            <Field label="Suffix" value={data.suffix} />
            <Field label="Date of Birth" value={data.dateOfBirth} />
            <Field label="Gender" value={data.gender} />
            <Field label="Email" value={data.email} />
            <Field label="Phone" value={data.phone} />
            <Field
              label="Provider Type"
              value={PROVIDER_TYPE_LABELS[data.providerType] || data.providerType}
            />
          </dl>
        </section>

        {/* Locations */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <SectionStatus complete={isLocationsComplete(data)} />
            <h3 className="text-sm font-semibold text-gray-900">
              Practice Locations ({locations.length})
            </h3>
          </div>
          <div className="space-y-3 pl-7">
            {locations.map((loc: any, idx: number) => (
              <div key={idx} className="text-sm text-gray-700">
                <span className="font-medium">Location {idx + 1}:</span>{' '}
                {loc.addressLine1}, {loc.city}, {loc.state} {loc.zip}
                {loc.telehealth && (
                  <span className="ml-2 inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                    Telehealth
                  </span>
                )}
              </div>
            ))}
            {locations.length === 0 && (
              <p className="text-sm text-gray-400 italic">
                No locations added
              </p>
            )}
          </div>
        </section>

        {/* Education */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <SectionStatus complete={isEducationComplete(data)} />
            <h3 className="text-sm font-semibold text-gray-900">
              Education ({education.length})
            </h3>
          </div>
          <div className="space-y-3 pl-7">
            {education.map((ed: any, idx: number) => (
              <div key={idx} className="text-sm text-gray-700">
                <span className="font-medium">{ed.schoolName || 'Unnamed'}</span>{' '}
                - {ed.degreeType?.toUpperCase() || '?'} in{' '}
                {ed.fieldOfStudy || '?'}
                {ed.startDate && (
                  <span className="text-gray-500">
                    {' '}
                    ({ed.startDate} to {ed.endDate || 'present'})
                  </span>
                )}
              </div>
            ))}
            {education.length === 0 && (
              <p className="text-sm text-gray-400 italic">
                No education records added
              </p>
            )}
          </div>
        </section>

        {/* Licenses */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <SectionStatus complete={isLicensesComplete(data)} />
            <h3 className="text-sm font-semibold text-gray-900">
              Licenses ({licenses.length}), Board Certifications (
              {boardCerts.length}), DEA ({deaRegistrations.length})
            </h3>
          </div>
          <div className="space-y-2 pl-7">
            {licenses.map((lic: any, idx: number) => (
              <div key={`lic-${idx}`} className="text-sm text-gray-700">
                <span className="font-medium">License:</span>{' '}
                {lic.licenseType} #{lic.licenseNumber} ({lic.state}) - Exp:{' '}
                {lic.expirationDate || '?'}
              </div>
            ))}
            {boardCerts.map((cert: any, idx: number) => (
              <div key={`cert-${idx}`} className="text-sm text-gray-700">
                <span className="font-medium">Board Cert:</span>{' '}
                {cert.boardType} - {cert.specialty || cert.boardName}
              </div>
            ))}
            {deaRegistrations.map((dea: any, idx: number) => (
              <div key={`dea-${idx}`} className="text-sm text-gray-700">
                <span className="font-medium">DEA:</span> #{dea.deaNumber} (
                {dea.state}) - Schedules:{' '}
                {(dea.schedules || []).join(', ') || 'None'}
              </div>
            ))}
            {licenses.length === 0 &&
              boardCerts.length === 0 &&
              deaRegistrations.length === 0 && (
                <p className="text-sm text-gray-400 italic">
                  No licenses or certifications added
                </p>
              )}
          </div>
        </section>

        {/* Insurance & Banking */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <SectionStatus complete={isInsuranceComplete(data)} />
            <h3 className="text-sm font-semibold text-gray-900">
              Insurance & Banking
            </h3>
          </div>
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 pl-7">
            <Field label="Carrier" value={insurance.carrierName} />
            <Field label="Policy #" value={insurance.policyNumber} />
            <Field label="Coverage Type" value={insurance.coverageType} />
            <Field
              label="Per Claim"
              value={
                insurance.perClaimAmount
                  ? `$${Number(insurance.perClaimAmount).toLocaleString()}`
                  : undefined
              }
            />
            <Field
              label="Aggregate"
              value={
                insurance.aggregateAmount
                  ? `$${Number(insurance.aggregateAmount).toLocaleString()}`
                  : undefined
              }
            />
            <Field label="Expiration" value={insurance.expirationDate} />
          </dl>
          {banking.accountNumber && (
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 pl-7 mt-4 pt-4 border-t border-gray-100">
              <Field label="Bank" value={banking.bankName} />
              <Field
                label="Account"
                value={maskAccountNumber(banking.accountNumber)}
              />
              <Field label="Account Type" value={banking.accountType} />
            </dl>
          )}
        </section>

        {/* Work History */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <SectionStatus complete={isWorkHistoryComplete(data)} />
            <h3 className="text-sm font-semibold text-gray-900">
              Work History ({workHistory.length})
            </h3>
          </div>
          <div className="space-y-2 pl-7">
            {workHistory.map((w: any, idx: number) => (
              <div key={idx} className="text-sm text-gray-700">
                <span className="font-medium">{w.position || '?'}</span> at{' '}
                {w.organizationName || '?'}
                <span className="text-gray-500">
                  {' '}
                  ({w.startDate || '?'} to{' '}
                  {w.current ? 'present' : w.endDate || '?'})
                </span>
              </div>
            ))}
            {workHistory.length === 0 && (
              <p className="text-sm text-gray-400 italic">
                No work history added
              </p>
            )}
          </div>
        </section>

        {/* Disclosures */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <SectionStatus complete={isDisclosuresComplete(data)} />
            <h3 className="text-sm font-semibold text-gray-900">
              Disclosures
            </h3>
          </div>
          <div className="space-y-1 pl-7">
            {Object.entries(disclosures).map(([cat, entry]: [string, any]) => (
              <div key={cat} className="text-sm text-gray-700">
                <span className="font-medium">
                  {cat.replace(/_/g, ' ')}:
                </span>{' '}
                <span
                  className={
                    entry.answer ? 'text-red-600 font-medium' : 'text-gray-500'
                  }
                >
                  {entry.answer ? 'Yes' : 'No'}
                </span>
              </div>
            ))}
            {Object.keys(disclosures).length === 0 && (
              <p className="text-sm text-gray-400 italic">
                No disclosures completed
              </p>
            )}
          </div>
        </section>

        {/* Supervisor */}
        {(supervisor.firstName || supervisor.lastName) && (
          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-3 pl-7">
              Supervising Physician
            </h3>
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 pl-7">
              <Field
                label="Name"
                value={`${supervisor.firstName || ''} ${supervisor.lastName || ''}`.trim()}
              />
              <Field label="NPI" value={supervisor.npi} />
              <Field label="License #" value={supervisor.licenseNumber} />
              <Field label="License State" value={supervisor.licenseState} />
              <Field
                label="Supervision Type"
                value={supervisor.supervisionType}
              />
            </dl>
          </section>
        )}
      </div>
    </div>
  );
}
