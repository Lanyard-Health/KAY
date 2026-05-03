import { Fragment, useEffect } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import {
  useCreateHospitalAffiliation,
  useUpdateHospitalAffiliation,
} from '../../hooks/usePayerEnrollmentData';

interface HospitalAffiliationFormData {
  // Identity
  facilityName: string;
  facilityType: string;
  caqhAhaId: string;
  department: string;

  // Privileges
  privilegeType: string;
  status: string;
  hasUnrestrictedPrivileges: boolean;
  hasTemporaryPrivileges: boolean;
  privilegeDescription: string;
  staffCategory: string;
  hospitalRecordType: string;
  hospitalAffiliationType: string;
  admissionPercent: string;

  // Dates
  startDate: string;
  endDate: string;
  appointmentDate: string;
  reappointmentDate: string;

  // Address & contact
  addressLine1: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  phoneNumber: string;
  faxNumber: string;

  // Admitter sub-fields (when not self-admitting)
  whoAdmitsForYou: string;
  admittingProviderFirstName: string;
  admittingProviderLastName: string;
  admittingContactPhone: string;
  admittingContactEmail: string;
  isAdmitterSameSpecialty: boolean;

  // Description / exit
  description: string;
  reasonForDiscontinuance: string;
  exitExplanation: string;
  notes: string;
}

interface HospitalAffiliationModalProps {
  isOpen: boolean;
  onClose: () => void;
  providerId: string;
  affiliation?: any;
}

const PRIVILEGE_TYPES = [
  { value: 'admitting', label: 'Admitting' },
  { value: 'courtesy', label: 'Courtesy' },
  { value: 'consulting', label: 'Consulting' },
  { value: 'temporary', label: 'Temporary' },
  { value: 'locum_tenens', label: 'Locum tenens' },
  { value: 'active', label: 'Active' },
  { value: 'provisional', label: 'Provisional' },
  { value: 'affiliate', label: 'Affiliate (non-admitting)' },
  { value: 'teaching', label: 'Teaching' },
];

const STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'pending', label: 'Pending' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'denied', label: 'Denied' },
  { value: 'resigned', label: 'Resigned' },
];

const formatDate = (d: string | undefined) => d ? d.substring(0, 10) : '';

const EMPTY_FORM: HospitalAffiliationFormData = {
  facilityName: '',
  facilityType: 'hospital',
  caqhAhaId: '',
  department: '',
  privilegeType: 'admitting',
  status: 'active',
  hasUnrestrictedPrivileges: false,
  hasTemporaryPrivileges: false,
  privilegeDescription: '',
  staffCategory: '',
  hospitalRecordType: '',
  hospitalAffiliationType: '',
  admissionPercent: '',
  startDate: '',
  endDate: '',
  appointmentDate: '',
  reappointmentDate: '',
  addressLine1: '',
  city: '',
  state: '',
  zipCode: '',
  country: '',
  phoneNumber: '',
  faxNumber: '',
  whoAdmitsForYou: '',
  admittingProviderFirstName: '',
  admittingProviderLastName: '',
  admittingContactPhone: '',
  admittingContactEmail: '',
  isAdmitterSameSpecialty: false,
  description: '',
  reasonForDiscontinuance: '',
  exitExplanation: '',
  notes: '',
};

