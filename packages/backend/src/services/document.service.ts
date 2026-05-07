import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  PutBucketCorsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  TextractClient,
  StartDocumentAnalysisCommand,
  GetDocumentAnalysisCommand,
} from '@aws-sdk/client-textract';
import { v4 as uuid } from 'uuid';
import type { DocumentType } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { classifyDocumentType } from '../agents/document-classifier.js';
import type {
  UploadUrlRequestInput,
  PracticeUploadUrlRequestInput,
} from '@credential-management/shared';

export class DocumentService {
  private s3: S3Client;
  private textract: TextractClient;
  private bucket: string;
  private documentsPrefix: string;

  constructor() {
    const isLocalStack = process.env['USE_LOCALSTACK'] === 'true';
    const s3Endpoint = process.env['S3_ENDPOINT'];

    this.s3 = new S3Client({
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
    this.textract = new TextractClient({
      region: process.env['AWS_REGION'] || 'us-east-1',
      ...(isLocalStack && s3Endpoint && {
        endpoint: s3Endpoint,
        credentials: {
          accessKeyId: process.env['AWS_ACCESS_KEY_ID'] || 'test',
          secretAccessKey: process.env['AWS_SECRET_ACCESS_KEY'] || 'test',
        },
      }),
    });
    this.bucket = process.env['S3_BUCKET_NAME'] || 'credentials-documents';
    this.documentsPrefix = process.env['S3_DOCUMENTS_PREFIX'] || 'documents/';

    this.ensureBucketExists();
  }

  private async ensureBucketExists(): Promise<void> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      logger.info(`S3 bucket "${this.bucket}" not found, creating...`);
      try {
        await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
        logger.info(`S3 bucket "${this.bucket}" created`);
      } catch (createError) {
        logger.error(`Failed to create S3 bucket "${this.bucket}"`, createError);
      }
    }

    // Always ensure CORS is set (covers existing buckets and new ones)
    try {
      const frontendUrl = process.env['FRONTEND_URL'] || 'http://localhost:5190';
      await this.s3.send(new PutBucketCorsCommand({
        Bucket: this.bucket,
        CORSConfiguration: {
          CORSRules: [{
            AllowedHeaders: ['*'],
            AllowedMethods: ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'],
            AllowedOrigins: [frontendUrl, 'http://localhost:5190'],
            ExposeHeaders: ['ETag'],
            MaxAgeSeconds: 3600,
          }],
        },
      }));
      logger.info(`S3 bucket CORS configured for ${frontendUrl}`);
    } catch (corsError) {
      logger.error('Failed to set S3 bucket CORS', corsError);
    }
  }

