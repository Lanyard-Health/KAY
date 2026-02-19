# PECOS Medicare Compliance Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist CMS PECOS data to the database, enhance Provider Detail with full Medicare enrollment info, and add Medicare status filtering to the Provider List.

**Architecture:** New `MedicareVerification` Prisma model stores denormalized CMS snapshots per provider. Two new backend endpoints handle single and batch verification (upsert to DB). Frontend reads from DB for instant load, re-verify hits CMS live.

**Tech Stack:** Prisma (migration + model), Express routes, React Query mutations, Tailwind CSS, Vitest for backend tests.

**Design doc:** `docs/plans/2026-02-19-pecos-medicare-compliance-design.md`

---

## Task 1: Prisma Schema — Add MedicareVerification Model

**Files:**
- Modify: `packages/backend/prisma/schema.prisma`

**Step 1: Add the MedicareStatus enum and MedicareVerification model**

Add after the last model in `schema.prisma`:

```prisma
enum MedicareStatus {
  ENROLLED
  NOT_ENROLLED
  UNVERIFIED
}

model MedicareVerification {
  id         String   @id @default(uuid())
  providerId String   @unique @map("provider_id")
  provider   Provider @relation(fields: [providerId], references: [id], onDelete: Cascade)

  status     MedicareStatus @default(UNVERIFIED)
  verifiedAt DateTime?      @map("verified_at")

  npi              String?
  pacId            String?  @map("pac_id")
  enrollmentCount  Int      @default(0) @map("enrollment_count")
  enrollmentStates String[] @default([]) @map("enrollment_states")
  rawData          Json?    @map("raw_data")

  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  @@index([status])
  @@index([verifiedAt])
  @@map("medicare_verifications")
}
```

**Step 2: Add the relation to the Provider model**

In the Provider model's relations section (around line 283, after `demographics`), add:

```prisma
  medicareVerification   MedicareVerification?
```

**Step 3: Generate migration and Prisma client**

Run:
```bash
cd /Users/kay/Documents/KAY
npx prisma migrate dev --name add_medicare_verification --schema=packages/backend/prisma/schema.prisma
```

Expected: Migration creates `medicare_verifications` table. Prisma client regenerated.

**Step 4: Commit**

```bash
git add packages/backend/prisma/
git commit -m "feat: add MedicareVerification model and migration"
```

---

## Task 2: Backend — Verification Service Layer

**Files:**
- Create: `packages/backend/src/services/medicareVerification.service.ts`
- Test: `packages/backend/src/services/medicareVerification.service.test.ts`

**Step 1: Write failing tests**

