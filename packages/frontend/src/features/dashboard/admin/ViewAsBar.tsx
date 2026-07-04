import { useState } from 'react';
import { usePractices } from '../../../hooks/usePractices';

interface ViewAsBarProps {
  viewingPractice: { id: string; name: string } | null;
  onEnter: (practiceId: string) => void;
  onExit: () => void;
}

// Dark persistent switcher bar (EXPERIENCE.md view_as_switcher). Slice 3 ships the
// Practice Admin pill only — the Credentialing Staff pill arrives with slice 2.
export default function ViewAsBar({ viewingPractice, onEnter, onExit }: ViewAsBarProps) {
  const { data: practices } = usePractices();
  const [selected, setSelected] = useState('');

  return (
    <div className="rounded-2xl bg-gray-900 px-5 py-3 text-white">
      {viewingPractice ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* role="status" live region — announced on enter AND exit (content change) */}
          <p role="status" className="text-sm">
            <span className="mr-2 inline-block rounded-lg bg-amber-400/20 px-2 py-0.5 text-xs font-semibold text-amber-300">Viewing as</span>
            Now viewing as Practice Admin — {viewingPractice.name}. Read-only preview.
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
            <button type="button" role="radio" aria-checked="true" className="rounded-lg bg-white/15 px-3 py-1.5 text-sm font-semibold">
              Practice Admin
            </button>
          </div>
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
          <button
            type="button"
            onClick={() => { if (selected) onEnter(selected); }}
            className="rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-gray-900 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            View
          </button>
        </div>
      )}
    </div>
  );
}
