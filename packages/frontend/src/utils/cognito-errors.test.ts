import { describe, it, expect } from 'vitest';
import { mapCognitoError, isSetupIncompleteError } from './cognito-errors';

/**
 * `NotAuthorizedException` is the reason this file exists. Cognito reuses that
 * one name for a wrong password, a wrong sign-in, and an account that never
 * completed its invitation. Mapping it to a single message meant the reset
 * screen told users their "current password" was incorrect on a screen with no
 * password field, and gave them no way forward.
 */
function cognitoError(name: string): Error {
  const err = new Error(`${name} raised`);
  err.name = name;
  return err;
}

describe('mapCognitoError — NotAuthorizedException by context', () => {
  const err = cognitoError('NotAuthorizedException');

  it('reads as an incomplete setup during a password reset', () => {
    expect(mapCognitoError(err, 'passwordReset')).toBe(
      "This account hasn't finished setup, so there's no password to reset yet"
    );
  });

  it('reads as bad credentials during sign-in', () => {
    expect(mapCognitoError(err, 'signIn')).toBe('That email or password is incorrect');
  });

  it('reads as a wrong current password when changing a password', () => {
    expect(mapCognitoError(err, 'changePassword')).toBe('Current password is incorrect');
  });

  it('defaults to the change-password reading, preserving prior behaviour', () => {
    expect(mapCognitoError(err)).toBe('Current password is incorrect');
  });

  it('never claims a password was wrong on the reset screen', () => {
    expect(mapCognitoError(err, 'passwordReset')).not.toMatch(/password is incorrect/i);
  });
});

describe('mapCognitoError — other exceptions are unchanged by context', () => {
  it.each(['signIn', 'changePassword', 'passwordReset'] as const)(
    'maps UserNotFoundException identically in %s',
    (context) => {
      expect(mapCognitoError(cognitoError('UserNotFoundException'), context)).toBe(
        'No account found with that email'
      );
    }
  );

  it('falls back to the raw message for an unrecognised name', () => {
    expect(mapCognitoError(cognitoError('SomethingNewException'))).toBe(
      'SomethingNewException raised'
    );
  });

  it('handles a non-Error value', () => {
    expect(mapCognitoError('a string')).toBe('Something went wrong');
  });
});

describe('isSetupIncompleteError', () => {
  it('is true only for NotAuthorizedException during a reset', () => {
    expect(isSetupIncompleteError(cognitoError('NotAuthorizedException'), 'passwordReset')).toBe(
      true
    );
  });

  it('is false for the same error in any other flow', () => {
    const err = cognitoError('NotAuthorizedException');
    expect(isSetupIncompleteError(err, 'signIn')).toBe(false);
    expect(isSetupIncompleteError(err, 'changePassword')).toBe(false);
  });

  it('is false for a different exception during a reset', () => {
    expect(isSetupIncompleteError(cognitoError('LimitExceededException'), 'passwordReset')).toBe(
      false
    );
  });

  it('is false for a non-Error value', () => {
    expect(isSetupIncompleteError({ name: 'NotAuthorizedException' }, 'passwordReset')).toBe(false);
  });
});
