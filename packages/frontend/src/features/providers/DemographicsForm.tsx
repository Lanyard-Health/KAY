import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { useGetDemographics, useUpsertDemographics } from '../../hooks/usePayerEnrollmentData';

interface DemographicsFormData {
  birthCity?: string;
  birthState?: string;
  birthCountry?: string;
  citizenshipStatus?: string;
  visaType?: string;
  visaExpirationDate?: string;
  ethnicity?: string;
  race?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelation?: string;
}

interface DemographicsFormProps {
  providerId: string;
}

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN',
  'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH',
  'NJ','NM','NY','NC','ND','OH','OK','OR','PA','PR','RI','SC','SD','TN','TX',
  'UT','VT','VA','VI','WA','WV','WI','WY',
];

const CITIZENSHIP_STATUSES = [
  { value: 'US_CITIZEN', label: 'US Citizen' },
  { value: 'PERMANENT_RESIDENT', label: 'Permanent Resident' },
  { value: 'WORK_VISA', label: 'Work Visa' },
  { value: 'OTHER', label: 'Other' },
];

const formatDate = (d: string | undefined) => d ? d.substring(0, 10) : '';

export default function DemographicsForm({ providerId }: DemographicsFormProps) {
  const { data: demographics, isLoading } = useGetDemographics(providerId);
  const upsertMutation = useUpsertDemographics();

  const [previousNames, setPreviousNames] = useState<string[]>([]);
  const [newName, setNewName] = useState('');

  const {
    register,
    handleSubmit,
    reset,
    watch,
  } = useForm<DemographicsFormData>({
    defaultValues: {
      birthCity: '',
      birthState: '',
      birthCountry: '',
      citizenshipStatus: '',
      visaType: '',
      visaExpirationDate: '',
      ethnicity: '',
      race: '',
      emergencyContactName: '',
      emergencyContactPhone: '',
      emergencyContactRelation: '',
    },
  });

  const citizenshipStatus = watch('citizenshipStatus');

  useEffect(() => {
    if (demographics) {
      reset({
        birthCity: demographics.birthCity || '',
        birthState: demographics.birthState || '',
        birthCountry: demographics.birthCountry || '',
        citizenshipStatus: demographics.citizenshipStatus || '',
        visaType: demographics.visaType || '',
        visaExpirationDate: formatDate(demographics.visaExpirationDate),
        ethnicity: demographics.ethnicity || '',
        race: demographics.race || '',
        emergencyContactName: demographics.emergencyContactName || '',
        emergencyContactPhone: demographics.emergencyContactPhone || '',
        emergencyContactRelation: demographics.emergencyContactRelation || '',
      });
      setPreviousNames(demographics.previousNames || []);
    }
  }, [demographics, reset]);

  const handleAddName = () => {
    const trimmed = newName.trim();
    if (trimmed && !previousNames.includes(trimmed)) {
      setPreviousNames([...previousNames, trimmed]);
      setNewName('');
    }
  };

  const handleRemoveName = (name: string) => {
    setPreviousNames(previousNames.filter((n) => n !== name));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddName();
    }
  };

  const onSubmit = (data: DemographicsFormData) => {
    const payload = {
      ...data,
      birthCity: data.birthCity || undefined,
      birthState: data.birthState || undefined,
      birthCountry: data.birthCountry || undefined,
      citizenshipStatus: data.citizenshipStatus || undefined,
      visaType: data.citizenshipStatus === 'WORK_VISA' ? data.visaType || undefined : undefined,
      visaExpirationDate: data.citizenshipStatus === 'WORK_VISA' ? data.visaExpirationDate || undefined : undefined,
      ethnicity: data.ethnicity || undefined,
      race: data.race || undefined,
      emergencyContactName: data.emergencyContactName || undefined,
      emergencyContactPhone: data.emergencyContactPhone || undefined,
      emergencyContactRelation: data.emergencyContactRelation || undefined,
      previousNames,
    };

    upsertMutation.mutate(
      { providerId, ...payload },
      {
        onSuccess: () => {
          toast.success('Demographics saved');
        },
        onError: (error: any) => {
          toast.error(error.response?.data?.error?.message || 'Failed to save demographics');
        },
      }
    );
  };

  if (isLoading) {
    return <div className="text-sm text-gray-500">Loading demographics...</div>;
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {/* Birth Info */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className="label">Birth City</label>
          <input {...register('birthCity')} className="input" placeholder="City" />
        </div>
        <div>
          <label className="label">Birth State</label>
          <select {...register('birthState')} className="input">
            <option value="">Select</option>
            {US_STATES.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Birth Country</label>
          <input {...register('birthCountry')} className="input" placeholder="e.g. United States" />
        </div>
      </div>

      {/* Citizenship */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className="label">Citizenship Status</label>
          <select {...register('citizenshipStatus')} className="input">
            <option value="">Select</option>
            {CITIZENSHIP_STATUSES.map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </select>
        </div>
        {citizenshipStatus === 'WORK_VISA' && (
          <>
            <div>
              <label className="label">Visa Type</label>
              <input {...register('visaType')} className="input" placeholder="e.g. H-1B" />
            </div>
            <div>
              <label className="label">Visa Expiration Date</label>
              <input type="date" {...register('visaExpirationDate')} className="input" />
            </div>
          </>
        )}
      </div>

      {/* Previous Names */}
      <div>
        <label className="label">Previous Names</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={handleKeyDown}
            className="input flex-1"
            placeholder="Enter a previous name"
          />
          <button
            type="button"
            onClick={handleAddName}
            className="btn-secondary"
          >
            Add
          </button>
        </div>
        {previousNames.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {previousNames.map((name) => (
              <span
                key={name}
                className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700"
              >
                {name}
                <button
                  type="button"
                  onClick={() => handleRemoveName(name)}
                  className="ml-1 text-gray-400 hover:text-gray-600"
                >
                  &times;
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Ethnicity + Race */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Ethnicity</label>
          <input {...register('ethnicity')} className="input" placeholder="Ethnicity" />
        </div>
        <div>
          <label className="label">Race</label>
          <input {...register('race')} className="input" placeholder="Race" />
        </div>
      </div>

      {/* Emergency Contact */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className="label">Emergency Contact Name</label>
          <input {...register('emergencyContactName')} className="input" placeholder="Full name" />
        </div>
        <div>
          <label className="label">Emergency Contact Phone</label>
          <input {...register('emergencyContactPhone')} className="input" placeholder="(555) 555-5555" />
        </div>
        <div>
          <label className="label">Emergency Contact Relation</label>
          <input {...register('emergencyContactRelation')} className="input" placeholder="e.g. Spouse" />
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end pt-4 border-t">
        <button
          type="submit"
          disabled={upsertMutation.isPending}
          className="btn-primary"
        >
          {upsertMutation.isPending ? 'Saving...' : 'Save'}
        </button>
      </div>
    </form>
  );
}
