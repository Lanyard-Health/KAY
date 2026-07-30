import { BarChart, Bar, XAxis, YAxis, Cell, LabelList, ResponsiveContainer } from 'recharts';
import { STATUS_META } from './staffMeta';
import { DELAYED_META } from '../practice/statusMeta';

const prefersReducedMotion =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type PipelineStage = 'intake' | 'in_progress' | 'submitted' | 'pending_review' | 'delayed';

// Stage labels are staff shop-talk (sanctioned on this surface); fills come
// from the status palette — status-keyed charts use status hexes only.
const STAGE_META: Record<PipelineStage, { label: string; hex: string }> = {
  intake:         { label: 'Intake',          hex: STATUS_META.not_started.dotHex },
  in_progress:    { label: 'In progress',     hex: STATUS_META.in_progress.dotHex },
  submitted:      { label: 'Submitted',       hex: STATUS_META.submitted.dotHex },
  pending_review: { label: 'Payer reviewing', hex: STATUS_META.pending_review.dotHex },
  delayed:        { label: 'Delayed',         hex: DELAYED_META.dotHex },
};

interface StaffChartsProps {
  pipelineByStage: Array<{ stage: PipelineStage; count: number }>;
  submissionsByWeek: Array<{ weekStart: string; count: number }>; // 'YYYY-MM-DD' Mondays
}

function weekLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export default function StaffCharts({ pipelineByStage, submissionsByWeek }: StaffChartsProps) {
  const pipeline = pipelineByStage.map((s) => ({ ...s, ...STAGE_META[s.stage] }));
  const openTotal = pipeline.reduce((sum, s) => sum + s.count, 0);
  const weeks = submissionsByWeek.map((w) => ({ ...w, label: weekLabel(w.weekStart) }));
  const currentIdx = weeks.length - 1;

  return (
    <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
      {/* Pipeline by stage — horizontal bars */}
      <figure
        className="rounded-2xl border border-gray-200/60 bg-white p-5 shadow-sm"
        aria-label={`Pipeline by stage: ${openTotal} open — ${pipeline.map((s) => `${s.label} ${s.count}`).join(', ')}`}
      >
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Pipeline by stage</h2>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={pipeline} layout="vertical" margin={{ top: 4, right: 28, left: 8, bottom: 0 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="label" width={104} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#75705f' }} />
              <Bar dataKey="count" radius={[0, 6, 6, 0]} isAnimationActive={!prefersReducedMotion}>
                {pipeline.map((s) => <Cell key={s.stage} fill={s.hex} />)}
                <LabelList dataKey="count" position="right" style={{ fontSize: 12, fill: '#75705f', fontVariantNumeric: 'tabular-nums' }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <table className="sr-only">
          <caption>Pipeline by stage</caption>
          <tbody>{pipeline.map((s) => <tr key={s.stage}><th scope="row">{s.label}</th><td>{s.count}</td></tr>)}</tbody>
        </table>
      </figure>

      {/* Submissions by week — vertical bars with value labels */}
      <figure
        className="rounded-2xl border border-gray-200/60 bg-white p-5 shadow-sm"
        aria-label={`Submissions by week, last ${weeks.length} weeks: ${weeks.map((w) => `week of ${w.label} ${w.count}`).join(', ')}`}
      >
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Submissions by week</h2>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weeks} margin={{ top: 20, right: 8, left: 8, bottom: 0 }}>
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#75705f' }} interval={1} />
              <Bar dataKey="count" radius={[6, 6, 0, 0]} isAnimationActive={!prefersReducedMotion}>
                {weeks.map((w, i) => (
                  <Cell key={w.weekStart} fill={i === currentIdx ? STATUS_META.submitted.dotHex : '#cfe8ee'} />
                ))}
                <LabelList dataKey="count" position="top" style={{ fontSize: 12, fill: '#75705f', fontVariantNumeric: 'tabular-nums' }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <table className="sr-only">
          <caption>Submissions by week</caption>
          <tbody>{weeks.map((w) => <tr key={w.weekStart}><th scope="row">Week of {w.label}</th><td>{w.count}</td></tr>)}</tbody>
        </table>
      </figure>
    </div>
  );
}
