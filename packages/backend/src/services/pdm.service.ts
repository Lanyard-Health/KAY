import { prisma } from '../utils/prisma.js';

export interface PdmAttestationStatus {
  enrollmentId: string;
  payerName: string;
  payerId: string;
  lastAttestedAt: Date | null;
  daysUntilDue: number | null;
  status: 'current' | 'due_soon' | 'overdue' | 'never_attested';
  needsUpdate: boolean;
}

const ATTESTATION_PERIOD_DAYS = 90;
const WARNING_THRESHOLD_DAYS = 14;

/**
 * Calculate days until attestation is due (90-day cycle per CAA 2021)
 * Returns null if never attested
 */
export function calculateDaysUntilDue(lastAttestedAt: Date | null): number | null {
  if (!lastAttestedAt) {
    return null;
  }

  const now = new Date();
  const daysSinceAttestation = Math.floor(
    (now.getTime() - lastAttestedAt.getTime()) / (1000 * 60 * 60 * 24)
  );

  return ATTESTATION_PERIOD_DAYS - daysSinceAttestation;
}

/**
 * Determine attestation status based on days until due
 */
function getAttestationStatusLabel(
  daysUntilDue: number | null
): 'current' | 'due_soon' | 'overdue' | 'never_attested' {
  if (daysUntilDue === null) {
    return 'never_attested';
  }

  if (daysUntilDue < 0) {
    return 'overdue';
  }

  if (daysUntilDue <= WARNING_THRESHOLD_DAYS) {
    return 'due_soon';
  }

  return 'current';
}

/**
 * Check if enrollment needs update based on directory changes
 */
function checkNeedsUpdate(
  lastAttestedAt: Date | null,
  providerDirectoryUpdate: Date | null
): boolean {
  if (!lastAttestedAt) {
    return true;
  }

  if (providerDirectoryUpdate && providerDirectoryUpdate > lastAttestedAt) {
    return true;
  }

  return false;
}

/**
 * Get attestation statuses for all PDM-enabled enrollments for a provider
 */
export async function getAttestationStatuses(
  providerId: string
): Promise<PdmAttestationStatus[]> {
  const enrollments = await prisma.payerEnrollment.findMany({
    where: {
      providerId,
      pdmEnabled: true,
      status: {
        in: ['approved', 'pending_review', 'submitted', 'in_progress'],
      },
    },
    include: {
      payer: true,
      provider: {
        select: {
          lastDirectoryUpdateAt: true,
        },
      },
    },
  });

  return enrollments.map((enrollment) => {
    const daysUntilDue = calculateDaysUntilDue(enrollment.pdmLastAttestedAt);
    const status = getAttestationStatusLabel(daysUntilDue);
    const needsUpdate = checkNeedsUpdate(
      enrollment.pdmLastAttestedAt,
      enrollment.provider.lastDirectoryUpdateAt
    );

    return {
      enrollmentId: enrollment.id,
      payerName: enrollment.payer.name,
      payerId: enrollment.payer.id,
      lastAttestedAt: enrollment.pdmLastAttestedAt,
      daysUntilDue,
      status,
      needsUpdate,
    };
  });
}

/**
 * Get enrollments that need attention (due soon, overdue, or need update)
 */
export async function getEnrollmentsNeedingAttestation(
  providerId: string,
  warningDays: number = WARNING_THRESHOLD_DAYS
): Promise<PdmAttestationStatus[]> {
  const statuses = await getAttestationStatuses(providerId);

  return statuses.filter((status) => {
    // Never attested
    if (status.status === 'never_attested') {
      return true;
    }

    // Overdue
    if (status.status === 'overdue') {
      return true;
    }

    // Due soon (within warning period)
    if (status.daysUntilDue !== null && status.daysUntilDue <= warningDays) {
      return true;
    }

    // Directory changed since last attestation
    if (status.needsUpdate) {
      return true;
    }

    return false;
  });
}

/**
 * Record attestation for one or more enrollments
 */
export async function recordAttestation(
  enrollmentIds: string[],
  attestedBy: string
): Promise<void> {
  const now = new Date();

  await prisma.payerEnrollment.updateMany({
    where: {
      id: {
        in: enrollmentIds,
      },
    },
    data: {
      pdmLastAttestedAt: now,
      pdmLastAttestedBy: attestedBy,
    },
  });
}

/**
 * Get summary counts for attestation statuses
 */
export async function getAttestationSummary(providerId: string): Promise<{
  current: number;
  dueSoon: number;
  overdue: number;
  neverAttested: number;
  needsUpdate: number;
  nextDueDate: Date | null;
  daysUntilNextDue: number | null;
}> {
  const statuses = await getAttestationStatuses(providerId);

  const summary = {
    current: 0,
    dueSoon: 0,
    overdue: 0,
    neverAttested: 0,
    needsUpdate: 0,
    nextDueDate: null as Date | null,
    daysUntilNextDue: null as number | null,
  };

  let minDaysUntilDue: number | null = null;

  for (const status of statuses) {
    switch (status.status) {
      case 'current':
        summary.current++;
        break;
      case 'due_soon':
        summary.dueSoon++;
        break;
      case 'overdue':
        summary.overdue++;
        break;
      case 'never_attested':
        summary.neverAttested++;
        break;
    }

    if (status.needsUpdate) {
      summary.needsUpdate++;
    }

    if (status.daysUntilDue !== null) {
      if (minDaysUntilDue === null || status.daysUntilDue < minDaysUntilDue) {
        minDaysUntilDue = status.daysUntilDue;
      }
    }
  }

  if (minDaysUntilDue !== null) {
    summary.daysUntilNextDue = minDaysUntilDue;
    const nextDue = new Date();
    nextDue.setDate(nextDue.getDate() + minDaysUntilDue);
    summary.nextDueDate = nextDue;
  }

  return summary;
}

export const pdmService = {
  calculateDaysUntilDue,
  getAttestationStatuses,
  getEnrollmentsNeedingAttestation,
  recordAttestation,
  getAttestationSummary,
};
