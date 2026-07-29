import { useEffect, useRef } from 'react';

/**
 * Segmented 6-digit verification code input (3+3 boxes with a divider).
 * Fully controlled: boxes are derived from `value` each render, so a parent
 * clearing its state (e.g. after a failed Cognito challenge) empties all
 * boxes with no extra wiring. Because the value is a flat string, "holes"
 * left-pack (typing in box 3 while box 1 is empty shifts digits left) —
 * harmless for OTP entry, where input is sequential, pasted, or autofilled.
 *
 * Enter is deliberately not intercepted so the surrounding <form> still
 * submits; only Backspace and arrow keys are handled.
 */
interface CodeInputProps {
  value: string;
  onChange: (value: string) => void;
  /** 'dark' matches LoginPage's glass styling; 'light' is the prototype/paper styling. */
  tone?: 'dark' | 'light';
  autoFocus?: boolean;
}

const BOX_CLASSES = {
  dark: 'h-14 w-11 rounded-xl border border-white/[0.15] bg-white/[0.08] text-white text-center text-xl font-medium outline-none transition focus:border-emerald-400/50 focus:ring-4 focus:ring-emerald-400/30',
  light:
    'h-14 w-11 rounded-xl border border-[#e3ddd2] bg-white text-center text-xl font-medium shadow-sm outline-none transition focus:border-[#2d8b6a] focus:ring-4 focus:ring-[#2d8b6a]/15',
} as const;

const SEPARATOR_CLASSES = { dark: 'bg-white/20', light: 'bg-[#c9c2b4]' } as const;

export default function CodeInput({
  value,
  onChange,
  tone = 'dark',
  autoFocus = false,
}: CodeInputProps) {
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  // Sanitize defensively so a dirty parent value can't render garbage
  const code = value.replace(/\D/g, '').slice(0, 6);
  const digits = Array.from({ length: 6 }, (_, i) => code[i] ?? '');

  useEffect(() => {
    if (autoFocus) inputs.current[0]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = (i: number, raw: string) => {
    const ds = raw.replace(/\D/g, '');
    const next = [...digits];
    if (!ds) {
      next[i] = '';
      onChange(next.join(''));
      return;
    }
    // Handles single keystrokes and multi-digit input (OS autofill dumping
    // the whole code into one box) alike
    let j = i;
    for (const ch of ds) {
      if (j > 5) break;
      next[j] = ch;
      j += 1;
    }
    onChange(next.join(''));
    inputs.current[Math.min(j, 5)]?.focus();
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      const next = [...digits];
      if (next[i]) {
        next[i] = '';
        onChange(next.join(''));
      } else if (i > 0) {
        next[i - 1] = '';
        onChange(next.join(''));
        inputs.current[i - 1]?.focus();
      }
    } else if (e.key === 'ArrowLeft' && i > 0) {
      e.preventDefault();
      inputs.current[i - 1]?.focus();
    } else if (e.key === 'ArrowRight' && i < 5) {
      e.preventDefault();
      inputs.current[i + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    // Accept a 6-digit run anywhere in the pasted text ("Your code is 482913")
    const match = e.clipboardData.getData('text').match(/\d{6}/);
    if (match) {
      onChange(match[0]);
      inputs.current[5]?.focus();
    }
  };

  const box = (i: number) => (
    <input
      key={i}
      ref={(el) => (inputs.current[i] = el)}
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete={i === 0 ? 'one-time-code' : 'off'}
      value={digits[i]}
      onChange={(e) => handleChange(i, e.target.value)}
      onKeyDown={(e) => handleKeyDown(i, e)}
      onFocus={(e) => e.target.select()}
      aria-label={`Digit ${i + 1} of 6`}
      className={BOX_CLASSES[tone]}
    />
  );

  return (
    <div
      role="group"
      aria-label="6-digit verification code"
      onPaste={handlePaste}
      className="flex items-center justify-center gap-2"
    >
      {[0, 1, 2].map(box)}
      <span aria-hidden className={`mx-1 h-px w-4 ${SEPARATOR_CLASSES[tone]}`} />
      {[3, 4, 5].map(box)}
    </div>
  );
}
