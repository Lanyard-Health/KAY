import { useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { EnvelopeIcon } from '@heroicons/react/24/outline';
import { useEmailTemplates, type EmailTemplate } from '../../hooks/useEmailTemplates';
import { useSentHistory, type SentHistoryItem } from '../../hooks/useSettings';
import { usePractices } from '../../hooks/usePractices';
import { useAuthStore } from '../../stores/auth.store';

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function TemplateCard({ template, showTrigger }: { template: EmailTemplate; showTrigger?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const plainBody = stripHtml(template.body);
  const isLong = plainBody.length > 120;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-gray-900">{template.name}</h4>
          <p className="mt-0.5 text-sm text-gray-500 truncate">{template.subject}</p>
        </div>
        {showTrigger && template.triggerEvent && (
          <span className="inline-flex items-center flex-shrink-0 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
            {template.triggerEvent.replace(/_/g, ' ')}
          </span>
        )}
      </div>
      <div className="mt-3 text-sm text-gray-600 leading-relaxed">
        {expanded || !isLong ? plainBody : `${plainBody.slice(0, 120)}...`}
        {isLong && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="ml-1 text-primary-600 hover:text-primary-700 font-medium"
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    </div>
  );
}

const HISTORY_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'enrollments', label: 'Enrollments' },
  { key: 'reminders', label: 'Reminders' },
  { key: 'account', label: 'Account' },
] as const;

