import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { SparklesIcon, XMarkIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';
import { useApprovals, type Approval } from '../hooks/useApprovals';

const AUTO_DISMISS_MS = 30_000;
const MAX_VISIBLE = 3;

interface ToastItem {
  approval: Approval;
  visible: boolean;
}

export default function ApprovalToasts() {
  const navigate = useNavigate();
  const { data: approvals } = useApprovals('pending');
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seenIds = useRef<Set<string>>(new Set());
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Detect new pending approvals and create toasts
  useEffect(() => {
    if (!approvals) return;

    const newToasts: ToastItem[] = [];
    for (const approval of approvals) {
      if (!seenIds.current.has(approval.id)) {
        seenIds.current.add(approval.id);
        newToasts.push({ approval, visible: true });
      }
    }

    if (newToasts.length > 0) {
      setToasts((prev) => [...prev, ...newToasts]);
    }
  }, [approvals]);

  // Set auto-dismiss timers for visible toasts
  useEffect(() => {
    for (const toast of toasts) {
      if (toast.visible && !timers.current.has(toast.approval.id)) {
        const timer = setTimeout(() => {
          dismiss(toast.approval.id);
        }, AUTO_DISMISS_MS);
        timers.current.set(toast.approval.id, timer);
      }
    }

    return () => {
      // Cleanup is handled per-toast in dismiss
    };
  }, [toasts]);

  const dismiss = useCallback((id: string) => {
    // Start exit animation
    setToasts((prev) =>
      prev.map((t) =>
        t.approval.id === id ? { ...t, visible: false } : t,
      ),
    );

    // Clear timer
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }

    // Remove from DOM after animation
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.approval.id !== id));
    }, 300);
  }, []);

  const handleReview = useCallback(
    (id: string) => {
      dismiss(id);
      navigate('/ai-agent');
    },
    [dismiss, navigate],
  );

  // Cleanup all timers on unmount
  useEffect(() => {
    return () => {
      timers.current.forEach((timer) => clearTimeout(timer));
      timers.current.clear();
    };
  }, []);

  const visibleToasts = toasts.slice(-MAX_VISIBLE);

  if (visibleToasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-3">
      {visibleToasts.map((toast) => {
        const { approval } = toast;
        const description =
          approval.workflow?.goal ||
          approval.type ||
          'Action requires your approval';

        return (
          <div
            key={approval.id}
            className={clsx(
              'max-w-sm rounded-xl border border-gray-200 bg-white p-4 shadow-lg transition-all duration-300',
              toast.visible
                ? 'translate-y-0 opacity-100'
                : 'translate-y-2 opacity-0',
            )}
          >
            <div className="flex items-start gap-3">
              <SparklesIcon className="h-5 w-5 shrink-0 text-violet-500 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900">
                  AI needs approval
                </p>
                <p className="mt-0.5 text-sm text-gray-600 truncate">
                  {description}
                </p>
                {(approval.workflow.provider || approval.workflow.payer) && (
                  <p className="mt-0.5 text-xs text-gray-400 truncate">
                    {approval.workflow.provider
                      ? `${approval.workflow.provider.firstName} ${approval.workflow.provider.lastName}`
                      : ''}
                    {approval.workflow.provider && approval.workflow.payer
                      ? ' - '
                      : ''}
                    {approval.workflow.payer?.name ?? ''}
                  </p>
                )}
                <div className="mt-2 flex items-center gap-3">
                  <button
                    onClick={() => handleReview(approval.id)}
                    className="text-sm font-medium text-primary-600 hover:text-primary-700"
                  >
                    Review
                  </button>
                  <button
                    onClick={() => dismiss(approval.id)}
                    className="text-sm text-gray-400 hover:text-gray-600"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
              <button
                onClick={() => dismiss(approval.id)}
                className="shrink-0 text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
