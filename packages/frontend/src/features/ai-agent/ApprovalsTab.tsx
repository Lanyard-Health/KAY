import { useState, Fragment } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import {
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { clsx } from 'clsx';
import {
  useApprovals,
  useApprovalDetail,
  useDecideApproval,
  useBulkDecideApprovals,
} from '../../hooks/useApprovals';
import type { Approval } from '../../hooks/useApprovals';

// ===========================
// Helpers
// ===========================

const STATUS_FILTERS = ['all', 'pending', 'approved', 'denied'] as const;

function statusBadge(status: Approval['status']) {
  switch (status) {
    case 'pending':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">
          <ClockIcon className="h-3 w-3" />
          Pending
        </span>
      );
    case 'approved':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
          <CheckCircleIcon className="h-3 w-3" />
          Approved
        </span>
      );
    case 'denied':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
          <XCircleIcon className="h-3 w-3" />
          Denied
        </span>
      );
  }
}

function formatCountdown(expiresAt: string): { text: string; isUrgent: boolean } {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return { text: 'Expired', isUrgent: true };

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours < 1) return { text: `${minutes}m remaining`, isUrgent: true };
  if (hours < 4) return { text: `${hours}h ${minutes}m remaining`, isUrgent: true };
  if (hours < 24) return { text: `${hours}h remaining`, isUrgent: false };

  const days = Math.floor(hours / 24);
  return { text: `${days}d remaining`, isUrgent: false };
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ===========================
// Main Component
// ===========================

