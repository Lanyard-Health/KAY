import { Fragment, useEffect } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { useCreateEducation, useUpdateEducation } from '../../hooks/usePayerEnrollmentData';

interface EducationFormData {
  educationType: string;
  institutionName: string;
  degree: string;
  fieldOfStudy: string;
  city: string;
  state: string;
  country: string;
  startDate: string;
  endDate: string;
  graduationDate: string;
  isCompleted: boolean;
  programDirector: string;
  programDirectorPhone: string;
  notes: string;
}

interface EducationModalProps {
  isOpen: boolean;
  onClose: () => void;
  providerId: string;
  education?: any;
}

const EDUCATION_TYPES = [
  { value: 'UNDERGRADUATE', label: 'Undergraduate' },
  { value: 'MEDICAL_SCHOOL', label: 'Medical School' },
  { value: 'GRADUATE_SCHOOL', label: 'Graduate School' },
  { value: 'INTERNSHIP', label: 'Internship' },
  { value: 'RESIDENCY', label: 'Residency' },
  { value: 'FELLOWSHIP', label: 'Fellowship' },
  { value: 'POST_DOCTORAL', label: 'Post-Doctoral' },
  { value: 'CONTINUING_EDUCATION', label: 'Continuing Education' },
  { value: 'OTHER', label: 'Other' },
];

const DEGREE_TYPES = [
  { value: 'md', label: 'MD' },
  { value: 'do', label: 'DO' },
  { value: 'phd', label: 'PhD' },
  { value: 'psyd', label: 'PsyD' },
  { value: 'msw', label: 'MSW' },
  { value: 'ma', label: 'MA' },
  { value: 'ms', label: 'MS' },
  { value: 'med', label: 'MEd' },
  { value: 'dnp', label: 'DNP' },
  { value: 'msn', label: 'MSN' },
  { value: 'bs', label: 'BS' },
  { value: 'ba', label: 'BA' },
  { value: 'other', label: 'Other' },
];

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN',
  'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH',
  'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'PR', 'RI', 'SC', 'SD', 'TN', 'TX',
  'UT', 'VT', 'VA', 'VI', 'WA', 'WV', 'WI', 'WY',
];

const formatDate = (d: string | undefined) => d ? d.substring(0, 10) : '';

