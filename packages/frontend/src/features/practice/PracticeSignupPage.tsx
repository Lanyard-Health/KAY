import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth.store';
import toast from 'react-hot-toast';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api/v1';

function PasswordStrength({ password }: { password: string }) {
  const checks = [
    { label: '12+ characters', pass: password.length >= 12 },
    { label: 'Uppercase letter', pass: /[A-Z]/.test(password) },
    { label: 'Lowercase letter', pass: /[a-z]/.test(password) },
    { label: 'Number', pass: /[0-9]/.test(password) },
    { label: 'Special character', pass: /[^A-Za-z0-9]/.test(password) },
  ];
  const passed = checks.filter((c) => c.pass).length;

  if (!password) return null;

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              i <= passed
                ? passed <= 2
                  ? 'bg-red-400'
                  : passed <= 3
                    ? 'bg-yellow-400'
                    : 'bg-green-500'
                : 'bg-gray-200'
            }`}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
        {checks.map((c) => (
          <span
            key={c.label}
            className={`text-xs ${c.pass ? 'text-green-600' : 'text-gray-400'}`}
          >
            {c.pass ? '\u2713' : '\u2022'} {c.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function PracticeSignupPage() {
  const [form, setForm] = useState({
    practiceName: '',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const { checkAuth, isDevMode } = useAuthStore();

  const update = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (form.password !== form.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/practices/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          practiceName: form.practiceName,
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
          phone: form.phone,
          password: form.password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 409) {
          toast.error('An account with this email already exists');
        } else if (data.details) {
          toast.error(data.details[0]?.message || 'Validation failed');
        } else {
          toast.error(data.error || 'Registration failed');
        }
        return;
      }

      toast.success('Practice registered successfully!');

      // Login with the credentials just submitted
      if (isDevMode) {
        localStorage.setItem('dev_session', 'practice_admin');
        await checkAuth();
        navigate('/');
      } else {
        const { login } = useAuthStore.getState();
        await login(form.email, form.password);
        navigate('/');
      }
    } catch {
      toast.error('Registration failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const inputClassName =
    'appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-xl focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-800 via-primary-600 to-emerald-500 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <img src="/logo.png" alt="Lanyard Health" className="h-16 mx-auto brightness-0 invert" />
          <h2 className="mt-6 text-center text-2xl font-bold text-white">
            Sign up your practice
          </h2>
          <p className="mt-2 text-center text-sm text-white/70">
            Start managing your credentialing workflow today
          </p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="bg-white/95 backdrop-blur rounded-2xl p-6 shadow-xl space-y-4">
            <div>
              <label htmlFor="practiceName" className="block text-sm font-medium text-gray-700 mb-1">
                Practice Name
              </label>
              <input
                id="practiceName"
                type="text"
                required
                minLength={2}
                className={inputClassName}
                placeholder="Your practice name"
                value={form.practiceName}
                onChange={update('practiceName')}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="firstName" className="block text-sm font-medium text-gray-700 mb-1">
                  First Name
                </label>
                <input
                  id="firstName"
                  type="text"
                  required
                  minLength={2}
                  className={inputClassName}
                  placeholder="First"
                  value={form.firstName}
                  onChange={update('firstName')}
                />
              </div>
              <div>
                <label htmlFor="lastName" className="block text-sm font-medium text-gray-700 mb-1">
                  Last Name
                </label>
                <input
                  id="lastName"
                  type="text"
                  required
                  minLength={2}
                  className={inputClassName}
                  placeholder="Last"
                  value={form.lastName}
                  onChange={update('lastName')}
                />
              </div>
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                className={inputClassName}
                placeholder="you@practice.com"
                value={form.email}
                onChange={update('email')}
              />
            </div>

            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">
                Phone
              </label>
              <input
                id="phone"
                type="tel"
                required
                className={inputClassName}
                placeholder="(555) 123-4567"
                value={form.phone}
                onChange={update('phone')}
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={12}
                className={inputClassName}
                placeholder="Minimum 12 characters"
                value={form.password}
                onChange={update('password')}
              />
              <PasswordStrength password={form.password} />
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-1">
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                required
                minLength={12}
                className={inputClassName}
                placeholder="Re-enter your password"
                value={form.confirmPassword}
                onChange={update('confirmPassword')}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full flex justify-center py-2.5 px-4 border border-transparent text-sm font-medium rounded-xl text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 transition-colors"
          >
            {isLoading ? (
              <span className="flex items-center">
                <svg
                  className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Creating your account...
              </span>
            ) : (
              'Create Account'
            )}
          </button>
        </form>

        <p className="text-center text-sm text-white/70">
          Already have an account?{' '}
          <Link to="/login" className="text-white hover:text-white/90 font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
