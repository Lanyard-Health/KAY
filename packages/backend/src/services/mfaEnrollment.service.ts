/**
 * Does this user actually have a second sign-in factor?
 *
 * Background: the production pool's `MfaConfiguration` was moved `ON` ->
 * `OPTIONAL` on 2026-08-12, because requiring MFA is what broke self-service
 * password reset (recovery pointed at the verified email while email was also a
 * factor, a pairing Cognito refuses). Reset works again, but Cognito no longer
 * forces anyone to enrol, so the app has to.
 *
 * The answer is always read from Cognito, never from our own database. A
 * client that says "I enrolled" proves nothing, and `users.mfa_enrolled_at` is
 * a timestamp for reporting, not an authorisation input.
 *
 * Two sources are needed because Cognito models the factors differently:
 *   - TOTP and email codes are MFA *settings* on the user, readable with admin
 *     credentials via AdminGetUser.
 *   - Passkeys are WebAuthn *credentials*, which have no admin-side read at
 *     all. ListWebAuthnCredentials is a user-pool API keyed on an access token,
 *     so it only works with the caller's own token — which is exactly what our
 *     bearer header carries (auth.middleware verifies `tokenUse: 'access'`).
 */
import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
  ListWebAuthnCredentialsCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { getCached, setCache, invalidateCache } from '../utils/cache.js';
import { logger } from '../utils/logger.js';

export type MfaMethod = 'authenticator' | 'email' | 'passkey';

export interface MfaEnrollmentStatus {
  enrolled: boolean;
  methods: MfaMethod[];
}

// Short enough that a user who just enrolled isn't locked out by a stale entry
// for long, long enough that a burst of requests costs one Cognito call.
// Enrollment explicitly busts the key anyway (see clearMfaStatusCache).
const TTL_MS = 60_000;
const cacheKey = (cognitoId: string) => `mfa-status:${cognitoId}`;

const DEV_BYPASS_ENABLED =
  process.env['DEV_AUTH_BYPASS'] === 'true' &&
  (process.env['NODE_ENV'] === 'development' || process.env['NODE_ENV'] === 'test');

let client: CognitoIdentityProviderClient | null = null;

function getClient(): CognitoIdentityProviderClient {
  if (!client) {
    const accessKeyId =
      process.env['COGNITO_AWS_ACCESS_KEY_ID'] || process.env['AWS_ACCESS_KEY_ID'];
    const secretAccessKey =
      process.env['COGNITO_AWS_SECRET_ACCESS_KEY'] || process.env['AWS_SECRET_ACCESS_KEY'];

    client = new CognitoIdentityProviderClient({
      region: process.env['COGNITO_AWS_REGION'] || process.env['AWS_REGION'] || 'us-east-1',
      ...(accessKeyId && secretAccessKey && accessKeyId !== 'test'
        ? { credentials: { accessKeyId, secretAccessKey } }
        : {}),
    });
  }
  return client;
}

/**
 * Passkeys only. Returns false rather than throwing when the pool has WebAuthn
 * switched off, which is its state until someone turns it on — an un-configured
 * pool is a pool with no passkeys, not an error worth failing a request over.
 */
async function hasPasskey(accessToken: string): Promise<boolean> {
  try {
    const res = await getClient().send(
      new ListWebAuthnCredentialsCommand({ AccessToken: accessToken, MaxResults: 1 }),
    );
    return (res.Credentials?.length ?? 0) > 0;
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'WebAuthnConfigurationMissingException' || name === 'WebAuthnNotEnabledException') {
      return false;
    }
    // Anything else is a genuine failure. Let the caller decide, rather than
    // silently reporting "no passkey" and pushing an enrolled user back into
    // the setup flow.
    throw error;
  }
}

/**
 * @param accessToken the caller's own Cognito access token; omit to skip the
 *   passkey check (an admin asking about someone else cannot see their
 *   passkeys, so the answer would be incomplete).
 */
export async function getMfaEnrollmentStatus(
  cognitoId: string,
  email: string,
  accessToken?: string,
): Promise<MfaEnrollmentStatus> {
  // Local dev has no Cognito at all — every seeded user would otherwise look
  // un-enrolled and get walled off from their own dev environment. The override
  // exists so the enrollment flow can actually be exercised locally; it is
  // nested inside the bypass check, so setting it in production does nothing.
  if (DEV_BYPASS_ENABLED) {
    return process.env['MFA_DEV_FORCE_UNENROLLED'] === 'true'
      ? { enrolled: false, methods: [] }
      : { enrolled: true, methods: ['authenticator'] };
  }

  const cached = getCached<MfaEnrollmentStatus>(cacheKey(cognitoId));
  if (cached) return cached;

  const poolId = process.env['COGNITO_USER_POOL_ID'];
  if (!poolId) throw new Error('COGNITO_USER_POOL_ID not configured');

  const user = await getClient().send(
    new AdminGetUserCommand({ UserPoolId: poolId, Username: email }),
  );

  const methods: MfaMethod[] = [];
  for (const setting of user.UserMFASettingList ?? []) {
    if (setting === 'SOFTWARE_TOKEN_MFA') methods.push('authenticator');
    if (setting === 'EMAIL_OTP') methods.push('email');
  }

  if (accessToken && (await hasPasskey(accessToken))) {
    methods.push('passkey');
  }

  const status: MfaEnrollmentStatus = { enrolled: methods.length > 0, methods };
  setCache(cacheKey(cognitoId), status, TTL_MS);
  return status;
}

/** Call after any enrollment or removal so the next check re-reads Cognito. */
export function clearMfaStatusCache(cognitoId: string): void {
  invalidateCache(cacheKey(cognitoId));
}

/**
 * How many times an account may dismiss the setup screen before it becomes a
 * wall. Kay's call, 2026-08-12: people already using the portal get a soft
 * landing, brand-new accounts have nothing to interrupt so they get none.
 *
 * "Existing" is decided by when the account was created, not by whether it has
 * signed in — an invited user who never got round to it is still someone whose
 * first impression shouldn't be a locked door.
 */
export const GRACE_SKIPS = 3;

export function allowedSkipsFor(createdAt: Date, cutoff: Date): number {
  return createdAt < cutoff ? GRACE_SKIPS : 0;
}

/**
 * Accounts created before this were already in the wild when enforcement
 * shipped. Anything created after is new and gets no grace.
 */
export function enforcementCutoff(): Date {
  const raw = process.env['MFA_ENFORCEMENT_CUTOFF'];
  const parsed = raw ? new Date(raw) : null;
  if (parsed && !Number.isNaN(parsed.getTime())) return parsed;
  if (raw) {
    logger.warn(`Ignoring unparseable MFA_ENFORCEMENT_CUTOFF: ${raw}`);
  }
  // ponytail: hardcoded ship date; the env var exists so staging can move it
  // without a deploy.
  return new Date('2026-08-13T00:00:00Z');
}