export default function EducationModal({
  isOpen,
  onClose,
  providerId,
  education,
}: EducationModalProps) {
  const isEditing = !!education;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<EducationFormData>({
    defaultValues: {
      educationType: 'UNDERGRADUATE',
      institutionName: '',
      degree: 'md',
      fieldOfStudy: '',
      city: '',
      state: '',
      country: 'US',
      startDate: '',
      endDate: '',
      graduationDate: '',
      isCompleted: false,
      programDirector: '',
      programDirectorPhone: '',
      notes: '',
    },
  });

  useEffect(() => {
    if (education) {
      reset({
        educationType: education.educationType || 'UNDERGRADUATE',
        institutionName: education.institutionName || '',
        degree: education.degree || 'md',
        fieldOfStudy: education.fieldOfStudy || '',
        city: education.city || '',
        state: education.state || '',
        country: education.country || 'US',
        startDate: formatDate(education.startDate),
        endDate: formatDate(education.endDate),
        graduationDate: formatDate(education.graduationDate),
        isCompleted: education.isCompleted || false,
        programDirector: education.programDirector || '',
        programDirectorPhone: education.programDirectorPhone || '',
        notes: education.notes || '',
      });
    } else {
      reset({
        educationType: 'UNDERGRADUATE',
        institutionName: '',
        degree: 'md',
        fieldOfStudy: '',
        city: '',
        state: '',
        country: 'US',
        startDate: '',
        endDate: '',
        graduationDate: '',
        isCompleted: false,
        programDirector: '',
        programDirectorPhone: '',
        notes: '',
      });
    }
  }, [education, reset]);

  const createMutation = useCreateEducation();
  const updateMutation = useUpdateEducation();
  const mutation = isEditing ? updateMutation : createMutation;

  const onSubmit = (data: EducationFormData) => {
    const payload = {
      ...data,
      city: data.city || undefined,
      state: data.state || undefined,
      country: data.country || undefined,
      startDate: data.startDate || undefined,
      endDate: data.endDate || undefined,
      graduationDate: data.graduationDate || undefined,
      programDirector: data.programDirector || undefined,
      programDirectorPhone: data.programDirectorPhone || undefined,
      notes: data.notes || undefined,
    };

    if (isEditing) {
      updateMutation.mutate(
        { id: education.id, providerId, ...payload },
        {
          onSuccess: () => {
            toast.success('Education updated');
            onClose();
          },
          onError: (error: any) => {
            toast.error(error.response?.data?.error?.message || 'Failed to update education');
          },
        }
      );
    } else {
      createMutation.mutate(
        { providerId, ...payload },
        {
          onSuccess: () => {
            toast.success('Education added');
            onClose();
          },
          onError: (error: any) => {
            toast.error(error.response?.data?.error?.message || 'Failed to add education');
          },
        }
      );
    }
  };

  return (
    <Transition.Root show={isOpen} as={Fragment}>
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
          <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 z-10 overflow-y-auto">
          <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <Dialog.Panel className="relative transform overflow-hidden rounded-2xl bg-white text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-2xl">
                <div className="bg-white px-4 pb-4 pt-5 sm:p-6 sm:pb-4">
                  <div className="flex items-center justify-between mb-4">
                    <Dialog.Title as="h3" className="text-lg font-semibold text-gray-900">
                      {isEditing ? 'Edit Education' : 'Add Education'}
                    </Dialog.Title>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-500">
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>

                  <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    {/* Education Type + Degree */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label">Education Type</label>
                        <select
                          {...register('educationType')}
                          className="input"
                        >
                          {EDUCATION_TYPES.map((type) => (
                            <option key={type.value} value={type.value}>
                              {type.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="label">Degree *</label>
                        <select
                          {...register('degree', { required: 'Required' })}
                          className="input"
                        >
                          {DEGREE_TYPES.map((type) => (
                            <option key={type.value} value={type.value}>
                              {type.label}
                            </option>
                          ))}
                        </select>
                        {errors.degree && (
                          <p className="mt-1 text-sm text-red-600">{errors.degree.message}</p>
                        )}
                      </div>
                    </div>

                    {/* Institution Name */}
                    <div>
                      <label className="label">Institution Name *</label>
                      <input
                        {...register('institutionName', { required: 'Required' })}
                        className="input"
                        placeholder="e.g. Johns Hopkins University"
                      />
                      {errors.institutionName && (
                        <p className="mt-1 text-sm text-red-600">{errors.institutionName.message}</p>
                      )}
                    </div>

                    {/* Field of Study */}
                    <div>
                      <label className="label">Field of Study *</label>
                      <input
                        {...register('fieldOfStudy', { required: 'Required' })}
                        className="input"
                        placeholder="e.g. Internal Medicine"
                      />
                      {errors.fieldOfStudy && (
                        <p className="mt-1 text-sm text-red-600">{errors.fieldOfStudy.message}</p>
                      )}
                    </div>

                    {/* City, State, Country */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <div>
                        <label className="label">City</label>
                        <input
                          {...register('city')}
                          className="input"
                          placeholder="City"
                        />
                      </div>
                      <div>
                        <label className="label">State</label>
                        <select {...register('state')} className="input">
                          <option value="">Select</option>
                          {US_STATES.map((state) => (
                            <option key={state} value={state}>
                              {state}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="label">Country</label>
                        <input
                          {...register('country')}
                          className="input"
                          placeholder="US"
                        />
                      </div>
                    </div>

                    {/* Dates */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <div>
                        <label className="label">Start Date</label>
                        <input
                          type="date"
                          {...register('startDate')}
                          className="input"
                        />
                      </div>
                      <div>
                        <label className="label">End Date</label>
                        <input
                          type="date"
                          {...register('endDate')}
                          className="input"
                        />
                      </div>
                      <div>
                        <label className="label">Graduation Date</label>
                        <input
                          type="date"
                          {...register('graduationDate')}
                          className="input"
                        />
                      </div>
                    </div>

                    {/* Is Completed */}
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        {...register('isCompleted')}
                        id="isCompleted"
                        className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                      <label htmlFor="isCompleted" className="label mb-0">
                        Program Completed
                      </label>
                    </div>

                    {/* Program Director */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label">Program Director</label>
                        <input
                          {...register('programDirector')}
                          className="input"
                          placeholder="Director name"
                        />
                      </div>
                      <div>
                        <label className="label">Program Director Phone</label>
                        <input
                          {...register('programDirectorPhone')}
                          className="input"
                          placeholder="(555) 555-5555"
                        />
                      </div>
                    </div>

                    {/* Notes */}
                    <div>
                      <label className="label">Notes</label>
                      <textarea
                        {...register('notes', { maxLength: { value: 1000, message: 'Max 1000 characters' } })}
                        className="input"
                        rows={2}
                      />
                      {errors.notes && (
                        <p className="mt-1 text-sm text-red-600">{errors.notes.message}</p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex justify-end gap-3 pt-4 border-t">
                      <button type="button" onClick={onClose} className="btn-secondary">
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={mutation.isPending}
                        className="btn-primary"
                      >
                        {mutation.isPending ? 'Saving...' : isEditing ? 'Update' : 'Add Education'}
                      </button>
                    </div>
                  </form>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}
