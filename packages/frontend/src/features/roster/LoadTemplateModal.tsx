import { Fragment } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { TrashIcon } from '@heroicons/react/24/outline';
import type { RosterTemplate } from '../../hooks/useRoster';

interface LoadTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  templates: RosterTemplate[];
  onLoad: (template: RosterTemplate) => void;
  onDelete: (id: string) => void;
  isLoading: boolean;
  currentUserId?: string;
}

export default function LoadTemplateModal({
  isOpen,
  onClose,
  templates,
  onLoad,
  onDelete,
  isLoading,
  currentUserId,
}: LoadTemplateModalProps) {
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
          <div className="fixed inset-0 bg-gray-500/75 transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 z-10 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <Dialog.Panel className="relative transform overflow-hidden rounded-lg bg-white px-4 pb-4 pt-5 shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg sm:p-6">
                <Dialog.Title className="text-lg font-semibold text-gray-900 mb-4">
                  Load Template
                </Dialog.Title>

                {isLoading ? (
                  <div className="py-8 text-center text-sm text-gray-400">Loading templates...</div>
                ) : templates.length === 0 ? (
                  <div className="py-8 text-center text-sm text-gray-400">No saved templates</div>
                ) : (
                  <ul className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
                    {templates.map((template) => {
                      const columns = template.columns as any[];
                      const isOwner = template.createdById === currentUserId;
                      return (
                        <li key={template.id} className="flex items-center gap-3 py-3">
                          <button
                            type="button"
                            onClick={() => {
                              onLoad(template);
                              onClose();
                            }}
                            className="flex-1 text-left hover:bg-gray-50 rounded-md px-2 py-1 -mx-2"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-gray-900">
                                {template.name}
                              </span>
                              {template.isShared && (
                                <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                                  Shared
                                </span>
                              )}
                            </div>
                            {template.description && (
                              <p className="text-xs text-gray-500 mt-0.5">{template.description}</p>
                            )}
                            <p className="text-xs text-gray-400 mt-0.5">
                              {columns.length} columns
                              {template.createdBy &&
                                ` · by ${template.createdBy.firstName} ${template.createdBy.lastName}`}
                              {' · '}
                              {new Date(template.updatedAt).toLocaleDateString()}
                            </p>
                          </button>
                          {isOwner && (
                            <button
                              type="button"
                              onClick={() => onDelete(template.id)}
                              className="p-1.5 text-gray-400 hover:text-red-500 rounded"
                              title="Delete template"
                            >
                              <TrashIcon className="h-4 w-4" />
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}

                <div className="mt-5 flex justify-end">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Close
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}
