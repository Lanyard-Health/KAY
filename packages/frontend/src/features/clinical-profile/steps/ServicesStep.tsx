import { useState, useMemo } from 'react';
import { ChevronDownIcon, ChevronRightIcon, XMarkIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';
import { useServices, type ServiceCategory } from '../../../hooks/useClinicalProfile';

interface Props {
  value: { serviceOfferingIds: string[]; customServices: string[] };
  onChange: (v: { serviceOfferingIds: string[]; customServices: string[] }) => void;
}

const DOMAIN_LABELS: Record<string, string> = {
  BEHAVIORAL_HEALTH: 'Behavioral Health',
  WOMENS_HEALTH: "Women's Health",
  PRIMARY_CARE: 'Primary Care',
};

const DOMAIN_ORDER = ['BEHAVIORAL_HEALTH', 'WOMENS_HEALTH', 'PRIMARY_CARE'];

export default function ServicesStep({ value, onChange }: Props) {
  const { data: categories, isLoading } = useServices();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [customInput, setCustomInput] = useState('');

  const groupedByDomain = useMemo(() => {
    if (!categories) return {};
    const groups: Record<string, ServiceCategory[]> = {};
    for (const cat of categories) {
      if (!groups[cat.domain]) groups[cat.domain] = [];
      groups[cat.domain].push(cat);
    }
    return groups;
  }, [categories]);

  const toggleService = (id: string) => {
    const ids = value.serviceOfferingIds.includes(id)
      ? value.serviceOfferingIds.filter((v) => v !== id)
      : [...value.serviceOfferingIds, id];
    onChange({ ...value, serviceOfferingIds: ids });
  };

  const toggleCategory = (catId: string) => {
    setCollapsed((prev) => ({ ...prev, [catId]: !prev[catId] }));
  };

  const addCustom = () => {
    const trimmed = customInput.trim();
    if (!trimmed || value.customServices.includes(trimmed)) return;
    onChange({ ...value, customServices: [...value.customServices, trimmed] });
    setCustomInput('');
  };

  const removeCustom = (service: string) => {
    onChange({
      ...value,
      customServices: value.customServices.filter((s) => s !== service),
    });
  };

  const totalCount = value.serviceOfferingIds.length + value.customServices.length;

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="animate-pulse space-y-2">
            <div className="h-5 bg-gray-200 rounded w-1/4" />
            <div className="h-4 bg-gray-100 rounded w-3/4" />
            <div className="h-4 bg-gray-100 rounded w-2/3" />
          </div>
        ))}
      </div>
    );
  }

  if (!categories || categories.length === 0) {
    return <p className="text-sm text-gray-500">No services available.</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">{totalCount} services selected</p>

      {DOMAIN_ORDER.map((domain) => {
        const cats = groupedByDomain[domain];
        if (!cats || cats.length === 0) return null;
        return (
          <div key={domain}>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">
              {DOMAIN_LABELS[domain] || domain}
            </h3>
            <div className="space-y-2">
              {cats.map((cat) => {
                const isCollapsed = collapsed[cat.id] === true;
                return (
                  <div
                    key={cat.id}
                    className="rounded-xl border border-gray-200 overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => toggleCategory(cat.id)}
                      className="flex items-center gap-2 w-full px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
                    >
                      {isCollapsed ? (
                        <ChevronRightIcon className="h-4 w-4 text-gray-500 shrink-0" />
                      ) : (
                        <ChevronDownIcon className="h-4 w-4 text-gray-500 shrink-0" />
                      )}
                      <span className="text-sm font-medium text-gray-900">
                        {cat.name}
                      </span>
                      <span className="text-xs text-gray-400 ml-auto">
                        {cat.serviceOfferings.filter((s) =>
                          value.serviceOfferingIds.includes(s.id)
                        ).length}{' '}
                        / {cat.serviceOfferings.length}
                      </span>
                    </button>
                    {!isCollapsed && (
                      <div className="divide-y divide-gray-100">
                        {cat.serviceOfferings.map((svc) => (
                          <label
                            key={svc.id}
                            className={clsx(
                              'flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors',
                              value.serviceOfferingIds.includes(svc.id) &&
                                'bg-primary-50/50'
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={value.serviceOfferingIds.includes(svc.id)}
                              onChange={() => toggleService(svc.id)}
                              className="h-4 w-4 mt-0.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                            />
                            <div className="min-w-0">
                              <span className="text-sm font-medium text-gray-900">
                                {svc.name}
                              </span>
                              {svc.description && (
                                <p className="text-sm text-gray-500 mt-0.5">
                                  {svc.description}
                                </p>
                              )}
                              {svc.cptCodes.length > 0 && (
                                <p className="text-xs text-gray-400 mt-0.5">
                                  CPT: {svc.cptCodes.join(', ')}
                                </p>
                              )}
                            </div>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Custom services */}
      <div className="rounded-xl border border-gray-200 p-4 space-y-3">
        <h3 className="text-sm font-medium text-gray-900">
          Other / Add Custom Service
        </h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addCustom();
              }
            }}
            placeholder="Enter a custom service name..."
            className="flex-1 rounded-xl border-gray-300 text-sm focus:ring-primary-500 focus:border-primary-500"
          />
          <button
            type="button"
            onClick={addCustom}
            disabled={!customInput.trim()}
            className="px-4 py-2 text-sm font-medium rounded-xl bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Add
          </button>
        </div>
        {value.customServices.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {value.customServices.map((s) => (
              <span
                key={s}
                className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-3 py-1 text-sm text-primary-700"
              >
                {s}
                <button
                  type="button"
                  onClick={() => removeCustom(s)}
                  className="text-primary-500 hover:text-primary-700"
                >
                  <XMarkIcon className="h-4 w-4" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
