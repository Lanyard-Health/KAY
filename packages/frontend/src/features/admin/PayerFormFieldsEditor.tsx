import { useState, Fragment } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Dialog, Transition } from '@headlessui/react';
import { ArrowLeftIcon, PlusIcon, TrashIcon, PencilIcon, XMarkIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { useForm } from 'react-hook-form';
import PageTransition from '../../components/ui/PageTransition';
import {
  usePayerFormFields,
  useCreateFormField,
  useUpdateFormField,
  useDeleteFormField,
  useCreateFieldMapping,
  useUpdateFieldMapping,
  useDeleteFieldMapping,
  useTestFillForm,
  type PayerFormField,
  type PayerFormFieldMapping,
  type FieldType,
  type SourceKind,
  type TestFillResult,
} from '../../hooks/useKnowledgeBase';
import { BeakerIcon } from '@heroicons/react/24/outline';

const FIELD_TYPES: FieldType[] = [
  'text', 'dropdown', 'radio', 'checkbox', 'date',
  'signature', 'masked', 'email', 'phone',
];

const SOURCE_KINDS: SourceKind[] = [
  'provider', 'practice', 'practicePayer', 'license', 'education',
  'boardCertification', 'identifier', 'banking', 'demographics',
  'constant', 'computed',
];

const inputClass =
  'block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm';

// ==========================================

function ModalShell({
  isOpen, onClose, title, children, wide,
}: {
  isOpen: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean;
}) {
  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300" enterFrom="opacity-0" enterTo="opacity-100"
          leave="ease-in duration-200" leaveFrom="opacity-100" leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/25" />
        </Transition.Child>
        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100"
              leave="ease-in duration-200" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className={clsx(
                'w-full rounded-xl bg-white p-6 shadow-xl',
                wide ? 'max-w-3xl' : 'max-w-md',
              )}>
                <div className="mb-4 flex items-center justify-between">
                  <Dialog.Title className="text-lg font-semibold text-gray-900">{title}</Dialog.Title>
                  <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
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
// Field Modal
// ==========================================

type FieldFormData = {
  fieldKey: string;
  fieldLabel: string;
  fieldType: FieldType;
  pageSection: string;
  orderIndex: number;
  required: boolean;
  validationRegex: string;
  notes: string;
};

function FieldModal({
  isOpen, onClose, formId, field,
}: {
  isOpen: boolean;
  onClose: () => void;
  formId: string;
  field?: PayerFormField;
}) {
  const createMut = useCreateFormField();
  const updateMut = useUpdateFormField();
  const { register, handleSubmit, formState: { errors } } = useForm<FieldFormData>({
    defaultValues: field
      ? {
          fieldKey: field.fieldKey,
          fieldLabel: field.fieldLabel,
          fieldType: field.fieldType,
          pageSection: field.pageSection || '',
          orderIndex: field.orderIndex,
          required: field.required,
          validationRegex: field.validationRegex || '',
          notes: field.notes || '',
        }
      : {
          fieldKey: '', fieldLabel: '', fieldType: 'text',
          pageSection: '', orderIndex: 0, required: false,
          validationRegex: '', notes: '',
        },
  });

  const onSubmit = (data: FieldFormData) => {
    const payload = {
      fieldKey: data.fieldKey,
      fieldLabel: data.fieldLabel,
      fieldType: data.fieldType,
      pageSection: data.pageSection || null,
      orderIndex: Number(data.orderIndex) || 0,
      required: data.required,
      validationRegex: data.validationRegex || null,
      notes: data.notes || null,
    };
    if (field) {
      updateMut.mutate({ id: field.id, ...payload }, {
        onSuccess: () => { toast.success('Field updated'); onClose(); },
        onError: () => toast.error('Update failed'),
      });
    } else {
      createMut.mutate({ formId, ...payload }, {
        onSuccess: () => { toast.success('Field created'); onClose(); },
        onError: () => toast.error('Create failed'),
      });
    }
  };

  const pending = createMut.isPending || updateMut.isPending;

  return (
    <ModalShell isOpen={isOpen} onClose={onClose} title={field ? 'Edit Field' : 'Add Field'}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700">Field Key</label>
            <input {...register('fieldKey', { required: 'Required' })} className={inputClass}
              placeholder="e.g. provider_npi or formcontrolname" />
            {errors.fieldKey && <p className="mt-1 text-xs text-red-600">{errors.fieldKey.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Label</label>
            <input {...register('fieldLabel', { required: 'Required' })} className={inputClass} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Type</label>
            <select {...register('fieldType')} className={inputClass}>
              {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Page Section</label>
            <input {...register('pageSection')} className={inputClass} placeholder="e.g. page1" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Order</label>
            <input type="number" {...register('orderIndex', { valueAsNumber: true })} className={inputClass} />
          </div>
          <div className="flex items-end gap-2">
            <input type="checkbox" {...register('required')} id="fieldReq" className="h-4 w-4" />
            <label htmlFor="fieldReq" className="text-sm">Required</label>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Validation Regex</label>
          <input {...register('validationRegex')} className={inputClass} placeholder="e.g. ^\d{10}$" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Notes</label>
          <textarea {...register('notes')} rows={2} className={inputClass} />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={pending}>
            {pending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ==========================================
// Mapping Modal
// ==========================================

type MappingFormData = {
  sourceKind: SourceKind;
  sourcePath: string;
  transform: string;
  fallbackValue: string;
  priority: number;
};

function MappingModal({
  isOpen, onClose, fieldId, mapping,
}: {
  isOpen: boolean;
  onClose: () => void;
  fieldId: string;
  mapping?: PayerFormFieldMapping;
}) {
  const createMut = useCreateFieldMapping();
  const updateMut = useUpdateFieldMapping();
  const { register, handleSubmit } = useForm<MappingFormData>({
    defaultValues: mapping
      ? {
          sourceKind: mapping.sourceKind,
          sourcePath: mapping.sourcePath,
          transform: mapping.transform ? JSON.stringify(mapping.transform, null, 2) : '',
          fallbackValue: mapping.fallbackValue || '',
          priority: mapping.priority,
        }
      : {
          sourceKind: 'provider', sourcePath: '', transform: '',
          fallbackValue: '', priority: 0,
        },
  });

  const onSubmit = (data: MappingFormData) => {
    let transform: unknown = null;
    if (data.transform.trim()) {
      try {
        transform = JSON.parse(data.transform);
      } catch {
        toast.error('Transform must be valid JSON');
        return;
      }
    }
    const payload = {
      sourceKind: data.sourceKind,
      sourcePath: data.sourcePath,
      transform: transform as Record<string, unknown> | null,
      fallbackValue: data.fallbackValue || null,
      priority: Number(data.priority) || 0,
    };
    if (mapping) {
      updateMut.mutate({ id: mapping.id, ...payload }, {
        onSuccess: () => { toast.success('Mapping updated'); onClose(); },
        onError: () => toast.error('Update failed'),
      });
    } else {
      createMut.mutate({ fieldId, ...payload }, {
        onSuccess: () => { toast.success('Mapping created'); onClose(); },
        onError: () => toast.error('Create failed'),
      });
    }
  };

  const pending = createMut.isPending || updateMut.isPending;

  return (
    <ModalShell isOpen={isOpen} onClose={onClose} title={mapping ? 'Edit Mapping' : 'Add Mapping'}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700">Source Kind</label>
            <select {...register('sourceKind')} className={inputClass}>
              {SOURCE_KINDS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Priority (higher wins)</label>
            <input type="number" {...register('priority', { valueAsNumber: true })} className={inputClass} />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Source Path</label>
          <input {...register('sourcePath', { required: true })} className={inputClass}
            placeholder="e.g. npi or licenses[0].expirationDate" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Transform (JSON, optional)
          </label>
          <textarea {...register('transform')} rows={3} className={clsx(inputClass, 'font-mono text-xs')}
            placeholder='{ "fn": "date", "format": "MM/DD/YYYY" }' />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Fallback Value</label>
          <input {...register('fallbackValue')} className={inputClass} />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={pending}>
            {pending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ==========================================
// Field Row with nested mappings
// ==========================================

function FieldRow({
  field, onEdit, onDelete,
}: {
  field: PayerFormField;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [mappingModalOpen, setMappingModalOpen] = useState(false);
  const [editingMapping, setEditingMapping] = useState<PayerFormFieldMapping | undefined>();
  const deleteMappingMut = useDeleteFieldMapping();

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-gray-900">{field.fieldKey}</span>
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">{field.fieldType}</span>
            {field.required && (
              <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-600">required</span>
            )}
            {field.pageSection && (
              <span className="text-xs text-gray-500">§ {field.pageSection}</span>
            )}
          </div>
          <div className="mt-1 text-sm text-gray-700">{field.fieldLabel}</div>
          {field.validationRegex && (
            <div className="mt-1 font-mono text-xs text-gray-500">regex: {field.validationRegex}</div>
          )}
        </div>
        <div className="flex gap-1">
          <button onClick={onEdit} className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <PencilIcon className="h-4 w-4" />
          </button>
          <button onClick={onDelete} className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600">
            <TrashIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-3 border-t border-gray-100 pt-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Mappings ({field.mappings.length})
          </span>
          <button
            onClick={() => { setEditingMapping(undefined); setMappingModalOpen(true); }}
            className="inline-flex items-center gap-1 text-xs text-primary-600 hover:underline"
          >
            <PlusIcon className="h-3 w-3" /> Add mapping
          </button>
        </div>
        {field.mappings.length === 0 ? (
          <p className="text-xs italic text-gray-400">No mappings yet; this field won't be filled.</p>
        ) : (
          <div className="space-y-1.5">
            {field.mappings.map((m) => (
              <div key={m.id} className="flex items-center justify-between rounded bg-gray-50 px-2 py-1.5 text-xs">
                <div className="flex flex-1 items-center gap-2">
                  <span className="rounded bg-white px-1.5 py-0.5 font-mono text-gray-700">
                    {m.sourceKind}
                  </span>
                  <span className="font-mono text-gray-900">{m.sourcePath}</span>
                  {m.transform && (
                    <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">
                      transform
                    </span>
                  )}
                  {m.fallbackValue && (
                    <span className="text-gray-500">fallback: {m.fallbackValue}</span>
                  )}
                  <span className="ml-auto text-gray-400">pri {m.priority}</span>
                </div>
                <div className="ml-2 flex gap-0.5">
                  <button
                    onClick={() => { setEditingMapping(m); setMappingModalOpen(true); }}
                    className="rounded p-1 text-gray-400 hover:bg-white hover:text-gray-600"
                  >
                    <PencilIcon className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => {
                      if (confirm('Delete this mapping?')) {
                        deleteMappingMut.mutate(m.id, {
                          onSuccess: () => toast.success('Mapping deleted'),
                        });
                      }
                    }}
                    className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <TrashIcon className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <MappingModal
        isOpen={mappingModalOpen}
        onClose={() => { setMappingModalOpen(false); setEditingMapping(undefined); }}
        fieldId={field.id}
        mapping={editingMapping}
      />
    </div>
  );
}

// ==========================================
// Test Fill Panel
// ==========================================

function TestFillPanel({ formId }: { formId: string }) {
  const [providerId, setProviderId] = useState('');
  const [result, setResult] = useState<TestFillResult | null>(null);
  const mut = useTestFillForm();

  const run = () => {
    if (!providerId.trim()) {
      toast.error('Enter a provider ID');
      return;
    }
    mut.mutate(
      { formId, providerId: providerId.trim() },
      {
        onSuccess: (data) => {
          setResult(data);
          toast.success(`Resolved ${data.fieldCount - data.missingRequired.length}/${data.fieldCount} fields`);
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : 'Test fill failed';
          toast.error(msg);
        },
      }
    );
  };

  return (
    <div className="mt-6 rounded-lg border border-blue-200 bg-blue-50/40 p-4">
      <div className="flex items-center gap-2">
        <BeakerIcon className="h-5 w-5 text-blue-600" />
        <h3 className="text-sm font-semibold text-gray-900">Test Fill (Dry Run)</h3>
      </div>
      <p className="mt-1 text-xs text-gray-600">
        Resolve every field against a chosen provider's credentialing packet.
        Nothing is submitted; use this to validate mappings before running a real fill.
      </p>

      <div className="mt-3 flex items-center gap-2">
        <input
          value={providerId}
          onChange={(e) => setProviderId(e.target.value)}
          placeholder="Provider ID (cuid)"
          className={clsx(inputClass, 'max-w-md')}
        />
        <button onClick={run} disabled={mut.isPending} className="btn-primary text-sm">
          {mut.isPending ? 'Running...' : 'Run Test Fill'}
        </button>
      </div>

      {result && (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-4 gap-2 text-xs">
            <div className="rounded bg-white p-2">
              <div className="text-gray-500">Total</div>
              <div className="text-lg font-semibold text-gray-900">{result.fieldCount}</div>
            </div>
            <div className="rounded bg-white p-2">
              <div className="text-gray-500">Resolved</div>
              <div className="text-lg font-semibold text-green-600">
                {result.fieldCount - result.missingRequired.length - result.missingOptional.length}
              </div>
            </div>
            <div className="rounded bg-white p-2">
              <div className="text-gray-500">Missing (required)</div>
              <div className="text-lg font-semibold text-red-600">{result.missingRequired.length}</div>
            </div>
            <div className="rounded bg-white p-2">
              <div className="text-gray-500">Invalid</div>
              <div className="text-lg font-semibold text-amber-600">{result.invalid.length}</div>
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto rounded border border-gray-200 bg-white">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 bg-gray-50">
                <tr>
                  <th className="px-2 py-1.5 text-left font-semibold">Field</th>
                  <th className="px-2 py-1.5 text-left font-semibold">Value</th>
                  <th className="px-2 py-1.5 text-left font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {result.resolved.map((f) => (
                  <tr key={f.fieldKey}>
                    <td className="px-2 py-1 font-mono text-gray-700">{f.fieldKey}</td>
                    <td className="px-2 py-1 text-gray-900">
                      {f.value ?? <span className="italic text-gray-400">null</span>}
                    </td>
                    <td className="px-2 py-1">
                      {f.missing && (
                        <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-700">missing</span>
                      )}
                      {!f.missing && f.value === null && (
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">empty</span>
                      )}
                      {f.fromFallback && (
                        <span className="ml-1 rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">fallback</span>
                      )}
                      {f.validationError && (
                        <span className="ml-1 rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">
                          invalid: {f.validationError}
                        </span>
                      )}
                      {f.value !== null && !f.fromFallback && !f.validationError && (
                        <span className="rounded bg-green-50 px-1.5 py-0.5 text-green-700">ok</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================
// Page
// ==========================================

export default function PayerFormFieldsEditor() {
  const { formId } = useParams<{ formId: string }>();
  const { data: fields = [], isLoading } = usePayerFormFields(formId);
  const deleteFieldMut = useDeleteFormField();

  const [fieldModalOpen, setFieldModalOpen] = useState(false);
  const [editingField, setEditingField] = useState<PayerFormField | undefined>();

  if (!formId) return null;

  const onDelete = (field: PayerFormField) => {
    if (confirm(`Delete field "${field.fieldKey}" and all its mappings?`)) {
      deleteFieldMut.mutate(field.id, {
        onSuccess: () => toast.success('Field deleted'),
        onError: () => toast.error('Delete failed'),
      });
    }
  };

  return (
    <PageTransition>
      <div className="mx-auto max-w-5xl px-6 py-6">
        <Link
          to="/admin/knowledge-base"
          className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
        >
          <ArrowLeftIcon className="h-4 w-4" /> Back to Knowledge Base
        </Link>

        <div className="mt-4 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Form Fields</h1>
            <p className="mt-1 text-sm text-gray-500">
              Define the fillable controls on this payer form and map each to a CredentialingPacket source path.
            </p>
          </div>
          <button
            onClick={() => { setEditingField(undefined); setFieldModalOpen(true); }}
            className="btn-primary inline-flex items-center gap-2"
          >
            <PlusIcon className="h-4 w-4" /> Add Field
          </button>
        </div>

        <div className="mt-6 space-y-3">
          {isLoading ? (
            <p className="text-sm text-gray-500">Loading...</p>
          ) : fields.length === 0 ? (
            <div className="rounded-lg border-2 border-dashed border-gray-200 p-8 text-center">
              <p className="text-sm text-gray-500">
                No fields yet. Add one for each fillable control on the form.
              </p>
            </div>
          ) : (
            fields.map((f) => (
              <FieldRow
                key={f.id}
                field={f}
                onEdit={() => { setEditingField(f); setFieldModalOpen(true); }}
                onDelete={() => onDelete(f)}
              />
            ))
          )}
        </div>

        {fields.length > 0 && <TestFillPanel formId={formId} />}

        <FieldModal
          isOpen={fieldModalOpen}
          onClose={() => { setFieldModalOpen(false); setEditingField(undefined); }}
          formId={formId}
          field={editingField}
        />
      </div>
    </PageTransition>
  );
}
