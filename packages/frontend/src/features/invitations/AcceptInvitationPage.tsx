import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../stores/auth.store';
import PasswordStrength from '../../components/PasswordStrength';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api/v1';

type InviteState =
  | { kind: 'loading' }
  | { kind: 'pending'; email: string; practiceName: string }
  | { kind: 'blocked'; reason: 'expired' | 'revoked' | 'accepted' | 'invalid' };

const BLOCKED_COPY: Record<string, { title: string; message: string }> = {
  expired: { title: 'This invitation has expired', message: 'Ask your practice admin to send you a new one.' },
  revoked: { title: 'This invitation was revoked', message: 'Ask your practice admin to send you a new one.' },
  accepted: { title: 'This invitation was already used', message: 'Your account is set up. Try signing in instead.' },
  invalid: { title: 'This invitation link is not valid', message: 'Double-check the link, or ask your admin to resend it.' },
};

export default function AcceptInvitationPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { isDevMode } = useAuthStore();

  const [state, setState] = useState<InviteState>({ kind: 'loading' });
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setState({ kind: 'blocked', reason: 'invalid' });
      return;
    }
    fetch(`${API_BASE_URL}/practices/invitations/token/${token}`)
      .then((r) => r.json())
      .then((res) => {
        const data = res?.data;
        if (!data || data.status === 'invalid') {
          setState({ kind: 'blocked', reason: 'invalid' });
        } else if (data.status === 'pending') {
          setState({ kind: 'pending', email: data.email, practiceName: data.practiceName });
        } else {
          setState({ kind: 'blocked', reason: data.status });
        }
      })
      .catch(() => setState({ kind: 'blocked', reason: 'invalid' }));
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state.kind !== 'pending') return;
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`${API_BASE_URL}/practices/invitations/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password: newPassword, firstName, lastName }),
      });
      const data = await response.json();

      if (!response.ok) {
        toast.error(data?.error?.message || "We couldn't finish setting up your account. Please try again.");
        // If the link became unusable while they were on the page, reflect it.
        if (response.status === 410 || response.status === 404 || response.status === 409) {
          const reason = response.status === 409 ? 'accepted' : response.status === 404 ? 'invalid' : 'expired';
          setState({ kind: 'blocked', reason });
        }
        return;
      }

      toast.success('Welcome to Lanyard Health. Your account is ready.');

      if (isDevMode) {
        navigate('/login');
        return;
      }
      try {
        await useAuthStore.getState().login(state.email, newPassword);
        navigate('/');
      } catch {
        navigate('/login');
      }
    } catch {
      toast.error("We couldn't finish setting up your account. Please try again.");
    } finally {
      setSubmitting(false);
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
            {state.kind === 'pending' ? `Join ${state.practiceName}` : 'Accept your invitation'}
          </h2>
        </div>

        <div className="bg-white/95 backdrop-blur rounded-2xl p-6 shadow-xl">
          {state.kind === 'loading' && (
            <p className="text-center text-sm text-gray-500 py-6">Checking your invitation…</p>
          )}

          {state.kind === 'blocked' && (
            <div className="text-center space-y-3 py-2">
              <h3 className="text-base font-semibold text-gray-900">{BLOCKED_COPY[state.reason].title}</h3>
              <p className="text-sm text-gray-600">{BLOCKED_COPY[state.reason].message}</p>
              <Link to="/login" className="inline-block text-sm font-medium text-primary-700 hover:text-primary-800">
                Go to sign in
              </Link>
            </div>
          )}

          {state.kind === 'pending' && (
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input type="email" className={`${inputClassName} bg-gray-50`} value={state.email} disabled readOnly />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="firstName" className="block text-sm font-medium text-gray-700 mb-1">First Name</label>
                  <input id="firstName" type="text" required minLength={1} className={inputClassName} placeholder="First" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                </div>
                <div>
                  <label htmlFor="lastName" className="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
                  <input id="lastName" type="text" required minLength={1} className={inputClassName} placeholder="Last" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input id="password" type="password" required minLength={12} className={inputClassName} placeholder="Minimum 12 characters" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                <PasswordStrength password={newPassword} />
              </div>

              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
                <input id="confirmPassword" type="password" required minLength={12} className={inputClassName} placeholder="Re-enter your password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
              </div>

              <button type="submit" disabled={submitting} className="w-full flex justify-center py-2.5 px-4 border border-transparent text-sm font-medium rounded-xl text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 transition-colors">
                {submitting ? 'Setting up your account…' : 'Create account & join'}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-sm text-white/70">
          Already have an account?{' '}
          <Link to="/login" className="text-white hover:text-white/90 font-medium">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
