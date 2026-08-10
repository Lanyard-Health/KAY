import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminSetUserPasswordCommand,
  AdminUpdateUserAttributesCommand,
  AdminGetUserCommand,
  MessageActionType,
} from '@aws-sdk/client-cognito-identity-provider';
import { logger } from '../utils/logger.js';

// Fail-closed: bypass only activates when NODE_ENV is the literal 'development' or 'test'.
const DEV_BYPASS_ENABLED =
  process.env['DEV_AUTH_BYPASS'] === 'true' &&
  (process.env['NODE_ENV'] === 'development' || process.env['NODE_ENV'] === 'test');

// Lazy-init the client (not needed in dev bypass mode)
let client: CognitoIdentityProviderClient | null = null;

function getClient(): CognitoIdentityProviderClient {
  if (!client) {
    const accessKeyId = process.env['COGNITO_AWS_ACCESS_KEY_ID'] || process.env['AWS_ACCESS_KEY_ID'];
    const secretAccessKey = process.env['COGNITO_AWS_SECRET_ACCESS_KEY'] || process.env['AWS_SECRET_ACCESS_KEY'];

    client = new CognitoIdentityProviderClient({
      region: process.env['COGNITO_AWS_REGION'] || process.env['AWS_REGION'] || 'us-east-1',
      ...(accessKeyId && secretAccessKey && accessKeyId !== 'test' ? {
        credentials: { accessKeyId, secretAccessKey },
      } : {}),
    });
  }
  return client;
}

function getUserPoolId(): string {
  const poolId = process.env['COGNITO_USER_POOL_ID'];
  if (!poolId) throw new Error('COGNITO_USER_POOL_ID not configured');
  return poolId;
}

export interface CognitoCreateUserInput {
  email: string;
  firstName: string;
  lastName: string;
  temporaryPassword?: string;
  suppressInviteEmail?: boolean;
  /**
   * Re-send the invite to a user who already exists, with a fresh temporary
   * password. Cognito rejects this for anyone past FORCE_CHANGE_PASSWORD
   * (UnsupportedUserStateException), which is the behaviour we want — it can't
   * clobber the password of someone who already signed in. Ignored when
   * suppressInviteEmail is set; the two MessageActions are mutually exclusive.
   */
  resendInvite?: boolean;
}

export interface CognitoCreateUserResult {
  cognitoId: string;
}

/**
 * Create a user in Cognito User Pool.
 * In dev bypass mode, returns a generated dev ID instead.
 */
export async function createCognitoUser(
  input: CognitoCreateUserInput
): Promise<CognitoCreateUserResult> {
  if (DEV_BYPASS_ENABLED) {
    const devId = `dev-${crypto.randomUUID()}`;
    logger.info(`[DEV] Skipping Cognito — generated cognitoId: ${devId}`);
    return { cognitoId: devId };
  }

  const command = new AdminCreateUserCommand({
    UserPoolId: getUserPoolId(),
    Username: input.email,
    UserAttributes: [
      { Name: 'email', Value: input.email },
      { Name: 'email_verified', Value: 'true' },
      { Name: 'name', Value: `${input.firstName} ${input.lastName}` },
      { Name: 'given_name', Value: input.firstName },
      { Name: 'family_name', Value: input.lastName },
    ],
    ...(input.temporaryPassword && {
      TemporaryPassword: input.temporaryPassword,
    }),
    MessageAction: input.suppressInviteEmail
      ? MessageActionType.SUPPRESS
      : input.resendInvite
        ? MessageActionType.RESEND
        : undefined,
    DesiredDeliveryMediums: ['EMAIL'],
  });

  const result = await getClient().send(command);

  const sub = result.User?.Attributes?.find(
    (attr) => attr.Name === 'sub'
  )?.Value;

  if (!sub) {
    throw new Error('Cognito user created but no sub returned');
  }

  logger.info(`Cognito user created: ${input.email}`);
  return { cognitoId: sub };
}

/**
 * Put an existing user back to a fresh temporary password and email them the
 * invite again.
 *
 * This exists because self-service "Forgot password" is unusable on this pool:
 * Cognito refuses to recover an account through the same medium that's enabled
 * as an MFA factor, and email is both our only recovery mechanism and an MFA
 * option. ForgotPassword therefore returns
 *   InvalidParameterException: Cannot reset password for the user as there is
 *   no registered/verified email or phone_number
 * for every user, even with email_verified=true. Confirmed against the prod pool
 * on 2026-06-20 and again 2026-08-06. Until MFA goes OPTIONAL or an SMS recovery
 * factor is added, this admin path is the only way to get a locked-out customer
 * back in.
 *
 * Two steps, because neither alone is enough: AdminSetUserPassword returns the
 * account to FORCE_CHANGE_PASSWORD (RESEND is rejected for CONFIRMED users), and
 * AdminCreateUser/RESEND then has Cognito mint its own temporary password and
 * mail it. No credential is ever returned to us, logged, or handled by staff.
 */
export async function reissueTemporaryPassword(email: string): Promise<void> {
  if (DEV_BYPASS_ENABLED) {
    logger.info(`[DEV] Skipping Cognito invite re-issue for ${email}`);
    return;
  }

  const UserPoolId = getUserPoolId();

  // Discarded immediately — Cognito replaces it in the RESEND below.
  const throwaway = `Aa1!${crypto.randomUUID()}`;

  await getClient().send(
    new AdminSetUserPasswordCommand({
      UserPoolId,
      Username: email,
      Password: throwaway,
      Permanent: false,
    })
  );

  await getClient().send(
    new AdminCreateUserCommand({
      UserPoolId,
      Username: email,
      MessageAction: MessageActionType.RESEND,
      DesiredDeliveryMediums: ['EMAIL'],
    })
  );

  logger.info(`Cognito invite re-issued: ${email}`);
}

