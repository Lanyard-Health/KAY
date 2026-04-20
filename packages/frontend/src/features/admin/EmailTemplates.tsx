import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EnvelopeIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';
import PageTransition from '../../components/ui/PageTransition';
import EmptyState from '../../components/ui/EmptyState';
import {
  useAdminEmailTemplates,
  type EmailTemplate,
  type EmailTemplateType,
} from '../../hooks/useEmailTemplates';

type FilterTab = 'all' | EmailTemplateType;

const TABS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'AUTOMATED_ONBOARDING', label: 'Automated' },
  { key: 'STATIC_ON_DEMAND', label: 'On-demand' },
];

function formatDate(d?: string) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function EmailTemplates() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<FilterTab>('all');
  const filterType = tab === 'all' ? undefined : tab;
  const { data: templates, isLoading } = useAdminEmailTemplates(filterType);

  const rows = useMemo<EmailTemplate[]>(() => templates ?? [], [templates]);
  const activeCount = rows.filter((r) => r.isActive).length;

  return (
    <PageTransition>
      <div>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Email Templates</h1>
          <p className="mt-1 text-sm text-gray-500">
            Edit the wording of every transactional email the platform sends.
          </p>
        </div>

        <div className="mb-6 border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={clsx(
                  'whitespace-nowrap py-3 px-1 border-b-2 text-sm font-medium',
                  tab === t.key
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                )}
              >
                {t.label}
              </button>
            ))}
            <span className="ml-auto self-center text-xs text-gray-400">
              {activeCount} active · {rows.length - activeCount} inactive
            </span>
          </nav>
        </div>

        {isLoading ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 overflow-hidden animate-pulse">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="px-6 py-4 border-b border-gray-100 flex gap-6">
                <div className="h-4 w-52 bg-gray-200 rounded" />
                <div className="h-4 w-80 bg-gray-200 rounded" />
                <div className="h-4 w-24 bg-gray-200 rounded" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 py-12">
            <EmptyState
              illustration="people"
              title="No templates"
              description="No email templates match this filter."
            />
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50/80">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Subject</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Trigger</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {rows.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => navigate(`/admin/email-templates/${t.id}`)}
                    className="cursor-pointer hover:bg-gray-50"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                        <EnvelopeIcon className="h-4 w-4 text-gray-400" />
                        {t.name}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 max-w-md truncate">
                      {t.subject}
                    </td>
                    <td className="px-6 py-4 text-xs text-gray-500">
                      {t.type === 'AUTOMATED_ONBOARDING' ? 'Automated' : 'On-demand'}
                    </td>
                    <td className="px-6 py-4 text-xs text-gray-500">
                      {t.triggerEvent ?? '—'}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={clsx(
                          'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                          t.isActive
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-700'
                        )}
                      >
                        {t.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-xs text-gray-500">
                      {formatDate(t.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageTransition>
  );
}
