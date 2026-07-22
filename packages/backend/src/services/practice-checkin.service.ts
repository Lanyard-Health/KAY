import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';

const QUIET_DAYS = 7; // D13: a practice is "quiet" after 7 untouched days
const DUE_IN_DAYS = 3; // D20: check-in tasks are due 3 days after creation
const DAY_MS = 86_400_000;

/**
 * Daily practice check-in sweep (D13, D17, D19, D20). Injectable clock for
 * boundary tests. Last touch is derived FRESH per run (D19 automatic):
 *   max(completedAt of practice-linked COMPLETED tasks) ?? onboardedAt ?? createdAt
 * ANY completed practice-linked task resets the 7-day clock — the check-in
 * task itself included, so busy practices never accumulate redundant
 * reminders. At most one open CHECK_IN per practice. No notifications —
 * pool tasks don't notify (v1 convention).
 */
export async function runPracticeCheckInSweep(now: Date = new Date()): Promise<{ practicesChecked: number; created: number }> {
  const practices = await prisma.practice.findMany({
    where: { status: 'ACTIVE', isDemo: false, deletedAt: null },
    select: { id: true, name: true, onboardedAt: true, createdAt: true },
  });

  let created = 0;
  for (const practice of practices) {
    const lastCompleted = await prisma.task.findFirst({
      where: { practiceId: practice.id, status: 'COMPLETED', completedAt: { not: null } },
      orderBy: { completedAt: 'desc' },
      select: { completedAt: true },
    });
    const lastTouch = lastCompleted?.completedAt ?? practice.onboardedAt ?? practice.createdAt;
    const quietDays = Math.floor((now.getTime() - lastTouch.getTime()) / DAY_MS);
    if (quietDays < QUIET_DAYS) continue;

    const openCheckIn = await prisma.task.findFirst({
      where: { practiceId: practice.id, taskGroup: 'CHECK_IN', status: { in: ['PENDING', 'IN_PROGRESS'] } },
      select: { id: true },
    });
    if (openCheckIn) continue; // dedup: at most one open check-in per practice

    await prisma.task.create({
      data: {
        title: `Weekly check-in — ${practice.name}`, // D17 exact format — NOT the group-title formula
        description: `No contact in ${quietDays} days`,
        taskGroup: 'CHECK_IN',
        type: 'CUSTOM',
        status: 'PENDING',
        priority: 'NORMAL',
        practiceId: practice.id,
        assignedToId: null, // lands unassigned in the Task Pool (D17)
        createdById: null, // v1 system-created convention
        dueDate: new Date(now.getTime() + DUE_IN_DAYS * DAY_MS),
      },
    });
    created++;
  }

  logger.info(`[CheckIn] Sweep complete: practicesChecked=${practices.length} created=${created}`);
  return { practicesChecked: practices.length, created };
}
