import type { LicenseType, Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { mapToCredential } from '../agents/credential-mapper.js';
import { logger } from '../utils/logger.js';

interface ExtractedField {
  value: string;
  confidence: number;
}

const CREDENTIAL_CREATORS: Record<
  string,
  (providerId: string, mapped: Record<string, unknown>) => Promise<{ id: string }>
> = {
  license: async (providerId, mapped) => {
    return prisma.license.create({
      data: {
        providerId,
        licenseType: ((mapped['licenseType'] as string) ?? 'state_medical') as LicenseType,
        licenseNumber: mapped['licenseNumber'] as string,
        state: (mapped['state'] as string) ?? null,
        issueDate: mapped['issueDate'] as Date,
        expirationDate: mapped['expirationDate'] as Date,
        source: 'agent_parsed',
        status: 'active',
      },
    });
  },
  board_certification: async (providerId, mapped) => {
    return prisma.boardCertification.create({
      data: {
        providerId,
        boardType: 'other',
        boardName: mapped['boardName'] as string,
        specialty: mapped['specialty'] as string,
        initialCertificationDate: mapped['initialCertificationDate'] as Date,
        expirationDate: (mapped['expirationDate'] as Date) ?? null,
        certificationNumber: (mapped['certificationNumber'] as string) ?? null,
        source: 'agent_parsed',
        status: 'active',
      },
    });
  },
  malpractice_certificate: async (providerId, mapped) => {
    return prisma.malpracticeInsurance.create({
      data: {
        providerId,
        carrierName: mapped['carrierName'] as string,
        policyNumber: mapped['policyNumber'] as string,
        coverageType: 'occurrence',
        perClaimAmount: mapped['perClaimAmount'] as number,
        aggregateAmount: mapped['aggregateAmount'] as number,
        effectiveDate: mapped['effectiveDate'] as Date,
        expirationDate: mapped['expirationDate'] as Date,
        status: 'active',
      },
    });
  },
};

// Maps document type → the linked ID field on the Document model
const LINKED_ID_FIELDS: Record<string, string> = {
  license: 'linkedLicenseId',
  dea_certificate: 'linkedLicenseId',
  board_certification: 'linkedBoardCertificationId',
  malpractice_certificate: 'linkedMalpracticeInsuranceId',
};

/**
 * Creates a credential from reviewed OCR data and links it to the document.
 * Returns the credential ID if created, or null if the document type has no creator.
 */
export async function createCredentialFromOcr(
  documentId: string,
  providerId: string,
  documentType: string,
  extractedFields: Record<string, ExtractedField>,
): Promise<string | null> {
  const creator = CREDENTIAL_CREATORS[documentType];
  if (!creator) {
    logger.info(`No credential creator for document type: ${documentType}, skipping auto-creation`);
    return null;
  }

  const { mapped } = mapToCredential(documentType, extractedFields);
  if (Object.keys(mapped).length === 0) {
    logger.warn(`No fields mapped for document ${documentId}, skipping credential creation`);
    return null;
  }

  const credential = await creator(providerId, mapped);

  // Link the credential to the document
  const linkedField = LINKED_ID_FIELDS[documentType];
  if (linkedField) {
    await prisma.document.update({
      where: { id: documentId },
      data: { [linkedField]: credential.id } as Prisma.DocumentUpdateInput,
    });
  }

  logger.info(`Created credential ${credential.id} from reviewed OCR data for document ${documentId}`);
  return credential.id;
}
