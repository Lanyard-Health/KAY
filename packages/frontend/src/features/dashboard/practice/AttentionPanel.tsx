import { Link } from 'react-router-dom';
import { attentionCopy, type AttentionItemView } from './statusMeta';

interface AttentionPanelProps {
  items: AttentionItemView[];
  approvedCount: number;
  totalCount: number;
}

export default function AttentionPanel({ items, approvedCount, totalCount }: AttentionPanelProps) {
  return (
    <div className="rounded-2xl border border-gray-200/60 bg-white p-5 shadow-sm" id="attention">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Needs your attention</h2>
      {items.length === 0 ? (
        <p className="mt-4 text-sm text-gray-700">
          {totalCount > 0 && approvedCount === totalCount
            ? `All ${totalCount} enrollments approved. Nothing needs your attention.`
            : 'Nothing needs your attention right now.'}
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {items.map((item) => {
            const { headline, plan } = attentionCopy(item);
            return (
              <li key={item.enrollmentId}>
                <Link
                  to={`/enrollments/${item.enrollmentId}`}
                  className="flex gap-3 rounded-xl border border-[#F0DCB8] bg-[#FDF3E3] p-3.5 transition-shadow hover:shadow-sm"
                >
                  <span className="w-1 shrink-0 rounded-sm bg-[#B45309]" aria-hidden="true" />
                  <span>
                    <span className="block text-sm font-semibold text-gray-900">{headline}</span>
                    <span className="mt-0.5 block text-sm text-gray-600">{plan}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
