import { Fragment, useState, useCallback } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { Dialog, Disclosure, Menu, Transition } from '@headlessui/react';
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
  Cog6ToothIcon,
  QueueListIcon,
  ChartBarIcon,
  WrenchScrewdriverIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/20/solid';
import clsx from 'clsx';
import { useAuthStore } from '../stores/auth.store';
import NotificationBell from './NotificationBell';
import CommandPalette from './ui/CommandPalette';
import { useSearch } from '../hooks/useSearch';

// ──────────────────────────────────────────────
// Nav group definitions
// ──────────────────────────────────────────────

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const customerNavGroups: NavGroup[] = [
  {
    label: 'Core',
    items: [
      { name: 'Dashboard', href: '/', icon: HomeIcon },
      { name: 'Providers', href: '/providers', icon: UsersIcon },
      { name: 'Enrollments', href: '/enrollments', icon: ClipboardDocumentListIcon },
    ],
  },
  {
    label: 'Operations',
    items: [
      { name: 'Documents', href: '/documents', icon: DocumentDuplicateIcon },
      { name: 'Expirations', href: '/expirations', icon: ClockIcon },
      { name: 'Roster', href: '/roster', icon: TableCellsIcon },
      { name: 'Payer Intelligence', href: '/payer-intelligence', icon: ChartBarSquareIcon },
    ],
  },
  {
    label: 'AI & Automation',
    items: [
      { name: 'AI Agent', href: '/ai-agent', icon: SparklesIcon },
    ],
  },
  {
    label: 'Admin',
    items: [
      { name: 'Practices', href: '/practices', icon: BuildingOffice2Icon },
      { name: 'Users', href: '/users', icon: UserGroupIcon },
      { name: 'Pending Providers', href: '/pending-providers', icon: UserPlusIcon },
      { name: 'Onboarding', href: '/onboarding-progress', icon: ClipboardDocumentCheckIcon },
      { name: 'Import Providers', href: '/providers/import', icon: ArrowUpTrayIcon },
    ],
  },
];

const opsNavGroups: NavGroup[] = [
  {
    label: 'Operations',
    items: [
      { name: 'Ops Dashboard', href: '/ops', icon: HomeIcon },
      { name: 'Work Queue', href: '/ops/work-queue', icon: QueueListIcon },
      { name: 'All Practices', href: '/ops/practices', icon: BuildingOffice2Icon },
      { name: 'Staff', href: '/ops/staff', icon: UserGroupIcon },
      { name: 'SLA Tracker', href: '/ops/sla', icon: ChartBarIcon },
      { name: 'Activity Log', href: '/ops/activity', icon: ClipboardDocumentListIcon },
    ],
  },
];

// Items hidden from practice_admin role
const practiceAdminHidden = new Set([
  'Practices', 'Users', 'AI Agent', 'Payer Intelligence',
  'Pending Providers', 'Onboarding', 'Roster', 'Import Providers',
]);

// Items only visible to practice_admin role
const practiceAdminOnly = new Set(['Import Providers']);

function filterNavGroups(groups: NavGroup[], role: string | undefined): NavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (role === 'practice_admin') return !practiceAdminHidden.has(item.name);
        return !practiceAdminOnly.has(item.name);
      }),
    }))
    .filter((group) => group.items.length > 0);
}

// ──────────────────────────────────────────────
// Sidebar nav group component
// ──────────────────────────────────────────────

function SidebarNavGroup({ group, pathname }: { group: NavGroup; pathname: string }) {
  const hasActive = group.items.some((item) => item.href === pathname);

  return (
    <Disclosure as="div" defaultOpen={hasActive || group.label === 'Core' || group.label === 'Operations'}>
      {({ open }) => (
        <>
          <Disclosure.Button className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-primary-200/60 hover:text-primary-100/80 transition-colors">
            {group.label}
            <ChevronRightIcon
              className={clsx('h-4 w-4 transition-transform', open && 'rotate-90')}
            />
          </Disclosure.Button>
          <Disclosure.Panel as="ul" className="space-y-0.5 mt-1">
            {group.items.map((item) => (
              <li key={item.name}>
                <Link
                  to={item.href}
                  className={clsx(
                    pathname === item.href
                      ? 'bg-white/10 text-white'
                      : 'text-primary-100/70 hover:text-white hover:bg-white/10',
                    'group flex gap-x-3 rounded-xl p-2 text-sm leading-6 font-medium transition-all duration-200',
                  )}
                >
                  <item.icon className="h-5 w-5 shrink-0" />
                  {item.name}
                </Link>
              </li>
            ))}
          </Disclosure.Panel>
        </>
      )}
    </Disclosure>
  );
}

