import { useCallback } from 'react';
import clsx from 'clsx';
import { useSexualOrientations } from '../../../hooks/useClinicalProfile';

interface Props {
  value: string[];
  onChange: (ids: string[]) => void;
}

export default function SexualOrientationsStep({ value, onChange }: Props) {
  const { data: orientations, isLoading } = useSexualOrientations();

  const convenienceToggle = orientations?.find((o) => o.isConvenienceToggle);
  const individualItems = orientations?.filter((o) => !o.isConvenienceToggle) ?? [];

  const handleToggle = useCallback(
    (id: string) => {
      if (!orientations) return;

      const toggle = orientations.find((o) => o.isConvenienceToggle);
      const individuals = orientations.filter((o) => !o.isConvenienceToggle);

      // Clicking the convenience toggle
      if (toggle && id === toggle.id) {
        if (value.includes(toggle.id)) {
          onChange([]);
        } else {
          onChange(orientations.map((o) => o.id));
        }
        return;
      }

      // Clicking an individual item
      let next: string[];
      if (value.includes(id)) {
        next = value.filter((v) => v !== id && v !== toggle?.id);
      } else {
        next = [...value, id];
        if (toggle && individuals.every((o) => next.includes(o.id))) {
          next = [...next, toggle.id];
        }
      }
      onChange(next);
    },
    [orientations, value, onChange]
  );

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="animate-pulse h-8 bg-gray-100 rounded w-2/3" />
        ))}
      </div>
    );
  }

  if (!orientations || orientations.length === 0) {
    return <p className="text-sm text-gray-500">No sexual orientation options available.</p>;
  }

  return (
    <div className="space-y-1">
      {/* Convenience toggle first */}
      {convenienceToggle && (
        <label
          className={clsx(
            'flex items-center gap-3 px-4 py-2.5 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors font-medium',
            value.includes(convenienceToggle.id) && 'bg-primary-50/50'
          )}
        >
          <input
            type="checkbox"
            checked={value.includes(convenienceToggle.id)}
            onChange={() => handleToggle(convenienceToggle.id)}
            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          />
          <span className="text-sm text-gray-900">{convenienceToggle.name}</span>
        </label>
      )}

      {convenienceToggle && <div className="border-t border-gray-100 mx-4" />}

      {/* Individual items */}
      {individualItems.map((item) => (
        <label
          key={item.id}
          className={clsx(
            'flex items-center gap-3 px-4 py-2.5 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors',
            value.includes(item.id) && 'bg-primary-50/50'
          )}
        >
          <input
            type="checkbox"
            checked={value.includes(item.id)}
            onChange={() => handleToggle(item.id)}
            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          />
          <span className="text-sm text-gray-900">{item.name}</span>
        </label>
      ))}
    </div>
  );
}
