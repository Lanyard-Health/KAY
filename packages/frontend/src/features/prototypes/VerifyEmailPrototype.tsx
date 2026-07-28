/**
 * PROTOTYPE ONLY — /prototypes/verify-email
 *
 * Design exploration for an email verification screen (layout modeled on a
 * split-panel reference). Nothing here is wired to real auth: no Cognito, no
 * backend calls, no email sending. The address shown is mock data, "Confirm
 * email" accepts any 6 digits after a fake 900ms delay, and "Simulate link
 * clicked" stands in for the real magic-link email.
 *
 * Flip variants with the toggle at the top of the page (6-digit code vs
 * magic link) — live state switch, no reload.
 *
 * PROVISIONAL STYLING — brand identity work is still in progress; these
 * values will likely change:
 *   - Poppins typeface (page-scoped Google Fonts load, rest of app stays Inter)
 *   - warm paper background #faf7f2 instead of stark white
 *   - placeholder gradient + ghost rings on the dark brand panel
 */
import { useEffect, useState } from 'react';
import { CheckIcon, ClipboardIcon, EnvelopeIcon } from '@heroicons/react/24/outline';
import CodeInput from '../../components/CodeInput';

const MOCK_EMAIL = 'jordan@brightpathbehavioral.com'; // mock data only

const POPPINS =
  "'Poppins', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

type Variant = 'code' | 'magic';

