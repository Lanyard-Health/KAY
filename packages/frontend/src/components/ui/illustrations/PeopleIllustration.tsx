interface IllustrationProps {
  className?: string;
  size?: number;
}

export default function PeopleIllustration({ className, size = 120 }: IllustrationProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* Person 1 (left, slightly forward) */}
      <circle cx="44" cy="38" r="14" stroke="currentColor" strokeWidth="2" opacity="0.35" />
      <path
        d="M18 92 C18 72 28 62 44 62 C60 62 70 72 70 92"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.35"
        fill="none"
        strokeLinecap="round"
      />
      {/* Person 2 (right, slightly behind) */}
      <circle cx="76" cy="42" r="12" stroke="currentColor" strokeWidth="1.5" opacity="0.2" />
      <path
        d="M54 96 C54 78 62 68 76 68 C90 68 98 78 98 96"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.2"
        fill="none"
        strokeLinecap="round"
      />
      {/* Small plus icon between them */}
      <line x1="90" y1="32" x2="90" y2="22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.2" />
      <line x1="85" y1="27" x2="95" y2="27" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.2" />
    </svg>
  );
}
