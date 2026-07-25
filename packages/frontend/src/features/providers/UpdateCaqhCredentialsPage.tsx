import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api/v1';

type PageState =
  | { kind: 'loading' }
  | { kind: 'pending'; firstName: string; usernameOnFile: string }
  | { kind: 'blocked' }
  | { kind: 'done' };

export default function UpdateCaqhCredentialsPage() {
  const { token } = useParams<{ token: string }>();

  const [state, setState] = useState<PageState>({ kind: 'loading' });
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setState({ kind: 'blocked' });
      return;
    }
    fetch(`${API_BASE_URL}/caqh/credential-requests/token/${token}`)
      .then((r) => r.json())
      .then((res) => {
        if (res?.success && res.data) {
          setState({ kind: 'pending', firstName: res.data.firstName, usernameOnFile: res.data.usernameOnFile });
          setUsername(res.data.usernameOnFile);
        } else {
          setState({ kind: 'blocked' });
        }
      })
      .catch(() => setState({ kind: 'blocked' }));
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state.kind !== 'pending' || !username.trim() || !password) return;

    setSubmitting(true);
    try {
      const response = await fetch(`${API_BASE_URL}/caqh/credential-requests/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, username: username.trim(), password }),
      });
      const data = await response.json();

      if (!response.ok) {
        if (response.status === 410) {
          setState({ kind: 'blocked' });
        } else {
          toast.error(data?.error?.message || "We couldn't save your login. Please try again.");
        }
        return;
      }
      setState({ kind: 'done' });
    } catch {
      toast.error("We couldn't save your login. Please try again.");
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
          <h2 className="mt-6 text-center text-2xl font-bold text-white">Update your CAQH login</h2>
        </div>

        <div className="bg-white/95 backdrop-blur rounded-2xl p-6 shadow-xl">
          {state.kind === 'loading' && (
            <p className="text-center text-sm text-gray-500 py-6">Checking your link…</p>
          )}

          {state.kind === 'blocked' && (
            <div className="text-center space-y-3 py-2">
              <h3 className="text-base font-semibold text-gray-900">This link has expired or was already used</h3>
              <p className="text-sm text-gray-600">Ask your Lanyard Health contact to send you a fresh one.</p>
            </div>
          )}

          {state.kind === 'done' && (
            <div className="text-center space-y-3 py-2">
              <h3 className="text-base font-semibold text-gray-900">Got it — thank you!</h3>
              <p className="text-sm text-gray-600">
                We saved your login and will re-check your CAQH connection automatically. You're all set; you can close
                this page.
              </p>
            </div>
          )}

          {state.kind === 'pending' && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-sm text-gray-600">
                Hi {state.firstName}, the CAQH ProView login we have for you didn't work. Confirm your username and
                enter your current password, and we'll take it from there.
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">CAQH username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className={inputClassName}
                  autoComplete="username"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">CAQH password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputClassName}
                  autoComplete="current-password"
                  required
                />
                <p className="mt-1 text-xs text-gray-500">Stored encrypted. We never show or email your password.</p>
              </div>
              <button
                type="submit"
                disabled={submitting || !username.trim() || !password}
                className="w-full py-2.5 px-4 rounded-xl text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50"
              >
                {submitting ? 'Saving…' : 'Save my CAQH login'}
              </button>
              <p className="text-xs text-gray-500 text-center">
                Forgot your CAQH password?{' '}
                <a
                  href="https://proview.caqh.org/Login"
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary-600 underline"
                >
                  Reset it at CAQH ProView
                </a>{' '}
                first, then come back to this page.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
