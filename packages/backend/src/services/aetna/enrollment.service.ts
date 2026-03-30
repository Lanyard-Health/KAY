import { chromium } from 'playwright';
import { prisma } from '../../utils/prisma.js';
import { logger } from '../../utils/logger.js';
import { fillAetnaForm, submitFinalPage } from './form-filler.js';
import { mapProviderToAetnaPayload, maskSensitivePayload } from './field-mapper.js';
import { holdSession, getSession, releaseSession, canLaunch } from './browser-pool.js';
import type { AetnaProviderData } from './types.js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

async function loadProviderData(providerId: string, userId: string): Promise<AetnaProviderData> {
  const provider = await prisma.providerProfile.findUnique({
    where: { id: providerId },
    include: {
      practice: true,
      practiceLocations: { where: { isPrimary: true, isActive: true }, take: 1 },
      licenses: { where: { status: 'active' }, orderBy: { expirationDate: 'desc' }, take: 1 },
      educations: { orderBy: { graduationDate: 'desc' }, take: 1 },
      hospitalAffiliations: { where: { status: 'active' } },
    },
  });

  if (!provider) throw new Error('Provider not found');

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('User not found');

  const loc = provider.practiceLocations[0] ?? null;
  const license = provider.licenses[0] ?? null;
  const edu = provider.educations[0] ?? null;

  return {
    provider: {
      id: provider.id,
      npi: provider.npi,
      firstName: provider.firstName,
      lastName: provider.lastName,
      middleName: provider.middleName,
      dateOfBirth: provider.dateOfBirth,
      gender: provider.gender,
      email: provider.email,
      phone: provider.phone,
      fax: provider.fax,
      providerType: provider.providerType,
      specialties: provider.specialties,
      languages: provider.languages,
      caqhProviderId: provider.caqhProviderId,
      acceptingMedicare: provider.acceptingMedicare,
      acceptingMedicaid: provider.acceptingMedicaid,
      ePrescribing: provider.ePrescribing,
      ssnEncrypted: provider.ssnEncrypted,
    },
    practice: provider.practice ? {
      id: provider.practice.id,
      name: provider.practice.name,
      phone: provider.practice.phone,
      email: provider.practice.email,
      website: provider.practice.website,
    } : null,
    primaryLocation: loc ? {
      addressLine1: loc.addressLine1,
      addressLine2: loc.addressLine2,
      city: loc.city,
      state: loc.state,
      zipCode: loc.zipCode,
      county: loc.county,
      phone: loc.phone,
      fax: loc.fax,
      taxIdEncrypted: loc.taxIdEncrypted,
      groupNpi: loc.groupNpi,
      acceptingNewPatients: loc.acceptingNewPatients,
      languagesSpoken: loc.languagesSpoken,
      officeHours: loc.officeHours as Record<string, unknown> | null,
      billingAddressLine1: loc.billingAddressLine1,
      billingCity: loc.billingCity,
      billingState: loc.billingState,
      billingZipCode: loc.billingZipCode,
    } : null,
    primaryLicense: license ? {
      licenseNumber: license.licenseNumber,
      state: license.state,
      expirationDate: license.expirationDate,
    } : null,
    education: edu ? { degree: edu.degree } : null,
    hospitalAffiliations: provider.hospitalAffiliations.map(ha => ({
      facilityName: ha.facilityName,
      privilegeType: ha.privilegeType,
      status: ha.status,
    })),
    submitter: {
      firstName: user.firstName ?? '',
      lastName: user.lastName ?? '',
      email: user.email,
      phone: user.phone ?? '',
    },
  };
}

function getS3Client(): S3Client {
  return new S3Client({
    region: process.env['AWS_REGION'] ?? 'us-east-1',
    ...(process.env['S3_ENDPOINT'] ? {
      endpoint: process.env['S3_ENDPOINT'],
      forcePathStyle: true,
    } : {}),
  });
}

async function uploadScreenshot(buffer: Buffer, runId: string, pageNum: number): Promise<string> {
  const key = `aetna-screenshots/${runId}/page-${pageNum}.png`;
  const s3 = getS3Client();

  await s3.send(new PutObjectCommand({
    Bucket: process.env['S3_BUCKET_NAME'] ?? 'credentials-documents',
    Key: key,
    Body: buffer,
    ContentType: 'image/png',
  }));

  return key;
}

