import { useState, useRef } from 'react';
import { TrashIcon, ArrowUpTrayIcon, CloudArrowUpIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';
import { notify } from '../../utils/notify';
import { usePortalDocuments, useUploadDocument, useDeleteDocument } from './hooks/usePortalData';
import ConfirmDialog from '../../components/ConfirmDialog';
import EmptyState from '../../components/ui/EmptyState';

const DOCUMENT_TYPES = [
  { value: '', label: 'Select Document Type' },
  { value: 'w9', label: 'W-9' },
  { value: 'coi', label: 'Certificate of Insurance (COI)' },
  { value: 'cp575', label: 'CP575 / EIN Letter' },
  { value: 'malpractice_certificate', label: 'Malpractice Certificate' },
  { value: 'license', label: 'License' },
  { value: 'board_certification', label: 'Board Certification' },
  { value: 'diploma', label: 'Diploma' },
  { value: 'cv_resume', label: 'CV / Resume' },
  { value: 'government_id', label: 'Government ID' },
  { value: 'dea_certificate', label: 'DEA Certificate' },
  { value: 'other', label: 'Other' },
];

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
};

export default function PortalDocuments() {
  const { data, isLoading } = usePortalDocuments();
  const uploadMutation = useUploadDocument();
  const deleteMutation = useDeleteDocument();

  const [documentType, setDocumentType] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; id: string; name: string }>({ isOpen: false, id: '', name: '' });

  const documents = (data as any)?.data ?? [];

  const handleUpload = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      notify.error('No file selected', { description: 'Please choose a file to upload' });
      return;
    }
    if (!documentType) {
      notify.error('Missing document type', { description: 'Please select a document type' });
      return;
    }

    try {
      await uploadMutation.mutateAsync({ file, documentType });
      notify.success('Document uploaded');
      setDocumentType('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch {
      notify.error('Upload failed', { description: 'Could not upload document. Please try again.' });
    }
  };

  const handleDelete = (id: string, name: string) => {
    setDeleteConfirm({ isOpen: true, id, name });
  };

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="h-8 w-36 bg-gray-200 rounded animate-pulse mb-6" />
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6 mb-6 animate-pulse">
          <div className="h-5 w-40 bg-gray-200 rounded mb-4" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => <div key={i} className="h-10 bg-gray-100 rounded" />)}
          </div>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 animate-pulse">
          <div className="p-6 space-y-3">
            {[1, 2, 3].map((i) => <div key={i} className="h-12 bg-gray-100 rounded" />)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Documents</h1>

      {/* Upload Section */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <CloudArrowUpIcon className="h-5 w-5 text-primary-500" />
          Upload Document
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Document Type</label>
            <select
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value)}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 sm:text-sm"
            >
              {DOCUMENT_TYPES.map((dt) => (
                <option key={dt.value} value={dt.value}>{dt.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">File</label>
            <div className="p-4 border-2 border-dashed border-gray-200 rounded-xl bg-gray-50/50 hover:bg-gray-50 transition-colors">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
              />
            </div>
          </div>
          <div className="flex items-end">
            <button
              onClick={handleUpload}
              disabled={uploadMutation.isPending}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-xl text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50"
            >
              <ArrowUpTrayIcon className="h-4 w-4 mr-2" />
              {uploadMutation.isPending ? 'Uploading...' : 'Upload'}
            </button>
          </div>
        </div>
      </div>

      {/* Documents List */}
      {documents.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 py-12">
          <EmptyState
            illustration="folder"
            title="No documents uploaded yet"
            description="Upload your first document using the form above."
          />
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50/80">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Uploaded</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {documents.map((doc: any) => (
                <tr key={doc.id} className="hover:bg-gray-50/80">
                  <td className="px-6 py-4 text-sm text-gray-900">{doc.originalFileName}</td>
                  <td className="px-6 py-4 text-sm text-gray-500 capitalize">
                    {doc.documentType.replace(/_/g, ' ')}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {new Date(doc.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4">
                    <span className={clsx(
                      'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize',
                      STATUS_STYLES[doc.reviewStatus || 'pending'] || STATUS_STYLES.pending
                    )}>
                      {doc.reviewStatus || 'pending'}
                    </span>
                    {doc.reviewStatus === 'rejected' && doc.reviewNotes && (
                      <p className="mt-1 text-xs text-red-600">{doc.reviewNotes}</p>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {doc.reviewStatus !== 'approved' && (
                      <button
                        onClick={() => handleDelete(doc.id, doc.originalFileName)}
                        disabled={deleteMutation.isPending}
                        className="text-red-600 hover:text-red-800 disabled:opacity-50"
                      >
                        <TrashIcon className="h-5 w-5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        onClose={() => setDeleteConfirm({ isOpen: false, id: '', name: '' })}
        onConfirm={async () => {
          try {
            await deleteMutation.mutateAsync(deleteConfirm.id);
            notify.success('Document deleted');
          } catch {
            notify.error('Delete failed', { description: 'Could not delete document' });
          }
          setDeleteConfirm({ isOpen: false, id: '', name: '' });
        }}
        title="Delete Document"
        message={`Delete "${deleteConfirm.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
      />
    </div>
  );
}
