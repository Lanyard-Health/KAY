import { createHash } from 'node:crypto';
import type { DocumentType } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { CaqhService, type CaqhDocumentInfo } from './caqh.service.js';
import { DocumentService } from './document.service.js';

// Lazy — avoids a module-load-time CaqhService construction (route tests pin
// the first constructed instance) and matches the DocumentService route pattern.
let caqhServiceInstance: CaqhService | null = null;
function getCaqhService(): CaqhService {
  if (!caqhServiceInstance) caqhServiceInstance = new CaqhService();
  return caqhServiceInstance;
}

// Lazy — DocumentService reads S3 env config at construction (same pattern as the routes).
let documentServiceInstance: DocumentService | null = null;
function getDocumentService(): DocumentService {
  if (!documentServiceInstance) documentServiceInstance = new DocumentService();
  return documentServiceInstance;
}

/**
 * CAQH DocumentTypeName → our DocumentType. Keyword-based and deliberately
 * conservative: anything we can't confidently classify lands in 'other' with
 * reviewStatus 'pending' so a human sees it (plan rule: never guess silently).
 * First pass is expected to be incomplete — extend as real CAQH type names
 * show up in logs.
 */
const CAQH_DOC_TYPE_KEYWORDS: Array<{ keywords: string[]; type: DocumentType }> = [
  { keywords: ['dea'], type: 'dea_certificate' },
  { keywords: ['cds'], type: 'cds_certificate' },
  { keywords: ['license'], type: 'license' },
  { keywords: ['board'], type: 'board_certification' },
  { keywords: ['malpractice', 'liability', 'face sheet', 'insurance', 'coi'], type: 'malpractice_certificate' },
  { keywords: ['diploma', 'degree'], type: 'diploma' },
  { keywords: ['curriculum', 'cv', 'resume'], type: 'cv_resume' },
  { keywords: ['w-9', 'w9'], type: 'w9' },
  { keywords: ['cme', 'continuing education'], type: 'cme_certificate' },
];

export function mapCaqhDocumentType(caqhTypeName: string): { type: DocumentType; classified: boolean } {
  const normalized = caqhTypeName.toLowerCase();
  for (const { keywords, type } of CAQH_DOC_TYPE_KEYWORDS) {
    if (keywords.some((k) => normalized.includes(k))) {
      return { type, classified: true };
    }
  }
  return { type: 'other', classified: false };
}

function extensionFromContentType(contentType: string, fileName?: string): string {
  const fromName = (fileName?.split('.').pop() || '').replace(/[^a-zA-Z0-9]/g, '');
  if (fromName && fromName.length <= 5) return fromName.toLowerCase();
  if (contentType.includes('pdf')) return 'pdf';
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
  if (contentType.includes('tiff')) return 'tif';
  return 'bin';
}

