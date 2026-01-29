import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PencilIcon, DocumentArrowDownIcon } from '@heroicons/react/24/outline';
import { format } from 'date-fns';
import { api } from '../../services/api';
import clsx from 'clsx';

export default function ProviderDetail() {
  const { id } = useParams();

  const { data: provider, isLoading } = useQuery({
    queryKey: ['provider', id],
    queryFn: async () => {
      const response = await api.get(`/providers/${id}`);
      return response.data.data;
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!provider) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Provider not found</p>
        <Link to="/providers" className="text-primary-600 hover:underline mt-2 inline-block">
          Back to providers
        </Link>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="sm:flex sm:items-center sm:justify-between mb-8">
        <div className="flex items-center">
          <div className="h-16 w-16 rounded-full bg-primary-100 flex items-center justify-center">
            <span className="text-primary-600 text-2xl font-bold">
              {provider.firstName[0]}{provider.lastName[0]}
            </span>
          </div>
          <div className="ml-4">
            <h1 className="text-2xl font-bold text-gray-900">
              {provider.firstName} {provider.lastName}
              {provider.suffix && `, ${provider.suffix}`}
            </h1>
            <p className="text-sm text-gray-500">
              NPI: {provider.npi} | {provider.providerType.replace('_', ' ')}
            </p>
          </div>
        </div>
        <div className="mt-4 sm:mt-0 flex gap-3">
          <Link to={`/providers/${id}/edit`} className="btn-secondary">
            <PencilIcon className="-ml-1 mr-2 h-5 w-5" />
            Edit
          </Link>
          <button className="btn-primary">
            <DocumentArrowDownIcon className="-ml-1 mr-2 h-5 w-5" />
            Export Data
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Personal Information */}
          <div className="card">
            <div className="card-header">
              <h2 className="text-lg font-medium text-gray-900">Personal Information</h2>
            </div>
            <div className="card-body">
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <dt className="text-sm font-medium text-gray-500">Email</dt>
                  <dd className="mt-1 text-sm text-gray-900">{provider.email}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500">Phone</dt>
                  <dd className="mt-1 text-sm text-gray-900">{provider.phone}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500">Date of Birth</dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    {format(new Date(provider.dateOfBirth), 'MMMM d, yyyy')}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500">Gender</dt>
                  <dd className="mt-1 text-sm text-gray-900 capitalize">
                    {provider.gender.replace('_', ' ')}
                  </dd>
                </div>
              </dl>
            </div>
          </div>

          {/* Licenses */}
          <div className="card">
            <div className="card-header flex items-center justify-between">
              <h2 className="text-lg font-medium text-gray-900">Licenses</h2>
              <button className="text-sm text-primary-600 hover:text-primary-500">
                Add License
              </button>
            </div>
            <div className="card-body">
              {provider.licenses?.length === 0 ? (
                <p className="text-sm text-gray-500">No licenses added yet.</p>
              ) : (
                <div className="space-y-4">
                  {provider.licenses?.map((license: any) => (
                    <div
                      key={license.id}
                      className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
                    >
                      <div>
                        <p className="font-medium text-gray-900">
                          {license.licenseType.replace('_', ' ')} - {license.state}
                        </p>
                        <p className="text-sm text-gray-500">#{license.licenseNumber}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-gray-500">Expires</p>
                        <p className={clsx(
                          'text-sm font-medium',
                          new Date(license.expirationDate) < new Date() ? 'text-red-600' : 'text-gray-900'
                        )}>
                          {format(new Date(license.expirationDate), 'MMM d, yyyy')}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Board Certifications */}
          <div className="card">
            <div className="card-header flex items-center justify-between">
              <h2 className="text-lg font-medium text-gray-900">Board Certifications</h2>
              <button className="text-sm text-primary-600 hover:text-primary-500">
                Add Certification
              </button>
            </div>
            <div className="card-body">
              {provider.boardCertifications?.length === 0 ? (
                <p className="text-sm text-gray-500">No certifications added yet.</p>
              ) : (
                <div className="space-y-4">
                  {provider.boardCertifications?.map((cert: any) => (
                    <div
                      key={cert.id}
                      className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
                    >
                      <div>
                        <p className="font-medium text-gray-900">{cert.boardName}</p>
                        <p className="text-sm text-gray-500">{cert.specialty}</p>
                      </div>
                      <div className="text-right">
                        {cert.expirationDate && (
                          <>
                            <p className="text-sm text-gray-500">Expires</p>
                            <p className="text-sm font-medium text-gray-900">
                              {format(new Date(cert.expirationDate), 'MMM d, yyyy')}
                            </p>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Status Card */}
          <div className="card card-body">
            <h3 className="text-sm font-medium text-gray-500 mb-3">Status</h3>
            <span
              className={clsx(
                'inline-flex items-center px-3 py-1 rounded-full text-sm font-medium capitalize',
                provider.status === 'active' && 'bg-green-100 text-green-800',
                provider.status === 'inactive' && 'bg-gray-100 text-gray-800',
                provider.status === 'pending' && 'bg-yellow-100 text-yellow-800'
              )}
            >
              {provider.status}
            </span>
          </div>

          {/* CAQH Status */}
          <div className="card card-body">
            <h3 className="text-sm font-medium text-gray-500 mb-3">CAQH ProView</h3>
            {provider.caqhProviderId ? (
              <div>
                <p className="text-sm text-gray-900">ID: {provider.caqhProviderId}</p>
                <p className="text-sm text-gray-500 capitalize">
                  Status: {provider.caqhStatus || 'Unknown'}
                </p>
                {provider.caqhLastSync && (
                  <p className="text-xs text-gray-400 mt-1">
                    Last synced: {format(new Date(provider.caqhLastSync), 'MMM d, yyyy')}
                  </p>
                )}
                <button className="mt-2 text-sm text-primary-600 hover:text-primary-500">
                  Sync Now
                </button>
              </div>
            ) : (
              <div>
                <p className="text-sm text-gray-500 mb-2">Not connected to CAQH</p>
                <button className="text-sm text-primary-600 hover:text-primary-500">
                  Connect to CAQH
                </button>
              </div>
            )}
          </div>

          {/* Documents */}
          <div className="card card-body">
            <h3 className="text-sm font-medium text-gray-500 mb-3">Documents</h3>
            <p className="text-2xl font-bold text-gray-900">
              {provider.documents?.length || 0}
            </p>
            <p className="text-sm text-gray-500">documents uploaded</p>
            <button className="mt-2 text-sm text-primary-600 hover:text-primary-500">
              View All Documents
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
