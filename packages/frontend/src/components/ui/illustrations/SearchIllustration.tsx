interface IllustrationProps {
  className?: string;
  size?: number;
}

export default function SearchIllustration({ className, size = 120 }: IllustrationProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* Page with dashed outline */}
      <rect x="20" y="12" width="52" height="68" rx="4" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.25" />
      <line x1="32" y1="28" x2="60" y2="28" stroke="currentColor" strokeWidth="1.5" opacity="0.12" />
      <line x1="32" y1="38" x2="54" y2="38" stroke="currentColor" strokeWidth="1.5" opacity="0.12" />
      <line x1="32" y1="48" x2="58" y2="48" stroke="currentColor" strokeWidth="1.5" opacity="0.12" />
      <line x1="32" y1="58" x2="50" y2="58" stroke="currentColor" strokeWidth="1.5" opacity="0.12" />
      {/* Magnifying glass */}
      <circle cx="76" cy="74" r="20" stroke="currentColor" strokeWidth="2" opacity="0.5" />
      <circle cx="76" cy="74" r="14" stroke="currentColor" strokeWidth="1" opacity="0.15" />
      <line x1="90" y1="89" x2="106" y2="105" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" opacity="0.5" />
      {/* Sparkle */}
      <circle cx="70" cy="68" r="1.5" fill="currentColor" opacity="0.25" />
    </svg>
  );
}
