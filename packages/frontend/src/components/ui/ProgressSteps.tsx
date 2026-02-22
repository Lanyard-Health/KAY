import clsx from 'clsx';
import { CheckIcon } from '@heroicons/react/20/solid';

interface Step {
  label: string;
  icon?: React.ReactNode;
}

interface ProgressStepsProps {
  steps: Step[];
  currentStep: number; // 0-indexed
  className?: string;
}

export default function ProgressSteps({
  steps,
  currentStep,
  className,
}: ProgressStepsProps) {
  return (
    <nav className={clsx('flex items-center', className)}>
      <ol className="flex items-center w-full">
        {steps.map((step, index) => {
          const isCompleted = index < currentStep;
          const isCurrent = index === currentStep;

          return (
            <li
              key={step.label}
              className={clsx(
                'flex items-center',
                index < steps.length - 1 && 'flex-1',
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={clsx(
                    'flex items-center justify-center w-8 h-8 rounded-full text-xs font-medium shrink-0 transition-colors',
                    isCompleted && 'bg-primary-600 text-white',
                    isCurrent && 'bg-primary-100 text-primary-700 ring-2 ring-primary-600',
                    !isCompleted && !isCurrent && 'bg-gray-100 text-gray-500',
                  )}
                >
                  {isCompleted ? (
                    <CheckIcon className="h-4 w-4" />
                  ) : (
                    step.icon || index + 1
                  )}
                </span>
                <span
                  className={clsx(
                    'text-sm font-medium hidden sm:block',
                    isCurrent ? 'text-primary-700' : isCompleted ? 'text-gray-900' : 'text-gray-500',
                  )}
                >
                  {step.label}
                </span>
              </div>
              {index < steps.length - 1 && (
                <div
                  className={clsx(
                    'flex-1 h-0.5 mx-3',
                    isCompleted ? 'bg-primary-600' : 'bg-gray-200',
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
