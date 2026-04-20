import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import { notify } from '../../utils/notify';

interface PracticePayer {
  id: string;
  practiceId: string;
  payerId: string;
  groupNpi: string | null;
  /** Masked ciphertext preview: "****1234" — never plaintext. */
  groupTaxId: string | null;
  groupContractNumber: string | null;
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  primaryContactPhone: string | null;
  coiOnFileUrl: string | null;
  w9OnFileUrl: string | null;
  effectiveDate: string | null;
  notes: string | null;
  payer: { id: string; name: string; payerType: string };
}

interface EditState {
  groupNpi: string;
  groupTaxId: string;
  groupContractNumber: string;
  primaryContactName: string;
  primaryContactEmail: string;
  primaryContactPhone: string;
  effectiveDate: string;
  notes: string;
}

function toEditState(row: PracticePayer): EditState {
  return {
    groupNpi: row.groupNpi ?? '',
    groupTaxId: '',
    groupContractNumber: row.groupContractNumber ?? '',
    primaryContactName: row.primaryContactName ?? '',
    primaryContactEmail: row.primaryContactEmail ?? '',
    primaryContactPhone: row.primaryContactPhone ?? '',
    effectiveDate: row.effectiveDate ? row.effectiveDate.slice(0, 10) : '',
    notes: row.notes ?? '',
  };
}

export default function PracticePayersTab({ practiceId }: { practiceId: string }) {
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['practice-payers', practiceId],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: PracticePayer[] }>(
        '/practice-payers'
      );
      return (res.data.data ?? []).filter((r) => r.practiceId === practiceId);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<EditState> }) => {
      const nn = (v: string | undefined) => (v && v.trim() !== '' ? v : null);
      return api.patch(`/practice-payers/${id}`, {
        groupNpi: nn(patch.groupNpi),
        // Only send groupTaxId if user typed something new (empty means unchanged)
        ...(patch.groupTaxId !== undefined && patch.groupTaxId !== ''
          ? { groupTaxId: patch.groupTaxId }
          : {}),
        groupContractNumber: nn(patch.groupContractNumber),
        primaryContactName: nn(patch.primaryContactName),
        primaryContactEmail: nn(patch.primaryContactEmail),
        primaryContactPhone: nn(patch.primaryContactPhone),
        effectiveDate: nn(patch.effectiveDate),
        notes: nn(patch.notes),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['practice-payers', practiceId] });
      notify.success('Payer settings saved');
      setOpenId(null);
      setEdit(null);
    },
    onError: (err: any) => {
      notify.error('Save failed', {
        description: err?.response?.data?.error?.message ?? 'Unknown error',
      });
    },
  });

  if (isLoading) {
    return <div className="py-8 text-center text-gray-500">Loading payer settings…</div>;
  }
  if (error) {
    return (
      <div className="py-4 px-3 rounded bg-red-50 text-red-800">
        Failed to load practice payers.
      </div>
    );
  }

  const rows = data ?? [];

  if (rows.length === 0) {
    return (
      <div className="py-8 text-center text-gray-500">
        <p>No target payers selected yet.</p>
        <p className="text-sm mt-1">
          Add target payers on the Settings tab to configure per-payer info.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        Per-payer info the practice provides to each payer (group NPI, tax ID, W-9, COI).
        These values flow into every enrollment filed with that payer, so you only enter them once.
      </p>

      {rows.map((row) => {
        const isOpen = openId === row.id;
        return (
          <div key={row.id} className="border border-gray-200 rounded-xl bg-white overflow-hidden">
            <button
              type="button"
              onClick={() => {
                if (isOpen) {
                  setOpenId(null);
                  setEdit(null);
                } else {
                  setOpenId(row.id);
                  setEdit(toEditState(row));
                }
              }}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 text-left"
            >
              <div>
                <div className="font-medium text-gray-900">{row.payer.name}</div>
                <div className="text-xs text-gray-500">{row.payer.payerType}</div>
              </div>
              <div className="flex items-center gap-4 text-xs text-gray-500">
                {row.groupNpi && <span>NPI: {row.groupNpi}</span>}
                {row.groupTaxId && <span>Tax ID: {row.groupTaxId}</span>}
                {row.w9OnFileUrl && <span className="text-green-700">W-9 on file</span>}
                {row.coiOnFileUrl && <span className="text-green-700">COI on file</span>}
                <span className="text-primary-600">{isOpen ? 'Close' : 'Edit'}</span>
              </div>
            </button>

            {isOpen && edit && (
              <div className="px-4 py-4 border-t border-gray-100 bg-gray-50/50 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Field label="Group NPI">
                    <input
                      className="input"
                      value={edit.groupNpi}
                      onChange={(e) => setEdit({ ...edit, groupNpi: e.target.value })}
                    />
                  </Field>
                  <Field
                    label={`Group Tax ID ${row.groupTaxId ? `(current: ${row.groupTaxId})` : ''}`}
                  >
                    <input
                      className="input"
                      type="password"
                      placeholder={row.groupTaxId ? 'Leave blank to keep' : ''}
                      value={edit.groupTaxId}
                      onChange={(e) => setEdit({ ...edit, groupTaxId: e.target.value })}
                    />
                  </Field>
                  <Field label="Contract Number">
                    <input
                      className="input"
                      value={edit.groupContractNumber}
                      onChange={(e) => setEdit({ ...edit, groupContractNumber: e.target.value })}
                    />
                  </Field>
                  <Field label="Effective Date">
                    <input
                      className="input"
                      type="date"
                      value={edit.effectiveDate}
                      onChange={(e) => setEdit({ ...edit, effectiveDate: e.target.value })}
                    />
                  </Field>
                  <Field label="Primary Contact Name">
                    <input
                      className="input"
                      value={edit.primaryContactName}
                      onChange={(e) => setEdit({ ...edit, primaryContactName: e.target.value })}
                    />
                  </Field>
                  <Field label="Primary Contact Email">
                    <input
                      className="input"
                      type="email"
                      value={edit.primaryContactEmail}
                      onChange={(e) => setEdit({ ...edit, primaryContactEmail: e.target.value })}
                    />
                  </Field>
                  <Field label="Primary Contact Phone">
                    <input
                      className="input"
                      value={edit.primaryContactPhone}
                      onChange={(e) => setEdit({ ...edit, primaryContactPhone: e.target.value })}
                    />
                  </Field>
                </div>
                <Field label="Notes">
                  <textarea
                    className="input min-h-[60px]"
                    value={edit.notes}
                    onChange={(e) => setEdit({ ...edit, notes: e.target.value })}
                  />
                </Field>

                <div className="text-xs text-gray-500">
                  W-9 and COI uploads will live on the Documents tab in a later update.
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setOpenId(null);
                      setEdit(null);
                    }}
                    className="px-3 py-1.5 rounded text-sm text-gray-700 hover:bg-gray-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={updateMutation.isPending}
                    onClick={() => updateMutation.mutate({ id: row.id, patch: edit })}
                    className="px-3 py-1.5 rounded text-sm text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50"
                  >
                    {updateMutation.isPending ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="block text-gray-700 mb-1">{label}</span>
      {children}
    </label>
  );
}
