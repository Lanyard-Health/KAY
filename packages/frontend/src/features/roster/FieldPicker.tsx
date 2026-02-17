import { useState, useMemo } from 'react';
import { ChevronDownIcon, ChevronRightIcon, PlusIcon } from '@heroicons/react/20/solid';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { ROSTER_FIELDS, ROSTER_CATEGORIES } from '@credential-management/shared';
import type { RosterColumn } from '../../hooks/useRoster';

interface FieldPickerProps {
  selectedKeys: Set<string>;
  onAddField: (column: RosterColumn) => void;
}

export default function FieldPicker({ selectedKeys, onAddField }: FieldPickerProps) {
  const [search, setSearch] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(['Provider Info'])
  );

  const filteredByCategory = useMemo(() => {
    const lower = search.toLowerCase();
    const grouped: Record<string, typeof ROSTER_FIELDS> = {};

    for (const cat of ROSTER_CATEGORIES) {
      // eslint-disable-next-line security/detect-object-injection -- cat is from ROSTER_CATEGORIES constant array
      grouped[cat] = [];
    }

    for (const field of ROSTER_FIELDS) {
      if (lower && !field.label.toLowerCase().includes(lower) && !field.key.toLowerCase().includes(lower)) {
        continue;
      }
      grouped[field.category]!.push(field);
    }

    return grouped;
  }, [search]);

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  // When searching, expand all categories that have matches
  const effectiveExpanded = useMemo(() => {
    if (!search) return expandedCategories;
    const expanded = new Set<string>();
    for (const [cat, fields] of Object.entries(filteredByCategory)) {
      if (fields.length > 0) expanded.add(cat);
    }
    return expanded;
  }, [search, expandedCategories, filteredByCategory]);

  return (
    <div className="flex flex-col h-full">
      <h3 className="text-sm font-semibold text-gray-900 mb-2">Available Fields</h3>

      {/* Search */}
      <div className="relative mb-3">
        <MagnifyingGlassIcon className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search fields..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-md border border-gray-300 py-2 pl-8 pr-3 text-sm placeholder:text-gray-400 focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
        />
      </div>

      {/* Category list */}
      <div className="flex-1 overflow-y-auto -mx-1">
        {ROSTER_CATEGORIES.map((category) => {
          // eslint-disable-next-line security/detect-object-injection -- category is from ROSTER_CATEGORIES constant array
          const fields = filteredByCategory[category] || [];
          if (search && fields.length === 0) return null;
          const isExpanded = effectiveExpanded.has(category);

          return (
            <div key={category} className="mb-1">
              <button
                type="button"
                onClick={() => toggleCategory(category)}
                className="flex items-center w-full px-2 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded"
              >
                {isExpanded ? (
                  <ChevronDownIcon className="h-4 w-4 mr-1 text-gray-400" />
                ) : (
                  <ChevronRightIcon className="h-4 w-4 mr-1 text-gray-400" />
                )}
                {category}
                <span className="ml-auto text-xs text-gray-400">{fields.length}</span>
              </button>

              {isExpanded && (
                <ul className="ml-5 mt-0.5 space-y-0.5">
                  {fields.map((field) => {
                    const isSelected = selectedKeys.has(field.key);
                    return (
                      <li key={field.key}>
                        <button
                          type="button"
                          disabled={isSelected}
                          onClick={() =>
                            onAddField({ fieldKey: field.key, label: field.label })
                          }
                          className={`flex items-center w-full px-2 py-1 text-sm rounded ${
                            isSelected
                              ? 'text-gray-400 cursor-not-allowed'
                              : 'text-gray-600 hover:bg-primary-50 hover:text-primary-700'
                          }`}
                        >
                          <PlusIcon
                            className={`h-3.5 w-3.5 mr-1.5 ${
                              isSelected ? 'text-gray-300' : 'text-primary-500'
                            }`}
                          />
                          {field.label}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
