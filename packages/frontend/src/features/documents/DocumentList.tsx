import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Tab } from '@headlessui/react';
import clsx from 'clsx';
import PageTransition from '../../components/ui/PageTransition';
import { CloudArrowUpIcon, DocumentIcon, ArrowDownTrayIcon, EyeIcon, PencilIcon, TrashIcon, DocumentMagnifyingGlassIcon, UserCircleIcon, BuildingOffice2Icon } from '@heroicons/react/24/outline';
import { format } from 'date-fns';
import { api } from '../../services/api';
import toast from 'react-hot-toast';
import DocumentUploadModal from '../../components/DocumentUploadModal';
import { AnimatedList, AnimatedListItem } from '../../components/ui/AnimatedList';
import ConfirmDialog from '../../components/ConfirmDialog';
import EmptyState from '../../components/ui/EmptyState';
import ErrorState from '../../components/ui/ErrorState';
import StatusBadge from '../../components/ui/StatusBadge';
import OcrReviewModal from './OcrReviewModal';
import { useAuthStore } from '../../stores/auth.store';
import PracticeDocumentsTab from './PracticeDocumentsTab';

// Tabs at the top of the /documents page. Practice Documents is hidden for the
// 'provider' role (Phase 4 — practice-level docs are staff-managed only).
const ALL_TABS = [
  { key: 'provider', label: 'Provider Documents', icon: UserCircleIcon, restrictedTo: null },
  { key: 'practice', label: 'Practice Documents', icon: BuildingOffice2Icon, restrictedTo: ['admin', 'credentialing_staff', 'practice_admin'] },
] as const;

const DOCUMENT_TYPES = [
  { value: 'license', label: 'License' },
  { value: 'board_certification', label: 'Board Certification' },
  { value: 'malpractice_certificate', label: 'Malpractice Insurance Certificate' },
  { value: 'diploma', label: 'Diploma' },
  { value: 'transcript', label: 'Transcript' },
  { value: 'cv_resume', label: 'CV / Resume' },
  { value: 'photo', label: 'Professional Photo' },
  { value: 'government_id', label: 'Government ID' },
  { value: 'dea_certificate', label: 'DEA Certificate' },
  { value: 'cds_certificate', label: 'Controlled Substance Certificate' },
  { value: 'cme_certificate', label: 'CME Certificate' },
  { value: 'hospital_letter', label: 'Hospital Privileges Letter' },
  { value: 'reference_letter', label: 'Reference Letter' },
  { value: 'w9', label: 'W-9 Form' },
  { value: 'coi', label: 'Certificate of Insurance (COI)' },
  { value: 'cp575', label: 'CP575 / IRS Letter' },
  { value: 'other', label: 'Other' },
];

