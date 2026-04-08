import clsx from 'clsx';
import { useAgeGroups } from '../../../hooks/useClinicalProfile';

interface Props {
  value: string[];
  onChange: (ids: string[]) => void;
}

function formatAgeRange(start: number, end: number | null): string {
  if (end === null) return `${start}+ years`;
  const unit = end <= 23 ? 'months' : 'years';
  return `${start}-${end} ${unit}`;
}

export default function AgeGroupsStep({ value, onChange }: Props) {
  const { data: ageGroups, isLoading } = useAgeGroups();

  const allSelected =
    ageGroups && ageGroups.length > 0 && ageGroups.every((g) => value.includes(g.id));

  const toggleAll = () => {
    if (!ageGroups) return;
    if (allSelected) {
      onChange([]);
    } else {
      onChange(ageGroups.map((g) => g.id));
    }
  };

  const toggle = (id: string) => {
    onChange(
      value.includes(id) ? value.filter((v) => v !== id) : [...value, id]
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="animate-pulse h-8 bg-gray-100 rounded w-2/3" />
        ))}
      </div>
    );
  }

  if (!ageGroups || ageGroups.length === 0) {
    return <p className="text-sm text-gray-500">No age groups available.</p>;
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={toggleAll}
        className="text-sm font-medium text-primary-600 hover:text-primary-700 transition-colors"
      >
        {allSelected ? 'Deselect All' : 'Select All'}
      </button>

      <div className="space-y-1">
        {ageGroups.map((group) => (
          <label
            key={group.id}
            className={clsx(
              'flex items-center gap-3 px-4 py-2.5 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors',
              value.includes(group.id) && 'bg-primary-50/50'
            )}
          >
            <input
              type="checkbox"
              checked={value.includes(group.id)}
              onChange={() => toggle(group.id)}
              className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <span className="text-sm text-gray-900">
              {group.name}{' '}
              <span className="text-gray-500">
                ({formatAgeRange(group.ageRangeStart, group.ageRangeEnd)})
              </span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
