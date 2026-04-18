import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Tab, Switch } from '@headlessui/react';
import { ArrowLeftIcon, LinkIcon, PencilIcon, UserGroupIcon, UsersIcon, Cog6ToothIcon, BuildingOffice2Icon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePractice } from '../../hooks/usePractices';
import { api } from '../../services/api';
import PracticeFormModal from './PracticeFormModal';
import PracticeUsersTab from './PracticeUsersTab';
import PracticeProvidersTab from './PracticeProvidersTab';
import PracticePayersTab from './PracticePayersTab';

const TABS = [
  { name: 'Users', icon: UserGroupIcon },
  { name: 'Providers', icon: UsersIcon },
  { name: 'Payers', icon: BuildingOffice2Icon },
  { name: 'Settings', icon: Cog6ToothIcon },
];

export default function PracticeDetail() {
  const { practiceId } = useParams();
  const { data: practice, isLoading } = usePractice(practiceId!);
  const [editModalOpen, setEditModalOpen] = useState(false);

  const handleCopyRegistrationLink = () => {
    const link = `${window.location.origin}/register?practice=${practiceId}`;
    navigator.clipboard.writeText(link).then(() => {
      toast.success('Registration link copied to clipboard');
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-2 border-gray-200 border-t-primary-600" />
      </div>
    );
  }

  if (!practice) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Practice not found</p>
        <Link to="/practices" className="text-primary-600 hover:underline mt-2 inline-block">
          Back to practices
        </Link>
      </div>
    );
  }

  return (
    <div>
      {/* Back link */}
      <Link
        to="/practices"
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-6"
      >
        <ArrowLeftIcon className="h-4 w-4 mr-1" />
        Back to Practices
      </Link>

      {/* Header */}
      <div className="sm:flex sm:items-center sm:justify-between mb-8">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">{practice.name}</h1>
            <span
              className={clsx(
                'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                practice.status === 'ACTIVE'
                  ? 'bg-green-100 text-green-800'
                  : 'bg-gray-100 text-gray-600'
              )}
            >
              {practice.status}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 text-sm text-gray-500">
            {practice.phone && <span>{practice.phone}</span>}
            {practice.email && <span>{practice.email}</span>}
            {practice.website && (() => {
              try {
                const url = new URL(practice.website.startsWith('http') ? practice.website : `https://${practice.website}`);
                if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
                return (
                  <a
                    href={url.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary-600 hover:text-primary-500"
                  >
                    {practice.website}
                  </a>
                );
              } catch { return <span className="text-gray-400">{practice.website}</span>; }
            })()}
          </div>
        </div>
        <div className="flex items-center gap-3 mt-4 sm:mt-0">
          <button
            onClick={handleCopyRegistrationLink}
            className="btn-secondary"
          >
            <LinkIcon className="-ml-1 mr-2 h-5 w-5" />
            Copy Registration Link
          </button>
          <button
            onClick={() => setEditModalOpen(true)}
            className="btn-secondary"
          >
            <PencilIcon className="-ml-1 mr-2 h-5 w-5" />
            Edit
          </button>
        </div>
      </div>

      {/* Tabs */}
      <Tab.Group>
        <Tab.List className="flex space-x-4 border-b border-gray-200 mb-6">
          {TABS.map((tab) => (
            <Tab
              key={tab.name}
              className={({ selected }) =>
                clsx(
                  'flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px focus:outline-none',
                  selected
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                )
              }
            >
              <tab.icon className="h-5 w-5" />
              {tab.name}
            </Tab>
          ))}
        </Tab.List>

        <Tab.Panels>
          <Tab.Panel>
            <PracticeUsersTab practiceId={practiceId!} />
          </Tab.Panel>
          <Tab.Panel>
            <PracticeProvidersTab practiceId={practiceId!} />
          </Tab.Panel>
          <Tab.Panel>
            <PracticePayersTab practiceId={practiceId!} />
          </Tab.Panel>
          <Tab.Panel>
            <PracticeSettingsTab practiceId={practiceId!} />
          </Tab.Panel>
        </Tab.Panels>
      </Tab.Group>

      <PracticeFormModal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        practice={practice}
      />
    </div>
  );
}

