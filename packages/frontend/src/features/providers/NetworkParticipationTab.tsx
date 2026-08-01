/**
 * Network Participation tab (Phase 1 — internal admin/staff only).
 * Payer-directory participation from Defacto Health, grouped LOB → carrier →
 * expandable plan lists, anchored to the practice's state. Real practitioners
 * carry thousands of (plan × relationship) pairings, so the view aggregates;
 * the full per-pairing detail stays in defacto_plan_records.
 *
 * The tab itself is only rendered for internal roles (see ProviderDetail),
 * and the backing routes reject practice-facing roles regardless.
 */
import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { ChevronRightIcon, ArrowTopRightOnSquareIcon, HomeIcon } from '@heroicons/react/24/outline';
import { useDefactoSnapshot, useDefactoCheck, type DefactoPlanRecord } from '../../hooks/useDefacto';

const ALL_STATES = '__all__';
const UNKNOWN_STATE = '__unknown__';

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

// Official public find-a-provider pages, researched + verified 2026-08-01 for
// every carrier observed in Defacto data. Defacto's payload carries no URLs of
// its own. Some carriers ask for a plan type before showing the search box —
// that's their site design, not ours. Unknown carriers fall back to a search.
const CARRIER_DIRECTORIES: Record<string, string> = {
  'aetna': 'https://www.aetna.com/individuals-families/find-a-doctor.html',
  'blue cross blue shield of michigan': 'https://www.bcbsm.com/find-a-doctor/',
  'blue cross and blue shield of kansas city': 'https://www.bluekc.com/find-care/doctors-hospitals/',
  'cms medicare': 'https://www.medicare.gov/care-compare/',
  'centene': 'https://www.ambetterhealth.com/en/find-a-provider/',
  'cigna': 'https://hcpdirectory.cigna.com/',
  'elevance': 'https://www.anthem.com/find-care/',
  'hcsc': 'https://www.bcbsil.com/find-care/find-a-doctor-or-hospital',
  'humana': 'https://finder.humana.com/finder/medical',
  'mo state medicaid': 'https://apps.dss.mo.gov/fmsmedicaidprovidersearch/',
  'medica': 'https://www.medica.com/find-care',
  'molina': 'https://providersearch.molinahealthcare.com/',
  'oscar': 'https://www.hioscar.com/care-options',
  'providence health plan': 'https://phppd.providence.org/',
  'regence health plans': 'https://www.regence.com/fwd/finding-doctors',
  'united healthcare': 'https://www.uhc.com/find-a-doctor',
  'wellfirst health': 'https://www.mo-central.medica.com/find-a-doctor',
};

function directoryUrl(providerName: string, carrier: string): string {
  return (
    CARRIER_DIRECTORIES[carrier.toLowerCase()] ??
    `https://www.google.com/search?q=${encodeURIComponent(`${carrier} provider directory "${providerName}"`)}`
  );
}

function errorMessageFrom(error: unknown): string {
  const maybe = error as { response?: { data?: { error?: { message?: string } } } };
  return maybe.response?.data?.error?.message || 'Could not check network participation. Try again in a minute.';
}

interface Props {
  providerId: string;
  providerName: string;
  /** State of the Lanyard practice this provider belongs to (e.g. "GA"). */
  practiceState: string | null;
}

