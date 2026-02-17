import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownTrayIcon,
  CloudArrowUpIcon,
  DocumentIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
  ArrowLeftIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  DocumentTextIcon,
  ClipboardDocumentListIcon,
  UsersIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';
import {
  useDownloadTemplate,
  useValidateFile,
  useExecuteImport,
  useImportStatus,
  type ValidatedRow,
  type ValidationResult,
  type ImportStatus,
} from '../../hooks/useProviderImport';

// ==========================================
// Constants
// ==========================================

const STEPS = ['Upload', 'Preview', 'Confirm', 'Done'] as const;
const SESSION_CACHE_KEY = ['provider-import-session'] as const;
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB — matches backend multer limit
const ROWS_PER_PAGE = 50;

/** Sort priority: errors first, warnings, duplicates, valid last */
const STATUS_SORT_ORDER: Record<ValidatedRow['status'], number> = {
  error: 0,
  warning: 1,
  duplicate: 2,
  valid: 3,
};

// ==========================================
// Component
// ==========================================

/** Shape of the cached session data for cross-navigation persistence */
interface ImportSessionCache {
  validationResult: ValidationResult;
  checkedRowNumbers: number[];
  currentStep: number;
}

export default function ProviderImportPage() {
  const queryClient = useQueryClient();

  // Restore from cache if user navigated away during steps 0-2
  const cached = queryClient.getQueryData<ImportSessionCache>(SESSION_CACHE_KEY);

  const [currentStep, setCurrentStep] = useState(cached?.currentStep ?? 0);
  const [file, setFile] = useState<File | null>(null);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(
    cached?.validationResult ?? null,
  );
  const [isDragOver, setIsDragOver] = useState(false);
  const [checkedRowNumbers, setCheckedRowNumbers] = useState<Set<number>>(
    cached?.checkedRowNumbers ? new Set(cached.checkedRowNumbers) : new Set(),
  );
  const [importId, setImportId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const downloadTemplate = useDownloadTemplate();
  const validateFile = useValidateFile();
  const executeImport = useExecuteImport();
  const importStatus = useImportStatus(importId);

  // Persist session to React Query cache whenever validation state changes (steps 0-2)
  useEffect(() => {
    if (validationResult && currentStep < 3) {
      queryClient.setQueryData<ImportSessionCache>(SESSION_CACHE_KEY, {
        validationResult,
        checkedRowNumbers: [...checkedRowNumbers],
        currentStep,
      });
    }
  }, [validationResult, checkedRowNumbers, currentStep, queryClient]);

  // ------------------------------------------
  // Sorted rows (memoized)
  // ------------------------------------------

  const sortedRows = useMemo(() => {
    if (!validationResult) return [];
    return [...validationResult.rows].sort(
      (a, b) => STATUS_SORT_ORDER[a.status] - STATUS_SORT_ORDER[b.status],
    );
  }, [validationResult]);

  // ------------------------------------------
  // File handling
  // ------------------------------------------

  const handleFileSelect = useCallback((selectedFile: File) => {
    if (!selectedFile.name.endsWith('.csv') && selectedFile.type !== 'text/csv') {
      validateFile.reset();
      setFile(null);
      setValidationResult(null);
      return;
    }

    if (selectedFile.size > MAX_FILE_SIZE) {
      validateFile.reset();
      setFile(null);
      setValidationResult(null);
      return;
    }

    setFile(selectedFile);
    setValidationResult(null);
    setCheckedRowNumbers(new Set());

    validateFile.mutate(selectedFile, {
      onSuccess: (result) => {
        setValidationResult(result);
        // Default checked: valid + warning rows
        const defaultChecked = new Set(
          result.rows
            .filter((r) => r.status === 'valid' || r.status === 'warning')
            .map((r) => r.rowNumber),
        );
        setCheckedRowNumbers(defaultChecked);
      },
    });
  }, [validateFile]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) handleFileSelect(selectedFile);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) handleFileSelect(droppedFile);
  }, [handleFileSelect]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const clearFile = () => {
    setFile(null);
    setValidationResult(null);
    setCheckedRowNumbers(new Set());
    validateFile.reset();
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ------------------------------------------
  // Checkbox management
  // ------------------------------------------

  const toggleRow = (rowNumber: number) => {
    setCheckedRowNumbers((prev) => {
      const next = new Set(prev);
      if (next.has(rowNumber)) {
        next.delete(rowNumber);
      } else {
        next.add(rowNumber);
      }
      return next;
    });
  };

  const selectAllCheckable = () => {
    if (!validationResult) return;
    const checkable = validationResult.rows
      .filter((r) => r.status === 'valid' || r.status === 'warning' || r.status === 'duplicate')
      .map((r) => r.rowNumber);
    setCheckedRowNumbers(new Set(checkable));
  };

  const deselectAll = () => {
    setCheckedRowNumbers(new Set());
  };

  // ------------------------------------------
  // Selected rows for import
  // ------------------------------------------

  const selectedRows = useMemo(() => {
    if (!validationResult) return [];
    return validationResult.rows.filter((r) => checkedRowNumbers.has(r.rowNumber));
  }, [validationResult, checkedRowNumbers]);

  const selectedWarningCount = useMemo(
    () => selectedRows.filter((r) => r.status === 'warning').length,
    [selectedRows],
  );

  const skippedCount = useMemo(() => {
    if (!validationResult) return 0;
    return validationResult.rows.length - selectedRows.length;
  }, [validationResult, selectedRows]);

  // ------------------------------------------
  // Step navigation
  // ------------------------------------------

  const canProceedToPreview = validationResult && (
    validationResult.summary.valid > 0 || validationResult.summary.warnings > 0
  );

  const handleProceedToPreview = () => {
    if (canProceedToPreview) setCurrentStep(1);
  };

  const handleProceedToConfirm = () => {
    if (selectedRows.length > 0) setCurrentStep(2);
  };

  const handleExecuteImport = () => {
    executeImport.mutate(selectedRows, {
      onSuccess: (result) => {
        setImportId(result.importId);
        setCurrentStep(3);
        // Clear session cache — import is underway, no need to persist validation state
        queryClient.removeQueries({ queryKey: SESSION_CACHE_KEY });
      },
    });
  };

  const handleStartOver = () => {
    setCurrentStep(0);
    setFile(null);
    setValidationResult(null);
    setCheckedRowNumbers(new Set());
    setImportId(null);
    validateFile.reset();
    executeImport.reset();
    queryClient.removeQueries({ queryKey: SESSION_CACHE_KEY });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ------------------------------------------
  // Render
  // ------------------------------------------

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <Link
          to="/providers"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back to Providers
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Import Providers</h1>
        <p className="mt-1 text-sm text-gray-500">
          Bulk import providers from a CSV file into your practice.
        </p>
      </div>

      {/* Step indicator */}
      <StepIndicator steps={STEPS} currentStep={currentStep} />

      {/* Step content */}
      {currentStep === 0 && (
        <StepUpload
          file={file}
          validationResult={validationResult}
          isDragOver={isDragOver}
          isValidating={validateFile.isPending}
          fileInputRef={fileInputRef}
          onInputChange={handleInputChange}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClearFile={clearFile}
          onDownloadTemplate={() => downloadTemplate.mutate()}
          isDownloading={downloadTemplate.isPending}
          canProceed={!!canProceedToPreview}
          onProceed={handleProceedToPreview}
        />
      )}

      {currentStep === 1 && validationResult && (
        <StepPreview
          validationResult={validationResult}
          sortedRows={sortedRows}
          checkedRowNumbers={checkedRowNumbers}
          onToggleRow={toggleRow}
          onSelectAll={selectAllCheckable}
          onDeselectAll={deselectAll}
          selectedCount={selectedRows.length}
          onProceed={handleProceedToConfirm}
          onBack={() => setCurrentStep(0)}
        />
      )}

      {currentStep === 2 && (
        <StepConfirm
          selectedCount={selectedRows.length}
          warningCount={selectedWarningCount}
          skippedCount={skippedCount}
          isExecuting={executeImport.isPending}
          importError={executeImport.isError ? (executeImport.error as any)?.message || 'Import failed' : null}
          onConfirm={handleExecuteImport}
          onBack={() => { executeImport.reset(); setCurrentStep(1); }}
        />
      )}

      {currentStep === 3 && (
        <StepImportResult
          immediateResult={executeImport.data || null}
          polledStatus={importStatus.data || null}
          isPolling={importStatus.isFetching}
          pollError={importStatus.isError ? (importStatus.error as any)?.message || 'Failed to check status' : null}
          onStartOver={handleStartOver}
        />
      )}
    </div>
  );
}

