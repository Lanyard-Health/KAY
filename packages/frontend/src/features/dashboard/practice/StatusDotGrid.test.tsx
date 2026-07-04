import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import StatusDotGrid from './StatusDotGrid';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const payers = [{ id: 'p1', name: 'Aetna' }, { id: 'p2', name: 'Optum' }];
const rows = [{
  providerId: 'pr1',
  providerName: 'Amara Osei',
  credential: 'MD',
  approvedCount: 1,
  totalCount: 2,
  cells: [
    { enrollmentId: 'e1', status: 'approved' as const, isDelayed: false, dayCount: null, minDays: null, maxDays: null, updatedDaysAgo: 3 },
    { enrollmentId: 'e2', status: 'submitted' as const, isDelayed: true, dayCount: 97, minDays: 45, maxDays: 90, updatedDaysAgo: 12 },
  ],
}];

// Row 0: cells[0] is null (provider not enrolled with Aetna), cells[1] populated.
// Row 1: both populated, used to test ArrowDown/skip in a second column.
const sparsePayers = [{ id: 'p1', name: 'Aetna' }, { id: 'p2', name: 'Optum' }, { id: 'p3', name: 'Cigna' }];
const sparseRows = [
  {
    providerId: 'pr1',
    providerName: 'Amara Osei',
    credential: 'MD',
    approvedCount: 0,
    totalCount: 1,
    cells: [
      null,
      { enrollmentId: 'e1', status: 'approved' as const, isDelayed: false, dayCount: null, minDays: null, maxDays: null, updatedDaysAgo: 3 },
      null,
    ],
  },
  {
    providerId: 'pr2',
    providerName: 'Jordan Diaz',
    credential: 'NP',
    approvedCount: 1,
    totalCount: 2,
    cells: [
      null,
      null,
      { enrollmentId: 'e2', status: 'submitted' as const, isDelayed: false, dayCount: 10, minDays: 5, maxDays: 20, updatedDaysAgo: 1 },
    ],
  },
];

function renderGrid() {
  return render(<MemoryRouter><StatusDotGrid payers={payers} rows={rows} /></MemoryRouter>);
}

function renderSparseGrid() {
  return render(<MemoryRouter><StatusDotGrid payers={sparsePayers} rows={sparseRows} /></MemoryRouter>);
}

// One row: populated, null, populated — for testing that ArrowRight skips the null cell.
const arrowSkipPayers = [{ id: 'p1', name: 'Aetna' }, { id: 'p2', name: 'Optum' }, { id: 'p3', name: 'Cigna' }];
const arrowSkipRows = [{
  providerId: 'pr1',
  providerName: 'Test Provider',
  credential: null,
  approvedCount: 1,
  totalCount: 2,
  cells: [
    { enrollmentId: 'e1', status: 'approved' as const, isDelayed: false, dayCount: null, minDays: null, maxDays: null, updatedDaysAgo: 1 },
    null,
    { enrollmentId: 'e2', status: 'submitted' as const, isDelayed: false, dayCount: 10, minDays: 5, maxDays: 20, updatedDaysAgo: 2 },
  ],
}];

