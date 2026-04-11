import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  UserPlusIcon,
  DocumentArrowUpIcon,
  ClipboardDocumentListIcon,
  ArrowUpTrayIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { CheckCircleIcon as CheckCircleSolidIcon } from '@heroicons/react/24/solid';
import clsx from 'clsx';

interface GettingStartedChecklistProps {
  providerCount: number;
  documentCount: number;
  enrollmentCount: number;
  onDismiss?: () => void;
}

export default function GettingStartedChecklist({
  providerCount,
  documentCount,
  enrollmentCount,
  onDismiss,
}: GettingStartedChecklistProps) {
  const [dismissed, setDismissed] = useState(false);

  const allComplete = providerCount > 0 && documentCount > 0 && enrollmentCount > 0;

  if (dismissed) return null;

  const steps = [
    {
      label: 'Add your providers',
      count: providerCount,
      countLabel: 'added',
      complete: providerCount > 0,
      icon: UserPlusIcon,
      actions: [
        { label: 'Add Provider', href: '/providers/new' },
        { label: 'Bulk Import', href: '/providers/import' },
      ],
    },
    {
      label: 'Upload provider documents',
      count: documentCount,
      countLabel: 'uploaded',
      complete: documentCount > 0,
      icon: DocumentArrowUpIcon,
      actions: [
        { label: 'Go to Documents', href: '/documents' },
      ],
    },
    {
      label: 'Start insurance enrollments',
      count: enrollmentCount,
      countLabel: 'started',
      complete: enrollmentCount > 0,
      icon: ClipboardDocumentListIcon,
      actions: [
        { label: 'Go to Enrollments', href: '/enrollments' },
      ],
    },
  ];

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss?.();
  };

  return (
    <div className="space-y-4">
      {/* Success banner */}
      {allComplete && (
        <div className="bg-primary-50 border border-primary-200 rounded-2xl p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CheckCircleSolidIcon className="h-6 w-6 text-primary-600 flex-shrink-0" />
            <div>
              <p className="font-semibold text-primary-900">You're all set!</p>
              <p className="text-sm text-primary-700">Your dashboard is ready.</p>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors"
          >
            View Dashboard
          </button>
        </div>
      )}

      {/* Checklist card */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">
            Welcome to Lanyard! Here's how to get started:
          </h3>
          {allComplete && (
            <button
              onClick={handleDismiss}
              className="text-gray-400 hover:text-gray-500 transition-colors"
              aria-label="Dismiss checklist"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          )}
        </div>
        <div className="p-5 space-y-5">
          {steps.map((step, index) => (
            <div key={index} className="flex items-start gap-4">
              {/* Checkbox */}
              <div className="flex-shrink-0 mt-0.5">
                {step.complete ? (
                  <CheckCircleSolidIcon className="h-6 w-6 text-primary-600" />
                ) : (
                  <div className="h-6 w-6 rounded-full border-2 border-gray-300" />
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p
                    className={clsx(
                      'font-medium',
                      step.complete ? 'text-gray-500 line-through' : 'text-gray-900',
                    )}
                  >
                    {step.label}
                  </p>
                  <span
                    className={clsx(
                      'text-xs font-medium px-2 py-0.5 rounded-full',
                      step.complete
                        ? 'bg-primary-100 text-primary-700'
                        : 'bg-gray-100 text-gray-500',
                    )}
                  >
                    {step.count} {step.countLabel}
                  </span>
                </div>

                {/* Action buttons */}
                {!step.complete && (
                  <div className="mt-2 flex gap-2">
                    {step.actions.map((action) => (
                      <Link
                        key={action.href}
                        to={action.href}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-primary-700 bg-primary-50 rounded-lg hover:bg-primary-100 transition-colors"
                      >
                        {action.label === 'Bulk Import' ? (
                          <ArrowUpTrayIcon className="h-4 w-4" />
                        ) : (
                          <step.icon className="h-4 w-4" />
                        )}
                        {action.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
