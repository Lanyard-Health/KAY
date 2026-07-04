import { useState, useEffect } from 'react';
import clsx from 'clsx';
import { usePractices } from '../../../hooks/usePractices';

export type ViewAsTarget = { kind: 'practice'; id: string; name: string } | { kind: 'staff' } | null;

interface ViewAsBarProps {
  viewing: ViewAsTarget;
  onEnterPractice: (practiceId: string) => void;
  onEnterStaff: () => void;
  onExit: () => void;
}

// Dark persistent switcher bar (EXPERIENCE.md view_as_switcher). Two role pills:
// Practice Admin (requires a practice) and Credentialing Staff (cross-practice,
// no picker needed).
export default function ViewAsBar({ viewing, onEnterPractice, onEnterStaff, onExit }: ViewAsBarProps) {
  const { data: practices } = usePractices();
  const [selectedRole, setSelectedRole] = useState<'practice' | 'staff'>('practice');
  const [selected, setSelected] = useState('');

  useEffect(() => {
    if (!viewing) setSelected('');
  }, [viewing]);

  const pillClass = (checked: boolean) =>
    clsx(
      'rounded-lg px-3 py-1.5 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-white',
      checked ? 'bg-white/15' : 'text-gray-400 hover:text-white',
    );

  return (
    <div className="rounded-2xl bg-gray-900 px-5 py-3 text-white">
      {viewing ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* role="status" live region — announced on enter AND exit (content change) */}
          <p role="status" className="text-sm">
            <span className="mr-2 inline-block rounded-lg bg-amber-400/20 px-2 py-0.5 text-xs font-semibold text-amber-300">Viewing as</span>
            {viewing.kind === 'practice'
              ? `Now viewing as Practice Admin — ${viewing.name}. Read-only preview.`
              : 'Now viewing as Credentialing Staff — all practices. Read-only preview.'}
          </p>
          <button
            type="button"
            onClick={onExit}
            className="rounded-lg bg-white/10 px-3 py-1.5 text-sm font-semibold hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            Exit view-as
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <span id="viewas-label" className="text-xs font-semibold uppercase tracking-wider text-gray-400">View as</span>
          <div role="radiogroup" aria-labelledby="viewas-label" className="flex gap-1.5">
            <button
              type="button"
              role="radio"
              aria-checked={selectedRole === 'practice'}
              onClick={() => setSelectedRole('practice')}
              className={pillClass(selectedRole === 'practice')}
            >
              Practice Admin
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={selectedRole === 'staff'}
              onClick={() => setSelectedRole('staff')}
              className={pillClass(selectedRole === 'staff')}
            >
              Credentialing Staff
            </button>
          </div>
          {selectedRole === 'practice' && (
            <>
              <label htmlFor="viewas-practice" className="sr-only">Practice</label>
              <select
                id="viewas-practice"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                className="rounded-lg border-0 bg-white/10 px-3 py-1.5 text-sm text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white [&>option]:text-gray-900"
              >
                <option value="">Choose a practice…</option>
                {(practices ?? []).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </>
          )}
          <button
            type="button"
            onClick={() => {
              if (selectedRole === 'staff') onEnterStaff();
              else if (selected) onEnterPractice(selected);
            }}
            className="rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-gray-900 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            View
          </button>
        </div>
      )}
    </div>
  );
}
