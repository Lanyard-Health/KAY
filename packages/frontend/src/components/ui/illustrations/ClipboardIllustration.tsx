interface IllustrationProps {
  className?: string;
  size?: number;
}

export default function ClipboardIllustration({ className, size = 120 }: IllustrationProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* Clipboard body */}
      <rect x="28" y="20" width="64" height="88" rx="6" stroke="currentColor" strokeWidth="2" opacity="0.35" />
      {/* Clip at top */}
      <rect x="44" y="12" width="32" height="16" rx="4" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />
      <rect x="52" y="8" width="16" height="8" rx="3" fill="currentColor" opacity="0.15" />
      {/* Check line 1 */}
      <polyline points="40,46 46,52 56,42" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.35" />
      <line x1="64" y1="48" x2="80" y2="48" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.2" />
      {/* Check line 2 */}
      <polyline points="40,66 46,72 56,62" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.25" />
      <line x1="64" y1="68" x2="76" y2="68" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.15" />
      {/* Empty line 3 (no check — uncompleted) */}
      <rect x="40" y="84" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" opacity="0.15" />
      <line x1="64" y1="90" x2="78" y2="90" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.1" />
    </svg>
  );
}
