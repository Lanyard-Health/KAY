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

/**
 * True when the error is Cognito refusing to reset a password that was never
 * set — an account still in `FORCE_CHANGE_PASSWORD` from its original invite.
 *
 * Cognito reports this as a bare `NotAuthorizedException`, indistinguishable
 * by name from a wrong password. Only the flow tells them apart: a password
 * reset never submits a current password, so "incorrect password" cannot be
 * what happened there.
 */
export function isSetupIncompleteError(error: unknown, context: CognitoErrorContext): boolean {
  return (
    context === 'passwordReset' &&
    error instanceof Error &&
    (error as { name?: string }).name === 'NotAuthorizedException'
  );
}

export function mapCognitoError(
  error: unknown,
  context: CognitoErrorContext = 'changePassword'
): string {
  if (error instanceof Error) {
    const name = (error as { name?: string }).name || '';
    switch (name) {
      case 'NotAuthorizedException':
        // Same exception name, three different meanings. Reporting "current
        // password is incorrect" on a reset screen — where no password was
        // typed — sent at least one user looking for an email that Cognito
        // was never going to send.
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