export default function HospitalAffiliationModal({
  isOpen,
  onClose,
  providerId,
  affiliation,
}: HospitalAffiliationModalProps) {
  const isEditing = !!affiliation;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<HospitalAffiliationFormData>({ defaultValues: EMPTY_FORM });

  useEffect(() => {
    if (affiliation) {
      reset({
        facilityName: affiliation.facilityName || '',
        facilityType: affiliation.facilityType || 'hospital',
        caqhAhaId: affiliation.caqhAhaId || '',
        department: affiliation.department || '',
        privilegeType: affiliation.privilegeType || 'admitting',
        status: affiliation.status || 'active',
        hasUnrestrictedPrivileges: affiliation.hasUnrestrictedPrivileges ?? false,
        hasTemporaryPrivileges: affiliation.hasTemporaryPrivileges ?? false,
        privilegeDescription: affiliation.privilegeDescription || '',
        staffCategory: affiliation.staffCategory || '',
        hospitalRecordType: affiliation.hospitalRecordType || '',
        hospitalAffiliationType: affiliation.hospitalAffiliationType || '',
        admissionPercent: affiliation.admissionPercent?.toString() || '',
        startDate: formatDate(affiliation.startDate),
        endDate: formatDate(affiliation.endDate),
        appointmentDate: formatDate(affiliation.appointmentDate),
        reappointmentDate: formatDate(affiliation.reappointmentDate),
        addressLine1: affiliation.addressLine1 || '',
        city: affiliation.city || '',
        state: affiliation.state || '',
        zipCode: affiliation.zipCode || '',
        country: affiliation.country || '',
        phoneNumber: affiliation.phoneNumber || '',
        faxNumber: affiliation.faxNumber || '',
        whoAdmitsForYou: affiliation.whoAdmitsForYou || '',
        admittingProviderFirstName: affiliation.admittingProviderFirstName || '',
        admittingProviderLastName: affiliation.admittingProviderLastName || '',
        admittingContactPhone: affiliation.admittingContactPhone || '',
        admittingContactEmail: affiliation.admittingContactEmail || '',
        isAdmitterSameSpecialty: affiliation.isAdmitterSameSpecialty ?? false,
        description: affiliation.description || '',
        reasonForDiscontinuance: affiliation.reasonForDiscontinuance || '',
        exitExplanation: affiliation.exitExplanation || '',
        notes: affiliation.notes || '',
      });
    } else {
      reset(EMPTY_FORM);
    }
  }, [affiliation, reset]);

  const createMutation = useCreateHospitalAffiliation();
  const updateMutation = useUpdateHospitalAffiliation();
  const mutation = isEditing ? updateMutation : createMutation;

  const onSubmit = (data: HospitalAffiliationFormData) => {
    const blank = (v: string) => v === '' ? undefined : v;
    const intNum = (v: string) => v === '' ? undefined : parseInt(v, 10);

    const payload = {
      facilityName: data.facilityName,
      facilityType: data.facilityType,
      privilegeType: data.privilegeType,
      status: data.status,
      caqhAhaId: blank(data.caqhAhaId),
      department: blank(data.department),
      hasUnrestrictedPrivileges: data.hasUnrestrictedPrivileges,
      hasTemporaryPrivileges: data.hasTemporaryPrivileges,
      privilegeDescription: blank(data.privilegeDescription),
      staffCategory: blank(data.staffCategory),
      hospitalRecordType: blank(data.hospitalRecordType),
      hospitalAffiliationType: blank(data.hospitalAffiliationType),
      admissionPercent: intNum(data.admissionPercent),
      startDate: blank(data.startDate),
      endDate: blank(data.endDate),
      appointmentDate: blank(data.appointmentDate),
      reappointmentDate: blank(data.reappointmentDate),
      addressLine1: blank(data.addressLine1),
      city: blank(data.city),
      state: blank(data.state),
      zipCode: blank(data.zipCode),
      country: blank(data.country),
      phoneNumber: blank(data.phoneNumber),
      faxNumber: blank(data.faxNumber),
      whoAdmitsForYou: blank(data.whoAdmitsForYou),
      admittingProviderFirstName: blank(data.admittingProviderFirstName),
      admittingProviderLastName: blank(data.admittingProviderLastName),
      admittingContactPhone: blank(data.admittingContactPhone),
      admittingContactEmail: blank(data.admittingContactEmail),
      isAdmitterSameSpecialty: data.isAdmitterSameSpecialty,
      description: blank(data.description),
      reasonForDiscontinuance: blank(data.reasonForDiscontinuance),
      exitExplanation: blank(data.exitExplanation),
      notes: blank(data.notes),
    };

    if (isEditing) {
      updateMutation.mutate(
        { id: affiliation.id, providerId, ...payload },
        {
          onSuccess: () => {
            toast.success('Hospital affiliation updated');
            onClose();
          },
          onError: (error: any) => {
            toast.error(error.response?.data?.error?.message || 'Failed to update hospital affiliation');
          },
        }
      );
    } else {
      createMutation.mutate(
        { providerId, ...payload },
        {
          onSuccess: () => {
            toast.success('Hospital affiliation added');
            onClose();
          },
          onError: (error: any) => {
            toast.error(error.response?.data?.error?.message || 'Failed to add hospital affiliation');
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
              <Dialog.Panel className="relative transform overflow-hidden rounded-2xl bg-white text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-3xl">
                <div className="bg-white px-4 pb-4 pt-5 sm:p-6 sm:pb-4 max-h-[85vh] overflow-y-auto">
                  <div className="flex items-center justify-between mb-4 sticky top-0 bg-white pb-2 -mx-6 px-6 border-b">
                    <Dialog.Title as="h3" className="text-lg font-semibold text-gray-900">
                      {isEditing ? 'Edit Hospital Affiliation' : 'Add Hospital Affiliation'}
                    </Dialog.Title>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-500">
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>

                  <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                    {/* ──────────── Identity ──────────── */}
                    <fieldset className="space-y-4">
                      <legend className="text-sm font-semibold text-gray-700">Identity</legend>
                      <div>
                        <label className="label">Facility Name *</label>
                        <input
                          {...register('facilityName', { required: 'Required' })}
                          className="input"
                          placeholder="Hospital legal name"
                        />
                        {errors.facilityName && (
                          <p className="mt-1 text-sm text-red-600">{errors.facilityName.message}</p>
                        )}
                      </div>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <div>
                          <label className="label">AHA Hospital ID</label>
                          <input {...register('caqhAhaId')} className="input" placeholder="6740549" />
                        </div>
                        <div>
                          <label className="label">Facility Type</label>
                          <input
                            {...register('facilityType')}
                            className="input"
                            placeholder="hospital"
                          />
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
                    </fieldset>

                    {/* ──────────── Privileges ──────────── */}
                    <fieldset className="space-y-4">
                      <legend className="text-sm font-semibold text-gray-700">Privileges</legend>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                          <label className="label">Privilege Type</label>
                          <select {...register('privilegeType')} className="input">
                            {PRIVILEGE_TYPES.map((p) => (
                              <option key={p.value} value={p.value}>
                                {p.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="label">Status</label>
                          <select {...register('status')} className="input">
                            {STATUSES.map((s) => (
                              <option key={s.value} value={s.value}>
                                {s.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div className="flex items-center gap-3 pt-6">
                          <input
                            type="checkbox"
                            {...register('hasUnrestrictedPrivileges')}
                            id="ha-unrestricted"
                            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                          />
                          <label htmlFor="ha-unrestricted" className="label mb-0">
                            Unrestricted privileges
                          </label>
                        </div>
                        <div className="flex items-center gap-3 pt-6">
                          <input
                            type="checkbox"
                            {...register('hasTemporaryPrivileges')}
                            id="ha-temporary"
                            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                          />
                          <label htmlFor="ha-temporary" className="label mb-0">
                            Temporary privileges
                          </label>
                        </div>
                      </div>
                      <div>
                        <label className="label">Privilege Description</label>
                        <input
                          {...register('privilegeDescription')}
                          className="input"
                          placeholder='e.g. "Full and unrestricted"'
                        />
                      </div>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <div>
                          <label className="label">Staff Category</label>
                          <input
                            {...register('staffCategory')}
                            className="input"
                            placeholder="Active / Inactive"
                          />
                        </div>
                        <div>
                          <label className="label">Hospital Record Type</label>
                          <input
                            {...register('hospitalRecordType')}
                            className="input"
                            placeholder="e.g. Admitting Privilege Record"
                          />
                        </div>
                        <div>
                          <label className="label">Hospital Affiliation Type</label>
                          <input
                            {...register('hospitalAffiliationType')}
                            className="input"
                            placeholder="e.g. Primary"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="label">Admission Percent</label>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          {...register('admissionPercent')}
                          className="input"
                          placeholder="0–100"
                        />
                      </div>
                    </fieldset>

                    {/* ──────────── Dates ──────────── */}
                    <fieldset className="space-y-4">
                      <legend className="text-sm font-semibold text-gray-700">Dates</legend>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                          <label className="label">Start Date</label>
                          <input type="date" {...register('startDate')} className="input" />
                        </div>
                        <div>
                          <label className="label">End Date</label>
                          <input type="date" {...register('endDate')} className="input" />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                          <label className="label">Appointment Date</label>
                          <input type="date" {...register('appointmentDate')} className="input" />
                        </div>
                        <div>
                          <label className="label">Reappointment Date</label>
                          <input type="date" {...register('reappointmentDate')} className="input" />
                        </div>
                      </div>
                    </fieldset>

                    {/* ──────────── Address & Contact ──────────── */}
                    <fieldset className="space-y-4">
                      <legend className="text-sm font-semibold text-gray-700">Address &amp; Contact</legend>
                      <div>
                        <label className="label">Address Line 1</label>
                        <input
                          {...register('addressLine1')}
                          className="input"
                          placeholder="Street address"
                        />
                      </div>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <div>
                          <label className="label">City</label>
                          <input {...register('city')} className="input" />
                        </div>
                        <div>
                          <label className="label">State</label>
                          <input
                            {...register('state', {
                              maxLength: { value: 2, message: '2-letter abbreviation' },
                            })}
                            className="input"
                            maxLength={2}
                            placeholder="TX"
                          />
                          {errors.state && (
                            <p className="mt-1 text-sm text-red-600">{errors.state.message}</p>
                          )}
                        </div>
                        <div>
                          <label className="label">ZIP</label>
                          <input {...register('zipCode')} className="input" placeholder="00000" />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <div>
                          <label className="label">Country</label>
                          <input {...register('country')} className="input" placeholder="United States" />
                        </div>
                        <div>
                          <label className="label">Phone</label>
                          <input
                            {...register('phoneNumber')}
                            className="input"
                            placeholder="(000) 000-0000"
                          />
                        </div>
                        <div>
                          <label className="label">Fax</label>
                          <input
                            {...register('faxNumber')}
                            className="input"
                            placeholder="(000) 000-0000"
                          />
                        </div>
                      </div>
                    </fieldset>

                    {/* ──────────── Admitter (when not self-admitting) ──────────── */}
                    <fieldset className="space-y-4">
                      <legend className="text-sm font-semibold text-gray-700">Admitter (if not self-admitting)</legend>
                      <div>
                        <label className="label">Who admits for you?</label>
                        <input
                          {...register('whoAdmitsForYou')}
                          className="input"
                          placeholder='e.g. "A provider in my practice"'
                        />
                      </div>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                          <label className="label">Admitter First Name</label>
                          <input {...register('admittingProviderFirstName')} className="input" />
                        </div>
                        <div>
                          <label className="label">Admitter Last Name</label>
                          <input {...register('admittingProviderLastName')} className="input" />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                          <label className="label">Admitter Phone</label>
                          <input {...register('admittingContactPhone')} className="input" />
                        </div>
                        <div>
                          <label className="label">Admitter Email</label>
                          <input
                            type="email"
                            {...register('admittingContactEmail')}
                            className="input"
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          {...register('isAdmitterSameSpecialty')}
                          id="ha-same-specialty"
                          className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                        <label htmlFor="ha-same-specialty" className="label mb-0">
                          Admitter is same specialty as this provider
                        </label>
                      </div>
                    </fieldset>

                    {/* ──────────── Description / Exit ──────────── */}
                    <fieldset className="space-y-4">
                      <legend className="text-sm font-semibold text-gray-700">Description &amp; End-of-affiliation</legend>
                      <div>
                        <label className="label">Description</label>
                        <textarea
                          {...register('description')}
                          className="input"
                          rows={2}
                          placeholder="Free-form arrangement description"
                        />
                      </div>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                          <label className="label">Reason for Discontinuance</label>
                          <input
                            {...register('reasonForDiscontinuance')}
                            className="input"
                            placeholder="e.g. Voluntary Resignation"
                          />
                        </div>
                        <div>
                          <label className="label">Exit Explanation</label>
                          <input {...register('exitExplanation')} className="input" />
                        </div>
                      </div>
                    </fieldset>

                    {/* ──────────── Notes ──────────── */}
                    <fieldset className="space-y-4">
                      <legend className="text-sm font-semibold text-gray-700">Internal Notes</legend>
                      <div>
                        <label className="label">Notes</label>
                        <textarea {...register('notes')} className="input" rows={2} />
                      </div>
                    </fieldset>

                    {/* Actions */}
                    <div className="flex justify-end gap-3 pt-4 border-t sticky bottom-0 bg-white -mx-6 px-6 pb-1">
                      <button type="button" onClick={onClose} className="btn-secondary">
                        Cancel
                      </button>
                      <button type="submit" disabled={mutation.isPending} className="btn-primary">
                        {mutation.isPending ? 'Saving...' : isEditing ? 'Update' : 'Add Affiliation'}
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
