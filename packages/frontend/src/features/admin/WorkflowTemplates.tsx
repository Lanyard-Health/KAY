import { useState, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { PlusIcon } from '@heroicons/react/24/outline';
import { Dialog, Transition } from '@headlessui/react';
import { useWorkflowTemplates } from '../../hooks/useWorkflowTemplates';
import { useCreateWorkflowTemplate } from '../../hooks/useWorkflowTemplates';
import { usePayerTracks } from '../../hooks/useKnowledgeBase';
import PageTransition from '../../components/ui/PageTransition';
import EmptyState from '../../components/ui/EmptyState';
import clsx from 'clsx';
import toast from 'react-hot-toast';

const STATUS_TABS = ['all', 'draft', 'active', 'archived'] as const;
type StatusTab = (typeof STATUS_TABS)[number];

const statusBadge: Record<string, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-gray-100 text-gray-800' },
  active: { label: 'Active', className: 'bg-green-100 text-green-800' },
  archived: { label: 'Archived', className: 'bg-yellow-100 text-yellow-800' },
};

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function WorkflowTemplates() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<StatusTab>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Form state for create modal
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newPayerTrackId, setNewPayerTrackId] = useState('');

  const filters = activeTab === 'all' ? undefined : { status: activeTab };
  const { data: templates, isLoading } = useWorkflowTemplates(filters);
  const { data: payerTracks } = usePayerTracks();
  const createMutation = useCreateWorkflowTemplate();

  const handleCreate = () => {
    if (!newPayerTrackId || !newName.trim()) return;
    createMutation.mutate(
      {
        payerTrackId: newPayerTrackId,
        name: newName.trim(),
        description: newDescription.trim() || null,
        status: 'draft',
        createdBy: '',
      },
      {
        onSuccess: (data) => {
          toast.success('Template created');
          setShowCreateModal(false);
          setNewName('');
          setNewDescription('');
          setNewPayerTrackId('');
          navigate(`/admin/workflow-templates/${data.id}`);
        },
        onError: () => {
          toast.error('Failed to create template');
        },
      }
    );
  };

  const closeModal = () => {
    setShowCreateModal(false);
    setNewName('');
    setNewDescription('');
    setNewPayerTrackId('');
  };

  if (isLoading) {
    return (
      <div>
        <div className="sm:flex sm:items-center sm:justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Workflow Templates</h1>
            <p className="mt-1 text-sm text-gray-500">Manage credentialing workflow templates</p>
          </div>
        </div>
        <div className="card overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50/80">
              <tr>
                {['Name', 'Payer Track', 'Version', 'Status', 'Steps', 'Enrollments', 'Last Updated'].map((h) => (
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
                  <td className="px-6 py-4"><div className="h-4 w-32 bg-gray-200 rounded" /></td>
                  <td className="px-6 py-4"><div className="h-4 w-12 bg-gray-200 rounded" /></td>
                  <td className="px-6 py-4"><div className="h-5 w-16 bg-gray-200 rounded-full" /></td>
                  <td className="px-6 py-4"><div className="h-4 w-8 bg-gray-200 rounded" /></td>
                  <td className="px-6 py-4"><div className="h-4 w-8 bg-gray-200 rounded" /></td>
                  <td className="px-6 py-4"><div className="h-4 w-24 bg-gray-200 rounded" /></td>
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
            <h1 className="text-2xl font-bold text-gray-900">Workflow Templates</h1>
            {templates && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-800">
                {templates.length}
              </span>
            )}
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="btn-primary mt-4 sm:mt-0 inline-flex items-center"
          >
            <PlusIcon className="-ml-1 mr-2 h-5 w-5" />
            New Template
          </button>
        </div>

        {/* Status filter tabs */}
        <div className="mb-6 border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={clsx(
                  'whitespace-nowrap border-b-2 py-3 px-1 text-sm font-medium capitalize transition-colors',
                  activeTab === tab
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                )}
              >
                {tab}
              </button>
            ))}
          </nav>
        </div>

        {/* Table or empty state */}
        {!templates || templates.length === 0 ? (
          <EmptyState
            illustration="clipboard"
            title="No workflow templates found"
            description={
              activeTab !== 'all'
                ? `No ${activeTab} templates. Try a different filter.`
                : 'Get started by creating your first workflow template.'
            }
            action={
              activeTab === 'all'
                ? { label: 'New Template', onClick: () => setShowCreateModal(true) }
                : undefined
            }
          />
        ) : (
          <div className="card overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50/80">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Payer Track</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Version</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Steps</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Enrollments</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Updated</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {templates.map((template) => {
                  const badge = statusBadge[template.status] ?? statusBadge.draft;
                  return (
                    <tr
                      key={template.id}
                      onClick={() => navigate(`/admin/workflow-templates/${template.id}`)}
                      className="hover:bg-gray-50 cursor-pointer transition-colors"
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <p className="text-sm font-medium text-gray-900">{template.name}</p>
                        {template.description && (
                          <p className="text-xs text-gray-500 truncate max-w-xs">{template.description}</p>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                        {template.payerTrack
                          ? `${template.payerTrack.payerName} \u2014 ${template.payerTrack.track}`
                          : '\u2014'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        v{template.version}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={clsx(
                            'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                            badge.className
                          )}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {template._count?.steps ?? 0}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {template._count?.enrollments ?? 0}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {formatDate(template.updatedAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Create Modal */}
        <Transition appear show={showCreateModal} as={Fragment}>
          <Dialog as="div" className="relative z-50" onClose={closeModal}>
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0"
              enterTo="opacity-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
            >
              <div className="fixed inset-0 bg-black/30" />
            </Transition.Child>

            <div className="fixed inset-0 overflow-y-auto">
              <div className="flex min-h-full items-center justify-center p-4">
                <Transition.Child
                  as={Fragment}
                  enter="ease-out duration-200"
                  enterFrom="opacity-0 scale-95"
                  enterTo="opacity-100 scale-100"
                  leave="ease-in duration-150"
                  leaveFrom="opacity-100 scale-100"
                  leaveTo="opacity-0 scale-95"
                >
                  <Dialog.Panel className="w-full max-w-md transform rounded-xl bg-white p-6 shadow-xl transition-all">
                    <Dialog.Title as="h3" className="text-lg font-semibold text-gray-900">
                      New Workflow Template
                    </Dialog.Title>

                    <div className="mt-4 space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Payer Track <span className="text-red-500">*</span>
                        </label>
                        <select
                          value={newPayerTrackId}
                          onChange={(e) => setNewPayerTrackId(e.target.value)}
                          className="block w-full rounded-lg border border-gray-300 bg-white py-2 px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                        >
                          <option value="">Select a payer track...</option>
                          {payerTracks?.map((pt) => (
                            <option key={pt.id} value={pt.id}>
                              {pt.payerName} &mdash; {pt.track}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Name <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={newName}
                          onChange={(e) => setNewName(e.target.value)}
                          placeholder="e.g. Standard Credentialing"
                          className="block w-full rounded-lg border border-gray-300 bg-white py-2 px-3 text-sm placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Description
                        </label>
                        <textarea
                          value={newDescription}
                          onChange={(e) => setNewDescription(e.target.value)}
                          rows={3}
                          placeholder="Optional description..."
                          className="block w-full rounded-lg border border-gray-300 bg-white py-2 px-3 text-sm placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                        />
                      </div>
                    </div>

                    <div className="mt-6 flex justify-end gap-3">
                      <button
                        onClick={closeModal}
                        className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleCreate}
                        disabled={!newPayerTrackId || !newName.trim() || createMutation.isPending}
                        className="btn-primary text-sm disabled:opacity-50"
                      >
                        {createMutation.isPending ? 'Creating...' : 'Create Template'}
                      </button>
                    </div>
                  </Dialog.Panel>
                </Transition.Child>
              </div>
            </div>
          </Dialog>
        </Transition>
      </div>
    </PageTransition>
  );
}
