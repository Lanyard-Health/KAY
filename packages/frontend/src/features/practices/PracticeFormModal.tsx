import { Fragment, useEffect, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon, CheckCircleIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { useForm, Controller } from 'react-hook-form';
import toast from 'react-hot-toast';
import { api } from '../../services/api';
import { useCreatePractice, useUpdatePractice } from '../../hooks/usePractices';
import type { Practice } from '../../hooks/usePractices';
import SelectWithOther from '../../components/SelectWithOther';
import {
  ENTITY_TYPES,
  EMR_VENDOR_GROUPS,
  BILLING_VENDORS,
  CLEARINGHOUSES,
  GROUP_SPECIALTIES,
} from '../../constants/practiceOptions';

interface PracticeFormData {
  name: string;
  legalName: string;
  dba: string;
  entityType: string;
  groupNpi: string;
  groupSpecialty: string;
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
  name: '', legalName: '', dba: '', entityType: '', groupNpi: '', groupSpecialty: '', taxId: '',
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

// Shape returned by GET /npi/lookup/:npi (npi.service.ts NPILookupResult) —
// only the fields this form consumes.
interface NpiLookupResult {
  found: boolean;
  npi?: string;
  entityType?: 'individual' | 'organization';
  firstName?: string;
  lastName?: string;
  organizationName?: string;
  authorizedOfficialPhone?: string;
  status?: string;
  primaryTaxonomy?: { code: string; description: string };
  practiceLocation?: {
    addressLine1: string;
    addressLine2?: string;
    city: string;
    state: string;
    zipCode: string;
    phone?: string;
  };
  mailingAddress?: {
    addressLine1: string;
    addressLine2?: string;
    city: string;
    state: string;
    zipCode: string;
  };
}

// Mirrors ProviderForm's module-private formatter (duplicating 6 lines beats
// exporting from a 1,900-line form file).
const formatPhoneNumber = (value: string): string => {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 0) return '';
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
};

type NpiLookupState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'found'; result: NpiLookupResult; applied: boolean }
  | { status: 'not_found' }
  | { status: 'error' };

