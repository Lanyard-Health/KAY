import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';

/**
 * Configurable termination letter template.
 * Placeholders are replaced at generation time.
 *
 * Available placeholders:
 *   {{DATE}}              — Today's date (e.g., "February 6, 2026")
 *   {{PAYER_NAME}}        — Name of the insurance payer
 *   {{PROVIDER_NAME}}     — Provider's full name (first middle last suffix)
 *   {{PROVIDER_NPI}}      — Provider's individual NPI
 *   {{GROUP_NPI}}         — Group/org NPI (or "N/A")
 *   {{TAX_ID}}            — Masked Tax ID (last 4 digits visible)
 *   {{EFFECTIVE_DATE}}    — Enrollment effective date
 *   {{TERMINATION_DATE}}  — Requested termination date
 */
export const TERMINATION_LETTER_TEMPLATE = `{{DATE}}

{{PAYER_NAME}}

Re: Provider Termination Notice

Dear {{PAYER_NAME}} Provider Relations,

This letter serves as formal notification that the following provider is requesting termination from your network:

Provider Name: {{PROVIDER_NAME}}
Individual NPI: {{PROVIDER_NPI}}
Group NPI: {{GROUP_NPI}}
Tax ID: {{TAX_ID}}

Enrollment Effective Date: {{EFFECTIVE_DATE}}
Requested Termination Date: {{TERMINATION_DATE}}

Please process this termination request effective as of the date listed above. We kindly request written confirmation of the termination, including the final effective date, to be sent to our office.

If there are any outstanding claims, credentialing requirements, or additional steps needed to complete this termination, please notify us at your earliest convenience.

Thank you for your prompt attention to this matter.

Sincerely,

{{PROVIDER_NAME}}
NPI: {{PROVIDER_NPI}}`;

/**
 * Masks a tax ID so only the last 4 digits are visible.
 * EIN format  "12-3456789" → "XX-XXX6789"
 * SSN format  "123-45-6789" → "***-**-6789"
 * Fallback    shows last 4 chars with leading asterisks
 */
export function maskTaxId(taxId: string): string {
  const digits = taxId.replace(/\D/g, '');

  // EIN: 9 digits, formatted XX-XXXXXXX
  if (/^\d{2}-?\d{7}$/.test(taxId)) {
    const last4 = digits.slice(-4);
    return `XX-XXX${last4}`;
  }

  // SSN: 9 digits, formatted XXX-XX-XXXX
  if (/^\d{3}-?\d{2}-?\d{4}$/.test(taxId)) {
    const last4 = digits.slice(-4);
    return `***-**-${last4}`;
  }

  // Fallback: mask everything except last 4
  if (digits.length >= 4) {
    const last4 = digits.slice(-4);
    return '*'.repeat(digits.length - 4) + last4;
  }

  return '****';
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function buildProviderFullName(provider: {
  firstName: string;
  lastName: string;
  middleName?: string | null;
  suffix?: string | null;
}): string {
  const parts = [provider.firstName];
  if (provider.middleName) parts.push(provider.middleName);
  parts.push(provider.lastName);
  if (provider.suffix) parts.push(provider.suffix);
  return parts.join(' ');
}

/**
 * Generates a termination letter for a specific enrollment,
 * saves it as a TerminationLetter record with status DRAFT,
 * and returns the created record.
 */
export async function generateTerminationLetter(
  providerId: string,
  enrollmentId: string,
  taskId: string
) {
  // 1. Fetch provider
  const provider = await prisma.providerProfile.findUnique({
    where: { id: providerId },
    select: {
      firstName: true,
      lastName: true,
      middleName: true,
      suffix: true,
      npi: true,
    },
  });

  if (!provider) {
    throw new Error(`Provider ${providerId} not found`);
  }

  // 2. Fetch primary practice location for taxId and groupNpi
  //    Prefer isPrimary=true, fall back to first active location
  let location = await prisma.practiceLocation.findFirst({
    where: { providerId, isPrimary: true, isActive: true },
    select: { taxId: true, groupNpi: true },
  });

  if (!location) {
    location = await prisma.practiceLocation.findFirst({
      where: { providerId, isActive: true },
      select: { taxId: true, groupNpi: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  // 3. Fetch enrollment with payer
  const enrollment = await prisma.payerEnrollment.findUnique({
    where: { id: enrollmentId },
    select: {
      effectiveDate: true,
      terminationDate: true,
      payerEmail: true,
      payer: { select: { name: true } },
    },
  });

  if (!enrollment) {
    throw new Error(`Enrollment ${enrollmentId} not found`);
  }

  // 4. Assemble values
  const providerName = buildProviderFullName(provider);
  const taxIdRaw = location?.taxId || '';
  const maskedTaxId = taxIdRaw ? maskTaxId(taxIdRaw) : 'N/A';
  const groupNpi = location?.groupNpi || 'N/A';
  const payerName = enrollment.payer.name;
  const effectiveDate = enrollment.effectiveDate
    ? formatDate(enrollment.effectiveDate)
    : 'N/A';
  const terminationDate = enrollment.terminationDate
    ? formatDate(enrollment.terminationDate)
    : 'N/A';

  // 5. Fill template
  const letterContent = TERMINATION_LETTER_TEMPLATE
    .replace(/\{\{DATE\}\}/g, formatDate(new Date()))
    .replace(/\{\{PAYER_NAME\}\}/g, payerName)
    .replace(/\{\{PROVIDER_NAME\}\}/g, providerName)
    .replace(/\{\{PROVIDER_NPI\}\}/g, provider.npi)
    .replace(/\{\{GROUP_NPI\}\}/g, groupNpi)
    .replace(/\{\{TAX_ID\}\}/g, maskedTaxId)
    .replace(/\{\{EFFECTIVE_DATE\}\}/g, effectiveDate)
    .replace(/\{\{TERMINATION_DATE\}\}/g, terminationDate);

  // 6. Save as DRAFT
  const letter = await prisma.terminationLetter.create({
    data: {
      providerId,
      taskId,
      payerName,
      payerEmail: enrollment.payerEmail ?? null,
      providerName,
      npi: provider.npi,
      groupNpi: location?.groupNpi ?? null,
      taxId: maskedTaxId,
      letterContent,
    },
  });

  logger.info(
    `Generated termination letter ${letter.id} for provider ${providerId}, enrollment ${enrollmentId}`
  );

  return letter;
}
