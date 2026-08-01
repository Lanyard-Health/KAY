/**
 * Network Participation panel (Phase 1 — internal admin/staff only).
 * Shows a provider's payer-directory participation from Defacto Health as
 * stored snapshots. Rendered only for internal roles in ProviderDetail's
 * sidebar; the backing routes reject practice-facing roles regardless.
 *
 * Real practitioners carry thousands of (plan × relationship) pairings, so the
 * panel aggregates: line of business → carrier (plan count) → expandable plan
 * names, with organizations/locations in their own expandable list. The full
 * per-pairing detail stays in the database (defacto_plan_records).
 */
import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { ChevronRightIcon } from '@heroicons/react/24/outline';
import { useDefactoSnapshot, useDefactoCheck, type DefactoPlanRecord } from '../hooks/useDefacto';

const SOURCE_CAPTION =
  'Sourced from payer directory and Transparency in Coverage data via Defacto Health, refreshed monthly. Directory data may lag actual participation status.';

// Defacto's lob field is a short code (e.g. "qhp", "commppo", "mediadvhmo"),
// frequently null. Fold codes into plain-English families for grouping.
function lobFamily(lob: string | null): string {
  if (!lob) return 'Uncategorized';
  const code = lob.toLowerCase();
  if (code.startsWith('comm')) return 'Commercial';
  if (code.startsWith('mediadv')) return 'Medicare Advantage';
  if (code.startsWith('medi')) return 'Medicare';
  if (code.includes('caid')) return 'Medicaid';
  if (code.startsWith('qhp')) return 'Marketplace';
  if (code.startsWith('dent')) return 'Dental';
  if (code.startsWith('vis')) return 'Vision';
  return lob.toUpperCase();
}

const FAMILY_ORDER = [
  'Commercial',
  'Medicare',
  'Medicare Advantage',
  'Medicaid',
  'Marketplace',
  'Dental',
  'Vision',
];

function familyRank(family: string): number {
  if (family === 'Uncategorized') return FAMILY_ORDER.length + 1;
  const i = FAMILY_ORDER.indexOf(family);
  return i === -1 ? FAMILY_ORDER.length : i;
}

interface CarrierGroup {
  carrier: string;
  plans: string[];
}

interface FamilyGroup {
  family: string;
  planCount: number;
  carriers: CarrierGroup[];
}

function aggregate(records: DefactoPlanRecord[]): FamilyGroup[] {
  const families = new Map<string, Map<string, Set<string>>>();
  for (const record of records) {
    const family = lobFamily(record.lob);
    const carrier = record.carrierName || 'Other carriers';
    const byCarrier = families.get(family) ?? new Map<string, Set<string>>();
    const plans = byCarrier.get(carrier) ?? new Set<string>();
    plans.add(record.carrierOrPlanName);
    byCarrier.set(carrier, plans);
    families.set(family, byCarrier);
  }
  return [...families.entries()]
    .map(([family, byCarrier]) => {
      const carriers = [...byCarrier.entries()]
        .map(([carrier, plans]) => ({ carrier, plans: [...plans].sort() }))
        .sort((a, b) => b.plans.length - a.plans.length || a.carrier.localeCompare(b.carrier));
      return {
        family,
        planCount: carriers.reduce((n, c) => n + c.plans.length, 0),
        carriers,
      };
    })
    .sort((a, b) => familyRank(a.family) - familyRank(b.family) || a.family.localeCompare(b.family));
}

function uniqueLocations(records: DefactoPlanRecord[]): string[] {
  const set = new Set<string>();
  for (const r of records) {
    const place = [r.locationCity, r.locationState].filter(Boolean).join(', ');
    const line = [r.organizationName, place].filter(Boolean).join(' · ');
    if (line) set.add(line);
  }
  return [...set].sort();
}

function errorMessageFrom(error: unknown): string {
  const maybe = error as { response?: { data?: { error?: { message?: string } } } };
  return maybe.response?.data?.error?.message || 'Could not check network participation. Try again in a minute.';
}

interface Props {
  providerId: string;
  /** State of the Lanyard practice this provider belongs to (e.g. "GA"). */
  practiceState: string | null;
}

