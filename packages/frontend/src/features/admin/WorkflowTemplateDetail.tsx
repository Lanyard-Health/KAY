import { useState, Fragment } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeftIcon,
  PlusIcon,
  PencilIcon,
  TrashIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  ExclamationTriangleIcon,
  LockClosedIcon,
} from '@heroicons/react/24/outline';
import { Dialog, Transition, Tab } from '@headlessui/react';
import {
  useWorkflowTemplate,
  useUpdateWorkflowTemplate,
  useDeleteWorkflowTemplate,
  useCreateWorkflowStep,
  useUpdateWorkflowStep,
  useDeleteWorkflowStep,
  useReorderWorkflowSteps,
  useCreateWorkflowCondition,
  useDeleteWorkflowCondition,
} from '../../hooks/useWorkflowTemplates';
import type { WorkflowTemplateStep } from '../../hooks/useWorkflowTemplates';
import PageTransition from '../../components/ui/PageTransition';
import clsx from 'clsx';
import toast from 'react-hot-toast';

// ─── Constants ───────────────────────────────────────────

const STEP_TYPES = [
  'readiness_check',
  'caqh_authorization',
  'populate_template',
  'human_review',
  'submit_application',
  'confirm_submission',
  'follow_up',
  'escalate',
  'await_decision',
  'record_outcome',
] as const;

const OWNERS = ['credentialing_staff', 'provider', 'payer'] as const;

const CONDITION_TYPES = ['state', 'provider_type', 'has_dea', 'has_hospital_privileges'] as const;
const CONDITION_ACTIONS = ['add_step', 'skip_step', 'modify_step'] as const;

const statusBadge: Record<string, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-gray-100 text-gray-800' },
  active: { label: 'Active', className: 'bg-green-100 text-green-800' },
  archived: { label: 'Archived', className: 'bg-yellow-100 text-yellow-800' },
};

const stepTypeBadge: Record<string, string> = {
  readiness_check: 'bg-blue-100 text-blue-800',
  caqh_authorization: 'bg-purple-100 text-purple-800',
  populate_template: 'bg-indigo-100 text-indigo-800',
  human_review: 'bg-amber-100 text-amber-800',
  submit_application: 'bg-green-100 text-green-800',
  confirm_submission: 'bg-teal-100 text-teal-800',
  follow_up: 'bg-orange-100 text-orange-800',
  escalate: 'bg-red-100 text-red-800',
  await_decision: 'bg-cyan-100 text-cyan-800',
  record_outcome: 'bg-emerald-100 text-emerald-800',
};

const ownerBadge: Record<string, string> = {
  credentialing_staff: 'bg-primary-100 text-primary-800',
  provider: 'bg-violet-100 text-violet-800',
  payer: 'bg-sky-100 text-sky-800',
};

