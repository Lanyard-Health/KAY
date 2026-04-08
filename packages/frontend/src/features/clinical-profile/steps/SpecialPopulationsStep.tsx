import clsx from 'clsx';
import { useSpecialPopulations } from '../../../hooks/useClinicalProfile';

interface Props {
  value: string[];
  onChange: (ids: string[]) => void;
}

export default function SpecialPopulationsStep({ value, onChange }: Props) {
  const { data: populations, isLoading } = useSpecialPopulations();

  const allSelected =
    populations &&
    populations.length > 0 &&
    populations.every((p) => value.includes(p.id));

  const toggleAll = () => {
    if (!populations) return;
    if (allSelected) {
      onChange([]);
    } else {
      onChange(populations.map((p) => p.id));
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

  if (!populations || populations.length === 0) {
    return <p className="text-sm text-gray-500">No special populations available.</p>;
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
        {populations.map((pop) => (
          <label
            key={pop.id}
            className={clsx(
              'flex items-center gap-3 px-4 py-2.5 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors',
              value.includes(pop.id) && 'bg-primary-50/50'
            )}
          >
            <input
              type="checkbox"
              checked={value.includes(pop.id)}
              onChange={() => toggle(pop.id)}
              className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <span className="text-sm text-gray-900">{pop.name}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
