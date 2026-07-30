import { Fragment, useEffect } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useForm } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useCreateSupervisingPhysician, useUpdateSupervisingPhysician } from '../../hooks/usePayerEnrollmentData';
import { api } from '../../services/api';

interface SupervisingPhysicianFormData {
  supervisorFirstName: string;
  supervisorLastName: string;
  supervisorMiddleName: string;
  supervisorNpi: string;
  supervisorLicenseNumber: string;
  supervisorLicenseState: string;
  supervisorSpecialty: string;
  supervisorPhone: string;
  supervisorEmail: string;
  supervisionType: string;
  agreementStartDate: string;
  agreementEndDate: string;
  stateRequirement: string;
  isPrimary: boolean;
  notes: string;
  practiceLocationId: string;
  department: string;
}

interface SupervisingPhysicianModalProps {
  isOpen: boolean;
  onClose: () => void;
  providerId: string;
  physician?: any;
}

const SUPERVISION_TYPES = [
  { value: 'DIRECT', label: 'Direct' },
  { value: 'GENERAL', label: 'General' },
  { value: 'COLLABORATIVE', label: 'Collaborative' },
  { value: 'ADMINISTRATIVE', label: 'Administrative' },
];

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN',
  'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH',
  'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'PR', 'RI', 'SC', 'SD', 'TN', 'TX',
  'UT', 'VT', 'VA', 'VI', 'WA', 'WV', 'WI', 'WY',
];

const formatDate = (d: string | undefined) => d ? d.substring(0, 10) : '';

