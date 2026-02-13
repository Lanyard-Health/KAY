import { useState } from 'react';
import { CheckIcon } from '@heroicons/react/24/solid';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { useOnboardingProgress, useCompleteOnboarding } from './hooks/usePortalData';
import PortalProfile from './PortalProfile';
import PortalDocuments from './PortalDocuments';
import PortalLicenseForm from './PortalLicenseForm';
import PortalLocations from './PortalLocations';

const STEPS = [
  { key: 'profile', label: 'Profile' },
  { key: 'documents', label: 'Documents' },
  { key: 'licenses', label: 'Licenses' },
  { key: 'locations', label: 'Locations' },
  { key: 'review', label: 'Review' },
];

export default function OnboardingWizard() {
  const [currentStep, setCurrentStep] = useState(0);
  const { data: progressData, refetch } = useOnboardingProgress();
  const completeMutation = useCompleteOnboarding();

  const progress = (progressData as any)?.data;
  const steps = progress?.steps ?? [];

  const handleNext = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
      refetch();
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSkip = () => {
    handleNext();
  };

  const handleComplete = async () => {
    try {
      await completeMutation.mutateAsync();
      toast.success('Onboarding complete! Welcome to Lanyard Health.');
    } catch {
      toast.error('Failed to complete onboarding');
    }
  };

  const isStepComplete = (key: string) => {
    return steps.find((s: any) => s.key === key)?.complete ?? false;
  };

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Welcome to Lanyard Health</h1>
        <p className="mt-1 text-sm text-gray-500">
          Complete the following steps to set up your provider profile.
        </p>
      </div>

      {/* Stepper */}
      <nav className="mb-8">
        <ol className="flex items-center">
          {STEPS.map((step, index) => {
            const completed = isStepComplete(step.key);
            const isCurrent = index === currentStep;

            return (
              <li key={step.key} className={clsx('flex items-center', index < STEPS.length - 1 && 'flex-1')}>
                <button
                  onClick={() => setCurrentStep(index)}
                  className="flex items-center group"
                >
                  <span
                    className={clsx(
                      'flex h-10 w-10 items-center justify-center rounded-full border-2 text-sm font-medium transition-colors',
                      completed
                        ? 'bg-primary-600 border-primary-600 text-white'
                        : isCurrent
                        ? 'border-primary-600 text-primary-600'
                        : 'border-gray-300 text-gray-500 group-hover:border-gray-400'
                    )}
                  >
                    {completed ? (
                      <CheckIcon className="h-5 w-5" />
                    ) : (
                      index + 1
                    )}
                  </span>
                  <span
                    className={clsx(
                      'ml-3 text-sm font-medium hidden sm:block',
                      isCurrent ? 'text-primary-600' : completed ? 'text-gray-900' : 'text-gray-500'
                    )}
                  >
                    {step.label}
                  </span>
                </button>
                {index < STEPS.length - 1 && (
                  <div className={clsx(
                    'flex-1 h-0.5 mx-4',
                    isStepComplete(STEPS[index]!.key) ? 'bg-primary-600' : 'bg-gray-200'
                  )} />
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Progress Bar */}
      {progress && (
        <div className="mb-6">
          <div className="flex justify-between text-sm text-gray-600 mb-1">
            <span>Overall Progress</span>
            <span>{progress.percentage}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-primary-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress.percentage}%` }}
            />
          </div>
        </div>
      )}

      {/* Step Content */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        {currentStep === 0 && <PortalProfile />}
        {currentStep === 1 && <PortalDocuments />}
        {currentStep === 2 && <PortalLicenseForm />}
        {currentStep === 3 && <PortalLocations />}
        {currentStep === 4 && (
          <div>
            <h2 className="text-xl font-bold text-gray-900 mb-4">Review & Complete</h2>
            <p className="text-sm text-gray-500 mb-6">
              Review your progress below. You can go back to any step to make changes.
            </p>
            <div className="space-y-3">
              {STEPS.slice(0, 4).map((step) => {
                const completed = isStepComplete(step.key);
                return (
                  <div
                    key={step.key}
                    className={clsx(
                      'flex items-center gap-3 p-4 rounded-lg border',
                      completed ? 'border-green-200 bg-green-50' : 'border-yellow-200 bg-yellow-50'
                    )}
                  >
                    {completed ? (
                      <CheckIcon className="h-6 w-6 text-green-600 flex-shrink-0" />
                    ) : (
                      <div className="h-6 w-6 rounded-full border-2 border-yellow-400 flex-shrink-0" />
                    )}
                    <span className={clsx('text-sm font-medium', completed ? 'text-green-800' : 'text-yellow-800')}>
                      {step.label}
                    </span>
                    {!completed && (
                      <button
                        onClick={() => setCurrentStep(STEPS.findIndex(s => s.key === step.key))}
                        className="ml-auto text-xs text-primary-600 hover:text-primary-800 font-medium"
                      >
                        Go to step
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-8">
              <button
                onClick={handleComplete}
                disabled={completeMutation.isPending}
                className="w-full sm:w-auto inline-flex justify-center items-center px-6 py-3 border border-transparent text-sm font-medium rounded-lg text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50"
              >
                {completeMutation.isPending ? 'Completing...' : 'Complete Onboarding'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Navigation Buttons */}
      <div className="flex justify-between">
        <button
          onClick={handleBack}
          disabled={currentStep === 0}
          className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Back
        </button>
        <div className="flex gap-3">
          {currentStep < STEPS.length - 1 && currentStep !== 4 && (
            <button
              onClick={handleSkip}
              className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-500 bg-white hover:bg-gray-50"
            >
              Skip
            </button>
          )}
          {currentStep < STEPS.length - 1 && (
            <button
              onClick={handleNext}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700"
            >
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
