import { useState, useMemo, useCallback } from 'react';
import PageTransition from '../../components/ui/PageTransition';
import {
  ArrowDownTrayIcon,
} from '@heroicons/react/24/outline';
import { notify } from '../../utils/notify';
import FieldPicker from './FieldPicker';
import SelectedColumns from './SelectedColumns';
import RosterPreviewTable from './RosterPreviewTable';
import {
  useRosterPreview,
  exportRosterToExcel,
} from '../../hooks/useRoster';
import type { RosterColumn } from '../../hooks/useRoster';
export default function RosterPage() {
  // Column state
  const [columns, setColumns] = useState<RosterColumn[]>([]);
  const [page, setPage] = useState(1);

  // Exporting state
  const [isExporting, setIsExporting] = useState(false);

  // Selected keys for quick lookup
  const selectedKeys = useMemo(
    () => new Set(columns.map((c) => c.fieldKey)),
    [columns]
  );

  // Preview data
  const { data: preview, isLoading: previewLoading } = useRosterPreview(columns, page);

  // Handlers
  const handleAddField = useCallback((column: RosterColumn) => {
    setColumns((prev) => [...prev, column]);
    setPage(1);
  }, []);

  const handleRemoveField = useCallback((fieldKey: string) => {
    setColumns((prev) => prev.filter((c) => c.fieldKey !== fieldKey));
    setPage(1);
  }, []);

  const handleReorder = useCallback((newColumns: RosterColumn[]) => {
    setColumns(newColumns);
  }, []);

  const handleExport = async () => {
    if (columns.length === 0) {
      notify.error('No columns selected', { description: 'Select at least one column to export' });
      return;
    }
    setIsExporting(true);
    try {
      await exportRosterToExcel(columns, 'Roster Report');
      notify.success('Export complete', { description: 'Excel file downloaded' });
    } catch {
      notify.error('Export failed', { description: 'Please try again' });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <PageTransition>
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Roster Report Builder</h1>
        <button
          type="button"
          onClick={handleExport}
          disabled={columns.length === 0 || isExporting}
          className="inline-flex items-center gap-1.5 rounded-xl bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ArrowDownTrayIcon className="h-4 w-4" />
          {isExporting ? 'Exporting...' : 'Export'}
        </button>
      </div>

      {/* Builder area: field picker + selected columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Left: Available Fields */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-4 h-[420px] overflow-hidden flex flex-col">
          <FieldPicker selectedKeys={selectedKeys} onAddField={handleAddField} />
        </div>

        {/* Right: Selected Columns */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-4 h-[420px] overflow-hidden flex flex-col">
          <SelectedColumns
            columns={columns}
            onReorder={handleReorder}
            onRemove={handleRemoveField}
          />
        </div>
      </div>

      {/* Data Preview */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Data Preview</h3>
        <RosterPreviewTable
          headers={preview?.headers || []}
          rows={preview?.rows || []}
          total={preview?.total || 0}
          page={preview?.page || 1}
          totalPages={preview?.totalPages || 1}
          onPageChange={setPage}
          isLoading={previewLoading && columns.length > 0}
        />
      </div>

    </div>
    </PageTransition>
  );
}