export default function NetworkParticipationCard({ providerId, practiceState }: Props) {
  const { data: snapshot, isLoading } = useDefactoSnapshot(providerId);
  const check = useDefactoCheck(providerId);
  const [showAllStates, setShowAllStates] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [locationsOpen, setLocationsOpen] = useState(false);

  const records = useMemo(
    () => (snapshot?.status === 'found' ? snapshot.planRecords : []),
    [snapshot]
  );
  // Geography anchors to the practice: in-state rows are the primary view,
  // everything else (including unknown-state rows) sits behind the toggle.
  const inState = useMemo(
    () => (practiceState ? records.filter((r) => r.locationState === practiceState) : records),
    [records, practiceState]
  );
  const visible = showAllStates || !practiceState ? records : inState;
  const groups = useMemo(() => aggregate(visible), [visible]);
  const locations = useMemo(() => uniqueLocations(visible), [visible]);
  const totalPlans = groups.reduce((n, g) => n + g.planCount, 0);
  const carrierCount = new Set(visible.map((r) => r.carrierName || 'Other carriers')).size;
  const hiddenPlanCount = useMemo(() => {
    if (!practiceState) return 0;
    const shown = new Set(inState.map((r) => `${r.carrierName}|${r.carrierOrPlanName}`));
    return new Set(
      records
        .filter((r) => !shown.has(`${r.carrierName}|${r.carrierOrPlanName}`))
        .map((r) => `${r.carrierName}|${r.carrierOrPlanName}`)
    ).size;
  }, [records, inState, practiceState]);

  const toggleCarrier = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const runCheck = () =>
    check.mutate(undefined, {
      onSuccess: (result) => {
        setShowAllStates(false);
        setExpanded(new Set());
        toast.success(
          result.status === 'found'
            ? 'Network participation updated'
            : 'Checked — this NPI is not in the payer directory data'
        );
      },
      onError: (error) => toast.error(errorMessageFrom(error)),
    });

  return (
    <div className="card">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider">
          Network Participation
        </h3>
        {snapshot && (
          <button
            onClick={runCheck}
            disabled={check.isPending}
            className="text-xs font-medium text-primary-600 hover:text-primary-800 disabled:opacity-50"
          >
            {check.isPending ? 'Refreshing...' : 'Refresh'}
          </button>
        )}
      </div>

      <div className="px-4 py-3 space-y-3">
        {isLoading ? (
          <div className="space-y-2 animate-pulse">
            <div className="h-3 bg-gray-100 rounded w-3/4" />
            <div className="h-3 bg-gray-100 rounded w-1/2" />
          </div>
        ) : !snapshot ? (
          <>
            <p className="text-sm text-gray-600">
              See which payer networks list this provider as participating, based on payer
              directory data.
            </p>
            <button
              onClick={runCheck}
              disabled={check.isPending}
              className="w-full px-3 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {check.isPending ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Checking...
                </span>
              ) : (
                'Check network participation'
              )}
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">Last checked</span>
              <span className="text-sm text-gray-900">
                {format(new Date(snapshot.fetchedAt), 'MMM d, yyyy')}
              </span>
            </div>

            {snapshot.status === 'not_found' && (
              <p className="text-sm text-gray-600">
                This NPI does not appear in Defacto&apos;s payer directory data.
              </p>
            )}

            {snapshot.status === 'error' && (
              <p className="text-sm text-gray-600">
                The last check didn&apos;t go through
                {snapshot.errorMessage ? ` (${snapshot.errorMessage.toLowerCase().replace(/\.$/, '')})` : ''}.
                Use Refresh to try again.
              </p>
            )}

            {snapshot.status === 'found' && (
              <>
                {visible.length > 0 ? (
                  <p className="text-sm text-gray-600">
                    {totalPlans.toLocaleString()} plans across {carrierCount}{' '}
                    {carrierCount === 1 ? 'carrier' : 'carriers'}
                    {practiceState && !showAllStates ? ` in ${practiceState}` : ' in all states'}
                  </p>
                ) : (
                  <p className="text-sm text-gray-600">
                    No listings in {practiceState} yet
                    {records.length > 0
                      ? `, but ${hiddenPlanCount.toLocaleString()} plans in other states.`
                      : '.'}
                  </p>
                )}

                <div className="space-y-3">
                  {groups.map((group) => (
                    <div key={group.family}>
                      <h4 className="text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-1">
                        {group.family}
                        <span className="ml-1 normal-case tracking-normal">({group.planCount})</span>
                      </h4>
                      <div className="divide-y divide-gray-50">
                        {group.carriers.map(({ carrier, plans }) => {
                          const key = `${group.family}|${carrier}`;
                          const open = expanded.has(key);
                          return (
                            <div key={key}>
                              <button
                                onClick={() => toggleCarrier(key)}
                                aria-expanded={open}
                                className="w-full py-1.5 flex items-center justify-between text-left hover:bg-gray-50 rounded"
                              >
                                <span className="flex items-center gap-1 text-sm font-medium text-gray-900">
                                  <ChevronRightIcon
                                    className={clsx(
                                      'h-3 w-3 text-gray-400 transition-transform duration-200',
                                      open && 'rotate-90'
                                    )}
                                  />
                                  {carrier}
                                </span>
                                <span className="text-xs text-gray-500">
                                  {plans.length} {plans.length === 1 ? 'plan' : 'plans'}
                                </span>
                              </button>
                              {open && (
                                <ul className="ml-4 mb-2 max-h-48 overflow-y-auto space-y-1">
                                  {plans.map((plan) => (
                                    <li key={plan} className="text-xs text-gray-600">
                                      {plan}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                {locations.length > 0 && (
                  <div>
                    <button
                      onClick={() => setLocationsOpen((v) => !v)}
                      aria-expanded={locationsOpen}
                      className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700"
                    >
                      <ChevronRightIcon
                        className={clsx(
                          'h-3 w-3 transition-transform duration-200',
                          locationsOpen && 'rotate-90'
                        )}
                      />
                      Organizations &amp; locations ({locations.length})
                    </button>
                    {locationsOpen && (
                      <ul className="mt-1.5 ml-4 max-h-48 overflow-y-auto space-y-1">
                        {locations.map((line) => (
                          <li key={line} className="text-xs text-gray-600">
                            {line}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {practiceState && (records.length > inState.length || showAllStates) && (
                  <button
                    onClick={() => setShowAllStates((v) => !v)}
                    className="text-xs font-medium text-primary-600 hover:text-primary-800"
                  >
                    {showAllStates
                      ? `Show ${practiceState} only`
                      : `Show all states (${hiddenPlanCount.toLocaleString()} more plans)`}
                  </button>
                )}
              </>
            )}
          </>
        )}

        <p className="text-[11px] leading-4 text-gray-400 border-t border-gray-100 pt-2">
          {SOURCE_CAPTION}
        </p>
      </div>
    </div>
  );
}
