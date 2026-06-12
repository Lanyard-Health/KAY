import { Fragment, useEffect, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useForm, Controller } from 'react-hook-form';
import toast from 'react-hot-toast';
import { useCreatePractice, useUpdatePractice } from '../../hooks/usePractices';
import type { Practice } from '../../hooks/usePractices';
import SelectWithOther from '../../components/SelectWithOther';
import {
  ENTITY_TYPES,
  EMR_VENDOR_GROUPS,
  BILLING_VENDORS,
  CLEARINGHOUSES,
} from '../../constants/practiceOptions';

interface PracticeFormData {
  name: string;
  legalName: string;
  dba: string;
  entityType: string;
  groupNpi: string;
  taxId: string;
  emrVendor: string;
  billingVendor: string;
  billingClearinghouse: string;
  phone: string;
  email: string;
  website: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  zipCode: string;
  billingAddressLine1: string;
  billingAddressLine2: string;
  billingCity: string;
  billingState: string;
  billingZipCode: string;
  mailingAddressLine1: string;
  mailingAddressLine2: string;
  mailingCity: string;
  mailingState: string;
  mailingZipCode: string;
  notes: string;
  status: 'ACTIVE' | 'INACTIVE';
}

const EMPTY: PracticeFormData = {
  name: '', legalName: '', dba: '', entityType: '', groupNpi: '', taxId: '',
  emrVendor: '', billingVendor: '', billingClearinghouse: '',
  phone: '', email: '', website: '',
  addressLine1: '', addressLine2: '', city: '', state: '', zipCode: '',
  billingAddressLine1: '', billingAddressLine2: '', billingCity: '', billingState: '', billingZipCode: '',
  mailingAddressLine1: '', mailingAddressLine2: '', mailingCity: '', mailingState: '', mailingZipCode: '',
  notes: '', status: 'ACTIVE',
};

interface PracticeFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  practice?: Practice | null;
}

