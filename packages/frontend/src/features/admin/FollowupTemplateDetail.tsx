import { useState, Fragment } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Dialog, Transition } from '@headlessui/react';
import {
  ArrowLeftIcon,
  PlusIcon,
  PencilIcon,
  TrashIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  LockClosedIcon,
} from '@heroicons/react/24/outline';
import {
  useFollowUpTemplate,
  useUpdateFollowUpTemplate,
  useDeleteFollowUpTemplate,
  useCreateFollowUpStep,
  useUpdateFollowUpStep,
  useDeleteFollowUpStep,
  useReorderFollowUpSteps,
} from '../../hooks/useFollowupTemplates';
import type { FollowUpTemplateStep } from '../../hooks/useFollowupTemplates';
import PageTransition from '../../components/ui/PageTransition';
import clsx from 'clsx';
import toast from 'react-hot-toast';

const statusBadge: Record<string, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-gray-100 text-gray-800' },
  active: { label: 'Active', className: 'bg-green-100 text-green-800' },
  archived: { label: 'Archived', className: 'bg-yellow-100 text-yellow-800' },
};

const channelBadge: Record<string, { label: string; className: string }> = {
  email: { label: 'Email', className: 'bg-blue-100 text-blue-800' },
  phone_call: { label: 'Phone Call', className: 'bg-purple-100 text-purple-800' },
};

const toneBadge: Record<string, { label: string; className: string }> = {
  professional: { label: 'Professional', className: 'bg-gray-100 text-gray-700' },
  urgent: { label: 'Urgent', className: 'bg-orange-100 text-orange-700' },
  escalated: { label: 'Escalated', className: 'bg-red-100 text-red-700' },
};

interface StepFormData {
  name: string;
  channel: string;
  triggerDaysAfterPrev: number;
  escalationLevel: number;
  emailSubject: string;
  emailBodyTemplate: string;
  emailTone: string;
  retellScriptTemplate: string;
  retellAgentId: string;
  requiresApproval: boolean;
}

const defaultStepForm: StepFormData = {
  name: '',
  channel: 'email',
  triggerDaysAfterPrev: 7,
  escalationLevel: 1,
  emailSubject: '',
  emailBodyTemplate: '',
  emailTone: 'professional',
  retellScriptTemplate: '',
  retellAgentId: '',
  requiresApproval: true,
};

