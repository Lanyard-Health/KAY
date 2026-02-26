import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageTransition from '../../components/ui/PageTransition';
import { BellIcon, CheckIcon } from '@heroicons/react/24/outline';
import { formatDistanceToNow } from 'date-fns';
import clsx from 'clsx';
import {
  useNotifications,
  useMarkNotificationsRead,
  useUnreadNotificationCount,
} from '../../hooks/useNotifications';

export default function NotificationsPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [page, setPage] = useState(0);
  const limit = 20;

  const { data: unreadCount = 0 } = useUnreadNotificationCount();
  const { data, isLoading } = useNotifications({
    unreadOnly: filter === 'unread',
    limit,
    offset: page * limit,
  });
  const markRead = useMarkNotificationsRead();

  const notifications = data?.notifications ?? [];
  const totalCount = data?.totalCount ?? 0;
  const totalPages = Math.ceil(totalCount / limit);

  const handleMarkAllRead = () => {
    markRead.mutate(undefined);
  };

  const handleMarkOneRead = (id: string) => {
    markRead.mutate([id]);
  };

  return (
    <PageTransition>
    <div>
      <div className="sm:flex sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
          <p className="mt-1 text-sm text-gray-500">
            Stay updated on applications, credentials, and system events.
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={handleMarkAllRead}
            className="mt-3 sm:mt-0 inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 transition-colors"
          >
            <CheckIcon className="h-4 w-4" />
            Mark all read
          </button>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1 w-fit mb-6">
        <button
          onClick={() => { setFilter('all'); setPage(0); }}
          className={clsx(
            'px-4 py-2 rounded-lg text-sm font-medium transition-all',
            filter === 'all'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          )}
        >
          All
        </button>
        <button
          onClick={() => { setFilter('unread'); setPage(0); }}
          className={clsx(
            'px-4 py-2 rounded-lg text-sm font-medium transition-all',
            filter === 'unread'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          )}
        >
          Unread{unreadCount > 0 ? ` (${unreadCount})` : ''}
        </button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-4 animate-pulse">
              <div className="flex gap-3">
                <div className="h-2 w-2 rounded-full bg-gray-200 mt-2" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-1/3" />
                  <div className="h-3 bg-gray-100 rounded w-2/3" />
                  <div className="h-3 bg-gray-100 rounded w-1/4" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && notifications.length === 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 py-16 text-center">
          <BellIcon className="mx-auto h-12 w-12 text-gray-300" />
          <h3 className="mt-3 text-sm font-medium text-gray-900">No notifications</h3>
          <p className="mt-1 text-sm text-gray-500">
            {filter === 'unread' ? "You're all caught up!" : 'Notifications will appear here.'}
          </p>
        </div>
      )}

      {/* Notification list */}
      {!isLoading && notifications.length > 0 && (
        <div className="space-y-2">
          {notifications.map((notification) => (
            <div
              key={notification.id}
              className={clsx(
                'bg-white rounded-2xl shadow-sm border border-gray-200/60 p-4 transition-colors',
                !notification.read && 'border-l-4 border-l-primary-500'
              )}
            >
              <div className="flex gap-3 items-start">
                {/* Unread dot */}
                <div className="flex-shrink-0 pt-1">
                  <div
                    className={clsx(
                      'h-2.5 w-2.5 rounded-full',
                      notification.read ? 'bg-gray-200' : 'bg-primary-500'
                    )}
                  />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      {notification.actionUrl ? (
                        <button
                          onClick={() => {
                            if (!notification.read) handleMarkOneRead(notification.id);
                            navigate(notification.actionUrl!);
                          }}
                          className="text-sm font-medium text-gray-900 hover:text-primary-600 text-left"
                        >
                          {notification.title}
                        </button>
                      ) : (
                        <p className="text-sm font-medium text-gray-900">{notification.title}</p>
                      )}
                      <p className="text-sm text-gray-500 mt-0.5">{notification.message}</p>
                      <p className="text-xs text-gray-400 mt-1">
                        {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                      </p>
                    </div>

                    {!notification.read && (
                      <button
                        onClick={() => handleMarkOneRead(notification.id)}
                        className="flex-shrink-0 text-xs text-gray-400 hover:text-primary-600 transition-colors"
                        title="Mark as read"
                      >
                        <CheckIcon className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-6">
          <p className="text-sm text-gray-500">
            Showing {page * limit + 1}–{Math.min((page + 1) * limit, totalCount)} of {totalCount}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= totalPages - 1}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
    </PageTransition>
  );
}
