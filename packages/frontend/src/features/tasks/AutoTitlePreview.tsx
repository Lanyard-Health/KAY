import { useEffect, useState } from 'react';
import { composeTaskTitle, type TaskGroup } from '@credential-management/shared';

interface AutoTitlePreviewProps {
  group: TaskGroup | '';
  payerName?: string;
  practiceName?: string;
}

// Read-only preview of the server-composed title (D1, D3). role="status" +
// polite live region; the rendered text is debounced 300ms so screen readers
// hear one settled recomposition, not one per keystroke. Styled per
// {components.auto-title-preview}: green-50 panel, green-100 border, must NOT
// look like an input (it must not invite typing).
export default function AutoTitlePreview({ group, payerName, practiceName }: AutoTitlePreviewProps) {
  const composed = group ? composeTaskTitle(group, payerName, practiceName) : '—';
  const [settled, setSettled] = useState(composed);

  useEffect(() => {
    const handle = setTimeout(() => setSettled(composed), 300);
    return () => clearTimeout(handle);
  }, [composed]);

  return (
    <div className="rounded-xl border border-primary-100 bg-primary-50 px-3.5 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-[.05em] text-gray-500">Task title (automatic)</p>
      <p
        role="status"
        aria-live="polite"
        aria-label="Task title, automatic"
        className="mt-0.5 text-[13px] font-semibold text-primary-800"
      >
        {settled}
      </p>
    </div>
  );
}