export default function ApprovalsTab() {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState('');

  const { data: approvalsResp, isLoading } = useApprovals(
    statusFilter === 'all' ? undefined : statusFilter,
  );
  const { data: detailResp } = useApprovalDetail(selectedId);
  const decideApproval = useDecideApproval();
  const bulkDecide = useBulkDecideApprovals();

  const approvals: Approval[] = approvalsResp ?? [];
  const pendingSelected = approvals.filter(
    (a) => selectedIds.has(a.id) && a.status === 'pending',
  );
  const detail: Approval | null | undefined = detailResp;

  const handleDecision = (decision: 'approved' | 'denied') => {
    if (!selectedId) return;
    decideApproval.mutate(
      { id: selectedId, decision, notes: notes || undefined },
      {
        onSuccess: () => {
          setSelectedId(null);
          setNotes('');
        },
      },
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === approvals.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(approvals.map((a) => a.id)));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* Status Filter Pills */}
      <div className="flex gap-2">
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter}
            onClick={() => setStatusFilter(filter)}
            className={clsx(
              'rounded-full px-3 py-1 text-sm font-medium capitalize transition-colors',
              statusFilter === filter
                ? 'bg-primary-100 text-primary-700'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
            )}
          >
            {filter}
          </button>
        ))}
      </div>

      {/* Bulk Action Toolbar */}
      {pendingSelected.length > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-primary-200 bg-primary-50 px-4 py-2">
          <span className="text-sm font-medium text-primary-700">
            {pendingSelected.length} pending selected
          </span>
          <div className="flex gap-2 ml-auto">
            <button
              onClick={() => {
                bulkDecide.mutate(
                  { ids: pendingSelected.map((a) => a.id), decision: 'approved' },
                  { onSuccess: () => setSelectedIds(new Set()) },
                );
              }}
              disabled={bulkDecide.isPending}
              className="inline-flex items-center gap-1 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              <CheckCircleIcon className="h-4 w-4" />
              Approve All
            </button>
            <button
              onClick={() => {
                bulkDecide.mutate(
                  { ids: pendingSelected.map((a) => a.id), decision: 'denied' },
                  { onSuccess: () => setSelectedIds(new Set()) },
                );
              }}
              disabled={bulkDecide.isPending}
              className="inline-flex items-center gap-1 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              <XCircleIcon className="h-4 w-4" />
              Deny All
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
        </div>
      ) : approvals.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white px-6 py-12 text-center text-gray-400">
          No approvals found.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={selectedIds.size === approvals.length && approvals.length > 0}
                    onChange={toggleSelectAll}
                    className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Type
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Provider / Payer
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Requested
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Expires
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {approvals.map((approval) => {
                const expiry =
                  approval.status === 'pending'
                    ? formatCountdown(approval.expiresAt)
                    : null;

                return (
                  <tr
                    key={approval.id}
                    onClick={() => setSelectedId(approval.id)}
                    className="cursor-pointer hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(approval.id)}
                        onChange={() => toggleSelect(approval.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 capitalize">
                      {approval.type.replace(/_/g, ' ')}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {approval.workflow.provider
                        ? `${approval.workflow.provider.firstName} ${approval.workflow.provider.lastName}`
                        : ''}
                      {approval.workflow.provider && approval.workflow.payer ? ' / ' : ''}
                      {approval.workflow.payer?.name ?? ''}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {formatDate(approval.requestedAt)}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {approval.status === 'pending' && expiry ? (
                        <span className={clsx(expiry.isUrgent && 'text-red-600 font-medium')}>
                          {expiry.text}
                        </span>
                      ) : (
                        <span className="text-gray-500">{formatDate(approval.expiresAt)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">{statusBadge(approval.status)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail Slide-Out Panel */}
      <Transition show={!!selectedId} as={Fragment}>
        <Dialog onClose={() => setSelectedId(null)} className="relative z-50">
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/30" />
          </Transition.Child>

          <div className="fixed inset-0 overflow-hidden">
            <div className="absolute inset-0 overflow-hidden">
              <div className="pointer-events-none fixed inset-y-0 right-0 flex max-w-full pl-10">
                <Transition.Child
                  as={Fragment}
                  enter="transform transition ease-in-out duration-300"
                  enterFrom="translate-x-full"
                  enterTo="translate-x-0"
                  leave="transform transition ease-in-out duration-300"
                  leaveFrom="translate-x-0"
                  leaveTo="translate-x-full"
                >
                  <Dialog.Panel className="pointer-events-auto w-screen max-w-md">
                    <div className="flex h-full flex-col bg-white shadow-xl">
                      {/* Header */}
                      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
                        <Dialog.Title className="text-lg font-semibold text-gray-900">
                          Approval Detail
                        </Dialog.Title>
                        <button
                          onClick={() => setSelectedId(null)}
                          className="rounded-md text-gray-400 hover:text-gray-500"
                        >
                          <XMarkIcon className="h-5 w-5" />
                        </button>
                      </div>

                      {/* Content */}
                      {detail ? (
                        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                          <div>
                            <span className="text-xs font-medium uppercase text-gray-400">Type</span>
                            <p className="text-sm text-gray-900 capitalize">
                              {detail.type.replace(/_/g, ' ')}
                            </p>
                          </div>

                          <div>
                            <span className="text-xs font-medium uppercase text-gray-400">Status</span>
                            <div className="mt-1">{statusBadge(detail.status)}</div>
                          </div>

                          {detail.workflow.provider && (
                            <div>
                              <span className="text-xs font-medium uppercase text-gray-400">
                                Provider
                              </span>
                              <p className="text-sm text-gray-900">
                                {detail.workflow.provider.firstName}{' '}
                                {detail.workflow.provider.lastName}
                              </p>
                              <p className="text-xs text-gray-500">
                                NPI: {detail.workflow.provider.npi}
                              </p>
                            </div>
                          )}

                          {detail.workflow.payer && (
                            <div>
                              <span className="text-xs font-medium uppercase text-gray-400">
                                Payer
                              </span>
                              <p className="text-sm text-gray-900">
                                {detail.workflow.payer.name}
                              </p>
                            </div>
                          )}

                          <div>
                            <span className="text-xs font-medium uppercase text-gray-400">
                              Requested
                            </span>
                            <p className="text-sm text-gray-900">
                              {formatDate(detail.requestedAt)}
                            </p>
                          </div>

                          <div>
                            <span className="text-xs font-medium uppercase text-gray-400">
                              Expires
                            </span>
                            {detail.status === 'pending' ? (
                              (() => {
                                const expiry = formatCountdown(detail.expiresAt);
                                return (
                                  <p
                                    className={clsx(
                                      'text-sm',
                                      expiry.isUrgent
                                        ? 'text-red-600 font-medium'
                                        : 'text-gray-900',
                                    )}
                                  >
                                    {expiry.text}
                                  </p>
                                );
                              })()
                            ) : (
                              <p className="text-sm text-gray-900">
                                {formatDate(detail.expiresAt)}
                              </p>
                            )}
                          </div>

                          {detail.context &&
                            Object.keys(detail.context).length > 0 && (
                              <div>
                                <span className="text-xs font-medium uppercase text-gray-400">
                                  Context
                                </span>
                                <pre className="mt-1 rounded bg-gray-50 p-2 text-xs text-gray-700 overflow-x-auto max-h-40">
                                  {JSON.stringify(detail.context, null, 2)}
                                </pre>
                              </div>
                            )}

                          {detail.decisionNotes && (
                            <div>
                              <span className="text-xs font-medium uppercase text-gray-400">
                                Decision Notes
                              </span>
                              <p className="text-sm text-gray-900">{detail.decisionNotes}</p>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-1 items-center justify-center">
                          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
                        </div>
                      )}

                      {/* Footer actions */}
                      {detail?.status === 'pending' && (
                        <div className="border-t border-gray-200 px-6 py-4 space-y-3">
                          <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Optional decision notes..."
                            rows={2}
                            maxLength={1000}
                            className="block w-full rounded-md border-gray-300 text-sm shadow-sm focus:border-primary-500 focus:ring-primary-500"
                          />
                          <div className="flex gap-3">
                            <button
                              onClick={() => handleDecision('approved')}
                              disabled={decideApproval.isPending}
                              className="flex-1 inline-flex items-center justify-center gap-2 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                            >
                              <CheckCircleIcon className="h-4 w-4" />
                              Approve
                            </button>
                            <button
                              onClick={() => handleDecision('denied')}
                              disabled={decideApproval.isPending}
                              className="flex-1 inline-flex items-center justify-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                            >
                              <XCircleIcon className="h-4 w-4" />
                              Deny
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </Dialog.Panel>
                </Transition.Child>
              </div>
            </div>
          </div>
        </Dialog>
      </Transition>
    </div>
  );
}
