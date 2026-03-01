import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import type { LicenseType, DegreeType, Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { logAgentEvent } from './event-logger.js';
import { emitWorkflowEvent } from './websocket.js';
import { extractWithTextract } from './extractors/textract-extractor.js';
import { extractWithVision } from './extractors/vision-extractor.js';
import { classifyDocumentType } from './document-classifier.js';
import { mapToCredential } from './credential-mapper.js';

const CONFIDENCE_THRESHOLD = 0.90;

const PDF_MIME_TYPES = ['application/pdf'];
const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/tiff', 'image/webp'];

// PHI fields that must never be logged
const PHI_FIELDS = ['ssn', 'socialSecurityNumber', 'taxId', 'dateOfBirth', 'dob', 'npi'];

export interface DocumentJobData {
  workflowId?: string;
  taskId?: string;
  documentId: string;
  providerId: string;
  extractionHints?: string[];
}

export interface DocumentJobResult {
  status: 'completed' | 'needs_review' | 'failed';
  documentId: string;
  documentType: string;
  extractionMethod: 'textract' | 'vision' | 'none';
  confidence: number;
  fieldsExtracted: number;
  credentialId?: string;
  error?: string;
}

function createS3Client(): S3Client {
  const s3Endpoint = process.env['S3_ENDPOINT'];
  return new S3Client({
    region: process.env['AWS_REGION'] || 'us-east-1',
    ...(s3Endpoint && {
      endpoint: s3Endpoint,
      forcePathStyle: true,
    }),
    ...(process.env['AWS_ACCESS_KEY_ID'] && {
      credentials: {
        accessKeyId: process.env['AWS_ACCESS_KEY_ID'],
        secretAccessKey: process.env['AWS_SECRET_ACCESS_KEY'] || '',
      },
    }),
  });
}

/**
 * Returns true if the error message was intentionally written for end users
 * (not a raw system/AWS/Prisma error that would be confusing).
 */
function isHumanFriendly(msg: string): boolean {
  const humanPhrases = [
    'could not be found',
    'does not belong to',
    'may have been deleted',
    'need to be re-uploaded',
    'may need to be re-uploaded',
    'try again or contact support',
    'not supported',
  ];
  return humanPhrases.some((p) => msg.toLowerCase().includes(p));
}

async function downloadFromS3(s3Key: string): Promise<Buffer> {
  const client = createS3Client();
  const bucket = process.env['S3_BUCKET_NAME'] || 'credentials-documents';
  const command = new GetObjectCommand({ Bucket: bucket, Key: s3Key });
  const response = await client.send(command);
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function redactPhiFromFields(fields: Record<string, unknown>): Record<string, unknown> {
  const redacted = { ...fields };
  for (const key of PHI_FIELDS) {
    if (key in redacted) {
      redacted[key] = '[REDACTED]';
    }
  }
  return redacted;
}

// Map document type to Prisma model for credential creation
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

  dea_certificate: async (providerId, mapped) => {
    return prisma.deaRegistration.create({
      data: {
        providerId,
        deaNumber: mapped['licenseNumber'] as string, // mapper maps deaNumber→licenseNumber
        deaState: (mapped['state'] as string) ?? null,
        issueDate: mapped['issueDate'] as Date,
        expirationDate: mapped['expirationDate'] as Date,
        status: 'active',
      },
    });
  },

  diploma: async (providerId, mapped) => {
    const VALID_DEGREES: Set<string> = new Set([
      'md', 'do', 'phd', 'psyd', 'msw', 'ma', 'ms', 'med', 'dnp', 'msn', 'bs', 'ba', 'other',
    ]);
    const rawDegree = ((mapped['degree'] as string) ?? '').toLowerCase().replace(/[^a-z]/g, '');
    const degree: DegreeType = (VALID_DEGREES.has(rawDegree) ? rawDegree : 'other') as DegreeType;

    return prisma.education.create({
      data: {
        providerId,
        institutionName: mapped['institutionName'] as string,
        degree,
        fieldOfStudy: (mapped['fieldOfStudy'] as string) ?? 'Medicine',
        startDate: (mapped['graduationDate'] as Date) ?? new Date(), // startDate required, best-effort
        graduationDate: (mapped['graduationDate'] as Date) ?? null,
        isCompleted: true,
        source: 'agent_parsed',
      },
    });
  },

  cme_certificate: async (providerId, mapped) => {
    return prisma.continuingEducation.create({
      data: {
        providerId,
        courseName: mapped['courseName'] as string,
        courseProvider: mapped['courseProvider'] as string,
        credits: mapped['credits'] as number,
        creditType: (mapped['creditType'] as string) ?? 'Category 1',
        completionDate: mapped['completionDate'] as Date,
      },
    });
  },
};

/**
 * Main document agent processor.
 * Downloads document from S3, extracts fields, maps to credential schema,
 * and auto-saves if confidence >= 0.90.
 *
 * Never throws — catches all errors and returns { status: 'failed', error }.
 */
export async function processDocumentJob(data: DocumentJobData): Promise<DocumentJobResult> {
  const { workflowId, taskId, documentId, providerId } = data;

  try {
    // 1. Fetch document metadata
    const document = await prisma.document.findUnique({ where: { id: documentId } });
    if (!document) {
      throw new Error('The document record could not be found. It may have been deleted.');
    }

    // Cross-provider safety check: document must belong to the workflow's provider
    if (document.providerId !== providerId) {
      throw new Error('This document does not belong to the provider in this workflow.');
    }

    if (workflowId) {
      await logAgentEvent({
        workflowId,
        taskId,
        agent: 'document_parser',
        action: 'processing_started',
        data: { documentId, mimeType: document.mimeType, documentType: document.documentType },
      });

      emitWorkflowEvent(workflowId, 'agent:document_processing', {
        documentId,
        step: 'started',
      });
    }

    // 2. Determine document type (classify if unknown)
    let documentType: string = document.documentType;
    if (documentType === 'other') {
      documentType = await classifyDocumentType({
        textContent: `Document: ${document.originalFileName}`,
        mimeType: document.mimeType,
      });

      if (workflowId) {
        await logAgentEvent({
          workflowId,
          taskId,
          agent: 'document_parser',
          action: 'document_classified',
          data: { documentId, classifiedAs: documentType },
        });
      }
    }

    // 3. Download document from S3
    let buffer: Buffer;
    try {
      buffer = await downloadFromS3(document.s3Key);
    } catch (s3Err) {
      logger.error('S3 download failed', { s3Key: document.s3Key, error: (s3Err as Error).message });
      throw new Error(`The file for "${document.originalFileName}" could not be found in storage. It may need to be re-uploaded.`);
    }

    // 4. Extract fields based on MIME type
    let extractionMethod: 'textract' | 'vision' | 'none' = 'none';
    let extractedFields: Record<string, { value: string; confidence: number }> = {};
    let averageConfidence = 0;

    if (PDF_MIME_TYPES.includes(document.mimeType)) {
      extractionMethod = 'textract';
      const result = await extractWithTextract(buffer);
      extractedFields = result.fields;
      averageConfidence = result.averageConfidence;
    } else if (IMAGE_MIME_TYPES.includes(document.mimeType)) {
      extractionMethod = 'vision';
      const imageBase64 = buffer.toString('base64');
      const result = await extractWithVision({
        imageBase64,
        mimeType: document.mimeType,
        documentType,
        extractionHints: data.extractionHints,
      });
      extractedFields = result.fields;
      averageConfidence = result.averageConfidence;
    }

    if (workflowId) {
      emitWorkflowEvent(workflowId, 'agent:document_extracted', {
        documentId,
        method: extractionMethod,
        fieldCount: Object.keys(extractedFields).length,
        confidence: averageConfidence,
      });
    }

    // 5. Map to credential schema
    const mapping = mapToCredential(documentType, extractedFields);

    if (workflowId) {
      await logAgentEvent({
        workflowId,
        taskId,
        agent: 'document_parser',
        action: 'fields_mapped',
        data: redactPhiFromFields({
          documentId,
          documentType,
          fieldCount: Object.keys(mapping.mapped).length,
          unmappedFields: mapping.unmappedFields,
          averageConfidence,
        }) as Prisma.InputJsonValue,
      });
    }

    // 6. Save or flag for review based on confidence
    let credentialId: string | undefined;

    if (averageConfidence >= CONFIDENCE_THRESHOLD && Object.keys(mapping.mapped).length > 0) {
      const creator = CREDENTIAL_CREATORS[documentType];
      if (creator) {
        try {
          const credential = await creator(providerId, mapping.mapped);
          credentialId = credential.id;

          if (workflowId) {
            await logAgentEvent({
              workflowId,
              taskId,
              agent: 'document_parser',
              action: 'credential_saved',
              data: { documentId, credentialId, documentType, confidence: averageConfidence },
            });
          }

          // Update document OCR status
          await prisma.document.update({
            where: { id: documentId },
            data: {
              ocrStatus: 'completed',
              ocrConfidence: averageConfidence,
              ocrData: extractedFields as unknown as Prisma.InputJsonValue,
            },
          });
        } catch (err) {
          logger.error('Failed to save credential', {
            error: (err as Error).message,
            documentId,
          });
          // Fall through to needs_review
        }
      }
    }

    const status = credentialId ? 'completed' : 'needs_review';

    // 7. Update task output
    if (taskId) {
      await prisma.agentTask.update({
        where: { id: taskId },
        data: {
          status: status === 'completed' ? 'completed' : 'in_progress',
          output: {
            documentId,
            documentType,
            extractionMethod,
            confidence: averageConfidence,
            fieldsExtracted: Object.keys(extractedFields).length,
            credentialId: credentialId ?? null,
            mappedData: redactPhiFromFields(mapping.mapped) as Prisma.InputJsonValue,
            needsReview: status === 'needs_review',
          } as Prisma.InputJsonValue,
        },
      });
    }

    if (workflowId) {
      emitWorkflowEvent(workflowId, 'agent:document_complete', {
        documentId,
        status,
        confidence: averageConfidence,
        credentialId,
      });
    }

    return {
      status,
      documentId,
      documentType,
      extractionMethod,
      confidence: averageConfidence,
      fieldsExtracted: Object.keys(extractedFields).length,
      credentialId,
    };
  } catch (err) {
    const rawError = (err as Error).message;
    logger.error('Document agent failed', { error: rawError, documentId });

    // Show human-friendly message to users; keep technical details in logs only
    const userMessage = isHumanFriendly(rawError)
      ? rawError
      : 'Something went wrong while processing this document. Please try again or contact support.';

    // Update task status to failed so the UI reflects reality
    if (taskId) {
      await prisma.agentTask.update({
        where: { id: taskId },
        data: {
          status: 'failed',
          error: userMessage,
          completedAt: new Date(),
        },
      }).catch((e) => logger.error('Failed to update task status', { taskId, error: (e as Error).message }));
    }

    if (workflowId) {
      await logAgentEvent({
        workflowId,
        taskId,
        agent: 'document_parser',
        action: 'processing_failed',
        data: { documentId, error: rawError }, // raw error for debugging in event log
        level: 'error',
      });

      emitWorkflowEvent(workflowId, 'agent:document_failed', {
        documentId,
        error: userMessage,
      });
    }

    return {
      status: 'failed',
      documentId,
      documentType: 'other',
      extractionMethod: 'none',
      confidence: 0,
      fieldsExtracted: 0,
      error: userMessage,
    };
  }
}
