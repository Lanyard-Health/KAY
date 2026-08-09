import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth.store';
import { notify } from '../../utils/notify';
import { mapCognitoError, isSetupIncompleteError } from '../../utils/cognito-errors';
import CodeInput from '../../components/CodeInput';
import { lanyardMarkTileUrl } from '../../components/LanyardMark';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import QRCode from 'qrcode';

// Approved login design v2 (Kay, 2026-07-30; prototype at /prototypes/login):
// warm paper with a repeated faded-submark wallpaper, thesis quote as the big
// brand statement, white card for the form. Supersedes the 2026-07-29 split
// panel and the earlier no-quote decision.
const POPPINS =
  "'Poppins', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

const THESIS_QUOTE =
  'The fastest path from credentialed to paid, with nothing hidden along the way.';

// Staggered repeated-submark wallpaper: same tile layered twice, second layer
// offset by half a cell (brick pattern)
const MARK_TILE = lanyardMarkTileUrl('#f4efe6');
const WALLPAPER_STYLE = {
  backgroundImage: `url("${MARK_TILE}"), url("${MARK_TILE}")`,
  backgroundSize: '260px 199px, 260px 199px',
  backgroundPosition: '0 0, 130px 99px',
};
const FIELD_CLASSES =
  'h-12 w-full rounded-xl border border-[#e3ddd2] bg-white px-4 text-sm text-[#1f2721] shadow-sm outline-none transition placeholder:text-[#a49d8f] focus:border-[#2d8b6a] focus:ring-4 focus:ring-[#2d8b6a]/15';
const LABEL_CLASSES = 'block text-sm font-medium text-[#57534a] mb-1.5';
const PRIMARY_BUTTON_CLASSES =
  'h-12 w-full flex items-center justify-center rounded-full bg-[#0A3D2E] text-sm font-medium text-white shadow-sm transition hover:bg-[#082f23] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2d8b6a] focus-visible:ring-offset-2 focus-visible:ring-offset-white';
const GHOST_BUTTON_CLASSES =
  'w-full text-sm text-[#6b665c] transition hover:text-[#1f2721] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2d8b6a] rounded';