Create `packages/backend/src/services/medicareVerification.service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { mockProvider } from '../../tests/helpers/fixtures.js';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

// Mock PECOSService
const mockLookupByNPI = vi.fn();
vi.mock('./pecos.service.js', () => ({
  PECOSService: vi.fn().mockImplementation(function() {
    return { lookupByNPI: mockLookupByNPI, batchLookup: vi.fn() };
  }),
}));

import { verifyProvider, verifyProviderBatch } from './medicareVerification.service.js';

describe('medicareVerification.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('verifyProvider', () => {
    it('should upsert ENROLLED when CMS finds the provider', async () => {
      const cmsResult = {
        found: true,
        npi: '1234567890',
        pacId: 'PAC123',
        enrollments: [
          { enrollmentId: 'I20091005000100', enrollmentDate: '2009-10-05', providerTypeCode: '20', providerTypeDesc: 'PRACTITIONER', state: 'CA' },
          { enrollmentId: 'I20101005000200', enrollmentDate: '2010-10-05', providerTypeCode: '20', providerTypeDesc: 'PRACTITIONER', state: 'NY' },
        ],
        orderingPrivileges: { partB: true, dme: false, hha: false, pmd: false, hospice: false },
        verifiedAt: '2026-02-19T00:00:00.000Z',
      };

      prismaMock.provider.findUnique.mockResolvedValue(mockProvider as any);
      mockLookupByNPI.mockResolvedValue(cmsResult);
      prismaMock.medicareVerification.upsert.mockResolvedValue({
        id: 'mv-1',
        providerId: mockProvider.id,
        status: 'ENROLLED',
        verifiedAt: new Date(),
        npi: '1234567890',
        pacId: 'PAC123',
        enrollmentCount: 2,
        enrollmentStates: ['CA', 'NY'],
        rawData: cmsResult,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const result = await verifyProvider(mockProvider.id);

      expect(prismaMock.provider.findUnique).toHaveBeenCalledWith({
        where: { id: mockProvider.id },
        select: { npi: true },
      });
      expect(mockLookupByNPI).toHaveBeenCalledWith('1234567890');
      expect(prismaMock.medicareVerification.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { providerId: mockProvider.id },
          create: expect.objectContaining({ status: 'ENROLLED', enrollmentCount: 2 }),
          update: expect.objectContaining({ status: 'ENROLLED', enrollmentCount: 2 }),
        }),
      );
      expect(result.status).toBe('ENROLLED');
    });

    it('should upsert NOT_ENROLLED when CMS does not find the provider', async () => {
      prismaMock.provider.findUnique.mockResolvedValue(mockProvider as any);
      mockLookupByNPI.mockResolvedValue({ found: false });
      prismaMock.medicareVerification.upsert.mockResolvedValue({
        id: 'mv-2',
        providerId: mockProvider.id,
        status: 'NOT_ENROLLED',
        verifiedAt: new Date(),
        npi: '1234567890',
        pacId: null,
        enrollmentCount: 0,
        enrollmentStates: [],
        rawData: { found: false },
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const result = await verifyProvider(mockProvider.id);

      expect(result.status).toBe('NOT_ENROLLED');
    });

    it('should throw when provider not found', async () => {
      prismaMock.provider.findUnique.mockResolvedValue(null);
      await expect(verifyProvider('nonexistent')).rejects.toThrow('Provider not found');
    });

    it('should throw when provider has no NPI', async () => {
      prismaMock.provider.findUnique.mockResolvedValue({ npi: null } as any);
      await expect(verifyProvider('no-npi')).rejects.toThrow('Provider has no NPI');
    });
  });

  describe('verifyProviderBatch', () => {
    it('should verify multiple providers and return summary', async () => {
      const provider1 = { ...mockProvider, id: 'p1', npi: '1111111111' };
      const provider2 = { ...mockProvider, id: 'p2', npi: '2222222222' };

      prismaMock.provider.findMany.mockResolvedValue([provider1, provider2] as any);
      mockLookupByNPI
        .mockResolvedValueOnce({ found: true, npi: '1111111111', pacId: 'PAC1', enrollments: [{ state: 'CA' }], verifiedAt: new Date().toISOString() })
        .mockResolvedValueOnce({ found: false });

      prismaMock.medicareVerification.upsert
        .mockResolvedValueOnce({ status: 'ENROLLED' } as any)
        .mockResolvedValueOnce({ status: 'NOT_ENROLLED' } as any);

      const summary = await verifyProviderBatch(['p1', 'p2']);

      expect(summary.verified).toBe(2);
      expect(summary.enrolled).toBe(1);
      expect(summary.notEnrolled).toBe(1);
      expect(summary.errors).toBe(0);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run:
```bash
cd /Users/kay/Documents/KAY
npx vitest run packages/backend/src/services/medicareVerification.service.test.ts
```

Expected: FAIL — module not found.

**Step 3: Write the service**

Create `packages/backend/src/services/medicareVerification.service.ts`:

```typescript
import { prisma } from '../utils/prisma.js';
import { PECOSService } from './pecos.service.js';
import { logger } from '../utils/logger.js';
import type { MedicareEnrollmentResult } from './pecos.service.js';

