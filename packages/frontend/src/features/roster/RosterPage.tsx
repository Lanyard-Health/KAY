import { useState, useMemo, useCallback } from 'react';
import {
  ArrowDownTrayIcon,
  BookmarkIcon,
  FolderOpenIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import FieldPicker from './FieldPicker';
import SelectedColumns from './SelectedColumns';
import RosterPreviewTable from './RosterPreviewTable';
import SaveTemplateModal from './SaveTemplateModal';
import LoadTemplateModal from './LoadTemplateModal';
import {
  useRosterPreview,
  useRosterTemplates,
  useCreateRosterTemplate,
  useUpdateRosterTemplate,
  useDeleteRosterTemplate,
  exportRosterToExcel,
} from '../../hooks/useRoster';
import type { RosterColumn, RosterTemplate } from '../../hooks/useRoster';
import { useAuthStore } from '../../stores/auth.store';

export default function RosterPage() {
  const { user } = useAuthStore();

  // Column state
  const [columns, setColumns] = useState<RosterColumn[]>([]);
  const [page, setPage] = useState(1);

  // Modal state
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [loadModalOpen, setLoadModalOpen] = useState(false);

  // Track which template is loaded (for "update" vs "save new")
  const [activeTemplate, setActiveTemplate] = useState<RosterTemplate | null>(null);

  // Exporting state
  const [isExporting, setIsExporting] = useState(false);

  // Selected keys for quick lookup
  const selectedKeys = useMemo(
    () => new Set(columns.map((c) => c.fieldKey)),
    [columns]
  );

  // Preview data
  const { data: preview, isLoading: previewLoading } = useRosterPreview(columns, page);

  // Templates
  const { data: templates = [], isLoading: templatesLoading } = useRosterTemplates();
  const createTemplate = useCreateRosterTemplate();
  const updateTemplate = useUpdateRosterTemplate();
  const deleteTemplate = useDeleteRosterTemplate();

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
      toast.error('Select at least one column to export');
      return;
    }
    setIsExporting(true);
    try {
      await exportRosterToExcel(
        columns,
        activeTemplate?.name || 'Roster Report'
      );
      toast.success('Excel file downloaded');
    } catch {
      toast.error('Export failed');
    } finally {
      setIsExporting(false);
    }
  };

  const handleSave = async (data: {
    name: string;
    description?: string;
    isShared: boolean;
  }) => {
    try {
      if (activeTemplate) {
        await updateTemplate.mutateAsync({
          id: activeTemplate.id,
          ...data,
          columns,
        });
        toast.success('Template updated');
      } else {
        const created = await createTemplate.mutateAsync({
          ...data,
          columns,
        });
        setActiveTemplate(created);
        toast.success('Template saved');
      }
      setSaveModalOpen(false);
    } catch {
      toast.error('Failed to save template');
    }
  };

  const handleLoad = (template: RosterTemplate) => {
    setColumns(template.columns);
    setActiveTemplate(template);
    setPage(1);
    toast.success(`Loaded "${template.name}"`);
  };

  const handleDeleteTemplate = async (id: string) => {
    try {
      await deleteTemplate.mutateAsync(id);
      if (activeTemplate?.id === id) {
        setActiveTemplate(null);
      }
      toast.success('Template deleted');
    } catch {
      toast.error('Failed to delete template');
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Roster Report Builder</h1>
          {activeTemplate && (
            <p className="text-sm text-gray-500 mt-1">
              Template: {activeTemplate.name}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setLoadModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <FolderOpenIcon className="h-4 w-4" />
            Load
          </button>
          <button
            type="button"
            onClick={() => setSaveModalOpen(true)}
            disabled={columns.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <BookmarkIcon className="h-4 w-4" />
            Save
          </button>
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

      {/* Modals */}
      <SaveTemplateModal
        isOpen={saveModalOpen}
        onClose={() => setSaveModalOpen(false)}
        onSave={handleSave}
        columns={columns}
        existingTemplate={activeTemplate}
        isSaving={createTemplate.isPending || updateTemplate.isPending}
      />

      <LoadTemplateModal
        isOpen={loadModalOpen}
        onClose={() => setLoadModalOpen(false)}
        templates={templates}
        onLoad={handleLoad}
        onDelete={handleDeleteTemplate}
        isLoading={templatesLoading}
        currentUserId={user?.id}
      />
    </div>
  );
}
