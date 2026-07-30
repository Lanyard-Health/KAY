/**
 * PROTOTYPE ONLY — /prototypes/login
 *
 * Design exploration for the login redesign v2 (candidate to replace the
 * split-panel LoginPage). Nothing is wired to real auth: no Cognito, no
 * backend calls. Submitting "signs in" to a fake MFA step; any 6 digits pass.
 *
 * Per Kay (2026-07-30, supersedes the 2026-07-28 no-quote decision): repeated
 * faded-submark wallpaper on warm paper, thesis quote as the big brand
 * statement next to the logo (LangSmith-style), white form card. Kay picked
 * quote 3 ("The fastest path from credentialed to paid...") — shipped in
 * LoginPage.tsx. The quote toggle (or ?quote=1..4) remains for comparison.
 *
 * ponytail: sub-screens carried over from the previous prototype unchanged —
 * only the shell changed.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { CheckIcon } from '@heroicons/react/24/outline';
import CodeInput from '../../components/CodeInput';
import { lanyardMarkTileUrl } from '../../components/LanyardMark';

const MOCK_EMAIL = 'jordan@brightpathbehavioral.com'; // mock data only

const POPPINS =
  "'Poppins', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

type Screen = 'signin' | 'code' | 'reset';

const FIELD_CLASSES =
  'h-12 w-full rounded-xl border border-[#e3ddd2] bg-white px-4 text-sm text-[#1f2721] shadow-sm outline-none transition placeholder:text-[#a49d8f] focus:border-[#2d8b6a] focus:ring-4 focus:ring-[#2d8b6a]/15';

const PRIMARY_BUTTON_CLASSES =
  'h-12 w-full rounded-full bg-[#0A3D2E] text-sm font-medium text-white shadow-sm transition hover:bg-[#082f23] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2d8b6a] focus-visible:ring-offset-2 focus-visible:ring-offset-white';

// Staggered repeated-submark wallpaper: same tile layered twice, second
// layer offset by half a cell (brick pattern)
const MARK_TILE = lanyardMarkTileUrl('#f4efe6');
const WALLPAPER_STYLE = {
  backgroundImage: `url("${MARK_TILE}"), url("${MARK_TILE}")`,
  backgroundSize: '260px 199px, 260px 199px',
  backgroundPosition: '0 0, 130px 99px',
};

// Thesis quote candidates (revenue, transparency, trust) — Kay picks one.
const QUOTES = [
  'Every enrollment you can see is revenue you can count on.',
  "Credentialing shouldn't be a black box. See every application, every status, every day.",
  'The fastest path from credentialed to paid, with nothing hidden along the way.',
  'Trust is built in the open. We track every step so your revenue never waits on a mystery.',
] as const;

export default function LoginPrototype() {
  const [searchParams] = useSearchParams();
  const initialQuote = Math.min(
    Math.max(parseInt(searchParams.get('quote') ?? '3', 10) || 3, 1),
    QUOTES.length,
  );
  const [screen, setScreen] = useState<Screen>('signin');
  const [verified, setVerified] = useState(false);
  const [quoteIdx, setQuoteIdx] = useState(initialQuote - 1);
  const [leavingTo, setLeavingTo] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();
  const navigate = useNavigate();

  // Warm the lazy-loaded registration pages while the user reads this screen,
  // so Register here / Sign up your practice open without a blank flash.
  useEffect(() => {
    void import('../portal/RegisterPage');
    void import('../practice/PracticeSignupPage');
  }, []);

  const go = (s: Screen) => {
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

  return (
    <div
      className="relative flex min-h-screen flex-col overflow-hidden bg-[#faf7f2] text-[#1f2721]"
      style={{ fontFamily: POPPINS, ...WALLPAPER_STYLE }}
    >
      {/* Leave wash: fades to the destination pages' identical background
          before navigating so the cut is invisible */}
      <motion.div
        className="pointer-events-none fixed inset-0 z-50 bg-[#faf7f2]"
        initial={{ opacity: 0 }}
        animate={{ opacity: leavingTo ? 1 : 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        onAnimationComplete={() => {
          if (leavingTo) navigate(leavingTo);
        }}
      />

      {/* Prototype controls */}
      <div className="relative z-10 mt-6 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-2 px-4">
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
                screen === s ? 'bg-[#0A3D2E] text-white' : 'text-[#6b665c] hover:text-[#1f2721]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#a49d8f]">
            Quote
          </span>
          <div className="flex rounded-full border border-[#e7e1d6] bg-white p-1 shadow-sm">
            {QUOTES.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-pressed={quoteIdx === i}
                onClick={() => setQuoteIdx(i)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2d8b6a] ${
                  quoteIdx === i ? 'bg-[#0A3D2E] text-white' : 'text-[#6b665c] hover:text-[#1f2721]'
                }`}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </div>
      </div>

      <header className="relative z-10 w-full px-5 pt-6 sm:px-8">
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
          {/* Brand statement: the thesis quote, LangSmith-style */}
          <div className="text-center lg:text-left">
            <p className="mx-auto max-w-xl text-2xl font-semibold leading-snug text-[#171b17] sm:text-3xl lg:mx-0 lg:text-4xl lg:leading-tight">
              &ldquo;{QUOTES[quoteIdx]}&rdquo;
            </p>
          </div>

          <div className="mx-auto w-full max-w-md">
            <div className="rounded-[28px] border border-[#f0eadd] bg-white px-6 py-10 shadow-[0_24px_70px_-30px_rgba(23,27,23,0.18)] sm:px-10">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={verified ? 'done' : screen}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{
                    duration: reduceMotion ? 0 : 0.2,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                >
                  {verified ? (
                    <SignedInState
                      onReset={() => {
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
                        setVerified(true);
                      }}
                    />
                  ) : (
                    <ResetScreen onDone={() => go('signin')} />
                  )}
                </motion.div>
              </AnimatePresence>
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
    <div>
      <h1 className="text-center text-2xl font-semibold text-[#171b17]">
        Welcome to Lanyard
      </h1>
      <p className="mt-2 text-center text-sm leading-6 text-[#6b665c]">
        We're glad you're here.
      </p>

      <form
        className="mt-7 space-y-3"
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

      <div className="mt-6 space-y-1.5 text-center text-xs text-[#75705f]">
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
    <div>
      <h1 className="text-center text-2xl font-semibold text-[#171b17]">
        Check your email
      </h1>
      <p className="mt-2 text-center text-sm leading-6 text-[#6b665c]">
        We sent a 6-digit code to{' '}
        <span className="font-semibold text-[#1f2721]">{MOCK_EMAIL}</span>.
      </p>

      <div className="mt-7">
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
        className={`mt-7 ${PRIMARY_BUTTON_CLASSES}`}
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
    <div>
      <h1 className="text-center text-2xl font-semibold text-[#171b17]">
        Reset your password
      </h1>
      <p className="mt-2 text-center text-sm leading-6 text-[#6b665c]">
        Enter the code we emailed to{' '}
        <span className="font-semibold text-[#1f2721]">{MOCK_EMAIL}</span> and pick a
        new password.
      </p>

      <div className="mt-7">
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
      <button type="button" onClick={onReset} className={`mt-7 ${PRIMARY_BUTTON_CLASSES}`}>
        Start over
      </button>
    </div>
  );
}
