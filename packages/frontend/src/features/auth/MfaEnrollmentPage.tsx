/**
 * Second-factor enrollment. Design approved by Kay 2026-08-12; the clickable
 * reference is at /prototypes/mfa-setup.
 *
 * WHY THIS SCREEN EXISTS
 * The production pool's `MfaConfiguration` went `ON` -> `OPTIONAL` on
 * 2026-08-12, because requiring MFA is what broke self-service password reset.
 * Cognito therefore no longer forces anyone to register a factor, and this
 * screen is what replaces that enforcement. It is only the polite half: the
 * real gate is `mfaEnrollmentGate` on the backend, which refuses the API to an
 * un-enrolled user whether or not they ever load this page.
 *
 * ONE DELIBERATE DEPARTURE FROM THE PROTOTYPE
 * The mockup's email path asked for a 6-digit code. Cognito does not send one
 * at enrollment time — turning email on is a preference change, and the first
 * code arrives at the next sign-in. Rather than fake a code round trip, the
 * email path confirms and finishes. Same number of clicks, one less thing that
 * can go wrong.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeftIcon,
  CheckIcon,
  DevicePhoneMobileIcon,
  EnvelopeIcon,
  ExclamationTriangleIcon,
  FingerPrintIcon,
} from '@heroicons/react/24/outline';
import QRCode from 'qrcode';
import CodeInput from '../../components/CodeInput';
import { lanyardMarkTileUrl } from '../../components/LanyardMark';
import { api } from '../../services/api';
import { useAuthStore } from '../../stores/auth.store';
import { mapCognitoError } from '../../utils/cognito-errors';

const POPPINS =
  "'Poppins', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

const MARK_TILE = lanyardMarkTileUrl('#f4efe6');
const WALLPAPER_STYLE = {
  backgroundImage: `url("${MARK_TILE}"), url("${MARK_TILE}")`,
  backgroundSize: '260px 199px, 260px 199px',
  backgroundPosition: '0 0, 130px 99px',
};

const PRIMARY_BUTTON =
  'h-12 w-full rounded-full bg-[#0A3D2E] text-sm font-medium text-white shadow-sm transition hover:bg-[#082f23] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2d8b6a] focus-visible:ring-offset-2 focus-visible:ring-offset-white';
const GHOST_BUTTON =
  'w-full rounded py-2 text-sm text-[#6b665c] transition hover:text-[#1f2721] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2d8b6a] disabled:opacity-40';

/**
 * Shown for anything mapCognitoError does not recognise. These screens fail on
 * infrastructure far more often than on user input, and the raw SDK string
 * ("Auth UserPool not configured.") means nothing to a practice manager.
 */
const SETUP_FALLBACK =
  'Something went wrong setting this up. Please try again, or email support@lanyardhealth.com.';

type Step = 'loading' | 'choose' | 'passkey' | 'totp' | 'email' | 'done';
type Method = 'passkey' | 'totp' | 'email';

interface MfaStatus {
  enrolled: boolean;
  methods: string[];
  skipsRemaining: number;
  canSkip: boolean;
}

