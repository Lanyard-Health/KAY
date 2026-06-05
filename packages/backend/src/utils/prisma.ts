import { PrismaClient } from '@prisma/client';
import { logger } from './logger.js';

declare global {
  // eslint-disable-next-line no-var
  var prismaBase: PrismaClient | undefined;
}

const SLOW_QUERY_THRESHOLD_MS = 500;

// Base client (no soft-delete filter). Use this ONLY for the three documented bypass cases:
//   1. `restoreProvider()` — must find soft-deleted rows to clear deletedAt.
//   2. `GET /providers?status=archived` — intentionally returns soft-deleted rows.
//   3. `practiceScope` middleware provider-by-id lookup — must locate soft-deleted rows so the
//      restore route can apply tenant scoping to them.
// Everywhere else: import `prisma` (the extended client) instead.
export const prismaBase = globalThis.prismaBase ?? new PrismaClient({
  log: process.env['NODE_ENV'] === 'development'
    ? [
        { emit: 'event', level: 'query' },
        { emit: 'stdout', level: 'info' },
        { emit: 'stdout', level: 'warn' },
        { emit: 'stdout', level: 'error' },
      ]
    : [
        { emit: 'event', level: 'query' },
        { emit: 'stdout', level: 'error' },
      ],
});

prismaBase.$on('query' as never, (e: { query: string; params: string; duration: number }) => {
  if (e.duration >= SLOW_QUERY_THRESHOLD_MS) {
    logger.warn(`Slow query (${e.duration}ms): ${e.query}`, {
      duration: e.duration,
      params: e.params,
    });
  }
});

if (process.env['NODE_ENV'] !== 'production') {
  globalThis.prismaBase = prismaBase;
}

// Default app client — auto-injects `deletedAt: null` into every top-level ProviderProfile
// read. Does NOT cover:
//   - Nested includes through relations (e.g. `practice.findMany({ include: { providers: true }})`
//     — fix at the call site with `include: { providers: { where: { deletedAt: null } } }`).
//   - Raw SQL (`$queryRaw` / `$executeRaw`) — fix at the call site with explicit
//     `WHERE deleted_at IS NULL`.
// See `.claude/plans/serialized-mapping-finch.md` amendment 1.
//
// Type cast back to PrismaClient: $extends returns a `DynamicClientExtensionThis` type that
// is structurally compatible but loses the `$on` / `$use` surface area at the type level.
// Existing call sites pass `prisma` into functions typed `PrismaClient`; the cast preserves
// that contract without losing the extension's runtime behavior (the query hooks still fire).
export const prisma: PrismaClient = prismaBase.$extends({
  name: 'providerSoftDeleteFilter',
  query: {
    providerProfile: {
      async findMany({ args, query }) {
        args.where = { ...(args.where ?? {}), deletedAt: null } as typeof args.where;
        return query(args);
      },
      async findFirst({ args, query }) {
        args.where = { ...(args.where ?? {}), deletedAt: null } as typeof args.where;
        return query(args);
      },
      async findFirstOrThrow({ args, query }) {
        args.where = { ...(args.where ?? {}), deletedAt: null } as typeof args.where;
        return query(args);
      },
      async findUnique({ args, query }) {
        // findUnique's where is typed as `ProviderProfileWhereUniqueInput`; Prisma's runtime
        // still applies extra filters, so we widen + reuse the same operation. If the row
        // exists but is soft-deleted, this returns null — the desired behavior.
        args.where = { ...(args.where ?? {}), deletedAt: null } as typeof args.where;
        return query(args);
      },
      async findUniqueOrThrow({ args, query }) {
        args.where = { ...(args.where ?? {}), deletedAt: null } as typeof args.where;
        return query(args);
      },
      async count({ args, query }) {
        args.where = { ...(args.where ?? {}), deletedAt: null } as typeof args.where;
        return query(args);
      },
      async aggregate({ args, query }) {
        args.where = { ...(args.where ?? {}), deletedAt: null } as typeof args.where;
        return query(args);
      },
      async groupBy({ args, query }) {
        args.where = { ...(args.where ?? {}), deletedAt: null } as typeof args.where;
        return query(args);
      },
    },
  },
}) as unknown as PrismaClient;
