import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircleIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useNotifications, useMarkNotificationsRead } from '../hooks/useNotifications';
import { useAuthStore } from '../stores/auth.store';

interface TaskToast {
  id: string;
  taskId: string;
  title: string;
}

const AUTO_DISMISS_MS = 10_000;
const MAX_VISIBLE = 3;

export default function TaskAssignmentToasts() {
  const user = useAuthStore((s) => s.user);
  const enabled = user?.role === 'admin' || user?.role === 'lanyard_staff';
  const { data } = useNotifications({ unreadOnly: true, limit: 10 });
  const markRead = useMarkNotificationsRead();
  const navigate = useNavigate();
  const seenIds = useRef<Set<string> | null>(null);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [toasts, setToasts] = useState<TaskToast[]>([]);

  const dismiss = (id: string) => {
    setToasts((t) => t.filter((x) => x.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  };

  useEffect(() => {
    if (!enabled || !data) return;
    const items = data.notifications ?? [];
    const taskItems = items.filter(
      (n) => n.metadata?.kind === 'task_assigned' && n.metadata?.taskId,
    );
    if (seenIds.current === null) {
      seenIds.current = new Set(taskItems.map((n) => n.id)); // prime — no toast storm on login
      return;
    }
    // Items arrive newest-first from the API; collect all unseen ones before
    // touching state so a single poll with multiple new items preserves order.
    const freshToasts: TaskToast[] = [];
    for (const n of taskItems) {
      if (seenIds.current.has(n.id)) continue;
      seenIds.current.add(n.id);
      freshToasts.push({
        id: n.id,
        taskId: n.metadata!.taskId as string,
        title: n.message.replace('You have been assigned: ', ''),
      });
    }
    if (freshToasts.length === 0) return;
    setToasts((t) => [...freshToasts, ...t].slice(0, MAX_VISIBLE));
    for (const toast of freshToasts) {
      const timer = setTimeout(() => {
        timers.current.delete(toast.id);
        setToasts((t) => t.filter((x) => x.id !== toast.id));
      }, AUTO_DISMISS_MS);
      timers.current.set(toast.id, timer);
    }
  }, [data, enabled]);

  // Cleanup all timers on unmount
  useEffect(() => {
    return () => {
      timers.current.forEach((timer) => clearTimeout(timer));
      timers.current.clear();
    };
  }, []);

  if (!enabled || toasts.length === 0) return null;

  return (
    <div className="fixed right-4 top-16 z-50 flex w-80 flex-col gap-2" role="status">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="flex items-start gap-2.5 rounded-2xl border border-gray-200/80 bg-white p-3.5 shadow-lg"
        >
          <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-primary-100 text-primary-800">
            <CheckCircleIcon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-gray-900">New task assigned to you</p>
            <p className="truncate text-xs text-gray-600">{t.title}</p>
            <button
              type="button"
              className="mt-1 text-xs font-semibold text-primary-700 hover:underline"
              onClick={() => {
                markRead.mutate([t.id]);
                dismiss(t.id);
                navigate(`/tasks?taskId=${t.taskId}`);
              }}
            >
              View task
            </button>
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            className="ml-auto text-gray-400 hover:text-gray-600"
            onClick={() => dismiss(t.id)}
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
