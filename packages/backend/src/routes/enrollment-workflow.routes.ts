/**
 * Enrollment Workflow Routes
 *
 * New endpoints:
 *   GET    /:id/workflow          - Get workflow steps + progress
 *   PUT    /:id/workflow/:stepId   - Update a step's status
 *   POST   /:id/workflow/hydrate   - Manually hydrate steps
 *   GET    /workflow/templates/:payerWorkflowKey - Preview available templates
 */

import { Router, Request, Response } from 'express';
import { WorkflowStepStatus, WorkflowType } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { authenticate } from '../middleware/auth.middleware.js';
import {
  hydrateWorkflowSteps,
  updateStepStatus,
  getWorkflowProgress,
  getAvailableWorkflows,
  getActionTypeConfig,
} from '../services/workflow-hydration.service.js';
import { resolveWorkflowType } from '../config/workflow-mapping.js';

const router = Router();

// ============================================================
// GET /:id/workflow
// Returns all workflow steps + progress summary for an enrollment
// ============================================================
router.get('/:id/workflow', authenticate, async (req: Request, res: Response) => {
  try {
    const id = req.params['id']!;

    const enrollment = await prisma.payerEnrollment.findUnique({
      where: { id },
      include: {
        payer: { select: { id: true, name: true, workflowKey: true } },
        provider: { select: { id: true, firstName: true, lastName: true, providerType: true } },
      },
    });

    if (!enrollment) {
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
        payerWorkflowKey: enrollment.payer.workflowKey,
        providerName: `${enrollment.provider.firstName} ${enrollment.provider.lastName}`,
        providerType: enrollment.provider.providerType,
      },
      steps,
      progress,
      actionTypeConfig: getActionTypeConfig(),
    });
  } catch (error) {
    console.error('Error fetching workflow:', error);
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
  async (req: Request, res: Response) => {
    try {
      const id = req.params['id']!;
      const stepId = req.params['stepId']!;
      const { status, notes, skippedReason } = req.body;
      const userId = (req as any).user?.id;

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
      console.error('Error updating workflow step:', error);
      return res.status(500).json({ error: 'Failed to update workflow step' });
    }
  }
);

// ============================================================
// POST /:id/workflow/hydrate
// Manually hydrate workflow steps for existing enrollments
// ============================================================
router.post(
  '/:id/workflow/hydrate',
  authenticate,
  async (req: Request, res: Response) => {
    try {
      const id = req.params['id']!;
      const { workflowType } = req.body;

      const enrollment = await prisma.payerEnrollment.findUnique({
        where: { id },
        include: {
          payer: true,
          provider: true,
          workflowSteps: { take: 1 },
        },
      });

      if (!enrollment) {
        return res.status(404).json({ error: 'Enrollment not found' });
      }

      if (enrollment.workflowSteps && enrollment.workflowSteps.length > 0) {
        return res.status(409).json({
          error: 'Workflow steps already exist for this enrollment. Delete them first or update individually.',
        });
      }

      const payerWorkflowKey = enrollment.payer.workflowKey;
      if (!payerWorkflowKey) {
        return res.status(422).json({
          error: `Payer "${enrollment.payer.name}" does not have a workflow template configured.`,
        });
      }

      const resolvedType = workflowType
        ? (workflowType as WorkflowType)
        : resolveWorkflowType(
            enrollment.provider.providerType,
            payerWorkflowKey
          );

      const result = await hydrateWorkflowSteps(
        prisma,
        id,
        payerWorkflowKey,
        resolvedType
      );

      await prisma.payerEnrollment.update({
        where: { id },
        data: { workflowType: resolvedType },
      });

      return res.json({
        message: `Created ${result.stepsCreated} workflow steps`,
        workflowType: resolvedType,
        ...result,
      });
    } catch (error) {
      console.error('Error hydrating workflow:', error);
      return res.status(500).json({ error: 'Failed to hydrate workflow' });
    }
  }
);

// ============================================================
// GET /workflow/templates/:payerWorkflowKey
// Preview available workflow templates for a payer
// ============================================================
router.get(
  '/workflow/templates/:payerWorkflowKey',
  authenticate,
  async (req: Request, res: Response) => {
    try {
      const payerWorkflowKey = req.params['payerWorkflowKey']!;
      const workflows = getAvailableWorkflows(payerWorkflowKey);

      if (!workflows) {
        return res.status(404).json({
          error: `No workflow templates found for key "${payerWorkflowKey}"`,
        });
      }

      return res.json({ payerWorkflowKey, workflows });
    } catch (error) {
      console.error('Error fetching templates:', error);
      return res.status(500).json({ error: 'Failed to fetch templates' });
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

  const enrollment = await prisma.payerEnrollment.findUnique({
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
    await prisma.payerEnrollment.update({
      where: { id: enrollmentId },
      data: { status: newStatus as any },
    });
  }
}

export default router;