export default function DocumentList() {
  const user = useAuthStore((s) => s.user);
  const role = user?.role;
  const visibleTabs = ALL_TABS.filter(
    (tab) => !tab.restrictedTo || (role && (tab.restrictedTo as readonly string[]).includes(role))
  );

  const queryClient = useQueryClient();
  const [selectedProvider, setSelectedProvider] = useState<string>('');
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [reviewingDoc, setReviewingDoc] = useState<any>(null);
  const [ocrFilter, setOcrFilter] = useState<string>('');
  const [previewDoc, setPreviewDoc] = useState<{ doc: any; url: string } | null>(null);
  const [editingDoc, setEditingDoc] = useState<any>(null);
  const [editForm, setEditForm] = useState({ documentType: '', description: '', expirationDate: '' });
  const [confirmDelete, setConfirmDelete] = useState<{ isOpen: boolean; doc: any }>({ isOpen: false, doc: null });

  const { data: providers, error: providersError, refetch: refetchProviders } = useQuery({
    queryKey: ['providers', 'list'],
    queryFn: async () => {
      const response = await api.get('/providers?pageSize=100');
      return response.data.data.items || response.data.data.data || [];
    },
  });

  const { data: documents, isLoading, error: documentsError, refetch } = useQuery({
    queryKey: ['documents', selectedProvider],
    queryFn: async () => {
      if (!selectedProvider) return [];
      const response = await api.get(`/documents/provider/${selectedProvider}`);
      return response.data.data;
    },
    enabled: !!selectedProvider,
  });

  const selectedProviderData = providers?.find((p: any) => p.id === selectedProvider);

  const getDocumentTypeLabel = (type: string) => {
    return DOCUMENT_TYPES.find((t) => t.value === type)?.label || type;
  };

  const getOcrStatusBadge = (ocrStatus: string | null) => {
    switch (ocrStatus) {
      case 'needs_review': return { variant: 'warning' as const, label: 'Needs Review' };
      case 'completed': return { variant: 'success' as const, label: 'Completed' };
      case 'processing': return { variant: 'info' as const, label: 'Processing' };
      case 'failed': return { variant: 'danger' as const, label: 'Failed' };
      default: return null;
    }
  };

  const filteredDocuments = useMemo(() => {
    if (!documents) return [];
    if (!ocrFilter) return documents;
    return documents.filter((doc: any) => (doc.ocrStatus || '') === ocrFilter);
  }, [documents, ocrFilter]);

  const handleDownload = async (documentId: string, fileName: string) => {
    try {
      const response = await api.get(`/documents/${documentId}/download-url`);
      const { downloadUrl } = response.data.data;

      // Open in new tab or trigger download
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = fileName;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      toast.error('Failed to download document');
    }
  };

  const handlePreview = async (doc: any) => {
    // Open the doc in a NEW TAB, not an in-app iframe: the site's CSP
    // (default-src 'self', no frame-src for storage) blocks embedding the
    // cross-origin Cloudflare file, which is why the in-pane preview showed
    // "This content is blocked". A top-level tab isn't subject to frame-src and
    // renders the PDF/image natively (the view-url uses Content-Disposition:
    // inline). Open the tab synchronously in the click gesture so it isn't
    // popup-blocked, then point it at the signed URL once we have it.
    const tab = window.open('', '_blank');
    try {
      const response = await api.get(`/documents/${doc.id}/view-url`);
      const { viewUrl } = response.data.data;
      if (tab) tab.location.href = viewUrl;
      else window.location.assign(viewUrl); // popup blocked → use current tab
    } catch (error) {
      tab?.close();
      toast.error('Failed to open document');
    }
  };

  const isImageType = (mimeType: string) => {
    return mimeType.startsWith('image/');
  };

  const isPdfType = (mimeType: string) => {
    return mimeType === 'application/pdf';
  };

  const deleteMutation = useMutation({
    mutationFn: async (documentId: string) => {
      await api.delete(`/documents/${documentId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents', selectedProvider] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-full'] });
      toast.success('Document deleted');
    },
    onError: () => {
      toast.error('Failed to delete document');
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ documentId, data }: { documentId: string; data: any }) => {
      await api.put(`/documents/${documentId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents', selectedProvider] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-full'] });
      toast.success('Document updated');
      setEditingDoc(null);
    },
    onError: () => {
      toast.error('Failed to update document');
    },
  });

  const handleDelete = (doc: any) => {
    setConfirmDelete({ isOpen: true, doc });
  };

  const handleEdit = (doc: any) => {
    setEditingDoc(doc);
    setEditForm({
      documentType: doc.documentType,
      description: doc.description || '',
      expirationDate: doc.expirationDate ? doc.expirationDate.split('T')[0] : '',
    });
  };

  const handleSaveEdit = () => {
    if (!editingDoc) return;
    updateMutation.mutate({
      documentId: editingDoc.id,
      data: {
        documentType: editForm.documentType,
        description: editForm.description || null,
        expirationDate: editForm.expirationDate || null,
      },
    });
  };

  return (
    <PageTransition>
    <div>
      <div className="sm:flex sm:items-center sm:justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Documents</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage provider and practice-level documents
          </p>
        </div>
      </div>

      <Tab.Group>
        <Tab.List className="flex space-x-1 border-b border-gray-200 mb-6">
          {visibleTabs.map((tab) => (
            <Tab
              key={tab.key}
              className={({ selected }) =>
                clsx(
                  'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors outline-none',
                  selected
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                )
              }
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </Tab>
          ))}
        </Tab.List>

        <Tab.Panels>
          {visibleTabs.map((tab) => (
            <Tab.Panel key={tab.key}>
              {tab.key === 'provider' && <ProviderDocumentsPanel />}
              {tab.key === 'practice' && <PracticeDocumentsTab />}
            </Tab.Panel>
          ))}
        </Tab.Panels>
      </Tab.Group>

      {/* Confirm + edit + preview modals shared with the Provider Documents panel. */}
    </div>
    </PageTransition>
  );

  // Inline-defined Provider Documents panel — wraps the existing /documents page
  // content unchanged. Nothing about provider behavior is modified for Phase 4.
  function ProviderDocumentsPanel() {
    return (
      <div>

      {/* Provider Filter */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-4 mb-6">
        <div className="flex gap-4 items-end">
          <div className="flex-1">
            <label className="label">Select Provider</label>
            <select
              className="input"
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value)}
            >
              <option value="">Choose a provider...</option>
              {providers?.map((provider: any) => (
                <option key={provider.id} value={provider.id}>
                  {provider.firstName} {provider.lastName} - {provider.npi}
                </option>
              ))}
            </select>
          </div>
          {selectedProvider && (
            <div className="flex-shrink-0">
              <label className="label">OCR Status</label>
              <select
                className="input"
                value={ocrFilter}
                onChange={(e) => setOcrFilter(e.target.value)}
              >
                <option value="">All</option>
                <option value="needs_review">Needs Review</option>
                <option value="completed">Completed</option>
                <option value="processing">Processing</option>
                <option value="failed">Failed</option>
              </select>
            </div>
          )}
          {selectedProvider && (
            <button className="btn-primary self-end" onClick={() => setIsUploadModalOpen(true)}>
              <CloudArrowUpIcon className="-ml-1 mr-2 h-5 w-5" />
              Upload Document
            </button>
          )}
        </div>
      </div>

      {/* Error States */}
      {providersError && (
        <div className="mb-6">
          <ErrorState
            title="Couldn't load providers"
            message="Check your connection and try again."
            onRetry={() => refetchProviders()}
          />
        </div>
      )}

      {/* Documents Grid */}
      {!selectedProvider ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 py-12">
          <EmptyState
            illustration="folder"
            title="No provider selected"
            description="Select a provider to view their documents."
          />
        </div>
      ) : documentsError ? (
        <ErrorState
          title="Couldn't load documents"
          message="Check your connection and try again."
          onRetry={() => refetch()}
        />
      ) : isLoading ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 overflow-hidden animate-pulse">
          <div className="bg-gray-50 px-6 py-3 flex gap-8">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-3 w-20 bg-gray-200 rounded" />
            ))}
          </div>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="px-6 py-4 flex gap-8 border-t border-gray-100">
              <div className="h-4 w-40 bg-gray-200 rounded" />
              <div className="h-4 w-24 bg-gray-200 rounded" />
              <div className="h-4 w-20 bg-gray-200 rounded" />
              <div className="h-4 w-16 bg-gray-200 rounded" />
              <div className="h-4 w-24 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
      ) : filteredDocuments.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 py-12">
          <EmptyState
            illustration="folder"
            title="No documents"
            description="Upload documents for this provider."
            action={{ label: 'Upload First Document', onClick: () => setIsUploadModalOpen(true) }}
          />
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50/80">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Document
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Uploaded
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Expiration
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  OCR Status
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <AnimatedList as="tbody" className="bg-white divide-y divide-gray-200">
              {filteredDocuments.map((doc: any, index: number) => {
                const ocrBadge = getOcrStatusBadge(doc.ocrStatus);
                return (
                <AnimatedListItem itemKey={doc.id} index={index} as="tr" className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {getDocumentTypeLabel(doc.documentType)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <DocumentIcon className="h-8 w-8 text-gray-400" />
                      <div className="ml-3">
                        <p className="text-sm text-gray-700">{doc.originalFileName}</p>
                        <p className="text-sm text-gray-500">
                          {(doc.fileSize / 1024).toFixed(1)} KB
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {format(new Date(doc.createdAt), 'MMM d, yyyy')}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {doc.expirationDate
                      ? format(new Date(doc.expirationDate), 'MMM d, yyyy')
                      : '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    {ocrBadge ? (
                      doc.ocrStatus === 'needs_review' ? (
                        <button onClick={() => setReviewingDoc(doc)} className="cursor-pointer">
                          <StatusBadge label={ocrBadge.label} variant={ocrBadge.variant} dot />
                        </button>
                      ) : (
                        <StatusBadge label={ocrBadge.label} variant={ocrBadge.variant} dot />
                      )
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    {(doc.ocrStatus === 'needs_review' || doc.ocrStatus === 'completed') && (
                      <button
                        onClick={() => setReviewingDoc(doc)}
                        className="text-primary-600 hover:text-primary-900 mr-2 inline-flex items-center"
                        title="Review OCR"
                      >
                        <DocumentMagnifyingGlassIcon className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      onClick={() => handlePreview(doc)}
                      className="text-primary-600 hover:text-primary-900 mr-2 inline-flex items-center"
                      title="View"
                    >
                      <EyeIcon className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDownload(doc.id, doc.originalFileName)}
                      className="text-primary-600 hover:text-primary-900 mr-2 inline-flex items-center"
                      title="Download"
                    >
                      <ArrowDownTrayIcon className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleEdit(doc)}
                      className="text-primary-600 hover:text-primary-900 mr-2 inline-flex items-center"
                      title="Edit"
                    >
                      <PencilIcon className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(doc)}
                      className="text-red-600 hover:text-red-900 inline-flex items-center"
                      title="Delete"
                      disabled={deleteMutation.isPending}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </td>
                </AnimatedListItem>
                );
              })}
            </AnimatedList>
          </table>
        </div>
      )}

      {/* Upload Modal */}
      <DocumentUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        providerId={selectedProvider}
        providerName={
          selectedProviderData
            ? `${selectedProviderData.firstName} ${selectedProviderData.lastName}`
            : undefined
        }
        onUploadComplete={() => refetch()}
      />

      {/* OCR Review Modal */}
      <OcrReviewModal
        isOpen={!!reviewingDoc}
        onClose={() => setReviewingDoc(null)}
        documentId={reviewingDoc?.id ?? null}
        onApproved={() => { setReviewingDoc(null); refetch(); }}
      />

      {/* Document Preview Modal */}
      {previewDoc && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          <div className="flex items-center justify-center min-h-screen">
            <div
              className="fixed inset-0 transition-opacity bg-gray-900/40 backdrop-blur-sm"
              onClick={() => setPreviewDoc(null)}
            />
            <div className="relative z-10 w-full max-w-5xl h-[90vh] mx-4 flex flex-col bg-white rounded-2xl shadow-xl overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
                <div>
                  <h3 className="text-lg font-medium text-gray-900">
                    {previewDoc.doc.originalFileName}
                  </h3>
                  <p className="text-sm text-gray-500">
                    {getDocumentTypeLabel(previewDoc.doc.documentType)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleDownload(previewDoc.doc.id, previewDoc.doc.originalFileName)}
                    className="px-3 py-1.5 text-sm bg-primary-600 text-white rounded-xl hover:bg-primary-700 inline-flex items-center"
                  >
                    <ArrowDownTrayIcon className="h-4 w-4 mr-1" />
                    Download
                  </button>
                  <button
                    onClick={() => setPreviewDoc(null)}
                    className="px-3 py-1.5 text-sm bg-gray-200 text-gray-700 rounded-xl hover:bg-gray-300"
                  >
                    Close
                  </button>
                </div>
              </div>
              {/* Content */}
              <div className="flex-1 overflow-auto bg-gray-100 p-4">
                {isPdfType(previewDoc.doc.mimeType) ? (
                  <iframe
                    src={previewDoc.url}
                    className="w-full h-full min-h-[70vh] bg-white rounded shadow"
                    title={previewDoc.doc.originalFileName}
                  />
                ) : isImageType(previewDoc.doc.mimeType) ? (
                  <div className="flex items-center justify-center h-full">
                    <img
                      src={previewDoc.url}
                      alt={previewDoc.doc.originalFileName}
                      className="max-w-full max-h-full object-contain rounded shadow"
                    />
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                      <DocumentIcon className="mx-auto h-16 w-16 text-gray-400" />
                      <p className="mt-2 text-gray-500">
                        Preview not available for this file type
                      </p>
                      <button
                        onClick={() => handleDownload(previewDoc.doc.id, previewDoc.doc.originalFileName)}
                        className="mt-4 px-4 py-2 bg-primary-600 text-white rounded-xl hover:bg-primary-700"
                      >
                        Download to View
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Document Modal */}
      {editingDoc && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
            <div
              className="fixed inset-0 transition-opacity bg-gray-900/40 backdrop-blur-sm"
              onClick={() => setEditingDoc(null)}
            />
            <div className="relative z-10 inline-block w-full max-w-md p-6 my-8 text-left align-middle bg-white rounded-2xl shadow-xl">
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                Edit Document
              </h3>
              <p className="text-sm text-gray-500 mb-4">{editingDoc.originalFileName}</p>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Document Type
                  </label>
                  <select
                    value={editForm.documentType}
                    onChange={(e) => setEditForm({ ...editForm, documentType: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  >
                    {DOCUMENT_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description
                  </label>
                  <input
                    type="text"
                    value={editForm.description}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    placeholder="Optional description"
                    className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Expiration Date
                  </label>
                  <input
                    type="date"
                    value={editForm.expirationDate}
                    onChange={(e) => setEditForm({ ...editForm, expirationDate: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  />
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  onClick={() => setEditingDoc(null)}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={updateMutation.isPending}
                  className="px-4 py-2 bg-primary-600 text-white rounded-xl hover:bg-primary-700 disabled:opacity-50"
                >
                  {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Delete Dialog */}
      <ConfirmDialog
        isOpen={confirmDelete.isOpen}
        onClose={() => setConfirmDelete({ isOpen: false, doc: null })}
        onConfirm={() => {
          if (confirmDelete.doc) deleteMutation.mutate(confirmDelete.doc.id);
          setConfirmDelete({ isOpen: false, doc: null });
        }}
        title="Delete Document"
        message={`Are you sure you want to delete "${confirmDelete.doc?.originalFileName}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
      />
      </div>
    );
  }
}