export default function SupervisingPhysicianModal({
  isOpen,
  onClose,
  providerId,
  physician,
}: SupervisingPhysicianModalProps) {
  const isEditing = !!physician;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<SupervisingPhysicianFormData>({
    defaultValues: {
      supervisorFirstName: '',
      supervisorLastName: '',
      supervisorMiddleName: '',
      supervisorNpi: '',
      supervisorLicenseNumber: '',
      supervisorLicenseState: '',
      supervisorSpecialty: '',
      supervisorPhone: '',
      supervisorEmail: '',
      supervisionType: 'DIRECT',
      agreementStartDate: '',
      agreementEndDate: '',
      stateRequirement: '',
      isPrimary: false,
      notes: '',
      practiceLocationId: '',
      department: '',
    },
  });

  const { data: locationsResponse } = useQuery({
    queryKey: ['practice-locations', providerId],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Array<{ id: string; locationName: string }> }>(
        `/practice-locations/provider/${providerId}`,
      );
      return res.data;
    },
    enabled: isOpen && !!providerId,
  });
  const practiceLocations = locationsResponse?.data ?? [];

  useEffect(() => {
    if (physician) {
      reset({
        supervisorFirstName: physician.supervisorFirstName || '',
        supervisorLastName: physician.supervisorLastName || '',
        supervisorMiddleName: physician.supervisorMiddleName || '',
        supervisorNpi: physician.supervisorNpi || '',
        supervisorLicenseNumber: physician.supervisorLicenseNumber || '',
        supervisorLicenseState: physician.supervisorLicenseState || '',
        supervisorSpecialty: physician.supervisorSpecialty || '',
        supervisorPhone: physician.supervisorPhone || '',
        supervisorEmail: physician.supervisorEmail || '',
        supervisionType: physician.supervisionType || 'DIRECT',
        agreementStartDate: formatDate(physician.agreementStartDate),
        agreementEndDate: formatDate(physician.agreementEndDate),
        stateRequirement: physician.stateRequirement || '',
        isPrimary: physician.isPrimary || false,
        notes: physician.notes || '',
        practiceLocationId: physician.practiceLocationId || '',
        department: physician.department || '',
      });
    } else {
      reset({
        supervisorFirstName: '',
        supervisorLastName: '',
        supervisorMiddleName: '',
        supervisorNpi: '',
        supervisorLicenseNumber: '',
        supervisorLicenseState: '',
        supervisorSpecialty: '',
        supervisorPhone: '',
        supervisorEmail: '',
        supervisionType: 'DIRECT',
        agreementStartDate: '',
        agreementEndDate: '',
        stateRequirement: '',
        isPrimary: false,
        notes: '',
        practiceLocationId: '',
        department: '',
      });
    }
  }, [physician, reset]);

  const createMutation = useCreateSupervisingPhysician();
  const updateMutation = useUpdateSupervisingPhysician();
  const mutation = isEditing ? updateMutation : createMutation;

  const onSubmit = (data: SupervisingPhysicianFormData) => {
    const payload = {
      ...data,
      supervisorMiddleName: data.supervisorMiddleName || undefined,
      supervisorNpi: data.supervisorNpi || undefined,
      supervisorLicenseNumber: data.supervisorLicenseNumber || undefined,
      supervisorLicenseState: data.supervisorLicenseState || undefined,
      supervisorSpecialty: data.supervisorSpecialty || undefined,
      supervisorPhone: data.supervisorPhone || undefined,
      supervisorEmail: data.supervisorEmail || undefined,
      agreementEndDate: data.agreementEndDate || undefined,
      stateRequirement: data.stateRequirement || undefined,
      notes: data.notes || undefined,
      practiceLocationId: data.practiceLocationId || undefined,
      department: data.department || undefined,
    };

    if (isEditing) {
      updateMutation.mutate(
        { id: physician.id, providerId, ...payload },
        {
          onSuccess: () => {
            toast.success('Supervising physician updated');
            onClose();
          },
          onError: (error: any) => {
            toast.error(error.response?.data?.error?.message || 'Failed to update supervising physician');
          },
        }
      );
    } else {
      createMutation.mutate(
        { providerId, ...payload },
        {
          onSuccess: () => {
            toast.success('Supervising physician added');
            onClose();
          },
          onError: (error: any) => {
            toast.error(error.response?.data?.error?.message || 'Failed to add supervising physician');
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
                      {isEditing ? 'Edit Supervising Physician' : 'Add Supervising Physician'}
                    </Dialog.Title>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-500">
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>

                  <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    {/* Name Fields */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <div>
                        <label className="label">First Name *</label>
                        <input
                          {...register('supervisorFirstName', { required: 'Required' })}
                          className="input"
                          placeholder="First name"
                        />
                        {errors.supervisorFirstName && (
                          <p className="mt-1 text-sm text-red-600">{errors.supervisorFirstName.message}</p>
                        )}
                      </div>
                      <div>
                        <label className="label">Middle Name</label>
                        <input
                          {...register('supervisorMiddleName')}
                          className="input"
                          placeholder="Middle name"
                        />
                      </div>
                      <div>
                        <label className="label">Last Name *</label>
                        <input
                          {...register('supervisorLastName', { required: 'Required' })}
                          className="input"
                          placeholder="Last name"
                        />
                        {errors.supervisorLastName && (
                          <p className="mt-1 text-sm text-red-600">{errors.supervisorLastName.message}</p>
                        )}
                      </div>
                    </div>

                    {/* NPI + License */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <div>
                        <label className="label">NPI</label>
                        <input
                          {...register('supervisorNpi', { maxLength: { value: 10, message: 'Max 10 characters' } })}
                          className="input"
                          placeholder="10-digit NPI"
                          maxLength={10}
                        />
                        {errors.supervisorNpi && (
                          <p className="mt-1 text-sm text-red-600">{errors.supervisorNpi.message}</p>
                        )}
                      </div>
                      <div>
                        <label className="label">License Number</label>
                        <input
                          {...register('supervisorLicenseNumber')}
                          className="input"
                          placeholder="License number"
                        />
                      </div>
                      <div>
                        <label className="label">License State</label>
                        <select {...register('supervisorLicenseState')} className="input">
                          <option value="">Select</option>
                          {US_STATES.map((state) => (
                            <option key={state} value={state}>
                              {state}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Specialty + Supervision Type */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label">Specialty</label>
                        <input
                          {...register('supervisorSpecialty')}
                          className="input"
                          placeholder="e.g. Internal Medicine"
                        />
                      </div>
                      <div>
                        <label className="label">Supervision Type</label>
                        <select
                          {...register('supervisionType')}
                          className="input"
                        >
                          {SUPERVISION_TYPES.map((type) => (
                            <option key={type.value} value={type.value}>
                              {type.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Phone + Email */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label">Phone</label>
                        <input
                          {...register('supervisorPhone')}
                          className="input"
                          placeholder="(555) 555-5555"
                        />
                      </div>
                      <div>
                        <label className="label">Email</label>
                        <input
                          {...register('supervisorEmail')}
                          className="input"
                          placeholder="email@example.com"
                        />
                      </div>
                    </div>

                    {/* Practice Location + Department */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label">Practice Location</label>
                        <select {...register('practiceLocationId')} className="input">
                          <option value="">Not linked to a specific location</option>
                          {practiceLocations.map((loc) => (
                            <option key={loc.id} value={loc.id}>
                              {loc.locationName}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="label">Department</label>
                        <input
                          {...register('department')}
                          className="input"
                          placeholder="e.g. Behavioral Health"
                        />
                      </div>
                    </div>

                    {/* Agreement Dates */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label">Agreement Start Date *</label>
                        <input
                          type="date"
                          {...register('agreementStartDate', { required: 'Required' })}
                          className="input"
                        />
                        {errors.agreementStartDate && (
                          <p className="mt-1 text-sm text-red-600">{errors.agreementStartDate.message}</p>
                        )}
                      </div>
                      <div>
                        <label className="label">Agreement End Date</label>
                        <input
                          type="date"
                          {...register('agreementEndDate')}
                          className="input"
                        />
                      </div>
                    </div>

                    {/* State Requirement */}
                    <div>
                      <label className="label">State Requirement</label>
                      <input
                        {...register('stateRequirement')}
                        className="input"
                        placeholder="State-specific requirement details"
                      />
                    </div>

                    {/* Is Primary */}
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        {...register('isPrimary')}
                        id="isPrimary"
                        className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                      <label htmlFor="isPrimary" className="label mb-0">
                        Primary Supervising Physician
                      </label>
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
                        {mutation.isPending ? 'Saving...' : isEditing ? 'Update' : 'Add Physician'}
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
