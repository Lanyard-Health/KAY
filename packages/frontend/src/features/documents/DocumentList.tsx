import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CloudArrowUpIcon, DocumentIcon } from '@heroicons/react/24/outline';
import { format } from 'date-fns';
import { api } from '../../services/api';
import clsx from 'clsx';

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
  { value: 'other', label: 'Other' },
];

export default function DocumentList() {
  const [selectedProvider, setSelectedProvider] = useState<string>('');

  const { data: providers } = useQuery({
    queryKey: ['providers', 'list'],
    queryFn: async () => {
      const response = await api.get('/providers?pageSize=100');
      return response.data.data.data;
    },
  });

  const { data: documents, isLoading } = useQuery({
    queryKey: ['documents', selectedProvider],
    queryFn: async () => {
      if (!selectedProvider) return [];
      const response = await api.get(`/documents/provider/${selectedProvider}`);
      return response.data.data;
    },
    enabled: !!selectedProvider,
  });

  const getDocumentTypeLabel = (type: string) => {
    return DOCUMENT_TYPES.find(t => t.value === type)?.label || type;
  };

  const getOcrStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      completed: 'bg-green-100 text-green-800',
      processing: 'bg-blue-100 text-blue-800',
      pending: 'bg-yellow-100 text-yellow-800',
      failed: 'bg-red-100 text-red-800',
      not_applicable: 'bg-gray-100 text-gray-800',
    };
    return colors[status] || colors['not_applicable'];
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
            <button className="btn-primary">
              <CloudArrowUpIcon className="-ml-1 mr-2 h-5 w-5" />
              Upload Document
            </button>
          )}
        </div>
      </div>

      {/* Documents Grid */}
      {!selectedProvider ? (
        <div className="text-center py-12">
          <DocumentIcon className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">No provider selected</h3>
          <p className="mt-1 text-sm text-gray-500">
            Select a provider to view their documents
          </p>
        </div>
      ) : isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
        </div>
      ) : documents?.length === 0 ? (
        <div className="text-center py-12">
          <DocumentIcon className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">No documents</h3>
          <p className="mt-1 text-sm text-gray-500">
            Upload documents for this provider
          </p>
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
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  OCR Status
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
                        <p className="text-sm font-medium text-gray-900">
                          {doc.originalFileName}
                        </p>
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
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={clsx(
                        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize',
                        getOcrStatusBadge(doc.ocrStatus)
                      )}
                    >
                      {doc.ocrStatus.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button className="text-primary-600 hover:text-primary-900 mr-3">
                      Download
                    </button>
                    {doc.ocrStatus === 'completed' && (
                      <button className="text-primary-600 hover:text-primary-900">
                        View OCR
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
