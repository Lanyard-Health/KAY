import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { CheckIcon } from '@heroicons/react/24/outline';
import { api } from '../../services/api';
import BasicInfoStep from './steps/BasicInfoStep';
import PracticeLocationStep from './steps/PracticeLocationStep';
import EducationStep from './steps/EducationStep';
import LicensesCertsStep from './steps/LicensesCertsStep';
import InsuranceBankingStep from './steps/InsuranceBankingStep';
import WorkHistoryStep from './steps/WorkHistoryStep';
import DisclosuresStep from './steps/DisclosuresStep';
import ReviewSubmitStep from './steps/ReviewSubmitStep';

const STEPS = [
  { label: 'Basic Info', component: BasicInfoStep },
  { label: 'Locations', component: PracticeLocationStep },
  { label: 'Education', component: EducationStep },
  { label: 'Licenses & Certs', component: LicensesCertsStep },
  { label: 'Insurance & Banking', component: InsuranceBankingStep },
  { label: 'Work History', component: WorkHistoryStep },
  { label: 'Disclosures', component: DisclosuresStep },
  { label: 'Review & Submit', component: ReviewSubmitStep },
];

const BANKING_KEYS = [
  'bankName',
  'routingNumber',
  'accountNumber',
  'accountType',
  'accountHolderName',
];

function stripBankingFields(data: Record<string, any>): Record<string, any> {
  const cleaned = { ...data };
  if (cleaned.banking) {
    const { ...rest } = cleaned;
    delete rest.banking;
    return rest;
  }
  // Also strip top-level banking keys just in case
  for (const key of BANKING_KEYS) {
    delete cleaned[key];
  }
  return cleaned;
}

export default function OnboardingWizard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const providerId = searchParams.get('providerId');

  const [currentStep, setCurrentStep] = useState(0);
  const [wizardData, setWizardData] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load existing provider data if editing
  useEffect(() => {
    if (!providerId) return;
    let cancelled = false;
    setLoading(true);
    api
      .get(`/providers/${providerId}`)
      .then(({ data }) => {
        if (!cancelled) {
          const provider = (data as any)?.data || data;
          if (provider.onboardingData) {
            setWizardData(provider.onboardingData);
          } else {
            // Map existing provider fields into wizard data
            setWizardData({
              npi: provider.npiNumber || '',
              firstName: provider.firstName || '',
              lastName: provider.lastName || '',
              middleName: provider.middleName || '',
              suffix: provider.suffix || '',
              dateOfBirth: provider.dateOfBirth || '',
              gender: provider.gender || '',
              email: provider.email || '',
              phone: provider.phone || '',
              providerType: provider.providerType || '',
            });
          }
        }
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load provider data.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [providerId]);

  const handleChange = useCallback((updates: Record<string, any>) => {
    setWizardData((prev) => ({ ...prev, ...updates }));
  }, []);

  // Auto-save draft on step change
  const saveDraft = useCallback(
    async (data: Record<string, any>) => {
      if (!providerId) return;
      try {
        await api.patch(`/providers/${providerId}`, {
          onboardingData: stripBankingFields(data),
        });
      } catch {
        // Silent fail for draft save
      }
    },
    [providerId]
  );

  const goNext = async () => {
    if (currentStep < STEPS.length - 1) {
      await saveDraft(wizardData);
      setCurrentStep((s) => s + 1);
    }
  };

  const goBack = async () => {
    if (currentStep > 0) {
      await saveDraft(wizardData);
      setCurrentStep((s) => s - 1);
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const { data } = await api.post('/providers/onboard', wizardData);
      const result = (data as any)?.data || data;
      const newProviderId = result?.id || providerId;
      navigate(`/providers/${newProviderId}`);
    } catch (err: any) {
      setError(
        err?.response?.data?.error?.message ||
          err?.message ||
          'Submission failed. Please try again.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const StepComponent = STEPS[currentStep].component;
  const isLastStep = currentStep === STEPS.length - 1;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-8">
        Provider Onboarding
      </h1>

      {/* Step Indicator */}
      <nav className="mb-10">
        <ol className="flex items-center">
          {STEPS.map((step, idx) => {
            const isCompleted = idx < currentStep;
            const isCurrent = idx === currentStep;
            return (
              <li
                key={step.label}
                className={clsx(
                  'flex items-center',
                  idx < STEPS.length - 1 && 'flex-1'
                )}
              >
                <button
                  type="button"
                  onClick={async () => {
                    if (idx !== currentStep) {
                      await saveDraft(wizardData);
                      setCurrentStep(idx);
                    }
                  }}
                  className="flex flex-col items-center group"
                >
                  <span
                    className={clsx(
                      'flex items-center justify-center w-9 h-9 rounded-full text-sm font-semibold border-2 transition-colors',
                      isCompleted &&
                        'bg-primary-600 border-primary-600 text-white',
                      isCurrent &&
                        'border-primary-600 text-primary-600 bg-white',
                      !isCompleted &&
                        !isCurrent &&
                        'border-gray-300 text-gray-400 bg-white'
                    )}
                  >
                    {isCompleted ? (
                      <CheckIcon className="w-5 h-5" />
                    ) : (
                      idx + 1
                    )}
                  </span>
                  <span
                    className={clsx(
                      'mt-1.5 text-xs font-medium whitespace-nowrap',
                      isCurrent ? 'text-primary-600' : 'text-gray-500'
                    )}
                  >
                    {step.label}
                  </span>
                </button>

                {idx < STEPS.length - 1 && (
                  <div
                    className={clsx(
                      'flex-1 h-0.5 mx-2 mt-[-1rem]',
                      idx < currentStep ? 'bg-primary-600' : 'bg-gray-200'
                    )}
                  />
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Step Content */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6 sm:p-8 mb-6">
        <StepComponent data={wizardData} onChange={handleChange} />
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={goBack}
          disabled={currentStep === 0}
          className={clsx(
            'px-5 py-2.5 text-sm font-medium rounded-lg transition-colors',
            currentStep === 0
              ? 'text-gray-300 cursor-not-allowed'
              : 'text-gray-700 hover:bg-gray-100'
          )}
        >
          Back
        </button>

        {isLastStep ? (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="px-6 py-2.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Submitting...' : 'Submit for Credentialing'}
          </button>
        ) : (
          <button
            type="button"
            onClick={goNext}
            className="px-6 py-2.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors"
          >
            Continue
          </button>
        )}
      </div>
    </div>
  );
}
