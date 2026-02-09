import { useState, useEffect } from 'react';
import { XCircleIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { useTerminationLetter, useUpdateLetter, useSendLetter } from '../../hooks/useTasks';
import toast from 'react-hot-toast';

interface TerminationLetterModalProps {
  letterId: string;
  onClose: () => void;
}

const STATUS_STEPS = [
  { key: 'DRAFT', label: 'Draft' },
  { key: 'REVIEWED', label: 'Reviewed' },
  { key: 'SENT', label: 'Sent' },
];

function getStepIndex(status: string): number {
  const idx = STATUS_STEPS.findIndex((s) => s.key === status);
  return idx >= 0 ? idx : 0;
}

export default function TerminationLetterModal({ letterId, onClose }: TerminationLetterModalProps) {
  const { data, isLoading } = useTerminationLetter(letterId);
  const updateLetter = useUpdateLetter();
  const sendLetter = useSendLetter();

  const letter = data?.data;

  const [letterContent, setLetterContent] = useState('');
  const [payerEmail, setPayerEmail] = useState('');
  const [hasContentChanges, setHasContentChanges] = useState(false);

  useEffect(() => {
    if (letter) {
      setLetterContent(letter.letterContent);
      setPayerEmail(letter.payerEmail || '');
    }
  }, [letter]);

  const isSent = letter?.status === 'SENT';
  const isReviewed = letter?.status === 'REVIEWED';
  const isDraft = letter?.status === 'DRAFT';
  const currentStep = getStepIndex(letter?.status || 'DRAFT');

  const handleSaveContent = async () => {
    try {
      await updateLetter.mutateAsync({
        letterId,
        data: { letterContent },
      });
      setHasContentChanges(false);
      toast.success('Letter saved');
    } catch {
      toast.error('Failed to save letter');
    }
  };

  const handleMarkReviewed = async () => {
    try {
      // Save any pending content changes first
      const data: Record<string, unknown> = { status: 'REVIEWED' };
      if (hasContentChanges) {
        data.letterContent = letterContent;
      }
      await updateLetter.mutateAsync({ letterId, data });
      setHasContentChanges(false);
      toast.success('Letter marked as reviewed');
    } catch {
      toast.error('Failed to update letter status');
    }
  };

  const handleSend = async () => {
    if (!payerEmail) {
      toast.error('Payer email is required to send the letter');
      return;
    }
    try {
      await sendLetter.mutateAsync(letterId);
      toast.success('Letter marked as sent');
    } catch {
      toast.error('Failed to send letter');
    }
  };

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto">
        <div className="flex items-center justify-center min-h-screen">
          <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm" />
          <div className="relative z-10 bg-white rounded-2xl p-8 shadow-xl">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200 border-t-primary-600 mx-auto"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!letter) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
        <div
          className="fixed inset-0 transition-opacity bg-gray-900/40 backdrop-blur-sm"
          onClick={onClose}
        />

        <div className="relative z-10 inline-block w-full max-w-2xl p-6 my-8 text-left align-middle bg-white rounded-2xl shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-lg font-medium text-gray-900">
              Termination Letter — {letter.payerName}
            </h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <XCircleIcon className="h-6 w-6" />
            </button>
          </div>

          {/* Status Stepper */}
          <div className="flex items-center gap-2 mb-6">
            {STATUS_STEPS.map((step, idx) => {
              const isComplete = idx < currentStep;
              const isCurrent = idx === currentStep;
              return (
                <div key={step.key} className="flex items-center gap-2">
                  {idx > 0 && (
                    <div className={`h-px w-8 ${idx <= currentStep ? 'bg-primary-500' : 'bg-gray-200'}`} />
                  )}
                  <div className="flex items-center gap-1.5">
                    {isComplete ? (
                      <CheckCircleIcon className="h-5 w-5 text-primary-600" />
                    ) : (
                      <div
                        className={`h-5 w-5 rounded-full border-2 flex items-center justify-center ${
                          isCurrent ? 'border-primary-600' : 'border-gray-300'
                        }`}
                      >
                        {isCurrent && <div className="h-2 w-2 rounded-full bg-primary-600" />}
                      </div>
                    )}
                    <span
                      className={`text-sm font-medium ${
                        isComplete || isCurrent ? 'text-primary-700' : 'text-gray-400'
                      }`}
                    >
                      {step.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="max-h-[65vh] overflow-y-auto space-y-5 pr-1">
            {/* Provider Reference Info */}
            <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                Provider Information
              </h4>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-slate-500">Name:</span>
                  <p className="font-medium text-slate-900">{letter.providerName}</p>
                </div>
                <div>
                  <span className="text-slate-500">NPI:</span>
                  <p className="font-medium text-slate-900">{letter.npi}</p>
                </div>
                <div>
                  <span className="text-slate-500">Group NPI:</span>
                  <p className="font-medium text-slate-900">{letter.groupNpi || 'N/A'}</p>
                </div>
                <div>
                  <span className="text-slate-500">Tax ID:</span>
                  <p className="font-medium text-slate-900">{letter.taxId}</p>
                </div>
              </div>
            </div>

            {/* Payer Email */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Payer Email
              </label>
              <input
                type="email"
                value={payerEmail}
                onChange={(e) => setPayerEmail(e.target.value)}
                disabled={isSent}
                placeholder="payer-credentialing@insurance.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-gray-100 disabled:text-gray-500"
              />
              {!payerEmail && !isSent && (
                <p className="text-xs text-yellow-600 mt-1">
                  Payer email is required before sending the letter.
                </p>
              )}
            </div>

            {/* Letter Content */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Letter Content
              </label>
              <textarea
                value={letterContent}
                onChange={(e) => {
                  setLetterContent(e.target.value);
                  setHasContentChanges(true);
                }}
                disabled={isSent}
                rows={18}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm disabled:bg-gray-100 disabled:text-gray-500"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-between items-center mt-5 pt-4 border-t">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
            >
              Close
            </button>

            <div className="flex gap-3">
              {/* Save changes (only when content modified and not sent) */}
              {hasContentChanges && !isSent && (
                <button
                  type="button"
                  onClick={handleSaveContent}
                  disabled={updateLetter.isPending}
                  className="px-4 py-2 text-primary-600 bg-primary-50 rounded-md hover:bg-primary-100 disabled:opacity-50"
                >
                  {updateLetter.isPending ? 'Saving...' : 'Save Changes'}
                </button>
              )}

              {/* Mark as Reviewed (only when DRAFT) */}
              {isDraft && (
                <button
                  type="button"
                  onClick={handleMarkReviewed}
                  disabled={updateLetter.isPending}
                  className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
                >
                  {updateLetter.isPending ? 'Updating...' : 'Mark as Reviewed'}
                </button>
              )}

              {/* Send (only when REVIEWED and payer email present) */}
              {isReviewed && (
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={sendLetter.isPending || !payerEmail}
                  className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {sendLetter.isPending ? 'Sending...' : 'Send Letter'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
