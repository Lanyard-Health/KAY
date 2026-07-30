import { PieChart, Pie, Cell, BarChart, Bar, XAxis, LabelList, ResponsiveContainer } from 'recharts';

const PAYER_RAMP = ['#0A3D2E', '#2d8b6a', '#7ccaab', '#b0e0cb', '#e3ddd2']; // brand ramp + neutral for "Other"
const prefersReducedMotion =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface PracticeChartsProps {
  approvedByPayer: Array<{ payerName: string; count: number }>;
  approvalsByMonth: Array<{ month: string; count: number }>; // 'YYYY-MM'
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
}

export default function PracticeCharts({ approvedByPayer, approvalsByMonth }: PracticeChartsProps) {
  const totalApproved = approvedByPayer.reduce((s, e) => s + e.count, 0);
  const monthData = approvalsByMonth.map((m) => ({ ...m, label: monthLabel(m.month) }));
  const currentIdx = monthData.length - 1;

  return (
    <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
      {/* Approved by payer — semi-donut */}
      <figure
        className="rounded-2xl border border-gray-200/60 bg-white p-5 shadow-sm"
        aria-label={`Approved enrollments by payer: ${totalApproved} total — ${approvedByPayer.map((e) => `${e.payerName} ${e.count}`).join(', ') || 'none yet'}`}
      >
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Approved enrollments by payer</h2>
        <div className="relative h-48">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={approvedByPayer} dataKey="count" nameKey="payerName"
                startAngle={180} endAngle={0} cx="50%" cy="80%"
                innerRadius={55} outerRadius={90} paddingAngle={1}
                isAnimationActive={!prefersReducedMotion}
              >
                {approvedByPayer.map((entry, i) => (
                  <Cell key={entry.payerName} fill={PAYER_RAMP[i % PAYER_RAMP.length]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-x-0 bottom-6 text-center">
            <p className="text-2xl font-bold text-gray-900 tabular-nums">{totalApproved}</p>
            <p className="text-xs text-gray-500">approved</p>
          </div>
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {approvedByPayer.map((entry, i) => (
            <li key={entry.payerName} className="flex items-center gap-1.5 text-[13px] text-gray-500 tabular-nums">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: PAYER_RAMP[i % PAYER_RAMP.length] }} aria-hidden="true" />
              {entry.payerName} {entry.count}
            </li>
          ))}
        </ul>
        <table className="sr-only">
          <caption>Approved enrollments by payer</caption>
          <tbody>{approvedByPayer.map((e) => <tr key={e.payerName}><th scope="row">{e.payerName}</th><td>{e.count}</td></tr>)}</tbody>
        </table>
      </figure>

      {/* Approvals by month — bars with value labels on every bar */}
      <figure
        className="rounded-2xl border border-gray-200/60 bg-white p-5 shadow-sm"
        aria-label={`Approvals by month, last ${monthData.length} months: ${monthData.map((m) => `${m.label} ${m.count}`).join(', ')}`}
      >
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Approvals by month</h2>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthData} margin={{ top: 20, right: 8, left: 8, bottom: 0 }}>
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#75705f' }} />
              <Bar dataKey="count" radius={[6, 6, 0, 0]} isAnimationActive={!prefersReducedMotion}>
                {monthData.map((m, i) => (
                  <Cell key={m.month} fill={i === currentIdx ? '#1A6B4E' : '#d6f0e4'} />
                ))}
                <LabelList dataKey="count" position="top" style={{ fontSize: 12, fill: '#75705f', fontVariantNumeric: 'tabular-nums' }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <table className="sr-only">
          <caption>Approvals by month</caption>
          <tbody>{monthData.map((m) => <tr key={m.month}><th scope="row">{m.label}</th><td>{m.count}</td></tr>)}</tbody>
        </table>
      </figure>
    </div>
  );
}
