/**
 * Practice Documents tab — Phase 4.
 *
 * Backend endpoints called via hooks/usePracticeDocuments:
 *   - usePracticeDocuments(practiceId) — list, with 5 s polling while any row
 *     is in 'pending' or 'processing' status; idles once all rows settle.
 *   - useUploadPracticeDocument(practiceId) — three-phase upload
 *     (request URL → S3 PUT → confirm).
 *   - useUpdatePracticeDocumentType(practiceId) — PATCH documentType.
 *
 * Practice-context resolution:
 *   - admin: usePractices() returns full list, picker shown when >1 option.
 *   - credentialing_staff / practice_admin: defaults to user.practices[0].practiceId.
 *
 * Out of scope for tonight (do NOT add):
 *   - Rendering ocrData (Textract field extractions) — stored in cache only.
 *     Textract field key names are unpredictable across documents (e.g. one
 *     W-9 may have key 'EIN', another 'Employer identification number');
 *     a future PR will render the JSON as a flat key/value table.
 *   - Delete UI (endpoint exists, not wired).
 *   - Download UI.
 */
import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import {
  CloudArrowUpIcon,
  DocumentIcon,
  ArrowPathIcon,
  PencilSquareIcon,
  CheckIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../stores/auth.store';
import { usePractices } from '../../hooks/usePractices';
import {
  usePracticeDocuments,
  useUploadPracticeDocument,
  useUpdatePracticeDocumentType,
  type PracticeDocument,
  type PracticeDocumentOcrStatus,
} from '../../hooks/usePracticeDocuments';
import EmptyState from '../../components/ui/EmptyState';
import ErrorState from '../../components/ui/ErrorState';
import StatusBadge from '../../components/ui/StatusBadge';

// Practice-relevant types first (matches what a practice admin actually
// uploads — W-9, COI, CP575, business license). The full enum follows so
// admins can correct any OCR misclassification without leaving the dropdown.
const PRACTICE_RELEVANT_TYPES = [
  { value: 'w9', label: 'W-9 Form' },
  { value: 'coi', label: 'Certificate of Insurance (COI)' },
  { value: 'cp575', label: 'CP575 / IRS Letter' },
  { value: 'license', label: 'Business License' },
  { value: 'other', label: 'Other' },
];

const ALL_DOCUMENT_TYPES = [
  ...PRACTICE_RELEVANT_TYPES,
  { value: 'board_certification', label: 'Board Certification' },
  { value: 'malpractice_certificate', label: 'Malpractice Insurance Certificate' },
  { value: 'diploma', label: 'Diploma' },
  { value: 'transcript', label: 'Transcript' },
  { value: 'cv_resume', label: 'CV / Resume' },
  { value: 'photo', label: 'Professional Photo' },
  { value: 'government_id', label: 'Government ID' },
  { value: 'dea_certificate', label: 'DEA Certificate' },
  { value: 'cds_certificate', label: 'Controlled Substance Certificate' },
  { value: 'cme_certificate', label: 'CME Certificate' },
  { value: 'hospital_letter', label: 'Hospital Privileges Letter' },
  { value: 'reference_letter', label: 'Reference Letter' },
];

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/webp',
];
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

function ocrBadge(status: PracticeDocumentOcrStatus | null) {
  switch (status) {
    case 'completed':
      return { variant: 'success' as const, label: 'Completed' };
    case 'needs_review':
      return { variant: 'warning' as const, label: 'Needs Review' };
    case 'failed':
      return { variant: 'danger' as const, label: 'Failed' };
    case 'not_applicable':
      return { variant: 'neutral' as const, label: 'Not Applicable' };
    case 'processing':
      return { variant: 'info' as const, label: 'Processing' };
    case 'pending':
      return { variant: 'info' as const, label: 'Pending' };
    default:
      return null;
  }
}

function typeLabel(value: string) {
  return ALL_DOCUMENT_TYPES.find((t) => t.value === value)?.label ?? value;
}