const STATUS_CHIP: Record<SentHistoryItem['status'], { label: string; className: string }> = {
  sent: { label: 'Sent', className: 'bg-green-50 text-green-700 ring-green-600/20' },
  failed: { label: 'Failed', className: 'bg-red-50 text-red-700 ring-red-600/20' },
  in_app: { label: 'In-app', className: 'bg-blue-50 text-blue-700 ring-blue-600/20' },
};

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const short = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (date.toDateString() === new Date().toDateString()) return `Today · ${short}`;
  return date.getFullYear() === new Date().getFullYear()
    ? short
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function SentHistorySection() {
  const user = useAuthStore((s) => s.user);
  const isStaff = ['admin', 'lanyard_staff', 'credentialing_staff'].includes(user?.role ?? '');
  const ownPracticeId = user?.practices?.[0]?.practiceId;

  const [selectedPracticeId, setSelectedPracticeId] = useState('');
  const { data: practices } = usePractices({ enabled: isStaff });
  const practiceId = isStaff ? selectedPracticeId || undefined : ownPracticeId;

  const [filter, setFilter] = useState<(typeof HISTORY_FILTERS)[number]['key']>('all');
  const { data: items, isLoading } = useSentHistory(practiceId);

  // Practice admins with no practice have nothing to show; staff always see the picker.
  if (!isStaff && !ownPracticeId) return null;

  const visible = (items ?? []).filter((i) => filter === 'all' || i.category === filter);
  const dayGroups: Array<{ day: string; rows: SentHistoryItem[] }> = [];
  for (const item of visible) {
    const day = dayLabel(item.createdAt);
    const group = dayGroups[dayGroups.length - 1];
    if (group && group.day === day) group.rows.push(item);
    else dayGroups.push({ day, rows: [item] });
  }

  return (
    <section>
      <h3 className="text-base font-semibold text-gray-900">Sent History</h3>
      <p className="mt-1 text-sm text-gray-500">
        Every email and in-app notification {isStaff ? 'this' : 'your'} practice has received from Lanyard · view only
      </p>

      {isStaff && (
        <select
          value={selectedPracticeId}
          onChange={(e) => setSelectedPracticeId(e.target.value)}
          className="mt-4 block w-full max-w-xs rounded-xl border-gray-200 text-sm focus:border-primary-500 focus:ring-primary-500"
        >
          <option value="">Select a practice…</option>
          {(practices ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}

      {practiceId && (
        <div className="mt-4 bg-white rounded-xl border border-gray-200">
          <div className="flex justify-end gap-2 px-5 py-3 border-b border-gray-100">
            {HISTORY_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={clsx(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  filter === f.key
                    ? 'border-primary-300 bg-primary-50 text-primary-700'
                    : 'border-gray-200 bg-white text-gray-500 hover:text-gray-700',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          {isLoading ? (
            <div className="space-y-3 p-5 animate-pulse">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-4 bg-gray-200 rounded w-3/4" />
              ))}
            </div>
          ) : dayGroups.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <EnvelopeIcon className="mx-auto h-8 w-8 text-gray-300" />
              <p className="mt-3 text-sm font-medium text-gray-900">Nothing has been sent yet.</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">
                When the practice is emailed about an approval, a denial, a submission, or an expiring document, it
                will appear here.
              </p>
            </div>
          ) : (
            dayGroups.map((group) => (
              <div key={group.day}>
                <p className="px-5 pt-4 pb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">
                  {group.day}
                </p>
                <ul className="divide-y divide-gray-100">
                  {group.rows.map((item) => {
                    const chip = STATUS_CHIP[item.status];
                    return (
                      <li key={`${item.channel}-${item.id}`} className="flex items-start gap-3 px-5 py-3">
                        <span
                          className={clsx(
                            'mt-0.5 inline-flex flex-none items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
                            chip.className,
                          )}
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-current" />
                          {chip.label}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-900">{item.subject}</p>
                          <p className="mt-0.5 text-sm text-gray-500">
                            {item.channel === 'email' ? 'Email to' : 'Shown in the portal to'}{' '}
                            {item.recipientName || item.recipientEmail || 'practice member'}
                            {item.recipientName && item.recipientEmail && (
                              <span className="text-gray-400"> · {item.recipientEmail}</span>
                            )}
                            {item.enrollmentId && (
                              <>
                                {' · '}
                                <Link
                                  to={`/enrollments/${item.enrollmentId}`}
                                  className="font-medium text-primary-600 hover:text-primary-700"
                                >
                                  View enrollment
                                </Link>
                              </>
                            )}
                          </p>
                          {item.status === 'failed' && (
                            <p className="mt-0.5 text-sm text-red-700">
                              The email couldn't be sent{item.errorMessage ? ` (${item.errorMessage})` : ''}. The
                              practice has not been notified.
                            </p>
                          )}
                        </div>
                        <span className="mt-0.5 flex-none text-xs tabular-nums text-gray-400">
                          {new Date(item.createdAt).toLocaleTimeString('en-US', {
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}

export default function CommunicationsTab() {
  const { data: onboarding, isLoading: loadingOnboarding } = useEmailTemplates('AUTOMATED_ONBOARDING');
  const { data: onDemand, isLoading: loadingOnDemand } = useEmailTemplates('STATIC_ON_DEMAND');

  if (loadingOnboarding || loadingOnDemand) {
    return (
      <div className="space-y-6 max-w-2xl">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse">
            <div className="h-4 w-48 bg-gray-200 rounded" />
            <div className="mt-2 h-3 w-64 bg-gray-200 rounded" />
            <div className="mt-3 h-3 w-full bg-gray-200 rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-2xl">
      {/* Automated Onboarding Emails */}
      <section>
        <h3 className="text-base font-semibold text-gray-900">Automated Onboarding Emails</h3>
        <p className="mt-1 text-sm text-gray-500">
          These emails are sent automatically when practices reach key milestones.
        </p>
        <div className="mt-4 space-y-3">
          {onboarding && onboarding.length > 0 ? (
            onboarding.map((t) => <TemplateCard key={t.id} template={t} showTrigger />)
          ) : (
            <p className="text-sm text-gray-400 italic">No automated onboarding templates configured.</p>
          )}
        </div>
      </section>

      {/* Other Communications */}
      <section>
        <h3 className="text-base font-semibold text-gray-900">Other Communications</h3>
        <p className="mt-1 text-sm text-gray-500">
          Templates used by staff for on-demand communications.
        </p>
        <div className="mt-4 space-y-3">
          {onDemand && onDemand.length > 0 ? (
            onDemand.map((t) => <TemplateCard key={t.id} template={t} />)
          ) : (
            <p className="text-sm text-gray-400 italic">No on-demand templates configured.</p>
          )}
        </div>
      </section>

      <SentHistorySection />
    </div>
  );
}
