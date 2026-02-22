import { Fragment, useState, useEffect, useCallback } from 'react';
import { Dialog, Combobox, Transition } from '@headlessui/react';
import { MagnifyingGlassIcon } from '@heroicons/react/20/solid';
import clsx from 'clsx';

interface SearchResult {
  id: string;
  type: 'provider' | 'practice' | 'enrollment' | 'payer' | 'document';
  title: string;
  subtitle?: string;
  url: string;
}

interface CommandPaletteProps {
  onSearch: (query: string) => Promise<SearchResult[]>;
  onSelect: (result: SearchResult) => void;
}

const typeLabels: Record<SearchResult['type'], string> = {
  provider: 'Provider',
  practice: 'Practice',
  enrollment: 'Enrollment',
  payer: 'Payer',
  document: 'Document',
};

const typeColors: Record<SearchResult['type'], string> = {
  provider: 'bg-blue-50 text-blue-700',
  practice: 'bg-green-50 text-green-700',
  enrollment: 'bg-amber-50 text-amber-700',
  payer: 'bg-purple-50 text-purple-700',
  document: 'bg-gray-50 text-gray-600',
};

export default function CommandPalette({ onSearch, onSelect }: CommandPaletteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Cmd+K / Ctrl+K keyboard shortcut
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen((open) => !open);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const search = useCallback(
    async (q: string) => {
      if (q.length < 2) {
        setResults([]);
        return;
      }
      setIsLoading(true);
      try {
        const data = await onSearch(q);
        setResults(data);
      } catch {
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    },
    [onSearch],
  );

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => search(query), 200);
    return () => clearTimeout(timer);
  }, [query, search]);

  function handleClose() {
    setIsOpen(false);
    setQuery('');
    setResults([]);
  }

  return (
    <Transition.Root show={isOpen} as={Fragment} afterLeave={() => setQuery('')}>
      <Dialog onClose={handleClose} className="relative z-50">
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm" />
        </Transition.Child>

        <div className="fixed inset-0 z-50 overflow-y-auto p-4 sm:p-6 md:p-20">
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0 scale-95"
            enterTo="opacity-100 scale-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-95"
          >
            <Dialog.Panel className="mx-auto max-w-xl transform overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 transition-all">
              <Combobox
                onChange={(result: SearchResult | null) => {
                  if (result) {
                    onSelect(result);
                    handleClose();
                  }
                }}
              >
                <div className="relative">
                  <MagnifyingGlassIcon className="pointer-events-none absolute left-4 top-3.5 h-5 w-5 text-gray-400" />
                  <Combobox.Input
                    className="h-12 w-full border-0 bg-transparent pl-11 pr-4 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-0"
                    placeholder="Search providers, practices, payers..."
                    onChange={(e) => setQuery(e.target.value)}
                    autoComplete="off"
                  />
                  <kbd className="absolute right-4 top-3.5 hidden sm:inline-flex items-center rounded border border-gray-200 px-1.5 text-xs text-gray-400 font-mono">
                    ESC
                  </kbd>
                </div>

                {(results.length > 0 || isLoading) && (
                  <Combobox.Options
                    static
                    className="max-h-80 scroll-py-2 overflow-y-auto border-t border-gray-100 py-2"
                  >
                    {isLoading && (
                      <div className="px-4 py-3 text-sm text-gray-500">Searching...</div>
                    )}
                    {results.map((result) => (
                      <Combobox.Option
                        key={`${result.type}-${result.id}`}
                        value={result}
                        className={({ active }) =>
                          clsx(
                            'cursor-pointer select-none px-4 py-2.5',
                            active && 'bg-gray-50',
                          )
                        }
                      >
                        <div className="flex items-center gap-3">
                          <span
                            className={clsx(
                              'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                              typeColors[result.type],
                            )}
                          >
                            {typeLabels[result.type]}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {result.title}
                            </p>
                            {result.subtitle && (
                              <p className="text-xs text-gray-500 truncate">
                                {result.subtitle}
                              </p>
                            )}
                          </div>
                        </div>
                      </Combobox.Option>
                    ))}
                  </Combobox.Options>
                )}

                {query.length >= 2 && !isLoading && results.length === 0 && (
                  <div className="border-t border-gray-100 px-4 py-8 text-center text-sm text-gray-500">
                    No results found for &ldquo;{query}&rdquo;
                  </div>
                )}

                {query.length === 0 && (
                  <div className="border-t border-gray-100 px-4 py-4 text-center text-xs text-gray-400">
                    Type to search across providers, practices, payers, and more
                  </div>
                )}
              </Combobox>
            </Dialog.Panel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition.Root>
  );
}
