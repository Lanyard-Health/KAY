import { useState, useMemo } from 'react';
import { XMarkIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';
import { useSubSpecialties } from '../../../hooks/useClinicalProfile';

interface Props {
  specialtyIds: string[];
  value: string[];
  onChange: (ids: string[]) => void;
}

export default function SubSpecialtiesStep({ specialtyIds, value, onChange }: Props) {
  const [search, setSearch] = useState('');
  const { data: subSpecialties, isLoading } = useSubSpecialties(specialtyIds);

  const filtered = useMemo(() => {
    if (!subSpecialties) return [];
    if (!search.trim()) return subSpecialties;
    const q = search.toLowerCase();
    return subSpecialties.filter((s) => s.name.toLowerCase().includes(q));
  }, [subSpecialties, search]);

  const grouped = useMemo(() => {
    const groups: Record<string, typeof filtered> = {};
    for (const sub of filtered) {
      const parentName = sub.specialty.name;
      if (!groups[parentName]) groups[parentName] = [];
      groups[parentName].push(sub);
    }
    return groups;
  }, [filtered]);

  const selectedSubs = useMemo(() => {
    if (!subSpecialties) return [];
    return subSpecialties.filter((s) => value.includes(s.id));
  }, [subSpecialties, value]);

  const toggle = (id: string) => {
    onChange(
      value.includes(id) ? value.filter((v) => v !== id) : [...value, id]
    );
  };

  const remove = (id: string) => {
    onChange(value.filter((v) => v !== id));
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="animate-pulse h-10 bg-gray-200 rounded-xl" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="animate-pulse h-8 bg-gray-100 rounded w-3/4" />
        ))}
      </div>
    );
  }

  if (!subSpecialties || subSpecialties.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No sub-specialties available for your selected specialties.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Selected chips */}
      {selectedSubs.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selectedSubs.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-3 py-1 text-sm text-primary-700"
            >
              {s.name}
              <button
                type="button"
                onClick={() => remove(s.id)}
                className="text-primary-500 hover:text-primary-700"
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            </span>
          ))}
        </div>
      )}

      <p className="text-sm text-gray-500">{value.length} sub-specialties selected</p>

      {/* Search input */}
      <div className="relative">
        <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search sub-specialties..."
          className="w-full rounded-xl border-gray-300 pl-10 pr-4 py-2 text-sm focus:ring-primary-500 focus:border-primary-500"
        />
      </div>

      {/* Sub-specialty list grouped by parent */}
      <div className="max-h-60 overflow-y-auto rounded-xl border border-gray-200">
        {Object.keys(grouped).length === 0 ? (
          <p className="px-4 py-3 text-sm text-gray-500">No sub-specialties match your search.</p>
        ) : (
          Object.entries(grouped).map(([parentName, subs]) => (
            <div key={parentName}>
              <div className="sticky top-0 bg-gray-50 px-4 py-2 border-b border-gray-200">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {parentName}
                </span>
              </div>
              <div className="divide-y divide-gray-100">
                {subs.map((s) => (
                  <label
                    key={s.id}
                    className={clsx(
                      'flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors',
                      value.includes(s.id) && 'bg-primary-50/50'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={value.includes(s.id)}
                      onChange={() => toggle(s.id)}
                      className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm text-gray-900">{s.name}</span>
                  </label>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
