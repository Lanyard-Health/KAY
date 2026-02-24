export default function PasswordStrength({ password }: { password: string }) {
  const checks = [
    { label: '12+ characters', pass: password.length >= 12 },
    { label: 'Uppercase letter', pass: /[A-Z]/.test(password) },
    { label: 'Lowercase letter', pass: /[a-z]/.test(password) },
    { label: 'Number', pass: /[0-9]/.test(password) },
    { label: 'Special character', pass: /[^A-Za-z0-9]/.test(password) },
  ];
  const passed = checks.filter((c) => c.pass).length;

  if (!password) return null;

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              i <= passed
                ? passed <= 2
                  ? 'bg-red-400'
                  : passed <= 3
                    ? 'bg-yellow-400'
                    : 'bg-green-500'
                : 'bg-gray-200'
            }`}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
        {checks.map((c) => (
          <span
            key={c.label}
            className={`text-xs ${c.pass ? 'text-green-600' : 'text-gray-400'}`}
          >
            {c.pass ? '\u2713' : '\u2022'} {c.label}
          </span>
        ))}
      </div>
    </div>
  );
}