const pecosService = new PECOSService();

export async function verifyProvider(providerId: string) {
  const provider = await prisma.provider.findUnique({
    where: { id: providerId },
    select: { npi: true },
  });

  if (!provider) throw new Error('Provider not found');
  if (!provider.npi) throw new Error('Provider has no NPI');

  const cmsResult = await pecosService.lookupByNPI(provider.npi);
  return upsertVerification(providerId, provider.npi, cmsResult);
}

export async function verifyProviderBatch(providerIds: string[]) {
  const providers = await prisma.provider.findMany({
    where: { id: { in: providerIds } },
    select: { id: true, npi: true },
  });

  const summary = { verified: 0, enrolled: 0, notEnrolled: 0, errors: 0 };

  // Process in chunks of 5
  for (let i = 0; i < providers.length; i += 5) {
    const chunk = providers.slice(i, i + 5);
    const results = await Promise.allSettled(
      chunk.map(async (p) => {
        if (!p.npi) {
          logger.warn(`Provider ${p.id} has no NPI, skipping`);
          throw new Error('No NPI');
        }
        const cmsResult = await pecosService.lookupByNPI(p.npi);
        return { providerId: p.id, npi: p.npi, cmsResult };
      }),
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        summary.errors++;
        continue;
      }
      try {
        const { providerId, npi, cmsResult } = result.value;
        const record = await upsertVerification(providerId, npi, cmsResult);
        summary.verified++;
        if (record.status === 'ENROLLED') summary.enrolled++;
        else summary.notEnrolled++;
      } catch (err) {
        logger.error('Failed to upsert verification:', err);
        summary.errors++;
      }
    }
  }

  return summary;
}

async function upsertVerification(
  providerId: string,
  npi: string,
  cmsResult: MedicareEnrollmentResult,
) {
  const status = cmsResult.found ? 'ENROLLED' : 'NOT_ENROLLED';
  const enrollmentStates = cmsResult.enrollments
    ? [...new Set(cmsResult.enrollments.map((e) => e.state))]
    : [];

  const data = {
    status: status as 'ENROLLED' | 'NOT_ENROLLED',
    verifiedAt: new Date(),
    npi,
    pacId: cmsResult.pacId ?? null,
    enrollmentCount: cmsResult.enrollments?.length ?? 0,
    enrollmentStates,
    rawData: cmsResult as any,
  };

  return prisma.medicareVerification.upsert({
    where: { providerId },
    create: { providerId, ...data },
    update: data,
  });
}
```

**Step 4: Run tests to verify they pass**

Run:
```bash
cd /Users/kay/Documents/KAY
npx vitest run packages/backend/src/services/medicareVerification.service.test.ts
```

Expected: All 5 tests PASS.

**Step 5: Commit**

```bash
git add packages/backend/src/services/medicareVerification.service.ts packages/backend/src/services/medicareVerification.service.test.ts
git commit -m "feat: add medicare verification service with persistence"
```

---

## Task 3: Backend — Verify Endpoints in PECOS Routes

**Files:**
- Modify: `packages/backend/src/routes/pecos.routes.ts` (add 2 endpoints at the end)

**Step 1: Add verify/:providerId endpoint**

At the bottom of `pecos.routes.ts`, before the closing of the file, add:

```typescript
import { verifyProvider, verifyProviderBatch } from '../services/medicareVerification.service.js';

// POST /api/v1/pecos/verify/:providerId - Verify and persist Medicare enrollment for a provider
pecosRoutes.post(
  '/verify/:providerId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { providerId } = req.params;
      const result = await verifyProvider(providerId);
      res.json({ success: true, data: result });
    } catch (error: any) {
      if (error.message === 'Provider not found' || error.message === 'Provider has no NPI') {
        return res.status(400).json({ success: false, error: { message: error.message } });
      }
      next(error);
    }
  }
);

