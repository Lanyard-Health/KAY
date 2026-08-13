/**
 * Maps AWS Cognito (Amplify v6) exception names to plain-English messages.
 * Raw exceptions like "NotAuthorizedException" are unhelpful to end users.
 */

/**
 * Which flow the error came from. `NotAuthorizedException` is the only name
 * Cognito gives to several unrelated conditions, so the surrounding flow is
 * what disambiguates it.
 */
export type CognitoErrorContext = 'signIn' | 'changePassword' | 'passwordReset';

export function mapCognitoError(
  error: unknown,
  context: CognitoErrorContext = 'changePassword',
  /** Shown instead of the raw SDK message when the error is not one we know. */
  fallback?: string
): string {
  if (error instanceof Error) {
    const name = (error as { name?: string }).name || '';
    switch (name) {
      case 'NotAuthorizedException':
        // Same exception name, three different meanings, and only the calling
        // flow separates them. "Current password is incorrect" was previously
        // shown on the reset screen, which has no password field.
        //
        // The reset branch is a fallback, not the primary path: with the app
        // client's `PreventUserExistenceErrors` ENABLED — as it is in both
        // environments — Cognito masks this error and returns success instead
        // (verified against the live pool 2026-08-10). It only surfaces under
        // the LEGACY setting. The reachable recovery path is the resend-invite
        // action on the code-entry screen.
        if (context === 'passwordReset') {
          return "This account hasn't finished setup, so there's no password to reset yet";
        }
        if (context === 'signIn') {
          return 'That email or password is incorrect';
        }
        return 'Current password is incorrect';
      case 'UserNotConfirmedException':
        return 'Please verify your email before signing in';
      case 'CodeMismatchException':
        return 'That verification code is incorrect';
      case 'ExpiredCodeException':
        return 'That code has expired. Request a new one.';
      case 'LimitExceededException':
        return 'Too many attempts. Wait a minute and try again.';
      case 'InvalidPasswordException':
        return 'Password does not meet requirements';
      case 'TooManyRequestsException':
        return 'Too many requests. Slow down a moment.';
      case 'PasswordResetRequiredException':
        return 'You need to reset your password before signing in';
      case 'UserNotFoundException':
        return 'No account found with that email';
      case 'InvalidParameterException':
        // On the reset flow this is not a bad input — the address is fine and
        // telling the customer otherwise sends them round the same loop.
        //
        // The production pool runs Require-MFA with Email enabled
        // (`docs/cognito-mfa-runbook.md`), and Cognito will not recover an
        // account through a medium that is also an MFA factor. So ForgotPassword
        // throws this for EVERY prod user, whatever they type. Reproduced on
        // portal.lanyardhealth.com 2026-08-10.
        //
        // Until MFA moves to OPTIONAL or an SMS factor is added, the only
        // working route is an admin pressing "Send new password"
        // (`POST /users/:id/resend-invite`), so point there rather than at a
        // retry that cannot succeed.
        if (context === 'passwordReset') {
          return 'Self-service reset is unavailable for your account. Email support@lanyardhealth.com and we will send you a new password.';
        }
        return 'One of the values you entered is invalid';
      case 'UsernameExistsException':
        return 'An account already exists with that email';
      default:
        // Without an explicit fallback this hands the raw SDK string to the
        // user — that is how "Auth UserPool not configured." reached a
        // customer-facing card during MFA enrollment testing. Screens that can
        // fail on infrastructure rather than input should pass one.
        return fallback ?? error.message ?? 'Something went wrong';
    }
  }
  return fallback ?? 'Something went wrong';
}
