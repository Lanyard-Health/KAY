import { prisma } from './prisma.js';
import { logger } from './logger.js';
import type { UserContext } from './context.js';

/**
 * Resolve MCP_USER_EMAIL env var to a database User and build a UserContext.
 * Called once at startup — the identity is fixed for the lifetime of the process.
 */
export async function resolveUser(): Promise<UserContext> {
  const email = process.env['MCP_USER_EMAIL'];
  if (!email) {
    throw new Error('MCP_USER_EMAIL environment variable is required');
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      role: true,
      isActive: true,
      providerId: true,
    },
  });

  if (!user) {
    throw new Error(`User not found for email: ${email}`);
  }

  if (!user.isActive) {
    throw new Error(`User account is disabled: ${email}`);
  }

  const isSuperAdmin = user.role === 'admin';
  let practiceIds: string[] = [];

  if (!isSuperAdmin) {
    const assignments = await prisma.userPractice.findMany({
      where: { userId: user.id },
      select: { practiceId: true },
    });
    practiceIds = assignments.map((a) => a.practiceId);
  }

  logger.info(`Resolved user: ${email} (role=${user.role}, practices=${isSuperAdmin ? 'all' : practiceIds.length})`);

  return {
    userId: user.id,
    email: user.email,
    role: user.role,
    providerId: user.providerId ?? undefined,
    isSuperAdmin,
    practiceIds,
  };
}
