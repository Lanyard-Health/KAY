import { Fragment, useState, useEffect, useCallback } from 'react';
import { Dialog, Combobox, Transition } from '@headlessui/react';
import { MagnifyingGlassIcon } from '@heroicons/react/20/solid';
import { SparklesIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';
import { api } from '../../services/api';

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

type ExtendedType = SearchResult['type'] | 'ai';

const typeLabels: Record<ExtendedType, string> = {
  provider: 'Provider',
  practice: 'Practice',
  enrollment: 'Enrollment',
  payer: 'Payer',
  document: 'Document',
  ai: 'Ask AI',
};

const typeColors: Record<ExtendedType, string> = {
  provider: 'bg-blue-50 text-blue-700',
  practice: 'bg-green-50 text-green-700',
  enrollment: 'bg-amber-50 text-amber-700',
  payer: 'bg-purple-50 text-purple-700',
  document: 'bg-gray-50 text-gray-600',
  ai: 'bg-violet-50 text-violet-700',
};

export default function CommandPalette({ onSearch, onSelect }: CommandPaletteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

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

  const handleAiQuery = useCallback(async (q: string) => {
    setAiLoading(true);
    setAiResponse(null);
    try {
      const { data } = await api.post<{ response: string }>('/ai/chat', {
        message: q,
      });
      setAiResponse(data.response);
    } catch {
      setAiResponse('Sorry, I was unable to process that request. Please try again.');
    } finally {
      setAiLoading(false);
    }
  }, []);

  function handleClose() {
    setIsOpen(false);
    setQuery('');
    setResults([]);
    setAiResponse(null);
    setAiLoading(false);
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
                  if (!result) return;
                  if ((result as any).type === 'ai') {
                    handleAiQuery(query);
                    return;
                  }
                  onSelect(result);
                  handleClose();
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

                {(results.length > 0 || isLoading || query.length >= 3) && (
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
                    {query.length >= 3 && (
                      <Combobox.Option
                        value={{ id: 'ai-query', type: 'ai' as any, title: `Ask AI: "${query}"`, url: '' }}
                        className={({ active }) =>
                          clsx(
                            'cursor-pointer select-none px-4 py-2.5 border-t border-gray-100',
                            active && 'bg-violet-50',
                          )
                        }
                      >
                        <div className="flex items-center gap-3">
                          <SparklesIcon className="h-5 w-5 text-violet-500" />
                          <span className="text-sm font-medium text-violet-700">
                            Ask AI: &ldquo;{query}&rdquo;
                          </span>
                        </div>
                      </Combobox.Option>
                    )}
                  </Combobox.Options>
                )}

                {query.length >= 2 && query.length < 3 && !isLoading && results.length === 0 && (
                  <div className="border-t border-gray-100 px-4 py-8 text-center text-sm text-gray-500">
                    No results found for &ldquo;{query}&rdquo;
                  </div>
                )}

                {query.length >= 3 && !isLoading && results.length === 0 && !aiResponse && !aiLoading && (
                  <div className="border-t border-gray-100 px-4 py-4 text-center text-sm text-gray-500">
                    No results found. Try asking AI above.
                  </div>
                )}

                {(aiLoading || aiResponse) && (
                  <div className="border-t border-gray-100 bg-violet-50/50 px-4 py-4">
                    {aiLoading && (
                      <div className="flex items-center gap-2 text-sm text-violet-600">
                        <svg
                          className="h-4 w-4 animate-spin"
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                          />
                        </svg>
                        Thinking...
                      </div>
                    )}
                    {aiResponse && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-1.5 text-xs font-medium text-violet-700">
                            <SparklesIcon className="h-3.5 w-3.5" />
                            AI Response
                          </div>
                          <button
                            onClick={() => setAiResponse(null)}
                            className="text-xs text-violet-500 hover:text-violet-700 font-medium"
                          >
                            Close
                          </button>
                        </div>
                        <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                          {aiResponse}
                        </p>
                      </div>
                    )}
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
