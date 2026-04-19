import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { prisma } from '../../utils/prisma.js';
import { logger } from '../../utils/logger.js';
import { buildPacket } from '../credentialing-packet.service.js';
import { resolveRecipe, type RecipeField, type RecipeFieldMapping } from './recipe-resolver.js';
import { fillPdfForm, type PdfFillLogEntry } from './pdf-engine.js';

/**
 * PDF Fill Runner — end-to-end orchestration for one PayerForm fill.
 *
 * Responsibilities:
 *   1. Create (or advance) an EnrollmentRun record
 *   2. Load the form's recipe (fields + mappings) from the DB
 *   3. Build the CredentialingPacket for the enrollment's provider + payer
 *   4. Resolve the recipe against the packet
 *   5. Pull the template PDF from S3 (PayerForm.assetUrl)
 *   6. Hand the bytes + resolved fields to pdf-engine
 *   7. Upload the filled PDF back to S3 under a deterministic key
 *   8. Update the EnrollmentRun with artifact metadata + status
 *
 * Storage is injected (`StorageAdapter`) so tests can stub S3 without
 * bringing up LocalStack and so future phases can swap in different
 * backends (e.g. Cloudflare R2 via s3-compatible API).
 */

// ─── Storage adapter ────────────────────────────────────────────────────

export interface StorageAdapter {
  download(key: string): Promise<Uint8Array>;
  upload(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
}

function buildDefaultStorage(): StorageAdapter {
  const bucket = process.env['S3_BUCKET_NAME'] || 'credentials-documents';
  const s3Endpoint = process.env['S3_ENDPOINT'];
  const client = new S3Client({
    region: process.env['AWS_REGION'] || 'us-east-1',
    ...(s3Endpoint && { endpoint: s3Endpoint, forcePathStyle: true }),
    ...(process.env['AWS_ACCESS_KEY_ID'] && {
      credentials: {
        accessKeyId: process.env['AWS_ACCESS_KEY_ID'],
        secretAccessKey: process.env['AWS_SECRET_ACCESS_KEY'] || '',
      },
    }),
  });
  return {
    async download(key: string) {
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const stream = res.Body as any;
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk as Buffer);
      return new Uint8Array(Buffer.concat(chunks));
    },
    async upload(key: string, bytes: Uint8Array, contentType: string) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: Buffer.from(bytes),
          ContentType: contentType,
        })
      );
    },
  };
}

// ─── Inputs / outputs ───────────────────────────────────────────────────

export interface RunPdfFillInput {
  enrollmentId: string;
  payerFormId: string;
  triggeredBy?: string;
  /** Reuse an existing EnrollmentRun (e.g. a multi-form run adding another artifact). */
  enrollmentRunId?: string;
  storage?: StorageAdapter;
}

export interface PdfFillArtifact {
  payerFormId: string;
  engine: 'pdf';
  filledS3Key: string;
  fieldLog: PdfFillLogEntry[];
  filledCount: number;
  skippedCount: number;
}

export interface RunPdfFillResult {
  enrollmentRunId: string;
  artifact: PdfFillArtifact;
  missingRequired: string[]; // fieldKeys of required fields that had no source value
}

// ─── Recipe loader ──────────────────────────────────────────────────────

async function loadRecipe(payerFormId: string): Promise<RecipeField[]> {
  const fields = await prisma.payerFormField.findMany({
    where: { payerFormId },
    include: { mappings: true },
    orderBy: { orderIndex: 'asc' },
  });
  return fields.map((f) => ({
    id: f.id,
    fieldKey: f.fieldKey,
    fieldLabel: f.fieldLabel,
    fieldType: f.fieldType,
    required: f.required,
    validationRegex: f.validationRegex,
    mappings: f.mappings.map<RecipeFieldMapping>((m) => ({
      sourceKind: m.sourceKind as RecipeFieldMapping['sourceKind'],
      sourcePath: m.sourcePath,
      transform: (m.transform as RecipeFieldMapping['transform']) ?? null,
      fallbackValue: m.fallbackValue,
      priority: m.priority,
    })),
  }));
}

// ─── Main runner ────────────────────────────────────────────────────────

export async function runPdfFill(input: RunPdfFillInput): Promise<RunPdfFillResult> {
  const { enrollmentId, payerFormId, triggeredBy } = input;
  const storage = input.storage ?? buildDefaultStorage();

  // 1. Create or reuse an EnrollmentRun
  const run = input.enrollmentRunId
    ? await prisma.enrollmentRun.update({
        where: { id: input.enrollmentRunId },
        data: { status: 'filling' },
      })
    : await prisma.enrollmentRun.create({
        data: {
          enrollmentId,
          status: 'filling',
          triggeredBy: triggeredBy ?? null,
        },
      });

  try {
    // 2. Load enrollment → (providerId, payerId)
    const enrollment = await prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      select: { providerId: true, payerId: true },
    });
    if (!enrollment) {
      throw new Error(`Enrollment ${enrollmentId} not found`);
    }

    // 3. Load the PayerForm and verify it's a PDF form with a template
    const payerForm = await prisma.payerForm.findUnique({
      where: { id: payerFormId },
      select: { id: true, formName: true, deliveryEngine: true, assetUrl: true },
    });
    if (!payerForm) {
      throw new Error(`PayerForm ${payerFormId} not found`);
    }
    if (payerForm.deliveryEngine !== 'pdf') {
      throw new Error(
        `PayerForm ${payerFormId} deliveryEngine is ${payerForm.deliveryEngine ?? 'null'}, expected 'pdf'`
      );
    }
    if (!payerForm.assetUrl) {
      throw new Error(`PayerForm ${payerFormId} has no assetUrl (PDF template key)`);
    }

    // 4. Load recipe + build packet + resolve
    const [recipe, packet] = await Promise.all([
      loadRecipe(payerFormId),
      buildPacket(enrollment.providerId, enrollment.payerId, { decryptSensitive: true }),
    ]);

    const resolved = resolveRecipe(recipe, packet);

    // 5. Download template bytes
    const templateBytes = await storage.download(payerForm.assetUrl);

    // 6. Fill the PDF
    const fillResult = await fillPdfForm(templateBytes, resolved.fields);

    // 7. Upload filled PDF to a deterministic key
    const filledS3Key = `filled/${run.id}/${payerFormId}.pdf`;
    await storage.upload(filledS3Key, fillResult.filledBytes, 'application/pdf');

    // 8. Build artifact + update EnrollmentRun
    const artifact: PdfFillArtifact = {
      payerFormId,
      engine: 'pdf',
      filledS3Key,
      fieldLog: fillResult.log,
      filledCount: fillResult.filledCount,
      skippedCount: fillResult.skippedCount,
    };

    const existing = Array.isArray(run.filledArtifacts)
      ? (run.filledArtifacts as unknown[])
      : [];

    await prisma.enrollmentRun.update({
      where: { id: run.id },
      data: {
        status: 'awaiting_review',
        filledArtifacts: [...existing, artifact as unknown as object] as any,
      },
    });

    logger.info(
      `pdf-fill-runner: enrollmentRun ${run.id} filled ${fillResult.filledCount} / skipped ${fillResult.skippedCount} for form ${payerForm.formName}`
    );

    return {
      enrollmentRunId: run.id,
      artifact,
      missingRequired: resolved.missingRequired.map((f) => f.fieldKey),
    };
  } catch (err: unknown) {
    await prisma.enrollmentRun.update({
      where: { id: run.id },
      data: {
        status: 'failed',
        errorDetails: {
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        } as any,
      },
    });
    throw err;
  }
}
