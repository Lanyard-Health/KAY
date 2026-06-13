import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request context propagated implicitly through the async call tree.
 *
 * The request-id middleware opens a context at the top of each HTTP request;
 * anything that runs inside that request — services, Prisma calls, the logger,
 * morgan's finish handler — can read the same requestId without it being
 * threaded through every function signature. Outside a request (cron jobs,
 * workers, startup) the store is undefined and readers fall back gracefully.
 */
export interface RequestContext {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Run `fn` (and everything it awaits) inside a context carrying `ctx`. */
export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** The current request's id, or undefined when not inside a request. */
export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}
