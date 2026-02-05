import { useState } from 'react';
import { XMarkIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import type { GeneratedEmail } from '../../hooks/useAi';
import { useGenerateEmail } from '../../hooks/useAi';

interface AiEmailPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  email: GeneratedEmail;
  enrollmentId: string;
  recommendationId: string;
  providerName: string;
  payerName: string;
}

const toneBadgeColors: Record<string, string> = {
  polite: 'bg-green-100 text-green-800',
  assertive: 'bg-yellow-100 text-yellow-800',
  urgent: 'bg-red-100 text-red-800',
};

export default function AiEmailPreviewModal({
  isOpen,
  onClose,
  email,
  enrollmentId,
  providerName,
  payerName,
}: AiEmailPreviewModalProps) {
  const [showReasoning, setShowReasoning] = useState(false);
  const [toneOverride, setToneOverride] = useState('');
  const generateEmail = useGenerateEmail();

  if (!isOpen) return null;

  const handleRegenerate = () => {
    generateEmail.mutate({ enrollmentId, tone: toneOverride || undefined });
  };

  const handleCopyAndUse = () => {
    const emailText = `Subject: ${displayEmail.subject}\n\n${displayEmail.body}`;
    navigator.clipboard.writeText(emailText).catch(() => {});
    alert('Email content copied to clipboard. You can paste it into the follow-up email form.');
    onClose();
  };

  const displayEmail = generateEmail.data?.data?.email || email;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75" onClick={onClose} />

        <div className="relative w-full max-w-2xl rounded-lg bg-white shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">AI-Generated Follow-Up Email</h3>
              <p className="mt-1 text-sm text-gray-500">{providerName} → {payerName}</p>
            </div>
            <button onClick={onClose} className="rounded-md p-2 text-gray-400 hover:text-gray-500">
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>

          {/* Content */}
          <div className="px-6 py-4">
            {generateEmail.isPending ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
                <span className="ml-3 text-gray-600">Regenerating email...</span>
              </div>
            ) : (
              <>
                {/* Badges */}
                <div className="mb-4 flex items-center gap-2">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${toneBadgeColors[displayEmail.tone] || 'bg-gray-100 text-gray-800'}`}>
                    {displayEmail.tone}
                  </span>
                  <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
                    Escalation Level {displayEmail.escalationLevel}/5
                  </span>
                </div>

                {/* Subject */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700">Subject</label>
                  <div className="mt-1 rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm">
                    {displayEmail.subject}
                  </div>
                </div>

                {/* Body */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700">Email Body</label>
                  <div className="mt-1 rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm whitespace-pre-wrap max-h-64 overflow-y-auto">
                    {displayEmail.body}
                  </div>
                </div>

                {/* Reasoning */}
                <div className="mb-4">
                  <button
                    onClick={() => setShowReasoning(!showReasoning)}
                    className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
                  >
                    <svg className={`h-4 w-4 transition-transform ${showReasoning ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    AI Reasoning
                  </button>
                  {showReasoning && (
                    <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                      The AI chose a <strong>{displayEmail.tone}</strong> tone at escalation level{' '}
                      <strong>{displayEmail.escalationLevel}</strong> based on the follow-up history and enrollment context.
                    </div>
                  )}
                </div>

                {/* Regenerate */}
                <div className="flex items-center gap-2 border-t border-gray-200 pt-4">
                  <select
                    value={toneOverride}
                    onChange={(e) => setToneOverride(e.target.value)}
                    className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  >
                    <option value="">Default tone</option>
                    <option value="polite">Polite</option>
                    <option value="assertive">Assertive</option>
                    <option value="urgent">Urgent</option>
                  </select>
                  <button
                    onClick={handleRegenerate}
                    disabled={generateEmail.isPending}
                    className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    <ArrowPathIcon className="h-4 w-4" />
                    Regenerate
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 border-t border-gray-200 px-6 py-4">
            <button
              onClick={onClose}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleCopyAndUse}
              disabled={generateEmail.isPending}
              className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
            >
              Copy & Use
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
