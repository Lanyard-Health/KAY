import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CloudArrowUpIcon, DocumentIcon, ArrowDownTrayIcon, EyeIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline';
import { format } from 'date-fns';
import { api } from '../../services/api';
import toast from 'react-hot-toast';
import DocumentUploadModal from '../../components/DocumentUploadModal';

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
  const queryClient = useQueryClient();
  const [selectedProvider, setSelectedProvider] = useState<string>('');
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [viewingOcr, setViewingOcr] = useState<any>(null);
  const [previewDoc, setPreviewDoc] = useState<{ doc: any; url: string } | null>(null);
  const [editingDoc, setEditingDoc] = useState<any>(null);
  const [editForm, setEditForm] = useState({ documentType: '', description: '', expirationDate: '' });

  const { data: providers, error: providersError } = useQuery({
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
    try {
      const response = await api.get(`/documents/${doc.id}/download-url`);
      const { downloadUrl } = response.data.data;
      setPreviewDoc({ doc, url: downloadUrl });
    } catch (error) {
      toast.error('Failed to load document preview');
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
      toast.success('Document updated');
      setEditingDoc(null);
    },
    onError: () => {
      toast.error('Failed to update document');
    },
  });

  const handleDelete = (doc: any) => {
    if (window.confirm(`Are you sure you want to delete "${doc.originalFileName}"?`)) {
      deleteMutation.mutate(doc.id);
    }
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
    <div>
      <div className="sm:flex sm:items-center sm:justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Documents</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage provider documents, licenses, and certificates
          </p>
        </div>
      </div>

      {/* Provider Filter */}
      <div className="card card-body mb-6">
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
            <button className="btn-primary" onClick={() => setIsUploadModalOpen(true)}>
              <CloudArrowUpIcon className="-ml-1 mr-2 h-5 w-5" />
              Upload Document
            </button>
          )}
        </div>
      </div>

      {/* Error States */}
      {providersError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 mb-6">
          <p className="font-medium">Failed to load providers</p>
          <p className="text-sm mt-1">Please check your connection and try again.</p>
        </div>
      )}

      {/* Documents Grid */}
      {!selectedProvider ? (
        <div className="text-center py-12">
          <DocumentIcon className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">No provider selected</h3>
          <p className="mt-1 text-sm text-gray-500">Select a provider to view their documents</p>
        </div>
      ) : documentsError ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          <p className="font-medium">Failed to load documents</p>
          <p className="text-sm mt-1">Please check your connection and try again.</p>
        </div>
      ) : isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-2 border-gray-200 border-t-primary-600"></div>
        </div>
      ) : documents?.length === 0 ? (
        <div className="text-center py-12">
          <DocumentIcon className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">No documents</h3>
          <p className="mt-1 text-sm text-gray-500 mb-4">
            Upload documents for this provider
          </p>
          <button className="btn-primary" onClick={() => setIsUploadModalOpen(true)}>
            <CloudArrowUpIcon className="-ml-1 mr-2 h-5 w-5" />
            Upload First Document
          </button>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Document
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Uploaded
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Expiration
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {documents?.map((doc: any) => (
                <tr key={doc.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <DocumentIcon className="h-8 w-8 text-gray-400" />
                      <div className="ml-3">
                        <p className="text-sm font-medium text-gray-900">{doc.originalFileName}</p>
                        <p className="text-sm text-gray-500">
                          {(doc.fileSize / 1024).toFixed(1)} KB
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {getDocumentTypeLabel(doc.documentType)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {format(new Date(doc.createdAt), 'MMM d, yyyy')}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {doc.expirationDate
                      ? format(new Date(doc.expirationDate), 'MMM d, yyyy')
                      : '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
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
                </tr>
              ))}
            </tbody>
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

      {/* OCR Results Modal */}
      {viewingOcr && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
            <div
              className="fixed inset-0 transition-opacity bg-gray-900/40 backdrop-blur-sm"
              onClick={() => setViewingOcr(null)}
            />
            <div className="relative z-10 inline-block w-full max-w-2xl p-6 my-8 text-left align-middle bg-white rounded-2xl shadow-xl">
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                OCR Results - {viewingOcr.document.originalFileName}
              </h3>
              <div className="max-h-96 overflow-y-auto">
                {viewingOcr.ocrData?.ocrData ? (
                  <div className="space-y-3">
                    {Object.entries(viewingOcr.ocrData.ocrData).map(([key, value]: [string, any]) => (
                      <div key={key} className="border-b pb-2">
                        <p className="text-sm font-medium text-gray-700">{key}</p>
                        <p className="text-sm text-gray-900">{value.value}</p>
                        <p className="text-xs text-gray-500">
                          Confidence: {Math.round(value.confidence * 100)}%
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500">No OCR data available</p>
                )}
              </div>
              <div className="mt-6 flex justify-end">
                <button
                  onClick={() => setViewingOcr(null)}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
                    className="px-3 py-1.5 text-sm bg-primary-600 text-white rounded-md hover:bg-primary-700 inline-flex items-center"
                  >
                    <ArrowDownTrayIcon className="h-4 w-4 mr-1" />
                    Download
                  </button>
                  <button
                    onClick={() => setPreviewDoc(null)}
                    className="px-3 py-1.5 text-sm bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
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
                        className="mt-4 px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
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
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
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
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
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
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  onClick={() => setEditingDoc(null)}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={updateMutation.isPending}
                  className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
                >
                  {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
