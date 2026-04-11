import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PlusIcon, PaperAirplaneIcon, XMarkIcon } from '@heroicons/react/24/outline';
import PageTransition from '../../components/ui/PageTransition';
import EmptyState from '../../components/ui/EmptyState';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { api } from '../../services/api';
import { usePractices } from '../../hooks/usePractices';

type Tab = 'automated' | 'on_demand' | 'logs';

interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  type: 'AUTOMATED_ONBOARDING' | 'STATIC_ON_DEMAND';
  triggerEvent: string | null;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface EmailLog {
  id: string;
  templateId: string | null;
  practiceId: string | null;
  to: string;
  subject: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
  resendId: string | null;
  errorMessage: string | null;
  sentAt: string | null;
  createdAt: string;
  template: EmailTemplate | null;
  practice: { id: string; name: string } | null;
}

const TRIGGER_EVENTS = ['SIGNUP_COMPLETE', 'PROFILE_COMPLETE', 'FIRST_ENROLLMENT_SUBMITTED'];

const tabs: { key: Tab; label: string }[] = [
  { key: 'automated', label: 'Automated Onboarding' },
  { key: 'on_demand', label: 'On-Demand Emails' },
  { key: 'logs', label: 'Email Log' },
];

export default function CustomerCommunications() {
  const [activeTab, setActiveTab] = useState<Tab>('automated');

  return (
    <PageTransition>
      <div>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Customer Communications</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage email templates and track outbound communications
          </p>
        </div>

        <div className="border-b border-gray-200 mb-6">
          <nav className="-mb-px flex space-x-8">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={clsx(
                  'whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm',
                  activeTab === tab.key
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                )}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {activeTab === 'automated' && <TemplateList type="AUTOMATED_ONBOARDING" showTrigger />}
        {activeTab === 'on_demand' && <TemplateList type="STATIC_ON_DEMAND" />}
        {activeTab === 'logs' && <EmailLogList />}
      </div>
    </PageTransition>
  );
}

// ─── Template List ───────────────────────────────────────────────