// ──────────────────────────────────────────────
// Ops Mode Toggle
// ──────────────────────────────────────────────

function OpsModeToggle() {
  const { isOpsMode, toggleOpsMode } = useAuthStore();

  return (
    <button
      onClick={toggleOpsMode}
      className={clsx(
        'flex items-center gap-2 w-full rounded-xl px-3 py-2 text-sm font-medium transition-all duration-200',
        isOpsMode
          ? 'bg-amber-500/20 text-amber-200 hover:bg-amber-500/30'
          : 'bg-white/5 text-primary-200/70 hover:bg-white/10 hover:text-white',
      )}
    >
      {isOpsMode ? (
        <WrenchScrewdriverIcon className="h-5 w-5" />
      ) : (
        <Cog6ToothIcon className="h-5 w-5" />
      )}
      {isOpsMode ? 'Ops Mode' : 'Customer Mode'}
    </button>
  );
}

// ──────────────────────────────────────────────
// Practice Context Banner
// ──────────────────────────────────────────────

function PracticeContextBanner() {
  const { opsPracticeContext, exitPracticeContext } = useAuthStore();
  if (!opsPracticeContext) return null;

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between">
      <span className="text-sm text-amber-800">
        Viewing as: <strong>{opsPracticeContext.name}</strong>
      </span>
      <button
        onClick={exitPracticeContext}
        className="text-sm font-medium text-amber-700 hover:text-amber-900 flex items-center gap-1"
      >
        <XMarkIcon className="h-4 w-4" />
        Exit
      </button>
    </div>
  );
}

// ──────────────────────────────────────────────
// Sidebar content (shared between mobile & desktop)
// ──────────────────────────────────────────────

function SidebarContent({ pathname, role }: { pathname: string; role: string | undefined }) {
  const { isOpsMode, user } = useAuthStore();
  const canToggleOps = user?.role === 'admin' || user?.role === 'ops_staff';
  const activeGroups = isOpsMode && canToggleOps
    ? opsNavGroups
    : filterNavGroups(customerNavGroups, role);

  return (
    <div className="flex grow flex-col gap-y-5 overflow-y-auto bg-gradient-to-b from-primary-700 to-primary-800 px-6 pb-4">
      <div className="flex h-16 shrink-0 items-center">
        <span className="text-white text-xl font-bold">Lanyard Health</span>
      </div>

      {canToggleOps && (
        <div className="-mx-2">
          <OpsModeToggle />
        </div>
      )}

      <nav className="flex flex-1 flex-col">
        <ul role="list" className="flex flex-1 flex-col gap-y-4">
          <li>
            <div className="-mx-2 space-y-3">
              {activeGroups.map((group) => (
                <SidebarNavGroup key={group.label} group={group} pathname={pathname} />
              ))}
            </div>
          </li>
        </ul>
      </nav>
    </div>
  );
}

// ──────────────────────────────────────────────
// Main Layout
// ──────────────────────────────────────────────

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { search } = useSearch();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const handleSearchSelect = useCallback(
    (result: { url: string }) => {
      navigate(result.url);
    },
    [navigate],
  );

  return (
    <div className="h-full">
      <CommandPalette onSearch={search} onSelect={handleSearchSelect} />
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
                <SidebarContent pathname={location.pathname} role={user?.role} />
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </Dialog>
      </Transition.Root>

      {/* Desktop sidebar */}
      <div className="hidden lg:fixed lg:inset-y-0 lg:z-50 lg:flex lg:w-72 lg:flex-col">
        <SidebarContent pathname={location.pathname} role={user?.role} />
      </div>

      {/* Main content */}
      <div className="lg:pl-72">
        {/* Practice context banner */}
        <PracticeContextBanner />

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
            {/* Cmd+K hint */}
            <div className="flex flex-1 items-center">
              <button
                onClick={() => {
                  document.dispatchEvent(
                    new KeyboardEvent('keydown', { key: 'k', metaKey: true }),
                  );
                }}
                className="hidden sm:flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50/50 px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-100 transition-colors"
              >
                <span>Search...</span>
                <kbd className="rounded border border-gray-200 px-1.5 text-xs font-mono">
                  ⌘K
                </kbd>
              </button>
            </div>
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
                            'block w-full text-left px-3 py-1 text-sm leading-6 text-gray-900',
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
