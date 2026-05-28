/**
 * Maps AWS Cognito (Amplify v6) exception names to plain-English messages.
 * Raw exceptions like "NotAuthorizedException" are unhelpful to end users.
 */
export function mapCognitoError(error: unknown): string {
  if (error instanceof Error) {
    const name = (error as { name?: string }).name || '';
    switch (name) {
      case 'NotAuthorizedException':
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