export default function PracticeDocumentsTab() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';

  const userPractices = user?.practices ?? [];
  const defaultPracticeId = userPractices[0]?.practiceId ?? '';

  const [selectedPracticeId, setSelectedPracticeId] = useState<string>(defaultPracticeId);

  const { data: allPractices } = usePractices();
  const practiceOptions = useMemo(() => {
    if (isAdmin) {
      return (allPractices ?? []).map((p) => ({ id: p.id, name: p.name }));
    }
    return userPractices.map((up) => ({ id: up.practiceId, name: up.practice?.name ?? '(unknown practice)' }));
  }, [isAdmin, allPractices, userPractices]);

  if (!isAdmin && userPractices.length === 0) {
    return (
      <EmptyState
        illustration="folder"
        title="No practice assigned"
        description="You aren't currently assigned to a practice. Ask an admin to add you to one."
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Picker shown only when there's more than one option to choose from. */}
      {practiceOptions.length > 1 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-4">
          <label htmlFor="practice-picker" className="label">
            Practice
          </label>
          <select
            id="practice-picker"
            className="input"
            value={selectedPracticeId}
            onChange={(e) => setSelectedPracticeId(e.target.value)}
          >
            <option value="">Choose a practice…</option>
            {practiceOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {selectedPracticeId ? (
        <>
          <UploadCard practiceId={selectedPracticeId} />
          <DocumentsList practiceId={selectedPracticeId} />
        </>
      ) : (
        <EmptyState
          illustration="folder"
          title="Select a practice"
          description="Choose a practice from the dropdown above to see its documents."
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────
// Upload card
// ──────────────────────────────────────────────
function UploadCard({ practiceId }: { practiceId: string }) {
  const upload = useUploadPracticeDocument(practiceId);
  const [file, setFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState<string>('');
  const [phase, setPhase] = useState<string>('');
  const [progressPct, setProgressPct] = useState<number>(0);

  const reset = () => {
    setFile(null);
    setDocumentType('');
    setPhase('');
    setProgressPct(0);
  };

  const handleFile = (next: File | null) => {
    if (!next) return;
    if (!ALLOWED_MIME_TYPES.includes(next.type)) {
      toast.error('Invalid file type. Upload PDF, JPEG, PNG, TIFF, or WebP.');
      return;
    }
    if (next.size > MAX_FILE_SIZE) {
      toast.error('File too large. Max 25 MB.');
      return;
    }
    setFile(next);
  };

  const handleUpload = () => {
    if (!file) return;
    upload.mutate(
      {
        file,
        documentType: documentType || undefined,
        onProgress: (p, pct) => {
          setPhase(p);
          setProgressPct(pct);
        },
      },
      {
        onSuccess: () => {
          toast.success('Uploaded — OCR processing has started.');
          reset();
        },
        onError: (err: unknown) => {
          const e = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
          toast.error(e.response?.data?.error?.message ?? e.message ?? 'Upload failed');
          setPhase('');
          setProgressPct(0);
        },
      }
    );
  };

  const phaseLabel = (() => {
    if (!phase) return null;
    if (phase === 'requesting_url') return 'Requesting upload URL…';
    if (phase === 'uploading') return 'Uploading file…';
    if (phase === 'confirming') return 'Confirming and starting OCR…';
    return phase;
  })();

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6">
      <h2 className="text-base font-semibold text-gray-900">Upload practice document</h2>
      <p className="mt-1 text-xs text-gray-500">
        PDF, JPEG, PNG, TIFF, or WebP. Up to 25 MB. Leave document type as <em>Auto-detect</em> to
        let OCR classify after upload.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_240px_auto] items-end">
        {/* File picker — drag/drop OR click to browse, mirrors DocumentUploadModal */}
        <label
          htmlFor="practice-doc-file"
          className="flex flex-col justify-center items-center gap-2 border-2 border-dashed border-gray-300 rounded-xl px-4 py-6 cursor-pointer hover:border-primary-400 hover:bg-gray-50 transition-colors"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleFile(e.dataTransfer.files?.[0] ?? null);
          }}
        >
          <CloudArrowUpIcon className="h-6 w-6 text-gray-400" />
          {file ? (
            <span className="text-sm text-gray-700 truncate max-w-full">{file.name}</span>
          ) : (
            <span className="text-sm text-gray-500">Click or drop a file here</span>
          )}
          <input
            id="practice-doc-file"
            type="file"
            className="sr-only"
            accept={ALLOWED_MIME_TYPES.join(',')}
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          />
        </label>

        <div>
          <label htmlFor="practice-doc-type" className="label">
            Document type
          </label>
          <select
            id="practice-doc-type"
            className="input"
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value)}
            disabled={upload.isPending}
          >
            <option value="">Auto-detect (OCR will classify)</option>
            {ALL_DOCUMENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          className="btn-primary"
          onClick={handleUpload}
          disabled={!file || upload.isPending}
        >
          {upload.isPending ? 'Uploading…' : 'Upload'}
        </button>
      </div>

      {phaseLabel && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-gray-600">
            <span>{phaseLabel}</span>
            <span>{progressPct}%</span>
          </div>
          <div className="mt-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary-600 transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────
// Documents list
// ──────────────────────────────────────────────
function DocumentsList({ practiceId }: { practiceId: string }) {
  const { data: docs, isLoading, error, refetch } = usePracticeDocuments(practiceId);

  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-12 text-center text-sm text-gray-500">
        Loading documents…
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6">
        <ErrorState
          title="Couldn't load documents"
          message="Check your connection and try again."
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  if (!docs || docs.length === 0) {
    return (
      <EmptyState
        illustration="folder"
        title="No practice documents yet"
        description="Upload a W-9, COI, business license, or other practice document above to get started."
      />
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Filename
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Type
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              OCR status
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Uploaded
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {docs.map((doc) => (
            <DocumentRow key={doc.id} doc={doc} practiceId={practiceId} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DocumentRow({ doc, practiceId }: { doc: PracticeDocument; practiceId: string }) {
  const update = useUpdatePracticeDocumentType(practiceId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(doc.documentType);

  const inFlight =
    doc.ocrStatus === 'pending' || doc.ocrStatus === 'processing';
  const badge = ocrBadge(doc.ocrStatus);

  const save = () => {
    if (draft === doc.documentType) {
      setEditing(false);
      return;
    }
    update.mutate(
      { documentId: doc.id, documentType: draft },
      {
        onSuccess: () => {
          toast.success('Document type updated.');
          setEditing(false);
        },
        onError: (err: unknown) => {
          const e = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
          toast.error(e.response?.data?.error?.message ?? e.message ?? 'Update failed');
        },
      }
    );
  };

  const cancel = () => {
    setDraft(doc.documentType);
    setEditing(false);
  };

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <DocumentIcon className="h-4 w-4 text-gray-400 flex-shrink-0" />
          <span className="text-sm text-gray-900 truncate max-w-[320px]">{doc.originalFileName}</span>
        </div>
      </td>
      <td className="px-4 py-3">
        {editing ? (
          <div className="flex items-center gap-1.5">
            <select
              className="input py-1 text-sm"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={update.isPending}
              autoFocus
            >
              {ALL_DOCUMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="text-primary-600 hover:text-primary-700 disabled:opacity-50"
              onClick={save}
              disabled={update.isPending}
              aria-label="Save document type"
            >
              <CheckIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="text-gray-400 hover:text-gray-600"
              onClick={cancel}
              disabled={update.isPending}
              aria-label="Cancel"
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(doc.documentType);
              setEditing(true);
            }}
            className="inline-flex items-center gap-1.5 text-sm text-gray-700 hover:text-primary-700 group"
          >
            <span>{typeLabel(doc.documentType)}</span>
            <PencilSquareIcon className="h-3.5 w-3.5 text-gray-300 group-hover:text-primary-500" />
          </button>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {inFlight && <ArrowPathIcon className="h-4 w-4 text-primary-500 animate-spin" />}
          {badge ? <StatusBadge variant={badge.variant} label={badge.label} /> : null}
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-gray-500">
        {(() => {
          const d = doc.createdAt ? new Date(doc.createdAt) : null;
          return d && !isNaN(d.getTime()) ? format(d, 'MMM d, yyyy') : '—';
        })()}
      </td>
    </tr>
  );
}
