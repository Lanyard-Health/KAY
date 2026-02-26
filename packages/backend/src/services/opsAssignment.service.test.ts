import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('../utils/cache.js', () => ({
  invalidateCache: vi.fn(),
}));

import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { invalidateCache } from '../utils/cache.js';
import {
  assignStaffToPractice,
  assignStaffToProvider,
  assignStaffToEnrollment,
  getAssignmentsForStaff,
  getAssignmentsForPractice,
  removeAssignment,
  transferAssignments,
  updateServiceTier,
  getActiveAssignments,
} from './opsAssignment.service.js';

const mockAssignment = {
  id: 'assign-1',
  staffId: 'staff-1',
  practiceId: 'practice-1',
  providerId: null,
  enrollmentId: null,
  assignedById: 'admin-1',
  assignedAt: new Date(),
  unassignedAt: null,
  staff: { id: 'staff-1', firstName: 'Alice', lastName: 'Jones' },
  practice: { id: 'practice-1', name: 'Main Practice' },
};

const mockProviderAssignment = {
  id: 'assign-2',
  staffId: 'staff-1',
  practiceId: null,
  providerId: 'provider-1',
  enrollmentId: null,
  assignedById: 'admin-1',
  assignedAt: new Date(),
  unassignedAt: null,
  staff: { id: 'staff-1', firstName: 'Alice', lastName: 'Jones' },
  provider: { id: 'provider-1', firstName: 'Bob', lastName: 'Smith' },
};

const mockEnrollmentAssignment = {
  id: 'assign-3',
  staffId: 'staff-1',
  practiceId: null,
  providerId: null,
  enrollmentId: 'enrollment-1',
  assignedById: 'admin-1',
  assignedAt: new Date(),
  unassignedAt: null,
  staff: { id: 'staff-1', firstName: 'Alice', lastName: 'Jones' },
  enrollment: {
    id: 'enrollment-1',
    status: 'pending',
    payer: { id: 'payer-1', name: 'Aetna' },
  },
};

