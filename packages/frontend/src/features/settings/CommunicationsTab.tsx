import { useState } from 'react';
import { useEmailTemplates, type EmailTemplate } from '../../hooks/useEmailTemplates';

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function TemplateCard({ template, showTrigger }: { template: EmailTemplate; showTrigger?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const plainBody = stripHtml(template.body);
  const isLong = plainBody.length > 120;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-gray-900">{template.name}</h4>
          <p className="mt-0.5 text-sm text-gray-500 truncate">{template.subject}</p>
        </div>
        {showTrigger && template.triggerEvent && (
          <span className="inline-flex items-center flex-shrink-0 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
            {template.triggerEvent.replace(/_/g, ' ')}
          </span>
        )}
      </div>
      <div className="mt-3 text-sm text-gray-600 leading-relaxed">
        {expanded || !isLong ? plainBody : `${plainBody.slice(0, 120)}...`}
        {isLong && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="ml-1 text-primary-600 hover:text-primary-700 font-medium"
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    </div>
  );
}

export default function CommunicationsTab() {
  const { data: onboarding, isLoading: loadingOnboarding } = useEmailTemplates('AUTOMATED_ONBOARDING');
  const { data: onDemand, isLoading: loadingOnDemand } = useEmailTemplates('STATIC_ON_DEMAND');

  if (loadingOnboarding || loadingOnDemand) {
    return (
      <div className="space-y-6 max-w-2xl">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse">
            <div className="h-4 w-48 bg-gray-200 rounded" />
            <div className="mt-2 h-3 w-64 bg-gray-200 rounded" />
            <div className="mt-3 h-3 w-full bg-gray-200 rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-2xl">
      {/* Automated Onboarding Emails */}
      <section>
        <h3 className="text-base font-semibold text-gray-900">Automated Onboarding Emails</h3>
        <p className="mt-1 text-sm text-gray-500">
          These emails are sent automatically when practices reach key milestones.
        </p>
        <div className="mt-4 space-y-3">
          {onboarding && onboarding.length > 0 ? (
            onboarding.map((t) => <TemplateCard key={t.id} template={t} showTrigger />)
          ) : (
            <p className="text-sm text-gray-400 italic">No automated onboarding templates configured.</p>
          )}
        </div>
      </section>

      {/* Other Communications */}
      <section>
        <h3 className="text-base font-semibold text-gray-900">Other Communications</h3>
        <p className="mt-1 text-sm text-gray-500">
          Templates used by staff for on-demand communications.
        </p>
        <div className="mt-4 space-y-3">
          {onDemand && onDemand.length > 0 ? (
            onDemand.map((t) => <TemplateCard key={t.id} template={t} />)
          ) : (
            <p className="text-sm text-gray-400 italic">No on-demand templates configured.</p>
          )}
        </div>
      </section>
    </div>
  );
}
