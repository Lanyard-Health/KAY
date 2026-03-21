import { useForm } from 'react-hook-form';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { useCreatePayerTrack } from '../../hooks/useKnowledgeBase';
import PageTransition from '../../components/ui/PageTransition';

interface PayerTrackFormData {
  payerName: string;
  payerType: string;
  stateRegion: string;
  track: string;
  submissionMethod: string;
  parentOrg: string;
  enrollmentLink: string;
  portalUrl: string;
  productLines: string;
  notes: string;
  isActive: boolean;
}

const PAYER_TYPES = ['Commercial', 'Government', 'Medicaid'] as const;
const SUBMISSION_METHODS = ['caqh', 'portal', 'web_form', 'email_pdf', 'pecos', 'playwright', 'phone'] as const;

export default function KnowledgeBaseNew() {
  const navigate = useNavigate();
  const createMutation = useCreatePayerTrack();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PayerTrackFormData>({
    defaultValues: {
      payerName: '',
      payerType: '',
      stateRegion: '',
      track: '',
      submissionMethod: '',
      parentOrg: '',
      enrollmentLink: '',
      portalUrl: '',
      productLines: '',
      notes: '',
      isActive: true,
    },
  });

  const onSubmit = async (data: PayerTrackFormData) => {
    try {
      const payload = {
        payerName: data.payerName,
        payerType: data.payerType,
        stateRegion: data.stateRegion,
        track: data.track,
        submissionMethod: data.submissionMethod,
        parentOrg: data.parentOrg || null,
        enrollmentLink: data.enrollmentLink || null,
        portalUrl: data.portalUrl || null,
        productLines: data.productLines
          ? data.productLines.split(',').map((s) => s.trim()).filter(Boolean)
          : [],
        notes: data.notes || null,
        isActive: data.isActive,
      };

      const newTrack = await createMutation.mutateAsync(payload);
      toast.success('Payer Track created');
      navigate(`/admin/knowledge-base/${newTrack.id}`);
    } catch {
      toast.error('Failed to create');
    }
  };

  const inputClassName =
    'block w-full rounded-lg border border-gray-300 bg-white py-2 px-3 text-sm placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500';
  const labelClassName = 'block text-sm font-medium text-gray-700 mb-1';
  const errorClassName = 'mt-1 text-xs text-red-600';

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

        <h1 className="text-2xl font-bold text-gray-900 mb-8">New Payer Track</h1>

        <form onSubmit={handleSubmit(onSubmit)} className="card p-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Payer Name */}
            <div>
              <label htmlFor="payerName" className={labelClassName}>
                Payer Name <span className="text-red-500">*</span>
              </label>
              <input
                id="payerName"
                type="text"
                className={inputClassName}
                placeholder="e.g. Aetna"
                {...register('payerName', { required: 'Payer name is required' })}
              />
              {errors.payerName && <p className={errorClassName}>{errors.payerName.message}</p>}
            </div>

            {/* Payer Type */}
            <div>
              <label htmlFor="payerType" className={labelClassName}>
                Payer Type <span className="text-red-500">*</span>
              </label>
              <select
                id="payerType"
                className={inputClassName}
                {...register('payerType', { required: 'Payer type is required' })}
              >
                <option value="">Select type...</option>
                {PAYER_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              {errors.payerType && <p className={errorClassName}>{errors.payerType.message}</p>}
            </div>

            {/* State/Region */}
            <div>
              <label htmlFor="stateRegion" className={labelClassName}>
                State/Region <span className="text-red-500">*</span>
              </label>
              <input
                id="stateRegion"
                type="text"
                className={inputClassName}
                placeholder="e.g. California or National"
                {...register('stateRegion', { required: 'State/region is required' })}
              />
              {errors.stateRegion && <p className={errorClassName}>{errors.stateRegion.message}</p>}
            </div>

            {/* Track */}
            <div>
              <label htmlFor="track" className={labelClassName}>
                Track <span className="text-red-500">*</span>
              </label>
              <input
                id="track"
                type="text"
                className={inputClassName}
                placeholder="e.g. Individual or Group"
                {...register('track', { required: 'Track is required' })}
              />
              {errors.track && <p className={errorClassName}>{errors.track.message}</p>}
            </div>

            {/* Submission Method */}
            <div>
              <label htmlFor="submissionMethod" className={labelClassName}>
                Submission Method <span className="text-red-500">*</span>
              </label>
              <select
                id="submissionMethod"
                className={inputClassName}
                {...register('submissionMethod', { required: 'Submission method is required' })}
              >
                <option value="">Select method...</option>
                {SUBMISSION_METHODS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              {errors.submissionMethod && <p className={errorClassName}>{errors.submissionMethod.message}</p>}
            </div>

            {/* Parent Org */}
            <div>
              <label htmlFor="parentOrg" className={labelClassName}>
                Parent Organization
              </label>
              <input
                id="parentOrg"
                type="text"
                className={inputClassName}
                placeholder="e.g. CVS Health"
                {...register('parentOrg')}
              />
            </div>

            {/* Enrollment Link */}
            <div>
              <label htmlFor="enrollmentLink" className={labelClassName}>
                Enrollment Link
              </label>
              <input
                id="enrollmentLink"
                type="text"
                className={inputClassName}
                placeholder="https://..."
                {...register('enrollmentLink')}
              />
            </div>

            {/* Portal URL */}
            <div>
              <label htmlFor="portalUrl" className={labelClassName}>
                Portal URL
              </label>
              <input
                id="portalUrl"
                type="text"
                className={inputClassName}
                placeholder="https://..."
                {...register('portalUrl')}
              />
            </div>

            {/* Product Lines */}
            <div>
              <label htmlFor="productLines" className={labelClassName}>
                Product Lines
              </label>
              <input
                id="productLines"
                type="text"
                className={inputClassName}
                placeholder="HMO, PPO, EPO (comma-separated)"
                {...register('productLines')}
              />
              <p className="mt-1 text-xs text-gray-400">Separate multiple values with commas</p>
            </div>

            {/* Is Active */}
            <div className="flex items-center pt-6">
              <input
                id="isActive"
                type="checkbox"
                className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                {...register('isActive')}
              />
              <label htmlFor="isActive" className="ml-2 text-sm text-gray-700">
                Active
              </label>
            </div>
          </div>

          {/* Notes — full width */}
          <div className="mt-6">
            <label htmlFor="notes" className={labelClassName}>
              Notes
            </label>
            <textarea
              id="notes"
              rows={4}
              className={inputClassName}
              placeholder="Additional notes about this payer track..."
              {...register('notes')}
            />
          </div>

          {/* Submit */}
          <div className="mt-8 flex justify-end">
            <button
              type="submit"
              disabled={isSubmitting || createMutation.isPending}
              className="btn-primary disabled:opacity-50"
            >
              {createMutation.isPending ? 'Creating...' : 'Create Payer Track'}
            </button>
          </div>
        </form>
      </div>
    </PageTransition>
  );
}
