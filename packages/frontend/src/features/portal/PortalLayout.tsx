import { Fragment, useState } from 'react';
import { Suspense } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { Dialog, Menu, Transition } from '@headlessui/react';
import {
  Bars3Icon,
  HomeIcon,
  UserIcon,
  ShieldCheckIcon,
  MapPinIcon,
  DocumentDuplicateIcon,
  LockClosedIcon,
} from '@heroicons/react/24/outline';
import { PortalArchiveContext } from './PortalArchiveContext';
import { ChevronDownIcon } from '@heroicons/react/20/solid';
import clsx from 'clsx';
import { useAuthStore } from '../../stores/auth.store';
import NotificationBell from '../../components/NotificationBell';
import { useProfileCompleteness, useCurrentProvider } from './hooks/usePortalData';

const navigation = [
  { name: 'Dashboard', href: '/portal', icon: HomeIcon },
  { name: 'Profile', href: '/portal/profile', icon: UserIcon },
  { name: 'Documents', href: '/portal/documents', icon: DocumentDuplicateIcon },
  { name: 'Licenses', href: '/portal/licenses', icon: ShieldCheckIcon },
  { name: 'Locations', href: '/portal/locations', icon: MapPinIcon },
];

export default function PortalLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { data: completeness } = useProfileCompleteness();
  const { data: providerData } = useCurrentProvider();
  const provider = (providerData as any)?.data?.provider;
  // Q3 banner: backend /portal/me sets `isArchived` as a top-level flag. If absent
  // (older response shape during deploy), fall back to checking provider.deletedAt.
  const isArchived = Boolean(
    (providerData as any)?.data?.isArchived ?? (provider?.deletedAt ?? null)
  );

  const percentage = (completeness as any)?.data?.percentage ?? 0;

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const isActive = (href: string) => {
    if (href === '/portal') return location.pathname === '/portal';
    return location.pathname.startsWith(href);
  };

  const sidebarBrand = (
    <div className="flex h-16 shrink-0 items-center">
      <div className="flex flex-col items-start">
        <img src="/logo-full.svg" alt="Lanyard Health" className="h-10 brightness-0 invert" />
        <span className="text-primary-200/50 text-[11px] mt-1.5 tracking-widest uppercase font-medium">Provider Portal</span>
      </div>
    </div>
  );

  const sidebarOrbs = (
    <>
      <div className="absolute top-[20%] -right-10 w-32 h-32 rounded-full bg-white/[0.04] blur-2xl" />
      <div className="absolute bottom-[30%] -left-8 w-24 h-24 rounded-full bg-emerald-300/[0.05] blur-xl" />
    </>
  );

  const sidebarProgress = (
    <div className="px-2 py-3 border-t border-white/[0.08]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] text-primary-200/50 uppercase tracking-wider font-medium">Completeness</span>
        <span className="text-xs text-white font-semibold">{percentage}%</span>
      </div>
      <div className="w-full bg-white/[0.08] rounded-full h-1.5">
        <div
          className="h-1.5 rounded-full transition-all duration-500 bg-gradient-to-r from-emerald-400 to-emerald-300"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );

  const sidebarNav = (
    <nav className="flex flex-col mt-4">
      <ul role="list" className="flex flex-col gap-y-1">
        {navigation.map((item) => (
          <li key={item.name}>
            <Link
              to={item.href}
              onClick={() => setSidebarOpen(false)}
              className={clsx(
                isActive(item.href)
                  ? 'bg-white/[0.12] text-white shadow-sm shadow-black/10 backdrop-blur-sm border border-white/[0.08]'
                  : 'text-primary-100/60 hover:text-white hover:bg-white/[0.06]',
                'group flex gap-x-3 rounded-xl p-2.5 px-3 text-sm leading-6 font-medium transition-all duration-200'
              )}
            >
              <item.icon className="h-6 w-6 shrink-0" />
              {item.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );

  const sidebarProviderInfo = provider ? (
    <div className="mt-auto pt-4 border-t border-white/[0.08]">
      <div className="flex items-center gap-3 px-2">
        <div className="w-8 h-8 rounded-full bg-white/[0.12] border border-white/[0.08] flex items-center justify-center text-white text-xs font-semibold shrink-0">
          {provider.firstName?.[0]}{provider.lastName?.[0]}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-white truncate">{provider.firstName} {provider.lastName}</p>
          <p className="text-[11px] text-primary-200/40">NPI {provider.npi}</p>
        </div>
      </div>
    </div>
  ) : null;

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
                <div className="flex grow flex-col overflow-y-auto relative overflow-hidden bg-gradient-to-b from-primary-700 to-primary-800 px-6 pb-4">
                  {sidebarOrbs}
                  {sidebarBrand}
                  {sidebarProgress}
                  {sidebarNav}
                  {sidebarProviderInfo}
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </Dialog>
      </Transition.Root>

      {/* Desktop sidebar */}
      <div className="hidden lg:fixed lg:inset-y-0 lg:z-50 lg:flex lg:w-72 lg:flex-col">
        <div className="flex grow flex-col overflow-y-auto relative overflow-hidden bg-gradient-to-b from-primary-700 to-primary-800 px-6 pb-4">
          {sidebarOrbs}
          {sidebarBrand}
          {sidebarProgress}
          {sidebarNav}
          {sidebarProviderInfo}
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
                  enter="transition ease-out duration-100"
                  enterFrom="transform opacity-0 scale-95"
                  enterTo="transform opacity-100 scale-100"
                  leave="transition ease-in duration-75"
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

        {/* Archived-self banner (Q3): identity preserved, writes refused.
            Backend gates writes at 423 too — this is the UX so it isn't a silent wall. */}
        {isArchived && (
          <div
            role="status"
            aria-live="polite"
            className="border-b border-amber-200 bg-amber-50 px-4 sm:px-6 lg:px-8 py-3 flex items-start gap-3"
          >
            <LockClosedIcon className="h-5 w-5 text-amber-700 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-900">
              <p className="font-semibold">This profile is no longer active.</p>
              <p className="mt-0.5">
                Contact your practice administrator to restore access. You can still view your
                information, but changes are disabled.
              </p>
            </div>
          </div>
        )}

        {/* Page content */}
        <main className="py-8 min-h-[calc(100vh-4rem-4rem)]">
          <div className="px-4 sm:px-6 lg:px-8">
            <Suspense fallback={<div className="animate-pulse space-y-4 py-4"><div className="h-8 bg-gray-100 rounded w-1/3" /><div className="h-64 bg-gray-50 rounded" /></div>}>
              <PortalArchiveContext.Provider value={{ isArchived }}>
                <Outlet />
              </PortalArchiveContext.Provider>
            </Suspense>
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