describe('opsAssignment.service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('assignStaffToPractice', () => {
    it('creates assignment with correct data and include, invalidates cache, returns assignment', async () => {
      prismaMock.opsAssignment.create.mockResolvedValue(mockAssignment as any);

      const result = await assignStaffToPractice('staff-1', 'practice-1', 'admin-1');

      expect(prismaMock.opsAssignment.create).toHaveBeenCalledWith({
        data: {
          staffId: 'staff-1',
          practiceId: 'practice-1',
          assignedById: 'admin-1',
        },
        include: {
          staff: { select: { id: true, firstName: true, lastName: true } },
          practice: { select: { id: true, name: true } },
        },
      });
      expect(invalidateCache).toHaveBeenCalledWith('ops:');
      expect(result).toEqual(mockAssignment);
    });
  });

  describe('assignStaffToProvider', () => {
    it('creates assignment with correct data and include, invalidates cache', async () => {
      prismaMock.opsAssignment.create.mockResolvedValue(mockProviderAssignment as any);

      const result = await assignStaffToProvider('staff-1', 'provider-1', 'admin-1');

      expect(prismaMock.opsAssignment.create).toHaveBeenCalledWith({
        data: {
          staffId: 'staff-1',
          providerId: 'provider-1',
          assignedById: 'admin-1',
        },
        include: {
          staff: { select: { id: true, firstName: true, lastName: true } },
          provider: { select: { id: true, firstName: true, lastName: true } },
        },
      });
      expect(invalidateCache).toHaveBeenCalledWith('ops:');
      expect(result).toEqual(mockProviderAssignment);
    });
  });

  describe('assignStaffToEnrollment', () => {
    it('creates assignment with correct data and include with payer select', async () => {
      prismaMock.opsAssignment.create.mockResolvedValue(mockEnrollmentAssignment as any);

      const result = await assignStaffToEnrollment('staff-1', 'enrollment-1', 'admin-1');

      expect(prismaMock.opsAssignment.create).toHaveBeenCalledWith({
        data: {
          staffId: 'staff-1',
          enrollmentId: 'enrollment-1',
          assignedById: 'admin-1',
        },
        include: {
          staff: { select: { id: true, firstName: true, lastName: true } },
          enrollment: {
            select: {
              id: true,
              status: true,
              payer: { select: { id: true, name: true } },
            },
          },
        },
      });
      expect(invalidateCache).toHaveBeenCalledWith('ops:');
      expect(result).toEqual(mockEnrollmentAssignment);
    });
  });

  describe('getAssignmentsForStaff', () => {
    it('groups results into practices, providers, and enrollments', async () => {
      const mixedAssignments = [
        { ...mockAssignment, practiceId: 'practice-1', providerId: null, enrollmentId: null },
        { ...mockProviderAssignment, practiceId: null, providerId: 'provider-1', enrollmentId: null },
        { ...mockEnrollmentAssignment, practiceId: null, providerId: null, enrollmentId: 'enrollment-1' },
      ];
      prismaMock.opsAssignment.findMany.mockResolvedValue(mixedAssignments as any);

      const result = await getAssignmentsForStaff('staff-1');

      expect(prismaMock.opsAssignment.findMany).toHaveBeenCalledWith({
        where: { staffId: 'staff-1', unassignedAt: null },
        include: {
          practice: { select: { id: true, name: true } },
          provider: { select: { id: true, firstName: true, lastName: true } },
          enrollment: {
            select: {
              id: true,
              status: true,
              payer: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { assignedAt: 'desc' },
      });
      expect(result.practices).toHaveLength(1);
      expect(result.providers).toHaveLength(1);
      expect(result.enrollments).toHaveLength(1);
    });

    it('returns empty arrays when no assignments exist', async () => {
      prismaMock.opsAssignment.findMany.mockResolvedValue([]);

      const result = await getAssignmentsForStaff('staff-1');

      expect(result).toEqual({ practices: [], providers: [], enrollments: [] });
    });
  });

  describe('getAssignmentsForPractice', () => {
    it('returns assignments filtered by practiceId', async () => {
      const practiceAssignments = [
        {
          ...mockAssignment,
          staff: { id: 'staff-1', firstName: 'Alice', lastName: 'Jones', email: 'alice@test.com' },
        },
      ];
      prismaMock.opsAssignment.findMany.mockResolvedValue(practiceAssignments as any);

      const result = await getAssignmentsForPractice('practice-1');

      expect(prismaMock.opsAssignment.findMany).toHaveBeenCalledWith({
        where: { practiceId: 'practice-1', unassignedAt: null },
        include: {
          staff: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
        orderBy: { assignedAt: 'desc' },
      });
      expect(result).toEqual(practiceAssignments);
    });
  });

  describe('removeAssignment', () => {
    it('updates with unassignedAt and invalidates cache', async () => {
      const removedAssignment = { ...mockAssignment, unassignedAt: new Date() };
      prismaMock.opsAssignment.update.mockResolvedValue(removedAssignment as any);

      const result = await removeAssignment('assign-1');

      expect(prismaMock.opsAssignment.update).toHaveBeenCalledWith({
        where: { id: 'assign-1' },
        data: { unassignedAt: expect.any(Date) },
      });
      expect(invalidateCache).toHaveBeenCalledWith('ops:');
      expect(result).toEqual(removedAssignment);
    });
  });

  describe('transferAssignments', () => {
    it('uses $transaction to update both opsAssignment and opsWorkItem', async () => {
      prismaMock.$transaction.mockResolvedValue([{ count: 3 }, { count: 2 }]);

      await transferAssignments('staff-1', 'staff-2');

      expect(prismaMock.$transaction).toHaveBeenCalledWith([
        prismaMock.opsAssignment.updateMany({
          where: { staffId: 'staff-1', unassignedAt: null },
          data: { staffId: 'staff-2' },
        }),
        prismaMock.opsWorkItem.updateMany({
          where: {
            assignedToId: 'staff-1',
            status: { notIn: ['done', 'cancelled'] },
          },
          data: { assignedToId: 'staff-2' },
        }),
      ]);
      expect(invalidateCache).toHaveBeenCalledWith('ops:');
    });

    it('returns correct count values', async () => {
      prismaMock.$transaction.mockResolvedValue([{ count: 3 }, { count: 2 }]);

      const result = await transferAssignments('staff-1', 'staff-2');

      expect(result).toEqual({
        assignmentsTransferred: 3,
        workItemsTransferred: 2,
      });
    });
  });

  describe('updateServiceTier', () => {
    it('updates practice with tier and invalidates cache', async () => {
      const updatedPractice = { id: 'practice-1', name: 'Main Practice', serviceTier: 'premium' };
      prismaMock.practice.update.mockResolvedValue(updatedPractice as any);

      const result = await updateServiceTier('practice-1', 'premium' as any);

      expect(prismaMock.practice.update).toHaveBeenCalledWith({
        where: { id: 'practice-1' },
        data: { serviceTier: 'premium' },
        select: { id: true, name: true, serviceTier: true },
      });
      expect(invalidateCache).toHaveBeenCalledWith('ops:');
      expect(result).toEqual(updatedPractice);
    });
  });

  describe('getActiveAssignments', () => {
    it('queries with unassignedAt=null only when no filters provided', async () => {
      prismaMock.opsAssignment.findMany.mockResolvedValue([]);

      await getActiveAssignments();

      expect(prismaMock.opsAssignment.findMany).toHaveBeenCalledWith({
        where: { unassignedAt: null },
        include: {
          staff: { select: { id: true, firstName: true, lastName: true } },
          practice: { select: { id: true, name: true } },
          provider: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { assignedAt: 'desc' },
      });
    });

    it('includes staffId filter when provided', async () => {
      prismaMock.opsAssignment.findMany.mockResolvedValue([]);

      await getActiveAssignments({ staffId: 'staff-1' });

      expect(prismaMock.opsAssignment.findMany).toHaveBeenCalledWith({
        where: { unassignedAt: null, staffId: 'staff-1' },
        include: expect.any(Object),
        orderBy: { assignedAt: 'desc' },
      });
    });

    it('includes practiceId filter when provided', async () => {
      prismaMock.opsAssignment.findMany.mockResolvedValue([]);

      await getActiveAssignments({ practiceId: 'practice-1' });

      expect(prismaMock.opsAssignment.findMany).toHaveBeenCalledWith({
        where: { unassignedAt: null, practiceId: 'practice-1' },
        include: expect.any(Object),
        orderBy: { assignedAt: 'desc' },
      });
    });

    it('includes both filters when both provided', async () => {
      prismaMock.opsAssignment.findMany.mockResolvedValue([]);

      await getActiveAssignments({ staffId: 'staff-1', practiceId: 'practice-1' });

      expect(prismaMock.opsAssignment.findMany).toHaveBeenCalledWith({
        where: { unassignedAt: null, staffId: 'staff-1', practiceId: 'practice-1' },
        include: expect.any(Object),
        orderBy: { assignedAt: 'desc' },
      });
    });
  });
});
