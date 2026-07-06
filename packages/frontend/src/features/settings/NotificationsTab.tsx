import { useState, useEffect } from 'react';
import { Switch } from '@headlessui/react';
import clsx from 'clsx';
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from '../../hooks/useSettings';
import type { NotificationPreferences } from '../../hooks/useSettings';

interface ToggleRowProps {
  label: string;
  description: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

function ToggleRow({ label, description, enabled, onChange }: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between py-4">
      <div className="min-w-0 flex-1 pr-4">
        <p className="text-sm font-medium text-gray-900">{label}</p>
        <p className="mt-0.5 text-sm text-gray-500">{description}</p>
      </div>
      <Switch
        checked={enabled}
        onChange={onChange}
        className={clsx(
          'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-600 focus:ring-offset-2',
          enabled ? 'bg-primary-600' : 'bg-gray-200',
        )}
      >
        <span
          className={clsx(
            'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
            enabled ? 'translate-x-5' : 'translate-x-0',
          )}
        />
      </Switch>
    </div>
  );
}

export default function NotificationsTab() {
  const { data: prefs } = useNotificationPreferences();
  const updatePrefs = useUpdateNotificationPreferences();

  const [local, setLocal] = useState<NotificationPreferences>({
    enrollmentStatusChanges: true,
    credentialExpirations: true,
    followUpReminders: true,
    denialAlerts: true,
    weeklySummary: false,
  });
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (prefs) {
      setLocal(prefs);
      setIsDirty(false);
    }
  }, [prefs]);

  const handleToggle = (key: keyof NotificationPreferences, value: boolean) => {
    setLocal((prev) => ({ ...prev, [key]: value }));
    setIsDirty(true);
  };

  const handleSave = () => {
    updatePrefs.mutate(local, {
      onSuccess: () => setIsDirty(false),
    });
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Email Notifications</h3>
        <p className="text-sm text-gray-500 mb-4">
          Choose which email notifications you want to receive.
        </p>

        <div className="divide-y divide-gray-100">
          {/* credentialExpirations + followUpReminders rows are hidden until
              those emails actually reach practice admins (they currently go
              to providers). The preference columns already exist in the DB. */}
          <ToggleRow
            label="Enrollment Status Changes"
            description="Email when an enrollment is submitted to a payer or approved"
            enabled={local.enrollmentStatusChanges}
            onChange={(v) => handleToggle('enrollmentStatusChanges', v)}
          />
          <ToggleRow
            label="Denial Alerts"
            description="Email immediately if a payer denies an enrollment, including what Lanyard is doing about it"
            enabled={local.denialAlerts}
            onChange={(v) => handleToggle('denialAlerts', v)}
          />
          <ToggleRow
            label="Weekly Summary Digest"
            description="Monday morning email summary of your practice's credentialing"
            enabled={local.weeklySummary}
            onChange={(v) => handleToggle('weeklySummary', v)}
          />
        </div>

        <p className="mt-4 text-xs text-gray-400">
          These settings control emails only — in-app notifications in the bell menu are always on.
        </p>
      </div>

      {isDirty && (
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={updatePrefs.isPending}
            className="btn-primary text-sm"
          >
            {updatePrefs.isPending ? 'Saving...' : 'Save Preferences'}
          </button>
          <button
            onClick={() => {
              if (prefs) {
                setLocal(prefs);
                setIsDirty(false);
              }
            }}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Discard
          </button>
        </div>
      )}
    </div>
  );
}
