import { prisma } from '../utils/prisma.js';
import { aetnaAuth } from './aetna.auth.js';
import { logger } from '../utils/logger.js';

// ==========================================
// Adapter interfaces
// ==========================================

export interface DirectoryLookupResult {
  status: 'listed' | 'not_found' | 'mismatch' | 'error';
  fhirResponse?: unknown;
  listedName?: string;
  listedNpi?: string;
  listedPhone?: string;
  listedSpecialty?: string;
  listedAddress?: string;
  networkNames?: string[];
  mismatches?: Array<{ field: string; ours: string; theirs: string }>;
  errorMessage?: string;
}

export interface PayerDirectoryAdapter {
  payerIdentifier: string;
  isConfigured(): boolean;
  lookupByNpi(npi: string, providerRecord?: { firstName: string; lastName: string; phone: string; specialties: string[] }): Promise<DirectoryLookupResult>;
}

// ==========================================
// Aetna adapter
// ==========================================

class AetnaDirectoryAdapter implements PayerDirectoryAdapter {
  payerIdentifier = 'aetna';

  isConfigured(): boolean {
    return aetnaAuth.isConfigured();
  }

  async lookupByNpi(
    npi: string,
    providerRecord?: { firstName: string; lastName: string; phone: string; specialties: string[] }
  ): Promise<DirectoryLookupResult> {
    try {
      const token = await aetnaAuth.getAccessToken();
      const baseUrl = aetnaAuth.getBaseUrl();

      // Search for practitioner by NPI
      const searchUrl = `${baseUrl}/Practitioner?identifier=http://hl7.org/fhir/sid/us-npi|${encodeURIComponent(npi)}`;
      const searchResponse = await fetch(searchUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/fhir+json',
        },
      });

      if (!searchResponse.ok) {
        const errorText = await searchResponse.text();
        logger.error(`[DirectoryService] Aetna FHIR search failed: ${searchResponse.status} ${errorText}`);
        return { status: 'error', errorMessage: `FHIR search failed: ${searchResponse.status}` };
      }

      const bundle = await searchResponse.json() as {
        resourceType: string;
        total?: number;
        entry?: Array<{ resource: Record<string, unknown> }>;
      };

      if (!bundle.entry || bundle.entry.length === 0) {
        return { status: 'not_found', fhirResponse: bundle };
      }

      const practitioner = bundle.entry[0]!.resource;

      // Extract data from FHIR Practitioner
      const listedName = extractPractitionerName(practitioner);
      const listedNpi = npi;
      const listedPhone = extractPhone(practitioner);

      // Fetch PractitionerRole for specialty and network
      let listedSpecialty: string | undefined;
      let listedAddress: string | undefined;
      const networkNames: string[] = [];

