import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeftIcon, EyeIcon, PencilIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import PageTransition from '../../components/ui/PageTransition';
import ErrorState from '../../components/ui/ErrorState';
import {
  useAdminEmailTemplate,
  useUpdateEmailTemplate,
  renderTemplatePreview,
  extractVariables,
  type EmailTemplateType,
} from '../../hooks/useEmailTemplates';

// Sample variable values used for the inline preview. Matches the common
// placeholder keys seen in seeded templates.
const SAMPLE_VARS: Record<string, string> = {
  practiceName: 'Sunrise Behavioral Health',
  providerName: 'Dr. Jane Smith',
  firstName: 'Jane',
  lastName: 'Smith',
  npi: '1234567890',
  payerName: 'Aetna',
  submissionDate: 'March 15, 2026',
  documentList: '• W-9\n• COI\n• Driver\'s license',
  portalUrl: 'https://app.lanyardhealth.com',
  supportEmail: 'support@lanyardhealth.com',
};

export default function EmailTemplateDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: template, isLoading, error, refetch } = useAdminEmailTemplate(id);
  const updateMutation = useUpdateEmailTemplate();

  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [type, setType] = useState<EmailTemplateType>('STATIC_ON_DEMAND');
  const [triggerEvent, setTriggerEvent] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');

  useEffect(() => {
    if (!template) return;
    setName(template.name);
    setSubject(template.subject);
    setBody(template.body);
    setType(template.type);
    setTriggerEvent(template.triggerEvent ?? '');
    setIsActive(template.isActive);
  }, [template]);

  const variables = useMemo(() => extractVariables({ subject, body }), [subject, body]);
  const renderedSubject = useMemo(() => renderTemplatePreview(subject, SAMPLE_VARS), [subject]);
  const renderedBody = useMemo(() => renderTemplatePreview(body, SAMPLE_VARS), [body]);

  const dirty = template
    ? name !== template.name ||
      subject !== template.subject ||
      body !== template.body ||
      type !== template.type ||
      triggerEvent !== (template.triggerEvent ?? '') ||
      isActive !== template.isActive
    : false;

  const handleSave = () => {
    if (!id) return;
    updateMutation.mutate(
      {
        id,
        patch: {
          name,
          subject,
          body,
          type,
          triggerEvent: triggerEvent.trim() || undefined,
          isActive,
        },
      },
      {
        onSuccess: () => toast.success('Template saved'),
        onError: (err: unknown) => {
          const msg = (err as { response?: { data?: { error?: { message?: string } } } })
            ?.response?.data?.error?.message ?? 'Failed to save';
          toast.error(msg);
        },
      }
    );
  };

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-6 w-40 bg-gray-200 rounded" />
        <div className="h-10 bg-gray-200 rounded" />
        <div className="h-10 bg-gray-200 rounded" />
        <div className="h-48 bg-gray-200 rounded" />
      </div>
    );
  }

  if (error || !template) {
    return (
      <div className="space-y-4">
        <ErrorState
          title="Couldn't load template"
          message="Check your connection and try again."
          onRetry={() => refetch()}
        />
        <button
          onClick={() => navigate('/admin/email-templates')}
          className="text-primary-600 hover:underline"
        >
          Back to email templates
        </button>
      </div>
    );
  }

  return (
    <PageTransition>
      <div className="max-w-5xl">
        <button
          onClick={() => navigate('/admin/email-templates')}
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"
        >
          <ArrowLeftIcon className="h-4 w-4" /> Back to Email Templates
        </button>

        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{template.name}</h1>
            <p className="mt-1 text-xs text-gray-500">
              Last updated {new Date(template.updatedAt ?? template.createdAt).toLocaleString()}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-white">
              <button
                onClick={() => setMode('edit')}
                className={clsx(
                  'inline-flex items-center gap-1 rounded-md px-3 py-1 text-sm',
                  mode === 'edit' ? 'bg-primary-50 text-primary-700' : 'text-gray-600 hover:bg-gray-50'
                )}
              >
                <PencilIcon className="h-4 w-4" /> Edit
              </button>
              <button
                onClick={() => setMode('preview')}
                className={clsx(
                  'inline-flex items-center gap-1 rounded-md px-3 py-1 text-sm',
                  mode === 'preview' ? 'bg-primary-50 text-primary-700' : 'text-gray-600 hover:bg-gray-50'
                )}
              >
                <EyeIcon className="h-4 w-4" /> Preview
              </button>
            </div>
            <button
              onClick={handleSave}
              disabled={!dirty || updateMutation.isPending}
              className="rounded-lg bg-primary-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {updateMutation.isPending ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2 space-y-4">
            {mode === 'edit' ? (
              <>
                <Field label="Name (internal label — not shown to recipients)">
                  <input
                    className="input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </Field>

                <Field label="Subject">
                  <input
                    className="input"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                  />
                </Field>

                <Field label="Body">
                  <textarea
                    className="input h-96 font-mono text-sm"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Use <code>{'{{variable}}'}</code> syntax to insert dynamic values. HTML allowed.
                  </p>
                </Field>

                <div className="grid grid-cols-2 gap-4">
                  <Field label="Type">
                    <select
                      className="input"
                      value={type}
                      onChange={(e) => setType(e.target.value as EmailTemplateType)}
                    >
                      <option value="AUTOMATED_ONBOARDING">Automated (fires on trigger event)</option>
                      <option value="STATIC_ON_DEMAND">On-demand (staff sends manually)</option>
                    </select>
                  </Field>
                  <Field label="Trigger event (for automated only)">
                    <input
                      className="input"
                      value={triggerEvent}
                      onChange={(e) => setTriggerEvent(e.target.value)}
                      placeholder="e.g. SIGNUP_COMPLETE"
                    />
                  </Field>
                </div>

                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  Active — when off, this template is skipped entirely
                </label>
              </>
            ) : (
              <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                <div className="border-b border-gray-100 bg-gray-50 px-4 py-3">
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Subject</p>
                  <p className="mt-0.5 text-sm font-medium text-gray-900">{renderedSubject}</p>
                </div>
                <div
                  className="prose prose-sm max-w-none p-6 text-gray-800"
                  // Preview renders HTML; body is admin-authored so treated as trusted.
                  // eslint-disable-next-line react/no-danger
                  dangerouslySetInnerHTML={{ __html: renderedBody }}
                />
              </div>
            )}
          </div>

          <aside className="space-y-4">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Variables used ({variables.length})
              </p>
              {variables.length === 0 ? (
                <p className="mt-2 text-sm text-gray-500">None — static content.</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {variables.map((v) => (
                    <li key={v} className="flex items-center justify-between text-xs">
                      <code className="font-mono text-primary-700">{'{{'}{v}{'}}'}</code>
                      <span className="text-gray-500 truncate max-w-[140px]">
                        {SAMPLE_VARS[v] !== undefined ? SAMPLE_VARS[v] : 'no sample'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-xs text-gray-400">
                Sample values are used in the preview pane. The real app substitutes these at send time.
              </p>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
              <p className="font-semibold">Heads up</p>
              <p className="mt-1">
                Changes save immediately and affect future sends only. Already-sent emails are unchanged.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </PageTransition>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-700">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
