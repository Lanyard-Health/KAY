import { useCallback } from 'react';
import clsx from 'clsx';
import { useGenderIdentities } from '../../../hooks/useClinicalProfile';

interface Props {
  value: string[];
  onChange: (ids: string[]) => void;
}

export default function GenderIdentitiesStep({ value, onChange }: Props) {
  const { data: identities, isLoading } = useGenderIdentities();

  const convenienceToggle = identities?.find((i) => i.isConvenienceToggle);
  const individualItems = identities?.filter((i) => !i.isConvenienceToggle) ?? [];

  const handleToggle = useCallback(
    (id: string) => {
      if (!identities) return;

      const toggle = identities.find((i) => i.isConvenienceToggle);
      const individuals = identities.filter((i) => !i.isConvenienceToggle);

      // Clicking the convenience toggle
      if (toggle && id === toggle.id) {
        if (value.includes(toggle.id)) {
          // Uncheck all
          onChange([]);
        } else {
          // Check all
          onChange(identities.map((i) => i.id));
        }
        return;
      }

      // Clicking an individual item
      let next: string[];
      if (value.includes(id)) {
        // Uncheck it — also uncheck convenience toggle
        next = value.filter((v) => v !== id && v !== toggle?.id);
      } else {
        next = [...value, id];
        // If all individuals are now checked, also check the toggle
        if (toggle && individuals.every((i) => next.includes(i.id))) {
          next = [...next, toggle.id];
        }
      }
      onChange(next);
    },
    [identities, value, onChange]
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

  if (!identities || identities.length === 0) {
    return <p className="text-sm text-gray-500">No gender identity options available.</p>;
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

      {/* Divider */}
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
