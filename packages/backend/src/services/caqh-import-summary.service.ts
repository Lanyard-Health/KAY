import { prisma } from '../utils/prisma.js';

export interface CaqhImportConflict {
  field: string;
  applicationValue: string;
  currentValue: string;
}

export interface CaqhImportSummaryResult {
  importStatus: string | null;
  importError: string | null;
  importUpdatedAt: Date | null;
  lastSync: {
    syncId: string;
    completedAt: Date | null;
    changesApplied: unknown;
  } | null;
  documents: Array<{
    id: string;
    documentType: string;
    originalFileName: string;
    description: string | null;
    expirationDate: Date | null;
    reviewStatus: string | null;
    linkedTo: 'license' | 'board_certification' | 'malpractice_insurance' | null;
  }>;
  conflicts: CaqhImportConflict[];
}

/**
 * Fields the registration form captures that the CAQH sync can also write.
 * A conflict = the provider's current value (post-import) differs from what
 * they typed on the application. Surfaced for a human decision — never
 * auto-resolved (standing data-discipline rule).
 */
const COMPARABLE_FIELDS: Array<{ field: string; appKey: string; providerKey: string }> = [
  { field: 'First name', appKey: 'firstName', providerKey: 'firstName' },
  { field: 'Last name', appKey: 'lastName', providerKey: 'lastName' },
  { field: 'Middle name', appKey: 'middleName', providerKey: 'middleName' },
  { field: 'Suffix', appKey: 'suffix', providerKey: 'suffix' },
  { field: 'Phone', appKey: 'phone', providerKey: 'phone' },
  { field: 'Email', appKey: 'email', providerKey: 'email' },
];

function normalize(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim().toLowerCase();
}

/**
 * Everything the "Imported from CAQH" review panel needs in one call:
 * import state machine status, what the last sync filled (its change log),
 * which documents arrived and where they attached, and form-vs-CAQH conflicts.
 */
export async function getCaqhImportSummary(providerId: string): Promise<CaqhImportSummaryResult> {
  const provider = await prisma.providerProfile.findUnique({
    where: { id: providerId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      middleName: true,
      suffix: true,
      phone: true,
      email: true,
      caqhImportStatus: true,
      caqhImportError: true,
      caqhImportUpdatedAt: true,
    },
  });
  if (!provider) {
    throw new Error('Provider not found');
  }

  const [lastSync, documents, application] = await Promise.all([
    prisma.caqhSyncLog.findFirst({
      where: { providerId, direction: 'pull', status: 'completed' },
      orderBy: { startedAt: 'desc' },
      select: { id: true, completedAt: true, changesApplied: true },
    }),
    prisma.document.findMany({
      where: { providerId, description: { startsWith: 'Imported from CAQH' } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        documentType: true,
        originalFileName: true,
        description: true,
        expirationDate: true,
        reviewStatus: true,
        linkedLicenseId: true,
        linkedBoardCertificationId: true,
        linkedMalpracticeInsuranceId: true,
      },
    }),
    prisma.providerApplication.findFirst({
      where: { providerId, status: 'approved' },
      orderBy: { submittedAt: 'desc' },
      select: {
        firstName: true,
        lastName: true,
        middleName: true,
        suffix: true,
        phone: true,
        email: true,
      },
    }),
  ]);

  const conflicts: CaqhImportConflict[] = [];
  if (application) {
    for (const { field, appKey, providerKey } of COMPARABLE_FIELDS) {
      const appValue = (application as Record<string, unknown>)[appKey];
      const currentValue = (provider as Record<string, unknown>)[providerKey];
      // Only a conflict when the form actually said something and it now differs.
      if (normalize(appValue) && normalize(appValue) !== normalize(currentValue)) {
        conflicts.push({
          field,
          applicationValue: String(appValue),
          currentValue: currentValue === null || currentValue === undefined ? '' : String(currentValue),
        });
      }
    }
  }

  return {
    importStatus: provider.caqhImportStatus,
    importError: provider.caqhImportError,
    importUpdatedAt: provider.caqhImportUpdatedAt,
    lastSync: lastSync
      ? { syncId: lastSync.id, completedAt: lastSync.completedAt, changesApplied: lastSync.changesApplied }
      : null,
    documents: documents.map((d) => ({
      id: d.id,
      documentType: d.documentType,
      originalFileName: d.originalFileName,
      description: d.description,
      expirationDate: d.expirationDate,
      reviewStatus: d.reviewStatus,
      linkedTo: d.linkedLicenseId
        ? ('license' as const)
        : d.linkedBoardCertificationId
          ? ('board_certification' as const)
          : d.linkedMalpracticeInsuranceId
            ? ('malpractice_insurance' as const)
            : null,
    })),
    conflicts,
  };
}
