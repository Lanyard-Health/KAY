import { useEffect, useRef, useState } from 'react';
import { EyeIcon, EyeSlashIcon, ClipboardIcon, CheckIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import clsx from 'clsx';

interface RevealableSecretProps {
  /** The masked placeholder shown by default, e.g. "****4563". */
  masked: string | null | undefined;
  /** Fetches the full plaintext value. Triggers a server-side audit log. */
  reveal: () => Promise<string>;
  /** Human label used in toasts / aria (e.g. "DEA number"). */
  label: string;
  className?: string;
  /** Auto re-hide the revealed value after this many ms (default 30s). */
  hideAfterMs?: number;
}

/**
 * Shows a sensitive value masked by default with a deliberate "reveal" action.
 * Revealing fetches the full value from a dedicated endpoint that records an
 * audit-log entry (who viewed which field, when) — so the UI tells the user the
 * view is logged. The plaintext is held only in local state, never cached, and
 * auto-hides after a short delay.
 */
export default function RevealableSecret({
  masked,
  reveal,
  label,
  className,
  hideAfterMs = 30000,
}: RevealableSecretProps) {
  const [value, setValue] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHideTimer = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
  };

  // Clear the plaintext from memory on unmount.
  useEffect(() => () => clearHideTimer(), []);

  const handleReveal = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const full = await reveal();
      setValue(full);
      clearHideTimer();
      hideTimer.current = setTimeout(() => setValue(null), hideAfterMs);
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || `Could not reveal ${label}`);
    } finally {
      setLoading(false);
    }
  };

  const handleHide = () => {
    clearHideTimer();
    setValue(null);
    setCopied(false);
  };

  const handleCopy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(`${label} copied`);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Copy failed');
    }
  };

  if (value !== null) {
    return (
      <span className={clsx('inline-flex items-center gap-1.5', className)}>
        <span className="font-mono">{value}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="p-0.5 rounded text-gray-400 hover:text-primary-600"
          aria-label={`Copy ${label}`}
          title={`Copy ${label}`}
        >
          {copied ? <CheckIcon className="h-3.5 w-3.5 text-green-600" /> : <ClipboardIcon className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={handleHide}
          className="p-0.5 rounded text-gray-400 hover:text-gray-700"
          aria-label={`Hide ${label}`}
          title={`Hide ${label}`}
        >
          <EyeSlashIcon className="h-3.5 w-3.5" />
        </button>
        <span className="text-[10px] text-gray-400" title="This view is recorded in the audit log">· logged</span>
      </span>
    );
  }

  return (
    <span className={clsx('inline-flex items-center gap-1.5', className)}>
      <span className="font-mono tracking-wider">{masked || '••••'}</span>
      <button
        type="button"
        onClick={handleReveal}
        disabled={loading}
        className="p-0.5 rounded text-gray-400 hover:text-primary-600 disabled:opacity-50"
        aria-label={`Reveal ${label} (logged)`}
        title={`Reveal ${label} (this view is logged)`}
      >
        <EyeIcon className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}
