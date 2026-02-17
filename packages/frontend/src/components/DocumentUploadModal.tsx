import { useState, useRef, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  XMarkIcon,
  CloudArrowUpIcon,
  DocumentIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
} from '@heroicons/react/24/outline';
import { api } from '../services/api';
import toast from 'react-hot-toast';

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

const ALLOWED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/webp',
];

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

interface DocumentUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  providerId: string;
  providerName?: string;
  defaultDocumentType?: string;
  onUploadComplete?: () => void;
}

type UploadStep = 'select' | 'uploading' | 'processing' | 'complete' | 'error';

export default function DocumentUploadModal({
  isOpen,
  onClose,
  providerId,
  providerName,
  defaultDocumentType,
  onUploadComplete,
}: DocumentUploadModalProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState(defaultDocumentType || '');
  const [description, setDescription] = useState('');
  const [expirationDate, setExpirationDate] = useState('');
  const [uploadStep, setUploadStep] = useState<UploadStep>('select');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [uploadedDocument, setUploadedDocument] = useState<any>(null);

  // Reset state when modal opens with a different document type
  useEffect(() => {
    if (isOpen) {
      setDocumentType(defaultDocumentType || '');
      setFile(null);
      setDescription('');
      setExpirationDate('');
      setUploadStep('select');
      setUploadProgress(0);
      setErrorMessage('');
      setUploadedDocument(null);
    }
  }, [isOpen, defaultDocumentType]);

  const resetState = () => {
    setFile(null);
    setDocumentType(defaultDocumentType || '');
    setDescription('');
    setExpirationDate('');
    setUploadStep('select');
    setUploadProgress(0);
    setErrorMessage('');
    setUploadedDocument(null);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    // Validate file type
    if (!ALLOWED_TYPES.includes(selectedFile.type)) {
      toast.error('Invalid file type. Please upload PDF, JPEG, PNG, TIFF, or WebP.');
      return;
    }

    // Validate file size
    if (selectedFile.size > MAX_FILE_SIZE) {
      toast.error('File too large. Maximum size is 25MB.');
      return;
    }

    setFile(selectedFile);

    // Auto-detect document type from filename
    const fileName = selectedFile.name.toLowerCase();
    if (!documentType) {
      if (fileName.includes('license')) setDocumentType('license');
      else if (fileName.includes('w9') || fileName.includes('w-9')) setDocumentType('w9');
      else if (fileName.includes('coi') || fileName.includes('insurance')) setDocumentType('coi');
      else if (fileName.includes('cp575') || fileName.includes('irs')) setDocumentType('cp575');
      else if (fileName.includes('dea')) setDocumentType('dea_certificate');
      else if (fileName.includes('diploma')) setDocumentType('diploma');
      else if (fileName.includes('cv') || fileName.includes('resume')) setDocumentType('cv_resume');
      else if (fileName.includes('board') || fileName.includes('certification')) setDocumentType('board_certification');
      else if (fileName.includes('malpractice')) setDocumentType('malpractice_certificate');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      const fakeEvent = {
        target: { files: [droppedFile] },
      } as unknown as React.ChangeEvent<HTMLInputElement>;
      handleFileSelect(fakeEvent);
    }
  };

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file || !documentType) {
        throw new Error('Please select a file and document type');
      }

      setUploadStep('uploading');
      setUploadProgress(10);

      // Step 1: Get pre-signed upload URL
      const uploadUrlResponse = await api.post('/documents/upload-url', {
        providerId,
        fileName: file.name,
        contentType: file.type,
        documentType,
        description: description || undefined,
        expirationDate: expirationDate || undefined,
      });

      const { uploadUrl, documentId } = uploadUrlResponse.data.data;
      setUploadProgress(30);

      // Step 2: Upload directly to S3
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': file.type,
        },
      });

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload file to storage');
      }

      setUploadProgress(70);
      setUploadStep('processing');

      // Step 3: Confirm upload and trigger OCR
      const confirmResponse = await api.post('/documents/confirm-upload', {
        documentId,
      });

      setUploadProgress(100);
      setUploadStep('complete');
      setUploadedDocument(confirmResponse.data.data);

      return confirmResponse.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-full'] });
      toast.success('Document uploaded successfully!');
      if (onUploadComplete) {
        onUploadComplete();
      }
    },
    onError: (error: any) => {
      setUploadStep('error');
      setErrorMessage(error.response?.data?.error?.message || error.message || 'Upload failed');
      toast.error('Upload failed');
    },
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
        <div
          className="fixed inset-0 transition-opacity bg-gray-900/40 backdrop-blur-sm"
          onClick={handleClose}
        />

        <div className="relative z-10 inline-block w-full max-w-lg p-6 my-8 text-left align-middle bg-white rounded-2xl shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium text-gray-900">
              Upload Document {providerName && `for ${providerName}`}
            </h3>
            <button onClick={handleClose} className="text-gray-400 hover:text-gray-600">
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>

          {uploadStep === 'select' && (
            <div className="space-y-4">
              {/* File Drop Zone */}
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                  file
                    ? 'border-green-500 bg-green-50'
                    : 'border-gray-300 hover:border-primary-500 hover:bg-primary-50'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ALLOWED_TYPES.join(',')}
                  onChange={handleFileSelect}
                  className="hidden"
                />
                {file ? (
                  <div className="flex items-center justify-center gap-3">
                    <DocumentIcon className="h-10 w-10 text-green-600" />
                    <div className="text-left">
                      <p className="font-medium text-gray-900">{file.name}</p>
                      <p className="text-sm text-gray-500">
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    <CloudArrowUpIcon className="mx-auto h-12 w-12 text-gray-400" />
                    <p className="mt-2 text-sm text-gray-600">
                      <span className="font-medium text-primary-600">Click to upload</span> or drag
                      and drop
                    </p>
                    <p className="mt-1 text-xs text-gray-500">PDF, JPEG, PNG, TIFF up to 25MB</p>
                  </>
                )}
              </div>

              {/* Document Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Document Type *
                </label>
                <select
                  value={documentType}
                  onChange={(e) => setDocumentType(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">Select type...</option>
                  {DOCUMENT_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description (optional)
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g., Medical License - State of Texas"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              {/* Expiration Date */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Expiration Date (optional)
                </label>
                <input
                  type="date"
                  value={expirationDate}
                  onChange={(e) => setExpirationDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-4">
                <button
                  onClick={handleClose}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  onClick={() => uploadMutation.mutate()}
                  disabled={!file || !documentType}
                  className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Upload & Process
                </button>
              </div>
            </div>
          )}

          {(uploadStep === 'uploading' || uploadStep === 'processing') && (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-12 w-12 border-2 border-gray-200 border-t-primary-600 mx-auto"></div>
              <p className="mt-4 text-gray-900 font-medium">
                {uploadStep === 'uploading' ? 'Uploading document...' : 'Processing with OCR...'}
              </p>
              <p className="mt-1 text-sm text-gray-500">
                {uploadStep === 'processing' && 'Extracting text and data from your document'}
              </p>
              <div className="mt-4 w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-primary-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                ></div>
              </div>
            </div>
          )}

          {uploadStep === 'complete' && (
            <div className="text-center py-8">
              <CheckCircleIcon className="h-16 w-16 text-green-500 mx-auto" />
              <p className="mt-4 text-gray-900 font-medium">Upload Complete!</p>
              <p className="mt-1 text-sm text-gray-500">
                {uploadedDocument?.ocrStatus === 'processing'
                  ? 'OCR is processing in the background. Results will appear shortly.'
                  : uploadedDocument?.ocrStatus === 'completed'
                  ? 'Document text has been extracted successfully.'
                  : 'Document has been uploaded.'}
              </p>
              <div className="mt-6">
                <button
                  onClick={handleClose}
                  className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
                >
                  Done
                </button>
              </div>
            </div>
          )}

          {uploadStep === 'error' && (
            <div className="text-center py-8">
              <ExclamationCircleIcon className="h-16 w-16 text-red-500 mx-auto" />
              <p className="mt-4 text-gray-900 font-medium">Upload Failed</p>
              <p className="mt-1 text-sm text-red-600">{errorMessage}</p>
              <div className="mt-6 flex justify-center gap-3">
                <button
                  onClick={handleClose}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setUploadStep('select');
                    setErrorMessage('');
                  }}
                  className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
                >
                  Try Again
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
