import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';
import SlideOver from './ui/SlideOver';
import clsx from 'clsx';

interface ProviderQuickPeekProps {
  isOpen: boolean;
  onClose: () => void;
  providerId: string;
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  pending: 'bg-yellow-100 text-yellow-700',
  inactive: 'bg-gray-100 text-gray-600',
  pending_verification: 'bg-amber-100 text-amber-700',
};

export default function ProviderQuickPeek({ isOpen, onClose, providerId }: ProviderQuickPeekProps) {
  const { data: provider, isLoading } = useQuery({
    queryKey: ['provider-peek', providerId],
    queryFn: async () => {
      const res = await api.get(`/providers/${providerId}`);
      return res.data.data;
    },
    enabled: isOpen && !!providerId,
  });

  return (
    <SlideOver isOpen={isOpen} onClose={onClose} title="Provider Quick View">
      {isLoading ? (
        <div className="space-y-4 animate-pulse">
          <div className="h-6 w-48 bg-gray-200 rounded" />
          <div className="h-4 w-32 bg-gray-200 rounded" />
          <div className="h-20 bg-gray-100 rounded-xl" />
          <div className="h-20 bg-gray-100 rounded-xl" />
        </div>
      ) : provider ? (
        <div className="space-y-5">
          {/* Name + Status */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              {provider.firstName} {provider.lastName}
              {provider.suffix && `, ${provider.suffix}`}
            </h3>
            <div className="flex items-center gap-2 mt-1">
              <span className={clsx(
                'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                STATUS_COLORS[provider.status] ?? 'bg-gray-100 text-gray-600',
              )}>
                {(provider.status ?? 'unknown').replace(/_/g, ' ')}
              </span>
              {provider.npi && (
                <span className="text-xs text-gray-500">NPI: {provider.npi}</span>
              )}
            </div>
          </div>

          {/* Completeness */}
          {provider.completenessPercentage != null && (
            <div className="rounded-xl bg-gray-50 p-3">
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-gray-600">Profile Completeness</span>
                <span className="font-medium text-gray-900">{provider.completenessPercentage}%</span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={clsx(
                    'h-full rounded-full transition-all duration-500',
                    provider.completenessPercentage >= 80 ? 'bg-green-500' :
                    provider.completenessPercentage >= 50 ? 'bg-amber-500' : 'bg-red-500',
                  )}
                  style={{ width: `${provider.completenessPercentage}%` }}
                />
              </div>
            </div>
          )}

          {/* Quick Stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-gray-50 p-3">
              <p className="text-xs text-gray-500">Enrollments</p>
              <p className="text-lg font-semibold text-gray-900">
                {provider.enrollments?.length ?? 0}
              </p>
            </div>
            <div className="rounded-xl bg-gray-50 p-3">
              <p className="text-xs text-gray-500">Licenses</p>
              <p className="text-lg font-semibold text-gray-900">
                {provider.licenses?.length ?? 0}
              </p>
            </div>
          </div>

          {/* Key Dates */}
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide">Key Dates</h4>
            <div className="text-sm space-y-1">
              {provider.credentialedDate && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Credentialed</span>
                  <span className="text-gray-900">{new Date(provider.credentialedDate).toLocaleDateString()}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-500">Added</span>
                <span className="text-gray-900">{new Date(provider.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          </div>

          {/* Full Profile Link */}
          <Link
            to={`/providers/${providerId}`}
            onClick={onClose}
            className="block w-full text-center rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 transition-colors"
          >
            Open full profile
          </Link>
        </div>
      ) : (
        <p className="text-sm text-gray-500">Provider not found.</p>
      )}
    </SlideOver>
  );
}
