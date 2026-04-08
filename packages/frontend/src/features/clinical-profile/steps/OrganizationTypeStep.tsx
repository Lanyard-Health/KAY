import clsx from 'clsx';
import { useOrganizationTypes } from '../../../hooks/useClinicalProfile';

interface Props {
  value: string | null;
  onChange: (id: string) => void;
}

export default function OrganizationTypeStep({ value, onChange }: Props) {
  const { data: orgTypes, isLoading } = useOrganizationTypes();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="animate-pulse rounded-xl border border-gray-200 p-6">
            <div className="h-5 bg-gray-200 rounded w-1/3 mb-2" />
            <div className="h-4 bg-gray-100 rounded w-2/3" />
          </div>
        ))}
      </div>
    );
  }

  if (!orgTypes || orgTypes.length === 0) {
    return (
      <p className="text-sm text-gray-500">No organization types available.</p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3">
      {orgTypes.map((type) => (
        <button
          key={type.id}
          type="button"
          onClick={() => onChange(type.id)}
          className={clsx(
            'rounded-xl border p-6 text-left transition-colors',
            value === type.id
              ? 'ring-2 ring-primary-500 border-primary-500 bg-primary-50'
              : 'border-gray-200 hover:border-gray-300 cursor-pointer'
          )}
        >
          <p className="font-medium text-gray-900">{type.name}</p>
          <p className="text-sm text-gray-500 mt-1">{type.description}</p>
        </button>
      ))}
    </div>
  );
}