// POST /api/v1/pecos/verify-batch - Verify and persist Medicare enrollment for multiple providers
pecosRoutes.post(
  '/verify-batch',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { providerIds } = req.body;

      if (!Array.isArray(providerIds) || providerIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: { message: 'providerIds must be a non-empty array.' },
        });
      }

      if (providerIds.length > 50) {
        return res.status(400).json({
          success: false,
          error: { message: 'Maximum 50 providers per batch request.' },
        });
      }

      const summary = await verifyProviderBatch(providerIds);
      res.json({ success: true, data: summary });
    } catch (error) {
      next(error);
    }
  }
);
```

**Step 2: Run existing PECOS tests to make sure nothing is broken**

Run:
```bash
cd /Users/kay/Documents/KAY
npx vitest run packages/backend/src/routes/pecos --passWithNoTests
```

Expected: No regressions.

**Step 3: Commit**

```bash
git add packages/backend/src/routes/pecos.routes.ts
git commit -m "feat: add verify and verify-batch PECOS endpoints"
```

---

## Task 4: Backend — Include Medicare Status in Provider List

**Files:**
- Modify: `packages/backend/src/routes/provider.routes.ts`

**Step 1: Add medicareVerification to the provider list select**

In the `GET /` handler (around line 62-87), add to the `select` object:

```typescript
            medicareVerification: {
              select: {
                status: true,
                verifiedAt: true,
              },
            },
```

**Step 2: Add medicareStatus filter to the where clause**

In the `where` object construction (around line 38-54), add after the status filter:

```typescript
        ...(req.query['medicareStatus'] && {
          medicareVerification: {
            status: req.query['medicareStatus'] as string,
          },
        }),
```

Note: For `UNVERIFIED` filter, we also need to include providers with no verification record. Update this to:

```typescript
        ...(req.query['medicareStatus'] === 'UNVERIFIED'
          ? { medicareVerification: null }
          : req.query['medicareStatus']
            ? { medicareVerification: { status: req.query['medicareStatus'] as string } }
            : {}),
```

**Step 3: Run existing provider route tests**

Run:
```bash
cd /Users/kay/Documents/KAY
npx vitest run packages/backend/src/routes/provider.routes.test.ts
```

Expected: All existing tests pass.

**Step 4: Commit**

```bash
git add packages/backend/src/routes/provider.routes.ts
git commit -m "feat: include medicare status in provider list response"
```

---

## Task 5: Frontend — useMedicareVerification Hook

**Files:**
- Create: `packages/frontend/src/hooks/useMedicareVerification.ts`

**Step 1: Create the hook**

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';
import toast from 'react-hot-toast';

export function useVerifyMedicare() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (providerId: string) => {
      const response = await api.post(`/pecos/verify/${providerId}`);
      return response.data.data;
    },
    onSuccess: (_data, providerId) => {
      queryClient.invalidateQueries({ queryKey: ['provider', providerId] });
      queryClient.invalidateQueries({ queryKey: ['providers'] });
      toast.success('Medicare verification updated');
    },
    onError: () => {
      toast.error('Failed to verify Medicare enrollment');
    },
  });
}

export function useVerifyMedicareBatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (providerIds: string[]) => {
      const response = await api.post('/pecos/verify-batch', { providerIds });
      return response.data.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['providers'] });
      toast.success(
        `Verified ${data.verified} providers: ${data.enrolled} enrolled, ${data.notEnrolled} not enrolled` +
        (data.errors > 0 ? `, ${data.errors} errors` : ''),
      );
    },
    onError: () => {
      toast.error('Failed to verify Medicare enrollment batch');
    },
  });
}
```

**Step 2: Commit**

```bash
git add packages/frontend/src/hooks/useMedicareVerification.ts
git commit -m "feat: add useMedicareVerification hooks"
```

---

## Task 6: Frontend — Enhanced Provider Detail Medicare Section

**Files:**
- Modify: `packages/frontend/src/features/providers/ProviderDetail.tsx`