/**
 * Disable a Cognito user (prevents login).
 */
export async function disableCognitoUser(email: string): Promise<void> {
  if (DEV_BYPASS_ENABLED) {
    logger.info('[DEV] Skipping Cognito disable');
    return;
  }

  await getClient().send(
    new AdminDisableUserCommand({
      UserPoolId: getUserPoolId(),
      Username: email,
    })
  );

  logger.info(`Cognito user disabled: ${email}`);
}

/**
 * Enable a previously disabled Cognito user.
 */
export async function enableCognitoUser(email: string): Promise<void> {
  if (DEV_BYPASS_ENABLED) {
    logger.info('[DEV] Skipping Cognito enable');
    return;
  }

  await getClient().send(
    new AdminEnableUserCommand({
      UserPoolId: getUserPoolId(),
      Username: email,
    })
  );

  logger.info(`Cognito user enabled: ${email}`);
}

/**
 * Delete a Cognito user entirely.
 */
export async function deleteCognitoUser(email: string): Promise<void> {
  if (DEV_BYPASS_ENABLED) {
    logger.info('[DEV] Skipping Cognito delete');
    return;
  }

  await getClient().send(
    new AdminDeleteUserCommand({
      UserPoolId: getUserPoolId(),
      Username: email,
    })
  );

  logger.info(`Cognito user deleted: ${email}`);
}

/**
 * Update Cognito user attributes (email, name).
 */
export async function updateCognitoUser(
  currentEmail: string,
  updates: { email?: string; firstName?: string; lastName?: string }
): Promise<void> {
  if (DEV_BYPASS_ENABLED) {
    logger.info('[DEV] Skipping Cognito update');
    return;
  }

  const attributes: { Name: string; Value: string }[] = [];
  if (updates.email) {
    attributes.push(
      { Name: 'email', Value: updates.email },
      { Name: 'email_verified', Value: 'true' }
    );
  }
  if (updates.firstName) {
    attributes.push({ Name: 'given_name', Value: updates.firstName });
  }
  if (updates.lastName) {
    attributes.push({ Name: 'family_name', Value: updates.lastName });
  }

  if (attributes.length === 0) return;

  await getClient().send(
    new AdminUpdateUserAttributesCommand({
      UserPoolId: getUserPoolId(),
      Username: currentEmail,
      UserAttributes: attributes,
    })
  );

  logger.info(`Cognito user updated: ${currentEmail}`);
}

/**
 * Admin-set a user's password (bypasses temp password flow).
 */
export async function setCognitoUserPassword(
  email: string,
  password: string,
  permanent: boolean = true
): Promise<void> {
  if (DEV_BYPASS_ENABLED) {
    logger.info('[DEV] Skipping Cognito password set');
    return;
  }

  await getClient().send(
    new AdminSetUserPasswordCommand({
      UserPoolId: getUserPoolId(),
      Username: email,
      Password: password,
      Permanent: permanent,
    })
  );

  logger.info(`Cognito user password set: ${email}`);
}

/**
 * Re-send the original invitation for an account that never completed setup.
 *
 * A Cognito user sits in `FORCE_CHANGE_PASSWORD` from the moment they are
 * invited until they first sign in. In that state `ForgotPassword` is refused
 * outright — there is no password to reset yet — so the ordinary "forgot my
 * password" flow is a dead end for exactly the people most likely to need it.
 * `AdminCreateUser` with `MessageAction: RESEND` issues a fresh temporary
 * password and re-sends the invite, which is the actual remedy.
 *
 * Returns whether an invite was sent. The caller must NOT surface that
 * distinction to an unauthenticated user: a response that differs for a known
 * and an unknown address turns this into an account-enumeration oracle.
 */
export async function resendCognitoInvite(email: string): Promise<boolean> {
  if (DEV_BYPASS_ENABLED) {
    logger.info('[DEV] Skipping Cognito invite resend');
    return true;
  }

  let status: string | undefined;
  try {
    const user = await getClient().send(
      new AdminGetUserCommand({ UserPoolId: getUserPoolId(), Username: email })
    );
    status = user.UserStatus;
  } catch (error) {
    // UserNotFoundException is the common case and is not an error condition
    // here — it is simply an address with no account. Logged without the
    // address so the log does not become the enumeration oracle either.
    const name = (error as { name?: string }).name;
    if (name !== 'UserNotFoundException') {
      logger.warn(`Invite resend lookup failed: ${name ?? 'unknown error'}`);
    }
    return false;
  }

  if (status !== 'FORCE_CHANGE_PASSWORD') {
    // A CONFIRMED user has a working password and should use the normal reset
    // flow; re-sending an invite would replace their password with a temporary
    // one and lock them out of their own account.
    return false;
  }

  await getClient().send(
    new AdminCreateUserCommand({
      UserPoolId: getUserPoolId(),
      Username: email,
      MessageAction: MessageActionType.RESEND,
      DesiredDeliveryMediums: ['EMAIL'],
    })
  );

  logger.info('Cognito invitation re-sent for an account pending initial setup');
  return true;
}