type AuthStep =
  | 'login'
  | 'new-password'
  | 'mfa-select'  // user picks Authenticator vs Email
  | 'mfa-totp'    // enter 6-digit TOTP code
  | 'mfa-setup'   // first-time TOTP enrollment (QR code)
  | 'mfa-email'   // enter 6-digit code sent to email
  | 'forgot-password'
  | 'confirm-reset';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [authStep, setAuthStep] = useState<AuthStep>('login');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  // Set when Cognito refuses the reset because the account never finished its
  // original invitation. Drives the recovery panel on the reset screen.
  const [setupIncomplete, setSetupIncomplete] = useState(false);
  const [qrUri, setQrUri] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [secretCode, setSecretCode] = useState('');
  const [leavingTo, setLeavingTo] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();

  const navigate = useNavigate();
  const {
    login,
    devLogin,
    devProviderLogin,
    devPracticeAdminLogin,
    devStaffLogin,
    isDevMode,
    challengeName,
    availableMfaTypes,
    handleNewPasswordChallenge,
    handleMfaChallenge,
    handleMfaSetup,
    confirmMfaSetup,
    selectMfaMethod,
    handleEmailMfaCode,
    forgotPassword,
    resendInvite,
    confirmForgotPassword,
  } = useAuthStore();

  // Surface a "session expired" notice when api.ts redirected us here after a 401.
  useEffect(() => {
    try {
      if (sessionStorage.getItem('flash:session-expired') === '1') {
        sessionStorage.removeItem('flash:session-expired');
        notify.info('Your session expired. Please log in again.');
      }
    } catch {
      /* sessionStorage unavailable */
    }
  }, []);

  // Warm the lazy-loaded registration pages so their links open without a
  // blank flash. Vite dedupes these with App.tsx's lazy() imports.
  useEffect(() => {
    void import('../portal/RegisterPage');
    void import('../practice/PracticeSignupPage');
  }, []);

  // Fade IN the registration pages' paper backdrop before navigating, so no
  // mismatched frame is exposed (reduced motion: navigate now)
  const leaveTo = (e: React.MouseEvent, path: string) => {
    e.preventDefault();
    if (reduceMotion) {
      navigate(path);
      return;
    }
    setLeavingTo(path);
  };

  // React to challenge changes from the auth store
  useEffect(() => {
    if (challengeName === 'NEW_PASSWORD_REQUIRED') {
      setAuthStep('new-password');
    } else if (challengeName === 'MFA_SELECT') {
      setAuthStep('mfa-select');
    } else if (challengeName === 'MFA_TOTP') {
      setAuthStep('mfa-totp');
    } else if (challengeName === 'MFA_EMAIL') {
      setAuthStep('mfa-email');
    } else if (challengeName === 'MFA_SETUP') {
      setAuthStep('mfa-setup');
      handleMfaSetup().then(({ qrUri: uri, secretCode: code }) => {
        setQrUri(uri);
        setSecretCode(code);
      }).catch(() => {
        notify.error('MFA setup failed', { description: 'Could not initialize authenticator setup' });
      });
    }
  }, [challengeName]);

  // Generate QR code client-side — never send TOTP secret to external services
  useEffect(() => {
    if (qrUri) {
      QRCode.toDataURL(qrUri, { width: 200, margin: 1 }).then(setQrDataUrl).catch(() => {
        setQrDataUrl('');
      });
    }
  }, [qrUri]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await login(email, password);
      const state = useAuthStore.getState();
      if (!state.challengeName && state.isAuthenticated) {
        notify.success('Signed in');
        navigate(state.user?.role === 'provider' ? '/portal' : '/');
      }
    } catch (error) {
      notify.error('Login failed', { description: mapCognitoError(error, 'signIn') });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDevLogin = async () => {
    setIsLoading(true);
    try {
      await devLogin();
      notify.success('Dev Admin', { description: 'Logged in with admin privileges' });
      navigate('/');
    } catch (error) {
      notify.error('Dev login failed', { description: error instanceof Error ? error.message : 'Could not authenticate as dev admin' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDevProviderLogin = async () => {
    setIsLoading(true);
    try {
      await devProviderLogin();
      notify.success('Dev Provider', { description: 'Logged in with provider privileges' });
      navigate('/portal');
    } catch (error) {
      notify.error('Dev login failed', { description: error instanceof Error ? error.message : 'Could not authenticate as dev provider' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDevPracticeAdminLogin = async () => {
    setIsLoading(true);
    try {
      await devPracticeAdminLogin();
      notify.success('Dev Practice Admin', { description: 'Logged in with practice admin privileges' });
      navigate('/');
    } catch (error) {
      notify.error('Dev login failed', { description: error instanceof Error ? error.message : 'Could not authenticate as dev practice admin' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDevStaffLogin = async () => {
    setIsLoading(true);
    try {
      await devStaffLogin();
      notify.success('Dev Staff', { description: 'Logged in with credentialing staff privileges' });
      navigate('/');
    } catch (error) {
      notify.error('Dev login failed', { description: error instanceof Error ? error.message : 'Could not authenticate as dev staff' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      notify.error('Passwords do not match');
      return;
    }
    if (newPassword.length < 12) {
      notify.error('Invalid password', { description: 'Password must be at least 12 characters' });
      return;
    }
    setIsLoading(true);
    try {
      await handleNewPasswordChallenge(newPassword);
      const state = useAuthStore.getState();
      if (!state.challengeName && state.isAuthenticated) {
        notify.success('Password updated');
        navigate(state.user?.role === 'provider' ? '/portal' : '/');
      }
    } catch (error) {
      notify.error('Password update failed', { description: mapCognitoError(error) });
    } finally {
      setIsLoading(false);
    }
  };

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await handleMfaChallenge(mfaCode);
      const state = useAuthStore.getState();
      if (state.isAuthenticated) {
        notify.success('Signed in');
        navigate(state.user?.role === 'provider' ? '/portal' : '/');
      }
    } catch (error) {
      notify.error('Verification failed', { description: mapCognitoError(error) });
      setMfaCode('');
    } finally {
      setIsLoading(false);
    }
  };

  const handleMfaSelectClick = async (method: 'TOTP' | 'EMAIL') => {
    setIsLoading(true);
    try {
      await selectMfaMethod(method);
    } catch (error) {
      notify.error('Could not start verification', { description: mapCognitoError(error) });
    } finally {
      setIsLoading(false);
    }
  };

  const handleMfaEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await handleEmailMfaCode(mfaCode);
      const state = useAuthStore.getState();
      if (state.isAuthenticated) {
        notify.success('Signed in');
        navigate(state.user?.role === 'provider' ? '/portal' : '/');
      }
    } catch (error) {
      notify.error('Verification failed', { description: mapCognitoError(error) });
      setMfaCode('');
    } finally {
      setIsLoading(false);
    }
  };

  const handleMfaSetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await confirmMfaSetup(mfaCode);
      const state = useAuthStore.getState();
      if (state.isAuthenticated) {
        notify.success('MFA configured', { description: 'Your authenticator app is now linked' });
        navigate(state.user?.role === 'provider' ? '/portal' : '/');
      }
    } catch (error) {
      notify.error('MFA setup failed', { description: mapCognitoError(error) });
      setMfaCode('');
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setSetupIncomplete(false);
    try {
      await forgotPassword(resetEmail);
      notify.success('Code sent', { description: 'Check your email for a verification code' });
      setAuthStep('confirm-reset');
    } catch (error) {
      // An account still on its original invitation cannot be reset at all.
      // Show the recovery panel in place rather than a toast — a toast that
      // disappears leaves the user exactly as stuck as before.
      if (isSetupIncompleteError(error, 'passwordReset')) {
        setSetupIncomplete(true);
      } else {
        notify.error('Reset failed', { description: mapCognitoError(error, 'passwordReset') });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendInvite = async () => {
    setIsLoading(true);
    try {
      await resendInvite(resetEmail);
      notify.success('Invitation sent', {
        description: 'Check your inbox and your spam folder.',
      });
      setSetupIncomplete(false);
      setAuthStep('login');
    } catch {
      // The endpoint reports success even when Cognito fails, so reaching here
      // means the request itself did not complete — network or rate limit.
      notify.error('Could not send invitation', {
        description: 'Try again in a moment, or contact support@lanyardhealth.com',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (resetCode.length !== 6) return;
    if (resetNewPassword.length < 12) {
      notify.error('Invalid password', { description: 'Password must be at least 12 characters' });
      return;
    }
    setIsLoading(true);
    try {
      await confirmForgotPassword(resetEmail, resetCode, resetNewPassword);
      notify.success('Password reset', { description: 'You can now sign in with your new password' });
      setAuthStep('login');
      setResetEmail('');
      setResetCode('');
      setResetNewPassword('');
    } catch (error) {
      notify.error('Reset failed', { description: mapCognitoError(error) });
      // Clear the code boxes only when the code itself was rejected; keep
      // them filled for password-policy failures and other errors.
      const name = error instanceof Error ? error.name : '';
      if (name === 'CodeMismatchException' || name === 'ExpiredCodeException') {
        setResetCode('');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const renderAuthForm = () => {
    switch (authStep) {
      case 'new-password':
        return (
          <div>
            <h3 className="text-center text-2xl font-semibold text-[#171b17]">Set a new password</h3>
            <p className="mt-3 text-center text-sm leading-6 text-[#6b665c]">
              Your temporary password has expired. Please set a new password.
            </p>
            <form onSubmit={handleNewPassword} className="mt-8 space-y-4">
              <div>
                <label htmlFor="new-password" className={LABEL_CLASSES}>
                  New Password
                </label>
                <input
                  id="new-password"
                  type="password"
                  required
                  minLength={12}
                  className={FIELD_CLASSES}
                  placeholder="Minimum 12 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="confirm-password" className={LABEL_CLASSES}>
                  Confirm Password
                </label>
                <input
                  id="confirm-password"
                  type="password"
                  required
                  minLength={12}
                  className={FIELD_CLASSES}
                  placeholder="Re-enter your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
              <p className="text-xs text-[#75705f]">
                Must contain uppercase, lowercase, number, and symbol.
              </p>
              <button type="submit" disabled={isLoading} className={PRIMARY_BUTTON_CLASSES}>
                {isLoading ? 'Setting password...' : 'Set Password'}
              </button>
            </form>
          </div>
        );

      case 'mfa-select':
        return (
          <div>
            <h3 className="text-center text-2xl font-semibold text-[#171b17]">Choose verification method</h3>
            <p className="mt-3 text-center text-sm leading-6 text-[#6b665c]">
              How would you like to receive your verification code?
            </p>
            <div className="mt-8 space-y-3">
              {availableMfaTypes.includes('TOTP') && (
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => handleMfaSelectClick('TOTP')}
                  className="w-full rounded-xl border border-[#e3ddd2] bg-white px-4 py-3 text-left shadow-sm transition hover:bg-[#f3eee5] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2d8b6a]"
                >
                  <div className="text-sm font-medium text-[#1f2721]">Authenticator app</div>
                  <div className="mt-0.5 text-xs text-[#6b665c]">
                    Use a 6-digit code from Google Authenticator, 1Password, Authy, etc.
                  </div>
                </button>
              )}
              {availableMfaTypes.includes('EMAIL') && (
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => handleMfaSelectClick('EMAIL')}
                  className="w-full rounded-xl border border-[#e3ddd2] bg-white px-4 py-3 text-left shadow-sm transition hover:bg-[#f3eee5] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2d8b6a]"
                >
                  <div className="text-sm font-medium text-[#1f2721]">Email</div>
                  <div className="mt-0.5 text-xs text-[#6b665c]">
                    Receive a 6-digit code at your registered email address.
                  </div>
                </button>
              )}
              {availableMfaTypes.length === 0 && (
                <p className="text-sm text-[#6b665c]">
                  No verification methods are available. Contact support.
                </p>
              )}
            </div>
          </div>
        );

      case 'mfa-email':
        return (
          <div>
            <h3 className="text-center text-2xl font-semibold text-[#171b17]">Check your email</h3>
            <p className="mt-3 text-center text-sm leading-6 text-[#6b665c]">
              We sent a 6-digit code to your registered email. Enter it below.
            </p>
            <form onSubmit={handleMfaEmailSubmit} className="mt-8 space-y-4">
              <CodeInput tone="light" value={mfaCode} onChange={setMfaCode} autoFocus />
              <button
                type="submit"
                disabled={isLoading || mfaCode.length !== 6}
                className={PRIMARY_BUTTON_CLASSES}
              >
                {isLoading ? 'Verifying...' : 'Verify'}
              </button>
              <p className="text-center text-xs text-[#75705f]">
                Code didn't arrive? Check spam, then try logging in again.
              </p>
            </form>
          </div>
        );

      case 'mfa-totp':
        return (
          <div>
            <h3 className="text-center text-2xl font-semibold text-[#171b17]">Verification code</h3>
            <p className="mt-3 text-center text-sm leading-6 text-[#6b665c]">
              Enter the 6-digit code from your authenticator app.
            </p>
            <form onSubmit={handleMfaSubmit} className="mt-8 space-y-4">
              <CodeInput tone="light" value={mfaCode} onChange={setMfaCode} autoFocus />
              <button
                type="submit"
                disabled={isLoading || mfaCode.length !== 6}
                className={PRIMARY_BUTTON_CLASSES}
              >
                {isLoading ? 'Verifying...' : 'Verify'}
              </button>
            </form>
          </div>
        );

      case 'mfa-setup':
        return (
          <div>
            <h3 className="text-center text-2xl font-semibold text-[#171b17]">Set up authenticator</h3>
            <p className="mt-3 text-center text-sm leading-6 text-[#6b665c]">
              Scan this QR code with Google Authenticator, Authy, or a similar app.
            </p>
            {qrUri ? (
              <div className="mt-8 space-y-4">
                <div className="flex justify-center rounded-xl border border-[#e3ddd2] bg-white p-4 shadow-sm">
                  {qrDataUrl ? (
                    <img src={qrDataUrl} alt="MFA QR Code" className="w-48 h-48" />
                  ) : (
                    <div className="flex h-48 w-48 items-center justify-center text-sm text-[#a49d8f]">
                      Generating QR code...
                    </div>
                  )}
                </div>
                <details className="text-sm">
                  <summary className="cursor-pointer text-[#6b665c] hover:text-[#1f2721]">
                    Can't scan? Enter code manually
                  </summary>
                  <code className="mt-2 block break-all rounded-lg border border-[#e3ddd2] bg-white p-2 text-xs text-[#1f2721]">
                    {secretCode}
                  </code>
                </details>
                <form onSubmit={handleMfaSetupSubmit} className="space-y-4">
                  <div>
                    <label className={LABEL_CLASSES}>
                      Enter the 6-digit code from your app
                    </label>
                    {/* No autoFocus: the user is mid-QR-scan when this renders */}
                    <CodeInput tone="light" value={mfaCode} onChange={setMfaCode} />
                  </div>
                  <button
                    type="submit"
                    disabled={isLoading || mfaCode.length !== 6}
                    className={PRIMARY_BUTTON_CLASSES}
                  >
                    {isLoading ? 'Verifying...' : 'Verify & Complete Setup'}
                  </button>
                </form>
              </div>
            ) : (
              <div className="flex justify-center py-8">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#e3ddd2] border-t-[#2d8b6a]" />
              </div>
            )}
          </div>
        );

      case 'forgot-password':
        return (
          <div>
            <h3 className="text-center text-2xl font-semibold text-[#171b17]">Reset your password</h3>
            <p className="mt-3 text-center text-sm leading-6 text-[#6b665c]">
              Enter your email and we'll send you a verification code.
            </p>
            <form onSubmit={handleForgotPassword} className="mt-8 space-y-4">
              <input
                type="email"
                required
                className={FIELD_CLASSES}
                placeholder="Email address"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
              />
              {setupIncomplete && (
                <div className="rounded-xl border border-[#e2d9c4] bg-[#fdf8ec] p-4 text-left">
                  <p className="text-sm font-medium text-[#171b17]">
                    This account hasn&apos;t finished setup.
                  </p>
                  <p className="mt-1 text-sm leading-6 text-[#6b665c]">
                    Your original invitation was never completed, so there&apos;s no password to
                    reset yet.
                  </p>
                  <button
                    type="button"
                    onClick={handleResendInvite}
                    disabled={isLoading}
                    className={`${PRIMARY_BUTTON_CLASSES} mt-3`}
                  >
                    {isLoading ? 'Sending...' : 'Resend my invitation'}
                  </button>
                </div>
              )}
              <button type="submit" disabled={isLoading} className={PRIMARY_BUTTON_CLASSES}>
                {isLoading ? 'Sending...' : 'Send Reset Code'}
              </button>
              <button
                type="button"
                onClick={() => setAuthStep('login')}
                className={GHOST_BUTTON_CLASSES}
              >
                Back to sign in
              </button>
            </form>
          </div>
        );

      case 'confirm-reset':
        return (
          <div>
            <h3 className="text-center text-2xl font-semibold text-[#171b17]">Enter reset code</h3>
            <p className="mt-3 text-center text-sm leading-6 text-[#6b665c]">
              Check your email for a verification code, then pick a new password.
            </p>
            <form onSubmit={handleConfirmReset} className="mt-8 space-y-4">
              <CodeInput tone="light" value={resetCode} onChange={setResetCode} />
              <input
                type="password"
                required
                minLength={12}
                className={FIELD_CLASSES}
                placeholder="New password (min 12 characters)"
                value={resetNewPassword}
                onChange={(e) => setResetNewPassword(e.target.value)}
              />
              <button
                type="submit"
                disabled={isLoading || resetCode.length !== 6}
                className={PRIMARY_BUTTON_CLASSES}
              >
                {isLoading ? 'Resetting...' : 'Reset Password'}
              </button>
              <button
                type="button"
                onClick={() => setAuthStep('login')}
                className={GHOST_BUTTON_CLASSES}
              >
                Back to sign in
              </button>
            </form>
          </div>
        );

      default: // 'login'
        return (
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="email" className={LABEL_CLASSES}>
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className={FIELD_CLASSES}
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="password" className={LABEL_CLASSES}>
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className={FIELD_CLASSES}
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => setAuthStep('forgot-password')}
                className="text-xs font-medium text-[#1a6b4e] underline-offset-2 transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2d8b6a]"
              >
                Forgot your password?
              </button>
            </div>

            <button type="submit" disabled={isLoading} className={PRIMARY_BUTTON_CLASSES}>
              {isLoading ? (
                <span className="flex items-center">
                  <svg
                    className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Signing in...
                </span>
              ) : (
                'Sign in'
              )}
            </button>
          </form>
        );
    }
  };

  // Approved login design v2 (Kay, 2026-07-30; reference at /prototypes/login).
  // Protected design: repeated faded-submark wallpaper on warm paper, thesis
  // quote next to the logo, white form card. See CLAUDE.md Do-Not-Touch list.
  return (
    <div
      className="relative flex min-h-screen flex-col overflow-hidden bg-[#faf7f2] text-[#1f2721]"
      style={{ fontFamily: POPPINS, ...WALLPAPER_STYLE }}
    >
      {/* Leave wash: fades IN the registration pages' paper backdrop before
          navigating, so no mismatched frame is exposed */}
      <motion.div
        className="pointer-events-none fixed inset-0 z-50 bg-[#faf7f2]"
        initial={{ opacity: 0 }}
        animate={{ opacity: leavingTo ? 1 : 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        onAnimationComplete={() => {
          if (leavingTo) navigate(leavingTo);
        }}
      />

      <header className="relative z-10 w-full px-5 pt-8 sm:px-8">
        <div className="mx-auto w-full max-w-6xl">
          <img
            src="/logo-full.svg"
            alt="Lanyard Health"
            className="mx-auto h-24 w-auto lg:mx-0"
          />
        </div>
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center px-5 py-8 sm:px-8">
        <div className="grid w-full max-w-6xl items-center gap-10 lg:grid-cols-[minmax(0,1fr)_28rem] lg:gap-16">
          {/* Brand statement: the thesis quote */}
          <div className="text-center lg:text-left">
            <p className="mx-auto max-w-xl text-2xl font-semibold leading-snug text-[#171b17] sm:text-3xl lg:mx-0 lg:text-4xl lg:leading-tight">
              &ldquo;{THESIS_QUOTE}&rdquo;
            </p>
          </div>

          <div className="mx-auto w-full max-w-md">
            <div className="rounded-[28px] border border-[#f0eadd] bg-white px-6 py-10 shadow-[0_24px_70px_-30px_rgba(23,27,23,0.18)] sm:px-10">
            {authStep === 'login' && (
              <div className="mb-7 text-center">
                <h2 className="text-2xl font-semibold text-[#171b17]">Welcome to Lanyard</h2>
                <p className="mt-2 text-sm text-[#6b665c]">
                  We're glad you're here.
                </p>
              </div>
            )}

            {/* Development Mode Login */}
            {isDevMode && authStep === 'login' && (
              <div className="mb-4 rounded-xl border border-yellow-200 bg-yellow-50 p-4">
                <div className="flex items-center mb-3">
                  <span className="bg-yellow-200 text-yellow-800 text-xs font-medium px-2.5 py-0.5 rounded">
                    DEV MODE
                  </span>
                </div>
                <p className="text-sm text-yellow-700 mb-3">
                  Development authentication bypass is enabled. Click below to login as an admin or provider user.
                </p>
                <div className="space-y-2">
                  <button
                    onClick={handleDevLogin}
                    disabled={isLoading}
                    className="w-full flex justify-center py-2 px-4 border border-yellow-400 text-sm font-medium rounded-xl text-yellow-800 bg-yellow-100 hover:bg-yellow-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500 disabled:opacity-50 transition-colors"
                  >
                    {isLoading ? 'Logging in...' : 'Login as Dev Admin'}
                  </button>
                  <button
                    onClick={handleDevProviderLogin}
                    disabled={isLoading}
                    className="w-full flex justify-center py-2 px-4 border border-primary-400 text-sm font-medium rounded-xl text-primary-800 bg-primary-50 hover:bg-primary-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 transition-colors"
                  >
                    {isLoading ? 'Logging in...' : 'Login as Dev Provider'}
                  </button>
                  <button
                    onClick={handleDevPracticeAdminLogin}
                    disabled={isLoading}
                    className="w-full flex justify-center py-2 px-4 border border-emerald-400 text-sm font-medium rounded-xl text-emerald-800 bg-emerald-50 hover:bg-emerald-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 disabled:opacity-50 transition-colors"
                  >
                    {isLoading ? 'Logging in...' : 'Login as Dev Practice Admin'}
                  </button>
                  <button
                    onClick={handleDevStaffLogin}
                    disabled={isLoading}
                    className="w-full flex justify-center py-2 px-4 border border-cyan-400 text-sm font-medium rounded-xl text-cyan-800 bg-cyan-100 hover:bg-cyan-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:opacity-50 transition-colors"
                  >
                    {isLoading ? 'Logging in...' : 'Login as Dev Staff'}
                  </button>
                </div>
              </div>
            )}

            {isDevMode && authStep === 'login' && (
              <div className="mb-4 flex items-center gap-3">
                <div className="flex-1 border-t border-[#e3ddd2]" />
                <span className="text-sm text-[#75705f]">Or use Cognito</span>
                <div className="flex-1 border-t border-[#e3ddd2]" />
              </div>
            )}

            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={authStep}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: reduceMotion ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
              >
                {renderAuthForm()}
              </motion.div>
            </AnimatePresence>

            {authStep === 'login' && (
              <div className="mt-8 space-y-1.5 text-center text-xs text-[#75705f]">
                <p>
                  New provider?{' '}
                  <Link
                    to="/register"
                    onClick={(e) => leaveTo(e, '/register')}
                    className="font-medium text-[#1a6b4e] underline-offset-2 transition hover:underline active:opacity-50"
                  >
                    Register here
                  </Link>
                </p>
                <p>
                  Manage a practice?{' '}
                  <Link
                    to="/practice-signup"
                    onClick={(e) => leaveTo(e, '/practice-signup')}
                    className="font-medium text-[#1a6b4e] underline-offset-2 transition hover:underline active:opacity-50"
                  >
                    Sign up your practice
                  </Link>
                </p>
              </div>
            )}
            </div>
          </div>
        </div>
      </main>

      <footer className="relative z-10 px-6 pb-8 text-center text-xs leading-5 text-[#75705f]">
          By continuing, you agree to Lanyard Health's{' '}
          <a
            href="https://lanyardhealth.com/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-[#1f2721] underline underline-offset-2"
          >
            Terms of Service
          </a>{' '}
          and{' '}
          <a
            href="https://lanyardhealth.com/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-[#1f2721] underline underline-offset-2"
          >
            Privacy Policy
          </a>
          .
      </footer>
    </div>
  );
}
