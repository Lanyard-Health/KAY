import { Tab } from '@headlessui/react';
import {
  UserCircleIcon,
  BuildingOffice2Icon,
  ClipboardDocumentListIcon,
  UsersIcon,
  PuzzlePieceIcon,
  BellIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';
import { useAuthStore } from '../../stores/auth.store';
import PageTransition from '../../components/ui/PageTransition';
import UserProfileTab from './UserProfileTab';
import PracticeProfileTab from './PracticeProfileTab';
import PermissionsTab from './PermissionsTab';
import IntegrationsTab from './IntegrationsTab';
import NotificationsTab from './NotificationsTab';
import ClinicalProfileTab from './ClinicalProfileTab';

const ALL_TABS = [
  { key: 'profile', label: 'User Profile', icon: UserCircleIcon, restrictedTo: null },
  { key: 'practice', label: 'Practice', icon: BuildingOffice2Icon, restrictedTo: ['admin', 'practice_admin'] },
  { key: 'clinical-profile', label: 'Clinical Profile', icon: ClipboardDocumentListIcon, restrictedTo: ['admin', 'practice_admin'] },
  { key: 'permissions', label: 'Permissions', icon: UsersIcon, restrictedTo: ['admin', 'practice_admin'] },
  { key: 'integrations', label: 'Integrations', icon: PuzzlePieceIcon, restrictedTo: ['admin', 'practice_admin'] },
  { key: 'notifications', label: 'Notifications', icon: BellIcon, restrictedTo: null },
] as const;

export default function Settings() {
  const user = useAuthStore((s) => s.user);
  const role = user?.role;

  const visibleTabs = ALL_TABS.filter(
    (tab) => !tab.restrictedTo || (role && (tab.restrictedTo as readonly string[]).includes(role))
  );

  return (
    <PageTransition>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage your account, practice profile, and preferences
          </p>
        </div>

        <Tab.Group>
          <Tab.List className="flex space-x-1 border-b border-gray-200">
            {visibleTabs.map((tab) => (
              <Tab
                key={tab.key}
                className={({ selected }) =>
                  clsx(
                    'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors outline-none',
                    selected
                      ? 'border-primary-600 text-primary-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
                  )
                }
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </Tab>
            ))}
          </Tab.List>

          <Tab.Panels className="mt-6">
            {visibleTabs.map((tab) => (
              <Tab.Panel key={tab.key}>
                {tab.key === 'profile' && <UserProfileTab />}
                {tab.key === 'practice' && <PracticeProfileTab />}
                {tab.key === 'clinical-profile' && <ClinicalProfileTab />}
                {tab.key === 'permissions' && <PermissionsTab />}
                {tab.key === 'integrations' && <IntegrationsTab />}
                {tab.key === 'notifications' && <NotificationsTab />}
              </Tab.Panel>
            ))}
          </Tab.Panels>
        </Tab.Group>
      </div>
    </PageTransition>
  );
}
