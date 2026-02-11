import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth.store';
import toast from 'react-hot-toast';

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
  const [secretCode, setSecretCode] = useState('');

  const navigate = useNavigate();
  const {
    login,
    devLogin,
    devProviderLogin,
    isDevMode,
    challengeName,
    handleNewPasswordChallenge,
    handleMfaChallenge,
    handleMfaSetup,
    confirmMfaSetup,
    forgotPassword,
    confirmForgotPassword,
  } = useAuthStore();

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
        toast.error('Failed to initialize MFA setup');
      });
    }
  }, [challengeName]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await login(email, password);
      const state = useAuthStore.getState();
      if (!state.challengeName && state.isAuthenticated) {
        toast.success('Logged in successfully');
        navigate(state.user?.role === 'provider' ? '/portal' : '/');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDevLogin = async () => {
    setIsLoading(true);
    try {
      await devLogin();
      toast.success('Logged in as Dev Admin');
      navigate('/');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Dev login failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDevProviderLogin = async () => {
    setIsLoading(true);
    try {
      await devProviderLogin();
      toast.success('Logged in as Dev Provider');
      navigate('/portal');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Dev provider login failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    if (newPassword.length < 12) {
      toast.error('Password must be at least 12 characters');
      return;
    }
    setIsLoading(true);
    try {
      await handleNewPasswordChallenge(newPassword);
      const state = useAuthStore.getState();
      if (!state.challengeName && state.isAuthenticated) {
        toast.success('Password set successfully');
        navigate(state.user?.role === 'provider' ? '/portal' : '/');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to set password');
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
        toast.success('Logged in successfully');
        navigate(state.user?.role === 'provider' ? '/portal' : '/');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Invalid verification code');
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
        toast.success('MFA configured successfully');
        navigate(state.user?.role === 'provider' ? '/portal' : '/');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'MFA setup failed');
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
      toast.success('Verification code sent to your email');
      setAuthStep('confirm-reset');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to send reset code');
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (resetNewPassword.length < 12) {
      toast.error('Password must be at least 12 characters');
      return;
    }
    setIsLoading(true);
    try {
      await confirmForgotPassword(resetEmail, resetCode, resetNewPassword);
      toast.success('Password reset successfully. Please sign in.');
      setAuthStep('login');
      setResetEmail('');
      setResetCode('');
      setResetNewPassword('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to reset password');
    } finally {
      setIsLoading(false);
    }
  };

  const renderAuthForm = () => {
    switch (authStep) {
      case 'new-password':
        return (
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Set New Password</h3>
            <p className="text-sm text-gray-600 mb-4">
              Your temporary password has expired. Please set a new password.
            </p>
            <form onSubmit={handleNewPassword} className="space-y-4">
              <div>
                <label htmlFor="new-password" className="block text-sm font-medium text-gray-700 mb-1">
                  New Password
                </label>
                <input
                  id="new-password"
                  type="password"
                  required
                  minLength={12}
                  className="appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-xl focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                  placeholder="Minimum 12 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700 mb-1">
                  Confirm Password
                </label>
                <input
                  id="confirm-password"
                  type="password"
                  required
                  minLength={12}
                  className="appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-xl focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                  placeholder="Re-enter your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
              <p className="text-xs text-gray-500">
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
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Verification Code</h3>
            <p className="text-sm text-gray-600 mb-4">
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
                className="appearance-none relative block w-full px-3 py-3 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-xl focus:outline-none focus:ring-primary-500 focus:border-primary-500 text-center text-2xl tracking-widest"
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
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Set Up Authenticator</h3>
            <p className="text-sm text-gray-600 mb-4">
              Scan this QR code with Google Authenticator, Authy, or a similar app.
            </p>
            {qrUri ? (
              <div className="space-y-4">
                <div className="flex justify-center p-4 bg-white rounded-lg border">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrUri)}`}
                    alt="MFA QR Code"
                    className="w-48 h-48"
                  />
                </div>
                <details className="text-sm">
                  <summary className="text-gray-500 cursor-pointer hover:text-gray-700">
                    Can't scan? Enter code manually
                  </summary>
                  <code className="block mt-2 p-2 bg-gray-100 rounded text-xs break-all">
                    {secretCode}
                  </code>
                </details>
                <form onSubmit={handleMfaSetupSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Enter the 6-digit code from your app
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      required
                      className="appearance-none relative block w-full px-3 py-3 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-xl focus:outline-none focus:ring-primary-500 focus:border-primary-500 text-center text-2xl tracking-widest"
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
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200 border-t-primary-600" />
              </div>
            )}
          </div>
        );

      case 'forgot-password':
        return (
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Reset Password</h3>
            <p className="text-sm text-gray-600 mb-4">
              Enter your email and we'll send you a verification code.
            </p>
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <input
                type="email"
                required
                className="appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-xl focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
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
                className="w-full text-sm text-gray-500 hover:text-gray-700"
              >
                Back to sign in
              </button>
            </form>
          </div>
        );

      case 'confirm-reset':
        return (
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Enter Reset Code</h3>
            <p className="text-sm text-gray-600 mb-4">
              Check your email for a verification code.
            </p>
            <form onSubmit={handleConfirmReset} className="space-y-4">
              <input
                type="text"
                required
                className="appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-xl focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                placeholder="Verification code"
                value={resetCode}
                onChange={(e) => setResetCode(e.target.value)}
              />
              <input
                type="password"
                required
                minLength={12}
                className="appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-xl focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
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
                className="w-full text-sm text-gray-500 hover:text-gray-700"
              >
                Back to sign in
              </button>
            </form>
          </div>
        );

      default: // 'login'
        return (
          <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
            <div className="rounded-md shadow-sm -space-y-px">
              <div>
                <label htmlFor="email" className="sr-only">
                  Email address
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-t-xl focus:outline-none focus:ring-primary-500 focus:border-primary-500 focus:z-10 sm:text-sm"
                  placeholder="Email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="password" className="sr-only">
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-b-xl focus:outline-none focus:ring-primary-500 focus:border-primary-500 focus:z-10 sm:text-sm"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>

            {!isDevMode && (
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => setAuthStep('forgot-password')}
                  className="text-sm text-white/80 hover:text-white"
                >
                  Forgot your password?
                </button>
              </div>
            )}

            <div>
              <button
                type="submit"
                disabled={isLoading}
                className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-xl text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
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
            </div>
          </form>
        );
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-800 via-primary-600 to-emerald-500 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <img src="/logo.png" alt="Lanyard Health" className="h-12 mx-auto brightness-0 invert" />
          <h2 className="mt-6 text-center text-2xl font-bold text-white">
            Sign in to your account
          </h2>
          <p className="mt-2 text-center text-sm text-white/70">
            Healthcare Credentialing Management System
          </p>
        </div>

        {/* Development Mode Login */}
        {isDevMode && authStep === 'login' && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
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
                className="w-full flex justify-center py-2 px-4 border border-yellow-400 text-sm font-medium rounded-xl text-yellow-800 bg-yellow-100 hover:bg-yellow-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500 disabled:opacity-50"
              >
                {isLoading ? 'Logging in...' : 'Login as Dev Admin'}
              </button>
              <button
                onClick={handleDevProviderLogin}
                disabled={isLoading}
                className="w-full flex justify-center py-2 px-4 border border-primary-400 text-sm font-medium rounded-xl text-primary-800 bg-primary-50 hover:bg-primary-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
              >
                {isLoading ? 'Logging in...' : 'Login as Dev Provider'}
              </button>
            </div>
          </div>
        )}

        {isDevMode && authStep === 'login' && (
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-300" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-[#f8f8fa] text-gray-500">Or use Cognito</span>
            </div>
          </div>
        )}

        {renderAuthForm()}

        {authStep === 'login' && (
          <p className="text-center text-sm text-white/70">
            New provider?{' '}
            <Link to="/register" className="text-white hover:text-white/90 font-medium">
              Register here
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