export default function FollowupTemplateDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: template, isLoading } = useFollowUpTemplate(id);
  const updateTemplate = useUpdateFollowUpTemplate();
  const deleteTemplate = useDeleteFollowUpTemplate();
  const createStep = useCreateFollowUpStep();
  const updateStep = useUpdateFollowUpStep();
  const deleteStep = useDeleteFollowUpStep();
  const reorderSteps = useReorderFollowUpSteps();

  const [showStepModal, setShowStepModal] = useState(false);
  const [editingStep, setEditingStep] = useState<FollowUpTemplateStep | null>(null);
  const [stepForm, setStepForm] = useState<StepFormData>(defaultStepForm);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showEditInfo, setShowEditInfo] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');

  const steps = (template?.steps ?? []).slice().sort((a, b) => a.stepOrder - b.stepOrder);

  // ---- Template actions ----

  const handlePublish = () => {
    if (!id) return;
    updateTemplate.mutate(
      { id, status: 'active', publishedAt: new Date().toISOString() },
      {
        onSuccess: () => toast.success('Template published'),
        onError: () => toast.error('Failed to publish'),
      }
    );
  };

  const handleArchive = () => {
    if (!id) return;
    updateTemplate.mutate(
      { id, status: 'archived' },
      {
        onSuccess: () => toast.success('Template archived'),
        onError: () => toast.error('Failed to archive'),
      }
    );
  };

  const handleDelete = () => {
    if (!id) return;
    deleteTemplate.mutate(id, {
      onSuccess: () => {
        toast.success('Template deleted');
        navigate('/admin/followup-templates');
      },
      onError: () => toast.error('Failed to delete template'),
    });
  };

  const openEditInfo = () => {
    if (!template) return;
    setEditName(template.name);
    setEditDescription(template.description ?? '');
    setShowEditInfo(true);
  };

  const handleSaveInfo = () => {
    if (!id || !editName.trim()) return;
    updateTemplate.mutate(
      { id, name: editName.trim(), description: editDescription.trim() || null },
      {
        onSuccess: () => {
          toast.success('Template updated');
          setShowEditInfo(false);
        },
        onError: () => toast.error('Failed to update'),
      }
    );
  };

  // ---- Step actions ----

  const openAddStep = () => {
    setEditingStep(null);
    setStepForm(defaultStepForm);
    setShowStepModal(true);
  };

  const openEditStep = (step: FollowUpTemplateStep) => {
    setEditingStep(step);
    setStepForm({
      name: step.name,
      channel: step.channel,
      triggerDaysAfterPrev: step.triggerDaysAfterPrev,
      escalationLevel: step.escalationLevel,
      emailSubject: step.emailSubject ?? '',
      emailBodyTemplate: step.emailBodyTemplate ?? '',
      emailTone: step.emailTone ?? 'professional',
      retellScriptTemplate: step.retellScriptTemplate ?? '',
      retellAgentId: step.retellAgentId ?? '',
      requiresApproval: step.requiresApproval,
    });
    setShowStepModal(true);
  };

  const handleSaveStep = () => {
    if (!id || !stepForm.name.trim()) return;

    const payload = {
      name: stepForm.name.trim(),
      channel: stepForm.channel,
      triggerDaysAfterPrev: stepForm.triggerDaysAfterPrev,
      escalationLevel: stepForm.escalationLevel,
      requiresApproval: stepForm.requiresApproval,
      emailSubject: stepForm.channel === 'email' ? stepForm.emailSubject || null : null,
      emailBodyTemplate: stepForm.channel === 'email' ? stepForm.emailBodyTemplate || null : null,
      emailTone: stepForm.channel === 'email' ? stepForm.emailTone || null : null,
      retellScriptTemplate: stepForm.channel === 'phone_call' ? stepForm.retellScriptTemplate || null : null,
      retellAgentId: stepForm.channel === 'phone_call' ? stepForm.retellAgentId || null : null,
    };

    if (editingStep) {
      updateStep.mutate(
        { id: editingStep.id, ...payload },
        {
          onSuccess: () => {
            toast.success('Step updated');
            setShowStepModal(false);
          },
          onError: () => toast.error('Failed to update step'),
        }
      );
    } else {
      createStep.mutate(
        {
          templateId: id,
          stepOrder: steps.length + 1,
          ...payload,
        },
        {
          onSuccess: () => {
            toast.success('Step added');
            setShowStepModal(false);
          },
          onError: () => toast.error('Failed to add step'),
        }
      );
    }
  };

  const handleDeleteStep = (stepId: string) => {
    deleteStep.mutate(stepId, {
      onSuccess: () => toast.success('Step removed'),
      onError: () => toast.error('Failed to remove step'),
    });
  };

  const handleMoveStep = (index: number, direction: 'up' | 'down') => {
    if (!id) return;
    const newSteps = [...steps];
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= newSteps.length) return;

    [newSteps[index], newSteps[swapIndex]] = [newSteps[swapIndex], newSteps[index]];

    const order = newSteps.map((s, i) => ({ id: s.id, stepOrder: i + 1 }));
    reorderSteps.mutate(
      { templateId: id, order },
      {
        onError: () => toast.error('Failed to reorder steps'),
      }
    );
  };

  // ---- Loading / 404 ----

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-6 w-40 bg-gray-200 rounded" />
        <div className="h-8 w-64 bg-gray-200 rounded" />
        <div className="h-4 w-96 bg-gray-200 rounded" />
        <div className="space-y-4 mt-8">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-24 bg-gray-200 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (!template) {
    return (
      <div className="text-center py-16">
        <h2 className="text-lg font-semibold text-gray-900">Template not found</h2>
        <p className="mt-1 text-sm text-gray-500">The follow-up template you are looking for does not exist.</p>
        <Link to="/admin/followup-templates" className="mt-4 inline-block text-sm text-primary-600 hover:text-primary-700">
          Back to templates
        </Link>
      </div>
    );
  }

  const badge = statusBadge[template.status] ?? statusBadge.draft;

  return (
    <PageTransition>
      <div>
        {/* Back link */}
        <Link
          to="/admin/followup-templates"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-6"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Follow-up Templates
        </Link>

        {/* Header */}
        <div className="sm:flex sm:items-start sm:justify-between mb-8">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{template.name}</h1>
              <span
                className={clsx(
                  'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                  badge.className
                )}
              >
                {badge.label}
              </span>
              <span className="text-sm text-gray-500">v{template.version}</span>
            </div>
            {template.description && (
              <p className="mt-1 text-sm text-gray-500">{template.description}</p>
            )}
            {template.payerTrack && (
              <p className="mt-1 text-xs text-gray-400">
                {template.payerTrack.payerName} &mdash; {template.payerTrack.track}
              </p>
            )}
          </div>

          <div className="mt-4 sm:mt-0 flex flex-wrap gap-2">
            <button onClick={openEditInfo} className="btn-secondary text-sm inline-flex items-center gap-1.5">
              <PencilIcon className="h-4 w-4" />
              Edit
            </button>
            {template.status === 'draft' && (
              <button
                onClick={handlePublish}
                disabled={updateTemplate.isPending}
                className="btn-primary text-sm"
              >
                Publish
              </button>
            )}
            {template.status === 'active' && (
              <button
                onClick={handleArchive}
                disabled={updateTemplate.isPending}
                className="rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-2 text-sm font-medium text-yellow-800 hover:bg-yellow-100"
              >
                Archive
              </button>
            )}
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
            >
              Delete
            </button>
          </div>
        </div>

        {/* Steps section */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            Steps ({steps.length})
          </h2>
          <button onClick={openAddStep} className="btn-primary text-sm inline-flex items-center gap-1.5">
            <PlusIcon className="h-4 w-4" />
            Add Step
          </button>
        </div>

        {steps.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-sm text-gray-500">No steps yet. Add a step to define the follow-up sequence.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {steps.map((step, index) => {
              const ch = channelBadge[step.channel] ?? channelBadge.email;
              const tone = step.emailTone ? toneBadge[step.emailTone] : null;

              return (
                <div key={step.id} className="card p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-gray-100 text-xs font-semibold text-gray-600">
                          {step.stepOrder}
                        </span>
                        <span className="text-sm font-medium text-gray-900">{step.name}</span>
                        <span
                          className={clsx(
                            'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                            ch.className
                          )}
                        >
                          {ch.label}
                        </span>
                        {step.requiresApproval && (
                          <LockClosedIcon className="h-4 w-4 text-gray-400" title="Requires approval" />
                        )}
                      </div>

                      <div className="mt-1.5 flex items-center gap-3 text-xs text-gray-500">
                        <span>{step.triggerDaysAfterPrev} days after previous</span>
                        <span>Escalation level {step.escalationLevel}</span>
                      </div>

                      {step.channel === 'email' && (
                        <div className="mt-2 space-y-1">
                          {step.emailSubject && (
                            <p className="text-xs text-gray-600">
                              <span className="font-medium">Subject:</span> {step.emailSubject}
                            </p>
                          )}
                          {tone && (
                            <span
                              className={clsx(
                                'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                                tone.className
                              )}
                            >
                              {tone.label}
                            </span>
                          )}
                          {step.emailBodyTemplate && (
                            <p className="text-xs text-gray-400 truncate max-w-md">
                              {step.emailBodyTemplate}
                            </p>
                          )}
                        </div>
                      )}

                      {step.channel === 'phone_call' && (
                        <div className="mt-2 space-y-1">
                          {step.retellAgentId && (
                            <p className="text-xs text-gray-600">
                              <span className="font-medium">Agent:</span> {step.retellAgentId}
                            </p>
                          )}
                          {step.retellScriptTemplate && (
                            <p className="text-xs text-gray-400 truncate max-w-md">
                              {step.retellScriptTemplate}
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1 ml-4">
                      <button
                        onClick={() => handleMoveStep(index, 'up')}
                        disabled={index === 0}
                        className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Move up"
                      >
                        <ChevronUpIcon className="h-4 w-4 text-gray-500" />
                      </button>
                      <button
                        onClick={() => handleMoveStep(index, 'down')}
                        disabled={index === steps.length - 1}
                        className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Move down"
                      >
                        <ChevronDownIcon className="h-4 w-4 text-gray-500" />
                      </button>
                      <button
                        onClick={() => openEditStep(step)}
                        className="p-1 rounded hover:bg-gray-100"
                        title="Edit step"
                      >
                        <PencilIcon className="h-4 w-4 text-gray-500" />
                      </button>
                      <button
                        onClick={() => handleDeleteStep(step.id)}
                        className="p-1 rounded hover:bg-red-50"
                        title="Delete step"
                      >
                        <TrashIcon className="h-4 w-4 text-red-400" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Add/Edit Step Modal */}
        <Transition appear show={showStepModal} as={Fragment}>
          <Dialog as="div" className="relative z-50" onClose={() => setShowStepModal(false)}>
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
                  <Dialog.Panel className="w-full max-w-lg transform rounded-xl bg-white p-6 shadow-xl transition-all">
                    <Dialog.Title as="h3" className="text-lg font-semibold text-gray-900">
                      {editingStep ? 'Edit Step' : 'Add Step'}
                    </Dialog.Title>

                    <div className="mt-4 space-y-4">
                      {/* Name */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Name <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={stepForm.name}
                          onChange={(e) => setStepForm((f) => ({ ...f, name: e.target.value }))}
                          placeholder="e.g. Initial Follow-up Email"
                          className="block w-full rounded-lg border border-gray-300 bg-white py-2 px-3 text-sm placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                        />
                      </div>

                      {/* Channel */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Channel</label>
                        <select
                          value={stepForm.channel}
                          onChange={(e) => setStepForm((f) => ({ ...f, channel: e.target.value }))}
                          className="block w-full rounded-lg border border-gray-300 bg-white py-2 px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                        >
                          <option value="email">Email</option>
                          <option value="phone_call">Phone Call</option>
                        </select>
                      </div>

                      {/* Trigger days + escalation level */}
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Days After Previous
                          </label>
                          <input
                            type="number"
                            min={0}
                            value={stepForm.triggerDaysAfterPrev}
                            onChange={(e) => setStepForm((f) => ({ ...f, triggerDaysAfterPrev: Number(e.target.value) }))}
                            className="block w-full rounded-lg border border-gray-300 bg-white py-2 px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Escalation Level
                          </label>
                          <input
                            type="number"
                            min={1}
                            value={stepForm.escalationLevel}
                            onChange={(e) => setStepForm((f) => ({ ...f, escalationLevel: Number(e.target.value) }))}
                            className="block w-full rounded-lg border border-gray-300 bg-white py-2 px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                          />
                        </div>
                      </div>

                      {/* Email-specific fields */}
                      {stepForm.channel === 'email' && (
                        <>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Email Subject
                            </label>
                            <input
                              type="text"
                              value={stepForm.emailSubject}
                              onChange={(e) => setStepForm((f) => ({ ...f, emailSubject: e.target.value }))}
                              placeholder="e.g. Credentialing Status Follow-up"
                              className="block w-full rounded-lg border border-gray-300 bg-white py-2 px-3 text-sm placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Email Body Template
                            </label>
                            <textarea
                              value={stepForm.emailBodyTemplate}
                              onChange={(e) => setStepForm((f) => ({ ...f, emailBodyTemplate: e.target.value }))}
                              rows={4}
                              placeholder="Email body template with {{variables}}..."
                              className="block w-full rounded-lg border border-gray-300 bg-white py-2 px-3 text-sm placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Email Tone
                            </label>
                            <select
                              value={stepForm.emailTone}
                              onChange={(e) => setStepForm((f) => ({ ...f, emailTone: e.target.value }))}
                              className="block w-full rounded-lg border border-gray-300 bg-white py-2 px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                            >
                              <option value="professional">Professional</option>
                              <option value="urgent">Urgent</option>
                              <option value="escalated">Escalated</option>
                            </select>
                          </div>
                        </>
                      )}

                      {/* Phone-specific fields */}
                      {stepForm.channel === 'phone_call' && (
                        <>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Retell Script Template
                            </label>
                            <textarea
                              value={stepForm.retellScriptTemplate}
                              onChange={(e) => setStepForm((f) => ({ ...f, retellScriptTemplate: e.target.value }))}
                              rows={4}
                              placeholder="Call script template..."
                              className="block w-full rounded-lg border border-gray-300 bg-white py-2 px-3 text-sm placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Retell Agent ID
                            </label>
                            <input
                              type="text"
                              value={stepForm.retellAgentId}
                              onChange={(e) => setStepForm((f) => ({ ...f, retellAgentId: e.target.value }))}
                              placeholder="agent_..."
                              className="block w-full rounded-lg border border-gray-300 bg-white py-2 px-3 text-sm placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                            />
                          </div>
                        </>
                      )}

                      {/* Requires approval */}
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={stepForm.requiresApproval}
                          onChange={(e) => setStepForm((f) => ({ ...f, requiresApproval: e.target.checked }))}
                          className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                        <span className="text-sm text-gray-700">Requires approval before sending</span>
                      </label>
                    </div>

                    <div className="mt-6 flex justify-end gap-3">
                      <button
                        onClick={() => setShowStepModal(false)}
                        className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveStep}
                        disabled={!stepForm.name.trim() || createStep.isPending || updateStep.isPending}
                        className="btn-primary text-sm disabled:opacity-50"
                      >
                        {createStep.isPending || updateStep.isPending
                          ? 'Saving...'
                          : editingStep
                            ? 'Update Step'
                            : 'Add Step'}
                      </button>
                    </div>
                  </Dialog.Panel>
                </Transition.Child>
              </div>
            </div>
          </Dialog>
        </Transition>

        {/* Delete Confirmation Dialog */}
        <Transition appear show={showDeleteConfirm} as={Fragment}>
          <Dialog as="div" className="relative z-50" onClose={() => setShowDeleteConfirm(false)}>
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
                  <Dialog.Panel className="w-full max-w-sm transform rounded-xl bg-white p-6 shadow-xl transition-all">
                    <Dialog.Title as="h3" className="text-lg font-semibold text-gray-900">
                      Delete Template
                    </Dialog.Title>
                    <p className="mt-2 text-sm text-gray-500">
                      Are you sure you want to delete &ldquo;{template.name}&rdquo;? This action cannot be undone.
                    </p>
                    <div className="mt-6 flex justify-end gap-3">
                      <button
                        onClick={() => setShowDeleteConfirm(false)}
                        className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleDelete}
                        disabled={deleteTemplate.isPending}
                        className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        {deleteTemplate.isPending ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </Dialog.Panel>
                </Transition.Child>
              </div>
            </div>
          </Dialog>
        </Transition>

        {/* Edit Name/Description Modal */}
        <Transition appear show={showEditInfo} as={Fragment}>
          <Dialog as="div" className="relative z-50" onClose={() => setShowEditInfo(false)}>
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
                      Edit Template
                    </Dialog.Title>
                    <div className="mt-4 space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Name <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="block w-full rounded-lg border border-gray-300 bg-white py-2 px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                        <textarea
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          rows={3}
                          className="block w-full rounded-lg border border-gray-300 bg-white py-2 px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                        />
                      </div>
                    </div>
                    <div className="mt-6 flex justify-end gap-3">
                      <button
                        onClick={() => setShowEditInfo(false)}
                        className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveInfo}
                        disabled={!editName.trim() || updateTemplate.isPending}
                        className="btn-primary text-sm disabled:opacity-50"
                      >
                        {updateTemplate.isPending ? 'Saving...' : 'Save'}
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
