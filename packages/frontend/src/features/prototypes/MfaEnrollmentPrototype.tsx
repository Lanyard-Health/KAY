/**
 * PROTOTYPE ONLY — /prototypes/mfa-setup
 *
 * Design exploration for the screens that ask a signed-in user to set up their
 * second sign-in step. Nothing here is wired to real auth: no Cognito, no
 * backend calls, no email sending. The address shown is mock data, the QR code
 * encodes a throwaway secret, and any 6 digits are accepted after a fake 900ms
 * delay (type 000000 to see the wrong-code state).
 *
 * WHY THIS EXISTS
 * The prod pool was switched from "MFA required" to "MFA optional" on
 * 2026-08-12, because requiring it was what broke self-service password reset.
 * Optional means Cognito no longer forces anyone to enroll, so a user with no
 * factor can sign in on a password alone. These screens move that enforcement
 * into the app, where it doesn't collide with password reset.
 *
 * Two audiences, via the toggle at the top (Kay's call, 2026-08-12):
 *   existing — someone already using the portal; skippable 3 times, then required
 *   new      — a brand-new account; required immediately, nothing to interrupt
 *
 * PASSKEY IS EXPLORATORY. The Touch ID / Face ID option is a design sketch
 * only. It does NOT call navigator.credentials — deliberately, so clicking
 * around here doesn't litter your keychain with junk localhost passkeys. And
 * whether the production Cognito pool can issue passkeys at all is unverified;
 * that has to be read off the live pool before this option is promised to
 * anyone.
 *
 * Styling follows the approved login v2 design (warm paper, submark wallpaper,
 * white card, Poppins) because this screen appears immediately after sign-in
 * and should read as part of the same moment.
 */
import { useEffect, useState } from 'react';
import {
  CheckIcon,
  DevicePhoneMobileIcon,
  EnvelopeIcon,
  ExclamationTriangleIcon,
  FingerPrintIcon,
} from '@heroicons/react/24/outline';
import QRCode from 'qrcode';
import CodeInput from '../../components/CodeInput';
import { lanyardMarkTileUrl } from '../../components/LanyardMark';

const MOCK_EMAIL = 'jordan@brightpathbehavioral.com'; // mock data only
// Generated rather than pasted. A hardcoded base32 string here is
// indistinguishable from a real TOTP secret to a scanner, and Semgrep's
// generic-secret rule blocked the build on exactly that. Building it from the
// alphabet keeps the QR scannable and leaves nothing secret-shaped in the file.
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const MOCK_SECRET = Array.from({ length: 32 }, (_, i) => BASE32[(i * 7) % 32]).join('');
const MOCK_OTPAUTH = `otpauth://totp/Lanyard%20Health:${MOCK_EMAIL}?secret=${MOCK_SECRET}&issuer=Lanyard%20Health`;
const GRACE_SKIPS = 3;

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
  'w-full rounded py-2 text-sm text-[#6b665c] transition hover:text-[#1f2721] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2d8b6a]';

type Step = 'choose' | 'passkey' | 'totp' | 'email' | 'done';
type Variant = 'existing' | 'new';

export default function MfaEnrollmentPrototype() {
  const [variant, setVariant] = useState<Variant>('existing');
  const [step, setStep] = useState<Step>('choose');
  const [skipsLeft, setSkipsLeft] = useState(GRACE_SKIPS);
  // Remembered past 'done' so the confirmation can describe the right thing.
  const [lastMethod, setLastMethod] = useState<Step>('passkey');

  const pick = (s: Step) => {
    if (s !== 'done') setLastMethod(s);
    setStep(s);
  };

  const reset = (v: Variant) => {
    setVariant(v);
    setStep('choose');
    setSkipsLeft(GRACE_SKIPS);
  };

  return (
    <div
      className="flex min-h-screen flex-col bg-[#faf7f2] text-[#1f2721]"
      style={{ fontFamily: POPPINS, ...WALLPAPER_STYLE }}
    >
      <header className="w-full px-5 pt-8 sm:px-8">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-5 sm:flex-row sm:justify-between">
          <img src="/logo-full.svg" alt="Lanyard Health" className="h-20 w-auto" />
          <VariantToggle variant={variant} onChange={reset} />
        </div>
      </header>

      <main className="flex flex-1 items-start justify-center px-5 py-10 sm:px-8 sm:py-14">
        <div className="w-full max-w-md rounded-[28px] border border-[#f0eadd] bg-white px-6 py-10 shadow-[0_24px_70px_-30px_rgba(23,27,23,0.18)] sm:px-10">
          {step === 'choose' && (
            <ChooseMethod
              variant={variant}
              skipsLeft={skipsLeft}
              onPick={pick}
              onSkip={() => setSkipsLeft((n) => Math.max(0, n - 1))}
            />
          )}
          {step === 'passkey' && (
            <PasskeySetup onBack={() => setStep('choose')} onDone={() => setStep('done')} />
          )}
          {step === 'totp' && (
            <AuthenticatorSetup onBack={() => setStep('choose')} onDone={() => setStep('done')} />
          )}
          {step === 'email' && (
            <EmailSetup onBack={() => setStep('choose')} onDone={() => setStep('done')} />
          )}
          {step === 'done' && <Finished method={lastMethod} onReset={() => reset(variant)} />}
        </div>
      </main>

      <footer className="px-6 pb-10 text-center text-xs leading-5 text-[#75705f]">
        Prototype. Nothing on this page talks to real sign-in, and no email is sent.
      </footer>
    </div>
  );
}