function SettingToggle({
  label,
  description,
  enabled,
  onChange,
}: {
  label: string;
  description?: string;
  enabled: boolean;
  onChange: (val: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-4 border-b border-gray-100 last:border-0">
      <div>
        <p className="text-sm font-medium text-gray-900">{label}</p>
        {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
      </div>
      <Switch
        checked={enabled}
        onChange={onChange}
        className={clsx(
          'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2',
          enabled ? 'bg-primary-600' : 'bg-gray-200',
        )}
      >
        <span
          className={clsx(
            'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
            enabled ? 'translate-x-5' : 'translate-x-0',
          )}
        />
      </Switch>
    </div>
  );
}

function PracticeSettingsTab({ practiceId }: { practiceId: string }) {
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['practice-settings', practiceId],
    queryFn: async () => {
      const res = await api.get(`/admin/practices/${practiceId}/settings`);
      return res.data.data;
    },
  });

  const [enrollmentCapEnabled, setEnrollmentCapEnabled] = useState(false);
  const [enrollmentCap, setEnrollmentCap] = useState<number>(10);
  const [followUpSubmissions, setFollowUpSubmissions] = useState(true);
  const [followUpDenialTriage, setFollowUpDenialTriage] = useState(true);
  const [multipleLocations, setMultipleLocations] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (settings && !initialized) {
      setEnrollmentCapEnabled(settings.enrollmentCap != null);
      setEnrollmentCap(settings.enrollmentCap ?? 10);
      setFollowUpSubmissions(settings.followUpSubmissions);
      setFollowUpDenialTriage(settings.followUpDenialTriage);
      setMultipleLocations(settings.multipleLocations);
      setInitialized(true);
    }
  }, [settings, initialized]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await api.put(`/admin/practices/${practiceId}/settings`, {
        enrollmentCap: enrollmentCapEnabled ? enrollmentCap : null,
        followUpSubmissions,
        followUpDenialTriage,
        multipleLocations,
      });
      return res.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['practice-settings', practiceId] });
      toast.success('Settings saved');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error?.message || 'Failed to save settings');
    },
  });

  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-6 animate-pulse space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-10 bg-gray-100 rounded" />
        ))}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
      <div className="px-6 py-4 border-b border-gray-100">
        <h3 className="text-base font-semibold text-gray-900">Practice Settings</h3>
        <p className="text-xs text-gray-500 mt-0.5">Configure automation and limits for this practice.</p>
      </div>
      <div className="px-6">
        {/* Enrollment Cap */}
        <div className="py-4 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">Limit monthly enrollments</p>
              <p className="text-xs text-gray-500 mt-0.5">Set a cap on new enrollments per month</p>
            </div>
            <Switch
              checked={enrollmentCapEnabled}
              onChange={setEnrollmentCapEnabled}
              className={clsx(
                'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2',
                enrollmentCapEnabled ? 'bg-primary-600' : 'bg-gray-200',
              )}
            >
              <span
                className={clsx(
                  'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
                  enrollmentCapEnabled ? 'translate-x-5' : 'translate-x-0',
                )}
              />
            </Switch>
          </div>
          {enrollmentCapEnabled && (
            <div className="mt-3">
              <label htmlFor="enrollmentCap" className="block text-xs font-medium text-gray-600 mb-1">
                Maximum enrollments per month
              </label>
              <input
                id="enrollmentCap"
                type="number"
                min={1}
                className="input w-32"
                value={enrollmentCap}
                onChange={(e) => setEnrollmentCap(Math.max(1, parseInt(e.target.value) || 1))}
              />
            </div>
          )}
        </div>

        <SettingToggle
          label="Automated follow-up on enrollment submissions"
          description="Send automated follow-ups after enrollment submissions"
          enabled={followUpSubmissions}
          onChange={setFollowUpSubmissions}
        />
        <SettingToggle
          label="Automated denial triage workflow"
          description="Automatically triage and route enrollment denials"
          enabled={followUpDenialTriage}
          onChange={setFollowUpDenialTriage}
        />
        <SettingToggle
          label="Enable multi-location support"
          description="Allow this practice to manage multiple locations"
          enabled={multipleLocations}
          onChange={setMultipleLocations}
        />
      </div>
      <div className="px-6 py-4 border-t border-gray-100 flex justify-end">
        <button
          type="button"
          className="btn-primary text-sm"
          disabled={saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
        >
          {saveMutation.isPending ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}
