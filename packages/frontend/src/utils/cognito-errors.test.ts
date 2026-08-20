import { describe, it, expect } from 'vitest';
import { mapCognitoError } from './cognito-errors';

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

  it('never mentions a password on the 6-digit code screen', () => {
    // Reproduced on staging 2026-08-14: changing a password mid sign-in
    // invalidated the session, and the code screen answered "Current password
    // is incorrect" on a screen with no password field.
    const message = mapCognitoError(err, 'mfaChallenge');
    expect(message).not.toMatch(/password is incorrect/i);
    expect(message).toMatch(/expired/i);
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


describe('mapCognitoError — InvalidParameterException on the reset flow', () => {
  const err = cognitoError('InvalidParameterException');

  // Every production user hits this on "Forgot password": the pool runs
  // Require-MFA with Email enabled, and Cognito will not recover an account
  // through a medium that is also an MFA factor. Reproduced on
  // portal.lanyardhealth.com 2026-08-10.
  it('does not blame the customer for an address that is fine', () => {
    expect(mapCognitoError(err, 'passwordReset')).not.toMatch(/invalid/i);
  });

  it('names the route that actually works', () => {
    expect(mapCognitoError(err, 'passwordReset')).toContain('support@lanyardhealth.com');
  });

  it.each(['signIn', 'changePassword'] as const)(
    'leaves the %s reading alone — there it really is a bad input',
    (context) => {
      expect(mapCognitoError(err, context)).toBe('One of the values you entered is invalid');
    }
  );
});