  async getUploadUrl(
    data: UploadUrlRequestInput,
    userId: string
  ): Promise<{
    uploadUrl: string;
    documentId: string;
    s3Key: string;
    expiresAt: Date;
  }> {
    const documentId = uuid();
    const fileExtension = (data.fileName.split('.').pop() || '').replace(/[^a-zA-Z0-9]/g, '');
    const s3Key = `${this.documentsPrefix}${data.providerId}/${documentId}.${fileExtension}`;

    // Create document record
    await prisma.document.create({
      data: {
        id: documentId,
        providerId: data.providerId,
        fileName: `${documentId}.${fileExtension}`,
        originalFileName: data.fileName,
        fileSize: 0, // Will be updated after upload
        mimeType: data.contentType,
        s3Key,
        documentType: data.documentType,
        ocrStatus: 'pending',
        createdById: userId,
      },
    });

    // Generate pre-signed URL
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: s3Key,
      ContentType: data.contentType,
      Metadata: {
        'document-id': documentId,
        'provider-id': data.providerId,
        'document-type': data.documentType,
      },
    });

    const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn: 3600 });
    const expiresAt = new Date(Date.now() + 3600 * 1000);

    return {
      uploadUrl,
      documentId,
      s3Key,
      expiresAt,
    };
  }

  /**
   * Mirror of getUploadUrl for practice-scoped documents.
   *
   * S3 key prefix: documents/practices/{practiceId}/{documentId}.{ext}
   * Document row is created with practiceId set and providerId NULL — the XOR
   * check constraint on the documents table guarantees this invariant.
   *
   * documentType defaults to 'other' when not provided; the OCR pipeline will
   * classify and update it.
   */
  async getPracticeUploadUrl(
    practiceId: string,
    data: PracticeUploadUrlRequestInput,
    userId: string
  ): Promise<{
    uploadUrl: string;
    documentId: string;
    s3Key: string;
    expiresAt: Date;
  }> {
    // Validate practice exists before creating any S3 / DB resources
    const practice = await prisma.practice.findUnique({
      where: { id: practiceId },
      select: { id: true },
    });
    if (!practice) {
      throw new Error('Practice not found');
    }

    const documentId = uuid();
    const fileExtension = (data.fileName.split('.').pop() || '').replace(/[^a-zA-Z0-9]/g, '');
    const s3Key = `${this.documentsPrefix}practices/${practiceId}/${documentId}.${fileExtension}`;
    const documentType = data.documentType ?? 'other';

    await prisma.document.create({
      data: {
        id: documentId,
        practiceId,
        providerId: null,
        fileName: `${documentId}.${fileExtension}`,
        originalFileName: data.fileName,
        fileSize: 0,
        mimeType: data.contentType,
        s3Key,
        documentType,
        ocrStatus: 'pending',
        createdById: userId,
      },
    });

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: s3Key,
      ContentType: data.contentType,
      Metadata: {
        'document-id': documentId,
        'practice-id': practiceId,
        'document-type': documentType,
      },
    });

    const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn: 3600 });
    const expiresAt = new Date(Date.now() + 3600 * 1000);

    return { uploadUrl, documentId, s3Key, expiresAt };
  }

  async confirmUpload(documentId: string): Promise<any> {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      throw new Error('Document not found');
    }

    // Get file size from S3
    const headCommand = new GetObjectCommand({
      Bucket: this.bucket,
      Key: document.s3Key,
    });

    try {
      const response = await this.s3.send(headCommand);
      const fileSize = response.ContentLength || 0;

      // Update document with file size
      const updatedDocument = await prisma.document.update({
        where: { id: documentId },
        data: { fileSize },
      });

      // Link checklist documents (W9, COI, CP575) to the provider's checklist.
      // Practice-scoped documents (providerId NULL) have no ProviderChecklist row to link into.
      if (document.providerId) {
        await this.linkChecklistDocument(document.providerId, document.documentType, documentId);
      }

      // Trigger OCR if applicable (skip in LocalStack/development mode)
      const isLocalStack = process.env['USE_LOCALSTACK'] === 'true';
      if (isLocalStack) {
        // LocalStack doesn't support Textract, mark as not applicable
        await prisma.document.update({
          where: { id: documentId },
          data: { ocrStatus: 'not_applicable' },
        });
      } else if (this.shouldRunOcr(document.mimeType)) {
        await this.startOcrProcessing(documentId, document.s3Key);
      } else {
        await prisma.document.update({
          where: { id: documentId },
          data: { ocrStatus: 'not_applicable' },
        });
      }

      return updatedDocument;
    } catch (error) {
      logger.error('Failed to confirm upload', error);
      throw new Error('Failed to confirm upload - file may not exist');
    }
  }

  private async linkChecklistDocument(
    providerId: string,
    documentType: string,
    documentId: string
  ): Promise<void> {
    const checklistDocTypes = ['w9', 'coi', 'cp575'];
    if (!checklistDocTypes.includes(documentType)) {
      return;
    }

    // Find or create the provider's checklist
    let checklist = await prisma.providerChecklist.findUnique({
      where: { providerId },
    });

    if (!checklist) {
      checklist = await prisma.providerChecklist.create({
        data: { providerId },
      });
    }

    // Update the appropriate document ID and status
    const updateData: Record<string, unknown> = {};

    if (documentType === 'w9') {
      updateData['w9DocumentId'] = documentId;
      updateData['w9Status'] = 'pending_review';
    } else if (documentType === 'coi') {
      updateData['coiDocumentId'] = documentId;
      updateData['coiStatus'] = 'pending_review';
    } else if (documentType === 'cp575') {
      updateData['cp575DocumentId'] = documentId;
      updateData['cp575Status'] = 'pending_review';
    }

    await prisma.providerChecklist.update({
      where: { providerId },
      data: updateData,
    });

    logger.info(`Linked ${documentType} document ${documentId} to checklist for provider ${providerId}`);
  }

  async getDownloadUrl(s3Key: string): Promise<string> {
    // Extract filename from s3Key for Content-Disposition header
    const fileName = s3Key.split('/').pop() || 'document';
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: s3Key,
      // Force download — prevents inline rendering of HTML/SVG (XSS prevention)
      ResponseContentDisposition: `attachment; filename="${fileName}"`,
    });

    return getSignedUrl(this.s3, command, { expiresIn: 3600 });
  }

  async deleteDocument(s3Key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: s3Key,
    });

    await this.s3.send(command);
  }

  private shouldRunOcr(mimeType: string): boolean {
    const ocrSupportedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/tiff',
    ];
    return ocrSupportedTypes.includes(mimeType);
  }

  async startOcrProcessing(documentId: string, s3Key: string): Promise<void> {
    try {
      // Update status to processing
      await prisma.document.update({
        where: { id: documentId },
        data: { ocrStatus: 'processing' },
      });

      // Start Textract analysis
      const command = new StartDocumentAnalysisCommand({
        DocumentLocation: {
          S3Object: {
            Bucket: this.bucket,
            Name: s3Key,
          },
        },
        FeatureTypes: ['FORMS', 'TABLES'],
        NotificationChannel: process.env['TEXTRACT_SNS_TOPIC_ARN']
          ? {
              SNSTopicArn: process.env['TEXTRACT_SNS_TOPIC_ARN'],
              RoleArn: process.env['TEXTRACT_SNS_ROLE_ARN']!,
            }
          : undefined,
      });

      const response = await this.textract.send(command);

      if (response.JobId) {
        // Store job ID for tracking
        await prisma.document.update({
          where: { id: documentId },
          data: {
            ocrData: { jobId: response.JobId, startedAt: new Date().toISOString() },
          },
        });

        // If not using SNS notifications, poll for results
        if (!process.env['TEXTRACT_SNS_TOPIC_ARN']) {
          this.pollOcrResults(documentId, response.JobId);
        }
      }
    } catch (error) {
      logger.error('Failed to start OCR processing', error);
      await prisma.document.update({
        where: { id: documentId },
        data: { ocrStatus: 'failed' },
      });
    }
  }

  private async pollOcrResults(documentId: string, jobId: string): Promise<void> {
    let attempts = 0;
    const maxAttempts = 60; // 5 minutes with 5 second intervals

    const poll = async () => {
      attempts++;

      try {
        const command = new GetDocumentAnalysisCommand({ JobId: jobId });
        const response = await this.textract.send(command);

        if (response.JobStatus === 'SUCCEEDED') {
          await this.processOcrResults(documentId, response);
        } else if (response.JobStatus === 'FAILED') {
          await prisma.document.update({
            where: { id: documentId },
            data: { ocrStatus: 'failed' },
          });
        } else if (attempts < maxAttempts) {
          // Still processing, poll again
          setTimeout(poll, 5000);
        } else {
          // Timeout
          await prisma.document.update({
            where: { id: documentId },
            data: { ocrStatus: 'failed' },
          });
        }
      } catch (error) {
        logger.error('OCR polling error', error);
        await prisma.document.update({
          where: { id: documentId },
          data: { ocrStatus: 'failed' },
        });
      }
    };

    // Start polling after initial delay
    setTimeout(poll, 5000);
  }

  private async processOcrResults(documentId: string, response: any): Promise<void> {
    const extractedFields: Record<string, { value: string; confidence: number }> = {};
    let totalConfidence = 0;
    let fieldCount = 0;

    // Process Textract blocks
    for (const block of response.Blocks || []) {
      if (block.BlockType === 'KEY_VALUE_SET' && block.EntityTypes?.includes('KEY')) {
        const keyText = this.getTextFromBlock(block, response.Blocks);
        const valueBlock = this.getValueBlock(block, response.Blocks);

        if (valueBlock) {
          const valueText = this.getTextFromBlock(valueBlock, response.Blocks);
          const confidence = (block.Confidence || 0) / 100;

          if (keyText && valueText) {
            // eslint-disable-next-line security/detect-object-injection -- keyText is a Textract OCR label, stored as JSON blob
            extractedFields[keyText] = {
              value: valueText,
              confidence,
            };
            totalConfidence += confidence;
            fieldCount++;
          }
        }
      }
    }

    const avgConfidence = fieldCount > 0 ? totalConfidence / fieldCount : 0;

    // Auto-classify practice-scoped documents whose type is still 'other'.
    // Provider-doc behavior is unchanged: provider docs already pass an
    // explicit documentType at upload time. We only run the classifier when
    // (a) the doc is practice-scoped and (b) it's still tagged 'other' and
    // (c) Textract gave us at least one field to work with. The classifier
    // never throws — it returns 'other' on any failure (network, timeout,
    // missing API key) — so OCR completion is unaffected on classifier error.
    let classifiedType: DocumentType | undefined;
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      select: { providerId: true, documentType: true },
    });
    if (
      document &&
      !document.providerId &&
      document.documentType === 'other' &&
      fieldCount > 0
    ) {
      const textContent = Object.entries(extractedFields)
        .map(([k, v]) => `${k}: ${v.value}`)
        .join('\n');
      classifiedType = await classifyDocumentType({
        textContent,
        mimeType: 'text/plain',
      });
    }

    await prisma.document.update({
      where: { id: documentId },
      data: {
        ocrStatus: 'completed',
        ocrData: extractedFields,
        ocrConfidence: avgConfidence,
        ...(classifiedType && classifiedType !== 'other' && { documentType: classifiedType }),
      },
    });
  }

  private getTextFromBlock(block: any, allBlocks: any[]): string {
    if (block.Text) return block.Text;

    const childIds = block.Relationships?.find((r: any) => r.Type === 'CHILD')?.Ids || [];
    const childBlocks = allBlocks.filter((b: any) => childIds.includes(b.Id));

    return childBlocks
      .filter((b: any) => b.BlockType === 'WORD')
      .map((b: any) => b.Text)
      .join(' ');
  }

  private getValueBlock(keyBlock: any, allBlocks: any[]): any {
    const valueRelation = keyBlock.Relationships?.find((r: any) => r.Type === 'VALUE');
    if (!valueRelation) return null;

    return allBlocks.find((b: any) => valueRelation.Ids.includes(b.Id));
  }

  // Handle SNS notification for completed OCR job
  async handleOcrNotification(jobId: string): Promise<void> {
    // Find document by job ID
    const documents = await prisma.document.findMany({
      where: {
        ocrData: {
          path: ['jobId'],
          equals: jobId,
        },
      },
    });

    if (documents.length === 0) {
      logger.warn(`No document found for OCR job ${jobId}`);
      return;
    }

    const document = documents[0]!;

    const command = new GetDocumentAnalysisCommand({ JobId: jobId });
    const response = await this.textract.send(command);

    if (response.JobStatus === 'SUCCEEDED') {
      await this.processOcrResults(document.id, response);
    } else {
      await prisma.document.update({
        where: { id: document.id },
        data: { ocrStatus: 'failed' },
      });
    }
  }
}
