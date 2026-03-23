import { useState, Fragment } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Tab, Dialog, Transition } from '@headlessui/react';
import {
  ArrowLeftIcon,
  PencilIcon,
  TrashIcon,
  PlusIcon,
  XMarkIcon,
  CheckCircleIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { useForm } from 'react-hook-form';
import {
  usePayerTrack,
  useUpdatePayerTrack,
  useDeletePayerTrack,
  useCreateContact,
  useUpdateContact,
  useDeleteContact,
  useCreateTimeline,
  useUpdateTimeline,
  useDeleteTimeline,
  useCreateStateRule,
  useUpdateStateRule,
  useDeleteStateRule,
  useCreateForm,
  useUpdateForm,
  useDeleteForm,
  useCreateRequirement,
  useUpdateRequirement,
  useDeleteRequirement,
} from '../../hooks/useKnowledgeBase';
import type {
  PayerContact,
  PayerTimeline,
  PayerStateRule,
  PayerForm,
  PayerRequirement,
  PayerTrack,
} from '../../hooks/useKnowledgeBase';
import PageTransition from '../../components/ui/PageTransition';

// ==========================================
// Generic Confirm Dialog
// ==========================================

function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  loading,
}: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  loading?: boolean;
}) {
  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/25" />
        </Transition.Child>
        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-sm transform overflow-hidden rounded-xl bg-white p-6 shadow-xl transition-all">
                <Dialog.Title className="text-lg font-semibold text-gray-900">
                  {title}
                </Dialog.Title>
                <p className="mt-2 text-sm text-gray-500">{message}</p>
                <div className="mt-4 flex justify-end gap-3">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={onClose}
                    disabled={loading}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
                    onClick={onConfirm}
                    disabled={loading}
                  >
                    {loading ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}

// ==========================================
// Generic Modal Shell
// ==========================================

function ModalShell({
  isOpen,
  onClose,
  title,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/25" />
        </Transition.Child>
        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-xl bg-white p-6 shadow-xl transition-all">
                <div className="flex items-center justify-between mb-4">
                  <Dialog.Title className="text-lg font-semibold text-gray-900">
                    {title}
                  </Dialog.Title>
                  <button
                    onClick={onClose}
                    className="text-gray-400 hover:text-gray-500"
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>
                {children}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}

// ==========================================
// Form field helper
// ==========================================

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

const inputClass =
  'block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500';

// ==========================================
// Edit PayerTrack Modal
// ==========================================

function EditPayerTrackModal({
  isOpen,
  onClose,
  payerTrack,
}: {
  isOpen: boolean;
  onClose: () => void;
  payerTrack: PayerTrack;
}) {
  const updateMutation = useUpdatePayerTrack();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    defaultValues: {
      payerName: payerTrack.payerName,
      parentOrg: payerTrack.parentOrg || '',
      payerType: payerTrack.payerType,
      stateRegion: payerTrack.stateRegion,
      track: payerTrack.track,
      submissionMethod: payerTrack.submissionMethod,
      enrollmentLink: payerTrack.enrollmentLink || '',
      portalUrl: payerTrack.portalUrl || '',
      productLines: payerTrack.productLines.join(', '),
      notes: payerTrack.notes || '',
      isActive: payerTrack.isActive,
    },
  });

  const onSubmit = (data: Record<string, unknown>) => {
    const productLines =
      typeof data.productLines === 'string'
        ? data.productLines
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean)
        : [];
    updateMutation.mutate(
      {
        id: payerTrack.id,
        payerName: data.payerName as string,
        parentOrg: (data.parentOrg as string) || null,
        payerType: data.payerType as string,
        stateRegion: data.stateRegion as string,
        track: data.track as string,
        submissionMethod: data.submissionMethod as string,
        enrollmentLink: (data.enrollmentLink as string) || null,
        portalUrl: (data.portalUrl as string) || null,
        productLines,
        notes: (data.notes as string) || null,
        isActive: data.isActive as boolean,
      },
      {
        onSuccess: () => {
          toast.success('Payer track updated');
          onClose();
        },
        onError: () => toast.error('Failed to update payer track'),
      }
    );
  };

  return (
    <ModalShell isOpen={isOpen} onClose={onClose} title="Edit Payer Track">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Field label="Payer Name" error={errors.payerName?.message}>
          <input
            {...register('payerName', { required: 'Required' })}
            className={inputClass}
          />
        </Field>
        <Field label="Parent Org">
          <input {...register('parentOrg')} className={inputClass} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Payer Type" error={errors.payerType?.message}>
            <input
              {...register('payerType', { required: 'Required' })}
              className={inputClass}
            />
          </Field>
          <Field label="State/Region" error={errors.stateRegion?.message}>
            <input
              {...register('stateRegion', { required: 'Required' })}
              className={inputClass}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Track" error={errors.track?.message}>
            <input
              {...register('track', { required: 'Required' })}
              className={inputClass}
            />
          </Field>
          <Field
            label="Submission Method"
            error={errors.submissionMethod?.message}
          >
            <input
              {...register('submissionMethod', { required: 'Required' })}
              className={inputClass}
            />
          </Field>
        </div>
        <Field label="Portal URL">
          <input {...register('portalUrl')} className={inputClass} />
        </Field>
        <Field label="Enrollment Link">
          <input {...register('enrollmentLink')} className={inputClass} />
        </Field>
        <Field label="Product Lines (comma-separated)">
          <input {...register('productLines')} className={inputClass} />
        </Field>
        <Field label="Notes">
          <textarea {...register('notes')} rows={2} className={inputClass} />
        </Field>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            {...register('isActive')}
            id="isActive"
            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          />
          <label htmlFor="isActive" className="text-sm text-gray-700">
            Active
          </label>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={updateMutation.isPending}
          >
            {updateMutation.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ==========================================
// Contact Modal
// ==========================================

type ContactFormData = Omit<PayerContact, 'id' | 'payerTrackId' | 'createdAt'>;

function ContactModal({
  isOpen,
  onClose,
  trackId,
  contact,
}: {
  isOpen: boolean;
  onClose: () => void;
  trackId: string;
  contact?: PayerContact;
}) {
  const createMutation = useCreateContact();
  const updateMutation = useUpdateContact();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ContactFormData>({
    defaultValues: contact
      ? {
          contactType: contact.contactType,
          phone: contact.phone || '',
          email: contact.email || '',
          fax: contact.fax || '',
          portalUrl: contact.portalUrl || '',
          hours: contact.hours || '',
          notes: contact.notes || '',
        }
      : { contactType: '', phone: '', email: '', fax: '', portalUrl: '', hours: '', notes: '' },
  });

  const onSubmit = (data: ContactFormData) => {
    const payload = {
      ...data,
      phone: data.phone || null,
      email: data.email || null,
      fax: data.fax || null,
      portalUrl: data.portalUrl || null,
      hours: data.hours || null,
      notes: data.notes || null,
    };
    if (contact) {
      updateMutation.mutate(
        { id: contact.id, ...payload },
        {
          onSuccess: () => {
            toast.success('Contact updated');
            onClose();
          },
          onError: () => toast.error('Failed to update contact'),
        }
      );
    } else {
      createMutation.mutate(
        { trackId, ...payload },
        {
          onSuccess: () => {
            toast.success('Contact created');
            onClose();
          },
          onError: () => toast.error('Failed to create contact'),
        }
      );
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title={contact ? 'Edit Contact' : 'Add Contact'}
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Field label="Contact Type" error={errors.contactType?.message}>
          <input
            {...register('contactType', { required: 'Required' })}
            className={inputClass}
            placeholder="e.g. Provider Relations, Claims"
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Phone">
            <input {...register('phone')} className={inputClass} />
          </Field>
          <Field label="Fax">
            <input {...register('fax')} className={inputClass} />
          </Field>
        </div>
        <Field label="Email">
          <input {...register('email')} type="email" className={inputClass} />
        </Field>
        <Field label="Portal URL">
          <input {...register('portalUrl')} className={inputClass} />
        </Field>
        <Field label="Hours">
          <input
            {...register('hours')}
            className={inputClass}
            placeholder="e.g. Mon-Fri 8am-5pm EST"
          />
        </Field>
        <Field label="Notes">
          <textarea {...register('notes')} rows={2} className={inputClass} />
        </Field>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={isPending}>
            {isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ==========================================
// Timeline Modal
// ==========================================

type TimelineFormData = {
  processType: string;
  minDays: string;
  maxDays: string;
  notes: string;
};

function TimelineModal({
  isOpen,
  onClose,
  trackId,
  timeline,
}: {
  isOpen: boolean;
  onClose: () => void;
  trackId: string;
  timeline?: PayerTimeline;
}) {
  const createMutation = useCreateTimeline();
  const updateMutation = useUpdateTimeline();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<TimelineFormData>({
    defaultValues: timeline
      ? {
          processType: timeline.processType,
          minDays: timeline.minDays?.toString() || '',
          maxDays: timeline.maxDays?.toString() || '',
          notes: timeline.notes || '',
        }
      : { processType: '', minDays: '', maxDays: '', notes: '' },
  });

  const onSubmit = (data: TimelineFormData) => {
    const payload = {
      processType: data.processType,
      minDays: data.minDays ? Number(data.minDays) : null,
      maxDays: data.maxDays ? Number(data.maxDays) : null,
      notes: data.notes || null,
      stateOverrides: null,
    };
    if (timeline) {
      updateMutation.mutate(
        { id: timeline.id, ...payload },
        {
          onSuccess: () => {
            toast.success('Timeline updated');
            onClose();
          },
          onError: () => toast.error('Failed to update timeline'),
        }
      );
    } else {
      createMutation.mutate(
        { trackId, ...payload },
        {
          onSuccess: () => {
            toast.success('Timeline created');
            onClose();
          },
          onError: () => toast.error('Failed to create timeline'),
        }
      );
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title={timeline ? 'Edit Timeline' : 'Add Timeline'}
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Field label="Process Type" error={errors.processType?.message}>
          <input
            {...register('processType', { required: 'Required' })}
            className={inputClass}
            placeholder="e.g. Initial, Revalidation"
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Min Days">
            <input
              {...register('minDays')}
              type="number"
              className={inputClass}
            />
          </Field>
          <Field label="Max Days">
            <input
              {...register('maxDays')}
              type="number"
              className={inputClass}
            />
          </Field>
        </div>
        <Field label="Notes">
          <textarea {...register('notes')} rows={2} className={inputClass} />
        </Field>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={isPending}>
            {isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ==========================================
// State Rule Modal
// ==========================================

type StateRuleFormData = {
  state: string;
  ruleType: string;
  description: string;
  effectiveDate: string;
  expirationDate: string;
};

function StateRuleModal({
  isOpen,
  onClose,
  trackId,
  stateRule,
}: {
  isOpen: boolean;
  onClose: () => void;
  trackId: string;
  stateRule?: PayerStateRule;
}) {
  const createMutation = useCreateStateRule();
  const updateMutation = useUpdateStateRule();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<StateRuleFormData>({
    defaultValues: stateRule
      ? {
          state: stateRule.state,
          ruleType: stateRule.ruleType,
          description: stateRule.description,
          effectiveDate: stateRule.effectiveDate?.split('T')[0] || '',
          expirationDate: stateRule.expirationDate?.split('T')[0] || '',
        }
      : {
          state: '',
          ruleType: '',
          description: '',
          effectiveDate: '',
          expirationDate: '',
        },
  });

  const onSubmit = (data: StateRuleFormData) => {
    const payload = {
      state: data.state,
      ruleType: data.ruleType,
      description: data.description,
      effectiveDate: data.effectiveDate || null,
      expirationDate: data.expirationDate || null,
    };
    if (stateRule) {
      updateMutation.mutate(
        { id: stateRule.id, ...payload },
        {
          onSuccess: () => {
            toast.success('State rule updated');
            onClose();
          },
          onError: () => toast.error('Failed to update state rule'),
        }
      );
    } else {
      createMutation.mutate(
        { trackId, ...payload },
        {
          onSuccess: () => {
            toast.success('State rule created');
            onClose();
          },
          onError: () => toast.error('Failed to create state rule'),
        }
      );
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title={stateRule ? 'Edit State Rule' : 'Add State Rule'}
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="State" error={errors.state?.message}>
            <input
              {...register('state', { required: 'Required' })}
              className={inputClass}
              placeholder="e.g. CA, NY"
            />
          </Field>
          <Field label="Rule Type" error={errors.ruleType?.message}>
            <input
              {...register('ruleType', { required: 'Required' })}
              className={inputClass}
            />
          </Field>
        </div>
        <Field label="Description" error={errors.description?.message}>
          <textarea
            {...register('description', { required: 'Required' })}
            rows={3}
            className={inputClass}
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Effective Date">
            <input
              {...register('effectiveDate')}
              type="date"
              className={inputClass}
            />
          </Field>
          <Field label="Expiration Date">
            <input
              {...register('expirationDate')}
              type="date"
              className={inputClass}
            />
          </Field>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={isPending}>
            {isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ==========================================
// Form Modal (PayerForm)
// ==========================================

type FormFormData = {
  formName: string;
  format: string;
  url: string;
  destination: string;
  isRequired: boolean;
  notes: string;
};

function FormModal({
  isOpen,
  onClose,
  trackId,
  payerForm,
}: {
  isOpen: boolean;
  onClose: () => void;
  trackId: string;
  payerForm?: PayerForm;
}) {
  const createMutation = useCreateForm();
  const updateMutation = useUpdateForm();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormFormData>({
    defaultValues: payerForm
      ? {
          formName: payerForm.formName,
          format: payerForm.format,
          url: payerForm.url || '',
          destination: payerForm.destination || '',
          isRequired: payerForm.isRequired,
          notes: payerForm.notes || '',
        }
      : {
          formName: '',
          format: '',
          url: '',
          destination: '',
          isRequired: false,
          notes: '',
        },
  });

  const onSubmit = (data: FormFormData) => {
    const payload = {
      formName: data.formName,
      format: data.format,
      url: data.url || null,
      destination: data.destination || null,
      isRequired: data.isRequired,
      notes: data.notes || null,
    };
    if (payerForm) {
      updateMutation.mutate(
        { id: payerForm.id, ...payload },
        {
          onSuccess: () => {
            toast.success('Form updated');
            onClose();
          },
          onError: () => toast.error('Failed to update form'),
        }
      );
    } else {
      createMutation.mutate(
        { trackId, ...payload },
        {
          onSuccess: () => {
            toast.success('Form created');
            onClose();
          },
          onError: () => toast.error('Failed to create form'),
        }
      );
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title={payerForm ? 'Edit Form' : 'Add Form'}
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Field label="Form Name" error={errors.formName?.message}>
          <input
            {...register('formName', { required: 'Required' })}
            className={inputClass}
          />
        </Field>
        <Field label="Format" error={errors.format?.message}>
          <input
            {...register('format', { required: 'Required' })}
            className={inputClass}
            placeholder="e.g. PDF, Online, Paper"
          />
        </Field>
        <Field label="URL">
          <input {...register('url')} className={inputClass} />
        </Field>
        <Field label="Destination">
          <input
            {...register('destination')}
            className={inputClass}
            placeholder="e.g. Fax to 555-1234, Upload to portal"
          />
        </Field>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            {...register('isRequired')}
            id="formIsRequired"
            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          />
          <label htmlFor="formIsRequired" className="text-sm text-gray-700">
            Required
          </label>
        </div>
        <Field label="Notes">
          <textarea {...register('notes')} rows={2} className={inputClass} />
        </Field>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={isPending}>
            {isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ==========================================
// Requirement Modal
// ==========================================

type RequirementFormData = {
  name: string;
  overrideType: string;
  rule: string;
  appliesTo: string;
  isBlocking: boolean;
  source: string;
};

function RequirementModal({
  isOpen,
  onClose,
  trackId,
  requirement,
}: {
  isOpen: boolean;
  onClose: () => void;
  trackId: string;
  requirement?: PayerRequirement;
}) {
  const createMutation = useCreateRequirement();
  const updateMutation = useUpdateRequirement();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RequirementFormData>({
    defaultValues: requirement
      ? {
          name: requirement.name,
          overrideType: requirement.overrideType,
          rule: requirement.rule,
          appliesTo: requirement.appliesTo || '',
          isBlocking: requirement.isBlocking,
          source: requirement.source || '',
        }
      : {
          name: '',
          overrideType: '',
          rule: '',
          appliesTo: '',
          isBlocking: false,
          source: '',
        },
  });

  const onSubmit = (data: RequirementFormData) => {
    const payload = {
      name: data.name,
      overrideType: data.overrideType,
      rule: data.rule,
      appliesTo: data.appliesTo || null,
      isBlocking: data.isBlocking,
      source: data.source || null,
    };
    if (requirement) {
      updateMutation.mutate(
        { id: requirement.id, ...payload },
        {
          onSuccess: () => {
            toast.success('Requirement updated');
            onClose();
          },
          onError: () => toast.error('Failed to update requirement'),
        }
      );
    } else {
      createMutation.mutate(
        { trackId, ...payload },
        {
          onSuccess: () => {
            toast.success('Requirement created');
            onClose();
          },
          onError: () => toast.error('Failed to create requirement'),
        }
      );
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title={requirement ? 'Edit Requirement' : 'Add Requirement'}
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Field label="Name" error={errors.name?.message}>
          <input
            {...register('name', { required: 'Required' })}
            className={inputClass}
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Override Type" error={errors.overrideType?.message}>
            <input
              {...register('overrideType', { required: 'Required' })}
              className={inputClass}
            />
          </Field>
          <Field label="Applies To">
            <input
              {...register('appliesTo')}
              className={inputClass}
              placeholder="e.g. MD, DO, NP"
            />
          </Field>
        </div>
        <Field label="Rule" error={errors.rule?.message}>
          <textarea
            {...register('rule', { required: 'Required' })}
            rows={2}
            className={inputClass}
          />
        </Field>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            {...register('isBlocking')}
            id="reqIsBlocking"
            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          />
          <label htmlFor="reqIsBlocking" className="text-sm text-gray-700">
            Blocking
          </label>
        </div>
        <Field label="Source">
          <input
            {...register('source')}
            className={inputClass}
            placeholder="e.g. Payer manual, Website"
          />
        </Field>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={isPending}>
            {isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ==========================================
// Stat Card
// ==========================================

function StatCard({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
        {label}
      </p>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 text-sm font-medium text-primary-600 hover:text-primary-500 truncate block"
        >
          {value}
        </a>
      ) : (
        <p className="mt-1 text-sm font-semibold text-gray-900 truncate">
          {value}
        </p>
      )}
    </div>
  );
}

// ==========================================
// Tab content sections
// ==========================================

function SectionHeader({
  title,
  onAdd,
}: {
  title: string;
  onAdd: () => void;
}) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      <button
        onClick={onAdd}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700"
      >
        <PlusIcon className="h-4 w-4" />
        Add
      </button>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <p className="text-sm text-gray-400 text-center py-8">
      No {label} yet. Click Add to create one.
    </p>
  );
}

function ActionCell({
  onEdit,
  onDelete,
}: {
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <td className="px-4 py-3 text-right">
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={onEdit}
          className="text-gray-400 hover:text-primary-600"
        >
          <PencilIcon className="h-4 w-4" />
        </button>
        <button
          onClick={onDelete}
          className="text-gray-400 hover:text-red-600"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      </div>
    </td>
  );
}

// ==========================================
// Main Component
// ==========================================

export default function KnowledgeBaseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: payerTrack, isLoading } = usePayerTrack(id);
  const deleteTrackMutation = useDeletePayerTrack();
  const deleteContactMutation = useDeleteContact();
  const deleteTimelineMutation = useDeleteTimeline();
  const deleteStateRuleMutation = useDeleteStateRule();
  const deleteFormMutation = useDeleteForm();
  const deleteRequirementMutation = useDeleteRequirement();

  // Modal state
  const [editTrackOpen, setEditTrackOpen] = useState(false);
  const [deleteTrackOpen, setDeleteTrackOpen] = useState(false);

  // Contact state
  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<PayerContact | undefined>();
  const [deletingContactId, setDeletingContactId] = useState<string | null>(null);

  // Timeline state
  const [timelineModalOpen, setTimelineModalOpen] = useState(false);
  const [editingTimeline, setEditingTimeline] = useState<PayerTimeline | undefined>();
  const [deletingTimelineId, setDeletingTimelineId] = useState<string | null>(null);

  // State Rule state
  const [stateRuleModalOpen, setStateRuleModalOpen] = useState(false);
  const [editingStateRule, setEditingStateRule] = useState<PayerStateRule | undefined>();
  const [deletingStateRuleId, setDeletingStateRuleId] = useState<string | null>(null);

  // Form state
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingForm, setEditingForm] = useState<PayerForm | undefined>();
  const [deletingFormId, setDeletingFormId] = useState<string | null>(null);

  // Requirement state
  const [requirementModalOpen, setRequirementModalOpen] = useState(false);
  const [editingRequirement, setEditingRequirement] = useState<PayerRequirement | undefined>();
  const [deletingRequirementId, setDeletingRequirementId] = useState<string | null>(null);

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-2 border-gray-200 border-t-primary-600" />
      </div>
    );
  }

  // Not found
  if (!payerTrack) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Payer track not found</p>
        <Link
          to="/admin/knowledge-base"
          className="text-primary-600 hover:underline mt-2 inline-block"
        >
          Back to Knowledge Base
        </Link>
      </div>
    );
  }

  const handleDeleteTrack = () => {
    deleteTrackMutation.mutate(payerTrack.id, {
      onSuccess: () => {
        toast.success('Payer track deleted');
        navigate('/admin/knowledge-base');
      },
      onError: () => toast.error('Failed to delete payer track'),
    });
  };

  const handleDeleteChild = (
    type: 'contact' | 'timeline' | 'stateRule' | 'form' | 'requirement',
    childId: string
  ) => {
    const mutations = {
      contact: deleteContactMutation,
      timeline: deleteTimelineMutation,
      stateRule: deleteStateRuleMutation,
      form: deleteFormMutation,
      requirement: deleteRequirementMutation,
    };
    const labels = {
      contact: 'Contact',
      timeline: 'Timeline',
      stateRule: 'State rule',
      form: 'Form',
      requirement: 'Requirement',
    };
    const setters = {
      contact: setDeletingContactId,
      timeline: setDeletingTimelineId,
      stateRule: setDeletingStateRuleId,
      form: setDeletingFormId,
      requirement: setDeletingRequirementId,
    };

    mutations[type].mutate(childId, {
      onSuccess: () => {
        toast.success(`${labels[type]} deleted`);
        setters[type](null);
      },
      onError: () => toast.error(`Failed to delete ${labels[type].toLowerCase()}`),
    });
  };

  const contacts = payerTrack.contacts || [];
  const timelines = payerTrack.timelines || [];
  const stateRules = payerTrack.stateRules || [];
  const forms = payerTrack.forms || [];
  const requirements = payerTrack.requirements || [];

  const thClass = 'px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const tdClass = 'px-4 py-3 text-sm text-gray-700';

  return (
    <PageTransition>
      <div>
        {/* Back link */}
        <Link
          to="/admin/knowledge-base"
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-6"
        >
          <ArrowLeftIcon className="h-4 w-4 mr-1" />
          Back to Knowledge Base
        </Link>

        {/* Header */}
        <div className="sm:flex sm:items-center sm:justify-between mb-6">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">
                {payerTrack.payerName} &mdash; {payerTrack.track}
              </h1>
              <span
                className={clsx(
                  'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                  payerTrack.isActive
                    ? 'bg-green-100 text-green-800'
                    : 'bg-gray-100 text-gray-600'
                )}
              >
                {payerTrack.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              {payerTrack.stateRegion}
              {payerTrack.parentOrg && ` | ${payerTrack.parentOrg}`}
              {' | '}
              {payerTrack.payerType}
            </p>
          </div>
          <div className="flex items-center gap-3 mt-4 sm:mt-0">
            <button
              onClick={() => setEditTrackOpen(true)}
              className="btn-secondary"
            >
              <PencilIcon className="-ml-1 mr-2 h-5 w-5" />
              Edit
            </button>
            <button
              onClick={() => setDeleteTrackOpen(true)}
              className="inline-flex items-center px-4 py-2 text-sm font-medium text-red-700 bg-red-50 rounded-lg hover:bg-red-100 border border-red-200"
            >
              <TrashIcon className="-ml-1 mr-2 h-5 w-5" />
              Delete
            </button>
          </div>
        </div>

        {/* Info cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard label="Submission Method" value={payerTrack.submissionMethod} />
          <StatCard
            label="Portal URL"
            value={payerTrack.portalUrl || 'Not set'}
            href={payerTrack.portalUrl || undefined}
          />
          <StatCard
            label="Enrollment Link"
            value={payerTrack.enrollmentLink || 'Not set'}
            href={payerTrack.enrollmentLink || undefined}
          />
          <StatCard
            label="Product Lines"
            value={
              payerTrack.productLines.length > 0
                ? payerTrack.productLines.join(', ')
                : 'None'
            }
          />
        </div>

        {/* Tabs */}
        <Tab.Group>
          <Tab.List className="flex space-x-1 border-b border-gray-200 mb-6">
            {['Contacts', 'Timelines', 'State Rules', 'Forms', 'Requirements'].map(
              (tab) => (
                <Tab
                  key={tab}
                  className={({ selected }) =>
                    clsx(
                      'py-2.5 px-4 text-sm font-medium border-b-2 -mb-px transition-colors focus:outline-none',
                      selected
                        ? 'border-primary-600 text-primary-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    )
                  }
                >
                  {tab}
                </Tab>
              )
            )}
          </Tab.List>

          <Tab.Panels>
            {/* ========== Contacts ========== */}
            <Tab.Panel>
              <SectionHeader
                title="Contacts"
                onAdd={() => {
                  setEditingContact(undefined);
                  setContactModalOpen(true);
                }}
              />
              {contacts.length === 0 ? (
                <EmptyState label="contacts" />
              ) : (
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className={thClass}>Type</th>
                        <th className={thClass}>Phone</th>
                        <th className={thClass}>Email</th>
                        <th className={thClass}>Fax</th>
                        <th className={thClass}>Portal URL</th>
                        <th className={thClass}>Hours</th>
                        <th className={thClass} />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                      {contacts.map((c) => (
                        <tr key={c.id}>
                          <td className={tdClass}>{c.contactType}</td>
                          <td className={tdClass}>{c.phone || '--'}</td>
                          <td className={tdClass}>{c.email || '--'}</td>
                          <td className={tdClass}>{c.fax || '--'}</td>
                          <td className={tdClass}>
                            {c.portalUrl ? (
                              <a
                                href={c.portalUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary-600 hover:underline"
                              >
                                Link
                              </a>
                            ) : (
                              '--'
                            )}
                          </td>
                          <td className={tdClass}>{c.hours || '--'}</td>
                          <ActionCell
                            onEdit={() => {
                              setEditingContact(c);
                              setContactModalOpen(true);
                            }}
                            onDelete={() => setDeletingContactId(c.id)}
                          />
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Tab.Panel>

            {/* ========== Timelines ========== */}
            <Tab.Panel>
              <SectionHeader
                title="Timelines"
                onAdd={() => {
                  setEditingTimeline(undefined);
                  setTimelineModalOpen(true);
                }}
              />
              {timelines.length === 0 ? (
                <EmptyState label="timelines" />
              ) : (
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className={thClass}>Process Type</th>
                        <th className={thClass}>Min Days</th>
                        <th className={thClass}>Max Days</th>
                        <th className={thClass}>Notes</th>
                        <th className={thClass} />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                      {timelines.map((t) => (
                        <tr key={t.id}>
                          <td className={tdClass}>{t.processType}</td>
                          <td className={tdClass}>{t.minDays ?? '--'}</td>
                          <td className={tdClass}>{t.maxDays ?? '--'}</td>
                          <td className={clsx(tdClass, 'max-w-xs truncate')}>
                            {t.notes || '--'}
                          </td>
                          <ActionCell
                            onEdit={() => {
                              setEditingTimeline(t);
                              setTimelineModalOpen(true);
                            }}
                            onDelete={() => setDeletingTimelineId(t.id)}
                          />
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Tab.Panel>

            {/* ========== State Rules ========== */}
            <Tab.Panel>
              <SectionHeader
                title="State Rules"
                onAdd={() => {
                  setEditingStateRule(undefined);
                  setStateRuleModalOpen(true);
                }}
              />
              {stateRules.length === 0 ? (
                <EmptyState label="state rules" />
              ) : (
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className={thClass}>State</th>
                        <th className={thClass}>Rule Type</th>
                        <th className={thClass}>Description</th>
                        <th className={thClass}>Effective Date</th>
                        <th className={thClass}>Expiration</th>
                        <th className={thClass} />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                      {stateRules.map((sr) => (
                        <tr key={sr.id}>
                          <td className={tdClass}>{sr.state}</td>
                          <td className={tdClass}>{sr.ruleType}</td>
                          <td className={clsx(tdClass, 'max-w-xs truncate')}>
                            {sr.description}
                          </td>
                          <td className={tdClass}>
                            {sr.effectiveDate
                              ? new Date(sr.effectiveDate).toLocaleDateString()
                              : '--'}
                          </td>
                          <td className={tdClass}>
                            {sr.expirationDate
                              ? new Date(sr.expirationDate).toLocaleDateString()
                              : '--'}
                          </td>
                          <ActionCell
                            onEdit={() => {
                              setEditingStateRule(sr);
                              setStateRuleModalOpen(true);
                            }}
                            onDelete={() => setDeletingStateRuleId(sr.id)}
                          />
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Tab.Panel>

            {/* ========== Forms ========== */}
            <Tab.Panel>
              <SectionHeader
                title="Forms"
                onAdd={() => {
                  setEditingForm(undefined);
                  setFormModalOpen(true);
                }}
              />
              {forms.length === 0 ? (
                <EmptyState label="forms" />
              ) : (
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className={thClass}>Form Name</th>
                        <th className={thClass}>Format</th>
                        <th className={thClass}>URL / Destination</th>
                        <th className={thClass}>Required</th>
                        <th className={thClass}>Notes</th>
                        <th className={thClass} />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                      {forms.map((f) => (
                        <tr key={f.id}>
                          <td className={tdClass}>{f.formName}</td>
                          <td className={tdClass}>{f.format}</td>
                          <td className={tdClass}>
                            {f.url ? (
                              <a
                                href={f.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary-600 hover:underline"
                              >
                                Link
                              </a>
                            ) : (
                              f.destination || '--'
                            )}
                          </td>
                          <td className={tdClass}>
                            {f.isRequired ? (
                              <CheckCircleIcon className="h-5 w-5 text-green-600" />
                            ) : (
                              <XCircleIcon className="h-5 w-5 text-gray-300" />
                            )}
                          </td>
                          <td className={clsx(tdClass, 'max-w-xs truncate')}>
                            {f.notes || '--'}
                          </td>
                          <ActionCell
                            onEdit={() => {
                              setEditingForm(f);
                              setFormModalOpen(true);
                            }}
                            onDelete={() => setDeletingFormId(f.id)}
                          />
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Tab.Panel>

            {/* ========== Requirements ========== */}
            <Tab.Panel>
              <SectionHeader
                title="Requirements"
                onAdd={() => {
                  setEditingRequirement(undefined);
                  setRequirementModalOpen(true);
                }}
              />
              {requirements.length === 0 ? (
                <EmptyState label="requirements" />
              ) : (
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className={thClass}>Name</th>
                        <th className={thClass}>Override Type</th>
                        <th className={thClass}>Rule</th>
                        <th className={thClass}>Applies To</th>
                        <th className={thClass}>Blocking</th>
                        <th className={thClass}>Source</th>
                        <th className={thClass} />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                      {requirements.map((r) => (
                        <tr key={r.id}>
                          <td className={tdClass}>{r.name}</td>
                          <td className={tdClass}>{r.overrideType}</td>
                          <td className={clsx(tdClass, 'max-w-xs truncate')}>
                            {r.rule}
                          </td>
                          <td className={tdClass}>{r.appliesTo || '--'}</td>
                          <td className={tdClass}>
                            {r.isBlocking ? (
                              <CheckCircleIcon className="h-5 w-5 text-red-600" />
                            ) : (
                              <XCircleIcon className="h-5 w-5 text-gray-300" />
                            )}
                          </td>
                          <td className={tdClass}>{r.source || '--'}</td>
                          <ActionCell
                            onEdit={() => {
                              setEditingRequirement(r);
                              setRequirementModalOpen(true);
                            }}
                            onDelete={() => setDeletingRequirementId(r.id)}
                          />
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Tab.Panel>
          </Tab.Panels>
        </Tab.Group>

        {/* ========== Modals ========== */}

        {/* Edit PayerTrack */}
        {editTrackOpen && (
          <EditPayerTrackModal
            isOpen={editTrackOpen}
            onClose={() => setEditTrackOpen(false)}
            payerTrack={payerTrack}
          />
        )}

        {/* Delete PayerTrack confirm */}
        <ConfirmDialog
          isOpen={deleteTrackOpen}
          onClose={() => setDeleteTrackOpen(false)}
          onConfirm={handleDeleteTrack}
          title="Delete Payer Track"
          message={`Are you sure you want to delete "${payerTrack.payerName} - ${payerTrack.track}"? This will also delete all contacts, timelines, state rules, forms, and requirements. This action cannot be undone.`}
          loading={deleteTrackMutation.isPending}
        />

        {/* Contact modals */}
        {contactModalOpen && (
          <ContactModal
            isOpen={contactModalOpen}
            onClose={() => {
              setContactModalOpen(false);
              setEditingContact(undefined);
            }}
            trackId={payerTrack.id}
            contact={editingContact}
          />
        )}
        <ConfirmDialog
          isOpen={!!deletingContactId}
          onClose={() => setDeletingContactId(null)}
          onConfirm={() =>
            deletingContactId && handleDeleteChild('contact', deletingContactId)
          }
          title="Delete Contact"
          message="Are you sure you want to delete this contact?"
          loading={deleteContactMutation.isPending}
        />

        {/* Timeline modals */}
        {timelineModalOpen && (
          <TimelineModal
            isOpen={timelineModalOpen}
            onClose={() => {
              setTimelineModalOpen(false);
              setEditingTimeline(undefined);
            }}
            trackId={payerTrack.id}
            timeline={editingTimeline}
          />
        )}
        <ConfirmDialog
          isOpen={!!deletingTimelineId}
          onClose={() => setDeletingTimelineId(null)}
          onConfirm={() =>
            deletingTimelineId &&
            handleDeleteChild('timeline', deletingTimelineId)
          }
          title="Delete Timeline"
          message="Are you sure you want to delete this timeline entry?"
          loading={deleteTimelineMutation.isPending}
        />

        {/* State Rule modals */}
        {stateRuleModalOpen && (
          <StateRuleModal
            isOpen={stateRuleModalOpen}
            onClose={() => {
              setStateRuleModalOpen(false);
              setEditingStateRule(undefined);
            }}
            trackId={payerTrack.id}
            stateRule={editingStateRule}
          />
        )}
        <ConfirmDialog
          isOpen={!!deletingStateRuleId}
          onClose={() => setDeletingStateRuleId(null)}
          onConfirm={() =>
            deletingStateRuleId &&
            handleDeleteChild('stateRule', deletingStateRuleId)
          }
          title="Delete State Rule"
          message="Are you sure you want to delete this state rule?"
          loading={deleteStateRuleMutation.isPending}
        />

        {/* Form modals */}
        {formModalOpen && (
          <FormModal
            isOpen={formModalOpen}
            onClose={() => {
              setFormModalOpen(false);
              setEditingForm(undefined);
            }}
            trackId={payerTrack.id}
            payerForm={editingForm}
          />
        )}
        <ConfirmDialog
          isOpen={!!deletingFormId}
          onClose={() => setDeletingFormId(null)}
          onConfirm={() =>
            deletingFormId && handleDeleteChild('form', deletingFormId)
          }
          title="Delete Form"
          message="Are you sure you want to delete this form?"
          loading={deleteFormMutation.isPending}
        />

        {/* Requirement modals */}
        {requirementModalOpen && (
          <RequirementModal
            isOpen={requirementModalOpen}
            onClose={() => {
              setRequirementModalOpen(false);
              setEditingRequirement(undefined);
            }}
            trackId={payerTrack.id}
            requirement={editingRequirement}
          />
        )}
        <ConfirmDialog
          isOpen={!!deletingRequirementId}
          onClose={() => setDeletingRequirementId(null)}
          onConfirm={() =>
            deletingRequirementId &&
            handleDeleteChild('requirement', deletingRequirementId)
          }
          title="Delete Requirement"
          message="Are you sure you want to delete this requirement?"
          loading={deleteRequirementMutation.isPending}
        />
      </div>
    </PageTransition>
  );
}
