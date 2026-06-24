import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../services/api';

interface CaqhImportPanelProps {
  providerId: string;
}

interface ImportSummary {
  importStatus: string | null;
  importError: string | null;
  importUpdatedAt: string | null;
  lastSync: { syncId: string; completedAt: string | null; changesApplied: Record<string, { created: number; updated: number }> | null } | null;
  documents: Array<{
    id: string;
    documentType: string;
    originalFileName: string;
    expirationDate: string | null;
    reviewStatus: string | null;
    linkedTo: string | null;
  }>;
  conflicts: Array<{ field: string; applicationValue: string; currentValue: string }>;
}

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  queued: { label: 'Queued', className: 'bg-gray-100 text-gray-700' },
  in_progress: { label: 'Importing…', className: 'bg-blue-50 text-blue-700' },
  waiting_authorization: { label: 'Waiting: provider must authorize us in CAQH', className: 'bg-amber-50 text-amber-700' },
  waiting_attestation: { label: 'Waiting: provider must attest in CAQH', className: 'bg-amber-50 text-amber-700' },
  completed: { label: 'Imported', className: 'bg-green-50 text-green-700' },
  failed: { label: 'Failed', className: 'bg-red-50 text-red-700' },
};

const SECTION_LABELS: Record<string, string> = {
  licenses: 'Licenses',
  certifications: 'Certifications',
  specialties: 'Specialties',
  education: 'Education',
  malpractice: 'Malpractice insurance',
  providerCertifications: 'Provider certifications',
  cdsRegistrations: 'CDS registrations',
  disclosures: 'Disclosures',
  malpracticeClaims: 'Malpractice claims',
  hospitalAffiliations: 'Hospital affiliations',
  workHistory: 'Work history',
};

// Friendly labels for the document types the CAQH importer assigns. Humanize
// anything unmapped (e.g. a future type) rather than show the raw enum value.
const DOC_TYPE_LABELS: Record<string, string> = {
  malpractice_certificate: 'Malpractice Insurance',
  dea_certificate: 'DEA Certificate',
  cds_certificate: 'CDS Certificate',
  license: 'License',
  board_certification: 'Board Certification',
  diploma: 'Diploma',
  cv_resume: 'CV / Resume',
  w9: 'W-9',
  cme_certificate: 'CME Certificate',
  other: 'Other',
};
const docTypeLabel = (t: string) =>
  DOC_TYPE_LABELS[t] ?? t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function CaqhImportPanel({ providerId }: CaqhImportPanelProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['caqh-import-summary', providerId],
    queryFn: async () => {
      const res = await api.get(`/caqh/import-summary/${providerId}`);
      return (res.data as { data: ImportSummary }).data;
    },
  });

  // Nothing to show until an import has at least been attempted
  if (isLoading || !data?.importStatus) return null;

  const status = STATUS_LABELS[data.importStatus] ?? { label: data.importStatus, className: 'bg-gray-100 text-gray-700' };
  const changes = data.lastSync?.changesApplied;
  const filledSections = changes
    ? Object.entries(changes)
        .filter(([, counts]) => counts && (counts.created > 0 || counts.updated > 0))
        .map(([key, counts]) => ({ label: SECTION_LABELS[key] ?? key, ...counts }))
    : [];

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Imported from CAQH</h3>
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${status.className}`}>{status.label}</span>
      </div>

      <div className="p-4 space-y-4 text-sm">
        {data.importError && data.importStatus === 'failed' && (
          <p className="text-red-600">{data.importError}</p>
        )}

        {data.importUpdatedAt && (
          <p className="text-xs text-gray-500">Last activity: {format(new Date(data.importUpdatedAt), 'MMM d, yyyy h:mm a')}</p>
        )}

        {/* Conflicts first — they need a human decision */}
        {data.conflicts.length > 0 && (
          <div className="border border-amber-200 bg-amber-50 rounded-md p-3">
            <p className="font-medium text-amber-800 mb-2">
              Needs your decision — CAQH disagrees with the application form:
            </p>
            <ul className="space-y-1">
              {data.conflicts.map((c) => (
                <li key={c.field} className="text-amber-800">
                  <span className="font-medium">{c.field}:</span> form said “{c.applicationValue}”, CAQH says “{c.currentValue || '(blank)'}”
                </li>
              ))}
            </ul>
            <p className="text-xs text-amber-700 mt-2">
              The CAQH value is currently on the profile. Edit the provider record if the form value was correct.
            </p>
          </div>
        )}

        {/* What the sync filled */}
        {filledSections.length > 0 && (
          <div>
            <p className="font-medium text-gray-700 mb-1">Profile sections filled:</p>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-gray-600">
              {filledSections.map((s) => (
                <li key={s.label}>
                  {s.label}: {s.created > 0 && `${s.created} added`}
                  {s.created > 0 && s.updated > 0 && ', '}
                  {s.updated > 0 && `${s.updated} updated`}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Documents that arrived — grouped by type. The raw CAQH filenames
            (e.g. 12561743_100000001_20180627042951.pdf) are noise; a per-type
            count plus a single "needs review" flag is the useful signal. */}
        {data.documents.length > 0 && (() => {
          const byType = data.documents.reduce<Record<string, number>>((acc, d) => {
            acc[d.documentType] = (acc[d.documentType] ?? 0) + 1;
            return acc;
          }, {});
          const needsReview = data.documents.filter((d) => d.reviewStatus === 'pending').length;
          return (
            <div>
              <p className="font-medium text-gray-700 mb-1">Documents imported ({data.documents.length}):</p>
              <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-gray-600">
                {Object.entries(byType)
                  .sort((a, b) => b[1] - a[1])
                  .map(([type, count]) => (
                    <li key={type}>{docTypeLabel(type)}: {count}</li>
                  ))}
              </ul>
              {needsReview > 0 && (
                <span className="inline-block mt-2 px-1.5 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700">
                  {needsReview} need{needsReview === 1 ? 's' : ''} review
                </span>
              )}
            </div>
          );
        })()}

        {data.importStatus === 'completed' && filledSections.length === 0 && data.documents.length === 0 && (
          <p className="text-gray-500">Import completed but CAQH returned no new data for this provider.</p>
        )}
      </div>
    </div>
  );
}
