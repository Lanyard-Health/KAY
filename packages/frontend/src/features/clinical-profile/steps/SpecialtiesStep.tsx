import { useState, useMemo } from 'react';
import { XMarkIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';
import {
  useSpecialties,
  type OrganizationType,
} from '../../../hooks/useClinicalProfile';

interface Props {
  organizationTypeId: string;
  organizationTypes: OrganizationType[];
  value: string[];
  onChange: (ids: string[]) => void;
}

const INDIVIDUAL_TYPES = ['Individual', 'Group', 'Multi-Specialty'];

export default function SpecialtiesStep({
  organizationTypeId,
  organizationTypes,
  value,
  onChange,
}: Props) {
  const [search, setSearch] = useState('');

  const section = useMemo(() => {
    const orgType = organizationTypes.find((t) => t.id === organizationTypeId);
    if (!orgType) return 'INDIVIDUAL' as const;
    return INDIVIDUAL_TYPES.includes(orgType.name)
      ? ('INDIVIDUAL' as const)
      : ('NON_INDIVIDUAL' as const);
  }, [organizationTypeId, organizationTypes]);

  const { data: specialties, isLoading } = useSpecialties(section);

  const filtered = useMemo(() => {
    if (!specialties) return [];
    if (!search.trim()) return specialties;
    const q = search.toLowerCase();
    return specialties.filter((s) => s.name.toLowerCase().includes(q));
  }, [specialties, search]);

  const selectedSpecialties = useMemo(() => {
    if (!specialties) return [];
    return specialties.filter((s) => value.includes(s.id));
  }, [specialties, value]);

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
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="animate-pulse h-8 bg-gray-100 rounded w-3/4" />
        ))}
      </div>
    );
  }

  if (!specialties || specialties.length === 0) {
    return (
      <p className="text-sm text-gray-500">No specialties available for your organization type.</p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Selected chips */}
      {selectedSpecialties.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selectedSpecialties.map((s) => (
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

      <p className="text-sm text-gray-500">{value.length} specialties selected</p>

      {/* Search input */}
      <div className="relative">
        <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search specialties..."
          className="w-full rounded-xl border-gray-300 pl-10 pr-4 py-2 text-sm focus:ring-primary-500 focus:border-primary-500"
        />
      </div>

      {/* Specialty list */}
      <div className="max-h-60 overflow-y-auto rounded-xl border border-gray-200 divide-y divide-gray-100">
        {filtered.length === 0 ? (
          <p className="px-4 py-3 text-sm text-gray-500">No specialties match your search.</p>
        ) : (
          filtered.map((s) => (
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
          ))
        )}
      </div>
    </div>
  );
}
