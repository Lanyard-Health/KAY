import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth.store';
import { notify } from '../../utils/notify';
import { mapCognitoError } from '../../utils/cognito-errors';
import QRCode from 'qrcode';

type AuthStep = 'login' | 'new-password' | 'mfa-totp' | 'mfa-setup' | 'forgot-password' | 'confirm-reset';

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
  const [qrUri, setQrUri] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [secretCode, setSecretCode] = useState('');
  const [statCount, setStatCount] = useState(0);

  const navigate = useNavigate();
  const {
    login,
    devLogin,
    devProviderLogin,
    devPracticeAdminLogin,
    isDevMode,
    challengeName,
    handleNewPasswordChallenge,
    handleMfaChallenge,
    handleMfaSetup,
    confirmMfaSetup,
    forgotPassword,
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

  // Animated count-up for the "10x" stat
  useEffect(() => {
    const end = 10;
    const duration = 1500;
    const startTime = performance.now();
    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setStatCount(Math.round(eased * end));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, []);

  // React to challenge changes from the auth store
  useEffect(() => {
    if (challengeName === 'NEW_PASSWORD_REQUIRED') {
      setAuthStep('new-password');
    } else if (challengeName === 'MFA_TOTP') {
      setAuthStep('mfa-totp');
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
        notify.success('Welcome back');
        navigate(state.user?.role === 'provider' ? '/portal' : '/');
      }
    } catch (error) {
      notify.error('Login failed', { description: mapCognitoError(error) });
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
        notify.success('Welcome back');
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
    try {
      await forgotPassword(resetEmail);
      notify.success('Code sent', { description: 'Check your email for a verification code' });
      setAuthStep('confirm-reset');
    } catch (error) {
      notify.error('Reset failed', { description: mapCognitoError(error) });
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmReset = async (e: React.FormEvent) => {
    e.preventDefault();
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
    } finally {
      setIsLoading(false);
    }
  };

  const renderAuthForm = () => {
    switch (authStep) {
      case 'new-password':
        return (
          <div>
            <h3 className="text-lg font-semibold text-white mb-2">Set New Password</h3>
            <p className="text-sm text-white/60 mb-4">
              Your temporary password has expired. Please set a new password.
            </p>
            <form onSubmit={handleNewPassword} className="space-y-4">
              <div>
                <label htmlFor="new-password" className="block text-sm font-medium text-white/80 mb-1">
                  New Password
                </label>
                <input
                  id="new-password"
                  type="password"
                  required
                  minLength={12}
                  className="appearance-none relative block w-full px-3 py-2 border border-white/[0.15] bg-white/[0.08] placeholder-white/40 text-white rounded-xl focus:outline-none focus:ring-emerald-400/30 focus:border-emerald-400/50 sm:text-sm"
                  placeholder="Minimum 12 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="confirm-password" className="block text-sm font-medium text-white/80 mb-1">
                  Confirm Password
                </label>
                <input
                  id="confirm-password"
                  type="password"
                  required
                  minLength={12}
                  className="appearance-none relative block w-full px-3 py-2 border border-white/[0.15] bg-white/[0.08] placeholder-white/40 text-white rounded-xl focus:outline-none focus:ring-emerald-400/30 focus:border-emerald-400/50 sm:text-sm"
                  placeholder="Re-enter your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
              <p className="text-xs text-white/50">
                Must contain uppercase, lowercase, number, and symbol.
              </p>
              <button
                type="submit"
                disabled={isLoading}
                className="w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-xl text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
              >
                {isLoading ? 'Setting password...' : 'Set Password'}
              </button>
            </form>
          </div>
        );

      case 'mfa-totp':
        return (
          <div>
            <h3 className="text-lg font-semibold text-white mb-2">Verification Code</h3>
            <p className="text-sm text-white/60 mb-4">
              Enter the 6-digit code from your authenticator app.
            </p>
            <form onSubmit={handleMfaSubmit} className="space-y-4">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoFocus
                className="appearance-none relative block w-full px-3 py-3 border border-white/[0.15] bg-white/[0.08] placeholder-white/40 text-white rounded-xl focus:outline-none focus:ring-emerald-400/30 focus:border-emerald-400/50 text-center text-2xl tracking-widest"
                placeholder="000000"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
              <button
                type="submit"
                disabled={isLoading || mfaCode.length !== 6}
                className="w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-xl text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
              >
                {isLoading ? 'Verifying...' : 'Verify'}
              </button>
            </form>
          </div>
        );

      case 'mfa-setup':
        return (
          <div>
            <h3 className="text-lg font-semibold text-white mb-2">Set Up Authenticator</h3>
            <p className="text-sm text-white/60 mb-4">
              Scan this QR code with Google Authenticator, Authy, or a similar app.
            </p>
            {qrUri ? (
              <div className="space-y-4">
                <div className="flex justify-center p-4 bg-white rounded-lg border">
                  {qrDataUrl ? (
                    <img src={qrDataUrl} alt="MFA QR Code" className="w-48 h-48" />
                  ) : (
                    <div className="w-48 h-48 flex items-center justify-center text-white/50 text-sm">
                      Generating QR code...
                    </div>
                  )}
                </div>
                <details className="text-sm">
                  <summary className="text-white/50 cursor-pointer hover:text-white/70">
                    Can't scan? Enter code manually
                  </summary>
                  <code className="block mt-2 p-2 bg-white/[0.08] rounded text-xs break-all text-white/80">
                    {secretCode}
                  </code>
                </details>
                <form onSubmit={handleMfaSetupSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-white/80 mb-1">
                      Enter the 6-digit code from your app
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      required
                      className="appearance-none relative block w-full px-3 py-3 border border-white/[0.15] bg-white/[0.08] placeholder-white/40 text-white rounded-xl focus:outline-none focus:ring-emerald-400/30 focus:border-emerald-400/50 text-center text-2xl tracking-widest"
                      placeholder="000000"
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isLoading || mfaCode.length !== 6}
                    className="w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-xl text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
                  >
                    {isLoading ? 'Verifying...' : 'Verify & Complete Setup'}
                  </button>
                </form>
              </div>
            ) : (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-white/20 border-t-emerald-400" />
              </div>
            )}
          </div>
        );

      case 'forgot-password':
        return (
          <div>
            <h3 className="text-lg font-semibold text-white mb-2">Reset Password</h3>
            <p className="text-sm text-white/60 mb-4">
              Enter your email and we'll send you a verification code.
            </p>
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <input
                type="email"
                required
                className="appearance-none relative block w-full px-3 py-2 border border-white/[0.15] bg-white/[0.08] placeholder-white/40 text-white rounded-xl focus:outline-none focus:ring-emerald-400/30 focus:border-emerald-400/50 sm:text-sm"
                placeholder="Email address"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
              />
              <button
                type="submit"
                disabled={isLoading}
                className="w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-xl text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
              >
                {isLoading ? 'Sending...' : 'Send Reset Code'}
              </button>
              <button
                type="button"
                onClick={() => setAuthStep('login')}
                className="w-full text-sm text-white/50 hover:text-white/80"
              >
                Back to sign in
              </button>
            </form>
          </div>
        );

      case 'confirm-reset':
        return (
          <div>
            <h3 className="text-lg font-semibold text-white mb-2">Enter Reset Code</h3>
            <p className="text-sm text-white/60 mb-4">
              Check your email for a verification code.
            </p>
            <form onSubmit={handleConfirmReset} className="space-y-4">
              <input
                type="text"
                required
                className="appearance-none relative block w-full px-3 py-2 border border-white/[0.15] bg-white/[0.08] placeholder-white/40 text-white rounded-xl focus:outline-none focus:ring-emerald-400/30 focus:border-emerald-400/50 sm:text-sm"
                placeholder="Verification code"
                value={resetCode}
                onChange={(e) => setResetCode(e.target.value)}
              />
              <input
                type="password"
                required
                minLength={12}
                className="appearance-none relative block w-full px-3 py-2 border border-white/[0.15] bg-white/[0.08] placeholder-white/40 text-white rounded-xl focus:outline-none focus:ring-emerald-400/30 focus:border-emerald-400/50 sm:text-sm"
                placeholder="New password (min 12 characters)"
                value={resetNewPassword}
                onChange={(e) => setResetNewPassword(e.target.value)}
              />
              <button
                type="submit"
                disabled={isLoading}
                className="w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-xl text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
              >
                {isLoading ? 'Resetting...' : 'Reset Password'}
              </button>
              <button
                type="button"
                onClick={() => setAuthStep('login')}
                className="w-full text-sm text-white/50 hover:text-white/80"
              >
                Back to sign in
              </button>
            </form>
          </div>
        );

      default: // 'login'
        return (
          <form className="space-y-5" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-white/80 mb-1.5">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="appearance-none block w-full px-4 py-3 bg-white/[0.08] border border-white/[0.15] text-white rounded-xl placeholder-white/40 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-400/30 focus:border-emerald-400/50 focus:bg-white/[0.12] hover:border-white/25 sm:text-sm"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-white/80 mb-1.5">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="appearance-none block w-full px-4 py-3 bg-white/[0.08] border border-white/[0.15] text-white rounded-xl placeholder-white/40 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-400/30 focus:border-emerald-400/50 focus:bg-white/[0.12] hover:border-white/25 sm:text-sm"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => setAuthStep('forgot-password')}
                className="text-sm text-white/50 hover:text-white/80 transition-colors duration-200"
              >
                Forgot your password?
              </button>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="login-btn-press w-full flex justify-center py-3 px-4 border border-transparent text-sm font-semibold rounded-xl text-white bg-primary-700 hover:bg-primary-800 hover:shadow-lg hover:shadow-primary-700/25 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:hover:transform-none"
            >
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

  {/* IMPORTANT: Do NOT remove the green gradient background, logo, or white text styling.
      See PR #41. The gradient (from-primary-800 via-primary-600 to-emerald-500) and
      brightness-0 invert logo are intentional brand design. — now on left panel. */}
  return (
    <>
      <style>{`
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeSlideRight {
          from { opacity: 0; transform: translateX(-30px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes float {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(14px, -18px) scale(1.06); }
          66% { transform: translate(-10px, 10px) scale(0.96); }
        }
        @keyframes gradientShift {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        @keyframes subtlePulse {
          0%, 100% { opacity: 0.07; }
          50% { opacity: 0.12; }
        }
        .login-fade-up { animation: fadeSlideUp 0.7s cubic-bezier(0.16, 1, 0.3, 1) both; }
        .login-fade-up-d1 { animation: fadeSlideUp 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.1s both; }
        .login-fade-up-d2 { animation: fadeSlideUp 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.2s both; }
        .login-fade-up-d3 { animation: fadeSlideUp 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.3s both; }
        .login-fade-left { animation: fadeSlideRight 0.9s cubic-bezier(0.16, 1, 0.3, 1) both; }
        .login-fade-left-d1 { animation: fadeSlideRight 0.9s cubic-bezier(0.16, 1, 0.3, 1) 0.2s both; }
        .login-fade-left-d2 { animation: fadeSlideRight 0.9s cubic-bezier(0.16, 1, 0.3, 1) 0.4s both; }
        .login-fade-left-d3 { animation: fadeSlideRight 0.9s cubic-bezier(0.16, 1, 0.3, 1) 0.6s both; }
        .login-float { animation: float 22s ease-in-out infinite; }
        .login-float-slow { animation: float 30s ease-in-out infinite reverse; }
        .login-float-mid { animation: float 26s ease-in-out 3s infinite; }
        .login-pulse { animation: subtlePulse 8s ease-in-out infinite; }
        .login-gradient-bg {
          background:
            radial-gradient(ellipse 80% 60% at 10% 90%, rgba(16, 185, 129, 0.4) 0%, transparent 60%),
            radial-gradient(ellipse 60% 80% at 80% 10%, rgba(5, 46, 22, 0.5) 0%, transparent 50%),
            radial-gradient(ellipse 50% 50% at 50% 50%, rgba(10, 61, 46, 0.3) 0%, transparent 70%),
            linear-gradient(135deg, #052e16 0%, #0A3D2E 25%, #0f766e 55%, #10b981 85%, #34d399 100%);
          background-size: 200% 200%, 200% 200%, 100% 100%, 100% 100%;
          animation: gradientShift 16s ease-in-out infinite;
        }
        .login-btn-press { transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1); }
        .login-btn-press:hover { transform: translateY(-1px); }
        .login-btn-press:active { transform: translateY(1px) scale(0.98); }
      `}</style>
      <div className="min-h-screen flex login-gradient-bg relative p-4 sm:p-6 lg:p-0">
        <div className="w-full flex rounded-2xl lg:rounded-none overflow-hidden">
          {/* Left Panel — Brand */}
          <div className="hidden lg:flex lg:w-1/2 min-h-screen relative flex-col justify-between p-12 overflow-hidden">
            {/* Decorative floating orbs */}
            <div className="absolute top-[15%] -right-20 w-72 h-72 rounded-full bg-white/[0.07] blur-3xl login-float" />
            <div className="absolute bottom-[20%] left-[15%] w-56 h-56 rounded-full bg-emerald-300/[0.08] blur-2xl login-float-slow" />
            <div className="absolute top-[55%] right-[25%] w-40 h-40 rounded-full bg-white/[0.05] blur-2xl login-float-mid" />
            <div className="absolute top-[10%] left-[40%] w-24 h-24 rounded-full bg-emerald-200/[0.06] blur-xl login-float-slow" />

            {/* Subtle grid texture overlay */}
            <div
              className="absolute inset-0 login-pulse"
              style={{
                backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.08) 1px, transparent 0)',
                backgroundSize: '32px 32px',
              }}
            />

            {/* Logo */}
            <img src="/logo-full.svg" alt="Lanyard Health" className="h-20 brightness-0 invert self-start relative z-10 login-fade-left" />

            {/* Middle — Proof bar */}
            <div className="relative z-10 login-fade-left-d1">
              <div className="bg-white/[0.08] backdrop-blur-md border border-white/[0.15] rounded-2xl p-6">
                <div className="grid grid-cols-3 divide-x divide-white/20">
                  <div className="text-center px-4">
                    <p className="text-3xl font-bold text-white tracking-tight">{statCount}x</p>
                    <p className="text-white/60 text-xs mt-1">Faster turnaround</p>
                  </div>
                  <div className="text-center px-4">
                    <p className="text-3xl font-bold text-white tracking-tight">200+</p>
                    <p className="text-white/60 text-xs mt-1">Practices onboarded</p>
                  </div>
                  <div className="text-center px-4">
                    <p className="text-3xl font-bold text-white tracking-tight">99.9%</p>
                    <p className="text-white/60 text-xs mt-1">Uptime</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom — Tagline + Testimonial */}
            <div className="relative z-10 space-y-8">
              <div className="login-fade-left-d2">
                <p className="text-4xl font-bold text-white leading-tight tracking-tight">
                  Streamlining Credentialing,<br />Empowering Providers.
                </p>
              </div>

              {/* Social proof */}
              <div className="login-fade-left-d3">
                <div className="border-t border-white/15 pt-6">
                  <blockquote className="text-white/80 text-sm leading-relaxed italic">
                    &ldquo;Lanyard Health cut our credentialing time from weeks to days. It&rsquo;s the platform we wish we had years ago.&rdquo;
                  </blockquote>
                  <div className="mt-3 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white text-xs font-semibold">
                      DR
                    </div>
                    <div>
                      <p className="text-white/90 text-sm font-medium">Dr. Rachel Simmons</p>
                      <p className="text-white/50 text-xs">Practice Director, BrightPath Behavioral</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Panel — Form (glass over gradient) */}
          <div className="w-full lg:w-1/2 lg:min-h-screen bg-white/[0.12] backdrop-blur-2xl border-l border-white/[0.15] p-8 sm:p-12 lg:p-16 flex flex-col justify-center items-center">
            <div className="w-full max-w-md">
              {/* Mobile-only logo */}
              <div className="lg:hidden flex justify-center mb-8 login-fade-up">
                <img src="/logo-full.svg" alt="Lanyard Health" className="h-14 brightness-0 invert" />
              </div>

              {authStep === 'login' && (
                <div className="mb-8 login-fade-up-d1">
                  <h2 className="text-3xl font-bold text-white tracking-tight">Welcome back</h2>
                  <p className="mt-2 text-base text-white/60">Sign in to pick up where you left off</p>
                </div>
              )}

              {/* Development Mode Login */}
              {isDevMode && authStep === 'login' && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-4 login-fade-up-d2">
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
                  </div>
                </div>
              )}

              {isDevMode && authStep === 'login' && (
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex-1 border-t border-white/20" />
                  <span className="text-sm text-white/50">Or use Cognito</span>
                  <div className="flex-1 border-t border-white/20" />
                </div>
              )}

              <div className="login-fade-up-d2">
                {renderAuthForm()}
              </div>

              {authStep === 'login' && (
                <div className="mt-8 space-y-2 login-fade-up-d3">
                  <p className="text-center text-sm text-white/70">
                    New provider?{' '}
                    <Link to="/register" className="text-white font-medium underline underline-offset-2 decoration-white/40 hover:decoration-white transition-colors">
                      Register here
                    </Link>
                  </p>
                  <p className="text-center text-sm text-white/70">
                    Manage a practice?{' '}
                    <Link to="/practice-signup" className="text-white font-medium underline underline-offset-2 decoration-white/40 hover:decoration-white transition-colors">
                      Sign up your practice
                    </Link>
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