export async function startAetnaEnrollment(enrollmentId: string, runId: string, userId: string): Promise<void> {
  if (!canLaunch()) {
    await prisma.aetnaEnrollmentRun.update({
      where: { id: runId },
      data: { status: 'failed', errorMessage: 'Browser pool is busy. Try again later.' },
    });
    return;
  }

  let browser;
  try {
    // Load data and build payload
    const enrollment = await prisma.enrollment.findUnique({ where: { id: enrollmentId } });
    if (!enrollment) throw new Error('Enrollment not found');

    const data = await loadProviderData(enrollment.providerId, userId);
    const payload = mapProviderToAetnaPayload(data);

    // Update run with payload (masked for storage)
    await prisma.aetnaEnrollmentRun.update({
      where: { id: runId },
      data: {
        status: 'filling',
        startedAt: new Date(),
        formPayload: maskSensitivePayload(payload) as any,
      },
    });

    // Launch browser
    browser = await chromium.launch({
      headless: true,
      args: ['--disable-dev-shm-usage', '--disable-accelerated-2d-canvas', '--disable-gpu'],
    });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });

    // Fill the form (with 10-minute global timeout)
    const FILL_TIMEOUT_MS = 10 * 60 * 1000;
    const result = await Promise.race([
      fillAetnaForm(page, payload),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Form filling timed out after 10 minutes')), FILL_TIMEOUT_MS)
      ),
    ]);

    // Upload screenshots to R2
    const screenshotKeys: string[] = [];
    for (let i = 0; i < result.screenshots.length; i++) {
      const key = await uploadScreenshot(result.screenshots[i]!, runId, i + 1);
      screenshotKeys.push(key);
    }

    // Hold browser for review
    const reviewExpiresAt = new Date(Date.now() + 30 * 60 * 1000);

    holdSession(runId, browser, page, async () => {
      // On timeout, mark as timed_out
      await prisma.aetnaEnrollmentRun.update({
        where: { id: runId },
        data: { status: 'timed_out', completedAt: new Date() },
      });
    });

    await prisma.aetnaEnrollmentRun.update({
      where: { id: runId },
      data: {
        status: 'awaiting_review',
        aetnaRequestId: result.requestId,
        screenshotDocIds: screenshotKeys,
        automationLog: result.log.join('\n'),
        reviewExpiresAt,
      },
    });

    logger.info(`Aetna run ${runId} ready for review. Request ID: ${result.requestId}`);
  } catch (error: any) {
    logger.error(`Aetna run ${runId} failed`, error);

    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }

    await prisma.aetnaEnrollmentRun.update({
      where: { id: runId },
      data: {
        status: 'failed',
        errorMessage: error.message ?? 'Unknown error',
        errorPage: error.page ?? null,
        automationLog: error.automationLog ?? null,
        completedAt: new Date(),
      },
    });
  }
}

export async function approveAndSubmit(runId: string): Promise<void> {
  const session = getSession(runId);
  if (!session) throw new Error('Browser session expired or not found');

  try {
    await prisma.aetnaEnrollmentRun.update({
      where: { id: runId },
      data: { status: 'submitting' },
    });

    // Click the final submit button
    const confirmationScreenshot = await submitFinalPage(session.page);

    // Upload confirmation screenshot
    const confirmKey = await uploadScreenshot(confirmationScreenshot, runId, 99);

    await prisma.aetnaEnrollmentRun.update({
      where: { id: runId },
      data: {
        status: 'completed',
        submittedAt: new Date(),
        completedAt: new Date(),
        confirmationPdfId: confirmKey,
      },
    });

    // Update parent enrollment status to submitted
    const completedRun = await prisma.aetnaEnrollmentRun.findUnique({ where: { id: runId }, select: { payerEnrollmentId: true } });
    if (completedRun) {
      await prisma.enrollment.update({
        where: { id: completedRun.payerEnrollmentId },
        data: { status: 'submitted', applicationDate: new Date() },
      });
    }

    logger.info(`Aetna run ${runId} submitted successfully`);
  } catch (error: any) {
    logger.error(`Aetna run ${runId} submission failed`, error);

    await prisma.aetnaEnrollmentRun.update({
      where: { id: runId },
      data: {
        status: 'failed',
        errorMessage: `Submission failed: ${error.message}`,
        completedAt: new Date(),
      },
    });
  } finally {
    await releaseSession(runId);
  }
}

export async function rejectRun(runId: string): Promise<void> {
  await releaseSession(runId);

  await prisma.aetnaEnrollmentRun.update({
    where: { id: runId },
    data: { status: 'rejected', completedAt: new Date() },
  });

  logger.info(`Aetna run ${runId} rejected by user`);
}
