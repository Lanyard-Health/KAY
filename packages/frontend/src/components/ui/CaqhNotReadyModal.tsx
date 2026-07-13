import { Fragment } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { ExclamationTriangleIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import { CAQH_PROVIEW_PO_URL } from '../../hooks/useCaqhCredentials';

// Plain-English labels for every missing-field code the backend's roster
// resolver can emit (caqh.service.ts resolveCaqhRosterData). Unknown codes fall
// back to a cleaned-up version of the code itself — never raw snake_case.
const MISSING_FIELD_LABELS: Record<string, string> = {
  practice_location_missing: 'a practice location',
  practiceState: 'a practice state',
  address1: 'a practice address line',
  city: 'a practice city',
  state: 'a practice state',
  zip: 'a practice ZIP code',
  npi: 'an NPI number',
  firstName: 'a first name',
  lastName: 'a last name',
  dateOfBirth: 'a date of birth',
  provider_not_found: 'a provider profile',
};

export function humanizeMissingField(code: string): string {
  if (MISSING_FIELD_LABELS[code]) return MISSING_FIELD_LABELS[code];
  if (code.startsWith('provider_type_')) return 'a recognized provider type or taxonomy';
  // Safety net for future backend codes: strip any parenthetical detail, turn
  // snake_case/camelCase into spaced lowercase words.
  return code
    .replace(/\s*\(.*\)$/, '')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim();
}

interface CaqhNotReadyModalProps {
  isOpen: boolean;
  onClose: () => void;
  missingFields: string[];
}

export default function CaqhNotReadyModal({ isOpen, onClose, missingFields }: CaqhNotReadyModalProps) {
  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 rounded-full p-2 bg-amber-100 text-amber-600">
                    <ExclamationTriangleIcon className="h-6 w-6" />
                  </div>
                  <div className="flex-1">
                    <Dialog.Title className="text-lg font-semibold text-gray-900">
                      This provider isn't ready to import from CAQH
                    </Dialog.Title>
                    <p className="mt-2 text-sm text-gray-600">
                      Before importing, complete the provider's profile and make sure
                      they're set up on your CAQH roster. This provider is still missing:
                    </p>
                    <ul className="mt-2 list-disc pl-5 text-sm text-gray-700">
                      {missingFields.map((code) => (
                        <li key={code}>{humanizeMissingField(code)}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="mt-6 flex flex-col sm:flex-row sm:justify-end gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors"
                  >
                    Close
                  </button>
                  <a
                    href={CAQH_PROVIEW_PO_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 transition-colors"
                  >
                    Open CAQH Portal
                    <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                  </a>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
