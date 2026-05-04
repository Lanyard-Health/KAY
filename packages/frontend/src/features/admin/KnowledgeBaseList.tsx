import { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { MagnifyingGlassIcon, PlusIcon, FunnelIcon, SparklesIcon } from '@heroicons/react/24/outline';
import { usePayerTracks, useFilterOptions, useKnowledgeBaseSearch } from '../../hooks/useKnowledgeBase';
import type { PayerTrack, PayerTrackFilters, KbSearchResult } from '../../hooks/useKnowledgeBase';
import PageTransition from '../../components/ui/PageTransition';
import EmptyState from '../../components/ui/EmptyState';
import clsx from 'clsx';

type SearchMode = 'filter' | 'semantic';

function getSourceLabel(r: KbSearchResult): { type: string; payerTrackId: string | null } {
  if (r.payerTrackId && !r.payerRequirementId && !r.payerStateRuleId && !r.payerTimelineId && !r.payerFormId) {
    return { type: 'Payer Track', payerTrackId: r.payerTrackId };
  }
  if (r.payerRequirementId) return { type: 'Requirement', payerTrackId: r.payerTrackId };
  if (r.payerStateRuleId) return { type: 'State Rule', payerTrackId: r.payerTrackId };
  if (r.payerTimelineId) return { type: 'Timeline', payerTrackId: r.payerTrackId };
  if (r.payerFormId) return { type: 'Form', payerTrackId: r.payerTrackId };
  if (r.requirementUniversalId) return { type: 'Universal Requirement', payerTrackId: null };
  return { type: 'Unknown', payerTrackId: null };
}

function getSourceTitle(r: KbSearchResult): string {
  const src = r.source as Record<string, unknown> | null;
  if (!src) return r.contentText.slice(0, 80);
  if (typeof src['payerName'] === 'string' && typeof src['track'] === 'string') {
    return `${src['payerName']} — ${src['track']}`;
  }
  if (typeof src['name'] === 'string') return src['name'] as string;
  if (typeof src['description'] === 'string') return (src['description'] as string).slice(0, 80);
  if (typeof src['formName'] === 'string') return src['formName'] as string;
  if (typeof src['processType'] === 'string') return src['processType'] as string;
  return r.contentText.slice(0, 80);
}

function getCompleteness(track: PayerTrack) {
  const counts = track._count;
  if (!counts) return 'gaps';
  const hasContacts = counts.contacts > 0;
  const hasTimelines = counts.timelines > 0;
  const hasRequirements = counts.requirements > 0;
  if (hasContacts && hasTimelines && hasRequirements) return 'complete';
  if (hasContacts || hasTimelines || hasRequirements) return 'partial';
  return 'gaps';
}

const completenessBadge = {
  complete: { label: 'Complete', className: 'bg-green-100 text-green-800' },
  partial: { label: 'Partial', className: 'bg-yellow-100 text-yellow-800' },
  gaps: { label: 'Gaps', className: 'bg-red-100 text-red-800' },
} as const;

export default function KnowledgeBaseList() {
  const navigate = useNavigate();

  // Search mode + input
  const [mode, setMode] = useState<SearchMode>('filter');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Semantic search — only fires in semantic mode and when query >= 3 chars
  const { data: semanticResults, isFetching: isSearching } = useKnowledgeBaseSearch(
    mode === 'semantic' ? debouncedSearch : '',
    20,
  );

  // Filters
  const [payerType, setPayerType] = useState('');
  const [stateRegion, setStateRegion] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);

  const filters = useMemo<PayerTrackFilters>(() => {
    const f: PayerTrackFilters = {};
    if (mode === 'filter' && debouncedSearch) f.search = debouncedSearch;
    if (payerType) f.payerType = payerType;
    if (stateRegion) f.stateRegion = stateRegion;
    if (activeOnly) f.isActive = true;
    return f;
  }, [mode, debouncedSearch, payerType, stateRegion, activeOnly]);

  const { data: tracks, isLoading } = usePayerTracks(filters);
  const { data: filterOptions } = useFilterOptions();

  if (isLoading) {
    return (
      <div>
        <div className="sm:flex sm:items-center sm:justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Knowledge Base</h1>
            <p className="mt-1 text-sm text-gray-500">Payer enrollment tracks and requirements</p>
          </div>
        </div>
        <div className="card overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50/80">
              <tr>
                {['Payer Name', 'Track', 'State/Region', 'Type', 'Submission', 'Completeness', 'Status'].map((h) => (
                  <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {[...Array(5)].map((_, i) => (
                <tr key={i} className="animate-pulse">
                  <td className="px-6 py-4"><div className="h-4 w-36 bg-gray-200 rounded" /></td>
                  <td className="px-6 py-4"><div className="h-4 w-24 bg-gray-200 rounded" /></td>
                  <td className="px-6 py-4"><div className="h-4 w-20 bg-gray-200 rounded" /></td>
                  <td className="px-6 py-4"><div className="h-4 w-20 bg-gray-200 rounded" /></td>
                  <td className="px-6 py-4"><div className="h-4 w-16 bg-gray-200 rounded" /></td>
                  <td className="px-6 py-4"><div className="h-5 w-20 bg-gray-200 rounded-full" /></td>
                  <td className="px-6 py-4"><div className="h-3 w-3 bg-gray-200 rounded-full" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <PageTransition>
      <div>
        {/* Header */}
        <div className="sm:flex sm:items-center sm:justify-between mb-8">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">Knowledge Base</h1>
            {tracks && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-800">
                {tracks.length}
              </span>
            )}
          </div>
          <Link to="/admin/knowledge-base/new" className="btn-primary mt-4 sm:mt-0 inline-flex items-center">
            <PlusIcon className="-ml-1 mr-2 h-5 w-5" />
            Add Payer Track
          </Link>
        </div>

        {/* Search bar with mode toggle */}
        <div className="mb-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              {mode === 'filter' ? (
                <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
              ) : (
                <SparklesIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-primary-500" />
              )}
              <input
                type="text"
                placeholder={mode === 'filter'
                  ? 'Search by payer name, track, or state...'
                  : 'Ask anything — e.g. "what payers require NPI verification in Texas?"'}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-3 text-sm placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
            <button
              type="button"
              onClick={() => setMode(mode === 'filter' ? 'semantic' : 'filter')}
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                mode === 'semantic'
                  ? 'border-primary-300 bg-primary-50 text-primary-700'
                  : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
              )}
              title={mode === 'semantic' ? 'Switch back to text filter' : 'Switch to AI semantic search'}
            >
              <SparklesIcon className="h-4 w-4" />
              {mode === 'semantic' ? 'AI Search' : 'AI Search'}
            </button>
          </div>
          {mode === 'semantic' && (
            <p className="mt-1.5 text-xs text-gray-500">
              Searches embeddings across all payer tracks, requirements, state rules, timelines, and forms.
            </p>
          )}
        </div>

        {/* Filter row (hidden in semantic mode — filters don't apply to semantic results) */}
        <div className={clsx('mb-6 flex flex-wrap items-center gap-3', mode === 'semantic' && 'hidden')}>
          <FunnelIcon className="h-5 w-5 text-gray-400" />

          <select
            value={payerType}
            onChange={(e) => setPayerType(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white py-1.5 px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            <option value="">All Types</option>
            {filterOptions?.payerTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>

          <select
            value={stateRegion}
            onChange={(e) => setStateRegion(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white py-1.5 px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            <option value="">All States/Regions</option>
            {filterOptions?.stateRegions.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          <button
            onClick={() => setActiveOnly(!activeOnly)}
            className={clsx(
              'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
              activeOnly
                ? 'border-primary-300 bg-primary-50 text-primary-700'
                : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
            )}
          >
            {activeOnly ? 'Active Only' : 'All'}
          </button>
        </div>

        {/* Semantic results (when in semantic mode) */}
        {mode === 'semantic' && (
          debouncedSearch.trim().length < 3 ? (
            <div className="card card-body text-center py-10">
              <SparklesIcon className="mx-auto h-10 w-10 text-gray-300" />
              <p className="mt-2 text-sm font-medium text-gray-500">Type at least 3 characters to search</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Semantic search finds matches by meaning, not just keywords.
              </p>
            </div>
          ) : isSearching ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="card card-body animate-pulse">
                  <div className="h-4 w-1/3 bg-gray-200 rounded mb-2" />
                  <div className="h-3 w-full bg-gray-200 rounded" />
                  <div className="h-3 w-2/3 bg-gray-200 rounded mt-1" />
                </div>
              ))}
            </div>
          ) : !semanticResults || semanticResults.length === 0 ? (
            <EmptyState
              illustration="search"
              title="No matches"
              description="Try rephrasing your question or adjusting the wording."
            />
          ) : (
            <div className="space-y-2">
              {semanticResults.map((r) => {
                const { type, payerTrackId } = getSourceLabel(r);
                const title = getSourceTitle(r);
                const similarityPct = Math.round(r.similarity * 100);
                const clickable = !!payerTrackId;
                return (
                  <div
                    key={r.id}
                    onClick={clickable ? () => navigate(`/admin/knowledge-base/${payerTrackId}`) : undefined}
                    className={clsx(
                      'card card-body transition-colors',
                      clickable && 'cursor-pointer hover:bg-gray-50'
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-gray-900">{title}</span>
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary-50 text-primary-700">
                            {type}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-gray-500 line-clamp-2">{r.contentText}</p>
                      </div>
                      <div className="flex flex-col items-end shrink-0">
                        <span className={clsx(
                          'text-xs font-semibold tabular-nums',
                          similarityPct >= 70 ? 'text-green-600'
                            : similarityPct >= 50 ? 'text-amber-600'
                            : 'text-gray-500'
                        )}>
                          {similarityPct}% match
                        </span>
                        {clickable && (
                          <span className="text-[10px] text-gray-400 mt-0.5">click to open</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}

        {/* Table or empty state (filter mode) */}
        {mode === 'filter' && (!tracks || tracks.length === 0 ? (
          <EmptyState
            illustration="search"
            title="No payer tracks found"
            description={debouncedSearch || payerType || stateRegion
              ? 'Try adjusting your search or filters.'
              : 'Get started by adding your first payer track.'}
            action={!debouncedSearch && !payerType && !stateRegion
              ? { label: 'Add Payer Track', onClick: () => navigate('/admin/knowledge-base/new') }
              : undefined}
          />
        ) : (
          <div className="card overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50/80">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Payer Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Track
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    State/Region
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Submission
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Completeness
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {tracks.map((track) => {
                  const completeness = getCompleteness(track);
                  const badge = completenessBadge[completeness];
                  return (
                    <tr
                      key={track.id}
                      onClick={() => navigate(`/admin/knowledge-base/${track.id}`)}
                      className="hover:bg-gray-50 cursor-pointer transition-colors"
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <p className="text-sm font-medium text-gray-900">{track.payerName}</p>
                        {track.parentOrg && (
                          <p className="text-xs text-gray-500">{track.parentOrg}</p>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                        {track.track}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {track.stateRegion}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {track.payerType}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {track.submissionMethod}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={clsx(
                          'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                          badge.className
                        )}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={clsx(
                          'inline-block h-2.5 w-2.5 rounded-full',
                          track.isActive ? 'bg-green-500' : 'bg-gray-300'
                        )} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </PageTransition>
  );
}