function formatLabel(str: string) {
  return str.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Step Form defaults ──────────────────────────────────

interface StepFormData {
  name: string;
  stepType: string;
  owner: string;
  description: string;
  triggerDaysAfterPrev: string;
  isBlocking: boolean;
  requiredDocuments: string;
  reviewerInstructions: string;
}

const defaultStepForm: StepFormData = {
  name: '',
  stepType: STEP_TYPES[0],
  owner: OWNERS[0],
  description: '',
  triggerDaysAfterPrev: '',
  isBlocking: false,
  requiredDocuments: '',
  reviewerInstructions: '',
};

interface ConditionFormData {
  conditionType: string;
  conditionValue: string;
  action: string;
  targetStepOrder: string;
}

const defaultConditionForm: ConditionFormData = {
  conditionType: CONDITION_TYPES[0],
  conditionValue: '',
  action: CONDITION_ACTIONS[0],
  targetStepOrder: '',
};

// ─── Component ───────────────────────────────────────────

export default function WorkflowTemplateDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: template, isLoading } = useWorkflowTemplate(id);
  const updateMutation = useUpdateWorkflowTemplate();
  const deleteMutation = useDeleteWorkflowTemplate();
  const createStepMutation = useCreateWorkflowStep();
  const updateStepMutation = useUpdateWorkflowStep();
  const deleteStepMutation = useDeleteWorkflowStep();
  const reorderMutation = useReorderWorkflowSteps();
  const createConditionMutation = useCreateWorkflowCondition();
  const deleteConditionMutation = useDeleteWorkflowCondition();

  // Modal states
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showStepModal, setShowStepModal] = useState(false);
  const [showConditionModal, setShowConditionModal] = useState(false);
  const [editingStep, setEditingStep] = useState<WorkflowTemplateStep | null>(null);

  // Edit template form
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');

  // Step form
  const [stepForm, setStepForm] = useState<StepFormData>(defaultStepForm);

  // Condition form
  const [conditionForm, setConditionForm] = useState<ConditionFormData>(defaultConditionForm);

  // ─── Handlers ────────────────────────────────────────

  const handlePublish = () => {
    if (!id) return;
    updateMutation.mutate(
      { id, status: 'active' },
      {
        onSuccess: () => toast.success('Template published'),
        onError: () => toast.error('Failed to publish'),
      }
    );
  };

  const handleArchive = () => {
    if (!id) return;
    updateMutation.mutate(
      { id, status: 'archived' },
      {
        onSuccess: () => toast.success('Template archived'),
        onError: () => toast.error('Failed to archive'),
      }
    );
  };

  const handleDelete = () => {
    if (!id) return;
    deleteMutation.mutate(id, {
      onSuccess: () => {
        toast.success('Template deleted');
        navigate('/admin/workflow-templates');
      },
      onError: () => toast.error('Failed to delete'),
    });
  };

  const openEditModal = () => {
    if (!template) return;
    setEditName(template.name);
    setEditDescription(template.description ?? '');
    setShowEditModal(true);
  };

  const handleEditSave = () => {
    if (!id || !editName.trim()) return;
    updateMutation.mutate(
      { id, name: editName.trim(), description: editDescription.trim() || null },
      {
        onSuccess: () => {
          toast.success('Template updated');
          setShowEditModal(false);
        },
        onError: () => toast.error('Failed to update'),
      }
    );
  };

  const openAddStep = () => {
    setEditingStep(null);
    setStepForm(defaultStepForm);
    setShowStepModal(true);
  };

  const openEditStep = (step: WorkflowTemplateStep) => {
    setEditingStep(step);
    setStepForm({
      name: step.name,
      stepType: step.stepType,
      owner: step.owner,
      description: step.description ?? '',
      triggerDaysAfterPrev: step.triggerDaysAfterPrev != null ? String(step.triggerDaysAfterPrev) : '',
      isBlocking: step.isBlocking,
      requiredDocuments: step.requiredDocuments.join(', '),
      reviewerInstructions: step.reviewerInstructions ?? '',
    });
    setShowStepModal(true);
  };

  const handleStepSave = () => {
    if (!id || !stepForm.name.trim()) return;
    const docs = stepForm.requiredDocuments
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean);
    const payload = {
      name: stepForm.name.trim(),
      stepType: stepForm.stepType,
      owner: stepForm.owner,
      description: stepForm.description.trim() || null,
      triggerDaysAfterPrev: stepForm.triggerDaysAfterPrev ? parseInt(stepForm.triggerDaysAfterPrev, 10) : null,
      isBlocking: stepForm.isBlocking,
      requiredDocuments: docs,
      reviewerInstructions: stepForm.reviewerInstructions.trim() || null,
    };

    if (editingStep) {
      updateStepMutation.mutate(
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
      const nextOrder = (template?.steps?.length ?? 0) + 1;
      createStepMutation.mutate(
        { templateId: id, stepOrder: nextOrder, ...payload },
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
    deleteStepMutation.mutate(stepId, {
      onSuccess: () => toast.success('Step deleted'),
      onError: () => toast.error('Failed to delete step'),
    });
  };

  const handleMoveStep = (stepIndex: number, direction: 'up' | 'down') => {
    if (!id || !template?.steps) return;
    const steps = [...template.steps].sort((a, b) => a.stepOrder - b.stepOrder);
    const swapIndex = direction === 'up' ? stepIndex - 1 : stepIndex + 1;
    if (swapIndex < 0 || swapIndex >= steps.length) return;

    const newOrder = steps.map((s, i) => {
      if (i === stepIndex) return { id: s.id, stepOrder: steps[swapIndex].stepOrder };
      if (i === swapIndex) return { id: s.id, stepOrder: steps[stepIndex].stepOrder };
      return { id: s.id, stepOrder: s.stepOrder };
    });

    reorderMutation.mutate(
      { templateId: id, order: newOrder },
      { onError: () => toast.error('Failed to reorder') }
    );
  };

  const handleAddCondition = () => {
    if (!id || !conditionForm.conditionValue.trim()) return;
    createConditionMutation.mutate(
      {
        templateId: id,
        conditionType: conditionForm.conditionType,
        conditionValue: conditionForm.conditionValue.trim(),
        action: conditionForm.action,
        targetStepOrder: conditionForm.targetStepOrder ? parseInt(conditionForm.targetStepOrder, 10) : null,
        stepDefinition: null,
      },
      {
        onSuccess: () => {
          toast.success('Condition added');
          setShowConditionModal(false);
          setConditionForm(defaultConditionForm);
        },
        onError: () => toast.error('Failed to add condition'),
      }
    );
  };

  const handleDeleteCondition = (condId: string) => {
    deleteConditionMutation.mutate(condId, {
      onSuccess: () => toast.success('Condition deleted'),
      onError: () => toast.error('Failed to delete condition'),
    });
  };

  // ─── Loading / 404 ──────────────────────────────────

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-6 w-48 bg-gray-200 rounded" />
        <div className="h-8 w-72 bg-gray-200 rounded" />
        <div className="card p-6 space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 bg-gray-100 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (!template) {
    return (
      <div className="text-center py-12">
        <h2 className="text-lg font-semibold text-gray-900">Template not found</h2>
        <p className="mt-1 text-sm text-gray-500">The workflow template you are looking for does not exist.</p>
        <Link
          to="/admin/workflow-templates"
          className="mt-4 inline-flex items-center text-sm font-medium text-primary-600 hover:text-primary-500"
        >
          <ArrowLeftIcon className="mr-1 h-4 w-4" />
          Back to templates
        </Link>
      </div>
    );
  }

  const badge = statusBadge[template.status] ?? statusBadge.draft;
  const sortedSteps = [...(template.steps ?? [])].sort((a, b) => a.stepOrder - b.stepOrder);
  const conditions = template.conditions ?? [];

  return (
    <PageTransition>
      <div>
        {/* Back link */}
        <Link
          to="/admin/workflow-templates"
          className="inline-flex items-center text-sm font-medium text-gray-500 hover:text-gray-700 mb-4"
        >
          <ArrowLeftIcon className="mr-1 h-4 w-4" />
          Workflow Templates
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

          <div className="mt-4 sm:mt-0 flex items-center gap-2 flex-shrink-0">
            {template.status === 'draft' && (
              <button
                onClick={handlePublish}
                disabled={updateMutation.isPending}
                className="btn-primary text-sm"
              >
                Publish
              </button>
            )}
            {template.status === 'active' && (
              <button
                onClick={handleArchive}
                disabled={updateMutation.isPending}
                className="rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-2 text-sm font-medium text-yellow-800 hover:bg-yellow-100"
              >
                Archive
              </button>
            )}
            <button
              onClick={openEditModal}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Edit
            </button>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
            >
              Delete
            </button>
          </div>
        </div>

        {/* Tabs: Steps + Conditions */}
        <Tab.Group>
          <Tab.List className="flex space-x-1 rounded-lg bg-gray-100 p-1 mb-6">
            <Tab
              className={({ selected }) =>
                clsx(
                  'w-full rounded-md py-2 text-sm font-medium leading-5 transition-colors',
                  selected
                    ? 'bg-white text-primary-700 shadow'
                    : 'text-gray-600 hover:text-gray-800 hover:bg-white/50'
                )
              }
            >
              Steps ({sortedSteps.length})
            </Tab>
            <Tab
              className={({ selected }) =>
                clsx(
                  'w-full rounded-md py-2 text-sm font-medium leading-5 transition-colors',
                  selected
                    ? 'bg-white text-primary-700 shadow'
                    : 'text-gray-600 hover:text-gray-800 hover:bg-white/50'
                )
              }
            >
              Conditions ({conditions.length})
            </Tab>
          </Tab.List>

          <Tab.Panels>
            {/* Steps Panel */}
            <Tab.Panel>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Workflow Steps</h2>
                <button onClick={openAddStep} className="btn-primary text-sm inline-flex items-center">
                  <PlusIcon className="-ml-1 mr-1.5 h-4 w-4" />
                  Add Step
                </button>
              </div>

              {sortedSteps.length === 0 ? (
                <div className="card p-8 text-center text-sm text-gray-500">
                  No steps defined yet. Add your first step to get started.
                </div>
              ) : (
                <div className="space-y-3">
                  {sortedSteps.map((step, idx) => (
                    <div key={step.id} className="card p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3 min-w-0">
                          <span className="flex-shrink-0 inline-flex items-center justify-center h-7 w-7 rounded-full bg-gray-200 text-xs font-semibold text-gray-700">
                            {step.stepOrder}
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-medium text-gray-900">{step.name}</p>
                              <span
                                className={clsx(
                                  'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                                  stepTypeBadge[step.stepType] ?? 'bg-gray-100 text-gray-800'
                                )}
                              >
                                {formatLabel(step.stepType)}
                              </span>
                              <span
                                className={clsx(
                                  'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                                  ownerBadge[step.owner] ?? 'bg-gray-100 text-gray-800'
                                )}
                              >
                                {formatLabel(step.owner)}
                              </span>
                              {step.isBlocking && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-50 text-red-700">
                                  <LockClosedIcon className="h-3 w-3" />
                                  Blocking
                                </span>
                              )}
                            </div>
                            {step.description && (
                              <p className="mt-1 text-xs text-gray-500">{step.description}</p>
                            )}
                            <div className="mt-1.5 flex items-center gap-4 text-xs text-gray-400">
                              {step.triggerDaysAfterPrev != null && (
                                <span>Trigger: +{step.triggerDaysAfterPrev} days</span>
                              )}
                              {step.requiredDocuments.length > 0 && (
                                <span>Docs: {step.requiredDocuments.join(', ')}</span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                          <button
                            onClick={() => handleMoveStep(idx, 'up')}
                            disabled={idx === 0 || reorderMutation.isPending}
                            className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                            title="Move up"
                          >
                            <ChevronUpIcon className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleMoveStep(idx, 'down')}
                            disabled={idx === sortedSteps.length - 1 || reorderMutation.isPending}
                            className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                            title="Move down"
                          >
                            <ChevronDownIcon className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => openEditStep(step)}
                            className="p-1 text-gray-400 hover:text-primary-600"
                            title="Edit step"
                          >
                            <PencilIcon className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteStep(step.id)}
                            className="p-1 text-gray-400 hover:text-red-600"
                            title="Delete step"
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Tab.Panel>

            {/* Conditions Panel */}
            <Tab.Panel>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Conditions</h2>
                <button
                  onClick={() => {
                    setConditionForm(defaultConditionForm);
                    setShowConditionModal(true);
                  }}
                  className="btn-primary text-sm inline-flex items-center"
                >
                  <PlusIcon className="-ml-1 mr-1.5 h-4 w-4" />
                  Add Condition
                </button>
              </div>

              {conditions.length === 0 ? (
                <div className="card p-8 text-center text-sm text-gray-500">
                  No conditions defined. Conditions modify the workflow based on provider or state attributes.
                </div>
              ) : (
                <div className="card overflow-hidden">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50/80">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Value</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Target Step</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider" />
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {conditions.map((cond) => (
                        <tr key={cond.id}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {formatLabel(cond.conditionType)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                            {cond.conditionValue}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                              {formatLabel(cond.action)}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {cond.targetStepOrder != null ? `Step ${cond.targetStepOrder}` : '\u2014'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right">
                            <button
                              onClick={() => handleDeleteCondition(cond.id)}
                              className="p-1 text-gray-400 hover:text-red-600"
                              title="Delete condition"
                            >
                              <TrashIcon className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Tab.Panel>
          </Tab.Panels>
        </Tab.Group>

        {/* ─── Delete Confirmation Modal ─── */}
        <Transition appear show={showDeleteConfirm} as={Fragment}>
          <Dialog as="div" className="relative z-50" onClose={() => setShowDeleteConfirm(false)}>
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100"
              leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0"
            >
              <div className="fixed inset-0 bg-black/30" />
            </Transition.Child>
            <div className="fixed inset-0 overflow-y-auto">
              <div className="flex min-h-full items-center justify-center p-4">
                <Transition.Child
                  as={Fragment}
                  enter="ease-out duration-200" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100"
                  leave="ease-in duration-150" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95"
                >
                  <Dialog.Panel className="w-full max-w-sm transform rounded-xl bg-white p-6 shadow-xl transition-all">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="flex-shrink-0 rounded-full bg-red-100 p-2">
                        <ExclamationTriangleIcon className="h-5 w-5 text-red-600" />
                      </div>
                      <Dialog.Title as="h3" className="text-lg font-semibold text-gray-900">
                        Delete Template
                      </Dialog.Title>
                    </div>
                    <p className="text-sm text-gray-500">
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
                        disabled={deleteMutation.isPending}
                        className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </Dialog.Panel>
                </Transition.Child>
              </div>
            </div>
          </Dialog>
        </Transition>

        {/* ─── Edit Template Modal ─── */}
        <Transition appear show={showEditModal} as={Fragment}>
          <Dialog as="div" className="relative z-50" onClose={() => setShowEditModal(false)}>
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100"
              leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0"
            >
              <div className="fixed inset-0 bg-black/30" />
            </Transition.Child>
            <div className="fixed inset-0 overflow-y-auto">
              <div className="flex min-h-full items-center justify-center p-4">
                <Transition.Child
                  as={Fragment}
                  enter="ease-out duration-200" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100"
                  leave="ease-in duration-150" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95"
                >
                  <Dialog.Panel className="w-full max-w-md transform rounded-xl bg-white p-6 shadow-xl transition-all">
                    <Dialog.Title as="h3" className="text-lg font-semibold text-gray-900">
                      Edit Template
                    </Dialog.Title>
                    <div className="mt-4 space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
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
                        onClick={() => setShowEditModal(false)}
                        className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleEditSave}
                        disabled={!editName.trim() || updateMutation.isPending}
                        className="btn-primary text-sm disabled:opacity-50"
                      >
                        {updateMutation.isPending ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </Dialog.Panel>
                </Transition.Child>
              </div>
            </div>
          </Dialog>
        </Transition>

        {/* ─── Step Modal (Add / Edit) ─── */}
        <Transition appear show={showStepModal} as={Fragment}>
          <Dialog as="div" className="relative z-50" onClose={() => setShowStepModal(false)}>
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100"
              leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0"
            >
              <div className="fixed inset-0 bg-black/30" />
            </Transition.Child>
            <div className="fixed inset-0 overflow-y-auto">
              <div className="flex min-h-full items-center justify-center p-4">
                <Transition.Child
                  as={Fragment}
                  enter="ease-out duration-200" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100"
                  leave="ease-in duration-150" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95"
                >
                  <Dialog.Panel className="w-full max-w-lg transform rounded-xl bg-white p-6 shadow-xl transition-all max-h-[90vh] overflow-y-auto">
                    <Dialog.Title as="h3" className="text-lg font-semibold text-gray-900">
                      {editingStep ? 'Edit Step' : 'Add Step'}
                    </Dialog.Title>
                    <div className="mt-4 space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Name <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={stepForm.name}
                          onChange={(e) => setStepForm({ ...stepForm, name: e.target.value })}
                          placeholder="e.g. Submit CAQH Authorization"
                          className="block w-full rounded-lg border border-gray-300 bg-white py-2 px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Step Type</label>
                          <select
                            value={stepForm.stepType}
                            onChange={(e) => setStepForm({ ...stepForm, stepType: e.target.value })}
                            className="block w-full rounded-lg border border-gray-300 bg-white py-2 px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                          >
                            {STEP_TYPES.map((t) => (
                              <option key={t} value={t}>{formatLabel(t)}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Owner</label>
                          <select
                            value={stepForm.owner}
                            onChange={(e) => setStepForm({ ...stepForm, owner: e.target.value })}
                            className="block w-full rounded-lg border border-gray-300 bg-white py-2 px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                          >
                            {OWNERS.map((o) => (
                              <option key={o} value={o}>{formatLabel(o)}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                        <textarea
                          value={stepForm.description}
                          onChange={(e) => setStepForm({ ...stepForm, description: e.target.value })}
                          rows={2}
                          className="block w-full rounded-lg border border-gray-300 bg-white py-2 px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Trigger Days After Prev</label>
                          <input
                            type="number"
                            value={stepForm.triggerDaysAfterPrev}
                            onChange={(e) => setStepForm({ ...stepForm, triggerDaysAfterPrev: e.target.value })}
                            min={0}
                            placeholder="0"
                            className="block w-full rounded-lg border border-gray-300 bg-white py-2 px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                          />
                        </div>
                        <div className="flex items-end">
                          <label className="flex items-center gap-2 text-sm text-gray-700 pb-2">
                            <input
                              type="checkbox"
                              checked={stepForm.isBlocking}
                              onChange={(e) => setStepForm({ ...stepForm, isBlocking: e.target.checked })}
                              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                            />
                            Blocking step
                          </label>
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Required Documents <span className="text-xs text-gray-400">(comma-separated)</span>
                        </label>
                        <input
                          type="text"
                          value={stepForm.requiredDocuments}
                          onChange={(e) => setStepForm({ ...stepForm, requiredDocuments: e.target.value })}
                          placeholder="e.g. W-9, DEA Certificate"
                          className="block w-full rounded-lg border border-gray-300 bg-white py-2 px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Reviewer Instructions</label>
                        <textarea
                          value={stepForm.reviewerInstructions}
                          onChange={(e) => setStepForm({ ...stepForm, reviewerInstructions: e.target.value })}
                          rows={2}
                          placeholder="Instructions for the reviewer..."
                          className="block w-full rounded-lg border border-gray-300 bg-white py-2 px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                        />
                      </div>
                    </div>
                    <div className="mt-6 flex justify-end gap-3">
                      <button
                        onClick={() => setShowStepModal(false)}
                        className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleStepSave}
                        disabled={!stepForm.name.trim() || createStepMutation.isPending || updateStepMutation.isPending}
                        className="btn-primary text-sm disabled:opacity-50"
                      >
                        {(createStepMutation.isPending || updateStepMutation.isPending) ? 'Saving...' : editingStep ? 'Update Step' : 'Add Step'}
                      </button>
                    </div>
                  </Dialog.Panel>
                </Transition.Child>
              </div>
            </div>
          </Dialog>
        </Transition>

        {/* ─── Condition Modal ─── */}
        <Transition appear show={showConditionModal} as={Fragment}>
          <Dialog as="div" className="relative z-50" onClose={() => setShowConditionModal(false)}>
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100"
              leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0"
            >
              <div className="fixed inset-0 bg-black/30" />
            </Transition.Child>
            <div className="fixed inset-0 overflow-y-auto">
              <div className="flex min-h-full items-center justify-center p-4">
                <Transition.Child
                  as={Fragment}
                  enter="ease-out duration-200" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100"
                  leave="ease-in duration-150" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95"
                >
                  <Dialog.Panel className="w-full max-w-md transform rounded-xl bg-white p-6 shadow-xl transition-all">
                    <Dialog.Title as="h3" className="text-lg font-semibold text-gray-900">
                      Add Condition
                    </Dialog.Title>
                    <div className="mt-4 space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Condition Type</label>
                        <select
                          value={conditionForm.conditionType}
                          onChange={(e) => setConditionForm({ ...conditionForm, conditionType: e.target.value })}
                          className="block w-full rounded-lg border border-gray-300 bg-white py-2 px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                        >
                          {CONDITION_TYPES.map((t) => (
                            <option key={t} value={t}>{formatLabel(t)}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Condition Value <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={conditionForm.conditionValue}
                          onChange={(e) => setConditionForm({ ...conditionForm, conditionValue: e.target.value })}
                          placeholder="e.g. CA, MD, true"
                          className="block w-full rounded-lg border border-gray-300 bg-white py-2 px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Action</label>
                        <select
                          value={conditionForm.action}
                          onChange={(e) => setConditionForm({ ...conditionForm, action: e.target.value })}
                          className="block w-full rounded-lg border border-gray-300 bg-white py-2 px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                        >
                          {CONDITION_ACTIONS.map((a) => (
                            <option key={a} value={a}>{formatLabel(a)}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Target Step Order</label>
                        <input
                          type="number"
                          value={conditionForm.targetStepOrder}
                          onChange={(e) => setConditionForm({ ...conditionForm, targetStepOrder: e.target.value })}
                          min={1}
                          placeholder="Step number"
                          className="block w-full rounded-lg border border-gray-300 bg-white py-2 px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                        />
                      </div>
                    </div>
                    <div className="mt-6 flex justify-end gap-3">
                      <button
                        onClick={() => setShowConditionModal(false)}
                        className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleAddCondition}
                        disabled={!conditionForm.conditionValue.trim() || createConditionMutation.isPending}
                        className="btn-primary text-sm disabled:opacity-50"
                      >
                        {createConditionMutation.isPending ? 'Adding...' : 'Add Condition'}
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
