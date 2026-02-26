interface IllustrationProps {
  className?: string;
  size?: number;
}

export default function FolderIllustration({ className, size = 120 }: IllustrationProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* Folder back panel */}
      <path
        d="M16 36 C16 32 18 30 22 30 L46 30 L54 22 C55 21 56 20 58 20 L94 20 C98 20 100 22 100 26 L100 36"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.2"
      />
      {/* Folder body */}
      <rect x="16" y="36" width="88" height="62" rx="5" stroke="currentColor" strokeWidth="2" opacity="0.4" />
      {/* Paper peeking out */}
      <rect x="36" y="28" width="40" height="52" rx="3" stroke="currentColor" strokeWidth="1.5" opacity="0.2" fill="none" />
      <line x1="44" y1="42" x2="68" y2="42" stroke="currentColor" strokeWidth="1" opacity="0.12" />
      <line x1="44" y1="50" x2="62" y2="50" stroke="currentColor" strokeWidth="1" opacity="0.12" />
      <line x1="44" y1="58" x2="66" y2="58" stroke="currentColor" strokeWidth="1" opacity="0.12" />
      {/* Folder tab highlight */}
      <path d="M16 36 L100 36" stroke="currentColor" strokeWidth="2" opacity="0.15" />
    </svg>
  );
}