describe('StatusDotGrid', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it('renders a grid with provider row, payer columns, and row summary', () => {
    renderGrid();
    expect(screen.getByRole('grid')).toBeTruthy();
    expect(screen.getAllByText('Amara Osei').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1 of 2 approved').length).toBeGreaterThan(0);
  });
  it('delayed cell announces Running long (flag replaces status; status stays in the name)', () => {
    renderGrid();
    const cell = screen.getByRole('button', { name: /Optum — Running long/i });
    expect(cell.getAttribute('aria-label')).toMatch(/Submitted to payer/); // underlying status in the fact set
    expect(cell.getAttribute('aria-label')).toMatch(/day 97/i);
  });
  it('legend enumerates all seven statuses plus Running long (8 entries)', () => {
    renderGrid();
    const legend = screen.getByTestId('grid-legend');
    for (const label of ['Not started', 'In progress', 'Submitted to payer', 'Payer reviewing', 'Approved', 'Denied', 'No longer active', 'Running long']) {
      expect(legend.textContent).toContain(label);
    }
  });
  it('never renders raw enums', () => {
    const { container } = renderGrid();
    expect(container.textContent).not.toContain('pending_review');
    expect(container.textContent).not.toContain('not_started');
  });

  it('with null cells (unenrolled payers), exactly one button has tabIndex 0 — the first non-null cell', () => {
    const { container } = renderSparseGrid();
    const buttons = Array.from(container.querySelectorAll('button[data-cell]')) as HTMLButtonElement[];
    const focusable = buttons.filter((b) => b.tabIndex === 0);
    expect(focusable).toHaveLength(1);
    // row 0, col 0 (Aetna) is null; row 0, col 1 (Optum) is the first populated cell.
    expect(focusable[0].dataset.cell).toBe('0-1');
  });

  it('ArrowRight from a cell skips a null cell and lands on the next non-null one', () => {
    const { container } = render(<MemoryRouter><StatusDotGrid payers={arrowSkipPayers} rows={arrowSkipRows} /></MemoryRouter>);
    const first = container.querySelector('[data-cell="0-0"]') as HTMLButtonElement;
    const middle = container.querySelector('[data-cell="0-1"]');
    const last = container.querySelector('[data-cell="0-2"]') as HTMLButtonElement;
    expect(middle).toBeNull(); // no button rendered for the null cell
    expect(first.tabIndex).toBe(0);
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(last.tabIndex).toBe(0);
    expect(first.tabIndex).toBe(-1);
  });

  it('ArrowRight reaches a disconnected cell island (no shared row/column path)', () => {
    // Row 0 has only cell (0,1). Row 1 has only cell (1,2). Same-row and same-column
    // scanning alone can never bridge these — the wrap-to-next-row fallback must.
    const { container } = renderSparseGrid();
    const start = container.querySelector('[data-cell="0-1"]') as HTMLButtonElement;
    const target = container.querySelector('[data-cell="1-2"]') as HTMLButtonElement;
    expect(start.tabIndex).toBe(0);
    fireEvent.keyDown(start, { key: 'ArrowRight' });
    expect(target.tabIndex).toBe(0);
    expect(start.tabIndex).toBe(-1);
  });

  it("ArrowLeft from an island cell wraps back to the previous row's island", () => {
    const { container } = renderSparseGrid();
    const origin = container.querySelector('[data-cell="0-1"]') as HTMLButtonElement;
    const island = container.querySelector('[data-cell="1-2"]') as HTMLButtonElement;
    // Move focus to (1,2) first (exercises the same ArrowRight island-reach behavior above).
    fireEvent.keyDown(origin, { key: 'ArrowRight' });
    expect(island.tabIndex).toBe(0);
    fireEvent.keyDown(island, { key: 'ArrowLeft' });
    expect(island.tabIndex).toBe(-1);
    expect(origin.tabIndex).toBe(0);
  });

  it('Enter on a cell button navigates exactly once (no double-navigation)', async () => {
    const user = userEvent.setup();
    renderGrid();
    const cell = screen.getByRole('button', { name: /Aetna — Approved/i });
    cell.focus();
    // userEvent simulates real browser behavior: Enter on a focused <button> fires a native click.
    await expect(user.keyboard('{Enter}')).resolves.not.toThrow();
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/enrollments/e1');
  });

  it('keeps the focused cell tooltip visible after hovering and leaving a different cell', () => {
    renderGrid();
    const aetnaCell = screen.getByRole('button', { name: /Aetna — Approved/i });
    const optumCell = screen.getByRole('button', { name: /Optum — Running long/i });

    fireEvent.focus(aetnaCell);
    let tooltip = screen.getByRole('tooltip');
    expect(tooltip.textContent).toMatch(/Aetna/);

    fireEvent.mouseEnter(optumCell);
    tooltip = screen.getByRole('tooltip');
    expect(tooltip.textContent).toMatch(/Optum/);

    fireEvent.mouseLeave(optumCell);
    tooltip = screen.getByRole('tooltip');
    expect(tooltip.textContent).toMatch(/Aetna/);
  });
});