export default function NetworkParticipationTab({ providerId, providerName, practiceState }: Props) {
  const { data: snapshot, isLoading } = useDefactoSnapshot(providerId);
  const check = useDefactoCheck(providerId);
  // Geography anchors to the practice: the home-state chip is selected by
  // default; ALL_STATES / UNKNOWN_STATE are chip sentinels, not real codes.
  const [selectedState, setSelectedState] = useState<string>(practiceState ?? ALL_STATES);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [locationsOpen, setLocationsOpen] = useState(false);

  const records = useMemo(
    () => (snapshot?.status === 'found' ? snapshot.planRecords : []),
    [snapshot]
  );
  // One chip per state with its unique-plan count; home state pinned first,
  // "State unknown" (no location in Defacto's data) and "All states" last.
  const stateChips = useMemo(() => {
    const perState = new Map<string, Set<string>>();
    const unknown = new Set<string>();
    const all = new Set<string>();
    for (const r of records) {
      const plan = `${r.carrierName}|${r.carrierOrPlanName}`;
      all.add(plan);
      if (r.locationState) {
        const set = perState.get(r.locationState) ?? new Set<string>();
        set.add(plan);
        perState.set(r.locationState, set);
      } else {
        unknown.add(plan);
      }
    }
    const chips = [...perState.entries()].map(([state, plans]) => ({
      key: state,
      label: state,
      count: plans.size,
      home: state === practiceState,
    }));
    chips.sort(
      (a, b) => Number(b.home) - Number(a.home) || b.count - a.count || a.label.localeCompare(b.label)
    );
    if (practiceState && !perState.has(practiceState)) {
      chips.unshift({ key: practiceState, label: practiceState, count: 0, home: true });
    }
    if (unknown.size > 0) {
      chips.push({ key: UNKNOWN_STATE, label: 'State unknown', count: unknown.size, home: false });
    }
    chips.push({ key: ALL_STATES, label: 'All states', count: all.size, home: false });
    return chips;
  }, [records, practiceState]);

  const visible = useMemo(() => {
    if (selectedState === ALL_STATES) return records;
    if (selectedState === UNKNOWN_STATE) return records.filter((r) => !r.locationState);
    return records.filter((r) => r.locationState === selectedState);
  }, [records, selectedState]);
  const groups = useMemo(() => aggregate(visible), [visible]);
  const locations = useMemo(() => uniqueLocations(visible), [visible]);
  const totalPlans = groups.reduce((n, g) => n + g.planCount, 0);
  const carrierCount = new Set(visible.map((r) => r.carrierName || 'Other carriers')).size;
  const whereLabel =
    selectedState === ALL_STATES
      ? 'in all states'
      : selectedState === UNKNOWN_STATE
        ? 'with no state listed'
        : `in ${selectedState}`;

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
        setSelectedState(practiceState ?? ALL_STATES);
        setExpanded(new Set());
        toast.success(
          result.status === 'found'
            ? 'Network participation updated'
            : 'Checked — this NPI is not in the payer directory data'
        );
      },
      onError: (error) => toast.error(errorMessageFrom(error)),
    });

  const refreshButton = (label: string) => (
    <button
      onClick={runCheck}
      disabled={check.isPending}
      className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-xl shadow-sm hover:bg-primary-700 active:scale-[0.98] transition disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
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
        label
      )}
    </button>
  );

  if (isLoading) {
    return (
      <div className="card card-body space-y-3 animate-pulse">
        <div className="h-4 bg-gray-100 rounded w-1/3" />
        <div className="h-3 bg-gray-100 rounded w-2/3" />
        <div className="h-3 bg-gray-100 rounded w-1/2" />
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="card card-body max-w-xl animate-fade-in">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Network participation</h2>
        <p className="text-sm text-gray-600 mb-4">
          See which payer networks list this provider as participating, based on payer
          directory data.
        </p>
        {refreshButton('Check network participation')}
        <p className="text-[11px] leading-4 text-gray-400 mt-4">{SOURCE_CAPTION}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          {snapshot.status === 'found' ? (
            visible.length > 0 ? (
              <p className="text-lg font-semibold text-gray-900">
                {totalPlans.toLocaleString()} plans across {carrierCount}{' '}
                {carrierCount === 1 ? 'carrier' : 'carriers'} {whereLabel}
              </p>
            ) : (
              <p className="text-lg font-semibold text-gray-900">
                No listings {whereLabel} yet
              </p>
            )
          ) : (
            <p className="text-lg font-semibold text-gray-900">Network participation</p>
          )}
          <p className="text-sm text-gray-500 mt-0.5">
            Last checked {format(new Date(snapshot.fetchedAt), 'MMM d, yyyy')}
          </p>
        </div>
        {refreshButton('Refresh')}
      </div>

      {snapshot.status === 'found' && records.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {stateChips.map((chip) => {
            const isSelected = selectedState === chip.key;
            return (
              <button
                key={chip.key}
                onClick={() => setSelectedState(chip.key)}
                aria-pressed={isSelected}
                className={clsx(
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
                  isSelected
                    ? 'bg-primary-700 text-white'
                    : 'bg-white text-gray-700 ring-1 ring-inset ring-gray-200 hover:ring-gray-300'
                )}
              >
                {chip.home && <HomeIcon className="h-3 w-3" />}
                {chip.label}
                <span className={clsx('font-normal', isSelected ? 'text-white/60' : 'text-gray-400')}>
                  {chip.count.toLocaleString()}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {snapshot.status === 'not_found' && (
        <div className="card card-body max-w-xl">
          <p className="text-sm text-gray-600">
            This NPI does not appear in Defacto&apos;s payer directory data.
          </p>
        </div>
      )}

      {snapshot.status === 'error' && (
        <div className="card card-body max-w-xl">
          <p className="text-sm text-gray-600">
            The last check didn&apos;t go through
            {snapshot.errorMessage ? ` (${snapshot.errorMessage.toLowerCase().replace(/\.$/, '')})` : ''}.
            Use Refresh to try again.
          </p>
        </div>
      )}

      {snapshot.status === 'found' && visible.length === 0 && records.length > 0 && (
        <div className="card card-body max-w-xl">
          <p className="text-sm text-gray-600">
            Nothing is listed {whereLabel}. The chips above show where this provider does
            appear in payer directories.
          </p>
        </div>
      )}

      {snapshot.status === 'found' &&
        groups.map((group) => (
          <div key={group.family}>
            <h2
              className={clsx(
                'text-sm font-semibold mb-2',
                group.family === 'Uncategorized' ? 'text-gray-500' : 'text-gray-900'
              )}
              title={
                group.family === 'Uncategorized'
                  ? "The payer's data doesn't say which line of business these plans belong to"
                  : undefined
              }
            >
              {group.family}
              <span className="ml-1.5 font-normal text-gray-400">
                {group.planCount} {group.planCount === 1 ? 'plan' : 'plans'}
              </span>
            </h2>
            <div className="card divide-y divide-gray-100">
              {group.carriers.map(({ carrier, plans }) => {
                const key = `${group.family}|${carrier}`;
                const open = expanded.has(key);
                return (
                  <div key={key} className="px-4 transition-colors hover:bg-gray-50/70">
                    <div className="py-3 flex items-center justify-between gap-3">
                      <button
                        onClick={() => toggleCarrier(key)}
                        aria-expanded={open}
                        className="flex flex-1 items-center gap-2 text-left rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                      >
                        <ChevronRightIcon
                          className={clsx(
                            'h-4 w-4 text-gray-400 transition-transform duration-200',
                            open && 'rotate-90'
                          )}
                        />
                        <span className="text-sm font-medium text-gray-900">{carrier}</span>
                        <span className="text-xs text-gray-500">
                          {plans.length} {plans.length === 1 ? 'plan' : 'plans'}
                        </span>
                      </button>
                      <a
                        href={directoryUrl(providerName, carrier)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-800 shrink-0 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                        title={`Open ${carrier}'s public provider directory to confirm this listing`}
                      >
                        Open directory
                        <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
                      </a>
                    </div>
                    {open && (
                      <ul className="animate-fade-in pb-3 pl-6 max-h-64 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-1">
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

      {snapshot.status === 'found' && locations.length > 0 && (
        <div>
          <button
            onClick={() => setLocationsOpen((v) => !v)}
            aria-expanded={locationsOpen}
            className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <ChevronRightIcon
              className={clsx(
                'h-4 w-4 text-gray-400 transition-transform duration-200',
                locationsOpen && 'rotate-90'
              )}
            />
            Organizations &amp; locations
            <span className="font-normal text-gray-400">({locations.length})</span>
          </button>
          {locationsOpen && (
            <div className="card card-body mt-2 animate-fade-in">
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
                {locations.map((line) => (
                  <li key={line} className="text-xs text-gray-600">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <p className="text-[11px] leading-4 text-gray-400 border-t border-gray-100 pt-3">
        {SOURCE_CAPTION}
      </p>
    </div>
  );
}