// ==========================================
// Step Indicator
// ==========================================

function StepIndicator({ steps, currentStep }: { steps: readonly string[]; currentStep: number }) {
  return (
    <nav className="mb-8">
      <ol className="flex items-center">
        {steps.map((step, index) => (
          <li key={step} className={clsx('flex items-center', index < steps.length - 1 && 'flex-1')}>
            <div className="flex items-center gap-2">
              <span
                className={clsx(
                  'flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium',
                  index < currentStep
                    ? 'bg-primary-600 text-white'
                    : index === currentStep
                      ? 'border-2 border-primary-600 text-primary-600'
                      : 'border-2 border-gray-300 text-gray-400',
                )}
              >
                {index < currentStep ? (
                  <CheckCircleIcon className="h-5 w-5" />
                ) : (
                  index + 1
                )}
              </span>
              <span
                className={clsx(
                  'text-sm font-medium',
                  index <= currentStep ? 'text-gray-900' : 'text-gray-400',
                )}
              >
                {step}
              </span>
            </div>
            {index < steps.length - 1 && (
              <div
                className={clsx(
                  'mx-4 h-0.5 flex-1',
                  index < currentStep ? 'bg-primary-600' : 'bg-gray-200',
                )}
              />
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

// ==========================================
// Step 1: Upload
// ==========================================

function StepUpload({
  file,
  validationResult,
  isDragOver,
  isValidating,
  fileInputRef,
  onInputChange,
  onDrop,
  onDragOver,
  onDragLeave,
  onClearFile,
  onDownloadTemplate,
  isDownloading,
  canProceed,
  onProceed,
}: {
  file: File | null;
  validationResult: ValidationResult | null;
  isDragOver: boolean;
  isValidating: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onClearFile: () => void;
  onDownloadTemplate: () => void;
  isDownloading: boolean;
  canProceed: boolean;
  onProceed: () => void;
}) {
  return (
    <div className="space-y-6">
      {/* Template download */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">CSV Template</h3>
            <p className="mt-1 text-sm text-gray-500">
              Download the template, fill in your provider data, then upload below.
            </p>
          </div>
          <button
            type="button"
            onClick={onDownloadTemplate}
            disabled={isDownloading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:opacity-50"
          >
            <ArrowDownTrayIcon className="h-4 w-4" />
            {isDownloading ? 'Downloading...' : 'Download Template'}
          </button>
        </div>
      </div>

      {/* Drop zone */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Upload CSV File</h3>

        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className={clsx(
            'relative border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
            isDragOver
              ? 'border-primary-500 bg-primary-50'
              : file
                ? 'border-primary-300 bg-primary-50/50'
                : 'border-gray-300 hover:border-primary-400 hover:bg-gray-50',
          )}
        >
          <input
            ref={fileInputRef as React.RefObject<HTMLInputElement>}
            type="file"
            accept=".csv,text/csv"
            onChange={onInputChange}
            className="hidden"
          />

          {file ? (
            <div className="flex items-center justify-center gap-3">
              <DocumentIcon className="h-8 w-8 text-primary-600" />
              <div className="text-left">
                <p className="text-sm font-medium text-gray-900">{file.name}</p>
                <p className="text-xs text-gray-500">
                  {(file.size / 1024).toFixed(1)} KB
                </p>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClearFile();
                }}
                className="ml-2 rounded-full p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              >
                <XCircleIcon className="h-5 w-5" />
              </button>
            </div>
          ) : (
            <>
              <CloudArrowUpIcon className="mx-auto h-10 w-10 text-gray-400" />
              <p className="mt-2 text-sm text-gray-600">
                <span className="font-medium text-primary-600">Click to upload</span> or drag and drop
              </p>
              <p className="mt-1 text-xs text-gray-400">CSV files only, up to 2MB</p>
            </>
          )}
        </div>

        {/* Validating spinner */}
        {isValidating && (
          <div className="mt-4 flex items-center gap-2 text-sm text-gray-500">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-primary-600" />
            Validating file...
          </div>
        )}

        {/* Validation results */}
        {validationResult && !isValidating && (
          <ValidationSummaryBar summary={validationResult.summary} />
        )}
      </div>

      {/* Action buttons */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onProceed}
          disabled={!canProceed}
          className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Review Providers
        </button>
      </div>
    </div>
  );
}

// ==========================================
// Step 2: Preview Table
// ==========================================

function StepPreview({
  validationResult,
  sortedRows,
  checkedRowNumbers,
  onToggleRow,
  onSelectAll,
  onDeselectAll,
  selectedCount,
  onProceed,
  onBack,
}: {
  validationResult: ValidationResult;
  sortedRows: ValidatedRow[];
  checkedRowNumbers: Set<number>;
  onToggleRow: (rowNumber: number) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  selectedCount: number;
  onProceed: () => void;
  onBack: () => void;
}) {
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [currentPage, setCurrentPage] = useState(0);

  const totalPages = Math.ceil(sortedRows.length / ROWS_PER_PAGE);
  const pageRows = sortedRows.slice(
    currentPage * ROWS_PER_PAGE,
    (currentPage + 1) * ROWS_PER_PAGE,
  );

  const toggleExpand = (rowNumber: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowNumber)) {
        next.delete(rowNumber);
      } else {
        next.add(rowNumber);
      }
      return next;
    });
  };

  // Check if all checkable rows are selected
  const checkableCount = validationResult.rows.filter(
    (r) => r.status !== 'error',
  ).length;
  const allChecked = selectedCount === checkableCount && checkableCount > 0;

  return (
    <div className="space-y-6">
      {/* Summary bar */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
            <span className="font-medium text-green-700">{validationResult.summary.valid}</span>
            <span className="text-gray-500">ready to import</span>
          </div>
          {validationResult.summary.warnings > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
              <span className="font-medium text-amber-700">{validationResult.summary.warnings}</span>
              <span className="text-gray-500">with warnings</span>
            </div>
          )}
          {validationResult.summary.errors > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
              <span className="font-medium text-red-700">{validationResult.summary.errors}</span>
              <span className="text-gray-500">with errors</span>
            </div>
          )}
          {validationResult.summary.duplicates > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-gray-400" />
              <span className="font-medium text-gray-600">{validationResult.summary.duplicates}</span>
              <span className="text-gray-500">duplicates</span>
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
          <button
            type="button"
            onClick={allChecked ? onDeselectAll : onSelectAll}
            className="text-sm font-medium text-primary-600 hover:text-primary-700"
          >
            {allChecked ? 'Deselect all' : 'Select all'}
          </button>
          <span className="text-sm text-gray-500">
            {selectedCount} of {validationResult.rows.length} selected
          </span>
        </div>

        {/* Table content */}
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="w-10 px-3 py-2" />
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Row</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">First Name</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Last Name</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">NPI</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="w-10 px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pageRows.map((row) => {
                const isError = row.status === 'error';
                const hasDetails = row.errors.length > 0 || row.warnings.length > 0;
                const isExpanded = expandedRows.has(row.rowNumber);
                const isChecked = checkedRowNumbers.has(row.rowNumber);

                return (
                  <PreviewTableRow
                    key={row.rowNumber}
                    row={row}
                    isChecked={isChecked}
                    isDisabled={isError}
                    isExpanded={isExpanded}
                    hasDetails={hasDetails}
                    onToggleCheck={() => onToggleRow(row.rowNumber)}
                    onToggleExpand={() => toggleExpand(row.rowNumber)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
            <span className="text-sm text-gray-500">
              Page {currentPage + 1} of {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                disabled={currentPage === 0}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={currentPage === totalPages - 1}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex justify-between">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back
        </button>
        <button
          type="button"
          onClick={onProceed}
          disabled={selectedCount === 0}
          className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Import {selectedCount} Provider{selectedCount !== 1 ? 's' : ''}
        </button>
      </div>
    </div>
  );
}

// ==========================================
// Preview Table Row (with expand)
// ==========================================

function PreviewTableRow({
  row,
  isChecked,
  isDisabled,
  isExpanded,
  hasDetails,
  onToggleCheck,
  onToggleExpand,
}: {
  row: ValidatedRow;
  isChecked: boolean;
  isDisabled: boolean;
  isExpanded: boolean;
  hasDetails: boolean;
  onToggleCheck: () => void;
  onToggleExpand: () => void;
}) {
  return (
    <>
      <tr className={clsx(isDisabled && 'bg-gray-50/50 opacity-70')}>
        {/* Checkbox */}
        <td className="px-3 py-2 text-center">
          <input
            type="checkbox"
            checked={isChecked}
            disabled={isDisabled}
            onChange={onToggleCheck}
            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 disabled:opacity-40 disabled:cursor-not-allowed"
          />
        </td>
        {/* Row # */}
        <td className="px-3 py-2 text-sm text-gray-500">{row.rowNumber}</td>
        {/* Status badge */}
        <td className="px-3 py-2">
          <RowStatusBadge status={row.status} />
        </td>
        {/* Data columns */}
        <td className="px-3 py-2 text-sm text-gray-900">{row.data.firstName}</td>
        <td className="px-3 py-2 text-sm text-gray-900">{row.data.lastName}</td>
        <td className="px-3 py-2 text-sm text-gray-500 font-mono">{row.data.npi}</td>
        <td className="px-3 py-2 text-sm text-gray-500">{row.data.email}</td>
        <td className="px-3 py-2 text-sm text-gray-500 capitalize">{row.data.providerType}</td>
        {/* Expand toggle */}
        <td className="px-3 py-2 text-center">
          {hasDetails ? (
            <button
              type="button"
              onClick={onToggleExpand}
              className="rounded p-0.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100"
            >
              {isExpanded ? (
                <ChevronDownIcon className="h-4 w-4" />
              ) : (
                <ChevronRightIcon className="h-4 w-4" />
              )}
            </button>
          ) : (
            <span className="inline-block w-4" />
          )}
        </td>
      </tr>
      {/* Expanded details row */}
      {isExpanded && hasDetails && (
        <tr>
          <td colSpan={9} className="px-4 py-3 bg-gray-50">
            <div className="pl-8 space-y-1.5">
              {row.status === 'duplicate' && (
                <p className="text-sm text-gray-600">
                  Already exists: Dr. {row.data.firstName} {row.data.lastName} (NPI: {row.data.npi})
                </p>
              )}
              {row.warnings.map((w, i) => (
                <div key={`w-${i}`} className="flex items-start gap-1.5 text-sm">
                  <ExclamationTriangleIcon className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                  <span className="text-amber-700">{w.message}</span>
                </div>
              ))}
              {row.errors.map((e, i) => (
                <div key={`e-${i}`} className="flex items-start gap-1.5 text-sm">
                  <XCircleIcon className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                  <span className="text-red-700">
                    <span className="font-medium">{e.field}:</span> {e.message}
                  </span>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ==========================================
// Step 3: Confirm
// ==========================================

function StepConfirm({
  selectedCount,
  warningCount,
  skippedCount,
  isExecuting,
  importError,
  onConfirm,
  onBack,
}: {
  selectedCount: number;
  warningCount: number;
  skippedCount: number;
  isExecuting: boolean;
  importError: string | null;
  onConfirm: () => void;
  onBack: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Confirm Import</h3>

        <p className="text-sm text-gray-700">
          You&apos;re about to import{' '}
          <span className="font-semibold">{selectedCount} provider{selectedCount !== 1 ? 's' : ''}</span>{' '}
          into your practice.
        </p>

        {warningCount > 0 && (
          <div className="mt-3 flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2">
            <ExclamationTriangleIcon className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
            <p className="text-sm text-amber-800">
              {warningCount} provider{warningCount !== 1 ? 's have' : ' has'} warnings
              (NPI verification, expired licenses). They will still be imported.
            </p>
          </div>
        )}

        {skippedCount > 0 && (
          <div className="mt-3 flex items-start gap-2 rounded-md bg-gray-50 px-3 py-2">
            <XCircleIcon className="h-5 w-5 text-gray-400 mt-0.5 shrink-0" />
            <p className="text-sm text-gray-600">
              {skippedCount} row{skippedCount !== 1 ? 's' : ''} will be skipped (errors, duplicates, or unchecked).
            </p>
          </div>
        )}

        {importError && (
          <div className="mt-4 rounded-md bg-red-50 px-3 py-2">
            <div className="flex items-start gap-2">
              <XCircleIcon className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-red-800">Import failed</p>
                <p className="text-sm text-red-700 mt-0.5">{importError}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-between">
        <button
          type="button"
          onClick={onBack}
          disabled={isExecuting}
          className="inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:opacity-50"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Go Back
        </button>
        <button
          type="button"
          onClick={importError ? onBack : onConfirm}
          disabled={isExecuting}
          className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isExecuting ? (
            <>
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Importing providers...
            </>
          ) : importError ? (
            'Try Again'
          ) : (
            'Confirm Import'
          )}
        </button>
      </div>
    </div>
  );
}

// ==========================================
// Step 4: Done (with polling + next steps)
// ==========================================

function StepImportResult({
  immediateResult,
  polledStatus,
  isPolling: _isPolling,
  pollError,
  onStartOver,
}: {
  immediateResult: { importId: string; successCount: number; errorCount: number; skippedCount: number; error?: string } | null;
  polledStatus: ImportStatus | null;
  isPolling: boolean;
  pollError: string | null;
  onStartOver: () => void;
}) {
  // Derive display state from polled status (preferred) or immediate result (fallback)
  const status = polledStatus?.status ?? (immediateResult?.error ? 'failed' : 'completed');
  const isProcessing = status === 'pending' || status === 'processing';
  const isFailed = status === 'failed';

  // Use polled data when available, fall back to immediate result
  const successCount = polledStatus?.successCount ?? immediateResult?.successCount ?? 0;
  const errorCount = polledStatus?.errorCount ?? immediateResult?.errorCount ?? 0;
  const skippedCount = polledStatus?.skippedCount ?? immediateResult?.skippedCount ?? 0;
  const totalRows = polledStatus?.totalRows ?? (successCount + errorCount + skippedCount);
  const errorDetails = polledStatus?.errorDetails ?? immediateResult?.error ?? null;

  // Progress percentage for the bar
  const processedCount = successCount + errorCount + skippedCount;
  const progressPct = totalRows > 0 ? Math.round((processedCount / totalRows) * 100) : 0;

  // ---------- Processing / Pending ----------
  if (isProcessing) {
    return (
      <div className="space-y-6">
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-gray-200 border-t-primary-600" />
          <h3 className="mt-4 text-lg font-semibold text-gray-900">Importing providers...</h3>
          <p className="mt-1 text-sm text-gray-500">
            {status === 'pending' ? 'Preparing import...' : `Processing ${processedCount} of ${totalRows} rows`}
          </p>

          {/* Progress bar */}
          {totalRows > 0 && status === 'processing' && (
            <div className="mt-4 mx-auto max-w-xs">
              <div className="h-2 w-full rounded-full bg-gray-200">
                <div
                  className="h-2 rounded-full bg-primary-600 transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-gray-400">{progressPct}%</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---------- Failed ----------
  if (isFailed) {
    return (
      <div className="space-y-6">
        <div className="rounded-lg border border-red-200 bg-red-50 p-8 text-center">
          <XCircleIcon className="mx-auto h-12 w-12 text-red-500" />
          <h3 className="mt-4 text-lg font-semibold text-gray-900">Import Failed</h3>
          {errorDetails && (
            <p className="mt-2 text-sm text-red-700 max-w-md mx-auto">{errorDetails}</p>
          )}
          <p className="mt-2 text-sm text-gray-500">No providers were created.</p>
        </div>

        <div className="flex justify-center">
          <button
            type="button"
            onClick={onStartOver}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-primary-700"
          >
            <ArrowPathIcon className="h-4 w-4" />
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // ---------- Completed ----------
  const nextSteps = [
    {
      title: 'Upload Documents',
      description: 'Add licenses, certifications, and other documents for your new providers.',
      href: '/documents',
      icon: DocumentTextIcon,
    },
    {
      title: 'Start Enrollments',
      description: 'Begin payer enrollment applications for your imported providers.',
      href: '/enrollments',
      icon: ClipboardDocumentListIcon,
    },
    {
      title: 'Review Providers',
      description: 'View and manage your complete provider roster.',
      href: '/providers',
      icon: UsersIcon,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Success banner */}
      <div className="rounded-lg border border-green-200 bg-green-50 p-8 text-center">
        <CheckCircleIcon className="mx-auto h-14 w-14 text-green-500" />
        <h3 className="mt-4 text-xl font-semibold text-gray-900">
          {successCount} provider{successCount !== 1 ? 's' : ''} imported successfully!
        </h3>
        {skippedCount > 0 && (
          <p className="mt-1 text-sm text-gray-500">
            {skippedCount} row{skippedCount !== 1 ? 's' : ''} skipped
          </p>
        )}
        {errorCount > 0 && (
          <p className="mt-1 text-sm text-amber-600">
            {errorCount} row{errorCount !== 1 ? 's' : ''} had errors
          </p>
        )}
      </div>

      {/* Poll error notice */}
      {pollError && (
        <div className="rounded-md bg-gray-50 px-3 py-2 text-center">
          <p className="text-xs text-gray-500">
            Could not refresh status. Showing results from initial response.
          </p>
        </div>
      )}

      {/* What's next? */}
      <div>
        <h4 className="text-sm font-semibold text-gray-900 mb-3">What&apos;s next?</h4>
        <div className="grid gap-4 sm:grid-cols-3">
          {nextSteps.map((step) => (
            <Link
              key={step.href}
              to={step.href}
              className="group rounded-lg border border-gray-200 bg-white p-5 hover:border-primary-300 hover:shadow-md transition-all duration-200"
            >
              <step.icon className="h-8 w-8 text-primary-600 group-hover:text-primary-700" />
              <h5 className="mt-3 text-sm font-semibold text-gray-900 group-hover:text-primary-700">
                {step.title}
              </h5>
              <p className="mt-1 text-xs text-gray-500 leading-relaxed">
                {step.description}
              </p>
            </Link>
          ))}
        </div>
      </div>

      {/* Import more link */}
      <div className="text-center pt-2">
        <button
          type="button"
          onClick={onStartOver}
          className="text-sm font-medium text-primary-600 hover:text-primary-700"
        >
          Import More Providers
        </button>
      </div>
    </div>
  );
}

// ==========================================
// Shared sub-components
// ==========================================

function ValidationSummaryBar({ summary }: { summary: ValidationResult['summary'] }) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
      <div className="flex items-center gap-1.5">
        <CheckCircleIcon className="h-4 w-4 text-green-500" />
        <span className="text-gray-700">{summary.valid} valid</span>
      </div>
      {summary.warnings > 0 && (
        <div className="flex items-center gap-1.5">
          <ExclamationTriangleIcon className="h-4 w-4 text-amber-500" />
          <span className="text-gray-700">{summary.warnings} warnings</span>
        </div>
      )}
      {summary.errors > 0 && (
        <div className="flex items-center gap-1.5">
          <XCircleIcon className="h-4 w-4 text-red-500" />
          <span className="text-gray-700">{summary.errors} errors</span>
        </div>
      )}
      {summary.duplicates > 0 && (
        <div className="flex items-center gap-1.5">
          <ExclamationTriangleIcon className="h-4 w-4 text-gray-400" />
          <span className="text-gray-700">{summary.duplicates} duplicates</span>
        </div>
      )}
      <span className="text-gray-400">
        {summary.total} total row{summary.total !== 1 ? 's' : ''}
      </span>
    </div>
  );
}

function RowStatusBadge({ status }: { status: ValidatedRow['status'] }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize',
        status === 'valid' && 'bg-green-100 text-green-700',
        status === 'warning' && 'bg-amber-100 text-amber-700',
        status === 'error' && 'bg-red-100 text-red-700',
        status === 'duplicate' && 'bg-gray-100 text-gray-600',
      )}
    >
      {status}
    </span>
  );
}
