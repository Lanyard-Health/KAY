import { useState } from 'react';
import clsx from 'clsx';
import PageTransition from '../../components/ui/PageTransition';
import EntitlementsView from './EntitlementsView';
import PermissionLookupView from './PermissionLookupView';

// New report views plug in here without touching the existing ones.
const TABS = [
  { key: 'users', label: 'By User', component: EntitlementsView },
  { key: 'permissions', label: 'By Permission', component: PermissionLookupView },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export default function AccessReviewPage() {
  const [tab, setTab] = useState<TabKey>('users');
  const Active = TABS.find((t) => t.key === tab)!.component;

  return (
    <PageTransition>
      <div>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Access Review</h1>
          <p className="mt-1 text-sm text-gray-500">
            Who holds which role, and exactly what that role lets them do
          </p>
        </div>

        <div className="border-b border-gray-200 mb-6">
          <nav className="-mb-px flex gap-6">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={clsx(
                  'whitespace-nowrap border-b-2 py-3 px-1 text-sm font-medium transition-colors',
                  tab === t.key
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                )}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>

        <Active />
      </div>
    </PageTransition>
  );
}
