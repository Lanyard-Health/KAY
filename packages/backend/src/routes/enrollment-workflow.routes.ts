/**
 * Enrollment Workflow Routes
 *
 * Endpoints:
 *   GET    /:id/workflow              - Get workflow steps + progress
 *   PUT    /:id/workflow/:stepId      - Update a step's status
 *   POST   /:id/workflow/hydrate      - Manually instantiate steps from the active template
 *
 * Post Phase-6: workflow templates are DB-backed only. The legacy
 * GET /workflow/templates/:payerWorkflowKey JSON preview endpoint was removed;
 * to browse available workflows, query workflow_templates joined to payer_tracks.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { WorkflowStepStatus } from '@prisma/client';
import type { EnrollmentStatus } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { notifyEnrollmentStatusChange } from '../services/enrollment-alerts.service.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { STAFF_ROLES } from '../constants/roles.js';
import { validateEnrollmentAccess } from '../middleware/practiceScope.middleware.js';
import { subjectName } from '../utils/enrollmentSubject.js';
import {
  updateStepStatus,
  getWorkflowProgress,
  getActionTypeConfig,
} from '../services/workflow-hydration.service.js';
import { instantiateWorkflow } from '../services/workflow-instantiation.service.js';
import { logger } from '../utils/logger.js';
import { setAuditContext } from '../middleware/audit.middleware.js';

const router = Router();

const updateStepSchema = z.object({
  status: z.enum(['not_started', 'in_progress', 'completed', 'skipped', 'blocked']),
  notes: z.union([z.string().max(2000), z.null()]).optional().transform((v) => v === null ? undefined : v),
  skippedReason: z.union([z.string().max(500), z.null()]).optional().transform((v) => v === null ? undefined : v),
});

// ============================================================
// GET /:id/workflow
// Returns all workflow steps + progress summary for an enrollment
// ============================================================
router.get('/:id/workflow', authenticate, authorize(...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    const id = req.params['id']!;

    const enrollment = await prisma.enrollment.findUnique({
      where: { id },
      include: {
        payer: { select: { id: true, name: true } },
        provider: { select: { id: true, firstName: true, lastName: true, providerType: true } },
        practice: { select: { name: true } },
      },
    });

    if (!enrollment) {
      return res.status(404).json({ error: 'Enrollment not found' });
    }

    // Verify user has access to this enrollment's subject (provider or practice).
    // Cross-practice denial maps to the same 404 as a missing enrollment — don't
    // reveal existence to a caller outside its practice.
    if (!(await validateEnrollmentAccess(req, enrollment))) {
      return res.status(404).json({ error: 'Enrollment not found' });
    }

    const steps = await prisma.enrollmentWorkflowStep.findMany({
      where: { enrollmentId: id },
      orderBy: { stepOrder: 'asc' },
      include: {
        completedBy: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });

    const progress = await getWorkflowProgress(prisma, id);

    return res.json({
      enrollment: {
        id: enrollment.id,
        status: enrollment.status,
        workflowType: enrollment.workflowType,
        payerName: enrollment.payer.name,
        providerName: subjectName(enrollment.provider, enrollment.practice),
        providerType: enrollment.provider?.providerType ?? null,
      },
      steps,
      progress,
      actionTypeConfig: getActionTypeConfig(),
    });
  } catch (error) {
    logger.error('Error fetching workflow:', error);
    return res.status(500).json({ error: 'Failed to fetch workflow' });
  }
});

// ============================================================
// PUT /:id/workflow/:stepId
// Update a workflow step's status
// ============================================================
router.put(
  '/:id/workflow/:stepId',
  authenticate,
  authorize(...STAFF_ROLES),
  async (req: Request, res: Response) => {
    try {
      const id = req.params['id']!;
      const stepId = req.params['stepId']!;
      const { status, notes, skippedReason } = updateStepSchema.parse(req.body);
      setAuditContext(req, { resourceType: 'workflow_step', resourceId: stepId, action: 'update' });
      const userId = (req as any).user?.id;

      // Verify practice access via the enrollment's provider
      const enrollment = await prisma.enrollment.findUnique({
        where: { id },
        select: { providerId: true, practiceId: true },
      });
      if (!enrollment) {
        return res.status(404).json({ error: 'Enrollment not found' });
      }
      // Cross-practice denial maps to the same 404 as a missing enrollment —
      // don't reveal existence to a caller outside its practice.
      if (!(await validateEnrollmentAccess(req, enrollment))) {
        return res.status(404).json({ error: 'Enrollment not found' });
      }

      const step = await prisma.enrollmentWorkflowStep.findFirst({
        where: { id: stepId, enrollmentId: id },
      });

      if (!step) {
        return res.status(404).json({ error: 'Workflow step not found' });
      }

      // Validate status transition
      const validTransitions: Record<string, string[]> = {
        not_started: ['in_progress', 'skipped'],
        in_progress: ['completed', 'skipped', 'blocked', 'not_started'],
        blocked: ['not_started', 'in_progress', 'skipped'],
        skipped: ['not_started'],
        completed: ['not_started'],
      };

      const allowed = validTransitions[step.status] || [];
      if (!allowed.includes(status)) {
        return res.status(400).json({
          error: `Cannot transition from "${step.status}" to "${status}". Allowed: ${allowed.join(', ')}`,
        });
      }

      if (status === 'skipped' && !skippedReason) {
        return res.status(400).json({
          error: 'skippedReason is required when skipping a step',
        });
      }

      await updateStepStatus(prisma, stepId, status as WorkflowStepStatus, userId, notes);

      if (status === 'skipped') {
        await prisma.enrollmentWorkflowStep.update({
          where: { id: stepId },
          data: { skippedReason },
        });
      }

      // Auto-advance enrollment status based on workflow progress
      await syncEnrollmentStatus(id);

      const updatedSteps = await prisma.enrollmentWorkflowStep.findMany({
        where: { enrollmentId: id },
        orderBy: { stepOrder: 'asc' },
      });
      const progress = await getWorkflowProgress(prisma, id);

      return res.json({ steps: updatedSteps, progress });
    } catch (error) {
      logger.error('Error updating workflow step:', error);
      return res.status(500).json({ error: 'Failed to update workflow step' });
    }
  }
);

// ============================================================
// POST /:id/workflow/hydrate
// Manually instantiate workflow steps from the active DB template
// (for enrollments created before the hook ran, or after step deletion).
// ============================================================
router.post(
  '/:id/workflow/hydrate',
  authenticate,
  authorize(...STAFF_ROLES),
  async (req: Request, res: Response) => {
    try {
      const id = req.params['id']!;
      setAuditContext(req, { resourceType: 'workflow_step', resourceId: id, action: 'create' });

      const enrollment = await prisma.enrollment.findUnique({
        where: { id },
        include: {
          payer: { select: { name: true } },
          provider: { select: { id: true, providerType: true } },
          workflowSteps: { take: 1 },
        },
      });

      if (!enrollment) {
        return res.status(404).json({ error: 'Enrollment not found' });
      }

      // Verify practice access via the enrollment's subject (provider or practice).
      // Cross-practice denial maps to the same 404 as a missing enrollment — don't
      // reveal existence to a caller outside its practice.
      if (!(await validateEnrollmentAccess(req, enrollment))) {
        return res.status(404).json({ error: 'Enrollment not found' });
      }

      if (enrollment.workflowSteps && enrollment.workflowSteps.length > 0) {
        return res.status(409).json({
          error: 'Workflow steps already exist for this enrollment. Delete them first or update individually.',
        });
      }

      if (!enrollment.payerTrackId) {
        return res.status(422).json({
          error: `Enrollment for payer "${enrollment.payer.name}" has no payerTrackId set; cannot resolve a workflow template.`,
        });
      }

      const payerTrack = await prisma.payerTrack.findUnique({
        where: { id: enrollment.payerTrackId },
        select: { stateRegion: true },
      });

      const result = await instantiateWorkflow(prisma, id, enrollment.payerTrackId, {
        state: payerTrack?.stateRegion ?? undefined,
        providerType: enrollment.provider?.providerType ?? undefined,
      });

      if (!result.templateFound) {
        return res.status(404).json({
          error: `No active WorkflowTemplate found for the enrollment's PayerTrack.`,
        });
      }

      return res.json({
        message: `Created ${result.stepsCreated} workflow steps`,
        templateId: result.templateId,
        templateName: result.templateName,
        stepsCreated: result.stepsCreated,
        conditionsApplied: result.conditionsApplied,
      });
    } catch (error) {
      logger.error('Error hydrating workflow:', error);
      return res.status(500).json({ error: 'Failed to hydrate workflow' });
    }
  }
);

// ============================================================
// Helper: Sync enrollment status based on workflow progress
// ============================================================
async function syncEnrollmentStatus(enrollmentId: string): Promise<void> {
  const steps = await prisma.enrollmentWorkflowStep.findMany({
    where: { enrollmentId },
  });

  if (steps.length === 0) return;

  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
  });

  if (!enrollment) return;

  const terminalStatuses = ['approved', 'denied', 'terminated'];
  if (terminalStatuses.includes(enrollment.status)) return;

  const allNotStarted = steps.every((s) => s.status === 'not_started');
  const anyInProgress = steps.some(
    (s) => s.status === 'in_progress' || s.status === 'completed'
  );
  const allDone = steps.every(
    (s) => s.status === 'completed' || s.status === 'skipped'
  );

  let newStatus: string | null = null;

  if (allNotStarted && enrollment.status === 'not_started') {
    return;
  } else if (anyInProgress && enrollment.status === 'not_started') {
    newStatus = 'in_progress';
  } else if (allDone && enrollment.status === 'in_progress') {
    newStatus = 'submitted';
  }

  if (newStatus) {
    await prisma.enrollment.update({
      where: { id: enrollmentId },
      data: { status: newStatus as any },
    });

    // Practice-facing alerts + audit trail for the auto-advance transition —
    // each independently fire-and-forget. System-initiated: no actor.
    void notifyEnrollmentStatusChange({
      enrollmentId,
      oldStatus: enrollment.status,
      newStatus: newStatus as EnrollmentStatus,
      actorUserId: null,
    });
    prisma.auditLog.create({
      data: {
        userId: null,
        action: 'update',
        resourceType: 'enrollment',
        resourceId: enrollmentId,
        changes: { field: 'status', from: enrollment.status, to: newStatus, source: 'workflow_auto_advance' },
      },
    }).catch((err) => logger.error('Workflow auto-advance audit log failed:', err));
  }
}

export default router;
