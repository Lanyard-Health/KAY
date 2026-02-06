import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth.store';
import toast from 'react-hot-toast';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const { login, devLogin, devProviderLogin, isDevMode } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await login(email, password);
      toast.success('Logged in successfully');
      navigate('/');
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8f8fa] py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <img src="/logo.png" alt="Lanyard Health" className="h-12 mx-auto" />
          <h2 className="mt-6 text-center text-2xl font-bold text-gray-900">
            Sign in to your account
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Healthcare Credentialing Management System
          </p>
        </div>

        {/* Development Mode Login */}
        {isDevMode && (
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

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-300" />
          </div>
          {isDevMode && (
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-[#f8f8fa] text-gray-500">Or use Cognito</span>
            </div>
          )}
        </div>

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
                'Sign in with Cognito'
              )}
            </button>
          </div>
        </form>

        <p className="text-center text-sm text-gray-600">
          New provider?{' '}
          <Link to="/register" className="text-primary-600 hover:text-primary-500 font-medium">
            Register here
          </Link>
        </p>
      </div>
    </div>
  );
}