function parseCaqhDate(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Link an imported document to the credential row the profile sync created.
 * Conservative: only link when exactly one unambiguous candidate exists —
 * a wrong link is worse than no link (the review screen surfaces unlinked docs).
 */
async function findCredentialLink(
  providerId: string,
  type: DocumentType,
  doc: CaqhDocumentInfo
): Promise<Partial<{ linkedLicenseId: string; linkedBoardCertificationId: string; linkedMalpracticeInsuranceId: string }>> {
  if (type === 'license' && doc.StateIdName) {
    const licenses = await prisma.license.findMany({
      where: { providerId, state: doc.StateIdName },
      select: { id: true },
      take: 2,
    });
    if (licenses.length === 1) return { linkedLicenseId: licenses[0]!.id };
    return {};
  }

  if (type === 'malpractice_certificate') {
    const expiration = parseCaqhDate(doc.ExpirationDate);
    if (expiration) {
      const policies = await prisma.malpracticeInsurance.findMany({
        where: { providerId, expirationDate: expiration },
        select: { id: true },
        take: 2,
      });
      if (policies.length === 1) return { linkedMalpracticeInsuranceId: policies[0]!.id };
    }
    return {};
  }

  if (type === 'board_certification') {
    const certs = await prisma.boardCertification.findMany({
      where: { providerId },
      select: { id: true },
      take: 2,
    });
    if (certs.length === 1) return { linkedBoardCertificationId: certs[0]!.id };
  }

  return {};
}

/** Flip the matching ProviderChecklist slot when an imported doc fills it. */
async function updateChecklistSlot(providerId: string, type: DocumentType, documentId: string, caqhApproved: boolean) {
  const slot = type === 'w9' ? 'w9' : type === 'malpractice_certificate' ? 'coi' : null;
  if (!slot) return;

  const checklist = await prisma.providerChecklist.findUnique({
    where: { providerId },
    select: { id: true, w9Status: true, w9DocumentId: true, coiStatus: true, coiDocumentId: true },
  });
  if (!checklist) return;

  const currentStatus = slot === 'w9' ? checklist.w9Status : checklist.coiStatus;
  const currentDocId = slot === 'w9' ? checklist.w9DocumentId : checklist.coiDocumentId;
  // Never overwrite a slot a human already filled or reviewed.
  if (currentDocId || (currentStatus !== 'not_started' && currentStatus !== 'pending_upload')) return;

  await prisma.providerChecklist.update({
    where: { providerId },
    data: {
      [`${slot}Status`]: caqhApproved ? 'approved' : 'pending_review',
      [`${slot}DocumentId`]: documentId,
      ...(caqhApproved ? { [`${slot}ReviewedAt`]: new Date(), [`${slot}ReviewedBy`]: 'caqh-import' } : {}),
    },
  });
}

export interface CaqhDocumentImportSummary {
  total: number;
  imported: number;
  skippedAlreadyImported: number;
  unclassified: number;
  linked: number;
  failed: number;
}

/**
 * CAQH-first onboarding PR 3: pull the provider's actual documents out of CAQH
 * and into our document system (instead of streaming them to the browser and
 * losing them).
 *
 * Idempotent: the S3 key is derived from a hash of the CAQH document URL, so
 * re-runs skip documents that were already imported.
 */
export async function importCaqhDocuments(providerId: string): Promise<CaqhDocumentImportSummary> {
  const provider = await prisma.providerProfile.findUnique({
    where: { id: providerId },
    select: { id: true, caqhProviderId: true, practiceId: true },
  });
  if (!provider?.caqhProviderId) {
    throw new Error('Provider has no CAQH Provider ID');
  }

  const docs = await getCaqhService().getDocumentsList(provider.caqhProviderId);
  const summary: CaqhDocumentImportSummary = {
    total: docs.length,
    imported: 0,
    skippedAlreadyImported: 0,
    unclassified: 0,
    linked: 0,
    failed: 0,
  };

  for (const doc of docs) {
    try {
      const fingerprint = createHash('sha256').update(doc.DocumentURL).digest('hex').slice(0, 16);

      const existing = await prisma.document.findFirst({
        where: { providerId, s3Key: { contains: `/caqh/${fingerprint}` } },
        select: { id: true },
      });
      if (existing) {
        summary.skippedAlreadyImported += 1;
        continue;
      }

      const { type, classified } = mapCaqhDocumentType(doc.DocumentTypeName);
      if (!classified) summary.unclassified += 1;

      const download = await getCaqhService().downloadDocument(provider.caqhProviderId, doc.DocumentURL);
      const ext = extensionFromContentType(download.contentType, download.fileName);
      const caqhApproved = doc.DocumentStatusName === 'Approved';

      const links = await findCredentialLink(providerId, type, doc);
      if (Object.keys(links).length > 0) summary.linked += 1;

      const document = await getDocumentService().saveImportedDocument({
        providerId,
        s3KeySuffix: `caqh/${fingerprint}.${ext}`,
        buffer: download.data,
        contentType: download.contentType,
        originalFileName: download.fileName || `${doc.DocumentTypeName}.${ext}`,
        documentType: type,
        description: `Imported from CAQH (${doc.DocumentTypeName}${doc.StateIdName ? `, ${doc.StateIdName}` : ''}, CAQH status: ${doc.DocumentStatusName})`,
        expirationDate: parseCaqhDate(doc.ExpirationDate),
        // CAQH-approved + confidently classified docs skip manual review;
        // everything else (unknown type, Expired, Ready for Review) gets a human.
        reviewStatus: caqhApproved && classified ? 'approved' : 'pending',
        links,
      });

      await updateChecklistSlot(providerId, type, document.id, caqhApproved);
      summary.imported += 1;
    } catch (error) {
      summary.failed += 1;
      logger.error('caqh-document-import: failed to import document', {
        providerId,
        documentType: doc.DocumentTypeName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info('caqh-document-import: finished', { providerId, ...summary });
  return summary;
}