**Step 1: Replace the sidebar Medicare card**

At the top of the file, add import:

```typescript
import { useVerifyMedicare } from '../../hooks/useMedicareVerification';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
```

Inside the component, add the mutation hook:

```typescript
const verifyMedicareMutation = useVerifyMedicare();
```

Replace the existing Medicare Enrollment sidebar card (the `<div className="card card-body">` block around lines 1489-1539) with:

```tsx
                {/* Medicare Enrollment */}
                <div className="card card-body">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-gray-500">Medicare Enrollment</h3>
                    <button
                      onClick={() => verifyMedicareMutation.mutate(id!)}
                      disabled={verifyMedicareMutation.isPending}
                      className="text-xs text-primary-600 hover:text-primary-500 flex items-center gap-1"
                      title="Re-verify with CMS"
                    >
                      <ArrowPathIcon className={clsx('h-3.5 w-3.5', verifyMedicareMutation.isPending && 'animate-spin')} />
                      {verifyMedicareMutation.isPending ? 'Verifying...' : 'Verify'}
                    </button>
                  </div>

                  {provider.medicareVerification ? (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className={clsx(
                          'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                          provider.medicareVerification.status === 'ENROLLED' && 'bg-green-100 text-green-800',
                          provider.medicareVerification.status === 'NOT_ENROLLED' && 'bg-yellow-100 text-yellow-800',
                          provider.medicareVerification.status === 'UNVERIFIED' && 'bg-gray-100 text-gray-600',
                        )}>
                          {provider.medicareVerification.status === 'ENROLLED' ? 'Enrolled' :
                           provider.medicareVerification.status === 'NOT_ENROLLED' ? 'Not Enrolled' : 'Unverified'}
                        </span>
                        {provider.medicareVerification.verifiedAt && (() => {
                          const daysSince = Math.floor((Date.now() - new Date(provider.medicareVerification.verifiedAt).getTime()) / 86400000);
                          return daysSince > 30 ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                              Stale
                            </span>
                          ) : null;
                        })()}
                      </div>

                      {provider.medicareVerification.rawData?.pacId && (
                        <p className="text-xs text-gray-500 mb-2">PAC ID: {provider.medicareVerification.rawData.pacId}</p>
                      )}

                      {provider.medicareVerification.rawData?.enrollments?.length > 0 && (
                        <div className="text-xs text-gray-600 space-y-1 mb-2">
                          {provider.medicareVerification.rawData.enrollments.map((enrollment: any, idx: number) => (
                            <p key={idx} className="truncate" title={enrollment.providerTypeDesc}>
                              &bull; {enrollment.state}: {enrollment.providerTypeDesc?.replace('PRACTITIONER - ', '')}
                              {enrollment.enrollmentDate && ` (${enrollment.enrollmentDate})`}
                            </p>
                          ))}
                        </div>
                      )}

                      {provider.medicareVerification.rawData?.orderingPrivileges && (
                        <div className="text-xs text-gray-500 space-y-0.5 mb-2">
                          <p className="font-medium text-gray-600">Ordering Privileges:</p>
                          {provider.medicareVerification.rawData.orderingPrivileges.partB && <p>&#10003; Part B</p>}
                          {provider.medicareVerification.rawData.orderingPrivileges.dme && <p>&#10003; DME</p>}
                          {provider.medicareVerification.rawData.orderingPrivileges.hha && <p>&#10003; Home Health</p>}
                          {provider.medicareVerification.rawData.orderingPrivileges.pmd && <p>&#10003; PMD</p>}
                          {provider.medicareVerification.rawData.orderingPrivileges.hospice && <p>&#10003; Hospice</p>}
                        </div>
                      )}

                      {provider.medicareVerification.verifiedAt && (
                        <p className="text-xs text-gray-400 mt-2">
                          Verified: {format(new Date(provider.medicareVerification.verifiedAt), 'MMM d, yyyy')}
                        </p>
                      )}
                    </div>
                  ) : medicareEnrollment?.found ? (
                    <div>
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 mb-2">
                        Not Persisted
                      </span>
                      <p className="text-xs text-gray-500">
                        Live CMS data available. Click Verify to save to database.
                      </p>
                    </div>
                  ) : (
                    <div>
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                        Unverified
                      </span>
                      <p className="text-xs text-gray-500 mt-2">
                        Click Verify to check Medicare enrollment status.
                      </p>
                    </div>
                  )}
                </div>
```

