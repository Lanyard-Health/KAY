interface TerminationConfirmDialogProps {
  enrollmentCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function TerminationConfirmDialog({
  enrollmentCount,
  onConfirm,
  onCancel,
}: TerminationConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
        <div
          className="fixed inset-0 transition-opacity bg-gray-900/40 backdrop-blur-sm"
          onClick={onCancel}
        />

        <div className="relative z-10 inline-block w-full max-w-md p-6 my-8 text-left align-middle bg-white rounded-2xl shadow-xl">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-shrink-0 flex items-center justify-center h-10 w-10 rounded-full bg-yellow-100">
              <svg className="h-5 w-5 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900">
              Create Termination Tasks?
            </h3>
          </div>

          <p className="text-sm text-gray-600 mb-2">
            Setting a termination date will create termination workflow tasks for{' '}
            <span className="font-semibold">{enrollmentCount} enrollment{enrollmentCount !== 1 ? 's' : ''}</span>{' '}
            with effective dates.
          </p>
          <p className="text-sm text-gray-500 mb-6">
            This includes tasks to terminate each enrollment, draft termination letters, check Availity, and update CAQH.
          </p>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