export default function PracticeFormModal({ isOpen, onClose, practice }: PracticeFormModalProps) {
  const isEditing = !!practice;
  const createMutation = useCreatePractice();
  const updateMutation = useUpdatePractice();

  const { register, handleSubmit, reset, control, watch, setValue, formState: { errors } } =
    useForm<PracticeFormData>({ defaultValues: EMPTY });

  const [sameBilling, setSameBilling] = useState(false);
  const [sameMailing, setSameMailing] = useState(false);

  useEffect(() => {
    if (practice) {
      reset({
        ...EMPTY,
        name: practice.name,
        legalName: practice.legalName || '',
        dba: practice.dba || '',
        entityType: practice.entityType || '',
        groupNpi: practice.groupNpi || '',
        // Masked tax id (****1234) is display-only; leave the input blank so an
        // edit only overwrites the TIN when the admin actually types a new one.
        taxId: '',
        emrVendor: practice.emrVendor || '',
        billingVendor: practice.billingVendor || '',
        billingClearinghouse: practice.billingClearinghouse || '',
        phone: practice.phone || '',
        email: practice.email || '',
        website: practice.website || '',
        addressLine1: practice.addressLine1 || '',
        addressLine2: practice.addressLine2 || '',
        city: practice.city || '',
        state: practice.state || '',
        zipCode: practice.zipCode || '',
        billingAddressLine1: practice.billingAddressLine1 || '',
        billingAddressLine2: practice.billingAddressLine2 || '',
        billingCity: practice.billingCity || '',
        billingState: practice.billingState || '',
        billingZipCode: practice.billingZipCode || '',
        mailingAddressLine1: practice.mailingAddressLine1 || '',
        mailingAddressLine2: practice.mailingAddressLine2 || '',
        mailingCity: practice.mailingCity || '',
        mailingState: practice.mailingState || '',
        mailingZipCode: practice.mailingZipCode || '',
        notes: practice.notes || '',
        status: practice.status,
      });
    } else {
      reset(EMPTY);
    }
    setSameBilling(false);
    setSameMailing(false);
  }, [practice, reset]);

  // Keep billing/mailing in sync with the office address while "same as office" is on.
  const office = watch(['addressLine1', 'addressLine2', 'city', 'state', 'zipCode']);
  const [oL1, oL2, oCity, oState, oZip] = office;
  useEffect(() => {
    if (sameBilling) {
      setValue('billingAddressLine1', oL1); setValue('billingAddressLine2', oL2);
      setValue('billingCity', oCity); setValue('billingState', oState); setValue('billingZipCode', oZip);
    }
  }, [sameBilling, oL1, oL2, oCity, oState, oZip, setValue]);
  useEffect(() => {
    if (sameMailing) {
      setValue('mailingAddressLine1', oL1); setValue('mailingAddressLine2', oL2);
      setValue('mailingCity', oCity); setValue('mailingState', oState); setValue('mailingZipCode', oZip);
    }
  }, [sameMailing, oL1, oL2, oCity, oState, oZip, setValue]);

  const onSubmit = (data: PracticeFormData) => {
    // Drop the blank tax id so an edit without a new TIN leaves it untouched.
    const payload: Record<string, unknown> = { ...data };
    if (!data.taxId) delete payload['taxId'];

    if (isEditing) {
      updateMutation.mutate(
        { practiceId: practice!.id, ...(payload as any) },
        {
          onSuccess: () => { toast.success('Changes saved'); onClose(); },
          onError: (error: any) => toast.error(error.message || 'Failed to update practice'),
        }
      );
    } else {
      createMutation.mutate(payload as any, {
        onSuccess: () => { toast.success(`${data.name} created`); onClose(); },
        onError: (error: any) => toast.error(error.message || 'Failed to create practice'),
      });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Transition.Root show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child as={Fragment} enter="ease-out duration-300" enterFrom="opacity-0" enterTo="opacity-100" leave="ease-in duration-200" leaveFrom="opacity-100" leaveTo="opacity-0">
          <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 z-10 overflow-y-auto">
          <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
            <Transition.Child as={Fragment} enter="ease-out duration-300" enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95" enterTo="opacity-100 translate-y-0 sm:scale-100" leave="ease-in duration-200" leaveFrom="opacity-100 translate-y-0 sm:scale-100" leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95">
              <Dialog.Panel className="relative transform overflow-hidden rounded-2xl bg-white text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-2xl">
                <div className="bg-white px-4 pb-4 pt-5 sm:p-6 sm:pb-4">
                  <div className="flex items-center justify-between mb-4">
                    <Dialog.Title as="h3" className="text-lg font-semibold text-gray-900">
                      {isEditing ? 'Edit Practice' : 'Add Practice'}
                    </Dialog.Title>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-500">
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>

                  <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 max-h-[70vh] overflow-y-auto pr-1">
                    {/* Identity */}
                    <div className="space-y-4">
                      <div>
                        <label className="label">Practice Name *</label>
                        <input {...register('name', { required: 'Name is required' })} className="input" placeholder="What the practice is called" />
                        {errors.name && <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>}
                      </div>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                          <label className="label">Group Legal Name</label>
                          <input {...register('legalName')} className="input" placeholder="Legal entity name" />
                        </div>
                        <div>
                          <label className="label">Doing Business As</label>
                          <input {...register('dba')} className="input" placeholder="DBA (if different)" />
                        </div>
                      </div>
                      <Controller name="entityType" control={control} render={({ field }) => (
                        <SelectWithOther label="Entity Type" value={field.value} onChange={field.onChange} options={ENTITY_TYPES} placeholder="Select entity type..." />
                      )} />
                    </div>

                    {/* Identifiers */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label">Group NPI</label>
                        <input {...register('groupNpi', { pattern: { value: /^\d{10}$/, message: 'Group NPI must be 10 digits' } })} className="input" placeholder="10-digit number" />
                        {errors.groupNpi && <p className="mt-1 text-sm text-red-600">{errors.groupNpi.message}</p>}
                      </div>
                      <div>
                        <label className="label">Group TIN</label>
                        <input {...register('taxId')} className="input" placeholder={isEditing && practice?.taxId ? `On file (${practice.taxId})` : 'Tax ID number'} />
                        <p className="mt-1 text-xs text-gray-500">Stored encrypted. Leave blank to keep the current TIN.</p>
                      </div>
                    </div>

                    {/* Vendors */}
                    <div className="space-y-4">
                      <Controller name="emrVendor" control={control} render={({ field }) => (
                        <SelectWithOther label="EMR Vendor" value={field.value} onChange={field.onChange} groups={EMR_VENDOR_GROUPS} placeholder="Select EMR vendor..." />
                      )} />
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Controller name="billingVendor" control={control} render={({ field }) => (
                          <SelectWithOther label="Billing Vendor" value={field.value} onChange={field.onChange} options={BILLING_VENDORS} placeholder="Select billing vendor..." />
                        )} />
                        <Controller name="billingClearinghouse" control={control} render={({ field }) => (
                          <SelectWithOther label="Billing Clearinghouse" value={field.value} onChange={field.onChange} options={CLEARINGHOUSES} placeholder="Select clearinghouse..." />
                        )} />
                      </div>
                    </div>

                    {/* Contact */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label">Phone</label>
                        <input {...register('phone')} className="input" placeholder="(555) 555-5555" />
                      </div>
                      <div>
                        <label className="label">Email</label>
                        <input {...register('email')} type="email" className="input" placeholder="office@practice.com" />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="label">Website</label>
                        <input {...register('website')} className="input" placeholder="https://www.practice.com" />
                      </div>
                    </div>

                    {/* Office address */}
                    <fieldset className="space-y-3">
                      <legend className="text-sm font-semibold text-gray-900">Office Address</legend>
                      <input {...register('addressLine1')} className="input" placeholder="Street address" />
                      <input {...register('addressLine2')} className="input" placeholder="Suite, unit, etc. (optional)" />
                      <div className="grid grid-cols-6 gap-3">
                        <input {...register('city')} className="input col-span-3" placeholder="City" />
                        <input {...register('state')} className="input col-span-1" placeholder="ST" maxLength={2} />
                        <input {...register('zipCode')} className="input col-span-2" placeholder="ZIP" />
                      </div>
                    </fieldset>

                    {/* Billing address */}
                    <fieldset className="space-y-3">
                      <div className="flex items-center justify-between">
                        <legend className="text-sm font-semibold text-gray-900">Billing Address</legend>
                        <label className="flex items-center gap-2 text-sm text-gray-600">
                          <input type="checkbox" checked={sameBilling} onChange={(e) => {
                            setSameBilling(e.target.checked);
                            if (e.target.checked) toast('Billing address set to match your office address', { icon: 'ℹ️' });
                          }} />
                          Same as office
                        </label>
                      </div>
                      <input {...register('billingAddressLine1')} className="input" placeholder="Street address" disabled={sameBilling} />
                      <input {...register('billingAddressLine2')} className="input" placeholder="Suite, unit, etc. (optional)" disabled={sameBilling} />
                      <div className="grid grid-cols-6 gap-3">
                        <input {...register('billingCity')} className="input col-span-3" placeholder="City" disabled={sameBilling} />
                        <input {...register('billingState')} className="input col-span-1" placeholder="ST" maxLength={2} disabled={sameBilling} />
                        <input {...register('billingZipCode')} className="input col-span-2" placeholder="ZIP" disabled={sameBilling} />
                      </div>
                    </fieldset>

                    {/* Mailing address */}
                    <fieldset className="space-y-3">
                      <div className="flex items-center justify-between">
                        <legend className="text-sm font-semibold text-gray-900">Mailing Address</legend>
                        <label className="flex items-center gap-2 text-sm text-gray-600">
                          <input type="checkbox" checked={sameMailing} onChange={(e) => {
                            setSameMailing(e.target.checked);
                            if (e.target.checked) toast('Mailing address set to match your office address', { icon: 'ℹ️' });
                          }} />
                          Same as office
                        </label>
                      </div>
                      <input {...register('mailingAddressLine1')} className="input" placeholder="Street address" disabled={sameMailing} />
                      <input {...register('mailingAddressLine2')} className="input" placeholder="Suite, unit, etc. (optional)" disabled={sameMailing} />
                      <div className="grid grid-cols-6 gap-3">
                        <input {...register('mailingCity')} className="input col-span-3" placeholder="City" disabled={sameMailing} />
                        <input {...register('mailingState')} className="input col-span-1" placeholder="ST" maxLength={2} disabled={sameMailing} />
                        <input {...register('mailingZipCode')} className="input col-span-2" placeholder="ZIP" disabled={sameMailing} />
                      </div>
                    </fieldset>

                    {isEditing && (
                      <div>
                        <label className="label">Status</label>
                        <select {...register('status')} className="input">
                          <option value="ACTIVE">Active</option>
                          <option value="INACTIVE">Inactive</option>
                        </select>
                      </div>
                    )}

                    <div>
                      <label className="label">Notes</label>
                      <textarea {...register('notes')} className="input" rows={3} placeholder="Optional notes about this practice" />
                    </div>

                    <div className="flex justify-end gap-3 pt-4 border-t">
                      <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
                      <button type="submit" disabled={isPending} className="btn-primary">
                        {isPending ? 'Saving...' : isEditing ? 'Update' : 'Create Practice'}
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