export default function MfaEnrollmentPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [step, setStep] = useState<Step>('loading');
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [method, setMethod] = useState<Method>('totp');
  const [loadError, setLoadError] = useState('');

  const home = user?.role === 'provider' ? '/portal' : '/';

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ data: MfaStatus }>('/auth/mfa/status')
      .then(({ data }) => {
        if (cancelled) return;
        // Already protected — nothing to do here, don't make them look at it.
        if (data.data.enrolled) {
          navigate(home, { replace: true });
          return;
        }
        setStatus(data.data);
        setStep('choose');
      })
      .catch(() => {
        if (cancelled) return;
        // Showing the setup screen on an unreadable status is the safe failure:
        // the worst case is asking someone to set up a factor they already have,
        // which Cognito will simply accept.
        setLoadError('We could not check your account settings. You can still set this up below.');
        setStatus({ enrolled: false, methods: [], skipsRemaining: 0, canSkip: false });
        setStep('choose');
      });
    return () => {
      cancelled = true;
    };
  }, [navigate, home]);

  const finish = useCallback(
    async (used: Method) => {
      setMethod(used);
      // Tells the backend to drop its cached "no factor" answer. It re-verifies
      // against Cognito before believing us, so a failure here is not fatal —
      // the cache entry expires on its own within a minute.
      try {
        await api.post('/auth/mfa/enrolled', {});
      } catch {
        /* status will re-resolve on its own */
      }
      setStep('done');
    },
    [],
  );

  const skip = async () => {
    try {
      await api.post('/auth/mfa/skip', {});
      navigate(home, { replace: true });
    } catch {
      // Out of skips: the backend is the authority, so re-read and let the
      // screen re-render without a way out.
      setStatus((s) => (s ? { ...s, canSkip: false, skipsRemaining: 0 } : s));
    }
  };

  return (
    <div
      className="flex min-h-screen flex-col bg-[#faf7f2] text-[#1f2721]"
      style={{ fontFamily: POPPINS, ...WALLPAPER_STYLE }}
    >
      <header className="w-full px-5 pt-8 sm:px-8">
        <div className="mx-auto w-full max-w-5xl">
          <img src="/logo-full.svg" alt="Lanyard Health" className="mx-auto h-20 w-auto sm:mx-0" />
        </div>
      </header>

      <main className="flex flex-1 items-start justify-center px-5 py-10 sm:px-8 sm:py-14">
        <div className="w-full max-w-md rounded-[28px] border border-[#f0eadd] bg-white px-6 py-10 shadow-[0_24px_70px_-30px_rgba(23,27,23,0.18)] sm:px-10">
          {step === 'loading' && <LoadingState />}

          {step === 'choose' && status && (
            <ChooseMethod
              email={user?.email ?? 'your email address'}
              status={status}
              loadError={loadError}
              onPick={setStep}
              onSkip={skip}
            />
          )}

          {step === 'passkey' && (
            <PasskeySetup onBack={() => setStep('choose')} onDone={() => finish('passkey')} />
          )}
          {step === 'totp' && (
            <AuthenticatorSetup
              email={user?.email ?? 'Lanyard'}
              onBack={() => setStep('choose')}
              onDone={() => finish('totp')}
            />
          )}
          {step === 'email' && (
            <EmailSetup
              email={user?.email ?? 'your email address'}
              onBack={() => setStep('choose')}
              onDone={() => finish('email')}
            />
          )}
          {step === 'done' && (
            <Finished method={method} onContinue={() => navigate(home, { replace: true })} />
          )}
        </div>
      </main>

      <footer className="px-6 pb-10 text-center text-xs leading-5 text-[#75705f]">
        Need a hand? Email{' '}
        <a
          href="mailto:support@lanyardhealth.com"
          className="font-medium text-[#1f2721] underline underline-offset-2"
        >
          support@lanyardhealth.com
        </a>
        .
      </footer>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex justify-center py-12" role="status" aria-label="Checking your account">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#e3ddd2] border-t-[#2d8b6a]" />
    </div>
  );
}

/* ------------------------------ step 1: choose ----------------------------- */

function ChooseMethod({
  email,
  status,
  loadError,
  onPick,
  onSkip,
}: {
  email: string;
  status: MfaStatus;
  loadError: string;
  onPick: (s: Step) => void;
  onSkip: () => void;
}) {
  const [skipping, setSkipping] = useState(false);
  // A browser with no WebAuthn support can't offer passkeys at all, and an
  // option that always errors is worse than one that isn't there.
  const passkeyCapable =
    typeof window !== 'undefined' && typeof window.PublicKeyCredential !== 'undefined';

  return (
    <div className="animate-fade-in">
      <h1 className="text-2xl font-semibold leading-snug text-[#171b17]">
        Add a second step to signing in
      </h1>
      <p className="mt-3 text-sm leading-6 text-[#6b665c]">
        A password on its own isn&apos;t enough to protect provider records. From now on we&apos;ll
        check one more thing after your password. Setting it up takes about a minute and you only
        do it once.
      </p>

      {loadError && (
        <p
          role="status"
          className="mt-5 rounded-xl border border-[#f0e0bd] bg-[#fdf8ee] px-3.5 py-3 text-xs leading-5 text-[#9a6b1f]"
        >
          {loadError}
        </p>
      )}

      <div className="mt-7 space-y-3">
        {passkeyCapable && (
          <MethodOption
            icon={FingerPrintIcon}
            title="This device"
            note="Fastest"
            body="Face ID, Touch ID or your laptop's fingerprint reader. Nothing to type and nothing to wait for. You'll set it up again on each computer you use."
            onClick={() => onPick('passkey')}
          />
        )}
        <MethodOption
          icon={DevicePhoneMobileIcon}
          title="Authenticator app"
          body="A code from Google Authenticator, 1Password, Authy or similar. Works on any computer, and even if you can't get to your email."
          onClick={() => onPick('totp')}
        />
        <MethodOption
          icon={EnvelopeIcon}
          title="Email me a code"
          body={`We'll send a code to ${email} each time you sign in.`}
          onClick={() => onPick('email')}
        />
      </div>

      {/* "Authenticator app" is the one term here a non-technical office
          manager meets cold. A <details> answers it for the people who need it
          without taxing everyone else, and needs no modal or second page. */}
      <details className="mt-4 text-sm">
        <summary className="cursor-pointer text-[#6b665c] transition hover:text-[#1f2721]">
          What&apos;s an authenticator app?
        </summary>
        <p className="mt-2 rounded-xl bg-[#faf9f6] px-4 py-3 text-xs leading-5 text-[#6b665c]">
          A free app on your phone that shows a 6-digit code, changing every 30 seconds. You
          install it once, point its camera at a square code we show you, and from then on it
          keeps generating codes even with no signal. Google Authenticator and Microsoft
          Authenticator are both free; if you already use 1Password or Bitwarden, they do this
          too.
        </p>
      </details>

      {status.canSkip ? (
        <div className="mt-7 border-t border-[#f0eadd] pt-5">
          <button
            type="button"
            disabled={skipping}
            onClick={() => {
              setSkipping(true);
              void onSkip();
            }}
            className={GHOST_BUTTON}
          >
            {skipping ? 'One moment…' : 'Not right now'}
          </button>
          <p className="mt-1 text-center text-xs text-[#6b665c]">
            {status.skipsRemaining === 1
              ? 'Last time you can put this off.'
              : `You can put this off ${status.skipsRemaining} more times.`}
          </p>
        </div>
      ) : (
        <p className="mt-7 border-t border-[#f0eadd] pt-5 text-center text-xs leading-5 text-[#6b665c]">
          Setting one of these up is required to keep using Lanyard.
        </p>
      )}
    </div>
  );
}

