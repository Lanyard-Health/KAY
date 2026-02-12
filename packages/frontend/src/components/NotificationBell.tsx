import { Fragment } from 'react';
import { Popover, Transition } from '@headlessui/react';
import { BellIcon } from '@heroicons/react/24/outline';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import clsx from 'clsx';
import { useAuthStore } from '../stores/auth.store';
import {
  useUnreadNotificationCount,
  useNotifications,
  useMarkNotificationsRead,
} from '../hooks/useNotifications';
import type { InAppNotification } from '../hooks/useNotifications';

export default function NotificationBell() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { data: unreadCount = 0 } = useUnreadNotificationCount();
  const { data: notificationData } = useNotifications({ limit: 10 });
  const markRead = useMarkNotificationsRead();

  const notifications = notificationData?.notifications ?? [];
  const isProvider = user?.role === 'provider';
  const allNotificationsPath = isProvider ? '/portal/notifications' : '/notifications';

  const handleNotificationClick = (notification: InAppNotification, close: () => void) => {
    if (!notification.read) {
      markRead.mutate([notification.id]);
    }
    if (notification.actionUrl) {
      navigate(notification.actionUrl);
    }
    close();
  };

  const handleMarkAllRead = () => {
    markRead.mutate(undefined);
  };

  return (
    <Popover className="relative">
      {({ close }) => (
        <>
          <Popover.Button className="relative rounded-full p-1.5 text-gray-500 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2">
            <span className="sr-only">View notifications</span>
            <BellIcon className="h-6 w-6" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white ring-2 ring-white min-w-[18px] h-[18px] px-1">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </Popover.Button>

          <Transition
            as={Fragment}
            enter="transition ease-out duration-200"
            enterFrom="opacity-0 translate-y-1"
            enterTo="opacity-100 translate-y-0"
            leave="transition ease-in duration-150"
            leaveFrom="opacity-100 translate-y-0"
            leaveTo="opacity-0 translate-y-1"
          >
            <Popover.Panel className="absolute right-0 z-50 mt-2 w-80 sm:w-96 origin-top-right rounded-2xl bg-white/95 backdrop-blur-xl shadow-lg ring-1 ring-gray-900/5 focus:outline-none">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-900">Notifications</h3>
                {unreadCount > 0 && (
                  <button
                    onClick={handleMarkAllRead}
                    className="text-xs font-medium text-primary-600 hover:text-primary-700"
                  >
                    Mark all read
                  </button>
                )}
              </div>

              {/* Notification list */}
              <div className="max-h-96 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 px-4">
                    <BellIcon className="h-10 w-10 text-gray-300 mb-2" />
                    <p className="text-sm text-gray-500">No notifications yet</p>
                  </div>
                ) : (
                  <ul className="divide-y divide-gray-50">
                    {notifications.map((notification) => (
                      <li key={notification.id}>
                        <button
                          onClick={() => handleNotificationClick(notification, close)}
                          className={clsx(
                            'w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors',
                            !notification.read && 'bg-primary-50/40'
                          )}
                        >
                          <div className="flex gap-3">
                            {/* Unread dot */}
                            <div className="flex-shrink-0 pt-1.5">
                              <div
                                className={clsx(
                                  'h-2 w-2 rounded-full',
                                  notification.read ? 'bg-transparent' : 'bg-primary-500'
                                )}
                              />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">
                                {notification.title}
                              </p>
                              <p className="text-xs text-gray-500 line-clamp-2 mt-0.5">
                                {notification.message}
                              </p>
                              <p className="text-xs text-gray-400 mt-1">
                                {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                              </p>
                            </div>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Footer */}
              {notifications.length > 0 && (
                <div className="border-t border-gray-100 px-4 py-2">
                  <button
                    onClick={() => {
                      navigate(allNotificationsPath);
                      close();
                    }}
                    className="w-full text-center text-xs font-medium text-primary-600 hover:text-primary-700 py-1"
                  >
                    View all notifications
                  </button>
                </div>
              )}
            </Popover.Panel>
          </Transition>
        </>
      )}
    </Popover>
  );
}