export default function PracticeFormModal({ isOpen, onClose, practice }: PracticeFormModalProps) {
  const isEditing = !!practice;
  const createMutation = useCreatePractice();
  const updateMutation = useUpdatePractice();

  const { register, handleSubmit, reset, control, watch, setValue, getValues, formState: { errors } } =
    useForm<PracticeFormData>({ defaultValues: EMPTY });

  const [sameBilling, setSameBilling] = useState(false);
  const [sameMailing, setSameMailing] = useState(false);
  const [npiLookup, setNpiLookup] = useState<NpiLookupState>({ status: 'idle' });

  const npiValue = watch('groupNpi');
  const npiReady = /^\d{10}$/.test(npiValue || '');

  const handleNpiLookup = async () => {
    if (!npiReady) return;
    setNpiLookup({ status: 'loading' });
    try {
      const res = await api.get<{ success: boolean; data: NpiLookupResult }>(
        `/npi/lookup/${npiValue}`
      );
      const result = res.data.data;
      setNpiLookup(result?.found ? { status: 'found', result, applied: false } : { status: 'not_found' });
    } catch {
      setNpiLookup({ status: 'error' });
    }
  };

  // "Don't know the NPI?" — search NPPES by organization name instead.
  const [nameSearchOpen, setNameSearchOpen] = useState(false);
  const [orgQuery, setOrgQuery] = useState('');
  const [orgState, setOrgState] = useState('');
  const [orgSearch, setOrgSearch] = useState<
    { status: 'idle' } | { status: 'loading' } | { status: 'done'; results: NpiLookupResult[] } | { status: 'error' }
  >({ status: 'idle' });

  const handleOrgSearch = async () => {
    if (orgQuery.trim().length < 2) return;
    setOrgSearch({ status: 'loading' });
    try {
      const params = new URLSearchParams({ name: orgQuery.trim() });
      if (orgState.trim()) params.append('state', orgState.trim().toUpperCase());
      const res = await api.get<{ success: boolean; data: NpiLookupResult[] }>(
        `/npi/search-organizations?${params.toString()}`
      );
      setOrgSearch({ status: 'done', results: res.data.data ?? [] });
    } catch {
      setOrgSearch({ status: 'error' });
    }
  };

  const pickOrgResult = (result: NpiLookupResult) => {
    if (result.npi) setValue('groupNpi', result.npi, { shouldValidate: true });
    setNpiLookup({ status: 'found', result, applied: false });
    setNameSearchOpen(false);
    setOrgSearch({ status: 'idle' });
    setOrgQuery('');
    setOrgState('');
  };

  // Fill the form from the confirmed registry record. Registry values win over
  // whatever was typed (Kay can edit anything afterward); legalName only fills
  // when blank so a deliberately different legal entity name isn't clobbered.
  const applyNpiResult = (result: NpiLookupResult) => {
    const orgName =
      result.organizationName || [result.firstName, result.lastName].filter(Boolean).join(' ');
    if (orgName) {
      setValue('name', orgName, { shouldValidate: true });
      if (!getValues('legalName')) setValue('legalName', orgName);
    }
    const loc = result.practiceLocation;
    if (loc) {
      setValue('addressLine1', loc.addressLine1 || '');
      setValue('addressLine2', loc.addressLine2 || '');
      setValue('city', loc.city || '');
      setValue('state', loc.state || '');
      setValue('zipCode', loc.zipCode || '');
    }
    const mail = result.mailingAddress;
    if (mail?.addressLine1) {
      const differs = !loc || mail.addressLine1 !== loc.addressLine1 || mail.zipCode !== loc.zipCode;
      if (differs) setSameMailing(false);
      setValue('mailingAddressLine1', mail.addressLine1 || '');
      setValue('mailingAddressLine2', mail.addressLine2 || '');
      setValue('mailingCity', mail.city || '');
      setValue('mailingState', mail.state || '');
      setValue('mailingZipCode', mail.zipCode || '');
    }
    const phone = loc?.phone || result.authorizedOfficialPhone;
    if (phone) setValue('phone', formatPhoneNumber(phone));
    if (result.primaryTaxonomy?.description) {
      setValue('groupSpecialty', result.primaryTaxonomy.description);
    }
    setNpiLookup({ status: 'found', result, applied: true });
  };

  useEffect(() => {
    if (practice) {
      reset({
        ...EMPTY,
        name: practice.name,
        legalName: practice.legalName || '',
        dba: practice.dba || '',
        entityType: practice.entityType || '',
        groupNpi: practice.groupNpi || '',
        groupSpecialty: practice.groupSpecialty || '',
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
    setNpiLookup({ status: 'idle' });
    setNameSearchOpen(false);
    setOrgSearch({ status: 'idle' });
    setOrgQuery('');
    setOrgState('');
  }, [practice, reset, isOpen]);

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
                    {/* NPI lookup — type the group NPI first and the registry
                        fills in what it knows. */}
                    <div>
                      <label className="label">Group NPI</label>
                      <div className="flex gap-2">
                        <input
                          {...register('groupNpi', {
                            pattern: { value: /^\d{10}$/, message: 'Group NPI must be 10 digits' },
                            onChange: () => {
                              if (npiLookup.status !== 'idle') setNpiLookup({ status: 'idle' });
                            },
                          })}
                          className="input flex-1"
                          placeholder="10-digit organization NPI"
                          maxLength={10}
                          inputMode="numeric"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleNpiLookup();
                            }
                          }}
                        />
                        <button
                          type="button"
                          onClick={handleNpiLookup}
                          disabled={!npiReady || npiLookup.status === 'loading'}
                          className="btn-secondary flex shrink-0 items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {npiLookup.status === 'loading' ? (
                            <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
                          ) : (
                            <MagnifyingGlassIcon className="h-4 w-4" />
                          )}
                          Look Up
                        </button>
                      </div>
                      {errors.groupNpi && <p className="mt-1 text-sm text-red-600">{errors.groupNpi.message}</p>}
                      {npiLookup.status === 'idle' && !errors.groupNpi && !nameSearchOpen && (
                        <p className="mt-1 text-xs text-gray-500">
                          Look up the NPI to fill in the practice details from the federal registry.{' '}
                          <button
                            type="button"
                            onClick={() => setNameSearchOpen(true)}
                            className="font-medium text-primary-600 hover:text-primary-700 underline"
                          >
                            Don&apos;t know the NPI? Search by name.
                          </button>
                        </p>
                      )}

                      {nameSearchOpen && (
                        <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium text-gray-800">Search the NPI registry by name</p>
                            <button
                              type="button"
                              onClick={() => {
                                setNameSearchOpen(false);
                                setOrgSearch({ status: 'idle' });
                              }}
                              className="text-xs text-gray-500 hover:text-gray-700"
                            >
                              Hide
                            </button>
                          </div>
                          <div className="mt-2 flex gap-2">
                            <input
                              value={orgQuery}
                              onChange={(e) => setOrgQuery(e.target.value)}
                              className="input flex-1"
                              placeholder="Start of the name as registered with NPPES"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleOrgSearch();
                                }
                              }}
                            />
                            <input
                              value={orgState}
                              onChange={(e) => setOrgState(e.target.value)}
                              className="input w-16 text-center uppercase"
                              placeholder="ST"
                              maxLength={2}
                            />
                            <button
                              type="button"
                              onClick={handleOrgSearch}
                              disabled={orgQuery.trim().length < 2 || orgSearch.status === 'loading'}
                              className="btn-secondary flex shrink-0 items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {orgSearch.status === 'loading' ? (
                                <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
                              ) : (
                                <MagnifyingGlassIcon className="h-4 w-4" />
                              )}
                              Search
                            </button>
                          </div>
                          <p className="mt-1 text-xs text-gray-500">
                            The registry matches from the start of the name — &quot;behavioral break&quot; finds
                            &quot;Behavioral Breakthroughs&quot;, but a middle word alone won&apos;t. Add the 2-letter
                            state to narrow the results.
                          </p>

                          {orgSearch.status === 'done' && orgSearch.results.length > 0 && (
                            <ul className="mt-2 divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white">
                              {orgSearch.results.map((r) => (
                                <li key={r.npi}>
                                  <button
                                    type="button"
                                    onClick={() => pickOrgResult(r)}
                                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-primary-50"
                                  >
                                    <span className="min-w-0">
                                      <span className="block truncate text-sm font-medium text-gray-900">
                                        {r.organizationName}
                                      </span>
                                      <span className="block text-xs text-gray-500">
                                        {[r.practiceLocation?.city, r.practiceLocation?.state].filter(Boolean).join(', ')}
                                      </span>
                                    </span>
                                    <span className="shrink-0 text-xs text-gray-400">NPI {r.npi}</span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                          {orgSearch.status === 'done' && orgSearch.results.length === 0 && (
                            <p className="mt-2 text-sm text-gray-600">
                              No organizations matched. The registry matches from the start of the name — try
                              just the first word or two, check the spelling, or leave the state blank.
                            </p>
                          )}
                          {orgSearch.status === 'error' && (
                            <p className="mt-2 text-sm text-red-700">
                              The registry search didn&apos;t go through. Try again in a moment.
                            </p>
                          )}
                        </div>
                      )}

                      {npiLookup.status === 'found' && npiLookup.result.entityType === 'organization' && (
                        <div className="mt-2 rounded-xl border border-green-200 bg-green-50 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 items-start gap-2">
                              <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
                              <div className="min-w-0 text-sm">
                                <p className="font-medium text-green-900">
                                  {npiLookup.result.organizationName || 'Found in NPI Registry'}
                                </p>
                                <p className="mt-0.5 text-green-800">
                                  {[
                                    npiLookup.result.primaryTaxonomy?.description,
                                    [npiLookup.result.practiceLocation?.city, npiLookup.result.practiceLocation?.state]
                                      .filter(Boolean)
                                      .join(', '),
                                  ]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </p>
                                {npiLookup.applied && (
                                  <p className="mt-1 text-xs text-green-700">
                                    Details filled in below — review and adjust anything before saving.
                                  </p>
                                )}
                              </div>
                            </div>
                            {!npiLookup.applied && (
                              <button
                                type="button"
                                onClick={() => applyNpiResult(npiLookup.result)}
                                className="shrink-0 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
                              >
                                Use this info
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      {npiLookup.status === 'found' && npiLookup.result.entityType !== 'organization' && (
                        <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                          <p className="font-medium">
                            This NPI belongs to an individual provider
                            {npiLookup.result.firstName ? ` (${npiLookup.result.firstName} ${npiLookup.result.lastName ?? ''})` : ''}
                            , not an organization.
                          </p>
                          <p className="mt-0.5">
                            Practices usually use a group (organization) NPI. Double-check the number, or enter the practice details manually below.
                          </p>
                        </div>
                      )}

                      {npiLookup.status === 'not_found' && (
                        <p className="mt-2 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
                          That NPI isn&apos;t in the federal registry. Double-check the number, or enter the practice details manually below.
                        </p>
                      )}

                      {npiLookup.status === 'error' && (
                        <p className="mt-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                          The registry lookup didn&apos;t go through. Try again in a moment, or enter the details manually below.
                        </p>
                      )}
                    </div>

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

                    {/* Identifiers (Group NPI moved to the lookup field up top) */}
                    <div>
                      <label className="label">Group TIN</label>
                      <input {...register('taxId')} className="input" placeholder={isEditing && practice?.taxId ? `On file (${practice.taxId})` : 'Tax ID number'} />
                      <p className="mt-1 text-xs text-gray-500">Stored encrypted. Leave blank to keep the current TIN.</p>
                    </div>

                    {/* Specialty */}
                    <Controller name="groupSpecialty" control={control} render={({ field }) => (
                      <SelectWithOther label="Group Specialty" value={field.value} onChange={field.onChange} options={GROUP_SPECIALTIES} placeholder="Select specialty..." />
                    )} />

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
