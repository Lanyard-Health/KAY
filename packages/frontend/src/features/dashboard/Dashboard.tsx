import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  UsersIcon,
  DocumentDuplicateIcon,
  ClockIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { api } from '../../services/api';
import clsx from 'clsx';

interface DashboardStats {
  totalProviders: number;
  activeProviders: number;
  totalDocuments: number;
  expiring30Days: number;
  expired: number;
}

const stats = [
  { name: 'Total Providers', key: 'totalProviders', icon: UsersIcon, href: '/providers', color: 'bg-blue-500' },
  { name: 'Active Providers', key: 'activeProviders', icon: UsersIcon, href: '/providers?status=active', color: 'bg-green-500' },
  { name: 'Documents', key: 'totalDocuments', icon: DocumentDuplicateIcon, href: '/documents', color: 'bg-purple-500' },
  { name: 'Expiring (30 days)', key: 'expiring30Days', icon: ClockIcon, href: '/expirations', color: 'bg-yellow-500' },
  { name: 'Expired', key: 'expired', icon: ExclamationTriangleIcon, href: '/expirations?status=expired', color: 'bg-red-500' },
];

export default function Dashboard() {
  const { data: dashboardData, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const [providersRes, expirationsRes] = await Promise.all([
        api.get('/providers?pageSize=1'),
        api.get('/expirations/dashboard'),
      ]);

      return {
        totalProviders: providersRes.data.data.total || 0,
        activeProviders: providersRes.data.data.total || 0, // Would filter by status
        totalDocuments: 0, // Would come from documents endpoint
        expiring30Days: expirationsRes.data.data.expiring30Days || 0,
        expired: expirationsRes.data.data.expired || 0,
      } as DashboardStats;
    },
  });

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          Overview of your credentialing management system
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-5">
        {stats.map((item) => (
          <Link
            key={item.name}
            to={item.href}
            className="relative overflow-hidden rounded-lg bg-white px-4 py-5 shadow hover:shadow-md transition-shadow sm:px-6 sm:py-6"
          >
            <dt>
              <div className={clsx('absolute rounded-md p-3', item.color)}>
                <item.icon className="h-6 w-6 text-white" aria-hidden="true" />
              </div>
              <p className="ml-16 truncate text-sm font-medium text-gray-500">
                {item.name}
              </p>
            </dt>
            <dd className="ml-16 flex items-baseline">
              <p className="text-2xl font-semibold text-gray-900">
                {isLoading ? '-' : dashboardData?.[item.key as keyof DashboardStats] || 0}
              </p>
            </dd>
          </Link>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Recent Providers */}
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <h3 className="text-lg font-medium text-gray-900">Recent Providers</h3>
            <Link
              to="/providers"
              className="text-sm font-medium text-primary-600 hover:text-primary-500"
            >
              View all
            </Link>
          </div>
          <div className="card-body">
            <p className="text-sm text-gray-500">
              No providers yet.{' '}
              <Link to="/providers/new" className="text-primary-600 hover:underline">
                Add your first provider
              </Link>
            </p>
          </div>
        </div>

        {/* Upcoming Expirations */}
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <h3 className="text-lg font-medium text-gray-900">Upcoming Expirations</h3>
            <Link
              to="/expirations"
              className="text-sm font-medium text-primary-600 hover:text-primary-500"
            >
              View all
            </Link>
          </div>
          <div className="card-body">
            <p className="text-sm text-gray-500">No upcoming expirations.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