**Step 2: Update the provider detail query to include medicareVerification**

The provider detail query (around line 175-181) fetches the full provider object. The backend `GET /providers/:id` endpoint should already return `medicareVerification` if we add it to the include. Check if this needs updating — if the detail endpoint uses `include`, add `medicareVerification: true`.

Look at the provider detail endpoint in `provider.routes.ts` (the `GET /:id` handler) and add to its `include`:

```typescript
          medicareVerification: true,
```

**Step 3: Test manually**

- Navigate to a provider detail page
- Verify the Medicare section appears in the sidebar
- Click "Verify" and confirm it calls the endpoint
- Check that the badge updates after verification

**Step 4: Commit**

```bash
git add packages/frontend/src/features/providers/ProviderDetail.tsx packages/backend/src/routes/provider.routes.ts
git commit -m "feat: enhanced Medicare section on provider detail page"
```

---

## Task 7: Frontend — Provider List Medicare Column + Filter

**Files:**
- Modify: `packages/frontend/src/features/providers/ProviderList.tsx`

**Step 1: Add Medicare filter dropdown**

Import the batch hook:

```typescript
import { useVerifyMedicareBatch } from '../../hooks/useMedicareVerification';
```

Add state and hook inside the component:

```typescript
const medicareStatus = searchParams.get('medicareStatus') || '';
const verifyBatchMutation = useVerifyMedicareBatch();
```

Add the query param to the fetch:

```typescript
if (medicareStatus) params.set('medicareStatus', medicareStatus);
```

Add the queryKey dependency:

```typescript
queryKey: ['providers', { search, status, medicareStatus, page }],
```

Add the Medicare filter dropdown after the existing status `<select>`:

```tsx
            <select
              className="input w-44"
              value={medicareStatus}
              onChange={(e) => {
                setSearchParams((prev) => {
                  if (e.target.value) prev.set('medicareStatus', e.target.value);
                  else prev.delete('medicareStatus');
                  prev.set('page', '1');
                  return prev;
                });
              }}
            >
              <option value="">All Medicare</option>
              <option value="ENROLLED">Enrolled</option>
              <option value="NOT_ENROLLED">Not Enrolled</option>
              <option value="UNVERIFIED">Unverified</option>
            </select>
```

Add a "Verify All" button after the filter bar (inside the form, before `</form>`):

```tsx
            <button
              type="button"
              onClick={() => {
                const ids = data?.data?.map((p: Provider) => p.id) || [];
                if (ids.length > 0) verifyBatchMutation.mutate(ids);
              }}
              disabled={verifyBatchMutation.isPending || !data?.data?.length}
              className="btn-secondary whitespace-nowrap"
            >
              {verifyBatchMutation.isPending ? 'Verifying...' : 'Verify All'}
            </button>
```

**Step 2: Add Medicare badge to card view**

In the card view (inside the `mt-4 flex items-center justify-between` div), add a Medicare badge:

```tsx
                    {provider.medicareVerification && (
                      <span className={clsx(
                        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                        provider.medicareVerification.status === 'ENROLLED' && 'bg-green-100 text-green-800',
                        provider.medicareVerification.status === 'NOT_ENROLLED' && 'bg-yellow-100 text-yellow-800',
                        (!provider.medicareVerification || provider.medicareVerification.status === 'UNVERIFIED') && 'bg-gray-100 text-gray-600',
                      )}>
                        {provider.medicareVerification.status === 'ENROLLED' ? 'Medicare' :
                         provider.medicareVerification.status === 'NOT_ENROLLED' ? 'No Medicare' : 'Unverified'}
                      </span>
                    )}
```

