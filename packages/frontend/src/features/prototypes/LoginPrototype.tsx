/**
 * PROTOTYPE ONLY — /prototypes/login
 *
 * Design exploration for a full login-screen redesign in the warm-paper
 * style (candidate to replace the current dark-gradient LoginPage).
 * Nothing is wired to real auth: no Cognito, no backend calls. Submitting
 * "signs in" to a fake MFA step; any 6 digits pass.
 *
 * Per Kay (2026-07-28): the current login's stats bar, testimonial, and
 * quote are dropped — the dark panel is pure brand art.
 *
 * Flip screens with the Prototype toggle at the top (Sign in / MFA code /
 * Reset password) — live state switch, no reload.
 *
 * PROVISIONAL STYLING — same placeholder values as VerifyEmailPrototype
 * (Poppins page-scoped, warm paper #faf7f2, placeholder gradient panel);
 * brand identity work is in progress and these will likely change.
 * ponytail: shell markup duplicated from VerifyEmailPrototype on purpose —
 * extract a shared shell only if a third prototype appears.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckIcon } from '@heroicons/react/24/outline';
import CodeInput from '../../components/CodeInput';

const MOCK_EMAIL = 'jordan@brightpathbehavioral.com'; // mock data only

const POPPINS =
  "'Poppins', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

type Screen = 'signin' | 'code' | 'reset';

const FIELD_CLASSES =
  'h-12 w-full rounded-xl border border-[#e3ddd2] bg-white px-4 text-sm text-[#1f2721] shadow-sm outline-none transition placeholder:text-[#a49d8f] focus:border-[#2d8b6a] focus:ring-4 focus:ring-[#2d8b6a]/15';

const PRIMARY_BUTTON_CLASSES =
  'h-12 w-full rounded-full bg-[#0A3D2E] text-sm font-medium text-white shadow-sm transition hover:bg-[#082f23] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2d8b6a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#faf7f2]';

export default function LoginPrototype() {
  const [screen, setScreen] = useState<Screen>('signin');
  const [verified, setVerified] = useState(false);

  // Page-scoped Poppins load so the prototype doesn't change the app's fonts
  useEffect(() => {
    const id = 'prototype-poppins-font';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href =
      'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap';
    document.head.appendChild(link);
  }, []);

  const switchTo = (s: Screen) => {
    setScreen(s);
    setVerified(false);
  };

  return (
    <div
      className="flex min-h-screen bg-[#faf7f2] text-[#1f2721]"
      style={{ fontFamily: POPPINS }}
    >
      {/* Left: content panel */}
      <div className="relative flex min-h-screen w-full flex-col lg:w-1/2">
        <header className="flex items-center justify-between gap-3 px-6 pt-6 sm:px-10">
          <img src="/logo-full.svg" alt="Lanyard Health" className="h-[72px] w-auto" />
          <div className="flex items-center gap-1.5 rounded-full border border-[#e7e1d6] bg-white px-3.5 py-1.5 text-xs text-[#6b665c] shadow-sm">
            You are signing into
            <span className="font-semibold text-[#1f2721]">Lanyard</span>
          </div>
        </header>

        {/* Prototype screen toggle */}
        <div className="mt-8 flex items-center justify-center gap-2.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#a49d8f]">
            Prototype
          </span>
          <div className="flex rounded-full border border-[#e7e1d6] bg-white p-1 shadow-sm">
            {(
              [
                ['signin', 'Sign in'],
                ['code', 'MFA code'],
                ['reset', 'Reset password'],
              ] as const
            ).map(([s, label]) => (
              <button
                key={s}
                type="button"
                aria-pressed={screen === s}
                onClick={() => switchTo(s)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2d8b6a] ${
                  screen === s
                    ? 'bg-[#0A3D2E] text-white'
                    : 'text-[#6b665c] hover:text-[#1f2721]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <main className="flex flex-1 items-center justify-center px-6 py-10">
          <div className="w-full max-w-sm">
            {verified ? (
              <SignedInState onReset={() => setVerified(false)} />
            ) : screen === 'signin' ? (
              <SignInScreen
                onSubmit={() => setScreen('code')}
                onForgotPassword={() => setScreen('reset')}
              />
            ) : screen === 'code' ? (
              <MfaCodeScreen onVerified={() => setVerified(true)} />
            ) : (
              <ResetScreen onDone={() => setScreen('signin')} />
            )}
          </div>
        </main>

        <footer className="px-6 pb-8 text-center text-xs leading-5 text-[#8a8478]">
          By continuing, you agree to Lanyard Health's{' '}
          {/* placeholder links — swap for real ToS/Privacy URLs */}
          <a href="#" className="font-medium text-[#1f2721] underline underline-offset-2">
            Terms of Service
          </a>{' '}
          and{' '}
          <a href="#" className="font-medium text-[#1f2721] underline underline-offset-2">
            Privacy Policy
          </a>
          .
        </footer>
      </div>

      {/* Right: dark brand panel (placeholder art, hidden on mobile).
          Stats / testimonial / quote deliberately absent. */}
      <div
        className="relative hidden overflow-hidden lg:block lg:w-1/2"
        aria-hidden="true"
        style={{
          background: 'linear-gradient(150deg, #040f0b 0%, #0A3D2E 62%, #1a6b4e 105%)',
        }}
      >
        <div
          className="absolute -right-44 top-0 h-full w-[26rem]"
          style={{
            background:
              'radial-gradient(closest-side, rgba(250,247,242,0.26), transparent 72%)',
            filter: 'blur(46px)',
          }}
        />
        {/* ghost mark placeholder — replace with the real brand mark */}
        <div className="absolute left-1/2 top-1/2 h-[540px] w-[540px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10" />
        <div className="absolute left-1/2 top-1/2 h-[350px] w-[350px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.06]" />
      </div>
    </div>
  );
}

/* ------------------------------ sign-in screen ---------------------------- */

function SignInScreen({
  onSubmit,
  onForgotPassword,
}: {
  onSubmit: () => void;
  onForgotPassword: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <div className="animate-fade-in">
      <h1 className="text-center text-2xl font-semibold text-[#171b17]">Welcome back</h1>
      <p className="mt-3 text-center text-sm leading-6 text-[#6b665c]">
        Sign in to your Lanyard portal.
      </p>

      <form
        className="mt-8 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(); // mock: always proceeds to the MFA step
        }}
      >
        <input
          type="email"
          autoComplete="email"
          placeholder="Email address"
          aria-label="Email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={FIELD_CLASSES}
        />
        <input
          type="password"
          autoComplete="current-password"
          placeholder="Password"
          aria-label="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={FIELD_CLASSES}
        />
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onForgotPassword}
            className="text-xs font-medium text-[#1a6b4e] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2d8b6a]"
          >
            Forgot password?
          </button>
        </div>
        <button type="submit" disabled={!email || !password} className={PRIMARY_BUTTON_CLASSES}>
          Continue
        </button>
      </form>

      <div className="mt-6 space-y-1.5 text-center text-xs text-[#8a8478]">
        <p>
          New provider?{' '}
          <Link
            to="/register"
            className="font-medium text-[#1a6b4e] underline-offset-2 hover:underline"
          >
            Register here
          </Link>
        </p>
        <p>
          Manage a practice?{' '}
          <Link
            to="/practice-signup"
            className="font-medium text-[#1a6b4e] underline-offset-2 hover:underline"
          >
            Sign up your practice
          </Link>
        </p>
      </div>
    </div>
  );
}