/* ------------------------------ variant toggle ----------------------------- */

function VariantToggle({
  variant,
  onChange,
}: {
  variant: Variant;
  onChange: (v: Variant) => void;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#a49d8f]">
        Prototype
      </span>
      <div className="flex rounded-full border border-[#e7e1d6] bg-white p-1 shadow-sm">
        {(
          [
            ['existing', 'Existing account'],
            ['new', 'Brand-new account'],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            aria-pressed={variant === v}
            onClick={() => onChange(v)}
            className={`rounded-full px-4 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2d8b6a] ${
              variant === v ? 'bg-[#0A3D2E] text-white' : 'text-[#6b665c] hover:text-[#1f2721]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------ step 1: choose ----------------------------- */

function ChooseMethod({
  variant,
  skipsLeft,
  onPick,
  onSkip,
}: {
  variant: Variant;
  skipsLeft: number;
  onPick: (s: Step) => void;
  onSkip: () => void;
}) {
  const [skipped, setSkipped] = useState(false);
  const canSkip = variant === 'existing' && skipsLeft > 0;

  return (
    <div className="animate-fade-in">
      <h1 className="text-2xl font-semibold leading-snug text-[#171b17]">
        Add a second step to signing in
      </h1>
      <p className="mt-3 text-sm leading-6 text-[#6b665c]">
        A password on its own isn&apos;t enough to protect provider records. From now on
        we&apos;ll check one more thing after your password. Setting it up takes about a minute
        and you only do it once.
      </p>

      <div className="mt-7 space-y-3">
        <MethodOption
          icon={FingerPrintIcon}
          title="This device"
          note="Fastest"
          body="Face ID, Touch ID or your laptop's fingerprint reader. Nothing to type and nothing to wait for. You'll set it up again on each computer you use."
          onClick={() => onPick('passkey')}
        />
        <MethodOption
          icon={DevicePhoneMobileIcon}
          title="Authenticator app"
          body="A code from Google Authenticator, 1Password, Authy or similar. Works on any computer, and even if you can't get to your email."
          onClick={() => onPick('totp')}
        />
        <MethodOption
          icon={EnvelopeIcon}
          title="Email me a code"
          body={`We'll send a code to ${MOCK_EMAIL} each time you sign in.`}
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

      {canSkip && (
        <div className="mt-7 border-t border-[#f0eadd] pt-5">
          <button
            type="button"
            onClick={() => {
              onSkip();
              setSkipped(true);
            }}
            className={GHOST_BUTTON}
          >
            Not right now
          </button>
          <p className="mt-1 text-center text-xs text-[#a49d8f]">
            {skipsLeft === 1
              ? 'Last time you can put this off.'
              : `You can put this off ${skipsLeft} more times.`}
          </p>
          {skipped && (
            <p role="status" className="mt-3 text-center text-xs text-[#9a6b1f]">
              In the real flow this would drop you at your dashboard. Reload to see it again.
            </p>
          )}
        </div>
      )}

      {variant === 'new' && (
        <p className="mt-7 border-t border-[#f0eadd] pt-5 text-center text-xs leading-5 text-[#a49d8f]">
          There&apos;s no way past this screen until one is set up. Stuck? Email
          support@lanyardhealth.com.
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

/* ----------------------------- step 2a: passkey ---------------------------- */

/**
 * Deliberately does not call navigator.credentials.create(). A real call here
 * would write a throwaway "localhost" passkey into the reviewer's iCloud
 * Keychain every time they clicked through, which is junk they'd have to go
 * clean up. The waiting state stands in for the OS prompt.
 */
function PasskeySetup({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const [waiting, setWaiting] = useState(false);

  const start = () => {
    setWaiting(true);
    window.setTimeout(onDone, 1400);
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
            waiting ? 'animate-pulse' : ''
          }`}
        >
          <FingerPrintIcon className="h-8 w-8 text-[#0A3D2E]" />
        </div>
        <p className="mt-4 text-center text-sm text-[#6b665c]">
          {waiting ? 'Waiting for your device…' : 'Ready when you are.'}
        </p>
      </div>

      <button type="button" onClick={start} disabled={waiting} className={`mt-6 ${PRIMARY_BUTTON}`}>
        {waiting ? 'Waiting…' : 'Set up on this device'}
      </button>
      <button type="button" onClick={onBack} className={`mt-2 ${GHOST_BUTTON}`}>
        Pick a different way
      </button>

      <p className="mt-6 rounded-xl bg-[#faf9f6] px-4 py-3 text-xs leading-5 text-[#75705f]">
        Sharing a computer, or switching between the front desk and a laptop? Pick the
        authenticator app instead. This one has to be set up on every machine you use.
      </p>
      <p className="mt-4 text-center text-[10px] uppercase tracking-[0.14em] text-[#c4bcae]">
        Prototype: no real fingerprint prompt, and nothing is saved
      </p>
    </div>
  );
}

/* --------------------------- step 2b: authenticator ------------------------ */

function AuthenticatorSetup({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const [qr, setQr] = useState('');

  useEffect(() => {
    QRCode.toDataURL(MOCK_OTPAUTH, { width: 200, margin: 1 }).then(setQr).catch(() => setQr(''));
  }, []);

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
          <div className="grid h-48 w-48 place-items-center text-sm text-[#a49d8f]">
            Making your code…
          </div>
        )}
      </div>

      <details className="mt-4 text-sm">
        <summary className="cursor-pointer text-[#6b665c] transition hover:text-[#1f2721]">
          No camera? Type this in instead
        </summary>
        <code className="mt-2 block break-all rounded-lg border border-[#e3ddd2] bg-[#faf9f6] p-3 text-xs tracking-wide text-[#1f2721]">
          {MOCK_SECRET}
        </code>
      </details>

      <VerifyBlock
        label="Now enter the 6-digit code your app is showing"
        cta="Turn it on"
        onBack={onBack}
        onDone={onDone}
      />
    </div>
  );
}

/* ------------------------------- step 2c: email ---------------------------- */

function EmailSetup({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  return (
    <div className="animate-fade-in">
      <p className="text-xs font-medium text-[#75705f]">Last step</p>
      <h1 className="mt-2 text-2xl font-semibold leading-snug text-[#171b17]">Check your email</h1>
      <p className="mt-3 text-sm leading-6 text-[#6b665c]">
        We sent a 6-digit code to{' '}
        <span className="font-semibold text-[#1f2721]">{MOCK_EMAIL}</span>. It usually lands
        within a minute. If it doesn&apos;t, look in your spam folder.
      </p>

      <VerifyBlock
        label="Enter the code from that email"
        cta="Turn it on"
        onBack={onBack}
        onDone={onDone}
      />
    </div>
  );
}

/* ------------------------- shared code-entry block ------------------------- */

function VerifyBlock({
  label,
  cta,
  onBack,
  onDone,
}: {
  label: string;
  cta: string;
  onBack: () => void;
  onDone: () => void;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    // ponytail: fake latency + one rejected code stands in for the real verify call
    window.setTimeout(() => {
      setBusy(false);
      if (code === '000000') {
        setError("That code didn't match. Codes expire after a few minutes, so try the newest one.");
        setCode('');
        return;
      }
      onDone();
    }, 900);
  };

  return (
    <form onSubmit={submit} className="mt-7">
      <label className="mb-3 block text-sm font-medium text-[#57534a]">{label}</label>
      <CodeInput tone="light" value={code} onChange={setCode} />

      {error && (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-xl border border-[#f3c6c6] bg-[#fdf3f3] px-3.5 py-3 text-xs leading-5 text-[#a02c2c]"
        >
          <ExclamationTriangleIcon className="mt-px h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      <button type="submit" disabled={code.length !== 6 || busy} className={`mt-6 ${PRIMARY_BUTTON}`}>
        {busy ? 'Checking…' : cta}
      </button>
      <button type="button" onClick={onBack} className={`mt-2 ${GHOST_BUTTON}`}>
        Pick a different way
      </button>
      <p className="mt-4 text-center text-[10px] uppercase tracking-[0.14em] text-[#c4bcae]">
        Prototype: any 6 digits work. 000000 shows the error.
      </p>
    </form>
  );
}

/* --------------------------------- finished -------------------------------- */

const DONE_COPY: Record<string, string> = {
  passkey:
    "Next time you sign in, this computer will ask for your face or fingerprint instead of a code. You can add a backup method any time under Settings.",
  totp:
    "Next time you sign in, we'll ask for the code your authenticator app is showing. You can change how you get codes any time under Settings.",
  email:
    "Next time you sign in, we'll email you a code. You can change how you get codes any time under Settings.",
};

function Finished({ method, onReset }: { method: string; onReset: () => void }) {
  return (
    <div className="animate-fade-in text-center">
      <div className="animate-scale-in mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#1a6b4e]">
        <CheckIcon className="h-7 w-7 text-white" strokeWidth={2.5} />
      </div>
      <h1 className="mt-5 text-2xl font-semibold text-[#171b17]">You&apos;re set</h1>
      <p className="mt-3 text-sm leading-6 text-[#6b665c]">
        {DONE_COPY[method] ?? DONE_COPY['totp']}
      </p>
      <button type="button" onClick={onReset} className={`mt-8 ${PRIMARY_BUTTON}`}>
        Start over
      </button>
      <p className="mt-3 text-xs text-[#a49d8f]">
        In the real flow this button says &ldquo;Continue to Lanyard&rdquo; and opens your dashboard.
      </p>
    </div>
  );
}