**Step 3: Add Medicare column to table view**

Add a new `<th>` header after the Status header:

```tsx
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Medicare
                </th>
```

Add matching `<td>` in the table row after the Status cell:

```tsx
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={clsx(
                        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                        provider.medicareVerification?.status === 'ENROLLED' && 'bg-green-100 text-green-800',
                        provider.medicareVerification?.status === 'NOT_ENROLLED' && 'bg-yellow-100 text-yellow-800',
                        (!provider.medicareVerification || provider.medicareVerification?.status === 'UNVERIFIED') && 'bg-gray-100 text-gray-600',
                      )}>
                        {provider.medicareVerification?.status === 'ENROLLED' ? 'Enrolled' :
                         provider.medicareVerification?.status === 'NOT_ENROLLED' ? 'Not Enrolled' : 'Unverified'}
                      </span>
                    </td>
```

**Step 4: Update Provider interface**

Add to the `Provider` interface at the top of the file:

```typescript
  medicareVerification?: {
    status: 'ENROLLED' | 'NOT_ENROLLED' | 'UNVERIFIED';
    verifiedAt: string | null;
  };
```

**Step 5: Test manually**

- Navigate to the Provider List
- Verify the Medicare filter dropdown appears
- Verify the Medicare column appears in table view
- Verify the Medicare badge appears in card view
- Click "Verify All" and confirm the batch endpoint is called

**Step 6: Commit**

```bash
git add packages/frontend/src/features/providers/ProviderList.tsx
git commit -m "feat: add Medicare status column and filter to provider list"
```

---

## Task 8: Final Integration Test + Cleanup

**Step 1: Start dev servers and do a full walkthrough**

```bash
cd /Users/kay/Documents/KAY
./start-dev.sh
```

Manual test checklist:
- [ ] Provider List shows Medicare filter and column
- [ ] "Verify All" triggers batch verification with toast feedback
- [ ] Filtering by Medicare status works (Enrolled/Not Enrolled/Unverified)
- [ ] Provider Detail shows enhanced Medicare sidebar section
- [ ] "Verify" button on detail page works and updates display
- [ ] Stale indicator shows when verification is >30 days old
- [ ] Provider without NPI shows appropriate messaging
- [ ] No console errors

**Step 2: Run all backend tests**

```bash
cd /Users/kay/Documents/KAY
npx vitest run --workspace=packages/backend
```

Expected: All tests pass.

**Step 3: Final commit (if any cleanup needed)**

```bash
git add -A
git commit -m "chore: integration cleanup for PECOS medicare compliance"
```

**Step 4: Create PR branch and push**

```bash
git checkout -b feat/pecos-medicare-compliance
git push -u origin feat/pecos-medicare-compliance
gh pr create --title "feat: PECOS Medicare compliance verification" --body "$(cat <<'EOF'
## Summary
- New `MedicareVerification` Prisma model for persisting CMS PECOS data
- `POST /pecos/verify/:providerId` and `POST /pecos/verify-batch` endpoints
- Enhanced Provider Detail Medicare sidebar with enrollment records, ordering privileges, stale indicator
- Provider List gets Medicare Status column, filter dropdown, and "Verify All" bulk action

## Test plan
- [ ] Provider List: Medicare filter dropdown works (Enrolled/Not Enrolled/Unverified)
- [ ] Provider List: "Verify All" button triggers batch verification
- [ ] Provider Detail: Medicare section shows enrollment data from DB
- [ ] Provider Detail: "Verify" button calls CMS and updates record
- [ ] Provider Detail: Stale badge shows when >30 days since verification
- [ ] Backend: `medicareVerification.service.test.ts` passes

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
