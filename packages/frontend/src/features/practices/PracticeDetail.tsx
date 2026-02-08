import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Tab } from '@headlessui/react';
import { ArrowLeftIcon, PencilIcon, UserGroupIcon, UsersIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';
import { usePractice } from '../../hooks/usePractices';
import PracticeFormModal from './PracticeFormModal';
import PracticeUsersTab from './PracticeUsersTab';
import PracticeProvidersTab from './PracticeProvidersTab';

const TABS = [
  { name: 'Users', icon: UserGroupIcon },
  { name: 'Providers', icon: UsersIcon },
];

export default function PracticeDetail() {
  const { practiceId } = useParams();
  const { data: practice, isLoading } = usePractice(practiceId!);
  const [editModalOpen, setEditModalOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-2 border-gray-200 border-t-primary-600" />
      </div>
    );
  }

  if (!practice) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Practice not found</p>
        <Link to="/practices" className="text-primary-600 hover:underline mt-2 inline-block">
          Back to practices
        </Link>
      </div>
    );
  }

  return (
    <div>
      {/* Back link */}
      <Link
        to="/practices"
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-6"
      >
        <ArrowLeftIcon className="h-4 w-4 mr-1" />
        Back to Practices
      </Link>

      {/* Header */}
      <div className="sm:flex sm:items-center sm:justify-between mb-8">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">{practice.name}</h1>
            <span
              className={clsx(
                'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                practice.status === 'ACTIVE'
                  ? 'bg-green-100 text-green-800'
                  : 'bg-gray-100 text-gray-600'
              )}
            >
              {practice.status}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 text-sm text-gray-500">
            {practice.phone && <span>{practice.phone}</span>}
            {practice.email && <span>{practice.email}</span>}
            {practice.website && (
              <a
                href={practice.website.startsWith('http') ? practice.website : `https://${practice.website}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-600 hover:text-primary-500"
              >
                {practice.website}
              </a>
            )}
          </div>
        </div>
        <button
          onClick={() => setEditModalOpen(true)}
          className="btn-secondary mt-4 sm:mt-0"
        >
          <PencilIcon className="-ml-1 mr-2 h-5 w-5" />
          Edit
        </button>
      </div>

      {/* Tabs */}
      <Tab.Group>
        <Tab.List className="flex space-x-4 border-b border-gray-200 mb-6">
          {TABS.map((tab) => (
            <Tab
              key={tab.name}
              className={({ selected }) =>
                clsx(
                  'flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px focus:outline-none',
                  selected
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                )
              }
            >
              <tab.icon className="h-5 w-5" />
              {tab.name}
            </Tab>
          ))}
        </Tab.List>

        <Tab.Panels>
          <Tab.Panel>
            <PracticeUsersTab practiceId={practiceId!} />
          </Tab.Panel>
          <Tab.Panel>
            <PracticeProvidersTab practiceId={practiceId!} />
          </Tab.Panel>
        </Tab.Panels>
      </Tab.Group>

      <PracticeFormModal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        practice={practice}
      />
    </div>
  );
}