function MethodOption({
  icon: Icon,
  title,
  note,
  body,
  onClick,
}: {
  icon: typeof EnvelopeIcon;
  title: string;
  note?: string;
  body: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-3.5 rounded-xl border border-[#e3ddd2] bg-white px-4 py-4 text-left shadow-sm transition hover:border-[#b0e0cb] hover:bg-[#f8fcfa] active:scale-[0.995] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2d8b6a]"
    >
      <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#f0faf6]">
        <Icon className="h-5 w-5 text-[#1a6b4e]" />
      </span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-[#1f2721]">{title}</span>
          {note && (
            <span className="rounded-full bg-[#d6f0e4] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#0A3D2E]">
              {note}
            </span>
          )}
        </span>
        <span className="mt-1 block text-xs leading-5 text-[#6b665c]">{body}</span>
      </span>
    </button>
  );
}

function BackLink({ onBack, disabled }: { onBack: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onBack}
      disabled={disabled}
      className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded py-2 text-sm text-[#6b665c] transition hover:text-[#1f2721] disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2d8b6a]"
    >
      <ArrowLeftIcon className="h-4 w-4" />
      Pick a different way
    </button>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="mt-4 flex items-start gap-2 rounded-xl border border-[#f3c6c6] bg-[#fdf3f3] px-3.5 py-3 text-xs leading-5 text-[#a02c2c]"
    >
      <ExclamationTriangleIcon className="mt-px h-4 w-4 shrink-0" />
      {message}
    </p>
  );
}

/* ----------------------------- step 2a: passkey ---------------------------- */

function PasskeySetup({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const { associateWebAuthnCredential } = await import('aws-amplify/auth');
      await associateWebAuthnCredential();
      onDone();
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      // The user closing the OS prompt is a choice, not a failure worth an
      // alarming red box.
      if (name === 'NotAllowedError' || name === 'AbortError') {
        setError('That was cancelled. Try again when you are ready, or pick a different way.');
      } else if (name.startsWith('WebAuthn')) {
        setError(
          'This account cannot use device sign-in yet. Please choose the authenticator app or email instead.',
        );
      } else {
        setError(mapCognitoError(err, 'changePassword', SETUP_FALLBACK));
      }
      setBusy(false);
    }
  };

  return (
    <div className="animate-fade-in">
      <p className="text-xs font-medium text-[#75705f]">Last step</p>
      <h1 className="mt-2 text-2xl font-semibold leading-snug text-[#171b17]">
        Use this device to sign in
      </h1>
      <p className="mt-3 text-sm leading-6 text-[#6b665c]">
        Your computer will ask for your face, fingerprint or screen lock. That&apos;s it: no code
        to read, nothing to type. Lanyard never sees your fingerprint, only that your device
        confirmed it was you.
      </p>

      <div className="mt-7 grid place-items-center rounded-2xl border border-[#e3ddd2] bg-[#faf9f6] px-6 py-10">
        <div
          className={`grid h-16 w-16 place-items-center rounded-full bg-[#d6f0e4] ${
            busy ? 'animate-pulse' : ''
          }`}
        >
          <FingerPrintIcon className="h-8 w-8 text-[#0A3D2E]" />
        </div>
        <p className="mt-4 text-center text-sm text-[#6b665c]">
          {busy ? 'Waiting for your device…' : 'Ready when you are.'}
        </p>
      </div>

      {error && <ErrorNote message={error} />}

      <button type="button" onClick={start} disabled={busy} className={`mt-6 ${PRIMARY_BUTTON}`}>
        {busy ? 'Waiting…' : 'Set up on this device'}
      </button>
      <BackLink onBack={onBack} disabled={busy} />

      <p className="mt-6 rounded-xl bg-[#faf9f6] px-4 py-3 text-xs leading-5 text-[#75705f]">
        Sharing a computer, or switching between the front desk and a laptop? Pick the
        authenticator app instead. This one has to be set up on every machine you use.
      </p>
    </div>
  );
}

/* --------------------------- step 2b: authenticator ------------------------ */

function AuthenticatorSetup({
  email,
  onBack,
  onDone,
}: {
  email: string;
  onBack: () => void;
  onDone: () => void;
}) {
  const [secret, setSecret] = useState('');
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [setupFailed, setSetupFailed] = useState('');
  /**
   * The setup call is kicked off ONCE and its promise parked in a ref, then
   * every mount subscribes to that same promise.
   *
   * Both halves matter. Calling setUpTOTP twice would issue a second secret
   * while the user is mid-scan of the first QR. But guarding with a plain
   * "already started" boolean is not enough either: React 18 StrictMode mounts,
   * unmounts and remounts in development, so the first mount's result gets
   * discarded as stale while the second mount never fires a request of its own,
   * and the screen sits on "Making your code…" forever. That is exactly what
   * happened before this shape.
   */
  const setup = useRef<Promise<{ secret: string; qr: string }> | null>(null);

  useEffect(() => {
    setup.current ??= (async () => {
      const { setUpTOTP } = await import('aws-amplify/auth');
      // Raced against a deadline because setUpTOTP does not always reject —
      // with a stale or missing session it can simply never settle, leaving the
      // user with no idea anything had gone wrong.
      const details = await Promise.race([
        setUpTOTP(),
        new Promise<never>((_, reject) =>
          window.setTimeout(() => reject(new Error('totp setup timeout')), 15000),
        ),
      ]);
      const uri = details.getSetupUri('Lanyard Health', email).toString();
      // Generated in the browser: the shared secret must never be handed to a
      // third-party QR service.
      return {
        secret: details.sharedSecret,
        qr: await QRCode.toDataURL(uri, { width: 200, margin: 1 }),
      };
    })();

    let active = true;
    setup.current
      .then((r) => {
        if (!active) return;
        setSecret(r.secret);
        setQr(r.qr);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setSetupFailed(
          err instanceof Error && err.message === 'totp setup timeout'
            ? 'This is taking longer than it should. Check your connection and try again, or set up a different way.'
            : mapCognitoError(err, 'changePassword', SETUP_FALLBACK),
        );
      });
    return () => {
      active = false;
    };
  }, [email]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { verifyTOTPSetup, updateMFAPreference } = await import('aws-amplify/auth');
      await verifyTOTPSetup({ code });
      // Verifying registers the device; this is what makes Cognito actually ask
      // for it at the next sign-in.
      await updateMFAPreference({ totp: 'PREFERRED' });
      onDone();
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      setError(
        name === 'EnableSoftwareTokenMFAException' || name === 'CodeMismatchException'
          ? "That code didn't match. Codes change every 30 seconds, so try the newest one."
          : mapCognitoError(err, 'changePassword', SETUP_FALLBACK),
      );
      setCode('');
      setBusy(false);
    }
  };

  if (setupFailed) {
    return (
      <div className="animate-fade-in">
        <h1 className="text-2xl font-semibold leading-snug text-[#171b17]">
          We couldn&apos;t start setup
        </h1>
        <ErrorNote message={setupFailed} />
        <BackLink onBack={onBack} />
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <p className="text-xs font-medium text-[#75705f]">Last step</p>
      <h1 className="mt-2 text-2xl font-semibold leading-snug text-[#171b17]">
        Scan this with your authenticator app
      </h1>
      <p className="mt-3 text-sm leading-6 text-[#6b665c]">
        Open Google Authenticator, 1Password, Authy or whichever app you use, add an account, and
        point the camera here. It&apos;ll start showing a 6-digit code that changes every 30
        seconds.
      </p>

      <div className="mt-7 flex justify-center rounded-2xl border border-[#e3ddd2] bg-white p-4 shadow-sm">
        {qr ? (
          <img src={qr} alt="Setup QR code" className="h-48 w-48" />
        ) : (
          <div className="grid h-48 w-48 place-items-center text-sm text-[#6b665c]">
            Making your code…
          </div>
        )}
      </div>

      {secret && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-[#6b665c] transition hover:text-[#1f2721]">
            No camera? Type this in instead
          </summary>
          <code className="mt-2 block break-all rounded-lg border border-[#e3ddd2] bg-[#faf9f6] p-3 text-xs tracking-wide text-[#1f2721]">
            {secret}
          </code>
        </details>
      )}

      <form onSubmit={submit} className="mt-7">
        <label className="mb-3 block text-sm font-medium text-[#57534a]">
          Now enter the 6-digit code your app is showing
        </label>
        <CodeInput tone="light" value={code} onChange={setCode} />
        {error && <ErrorNote message={error} />}
        <button
          type="submit"
          disabled={code.length !== 6 || busy || !qr}
          className={`mt-6 ${PRIMARY_BUTTON}`}
        >
          {busy ? 'Checking…' : 'Turn it on'}
        </button>
        <BackLink onBack={onBack} disabled={busy} />
      </form>
    </div>
  );
}

/* ------------------------------- step 2c: email ---------------------------- */

function EmailSetup({
  email,
  onBack,
  onDone,
}: {
  email: string;
  onBack: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const enable = async () => {
    setBusy(true);
    setError('');
    try {
      const { updateMFAPreference } = await import('aws-amplify/auth');
      await updateMFAPreference({ email: 'PREFERRED' });
      onDone();
    } catch (err) {
      setError(mapCognitoError(err, 'changePassword', SETUP_FALLBACK));
      setBusy(false);
    }
  };

  return (
    <div className="animate-fade-in">
      <p className="text-xs font-medium text-[#75705f]">Last step</p>
      <h1 className="mt-2 text-2xl font-semibold leading-snug text-[#171b17]">
        Send my codes by email
      </h1>
      <p className="mt-3 text-sm leading-6 text-[#6b665c]">
        Every time you sign in, we&apos;ll email a 6-digit code to{' '}
        <span className="font-semibold text-[#1f2721]">{email}</span> and ask you to type it in.
        Nothing to install.
      </p>

      <p className="mt-6 rounded-xl bg-[#faf9f6] px-4 py-3 text-xs leading-5 text-[#75705f]">
        Worth knowing: if you ever lose access to this inbox, you lose the way in. An authenticator
        app keeps working regardless, which is why we suggest it first.
      </p>

      {error && <ErrorNote message={error} />}

      <button type="button" onClick={enable} disabled={busy} className={`mt-6 ${PRIMARY_BUTTON}`}>
        {busy ? 'Turning it on…' : 'Turn it on'}
      </button>
      <BackLink onBack={onBack} disabled={busy} />
    </div>
  );
}

/* --------------------------------- finished -------------------------------- */

const DONE_COPY: Record<Method, string> = {
  passkey:
    'Next time you sign in, this computer will ask for your face or fingerprint instead of a code. You can add a backup method any time under Settings.',
  totp: "Next time you sign in, we'll ask for the code your authenticator app is showing. You can change how you get codes any time under Settings.",
  email:
    "Next time you sign in, we'll email you a code. You can change how you get codes any time under Settings.",
};

function Finished({ method, onContinue }: { method: Method; onContinue: () => void }) {
  return (
    <div className="animate-fade-in text-center">
      <div className="animate-scale-in mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#1a6b4e]">
        <CheckIcon className="h-7 w-7 text-white" strokeWidth={2.5} />
      </div>
      <h1 className="mt-5 text-2xl font-semibold text-[#171b17]">You&apos;re set</h1>
      <p className="mt-3 text-sm leading-6 text-[#6b665c]">{DONE_COPY[method]}</p>
      <button type="button" onClick={onContinue} className={`mt-8 ${PRIMARY_BUTTON}`}>
        Continue to Lanyard
      </button>
    </div>
  );
}
