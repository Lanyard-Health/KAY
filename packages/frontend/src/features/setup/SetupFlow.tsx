import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import {
  BuildingOffice2Icon,
  UserPlusIcon,
  DocumentCheckIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';

const STEPS = [
  { label: 'Practice Profile', path: '/setup/practice', icon: BuildingOffice2Icon },
  { label: 'Add Provider', path: '/setup/provider', icon: UserPlusIcon },
  { label: 'Enroll with Payers', path: '/setup/enroll', icon: DocumentCheckIcon },
];

function getActiveIndex(pathname: string): number {
  const idx = STEPS.findIndex((s) => pathname.startsWith(s.path));
  return idx === -1 ? 0 : idx;
}

export default function SetupFlow() {
  const location = useLocation();
  const navigate = useNavigate();
  const activeIndex = getActiveIndex(location.pathname);

  return (
    <div className="min-h-screen bg-gray-50/60">
      <div className="max-w-3xl mx-auto px-4 pt-10 pb-16">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-gray-900">Set Up Your Practice</h1>
          <p className="mt-1 text-sm text-gray-500">
            Get credentialing in under 10 minutes.
          </p>
        </div>

        {/* Step Indicator */}
        <nav className="mb-10">
          <ol className="flex items-center justify-between">
            {STEPS.map((step, index) => {
              const isCompleted = index < activeIndex;
              const isCurrent = index === activeIndex;
              const Icon = step.icon;

              return (
                <li key={step.path} className="flex flex-1 items-center">
                  <button
                    type="button"
                    onClick={() => {
                      if (isCompleted) navigate(step.path);
                    }}
                    disabled={!isCompleted}
                    className={clsx(
                      'flex items-center gap-2 group',
                      isCompleted && 'cursor-pointer',
                      !isCompleted && !isCurrent && 'cursor-default',
                    )}
                  >
                    {/* Circle */}
                    <span
                      className={clsx(
                        'flex items-center justify-center w-9 h-9 rounded-full border-2 transition-colors',
                        isCompleted && 'bg-primary-600 border-primary-600 text-white',
                        isCurrent && 'border-primary-600 bg-white text-primary-600',
                        !isCompleted && !isCurrent && 'border-gray-300 bg-white text-gray-400',
                      )}
                    >
                      {isCompleted ? (
                        <CheckIcon className="w-5 h-5" />
                      ) : (
                        <Icon className="w-4 h-4" />
                      )}
                    </span>

                    {/* Label */}
                    <span
                      className={clsx(
                        'text-sm font-medium hidden sm:inline',
                        isCurrent && 'text-primary-700',
                        isCompleted && 'text-primary-600 group-hover:text-primary-800',
                        !isCompleted && !isCurrent && 'text-gray-400',
                      )}
                    >
                      {step.label}
                    </span>
                  </button>

                  {/* Connector line */}
                  {index < STEPS.length - 1 && (
                    <div
                      className={clsx(
                        'flex-1 h-0.5 mx-3',
                        index < activeIndex ? 'bg-primary-500' : 'bg-gray-200',
                      )}
                    />
                  )}
                </li>
              );
            })}
          </ol>
        </nav>

        {/* Step Content */}
        <Outlet />
      </div>
    </div>
  );
}
