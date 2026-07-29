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
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
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

const SCREEN_ORDER: Record<Screen, number> = { signin: 0, code: 1, reset: 2 };

export default function LoginPrototype() {
  const [screen, setScreen] = useState<Screen>('signin');
  const [verified, setVerified] = useState(false);
  // Motion prototype controls: two candidate card transitions to compare live
  const [motionMode, setMotionMode] = useState<'fade' | 'slide'>('fade');
  const [dir, setDir] = useState(1); // 1 = forward, -1 = back (slide mode)
  const [leavingTo, setLeavingTo] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();
  const navigate = useNavigate();

  // Warm the lazy-loaded registration pages while the user reads this screen,
  // so Register here / Sign up your practice open without a blank flash.
  // Vite dedupes these with App.tsx's lazy() imports — same chunk either way.
  useEffect(() => {
    void import('../portal/RegisterPage');
    void import('../practice/PracticeSignupPage');
  }, []);

  const go = (s: Screen) => {
    setDir(SCREEN_ORDER[s] >= SCREEN_ORDER[screen] ? 1 : -1);
    setScreen(s);
    setVerified(false);
  };

  // Fade the whole page out before navigating to a real route, so leaving
  // the login doesn't hard-cut (reduced motion: navigate immediately)
  const leaveTo = (e: React.MouseEvent, path: string) => {
    e.preventDefault();
    if (reduceMotion) {
      navigate(path);
      return;
    }
    setLeavingTo(path);
  };

  const cardVariants =
    motionMode === 'slide'
      ? {
          initial: { opacity: 0, x: 28 * dir },
          animate: { opacity: 1, x: 0 },
          exit: { opacity: 0, x: -28 * dir },
        }
      : {
          initial: { opacity: 0, y: 10 },
          animate: { opacity: 1, y: 0 },
          exit: { opacity: 0, y: -6 },
        };

  return (
    <div
      className="flex min-h-screen bg-[#faf7f2] text-[#1f2721]"
      style={{ fontFamily: POPPINS }}
    >
      {/* Leave wash: fades IN the destination pages' exact gradient before
          navigating, so the near-white app backdrop is never exposed and the
          cut to the identically-colored register pages is invisible */}
      <motion.div
        className="pointer-events-none fixed inset-0 z-50 bg-[#faf7f2]"
        initial={{ opacity: 0 }}
        animate={{ opacity: leavingTo ? 1 : 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        onAnimationComplete={() => {
          if (leavingTo) navigate(leavingTo);
        }}
      />
      {/* Left: content panel */}
      <div className="relative flex min-h-screen w-full flex-col lg:w-1/2">
        <header className="flex items-center justify-between gap-3 px-6 pt-6 sm:px-10">
          <img src="/logo-full.svg" alt="Lanyard Health" className="h-[72px] w-auto" />
          <div className="flex items-center gap-1.5 rounded-full border border-[#e7e1d6] bg-white px-3.5 py-1.5 text-xs text-[#6b665c] shadow-sm">
            You are signing into
            <span className="font-semibold text-[#1f2721]">Lanyard</span>
          </div>
        </header>

        {/* Prototype controls: screen + motion-style toggles */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-2">
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
                onClick={() => go(s)}
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
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#a49d8f]">
              Motion
            </span>
            <div className="flex rounded-full border border-[#e7e1d6] bg-white p-1 shadow-sm">
              {(
                [
                  ['fade', 'Fade + rise'],
                  ['slide', 'Slide'],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={motionMode === m}
                  onClick={() => setMotionMode(m)}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2d8b6a] ${
                    motionMode === m
                      ? 'bg-[#0A3D2E] text-white'
                      : 'text-[#6b665c] hover:text-[#1f2721]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <main className="flex flex-1 items-center justify-center overflow-x-hidden px-6 py-10">
          <div className="w-full max-w-sm">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={verified ? 'done' : screen}
                initial={cardVariants.initial}
                animate={cardVariants.animate}
                exit={cardVariants.exit}
                transition={{
                  duration: reduceMotion ? 0 : 0.2,
                  ease: [0.22, 1, 0.36, 1],
                }}
              >
                {verified ? (
                  <SignedInState
                    onReset={() => {
                      setDir(-1);
                      setVerified(false);
                      setScreen('signin');
                    }}
                  />
                ) : screen === 'signin' ? (
                  <SignInScreen
                    onSubmit={() => go('code')}
                    onForgotPassword={() => go('reset')}
                    onLeave={leaveTo}
                  />
                ) : screen === 'code' ? (
                  <MfaCodeScreen
                    onVerified={() => {
                      setDir(1);
                      setVerified(true);
                    }}
                  />
                ) : (
                  <ResetScreen onDone={() => go('signin')} />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>

        <footer className="px-6 pb-8 text-center text-xs leading-5 text-[#8a8478]">
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
  onLeave,
}: {
  onSubmit: () => void;
  onForgotPassword: () => void;
  onLeave: (e: React.MouseEvent, path: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <div className="">
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
            onClick={(e) => onLeave(e, '/register')}
            className="font-medium text-[#1a6b4e] underline-offset-2 transition hover:underline active:opacity-50"
          >
            Register here
          </Link>
        </p>
        <p>
          Manage a practice?{' '}
          <Link
            to="/practice-signup"
            onClick={(e) => onLeave(e, '/practice-signup')}
            className="font-medium text-[#1a6b4e] underline-offset-2 transition hover:underline active:opacity-50"
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
    <div className="">
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
    <div className="">
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
    <div className="text-center">
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
