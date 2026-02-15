import { Fragment, useState } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { Dialog, Menu, Transition } from '@headlessui/react';
import {
  Bars3Icon,
  HomeIcon,
  UsersIcon,
  DocumentDuplicateIcon,
  ClockIcon,
  ClipboardDocumentListIcon,
  ClipboardDocumentCheckIcon,
  TableCellsIcon,
  SparklesIcon,
  ChartBarSquareIcon,
  UserPlusIcon,
  BuildingOffice2Icon,
  UserGroupIcon,
  ArrowUpTrayIcon,
} from '@heroicons/react/24/outline';
import { ChevronDownIcon } from '@heroicons/react/20/solid';
import clsx from 'clsx';
import { useAuthStore } from '../stores/auth.store';
import NotificationBell from './NotificationBell';

const allNavigation = [
  { name: 'Dashboard', href: '/', icon: HomeIcon },
  { name: 'Providers', href: '/providers', icon: UsersIcon },
  { name: 'Import Providers', href: '/providers/import', icon: ArrowUpTrayIcon },
  { name: 'Practices', href: '/practices', icon: BuildingOffice2Icon },
  { name: 'Users', href: '/users', icon: UserGroupIcon },
  { name: 'Enrollments', href: '/enrollments', icon: ClipboardDocumentListIcon },
  { name: 'Documents', href: '/documents', icon: DocumentDuplicateIcon },
  { name: 'Expirations', href: '/expirations', icon: ClockIcon },
  { name: 'Roster', href: '/roster', icon: TableCellsIcon },
  { name: 'AI Agent', href: '/ai-agent', icon: SparklesIcon },
  { name: 'Payer Intelligence', href: '/payer-intelligence', icon: ChartBarSquareIcon },
  { name: 'Pending Providers', href: '/pending-providers', icon: UserPlusIcon },
  { name: 'Onboarding', href: '/onboarding-progress', icon: ClipboardDocumentCheckIcon },
];

// Items hidden from practice_admin role
const practiceAdminHidden = new Set([
  'Practices', 'Users', 'AI Agent', 'Payer Intelligence',
  'Pending Providers', 'Onboarding', 'Roster',
]);

