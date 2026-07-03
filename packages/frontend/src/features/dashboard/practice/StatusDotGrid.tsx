import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { STATUS_META, DELAYED_META, etaCaption, type EnrollmentStatus } from './statusMeta';

export interface GridCellView {
  enrollmentId: string;
  status: EnrollmentStatus;
  isDelayed: boolean;
  dayCount: number | null;
  minDays: number | null;
  maxDays: number | null;
  updatedDaysAgo: number;
}
export interface GridRowView {
  providerId: string;
  providerName: string;
  credential: string | null;
  approvedCount: number;
  totalCount: number;
  cells: Array<GridCellView | null>;
}
interface StatusDotGridProps {
  payers: Array<{ id: string; name: string }>;
  rows: GridRowView[];
}

function Dot({ status, isDelayed }: { status: EnrollmentStatus; isDelayed: boolean }) {
  if (isDelayed) {
    return (
      <span
        className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full text-[11px] font-extrabold text-white"
        style={{ background: DELAYED_META.dotHex }}
        aria-hidden="true"
      >
        !
      </span>
    );
  }
  const meta = STATUS_META[status];
  if (meta.hollow) {
    return <span className="inline-block h-[18px] w-[18px] rounded-full border-2 border-gray-500 bg-white" aria-hidden="true" />;
  }
  const Glyph = meta.Glyph;
  return (
    <span
      className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full"
      style={{ background: meta.dotHex }}
      aria-hidden="true"
    >
      {Glyph ? <Glyph className="h-3 w-3 text-white" /> : null}
    </span>
  );
}

function cellFacts(payerName: string, cell: GridCellView): string {
  const statusLabel = STATUS_META[cell.status].label;
  const flag = cell.isDelayed ? `${DELAYED_META.label} — ` : '';
  const eta = etaCaption(cell.dayCount, cell.minDays, cell.maxDays);
  const updated = `updated ${cell.updatedDaysAgo} ${cell.updatedDaysAgo === 1 ? 'day' : 'days'} ago`;
  return `${payerName} — ${flag}${statusLabel}, ${eta ? `${eta.toLowerCase()}, ` : ''}${updated}`;
}

const LEGEND: Array<{ label: string; status?: EnrollmentStatus; delayed?: boolean }> = [
  { label: STATUS_META.approved.label, status: 'approved' },
  { label: STATUS_META.submitted.label, status: 'submitted' },
  { label: STATUS_META.pending_review.label, status: 'pending_review' },
  { label: STATUS_META.in_progress.label, status: 'in_progress' },
  { label: DELAYED_META.label, delayed: true },
  { label: STATUS_META.denied.label, status: 'denied' },
  { label: STATUS_META.not_started.label, status: 'not_started' },
  { label: STATUS_META.terminated.label, status: 'terminated' },
];

/** Finds the first non-null cell, scanning row by row, then column by column. */
function findFirstCellPos(rows: GridRowView[]): { r: number; c: number } {
  for (let r = 0; r < rows.length; r++) {
    const cells = rows[r].cells;
    for (let c = 0; c < cells.length; c++) {
      if (cells[c]) return { r, c };
    }
  }
  return { r: 0, c: 0 };
}

/** Next non-null column in the same row, scanning in `dir` (1 = right, -1 = left). Null if none found. */
function nextInRow(row: GridRowView, c: number, dir: 1 | -1, maxC: number): number | null {
  let nc = c + dir;
  while (nc >= 0 && nc <= maxC) {
    if (row.cells[nc]) return nc;
    nc += dir;
  }
  return null;
}

/** Next non-null row in the same column, scanning in `dir` (1 = down, -1 = up). Null if none found. */
function nextInColumn(rows: GridRowView[], r: number, c: number, dir: 1 | -1, maxR: number): number | null {
  let nr = r + dir;
  while (nr >= 0 && nr <= maxR) {
    if (rows[nr].cells[c]) return nr;
    nr += dir;
  }
  return null;
}

/** First non-null column in the row. Null if the row has no cells at all. */
function firstInRow(row: GridRowView, maxC: number): number | null {
  for (let c = 0; c <= maxC; c++) {
    if (row.cells[c]) return c;
  }
  return null;
}

/** Last non-null column in the row. Null if the row has no cells at all. */
function lastInRow(row: GridRowView, maxC: number): number | null {
  for (let c = maxC; c >= 0; c--) {
    if (row.cells[c]) return c;
  }
  return null;
}

