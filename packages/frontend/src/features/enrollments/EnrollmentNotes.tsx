import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TrashIcon, PencilSquareIcon, ChatBubbleLeftIcon } from '@heroicons/react/24/outline';
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

// Mirrors the backend rule: the author may edit/delete their own note; Lanyard
// roles may edit/delete anyone's. Practice users can't touch each other's notes.
const MANAGE_ROLES = ['admin', 'credentialing_staff', 'lanyard_staff'];

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
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

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

  const editNote = useMutation({
    mutationFn: async ({ noteId, body }: { noteId: string; body: string }) =>
      api.put(`/enrollments/${enrollmentId}/notes/${noteId}`, { body }),
    onSuccess: () => {
      setEditingId(null);
      setEditDraft('');
      invalidate();
    },
    onError: () =>
      notify.error("Couldn't save the note", { description: 'Try again in a moment.' }),
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

  const canManage = (n: NoteEntry) =>
    !!user && (n.authorId === user.id || MANAGE_ROLES.includes(user.role));

  const submit = () => {
    const body = draft.trim();
    if (!body) {
      composerRef.current?.focus();
      return;
    }
    if (!addNote.isPending) addNote.mutate(body);
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
            ref={composerRef}
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
              disabled={addNote.isPending}
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
              <li key={n.id} className="py-3">
                {editingId === n.id ? (
                  <div>
                    <textarea
                      rows={2}
                      maxLength={2000}
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      className="input"
                      autoFocus
                    />
                    <div className="mt-2 flex justify-end gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded-lg px-3 py-1.5 font-medium text-gray-600 hover:text-gray-800"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={!editDraft.trim() || editNote.isPending}
                        onClick={() => editNote.mutate({ noteId: n.id, body: editDraft.trim() })}
                        className="rounded-lg bg-primary-700 px-3 py-1.5 font-medium text-white hover:bg-primary-800 disabled:opacity-50"
                      >
                        {editNote.isPending ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : (
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
                    {canManage(n) &&
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
                        <span className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(n.id);
                              setEditDraft(n.body);
                              setConfirmingId(null);
                            }}
                            aria-label={`Edit note from ${formatNoteTimestamp(n.createdAt)}`}
                            title="Edit note (previous text is kept in the audit trail)"
                            className="rounded p-1 text-gray-400 transition hover:text-primary-700"
                          >
                            <PencilSquareIcon className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmingId(n.id)}
                            aria-label={`Delete note from ${formatNoteTimestamp(n.createdAt)}`}
                            title="Delete note (recorded in the audit trail)"
                            className="rounded p-1 text-gray-400 transition hover:text-red-600"
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </span>
                      ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
