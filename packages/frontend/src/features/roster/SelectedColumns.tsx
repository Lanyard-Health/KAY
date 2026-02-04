import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Bars3Icon, XMarkIcon } from '@heroicons/react/20/solid';
import type { RosterColumn } from '../../hooks/useRoster';

interface SelectedColumnsProps {
  columns: RosterColumn[];
  onReorder: (columns: RosterColumn[]) => void;
  onRemove: (fieldKey: string) => void;
}

function SortableItem({
  column,
  onRemove,
}: {
  column: RosterColumn;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: column.fieldKey });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 bg-white border border-gray-200 rounded-md px-2 py-1.5 shadow-sm"
    >
      <button
        type="button"
        className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600"
        {...attributes}
        {...listeners}
      >
        <Bars3Icon className="h-4 w-4" />
      </button>
      <span className="flex-1 text-sm text-gray-700 truncate">{column.label}</span>
      <button
        type="button"
        onClick={onRemove}
        className="text-gray-400 hover:text-red-500"
      >
        <XMarkIcon className="h-4 w-4" />
      </button>
    </li>
  );
}

export default function SelectedColumns({
  columns,
  onReorder,
  onRemove,
}: SelectedColumnsProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = columns.findIndex((c) => c.fieldKey === active.id);
      const newIndex = columns.findIndex((c) => c.fieldKey === over.id);
      onReorder(arrayMove(columns, oldIndex, newIndex));
    }
  }

  return (
    <div className="flex flex-col h-full">
      <h3 className="text-sm font-semibold text-gray-900 mb-2">
        Selected Columns
        {columns.length > 0 && (
          <span className="ml-1 text-gray-400 font-normal">({columns.length})</span>
        )}
      </h3>

      {columns.length === 0 ? (
        <div className="flex-1 flex items-center justify-center border-2 border-dashed border-gray-200 rounded-lg">
          <p className="text-sm text-gray-400">
            Click [+] on fields to add them to your report
          </p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={columns.map((c) => c.fieldKey)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="flex-1 overflow-y-auto space-y-1">
              {columns.map((column) => (
                <SortableItem
                  key={column.fieldKey}
                  column={column}
                  onRemove={() => onRemove(column.fieldKey)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