export default function VerifyEmailPrototype() {
  const [variant, setVariant] = useState<Variant>('code');
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

  const switchTo = (v: Variant) => {
    setVariant(v);
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
          {/* Wordmark placeholder — real logo lands with the brand work */}
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-[#0A3D2E] text-sm font-semibold text-white">
              L
            </div>
            <span className="text-sm font-semibold tracking-tight">lanyard</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-full border border-[#e7e1d6] bg-white px-3.5 py-1.5 text-xs text-[#6b665c] shadow-sm">
            You are signing into
            <span className="font-semibold text-[#1f2721]">Lanyard</span>
          </div>
        </header>

        {/* Prototype variant toggle */}
        <div className="mt-8 flex items-center justify-center gap-2.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#a49d8f]">
            Prototype
          </span>
          <div className="flex rounded-full border border-[#e7e1d6] bg-white p-1 shadow-sm">
            {(
              [
                ['code', '6-digit code'],
                ['magic', 'Magic link'],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                aria-pressed={variant === v}
                onClick={() => switchTo(v)}
                className={`rounded-full px-4 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2d8b6a] ${
                  variant === v
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
              <VerifiedState onReset={() => setVerified(false)} />
            ) : variant === 'code' ? (
              <CodeVariant onVerified={() => setVerified(true)} />
            ) : (
              <MagicLinkVariant onVerified={() => setVerified(true)} />
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

      {/* Right: dark brand panel (placeholder art, hidden on mobile) */}
      <div
        className="relative hidden overflow-hidden lg:block lg:w-1/2"
        aria-hidden="true"
        style={{
          background: 'linear-gradient(150deg, #040f0b 0%, #0A3D2E 62%, #1a6b4e 105%)',
        }}
      >
        {/* soft light bleed along the outer edge */}
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

/* ------------------------------ code variant ------------------------------ */

function CodeVariant({ onVerified }: { onVerified: () => void }) {
  // Uses the shared production CodeInput (light tone), so this page doubles
  // as a live visual testbed for the exact component shipped in LoginPage.
  const [code, setCode] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [pasteNote, setPasteNote] = useState('');
  const complete = code.length === 6;

  /** Fill all boxes from any text containing 6 consecutive digits. */
  const fillFrom = (text: string): boolean => {
    const match = text.match(/\d{6}/);
    if (!match) return false;
    setCode(match[0]);
    setPasteNote('');
    return true;
  };

  // Clipboard API is permission-gated; fall back to a plain-English hint.
  // Raced against a timeout because some browsers leave readText() pending
  // forever instead of rejecting when the permission prompt stalls.
  const pasteFromClipboard = async () => {
    try {
      const text = await Promise.race([
        navigator.clipboard.readText(),
        new Promise<never>((_, reject) =>
          window.setTimeout(() => reject(new Error('clipboard timeout')), 2000),
        ),
      ]);
      if (!fillFrom(text)) setPasteNote('No 6-digit code found on your clipboard.');
    } catch {
      setPasteNote('Clipboard is blocked here. Press Cmd+V (or Ctrl+V) in the boxes instead.');
    }
  };

  const confirm = () => {
    setConfirming(true);
    // ponytail: fake latency stands in for the real Cognito confirm call
    window.setTimeout(onVerified, 900);
  };

  return (
    <div className="animate-fade-in">
      <h1 className="text-center text-2xl font-semibold text-[#171b17]">
        Verify your email
      </h1>
      <p className="mt-3 text-center text-sm leading-6 text-[#6b665c]">
        We emailed a 6-digit code to{' '}
        <span className="font-semibold text-[#1f2721]">{MOCK_EMAIL}</span>. It
        usually arrives within a minute. If you don't see it, check your spam
        folder.
      </p>

      <div className="mt-8">
        <CodeInput tone="light" value={code} onChange={setCode} autoFocus />
      </div>

      <div className="mt-4 text-center">
        <button
          type="button"
          onClick={pasteFromClipboard}
          className="inline-flex items-center gap-1.5 rounded-full border border-[#e7e1d6] bg-white px-3.5 py-1.5 text-xs font-medium text-[#57534a] shadow-sm transition hover:bg-[#f3eee5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2d8b6a]"
        >
          <ClipboardIcon className="h-3.5 w-3.5" />
          Paste code
        </button>
        {pasteNote && (
          <p role="status" className="mt-2 text-xs text-[#9a6b1f]">
            {pasteNote}
          </p>
        )}
      </div>

      <button
        type="button"
        disabled={!complete || confirming}
        onClick={confirm}
        className="mt-8 h-12 w-full rounded-full bg-[#0A3D2E] text-sm font-medium text-white shadow-sm transition hover:bg-[#082f23] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2d8b6a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#faf7f2]"
      >
        {confirming ? 'Confirming…' : 'Confirm email'}
      </button>
      <button
        type="button"
        onClick={() => {
          setCode('');
          setPasteNote('');
        }}
        className="mt-3 h-12 w-full rounded-full border border-[#e3ddd2] bg-white text-sm font-medium text-[#3f3a33] shadow-sm transition hover:bg-[#f3eee5] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2d8b6a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#faf7f2]"
      >
        Go back
      </button>
    </div>
  );
}

/* --------------------------- magic-link variant --------------------------- */

const RESEND_SECONDS = 30;

function MagicLinkVariant({ onVerified }: { onVerified: () => void }) {
  const [seconds, setSeconds] = useState(RESEND_SECONDS);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    if (seconds <= 0) return;
    const t = window.setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [seconds]);

  return (
    <div className="animate-fade-in text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#d6f0e4]">
        <EnvelopeIcon className="h-7 w-7 text-[#1a6b4e]" />
      </div>
      <h1 className="mt-5 text-2xl font-semibold text-[#171b17]">Check your inbox</h1>
      <p className="mt-3 text-sm leading-6 text-[#6b665c]">
        We sent a sign-in link to{' '}
        <span className="font-semibold text-[#1f2721]">{MOCK_EMAIL}</span>.
        Open it on this device and you'll be signed in automatically.
      </p>

      <button
        type="button"
        disabled={seconds > 0}
        onClick={() => {
          setSeconds(RESEND_SECONDS);
          setResent(true);
        }}
        className="mt-8 h-12 w-full rounded-full border border-[#e3ddd2] bg-white text-sm font-medium text-[#3f3a33] shadow-sm transition hover:bg-[#f3eee5] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2d8b6a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#faf7f2]"
      >
        {seconds > 0 ? `Resend link in 0:${String(seconds).padStart(2, '0')}` : 'Resend link'}
      </button>
      {resent && seconds === RESEND_SECONDS && (
        <p role="status" className="mt-2 text-xs text-[#1a6b4e]">
          Link sent again (mock: no email actually goes out).
        </p>
      )}

      {/* Demo-only control: stands in for clicking the link in the email */}
      <div className="mt-10 border-t border-dashed border-[#d9d2c4] pt-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#a49d8f]">
          Demo only
        </p>
        <button
          type="button"
          onClick={onVerified}
          className="mt-3 h-10 w-full rounded-full border border-dashed border-[#b0c9bc] bg-[#f0faf6] text-xs font-medium text-[#1a6b4e] transition hover:bg-[#d6f0e4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2d8b6a]"
        >
          Simulate link clicked
        </button>
      </div>
    </div>
  );
}

/* ------------------------------ success state ----------------------------- */

function VerifiedState({ onReset }: { onReset: () => void }) {
  return (
    <div className="animate-fade-in text-center">
      <div className="animate-scale-in mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#1a6b4e]">
        <CheckIcon className="h-7 w-7 text-white" strokeWidth={2.5} />
      </div>
      <h1 className="mt-5 text-2xl font-semibold text-[#171b17]">Email verified</h1>
      <p className="mt-3 text-sm leading-6 text-[#6b665c]">
        You're all set. In the real flow this would continue into the portal;
        this prototype stops here.
      </p>
      <button
        type="button"
        onClick={onReset}
        className="mt-8 h-12 w-full rounded-full bg-[#0A3D2E] text-sm font-medium text-white shadow-sm transition hover:bg-[#082f23] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2d8b6a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#faf7f2]"
      >
        Start over
      </button>
    </div>
  );
}