      const practitionerId = practitioner['id'] as string;
      if (practitionerId) {
        try {
          const roleUrl = `${baseUrl}/PractitionerRole?practitioner=Practitioner/${encodeURIComponent(practitionerId)}`;
          const roleResponse = await fetch(roleUrl, {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/fhir+json',
            },
          });

          if (roleResponse.ok) {
            const roleBundle = await roleResponse.json() as {
              entry?: Array<{ resource: Record<string, unknown> }>;
            };

            if (roleBundle.entry) {
              for (const entry of roleBundle.entry) {
                const role = entry.resource;
                const specialty = extractSpecialty(role);
                if (specialty && !listedSpecialty) {
                  listedSpecialty = specialty;
                }
                const address = extractAddress(role);
                if (address && !listedAddress) {
                  listedAddress = address;
                }
                const network = extractNetwork(role);
                if (network) {
                  networkNames.push(network);
                }
              }
            }
          }
        } catch (err) {
          logger.warn(`[DirectoryService] Failed to fetch PractitionerRole: ${err}`);
        }
      }

      // Compare against our record if provided
      const mismatches: Array<{ field: string; ours: string; theirs: string }> = [];
      if (providerRecord) {
        const ourName = `${providerRecord.firstName} ${providerRecord.lastName}`.toLowerCase();
        if (listedName && listedName.toLowerCase() !== ourName) {
          mismatches.push({ field: 'name', ours: `${providerRecord.firstName} ${providerRecord.lastName}`, theirs: listedName });
        }

        if (listedPhone && providerRecord.phone) {
          const normalizePhone = (p: string) => p.replace(/\D/g, '');
          if (normalizePhone(listedPhone) !== normalizePhone(providerRecord.phone)) {
            mismatches.push({ field: 'phone', ours: providerRecord.phone, theirs: listedPhone });
          }
        }

        if (listedSpecialty && providerRecord.specialties.length > 0) {
          const ourSpecialties = providerRecord.specialties.map(s => s.toLowerCase());
          if (!ourSpecialties.some(s => listedSpecialty!.toLowerCase().includes(s))) {
            mismatches.push({ field: 'specialty', ours: providerRecord.specialties.join(', '), theirs: listedSpecialty });
          }
        }
      }

      const status = mismatches.length > 0 ? 'mismatch' : 'listed';

      return {
        status,
        fhirResponse: bundle,
        listedName,
        listedNpi,
        listedPhone,
        listedSpecialty,
        listedAddress,
        networkNames: [...new Set(networkNames)],
        mismatches: mismatches.length > 0 ? mismatches : undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[DirectoryService] Aetna lookup error: ${message}`);
      return { status: 'error', errorMessage: message };
    }
  }
}

// ==========================================
// FHIR parsing helpers
// ==========================================

function extractPractitionerName(practitioner: Record<string, unknown>): string | undefined {
  const names = practitioner['name'] as Array<{ given?: string[]; family?: string; text?: string }> | undefined;
  if (!names || names.length === 0) return undefined;
  const name = names[0]!;
  if (name.text) return name.text;
  const given = name.given?.join(' ') || '';
  const family = name.family || '';
  return `${given} ${family}`.trim() || undefined;
}

function extractPhone(resource: Record<string, unknown>): string | undefined {
  const telecoms = resource['telecom'] as Array<{ system?: string; value?: string }> | undefined;
  if (!telecoms) return undefined;
  const phone = telecoms.find(t => t.system === 'phone');
  return phone?.value;
}

function extractSpecialty(role: Record<string, unknown>): string | undefined {
  const specialties = role['specialty'] as Array<{ coding?: Array<{ display?: string }> }> | undefined;
  if (!specialties || specialties.length === 0) return undefined;
  return specialties[0]?.coding?.[0]?.display;
}

function extractAddress(role: Record<string, unknown>): string | undefined {
  const locations = role['location'] as Array<{ display?: string }> | undefined;
  if (locations && locations.length > 0 && locations[0]!.display) {
    return locations[0]!.display;
  }
  return undefined;
}

function extractNetwork(role: Record<string, unknown>): string | undefined {
  const networks = role['network'] as Array<{ display?: string }> | undefined;
  if (!networks || networks.length === 0) return undefined;
  return networks[0]?.display;
}

// ==========================================
// Adapter registry
// ==========================================

const adapters = new Map<string, PayerDirectoryAdapter>();

function registerAdapter(adapter: PayerDirectoryAdapter): void {
  adapters.set(adapter.payerIdentifier, adapter);
}

export function getConfiguredPayers(): string[] {
  return Array.from(adapters.entries())
    .filter(([, adapter]) => adapter.isConfigured())
    .map(([id]) => id);
}

function getAdapterForPayer(payerIdentifier: string): PayerDirectoryAdapter | undefined {
  const adapter = adapters.get(payerIdentifier);
  if (adapter && adapter.isConfigured()) return adapter;
  return undefined;
}

// Register known adapters
registerAdapter(new AetnaDirectoryAdapter());

// ==========================================
// Core service functions
// ==========================================

export async function verifyProvider(providerId: string, payerId: string) {
  const provider = await prisma.provider.findUnique({
    where: { id: providerId },
  });
  if (!provider) throw new Error('Provider not found');

  const payer = await prisma.payer.findUnique({
    where: { id: payerId },
  });
  if (!payer) throw new Error('Payer not found');

  const adapter = getAdapterForPayer(payer.payerId);
  if (!adapter) throw new Error(`No directory adapter configured for payer: ${payer.name}`);

  const result = await adapter.lookupByNpi(provider.npi, {
    firstName: provider.firstName,
    lastName: provider.lastName,
    phone: provider.phone,
    specialties: provider.specialties,
  });

  // Create snapshot
  const snapshot = await prisma.providerDirectorySnapshot.create({
    data: {
      providerId,
      payerId,
      status: result.status,
      fhirResponse: result.fhirResponse as any,
      listedName: result.listedName,
      listedNpi: result.listedNpi,
      listedPhone: result.listedPhone,
      listedSpecialty: result.listedSpecialty,
      listedAddress: result.listedAddress,
      networkNames: result.networkNames || [],
      mismatches: result.mismatches as any,
    },
  });

  // Handle alerts
  if (result.status === 'not_found' || result.status === 'mismatch') {
    // Auto-resolve any prior open alerts for same provider+payer
    await prisma.providerDirectoryAlert.updateMany({
      where: { providerId, payerId, resolved: false },
      data: { resolved: true, resolvedAt: new Date(), resolvedBy: 'system' },
    });

    const message = result.status === 'not_found'
      ? `Provider not found in ${payer.name} directory`
      : `Data mismatch detected in ${payer.name} directory`;

    await prisma.providerDirectoryAlert.create({
      data: {
        providerId,
        payerId,
        snapshotId: snapshot.id,
        alertType: result.status,
        message,
        details: result.mismatches as any,
      },
    });
  } else if (result.status === 'listed') {
    // Auto-resolve any prior open alerts
    await prisma.providerDirectoryAlert.updateMany({
      where: { providerId, payerId, resolved: false },
      data: { resolved: true, resolvedAt: new Date(), resolvedBy: 'system' },
    });
  }

  return snapshot;
}

export async function verifyProviderAllPayers(providerId: string) {
  const configuredPayers = getConfiguredPayers();
  if (configuredPayers.length === 0) return [];

  // Find payers that match configured adapter identifiers
  const payers = await prisma.payer.findMany({
    where: { payerId: { in: configuredPayers } },
  });

  const snapshots = [];
  for (const payer of payers) {
    try {
      const snapshot = await verifyProvider(providerId, payer.id);
      snapshots.push(snapshot);
    } catch (error) {
      logger.error(`[DirectoryService] Error verifying provider ${providerId} with payer ${payer.name}: ${error}`);
    }
  }

  return snapshots;
}

export async function getLatestSnapshot(providerId: string, payerId: string) {
  return prisma.providerDirectorySnapshot.findFirst({
    where: { providerId, payerId },
    orderBy: { checkedAt: 'desc' },
  });
}

export async function getProviderDirectoryStatus(providerId: string) {
  const configuredPayers = getConfiguredPayers();

  // Get latest snapshot per payer
  const snapshots = await prisma.providerDirectorySnapshot.findMany({
    where: { providerId },
    orderBy: { checkedAt: 'desc' },
    include: { payer: true },
  });

  // Deduplicate to latest per payer
  const latestByPayer = new Map<string, typeof snapshots[0]>();
  for (const snapshot of snapshots) {
    if (!latestByPayer.has(snapshot.payerId)) {
      latestByPayer.set(snapshot.payerId, snapshot);
    }
  }

  const alerts = await prisma.providerDirectoryAlert.findMany({
    where: { providerId, resolved: false },
    include: { payer: true },
    orderBy: { createdAt: 'desc' },
  });

  const latestSnapshots = Array.from(latestByPayer.values());
  const listed = latestSnapshots.filter(s => s.status === 'listed').length;
  const notFound = latestSnapshots.filter(s => s.status === 'not_found').length;
  const mismatch = latestSnapshots.filter(s => s.status === 'mismatch').length;
  const errored = latestSnapshots.filter(s => s.status === 'error').length;

  return {
    snapshots: latestSnapshots,
    alerts,
    configuredPayers,
    summary: { listed, notFound, mismatch, error: errored, openAlerts: alerts.length },
  };
}

export async function getOpenAlerts(providerId: string) {
  return prisma.providerDirectoryAlert.findMany({
    where: { providerId, resolved: false },
    include: { payer: true, snapshot: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function resolveAlert(alertId: string, resolvedBy: string) {
  return prisma.providerDirectoryAlert.update({
    where: { id: alertId },
    data: { resolved: true, resolvedAt: new Date(), resolvedBy },
  });
}

export async function getSnapshots(providerId: string, payerId?: string, take = 20, skip = 0) {
  return prisma.providerDirectorySnapshot.findMany({
    where: {
      providerId,
      ...(payerId ? { payerId } : {}),
    },
    include: { payer: true },
    orderBy: { checkedAt: 'desc' },
    take,
    skip,
  });
}

// ==========================================
// Batch (for scheduler)
// ==========================================

export async function runScheduledDirectoryChecks(): Promise<{ checked: number; alerts: number; errors: number }> {
  const configuredPayers = getConfiguredPayers();
  if (configuredPayers.length === 0) {
    return { checked: 0, alerts: 0, errors: 0 };
  }

  // Find all active enrollments where payer has a registered adapter
  const enrollments = await prisma.payerEnrollment.findMany({
    where: {
      status: { in: ['approved', 'in_progress', 'submitted', 'pending_review'] },
      payer: { payerId: { in: configuredPayers } },
    },
    include: { payer: true },
  });

  let checked = 0;
  let alerts = 0;
  let errors = 0;

  for (const enrollment of enrollments) {
    try {
      const snapshot = await verifyProvider(enrollment.providerId, enrollment.payerId);
      checked++;
      if (snapshot.status === 'not_found' || snapshot.status === 'mismatch') {
        alerts++;
      }
    } catch (error) {
      errors++;
      logger.error(`[DirectoryService] Scheduled check error for enrollment ${enrollment.id}: ${error}`);
    }
  }

  return { checked, alerts, errors };
}
