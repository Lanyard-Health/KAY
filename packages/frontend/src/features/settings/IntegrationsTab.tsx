import {
  CheckCircleIcon,
  XCircleIcon,
  EnvelopeIcon,
  PhoneIcon,
  CloudIcon,
  ServerStackIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api';

interface IntegrationCardProps {
  icon: React.ReactNode;
  name: string;
  description: string;
  configured: boolean;
  details?: string;
}

function IntegrationCard({ icon, name, description, configured, details }: IntegrationCardProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-sm transition-shadow">
      <div className="flex items-start gap-4">
        <div className={clsx(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
          configured ? 'bg-green-50 text-green-600' : 'bg-gray-50 text-gray-400',
        )}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-gray-900">{name}</h4>
            {configured ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700">
                <CheckCircleIcon className="h-3.5 w-3.5" />
                Connected
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-400">
                <XCircleIcon className="h-3.5 w-3.5" />
                Not configured
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-gray-500">{description}</p>
          {details && (
            <p className="mt-1 text-xs text-gray-400 font-mono">{details}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function IntegrationsTab() {
  // Fetch email service status
  const { data: emailStatus } = useQuery({
    queryKey: ['follow-up-status'],
    queryFn: async () => {
      try {
        const response = await api.get<{ success: boolean; data: any }>('/follow-up/status');
        return response.data.data;
      } catch {
        return null;
      }
    },
    staleTime: 60 * 1000,
  });

  // Fetch CAQH integration status
  const { data: caqhStatus } = useQuery({
    queryKey: ['caqh-config'],
    queryFn: async () => {
      try {
        const response = await api.get<{ success: boolean; data: { configured: boolean; lastSyncAt: string | null } }>('/caqh/config');
        return response.data.data;
      } catch {
        return null;
      }
    },
    staleTime: 60 * 1000,
  });

  // Fetch storage + Retell connection status
  const { data: integrationsStatus } = useQuery({
    queryKey: ['integrations-status'],
    queryFn: async () => {
      try {
        const response = await api.get<{
          success: boolean;
          data: {
            documentStorage: { configured: boolean; bucket: string | null; endpoint: string | null };
            retell: { configured: boolean };
          };
        }>('/integrations/status');
        return response.data.data;
      } catch {
        return null;
      }
    },
    staleTime: 60 * 1000,
  });

  const emailConfigured = emailStatus?.email?.configured ?? false;
  const emailUser = emailStatus?.email?.config?.user;
  const caqhConfigured = caqhStatus?.configured ?? false;
  const caqhLastSync = caqhStatus?.lastSyncAt;
  const documentStorageConfigured = integrationsStatus?.documentStorage?.configured ?? false;
  const documentStorageBucket = integrationsStatus?.documentStorage?.bucket;
  const retellConfigured = integrationsStatus?.retell?.configured ?? false;

  return (
    <div className="space-y-4 max-w-2xl">
      <p className="text-sm text-gray-500">
        These cards show the current connection status for each integration.
      </p>

      <div className="grid grid-cols-1 gap-3">
        <IntegrationCard
          icon={<ServerStackIcon className="h-5 w-5" />}
          name="CAQH ProView"
          description="Automated credential verification and roster management"
          configured={caqhConfigured}
          details={caqhConfigured && caqhLastSync ? `Last sync: ${new Date(caqhLastSync).toLocaleString()}` : 'Not configured — contact support to connect your CAQH account.'}
        />

        <IntegrationCard
          icon={<PhoneIcon className="h-5 w-5" />}
          name="Retell AI"
          description="AI-powered phone follow-ups with payers"
          configured={retellConfigured}
          details={retellConfigured ? undefined : 'Not configured — contact support to enable AI voice calls.'}
        />

        <IntegrationCard
          icon={<EnvelopeIcon className="h-5 w-5" />}
          name="Email (Resend)"
          description="Automated email follow-ups and notifications"
          configured={emailConfigured}
          details={emailConfigured && emailUser ? `From: ${emailUser}` : 'Not configured — contact support to enable email sending.'}
        />

        <IntegrationCard
          icon={<CloudIcon className="h-5 w-5" />}
          name="Document Storage (S3/R2)"
          description="Secure document upload and storage"
          configured={documentStorageConfigured}
          details={
            documentStorageConfigured && documentStorageBucket
              ? `Bucket: ${documentStorageBucket}`
              : 'Not configured — contact support to enable document storage.'
          }
        />
      </div>
    </div>
  );
}
