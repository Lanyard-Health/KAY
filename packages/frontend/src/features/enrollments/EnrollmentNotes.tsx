import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TrashIcon, ChatBubbleLeftIcon } from '@heroicons/react/24/outline';
import { api } from '../../services/api';
import { useAuthStore } from '../../stores/auth.store';
import { notify } from '../../utils/notify';

export interface NoteEntry {
  id: string;
  body: string;
  createdAt: string;
  authorId: string | null;
  author: { id: string; firstName: string; lastName: string } | null;
}

// Mirrors the backend rule: the author may delete their own note; Lanyard
// roles may delete anyone's. Practice users can't delete each other's notes.
const DELETE_ROLES = ['admin', 'credentialing_staff', 'lanyard_staff'];

// Note timestamps are true instants — render in the viewer's local timezone.
// (Date-only fields elsewhere stay pinned to UTC; that rule doesn't apply here.)
function formatNoteTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function EnrollmentNotes({
  enrollmentId,
  notes,
}: {
  enrollmentId: string;
  notes: NoteEntry[];
}) {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['enrollment', enrollmentId] });

  const addNote = useMutation({
    mutationFn: async (body: string) => api.post(`/enrollments/${enrollmentId}/notes`, { body }),
    onSuccess: () => {
      setDraft('');
      invalidate();
    },
    onError: () =>
      notify.error("Couldn't add the note", {
        description: 'Your text is kept; try again in a moment.',
      }),
  });

  const deleteNote = useMutation({
    mutationFn: async (noteId: string) =>
      api.delete(`/enrollments/${enrollmentId}/notes/${noteId}`),
    onSuccess: () => {
      setConfirmingId(null);
      invalidate();
    },
    onError: () => notify.error("Couldn't delete the note", { description: 'Try again in a moment.' }),
  });

  const canDelete = (n: NoteEntry) =>
    !!user && (n.authorId === user.id || DELETE_ROLES.includes(user.role));

  const submit = () => {
    const body = draft.trim();
    if (body && !addNote.isPending) addNote.mutate(body);
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <ChatBubbleLeftIcon className="h-5 w-5 text-gray-400" />
          Notes
        </h2>
      </div>
      <div className="px-6 py-4 space-y-4">
        <div>
          <label htmlFor="new-enrollment-note" className="sr-only">
            Add a note
          </label>
          <textarea
            id="new-enrollment-note"
            rows={2}
            maxLength={2000}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a note for this enrollment…"
            className="input"
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={submit}
              disabled={!draft.trim() || addNote.isPending}
              className="btn-primary !w-auto px-4 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {addNote.isPending ? 'Adding…' : 'Add note'}
            </button>
          </div>
        </div>

        {notes.length === 0 ? (
          <p className="text-sm text-gray-500">No notes yet. Anything you add is timestamped and kept with the enrollment.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {notes.map((n) => (
              <li key={n.id} className="py-3 group">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500">
                      <span className="font-medium text-gray-700">
                        {n.author ? `${n.author.firstName} ${n.author.lastName}` : 'Former user'}
                      </span>{' '}
                      · {formatNoteTimestamp(n.createdAt)}
                    </p>
                    <p className="mt-1 text-sm text-gray-700 whitespace-pre-wrap">{n.body}</p>
                  </div>
                  {canDelete(n) &&
                    (confirmingId === n.id ? (
                      <span className="flex shrink-0 items-center gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() => deleteNote.mutate(n.id)}
                          disabled={deleteNote.isPending}
                          className="font-medium text-red-600 hover:text-red-700"
                        >
                          {deleteNote.isPending ? 'Deleting…' : 'Confirm delete'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingId(null)}
                          className="text-gray-500 hover:text-gray-700"
                        >
                          Keep
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmingId(n.id)}
                        aria-label={`Delete note from ${formatNoteTimestamp(n.createdAt)}`}
                        title="Delete note (recorded in the audit trail)"
                        className="shrink-0 rounded p-1 text-gray-400 opacity-0 transition group-hover:opacity-100 focus:opacity-100 hover:text-red-600"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
