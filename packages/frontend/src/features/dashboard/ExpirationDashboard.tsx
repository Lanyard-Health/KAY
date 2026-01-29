import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../services/api';
import clsx from 'clsx';

interface ExpiringCredential {
  id: string;
  type: 'license' | 'certification' | 'insurance' | 'document';
  name: string;
  expirationDate: string;
  daysUntilExpiration: number;
  providerId: string;
  providerName: string;
}

export default function ExpirationDashboard() {
  const { data: dashboard, isLoading: loadingDashboard } = useQuery({
    queryKey: ['expirations', 'dashboard'],
    queryFn: async () => {
      const response = await api.get('/expirations/dashboard');
      return response.data.data;
    },
  });

  const { data: expirations, isLoading: loadingExpirations } = useQuery({
    queryKey: ['expirations', 'list'],
    queryFn: async () => {
      const response = await api.get('/expirations?days=90');
      return response.data.data as ExpiringCredential[];
    },
  });

  const getUrgencyColor = (days: number) => {
    if (days <= 0) return 'text-red-600 bg-red-50';
    if (days <= 7) return 'text-red-600 bg-red-50';
    if (days <= 30) return 'text-yellow-600 bg-yellow-50';
    return 'text-green-600 bg-green-50';
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Expiration Tracking</h1>
        <p className="mt-1 text-sm text-gray-500">
          Monitor credential expirations and renewal deadlines
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <div className="card card-body">
          <p className="text-sm font-medium text-gray-500">Expiring in 7 Days</p>
          <p className="mt-1 text-3xl font-semibold text-red-600">
            {loadingDashboard ? '-' : dashboard?.expiring7Days || 0}
          </p>
        </div>
        <div className="card card-body">
          <p className="text-sm font-medium text-gray-500">Expiring in 30 Days</p>
          <p className="mt-1 text-3xl font-semibold text-yellow-600">
            {loadingDashboard ? '-' : dashboard?.expiring30Days || 0}
          </p>
        </div>
        <div className="card card-body">
          <p className="text-sm font-medium text-gray-500">Expiring in 90 Days</p>
          <p className="mt-1 text-3xl font-semibold text-green-600">
            {loadingDashboard ? '-' : dashboard?.expiring90Days || 0}
          </p>
        </div>
        <div className="card card-body">
          <p className="text-sm font-medium text-gray-500">Already Expired</p>
          <p className="mt-1 text-3xl font-semibold text-red-800">
            {loadingDashboard ? '-' : dashboard?.expired || 0}
          </p>
        </div>
      </div>

      {/* Expirations List */}
      <div className="card">
        <div className="card-header">
          <h3 className="text-lg font-medium text-gray-900">Upcoming Expirations</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Provider
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Credential
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Expiration Date
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Days Left
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loadingExpirations ? (
                <tr>
                  <td colSpan={5} className="px-6 py-4 text-center text-gray-500">
                    Loading...
                  </td>
                </tr>
              ) : expirations?.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-4 text-center text-gray-500">
                    No upcoming expirations
                  </td>
                </tr>
              ) : (
                expirations?.map((item) => (
                  <tr key={item.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {item.providerName}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {item.name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 capitalize">
                      {item.type}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {format(new Date(item.expirationDate), 'MMM d, yyyy')}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={clsx(
                          'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                          getUrgencyColor(item.daysUntilExpiration)
                        )}
                      >
                        {item.daysUntilExpiration <= 0
                          ? 'Expired'
                          : `${item.daysUntilExpiration} days`}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