/* ------------------------------ MFA code screen --------------------------- */

function MfaCodeScreen({ onVerified }: { onVerified: () => void }) {
  const [code, setCode] = useState('');
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="animate-fade-in">
      <h1 className="text-center text-2xl font-semibold text-[#171b17]">
        Check your email
      </h1>
      <p className="mt-3 text-center text-sm leading-6 text-[#6b665c]">
        We sent a 6-digit code to{' '}
        <span className="font-semibold text-[#1f2721]">{MOCK_EMAIL}</span>.
      </p>

      <div className="mt-8">
        <CodeInput tone="light" value={code} onChange={setCode} autoFocus />
      </div>

      <button
        type="button"
        disabled={code.length !== 6 || confirming}
        onClick={() => {
          setConfirming(true);
          // ponytail: fake latency stands in for the real Cognito confirm call
          window.setTimeout(onVerified, 900);
        }}
        className={`mt-8 ${PRIMARY_BUTTON_CLASSES}`}
      >
        {confirming ? 'Verifying…' : 'Verify'}
      </button>
    </div>
  );
}

/* ------------------------------- reset screen ----------------------------- */

function ResetScreen({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');

  return (
    <div className="animate-fade-in">
      <h1 className="text-center text-2xl font-semibold text-[#171b17]">
        Reset your password
      </h1>
      <p className="mt-3 text-center text-sm leading-6 text-[#6b665c]">
        Enter the code we emailed to{' '}
        <span className="font-semibold text-[#1f2721]">{MOCK_EMAIL}</span> and pick a
        new password.
      </p>

      <div className="mt-8">
        <CodeInput tone="light" value={code} onChange={setCode} autoFocus />
      </div>

      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          onDone(); // mock: returns to sign-in
        }}
      >
        <input
          type="password"
          autoComplete="new-password"
          placeholder="New password (min 12 characters)"
          aria-label="New password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={FIELD_CLASSES}
        />
        <button
          type="submit"
          disabled={code.length !== 6 || password.length < 12}
          className={PRIMARY_BUTTON_CLASSES}
        >
          Reset password
        </button>
      </form>
    </div>
  );
}

/* ------------------------------ signed-in state --------------------------- */

function SignedInState({ onReset }: { onReset: () => void }) {
  return (
    <div className="animate-fade-in text-center">
      <div className="animate-scale-in mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#1a6b4e]">
        <CheckIcon className="h-7 w-7 text-white" strokeWidth={2.5} />
      </div>
      <h1 className="mt-5 text-2xl font-semibold text-[#171b17]">You're in</h1>
      <p className="mt-3 text-sm leading-6 text-[#6b665c]">
        In the real flow this would land on your dashboard; this prototype stops
        here.
      </p>
      <button type="button" onClick={onReset} className={`mt-8 ${PRIMARY_BUTTON_CLASSES}`}>
        Start over
      </button>
    </div>
  );
}
