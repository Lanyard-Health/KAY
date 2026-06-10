import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAuthStore } from './auth.store';

// The store dynamically imports 'aws-amplify/auth' inside each action, so a
// module mock intercepts it even for the lazy import.
const confirmSignIn = vi.fn();
vi.mock('aws-amplify/auth', () => ({
  confirmSignIn: (...args: unknown[]) => confirmSignIn(...args),
  // Present so any incidental lazy import in the store doesn't blow up.
  fetchAuthSession: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

/**
 * Regression test for the prod login bug where a first-time provider who set a
 * new password and then hit an email-code MFA challenge was stranded with no
 * code-entry screen. handleNewPasswordChallenge must route every post-password
 * next step to the correct challenge UI state — not silently assume sign-in.
 */
describe('handleNewPasswordChallenge — post-password challenge routing', () => {
  beforeEach(() => {
    confirmSignIn.mockReset();
    useAuthStore.setState({
      // The state this handler actually runs from (set-new-password screen).
      challengeName: 'NEW_PASSWORD_REQUIRED',
      challengeSession: null,
      challengeEmail: 'provider@example.com',
      challengeMissingAttributes: [],
      availableMfaTypes: [],
      isLoading: false,
      error: null,
    });
  });

  it('routes an email-code challenge to the MFA_EMAIL screen (the bug)', async () => {
    confirmSignIn.mockResolvedValue({
      nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_EMAIL_CODE' },
    });

    await useAuthStore.getState().handleNewPasswordChallenge('NewPassw0rd!');

    expect(useAuthStore.getState().challengeName).toBe('MFA_EMAIL');
  });

  it('routes an MFA-selection challenge to the picker and captures allowed types', async () => {
    confirmSignIn.mockResolvedValue({
      nextStep: {
        signInStep: 'CONTINUE_SIGN_IN_WITH_MFA_SELECTION',
        allowedMFATypes: ['EMAIL', 'TOTP'],
      },
    });

    await useAuthStore.getState().handleNewPasswordChallenge('NewPassw0rd!');

    expect(useAuthStore.getState().challengeName).toBe('MFA_SELECT');
    expect(useAuthStore.getState().availableMfaTypes).toEqual(['EMAIL', 'TOTP']);
  });

  it('routes a TOTP-code challenge to the authenticator screen', async () => {
    confirmSignIn.mockResolvedValue({
      nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_TOTP_CODE' },
    });

    await useAuthStore.getState().handleNewPasswordChallenge('NewPassw0rd!');

    expect(useAuthStore.getState().challengeName).toBe('MFA_TOTP');
  });

  it('routes a TOTP-setup challenge to MFA setup', async () => {
    confirmSignIn.mockResolvedValue({
      nextStep: { signInStep: 'CONTINUE_SIGN_IN_WITH_TOTP_SETUP' },
    });

    await useAuthStore.getState().handleNewPasswordChallenge('NewPassw0rd!');

    expect(useAuthStore.getState().challengeName).toBe('MFA_SETUP');
  });

  it('throws on an unknown next step instead of silently assuming sign-in', async () => {
    confirmSignIn.mockResolvedValue({
      nextStep: { signInStep: 'SOME_UNHANDLED_STEP' },
    });

    await expect(
      useAuthStore.getState().handleNewPasswordChallenge('NewPassw0rd!')
    ).rejects.toThrow(/unsupported step/i);
    // Must NOT have cleared the challenge as though login succeeded — the old
    // bug set challengeName to null here and called checkAuth().
    expect(useAuthStore.getState().challengeName).toBe('NEW_PASSWORD_REQUIRED');
  });
});
