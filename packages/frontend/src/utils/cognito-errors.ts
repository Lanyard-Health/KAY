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
  context: CognitoErrorContext = 'changePassword'
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
        return 'One of the values you entered is invalid';
      case 'UsernameExistsException':
        return 'An account already exists with that email';
      default:
        return error.message || 'Something went wrong';
    }
  }
  return 'Something went wrong';
}
