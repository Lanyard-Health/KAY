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
import { v4 as uuid } from 'uuid';
import type { DocumentType, Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { classifyDocumentType } from '../agents/document-classifier.js';
import { extractWithVision } from '../agents/extractors/vision-extractor.js';
import type {
  UploadUrlRequestInput,
  PracticeUploadUrlRequestInput,
} from '@credential-management/shared';

export class DocumentService {
  private s3: S3Client;
  private bucket: string;
  private documentsPrefix: string;

  constructor() {
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

  /**
   * Server-side practice-document upload. The browser POSTs the file to our API
   * and the backend PUTs it to storage — so the browser never talks to R2
   * directly, sidestepping the R2-CORS / CSP-connect-src wall that made the
   * presigned-PUT flow spin forever. One round trip, file is in storage and the
   * row exists when this resolves.
   */
  async uploadPracticeDocument(
    practiceId: string,
    params: { buffer: Buffer; fileName: string; contentType: string; documentType?: string },
    userId: string
  ) {
    const practice = await prisma.practice.findUnique({
      where: { id: practiceId },
      select: { id: true },
    });
    if (!practice) {
      throw new Error('Practice not found');
    }

    const documentId = uuid();
    const fileExtension = (params.fileName.split('.').pop() || '').replace(/[^a-zA-Z0-9]/g, '');
    const s3Key = `${this.documentsPrefix}practices/${practiceId}/${documentId}.${fileExtension}`;
    // Route validates documentType against the DocumentType enum before calling.
    const documentType = (params.documentType ?? 'other') as DocumentType;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: s3Key,
        Body: params.buffer,
        ContentType: params.contentType,
        Metadata: {
          'document-id': documentId,
          'practice-id': practiceId,
          'document-type': documentType,
        },
      })
    );

    const willOcr = this.shouldRunOcr(params.contentType) && process.env['USE_LOCALSTACK'] !== 'true';

    const document = await prisma.document.create({
      data: {
        id: documentId,
        practiceId,
        providerId: null,
        fileName: `${documentId}.${fileExtension}`,
        originalFileName: params.fileName,
        fileSize: params.buffer.length,
        mimeType: params.contentType,
        s3Key,
        documentType,
        // 'pending' if we're about to OCR (the list polls until it settles);
        // 'not_applicable' for unsupported types so the list doesn't poll forever.
        ocrStatus: willOcr ? 'pending' : 'not_applicable',
        createdById: userId,
      },
    });

    if (willOcr) void this.runOcr(documentId);
    return document;
  }

  /**
   * Server-side ingestion path (CAQH document import): PUT a buffer we already
   * hold straight to storage and create the Document row in one step — no
   * presigned URL round-trip, no confirmUpload. The caller supplies a
   * deterministic s3KeySuffix so re-imports can detect already-saved files.
   */
  async saveImportedDocument(params: {
    providerId: string;
    s3KeySuffix: string;
    buffer: Buffer;
    contentType: string;
    originalFileName: string;
    documentType: DocumentType;
    description?: string;
    expirationDate?: Date | null;
    reviewStatus?: 'approved' | 'pending';
    links?: Partial<{
      linkedLicenseId: string;
      linkedBoardCertificationId: string;
      linkedMalpracticeInsuranceId: string;
    }>;
  }): Promise<{ id: string; s3Key: string }> {
    const documentId = uuid();
    const s3Key = `${this.documentsPrefix}${params.providerId}/${params.s3KeySuffix}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: s3Key,
        Body: params.buffer,
        ContentType: params.contentType,
        Metadata: {
          'document-id': documentId,
          'provider-id': params.providerId,
          'document-type': params.documentType,
          source: 'caqh-import',
        },
      })
    );

    const willOcr = this.shouldRunOcr(params.contentType) && process.env['USE_LOCALSTACK'] !== 'true';

    const document = await prisma.document.create({
      data: {
        id: documentId,
        providerId: params.providerId,
        fileName: params.s3KeySuffix.split('/').pop() || params.s3KeySuffix,
        originalFileName: params.originalFileName,
        fileSize: params.buffer.length,
        mimeType: params.contentType,
        s3Key,
        documentType: params.documentType,
        description: params.description,
        expirationDate: params.expirationDate ?? undefined,
        ocrStatus: willOcr ? 'pending' : 'not_applicable',
        reviewStatus: params.reviewStatus ?? 'pending',
        ...(params.links ?? {}),
      },
      select: { id: true, s3Key: true },
    });

    // CAQH imports a batch of docs in a loop; each kicks an independent Haiku
    // read. ponytail: fire-and-forget burst — fine at import volumes (callLLM
    // already retries on 429). Add a queue if a single import ever exceeds ~50 docs.
    if (willOcr) void this.runOcr(document.id);
    return document;
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
        // Fire-and-forget: don't block the upload-confirm response on OCR.
        // runOcr flips the status pending → processing → completed itself; the
        // document list polls while it's in flight.
        void this.runOcr(documentId);
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

  // Inline rendering is XSS-safe only for these types. Anything else (HTML, SVG,
  // etc.) must NOT render inline in the browser, so it falls back to attachment.
  private static readonly INLINE_SAFE_MIME_TYPES = new Set([
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/tiff',
  ]);

  /**
   * Presigned URL for INLINE preview (the eye/"View" button). For pdf/image
   * types it sets Content-Disposition: inline so the browser renders it in the
   * preview pane instead of downloading it. For any other type it falls back to
   * attachment — never render untrusted HTML/SVG inline. Distinct from
   * getDownloadUrl, which always forces a download.
   */
  async getViewUrl(s3Key: string, mimeType: string): Promise<string> {
    const fileName = s3Key.split('/').pop() || 'document';
    const inlineSafe = DocumentService.INLINE_SAFE_MIME_TYPES.has(mimeType);
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: s3Key,
      ResponseContentDisposition: inlineSafe ? 'inline' : `attachment; filename="${fileName}"`,
      ...(inlineSafe && { ResponseContentType: mimeType }),
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

  // Claude vision can read these directly. Textract's old list included tiff,
  // which Claude vision doesn't accept — dropped.
  private static readonly OCR_SUPPORTED_TYPES = new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
  ]);

  private shouldRunOcr(mimeType: string): boolean {
    return DocumentService.OCR_SUPPORTED_TYPES.has(mimeType);
  }

  private async downloadObject(s3Key: string): Promise<Buffer> {
    const response = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: s3Key })
    );
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  /**
   * Claude-based OCR. Reads the file straight from R2 and extracts credential
   * fields with Claude vision (Haiku by default — cheapest vision tier, set via
   * AI_MODEL_VISION). Replaces the old Textract path, which couldn't read R2 at
   * all (R2 lives in Cloudflare; Textract is AWS-only).
   *
   * Never throws — marks the document `failed` on any error — so every caller
   * can fire-and-forget it without an unhandled rejection.
   */
  async runOcr(documentId: string): Promise<void> {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, s3Key: true, mimeType: true, documentType: true, providerId: true },
    });
    if (!document) {
      logger.warn(`runOcr: document ${documentId} not found`);
      return;
    }
    if (!this.shouldRunOcr(document.mimeType)) {
      await prisma.document.update({
        where: { id: documentId },
        data: { ocrStatus: 'not_applicable' },
      });
      return;
    }

    try {
      await prisma.document.update({
        where: { id: documentId },
        data: { ocrStatus: 'processing' },
      });

      const buffer = await this.downloadObject(document.s3Key);
      const { fields, averageConfidence } = await extractWithVision({
        imageBase64: buffer.toString('base64'),
        mimeType: document.mimeType,
        documentType: document.documentType,
      });
      const fieldCount = Object.keys(fields).length;

      // Auto-classify practice-scoped docs still tagged 'other' (provider docs
      // upload with an explicit type). Reuses the text we just extracted, so no
      // extra image tokens. classifyDocumentType never throws — returns 'other'
      // on any failure — so OCR completion is unaffected on classifier error.
      let classifiedType: DocumentType | undefined;
      if (!document.providerId && document.documentType === 'other' && fieldCount > 0) {
        const textContent = Object.entries(fields)
          .map(([k, v]) => `${k}: ${v.value}`)
          .join('\n');
        classifiedType = await classifyDocumentType({ textContent, mimeType: 'text/plain' });
      }

      await prisma.document.update({
        where: { id: documentId },
        data: {
          // No fields read → leave it for a human rather than claim 'completed'.
          ocrStatus: fieldCount > 0 ? 'completed' : 'needs_review',
          ocrData: fields as unknown as Prisma.InputJsonValue,
          ocrConfidence: averageConfidence,
          ...(classifiedType && classifiedType !== 'other' && { documentType: classifiedType }),
        },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'OCR failed';
      logger.error('Claude OCR failed', { documentId, reason });
      await prisma.document
        .update({
          where: { id: documentId },
          data: { ocrStatus: 'failed', ocrData: { failureReason: reason } },
        })
        .catch(() => {/* swallow — fire-and-forget, already logged */});
    }
  }
}
