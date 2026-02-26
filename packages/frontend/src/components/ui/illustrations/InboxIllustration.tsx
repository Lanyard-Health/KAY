interface IllustrationProps {
  className?: string;
  size?: number;
}

export default function InboxIllustration({ className, size = 120 }: IllustrationProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* Box body */}
      <path
        d="M24 50 L24 90 C24 92.2 25.8 94 28 94 L92 94 C94.2 94 96 92.2 96 90 L96 50"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.4"
        fill="none"
      />
      {/* Box flaps (open) */}
      <path d="M24 50 L14 38 L60 26 L106 38 L96 50" stroke="currentColor" strokeWidth="1.5" opacity="0.25" strokeDasharray="4 3" />
      {/* Inner lip */}
      <path d="M24 50 L42 58 C56 64 64 64 78 58 L96 50" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
      {/* Small arrow floating up */}
      <line x1="60" y1="44" x2="60" y2="18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.2" />
      <polyline points="52,26 60,18 68,26" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.2" />
      {/* Decorative dots */}
      <circle cx="44" cy="76" r="1.5" fill="currentColor" opacity="0.15" />
      <circle cx="60" cy="80" r="1.5" fill="currentColor" opacity="0.15" />
      <circle cx="76" cy="76" r="1.5" fill="currentColor" opacity="0.15" />
    </svg>
  );
}
