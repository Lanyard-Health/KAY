import { useEffect, useState } from 'react';
import { Combobox } from '@headlessui/react';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api';

export interface PayerOption {
  id: string;
  name: string;
}

interface PayerComboboxProps {
  value: PayerOption | null;
  onChange: (payer: PayerOption | null) => void;
}

// Same Stedi-backed word-order search the enrollment screens use (D4), over
// the full payer catalog. Loading + "No payers match" states per the
// enrollment screens; result counts announced once per settled debounced
// result set — never per keystroke.
export default function PayerCombobox({ value, onChange }: PayerComboboxProps) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(handle);
  }, [query]);

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['payer-search', debounced],
    queryFn: async () =>
      (await api.get(`/enrollments/payers?q=${encodeURIComponent(debounced)}&pageSize=20`)).data.data as PayerOption[],
    enabled: debounced.length > 0,
  });

  // Settled-result announcement: fires once per resolved result set; pending
  // announcements are implicitly cancelled because a new query flips isFetching.
  useEffect(() => {
    if (!debounced) { setAnnouncement(''); return; }
    if (isFetching) return;
    setAnnouncement(results.length === 0 ? 'No payers match' : `${results.length} payer${results.length === 1 ? '' : 's'} found`);
  }, [results, isFetching, debounced]);

  return (
    <Combobox value={value} onChange={onChange} nullable>
      {({ open }) => (
        <div className="relative">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-gray-400" />
          <Combobox.Input
            id="task-payer"
            className="input pl-10"
            placeholder="Search payers…"
            displayValue={(payer: PayerOption | null) => payer?.name ?? ''}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Esc closes the listbox WITHOUT bubbling into the modal's close handler.
              if (e.key === 'Escape' && open) e.stopPropagation();
            }}
          />
          <div role="status" aria-live="polite" className="sr-only">{announcement}</div>
          {debounced.length > 0 && (
            <Combobox.Options
              modal={false}
              className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-xl border border-gray-200 bg-white shadow-lg"
            >
              {isFetching && (
                <div className="px-4 py-2.5 text-sm text-gray-500">Searching payers…</div>
              )}
              {!isFetching && results.length === 0 && (
                <div className="px-4 py-3 text-sm text-gray-500">No payers match</div>
              )}
              {results.map((payer) => (
                <Combobox.Option
                  key={payer.id}
                  value={payer}
                  className={({ active }) => `cursor-pointer select-none px-4 py-2 text-sm text-gray-900 ${active ? 'bg-primary-50' : ''}`}
                >
                  {payer.name}
                </Combobox.Option>
              ))}
            </Combobox.Options>
          )}
        </div>
      )}
    </Combobox>
  );
}