// Items only visible to practice_admin role
const practiceAdminOnly = new Set(['Import Providers']);

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();

  const navigation = user?.role === 'practice_admin'
    ? allNavigation.filter((item) => !practiceAdminHidden.has(item.name))
    : allNavigation.filter((item) => !practiceAdminOnly.has(item.name));

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="h-full">
      {/* Mobile sidebar */}
      <Transition.Root show={sidebarOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50 lg:hidden" onClose={setSidebarOpen}>
          <Transition.Child
            as={Fragment}
            enter="transition-opacity ease-linear duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="transition-opacity ease-linear duration-300"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-gray-900/80" />
          </Transition.Child>

          <div className="fixed inset-0 flex">
            <Transition.Child
              as={Fragment}
              enter="transition ease-in-out duration-300 transform"
              enterFrom="-translate-x-full"
              enterTo="translate-x-0"
              leave="transition ease-in-out duration-300 transform"
              leaveFrom="translate-x-0"
              leaveTo="-translate-x-full"
            >
              <Dialog.Panel className="relative mr-16 flex w-full max-w-xs flex-1">
                <div className="flex grow flex-col gap-y-5 overflow-y-auto bg-gradient-to-b from-primary-700 to-primary-800 px-6 pb-4">
                  <div className="flex h-16 shrink-0 items-center">
                    <span className="text-white text-xl font-bold">Lanyard Health</span>
                  </div>
                  <nav className="flex flex-1 flex-col">
                    <ul role="list" className="flex flex-1 flex-col gap-y-7">
                      <li>
                        <ul role="list" className="-mx-2 space-y-1">
                          {navigation.map((item) => (
                            <li key={item.name}>
                              <Link
                                to={item.href}
                                className={clsx(
                                  location.pathname === item.href
                                    ? 'bg-white/10 text-white'
                                    : 'text-primary-100/70 hover:text-white hover:bg-white/10',
                                  'group flex gap-x-3 rounded-xl p-2 text-sm leading-6 font-medium transition-all duration-200'
                                )}
                              >
                                <item.icon className="h-6 w-6 shrink-0" />
                                {item.name}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </li>
                    </ul>
                  </nav>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </Dialog>
      </Transition.Root>

      {/* Desktop sidebar */}
      <div className="hidden lg:fixed lg:inset-y-0 lg:z-50 lg:flex lg:w-72 lg:flex-col">
        <div className="flex grow flex-col gap-y-5 overflow-y-auto bg-gradient-to-b from-primary-700 to-primary-800 px-6 pb-4">
          <div className="flex h-16 shrink-0 items-center">
            <span className="text-white text-xl font-bold">Lanyard Health</span>
          </div>
          <nav className="flex flex-1 flex-col">
            <ul role="list" className="flex flex-1 flex-col gap-y-7">
              <li>
                <ul role="list" className="-mx-2 space-y-1">
                  {navigation.map((item) => (
                    <li key={item.name}>
                      <Link
                        to={item.href}
                        className={clsx(
                          location.pathname === item.href
                            ? 'bg-white/10 text-white'
                            : 'text-primary-100/70 hover:text-white hover:bg-white/10',
                          'group flex gap-x-3 rounded-xl p-2 text-sm leading-6 font-medium transition-all duration-200'
                        )}
                      >
                        <item.icon className="h-6 w-6 shrink-0" />
                        {item.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            </ul>
          </nav>
        </div>
      </div>

      {/* Main content */}
      <div className="lg:pl-72">
        {/* Top navigation */}
        <div className="sticky top-0 z-40 flex h-16 shrink-0 items-center gap-x-4 border-b border-gray-200/60 bg-white/80 backdrop-blur-xl px-4 shadow-sm sm:gap-x-6 sm:px-6 lg:px-8">
          <button
            type="button"
            className="-m-2.5 p-2.5 text-gray-700 lg:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <Bars3Icon className="h-6 w-6" />
          </button>

          <div className="flex flex-1 gap-x-4 self-stretch lg:gap-x-6">
            <div className="flex flex-1" />
            <div className="flex items-center gap-x-4 lg:gap-x-6">
              <NotificationBell />
              <div className="hidden lg:block lg:h-6 lg:w-px lg:bg-gray-200" />
              {/* User menu */}
              <Menu as="div" className="relative">
                <Menu.Button className="-m-1.5 flex items-center p-1.5">
                  <span className="sr-only">Open user menu</span>
                  <div className="h-8 w-8 rounded-full bg-primary-600 flex items-center justify-center">
                    <span className="text-white text-sm font-medium">
                      {user?.firstName?.[0]}{user?.lastName?.[0]}
                    </span>
                  </div>
                  <span className="hidden lg:flex lg:items-center">
                    <span className="ml-4 text-sm font-semibold leading-6 text-gray-900">
                      {user?.firstName} {user?.lastName}
                    </span>
                    <ChevronDownIcon className="ml-2 h-5 w-5 text-gray-400" />
                  </span>
                </Menu.Button>
                <Transition
                  as={Fragment}
                  enter="transition ease-out duration-200"
                  enterFrom="transform opacity-0 scale-95"
                  enterTo="transform opacity-100 scale-100"
                  leave="transition ease-in duration-150"
                  leaveFrom="transform opacity-100 scale-100"
                  leaveTo="transform opacity-0 scale-95"
                >
                  <Menu.Items className="absolute right-0 z-10 mt-2.5 w-32 origin-top-right rounded-xl bg-white/80 backdrop-blur-xl py-2 shadow-lg ring-1 ring-gray-900/5 focus:outline-none">
                    <Menu.Item>
                      {({ active }) => (
                        <button
                          onClick={handleLogout}
                          className={clsx(
                            active ? 'bg-gray-50' : '',
                            'block w-full text-left px-3 py-1 text-sm leading-6 text-gray-900'
                          )}
                        >
                          Sign out
                        </button>
                      )}
                    </Menu.Item>
                  </Menu.Items>
                </Transition>
              </Menu>
            </div>
          </div>
        </div>

        {/* Page content */}
        <main className="py-8 min-h-[calc(100vh-4rem-4rem)]">
          <div className="px-4 sm:px-6 lg:px-8">
            <Outlet />
          </div>
        </main>

        {/* Footer */}
        <footer className="border-t border-gray-100 bg-white py-4">
          <div className="px-4 sm:px-6 lg:px-8 text-center text-sm text-gray-500">
            Copyright 2026 Lanyard Health
          </div>
        </footer>
      </div>
    </div>
  );
}
