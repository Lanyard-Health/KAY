import { useState, useEffect } from 'react';
import { useFollowUpSettings, useUpdateFollowUpSettings } from '../../hooks/useFollowUp';

const FREQUENCY_OPTIONS = [
  { value: 7, label: 'Every 7 days' },
  { value: 14, label: 'Every 14 days' },
  { value: 21, label: 'Every 21 days' },
  { value: 30, label: 'Every 30 days' },
];

interface FollowUpConfigPanelProps {
  enrollmentId: string;
}

export default function FollowUpConfigPanel({ enrollmentId }: FollowUpConfigPanelProps) {
  const { data: settingsResp, isLoading } = useFollowUpSettings(enrollmentId);
  const updateSettings = useUpdateFollowUpSettings();

  const settings = settingsResp?.data;

  const [enabled, setEnabled] = useState(false);
  const [email, setEmail] = useState('');
  const [frequencyDays, setFrequencyDays] = useState(14);
  useEffect(() => {
    if (settings) {
      setEnabled(settings.followUpEnabled);
      setEmail(settings.followUpEmail || '');
      setFrequencyDays(settings.followUpFrequencyDays);
    }
  }, [settings]);

  const handleSave = () => {
    updateSettings.mutate({
      enrollmentId,
      enabled,
      email: email || undefined,
      frequencyDays,
    });
  };

  const hasChanged = settings && (
    enabled !== settings.followUpEnabled ||
    email !== (settings.followUpEmail || '') ||
    frequencyDays !== settings.followUpFrequencyDays
  );

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="h-4 bg-gray-200 rounded w-1/3" />
        <div className="h-8 bg-gray-200 rounded" />
        <div className="h-8 bg-gray-200 rounded" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toggle */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-900">Automated Follow-Ups</p>
          <p className="text-xs text-gray-500">Send recurring emails on a schedule</p>
        </div>
        <button
          type="button"
          onClick={() => { setEnabled(!enabled);}}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
            enabled ? 'bg-primary-600' : 'bg-gray-200'
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform duration-200 ${
              enabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {enabled && (
        <>
          {/* Recipient email */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Recipient Email *
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value);}}
              placeholder="payer-credentialing@insurance.com"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          {/* Frequency */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Frequency
            </label>
            <select
              value={frequencyDays}
              onChange={(e) => { setFrequencyDays(Number(e.target.value));}}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {FREQUENCY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </>
      )}

      {/* Status info */}
      {settings && (
        <div className="rounded-md bg-gray-50 p-3 space-y-1 text-xs text-gray-600">
          <p>
            <span className="font-medium text-gray-700">Last sent:</span>{' '}
            {settings.lastFollowUpSentAt
              ? new Date(settings.lastFollowUpSentAt).toLocaleDateString()
              : 'Never'}
          </p>
          {settings.followUpEnabled && settings.nextFollowUpDate && (
            <p>
              <span className="font-medium text-gray-700">Next scheduled:</span>{' '}
              {new Date(settings.nextFollowUpDate).toLocaleDateString()}
            </p>
          )}
        </div>
      )}

      {/* Save */}
      {hasChanged && (
        <button
          onClick={handleSave}
          disabled={updateSettings.isPending || (enabled && !email)}
          className="w-full px-3 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50"
        >
          {updateSettings.isPending ? 'Saving...' : 'Save Settings'}
        </button>
      )}
    </div>
  );
}
