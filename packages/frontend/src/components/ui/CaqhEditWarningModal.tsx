import { Fragment } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { CloudArrowDownIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import { CAQH_PROVIEW_URL } from '../../hooks/useCaqhCredentials';
import { useCaqhConfig } from '../../hooks/useCaqhSync';

interface CaqhEditWarningModalProps {
  isOpen: boolean;
  onClose: () => void;
  onEditAnyway: () => void;
  recordType?: string;
}

export default function CaqhEditWarningModal({
  isOpen,
  onClose,
  onEditAnyway,
  recordType = 'record',
}: CaqhEditWarningModalProps) {
  const { data: caqhConfig } = useCaqhConfig();
  const proviewUrl = caqhConfig?.proviewUrl ?? CAQH_PROVIEW_URL;

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
                  <div className="flex-shrink-0 rounded-full p-2 bg-primary-100 text-primary-600">
                    <CloudArrowDownIcon className="h-6 w-6" />
                  </div>
                  <div className="flex-1">
                    <Dialog.Title className="text-lg font-semibold text-gray-900">
                      This {recordType} is synced from CAQH
                    </Dialog.Title>
                    <p className="mt-2 text-sm text-gray-600">
                      Edits made here will be overwritten on the next nightly CAQH sync.
                      To make permanent changes, update your CAQH ProView profile directly.
                    </p>
                  </div>
                </div>

                <div className="mt-6 flex flex-col sm:flex-row sm:justify-end gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={onEditAnyway}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 transition-colors"
                  >
                    Edit anyway
                  </button>
                  <a
                    href={proviewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 transition-colors"
                  >
                    Update in CAQH
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
