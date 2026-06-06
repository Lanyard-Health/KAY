import { useState } from 'react';

interface DeletePracticeModalProps {
  practiceName: string;
  onConfirm: (deletionReason: string | null) => void;
  onCancel: () => void;
  isSubmitting?: boolean;
}

const REASON_OPTIONS = [
  { value: '', label: 'Reason (optional)' },
  { value: 'Duplicate', label: 'Duplicate' },
  { value: 'Data error', label: 'Data error' },
  { value: 'Practice closed', label: 'Practice closed' },
  { value: 'Test record', label: 'Test record' },
  { value: 'Other', label: 'Other' },
];

const NOTES_MAX = 500;

export default function DeletePracticeModal({
  practiceName,
  onConfirm,
  onCancel,
  isSubmitting = false,
}: DeletePracticeModalProps) {
  const [reasonSelect, setReasonSelect] = useState('');
  const [notes, setNotes] = useState('');

  const handleConfirm = () => {
    const reasonPart = reasonSelect && reasonSelect !== 'Other' ? reasonSelect : '';
    const notesPart = notes.trim();
    let combined: string | null;
    if (reasonPart && notesPart) combined = `${reasonPart} — ${notesPart}`;
    else if (reasonPart) combined = reasonPart;
    else if (notesPart) combined = notesPart;
    else combined = null;
    onConfirm(combined);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
        <div
          className="fixed inset-0 transition-opacity bg-gray-900/40 backdrop-blur-sm"
          onClick={isSubmitting ? undefined : onCancel}
          aria-hidden="true"
        />

        <div className="relative z-10 inline-block w-full max-w-md p-6 my-8 text-left align-middle bg-white rounded-2xl shadow-xl">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-shrink-0 flex items-center justify-center h-10 w-10 rounded-full bg-red-100">
              <svg className="h-5 w-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900">Delete this practice?</h3>
          </div>

          <p className="text-sm text-gray-700 mb-4">
            <span className="font-semibold">{practiceName}</span> will be hidden from active lists.
            The record stays in the system for our records and can be restored later. Providers and
            users attached to this practice will remain in place.
          </p>

          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="delete-practice-reason">
            Reason
          </label>
          <select
            id="delete-practice-reason"
            value={reasonSelect}
            onChange={(e) => setReasonSelect(e.target.value)}
            className="w-full mb-3 px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-primary-500 focus:border-primary-500"
            disabled={isSubmitting}
          >
            {REASON_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="delete-practice-notes">
            Notes (optional)
          </label>
          <textarea
            id="delete-practice-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, NOTES_MAX))}
            maxLength={NOTES_MAX}
            rows={3}
            placeholder="Anything you want to record — fully optional."
            className="w-full mb-6 px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-primary-500 focus:border-primary-500"
            disabled={isSubmitting}
          />

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={isSubmitting}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isSubmitting}
              className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
            >
              {isSubmitting ? 'Deleting…' : 'Delete practice'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