function TemplateList({ type, showTrigger }: { type: 'AUTOMATED_ONBOARDING' | 'STATIC_ON_DEMAND'; showTrigger?: boolean }) {
  const queryClient = useQueryClient();
  const [editingTemplate, setEditingTemplate] = useState<Partial<EmailTemplate> | null>(null);
  const [sendTemplateId, setSendTemplateId] = useState<string | null>(null);

  const { data: templates, isLoading } = useQuery({
    queryKey: ['admin', 'email-templates', type],
    queryFn: async () => {
      const res = await api.get(`/admin/email-templates?type=${type}`);
      return (res.data as any).data as EmailTemplate[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (tpl: Partial<EmailTemplate>) => {
      if (tpl.id) {
        await api.put(`/admin/email-templates/${tpl.id}`, {
          name: tpl.name,
          subject: tpl.subject,
          body: tpl.body,
          type: tpl.type,
          triggerEvent: tpl.triggerEvent || undefined,
        });
      } else {
        await api.post('/admin/email-templates', {
          name: tpl.name,
          subject: tpl.subject,
          body: tpl.body,
          type,
          triggerEvent: tpl.triggerEvent || undefined,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'email-templates', type] });
      setEditingTemplate(null);
      toast.success('Template saved');
    },
    onError: () => {
      toast.error('Failed to save template');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/admin/email-templates/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'email-templates', type] });
      toast.success('Template deactivated');
    },
    onError: () => {
      toast.error('Failed to deactivate template');
    },
  });

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">
          {type === 'AUTOMATED_ONBOARDING' ? 'Automated Onboarding Templates' : 'On-Demand Templates'}
        </h2>
        <button
          onClick={() => setEditingTemplate({ name: '', subject: '', body: '', type, triggerEvent: null })}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700"
        >
          <PlusIcon className="h-4 w-4" />
          New Template
        </button>
      </div>

      {isLoading ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 overflow-hidden animate-pulse">
          <div className="bg-gray-50 px-6 py-3 flex gap-8">
            {[1, 2, 3, 4].map((i) => <div key={i} className="h-3 w-24 bg-gray-200 rounded" />)}
          </div>
          {[1, 2, 3].map((i) => (
            <div key={i} className="px-6 py-4 flex gap-8 border-t border-gray-100">
              <div className="h-4 w-40 bg-gray-200 rounded" />
              <div className="h-4 w-48 bg-gray-200 rounded" />
              <div className="h-4 w-24 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
      ) : !templates?.length ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 py-12">
          <EmptyState
            illustration="inbox"
            title="No templates yet"
            description="Create your first email template to get started."
          />
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50/80">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Subject</th>
                {showTrigger && (
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Trigger Event</th>
                )}
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {templates.map((tpl) => (
                <tr key={tpl.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setEditingTemplate(tpl)}>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">{tpl.name}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">{tpl.subject}</td>
                  {showTrigger && (
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {tpl.triggerEvent ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-xs font-medium">
                          {tpl.triggerEvent}
                        </span>
                      ) : (
                        <span className="text-gray-400">--</span>
                      )}
                    </td>
                  )}
                  <td className="px-6 py-4">
                    <span
                      className={clsx(
                        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                        tpl.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                      )}
                    >
                      {tpl.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                      {!showTrigger && (
                        <button
                          onClick={() => setSendTemplateId(tpl.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-primary-700 bg-primary-50 rounded-md hover:bg-primary-100"
                          title="Send to practice"
                        >
                          <PaperAirplaneIcon className="h-3.5 w-3.5" />
                          Send
                        </button>
                      )}
                      {tpl.isActive && (
                        <button
                          onClick={() => deleteMutation.mutate(tpl.id)}
                          disabled={deleteMutation.isPending}
                          className="px-2.5 py-1.5 text-xs font-medium text-red-700 bg-red-50 rounded-md hover:bg-red-100 disabled:opacity-50"
                        >
                          Deactivate
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Template Editor Modal */}
      {editingTemplate && (
        <TemplateEditorModal
          template={editingTemplate}
          showTrigger={!!showTrigger}
          saving={saveMutation.isPending}
          onSave={(tpl) => saveMutation.mutate(tpl)}
          onClose={() => setEditingTemplate(null)}
        />
      )}

      {/* Send Modal */}
      {sendTemplateId && (
        <SendModal
          templateId={sendTemplateId}
          onClose={() => setSendTemplateId(null)}
        />
      )}
    </>
  );
}

// ─── Template Editor Modal ───────────────────────────────────────

function TemplateEditorModal({
  template,
  showTrigger,
  saving,
  onSave,
  onClose,
}: {
  template: Partial<EmailTemplate>;
  showTrigger: boolean;
  saving: boolean;
  onSave: (tpl: Partial<EmailTemplate>) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    name: template.name ?? '',
    subject: template.subject ?? '',
    body: template.body ?? '',
    triggerEvent: template.triggerEvent ?? '',
  });
  const [customTrigger, setCustomTrigger] = useState(
    template.triggerEvent && !TRIGGER_EVENTS.includes(template.triggerEvent)
  );

  const handleSave = () => {
    if (!form.name.trim() || !form.subject.trim() || !form.body.trim()) {
      toast.error('Name, subject, and body are required');
      return;
    }
    onSave({
      ...template,
      name: form.name,
      subject: form.subject,
      body: form.body,
      triggerEvent: showTrigger ? (form.triggerEvent || null) : null,
    });
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={onClose} />
        <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-gray-900">
              {template.id ? 'Edit Template' : 'New Template'}
            </h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full rounded-lg border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm"
                placeholder="e.g. Welcome Email"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
              <input
                type="text"
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
                className="w-full rounded-lg border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm"
                placeholder="e.g. Welcome to Lanyard Health, {{practiceName}}"
              />
            </div>

            {showTrigger && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Trigger Event</label>
                {customTrigger ? (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={form.triggerEvent}
                      onChange={(e) => setForm({ ...form, triggerEvent: e.target.value })}
                      className="flex-1 rounded-lg border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm"
                      placeholder="CUSTOM_EVENT_NAME"
                    />
                    <button
                      onClick={() => { setCustomTrigger(false); setForm({ ...form, triggerEvent: '' }); }}
                      className="text-sm text-primary-600 hover:text-primary-800 whitespace-nowrap"
                    >
                      Use preset
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <select
                      value={form.triggerEvent}
                      onChange={(e) => setForm({ ...form, triggerEvent: e.target.value })}
                      className="flex-1 rounded-lg border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm"
                    >
                      <option value="">None</option>
                      {TRIGGER_EVENTS.map((evt) => (
                        <option key={evt} value={evt}>{evt}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => setCustomTrigger(true)}
                      className="text-sm text-primary-600 hover:text-primary-800 whitespace-nowrap"
                    >
                      Custom
                    </button>
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Body <span className="text-gray-400 font-normal">(HTML)</span>
              </label>
              <textarea
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                rows={12}
                className="w-full rounded-lg border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm font-mono"
                placeholder="<p>Hello {{practiceName}},</p>"
              />
              <p className="mt-1 text-xs text-gray-400">
                Merge tags: {'{{practiceName}}'}, {'{{practiceEmail}}'}
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Template'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Send Modal ──────────────────────────────────────────────────

function SendModal({ templateId, onClose }: { templateId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: practices, isLoading: practicesLoading } = usePractices();
  const [selectedPracticeId, setSelectedPracticeId] = useState('');

  const sendMutation = useMutation({
    mutationFn: async () => {
      await api.post(`/admin/email-templates/${templateId}/send`, { practiceId: selectedPracticeId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'email-logs'] });
      toast.success('Email sent successfully');
      onClose();
    },
    onError: () => {
      toast.error('Failed to send email');
    },
  });

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={onClose} />
        <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-gray-900">Send Email</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Select Practice</label>
            {practicesLoading ? (
              <div className="h-10 bg-gray-100 rounded-lg animate-pulse" />
            ) : (
              <select
                value={selectedPracticeId}
                onChange={(e) => setSelectedPracticeId(e.target.value)}
                className="w-full rounded-lg border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm"
              >
                <option value="">Choose a practice...</option>
                {practices?.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
          </div>

          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={() => sendMutation.mutate()}
              disabled={!selectedPracticeId || sendMutation.isPending}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50"
            >
              <PaperAirplaneIcon className="h-4 w-4" />
              {sendMutation.isPending ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Email Log List ──────────────────────────────────────────────

function EmailLogList() {
  const { data: practices } = usePractices();
  const [practiceFilter, setPracticeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const queryParams = new URLSearchParams();
  if (practiceFilter) queryParams.set('practiceId', practiceFilter);
  if (statusFilter) queryParams.set('status', statusFilter);
  const qs = queryParams.toString();

  const { data: logs, isLoading } = useQuery({
    queryKey: ['admin', 'email-logs', practiceFilter, statusFilter],
    queryFn: async () => {
      const res = await api.get(`/admin/email-logs${qs ? `?${qs}` : ''}`);
      return (res.data as any).data as EmailLog[];
    },
  });

  const statusBadge = (status: EmailLog['status']) => {
    const styles = {
      SENT: 'bg-green-100 text-green-800',
      FAILED: 'bg-red-100 text-red-800',
      PENDING: 'bg-yellow-100 text-yellow-800',
    };
    return (
      <span className={clsx('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium', styles[status])}>
        {status}
      </span>
    );
  };

  return (
    <>
      <div className="flex items-center gap-4 mb-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Practice</label>
          <select
            value={practiceFilter}
            onChange={(e) => setPracticeFilter(e.target.value)}
            className="rounded-lg border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm"
          >
            <option value="">All practices</option>
            {practices?.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm"
          >
            <option value="">All statuses</option>
            <option value="SENT">Sent</option>
            <option value="FAILED">Failed</option>
            <option value="PENDING">Pending</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 overflow-hidden animate-pulse">
          <div className="bg-gray-50 px-6 py-3 flex gap-8">
            {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-3 w-20 bg-gray-200 rounded" />)}
          </div>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="px-6 py-4 flex gap-8 border-t border-gray-100">
              <div className="h-4 w-28 bg-gray-200 rounded" />
              <div className="h-4 w-36 bg-gray-200 rounded" />
              <div className="h-4 w-28 bg-gray-200 rounded" />
              <div className="h-4 w-40 bg-gray-200 rounded" />
              <div className="h-4 w-16 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
      ) : !logs?.length ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 py-12">
          <EmptyState
            illustration="inbox"
            title="No emails sent yet"
            description="Sent emails will appear here."
          />
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50/80">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Template</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Practice</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Recipient</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {new Date(log.createdAt).toLocaleDateString()} {new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">
                    {log.template?.name ?? log.subject}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {log.practice?.name ?? '--'}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">{log.to}</td>
                  <td className="px-6 py-4">{statusBadge(log.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
