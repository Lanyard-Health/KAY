import { Fragment, useEffect } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../../services/api';

interface PracticeLocationFormData {
  locationName: string;
  locationType: string;
  isPrimary: boolean;
  isActive: boolean;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  zipCode: string;
  county?: string;
  phone: string;
  fax?: string;
  email?: string;
  taxId?: string;
  npi?: string;
  groupNpi?: string;
  wheelchairAccessible: boolean;
  publicTransitAccess: boolean;
  parkingAvailable: boolean;
  acceptingNewPatients: boolean;
  notes?: string;
}

interface PracticeLocationModalProps {
  isOpen: boolean;
  onClose: () => void;
  providerId: string;
  location?: any;
}

const LOCATION_TYPES = [
  { value: 'office', label: 'Office' },
  { value: 'clinic', label: 'Clinic' },
  { value: 'hospital', label: 'Hospital' },
  { value: 'telehealth', label: 'Telehealth Only' },
  { value: 'community_center', label: 'Community Health Center' },
  { value: 'other', label: 'Other' },
];

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN',
  'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH',
  'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'PR', 'RI', 'SC', 'SD', 'TN', 'TX',
  'UT', 'VT', 'VA', 'VI', 'WA', 'WV', 'WI', 'WY',
];

// Format phone number as (XXX) XXX-XXXX
const formatPhoneNumber = (value: string): string => {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 0) return '';
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
};

