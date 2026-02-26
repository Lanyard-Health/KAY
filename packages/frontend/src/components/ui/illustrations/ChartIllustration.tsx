interface IllustrationProps {
  className?: string;
  size?: number;
}

export default function ChartIllustration({ className, size = 120 }: IllustrationProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* Axes */}
      <line x1="24" y1="96" x2="100" y2="96" stroke="currentColor" strokeWidth="1.5" opacity="0.3" strokeLinecap="round" />
      <line x1="24" y1="96" x2="24" y2="20" stroke="currentColor" strokeWidth="1.5" opacity="0.3" strokeLinecap="round" />
      {/* Grid lines (horizontal) */}
      <line x1="24" y1="77" x2="100" y2="77" stroke="currentColor" strokeWidth="0.5" opacity="0.1" strokeDasharray="4 4" />
      <line x1="24" y1="58" x2="100" y2="58" stroke="currentColor" strokeWidth="0.5" opacity="0.1" strokeDasharray="4 4" />
      <line x1="24" y1="39" x2="100" y2="39" stroke="currentColor" strokeWidth="0.5" opacity="0.1" strokeDasharray="4 4" />
      {/* Bar outlines (empty/zero-height — just stubs at baseline) */}
      <rect x="34" y="86" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" opacity="0.2" fill="none" />
      <rect x="54" y="88" width="12" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" opacity="0.15" fill="none" />
      <rect x="74" y="90" width="12" height="6" rx="2" stroke="currentColor" strokeWidth="1.5" opacity="0.12" fill="none" />
      {/* Dashed "potential" bars */}
      <rect x="34" y="42" width="12" height="44" rx="2" stroke="currentColor" strokeWidth="1" opacity="0.08" strokeDasharray="3 3" fill="none" />
      <rect x="54" y="52" width="12" height="36" rx="2" stroke="currentColor" strokeWidth="1" opacity="0.08" strokeDasharray="3 3" fill="none" />
      <rect x="74" y="62" width="12" height="28" rx="2" stroke="currentColor" strokeWidth="1" opacity="0.08" strokeDasharray="3 3" fill="none" />
      {/* Small upward arrow hint */}
      <line x1="96" y1="74" x2="96" y2="30" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.15" />
      <polyline points="90,38 96,30 102,38" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" opacity="0.15" />
    </svg>
  );
}
