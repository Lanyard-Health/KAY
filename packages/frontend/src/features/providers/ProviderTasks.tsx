import { useState } from 'react';
import { useTasks, useTerminationLetters } from '../../hooks/useTasks';
import TaskStatusUpdateModal from './TaskStatusUpdateModal';
import TerminationLetterModal from './TerminationLetterModal';
import clsx from 'clsx';
import EmptyState from '../../components/ui/EmptyState';

interface ProviderTasksProps {
  providerId: string;
}

const TASK_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  PENDING: { label: 'Pending', color: 'bg-yellow-100 text-yellow-800' },
  IN_PROGRESS: { label: 'In Progress', color: 'bg-blue-100 text-blue-800' },
  COMPLETED: { label: 'Completed', color: 'bg-green-100 text-green-800' },
  SKIPPED: { label: 'Skipped', color: 'bg-gray-100 text-gray-800' },
};

const TASK_TYPE_CONFIG: Record<string, { label: string }> = {
  TERMINATE_ENROLLMENT: { label: 'Terminate Enrollment' },
  CHECK_AVAILITY: { label: 'Check Availity' },
  UPDATE_CAQH: { label: 'Update CAQH' },
  DRAFT_TERM_LETTER: { label: 'Draft Term Letter' },
  CUSTOM: { label: 'Custom' },
};

const TYPE_FILTER_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: 'TERMINATE_ENROLLMENT', label: 'Terminate Enrollment' },
  { value: 'DRAFT_TERM_LETTER', label: 'Draft Term Letter' },
  { value: 'CHECK_AVAILITY', label: 'Check Availity' },
  { value: 'UPDATE_CAQH', label: 'Update CAQH' },
  { value: 'CUSTOM', label: 'Custom' },
];

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'SKIPPED', label: 'Skipped' },
];

export default function ProviderTasks({ providerId }: ProviderTasksProps) {
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [selectedLetterId, setSelectedLetterId] = useState<string | null>(null);

  const filters: { status?: string; type?: string } = {};
  if (statusFilter) filters.status = statusFilter;
  if (typeFilter) filters.type = typeFilter;

  const { data, isLoading, error } = useTasks(providerId, filters);
  const { data: lettersData } = useTerminationLetters(providerId);

  const tasks = (data?.data as any[]) || [];
  const letters = (lettersData?.data as any[]) || [];

  // Map taskId -> letterId for quick lookup
  const taskLetterMap = new Map<string, string>();
  for (const letter of letters) {
    if (letter.task?.id) {
      taskLetterMap.set(letter.task.id, letter.id);
    }
  }

  const handleTaskClick = (task: any) => {
    // If it's a DRAFT_TERM_LETTER task with a letter, open the letter modal
    if (task.type === 'DRAFT_TERM_LETTER') {
      const letterId = taskLetterMap.get(task.id);
      if (letterId) {
        setSelectedLetterId(letterId);
        return;
      }
    }
    // Otherwise open the status update modal
    setSelectedTask(task);
  };

  const pendingCount = tasks.filter((t) => t.status === 'PENDING').length;

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 bg-gray-200 rounded-lg"></div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-red-600 p-4 bg-red-50 rounded-lg">
        Failed to load tasks. Please try again.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium text-gray-900">
            Termination Tasks
            {pendingCount > 0 && (
              <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                {pendingCount} pending
              </span>
            )}
          </h3>
          <p className="text-sm text-gray-500">
            Track termination workflow tasks for this provider
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          {STATUS_FILTER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          {TYPE_FILTER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Task List */}
      {tasks.length === 0 ? (
        <EmptyState
          illustration="clipboard"
          title="No Tasks"
          description={statusFilter || typeFilter
            ? 'No tasks match the current filters.'
            : 'Tasks will appear here when a termination date is set on an enrollment.'}
        />
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50/80">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Task
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Payer
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Assigned To
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Due Date
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {tasks.map((task: any) => {
                const statusCfg = TASK_STATUS_CONFIG[task.status] || TASK_STATUS_CONFIG.PENDING;
                const typeCfg = TASK_TYPE_CONFIG[task.type] || { label: task.type };
                const hasLetter = task.type === 'DRAFT_TERM_LETTER' && taskLetterMap.has(task.id);

                return (
                  <tr
                    key={task.id}
                    onClick={() => handleTaskClick(task)}
                    className={clsx(
                      'hover:bg-gray-50 cursor-pointer',
                      hasLetter && 'hover:bg-primary-50'
                    )}
                  >
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{task.title}</div>
                      {hasLetter && (
                        <span className="text-xs text-primary-600">Click to view letter</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {task.enrollment?.payer?.name || '—'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {typeCfg.label}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusCfg.color}`}>
                        {statusCfg.label}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {task.assignedTo
                        ? `${task.assignedTo.firstName} ${task.assignedTo.lastName}`
                        : '—'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {task.dueDate
                        ? new Date(task.dueDate).toLocaleDateString()
                        : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Task Status Update Modal */}
      {selectedTask && (
        <TaskStatusUpdateModal
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
        />
      )}

      {/* Termination Letter Modal */}
      {selectedLetterId && (
        <TerminationLetterModal
          letterId={selectedLetterId}
          onClose={() => setSelectedLetterId(null)}
        />
      )}
    </div>
  );
}
