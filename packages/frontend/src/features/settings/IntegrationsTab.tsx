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

  const emailConfigured = emailStatus?.email?.configured ?? false;
  const emailUser = emailStatus?.email?.config?.user;

  return (
    <div className="space-y-4 max-w-2xl">
      <p className="text-sm text-gray-500">
        Integration configurations are managed via environment variables on the deployment platform.
        These cards show the current connection status.
      </p>

      <div className="grid grid-cols-1 gap-3">
        <IntegrationCard
          icon={<ServerStackIcon className="h-5 w-5" />}
          name="CAQH ProView"
          description="Automated credential verification and roster management"
          configured={false}
          details="Configure via CAQH_API_URL, CAQH_ORG_ID, CAQH_API_KEY"
        />

        <IntegrationCard
          icon={<PhoneIcon className="h-5 w-5" />}
          name="Retell AI"
          description="AI-powered phone follow-ups with payers"
          configured={false}
          details="Configure via RETELL_API_KEY"
        />

        <IntegrationCard
          icon={<EnvelopeIcon className="h-5 w-5" />}
          name="Email (SES)"
          description="Automated email follow-ups and notifications"
          configured={emailConfigured}
          details={emailConfigured && emailUser ? `From: ${emailUser}` : 'Configure via SES_FROM_EMAIL'}
        />

        <IntegrationCard
          icon={<CloudIcon className="h-5 w-5" />}
          name="Document Storage (S3/R2)"
          description="Secure document upload and storage"
          configured={false}
          details="Configure via S3_ENDPOINT, S3_BUCKET_NAME"
        />
      </div>
    </div>
  );
}
