import { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { MagnifyingGlassIcon, PlusIcon, FunnelIcon } from '@heroicons/react/24/outline';
import { usePayerTracks, useFilterOptions } from '../../hooks/useKnowledgeBase';
import type { PayerTrack, PayerTrackFilters } from '../../hooks/useKnowledgeBase';
import PageTransition from '../../components/ui/PageTransition';
import EmptyState from '../../components/ui/EmptyState';
import clsx from 'clsx';

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

  // Search with debounce
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Filters
  const [payerType, setPayerType] = useState('');
  const [stateRegion, setStateRegion] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);

  const filters = useMemo<PayerTrackFilters>(() => {
    const f: PayerTrackFilters = {};
    if (debouncedSearch) f.search = debouncedSearch;
    if (payerType) f.payerType = payerType;
    if (stateRegion) f.stateRegion = stateRegion;
    if (activeOnly) f.isActive = true;
    return f;
  }, [debouncedSearch, payerType, stateRegion, activeOnly]);

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

        {/* Search bar */}
        <div className="mb-4">
          <div className="relative">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search by payer name, track, or state..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-3 text-sm placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
        </div>

        {/* Filter row */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
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

        {/* Table or empty state */}
        {!tracks || tracks.length === 0 ? (
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
        )}
      </div>
    </PageTransition>
  );
}