export default function StatusDotGrid({ payers, rows }: StatusDotGridProps) {
  const navigate = useNavigate();
  const [focusPos, setFocusPos] = useState<{ r: number; c: number }>(() => findFirstCellPos(rows));
  const [hoverPos, setHoverPos] = useState<{ r: number; c: number } | null>(null);
  const [focusedCell, setFocusedCell] = useState<{ r: number; c: number } | null>(null);
  const [focusTooltipDismissed, setFocusTooltipDismissed] = useState(false);
  const gridRef = useRef<HTMLTableElement>(null);

  // The cell whose tooltip should be visible: hover always wins; otherwise the
  // currently-focused cell, unless its tooltip was dismissed via Escape.
  const tooltipPos = hoverPos ?? (focusTooltipDismissed ? null : focusedCell);

  const focusCell = useCallback((r: number, c: number) => {
    setFocusPos({ r, c });
    setFocusTooltipDismissed(false);
    // roving tabindex: focus the button at the new position after render
    requestAnimationFrame(() => {
      gridRef.current
        ?.querySelector<HTMLButtonElement>(`[data-cell="${r}-${c}"]`)
        ?.focus();
    });
  }, []);

  const onKeyDown = (e: React.KeyboardEvent, r: number, c: number) => {
    const maxR = rows.length - 1;
    const maxC = payers.length - 1;
    switch (e.key) {
      case 'ArrowRight': {
        e.preventDefault();
        const nc = nextInRow(rows[r], c, 1, maxC);
        if (nc !== null) focusCell(r, nc);
        break;
      }
      case 'ArrowLeft': {
        e.preventDefault();
        const nc = nextInRow(rows[r], c, -1, maxC);
        if (nc !== null) focusCell(r, nc);
        break;
      }
      case 'ArrowDown': {
        e.preventDefault();
        const nr = nextInColumn(rows, r, c, 1, maxR);
        if (nr !== null) focusCell(nr, c);
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const nr = nextInColumn(rows, r, c, -1, maxR);
        if (nr !== null) focusCell(nr, c);
        break;
      }
      case 'Home': {
        e.preventDefault();
        const nc = firstInRow(rows[r], maxC);
        if (nc !== null) focusCell(r, nc);
        break;
      }
      case 'End': {
        e.preventDefault();
        const nc = lastInRow(rows[r], maxC);
        if (nc !== null) focusCell(r, nc);
        break;
      }
      case 'Escape': setFocusTooltipDismissed(true); break;
      default: break;
    }
  };

  return (
    <div className="rounded-2xl border border-gray-200/60 bg-white p-5 shadow-sm">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        Enrollment status — every provider, every payer
      </h2>

      {/* Desktop grid (lg and up) */}
      <div className="mt-4 hidden overflow-x-auto lg:block">
        <table role="grid" aria-label="Enrollment status by provider and payer" ref={gridRef} className="w-full border-collapse">
          <thead>
            <tr role="row">
              <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Provider</th>
              {payers.map((p) => (
                <th key={p.id} className="px-2 py-2 text-center text-xs font-semibold uppercase tracking-wider text-gray-500">{p.name}</th>
              ))}
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={row.providerId} role="row" className="border-t border-gray-100">
                <td role="gridcell" className="px-2 py-2.5">
                  <span className="block text-sm font-semibold text-gray-900">{row.providerName}</span>
                  {row.credential ? <span className="block text-xs text-gray-500">{row.credential}</span> : null}
                </td>
                {row.cells.map((cell, c) => (
                  <td key={payers[c].id} role="gridcell" className="relative px-2 py-2.5 text-center">
                    {cell ? (
                      <>
                        <button
                          type="button"
                          data-cell={`${r}-${c}`}
                          tabIndex={focusPos.r === r && focusPos.c === c ? 0 : -1}
                          aria-label={cellFacts(payers[c].name, cell)}
                          aria-describedby={tooltipPos?.r === r && tooltipPos?.c === c ? `tt-${r}-${c}` : undefined}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                          onKeyDown={(e) => onKeyDown(e, r, c)}
                          onClick={() => navigate(`/enrollments/${cell.enrollmentId}`)}
                          onFocus={() => { setFocusedCell({ r, c }); setFocusTooltipDismissed(false); }}
                          onBlur={() => setFocusedCell((f) => (f?.r === r && f?.c === c ? null : f))}
                          onMouseEnter={() => setHoverPos({ r, c })}
                          onMouseLeave={() => setHoverPos((h) => (h?.r === r && h?.c === c ? null : h))}
                        >
                          <Dot status={cell.status} isDelayed={cell.isDelayed} />
                        </button>
                        {tooltipPos?.r === r && tooltipPos?.c === c && (
                          <div
                            id={`tt-${r}-${c}`}
                            role="tooltip"
                            className="absolute left-1/2 top-full z-10 mt-1 w-max max-w-[240px] -translate-x-1/2 rounded-lg bg-gray-900 px-3 py-2 text-left text-xs text-white shadow-lg"
                          >
                            {cellFacts(payers[c].name, cell)}
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="text-gray-300" aria-hidden="true">·</span>
                    )}
                  </td>
                ))}
                <td role="gridcell" className="px-2 py-2.5 text-right text-[13px] text-gray-500 tabular-nums whitespace-nowrap">
                  {row.approvedCount} of {row.totalCount} approved
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: per-provider accordion list (below lg) */}
      <div className="mt-4 space-y-3 lg:hidden">
        {rows.map((row) => (
          <details key={row.providerId} className="rounded-xl border border-gray-200/60 p-3">
            <summary className="flex cursor-pointer items-center justify-between text-sm font-semibold text-gray-900">
              <span>{row.providerName}{row.credential ? <span className="ml-1.5 font-normal text-gray-500">{row.credential}</span> : null}</span>
              <span className="text-[13px] font-normal text-gray-500 tabular-nums">{row.approvedCount} of {row.totalCount} approved</span>
            </summary>
            <ul className="mt-3 space-y-2">
              {row.cells.map((cell, c) =>
                cell ? (
                  <li key={payers[c].id} className="flex items-center justify-between gap-2">
                    <span className="text-sm text-gray-700">{payers[c].name}</span>
                    <span className={clsx('rounded-lg px-2 py-0.5 text-xs font-semibold', cell.isDelayed ? DELAYED_META.chip : STATUS_META[cell.status].chip)}>
                      {cell.isDelayed ? DELAYED_META.label : STATUS_META[cell.status].label}
                    </span>
                  </li>
                ) : null,
              )}
            </ul>
          </details>
        ))}
      </div>

      {/* Legend — all 7 statuses + Running long, always visible */}
      <div data-testid="grid-legend" className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-gray-100 pt-3">
        {LEGEND.map((entry) => (
          <span key={entry.label} className="flex items-center gap-1.5 text-[13px] text-gray-500">
            <Dot status={entry.status ?? 'approved'} isDelayed={entry.delayed ?? false} />
            {entry.label}
          </span>
        ))}
      </div>
    </div>
  );
}