export default function PracticeLocationModal({
  isOpen,
  onClose,
  providerId,
  location,
}: PracticeLocationModalProps) {
  const queryClient = useQueryClient();
  const isEditing = !!location;

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<PracticeLocationFormData>({
    defaultValues: {
      locationName: '',
      locationType: 'office',
      isPrimary: false,
      isActive: true,
      addressLine1: '',
      addressLine2: '',
      city: '',
      state: '',
      zipCode: '',
      county: '',
      phone: '',
      fax: '',
      email: '',
      taxId: '',
      npi: '',
      groupNpi: '',
      wheelchairAccessible: false,
      publicTransitAccess: false,
      parkingAvailable: true,
      acceptingNewPatients: true,
      notes: '',
    },
  });

  const phoneValue = watch('phone');
  const faxValue = watch('fax');

  useEffect(() => {
    if (location) {
      reset({
        ...location,
        phone: formatPhoneNumber(location.phone || ''),
        fax: formatPhoneNumber(location.fax || ''),
      });
    } else {
      reset({
        locationName: '',
        locationType: 'office',
        isPrimary: false,
        isActive: true,
        addressLine1: '',
        addressLine2: '',
        city: '',
        state: '',
        zipCode: '',
        county: '',
        phone: '',
        fax: '',
        email: '',
        taxId: '',
        npi: '',
        groupNpi: '',
        wheelchairAccessible: false,
        publicTransitAccess: false,
        parkingAvailable: true,
        acceptingNewPatients: true,
        notes: '',
      });
    }
  }, [location, reset]);

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>, field: 'phone' | 'fax') => {
    const formatted = formatPhoneNumber(e.target.value);
    setValue(field, formatted);
  };

  const mutation = useMutation({
    mutationFn: async (data: PracticeLocationFormData) => {
      if (isEditing) {
        return api.put(`/practice-locations/${location.id}`, data);
      }
      return api.post(`/practice-locations/provider/${providerId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['provider', providerId] });
      toast.success(isEditing ? 'Location updated' : 'Location added');
      onClose();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error?.message || 'An error occurred');
    },
  });

  const onSubmit = (data: PracticeLocationFormData) => {
    mutation.mutate(data);
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
                      {isEditing ? 'Edit Practice Location' : 'Add Practice Location'}
                    </Dialog.Title>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-500">
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>

                  <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    {/* Location Info */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label">Location Name *</label>
                        <input
                          {...register('locationName', { required: 'Required' })}
                          className="input"
                          placeholder="Main Office"
                        />
                        {errors.locationName && (
                          <p className="mt-1 text-sm text-red-600">{errors.locationName.message}</p>
                        )}
                      </div>
                      <div>
                        <label className="label">Location Type *</label>
                        <select {...register('locationType', { required: true })} className="input">
                          {LOCATION_TYPES.map((type) => (
                            <option key={type.value} value={type.value}>
                              {type.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Address */}
                    <div>
                      <label className="label">Address Line 1 *</label>
                      <input
                        {...register('addressLine1', { required: 'Required' })}
                        className="input"
                        placeholder="123 Main Street"
                      />
                      {errors.addressLine1 && (
                        <p className="mt-1 text-sm text-red-600">{errors.addressLine1.message}</p>
                      )}
                    </div>
                    <div>
                      <label className="label">Address Line 2</label>
                      <input {...register('addressLine2')} className="input" placeholder="Suite 100" />
                    </div>
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                      <div className="col-span-2 sm:col-span-1">
                        <label className="label">City *</label>
                        <input
                          {...register('city', { required: 'Required' })}
                          className="input"
                        />
                      </div>
                      <div>
                        <label className="label">State *</label>
                        <select {...register('state', { required: true })} className="input">
                          <option value="">Select</option>
                          {US_STATES.map((state) => (
                            <option key={state} value={state}>
                              {state}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="label">ZIP Code *</label>
                        <input
                          {...register('zipCode', { required: 'Required', pattern: { value: /^\d{5}(-\d{4})?$/, message: 'Invalid ZIP' } })} // eslint-disable-line security/detect-unsafe-regex
                          className="input"
                          placeholder="12345"
                        />
                      </div>
                    </div>

                    {/* Contact */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label">Phone *</label>
                        <input
                          type="tel"
                          value={phoneValue || ''}
                          onChange={(e) => handlePhoneChange(e, 'phone')}
                          className="input"
                          placeholder="(555) 555-5555"
                        />
                        <input type="hidden" {...register('phone', { required: 'Required' })} />
                        {errors.phone && (
                          <p className="mt-1 text-sm text-red-600">{errors.phone.message}</p>
                        )}
                      </div>
                      <div>
                        <label className="label">Fax</label>
                        <input
                          type="tel"
                          value={faxValue || ''}
                          onChange={(e) => handlePhoneChange(e, 'fax')}
                          className="input"
                          placeholder="(555) 555-5555"
                        />
                        <input type="hidden" {...register('fax')} />
                      </div>
                    </div>

                    {/* Identifiers */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <div>
                        <label className="label">Location NPI</label>
                        <input
                          {...register('npi')}
                          className="input"
                          placeholder="1234567890"
                          maxLength={10}
                        />
                      </div>
                      <div>
                        <label className="label">Group NPI</label>
                        <input
                          {...register('groupNpi')}
                          className="input"
                          placeholder="1234567890"
                          maxLength={10}
                        />
                      </div>
                      <div>
                        <label className="label">Tax ID (EIN/SSN)</label>
                        <input
                          {...register('taxId')}
                          className="input"
                          placeholder="12-3456789"
                        />
                      </div>
                    </div>

                    {/* Options */}
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                      <label className="flex items-center">
                        <input type="checkbox" {...register('isPrimary')} className="mr-2" />
                        <span className="text-sm">Primary Location</span>
                      </label>
                      <label className="flex items-center">
                        <input type="checkbox" {...register('isActive')} className="mr-2" />
                        <span className="text-sm">Active</span>
                      </label>
                      <label className="flex items-center">
                        <input type="checkbox" {...register('acceptingNewPatients')} className="mr-2" />
                        <span className="text-sm">Accepting Patients</span>
                      </label>
                      <label className="flex items-center">
                        <input type="checkbox" {...register('wheelchairAccessible')} className="mr-2" />
                        <span className="text-sm">Wheelchair Accessible</span>
                      </label>
                    </div>

                    {/* Notes */}
                    <div>
                      <label className="label">Notes</label>
                      <textarea {...register('notes')} className="input" rows={2} />
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
                        {mutation.isPending ? 'Saving...' : isEditing ? 'Update' : 'Add Location'}
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
